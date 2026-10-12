import * as THREE from 'three';
import { PROPS, PARKING_LEVELS } from './config';
import { part, windowMat } from './utilities';
import { mergeStatic } from './batcher';
import { KIT } from './towers';
import { signMat } from './signs';
import { carModel } from './cars';
import { makeAirliner } from './planes';
import { pm, M, BULB, BULB_GEO, PYRAMID, WATER, PAINT, add, box, cyl, rod, item, bench, lamp, tree, flowerBed, planter } from './parts';

// Ulaşım ve şehir yapıları gökdelenler gibi ayrıntılı çizilir: tren garı, otobüs durağı, metro girişi,
// havalimanı, üniversite ve plaj. Ön yüz +z (gar için ray tarafı, plaj için su tarafı).
// Yerel ölçü 1x1; n karelik yapılar n*0.96 kat büyütülür, içlerindeki eşyalar 1/n ile küçültülür.

const SLATE = pm('#56606c', 0.7);
const COPPER = pm('#5fa58f', 0.6, 0.3);
const STRAW = pm('#d8b46a', 1);
const ASPHALT = pm('#4b5058', 0.95);
const CONCRETE = pm('#b9bfc7', 0.9);
const WET_SAND = pm('#e2c27f', 1);
const SAND = pm('#f3dfa6', 1);
const BRICK = pm('#b5573f', 0.9);

// Üçgen çatı: w genişlik (x), d derinlik (z), h yükseklik; tabanı y=0'da
function gable(w: number, d: number, h: number) {
  const sh = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, h)]);
  return new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-w / 2, 0, 0);
}
// Saat kadranı ve akrep-yelkovan (yüz +z'ye bakar)
function clockFace(g: THREE.Object3D, x: number, y: number, z: number, r: number, rot = 0) {
  const f = item(g, x, z, rot, 1, y);
  add(f, new THREE.CylinderGeometry(r, r, 0.006, 20).rotateX(Math.PI / 2), M.white, 0, 0, 0);
  add(f, new THREE.TorusGeometry(r, r * 0.08, 4, 20), M.gold, 0, 0, 0.003);
  box(f, r * 0.12, r * 0.8, 0.003, M.iron, 0, 0, 0.004);
  const h = box(f, r * 0.14, r * 0.55, 0.003, M.iron, 0, 0, 0.005);
  h.rotation.z = -1.2;
}
// Gece ışığı yanan reklam panosu dokusu
const adMat = (() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const x = c.getContext('2d')!;
  const gr = x.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#ff7043');
  gr.addColorStop(1, '#8e24aa');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 128);
  x.fillStyle = '#fff59d';
  x.beginPath();
  x.arc(32, 46, 18, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#ffffff';
  x.font = 'bold 15px Fredoka, Arial, sans-serif';
  x.textAlign = 'center';
  x.fillText('AKSOY', 32, 94);
  x.fillText('CITY', 32, 112);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#000000', roughness: 0.4 });
  m.name = 'window'; // gece yanar
  return m;
})();
// Park etmiş araba (büyük yapılarda s ile küçültülür)
function parked(g: THREE.Object3D, kind: Parameters<typeof carModel>[0], x: number, z: number, rot: number, s: number, color?: string) {
  const c = carModel(kind, color);
  c.position.set(x, 0.03, z);
  c.rotation.y = rot;
  c.scale.multiplyScalar(s);
  g.add(c);
}

