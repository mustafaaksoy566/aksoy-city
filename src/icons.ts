// Arayüz simgeleri: oyuna özel çizilmiş, koyu çerçeveli renkli SVG'ler (her telefonda aynı görünür)

const S = 'stroke="#1f2d3d" stroke-width="2" stroke-linejoin="round"';
const svg = (body: string) => `<svg viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;

// Dişli çark yolu (ayarlar)
function gear(cx: number, cy: number, rOut: number, rIn: number, teeth: number) {
  const step = (Math.PI * 2) / teeth;
  const pt = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  let d = '';
  for (let k = 0; k < teeth; k++) {
    const a = k * step;
    d += `${k ? 'L' : 'M'}${pt(rIn, a - step * 0.5)} L${pt(rIn, a - step * 0.3)} L${pt(rOut, a - step * 0.2)} L${pt(rOut, a + step * 0.2)} L${pt(rIn, a + step * 0.3)} `;
  }
  return d + 'Z';
}

// Saat yönünde dönen ok (sola döndürme bunun aynası)
const ROTATE = `<path d="M8.2 11.5A9 9 0 1 1 8.2 20.5" fill="none" stroke="#1f2d3d" stroke-width="6.4" stroke-linecap="round"/>
<path d="M8.2 11.5A9 9 0 1 1 8.2 20.5" fill="none" stroke="#4fc3f7" stroke-width="3" stroke-linecap="round"/>
<path d="M4.6 15.6L12.6 19.8L4.9 24.6z" fill="#4fc3f7" ${S}/>`;

const SPEAKER = `<path d="M4.5 12h5l7-6v20l-7-6h-5z" fill="#5b8def" ${S}/>`;

export const ICONS = {
  coin: svg(`<circle cx="16" cy="16" r="13" fill="#f5b400" ${S}/><circle cx="16" cy="16" r="9.6" fill="#ffd54a"/>
<path d="M13.6 9.5v12.6c3.6 0 6-2.3 6-5.6" fill="none" stroke="#a86b00" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M10.8 15.4l7.4-2.6M10.8 18.8l7.4-2.6" stroke="#a86b00" stroke-width="2.2" stroke-linecap="round"/>
<path d="M8.2 12a9 9 0 0 1 4.6-4.6" fill="none" stroke="#fff6c2" stroke-width="1.8" stroke-linecap="round"/>`),
  people: svg(`<circle cx="21.5" cy="10.5" r="4.2" fill="#8ec5ff" ${S}/><path d="M14.5 26c0-5 3.1-8.6 7-8.6s7 3.6 7 8.6z" fill="#8ec5ff" ${S}/>
<circle cx="12" cy="11" r="5" fill="#3d8bff" ${S}/><path d="M3.5 27.5c0-5.8 3.8-9.8 8.5-9.8s8.5 4 8.5 9.8z" fill="#3d8bff" ${S}/>`),
  star: svg(`<path d="M16 2.8l4 8.3 9.1 1.2-6.6 6.3 1.7 9-8.2-4.4-8.2 4.4 1.7-9-6.6-6.3 9.1-1.2z" fill="#ffc928" ${S}/>
<path d="M10.6 12.8l3.6-.5 1.6-3.5" fill="none" stroke="#fff3b0" stroke-width="1.8" stroke-linecap="round"/>`),
  bolt: svg(`<path d="M18.5 2.5L6.5 18h8l-2.5 11.5L25.5 13h-8.2z" fill="#ffd23f" ${S}/>`),
  drop: svg(`<path d="M16 3c5 6.4 9 11.2 9 16a9 9 0 0 1-18 0c0-4.8 4-9.6 9-16z" fill="#3fa9f5" ${S}/>
