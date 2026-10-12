// Oyunun ayarları: fiyatlar, harita boyutu, bina seviyeleri
export const SIZE = 48; // harita SIZE x SIZE kare

// Arazi: harita 8x8'lik parçalara bölünür. Başta ortadaki 32x32 alan senindir, gerisi satın alınır.
export const PLOT = 8;
export const PLOTS = SIZE / PLOT; // bir kenarda kaç parça var
export const START_PLOT_MIN = 1; // başta sahip olunan parçalar: 1..4 (her iki yönde)
export const START_PLOT_MAX = 4;
export const OLD_SIZE = 32; // eski kayıtlar 32x32 haritadaydı
export const LAND = { price: 1500, step: 750, level: 3 }; // her yeni parça bir öncekinden pahalı
export const DAY_SECONDS = 4; // bir oyun günü kaç saniye sürer
export const START_MONEY = 3000;
export const TAX_PER_PERSON = 0.5; // kişi başı günlük vergi
export const TAX_PER_JOB = 0.5; // iş yeri başına günlük vergi

// Şehir girişi: haritanın sol kenarından giren, yıkılamayan yol (satın alınmamış arazinin içinden geçer)
export const ENTRANCE_Z = SIZE / 2;
export const ENTRANCE_LEN = PLOT * START_PLOT_MIN + 3;

// Elektrik ve su yapıları
export type UtilKind = 'wind' | 'plant' | 'tower' | 'pump';
export const UTILITIES: Record<UtilKind, { power: number; water: number; upkeep: number }> = {
  wind: { power: 12, water: 0, upkeep: 2 },
  plant: { power: 80, water: 0, upkeep: 10 },
  tower: { power: 0, water: 12, upkeep: 2 },
  pump: { power: 0, water: 80, upkeep: 8 },
};
export const UTIL_KINDS = Object.keys(UTILITIES) as UtilKind[];

// Hizmet binaları: çevrelerindeki kareleri kapsar. Evler 5. seviyeye çıkmak için dördüne de muhtaç.
export type ServiceKind = 'police' | 'fire' | 'health' | 'school';
export const SERVICES: Record<ServiceKind, { radius: number; upkeep: number; color: string; name: string }> = {
  police: { radius: 6, upkeep: 6, color: '#3b6fd8', name: 'Polis' },
  fire: { radius: 6, upkeep: 6, color: '#e53935', name: 'İtfaiye' },
  health: { radius: 7, upkeep: 10, color: '#ec407a', name: 'Hastane' },
  school: { radius: 6, upkeep: 8, color: '#ffa000', name: 'Okul' },
};
export const SERVICE_KINDS = Object.keys(SERVICES) as ServiceKind[];

// Sanayi: fabrika ham madde üretir, hırdavatçı onlardan ürün yapar, depo saklama yerini büyütür
export type IndustryKind = 'factory' | 'store' | 'depot';
export const INDUSTRY: Record<IndustryKind, { upkeep: number }> = {
  factory: { upkeep: 2 },
  store: { upkeep: 2 },
  depot: { upkeep: 1 },
};
export const INDUSTRY_KINDS = Object.keys(INDUSTRY) as IndustryKind[];
export const FACTORY_SLOTS = 2; // bir fabrika aynı anda kaç şey üretir
export const STORE_QUEUE = 3; // hırdavatçıda sıraya kaç ürün konabilir
export const BASE_STORAGE = 20; // depo yokken saklanabilecek malzeme
export const DEPOT_STORAGE = 40; // her depo bu kadar yer ekler

