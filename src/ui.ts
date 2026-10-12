import { TOOLBAR, TOOL_INFO, COST, type Tool } from './config';
import type { Service } from './city';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('tr-TR');

function toolButton(t: Tool, onPick: (t: Tool) => void) {
  const info = TOOL_INFO[t];
  const b = document.createElement('button');
  b.dataset.tool = t;
  const cost = t !== 'pan' && COST[t] ? `<small>💰${fmt(COST[t])}</small>` : '<small>&nbsp;</small>';
  b.innerHTML = `<span class="ico">${info.icon}</span><span>${info.label}</span>${cost}`;
  b.addEventListener('click', () => onPick(t));
  return b;
}

// Alt çubuk. Gruplu düğmeler (Bölge, Altyapı) üstte küçük bir menü açar.
export function buildToolbar(onPick: (t: Tool) => void) {
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
      nav.appendChild(toolButton(item, pick));
      continue;
    }
    const b = document.createElement('button');
    b.dataset.group = item.group;
    b.dataset.tools = item.tools.join(',');
    b.dataset.icon = item.icon;
    b.dataset.label = item.label;
    b.innerHTML = `<span class="ico">${item.icon}</span><span class="lbl">${item.label}</span><small>▲</small>`;
    b.addEventListener('click', () => {
      if (openGroup === item.group) return closeSub();
      openGroup = item.group;
      sub.replaceChildren(...item.tools.map(t => toolButton(t, pick)));
      sub.hidden = false;
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

export function setStats(money: number, pop: number, day: number, income: number, service: Service) {
  $('money-v').textContent = fmt(money);
  $('income-v').textContent = `${income >= 0 ? '+' : ''}${fmt(income)}/gün`;
  $('income-v').classList.toggle('neg', income < 0);
  $('pop-v').textContent = fmt(pop);
  $('day-v').textContent = `Gün ${fmt(day)}`;
  for (const k of ['power', 'water'] as const) {
    const { supply, demand } = service[k];
    $(`${k}-v`).textContent = `${fmt(demand)}/${fmt(supply)}`;
    $(k).classList.toggle('short', demand > supply);
  }
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

export function hideLoading() {
  $('loading').classList.add('done');
}

export { fmt };