// ======================= Tren garı (2x2) =======================
// Tuğla gar binası, ortasında saat kulesi; ray tarafında uzun peron ve çelik-cam saçak, kalkış panosu;
// arka tarafta taksi durağı, lambalar ve ağaçlar.
export function station() {
  const st = new THREE.Group();
  const s = 1 / (2 * 0.96);
  box(st, 0.98, 0.03, 0.98, M.paving, 0, 0, 0);
  // Peron, güvenlik şeridi ve kabartmalı yol
  box(st, 0.98, 0.05, 0.2, M.stone, 0, 0.03, 0.39);
  box(st, 0.98, 0.002, 0.014, M.yellow, 0, 0.08, 0.465);
  box(st, 0.98, 0.002, 0.01, M.rim, 0, 0.08, 0.445);
  // Saçak: direkler, beyaz çatı, cam şerit, alt ışıklar
  for (let k = 0; k < 6; k++) {
    const x = -0.42 + k * 0.168;
    rod(st, [x, 0.08, 0.34], [x, 0.25, 0.34], 0.006, M.steel, 8);
    rod(st, [x, 0.22, 0.34], [x, 0.245, 0.46], 0.004, M.steel, 6);
    add(st, BULB_GEO, BULB, x + 0.084, 0.235, 0.39);
  }
  const roof = box(st, 0.98, 0.012, 0.2, M.white, 0, 0.245, 0.39);
  roof.rotation.x = 0.08;
  box(st, 0.94, 0.004, 0.06, PYRAMID, 0, 0.26, 0.38);
  // Peron eşyaları: banklar, kalkış panosu, gar adı
  for (const x of [-0.336, 0, 0.336]) bench(st, x, 0.345, 0, s);
  box(st, 0.14, 0.035, 0.01, signMat('İZMİR 12:30', '#212121', '#ffb300'), 0.168, 0.19, 0.39);
  rod(st, [0.168, 0.21, 0.39], [0.168, 0.24, 0.39], 0.002, M.iron, 4);
  for (const x of [-0.46, 0.46]) {
    rod(st, [x, 0.08, 0.42], [x, 0.17, 0.42], 0.004, M.iron, 4);
    box(st, 0.004, 0.03, 0.09, signMat('AKSOY', '#1565c0'), x, 0.16, 0.42);
  }
  // Gar binası: tuğla ana salon, taş kuşak, kiremit çatı; yan kanatlar
  st.add(part(KIT.facadeBox(0.5, 0.22, 0.3, 0.03), KIT.BRICK[1], 0, 0.03 + 0.11, -0.06));
  box(st, 0.52, 0.03, 0.32, M.stone, 0, 0.03, -0.06);
  box(st, 0.52, 0.014, 0.32, M.stone, 0, 0.25, -0.06);
  add(st, gable(0.54, 0.34, 0.1), SLATE, 0, 0.264, -0.06);
  for (const sx of [-1, 1]) {
    st.add(part(KIT.facadeBox(0.2, 0.15, 0.24, 0.03), KIT.BRICK[1], sx * 0.35, 0.03 + 0.075, -0.06));
    box(st, 0.22, 0.016, 0.26, M.stone, sx * 0.35, 0.18, -0.06);
    box(st, 0.2, 0.02, 0.24, SLATE, sx * 0.35, 0.196, -0.06);
  }
  // Saat kulesi
  box(st, 0.11, 0.42, 0.11, M.stone, 0, 0.03, 0.1);
  for (let k = 0; k < 4; k++) clockFace(st, Math.sin((k * Math.PI) / 2) * 0.057, 0.38, 0.1 + Math.cos((k * Math.PI) / 2) * 0.057, 0.035, (k * Math.PI) / 2);
  box(st, 0.125, 0.014, 0.125, M.white, 0, 0.45, 0.1);
  add(st, new THREE.ConeGeometry(0.09, 0.1, 4).rotateY(Math.PI / 4), SLATE, 0, 0.514, 0.1);
  add(st, new THREE.SphereGeometry(0.012, 8, 6), M.gold, 0, 0.57, 0.1);
  // Peron girişi (binadan perona geçit) ve kemerli kapı
  box(st, 0.12, 0.12, 0.12, BRICK, 0, 0.03, 0.22);
  box(st, 0.07, 0.09, 0.004, windowMat, 0, 0.04, 0.281);
  // Arka cephe: tabela, giriş saçağı
  box(st, 0.2, 0.04, 0.004, signMat('GAR', '#1565c0'), 0, 0.2, -0.212);
  box(st, 0.24, 0.01, 0.07, M.iron, 0, 0.14, -0.245);
  for (const x of [-0.11, 0.11]) rod(st, [x, 0.03, -0.275], [x, 0.14, -0.275], 0.004, M.iron, 4);
  // Taksi durağı, lambalar, ağaçlar, çiçeklikler
  box(st, 0.5, 0.004, 0.12, ASPHALT, 0.18, 0.03, -0.4);
  parked(st, 'taxi', 0.08, -0.4, Math.PI / 2, s);
  parked(st, 'taxi', 0.28, -0.4, Math.PI / 2, s);
  for (const x of [-0.3, 0.42]) lamp(st, x, -0.3, s);
  tree(st, PROPS.treeLarge, -0.42, -0.42, 0.65 * s, 1);
  tree(st, PROPS.treeSmall, -0.42, 0.2, 0.6 * s, 2);
  tree(st, PROPS.treeSmall, 0.44, 0.2, 0.6 * s, 3);
  planter(st, -0.2, -0.3, 0.04, 1);
  planter(st, 0.2, -0.3, 0.04, 2);
  return mergeStatic([st]);
}

// ======================= Otobüs durağı (1x1) =======================
// Kaldırımda cam duraklı sundurma, içinde bank, ışıklı reklam panosu, "DURAK" tabelası, saat çizelgesi
// ve çöp kutusu; arkada küçük bahçe. Yol tarafı +z.
export function busStop() {
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, M.lawn, 0, 0, 0);
  box(st, 0.98, 0.006, 0.34, M.paving, 0, 0.03, 0.32);
  box(st, 0.98, 0.014, 0.02, M.rim, 0, 0.03, 0.48);
  // Sundurma
  const z = 0.26;
  for (const x of [-0.21, 0.21]) {
    rod(st, [x, 0.036, z - 0.07], [x, 0.25, z - 0.07], 0.006, M.iron, 6);
    rod(st, [x, 0.036, z + 0.07], [x, 0.25, z + 0.07], 0.006, M.iron, 6);
    box(st, 0.004, 0.17, 0.12, PYRAMID, x, 0.06, z);
  }
  box(st, 0.42, 0.17, 0.004, PYRAMID, 0, 0.06, z - 0.07);
  box(st, 0.48, 0.016, 0.19, M.blue, 0, 0.25, z);
  box(st, 0.48, 0.006, 0.004, M.white, 0, 0.255, z + 0.095);
  box(st, 0.3, 0.03, 0.004, signMat('DURAK', '#1565c0'), 0, 0.215, z + 0.072);
  bench(st, 0, z - 0.03, 0);
  // Işıklı reklam panosu ve çizelge
  box(st, 0.1, 0.18, 0.03, M.iron, 0.3, 0.036, z - 0.02);
  box(st, 0.085, 0.15, 0.032, adMat, 0.3, 0.05, z - 0.02);
  box(st, 0.06, 0.08, 0.006, M.white, -0.13, 0.12, z - 0.066);
  // Tabela direği ve çöp kutusu
  rod(st, [-0.32, 0.036, 0.42], [-0.32, 0.34, 0.42], 0.005, M.iron, 6);
  add(st, new THREE.CylinderGeometry(0.04, 0.04, 0.006, 16).rotateX(Math.PI / 2), M.blue, -0.32, 0.32, 0.42);
  add(st, new THREE.CylinderGeometry(0.028, 0.028, 0.007, 16).rotateX(Math.PI / 2), M.white, -0.32, 0.32, 0.42);
  box(st, 0.012, 0.03, 0.008, M.blue, -0.32, 0.305, 0.425);
  cyl(st, 0.022, 0.02, 0.06, M.gray, 0.42, 0.036, 0.3, 10);
  // Arkadaki bahçe
  tree(st, PROPS.treeLarge, -0.3, -0.25, 0.6, 1);
  tree(st, PROPS.treeBlossom, 0.3, -0.3, 0.55, 2);
  tree(st, PROPS.bush, 0.0, -0.36, 0.8, 3);
  flowerBed(st, 0, -0.15, 0.3, 0.06, 2);
  lamp(st, 0.42, 0.44);
  return mergeStatic([st]);
}

