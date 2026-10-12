import {
  SIZE, START_MONEY, ENTRANCE_Z, ENTRANCE_LEN, COST, HOUSE_LEVELS, BASE_MAX_LEVEL,
  PARK_RADIUS, GROW_CHANCE, PARK_MODELS, TAX_PER_PERSON, type BuildTool,
} from './config';

export type Kind = 'road' | 'house' | 'park';
export interface Tile {
  kind: Kind;
  level: number; // konut seviyesi (1..4)
  facing: number; // konutun kapısının baktığı yön
  variant: number; // park çeşidi
  locked?: boolean;
}

// Yönler: 0 kuzey (-z), 1 doğu (+x), 2 güney (+z), 3 batı (-x)
export const DIRS: readonly [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export const idx = (x: number, z: number) => z * SIZE + x;
export const inBounds = (x: number, z: number) => x >= 0 && z >= 0 && x < SIZE && z < SIZE;

export interface SaveData {
  v: 1;
  money: number;
  day: number;
  t: [number, Kind, number, number, number][];
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

  // Konutun yanında girişe bağlı bir yol var mı?
  isConnected(i: number) {
    const x = i % SIZE, z = Math.floor(i / SIZE);
    return DIRS.some(([dx, dz]) => inBounds(x + dx, z + dz) && this.reach.has(idx(x + dx, z + dz)));
  }

  get population() {
    let pop = 0;
    this.tiles.forEach((t, i) => {
      if (t?.kind === 'house' && this.isConnected(i)) pop += HOUSE_LEVELS[t.level - 1].pop;
    });
    return pop;
  }

  get dailyIncome() {
    return Math.round(this.population * TAX_PER_PERSON);
  }

  maxLevel(x: number, z: number) {
    for (let dz = -PARK_RADIUS; dz <= PARK_RADIUS; dz++) {
      for (let dx = -PARK_RADIUS; dx <= PARK_RADIUS; dx++) {
        if (this.get(x + dx, z + dz)?.kind === 'park') return BASE_MAX_LEVEL + 1;
      }
    }
    return BASE_MAX_LEVEL;
  }

  // null: buraya yapılabilir, metin: neden yapılamadığı
  check(tool: BuildTool, x: number, z: number): string | null {
    const t = this.get(x, z);
    if (tool === 'bulldoze') {
      if (!t) return 'Burada yıkılacak bir şey yok';
      return t.locked ? 'Şehir girişi yıkılamaz' : null;
    }
    if (t) return 'Burası dolu';
    if (tool === 'house' && this.roadMask(x, z) === 0) return 'Konutlar yol kenarına kurulmalı';
    return null;
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
      const x = i % SIZE, z = Math.floor(i / SIZE);
      if (tool === 'bulldoze') this.tiles[i] = null;
      else if (tool === 'road') this.tiles[i] = { kind: 'road', level: 0, facing: 0, variant: 0 };
      else if (tool === 'park') {
        this.tiles[i] = { kind: 'park', level: 0, facing: 0, variant: Math.floor(Math.random() * PARK_MODELS.length) };
      } else {
        // Kapı yola baksın; mümkünse kameraya dönük (güney) taraf seçilsin
        const m = this.roadMask(x, z);
        const facing = [2, 1, 3, 0].find(d => m & (1 << d)) ?? 2;
        this.tiles[i] = { kind: 'house', level: 1, facing, variant: 0 };
      }
    }
    this.money -= cost;
    this.updateReach();
    return { done: ok, error: null };
  }

  // Bir gün geçer: vergi toplanır, bazı evler büyür
  nextDay(): { income: number; grown: number[] } {
    this.day++;
    const income = this.dailyIncome;
    this.money += income;
    const grown: number[] = [];
    this.tiles.forEach((t, i) => {
      if (t?.kind !== 'house' || !this.isConnected(i)) return;
      const x = i % SIZE, z = Math.floor(i / SIZE);
      if (t.level < this.maxLevel(x, z) && Math.random() < GROW_CHANCE) {
        t.level++;
        grown.push(i);
      }
    });
    return { income, grown };
  }

  serialize(): SaveData {
    const t: SaveData['t'] = [];
    this.tiles.forEach((tile, i) => {
      if (tile && !tile.locked) t.push([i, tile.kind, tile.level, tile.facing, tile.variant]);
    });
    return { v: 1, money: this.money, day: this.day, t };
  }

  static load(data: SaveData): City {
    const c = new City();
    c.money = data.money;
    c.day = data.day;
    for (const [i, kind, level, facing, variant] of data.t) {
      if (i >= 0 && i < c.tiles.length && !c.tiles[i]) c.tiles[i] = { kind, level, facing, variant };
    }
    c.updateReach();
    return c;
  }
}
