import * as THREE from 'three';
import { TOWER_MODELS } from './towers';

// Evler: gökdelenler gibi kodla çizilir. Her biri bir tarzda: modern (düz çatı, büyük camlar, havuz),
// Kiklad (beyaz küpler, mavi kubbe), dağ evi (taş ve ahşap, dik çatı), Kyoto (Japon çatısı, kağıt paneller),
// Toskana (turuncu sıva, kiremit çatı, servi), sıra evler (renkli, yan yana). Yerel ölçü: 1x1 kare, ön yüz +z.

const hash = (n: number, k: number) => {
  const s = Math.sin(n * 71.3 + k * 19.7) * 43758.5453;
  return s - Math.floor(s);
};
const cache = new Map<string, THREE.MeshStandardMaterial>();
const mat = (color: string, rough = 0.8, metal = 0) => {
  const key = `${color}|${rough}|${metal}`;
  let m = cache.get(key);
  if (!m) cache.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })));
  return m;
};
const WIN = new THREE.MeshStandardMaterial({ color: '#9fd0ee', roughness: 0.15, metalness: 0.3 });
WIN.name = 'window';
const pick = <T,>(list: T[], seed: number, k: number) => list[Math.floor(hash(seed, k) * list.length)];

function builder() {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) => add(new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z, ry);
  return { g, add, box };
}

// Beşik çatı (iki eğimli): genişlik w (x), yükseklik h, derinlik d (z boyunca sırt)
function gable(w: number, h: number, d: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(0, h);
  s.lineTo(w / 2, 0);
  s.lineTo(-w / 2, 0);
  return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
}
// Kırma çatı (dört eğimli)
function hip(w: number, d: number, h: number) {
  return new THREE.ConeGeometry(Math.SQRT1_2, h, 4, 1).rotateY(Math.PI / 4).scale(w, 1, d).translate(0, h / 2, 0);
}
// Bahçe zemini ve çit
function yard(b: ReturnType<typeof builder>, grass = '#6cbd55') {
  b.box(0.94, 0.02, 0.94, mat(grass, 1), 0, 0, 0);
}
function bush(b: ReturnType<typeof builder>, x: number, z: number, r: number, color = '#4f9f3f') {
  b.add(new THREE.IcosahedronGeometry(r, 0), mat(color, 1), x, r * 0.8 + 0.02, z);
}
function cypress(b: ReturnType<typeof builder>, x: number, z: number, h = 0.32) {
  b.add(new THREE.CylinderGeometry(0.008, 0.01, 0.04, 5), mat('#6b4a33'), x, 0.04, z);
  b.add(new THREE.ConeGeometry(0.045, h, 7), mat('#2f6b3a', 1), x, 0.06 + h / 2, z);
}

// --- Modern ev: düz çatılı iki kutu, büyük camlar, ahşap kaplama, çatı terası, havuz ---
export function makeModern(seed: number, floors: number) {
  const b = builder();
  yard(b);
  const white = mat(pick(['#f5f5f2', '#ececec', '#e9e4dc'], seed, 1), 0.7);
  const wood = mat(pick(['#9a6a43', '#b07d52', '#7d5a3c'], seed, 2), 0.7);
  const dark = mat('#2f3640', 0.5);
  const h1 = 0.17;
  // Alt kat: geniş kutu, önü cam
  b.box(0.62, h1, 0.42, white, -0.06, 0.02, -0.1);
  b.box(0.5, 0.11, 0.01, WIN, -0.06, 0.045, 0.115);
  b.box(0.64, 0.014, 0.44, dark, -0.06, 0.02 + h1, -0.1);
  // Yanda ahşap kaplı kutu
  b.box(0.22, h1, 0.3, wood, 0.32, 0.02, -0.16);
  b.box(0.01, 0.1, 0.2, WIN, 0.432, 0.05, -0.16);
  if (floors > 1) {
    // Üst kat: kaydırılmış kutu, uzun pencere, çatı terası korkuluğu
    b.box(0.46, 0.15, 0.34, wood, -0.14, 0.034 + h1, -0.18);
    b.box(0.38, 0.09, 0.01, WIN, -0.14, 0.06 + h1, -0.005);
    b.box(0.48, 0.012, 0.36, dark, -0.14, 0.184 + h1, -0.18);
    b.box(0.2, 0.04, 0.008, mat('#cfe8f5', 0.1, 0.2), 0.12, 0.034 + h1, 0.11);
  }
  // Havuz ve güneşlenme yeri
  b.box(0.36, 0.024, 0.18, mat('#e8e2d4'), -0.1, 0.02, 0.32);
  b.box(0.3, 0.026, 0.12, mat('#4fb8e8', 0.1, 0.2), -0.1, 0.022, 0.32);
  b.box(0.06, 0.012, 0.12, mat('#ffffff'), 0.18, 0.04, 0.32);
  bush(b, 0.38, 0.32, 0.06);
  bush(b, -0.4, -0.38, 0.05);
  b.box(0.12, 0.022, 0.3, mat('#cfcac0'), 0.33, 0.02, 0.2);
  return b.g;
}

