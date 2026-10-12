import {
  SIZE, START_MONEY, ENTRANCE_Z, ENTRANCE_LEN, COST, RES_LEVELS, COM_LEVELS, RES_BASE_MAX, PARK_RADIUS,
  SHOP_RADIUS, POP_PER_COM_LEVEL, JOBS_PER_PERSON, BUILD_CHANCE, GROW_CHANCE, PARK_MODELS, TAX_PER_PERSON,
  TAX_PER_JOB, UTILITIES, SERVICES, SERVICE_KINDS, INDUSTRY, INDUSTRY_KINDS, FACTORY_SLOTS, STORE_QUEUE, MAKER_LEVELS, SHOPS,
  BASE_STORAGE, DEPOT_STORAGE, MATERIALS, MAT_IDS, UPGRADE_COST, XP, LEVEL_XP, LEVEL_REWARD, UNLOCK,
  HAPPY, POLLUTION_RADIUS, FIRE, CRIME, QUAKE, DECOR, DECOR_KINDS, DECOR_MAX, FOOTPRINT,
  PLOT, PLOTS, START_PLOT_MIN, START_PLOT_MAX, OLD_SIZE, LAND, RIVER, BRIDGE_COST, LUXURY_DECOR, ORDERS, NEEDS_WATER, NEEDS_SEA, SAND_ROWS, ROAD_GRADES, ROAD_TOOLS, TRAFFIC,
  ROWS, PLOT_ROWS, START_PZ_MIN, START_PZ_MAX, RIVER_ROWS, COAST_ROW, ISLAND, SEA_BRIDGE,
  type BuildTool, type UtilKind, type ServiceKind, type IndustryKind, type DecorKind, type MatId,
} from './config';
import { emptyStats, newQuest, questDone, type CityStats, type Quest } from './quests';

// 'part': büyük bir binanın ana kare dışındaki kareleri (variant = ana karenin numarası)
export type Kind = 'road' | 'rail' | 'res' | 'com' | 'park' | 'hall' | 'part' | UtilKind | ServiceKind | IndustryKind | DecorKind;
export interface Tile {
  kind: Kind;
  level: number; // bölgelerde 0 = boş arsa, 1+ = bina seviyesi
  facing: number; // binanın kapısının baktığı yön
  variant: number; // rastgele sayı: model, renk ve park çeşidi bundan seçilir
  locked?: boolean;
  fire?: number; // kaç gündür yanıyor
  damaged?: boolean; // depremde hasar gördü
  fp?: number; // büyük binalarda kenar uzunluğu (2 = 2x2 kare)
  grade?: number; // yollarda: 1 = bulvar, 2 = cadde (çift şerit)
}

// Ekranda gösterilecek olaylar (yangın, hırsızlık, deprem...)
export type CityEvent =
  | { type: 'fire' | 'fireOut' | 'collapse'; i: number }
  | { type: 'crime'; amount: number }
  | { type: 'quake'; tiles: number[] };

// Fabrikada ya da hırdavatçıda üretilen bir malzeme; end = bitiş zamanı (Date.now() cinsinden)
export interface Job {
  mat: MatId;
  end: number;
}

// Komşu şehrin siparişi: until = 0 ise gönderilebilir, değilse gemi yolda (o zamana kadar)
export interface Order {
  from: string;
  items: Partial<Record<MatId, number>>;
  money: number;
  xp: number;
  until: number;
}

// Yönler: 0 kuzey (-z), 1 doğu (+x), 2 güney (+z), 3 batı (-x)
export const DIRS: readonly [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export const idx = (x: number, z: number) => z * SIZE + x;
export const inBounds = (x: number, z: number) => x >= 0 && z >= 0 && x < SIZE && z < ROWS;
export const isZone = (k: Kind | undefined): k is 'res' | 'com' => k === 'res' || k === 'com';
export const isUtility = (k: Kind | string | undefined): k is UtilKind => !!k && k in UTILITIES;
export const isService = (k: Kind | string | undefined): k is ServiceKind => !!k && k in SERVICES;
export const isIndustry = (k: Kind | string | undefined): k is IndustryKind => !!k && k in INDUSTRY;
export const isDecor = (k: Kind | string | undefined): k is DecorKind => !!k && k in DECOR;
const KINDS: string[] = ['road', 'rail', 'res', 'com', 'park', 'hall', 'part', ...Object.keys(UTILITIES), ...SERVICE_KINDS, ...INDUSTRY_KINDS, ...DECOR_KINDS];

// Daire şeklinde bir alanın kareleri (hizmet ve simge yapılar için); n = binanın kenar uzunluğu
export function areaAround(i: number, r: number, n = 1): number[] {
  const x0 = (i % SIZE) + (n - 1) / 2, z0 = Math.floor(i / SIZE) + (n - 1) / 2;
  const out: number[] = [];
  for (let z = Math.ceil(z0 - r); z <= z0 + r; z++) {
    for (let x = Math.ceil(x0 - r); x <= x0 + r; x++) {
      if (inBounds(x, z) && (x - x0) ** 2 + (z - z0) ** 2 <= r * r + r) out.push(idx(x, z));
    }
  }
  return out;
}

// Bir hizmet binasının kapsadığı kareler (daire şeklinde)
export function serviceArea(i: number, kind: ServiceKind, n = 1): number[] {
  return areaAround(i, SERVICES[kind].radius, n);
}

export const sizeOf = (tool: BuildTool | Kind) => FOOTPRINT[tool as BuildTool] ?? 1;

// Ada: ortası elipsin içinde kalan kareler
export function isIslandXZ(x: number, z: number) {
  const dx = (x + 0.5 - ISLAND.cx) / ISLAND.rx, dz = (z + 0.5 - ISLAND.cz) / ISLAND.rz;
  return dx * dx + dz * dz <= 1;
}
// Deniz: ana karanın kumsalından kuzeye kadar her yer (ada hariç). Kumsal: ana karanın ilk iki sırası ve adanın kıyısı.
export const isSeaXZ = (x: number, z: number) => z < COAST_ROW && !isIslandXZ(x, z);
export function isSandXZ(x: number, z: number) {
  if (z >= COAST_ROW && z < COAST_ROW + SAND_ROWS) return true;
  if (!isIslandXZ(x, z)) return false;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!isIslandXZ(x + dx, z + dz)) return true;
  return false;
}
export const isSea = (i: number) => isSeaXZ(i % SIZE, Math.floor(i / SIZE));
// Nehir kareleri: doğuda iki sütun (denize dökülür), güneyde iki satır (köşede birleşir)
export function isRiverXZ(x: number, z: number) {
  const [a, b] = RIVER;
  const [ra, rb] = RIVER_ROWS;
  return z >= COAST_ROW && (((x === a || x === b) && z <= rb) || ((z === ra || z === rb) && x <= b));
}
export const isWaterXZ = (x: number, z: number) => isSeaXZ(x, z) || isRiverXZ(x, z);
export const isWater = (i: number) => isWaterXZ(i % SIZE, Math.floor(i / SIZE));

// Sol üst köşesi (x, z) olan n x n alanın kareleri (harita dışına taşarsa null)
export function block(x: number, z: number, n: number): number[] | null {
  if (!inBounds(x, z) || !inBounds(x + n - 1, z + n - 1)) return null;
  const out: number[] = [];
  for (let dz = 0; dz < n; dz++) for (let dx = 0; dx < n; dx++) out.push(idx(x + dx, z + dz));
  return out;
}

const levelInfo = (t: Tile) => (t.kind === 'res' ? RES_LEVELS : COM_LEVELS)[t.level - 1];
const emptyStorage = () => Object.fromEntries(MAT_IDS.map(m => [m, 0])) as Record<MatId, number>;

