import * as THREE from 'three';

// Gökdelenler kodla çizilir: alt katta giriş katı (lobi, saçak, çiçeklikler), üstünde cephe dokulu kule.
// Sekiz biçim var: düz cam kule, kademeli taş kule (art deco), burgulu kule, ikiz kuleler, sivri cam kule,
// balkonlu yuvarlak ve kare konut kuleleri, dikey çıtalı ofis bloğu. Tepede helikopter pisti, taç ya da anten.
// Geceleri pencerelerin bir kısmı yanar (DayNight 'window' adlı malzemeleri yakar, hangi pencerenin yanacağını doku söyler).

const FLOOR = 0.11; // bir katın yüksekliği
const BAY = 0.1; // bir pencerenin genişliği
const TC = 4; // dokuda yan yana pencere
const TR = 4; // dokuda üst üste kat

type Style = 'glass' | 'dark' | 'band' | 'stone' | 'home' | 'brick' | 'metal';

// Cephe dokusu (gündüz) ve gece yanan pencereler (aynı yerlerde)
function facade(style: Style, seed0: number) {
  const size = 256, cw = size / TC, ch = size / TR;
  const day = document.createElement('canvas');
  const night = document.createElement('canvas');
  day.width = day.height = night.width = night.height = size;
  const d = day.getContext('2d')!, n = night.getContext('2d')!;
  n.fillStyle = '#000';
  n.fillRect(0, 0, size, size);
  let seed = seed0;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const BG: Record<Style, string> = { glass: '#e6ebf0', dark: '#3c4652', band: '#eef0f3', stone: '#efe3cc', home: '#f6f2ea', brick: '#b5543c', metal: '#bcc3ca' };
  d.fillStyle = BG[style];
  d.fillRect(0, 0, size, size);
  const pane = (x: number, y: number, w: number, h: number, top: string, bottom: string) => {
    const gr = d.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, top);
    gr.addColorStop(1, bottom);
    d.fillStyle = gr;
    d.fillRect(x, y, w, h);
    // Camda gökyüzü yansıması: çapraz açık bir şerit
    d.fillStyle = 'rgba(255,255,255,0.18)';
    d.beginPath();
    d.moveTo(x + w * 0.15, y + h);
    d.lineTo(x + w * 0.45, y);
    d.lineTo(x + w * 0.62, y);
    d.lineTo(x + w * 0.32, y + h);
    d.fill();
    if (rnd() < 0.24) {
      n.fillStyle = rnd() < 0.7 ? '#ffd99a' : '#fff1d6';
      n.fillRect(x + 1, y + 1, w - 2, h - 2);
    }
  };
  for (let r = 0; r < TR; r++) {
    for (let c = 0; c < TC; c++) {
      const x = c * cw, y = r * ch;
      if (style === 'glass') {
        d.fillStyle = '#93a2b1'; // kat döşemesi
        d.fillRect(x, y, cw, 9);
        pane(x + 3, y + 11, cw - 6, ch - 13, '#cfe3f5', '#4f7396');
      } else if (style === 'dark') {
        d.fillStyle = '#222b35';
        d.fillRect(x, y, cw, 6);
        pane(x + 2, y + 8, cw - 4, ch - 9, '#7f97b0', '#2f3f52');
      } else if (style === 'band') {
        // Şerit pencereler: katlar boyunca uzanan cam, aralarında beton bant
        d.fillStyle = '#d5d9de';
        d.fillRect(x, y, cw, 22);
        pane(x, y + 24, cw, ch - 30, '#d2e6f7', '#5d82a6');
        d.fillStyle = '#c9cfd6';
        d.fillRect(x, y + 24, 3, ch - 30);
      } else if (style === 'brick') {
        // Tuğla duvar: derz çizgileri, taş lentolu beyaz çerçeveli pencereler
        d.fillStyle = '#d7a48c';
        for (let by = 0; by < ch; by += 8) {
          d.fillRect(x, y + by, cw, 1);
          for (let bx = (by / 8) % 2 ? 8 : 0; bx < cw; bx += 16) d.fillRect(x + bx, y + by, 1, 8);
        }
        d.fillStyle = '#e8dccb';
        d.fillRect(x + 10, y + 9, cw - 20, 4);
        d.fillStyle = '#f7f4ee';
        d.fillRect(x + 13, y + 13, cw - 26, ch - 22);
        pane(x + 16, y + 16, cw - 32, ch - 28, '#d6ecfa', '#5f86a8');
      } else if (style === 'metal') {
        // Oluklu sac: dikey oluklar, kat aralarında ek yeri (pencere yok)
        for (let k = 0; k < cw; k += 6) {
          d.fillStyle = (k / 6) % 2 ? '#aab2bb' : '#c8ced5';
          d.fillRect(x + k, y, 3, ch);
        }
        d.fillStyle = '#939ba5';
        d.fillRect(x, y, cw, 2);
      } else if (style === 'stone') {
        // Taş cephe: ayaklar arasında dar, uzun pencereler ve kat kornişleri
        d.fillStyle = '#dccdb0';
        d.fillRect(x, y, cw, 4);
        d.fillStyle = '#e6d8bd';
        d.fillRect(x, y + 4, 10, ch - 4);
        pane(x + 18, y + 12, cw - 36, ch - 20, '#9bb6cf', '#3e5a78');
      } else {
        // Konut: beyaz çerçeveli pencereler, arada renkli paneller
        if (rnd() < 0.18) {
          d.fillStyle = ['#e9b384', '#9cc5a1', '#9fb7d9', '#e8a0a0'][Math.floor(rnd() * 4)];
          d.fillRect(x + 4, y + 6, cw - 8, ch - 10);
        }
        d.fillStyle = '#ffffff';
        d.fillRect(x + 9, y + 13, cw - 18, ch - 22);
        pane(x + 12, y + 16, cw - 24, ch - 28, '#d6ecfa', '#6f97b8');
      }
    }
  }
  const make = (cv: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: make(day), glow: make(night) };
}
const TEX: Record<Style, ReturnType<typeof facade>> = {
  glass: facade('glass', 7),
  dark: facade('dark', 11),
  band: facade('band', 13),
  stone: facade('stone', 17),
  home: facade('home', 19),
  brick: facade('brick', 23),
  metal: facade('metal', 29),
};
const facadeMat = (style: Style, color: string, metal = 0.3, rough = 0.3) => {
  const m = new THREE.MeshStandardMaterial({ color, map: TEX[style].map, emissiveMap: TEX[style].glow, emissive: '#000000', metalness: metal, roughness: rough });
  m.name = 'window';
  return m;
};
const GLASS = ['#8fbde9', '#6f9fd6', '#7cc8c4', '#b4c3d3', '#c9d8e8', '#93a8c2'].map(c => facadeMat('glass', c, 0.45, 0.16));
const DARK = ['#b8c7d8', '#a9c9c4'].map(c => facadeMat('dark', c, 0.4, 0.18));
const BAND = ['#ffffff', '#e8eef5', '#f3ece0'].map(c => facadeMat('band', c, 0.2, 0.35));
const STONE = ['#fff8ec', '#f1e2d0'].map(c => facadeMat('stone', c, 0.05, 0.7));
const HOME = ['#ffffff', '#f2e6d8', '#e4edf3'].map(c => facadeMat('home', c, 0.05, 0.6));
const BRICK = ['#ffffff', '#e8d2c4'].map(c => facadeMat('brick', c, 0.02, 0.85));
const METAL = ['#ffffff', '#dfe7f0', '#f1e6d6'].map(c => facadeMat('metal', c, 0.35, 0.45));

