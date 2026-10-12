import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Ağaçlar: yuvarlak yapraklı ağaç, çam, servi, çalı ve çiçekli ağaç.
// Yapraklar alttan koyu, üstten açık (güneş üstten vuruyor gibi); her yüzey biraz farklı tonda, el yapımı gibi.
// Şehirdeki ağaçlar hazır renkli modeller, çevredeki binlerce ağaç ise tek seferde çizilir ve rüzgârda sallanır.

export type TreeType = 'round' | 'pine' | 'cypress' | 'bush' | 'blossom';

const hash = (a: number, b: number, c: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

// Biraz yamuk top. Aynı yerdeki köşeler aynı miktarda itilir ki yüzeyler arasında çatlak olmasın.
function blob(r: number, detail: number, x: number, y: number, z: number, sy = 1, rough = 0.24) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const k = 1 + (hash(Math.round(vx * 997), Math.round(vy * 991), Math.round(vz * 983)) - 0.5) * rough;
    p.setXYZ(i, vx * k + x, vy * k * sy + y, vz * k + z);
  }
  g.deleteAttribute('uv');
  return g;
}

function cone(r: number, h: number, y: number, seg = 7) {
  // Altı açık (yukarıdan bakınca görünmüyor, daha az üçgen)
  const g = new THREE.ConeGeometry(r, h, seg, 1, true).toNonIndexed();
  g.translate(0, y, 0);
  g.deleteAttribute('uv');
  return g;
}

function trunk(r: number, h: number) {
  const g = new THREE.CylinderGeometry(r * 0.7, r, h, 6, 1, true).toNonIndexed();
  g.translate(0, h / 2, 0);
  g.deleteAttribute('uv');
  return g;
}

// Yüzeyleri boya: alttan üste koyudan açığa, her yüzey biraz farklı
function paint(g: THREE.BufferGeometry, low: THREE.Color, high: THREE.Color, y0: number, y1: number, seed: number) {
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let f = 0; f < p.count; f += 3) {
    const cy = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3;
    const t = THREE.MathUtils.smoothstep(cy, y0, y1);
    c.lerpColors(low, high, t).multiplyScalar(0.9 + hash(f, seed, 3) * 0.18);
    for (let k = 0; k < 3; k++) c.toArray(colors, (f + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals(); // köşeler paylaşılmadığı için her yüzey düz (köşeli görünüm)
  return g;
}

const merge = (list: THREE.BufferGeometry[]) => {
  const m = mergeGeometries(list, false)!;
  list.forEach(g => g.dispose());
  return m;
};

// Yaprak renkleri [alt, üst]. Çevredeki ağaçlarda gri tonlu boyanır, rengi her ağaca ayrı verilir.
const LEAVES: Record<TreeType, [string, string]> = {
  round: ['#3f8a34', '#9bd45c'],
  blossom: ['#d8628c', '#ffc6d8'],
  pine: ['#2b663a', '#5f9f4b'],
  cypress: ['#2f6b35', '#6eab4a'],
  bush: ['#3d8634', '#8fcb55'],
};
const GRAY: [string, string] = ['#7a7a7a', '#ffffff'];

// Ağacın yaprakları ve gövdesi (gövde yoksa null). detail: toparlak kısımların inceliği
export function treeParts(type: TreeType, detail: number, gray = false) {
  const [lo, hi] = (gray ? GRAY : LEAVES[type]).map(c => new THREE.Color(c));
  let crown: THREE.BufferGeometry;
  let wood: THREE.BufferGeometry | null = null;
  if (type === 'pine') {
    crown = paint(merge([cone(0.17, 0.27, 0.27), cone(0.135, 0.23, 0.41), cone(0.095, 0.2, 0.54)]), lo, hi, 0.15, 0.64, 2);
    wood = trunk(0.034, 0.17);
  } else if (type === 'cypress') {
    crown = paint(merge([blob(0.1, detail, 0, 0.37, 0, 2.7, 0.18)]), lo, hi, 0.1, 0.64, 3);
    wood = trunk(0.03, 0.12);
  } else if (type === 'bush') {
    crown = paint(merge([blob(0.11, detail, 0, 0.075, 0, 0.75), blob(0.085, detail, 0.085, 0.06, 0.03, 0.75), blob(0.075, detail, -0.07, 0.055, 0.045, 0.75)]), lo, hi, 0, 0.16, 4);
  } else {
    crown = paint(
      merge([
        blob(0.165, detail, 0, 0.4, 0),
        blob(0.125, detail, 0.1, 0.33, 0.05),
        blob(0.12, detail, -0.09, 0.35, -0.05),
        blob(0.1, detail, 0.01, 0.52, -0.01),
      ]),
      lo, hi, 0.22, 0.6, type === 'blossom' ? 5 : 1,
    );
    wood = trunk(0.042, 0.28);
  }
  if (wood) paint(wood, new THREE.Color('#5e3d26'), new THREE.Color('#8a5c39'), 0, 0.3, 7);
  return { crown, wood };
}

// --- Şehirdeki ağaç modelleri (makeModel ile kullanılır) ---
const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });

export const TREE_MODELS: Record<string, () => THREE.Object3D> = {};
// 'street': cadde kenarındaki sade ağaç (daha az üçgen, çok sayıda dikildiği için)
for (const [name, type, detail] of [
  ['round', 'round', 1], ['pine', 'pine', 1], ['cypress', 'cypress', 1], ['bush', 'bush', 1], ['blossom', 'blossom', 1], ['street', 'round', 0],
] as [string, TreeType, number][]) {
  TREE_MODELS[`proc/tree-${name}`] = () => {
    const { crown, wood } = treeParts(type, detail);
    const g = new THREE.Group();
    for (const [geo, m] of [[crown, leafMat], [wood, woodMat]] as [THREE.BufferGeometry | null, THREE.Material][]) {
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  };
}

// --- Çevredeki ormanlar ---
// Yapraklar rüzgârda hafifçe sallanır (gölgeler sabit kalır)
const wind = { value: 0 };
const forestLeaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
forestLeaf.onBeforeCompile = shader => {
  shader.uniforms.uWind = wind;
  shader.vertexShader = 'uniform float uWind;\n' + shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    #ifdef USE_INSTANCING
      vec3 ip = instanceMatrix[3].xyz;
      float sw = sin(uWind * 1.5 + ip.x * 0.31 + ip.z * 0.23) * 0.6 + sin(uWind * 2.6 + ip.x * 0.8) * 0.3;
      float bend = max(transformed.y - 0.18, 0.0);
      transformed.x += sw * 0.05 * bend;
      transformed.z += sw * 0.03 * bend;
    #endif`,
  );
};
forestLeaf.customProgramCacheKey = () => 'forest-leaf';

export function updateTrees(time: number) {
  wind.value = time;
}

export interface TreeSpot { type: TreeType; matrix: THREE.Matrix4; color: THREE.Color }

// Her ağaç türü için iki çizim: renkli yapraklar ve gövdeler
export function forest(spots: TreeSpot[]): THREE.Group {
  const g = new THREE.Group();
  for (const type of ['round', 'pine', 'cypress', 'bush', 'blossom'] as TreeType[]) {
    const list = spots.filter(s => s.type === type);
    if (!list.length) continue;
    const { crown, wood } = treeParts(type, 0, true);
    const leaves = new THREE.InstancedMesh(crown, forestLeaf, list.length);
    list.forEach((s, i) => {
      leaves.setMatrixAt(i, s.matrix);
      leaves.setColorAt(i, s.color);
    });
    leaves.castShadow = leaves.receiveShadow = true;
    g.add(leaves);
    if (wood) {
      const trunks = new THREE.InstancedMesh(wood, woodMat, list.length);
      list.forEach((s, i) => trunks.setMatrixAt(i, s.matrix));
      trunks.castShadow = true;
      g.add(trunks);
    }
  }
  return g;
}