// --- Kiklad evi: beyaz küpler, mavi kubbe, mavi kapı ve panjurlar, dış merdiven, begonvil ---
export function makeCycladic(seed: number, floors: number) {
  const b = builder();
  yard(b, '#e9e2d0');
  const white = mat('#fbfbf8', 0.9);
  const blue = mat(pick(['#1e5fae', '#1f7ac2', '#245fa8'], seed, 1), 0.5);
  b.box(0.5, 0.18, 0.4, white, -0.1, 0.02, -0.12);
  b.box(0.3, 0.14, 0.3, white, 0.25, 0.02, 0.08);
  b.box(0.09, 0.12, 0.012, blue, -0.1, 0.02, 0.085);
  for (const x of [-0.28, 0.08]) b.box(0.07, 0.07, 0.012, blue, x, 0.08, 0.085);
  b.box(0.06, 0.06, 0.012, blue, 0.25, 0.07, 0.235);
  if (floors > 1) {
    b.box(0.3, 0.15, 0.26, white, -0.2, 0.2, -0.18);
    b.box(0.07, 0.07, 0.012, blue, -0.2, 0.25, -0.045);
    // Dış merdiven
    for (let k = 0; k < 5; k++) b.box(0.08, 0.036 * (k + 1), 0.05, white, 0.07, 0.02, 0.02 - k * 0.05);
  }
  // Kubbe
  const top = floors > 1 ? 0.35 : 0.2;
  b.add(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 20), white, floors > 1 ? -0.2 : -0.1, top + 0.025, floors > 1 ? -0.18 : -0.12);
  b.add(new THREE.SphereGeometry(0.1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), blue, floors > 1 ? -0.2 : -0.1, top + 0.05, floors > 1 ? -0.18 : -0.12);
  // Teras duvarı ve begonvil
  b.box(0.3, 0.035, 0.02, white, 0.25, 0.16, 0.225);
  bush(b, 0.38, 0.3, 0.06, '#e04a9a');
  bush(b, 0.3, 0.36, 0.045, '#4f9f3f');
  b.box(0.05, 0.05, 0.05, mat('#c86b3c'), -0.35, 0.02, 0.3);
  return b.g;
}

