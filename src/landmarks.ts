import * as THREE from 'three';
import { DECOR_MODELS, PROPS, type DecorKind } from './config';
import { part, mat, pad, windowMat, showcaseMat } from './utilities';
import { makeModel } from './assets';
import { makeAirliner } from './planes';
import { mergeStatic } from './batcher';
import { SEA_Y } from './water';
import { HISTORIC } from './historic';

// Simge yapılar: çeşme ve heykel hazır model, dönme dolap ve stadyum basit şekillerden.

const M = {
  white: mat('#f4f4f2'),
  steel: mat('#8d99a6'),
  red: mat('#e53935'),
  grass: mat('#5cb85c'),
  line: mat('#ffffff'),
  seat: mat('#3b6fd8'),
  stand: mat('#d0d6dc'),
};
const CABIN_COLORS = ['#e53935', '#ffb300', '#43a047', '#1e88e5', '#8e24aa', '#fb8c00'].map(c => mat(c));

function ferrisWheel() {
  const g = new THREE.Group();
  g.add(pad());
  // Ayaklar (iki yanda A şeklinde)
  for (const z of [-0.12, 0.12]) {
    for (const x of [-0.22, 0.22]) {
      const leg = part(new THREE.CylinderGeometry(0.018, 0.018, 0.95, 6), M.steel, x / 2, 0.5, z);
      leg.rotation.z = x > 0 ? -0.42 : 0.42;
      g.add(leg);
    }
  }
  // Dönen tekerlek
  const wheel = new THREE.Group();
  wheel.position.set(0, 0.95, 0);
  wheel.add(part(new THREE.TorusGeometry(0.62, 0.018, 6, 40), M.white, 0, 0, 0.1));
  wheel.add(part(new THREE.TorusGeometry(0.62, 0.018, 6, 40), M.white, 0, 0, -0.1));
  const cabins: THREE.Object3D[] = [];
  for (let n = 0; n < 12; n++) {
    const a = (n / 12) * Math.PI * 2;
    const spoke = part(new THREE.BoxGeometry(0.012, 0.62, 0.012), M.white, Math.cos(a) * 0.31, Math.sin(a) * 0.31, 0);
    spoke.rotation.z = a - Math.PI / 2;
    wheel.add(spoke);
    if (n % 2 === 0) {
      const cabin = part(new THREE.BoxGeometry(0.09, 0.09, 0.16), CABIN_COLORS[(n / 2) % CABIN_COLORS.length], Math.cos(a) * 0.62, Math.sin(a) * 0.62 - 0.06, 0);
      wheel.add(cabin);
      cabins.push(cabin);
    }
  }
  wheel.add(part(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 10).rotateX(Math.PI / 2), M.red, 0, 0, 0));
  g.add(wheel);
  g.userData.wheel = { wheel, cabins };
  return g;
}

// Tren istasyonu (2x2 olarak büyütülür): önde peron ve sundurma, arkada bina
function station() {
  const g = new THREE.Group();
  g.add(pad());
  const concrete = mat('#d9d4cb');
  const roof = mat('#2e7d5b');
  const brick = mat('#c86b4a');
  // Peron (rayın olduğu taraf: +z)
  g.add(part(new THREE.BoxGeometry(0.9, 0.06, 0.3), concrete, 0, 0.07, 0.28));
  g.add(part(new THREE.BoxGeometry(0.9, 0.012, 0.03), mat('#f2c14e'), 0, 0.105, 0.41));
  // Sundurma: direkler ve yeşil çatı
  for (const x of [-0.38, -0.12, 0.12, 0.38]) g.add(part(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), M.steel, x, 0.21, 0.28));
  const canopy = part(new THREE.BoxGeometry(0.92, 0.025, 0.3), roof, 0, 0.33, 0.28);
  canopy.rotation.x = -0.08;
  g.add(canopy);
  // İstasyon binası ve saat
  g.add(part(new THREE.BoxGeometry(0.62, 0.3, 0.32), brick, 0, 0.19, -0.16));
  g.add(part(new THREE.BoxGeometry(0.66, 0.04, 0.36), roof, 0, 0.36, -0.16));
  g.add(part(new THREE.BoxGeometry(0.16, 0.16, 0.16), brick, 0, 0.44, -0.16));
  g.add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 16).rotateX(Math.PI / 2), M.white, 0, 0.45, -0.075));
  for (const x of [-0.2, 0.2]) g.add(part(new THREE.BoxGeometry(0.1, 0.12, 0.01), mat('#9fd3ea'), x, 0.2, 0.002));
  g.add(part(new THREE.BoxGeometry(0.12, 0.17, 0.01), mat('#3c3f44'), 0, 0.13, 0.002));
  // Peronda bank
  const bench = makeModel('kaykit/bench');
  bench.position.set(-0.25, 0.1, 0.22);
  g.add(bench);
  return g;
}

// Otobüs durağı: camlı sundurma, bank ve tabela (yolun olduğu taraf +z)
function busStop() {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: '#bfe6f5', transparent: true, opacity: 0.55 });
  const roof = mat('#1e6fd9');
  g.add(part(new THREE.BoxGeometry(0.5, 0.02, 0.22), mat('#d9d4cb'), 0, 0.03, 0.3));
  g.add(part(new THREE.BoxGeometry(0.46, 0.2, 0.012), glass, 0, 0.14, 0.2));
  for (const x of [-0.22, 0.22]) g.add(part(new THREE.BoxGeometry(0.012, 0.2, 0.18), glass, x, 0.14, 0.29));
  g.add(part(new THREE.BoxGeometry(0.52, 0.025, 0.24), roof, 0, 0.255, 0.3));
  const bench = makeModel('kaykit/bench');
  bench.position.set(0, 0.04, 0.26);
  g.add(bench);
  // Tabela direği
  g.add(part(new THREE.CylinderGeometry(0.01, 0.01, 0.34, 6), M.steel, 0.32, 0.17, 0.4));
  g.add(part(new THREE.BoxGeometry(0.09, 0.09, 0.012), roof, 0.32, 0.33, 0.4));
  g.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.014), M.white, 0.32, 0.33, 0.4));
  // Arkada küçük çim ve çalı
  g.add(part(new THREE.BoxGeometry(0.9, 0.02, 0.5), mat('#6cc35a'), 0, 0.01, -0.2));
  const bush = makeModel(PROPS.bush);
  bush.position.set(-0.25, 0.02, -0.2);
  g.add(bush);
  return g;
}

// Büyütülen yapıların içindeki ağaç gibi eşyalar normal boyda kalsın (n = kaç kare)
function tree(path: string, x: number, z: number, n: number, rot = 0, size = 0.65) {
  const t = makeModel(path);
  t.scale.multiplyScalar(size / (n * 0.96));
  t.position.set(x, 0.03, z);
  t.rotation.y = rot;
  return t;
}

