import * as THREE from 'three';
import { TOWER_MODELS, DOORS, HELIPADS } from './towers';

// Profesyonel gökdelenler (SimCity'deki gibi ayrıntılı): ince kat ve pencere bölmeli cam giydirme cepheler (gece
// katlarda yan yana yanan ofis ışıkları), lobi katı (camlı giriş, saçak, çiçeklikler), kademeli yükselen gövdeler,
// ışıklı taçlar, sivri uçlar ve antenler. On üç biçim:
//   yeşil balkonlu kule, dalgalı balkonlu kule, köşe balkonlu konut kulesi (5. seviye)
//   burgulu kule, eğik tepeli kristal kule, bant pencereli ofis kulesi (6. seviye)
//   çapraz çelik örgülü kule, köprülü ikiz kuleler, yelken kule, ışıklı tabelalı holding kulesi (7. seviye)
//   üç kanatlı süper kule, art deco kule, piramit kule (8. seviye)
// Taban 1x1 kare, y=0 zemin, ön yüz +z (yola bakar).

const FL = 0.055; // bir katın yüksekliği
const BW = 0.05; // bir pencerenin genişliği
const TC = 16, TR = 16; // dokuda yan yana pencere ve üst üste kat
const TW = TC * BW, TH = TR * FL; // dokunun binadaki boyu

type Style = 'curtain' | 'silver' | 'gold' | 'dark' | 'ribbon' | 'stone' | 'resi' | 'green';
const SEEDS: Record<Style, number> = { curtain: 101, silver: 131, gold: 151, dark: 171, ribbon: 191, stone: 211, resi: 231, green: 251 };

function rng(seed: number) {
  let s = Math.floor(Math.abs(seed)) % 2147483646 + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const pick = <T,>(list: T[], r: () => number) => list[Math.floor(r() * list.length)];

// --- Cephe dokuları: gündüz rengi ve gece yanan pencereler (aynı yerlerde) ---
function drawFacade(style: Style) {
  const S = 384, cw = S / TC, ch = S / TR;
  const day = document.createElement('canvas');
  const night = document.createElement('canvas');
  day.width = day.height = night.width = night.height = S;
  const d = day.getContext('2d')!, n = night.getContext('2d')!;
  n.fillStyle = '#000';
  n.fillRect(0, 0, S, S);
  const rnd = rng(SEEDS[style]);
  const hsl = (h: number, s: number, l: number) => `hsl(${h.toFixed(0)},${s.toFixed(0)}%,${Math.max(2, Math.min(96, l)).toFixed(0)}%)`;
  // Gece: ofislerde her katta yan yana birkaç pencere birden yanar, bazı katlar baştan sona; konutlarda dağınık
  const scattered = style === 'resi' || style === 'green' || style === 'stone';
  const lit = Array.from({ length: TR }, () => {
    const row = new Array<boolean>(TC).fill(false);
    if (scattered) return row.map(() => rnd() < 0.3);
    if (rnd() < 0.1) return row.fill(true);
    for (let c = 0; c < TC; c++) {
      if (rnd() < 0.14) {
        const L = 1 + Math.floor(rnd() * 5);
        for (let q = 0; q < L && c < TC; q++, c++) row[c] = true;
      }
    }
    return row;
  });
  const glow = (x: number, y: number, w: number, h: number, r: number, c: number) => {
    if (!lit[r][c]) {
      // Konutlarda arada bir televizyon ışığı
      if (scattered && rnd() < 0.04) {
        n.fillStyle = '#7fa8ff';
        n.fillRect(x + w * 0.3, y + h * 0.3, w * 0.4, h * 0.4);
      }
      return;
    }
    const k = rnd();
    n.fillStyle = k < 0.5 ? '#ffe0a0' : k < 0.8 ? '#fff3d8' : '#e2ecff';
    n.fillRect(x, y, w, h);
  };
  // Her sütunda biraz farklı gökyüzü yansıması (cam düz bir renk olmasın)
  const colRef = Array.from({ length: TC }, () => (rnd() - 0.5) * 9);
  const pane = (x: number, y: number, w: number, h: number, H: number, S0: number, S1: number, L: number) => {
    const s = S0 + rnd() * (S1 - S0);
    const g = d.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, hsl(H + (rnd() - 0.5) * 6, s, L + 6));
    g.addColorStop(1, hsl(H + (rnd() - 0.5) * 6, s, L - 3));
    d.fillStyle = g;
    d.fillRect(x, y, w, h);
  };
  // Cam giydirme cephe: ince dikmeler, kat aralarında koyu bant, arada inik jaluziler
  const curtain = (bg: string, band: string, H: number, S0: number, S1: number, L0: number, L1: number, blinds = 0.1) => {
    d.fillStyle = bg;
    d.fillRect(0, 0, S, S);
    for (let r = 0; r < TR; r++) {
      for (let c = 0; c < TC; c++) {
        const x = c * cw, y = r * ch;
        d.fillStyle = band;
        d.fillRect(x, y + ch - 5, cw, 5);
        const px = x + 1, py = y + 1, pw = cw - 2, ph = ch - 7;
        pane(px, py, pw, ph, H, S0, S1, L0 + rnd() * (L1 - L0) + colRef[c]);
        if (rnd() < blinds) {
          d.fillStyle = 'rgba(232,238,244,0.55)';
          d.fillRect(px, py, pw, ph * (0.25 + rnd() * 0.5));
        }
        glow(px, py, pw, ph, r, c);
      }
    }
  };
  if (style === 'curtain') curtain('#d6dee6', '#2d4b63', 205, 38, 52, 40, 52);
  else if (style === 'silver') curtain('#f3f6f9', '#8d9cab', 207, 22, 32, 62, 74, 0.05);
  else if (style === 'gold') curtain('#5f4c33', '#3e3122', 37, 40, 52, 38, 49, 0.05);
  else if (style === 'dark') curtain('#2b333c', '#0c1116', 212, 20, 30, 16, 25, 0.03);
  else if (style === 'ribbon') {
    // Bant pencereler: katlar boyunca beyaz beton bant ve altında kesintisiz cam şerit
    d.fillStyle = '#eceff2';
    d.fillRect(0, 0, S, S);
    for (let r = 0; r < TR; r++) {
      for (let c = 0; c < TC; c++) {
        const x = c * cw, y = r * ch;
        const gy = y + Math.round(ch * 0.4), gh = ch - Math.round(ch * 0.4) - 2;
        pane(x, gy, cw, gh, 206, 28, 36, 40 + rnd() * 8 + colRef[c]);
        d.fillStyle = '#c2cbd4';
        d.fillRect(x, gy, 1, gh);
        d.fillStyle = '#d4d9de';
        d.fillRect(x, y + ch - 2, cw, 2);
        glow(x + 1, gy, cw - 1, gh, r, c);
      }
    }
  } else if (style === 'stone') {
    // Kalker taşı (art deco): pencerelerin arasında dikey ayaklar, altlarında süslü ara paneller
    d.fillStyle = '#e8dec8';
    d.fillRect(0, 0, S, S);
    for (let r = 0; r < TR; r++) {
      for (let c = 0; c < TC; c++) {
        const x = c * cw, y = r * ch;
        d.fillStyle = '#f5eee0';
        d.fillRect(x, y, 5, ch);
        d.fillStyle = '#cbbd9d';
        d.fillRect(x + 5, y, 1, ch);
        const wx = x + 8, wy = y + 3, ww = cw - 11, wh = ch - 11;
        pane(wx, wy, ww, wh, 208, 22, 30, 30 + rnd() * 8);
        d.fillStyle = '#b3a584';
        d.fillRect(wx, y + ch - 7, ww, 5);
        d.fillStyle = '#978a6c';
        d.fillRect(wx + 2, y + ch - 5, ww - 4, 1);
        glow(wx, wy, ww, wh, r, c);
      }
    }
  } else if (style === 'resi') {
    // Konut: yerden tavana camlar, kimisinde perde, önlerinde camlı balkon korkuluğu
    d.fillStyle = '#f5f5f3';
    d.fillRect(0, 0, S, S);
    const curtains = ['#eee7da', '#dde4ea', '#e9dccb', '#d9e2d6'];
    for (let r = 0; r < TR; r++) {
      for (let c = 0; c < TC; c++) {
        const x = c * cw, y = r * ch;
        const px = x + 1, py = y + 1, pw = cw - 2, ph = ch - 5;
        pane(px, py, pw, ph, 203, 26, 34, 50 + rnd() * 9);
        if (rnd() < 0.28) {
          d.fillStyle = pick(curtains, rnd);
          const f = rnd() < 0.35 ? 1 : 0.3 + rnd() * 0.35;
          d.fillRect(rnd() < 0.5 ? px : px + pw * (1 - f), py, pw * f, ph);
        }
        glow(px, py, pw, ph, r, c);
        d.fillStyle = 'rgba(214,236,246,0.75)';
        d.fillRect(px, py + ph - 7, pw, 7);
        d.fillStyle = '#ffffff';
        d.fillRect(px, py + ph - 7, pw, 1);
      }
    }
  } else {
    // Koyu taş kaplama, beyaz çerçeveli pencereler (yeşil balkonlu kule)
    d.fillStyle = '#857d71';
    d.fillRect(0, 0, S, S);
    for (let r = 0; r < TR; r++) {
      for (let c = 0; c < TC; c++) {
        const x = c * cw, y = r * ch;
        d.fillStyle = '#ddd7cb';
        d.fillRect(x + 4, y + 3, cw - 8, ch - 8);
        pane(x + 5, y + 4, cw - 10, ch - 10, 205, 14, 22, 28 + rnd() * 8);
        glow(x + 5, y + 4, cw - 10, ch - 10, r, c);
      }
    }
  }
  const make = (cv: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: make(day), glow: make(night) };
}

