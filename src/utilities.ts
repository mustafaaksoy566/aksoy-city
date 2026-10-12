import * as THREE from 'three';
import type { UtilKind } from './config';
import { makeModel } from './assets';

// Elektrik ve su yapıları: hazır model bulamadığımız için basit şekillerden kendimiz yapıyoruz.
// Kenney'nin sade, renkli tarzına uysun diye düz renkler kullanılıyor.

export const mat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
// Gece ışığı yanan cam (DayNight 'window' adlı malzemeleri yakar)
export const windowMat = new THREE.MeshStandardMaterial({ color: '#9fd3ea', roughness: 0.3, metalness: 0.1 });
windowMat.name = 'window';
// Dükkan vitrinleri için saydam cam (arkasındaki eşyalar görünsün)
export const showcaseMat = new THREE.MeshStandardMaterial({ color: '#d6f1ff', transparent: true, opacity: 0.32, roughness: 0.1, depthWrite: false });
const M = {
  pad: mat('#b9bec4'),
  white: mat('#f4f4f2'),
  steel: mat('#8d99a6'),
  cream: mat('#efd9b4'),
  roof: mat('#6d7782'),
  tower: mat('#dcdcd8'),
  red: mat('#d9534f'),
  blue: mat('#4aa8e0'),
  darkBlue: mat('#2f7fb8'),
  pale: mat('#d7e6f0'),
};

export function part(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export const pad = () => part(new THREE.BoxGeometry(0.92, 0.04, 0.92), M.pad, 0, 0.02, 0);

function windTurbine() {
  const g = new THREE.Group();
  g.add(pad());
  g.add(part(new THREE.CylinderGeometry(0.025, 0.055, 1.6, 10), M.white, 0, 0.84, 0));
  g.add(part(new THREE.BoxGeometry(0.08, 0.08, 0.2), M.white, 0, 1.66, 0));
  const hub = new THREE.Group();
  hub.position.set(0, 1.66, 0.12);
  hub.add(part(new THREE.SphereGeometry(0.04, 10, 8), M.white, 0, 0, 0));
  for (let b = 0; b < 3; b++) {
    const arm = new THREE.Group();
    arm.rotation.z = (b * Math.PI * 2) / 3;
    arm.add(part(new THREE.BoxGeometry(0.05, 0.62, 0.012), M.white, 0, 0.33, 0));
    hub.add(arm);
  }
  g.add(hub);
  g.userData.spin = hub;
  return g;
}

function powerPlant() {
  const g = new THREE.Group();
  g.add(pad());
  // Ana bina
  g.add(part(new THREE.BoxGeometry(0.42, 0.28, 0.34), M.cream, -0.2, 0.18, 0.18));
  g.add(part(new THREE.BoxGeometry(0.44, 0.04, 0.36), M.roof, -0.2, 0.34, 0.18));
  // Soğutma kulesi (ortası daralan silindir)
  const profile = [
    new THREE.Vector2(0.24, 0), new THREE.Vector2(0.19, 0.2), new THREE.Vector2(0.15, 0.42),
    new THREE.Vector2(0.155, 0.55), new THREE.Vector2(0.17, 0.66),
  ];
  const tower = part(new THREE.LatheGeometry(profile, 20), new THREE.MeshStandardMaterial({ color: '#dcdcd8', side: THREE.DoubleSide }), 0.18, 0.04, -0.16);
  g.add(tower);
  // Kırmızı-beyaz baca
  for (let s = 0; s < 4; s++) {
    g.add(part(new THREE.CylinderGeometry(0.04, 0.045, 0.22, 10), s % 2 ? M.white : M.red, -0.3, 0.15 + s * 0.22, -0.25));
  }
  // Duman bulutları (main döngüsünde yükselip kaybolur)
  const puffs: THREE.Mesh[] = [];
  for (let p = 0; p < 4; p++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false }),
    );
    m.userData.phase = p / 4;
    puffs.push(m);
    g.add(m);
  }
  g.userData.smoke = { puffs, base: new THREE.Vector3(0.18, 0.72, -0.16) };
  return g;
}

function waterTower() {
  const g = new THREE.Group();
  g.add(makeModel('kaykit/base'));
  const t = makeModel('kaykit/watertower');
  t.scale.multiplyScalar(2.2);
  t.position.y = 0.05;
  g.add(t);
  return g;
}

function waterPump() {
  const g = new THREE.Group();
  g.add(pad());
  g.add(part(new THREE.BoxGeometry(0.4, 0.26, 0.3), M.pale, -0.18, 0.17, 0.2));
  g.add(part(new THREE.BoxGeometry(0.42, 0.04, 0.32), M.darkBlue, -0.18, 0.32, 0.2));
  g.add(part(new THREE.CylinderGeometry(0.15, 0.15, 0.36, 16), M.blue, 0.2, 0.22, -0.18));
  g.add(part(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 16), M.blue, -0.2, 0.19, -0.22));
  const pipe = part(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 8), M.steel, 0, 0.12, -0.2);
  pipe.rotation.z = Math.PI / 2;
  g.add(pipe);
  return g;
}

function solarFarm() {
  const g = new THREE.Group();
  g.add(makeModel('kaykit/base'));
  const p = makeModel('kenney-ind/solar-panel-landscape-group');
  p.position.y = 0.05;
  g.add(p);
  return g;
}

export function makeUtility(kind: UtilKind): THREE.Object3D {
  if (kind === 'wind') return windTurbine();
  if (kind === 'solar') return solarFarm();
  if (kind === 'plant') return powerPlant();
  if (kind === 'tower') return waterTower();
  return waterPump();
}

// Pervaneleri döndür, dumanı yükselt
export function animateUtility(obj: THREE.Object3D, time: number, dt: number) {
  const spin = obj.userData.spin as THREE.Object3D | undefined;
  if (spin) spin.rotation.z -= dt * 2.2;
  const smoke = obj.userData.smoke as { puffs: THREE.Mesh[]; base: THREE.Vector3 } | undefined;
  if (smoke) {
    for (const p of smoke.puffs) {
      const k = (time * 0.35 + p.userData.phase) % 1;
      p.position.copy(smoke.base).add(new THREE.Vector3(k * 0.15, k * 0.7, 0));
      p.scale.setScalar(0.6 + k * 1.4);
      (p.material as THREE.MeshStandardMaterial).opacity = 0.75 * (1 - k);
    }
  }
}
