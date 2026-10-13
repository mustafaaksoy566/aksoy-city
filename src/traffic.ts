import * as THREE from 'three';
import { SIZE, Z0, ROAD_GRADES, ENTRANCE_Z, UNDERPASS, INDUSTRY, RES_LEVELS } from './config';
import { CarSet, CAR_KINDS, CAR_SCALE, BUS_SCALE, carPaint, type CarKind } from './cars';
import { City, DIRS, idx, inBounds } from './city';
import { bakeModel, vertexColorMat } from './batcher';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeBus } from './sky';
import { tileCenter, FACING_TURNS } from './view';
import { isGreen } from './signals';
import { siteOf, siteToWorld, BAY_W, type Site, type SiteBay } from './sites';
import { DOORS } from './towers';

const CAR_LANE = 0.16; // arabalar: şeridin yol ortasından uzaklığı (sağdan gidiş)
// Caddede (çift şerit) iç ve dış şeridin ortası: iç şerit bariyerin sarı çizgisi (0.036) ile kesik çizgi (0.194)
// arasında, dış şerit kesik çizgi ile kenar çizgisi (0.384) arasında
const WIDE_LANES = [0.115, 0.3];
const CAR_Y = 0.066; // asfalt (0.036) + tekerleklerin altı
const WALK_LANE = 0.43; // yayalar: kaldırım
const WIDE_WALK = 0.468; // caddede kaldırım
const WALK_Y = 0.05;
const MAX_CARS = 70; // yolda giden araba
const MAX_INSTANCES = 240; // bir araba modelinden en fazla kaç tane (park edenler dahil)
const MAX_WALKERS = 90;
const GAP = 0.07; // arka arkaya iki aracın tamponları arasındaki boşluk (kare)
const STOP = 0.58; // kırmızı ışıkta durulan yer (kavşaktan önceki karede)
const MANEUVER_SPEED = 0.42; // otoparka girip çıkarken (kare/saniye)

// Otopark: arka sırada üç park yeri (otoparkın ortasından yana uzaklık), arabalar yola dönük durur
const BAYS = [-0.3, 0, 0.3];
const BAY_BACK = 0.2;

// Arabaların türleri: evlerin arabaları (otoparkta durur), yük taşıyanlar
const HOME_CARS: CarKind[] = ['sedan', 'sedan', 'sedan', 'hatch', 'hatch', 'suv', 'suv', 'sport', 'van', 'pickup'];
const CARGO_CARS: CarKind[] = ['truck', 'truck', 'van', 'pickup'];
const isCargo = (type: number) => type >= 0 && ['truck', 'van', 'pickup'].includes(CAR_KINDS[type]);
const pickType = (list: CarKind[]) => CAR_KINDS.indexOf(list[Math.floor(Math.random() * list.length)]);
const rnd = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

// --- Günün saatleri ---
// Bir gün 2 dakika (daynight.ts; gece 0.68'den 0.95'e kadar): sabah evden işe, gündüz yük taşıma ve alışveriş,
// akşam eve dönüş, gece sakin. Bir yolculuk yarım dakika kadar sürdüğü için eve dönüş hava kararmadan başlar.
export type DayPhase = 'morning' | 'day' | 'evening' | 'night';
export function dayPhase(tod: number): DayPhase {
  if (tod >= 0.93 || tod < 0.15) return 'morning';
  if (tod < 0.45) return 'day';
  if (tod < 0.68) return 'evening';
  return 'night';
}
// Yolda olması istenen araba ve yaya oranı (gece az)
const CAR_SHARE: Record<DayPhase, number> = { morning: 1, day: 0.8, evening: 1, night: 0.3 };
const WALK_SHARE: Record<DayPhase, number> = { morning: 0.8, day: 1, evening: 0.9, night: 0.3 };

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
    const R = 0.21;
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
    return turnaround(at, t, out);
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
  return bezier2(t, out);
}
// Dönüş meydanının eğrisi boyunca konum ve gidiş yönü
function turnaround(at: (u: number, v: THREE.Vector3) => THREE.Vector3, t: number, out: THREE.Vector3) {
  at(t, out);
  at(Math.min(1, t + 0.01), P);
  if (t >= 0.99) {
    at(0.99, P);
    at(1, out);
    return Math.atan2(out.x - P.x, out.z - P.z);
  }
  return Math.atan2(P.x - out.x, P.z - out.z);
}
// A, C, B noktalarıyla ikinci derece Bezier: konum ve gidiş yönü (eğrinin türevi)
function bezier2(t: number, out: THREE.Vector3) {
  const u = 1 - t;
  out.set(0, 0, 0).addScaledVector(A, u * u).addScaledVector(C, 2 * u * t).addScaledVector(B, t * t);
  const dx = 2 * u * (C.x - A.x) + 2 * t * (B.x - C.x);
  const dz = 2 * u * (C.z - A.z) + 2 * t * (B.z - C.z);
  return Math.atan2(dx, dz);
}

// Kavşakta iki hareket (giriş yönü, çıkış yönü) birbirinin yolunu keser mi? (sağdan gidiş; sağa dönüş = d+1)
const rightOf = (d: number) => (d + 1) % 4, leftOf = (d: number) => (d + 3) % 4;
// aw, bw: caddede şerit (0 iç, 1 dış), tek şeritli yolda -1
function conflicts(ai: number, ao: number, aw: number, bi: number, bo: number, bw: number) {
  if (ai === bi) {
    // Aynı yönden: aynı şeritteki sıradadır; caddede iç şeritten sağa ya da dış şeritten sola dönen öbür şeridi keser
    if (aw === bw || aw < 0 || bw < 0) return false;
    const inner = aw === 0 ? ao : bo, outer = aw === 0 ? bo : ao;
    return inner === rightOf(ai) || outer === leftOf(ai);
  }
  if (ao === bo) return true; // aynı yola çıkıyorlar
  if (ao === rightOf(ai) || bo === rightOf(bi)) return false; // sağa dönen köşeden döner
  if (ai === (bi + 2) % 4) return ao === leftOf(ai) || bo === leftOf(bi); // karşılıklı: düz-düz serbest, sola dönen keser
  return true; // dik gelenler keser
}

// Kırmızı ışıkta beklenecek yer: bir sonraki kare kavşaksa ve o yöne ışık kırmızıysa durma çizgisi
function lightLimit(city: City, m: Mover, stop: number) {
  if (m.t > stop) return Infinity; // çizgiyi geçmiş, devam etsin
  const next = neighbor(m.tile, m.dOut);
  if (!isJunction(city, next) || isGreen(next, m.dOut)) return Infinity;
  return stop;
}

// --- Yol bulma ---
// Her hedef yol karesi için bütün yol karelerinin hedefe kaç kare uzak olduğu (genişlik öncelikli arama).
// Bir kez hesaplanır, yollar değişince silinir. Arabalar ve yayalar ortak kullanır.
class Router {
  private fields = new Map<number, Int16Array>();
  private key = 0;
  constructor(public city: City) {}
  // Yollar değiştiyse eski uzaklıkları sil
  sync() {
    let key = 0;
    this.city.tiles.forEach((t, i) => t?.kind === 'road' && (key = (key * 31 + i) | 0));
    if (key !== this.key) {
      this.key = key;
      this.fields.clear();
    }
  }
  reset(city: City) {
    this.city = city;
    this.fields.clear();
    this.key = 0;
  }
  field(target: number) {
    let f = this.fields.get(target);
    if (f) return f;
    if (this.fields.size > 600) this.fields.clear();
    f = new Int16Array(this.city.tiles.length).fill(-1);
    if (isRoadTile(this.city, target)) {
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
    }
    this.fields.set(target, f);
    return f;
  }
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

// Otopark ya da garaj (gökdelen, katlı otopark, itfaiye) ya da kendi otoparkı olan bina: önündeki yol
interface Spot {
  tile: number; // binanın yola bakan karesi (otoparklı binada sol üst karesi)
  road: number; // önündeki yol
  face: number; // yola doğru yön
  at?: THREE.Vector3; // garajın kapısı (itfaiye: araç buradan girip çıkar)
}
interface Parked {
  type: number;
  paint?: THREE.Color;
  noseIn: boolean; // burnu içeride (ileri girip park etti)
  leaving?: boolean; // sahibi yürüyerek geliyor
  fleet?: SiteBay['fleet']; // binanın kendi aracı (polis arabası, ambulans, kamyon): işi yokken burada durur
  trip?: Trip; // ziyaretçi: işi bitince devam edeceği yolculuk
}
// Binanın kendi aracı (yerinde, burnu binaya dönük)
function fleetCar(fleet: NonNullable<SiteBay['fleet']>): Parked {
  return { type: CAR_KINDS.indexOf(fleet), paint: carPaint(fleet), noseIn: true, fleet };
}
// Binanın kendi otoparkındaki bir park yeri
interface Slot {
  pos: THREE.Vector3; // yerin ortası (dünyada)
  road: number; // girip çıkarken kullanılan yol (yerin önündeki kare)
  truck?: boolean;
  fleet?: SiteBay['fleet'];
  walk: THREE.Vector3[]; // sürücünün arabanın yanından binanın kapısından içeri yürüdüğü yol
}
interface Lot extends Spot {
  bays: (Parked | null)[];
  reserved: boolean[];
  slots?: Slot[]; // binanın kendi otoparkı (yoksa şehirdeki üç yerli otopark)
  siteKey?: string; // bina döndürülür ya da büyürse otopark yeniden kurulur
}
// Gidilecek yer: otopark yeri (şehir otoparkı ya da binanın kendi otoparkı; stay: binada kaç saniye kalınır,
// -1 işte akşama kadar), garaj, şehrin çıkışı ya da "ev" (o an evine en yakın boş otopark yeri seçilir)
interface Dest {
  kind: 'lot' | 'garage' | 'exit' | 'home';
  spot?: Spot;
  bay?: number;
  road: number;
  stay?: number;
  site?: number; // gidilen binanın karesi ve türü (yıkıldıysa oraya gidilmez)
  what?: string;
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
  site?: number; // girip çıktığı otoparkın karesi (otoparkta aynı anda tek manevra)
  dest?: Dest; // gittiği yer
}
// Şehirde bir yer (iş yeri, dükkan, fabrika, gezilecek yer...): önündeki yol, ağırlık (çalışan sayısı gibi) ve
// varsa kendi otoparkı (arabalar yalnızca otoparkı olan yerlere gider)
export interface Place {
  spot: Spot;
  site: number;
  what: string;
  weight: number;
  lot?: Lot;
}
export interface Places {
  work: Place[]; // iş yerleri
  shops: Place[]; // dükkanlar
  cargo: Place[]; // mal çıkan yerler (fabrika, depo, liman)
  fun: Place[]; // gezilecek yerler (müze, stadyum, plaj, tarihi yapılar...)
  parks: Place[]; // park, çeşme, heykel (yürüyüş)
  transit: Place[]; // durak, metro, istasyon
  depots: Place[]; // çöp kamyonlarının çıktığı depolar
  homes: number[]; // evler
}

// Arabanın görevi
type Job = 'work' | 'home' | 'cargo' | 'errand' | 'visit' | 'taxi' | 'garbage' | 'service' | 'bus' | 'roam';
// Bir yolculuk: görev, sırayla gidilecek yerler, evi (akşam döneceği otopark ya da garaj; binanın aracıysa
// kendi binası) ve önce kaç kare dolaşacağı (çöp kamyonu, devriye)
interface Trip {
  job: Job;
  plan: Dest[];
  base?: { lot?: Lot; garage?: Spot };
  roam?: number;
}

// İki dönük dikdörtgen (yukarıdan bakınca) üst üste biniyor mu? (ayırıcı eksen testi)
function boxesTouch(a: Box, b: Box) {
  for (const h of [a.h, a.h + Math.PI / 2, b.h, b.h + Math.PI / 2]) {
    const ax = Math.sin(h), az = Math.cos(h);
    const reach = (o: Box) => {
      const c = Math.abs(Math.cos(h - o.h)), s = Math.abs(Math.sin(h - o.h));
      return c * o.len + s * o.wid;
    };
    const d = Math.abs((b.x - a.x) * ax + (b.z - a.z) * az);
    if (d >= reach(a) + reach(b)) return false;
  }
  return true;
}

// Çarpışmayı önlemek için bir aracın ya da yayanın kapladığı yer (bir önceki karedeki)
export interface Box {
  x: number;
  z: number;
  h: number; // yön (açı)
  len: number; // yarı boy
  wid: number; // yarı en
  id: number;
  ped?: boolean; // araba önündeki yayaya yol veriyor (yaya da onu beklerse ikisi kilitlenir)
  u?: number; // alt geçitte ne kadar aşağıda (0 yukarıda, 1 kavşağın altında)
}
let nextId = 1;

interface Vehicle extends Mover {
  id?: number;
  stuck?: number; // önü kapalı bekleme süresi
  ped?: boolean; // önündeki yayayı bekliyor
  pedWait?: number; // yayayı ne kadar süredir bekliyor
  pedPass?: number; // yayalara bakmadan geçtiği kalan süre (karşılıklı bekleme çözülür)
  wideNext?: number; // kavşağa girince geçeceği şerit (alt geçitli kavşakta caddeye dönen dış şeride geçer)
  next?: number; // bir sonraki karede çıkacağı yön (kavşağa girmeden önce seçilir)
  lastJ?: { tile: number; dIn: number; dOut: number }; // en son geçtiği kavşak (arkası hâlâ içindeyken yer tutar)
  vanish?: boolean; // çok uzun sıkıştı: başkasının içinden geçmek yerine yavaşça kaybolur
  exitWait?: number; // otoparktan yola çıkmadan önce yolun boşalmasını ne kadar bekledi
  jwait?: number; // yeşil ışıkta kavşağa girmek için ne kadar süredir bekliyor (uzun bekleyene sıra verilir)
  type: number; // araba modeli (otobüste -1)
  paint?: THREE.Color; // boyası
  wide: number; // caddede hangi şerit (0 iç, 1 dış)
  trip: number; // gezinti: kaç kare daha rastgele dolaşacak (görevli araba 0, doğrudan gider)
  job: Job;
  age?: number; // kaç saniyedir yolda
  plan?: Dest[]; // şimdiki hedeften sonra sırayla gideceği yerler
  base?: Trip['base'];
  dest?: Dest;
  man?: Maneuver;
  fleet?: SiteBay['fleet']; // binanın kendi aracı (işi bitince binasının park yerine döner)
}
// Binanın otoparkında bekleyen araba: sürücü içeride (işte akşama kadar, alışverişte birkaç saniye) ya da
// kamyon yük indirip alıyor (sürücü inmez)
interface Inside {
  lot: Lot;
  bay: number;
  until: number; // saat (saniye) bu olunca çıkar
  evening: boolean; // işte: akşam çıkar
  driver: boolean; // sürücü binada (çıkınca kapıdan arabasına yürür)
  since: number;
}
// İtfaiye: araçlar garaj kapılarından girip çıkar
interface FireStation {
  spot: Spot;
  doors: { at: THREE.Vector3; road: number }[]; // garaj kapıları ve önlerindeki yol
  trucks: number; // içeride kaç araç var
}

// Arabalar ve otobüsler: ışıklarda durur, öndeki aracın arkasında sıraya girer.
// Hiçbiri yolun ortasında belirmez ve hepsinin bir görevi var (SimCity'deki gibi):
// - Sabah: sahibi evinden çıkıp otoparktaki arabasına yürür, arabayla işine (fabrika, dükkan, hastane, okul...)
//   gider ve binaya girer. Kulelerde oturanlar kulenin garajından çıkar. Kamyonetli olanlar önce fabrikadan mal alıp
//   dükkana götürür.
// - Gündüz: kamyonlar fabrikadan, depodan ya da limandan mal alıp dükkanlara ve başka fabrikalara taşır; insanlar
//   arabayla alışverişe ve gezmeye gider; otobandan şehre gelenler gezilecek yerlere ve dükkanlara uğrayıp döner.
// - Akşam: işten çıkanlar evlerinin yanındaki otoparka park edip evlerine yürür (kulede oturanlar garaja girer).
// - Gece: yollar sakin, birkaç taksi ve devriye.
// Her araba modeli için tek bir çoklu çizim (InstancedMesh) kullanılır: telefonda çok daha hızlı.
export class Traffic {
  readonly root = new THREE.Group();
  private cars: Vehicle[] = [];
  private buses: Vehicle[] = [];
  private set: CarSet | null = null;
  private busMesh: THREE.InstancedMesh | null = null;
  private lengths: number[] = []; // her araba modelinin boyu (kare)
  private widths: number[] = [];
  private busLength = 0.42;
  private busWidth = 0.17;
  boxes: Box[] = []; // araçların kapladığı yerler (yayalar da bakar)
  private recount = 0;
  private tmp = new THREE.Object3D();
  private lots = new Map<number, Lot>(); // şehir otoparkları ve binaların kendi otoparkları
  private garages: Spot[] = []; // gökdelenler ve katlı otoparklar
  private fires = new Map<number, FireStation>();
  readonly router: Router;
  places: Places = { work: [], shops: [], cargo: [], fun: [], parks: [], transit: [], depots: [], homes: [] };
  private inside: Inside[] = []; // binaların içinde bekleyen arabalar
  private clock = 0;
  phase: DayPhase = 'day';
  private waiting: { lot: Lot; bay: number; trip: Trip }[] = []; // sahibi geldi, yola çıkmayı bekliyor
  private pending = 0; // sahibi arabasına yürüyor
  private wanted = 0; // şehirde gezmesi gereken araba sayısı
  private walkers: Walkers | null = null;
  // Otoban: şehirden çıkan arabalar ona devredilir
  highway: { leaveCity(type: number, paint: THREE.Color, wide: number): void; canLeave(wide: number): boolean; busy(): boolean; sendBus(): void; busesComing(): number } | null = null;

