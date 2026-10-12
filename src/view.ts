import * as THREE from 'three';
import { SIZE, RES_LEVELS, COM_LEVELS, PARK_MODELS, BASE, PROPS, PLOT, PLOTS, SKINS, RIVER, SEA_ROWS } from './config';
import { City, DIRS, idx, inBounds, isUtility, isService, isIndustry, isDecor, isZone, isWater, isWaterXZ, isSandXZ } from './city';
import { makeDecor, animateDecor, palm } from './landmarks';
import { mergeStatic, disposeMerged } from './batcher';
import { railPiece } from './rails';
import { riverMat, worldUV, RIVER_Y, SEA_Y } from './water';

// Hareket eden parçası olan nesneler (pervane, duman, dönme dolap, ışık, alev) ayrı çizilir;
// geri kalan her şey 8x8'lik bölgeler halinde birleştirilir.
const needsLive = (o: THREE.Object3D) =>
  !!(o.userData.spin || o.userData.smoke || o.userData.blink || o.userData.wheel || o.userData.ship || o.userData.carousel || o.userData.beam || o.userData.bob || o.getObjectByName('flames'));
import { makeModel } from './assets';
import { makeUtility, animateUtility } from './utilities';
import { makeService, animateService, makeHall } from './services';
import { makeIndustry, setWorking, animatePort } from './industry';

// Kenney yol modellerinin hangi kenarları açık (kuzey 1, doğu 2, güney 4, batı 8)
const ROAD_BASES: [string, number][] = [
  ['kaykit/road_straight', 0b0101],
  ['kaykit/road_corner_curved', 0b0110],
  ['kaykit/road_tsplit', 0b0111],
  ['kaykit/road_junction', 0b1111],
];

