import * as THREE from 'three';
import type { UtilKind } from './config';
import { mergeStatic } from './batcher';
import { KIT } from './towers';

// Elektrik ve su yapıları gökdelenler gibi ayrıntılı çizilir: termik santral (soğutma kuleleri, baca, trafo sahası),
// rüzgâr türbini, güneş tarlası, su kulesi ve arıtma tesisli su pompası.
// level: yükseltme seviyesi; yükseldikçe yapıya yeni parçalar eklenir (yeni soğutma kulesi, panel sırası, depo...).
// Yerel ölçü 1x1 kare (2x2 yapılar sonra büyütülür), ön yüz +z.

export const mat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
// Gece ışığı yanan cam (DayNight 'window' adlı malzemeleri yakar)
export const windowMat = new THREE.MeshStandardMaterial({ color: '#9fd3ea', roughness: 0.3, metalness: 0.1 });
windowMat.name = 'window';
// Dükkan vitrinleri için saydam cam (arkasındaki eşyalar görünsün)
export const showcaseMat = new THREE.MeshStandardMaterial({ color: '#d6f1ff', transparent: true, opacity: 0.32, roughness: 0.1, depthWrite: false });

export function part(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export const pad = () => part(new THREE.BoxGeometry(0.92, 0.04, 0.92), mat('#b9bec4'), 0, 0.02, 0);

const pm = (color: string, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const M = {
  concrete: pm('#d8d5ce', 0.95),
  darkConcrete: pm('#a9a59c', 0.95),
  asphalt: pm('#5b6170', 0.9),
  gravel: pm('#c9c3b5', 1),
  steel: pm('#9aa5b1', 0.4, 0.6),
  darkSteel: pm('#5d6773', 0.5, 0.5),
  white: pm('#f6f6f4', 0.5),
  red: pm('#d64541', 0.6),
  yellow: pm('#f2c14e', 0.6),
  blue: pm('#2f7fc1', 0.5),
  water: pm('#4fb0de', 0.1, 0.2),
  grass: pm('#6cbd55', 1),
  line: pm('#f4f4f0', 0.7),
};
const lamp = () => {
  const m = new THREE.MeshStandardMaterial({ color: '#ff4b4b', emissive: '#ff4b4b', emissiveIntensity: 0 });
  m.name = 'lamp';
  return m;
};
const add = (g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
  const o = part(geo, m, x, y, z);
  g.add(o);
  return o;
};
// Kutu: y alt kenar
const box = (g: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => add(g, new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z);

// İki nokta arasında ince çubuk (direk kafesi, kablo)
function rod(g: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) {
  const len = a.distanceTo(b);
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 4), m);
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  o.castShadow = true;
  g.add(o);
}
// Elektrik direği (kafes kule, kollar)
function pylon(g: THREE.Object3D, x: number, z: number, h: number) {
  const V = (px: number, py: number, pz: number) => new THREE.Vector3(x + px, py, z + pz);
  const b = 0.05, t = 0.015;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) rod(g, V(sx * b, 0, sz * b), V(sx * t, h, sz * t), 0.004, M.darkSteel);
  for (let k = 1; k <= 3; k++) {
    const y = (h * k) / 4, w = b + (t - b) * (k / 4);
    rod(g, V(-w, y, -w), V(w, y, -w), 0.003, M.darkSteel);
    rod(g, V(-w, y, w), V(w, y, w), 0.003, M.darkSteel);
  }
  for (const y of [h * 0.85, h]) rod(g, V(-0.1, y, 0), V(0.1, y, 0), 0.004, M.darkSteel);
}

