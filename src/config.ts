// Oyunun ayarları: fiyatlar, harita boyutu, bina seviyeleri
export const SIZE = 48; // harita SIZE x SIZE kare

// Arazi: harita 8x8'lik parçalara bölünür. Başta ortadaki 32x32 alan senindir, gerisi satın alınır.
export const PLOT = 8;
export const PLOTS = SIZE / PLOT; // bir kenarda kaç parça var
export const START_PLOT_MIN = 1; // başta sahip olunan parçalar: 1..4 (her iki yönde)
export const START_PLOT_MAX = 4;
export const OLD_SIZE = 32; // eski kayıtlar 32x32 haritadaydı
export const LAND = { price: 1500, step: 750, level: 3 }; // her yeni parça bir öncekinden pahalı

// Nehir: başlangıç arazisinin doğusundan ve güneyinden geçer, kuzeyde denize dökülür.
// Su üstüne sadece yol ya da ray (köprü) yapılabilir; köprü normalden pahalıdır.
export const RIVER = [SIZE - 7, SIZE - 6]; // nehrin kapladığı iki sıra (x ve z için)
export const BRIDGE_COST = 6; // köprü, normal yol/rayın kaç katı
// Sahil: haritanın kuzey kenarındaki ilk iki sıra deniz, sonraki iki sıra kumsal (kuzeydeki arazilerle satın alınır)
export const SEA_ROWS = 2;
export const SAND_ROWS = 2;
export const DAY_SECONDS = 4; // bir oyun günü kaç saniye sürer
export const START_MONEY = 3000;
export const TAX_PER_PERSON = 0.5; // kişi başı günlük vergi
export const TAX_PER_JOB = 0.5; // iş yeri başına günlük vergi

// Şehir girişi: haritanın sol kenarından giren, yıkılamayan yol (satın alınmamış arazinin içinden geçer)
export const ENTRANCE_Z = SIZE / 2;
export const ENTRANCE_LEN = PLOT * START_PLOT_MIN + 3;

