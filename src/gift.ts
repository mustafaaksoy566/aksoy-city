import { MATERIALS, MAT_IDS, type MatId } from './config';
import type { City } from './city';

// Günlük hediye: her takvim gününde bir kez (oyun açılınca ya da uygulamaya geri dönünce). Art arda gelinen
// günler 1'den 7'ye kadar büyür, 7. günden sonra takvim yeniden başlar; bir gün atlanırsa 1. güne döner.
// Hediye o anki şehir seviyesine göre ölçeklenir; malzemeler depoya sığmazsa parası verilir.
export const GIFT_DAYS = 7;
const MULT = [1, 1.3, 1.6, 2, 2.5, 3, 5];

export interface GiftReward { money: number; mats: Partial<Record<MatId, number>> }

// Yerel tarih "2026-10-14" biçiminde
export const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function giftReward(c: City, day: number): GiftReward {
  const money = Math.round(((150 + 60 * c.level) * MULT[day - 1]) / 10) * 10;
  const mats: Partial<Record<MatId, number>> = {};
  // Seçim gün ve seviyeye bağlı (rastgele değil): takvimde görünen, alınanla aynı olsun
  const raw = MAT_IDS.filter(m => MATERIALS[m].maker === 'factory' && c.isUnlocked(m));
  const made = MAT_IDS.filter(m => MATERIALS[m].maker !== 'factory' && c.isUnlocked(m));
  if (day === 3 || day === 5 || day === 7) {
    const m = raw[(c.level + day) % raw.length];
    mats[m] = day === 7 ? 5 : 3;
  }
  if ((day === 6 || day === 7) && made.length) mats[made[(c.level * 3 + day) % made.length]] = 2;
  return { money, mats };
}

// Bugün alınacak hediyenin günü (1..7); bugün alındıysa null
export function giftDay(c: City, now = new Date()): number | null {
  if (c.gift?.d === dateKey(now)) return null;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return c.gift && c.gift.d === dateKey(y) ? (c.gift.s % GIFT_DAYS) + 1 : 1;
}

export function claimGift(c: City, now = new Date()): GiftReward | null {
  const day = giftDay(c, now);
  if (!day) return null;
  const r = giftReward(c, day);
  c.money += r.money;
  for (const [m, n] of Object.entries(r.mats) as [MatId, number][]) {
    const put = Math.max(0, Math.min(n, c.storageCap - c.storageUsed));
    c.storage[m] += put;
    if (n > put) c.money += (n - put) * MATERIALS[m].price * 2;
  }
  c.gift = { d: dateKey(now), s: day };
  return r;
}

// Yeni kurulan şehirde ilk gün hediye penceresi açılmasın (rehber açılıyor); yarın 1. gün gelir
export function skipGiftToday(c: City, now = new Date()) {
  c.gift = { d: dateKey(now), s: 0 };
}