// --- Termik santral (2x2): türbin binası, soğutma kuleleri ve buharı, kırmızı-beyaz baca, trafo sahası ---
function hyperboloid(r: number, h: number) {
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    const waist = 0.62 + 0.38 * Math.pow((t - 0.68) / 0.68, 2);
    pts.push(new THREE.Vector2(r * Math.min(1, waist), t * h));
  }
  return new THREE.LatheGeometry(pts, 28);
}
function powerPlant(level: number) {
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.96, 0.03, 0.96, M.asphalt, 0, 0, 0);
  for (let k = 0; k < 5; k++) box(st, 0.008, 0.002, 0.1, M.yellow, -0.05 + k * 0.08, 0.03, 0.4);
  // Türbin binası: oluklu sac, şerit pencereler, çatı
  st.add(part(KIT.facadeBox(0.52, 0.24, 0.3, 0.03), KIT.METAL[0], -0.18, 0.15, 0.22));
  st.add(part(KIT.facadeBox(0.53, 0.05, 0.31, 0.2), KIT.BAND[0], -0.18, 0.205, 0.22));
  box(st, 0.55, 0.02, 0.33, M.darkSteel, -0.18, 0.27, 0.22);
  box(st, 0.14, 0.09, 0.012, M.darkSteel, -0.3, 0.03, 0.375);
  // Baca: kırmızı-beyaz bantlar, bakım platformu, tepede uyarı lambası
  const ch = 0.95 + level * 0.12;
  for (let k = 0; k < 6; k++) add(st, new THREE.CylinderGeometry(0.045 - k * 0.002, 0.047 - k * 0.002, ch / 6, 14), k % 2 ? M.white : M.red, -0.38, 0.03 + (ch / 6) * (k + 0.5), 0.0);
  add(st, new THREE.CylinderGeometry(0.06, 0.06, 0.012, 14), M.darkSteel, -0.38, 0.03 + ch * 0.7, 0);
  add(st, new THREE.SphereGeometry(0.012, 8, 6), lamp(), -0.38, 0.04 + ch, 0);
  // Soğutma kuleleri: seviye arttıkça bir tane daha
  const towers: [number, number, number][] = [[0.22, -0.2, 0.2], [0.27, 0.12, 0.17], [-0.05, -0.3, 0.15], [-0.2, -0.28, 0.13]];
  const n = Math.min(towers.length, 1 + Math.ceil(level / 1.5));
  const tops: THREE.Vector3[] = [];
  for (let k = 0; k < n; k++) {
    const [x, z, r] = towers[k];
    const h = r * 3.4;
    add(st, hyperboloid(r, h), new THREE.MeshStandardMaterial({ color: '#dedbd4', roughness: 0.95, side: THREE.DoubleSide }), x, 0.03, z);
    add(st, new THREE.CylinderGeometry(r * 0.7, r * 0.7, 0.012, 24, 1, true), M.darkConcrete, x, 0.03 + h - 0.006, z);
    add(st, new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.02, 24, 1, true), M.darkConcrete, x, 0.04, z);
    tops.push(new THREE.Vector3(x, 0.03 + h, z));
  }
  // Trafo sahası ve elektrik direkleri
  for (let k = 0; k < 3; k++) {
    box(st, 0.07, 0.07, 0.05, M.darkSteel, 0.1 + k * 0.1, 0.03, 0.36);
    for (const dx of [-0.02, 0.02]) add(st, new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6), M.white, 0.1 + k * 0.1 + dx, 0.125, 0.36);
  }
  pylon(st, 0.42, 0.42, 0.32);
  pylon(st, 0.42, -0.05, 0.32);
  rod(st, new THREE.Vector3(0.32, 0.32, 0.42), new THREE.Vector3(0.32, 0.32, -0.05), 0.002, M.darkSteel);
  rod(st, new THREE.Vector3(0.52, 0.32, 0.42), new THREE.Vector3(0.52, 0.32, -0.05), 0.002, M.darkSteel);
  // Kömür/yakıt borusu
  const pipe = add(st, new THREE.CylinderGeometry(0.018, 0.018, 0.4, 8), M.steel, 0.0, 0.12, 0.02);
  pipe.rotation.z = Math.PI / 2;
  g.add(mergeStatic([st]));
  // Buhar: soğutma kulelerinden yükselen bulutlar (animateUtility)
  const puffs: THREE.Mesh[] = [];
  const steam = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false });
  tops.forEach((top, k) => {
    for (let p = 0; p < 3; p++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), steam.clone());
      m.userData.phase = p / 3 + k * 0.17;
      m.userData.base = top;
      puffs.push(m);
      g.add(m);
    }
  });
  g.userData.smoke = { puffs, base: tops[0] };
  return g;
}