// Malzemeler: fabrikada ham madde, hırdavatçıda ürün. Süreler gerçek saniye (oyun kapalıyken de işler).
export type MatId = 'metal' | 'wood' | 'plastic' | 'mineral' | 'nails' | 'hammer' | 'paint' | 'brick';
export interface Material {
  name: string;
  icon: string;
  seconds: number;
  maker: 'factory' | 'store';
  needs?: Partial<Record<MatId, number>>;
  unlock: number; // hangi şehir seviyesinde açılır
}
export const MATERIALS: Record<MatId, Material> = {
  metal: { name: 'Metal', icon: '🔩', seconds: 10, maker: 'factory', unlock: 1 },
  wood: { name: 'Odun', icon: '🪵', seconds: 20, maker: 'factory', unlock: 1 },
  plastic: { name: 'Plastik', icon: '🧴', seconds: 30, maker: 'factory', unlock: 3 },
  mineral: { name: 'Mineral', icon: '🪨', seconds: 40, maker: 'factory', unlock: 5 },
  nails: { name: 'Çivi', icon: '📌', seconds: 30, maker: 'store', needs: { metal: 2 }, unlock: 3 },
  hammer: { name: 'Çekiç', icon: '🔨', seconds: 45, maker: 'store', needs: { metal: 1, wood: 1 }, unlock: 3 },
  paint: { name: 'Boya', icon: '🎨', seconds: 60, maker: 'store', needs: { plastic: 2 }, unlock: 4 },
  brick: { name: 'Tuğla', icon: '🧱', seconds: 60, maker: 'store', needs: { mineral: 2 }, unlock: 5 },
};
export const MAT_IDS = Object.keys(MATERIALS) as MatId[];

// Konutu bir üst seviyeye çıkarmak için gereken malzemeler (indeks = hedef seviye)
export const UPGRADE_COST: Partial<Record<MatId, number>>[] = [
  {},
  {},
  { metal: 2, wood: 1 },
  { nails: 2, wood: 2 },
  { nails: 2, hammer: 2, plastic: 1 },
  { hammer: 2, paint: 2, brick: 2 },
];

// Deneyim puanı (XP) ve şehir seviyesi
export const XP = {
  build: 5, // arsaya ilk bina yapılınca
  upgrade: [0, 0, 15, 30, 50, 80], // konut bu seviyeye yükselince
  raw: 1, // fabrikada bir ham madde üretilince
  crafted: 3, // hırdavatçıda bir ürün yapılınca
};
// Seviye n için gereken toplam XP: LEVEL_XP[n - 1]
export const LEVEL_XP = [0, 40, 120, 250, 450, 750, 1150, 1700, 2400, 3300, 4500];
export const LEVEL_REWARD = 250; // her seviye atlayınca (seviye x bu kadar) para

// Mutluluk: her evin mutluluğu 0..1 arası. Vergi çarpanı = 0.5 + mutluluk (yani x0.5 ile x1.5 arası)
export const HAPPY = {
  base: 0.35,
  service: 0.1, // kapsayan her hizmet için
  park: 0.15,
  shop: 0.1,
  pollution: -0.3, // yakında fabrika ya da santral varsa
};
export const POLLUTION_RADIUS = 3;

// Felaketler ve olaylar
export const FIRE = { chance: 0.05, days: 4, cost: 150 }; // itfaiye kapsamayan evlerde yangın
export const CRIME = { chance: 0.06, minPop: 60 }; // polis kapsamayan mahallelerde hırsızlık
export const QUAKE = { chance: 0.006, minLevel: 4, damaged: 2, repair: { metal: 2, wood: 1 } as Partial<Record<MatId, number>> };

// Simge yapılar: çevrelerindeki evlerin mutluluğunu artırır
export type DecorKind = 'fountain' | 'statue' | 'wheel' | 'stadium';
export const DECOR: Record<DecorKind, { radius: number; happy: number; upkeep: number }> = {
  fountain: { radius: 4, happy: 0.1, upkeep: 1 },
  statue: { radius: 5, happy: 0.12, upkeep: 1 },
  wheel: { radius: 7, happy: 0.18, upkeep: 6 },
  stadium: { radius: 9, happy: 0.22, upkeep: 12 },
};
export const DECOR_KINDS = Object.keys(DECOR) as DecorKind[];
export const DECOR_MAX = 0.3; // simgelerden gelen toplam mutluluk en fazla bu kadar

export type BuildTool = 'road' | 'res' | 'com' | 'park' | UtilKind | ServiceKind | IndustryKind | DecorKind | 'bulldoze';
export type Tool = 'pan' | BuildTool;

export const COST: Record<BuildTool, number> = {
  road: 10, res: 20, com: 30, park: 60, bulldoze: 0,
  wind: 300, plant: 1500, tower: 250, pump: 1200,
  police: 500, fire: 500, health: 800, school: 600,
  factory: 400, store: 600, depot: 300,
  fountain: 600, statue: 900, wheel: 2500, stadium: 5000,
};

