import {
  SIZE, START_MONEY, ENTRANCE_Z, ENTRANCE_LEN, COST, RES_LEVELS, COM_LEVELS, RES_BASE_MAX, PARK_RADIUS,
  SHOP_RADIUS, POP_PER_COM_LEVEL, JOBS_PER_PERSON, BUILD_CHANCE, GROW_CHANCE, PARK_MODELS, TAX_PER_PERSON,
  TAX_PER_JOB, UTILITIES, SERVICES, SERVICE_KINDS, type BuildTool, type UtilKind, type ServiceKind,
} from './config';

export type Kind = 'road' | 'res' | 'com' | 'park' | UtilKind | ServiceKind;
export interface Tile {
  kind: Kind;
  level: number; // bölgelerde 0 = boş arsa, 1+ = bina seviyesi
  facing: number; // binanın kapısının baktığı yön
  variant: number; // rastgele sayı: model, renk ve park çeşidi bundan seçilir
  locked?: boolean;
}

// Yönler: 0 kuzey (-z), 1 doğu (+x), 2 güney (+z), 3 batı (-x)
export const DIRS: readonly [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export const idx = (x: number, z: number) => z * SIZE + x;
export const inBounds = (x: number, z: number) => x >= 0 && z >= 0 && x < SIZE && z < SIZE;
export const isZone = (k: Kind | undefined): k is 'res' | 'com' => k === 'res' || k === 'com';
export const isUtility = (k: Kind | string | undefined): k is UtilKind => !!k && k in UTILITIES;
export const isService = (k: Kind | string | undefined): k is ServiceKind => !!k && k in SERVICES;
const KINDS: string[] = ['road', 'res', 'com', 'park', ...Object.keys(UTILITIES), ...SERVICE_KINDS];

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

export interface SaveData {
  v: 2;
  money: number;
  day: number;
  t: [number, Kind, number, number, number][];
}

// İlk sürümün kaydı: 'house' artık 'res' (konut bölgesi)
interface SaveDataV1 {
  v: 1;
  money: number;
  day: number;
  t: [number, string, number, number, number][];
}

export interface Service {
  power: { supply: number; demand: number };
  water: { supply: number; demand: number };
}

export class City {
  tiles: (Tile | null)[] = new Array(SIZE * SIZE).fill(null);
  money = START_MONEY;
  day = 1;
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
    this.refresh();
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

  // Yollar ya da binalar değişince bağlantıyı ve elektrik/su dağıtımını yeniden hesapla
  refresh() {
    this.updateReach();
    this.updateService();
    this.updateCoverage();
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

  // Bu karenin yanında girişe bağlı bir yol var mı?
  isConnected(i: number) {
    const x = i % SIZE, z = Math.floor(i / SIZE);
    return DIRS.some(([dx, dz]) => inBounds(x + dx, z + dz) && this.reach.has(idx(x + dx, z + dz)));
  }

  // Bina yola bağlı ve elektriği, suyu var mı?
  isServed(i: number) {
    return this.isConnected(i) && !this.lacking.has(i);
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

  get jobs() {
    return this.sumOf('com', l => COM_LEVELS[l - 1].jobs);
  }

  get upkeep() {
    let sum = 0;
    for (const t of this.tiles) {
      if (t && isUtility(t.kind)) sum += UTILITIES[t.kind].upkeep;
      if (t && isService(t.kind)) sum += SERVICES[t.kind].upkeep;
    }
    return sum;
  }

  get dailyIncome() {
    return Math.round(this.population * TAX_PER_PERSON + this.jobs * TAX_PER_JOB - this.upkeep);
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

  // null: buraya yapılabilir, metin: neden yapılamadığı
  check(tool: BuildTool, x: number, z: number): string | null {
    const t = this.get(x, z);
    if (tool === 'bulldoze') {
      if (!t) return 'Burada yıkılacak bir şey yok';
      return t.locked ? 'Şehir girişi yıkılamaz' : null;
    }
    if (t) return 'Burası dolu';
    if (tool === 'res' || tool === 'com') {
      if (this.roadMask(x, z) === 0) return 'Bölgeler yol kenarına çizilmeli';
    } else if ((isUtility(tool) || isService(tool)) && this.roadMask(x, z) === 0) {
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

  // Bir gün geçer: vergi toplanır, arsalara bina yapılır, binalar büyür
  nextDay(): { income: number; changed: number[] } {
    this.day++;
    const income = this.dailyIncome;
    this.money += income;

    const changed: number[] = [];
    let jobRoom = this.population * JOBS_PER_PERSON - this.jobs;
    let spare = Math.min(
      this.service.power.supply - this.service.power.demand,
      this.service.water.supply - this.service.water.demand,
    );
    this.tiles.forEach((t, i) => {
      if (!t || !isZone(t.kind) || !this.isConnected(i) || this.lacking.has(i)) return;
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
      changed.push(i);
    });
    if (changed.length) this.updateService();
    return { income, changed };
  }

  serialize(): SaveData {
    const t: SaveData['t'] = [];
    this.tiles.forEach((tile, i) => {
      if (tile && !tile.locked) t.push([i, tile.kind, tile.level, tile.facing, tile.variant]);
    });
    return { v: 2, money: this.money, day: this.day, t };
  }

  static load(data: SaveData | SaveDataV1): City {
    const c = new City();
    c.money = data.money;
    c.day = data.day;
    for (const [i, rawKind, rawLevel, facing, variant] of data.t) {
      let kind = rawKind as Kind;
      let level = rawLevel;
      if (data.v === 1 && rawKind === 'house') {
        kind = 'res';
        level = Math.min(rawLevel, RES_LEVELS.length);
      }
      if (!KINDS.includes(kind)) continue;
      if (i >= 0 && i < c.tiles.length && !c.tiles[i]) c.tiles[i] = { kind, level, facing, variant };
    }
    c.refresh();
    return c;
  }
}
