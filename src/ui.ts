import {
  BUILD_GROUPS, TOOL_INFO, COST, FOOTPRINT, UTILITIES, SERVICES, DECOR, MATERIALS, MAT_IDS, DEPOT_STORAGE,
  type Tool, type BuildTool, type BuildGroup,
} from './config';
import { isUtility, isService, isDecor, type Service } from './city';
import type { InfoCard } from './info';
import { icon, fillIcons } from './icons';

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

export function setThumbs(map: Map<string, string>) {
  thumbs = map;
  document.querySelectorAll<HTMLElement>('[data-thumb]').forEach(el => {
    const src = thumbs.get(el.dataset.thumb!);
    if (src) el.innerHTML = `<img src="${src}" alt="">`;
  });
}

// --- İnşa paneli ---

// Kartın altında görünen kısa bilgi
function effectOf(t: BuildTool): string {
  if (isUtility(t)) {
    const u = UTILITIES[t];
    return u.power ? `⚡ +${u.power} elektrik` : `💧 +${u.water} su`;
  }
  if (isService(t)) return `📏 ${SERVICES[t].radius} kare alan`;
  if (isDecor(t)) {
    const d = DECOR[t];
    if (t === 'station') return '🚆 Tren seferleri';
    if (t === 'busstop') return '🚌 Otobüs hattı';
    if (t === 'beach') return `🏖️ +${fmt(d.income ?? 0)}/gün, nehir kıyısı`;
    if (d.income) return `✈️ +${fmt(d.income)}/gün turist`;
    if (d.covers) return `🎓 ${d.radius} kare okul alanı`;
    return `😊 Mutluluk +%${Math.round(d.happy * 100)}`;
  }
  switch (t) {
    case 'road': return 'Her şeyi birbirine bağlar';
    case 'rail': return 'Trenler için ray';
    case 'res': return '👥 Ev ve apartmanlar';
    case 'com': return '💼 Dükkan ve ofisler';
    case 'park': return '🌳 Evler büyüyebilir';
    case 'factory': return '🔩 Ham madde üretir';
    case 'depot': return `📦 +${DEPOT_STORAGE} depo yeri`;
    case 'trade': return '💱 Malzeme al ve sat';
    case 'port': return '🚢 Komşu şehirlere sat';
    case 'store': case 'market': case 'furniture': case 'bakery': case 'fashion':
      return MAT_IDS.filter(m => MATERIALS[m].maker === t).map(m => MATERIALS[m].icon).join(' ');
  }
  return '';
}
const PER_TILE: BuildTool[] = ['road', 'rail', 'res', 'com', 'park'];

export interface Catalog {
  open(group?: string): void;
  close(): void;
  isOpen(): boolean;
}

export function buildCatalog(onPick: (t: BuildTool) => void, lockedAt: LockInfo, money: () => number): Catalog {
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
    cards.replaceChildren(...g.tools.map(t => card(t, g)));
  };

  const close = () => {
    panel.hidden = true;
    syncSheet();
  };
  panel.querySelector('.cat-close')!.addEventListener('click', close);
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

// Panel ya da kart açıkken alttaki düğmeler gizlensin
function syncSheet() {
  document.body.classList.toggle('sheet', !$('catalog').hidden || !$('info').hidden);
}

// --- Seçili araç çubuğu ---
export function setMode(tool: Tool) {
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
  el.querySelector('.mode-pic')!.innerHTML = danger ? icon('bulldozer') : picture(tool, info.icon);
  el.querySelector('.mode-txt b')!.textContent = danger ? 'Yıkım modu' : info.label;
  el.querySelector('.mode-txt small')!.textContent = info.hint;
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
}