// Her kare için sabit "rastgele" sayı (aynı karede hep aynı süsler çıksın)
const hash = (x: number, z: number, seed = 0) => {
  const v = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

// Sokak lambasının ucunda gece yanan ışık (DayNight 'lamp' adlı malzemeyi yakar)
const lampMat = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff2c0', emissiveIntensity: 0 });
lampMat.name = 'lamp';
const lampGeo = new THREE.SphereGeometry(0.028, 8, 6);
export function streetLight(dx: number, dz: number, rot: number) {
  const g = prop(PROPS.streetlight, dx, dz, rot);
  const bulb = new THREE.Mesh(lampGeo, lampMat);
  bulb.position.set(-0.11, 0.455, 0); // kolun ucu (lamba modeli kolu -x yönünde)
  g.add(bulb);
  return g;
}

// Bir modeli kare merkezine göre (dx, dz) konumuna, verilen açıyla koy
function prop(path: string, dx: number, dz: number, rot = 0, scale = 1) {
  const o = makeModel(path);
  o.position.set(dx, 0, dz);
  o.rotation.y = rot;
  if (scale !== 1) o.scale.multiplyScalar(scale);
  return o;
}

// Boş arsaların zemin rengi
const lotGeo = new THREE.BoxGeometry(0.92, 0.03, 0.92);
const lotMats = {
  res: new THREE.MeshStandardMaterial({ color: '#8fd46f' }),
  com: new THREE.MeshStandardMaterial({ color: '#7cc3f2' }),
};

// Maskeyi k kere 90° döndür (three.js'te +90° doğuyu kuzeye çevirir)
function rotateMask(m: number, k: number) {
  let r = 0;
  for (let d = 0; d < 4; d++) if (m & (1 << d)) r |= 1 << ((d + 3 * k) % 4);
  return r;
}

const ROAD_TABLE = new Map<number, { model: string; k: number }>();
for (const [model, base] of ROAD_BASES) {
  for (let k = 0; k < 4; k++) {
    const m = rotateMask(base, k);
    if (!ROAD_TABLE.has(m)) ROAD_TABLE.set(m, { model, k });
  }
}

export function roadPiece(mask: number) {
  return ROAD_TABLE.get(mask) ?? { model: ROAD_BASES[0][0], k: mask & 0b1010 ? 1 : 0 };
}

// Binaların kapısı modelde güneye bakıyor; istenen yöne çevirmek için kaç tur
export const FACING_TURNS = [2, 1, 0, 3];

export const tileCenter = (x: number, z: number) => new THREE.Vector3(x - SIZE / 2 + 0.5, 0, z - SIZE / 2 + 0.5);

type IconType = 'road' | 'power' | 'water' | 'upgrade' | 'full' | 'fire' | 'repair' | 'coin' | 'sale';
const ICON_COLORS: Record<IconType, string> = {
  road: '#e53935', power: '#ffb300', water: '#1e88e5', upgrade: '#43a047', full: '#8e44ad',
  fire: '#ff5722', repair: '#607d8b', coin: '#f9a825', sale: '#00897b',
};

// Binaların üstünde çıkan simgeler: yol yok (!), elektrik yok (şimşek), su yok (damla),
// yükseltilebilir (yeşil ok), depo dolu (mor kutu)
function iconTexture(type: IconType) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = ICON_COLORS[type];
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#fff';
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = '#fff';
  g.beginPath();
  if (type === 'road') {
    g.fillRect(28, 14, 8, 24);
    g.arc(32, 46, 5, 0, Math.PI * 2);
  } else if (type === 'power') {
    // Şimşek
    g.moveTo(36, 10);
    g.lineTo(18, 36);
    g.lineTo(30, 36);
    g.lineTo(26, 54);
    g.lineTo(46, 26);
    g.lineTo(34, 26);
    g.lineTo(40, 10);
  } else if (type === 'upgrade') {
    // Yukarı ok
    g.moveTo(32, 10);
    g.lineTo(52, 32);
    g.lineTo(40, 32);
    g.lineTo(40, 52);
    g.lineTo(24, 52);
    g.lineTo(24, 32);
    g.lineTo(12, 32);
  } else if (type === 'fire') {
    // Alev
    g.moveTo(32, 10);
    g.bezierCurveTo(44, 24, 48, 34, 44, 44);
    g.bezierCurveTo(40, 54, 24, 54, 20, 44);
    g.bezierCurveTo(16, 34, 24, 28, 26, 20);
    g.bezierCurveTo(30, 28, 32, 26, 32, 10);
  } else if (type === 'repair') {
    // İngiliz anahtarı
    g.save();
    g.translate(32, 32);
    g.rotate(-Math.PI / 4);
    g.fillRect(-5, -6, 10, 26);
    g.arc(0, -12, 10, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ICON_COLORS.repair;
    g.fillRect(-4, -26, 8, 12);
    g.restore();
    g.fillStyle = '#fff';
  } else if (type === 'sale') {
    // Artı işareti: satın alınabilir arazi
    g.fillRect(28, 14, 8, 36);
    g.fillRect(14, 28, 36, 8);
  } else if (type === 'coin') {
    // Para: içinde ₺ yazan altın
    g.font = 'bold 34px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('₺', 32, 34);
  } else if (type === 'full') {
    // Kutu
    g.fillRect(16, 24, 32, 26);
    g.fillStyle = ICON_COLORS.full;
    g.fillRect(28, 24, 8, 12);
    g.fillStyle = '#fff';
    g.moveTo(14, 22);
    g.lineTo(50, 22);
    g.lineTo(44, 14);
    g.lineTo(20, 14);
  } else {
    // Su damlası
    g.moveTo(32, 12);
    g.bezierCurveTo(32, 12, 16, 32, 16, 40);
    g.arc(32, 40, 16, Math.PI, 0, true);
    g.bezierCurveTo(48, 32, 32, 12, 32, 12);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const ICON_MATS = Object.fromEntries(
  (Object.keys(ICON_COLORS) as IconType[]).map(t => [t, new THREE.SpriteMaterial({ map: iconTexture(t), depthTest: false })]),
) as Record<IconType, THREE.SpriteMaterial>;
const ICON_Y = 2.2;
const MAX_ICONS = 60;

// Yanan binanın üstünde titreyen alevler
const flameMats = [new THREE.MeshBasicMaterial({ color: '#ff6d00' }), new THREE.MeshBasicMaterial({ color: '#ffc400' })];
function flames() {
  const g = new THREE.Group();
  g.name = 'flames';
  for (let n = 0; n < 5; n++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.48, 6).translate(0, 0.24, 0), flameMats[n % 2]);
    c.position.set(Math.cos(n * 1.3) * 0.22, 0.6 + (n % 3) * 0.15, Math.sin(n * 1.3) * 0.22);
    g.add(c);
  }
  return g;
}

// Park: çim zemin, yürüyüş yolu, banklar, ağaçlar; çeşide göre çeşme ya da gölet
const parkMats = {
  lawn: new THREE.MeshStandardMaterial({ color: '#6cc35a' }),
  path: new THREE.MeshStandardMaterial({ color: '#e6d8b8' }),
  water: new THREE.MeshStandardMaterial({ color: '#4fb3e8', roughness: 0.2 }),
};
const parkGeo = {
  lawn: new THREE.BoxGeometry(0.98, 0.03, 0.98),
  pathX: new THREE.BoxGeometry(0.98, 0.012, 0.16),
  pathZ: new THREE.BoxGeometry(0.16, 0.012, 0.98),
  pond: new THREE.CylinderGeometry(0.2, 0.2, 0.012, 20),
};
function park(variant: number, x: number, z: number) {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number, px = 0, pz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(px, y, pz);
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  add(parkGeo.lawn, parkMats.lawn, 0.015);
  const type = variant % 3;
  if (type === 0) {
    // Çapraz yollar, köşelerde ağaç
    add(parkGeo.pathX, parkMats.path, 0.035);
    add(parkGeo.pathZ, parkMats.path, 0.035);
    for (const [dx, dz] of [[-0.3, -0.3], [0.3, 0.3]]) g.add(prop(PROPS.treeLarge, dx, dz, hash(x, z, dx)));
    for (const [dx, dz] of [[0.3, -0.3], [-0.3, 0.3]]) g.add(prop(PROPS.treeSmall, dx, dz, hash(x, z, dz)));
    g.add(prop(PROPS.bench, 0.2, 0.13, Math.PI));
    g.add(prop(PROPS.bench, -0.2, -0.13));
  } else if (type === 1) {
    // Gölet ve etrafında banklar
    add(parkGeo.pathX, parkMats.path, 0.035, 0, 0.36);
    add(parkGeo.pond, parkMats.water, 0.035, 0, -0.05);
    g.add(prop(PROPS.bench, -0.2, 0.26));
    g.add(prop(PROPS.bench, 0.2, 0.26));
    g.add(prop(PROPS.treeLarge, -0.36, -0.34, 1));
    g.add(prop(PROPS.treeSmall, 0.36, -0.36, 2));
    g.add(prop(PROPS.bush, 0.38, 0.05));
    g.add(prop(PROPS.bush, -0.38, 0.05));
  } else {
    // Ortada çeşme
    g.add(makeModel(PARK_MODELS[2]));
    g.add(prop(PROPS.treeSmall, -0.36, -0.36, 1, 0.9));
    g.add(prop(PROPS.treeSmall, 0.36, 0.36, 2, 0.9));
    g.add(prop(PROPS.bush, 0.36, -0.36));
    g.add(prop(PROPS.bush, -0.36, 0.36));
  }
  return g;
}

// Nehir: iki uzun su şeridi ve kıyılarda toprak/kum şeritleri
const bankMat = new THREE.MeshStandardMaterial({ color: '#cdb98a', roughness: 1 });
// Nehrin denize karıştığı yer: nehir suyuyla aynı, ama denize doğru saydamlaşır
const mouthMat = riverMat.clone();
Object.assign(mouthMat, { vertexColors: true, transparent: true, depthWrite: false });
function river() {
  const g = new THREE.Group();
  const [a, b] = RIVER;
  const len = b + 1; // haritanın kenarından köşeye kadar
  const add = (w: number, d: number, x: number, z: number, m: THREE.Material, y: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), m);
    mesh.position.set(x - SIZE / 2, y, z - SIZE / 2);
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  // Su: doğu kolu (denizden köşeye) ve güney kolu (batıdan köşeye), şehir dışındaki nehirle aynı yükseklikte
  const water = (geo: THREE.BufferGeometry) => {
    const mesh = new THREE.Mesh(worldUV(geo), riverMat);
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  const plane = (w: number, d: number, x: number, z: number) =>
    new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x - SIZE / 2, RIVER_Y, z - SIZE / 2);
  const s = SEA_ROWS;
  water(plane(2, len - s, a + 1, (len + s) / 2));
  water(plane(len - 2, 2, (len - 2) / 2, a + 1));
  // Ağız: nehir kumsalın kenarından deniz seviyesine iner, genişleyip denizin rengine karışarak kaybolur
  const rows: [number, number, number, number][] = [
    // [kıyıdan uzaklık, yükseklik, yarım genişlik, görünürlük]
    [0, RIVER_Y, 1, 1], [0.5, SEA_Y + 0.004, 1.1, 0.95], [1.4, SEA_Y + 0.004, 1.45, 0.6], [2.6, SEA_Y + 0.004, 1.9, 0.25], [3.8, SEA_Y + 0.004, 2.3, 0],
  ];
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const cx = a + 1 - SIZE / 2, z0 = s - SIZE / 2;
  rows.forEach(([d, y, h, alpha], k) => {
    pos.push(cx - h, y, z0 - d, cx + h, y, z0 - d);
    col.push(1, 1, 1, alpha, 1, 1, 1, alpha);
    if (k) idx.push(k * 2 - 2, k * 2 - 1, k * 2, k * 2, k * 2 - 1, k * 2 + 1);
  });
  const mouth = new THREE.BufferGeometry();
  mouth.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mouth.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  mouth.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  mouth.setIndex(idx);
  const mouthMesh = new THREE.Mesh(worldUV(mouth), mouthMat);
  mouthMesh.renderOrder = 0;
  g.add(mouthMesh);
  // Kıyı şeritleri
  add(0.12, len - 2 - s, a + 0.06, (len - 2 + s) / 2, bankMat, -0.004);
  add(0.12, len - s, b + 0.94, (len + s) / 2, bankMat, -0.004);
  add(len - 2, 0.12, (len - 2) / 2, a + 0.06, bankMat, -0.004);
  add(len, 0.12, len / 2, b + 0.94, bankMat, -0.004);
  return g;
}

