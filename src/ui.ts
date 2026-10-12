import { TOOLS, COST, type Tool } from './config';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('tr-TR');

export function buildToolbar(onPick: (t: Tool) => void) {
  const nav = $('tools');
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.dataset.tool = t.id;
    const cost = t.id !== 'pan' && COST[t.id] ? `<small>💰${COST[t.id]}</small>` : '<small>&nbsp;</small>';
    b.innerHTML = `<span class="ico">${t.icon}</span><span>${t.label}</span>${cost}`;
    b.addEventListener('click', () => onPick(t.id));
    nav.appendChild(b);
  }
}

export function setActiveTool(tool: Tool) {
  document.querySelectorAll<HTMLButtonElement>('#tools button').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
}

export function setStats(money: number, pop: number, day: number, income: number) {
  $('money-v').textContent = fmt(money);
  $('income-v').textContent = `+${fmt(income)}/gün`;
  $('pop-v').textContent = fmt(pop);
  $('day-v').textContent = `Gün ${fmt(day)}`;
}

let toastTimer = 0;
export function toast(msg: string, kind: 'info' | 'error' = 'info') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.className = ''), 2600);
}

// Sürüklerken toplam maliyeti göster
export function setChip(text: string | null) {
  const el = $('chip');
  el.hidden = !text;
  if (text) el.textContent = text;
}

export function floatIncome(n: number) {
  if (n <= 0) return;
  const el = document.createElement('div');
  el.className = 'float';
  el.textContent = `+${fmt(n)}`;
  $('money').appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

export function hideLoading() {
  $('loading').classList.add('done');
}

export { fmt };
