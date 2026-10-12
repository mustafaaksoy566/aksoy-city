import * as THREE from 'three';
import { INDUSTRY_MODELS, PROPS, BASE, type IndustryKind } from './config';
import { part, mat, pad } from './utilities';
import { makeModel } from './assets';

// Fabrika ve depo: Kenney City Kit Industrial binaları (CC0) ve çevrelerinde baca, tank, konteyner.
// Hırdavatçı: basit şekillerden yapılmış dükkan.
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

// Bir eşyayı kare içinde (x, z) konumuna koy
function item(path: string, x: number, z: number, rot = 0) {
  const o = makeModel(path);
  o.position.set(x, 0.05, z);
  o.rotation.y = rot;
  return o;
}

function factory(variant: number) {
  const g = new THREE.Group();
  g.add(makeModel(BASE));
  const models = INDUSTRY_MODELS.factory;
  const b = makeModel(models[variant % models.length], Math.floor(variant / 7) % 4);
  b.scale.multiplyScalar(0.92);
  b.position.set(-0.04, 0.05, -0.04);
  g.add(b);
  // Köşede baca, yanında tank
  const chimney = item(variant % 2 ? PROPS.chimneyLarge : PROPS.chimney, 0.34, -0.34);
  g.add(chimney);
  if (variant % 3 !== 0) g.add(item(PROPS.tank, -0.34, 0.33));
  // Bacadan duman (fabrika çalışırken görünür)
  chimney.updateMatrixWorld(true);
  const top = new THREE.Box3().setFromObject(chimney).max.y;
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
  g.userData.smoke = { puffs, base: new THREE.Vector3(0.34, top + 0.02, -0.34) };
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

function depot(variant: number) {
  const g = new THREE.Group();
  g.add(makeModel(BASE));
  const models = INDUSTRY_MODELS.depot;
  const b = makeModel(models[variant % models.length], Math.floor(variant / 7) % 4);
  b.scale.multiplyScalar(0.85);
  b.position.set(0, 0.05, -0.08);
  g.add(b);
  // Önde konteynerler
  const boxes = [PROPS.containerA, PROPS.containerB, PROPS.containerC];
  g.add(item(boxes[variant % 3], -0.24, 0.33, Math.PI / 2));
  if (variant % 2) g.add(item(boxes[(variant + 1) % 3], 0.2, 0.34, Math.PI / 2));
  return g;
}

export function makeIndustry(kind: IndustryKind, variant = 0): THREE.Object3D {
  if (kind === 'factory') return factory(variant);
  if (kind === 'store') return store();
  return depot(variant);
}

// Fabrika çalışıyorsa duman göster
export function setWorking(obj: THREE.Object3D, working: boolean) {
  const smoke = obj.userData.smoke as { puffs: THREE.Mesh[] } | undefined;
  if (smoke) for (const p of smoke.puffs) p.visible = working;
}
