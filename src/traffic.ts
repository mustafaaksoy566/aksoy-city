import * as THREE from 'three';
import { SIZE, ROAD_GRADES, ENTRANCE_Z } from './config';
import { CarSet, CAR_KINDS, NORMAL_CARS, carPaint, type CarKind } from './cars';
import { City, DIRS, idx, inBounds } from './city';
import { makeModel } from './assets';
import { bakeTextured, bakeModel, vertexColorMat } from './batcher';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeBus } from './sky';
import { tileCenter } from './view';
import { isGreen } from './signals';

const CAR_LANE = 0.16; // arabalar: şeridin yol ortasından uzaklığı (sağdan gidiş)
const WIDE_LANES = [0.1, 0.3]; // caddede (çift şerit) iç ve dış şerit (araçlar yan yana sığsın)
const CAR_Y = 0.066; // asfalt (0.036) + tekerleklerin altı
const CAR_SCALE = 0.78;
const WALK_LANE = 0.43; // yayalar: kaldırım
const WIDE_WALK = 0.468; // caddede kaldırım
const MAX_CARS = 70; // yolda giden araba
const MAX_INSTANCES = 240; // bir araba modelinden en fazla kaç tane (park edenler dahil)
const MAX_WALKERS = 90;
const GAP = 0.07; // arka arkaya iki aracın tamponları arasındaki boşluk (kare)
const STOP = 0.58; // kırmızı ışıkta durulan yer (kavşaktan önceki karede)
const MANEUVER_SPEED = 0.42; // otoparka girip çıkarken (kare/saniye)

// Otopark: arka sırada üç park yeri (otoparkın ortasından yana uzaklık), arabalar yola dönük durur
const BAYS = [-0.3, 0, 0.3];
const BAY_BACK = 0.2;

// Yolda giden bir şey (araba ya da yaya)
interface Mover {
  tile: number; // içinde bulunduğu yol karesi
  dIn: number; // kareye giriş yönü
  dOut: number; // kareden çıkış yönü
  t: number; // karedeki ilerleme (0..1)
  speed: number; // saniyede kaç kare
  fade: number; // görünürlük (belirirken 0'dan 1'e, kaybolurken 1'den 0'a)
  out?: boolean; // gidiyor (kaybolup silinecek)
}

const fwd = (d: number) => new THREE.Vector3(DIRS[d][0], 0, DIRS[d][1]);
const right = (d: number) => new THREE.Vector3(-DIRS[d][1], 0, DIRS[d][0]);
const xz = (tile: number) => [tile % SIZE, Math.floor(tile / SIZE)];
const center = (tile: number) => {
  const [x, z] = xz(tile);
  return tileCenter(x, z);
};

function roadDirs(city: City, tile: number) {
  const [x, z] = xz(tile);
  return [0, 1, 2, 3].filter(d => city.isRoad(x + DIRS[d][0], z + DIRS[d][1]));
}
const neighbor = (tile: number, d: number) => {
  const [x, z] = xz(tile);
  return inBounds(x + DIRS[d][0], z + DIRS[d][1]) ? idx(x + DIRS[d][0], z + DIRS[d][1]) : -1;
};
const isRoadTile = (city: City, tile: number) => tile >= 0 && city.tiles[tile]?.kind === 'road';
// Kavşak: üç ya da dört yöne yol açılan kare
const isJunction = (city: City, tile: number) => isRoadTile(city, tile) && roadDirs(city, tile).length >= 3;
const isDeadEnd = (city: City, tile: number) => roadDirs(city, tile).length === 1;

// Bir sonraki çıkış yönü: geri dönmemeye çalış, çıkmaz sokakta dön.
// Arabalar kalabalık (trafiği yoğun) yolları daha çok seçer: ana yollar dolu görünür.
function pickExit(city: City, tile: number, dIn: number, busy = false) {
  const options = roadDirs(city, tile).filter(d => d !== (dIn + 2) % 4);
  if (!options.length) return (dIn + 2) % 4;
  if (!busy) return options[Math.floor(Math.random() * options.length)];
  const weights = options.map(d => 1 + city.traffic[neighbor(tile, d)] / 12);
  let r = Math.random() * weights.reduce((s, w) => s + w, 0);
  for (let k = 0; k < options.length; k++) if ((r -= weights[k]) <= 0) return options[k];
  return options[options.length - 1];
}

// İlerlet; yol yok olduysa false döner. limit: bu karede en fazla nereye kadar gidebilir (öndeki araç, kırmızı ışık).
// choose: yeni kareye girince hangi yöne çıkılacağı (verilmezse rastgele)
function advance(city: City, m: Mover, step: number, busy = false, limit = Infinity, choose?: (m: Mover) => number) {
  m.t = Math.min(m.t + step, limit);
  while (m.t >= 1) {
    const [x0, z0] = xz(m.tile);
    const x = x0 + DIRS[m.dOut][0], z = z0 + DIRS[m.dOut][1];
    if (!inBounds(x, z) || !city.isRoad(x, z)) {
      // Şehir girişinden otoyola çıkan araba kaybolur; yol yıkıldıysa geri döner
      if (busy && x < 0 && z0 === ENTRANCE_Z) {
        m.t = 0.999;
        m.out = true;
        break;
      }
      m.t -= 1;
      m.dIn = m.dOut;
      m.dOut = (m.dOut + 2) % 4;
      continue;
    }
    m.t -= 1;
    m.tile = idx(x, z);
    m.dIn = m.dOut;
    m.dOut = choose ? choose(m) : pickExit(city, m.tile, m.dIn, busy);
  }
  return city.tiles[m.tile]?.kind === 'road';
}

