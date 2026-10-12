import * as THREE from 'three';
import type { ServiceKind } from './config';
import { part, mat, pad } from './utilities';
import { makeModel } from './assets';

// Polis, itfaiye, hastane ve okul binaları: basit şekillerden yapılmış, Kenney tarzına uygun düz renkler.
// Binaların ön yüzü +z (güney) tarafında; yola bakacak şekilde döndürülüyorlar.

const M = {
  white: mat('#f4f4f2'),
  wall: mat('#eef2f7'),
  glass: mat('#9fd3ea'),
  dark: mat('#3c3f44'),
  roof: mat('#5b6b80'),
  blue: mat('#2f5fb3'),
  red: mat('#d84339'),
  cross: mat('#e53935'),
  yellow: mat('#f2c14e'),
  tile: mat('#c0503a'),
  track: mat('#c96a4a'),
  steel: mat('#8d99a6'),
  asphalt: mat('#6b6f75'),
};

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function police() {
  const g = new THREE.Group();
  g.add(pad());
  g.add(part(box(0.62, 0.34, 0.44), M.wall, 0, 0.21, -0.12));
  g.add(part(box(0.63, 0.06, 0.45), M.blue, 0, 0.3, -0.12));
  g.add(part(box(0.66, 0.04, 0.48), M.roof, 0, 0.4, -0.12));
  g.add(part(box(0.24, 0.03, 0.12), M.blue, 0, 0.22, 0.15));
  g.add(part(box(0.12, 0.17, 0.01), M.dark, 0, 0.12, 0.105));
  for (const x of [-0.2, 0.2]) g.add(part(box(0.13, 0.09, 0.01), M.glass, x, 0.2, 0.105));
  // Çatıda yanıp sönen ışıklar
  const red = new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff3b30', emissiveIntensity: 0 });
  const blue = new THREE.MeshStandardMaterial({ color: '#2f80ff', emissive: '#2f80ff', emissiveIntensity: 0 });
  g.add(part(box(0.06, 0.04, 0.05), red, -0.035, 0.44, -0.12));
  g.add(part(box(0.06, 0.04, 0.05), blue, 0.035, 0.44, -0.12));
  g.userData.blink = [red, blue];
  // Önde park etmiş polis arabası
  const car = makeModel('kaykit/car_police');
  car.position.set(0.24, 0.07, 0.3);
  car.rotation.y = Math.PI / 2;
  g.add(car);
  return g;
}

function fireStation() {
  const g = new THREE.Group();
  g.add(pad());
  g.add(part(box(0.6, 0.01, 0.22), M.asphalt, -0.04, 0.045, 0.3));
  g.add(part(box(0.66, 0.36, 0.46), M.red, -0.04, 0.22, -0.1));
  g.add(part(box(0.68, 0.04, 0.48), M.white, -0.04, 0.42, -0.1));
  for (const x of [-0.2, 0.12]) {
    g.add(part(box(0.24, 0.25, 0.012), M.white, x, 0.165, 0.131));
    g.add(part(box(0.2, 0.22, 0.012), M.dark, x, 0.15, 0.138));
  }
  // Garajın önünde itfaiye aracı
  const truck = makeModel('kenney-cars/firetruck');
  truck.position.set(-0.2, 0.06, 0.3);
  g.add(truck);
  // Gözetleme kulesi
  g.add(part(box(0.16, 0.66, 0.16), M.red, 0.3, 0.37, -0.26));
  g.add(part(new THREE.ConeGeometry(0.14, 0.14, 4).rotateY(Math.PI / 4), M.dark, 0.3, 0.77, -0.26));
  g.add(part(box(0.1, 0.08, 0.01), M.white, 0.3, 0.56, -0.175));
  return g;
}

function hospital() {
  const g = new THREE.Group();
  g.add(pad());
  g.add(part(box(0.74, 0.52, 0.5), M.white, 0, 0.3, -0.1));
  for (const y of [0.2, 0.38]) g.add(part(box(0.75, 0.08, 0.51), M.glass, 0, y, -0.1));
  g.add(part(box(0.78, 0.04, 0.54), M.steel, 0, 0.58, -0.1));
  // Ön yüzde kırmızı haç
  g.add(part(box(0.18, 0.06, 0.02), M.cross, 0, 0.47, 0.16));
  g.add(part(box(0.06, 0.18, 0.02), M.cross, 0, 0.47, 0.16));
  // Giriş saçağı
  g.add(part(box(0.3, 0.03, 0.16), M.cross, 0, 0.16, 0.22));
  for (const x of [-0.13, 0.13]) g.add(part(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6), M.steel, x, 0.1, 0.28));
  // Önde park etmiş ambulans
  // Hastane 2x2 büyütülerek çizildiği için ambulans yarı boyutta eklenir (sonunda normal araba boyunda görünür)
  const amb = makeModel('kenney-cars/ambulance');
  amb.scale.multiplyScalar(0.55);
  amb.position.set(-0.3, 0.04, 0.36);
  amb.rotation.y = Math.PI / 2;
  g.add(amb);
  // Çatıda helikopter pisti
  g.add(part(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 20), M.dark, 0.08, 0.605, -0.12));
  g.add(part(box(0.025, 0.004, 0.14), M.white, 0.04, 0.613, -0.12));
  g.add(part(box(0.025, 0.004, 0.14), M.white, 0.12, 0.613, -0.12));
  g.add(part(box(0.08, 0.004, 0.025), M.white, 0.08, 0.613, -0.12));
  return g;
}