// Malzemeler bir kez yapılır (aynı malzemeli kuleler şehirde tek seferde çizilir)
const TEX = new Map<Style, { map: THREE.Texture; glow: THREE.Texture }>();
const MATS = new Map<string, THREE.MeshStandardMaterial>();
function glass(style: Style, color = '#ffffff', metal = 0.45, rough = 0.2) {
  const key = `${style}|${color}|${metal}|${rough}`;
  let m = MATS.get(key);
  if (!m) {
    let t = TEX.get(style);
    if (!t) TEX.set(style, (t = drawFacade(style)));
    m = new THREE.MeshStandardMaterial({ color, map: t.map, emissiveMap: t.glow, emissive: '#000000', metalness: metal, roughness: rough });
    // DayNight 'window' adlı malzemeleri gece yakar
    m.name = 'window';
    MATS.set(key, m);
  }
  return m;
}
// Parlak metal (çelik, altın): dokusuz malzemeler birleştirilirken parlaklığını kaybettiği için beyaz bir doku taşır
const WHITE = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 4, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const shiny = (color: string, metal: number, rough: number) => new THREE.MeshStandardMaterial({ color, map: WHITE, metalness: metal, roughness: rough });
const plain = (color: string, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const C = {
  white: plain('#f4f5f6', 0.6),
  slab: plain('#fbfbfa', 0.6),
  concrete: plain('#d9d6cf', 0.9),
  paving: plain('#cfd3d8', 0.9),
  stone: plain('#e9e3d6', 0.85),
  roof: plain('#7d868f', 0.85),
  gravel: plain('#a3a8ad', 1),
  darkMetal: plain('#3a434d', 0.5, 0.4),
  frame: plain('#dfe5ec', 0.4, 0.5),
  pad: plain('#4b545e', 0.8),
  yellow: plain('#ffd54f', 0.6),
  lawn: plain('#6cbd55', 1),
  wood: plain('#9a6a43', 0.8),
  deck: plain('#b98b5e', 0.8),
  awning: ['#e53935', '#1e88e5', '#43a047', '#fb8c00'].map(c => plain(c, 0.8)),
};
const STEEL = shiny('#d9dfe5', 0.85, 0.25);
const GOLD = shiny('#d9b25a', 0.8, 0.3);
const DARK_GLASS = shiny('#26323e', 0.6, 0.12);
const DOOR = shiny('#1c2833', 0.5, 0.2);
const GREENS = ['#4f9a3e', '#5aa845', '#6cbd55', '#3f8a3a', '#78c25a'].map(c => plain(c, 1));
const RAIL = new THREE.MeshStandardMaterial({ color: '#cfe9f5', transparent: true, opacity: 0.45, roughness: 0.1, depthWrite: false });
const POOL = new THREE.MeshStandardMaterial({ color: '#3fb6e8', roughness: 0.1, metalness: 0.1, emissive: '#0b3a52', emissiveIntensity: 0.4 });
// Gece yanan taç ışıkları (DayNight 'lamp' adlı malzemeleri yakar)
const LAMP = new THREE.MeshStandardMaterial({ color: '#eef4fb', emissive: '#ffffff', emissiveIntensity: 0 });
LAMP.name = 'lamp';
// Uçaklar için kırmızı uyarı ışığı (hep yanar)
export const RED_LIGHT = new THREE.MeshStandardMaterial({ color: '#ff3a3a', emissive: '#ff2020', emissiveIntensity: 1.2 });

// Gece yanan tabela (gündüz beyaz yazı koyu zemin, gece yazı parlar)
const SIGNS = new Map<string, THREE.MeshStandardMaterial>();
export function glowSign(text: string, bg: string) {
  const key = `${text}|${bg}`;
  let m = SIGNS.get(key);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = bg;
  x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#ffffff';
  x.font = 'bold 40px ui-rounded, system-ui, Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#000000', roughness: 0.4 });
  m.name = 'window';
  SIGNS.set(key, m);
  return m;
}

// --- Plan çokgenleri ([x, z] noktaları) ---
type P = [number, number];
type V = [number, number, number];
const rect = (w: number, d: number, x = 0, z = 0): P[] => [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]];
const chamfer = (w: number, d: number, c: number): P[] => [
  [-w / 2 + c, -d / 2], [w / 2 - c, -d / 2], [w / 2, -d / 2 + c], [w / 2, d / 2 - c],
  [w / 2 - c, d / 2], [-w / 2 + c, d / 2], [-w / 2, d / 2 - c], [-w / 2, -d / 2 + c],
];
// Köşeleri yuvarlak dikdörtgen (r = d/2 ise uçları yarım daire)
function roundRect(w: number, d: number, r: number, seg = 3): P[] {
  const out: P[] = [];
  const cs: V[] = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, Math.PI / 2], [-w / 2 + r, -d / 2 + r, Math.PI], [w / 2 - r, -d / 2 + r, Math.PI * 1.5]];
  for (const [cx, cz, a0] of cs) {
    for (let k = 0; k <= seg; k++) {
      const a = a0 + (k / seg) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  }
  return clean(out);
}
const ellipse = (rx: number, rz: number, n: number, a0 = 0): P[] =>
  Array.from({ length: n }, (_, i) => {
    const a = a0 + (i / n) * Math.PI * 2;
    return [Math.cos(a) * rx, Math.sin(a) * rz] as P;
  });