// --- Rüzgâr türbini: ince uzun gövde, gondol, üç sivri kanat (döner) ---
function windTurbine(level: number) {
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.5, 0.03, 0.5, M.gravel, 0, 0, 0);
  add(st, new THREE.CylinderGeometry(0.1, 0.11, 0.04, 16), M.concrete, 0, 0.05, 0);
  const H = 1.55 + level * 0.18;
  add(st, new THREE.CylinderGeometry(0.018, 0.04, H, 14), M.white, 0, 0.07 + H / 2, 0);
  box(st, 0.02, 0.05, 0.012, M.darkSteel, 0, 0.07, 0.04);
  box(st, 0.06, 0.05, 0.05, M.white, 0.12, 0.03, 0.1);
  // Gondol
  const top = 0.07 + H;
  add(st, new THREE.CapsuleGeometry(0.032, 0.12, 4, 10).rotateX(Math.PI / 2), M.white, 0, top, 0.02);
  add(st, new THREE.SphereGeometry(0.01, 6, 4), lamp(), 0, top + 0.036, -0.02);
  g.add(mergeStatic([st]));
  const hub = new THREE.Group();
  hub.position.set(0, top, 0.1);
  hub.add(part(new THREE.ConeGeometry(0.03, 0.06, 12).rotateX(Math.PI / 2), M.white, 0, 0, 0.02));
  const L = 0.62 + level * 0.06;
  for (let b = 0; b < 3; b++) {
    const arm = new THREE.Group();
    arm.rotation.z = (b * Math.PI * 2) / 3;
    // Kanat: dipte geniş, uca doğru incelen
    const s = new THREE.Shape();
    s.moveTo(-0.022, 0);
    s.lineTo(0.03, 0.06);
    s.lineTo(0.012, L);
    s.lineTo(-0.004, L);
    s.lineTo(-0.022, 0);
    arm.add(part(new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false }), M.white, 0, 0.02, -0.004));
    hub.add(arm);
  }
  g.add(hub);
  g.userData.spin = hub;
  return g;
}

// --- Güneş tarlası (2x2): sıra sıra eğik paneller (hücreli doku), inverter dolapları, çit ---
const cellTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1d3557';
  x.fillRect(0, 0, 64, 64);
  x.strokeStyle = '#9fb3c8';
  x.lineWidth = 1;
  for (let k = 0; k <= 64; k += 16) {
    x.beginPath();
    x.moveTo(k, 0);
    x.lineTo(k, 64);
    x.moveTo(0, k);
    x.lineTo(64, k);
    x.stroke();
  }
  x.fillStyle = 'rgba(255,255,255,0.12)';
  x.fillRect(0, 0, 64, 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
const panelMat = new THREE.MeshStandardMaterial({ map: cellTex, roughness: 0.25, metalness: 0.5 });
function solarFarm(level: number) {
  const st = new THREE.Group();
  box(st, 0.96, 0.025, 0.96, M.gravel, 0, 0, 0);
  const rows = 4 + Math.min(3, level);
  for (let k = 0; k < rows; k++) {
    const z = -0.4 + (k * 0.8) / (rows - 1);
    const geo = new THREE.BoxGeometry(0.78, 0.008, 0.09);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8, uv.getY(i));
    const p = add(st, geo, panelMat, -0.04, 0.09, z);
    p.rotation.x = -0.45;
    for (const x of [-0.38, -0.04, 0.3]) {
      add(st, new THREE.CylinderGeometry(0.004, 0.004, 0.08, 4), M.steel, x, 0.06, z - 0.02);
      add(st, new THREE.CylinderGeometry(0.004, 0.004, 0.05, 4), M.steel, x, 0.05, z + 0.02);
    }
  }
  // İnverter dolapları ve kontrol kulübesi
  for (let k = 0; k < 2; k++) box(st, 0.05, 0.07, 0.04, M.white, 0.43, 0.025, -0.25 + k * 0.12);
  box(st, 0.1, 0.08, 0.08, M.concrete, 0.42, 0.025, 0.35);
  box(st, 0.11, 0.012, 0.09, M.darkSteel, 0.42, 0.105, 0.35);
  // Çit direkleri
  for (let k = 0; k <= 8; k++) {
    for (const [x, z] of [[-0.47 + k * 0.1175, -0.47], [-0.47 + k * 0.1175, 0.47], [-0.47, -0.47 + k * 0.1175], [0.47, -0.47 + k * 0.1175]]) {
      add(st, new THREE.CylinderGeometry(0.003, 0.003, 0.05, 4), M.darkSteel, x, 0.05, z);
    }
  }
  return mergeStatic([st]);
}