// [kare, tür, seviye, yön, çeşit, yangın günü?, hasarlı?, kenar?, yol çeşidi?]
type TileRow = [number, Kind, number, number, number, number?, number?, number?, number?];
// Yol aracının yaptığı yol çeşidi (bulvar 1, cadde 2); yol değilse -1
export const gradeOf = (tool: BuildTool) => ROAD_TOOLS.indexOf(tool);
export interface SaveData {
  v: 5;
  sz: number; // harita genişliği
  rows?: number; // harita boyu (yoksa eski kare harita: sz x sz)
  rg?: number; // yol çeşitlerinin sırası (yoksa eski: 1 cadde, 2 bulvar; ikisi de artık bulvar)
  own: number[]; // sahip olunan arazi parçaları
  money: number;
  day: number;
  xp: number;
  st: Partial<Record<MatId, number>>;
  t: TileRow[];
  j: [number, [MatId, number][]][];
  tr: number; // belediyede bekleyen vergi
  ss: CityStats;
  q: Quest[];
  o?: Order[]; // komşu şehir siparişleri
}
// Eski kayıtlar: v1'de 'house' vardı, v2'de malzeme ve XP yoktu, v3'te belediye ve görev yoktu
interface OldSaveData {
  v: 1 | 2 | 3 | 4;
  tr?: number;
  ss?: CityStats;
  q?: Quest[];
  money: number;
  day: number;
  xp?: number;
  st?: Partial<Record<MatId, number>>;
  t: [number, string, number, number, number][];
  j?: [number, [MatId, number][]][];
}

export interface Service {
  power: { supply: number; demand: number };
  water: { supply: number; demand: number };
}

export class City {
  tiles: (Tile | null)[] = new Array(SIZE * ROWS).fill(null);
  money = START_MONEY;
  day = 1;
  xp = 0;
  storage = emptyStorage();
  jobs = new Map<number, Job[]>(); // fabrika ve hırdavatçıların üretimleri
  levelUps: number[] = []; // yeni atlanan seviyeler (ekranda kutlamak için)
  events: CityEvent[] = [];
  treasury = 0; // belediyede toplanmayı bekleyen vergi
  stats: CityStats = emptyStats();
  quests: Quest[] = [];
  happy = new Float32Array(SIZE * ROWS); // her evin mutluluğu (0..1)
  traffic = new Float32Array(SIZE * ROWS); // her yol karesinden geçen araba
  transit = new Float32Array(SIZE * ROWS); // her karede toplu taşımaya binenlerin payı
  decorBonus = new Float32Array(SIZE * ROWS); // simge yapılardan gelen mutluluk
  owned = new Uint8Array(PLOTS * PLOT_ROWS); // hangi arazi parçaları bizim
  orders: Order[] = []; // limandaki komşu şehir siparişleri
  lastShipped = 0; // son geminin kalkış zamanı (sadece görüntü için)
  seaRefund = 0; // eski kayıtta denize kalan binaların geri ödenen parası
  tradeRefund = 0; // kaldırılan ticaret merkezlerinin geri ödenen parası
  private reach = new Set<number>(); // girişe bağlı yol kareleri
  // Elektrik ya da suyu eksik binalar ve eksik olan şey
  lacking = new Map<number, { power: boolean; water: boolean }>();
  service: Service = { power: { supply: 0, demand: 0 }, water: { supply: 0, demand: 0 } };
  // Her kare için hangi hizmetlerin kapsadığı (bit maskesi, SERVICE_KINDS sırasıyla)
  private covered = new Uint8Array(SIZE * ROWS);

  constructor() {
    for (let pz = START_PZ_MIN; pz <= START_PZ_MAX; pz++) {
      for (let px = START_PLOT_MIN; px <= START_PLOT_MAX; px++) this.owned[pz * PLOTS + px] = 1;
    }
    for (let x = 0; x < ENTRANCE_LEN; x++) {
      this.tiles[idx(x, ENTRANCE_Z)] = { kind: 'road', level: 0, facing: 0, variant: 0, locked: true };
    }
    this.placeHall();
    this.refresh();
    this.fillQuests();
  }

  // Belediye binası: şehir girişinin yanına (doluysa yola bağlı ilk boş kareye) kurulur, yıkılamaz
  private placeHall() {
    if (this.tiles.some(t => t?.kind === 'hall')) return;
    this.updateReach();
    const e = ENTRANCE_LEN;
    const near = [idx(e - 2, ENTRANCE_Z - 1), idx(e - 2, ENTRANCE_Z + 1), idx(e - 1, ENTRANCE_Z - 1), idx(e - 1, ENTRANCE_Z + 1), idx(e - 3, ENTRANCE_Z - 1)];
    const free = (i: number) => !this.tiles[i] && this.isConnected(i) && this.isOwned(i);
    const spot = near.find(free) ?? this.tiles.findIndex((_, i) => free(i));
    if (spot < 0) return;
    this.tiles[spot] = { kind: 'hall', level: 0, facing: this.facingFor(spot), variant: 0, locked: true };
  }

  // --- Arazi ---

  plotOf(i: number) {
    return Math.floor(Math.floor(i / SIZE) / PLOT) * PLOTS + Math.floor((i % SIZE) / PLOT);
  }

  isOwned(i: number) {
    return this.owned[this.plotOf(i)] === 1;
  }

  // Bir sonraki arazi parçasının fiyatı
  get landPrice() {
    const start = (START_PLOT_MAX - START_PLOT_MIN + 1) ** 2;
    const bought = this.owned.reduce((s, v) => s + v, 0) - start;
    return LAND.price + LAND.step * bought;
  }