  constructor(private city: City) {
    this.router = new Router(city);
  }

  link(walkers: Walkers) {
    this.walkers = walkers;
    walkers.attach(this.router, () => this.places, () => this.phase);
  }

  // Modeller yüklendikten sonra çağrılır
  init() {
    const busGeo = bakeModel(makeBus());
    if (busGeo) {
      busGeo.computeBoundingBox();
      const b = busGeo.boundingBox!;
      // Çarpışma kutusu çizildiği boyda
      this.busLength = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * BUS_SCALE;
      this.busWidth = Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * BUS_SCALE;
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
    this.router.reset(city);
    this.cars = [];
    this.buses = [];
    this.lots.clear();
    this.fires.clear();
    this.inside = [];
    this.waiting = [];
    this.pending = 0;
  }

  // Alt geçitten geçen araba ne kadar aşağıda: 0 yukarıda, 1 kavşağın altında (rampada arada)
  private underOf(v: Vehicle): number {
    if (v.man || v.wide !== 0 || v.type < 0) return 0;
    const t = this.city.tiles[v.tile];
    if (t?.kind !== 'road') return 0;
    if (t.under !== undefined) return v.dIn === v.dOut && v.dIn % 2 === t.under ? 1 : 0;
    const r = this.city.rampOf(v.tile);
    if (!r) return 0;
    if (v.dOut === r.dir) return v.t; // kavşağa doğru iniyor
    if (v.dIn === (r.dir + 2) % 4) return 1 - v.t; // kavşaktan çıkıp yukarı çıkıyor
    return 0;
  }
  // Bu kavşaktan bu hareket alt geçitten mi (iç şeritte, doğrultu boyunca düz)?
  private underMove(tile: number, dIn: number, dOut: number, wide: number) {
    const u = this.city.tiles[tile]?.under;
    return u !== undefined && wide === 0 && dIn === dOut && dIn % 2 === u;
  }

  private laneOf(v: Vehicle) {
    return (tile: number) => (this.city.tiles[tile]?.grade === 2 ? WIDE_LANES[v.wide] : CAR_LANE);
  }

  private lengthOf(v: Vehicle) {
    return v.type < 0 ? this.busLength : this.lengths[v.type] ?? 0.3;
  }
  private widthOf(v: Vehicle) {
    return v.type < 0 ? this.busWidth : this.widths[v.type] ?? 0.14;
  }

  // Önünde (gideceği yerde) başka bir araç ya da yaya var mı? Kutular bir önceki karedeki yerler.
  // İki araç birbirini bekliyorsa kimliği küçük olan geçer (kilitlenmesin).
  // Dönüş: 'queue' önde aynı yöne giden (sırada bekliyor), 'cross' yolunu kesen araç, 'ped' önünde yaya, null boş
  private blocked(me: Box | undefined, people: Box[]): 'queue' | 'cross' | 'ped' | null {
    if (!me) return null;
    const fx = Math.sin(me.h), fz = Math.cos(me.h);
    // Biraz ileriye kaydırılmış kendi kutusu, öndeki (dönük de olsa) kutuya değiyor mu? (ayırıcı eksen testi)
    const ahead = (extra: number): Box => ({ ...me, x: me.x + fx * extra, z: me.z + fz * extra, wid: me.wid * 0.9 });
    const car = ahead(0.06), walk = ahead(0.05);
    // Uzaktakiler hiç denenmez (telefonda her karede yüzlerce kutu var)
    const reach = me.len + me.wid + 0.07;
    const hit = (o: Box, mine: Box) => {
      const rx = o.x - me.x, rz = o.z - me.z;
      const r = reach + o.len + o.wid;
      if (rx * rx + rz * rz > r * r || rx * fx + rz * fz <= 0.01) return false;
      return boxesTouch(mine, o);
    };
    const mu = me.u ?? 0;
    for (const o of this.boxes) {
      // Alt geçitteki araba ile yukarıdaki birbirine takılmaz
      if (Math.abs(mu - (o.u ?? 0)) > 0.5) continue;
      if (o.id === me.id || !hit(o, car)) continue;
      // Karşılıklı bekleme: o da beni bekliyorsa küçük kimlikli geçer
      const ox = Math.sin(o.h), oz = Math.cos(o.h);
      const back = (me.x - o.x) * ox + (me.z - o.z) * oz > 0.01;
      if (back && me.id < o.id) continue;
      return Math.cos(o.h - me.h) > 0.8 ? 'queue' : 'cross';
    }
    if (mu < 0.5) for (const p of people) if (hit(p, walk)) return 'ped';
    return null;
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

  // Binanın düzlemindeki (sites.ts) bir nokta dünyada nerede
  private siteWorld(i: number, facing: number, site: Site, x: number, z: number) {
    const n = site.n;
    const c = tileCenter((i % SIZE) + (n - 1) / 2, Math.floor(i / SIZE) + (n - 1) / 2);
    return siteToWorld(c.x, c.z, FACING_TURNS[facing], x, z);
  }

  // Binanın kendi otoparkı: her park yerinin dünyadaki yeri, önündeki yol ve sürücünün kapıya yürüyeceği yol.
  // Binanın yola bakan yanında yol yoksa null.
  // Binanın önünde, kendi düzlemindeki x hizasındaki yol karesi; o kare yol değilse ön yüzdeki en yakın yol
  // (yoksa -1)
  private frontRoad(i: number, facing: number, site: Site, x: number) {
    const fronts = this.city.cellsOf(i).map(c => neighbor(c, facing)).filter(r => isRoadTile(this.city, r));
    const ahead = this.siteWorld(i, facing, site, x, site.n / 2 + 0.5);
    const ax = Math.floor(ahead.x + SIZE / 2), az = Math.floor(ahead.z + Z0);
    const road = inBounds(ax, az) ? idx(ax, az) : -1;
    if (fronts.includes(road)) return road;
    let best = Infinity, near = -1;
    for (const r of fronts) {
      const d = center(r).distanceToSquared(ahead);
      if (d < best) {
        best = d;
        near = r;
      }
    }
    return near;
  }

  private siteLot(i: number, facing: number, site: Site, key: string): Lot | null {
    if (this.frontRoad(i, facing, site, 0) < 0) return null;
    const W = (x: number, z: number) => this.siteWorld(i, facing, site, x, z);
    const [dx, dz] = site.door;
    const slots: Slot[] = site.bays.map(b => {
      const pos = W(b.x, b.z);
      const road = this.frontRoad(i, facing, site, b.x);
      // Sürücü arabanın sol yanından (park çizgisinden) binaya doğru yürür, yaya yolundan kapıya gider
      const walk = [W(b.x - BAY_W / 2, b.z), W(b.x - BAY_W / 2, site.walk), W(dx, site.walk), W(dx, dz), W(dx, dz - 0.09)].map(p => p.setY(WALK_Y));
      return { pos, road, truck: b.truck, fleet: b.fleet, walk };
    });
    const lot: Lot = { tile: i, road: slots[0].road, face: facing, slots, siteKey: key, bays: slots.map(() => null), reserved: slots.map(() => false) };
    // Binanın kendi araçları (polis arabası, ambulans, kamyon, çöp kamyonu) başta yerlerinde
    slots.forEach((s, k) => {
      if (s.fleet) lot.bays[k] = fleetCar(s.fleet);
    });
    return lot;
  }

  // Binanın kendi araçlarından kaybolanların (sıkışıp silinen, şehirden çıkan) yerine binada yenisi durur.
  // Yolda olan, başka binada yük indiren ya da kendi otoparkında başka yere park etmiş araçlar sayılır.
  private refillFleet() {
    const away = new Map<string, number>();
    const add = (lot: Lot | undefined, fleet: SiteBay['fleet']) => {
      if (!lot || !fleet || this.lots.get(lot.tile) !== lot) return;
      const key = `${lot.tile}|${fleet}`;
      away.set(key, (away.get(key) ?? 0) + 1);
    };
    for (const c of this.cars) if (c.fleet) add(c.base?.lot, c.fleet);
    for (const lot of this.lots.values())
      lot.bays.forEach((p, k) => {
        if (!p?.fleet) return;
        if (p.trip) add(p.trip.base?.lot, p.fleet);
        else if (!lot.slots?.[k]?.fleet) add(lot, p.fleet);
      });
    for (const lot of this.lots.values()) {
      if (!lot.slots) continue;
      lot.slots.forEach((s, k) => {
        if (!s.fleet || lot.bays[k]) return;
        const key = `${lot.tile}|${s.fleet}`;
        const n = away.get(key) ?? 0;
        if (n > 0) away.set(key, n - 1);
        else if (!lot.reserved[k]) lot.bays[k] = fleetCar(s.fleet);
      });
    }
  }

  // Şehirdeki otoparkları, garajları ve arabaların gideceği yerleri güncelle
  // (yeni otoparka birkaç araba park etmiş olarak gelir)
  private scan() {
    const seen = new Set<number>();
    this.garages = [];
    const fires = new Map<number, FireStation>();
    const pl: Places = { work: [], shops: [], cargo: [], fun: [], parks: [], transit: [], depots: [], homes: [] };
    this.city.tiles.forEach((t, i) => {
      if (!t || t.kind === 'part' || t.kind === 'road' || t.kind === 'rail') return;
      const k = t.kind as string;
      if (k === 'res') {
        if (t.level >= 1) pl.homes.push(i);
        if (t.level >= 5) {
          const spot = this.spotOf(i);
          if (spot) this.garages.push(spot);
        }
        return;
      }
      if (k === 'parking') {
        const spot = this.spotOf(i);
        if (t.level > 0) {
          // Katlı otopark: arabalar girişten girip kaybolur, sonra çıkıp yola katılır (kat arttıkça daha sık)
          if (spot) for (let n = 0; n <= t.level; n++) this.garages.push(spot);
          return;
        }
        seen.add(i);
        const old = this.lots.get(i);
        if (!spot) {
          this.lots.delete(i);
          return;
        }
        if (old) Object.assign(old, spot);
        else {
          const bays = BAYS.map(() => {
            if (Math.random() >= 0.67) return null;
            const type = pickType(HOME_CARS);
            return { type, noseIn: false, paint: carPaint(CAR_KINDS[type]) };
          });
          this.lots.set(i, { ...spot, bays, reserved: BAYS.map(() => false) });
        }
        return;
      }
      const spot = this.spotOf(i);
      if (!spot) return;
      // Kendi otoparkı olan bina: otopark bir kez kurulur (bina dönerse, taşınırsa ya da büyürse yeniden)
      const site = siteOf(k, t.fp);
      let lot: Lot | undefined;
      if (site?.garages) {
        const old = this.fires.get(i);
        const doors = site.garages.map(([x, z]) => ({ at: this.siteWorld(i, t.facing, site, x, z), road: this.frontRoad(i, t.facing, site, x) }));
        fires.set(i, { spot: { tile: i, road: spot.road, face: t.facing }, doors, trucks: old?.trucks ?? 2 });
      }
      if (site?.bays.length) {
        const key = `${k}|${t.facing}|${t.fp ?? 1}`;
        const old = this.lots.get(i);
        const fresh = this.siteLot(i, t.facing, site, key);
        if (old?.siteKey === key && fresh) {
          // Aynı otopark: yollar değişmiş olabilir, park eden arabalar yerinde kalır
          old.slots = fresh.slots;
          old.road = fresh.road;
          lot = old;
        } else lot = fresh ?? undefined;
        if (lot) {
          seen.add(i);
          this.lots.set(i, lot);
        }
      }
      const place = (weight: number): Place => ({ spot, site: i, what: k, weight, lot });
      if (WORK_KINDS.has(k)) pl.work.push(place((INDUSTRY as Record<string, { jobs: number }>)[k]?.jobs || 12));
      if (SHOP_KINDS.has(k)) pl.shops.push(place(1));
      if (CARGO_KINDS.has(k)) pl.cargo.push(place(k === 'port' ? 3 : k === 'factory' ? 2 : 1));
      if (FUN_KINDS.has(k)) pl.fun.push(place(1));
      if (PARK_KINDS.has(k)) pl.parks.push(place(1));
      if (TRANSIT_KINDS.has(k)) pl.transit.push(place(1));
      if (k === 'depot') pl.depots.push(place(1));
    });
    this.places = pl;
    this.fires = fires;
    for (const i of [...this.lots.keys()]) if (!seen.has(i)) this.lots.delete(i);
    this.waiting = this.waiting.filter(w => this.lots.get(w.lot.tile) === w.lot);
    // Yıkılan binanın otoparkındaki arabalar da gider
    this.inside = this.inside.filter(e => this.lots.get(e.lot.tile) === e.lot && e.lot.bays[e.bay]);
    // Ayrılmış park yerleri baştan sayılır (yolda kaybolan arabanın ayırdığı yer boş kalmasın)
    for (const lot of this.lots.values()) lot.reserved.fill(false);
    const mark = (d?: Dest) => {
      if (d?.kind !== 'lot' || d.bay === undefined) return;
      const l = d.spot as Lot;
      if (this.lots.get(l.tile) === l) l.reserved[d.bay] = true;
    };
    for (const c of this.cars) {
      mark(c.dest);
      c.plan?.forEach(mark);
    }
    for (const w of this.waiting) w.trip.plan.forEach(mark);
    for (const lot of this.lots.values()) for (const p of lot.bays) p?.trip?.plan.forEach(mark);
    this.refillFleet();
    // Yollar değiştiyse hedeflere uzaklıklar yeniden hesaplansın
    this.router.sync();
  }

  // Yeni kareye girince: gezerken rastgele (kalabalık yolları severek), hedefi varsa en kısa yoldan
  private choose(v: Vehicle) {
    const t = this.city.tiles[v.tile];
    if (t?.under !== undefined && v.wide === 0) {
      // Alt geçitli kavşak: caddenin iç şeridi alttan düz geçer (dönemez)
      if (v.dIn % 2 === t.under && roadDirs(this.city, v.tile).includes(v.dIn)) return v.dIn;
      // Yan yoldan gelip caddeye dönen iç şerit arabası dış şeride geçer (iç şerit hendekte)
      const d = this.pick(v);
      if (d % 2 === t.under) v.wideNext = 1;
      return d;
    }
    return this.pick(v);
  }

  private pick(v: Vehicle) {
    // Şehrin girişindeki ilk karede batıya giden U dönüşü yapmaz, otobana çıkar (otobanda aynı şeritten devam eder)
    if (this.highway && v.tile === idx(0, ENTRANCE_Z) && v.dIn === 3) return 3;
    if (v.trip > 0) v.trip--;
    if (v.trip <= 0 && !v.dest) v.dest = this.nextDest(v);
    const dest = v.dest;
    if (!dest || v.trip > 0) return pickExit(this.city, v.tile, v.dIn, true);
    if (v.tile === dest.road) {
      if (dest.kind === 'exit') return 3; // otoyola çık
      // Hedefin önünde: düz devam etsin (girişe kare ortasında döner)
      const dirs = roadDirs(this.city, v.tile);
      return dirs.includes(v.dIn) ? v.dIn : pickExit(this.city, v.tile, v.dIn, true);
    }
    const f = this.router.field(dest.road);
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
      this.unreserve(v);
      v.trip = 6;
      return pickExit(this.city, v.tile, v.dIn, true);
    }
    return best;
  }

  private unreserve(v: Vehicle) {
    if (v.dest?.kind === 'lot' && v.dest.bay !== undefined) {
      const lot = v.dest.spot as Lot;
      lot.reserved[v.dest.bay] = false;
    }
    v.dest = undefined;
  }

  // Sıradaki hedef: planda ne varsa (yıkılmış binalar atlanır); plan bittiyse eski usul bir otopark, garaj ya da çıkış
  private nextDest(v: Vehicle): Dest {
    while (v.plan?.length) {
      const d = v.plan.shift()!;
      if (d.kind === 'home') return this.homeDest(v);
      if (d.kind === 'lot' && d.site !== undefined && this.lots.get((d.spot as Lot).tile) !== d.spot) continue;
      if (d.kind === 'garage' && d.site !== undefined && this.city.tiles[d.site]?.kind !== d.what) continue;
      return d;
    }
    return this.pickDest(v);
  }

  // Gezinti bitince nereye: binanın aracıysa binasına, değilse bir otoparka, bir gökdelenin garajına ya da
  // otoyoldan şehir dışına
  private pickDest(v: Vehicle): Dest {
    const exit: Dest = { kind: 'exit', road: idx(0, ENTRANCE_Z) };
    if (v.type < 0) return exit;
    if (v.fleet || v.job === 'service') return this.homeDest(v);
    const r = Math.random();
    if (r < 0.55) {
      const lot = this.freeLot(v.tile, true);
      if (lot) return this.reserve(lot);
    }
    // Otoban kalabalıksa şehirden çıkmak yerine şehirde bir garaja gitsin
    if ((r < 0.8 || this.highway?.busy()) && this.garages.length) {
      const g = rnd(this.garages);
      return { kind: 'garage', spot: g, road: g.road };
    }
    return exit;
  }

  // Boş yeri olan otopark: near karesine en yakını (spread: yakındakilerden rastgele biri)
  private freeLot(near: number, spread = false): Lot | null {
    const f = this.router.field(near);
    const list: [Lot, number][] = [];
    for (const lot of this.lots.values()) {
      // Evlerin arabaları şehir otoparklarına (binaların otoparkı o binaya gelenlerin)
      if (lot.slots || !lot.bays.some((b, k) => !b && !lot.reserved[k])) continue;
      const d = f[lot.road];
      if (d >= 0) list.push([lot, d]);
    }
    if (!list.length) return null;
    list.sort((a, b) => a[1] - b[1]);
    return spread ? list[Math.floor(Math.random() * Math.min(4, list.length))][0] : list[0][0];
  }
  private reserve(lot: Lot): Dest {
    const bay = lot.bays.findIndex((b, k) => !b && !lot.reserved[k]);
    lot.reserved[bay] = true;
    return { kind: 'lot', spot: lot, bay, road: lot.road };
  }

  // Eve dönen arabanın park yeri: kendi otoparkı (boş yeri varsa) ya da ona en yakın boş yer; kulede oturan
  // kendi garajına girer. Otopark yoksa bir garaj, o da yoksa şehirden çıkar.
  // Binanın kendi aracı (polis, ambulans, kamyon) binasındaki yerine, itfaiye aracı garajına döner.
  private homeDest(v: Vehicle): Dest {
    const base = v.base;
    const exit: Dest = { kind: 'exit', road: idx(0, ENTRANCE_Z) };
    if (v.fleet || v.job === 'service') {
      if (base?.garage) {
        // İtfaiye aracı çıktığı garaj kapısına (bina değiştiyse en yakın kapıya) döner
        const fs = this.fires.get(base.garage.tile);
        const at = base.garage.at;
        const doors = fs?.doors.filter(d => d.road >= 0) ?? [];
        const door = at ? doors.reduce<(typeof doors)[number] | undefined>((b, d) => (!b || d.at.distanceToSquared(at) < b.at.distanceToSquared(at) ? d : b), undefined) : doors[0];
        if (fs && door) {
          const spot: Spot = { ...fs.spot, at: door.at, road: door.road };
          return { kind: 'garage', spot, road: door.road, site: base.garage.tile, what: 'fire' };
        }
        return exit;
      }
      // Yalnızca kendi binasına döner (başka binanın aracının yerine park etmez; yerinde boş yer hep kalır).
      // Binası yıkıldıysa şehirden çıkar.
      const truck = v.fleet === 'truck' || v.fleet === 'garbage';
      const home = base?.lot && this.lots.get(base.lot.tile) === base.lot ? base.lot : null;
      const bay = home ? this.freeBay(home, truck, v.fleet) : -1;
      if (!home || bay < 0) return exit;
      home.reserved[bay] = true;
      return { kind: 'lot', spot: home, bay, road: this.bayRoad(home, bay) };
    }
    const garage = base?.garage && this.garages.find(g => g.tile === base.garage!.tile);
    if (garage) return { kind: 'garage', spot: garage, road: garage.road };
    const near = base?.lot && this.lots.get(base.lot.tile) === base.lot ? base.lot.road : null;
    const lot = near !== null ? this.freeLot(near) : this.freeLot(v.tile, true);
    if (lot) return this.reserve(lot);
    if (this.garages.length) {
      const g = rnd(this.garages);
      return { kind: 'garage', spot: g, road: g.road };
    }
    return { kind: 'exit', road: idx(0, ENTRANCE_Z) };
  }

  // Bir yer listesinden from karesinden yolla ulaşılabilen biri: yakındakiler çok daha sık seçilir (yolculuklar
  // kısa sürsün, akşam herkes eve dönebilsin; şehrin bir ucundan öbür ucuna giden az olur)
  private choosePlace(list: Place[], from: number, _tries = 3, not?: Place): Place | null {
    if (!list.length) return null;
    const f = this.router.field(from);
    let total = 0;
    const w = list.map(p => {
      const d = p === not ? -1 : f[p.spot.road];
      const s = d < 0 ? 0 : p.weight * Math.exp(-d / 9);
      total += s;
      return s;
    });
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (let k = 0; k < list.length; k++) if ((r -= w[k]) <= 0 && w[k] > 0) return list[k];
    return list.find((_, k) => w[k] > 0) ?? null;
  }
  // Binanın otoparkında boş yer: kamyon önce kamyon yerine (kamyon yeri olmayan dükkânda araba yerine), araba
  // araba yerine; binanın kendi araçlarının yerleri (polis, ambulans...) yalnızca o araçlara (fleet verilince)
  private freeBay(lot: Lot, truck: boolean, fleet?: SiteBay['fleet']) {
    const slots = lot.slots;
    if (!slots) return -1;
    const anyTruck = slots.some(s => s.truck);
    let fallback = -1;
    for (let k = 0; k < slots.length; k++) {
      const s = slots[k];
      if (lot.bays[k] || lot.reserved[k] || s.road < 0) continue;
      if (fleet) {
        if (s.fleet === fleet) return k;
        if (!s.fleet && !!s.truck === truck && fallback < 0) fallback = k;
        continue;
      }
      if (s.fleet) continue;
      if (!!s.truck === truck) return k;
      if (truck && !anyTruck && fallback < 0) fallback = k;
    }
    return fallback;
  }
  // Arabanın gidebileceği yerler: kendi otoparkında boş yeri olanlar (yakındakiler çok daha sık seçilir)
  private chooseVisit(list: Place[], from: number, truck = false, not?: Place): Place | null {
    return this.choosePlace(list.filter(p => p.lot && p !== not && this.freeBay(p.lot, truck) >= 0), from);
  }
  // Binanın otoparkında bir yer ayır: araba oraya park eder, sürücü stay saniye binada kalır (-1: akşama kadar)
  private visit(p: Place, stay: number, truck = false): Dest | null {
    const lot = p.lot;
    const bay = lot ? this.freeBay(lot, truck) : -1;
    if (!lot || bay < 0) return null;
    lot.reserved[bay] = true;
    return { kind: 'lot', spot: lot, bay, road: this.bayRoad(lot, bay), stay, site: p.site, what: p.what };
  }
  // Park yerine girip çıkarken kullanılan yol (binanın otoparkında her yerin önündeki kare)
  private bayRoad(lot: Lot, bay: number) {
    return lot.slots?.[bay]?.road ?? lot.road;
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

  // Binadan ya da otoparktan yola çıkış yönü ve şeritteki nokta (gideceği yer verilirse o yöne doğru)
  private exitTo(spot: Spot, v: Vehicle, target?: number) {
    const dirs = roadDirs(this.city, spot.road).filter(d => d !== (spot.face + 2) % 4);
    const side = dirs.filter(d => d % 2 !== spot.face % 2);
    let list = side.length ? side : dirs.length ? dirs : [spot.face];
    if (target !== undefined && list.length > 1) {
      const f = this.router.field(target);
      const dist = (d: number) => {
        const n = neighbor(spot.road, d);
        return n < 0 || f[n] < 0 ? Infinity : f[n];
      };
      const best = Math.min(...list.map(dist));
      if (best < Infinity) list = list.filter(d => dist(d) === best);
    }
    const dir = list[Math.floor(Math.random() * list.length)];
    const pt = new THREE.Vector3();
    lanePos(this.city, { tile: spot.road, dIn: dir, dOut: dir, t: 0.5, speed: 0, fade: 1 }, this.laneOf(v), CAR_Y, pt);
    return { dir, pt };
  }
  // Arabanın ilk gideceği yolun karesi (yola çıkarken o yöne dönsün)
  private firstTarget(plan?: Dest[]) {
    const d = plan?.[0];
    return d && d.kind !== 'home' ? d.road : undefined;
  }

  private bayPos(lot: Lot, bay: number) {
    const s = lot.slots?.[bay];
    if (s) return s.pos.clone().setY(CAR_Y);
    return center(lot.tile).setY(CAR_Y).addScaledVector(right(lot.face), BAYS[bay]).addScaledVector(fwd(lot.face), -BAY_BACK);
  }

  // Caddede hangi şeritten başlasın (alt geçidin rampasında ve kapalı karede dış şerit)
  private startLane(road: number) {
    return Math.random() < 0.5 && !this.city.rampOf(road) && this.city.tiles[road]?.under === undefined ? 0 : 1;
  }

  // Otoparktaki arabayı yola çıkar (binanın otoparkında yerin önündeki yoldan)
  private pullOut(lot: Lot, bay: number, trip: Trip) {
    const p = lot.bays[bay];
    if (!p) return;
    const road = this.bayRoad(lot, bay);
    const v: Vehicle = { tile: road, dIn: 0, dOut: 0, t: 0.5, speed: 0.8 + Math.random() * 0.5, fade: 1, type: p.type, paint: p.paint, wide: this.startLane(road), trip: trip.roam ?? 0, job: trip.job, plan: [...trip.plan], base: trip.base, fleet: p.fleet };
    const { dir, pt } = this.exitTo({ tile: lot.tile, road, face: lot.face }, v, this.firstTarget(v.plan));
    const f = fwd(lot.face), r = right(lot.face);
    const b = this.bayPos(lot, bay);
    const toward = fwd(dir);
    const segs: Seg[] = [];
    if (p.noseIn) {
      // Önce geri geri koridora çık, sonra ileri yola
      const s = Math.sign(toward.dot(r)) || (Math.random() < 0.5 ? -1 : 1);
      const a = lot.slots ? b.clone().addScaledVector(f, 0.36) : center(lot.tile).setY(CAR_Y).addScaledVector(f, 0.16).addScaledVector(r, BAYS[bay] * 0.4);
      segs.push(seg([b, b.clone().addScaledVector(f, 0.22), a.clone().addScaledVector(r, s * 0.14), a], true));
      segs.push(seg([a, a.clone().addScaledVector(r, s * 0.2), pt.clone().addScaledVector(toward, -0.4), pt]));
    } else {
      segs.push(seg([b, b.clone().addScaledVector(f, 0.45), pt.clone().addScaledVector(toward, -0.4), pt]));
    }
    v.man = { segs, k: 0, u: 0, end: 'road', dir, road, site: lot.tile };
    lot.bays[bay] = null;
    this.cars.push(v);
  }

  // Binanın (garajın) içinden yola çık; yol doluysa false. Garaj kapısı verilmişse (itfaiye) kapıdan çıkar.
  private driveOut(spot: Spot, init: Partial<Vehicle> & { type: number; job: Job }) {
    const v: Vehicle = { tile: spot.road, dIn: 0, dOut: 0, t: 0.5, speed: 0.8 + Math.random() * 0.5, fade: 0, paint: carPaint(CAR_KINDS[init.type]), wide: this.startLane(spot.road), trip: 0, ...init };
    const { dir, pt } = this.exitTo(spot, v, this.firstTarget(v.plan));
    const f = fwd(spot.face);
    // Binanın içinden tam boyda çıkar (küçükten büyümez)
    const g = spot.at ? spot.at.clone().setY(CAR_Y).addScaledVector(f, -0.16) : center(spot.tile).setY(CAR_Y).addScaledVector(f, -0.04);
    if (this.busyAt(pt)) return false;
    v.man = { segs: [seg([g, g.clone().addScaledVector(f, 0.45), pt.clone().addScaledVector(fwd(dir), -0.4), pt])], k: 0, u: 0, end: 'road', dir, road: spot.road, fadeIn: true };
    v.fade = 0;
    v.dest = undefined;
    v.man.site = undefined;
    this.cars.push(v);
    return true;
  }

  // Bu otoparkta şu an park eden ya da çıkan bir araba var mı?
  private lotBusy(tile: number) {
    return this.cars.some(c => c.man?.site === tile);
  }

  // Yoldan binaya dönerken geçeceği yerde (yanındaki şeritte) başka bir araç var mı?
  private turnBusy(v: Vehicle) {
    const me = this.boxes.find(b => b.id === v.id);
    const dest = v.dest, spot = dest?.spot;
    if (!me || !dest || !spot) return false;
    const lot = spot as Lot;
    const to = lot.slots && dest.bay !== undefined ? this.bayPos(lot, dest.bay) : spot.at ?? center(spot.tile);
    for (const o of this.boxes) {
      if (o.id === v.id) continue;
      // Arabanın konumu ile bina arasındaki çizgiye yakın mı?
      const ax = to.x - me.x, az = to.z - me.z;
      const L = Math.hypot(ax, az) || 1;
      const t = THREE.MathUtils.clamp(((o.x - me.x) * ax + (o.z - me.z) * az) / (L * L), 0, 1);
      const d = Math.hypot(me.x + ax * t - o.x, me.z + az * t - o.z);
      if (d < 0.22 && t > 0.05) return true;
    }
    return false;
  }

  // Hedefin önüne gelen araba otoparka, garaja ya da binaya girer
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
      v.man = { segs: [seg([pos, pos.clone().addScaledVector(dir, 0.35), b.clone().addScaledVector(f, 0.4), b])], k: 0, u: 0, end: 'lot', lot, bay: dest.bay, site: lot.tile, dest };
    } else {
      // Garaja girerken küçülmez: garajın kapısından içeri sürer, duvarların arkasında kaybolur
      const g = spot.at ? spot.at.clone().setY(CAR_Y).addScaledVector(f, -0.16) : center(spot.tile).setY(CAR_Y).addScaledVector(f, -0.04);
      v.man = { segs: [seg([pos, pos.clone().addScaledVector(dir, 0.35), g.clone().addScaledVector(f, 0.45), g])], k: 0, u: 0, end: 'garage', fadeOut: true, dest };
    }
  }

