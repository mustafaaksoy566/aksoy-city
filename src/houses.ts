import * as THREE from 'three';
import { TOWER_MODELS, KIT } from './towers';

// Evler: konut seviye seviye büyür. 1. seviye bahçeli küçük tek katlı ev, 2. seviye garajlı iki katlı ev,
// 3. seviye küçük apartman; sonrası apartman blokları ve gökdelenler (towers.ts).
// Her seviyede üç model var; model sırası aynı kalır ki ev büyürken aynı renk ailesinde kalsın:
// 0 sıcak (krem duvar, kiremit çatı), 1 serin (açık gri duvar, arduvaz çatı), 2 toprak (kum rengi duvar, kahverengi çatı).
// Yerel ölçü: 1x1 kare, ön yüz +z, taban y = 0.

const cache = new Map<string, THREE.MeshStandardMaterial>();
const mat = (color: string, rough = 0.8, metal = 0) => {
  const key = `${color}|${rough}|${metal}`;
  let m = cache.get(key);
  if (!m) cache.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })));
  return m;
};
const WIN = new THREE.MeshStandardMaterial({ color: '#a8d4ee', roughness: 0.15, metalness: 0.3 });
WIN.name = 'window'; // gece yanar

const FAMILY = [
  { wall: '#f3e2c2', roof: '#b4533a', trim: '#ffffff', door: '#7a4a2e', accent: '#d98c5f' },
  { wall: '#e4ebf2', roof: '#4b5866', trim: '#ffffff', door: '#2f5f8f', accent: '#7fa7c9' },
  { wall: '#e6c79d', roof: '#6b4a37', trim: '#f6efe4', door: '#4f6f3a', accent: '#a9864f' },
];

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
  // Kutu: y alt kenarın yüksekliği
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) => add(new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z, ry);
  return { g, add, box };
}
type B = ReturnType<typeof builder>;

// Beşik çatı: sırt x boyunca (genişlik w, derinlik d, yükseklik h), iki yanda saçak
function gable(w: number, d: number, h: number) {
  const s = new THREE.Shape();
  s.moveTo(-d / 2, 0);
  s.lineTo(0, h);
  s.lineTo(d / 2, 0);
  s.lineTo(-d / 2, 0);
  return new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }).translate(0, 0, -w / 2).rotateY(Math.PI / 2);
}
// Kırma çatı
function hip(w: number, d: number, h: number) {
  return new THREE.ConeGeometry(Math.SQRT1_2, h, 4, 1).rotateY(Math.PI / 4).scale(w, 1, d).translate(0, h / 2, 0);
}
// Pencere: beyaz çerçeve, cam, ortada kayıt; yüzü +z (ry ile döndürülür)
function addWin(b: B, x: number, y: number, z: number, w: number, h: number, trim: THREE.Material, ry = 0) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.016, h + 0.016, 0.008), trim));
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.01), WIN);
  glass.position.z = 0.002;
  g.add(glass);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.005, h, 0.012), trim);
  bar.position.z = 0.003;
  g.add(bar);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, 0.008, 0.02), trim);
  sill.position.set(0, -h / 2 - 0.006, 0.006);
  g.add(sill);
  g.position.set(x, y, z);
  g.rotation.y = ry;
  g.traverse(o => ((o as THREE.Mesh).castShadow = true));
  b.g.add(g);
}
function tree(b: B, x: number, z: number, s = 1, color = '#5aa845') {
  b.add(new THREE.CylinderGeometry(0.011 * s, 0.015 * s, 0.11 * s, 6), mat('#6b4a33'), x, 0.075 * s, z);
  b.add(new THREE.IcosahedronGeometry(0.075 * s, 1), mat(color, 1), x, 0.17 * s, z);
  b.add(new THREE.IcosahedronGeometry(0.055 * s, 1), mat('#78c25a', 1), x + 0.035 * s, 0.215 * s, z - 0.015 * s);
}
function hedge(b: B, w: number, d: number, x: number, z: number) {
  b.box(w, 0.04, d, mat('#4f9a3e', 1), x, 0.02, z);
}
function yard(b: B) {
  b.box(0.96, 0.02, 0.96, mat('#72c05a', 1), 0, 0, 0);
}

