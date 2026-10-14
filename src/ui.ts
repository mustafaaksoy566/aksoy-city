import {
  BUILD_GROUPS, TOOL_INFO, COST, FOOTPRINT, UTILITIES, SERVICES, SERVICE_LEVELS, serviceRadius, UTIL_LEVELS, DECOR, MATERIALS, MAT_IDS, DEPOT_STORAGE,
  RES_LEVELS, HOUSE_PRICE, houseName, perDay,
  type Tool, type BuildTool, type BuildGroup,
} from './config';
import { isUtility, isService, isDecor, type Service } from './city';
import type { InfoCard } from './info';
import { icon, fillIcons, ICONS } from './icons';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('tr-TR');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

fillIcons();

// Araç kilitli mi? (main.ts şehrin seviyesine göre cevaplar)
export type LockInfo = (t: Tool) => number | null;

// --- Menü resimleri (binaların 3D modelinden çizilen küçük resimler) ---
let thumbs = new Map<string, string>();

// Resim varsa resim, yoksa emoji
function picture(key: string | undefined, emoji = '') {
  const src = key ? thumbs.get(key) : undefined;
  return src ? `<img src="${src}" alt="">` : `<span class="emo">${emoji}</span>`;
}

// Bir binanın menü resmi (yoksa undefined)
export const thumbOf = (key: string) => thumbs.get(key);

export function setThumbs(map: Map<string, string>) {
  thumbs = new Map([...thumbs, ...map]);
  document.querySelectorAll<HTMLElement>('[data-thumb]').forEach(el => {
    const src = thumbs.get(el.dataset.thumb!);
    if (src && !el.querySelector('img')) el.innerHTML = `<img src="${src}" alt="">`;
  });
}

// --- İnşa paneli ---

// Kartın altında görünen kısa bilgi
function effectOf(t: BuildTool): string {
  if (isUtility(t)) {
    const u = UTILITIES[t];
    const top = UTIL_LEVELS[t][UTIL_LEVELS[t].length - 1].mult;
    return u.power ? `⚡ +${u.power} elektrik · en çok ${u.power * top}` : `💧 +${u.water} su · en çok ${u.water * top}`;
  }
  if (isService(t)) return `📏 ${SERVICES[t].radius} kare alan · yükseltince ${serviceRadius(t, SERVICE_LEVELS.length - 1)}`;
  if (isDecor(t)) {
    const d = DECOR[t];
    if (t === 'station') return '🚆 Tren seferleri';
    if (t === 'busstop') return '🚌 Otobüs hattı';
    if (t === 'parking') return '🚗 3 araçlık park yeri';
    if (t === 'beach') return `🏖️ +${fmt(perDay(d.income ?? 0))}/gün, su kıyısı`;
    if (t === 'marina') return `⛵ +${fmt(perDay(d.income ?? 0))}/gün, deniz kıyısı`;
    if (t === 'lighthouse') return `🗼 +${fmt(perDay(d.income ?? 0))}/gün, deniz kıyısı`;
    if (d.income) return `✈️ +${fmt(perDay(d.income))}/gün turist`;
    if (d.covers) return `🎓 ${d.radius} kare okul alanı`;
    return `😊 Mutluluk +%${Math.round(d.happy * 100)}`;
  }
  switch (t) {
    case 'road': return 'Her şeyi birbirine bağlar';
    case 'boulevard': return '🌷 Kenar evler +%8 mutlu';
    case 'avenue': return '🛣️ Çift şerit, 3 kat araç';
    case 'rail': return 'Trenler için ray';
    case 'res': return '🌱 Kendiliğinden büyür';
    case 'com': return '💼 Dükkan ve ofisler';
    case 'park': return '🌳 Evler büyüyebilir';
    case 'factory': return '🔩 Ham madde üretir';
    case 'depot': return `📦 +${DEPOT_STORAGE} depo yeri`;
    case 'port': return '🚢 Komşu şehirlere sat';
    case 'store': case 'market': case 'furniture': case 'bakery': case 'fashion': case 'garden': case 'cafe': case 'electro':
      return MAT_IDS.filter(m => MATERIALS[m].maker === t).map(m => MATERIALS[m].name).join(', ');
  }
  return '';
}
const PER_TILE: BuildTool[] = ['road', 'avenue', 'boulevard', 'rail', 'tunnel', 'res', 'com', 'park'];

export interface Catalog {
  open(group?: string): void;
  close(): void;
  isOpen(): boolean;
}

// Konut sekmesindeki ev modelleri: seçilen model doğrudan o seviyede kurulur
export interface HouseMenu {
  pick(level: number, model: number): void;
  lock(level: number): number | null;
  pictures(): void; // resimleri ilk açılışta çizdir
}