// --- Dağ evi: taş temel, ahşap gövde, geniş saçaklı dik çatı, balkon, baca ---
export function makeChalet(seed: number, floors: number) {
  const b = builder();
  yard(b);
  const stone = mat('#9e978b', 1), wood = mat(pick(['#8a5a36', '#9c6a40', '#7a4e2e'], seed, 1), 0.8);
  const roofM = mat(pick(['#4e3426', '#3f4a54', '#6a3b2a'], seed, 2), 0.8);
  const trim = mat('#f1e6cf');
  b.box(0.56, 0.08, 0.44, stone, 0, 0.02, -0.06);
  const h = 0.13 + (floors - 1) * 0.12;
  b.box(0.54, h, 0.42, wood, 0, 0.1, -0.06);
  const roof = b.add(gable(0.7, 0.26, 0.56), roofM, 0, 0.1 + h, -0.06);
  roof.rotation.y = 0;
  for (const x of [-0.16, 0.16]) {
    b.box(0.1, 0.08, 0.012, WIN, x, 0.13, 0.155);
    b.box(0.12, 0.012, 0.02, trim, x, 0.12, 0.16);
  }
  b.box(0.08, 0.12, 0.012, mat('#5a3a22'), 0, 0.02, 0.156);
  if (floors > 1) {
    // Balkon ve çiçek kutuları
    b.box(0.56, 0.012, 0.08, wood, 0, 0.23, 0.19);
    b.box(0.56, 0.04, 0.008, trim, 0, 0.243, 0.23);
    for (const x of [-0.2, 0, 0.2]) b.box(0.08, 0.02, 0.02, mat('#e53935'), x, 0.283, 0.228);
    b.box(0.12, 0.08, 0.012, WIN, 0, 0.26, 0.156);
  }
  b.box(0.07, 0.18, 0.07, stone, 0.18, 0.1 + h + 0.06, -0.14);
  // Odun yığını ve çam
  b.add(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6).rotateZ(Math.PI / 2), mat('#a0703f'), -0.38, 0.04, 0.2);
  b.add(new THREE.ConeGeometry(0.07, 0.3, 7), mat('#2f6b3a', 1), 0.38, 0.19, 0.3);
  b.add(new THREE.ConeGeometry(0.06, 0.24, 7), mat('#37723f', 1), -0.36, 0.16, -0.36);
  return b.g;
}

// --- Kyoto evi: ahşap iskelet, beyaz kağıt paneller, kenarları kalkık koyu çatı, veranda, taş fener, akçaağaç ---
export function makeKyoto(seed: number) {
  const b = builder();
  yard(b, '#7fae5e');
  const wood = mat('#5b3a26', 0.7), paper = mat('#f3eee0', 0.9), roofM = mat(pick(['#3b3f46', '#2f3a3a'], seed, 1), 0.6);
  b.box(0.6, 0.04, 0.44, mat('#8c8478'), 0, 0.02, -0.06);
  b.box(0.54, 0.16, 0.38, paper, 0, 0.06, -0.06);
  // Ahşap kirişler (cephede ızgara)
  for (const x of [-0.27, -0.09, 0.09, 0.27]) b.box(0.014, 0.16, 0.39, wood, x, 0.06, -0.06);
  b.box(0.56, 0.014, 0.4, wood, 0, 0.14, -0.06);
  // Veranda
  b.box(0.6, 0.02, 0.1, wood, 0, 0.06, 0.18);
  // Çatı: geniş kırma çatı + kalkık uçlar için üstte ikinci küçük çatı
  b.add(hip(0.78, 0.6, 0.16), roofM, 0, 0.22, -0.06);
  b.add(hip(0.4, 0.26, 0.1), roofM, 0, 0.34, -0.06);
  b.box(0.42, 0.02, 0.03, roofM, 0, 0.43, -0.06);
  // Bahçe: taş fener, yuvarlak taşlar, kızıl akçaağaç, gölet
  b.add(new THREE.CylinderGeometry(0.015, 0.02, 0.08, 6), mat('#a39e94'), -0.34, 0.06, 0.3);
  b.box(0.06, 0.03, 0.06, mat('#a39e94'), -0.34, 0.1, 0.3);
  b.add(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 16), mat('#4f9fd0', 0.1, 0.2), 0.25, 0.026, 0.3);
  b.add(new THREE.CylinderGeometry(0.012, 0.016, 0.12, 6), mat('#5b3a26'), 0.36, 0.08, -0.34);
  b.add(new THREE.IcosahedronGeometry(0.1, 0), mat('#d8452f', 1), 0.36, 0.2, -0.34);
  for (const [x, z] of [[-0.2, 0.35], [-0.1, 0.38], [0.05, 0.36]]) b.add(new THREE.IcosahedronGeometry(0.018, 0), mat('#9a958c'), x, 0.03, z);
  return b.g;
}