  canBuyPlot(p: number): string | null {
    if (this.owned[p]) return 'Bu arazi zaten senin';
    if (this.level < LAND.level) return `Arazi almak için şehir seviyesi ${LAND.level} lazım`;
    const px = p % PLOTS, pz = Math.floor(p / PLOTS);
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
      const x = px + dx, z = pz + dz;
      return x >= 0 && z >= 0 && x < PLOTS && z < PLOT_ROWS && this.owned[z * PLOTS + x] === 1;
    });
    if (!next) return 'Önce yanındaki araziyi satın al';
    if (this.money < this.landPrice) return 'Yeterli para yok';
    return null;
  }

  buyPlot(p: number): string | null {
    const err = this.canBuyPlot(p);
    if (err) return err;
    this.money -= this.landPrice;
    this.owned[p] = 1;
    return null;
  }

  get hall() {
    const i = this.tiles.findIndex(t => t?.kind === 'hall');
    return i < 0 ? null : i;
  }

  // --- Görevler ---

  private fillQuests() {
    while (this.quests.length < 3) this.quests.push(newQuest(this, this.quests));
  }

  claimQuest(n: number): boolean {
    const q = this.quests[n];
    if (!q || !questDone(this, q)) return false;
    this.money += q.money;
    this.addXp(q.xp);
    this.quests.splice(n, 1);
    this.fillQuests();
    return true;
  }

  get(x: number, z: number) {
    return inBounds(x, z) ? this.tiles[idx(x, z)] : null;
  }

  // Bir karenin yanındaki en iyi yolun çeşidi (0 yol, 1 cadde, 2 bulvar)
  bestRoad(i: number) {
    const x = i % SIZE, z = Math.floor(i / SIZE);
    let g = 0;
    for (const [dx, dz] of DIRS) {
      const t = this.get(x + dx, z + dz);
      if (t?.kind === 'road') g = Math.max(g, t.grade ?? 0);
    }
    return g;
  }

  // Bir yolun düz devamı: aynı doğrultudaki komşu yol kareleri (kavşak ve dönemeçlerde durur)
  streetOf(i: number): number[] {
    const x0 = i % SIZE, z0 = Math.floor(i / SIZE);
    const m = this.roadMask(x0, z0);
    const alongX = (m & 0b1010) !== 0 && (m & 0b0101) === 0;
    const alongZ = (m & 0b0101) !== 0 && (m & 0b1010) === 0;
    if (!alongX && !alongZ) {
      // Kavşağa dokunuldu: kavşak ve ona bağlı bütün sokaklar
      const all = new Set([i]);
      for (const [dx, dz] of DIRS) {
        if (!this.isRoad(x0 + dx, z0 + dz)) continue;
        const n = idx(x0 + dx, z0 + dz);
        const nm = this.roadMask(x0 + dx, z0 + dz);
        // Sadece düz sokaklara bakılır (yan yana iki köşe birbirini sonsuza kadar çağırmasın)
        const straight = ((nm & 0b1010) !== 0) !== ((nm & 0b0101) !== 0);
        if (straight) for (const c of this.streetOf(n)) all.add(c);
      }
      return [...all];
    }
    const out = [i];
    for (const s of [-1, 1]) {
      for (let k = 1; k < SIZE; k++) {
        const x = alongX ? x0 + s * k : x0, z = alongZ ? z0 + s * k : z0;
        if (!this.isRoad(x, z)) break;
        const mk = this.roadMask(x, z);
        const straight = alongX ? (mk & 0b0101) === 0 : (mk & 0b1010) === 0;
        // Sokağın ucundaki kavşak ya da dönemeç de yükselir (köşeler sokakla aynı görünsün)
        out.push(idx(x, z));
        if (!straight) break;
      }
    }
    return out;
  }

  // Bir sokağı (düz devamıyla) bir üst çeşide yükselt
  upgradeStreet(i: number): { done: number[]; error: string | null } {
    const t = this.tiles[i];
    if (t?.kind !== 'road') return { done: [], error: 'Burada yol yok' };
    const next = Math.min(2, (t.grade ?? 0) + 1);
    return this.apply(ROAD_GRADES[next].tool, this.streetOf(i).filter(c => (this.tiles[c]?.grade ?? 0) < next));
  }

  isRoad(x: number, z: number) {
    return this.get(x, z)?.kind === 'road';
  }

  // Tren yolu ya da hemzemin geçit (rayın kestiği yol: level 1)
  isRail(x: number, z: number) {
    const t = this.get(x, z);
    return t?.kind === 'rail' || (t?.kind === 'road' && t.level === 1);
  }

  railMask(x: number, z: number) {
    let m = 0;
    DIRS.forEach(([dx, dz], d) => {
      if (this.isRail(x + dx, z + dz)) m |= 1 << d;
    });
    return m;
  }

  // Komşu yolların bit maskesi (kuzey 1, doğu 2, güney 4, batı 8)
  roadMask(x: number, z: number) {
    let m = 0;
    DIRS.forEach(([dx, dz], d) => {
      if (this.isRoad(x + dx, z + dz)) m |= 1 << d;
    });
    return m;
  }

  // --- Şehir seviyesi ve XP ---

  get level() {
    let l = 1;
    while (l < LEVEL_XP.length && this.xp >= LEVEL_XP[l]) l++;
    return l;
  }

  // Bu seviyedeki ilerleme (XP çubuğu için)
  get levelProgress() {
    const l = this.level;
    const from = LEVEL_XP[l - 1];
    const to = LEVEL_XP[l] ?? from;
    return { level: l, xp: this.xp - from, need: to - from, max: l >= LEVEL_XP.length };
  }

  addXp(n: number) {
    const before = this.level;
    this.xp += n;
    for (let l = before + 1; l <= this.level; l++) {
      this.money += LEVEL_REWARD * l;
      this.levelUps.push(l);
    }
  }

  unlockLevel(tool: BuildTool | MatId) {
    return tool in MATERIALS ? MATERIALS[tool as MatId].unlock : (UNLOCK[tool as BuildTool] ?? 1);
  }

  isUnlocked(tool: BuildTool | MatId) {
    return this.level >= this.unlockLevel(tool);
  }

  // --- Bağlantı, elektrik/su ve hizmetler ---

  // Yollar ya da binalar değişince bağlantıyı ve elektrik/su dağıtımını yeniden hesapla
  refresh() {
    this.updateReach();
    this.updateService();
    this.updateCoverage();
    this.updateTraffic();
    this.updateHappiness();
  }

  // --- Trafik ---

  // Her ev, arabalarını en kısa yoldan şehir girişine gönderir; geçtiği yolların yükü artar
  private updateTraffic() {
    const n = SIZE * ROWS;
    this.traffic.fill(0);
    const start = idx(0, ENTRANCE_Z);
    if (this.tiles[start]?.kind !== 'road') return;
    const parent = new Int32Array(n).fill(-2);
    const order = new Int32Array(n).fill(-1);
    parent[start] = -1;
    const queue = [start];
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      order[c] = q;
      const x = c % SIZE, z = Math.floor(c / SIZE);
      for (const [dx, dz] of DIRS) {
        if (!inBounds(x + dx, z + dz)) continue;
        const nb = idx(x + dx, z + dz);
        if (parent[nb] !== -2 || this.tiles[nb]?.kind !== 'road') continue;
        parent[nb] = c;
        queue.push(nb);
      }
    }
    // Toplu taşıma yakınındaki evlerden daha az araba çıkar
    const transit = this.transit;
    transit.fill(0);
    this.tiles.forEach((t, i) => {
      const share = t ? TRAFFIC.transit[t.kind] : 0;
      if (!share || !isDecor(t!.kind)) return;
      for (const c of areaAround(i, DECOR[t!.kind as DecorKind].radius, t!.fp ?? 1)) transit[c] = Math.min(TRAFFIC.maxTransit, transit[c] + share);
    });
    this.tiles.forEach((t, i) => {
      if (t?.kind !== 'res' || t.level === 0) return;
      const cars = RES_LEVELS[t.level - 1].pop * TRAFFIC.carsPerPerson * (1 - transit[i]);
      const x = i % SIZE, z = Math.floor(i / SIZE);
      let best = -1;
      for (const [dx, dz] of DIRS) {
        if (!inBounds(x + dx, z + dz)) continue;
        const nb = idx(x + dx, z + dz);
        if (order[nb] >= 0 && (best < 0 || order[nb] < order[best])) best = nb;
      }
      for (let c = best; c >= 0; c = parent[c]) this.traffic[c] += cars;
    });
  }

  // Bir yolun taşıyabileceği araba
  roadCapacity(i: number) {
    return TRAFFIC.capacity * ROAD_GRADES[this.tiles[i]?.grade ?? 0].capacity;
  }

  // Yolun doluluğu (1'den büyükse tıkalı)
  congestion(i: number) {
    return this.tiles[i]?.kind === 'road' ? this.traffic[i] / this.roadCapacity(i) : 0;
  }

  get jams() {
    let n = 0;
    this.tiles.forEach((t, i) => t?.kind === 'road' && this.congestion(i) > 1 && n++);
    return n;
  }

  // Yanında tıkalı yol var mı?
  nearJam(i: number) {
    const x = i % SIZE, z = Math.floor(i / SIZE);
    return DIRS.some(([dx, dz]) => inBounds(x + dx, z + dz) && this.congestion(idx(x + dx, z + dz)) > 1);
  }

  // Fabrika ya da santral yakınında mı? (kirlilik)
  polluted(i: number) {
    return this.near(i % SIZE, Math.floor(i / SIZE), POLLUTION_RADIUS, n => n.kind === 'factory' || n.kind === 'plant');
  }

  // Her evin mutluluğu: hizmetler, park, dükkan artırır; kirlilik azaltır
  private updateHappiness() {
    this.happy.fill(0);
    // Simge yapıların mutluluk katkısı (aynı türden birden fazlası üst üste binmez)
    const decor = new Float32Array(SIZE * ROWS);
    for (const kind of DECOR_KINDS) {
      const seen = new Uint8Array(SIZE * ROWS);
      this.tiles.forEach((t, i) => {
        if (t?.kind !== kind) return;
        for (const c of areaAround(i, DECOR[kind].radius, t.fp ?? 1)) seen[c] = 1;
      });
      seen.forEach((v, c) => v && (decor[c] += DECOR[kind].happy));
    }
    this.tiles.forEach((t, i) => {
      if (t?.kind !== 'res' || t.level === 0) return;
      let h = HAPPY.base;
      for (const k of SERVICE_KINDS) if (this.isCovered(i, k)) h += HAPPY.service;
      if (this.parkNear(i)) h += HAPPY.park;
      if (this.shopNear(i)) h += HAPPY.shop;
      if (this.polluted(i)) h += HAPPY.pollution;
      h += ROAD_GRADES[this.bestRoad(i)].happy;
      if (this.nearJam(i)) h += TRAFFIC.happy;
      h += Math.min(DECOR_MAX, decor[i]);
      this.decorBonus[i] = Math.min(DECOR_MAX, decor[i]);
      this.happy[i] = Math.min(1, Math.max(0, h));
    });
  }

  // Şehrin ortalama mutluluğu (nüfusa göre ağırlıklı)
  get happiness() {
    let sum = 0, pop = 0;
    this.tiles.forEach((t, i) => {
      if (t?.kind !== 'res' || t.level === 0 || !this.isServed(i)) return;
      const p = RES_LEVELS[t.level - 1].pop;
      sum += this.happy[i] * p;
      pop += p;
    });
    return pop ? sum / pop : 0;
  }

  // Yola bağlı hizmet binalarının kapsama alanlarını işaretle
  private updateCoverage() {
    this.covered.fill(0);
    this.tiles.forEach((t, i) => {
      if (!t || !isService(t.kind) || !this.isConnected(i)) return;
      const bit = 1 << SERVICE_KINDS.indexOf(t.kind);
      for (const c of serviceArea(i, t.kind, t.fp ?? 1)) this.covered[c] |= bit;
    });
    // Hizmet de veren simge yapılar (üniversite = okul)
    this.tiles.forEach((t, i) => {
      if (!t || !isDecor(t.kind) || !DECOR[t.kind].covers || !this.isConnected(i)) return;
      const bit = 1 << SERVICE_KINDS.indexOf(DECOR[t.kind].covers!);
      for (const c of areaAround(i, DECOR[t.kind].radius, t.fp ?? 1)) this.covered[c] |= bit;
    });
  }

  isCovered(i: number, kind: ServiceKind) {
    return (this.covered[i] & (1 << SERVICE_KINDS.indexOf(kind))) !== 0;
  }

  allCovered(i: number) {
    return this.covered[i] === (1 << SERVICE_KINDS.length) - 1;
  }

  // Bir türdeki bütün hizmet binalarının kapsadığı kareler (haritada göstermek için)
  coverageOf(kind: ServiceKind) {
    const out: number[] = [];
    for (let i = 0; i < this.covered.length; i++) if (this.isCovered(i, kind)) out.push(i);
    return out;
  }

  // Girişten başlayıp birbirine değen bütün yolları bul
  private updateReach() {
    this.reach.clear();
    const queue: number[] = [];
    for (let x = 0; x < ENTRANCE_LEN; x++) queue.push(idx(x, ENTRANCE_Z));
    queue.forEach(i => this.reach.add(i));
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % SIZE, z = Math.floor(i / SIZE);
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (this.isRoad(nx, nz) && !this.reach.has(idx(nx, nz))) {
          this.reach.add(idx(nx, nz));
          queue.push(idx(nx, nz));
        }
      }
    }
  }

  // Yola bağlı santral ve su yapılarının ürettiğini binalara sırayla dağıt
  private updateService() {
    let power = 0, water = 0, powerDemand = 0, waterDemand = 0;
    this.tiles.forEach((t, i) => {
      if (t && isUtility(t.kind) && this.isConnected(i)) {
        power += UTILITIES[t.kind].power;
        water += UTILITIES[t.kind].water;
      }
    });
    this.service.power.supply = power;
    this.service.water.supply = water;
    this.lacking.clear();
    this.tiles.forEach((t, i) => {
      if (!t || !isZone(t.kind) || t.level === 0 || !this.isConnected(i)) return;
      const need = levelInfo(t).need;
      powerDemand += need;
      waterDemand += need;
      const hasPower = power >= need, hasWater = water >= need;
      if (hasPower && hasWater) {
        power -= need;
        water -= need;
      } else {
        this.lacking.set(i, { power: !hasPower, water: !hasWater });
      }
    });
    this.service.power.demand = powerDemand;
    this.service.water.demand = waterDemand;
  }

  private get spareUtility() {
    return Math.min(
      this.service.power.supply - this.service.power.demand,
      this.service.water.supply - this.service.water.demand,
    );
  }

  // Büyük binanın bir karesine dokunulursa ana kare
  anchorOf(i: number) {
    const t = this.tiles[i];
    return t?.kind === 'part' ? t.variant : i;
  }

  // Bir binanın kapladığı bütün kareler
  cellsOf(i: number) {
    const a = this.anchorOf(i);
    const n = this.tiles[a]?.fp ?? 1;
    return n === 1 ? [a] : block(a % SIZE, Math.floor(a / SIZE), n) ?? [a];
  }

  // Bu binanın (büyükse herhangi bir karesinin) yanında girişe bağlı bir yol var mı?
  isConnected(i: number) {
    for (const c of this.cellsOf(i)) {
      const x = c % SIZE, z = Math.floor(c / SIZE);
      if (DIRS.some(([dx, dz]) => inBounds(x + dx, z + dz) && this.reach.has(idx(x + dx, z + dz)))) return true;
    }
    return false;
  }

  // Bina yola bağlı, elektriği, suyu var, yanmıyor ve hasarsız mı?
  isServed(i: number) {
    const t = this.tiles[i];
    return this.isConnected(i) && !this.lacking.has(i) && !t?.fire && !t?.damaged;
  }

  private sumOf(kind: 'res' | 'com', value: (level: number) => number) {
    let sum = 0;
    this.tiles.forEach((t, i) => {
      if (t?.kind === kind && t.level > 0 && this.isServed(i)) sum += value(t.level);
    });
    return sum;
  }

  get population() {
    return this.sumOf('res', l => RES_LEVELS[l - 1].pop);
  }

  // İş yerleri: yola bağlı fabrika, dükkan, depo ve limanlar (yükseltilenler daha çok çalışan alır)
  get jobsTotal() {
    let sum = 0;
    this.tiles.forEach((t, i) => {
      if (t && isIndustry(t.kind) && this.isConnected(i)) sum += INDUSTRY[t.kind].jobs * (1 + t.level * 0.25);
    });
    return Math.round(sum);
  }

  get upkeep() {
    let sum = 0;
    for (const t of this.tiles) {
      if (!t) continue;
      if (isUtility(t.kind)) sum += UTILITIES[t.kind].upkeep;
      if (isService(t.kind)) sum += SERVICES[t.kind].upkeep;
      if (isIndustry(t.kind)) sum += INDUSTRY[t.kind].upkeep;
      if (isDecor(t.kind)) sum += DECOR[t.kind].upkeep;
    }
    return sum;
  }

  // Havalimanı gibi yapıların getirdiği turist parası (günlük)
  get tourism() {
    let sum = 0;
    this.tiles.forEach((t, i) => {
      if (t && isDecor(t.kind) && DECOR[t.kind].income && this.isConnected(i)) sum += DECOR[t.kind].income!;
    });
    return sum;
  }

  // Konutlardan gelen vergi (mutlu evler daha çok öder: x0.5 ile x1.5 arası)
  get residentTax() {
    let tax = 0;
    this.tiles.forEach((t, i) => {
      if (t?.kind === 'res' && t.level > 0 && this.isServed(i)) tax += RES_LEVELS[t.level - 1].pop * TAX_PER_PERSON * (0.5 + this.happy[i]);
    });
    return tax;
  }

  // Günlük toplam vergi: konut + iş yeri + turizm
  get dailyTax() {
    return this.residentTax + this.jobsTotal * TAX_PER_JOB + this.tourism;
  }

  get dailyIncome() {
    return Math.round(this.dailyTax - this.upkeep);
  }

  collectTaxes() {
    const amount = Math.floor(this.treasury);
    this.money += amount;
    this.treasury -= amount;
    this.stats.taxes += amount;
    return amount;
  }

  // Yangını parayla söndür
  extinguish(i: number): string | null {
    const t = this.tiles[i];
    if (!t?.fire) return 'Burada yangın yok';
    if (this.money < FIRE.cost) return 'Yeterli para yok';
    this.money -= FIRE.cost;
    t.fire = 0;
    this.refresh();
    return null;
  }

  // Deprem hasarını malzemeyle onar
  repair(i: number): string | null {
    const t = this.tiles[i];
    if (!t?.damaged) return 'Bu bina hasarlı değil';
    if (!this.hasMaterials(QUAKE.repair)) return 'Depoda yeterli malzeme yok';
    this.take(QUAKE.repair);
    t.damaged = false;
    this.refresh();
    return null;
  }

  // Hiç bölge çizilmiş mi? (oyuncuya elektrik/su ipucu vermek için)
  get hasZones() {
    return this.tiles.some(t => t && isZone(t.kind));
  }

  private near(x: number, z: number, r: number, test: (t: Tile) => boolean) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const t = this.get(x + dx, z + dz);
        if (t && test(t)) return true;
      }
    }
    return false;
  }

  parkNear(i: number) {
    return this.near(i % SIZE, Math.floor(i / SIZE), PARK_RADIUS, n => n.kind === 'park');
  }

  shopNear(i: number) {
    return this.near(i % SIZE, Math.floor(i / SIZE), SHOP_RADIUS, n => SHOPS.includes(n.kind as IndustryKind));
  }

  maxLevel(i: number) {
    const t = this.tiles[i]!;
    if (t.kind === 'res') {
      let max = RES_BASE_MAX;
      if (this.parkNear(i)) max++;
      if (this.shopNear(i)) max++;
      if (max === RES_BASE_MAX + 2 && this.allCovered(i)) max++;
      if (max === RES_BASE_MAX + 3 && this.decorBonus[i] >= LUXURY_DECOR - 1e-6) max++;
      // Gökdelenler: 7. seviye için yanında bulvar ya da cadde, 8. seviye için yakında metro ya da tren
      if (max === RES_BASE_MAX + 4 && this.bestRoad(i) >= 1) max++;
      if (max === RES_BASE_MAX + 5 && this.transit[i] >= 0.25) max++;
      return Math.min(max, RES_LEVELS.length);
    }
    return Math.min(COM_LEVELS.length, 1 + Math.floor(this.population / POP_PER_COM_LEVEL));
  }

  // --- Depo ve malzemeler ---

  get storageUsed() {
    return MAT_IDS.reduce((s, m) => s + this.storage[m], 0);
  }

  get storageCap() {
    return BASE_STORAGE + DEPOT_STORAGE * this.tiles.filter(t => t?.kind === 'depot').length;
  }

  hasMaterials(cost: Partial<Record<MatId, number>>) {
    return (Object.entries(cost) as [MatId, number][]).every(([m, n]) => this.storage[m] >= n);
  }

  private take(cost: Partial<Record<MatId, number>>) {
    for (const [m, n] of Object.entries(cost) as [MatId, number][]) this.storage[m] -= n;
  }

  // --- Fabrika ve dükkan seviyeleri ---

  // Aynı anda kaç üretim (fabrika) ya da sırada kaç ürün (dükkan)
  makerSlots(i: number) {
    const t = this.tiles[i]!;
    return (t.kind === 'factory' ? FACTORY_SLOTS : STORE_QUEUE) + t.level;
  }

  // Bu binada bir ürünün kaç saniyede yapıldığı
  makerTime(i: number, mat: MatId) {
    return Math.round(MATERIALS[mat].seconds * MAKER_LEVELS[this.tiles[i]?.level ?? 0].speed);
  }

  makerUpgradeBlocker(i: number): string | null {
    const t = this.tiles[i];
    if (!t) return 'Burada bina yok';
    const next = MAKER_LEVELS[t.level + 1];
    if (!next) return 'En üst seviyede';
    if (this.level < next.level) return `Şehir seviyesi ${next.level} lazım`;
    if (this.money < next.money) return 'Yeterli para yok';
    return null;
  }

  upgradeMaker(i: number): string | null {
    const err = this.makerUpgradeBlocker(i);
    if (err) return err;
    const t = this.tiles[i]!;
    this.money -= MAKER_LEVELS[t.level + 1].money;
    t.level++;
    this.addXp(XP.build * 3);
    return null;
  }

  // --- Komşu şehir siparişleri (liman) ---

  get hasPort() {
    return this.tiles.some((t, i) => t?.kind === 'port' && this.isConnected(i));
  }

  // Boş yerleri ve gemisi dönen siparişleri yenile. Değişiklik olduysa true.
  updateOrders(now: number) {
    if (!this.tiles.some(t => t?.kind === 'port')) return false;
    let changed = false;
    for (let n = 0; n < ORDERS.slots; n++) {
      const o = this.orders[n];
      if (!o || (o.until && o.until <= now)) {
        this.orders[n] = this.newOrder();
        changed = true;
      }
    }
    return changed;
  }

  private newOrder(): Order {
    const lvl = this.level;
    const mats = MAT_IDS.filter(m => this.isUnlocked(m));
    const crafted = mats.filter(m => MATERIALS[m].maker !== 'factory');
    const pool = crafted.length >= 2 ? crafted : mats;
    const chosen = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(pool.length, lvl >= 10 ? 3 : 2));
    const items: Partial<Record<MatId, number>> = {};
    let value = 0, xp = 0;
    for (const m of chosen) {
      const n = 1 + Math.floor(Math.random() * (lvl >= 8 ? 3 : 2));
      items[m] = n;
      value += MATERIALS[m].price * n;
      xp += n * (MATERIALS[m].maker === 'factory' ? 2 : 5);
    }
    const from = ORDERS.neighbors[Math.floor(Math.random() * ORDERS.neighbors.length)];
    return { from, items, money: Math.round((value * ORDERS.bonus) / 10) * 10, xp, until: 0 };
  }

  orderBlocker(n: number, now: number): string | null {
    const o = this.orders[n];
    if (!o) return 'Sipariş yok';
    if (o.until > now) return 'Gemi yolda';
    if (!this.hasPort) return 'Liman yola bağlı değil';
    if (!this.hasMaterials(o.items)) return 'Depoda yeterli mal yok';
    return null;
  }

  // Siparişi gemiyle gönder: mallar gider, para ve XP gelir; gemi dönünce yeni sipariş gelir
  ship(n: number, now: number): string | null {
    const err = this.orderBlocker(n, now);
    if (err) return err;
    const o = this.orders[n];
    this.take(o.items);
    this.money += o.money;
    this.addXp(o.xp);
    this.stats.ships = (this.stats.ships ?? 0) + 1;
    const [a, b] = ORDERS.travel;
    o.until = now + (a + Math.random() * (b - a)) * 1000;
    this.lastShipped = now;
    return null;
  }

  // Beğenilmeyen (bekleyen) siparişleri küçük bir ücretle değiştir
  get renewCost() {
    return 50 * this.level;
  }

  renewOrders(): string | null {
    if (this.money < this.renewCost) return 'Yeterli para yok';
    this.money -= this.renewCost;
    this.orders = this.orders.map(o => (o.until ? o : this.newOrder()));
    return null;
  }

  // --- Konut yükseltme (malzemeyle) ---

  // Bir sonraki seviyenin malzeme listesi (yükseltilemiyorsa null)
  upgradeCost(i: number) {
    const t = this.tiles[i];
    if (t?.kind !== 'res' || t.level < 1 || t.level >= RES_LEVELS.length) return null;
    return UPGRADE_COST[t.level + 1];
  }

  // Malzeme dışındaki şartlar; null = tamam, metin = neden olmadığı
  upgradeBlocker(i: number): string | null {
    const t = this.tiles[i];
    if (t?.kind !== 'res' || t.level < 1) return 'Yükseltilemez';
    if (t.level >= RES_LEVELS.length) return 'En üst seviyede';
    if (!this.isServed(i)) return 'Önce yol, elektrik ve su lazım';
    if (t.level >= this.maxLevel(i)) {
      if (!this.parkNear(i)) return 'Yakında park lazım';
      if (!this.shopNear(i)) return 'Yakında dükkan lazım (Sanayi: hırdavatçı, pazar, fırın…)';
      if (!this.allCovered(i)) return 'Dört hizmetin de kapsaması lazım';
      if (this.decorBonus[i] < LUXURY_DECOR - 1e-6) return 'Yakında bir simge yapı lazım (heykel, dönme dolap, stadyum…)';
      if (this.bestRoad(i) < 1) return 'Gökdelen için yanındaki yol en az bulvar olmalı';
      return 'Dev gökdelen için yakında metro ya da tren istasyonu lazım';
    }
    const extra = RES_LEVELS[t.level].need - RES_LEVELS[t.level - 1].need;
    if (extra > this.spareUtility) return 'Şehre daha fazla elektrik ve su lazım';
    return null;
  }

  canUpgrade(i: number) {
    const cost = this.upgradeCost(i);
    return !!cost && this.upgradeBlocker(i) === null && this.hasMaterials(cost);
  }

  upgrade(i: number): string | null {
    const cost = this.upgradeCost(i);
    const blocker = this.upgradeBlocker(i);
    if (!cost || blocker) return blocker ?? 'Yükseltilemez';
    if (!this.hasMaterials(cost)) return 'Depoda yeterli malzeme yok';
    this.take(cost);
    const t = this.tiles[i]!;
    t.level++;
    t.facing = this.facingFor(i);
    t.variant = Math.floor(Math.random() * 1000);
    this.addXp(XP.upgrade[t.level]);
    this.stats.upgrades++;
    this.refresh();
    return null;
  }

  // --- Üretim: fabrika (aynı anda birkaç) ve hırdavatçı (sırayla) ---

  canMake(i: number, mat: MatId): string | null {
    const t = this.tiles[i];
    const m = MATERIALS[mat];
    if (!t || t.kind !== m.maker) return 'Burada üretilemez';
    if (!this.isUnlocked(mat)) return `Şehir seviyesi ${m.unlock}'te açılır`;
    if (!this.isConnected(i)) return 'Bina yola bağlı değil';
    const list = this.jobs.get(i) ?? [];
    if (list.length >= this.makerSlots(i)) return t.kind === 'factory' ? 'Bütün üretim yerleri dolu' : 'Sıra dolu';
    if (m.needs && !this.hasMaterials(m.needs)) return 'Depoda yeterli malzeme yok';
    return null;
  }

  startJob(i: number, mat: MatId, now: number): string | null {
    const err = this.canMake(i, mat);
    if (err) return err;
    const m = MATERIALS[mat];
    const list = this.jobs.get(i) ?? [];
    if (m.needs) this.take(m.needs);
    // Fabrikada hepsi aynı anda, hırdavatçıda bir öncekinin bitmesini bekler
    const start = m.maker !== 'factory' && list.length ? Math.max(now, list[list.length - 1].end) : now;
    list.push({ mat, end: start + this.makerTime(i, mat) * 1000 });
    this.jobs.set(i, list);
    return null;
  }

  // Biten üretimleri depoya taşı (depo doluysa binada bekler)
  collect(now: number): MatId[] {
    const got: MatId[] = [];
    for (const [i, list] of this.jobs) {
      const keep: Job[] = [];
      for (const job of list) {
        if (job.end <= now && this.storageUsed < this.storageCap) {
          this.storage[job.mat]++;
          this.stats.produced[job.mat] = (this.stats.produced[job.mat] ?? 0) + 1;
          this.addXp(MATERIALS[job.mat].maker === 'factory' ? XP.raw : XP.crafted);
          got.push(job.mat);
        } else keep.push(job);
      }
      if (keep.length) this.jobs.set(i, keep);
      else this.jobs.delete(i);
    }
    return got;
  }

  // Ürünü bitmiş ama depo dolu olduğu için bekleyen binalar
  waiting(now: number) {
    const out: number[] = [];
    for (const [i, list] of this.jobs) if (list.some(j => j.end <= now)) out.push(i);
    return out;
  }

  // --- Yapma ve yıkma ---

  // null: buraya yapılabilir, metin: neden yapılamadığı
  check(tool: BuildTool, x: number, z: number): string | null {
    const t = this.get(x, z);
    if (tool === 'bulldoze') {
      if (!t) return 'Burada yıkılacak bir şey yok';
      return this.tiles[this.anchorOf(idx(x, z))]?.locked ? 'Şehir girişi yıkılamaz' : null;
    }
    if (!this.isUnlocked(tool)) return `Şehir seviyesi ${this.unlockLevel(tool)}'te açılır`;
    const n = sizeOf(tool);
    const cells = block(x, z, n);
    if (!cells) return 'Harita dışına taşıyor';
    if (cells.some(c => !this.isOwned(c))) return 'Bu arazi henüz senin değil';
    if (cells.some(isSea)) {
      if (tool !== 'road') return gradeOf(tool) > 0 && t?.kind === 'road' ? 'Asma köprü yükseltilemez' : 'Denizin üstüne sadece yol (asma köprü) yapılır';
      if (this.level < SEA_BRIDGE.level) return `Asma köprü şehir seviyesi ${SEA_BRIDGE.level}'te açılır`;
    }
    if (!ROAD_TOOLS.includes(tool) && tool !== 'rail' && cells.some(isWater)) return 'Suyun üstüne sadece yol ya da ray (köprü) yapılır';
    // Cadde ve bulvar: boş kareye yeni yapılır ya da var olan yol yükseltilir
    const grade = gradeOf(tool);
    if (grade > 0 && t) {
      if (t.kind !== 'road') return 'Burası dolu';
      if ((t.grade ?? 0) >= grade) return `Bu yol zaten ${ROAD_GRADES[t.grade ?? 0].label.toLocaleLowerCase('tr')}`;
      if (t.level === 1) return 'Tren yolunun geçtiği yol yükseltilemez';
      return null;
    }
    if (tool === 'rail') {
      // Ray boş kareye ya da düz bir yolun üstüne (hemzemin geçit) döşenir
      if (!t) return null;
      if (t.kind === 'road' && t.level === 0) {
        const m = this.roadMask(x, z);
        if (t.grade) return 'Raylar cadde ve bulvarı kesemez';
        return m === 0b0101 || m === 0b1010 ? null : 'Raylar yalnızca düz yolu kesebilir';
      }
      return 'Burası dolu';
    }
    if (cells.some(c => this.tiles[c])) return n > 1 ? `Bu yapı ${n}x${n} kare boş yer ister` : 'Burası dolu';
    const nearRoad = cells.some(c => this.roadMask(c % SIZE, Math.floor(c / SIZE)) !== 0);
    if (tool === 'busstop' && !nearRoad) return 'Durak yol kenarına kurulmalı';
    if (NEEDS_SEA.includes(tool) && !cells.some(c => this.nextToWater(c, true))) return 'Bu yapı deniz kıyısına (kumsala) kurulmalı';
    if (NEEDS_WATER.includes(tool) && !cells.some(c => this.nextToWater(c))) return 'Bu yapı deniz ya da nehir kıyısına kurulmalı';
    if (isDecor(tool) && DECOR[tool].road && !nearRoad) return 'Bu yapı yol kenarına kurulmalı';
    if (tool === 'station' && !cells.some(c => this.railMask(c % SIZE, Math.floor(c / SIZE)) !== 0)) {
      return 'İstasyon tren yolunun yanına kurulmalı';
    }
    if (tool === 'res' || tool === 'com') {
      if (!nearRoad) return 'Bölgeler yol kenarına çizilmeli';
    } else if ((isUtility(tool) || isService(tool) || isIndustry(tool)) && !nearRoad) {
      return 'Bu yapı yol kenarına kurulmalı';
    }
    return null;
  }

  private nextToWater(c: number, sea = false) {
    const x = c % SIZE, z = Math.floor(c / SIZE);
    return DIRS.some(([dx, dz]) => inBounds(x + dx, z + dz) && (sea ? isSeaXZ : isWaterXZ)(x + dx, z + dz));
  }

  // Toplam fiyat: su üstündeki yol ve raylar köprü olduğu için pahalı
  costOf(tool: BuildTool, cells: number[]) {
    return cells.reduce((s, i) => {
      // Yükseltmede sadece aradaki fark ödenir
      const t = this.tiles[i];
      const price = gradeOf(tool) > 0 && t?.kind === 'road' ? COST[tool] - COST[ROAD_GRADES[t.grade ?? 0].tool] : COST[tool];
      const bridge = isSea(i) ? SEA_BRIDGE.cost : BRIDGE_COST;
      return s + price * ((ROAD_TOOLS.includes(tool) || tool === 'rail') && isWater(i) ? bridge : 1);
    }, 0);
  }

  // Kapı yola baksın; mümkünse kameraya dönük (güney) taraf seçilsin. n = binanın kenar uzunluğu
  private facingFor(i: number, n = 1, to: 'road' | 'rail' | 'water' = 'road') {
    const x = i % SIZE, z = Math.floor(i / SIZE);
    const side = (d: number) => {
      for (let k = 0; k < n; k++) {
        const [cx, cz] = d === 0 ? [x + k, z - 1] : d === 1 ? [x + n, z + k] : d === 2 ? [x + k, z + n] : [x - 1, z + k];
        if (to === 'rail' ? this.isRail(cx, cz) : to === 'water' ? inBounds(cx, cz) && isWaterXZ(cx, cz) : this.isRoad(cx, cz)) return true;
      }
      return false;
    };
    return [2, 1, 3, 0].find(side) ?? 2;
  }

  // Seçilen karelere uygula. Yapılan kareleri ya da hata mesajını döndürür.
  apply(tool: BuildTool, cells: number[]): { done: number[]; error: string | null } {
    let firstError: string | null = null;
    // Yıkarken büyük binanın herhangi bir karesi bütün binayı yıkar
    const targets = tool === 'bulldoze' ? [...new Set(cells.map(i => (this.tiles[i] ? this.anchorOf(i) : i)))] : cells;
    const ok = targets.filter(i => {
      const err = this.check(tool, i % SIZE, Math.floor(i / SIZE));
      firstError ??= err;
      return err === null;
    });
    if (!ok.length) return { done: [], error: firstError };
    const cost = this.costOf(tool, ok);
    if (cost > this.money) return { done: [], error: 'Yeterli para yok' };

    const done: number[] = [];
    const n = sizeOf(tool);
    for (const i of ok) {
      if (tool === 'bulldoze') {
        for (const c of this.cellsOf(i)) {
          this.jobs.delete(c);
          this.tiles[c] = null;
          done.push(c);
        }
        continue;
      }
      // Cadde ve bulvar: yol yükseltilir ya da yeni yapılır
      if (gradeOf(tool) > 0) {
        const old = this.tiles[i];
        if (old) old.grade = gradeOf(tool);
        else this.tiles[i] = { kind: 'road', level: 0, facing: 0, variant: Math.floor(Math.random() * 1000), grade: gradeOf(tool) };
        done.push(i);
        continue;
      }
      // Ray düz yolun üstüne: hemzemin geçit
      if (tool === 'rail' && this.tiles[i]?.kind === 'road') {
        this.tiles[i]!.level = 1;
        done.push(i);
        continue;
      }
      const variant = Math.floor(Math.random() * 1000);
      const area = block(i % SIZE, Math.floor(i / SIZE), n)!;
      const side = tool === 'station' ? 'rail' : NEEDS_WATER.includes(tool) ? 'water' : 'road';
      this.tiles[i] = { kind: tool as Kind, level: 0, facing: this.facingFor(i, n, side), variant };
      if (n > 1) this.tiles[i]!.fp = n;
      if (tool === 'park') this.tiles[i]!.variant = variant % PARK_MODELS.length;
      for (const c of area) if (c !== i) this.tiles[c] = { kind: 'part', level: 0, facing: 0, variant: i };
      done.push(...area);
    }
    this.money -= cost;
    this.refresh();
    return { done, error: null };
  }

  // Bir gün geçer: vergi belediyede birikir, bakım ödenir, arsalara bina yapılır, dükkanlar büyür,
  // bazen olaylar (yangın, hırsızlık, deprem) olur. Konutlar malzemeyle yükseltilir.
  nextDay(): { income: number; changed: number[] } {
    this.day++;
    const income = this.dailyIncome;
    if (this.hall !== null) this.treasury += this.dailyTax;
    else this.money += this.dailyTax;
    this.money -= this.upkeep;

    const changed: number[] = [];
    let jobRoom = this.population * JOBS_PER_PERSON - this.jobsTotal;
    let spare = this.spareUtility;
    this.tiles.forEach((t, i) => {
      if (!t || !isZone(t.kind) || !this.isConnected(i) || this.lacking.has(i)) return;
      if (t.kind === 'res' && t.level > 0) return;
      if (t.level >= this.maxLevel(i)) return;
      if (Math.random() >= (t.level === 0 ? BUILD_CHANCE : GROW_CHANCE)) return;
      const levels = t.kind === 'res' ? RES_LEVELS : COM_LEVELS;
      // Yeni seviye için yeterli elektrik ve su kalmış mı?
      const extraNeed = levels[t.level].need - (t.level ? levels[t.level - 1].need : 0);
      if (extraNeed > spare) return;
      if (t.kind === 'com') {
        // Dükkanlar ancak çalışacak insan varsa açılır
        const extra = COM_LEVELS[t.level].jobs - (t.level ? COM_LEVELS[t.level - 1].jobs : 0);
        if (extra > jobRoom) return;
        jobRoom -= extra;
      }
      spare -= extraNeed;
      t.level++;
      t.facing = this.facingFor(i);
      t.variant = Math.floor(Math.random() * 1000);
      this.addXp(XP.build);
      this.stats.builds++;
      changed.push(i);
    });
    changed.push(...this.dailyEvents());
    if (changed.length) this.refresh();
    return { income, changed };
  }

  // Yangın, hırsızlık ve deprem. Değişen kareleri döndürür.
  private dailyEvents(): number[] {
    const changed: number[] = [];
    const built = this.tiles.map((t, i) => (t?.kind === 'res' && t.level > 0 && this.isConnected(i) ? i : -1)).filter(i => i >= 0);
    // Süren yangınlar: itfaiye kapsıyorsa söner, yoksa birkaç gün sonra bina yıkılır
    for (const i of built) {
      const t = this.tiles[i]!;
      if (!t.fire) continue;
      if (this.isCovered(i, 'fire')) {
        t.fire = 0;
        this.events.push({ type: 'fireOut', i });
      } else if (++t.fire > FIRE.days) {
        t.fire = 0;
        t.level = 0;
        this.events.push({ type: 'collapse', i });
      }
      changed.push(i);
    }
    // Yeni yangın: itfaiyenin kapsamadığı bir evde
    const unsafe = built.filter(i => !this.isCovered(i, 'fire') && !this.tiles[i]!.fire && this.tiles[i]!.level > 0);
    if (unsafe.length && Math.random() < FIRE.chance) {
      const i = unsafe[Math.floor(Math.random() * unsafe.length)];
      this.tiles[i]!.fire = 1;
      this.events.push({ type: 'fire', i });
      changed.push(i);
    }
    // Hırsızlık: polisin kapsamadığı evlerde çok insan yaşıyorsa
    const unguarded = built
      .filter(i => !this.isCovered(i, 'police') && this.tiles[i]!.level > 0)
      .reduce((sum, i) => sum + RES_LEVELS[this.tiles[i]!.level - 1].pop, 0);
    if (unguarded >= CRIME.minPop && Math.random() < CRIME.chance) {
      const amount = Math.min(Math.max(0, this.money), Math.round(unguarded * 0.8));
      if (amount > 0) {
        this.money -= amount;
        this.events.push({ type: 'crime', amount });
      }
    }
    // Deprem: nadiren, birkaç bina hasar görür
    const standing = built.filter(i => this.tiles[i]!.level > 0);
    if (this.level >= QUAKE.minLevel && standing.length && Math.random() < QUAKE.chance) {
      const hit = [...standing].sort(() => Math.random() - 0.5).slice(0, QUAKE.damaged);
      for (const i of hit) this.tiles[i]!.damaged = true;
      this.events.push({ type: 'quake', tiles: hit });
      changed.push(...hit);
    }
    return changed;
  }

  // --- Kaydetme ---

  serialize(): SaveData {
    const t: TileRow[] = [];
    this.tiles.forEach((tile, i) => {
      if (!tile || (tile.locked && tile.kind === 'road' && !tile.grade)) return;
      const row: TileRow = [i, tile.kind, tile.level, tile.facing, tile.variant];
      if (tile.fire || tile.damaged || tile.fp || tile.grade) row.push(tile.fire ?? 0, tile.damaged ? 1 : 0, tile.fp ?? 1);
      if (tile.grade) row.push(tile.grade);
      t.push(row);
    });
    const j: SaveData['j'] = [...this.jobs].map(([i, list]) => [i, list.map(job => [job.mat, job.end] as [MatId, number])]);
    const st: SaveData['st'] = {};
    for (const m of MAT_IDS) if (this.storage[m]) st[m] = this.storage[m];
    const own: number[] = [];
    this.owned.forEach((v, p) => v && own.push(p));
    return { v: 5, sz: SIZE, rows: ROWS, rg: 2, own, money: this.money, day: this.day, xp: this.xp, st, t, j, tr: this.treasury, ss: this.stats, q: this.quests, o: this.orders };
  }

  static readonly VERSION = 5;

  // Bu kaydı okuyabilir miyiz? (sürüm kontrolü tek yerde)
  static canLoad(data: unknown): data is SaveData | OldSaveData {
    const v = (data as { v?: unknown } | null)?.v;
    return typeof v === 'number' && v >= 1 && v <= City.VERSION && Array.isArray((data as { t?: unknown }).t);
  }

  static load(data: SaveData | OldSaveData): City {
    const c = new City();
    // Yeni şehrin otomatik belediyesini kaldır; kayıttaki (ya da uygun yerdeki) kullanılacak
    c.tiles = c.tiles.map(t => (t?.kind === 'hall' ? null : t));
    c.quests = [];
    c.money = data.money;
    c.day = data.day;
    // Eski 32x32 kayıtlar yeni haritanın ortasına taşınır; kare haritalı kayıtlar kuzeye eklenen deniz sıraları kadar aşağı kayar
    const oldSize = data.v === 5 ? data.sz : OLD_SIZE;
    const oldRows = (data.v === 5 && data.rows) || oldSize;
    const shiftX = (SIZE - oldSize) / 2;
    const shiftZ = shiftX + (ROWS - SIZE) - (oldRows - oldSize);
    const move = (i: number) => idx((i % oldSize) + shiftX, Math.floor(i / oldSize) + shiftZ);
    if (data.v === 5) {
      c.owned.fill(0);
      const oldPlots = oldSize / PLOT;
      for (const p of data.own) {
        const px = (p % oldPlots) + shiftX / PLOT, pz = Math.floor(p / oldPlots) + shiftZ / PLOT;
        if (px >= 0 && px < PLOTS && pz >= 0 && pz < PLOT_ROWS) c.owned[pz * PLOTS + px] = 1;
      }
    }
    const newGrades = data.v === 5 && data.rg === 2;
    for (const [oldI, rawKind, rawLevel, facing, rawVariant, fire, damaged, fp, rawGrade] of data.t as TileRow[]) {
      const grade = rawGrade && !newGrades ? 1 : rawGrade;
      const i = move(oldI);
      // Büyük binanın parçaları ana karenin numarasını tutar; o da taşınmalı
      const variant = rawKind === 'part' ? move(rawVariant) : rawVariant;
      let kind = rawKind as Kind;
      let level = rawLevel;
      if (data.v === 1 && (rawKind as string) === 'house') {
        kind = 'res';
        level = Math.min(rawLevel, RES_LEVELS.length);
      }
      if (!KINDS.includes(kind)) continue;
      // Şehir girişi yükseltilmişse çeşidi korunur
      if (kind === 'road' && grade && c.tiles[i]?.locked) c.tiles[i]!.grade = grade;
      if (i >= 0 && i < c.tiles.length && !c.tiles[i]) {
        c.tiles[i] = { kind, level, facing, variant };
        if (kind === 'road' && grade) c.tiles[i]!.grade = grade;
        if (kind === 'hall') c.tiles[i]!.locked = true;
        if (fire) c.tiles[i]!.fire = fire;
        if (damaged) c.tiles[i]!.damaged = true;
        if (fp && fp > 1) c.tiles[i]!.fp = fp;
      }
    }
    if (data.v >= 3) {
      c.xp = data.xp ?? 0;
      for (const m of MAT_IDS) c.storage[m] = data.st?.[m] ?? 0;
      for (const [oldI, list] of data.j ?? []) {
        const i = move(oldI);
        if (isIndustry(c.tiles[i]?.kind)) c.jobs.set(i, list.filter(([m]) => m in MATERIALS).map(([mat, end]) => ({ mat, end })));
      }
      if (data.v >= 4) {
        c.treasury = data.tr ?? 0;
        c.stats = { ...emptyStats(), ...data.ss };
        c.quests = (data.q ?? []).filter(q => q && q.type);
        c.orders = ((data as SaveData).o ?? []).filter(o => o && o.items && Object.keys(o.items).every(m => m in MATERIALS));
      }
    } else {
      // Eski şehirler: mevcut binalar için XP verilsin ki seviye baştan başlamasın
      for (const t of c.tiles) {
        if (!t || !isZone(t.kind) || t.level === 0) continue;
        c.xp += XP.build;
        if (t.kind === 'res') for (let l = 2; l <= t.level; l++) c.xp += XP.upgrade[l];
      }
    }
    // Eski kayıtlarda suyun olduğu yerde bina varsa kaldır (nehirde yol ve ray köprü olarak kalır).
    // Denize kalan yapıların parası geri verilir.
    c.tiles.forEach((t, i) => {
      if (!t || !isWater(i)) return;
      if (t.kind === 'road' || t.kind === 'rail') return; // nehir köprüleri ve asma köprüler kalır
      const anchor = c.tiles[c.anchorOf(i)];
      if (isSea(i) && anchor && anchor.kind in COST) c.seaRefund += COST[anchor.kind as BuildTool];
      for (const cell of c.cellsOf(i)) {
        c.tiles[cell] = null;
        c.jobs.delete(cell);
      }
    });
    c.money += c.seaRefund;
    // Ticaret merkezleri kaldırıldı (fabrika ve dükkanlar yeterli); parası geri verilir
    c.tiles.forEach((t, i) => {
      if (t?.kind !== 'trade') return;
      c.tradeRefund += COST.trade;
      for (const cell of c.cellsOf(i)) c.tiles[cell] = null;
    });
    c.money += c.tradeRefund;
    // Ticari bölgeler kaldırıldı: eski dükkan ve ofisler aynı seviyede konut olur
    c.tiles.forEach(t => {
      if (t?.kind !== 'com') return;
      t.kind = 'res';
      t.level = Math.min(t.level, RES_LEVELS.length);
    });
    c.placeHall();
    c.refresh();
    c.fillQuests();
    return c;
  }
}
