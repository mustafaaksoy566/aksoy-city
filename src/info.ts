import {
  RES_LEVELS, COM_LEVELS, UTILITIES, SERVICES, SERVICE_KINDS, TOOL_INFO, POP_PER_COM_LEVEL, PARK_RADIUS,
  MATERIALS, MAT_IDS, FACTORY_SLOTS, STORE_QUEUE, DEPOT_STORAGE, FIRE, QUAKE, HALL_INFO, DECOR, PLOT, type MatId,
} from './config';
import { City, isService, isUtility, isDecor, serviceArea } from './city';
import { questProgress, questDone, questText } from './quests';

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
  collect(): void;
  extinguish(i: number): void;
  repair(i: number): void;
  claim(n: number): void;
  buyLand(plot: number): void;
}

export function describeLand(city: City, plot: number, act: CardActions): InfoCard {
  const err = city.canBuyPlot(plot);
  const lines: InfoCard['lines'] = [{ text: `${PLOT}x${PLOT} karelik boş arazi. Şehrini büyütmek için satın al.` }];
  if (err && err !== 'Yeterli para yok') lines.push({ ok: false, text: err });
  return {
    title: '🏞️ Satılık arazi',
    lines,
    actions: [{ label: `🏞️ Satın al (💰${fmt(city.landPrice)})`, enabled: err === null, primary: true, run: () => act.buyLand(plot) }],
  };
}

const pct = (x: number) => `%${Math.round(x * 100)}`;
const mood = (x: number) => (x >= 0.75 ? '😄' : x >= 0.5 ? '🙂' : x >= 0.3 ? '😐' : '😟');

export function describeHall(city: City, act: CardActions): InfoCard {
  const happy = city.happiness;
  const pending = Math.floor(city.treasury);
  return {
    title: `${HALL_INFO.icon} ${HALL_INFO.label}`,
    lines: [
      { text: `${mood(happy)} Şehrin mutluluğu: ${pct(happy)}` },
      { text: `Mutlu şehir daha çok vergi öder (x${(0.5 + happy).toFixed(1)})` },
      { text: `💰 Günlük vergi: ${fmt(Math.round(city.dailyTax))}  ·  🔧 Bakım: ${fmt(city.upkeep)}` },
      { text: `🏛️ Toplanmayı bekleyen: 💰${fmt(pending)}` },
    ],
    actions: [{ label: `💰 Vergiyi topla (${fmt(pending)})`, enabled: pending > 0, primary: true, run: () => act.collect() }],
  };
}

export function describeQuests(city: City, act: CardActions): InfoCard {
  const lines: InfoCard['lines'] = [];
  const actions: NonNullable<InfoCard['actions']> = [];
  city.quests.forEach((q, n) => {
    const done = questDone(city, q);
    const prog = Math.min(questProgress(city, q), q.target);
    lines.push({ ok: done || undefined, text: `${done ? '' : '⏳ '}${questText(q)}  (${fmt(prog)}/${fmt(q.target)})` });
    actions.push({
      label: `${n + 1}. ödül: 💰${fmt(q.money)} ⭐${q.xp}`,
      enabled: done,
      primary: false,
      run: () => act.claim(n),
    });
  });
  return { title: '📋 Görevler', lines, actions };
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
  if (!city.isOwned(i) && t?.kind !== 'road') return describeLand(city, city.plotOf(i), act);
  if (!t || t.kind === 'road') return null;
  const connected = city.isConnected(i);
  const road = { ok: connected, text: connected ? 'Şehrin yollarına bağlı' : 'Yol bağlantısı yok' };

  if (t.kind === 'hall') return describeHall(city, act);
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
    if (t.fire) {
      return {
        title: `🔥 ${name} yanıyor!`,
        lines: [
          { ok: false, text: `${FIRE.days - t.fire + 1} gün içinde söndürülmezse bina yıkılır.` },
          { text: 'İtfaiyenin kapsadığı yerlerde yangın kendiliğinden söner.' },
        ],
        actions: [{ label: `🚒 Söndür (💰${FIRE.cost})`, enabled: city.money >= FIRE.cost, primary: true, run: () => act.extinguish(i) }],
      };
    }
    if (t.damaged) {
      const parts = (Object.entries(QUAKE.repair) as [MatId, number][]).map(([m, n]) => `${MATERIALS[m].icon}${Math.min(city.storage[m], n)}/${n}`);
      return {
        title: `🔧 ${name} hasarlı`,
        lines: [{ ok: false, text: 'Depremde hasar gördü. Onarılana kadar kimse yaşamaz.' }],
        actions: [{ label: `🔧 Onar  ${parts.join('  ')}`, enabled: city.hasMaterials(QUAKE.repair), primary: true, run: () => act.repair(i) }],
      };
    }
    const lack = city.lacking.get(i);
    const served = connected && !lack;
    const lines: InfoCard['lines'] = [];
    if (isRes) {
      lines.push({ text: `👥 ${served ? fmt(RES_LEVELS[t.level - 1].pop) : 0} kişi yaşıyor  ·  ${mood(city.happy[i])} ${pct(city.happy[i])} mutlu` });
      if (city.polluted(i)) lines.push({ ok: false, text: 'Yakında fabrika ya da santral var (kirlilik)' });
    }
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

  if (isDecor(t.kind)) {
    const d = DECOR[t.kind];
    const info = TOOL_INFO[t.kind];
    return {
      title: `${info.icon} ${info.label}`,
      lines: [
        { text: `😊 Çevresindeki ${d.radius} kare içindeki evlerin mutluluğu +${pct(d.happy)}` },
        { text: `🔧 Bakım: ${d.upkeep}/gün` },
      ],
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