// Üniversite (3x3): arkada kubbeli ana bina, iki yanda kanatlar, ortada çimenli avlu, köşede saat kulesi
function university() {
  const g = new THREE.Group();
  const lawn = mat('#79c35f');
  const stone = mat('#e9e1d0');
  const slate = mat('#55667a');
  const brick = mat('#b5573f');
  const copper = mat('#5fa58f');
  const path = mat('#e6d8b8');
  g.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), lawn, 0, 0.01, 0));
  // Avlu yolları
  g.add(part(new THREE.BoxGeometry(0.08, 0.006, 0.66), path, 0, 0.023, 0.16));
  g.add(part(new THREE.BoxGeometry(0.5, 0.006, 0.06), path, 0, 0.023, 0.12));
  // Ana bina
  g.add(part(new THREE.BoxGeometry(0.66, 0.2, 0.2), brick, 0, 0.12, -0.3));
  g.add(part(new THREE.BoxGeometry(0.67, 0.015, 0.21), stone, 0, 0.222, -0.3));
  g.add(part(new THREE.BoxGeometry(0.68, 0.025, 0.22), slate, 0, 0.24, -0.3));
  for (let k = 0; k < 6; k++) g.add(part(new THREE.BoxGeometry(0.06, 0.07, 0.006), windowMat, -0.27 + k * 0.108, 0.15, -0.198));
  // Sütunlu giriş ve alınlık
  g.add(part(new THREE.BoxGeometry(0.28, 0.02, 0.08), stone, 0, 0.03, -0.16));
  for (let k = 0; k < 5; k++) g.add(part(new THREE.CylinderGeometry(0.012, 0.012, 0.17, 8), stone, -0.11 + k * 0.055, 0.12, -0.14));
  g.add(part(new THREE.BoxGeometry(0.3, 0.025, 0.07), stone, 0, 0.215, -0.15));
  const tri = new THREE.Shape([new THREE.Vector2(-0.16, 0), new THREE.Vector2(0.16, 0), new THREE.Vector2(0, 0.07)]);
  g.add(part(new THREE.ExtrudeGeometry(tri, { depth: 0.07, bevelEnabled: false }), stone, 0, 0.228, -0.185));
  // Kubbe
  g.add(part(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 20), stone, 0, 0.275, -0.3));
  g.add(part(new THREE.SphereGeometry(0.09, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), copper, 0, 0.31, -0.3));
  g.add(part(new THREE.CylinderGeometry(0.015, 0.015, 0.06, 8), stone, 0, 0.42, -0.3));
  // Yan kanatlar
  for (const side of [-1, 1]) {
    const x = side * 0.34;
    g.add(part(new THREE.BoxGeometry(0.2, 0.15, 0.36), brick, x, 0.095, 0.02));
    g.add(part(new THREE.BoxGeometry(0.21, 0.012, 0.37), stone, x, 0.174, 0.02));
    g.add(part(new THREE.BoxGeometry(0.22, 0.02, 0.38), slate, x, 0.188, 0.02));
    for (let k = 0; k < 3; k++) {
      g.add(part(new THREE.BoxGeometry(0.006, 0.05, 0.06), windowMat, x - side * 0.103, 0.11, -0.1 + k * 0.12));
    }
  }
  // Saat kulesi (ön sağ köşe)
  g.add(part(new THREE.BoxGeometry(0.08, 0.36, 0.08), brick, 0.36, 0.2, 0.36));
  g.add(part(new THREE.BoxGeometry(0.09, 0.02, 0.09), stone, 0.36, 0.38, 0.36));
  g.add(part(new THREE.ConeGeometry(0.065, 0.1, 4).rotateY(Math.PI / 4), copper, 0.36, 0.44, 0.36));
  g.add(part(new THREE.CylinderGeometry(0.025, 0.025, 0.006, 16).rotateX(Math.PI / 2), mat('#ffffff'), 0.36, 0.33, 0.403));
  // Avlu: küçük çeşme, banklar ve ağaçlar
  g.add(part(new THREE.CylinderGeometry(0.06, 0.065, 0.02, 16), stone, 0, 0.03, 0.12));
  g.add(part(new THREE.CylinderGeometry(0.045, 0.045, 0.006, 16), mat('#4fb3e8'), 0, 0.042, 0.12));
  const n = 3;
  for (const [x, z] of [[-0.16, 0.3], [0.16, 0.3], [-0.16, -0.04], [0.16, -0.04]] as [number, number][]) {
    g.add(tree(PROPS.treeSmall, x, z, n, x * 9, 0.7));
  }
  for (const [x, z] of [[-0.42, 0.42], [-0.3, 0.44], [0.2, 0.44], [-0.44, -0.42], [0.44, -0.42]] as [number, number][]) {
    g.add(tree(PROPS.treeSmall, x, z, n, z * 7, 0.55));
  }
  for (const x of [-0.08, 0.08]) {
    const b = makeModel(PROPS.bench);
    b.scale.multiplyScalar(1 / (n * 0.96));
    b.position.set(x, 0.02, 0.24);
    b.rotation.y = Math.PI;
    g.add(b);
  }
  return g;
}

