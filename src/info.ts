import {
  RES_LEVELS, COM_LEVELS, UTILITIES, SERVICES, SERVICE_KINDS, TOOL_INFO, POP_PER_COM_LEVEL, PARK_RADIUS,
  MATERIALS, MAT_IDS, MAKER_LEVELS, UTIL_LEVELS, PARKING_LEVELS, METRO_LEVELS, DEPOT_STORAGE, FIRE, QUAKE, HALL_INFO, DECOR, PLOT, PLOTS, NORTH, LEVEL_XP,
  INDUSTRY, TAX_PER_JOB, BUILD_GROUPS, MAKERS, ROAD_GRADES, TRAFFIC, COST, UNLOCK, type MatId, type BuildTool,
} from './config';
import { City, isService, isUtility, isDecor, isIndustry, serviceArea } from './city';
import { questProgress, questDone, questText } from './quests';
import { productPic } from './production';

// Bir binaya (ya da üstteki düğmelere) dokununca çıkan kartın içeriği
export interface InfoCard {
  title: string;
  subtitle?: string;
  thumb?: string; // menü resmi (araç adı ya da 'hall')
  icon?: string; // resim yoksa emoji
  tone?: string; // başlık rengi
  stats?: { icon: string; value: string; label: string; bad?: boolean; good?: boolean }[];
  lines: { ok?: boolean; text: string }[];
  cost?: { text: string; ok: boolean }[]; // yükseltme malzemeleri (eldeki/gereken)
  jobs?: { text: string; progress: number }[]; // üretimdeki malzemeler
  tiles?: { icon: string; name: string; sub: string; note?: string; section?: string; enabled: boolean; run: () => void }[];
  quests?: { text: string; pics?: string; progress: number; count: string; reward: string; done: boolean; button?: string; run: () => void }[];
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
  upgradeMaker(i: number): void;
  upgradeUtil(i: number): void;
  upgradeParking(i: number): void;
  upgradeMetro(i: number): void;
  showMetro(): void;
  openCatalog(group: string): void;
  ship(n: number): void;
  upgradeRoad(i: number): void;
  renewOrders(): void;
}

const fmt = (n: number) => n.toLocaleString('tr-TR');
const pct = (x: number) => `%${Math.round(x * 100)}`;
const mood = (x: number) => (x >= 0.75 ? '😄' : x >= 0.5 ? '🙂' : x >= 0.3 ? '😐' : '😟');
const groupColor = (t: BuildTool) => BUILD_GROUPS.find(g => g.tools.includes(t))?.color ?? '#3d8bff';
const costText = (cost: Partial<Record<MatId, number>>) =>
  (Object.entries(cost) as [MatId, number][]).map(([m, n]) => `${MATERIALS[m].icon}${n}`).join(' ');
const haveNeed = (city: City, cost: Partial<Record<MatId, number>>) =>
  (Object.entries(cost) as [MatId, number][]).map(([m, n]) => ({
    text: `${MATERIALS[m].icon} ${Math.min(city.storage[m], n)}/${n}`,
    ok: city.storage[m] >= n,
  }));

export function describeLand(city: City, plot: number, act: CardActions): InfoCard {
  const err = city.canBuyPlot(plot);
  const lines: InfoCard['lines'] = [{ text: 'Boş arazi. Satın alırsan şehrini buraya doğru büyütebilirsin.' }];
  const row = Math.floor(plot / PLOTS);
  if (row < NORTH / PLOT) lines.push({ text: '🏝️ Ada ve deniz: adaya denizin üstünden yol çizerek asma köprü kurabilirsin.' });
  else if (row === NORTH / PLOT) lines.push({ text: '🌊 Sahil arazisi: kumsalına liman, plaj, yat limanı ve deniz feneri kurabilirsin.' });
  if (err && err !== 'Yeterli para yok') lines.push({ ok: false, text: err });
  return {
    title: 'Satılık arazi',
    subtitle: `${PLOT}×${PLOT} kare`,
    icon: '🏞️',
    tone: '#2e7d32',
    stats: [{ icon: '💰', value: fmt(city.landPrice), label: 'Fiyat', bad: city.money < city.landPrice }],
    lines,
    actions: [{ label: `Satın al  💰${fmt(city.landPrice)}`, enabled: err === null, primary: true, run: () => act.buyLand(plot) }],
  };
}

