import * as THREE from 'three';
import type { ServiceKind } from './config';
import { part } from './utilities';
import { mergeStatic } from './batcher';
import { KIT } from './towers';
import { signMat } from './signs';
import { carModel } from './cars';

// Hizmet binaları gökdelenler gibi ayrıntılı çizilir: karakol, itfaiye, hastane, okul ve belediye.
// Önlerinde kendi araçları park etmiş; karakol ve itfaiyenin çatısında yanıp sönen ışıklar var.
// Ön yüz +z (yola bakar). Yerel ölçü 1x1 (hastane ve okul 2x2 büyütülür).

const pm = (color: string, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const M = {
  paving: pm('#cfd3d8', 0.9),
  asphalt: pm('#5b6170', 0.9),
  white: pm('#f6f6f4', 0.6),
  dark: pm('#2f3640', 0.5),
  steel: pm('#9aa5b1', 0.4, 0.6),
  glass: pm('#9fd3ea', 0.15, 0.3),
  red: pm('#c62828', 0.7),
  blue: pm('#1e4fa3', 0.6),
  yellow: pm('#f2c14e', 0.6),
  grass: pm('#6cbd55', 1),
  hedge: pm('#4f9a3e', 1),
  wood: pm('#9a6a43', 0.8),
  court: pm('#3f7fbf', 0.9),
  track: pm('#c4583a', 0.9),
  line: pm('#f4f4f0', 0.7),
};
const add = (g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
  const o = part(geo, m, x, y, z);
  g.add(o);
  return o;
};
const box = (g: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => add(g, new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z);

function tree(g: THREE.Object3D, x: number, z: number, s = 1) {
  add(g, new THREE.CylinderGeometry(0.01 * s, 0.014 * s, 0.1 * s, 6), pm('#6b4a33'), x, 0.07 * s, z);
  add(g, new THREE.IcosahedronGeometry(0.07 * s, 1), pm('#5aa845', 1), x, 0.16 * s, z);
  add(g, new THREE.IcosahedronGeometry(0.05 * s, 1), pm('#78c25a', 1), x + 0.03 * s, 0.2 * s, z - 0.01 * s);
}
function flag(g: THREE.Object3D, x: number, z: number, h: number, color: string) {
  add(g, new THREE.CylinderGeometry(0.006, 0.008, h, 6), M.steel, x, 0.03 + h / 2, z);
  box(g, 0.004, 0.07, 0.11, pm(color, 0.8), x, 0.03 + h - 0.08, z + 0.058);
  add(g, new THREE.CircleGeometry(0.018, 12).rotateY(Math.PI / 2), M.white, x + 0.003, 0.03 + h - 0.045, z + 0.045);
}
// Yanıp sönen ışık (karakol, itfaiye)
function blinkers(g: THREE.Group, y: number, x: number, z: number) {
  const red = new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff3b30', emissiveIntensity: 0 });
  const blue = new THREE.MeshStandardMaterial({ color: '#2f80ff', emissive: '#2f80ff', emissiveIntensity: 0 });
  g.add(part(new THREE.BoxGeometry(0.05, 0.03, 0.04), red, x - 0.03, y, z));
  g.add(part(new THREE.BoxGeometry(0.05, 0.03, 0.04), blue, x + 0.03, y, z));
  g.userData.blink = [red, blue];
}

// --- Karakol: iki katlı modern bina, mavi bant ve tabela, bayrak, anten, önde iki polis arabası ---
function police() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.96, 0.03, 0.96, M.paving, 0, 0, 0);
  box(st, 0.4, 0.004, 0.26, M.asphalt, 0.24, 0.03, 0.3);
  for (const x of [0.12, 0.24, 0.36]) box(st, 0.006, 0.002, 0.2, M.line, x, 0.035, 0.3);
  st.add(part(KIT.facadeBox(0.64, 0.24, 0.38, 0.03), KIT.BAND[1], -0.06, 0.15, -0.18));
  box(st, 0.66, 0.05, 0.4, M.blue, -0.06, 0.15, -0.18);
  box(st, 0.66, 0.025, 0.4, M.white, -0.06, 0.27, -0.18);
  box(st, 0.36, 0.06, 0.012, signMat('POLİS', '#1e4fa3'), -0.12, 0.16, 0.025);
  // Giriş: saçak, cam kapı, basamak
  box(st, 0.2, 0.012, 0.1, M.blue, -0.3, 0.13, 0.06);
  box(st, 0.1, 0.1, 0.008, M.glass, -0.3, 0.03, 0.022);
  box(st, 0.16, 0.012, 0.06, M.white, -0.3, 0.03, 0.05);
  // Çatıda anten ve klima
  add(st, new THREE.CylinderGeometry(0.004, 0.006, 0.28, 6), M.steel, 0.16, 0.43, -0.28);
  box(st, 0.1, 0.05, 0.08, M.steel, -0.2, 0.295, -0.26);
  flag(st, -0.42, 0.34, 0.42, '#d32f2f');
  for (const x of [0.12, 0.36]) {
    const car = carModel('police');
    car.position.set(x, 0.03, 0.3);
    car.rotation.y = Math.PI;
    st.add(car);
  }
  tree(st, -0.4, -0.4);
  g.add(mergeStatic([st]));
  blinkers(g, 0.31, -0.06, -0.18);
  return g;
}