// Havalimanı (4x4): arkada pist, ortada apron ve park etmiş uçaklar, önde terminal, yanda kule ve hangar.
// Pistin uçları sky.ts'teki kalkış/iniş için RUNWAY ile verilir (yerel ölçüde).
export const RUNWAY = { x0: -0.44, x1: 0.44, z: -0.3 };
function airport() {
  const g = new THREE.Group();
  const grass = mat('#8bc96b');
  const asphalt = mat('#4b5058');
  const apron = mat('#6b717a');
  const white = mat('#f4f6f8');
  const yellow = mat('#f2c14e');
  g.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), grass, 0, 0.01, 0));
  // Pist: koyu asfalt, beyaz orta çizgi ve uç işaretleri
  g.add(part(new THREE.BoxGeometry(0.94, 0.008, 0.15), asphalt, 0, 0.024, RUNWAY.z));
  for (let k = 0; k < 11; k++) g.add(part(new THREE.BoxGeometry(0.035, 0.002, 0.006), white, -0.33 + k * 0.066, 0.029, RUNWAY.z));
  for (const end of [-1, 1]) {
    for (let k = 0; k < 4; k++) g.add(part(new THREE.BoxGeometry(0.04, 0.002, 0.012), white, end * 0.43, 0.029, RUNWAY.z - 0.05 + k * 0.033));
  }
  // Pist kenar ışıkları (gece yanar)
  const lamp = new THREE.MeshStandardMaterial({ color: '#ffe082', emissive: '#ffe082', emissiveIntensity: 0 });
  lamp.name = 'lamp';
  for (let k = 0; k < 9; k++) {
    for (const dz of [-0.082, 0.082]) g.add(part(new THREE.BoxGeometry(0.008, 0.006, 0.008), lamp, -0.44 + k * 0.11, 0.03, RUNWAY.z + dz));
  }
  // Taksi yolu ve apron
  g.add(part(new THREE.BoxGeometry(0.05, 0.008, 0.2), asphalt, 0.3, 0.024, -0.14));
  g.add(part(new THREE.BoxGeometry(0.05, 0.008, 0.2), asphalt, -0.3, 0.024, -0.14));
  g.add(part(new THREE.BoxGeometry(0.74, 0.008, 0.2), apron, -0.03, 0.023, 0.0));
  for (let k = 0; k < 3; k++) g.add(part(new THREE.BoxGeometry(0.004, 0.002, 0.16), yellow, -0.26 + k * 0.2, 0.028, 0.0));
  // Park etmiş uçaklar
  for (const [x, livery, rot] of [[-0.22, 0, 0], [0.0, 2, 0]] as [number, number, number][]) {
    const p = makeAirliner(livery);
    p.scale.setScalar(0.085);
    p.position.set(x, 0.055, 0.0);
    p.rotation.y = rot;
    p.traverse(o => ((o as THREE.Mesh).castShadow = true));
    g.add(p);
  }
  // Terminal: uzun cam bina, kavisli çatı, yolcu köprüleri
  g.add(part(new THREE.BoxGeometry(0.62, 0.1, 0.14), white, -0.08, 0.07, 0.24));
  g.add(part(new THREE.BoxGeometry(0.6, 0.06, 0.006), windowMat, -0.08, 0.08, 0.313));
  g.add(part(new THREE.BoxGeometry(0.6, 0.05, 0.006), windowMat, -0.08, 0.08, 0.167));
  g.add(part(new THREE.BoxGeometry(0.66, 0.018, 0.17), mat('#6f8297'), -0.08, 0.129, 0.24));
  g.add(part(new THREE.BoxGeometry(0.66, 0.01, 0.02), white, -0.08, 0.14, 0.32));
  for (let k = 0; k < 5; k++) g.add(part(new THREE.BoxGeometry(0.07, 0.012, 0.05), windowMat, -0.32 + k * 0.12, 0.14, 0.24));
  for (const x of [-0.22, 0.0]) g.add(part(new THREE.BoxGeometry(0.025, 0.025, 0.07), white, x, 0.07, 0.135));
  // Kontrol kulesi
  g.add(part(new THREE.CylinderGeometry(0.018, 0.026, 0.26, 10), white, 0.36, 0.15, 0.22));
  g.add(part(new THREE.CylinderGeometry(0.044, 0.034, 0.045, 8), windowMat, 0.36, 0.3, 0.22));
  g.add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 8), mat('#37474f'), 0.36, 0.328, 0.22));
  g.add(part(new THREE.CylinderGeometry(0.003, 0.003, 0.06, 6), mat('#37474f'), 0.36, 0.36, 0.22));
  // Hangar (yarım silindir)
  const hangar = part(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 16, 1, false, 0, Math.PI), mat("#9aa5b1"), 0.42, 0.02, -0.03);
  hangar.rotation.z = Math.PI / 2;
  g.add(hangar);
  // Önde otopark çizgileri ve ağaçlar
  g.add(part(new THREE.BoxGeometry(0.5, 0.006, 0.08), apron, -0.08, 0.022, 0.42));
  for (let k = 0; k < 8; k++) g.add(part(new THREE.BoxGeometry(0.004, 0.002, 0.05), white, -0.3 + k * 0.063, 0.026, 0.42));
  for (const x of [0.25, 0.33, 0.43]) g.add(tree(PROPS.treeSmall, x, 0.43, 4, x * 11));
  return g;
}

// Palmiye: eğik gövde ve sarkan yapraklar (yerel ölçüde, s = boy)
export function palm(x: number, z: number, s: number, lean = 0.15) {
  const g = new THREE.Group();
  const trunk = part(new THREE.CylinderGeometry(0.03 * s, 0.045 * s, s, 6), mat('#8d6e4c'), 0, s / 2, 0);
  g.add(trunk);
  const leaf = mat('#3f9b3f');
  for (let k = 0; k < 7; k++) {
    const arm = new THREE.Group();
    arm.position.y = s;
    arm.rotation.y = (k / 7) * Math.PI * 2;
    const l = part(new THREE.BoxGeometry(0.42 * s, 0.015 * s, 0.1 * s), leaf, 0.2 * s, -0.06 * s, 0);
    l.rotation.z = -0.45;
    arm.add(l);
    g.add(arm);
  }
  g.rotation.z = lean;
  g.position.set(x, 0.02, z);
  return g;
}

// Plaj (2x2): kum, şemsiyeler, havlular, cankurtaran kulesi, palmiyeler, büfe. Ön yüz (+z) nehre bakar.
function beach() {
  const g = new THREE.Group();
  const sand = mat('#f3dfa6');
  g.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), sand, 0, 0.01, 0));
  g.add(part(new THREE.BoxGeometry(0.98, 0.021, 0.12), mat('#e2c27f'), 0, 0.011, 0.43));
  const colors = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#fb8c00'];
  const spots: [number, number][] = [[-0.3, 0.18], [0.0, 0.24], [0.28, 0.14], [-0.14, -0.06], [0.16, -0.1]];
  spots.forEach(([x, z], k) => {
    const c = mat(colors[k % colors.length]);
    g.add(part(new THREE.CylinderGeometry(0.004, 0.004, 0.13, 5), mat('#eeeeee'), x, 0.085, z));
    g.add(part(new THREE.ConeGeometry(0.075, 0.035, 10), c, x, 0.16, z));
    g.add(part(new THREE.SphereGeometry(0.008, 6, 4), mat('#ffffff'), x, 0.18, z));
    const towel = part(new THREE.BoxGeometry(0.05, 0.003, 0.09), mat(colors[(k + 2) % colors.length]), x + 0.06, 0.022, z + 0.02);
    towel.rotation.y = 0.3 * (k % 2 ? 1 : -1);
    g.add(towel);
  });
  // Cankurtaran kulesi
  const wood = mat('#c8955a');
  for (const dx of [-0.03, 0.03]) for (const dz of [-0.03, 0.03]) g.add(part(new THREE.BoxGeometry(0.008, 0.14, 0.008), wood, 0.4 + dx, 0.09, -0.08 + dz));
  g.add(part(new THREE.BoxGeometry(0.09, 0.012, 0.09), wood, 0.4, 0.16, -0.08));
  g.add(part(new THREE.BoxGeometry(0.07, 0.05, 0.07), mat('#ffffff'), 0.4, 0.19, -0.08));
  g.add(part(new THREE.BoxGeometry(0.09, 0.012, 0.09), mat('#e53935'), 0.4, 0.222, -0.08));
  g.add(part(new THREE.CylinderGeometry(0.003, 0.003, 0.1, 4), mat('#eeeeee'), 0.44, 0.27, -0.08));
  g.add(part(new THREE.BoxGeometry(0.004, 0.025, 0.04), mat('#e53935'), 0.44, 0.305, -0.06));
  // Büfe
  g.add(part(new THREE.BoxGeometry(0.16, 0.08, 0.1), mat('#ffffff'), -0.02, 0.06, -0.36));
  for (let k = 0; k < 4; k++) {
    const s = part(new THREE.BoxGeometry(0.045, 0.006, 0.07), mat(k % 2 ? '#ffffff' : '#00acc1'), -0.088 + k * 0.045, 0.11, -0.3);
    s.rotation.x = 0.3;
    g.add(s);
  }
  // Voleybol filesi
  for (const dx of [-0.12, 0.12]) g.add(part(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 5), mat('#eeeeee'), -0.3 + dx, 0.07, -0.3));
  g.add(part(new THREE.BoxGeometry(0.24, 0.035, 0.003), mat('#37474f'), -0.3, 0.1, -0.3));
  // Palmiyeler (arka köşelerde)
  g.add(palm(-0.42, -0.4, 0.22, 0.12));
  g.add(palm(0.4, -0.38, 0.25, -0.15));
  g.add(palm(-0.44, 0.02, 0.19, 0.2));
  return g;
}