// Yol kartı: çeşidi, etkisi ve bir üst çeşide yükseltme (sokağın düz devamıyla birlikte)
export function describeRoad(city: City, i: number, act: CardActions): InfoCard {
  const t = city.tiles[i]!;
  const grade = t.grade ?? 0;
  const info = ROAD_GRADES[grade];
  const thumb = grade === 0 ? 'road' : info.tool;
  const card: InfoCard = {
    title: info.label,
    subtitle: t.level === 1 ? 'Hemzemin geçit' : 'Şehrin yolları',
    thumb,
    tone: '#546e7a',
    stats: [
      { icon: '😊', value: `+%${Math.round(info.happy * 100)}`, label: 'Kenar evler', good: info.happy > 0 },
      { icon: '🚦', value: `%${Math.round(city.congestion(i) * 100)}`, label: 'Trafik', bad: city.congestion(i) > 1, good: city.congestion(i) < 0.6 },
      { icon: '🚗', value: `${Math.round(city.roadCapacity(i))}`, label: 'Kapasite' },
    ],
    lines: [{ text: 'Yolları yükselterek kenarındaki evleri daha mutlu edebilirsin.' }],
  };
  if (city.congestion(i) > 1) {
    card.lines!.push({ ok: false, text: 'Trafik sıkışık! Yolu yükselt ya da yakınına otobüs durağı, metro veya tren istasyonu kur.' });
  }
  if (grade >= 2) {
    card.lines!.push({ ok: true, text: 'Bu en güzel yol çeşidi.' });
    return card;
  }
  const next = ROAD_GRADES[grade + 1];
  const street = city.streetOf(i).filter(c => (city.tiles[c]?.grade ?? 0) <= grade && city.tiles[c]?.level !== 1);
  const cost = city.costOf(next.tool, street);
  const lock = UNLOCK[next.tool] ?? 0;
  const locked = city.level < lock;
  const blocked = t.level === 1 ? 'Tren yolunun geçtiği yol yükseltilemez' : locked ? `${next.label} şehir seviyesi ${lock}'te açılır` : null;
  card.lines!.push({ text: `${next.label}: ${Math.round(TRAFFIC.capacity * next.capacity)} araç taşır, +%${Math.round(next.happy * 100)} mutluluk. ${street.length} kare yükseltilir (kare başı 💰${fmt(COST[next.tool] - COST[info.tool])}).` });
  if (blocked) card.lines!.push({ ok: false, text: blocked });
  card.actions = [{
    label: `${next.label === 'Cadde' ? 'Caddeye' : 'Bulvara'} yükselt  💰${fmt(cost)}`,
    enabled: !blocked && city.money >= cost && street.length > 0,
    primary: true,
    run: () => act.upgradeRoad(i),
  }];
  return card;
}

export function describeHall(city: City, act: CardActions): InfoCard {
  const happy = city.happiness;
  const pending = Math.floor(city.treasury);
  return {
    title: HALL_INFO.label,
    subtitle: 'Vergiler burada birikir',
    thumb: 'hall',
    tone: '#3949ab',
    stats: [
      { icon: '🏛️', value: `💰${fmt(pending)}`, label: 'Toplanacak', good: pending > 0 },
      { icon: '📈', value: `+${fmt(Math.round(city.dailyTax))}`, label: 'Günlük vergi' },
      { icon: '😊', value: `${mood(happy)} ${pct(happy)}`, label: 'Mutluluk' },
    ],
    lines: [{ text: `Mutlu şehir daha çok vergi öder: şu an x${(0.5 + happy).toFixed(1)}` }],
    actions: [{ label: `Vergiyi topla  💰${fmt(pending)}`, enabled: pending > 0, primary: true, run: () => act.collect() }],
  };
}