// --- İtfaiye: tuğla bina, iki büyük garaj kapısı (biri açık, içinde itfaiye aracı), hortum kulesi, tabela ---
function fireStation() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.96, 0.03, 0.96, M.paving, 0, 0, 0);
  box(st, 0.62, 0.004, 0.3, M.asphalt, -0.06, 0.03, 0.3);
  st.add(part(KIT.facadeBox(0.62, 0.3, 0.42, 0.03), KIT.BRICK[0], -0.06, 0.18, -0.12));
  box(st, 0.64, 0.03, 0.44, M.white, -0.06, 0.33, -0.12);
  // Garaj kapıları: soldaki açık (içi karanlık, araç yarı dışarıda), sağdaki kapalı
  box(st, 0.22, 0.2, 0.01, M.white, -0.2, 0.03, 0.095);
  box(st, 0.19, 0.18, 0.012, M.dark, -0.2, 0.03, 0.098);
  box(st, 0.22, 0.2, 0.01, M.white, 0.08, 0.03, 0.095);
  box(st, 0.19, 0.18, 0.012, M.red, 0.08, 0.03, 0.098);
  for (let k = 0; k < 6; k++) box(st, 0.182, 0.003, 0.014, pm('#e57373', 0.6), 0.08, 0.05 + k * 0.026, 0.1); // çıtalar kapıdan dar (yan yüzler titreşmesin)
  box(st, 0.4, 0.06, 0.012, signMat('İTFAİYE', '#c62828'), -0.06, 0.25, 0.1);
  // Hortum kurutma kulesi
  st.add(part(KIT.facadeBox(0.14, 0.62, 0.14, 0.03), KIT.BRICK[0], 0.36, 0.34, -0.3));
  add(st, new THREE.ConeGeometry(0.12, 0.1, 4).rotateY(Math.PI / 4), M.dark, 0.36, 0.7, -0.3);
  const truck = carModel('fire');
  truck.position.set(-0.2, 0.03, 0.2);
  truck.rotation.y = 0;
  st.add(truck);
  flag(st, 0.42, 0.36, 0.4, '#d32f2f');
  g.add(mergeStatic([st]));
  blinkers(g, 0.37, -0.06, -0.12);
  return g;
}