export function buildCatalog(onPick: (t: BuildTool) => void, lockedAt: LockInfo, money: () => number, houses: HouseMenu): Catalog {
  const panel = $('catalog');
  const tabs = panel.querySelector('.tabs')!;
  const cards = panel.querySelector('.cards')!;
  let group = BUILD_GROUPS[0].group;

  const card = (t: BuildTool, g: BuildGroup) => {
    const info = TOOL_INFO[t];
    const lock = lockedAt(t);
    const n = FOOTPRINT[t] ?? 1;
    const b = document.createElement('button');
    b.className = 'card' + (lock ? ' locked' : COST[t] > money() ? ' poor' : '');
    b.style.setProperty('--c', g.color);
    const price = lock
      ? `<span class="price">${icon('lock')}Seviye ${lock}</span>`
      : `<span class="price">${icon('coin')}${fmt(COST[t])}${PER_TILE.includes(t) ? '<small>/kare</small>' : ''}</span>`;
    b.innerHTML = `<span class="pic" data-thumb="${t}">${picture(t, info.icon)}</span>${n > 1 ? `<span class="size">${n}×${n}</span>` : ''}<b class="name">${info.label}</b><span class="eff">${effectOf(t)}</span>${price}`;
    b.addEventListener('click', () => onPick(t));
    return b;
  };

  // Her seviyenin bütün ev modelleri; seviyeler arasında küçük bir başlık
  const houseCards = (g: BuildGroup) => {
    const out: HTMLElement[] = [];
    RES_LEVELS.forEach((lv, l) => {
      const level = l + 1;
      const lock = houses.lock(level);
      const sep = document.createElement('div');
      sep.className = 'card-sep';
      sep.innerHTML = `<b>${level}</b><small>seviye</small>`;
      out.push(sep);
      lv.models.forEach((path, m) => {
        const key = `house:${level}:${m}`;
        const b = document.createElement('button');
        b.className = 'card' + (lock ? ' locked' : HOUSE_PRICE[level] > money() ? ' poor' : '');
        b.style.setProperty('--c', g.color);
        const price = lock
          ? `<span class="price">${icon('lock')}Seviye ${lock}</span>`
          : `<span class="price">${icon('coin')}${fmt(HOUSE_PRICE[level])}</span>`;
        b.innerHTML = `<span class="pic" data-thumb="${key}">${picture(key, '🏠')}</span><span class="size">⭐ ${level}</span><b class="name">${houseName(path)}</b><span class="eff">👥 ${lv.pop} kişi</span>${price}`;
        b.addEventListener('click', () => houses.pick(level, m));
        out.push(b);
      });
    });
    return out;
  };

  const render = () => {
    tabs.replaceChildren(
      ...BUILD_GROUPS.map(g => {
        const b = document.createElement('button');
        b.className = 'tab' + (g.group === group ? ' on' : '');
        b.style.setProperty('--c', g.color);
        b.innerHTML = `<span class="tp" data-thumb="${g.tools[0]}">${picture(g.tools[0], g.icon)}</span>${g.label}`;
        b.addEventListener('click', () => {
          group = g.group;
          render();
          cards.scrollLeft = 0;
        });
        return b;
      }),
    );
    const g = BUILD_GROUPS.find(x => x.group === group)!;
    cards.replaceChildren(...g.tools.map(t => card(t, g)), ...(g.group === 'zones' ? houseCards(g) : []));
    if (g.group === 'zones') houses.pictures();
    requestAnimationFrame(arrows);
  };

  const close = () => {
    panel.hidden = true;
    syncSheet();
  };
  panel.querySelector('.cat-close')!.addEventListener('click', close);
  // Bilgisayarda: tekerlek yana kaydırsın, fareyle tutup sürüklenebilsin, oklar kaydırsın
  for (const row of [cards, tabs] as HTMLElement[]) scrollable(row);
  panel.querySelector('.cat-arrow.left')!.addEventListener('click', () => cards.scrollBy({ left: -360, behavior: 'smooth' }));
  panel.querySelector('.cat-arrow.right')!.addEventListener('click', () => cards.scrollBy({ left: 360, behavior: 'smooth' }));
  const arrows = () => {
    const max = cards.scrollWidth - cards.clientWidth;
    panel.querySelector<HTMLElement>('.cat-arrow.left')!.classList.toggle('off', cards.scrollLeft <= 2);
    panel.querySelector<HTMLElement>('.cat-arrow.right')!.classList.toggle('off', cards.scrollLeft >= max - 2);
  };
  cards.addEventListener('scroll', arrows);
  document.getElementById('app')!.addEventListener('pointerdown', () => !panel.hidden && close());

  return {
    open(g?: string) {
      if (g) group = g;
      render();
      $('info').hidden = true;
      panel.hidden = false;
      syncSheet();
    },
    close,
    isOpen: () => !panel.hidden,
  };
}

// Yatay kayan satır: fare tekerleği yana kaydırır, fareyle tutup sürüklenebilir (sürüklerken tıklama sayılmaz)
function scrollable(row: HTMLElement) {
  row.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    row.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  let drag: { x: number; left: number; moved: boolean } | null = null;
  row.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, left: row.scrollLeft, moved: false };
  });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 5) drag.moved = true;
    if (drag.moved) {
      row.style.scrollSnapType = 'none';
      row.scrollLeft = drag.left - dx;
    }
  });
  window.addEventListener('pointerup', () => {
    if (drag?.moved) {
      // Sürükleme bitince hemen gelen tıklamayı yut
      const stop = (ev: Event) => ev.stopPropagation();
      row.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => row.removeEventListener('click', stop, { capture: true }), 50);
    }
    row.style.scrollSnapType = '';
    drag = null;
  });
}

// Panel ya da kart açıkken alttaki düğmeler gizlensin
function syncSheet() {
  document.body.classList.toggle('sheet', !$('catalog').hidden || !$('info').hidden);
}

// --- Seçili araç çubuğu ---
export function setMode(tool: Tool, custom?: { thumb: string; label: string; hint: string }) {
  const el = $('mode');
  document.body.classList.toggle('building', tool !== 'pan');
  $('bulldoze').classList.toggle('on', tool === 'bulldoze');
  if (tool === 'pan') {
    el.hidden = true;
    return;
  }
  const info = TOOL_INFO[tool];
  const danger = tool === 'bulldoze';
  el.classList.toggle('danger', danger);
  el.querySelector('.mode-pic')!.innerHTML = danger ? icon('bulldozer') : picture(custom?.thumb ?? tool, info.icon);
  el.querySelector('.mode-txt b')!.textContent = danger ? 'Yıkım modu' : custom?.label ?? info.label;
  el.querySelector('.mode-txt small')!.textContent = custom?.hint ?? info.hint;
  el.hidden = false;
}

