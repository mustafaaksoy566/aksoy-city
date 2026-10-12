import { TOOLBAR, TOOL_INFO, COST, type Tool } from './config';
import type { Service } from './city';
import type { InfoCard } from './info';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('tr-TR');

// Araç kilitli mi? (main.ts şehrin seviyesine göre cevaplar)
export type LockInfo = (t: Tool) => number | null;

function toolButton(t: Tool, onPick: (t: Tool) => void, lockedAt: LockInfo) {
  const info = TOOL_INFO[t];
  const b = document.createElement('button');
  b.dataset.tool = t;
  const lock = lockedAt(t);
  const cost = lock ? `<small>🔒 Sv.${lock}</small>` : t !== 'pan' && COST[t] ? `<small>💰${fmt(COST[t])}</small>` : '<small>&nbsp;</small>';
  b.innerHTML = `<span class="ico">${info.icon}</span><span>${info.label}</span>${cost}`;
  if (lock) b.classList.add('locked');
  b.addEventListener('click', () => onPick(t));
  return b;
}

// Alt çubuk. Gruplu düğmeler (Bölge, Sanayi, Altyapı, Hizmet) üstte küçük bir menü açar.
export function buildToolbar(onPick: (t: Tool) => void, lockedAt: LockInfo) {
  const nav = $('tools');
  const sub = $('submenu');
  let openGroup: string | null = null;

  const closeSub = () => {
    openGroup = null;
    sub.hidden = true;
  };

  const pick = (t: Tool) => {
    closeSub();
    onPick(t);
  };

  for (const item of TOOLBAR) {
    if (typeof item === 'string') {
      nav.appendChild(toolButton(item, pick, lockedAt));
      continue;
    }
    const b = document.createElement('button');
    b.dataset.group = item.group;
    b.dataset.tools = item.tools.join(',');
    b.dataset.icon = item.icon;
    b.dataset.label = item.label;
    b.innerHTML = `<span class="ico">${item.icon}</span><span class="lbl">${item.label}</span><small>▲</small>`;
    b.addEventListener('click', () => {
      if (openGroup === item.group && !sub.hidden) return closeSub();
      openGroup = item.group;
      sub.replaceChildren(...item.tools.map(t => toolButton(t, pick, lockedAt)));
      sub.hidden = false;
      $('info').hidden = true;
    });
    nav.appendChild(b);
  }

  // Haritaya dokunulunca açık menüyü kapat
  document.getElementById('app')!.addEventListener('pointerdown', closeSub);
  return closeSub;
}

export function setActiveTool(tool: Tool) {
  document.querySelectorAll<HTMLButtonElement>('#tools button, #submenu button').forEach(b => {
    if (b.dataset.group) {
      // Grup düğmesi seçili aracın simgesini göstersin
      const inGroup = b.dataset.tools!.split(',').includes(tool);
      b.classList.toggle('active', inGroup);
      b.querySelector('.ico')!.textContent = inGroup ? TOOL_INFO[tool].icon : b.dataset.icon!;
      b.querySelector('.lbl')!.textContent = inGroup ? TOOL_INFO[tool].label : b.dataset.label!;
    } else {
      b.classList.toggle('active', b.dataset.tool === tool);
    }
  });
}

export interface Stats {
  money: number;
  pop: number;
  income: number;
  service: Service;
  level: { level: number; xp: number; need: number; max: boolean };
  storage: { used: number; cap: number };
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
}

let toastTimer = 0;
export function toast(msg: string, kind: 'info' | 'error' = 'info') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.className = ''), 3000);
}

// Sürüklerken toplam maliyeti göster
export function setChip(text: string | null) {
  const el = $('chip');
  el.hidden = !text;
  if (text) el.textContent = text;
}