// Metro istasyonu: merdiven girişi, camlı sundurma, kırmızı "M" tabelası
function metro() {
  const g = new THREE.Group();
  g.add(part(new THREE.BoxGeometry(0.92, 0.04, 0.92), mat('#d6d2c9'), 0, 0.02, 0));
  const steel = mat('#8d99a6');
  // Aşağı inen merdiven (koyu açıklık ve basamak çizgileri)
  g.add(part(new THREE.BoxGeometry(0.26, 0.004, 0.36), mat('#2b2f36'), 0, 0.042, 0.04));
  for (let k = 0; k < 6; k++) g.add(part(new THREE.BoxGeometry(0.24, 0.005, 0.012), mat('#6b7078'), 0, 0.045, 0.19 - k * 0.055));
  for (const x of [-0.145, 0.145]) g.add(part(new THREE.BoxGeometry(0.025, 0.07, 0.38), mat('#9aa3ad'), x, 0.075, 0.04));
  // Camlı sundurma
  for (const x of [-0.15, 0.15]) for (const z of [-0.13, 0.2]) g.add(part(new THREE.CylinderGeometry(0.007, 0.007, 0.18, 6), steel, x, 0.19, z));
  g.add(part(new THREE.BoxGeometry(0.34, 0.012, 0.4), showcaseMat, 0, 0.285, 0.035));
  g.add(part(new THREE.BoxGeometry(0.36, 0.016, 0.016), steel, 0, 0.285, 0.235));
  g.add(part(new THREE.BoxGeometry(0.36, 0.016, 0.016), steel, 0, 0.285, -0.165));
  // "M" tabelası
  g.add(part(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 6), steel, 0.32, 0.22, 0.3));
  g.add(part(new THREE.BoxGeometry(0.13, 0.13, 0.02), mat('#d32f2f'), 0.32, 0.46, 0.3));
  const white = mat('#ffffff');
  for (const dx of [-0.035, 0.035]) g.add(part(new THREE.BoxGeometry(0.014, 0.08, 0.006), white, 0.32 + dx, 0.46, 0.312));
  for (const side of [-1, 1]) {
    const d = part(new THREE.BoxGeometry(0.012, 0.05, 0.006), white, 0.32 + side * 0.017, 0.475, 0.312);
    d.rotation.z = side * 0.6;
    g.add(d);
  }
  // Arkada bank ve çalılar
  const bench = makeModel(PROPS.bench);
  bench.position.set(-0.3, 0.04, -0.32);
  g.add(bench);
  for (const x of [0.22, 0.36]) {
    const b = makeModel(PROPS.bush);
    b.position.set(x, 0.04, -0.34);
    g.add(b);
  }
  return g;
}

// Saat kulesi: taş gövde, dört yüzde saat, sivri çatı, çevresinde çiçekli meydan
function clockTower() {
  const g = new THREE.Group();
  g.add(part(new THREE.BoxGeometry(0.92, 0.04, 0.92), mat('#d8d2c4'), 0, 0.02, 0));
  const stone = mat('#c9a77c');
  const light = mat('#e8dcc4');
  for (const [x, z] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) {
    g.add(part(new THREE.BoxGeometry(0.16, 0.04, 0.16), mat('#5aa53c'), x, 0.06, z));
    for (let k = 0; k < 3; k++) g.add(part(new THREE.SphereGeometry(0.022, 6, 4), mat(k % 2 ? '#e53935' : '#fdd835'), x - 0.04 + k * 0.04, 0.09, z + (k - 1) * 0.03));
  }
  g.add(part(new THREE.BoxGeometry(0.26, 0.1, 0.26), light, 0, 0.09, 0));
  g.add(part(new THREE.BoxGeometry(0.18, 0.62, 0.18), stone, 0, 0.45, 0));
  for (const s of [-1, 1]) {
    g.add(part(new THREE.BoxGeometry(0.02, 0.6, 0.19), light, s * 0.08, 0.45, 0));
    g.add(part(new THREE.BoxGeometry(0.19, 0.6, 0.02), light, 0, 0.45, s * 0.08));
  }
  g.add(part(new THREE.BoxGeometry(0.22, 0.2, 0.22), light, 0, 0.86, 0));
  // Dört yüzde saat kadranı ve akrep-yelkovan
  const white = mat('#ffffff');
  const dark = mat('#2b2f36');
  for (let k = 0; k < 4; k++) {
    const face = new THREE.Group();
    face.rotation.y = (k * Math.PI) / 2;
    face.add(part(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 18).rotateX(Math.PI / 2), white, 0, 0.86, 0.112));
    face.add(part(new THREE.BoxGeometry(0.008, 0.055, 0.004), dark, 0, 0.88, 0.119));
    const hour = part(new THREE.BoxGeometry(0.008, 0.04, 0.004), dark, 0.012, 0.86, 0.119);
    hour.rotation.z = -Math.PI / 2.5;
    face.add(hour);
    g.add(face);
  }
  g.add(part(new THREE.BoxGeometry(0.25, 0.03, 0.25), stone, 0, 0.975, 0));
  g.add(part(new THREE.ConeGeometry(0.17, 0.3, 4).rotateY(Math.PI / 4), mat('#5d6d7e'), 0, 1.14, 0));
  g.add(part(new THREE.SphereGeometry(0.025, 8, 6), mat('#e0b84c'), 0, 1.3, 0));
  // Banklar
  for (const [x, z, r] of [[0, 0.3, Math.PI], [0, -0.3, 0]] as [number, number, number][]) {
    const b = makeModel(PROPS.bench);
    b.position.set(x, 0.04, z);
    b.rotation.y = r;
    g.add(b);
  }
  return g;
}

const pyramidGlass = new THREE.MeshStandardMaterial({ color: '#8fd0ef', transparent: true, opacity: 0.78, roughness: 0.1, metalness: 0.3 });