// ======================= Metro girişi (1x1) =======================
// Meydanda yerden çıkan kavisli cam tünel (merdiven ve yürüyen merdiven altında), "METRO" totemi,
// havalandırma ızgarası, banklar, ağaçlar ve lambalar.
export function metro(level = 0) {
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, M.paving, 0, 0, 0);
  for (const sx of [-1, 1]) box(st, 0.16, 0.012, 0.96, M.lawn, sx * 0.41, 0.03, 0);
  // Merdiven boşluğu, basamaklar, korkuluklar
  box(st, 0.22, 0.004, 0.36, M.iron, 0, 0.03, -0.02);
  for (let k = 0; k < 8; k++) box(st, 0.2, 0.003, 0.01, M.gray, 0, 0.034, 0.14 - k * 0.042);
  box(st, 0.012, 0.004, 0.34, M.yellow, 0.06, 0.035, -0.02);
  for (const sx of [-1, 1]) box(st, 0.014, 0.05, 0.38, M.granite, sx * 0.118, 0.03, -0.02);
  // Kavisli cam tünel ve çelik kaburgalar
  const tg = item(st, 0, -0.04, 0, 1, 0.03);
  tg.rotation.x = -0.22;
  const R = 0.12;
  add(tg, new THREE.CylinderGeometry(R, R, 0.36, 20, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), PYRAMID, 0, 0, 0);
  for (let k = 0; k <= 6; k++) add(tg, new THREE.TorusGeometry(R, 0.005, 4, 16, Math.PI), M.steel, 0, 0, -0.18 + k * 0.06);
  for (const a of [0.5, Math.PI / 2, Math.PI - 0.5]) {
    const r = add(tg, new THREE.CylinderGeometry(0.004, 0.004, 0.36, 4).rotateX(Math.PI / 2), M.steel, Math.cos(a) * R, Math.sin(a) * R, 0);
    r.castShadow = false;
  }
  // METRO totemi
  box(st, 0.05, 0.36, 0.05, M.granite, 0.25, 0.03, 0.3);
  box(st, 0.16, 0.05, 0.006, signMat('METRO', '#d32f2f'), 0.25, 0.33, 0.33);
  box(st, 0.16, 0.05, 0.006, signMat('METRO', '#d32f2f'), 0.25, 0.33, 0.27);
  // Havalandırma ızgarası, banklar, lambalar, ağaçlar
  box(st, 0.14, 0.03, 0.1, M.granite, -0.22, 0.03, -0.36);
  for (let k = 0; k < 6; k++) box(st, 0.13, 0.004, 0.006, M.iron, -0.22, 0.06, -0.4 + k * 0.016);
  bench(st, 0.22, -0.3, -Math.PI / 2);
  bench(st, -0.22, 0.28, Math.PI / 2);
  lamp(st, 0.25, 0.42);
  lamp(st, -0.05, -0.42);
  tree(st, PROPS.treeLarge, -0.41, -0.3, 0.55, 1);
  tree(st, PROPS.treeLarge, 0.41, 0.0, 0.5, 2);
  tree(st, PROPS.treeSmall, -0.41, 0.36, 0.55, 3);
  tree(st, PROPS.bush, 0.41, -0.4, 0.8, 4);
  // 2. seviye: camlı asansör köşkü ve bisiklet park yeri
  if (level >= 1) {
    box(st, 0.1, 0.17, 0.1, PYRAMID, 0.25, 0.03, -0.12);
    for (const [x, z] of [[0.2, -0.17], [0.3, -0.17], [0.2, -0.07], [0.3, -0.07]] as [number, number][]) box(st, 0.008, 0.17, 0.008, M.iron, x, 0.03, z);
    box(st, 0.11, 0.014, 0.11, M.iron, 0.25, 0.2, -0.12);
    box(st, 0.1, 0.025, 0.004, signMat('METRO', '#d32f2f'), 0.25, 0.15, -0.066);
    for (let k = 0; k < 4; k++) {
      const x = -0.3 + k * 0.05;
      add(st, new THREE.TorusGeometry(0.018, 0.003, 4, 10), PAINT[k], x, 0.055, 0.1).rotation.y = Math.PI / 2;
      add(st, new THREE.TorusGeometry(0.018, 0.003, 4, 10), PAINT[k], x, 0.055, 0.15).rotation.y = Math.PI / 2;
    }
    rod(st, [-0.33, 0.04, 0.125], [-0.12, 0.04, 0.125], 0.003, M.steel, 4);
  }
  // 3. seviye: meydanı örten büyük cam saçak ve yeşil çatılı kenar
  if (level >= 2) {
    for (const [x, z] of [[-0.3, -0.26], [0.3, -0.26], [-0.3, 0.2], [0.3, 0.2]] as [number, number][]) cyl(st, 0.008, 0.01, 0.3, M.steel, x, 0.03, z, 8);
    box(st, 0.66, 0.008, 0.52, PYRAMID, 0, 0.33, -0.03);
    box(st, 0.68, 0.016, 0.03, M.steel, 0, 0.325, -0.29);
    box(st, 0.68, 0.016, 0.03, M.steel, 0, 0.325, 0.23);
    for (let k = 0; k < 5; k++) box(st, 0.008, 0.012, 0.52, M.steel, -0.3 + k * 0.15, 0.326, -0.03);
    for (let k = 0; k < 6; k++) add(st, BULB_GEO, BULB, -0.25 + k * 0.1, 0.32, -0.03);
  }
  return mergeStatic([st]);
}