  // Binanın otoparkına park etti: sürücü inip kapıdan içeri yürür, içeride stay saniye kalır (kamyonun sürücüsü
  // inmez, yükü indirip alır). İşi bitince kapıdan çıkıp arabasına yürür ve yola devam eder.
  private arriveAt(lot: Lot, bay: number, stay: number, driver: boolean) {
    const rec: Inside = { lot, bay, until: this.clock + Math.max(0, stay), evening: stay < 0, driver, since: this.clock };
    const path = lot.slots?.[bay]?.walk;
    if (driver && path && this.walkers) {
      this.walkers.addTrip(path, false, false, () => {
        rec.until = this.clock + Math.max(0, stay);
        rec.since = this.clock;
        this.inside.push(rec);
      }, 'in');
    } else this.inside.push(rec);
  }

  // --- Yeni yolculuklar ---

  // Otoparktaki arabasına evinden yürüyen biri: sabah işe, gündüz alışverişe, akşam ve gece gezmeye.
  // Gittiği yerin kendi otoparkına park eder, kapısından içeri yürür.
  private fromLot() {
    const lots = [...this.lots.values()].filter(l => !l.slots && l.bays.some(b => b && !b.leaving));
    if (!lots.length) return false;
    const lot = rnd(lots);
    const bay = lot.bays.findIndex(b => b && !b.leaving);
    const car = lot.bays[bay]!;
    const pl = this.places;
    let plan: Dest[] | null = null;
    let job: Job = 'errand';
    const home: Dest = { kind: 'home', road: -1 };
    if (this.phase === 'morning') {
      if (isCargo(car.type)) {
        // Kamyonetli: önce fabrikadan ya da depodan mal alır, dükkâna götürür
        const from = this.chooseVisit(pl.cargo, lot.road, true);
        const to = from && this.chooseVisit([...pl.shops, ...pl.cargo], from.spot.road, true, from);
        const a = from && to && this.visit(from, 3 + Math.random() * 2, true);
        const b = a && to && this.visit(to, 3 + Math.random() * 2, true);
        if (a && b) {
          plan = [a, b, home];
          job = 'cargo';
        }
      }
      if (!plan) {
        const w = this.chooseVisit(pl.work, lot.road);
        const d = w && this.visit(w, -1);
        if (d) {
          plan = [d, home];
          job = 'work';
        }
      }
    } else {
      // Alışveriş ya da gezme: gece eğlence yerleri, gündüz daha çok dükkân
      const fun = this.phase === 'night' || Math.random() < 0.35;
      const p = this.chooseVisit(fun ? pl.fun : pl.shops, lot.road) ?? this.chooseVisit(fun ? pl.shops : pl.fun, lot.road);
      const d = p && this.visit(p, 5 + Math.random() * 7);
      if (d) plan = [d, home];
    }
    if (!plan) return false;
    car.leaving = true;
    const trip: Trip = { job, plan, base: { lot } };
    const path = this.walkPath(lot, bay);
    if (path && this.walkers) {
      this.pending++;
      this.walkers.addTrip(path, false, false, () => {
        this.pending--;
        this.waiting.push({ lot, bay, trip });
      }, 'out');
    } else this.waiting.push({ lot, bay, trip });
    return true;
  }