// Kare içinde girişten çıkışa yumuşak bir eğri (ikinci derece Bezier) üzerinde konum ve yön.
// laneAt: bir yol karesinde şeridin yol ortasına uzaklığı; kare sınırında iki karenin ortalaması alınır.
// Çıkmaz sokağın ucunda adacığın etrafından dönülür.
const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3();
function lanePos(city: City, m: Mover, laneAt: (tile: number) => number, y: number, out: THREE.Vector3, t = m.t): number {
  const [x, z] = xz(m.tile);
  const mid = tileCenter(x, z).setY(y);
  const { dIn, dOut } = m;
  const lane = laneAt(m.tile);
  if (dOut === (dIn + 2) % 4 && isDeadEnd(city, m.tile)) {
    // Dönüş meydanı: kenardan girip adacığın çevresinden yarım daire çizerek geri çık
    const f = fwd(dIn), r = right(dIn);
    // Arabalar uçtaki adacığın çevresinden döner, yayalar bordürün yanından
    const R = lane > 0.4 ? Math.min(0.46, lane) : 0.21;
    const at = (u: number, v: THREE.Vector3) => {
      if (u < 0.3) {
        const k = THREE.MathUtils.smoothstep(u / 0.3, 0, 1);
        return v.copy(mid).addScaledVector(f, -0.5 * (1 - k)).addScaledVector(r, lane + (R - lane) * k);
      }
      if (u < 0.7) {
        const a = ((u - 0.3) / 0.4) * Math.PI;
        return v.copy(mid).addScaledVector(r, R * Math.cos(a)).addScaledVector(f, R * Math.sin(a));
      }
      const k = THREE.MathUtils.smoothstep((u - 0.7) / 0.3, 0, 1);
      return v.copy(mid).addScaledVector(f, -0.5 * k).addScaledVector(r, -(R + (lane - R) * k));
    };
    at(t, out);
    at(Math.min(1, t + 0.01), P);
    if (t >= 0.99) {
      at(0.99, P);
      at(1, out);
      return Math.atan2(out.x - P.x, out.z - P.z);
    }
    return Math.atan2(P.x - out.x, P.z - out.z);
  }
  const side = (d: number, s: number) => {
    const nx = x + DIRS[d][0] * s, nz = z + DIRS[d][1] * s;
    return city.isRoad(nx, nz) ? (laneAt(idx(nx, nz)) + lane) / 2 : lane;
  };
  const laneIn = side(dIn, -1), laneOut = side(dOut, 1);
  A.copy(mid).addScaledVector(fwd(dIn), -0.5).addScaledVector(right(dIn), laneIn);
  B.copy(mid).addScaledVector(fwd(dOut), 0.5).addScaledVector(right(dOut), laneOut);
  if (dIn === dOut) C.copy(mid).addScaledVector(right(dIn), lane);
  else if (dOut === (dIn + 2) % 4) C.copy(mid).addScaledVector(fwd(dIn), 0.35);
  else C.copy(mid).addScaledVector(right(dIn), laneIn).addScaledVector(right(dOut), laneOut);
  const u = 1 - t;
  out.set(0, 0, 0).addScaledVector(A, u * u).addScaledVector(C, 2 * u * t).addScaledVector(B, t * t);
  // Gidiş yönü: eğrinin türevi
  const dx = 2 * u * (C.x - A.x) + 2 * t * (B.x - C.x);
  const dz = 2 * u * (C.z - A.z) + 2 * t * (B.z - C.z);
  return Math.atan2(dx, dz);
}

// Kırmızı ışıkta beklenecek yer: bir sonraki kare kavşaksa ve o yöne ışık kırmızıysa durma çizgisi
function lightLimit(city: City, m: Mover, stop: number) {
  if (m.t > stop) return Infinity; // çizgiyi geçmiş, devam etsin
  const next = neighbor(m.tile, m.dOut);
  if (!isJunction(city, next) || isGreen(next, m.dOut)) return Infinity;
  return stop;
}

// --- Otoparka girip çıkarken izlenen eğriler (üçüncü derece Bezier) ---
interface Seg {
  p: THREE.Vector3[];
  back: boolean; // geri geri gidiliyor
  len: number;
}
function bez(p: THREE.Vector3[], u: number, out: THREE.Vector3) {
  const a = 1 - u;
  return out.set(0, 0, 0).addScaledVector(p[0], a * a * a).addScaledVector(p[1], 3 * a * a * u).addScaledVector(p[2], 3 * a * u * u).addScaledVector(p[3], u * u * u);
}
function bezDir(p: THREE.Vector3[], u: number) {
  const a = 1 - u;
  const dx = 3 * a * a * (p[1].x - p[0].x) + 6 * a * u * (p[2].x - p[1].x) + 3 * u * u * (p[3].x - p[2].x);
  const dz = 3 * a * a * (p[1].z - p[0].z) + 6 * a * u * (p[2].z - p[1].z) + 3 * u * u * (p[3].z - p[2].z);
  return Math.atan2(dx, dz);
}
function seg(p: THREE.Vector3[], back = false): Seg {
  let len = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  bez(p, 0, a);
  for (let k = 1; k <= 10; k++) {
    bez(p, k / 10, b);
    len += a.distanceTo(b);
    a.copy(b);
  }
  return { p, back, len: Math.max(0.05, len) };
}

// Otopark ya da garaj (gökdelen, hastane, itfaiye, karakol): araçların girip çıktığı yer
interface Spot {
  tile: number; // binanın yola bakan karesi
  road: number; // önündeki yol
  face: number; // yola doğru yön
}
interface Parked {
  type: number;
  paint?: THREE.Color;
  noseIn: boolean; // burnu içeride (ileri girip park etti)
  leaving?: boolean; // sahibi yürüyerek geliyor
}
interface Lot extends Spot {
  bays: (Parked | null)[];
  reserved: boolean[];
}
interface Dest {
  kind: 'lot' | 'garage' | 'exit';
  spot?: Spot;
  bay?: number;
  road: number;
}
interface Maneuver {
  segs: Seg[];
  k: number;
  u: number;
  end: 'road' | 'lot' | 'garage';
  dir?: number; // yola çıkınca gidilen yön
  road?: number;
  lot?: Lot;
  bay?: number;
  fadeIn?: boolean;
  fadeOut?: boolean;
}

// Çarpışmayı önlemek için bir aracın ya da yayanın kapladığı yer (bir önceki karedeki)
export interface Box {
  x: number;
  z: number;
  h: number; // yön (açı)
  len: number; // yarı boy
  wid: number; // yarı en
  id: number;
}
let nextId = 1;

interface Vehicle extends Mover {
  id?: number;
  stuck?: number; // önü kapalı bekleme süresi
  type: number; // araba modeli (otobüste -1)
  paint?: THREE.Color; // boyası
  wide: number; // caddede hangi şerit (0 iç, 1 dış)
  trip: number; // kaç kare daha gezecek; bitince hedefine gider
  dest?: Dest;
  man?: Maneuver;
  home?: Spot; // ambulans, itfaiye, polis: döneceği bina
}

// Arabalar ve otobüsler: ışıklarda durur, öndeki aracın arkasında sıraya girer.
// Hiçbiri yolun ortasında belirmez: otoparktan (sahibi evinden yürüyüp biner), gökdelenin garajından,
// hastane/itfaiye/karakoldan çıkar ya da şehir dışından otoyoldan gelir. Gezdikten sonra bir otoparka,
// bir garaja girer ya da otoyoldan şehirden çıkar.
// Her araba modeli için tek bir çoklu çizim (InstancedMesh) kullanılır: telefonda çok daha hızlı.
export class Traffic {
  readonly root = new THREE.Group();
  private cars: Vehicle[] = [];
  private buses: Vehicle[] = [];
  private set: CarSet | null = null;
  private busMesh: THREE.InstancedMesh | null = null;
  private lengths: number[] = []; // her araba modelinin boyu (kare)
  private widths: number[] = [];
  private busLength = 0.6;
  private busWidth = 0.22;
  boxes: Box[] = []; // araçların kapladığı yerler (yayalar da bakar)
  private recount = 0;
  private tmp = new THREE.Object3D();
  private lots = new Map<number, Lot>();
  private garages: Spot[] = []; // gökdelenler
  private stations: (Spot & { kind: 'health' | 'fire' | 'police' })[] = [];
  private fields = new Map<number, Int16Array>(); // her hedef için yollardaki uzaklık
  private roadKey = '';
  private waiting: { lot: Lot; bay: number }[] = []; // sahibi geldi, yola çıkmayı bekliyor
  private pending = 0; // sahibi arabasına yürüyor
  private walkers: Walkers | null = null;
  // Otoban: şehirden çıkan arabalar ona devredilir
  highway: { leaveCity(type: number, paint: THREE.Color): void } | null = null;

