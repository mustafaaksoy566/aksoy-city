// Oyunun ayarları: fiyatlar, harita boyutu, bina seviyeleri
export const SIZE = 32; // harita SIZE x SIZE kare
export const DAY_SECONDS = 4; // bir oyun günü kaç saniye sürer
export const START_MONEY = 3000;
export const TAX_PER_PERSON = 0.3; // kişi başı günlük vergi
export const TAX_PER_JOB = 0.3; // iş yeri başına günlük vergi

// Şehir girişi: haritanın sol kenarından giren, yıkılamayan yol
export const ENTRANCE_Z = SIZE / 2;
export const ENTRANCE_LEN = 3;

export type BuildTool = 'road' | 'res' | 'com' | 'park' | 'bulldoze';
export type Tool = 'pan' | BuildTool;

export const COST: Record<BuildTool, number> = { road: 10, res: 20, com: 30, park: 60, bulldoze: 0 };

export const TOOLS: { id: Tool; icon: string; label: string; hint: string }[] = [
  { id: 'pan', icon: '✋', label: 'Gez', hint: 'Haritayı parmağınla kaydır, iki parmakla yakınlaştır.' },
  { id: 'road', icon: '🛣️', label: 'Yol', hint: 'Yol çizmek için parmağını sürükle. Kaydırmak için iki parmak kullan.' },
  { id: 'res', icon: '🏠', label: 'Konut', hint: 'Yol kenarına konut bölgesi çiz, evler kendiliğinden yapılır.' },
  { id: 'com', icon: '🏪', label: 'Ticaret', hint: 'Dükkanlar ve ofisler nüfus arttıkça gelişir.' },
  { id: 'park', icon: '🌳', label: 'Park', hint: 'Parkların yakınındaki evler daha çok büyür.' },
  { id: 'bulldoze', icon: '🚜', label: 'Yık', hint: 'Yıkmak istediğin alanı sürükle.' },
];

// Kenney başlangıç paketi (k/) ve Poly Pizza'dan gelen ticari binalar (c/)
const k = (n: string) => `kenney/models/${n}`;
const c = (n: string) => `polypizza/city/${n}`;

// Konut seviyeleri: her seviyede bina büyür, nüfus artar
export const RES_LEVELS = [
  { pop: 6, models: [k('building-small-a'), k('building-small-d'), c('small-building-3')] },
  { pop: 14, models: [k('building-small-b'), k('building-small-c'), c('small-building-1'), c('small-building-2'), c('small-building-4'), c('small-building-6')] },
  { pop: 30, models: [c('large-building-1'), c('large-building-3'), c('large-building-5'), c('low-wide-1'), c('low-wide-2')] },
  { pop: 60, models: [c('skyscraper-3'), c('skyscraper-6'), c('large-building-4')] },
];

// Ticaret seviyeleri: iş yeri sağlar, nüfus büyüdükçe yükselir
export const COM_LEVELS = [
  { jobs: 5, models: [c('low-wide-1'), c('low-wide-2'), k('building-garage')] },
  { jobs: 15, models: [c('low-building-1'), c('low-building-2'), c('low-building-3'), c('low-building-4'), c('low-building-5')] },
  { jobs: 40, models: [c('skyscraper-1'), c('skyscraper-2'), c('skyscraper-4'), c('skyscraper-5'), c('low-building-6'), c('low-building-7')] },
];

export const RES_BASE_MAX = 2; // park ve dükkan yoksa evler en fazla bu seviyeye çıkar
export const PARK_RADIUS = 3; // park bu kadar kare yakındaysa +1 seviye
export const SHOP_RADIUS = 4; // dükkan bu kadar kare yakındaysa +1 seviye
export const POP_PER_COM_LEVEL = 150; // ticaret her bu kadar nüfusta bir seviye daha çıkabilir
export const JOBS_PER_PERSON = 0.5; // iş yeri sayısı nüfusun yarısını geçmesin
export const BUILD_CHANCE = 0.35; // boş arsaya bir günde bina yapılma şansı
export const GROW_CHANCE = 0.08; // bir binanın bir günde büyüme şansı

export const PARK_MODELS = [k('grass-trees'), k('grass-trees-tall'), k('pavement-fountain')];
export const PAVEMENT = k('pavement');

export const ROAD_MODELS = ['road-straight', 'road-straight-lightposts', 'road-corner', 'road-split', 'road-intersection'].map(k);

export const CAR_MODELS = ['car-1', 'car-2', 'suv', 'sports-1', 'sports-2', 'taxi', 'police', 'truck', 'pickup'].map(
  n => `polypizza/cars/${n}`,
);

// Ticari binaların duvar renkleri (her bina rastgele birini alır)
export const WALL_COLORS = ['#f3e3c3', '#f2b88b', '#e98b6d', '#9fd3ea', '#c7e3a4', '#f6d77c', '#ececec', '#c5b3e6', '#f5a9a0', '#b9d4c8'];

export const ALL_MODELS = [
  ...new Set([
    ...ROAD_MODELS,
    ...RES_LEVELS.flatMap(l => l.models),
    ...COM_LEVELS.flatMap(l => l.models),
    ...PARK_MODELS,
    PAVEMENT,
    ...CAR_MODELS,
  ]),
];