// Müze (2x2): sütunlu klasik bina, geniş merdiven, önde cam piramit ve renkli afişler
function museum() {
  const g = new THREE.Group();
  const marble = mat('#f1ece2');
  const slate = mat('#5d6d7e');
  g.add(part(new THREE.BoxGeometry(0.98, 0.03, 0.98), mat('#e3ddd0'), 0, 0.015, 0));
  // Bina
  g.add(part(new THREE.BoxGeometry(0.76, 0.22, 0.4), marble, 0, 0.14, -0.2));
  g.add(part(new THREE.BoxGeometry(0.8, 0.03, 0.44), slate, 0, 0.265, -0.2));
  for (let k = 0; k < 6; k++) g.add(part(new THREE.BoxGeometry(0.05, 0.09, 0.006), windowMat, -0.3 + k * 0.12, 0.15, -0.402 + 0.004 + 0.4));
  // Sütunlu giriş ve alınlık
  g.add(part(new THREE.BoxGeometry(0.5, 0.025, 0.12), marble, 0, 0.04, 0.06));
  for (let k = 0; k < 3; k++) g.add(part(new THREE.BoxGeometry(0.5 + k * 0.06, 0.012, 0.04), marble, 0, 0.012 + k * 0.012, 0.15 - k * 0.03));
  for (let k = 0; k < 6; k++) g.add(part(new THREE.CylinderGeometry(0.014, 0.016, 0.18, 10), marble, -0.2 + k * 0.08, 0.14, 0.07));
  g.add(part(new THREE.BoxGeometry(0.5, 0.03, 0.08), marble, 0, 0.245, 0.06));
  const tri = new THREE.Shape([new THREE.Vector2(-0.26, 0), new THREE.Vector2(0.26, 0), new THREE.Vector2(0, 0.08)]);
  g.add(part(new THREE.ExtrudeGeometry(tri, { depth: 0.08, bevelEnabled: false }), marble, 0, 0.26, 0.02));
  // Afişler
  for (const [x, c] of [[-0.3, '#c62828'], [0.3, '#1565c0']] as [number, string][]) g.add(part(new THREE.BoxGeometry(0.06, 0.14, 0.006), mat(c), x, 0.15, 0.003));
  // Cam piramit
  const pyr = part(new THREE.ConeGeometry(0.11, 0.13, 4).rotateY(Math.PI / 4), pyramidGlass, -0.24, 0.095, 0.3);
  g.add(pyr);
  g.add(part(new THREE.BoxGeometry(0.17, 0.012, 0.17), mat('#9aa3ad'), -0.24, 0.033, 0.3));
  g.add(part(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 16), mat('#4fb3e8'), 0.22, 0.036, 0.3));
  for (const [x, z] of [[0.42, 0.42], [-0.42, 0.42], [0.42, -0.44], [-0.44, -0.44]] as [number, number][]) g.add(tree(PROPS.treeSmall, x, z, 2, x * 5, 0.6));
  return g;
}

// Lunapark (3x3): dönen atlıkarınca, hız treni, bilet gişesi, büfeler ve bayraklar.
// Sabit parçalar tek parça halinde birleştirilir (telefon yorulmasın), hareket edenler ayrı kalır.
function funfair() {
  const g = new THREE.Group();
  const st = new THREE.Group(); // sabit parçalar
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#efe2c6'), 0, 0.01, 0));
  st.add(part(new THREE.BoxGeometry(0.36, 0.006, 0.98), mat('#d9c7a2'), -0.1, 0.022, 0));
  // Atlıkarınca tabanı
  const cx = -0.24, cz = 0.18;
  st.add(part(new THREE.CylinderGeometry(0.17, 0.18, 0.025, 20), mat('#b0bec5'), cx, 0.03, cz));
  const carousel = new THREE.Group();
  carousel.position.set(cx, 0.04, cz);
  const ci = new THREE.Group();
  ci.add(part(new THREE.CylinderGeometry(0.15, 0.15, 0.015, 20), mat('#fff3e0'), 0, 0.01, 0));
  ci.add(part(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 8), mat('#e0b84c'), 0, 0.11, 0));
  const canopy = ['#e53935', '#ffffff'];
  for (let k = 0; k < 8; k++) {
    const seg = part(new THREE.ConeGeometry(0.18, 0.08, 3, 1, false, (k / 8) * Math.PI * 2, Math.PI / 4), mat(canopy[k % 2]), 0, 0.25, 0);
    ci.add(seg);
  }
  ci.add(part(new THREE.SphereGeometry(0.02, 8, 6), mat('#e0b84c'), 0, 0.3, 0));
  const horses = ['#ffffff', '#ffcc80', '#90caf9', '#f48fb1'];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = Math.cos(a) * 0.11, z = Math.sin(a) * 0.11;
    ci.add(part(new THREE.CylinderGeometry(0.003, 0.003, 0.2, 4), mat('#e0b84c'), x, 0.11, z));
    const h = part(new THREE.BoxGeometry(0.018, 0.03, 0.05), mat(horses[k % 4]), x, 0.06 + (k % 2) * 0.03, z);
    h.rotation.y = -a;
    ci.add(h);
  }
  carousel.add(mergeStatic([ci]));
  g.add(carousel);
  // Hız treni rayı: kapalı, inişli çıkışlı döngü
  const pts = [
    [0.05, 0.06, 0.42], [0.3, 0.1, 0.42], [0.42, 0.3, 0.3], [0.42, 0.42, 0.0], [0.4, 0.2, -0.25], [0.28, 0.08, -0.4],
    [0.05, 0.3, -0.42], [-0.15, 0.12, -0.38], [-0.32, 0.06, -0.3], [-0.38, 0.2, -0.12], [-0.12, 0.1, -0.1], [0.12, 0.26, 0.05],
    [0.2, 0.12, 0.25],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.4);
  st.add(part(new THREE.TubeGeometry(curve, 160, 0.008, 5, true), mat('#d32f2f'), 0, 0, 0));
  for (let k = 0; k < 26; k++) {
    const p = curve.getPointAt(k / 26);
    st.add(part(new THREE.CylinderGeometry(0.004, 0.004, p.y, 4), mat('#eceff1'), p.x, p.y / 2, p.z));
  }
  const cars: THREE.Object3D[] = [];
  ['#1e88e5', '#fdd835', '#43a047'].forEach(c => {
    const car = new THREE.Group();
    car.add(part(new THREE.BoxGeometry(0.03, 0.022, 0.045), mat(c), 0, 0.02, 0));
    g.add(car);
    cars.push(car);
  });
  // Bilet gişesi, büfeler, bayraklar
  st.add(part(new THREE.BoxGeometry(0.1, 0.09, 0.08), mat('#ffffff'), -0.1, 0.065, 0.43));
  st.add(part(new THREE.ConeGeometry(0.08, 0.06, 4).rotateY(Math.PI / 4), mat('#8e24aa'), -0.1, 0.14, 0.43));
  for (const [x, z, c] of [[-0.42, -0.1, '#ff7043'], [-0.42, -0.3, '#26a69a']] as [number, number, string][]) {
    st.add(part(new THREE.BoxGeometry(0.08, 0.07, 0.08), mat('#ffffff'), x, 0.055, z));
    st.add(part(new THREE.BoxGeometry(0.1, 0.012, 0.1), mat(c), x, 0.1, z));
  }
  const flags = ['#e53935', '#fdd835', '#1e88e5', '#43a047'];
  for (let k = 0; k < 6; k++) {
    const x = -0.45 + k * 0.18;
    st.add(part(new THREE.CylinderGeometry(0.003, 0.003, 0.2, 4), mat('#eceff1'), x, 0.1, 0.47));
    st.add(part(new THREE.BoxGeometry(0.035, 0.022, 0.003), mat(flags[k % 4]), x + 0.018, 0.19, 0.47));
  }
  for (const [x, z] of [[-0.44, 0.44], [0.46, 0.46], [-0.46, -0.46]] as [number, number][]) st.add(tree(PROPS.treeSmall, x, z, 3, x * 4, 0.6));
  g.add(mergeStatic([st]));
  g.userData.carousel = carousel;
  g.userData.coaster = { curve, cars, t: 0 };
  return g;
}