  // Kulede oturan: kulenin garajından çıkıp işe ya da alışverişe gider, akşam garajına döner
  private fromGarage() {
    if (!this.garages.length) return false;
    const g = rnd(this.garages);
    const pl = this.places;
    const morning = this.phase === 'morning';
    const p = morning ? this.chooseVisit(pl.work, g.road) : this.chooseVisit(Math.random() < 0.6 ? pl.shops : pl.fun, g.road);
    const d = p && this.visit(p, morning ? -1 : 5 + Math.random() * 7);
    if (!d) return false;
    if (this.driveOut(g, { type: pickType(HOME_CARS), job: morning ? 'work' : 'errand', plan: [d, { kind: 'home', road: -1 }], base: { garage: g } })) return true;
    (d.spot as Lot).reserved[d.bay!] = false;
    return false;
  }

  // Binanın kendi aracı (kamyon, çöp kamyonu, polis, ambulans) park yerinden yola çıksın
  private fleetOut(kind: SiteBay['fleet'], trip: (lot: Lot, bay: number) => Trip | null) {
    const list: [Lot, number][] = [];
    for (const lot of this.lots.values()) {
      if (!lot.slots) continue;
      lot.bays.forEach((p, k) => {
        if (p && p.fleet === kind && !p.leaving && !p.trip) list.push([lot, k]);
      });
    }
    if (!list.length) return false;
    const [lot, bay] = rnd(list);
    const t = trip(lot, bay);
    if (!t) return false;
    lot.bays[bay]!.leaving = true;
    this.waiting.push({ lot, bay, trip: t });
    return true;
  }

  // Kamyon: fabrikanın ya da deponun kamyonu mal alıp dükkâna ya da başka bir fabrikaya götürür, yükü indirip
  // kendi binasına döner
  private cargoRun() {
    const pl = this.places;
    // Yolda en fazla arabaların üçte biri kamyon olsun
    if (this.cars.filter(c => c.job === 'cargo').length > this.wanted / 3) return false;
    return this.fleetOut('truck', lot => {
      const here = pl.cargo.find(p => p.lot === lot);
      const to = this.chooseVisit(Math.random() < 0.75 && pl.shops.some(p => p.lot) ? pl.shops : pl.cargo, lot.road, true, here);
      const d = to && this.visit(to, 3 + Math.random() * 2.5, true);
      return d ? { job: 'cargo', plan: [d, { kind: 'home', road: -1 }], base: { lot } } : null;
    });
  }

  // Çöp kamyonu: sabah depodan çıkar, mahalleleri dolaşır, depoya döner
  private garbageRun() {
    if (this.cars.some(c => c.job === 'garbage' && !c.out)) return false;
    return this.fleetOut('garbage', lot => ({ job: 'garbage', plan: [{ kind: 'home', road: -1 }], base: { lot }, roam: 18 + Math.floor(Math.random() * 14) }));
  }

  // Taksi: bir garajdan çıkar, dolaşır, bir yerin otoparkında müşteri alıp bırakır, garaja ya da şehir dışına gider
  private taxiRun() {
    if (!this.garages.length) return false;
    const g = rnd(this.garages);
    const pl = this.places;
    const p = this.chooseVisit(pl.fun, g.road) ?? this.chooseVisit(pl.shops, g.road);
    const d = p && this.visit(p, 1.5);
    const plan: Dest[] = d ? [d] : [];
    if (this.driveOut(g, { type: CAR_KINDS.indexOf('taxi'), job: 'taxi', trip: 6 + Math.floor(Math.random() * 10), plan })) return true;
    if (d) (d.spot as Lot).reserved[d.bay!] = false;
    return false;
  }

  // Akşam: işten çıkan, iş yerinin kapısından çıkıp arabasına yürür ve evine döner
  private returnHome() {
    const k = this.inside.findIndex(e => e.evening);
    if (k < 0) return false;
    this.releaseInside(this.inside[k]);
    this.inside.splice(k, 1);
    return true;
  }

  // İçerideki sürücü kapıdan çıkıp arabasına yürür (kamyonda yükleme biter), araba yola çıkıp planına devam eder
  private releaseInside(e: Inside) {
    const p = e.lot.bays[e.bay];
    if (!p || p.leaving) return;
    p.leaving = true;
    // Yolculuk araba yola çıkana kadar arabada kalır (binanın kendi aracı yolda sayılsın, yerine yenisi gelmesin)
    const trip = (p.trip ??= { job: 'roam' as Job, plan: [] });
    if (e.evening) trip.job = 'home';
    const path = e.lot.slots?.[e.bay]?.walk;
    if (e.driver && path && this.walkers) {
      this.pending++;
      this.walkers.addTrip([...path].reverse(), false, false, () => {
        this.pending--;
        this.waiting.push({ lot: e.lot, bay: e.bay, trip });
      }, 'out');
    } else this.waiting.push({ lot: e.lot, bay: e.bay, trip });
  }

  // Otobandan şehre gelen: sabah bir kısmı işe (akşam şehirden çıkar), kamyonlar fabrikaya ve depoya mal getirir,
  // diğerleri gezilecek yerlere ve dükkânlara uğrar, sonra şehirden çıkar. Hepsi gittiği yerin otoparkına park eder.
  private visitorPlan(type: number): Trip {
    const from = idx(0, ENTRANCE_Z);
    const exit: Dest = { kind: 'exit', road: from };
    const pl = this.places;
    const truck = isCargo(type) || CAR_KINDS[type] === 'garbage';
    if (truck) {
      const p = this.chooseVisit(pl.cargo, from, true) ?? this.chooseVisit(pl.shops, from, true);
      const d = p && this.visit(p, 3 + Math.random() * 2, true);
      if (d) return { job: 'cargo', plan: [d, exit] };
    }
    if (this.phase === 'morning' && Math.random() < 0.5) {
      const w = this.chooseVisit(pl.work, from);
      const d = w && this.visit(w, -1);
      if (d) return { job: 'work', plan: [d, exit] };
    }
    const fun = Math.random() < 0.6;
    const p = this.chooseVisit(fun ? pl.fun : pl.shops, from) ?? this.chooseVisit(fun ? pl.shops : pl.fun, from);
    const d = p && this.visit(p, 6 + Math.random() * 8);
    if (d) return { job: 'visit', plan: [d, exit] };
    return { job: 'roam', plan: [] };
  }

  // Saate göre yeni bir yolculuk başlat (ağırlığa göre biri seçilir, olmazsa diğerleri denenir)
  private spawnCar() {
    const P = this.phase;
    const options: [number, () => boolean][] =
      P === 'morning' ? [[0.5, () => this.fromLot()], [0.2, () => this.fromGarage()], [0.15, () => this.cargoRun()], [0.08, () => this.garbageRun()], [0.07, () => this.taxiRun()]]
      : P === 'day' ? [[0.32, () => this.cargoRun()], [0.3, () => this.fromLot()], [0.15, () => this.fromGarage()], [0.13, () => this.taxiRun()], [0.1, () => this.returnHome()]]
      : P === 'evening' ? [[0.8, () => this.returnHome()], [0.1, () => this.fromLot()], [0.1, () => this.taxiRun()]]
      : [[0.5, () => this.taxiRun()], [0.4, () => this.returnHome()], [0.1, () => this.fromLot()]];
    let r = Math.random() * options.reduce((s, o) => s + o[0], 0);
    let first = options.length - 1;
    for (let k = 0; k < options.length; k++) if ((r -= options[k][0]) <= 0) {
      first = k;
      break;
    }
    if (options[first][1]()) return;
    for (let k = 0; k < options.length; k++) if (k !== first && options[k][1]()) return;
    // Hiçbiri olmadıysa (yeni şehir: iş yeri, otopark yok) otobandan gelen arabalar şehri dolaşır
  }