const rotate = (pts: P[], a: number): P[] => pts.map(([x, z]) => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)]);
const scale = (pts: P[], s: number): P[] => pts.map(([x, z]) => [x * s, z * s]);
const move = (pts: P[], dx: number, dz: number): P[] => pts.map(([x, z]) => [x + dx, z + dz]);
// Arka arkaya aynı noktaları at
function clean(pts: P[]) {
  return pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
  });
}
const areaOf = (pts: P[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};
// Kenarların dışa bakan yönleri
function edgeNormals(pts: P[]): P[] {
  const sg = areaOf(pts) > 0 ? 1 : -1;
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez) || 1;
    return [(sg * ez) / l, (-sg * ex) / l];
  });
}
// Çokgeni dışa doğru d kadar büyüt (eksi d: içe)
function offset(pts: P[], d: number): P[] {
  const en = edgeNormals(pts), n = pts.length;
  return pts.map((p, i) => {
    const a = en[(i - 1 + n) % n], b = en[i];
    let mx = a[0] + b[0], mz = a[1] + b[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const k = d / Math.max(0.25, mx * a[0] + mz * a[1]);
    return [p[0] + mx * k, p[1] + mz * k];
  });
}

// --- Geometriler ---
// Dikey yan yüzler: taban çokgeni, alt kenarın yüksekliği y0, boy h. top: tepede (0,0) çevresinde küçülme oranı
// (incelen kule), topY: eğik kesilmiş tepe. Doku katları binada hep aynı hizada (v = y / kat dokusu).
function sides(pts: P[], y0: number, h: number, opt: { top?: number; smooth?: boolean; topY?: (x: number, z: number) => number; inward?: boolean } = {}) {
  const n = pts.length, top = opt.top ?? 1;
  const en = edgeNormals(pts).map(([x, z]) => (opt.inward ? [-x, -z] : [x, z]) as P);
  const vn = pts.map((_, i) => {
    const a = en[(i - 1 + n) % n], b = en[i];
    const x = a[0] + b[0], z = a[1] + b[1], l = Math.hypot(x, z) || 1;
    return [x / l, z / l] as P;
  });
  const up = (p: P): V => {
    const x = p[0] * top, z = p[1] * top;
    return [x, opt.topY ? opt.topY(x, z) : y0 + h, z];
  };
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = pts[i], b = pts[j];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const A0: V = [a[0], y0, a[1]], B0: V = [b[0], y0, b[1]], A1 = up(a), B1 = up(b);
    const ux = B0[0] - A0[0], uz = B0[2] - A0[2];
    const wx = A1[0] - A0[0], wy = A1[1] - A0[1], wz = A1[2] - A0[2];
    let cx = -uz * wy, cy = uz * wx - ux * wz, cz = ux * wy;
    const cl = Math.hypot(cx, cy, cz) || 1;
    cx /= cl;
    cy /= cl;
    cz /= cl;
    const flip = cx * en[i][0] + cz * en[i][1] < 0;
    if (flip) {
      cx = -cx;
      cy = -cy;
      cz = -cz;
    }
    const u0 = s / TW, u1 = (s + len) / TW;
    const va: [V, number, number][] = [[A0, u0, i], [B0, u1, j], [B1, u1, j], [A0, u0, i], [B1, u1, j], [A1, u0, i]];
    const order = flip ? [0, 5, 4, 3, 2, 1] : [0, 1, 2, 3, 4, 5];
    for (const o of order) {
      const [p, u, k] = va[o];
      pos.push(p[0], p[1], p[2]);
      if (opt.smooth) nor.push(vn[k][0], 0, vn[k][1]);
      else nor.push(cx, cy, cz);
      uv.push(u, p[1] / TH);
    }
    s += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
// Düz (ya da eğik) kapak: çokgenin içi, yukarı bakar (under: aşağı bakar)
function capGeo(pts: P[], y: number | ((x: number, z: number) => number), under = false, holes: P[][] = []) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, under ? z : -z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, under ? z : -z))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(under ? Math.PI / 2 : -Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, typeof y === 'number' ? y : y(p.getX(i), p.getZ(i)));
  if (typeof y !== 'number') g.computeVertexNormals();
  return g;
}

// Kule çizim yardımcısı
class Kit {
  readonly g = new THREE.Group();
  add(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, ry = 0) {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.rotation.y = ry;
    o.castShadow = o.receiveShadow = true;
    this.g.add(o);
    return o;
  }
  // Kutu ve silindir: y alt kenar
  box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z, ry);
  }
  cyl(rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 12) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y + h / 2, z);
  }
  ball(r: number, m: THREE.Material, x: number, y: number, z: number) {
    return this.add(new THREE.IcosahedronGeometry(r, 0), m, x, y, z);
  }
  shaft(pts: P[], y0: number, h: number, m: THREE.Material, opt: Parameters<typeof sides>[3] = {}) {
    return this.add(sides(pts, y0, h, opt), m);
  }
  cap(pts: P[], y: number, m: THREE.Material) {
    return this.add(capGeo(pts, y), m);
  }
  // Döşeme ya da bant: yan yüzler ve üst kapak
  slab(pts: P[], y: number, h: number, m: THREE.Material) {
    this.add(sides(pts, y, h), m);
    this.add(capGeo(pts, y + h), m);
  }
  // İki nokta arasında kare kesitli çubuk
  bar(a: V, b: V, t: number, m: THREE.Material) {
    const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A);
    const o = this.add(new THREE.BoxGeometry(t, d.length(), t), m, A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return o;
  }
}
// Bir yüzün üstünde konum: side 0 ön (+z), 1 sağ (+x), 2 arka, 3 sol; along yüz boyunca, out yüzden dışarı
function onSide(side: number, half: number, along: number, out: number): V {
  const o = half + out;
  if (side === 0) return [along, o, 0];
  if (side === 1) return [o, -along, Math.PI / 2];
  if (side === 2) return [-along, -o, Math.PI];
  return [-o, along, -Math.PI / 2];
}
// Yüzde bir nokta (dünyada): yüzün ortasından along kadar yanda, y yükseklikte
function onFace(side: number, half: number, along: number, y: number): V {
  const [x, z] = onSide(side, half, along, 0);
  return [x, y, z];
}