  constructor(private city: City) {}

  link(walkers: Walkers) {
    this.walkers = walkers;
  }

  // Modeller yüklendikten sonra çağrılır
  init() {
    const busGeo = bakeModel(makeBus());
    if (busGeo) {
      busGeo.computeBoundingBox();
      const b = busGeo.boundingBox!;
      this.busLength = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
      this.busWidth = Math.min(b.max.x - b.min.x, b.max.z - b.min.z);
      this.busMesh = new THREE.InstancedMesh(busGeo, vertexColorMat, 12);
      this.busMesh.count = 0;
      this.busMesh.frustumCulled = false;
      this.root.add(this.busMesh);
    }
    this.set = new CarSet(CAR_KINDS, MAX_INSTANCES);
    this.root.add(this.set.root);
    this.lengths.push(...this.set.lengths.map(l => l * CAR_SCALE));
    this.widths.push(...this.set.widths.map(w => w * CAR_SCALE));
  }

  setCity(city: City) {
    this.city = city;
    this.cars = [];
    this.buses = [];
    this.lots.clear();
    this.waiting = [];
    this.pending = 0;
    this.roadKey = '';
  }

  // Normal araba modeli (polis, ambulans ve itfaiye kendi binalarından çıkar)
  private pickType() {
    return CAR_KINDS.indexOf(NORMAL_CARS[Math.floor(Math.random() * NORMAL_CARS.length)]);
  }

  private laneOf(v: Vehicle) {
    return (tile: number) => (this.city.tiles[tile]?.grade === 2 ? WIDE_LANES[v.wide] : CAR_LANE);
  }

  private lengthOf(v: Vehicle) {
    return v.type < 0 ? this.busLength : this.lengths[v.type] ?? 0.4;
  }
  private widthOf(v: Vehicle) {
    return v.type < 0 ? this.busWidth : this.widths[v.type] ?? 0.18;
  }

  // Önünde (gideceği yerde) başka bir araç ya da yaya var mı? Kutular bir önceki karedeki yerler.
  // İki araç birbirini bekliyorsa kimliği küçük olan geçer (kilitlenmesin).
  private blocked(me: Box | undefined, people: Box[]) {
    if (!me) return false;
    const fx = Math.sin(me.h), fz = Math.cos(me.h);
    const hit = (o: Box, extra: number) => {
      const rx = o.x - me.x, rz = o.z - me.z;
      const ahead = rx * fx + rz * fz;
      if (ahead <= 0.01) return false;
      const lat = Math.abs(rx * fz - rz * fx);
      const dh = o.h - me.h;
      const c = Math.abs(Math.cos(dh)), s = Math.abs(Math.sin(dh));
      return ahead < me.len + c * o.len + s * o.wid + extra && lat < me.wid + s * o.len + c * o.wid + 0.01;
    };
    for (const o of this.boxes) {
      if (o.id === me.id || !hit(o, 0.06)) continue;
      // Karşılıklı bekleme: o da beni bekliyorsa küçük kimlikli geçer
      const ox = Math.sin(o.h), oz = Math.cos(o.h);
      const back = (me.x - o.x) * ox + (me.z - o.z) * oz > 0.01;
      if (back && me.id < o.id) continue;
      return true;
    }
    for (const p of people) if (hit(p, 0.05)) return true;
    return false;
  }

  // Aynı karede aynı şeritte (aynı yönden gelen, caddede aynı şeritteki) araçlar; dönecek olanlar da sıraya girer
  private key(v: Vehicle, tile = v.tile, dir = v.dIn) {
    return `${tile}|${dir}|${this.city.tiles[tile]?.grade === 2 ? v.wide : 0}`;
  }

  // --- Otoparklar, garajlar ve binalar ---

  // Bir binanın yola bakan karesi ve önündeki yol
  private spotOf(i: number): Spot | null {
    const t = this.city.tiles[i];
    if (!t) return null;
    const cells = this.city.cellsOf(i);
    for (const d of [t.facing, 0, 1, 2, 3]) {
      for (const c of cells) {
        const r = neighbor(c, d);
        if (isRoadTile(this.city, r)) return { tile: c, road: r, face: d };
      }
    }
    return null;
  }

  // Şehirdeki otoparkları ve garajları güncelle (yeni otoparka iki araba park etmiş olarak gelir)
  private scan() {
    const seen = new Set<number>();
    this.garages = [];
    this.stations = [];
    this.city.tiles.forEach((t, i) => {
      if (!t) return;
      if (t.kind === 'parking' && t.level > 0) {
        // Katlı otopark: arabalar girişten girip kaybolur, sonra çıkıp yola katılır (kat arttıkça daha sık)
        const spot = this.spotOf(i);
        if (spot) for (let k = 0; k <= t.level; k++) this.garages.push(spot);
      } else if (t.kind === 'parking') {
        seen.add(i);
        const spot = this.spotOf(i);
        const old = this.lots.get(i);
        if (!spot) {
          this.lots.delete(i);
          return;
        }
        if (old) Object.assign(old, spot);
        else {
          const bays = BAYS.map(() => {
            if (Math.random() >= 0.67) return null;
            const type = this.pickType();
            return { type, noseIn: false, paint: carPaint(CAR_KINDS[type]) };
          });
          this.lots.set(i, { ...spot, bays, reserved: BAYS.map(() => false) });
        }
      } else if (t.kind === 'res' && t.level >= 5) {
        const spot = this.spotOf(i);
        if (spot) this.garages.push(spot);
      } else if (t.kind === 'health' || t.kind === 'fire' || t.kind === 'police') {
        const spot = this.spotOf(i);
        if (spot) this.stations.push({ ...spot, kind: t.kind });
      }
    });
    for (const i of [...this.lots.keys()]) if (!seen.has(i)) this.lots.delete(i);
    this.waiting = this.waiting.filter(w => this.lots.get(w.lot.tile) === w.lot);
    // Yollar değiştiyse hedeflere uzaklıklar yeniden hesaplansın
    let key = 0;
    this.city.tiles.forEach((t, i) => t?.kind === 'road' && (key = (key * 31 + i) | 0));
    if (`${key}` !== this.roadKey) {
      this.roadKey = `${key}`;
      this.fields.clear();
    }
  }