// Para göstergesine dokununca: günlük gelir-gider dökümü
export function describeBudget(city: City, act: CardActions): InfoCard {
  const upkeep = { util: 0, service: 0, industry: 0, decor: 0 };
  for (const t of city.tiles) {
    if (!t) continue;
    if (isUtility(t.kind)) upkeep.util += UTILITIES[t.kind].upkeep * (1 + t.level * 0.5);
    else if (isService(t.kind)) upkeep.service += SERVICES[t.kind].upkeep;
    else if (isIndustry(t.kind)) upkeep.industry += INDUSTRY[t.kind].upkeep;
    else if (isDecor(t.kind)) upkeep.decor += DECOR[t.kind].upkeep;
  }
  const income = Math.round(city.dailyTax);
  const net = city.dailyIncome;
  const pending = Math.floor(city.treasury);
  const lines: InfoCard['lines'] = [
    { text: `👥 Konut vergisi: +${fmt(Math.round(city.residentTax))}` },
    { text: `💼 İş yeri vergisi: +${fmt(Math.round(city.jobsTotal * TAX_PER_JOB))}` },
  ];
  if (city.tourism) lines.push({ text: `🏖️ Turizm: +${fmt(city.tourism)}` });
  lines.push({ text: `⚡ Altyapı bakımı: −${fmt(upkeep.util)}` });
  lines.push({ text: `🚒 Hizmet bakımı: −${fmt(upkeep.service)}` });
  if (upkeep.industry) lines.push({ text: `🏭 Sanayi bakımı: −${fmt(upkeep.industry)}` });
  if (upkeep.decor) lines.push({ text: `🎡 Simge yapı bakımı: −${fmt(upkeep.decor)}` });
  if (city.hall !== null) lines.push({ text: 'Vergiler belediyede birikir, oradan toplanır.' });
  return {
    title: 'Bütçe',
    subtitle: 'Günlük gelir ve giderler',
    icon: '💰',
    tone: '#2e7d32',
    stats: [
      { icon: '📈', value: `+${fmt(income)}`, label: 'Gelir' },
      { icon: '📉', value: `−${fmt(city.upkeep)}`, label: 'Gider' },
      { icon: '💰', value: `${net >= 0 ? '+' : ''}${fmt(net)}`, label: 'Günlük kâr', good: net >= 0, bad: net < 0 },
    ],
    lines,
    actions: city.hall !== null
      ? [{ label: `Vergiyi topla  💰${fmt(pending)}`, enabled: pending > 0, primary: true, run: () => act.collect() }]
      : [],
  };
}

// Nüfus ya da seviye göstergesine dokununca: şehrin genel durumu
export function describeCity(city: City, name = 'Aksoy City'): InfoCard {
  const p = city.levelProgress;
  const homes = city.tiles.filter(t => t?.kind === 'res' && t.level > 0).length;
  const shops = city.tiles.filter(t => t && (MAKERS as string[]).includes(t.kind) && t.kind !== 'factory').length;
  return {
    title: name,
    subtitle: `Şehir seviyesi ${p.level} · ${fmt(city.day)}. gün`,
    icon: '🏙️',
    tone: '#1e6fd9',
    stats: [
      { icon: '👥', value: fmt(city.population), label: 'Nüfus' },
      { icon: '💼', value: fmt(city.jobsTotal), label: 'İş yeri' },
      { icon: '😊', value: pct(city.happiness), label: 'Mutluluk' },
    ],
    lines: [
      { text: `🏠 ${fmt(homes)} konut binası, 🏪 ${fmt(shops)} dükkan` },
      { text: p.max ? '⭐ En yüksek seviyedesin!' : `⭐ Sonraki seviye için ${fmt(p.need - p.xp)} XP lazım (${fmt(LEVEL_XP[p.level])})` },
      { text: 'XP kazanmak için: bina yap, evleri yükselt, malzeme üret, görev bitir.' },
    ],
  };
}

// Elektrik ya da su göstergesine dokununca
export function describeUtility(city: City, kind: 'power' | 'water', act: CardActions): InfoCard {
  const { supply, demand } = city.service[kind];
  const isPower = kind === 'power';
  const spare = supply - demand;
  return {
    title: isPower ? 'Elektrik' : 'Su',
    subtitle: isPower ? 'Şehrin elektrik durumu' : 'Şehrin su durumu',
    icon: isPower ? '⚡' : '💧',
    tone: isPower ? '#f59f00' : '#1e88e5',
    stats: [
      { icon: '🏭', value: fmt(supply), label: 'Üretim' },
      { icon: '🏠', value: fmt(demand), label: 'Tüketim' },
      { icon: spare >= 0 ? '✅' : '⚠️', value: `${spare >= 0 ? '+' : ''}${fmt(spare)}`, label: spare >= 0 ? 'Fazla' : 'Eksik', good: spare >= 0, bad: spare < 0 },
    ],
    lines: [
      { ok: spare >= 0, text: spare >= 0 ? 'Yeterli, binalar büyüyebilir.' : 'Yetmiyor! Bazı binalar boş kalıyor.' },
      { text: isPower ? 'Türbin, güneş paneli ya da santral kur.' : 'Su kulesi ya da su pompası kur.' },
    ],
    actions: [{ label: 'Altyapı binalarını göster', enabled: true, primary: spare < 0, run: () => act.openCatalog('utils') }],
  };
}

