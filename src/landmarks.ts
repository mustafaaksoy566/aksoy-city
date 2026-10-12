import * as THREE from 'three';
import { DECOR_MODELS, PROPS, type DecorKind } from './config';
import { part, mat, pad, windowMat } from './utilities';
import { makeModel } from './assets';
import { makeAirliner } from './planes';

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

function stadium() {
  const g = new THREE.Group();
  g.add(pad());
  // Oval tribün
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, 0.44, 0.4, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, 0.3, 0.25, 0, Math.PI * 2, true, 0);
  shape.holes.push(hole);
  const stands = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false, curveSegments: 32 }).rotateX(-Math.PI / 2);
  g.add(part(stands, M.stand, 0, 0.04, 0));
  // Renkli koltuk şeridi
  const ring = new THREE.Shape();
  ring.absellipse(0, 0, 0.4, 0.35, 0, Math.PI * 2, false, 0);
  const ringHole = new THREE.Path();
  ringHole.absellipse(0, 0, 0.33, 0.28, 0, Math.PI * 2, true, 0);
  ring.holes.push(ringHole);
  g.add(part(new THREE.ExtrudeGeometry(ring, { depth: 0.01, bevelEnabled: false, curveSegments: 32 }).rotateX(-Math.PI / 2), M.seat, 0, 0.245, 0));
  // Saha
  g.add(part(new THREE.BoxGeometry(0.42, 0.01, 0.3), M.grass, 0, 0.06, 0));
  g.add(part(new THREE.BoxGeometry(0.006, 0.004, 0.3), M.line, 0, 0.068, 0));
  g.add(part(new THREE.TorusGeometry(0.05, 0.004, 4, 20).rotateX(Math.PI / 2), M.line, 0, 0.068, 0));
  // Işık direkleri
  for (const [x, z] of [[-0.4, -0.36], [0.4, -0.36], [-0.4, 0.36], [0.4, 0.36]]) {
    g.add(part(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), M.steel, x, 0.29, z));
    g.add(part(new THREE.BoxGeometry(0.08, 0.05, 0.02), M.white, x, 0.55, z));
  }
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
  const bush = makeModel('kaykit/bush');
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

export function makeDecor(kind: DecorKind): THREE.Object3D {
  if (kind === 'uni') return university();
  if (kind === 'airport') return airport();
  if (kind === 'busstop') return busStop();
  if (kind === 'station') return station();
  if (kind === 'wheel') return ferrisWheel();
  if (kind === 'stadium') return stadium();
  const g = new THREE.Group();
  g.add(pad());
  const m = makeModel(DECOR_MODELS[kind]!);
  m.position.y = 0.04;
  g.add(m);
  return g;
}

// Dönme dolap dönsün, kabinler hep düz dursun
export function animateDecor(obj: THREE.Object3D, dt: number) {
  const w = obj.userData.wheel as { wheel: THREE.Object3D; cabins: THREE.Object3D[] } | undefined;
  if (!w) return;
  w.wheel.rotation.z += dt * 0.25;
  for (const c of w.cabins) c.rotation.z = -w.wheel.rotation.z;
}