// --- Sahil ---
const LH = {
  white: mat('#f6f5f1'),
  red: mat('#d63a32'),
  dark: mat('#37474f'),
  stone: mat('#9b958a'),
  lamp: new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff2c0', emissiveIntensity: 0 }),
};
LH.lamp.name = 'lamp'; // gece yanar (DayNight)

// Deniz feneri kulesi: kırmızı-beyaz kuşaklar, balkon, gece yanan fener odası (yerel ölçüde boyu ~0.93)
export function lighthouseTower() {
  const g = new THREE.Group();
  g.add(part(new THREE.CylinderGeometry(0.17, 0.2, 0.06, 12), LH.stone, 0, 0.03, 0));
  for (let k = 0; k < 4; k++) {
    g.add(part(new THREE.CylinderGeometry(0.098 - k * 0.012, 0.11 - k * 0.012, 0.17, 14), k % 2 ? LH.red : LH.white, 0, 0.145 + k * 0.17, 0));
  }
  // Küçük pencereler
  for (const [y, a] of [[0.2, 0], [0.37, 2], [0.54, 4]]) {
    const r = 0.105 - y * 0.07;
    g.add(part(new THREE.BoxGeometry(0.02, 0.035, 0.02), LH.dark, Math.sin(a) * r, y, Math.cos(a) * r));
  }
  g.add(part(new THREE.CylinderGeometry(0.095, 0.095, 0.018, 14), LH.dark, 0, 0.74, 0));
  g.add(part(new THREE.CylinderGeometry(0.092, 0.092, 0.03, 14, 1, true), LH.dark, 0, 0.765, 0));
  g.add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 10), LH.lamp, 0, 0.79, 0));
  g.add(part(new THREE.ConeGeometry(0.072, 0.08, 10), LH.red, 0, 0.87, 0));
  g.add(part(new THREE.SphereGeometry(0.012, 6, 4), LH.dark, 0, 0.915, 0));
  return g;
}

// Işık huzmesi (gece, fener yanınca görünür)
const beamMat = new THREE.MeshBasicMaterial({
  color: '#fff6c8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
});

// Deniz feneri (1x1): kayalık kıyıda kule ve bekçi evi. Ön yüz (+z) denize bakar.
function lighthouse() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#efdca4'), 0, 0.01, 0));
  st.add(part(new THREE.BoxGeometry(0.98, 0.022, 0.5), mat('#8fc76a'), 0, 0.011, -0.24));
  for (const [x, z, s] of [[0.28, 0.36, 0.11], [0.1, 0.42, 0.08], [0.38, 0.12, 0.08], [-0.05, 0.3, 0.06]]) {
    const r = part(new THREE.IcosahedronGeometry(s, 0), LH.stone, x, s * 0.4, z);
    r.rotation.set(x * 5, z * 7, 0);
    st.add(r);
  }
  const tower = lighthouseTower();
  tower.position.set(0.12, 0, 0.12);
  st.add(tower);
  // Bekçi evi
  st.add(part(new THREE.BoxGeometry(0.26, 0.12, 0.18), LH.white, -0.24, 0.08, -0.22));
  const roof = part(new THREE.CylinderGeometry(0.11, 0.11, 0.28, 3), LH.red, -0.24, 0.18, -0.22);
  roof.rotation.set(0, 0, Math.PI / 2);
  roof.scale.set(0.6, 1, 1);
  st.add(roof);
  st.add(part(new THREE.BoxGeometry(0.05, 0.07, 0.006), LH.dark, -0.24, 0.055, -0.128));
  st.add(part(new THREE.BoxGeometry(0.04, 0.035, 0.006), windowMat, -0.32, 0.09, -0.128));
  st.add(part(new THREE.BoxGeometry(0.04, 0.035, 0.006), windowMat, -0.16, 0.09, -0.128));
  for (let k = 0; k < 4; k++) st.add(part(new THREE.BoxGeometry(0.05, 0.006, 0.05), mat('#d8d2c4'), -0.12 + k * 0.07, 0.024, -0.04 + k * 0.05));
  g.add(mergeStatic([st]));
  // Dönen ışık huzmesi
  const beam = new THREE.Group();
  beam.position.set(0.12, 0.79, 0.12);
  for (const turn of [0, Math.PI]) {
    const geo = new THREE.ConeGeometry(0.28, 2.6, 16, 1, true).rotateZ(Math.PI / 2).translate(1.3, 0, 0);
    const m = new THREE.Mesh(geo, beamMat);
    m.rotation.y = turn;
    beam.add(m);
  }
  beam.visible = false;
  g.add(beam);
  g.userData.beam = beam;
  return g;
}

// Yat: beyaz gövde, renkli şerit, ahşap güverte, kabin; yelkenli ya da motorlu
const sailMat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.7 });
function yacht(sail: boolean, stripe: string) {
  const b = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-0.08, -0.027);
  shape.lineTo(0.04, -0.027);
  shape.quadraticCurveTo(0.085, -0.016, 0.1, 0);
  shape.quadraticCurveTo(0.085, 0.016, 0.04, 0.027);
  shape.lineTo(-0.08, 0.027);
  shape.lineTo(-0.08, -0.027);
  const hull = new THREE.ExtrudeGeometry(shape, { depth: 0.032, bevelEnabled: false, curveSegments: 4 }).rotateX(-Math.PI / 2);
  b.add(part(hull, LH.white, 0, 0, 0));
  b.add(part(new THREE.BoxGeometry(0.15, 0.007, 0.056), mat(stripe), -0.005, 0.02, 0));
  b.add(part(new THREE.BoxGeometry(0.13, 0.004, 0.044), mat('#c9a06a'), -0.01, 0.034, 0));
  b.add(part(new THREE.BoxGeometry(0.06, 0.026, 0.038), LH.white, -0.02, 0.047, 0));
  b.add(part(new THREE.BoxGeometry(0.062, 0.008, 0.04), LH.dark, -0.02, 0.052, 0));
  if (sail) {
    b.add(part(new THREE.CylinderGeometry(0.0025, 0.0025, 0.24, 5), mat('#dddddd'), 0.012, 0.16, 0));
    const tri = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-0.085, 0), new THREE.Vector2(0, 0.2)]));
    b.add(part(tri, sailMat, 0.01, 0.06, 0));
  } else {
    b.add(part(new THREE.BoxGeometry(0.035, 0.02, 0.032), LH.white, -0.025, 0.07, 0));
    b.add(part(new THREE.BoxGeometry(0.037, 0.007, 0.034), LH.dark, -0.025, 0.074, 0));
  }
  return b;
}