  // Şehrin girişindeki şeritlerin yol ortasına uzaklığı (otobandaki şeritler bunlara hizalanır)
  entranceLanes(): [number, number] {
    return this.city.tiles[idx(0, ENTRANCE_Z)]?.grade === 2 ? [WIDE_LANES[0], WIDE_LANES[1]] : [CAR_LANE, CAR_LANE];
  }

  // Şehre otobandan yeni araba gelsin mi? Şehirdeki araba sayısı yeterliyse otobandakiler tünelde bekler
  // (yoksa otoban durmadan araba gönderir, şehir dolar ve girişte kuyruk olur)
  wantsCars() {
    const moving = this.cars.filter(c => !c.out && c.job !== 'service').length;
    return moving + this.pending + this.waiting.length < this.wanted;
  }

  // Şehrin girişi (o şeritte) dolu mu? (otobandan gelen araba sınırın dışında bekler, kuyruktakilerin içine girmez)
  entranceBusy(wide = 1) {
    const entrance = idx(0, ENTRANCE_Z);
    if (!isRoadTile(this.city, entrance) || this.cars.length >= MAX_CARS + 15) return true;
    const p = new THREE.Vector3();
    lanePos(this.city, { tile: entrance, dIn: 1, dOut: 1, t: 0, speed: 0, fade: 1 }, () => this.entranceLanes()[wide], CAR_Y, p);
    return this.busyAt(p, new THREE.Vector3(1, 0, 0));
  }

  // Otobandan şehrin girişine gelen araba şehirde aynı şeritten yoluna devam eder; giriş doluysa false (araba otobanda bekler)
  enterFromHighway(type: number, paint: THREE.Color, wide = 1) {
    const entrance = idx(0, ENTRANCE_Z);
    // Otobandan gelen otobüs şehirde durakları dolaşır
    if (type < 0) {
      if (!isRoadTile(this.city, entrance)) return false;
      const b: Vehicle = { tile: entrance, dIn: 1, dOut: 1, t: 0, speed: 0.55, fade: 1, type: -1, wide: 1, trip: 1e9, job: 'bus' };
      const p = new THREE.Vector3();
      lanePos(this.city, b, this.laneOf(b), CAR_Y, p);
      if (this.busyAt(p, new THREE.Vector3(1, 0, 0))) return false;
      this.buses.push(b);
      return true;
    }
    if (!isRoadTile(this.city, entrance) || this.cars.length >= MAX_CARS + 15) return false;
    const trip = this.visitorPlan(type);
    const v: Vehicle = { tile: entrance, dIn: 1, dOut: 1, t: 0, speed: 0.8 + Math.random() * 0.5, fade: 1, type, paint, wide, trip: trip.plan.length ? 0 : 10 + Math.floor(Math.random() * 30), job: trip.job, plan: trip.plan };
    const p = new THREE.Vector3();
    lanePos(this.city, v, this.laneOf(v), CAR_Y, p);
    if (this.busyAt(p, new THREE.Vector3(1, 0, 0))) return false;
    this.cars.push(v);
    return true;
  }

