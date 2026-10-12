import * as THREE from 'three';
import { BOAT_MODELS, type IndustryKind } from './config';
import { part, windowMat, showcaseMat } from './utilities';
import { makeModel } from './assets';
import { mergeStatic } from './batcher';
import { KIT } from './towers';
import { carModel } from './cars';

// Sanayi ve dükkanlar gökdelenler gibi ayrıntılı çizilir: testere dişi çatılı fabrika, depo, tabelalı dükkanlar
// (hırdavatçı, pazar, mobilyacı, fırın, butik) ve konteyner vinçli liman. Ön yüz +z (yola bakar).

const pm = (color: string, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const M = {
  asphalt: pm('#5b6170', 0.9),
  concrete: pm('#d8d5ce', 0.95),
  paving: pm('#cfd3d8', 0.9),
  steel: pm('#9aa5b1', 0.4, 0.6),
  darkSteel: pm('#55606c', 0.5, 0.5),
  dark: pm('#2f3640', 0.5),
  white: pm('#f6f6f4', 0.6),
  yellow: pm('#f2c14e', 0.6),
  wood: pm('#b07a45', 0.8),
  crate: pm('#c8955a', 0.9),
  grass: pm('#6cbd55', 1),
  hedge: pm('#4f9a3e', 1),
  roof: pm('#59636f', 0.7),
};
const add = (g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
  const o = part(geo, m, x, y, z);
  g.add(o);
  return o;
};
// Kutu: y alt kenar
const box = (g: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => add(g, new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z);

// Yazılı tabela dokusu
function signMat(text: string, bg: string, fg = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = bg;
  x.fillRect(0, 0, 256, 64);
  x.fillStyle = fg;
  x.font = 'bold 34px Fredoka, Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
}
// Oluklu konteyner dokusu (rengi malzemeden)
const ribTex = (() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const x = c.getContext('2d')!;
  for (let k = 0; k < 64; k += 4) {
    x.fillStyle = (k / 4) % 2 ? '#d0d0d0' : '#ffffff';
    x.fillRect(k, 0, 4, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
})();
const CONTAINERS = ['#c62828', '#1565c0', '#2e7d32', '#ef6c00', '#6a1b9a', '#00838f', '#f9a825'].map(c => new THREE.MeshStandardMaterial({ color: c, map: ribTex, roughness: 0.6, metalness: 0.2 }));
function container(g: THREE.Object3D, x: number, y: number, z: number, k: number, rot = 0) {
  const o = add(g, new THREE.BoxGeometry(0.11, 0.05, 0.24), CONTAINERS[k % CONTAINERS.length], x, y + 0.025, z);
  o.rotation.y = rot;
  return o;
}
// Testere dişi çatı: sıra sıra eğik yüzler, dik tarafları cam
function sawtooth(g: THREE.Object3D, w: number, d: number, y: number, x0: number, z0: number, teeth: number) {
  const step = d / teeth;
  for (let k = 0; k < teeth; k++) {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(step, 0);
    s.lineTo(step, 0.07);
    s.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-w / 2, 0, 0);
    add(g, geo, M.roof, x0, y, z0 - d / 2 + k * step + step);
    add(g, new THREE.BoxGeometry(w - 0.01, 0.06, 0.006), windowMat, x0, y + 0.032, z0 - d / 2 + (k + 1) * step - 0.002);
  }
}
// Bacadan duman (fabrika çalışırken görünür)
function smoke(g: THREE.Group, base: THREE.Vector3) {
  const puffs: THREE.Mesh[] = [];
  for (let p = 0; p < 3; p++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: '#e8e8e8', transparent: true, opacity: 0.8, depthWrite: false }));
    m.userData.phase = p / 3;
    m.visible = false;
    puffs.push(m);
    g.add(m);
  }
  g.userData.smoke = { puffs, base };
}