// --- 1. seviye: bahçeli küçük ev ---
export function makeCottage(model: number) {
  const f = FAMILY[model % 3];
  const b = builder();
  yard(b);
  const wall = mat(f.wall, 0.9), trim = mat(f.trim, 0.7), roof = mat(f.roof, 0.75);
  const W = 0.46, D = 0.36, H = 0.15;
  const cz = -0.08;
  b.box(W + 0.02, 0.03, D + 0.02, mat('#b9b2a6'), 0, 0.02, cz); // temel
  b.box(W, H, D, wall, 0, 0.05, cz);
  // Çatı: 0 ve 2 beşik, 1 kırma
  if (model % 3 === 1) b.add(hip(W + 0.08, D + 0.08, 0.15), roof, 0, 0.05 + H, cz);
  else b.add(gable(W + 0.08, D + 0.1, 0.16), roof, 0, 0.05 + H, cz);
  // Baca
  b.box(0.05, 0.12, 0.05, mat(model % 3 === 1 ? '#8a8f96' : '#a0543c'), W / 2 - 0.1, 0.05 + H + 0.03, cz - 0.06);
  // Ön cephe: kapı, sundurma, iki pencere
  const front = cz + D / 2 + 0.002;
  b.box(0.075, 0.11, 0.01, mat(f.door, 0.6), 0.02, 0.05, front);
  b.add(new THREE.SphereGeometry(0.006, 6, 4), mat('#d4af37', 0.3, 0.6), 0.045, 0.105, front + 0.008);
  b.box(0.16, 0.012, 0.09, roof, 0.02, 0.18, front + 0.04);
  for (const x of [-0.07, 0.11]) b.add(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), trim, x - 0.0, 0.12, front + 0.08);
  addWin(b, -0.15, 0.12, front + 0.004, 0.08, 0.065, trim);
  addWin(b, 0.17, 0.12, front + 0.004, 0.07, 0.065, trim);
  // Yan pencereler
  for (const s of [-1, 1]) addWin(b, s * (W / 2 + 0.004), 0.12, cz, 0.07, 0.06, trim, s * Math.PI / 2);
  // Bahçe: yol, çit, ağaç, çiçekler, posta kutusu
  b.box(0.08, 0.022, 0.3, mat('#d9cfbc'), 0.02, 0.012, 0.3);
  hedge(b, 0.34, 0.04, -0.27, 0.45);
  hedge(b, 0.34, 0.04, 0.31, 0.45);
  tree(b, model % 2 ? -0.34 : 0.34, -0.3, 1.05);
  for (let k = 0; k < 5; k++) b.add(new THREE.IcosahedronGeometry(0.014, 0), mat(['#ff6f91', '#ffd23f', '#ffffff', '#c77dff', '#ff8a3d'][(k + model) % 5]), -0.24 + k * 0.035, 0.035, 0.18);
  b.box(0.012, 0.07, 0.012, mat('#5d4037'), 0.12, 0.02, 0.43);
  b.box(0.04, 0.03, 0.025, mat(f.accent), 0.12, 0.09, 0.43);
  return b.g;
}

// --- 2. seviye: garajlı iki katlı ev ---
export function makeFamilyHouse(model: number) {
  const f = FAMILY[model % 3];
  const b = builder();
  yard(b);
  const wall = mat(f.wall, 0.9), trim = mat(f.trim, 0.7), roof = mat(f.roof, 0.75), accent = mat(f.accent, 0.8);
  const W = 0.44, D = 0.38, H = 0.3;
  const cx = -0.08, cz = -0.08;
  b.box(W + 0.02, 0.03, D + 0.02, mat('#b9b2a6'), cx, 0.02, cz);
  b.box(W, H, D, wall, cx, 0.05, cz);
  // Kat ayrımı bandı
  b.box(W + 0.012, 0.012, D + 0.012, trim, cx, 0.05 + 0.15, cz);
  if (model % 3 === 1) b.add(hip(W + 0.08, D + 0.08, 0.16), roof, cx, 0.05 + H, cz);
  else b.add(gable(W + 0.08, D + 0.1, 0.17), roof, cx, 0.05 + H, cz);
  // Yanda tek katlı garaj
  const gx = cx + W / 2 + 0.12;
  b.box(0.22, 0.15, 0.32, wall, gx, 0.05, cz + 0.03);
  b.box(0.24, 0.02, 0.34, roof, gx, 0.2, cz + 0.03);
  b.box(0.16, 0.11, 0.01, mat('#eceff1', 0.5), gx, 0.05, cz + 0.19);
  for (let k = 0; k < 4; k++) b.box(0.16, 0.003, 0.012, mat('#b0bec5'), gx, 0.07 + k * 0.025, cz + 0.196);
  // Ön cephe
  const front = cz + D / 2 + 0.002;
  b.box(0.075, 0.12, 0.01, mat(f.door, 0.6), cx - 0.08, 0.05, front);
  b.box(0.12, 0.012, 0.08, roof, cx - 0.08, 0.19, front + 0.035);
  addWin(b, cx + 0.1, 0.13, front + 0.004, 0.1, 0.07, trim);
  for (const x of [cx - 0.12, cx + 0.1]) addWin(b, x, 0.28, front + 0.004, 0.09, 0.07, trim);
  for (const s of [-1, 1]) {
    addWin(b, cx + s * (W / 2 + 0.004), 0.13, cz, 0.07, 0.06, trim, s * Math.PI / 2);
    addWin(b, cx + s * (W / 2 + 0.004), 0.28, cz, 0.07, 0.06, trim, s * Math.PI / 2);
  }
  // Üst katta balkon
  b.box(0.18, 0.012, 0.07, trim, cx + 0.1, 0.235, front + 0.035);
  b.box(0.18, 0.035, 0.006, accent, cx + 0.1, 0.247, front + 0.07);
  // Garaj yolu ve bahçe
  b.box(0.18, 0.022, 0.32, mat('#c9c4b8'), gx, 0.012, 0.3);
  b.box(0.07, 0.022, 0.3, mat('#d9cfbc'), cx - 0.08, 0.012, 0.3);
  hedge(b, 0.3, 0.04, -0.32, 0.45);
  tree(b, -0.38, -0.36, 1.1);
  tree(b, 0.4, -0.38, 0.9, '#4a9a3e');
  b.box(0.1, 0.02, 0.05, mat('#8d6e63'), -0.3, 0.02, 0.22);
  return b.g;
}

