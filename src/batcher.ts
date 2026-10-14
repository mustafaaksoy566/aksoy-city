import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { withSnow, autumnPatch, noSnow } from './season';

// Performans: çok sayıda ayrı nesneyi birkaç büyük parçada birleştirir.
// Telefonda asıl yavaşlık "çizim sayısı"ndan geliyor; 1 büyük parça, 100 küçük parçadan çok daha hızlı çizilir.
//
// - Dokusuz (düz renkli) malzemelerin rengi köşelere yazılır, hepsi tek malzemeyle çizilir.
// - Dokulu malzemeler ve pencereler (gece yandıkları için) kendi malzemeleriyle gruplanır.

const vertexColorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
// Ağaç yaprakları ayrı bir parçada: sonbaharda renkleri değişir (season.ts)
const leafMergedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
leafMergedMat.userData.leaf = true;
withSnow(leafMergedMat, autumnPatch);
leafMergedMat.customProgramCacheKey = () => 'leaf-merged';
// Kar tutmayan düz renkli parçalar (yol asfaltı ve çizgileri) de tek parçada: renkleri köşelere yazılır
const plainNoSnowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
noSnow(plainNoSnowMat);

type Kind = 'vc' | 'tex' | 'keep' | 'leaf' | 'plain';

function classify(mat: THREE.Material): Kind {
  const m = mat as THREE.MeshStandardMaterial;
  if (m.userData?.leaf) return 'leaf';
  if (m.userData?.noSnow && !m.map && !m.transparent) return 'plain';
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
  if (!g.index) {
    const ix = new Uint32Array(n);
    for (let k = 0; k < n; k++) ix[k] = k;
    g.setIndex(new THREE.BufferAttribute(ix, 1));
  }
  // Ters ölçeklenmiş (aynalanmış) parçalarda üçgen yönünü düzelt
  if (matrix.determinant() < 0) {
    const idx = g.index!.array as Uint32Array | Uint16Array;
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
  }
  g.clearGroups();
  return g;
}

// Birleştirme tek geçişte yapılır: her parçanın köşeleri dünya konumuna çevrilirken doğrudan ortak dizilere
// yazılır (ara kopya yok). Eskiden her parça önce kopyalanıp taşınıyor, sonra bir daha birleştiriliyordu; bir bina
// büyüyünce bölgesi yeniden birleştirilirken telefonda belirgin takılma oluyordu.
interface Part { geo: THREE.BufferGeometry; m: THREE.Matrix4; tint?: THREE.Color }
interface Bucket { mat: THREE.Material; uv: boolean; color: boolean; parts: Part[]; verts: number; count: number }

// Bilgiyi düz Float32 dizi olarak oku (araya serpiştirilmiş, normalize ya da farklı boyutlu olanlar çevrilir)
function flat(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): ArrayLike<number> {
  const a = attr as THREE.BufferAttribute;
  if (a.isBufferAttribute && !a.normalized && a.itemSize === size) return a.array;
  const out = new Float32Array(attr.count * size);
  for (let k = 0; k < attr.count; k++) {
    for (let s = 0; s < size; s++) out[k * size + s] = s === 0 ? attr.getX(k) : s === 1 ? attr.getY(k) : s === 2 ? attr.getZ(k) : attr.getW(k);
  }
  return out;
}