  // Yollar boyunca bir hedef yol karesine uzaklık (her kare için)
  private field(target: number) {
    let f = this.fields.get(target);
    if (f) return f;
    f = new Int16Array(this.city.tiles.length).fill(-1);
    f[target] = 0;
    const queue = [target];
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      for (let d = 0; d < 4; d++) {
        const n = neighbor(c, d);
        if (n < 0 || f[n] >= 0 || !isRoadTile(this.city, n)) continue;
        f[n] = f[c] + 1;
        queue.push(n);
      }
    }
    this.fields.set(target, f);
    return f;
  }

  // Yeni kareye girince: gezerken rastgele (kalabalık yolları severek), hedefi varsa en kısa yoldan
  private choose(v: Vehicle) {
    if (v.trip > 0) v.trip--;
    if (v.trip <= 0 && !v.dest) v.dest = this.pickDest(v);
    const dest = v.dest;
    if (!dest || v.trip > 0) return pickExit(this.city, v.tile, v.dIn, true);
    if (v.tile === dest.road) {
      if (dest.kind === 'exit') return 3; // otoyola çık
      // Hedefin önünde: düz devam etsin (girişe kare ortasında döner)
      const dirs = roadDirs(this.city, v.tile);
      return dirs.includes(v.dIn) ? v.dIn : pickExit(this.city, v.tile, v.dIn, true);
    }
    const f = this.field(dest.road);
    let best = -1, bestD = Infinity;
    for (const d of roadDirs(this.city, v.tile)) {
      const n = neighbor(v.tile, d);
      const dist = f[n] < 0 ? Infinity : f[n] + (d === (v.dIn + 2) % 4 ? 3 : 0) + Math.random() * 0.5;
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    if (best < 0 || bestD === Infinity) {
      // Hedefe yol yok: bir süre daha gezsin
      this.release(v);
      v.trip = 6;
      return pickExit(this.city, v.tile, v.dIn, true);
    }
    return best;
  }

  private release(v: Vehicle) {
    if (v.dest?.kind === 'lot' && v.dest.bay !== undefined) {
      const lot = v.dest.spot as Lot;
      lot.reserved[v.dest.bay] = false;
    }
    v.dest = undefined;
  }

  // Gezinti bitince nereye: bir otoparka, bir gökdelenin garajına ya da otoyoldan şehir dışına
  private pickDest(v: Vehicle): Dest {
    const exit: Dest = { kind: 'exit', road: idx(0, ENTRANCE_Z) };
    if (v.type < 0) return exit;
    if (v.home) return { kind: 'garage', spot: v.home, road: v.home.road };
    const r = Math.random();
    if (r < 0.55) {
      // Yakındaki bir otoparkın boş yeri
      const free = [...this.lots.values()].filter(l => l.bays.some((b, k) => !b && !l.reserved[k]));
      let best: Lot | null = null, bestD = Infinity;
      for (let k = 0; k < 4 && free.length; k++) {
        const lot = free[Math.floor(Math.random() * free.length)];
        const d = this.field(lot.road)[v.tile];
        if (d >= 0 && d < bestD) {
          bestD = d;
          best = lot;
        }
      }
      if (best) {
        const bay = best.bays.findIndex((b, k) => !b && !best!.reserved[k]);
        best.reserved[bay] = true;
        return { kind: 'lot', spot: best, bay, road: best.road };
      }
    }
    if (r < 0.8 && this.garages.length) {
      const g = this.garages[Math.floor(Math.random() * this.garages.length)];
      return { kind: 'garage', spot: g, road: g.road };
    }
    return exit;
  }

  // Yolda bu noktanın yakınında araba var mı (otoparktan çıkarken bekle)
  // dir verilirse sadece o yöne giden araçlara bakılır (karşı şeritten gelenler engel sayılmaz)
  private busyAt(p: THREE.Vector3, dir?: THREE.Vector3) {
    const q = new THREE.Vector3();
    for (const v of [...this.cars, ...this.buses]) {
      let h: number;
      if (v.man) {
        bez(v.man.segs[v.man.k].p, Math.min(1, v.man.u), q);
        h = bezDir(v.man.segs[v.man.k].p, Math.min(1, v.man.u));
      } else h = lanePos(this.city, v, this.laneOf(v), CAR_Y, q);
      if (q.distanceToSquared(p) >= 0.6 * 0.6) continue;
      if (dir && Math.sin(h) * dir.x + Math.cos(h) * dir.z < 0.3) continue;
      return true;
    }
    return false;
  }

  // Binadan ya da otoparktan yola çıkış yönü ve şeritteki nokta
  private exitTo(spot: Spot, v: Vehicle) {
    const dirs = roadDirs(this.city, spot.road).filter(d => d !== (spot.face + 2) % 4);
    const side = dirs.filter(d => d % 2 !== spot.face % 2);
    const list = side.length ? side : dirs.length ? dirs : [spot.face];
    const dir = list[Math.floor(Math.random() * list.length)];
    const pt = new THREE.Vector3();
    lanePos(this.city, { tile: spot.road, dIn: dir, dOut: dir, t: 0.5, speed: 0, fade: 1 }, this.laneOf(v), CAR_Y, pt);
    return { dir, pt };
  }

  private bayPos(lot: Lot, bay: number) {
    return center(lot.tile).setY(CAR_Y).addScaledVector(right(lot.face), BAYS[bay]).addScaledVector(fwd(lot.face), -BAY_BACK);
  }

  // Otoparktaki arabayı yola çıkar
  private pullOut(lot: Lot, bay: number) {
    const p = lot.bays[bay];
    if (!p) return;
    const v: Vehicle = { tile: lot.road, dIn: 0, dOut: 0, t: 0.5, speed: 0.8 + Math.random() * 0.5, fade: 1, type: p.type, paint: p.paint, wide: Math.random() < 0.5 ? 0 : 1, trip: 8 + Math.floor(Math.random() * 25) };
    const { dir, pt } = this.exitTo(lot, v);
    const f = fwd(lot.face), r = right(lot.face);
    const b = this.bayPos(lot, bay);
    const toward = fwd(dir);
    const segs: Seg[] = [];
    if (p.noseIn) {
      // Önce geri geri koridora çık, sonra ileri yola
      const s = Math.sign(toward.dot(r)) || (Math.random() < 0.5 ? -1 : 1);
      const a = center(lot.tile).setY(CAR_Y).addScaledVector(f, 0.16).addScaledVector(r, BAYS[bay] * 0.4);
      segs.push(seg([b, b.clone().addScaledVector(f, 0.22), a.clone().addScaledVector(r, s * 0.14), a], true));
      segs.push(seg([a, a.clone().addScaledVector(r, s * 0.2), pt.clone().addScaledVector(toward, -0.4), pt]));
    } else {
      segs.push(seg([b, b.clone().addScaledVector(f, 0.45), pt.clone().addScaledVector(toward, -0.4), pt]));
    }
    v.man = { segs, k: 0, u: 0, end: 'road', dir, road: lot.road };
    lot.bays[bay] = null;
    this.cars.push(v);
  }

  // Binanın (garajın) içinden yola çık
  private driveOut(spot: Spot, type: number, home?: Spot) {
    const v: Vehicle = { tile: spot.road, dIn: 0, dOut: 0, t: 0.5, speed: 0.8 + Math.random() * 0.5, fade: 0, type, paint: carPaint(CAR_KINDS[type]), wide: Math.random() < 0.5 ? 0 : 1, trip: 10 + Math.floor(Math.random() * 25), home };
    const { dir, pt } = this.exitTo(spot, v);
    const f = fwd(spot.face);
    const g = center(spot.tile).setY(CAR_Y).addScaledVector(f, 0.12);
    if (this.busyAt(pt)) return false;
    v.man = { segs: [seg([g, g.clone().addScaledVector(f, 0.35), pt.clone().addScaledVector(fwd(dir), -0.4), pt])], k: 0, u: 0, end: 'road', dir, road: spot.road, fadeIn: true };
    this.cars.push(v);
    return true;
  }

  // Hedefin önüne gelen araba otoparka ya da garaja girer
  private pullIn(v: Vehicle) {
    const dest = v.dest!;
    const pos = new THREE.Vector3();
    const heading = lanePos(this.city, v, this.laneOf(v), CAR_Y, pos);
    const dir = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const spot = dest.spot!;
    const f = fwd(spot.face);
    if (dest.kind === 'lot') {
      const lot = spot as Lot;
      const b = this.bayPos(lot, dest.bay!);
      v.man = { segs: [seg([pos, pos.clone().addScaledVector(dir, 0.35), b.clone().addScaledVector(f, 0.4), b])], k: 0, u: 0, end: 'lot', lot, bay: dest.bay };
    } else {
      const g = center(spot.tile).setY(CAR_Y).addScaledVector(f, 0.1);
      v.man = { segs: [seg([pos, pos.clone().addScaledVector(dir, 0.35), g.clone().addScaledVector(f, 0.4), g])], k: 0, u: 0, end: 'garage', fadeOut: true };
    }
  }

  // Yeni araba: otoparktan (önce sahibi yürüyerek gelir), gökdelen garajından ya da otoyoldan
  private spawnCar() {
    const r = Math.random();
    if (r < 0.5) {
      const lots = [...this.lots.values()].filter(l => l.bays.some(b => b && !b.leaving));
      if (lots.length) {
        const lot = lots[Math.floor(Math.random() * lots.length)];
        const bay = lot.bays.findIndex(b => b && !b.leaving);
        lot.bays[bay]!.leaving = true;
        const path = this.walkPath(lot, bay);
        if (path && this.walkers) {
          this.pending++;
          this.walkers.addTrip(path, true, false, () => {
            this.pending--;
            this.waiting.push({ lot, bay });
          });
        } else this.waiting.push({ lot, bay });
        return;
      }
    }
    if (r < 0.75 && this.garages.length) {
      const g = this.garages[Math.floor(Math.random() * this.garages.length)];
      if (this.driveOut(g, this.pickType())) return;
    }
    const entrance = idx(0, ENTRANCE_Z);
    // Otoban bağlıysa şehre arabalar otobandan gelir (enterFromHighway)
    if (!this.highway && isRoadTile(this.city, entrance)) {
      const type = this.pickType();
      this.cars.push({ tile: entrance, dIn: 1, dOut: 1, t: 0, speed: 0.8 + Math.random() * 0.5, fade: 0, type, paint: carPaint(CAR_KINDS[type]), wide: Math.random() < 0.5 ? 0 : 1, trip: 12 + Math.floor(Math.random() * 30) });
    }
  }

  // Otobandan şehrin girişine gelen araba şehirde yoluna devam eder; giriş doluysa false (araba otobanda bekler)
  enterFromHighway(type: number, paint: THREE.Color) {
    const entrance = idx(0, ENTRANCE_Z);
    if (!isRoadTile(this.city, entrance) || this.cars.length >= MAX_CARS + 15) return false;
    const v: Vehicle = { tile: entrance, dIn: 1, dOut: 1, t: 0, speed: 0.8 + Math.random() * 0.5, fade: 1, type, paint, wide: 1, trip: 10 + Math.floor(Math.random() * 30) };
    const p = new THREE.Vector3();
    lanePos(this.city, v, this.laneOf(v), CAR_Y, p);
    if (this.busyAt(p, new THREE.Vector3(1, 0, 0))) return false;
    this.cars.push(v);
    return true;
  }

  // Otoparkın yanındaki (aynı kaldırımdaki) bir evden arabaya yürüyüş yolu
  private walkPath(lot: Lot, bay: number): THREE.Vector3[] | null {
    const f = fwd(lot.face);
    const walk = (tile: number) => (this.city.tiles[tile]?.grade === 2 ? WIDE_WALK : WALK_LANE);
    const start = Math.random() < 0.5 ? 1 : 3;
    for (let k = 1; k <= 4; k++) {
      for (const s of [start, (start + 2) % 4]) {
        const along = (lot.face + s) % 4;
        let ok = true;
        let house = lot.tile, road = lot.road;
        for (let j = 1; j <= k && ok; j++) {
          house = neighbor(house, along);
          road = neighbor(road, along);
          if (house < 0 || road < 0 || !isRoadTile(this.city, road) || (j < k && isJunction(this.city, road))) ok = false;
        }
        const h = ok ? this.city.tiles[house] : null;
        if (!h || h.kind !== 'res' || h.level < 1) continue;
        const y = 0.05;
        const door = center(house).setY(y).addScaledVector(f, 0.34);
        const s1 = center(road).setY(y).addScaledVector(f, -walk(road));
        const s0 = center(lot.road).setY(y).addScaledVector(f, -walk(lot.road));
        const gate = center(lot.tile).setY(y).addScaledVector(f, 0.42);
        const car = this.bayPos(lot, bay).setY(y).addScaledVector(f, 0.25).addScaledVector(right(lot.face), 0.12);
        return [door, s1, s0, gate, car];
      }
    }
    return null;
  }

  update(dt: number) {
    // Kaç araç olması gerektiğini saniyede bir hesapla
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 0.6;
      this.scan();
      const roads = this.city.tiles.filter(t => t?.kind === 'road').length;
      const wanted = Math.min(MAX_CARS, Math.floor(roads / 2.5), 3 + Math.floor(this.city.population / 12));
      const moving = this.cars.filter(c => !c.out && !c.home);
      if (moving.length + this.pending + this.waiting.length < wanted) this.spawnCar();
      else if (moving.length > wanted) {
        // Fazla araba varsa biri gezintiyi bitirip yerine dönsün
        const v = moving.find(c => c.trip > 0 && !c.man);
        if (v) v.trip = 1;
      }
      // Ambulans, itfaiye ve polis: kendi binasından çıkar, gezip geri döner
      const emergency = this.cars.filter(c => c.home).length;
      if (this.stations.length && emergency < Math.min(5, Math.ceil(this.stations.length / 3)) && Math.random() < 0.25) {
        const s = this.stations[Math.floor(Math.random() * this.stations.length)];
        const kind: CarKind = s.kind === 'health' ? 'ambulance' : s.kind === 'fire' ? 'fire' : 'police';
        const type = CAR_KINDS.indexOf(kind);
        if (type >= 0) this.driveOut(s, type, s);
      }
      // Otobüsler: her durak için bir tane (en fazla 12), şehre otoyoldan girer
      const stops = this.city.tiles.filter(t => t?.kind === 'busstop').length;
      const busWanted = Math.min(12, stops);
      const activeBuses = this.buses.filter(b => !b.out);
      const entrance = idx(0, ENTRANCE_Z);
      const busStart = new THREE.Vector3();
      lanePos(this.city, { tile: entrance, dIn: 1, dOut: 1, t: 0, speed: 0, fade: 1 }, () => WIDE_LANES[1], CAR_Y, busStart);
      if (activeBuses.length < busWanted && isRoadTile(this.city, entrance) && !this.busyAt(busStart)) {
        this.buses.push({ tile: entrance, dIn: 1, dOut: 1, t: 0, speed: 0.55, fade: 0, type: -1, wide: 1, trip: 1e9 });
      } else if (activeBuses.length > busWanted) activeBuses[0].trip = 0;
    }
    // Sahibi gelen arabalar yol boşalınca çıkar
    this.waiting = this.waiting.filter(w => {
      const p = w.lot.bays[w.bay];
      if (!p) return false;
      const { pt } = this.exitTo(w.lot, { tile: 0, dIn: 0, dOut: 0, t: 0, speed: 0, fade: 1, type: 0, wide: 0, trip: 0 });
      if (this.busyAt(pt)) return true;
      this.pullOut(w.lot, w.bay);
      return false;
    });

    // Karelerdeki araçlar (sıra beklemek için)
    const all = [...this.cars, ...this.buses].filter(v => !v.man);
    const lanes = new Map<string, [number, number][]>();
    for (const v of all) {
      const k = this.key(v);
      (lanes.get(k) ?? lanes.set(k, []).get(k)!).push([v.t, this.lengthOf(v)]);
    }

    const people = this.walkers?.spots ?? [];
    const prev = new Map(this.boxes.map(b => [b.id, b]));
    const move = (v: Vehicle) => {
      v.id ??= nextId++;
      if (v.man) {
        // Otoparka girip çıkarken de önündekini bekle
        if (this.blocked(prev.get(v.id), people) && (v.stuck = (v.stuck ?? 0) + dt) < 5) return true;
        v.stuck = 0;
        return this.maneuver(v, dt);
      }
      v.fade = Math.min(1, Math.max(0, v.fade + (v.out ? -dt : dt) * 2.2));
      if (v.out && v.fade <= 0) {
        this.release(v);
        return false;
      }
      const jam = this.city.congestion(v.tile);
      const step = dt * v.speed * ROAD_GRADES[this.city.tiles[v.tile]?.grade ?? 0].speed * (jam > 1 ? Math.max(0.35, 1 / jam) : 1);
      let limit = lightLimit(this.city, v, STOP);
      const len = this.lengthOf(v);
      // Öndeki araç (aynı karede): iki aracın boylarının yarısı ve aradaki boşluk kadar geride dur
      for (const [t, l] of lanes.get(this.key(v)) ?? []) if (t > v.t + 1e-4) limit = Math.min(limit, t - (len + l) / 2 - GAP);
      // Bir sonraki karenin başındaki araç
      const next = neighbor(v.tile, v.dOut);
      if (next >= 0) for (const [t, l] of lanes.get(this.key(v, next, v.dOut)) ?? []) limit = Math.min(limit, 1 + t - (len + l) / 2 - GAP);
      // Önünde araç ya da yaya varsa dur (uzun süre kilitlenirse yavaşça devam et)
      let go = step;
      if (this.blocked(prev.get(v.id), people)) {
        v.stuck = (v.stuck ?? 0) + dt;
        if (v.stuck < 6) go = 0;
      } else v.stuck = 0;
      const alive = advance(this.city, v, go, true, Math.max(v.t, limit), m => this.choose(m as Vehicle));
      // Şehirden çıkan araba otobana geçer (aynı renk ve model)
      if (v.out && v.type >= 0 && !v.home && this.highway && v.paint) {
        this.highway.leaveCity(v.type, v.paint);
        this.release(v);
        return false;
      }
      if (!alive) {
        this.release(v);
        return false;
      }
      // Hedefinin önüne geldi: otoparka ya da garaja dön
      const dest = v.dest;
      if (dest && v.trip <= 0 && dest.kind !== 'exit' && v.tile === dest.road && v.t >= 0.45 && v.t < 0.95) {
        const t = this.city.tiles[dest.spot!.tile];
        const gone = !t || (dest.kind === 'lot' ? t.kind !== 'parking' || this.lots.get(dest.spot!.tile) !== dest.spot : false);
        if (gone) {
          this.release(v);
          v.trip = 4;
        } else this.pullIn(v);
      }
      return true;
    };
    this.cars = this.cars.filter(move);
    this.buses = this.buses.filter(move);
    const set = this.set;
    if (!set) return;

    set.begin();
    const white = new THREE.Color('#ffffff');
    const put = (type: number, m: THREE.Matrix4, paint?: THREE.Color) => set.put(type, m, paint ?? white);
    this.boxes = [];
    const remember = (v: Vehicle) => {
      if (v.fade < 0.3) return;
      this.boxes.push({ x: this.tmp.position.x, z: this.tmp.position.z, h: this.tmp.rotation.y, len: this.lengthOf(v) / 2, wid: this.widthOf(v) / 2, id: v.id ?? 0 });
    };
    for (const car of this.cars) {
      put(car.type, this.place(car, CAR_Y), car.paint);
      remember(car);
    }
    // Otoparkta duran arabalar
    for (const lot of this.lots.values()) {
      lot.bays.forEach((p, k) => {
        if (!p) return;
        const b = this.bayPos(lot, k);
        this.tmp.position.copy(b);
        this.tmp.rotation.set(0, Math.atan2(DIRS[lot.face][0], DIRS[lot.face][1]) + (p.noseIn ? Math.PI : 0), 0);
        this.tmp.scale.setScalar(CAR_SCALE);
        this.tmp.updateMatrix();
        put(p.type, this.tmp.matrix, p.paint);
      });
    }
    set.end();
    if (this.busMesh) {
      this.buses.forEach((b, n) => {
        this.busMesh!.setMatrixAt(n, this.place(b, 0.03));
        remember(b);
      });
      this.busMesh.count = this.buses.length;
      this.busMesh.instanceMatrix.needsUpdate = true;
    }
  }

  // Otoparka girip çıkarken eğri boyunca ilerle
  private maneuver(v: Vehicle, dt: number) {
    const m = v.man!;
    const s = m.segs[m.k];
    m.u += (dt * MANEUVER_SPEED) / s.len;
    const total = m.segs.length;
    const progress = (m.k + Math.min(1, m.u)) / total;
    if (m.fadeIn) v.fade = Math.min(1, progress * 3);
    if (m.fadeOut) v.fade = Math.min(1, (1 - progress) * 3);
    if (m.u < 1) return true;
    m.u = 0;
    m.k++;
    if (m.k < total) return true;
    v.man = undefined;
    if (m.end === 'road') {
      v.tile = m.road!;
      v.dIn = v.dOut = m.dir!;
      v.t = 0.5;
      v.fade = 1;
      return isRoadTile(this.city, v.tile);
    }
    if (m.end === 'lot' && m.lot && this.lots.get(m.lot.tile) === m.lot) {
      // Park etti: sürücü inip evine yürür
      m.lot.reserved[m.bay!] = false;
      if (!m.lot.bays[m.bay!]) {
        m.lot.bays[m.bay!] = { type: v.type, noseIn: true, paint: v.paint };
        const path = this.walkPath(m.lot, m.bay!);
        if (path && this.walkers) this.walkers.addTrip(path.reverse(), false, true);
      }
    }
    return false;
  }

  private place(v: Vehicle, y: number) {
    if (v.man) {
      const s = v.man.segs[v.man.k];
      const u = Math.min(1, v.man.u);
      bez(s.p, u, this.tmp.position).setY(y);
      this.tmp.rotation.set(0, bezDir(s.p, u) + (s.back ? Math.PI : 0), 0);
    } else {
      this.tmp.rotation.set(0, lanePos(this.city, v, this.laneOf(v), y, this.tmp.position), 0);
    }
    this.tmp.scale.setScalar(CAR_SCALE * THREE.MathUtils.smoothstep(v.fade, 0, 1));
    this.tmp.updateMatrix();
    return this.tmp.matrix;
  }
}