// Köprü: yol/rayın kenarlarına korkuluk, altına ayak
const railMat = new THREE.MeshStandardMaterial({ color: '#e8e4dc' });
const pillarMat = new THREE.MeshStandardMaterial({ color: '#9a9690' });
export function bridge(mask: number) {
  const g = new THREE.Group();
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  // Bağlantı olmayan kenarlara korkuluk
  if (!(mask & 1)) add(1, 0.08, 0.04, 0, 0.09, -0.48, railMat);
  if (!(mask & 4)) add(1, 0.08, 0.04, 0, 0.09, 0.48, railMat);
  if (!(mask & 2)) add(0.04, 0.08, 1, 0.48, 0.09, 0, railMat);
  if (!(mask & 8)) add(0.04, 0.08, 1, -0.48, 0.09, 0, railMat);
  // Köprü ayağı ve gövde
  add(0.98, 0.04, 0.98, 0, -0.01, 0, pillarMat);
  add(0.16, 0.12, 0.16, 0, -0.06, 0, pillarMat);
  return g;
}

// Lüks kulenin tepesi: altın taç, anten ve gece yanan uyarı ışığı
const crownMat = new THREE.MeshStandardMaterial({ color: '#e0b84c', metalness: 0.6, roughness: 0.35 });
const beaconMat = new THREE.MeshStandardMaterial({ color: '#ff5252', emissive: '#ff5252', emissiveIntensity: 0 });
beaconMat.name = 'lamp';
function crown(top: number) {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.y = y;
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(new THREE.CylinderGeometry(0.13, 0.17, 0.08, 8), crownMat, top + 0.04);
  add(new THREE.CylinderGeometry(0.07, 0.11, 0.1, 8), crownMat, top + 0.13);
  add(new THREE.CylinderGeometry(0.008, 0.012, 0.42, 6), crownMat, top + 0.39);
  add(new THREE.SphereGeometry(0.022, 8, 6), beaconMat, top + 0.61);
  return g;
}