// Metro hattı (menü resmi): yeşil tepenin altındaki tünel ağzından çıkan metro treni
export function tunnelThumb() {
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, M.paving, 0, 0, 0);
  // Tepe ve tünel ağzı
  box(st, 0.98, 0.3, 0.4, pm('#7a5a3c', 1), 0, 0.03, -0.29);
  box(st, 0.98, 0.04, 0.4, M.lawn, 0, 0.33, -0.29);
  box(st, 0.5, 0.32, 0.04, M.granite, 0, 0.03, -0.08);
  box(st, 0.26, 0.16, 0.05, M.iron, 0, 0.03, -0.08);
  add(st, new THREE.CylinderGeometry(0.13, 0.13, 0.05, 20, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), M.iron, 0, 0.19, -0.08);
  // Raylar ve metro vagonu
  for (const x of [-0.07, 0.07]) box(st, 0.012, 0.012, 0.6, M.gray, x, 0.03, 0.18);
  for (let k = 0; k < 8; k++) box(st, 0.2, 0.008, 0.02, M.darkWood, 0, 0.03, -0.08 + k * 0.075);
  const car = item(st, 0, 0.12, 0, 1, 0.05);
  add(car, new THREE.CapsuleGeometry(0.1, 0.34, 4, 12).rotateX(Math.PI / 2), M.white, 0, 0.1, 0);
  box(car, 0.205, 0.03, 0.4, M.red, 0, 0.08, 0);
  box(car, 0.205, 0.05, 0.36, windowMat, 0, 0.12, 0);
  add(car, new THREE.SphereGeometry(0.02, 8, 6), BULB, -0.05, 0.08, 0.26);
  add(car, new THREE.SphereGeometry(0.02, 8, 6), BULB, 0.05, 0.08, 0.26);
  box(st, 0.16, 0.05, 0.006, signMat('METRO', '#d32f2f'), 0, 0.31, -0.055);
  return mergeStatic([st]);
}

