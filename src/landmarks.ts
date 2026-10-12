import * as THREE from 'three';
import { DECOR_MODELS, type DecorKind } from './config';
import { part, mat, pad } from './utilities';
import { makeModel } from './assets';

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

export function makeDecor(kind: DecorKind): THREE.Object3D {
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
