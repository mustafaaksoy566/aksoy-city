import { BUILD_GROUPS, PLOTS, PLOT_ROWS, perDay, type BuildTool } from './config';
import { isSea, type City } from './city';

// Başarımlar: şehir büyüdükçe kazanılan kalıcı ödüller. Her başarımın kademeleri var (500 kişi, 2.000 kişi…);
// kademe tamamlanınca kartından ödülü alınır, sonra bir sonraki kademe görünür. Alınan kademe sayısı
// şehrin kaydında durur (city.achieved).
export interface Tier { target: number; name: string; money: number; xp: number }
export interface Achievement {
  id: string;
  icon: string;
  text: (target: string) => string; // "500 kişilik şehir"
  tiers: Tier[];
  value: (c: City) => number;
  percent?: boolean; // sayı yüzde olarak yazılsın
}

const LANDMARKS = (BUILD_GROUPS.find(g => g.group === 'historic')?.tools ?? []) as BuildTool[];
const count = (c: City, test: (t: NonNullable<City['tiles'][number]>, i: number) => boolean) => {
  let n = 0;
  c.tiles.forEach((t, i) => {
    if (t && test(t, i)) n++;
  });
  return n;
};
const tiers = (list: [number, string, number, number][]): Tier[] => list.map(([target, name, money, xp]) => ({ target, name, money, xp }));

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'pop', icon: '👥', text: n => `Nüfus ${n} kişi`, value: c => c.population,
    tiers: tiers([[500, 'Kasaba', 500, 20], [2000, 'İlçe', 1500, 50], [10000, 'Şehir', 4000, 120], [30000, 'Büyük şehir', 10000, 250], [75000, 'Metropol', 25000, 500], [150000, 'Mega şehir', 50000, 800]]),
  },
  {
    id: 'level', icon: '⭐', text: n => `Şehir seviyesi ${n}`, value: c => c.level,
    tiers: tiers([[5, 'Gelişen şehir', 1000, 0], [10, 'Parlayan şehir', 5000, 0], [15, 'Efsane şehir', 20000, 0]]),
  },
  {
    id: 'sky', icon: '🏙️', text: n => `${n} gökdelen (5. seviye ve üstü ev)`, value: c => count(c, t => t.kind === 'res' && t.level >= 5),
    tiers: tiers([[1, 'İlk gökdelen', 1500, 40], [10, 'Gökdelenler', 6000, 120], [40, 'Gökdelen ormanı', 20000, 300]]),
  },
  {
    id: 'top', icon: '🏢', text: n => `${n} ev en üst seviyede (8)`, value: c => count(c, t => t.kind === 'res' && t.level >= 8),
    tiers: tiers([[1, 'Bulutlara değen', 5000, 100], [10, 'Göğü delen', 20000, 300]]),
  },
  {
    id: 'made', icon: '🏭', text: n => `${n} ürün üret`, value: c => Object.values(c.stats.produced).reduce((s, v) => s + (v ?? 0), 0),
    tiers: tiers([[50, 'Usta', 800, 30], [500, 'Üretici', 4000, 100], [2500, 'Sanayi devi', 15000, 300]]),
  },
  {
    id: 'ships', icon: '🚢', text: n => `${n} sipariş gönder`, value: c => c.stats.ships ?? 0,
    tiers: tiers([[5, 'Tüccar', 1500, 40], [25, 'Liman şehri', 6000, 120], [100, 'Ticaret merkezi', 20000, 300]]),
  },
  {
    id: 'landmark', icon: '🏛️', text: n => `${n} tarihi yapı ya da harika`, value: c => count(c, t => LANDMARKS.includes(t.kind as BuildTool)),
    tiers: tiers([[1, 'Tarih meraklısı', 2000, 50], [5, 'Turizm şehri', 8000, 150], [10, 'Açık hava müzesi', 20000, 300], [LANDMARKS.length, 'Bütün harikalar', 50000, 800]]),
  },
  {
    id: 'tourism', icon: '📸', text: n => `Günde ${n} turizm geliri`, value: c => perDay(c.tourism),
    tiers: tiers([[2000, 'Turist akını', 2000, 50], [10000, 'Tatil cenneti', 8000, 150], [30000, 'Dünyanın gözdesi', 25000, 400]]),
  },
  {
    id: 'happy', icon: '😊', text: n => `Mutluluk ${n} (en az 1.000 kişiyle)`, value: c => (c.population >= 1000 ? Math.round(c.happiness * 100) : 0), percent: true,
    tiers: tiers([[60, 'Güler yüzlü şehir', 1500, 40], [75, 'Mutlu şehir', 5000, 120], [90, 'Cennet gibi', 15000, 300]]),
  },
  {
    id: 'land', icon: '🗺️', text: n => `${n} arazi parçası`, value: c => c.owned.reduce((s, v) => s + v, 0),
    tiers: tiers([[20, 'Toprak sahibi', 1500, 40], [36, 'Geniş topraklar', 6000, 120], [PLOTS * PLOT_ROWS, 'Bütün harita', 30000, 500]]),
  },
  {
    id: 'metro', icon: '🚇', text: n => `Hatta bağlı ${n} metro istasyonu`, value: c => {
      const L = c.metroLines();
      return L.stationList.filter(st => st.line >= 0 && L.active[st.line]).length;
    },
    tiers: tiers([[2, 'Metro açıldı', 3000, 80], [6, 'Metro ağı', 10000, 200], [12, 'Yeraltı şehri', 25000, 400]]),
  },
  {
    id: 'under', icon: '⤵️', text: n => `${n} kare alt geçit`, value: c => count(c, t => t.under !== undefined),
    tiers: tiers([[1, 'Işıksız geçiş', 1500, 40], [10, 'Tünel ustası', 6000, 120]]),
  },
  {
    id: 'bridge', icon: '🌉', text: n => `Denizin üstünde ${n} kare köprü`, value: c => count(c, (t, i) => t.kind === 'road' && isSea(i)),
    tiers: tiers([[1, 'Adaya köprü', 2000, 50], [12, 'Boğaz köprüsü', 8000, 150]]),
  },
  {
    id: 'parks', icon: '🌳', text: n => `${n} park`, value: c => count(c, t => t.kind === 'park'),
    tiers: tiers([[10, 'Yeşil mahalle', 800, 30], [50, 'Yeşil şehir', 5000, 120], [150, 'Orman şehir', 15000, 300]]),
  },
  {
    id: 'upgrades', icon: '⬆️', text: n => `${n} ev yükseltmesi`, value: c => c.stats.upgrades,
    tiers: tiers([[10, 'Yenileyici', 1000, 30], [100, 'Kentsel dönüşüm', 6000, 150], [500, 'Mimar', 20000, 400]]),
  },
  {
    id: 'money', icon: '💰', text: n => `Kasada ${n} para`, value: c => c.money,
    tiers: tiers([[50000, 'Zengin şehir', 0, 100], [250000, 'Varlıklı şehir', 0, 250], [1000000, 'Milyoner', 0, 600]]),
  },
];

// Bir başarımın şu anki kademesi (hepsi alındıysa null) ve tamamlanıp tamamlanmadığı
export function achievementState(c: City, a: Achievement) {
  const got = c.achieved[a.id] ?? 0;
  const tier = a.tiers[got] ?? null;
  const value = a.value(c);
  return { got, tier, value, ready: !!tier && value >= tier.target };
}

// Ödülü alınabilecek başarım sayısı (düğmedeki rozet)
export const readyAchievements = (c: City) => ACHIEVEMENTS.filter(a => achievementState(c, a).ready);

export function claimAchievement(c: City, id: string): Tier | null {
  const a = ACHIEVEMENTS.find(x => x.id === id);
  if (!a) return null;
  const s = achievementState(c, a);
  if (!s.ready || !s.tier) return null;
  c.achieved[a.id] = s.got + 1;
  c.money += s.tier.money;
  c.addXp(s.tier.xp);
  return s.tier;
}