// Yat limanı (2x2): kulüp binası, kafe, ahşap iskeleler denize uzanır, iskelelerin arasında yatlar sallanır.
// Ön yüz (+z) denize bakar; iskeleler arazinin dışına, denizin üstüne taşar.
function marina() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  const wood = mat('#b98a56');
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.76), mat('#ddd6c6'), 0, 0.01, -0.11));
  st.add(part(new THREE.BoxGeometry(0.98, 0.016, 0.22), mat('#efdca4'), 0, 0.008, 0.38));
  // Kulüp binası: beyaz, mavi çatı, geniş camlar ve üst kat
  st.add(part(new THREE.BoxGeometry(0.34, 0.12, 0.2), LH.white, -0.2, 0.08, -0.3));
  st.add(part(new THREE.BoxGeometry(0.38, 0.018, 0.24), mat('#1e88e5'), -0.2, 0.149, -0.3));
  st.add(part(new THREE.BoxGeometry(0.3, 0.05, 0.006), windowMat, -0.2, 0.085, -0.197));
  st.add(part(new THREE.BoxGeometry(0.18, 0.06, 0.12), LH.white, -0.26, 0.19, -0.33));
  st.add(part(new THREE.BoxGeometry(0.2, 0.012, 0.14), mat('#1e88e5'), -0.26, 0.226, -0.33));
  // Şemsiyeli kafe masaları
  ['#e53935', '#fdd835', '#43a047'].forEach((c, n) => {
    const x = 0.08 + n * 0.12;
    st.add(part(new THREE.CylinderGeometry(0.003, 0.003, 0.08, 4), mat('#eeeeee'), x, 0.06, -0.3));
    st.add(part(new THREE.ConeGeometry(0.05, 0.025, 8), mat(c), x, 0.1, -0.3));
    st.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.004, 8), LH.white, x, 0.045, -0.3));
  });
  // Bayraklar
  ['#e53935', '#1e88e5', '#fdd835'].forEach((c, n) => {
    const x = -0.4 + n * 0.08;
    st.add(part(new THREE.CylinderGeometry(0.003, 0.003, 0.2, 4), mat('#eeeeee'), x, 0.11, 0.18));
    st.add(part(new THREE.BoxGeometry(0.045, 0.028, 0.003), mat(c), x + 0.024, 0.19, 0.18));
  });
  st.add(palm(0.42, -0.4, 0.2, 0.1));
  st.add(palm(0.3, -0.12, 0.18, -0.15));
  // İskeleler: kıyı boyunca yürüyüş yolu ve denize uzanan üç parmak
  const deck = 0.016;
  st.add(part(new THREE.BoxGeometry(0.96, 0.012, 0.07), wood, 0, deck, 0.42));
  for (const x of [-0.3, 0, 0.3]) {
    st.add(part(new THREE.BoxGeometry(0.045, 0.012, 0.56), wood, x, deck, 0.72));
    for (const z of [0.6, 0.8, 0.98]) st.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 5), mat('#7b5a3a'), x + 0.025, -0.04, z));
  }
  g.add(mergeStatic([st]));
  // Yatlar: iskelelerin arasında, burunları denize dönük; deniz seviyesinde yüzer (bina 2x2 büyütülür)
  const water = SEA_Y / (2 * 0.96);
  const boats: { obj: THREE.Object3D; phase: number }[] = [];
  ([[-0.15, true, '#1e88e5'], [0.15, false, '#e53935'], [0.44, true, '#00897b'], [-0.44, false, '#3949ab']] as [number, boolean, string][]).forEach(
    ([x, sail, c], n) => {
      const b = yacht(sail, c);
      b.rotation.y = -Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(mergeStatic([b]));
      holder.position.set(x, water - 0.012, 0.74 + (n % 2) * 0.05);
      g.add(holder);
      boats.push({ obj: holder, phase: n * 1.7 });
    },
  );
  g.userData.bob = boats;
  return g;
}