<path d="M11.4 19.5a4.6 4.6 0 0 0 3 4.3" fill="none" stroke="#c7ebff" stroke-width="2" stroke-linecap="round"/>`),
  smile: svg(`<circle cx="16" cy="16" r="12.5" fill="#ffd23f" ${S}/><circle cx="11.8" cy="13.2" r="1.8" fill="#1f2d3d"/><circle cx="20.2" cy="13.2" r="1.8" fill="#1f2d3d"/>
<path d="M10.5 18.5c1.4 2.6 3.3 3.8 5.5 3.8s4.1-1.2 5.5-3.8" fill="none" stroke="#1f2d3d" stroke-width="2" stroke-linecap="round"/>`),
  box: svg(`<path d="M4.5 10.5L16 5l11.5 5.5v12L16 28 4.5 22.5z" fill="#e0a25e" ${S}/>
<path d="M4.5 10.5L16 16l11.5-5.5M16 16v12" fill="none" ${S}/><path d="M10.2 7.8l11.4 5.5v4.2" fill="none" stroke="#fff1d6" stroke-width="2.2" stroke-linecap="round"/>`),
  quests: svg(`<rect x="6" y="5" width="20" height="24" rx="3" fill="#c98a4b" ${S}/><rect x="9" y="8.5" width="14" height="17.5" rx="1.5" fill="#fff"/>
<rect x="11.5" y="3" width="9" height="5" rx="1.5" fill="#9aa7b4" ${S}/>
<path d="M11.5 13.5l1.5 1.5 2.6-2.8M17.5 13.8h3.5M11.5 19.5l1.5 1.5 2.6-2.8M17.5 19.8h3.5" fill="none" stroke="#2e9e44" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`),
  gear: svg(`<path d="${gear(16, 16, 13.2, 10, 8)}" fill="#9fb0c2" ${S}/><circle cx="16" cy="16" r="4.4" fill="#e9eef3" ${S}/>`),
  soundOn: svg(`${SPEAKER}<path d="M20.8 11.5a6 6 0 0 1 0 9M24.4 8a11 11 0 0 1 0 16" fill="none" stroke="#1f2d3d" stroke-width="2.3" stroke-linecap="round"/>`),
  music: svg(`<path d="M12 23.5V8.5l13-3v15" fill="none" stroke="#1f2d3d" stroke-width="2.4" stroke-linejoin="round"/><ellipse cx="9" cy="23.5" rx="4" ry="3.2" fill="#ab47bc" stroke="#1f2d3d" stroke-width="2"/><ellipse cx="22" cy="20.5" rx="4" ry="3.2" fill="#ab47bc" stroke="#1f2d3d" stroke-width="2"/>`),
  trophy: svg(`<path d="M9 5.5h14v6.5a7 7 0 0 1-14 0z" fill="#ffc928" ${S}/><path d="M9 8H5.2v2.2A4.6 4.6 0 0 0 9.6 15M23 8h3.8v2.2a4.6 4.6 0 0 1-4.4 4.8" fill="none" ${S}/>
<path d="M14 18.4h4v4.6h-4z" fill="#e0a800" ${S}/><path d="M10 27.5h12v-2.2a2.2 2.2 0 0 0-2.2-2.2h-7.6a2.2 2.2 0 0 0-2.2 2.2z" fill="#a1683a" ${S}/>
<path d="M12.2 8.2v3.6a3.8 3.8 0 0 0 1.6 3.1" fill="none" stroke="#fff3b0" stroke-width="1.8" stroke-linecap="round"/>`),
  camera: svg(`<path d="M4.5 11.5a2.5 2.5 0 0 1 2.5-2.5h3.4l1.8-3h7.6l1.8 3H25a2.5 2.5 0 0 1 2.5 2.5v11.5A2.5 2.5 0 0 1 25 25.5H7a2.5 2.5 0 0 1-2.5-2.5z" fill="#5b8def" ${S}/>