// --- Fabrika (2x2): üretim holü (testere dişi çatı), ofis bloğu, silolar, baca, yükleme rampası, kamyon ---
function factory(variant: number) {
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, M.asphalt, 0, 0, 0);
  for (let k = 0; k < 4; k++) box(st, 0.008, 0.002, 0.12, M.yellow, 0.12 + k * 0.08, 0.03, 0.36);
  const wall = KIT.METAL[variant % 3];
  // Üretim holü
  st.add(part(KIT.facadeBox(0.6, 0.2, 0.5, 0.03), wall, -0.12, 0.13, -0.12));
  box(st, 0.62, 0.015, 0.52, M.roof, -0.12, 0.23, -0.12);
  sawtooth(st, 0.6, 0.5, 0.245, -0.12, -0.12, 5);
  // Yükleme kapıları ve rampa
  for (const x of [-0.3, -0.12, 0.06]) {
    box(st, 0.12, 0.12, 0.008, pm('#d9dde2', 0.5, 0.3), x, 0.03, 0.135);
    for (let k = 0; k < 5; k++) box(st, 0.12, 0.003, 0.01, M.steel, x, 0.05 + k * 0.022, 0.138);
  }
  box(st, 0.5, 0.03, 0.08, M.concrete, -0.12, 0.03, 0.18);
  // Ofis bloğu (cam bantlı, öne doğru)
  st.add(part(KIT.facadeBox(0.22, 0.26, 0.18, 0.03), KIT.BAND[variant % 3], 0.34, 0.16, 0.24));
  box(st, 0.23, 0.02, 0.19, M.dark, 0.34, 0.29, 0.24);
  const logo = ['#1565c0', '#c62828', '#2e7d32'][variant % 3];
  box(st, 0.14, 0.04, 0.008, pm(logo, 0.5), 0.34, 0.24, 0.336);
  // Silolar ya da tanklar
  for (let k = 0; k < 3; k++) {
    const x = 0.24 + k * 0.1, z = -0.34;
    add(st, new THREE.CylinderGeometry(0.045, 0.045, 0.32, 16), pm('#e3e6ea', 0.4, 0.5), x, 0.19, z);
    add(st, new THREE.ConeGeometry(0.047, 0.05, 16), pm('#c9cfd6', 0.4, 0.5), x, 0.375, z);
    for (const y of [0.1, 0.2, 0.3]) add(st, new THREE.CylinderGeometry(0.047, 0.047, 0.006, 16), M.steel, x, y, z);
  }
  // Konveyör boru silolardan hole
  const pipe = add(st, new THREE.BoxGeometry(0.3, 0.02, 0.02), M.darkSteel, 0.12, 0.33, -0.34);
  pipe.rotation.z = -0.2;
  // Baca
  const chx = -0.4, chz = -0.38, ch = 0.62;
  add(st, new THREE.CylinderGeometry(0.03, 0.04, ch, 12), pm('#9e8e7e', 0.9), chx, 0.03 + ch / 2, chz);
  add(st, new THREE.CylinderGeometry(0.034, 0.034, 0.03, 12), M.darkSteel, chx, 0.03 + ch - 0.015, chz);
  // Önde kamyon ve paletler
  const truck = carModel('truck', '#eceff1');
  truck.position.set(0.12, 0.03, 0.3);
  truck.rotation.y = Math.PI;
  truck.scale.multiplyScalar(0.62);
  st.add(truck);
  for (let k = 0; k < 3; k++) box(st, 0.06, 0.02, 0.06, M.wood, -0.36 + k * 0.07, 0.03, 0.4);
  box(st, 0.05, 0.04, 0.05, M.crate, -0.36, 0.05, 0.4);
  g.add(mergeStatic([st]));
  smoke(g, new THREE.Vector3(chx, 0.03 + ch + 0.02, chz));
  return g;
}

// --- Depo: oluklu sac depo, büyük sürgülü kapılar, yükleme rampası, konteynerler ---
function depot(variant: number) {
  const st = new THREE.Group();
  box(st, 0.96, 0.03, 0.96, M.asphalt, 0, 0, 0);
  st.add(part(KIT.facadeBox(0.74, 0.24, 0.46, 0.03), KIT.METAL[variant % 3], 0, 0.15, -0.16));
  // Hafif eğimli çatı
  const roof = add(st, new THREE.BoxGeometry(0.78, 0.02, 0.5), M.roof, 0, 0.28, -0.16);
  roof.rotation.x = 0.06;
  for (const x of [-0.2, 0.2]) add(st, new THREE.CylinderGeometry(0.02, 0.02, 0.03, 8), M.steel, x, 0.305, -0.2);
  for (const x of [-0.22, 0.0, 0.22]) {
    box(st, 0.16, 0.16, 0.008, pm('#e9edf1', 0.5, 0.3), x, 0.03, 0.074);
    for (let k = 0; k < 6; k++) box(st, 0.16, 0.003, 0.01, M.steel, x, 0.05 + k * 0.024, 0.077);
  }
  box(st, 0.7, 0.03, 0.07, M.concrete, 0, 0.03, 0.115);
  box(st, 0.3, 0.05, 0.012, signMat('DEPO', '#37474f'), -0.15, 0.2, 0.08);
  // Konteynerler
  container(st, -0.3, 0.03, 0.34, variant, Math.PI / 2);
  container(st, -0.3, 0.08, 0.34, variant + 2, Math.PI / 2);
  container(st, 0.05, 0.03, 0.34, variant + 4, Math.PI / 2);
  box(st, 0.06, 0.02, 0.06, M.wood, 0.34, 0.03, 0.34);
  return mergeStatic([st]);
}

