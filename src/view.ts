import * as THREE from 'three';
import { SIZE, RES_LEVELS, COM_LEVELS, PARK_MODELS, PAVEMENT, WALL_COLORS, ROOF_COLORS, PLOT, PLOTS } from './config';
import { City, DIRS, idx, inBounds, isUtility, isService, isIndustry, isDecor, isZone } from './city';
import { makeDecor, animateDecor } from './landmarks';
import { makeModel } from './assets';
import { makeUtility, animateUtility } from './utilities';
import { makeService, animateService, makeHall } from './services';
import { makeIndustry, setWorking } from './industry';

// Kenney yol modellerinin hangi kenarları açık (kuzey 1, doğu 2, güney 4, batı 8)
const ROAD_BASES: [string, number][] = [
  ['kenney/models/road-straight', 0b0101],
  ['kenney/models/road-corner', 0b1100],
  ['kenney/models/road-split', 0b1110],
  ['kenney/models/road-intersection', 0b1111],
];

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

function roadPiece(mask: number) {
  return ROAD_TABLE.get(mask) ?? { model: ROAD_BASES[0][0], k: mask & 0b1010 ? 1 : 0 };
}

// Binaların kapısı modelde güneye bakıyor; istenen yöne çevirmek için kaç tur
const FACING_TURNS = [2, 1, 0, 3];

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

export class CityView {
  readonly root = new THREE.Group();
  private objs = new Map<number, THREE.Object3D>();
  private icons = new Map<string, THREE.Sprite>();
  private animated = new Set<THREE.Object3D>(); // türbin, santral, polis ışıkları
  private coverage: THREE.InstancedMesh;
  private pops: { obj: THREE.Object3D; t: number }[] = [];
  private preview: THREE.InstancedMesh;
  private tmp = new THREE.Object3D();
  private time = 0;
  private land = new THREE.Group(); // satın alınmamış arazinin koyu örtüsü
  private landMat = new THREE.MeshBasicMaterial({ color: '#1d3b24', transparent: true, opacity: 0.38, depthWrite: false });

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
  }

  // Satın alınmamış arazi parçalarını koyulaştır, satılık olanların ortasına "+" koy
  updateLand() {
    this.land.clear();
    const geo = new THREE.PlaneGeometry(PLOT, PLOT).rotateX(-Math.PI / 2);
    for (let p = 0; p < PLOTS * PLOTS; p++) {
      if (this.city.owned[p]) continue;
      const px = p % PLOTS, pz = Math.floor(p / PLOTS);
      const m = new THREE.Mesh(geo, this.landMat);
      m.position.set((px + 0.5) * PLOT - SIZE / 2, 0.09, (pz + 0.5) * PLOT - SIZE / 2);
      m.renderOrder = 1;
      this.land.add(m);
      const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => this.city.owned[(pz + dz) * PLOTS + px + dx] === 1 && px + dx >= 0 && px + dx < PLOTS && pz + dz >= 0 && pz + dz < PLOTS);
      if (next) {
        const s = new THREE.Sprite(ICON_MATS.sale);
        s.position.set(m.position.x, 0.8, m.position.z);
        s.scale.setScalar(0.9);
        this.land.add(s);
      }
    }
  }

  setCity(city: City) {
    this.city = city;
    this.rebuildAll();
  }

  rebuildAll() {
    this.updateLand();
    for (const i of [...this.objs.keys()]) this.remove(i);
    for (let i = 0; i < SIZE * SIZE; i++) this.build(i, false);
    this.updateIcons();
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
    this.root.remove(old);
    this.animated.delete(old);
    this.objs.delete(i);
  }

  private build(i: number, animate: boolean) {
    this.remove(i);
    const t = this.city.tiles[i];
    if (!t) return;
    const x = i % SIZE, z = Math.floor(i / SIZE);
    let o: THREE.Object3D;
    if (t.kind === 'road') {
      const p = roadPiece(this.city.roadMask(x, z));
      // Bazı düz yollara sokak lambası koy
      const name = p.model === ROAD_BASES[0][0] && (x + z) % 4 === 0 ? 'kenney/models/road-straight-lightposts' : p.model;
      o = makeModel(name);
      o.rotation.y = (p.k * Math.PI) / 2;
    } else if (t.kind === 'park') {
      o = makeModel(PARK_MODELS[t.variant % PARK_MODELS.length]);
    } else if (isUtility(t.kind)) {
      o = makeUtility(t.kind);
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
      this.animated.add(o);
    } else if (t.kind === 'hall') {
      o = makeHall();
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
    } else if (isService(t.kind)) {
      o = makeService(t.kind);
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
      this.animated.add(o);
    } else if (isDecor(t.kind)) {
      o = makeDecor(t.kind);
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
      this.animated.add(o);
    } else if (isIndustry(t.kind)) {
      o = makeIndustry(t.kind);
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
      this.animated.add(o);
    } else if (t.level === 0) {
      o = new THREE.Mesh(lotGeo, lotMats[t.kind]);
      o.position.y = 0.015;
      o.receiveShadow = true;
    } else {
      o = this.building(t.kind, t.level, t.variant, t.facing);
      if (t.fire) {
        // Alevler çatının üstünde yansın
        const top = new THREE.Box3().setFromObject(o).max.y;
        const fl = flames();
        fl.position.y = top - 0.65;
        o.add(fl);
        this.animated.add(o);
      }
      // Depremde hasar gören bina biraz eğilsin
      if (t.damaged) o.children[0].rotation.z = 0.08;
    }

    o.position.add(tileCenter(x, z));
    if (animate) {
      o.scale.setScalar(0.01);
      this.pops.push({ obj: o, t: 0 });
    }
    this.root.add(o);
    this.objs.set(i, o);
  }

  // Seviyeye göre bina: model, duvar rengi ve yön rastgele sayıdan seçilir
  private building(kind: 'res' | 'com', level: number, variant: number, facing: number) {
    const models = (kind === 'res' ? RES_LEVELS : COM_LEVELS)[level - 1].models;
    const path = models[variant % models.length];
    const group = new THREE.Group();
    const isCity = path.startsWith('polypizza/');
    const wall = isCity ? WALL_COLORS[Math.floor(variant / 7) % WALL_COLORS.length] : undefined;
    const roof = isCity ? ROOF_COLORS[Math.floor(variant / 3) % ROOF_COLORS.length] : undefined;
    const b = makeModel(path, wall, roof);
    b.rotation.y = (FACING_TURNS[facing] * Math.PI) / 2;
    group.add(b);
    // Ticari kit binalarının altına kaldırım koy
    if (isCity) {
      group.add(makeModel(PAVEMENT));
      b.position.y = 0.06;
    }
    return group;
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

  showPreview(cells: { i: number; ok: boolean }[]) {
    const okColor = new THREE.Color('#4caf50');
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
    // Yeni binalar "zıplayarak" ortaya çıksın
    this.pops = this.pops.filter(p => {
      p.t = Math.min(1, p.t + dt / 0.35);
      const s = 1 + 2.7 * Math.pow(p.t - 1, 3) + 1.7 * Math.pow(p.t - 1, 2);
      p.obj.scale.setScalar(Math.max(0.01, s));
      return p.t < 1;
    });
    // Uyarı simgeleri hafifçe zıplasın
    for (const s of this.icons.values()) {
      s.position.y = s.userData.y + Math.sin(this.time * 3 + s.userData.phase) * 0.06;
    }
    for (const o of this.animated) {
      animateUtility(o, this.time, dt);
      animateService(o, this.time);
      animateDecor(o, dt);
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