export function describeQuests(city: City, act: CardActions): InfoCard {
  return {
    title: 'Görevler',
    subtitle: 'Bitir, ödülünü al',
    icon: '📋',
    tone: '#00897b',
    lines: [],
    quests: city.quests.map((q, n) => {
      const prog = Math.min(questProgress(city, q), q.target);
      return {
        text: questText(q),
        progress: Math.max(0, prog) / q.target,
        count: `${fmt(Math.max(0, prog))}/${fmt(q.target)}`,
        reward: `💰${fmt(q.money)}\n⭐${q.xp}`,
        done: questDone(city, q),
        run: () => act.claim(n),
      };
    }),
  };
}

function jobsOf(city: City, i: number, now: number): NonNullable<InfoCard['jobs']> {
  return (city.jobs.get(i) ?? []).map(j => {
    const m = MATERIALS[j.mat];
    const left = Math.ceil((j.end - now) / 1000);
    return {
      text: `${m.icon} ${m.name} · ${left > 0 ? `${left} sn` : 'Hazır, depo dolu!'}`,
      progress: Math.min(1, Math.max(0, 1 - left / m.seconds)),
    };
  });
}

function production(city: City, i: number, act: CardActions, now: number): InfoCard {
  const t = city.tiles[i]!;
  const kind = t.kind as (typeof MAKERS)[number];
  const isFactory = kind === 'factory';
  const list = city.jobs.get(i) ?? [];
  const lines: InfoCard['lines'] = [];
  if (!city.isConnected(i)) lines.push({ ok: false, text: 'Yol bağlantısı yok' });
  const slots = city.makerSlots(i);
  lines.push({ text: isFactory ? `Bir malzemeye dokun, üretim başlasın. Aynı anda ${slots} tane yapar.` : 'Bir ürüne dokun, sıraya girsin. Ürünler sırayla yapılır.' });
  // Yükseltme: daha hızlı üretim ve bir yer daha
  const next = MAKER_LEVELS[t.level + 1];
  const blocker = city.makerUpgradeBlocker(i);
  if (next) {
    const faster = Math.round((1 - next.speed / MAKER_LEVELS[t.level].speed) * 100);
    lines.push({ text: `⭐ ${t.level + 2}. seviye: üretim %${faster} daha hızlı, ${isFactory ? 'aynı anda' : 'sırada'} ${slots + 1} yer.` });
    if (blocker && blocker !== 'Yeterli para yok') lines.push({ ok: false, text: blocker });
  }
  const tiles = MAT_IDS.filter(m => MATERIALS[m].maker === kind).map(m => {
    const mat = MATERIALS[m];
    if (!city.isUnlocked(m)) return { icon: '🔒', name: mat.name, sub: `Seviye ${mat.unlock}`, enabled: false, run: () => {} };
    return {
      icon: productPic(m, 'tpic'),
      name: mat.name,
      sub: mat.needs ? costText(mat.needs) : `${city.makerTime(i, m)} sn`,
      note: mat.needs ? `${city.makerTime(i, m)} sn` : undefined,
      enabled: city.canMake(i, m) === null,
      run: () => act.make(i, m),
    };
  });
  return {
    title: TOOL_INFO[kind].label,
    subtitle: isFactory ? 'Ham madde üretir' : 'Malzemelerden ürün yapar',
    thumb: kind,
    tone: groupColor(kind),
    stats: [
      { icon: '📦', value: `${fmt(city.storageUsed)}/${fmt(city.storageCap)}`, label: 'Depo', bad: city.storageUsed >= city.storageCap },
      { icon: '⚙️', value: `${list.length}/${slots}`, label: isFactory ? 'Üretimde' : 'Sırada' },
      { icon: '⭐', value: `${t.level + 1}/${MAKER_LEVELS.length}`, label: 'Seviye', good: t.level > 0 },
    ],
    lines,
    jobs: jobsOf(city, i, now),
    tiles,
    actions: next
      ? [{ label: `Yükselt ⭐${t.level + 2}  💰${fmt(next.money)}`, enabled: blocker === null, primary: false, run: () => act.upgradeMaker(i) }]
      : undefined,
  };
}

