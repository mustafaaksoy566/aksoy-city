import {
  SIZE, START_MONEY, ENTRANCE_Z, ENTRANCE_LEN, COST, RES_LEVELS, COM_LEVELS, RES_BASE_MAX, PARK_RADIUS,
  SHOP_RADIUS, POP_PER_COM_LEVEL, JOBS_PER_PERSON, BUILD_CHANCE, GROW_CHANCE, PARK_MODELS, TAX_PER_PERSON,
  TAX_PER_JOB, UTILITIES, SERVICES, SERVICE_KINDS, INDUSTRY, INDUSTRY_KINDS, FACTORY_SLOTS, STORE_QUEUE,
  BASE_STORAGE, DEPOT_STORAGE, MATERIALS, MAT_IDS, UPGRADE_COST, XP, LEVEL_XP, LEVEL_REWARD, UNLOCK,
  HAPPY, POLLUTION_RADIUS, FIRE, CRIME, QUAKE,
  type BuildTool, type UtilKind, type ServiceKind, type IndustryKind, type MatId,
} from './config';
import { emptyStats, newQuest, questDone, type CityStats, type Quest } from './quests';

export type Kind = 'road' | 'res' | 'com' | 'park' | 'hall' | UtilKind | ServiceKind | IndustryKind;
export interface Tile {
  kind: Kind;
  level: number; // bölgelerde 0 = boş arsa, 1+ = bina seviyesi
  facing: number; // binanın kapısının baktığı yön
  variant: number; // rastgele sayı: model, renk ve park çeşidi bundan seçilir
  locked?: boolean;
  fire?: number; // kaç gündür yanıyor
  damaged?: boolean; // depremde hasar gördü
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

// Yönler: 0 kuzey (-z), 1 doğu (+x), 2 güney (+z), 3 batı (-x)
export const DIRS: readonly [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export const idx = (x: number, z: number) => z * SIZE + x;
export const inBounds = (x: number, z: number) => x >= 0 && z >= 0 && x < SIZE && z < SIZE;
export const isZone = (k: Kind | undefined): k is 'res' | 'com' => k === 'res' || k === 'com';
export const isUtility = (k: Kind | string | undefined): k is UtilKind => !!k && k in UTILITIES;
export const isService = (k: Kind | string | undefined): k is ServiceKind => !!k && k in SERVICES;
export const isIndustry = (k: Kind | string | undefined): k is IndustryKind => !!k && k in INDUSTRY;
const KINDS: string[] = ['road', 'res', 'com', 'park', 'hall', ...Object.keys(UTILITIES), ...SERVICE_KINDS, ...INDUSTRY_KINDS];

// Bir hizmet binasının kapsadığı kareler (daire şeklinde)
export function serviceArea(i: number, kind: ServiceKind): number[] {
  const r = SERVICES[kind].radius;
  const x0 = i % SIZE, z0 = Math.floor(i / SIZE);
  const out: number[] = [];
  for (let z = z0 - r; z <= z0 + r; z++) {
    for (let x = x0 - r; x <= x0 + r; x++) {
      if (inBounds(x, z) && (x - x0) ** 2 + (z - z0) ** 2 <= r * r + r) out.push(idx(x, z));
    }
  }
  return out;
}

const levelInfo = (t: Tile) => (t.kind === 'res' ? RES_LEVELS : COM_LEVELS)[t.level - 1];
const emptyStorage = () => Object.fromEntries(MAT_IDS.map(m => [m, 0])) as Record<MatId, number>;

// [kare, tür, seviye, yön, çeşit, yangın günü?, hasarlı?]
type TileRow = [number, Kind, number, number, number, number?, number?];
export interface SaveData {
  v: 4;
  money: number;
  day: number;
  xp: number;
  st: Partial<Record<MatId, number>>;
  t: TileRow[];
  j: [number, [MatId, number][]][];
  tr: number; // belediyede bekleyen vergi
  ss: CityStats;
  q: Quest[];
}
// Eski kayıtlar: v1'de 'house' vardı, v2'de malzeme ve XP yoktu, v3'te belediye ve görev yoktu
interface OldSaveData {
  v: 1 | 2 | 3;
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
  tiles: (Tile | null)[] = new Array(SIZE * SIZE).fill(null);
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
  happy = new Float32Array(SIZE * SIZE); // her evin mutluluğu (0..1)
  private reach = new Set<number>(); // girişe bağlı yol kareleri
  // Elektrik ya da suyu eksik binalar ve eksik olan şey
  lacking = new Map<number, { power: boolean; water: boolean }>();
  service: Service = { power: { supply: 0, demand: 0 }, water: { supply: 0, demand: 0 } };
  // Her kare için hangi hizmetlerin kapsadığı (bit maskesi, SERVICE_KINDS sırasıyla)
  private covered = new Uint8Array(SIZE * SIZE);

  constructor() {
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
    const near = [idx(1, ENTRANCE_Z - 1), idx(1, ENTRANCE_Z + 1), idx(2, ENTRANCE_Z - 1), idx(2, ENTRANCE_Z + 1), idx(0, ENTRANCE_Z - 1)];
    const free = (i: number) => !this.tiles[i] && this.isConnected(i);
    const spot = near.find(free) ?? this.tiles.findIndex((_, i) => free(i));
    if (spot < 0) return;
    this.tiles[spot] = { kind: 'hall', level: 0, facing: this.facingFor(spot), variant: 0, locked: true };
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

  isRoad(x: number, z: number) {
    return this.get(x, z)?.kind === 'road';
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
    this.updateHappiness();
  }

  // Fabrika ya da santral yakınında mı? (kirlilik)
  polluted(i: number) {
    return this.near(i % SIZE, Math.floor(i / SIZE), POLLUTION_RADIUS, n => n.kind === 'factory' || n.kind === 'plant');
  }

  // Her evin mutluluğu: hizmetler, park, dükkan artırır; kirlilik azaltır
  private updateHappiness() {
    this.happy.fill(0);
    this.tiles.forEach((t, i) => {
      if (t?.kind !== 'res' || t.level === 0) return;
      let h = HAPPY.base;
      for (const k of SERVICE_KINDS) if (this.isCovered(i, k)) h += HAPPY.service;
      if (this.parkNear(i)) h += HAPPY.park;
      if (this.shopNear(i)) h += HAPPY.shop;
      if (this.polluted(i)) h += HAPPY.pollution;
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
      for (const c of serviceArea(i, t.kind)) this.covered[c] |= bit;
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

  // Bu karenin yanında girişe bağlı bir yol var mı?
  isConnected(i: number) {
    const x = i % SIZE, z = Math.floor(i / SIZE);
    return DIRS.some(([dx, dz]) => inBounds(x + dx, z + dz) && this.reach.has(idx(x + dx, z + dz)));
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

  get jobsTotal() {
    return this.sumOf('com', l => COM_LEVELS[l - 1].jobs);
  }

  get upkeep() {
    let sum = 0;
    for (const t of this.tiles) {
      if (!t) continue;
      if (isUtility(t.kind)) sum += UTILITIES[t.kind].upkeep;
      if (isService(t.kind)) sum += SERVICES[t.kind].upkeep;
      if (isIndustry(t.kind)) sum += INDUSTRY[t.kind].upkeep;
    }
    return sum;
  }

  // Günlük vergi: mutlu evler daha çok öder (x0.5 ile x1.5 arası)
  get dailyTax() {
    let tax = this.jobsTotal * TAX_PER_JOB;
    this.tiles.forEach((t, i) => {
      if (t?.kind === 'res' && t.level > 0 && this.isServed(i)) tax += RES_LEVELS[t.level - 1].pop * TAX_PER_PERSON * (0.5 + this.happy[i]);
    });
    return tax;
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
    return this.near(i % SIZE, Math.floor(i / SIZE), SHOP_RADIUS, n => n.kind === 'com' && n.level > 0);
  }

  maxLevel(i: number) {
    const t = this.tiles[i]!;
    if (t.kind === 'res') {
      let max = RES_BASE_MAX;
      if (this.parkNear(i)) max++;
      if (this.shopNear(i)) max++;
      if (max === RES_BASE_MAX + 2 && this.allCovered(i)) max++;
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
      if (!this.parkNear(i) && t.level >= RES_BASE_MAX) return 'Yakında park lazım';
      if (!this.shopNear(i) && t.level >= RES_BASE_MAX) return 'Yakında dükkan lazım';
      return 'Dört hizmetin de kapsaması lazım';
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
    if (t.kind === 'factory' && list.length >= FACTORY_SLOTS) return 'Bütün üretim yerleri dolu';
    if (t.kind === 'store' && list.length >= STORE_QUEUE) return 'Sıra dolu';
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
    const start = m.maker === 'store' && list.length ? Math.max(now, list[list.length - 1].end) : now;
    list.push({ mat, end: start + m.seconds * 1000 });
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
      return t.locked ? 'Şehir girişi yıkılamaz' : null;
    }
    if (!this.isUnlocked(tool)) return `Şehir seviyesi ${this.unlockLevel(tool)}'te açılır`;
    if (t) return 'Burası dolu';
    if (tool === 'res' || tool === 'com') {
      if (this.roadMask(x, z) === 0) return 'Bölgeler yol kenarına çizilmeli';
    } else if ((isUtility(tool) || isService(tool) || isIndustry(tool)) && this.roadMask(x, z) === 0) {
      return 'Bu yapı yol kenarına kurulmalı';
    }
    return null;
  }

  private facingFor(i: number) {
    const m = this.roadMask(i % SIZE, Math.floor(i / SIZE));
    // Kapı yola baksın; mümkünse kameraya dönük (güney) taraf seçilsin
    return [2, 1, 3, 0].find(d => m & (1 << d)) ?? 2;
  }

  // Seçilen karelere uygula. Yapılan kareleri ya da hata mesajını döndürür.
  apply(tool: BuildTool, cells: number[]): { done: number[]; error: string | null } {
    let firstError: string | null = null;
    const ok = cells.filter(i => {
      const err = this.check(tool, i % SIZE, Math.floor(i / SIZE));
      firstError ??= err;
      return err === null;
    });
    if (!ok.length) return { done: [], error: firstError };
    const cost = ok.length * COST[tool];
    if (cost > this.money) return { done: [], error: 'Yeterli para yok' };

    for (const i of ok) {
      this.jobs.delete(i);
      if (tool === 'bulldoze') this.tiles[i] = null;
      else {
        const variant = Math.floor(Math.random() * 1000);
        this.tiles[i] = { kind: tool, level: 0, facing: this.facingFor(i), variant };
        if (tool === 'park') this.tiles[i]!.variant = variant % PARK_MODELS.length;
      }
    }
    this.money -= cost;
    this.refresh();
    return { done: ok, error: null };
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
      if (!tile || (tile.locked && tile.kind === 'road')) return;
      const row: TileRow = [i, tile.kind, tile.level, tile.facing, tile.variant];
      if (tile.fire || tile.damaged) row.push(tile.fire ?? 0, tile.damaged ? 1 : 0);
      t.push(row);
    });
    const j: SaveData['j'] = [...this.jobs].map(([i, list]) => [i, list.map(job => [job.mat, job.end] as [MatId, number])]);
    const st: SaveData['st'] = {};
    for (const m of MAT_IDS) if (this.storage[m]) st[m] = this.storage[m];
    return { v: 4, money: this.money, day: this.day, xp: this.xp, st, t, j, tr: this.treasury, ss: this.stats, q: this.quests };
  }

  static readonly VERSION = 4;

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
    for (const [i, rawKind, rawLevel, facing, variant, fire, damaged] of data.t as TileRow[]) {
      let kind = rawKind as Kind;
      let level = rawLevel;
      if (data.v === 1 && (rawKind as string) === 'house') {
        kind = 'res';
        level = Math.min(rawLevel, RES_LEVELS.length);
      }
      if (!KINDS.includes(kind)) continue;
      if (i >= 0 && i < c.tiles.length && !c.tiles[i]) {
        c.tiles[i] = { kind, level, facing, variant };
        if (kind === 'hall') c.tiles[i]!.locked = true;
        if (fire) c.tiles[i]!.fire = fire;
        if (damaged) c.tiles[i]!.damaged = true;
      }
    }
    if (data.v === 3 || data.v === 4) {
      c.xp = data.xp ?? 0;
      for (const m of MAT_IDS) c.storage[m] = data.st?.[m] ?? 0;
      for (const [i, list] of data.j ?? []) {
        if (isIndustry(c.tiles[i]?.kind)) c.jobs.set(i, list.filter(([m]) => m in MATERIALS).map(([mat, end]) => ({ mat, end })));
      }
      if (data.v === 4) {
        c.treasury = data.tr ?? 0;
        c.stats = { ...emptyStats(), ...data.ss };
        c.quests = (data.q ?? []).filter(q => q && q.type);
      }
    } else {
      // Eski şehirler: mevcut binalar için XP verilsin ki seviye baştan başlamasın
      for (const t of c.tiles) {
        if (!t || !isZone(t.kind) || t.level === 0) continue;
        c.xp += XP.build;
        if (t.kind === 'res') for (let l = 2; l <= t.level; l++) c.xp += XP.upgrade[l];
      }
    }
    c.placeHall();
    c.refresh();
    c.fillQuests();
    return c;
  }
}