// --- Üstteki göstergeler ---
export interface Stats {
  money: number;
  pop: number;
  income: number;
  service: Service;
  level: { level: number; xp: number; need: number; max: boolean };
  storage: { used: number; cap: number };
  happiness: number;
  questsReady: number;
  achReady: number;
  day: number;
  night: boolean;
}

// Üstte şehrin adı
export function setCityName(name: string) {
  $('city-name').textContent = name;
}

export function setStats(s: Stats) {
  $('money-v').textContent = fmt(s.money);
  $('income-v').textContent = `${s.income >= 0 ? '+' : ''}${fmt(perDay(s.income))}/gün`;
  $('income-v').classList.toggle('neg', s.income < 0);
  $('pop-v').textContent = fmt(s.pop);
  $('lvl-v').textContent = String(s.level.level);
  $('xp-bar').style.width = `${s.level.max ? 100 : Math.round((s.level.xp / s.level.need) * 100)}%`;
  for (const k of ['power', 'water'] as const) {
    const { supply, demand } = s.service[k];
    $(`${k}-v`).textContent = `${fmt(demand)}/${fmt(supply)}`;
    $(k).classList.toggle('short', demand > supply);
  }
  $('storage-v').textContent = `${fmt(s.storage.used)}/${fmt(s.storage.cap)}`;
  $('storage').classList.toggle('short', s.storage.used >= s.storage.cap);
  $('happy-v').textContent = `%${Math.round(s.happiness * 100)}`;
  $('day-v').textContent = `${fmt(s.day)}. gün`;
  const clock = $('clock-ic');
  if (clock.dataset.night !== String(s.night)) {
    clock.dataset.night = String(s.night);
    clock.innerHTML = ICONS[s.night ? 'moon' : 'sun'];
  }
  const badge = $('quests-badge');
  badge.textContent = String(s.questsReady);
  badge.hidden = s.questsReady === 0;
  const ach = $('ach-badge');
  ach.textContent = String(s.achReady);
  ach.hidden = s.achReady === 0;
}

// --- Mesajlar ---
let toastTimer = 0;
export function toast(msg: string, kind: 'info' | 'error' = 'info') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.className = kind), 3200);
}

// Sürüklerken toplam maliyeti göster
// --- Hizmet haritası çubuğu (SimCity'deki gibi): hizmetin adı, kaç binaya ulaşıyor, oklarla diğer hizmetler ---
// Altta bütün hizmetlerin simgeleri (SimCity gibi): seçili olan renkli, dokununca o hizmete geçer
export interface ServiceBar {
  icon: string; name: string; ok: number; bad: number; extra: string; okText: string; badText: string;
  kinds?: { key: string; icon: string; name: string }[]; current?: string;
}
type SvcHandlers = { prev(): void; next(): void; close(): void; pick?(key: string): void };
let svcBar: HTMLDivElement | null = null;
let svcOn: SvcHandlers | null = null;
export function setServiceBar(s: ServiceBar | null, on?: SvcHandlers) {
  if (!s) {
    svcBar?.remove();
    svcBar = null;
    return;
  }
  if (on) svcOn = on;
  if (!svcBar) {
    svcBar = document.createElement('div');
    svcBar.id = 'svcbar';
    svcBar.innerHTML = `<button class="sv-arrow" data-a="prev" aria-label="Önceki hizmet">‹</button>
      <div class="sv-mid"><b class="sv-title"></b>
        <span class="sv-legend"><i class="dot ok"></i><span class="sv-ok"></span><i class="dot bad"></i><span class="sv-bad"></span></span>
        <small class="sv-extra"></small><span class="sv-kinds"></span></div>
      <button class="sv-arrow" data-a="next" aria-label="Sonraki hizmet">›</button>
      <button class="sv-close" data-a="close" aria-label="Kapat">${icon('close')}</button>`;
    svcBar.addEventListener('pointerdown', e => e.stopPropagation());
    svcBar.addEventListener('click', e => {
      const kind = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k;
      if (kind) return svcOn?.pick?.(kind);
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a as 'prev' | 'next' | 'close' | undefined;
      if (a && svcOn) svcOn[a]();
    });
    document.body.appendChild(svcBar);
  }
  svcBar.querySelector('.sv-title')!.textContent = `${s.icon} ${s.name}`;
  svcBar.querySelector('.sv-ok')!.textContent = `${s.okText} ${fmt(s.ok)}`;
  svcBar.querySelector('.sv-bad')!.textContent = `${s.badText} ${fmt(s.bad)}`;
  svcBar.querySelector('.sv-extra')!.textContent = s.extra;
  const row = svcBar.querySelector<HTMLElement>('.sv-kinds')!;
  row.innerHTML = (s.kinds ?? []).map(k => `<button data-k="${k.key}" class="${k.key === s.current ? 'on' : ''}" aria-label="${k.name}" title="${k.name}">${k.icon}</button>`).join('');
}

// --- Taşıma/döndürme onayı: ✗ eski yerine, ↻ döndür, ✓ yerleştir ---
let placeBar: HTMLDivElement | null = null;
let placeOn: { ok(): void; cancel(): void; rotate(): void } | null = null;
export function setPlaceBar(on: boolean, handlers?: { ok(): void; cancel(): void; rotate(): void }) {
  if (!on) {
    placeBar?.remove();
    placeBar = null;
    return;
  }
  if (handlers) placeOn = handlers;
  if (placeBar) return;
  placeBar = document.createElement('div');
  placeBar.id = 'placebar';
  placeBar.innerHTML = `<button class="pb no" data-a="cancel" aria-label="Vazgeç, eski yerine koy">${icon('close')}<small>Vazgeç</small></button>
    <button class="pb turn" data-a="rotate" aria-label="Döndür">${icon('rotateRight')}<small>Döndür</small></button>
    <button class="pb yes" data-a="ok" aria-label="Onayla, buraya yerleştir">${icon('check')}<small>Tamam</small></button>`;
  placeBar.addEventListener('pointerdown', e => e.stopPropagation());
  placeBar.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a as 'ok' | 'cancel' | 'rotate' | undefined;
    if (a && placeOn) placeOn[a]();
  });
  document.body.appendChild(placeBar);
}

