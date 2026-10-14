import * as THREE from 'three';
import { part } from './utilities';
import { makeModel } from './assets';

// Ayrıntılı yapıların ortak parçaları: malzemeler, kutu/silindir/çubuk yardımcıları ve şehir boyundaki
// küçük eşyalar (bank, lamba, ağaç, çiçek tarhı, saksı). Yerel ölçü 1x1 kare; s = 1/n ile küçültülür.

export const pm = (color: string, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
export const M = {
  paving: pm('#d9d4c8', 0.95),
  stone: pm('#ece5d5', 0.85),
  granite: pm('#6d717a', 0.5, 0.1),
  rim: pm('#b9b2a3', 0.9),
  path: pm('#e3d3ad', 1),
  terracotta: pm('#cf8a5e', 0.95),
  lawn: pm('#6cbd55', 1),
  hedge: pm('#4a9a3e', 1),
  soil: pm('#7a5a3c', 1),
  white: pm('#f6f6f4', 0.5),
  steel: pm('#eef1f4', 0.35, 0.5),
  iron: pm('#2f3640', 0.5, 0.4),
  gray: pm('#8d99a6', 0.4, 0.6),
  wood: pm('#a0703f', 0.8),
  darkWood: pm('#6b4a2f', 0.8),
  gold: pm('#e3bd5c', 0.35, 0.7),
  red: pm('#d63a32', 0.6),
  blue: pm('#1e6fd9', 0.6),
  navy: pm('#24406e', 0.6),
  yellow: pm('#f7c948', 0.6),
  teal: pm('#2e8b7a', 0.6),
  slate: pm('#4f5d6e', 0.7),
  bronze: pm('#5f6f5a', 0.45, 0.55),
  rubber: pm('#d9643f', 1),
  sand: pm('#ecd9a6', 1),
  skin: pm('#f1c27d', 0.8),
  reed: pm('#3f7a34', 1),
  pad: pm('#4f9a3e', 0.9),
};
// Ampul: gece yanar (DayNight 'lamp' adlı malzemeleri yakar)
export const BULB = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff3c4', emissiveIntensity: 0 });
BULB.name = 'lamp';
export const BULB_GEO = new THREE.SphereGeometry(0.007, 5, 4);
// Su parlak kalsın (birleştirilince düz renge dönmesin diye hafif ışıklı)
export const WATER = new THREE.MeshStandardMaterial({ color: '#4aa8e0', roughness: 0.12, metalness: 0.15, emissive: '#0b2a3f', emissiveIntensity: 0.5 });
export const SPRAY = new THREE.MeshStandardMaterial({ color: '#eaf8ff', transparent: true, opacity: 0.45, roughness: 0.1, depthWrite: false });
export const PYRAMID = new THREE.MeshStandardMaterial({ color: '#a9dcf2', transparent: true, opacity: 0.55, roughness: 0.08, metalness: 0.4, depthWrite: false });
export const FLOWERS = ['#e53935', '#fdd835', '#ec407a', '#ab47bc', '#ffffff', '#ff7043'].map(c => pm(c, 0.9));
export const FLOWER_GEO = new THREE.OctahedronGeometry(0.012, 0); // çiçek: binlercesi var, sekiz yüzlü yeterli
export const PAINT = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#fb8c00', '#00acc1', '#ec407a'].map(c => pm(c, 0.55));

export type V3 = [number, number, number];
export const UP = new THREE.Vector3(0, 1, 0);
export const add = (g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
  const o = part(geo, m, x, y, z);
  g.add(o);
  return o;
};
// Kutu ve silindir: y alt kenar
export const box = (g: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) =>
  add(g, new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z);
export const cyl = (g: THREE.Object3D, rTop: number, rBot: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 12) =>
  add(g, new THREE.CylinderGeometry(rTop, rBot, h, seg), m, x, y + h / 2, z);
// Çerçeve: w x d dış ölçülü, rim kalınlığında dört kenar; ortası boş kalır (içine su ya da toprak konur).
// Dolu kutunun üstüne ince bir plaka koyunca iki yüz aynı boyda olur ve telefonda titreşir; çerçeve bunu önler.
export function frame(g: THREE.Object3D, w: number, d: number, h: number, rim: number, m: THREE.Material, x: number, y: number, z: number) {
  for (const sz of [-1, 1]) box(g, w, h, rim, m, x, y, z + (sz * (d - rim)) / 2);
  for (const sx of [-1, 1]) box(g, rim, h, d - rim * 2, m, x + (sx * (w - rim)) / 2, y, z);
}
// Havuz: çerçeve ve içinde kenardan drop kadar aşağıda su (su yüzü zeminden de kenardan da ayrı boyda)
export function basin(g: THREE.Object3D, w: number, d: number, h: number, rim: number, m: THREE.Material, water: THREE.Material, x: number, y: number, z: number, drop = 0.006) {
  frame(g, w, d, h, rim, m, x, y, z);
  box(g, w - rim * 2, h - drop, d - rim * 2, water, x, y, z);
}
// İki nokta arasında çubuk
export function rod(g: THREE.Object3D, a: V3, b: V3, r: number, m: THREE.Material, seg = 6) {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const o = add(g, new THREE.CylinderGeometry(r, r, d.length(), seg), m, A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
  return o;
}
// Eşya grubu: konum, dönüş ve ölçek (büyük yapılarda 1/n)
export function item(g: THREE.Object3D, x: number, z: number, rot = 0, s = 1, y = 0.03) {
  const o = new THREE.Group();
  o.position.set(x, y, z);
  o.rotation.y = rot;
  o.scale.setScalar(s);
  g.add(o);
  return o;
}
// Yukarı doğru daralan çatı (mansart): w x d tabandan tw x td tepeye
export function frustum(w: number, d: number, h: number, tw: number, td: number) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < p.count; k++) {
    if (p.getY(k) > 0) p.setXYZ(k, (p.getX(k) * tw) / w, p.getY(k), (p.getZ(k) * td) / d);
  }
  geo.computeVertexNormals();
  return geo;
}