// --- Su kulesi: dört ayak, çapraz bağlantılar, şehrin adı yazılı depo, merdiven ---
const tankTex = (() => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#e9f1f7';
  x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#2f7fc1';
  x.fillRect(0, 50, 256, 8);
  x.font = 'bold 28px Fredoka, Arial, sans-serif';
  x.textAlign = 'center';
  x.fillText('AKSOY', 64, 38);
  x.fillText('AKSOY', 192, 38);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
function waterTower(level: number) {
  const st = new THREE.Group();
  box(st, 0.7, 0.03, 0.7, M.concrete, 0, 0, 0);
  const legH = 0.62 + level * 0.1;
  const r = 0.17 + level * 0.025;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    rod(st, V(sx * 0.17, 0.03, sz * 0.17), V(sx * 0.1, 0.03 + legH, sz * 0.1), 0.012, M.steel);
    add(st, new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8), M.concrete, sx * 0.17, 0.045, sz * 0.17);
  }
  for (let k = 1; k <= 2; k++) {
    const y = 0.03 + (legH * k) / 3, w = 0.17 - (0.07 * k) / 3;
    for (const [a, b] of [[[-w, -w], [w, -w]], [[w, -w], [w, w]], [[w, w], [-w, w]], [[-w, w], [-w, -w]]] as [number, number][][]) rod(st, V(a[0], y, a[1]), V(b[0], y, b[1]), 0.005, M.steel);
  }
  add(st, new THREE.CylinderGeometry(0.03, 0.03, legH, 10), M.steel, 0, 0.03 + legH / 2, 0);
  // Depo: yazılı gövde, alt ve üst kubbe, korkuluklu yürüme yolu
  const y0 = 0.03 + legH;
  add(st, new THREE.CylinderGeometry(r, r, 0.22, 28, 1, true), new THREE.MeshStandardMaterial({ map: tankTex, roughness: 0.5, side: THREE.DoubleSide }), 0, y0 + 0.13, 0);
  add(st, new THREE.SphereGeometry(r, 28, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, 0.45, 1), pm('#e9f1f7', 0.5), 0, y0 + 0.02, 0);
  add(st, new THREE.ConeGeometry(r * 1.02, 0.1, 28), pm('#2f7fc1', 0.5), 0, y0 + 0.29, 0);
  add(st, new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.01, 28), M.darkSteel, 0, y0 + 0.02, 0);
  add(st, new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.03, 28, 1, true), M.steel, 0, y0 + 0.045, 0);
  rod(st, V(0.19, 0.03, 0.19), V(0.11, y0, 0.11), 0.004, M.yellow);
  add(st, new THREE.SphereGeometry(0.01, 6, 4), lamp(), 0, y0 + 0.35, 0);
  // Pompa kulübesi
  box(st, 0.14, 0.08, 0.1, M.white, -0.24, 0.03, 0.24);
  box(st, 0.15, 0.012, 0.11, M.blue, -0.24, 0.11, 0.24);
  return mergeStatic([st]);
}