// Kaldırımlarda yürüyen insanlar: bacakları ve kolları yürürken sallanır, herkesin kıyafeti ve saçı farklı.
// Evlerin kapısından çıkıp kaldırımda dolaşır, sonra yine bir evin kapısından girer. Bazıları otoparktaki
// arabasına yürür ya da arabasını park edip evine gider. Yağmurda renkli şemsiyeler açılır.
// Her parça için tek çoklu çizim (InstancedMesh) kullanılır.
const SHIRTS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292', '#ffffff', '#26a69a', '#5c6bc0', '#ff7043'];
const PANTS = ['#2b3a55', '#1f2937', '#5b4636', '#3b5b8a', '#6b7280', '#8d6e4c', '#37474f', '#1e3a5f'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#f5cfa0'];
const HAIR = ['#2b1d14', '#3b2a1e', '#5a3a22', '#d4a85a', '#141414', '#9e9e9e', '#a0522d', '#e8c27a'];
const UMBRELLAS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#ff7043', '#ffffff'];
const HIP = 0.052; // kalçanın yüksekliği
const SHOULDER = 0.104;

// Kaldırım dışında izlenen yol (kapıdan kaldırıma, kaldırımdan arabaya...)
interface Walk {
  pts: THREE.Vector3[];
  k: number;
  u: number;
  fadeIn: boolean;
  fadeOut: boolean;
  done?: () => void;
  then?: { tile: number; dir: number }; // bitince kaldırımda yürümeye devam et
}

interface Person extends Mover {
  phase: number;
  look: [number, number, number, number, number]; // gömlek, pantolon, ten, saç, şemsiye
  walk?: Walk;
  away?: number; // eve dönmek için kaç saniyedir yer arıyor
}

// Parçalar: [geometri, renk listesi seçici]
function personParts() {
  const leg = new THREE.CylinderGeometry(0.0085, 0.0075, HIP, 6).translate(0, -HIP / 2, 0);
  const arm = new THREE.CylinderGeometry(0.0062, 0.0055, 0.046, 5).translate(0, -0.023, 0);
  const torso = new THREE.CylinderGeometry(0.0195, 0.0155, 0.058, 8).translate(0, HIP + 0.029, 0);
  const head = new THREE.SphereGeometry(0.0185, 10, 8).translate(0, 0.128, 0);
  const hair = new THREE.SphereGeometry(0.02, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.52).translate(0, 0.131, -0.002);
  const canopy = new THREE.ConeGeometry(0.062, 0.028, 10, 1, true).translate(0, 0.205, 0);
  const stick = new THREE.CylinderGeometry(0.0022, 0.0022, 0.09, 4).translate(0, 0.16, 0);
  const umbrella = mergeGeometries([canopy.toNonIndexed(), stick.toNonIndexed()], false)!;
  return { leg, arm, torso, head, hair, umbrella };
}

const pickLook = (): Person['look'] => {
  const pick = (list: unknown[]) => Math.floor(Math.random() * list.length);
  return [pick(SHIRTS), pick(PANTS), pick(SKINS), pick(HAIR), pick(UMBRELLAS)];
};

export class Walkers {
  readonly root = new THREE.Group();
  private people: Person[] = [];
  spots: Box[] = []; // yayaların yerleri (arabalar bakar)
  cars: () => Box[] = () => [];
  private parts: Record<'torso' | 'head' | 'hair' | 'legL' | 'legR' | 'armL' | 'armR' | 'umbrella', THREE.InstancedMesh>;
  private recount = 0;
  private time = 0;
  private colorsDirty = true;
  private tmp = new THREE.Object3D();
  private base = new THREE.Matrix4();
  private local = new THREE.Matrix4();
  private out = new THREE.Matrix4();

  constructor(private city: City) {
    const g = personParts();
    const mesh = (geo: THREE.BufferGeometry, side: THREE.Side = THREE.FrontSide) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85, side }), MAX_WALKERS);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      this.root.add(m);
      return m;
    };
    this.parts = {
      torso: mesh(g.torso), head: mesh(g.head), hair: mesh(g.hair),
      legL: mesh(g.leg), legR: mesh(g.leg), armL: mesh(g.arm), armR: mesh(g.arm),
      umbrella: mesh(g.umbrella, THREE.DoubleSide),
    };
  }

  setCity(city: City) {
    this.city = city;
    this.people = [];
    this.colorsDirty = true;
  }

  private lane = (tile: number) => (this.city.tiles[tile]?.grade === 2 ? WIDE_WALK : WALK_LANE);

  // Belirli bir yolu yürüyen biri (otoparktaki arabasına giden ya da arabasından evine dönen)
  addTrip(pts: THREE.Vector3[], fadeIn: boolean, fadeOut: boolean, done?: () => void) {
    if (this.people.length >= MAX_WALKERS) {
      done?.();
      return;
    }
    this.people.push({ tile: 0, dIn: 0, dOut: 0, t: 0, speed: 0.3, fade: fadeIn ? 0 : 1, phase: Math.random() * 6, look: pickLook(), walk: { pts, k: 0, u: 0, fadeIn, fadeOut, done } });
    this.colorsDirty = true;
  }

  // Bir evin kapısından çıkıp kaldırıma yürüyen biri
  private fromDoor(): Person | null {
    const homes: number[] = [];
    this.city.tiles.forEach((t, i) => t?.kind === 'res' && t.level > 0 && homes.push(i));
    if (!homes.length) return null;
    const home = homes[Math.floor(Math.random() * homes.length)];
    const dirs = [0, 1, 2, 3].filter(d => isRoadTile(this.city, neighbor(home, d)));
    if (!dirs.length) return null;
    const d = dirs[Math.floor(Math.random() * dirs.length)];
    const road = neighbor(home, d);
    const f = fwd(d);
    // Kaldırımda evin tarafında yürümek için yön: sağ tarafı eve bakan yön
    const dir = (d + 1) % 4;
    const door = center(home).setY(0.05).addScaledVector(f, 0.34);
    const side = center(road).setY(0.05).addScaledVector(f, -this.lane(road));
    return {
      tile: road, dIn: dir, dOut: dir, t: 0.5, speed: 0.18 + Math.random() * 0.14, fade: 0, phase: Math.random() * 6, look: pickLook(),
      walk: { pts: [door, side], k: 0, u: 0, fadeIn: true, fadeOut: false, then: { tile: road, dir } },
    };
  }

  // Eve dönen biri: kaldırımda yanındaki evin kapısından girer
  private goHome(p: Person) {
    if (p.dIn !== p.dOut || p.t < 0.4 || p.t > 0.6) return false;
    const home = neighbor(p.tile, (p.dIn + 1) % 4);
    const h = home >= 0 ? this.city.tiles[home] : null;
    if (!h || (h.kind !== 'res' && h.kind !== 'store' && h.kind !== 'market' && h.kind !== 'bakery' && h.kind !== 'fashion' && h.kind !== 'furniture') || (h.kind === 'res' && h.level < 1)) return false;
    const pos = new THREE.Vector3();
    lanePos(this.city, p, this.lane, 0.05, pos);
    const door = center(home).setY(0.05).addScaledVector(fwd((p.dIn + 3) % 4), 0.34);
    p.walk = { pts: [pos, door], k: 0, u: 0, fadeIn: false, fadeOut: true };
    return true;
  }

  private paint() {
    const c = new THREE.Color();
    const p = this.parts;
    this.people.forEach((person, n) => {
      const [shirt, pants, skin, hair, umb] = person.look;
      p.torso.setColorAt(n, c.set(SHIRTS[shirt]));
      p.armL.setColorAt(n, c);
      p.armR.setColorAt(n, c);
      p.legL.setColorAt(n, c.set(PANTS[pants]));
      p.legR.setColorAt(n, c);
      p.head.setColorAt(n, c.set(SKINS[skin]));
      p.hair.setColorAt(n, c.set(HAIR[hair]));
      p.umbrella.setColorAt(n, c.set(UMBRELLAS[umb]));
    });
    for (const m of Object.values(p)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    this.colorsDirty = false;
  }

  // Kapıdan kaldırıma, kaldırımdan arabaya... düz çizgiler boyunca yürü
  private stepWalk(p: Person, dt: number) {
    const w = p.walk!;
    const a = w.pts[w.k], b = w.pts[w.k + 1];
    const len = Math.max(0.02, a.distanceTo(b));
    w.u += (dt * p.speed) / len;
    const last = w.k === w.pts.length - 2;
    if (w.fadeIn && w.k === 0) p.fade = Math.min(1, Math.max(p.fade, w.u * 1.5));
    if (w.fadeOut && last) p.fade = Math.min(p.fade, Math.max(0, (1 - w.u) * 1.5));
    if (w.u < 1) return true;
    w.u = 0;
    w.k++;
    if (w.k < w.pts.length - 1) return true;
    p.walk = undefined;
    if (w.then) {
      p.fade = 1;
      return isRoadTile(this.city, p.tile);
    }
    w.done?.();
    return false;
  }

  // rain: yağmurun şiddeti (0..1)
  update(dt: number, rain = 0) {
    this.time += dt;
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 0.5;
      const roads = this.city.tiles.filter(t => t?.kind === 'road').length;
      const wanted = Math.min(MAX_WALKERS - 10, roads, Math.floor(this.city.population / 8));
      const strolling = this.people.filter(p => !p.out && (!p.walk || p.walk.then));
      if (strolling.length < wanted) {
        const p = this.fromDoor();
        if (p) {
          this.people.push(p);
          this.colorsDirty = true;
        }
      } else if (strolling.length > wanted) {
        const leaving = strolling.find(p => !p.walk);
        if (leaving) {
          leaving.out = true;
          leaving.away = 0;
        }
      }
    }
    const before = this.people.length;
    // Kaldırımda aynı yönde yürüyenler (önündekinin içinden geçmesin)
    const lanes = new Map<string, number[]>();
    for (const p of this.people) {
      if (p.walk) continue;
      const k = `${p.tile}|${p.dIn}`;
      (lanes.get(k) ?? lanes.set(k, []).get(k)!).push(p.t);
    }
    const cars = this.cars();
    const pos = new THREE.Vector3();
    // Önünde araba varsa bekle
    const carAhead = (x: number, z: number, h: number) => {
      const fx = Math.sin(h), fz = Math.cos(h);
      for (const c of cars) {
        const rx = c.x - x, rz = c.z - z;
        const ahead = rx * fx + rz * fz;
        if (ahead < -0.02) continue;
        const lat = Math.abs(rx * fz - rz * fx);
        const dh = c.h - h;
        const along = Math.abs(Math.cos(dh)) * c.len + Math.abs(Math.sin(dh)) * c.wid;
        const side = Math.abs(Math.sin(dh)) * c.len + Math.abs(Math.cos(dh)) * c.wid;
        if (ahead < along + 0.06 && lat < side + 0.03) return true;
      }
      return false;
    };
    this.people = this.people.filter(p => {
      if (p.walk) {
        const w = p.walk;
        const a = w.pts[w.k], b = w.pts[w.k + 1];
        pos.lerpVectors(a, b, Math.min(1, w.u));
        if (carAhead(pos.x, pos.z, Math.atan2(b.x - a.x, b.z - a.z))) return true;
        return this.stepWalk(p, dt);
      }
      if (p.out) {
        p.away = (p.away ?? 0) + dt;
        if (this.goHome(p)) return true;
        // Uzun süre ev bulamazsa yavaşça kaybolsun
        if (p.away > 14) {
          p.fade = Math.max(0, p.fade - dt * 2);
          if (p.fade <= 0) return false;
        }
      }
      let limit = lightLimit(this.city, p, 0.7);
      for (const t of lanes.get(`${p.tile}|${p.dIn}`) ?? []) if (t > p.t + 1e-4) limit = Math.min(limit, t - 0.08);
      const h = lanePos(this.city, p, this.lane, 0.05, pos);
      if (carAhead(pos.x, pos.z, h)) limit = p.t;
      return advance(this.city, p, dt * p.speed, false, Math.max(p.t, limit));
    });
    if (this.people.length !== before) this.colorsDirty = true;
    if (this.colorsDirty) this.paint();

    const p = this.parts;
    const put = (m: THREE.InstancedMesh, n: number, x: number, y: number, swing: number) => {
      this.local.makeRotationX(swing).setPosition(x, y, 0);
      m.setMatrixAt(n, this.out.multiplyMatrices(this.base, this.local));
    };
    this.spots = [];
    this.people.forEach((person, n) => {
      const w = person.walk;
      if (w) {
        const a = w.pts[w.k], b = w.pts[w.k + 1];
        this.tmp.position.lerpVectors(a, b, Math.min(1, w.u));
        this.tmp.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      } else {
        this.tmp.rotation.y = lanePos(this.city, person, this.lane, 0.05, this.tmp.position);
      }
      const step = Math.sin(this.time * 9 + person.phase);
      this.tmp.position.y += Math.abs(step) * 0.005; // adım atarken hafifçe yükselir
      this.tmp.scale.setScalar(THREE.MathUtils.smoothstep(person.fade, 0, 1));
      this.tmp.updateMatrix();
      if (person.fade > 0.3) this.spots.push({ x: this.tmp.position.x, z: this.tmp.position.z, h: this.tmp.rotation.y, len: 0.022, wid: 0.025, id: -1 });
      this.base.copy(this.tmp.matrix);
      for (const m of [p.torso, p.head, p.hair, p.umbrella]) m.setMatrixAt(n, this.base);
      put(p.legL, n, -0.0095, HIP, step * 0.55);
      put(p.legR, n, 0.0095, HIP, -step * 0.55);
      // Şemsiyeyi tutan kol öne kalkar
      put(p.armL, n, -0.025, SHOULDER, -step * 0.5);
      put(p.armR, n, 0.025, SHOULDER, rain > 0.25 ? -1.2 : step * 0.5);
    });
    for (const [name, m] of Object.entries(p)) {
      m.count = name === 'umbrella' && rain <= 0.25 ? 0 : this.people.length;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}
