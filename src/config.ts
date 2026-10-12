// Oyunun ayarları: fiyatlar, harita boyutu, bina seviyeleri
export const SIZE = 32; // harita SIZE x SIZE kare
export const DAY_SECONDS = 4; // bir oyun günü kaç saniye sürer
export const START_MONEY = 3000;
export const TAX_PER_PERSON = 1; // kişi başı günlük vergi

// Şehir girişi: haritanın sol kenarından giren, yıkılamayan yol
export const ENTRANCE_Z = SIZE / 2;
export const ENTRANCE_LEN = 3;

export type BuildTool = 'road' | 'house' | 'park' | 'bulldoze';
export type Tool = 'pan' | BuildTool;

export const COST: Record<BuildTool, number> = { road: 10, house: 100, park: 60, bulldoze: 0 };

export const TOOLS: { id: Tool; icon: string; label: string; hint: string }[] = [
  { id: 'pan', icon: '✋', label: 'Gez', hint: 'Haritayı parmağınla kaydır, iki parmakla yakınlaştır.' },
  { id: 'road', icon: '🛣️', label: 'Yol', hint: 'Yol çizmek için parmağını sürükle. Kaydırmak için iki parmak kullan.' },
  { id: 'house', icon: '🏠', label: 'Konut', hint: 'Yol kenarına dokun ya da bir alan sürükle.' },
  { id: 'park', icon: '🌳', label: 'Park', hint: 'Parkların yakınındaki evler daha çok büyür.' },
  { id: 'bulldoze', icon: '🚜', label: 'Yık', hint: 'Yıkmak istediğin alanı sürükle.' },
];

// Konut seviyeleri: her seviyede bina büyür, nüfus artar
export const HOUSE_LEVELS = [
  { model: 'building-small-a', pop: 6 },
  { model: 'building-small-d', pop: 10 },
  { model: 'building-small-b', pop: 16 },
  { model: 'building-small-c', pop: 24 },
];
export const BASE_MAX_LEVEL = 2; // park yoksa evler en fazla bu seviyeye çıkar
export const PARK_RADIUS = 3; // park bu kadar kare yakındaysa +1 seviye
export const GROW_CHANCE = 0.2; // her gün bir evin büyüme şansı

export const PARK_MODELS = ['grass-trees', 'grass-trees-tall', 'pavement-fountain'];

export const ROAD_MODELS = ['road-straight', 'road-straight-lightposts', 'road-corner', 'road-split', 'road-intersection'];
export const ALL_MODELS = [...ROAD_MODELS, ...HOUSE_LEVELS.map(l => l.model), ...PARK_MODELS];