// ======================= Havalimanı (4x4) =======================
// Arkada pist (gece yanan kenar ışıkları), paralel taksi yolu, apronda körüklere yanaşmış uçaklar,
// kavisli çatılı cam terminal, kontrol kulesi, hangar, yakıt tankları, rüzgâr çorabı;
// önde gidiş-geliş yolu ve arabalı otopark. Pistin uçları sky.ts'teki kalkış/iniş için RUNWAY ile verilir.
export const RUNWAY = { x0: -0.44, x1: 0.44, z: -0.3 };
export function airport() {
  const st = new THREE.Group();
  const s = 1 / (4 * 0.96);
  const Z = RUNWAY.z;
  box(st, 0.98, 0.03, 0.98, pm('#8bc96b', 1), 0, 0, 0);
  // Pist: kenar çizgileri, orta kesik çizgi, uçlarda zebra işaretleri ve iniş bölgesi
  box(st, 0.96, 0.004, 0.14, ASPHALT, 0, 0.03, Z);
  for (const dz of [-0.064, 0.064]) box(st, 0.94, 0.002, 0.003, M.white, 0, 0.034, Z + dz);
  for (let k = 0; k < 13; k++) box(st, 0.032, 0.002, 0.004, M.white, -0.34 + k * 0.057, 0.034, Z);
  for (const end of [-1, 1]) {
    for (let k = 0; k < 6; k++) box(st, 0.04, 0.002, 0.008, M.white, end * 0.44, 0.034, Z - 0.05 + k * 0.02);
    for (const dz of [-0.03, 0.03]) box(st, 0.05, 0.002, 0.012, M.white, end * 0.35, 0.034, Z + dz);
  }
  for (let k = 0; k < 11; k++) {
    for (const dz of [-0.072, 0.072]) add(st, BULB_GEO, BULB, -0.46 + k * 0.092, 0.036, Z + dz);
  }
  // Taksi yolu ve bağlantılar (sarı orta çizgi)
  box(st, 0.84, 0.004, 0.04, ASPHALT, 0, 0.03, -0.16);
  box(st, 0.84, 0.002, 0.003, M.yellow, 0, 0.034, -0.16);
  for (const x of [-0.4, 0.4]) {
    box(st, 0.04, 0.004, 0.1, ASPHALT, x, 0.03, -0.2);
    box(st, 0.003, 0.002, 0.1, M.yellow, x, 0.034, -0.2);
  }
  // Apron ve park yerleri, uçaklar, körükler
  box(st, 0.74, 0.005, 0.24, CONCRETE, -0.07, 0.03, 0.02);
  const stands = [-0.3, -0.06, 0.18];
  stands.forEach((x, k) => {
    box(st, 0.003, 0.002, 0.2, M.yellow, x, 0.036, 0.0);
    const p = makeAirliner([0, 2, 1][k]);
    p.scale.setScalar(0.08);
    p.position.set(x, 0.055, 0.0);
    st.add(p);
    box(st, 0.022, 0.022, 0.07, M.white, x - 0.035, 0.05, 0.13);
    box(st, 0.026, 0.03, 0.02, M.gray, x - 0.035, 0.045, 0.095);
    rod(st, [x - 0.035, 0.03, 0.1], [x - 0.035, 0.05, 0.1], 0.004, M.gray, 4);
  });
  // Terminal: cam cephe, kavisli çatı, tabela
  st.add(part(KIT.facadeBox(0.7, 0.08, 0.15, 0.03), KIT.GLASS[2], -0.07, 0.03 + 0.04, 0.24));
  const vault = new THREE.CylinderGeometry(0.3, 0.3, 0.74, 28, 1, true, -0.3, 0.6).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
  add(st, vault, M.steel, -0.07, 0.11 - 0.3 * Math.cos(0.3), 0.24);
  box(st, 0.74, 0.008, 0.18, M.white, -0.07, 0.108, 0.24);
  box(st, 0.3, 0.035, 0.004, signMat('HAVALİMANI', '#0d47a1'), -0.07, 0.07, 0.317);
  box(st, 0.5, 0.008, 0.05, M.white, -0.07, 0.08, 0.34);
  // Kontrol kulesi
  cyl(st, 0.016, 0.024, 0.3, M.white, 0.38, 0.03, 0.26, 12);
  add(st, new THREE.CylinderGeometry(0.05, 0.034, 0.045, 8), windowMat, 0.38, 0.355, 0.26);
  cyl(st, 0.056, 0.056, 0.01, M.iron, 0.38, 0.378, 0.26, 8);
  rod(st, [0.38, 0.388, 0.26], [0.38, 0.44, 0.26], 0.003, M.iron, 4);
  add(st, new THREE.SphereGeometry(0.006, 6, 4), PAINT[0], 0.38, 0.443, 0.26);
  // Hangar: kemerli çatı, açık kapı
  const hx = 0.39, hz = -0.03;
  add(st, new THREE.CylinderGeometry(0.08, 0.08, 0.16, 18, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), M.gray, hx, 0.03, hz);
  box(st, 0.12, 0.06, 0.004, M.iron, hx, 0.03, hz + 0.082);
  // Yakıt tankları, rüzgâr çorabı
  for (const z of [0.1, 0.17]) cyl(st, 0.03, 0.03, 0.04, M.white, 0.44, 0.03, z, 14);
  rod(st, [-0.46, 0.03, -0.18], [-0.46, 0.12, -0.18], 0.003, M.iron, 4);
  add(st, new THREE.ConeGeometry(0.012, 0.05, 8).rotateZ(Math.PI / 2), PAINT[5], -0.435, 0.115, -0.18);
  // Gidiş-geliş yolu ve otopark
  box(st, 0.98, 0.004, 0.08, ASPHALT, 0, 0.03, 0.4);
  for (let k = 0; k < 14; k++) box(st, 0.03, 0.002, 0.003, M.white, -0.45 + k * 0.07, 0.034, 0.4);
  box(st, 0.36, 0.004, 0.07, ASPHALT, -0.2, 0.03, 0.47);
  for (let k = 0; k < 7; k++) box(st, 0.003, 0.002, 0.05, M.white, -0.36 + k * 0.053, 0.034, 0.47);
  const cars: [Parameters<typeof carModel>[0], number][] = [['sedan', -0.335], ['suv', -0.23], ['hatch', -0.18], ['taxi', -0.07]];
  for (const [kind, x] of cars) parked(st, kind, x, 0.47, 0, s);
  parked(st, 'taxi', 0.1, 0.4, Math.PI / 2, s);
  // Ağaçlar
  for (const x of [0.06, 0.16, 0.26, 0.36, 0.46]) tree(st, PROPS.treeSmall, x, 0.47, 0.6 * s, x * 9);
  tree(st, PROPS.treeLarge, 0.46, 0.33, 0.6 * s, 2);
  return mergeStatic([st]);
}

