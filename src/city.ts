import {
  SIZE, START_MONEY, ENTRANCE_Z, ENTRANCE_LEN, COST, RES_LEVELS, COM_LEVELS, RES_BASE_MAX, PARK_RADIUS,
  SHOP_RADIUS, POP_PER_COM_LEVEL, JOBS_PER_PERSON, BUILD_CHANCE, GROW_CHANCE, PARK_MODELS, TAX_PER_PERSON,
  TAX_PER_JOB, type BuildTool,
} from './config';

export type Kind = 'road' | 'res' | 'com' | 'park';
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
const isZone = (k: Kind | undefined) => k === 'res' || k === 'com';

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

export class City {
  tiles: (Tile | null)[] = new Array(SIZE * SIZE).fill(null);
  money = START_MONEY;
  day = 1;
  private reach = new Set<number>(); // girişe bağlı yol kareleri

  constructor() {
    for (let x = 0; x < ENTRANCE_LEN; x++) {
      this.tiles[idx(x, ENTRANCE_Z)] = { kind: 'road', level: 0, facing: 0, variant: 0, locked: true };
    }
    this.updateReach();
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

  // Girişten başlayıp birbirine değen bütün yolları bul
  updateReach() {
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

  // Bu karenin yanında girişe bağlı bir yol var mı?
  isConnected(i: number) {
    const x = i % SIZE, z = Math.floor(i / SIZE);
    return DIRS.some(([dx, dz]) => inBounds(x + dx, z + dz) && this.reach.has(idx(x + dx, z + dz)));
  }

  private sumOf(kind: Kind, value: (level: number) => number) {
    let sum = 0;
    this.tiles.forEach((t, i) => {
      if (t?.kind === kind && t.level > 0 && this.isConnected(i)) sum += value(t.level);
    });
    return sum;
  }

  get population() {
    return this.sumOf('res', l => RES_LEVELS[l - 1].pop);
  }

  get jobs() {
    return this.sumOf('com', l => COM_LEVELS[l - 1].jobs);
  }

  get dailyIncome() {
    return Math.round(this.population * TAX_PER_PERSON + this.jobs * TAX_PER_JOB);
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

  maxLevel(i: number) {
    const t = this.tiles[i]!;
    const x = i % SIZE, z = Math.floor(i / SIZE);
    if (t.kind === 'res') {
      let max = RES_BASE_MAX;
      if (this.near(x, z, PARK_RADIUS, n => n.kind === 'park')) max++;
      if (this.near(x, z, SHOP_RADIUS, n => n.kind === 'com' && n.level > 0)) max++;
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
    if ((tool === 'res' || tool === 'com') && this.roadMask(x, z) === 0) return 'Bölgeler yol kenarına çizilmeli';
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
        this.tiles[i] = { kind: tool, level: 0, facing: 0, variant };
        if (tool === 'park') this.tiles[i]!.variant = variant % PARK_MODELS.length;
      }
    }
    this.money -= cost;
    this.updateReach();
    return { done: ok, error: null };
  }

  // Bir gün geçer: vergi toplanır, arsalara bina yapılır, binalar büyür
  nextDay(): { income: number; changed: number[] } {
    this.day++;
    const income = this.dailyIncome;
    this.money += income;

    const changed: number[] = [];
    let jobRoom = this.population * JOBS_PER_PERSON - this.jobs;
    this.tiles.forEach((t, i) => {
      if (!t || !isZone(t.kind) || !this.isConnected(i)) return;
      if (t.level >= this.maxLevel(i)) return;
      if (Math.random() >= (t.level === 0 ? BUILD_CHANCE : GROW_CHANCE)) return;
      if (t.kind === 'com') {
        // Dükkanlar ancak çalışacak insan varsa açılır
        const extra = COM_LEVELS[t.level].jobs - (t.level ? COM_LEVELS[t.level - 1].jobs : 0);
        if (extra > jobRoom) return;
        jobRoom -= extra;
      }
      t.level++;
      t.facing = this.facingFor(i);
      t.variant = Math.floor(Math.random() * 1000);
      changed.push(i);
    });
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
      if (!['road', 'res', 'com', 'park'].includes(kind)) continue;
      if (i >= 0 && i < c.tiles.length && !c.tiles[i]) c.tiles[i] = { kind, level, facing, variant };
    }
    c.updateReach();
    return c;
  }
}