// --- Ortak parçalar ---
interface Built {
  g: THREE.Group;
  door: P; // giriş kapısı (yayalar buradan girip çıkar)
  pad?: number; // helikopter pistinin yüksekliği
}
// Lobi katı: taban taşı, camlı giriş katı, kat bandı, cam kapılar, saçak ve direkleri, basamak, çiçeklikler
function base(k: Kit, w: number, d: number, h: number, wall: THREE.Material, trim: THREE.Material, canopy: THREE.Material = trim) {
  k.box(0.96, 0.02, 0.96, C.paving, 0, 0, 0);
  k.shaft(rect(w, d), 0.02, h, wall);
  k.cap(rect(w, d), 0.02 + h, C.roof);
  // Lobinin üstünde kat bandı (çatı kenarından biraz yüksek, ortası açık halka)
  k.add(sides(offset(rect(w, d), 0.004), 0.02 + h - 0.014, 0.018), trim);
  k.add(capGeo(offset(rect(w, d), 0.004), 0.02 + h + 0.004, false, [rect(w, d)]), trim);
  const f = d / 2, cy = Math.min(0.11, h - 0.02);
  k.box(0.18, 0.08, 0.006, DOOR, 0, 0.02, f + 0.003);
  k.box(0.2, 0.006, 0.008, trim, 0, 0.1, f + 0.004);
  k.box(0.36, 0.012, 0.08, canopy, 0, cy, f + 0.04);
  for (const s of [-1, 1]) k.cyl(0.004, 0.004, cy - 0.02, C.frame, s * 0.16, 0.02, f + 0.07, 6);
  k.box(0.24, 0.008, 0.05, C.stone, 0, 0.02, f + 0.025);
  for (const s of [-1, 1]) {
    k.box(0.11, 0.028, 0.045, C.concrete, s * 0.31, 0.02, f + 0.03);
    k.ball(0.026, GREENS[1], s * 0.29, 0.065, f + 0.03);
    k.ball(0.022, GREENS[3], s * 0.335, 0.06, f + 0.035);
  }
}
// Düz çatı: zemin, kenar duvarı (iç yüzü de çizilir)
function roof(k: Kit, pts: P[], y: number, edge: THREE.Material = C.white, floor: THREE.Material = C.gravel) {
  const out = offset(pts, 0.004), inn = offset(pts, -0.012);
  k.add(sides(out, y - 0.01, 0.035), edge);
  k.add(sides(inn, y, 0.025, { inward: true }), edge);
  k.add(capGeo(out, y + 0.025, false, [inn]), edge);
  k.cap(inn, y + 0.002, floor);
}
function hvac(k: Kit, x: number, z: number, y: number) {
  k.box(0.08, 0.04, 0.06, C.frame, x, y, z);
  for (const dx of [-0.02, 0.02]) k.cyl(0.014, 0.014, 0.004, C.darkMetal, x + dx, y + 0.04, z, 10);
}
// Cephe temizleme vinci (çatıda, beyaz kol)
function bmu(k: Kit, x: number, z: number, y: number, ry = 0) {
  k.box(0.07, 0.03, 0.05, C.white, x, y, z, ry);
  k.box(0.018, 0.07, 0.018, C.white, x, y + 0.03, z);
  k.box(0.2, 0.014, 0.014, C.white, x + Math.cos(ry) * 0.07, y + 0.1, z - Math.sin(ry) * 0.07, ry);
}
function beacon(k: Kit, x: number, y: number, z: number) {
  k.add(new THREE.SphereGeometry(0.012, 8, 6), RED_LIGHT, x, y, z);
}
function antenna(k: Kit, x: number, z: number, y: number, h: number) {
  k.cyl(0.003, 0.006, h, C.darkMetal, x, y, z, 6);
  beacon(k, x, y + h + 0.008, z);
}
// Helikopter pisti (üst yüzünün yüksekliğini döndürür)
function helipad(k: Kit, x: number, z: number, y: number, r: number) {
  k.cyl(r, r, 0.012, C.pad, x, y, z, 24);
  k.add(new THREE.CylinderGeometry(r * 0.88, r * 0.88, 0.014, 24, 1, true), C.yellow, x, y + 0.007, z);
  for (const dx of [-0.045, 0.045]) k.box(0.02, 0.003, 0.12, C.white, x + dx, y + 0.012, z);
  k.box(0.09, 0.003, 0.02, C.white, x, y + 0.012, z);
  for (let a = 0; a < 4; a++) k.add(new THREE.SphereGeometry(0.008, 6, 4), LAMP, x + Math.cos(a * 1.57 + 0.78) * r, y + 0.014, z + Math.sin(a * 1.57 + 0.78) * r);
  return y + 0.012;
}
// Gece yanan ışık şeridi (çokgenin çevresinde)
function lightRing(k: Kit, pts: P[], y: number, out = 0.006, h = 0.01) {
  k.add(sides(offset(pts, out), y, h), LAMP);
}
// Çatı bahçesi: çim, çalılar, birkaç ağaç
function roofGarden(k: Kit, pts: P[], y: number, r: () => number, n = 5) {
  roof(k, pts, y, C.white, C.lawn);
  const b = new THREE.Box2().setFromPoints(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  for (let i = 0; i < n; i++) {
    const x = THREE.MathUtils.lerp(b.min.x + 0.06, b.max.x - 0.06, r()), z = THREE.MathUtils.lerp(b.min.y + 0.06, b.max.y - 0.06, r());
    if (r() < 0.5) {
      k.cyl(0.004, 0.005, 0.04, C.wood, x, y, z, 5);
      k.ball(0.035 + r() * 0.015, pick(GREENS, r), x, y + 0.07, z);
    } else k.ball(0.022 + r() * 0.012, pick(GREENS, r), x, y + 0.02, z);
  }
}

// =====================================================================================================
// 5. seviye
// =====================================================================================================

// Yeşil kule (dikey orman): koyu taş kaplamalı kule, her iki katta bir dört yanda çıkıntılı balkonlar ve
// balkonlarda saksılardan taşan çalılar ve küçük ağaçlar; çatıda bahçe
function greenTower(h: number, seed: number): Built {
  const k = new Kit(), r = rng(seed);
  base(k, 0.8, 0.72, 0.12, glass('dark', '#ffffff', 0.5, 0.15), C.white);
  const W = 0.52, y0 = 0.14, top = h - 0.06;
  k.shaft(rect(W, W), y0, top - y0, glass('green', '#ffffff', 0.05, 0.75));
  roofGarden(k, rect(W, W), top, r, 7);
  for (let y = y0 + FL * 2, i = 0; y < top - 0.07; y += FL * 2, i++) {
    for (let side = 0; side < 4; side++) {
      for (const j of [-1, 1]) {
        const along = j * 0.13 + ((i + side) % 2 ? 0.05 : -0.05);
        const [x, z, ry] = onSide(side, W / 2, along, 0.035);
        k.box(0.17, 0.007, 0.07, C.concrete, x, y, z, ry);
        const [px, pz] = onSide(side, W / 2, along, 0.063);
        k.box(0.16, 0.024, 0.014, C.concrete, px, y + 0.007, pz, ry);
        const cnt = 1 + Math.floor(r() * 2);
        for (let q = 0; q < cnt; q++) {
          const [bx, bz] = onSide(side, W / 2, along + (q - (cnt - 1) / 2) * 0.07, 0.055);
          const s = 0.022 + r() * 0.016;
          k.ball(s, pick(GREENS, r), bx, y + 0.03 + s * 0.5, bz);
        }
        if (r() < 0.22) {
          const [tx, tz] = onSide(side, W / 2, along + 0.04, 0.05);
          k.cyl(0.003, 0.004, 0.045, C.wood, tx, y + 0.03, tz, 5);
          k.ball(0.036, pick(GREENS, r), tx, y + 0.085, tz);
        }
      }
    }
  }
  return { g: k.g, door: [0, 0.36] };
}

// Dalgalı balkonlu kule: cam kule, her katta kenarı dalga gibi kıvrılan beyaz balkon döşemeleri (dalgalar katlar
// boyunca kayar), çatıda havuzlu teras
function waveTower(h: number, seed: number): Built {
  const k = new Kit(), r = rng(seed);
  base(k, 0.8, 0.72, 0.12, glass('curtain', '#ffffff', 0.5, 0.15), C.white);
  const W = 0.56, D = 0.46, y0 = 0.14, top = h - 0.05;
  const plan = rect(W, D);
  k.shaft(plan, y0, top - y0, glass('curtain', pick(['#d2f0ec', '#ffffff', '#dde7ff'], r), 0.55, 0.14));
  // Çevre boyunca örnek noktalar ve dışa bakan yönleri (köşelerde köşegen)
  const samples: { p: P; n: P; t: number }[] = [];
  const en = edgeNormals(plan);
  const per = 2 * (W + D);
  let acc = 0;
  for (let i = 0; i < 4; i++) {
    const a = plan[i], b = plan[(i + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cnt = Math.max(3, Math.round(len / 0.04));
    for (let q = 0; q < cnt; q++) {
      const f = q / cnt;
      const prev = en[(i + 3) % 4], cur = en[i];
      const nn: P = q === 0 ? [(prev[0] + cur[0]) * 0.7071, (prev[1] + cur[1]) * 0.7071] : cur;
      samples.push({ p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], n: nn, t: (acc + len * f) / per });
    }
    acc += len;
  }
  const ph = r() * 6;
  for (let y = y0 + FL, i = 0; y < top - 0.03; y += FL, i++) {
    const pts = samples.map(({ p, n, t }) => {
      const w = Math.sin((t * 2 + i * 0.06) * Math.PI * 2 + ph) * 0.6 + Math.sin((t * 3 - i * 0.045) * Math.PI * 2 - ph) * 0.4;
      const o = 0.012 + Math.max(0, w) * 0.05;
      return [p[0] + n[0] * o, p[1] + n[1] * o] as P;
    });
    k.slab(pts, y - 0.004, 0.007, C.slab);
  }
  // Çatı terası: havuz, şezlonglar, camlı korkuluk
  roof(k, plan, top, C.white, C.deck);
  k.box(0.26, 0.012, 0.14, POOL, -0.08, top, -0.06);
  for (let q = 0; q < 3; q++) k.box(0.035, 0.012, 0.08, C.white, 0.14 + q * 0.05, top + 0.004, 0.08);
  hvac(k, 0.18, -0.15, top + 0.004);
  return { g: k.g, door: [0, 0.36] };
}

// Köşe balkonlu konut kulesi: beyaz çerçeveli konut cephesi, her katta dört köşeyi saran camlı balkonlar,
// cephelerin ortasında beyaz dikey şeritler; tepede geri çekilmiş çatı katı, pergola, bahçe ve su deposu
function terraceTower(h: number, seed: number): Built {
  const k = new Kit(), r = rng(seed);
  base(k, 0.8, 0.72, 0.12, glass('dark', '#ffffff', 0.5, 0.15), C.white, pick(C.awning, r));
  const W = 0.6, D = 0.54, y0 = 0.14, top = h - 0.16;
  k.shaft(rect(W, D), y0, top - y0, glass('resi', pick(['#ffffff', '#f6eee4', '#eef3f7'], r), 0.15, 0.4));
  for (const s of [-1, 1]) {
    k.box(0.034, top - y0, 0.012, C.white, 0, y0, s * (D / 2 + 0.006));
    k.box(0.012, top - y0, 0.034, C.white, s * (W / 2 + 0.006), y0, 0);
  }
  for (let y = y0 + FL; y < top - 0.02; y += FL) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        k.box(0.18, 0.006, 0.06, C.slab, sx * (W / 2 - 0.07), y, sz * (D / 2 + 0.03));
        k.box(0.06, 0.006, 0.16, C.slab, sx * (W / 2 + 0.03), y, sz * (D / 2 - 0.07));
        k.box(0.18, 0.022, 0.003, RAIL, sx * (W / 2 - 0.07), y + 0.006, sz * (D / 2 + 0.058));
        k.box(0.003, 0.022, 0.16, RAIL, sx * (W / 2 + 0.058), y + 0.006, sz * (D / 2 - 0.07));
      }
    }
  }
  // Çatı: bahçe, geri çekilmiş çatı katı, pergola, su deposu
  roofGarden(k, rect(W, D), top, r, 4);
  const pw = 0.38, pd = 0.3;
  k.shaft(rect(pw, pd, 0, -0.08), top, 0.1, glass('resi', '#ffffff', 0.15, 0.4));
  roof(k, rect(pw, pd, 0, -0.08), top + 0.1);
  for (let q = 0; q < 6; q++) k.box(0.008, 0.008, 0.16, C.white, -0.2 + q * 0.08, top + 0.1, 0.17);
  for (const x of [-0.2, 0.2]) k.box(0.008, 0.1, 0.008, C.white, x, top, 0.24);
  k.box(0.42, 0.008, 0.008, C.white, 0, top + 0.1, 0.24);
  k.cyl(0.04, 0.04, 0.07, C.frame, 0.1, top + 0.11, -0.12, 12);
  antenna(k, -0.12, -0.15, top + 0.11, 0.14);
  return { g: k.g, door: [0, 0.36] };
}

