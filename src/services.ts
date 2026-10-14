import * as THREE from 'three';
import { FOOTPRINT, type ServiceKind } from './config';
import { part } from './utilities';
import { mergeStatic } from './batcher';
import { KIT } from './towers';
import { signMat } from './signs';
import { SITES, OLD_SITES, drawLot, lotLight, entrance } from './sites';
import { makePolice2, makeFire2 } from './stations';

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

// --- Karakol: iki katlı modern bina, mavi bant ve tabela, girişte saçak, bayrak, anten; önde kendi otoparkı
// (iki polis arabası yeri ve bir ziyaretçi yeri). Polis arabaları devriyeye buradan çıkar, buraya döner ---
function police() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  const site = OLD_SITES.police;
  box(st, 0.96, 0.03, 0.96, M.paving, 0, 0, 0);
  drawLot(st, site, -0.12, 0.48, 0.1, 0.48);
  st.add(part(KIT.facadeBox(0.6, 0.24, 0.36, 0.03), KIT.BAND[1], -0.16, 0.15, -0.26));
  box(st, 0.62, 0.05, 0.38, M.blue, -0.16, 0.15, -0.26);
  box(st, 0.62, 0.025, 0.38, M.white, -0.16, 0.27, -0.26);
  box(st, 0.3, 0.06, 0.012, signMat('POLİS', '#1e4fa3'), -0.05, 0.16, -0.065);
  // Giriş: saçak, kapı, basamak
  const [dx, dz] = site.door;
  box(st, 0.2, 0.012, 0.12, M.blue, dx, 0.17, dz + 0.05);
  box(st, 0.16, 0.012, 0.07, M.white, dx, 0.03, dz + 0.04);
  entrance(st, dx, dz, 0.08, 0.12, M.white);
  // Çatıda anten ve klima, bayrak, ağaç
  add(st, new THREE.CylinderGeometry(0.004, 0.006, 0.28, 6), M.steel, 0.06, 0.43, -0.36);
  box(st, 0.1, 0.05, 0.08, M.steel, -0.3, 0.295, -0.34);
  flag(st, -0.42, 0.3, 0.42, '#d32f2f');
  tree(st, -0.36, 0.4, 0.8);
  g.add(mergeStatic([st]));
  blinkers(g, 0.31, -0.16, -0.26);
  return g;
}

// --- İtfaiye: tuğla bina, iki büyük açık garaj kapısı (itfaiye araçları içeri girip çıkar), hortum kulesi,
// tabela; yanda çalışan kapısı ---
function fireStation() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  const site = OLD_SITES.fire;
  box(st, 0.96, 0.03, 0.96, M.paving, 0, 0, 0);
  box(st, 0.62, 0.004, 0.38, M.asphalt, -0.06, 0.03, 0.29);
  for (const [x] of site.garages!) for (const s of [-1, 1]) box(st, 0.006, 0.0012, 0.34, M.yellow, x + s * 0.1, 0.034, 0.29);
  st.add(part(KIT.facadeBox(0.62, 0.3, 0.42, 0.03), KIT.BRICK[0], -0.06, 0.18, -0.12));
  box(st, 0.64, 0.03, 0.44, M.white, -0.06, 0.33, -0.12);
  // Açık garaj kapıları: beyaz çerçeve, karanlık iç (araç girince kaybolur), üstte toplanmış kepenk
  for (const [x, z] of site.garages!) {
    box(st, 0.22, 0.2, 0.01, M.white, x, 0.03, z);
    box(st, 0.19, 0.18, 0.012, M.dark, x, 0.03, z + 0.003);
    box(st, 0.2, 0.02, 0.02, pm('#e57373', 0.6), x, 0.2, z + 0.012);
  }
  box(st, 0.4, 0.06, 0.012, signMat('İTFAİYE', '#c62828'), -0.06, 0.25, 0.1);
  entrance(st, site.door[0], site.door[1], 0.06, 0.12, M.white);
  // Hortum kurutma kulesi
  st.add(part(KIT.facadeBox(0.14, 0.62, 0.14, 0.03), KIT.BRICK[0], 0.36, 0.34, -0.3));
  add(st, new THREE.ConeGeometry(0.12, 0.1, 4).rotateY(Math.PI / 4), M.dark, 0.36, 0.7, -0.3);
  flag(st, 0.42, 0.36, 0.4, '#d32f2f');
  g.add(mergeStatic([st]));
  blinkers(g, 0.37, -0.06, -0.12);
  return g;
}