// --- Hastane (2x2): beyaz ana blok ve kanat, kırmızı haç, giriş saçağı, ambulanslar, çatıda helikopter pisti ---
function hospital() {
  const st = new THREE.Group();
  box(st, 0.98, 0.02, 0.98, M.paving, 0, 0, 0);
  // Ana blok (5 kat) ve alçak kanat
  st.add(part(KIT.facadeBox(0.5, 0.55, 0.36, 0.02), KIT.BAND[0], -0.12, 0.295, -0.2));
  st.add(part(KIT.facadeBox(0.3, 0.25, 0.3, 0.02), KIT.GLASS[3], 0.3, 0.145, -0.16));
  box(st, 0.52, 0.02, 0.38, M.white, -0.12, 0.57, -0.2);
  box(st, 0.32, 0.02, 0.32, M.white, 0.3, 0.27, -0.16);
  // Kırmızı haç ve tabela
  box(st, 0.16, 0.05, 0.012, M.red, -0.12, 0.46, -0.014);
  box(st, 0.05, 0.16, 0.012, M.red, -0.12, 0.405, -0.014);
  box(st, 0.34, 0.06, 0.012, signMat('HASTANE', '#ffffff', '#c62828'), -0.12, 0.33, -0.014);
  // Acil girişi saçağı ve ambulanslar
  box(st, 0.36, 0.02, 0.18, M.red, -0.12, 0.13, 0.08);
  for (const x of [-0.27, 0.03]) add(st, new THREE.CylinderGeometry(0.008, 0.008, 0.11, 6), M.steel, x, 0.075, 0.16);
  box(st, 0.5, 0.004, 0.26, M.asphalt, -0.1, 0.02, 0.32);
  for (const x of [-0.24, 0.0]) {
    const amb = carModel('ambulance');
    amb.position.set(x, 0.02, 0.3);
    amb.rotation.y = Math.PI;
    amb.scale.multiplyScalar(0.55);
    st.add(amb);
  }
  // Çatıda helikopter pisti
  add(st, new THREE.CylinderGeometry(0.14, 0.14, 0.012, 24), pm('#4b545e', 0.8), -0.12, 0.585, -0.2);
  add(st, new THREE.CylinderGeometry(0.12, 0.12, 0.014, 24, 1, true), M.yellow, -0.12, 0.586, -0.2);
  for (const dx of [-0.035, 0.035]) box(st, 0.016, 0.004, 0.09, M.white, -0.12 + dx, 0.59, -0.2);
  box(st, 0.07, 0.004, 0.016, M.white, -0.12, 0.59, -0.2);
  // Bahçe
  box(st, 0.26, 0.012, 0.22, M.grass, 0.32, 0.02, 0.3);
  tree(st, 0.26, 0.3, 0.7);
  tree(st, 0.38, 0.36, 0.6);
  return mergeStatic([st]);
}

// --- Okul (2x2): iki katlı tuğla bina, saat, bayrak, basketbol sahası, koşu pisti ve futbol sahası ---
function school() {
  const st = new THREE.Group();
  box(st, 0.98, 0.02, 0.98, M.grass, 0, 0, 0);
  st.add(part(KIT.facadeBox(0.62, 0.22, 0.24, 0.02), KIT.BRICK[1], -0.16, 0.13, -0.3));
  box(st, 0.64, 0.02, 0.26, M.white, -0.16, 0.24, -0.3);
  // Giriş: beyaz çerçeve, saat, tabela
  box(st, 0.16, 0.26, 0.04, M.white, -0.16, 0.02, -0.17);
  add(st, new THREE.CylinderGeometry(0.035, 0.035, 0.01, 18).rotateX(Math.PI / 2), M.white, -0.16, 0.22, -0.145);
  add(st, new THREE.CylinderGeometry(0.028, 0.028, 0.012, 18).rotateX(Math.PI / 2), M.dark, -0.16, 0.22, -0.143);
  box(st, 0.26, 0.05, 0.01, signMat('OKUL', '#ef6c00'), -0.16, 0.12, -0.148);
  // Basketbol sahası
  box(st, 0.36, 0.006, 0.24, M.court, -0.24, 0.02, 0.12);
  box(st, 0.36, 0.002, 0.006, M.line, -0.24, 0.027, 0.12);
  for (const x of [-0.4, -0.08]) {
    add(st, new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4), M.steel, x, 0.08, 0.12);
    box(st, 0.004, 0.035, 0.05, M.white, x + (x < -0.24 ? 0.008 : -0.008), 0.12, 0.12);
  }
  // Koşu pisti ve futbol sahası
  box(st, 0.4, 0.006, 0.6, M.track, 0.26, 0.02, 0.1);
  box(st, 0.32, 0.008, 0.52, M.grass, 0.26, 0.022, 0.1);
  box(st, 0.32, 0.002, 0.006, M.line, 0.26, 0.031, 0.1);
  for (const z of [-0.15, 0.35]) box(st, 0.08, 0.04, 0.006, M.white, 0.26, 0.03, z);
  flag(st, -0.44, -0.08, 0.5, '#d32f2f');
  tree(st, -0.44, 0.4, 0.8);
  tree(st, 0.44, -0.38, 0.8);
  return mergeStatic([st]);
}

