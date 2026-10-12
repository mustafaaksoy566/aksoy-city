import * as THREE from 'three';
import { INDUSTRY_MODELS, PROPS, BASE, type IndustryKind } from './config';
import { part, mat, pad, windowMat } from './utilities';
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

// Çiftçi pazarı: arkada kırmızı ambar, önde tenteli tezgahlar ve sebze kasaları
function market() {
  const g = new THREE.Group();
  g.add(pad());
  const barn = mat('#c0392b');
  // Ambar ve beşik çatı
  g.add(part(box(0.5, 0.26, 0.3), barn, 0, 0.17, -0.2));
  const roofShape = new THREE.Shape([new THREE.Vector2(-0.28, 0), new THREE.Vector2(0.28, 0), new THREE.Vector2(0, 0.14)]);
  g.add(part(new THREE.ExtrudeGeometry(roofShape, { depth: 0.34, bevelEnabled: false }), M.dark, 0, 0.3, -0.37));
  g.add(part(box(0.14, 0.16, 0.01), M.white, 0, 0.12, -0.045));
  g.add(part(box(0.11, 0.13, 0.012), M.wood, 0, 0.11, -0.04));
  for (const x of [-0.16, 0.16]) g.add(part(box(0.08, 0.07, 0.01), windowMat, x, 0.2, -0.046));
  // Tezgahlar: her birinin tentesi farklı renk
  const awnings = ['#43a047', '#e53935', '#fbc02d'];
  const goods = [mat('#ff8f00'), mat('#7cb342'), mat('#e53935'), mat('#8e24aa')];
  awnings.forEach((color, k) => {
    const x = -0.28 + k * 0.28;
    g.add(part(box(0.22, 0.05, 0.13), M.wood, x, 0.08, 0.2));
    for (const dx of [-0.1, 0.1]) g.add(part(box(0.012, 0.2, 0.012), M.steel, x + dx, 0.14, 0.14));
    for (let s = 0; s < 4; s++) {
      const strip = part(box(0.06, 0.01, 0.17), s % 2 ? M.white : mat(color), x - 0.09 + s * 0.06, 0.25, 0.19);
      strip.rotation.x = 0.3;
      g.add(strip);
    }
    // Kasalarda sebze ve meyve
    for (let c = 0; c < 3; c++) {
      g.add(part(box(0.06, 0.03, 0.06), M.crate, x - 0.07 + c * 0.07, 0.12, 0.2));
      g.add(part(new THREE.SphereGeometry(0.022, 8, 6), goods[(k + c) % goods.length], x - 0.07 + c * 0.07, 0.145, 0.2));
    }
  });
  // Yanda balya ve kasa yığını
  g.add(part(box(0.1, 0.07, 0.07), mat('#e5c46a'), 0.36, 0.075, -0.02));
  g.add(part(box(0.07, 0.05, 0.07), M.crate, -0.37, 0.065, -0.02));
  return g;
}

// Mobilyacı: büyük vitrinli dükkan; vitrinde koltuk ve sandalye, yanda teslimat kamyoneti
function furniture() {
  const g = new THREE.Group();
  g.add(pad());
  const wall = mat('#f3e6d3');
  const teal = mat('#00897b');
  const sofa = mat('#c2185b');
  g.add(part(box(0.7, 0.34, 0.42), wall, 0, 0.21, -0.14));
  g.add(part(box(0.72, 0.05, 0.44), teal, 0, 0.405, -0.14));
  // Vitrin camı ve içindeki mobilyalar
  g.add(part(box(0.5, 0.2, 0.01), windowMat, -0.06, 0.17, 0.072));
  g.add(part(box(0.2, 0.05, 0.08), sofa, -0.14, 0.1, 0.03));
  g.add(part(box(0.2, 0.06, 0.025), sofa, -0.14, 0.14, -0.005));
  for (const dx of [-0.1, 0.1]) g.add(part(box(0.025, 0.07, 0.08), sofa, -0.14 + dx, 0.12, 0.03));
  g.add(part(box(0.06, 0.012, 0.06), M.wood, 0.1, 0.12, 0.03));
  g.add(part(box(0.06, 0.07, 0.01), M.wood, 0.1, 0.15, 0.0));
  g.add(part(box(0.09, 0.2, 0.012), M.dark, 0.26, 0.13, 0.072));
  // Tabela: yeşil levhada beyaz sandalye
  g.add(part(box(0.4, 0.08, 0.02), teal, -0.06, 0.34, 0.08));
  g.add(part(box(0.05, 0.012, 0.01), M.white, -0.06, 0.33, 0.092));
  g.add(part(box(0.012, 0.05, 0.01), M.white, -0.08, 0.345, 0.092));
  // Teslimat kamyoneti
  const van = makeModel('kenney-cars/delivery');
  van.scale.multiplyScalar(0.6);
  van.position.set(0.3, 0.04, 0.28);
  van.rotation.y = Math.PI;
  g.add(van);
  return g;
}

// Ticaret merkezi (2x2 olarak büyütülür): büyük ambar, konteyner yığınları, tabela
function tradeCenter() {
  const g = new THREE.Group();
  g.add(makeModel(BASE));
  const b = makeModel('kenney-ind/building-r', 1);
  b.scale.multiplyScalar(0.8);
  b.position.set(0, 0.05, -0.12);
  g.add(b);
  const boxes = [PROPS.containerA, PROPS.containerB, PROPS.containerC];
  g.add(item(boxes[0], -0.26, 0.3, Math.PI / 2));
  g.add(item(boxes[1], -0.26, 0.3, Math.PI / 2).translateY(0.11));
  g.add(item(boxes[2], 0.08, 0.32, Math.PI / 2));
  // Tabela: mavi levha
  g.add(part(box(0.06, 0.32, 0.06), M.steel, 0.36, 0.2, 0.36));
  g.add(part(box(0.24, 0.1, 0.03), mat('#1e6fd9'), 0.36, 0.38, 0.36));
  g.add(part(box(0.16, 0.025, 0.01), M.white, 0.36, 0.38, 0.377));
  return g;
}

export function makeIndustry(kind: IndustryKind, variant = 0): THREE.Object3D {
  if (kind === 'trade') return tradeCenter();
  if (kind === 'factory') return factory(variant);
  if (kind === 'store') return store();
  if (kind === 'market') return market();
  if (kind === 'furniture') return furniture();
  return depot(variant);
}

// Fabrika çalışıyorsa duman göster
export function setWorking(obj: THREE.Object3D, working: boolean) {
  const smoke = obj.userData.smoke as { puffs: THREE.Mesh[] } | undefined;
  if (smoke) for (const p of smoke.puffs) p.visible = working;
}