// --- Toskana evi: turuncu-pembe sıva, alçak kırma kiremit çatı, yeşil panjurlar, kemerli kapı, servi ağaçları ---
export function makeTuscan(seed: number, floors: number) {
  const b = builder();
  yard(b, '#8fae5a');
  const wall = mat(pick(['#e8b884', '#e9a777', '#f0c995', '#dca06e'], seed, 1), 0.95);
  const roofM = mat(pick(['#b5532f', '#c0613a', '#a84a2a'], seed, 2), 0.85);
  const green = mat('#4d6b3c');
  const h = 0.16 + (floors - 1) * 0.15;
  b.box(0.58, h, 0.4, wall, -0.04, 0.02, -0.08);
  b.add(hip(0.68, 0.5, 0.13), roofM, -0.04, 0.02 + h, -0.08);
  for (let f = 0; f < floors; f++) {
    for (const x of [-0.24, 0.16]) {
      b.box(0.07, 0.09, 0.012, WIN, x, 0.06 + f * 0.15, 0.126);
      for (const s of [-1, 1]) b.box(0.035, 0.09, 0.012, green, x + s * 0.055, 0.06 + f * 0.15, 0.128);
    }
  }
  // Kemerli kapı
  b.box(0.08, 0.1, 0.012, mat('#6b4a33'), -0.04, 0.02, 0.127);
  b.add(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), mat('#6b4a33'), -0.04, 0.12, 0.127);
  // Kemerli sundurma, saksılar ve serviler
  b.box(0.2, 0.012, 0.12, roofM, 0.3, 0.16, 0.18);
  for (const x of [0.22, 0.38]) b.box(0.02, 0.14, 0.02, wall, x, 0.02, 0.23);
  for (const x of [-0.38, -0.3]) b.add(new THREE.CylinderGeometry(0.025, 0.02, 0.04, 8), mat('#c06a3e'), x, 0.04, 0.3);
  cypress(b, 0.4, -0.38, 0.38);
  cypress(b, -0.42, -0.36, 0.3);
  cypress(b, 0.42, 0.38, 0.26);
  return b.g;
}

// --- Sıra evler: yan yana üç dar ev, her biri farklı renkte, üçgen alınlıklı cepheler ---
export function makeRowHouses(seed: number) {
  const b = builder();
  yard(b, '#cfcac0');
  const colors = ['#c0392b', '#2e86c1', '#f4d03f', '#27ae60', '#e67e22', '#8e44ad', '#f5f5f0', '#5d6d7e'];
  for (let k = 0; k < 3; k++) {
    const x = -0.29 + k * 0.29;
    const h = 0.28 + hash(seed, k + 3) * 0.08;
    const wall = mat(colors[Math.floor(hash(seed, k + 9) * colors.length)], 0.85);
    b.box(0.28, h, 0.42, wall, x, 0.02, -0.1);
    b.add(gable(0.28, 0.12, 0.42), mat('#4a3f3a'), x, 0.02 + h, -0.1);
    for (let f = 0; f < 2; f++) for (const dx of [-0.065, 0.065]) b.box(0.05, 0.07, 0.012, WIN, x + dx, 0.08 + f * 0.12, 0.112);
    b.box(0.06, 0.09, 0.012, mat('#3e2c22'), x, 0.02, 0.113);
    b.box(0.08, 0.02, 0.06, mat('#d9d4cb'), x, 0.02, 0.145);
  }
  bush(b, -0.38, 0.35, 0.04);
  bush(b, 0.38, 0.35, 0.04);
  return b.g;
}

// Menüler ve şehir için hazır evler: 'proc/<tarz>-<kat>-<çeşit>'
const register = (prefix: string, count: number, seed: number, make: (s: number) => THREE.Object3D) =>
  Array.from({ length: count }, (_, k) => {
    const path = `proc/${prefix}-${seed + k}`;
    TOWER_MODELS[path] = () => make(seed + k * 23);
    return path;
  });
export const modernPaths = (floors: number, count: number, seed: number) => register(`modern-${floors}`, count, seed, s => makeModern(s, floors));
export const cycladicPaths = (floors: number, count: number, seed: number) => register(`kiklad-${floors}`, count, seed, s => makeCycladic(s, floors));
export const chaletPaths = (floors: number, count: number, seed: number) => register(`chalet-${floors}`, count, seed, s => makeChalet(s, floors));
export const kyotoPaths = (count: number, seed: number) => register('kyoto-1', count, seed, s => makeKyoto(s));
export const tuscanPaths = (floors: number, count: number, seed: number) => register(`toskana-${floors}`, count, seed, s => makeTuscan(s, floors));
export const rowPaths = (count: number, seed: number) => register('row-2', count, seed, s => makeRowHouses(s));