export function setStats(s: Stats) {
  $('money-v').textContent = fmt(s.money);
  $('income-v').textContent = `${s.income >= 0 ? '+' : ''}${fmt(s.income)}/gün`;
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
  const badge = $('quests-badge');
  badge.textContent = String(s.questsReady);
  badge.hidden = s.questsReady === 0;
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
    (c.tiles ?? []).map(t => t.section + t.name).join(','), c.quests?.length ?? 0, ...(c.actions ?? []).map(a => a.label),
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
    .map((q, n) => `<div class="quest"><span class="qt"></span><span class="qbar"><i></i></span><span class="qn"></span><button class="claim" data-n="${n}"></button></div>`)
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
    d.querySelector('.qt')!.textContent = q.text;
    (d.querySelector('.qbar i') as HTMLElement).style.width = `${Math.round(q.progress * 100)}%`;
    d.querySelector('.qn')!.textContent = q.count;
    const b = d.querySelector<HTMLButtonElement>('.claim')!;
    b.disabled = !q.done;
    b.innerHTML = q.done ? `${esc(q.button ?? 'Ödülü al')}<br>${esc(q.reward.replace('\n', ' '))}` : esc(q.reward).replace('\n', '<br>');
  });
  el.querySelectorAll<HTMLElement>('.cc').forEach((d, n) => {
    const c = card.cost![n];
    d.className = 'cc' + (c.ok ? '' : ' miss');
    d.textContent = c.text;
  });
  el.querySelectorAll<HTMLButtonElement>('.act').forEach(b => {
    b.disabled = !card.actions![+b.dataset.n!].enabled;
  });
}

export const infoOpen = () => !$('info').hidden;

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
export interface SettingsState { sound: boolean; quality: Quality; rain: boolean }
export interface SettingsHandlers {
  sound(on: boolean): void;
  quality(q: Quality): void;
  rain(on: boolean): void;
  reset(): void;
}

export function openSettings(state: SettingsState, on: SettingsHandlers) {
  const el = $('dialog');
  const q: [Quality, string][] = [['high', 'Yüksek'], ['mid', 'Orta'], ['low', 'Düşük']];
  el.innerHTML = `<div class="dlg">
    <h2>${icon('gear')}Ayarlar</h2>
    <div class="row">${icon(state.sound ? 'soundOn' : 'soundOff')}<span>Ses efektleri</span><button class="switch${state.sound ? ' on' : ''}" data-k="sound" aria-label="Ses"></button></div>
    <div class="row">${icon('rain')}<span>Yağmur</span><button class="switch${state.rain ? ' on' : ''}" data-k="rain" aria-label="Yağmur"></button></div>
    <div class="row">${icon('screen')}<span>Grafik</span><span class="segc">${q.map(([k, l]) => `<button data-q="${k}" class="${state.quality === k ? 'on' : ''}">${l}</button>`).join('')}</span></div>
    <button class="danger-row">${icon('trash')}Yeni şehir kur</button>
    <div class="btns"><button class="big-btn green" data-close>Tamam</button></div>
    <div class="credits">3D modeller: Kenney, KayKit, Quaternius (CC0) · Yazı tipi: Fredoka (OFL)</div>
  </div>`;
  el.hidden = false;
  el.querySelectorAll<HTMLButtonElement>('.switch').forEach(b =>
    b.addEventListener('click', () => {
      const v = !b.classList.contains('on');
      b.classList.toggle('on', v);
      if (b.dataset.k === 'sound') {
        on.sound(v);
        b.parentElement!.querySelector('.ic')!.outerHTML = icon(v ? 'soundOn' : 'soundOff');
      } else on.rain(v);
    }),
  );
  el.querySelectorAll<HTMLButtonElement>('[data-q]').forEach(b =>
    b.addEventListener('click', () => {
      el.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('on', x === b));
      on.quality(b.dataset.q as Quality);
    }),
  );
  el.querySelector('[data-close]')!.addEventListener('click', () => (el.hidden = true));
  el.querySelector('.danger-row')!.addEventListener('click', () => {
    el.hidden = true;
    on.reset();
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