export function setChip(text: string | null) {
  const el = $('chip');
  el.hidden = !text;
  if (text) el.textContent = text;
}

// Para ya da depo düğmesinin yanında kısa süre uçan yazı
export function floatText(anchor: string, text: string, neg = false) {
  const el = document.createElement('div');
  el.className = neg ? 'float neg' : 'float';
  el.textContent = text;
  $(anchor).appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

export function floatIncome(n: number) {
  if (n !== 0) floatText('money', `${n > 0 ? '+' : ''}${fmt(n)}`, n < 0);
}

// --- Bilgi kartı ---
// Kart açıkken saniyede birkaç kez yenilenir. Düğmeler aynı kaldıkça yerinde güncellenir,
// yoksa yeniden çizilir (böylece dokunurken düğme kaybolmaz).

const signature = (c: InfoCard) =>
  [
    c.title, c.subtitle, c.thumb, c.icon, c.lines.length, c.stats?.length ?? 0, c.jobs?.length ?? 0, c.cost?.length ?? 0,
    (c.tiles ?? []).map(t => t.section + t.name).join(','), c.quests?.length ?? 0, c.chart?.length ?? 0, ...(c.actions ?? []).map(a => a.label),
  ].join('|');

let runs: { tiles: (() => void)[]; quests: (() => void)[]; actions: (() => void)[] } = { tiles: [], quests: [], actions: [] };
let onClose: (() => void) | null = null;

export function onInfoClose(fn: () => void) {
  onClose = fn;
}

export function showInfo(card: InfoCard | null) {
  const el = $('info');
  if (!card) {
    el.hidden = true;
    el.dataset.sig = '';
    syncSheet();
    return;
  }
  runs = {
    tiles: (card.tiles ?? []).map(t => t.run),
    quests: (card.quests ?? []).map(q => q.run),
    actions: (card.actions ?? []).map(a => a.run),
  };
  const sig = signature(card);
  if (!el.hidden && el.dataset.sig === sig) {
    update(el, card);
    return;
  }
  el.dataset.sig = sig;
  const statHtml = (card.stats ?? [])
    .map(s => `<div class="stat${s.bad ? ' bad' : s.good ? ' good' : ''}"><span class="sv">${esc(s.value)}</span><span class="sl">${s.icon} ${esc(s.label)}</span></div>`)
    .join('');
  let tilesHtml = '';
  let section: string | undefined;
  (card.tiles ?? []).forEach((t, n) => {
    if (t.section && t.section !== section) {
      section = t.section;
      tilesHtml += `<div class="tsec">${esc(t.section)}</div>`;
    }
    tilesHtml += `<button class="tile" data-n="${n}"><span class="ti">${t.icon}</span><b>${esc(t.name)}</b><small>${esc(t.sub)}</small>${t.note ? `<span class="tn">${esc(t.note)}</span>` : ''}</button>`;
  });
  const questHtml = (card.quests ?? [])
    .map((q, n) => `<div class="quest"><span class="qt"></span>${q.pics !== undefined ? '<span class="qp"></span>' : ''}<span class="qbar"><i></i></span><span class="qn"></span><button class="claim" data-n="${n}"></button></div>`)
    .join('');
  el.innerHTML = `
    <div class="card-head" style="--c:${card.tone ?? '#3d8bff'}">
      <span class="pic"${card.thumb ? ` data-thumb="${card.thumb}"` : ''}>${picture(card.thumb, card.icon ?? '🏙️')}</span>
      <span class="ttl"><b>${esc(card.title)}</b>${card.subtitle ? `<small>${esc(card.subtitle)}</small>` : ''}</span>
      <button class="x" aria-label="Kapat">${icon('close')}</button>
    </div>
    <div class="card-body">
      ${statHtml ? `<div class="stats">${statHtml}</div>` : ''}
      <div class="lines">${card.lines.map(() => '<div class="line"></div>').join('')}</div>
      ${card.jobs?.length ? `<div class="jobs">${card.jobs.map(() => '<div class="job"><span></span><i><b></b></i></div>').join('')}</div>` : ''}
      ${card.chart?.length ? `<div class="charts">${card.chart.map(() => '<div class="chart"></div>').join('')}</div>` : ''}
      ${tilesHtml ? `<div class="tiles">${tilesHtml}</div>` : ''}
      ${questHtml ? `<div class="quests">${questHtml}</div>` : ''}
      ${card.cost?.length ? `<div class="cost">${card.cost.map(() => '<span class="cc"></span>').join('')}</div>` : ''}
      <div class="acts">${(card.actions ?? []).map((a, n) => `<button class="act${a.primary ? ' primary' : ''}" data-n="${n}">${esc(a.label)}</button>`).join('')}</div>
    </div>`;
  el.querySelector('.x')!.addEventListener('click', () => {
    showInfo(null);
    onClose?.();
  });
  el.querySelectorAll<HTMLButtonElement>('.tile').forEach(b => b.addEventListener('click', () => runs.tiles[+b.dataset.n!]?.()));
  el.querySelectorAll<HTMLButtonElement>('.claim').forEach(b => b.addEventListener('click', () => runs.quests[+b.dataset.n!]?.()));
  el.querySelectorAll<HTMLButtonElement>('.act').forEach(b => b.addEventListener('click', () => runs.actions[+b.dataset.n!]?.()));
  update(el, card);
  el.hidden = false;
  $('catalog').hidden = true;
  syncSheet();
}

// Kartın değişen yerlerini güncelle
function update(el: HTMLElement, card: InfoCard) {
  el.querySelectorAll<HTMLElement>('.stat').forEach((d, n) => {
    const s = card.stats![n];
    d.className = 'stat' + (s.bad ? ' bad' : s.good ? ' good' : '');
    d.querySelector('.sv')!.textContent = s.value;
  });
  el.querySelectorAll<HTMLElement>('.line').forEach((d, n) => {
    const l = card.lines[n];
    d.className = 'line ' + (l.ok === undefined ? 'plain' : l.ok ? 'ok' : 'bad');
    d.textContent = l.text;
  });
  el.querySelectorAll<HTMLElement>('.job').forEach((d, n) => {
    const j = card.jobs![n];
    d.querySelector('span')!.textContent = j.text;
    (d.querySelector('b') as HTMLElement).style.width = `${Math.round(j.progress * 100)}%`;
  });
  el.querySelectorAll<HTMLButtonElement>('.tile').forEach(b => {
    const t = card.tiles![+b.dataset.n!];
    b.disabled = !t.enabled;
    b.querySelector('small')!.textContent = t.sub;
    const note = b.querySelector('.tn');
    if (note) note.textContent = t.note ?? '';
  });
  el.querySelectorAll<HTMLElement>('.quest').forEach((d, n) => {
    const q = card.quests![n];
    d.classList.toggle('done', q.done);
    d.classList.toggle('claimed', !!q.claimed);
    d.querySelector('.qt')!.textContent = q.text;
    const qp = d.querySelector<HTMLElement>('.qp');
    if (qp && q.pics !== undefined && qp.dataset.h !== q.pics) {
      qp.dataset.h = q.pics;
      qp.innerHTML = q.pics;
    }
    (d.querySelector('.qbar i') as HTMLElement).style.width = `${Math.round(q.progress * 100)}%`;
    d.querySelector('.qn')!.textContent = q.count;
    const b = d.querySelector<HTMLButtonElement>('.claim')!;
    b.disabled = !q.done;
    b.innerHTML = q.claimed ? '✓' : q.done ? `${esc(q.button ?? 'Ödülü al')}<br>${esc(q.reward.replace('\n', ' '))}` : esc(q.reward).replace('\n', '<br>');
  });
  el.querySelectorAll<HTMLElement>('.chart').forEach((d, n) => {
    const c = card.chart![n];
    const key = c.values.join(',');
    if (d.dataset.k === key) return;
    d.dataset.k = key;
    d.innerHTML = chartHtml(c);
  });
  el.querySelectorAll<HTMLElement>('.cc').forEach((d, n) => {
    const c = card.cost![n];
    d.className = 'cc' + (c.ok ? '' : ' miss');
    // Resim her yenilemede baştan çizilmesin (titremesin): sadece yazı değişince
    const key = `${c.text}|${c.pic ? 1 : 0}`;
    if (d.dataset.k !== key) {
      d.dataset.k = key;
      d.innerHTML = `${c.pic ?? ''}<span>${esc(c.text)}</span>`;
    }
  });
  el.querySelectorAll<HTMLButtonElement>('.act').forEach(b => {
    b.disabled = !card.actions![+b.dataset.n!].enabled;
  });
}

export const infoOpen = () => !$('info').hidden;

// Kartlardaki çizgi grafik (nüfus, kasa): her nokta bir günün sonu, son nokta şu an
function chartHtml(c: NonNullable<InfoCard['chart']>[number]) {
  const v = c.values;
  const head = (extra = '') => `<div class="ch-h"><b>${esc(c.label)}</b>${extra}</div>`;
  if (v.length < 2) return head() + '<div class="ch-empty">Grafik için biraz daha oyna: her günün sonunda bir nokta eklenir.</div>';
  const W = 300, H = 64;
  const min = Math.min(...v), max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((y, k) => `${((k / (v.length - 1)) * W).toFixed(1)},${(H - 4 - ((y - min) / span) * (H - 12)).toFixed(1)}`);
  const last = Math.round(v[v.length - 1]);
  const diff = last - Math.round(v[0]);
  return `${head(`<span>${fmt(last)}</span><em class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${fmt(Math.abs(diff))}</em>`)}
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="M0,${H} L${pts.join(' L')} L${W},${H} Z" fill="${c.color}" opacity="0.16"/><polyline points="${pts.join(' ')}" fill="none" stroke="${c.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
    <div class="ch-f"><span>${v.length - 1} gün önce</span><span>en az ${fmt(Math.round(min))} · en çok ${fmt(Math.round(max))}</span><span>şimdi</span></div>`;
}

// --- Seviye atlama kutlaması ---
export interface Unlock { key?: string; icon: string; label: string }
const levelQueue: { level: number; reward: number; unlocks: Unlock[] }[] = [];

export function celebrateLevel(level: number, reward: number, unlocks: Unlock[]) {
  levelQueue.push({ level, reward, unlocks });
  if (levelQueue.length === 1) showNextLevel();
}

const CONFETTI = ['#ffc928', '#ff6b5e', '#4fc3f7', '#66bb6a', '#ab47bc', '#ff9f1a'];

function showNextLevel() {
  const next = levelQueue[0];
  const el = $('levelup');
  if (!next) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const unlocks = next.unlocks
    .map(u => `<span class="lv-un"><span class="p">${picture(u.key, u.icon)}</span>${esc(u.label)}</span>`)
    .join('');
  const bits = Array.from({ length: 36 }, (_, k) => {
    const left = Math.random() * 100;
    const delay = Math.random() * 0.8;
    const dur = 2.2 + Math.random() * 1.6;
    return `<i style="left:${left}%;background:${CONFETTI[k % CONFETTI.length]};animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
  }).join('');
  el.innerHTML = `
    <div class="confetti">${bits}</div>
    <div class="lv-box">
      <div class="lv-rays"></div>
      <div class="lv-star">${icon('star')}<b>${next.level}</b></div>
      <h2>Tebrikler!</h2>
      <p>Şehrin <b>${next.level}. seviyeye</b> ulaştı</p>
      <span class="lv-reward">${icon('coin')}+${fmt(next.reward)}</span>
      ${unlocks ? `<h3>Yeni açılanlar</h3><div class="lv-unlocks">${unlocks}</div>` : ''}
      <button class="big-btn">Harika!</button>
    </div>`;
  el.querySelector('.big-btn')!.addEventListener('click', () => {
    levelQueue.shift();
    showNextLevel();
  });
  el.hidden = false;
}

// --- Ayarlar ve onay pencereleri ---
export function confirmDialog(title: string, text: string, ok: string): Promise<boolean> {
  const el = $('dialog');
  return new Promise(resolve => {
    el.innerHTML = `<div class="dlg"><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="btns"><button class="big-btn gray" data-r="0">Vazgeç</button><button class="big-btn red" data-r="1">${esc(ok)}</button></div></div>`;
    el.hidden = false;
    el.querySelectorAll<HTMLButtonElement>('[data-r]').forEach(b =>
      b.addEventListener('click', () => {
        el.hidden = true;
        resolve(b.dataset.r === '1');
      }),
    );
  });
}

export type Quality = 'high' | 'mid' | 'low';
export interface SettingsState { sound: boolean; music: boolean; quality: Quality; rain: boolean; name: string; demo: boolean; screen?: string }
export interface SettingsHandlers {
  sound(on: boolean): void;
  music(on: boolean): void;
  quality(q: Quality): void;
  rain(on: boolean): void;
  reset(): void;
  demo(): void; // hazır şehri aç
  restore(): void; // hazır şehirden kendi şehrine dön
  rename(name: string): void;
  copyCity(): void; // şehri yazı olarak panoya kopyala (yedek / başka yere taşıma)
  pasteCity(): void; // panodaki şehri yükle
}

export function openSettings(state: SettingsState, on: SettingsHandlers) {
  const el = $('dialog');
  const q: [Quality, string][] = [['high', 'Yüksek'], ['mid', 'Orta'], ['low', 'Düşük']];
  el.innerHTML = `<div class="dlg">
    <h2>${icon('gear')}Ayarlar</h2>
    <label class="row name-row"><span>Şehrin adı</span><input id="city-input" maxlength="18" value="${esc(state.name)}" autocomplete="off" spellcheck="false"></label>
    <div class="row">${icon(state.sound ? 'soundOn' : 'soundOff')}<span>Ses efektleri</span><button class="switch${state.sound ? ' on' : ''}" data-k="sound" aria-label="Ses"></button></div>
    <div class="row">${icon('music')}<span>Müzik</span><button class="switch${state.music ? ' on' : ''}" data-k="music" aria-label="Müzik"></button></div>
    <div class="row">${icon('rain')}<span>Yağmur ve kar</span><button class="switch${state.rain ? ' on' : ''}" data-k="rain" aria-label="Yağmur"></button></div>
    <div class="row">${icon('screen')}<span>Grafik</span><span class="segc">${q.map(([k, l]) => `<button data-q="${k}" class="${state.quality === k ? 'on' : ''}">${l}</button>`).join('')}</span></div>
    <button class="help-row">${icon('help')}Nasıl oynanır?</button>
    <button class="demo-row">${icon('build')}${state.demo ? 'Hazır şehri yeniden aç' : 'Hazır şehri aç (örnek büyük şehir)'}</button>
    ${state.demo ? `<button class="demo-row back">${icon('rotateLeft')}Kendi şehrime dön</button>` : ''}
    <div class="save-pair"><button class="save-row" data-save="copy">📋 Şehri kopyala</button><button class="save-row" data-save="paste">📥 Kopyalanan şehri yükle</button></div>
    <button class="danger-row">${icon('trash')}Yeni şehir kur</button>
    <div class="btns"><button class="big-btn green" data-close>Tamam</button></div>
    <div class="credits">Bütün modeller, çizimler ve sesler oyunun kendi koduyla yapıldı.</div>
    ${state.screen ? `<div class="credits">${esc(state.screen)}</div>` : ''}
  </div>`;
  el.hidden = false;
  el.querySelectorAll<HTMLButtonElement>('.switch').forEach(b =>
    b.addEventListener('click', () => {
      const v = !b.classList.contains('on');
      b.classList.toggle('on', v);
      if (b.dataset.k === 'sound') {
        on.sound(v);
        b.parentElement!.querySelector('.ic')!.outerHTML = icon(v ? 'soundOn' : 'soundOff');
      } else if (b.dataset.k === 'music') on.music(v);
      else on.rain(v);
    }),
  );
  el.querySelectorAll<HTMLButtonElement>('[data-q]').forEach(b =>
    b.addEventListener('click', () => {
      el.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('on', x === b));
      on.quality(b.dataset.q as Quality);
    }),
  );
  const input = el.querySelector<HTMLInputElement>('#city-input')!;
  input.addEventListener('input', () => on.rename(input.value.trim() || 'Aksoy City'));
  el.querySelector('[data-close]')!.addEventListener('click', () => (el.hidden = true));
  el.querySelector('.help-row')!.addEventListener('click', () => openHelp(() => openSettings(state, on)));
  el.querySelector('.danger-row')!.addEventListener('click', () => {
    el.hidden = true;
    on.reset();
  });
  el.querySelectorAll<HTMLButtonElement>('.save-row').forEach(b =>
    b.addEventListener('click', () => {
      if (b.dataset.save === 'copy') on.copyCity();
      else {
        el.hidden = true;
        on.pasteCity();
      }
    }),
  );
  el.querySelectorAll<HTMLButtonElement>('.demo-row').forEach(b =>
    b.addEventListener('click', () => {
      el.hidden = true;
      if (b.classList.contains('back')) on.restore();
      else on.demo();
    }),
  );
}

// --- Nasıl oynanır ---
// Kısa rehber: oyunun kuralları bölüm bölüm (Ayarlar'dan açılır, "Geri" ayarlara döner)
const HELP: [string, string, string[]][] = [
  ['🛣️', 'Başlangıç', [
    'Sağ alttaki İnşa Et düğmesinden yol çiz ve yolu soldaki şehir girişine bağla.',
    'Yolun kenarına konut alanı çiz. Elektrik ve su gelince evler kendiliğinden yapılır.',
    'Belediye vergileri biriktirir; belediyeye dokunup parayı topla.',
  ]],
  ['⚡', 'Elektrik ve su', [
    'Başta rüzgâr türbini ve su kulesi yeter. Şehir büyüyünce güneş tarlası, sonra santral ve su pompası açılır.',
    'Üstteki ⚡ ve 💧 göstergeleri ihtiyacı ve üretimi gösterir; yetmezse evler boşalır.',
    'Yenisini kurmak yerine yükselt: santral ve pompa en üst seviyede 10 kat üretir, iki tanesi koca şehre yeter.',
  ]],
  ['🚒', 'Hizmet binaları', [
    'İtfaiye, polis, hastane ve okul çevrelerindeki evlere hizmet verir.',
    'Yükseltince kat çıkar ve alanı büyür (en üst seviyede 15 kare); birkaç tanesi bütün şehre yeter.',
  ]],
  ['🏠', 'Evleri büyütmek', [
    'Evin kartında "Yükselt" ile ev büyür; gereken malzemeler kartta resimleriyle yazar.',
    '3. seviye için yakında park, 4. için dükkân (yakında ya da şehirde yeterince).',
    '5. seviye için itfaiye, polis, hastane ve okul kapsamalı; 6. için yakında simge yapı.',
    '7. seviye (gökdelen) için yanındaki yol bulvar ya da cadde, 8. için yakında metro ya da tren.',
  ]],
  ['🏭', 'Üretim', [
    'Fabrika metal, odun gibi ham maddeleri üretir. Dükkânlar bunlardan ürün yapar.',
    'Binaya dokun, alttaki banttan ürün seç; bitince binada baloncuk çıkar, dokununca depoya gelir.',
    'Depo dolunca üretim durur: Depo düğmesinden fazla ürünü satabilir ya da yeni depo binası kurabilirsin.',
    'Limandan komşu şehirlere sipariş göndererek çok para kazanırsın.',
  ]],
  ['🚗', 'Trafik ve ulaşım', [
    'Kırmızı yollar tıkalıdır. Cadde sade yolun üç katı araba taşır, bulvar evleri mutlu eder.',
    'Otobüs durağı, metro ve tren arabaları azaltır. Metro hattını Ulaşım menüsünden yerin altına çiz.',
    'Alt geçidi cadde üstüne düz çiz: arabalar kavşakların altından ışığa takılmadan geçer.',
  ]],
  ['🗺️', 'Şehri büyütmek', [
    '3. seviyeden sonra kenardaki + işaretlerine dokunup yeni arazi satın alabilirsin.',
    'Harita doğuda ve güneyde nehrin ötesine kadar uzanır; kuzeyde deniz ve ada var.',
    'Kız Kulesi denizin içine, Opera Binası su kıyısına kurulur. Kapadokya’da gündüz sıcak hava balonları uçar.',
    'Tarihi yapılar gerçek boylarına göre büyük (Eyfel ve Kolezyum 5x5, Piramitler 6x6). Eski küçük hâli varsa kartından büyütebilirsin.',
    'Havaalanını kartından Büyük Havalimanı’na yükselt: 6x6, iki pist, daha çok uçuş ve turist (çevresinde boş yer olmalı).',
  ]],
  ['🔥', 'Olaylar', [
    'İtfaiyenin kapsamadığı evlerde yangın çıkabilir; karttan söndür.',
    'Polisin olmadığı yerlerde hırsızlık olur. Depremde hasar gören evleri karttan onar.',
  ]],
  ['🏆', 'Ödüller ve fotoğraf', [
    'Sağdaki kupa Başarımlar: şehir büyüdükçe kademeler tamamlanır, ödülünü oradan al.',
    'Her gün oyuna girince günlük hediye gelir; art arda gelinen günlerde büyür, 7. gün en büyüğü.',
    'Nüfus ve bütçe kartlarında son günlerin grafiği var.',
    'Mutluluk göstergesine dokun: belediye kartında halkın istekleri yazar, Göster ile oraya gidilir.',
    'Sol alttaki fotoğraf makinesi arayüzü gizler: açıyı seç, istersen akşam ya da gece yap, deklanşöre bas.',
  ]],
  ['🎮', 'Kumanda', [
    'Tek parmakla kaydır, iki parmakla yakınlaştır ve döndür. İki parmağı yukarı-aşağı kaydırınca kamera eğilir.',
    'Bir binaya basılı tut: taşı ve çevir. Pusulaya dokununca harita kuzeye döner.',
    'Bir yıl 28 gün: ilkbahar, yaz, sonbahar ve kış yedişer gün. Kışın kar yağar, sonbaharda yapraklar sararır.',
    'Bir gün, bir gece-gündüz turudur (2 dakika). Para ve büyüme bundan bağımsız işler.',
  ]],
];
// back yoksa (ilk açılışta kendiliğinden) sadece Tamam düğmesi olur
export function openHelp(back?: () => void) {
  const el = $('dialog');
  el.innerHTML = `<div class="dlg help">
    <h2>${icon('help')}Nasıl oynanır?</h2>
    <div class="help-body">${HELP.map(([ic, title, lines]) => `<section><h3><span>${ic}</span>${esc(title)}</h3><ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul></section>`).join('')}</div>
    <div class="btns">${back ? '<button class="big-btn gray" data-back>Geri</button>' : ''}<button class="big-btn green" data-close>${back ? 'Tamam' : 'Başlayalım!'}</button></div>
  </div>`;
  el.hidden = false;
  el.querySelector('[data-close]')!.addEventListener('click', () => (el.hidden = true));
  if (back) el.querySelector('[data-back]')!.addEventListener('click', back);
}

// --- Fotoğraf modu ---
// Arayüz gizlenir; altta deklanşör, kapat ve günün saati (sadece görüntü: gündüz, akşam, gece) düğmeleri
export type PhotoTime = 'now' | 'day' | 'dusk' | 'night';
export interface PhotoHandlers { close(): void; shoot(): void; time(t: PhotoTime): void }
let photoBar: HTMLDivElement | null = null;
const PHOTO_TIMES: [PhotoTime, string, string][] = [['now', 'clock', 'Şimdi'], ['day', 'sun', 'Gündüz'], ['dusk', 'sunset', 'Akşam'], ['night', 'moon', 'Gece']];
export function setPhotoBar(on: boolean, h?: PhotoHandlers) {
  document.body.classList.toggle('photo-on', on);
  photoBar?.remove();
  photoBar = null;
  if (!on || !h) return;
  const bar = (photoBar = document.createElement('div'));
  bar.id = 'photobar';
  bar.innerHTML = `<div class="pb-times">${PHOTO_TIMES.map(([k, ic, l]) => `<button data-t="${k}" class="${k === 'now' ? 'on' : ''}">${icon(ic as keyof typeof ICONS)}<small>${l}</small></button>`).join('')}</div>
    <div class="pb-main"><button class="pb-x" aria-label="Fotoğraf modunu kapat">${icon('close')}</button><button class="pb-shot" aria-label="Fotoğraf çek"><i></i></button><span class="pb-gap"></span></div>
    <small class="pb-hint">Kaydırarak ve iki parmakla yakınlaştırıp döndürerek açıyı seç</small>`;
  document.body.appendChild(bar);
  bar.querySelector('.pb-x')!.addEventListener('click', () => h.close());
  bar.querySelector('.pb-shot')!.addEventListener('click', () => h.shoot());
  bar.querySelectorAll<HTMLButtonElement>('[data-t]').forEach(b =>
    b.addEventListener('click', () => {
      bar.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b));
      h.time(b.dataset.t as PhotoTime);
    }),
  );
}
// Deklanşör: ekran bir an beyazlar
export function photoFlash() {
  const f = document.createElement('div');
  f.className = 'photo-flash';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 600);
}
// Çekilen fotoğraf: önizleme, kaydet/paylaş (share yoksa indir bağlantısı)
export function showPhoto(url: string, share: (() => void) | null) {
  const el = $('dialog');
  el.innerHTML = `<div class="dlg photo">
    <h2>${icon('camera')}Fotoğraf hazır</h2>
    <img class="ph-img" src="${url}" alt="Şehrinin fotoğrafı">
    <p class="ph-hint">${share ? 'Kaydet / Paylaş\'a dokun, açılan menüden "Resmi Kaydet"i seç. Resme basılı tutarak da kaydedebilirsin.' : 'İndir\'e tıklayınca fotoğraf bilgisayarına kaydedilir.'}</p>
    <div class="btns"><button class="big-btn gray" data-close>Kapat</button>${share ? '<button class="big-btn green" data-share>Kaydet / Paylaş</button>' : `<a class="big-btn green" download="aksoy-city.jpg" href="${url}">İndir</a>`}</div>
  </div>`;
  el.hidden = false;
  el.querySelector('[data-close]')!.addEventListener('click', () => (el.hidden = true));
  el.querySelector('[data-share]')?.addEventListener('click', () => share?.());
}

// --- Günlük hediye ---
// Her gün oyuna girince hediye: yedi günlük takvim, art arda gelinen her gün büyür (7. gün en büyüğü)
export interface GiftBox { day: number; items: { pic: string; coin?: boolean; text: string }[] }
export function openGift(today: number, boxes: GiftBox[], claim: () => void) {
  const el = $('dialog');
  el.innerHTML = `<div class="dlg gift">
    <h2>${icon('gift')}Günlük hediye</h2>
    <p>Her gün oyuna gir, hediyen büyüsün! Bugün <b>${today}. gün</b>.</p>
    <div class="gift-days">${boxes.map(b => `<div class="gd${b.day < today ? ' past' : b.day === today ? ' today' : ''}${b.day === 7 ? ' big' : ''}">
      <small>${b.day}. gün</small>
      <div class="gd-items">${b.items.map(it => `<span class="gi">${it.coin ? `<span class="gp">${ICONS.coin}</span>` : it.pic}<b>${esc(it.text)}</b></span>`).join('')}</div>
      ${b.day < today ? '<span class="gd-ok">✓</span>' : ''}
    </div>`).join('')}</div>
    <p class="gift-note">Bir gün gelmezsen takvim 1. günden başlar.</p>
    <div class="btns"><button class="big-btn green" data-claim>Hediyeyi al</button></div>
  </div>`;
  el.hidden = false;
  el.querySelector('[data-claim]')!.addEventListener('click', () => {
    el.hidden = true;
    claim();
  });
}

// --- Yükleme ekranı ---
export function setLoading(p: number) {
  $('load-bar').style.width = `${Math.round(p * 100)}%`;
  $('load-text').textContent = `Şehir yükleniyor… %${Math.round(p * 100)}`;
}

export function loadFailed() {
  $('load-text').textContent = 'Oyun yüklenemedi. Sayfayı yenilemeyi dene.';
}

export function hideLoading() {
  $('loading').classList.add('done');
}

export { fmt };