// =====================================================================================================
// 6. seviye
// =====================================================================================================

// Burgulu kule: köşeleri yuvarlak cam katlar yukarı çıktıkça dönerek toplam çeyrek tur döner, aralarında beyaz
// döşeme bantları; tepede ışıklı cam fener ve anten
function twistTower(h: number, seed: number): Built {
  const k = new Kit(), r = rng(seed);
  base(k, 0.8, 0.76, 0.14, glass('dark', '#ffffff', 0.5, 0.15), C.white);
  const plan = roundRect(0.56, 0.56, 0.11, 3);
  const y0 = 0.16, top = h - 0.14, seg = FL * 2;
  const n = Math.max(6, Math.floor((top - y0) / seg));
  const turn = Math.PI / 2 / n;
  const g = glass('curtain', pick(['#cfe4ff', '#d4f2ee', '#ffffff'], r), 0.55, 0.12);
  for (let i = 0; i < n; i++) {
    const y = y0 + i * seg, pts = rotate(plan, i * turn);
    k.shaft(pts, y, seg - 0.006, g, { smooth: true });
    k.slab(offset(pts, 0.008), y + seg - 0.006, 0.006, C.slab);
  }
  const yt = y0 + n * seg, pts = scale(rotate(plan, n * turn), 0.8);
  k.shaft(pts, yt, 0.1, glass('curtain', '#ffffff', 0.6, 0.1), { smooth: true });
  lightRing(k, pts, yt + 0.09, 0.004);
  k.cap(pts, yt + 0.1, C.roof);
  antenna(k, 0.06, 0.04, yt + 0.1, 0.22);
  return { g: k.g, door: [0, 0.38] };
}

