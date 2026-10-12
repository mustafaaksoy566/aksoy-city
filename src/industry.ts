import * as THREE from 'three';
import type { IndustryKind } from './config';
import { part, mat, pad } from './utilities';

// Fabrika, hırdavatçı ve depo: basit şekillerden yapılmış modeller.
// Ön yüz +z (güney) tarafında; yola bakacak şekilde döndürülüyorlar.

const M = {
  wall: mat('#c9d3dc'),
  wallDark: mat('#8796a5'),
  roof: mat('#5b6b80'),
  glass: mat('#9fd3ea'),
  dark: mat('#3c3f44'),
  brick: mat('#b5533c'),
  orange: mat('#f39c3d'),
  white: mat('#f4f4f2'),
  wood: mat('#b07a45'),
  crate: mat('#c8955a'),
  green: mat('#4f9a5b'),
  asphalt: mat('#6b6f75'),
  steel: mat('#8d99a6'),
};

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function factory() {
  const g = new THREE.Group();
  g.add(pad());
  g.add(part(box(0.7, 0.3, 0.5), M.wall, -0.04, 0.19, -0.1));
  // Testere dişi çatı
  const tooth = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.175, 0), new THREE.Vector2(0, 0.14)]);
  const toothGeo = new THREE.ExtrudeGeometry(tooth, { depth: 0.5, bevelEnabled: false }).translate(0, 0, -0.25);
  for (let k = 0; k < 4; k++) g.add(part(toothGeo, M.roof, -0.39 + k * 0.175, 0.34, -0.1));
  g.add(part(box(0.7, 0.07, 0.01), M.glass, -0.04, 0.24, 0.155));
  g.add(part(box(0.22, 0.17, 0.01), M.dark, 0.14, 0.125, 0.156));
  // Tuğla baca
  g.add(part(new THREE.CylinderGeometry(0.05, 0.065, 0.75, 10), M.brick, -0.32, 0.42, -0.26));
  // Önde kasalar
  g.add(part(box(0.1, 0.08, 0.1), M.crate, -0.3, 0.08, 0.3));
  g.add(part(box(0.08, 0.06, 0.08), M.crate, -0.18, 0.07, 0.32));
  g.add(part(box(0.08, 0.06, 0.08), M.crate, -0.3, 0.15, 0.3));
  // Çalışırken bacadan duman çıksın
  const puffs: THREE.Mesh[] = [];
  for (let p = 0; p < 3; p++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshStandardMaterial({ color: '#e8e8e8', transparent: true, opacity: 0.8, depthWrite: false }),
    );
    m.userData.phase = p / 3;
    m.visible = false;
    puffs.push(m);
    g.add(m);
  }
  g.userData.smoke = { puffs, base: new THREE.Vector3(-0.32, 0.82, -0.26) };
  return g;
}

function store() {
  const g = new THREE.Group();
  g.add(pad());
  g.add(part(box(0.66, 0.36, 0.46), M.white, 0, 0.22, -0.12));
  g.add(part(box(0.68, 0.04, 0.48), M.wood, 0, 0.42, -0.12));
  g.add(part(box(0.5, 0.15, 0.01), M.glass, -0.06, 0.18, 0.115));
  g.add(part(box(0.1, 0.18, 0.01), M.dark, 0.24, 0.13, 0.115));
  // Turuncu-beyaz çizgili tente
  for (let k = 0; k < 6; k++) {
    const s = part(box(0.11, 0.012, 0.14), k % 2 ? M.white : M.orange, -0.275 + k * 0.11, 0.3, 0.17);
    s.rotation.x = 0.35;
    g.add(s);
  }
  // Tabela: turuncu levha üstünde çekiç
  g.add(part(box(0.36, 0.08, 0.02), M.orange, 0, 0.36, 0.12));
  g.add(part(box(0.12, 0.03, 0.01), M.white, 0, 0.37, 0.132));
  g.add(part(box(0.03, 0.06, 0.01), M.white, 0.04, 0.35, 0.132));
  // Önde kalas yığını
  for (let k = 0; k < 3; k++) g.add(part(box(0.28, 0.025, 0.06), M.wood, -0.18, 0.055 + k * 0.025, 0.32));
  return g;
}

function depot() {
  const g = new THREE.Group();
  g.add(pad());
  g.add(part(box(0.72, 0.2, 0.56), M.wallDark, 0, 0.14, -0.08));
  // Yarım silindir çatı
  const roof = part(new THREE.CylinderGeometry(0.28, 0.28, 0.72, 16, 1, false, 0, Math.PI), M.green, 0, 0.24, -0.08);
  roof.rotation.z = Math.PI / 2;
  g.add(roof);
  g.add(part(box(0.3, 0.17, 0.01), M.steel, 0, 0.125, 0.205));
  for (let k = 0; k < 4; k++) g.add(part(box(0.3, 0.006, 0.012), M.dark, 0, 0.06 + k * 0.04, 0.212));
  // Paletler
  g.add(part(box(0.14, 0.03, 0.14), M.wood, -0.27, 0.055, 0.32));
  g.add(part(box(0.1, 0.1, 0.1), M.crate, -0.27, 0.12, 0.32));
  g.add(part(box(0.14, 0.03, 0.14), M.wood, 0.27, 0.055, 0.32));
  return g;
}

export function makeIndustry(kind: IndustryKind): THREE.Object3D {
  if (kind === 'factory') return factory();
  if (kind === 'store') return store();
  return depot();
}

// Fabrika çalışıyorsa duman göster
export function setWorking(obj: THREE.Object3D, working: boolean) {
  const smoke = obj.userData.smoke as { puffs: THREE.Mesh[] } | undefined;
  if (smoke) for (const p of smoke.puffs) p.visible = working;
}