const plain = (color: string, metal = 0, rough = 0.75) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
const T = {
  concrete: plain('#e9e6e0'),
  paving: plain('#cfd3d8'),
  slab: plain('#fbfbfa', 0, 0.6),
  frame: plain('#dfe5ec', 0.5, 0.35),
  metal: plain('#8b97a5', 0.7, 0.35),
  dark: plain('#39434f', 0.3, 0.5),
  roof: plain('#5f6a76', 0.2, 0.7),
  pad: plain('#4b545e', 0.1, 0.8),
  padLine: plain('#ffd54f'),
  white: plain('#ffffff'),
  lawn: plain('#6cbd55'),
  hedge: plain('#4a9a3e'),
  gold: plain('#e3bd5c', 0.7, 0.3),
  rail: plain('#bcd9ea', 0.3, 0.2),
  awning: ['#e53935', '#1e88e5', '#43a047', '#fb8c00'].map(c => plain(c)),
};
const LIGHT = new THREE.MeshStandardMaterial({ color: '#ff5252', emissive: '#ff5252', emissiveIntensity: 0 });
LIGHT.name = 'lamp';

// Kutu: yan yüzlerin doku koordinatları gerçek ölçüye göre (pencereler her binada aynı büyüklükte).
// y0: kutunun alt kenarının yerden yüksekliği (üst üste binen parçalarda katlar kaymasın)
function facadeBox(w: number, h: number, d: number, y0 = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const span = [d, d, 0, 0, w, w]; // yüz sırası: +x, -x, +y, -y, +z, -z
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (!span[f]) uv.setXY(i, 0, 0);
      else uv.setXY(i, (uv.getX(i) * span[f]) / (TC * BAY), (uv.getY(i) * h + y0) / (TR * FLOOR));
    }
  }
  return g;
}
// Silindir ya da daralan silindir (r1 alt, r2 üst)
function facadeCylinder(r1: number, r2: number, h: number, segs: number, y0 = 0) {
  const g = new THREE.CylinderGeometry(r2, r1, h, segs, 1, true);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const around = Math.PI * (r1 + r2);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * around) / (TC * BAY), (uv.getY(i) * h + y0) / (TR * FLOOR));
  return g;
}