function school() {
  const g = new THREE.Group();
  g.add(pad());
  // Oyun alanı / koşu pisti
  g.add(part(box(0.36, 0.012, 0.3), M.track, 0.24, 0.045, 0.24));
  g.add(part(box(0.66, 0.3, 0.36), M.yellow, -0.06, 0.19, -0.2));
  // Kırma çatı (üçgen prizma)
  const tri = new THREE.Shape([new THREE.Vector2(-0.21, 0), new THREE.Vector2(0.21, 0), new THREE.Vector2(0, 0.16)]);
  const roofGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.7, bevelEnabled: false }).translate(0, 0, -0.35).rotateY(Math.PI / 2);
  g.add(part(roofGeo, M.tile, -0.06, 0.34, -0.2));
  for (const x of [-0.3, -0.16, 0.04, 0.18]) g.add(part(box(0.09, 0.1, 0.01), M.glass, x, 0.22, -0.015));
  g.add(part(box(0.1, 0.16, 0.01), M.dark, -0.06, 0.12, -0.015));
  // Saat kulesi
  g.add(part(box(0.14, 0.34, 0.14), M.yellow, -0.06, 0.55, -0.2));
  g.add(part(new THREE.ConeGeometry(0.12, 0.16, 4).rotateY(Math.PI / 4), M.tile, -0.06, 0.8, -0.2));
  g.add(part(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 14).rotateX(Math.PI / 2), M.white, -0.06, 0.6, -0.128));
  // Bayrak direği
  g.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 6), M.steel, -0.38, 0.34, 0.3));
  g.add(part(box(0.14, 0.09, 0.004), M.cross, -0.31, 0.58, 0.3));
  return g;
}

// Belediye: sütunlu, kubbeli, bayraklı beyaz bina
export function makeHall(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(pad());
  const marble = mat('#f1ece2');
  const dome = mat('#7fb3d5');
  g.add(part(box(0.8, 0.06, 0.6), M.steel, 0, 0.07, -0.02));
  g.add(part(box(0.72, 0.36, 0.42), marble, 0, 0.28, -0.08));
  g.add(part(box(0.76, 0.05, 0.46), M.white, 0, 0.48, -0.08));
  // Ön sütunlar ve üçgen alınlık
  for (const x of [-0.27, -0.09, 0.09, 0.27]) g.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 10), M.white, x, 0.27, 0.18));
  g.add(part(box(0.66, 0.04, 0.1), M.white, 0, 0.46, 0.18));
  const tri = new THREE.Shape([new THREE.Vector2(-0.34, 0), new THREE.Vector2(0.34, 0), new THREE.Vector2(0, 0.12)]);
  g.add(part(new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false }), marble, 0, 0.48, 0.13));
  g.add(part(box(0.16, 0.2, 0.01), M.dark, 0, 0.2, 0.135));
  // Kubbe ve bayrak
  g.add(part(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 20), marble, 0, 0.56, -0.1));
  g.add(part(new THREE.SphereGeometry(0.17, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), dome, 0, 0.62, -0.1));
  g.add(part(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 6), M.steel, 0, 0.92, -0.1));
  g.add(part(box(0.12, 0.07, 0.004), M.cross, 0.06, 1.03, -0.1));
  return g;
}

export function makeService(kind: ServiceKind): THREE.Object3D {
  if (kind === 'police') return police();
  if (kind === 'fire') return fireStation();
  if (kind === 'health') return hospital();
  return school();
}

// Polis ışıkları sırayla yanıp sönsün
export function animateService(obj: THREE.Object3D, time: number) {
  const blink = obj.userData.blink as THREE.MeshStandardMaterial[] | undefined;
  if (!blink) return;
  const on = Math.floor(time * 3) % 2;
  blink[0].emissiveIntensity = on ? 1.5 : 0;
  blink[1].emissiveIntensity = on ? 0 : 1.5;
}