// Hangi araç hangi şehir seviyesinde açılır (yazmayanlar baştan açık)
export const UNLOCK: Partial<Record<BuildTool, number>> = {
  com: 2, depot: 2, police: 2,
  store: 3, fire: 3,
  health: 4, plant: 4,
  school: 5, pump: 5,
  fountain: 2, statue: 3, wheel: 5, stadium: 6,
};

export const TOOL_INFO: Record<Tool, { icon: string; label: string; hint: string }> = {
  pan: { icon: '✋', label: 'Gez', hint: 'Haritayı parmağınla kaydır, iki parmakla yakınlaştır.' },
  road: { icon: '🛣️', label: 'Yol', hint: 'Yol çizmek için parmağını sürükle. Kaydırmak için iki parmak kullan.' },
  res: { icon: '🏠', label: 'Konut', hint: 'Yol kenarına konut bölgesi çiz, evler kendiliğinden yapılır.' },
  com: { icon: '🏪', label: 'Ticaret', hint: 'Dükkanlar ve ofisler nüfus arttıkça gelişir.' },
  park: { icon: '🌳', label: 'Park', hint: 'Parkların yakınındaki evler daha çok büyür.' },
  bulldoze: { icon: '🚜', label: 'Yık', hint: 'Yıkmak istediğin alanı sürükle.' },
  wind: { icon: '🌬️', label: 'Türbin', hint: 'Rüzgar türbini: az elektrik, ucuz. Yol kenarına kur.' },
  plant: { icon: '🔌', label: 'Santral', hint: 'Elektrik santrali: çok elektrik üretir ama pahalı.' },
  tower: { icon: '💧', label: 'Su kulesi', hint: 'Su kulesi: az su, ucuz. Yol kenarına kur.' },
  pump: { icon: '🚰', label: 'Su pompası', hint: 'Su pompası: çok su verir ama pahalı.' },
  police: { icon: '🚓', label: 'Polis', hint: 'Polis merkezi renkli alandaki evleri korur.' },
  fire: { icon: '🚒', label: 'İtfaiye', hint: 'İtfaiye renkli alandaki evleri yangından korur.' },
  health: { icon: '🏥', label: 'Hastane', hint: 'Hastane renkli alandaki evlere sağlık hizmeti verir.' },
  school: { icon: '🏫', label: 'Okul', hint: 'Okul renkli alandaki çocuklara eğitim verir.' },
  factory: { icon: '🏭', label: 'Fabrika', hint: 'Fabrika metal ve odun üretir. Dokunup üretim başlat.' },
  store: { icon: '🔨', label: 'Hırdavatçı', hint: 'Hırdavatçı metal ve odundan çivi, çekiç gibi ürünler yapar.' },
  depot: { icon: '📦', label: 'Depo', hint: 'Her depo malzeme saklama yerini 40 artırır.' },
  fountain: { icon: '⛲', label: 'Çeşme', hint: 'Meydan çeşmesi: çevresindeki evleri mutlu eder.' },
  statue: { icon: '🗿', label: 'Heykel', hint: 'Atlı heykel: çevresindeki evleri mutlu eder.' },
  wheel: { icon: '🎡', label: 'Dönme dolap', hint: 'Dönme dolap: geniş bir alanı çok mutlu eder.' },
  stadium: { icon: '🏟️', label: 'Stadyum', hint: 'Stadyum: şehrin büyük bir kısmını çok mutlu eder.' },
};
export const HALL_INFO = { icon: '🏛️', label: 'Belediye' };

// Alt çubuk: tek araçlar ve açılır gruplar
export type ToolbarItem = Tool | { group: string; icon: string; label: string; tools: Tool[] };
// "Gez" düğmesi yok: seçili araca tekrar basınca araç bırakılır ve harita kaydırılır.
export const TOOLBAR: ToolbarItem[] = [
  'road',
  { group: 'zones', icon: '🏘️', label: 'Bölge', tools: ['res', 'com'] },
  { group: 'industry', icon: '🏭', label: 'Sanayi', tools: ['factory', 'store', 'depot'] },
  { group: 'utils', icon: '⚡', label: 'Altyapı', tools: ['wind', 'plant', 'tower', 'pump'] },
  { group: 'services', icon: '🏛️', label: 'Hizmet', tools: ['police', 'fire', 'health', 'school'] },
  { group: 'decor', icon: '🎡', label: 'Simge', tools: ['park', 'fountain', 'statue', 'wheel', 'stadium'] },
  'bulldoze',
];