// ======================= Üniversite (3x3) =======================
// Arkada kubbeli, sütunlu taş rektörlük; solda camlı kütüphane, sağda tuğla fakülte binası,
// arada çan kulesi; ortada ağaçlı çimen avlu, çeşme ve heykel; önde kapı ve tabela.
export function university() {
  const st = new THREE.Group();
  const s = 1 / (3 * 0.96);
  box(st, 0.98, 0.03, 0.98, M.lawn, 0, 0, 0);
  box(st, 0.08, 0.004, 0.66, M.path, 0, 0.03, 0.15);
  box(st, 0.62, 0.004, 0.06, M.path, 0, 0.03, 0.06);
  box(st, 0.7, 0.004, 0.06, M.path, 0, 0.03, -0.17);
  // Rektörlük: taş cephe, sütunlu giriş, alınlık, kubbe
  st.add(part(KIT.facadeBox(0.62, 0.2, 0.2, 0.03), KIT.STONE[0], 0, 0.03 + 0.1, -0.34));
  box(st, 0.64, 0.016, 0.22, M.stone, 0, 0.23, -0.34);
  box(st, 0.62, 0.014, 0.2, SLATE, 0, 0.246, -0.34);
  for (let k = 0; k < 3; k++) box(st, 0.26 - k * 0.02, 0.01, 0.04, M.stone, 0, 0.03 + k * 0.01, -0.2 - k * 0.01);
  for (let k = 0; k < 6; k++) cyl(st, 0.009, 0.011, 0.17, M.white, -0.1 + k * 0.04, 0.06, -0.215, 10);
  box(st, 0.24, 0.022, 0.05, M.stone, 0, 0.23, -0.22);
  const tri = new THREE.Shape([new THREE.Vector2(-0.125, 0), new THREE.Vector2(0.125, 0), new THREE.Vector2(0, 0.05)]);
  add(st, new THREE.ExtrudeGeometry(tri, { depth: 0.05, bevelEnabled: false }), M.stone, 0, 0.252, -0.245);
  box(st, 0.18, 0.02, 0.003, signMat('ÜNİVERSİTE', '#37474f', '#ffe082'), 0, 0.232, -0.194);
  cyl(st, 0.07, 0.07, 0.06, M.stone, 0, 0.26, -0.34, 20);
  add(st, new THREE.SphereGeometry(0.075, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), COPPER, 0, 0.32, -0.34);
  cyl(st, 0.012, 0.016, 0.04, M.stone, 0, 0.39, -0.34, 8);
  add(st, new THREE.SphereGeometry(0.01, 8, 6), M.gold, 0, 0.435, -0.34);
  // Kütüphane: cam kutu, saçaklı düz çatı
  st.add(part(KIT.facadeBox(0.24, 0.14, 0.3, 0.03), KIT.GLASS[2], -0.33, 0.03 + 0.07, 0.12));
  box(st, 0.28, 0.012, 0.34, M.white, -0.33, 0.17, 0.12);
  box(st, 0.004, 0.025, 0.16, signMat('KÜTÜPHANE', '#00695c'), -0.208, 0.13, 0.12);
  // Fakülte: tuğla, üçgen çatı
  st.add(part(KIT.facadeBox(0.24, 0.17, 0.32, 0.03), KIT.BRICK[0], 0.33, 0.03 + 0.085, 0.12));
  box(st, 0.25, 0.012, 0.33, M.stone, 0.33, 0.2, 0.12);
  const fr = add(st, gable(0.34, 0.26, 0.07), SLATE, 0.33, 0.212, 0.12);
  fr.rotation.y = Math.PI / 2;
  // Çan kulesi
  box(st, 0.07, 0.34, 0.07, BRICK, 0.3, 0.03, -0.17);
  box(st, 0.08, 0.05, 0.08, M.stone, 0.3, 0.33, -0.17);
  for (let k = 0; k < 4; k++) clockFace(st, 0.3 + Math.sin((k * Math.PI) / 2) * 0.036, 0.3, -0.17 + Math.cos((k * Math.PI) / 2) * 0.036, 0.022, (k * Math.PI) / 2);
  add(st, new THREE.ConeGeometry(0.06, 0.09, 4).rotateY(Math.PI / 4), COPPER, 0.3, 0.425, -0.17);
  // Avlu: çeşme, heykel, ağaçlar, banklar, lambalar
  cyl(st, 0.06, 0.065, 0.02, M.rim, 0, 0.03, 0.06, 16);
  cyl(st, 0.05, 0.05, 0.004, WATER, 0, 0.05, 0.06, 16);
  cyl(st, 0.008, 0.01, 0.05, M.stone, 0, 0.05, 0.06, 8);
  box(st, 0.03, 0.04, 0.03, M.granite, -0.13, 0.03, -0.12);
  cyl(st, 0.008, 0.01, 0.04, M.bronze, -0.13, 0.07, -0.12, 8);
  add(st, new THREE.SphereGeometry(0.008, 8, 6), M.bronze, -0.13, 0.118, -0.12);
  for (const z of [0.2, 0.32, 0.44]) {
    for (const sx of [-1, 1]) tree(st, PROPS.treeLarge, sx * 0.1, z, 0.55 * s, z * 10 + sx);
  }
  for (const sx of [-1, 1]) {
    bench(st, sx * 0.16, 0.0, (-sx * Math.PI) / 2, s);
    lamp(st, sx * 0.06, 0.26, s);
    lamp(st, sx * 0.06, 0.4, s);
    tree(st, PROPS.treePine, sx * 0.44, -0.44, 0.6 * s, sx);
  }
  // Kapı ve tabela
  for (const sx of [-1, 1]) {
    box(st, 0.03, 0.08, 0.03, M.stone, sx * 0.065, 0.03, 0.47);
    add(st, new THREE.SphereGeometry(0.01, 8, 6), M.gold, sx * 0.065, 0.12, 0.47);
    box(st, 0.36, 0.022, 0.012, M.hedge, sx * 0.27, 0.03, 0.47);
  }
  box(st, 0.16, 0.016, 0.006, signMat('AKSOY ÜNİVERSİTESİ', '#37474f', '#ffe082'), 0, 0.09, 0.47);
  return mergeStatic([st]);
}

