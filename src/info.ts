import {
  RES_LEVELS, COM_LEVELS, UTILITIES, SERVICES, SERVICE_KINDS, TOOL_INFO, POP_PER_COM_LEVEL, PARK_RADIUS,
  MATERIALS, MAT_IDS, FACTORY_SLOTS, STORE_QUEUE, DEPOT_STORAGE, type MatId,
} from './config';
import { City, isService, isUtility, serviceArea } from './city';

// Bir binaya dokununca çıkan kartın içeriği
export interface InfoCard {
  title: string;
  lines: { ok?: boolean; text: string }[];
  jobs?: { text: string; progress: number }[]; // üretimdeki malzemeler
  actions?: { label: string; enabled: boolean; primary?: boolean; run: () => void }[];
}

export interface CardActions {
  upgrade(i: number): void;
  make(i: number, mat: MatId): void;
}

const fmt = (n: number) => n.toLocaleString('tr-TR');
const costText = (cost: Partial<Record<MatId, number>>) =>
  (Object.entries(cost) as [MatId, number][]).map(([m, n]) => `${MATERIALS[m].icon}${n}`).join(' ');

function jobsOf(city: City, i: number, now: number): NonNullable<InfoCard['jobs']> {
  return (city.jobs.get(i) ?? []).map(j => {
    const m = MATERIALS[j.mat];
    const left = Math.ceil((j.end - now) / 1000);
    const total = m.seconds;
    return {
      text: `${m.icon} ${m.name} · ${left > 0 ? `${left} sn` : 'Hazır, depo dolu!'}`,
      progress: Math.min(1, Math.max(0, 1 - left / total)),
    };
  });
}

function production(city: City, i: number, act: CardActions, now: number): InfoCard {
  const t = city.tiles[i]!;
  const isFactory = t.kind === 'factory';
  const list = city.jobs.get(i) ?? [];
  const lines: InfoCard['lines'] = [
    { text: `📦 Depo: ${fmt(city.storageUsed)}/${fmt(city.storageCap)}` },
    { text: isFactory ? `Üretim yeri: ${list.length}/${FACTORY_SLOTS}` : `Sıra: ${list.length}/${STORE_QUEUE}` },
  ];
  if (!city.isConnected(i)) lines.push({ ok: false, text: 'Yol bağlantısı yok' });
  const actions = MAT_IDS.filter(m => MATERIALS[m].maker === t.kind).map(m => {
    const mat = MATERIALS[m];
    if (!city.isUnlocked(m)) return { label: `🔒 ${mat.name} (Sv.${mat.unlock})`, enabled: false, run: () => {} };
    const needs = mat.needs ? ` ← ${costText(mat.needs)}` : '';
    return {
      label: `${mat.icon} ${mat.name}${needs} · ${mat.seconds} sn`,
      enabled: city.canMake(i, m) === null,
      run: () => act.make(i, m),
    };
  });
  return { title: `${TOOL_INFO[t.kind as 'factory'].icon} ${TOOL_INFO[t.kind as 'factory'].label}`, lines, jobs: jobsOf(city, i, now), actions };
}

export function describeStorage(city: City): InfoCard {
  const lines: InfoCard['lines'] = [{ text: `Dolu: ${fmt(city.storageUsed)}/${fmt(city.storageCap)}` }];
  const have = MAT_IDS.filter(m => city.storage[m] > 0);
  if (!have.length) lines.push({ text: 'Depo boş. Fabrikada metal ve odun üret.' });
  for (const m of have) lines.push({ text: `${MATERIALS[m].icon} ${MATERIALS[m].name}: ${city.storage[m]}` });
  lines.push({ text: `Her yeni depo binası ${DEPOT_STORAGE} yer ekler.` });
  return { title: '📦 Depo', lines };
}