// Modeller: KayKit City Builder Bits (kk/), Kenney City Kit 2.1 gökdelenleri (k2/), Kenney başlangıç paketi (k/)
const k = (n: string) => `kenney/models/${n}`;
const kk = (n: string) => `kaykit/${n}`;
const k2 = (n: string) => `kenney2/${n}`;
const x = (n: string) => `polypizza/extra/${n}`;

// Konut seviyeleri: her seviyede bina büyür, nüfus ve elektrik/su ihtiyacı artar
export const RES_LEVELS = [
  { pop: 6, need: 1, models: [kk('building_A'), kk('building_B')] },
  { pop: 14, need: 2, models: [kk('building_E'), kk('building_F')] },
  { pop: 30, need: 4, models: [kk('building_C'), kk('building_D'), kk('building_G'), kk('building_H')] },
  { pop: 60, need: 7, models: [k2('building-skyscraper-a'), k2('building-skyscraper-b')] },
  { pop: 100, need: 12, models: [k2('building-skyscraper-c'), k2('building-skyscraper-d'), k2('building-skyscraper-e')] },
];

// Ticaret seviyeleri: iş yeri sağlar, nüfus büyüdükçe yükselir
export const COM_LEVELS = [
  { jobs: 5, need: 1, models: [kk('building_A'), kk('building_B'), kk('building_E')] },
  { jobs: 15, need: 3, models: [kk('building_F'), kk('building_C'), kk('building_G')] },
  { jobs: 40, need: 6, models: [k2('building-skyscraper-a'), k2('building-skyscraper-c'), k2('building-skyscraper-e')] },
];

export const RES_BASE_MAX = 2; // park ve dükkan yoksa evler en fazla bu seviyeye çıkar
// park +1, dükkan +1 seviye; dört hizmetin hepsi kapsıyorsa bir seviye daha (5. seviye)
export const PARK_RADIUS = 3; // park bu kadar kare yakındaysa +1 seviye
export const SHOP_RADIUS = 4; // dükkan bu kadar kare yakındaysa +1 seviye
export const POP_PER_COM_LEVEL = 150; // ticaret her bu kadar nüfusta bir seviye daha çıkabilir
export const JOBS_PER_PERSON = 0.5; // iş yeri sayısı nüfusun yarısını geçmesin
export const BUILD_CHANCE = 0.35; // boş arsaya bir günde bina yapılma şansı
export const GROW_CHANCE = 0.08; // bir binanın bir günde büyüme şansı

export const PARK_MODELS = [k('grass-trees'), k('grass-trees-tall'), k('pavement-fountain')];
export const BASE = kk('base'); // KayKit kaldırım karesi

export const ROAD_MODELS = ['road_straight', 'road_straight_crossing', 'road_corner_curved', 'road_tsplit', 'road_junction'].map(kk);

export const CAR_MODELS = ['car_sedan', 'car_taxi', 'car_hatchback', 'car_stationwagon', 'car_police'].map(kk);

// Şehri dolduran süs eşyaları ve ağaçlar
export const PROPS = {
  streetlight: kk('streetlight'),
  traffic: kk('trafficlight_B'),
  hydrant: kk('firehydrant'),
  bench: kk('bench'),
  bush: kk('bush'),
  trash: kk('trash_A'),
  boxA: kk('box_A'),
  boxB: kk('box_B'),
  watertower: kk('watertower'),
  treeLarge: 'kenney-sub/tree-large',
  treeSmall: 'kenney-sub/tree-small',
};

export const DECOR_MODELS: Partial<Record<DecorKind, string>> = { fountain: x('q-town-center-1'), statue: x('q-horse-statue') };

export const ALL_MODELS = [
  ...new Set([
    ...ROAD_MODELS,
    ...RES_LEVELS.flatMap(l => l.models),
    ...COM_LEVELS.flatMap(l => l.models),
    ...PARK_MODELS,
    BASE,
    ...CAR_MODELS,
    ...Object.values(PROPS),
    ...(Object.values(DECOR_MODELS) as string[]),
  ]),
];