// ======================= Plaj (2x2) =======================
// Kumda çizgili şemsiyeler ve şezlonglar, havlular, can yeleği kulesi, sazdan çatılı plaj kafesi,
// voleybol filesi, duşlar, kanolar; arkada ahşap yürüyüş yolu ve palmiyeler. Ön yüz (+z) suya bakar.
export function palm(x: number, z: number, s: number, lean = 0.15) {
  const g = new THREE.Group();
  const trunk = pm('#8d6e4c', 0.9);
  const leaf = pm('#3f9b3f', 0.9);
  for (let k = 0; k < 5; k++) {
    const seg = part(new THREE.CylinderGeometry(0.03 * s * (1 - k * 0.08), 0.034 * s * (1 - k * 0.08), s / 5, 7), trunk, 0, (k + 0.5) * (s / 5), 0);
    g.add(seg);
  }
  for (let k = 0; k < 8; k++) {
    const arm = new THREE.Group();
    arm.position.y = s;
    arm.rotation.y = (k / 8) * Math.PI * 2;
    const l = part(new THREE.BoxGeometry(0.42 * s, 0.012 * s, 0.1 * s), leaf, 0.2 * s, -0.06 * s, 0);
    l.rotation.z = -0.45 - (k % 2) * 0.15;
    arm.add(l);
    g.add(arm);
  }
  g.add(part(new THREE.SphereGeometry(0.04 * s, 6, 5), pm('#6d4c2f'), 0, s - 0.02 * s, 0));
  g.rotation.z = lean;
  g.position.set(x, 0.02, z);
  return g;
}
function umbrella(g: THREE.Object3D, x: number, z: number, c: THREE.Material, s: number) {
  const u = item(g, x, z, x * 7, s, 0.02);
  rod(u, [0, 0, 0], [0, 0.13, 0], 0.003, M.white, 4);
  for (let k = 0; k < 8; k++) add(u, new THREE.ConeGeometry(0.075, 0.03, 2, 1, true, (k * Math.PI) / 4, Math.PI / 4), k % 2 ? M.white : c, 0, 0.14, 0);
  for (const dx of [-0.035, 0.035]) {
    const l = box(u, 0.03, 0.006, 0.08, M.white, dx, 0.012, 0.01);
    const back = box(u, 0.03, 0.006, 0.03, M.white, dx, 0.018, -0.035);
    back.rotation.x = 0.7;
    l.position.y = 0.015;
  }
}
export function beach() {
  const st = new THREE.Group();
  const s = 1 / (2 * 0.96);
  box(st, 0.98, 0.02, 0.98, SAND, 0, 0, 0);
  box(st, 0.98, 0.021, 0.12, WET_SAND, 0, 0, 0.43);
  // Ahşap yürüyüş yolu
  box(st, 0.98, 0.012, 0.08, M.wood, 0, 0.02, -0.44);
  for (let k = 0; k < 24; k++) box(st, 0.004, 0.002, 0.08, M.darkWood, -0.47 + k * 0.041, 0.032, -0.44);
  // Şemsiyeler ve şezlonglar (sıra sıra)
  const rows: [number, number][] = [];
  for (const z of [-0.16, 0.04, 0.24]) for (const x of [-0.34, -0.12, 0.1, 0.32]) rows.push([x + (z > 0 ? 0.06 : 0), z]);
  rows.forEach(([x, z], k) => {
    if (k === 3 || k === 7) return;
    umbrella(st, x, z, PAINT[k % PAINT.length], 1.1 * s);
    const t = box(st, 0.028, 0.003, 0.05, PAINT[(k + 3) % PAINT.length], x + 0.075, 0.02, z + 0.04);
    t.rotation.y = 0.3;
  });
  // Can yeleği kulesi
  const lx = 0.4, lz = -0.04;
  for (const dx of [-0.03, 0.03]) for (const dz of [-0.03, 0.03]) rod(st, [lx + dx, 0.02, lz + dz], [lx + dx * 0.7, 0.16, lz + dz * 0.7], 0.004, M.white, 4);
  box(st, 0.08, 0.01, 0.08, M.wood, lx, 0.16, lz);
  box(st, 0.06, 0.045, 0.06, M.white, lx, 0.17, lz);
  box(st, 0.05, 0.02, 0.004, windowMat, lx, 0.188, lz + 0.031);
  box(st, 0.085, 0.012, 0.085, M.red, lx, 0.215, lz);
  rod(st, [lx + 0.04, 0.22, lz], [lx + 0.04, 0.3, lz], 0.002, M.white, 4);
  box(st, 0.003, 0.02, 0.035, M.red, lx + 0.04, 0.28, lz + 0.018);
  rod(st, [lx - 0.02, 0.16, lz + 0.04], [lx - 0.02, 0.02, lz + 0.1], 0.003, M.wood, 4);
  // Plaj kafesi: ahşap gövde, sazdan çatı, tezgâh ve tabureler
  const cx = -0.32, cz = -0.34;
  box(st, 0.16, 0.08, 0.1, M.wood, cx, 0.02, cz);
  box(st, 0.18, 0.012, 0.03, M.darkWood, cx, 0.07, cz + 0.06);
  add(st, new THREE.ConeGeometry(0.15, 0.07, 6), STRAW, cx, 0.135, cz);
  box(st, 0.12, 0.025, 0.004, signMat('KAFE', '#00838f'), cx, 0.07, cz + 0.051);
  for (const dx of [-0.05, 0, 0.05]) cyl(st, 0.008, 0.008, 0.035, M.darkWood, cx + dx, 0.02, cz + 0.1, 6);
  // Voleybol filesi, duşlar, kanolar
  for (const dx of [-0.11, 0.11]) rod(st, [0.12 + dx, 0.02, -0.33], [0.12 + dx, 0.11, -0.33], 0.003, M.white, 4);
  box(st, 0.22, 0.03, 0.002, M.iron, 0.12, 0.07, -0.33);
  add(st, new THREE.SphereGeometry(0.01, 8, 6), PAINT[2], 0.06, 0.03, -0.28);
  for (const x of [-0.08, -0.02]) {
    rod(st, [x, 0.02, -0.38], [x, 0.12, -0.38], 0.003, M.steel, 4);
    rod(st, [x, 0.12, -0.38], [x, 0.12, -0.36], 0.003, M.steel, 4);
  }
  for (const [x, c] of [[-0.25, 0], [-0.18, 1], [-0.11, 5]] as [number, number][]) {
    add(st, new THREE.CapsuleGeometry(0.012, 0.08, 3, 6).rotateX(Math.PI / 2).scale(1, 0.6, 1), PAINT[c], x, 0.03, 0.42);
  }
  // Palmiyeler
  st.add(palm(-0.44, -0.2, 0.22, 0.12));
  st.add(palm(0.44, -0.4, 0.25, -0.15));
  st.add(palm(-0.45, 0.12, 0.19, 0.2));
  st.add(palm(0.2, -0.43, 0.2, 0.1));
  return mergeStatic([st]);
}