// --- Su pompası ve arıtma tesisi (2x2): pompa binası, yuvarlak çökeltme havuzları, dikdörtgen havuzlar, borular ---
function waterPump(level: number) {
  const st = new THREE.Group();
  box(st, 0.96, 0.03, 0.96, M.concrete, 0, 0, 0);
  // Pompa binası
  st.add(part(KIT.facadeBox(0.4, 0.2, 0.26, 0.03), KIT.BAND[1], -0.24, 0.13, 0.26));
  box(st, 0.42, 0.02, 0.28, M.blue, -0.24, 0.23, 0.26);
  box(st, 0.1, 0.09, 0.012, M.darkSteel, -0.24, 0.03, 0.395);
  // Yuvarlak havuzlar (seviyeyle artar)
  const tanks: [number, number][] = [[0.22, -0.22], [-0.2, -0.24], [0.26, 0.2], [-0.02, 0.0]];
  const n = Math.min(tanks.length, 2 + level);
  for (let k = 0; k < n; k++) {
    const [x, z] = tanks[k];
    add(st, new THREE.CylinderGeometry(0.17, 0.17, 0.08, 28, 1, true), M.darkConcrete, x, 0.07, z);
    add(st, new THREE.CylinderGeometry(0.165, 0.165, 0.02, 28), M.water, x, 0.09, z);
    add(st, new THREE.CylinderGeometry(0.02, 0.02, 0.06, 8), M.steel, x, 0.12, z);
    const bridge = add(st, new THREE.BoxGeometry(0.34, 0.012, 0.02), M.yellow, x, 0.12, z);
    bridge.rotation.y = k * 0.7;
  }
  // Borular
  const blue = pm('#2f7fc1', 0.4, 0.3);
  const p1 = add(st, new THREE.CylinderGeometry(0.016, 0.016, 0.5, 8), blue, 0, 0.06, 0.12);
  p1.rotation.z = Math.PI / 2;
  const p2 = add(st, new THREE.CylinderGeometry(0.016, 0.016, 0.4, 8), blue, 0.05, 0.06, -0.05);
  p2.rotation.x = Math.PI / 2;
  // Çimler ve çit
  box(st, 0.2, 0.01, 0.2, M.grass, 0.33, 0.03, 0.38);
  return mergeStatic([st]);
}

export function makeUtility(kind: UtilKind, level = 0): THREE.Object3D {
  if (kind === 'wind') return windTurbine(level);
  if (kind === 'solar') return solarFarm(level);
  if (kind === 'plant') return powerPlant(level);
  if (kind === 'tower') return waterTower(level);
  return waterPump(level);
}

// Pervaneleri döndür, buharı yükselt
export function animateUtility(obj: THREE.Object3D, time: number, dt: number) {
  const spin = obj.userData.spin as THREE.Object3D | undefined;
  if (spin) spin.rotation.z -= dt * 2.2;
  const smoke = obj.userData.smoke as { puffs: THREE.Mesh[]; base: THREE.Vector3 } | undefined;
  if (smoke) {
    for (const p of smoke.puffs) {
      const base = (p.userData.base as THREE.Vector3 | undefined) ?? smoke.base;
      const k = (time * 0.3 + p.userData.phase) % 1;
      p.position.copy(base).add(new THREE.Vector3(k * 0.12, k * 0.55, 0));
      p.scale.setScalar(0.7 + k * 1.6);
      (p.material as THREE.MeshStandardMaterial).opacity = 0.8 * (1 - k);
    }
  }
}
