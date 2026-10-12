import * as THREE from 'three';
import { SIZE, RES_LEVELS, COM_LEVELS, PARK_MODELS, PAVEMENT, WALL_COLORS } from './config';
import { City, DIRS, idx, inBounds, isUtility, isService, isZone } from './city';
import { makeModel } from './assets';
import { makeUtility, animateUtility } from './utilities';
import { makeService, animateService } from './services';

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

type IconType = 'road' | 'power' | 'water';

// Binaların üstünde çıkan uyarı simgeleri: yol yok (!), elektrik yok (şimşek), su yok (damla)
function iconTexture(type: IconType) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = type === 'road' ? '#e53935' : type === 'power' ? '#ffb300' : '#1e88e5';
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

const ICON_MATS: Record<IconType, THREE.SpriteMaterial> = {
  road: new THREE.SpriteMaterial({ map: iconTexture('road'), depthTest: false }),
  power: new THREE.SpriteMaterial({ map: iconTexture('power'), depthTest: false }),
  water: new THREE.SpriteMaterial({ map: iconTexture('water'), depthTest: false }),
};
const ICON_Y = 2.2;

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
  }

  setCity(city: City) {
    this.city = city;
    this.rebuildAll();
  }

  rebuildAll() {
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
    } else if (isService(t.kind)) {
      o = makeService(t.kind);
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
      this.animated.add(o);
    } else if (t.level === 0) {
      o = new THREE.Mesh(lotGeo, lotMats[t.kind]);
      o.position.y = 0.015;
      o.receiveShadow = true;
    } else {
      o = this.building(t.kind, t.level, t.variant, t.facing);
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
    const b = makeModel(path, isCity ? WALL_COLORS[Math.floor(variant / 7) % WALL_COLORS.length] : undefined);
    b.rotation.y = (FACING_TURNS[facing] * Math.PI) / 2;
    group.add(b);
    // Ticari kit binalarının altına kaldırım koy
    if (isCity) {
      group.add(makeModel(PAVEMENT));
      b.position.y = 0.06;
    }
    return group;
  }

  // Yolu, elektriği ya da suyu olmayan binaların üstünde simge göster
  updateIcons() {
    const want = new Map<string, { i: number; type: IconType; slot: number }>();
    this.city.tiles.forEach((t, i) => {
      if (!t || !isZone(t.kind) || t.level === 0) return;
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
      s.userData.y = ICON_Y + slot * 0.55;
      s.userData.phase = (i * 0.37) % (Math.PI * 2);
      s.scale.setScalar(0.5);
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
    }
  }
}