// Kristal kule: pahlı köşeli mavi cam kule, köşelerde beyaz dikey çıtalar, her on iki katta koyu teknik kat bandı;
// tepesi önden arkaya eğik kesilmiş (eğik cam çatı), kenarlarında gece yanan ışık şeridi, arkada anten
function crystalTower(h: number, seed: number): Built {
  const k = new Kit(), r = rng(seed);
  base(k, 0.82, 0.76, 0.16, glass('curtain', '#ffffff', 0.5, 0.15), C.white);
  const W = 0.64, c = 0.13, plan = chamfer(W, W, c);
  const y0 = 0.18, yCut = h - 0.42;
  const g = glass('curtain', pick(['#cfe6ff', '#d3f2ee', '#ffffff'], r), 0.55, 0.12);
  k.shaft(plan, y0, yCut - y0, g);
  for (let y = y0 + FL * 12; y < yCut - 0.1; y += FL * 12) k.slab(offset(plan, 0.004), y, 0.022, C.darkMetal);
  // Pahlı köşelerde ikişer beyaz dikey çıta
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const mx = sx * (W / 2 - c / 2), mz = sz * (W / 2 - c / 2);
    const nx = sx * 0.7071, nz = sz * 0.7071;
    for (const t of [-0.03, 0.03]) {
      const x = mx + nz * t + nx * 0.012, z = mz - nx * t + nz * 0.012;
      k.box(0.008, yCut - y0, 0.024, C.white, x, y0, z, Math.atan2(nx, nz));
    }
  }
  // Eğik tepe: ön alçak, arka yüksek
  const topY = (x: number, z: number) => yCut + 0.06 + ((W / 2 - z) / W) * 0.3 + x * 0;
  k.add(sides(plan, yCut, 0, { topY }), g);
  k.add(capGeo(plan, topY), glass('silver', '#cfe6ff', 0.4, 0.1));
  for (let i = 0; i < plan.length; i++) {
    const a = plan[i], b = plan[(i + 1) % plan.length];
    k.bar([a[0], topY(a[0], a[1]) + 0.005, a[1]], [b[0], topY(b[0], b[1]) + 0.005, b[1]], 0.01, LAMP);
  }
  antenna(k, 0, -0.24, topY(0, -0.24), 0.26);
  return { g: k.g, door: [0, 0.38] };
}

// Bant pencereli ofis kulesi: uçları yuvarlak (stadyum planlı) ince uzun kule, katlar boyunca beyaz bantlar ve
// cam şeritler; arkada çatının üstüne çıkan koyu servis çekirdeği, çatıda ayaklar üstünde helikopter pisti
function ribbonTower(h: number, seed: number): Built {
  const k = new Kit(), r = rng(seed);
  base(k, 0.86, 0.64, 0.12, glass('dark', '#ffffff', 0.5, 0.15), C.white);
  const plan = roundRect(0.78, 0.4, 0.2, 6);
  const y0 = 0.14, top = h - 0.12;
  k.shaft(plan, y0, top - y0, glass('ribbon', pick(['#ffffff', '#f1f6fb'], r), 0.2, 0.35), { smooth: true });
  roof(k, plan, top);
  const core = rect(0.2, 0.1, 0, -0.22);
  k.shaft(core, y0, top - y0 + 0.14, glass('dark', '#ffffff', 0.5, 0.2));
  roof(k, core, top + 0.14, C.darkMetal);
  for (const x of [-0.07, 0.07]) beacon(k, x, top + 0.18, -0.22);
  // Helikopter pisti: dört ayak üstünde
  const px = 0.12, pz = 0.03, py = top + 0.06;
  for (const [dx, dz] of [[-0.09, -0.09], [0.09, -0.09], [0.09, 0.09], [-0.09, 0.09]]) k.box(0.012, 0.06, 0.012, C.darkMetal, px + dx, top, pz + dz);
  const pad = helipad(k, px, pz, py, 0.15);
  hvac(k, -0.24, 0.05, top + 0.004);
  return { g: k.g, door: [0, 0.32], pad };
}

// =====================================================================================================
// 7. seviye
// =====================================================================================================

// Çapraz örgülü kule: cam kule, dört yüzde dışarıdan geçen çelik çapraz kirişler (baklava örgüsü) ve her
// sekiz katta bir yatay kuşak; çatıda helikopter pisti ve cephe temizleme vinci
function diagridTower(h: number, seed: number): Built {
  const k = new Kit(), r = rng(seed);
  base(k, 0.82, 0.78, 0.16, glass('silver', '#ffffff', 0.35, 0.12), C.white);
  const W = 0.62, y0 = 0.18, top = h - 0.1;
  const plan = chamfer(W, W, 0.04);
  k.shaft(plan, y0, top - y0, r() < 0.5 ? glass('curtain', '#d8e9ff', 0.55, 0.12) : glass('dark', '#ffffff', 0.6, 0.1));
  const m = FL * 8, rows = Math.max(2, Math.floor((top - y0) / m));
  const half = W / 2 + 0.008, edge = W / 2 - 0.05;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < rows; i++) {
      const ya = y0 + i * m, yb = ya + m;
      for (const [xa, xb] of [[-edge, 0], [0, edge]]) {
        k.bar(onFace(side, half, xa, ya), onFace(side, half, xb, yb), 0.012, STEEL);
        k.bar(onFace(side, half, xb, ya), onFace(side, half, xa, yb), 0.012, STEEL);
      }
    }
  }
  for (let i = 0; i <= rows; i++) k.slab(offset(plan, 0.012), y0 + i * m - 0.006, 0.012, C.white);
  roof(k, plan, top);
  lightRing(k, plan, top + 0.026, 0.008, 0.008);
  const pad = helipad(k, -0.08, 0.06, top + 0.006, 0.16);
  bmu(k, 0.2, -0.2, top + 0.004, 0.8);
  hvac(k, 0.2, 0.18, top + 0.004);
  return { g: k.g, door: [0, 0.39], pad };
}

// Köprülü ikiz kuleler: pahlı köşeli iki gümüş cam kule (biri biraz kısa), tepelerinde ışık halkalı kademeler ve
// sivri uçlar, ortada gökyüzü köprüsü ve altındaki çelik payandalar
function twinTowers(h: number, seed: number): Built {
  const k = new Kit(), r = rng(seed);
  base(k, 0.88, 0.62, 0.14, glass('silver', '#ffffff', 0.35, 0.12), C.white);
  const g = glass('silver', pick(['#ffffff', '#e3eefc'], r), 0.35, 0.12);
  const plan = chamfer(0.32, 0.32, 0.06);
  const tops = [h - 0.44, (h - 0.44) * 0.93];
  [-0.215, 0.215].forEach((x, q) => {
    const top = tops[q];
    k.shaft(move(plan, x, 0), 0.16, top - 0.16, g);
    k.cap(move(plan, x, 0), top, C.roof);
    for (let y = 0.16 + FL * 10; y < top - 0.1; y += FL * 10) k.slab(move(offset(plan, 0.004), x, 0), y, 0.012, C.white);
    let y = top;
    for (const [s, th] of [[0.8, 0.09], [0.6, 0.08], [0.4, 0.07]] as [number, number][]) {
      const tp = move(scale(plan, s), x, 0);
      lightRing(k, tp, y, 0.008, 0.012);
      k.shaft(tp, y, th, g);
      y += th;
      k.cap(tp, y, C.roof);
    }
    k.cyl(0.002, 0.02, 0.34, STEEL, x, y, 0, 8);
    beacon(k, x, y + 0.35, 0);
  });
  const yb = tops[1] * 0.55;
  k.box(0.14, 0.04, 0.07, glass('silver', '#ffffff', 0.35, 0.12), 0, yb, 0);
  k.box(0.15, 0.008, 0.08, C.white, 0, yb + 0.04, 0);
  for (const s of [-1, 1]) k.bar([s * 0.06, yb - 0.24, 0], [0, yb, 0], 0.008, STEEL);
  return { g: k.g, door: [0, 0.31] };
}

