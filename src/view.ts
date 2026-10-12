import * as THREE from 'three';
import { SIZE, RES_LEVELS, COM_LEVELS, PARK_MODELS, PAVEMENT, WALL_COLORS } from './config';
import { City, DIRS, idx, inBounds } from './city';
import { makeModel } from './assets';

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

function warningTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e53935';
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 44px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('!', 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CityView {
  readonly root = new THREE.Group();
  private objs = new Map<number, THREE.Object3D>();
  private warns = new Map<number, THREE.Sprite>();
  private pops: { obj: THREE.Object3D; t: number }[] = [];
  private warnMat = new THREE.SpriteMaterial({ map: warningTexture(), depthTest: false });
  private preview: THREE.InstancedMesh;
  private tmp = new THREE.Object3D();

  constructor(private city: City) {
    const geo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
    this.preview = new THREE.InstancedMesh(geo, mat, SIZE * SIZE);
    this.preview.count = 0;
    this.preview.renderOrder = 1;
    this.root.add(this.preview);
  }

  setCity(city: City) {
    this.city = city;
    this.rebuildAll();
  }

  rebuildAll() {
    for (const o of this.objs.values()) this.root.remove(o);
    this.objs.clear();
    for (let i = 0; i < SIZE * SIZE; i++) this.build(i, false);
    this.updateWarnings();
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
    this.updateWarnings();
  }

  private build(i: number, animate: boolean) {
    const old = this.objs.get(i);
    if (old) this.root.remove(old);
    this.objs.delete(i);

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

  // Yola bağlı olmayan binaların üstünde kırmızı ünlem göster
  private updateWarnings() {
    const want = new Set<number>();
    this.city.tiles.forEach((t, i) => {
      if ((t?.kind === 'res' || t?.kind === 'com') && t.level > 0 && !this.city.isConnected(i)) want.add(i);
    });
    for (const [i, s] of this.warns) {
      if (!want.has(i)) {
        this.root.remove(s);
        this.warns.delete(i);
      }
    }
    for (const i of want) {
      if (this.warns.has(i)) continue;
      const s = new THREE.Sprite(this.warnMat);
      s.position.copy(tileCenter(i % SIZE, Math.floor(i / SIZE))).setY(2.2);
      s.scale.setScalar(0.5);
      s.renderOrder = 2;
      this.root.add(s);
      this.warns.set(i, s);
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

  // Yeni binalar "zıplayarak" ortaya çıksın
  update(dt: number) {
    this.pops = this.pops.filter(p => {
      p.t = Math.min(1, p.t + dt / 0.35);
      const s = 1 + 2.7 * Math.pow(p.t - 1, 3) + 1.7 * Math.pow(p.t - 1, 2);
      p.obj.scale.setScalar(Math.max(0.01, s));
      return p.t < 1;
    });
  }
}