// --- Belediye: taş cepheli, sütunlu, alınlıklı, saatli kubbeli bina; önünde meydan, bayraklar ---
export function makeHall(): THREE.Object3D {
  const st = new THREE.Group();
  box(st, 0.96, 0.03, 0.96, M.paving, 0, 0, 0);
  const marble = pm('#f3eee4', 0.7);
  // Basamaklar
  for (let k = 0; k < 3; k++) box(st, 0.62 - k * 0.04, 0.02, 0.16 - k * 0.03, marble, 0, 0.03 + k * 0.02, 0.12 - k * 0.015);
  // Bina gövdesi
  st.add(part(KIT.facadeBox(0.72, 0.3, 0.4, 0.09), KIT.STONE[0], 0, 0.24, -0.16));
  box(st, 0.76, 0.03, 0.44, marble, 0, 0.39, -0.16);
  // Sütunlar, saçak ve alınlık
  for (const x of [-0.24, -0.08, 0.08, 0.24]) add(st, new THREE.CylinderGeometry(0.022, 0.026, 0.29, 12), marble, x, 0.235, 0.06);
  box(st, 0.6, 0.035, 0.1, marble, 0, 0.38, 0.06);
  const tri = new THREE.Shape([new THREE.Vector2(-0.31, 0), new THREE.Vector2(0.31, 0), new THREE.Vector2(0, 0.11)]);
  add(st, new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false }), marble, 0, 0.415, 0.01);
  box(st, 0.26, 0.04, 0.008, signMat('BELEDİYE', '#8d6e63'), 0, 0.33, 0.113);
  // Kubbe ve saat kulesi
  add(st, new THREE.CylinderGeometry(0.13, 0.13, 0.1, 24), marble, 0, 0.47, -0.18);
  add(st, new THREE.SphereGeometry(0.13, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), pm('#5d8fb8', 0.4, 0.4), 0, 0.52, -0.18);
  add(st, new THREE.CylinderGeometry(0.04, 0.04, 0.01, 18).rotateX(Math.PI / 2), M.white, 0, 0.47, -0.05);
  add(st, new THREE.CylinderGeometry(0.004, 0.006, 0.12, 6), pm('#d4af37', 0.3, 0.6), 0, 0.71, -0.18);
  // Meydanda iki bayrak ve çiçeklikler
  flag(st, -0.4, 0.38, 0.5, '#d32f2f');
  flag(st, 0.4, 0.38, 0.5, '#1e88e5');
  for (const x of [-0.3, 0.3]) {
    box(st, 0.12, 0.03, 0.08, pm('#9e9e9e', 0.8), x, 0.03, 0.3);
    for (let k = 0; k < 3; k++) add(st, new THREE.IcosahedronGeometry(0.018, 0), pm(['#ff6f91', '#ffd23f', '#c77dff'][k], 0.8), x - 0.035 + k * 0.035, 0.075, 0.3);
  }
  return mergeStatic([st]);
}

export function makeService(kind: ServiceKind): THREE.Object3D {
  if (kind === 'police') return police();
  if (kind === 'fire') return fireStation();
  if (kind === 'health') return hospital();
  return school();
}

// Polis ve itfaiye ışıkları sırayla yanıp sönsün
export function animateService(obj: THREE.Object3D, time: number) {
  const blink = obj.userData.blink as THREE.MeshStandardMaterial[] | undefined;
  if (!blink) return;
  const on = Math.floor(time * 3) % 2;
  blink[0].emissiveIntensity = on ? 1.5 : 0;
  blink[1].emissiveIntensity = on ? 0 : 1.5;
}
