import * as THREE from 'three';

// Gökdelenler: cam kuleler kodla çizilir; her birinin biçimi, rengi ve boyu farklı.
// Cam yüzeyde pencere ızgarası var; geceleri pencerelerin bir kısmı yanar (DayNight 'window' adlı malzemeleri yakar).

const FLOOR = 0.12; // bir katın yüksekliği
const COLS = 8; // dokuda yan yana pencere sayısı
const ROWS = 8; // dokuda üst üste kat sayısı

// Cam cephe dokusu: pencereler ve aralarındaki çerçeveler; ikinci doku gece yanan pencereler
function facadeTextures() {
  const size = 256;
  const cell = size / COLS;
  const day = document.createElement('canvas');
  const night = document.createElement('canvas');
  day.width = day.height = night.width = night.height = size;
  const d = day.getContext('2d')!, n = night.getContext('2d')!;
  d.fillStyle = '#c8ccd2'; // çerçeve
  d.fillRect(0, 0, size, size);
  n.fillStyle = '#000';
  n.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * cell + 2, y = r * cell + 3, w = cell - 4, h = cell - 6;
      const g = d.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#b9c4cf');
      d.fillStyle = g;
      d.fillRect(x, y, w, h);
      if (rnd() < 0.45) {
        n.fillStyle = rnd() < 0.7 ? '#ffe2a0' : '#fff6dc';
        n.fillRect(x, y, w, h);
      }
    }
  }
  const make = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: make(day, true), glow: make(night, true) };
}
const TEX = facadeTextures();

// Camın rengi doku rengiyle çarpılır
const GLASS = ['#5fa8e8', '#47c1c9', '#c9a46a', '#7fc4a0', '#9fb3c8', '#6d86d6'].map(color => {
  const m = new THREE.MeshStandardMaterial({ color, map: TEX.map, emissiveMap: TEX.glow, emissive: '#000000', metalness: 0.35, roughness: 0.22 });
  m.name = 'window';
  return m;
});
const CONCRETE = new THREE.MeshStandardMaterial({ color: '#e7e3dc', roughness: 0.8 });
const DARK = new THREE.MeshStandardMaterial({ color: '#3a4450', roughness: 0.6, metalness: 0.3 });
const LIGHT = new THREE.MeshStandardMaterial({ color: '#ff5252', emissive: '#ff5252', emissiveIntensity: 0 });
LIGHT.name = 'lamp';

// Kutu: yan yüzlerin doku koordinatları gerçek boyuta göre ölçeklenir (pencereler her binada aynı büyüklükte)
function glassBox(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // Yüz sırası: +x, -x, +y, -y, +z, -z (her biri 4 köşe)
  const span = [d, d, 0, 0, w, w];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (!span[f]) uv.setXY(i, 0, 0);
      else uv.setXY(i, (uv.getX(i) * span[f] * COLS) / 0.8, (uv.getY(i) * h) / (FLOOR * ROWS));
    }
  }
  return g;
}
function glassCylinder(r: number, h: number) {
  const g = new THREE.CylinderGeometry(r, r, h, 20, 1, true);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const around = 2 * Math.PI * r;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * around * COLS) / 0.8, (uv.getY(i) * h) / (FLOOR * ROWS));
  return g;
}

const hash = (n: number, k: number) => {
  const s = Math.sin(n * 91.7 + k * 37.3) * 43758.5453;
  return s - Math.floor(s);
};

// Bir gökdelen (yerel ölçüde: taban 1x1 kare, y=0 zemin). height: toplam boy, seed: biçim ve renk
export function makeTower(height: number, seed: number) {
  const g = new THREE.Group();
  const glass = GLASS[Math.floor(hash(seed, 1) * GLASS.length)];
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  // Alt kat: beton giriş katı ve saçak
  add(new THREE.BoxGeometry(0.84, 0.16, 0.84), CONCRETE, 0, 0.08, 0);
  add(new THREE.BoxGeometry(0.4, 0.1, 0.02), DARK, 0, 0.06, 0.425);
  add(new THREE.BoxGeometry(0.5, 0.015, 0.1), CONCRETE, 0, 0.13, 0.46);
  const base = 0.16;
  const H = height - base;
  const type = Math.floor(hash(seed, 2) * 5);
  let top = height;
  if (type === 0) {
    // Düz cam kule, tepede çatı katı
    const w = 0.66 + hash(seed, 3) * 0.1;
    add(glassBox(w, H, w), glass, 0, base + H / 2, 0);
    add(new THREE.BoxGeometry(w + 0.03, 0.03, w + 0.03), CONCRETE, 0, height, 0);
    add(new THREE.BoxGeometry(w * 0.5, 0.1, w * 0.5), DARK, 0, height + 0.06, 0);
    top = height + 0.11;
  } else if (type === 1) {
    // Kademeli kule: yukarı çıktıkça daralan üç blok
    const ws = [0.74, 0.6, 0.44];
    const hs = [H * 0.45, H * 0.33, H * 0.22];
    let y = base;
    ws.forEach((w, k) => {
      add(glassBox(w, hs[k], w), glass, 0, y + hs[k] / 2, 0);
      y += hs[k];
      add(new THREE.BoxGeometry(w + 0.02, 0.025, w + 0.02), CONCRETE, 0, y, 0);
    });
    top = y;
  } else if (type === 2) {
    // Silindir kule ve tepede ince kule
    const r = 0.33;
    add(glassCylinder(r, H), glass, 0, base + H / 2, 0);
    add(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.03, 20), CONCRETE, 0, height, 0);
    add(new THREE.CylinderGeometry(r * 0.6, r * 0.75, 0.12, 20), DARK, 0, height + 0.07, 0);
    top = height + 0.13;
  } else if (type === 3) {
    // İkiz kuleler, aralarında gökyüzü köprüsü
    const w = 0.34;
    for (const s of [-1, 1]) {
      const h = s < 0 ? H : H * 0.86;
      add(glassBox(w, h, 0.6), glass, s * 0.2, base + h / 2, 0);
      add(new THREE.BoxGeometry(w + 0.02, 0.025, 0.62), CONCRETE, s * 0.2, base + h, 0);
    }
    add(new THREE.BoxGeometry(0.1, 0.08, 0.2), DARK, 0, base + H * 0.6, 0);
    top = height;
  } else {
    // Kare kule, tepede piramit çatı
    const w = 0.7;
    add(glassBox(w, H, w), glass, 0, base + H / 2, 0);
    const roof = add(new THREE.ConeGeometry(w * 0.72, 0.42, 4), glass, 0, height + 0.21, 0);
    roof.rotation.y = Math.PI / 4;
    top = height + 0.42;
  }
  // Tepede anten ve gece yanan uyarı ışığı
  if (height > 2.4) {
    add(new THREE.CylinderGeometry(0.008, 0.012, 0.35, 6), DARK, 0, top + 0.175, 0);
    add(new THREE.SphereGeometry(0.022, 8, 6), LIGHT, 0, top + 0.36, 0);
  }
  return g;
}

// Menüler ve şehir için hazır kuleler: 'proc/tower-<boy>-<çeşit>'
export const TOWER_MODELS: Record<string, () => THREE.Object3D> = {};
export const towerPaths = (height: number, count: number, seed: number) =>
  Array.from({ length: count }, (_, k) => {
    const path = `proc/tower-${height}-${seed + k}`;
    TOWER_MODELS[path] = () => makeTower(height * (0.88 + hash(seed + k, 9) * 0.28), seed + k * 13);
    return path;
  });