// Liman: komşu şehirlerin siparişleri. Gönderince para ve XP gelir, gemi dönünce yeni sipariş gelir.
export function describePort(city: City, act: CardActions, now = Date.now()): InfoCard {
  const lines: InfoCard['lines'] = [];
  if (!city.hasPort) lines.push({ ok: false, text: 'Liman yola bağlı değil' });
  lines.push({ text: 'Komşu şehirler mal istiyor. Depondaki mallarla siparişi gönder, ödülü hemen al.' });
  const waiting = city.orders.filter(o => !o.until).length;
  return {
    title: 'Liman',
    subtitle: 'Şehirler arası ticaret',
    thumb: 'port',
    tone: '#0277bd',
    stats: [
      { icon: '📦', value: `${fmt(city.storageUsed)}/${fmt(city.storageCap)}`, label: 'Depo' },
      { icon: '🚢', value: fmt(city.stats.ships ?? 0), label: 'Gönderilen' },
    ],
    lines,
    quests: city.orders.map((o, n) => {
      if (o.until > now) {
        const left = Math.ceil((o.until - now) / 1000);
        return { text: `🚢 ${o.from} yolunda`, progress: 0, count: `Gemi ${left} sn sonra yeni siparişle döner`, reward: 'Yolda', done: false, run: () => {} };
      }
      const items = (Object.entries(o.items) as [MatId, number][]);
      const have = items.reduce((s, [m, k]) => s + Math.min(city.storage[m], k), 0);
      const need = items.reduce((s, [, k]) => s + k, 0);
      return {
        text: `🏙️ ${o.from}`,
        // İstenen mallar resimleriyle: depoda olan / istenen
        pics: items.map(([m, k]) => `<span class="qi${city.storage[m] >= k ? '' : ' no'}">${productPic(m, 'qpic')}<b>${Math.min(city.storage[m], k)}/${k}</b></span>`).join(''),
        progress: have / need,
        count: `${items.map(([m, k]) => `${MATERIALS[m].name} ${k}`).join(' · ')}`,
        reward: `💰${fmt(o.money)}\n⭐${o.xp}`,
        done: city.orderBlocker(n, now) === null,
        button: 'Gönder',
        run: () => act.ship(n),
      };
    }),
    actions: [{ label: `🔄 Bekleyen siparişleri değiştir  💰${fmt(city.renewCost)}`, enabled: waiting > 0 && city.money >= city.renewCost, run: () => act.renewOrders() }],
  };
}

export function describeStorage(city: City): InfoCard {
  const have = MAT_IDS.filter(m => city.storage[m] > 0);
  const lines: InfoCard['lines'] = [];
  if (!have.length) lines.push({ text: 'Depo boş. Fabrikada metal ve odun üret.' });
  lines.push({ text: `Her yeni depo binası ${DEPOT_STORAGE} yer ekler (Sanayi menüsü).` });
  return {
    title: 'Depo',
    subtitle: `${fmt(city.storageUsed)}/${fmt(city.storageCap)} dolu`,
    icon: '📦',
    tone: '#8d6e63',
    lines,
    // Depodaki mallar resimleriyle (ham maddeler ve ürünler ayrı)
    tiles: have.map(m => ({
      icon: productPic(m, 'tpic'),
      name: MATERIALS[m].name,
      sub: `${fmt(city.storage[m])} tane`,
      section: MATERIALS[m].maker === 'factory' ? 'Ham maddeler' : 'Ürünler',
      enabled: true,
      run: () => {},
    })).sort((a, b) => (a.section === b.section ? 0 : a.section === 'Ham maddeler' ? -1 : 1)),
  };
}