// Dükkan binası: altta vitrinli dükkan, üstte bir kat (pencereli), tabela, isteğe bağlı tente
function shopBuilding(st: THREE.Object3D, opts: { facade: THREE.Material; sign: THREE.Material; accent: string; awning?: [string, string] }) {
  box(st, 0.96, 0.03, 0.96, M.paving, 0, 0, 0);
  // Üst kat
  st.add(part(KIT.facadeBox(0.72, 0.2, 0.4, 0.2), opts.facade, 0, 0.33, -0.16));
  box(st, 0.74, 0.03, 0.42, M.white, 0, 0.43, -0.16);
  // Zemin kat: koyu çerçeve, büyük vitrin, kapı
  box(st, 0.72, 0.2, 0.4, pm('#3b4450', 0.5), 0, 0.03, -0.16);
  box(st, 0.5, 0.15, 0.006, showcaseMat, -0.08, 0.05, 0.043);
  box(st, 0.1, 0.16, 0.008, pm('#263238', 0.4, 0.3), 0.26, 0.03, 0.044);
  // Tabela
  box(st, 0.5, 0.06, 0.016, opts.sign, -0.04, 0.22, 0.05);
  box(st, 0.74, 0.012, 0.03, pm(opts.accent, 0.6), 0, 0.2, 0.05);
  // Çizgili tente
  if (opts.awning) {
    for (let k = 0; k < 8; k++) {
      const s = add(st, new THREE.BoxGeometry(0.075, 0.008, 0.12), pm(k % 2 ? opts.awning[1] : opts.awning[0], 0.8), -0.29 + k * 0.075, 0.19, 0.1);
      s.rotation.x = 0.35;
    }
  }
}

// --- Hırdavatçı: turuncu tabela, vitrinde aletler, önde kereste yığını ---
function store() {
  const st = new THREE.Group();
  shopBuilding(st, { facade: KIT.BRICK[0], sign: signMat('HIRDAVAT', '#ef6c00'), accent: '#ef6c00' });
  for (let k = 0; k < 4; k++) box(st, 0.05, 0.08, 0.04, pm(['#e53935', '#fdd835', '#1e88e5', '#43a047'][k], 0.6), -0.26 + k * 0.1, 0.05, 0.0);
  for (let k = 0; k < 3; k++) box(st, 0.28, 0.022, 0.06, M.wood, -0.24, 0.03 + k * 0.022, 0.32);
  box(st, 0.1, 0.06, 0.08, pm('#ef6c00', 0.6), 0.28, 0.03, 0.3);
  return mergeStatic([st]);
}

// --- Çiftçi pazarı: kırmızı ambar (beşik çatı), tenteli tezgahlar, sebze kasaları ---
function market() {
  const st = new THREE.Group();
  box(st, 0.96, 0.03, 0.96, M.paving, 0, 0, 0);
  const barn = pm('#b23b2e', 0.85);
  box(st, 0.56, 0.24, 0.32, barn, 0, 0.03, -0.24);
  const s = new THREE.Shape([new THREE.Vector2(-0.31, 0), new THREE.Vector2(0.31, 0), new THREE.Vector2(0.2, 0.09), new THREE.Vector2(0, 0.15), new THREE.Vector2(-0.2, 0.09)]);
  add(st, new THREE.ExtrudeGeometry(s, { depth: 0.36, bevelEnabled: false }), M.dark, 0, 0.27, -0.42);
  box(st, 0.16, 0.17, 0.008, M.white, 0, 0.03, -0.077);
  box(st, 0.13, 0.15, 0.01, M.wood, 0, 0.03, -0.073);
  box(st, 0.36, 0.06, 0.012, signMat('PAZAR', '#2e7d32'), 0, 0.24, -0.075);
  const awnings = ['#43a047', '#e53935', '#fbc02d'];
  const goods = ['#ff8f00', '#7cb342', '#e53935', '#8e24aa'].map(c => pm(c, 0.7));
  awnings.forEach((color, k) => {
    const x = -0.29 + k * 0.29;
    box(st, 0.22, 0.06, 0.13, M.wood, x, 0.03, 0.18);
    for (const dx of [-0.1, 0.1]) box(st, 0.012, 0.2, 0.012, M.steel, x + dx, 0.03, 0.12);
    for (let q = 0; q < 4; q++) {
      const strip = add(st, new THREE.BoxGeometry(0.06, 0.01, 0.17), pm(q % 2 ? '#ffffff' : color, 0.8), x - 0.09 + q * 0.06, 0.24, 0.17);
      strip.rotation.x = 0.3;
    }
    for (let c = 0; c < 3; c++) {
      box(st, 0.06, 0.03, 0.06, M.crate, x - 0.07 + c * 0.07, 0.09, 0.18);
      add(st, new THREE.SphereGeometry(0.022, 8, 6), goods[(k + c) % goods.length], x - 0.07 + c * 0.07, 0.135, 0.18);
    }
  });
  box(st, 0.1, 0.07, 0.07, pm('#e5c46a', 1), 0.38, 0.03, 0.4);
  return mergeStatic([st]);
}