const hash = (n: number, k: number) => {
  const s = Math.sin(n * 91.7 + k * 37.3) * 43758.5453;
  return s - Math.floor(s);
};

// Bir gökdelen (taban 1x1 kare, y=0 zemin, ön yüz +z). height: toplam boy, seed: renk ve ayrıntılar, type: biçim
export function makeTower(height: number, seed: number, type: number) {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const pick = <T,>(list: T[], k: number) => list[Math.floor(hash(seed, k) * list.length)];
  const residential = type === 5 || type === 6;

  // --- Giriş katı: kaldırım, iki katlık lobi, saçak, çiçeklikler ---
  const podH = residential ? 0.15 : 0.22;
  add(new THREE.BoxGeometry(0.96, 0.02, 0.96), T.paving, 0, 0.01, 0);
  if (residential) {
    // Konut kulesinin altında dükkanlar ve renkli tenteler
    add(facadeBox(0.82, podH, 0.82), pick(BAND, 3), 0, 0.02 + podH / 2, 0);
    for (const [k, x] of [-0.26, 0, 0.26].entries()) {
      const a = add(new THREE.BoxGeometry(0.22, 0.012, 0.08), T.awning[(Math.floor(hash(seed, 4) * 4) + k) % 4], x, 0.12, 0.45);
      a.rotation.x = 0.35;
    }
  } else {
    add(facadeBox(0.88, podH, 0.88), pick([...DARK, BAND[0]], 3), 0, 0.02 + podH / 2, 0);
    add(new THREE.BoxGeometry(0.36, 0.014, 0.14), T.frame, 0, 0.13, 0.5);
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.006, 0.006, 0.11, 6), T.metal, s * 0.16, 0.075, 0.55);
      add(new THREE.BoxGeometry(0.1, 0.05, 0.06), T.hedge, s * 0.34, 0.045, 0.47);
    }
  }
  add(new THREE.BoxGeometry(0.9, 0.02, 0.9), T.slab, 0, 0.02 + podH + 0.01, 0);
  const base = 0.02 + podH + 0.02;
  const H = Math.max(0.6, height - base);
  let top = height;

  // Tepe: helikopter pisti
  const helipad = (y: number, r: number) => {
    add(new THREE.CylinderGeometry(r, r, 0.02, 20), T.pad, 0, y + 0.01, 0);
    add(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.022, 20, 1, true), T.padLine, 0, y + 0.012, 0);
    add(new THREE.BoxGeometry(r * 0.12, 0.024, r * 0.7), T.white, -r * 0.25, y + 0.012, 0);
    add(new THREE.BoxGeometry(r * 0.12, 0.024, r * 0.7), T.white, r * 0.25, y + 0.012, 0);
    add(new THREE.BoxGeometry(r * 0.5, 0.024, r * 0.12), T.white, 0, y + 0.012, 0);
  };
  // Çatıda makine daireleri
  const machines = (y: number, w: number) => {
    add(new THREE.BoxGeometry(w * 0.45, 0.08, w * 0.3), T.roof, -w * 0.15, y + 0.04, -w * 0.15);
    add(new THREE.BoxGeometry(w * 0.2, 0.05, w * 0.2), T.metal, w * 0.22, y + 0.025, w * 0.2);
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 10), T.metal, w * 0.25, y + 0.03, -w * 0.25);
  };

  if (type === 0) {
    // Düz cam kule: köşelerde ince metal çıtalar, her 8 katta bir koyu teknik kat, tepede helikopter pisti
    const w = 0.7;
    const glass = pick(GLASS, 5);
    add(facadeBox(w, H, w, base), glass, 0, base + H / 2, 0);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(new THREE.BoxGeometry(0.03, H, 0.03), T.frame, (sx * w) / 2, base + H / 2, (sz * w) / 2);
    for (let y = base + FLOOR * 8; y < base + H - 0.2; y += FLOOR * 8) add(new THREE.BoxGeometry(w + 0.012, 0.035, w + 0.012), T.dark, 0, y, 0);
    add(new THREE.BoxGeometry(w + 0.02, 0.03, w + 0.02), T.frame, 0, base + H + 0.015, 0);
    add(facadeBox(w * 0.72, 0.12, w * 0.72), pick(DARK, 6), 0, base + H + 0.09, 0);
    helipad(base + H + 0.15, 0.2);
    top = base + H + 0.17;
  } else if (type === 1) {
    // Kademeli taş kule (art deco): yukarı çıktıkça daralan katlar, kornişler, altın taç ve sivri uç
    const stone = pick(STONE, 5);
    const tiers: [number, number][] = [[0.74, 0.5], [0.58, 0.26], [0.44, 0.15], [0.3, 0.09]];
    let y = base;
    for (const [w, f] of tiers) {
      const h = H * f;
      add(facadeBox(w, h, w, y), stone, 0, y + h / 2, 0);
      y += h;
      add(new THREE.BoxGeometry(w + 0.03, 0.02, w + 0.03), T.concrete, 0, y + 0.01, 0);
      y += 0.02;
    }
    add(new THREE.CylinderGeometry(0.06, 0.13, 0.16, 8), T.gold, 0, y + 0.08, 0);
    add(new THREE.CylinderGeometry(0.004, 0.03, 0.4, 8), T.gold, 0, y + 0.36, 0);
    top = y + 0.56;
  } else if (type === 2) {
    // Burgulu kule: her iki katta bir biraz dönen dilimler, aralarında beyaz döşeme
    const glass = pick(GLASS, 5);
    const seg = FLOOR * 2;
    const n = Math.max(4, Math.floor(H / seg));
    const turn = Math.PI / 2 / n;
    for (let k = 0; k < n; k++) {
      const y = base + k * seg;
      add(facadeBox(0.64, seg - 0.008, 0.64, y), glass, 0, y + seg / 2, 0, k * turn);
      add(new THREE.BoxGeometry(0.665, 0.008, 0.665), T.frame, 0, y + seg - 0.004, 0, k * turn);
    }
    const yt = base + n * seg;
    add(facadeCylinder(0.3, 0.3, 0.1, 16), pick(DARK, 6), 0, yt + 0.05, 0);
    add(new THREE.CylinderGeometry(0.34, 0.34, 0.02, 16), T.frame, 0, yt + 0.11, 0);
    top = yt + 0.12;
  } else if (type === 3) {
    // İkiz kuleler: yuvarlak, tepeleri kademeli daralan; ortada gökyüzü köprüsü
    const glass = pick(GLASS, 5);
    const h = H * 0.86;
    for (const s of [-1, 1]) {
      const x = s * 0.21;
      add(facadeCylinder(0.19, 0.19, h, 14, base), glass, x, base + h / 2, 0);
      // Gövdenin tepesi kapalı (yoksa üstteki daha dar katın kenarından kulenin içi görünüyor)
      add(new THREE.CylinderGeometry(0.195, 0.195, 0.012, 14), T.frame, x, base + h + 0.006, 0);
      let y = base + h + 0.012;
      for (const [r, th] of [[0.15, 0.1], [0.11, 0.08], [0.07, 0.07]]) {
        add(facadeCylinder(r + 0.03, r, th, 14, y), glass, x, y + th / 2, 0);
        add(new THREE.CylinderGeometry(r, r, 0.012, 14), T.frame, x, y + th + 0.006, 0);
        y += th + 0.012;
      }
      add(new THREE.CylinderGeometry(0.004, 0.02, 0.32, 8), T.metal, x, y + 0.16, 0);
    }
    const yb = base + h * 0.48;
    add(new THREE.BoxGeometry(0.1, 0.05, 0.08), T.frame, 0, yb, 0);
    for (const s of [-1, 1]) {
      const leg = add(new THREE.BoxGeometry(0.012, 0.16, 0.012), T.metal, s * 0.06, yb - 0.08, 0);
      leg.rotation.z = s * 0.5;
    }
    top = base + h + 0.6;
  } else if (type === 4) {
    // Sivri cam kule: sekizgen, yukarı doğru incelen üç bölüm ve ince uç
    const glass = pick([...GLASS, ...DARK], 5);
    const parts: [number, number, number][] = [[0.46, 0.4, 0.5], [0.4, 0.31, 0.3], [0.31, 0.16, 0.2]];
    let y = base;
    for (const [r1, r2, f] of parts) {
      const h = H * f;
      const m = add(facadeCylinder(r1, r2, h, 8, y), glass, 0, y + h / 2, 0);
      m.rotation.y = Math.PI / 8;
      y += h;
    }
    // Tepe kapalı: metal çerçeveli sekizgen çatı, üstünde koyu teknik kat ve sivri uç (yukarıdan kulenin içi görünmesin)
    const cap = add(new THREE.CylinderGeometry(0.175, 0.175, 0.016, 8), T.frame, 0, y + 0.008, 0);
    cap.rotation.y = Math.PI / 8;
    const crown = add(new THREE.CylinderGeometry(0.1, 0.12, 0.06, 8), T.dark, 0, y + 0.046, 0);
    crown.rotation.y = Math.PI / 8;
    y += 0.076;
    add(new THREE.CylinderGeometry(0.003, 0.03, 0.34, 6), T.metal, 0, y + 0.17, 0);
    top = y + 0.34;
  } else if (type === 5) {
    // Yuvarlak konut kulesi: her katta dolaşan balkon ve camlı korkuluk
    const r = 0.33;
    const wall = pick(HOME, 5);
    add(facadeCylinder(r, r, H, 20, base), wall, 0, base + H / 2, 0);
    const slab = new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.01, 20);
    const rail = new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.025, 20, 1, true);
    for (let y = base + FLOOR; y < base + H - 0.05; y += FLOOR) {
      add(slab, T.slab, 0, y, 0);
      add(rail, T.rail, 0, y + 0.017, 0);
    }
    add(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.03, 20), T.slab, 0, base + H + 0.015, 0);
    // Çatı bahçesi
    add(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.02, 20), T.lawn, 0, base + H + 0.04, 0);
    add(new THREE.SphereGeometry(0.05, 8, 6), T.hedge, 0.1, base + H + 0.08, 0.05);
    add(new THREE.SphereGeometry(0.04, 8, 6), T.hedge, -0.12, base + H + 0.07, -0.06);
    top = base + H + 0.05;
  } else if (type === 6) {
    // Kare konut kulesi: ön ve arka yüzde sırayla sağa sola kayan balkonlar
    const w = 0.72, d = 0.66;
    const wall = pick(HOME, 5);
    add(facadeBox(w, H, d, base), wall, 0, base + H / 2, 0);
    let k = 0;
    for (let y = base + FLOOR; y < base + H - 0.05; y += FLOOR, k++) {
      const x = k % 2 ? -0.16 : 0.16;
      for (const s of [-1, 1]) {
        add(new THREE.BoxGeometry(0.3, 0.01, 0.08), T.slab, x, y, s * (d / 2 + 0.04));
        add(new THREE.BoxGeometry(0.3, 0.025, 0.006), T.rail, x, y + 0.017, s * (d / 2 + 0.08));
      }
    }
    add(new THREE.BoxGeometry(w + 0.02, 0.03, d + 0.02), T.slab, 0, base + H + 0.015, 0);
    machines(base + H + 0.03, w);
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10), T.white, 0.22, base + H + 0.08, 0.18);
    top = base + H + 0.13;
  } else {
    // Ofis bloğu: geniş ve ince, cephede dikey beton çıtalar, çatıda makine daireleri
    const w = 0.84, d = 0.52;
    add(facadeBox(w, H, d, base), pick(BAND, 5), 0, base + H / 2, 0);
    for (let k = 0; k <= 8; k++) {
      const x = -w / 2 + (k * w) / 8;
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.014, H, 0.03), T.concrete, x, base + H / 2, s * (d / 2 + 0.012));
    }
    add(new THREE.BoxGeometry(w + 0.02, 0.03, d + 0.04), T.concrete, 0, base + H + 0.015, 0);
    machines(base + H + 0.03, 0.6);
    top = base + H + 0.11;
  }
  // Uzun kulelerde tepede anten ve gece yanan uyarı ışığı
  if (height > 2.2 && type !== 1 && type !== 3 && type !== 4) {
    add(new THREE.CylinderGeometry(0.006, 0.01, 0.3, 6), T.metal, 0.12, top + 0.15, -0.12);
    add(new THREE.SphereGeometry(0.02, 8, 6), LIGHT, 0.12, top + 0.31, -0.12);
  } else if (type === 1 || type === 3 || type === 4) {
    add(new THREE.SphereGeometry(0.018, 8, 6), LIGHT, type === 3 ? -0.21 : 0, top + 0.01, 0);
  }
  return g;
}