// --- Hastane (2x2, dünya ölçüsünde): beş katlı ana blok (kırmızı haç, tabela, çatıda helikopter pisti), camlı
// acil kanadı, ana girişte kırmızı saçak; önde meydan (ağaçlar, banklar, çiçeklikler) ve otopark: ziyaretçi yerleri,
// acil girişinin önünde iki ambulans yeri ---
function hospital(level = 0) {
  const st = new THREE.Group();
  st.scale.setScalar(1 / 1.92);
  const site = SITES.health;
  box(st, 1.92, 0.03, 1.92, M.paving, 0, 0, 0);
  drawLot(st, site, -0.94, 0.94, 0.1, 0.96);
  // Ana blok (x -0.9..0.1, z -0.9..-0.3); yükseltildikçe bir kat daha
  const H = 0.95 + level * 0.16;
  st.add(part(KIT.facadeBox(1.0, H, 0.6, 0.03), KIT.BAND[0], -0.4, 0.03 + H / 2, -0.6));
  box(st, 1.02, 0.03, 0.62, M.white, -0.4, 0.03 + H, -0.6);
  // Kırmızı haç ve tabela (ön yüzde)
  box(st, 0.22, 0.07, 0.012, M.red, -0.4, 0.8, -0.296);
  box(st, 0.07, 0.22, 0.012, M.red, -0.4, 0.725, -0.296);
  box(st, 0.5, 0.08, 0.012, signMat('HASTANE', '#ffffff', '#c62828'), -0.4, 0.6, -0.295);
  // Çatıda helikopter pisti
  const py = 0.03 + H + 0.03;
  add(st, new THREE.CylinderGeometry(0.24, 0.24, 0.016, 28), pm('#4b545e', 0.8), -0.4, py + 0.008, -0.6);
  add(st, new THREE.CylinderGeometry(0.21, 0.21, 0.018, 28, 1, true), M.yellow, -0.4, py + 0.009, -0.6);
  for (const dx of [-0.06, 0.06]) box(st, 0.028, 0.004, 0.16, M.white, -0.4 + dx, py + 0.016, -0.6);
  box(st, 0.12, 0.004, 0.028, M.white, -0.4, py + 0.016, -0.6);
  // Acil kanadı (x 0.16..0.9, z -0.84..-0.28): camlı, üstünde ACİL tabelası
  st.add(part(KIT.facadeBox(0.74, 0.5, 0.56, 0.03), KIT.GLASS[3], 0.53, 0.28, -0.56));
  box(st, 0.76, 0.02, 0.58, M.white, 0.53, 0.53, -0.56);
  box(st, 0.3, 0.07, 0.012, signMat('ACİL', '#c62828'), 0.55, 0.42, -0.274);
  // Acil girişi: kırmızı saçak (ambulans yerlerinin önünde) ve kapı
  box(st, 0.4, 0.016, 0.16, M.red, 0.55, 0.22, -0.2);
  for (const x of [0.37, 0.73]) add(st, new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6), M.steel, x, 0.13, -0.13);
  entrance(st, 0.55, -0.28, 0.12, 0.16, M.white);
  // Ana giriş: kırmızı saçak ve iki sütun, kapı
  const [dx, dz] = site.door;
  box(st, 0.34, 0.018, 0.22, M.red, dx, 0.24, dz + 0.11);
  for (const s of [-1, 1]) add(st, new THREE.CylinderGeometry(0.01, 0.01, 0.22, 8), M.white, dx + s * 0.15, 0.14, dz + 0.2);
  entrance(st, dx, dz, 0.14, 0.17, M.white);
  // Meydan: ağaçlar, banklar, çiçeklikler (kapıya giden yollar açık)
  for (const [x, z] of [[-0.8, -0.18], [-0.05, -0.18]] as [number, number][]) {
    box(st, 0.18, 0.02, 0.12, M.grass, x, 0.03, z);
    tree(st, x, z, 1.1);
  }
  for (const x of [-0.65, -0.18]) box(st, 0.12, 0.012, 0.03, M.wood, x, 0.05, -0.02);
  for (const x of [-0.65, -0.18]) for (const s of [-1, 1]) box(st, 0.008, 0.02, 0.025, M.dark, x + s * 0.05, 0.03, -0.02);
  lotLight(st, -0.935, 0.6);
  lotLight(st, 0.935, 0.6);
  return mergeStatic([st]);
}