<circle cx="16" cy="17" r="5.6" fill="#bfe6ff" ${S}/><circle cx="16" cy="17" r="2.4" fill="#1f2d3d"/><circle cx="23.3" cy="12.4" r="1.3" fill="#ffd23f"/>`),
  gift: svg(`<rect x="5" y="13" width="22" height="14" rx="2" fill="#ef5350" ${S}/><rect x="3.5" y="9" width="25" height="5.5" rx="1.6" fill="#ff7a70" ${S}/>
<path d="M14 9h4v18h-4z" fill="#ffd23f" ${S}/><path d="M16 9c-2.6-4.6-8.2-4.4-7.4-1.4.5 1.8 4 1.6 7.4 1.4zM16 9c2.6-4.6 8.2-4.4 7.4-1.4-.5 1.8-4 1.6-7.4 1.4z" fill="#ffd23f" ${S}/>`),
  sunset: svg(`<path d="M3.5 22.5h25" stroke="#1f2d3d" stroke-width="2.2" stroke-linecap="round"/><path d="M8.5 21.5a7.5 7.5 0 0 1 15 0z" fill="#ff9f43" ${S}/>
<g stroke="#ff7043" stroke-width="2.2" stroke-linecap="round"><path d="M16 6.5v3.4M6.2 10.6l2.4 2.4M25.8 10.6l-2.4 2.4"/></g><path d="M7 26.5h18" stroke="#1f2d3d" stroke-width="2.2" stroke-linecap="round"/>`),
  clock: svg(`<circle cx="16" cy="16" r="12.5" fill="#eef4fa" ${S}/><path d="M16 9v7.4l4.6 2.8" fill="none" stroke="#1f2d3d" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  help: svg(`<circle cx="16" cy="16" r="12.5" fill="#4fc3f7" stroke="#1f2d3d" stroke-width="2"/><path d="M12.2 12.6a4 4 0 1 1 5.6 3.6c-1.2.6-1.8 1.4-1.8 2.7v.6" fill="none" stroke="#1f2d3d" stroke-width="2.6" stroke-linecap="round"/><circle cx="16" cy="23.6" r="1.7" fill="#1f2d3d"/>`),
  soundOff: svg(`${SPEAKER}<path d="M21 12l7 8M28 12l-7 8" stroke="#e53935" stroke-width="2.8" stroke-linecap="round"/>`),
  rotateRight: svg(ROTATE),
  sun: svg(`<g stroke="#1f2d3d" stroke-width="2" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<path d="M16 3.5v4" transform="rotate(${a} 16 16)" stroke="#ffb300"/>`).join('')}</g><circle cx="16" cy="16" r="7" fill="#ffd23f" ${S}/>`),
  moon: svg(`<path d="M20 4.5a11.5 11.5 0 1 0 7.5 18.5A9.5 9.5 0 0 1 20 4.5z" fill="#ffe08a" ${S}/><circle cx="14" cy="18" r="1.6" fill="#e8c35a"/><circle cx="18.5" cy="23" r="1.1" fill="#e8c35a"/>`),
  compass: svg(`<circle cx="16" cy="16" r="13" fill="#eef4fa" ${S}/><path d="M16 4.5l4 11.5h-8z" fill="#e53935" ${S}/><path d="M16 27.5l-4-11.5h8z" fill="#9fb0c2" ${S}/><circle cx="16" cy="16" r="2" fill="#1f2d3d"/>`),
  rotateLeft: svg(`<g transform="translate(32 0) scale(-1 1)">${ROTATE}</g>`),
  build: svg(`<g transform="rotate(-38 16 16)">
<rect x="13.8" y="11" width="4.4" height="19" rx="2" fill="#b77a40" ${S}/>
<path d="M6.5 5.5h15c2.2 0 3.6 1.3 4.1 3.6l.4 2.2h-4.4v2.6H9.6v-2.6H6.5z" fill="#a9b6c2" ${S}/>
<path d="M9.4 7.6h11.4" stroke="#e6edf3" stroke-width="1.6" stroke-linecap="round"/></g>`),
  bulldozer: svg(`<path d="M2.5 16.5h3.8l2.2-2.6v11.6h-6z" fill="#9aa7b4" ${S}/>
