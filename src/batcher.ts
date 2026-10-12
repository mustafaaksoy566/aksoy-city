import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Performans: çok sayıda ayrı nesneyi birkaç büyük parçada birleştirir.
// Telefonda asıl yavaşlık "çizim sayısı"ndan geliyor; 1 büyük parça, 100 küçük parçadan çok daha hızlı çizilir.
//
// - Dokusuz (düz renkli) malzemelerin rengi köşelere yazılır, hepsi tek malzemeyle çizilir.
// - Dokulu malzemeler (Kenney colormap) ve pencereler (gece yandıkları için) kendi malzemeleriyle gruplanır.

const vertexColorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });

type Kind = 'vc' | 'tex' | 'keep';

function classify(mat: THREE.Material): Kind {
  const m = mat as THREE.MeshStandardMaterial;
  if (m.map) return 'tex';
  // Pencereler ve far gibi gece yanan, saydam ya da ışık saçan malzemeler kendileri kalsın
  if (m.name === 'window' || m.name === 'lamp' || /headlight/i.test(m.name) || m.transparent || (m.emissiveIntensity > 0 && m.emissive?.getHex())) return 'keep';
  if (!m.color) return 'keep';
  return 'vc';
}

// Geometriyi birleştirmeye hazırla: dünya konumuna taşı, gereksiz bilgileri at, indeksli yap
function prepare(src: THREE.BufferGeometry, matrix: THREE.Matrix4, keep: string[], color?: THREE.Color) {
  const g = src.clone().applyMatrix4(matrix);
  for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
  // Bütün bilgiler aynı biçimde olsun (Float32, renk 3 bileşenli). Biri farklıysa (ör. 4 bileşenli renk)
  // birleştirme başarısız olur ve o parçadaki binaların duvarları hiç çizilmez.
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name);
    const size = name === 'color' ? 3 : a.itemSize;
    if ((a as THREE.BufferAttribute).isBufferAttribute && a.array instanceof Float32Array && !a.normalized && a.itemSize === size) continue;
    const out = new Float32Array(a.count * size);
    for (let k = 0; k < a.count; k++) {
      for (let s = 0; s < size; s++) out[k * size + s] = s === 0 ? a.getX(k) : s === 1 ? a.getY(k) : s === 2 ? a.getZ(k) : a.getW(k);
    }
    g.setAttribute(name, new THREE.Float32BufferAttribute(out, size));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (keep.includes('uv') && !g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (color) {
    const c = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) color.toArray(c, k * 3);
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  }
  if (!g.index) g.setIndex([...Array(n).keys()]);
  // Ters ölçeklenmiş (aynalanmış) parçalarda üçgen yönünü düzelt
  if (matrix.determinant() < 0) {
    const idx = g.index!.array as Uint32Array | Uint16Array;
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
  }
  g.clearGroups();
  return g;
}

export function mergeStatic(objects: THREE.Object3D[]): THREE.Group {
  const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const push = (key: string, mat: THREE.Material, geo: THREE.BufferGeometry) => {
    let grp = groups.get(key);
    if (!grp) groups.set(key, (grp = { mat, geos: [] }));
    grp.geos.push(geo);
  };

  for (const root of objects) {
    root.updateMatrixWorld(true);
    root.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !mesh.visible) return;
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      const kind = classify(mat);
      if (kind === 'vc') {
        // Kendi köşe renkleri olan modeller (ağaçlar) renklerini korur
        const own = mat.vertexColors && !!mesh.geometry.attributes.color;
        push('vc', vertexColorMat, prepare(mesh.geometry, mesh.matrixWorld, ['position', 'normal', 'color'], own ? undefined : mat.color));
      } else if (kind === 'tex') {
        // Aynı doku atlası tek malzeme olarak yüklenir (assets.ts), o yüzden malzemeye göre grupla
        push(`tex|${mat.uuid}`, mat, prepare(mesh.geometry, mesh.matrixWorld, ['position', 'normal', 'uv']));
      } else {
        push(`keep|${mat.uuid}`, mat, prepare(mesh.geometry, mesh.matrixWorld, ['position', 'normal', 'uv']));
      }
    });
  }

  const out = new THREE.Group();
  const addMesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
  };
  for (const { mat, geos } of groups.values()) {
    const merged = mergeGeometries(geos, false);
    if (merged) {
      geos.forEach(g => g.dispose());
      addMesh(merged, mat);
    } else {
      // Birleştirilemediyse hiçbir şey kaybolmasın: parçalar ayrı ayrı çizilir
      for (const g of geos) addMesh(g, mat);
    }
  }
  out.matrixAutoUpdate = false;
  return out;
}

export function disposeMerged(group: THREE.Group) {
  for (const c of group.children) (c as THREE.Mesh).geometry.dispose();
}

// Bir modeli tek geometriye çevir (renkler köşelere yazılır). Arabalar için: binlerce parça yerine tek çizim.
export function bakeModel(obj: THREE.Object3D): THREE.BufferGeometry | null {
  // Not: dokulu modellerde (KayKit) renk yerine dokuyu kullanmak için bakeTextured kullanılır
  obj.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  obj.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    geos.push(prepare(mesh.geometry, mesh.matrixWorld, ['position', 'normal', 'color'], mat.color ?? new THREE.Color('#888')));
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach(g => g.dispose());
  return merged;
}

export { vertexColorMat };

// Dokulu (tek atlas kullanan) bir modeli tek geometriye çevir; malzemesiyle birlikte döner
export function bakeTextured(obj: THREE.Object3D): { geo: THREE.BufferGeometry; mat: THREE.Material } | null {
  obj.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  let mat: THREE.Material | null = null;
  obj.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mat ??= Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    geos.push(prepare(mesh.geometry, mesh.matrixWorld, ['position', 'normal', 'uv']));
  });
  const geo = mergeGeometries(geos, false);
  geos.forEach(g => g.dispose());
  return geo && mat ? { geo, mat } : null;
}