// --- Mobilyacı: büyük vitrinde koltuk ve masa, yanda teslimat kamyoneti ---
function furniture() {
  const st = new THREE.Group();
  shopBuilding(st, { facade: KIT.HOME[1], sign: signMat('MOBİLYA', '#00796b'), accent: '#00796b' });
  const sofa = pm('#c2185b', 0.9);
  box(st, 0.2, 0.04, 0.07, sofa, -0.2, 0.04, 0.0);
  box(st, 0.2, 0.06, 0.02, sofa, -0.2, 0.06, -0.03);
  box(st, 0.07, 0.012, 0.07, M.wood, 0.02, 0.08, 0.0);
  box(st, 0.012, 0.05, 0.012, M.wood, 0.02, 0.03, 0.0);
  const van = carModel('van', '#ffffff');
  van.position.set(0.3, 0.03, 0.3);
  van.rotation.y = Math.PI;
  van.scale.multiplyScalar(0.7);
  st.add(van);
  return mergeStatic([st]);
}

// --- Fırın: çizgili tente, vitrinde ekmek ve pasta, önde kafe masaları ---
function bakery() {
  const st = new THREE.Group();
  shopBuilding(st, { facade: KIT.BRICK[1], sign: signMat('FIRIN', '#6d4c41'), accent: '#6d4c41', awning: ['#6d4c41', '#fff3e0'] });
  const bread = pm('#d9a35b', 0.8);
  for (let k = 0; k < 4; k++) {
    const loaf = add(st, new THREE.CapsuleGeometry(0.016, 0.04, 4, 8), bread, -0.28 + k * 0.07, 0.08, 0.0);
    loaf.rotation.z = Math.PI / 2;
  }
  add(st, new THREE.CylinderGeometry(0.035, 0.035, 0.05, 14), pm('#f8bbd0', 0.7), 0.06, 0.08, 0.0);
  for (const [x, c] of [[-0.3, '#e53935'], [0.3, '#2e7d32']] as [number, string][]) {
    add(st, new THREE.CylinderGeometry(0.035, 0.035, 0.008, 12), M.white, x, 0.09, 0.33);
    add(st, new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6), M.steel, x, 0.13, 0.33);
    add(st, new THREE.ConeGeometry(0.09, 0.04, 10), pm(c, 0.8), x, 0.24, 0.33);
    for (const dz of [-0.06, 0.06]) box(st, 0.03, 0.04, 0.03, M.dark, x, 0.03, 0.33 + dz);
  }
  return mergeStatic([st]);
}

// --- Butik: beyaz modern cephe, pembe tabela, vitrinde mankenler ---
function fashion() {
  const st = new THREE.Group();
  shopBuilding(st, { facade: KIT.GLASS[4], sign: signMat('BUTİK', '#c2185b'), accent: '#c2185b' });
  ['#42a5f5', '#ffb300', '#ab47bc'].forEach((c, k) => {
    const x = -0.24 + k * 0.12;
    add(st, new THREE.CylinderGeometry(0.016, 0.022, 0.09, 8), pm(c, 0.7), x, 0.085, 0.0);
    add(st, new THREE.SphereGeometry(0.014, 8, 6), M.white, x, 0.145, 0.0);
  });
  for (const x of [-0.38, 0.38]) {
    box(st, 0.07, 0.05, 0.07, pm('#9e9e9e', 0.8), x, 0.03, 0.34);
    add(st, new THREE.SphereGeometry(0.045, 8, 6), M.hedge, x, 0.12, 0.34);
  }
  return mergeStatic([st]);
}