// Yelken kule: elips planlı, yukarı doğru incelen gümüş cam kule; tepesi önden arkaya eğik kesik (koyu cam çatı,
// kenarında ışık şeridi), arkasında kuleden yüksek beyaz bıçak (gece yanan ışık çizgisiyle)
function sailTower(h: number, seed: number): Built {
  const k = new Kit(), r = rng(seed);
  base(k, 0.84, 0.74, 0.14, glass('curtain', '#ffffff', 0.5, 0.15), C.white);
  const plan = ellipse(0.35, 0.21, 28);
  const y0 = 0.16, y1 = h - 0.48, taper = 0.84;
  const g = r() < 0.5 ? glass('silver', '#e6f3ff', 0.35, 0.12) : glass('curtain', '#d4f2ee', 0.55, 0.12);
  k.shaft(plan, y0, y1 - y0, g, { top: taper, smooth: true });
  const tp = scale(plan, taper);
  const rz = 0.21 * taper;
  const topY = (x: number, z: number) => y1 + 0.02 + ((rz - z) / (2 * rz)) * 0.42 + x * 0;
  k.shaft(tp, y1, 0, g, { smooth: true, topY });
  k.add(capGeo(tp, topY), glass('silver', '#cfe6ff', 0.4, 0.1));
  for (let i = 0; i < tp.length; i++) {
    const a = tp[i], b = tp[(i + 1) % tp.length];
    k.bar([a[0], topY(a[0], a[1]) + 0.005, a[1]], [b[0], topY(b[0], b[1]) + 0.005, b[1]], 0.008, LAMP);
  }
  // Arkadaki bıçak: kabukla birlikte incelir, kulenin tepesinden yükseğe çıkar
  const bh = h + 0.12 - y0, bt = 1 - (1 - taper) * (bh / (y1 - y0));
  const blade: P[] = [[-0.045, -0.255], [0.045, -0.255], [0.045, -0.17], [-0.045, -0.17]];
  k.shaft(blade, y0, bh, C.white, { top: bt });
  k.cap(scale(blade, bt), y0 + bh, C.white);
  k.shaft([[-0.007, -0.254], [0.007, -0.254], [0.007, -0.249], [-0.007, -0.249]], y0 + 0.2, bh - 0.22, LAMP, { top: bt });
  beacon(k, 0, y0 + bh + 0.01, -0.21 * bt);
  return { g: k.g, door: [0, 0.37] };
}

// Holding kulesi: girintili köşeli koyu cam kule, iki kademede altın camlı bölüm ve altın kuşaklar, tepede ön ve
// arka yüzde gece yanan AKSOY tabelası, çatıda helikopter pisti
function holdingTower(h: number, seed: number): Built {
  const k = new Kit(), r = rng(seed);
  base(k, 0.86, 0.78, 0.16, glass('dark', '#ffffff', 0.55, 0.12), C.white, GOLD);
  const notch = (w: number, c: number): P[] => [
    [-w / 2 + c, -w / 2], [w / 2 - c, -w / 2], [w / 2 - c, -w / 2 + c], [w / 2, -w / 2 + c], [w / 2, w / 2 - c], [w / 2 - c, w / 2 - c],
    [w / 2 - c, w / 2], [-w / 2 + c, w / 2], [-w / 2 + c, w / 2 - c], [-w / 2, w / 2 - c], [-w / 2, -w / 2 + c], [-w / 2 + c, -w / 2 + c],
  ];
  const dark = glass('dark', '#ffffff', 0.6, 0.1), gold = glass('gold', '#ffffff', 0.6, 0.15);
  const y0 = 0.18, a = y0 + (h - y0) * 0.64, b = y0 + (h - y0) * 0.8, c = h - 0.16;
  const p1 = notch(0.64, 0.07), p2 = notch(0.54, 0.06), p3 = rect(0.46, 0.46);
  k.shaft(p1, y0, a - y0, dark);
  // Girintili köşelerde altın dikey çıtalar
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) k.box(0.012, a - y0, 0.012, GOLD, sx * (0.32 - 0.07), y0, sz * (0.32 - 0.07));
  k.slab(offset(p1, 0.006), a, 0.02, GOLD);
  k.shaft(p2, a + 0.02, b - a - 0.02, gold);
  k.slab(offset(p2, 0.006), b, 0.02, GOLD);
  k.shaft(p3, b + 0.02, c - b - 0.02, dark);
  const sign = glowSign(pick(['AKSOY', 'AKSOY', 'MERKEZ'], r), '#0d2a4a');
  for (const s of [-1, 1]) k.box(0.36, 0.09, 0.008, sign, 0, c - 0.13, s * 0.234, s < 0 ? Math.PI : 0);
  roof(k, p3, c);
  const pad = helipad(k, 0, 0, c + 0.006, 0.17);
  for (const [x, z] of [[-0.21, -0.21], [0.21, 0.21]]) beacon(k, x, c + 0.04, z);
  return { g: k.g, door: [0, 0.39], pad };
}

// =====================================================================================================
// 8. seviye
// =====================================================================================================

// Üç kanatlı süper kule: Y planlı (üç kanat ve ortada altıgen çekirdek), kanatlar yukarı çıktıkça sırayla kısalır
// (sarmal kademeler), kanat uçlarında gece yanan ışık çizgileri; çekirdeğin üstünde uzun çelik sivri uç
function burjTower(h: number, seed: number): Built {
  const k = new Kit();
  base(k, 0.9, 0.8, 0.12, glass('silver', '#ffffff', 0.35, 0.12), C.white);
  const g = glass('silver', '#ffffff', 0.35, 0.12);
  const spire = Math.min(1.0, h * 0.28);
  const body = h - spire - 0.12, y0 = 0.14;
  const fr = [0, 0.24, 0.42, 0.56, 0.67, 0.76, 0.83, 0.89, 0.94];
  // Kanatlar: biri arkaya, ikisi önde sağa ve sola (giriş öndeki iki kanadın arasında)
  const angles = [Math.PI, Math.PI / 3, -Math.PI / 3];
  for (let t = 0; t < fr.length - 1; t++) {
    const ya = y0 + (body - y0) * fr[t], yb = y0 + (body - y0) * fr[t + 1];
    angles.forEach((a, w) => {
      const len = 0.44 - 0.048 * t - (t > 0 ? ((t + w) % 3) * 0.018 : 0);
      if (len < 0.12) return;
      const wing = rotate([[-0.085, 0], [0.085, 0], [0.085, len], [-0.085, len]], a);
      k.shaft(wing, ya, yb - ya, g);
      k.cap(wing, yb, C.roof);
      const tip = rotate([[-0.01, len + 0.004], [0.01, len + 0.004], [0.01, len - 0.002], [-0.01, len - 0.002]], a);
      k.shaft(tip, ya + 0.02, yb - ya - 0.04, LAMP);
    });
  }
  const core = ellipse(0.11, 0.11, 6, Math.PI / 6);
  k.shaft(core, y0, body + 0.12 - y0, g);
  k.cap(core, body + 0.12, C.roof);
  const ys = body + 0.12;
  k.cyl(0.005, 0.045, spire, STEEL, 0, ys, 0, 8);
  for (let q = 1; q <= 3; q++) k.cyl(0.04 * (1 - q * 0.22), 0.046 * (1 - q * 0.22), 0.012, STEEL, 0, ys + spire * q * 0.18, 0, 8);
  beacon(k, 0, ys + spire + 0.008, 0);
  return { g: k.g, door: [0, 0.4] };
}