export class CityView {
  readonly root = new THREE.Group();
  private objs = new Map<number, THREE.Object3D>();
  private icons = new Map<string, THREE.Sprite>();
  private animated = new Set<THREE.Object3D>(); // türbin, santral, polis ışıkları
  private live = new Set<number>(); // ayrı çizilen kareler
  private chunks = new Map<number, THREE.Group>(); // birleştirilmiş bölgeler
  private dirty = new Set<number>(); // yeniden birleştirilecek bölgeler
  shadowDirty = true; // gölgeler yeniden çizilmeli mi
  private coverage: THREE.InstancedMesh;
  private pops: { obj: THREE.Object3D; t: number; i: number }[] = [];
  private preview: THREE.InstancedMesh;
  private tmp = new THREE.Object3D();
  private time = 0;
  private land = new THREE.Group(); // satılık arazilerin "+" işaretleri
  private landShade = new THREE.Group(); // satın alınmamış arazinin koyu örtüsü (sadece inşa ederken)
  private landMat = new THREE.MeshBasicMaterial({ color: '#1d3b24', transparent: true, opacity: 0.26, depthWrite: false });

  constructor(private city: City) {
    const geo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
    this.preview = new THREE.InstancedMesh(geo, mat, SIZE * SIZE);
    this.preview.count = 0;
    this.preview.renderOrder = 1;
    this.root.add(this.preview);

    // Hizmet binalarının kapsama alanı (renkli, yarı saydam kareler)
    this.coverage = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false }),
      SIZE * SIZE,
    );
    this.coverage.count = 0;
    this.coverage.renderOrder = 1;
    this.root.add(this.coverage);
    this.root.add(this.land);
    this.root.add(river());
  }

  // Satın alınmamış arazi parçalarını koyulaştır, satılık olanların ortasına "+" koy
  updateLand() {
    for (let c = 0; c < PLOTS * PLOTS; c++) this.dirty.add(c);
    this.land.clear();
    this.landShade.clear();
    this.land.add(this.landShade);
    const geo = new THREE.PlaneGeometry(PLOT, PLOT).rotateX(-Math.PI / 2);
    for (let p = 0; p < PLOTS * PLOTS; p++) {
      if (this.city.owned[p]) continue;
      const px = p % PLOTS, pz = Math.floor(p / PLOTS);
      const m = new THREE.Mesh(geo, this.landMat);
      m.position.set((px + 0.5) * PLOT - SIZE / 2, 0.09, (pz + 0.5) * PLOT - SIZE / 2);
      m.renderOrder = 1;
      this.landShade.add(m);
      const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => this.city.owned[(pz + dz) * PLOTS + px + dx] === 1 && px + dx >= 0 && px + dx < PLOTS && pz + dz >= 0 && pz + dz < PLOTS);
      if (next) {
        const s = new THREE.Sprite(ICON_MATS.sale);
        s.position.set(m.position.x, 0.8, m.position.z);
        s.scale.setScalar(0.9);
        this.land.add(s);
      }
    }
  }

  // İnşa ederken satın alınmamış arazi koyulaşsın; gezerken doğal görünsün
  showLandShade(on: boolean) {
    this.landShade.visible = on;
  }

  setCity(city: City) {
    this.city = city;
    this.rebuildAll();
  }

  rebuildAll() {
    this.updateLand();
    for (const i of [...this.objs.keys()]) this.remove(i);
    for (let i = 0; i < SIZE * SIZE; i++) this.build(i, false);
    for (let c = 0; c < PLOTS * PLOTS; c++) this.dirty.add(c);
    this.flush();
    this.updateIcons();
  }

  private chunkOf(i: number) {
    return Math.floor(Math.floor(i / SIZE) / PLOT) * PLOTS + Math.floor((i % SIZE) / PLOT);
  }

  // Değişen bölgeleri yeniden birleştir
  private flush() {
    for (const c of this.dirty) {
      const old = this.chunks.get(c);
      if (old) {
        this.root.remove(old);
        disposeMerged(old);
        this.chunks.delete(c);
      }
      const cx = (c % PLOTS) * PLOT, cz = Math.floor(c / PLOTS) * PLOT;
      const list: THREE.Object3D[] = [];
      for (let z = cz; z < cz + PLOT; z++) {
        for (let x = cx; x < cx + PLOT; x++) {
          const i = idx(x, z);
          const o = this.objs.get(i);
          if (o && !this.live.has(i)) list.push(o);
          else if (!this.city.tiles[i] && !isWater(i)) {
            const n = this.nature(i);
            if (n) list.push(n);
          }
        }
      }
      if (list.length) {
        const g = mergeStatic(list);
        this.root.add(g);
        this.chunks.set(c, g);
      }
    }
    if (this.dirty.size) this.shadowDirty = true;
    this.dirty.clear();
  }

  // Değişen kareleri ve yanlarındaki yolları yeniden çiz
  refresh(cells: number[], animate: boolean) {
    const all = new Set<number>();
    for (const i of cells) {
      all.add(i);
      const x = i % SIZE, z = Math.floor(i / SIZE);
      for (const [dx, dz] of DIRS) if (inBounds(x + dx, z + dz)) all.add(idx(x + dx, z + dz));
    }
    for (const i of all) this.build(i, animate && cells.includes(i));
    this.updateIcons();
  }

  private remove(i: number) {
    const old = this.objs.get(i);
    if (!old) return;
    if (this.live.has(i)) {
      this.root.remove(old);
      this.live.delete(i);
    }
    this.animated.delete(old);
    this.objs.delete(i);
    this.dirty.add(this.chunkOf(i));
  }

  private build(i: number, animate: boolean) {
    this.remove(i);
    const t = this.city.tiles[i];
    if (!t || t.kind === 'part') return; // büyük binaların diğer kareleri ana karede çizilir
    const x = i % SIZE, z = Math.floor(i / SIZE);
    let o: THREE.Object3D;
    if (t.kind === 'road') {
      o = this.road(x, z);
      if (isWaterXZ(x, z)) o.add(bridge(this.city.roadMask(x, z)));
      // Hemzemin geçit: yolun üstünden yola dik raylar geçer
      if (t.level === 1) {
        const across = railPiece(this.city.roadMask(x, z) === 0b0101 ? 0b1010 : 0b0101, false);
        across.position.y = 0.03;
        o.add(across);
      }
    } else if (t.kind === 'rail') {
      o = railPiece(this.city.railMask(x, z));
      if (isWaterXZ(x, z)) o.add(bridge(this.city.railMask(x, z)));
    } else if (t.kind === 'park') {
      o = park(t.variant, x, z);
    } else if (isUtility(t.kind)) {
      o = makeUtility(t.kind);
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
    } else if (t.kind === 'hall') {
      o = makeHall();
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
    } else if (isService(t.kind)) {
      o = makeService(t.kind);
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
    } else if (isDecor(t.kind)) {
      o = makeDecor(t.kind);
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
    } else if (isIndustry(t.kind)) {
      o = makeIndustry(t.kind, t.variant);
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
    } else if (t.level === 0) {
      // Boş arsa: bölge renginde zemin ve birkaç inşaat kasası
      o = new THREE.Group();
      const plate = new THREE.Mesh(lotGeo, lotMats[t.kind]);
      plate.position.y = 0.015;
      plate.receiveShadow = true;
      o.add(plate);
      const kind = hash(x, z, 3);
      if (kind < 0.4) o.add(prop(hash(x, z, 4) < 0.5 ? PROPS.boxA : PROPS.boxB, (hash(x, z, 5) - 0.5) * 0.5, (hash(x, z, 6) - 0.5) * 0.5, hash(x, z, 7) * 6));
      else if (kind < 0.75) {
        // İnşaat alanı: bariyer ve koniler
        o.add(prop(PROPS.barrier, 0, 0.3));
        for (const dx of [-0.3, 0.3]) o.add(prop(PROPS.cone, dx, -0.25));
        if (kind < 0.55) o.add(prop(PROPS.workLight, -0.3, 0.05, 1));
      }
    } else {
      o = this.building(t.kind, t.level, t.variant, t.facing);
      if (t.fire) {
        // Alevler çatının üstünde yansın
        const top = new THREE.Box3().setFromObject(o).max.y;
        const fl = flames();
        fl.position.y = top - 0.65;
        o.add(fl);
      }
      // Depremde hasar gören bina biraz eğilsin
      if (t.damaged) o.children[0].rotation.z = 0.08;
    }

    // Büyük binalar: modeli büyüt ve kapladığı alanın ortasına koy
    const n = t.fp ?? 1;
    if (n > 1) {
      const wrap = new THREE.Group();
      o.scale.multiplyScalar(n * 0.96);
      wrap.add(o);
      wrap.userData = o.userData;
      o = wrap;
    }
    o.position.add(tileCenter(x + (n - 1) / 2, z + (n - 1) / 2));
    this.objs.set(i, o);
    this.dirty.add(this.chunkOf(i));
    const moving = needsLive(o);
    if (moving) this.animated.add(o);
    if (moving || animate) {
      this.root.add(o);
      this.live.add(i);
    }
    if (animate) {
      o.scale.setScalar(0.01);
      this.pops.push({ obj: o, t: 0, i });
    }
  }

  // Yol karesi: yön ve kavşak türü komşulara göre; kenarlarda sokak lambası, kavşakta trafik ışığı
  private road(x: number, z: number) {
    const g = new THREE.Group();
    const mask = this.city.roadMask(x, z);
    const p = roadPiece(mask);
    const straight = p.model === ROAD_BASES[0][0];
    const alongX = straight && (mask & 0b1010) !== 0 && (mask & 0b0101) === 0;
    // Kavşağa bitişik düz yollarda yaya geçidi
    const nearJunction = straight && DIRS.some(([dx, dz]) => {
      const m = this.city.isRoad(x + dx, z + dz) ? this.city.roadMask(x + dx, z + dz) : 0;
      return [1, 2, 4, 8].filter(b => m & b).length >= 3;
    });
    const r = makeModel(nearJunction ? 'kaykit/road_straight_crossing' : p.model);
    r.rotation.y = (p.k * Math.PI) / 2;
    g.add(r);
    if (straight) {
      const along = alongX ? x : z;
      const side = hash(x, z) < 0.5 ? 1 : -1;
      // Lambanın kolu yola doğru uzansın
      if (along % 3 === 0) {
        if (alongX) g.add(streetLight(0, side * 0.46, side > 0 ? -Math.PI / 2 : Math.PI / 2));
        else g.add(streetLight(side * 0.46, 0, side > 0 ? 0 : Math.PI));
      } else if (along % 5 === 1 && hash(x, z, 2) < 0.6) {
        if (alongX) g.add(prop(PROPS.hydrant, 0.2, -side * 0.45));
        else g.add(prop(PROPS.hydrant, -side * 0.45, 0.2));
      }
    } else if (p.model === 'kaykit/road_junction' || p.model === 'kaykit/road_tsplit') {
      g.add(prop(PROPS.traffic, 0.45, 0.45, -Math.PI / 4));
    }
    return g;
  }

  // Seviyeye göre bina: model ve yön rastgele sayıdan seçilir; bazıları aynalanır ki çeşit artsın
  private building(kind: 'res' | 'com', level: number, variant: number, facing: number) {
    const models = (kind === 'res' ? RES_LEVELS : COM_LEVELS)[level - 1].models;
    const path = models[variant % models.length];
    const group = new THREE.Group();
    const folder = path.slice(0, path.lastIndexOf('/'));
    const skins = (SKINS[folder]?.length ?? 0) + 1;
    const b = makeModel(path, Math.floor(variant / 5) % skins);
    b.rotation.y = (FACING_TURNS[facing] * Math.PI) / 2;
    if (Math.floor(variant / 11) % 2) b.scale.x *= -1;
    group.add(b);
    if (kind === 'res' && level >= 6) {
      // Lüks kule: daha yüksek ve tepesinde taç
      b.scale.y *= 1.3;
      b.updateMatrixWorld(true);
      group.add(crown(new THREE.Box3().setFromObject(b).max.y + 0.05));
    }
    if (folder === 'kenney-sub') {
      // Banliyö evi: arka bahçede çalı ve ağaç (yönü binayla aynı dönsün)
      const yard = new THREE.Group();
      yard.rotation.y = b.rotation.y;
      yard.add(prop(PROPS.bush, -0.38, -0.38, variant));
      if (variant % 3) yard.add(prop(PROPS.treeSmall, 0.36, -0.36, variant * 2, 0.8));
      if (variant % 4 === 1) yard.add(prop(PROPS.planter, 0.34, 0.38));
      group.add(yard);
    } else if (!path.startsWith('kaykit/')) {
      // Diğer binaların altına kaldırım
      group.add(makeModel(BASE));
      b.position.y = 0.05;
    }
    return group;
  }

  // Boş karelerde ağaç ve çalı (şehir boş görünmesin); satın alınmamış arazide daha sık
  private nature(i: number): THREE.Object3D | null {
    const x = i % SIZE, z = Math.floor(i / SIZE);
    const owned = this.city.isOwned(i);
    // Kumsalda arada bir palmiye
    if (isSandXZ(x, z)) {
      if (hash(x, z, 9) > 0.22) return null;
      const o = palm((hash(x, z, 11) - 0.5) * 0.5, (hash(x, z, 12) - 0.5) * 0.4, 0.26 + hash(x, z, 14) * 0.12, (hash(x, z, 13) - 0.5) * 0.4);
      o.rotation.y = hash(x, z, 10) * 6;
      o.position.add(tileCenter(x, z));
      return o;
    }
    if (hash(x, z, 9) > (owned ? 0.16 : 0.32)) return null;
    const pick = hash(x, z, 10);
    const path = pick < 0.4 ? PROPS.treeLarge : pick < 0.58 ? PROPS.treeSmall : pick < 0.72 ? PROPS.treePine : pick < 0.76 ? PROPS.treeBlossom : PROPS.bush;
    const o = prop(path, (hash(x, z, 11) - 0.5) * 0.5, (hash(x, z, 12) - 0.5) * 0.5, hash(x, z, 13) * 6, 0.8 + hash(x, z, 14) * 0.5);
    o.position.add(tileCenter(x, z));
    return o;
  }

  // Binaların üstündeki simgeleri güncelle (sorunlar, yükseltme, depo dolu)
  updateIcons() {
    const want = new Map<string, { i: number; type: IconType; slot: number }>();
    const now = Date.now();
    for (const i of this.city.waiting(now)) want.set(`${i}|full`, { i, type: 'full', slot: 0 });
    this.city.tiles.forEach((t, i) => {
      if (t?.kind === 'factory') {
        const obj = this.objs.get(i);
        if (obj) setWorking(obj, (this.city.jobs.get(i) ?? []).some(j => j.end > now));
      }
      if (t?.kind === 'hall' && this.city.treasury >= 1) want.set(`${i}|coin`, { i, type: 'coin', slot: 0 });
      if (!t || !isZone(t.kind) || t.level === 0) return;
      if (t.fire) {
        want.set(`${i}|fire`, { i, type: 'fire', slot: 0 });
        return;
      }
      if (t.damaged) {
        want.set(`${i}|repair`, { i, type: 'repair', slot: 0 });
        return;
      }
      if (this.city.canUpgrade(i)) {
        want.set(`${i}|upgrade`, { i, type: 'upgrade', slot: 0 });
        return;
      }
      if (!this.city.isConnected(i)) {
        want.set(`${i}|road`, { i, type: 'road', slot: 0 });
        return;
      }
      const lack = this.city.lacking.get(i);
      if (lack?.power) want.set(`${i}|power`, { i, type: 'power', slot: 0 });
      if (lack?.water) want.set(`${i}|water`, { i, type: 'water', slot: lack.power ? 1 : 0 });
    });
    // Çok fazla simge telefonu yavaşlatır: en önemli 60 tanesi gösterilsin
    const ORDER: IconType[] = ['fire', 'road', 'repair', 'full', 'coin', 'power', 'water', 'upgrade'];
    if (want.size > MAX_ICONS) {
      const keep = [...want].sort((a, b) => ORDER.indexOf(a[1].type) - ORDER.indexOf(b[1].type)).slice(0, MAX_ICONS);
      want.clear();
      for (const [k, v] of keep) want.set(k, v);
    }
    for (const [key, s] of this.icons) {
      if (!want.has(key)) {
        this.root.remove(s);
        this.icons.delete(key);
      }
    }
    for (const [key, { i, type, slot }] of want) {
      if (this.icons.has(key)) continue;
      const s = new THREE.Sprite(ICON_MATS[type]);
      s.position.copy(tileCenter(i % SIZE, Math.floor(i / SIZE)));
      const t = this.city.tiles[i];
      // Yükseltme oku binanın üstünde dursun, uyarılar sabit yükseklikte
      const top = (type === 'upgrade' || type === 'fire' || type === 'repair') && t ? 1 + t.level * 0.45 : type === 'full' || type === 'coin' ? 1.25 : ICON_Y;
      s.userData.y = top + slot * 0.55;
      s.userData.phase = (i * 0.37) % (Math.PI * 2);
      s.scale.setScalar(type === 'upgrade' ? 0.42 : 0.5);
      s.renderOrder = 2;
      this.root.add(s);
      this.icons.set(key, s);
    }
  }

  // Seçili binanın altını sarı renkle işaretle
  showSelection(cells: number[]) {
    this.showPreview(cells.map(i => ({ i, ok: true })), '#ffd54a');
  }

  showPreview(cells: { i: number; ok: boolean }[], color = '#4caf50') {
    const okColor = new THREE.Color(color);
    const badColor = new THREE.Color('#e53935');
    cells.forEach(({ i, ok }, n) => {
      this.tmp.position.copy(tileCenter(i % SIZE, Math.floor(i / SIZE))).setY(0.08);
      this.tmp.updateMatrix();
      this.preview.setMatrixAt(n, this.tmp.matrix);
      this.preview.setColorAt(n, ok ? okColor : badColor);
    });
    this.preview.count = cells.length;
    this.preview.instanceMatrix.needsUpdate = true;
    if (this.preview.instanceColor) this.preview.instanceColor.needsUpdate = true;
  }

  showCoverage(cells: number[], color: string) {
    const c = new THREE.Color(color);
    cells.forEach((i, n) => {
      this.tmp.position.copy(tileCenter(i % SIZE, Math.floor(i / SIZE))).setY(0.07);
      this.tmp.updateMatrix();
      this.coverage.setMatrixAt(n, this.tmp.matrix);
      this.coverage.setColorAt(n, c);
    });
    this.coverage.count = cells.length;
    this.coverage.instanceMatrix.needsUpdate = true;
    if (this.coverage.instanceColor) this.coverage.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    this.time += dt;
    // Yeni binalar "zıplayarak" ortaya çıksın; bitince bölgesiyle birleştirilsin
    if (this.pops.length) this.shadowDirty = true;
    this.pops = this.pops.filter(p => {
      p.t = Math.min(1, p.t + dt / 0.35);
      const s = 1 + 2.7 * Math.pow(p.t - 1, 3) + 1.7 * Math.pow(p.t - 1, 2);
      p.obj.scale.setScalar(Math.max(0.01, s));
      if (p.t < 1) return true;
      if (this.objs.get(p.i) === p.obj && !needsLive(p.obj)) {
        this.root.remove(p.obj);
        this.live.delete(p.i);
        this.dirty.add(this.chunkOf(p.i));
      }
      return false;
    });
    this.flush();
    // Uyarı simgeleri hafifçe zıplasın
    for (const s of this.icons.values()) {
      s.position.y = s.userData.y + Math.sin(this.time * 3 + s.userData.phase) * 0.06;
    }
    for (const o of this.animated) {
      animateUtility(o, this.time, dt);
      animateService(o, this.time);
      animateDecor(o, dt);
      animatePort(o, this.time, (Date.now() - this.city.lastShipped) / 1000);
      const fl = o.getObjectByName('flames');
      if (fl) {
        fl.children.forEach((c, n) => {
          const k = 0.75 + Math.sin(this.time * 12 + n * 1.7) * 0.25;
          c.scale.set(k, 0.8 + Math.sin(this.time * 9 + n) * 0.3, k);
        });
      }
    }
  }
}