const NM = new THREE.Matrix3();
function build(b: Bucket): THREE.BufferGeometry {
  const P = new Float32Array(b.verts * 3), N = new Float32Array(b.verts * 3);
  const C = b.color ? new Float32Array(b.verts * 3) : null;
  const U = b.uv ? new Float32Array(b.verts * 2) : null;
  const I = b.verts > 65535 ? new Uint32Array(b.count) : new Uint16Array(b.count);
  let v = 0, o = 0;
  for (const { geo, m, tint } of b.parts) {
    const n = geo.attributes.position.count;
    const p = flat(geo.attributes.position, 3), nr = flat(geo.attributes.normal, 3);
    const e = m.elements, q = NM.getNormalMatrix(m).elements;
    for (let k = 0; k < n; k++) {
      const x = p[k * 3], y = p[k * 3 + 1], z = p[k * 3 + 2];
      const w = v * 3 + k * 3;
      P[w] = e[0] * x + e[4] * y + e[8] * z + e[12];
      P[w + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      P[w + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const a = nr[k * 3], bb = nr[k * 3 + 1], c = nr[k * 3 + 2];
      const nx = q[0] * a + q[3] * bb + q[6] * c, ny = q[1] * a + q[4] * bb + q[7] * c, nz = q[2] * a + q[5] * bb + q[8] * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      N[w] = nx / l;
      N[w + 1] = ny / l;
      N[w + 2] = nz / l;
    }
    if (C) {
      if (tint) for (let k = 0; k < n; k++) tint.toArray(C, (v + k) * 3);
      else C.set(flat(geo.attributes.color, 3) as Float32Array, v * 3);
    }
    if (U && geo.attributes.uv) U.set(flat(geo.attributes.uv, 2) as Float32Array, v * 2);
    const flip = m.determinant() < 0; // aynalanmış parçada üçgen yönü ters çevrilir
    if (geo.index) {
      const ia = geo.index.array, cnt = geo.index.count;
      for (let k = 0; k < cnt; k += 3) {
        I[o + k] = ia[k] + v;
        I[o + k + 1] = (flip ? ia[k + 2] : ia[k + 1]) + v;
        I[o + k + 2] = (flip ? ia[k + 1] : ia[k + 2]) + v;
      }
      o += cnt;
    } else {
      for (let k = 0; k + 2 < n; k += 3) {
        I[o + k] = v + k;
        I[o + k + 1] = v + (flip ? k + 2 : k + 1);
        I[o + k + 2] = v + (flip ? k + 1 : k + 2);
      }
      o += n - (n % 3);
    }
    v += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (U) g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  if (C) g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  return g;
}

export function mergeStatic(objects: THREE.Object3D[]): THREE.Group {
  const buckets = new Map<string, Bucket>();
  const put = (key: string, mat: THREE.Material, uv: boolean, color: boolean, mesh: THREE.Mesh, tint?: THREE.Color) => {
    let geo = mesh.geometry;
    if (!geo.attributes.position) return;
    if (!geo.attributes.normal) {
      geo = geo.clone();
      geo.computeVertexNormals();
    }
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, uv, color, parts: [], verts: 0, count: 0 }));
    b.parts.push({ geo, m: mesh.matrixWorld, tint });
    const n = geo.attributes.position.count;
    b.verts += n;
    b.count += geo.index ? geo.index.count : n - (n % 3);
  };

  for (const root of objects) {
    root.updateMatrixWorld(true);
    root.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !mesh.visible) return;
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      const kind = classify(mat);
      const own = mat.vertexColors && !!mesh.geometry.attributes.color;
      if (kind === 'vc' || kind === 'leaf' || kind === 'plain') {
        // Kendi köşe renkleri olan modeller (ağaçlar) renklerini korur
        put(kind, kind === 'leaf' ? leafMergedMat : kind === 'plain' ? plainNoSnowMat : vertexColorMat, false, true, mesh, own ? undefined : mat.color);
      } else {
        // Dokulu malzemeler kendi malzemesiyle gruplanır; köşe renkli olanlar (yollar, farlar) renklerini korur
        put(`${kind}|${mat.uuid}|${own}`, mat, true, own, mesh);
      }
    });
  }

  const out = new THREE.Group();
  for (const b of buckets.values()) {
    if (!b.verts) continue;
    const mesh = new THREE.Mesh(build(b), b.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
  }
  // Dış grup taşınabilir, döndürülebilir ve büyütülebilir kalır (binalar bu grubu doğrudan döndürüp yerine koyar)
  return out;
}

export function disposeMerged(group: THREE.Group) {
  for (const c of group.children) (c as THREE.Mesh).geometry.dispose();
}

// Bir modeli tek geometriye çevir (renkler köşelere yazılır). Arabalar için: binlerce parça yerine tek çizim.
export function bakeModel(obj: THREE.Object3D): THREE.BufferGeometry | null {
  // Not: dokulu modellerde renk yerine dokuyu kullanmak için bakeTextured kullanılır
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