// Diğer binalar da aynı cephe dokularını ve malzemeleri kullanır (evler, fabrikalar, santraller, dükkanlar...)
export const KIT = { facadeBox, facadeCylinder, GLASS, DARK, BAND, STONE, HOME, BRICK, METAL, T, LIGHT, FLOOR };

// Menüler ve şehir için hazır kuleler: 'proc/tower-<boy>-<çeşit>'. types: hangi biçimler (sırayla)
export const TOWER_MODELS: Record<string, () => THREE.Object3D> = {};
// Konutların giriş kapısı (yerel x, z; ön yüz +z): insanlar yürüyerek bu kapıdan girip çıkar
export const DOORS: Record<string, [number, number]> = {};
// Çatısında helikopter pisti olan kuleler: pistin yerden yüksekliği (helikopterler buraya iner)
export const HELIPADS: Record<string, number> = {};
export const towerPaths = (height: number, count: number, seed: number, types: number[]) =>
  Array.from({ length: count }, (_, k) => {
    const path = `proc/tower-${height}-${seed + k}`;
    const h = height * (0.92 + hash(seed + k, 9) * 0.16);
    const type = types[k % types.length];
    TOWER_MODELS[path] = () => makeTower(h, seed + k * 13, type);
    if (type === 0) HELIPADS[path] = h + 0.17;
    DOORS[path] = [0, type === 5 || type === 6 ? 0.41 : 0.44];
    return path;
  });

// Orta yükseklikte apartmanlar (gökdelenlerle aynı cephe tarzında): 'proc/midrise-<boy>-<çeşit>'
export const midrisePaths = (height: number, count: number, seed: number, types: number[]) =>
  Array.from({ length: count }, (_, k) => {
    const path = `proc/midrise-${height}-${seed + k}`;
    const h = height * (0.92 + hash(seed + k, 9) * 0.16);
    const type = types[k % types.length];
    TOWER_MODELS[path] = () => makeTower(h, seed + k * 13, type);
    DOORS[path] = [0, type === 5 || type === 6 ? 0.41 : 0.44];
    return path;
  });