export function describeTile(city: City, i: number, act: CardActions, now = Date.now()): InfoCard | null {
  const t = city.tiles[i];
  if (!t || t.kind === 'road') return null;
  const connected = city.isConnected(i);
  const road = { ok: connected, text: connected ? 'Şehrin yollarına bağlı' : 'Yol bağlantısı yok' };

  if (t.kind === 'factory' || t.kind === 'store') return production(city, i, act, now);
  if (t.kind === 'depot') return describeStorage(city);

  if (t.kind === 'res' || t.kind === 'com') {
    const isRes = t.kind === 'res';
    const levels = isRes ? RES_LEVELS : COM_LEVELS;
    const name = isRes ? '🏠 Konut' : '🏪 Ticaret';
    if (t.level === 0) {
      return {
        title: `${name} · Boş arsa`,
        lines: [
          road,
          { text: connected ? 'Elektrik ve su yeterliyse yakında bina yapılacak.' : 'Bina yapılması için yolu şehre bağla.' },
        ],
      };
    }
    const lack = city.lacking.get(i);
    const served = connected && !lack;
    const lines: InfoCard['lines'] = [];
    if (isRes) lines.push({ text: `👥 ${served ? fmt(RES_LEVELS[t.level - 1].pop) : 0} kişi yaşıyor` });
    else lines.push({ text: `💼 ${served ? fmt(COM_LEVELS[t.level - 1].jobs) : 0} kişi çalışıyor` });
    lines.push(road);
    lines.push({ ok: !lack?.power, text: lack?.power ? 'Elektrik yok' : 'Elektrik var' });
    lines.push({ ok: !lack?.water, text: lack?.water ? 'Su yok' : 'Su var' });
    let actions: InfoCard['actions'];
    if (isRes) {
      lines.push({ ok: city.parkNear(i), text: '3. seviye için: yakında park' });
      lines.push({ ok: city.shopNear(i), text: '4. seviye için: yakında dükkan' });
      const missing = SERVICE_KINDS.filter(k => !city.isCovered(i, k)).map(k => SERVICES[k].name);
      lines.push({
        ok: missing.length === 0,
        text: missing.length ? `5. seviye için eksik: ${missing.join(', ')}` : '5. seviye için: bütün hizmetler var',
      });
      const cost = city.upgradeCost(i);
      if (cost) {
        const blocker = city.upgradeBlocker(i);
        if (blocker) lines.push({ ok: false, text: `Yükseltme: ${blocker}` });
        const parts = (Object.entries(cost) as [MatId, number][]).map(
          ([m, n]) => `${MATERIALS[m].icon}${Math.min(city.storage[m], n)}/${n}`,
        );
        actions = [{ label: `⬆️ Yükselt  ${parts.join('  ')}`, enabled: city.canUpgrade(i), primary: true, run: () => act.upgrade(i) }];
      }
    } else if (t.level < COM_LEVELS.length) {
      const needPop = t.level * POP_PER_COM_LEVEL;
      lines.push({ ok: city.population >= needPop, text: `${t.level + 1}. seviye için: ${fmt(needPop)} nüfus` });
    }
    return { title: `${name} · Seviye ${t.level}/${levels.length}`, lines, actions };
  }

  if (t.kind === 'park') {
    return {
      title: '🌳 Park',
      lines: [{ text: `Çevresindeki ${PARK_RADIUS} kare içindeki evler 3. seviyeye çıkabilir.` }],
    };
  }

  if (isUtility(t.kind)) {
    const u = UTILITIES[t.kind];
    const info = TOOL_INFO[t.kind];
    return {
      title: `${info.icon} ${info.label}`,
      lines: [
        { text: u.power ? `⚡ ${u.power} elektrik üretir` : `💧 ${u.water} su verir` },
        { text: `🔧 Bakım: ${u.upkeep}/gün` },
        road,
      ],
    };
  }

  if (isService(t.kind)) {
    const s = SERVICES[t.kind];
    const info = TOOL_INFO[t.kind];
    const homes = serviceArea(i, t.kind).filter(c => city.tiles[c]?.kind === 'res' && city.tiles[c]!.level > 0).length;
    return {
      title: `${info.icon} ${info.label}`,
      lines: [
        { text: `📏 Kapsama alanı: ${s.radius} kare` },
        { text: `🏠 ${fmt(homes)} konut binasına hizmet veriyor` },
        { text: `🔧 Bakım: ${s.upkeep}/gün` },
        road,
      ],
    };
  }
  return null;
}
