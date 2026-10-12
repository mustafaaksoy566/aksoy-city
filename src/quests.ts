import { MATERIALS, MAT_IDS, SERVICES, SERVICE_KINDS, TOOL_INFO, type MatId, type ServiceKind } from './config';
import type { City } from './city';

// Görevler: aynı anda 3 tane. Bitince ödül alınır ve yerine yenisi gelir.
export type QuestType = 'pop' | 'produce' | 'upgrade' | 'build' | 'houses' | 'service' | 'stock' | 'tax' | 'ship';
export interface Quest {
  type: QuestType;
  target: number;
  base: number; // sayaç tipindeki görevlerde başlangıç değeri
  mat?: MatId;
  level?: number;
  service?: ServiceKind;
  money: number;
  xp: number;
}

// Şehrin tuttuğu sayaçlar (görevler için)
export interface CityStats {
  produced: Partial<Record<MatId, number>>;
  upgrades: number;
  builds: number;
  taxes: number;
  ships: number; // komşu şehirlere gönderilen siparişler
}
export const emptyStats = (): CityStats => ({ produced: {}, upgrades: 0, builds: 0, taxes: 0, ships: 0 });

const counter = (city: City, q: Quest) => {
  if (q.type === 'produce') return city.stats.produced[q.mat!] ?? 0;
  if (q.type === 'upgrade') return city.stats.upgrades;
  if (q.type === 'build') return city.stats.builds;
  if (q.type === 'tax') return city.stats.taxes;
  if (q.type === 'ship') return city.stats.ships ?? 0;
  return 0;
};

export function questProgress(city: City, q: Quest): number {
  switch (q.type) {
    case 'pop':
      return city.population;
    case 'houses':
      return city.tiles.filter(t => t?.kind === 'res' && t.level >= q.level!).length;
    case 'service':
      return city.tiles.some(t => t?.kind === q.service) ? 1 : 0;
    case 'stock':
      return city.storage[q.mat!];
    default:
      return counter(city, q) - q.base;
  }
}

export const questDone = (city: City, q: Quest) => questProgress(city, q) >= q.target;

export function questText(q: Quest): string {
  const fmt = (n: number) => n.toLocaleString('tr-TR');
  switch (q.type) {
    case 'pop':
      return `👥 Nüfusu ${fmt(q.target)} yap`;
    case 'produce':
      return `${MATERIALS[q.mat!].icon} ${q.target} ${MATERIALS[q.mat!].name.toLocaleLowerCase('tr-TR')} üret`;
    case 'upgrade':
      return `⬆️ ${q.target} binayı yükselt`;
    case 'build':
      return `🏗️ ${q.target} yeni bina yapılsın`;
    case 'houses':
      return `🏠 ${q.target} evi ${q.level}. seviyeye çıkar`;
    case 'service':
      return `${TOOL_INFO[q.service!].icon} Bir ${SERVICES[q.service!].name.toLocaleLowerCase('tr-TR')} binası kur`;
    case 'stock':
      return `📦 Depoda ${q.target} ${MATERIALS[q.mat!].name.toLocaleLowerCase('tr-TR')} biriktir`;
    case 'tax':
      return `🏛️ Belediyeden ${fmt(q.target)} vergi topla`;
    case 'ship':
      return `🚢 Komşu şehirlere ${q.target} sipariş gönder`;
  }
}

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

// Şehrin seviyesine uygun yeni bir görev üret (aynı türden iki görev olmasın)
export function newQuest(city: City, existing: Quest[]): Quest {
  const lvl = city.level;
  const used = new Set(existing.map(q => q.type));
  const mats = MAT_IDS.filter(m => city.isUnlocked(m));
  const reward = (difficulty: number) => ({
    money: Math.round((80 + 60 * lvl) * difficulty / 10) * 10,
    xp: Math.round((8 + 4 * lvl) * difficulty),
  });
  const options: (() => Quest | null)[] = [
    () => {
      const target = Math.max(50, Math.ceil((city.population * 1.25 + 30) / 10) * 10);
      return { type: 'pop', target, base: 0, ...reward(1.4) };
    },
    () => {
      const mat = pick(mats);
      const target = MATERIALS[mat].maker === 'factory' ? 4 + lvl : 2 + Math.floor(lvl / 2);
      return { type: 'produce', mat, target, base: city.stats.produced[mat] ?? 0, ...reward(1) };
    },
    () => ({ type: 'upgrade', target: 2 + Math.floor(lvl / 2), base: city.stats.upgrades, ...reward(1.2) }),
    () => ({ type: 'build', target: 3 + lvl, base: city.stats.builds, ...reward(0.9) }),
    () => {
      const level = Math.min(5, 2 + Math.floor(Math.random() * Math.min(4, lvl)));
      const have = city.tiles.filter(t => t?.kind === 'res' && t.level >= level).length;
      return { type: 'houses', level, target: have + 2, base: 0, ...reward(1.1 + level * 0.2) };
    },
    () => {
      const missing = SERVICE_KINDS.filter(k => city.isUnlocked(k) && !city.tiles.some(t => t?.kind === k));
      return missing.length ? { type: 'service', service: pick(missing), target: 1, base: 0, ...reward(1.3) } : null;
    },
    () => {
      const mat = pick(mats);
      return { type: 'stock', mat, target: 3 + Math.floor(lvl / 2), base: 0, ...reward(0.8) };
    },
    () => (city.tiles.some(t => t?.kind === 'port') ? { type: 'ship', target: 1 + Math.floor(lvl / 5), base: city.stats.ships ?? 0, ...reward(1.4) } : null),
    () => ({ type: 'tax', target: Math.max(100, Math.round((city.dailyIncome * 12 + 100) / 50) * 50), base: city.stats.taxes, ...reward(1) }),
  ];
  for (let tries = 0; tries < 30; tries++) {
    const q = pick(options)();
    if (q && !used.has(q.type) && !questDone(city, q)) return q;
  }
  return { type: 'build', target: 3, base: city.stats.builds, ...reward(1) };
}