// ======================= Katlı otopark (1x1) =======================
// Beton katlar ve kolonlar, korkuluklu kenarlarda mavi şerit, kenarda katlar arası rampa, katlarda park etmiş
// arabalar, tepede lambalar; arkada camlı merdiven kulesi ve "P" tabelası, önde giriş bariyeri ve gişe.
const PARK_CON = pm('#d9d6d0', 0.9);
const PARK_DARK = pm('#8f949b', 0.9);
const pMat = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1565c0';
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#ffffff';
  x.font = 'bold 50px Fredoka, Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('P', 32, 36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#000000', roughness: 0.5 });
  m.name = 'window'; // gece yanar
  return m;
})();
const GARAGE_CARS = ['sedan', 'hatch', 'suv', 'sedan', 'van', 'sport', 'hatch', 'pickup'] as const;
const GARAGE_PAINT = ['#c62828', '#1565c0', '#f5f5f5', '#202124', '#9ea4ab', '#2e7d32', '#f9a825', '#00838f', '#e64a19', '#455a64'];
export function parkingGarage(level: number) {
  const st = new THREE.Group();
  const floors = PARKING_LEVELS[level]?.floors ?? level + 1;
  const H = 0.15;
  const X0 = -0.45, X1 = 0.29; // katın park kısmı; sağda rampa şeridi
  box(st, 0.98, 0.03, 0.98, M.paving, 0, 0, 0);
  box(st, 0.98, 0.004, 0.2, ASPHALT, 0.3, 0.03, 0.42);
  let slot = level * 5;
  for (let f = 0; f <= floors; f++) {
    const y = 0.03 + f * H; // bu katın zemini
    if (f > 0) {
      // Döşeme, kenar korkulukları ve mavi şerit
      box(st, X1 - X0, 0.016, 0.9, PARK_CON, (X0 + X1) / 2, y - 0.016, -0.02);
      box(st, X1 - X0, 0.03, 0.014, PARK_CON, (X0 + X1) / 2, y, -0.463);
      box(st, X1 - X0, 0.03, 0.014, PARK_CON, (X0 + X1) / 2, y, 0.423);
      box(st, 0.014, 0.03, 0.9, PARK_CON, X0 + 0.007, y, -0.02);
      box(st, X1 - X0 + 0.004, 0.008, 0.004, M.blue, (X0 + X1) / 2, y + 0.012, 0.431);
      box(st, 0.004, 0.008, 0.9, M.blue, X0 - 0.001, y + 0.012, -0.02);
      for (let k = 0; k < 4; k++) add(st, BULB_GEO, BULB, -0.35 + k * 0.2, y - 0.022, -0.02);
    }
    if (f === floors) break;
    // Kolonlar
    if (f < floors) {
      for (const x of [X0 + 0.01, -0.08, X1 - 0.01]) for (const z of [-0.455, -0.02, 0.415]) box(st, 0.018, H - 0.016, 0.018, PARK_DARK, x, y, z);
    }
    // Park etmiş arabalar (iki sıra)
    for (const [z, rot] of [[-0.27, 0], [0.22, Math.PI]] as [number, number][]) {
      for (const x of [-0.34, -0.13, 0.08]) {
        slot++;
        if ((slot * 7) % 5 === 0) continue;
        const kind = GARAGE_CARS[slot % GARAGE_CARS.length];
        parked(st, kind, x, z + 0.0, rot, 0.85, GARAGE_PAINT[(slot * 3) % GARAGE_PAINT.length]);
        st.children[st.children.length - 1].position.y = y;
      }
    }
    for (let k = 0; k < 4; k++) box(st, 0.004, 0.002, 0.16, M.white, -0.44 + k * 0.21, y + 0.001, -0.3);
    // Rampa (sağ şeritte bir üst kata)
    if (f < floors) {
      const len = 0.7;
      const r = box(st, 0.13, 0.014, len, PARK_CON, 0.37, 0, 0.06);
      r.position.y = y + H / 2;
      r.rotation.x = Math.atan2(H, len);
      const rail = box(st, 0.008, 0.03, len, PARK_CON, 0.437, 0, 0.06);
      rail.position.y = y + H / 2 + 0.02;
      rail.rotation.x = Math.atan2(H, len);
    }
  }
  const top = 0.03 + floors * H;
  // Tepe: lambalar ve açıkta park etmiş birkaç araba
  const roof = item(st, 0, 0, 0, 1, top - 0.03);
  for (const [x, z] of [[-0.42, -0.44], [0.27, -0.44], [-0.42, 0.4], [0.27, 0.4]] as [number, number][]) lamp(roof, x, z, 1, 0.12);
  for (const x of [-0.34, 0.08]) {
    slot++;
    parked(roof, GARAGE_CARS[slot % GARAGE_CARS.length], x, -0.27, 0, 0.85, GARAGE_PAINT[(slot * 3) % GARAGE_PAINT.length]);
  }
  // Merdiven ve asansör kulesi, "P" tabelası
  box(st, 0.14, top + 0.06 - 0.03, 0.12, PARK_CON, 0.37, 0.03, -0.39);
  box(st, 0.1, top - 0.06, 0.004, PYRAMID, 0.37, 0.05, -0.328);
  box(st, 0.15, 0.012, 0.13, PARK_DARK, 0.37, top + 0.06, -0.39);
  box(st, 0.1, 0.1, 0.01, pMat, 0.37, top + 0.08, -0.33);
  box(st, 0.24, 0.045, 0.006, signMat('OTOPARK', '#1565c0'), (X0 + X1) / 2, 0.03 + H * floors - 0.003, 0.433);
  // Giriş: gişe ve kırmızı-beyaz bariyer
  box(st, 0.06, 0.07, 0.06, M.white, 0.2, 0.03, 0.44);
  box(st, 0.05, 0.025, 0.004, windowMat, 0.2, 0.07, 0.471);
  box(st, 0.02, 0.05, 0.02, M.gray, 0.27, 0.03, 0.46);
  for (let k = 0; k < 4; k++) box(st, 0.04, 0.008, 0.008, k % 2 ? M.white : M.red, 0.3 + k * 0.04, 0.072, 0.46);
  return mergeStatic([st]);
}