// --- Küçük eşyalar (şehirdeki boyda) ---
// Bank: ahşap oturak ve sırtlık, demir ayaklar; yüzü +z
export function bench(g: THREE.Object3D, x: number, z: number, rot = 0, s = 1) {
  const b = item(g, x, z, rot, s);
  for (let k = 0; k < 3; k++) box(b, 0.09, 0.005, 0.009, M.wood, 0, 0.03, -0.012 + k * 0.011);
  const back = box(b, 0.09, 0.022, 0.005, M.wood, 0, 0.038, -0.021);
  back.rotation.x = -0.2;
  for (const sx of [-0.038, 0.038]) box(b, 0.005, 0.03, 0.03, M.iron, sx, 0, -0.003);
}
// Sokak lambası: ince direk, gece yanan küre (küçük olduğu için az üçgenli)
const LAMP_GEO = new THREE.SphereGeometry(0.014, 8, 5);
export function lamp(g: THREE.Object3D, x: number, z: number, s = 1, h = 0.17) {
  const l = item(g, x, z, 0, s);
  cyl(l, 0.009, 0.011, 0.012, M.iron, 0, 0, 0, 6);
  cyl(l, 0.004, 0.006, h, M.iron, 0, 0, 0, 5);
  add(l, LAMP_GEO, BULB, 0, h + 0.012, 0);
  cyl(l, 0.004, 0.012, 0.008, M.iron, 0, h + 0.024, 0, 6);
}
// Ağaç (hazır çizilmiş ağaç modelleri, köşe renkleriyle birleşir)
export function tree(g: THREE.Object3D, path: string, x: number, z: number, s = 1, rot = 0) {
  const t = makeModel(path);
  t.scale.multiplyScalar(s);
  t.position.set(x, 0.03, z);
  t.rotation.y = rot;
  g.add(t);
}
// Çiçek tarhı: toprak ve renk renk çiçekler
export function flowerBed(g: THREE.Object3D, x: number, z: number, w: number, d: number, seed = 0, y = 0.03) {
  box(g, w, 0.016, d, M.soil, x, y, z);
  const nx = Math.max(2, Math.round(w / 0.032));
  const nz = Math.max(1, Math.round(d / 0.032));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const m = FLOWERS[(i + j * 2 + seed) % FLOWERS.length];
      add(g, FLOWER_GEO, m, x - w / 2 + ((i + 0.5) * w) / nx, y + 0.024, z - d / 2 + ((j + 0.5) * d) / nz);
    }
  }
}
// Yuvarlak çiçeklik (taş saksı)
export function planter(g: THREE.Object3D, x: number, z: number, r: number, seed = 0) {
  cyl(g, r, r * 0.9, 0.03, M.rim, x, 0.03, z, 12);
  cyl(g, r * 0.85, r * 0.85, 0.004, M.soil, x, 0.06, z, 12);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const rr = k === 0 ? 0 : r * 0.55;
    add(g, FLOWER_GEO, FLOWERS[(k + seed) % FLOWERS.length], x + Math.cos(a) * rr, 0.07, z + Math.sin(a) * rr);
  }
}