// --- Liman (2x2): rıhtım, konteyner vinci, renkli konteyner yığınları, liman binası, yanaşmış gemi. Ön yüz suya bakar ---
function port() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  const k = 1 / (2 * 0.96);
  box(st, 0.98, 0.05, 0.98, pm('#a9afb6', 0.9), 0, 0, 0);
  box(st, 0.98, 0.006, 0.025, M.yellow, 0, 0.05, 0.47);
  for (let b = 0; b < 6; b++) add(st, new THREE.CylinderGeometry(0.011, 0.013, 0.03, 8), M.dark, -0.42 + b * 0.17, 0.065, 0.455);
  // Liman binası
  st.add(part(KIT.facadeBox(0.36, 0.18, 0.2, 0.05), KIT.BAND[1], -0.28, 0.14, -0.36));
  box(st, 0.38, 0.02, 0.22, pm('#1e5fa8', 0.6), -0.28, 0.23, -0.36);
  // Konteyner yığınları
  let n = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const layers = 1 + ((row + col * 2) % 3);
      for (let l = 0; l < layers; l++) container(st, -0.02 + col * 0.13, 0.05 + l * 0.05, -0.32 + row * 0.27, n++);
    }
  }
  // Konteyner vinci (gantry): ayaklar karada, kol suyun üstüne uzanır
  const orange = pm('#f08c00', 0.6);
  for (const x of [-0.16, 0.12]) {
    for (const z of [0.16, 0.42]) box(st, 0.022, 0.42, 0.022, orange, x, 0.05, z);
    box(st, 0.022, 0.022, 0.28, orange, x, 0.24, 0.29);
  }
  box(st, 0.3, 0.035, 0.03, orange, -0.02, 0.45, 0.16);
  box(st, 0.3, 0.035, 0.03, orange, -0.02, 0.45, 0.42);
  for (const x of [-0.08, 0.04]) box(st, 0.02, 0.025, 0.9, orange, x, 0.47, 0.6);
  box(st, 0.12, 0.06, 0.07, pm('#37474f', 0.6), -0.02, 0.44, 0.8);
  box(st, 0.004, 0.14, 0.004, M.dark, -0.02, 0.3, 0.8);
  container(st, -0.02, 0.25, 0.8, 3);
  g.add(mergeStatic([st]));
  // Yanaşmış kargo gemisi (suda, rıhtıma paralel)
  const ship = new THREE.Group();
  const hull = makeModel(BOAT_MODELS[0]);
  hull.scale.multiplyScalar((2.6 / 3.5) * k);
  hull.rotation.y = Math.PI / 2;
  ship.add(hull);
  ship.position.set(0, -0.045, 0.5 + k);
  g.add(ship);
  g.userData.ship = { obj: ship, x: ship.position.x, y: ship.position.y };
  return g;
}

// Liman gemisi: gönderince kalkıp uzaklaşır, bir süre sonra geri gelip yanaşır; hep hafifçe sallanır
export function animatePort(obj: THREE.Object3D, time: number, away: number) {
  const s = obj.userData.ship as { obj: THREE.Object3D; x: number; y: number } | undefined;
  if (!s) return;
  let dx = 0;
  let visible = true;
  if (away < 6) dx = away * away * 0.045;
  else if (away < 26) visible = false;
  else if (away < 32) {
    const t = (32 - away) / 6;
    dx = -t * t * 1.6;
  }
  s.obj.visible = visible;
  s.obj.position.x = s.x + dx;
  s.obj.position.y = s.y + Math.sin(time * 1.4) * 0.005;
  s.obj.rotation.z = Math.sin(time * 1.1) * 0.012;
}

// Eski kayıtlardaki ticaret merkezi (yüklenince iade edilir; çizim için sade bir depo)
function tradeCenter() {
  return depot(1);
}

export function makeIndustry(kind: IndustryKind, variant = 0): THREE.Object3D {
  if (kind === 'trade') return tradeCenter();
  if (kind === 'factory') return factory(variant);
  if (kind === 'store') return store();
  if (kind === 'market') return market();
  if (kind === 'furniture') return furniture();
  if (kind === 'bakery') return bakery();
  if (kind === 'fashion') return fashion();
  if (kind === 'port') return port();
  return depot(variant);
}

// Fabrika çalışıyorsa duman göster
export function setWorking(obj: THREE.Object3D, working: boolean) {
  const smoke = obj.userData.smoke as { puffs: THREE.Mesh[] } | undefined;
  if (smoke) for (const p of smoke.puffs) p.visible = working;
}