// --- 3. seviye: dört katlı küçük apartman (balkonlu, altta giriş, düz çatı) ---
export function makeSmallApartment(model: number) {
  const f = FAMILY[model % 3];
  const b = builder();
  b.box(0.96, 0.02, 0.96, mat('#cfd3d8', 0.9), 0, 0, 0);
  const W = 0.72, D = 0.56, floors = 4;
  const H = KIT.FLOOR * floors;
  const base = 0.03;
  const facade = model % 3 === 2 ? KIT.BRICK[0] : KIT.HOME[model % 3 === 1 ? 2 : 1];
  b.add(KIT.facadeBox(W, H, D, base), facade, 0, base + H / 2, -0.06);
  // Köşelerde renkli çıtalar ve kat bantları
  const accent = mat(f.accent, 0.8), trim = mat(f.trim, 0.7);
  for (const s of [-1, 1]) b.box(0.03, H, 0.03, accent, s * (W / 2 - 0.005), base, -0.06 + D / 2 - 0.005);
  // Balkonlar (ön yüz, her katta iki)
  for (let k = 1; k < floors; k++) {
    const y = base + k * KIT.FLOOR;
    for (const x of [-0.18, 0.18]) {
      b.box(0.22, 0.01, 0.07, trim, x, y, -0.06 + D / 2 + 0.035);
      b.box(0.22, 0.03, 0.005, KIT.T.rail, x, y + 0.01, -0.06 + D / 2 + 0.07);
    }
  }
  // Giriş: saçak, kapı, numara levhası
  b.box(0.2, 0.012, 0.09, accent, 0, base + 0.09, -0.06 + D / 2 + 0.045);
  b.box(0.1, 0.085, 0.01, mat('#3e4a56', 0.4, 0.3), 0, base, -0.06 + D / 2 + 0.003);
  // Çatı: korkuluk duvarı, su deposu, güneş panelleri
  b.box(W + 0.02, 0.03, D + 0.02, trim, 0, base + H, -0.06);
  b.box(0.12, 0.06, 0.12, mat('#9aa3ad', 0.5, 0.3), -0.2, base + H + 0.03, -0.15);
  for (const x of [0.05, 0.22]) {
    const p = b.box(0.14, 0.008, 0.1, mat('#2b3f66', 0.3, 0.4), x, base + H + 0.06, -0.12);
    p.rotation.x = -0.5;
  }
  // Önde çiçeklik ve ağaçlar, yanda bisiklet park yeri
  b.box(0.2, 0.04, 0.06, mat('#9e9e9e'), -0.3, 0.02, 0.38);
  for (let k = 0; k < 4; k++) b.add(new THREE.IcosahedronGeometry(0.016, 0), mat(['#ff6f91', '#ffd23f', '#c77dff', '#ffffff'][k]), -0.37 + k * 0.045, 0.07, 0.38);
  tree(b, 0.38, 0.38, 0.9);
  tree(b, -0.42, -0.42, 0.8, '#4a9a3e');
  return b.g;
}

// Menüler ve şehir için hazır evler: 'proc/<tür>-<model>'
const register = (prefix: string, make: (model: number) => THREE.Object3D) =>
  [0, 1, 2].map(k => {
    const path = `proc/${prefix}-${k}`;
    TOWER_MODELS[path] = () => make(k);
    return path;
  });
export const cottagePaths = () => register('cottage', makeCottage);
export const familyPaths = () => register('family', makeFamilyHouse);
export const smallAptPaths = () => register('smallapt', makeSmallApartment);