<path d="M13.5 13.5V7.5h7.2l2.3 6" fill="#ffc928" ${S}/><rect x="15.2" y="9.2" width="4.4" height="3.6" rx=".6" fill="#bfe6ff"/>
<rect x="9" y="13.2" width="17.5" height="7" rx="1.6" fill="#ffc928" ${S}/><rect x="24.5" y="8" width="2.2" height="5" fill="#455a64"/>
<rect x="8.5" y="20" width="20.5" height="7.2" rx="3.6" fill="#37474f" ${S}/>
<circle cx="12.6" cy="23.6" r="1.7" fill="#90a4ae"/><circle cx="18.7" cy="23.6" r="1.7" fill="#90a4ae"/><circle cx="24.8" cy="23.6" r="1.7" fill="#90a4ae"/>`),
  check: svg(`<path d="M6.5 16.5l6.2 6.2L25.5 9.8" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>`),
  close: svg(`<path d="M9 9l14 14M23 9L9 23" stroke="currentColor" stroke-width="3.8" stroke-linecap="round"/>`),
  lock: svg(`<path d="M10.5 14v-3.5a5.5 5.5 0 0 1 11 0V14" fill="none" stroke="#1f2d3d" stroke-width="3"/>
<rect x="7" y="13.5" width="18" height="14" rx="3" fill="#ffc928" ${S}/><circle cx="16" cy="19.5" r="2" fill="#1f2d3d"/><path d="M16 20.5v3" stroke="#1f2d3d" stroke-width="2" stroke-linecap="round"/>`),
  rain: svg(`<path d="M9 19.5a5.5 5.5 0 0 1 .8-10.9A7.5 7.5 0 0 1 24 10.5a4.5 4.5 0 0 1-.5 9z" fill="#dfe9f2" ${S}/>
<path d="M11 23l-1.5 3.5M16.5 23L15 26.5M22 23l-1.5 3.5" stroke="#3fa9f5" stroke-width="2.4" stroke-linecap="round"/>`),
  chart: svg(`<rect x="4.5" y="17" width="5.5" height="10" rx="1" fill="#66bb6a" ${S}/><rect x="13.2" y="11" width="5.5" height="16" rx="1" fill="#ffca28" ${S}/>
<rect x="22" y="5" width="5.5" height="22" rx="1" fill="#42a5f5" ${S}/>`),
  trash: svg(`<path d="M7.5 9.5h17l-1.6 17.2a2 2 0 0 1-2 1.8h-9.8a2 2 0 0 1-2-1.8z" fill="#ef6c63" ${S}/>
<rect x="5" y="6.5" width="22" height="3.6" rx="1.4" fill="#ef6c63" ${S}/><path d="M13 6.2V4.6h6v1.6" fill="none" ${S}/>
<path d="M12.6 13.5v10.5M16 13.5v10.5M19.4 13.5v10.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`),
  screen: svg(`<rect x="3.5" y="5.5" width="25" height="17" rx="2.5" fill="#5b8def" ${S}/><rect x="6.5" y="8.5" width="19" height="11" rx="1" fill="#bfe6ff"/>
<path d="M12 27h8M16 22.5V27" stroke="#1f2d3d" stroke-width="2.2" stroke-linecap="round"/>`),
};
export type IconName = keyof typeof ICONS;

export const icon = (name: IconName, cls = '') => `<span class="ic${cls ? ' ' + cls : ''}">${ICONS[name]}</span>`;

// Sayfadaki data-icon="..." yer tutucularını gerçek simgelerle doldur
export function fillIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach(el => {
    const name = el.dataset.icon as IconName;
    if (ICONS[name]) el.innerHTML = ICONS[name];
  });
}