// Cami (2x2): arkada büyük kubbeli ana bina ve köşe kubbeleri, iki yanda şerefeli ince minareler,
// önde revaklı avlu ve ortasında şadırvan. Ön yüz (+z) yola bakar. Minare şerefeleri gece ışıklanır.
const MQ = {
  stone: mat('#f1e8d8'),
  dome: mat('#8fa5b8'),
  dark: mat('#3d4b58'),
  gold: new THREE.MeshStandardMaterial({ color: '#e0b84c', metalness: 0.6, roughness: 0.35 }),
  court: mat('#ddd4c2'),
  lamp: new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff2c0', emissiveIntensity: 0 }),
};
MQ.lamp.name = 'lamp';
const halfDome = (r: number) => new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
function mosque() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#cfc6b3'), 0, 0.01, 0));
  st.add(part(new THREE.BoxGeometry(0.62, 0.012, 0.38), MQ.court, 0, 0.026, 0.27));
  // Ana bina ve kubbe
  const cz = -0.17;
  st.add(part(new THREE.BoxGeometry(0.52, 0.2, 0.46), MQ.stone, 0, 0.12, cz));
  st.add(part(new THREE.BoxGeometry(0.54, 0.02, 0.48), mat('#e2d6c0'), 0, 0.225, cz));
  st.add(part(new THREE.CylinderGeometry(0.17, 0.185, 0.06, 18), MQ.stone, 0, 0.26, cz));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const w = part(new THREE.BoxGeometry(0.018, 0.03, 0.006), MQ.dark, Math.sin(a) * 0.183, 0.262, cz + Math.cos(a) * 0.183);
    w.rotation.y = a;
    st.add(w);
  }
  st.add(part(halfDome(0.175), MQ.dome, 0, 0.29, cz));
  st.add(part(new THREE.CylinderGeometry(0.004, 0.006, 0.07, 6), MQ.gold, 0, 0.5, cz));
  st.add(part(new THREE.SphereGeometry(0.012, 8, 6), MQ.gold, 0, 0.54, cz));
  // Köşe kubbeleri
  for (const dx of [-0.18, 0.18]) {
    for (const dz of [cz - 0.15, cz + 0.15]) {
      st.add(part(new THREE.CylinderGeometry(0.06, 0.06, 0.025, 12), MQ.stone, dx, 0.245, dz));
      st.add(part(halfDome(0.06), MQ.dome, dx, 0.257, dz));
    }
  }
  // Ön cephe: taç kapı ve kemerli pencereler
  const front = cz + 0.231;
  st.add(part(new THREE.BoxGeometry(0.16, 0.24, 0.04), MQ.stone, 0, 0.14, front + 0.01));
  st.add(part(new THREE.BoxGeometry(0.07, 0.12, 0.006), MQ.dark, 0, 0.08, front + 0.032));
  st.add(part(new THREE.CylinderGeometry(0.035, 0.035, 0.006, 12, 1, false, -Math.PI / 2, Math.PI), MQ.dark, 0, 0.14, front + 0.032).rotateX(-Math.PI / 2));
  for (const x of [-0.19, -0.12, 0.12, 0.19]) {
    st.add(part(new THREE.BoxGeometry(0.035, 0.06, 0.006), MQ.dark, x, 0.13, front + 0.003));
    st.add(part(new THREE.CylinderGeometry(0.0175, 0.0175, 0.006, 10, 1, false, -Math.PI / 2, Math.PI), MQ.dark, x, 0.16, front + 0.003).rotateX(-Math.PI / 2));
  }
  // Avlunun iki yanında revaklar (küçük kubbeler)
  for (const x of [-0.27, 0.27]) {
    st.add(part(new THREE.BoxGeometry(0.08, 0.07, 0.34), MQ.stone, x, 0.055, 0.27));
    for (let k = 0; k < 3; k++) {
      st.add(part(halfDome(0.034), MQ.dome, x, 0.09, 0.15 + k * 0.12));
      st.add(part(new THREE.BoxGeometry(0.006, 0.04, 0.05), MQ.dark, x + (x < 0 ? 0.041 : -0.041), 0.05, 0.15 + k * 0.12));
    }
  }
  // Şadırvan
  st.add(part(new THREE.CylinderGeometry(0.06, 0.065, 0.03, 8), MQ.stone, 0, 0.047, 0.28));
  st.add(part(new THREE.CylinderGeometry(0.045, 0.045, 0.006, 8), mat('#4fb3e8'), 0, 0.063, 0.28));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    st.add(part(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 5), MQ.stone, Math.sin(a) * 0.055, 0.09, 0.28 + Math.cos(a) * 0.055));
  }
  st.add(part(new THREE.ConeGeometry(0.075, 0.045, 8), MQ.dome, 0, 0.142, 0.28));
  // Minareler: ana binanın ön köşelerinde
  for (const x of [-0.33, 0.33]) {
    const z = cz + 0.2;
    st.add(part(new THREE.BoxGeometry(0.06, 0.08, 0.06), MQ.stone, x, 0.04, z));
    st.add(part(new THREE.CylinderGeometry(0.021, 0.025, 0.5, 12), MQ.stone, x, 0.33, z));
    st.add(part(new THREE.CylinderGeometry(0.036, 0.026, 0.018, 12), MQ.stone, x, 0.48, z));
    st.add(part(new THREE.CylinderGeometry(0.034, 0.034, 0.012, 12, 1, true), MQ.lamp, x, 0.495, z));
    st.add(part(new THREE.CylinderGeometry(0.017, 0.02, 0.12, 12), MQ.stone, x, 0.55, z));
    st.add(part(new THREE.CylinderGeometry(0.027, 0.02, 0.012, 12), MQ.stone, x, 0.615, z));
    st.add(part(new THREE.ConeGeometry(0.022, 0.13, 12), MQ.dome, x, 0.685, z));
    st.add(part(new THREE.CylinderGeometry(0.0025, 0.0025, 0.04, 5), MQ.gold, x, 0.765, z));
  }
  // Servi ağaçları
  for (const [x, z] of [[-0.42, 0.42], [0.42, 0.42], [-0.43, -0.42], [0.43, -0.42]] as [number, number][]) st.add(tree(PROPS.treeSmall, x, z, 2, x * 5, 0.6));
  g.add(mergeStatic([st]));
  return g;
}

export function makeDecor(kind: DecorKind): THREE.Object3D {
  if (kind in HISTORIC) return HISTORIC[kind as keyof typeof HISTORIC]();
  if (kind === 'mosque') return mosque();
  if (kind === 'lighthouse') return lighthouse();
  if (kind === 'marina') return marina();
  if (kind === 'clocktower') return clockTower();
  if (kind === 'museum') return museum();
  if (kind === 'funfair') return funfair();
  if (kind === 'beach') return beach();
  if (kind === 'metro') return metro();
  if (kind === 'uni') return university();
  if (kind === 'airport') return airport();
  if (kind === 'busstop') return busStop();
  if (kind === 'station') return station();
  if (kind === 'wheel') return ferrisWheel();
  const g = new THREE.Group();
  g.add(pad());
  const m = makeModel(DECOR_MODELS[kind]!);
  m.position.y = 0.04;
  g.add(m);
  return g;
}

// Dönme dolap dönsün, kabinler hep düz dursun; atlıkarınca dönsün, hız treni rayda ilerlesin
const ahead = new THREE.Vector3();
export function animateDecor(obj: THREE.Object3D, dt: number) {
  // Fener huzmesi döner; fener yanınca (gece) görünür
  const beam = obj.userData.beam as THREE.Object3D | undefined;
  if (beam) {
    beam.rotation.y += dt * 0.9;
    beamMat.opacity = (LH.lamp.emissiveIntensity / 2) * 0.22;
    beam.visible = beamMat.opacity > 0.01;
  }
  // Yatlar dalgada sallanır
  const bob = obj.userData.bob as { obj: THREE.Object3D; phase: number }[] | undefined;
  if (bob) {
    const t = (obj.userData.t = ((obj.userData.t as number | undefined) ?? 0) + dt);
    for (const b of bob) {
      b.obj.position.y = SEA_Y / (2 * 0.96) - 0.012 + Math.sin(t * 1.3 + b.phase) * 0.004;
      b.obj.rotation.z = Math.sin(t * 1.1 + b.phase) * 0.03;
    }
  }
  const car = obj.userData.carousel as THREE.Object3D | undefined;
  if (car) car.rotation.y += dt * 0.8;
  const co = obj.userData.coaster as { curve: THREE.CatmullRomCurve3; cars: THREE.Object3D[]; t: number } | undefined;
  if (co) {
    // Aşağıdayken hızlı, yukarıdayken yavaş
    const h = co.curve.getPointAt(co.t % 1).y;
    co.t = (co.t + dt * (0.09 - h * 0.12)) % 1;
    co.cars.forEach((c, k) => {
      const u = (co.t - k * 0.022 + 1) % 1;
      c.position.copy(co.curve.getPointAt(u));
      co.curve.getPointAt((u + 0.004) % 1, ahead);
      c.lookAt(ahead.applyMatrix4(c.parent!.matrixWorld));
    });
  }
  const w = obj.userData.wheel as { wheel: THREE.Object3D; cabins: THREE.Object3D[] } | undefined;
  if (!w) return;
  w.wheel.rotation.z += dt * 0.25;
  for (const c of w.cabins) c.rotation.z = -w.wheel.rotation.z;
}