// --- Okul (2x2, dünya ölçüsünde): iki katlı tuğla bina (sütunlu giriş, saat, tabela), önünde okul bahçesi
// (basketbol sahası, bayrak direği, banklar), sağda koşu pisti ve futbol sahası, önde öğretmenlerin otoparkı ---
function school(level = 0) {
  const st = new THREE.Group();
  st.scale.setScalar(1 / 1.92);
  const site = SITES.school;
  box(st, 1.92, 0.03, 1.92, M.grass, 0, 0, 0);
  // Okul bahçesi (taş zemin) ve otopark (solda, önde)
  box(st, 1.1, 0.004, 0.62, M.paving, -0.37, 0.03, -0.17);
  drawLot(st, site, -0.94, 0.14, 0.1, 0.96);
  // Bina (x -0.92..0.18, z -0.92..-0.48)
  const W = 1.1, D = 0.44, H = 0.36 + level * 0.13, cx = -0.37, cz = -0.7, front = cz + D / 2; // yükseldikçe kat çıkar
  st.add(part(KIT.facadeBox(W, H, D, 0.03), KIT.BRICK[1], cx, 0.03 + H / 2, cz));
  box(st, W + 0.02, 0.025, D + 0.02, M.white, cx, 0.03 + H, cz);
  // Giriş: beyaz sütunlar ve alınlık, saat, tabela, kapı
  const [dx, dz] = site.door;
  for (const s of [-1, 1]) add(st, new THREE.CylinderGeometry(0.014, 0.016, 0.24, 10), M.white, dx + s * 0.11, 0.15, dz + 0.07);
  box(st, 0.3, 0.025, 0.1, M.white, dx, 0.27, dz + 0.05);
  const tri = new THREE.Shape([new THREE.Vector2(-0.16, 0), new THREE.Vector2(0.16, 0), new THREE.Vector2(0, 0.07)]);
  add(st, new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false }), M.white, dx, 0.295, dz);
  add(st, new THREE.CylinderGeometry(0.04, 0.04, 0.01, 18).rotateX(Math.PI / 2), M.white, dx, 0.33, front + 0.006);
  add(st, new THREE.CylinderGeometry(0.032, 0.032, 0.012, 18).rotateX(Math.PI / 2), M.dark, dx, 0.33, front + 0.008);
  box(st, 0.34, 0.06, 0.012, signMat('OKUL', '#ef6c00'), cx + 0.36, 0.26, front + 0.007);
  entrance(st, dx, dz, 0.12, 0.17, M.white);
  // Basketbol sahası, bayrak direği, banklar
  box(st, 0.4, 0.006, 0.3, M.court, -0.7, 0.034, -0.2);
  box(st, 0.4, 0.002, 0.008, M.line, -0.7, 0.04, -0.2);
  for (const x of [-0.88, -0.52]) {
    add(st, new THREE.CylinderGeometry(0.004, 0.004, 0.14, 4), M.steel, x, 0.1, -0.2);
    box(st, 0.004, 0.04, 0.06, M.white, x + (x < -0.7 ? 0.008 : -0.008), 0.14, -0.2);
  }
  flag(st, 0.08, -0.4, 0.55, '#d32f2f');
  for (const x of [-0.15, 0.02]) box(st, 0.12, 0.014, 0.03, M.wood, x, 0.05, -0.1);
  // Koşu pisti ve futbol sahası (sağda, boydan boya)
  box(st, 0.7, 0.006, 1.84, M.track, 0.57, 0.03, 0);
  box(st, 0.54, 0.008, 1.66, M.grass, 0.57, 0.033, 0);
  box(st, 0.54, 0.002, 0.008, M.line, 0.57, 0.042, 0);
  for (const z of [-0.8, 0.8]) box(st, 0.16, 0.06, 0.008, M.white, 0.57, 0.04, z);
  tree(st, 0.1, 0.5, 1.1);
  tree(st, 0.12, 0.85, 1.0);
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

// fp: kapladığı alan (karakol ve itfaiye 2x2 ve otoparklı; eski kayıtlarda kalan 1x1 olanlar eski çizimiyle)
// level: yükseltme seviyesi (bina kat çıkar)
export function makeService(kind: ServiceKind, fp = FOOTPRINT[kind] ?? 1, level = 0): THREE.Object3D {
  if (kind === 'police') return fp === 2 ? makePolice2(level) : police();
  if (kind === 'fire') return fp === 2 ? makeFire2(level) : fireStation();
  if (kind === 'health') return hospital(level);
  return school(level);
}

// Polis ve itfaiye ışıkları sırayla yanıp sönsün
export function animateService(obj: THREE.Object3D, time: number) {
  const blink = obj.userData.blink as THREE.MeshStandardMaterial[] | undefined;
  if (!blink) return;
  const on = Math.floor(time * 3) % 2;
  blink[0].emissiveIntensity = on ? 1.5 : 0;
  blink[1].emissiveIntensity = on ? 0 : 1.5;
}