  // Otoparkın yanındaki (aynı kaldırımdaki) bir evden arabaya yürüyüş yolu: evin içinden kapıdan çıkar, bahçe
  // yolundan kaldırıma, kaldırımdan otoparka, arabanın yanına
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
        // Ev otoparkla aynı yola bakmalı (kapısı bu kaldırımda)
        if (!h || h.kind !== 'res' || h.level < 1 || h.facing !== lot.face) continue;
        const entry = entryPath(this.city, house, road, (lot.face + 2) % 4);
        if (!entry) continue;
        const y = WALK_Y;
        const s0 = center(lot.road).setY(y).addScaledVector(f, -walk(lot.road));
        const gate = center(lot.tile).setY(y).addScaledVector(f, 0.42);
        const car = this.bayPos(lot, bay).setY(y).addScaledVector(f, 0.25).addScaledVector(right(lot.face), 0.12);
        return [...entry.reverse(), s0, gate, car];
      }
    }
    return null;
  }

  // tod: günün saati (0..1)
  update(dt: number, tod = 0.3) {
    this.clock += dt;
    this.phase = dayPhase(tod);
    // Kaç araç olması gerektiğini saniyede bir hesapla
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 0.6;
      this.scan();
      const roads = this.city.tiles.filter(t => t?.kind === 'road').length;
      const base = Math.min(MAX_CARS, Math.floor(roads / 2.5), 3 + Math.floor(this.city.population / 12));
      this.wanted = Math.round(base * CAR_SHARE[this.phase]);
      const moving = this.cars.filter(c => !c.out && c.job !== 'service');
      if (moving.length + this.pending + this.waiting.length < this.wanted) this.spawnCar();
      // Akşam işten çıkanlar yoldaki araba sayısına bakmadan sırayla eve döner (gündüzün kamyonları ve
      // alışverişe gidenler yüzünden işte kalmasınlar)
      else if ((this.phase === 'evening' || this.phase === 'night') && this.cars.length < MAX_CARS + 10) this.returnHome();
      if (moving.length > base) {
        // Çok fazla araba varsa gezinen biri gezintiyi bitirip yerine dönsün
        const v = moving.find(c => c.trip > 1 && !c.man);
        if (v) v.trip = 1;
      }
      // İşi biten (alışveriş yapan, yük indiren) çıkar
      for (const e of this.inside.filter(e => !e.evening && this.clock >= e.until)) {
        this.releaseInside(e);
        this.inside.splice(this.inside.indexOf(e), 1);
      }
      // İşte olup ertesi sabaha kadar çıkmayan (çok kalabalık akşam) da sabah evine döner
      for (const e of this.inside.filter(e => e.evening && this.clock - e.since > 150)) {
        this.releaseInside(e);
        this.inside.splice(this.inside.indexOf(e), 1);
      }
      // Ambulans, itfaiye ve polis: kendi binasının park yerinden (itfaiye garajından) çıkar, gezip geri döner
      const emergency = this.cars.filter(c => c.job === 'service').length;
      let stations = this.fires.size;
      for (const lot of this.lots.values()) if (lot.slots?.some(s => s.fleet === 'police' || s.fleet === 'ambulance')) stations++;
      if (stations && emergency < Math.min(5, Math.ceil(stations / 3)) && Math.random() < 0.25) {
        const roam = 10 + Math.floor(Math.random() * 25);
        const options: (() => boolean)[] = [
          () => this.fleetOut('police', lot => ({ job: 'service', plan: [{ kind: 'home', road: -1 }], base: { lot }, roam })),
          () => this.fleetOut('ambulance', lot => ({ job: 'service', plan: [{ kind: 'home', road: -1 }], base: { lot }, roam })),
          () => {
            const fs = rnd([...this.fires.values()].filter(f => f.trucks > 0));
            if (!fs) return false;
            const door = rnd(fs.doors.filter(d => d.road >= 0));
            if (!door) return false;
            const spot: Spot = { ...fs.spot, at: door.at, road: door.road };
            if (!this.driveOut(spot, { type: CAR_KINDS.indexOf('fire'), job: 'service', trip: roam, plan: [{ kind: 'home', road: -1 }], base: { garage: spot } })) return false;
            fs.trucks--;
            return true;
          },
        ];
        const first = Math.floor(Math.random() * options.length);
        for (let k = 0; k < options.length && !options[(first + k) % options.length](); k++);
      }
      // Otobüsler: her durak için bir tane (en fazla 12), şehre otoyoldan girer
      const stops = this.city.tiles.filter(t => t?.kind === 'busstop').length;
      const busWanted = Math.min(12, stops);
      const activeBuses = this.buses.filter(b => !b.out);
      const entrance = idx(0, ENTRANCE_Z);
      const busStart = new THREE.Vector3();
      lanePos(this.city, { tile: entrance, dIn: 1, dOut: 1, t: 0, speed: 0, fade: 1 }, () => WIDE_LANES[1], CAR_Y, busStart);
      if (this.highway) {
        // Otoban bağlıysa otobüs tünelden gelir, şehre girişte birden belirmez
        if (activeBuses.length + this.highway.busesComing() < busWanted && isRoadTile(this.city, entrance)) this.highway.sendBus();
      } else if (activeBuses.length < busWanted && isRoadTile(this.city, entrance) && !this.busyAt(busStart)) {
        this.buses.push({ tile: entrance, dIn: 1, dOut: 1, t: 0, speed: 0.55, fade: 0, type: -1, wide: 1, trip: 1e9, job: 'bus' });
      } else if (activeBuses.length > busWanted) activeBuses[0].trip = 0;
    }
    // Sahibi gelen arabalar yol boşalınca çıkar
    this.waiting = this.waiting.filter(w => {
      const p = w.lot.bays[w.bay];
      if (!p) return false;
      const spot: Spot = { tile: w.lot.tile, road: this.bayRoad(w.lot, w.bay), face: w.lot.face };
      const { pt } = this.exitTo(spot, { tile: 0, dIn: 0, dOut: 0, t: 0, speed: 0, fade: 1, type: 0, wide: 0, trip: 0, job: 'roam' });
      if (this.busyAt(pt) || this.lotBusy(w.lot.tile)) return true;
      this.pullOut(w.lot, w.bay, w.trip);
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
    // Kavşakların içindeki araçlar ve hareketleri (arkası henüz çıkmamış olanlar dahil)
    const inside = new Map<number, { v: Vehicle; dIn: number; dOut: number }[]>();
    const occupy = (tile: number, v: Vehicle, dIn: number, dOut: number) => (inside.get(tile) ?? inside.set(tile, []).get(tile)!).push({ v, dIn, dOut });
    for (const v of all) {
      if (isJunction(this.city, v.tile) && !this.underMove(v.tile, v.dIn, v.dOut, v.wide)) occupy(v.tile, v, v.dIn, v.dOut);
      // Kavşaktan yeni çıktı: arkası hâlâ kavşağın içindeyse yer tutar
      // (sadece kavşağın hemen yanındaki karede; birkaç kare uzaklaşınca, ör. durakta bekleyen otobüs, kavşağı tutmaz)
      if (v.lastJ && v.lastJ.tile !== v.tile && neighbor(v.lastJ.tile, v.lastJ.dOut) === v.tile && v.t < this.lengthOf(v) / 2 + 0.02 && !this.underMove(v.lastJ.tile, v.lastJ.dIn, v.lastJ.dOut, v.wide)) occupy(v.lastJ.tile, v, v.lastJ.dIn, v.lastJ.dOut);
      // Durma çizgisini geçmiş, kavşağa girmek üzere: kavşağı şimdiden tutar
      if (v.next !== undefined && v.t > STOP + 0.02) {
        const j = neighbor(v.tile, v.dOut);
        if (j >= 0 && isJunction(this.city, j) && !this.underMove(j, v.dOut, v.next, v.wideNext ?? v.wide)) occupy(j, v, v.dOut, v.next);
      }
    }
    const laneIn = (tile: number, v: Vehicle) => (this.city.tiles[tile]?.grade === 2 ? v.wide : -1);
    // Yeşilde kavşağa girmeyi bekleyenler (uzun bekleyene sıra verilir)
    const queue = new Map<number, { v: Vehicle; dIn: number; dOut: number; wait: number }[]>();
    for (const v of all) {
      if (!v.jwait || v.next === undefined) continue;
      const j = neighbor(v.tile, v.dOut);
      if (j >= 0) (queue.get(j) ?? queue.set(j, []).get(j)!).push({ v, dIn: v.dOut, dOut: v.next, wait: v.jwait });
    }
    // Kavşağa girmeden önce nereye döneceğini seç (yol hakkına bakabilmek için)
    const peek = (v: Vehicle, tile: number) => {
      if (v.next !== undefined) return v.next;
      const save = [v.tile, v.dIn, v.dOut];
      v.tile = tile;
      v.dIn = save[2];
      v.next = this.choose(v);
      [v.tile, v.dIn, v.dOut] = save;
      return v.next;
    };
    const move = (v: Vehicle) => {
      v.id ??= nextId++;
      v.age = (v.age ?? 0) + dt;
      if (v.man) {
        // Otoparka girip çıkarken de önündekini bekle
        if (this.blocked(prev.get(v.id), [])) {
          v.stuck = (v.stuck ?? 0) + dt;
          if (v.stuck < 9) return true;
          // Çok uzun kilitlendi: içinden geçmek yerine kaybolsun
          v.fade = Math.max(0, v.fade - dt * 2.2);
          if (v.fade > 0) return true;
          this.unreserve(v);
          return false;
        }
        v.stuck = 0;
        return this.maneuver(v, dt);
      }
      v.fade = Math.min(1, Math.max(0, v.fade + (v.out || v.vanish ? -dt : dt) * 2.2));
      if ((v.out || v.vanish) && v.fade <= 0) {
        this.unreserve(v);
        return false;
      }
      if (v.vanish) return true;
      const jam = this.city.congestion(v.tile);
      const step = dt * v.speed * ROAD_GRADES[this.city.tiles[v.tile]?.grade ?? 0].speed * (jam > 1 ? Math.max(0.35, 1 / jam) : 1);
      // Alt geçitten geçecek araba ışıkta durmaz, kavşağın yol hakkına karışmaz
      const nextJ = neighbor(v.tile, v.dOut);
      const goesUnder = nextJ >= 0 && v.wide === 0 && this.city.tiles[nextJ]?.under === v.dOut % 2 && !v.man;
      let limit = goesUnder ? Infinity : lightLimit(this.city, v, STOP);
      const len = this.lengthOf(v);
      // Öndeki araç (aynı karede): iki aracın boylarının yarısı ve aradaki boşluk kadar geride dur
      for (const [t, l] of lanes.get(this.key(v)) ?? []) if (t > v.t + 1e-4) limit = Math.min(limit, t - (len + l) / 2 - GAP);
      // Bir sonraki karenin başındaki araç
      const next = neighbor(v.tile, v.dOut);
      if (next >= 0) for (const [t, l] of lanes.get(this.key(v, next, v.dOut)) ?? []) limit = Math.min(limit, 1 + t - (len + l) / 2 - GAP);
      // Şehirden çıkarken otobanın başı doluysa şehrin kenarında bekle (kaybolup sonra belirmesin)
      if (this.highway && v.tile === idx(0, ENTRANCE_Z) && v.dOut === 3 && !this.highway.canLeave(v.wide)) limit = Math.min(limit, Math.max(v.t, 0.9));
      // Yol hakkı: kavşağın içinde yolunu kesen araç varsa, çıkacağı yolda yer yoksa (kavşağı tıkamasın)
      // ya da yolunu kesen ve daha uzun süredir bekleyen biri varsa girmeden bekle
      if (next >= 0 && isJunction(this.city, next) && !goesUnder && v.t > 0.3 && v.t <= STOP + 0.02) {
        const out = peek(v, next);
        const w = laneIn(next, v);
        const cross = (o: { v: Vehicle; dIn: number; dOut: number }) => o.v !== v && conflicts(v.dOut, out, w, o.dIn, o.dOut, laneIn(next, o.v));
        let wait = (inside.get(next) ?? []).some(cross);
        // Çıkış yolunun başında yer var mı?
        const exit = neighbor(next, out);
        if (!wait && exit >= 0) {
          for (const [t, l] of lanes.get(this.key(v, exit, out)) ?? []) if (t - l / 2 < len + GAP) wait = true;
        }
        const green = isGreen(next, v.dOut);
        if (!wait && green) wait = (queue.get(next) ?? []).some(o => o.wait > (v.jwait ?? 0) + 1.5 && cross(o));
        if (wait) {
          limit = Math.min(limit, Math.max(v.t, STOP));
          if (green) v.jwait = (v.jwait ?? 0) + dt;
          // Yeşilde çok uzun kilitlendi (15 sn): başkasının içinden geçmesin, yavaşça kaybolsun
          if ((v.jwait ?? 0) > 15 && v.job !== 'service') v.vanish = true;
        } else {
          v.jwait = 0;
          // Yeşilde girmeye karar verdi: aynı karede gelen başkası da girmesin.
          // Kırmızıda bekleyen kavşağı tutmaz (yoksa yeşil yanan yöndekiler onu bekler, ışık işe yaramaz)
          if (green) occupy(next, v, v.dOut, out);
        }
      } else if (v.jwait) v.jwait = 0;
      // Önünde araç ya da yaya varsa dur (uzun süre kilitlenirse yavaşça devam et).
      // Yayayı 6 saniyeden uzun beklerse (yaya da onu bekliyorsa) bir buçuk saniye yayalara bakmadan geçer
      let go = step;
      if (v.pedPass) v.pedPass = Math.max(0, v.pedPass - dt);
      const bk = this.blocked(prev.get(v.id), v.pedPass ? [] : people);
      v.ped = bk === 'ped';
      if (bk === 'ped') {
        v.pedWait = (v.pedWait ?? 0) + dt;
        if (v.pedWait > 6) {
          v.pedPass = 1.5;
          v.pedWait = 0;
        }
      } else if (!bk) v.pedWait = 0;
      if (bk) {
        go = 0;
        // Sırada beklemek normal (kırmızı ışık, kuyruk); sayaç sadece yolunu kesen araçla kilitlenince işler.
        // Çok uzun kilitlenirse başkasının içinden geçmesin, yavaşça kaybolsun
        v.stuck = bk === 'cross' ? (v.stuck ?? 0) + dt : 0;
        if (v.stuck > 9 && v.job !== 'service') v.vanish = true;
      } else v.stuck = 0;
      const before = { tile: v.tile, dIn: v.dIn, dOut: v.dOut };
      const alive = advance(this.city, v, go, true, Math.max(v.t, limit), m => {
        const veh = m as Vehicle;
        let d: number;
        if (veh.next !== undefined) {
          d = veh.next;
          veh.next = undefined;
        } else d = this.choose(veh);
        // Alt geçitli kavşakta caddeye dönen dış şeride geçer
        if (veh.wideNext !== undefined) {
          veh.wide = veh.wideNext;
          veh.wideNext = undefined;
        }
        return d;
      });
      if (v.tile !== before.tile) {
        if (isJunction(this.city, before.tile)) v.lastJ = before;
        if (isJunction(this.city, v.tile) && !this.underMove(v.tile, v.dIn, v.dOut, v.wide)) occupy(v.tile, v, v.dIn, v.dOut);
      }
      // Şehirden çıkan araba ve otobüs otobana geçer (aynı renk ve model, aynı şerit)
      if (v.out && v.job !== 'service' && this.highway) {
        this.highway.leaveCity(v.type, v.paint ?? new THREE.Color('#ffffff'), v.wide);
        this.unreserve(v);
        return false;
      }
      if (!alive) {
        this.unreserve(v);
        return false;
      }
      // Hedefinin önüne geldi: otoparka, garaja ya da binaya dön
      const dest = v.dest;
      if (dest && v.trip <= 0 && dest.kind !== 'exit' && v.tile === dest.road && v.t >= 0.45 && v.t < 0.95 && this.underOf(v) < 0.05) {
        const t = this.city.tiles[dest.spot!.tile];
        const gone = !t || (dest.kind === 'lot' ? this.lots.get(dest.spot!.tile) !== dest.spot : dest.what !== undefined && t.kind !== dest.what && this.city.tiles[dest.site!]?.kind !== dest.what);
        if (gone) {
          // Bina yok olmuş: sıradaki yere gitsin
          this.unreserve(v);
          v.trip = 0;
        } else if (!this.turnBusy(v) && !(dest.kind === 'lot' && this.lotBusy(dest.spot!.tile))) this.pullIn(v);
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
      this.boxes.push({ x: this.tmp.position.x, z: this.tmp.position.z, h: this.tmp.rotation.y, len: this.lengthOf(v) / 2, wid: this.widthOf(v) / 2, id: v.id ?? 0, ped: v.ped, u: this.underOf(v) });
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

  // Otoparka ya da binaya girip çıkarken eğri boyunca ilerle
  private maneuver(v: Vehicle, dt: number) {
    const m = v.man!;
    const s = m.segs[m.k];
    // Yola çıkmadan önce (son kavis) yolda yanından araba geçiyorsa bekle
    if (m.end === 'road' && m.k === m.segs.length - 1 && m.u < 0.05 && (v.exitWait ?? 0) < 6) {
      const end = s.p[s.p.length - 1];
      if (this.busyAt(end, end.clone().sub(s.p[0]).normalize())) {
        v.exitWait = (v.exitWait ?? 0) + dt;
        return true;
      }
    }
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
    if (m.end === 'garage') {
      // İtfaiye aracı garajına girdi
      if (m.dest?.what === 'fire') {
        const fs = this.fires.get(m.dest.site!);
        if (fs) fs.trucks++;
      }
      return false;
    }
    const lot = m.lot, bay = m.bay!;
    if (m.end === 'lot' && lot && this.lots.get(lot.tile) === lot) {
      lot.reserved[bay] = false;
      if (!lot.bays[bay]) {
        const stay = m.dest?.stay;
        if (lot.slots && stay !== undefined) {
          // Gittiği binanın otoparkına park etti: sürücü inip kapıdan içeri yürür (kamyonun sürücüsü inmez)
          const trip: Trip = { job: v.job, plan: v.plan ?? [], base: v.base };
          lot.bays[bay] = { type: v.type, noseIn: true, paint: v.paint, trip, fleet: v.fleet };
          this.arriveAt(lot, bay, stay, !v.fleet && v.job !== 'taxi');
        } else if (lot.slots) {
          // Binanın kendi aracı yerine döndü
          lot.bays[bay] = { type: v.type, noseIn: true, paint: v.paint, fleet: v.fleet ?? lot.slots[bay].fleet };
        } else {
          // Evinin yanındaki otoparka park etti: sürücü inip evine yürür, kapıdan girer
          lot.bays[bay] = { type: v.type, noseIn: true, paint: v.paint };
          const path = this.walkPath(lot, bay);
          if (path && this.walkers) this.walkers.addTrip(path.reverse(), false, false, undefined, 'in');
        }
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
      // Alt geçitte araba rampayla aşağı iner; rampada burnu eğik (inerken aşağı, çıkarken yukarı)
      const u = this.underOf(v);
      const yaw = lanePos(this.city, v, this.laneOf(v), y - UNDERPASS.depth * u, this.tmp.position);
      let pitch = 0;
      if (u > 0 && u < 1) {
        const r = this.city.rampOf(v.tile);
        if (r) pitch = (v.dOut === r.dir ? 1 : -1) * Math.atan(UNDERPASS.depth);
      }
      this.tmp.rotation.set(pitch, yaw, 0, 'YXZ');
    }
    // Garaja girip çıkarken boyu değişmez (bina gizler); diğer belirip kaybolmalarda küçülüp büyür
    const garage = v.man && (v.man.fadeIn || v.man.fadeOut);
    const scale = v.type < 0 ? BUS_SCALE : CAR_SCALE;
    this.tmp.scale.setScalar(scale * (garage ? 1 : THREE.MathUtils.smoothstep(v.fade, 0, 1)));
    this.tmp.updateMatrix();
    return this.tmp.matrix;
  }
}

// Binaların türleri: arabalar ve yayalar nereye gider
const WORK_KINDS = new Set(['factory', 'store', 'market', 'furniture', 'bakery', 'fashion', 'garden', 'cafe', 'electro', 'depot', 'port', 'police', 'fire', 'health', 'school', 'hall', 'plant', 'pump', 'uni', 'airport', 'museum', 'casino', 'zoo', 'stadium', 'funfair', 'station']);
const SHOP_KINDS = new Set(['store', 'market', 'furniture', 'bakery', 'fashion', 'garden', 'cafe', 'electro']);
const CARGO_KINDS = new Set(['factory', 'depot', 'port']);
const FUN_KINDS = new Set(['museum', 'zoo', 'stadium', 'funfair', 'casino', 'beach', 'marina', 'eiffel', 'liberty', 'colosseum', 'pisa', 'galata', 'pyramid', 'observatory', 'mosque', 'wheel', 'airport', 'volley', 'clocktower']);
const PARK_KINDS = new Set(['park', 'fountain', 'statue', 'lake', 'biglake', 'hill']);
const TRANSIT_KINDS = new Set(['busstop', 'metro', 'station']);

// Kaldırımlarda yürüyen insanlar: bacakları ve kolları yürürken sallanır, herkesin kıyafeti ve saçı farklı.
// Hepsinin gideceği bir yer var: sabah evinden işine, okula ya da durağa; gündüz dükkana, parka ve geri evine;
// akşam işten eve. Kaldırımın iki yanında da yürünür; kavşakta karşıya geçerken yaya geçidinden geçer (ışığa uyar).
// Bazıları otoparktaki arabasına yürür ya da arabasını park edip evine gider. Yağmurda renkli şemsiyeler açılır.
// Her parça için tek çoklu çizim (InstancedMesh) kullanılır.
const SHIRTS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292', '#ffffff', '#26a69a', '#5c6bc0', '#ff7043'];
const PANTS = ['#2b3a55', '#1f2937', '#5b4636', '#3b5b8a', '#6b7280', '#8d6e4c', '#37474f', '#1e3a5f'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#f5cfa0'];
const HAIR = ['#2b1d14', '#3b2a1e', '#5a3a22', '#d4a85a', '#141414', '#9e9e9e', '#a0522d', '#e8c27a'];
const UMBRELLAS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#ff7043', '#ffffff'];
// Gerçek insan oranları (boy ~0.155, baş boyun ~1/7'si): bacak kalçadan, kol omuzdan sallanır
const HIP = 0.07; // kalçanın yüksekliği
const SHOULDER = 0.119;
const SKIRTS = ['#c2185b', '#7b1fa2', '#1565c0', '#2e7d32', '#ef6c00', '#37474f', '#ad1457', '#00838f'];
const SHOES = ['#2b2b2b', '#5d4037', '#f5f5f5', '#1a237e', '#3e2723'];

// Kaldırım dışında izlenen yol (kapıdan kaldırıma, kaldırımdan arabaya...)
// hide: 'in' yol binanın kapısından içeride biter (kapıdan geçince görünmez olur, küçülmeden), 'out' içeriden başlar
interface Walk {
  pts: THREE.Vector3[];
  k: number;
  u: number;
  fadeIn: boolean;
  fadeOut: boolean;
  done?: () => void;
  then?: boolean; // bitince kaldırımda yürümeye devam et
  hide?: 'in' | 'out';
}

// Yayanın gideceği bina: önündeki düz yol karesi, yoldan binaya doğru yön ve kaldırımdan kapıdan içeriye giden yol
interface Door {
  road: number;
  toB: number;
  site: number;
  what: string;
  entry: THREE.Vector3[];
}

// Bir binanın kapısına kaldırımdan giden yol: [kaldırımdaki nokta, ..., kapı, kapının arkası (içeri)].
// road: kapının önündeki yol, toB: yoldan binaya doğru yön. Otoparklı binada otoparkın ortasındaki yaya yolundan,
// evde bahçe yolundan kapıya gidilir. Kapısı bilinmeyen yerde (park, simge yapı) kenarın biraz içine.
function entryPath(city: City, site: number, road: number, toB: number): THREE.Vector3[] | null {
  const t = city.tiles[site];
  if (!t) return null;
  const n = t.fp ?? 1;
  const c = tileCenter((site % SIZE) + (n - 1) / 2, Math.floor(site / SIZE) + (n - 1) / 2);
  const W = (x: number, z: number) => siteToWorld(c.x, c.z, FACING_TURNS[t.facing], x, z).setY(WALK_Y);
  const front = (t.facing + 2) % 4 === toB; // kapı bu yola bakıyor
  let pts: THREE.Vector3[] | null = null;
  const s = siteOf(t.kind, t.fp);
  if (s && front) {
    const [dx, dz] = s.door;
    pts = [W(dx, n / 2 - 0.03), W(dx, s.walk), W(dx, dz), W(dx, dz - 0.09)];
  } else if (t.kind === 'res' && t.level >= 1 && front) {
    const models = RES_LEVELS[t.level - 1].models;
    const d = DOORS[models[t.variant % models.length]];
    if (d) pts = [W(d[0], 0.47), W(d[0], d[1] + 0.03), W(d[0], d[1]), W(d[0], d[1] - 0.07)];
  }
  if (!pts) {
    if (s || t.kind === 'res') return null; // kapısı öbür yanda
    const cell = neighbor(road, toB);
    const door = center(cell).setY(WALK_Y).addScaledVector(fwd(toB), -0.34);
    pts = [door, door.clone().addScaledVector(fwd(toB), 0.08)];
  }
  // Kaldırımdaki nokta: kapının hizasında (yol karesinin içinde kalsın)
  const lane = city.tiles[road]?.grade === 2 ? WIDE_WALK : WALK_LANE;
  const side = center(road).setY(WALK_Y).addScaledVector(fwd(toB), lane);
  const axis = fwd((toB + 1) % 4);
  side.addScaledVector(axis, THREE.MathUtils.clamp(pts[0].clone().sub(side).dot(axis), -0.45, 0.45));
  return [side, ...pts];
}

interface Person extends Mover {
  phase: number;
  look: [number, number, number, number, number, number, number]; // gömlek, pantolon, ten, saç, şemsiye, ayakkabı, biçim (1 uzun saç, 2 etek)
  walk?: Walk;
  away?: number; // eve dönmek için kaç saniyedir yer arıyor
  wait?: number; // kendisine yol veren arabanın önünde kaç saniyedir bekliyor
  side: number; // kaldırımın hangi yanında yürüyor: 1 gidiş yönünün sağı, -1 solu
  sideIn: number; // kareye girerken hangi yandaydı (kavşakta karşıya geçince değişir)
  goal?: Door; // gideceği bina
  next?: { tile: number; d: number }; // kavşağa girince yapacağı hareket (ışığa bakmak için önceden seçilir)
  age: number;
}

// Kavşakta dönünce kaldırımın hangi yanında kalır: sağa dönen sağ yanda, sola dönen sol yanda
// (dönüş kendi köşesindeyse köşeden döner, değilse geldiği yolu yaya geçidinden geçer)
const sideAfter = (dIn: number, d: number, side: number) => {
  const turn = (d - dIn + 4) % 4;
  return turn === 1 ? 1 : turn === 3 ? -1 : side;
};

// Yayanın kare içindeki yeri: lanePos gibi, ama kaldırımın iki yanında da yürünür ve kavşakta yan değişebilir
function walkPos(city: City, p: Person, out: THREE.Vector3, t = p.t): number {
  const [x, z] = xz(p.tile);
  const mid = tileCenter(x, z).setY(WALK_Y);
  const { dIn, dOut } = p;
  const lane = (tile: number) => (city.tiles[tile]?.grade === 2 ? WIDE_WALK : WALK_LANE);
  const L = lane(p.tile);
  const sIn = p.sideIn, sOut = p.side;
  if (dOut === (dIn + 2) % 4 && isDeadEnd(city, p.tile)) {
    // Çıkmaz sokağın ucunda dönüş meydanının kenarından dolaşır
    const f = fwd(dIn), r = right(dIn).multiplyScalar(sIn);
    const R = Math.min(0.46, L);
    const at = (u: number, v: THREE.Vector3) => {
      if (u < 0.3) {
        const k = THREE.MathUtils.smoothstep(u / 0.3, 0, 1);
        return v.copy(mid).addScaledVector(f, -0.5 * (1 - k)).addScaledVector(r, L + (R - L) * k);
      }
      if (u < 0.7) {
        const a = ((u - 0.3) / 0.4) * Math.PI;
        return v.copy(mid).addScaledVector(r, R * Math.cos(a)).addScaledVector(f, R * Math.sin(a));
      }
      const k = THREE.MathUtils.smoothstep((u - 0.7) / 0.3, 0, 1);
      return v.copy(mid).addScaledVector(f, -0.5 * k).addScaledVector(r, -(R + (L - R) * k));
    };
    return turnaround(at, t, out);
  }
  const edge = (d: number, s: number) => {
    const nx = x + DIRS[d][0] * s, nz = z + DIRS[d][1] * s;
    return city.isRoad(nx, nz) ? (lane(idx(nx, nz)) + L) / 2 : L;
  };
  const laneIn = edge(dIn, -1) * sIn, laneOut = edge(dOut, 1) * sOut;
  A.copy(mid).addScaledVector(fwd(dIn), -0.5).addScaledVector(right(dIn), laneIn);
  B.copy(mid).addScaledVector(fwd(dOut), 0.5).addScaledVector(right(dOut), laneOut);
  if (dIn === dOut) C.copy(mid).addScaledVector(right(dIn), L * sIn);
  else if (dOut === (dIn + 2) % 4) C.copy(A).add(B).multiplyScalar(0.5); // kavşakta geri dönüş: geldiği yolu karşıya geçer
  else C.copy(mid).addScaledVector(right(dIn), laneIn).addScaledVector(right(dOut), laneOut);
  return bezier2(t, out);
}

// Parçalar: [geometri, renk listesi seçici]
function personParts() {
  const merge = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map(g => g.toNonIndexed()), false)!;
  // Bacak: kalçadan aşağı incelen (uyluk + baldır); ayakkabı ayrı renkte
  const leg = new THREE.CylinderGeometry(0.0068, 0.0047, HIP - 0.004, 7).translate(0, -(HIP - 0.004) / 2, 0);
  const shoe = new THREE.BoxGeometry(0.0095, 0.0055, 0.017).translate(0, -HIP + 0.0028, 0.003);
  // Kol: omuzdan aşağı kol (gömlek rengi), el ayrı (ten rengi)
  const arm = new THREE.CylinderGeometry(0.0049, 0.0041, 0.05, 6).translate(0, -0.025, 0);
  const hand = new THREE.SphereGeometry(0.0047, 6, 5).scale(0.85, 1.2, 0.85).translate(0, -0.054, 0);
  // Gövde: göğüs öne-arkaya basık, yuvarlak omuzlar
  const chest = new THREE.CylinderGeometry(0.0158, 0.0128, 0.046, 10).scale(1, 1, 0.68).translate(0, HIP + 0.019 + 0.023, 0);
  const shoulders = new THREE.CapsuleGeometry(0.0072, 0.02, 3, 8).rotateZ(Math.PI / 2).scale(1, 1, 0.85).translate(0, SHOULDER - 0.001, 0);
  const torso = merge([chest, shoulders]);
  // Kalça (pantolon rengi) ve etek
  const hips = new THREE.CylinderGeometry(0.0128, 0.0122, 0.02, 10).scale(1, 1, 0.72).translate(0, HIP + 0.009, 0);
  const skirt = new THREE.CylinderGeometry(0.0125, 0.0215, 0.038, 12, 1, true).translate(0, HIP - 0.008, 0);
  // Baş ve boyun (ten rengi), kısa saç, uzun saç (omuza dökülen)
  const head = merge([
    new THREE.SphereGeometry(0.0108, 12, 10).scale(0.95, 1.13, 1.02).translate(0, 0.1425, 0),
    new THREE.CylinderGeometry(0.0043, 0.0049, 0.012, 7).translate(0, 0.1285, 0),
    new THREE.SphereGeometry(0.0022, 5, 4).translate(0, 0.1405, 0.0105), // burun
  ]);
  const hair = new THREE.SphereGeometry(0.0117, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 1.08, 1.06).translate(0, 0.1452, -0.0012);
  const hairLong = new THREE.BoxGeometry(0.021, 0.03, 0.009).translate(0, 0.131, -0.0085);
  const canopy = new THREE.ConeGeometry(0.062, 0.028, 10, 1, true).translate(0, 0.215, 0);
  const stick = new THREE.CylinderGeometry(0.0022, 0.0022, 0.09, 4).translate(0, 0.17, 0);
  const umbrella = merge([canopy, stick]);
  return { leg, shoe, arm, hand, torso, hips, skirt, head, hair, hairLong, umbrella };
}

const pickLook = (): Person['look'] => {
  const pick = (list: unknown[]) => Math.floor(Math.random() * list.length);
  const long = Math.random() < 0.42;
  const style = (long ? 1 : 0) | (long && Math.random() < 0.55 ? 2 : 0);
  return [pick(SHIRTS), style & 2 ? pick(SKIRTS) : pick(PANTS), pick(SKINS), pick(HAIR), pick(UMBRELLAS), pick(SHOES), style];
};
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class Walkers {
  readonly root = new THREE.Group();
  private people: Person[] = [];
  spots: Box[] = []; // yayaların yerleri (arabalar bakar)
  cars: () => Box[] = () => [];
  private parts: Record<'torso' | 'hips' | 'skirt' | 'head' | 'hair' | 'hairLong' | 'legL' | 'legR' | 'shoeL' | 'shoeR' | 'armL' | 'armR' | 'handL' | 'handR' | 'umbrella', THREE.InstancedMesh>;
  private recount = 0;
  private time = 0;
  private colorsDirty = true;
  private tmp = new THREE.Object3D();
  private base = new THREE.Matrix4();
  private local = new THREE.Matrix4();
  private out = new THREE.Matrix4();
  // Trafikten: yol bulma, şehirdeki yerler, günün saati
  private router: Router | null = null;
  private places: () => Places = () => ({ work: [], shops: [], cargo: [], fun: [], parks: [], transit: [], depots: [], homes: [] });
  private phase: () => DayPhase = () => 'day';

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
      torso: mesh(g.torso), hips: mesh(g.hips), skirt: mesh(g.skirt, THREE.DoubleSide), head: mesh(g.head), hair: mesh(g.hair), hairLong: mesh(g.hairLong),
      legL: mesh(g.leg), legR: mesh(g.leg), shoeL: mesh(g.shoe), shoeR: mesh(g.shoe),
      armL: mesh(g.arm), armR: mesh(g.arm), handL: mesh(g.hand), handR: mesh(g.hand),
      umbrella: mesh(g.umbrella, THREE.DoubleSide),
    };
  }

  attach(router: Router, places: () => Places, phase: () => DayPhase) {
    this.router = router;
    this.places = places;
    this.phase = phase;
  }

  setCity(city: City) {
    this.city = city;
    this.people = [];
    this.colorsDirty = true;
  }

  private lane = (tile: number) => (this.city.tiles[tile]?.grade === 2 ? WIDE_WALK : WALK_LANE);

  // Belirli bir yolu yürüyen biri (otoparktaki arabasına giden ya da arabasından evine dönen).
  // hide: 'in' yol binanın içinde biter, 'out' binanın içinden başlar (kapıdan geçerken görünür ya da kaybolur)
  addTrip(pts: THREE.Vector3[], fadeIn: boolean, fadeOut: boolean, done?: () => void, hide?: 'in' | 'out') {
    if (this.people.length >= MAX_WALKERS) {
      done?.();
      return;
    }
    this.people.push({ tile: 0, dIn: 0, dOut: 0, t: 0, speed: 0.3, fade: fadeIn ? 0 : 1, phase: Math.random() * 6, look: pickLook(), side: 1, sideIn: 1, age: 0, walk: { pts, k: 0, u: 0, fadeIn, fadeOut, done, hide } });
    this.colorsDirty = true;
  }

  // Bir binanın yayaların girip çıktığı kapısı: önündeki düz yol karesi (kavşak, köşe ve çıkmaz sokak değil) ve
  // kaldırımdan kapıya giden yol. Kapısı belli binada (ev, otoparklı bina) kapının baktığı yol.
  private doorOf(site: number): Door | null {
    const t = this.city.tiles[site];
    if (!t) return null;
    const cells = this.city.cellsOf(site);
    const known = t.kind === 'res' || !!siteOf(t.kind, t.fp);
    const sides = known ? [t.facing] : [t.facing, 0, 1, 2, 3];
    let best: Door | null = null, bestD = Infinity;
    for (const d of sides) {
      for (const c of cells) {
        const r = neighbor(c, d);
        if (!isRoadTile(this.city, r) || cells.includes(r)) continue;
        const dirs = roadDirs(this.city, r);
        if (dirs.length !== 2 || (dirs[0] + 2) % 4 !== dirs[1] || dirs[0] % 2 === d % 2) continue;
        const entry = entryPath(this.city, site, r, (d + 2) % 4);
        if (!entry) continue;
        // Kapıya en yakın yol karesi
        const dist = entry[0].distanceToSquared(entry[1]);
        if (dist < bestD) {
          bestD = dist;
          best = { road: r, toB: (d + 2) % 4, site, what: t.kind, entry };
        }
      }
      if (best) return best;
    }
    return best;
  }

  // Bir yerden yürüyerek gidilebilecek yakın bir bina (en fazla ~10 kare): listeden birkaç aday, en uygunu
  private nearDoor(from: Door, list: number[], tries = 8): Door | null {
    if (!list.length || !this.router) return null;
    const f = this.router.field(from.road);
    let best: Door | null = null, bestD = Infinity;
    for (let k = 0; k < tries; k++) {
      const site = list[Math.floor(Math.random() * list.length)];
      if (site === from.site) continue;
      const d = this.doorOf(site);
      if (!d) continue;
      const dist = f[d.road];
      if (dist < 0 || dist > 12) continue;
      // Çok yakınlar arasından rastgele (hep en yakını değil)
      const score = dist + Math.random() * 4;
      if (score < bestD) {
        bestD = score;
        best = d;
      }
    }
    return best;
  }

  // Yeni yaya: günün saatine göre evinden bir yere ya da bir yerden evine yürür
  private spawn(): Person | null {
    const pl = this.places();
    const P = this.phase();
    const r = Math.random();
    const ids = (list: Place[]) => list.map(p => p.site);
    // [evden çıkıyor mu, gideceği / geldiği yer türleri]
    const [out, kinds]: [boolean, Place[][]] =
      P === 'morning' ? (r < 0.85 ? [true, [pl.work, pl.work, pl.transit, pl.shops]] : [false, [pl.shops, pl.parks]])
      : P === 'day' ? (r < 0.5 ? [true, [pl.shops, pl.parks, pl.fun, pl.transit]] : [false, [pl.shops, pl.parks, pl.fun, pl.transit]])
      : P === 'evening' ? (r < 0.7 ? [false, [pl.work, pl.work, pl.shops, pl.transit]] : [true, [pl.parks, pl.fun, pl.shops]])
      : r < 0.8 ? [false, [pl.fun, pl.shops, pl.work]] : [true, [pl.fun, pl.parks]];
    const lists = kinds.filter(l => l.length);
    for (let attempt = 0; attempt < 4 && lists.length && pl.homes.length; attempt++) {
      const list = lists[Math.floor(Math.random() * lists.length)];
      if (out) {
        const home = this.doorOf(pl.homes[Math.floor(Math.random() * pl.homes.length)]);
        const to = home && this.nearDoor(home, ids(list));
        if (home && to) return this.leaveDoor(home, to);
      } else {
        const place = this.doorOf(rnd(list).site);
        const to = place && this.nearDoor(place, pl.homes);
        if (place && to) return this.leaveDoor(place, to);
      }
    }
    // Yakında gidilecek yer yoksa (yeni şehir: dükkan, park yok) evinden çıkıp biraz yürür, sonra bir eve girer
    for (let attempt = 0; attempt < 3 && pl.homes.length; attempt++) {
      const home = this.doorOf(pl.homes[Math.floor(Math.random() * pl.homes.length)]);
      if (home) return this.leaveDoor(home, null);
    }
    return null;
  }

  // Kapıdan çıkıp kaldırıma yürüyen biri; kaldırımda gideceği yöne doğru döner (gideceği yer yoksa rastgele)
  private leaveDoor(from: Door, goal: Door | null): Person {
    const road = from.road;
    const dirs = roadDirs(this.city, road);
    let dir = rnd(dirs);
    if (goal) {
      const f = this.router!.field(goal.road);
      const dist = (d: number) => {
        const n = neighbor(road, d);
        return n < 0 || f[n] < 0 ? Infinity : f[n];
      };
      dir = dist(dirs[0]) <= dist(dirs[1]) ? dirs[0] : dirs[1];
    }
    // Bina gidiş yönünün sağında mı solunda mı
    const side = from.toB === (dir + 1) % 4 ? 1 : -1;
    const walkway = center(road).setY(WALK_Y).addScaledVector(fwd(from.toB), this.lane(road));
    // Binanın içinden kapıdan çıkar (küçükten büyümez), kaldırıma yürür
    return {
      tile: road, dIn: dir, dOut: dir, t: 0.5, speed: 0.2 + Math.random() * 0.14, fade: 1, phase: Math.random() * 6, look: pickLook(),
      side, sideIn: side, goal: goal ?? undefined, age: goal ? 0 : 80 - Math.random() * 30,
      walk: { pts: [...[...from.entry].reverse(), walkway], k: 0, u: 0, fadeIn: false, fadeOut: false, then: true, hide: 'out' },
    };
  }

  // Kavşağa ya da yeni kareye girince hangi yöne: gideceği yere en kısa yoldan (kavşakta geri dönmek de olur:
  // geldiği yolu karşıya geçer); gideceği yer yoksa rastgele
  private pickDir(p: Person, tile: number, dIn: number) {
    const dirs = roadDirs(this.city, tile);
    const back = (dIn + 2) % 4;
    const junction = dirs.length >= 3;
    const options = dirs.filter(d => d !== back || junction);
    if (!options.length) return back;
    if (!p.goal || !this.router) {
      const fwdOnly = options.filter(d => d !== back);
      return rnd(fwdOnly.length ? fwdOnly : options);
    }
    const f = this.router.field(p.goal.road);
    let best = -1, bestD = Infinity;
    for (const d of options) {
      const n = neighbor(tile, d);
      const dist = n < 0 || f[n] < 0 ? Infinity : f[n] + (d === back ? 0.6 : 0) + Math.random() * 0.3;
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    if (best < 0) {
      // Gideceği yere yol kalmadı: dolaşıp evine döner
      p.goal = undefined;
      p.out = true;
      p.away = 0;
      return rnd(options);
    }
    return best;
  }

  // Kavşağa girmeden önce ışığa bak: karşıya geçecekse (düz giderken yan yolu, dönerken geldiği yolu) o yolun
  // arabalarına kırmızı yanana kadar bekler; kendi köşesinden dönerken beklemez
  private lightLimit(p: Person) {
    if (p.t > 0.7) return Infinity;
    const j = neighbor(p.tile, p.dOut);
    if (!isJunction(this.city, j)) return Infinity;
    if (p.next?.tile !== j) p.next = { tile: j, d: this.pickDir(p, j, p.dOut) };
    const turn = (p.next.d - p.dOut + 4) % 4;
    if ((turn === 1 && p.side > 0) || (turn === 3 && p.side < 0)) return Infinity; // köşeden döner
    let dir: number;
    if (turn === 0) {
      // Düz: yanındaki yolu geçer (o yanda yol yoksa geçecek bir şey yok)
      const across = neighbor(j, p.side > 0 ? (p.dOut + 1) % 4 : (p.dOut + 3) % 4);
      if (!isRoadTile(this.city, across)) return Infinity;
      dir = p.dOut;
    } else dir = (p.dOut + 1) % 4; // geldiği yolu geçer: dik yön yeşilken
    return isGreen(j, dir) ? Infinity : 0.7;
  }

  // Gideceği binanın önüne geldi: kapı bu yandaysa kapıdan girer; karşı yandaysa sokağı geçer
  // (bariyerli caddede geçemez, kavşağa kadar gidip geri döner)
  private arrive(p: Person): boolean {
    const g = p.goal!;
    const mine = p.side > 0 ? (p.dIn + 1) % 4 : (p.dIn + 3) % 4;
    const pos = new THREE.Vector3();
    walkPos(this.city, p, pos);
    if (mine === g.toB) {
      p.walk = { pts: [pos, ...g.entry], k: 0, u: 0, fadeIn: false, fadeOut: false, hide: 'in' };
      return true;
    }
    const t = this.city.tiles[p.tile];
    const nearJunction = roadDirs(this.city, p.tile).some(d => isJunction(this.city, neighbor(p.tile, d)));
    if (t?.grade === 2 && !nearJunction) return false;
    // Aynı hizada karşı kaldırıma geç, sonra kapıya
    const mid = center(p.tile).setY(WALK_Y);
    const a = pos.clone().sub(mid).dot(fwd(p.dIn));
    const across = mid.clone().addScaledVector(fwd(p.dIn), a).addScaledVector(fwd(g.toB), this.lane(p.tile));
    p.walk = { pts: [pos, across, ...g.entry], k: 0, u: 0, fadeIn: false, fadeOut: false, hide: 'in' };
    return true;
  }

  // Eve dönen (gidecek yeri kalmamış) biri: kaldırımda yanındaki evin ya da dükkânın kapısından girer
  private goHome(p: Person) {
    if (p.dIn !== p.dOut || p.t < 0.4 || p.t > 0.6) return false;
    const toB = p.side > 0 ? (p.dIn + 1) % 4 : (p.dIn + 3) % 4;
    const home = neighbor(p.tile, toB);
    const h = home >= 0 ? this.city.tiles[home] : null;
    if (!h || (h.kind !== 'res' && !SHOP_KINDS.has(h.kind)) || (h.kind === 'res' && h.level < 1)) return false;
    const entry = entryPath(this.city, this.city.anchorOf(home), p.tile, toB);
    if (!entry) return false;
    const pos = new THREE.Vector3();
    walkPos(this.city, p, pos);
    p.walk = { pts: [pos, ...entry], k: 0, u: 0, fadeIn: false, fadeOut: false, hide: 'in' };
    return true;
  }

  private paint() {
    const c = new THREE.Color();
    const p = this.parts;
    this.people.forEach((person, n) => {
      const [shirt, pants, skin, hair, umb, shoe, style] = person.look;
      const skirt = (style & 2) !== 0;
      p.torso.setColorAt(n, c.set(SHIRTS[shirt]));
      p.armL.setColorAt(n, c);
      p.armR.setColorAt(n, c);
      // Etekli olanın bacakları ten rengi, kalça ve etek etek renginde
      p.hips.setColorAt(n, c.set(skirt ? SKIRTS[pants] : PANTS[pants]));
      p.skirt.setColorAt(n, c);
      p.legL.setColorAt(n, c.set(skirt ? SKINS[skin] : PANTS[pants]));
      p.legR.setColorAt(n, c);
      p.head.setColorAt(n, c.set(SKINS[skin]));
      p.handL.setColorAt(n, c);
      p.handR.setColorAt(n, c);
      p.hair.setColorAt(n, c.set(HAIR[hair]));
      p.hairLong.setColorAt(n, c);
      p.shoeL.setColorAt(n, c.set(SHOES[shoe]));
      p.shoeR.setColorAt(n, c);
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
    // Kapıdan girip çıkan küçülüp büyümez: kapının arkasında kalınca bina onu gizler
    if (w.hide) p.fade = 1;
    else {
      if (w.fadeIn && w.k === 0) p.fade = Math.min(1, Math.max(p.fade, w.u * 1.5));
      if (w.fadeOut && last) p.fade = Math.min(p.fade, Math.max(0, (1 - w.u) * 1.5));
    }
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
      this.recount = 0.4;
      const roads = this.city.tiles.filter(t => t?.kind === 'road').length;
      const wanted = Math.round(Math.min(MAX_WALKERS - 10, roads, Math.floor(this.city.population / 8)) * WALK_SHARE[this.phase()]);
      const onFoot = this.people.filter(p => !p.out && (!p.walk || p.walk.then)).length;
      if (onFoot < wanted) {
        const p = this.spawn();
        if (p) {
          this.people.push(p);
          this.colorsDirty = true;
        }
      }
    }
    const before = this.people.length;
    // Kaldırımda aynı yönde, aynı yanda yürüyenler (önündekinin içinden geçmesin)
    const lanes = new Map<string, number[]>();
    for (const p of this.people) {
      if (p.walk) continue;
      const k = `${p.tile}|${p.dIn}|${p.sideIn}`;
      (lanes.get(k) ?? lanes.set(k, []).get(k)!).push(p.t);
    }
    const cars = this.cars();
    const pos = new THREE.Vector3();
    // Önünde araba varsa bekle.
    // Kendisine yol veren (yayayı bekleyen) araba engel sayılmaz; yaya ancak gerçekten arabanın içinden geçecekse durur,
    // o da en fazla 3 saniye (yoksa araba yayayı, yaya arabayı bekler, kavşak kilitlenir ve arkada kuyruk büyür)
    const carAhead = (p: Person, x: number, z: number, h: number) => {
      const fx = Math.sin(h), fz = Math.cos(h);
      let yielding = false;
      for (const c of cars) {
        const rx = c.x - x, rz = c.z - z;
        if (rx * rx + rz * rz > 0.36) continue; // uzaktaki araba
        const ahead = rx * fx + rz * fz;
        if (ahead < -0.02) continue;
        const lat = Math.abs(rx * fz - rz * fx);
        const dh = c.h - h;
        const along = Math.abs(Math.cos(dh)) * c.len + Math.abs(Math.sin(dh)) * c.wid;
        const side = Math.abs(Math.sin(dh)) * c.len + Math.abs(Math.cos(dh)) * c.wid;
        // Alt geçitteki araba yukarıdaki yayanın yolunu kesmez
        if ((c.u ?? 0) > 0.5) continue;
        if (c.ped) {
          if (ahead < along + 0.02 && lat < side) yielding = true;
        } else if (ahead < along + 0.06 && lat < side + 0.03) return true;
      }
      // 3 saniye bekledikten sonra yürür ve araba önünden çekilene kadar bir daha durmaz (eskiden sayaç sıfırlanıp
      // yeniden 3 saniye bekliyordu: kavşakta dönen otobüs ile önündeki yayalar birbirini sonsuza kadar bekliyordu)
      if (yielding) {
        p.wait = (p.wait ?? 0) + dt;
        return p.wait < 3;
      }
      p.wait = 0;
      return false;
    };
    // Yeni kareye girince yön ve kaldırımın yanı
    const choose = (m: Mover) => {
      const p = m as Person;
      p.sideIn = p.side;
      let d: number;
      if (p.next?.tile === p.tile) d = p.next.d;
      else d = this.pickDir(p, p.tile, p.dIn);
      p.next = undefined;
      if (isJunction(this.city, p.tile)) p.side = sideAfter(p.dIn, d, p.side);
      return d;
    };
    this.people = this.people.filter(p => {
      p.age += dt;
      if (p.walk) {
        const w = p.walk;
        const a = w.pts[w.k], b = w.pts[w.k + 1];
        pos.lerpVectors(a, b, Math.min(1, w.u));
        if (carAhead(p, pos.x, pos.z, Math.atan2(b.x - a.x, b.z - a.z))) return true;
        return this.stepWalk(p, dt);
      }
      // Gideceği binanın önüne geldi
      if (p.goal && p.tile === p.goal.road && p.dIn === p.dOut && p.t >= 0.42 && p.t <= 0.62 && this.arrive(p)) return true;
      // Çok uzun yürüdü (yolu uzadı) ya da gidecek yeri yoktu (gezinti bitti): yanındaki bir eve girer ya da kaybolur
      if (!p.out && p.age > 110) {
        p.goal = undefined;
        p.out = true;
        p.away = 0;
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
      let limit = this.lightLimit(p);
      for (const t of lanes.get(`${p.tile}|${p.dIn}|${p.sideIn}`) ?? []) if (t > p.t + 1e-4) limit = Math.min(limit, t - 0.08);
      const h = walkPos(this.city, p, pos);
      if (carAhead(p, pos.x, pos.z, h)) limit = p.t;
      // Kavşakta karşıdan karşıya geçerken biraz hızlanır (arabaları uzun bekletmesin)
      const hurry = isJunction(this.city, p.tile) ? 1.6 : 1;
      return advance(this.city, p, dt * p.speed * hurry, false, Math.max(p.t, limit), choose);
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
        this.tmp.rotation.y = walkPos(this.city, person, this.tmp.position);
      }
      const step = Math.sin(this.time * 9 + person.phase);
      this.tmp.position.y += Math.abs(step) * 0.005; // adım atarken hafifçe yükselir
      this.tmp.scale.setScalar(THREE.MathUtils.smoothstep(person.fade, 0, 1));
      this.tmp.updateMatrix();
      if (person.fade > 0.3) this.spots.push({ x: this.tmp.position.x, z: this.tmp.position.z, h: this.tmp.rotation.y, len: 0.022, wid: 0.025, id: -1 });
      this.base.copy(this.tmp.matrix);
      for (const m of [p.torso, p.hips, p.head, p.hair, p.umbrella]) m.setMatrixAt(n, this.base);
      const style = person.look[6];
      p.hairLong.setMatrixAt(n, style & 1 ? this.base : HIDDEN);
      p.skirt.setMatrixAt(n, style & 2 ? this.base : HIDDEN);
      const sw = step * 0.5;
      put(p.legL, n, -0.0068, HIP, sw);
      put(p.shoeL, n, -0.0068, HIP, sw);
      put(p.legR, n, 0.0068, HIP, -sw);
      put(p.shoeR, n, 0.0068, HIP, -sw);
      // Kollar bacakların tersine sallanır; şemsiyeyi tutan kol öne kalkar
      const armR = rain > 0.25 ? -1.2 : sw * 0.9;
      put(p.armL, n, -0.0205, SHOULDER, -sw * 0.9);
      put(p.handL, n, -0.0205, SHOULDER, -sw * 0.9);
      put(p.armR, n, 0.0205, SHOULDER, armR);
      put(p.handR, n, 0.0205, SHOULDER, armR);
    });
    for (const [name, m] of Object.entries(p)) {
      m.count = name === 'umbrella' && rain <= 0.25 ? 0 : this.people.length;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}