export function describeTile(city: City, i: number, act: CardActions, now = Date.now()): InfoCard | null {
  if (city.tiles[i]?.kind === 'part') return describeTile(city, city.anchorOf(i), act, now);
  const t = city.tiles[i];
  if (!city.isOwned(i) && t?.kind !== 'road') return describeLand(city, city.plotOf(i), act);
  if (t?.kind === 'road') return describeRoad(city, i, act);
  if (!t || t.kind === 'rail') return null;
  const connected = city.isConnected(i);
  const road = { ok: connected, text: connected ? 'Şehrin yollarına bağlı' : 'Yol bağlantısı yok' };

  if (t.kind === 'hall') return describeHall(city, act);
  if (t.kind === 'port') return describePort(city, act, now);
  if ((MAKERS as string[]).includes(t.kind)) return production(city, i, act, now);
  if (t.kind === 'depot') return { ...describeStorage(city), thumb: 'depot', icon: undefined };

  if (t.kind === 'res' || t.kind === 'com') {
    const isRes = t.kind === 'res';
    const levels = isRes ? RES_LEVELS : COM_LEVELS;
    const name = isRes ? 'Konut' : 'Ticaret';
    const tone = isRes ? '#43a047' : '#1e88e5';
    if (t.level === 0) {
      return {
        title: `${name} arsası`,
        subtitle: 'Boş arsa',
        thumb: t.kind,
        tone,
        lines: [road, { text: connected ? 'Elektrik ve su yeterliyse yakında bina yapılacak.' : 'Bina yapılması için yolu şehre bağla.' }],
      };
    }
    if (t.fire) {
      return {
        title: `${name} yanıyor!`,
        subtitle: `${FIRE.days - t.fire + 1} gün içinde söndürülmeli`,
        icon: '🔥',
        tone: '#e64a19',
        lines: [
          { ok: false, text: 'Söndürülmezse bina yıkılır.' },
          { text: 'İtfaiyenin kapsadığı yerlerde yangın kendiliğinden söner.' },
        ],
        actions: [{ label: `Söndür  💰${FIRE.cost}`, enabled: city.money >= FIRE.cost, primary: true, run: () => act.extinguish(i) }],
      };
    }
    if (t.damaged) {
      return {
        title: `${name} hasarlı`,
        subtitle: 'Depremde hasar gördü',
        icon: '🔧',
        tone: '#607d8b',
        lines: [{ ok: false, text: 'Onarılana kadar kimse yaşamaz.' }],
        cost: haveNeed(city, QUAKE.repair),
        actions: [{ label: 'Onar', enabled: city.hasMaterials(QUAKE.repair), primary: true, run: () => act.repair(i) }],
      };
    }
    const lack = city.lacking.get(i);
    const served = connected && !lack;
    const stats: NonNullable<InfoCard['stats']> = [];
    const lines: InfoCard['lines'] = [];
    if (isRes) {
      stats.push({ icon: '👥', value: fmt(served ? RES_LEVELS[t.level - 1].pop : 0), label: 'Kişi' });
      stats.push({ icon: '😊', value: `${mood(city.happy[i])} ${pct(city.happy[i])}`, label: 'Mutluluk' });
    } else stats.push({ icon: '💼', value: fmt(served ? COM_LEVELS[t.level - 1].jobs : 0), label: 'Çalışan' });
    stats.push({ icon: '⚡', value: lack?.power ? 'Yok' : 'Var', label: 'Elektrik', bad: !!lack?.power, good: !lack?.power });
    stats.push({ icon: '💧', value: lack?.water ? 'Yok' : 'Var', label: 'Su', bad: !!lack?.water, good: !lack?.water });
    if (!connected) lines.push(road);
    if (isRes && city.polluted(i)) lines.push({ ok: false, text: 'Yakında fabrika ya da santral var (kirlilik)' });
    let actions: InfoCard['actions'];
    let cost: InfoCard['cost'];
    if (isRes) {
      // Sonraki seviyelerin şartları
      if (t.level < 3) lines.push({ ok: city.parkNear(i), text: '3. seviye için: yakında park' });
      if (t.level < 4) lines.push({ ok: city.shopNear(i), text: '4. seviye için: yakında dükkan (Sanayi)' });
      if (t.level < 5) {
        const missing = SERVICE_KINDS.filter(k => !city.isCovered(i, k)).map(k => SERVICES[k].name);
        lines.push({ ok: missing.length === 0, text: missing.length ? `5. seviye için eksik: ${missing.join(', ')}` : '5. seviye için: bütün hizmetler var' });
      }
      if (t.level < 6) lines.push({ ok: city.decorBonus[i] >= 0.1 - 1e-6, text: '6. seviye için: yakında simge yapı (heykel, stadyum…)' });
      if (t.level < 7) lines.push({ ok: city.bestRoad(i) >= 1, text: '7. seviye (gökdelen) için: yanındaki yol bulvar ya da cadde' });
      if (t.level < 8) lines.push({ ok: city.transit[i] >= 0.25, text: '8. seviye (dev gökdelen) için: yakında metro ya da tren istasyonu' });
      const upCost = city.upgradeCost(i);
      if (upCost) {
        const blocker = city.upgradeBlocker(i);
        if (blocker) lines.push({ ok: false, text: blocker });
        cost = haveNeed(city, upCost);
        actions = [{ label: `Yükselt → ${t.level + 1}. seviye`, enabled: city.canUpgrade(i), primary: true, run: () => act.upgrade(i) }];
      }
    } else {
      if (connected) lines.push(road);
      if (t.level < COM_LEVELS.length) {
        const needPop = t.level * POP_PER_COM_LEVEL;
        lines.push({ ok: city.population >= needPop, text: `${t.level + 1}. seviye için: ${fmt(needPop)} nüfus` });
      }
    }
    return {
      title: name,
      subtitle: `Seviye ${t.level}/${levels.length}${'  ' + '★'.repeat(t.level)}`,
      thumb: t.kind,
      tone,
      stats,
      lines,
      cost,
      actions,
    };
  }

  if (t.kind === 'park') {
    return {
      title: 'Park',
      subtitle: 'Yeşil alan',
      thumb: 'park',
      tone: groupColor('park'),
      lines: [{ text: `Çevresindeki ${PARK_RADIUS} kare içindeki evler 3. seviyeye çıkabilir ve daha mutlu olur.` }],
    };
  }

  if (t.kind === 'metro') {
    const L = city.metroLines();
    const s = L.stationList.find(x => x.i === i);
    const line = s ? s.line : -1;
    const active = line >= 0 && L.active[line];
    const next = METRO_LEVELS[t.level + 1];
    const blocker = city.metroUpgradeBlocker(i);
    const lines: InfoCard['lines'] = [
      active
        ? { ok: true, text: `🚇 M${L.colorOf[line] + 1} hattında, ${L.stations[line].length} istasyon bağlı. Trenler çalışıyor; çevresi daha mutlu, trafik daha az.` }
        : line >= 0
          ? { ok: false, text: '⚠️ Hat başka bir istasyona ulaşmıyor. Yeraltından bir istasyona daha bağla.' }
          : { ok: false, text: '⚠️ Altından metro hattı geçmiyor. İnşa Et → Ulaşım → Metro hattı ile yeraltından tünel çiz.' },
      road,
    ];
    if (next) lines.push({ text: `⬆️ Yükseltince istasyon büyür, ${next.radius} kare çevreye hizmet verir.${blocker && blocker !== 'Yeterli para yok' ? ` (${blocker})` : ''}` });
    const actions: NonNullable<InfoCard['actions']> = [{ label: '🚇 Metro hatlarını göster', enabled: true, run: () => act.showMetro() }];
    if (next) actions.unshift({ label: `Yükselt ⭐${t.level + 2}  💰${fmt(next.cost)}`, enabled: blocker === null, primary: true, run: () => act.upgradeMetro(i) });
    return {
      title: 'Metro istasyonu',
      subtitle: active ? `M${L.colorOf[line] + 1} hattı` : 'Hatta bağlı değil',
      thumb: 'metro',
      tone: groupColor('metro'),
      stats: [
        { icon: '😊', value: `+${pct(city.decorHappy(i))}`, label: `${city.decorRadius(i)} kare çevre` },
        { icon: '⭐', value: `${t.level + 1}/${METRO_LEVELS.length}`, label: 'Seviye', good: t.level > 0 },
        { icon: '🔧', value: `−${DECOR.metro.upkeep + t.level * 3}`, label: 'Günlük bakım' },
      ],
      lines,
      actions,
    };
  }

  if (t.kind === 'parking') {
    const lv = PARKING_LEVELS[t.level];
    const next = PARKING_LEVELS[t.level + 1];
    const blocker = city.parkingUpgradeBlocker(i);
    const lines: InfoCard['lines'] = [
      { text: t.level ? '🚗 Arabalar girişten girip katlara park eder; insanlar arabalarını alıp şehre çıkar.' : '🚗 Yakındaki evlerin arabaları burada durur; insanlar evlerinden yürüyüp arabalarına biner.' },
      { text: city.isConnected(i) ? '✅ Şehrin yollarına bağlı' : '⚠️ Yola bağlı değil', ok: city.isConnected(i) },
    ];
    if (next) lines.push({ text: `⬆️ Yükseltince ${next.floors} katlı otopark olur, ${next.cars} araba sığar.${blocker && blocker !== 'Yeterli para yok' ? ` (${blocker})` : ''}` });
    else lines.push({ text: '⭐ En üst seviyede: 5 katlı otopark.' });
    return {
      title: t.level ? `${lv.floors} katlı otopark` : 'Otopark',
      subtitle: t.level ? 'Katlı otopark' : 'Açık otopark',
      thumb: 'parking',
      tone: groupColor('parking'),
      stats: [
        { icon: '🚗', value: `${lv.cars}`, label: 'Araba yeri' },
        { icon: '⭐', value: `${t.level + 1}/${PARKING_LEVELS.length}`, label: 'Seviye', good: t.level > 0 },
        { icon: '🔧', value: `−${DECOR.parking.upkeep + t.level}`, label: 'Günlük bakım' },
      ],
      lines,
      actions: next
        ? [{ label: `Yükselt: ${next.floors} kat  💰${fmt(next.cost)}`, enabled: blocker === null, primary: true, run: () => act.upgradeParking(i) }]
        : undefined,
    };
  }

  if (isDecor(t.kind)) {
    const d = DECOR[t.kind];
    const lines: InfoCard['lines'] = [];
    if (t.kind === 'station') lines.push({ text: '🚆 Trenler bu istasyondan sefer yapar.' });
    if (t.kind === 'busstop') lines.push({ text: '🚌 Her durak için şehirde bir otobüs dolaşır.' });
    if (t.kind === 'uni') lines.push({ text: '🎓 Çevresindeki geniş alanda okul hizmeti verir.' });
    if (t.kind === 'airport') lines.push({ text: '✈️ Uçaklar kalkıp iner; turistler her gün para getirir.' });
    if (d.road) lines.push(road);
    const stats: NonNullable<InfoCard['stats']> = [
      { icon: '😊', value: `+${pct(d.happy)}`, label: `${d.radius} kare çevre` },
      { icon: '🔧', value: `−${d.upkeep}`, label: 'Günlük bakım' },
    ];
    if (d.income) stats.unshift({ icon: '✈️', value: `+${fmt(d.income)}`, label: 'Turist/gün', good: true });
    return { title: TOOL_INFO[t.kind].label, subtitle: 'Simge yapı', thumb: t.kind, tone: groupColor(t.kind), stats, lines };
  }

  if (isUtility(t.kind)) {
    const u = UTILITIES[t.kind];
    const mult = UTIL_LEVELS[t.level]?.mult ?? 1;
    const next = UTIL_LEVELS[t.level + 1];
    const cost = city.utilUpgradeCost(i);
    const blocker = city.utilUpgradeBlocker(i);
    const lines: InfoCard['lines'] = [road];
    if (next) lines.push({ text: `⬆️ Yükseltince bina büyür, aynı yerde ${next.mult} kat ${u.power ? 'elektrik' : 'su'} verir.${blocker && blocker !== 'Yeterli para yok' ? ` (${blocker})` : ''}` });
    else lines.push({ text: '⭐ En üst seviyede: en çok üretim.' });
    return {
      title: TOOL_INFO[t.kind].label,
      subtitle: u.power ? 'Elektrik üretir' : 'Su verir',
      thumb: t.kind,
      tone: groupColor(t.kind),
      stats: [
        { icon: u.power ? '⚡' : '💧', value: `+${(u.power || u.water) * mult}`, label: u.power ? 'Elektrik' : 'Su' },
        { icon: '⭐', value: `${t.level + 1}/${UTIL_LEVELS.length}`, label: 'Seviye', good: t.level > 0 },
        { icon: '🔧', value: `−${Math.round(u.upkeep * (1 + t.level * 0.5))}`, label: 'Günlük bakım' },
      ],
      lines,
      actions: next && cost !== null
        ? [{ label: `Yükselt ⭐${t.level + 2}  💰${fmt(cost)}`, enabled: blocker === null, primary: true, run: () => act.upgradeUtil(i) }]
        : undefined,
    };
  }

  if (isService(t.kind)) {
    const s = SERVICES[t.kind];
    const homes = serviceArea(i, t.kind, t.fp ?? 1).filter(c => city.tiles[c]?.kind === 'res' && city.tiles[c]!.level > 0).length;
    return {
      title: TOOL_INFO[t.kind].label,
      subtitle: 'Hizmet binası',
      thumb: t.kind,
      tone: s.color,
      stats: [
        { icon: '📏', value: `${s.radius} kare`, label: 'Kapsama' },
        { icon: '🏠', value: fmt(homes), label: 'Konut' },
        { icon: '🔧', value: `−${s.upkeep}`, label: 'Bakım' },
      ],
      lines: [road],
    };
  }
  return null;
}