// Art deco kule: kalker taşı cepheli, yukarı doğru dört kademede daralan kule, kademelerde altın kuşaklar ve köşe
// ayakları; tepede üç kat paslanmaz çelik kemerli taç (kemerlerin içinde gece yanan ışın şeklinde pencereler) ve
// uzun iğne
function decoTower(h: number, seed: number): Built {
  const k = new Kit(), r = rng(seed);
  const stone = glass('stone', pick(['#ffffff', '#f6ead6'], r), 0.05, 0.72);
  base(k, 0.9, 0.8, 0.14, stone, GOLD, GOLD);
  const crownH = 0.52, spire = 0.5, y0 = 0.16;
  const bodyTop = h - crownH - spire;
  let y = y0;
  for (const [w, f] of [[0.74, 0.5], [0.62, 0.72], [0.5, 0.86], [0.4, 1]] as [number, number][]) {
    const yt = y0 + (bodyTop - y0) * f;
    const pts = chamfer(w, w, w * 0.12);
    k.shaft(pts, y, yt - y, stone);
    // Köşe ayakları
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) k.box(0.028, yt - y, 0.028, C.stone, sx * (w / 2 - w * 0.06), y, sz * (w / 2 - w * 0.06), Math.PI / 4);
    k.slab(offset(pts, 0.008), yt, 0.016, GOLD);
    y = yt + 0.016;
  }
  // Taç: dört kat çelik kademe, her yüzde kemer ve içinde ışın pencereler
  for (let i = 0; i < 4; i++) {
    const w = 0.36 * (1 - i * 0.2), th = crownH / 4;
    k.shaft(rect(w, w), y, th, STEEL);
    const R = w * 0.36;
    for (let side = 0; side < 4; side++) {
      const [x, z, ry] = onSide(side, w / 2, 0, 0.004);
      const arch = k.add(new THREE.TorusGeometry(R, 0.007, 4, 14, Math.PI), GOLD, x, y + th * 0.15, z, ry);
      arch.rotation.y = ry;
      for (let q = 0; q < 5; q++) {
        const a = Math.PI * (0.15 + q * 0.175), len = R * 0.75;
        const cx = Math.cos(a) * len * 0.5, cy = Math.sin(a) * len * 0.5;
        const [bx, bz] = onSide(side, w / 2, cx, 0.005);
        const o = k.box(0.008, len, 0.004, LAMP, bx, y + th * 0.15 + cy - len / 2, bz, ry);
        o.rotation.z = a - Math.PI / 2;
      }
    }
    y += th;
    k.cap(rect(w, w), y, STEEL);
  }
  k.cyl(0.001, 0.016, spire, STEEL, 0, y, 0, 8);
  beacon(k, 0, y + spire + 0.008, 0);
  return { g: k.g, door: [0, 0.4] };
}

// Piramit kule: yukarı doğru incelen beyaz taş kule, üst yarısında iki yanda gövdeyle birlikte incelen kanatlar
// (asansör kuleleri), tepede alüminyum sivri külah
function pyramidTower(h: number, seed: number): Built {
  const k = new Kit(), r = rng(seed);
  base(k, 0.86, 0.8, 0.12, glass('dark', '#ffffff', 0.5, 0.15), C.white);
  const stone = glass('stone', pick(['#ffffff', '#f4f1ea'], r), 0.05, 0.7);
  const y0 = 0.14, Hp = h - 0.44 - y0, taper = 0.14, half = 0.36;
  k.shaft(rect(half * 2, half * 2), y0, Hp, stone, { top: taper });
  const yw = y0 + Hp * 0.55;
  const fw = (yy: number) => half * (1 - (1 - taper) * ((yy - y0) / Hp));
  const hw = fw(yw), tt = (half * taper) / hw;
  for (const s of [-1, 1]) {
    const wing: P[] = s > 0 ? [[hw - 0.05, -0.07], [hw + 0.045, -0.07], [hw + 0.045, 0.07], [hw - 0.05, 0.07]] : [[-hw - 0.045, -0.07], [-hw + 0.05, -0.07], [-hw + 0.05, 0.07], [-hw - 0.045, 0.07]];
    k.shaft(wing, yw, y0 + Hp - yw, stone, { top: tt });
    k.cap(scale(wing, tt), y0 + Hp, C.roof);
    k.add(capGeo(wing, yw, true), C.roof);
  }
  const yt = y0 + Hp, tw = half * taper;
  k.cap(rect(tw * 2 + 0.03, tw * 2 + 0.03), yt, C.roof);
  k.add(new THREE.ConeGeometry(tw * Math.SQRT2 + 0.01, 0.44, 4, 1).rotateY(Math.PI / 4), STEEL, 0, yt + 0.22, 0);
  beacon(k, 0, yt + 0.45, 0);
  return { g: k.g, door: [0, 0.4] };
}

// --- Kayıt: menüler ve şehir için hazır kuleler 'proc/sky-<biçim>-<boy>' ---
const DESIGNS: Record<string, { make: (h: number, seed: number) => Built; name: string }> = {
  green: { make: greenTower, name: 'Yeşil kule' },
  wave: { make: waveTower, name: 'Dalgalı kule' },
  terrace: { make: terraceTower, name: 'Balkonlu kule' },
  twist: { make: twistTower, name: 'Burgulu kule' },
  crystal: { make: crystalTower, name: 'Kristal kule' },
  ribbon: { make: ribbonTower, name: 'Ofis kulesi' },
  diagrid: { make: diagridTower, name: 'Örgülü kule' },
  twins: { make: twinTowers, name: 'İkiz kuleler' },
  sail: { make: sailTower, name: 'Yelken kule' },
  holding: { make: holdingTower, name: 'Holding kulesi' },
  burj: { make: burjTower, name: 'Süper kule' },
  deco: { make: decoTower, name: 'Art deco kule' },
  pyramid: { make: pyramidTower, name: 'Piramit kule' },
};
export const SKY_NAMES: Record<string, string> = {};
const hash = (n: number, k: number) => {
  const s = Math.sin(n * 91.7 + k * 37.3) * 43758.5453;
  return s - Math.floor(s);
};
export function skylinePaths(height: number, designs: string[], seed: number) {
  return designs.map((name, q) => {
    const path = `proc/sky-${name}-${height}`;
    const h = height * (0.95 + hash(seed + q, 9) * 0.1);
    const d = DESIGNS[name];
    // Kapı ve pist yüksekliği modeli çizmeden bilinsin diye bir kez çizilir (model sonra da önbellekten gelir)
    let built: Built | null = null;
    const make = () => (built ??= d.make(h, seed + q * 13));
    TOWER_MODELS[path] = () => make().g;
    SKY_NAMES[path] = d.name;
    Object.defineProperty(DOORS, path, { get: () => make().door, enumerable: true, configurable: true });
    if (name === 'ribbon' || name === 'diagrid' || name === 'holding') Object.defineProperty(HELIPADS, path, { get: () => make().pad, enumerable: true, configurable: true });
    return path;
  });
}