// Elektrik ve su yapıları
export type UtilKind = 'wind' | 'solar' | 'plant' | 'tower' | 'pump';
export const UTILITIES: Record<UtilKind, { power: number; water: number; upkeep: number }> = {
  wind: { power: 12, water: 0, upkeep: 2 },
  solar: { power: 25, water: 0, upkeep: 1 },
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

// Sanayi: fabrika ham madde üretir; hırdavatçı, pazar ve mobilyacı onlardan ürün yapar; depo yer açar
export type IndustryKind = 'factory' | 'store' | 'market' | 'furniture' | 'bakery' | 'fashion' | 'depot' | 'trade' | 'port';
export const INDUSTRY: Record<IndustryKind, { upkeep: number }> = {
  trade: { upkeep: 3 }, // ticaret merkezi: malzeme alıp satılır
  factory: { upkeep: 2 },
  store: { upkeep: 2 },
  market: { upkeep: 3 }, // çiftçi pazarı: tohumdan sebze ve un
  furniture: { upkeep: 4 }, // mobilyacı: sandalye ve koltuk
  bakery: { upkeep: 4 }, // fırın: simit ve pasta
  fashion: { upkeep: 5 }, // giyim mağazası: tişört ve ayakkabı
  depot: { upkeep: 1 },
  port: { upkeep: 12 }, // liman: komşu şehirlere sipariş gönderilir
};
// Ürün yapan dükkanlar (fabrika dışındakiler sırayla üretir)
export type MakerKind = 'factory' | 'store' | 'market' | 'furniture' | 'bakery' | 'fashion';
export const MAKERS: MakerKind[] = ['factory', 'store', 'market', 'furniture', 'bakery', 'fashion'];
export const INDUSTRY_KINDS = Object.keys(INDUSTRY) as IndustryKind[];
export const FACTORY_SLOTS = 2; // bir fabrika aynı anda kaç şey üretir
export const STORE_QUEUE = 3; // hırdavatçıda sıraya kaç ürün konabilir
export const BASE_STORAGE = 20; // depo yokken saklanabilecek malzeme
export const DEPOT_STORAGE = 40; // her depo bu kadar yer ekler

// Malzemeler: fabrikada ham madde, hırdavatçıda ürün. Süreler gerçek saniye (oyun kapalıyken de işler).
export type MatId =
  | 'metal' | 'wood' | 'plastic' | 'mineral' | 'seeds' | 'textile'
  | 'nails' | 'hammer' | 'paint' | 'brick' | 'veggies' | 'flour' | 'chair' | 'sofa'
  | 'simit' | 'cake' | 'shirt' | 'shoes';
export interface Material {
  name: string;
  icon: string;
  seconds: number;
  price: number; // ticaret merkezinde satış fiyatı (alış bunun iki katı)
  maker: MakerKind;
  needs?: Partial<Record<MatId, number>>;
  unlock: number; // hangi şehir seviyesinde açılır
}
export const MATERIALS: Record<MatId, Material> = {
  metal: { name: 'Metal', icon: '🔩', seconds: 10, price: 15, maker: 'factory', unlock: 1 },
  wood: { name: 'Odun', icon: '🪵', seconds: 20, price: 25, maker: 'factory', unlock: 1 },
  plastic: { name: 'Plastik', icon: '🧴', seconds: 30, price: 40, maker: 'factory', unlock: 3 },
  mineral: { name: 'Mineral', icon: '🪨', seconds: 40, price: 55, maker: 'factory', unlock: 5 },
  seeds: { name: 'Tohum', icon: '🌱', seconds: 25, price: 30, maker: 'factory', unlock: 4 },
  textile: { name: 'Kumaş', icon: '🧵', seconds: 50, price: 70, maker: 'factory', unlock: 6 },
  nails: { name: 'Çivi', icon: '📌', seconds: 30, price: 60, maker: 'store', needs: { metal: 2 }, unlock: 3 },
  hammer: { name: 'Çekiç', icon: '🔨', seconds: 45, price: 90, maker: 'store', needs: { metal: 1, wood: 1 }, unlock: 3 },
  paint: { name: 'Boya', icon: '🎨', seconds: 60, price: 110, maker: 'store', needs: { plastic: 2 }, unlock: 4 },
  brick: { name: 'Tuğla', icon: '🧱', seconds: 60, price: 130, maker: 'store', needs: { mineral: 2 }, unlock: 5 },
  veggies: { name: 'Sebze', icon: '🥕', seconds: 40, price: 140, maker: 'market', needs: { seeds: 2 }, unlock: 4 },
  flour: { name: 'Un', icon: '🌾', seconds: 60, price: 230, maker: 'market', needs: { seeds: 2, textile: 1 }, unlock: 6 },
  chair: { name: 'Sandalye', icon: '🪑', seconds: 70, price: 300, maker: 'furniture', needs: { wood: 2, nails: 1, hammer: 1 }, unlock: 6 },
  sofa: { name: 'Koltuk', icon: '🛋️', seconds: 100, price: 450, maker: 'furniture', needs: { textile: 3, wood: 2, nails: 1 }, unlock: 7 },
  simit: { name: 'Simit', icon: '🥯', seconds: 45, price: 320, maker: 'bakery', needs: { flour: 1, seeds: 1 }, unlock: 7 },
  cake: { name: 'Pasta', icon: '🎂', seconds: 90, price: 560, maker: 'bakery', needs: { flour: 2, veggies: 1 }, unlock: 8 },
  shirt: { name: 'Tişört', icon: '👕', seconds: 60, price: 400, maker: 'fashion', needs: { textile: 2, plastic: 1 }, unlock: 8 },
  shoes: { name: 'Ayakkabı', icon: '👟', seconds: 90, price: 600, maker: 'fashion', needs: { textile: 1, plastic: 2, wood: 1 }, unlock: 9 },
};
export const MAT_IDS = Object.keys(MATERIALS) as MatId[];

// Komşu şehirlerden gelen siparişler (limandan gemiyle gönderilir)
export const ORDERS = {
  slots: 3, // aynı anda kaç sipariş
  travel: [45, 90] as [number, number], // gemi kaç saniyede dönüp yeni sipariş getirir
  bonus: 1.6, // sipariş ödülü, malların ticaret merkezi fiyatının bu kadar katı
  neighbors: ['Mavikent', 'Yeşilköy', 'Kuzeyşehir', 'Gölbaşı', 'Sahilkent', 'Dağyaka', 'Altınova', 'Çamlıca'],
};

// Konutu bir üst seviyeye çıkarmak için gereken malzemeler (indeks = hedef seviye)
export const UPGRADE_COST: Partial<Record<MatId, number>>[] = [
  {},
  {},
  { metal: 2, wood: 1 },
  { nails: 2, wood: 2 },
  { nails: 2, hammer: 2, plastic: 1 },
  { hammer: 2, paint: 2, brick: 2 },
  { veggies: 2, chair: 2, sofa: 1 },
];

// Deneyim puanı (XP) ve şehir seviyesi
export const XP = {
  build: 5, // arsaya ilk bina yapılınca
  upgrade: [0, 0, 15, 30, 50, 80, 120], // konut bu seviyeye yükselince
  raw: 1, // fabrikada bir ham madde üretilince
  crafted: 3, // hırdavatçıda bir ürün yapılınca
};
// Seviye n için gereken toplam XP: LEVEL_XP[n - 1]
export const LEVEL_XP = [0, 40, 120, 250, 450, 750, 1150, 1700, 2400, 3300, 4500, 6000, 7800, 10000, 12500, 15500];
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
// covers: bu hizmetin alanını da kapsar (üniversite = okul), income: günlük turist geliri, road: yol kenarına kurulur
export type DecorKind =
  | 'fountain' | 'statue' | 'wheel' | 'stadium' | 'station' | 'busstop' | 'uni' | 'airport' | 'beach' | 'metro'
  | 'clocktower' | 'museum' | 'funfair' | 'lighthouse' | 'marina' | 'mosque';
export interface DecorInfo { radius: number; happy: number; upkeep: number; covers?: ServiceKind; income?: number; road?: boolean }
export const DECOR: Record<DecorKind, DecorInfo> = {
  uni: { radius: 11, happy: 0.1, upkeep: 20, covers: 'school', road: true }, // üniversite: geniş okul alanı
  airport: { radius: 8, happy: 0.06, upkeep: 30, income: 450, road: true }, // havalimanı: turist getirir
  beach: { radius: 7, happy: 0.16, upkeep: 4, income: 150, road: true }, // plaj: su kıyısına, turist getirir
  lighthouse: { radius: 6, happy: 0.1, upkeep: 3, income: 60 }, // deniz feneri: deniz kıyısına
  marina: { radius: 8, happy: 0.16, upkeep: 8, income: 200, road: true }, // yat limanı: deniz kıyısına, turist getirir
  metro: { radius: 7, happy: 0.14, upkeep: 10, road: true }, // metro istasyonu: çevresi rahat ulaşır
  clocktower: { radius: 5, happy: 0.12, upkeep: 2 }, // saat kulesi
  mosque: { radius: 9, happy: 0.16, upkeep: 6 }, // cami: kubbe ve iki minare
  museum: { radius: 9, happy: 0.15, upkeep: 15, income: 220, road: true }, // müze: turist getirir
  funfair: { radius: 10, happy: 0.22, upkeep: 14, income: 260, road: true }, // lunapark: atlıkarınca ve hız treni
  busstop: { radius: 4, happy: 0.05, upkeep: 1 }, // otobüs durağı: otobüsler dolaşır
  station: { radius: 8, happy: 0.12, upkeep: 8 }, // tren istasyonu: ulaşım çevreyi mutlu eder
  fountain: { radius: 4, happy: 0.1, upkeep: 1 },
  statue: { radius: 5, happy: 0.12, upkeep: 1 },
  wheel: { radius: 7, happy: 0.18, upkeep: 6 },
  stadium: { radius: 9, happy: 0.22, upkeep: 12 },
};
export const DECOR_KINDS = Object.keys(DECOR) as DecorKind[];
export const DECOR_MAX = 0.3; // simgelerden gelen toplam mutluluk en fazla bu kadar

export type BuildTool = 'road' | 'avenue' | 'boulevard' | 'rail' | 'res' | 'com' | 'park' | UtilKind | ServiceKind | IndustryKind | DecorKind | 'bulldoze';
// Simge yapılardan 6. seviye konut için gereken en az mutluluk katkısı (otobüs durağı yetmez)
export const LUXURY_DECOR = 0.1;
// Su kenarına (nehre bitişik) kurulması gereken yapılar
export const NEEDS_WATER: BuildTool[] = ['beach', 'port', 'lighthouse', 'marina'];
// Sadece deniz kıyısına kurulanlar
export const NEEDS_SEA: BuildTool[] = ['lighthouse', 'marina'];
export type Tool = 'pan' | BuildTool;

// Yol çeşitleri: sade yol, cadde (ağaçlı, ince refüjlü), bulvar (çiçekli geniş refüj, süslü lambalar).
// Yol, cadde ya da bulvar aracıyla üstünden geçilerek yükseltilir. Kenarındaki evler mutlu olur, arabalar hızlanır.
export const ROAD_GRADES = [
  { tool: 'road', label: 'Yol', happy: 0, speed: 1 },
  { tool: 'avenue', label: 'Cadde', happy: 0.05, speed: 1.25 },
  { tool: 'boulevard', label: 'Bulvar', happy: 0.1, speed: 1.45 },
] as const;
export const ROAD_TOOLS: BuildTool[] = ['road', 'avenue', 'boulevard'];

export const COST: Record<BuildTool, number> = {
  road: 10, avenue: 40, boulevard: 100, rail: 25, res: 20, com: 30, park: 60, bulldoze: 0, station: 2000,
  wind: 300, solar: 700, plant: 1500, tower: 250, pump: 1200, trade: 1200, busstop: 150,
  police: 500, fire: 500, health: 800, school: 600,
  factory: 400, store: 600, depot: 300, market: 800, furniture: 1200, uni: 6000, airport: 20000,
  bakery: 1500, fashion: 2000, port: 8000, beach: 3000, metro: 4000, clocktower: 1200, museum: 7000, funfair: 9000, lighthouse: 2500, marina: 6000,
  fountain: 600, statue: 900, wheel: 2500, stadium: 5000, mosque: 5000,
};

// Büyük binalar kaç kare x kaç kare yer kaplar (yazmayanlar 1x1)
export const FOOTPRINT: Partial<Record<BuildTool, number>> = {
  health: 2, school: 2, plant: 2, solar: 2, pump: 2, factory: 2, wheel: 2, stadium: 3, station: 2, trade: 2, uni: 3, airport: 4, port: 2, beach: 2, museum: 2, funfair: 3, marina: 2, mosque: 2,
};

// Hangi araç hangi şehir seviyesinde açılır (yazmayanlar baştan açık)
export const UNLOCK: Partial<Record<BuildTool, number>> = {
  com: 2, depot: 2, police: 2, busstop: 2,
  store: 3, fire: 3, solar: 3, trade: 3,
  rail: 4, station: 4,
  health: 4, plant: 4,
  school: 5, pump: 5,
  fountain: 2, statue: 3, wheel: 5, stadium: 6,
  market: 4, furniture: 6, uni: 7, airport: 9,
  beach: 6, bakery: 7, port: 8, fashion: 8, metro: 10, clocktower: 4, museum: 8, funfair: 9, lighthouse: 5, marina: 7,
  avenue: 4, boulevard: 8, mosque: 6,
};

export const TOOL_INFO: Record<Tool, { icon: string; label: string; hint: string }> = {
  pan: { icon: '✋', label: 'Gez', hint: 'Haritayı parmağınla kaydır, iki parmakla yakınlaştır.' },
  road: { icon: '🛣️', label: 'Yol', hint: 'Yol çizmek için parmağını sürükle. Kaydırmak için iki parmak kullan.' },
  avenue: { icon: '🌳', label: 'Cadde', hint: 'Cadde: ağaçlı, refüjlü yol. Var olan yolun üstüne sürükleyerek yolu caddeye yükselt.' },
  boulevard: { icon: '🌷', label: 'Bulvar', hint: 'Bulvar: çiçekli refüj, ağaçlar ve süslü lambalar. Yolun üstüne sürükleyerek bulvara yükselt.' },
  rail: { icon: '🛤️', label: 'Tren yolu', hint: 'Ray çizmek için sürükle. Düz bir yolu keserse hemzemin geçit olur.' },
  station: { icon: '🚉', label: 'İstasyon', hint: 'İstasyonu tren yolunun yanına kur; trenler buradan sefer yapar.' },
  busstop: { icon: '🚏', label: 'Durak', hint: 'Otobüs durağı: her durak için şehirde bir otobüs dolaşır.' },
  trade: { icon: '🏬', label: 'Ticaret', hint: 'Ticaret merkezi: malzemelerini sat, eksiklerini satın al.' },
  res: { icon: '🏠', label: 'Konut', hint: 'Yol kenarına konut bölgesi çiz, evler kendiliğinden yapılır.' },
  com: { icon: '🏪', label: 'Ticaret', hint: 'Dükkanlar ve ofisler nüfus arttıkça gelişir.' },
  park: { icon: '🌳', label: 'Park', hint: 'Parkların yakınındaki evler daha çok büyür.' },
  bulldoze: { icon: '🚜', label: 'Yık', hint: 'Yıkmak istediğin alanı sürükle.' },
  wind: { icon: '🌬️', label: 'Türbin', hint: 'Rüzgar türbini: az elektrik, ucuz. Yol kenarına kur.' },
  solar: { icon: '☀️', label: 'Güneş', hint: 'Güneş paneli: temiz elektrik, kirlilik yapmaz.' },
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
  market: { icon: '🥕', label: 'Pazar', hint: 'Çiftçi pazarı: tohumdan sebze, tohum ve kumaştan un yapar.' },
  furniture: { icon: '🪑', label: 'Mobilyacı', hint: 'Mobilyacı: sandalye ve koltuk yapar. Lüks evler bunları ister.' },
  uni: { icon: '🎓', label: 'Üniversite', hint: 'Üniversite: çok geniş bir alanda okul hizmeti verir, çevreyi mutlu eder.' },
  airport: { icon: '✈️', label: 'Havalimanı', hint: 'Havalimanı: uçaklar kalkıp iner, turistler her gün para getirir.' },
  bakery: { icon: '🥯', label: 'Fırın', hint: 'Fırın: undan simit ve pasta yapar.' },
  fashion: { icon: '👕', label: 'Giyim', hint: 'Giyim mağazası: kumaştan tişört ve ayakkabı yapar.' },
  port: { icon: '🚢', label: 'Liman', hint: 'Liman deniz ya da nehir kıyısına kurulur. Komşu şehirlerin siparişlerini gemiyle gönder.' },
  beach: { icon: '🏖️', label: 'Plaj', hint: 'Plaj deniz ya da nehir kıyısına kurulur. Turist getirir, çevreyi çok mutlu eder.' },
  lighthouse: { icon: '🗼', label: 'Deniz Feneri', hint: 'Deniz feneri: deniz kıyısına kurulur, geceleri ışığı döner. Biraz turist getirir.' },
  marina: { icon: '⛵', label: 'Yat Limanı', hint: 'Yat limanı: deniz kıyısına kurulur. Yatlar ve iskeleler, çok turist getirir.' },
  metro: { icon: 'Ⓜ️', label: 'Metro', hint: 'Metro istasyonu: çevresindeki evleri mutlu eder.' },
  mosque: { icon: '🕌', label: 'Cami', hint: 'Cami: büyük kubbesi, iki minaresi ve şadırvanlı avlusuyla şehrin simgesi.' },
  clocktower: { icon: '🕰️', label: 'Saat Kulesi', hint: 'Saat kulesi: meydanın simgesi, çevresini mutlu eder.' },
  museum: { icon: '🏛️', label: 'Müze', hint: 'Müze: turist getirir, geniş bir alanı mutlu eder.' },
  funfair: { icon: '🎢', label: 'Lunapark', hint: 'Lunapark: hız treni ve atlıkarınca. Çok turist getirir, geceleri havai fişek atılır.' },
  fountain: { icon: '⛲', label: 'Çeşme', hint: 'Meydan çeşmesi: çevresindeki evleri mutlu eder.' },
  statue: { icon: '🗿', label: 'Heykel', hint: 'Atlı heykel: çevresindeki evleri mutlu eder.' },
  wheel: { icon: '🎡', label: 'Dönme dolap', hint: 'Dönme dolap: geniş bir alanı çok mutlu eder.' },
  stadium: { icon: '🏟️', label: 'Stadyum', hint: 'Stadyum: şehrin büyük bir kısmını çok mutlu eder.' },
};
export const HALL_INFO = { icon: '🏛️', label: 'Belediye' };

// Alt çubuk: tek araçlar ve açılır gruplar
export interface BuildGroup { group: string; icon: string; label: string; color: string; tools: BuildTool[] }
// İnşa panelindeki sekmeler. Yıkma ayrı bir düğmede.
export const BUILD_GROUPS: BuildGroup[] = [
  { group: 'zones', icon: '🏘️', label: 'Bölgeler', color: '#43a047', tools: ['res', 'com'] },
  { group: 'transport', icon: '🛣️', label: 'Ulaşım', color: '#546e7a', tools: ['road', 'avenue', 'boulevard', 'rail', 'station', 'busstop', 'metro', 'airport'] },
  { group: 'utils', icon: '⚡', label: 'Altyapı', color: '#f59f00', tools: ['wind', 'solar', 'plant', 'tower', 'pump'] },
  { group: 'services', icon: '🚒', label: 'Hizmetler', color: '#e53935', tools: ['police', 'fire', 'health', 'school', 'uni'] },
  { group: 'industry', icon: '🏭', label: 'Sanayi', color: '#8d6e63', tools: ['factory', 'depot', 'store', 'market', 'furniture', 'bakery', 'fashion', 'trade'] },
  { group: 'decor', icon: '🎡', label: 'Eğlence', color: '#8e24aa', tools: ['park', 'fountain', 'statue', 'clocktower', 'mosque', 'wheel', 'museum', 'funfair', 'stadium'] },
  { group: 'coast', icon: '🏖️', label: 'Sahil', color: '#0097a7', tools: ['beach', 'lighthouse', 'port', 'marina'] },
];

// Modeller: KayKit City Builder Bits (kk/), Kenney City Kit 2.1 gökdelenleri (k2/), Kenney başlangıç paketi (k/)
const k = (n: string) => `kenney/models/${n}`;
const kk = (n: string) => `kaykit/${n}`;
const k2 = (n: string) => `kenney2/${n}`;
const ks = (n: string) => `kenney-sub/${n}`;
const ki = (n: string) => `kenney-ind/${n}`;
const kc = (n: string) => `kenney-cars/${n}`;
const kr = (n: string) => `kenney-roads/${n}`;
const houses = (letters: string) => [...letters].map(l => ks(`building-type-${l}`));
const x = (n: string) => `polypizza/extra/${n}`;

// Konut seviyeleri: her seviyede bina büyür, nüfus ve elektrik/su ihtiyacı artar
export const RES_LEVELS = [
  // 1-2. seviye: bahçeli banliyö evleri ve küçük KayKit binaları
  { pop: 6, need: 1, models: [kk('building_A'), kk('building_B'), ...houses('acehiklmpg')] },
  { pop: 14, need: 2, models: [kk('building_E'), kk('building_F'), ...houses('bdfjnoqrstu')] },
  { pop: 30, need: 4, models: [kk('building_C'), kk('building_D'), kk('building_G'), kk('building_H'), k2('building-a'), k2('building-b'), k2('building-d'), k2('building-h')] },
  { pop: 60, need: 7, models: [k2('building-skyscraper-a'), k2('building-skyscraper-b')] },
  { pop: 100, need: 12, models: [k2('building-skyscraper-c'), k2('building-skyscraper-d'), k2('building-skyscraper-e')] },
  // 6. seviye: lüks kuleler (daha yüksek, tepesinde taç ve anten)
  { pop: 160, need: 18, models: [k2('building-skyscraper-b'), k2('building-skyscraper-d'), k2('building-skyscraper-e')] },
];

// Ticaret seviyeleri: iş yeri sağlar, nüfus büyüdükçe yükselir
export const COM_LEVELS = [
  { jobs: 5, need: 1, models: [kk('building_A'), kk('building_B'), kk('building_E'), k2('building-c'), k2('building-e'), k2('building-k')] },
  { jobs: 15, need: 3, models: [kk('building_F'), kk('building_C'), kk('building_G'), k2('building-f'), k2('building-g'), k2('building-i'), k2('building-j'), k2('building-l')] },
  { jobs: 40, need: 6, models: [k2('building-skyscraper-a'), k2('building-skyscraper-c'), k2('building-skyscraper-e'), k2('building-m'), k2('building-n')] },
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

export const CAR_MODELS = [
  ...['car_sedan', 'car_taxi', 'car_hatchback', 'car_stationwagon', 'car_police'].map(kk),
  ...['van', 'delivery', 'truck', 'suv', 'suv-luxury', 'garbage-truck'].map(kc),
];
// Hastane ve itfaiye varsa trafikte ambulans ve itfaiye aracı da dolaşır
export const EMERGENCY_CARS = { health: kc('ambulance'), fire: kc('firetruck') };

// Denizde dolaşan gemi ve tekneler (Kenney Watercraft Kit)
export const BOAT_MODELS = ['ship-cargo-a', 'boat-sail-a', 'ship-ocean-liner-small', 'boat-speed-a', 'ship-cargo-b', 'boat-sail-b', 'boat-tug-a', 'boat-fishing-small'].map(n => `kenney-boats/${n}`);

// Tren (Kenney Train Kit): öndeki ve arkadaki kabinli vagon, ortada yolcu vagonu
export const TRAIN_MODELS = { head: 'kenney-train/train-electric-city-a', mid: 'kenney-train/train-electric-city-b' };

// Fabrika ve depo binaları (Kenney City Kit Industrial)
export const INDUSTRY_MODELS = {
  factory: ['a', 'b', 'e', 'f', 'l', 'm', 'n'].map(l => ki(`building-${l}`)),
  depot: ['c', 'g', 'k', 'p', 'q', 'r', 's', 't'].map(l => ki(`building-${l}`)),
};

// Kenney paketlerinde farklı renk düzenleri (dokular); 0 = asıl renkler
export const SKINS: Record<string, string[]> = {
  'kenney-sub': ['variation-a', 'variation-b', 'variation-c'],
  'kenney-ind': ['variation-a', 'variation-b', 'variation-c'],
  kenney2: ['variation-a', 'variation-b'],
};

// Şehri dolduran süs eşyaları ve ağaçlar
export const PROPS = {
  streetlight: kk('streetlight'),
  traffic: kk('trafficlight_B'),
  hydrant: kk('firehydrant'),
  bench: kk('bench'),
  bush: 'proc/tree-bush',
  trash: kk('trash_A'),
  boxA: kk('box_A'),
  boxB: kk('box_B'),
  watertower: kk('watertower'),
  treeLarge: 'proc/tree-round',
  treeSmall: 'proc/tree-cypress',
  treePine: 'proc/tree-pine',
  treeBlossom: 'proc/tree-blossom',
  treeStreet: 'proc/tree-street',
  planter: ks('planter'),
  chimney: ki('chimney-medium'),
  chimneyLarge: ki('chimney-large'),
  tank: ki('detail-tank'),
  containerA: ki('shipping-container-a'),
  containerB: ki('shipping-container-b'),
  containerC: ki('shipping-container-c'),
  solar: ki('solar-panel-landscape-group'),
  cone: kr('construction-cone'),
  barrier: kr('construction-barrier'),
  workLight: kr('construction-light'),
  ambulance: kc('ambulance'),
  firetruck: kc('firetruck'),
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
    ...BOAT_MODELS,
    TRAIN_MODELS.head,
    TRAIN_MODELS.mid,
    ...INDUSTRY_MODELS.factory,
    ...INDUSTRY_MODELS.depot,
    ...(Object.values(DECOR_MODELS) as string[]),
  ]),
];