export function floatIncome(n: number) {
  if (n === 0) return;
  const el = document.createElement('div');
  el.className = n > 0 ? 'float' : 'float neg';
  el.textContent = `${n > 0 ? '+' : ''}${fmt(n)}`;
  $('money').appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// --- Bilgi kartı ---
// Kart açıkken saniyede birkaç kez yenilenir. Düğmeler aynı kaldıkça yerinde güncellenir,
// yoksa yeniden çizilir (böylece dokunurken düğme kaybolmaz).

const signature = (c: InfoCard) =>
  [c.title, c.lines.length, c.jobs?.length ?? 0, ...(c.actions ?? []).map(a => a.label)].join('|');

let currentRuns: (() => void)[] = [];

export function showInfo(card: InfoCard | null) {
  const el = $('info');
  if (!card) {
    el.hidden = true;
    el.dataset.sig = '';
    return;
  }
  currentRuns = (card.actions ?? []).map(a => a.run);
  const sig = signature(card);
  if (!el.hidden && el.dataset.sig === sig) {
    // Yerinde güncelle
    el.querySelectorAll<HTMLElement>('.line').forEach((d, n) => fillLine(d, card.lines[n]));
    el.querySelectorAll<HTMLElement>('.job').forEach((d, n) => fillJob(d, card.jobs![n]));
    el.querySelectorAll<HTMLButtonElement>('.act').forEach((b, n) => (b.disabled = !card.actions![n].enabled));
    return;
  }
  el.dataset.sig = sig;
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = card.title;
  const close = document.createElement('button');
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Kapat');
  close.addEventListener('click', () => showInfo(null));
  title.appendChild(close);
  const lines = card.lines.map(l => fillLine(document.createElement('div'), l));
  const jobs = (card.jobs ?? []).map(j => {
    const d = document.createElement('div');
    d.className = 'job';
    d.innerHTML = '<span></span><i><b></b></i>';
    return fillJob(d, j);
  });
  const actions = (card.actions ?? []).map((a, n) => {
    const b = document.createElement('button');
    b.className = 'act' + (a.primary ? ' primary' : '');
    b.textContent = a.label;
    b.disabled = !a.enabled;
    b.addEventListener('click', () => currentRuns[n]?.());
    return b;
  });
  const acts = document.createElement('div');
  acts.className = 'acts';
  acts.append(...actions);
  el.replaceChildren(title, ...lines, ...jobs, acts);
  el.hidden = false;
  $('submenu').hidden = true;
}

function fillLine(d: HTMLElement, l: InfoCard['lines'][number]) {
  d.className = 'line' + (l.ok === false ? ' bad' : '');
  d.textContent = (l.ok === undefined ? '' : l.ok ? '✅ ' : '❌ ') + l.text;
  return d;
}

function fillJob(d: HTMLElement, j: NonNullable<InfoCard['jobs']>[number]) {
  d.querySelector('span')!.textContent = j.text;
  (d.querySelector('b') as HTMLElement).style.width = `${Math.round(j.progress * 100)}%`;
  return d;
}

export const infoOpen = () => !$('info').hidden;

// --- Seviye atlama kutlaması ---
const levelQueue: { level: number; reward: number; unlocks: string[] }[] = [];

export function celebrateLevel(level: number, reward: number, unlocks: string[]) {
  levelQueue.push({ level, reward, unlocks });
  if (levelQueue.length === 1) showNextLevel();
}

function showNextLevel() {
  const next = levelQueue[0];
  const el = $('levelup');
  if (!next) {
    el.hidden = true;
    return;
  }
  el.querySelector('h2')!.textContent = `🎉 Şehir seviyesi ${next.level}!`;
  el.querySelector('.reward')!.textContent = `Ödül: 💰${fmt(next.reward)}`;
  el.querySelector('.unlocks')!.textContent = next.unlocks.length ? `Yeni açılanlar: ${next.unlocks.join(', ')}` : '';
  el.hidden = false;
}

$('levelup').querySelector('button')!.addEventListener('click', () => {
  levelQueue.shift();
  showNextLevel();
});

export function hideLoading() {
  $('loading').classList.add('done');
}

export { fmt };
