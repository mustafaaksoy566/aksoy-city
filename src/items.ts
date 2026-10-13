import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Üretim eşyaları: fabrikanın ham maddeleri ve dükkânların ürünleri için gerçekçi küçük 3D modeller.
// Gerçek oranlar, doğal (hafif soluk) renkler, yumuşatılmış kenarlar, fiziksel malzemeler (fırçalanmış çelik,
// parlak plastik, mat kumaş, cilalı seramik, cam) ve kodla çizilen dokular (ahşap damarı, yıllık halka, kabuk,
// kumaş örgüsü, tuğla, devre kartı, çuval baskısı, ekmek kabuğu...). Dokular piksel piksel hesaplanır
// (DataTexture): canvas gerekmez, ilk kullanımda bir kere üretilir ve bütün eşyalar paylaşır.
// Açılışta bir kere resme çevrilir (thumbs.ts): kamera (1, 0.85, 1) yönünden bakar, ışık (-3, 6, 4)'ten gelir;
// yani üst yüzler ve +z yüzü (ekranda sol) aydınlık, +x yüzü (ekranda sağ) gölgede. Eşyaların ön yüzü bu yüzden
// +z ile kamera arasına bakar. Parçalar malzemeye göre birleştirilir (sınır kutusu sıkı olur, resim iyi
// ortalanır); her model en uzun kenarı 1 birim olacak şekilde ölçeklenir, y=0 üstünde ve ortada durur.
// Metal ve cilalı yüzeyler en iyi bir ortam haritasıyla (RoomEnvironment + PMREM) görünür.

export type ItemId = 'metal' | 'wood' | 'plastic' | 'mineral' | 'seeds' | 'textile' | 'chem' | 'sugar' | 'glass' | 'parts'
  | 'nails' | 'hammer' | 'paint' | 'brick' | 'veggies' | 'flour' | 'chair' | 'sofa' | 'simit' | 'cake' | 'shirt' | 'shoes'
  | 'sapling' | 'gnome' | 'icecream' | 'burger' | 'tv' | 'fridge';

export const ITEM_IDS: ItemId[] = [
  'metal', 'wood', 'plastic', 'mineral', 'seeds', 'textile', 'chem', 'sugar', 'glass', 'parts',
  'nails', 'hammer', 'paint', 'brick', 'veggies', 'flour', 'chair', 'sofa', 'simit', 'cake', 'shirt', 'shoes',
  'sapling', 'gnome', 'icecream', 'burger', 'tv', 'fridge',
];

// ======================= Küçük matematik yardımcıları =======================
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const fract = (v: number) => v - Math.floor(v);
type RGB = number[];
// '#rrggbb' -> [r, g, b] (0..1, sRGB)
function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function mixc(a: RGB, b: RGB, t: number, out: RGB) {
  for (let i = 0; i < 3; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}
function mul(c: RGB, k: number) {
  c[0] *= k;
  c[1] *= k;
  c[2] *= k;
  return c;
}
// Tamsayı karması: 0..1
function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
// Döşenebilir değer gürültüsü: x, y ızgara biriminde; px, py periyot (doku kenarları dikişsiz birleşir)
function vnoise(x: number, y: number, px: number, py: number, s = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const X0 = ((x0 % px) + px) % px;
  const Y0 = ((y0 % py) + py) % py;
  const X1 = (X0 + 1) % px;
  const Y1 = (Y0 + 1) % py;
  const a = hash(X0, Y0, s);
  const b = hash(X1, Y0, s);
  const c = hash(X0, Y1, s);
  const d = hash(X1, Y1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number, px: number, py: number, oct = 4, s = 0) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  let n = 0;
  for (let o = 0; o < oct; o++) {
    v += amp * vnoise(x * f, y * f, px * f, py * f, s + o * 17);
    n += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / n;
}
// Her seferinde aynı çıkan rastgele sayılar
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ======================= Dokular =======================
// Piksel tuvali: u, v 0..1 (v yukarı, dokunun uv'si ile aynı), renkler sRGB 0..1
class Pix {
  w: number;
  h: number;
  d: Float32Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.d = new Float32Array(w * h * 3);
  }
  // Her pikselin rengini hesapla
  fill(fn: (u: number, v: number, c: RGB) => void) {
    const c = [0, 0, 0];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        c[0] = c[1] = c[2] = 0;
        fn((x + 0.5) / this.w, (y + 0.5) / this.h, c);
        const i = (y * this.w + x) * 3;
        this.d[i] = c[0];
        this.d[i + 1] = c[1];
        this.d[i + 2] = c[2];
      }
    }
    return this;
  }
  // Örtü fonksiyonuyla (0..1, kenarı yumuşak) üstüne renk sür
  cover(cov: (x: number, y: number) => number, col: RGB, a: number, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    const xa = Math.max(0, Math.floor(u0 * this.w) - 2);
    const xb = Math.min(this.w - 1, Math.ceil(u1 * this.w) + 2);
    const ya = Math.max(0, Math.floor(v0 * this.h) - 2);
    const yb = Math.min(this.h - 1, Math.ceil(v1 * this.h) + 2);
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const k = cov(x + 0.5, y + 0.5) * a;
        if (k <= 0) continue;
        const i = (y * this.w + x) * 3;
        for (let c = 0; c < 3; c++) this.d[i + c] += (col[c] - this.d[i + c]) * Math.min(1, k);
      }
    }
    return this;
  }
  // Kalın çizgi (uv biriminde, kalınlık piksel değil uv cinsinden u yönünde ölçülür)
  line(u0: number, v0: number, u1: number, v1: number, wd: number, col: RGB, a = 1) {
    const ax = u0 * this.w;
    const ay = v0 * this.h;
    const bx = u1 * this.w;
    const by = v1 * this.h;
    const r = (wd * this.w) / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy || 1;
    return this.cover((x, y) => {
      const t = clamp01(((x - ax) * dx + (y - ay) * dy) / L2);
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      return clamp01(r - d + 0.5);
    }, col, a, Math.min(u0, u1) - wd, Math.min(v0, v1) - wd * 2, Math.max(u0, u1) + wd, Math.max(v0, v1) + wd * 2);
  }
  // Elips (dolu); rot radyan
  ellipse(cu: number, cv: number, ru: number, rv: number, col: RGB, a = 1, rot = 0) {
    const cx = cu * this.w;
    const cy = cv * this.h;
    const rx = ru * this.w;
    const ry = rv * this.h;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const rm = Math.max(ru, rv);
    return this.cover((x, y) => {
      const px = x - cx;
      const py = y - cy;
      const lx = (px * c + py * s) / rx;
      const ly = (-px * s + py * c) / ry;
      const d = Math.sqrt(lx * lx + ly * ly);
      return clamp01((1 - d) * Math.min(rx, ry) + 0.5);
    }, col, a, cu - rm, cv - rm * 2, cu + rm, cv + rm * 2);
  }
  // Halka (iç ve dış yarıçap, u cinsinden; doku kare değilse v oranlanır)
  ring(cu: number, cv: number, r0: number, r1: number, col: RGB, a = 1) {
    const cx = cu * this.w;
    const cy = cv * this.h;
    return this.cover((x, y) => {
      const d = Math.hypot((x - cx) / this.w, ((y - cy) / this.h) * (this.h / this.w));
      return clamp01(Math.min(d - r0, r1 - d) * this.w + 0.5);
    }, col, a, cu - r1, cv - r1 * 2, cu + r1, cv + r1 * 2);
  }
  rect(u0: number, v0: number, u1: number, v1: number, col: RGB, a = 1) {
    return this.cover((x, y) => {
      const u = x / this.w;
      const v = y / this.h;
      return clamp01(Math.min(u - u0, u1 - u) * this.w + 0.5) * clamp01(Math.min(v - v0, v1 - v) * this.h + 0.5);
    }, col, a, u0, v0, u1, v1);
  }
}
const TEX = new Map<string, THREE.DataTexture>();
// Adıyla bir kere üret, sonra hep aynısını ver
function getTex(name: string, draw: () => Pix) {
  let t = TEX.get(name);
  if (t) return t;
  const p = draw();
  const data = new Uint8Array(p.w * p.h * 4);
  for (let i = 0; i < p.w * p.h; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(clamp01(p.d[i * 3 + c]) * 255);
    data[i * 4 + 3] = 255;
  }
  t = new THREE.DataTexture(data, p.w, p.h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.name = name;
  t.needsUpdate = true;
  TEX.set(name, t);
  return t;
}

// Ahşap damarı (damarlar v yönünde uzanır); renk malzemeyle tonlanır
function woodTex() {
  const light = rgb('#e4c08f');
  const dark = rgb('#a5764a');
  return getTex('wood', () => new Pix(128, 256).fill((u, v, c) => {
    const warp = fbm(u * 3, v * 2, 3, 2, 3, 11) * 1.7;
    const ring = 0.5 + 0.5 * Math.sin((u * 9 + warp) * Math.PI * 2);
    const fine = vnoise(u * 96, v * 6, 96, 6, 12);
    const t = Math.pow(ring, 5) * 0.55 + fine * 0.28 + fbm(u * 6, v * 3, 6, 3, 2, 13) * 0.17;
    mixc(light, dark, t, c);
  }));
}
// Kütük kesiti: yıllık halkalar, öz, çatlaklar, kabuk halkası (silindir kapağının daire uv'sine göre)
function endGrainTex() {
  const early = rgb('#e8c48e');
  const late = rgb('#b98450');
  const pith = rgb('#8a5a32');
  const cambium = rgb('#c99a62');
  const bark = rgb('#4a3322');
  return getTex('endgrain', () => {
    const p = new Pix(128, 128).fill((u, v, c) => {
      const dx = u - 0.5;
      const dy = v - 0.5;
      const a = Math.atan2(dy, dx);
      const r = Math.hypot(dx, dy) * 2;
      const wob = (vnoise(Math.cos(a) * 2.5 + 4, Math.sin(a) * 2.5 + 4, 64, 64, 21) - 0.5) * 0.1;
      const rr = r * (1 + wob) + 0.02 * vnoise(u * 40, v * 40, 40, 40, 23);
      const ring = fract(rr * 11);
      const lw = smooth(0.6, 0.85, ring) * (1 - smooth(0.92, 1, ring));
      mixc(early, late, lw * 0.85 + vnoise(u * 96, v * 96, 96, 96, 22) * 0.12, c);
      if (r < 0.06) mixc(c, pith, 0.7 * (1 - r / 0.06), c);
      if (r > 0.84) mixc(c, cambium, smooth(0.84, 0.88, r), c);
      if (r > 0.9) mixc(c, bark, smooth(0.9, 0.93, r), c);
    });
    const r = rng(24);
    for (let k = 0; k < 3; k++) {
      const a = r() * Math.PI * 2;
      const l = 0.12 + r() * 0.18;
      p.line(0.5 + Math.cos(a) * 0.03, 0.5 + Math.sin(a) * 0.03, 0.5 + Math.cos(a) * l, 0.5 + Math.sin(a) * l, 0.006, rgb('#6e4a2c'), 0.75);
    }
    return p;
  });
}
// Ağaç kabuğu: boyuna derin yarıklar (v boyunca)
function barkTex() {
  const crev = rgb('#2f2015');
  const ridge = rgb('#7a5a3e');
  const grey = rgb('#8a8173');
  return getTex('bark', () => new Pix(128, 256).fill((u, v, c) => {
    const n = fbm(u * 8, v * 3, 8, 3, 4, 31);
    const f = Math.abs(Math.sin((u * 9 + n * 1.5) * Math.PI));
    mixc(crev, ridge, smooth(0.08, 0.6, f), c);
    mixc(c, grey, smooth(0.6, 0.9, fbm(u * 4, v * 4, 4, 4, 3, 33)) * 0.35, c);
    mul(c, 0.8 + 0.4 * fbm(u * 16, v * 24, 16, 24, 3, 32));
  }));
}
// Ekose yün kumaş (2/2 dimi örgü)
const SETT: [string, number][] = [['#26324a', 18], ['#2e4d3b', 12], ['#8c2e2a', 4], ['#2e4d3b', 12], ['#d2c49c', 2], ['#26324a', 16]];
function settAt(i: number) {
  let s = 0;
  for (const [col, w] of SETT) {
    s += w;
    if (i < s) return rgb(col);
  }
  return rgb(SETT[0][0]);
}
function plaidTex() {
  return getTex('plaid', () => new Pix(128, 128).fill((u, v, c) => {
    const x = Math.floor(u * 128);
    const y = Math.floor(v * 128);
    const twill = ((x + y) >> 1) % 2 === 0;
    const col = twill ? settAt(x % 64) : settAt(y % 64);
    mixc(col, col, 0, c);
    mul(c, 0.86 + 0.14 * hash(x, y, 7) + (twill ? 0.04 : 0));
  }));
}
// Top kumaşın ucu: üst üste sarılmış katlar
function clothEndTex() {
  const a = rgb('#2c3850');
  const b = rgb('#45577a');
  return getTex('clothend', () => new Pix(128, 128).fill((u, v, c) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const k = fract(r * 16 + 0.1 * vnoise(u * 20, v * 20, 20, 20, 3));
    mixc(a, b, smooth(0.55, 0.9, k) * (1 - smooth(0.9, 1, k)), c);
  }));
}
// Çuval bezi (kaba örgü)
function weave(u: number, v: number, n: number, base: RGB, c: RGB) {
  const x = u * n;
  const y = v * n;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const over = (cx + cy) % 2 === 0;
  const s = over ? Math.sin(fract(x) * Math.PI) : Math.sin(fract(y) * Math.PI);
  mixc(base, base, 0, c);
  mul(c, (0.7 + 0.3 * s) * (0.88 + 0.2 * hash(cx, cy, 5)));
}
const BURLAP = rgb('#d4bc8e');
function burlapTex() {
  return getTex('burlap', () => new Pix(64, 64).fill((u, v, c) => weave(u, v, 16, BURLAP, c)));
}
// Un çuvalının ön yüzü: bez örgüsü üstüne baskı (başak, çember, "UN" yazısı, şeritler)
function sackPrintTex() {
  return getTex('sackprint', () => {
    const p = new Pix(128, 128).fill((u, v, c) => weave(u, v, 48, BURLAP, c));
    const ink = rgb('#8c2f22');
    const blue = rgb('#2d4f86');
    p.rect(0, 0.74, 1, 0.77, blue, 0.85);
    p.rect(0, 0.79, 1, 0.8, blue, 0.85);
    p.ring(0.5, 0.48, 0.19, 0.215, ink, 0.85);
    p.line(0.5, 0.33, 0.5, 0.6, 0.016, ink, 0.85);
    for (let k = 0; k < 4; k++) {
      const y = 0.43 + k * 0.045;
      p.ellipse(0.47, y, 0.022, 0.034, ink, 0.85, 0.5);
      p.ellipse(0.53, y, 0.022, 0.034, ink, 0.85, -0.5);
    }
    p.ellipse(0.5, 0.62, 0.02, 0.035, ink, 0.85);
    p.ellipse(0.455, 0.36, 0.012, 0.04, ink, 0.85, 0.7);
    p.ellipse(0.545, 0.36, 0.012, 0.04, ink, 0.85, -0.7);
    // "UN"
    const W = 0.022;
    p.line(0.38, 0.22, 0.38, 0.13, W, ink, 0.9);
    p.line(0.38, 0.13, 0.405, 0.11, W, ink, 0.9);
    p.line(0.405, 0.11, 0.445, 0.11, W, ink, 0.9);
    p.line(0.445, 0.11, 0.47, 0.13, W, ink, 0.9);
    p.line(0.47, 0.13, 0.47, 0.22, W, ink, 0.9);
    p.line(0.53, 0.11, 0.53, 0.22, W, ink, 0.9);
    p.line(0.53, 0.22, 0.62, 0.11, W, ink, 0.9);
    p.line(0.62, 0.11, 0.62, 0.22, W, ink, 0.9);
    return p;
  });
}
// Pişmiş kil (tuğla): benekli, kenarları biraz yanık (rounded box yüzlerinin 0..1 uv'sine göre)
function brickTex() {
  const a = rgb('#b45a40');
  const b = rgb('#93432f');
  const dark = rgb('#5e2a1d');
  const sand = rgb('#d39a72');
  return getTex('brick', () => new Pix(128, 64).fill((u, v, c) => {
    mixc(a, b, fbm(u * 8, v * 4, 8, 4, 4, 41), c);
    const s = hash(Math.floor(u * 128), Math.floor(v * 64), 42);
    if (s > 0.965) mixc(c, dark, 0.55, c);
    else if (s < 0.04) mixc(c, sand, 0.45, c);
    const e = Math.min(u, 1 - u, v, 1 - v);
    mul(c, 1 - 0.22 * (1 - smooth(0, 0.1, e)));
  }));
}
// Devre kartı: yeşil lehim maskesi altında yollar, lehim pedleri, delikler, beyaz baskı
function pcbTex() {
  return getTex('pcb', () => {
    const base = rgb('#1f5f34');
    const base2 = rgb('#174a28');
    const trace = rgb('#3f8a4c');
    const pad = rgb('#d8d6cc');
    const silk = rgb('#eef0ea');
    const p = new Pix(256, 256).fill((u, v, c) => mixc(base, base2, fbm(u * 6, v * 6, 6, 6, 2, 51) * 0.6, c));
    const r = rng(52);
    for (let k = 0; k < 46; k++) {
      let x = Math.round(r() * 24) / 24;
      let y = Math.round(r() * 24) / 24;
      p.ellipse(x, y, 0.011, 0.011, pad, 1);
      const segs = 2 + Math.floor(r() * 3);
      for (let s = 0; s < segs; s++) {
        const len = ((1 + Math.floor(r() * 4)) / 24) * (r() < 0.5 ? -1 : 1);
        const kind = r();
        const nx = kind < 0.45 ? x + len : kind < 0.8 ? x : x + len;
        const ny = kind < 0.45 ? y : y + len;
        p.line(x, y, nx, ny, 0.009, trace, 0.95);
        x = nx;
        y = ny;
      }
      p.ellipse(x, y, 0.013, 0.013, pad, 1);
      p.ellipse(x, y, 0.005, 0.005, rgb('#2a2a2a'), 1);
    }
    for (let k = 0; k < 8; k++) {
      const x = 0.1 + r() * 0.75;
      const y = 0.1 + r() * 0.75;
      const w = 0.04 + r() * 0.06;
      const h = 0.02 + r() * 0.03;
      p.line(x, y, x + w, y, 0.004, silk, 0.9);
      p.line(x, y + h, x + w, y + h, 0.004, silk, 0.9);
      p.line(x, y, x, y + h, 0.004, silk, 0.9);
      p.line(x + w, y, x + w, y + h, 0.004, silk, 0.9);
      p.rect(x + w + 0.01, y, x + w + 0.035, y + 0.012, silk, 0.8);
    }
    return p;
  });
}
// Ekran görüntüsü: dağlar, göl, yeşil tepeler, güneşli gökyüzü
function screenTex() {
  return getTex('screen', () => {
    const skyTop = rgb('#2f6fb8');
    const skyLow = rgb('#a9d6f2');
    const sun = rgb('#fff1c4');
    const mount = rgb('#5d6f8c');
    const snow = rgb('#eef3f8');
    const lake = rgb('#2f5f8a');
    const grass = rgb('#4f8f3a');
    const grass2 = rgb('#7fb04a');
    return new Pix(256, 144).fill((u, v, c) => {
      mixc(skyLow, skyTop, smooth(0.45, 1, v), c);
      const sd = Math.hypot((u - 0.74) * 1.78, v - 0.8);
      mixc(c, sun, clamp01(1 - sd / 0.22) * 0.8, c);
      if (sd < 0.05) mixc(c, [1, 1, 0.95], 1, c);
      const ridge = 0.45 + 0.22 * fbm(u * 3, 0.5, 3, 2, 4, 61) + 0.08 * Math.sin(u * 7);
      if (v < ridge) {
        mixc(mount, mount, 0, c);
        mul(c, 0.85 + 0.3 * fbm(u * 20, v * 10, 20, 10, 3, 62));
        if (v > ridge - 0.07 && ridge > 0.6) mixc(c, snow, 0.85, c);
      }
      if (v < 0.36) {
        mixc(lake, skyLow, 0.25 + 0.25 * vnoise(u * 60, v * 8, 60, 8, 63), c);
      }
      const hill = 0.3 + 0.1 * Math.sin(u * 5 + 1) - 0.12 * u;
      if (v < hill) mixc(grass2, grass, smooth(0, hill, hill - v) + 0.2 * fbm(u * 16, v * 8, 16, 8, 3, 64), c);
    });
  });
}
// Külah: elmas ızgaralı waffle
function waffleTex() {
  const cell = rgb('#d9a35c');
  const ridge = rgb('#b97b38');
  const dark = rgb('#8a5526');
  return getTex('waffle', () => new Pix(128, 128).fill((u, v, c) => {
    const a = u * 10 + v * 5;
    const b = u * 10 - v * 5;
    const fa = Math.abs(fract(a) - 0.5);
    const fb = Math.abs(fract(b) - 0.5);
    const rd = Math.max(smooth(0.36, 0.48, fa), smooth(0.36, 0.48, fb));
    mixc(cell, ridge, rd, c);
    mixc(c, dark, fbm(u * 6, v * 3, 6, 3, 3, 71) * 0.35, c);
  }));
}
// Pandispanya (gözenekli)
function spongeTex() {
  const base = rgb('#efcf88');
  const pore = rgb('#c79c55');
  return getTex('sponge', () => new Pix(64, 64).fill((u, v, c) => {
    const n = vnoise(u * 20, v * 20, 20, 20, 81);
    mixc(base, pore, smooth(0.35, 0.15, n) * 0.9, c);
    mul(c, 0.94 + 0.12 * vnoise(u * 64, v * 64, 64, 64, 82));
  }));
}
// Fırın kabuğu (simit, ekmek): altın kahve, kızarmış lekeler
function crustTex() {
  const a = rgb('#e2ad66');
  const b = rgb('#a9672d');
  return getTex('crust', () => new Pix(128, 128).fill((u, v, c) => {
    mixc(a, b, fbm(u * 8, v * 8, 8, 8, 4, 91), c);
    if (hash(Math.floor(u * 128), Math.floor(v * 128), 92) > 0.97) mul(c, 0.8);
  }));
}
// Hamburger ekmeği üstü: kenarda açık, tepede koyu ve parlak kızarmış (lathe v: kenardan tepeye)
function bunTex() {
  const rim = rgb('#e8b977');
  const top = rgb('#b4672a');
  return getTex('bun', () => new Pix(64, 128).fill((u, v, c) => {
    mixc(rim, top, smooth(0.1, 0.75, v), c);
    mul(c, 0.92 + 0.16 * fbm(u * 8, v * 8, 8, 8, 3, 93));
  }));
}
// Köfte: kızarmış et
function pattyTex() {
  const a = rgb('#6e4026');
  const b = rgb('#3b2214');
  const fat = rgb('#a77b57');
  return getTex('patty', () => new Pix(128, 128).fill((u, v, c) => {
    mixc(a, b, fbm(u * 12, v * 12, 12, 12, 4, 101), c);
    const s = hash(Math.floor(u * 128), Math.floor(v * 128), 102);
    if (s > 0.95) mixc(c, fat, 0.5, c);
    if (s < 0.05) mul(c, 0.6);
  }));
}
// Ay çekirdeği: siyah üstünde boyuna beyaz çizgiler (u çevre, v boy)
function seedTex() {
  const dark = rgb('#1c1d20');
  const light = rgb('#dad7cd');
  const grey = rgb('#6b6d70');
  return getTex('seed', () => new Pix(64, 128).fill((u, v, c) => {
    const s = fract(u * 8 + 0.04 * (vnoise(u * 8, v * 6, 8, 6, 111) - 0.5));
    const st = 1 - smooth(0.1, 0.2, Math.abs(s - 0.5));
    mixc(dark, light, st, c);
    mixc(c, grey, (1 - st) * 0.25 * vnoise(u * 32, v * 16, 32, 16, 112), c);
  }));
}
// Fırçalanmış çelik (çizgiler v boyunca)
function brushedTex() {
  return getTex('brushed', () => new Pix(64, 256).fill((u, v, c) => {
    const n = fbm(u * 64, v * 2, 64, 2, 3, 121);
    const k = 0.86 + 0.14 * n;
    c[0] = c[1] = c[2] = k;
  }));
}
// Patates kabuğu
function potatoTex() {
  const a = rgb('#cfa46e');
  const b = rgb('#a77c4b');
  return getTex('potato', () => new Pix(64, 64).fill((u, v, c) => {
    mixc(a, b, fbm(u * 6, v * 6, 6, 6, 3, 131), c);
    if (hash(Math.floor(u * 64), Math.floor(v * 64), 132) > 0.96) mixc(c, rgb('#6e4f30'), 0.6, c);
  }));
}
// Havuç: turuncu, ince enine halkalar (lathe v boyunca)
function carrotTex() {
  const a = rgb('#ee7a22');
  const b = rgb('#c85a12');
  return getTex('carrot', () => new Pix(32, 128).fill((u, v, c) => {
    mixc(a, b, 0.25 * vnoise(u * 8, v * 64, 8, 64, 141), c);
    const k = v * 36;
    if (hash(Math.floor(k), 0, 142) > 0.55 && Math.abs(fract(k) - 0.5) < 0.12) mixc(c, b, 0.7, c);
  }));
}
// Boya kutusu etiketi (u çevre, v yükseklik)
function canLabelTex() {
  return getTex('canlabel', () => {
    const p = new Pix(256, 64).fill((u, v, c) => mixc([0.95, 0.95, 0.93], [0.9, 0.9, 0.88], vnoise(u * 32, v * 8, 32, 8, 151), c));
    const blue = rgb('#1f4f9e');
    p.rect(0, 0.3, 1, 0.68, blue, 1);
    p.rect(0, 0.72, 1, 0.76, rgb('#c8382e'), 1);
    for (let k = 0; k < 4; k++) {
      const u = 0.1 + k * 0.25;
      p.ellipse(u, 0.49, 0.05, 0.12, rgb('#f2f2f0'), 1);
      p.ellipse(u, 0.49, 0.035, 0.085, rgb(['#d24b3a', '#e9c341', '#3f8f4a', '#1f4f9e'][k]), 1);
    }
    for (let k = 0; k < 6; k++) p.rect(0.05 + k * 0.17, 0.12, 0.13 + k * 0.17, 0.17, rgb('#55595f'), 0.8);
    return p;
  });
}
// İnce dokuma kumaş (nötr, renk malzemeden gelir)
function linenTex() {
  return getTex('linen', () => new Pix(64, 64).fill((u, v, c) => {
    const x = Math.floor(u * 64);
    const y = Math.floor(v * 64);
    const k = 0.88 + 0.08 * ((x + y) % 2) + 0.06 * hash(x >> 1, y, 161) + 0.05 * vnoise(u * 8, v * 8, 8, 8, 162);
    c[0] = c[1] = c[2] = k;
  }));
}
// Toprak saksı
function terracottaTex() {
  const a = rgb('#c06b45');
  const b = rgb('#a5583a');
  return getTex('terracotta', () => new Pix(64, 64).fill((u, v, c) => {
    mixc(a, b, fbm(u * 6, v * 6, 6, 6, 3, 171), c);
    if (hash(Math.floor(u * 64), Math.floor(v * 64), 172) > 0.97) mixc(c, rgb('#e2b08c'), 0.4, c);
  }));
}
function soilTex() {
  const a = rgb('#4a3322');
  const b = rgb('#2c1e14');
  return getTex('soil', () => new Pix(64, 64).fill((u, v, c) => {
    mixc(a, b, vnoise(u * 32, v * 32, 32, 32, 181), c);
    if (hash(Math.floor(u * 64), Math.floor(v * 64), 182) > 0.93) mixc(c, rgb('#8a6a4a'), 0.6, c);
  }));
}
// Kaya
function rockTex() {
  const a = rgb('#8d8a84');
  const b = rgb('#55524e');
  return getTex('rock', () => new Pix(64, 64).fill((u, v, c) => {
    mixc(a, b, fbm(u * 8, v * 8, 8, 8, 4, 191), c);
    if (hash(Math.floor(u * 64), Math.floor(v * 64), 192) > 0.95) mul(c, 1.25);
  }));
}
// Çilek: kırmızı, sarı çekirdekler
function strawberryTex() {
  return getTex('strawberry', () => {
    const p = new Pix(64, 64).fill((u, v, c) => mixc(rgb('#c4202c'), rgb('#e0414a'), smooth(0.2, 0.9, v) * 0.6, c));
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 10; i++) {
        const u = (i + (j % 2) * 0.5) / 10;
        const v = (j + 0.5) / 8;
        p.ellipse(u, v, 0.016, 0.024, rgb('#8e1420'), 0.7);
        p.ellipse(u, v + 0.005, 0.009, 0.013, rgb('#e9c45a'), 1);
      }
    }
    return p;
  });
}
// Marul: açık damarlı yeşil
function lettuceTex() {
  return getTex('lettuce', () => new Pix(64, 64).fill((u, v, c) => {
    mixc(rgb('#86b84a'), rgb('#5f9a35'), fbm(u * 4, v * 4, 4, 4, 3, 201), c);
    const vein = 1 - smooth(0.02, 0.06, Math.abs(fract(u * 6 + 0.1 * vnoise(u * 6, v * 4, 6, 4, 202)) - 0.5));
    mixc(c, rgb('#d5e8a8'), vein * 0.6, c);
  }));
}
// Domates dilimi (silindir kapağının daire uv'si): dış kabuk, et, çekirdek odaları
function tomatoTex() {
  return getTex('tomato', () => {
    const p = new Pix(64, 64).fill((u, v, c) => {
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      mixc(rgb('#e2453a'), rgb('#c62a26'), smooth(0.8, 0.95, r), c);
    });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      p.ellipse(0.5 + Math.cos(a) * 0.2, 0.5 + Math.sin(a) * 0.2, 0.11, 0.07, rgb('#f07b5e'), 1, a);
      p.ellipse(0.5 + Math.cos(a) * 0.2, 0.5 + Math.sin(a) * 0.2, 0.05, 0.025, rgb('#f1d27a'), 0.9, a);
    }
    return p;
  });
}
// Tarçın çubuğunun ucu: rulo sarmal
function cinnamonEndTex() {
  return getTex('cinnamonend', () => {
    const p = new Pix(64, 64).fill((u, v, c) => mixc(rgb('#a35a2c'), rgb('#7a3f1c'), Math.hypot(u - 0.5, v - 0.5) * 1.5, c));
    let pu = 0.5;
    let pv = 0.5;
    for (let k = 1; k <= 60; k++) {
      const a = k * 0.32;
      const r = 0.02 + (k / 60) * 0.44;
      const nu = 0.5 + Math.cos(a) * r;
      const nv = 0.5 + Math.sin(a) * r;
      p.line(pu, pv, nu, nv, 0.025, rgb('#5a2c12'), 1);
      pu = nu;
      pv = nv;
    }
    return p;
  });
}
// Şeker küpü: kristal parıltısı
function sugarTex() {
  return getTex('sugar', () => new Pix(32, 32).fill((u, v, c) => {
    const k = 0.9 + 0.1 * hash(Math.floor(u * 32), Math.floor(v * 32), 211);
    c[0] = c[1] = c[2] = k;
  }));
}
// Dondurma topları: vanilya (siyah benekler) ve çilek (meyve parçaları)
function vanillaTex() {
  return getTex('vanilla', () => new Pix(64, 64).fill((u, v, c) => {
    mixc(rgb('#f3e7c6'), rgb('#e6d3a6'), vnoise(u * 8, v * 8, 8, 8, 221), c);
    if (hash(Math.floor(u * 64), Math.floor(v * 64), 222) > 0.975) mixc(c, rgb('#2a2018'), 0.8, c);
  }));
}
function strawCreamTex() {
  return getTex('strawcream', () => {
    const p = new Pix(64, 64).fill((u, v, c) => mixc(rgb('#efb3bd'), rgb('#e39aa8'), vnoise(u * 8, v * 8, 8, 8, 231), c));
    const r = rng(232);
    for (let k = 0; k < 26; k++) p.ellipse(r(), r(), 0.025 + r() * 0.02, 0.018 + r() * 0.015, rgb('#b8283c'), 0.85, r() * 3);
    return p;
  });
}

// ======================= Malzemeler =======================
// Bir kere yapılır, bütün eşyalar paylaşır (resimler çizildikten sonra malzemeler ve dokular silinmemeli).
interface MatOpt {
  metal?: number;
  map?: THREE.Texture;
  cc?: number; // cila katmanı (clearcoat): MeshPhysicalMaterial
  ccr?: number;
  glow?: string; // kendi ışığı
  glowK?: number;
  glowMap?: THREE.Texture;
  flat?: boolean; // köşeli yüzler (kristal)
  vc?: boolean; // köşe renkleri
  both?: boolean; // iki yüzlü
  opacity?: number; // < 1: saydam (cam)
}
const MATS = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, rough = 0.5, o: MatOpt = {}) {
  const key = [color, rough, o.metal ?? 0, o.map?.name ?? '', o.cc ?? '', o.ccr ?? '', o.glow ?? '', o.glowK ?? '', o.glowMap?.name ?? '',
    o.flat ? 1 : 0, o.vc ? 1 : 0, o.both ? 1 : 0, o.opacity ?? 1].join('|');
  let m = MATS.get(key);
  if (!m) {
    const p = {
      color,
      roughness: rough,
      metalness: o.metal ?? 0,
      map: o.map ?? null,
      flatShading: !!o.flat,
      vertexColors: !!o.vc,
      side: o.both ? THREE.DoubleSide : THREE.FrontSide,
    };
    m = o.cc !== undefined
      ? new THREE.MeshPhysicalMaterial({ ...p, clearcoat: o.cc, clearcoatRoughness: o.ccr ?? 0.1 })
      : new THREE.MeshStandardMaterial(p);
    if (o.glow) {
      m.emissive.set(o.glow);
      m.emissiveIntensity = o.glowK ?? 1;
      m.emissiveMap = o.glowMap ?? null;
    }
    if (o.opacity !== undefined && o.opacity < 1) {
      m.transparent = true;
      m.opacity = o.opacity;
      m.depthWrite = false;
    }
    MATS.set(key, m);
  }
  return m;
}

// ======================= Geometri yardımcıları =======================
type Obj = THREE.Object3D;
type Mat = THREE.Material | THREE.Material[];
type V3 = [number, number, number];

// Parça ekle: geometri, malzeme, konum ve dönüş (radyan)
function put(g: Obj, geo: THREE.BufferGeometry, m: Mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  g.add(o);
  return o;
}
// Alt grup: birkaç parçayı birlikte taşımak ve döndürmek için
function sub(g: Obj, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const o = new THREE.Group();
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  o.scale.setScalar(s);
  g.add(o);
  return o;
}
const rbox = (w: number, h: number, d: number, r = 0.03, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, r);
const cylGeo = (rt: number, rb: number, h: number, seg = 20, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const ball = (r: number, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
// Yumurta biçimi (x, y, z yarıçapları)
const egg = (rx: number, ry: number, rz: number, w = 14, h = 10) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
// Dönen profil: [yarıçap, y, yarıçap, y, ...] alttan üste
function lathe(pts: number[], seg = 24, phi0 = 0, phiLen = Math.PI * 2) {
  const v: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length; i += 2) v.push(new THREE.Vector2(pts[i], pts[i + 1]));
  return new THREE.LatheGeometry(v, seg, phi0, phiLen);
}
function shape(pts: number[]) {
  const s = new THREE.Shape();
  s.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) s.lineTo(pts[i], pts[i + 1]);
  s.closePath();
  return s;
}
// Yumuşak gölge: açısı 60°'den küçük kırışıklar düzgünleşir (eğim basamakları yuvarlak görünür, köşeler keskin kalır)
function soften(geo: THREE.BufferGeometry, angle = Math.PI / 3) {
  // toCreasedNormals konumları 0.01 hassasiyetle eşler; küçük parçalarda karışmasın diye geçici büyüt
  geo.scale(20, 20, 20);
  const out = toCreasedNormals(geo, angle);
  out.scale(1 / 20, 1 / 20, 1 / 20);
  return out;
}
// Düz şekli kalınlaştır (kalınlık z boyunca, ortada); yuvarlatılmış kenarlı
function extrude(s: THREE.Shape | number[], depth: number, bevel = 0.02, segs = 2, soft = true) {
  const geo = new THREE.ExtrudeGeometry(Array.isArray(s) ? shape(s) : s, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segs,
    curveSegments: 10,
  });
  geo.translate(0, 0, -depth / 2);
  return soft ? soften(geo) : geo;
}

// Dört köşeli düz yüz; uv a(0,0) b(su,0) c(su,sv) d(0,sv)
function quad(a: V3, b: V3, c: V3, d: V3, su = 1, sv = 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, su, 0, su, sv, 0, 0, su, sv, 0, sv], 2));
  geo.computeVertexNormals();
  return geo;
}
// uv'leri ölçekle (doku sıklığı); yalnız [from, to) aralığındaki köşeler
function uvs(geo: THREE.BufferGeometry, su: number, sv: number, from = 0, to = Infinity) {
  const uv = geo.attributes.uv;
  for (let i = from; i < Math.min(to, uv.count); i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}
// Köşe renkleri: her köşeye konumuna göre renk ver (sRGB)
function paint(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number, out: THREE.Color) => void) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), c);
    c.toArray(col, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
// Kutunun üst yarısını daralt (sivrilen ayak)
function taper(geo: THREE.BufferGeometry, k: number) {
  const p = geo.attributes.position;
  geo.computeBoundingBox();
  const y0 = geo.boundingBox!.min.y;
  const h = geo.boundingBox!.max.y - y0 || 1;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - y0) / h;
    const s = 1 + (k - 1) * t;
    p.setX(i, p.getX(i) * s);
    p.setZ(i, p.getZ(i) * s);
  }
  geo.computeVertexNormals();
  return geo;
}
// Eğri boyunca kesiti değişen boru; eğri XY düzleminde, r(t) -> [düzlemdeki yarıçap, z yarıçapı]
function sweep(pts: THREE.Vector2[], r: (t: number) => [number, number], seg = 10, z0 = 0) {
  const n = pts.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ring: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / tl;
    const ny = (b.x - a.x) / tl;
    const t = i / (n - 1);
    const [rn, rz] = r(t);
    const row: number[] = [];
    for (let k = 0; k <= seg; k++) {
      const ang = (k / seg) * Math.PI * 2;
      row.push(pos.length / 3);
      pos.push(pts[i].x + nx * rn * Math.cos(ang), pts[i].y + ny * rn * Math.cos(ang), z0 + rz * Math.sin(ang));
      uv.push(k / seg, t);
    }
    ring.push(row);
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const p0 = ring[i][k];
      const p1 = ring[i][k + 1];
      const p2 = ring[i + 1][k];
      const p3 = ring[i + 1][k + 1];
      idx.push(p0, p1, p2, p1, p3, p2);
    }
  }
  // uç kapakları (ayrı köşelerle, düz gölgeli)
  for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
    const c = pos.length / 3;
    pos.push(pts[i].x, pts[i].y, z0);
    uv.push(0.5, 0.5);
    const first = pos.length / 3;
    for (let k = 0; k <= seg; k++) {
      const q = ring[i][k] * 3;
      pos.push(pos[q], pos[q + 1], pos[q + 2]);
      uv.push(0.5, 0.5);
    }
    for (let k = 0; k < seg; k++) {
      if (dir < 0) idx.push(c, first + k + 1, first + k);
      else idx.push(c, first + k, first + k + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
const UP = new THREE.Vector3(0, 1, 0);
const VIEW = new THREE.Vector3(1, 0.85, 1).normalize();
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();
// Kameraya doğru eğ: üst yüz (+y) kameraya döner (ekran sağı ekseninde döner)
function tilt(o: Obj, a: number) {
  o.quaternion.setFromAxisAngle(SCREEN_RIGHT, a);
  return o;
}
// Yerel eksenleri dünya yönlerine oturt (x, y, z birbirine dik olmalı)
function basis(o: Obj, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3) {
  o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return o;
}
// Kameraya bakan eğik düzlem: yerel x ekran sağı, yerel z (ön yüz) yukarı ve kameraya doğru
function facing(o: Obj, up = 0.78) {
  const N = new THREE.Vector3(0.5, up, 0.5).normalize();
  const X = SCREEN_RIGHT.clone();
  return basis(o, X, new THREE.Vector3().crossVectors(N, X).normalize(), N);
}
// İki nokta arasında silindir çubuk
function rod(g: Obj, a: V3, b: V3, r: number, m: Mat, seg = 8) {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const o = put(g, cylGeo(r, r, d.length(), seg), m, A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
  return o;
}

// Bütün parçaları malzemeye göre birleştir: dönüşler köşelere işlenir. Sonra en uzun kenar 1 birim olur,
// taban y=0'a, orta x=z=0'a gelir.
function bake(src: Obj, name: string): THREE.Group {
  src.updateMatrixWorld(true);
  interface Buf {
    pos: number[];
    nor: number[];
    uv: number[];
    col: number[] | null;
  }
  const bufs = new Map<THREE.Material, Buf>();
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  src.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const P = geo.attributes.position;
    const N = geo.attributes.normal;
    const UV = geo.attributes.uv;
    const CO = geo.attributes.color;
    nm.getNormalMatrix(mesh.matrixWorld);
    const flip = mesh.matrixWorld.determinant() < 0;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = Array.isArray(mesh.material) && geo.groups.length ? geo.groups : [{ start: 0, count: P.count, materialIndex: 0 }];
    for (const gr of groups) {
      const m = list[gr.materialIndex ?? 0] as THREE.MeshStandardMaterial | undefined;
      if (!m) continue;
      let b = bufs.get(m);
      if (!b) bufs.set(m, (b = { pos: [], nor: [], uv: [], col: m.vertexColors ? [] : null }));
      const end = Math.min(P.count, gr.start + gr.count);
      for (let k = gr.start; k + 3 <= end; k += 3) {
        for (const i of flip ? [k, k + 2, k + 1] : [k, k + 1, k + 2]) {
          v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
          b.pos.push(v.x, v.y, v.z);
          v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
          b.nor.push(v.x, v.y, v.z);
          if (UV) b.uv.push(UV.getX(i), UV.getY(i));
          else b.uv.push(0, 0);
          if (b.col) {
            if (CO) b.col.push(CO.getX(i), CO.getY(i), CO.getZ(i));
            else b.col.push(1, 1, 1);
          }
        }
      }
    }
  });
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const b of bufs.values()) {
    for (let i = 0; i < b.pos.length; i += 3) {
      v.fromArray(b.pos, i);
      min.min(v);
      max.max(v);
    }
  }
  const size = max.clone().sub(min);
  const s = 1 / Math.max(size.x, size.y, size.z, 1e-6);
  const cx = (min.x + max.x) / 2;
  const cz = (min.z + max.z) / 2;
  const out = new THREE.Group();
  out.name = `item-${name}`;
  for (const [m, b] of bufs) {
    const pos = new Float32Array(b.pos.length);
    for (let i = 0; i < b.pos.length; i += 3) {
      pos[i] = (b.pos[i] - cx) * s;
      pos[i + 1] = (b.pos[i + 1] - min.y) * s;
      pos[i + 2] = (b.pos[i + 2] - cz) * s;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    if (b.col) geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, m);
    if (m.transparent) mesh.renderOrder = 1;
    out.add(mesh);
  }
  return out;
}

// ======================= Ham maddeler =======================

// Metal: üç parlak fırçalanmış çelik I-kiriş (iki altta, biri üstte); kesik uçlar daha parlak
function iBeam(L: number) {
  const W = 0.34;
  const H = 0.3;
  const tf = 0.06;
  const tw = 0.075;
  return extrude([
    -W / 2, -H / 2, W / 2, -H / 2, W / 2, -H / 2 + tf, tw / 2, -H / 2 + tf, tw / 2, H / 2 - tf, W / 2, H / 2 - tf,
    W / 2, H / 2, -W / 2, H / 2, -W / 2, H / 2 - tf, -tw / 2, H / 2 - tf, -tw / 2, -H / 2 + tf, -W / 2, -H / 2 + tf,
  ], L, 0.01, 2);
}
function metal() {
  const g = new THREE.Group();
  const side = mat('#c2c7cd', 0.34, { metal: 1, map: brushedTex() });
  const cut = mat('#e0e4e8', 0.2, { metal: 1 });
  const geo = iBeam(0.8);
  put(g, geo, [cut, side], -0.19, 0.16, -0.05);
  put(g, geo, [cut, side], 0.19, 0.16, 0.04);
  put(g, geo, [cut, side], 0, 0.48, 0);
  return g;
}

// Odun: üç kütük; uçlarında yıllık halkalar ve çatlaklar, pürüzlü kabuk
function logGeo(r: number, L: number, seed: number) {
  const seg = 20;
  const geo = new THREE.CylinderGeometry(r, r, L, seg, 1);
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  const side = (seg + 1) * 2;
  const rot = seed * 1.7;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(x, z);
    // kabuk pürüzü açıya bağlı: kapak kenarı da aynı oynar, aralık açılmaz
    const k = 1 + 0.045 * Math.sin(a * 5 + seed) + 0.025 * Math.sin(a * 11 + seed * 2);
    p.setX(i, x * k);
    p.setZ(i, z * k);
    if (i < side) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 1.3);
    else {
      // her kütüğün kesiti farklı dursun: kapak uv'sini döndür
      const du = uv.getX(i) - 0.5;
      const dv = uv.getY(i) - 0.5;
      uv.setXY(i, 0.5 + du * Math.cos(rot) - dv * Math.sin(rot), 0.5 + du * Math.sin(rot) + dv * Math.cos(rot));
    }
  }
  geo.computeVertexNormals();
  return geo.rotateX(Math.PI / 2);
}
function wood() {
  const g = new THREE.Group();
  const bark = mat('#ffffff', 0.95, { map: barkTex() });
  const end = mat('#ffffff', 0.8, { map: endGrainTex() });
  const logs: [number, number, number, number, number][] = [
    [-0.205, 0.2, -0.04, 0.2, 1],
    [0.2, 0.19, 0.05, 0.19, 2],
    [0, 0.53, 0.01, 0.185, 3],
  ];
  for (const [x, y, z, r, seed] of logs) put(g, logGeo(r, 0.9 + seed * 0.02, seed), [bark, end, end], x, y, z);
  return g;
}

// Plastik: parlak mavi plastik granül yığını (mercimek biçimli taneler), dibine dökülmüş birkaç tane
function plastic() {
  const g = new THREE.Group();
  const m = mat('#2d6cc0', 0.3, { cc: 1, ccr: 0.08 });
  // Yığın: tepesi yuvarlak koni (dökme tanelerin doğal eğimi)
  const H = 0.4;
  const Rb = 0.42;
  const prof: number[] = [0, 0];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    prof.push(Rb * (1 - t), H * (1 - Math.pow(1 - t, 1.6)));
  }
  put(g, lathe(prof, 20), m);
  const hAt = (r: number) => H * (1 - Math.pow(r / Rb, 1.6));
  const pel = new THREE.SphereGeometry(1, 7, 3).scale(0.07, 0.038, 0.07);
  const r = rng(9);
  const N = 62;
  for (let k = 0; k < N; k++) {
    const rr = Rb * Math.sqrt((k + 0.5) / N);
    const az = k * 2.39996;
    const x = Math.cos(az) * rr;
    const z = Math.sin(az) * rr;
    const slope = (1.6 * H * Math.pow(rr / Rb, 0.6)) / Rb;
    const o = put(g, pel, m, x, hAt(rr) + 0.015, z);
    o.quaternion.setFromUnitVectors(UP, new THREE.Vector3((x / (rr || 1)) * slope, 1, (z / (rr || 1)) * slope).normalize());
    o.rotateX((r() - 0.5) * 0.9);
    o.rotateZ((r() - 0.5) * 0.9);
  }
  for (let k = 0; k < 9; k++) {
    const a = r() * Math.PI * 2;
    const d = 0.44 + r() * 0.07;
    put(g, pel, m, Math.cos(a) * d, 0.03, Math.sin(a) * d, (r() - 0.5) * 0.5, r() * 3, (r() - 0.5) * 0.5);
  }
  return g;
}

// Mineral: koyu, metal parlaklıklı köşeli kristal kümesi (altıgen prizma + sivri uç) kaya üstünde
function mineral() {
  const g = new THREE.Group();
  const rock = mat('#9a948c', 0.95, { map: rockTex(), flat: true });
  const cr = [
    mat('#3a3e46', 0.14, { metal: 0.55, cc: 1, ccr: 0.05, flat: true }),
    mat('#555a63', 0.16, { metal: 0.45, cc: 1, ccr: 0.05, flat: true }),
    mat('#2c2f35', 0.12, { metal: 0.6, cc: 1, ccr: 0.05, flat: true }),
  ];
  const base = new THREE.DodecahedronGeometry(0.42, 1);
  const bp = base.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i);
    const y = bp.getY(i);
    const z = bp.getZ(i);
    const k = 1 + 0.12 * Math.sin(x * 9 + z * 5) * Math.cos(y * 7);
    bp.setXYZ(i, x * k * 1.25, y * k * 0.42, z * k * 1.05);
  }
  base.computeVertexNormals();
  put(g, base, rock, 0, 0.12, 0);
  // [x, z, boy, yarıçap, eğim x, eğim z, renk]
  const list: number[][] = [
    [0, 0, 0.82, 0.14, -0.05, 0.05, 1],
    [-0.21, -0.12, 0.6, 0.11, -0.25, 0.42, 0],
    [0.22, 0.06, 0.55, 0.115, 0.25, -0.45, 2],
    [0.05, 0.22, 0.48, 0.1, 0.5, -0.1, 0],
    [-0.2, 0.18, 0.4, 0.09, 0.45, 0.42, 2],
    [0.18, -0.2, 0.45, 0.095, -0.45, -0.3, 1],
    [-0.04, -0.24, 0.36, 0.08, -0.6, 0.1, 2],
  ];
  for (const [x, z, len, r, tx, tz, mi] of list) {
    const o = sub(g, x, 0.15, z, tx, 0.3 + x * 2, tz);
    put(o, new THREE.CylinderGeometry(r, r * 1.08, len, 6), cr[mi], 0, len / 2, 0);
    put(o, new THREE.ConeGeometry(r, r * 1.7, 6), cr[mi], 0, len + r * 0.85, 0);
  }
  return g;
}

// Tohum: üç ay çekirdeği (siyah, boyuna beyaz çizgili, bir ucu sivri, yassı)
function seedGeo() {
  const geo = new THREE.SphereGeometry(1, 20, 12);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + 1) / 2;
    const taper = 1 - 0.5 * t * t;
    p.setXYZ(i, p.getX(i) * 0.3 * taper, p.getY(i) * 0.5, p.getZ(i) * 0.15 * taper);
  }
  geo.computeVertexNormals();
  // yatır: geniş yüz yukarı, sivri uç -z
  return geo.rotateX(-Math.PI / 2);
}
function seeds() {
  const g = new THREE.Group();
  const m = mat('#ffffff', 0.42, { map: seedTex() });
  const geo = seedGeo();
  const t = tilt(sub(g), 0.45);
  put(t, geo, m, -0.2, 0.15, 0.02, 0, 0.75, 0);
  put(t, geo, m, 0.22, 0.15, -0.05, 0, -0.55, 0);
  put(t, geo, m, 0.02, 0.27, 0.16, 0.15, 0.1, 0.12);
  return g;
}

// Kumaş: karton boruya sarılı ekose yün kumaş topu; ucunda sarılı katlar, önünde açılmış kumaş
function textile() {
  const g = new THREE.Group();
  const R = 0.3;
  const L = 0.9;
  const T = 0.025;
  const cloth = mat('#ffffff', 0.9, { map: plaidTex() });
  const end = mat('#ffffff', 0.9, { map: clothEndTex() });
  const card = mat('#c9a77a', 0.9);
  const hole = mat('#3a2a1c', 1);
  const y = R + T;
  const seg = 36;
  const roll = cylGeo(R, R, L, seg);
  uvs(roll, 3, 1.4, 0, (seg + 1) * 2);
  put(g, roll.rotateX(Math.PI / 2), [cloth, end, end], 0, y, 0);
  put(g, cylGeo(0.07, 0.07, L + 0.04, 16).rotateX(Math.PI / 2), card, 0, y, 0);
  put(g, new THREE.CircleGeometry(0.05, 14), hole, 0, y, L / 2 + 0.021);
  // Açılmış kumaş: rulonun altından sağa (+x) doğru, hafif dalgalı
  const len = 0.62;
  const sheet = new THREE.BoxGeometry(len, T, L - 0.01, 24, 1, 1).translate(len / 2, T / 2, 0);
  const sp = sheet.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setY(i, sp.getY(i) + 0.016 * Math.sin(sp.getX(i) * 13) * smooth(0, 0.2, sp.getX(i)));
  sheet.computeVertexNormals();
  uvs(sheet, 1, 1.4);
  put(g, sheet, cloth, 0.02, 0, 0);
  return g;
}

// Kimyasal: saydam cam erlen; içinde yeşil sıvı, beyaz ölçü çizgileri ve etiket alanı
function chem() {
  const g = new THREE.Group();
  const glass = mat('#eef7fa', 0.04, { cc: 1, ccr: 0.03, opacity: 0.28, both: true });
  const lip = mat('#e3f0f4', 0.05, { cc: 1, ccr: 0.03, opacity: 0.6 });
  const liquid = mat('#4fb848', 0.1, { cc: 1, ccr: 0.05, glow: '#10380f', glowK: 0.6 });
  const surf = mat('#86d46e', 0.08, { glow: '#16420f', glowK: 0.5 });
  const enamel = mat('#f4f4f0', 0.6);
  const rAt = (y: number) => 0.44 + (0.15 - 0.44) * ((y - 0.08) / 0.58);
  const lvl = 0.4;
  put(g, lathe([0, 0.012, 0.4, 0.012, 0.425, 0.04, 0.43, 0.08, rAt(lvl) - 0.012, lvl, 0, lvl], 32), liquid);
  put(g, new THREE.CircleGeometry(rAt(lvl) - 0.013, 32).rotateX(-Math.PI / 2), surf, 0, lvl + 0.001, 0);
  put(g, lathe([0, 0, 0.39, 0, 0.43, 0.035, 0.44, 0.08, 0.15, 0.66, 0.135, 0.7, 0.135, 0.88, 0.16, 0.895, 0.16, 0.925, 0.13, 0.93], 36), glass);
  put(g, new THREE.TorusGeometry(0.15, 0.018, 8, 28).rotateX(Math.PI / 2), lip, 0, 0.91, 0);
  // Ölçü çizgileri ve buzlu etiket (kameraya bakan yüzde)
  for (const [y, w] of [[0.2, 0.09], [0.27, 0.05], [0.34, 0.09], [0.41, 0.05], [0.48, 0.09]] as [number, number][]) {
    const r = rAt(y) + 0.006;
    put(g, lathe([r, y - 0.006, r, y + 0.006], 2, 0.15, w / r), enamel);
  }
  put(g, lathe([rAt(0.52) + 0.005, 0.52, rAt(0.62) + 0.005, 0.62], 4, 0.5, 0.55), enamel);
  return g;
}

// Şeker: cilalı ahşap kâse dolusu şeker küpü; kâseye yaslanmış tarçın çubukları, önde yıldız anason
function sugar() {
  const g = new THREE.Group();
  const bowl = mat('#b88a60', 0.45, { map: woodTex(), cc: 0.5, ccr: 0.25 });
  const sug = mat('#ffffff', 0.62, { map: sugarTex() });
  const heap = mat('#f2f1ec', 0.85, { map: sugarTex() });
  const cin = mat('#b4683a', 0.85, { map: woodTex() });
  const cinEnd = mat('#ffffff', 0.85, { map: cinnamonEndTex() });
  const anise = mat('#6a321a', 0.7);
  const aniseSeed = mat('#9a6a3a', 0.3);
  const bw = lathe([0, 0, 0.2, 0, 0.22, 0.025, 0.25, 0.05, 0.37, 0.12, 0.44, 0.22, 0.47, 0.32, 0.47, 0.345, 0.45, 0.355, 0.42, 0.32, 0.3, 0.18, 0, 0.14], 30);
  uvs(bw, 3, 1);
  put(g, bw, bowl);
  put(g, new THREE.SphereGeometry(0.43, 24, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.3, 1), heap, 0, 0.3, 0);
  const cube = rbox(0.15, 0.15, 0.15, 0.012, 1);
  const r = rng(7);
  const cubes: V3[] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    cubes.push([Math.sin(a) * 0.27, 0.42, Math.cos(a) * 0.27]);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 1;
    cubes.push([Math.sin(a) * 0.1, 0.53, Math.cos(a) * 0.1]);
  }
  cubes.push([0, 0.65, 0]);
  for (const [x, y, z] of cubes) put(g, cube, sug, x, y, z, (r() - 0.5) * 0.5, r() * 1.5, (r() - 0.5) * 0.5);
  put(g, cube, sug, 0.42, 0.075, 0.3, 0, 0.5, 0);
  // Tarçın çubukları: önden kâsenin sol kenarına yaslanır
  rod(g, [-0.02, 0.05, 0.58], [-0.42, 0.52, 0.2], 0.048, [cin, cinEnd, cinEnd], 12);
  rod(g, [0.1, 0.05, 0.56], [-0.28, 0.56, 0.3], 0.045, [cin, cinEnd, cinEnd], 12);
  // Yıldız anason: sekiz kayık biçimli bölme, bazılarında parlak tohum
  const st = sub(g, 0.5, 0.03, -0.12, 0, 0.3, 0);
  for (let k = 0; k < 8; k++) {
    const o = sub(st, 0, 0, 0, 0, (k / 8) * Math.PI * 2, 0);
    put(o, egg(0.03, 0.026, 0.07, 6, 4), anise, 0, 0, 0.065);
    if (k % 2 === 0) put(o, egg(0.014, 0.01, 0.022, 6, 4), aniseSeed, 0, 0.022, 0.06);
  }
  put(st, ball(0.03, 8, 6), anise, 0, 0.02, 0);
  return g;
}

// Cam: ahşap altlıkta dik duran üç saydam cam levha (kenarları camın doğal yeşili) ve hafif yansımalar
function glass() {
  const g = new THREE.Group();
  const face = mat('#cfe9e8', 0.03, { cc: 1, ccr: 0.02, opacity: 0.38 });
  const edge = mat('#5e9988', 0.1, { cc: 1, ccr: 0.04 });
  const shine = mat('#ffffff', 0.1, { opacity: 0.5 });
  const base = mat('#c49a6c', 0.6, { map: woodTex() });
  const felt = mat('#2c2f33', 0.9);
  const p = sub(g, 0, 0, 0, 0, 0.45, 0);
  put(p, rbox(1.05, 0.07, 0.5, 0.012, 1), base, 0.08, 0.035, -0.14);
  put(p, new THREE.BoxGeometry(1.0, 0.02, 0.42), felt, 0.08, 0.08, -0.14);
  const W = 0.86;
  const H = 0.86;
  const T = 0.045;
  const geo = new THREE.BoxGeometry(W, H, T);
  // Arkadan öne: saydam yüzler doğru sırada karışsın; arkadakiler geriye yaslanır
  for (let i = 2; i >= 0; i--) {
    const o = sub(p, i * 0.08, 0.09 + H / 2 - i * 0.01, -i * 0.13, -0.1 - i * 0.03, 0, 0);
    put(o, geo, [edge, edge, edge, edge, face, face]);
    if (i === 0) {
      put(o, new THREE.PlaneGeometry(0.07, 0.62), shine, -0.13, 0.05, T / 2 + 0.002, 0, 0, -0.75);
      put(o, new THREE.PlaneGeometry(0.03, 0.44), shine, -0.01, 0.13, T / 2 + 0.002, 0, 0, -0.75);
    }
  }
  return g;
}

// Elektronik parça: devre kartı (yollu yeşil maske), siyah yongalar ve kalay bacakları, altın kenar dişleri,
// elektrolitik kondansatörler, renk bantlı dirençler, kristal ve LED
function parts() {
  const g = new THREE.Group();
  const board = mat('#ffffff', 0.5, { map: pcbTex(), cc: 0.6, ccr: 0.3 });
  const chip = mat('#1d1f22', 0.5);
  const tin = mat('#cfd3d6', 0.32, { metal: 1 });
  const gold = mat('#e2b55a', 0.25, { metal: 1 });
  const sleeve = mat('#22335a', 0.4, { cc: 0.6, ccr: 0.2 });
  const stripe = mat('#b8c0ca', 0.45);
  const alu = mat('#c6cbd0', 0.3, { metal: 1 });
  const resM = mat('#d6c49c', 0.6);
  const bands = [mat('#7a4a2a', 0.6), mat('#1d1d1d', 0.6), mat('#d64a2a', 0.6), mat('#c9a443', 0.4, { metal: 1 })];
  const led = mat('#d0302a', 0.2, { cc: 1, ccr: 0.05, glow: '#7a1008', glowK: 0.6 });
  const dot = mat('#e8e8e2', 0.6);
  const t = tilt(sub(g), 0.8);
  const b = sub(t, 0, 0, 0, 0, Math.PI / 4, 0);
  put(b, rbox(1.0, 0.045, 0.72, 0.012, 1), board, 0, 0.0225, 0);
  const top = 0.045;
  for (let k = 0; k < 10; k++) put(b, new THREE.BoxGeometry(0.05, 0.006, 0.1), gold, -0.405 + k * 0.09, top + 0.002, 0.3);
  // İşlemci (dört yanda bacak) ve küçük yonga (iki yanda bacak)
  const pin = new THREE.BoxGeometry(0.018, 0.012, 0.05);
  put(b, rbox(0.3, 0.05, 0.3, 0.01, 1), chip, -0.18, top + 0.025, -0.08);
  put(b, cylGeo(0.012, 0.012, 0.004, 10), dot, -0.29, top + 0.051, -0.19);
  for (let k = 0; k < 7; k++) {
    const o = -0.12 + k * 0.04;
    put(b, pin, tin, -0.18 + o, top + 0.006, -0.08 + 0.17);
    put(b, pin, tin, -0.18 + o, top + 0.006, -0.08 - 0.17);
    put(b, pin, tin, -0.18 + 0.17, top + 0.006, -0.08 + o, 0, Math.PI / 2, 0);
    put(b, pin, tin, -0.18 - 0.17, top + 0.006, -0.08 + o, 0, Math.PI / 2, 0);
  }
  put(b, rbox(0.22, 0.045, 0.11, 0.008, 1), chip, 0.25, top + 0.0225, -0.22);
  for (let k = 0; k < 5; k++) {
    put(b, pin, tin, 0.17 + k * 0.04, top + 0.006, -0.22 + 0.075);
    put(b, pin, tin, 0.17 + k * 0.04, top + 0.006, -0.22 - 0.075);
  }
  // Kondansatörler: koyu mavi kılıf, gri eksi şeridi, alüminyum başlık
  for (const [x, z] of [[0.13, 0.14], [0.3, 0.14]]) {
    put(b, cylGeo(0.055, 0.055, 0.16, 20), sleeve, x, top + 0.08, z);
    put(b, new THREE.CylinderGeometry(0.057, 0.057, 0.15, 6, 1, true, 0.3, 0.9), stripe, x, top + 0.08, z);
    put(b, cylGeo(0.05, 0.05, 0.006, 20), alu, x, top + 0.161, z);
  }
  // Dirençler
  for (const [x, z] of [[-0.05, 0.18], [-0.05, 0.08]]) {
    const o = sub(b, x, top + 0.03, z, 0, 0, Math.PI / 2);
    put(o, new THREE.CapsuleGeometry(0.022, 0.07, 3, 10), resM);
    for (let k = 0; k < 4; k++) put(o, cylGeo(0.0235, 0.0235, 0.008, 10), bands[k], 0, -0.03 + k * 0.018, 0);
    rod(b, [x - 0.08, top + 0.03, z], [x + 0.08, top + 0.03, z], 0.005, tin, 4);
  }
  put(b, rbox(0.12, 0.04, 0.045, 0.015, 2), alu, 0.36, top + 0.02, -0.06);
  put(b, ball(0.032, 12, 8), led, -0.38, top + 0.03, 0.17);
  return g;
}

// ======================= Ürünler =======================

// Çivi: kameraya bakan eğik düzlemde gelişigüzel duran beş fırçalanmış çelik çivi
function nail(g: Obj, x: number, y: number, z: number, rz: number) {
  const o = sub(g, x, y, z, 0, 0, rz);
  const m = mat('#b7bdc4', 0.34, { metal: 1, map: brushedTex() });
  const head = mat('#c9ced3', 0.26, { metal: 1 });
  put(o, cylGeo(0.036, 0.036, 0.78, 10), m, 0, 0.0, 0);
  put(o, new THREE.ConeGeometry(0.036, 0.1, 10).rotateX(Math.PI), m, 0, -0.44, 0);
  put(o, cylGeo(0.075, 0.07, 0.022, 20), head, 0, 0.4, 0);
  put(o, new THREE.SphereGeometry(0.075, 20, 3, 0, Math.PI * 2, 0, 0.35).scale(1, 0.5, 1), head, 0, 0.405, 0);
  return o;
}
function nails() {
  const g = new THREE.Group();
  const f = facing(sub(g));
  nail(f, -0.02, 0.0, 0.0, 0.85);
  nail(f, 0.06, -0.04, 0.045, -0.7);
  nail(f, 0.0, 0.08, 0.09, 1.65);
  nail(f, -0.1, -0.06, 0.13, 0.15);
  nail(f, 0.1, 0.06, 0.17, -1.25);
  return g;
}

// Çekiç: cilalı hikori sap, dövme çelik baş, parlak vurma yüzü, ortası yarık kıvrık pençe
function hammer() {
  const g = new THREE.Group();
  const h = new THREE.Group();
  const wood = mat('#e2b885', 0.45, { map: woodTex(), cc: 0.6, ccr: 0.25 });
  const forged = mat('#59606a', 0.3, { metal: 1 });
  const polished = mat('#d2d6da', 0.14, { metal: 1 });
  // Sap: kesiti oval, altı biraz kalın, ortası ince
  const handle = lathe([0, 0, 0.05, 0, 0.064, 0.02, 0.066, 0.08, 0.057, 0.3, 0.05, 0.55, 0.054, 0.76, 0.058, 0.86, 0, 0.86], 18);
  handle.scale(0.78, 1, 1);
  uvs(handle, 2, 1);
  put(h, handle, wood);
  const hy = 0.86;
  // Göz bloğu, boyun ve vurma yüzü (-x)
  put(h, rbox(0.15, 0.2, 0.135, 0.03, 2), forged, 0, hy, 0);
  put(h, cylGeo(0.072, 0.052, 0.16, 22).rotateZ(Math.PI / 2), forged, -0.15, hy, 0);
  put(h, cylGeo(0.08, 0.08, 0.035, 22).rotateZ(Math.PI / 2), forged, -0.245, hy, 0);
  put(h, cylGeo(0.07, 0.08, 0.014, 22).rotateZ(Math.PI / 2), polished, -0.268, hy, 0);
  // Pençe: aşağı kıvrılan, uca doğru incelen iki diş
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(0.05 + 0.3 * t, hy + 0.03 - 0.03 * t - 0.15 * t * t));
  }
  for (const s of [-1, 1]) put(h, sweep(pts, t => [0.075 * (1 - t) + 0.012, 0.026 * (1 - 0.5 * t)], 10, s * 0.034), forged);
  // Sap ekranda sol alttan sağ üste, baş yan yüzüyle kameraya dönük
  const Y = new THREE.Vector3(0.5, 0.68, -0.5).normalize();
  const V = VIEW.clone().add(new THREE.Vector3(0, 0.35, 0)).normalize();
  const X = new THREE.Vector3().crossVectors(Y, V).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  basis(h, X, Y, Z);
  g.add(h);
  return g;
}

// Boya: teneke kova (fırçalanmış metal, kâğıt etiket, tel sap), içinde parlak mavi boya, kenardan akan
// damlalar; kapağı sağ yanına yaslanmış
function paintCan() {
  const g = new THREE.Group();
  const tin = mat('#c9ced3', 0.3, { metal: 1, map: brushedTex() });
  const inner = mat('#aeb4ba', 0.4, { metal: 1, both: true });
  const label = mat('#ffffff', 0.6, { map: canLabelTex() });
  const blue = mat('#1f4f9e', 0.18, { cc: 1, ccr: 0.04 });
  const wire = mat('#9aa1a8', 0.35, { metal: 1 });
  const R = 0.4;
  const H = 0.56;
  put(g, cylGeo(R, R, H, 32, true), tin, 0, H / 2, 0);
  put(g, cylGeo(R - 0.006, R - 0.006, H, 32, true), inner, 0, H / 2, 0);
  put(g, cylGeo(R, R, 0.01, 32), tin, 0, 0.005, 0);
  for (const y of [0.02, H]) put(g, new THREE.TorusGeometry(R, 0.022, 6, 32).rotateX(Math.PI / 2), tin, 0, y, 0);
  put(g, new THREE.TorusGeometry(R, 0.012, 4, 32).rotateX(Math.PI / 2), tin, 0, H - 0.08, 0);
  put(g, cylGeo(R + 0.003, R + 0.003, 0.34, 40, true), label, 0, 0.27, 0);
  put(g, cylGeo(R - 0.012, R - 0.012, 0.02, 32), blue, 0, H - 0.06, 0);
  // Kenardan taşan boya ve damlalar (kameraya bakan yanda)
  put(g, new THREE.TorusGeometry(R + 0.004, 0.03, 6, 18, 2.3).rotateX(Math.PI / 2), blue, 0, H + 0.008, 0, 0, -0.1, 0);
  const drips: [number, number][] = [[0.05, 0.2], [0.42, 0.3], [0.8, 0.14], [1.15, 0.25], [1.5, 0.1], [1.85, 0.18]];
  for (const [a, len] of drips) {
    const ang = a + 0.25;
    put(g, new THREE.CapsuleGeometry(0.03, len, 2, 8), blue, Math.cos(ang) * (R + 0.012), H - len / 2 - 0.01, Math.sin(ang) * (R + 0.012));
  }
  // Tel sap: yanlardaki kulakçıklara takılı, arkaya yatık
  for (const s of [-1, 1]) put(g, rbox(0.03, 0.07, 0.05, 0.01, 1), tin, s * (R + 0.012), H - 0.06, 0);
  const bail = sub(g, 0, H - 0.05, 0, -1.15, 0, 0);
  put(bail, new THREE.TorusGeometry(R + 0.03, 0.01, 4, 24, Math.PI), wire);
  // Kapak: sağ yanda yere dayanıp kovaya yaslanmış (üst yüzü dışarı bakar)
  const Rl = R + 0.03;
  const dir = new THREE.Vector3(0.8, 0, -0.6).normalize();
  const lean = 0.35;
  const nrm = dir.clone().multiplyScalar(Math.cos(lean)).add(new THREE.Vector3(0, Math.sin(lean), 0));
  const off = R + Rl * Math.sin(lean) + 0.03;
  const lid = sub(g, dir.x * off, Rl * Math.cos(lean) + 0.01, dir.z * off);
  lid.quaternion.setFromUnitVectors(UP, nrm);
  put(lid, cylGeo(Rl, Rl, 0.03, 36), tin);
  put(lid, new THREE.TorusGeometry(Rl - 0.06, 0.014, 4, 32).rotateX(Math.PI / 2), tin, 0, 0.016, 0);
  put(lid, cylGeo(Rl - 0.05, Rl - 0.05, 0.004, 32), blue, 0, -0.017, 0);
  return g;
}

// Tuğla: kil dokulu kırmızı tuğla yığını (üstlerinde delikler), her biri biraz farklı tonda
function brick() {
  const g = new THREE.Group();
  const tones = ['#ffffff', '#e9d3c9', '#f6e0d2'].map(c => mat(c, 0.9, { map: brickTex() }));
  const hole = mat('#4a2016', 1);
  const geo = rbox(0.56, 0.17, 0.27, 0.012, 2);
  const holeGeo = cylGeo(0.036, 0.036, 0.01, 14);
  const list: [number, number, number, number, number][] = [
    [0, 0.085, -0.145, 0, 0],
    [0.01, 0.085, 0.145, 0, 1],
    [-0.145, 0.255, 0, Math.PI / 2 + 0.03, 2],
    [0.145, 0.255, 0.01, Math.PI / 2 - 0.02, 0],
    [0, 0.425, 0, 0.04, 1],
  ];
  for (const [x, y, z, ry, mi] of list) {
    const o = sub(g, x, y, z, 0, ry, 0);
    put(o, geo, tones[mi]);
    for (const hx of [-0.16, 0, 0.16]) put(o, holeGeo, hole, hx, 0.082, 0);
  }
  return g;
}

// Sebze: çapraz duran havuç ve pırasa, önlerinde patates
function veggies() {
  const g = new THREE.Group();
  const carrotM = mat('#ffffff', 0.55, { map: carrotTex() });
  const greens = mat('#4f8a32', 0.7);
  const stems = mat('#6c9a3e', 0.7);
  const leekM = mat('#ffffff', 0.5, { vc: true });
  const leekLeaf = mat('#3f6e42', 0.6);
  const leekLeaf2 = mat('#4c7e4a', 0.6);
  const root = mat('#d6c7a2', 0.85);
  const potato = mat('#ffffff', 0.85, { map: potatoTex() });
  // Pırasa: beyaz gövde açık yeşile döner; kökü sol önde, yaprakları sağ arkaya ve yukarı
  const lk = sub(g, -0.32, 0.1, 0.22, 0, 0.98, -Math.PI / 2 + 0.5);
  const white = new THREE.Color('#f2f0e2');
  const pale = new THREE.Color('#b9d58a');
  put(lk, paint(cylGeo(0.082, 0.088, 0.56, 18), (_x, y, _z, c) => c.copy(white).lerp(pale, smooth(0.0, 0.25, y))), leekM, 0, 0.28, 0);
  put(lk, cylGeo(0.07, 0.074, 0.03, 14), root, 0, -0.01, 0);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    rod(lk, [0, -0.02, 0], [Math.cos(a) * 0.05, -0.07, Math.sin(a) * 0.05], 0.006, root, 4);
  }
  for (const [a, b, m] of [[0.25, 0.2, leekLeaf], [-0.2, -0.5, leekLeaf2], [0.0, 0.9, leekLeaf]] as [number, number, THREE.Material][]) {
    const o = sub(lk, 0, 0.52, 0, 0, b, a);
    put(o, egg(0.075, 0.26, 0.025, 12, 8), m, 0, 0.23, 0);
  }
  // Havuç: sivri ucu sağ önde, yaprakları sol arkaya ve yukarı
  const cr = sub(g, 0.36, 0.1, 0.32, 0, -0.53, Math.PI / 2 - 0.45);
  put(cr, lathe([0, 0, 0.035, 0.05, 0.075, 0.2, 0.11, 0.38, 0.13, 0.52, 0.13, 0.58, 0.1, 0.63, 0, 0.645], 22), carrotM);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const tip: V3 = [Math.cos(a) * 0.09, 0.9 + (k % 2) * 0.06, Math.sin(a) * 0.09];
    rod(cr, [Math.cos(a) * 0.02, 0.62, Math.sin(a) * 0.02], tip, 0.008, stems, 4);
    for (let j = 0; j < 3; j++) put(cr, egg(0.035, 0.06, 0.012, 8, 6), greens, tip[0] + (j - 1) * 0.03, tip[1] - j * 0.05, tip[2], 0, a, (j - 1) * 0.6);
  }
  // Patates: önde ortada, pürüzlü
  const pg = egg(0.22, 0.16, 0.17, 18, 12);
  const pp = pg.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i);
    const y = pp.getY(i);
    const z = pp.getZ(i);
    const k = 1 + 0.06 * Math.sin(x * 19) * Math.sin(z * 17 + 1) + 0.04 * Math.sin(y * 23);
    pp.setXYZ(i, x * k, y * k, z * k);
  }
  pg.computeVertexNormals();
  uvs(pg, 2, 1);
  put(g, pg, potato, -0.04, 0.15, 0.46, 0, 0.6, 0.1);
  return g;
}

// Un: ağzı kıvrılmış bez çuval (önünde baskı), içi tepeleme un, una saplanmış metal kepçe; önde başaklar
function sackGeo() {
  const geo = new THREE.BoxGeometry(1, 1, 1, 8, 14, 6);
  // [yükseklik oranı, genişlik] ve [yükseklik oranı, derinlik]
  const W = [0, 0.84, 0.1, 0.92, 0.45, 0.92, 0.8, 0.84, 1, 0.8];
  const D = [0, 0.58, 0.1, 0.66, 0.45, 0.66, 0.8, 0.6, 1, 0.56];
  const at = (tab: number[], t: number) => {
    for (let i = 2; i < tab.length; i += 2) {
      if (t <= tab[i]) return tab[i - 1] + ((tab[i + 1] - tab[i - 1]) * (t - tab[i - 2])) / (tab[i] - tab[i - 2]);
    }
    return tab[tab.length - 1];
  };
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const t = p.getY(i) + 0.5;
    const z = p.getZ(i);
    const u = 2 * x;
    const v = 2 * z;
    const round = 1 - 0.22 * u * u * v * v; // köşeler yuvarlak
    let y = t * 0.82;
    if (t > 0.999) y += 0.16 * (1 - u * u) * (1 - v * v); // tepeleme un
    // kırışıklar
    const wr = 1 + 0.025 * Math.sin(t * 17 + u * 3) * (1 - Math.abs(u) * 0.5);
    p.setXYZ(i, x * at(W, t) * round * wr, y, z * at(D, t) * round * wr);
  }
  // Yumuşak normaller: aynı konumdaki köşeler (yüz kenarları) ortak normal alsın
  const tmp = geo.clone();
  tmp.deleteAttribute('uv');
  tmp.deleteAttribute('normal');
  const merged = mergeVertices(tmp);
  merged.computeVertexNormals();
  const key = (i: number, a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => `${a.getX(i).toFixed(4)},${a.getY(i).toFixed(4)},${a.getZ(i).toFixed(4)}`;
  const nrm = new Map<string, number[]>();
  const mp = merged.attributes.position;
  const mn = merged.attributes.normal;
  for (let i = 0; i < mp.count; i++) nrm.set(key(i, mp), [mn.getX(i), mn.getY(i), mn.getZ(i)]);
  const n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const q = nrm.get(key(i, p));
    if (q) n.setXYZ(i, q[0], q[1], q[2]);
  }
  // Ön yüz (grup 4) baskılı dokuyu 0..1 kullanır; öteki yüzlerin örgüsü 3 kat sık
  const front = new Set<number>();
  const g4 = geo.groups[4];
  for (let k = g4.start; k < g4.start + g4.count; k++) front.add(geo.index!.getX(k));
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) if (!front.has(i)) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 3);
  return geo;
}
function wheatEar(g: Obj, a: V3, b: V3, stalk: THREE.Material, grain: THREE.Material) {
  rod(g, a, b, 0.012, stalk, 5);
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const ear = sub(g, b[0], b[1], b[2]);
  ear.quaternion.setFromUnitVectors(UP, d.clone().normalize());
  for (let k = 0; k < 7; k++) {
    for (const s of [-1, 1]) put(ear, egg(0.022, 0.04, 0.018, 6, 4), grain, s * 0.02, 0.02 + k * 0.032, 0, 0, 0, -s * 0.45);
  }
  put(ear, egg(0.018, 0.035, 0.015, 8, 6), grain, 0, 0.25, 0);
}
function flour() {
  const g = new THREE.Group();
  const burlap = mat('#ffffff', 0.95, { map: burlapTex() });
  const print = mat('#ffffff', 0.95, { map: sackPrintTex() });
  const powder = mat('#f7f5f0', 0.95);
  const steel = mat('#c7ccd1', 0.3, { metal: 1 });
  const stalk = mat('#cfa553', 0.6);
  const grain = mat('#d9a748', 0.55);
  const s = sub(g, 0, 0, 0, 0, 0.5, 0);
  put(s, sackGeo(), [burlap, burlap, powder, burlap, print, burlap]);
  const rim = new THREE.TorusGeometry(1, 0.13, 6, 32).rotateX(Math.PI / 2).scale(0.405, 0.4, 0.285);
  uvs(rim, 6, 1);
  put(s, rim, burlap, 0, 0.82, 0);
  // Una saplanmış kepçe
  const sc = sub(s, -0.1, 0.9, -0.05, 0.35, 0, 0.5);
  put(sc, new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, 0.8, 1.2), steel, 0, 0, 0);
  rod(sc, [0, 0.0, -0.1], [0, 0.32, -0.26], 0.018, steel, 8);
  // Önde iki başak
  wheatEar(g, [-0.22, 0.0, 0.48], [-0.38, 0.5, 0.26], stalk, grain);
  wheatEar(g, [-0.12, 0.0, 0.5], [-0.2, 0.52, 0.32], stalk, grain);
  return g;
}

// Sandalye: cilalı kayın ahşap sandalye; sivrilen ayaklar, kavisli sırt tahtası, dikey çıtalar, ara bağlar
function chair() {
  const g = new THREE.Group();
  const c = sub(g, 0, 0, 0, 0, 0.55, 0);
  const wood = mat('#d9a873', 0.5, { map: woodTex(), cc: 0.35, ccr: 0.3 });
  const legGeo = taper(new THREE.BoxGeometry(0.055, 0.45, 0.055), 1.25);
  for (const [x, z] of [[-0.2, 0.2], [0.2, 0.2]]) put(c, legGeo, wood, x, 0.225, z);
  // Arka ayaklar sırta kadar uzanır ve biraz geriye yatar
  const back = new THREE.BoxGeometry(0.055, 1.0, 0.055);
  for (const x of [-0.2, 0.2]) put(c, back, wood, x, 0.5, -0.215, -0.06, 0, 0);
  put(c, rbox(0.5, 0.045, 0.48, 0.015, 2), wood, 0, 0.475, 0);
  for (const z of [-0.2, 0.2]) put(c, new THREE.BoxGeometry(0.4, 0.05, 0.03), wood, 0, 0.43, z);
  for (const x of [-0.2, 0.2]) put(c, new THREE.BoxGeometry(0.03, 0.05, 0.38), wood, x, 0.43, 0);
  // Sırt: kavisli üst tahta ve üç dikey çıta
  const rail = rbox(0.48, 0.1, 0.03, 0.012, 2);
  const rp = rail.attributes.position;
  for (let i = 0; i < rp.count; i++) rp.setZ(i, rp.getZ(i) - 0.25 * rp.getX(i) * rp.getX(i));
  rail.computeVertexNormals();
  put(c, rail, wood, 0, 0.93, -0.25, -0.06, 0, 0);
  for (const x of [-0.09, 0, 0.09]) put(c, rbox(0.045, 0.34, 0.018, 0.008, 1), wood, x, 0.7, -0.235, -0.06, 0, 0);
  // Ayak araları
  for (const x of [-0.2, 0.2]) rod(c, [x, 0.14, -0.2], [x, 0.14, 0.2], 0.014, wood, 6);
  rod(c, [-0.2, 0.1, 0.2], [0.2, 0.1, 0.2], 0.014, wood, 6);
  return g;
}

// Koltuk: soluk mavi kumaş kanepe; tombul minderler, kolçaklar, hardal ve krem kırlent, ceviz ayaklar
function sofa() {
  const g = new THREE.Group();
  const s = sub(g, 0, 0, 0, 0, 0.45, 0);
  const fab = mat('#5b7089', 0.95, { map: linenTex() });
  const fabL = mat('#677d97', 0.95, { map: linenTex() });
  const mustard = mat('#b98c3a', 0.95, { map: linenTex() });
  const cream = mat('#ddd5c4', 0.95, { map: linenTex() });
  const walnut = mat('#6a4630', 0.5, { map: woodTex(), cc: 0.4, ccr: 0.3 });
  put(s, rbox(1.2, 0.18, 0.62, 0.04, 1), fab, 0, 0.21, 0);
  for (const x of [-0.25, 0.25]) put(s, rbox(0.5, 0.13, 0.52, 0.055, 2), fabL, x, 0.36, 0.04);
  put(s, rbox(1.2, 0.44, 0.14, 0.05, 1), fab, 0, 0.42, -0.24);
  for (const x of [-0.25, 0.25]) put(s, rbox(0.5, 0.34, 0.15, 0.065, 2), fabL, x, 0.55, -0.12, -0.14, 0, 0);
  for (const x of [-0.56, 0.56]) put(s, rbox(0.13, 0.42, 0.62, 0.05, 2), fab, x, 0.33, 0);
  put(s, rbox(0.28, 0.26, 0.08, 0.035, 2), mustard, -0.33, 0.55, -0.02, -0.25, 0.25, 0.1);
  put(s, rbox(0.26, 0.24, 0.08, 0.035, 2), cream, 0.36, 0.54, -0.03, -0.25, -0.3, -0.12);
  const leg = taper(new THREE.CylinderGeometry(0.026, 0.026, 0.13, 10), 1.35);
  for (const [x, z] of [[-0.54, 0.24], [0.54, 0.24], [-0.54, -0.24], [0.54, -0.24]]) put(s, leg, walnut, x, 0.06, z, 0, 0, 0);
  return g;
}

// Simit: pekmezli koyu kızarmış burgulu halka, üstü sık susamlı; kameraya doğru hafif eğik
function simit() {
  const g = new THREE.Group();
  const R = 0.36;
  const geo = new THREE.TorusGeometry(R, 0.135, 12, 60);
  const p = geo.attributes.position;
  const crest = new THREE.Color('#d39350');
  const groove = new THREE.Color('#6e3a14');
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const u = Math.atan2(y, x);
    const cx = Math.cos(u) * R;
    const cy = Math.sin(u) * R;
    const dx = x - cx;
    const dy = y - cy;
    const v = Math.atan2(z, dx * Math.cos(u) + dy * Math.sin(u));
    const bump = Math.cos(2 * v - 11 * u);
    const k = 1 + 0.09 * bump;
    p.setXYZ(i, cx + dx * k, cy + dy * k, z * k);
    c.copy(groove).lerp(crest, (bump + 1) / 2);
    c.toArray(col, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.rotateX(-Math.PI / 2).scale(1, 0.8, 1);
  geo.computeVertexNormals();
  uvs(geo, 6, 1);
  const t = tilt(sub(g), 0.75);
  put(t, geo, mat('#ffffff', 0.55, { vc: true, map: crustTex(), cc: 0.25, ccr: 0.4 }), 0, 0, 0);
  // Susamlar: üst yüzdeki köşelerden rastgele seçilir
  const seed = new THREE.OctahedronGeometry(1, 0).scale(0.022, 0.007, 0.012);
  const sesame = mat('#efdcb0', 0.5);
  const n = geo.attributes.normal;
  const r = rng(3);
  const used = new Set<number>();
  for (let tries = 0; used.size < 95 && tries < 5000; tries++) {
    const i = Math.floor(r() * p.count);
    if (used.has(i) || n.getY(i) < 0.15) continue;
    used.add(i);
    const o = put(t, seed, sesame, p.getX(i) + n.getX(i) * 0.004, p.getY(i) + n.getY(i) * 0.004, p.getZ(i) + n.getZ(i) * 0.004);
    o.quaternion.setFromUnitVectors(UP, new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)));
    o.rotateY(r() * Math.PI);
  }
  return g;
}

// Pasta: porselen tabakta pembe kremalı çilekli pasta; bir dilimi kesik (pandispanya, krema ve reçel katları),
// üstte krema güller ve taze çilekler
function strawberry(g: Obj, x: number, y: number, z: number, rx: number, rz: number, s = 1) {
  const o = sub(g, x, y, z, rx, 0, rz, s);
  const red = mat('#ffffff', 0.3, { map: strawberryTex(), cc: 0.8, ccr: 0.15 });
  const leaf = mat('#4f7f2e', 0.6);
  const body = lathe([0, 0, 0.03, 0.012, 0.055, 0.04, 0.068, 0.08, 0.07, 0.11, 0.058, 0.135, 0.03, 0.15, 0, 0.152], 12);
  uvs(body, 3, 1);
  put(o, body, red);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    put(o, egg(0.016, 0.004, 0.04, 5, 3), leaf, Math.sin(a) * 0.03, 0.152, Math.cos(a) * 0.03, 0, a, 0);
  }
}
function cake() {
  const g = new THREE.Group();
  const plate = mat('#f4f4f2', 0.2, { cc: 1, ccr: 0.05 });
  const icing = mat('#e6a6b2', 0.6);
  const sponge = mat('#ffffff', 0.85, { map: spongeTex(), both: true });
  const cream = mat('#fbf5ea', 0.7, { both: true });
  const jam = mat('#a51f36', 0.3, { cc: 0.8, ccr: 0.1, both: true });
  const icingCut = mat('#e6a6b2', 0.6, { both: true });
  const whip = mat('#fbf6ee', 0.65);
  const R = 0.42;
  const H = 0.42;
  const y0 = 0.05;
  put(g, lathe([0, 0, 0.36, 0, 0.4, 0.012, 0.52, 0.04, 0.53, 0.05, 0.5, 0.045, 0.4, 0.03, 0, 0.03], 44), plate);
  // Kesik dilim: 20° ile 100° arası (kameraya bakan yan) boş
  const a1 = THREE.MathUtils.degToRad(20);
  const a2 = THREE.MathUtils.degToRad(100);
  put(g, new THREE.CylinderGeometry(R, R, H, 44, 1, false, a2, Math.PI * 2 - (a2 - a1)), [icing, icing, icing], 0, y0 + H / 2, 0);
  const layers: [number, number, THREE.Material][] = [
    [0, 0.13, sponge], [0.13, 0.16, cream], [0.16, 0.185, jam], [0.185, 0.3, sponge], [0.3, 0.33, cream], [0.33, 0.35, jam], [0.35, H, icingCut],
  ];
  for (const a of [a1, a2]) {
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const ri = R - 0.022;
    for (const [ya, yb, m] of layers) {
      put(g, quad([0, y0 + ya, 0], [dx * ri, y0 + ya, dz * ri], [dx * ri, y0 + yb, dz * ri], [0, y0 + yb, 0], 3, (yb - ya) * 7), m);
    }
    put(g, quad([dx * ri, y0, dz * ri], [dx * R, y0, dz * R], [dx * R, y0 + H, dz * R], [dx * ri, y0 + H, dz * ri]), icingCut);
  }
  // Üstte krema gülleri ve çilekler (kesik dilimin dışında)
  const top = y0 + H;
  const span = Math.PI * 2 - (a2 - a1) - 0.5;
  for (let k = 0; k < 9; k++) {
    const a = a2 + 0.25 + (k / 8) * span;
    const x = Math.sin(a) * 0.335;
    const z = Math.cos(a) * 0.335;
    const rose = new THREE.ConeGeometry(0.055, 0.08, 10, 2);
    const rp = rose.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const ang = Math.atan2(rp.getZ(i), rp.getX(i));
      const kk = 1 + 0.18 * Math.cos(ang * 5 + rp.getY(i) * 40);
      rp.setX(i, rp.getX(i) * kk);
      rp.setZ(i, rp.getZ(i) * kk);
    }
    rose.computeVertexNormals();
    put(g, ball(0.055, 10, 5).scale(1, 0.7, 1), whip, x, top + 0.025, z);
    put(g, rose, whip, x, top + 0.075, z);
  }
  strawberry(g, -0.12, top, -0.08, 0.3, 0.2);
  strawberry(g, 0.02, top, -0.2, -0.2, -0.3);
  strawberry(g, -0.22, top, 0.1, 0.25, 0.5, 0.9);
  strawberry(g, 0.1, top + 0.08, -0.32, -0.3, 0, 0.85);
  return g;
}

// Tişört: kameraya doğru eğik duran pamuklu tişört (soluk lacivert); ribanalı yaka, kol ve etek dikişleri, cep
function shirt() {
  const g = new THREE.Group();
  const cotton = mat('#4d6d97', 0.95, { map: linenTex() });
  const rib = mat('#405d85', 0.95, { map: linenTex() });
  const stitch = mat('#3a5579', 0.95);
  const s = new THREE.Group();
  const pts: number[] = [-0.31, -0.45, 0.31, -0.45, 0.305, 0.1, 0.33, 0.12, 0.44, 0.01, 0.57, 0.18, 0.38, 0.37, 0.3, 0.41];
  // yaka oyuğu: merkezi (0, 0.48), yarıçapı 0.13 olan yay
  for (let k = 0; k <= 8; k++) {
    const a = THREE.MathUtils.degToRad(338 - (k / 8) * 136);
    pts.push(Math.cos(a) * 0.13, 0.48 + Math.sin(a) * 0.13);
  }
  pts.push(-0.3, 0.41, -0.38, 0.37, -0.57, 0.18, -0.44, 0.01, -0.33, 0.12, -0.305, 0.1);
  const D = 0.04;
  const B = 0.03;
  const body = extrude(pts, D, B, 3);
  uvs(body, 5, 5);
  put(s, body, cotton);
  const front = D / 2 + B;
  // Ribanalı yaka
  put(s, new THREE.TorusGeometry(0.135, 0.022, 8, 24, THREE.MathUtils.degToRad(140)).rotateZ(THREE.MathUtils.degToRad(200)), rib, 0, 0.48, front - 0.008);
  // Kol ağızları ve etek dikişi
  for (const sx of [-1, 1]) {
    const a = new THREE.Vector2(sx * 0.565, 0.18);
    const b = new THREE.Vector2(sx * 0.445, 0.015);
    const inw = new THREE.Vector2(-sx * 0.8, 0.6).multiplyScalar(0.06);
    const e = b.clone().sub(a).normalize().multiplyScalar(0.01);
    const p0 = a.clone().add(e).add(inw);
    const p1 = b.clone().sub(e).add(inw);
    const st = new THREE.Vector3(p1.x - p0.x, p1.y - p0.y, 0);
    const o = put(s, new THREE.BoxGeometry(st.length(), 0.006, 0.004), stitch, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2, front + 0.001);
    o.rotation.z = Math.atan2(st.y, st.x);
  }
  put(s, new THREE.BoxGeometry(0.6, 0.006, 0.004), stitch, 0, -0.39, front + 0.001);
  // Göğüs cebi
  put(s, extrude([-0.06, -0.07, 0.06, -0.07, 0.065, 0.07, -0.065, 0.07], 0.008, 0.004, 1), cotton, -0.15, 0.17, front + 0.006);
  // Ön yüz kameraya, yatay kenarı ekran sağına
  facing(s, 0.78);
  g.add(s);
  return g;
}

// Ayakkabı: lacivert süet spor ayakkabı; gri süet burun ve topuk, beyaz deri yan şerit, beyaz bağcık ve taban,
// bal rengi kauçuk dış taban, koyu iç astar. Üst kısım bir "kalıp" yüzeyidir: küre açıları (phi çevre,
// theta tepeden aşağı) ayakkabı biçimine bükülür (topuk yüksek ve dik, burun alçak ve dar, üstü düz).
function lastPt(phi: number, theta: number, k = 1): V3 {
  const cx = -Math.cos(phi) * Math.sin(theta);
  const cz = Math.sin(phi) * Math.sin(theta);
  const cy = Math.cos(theta);
  const sx = Math.sign(cx) * Math.pow(Math.abs(cx), 0.55);
  const sz = Math.sign(cz) * Math.pow(Math.abs(cz), 0.6);
  const sy = Math.pow(Math.max(0, cy), 0.6);
  const w = 0.17 * (1 - 0.38 * smooth(0.2, 1, sx) - 0.14 * smooth(-0.3, -1, sx));
  const h = 0.12 + 0.3 * (1 - smooth(-0.35, 0.95, sx));
  return [sx * 0.5 * (1 + (k - 1) * 0.5), 0.1 + sy * h * k, sz * w * k];
}
// Kalıp yüzeyinden parça: phi aralığı, her phi için theta aralığı; normaller yüzeyden hesaplanır (dikişsiz)
function lastPatch(p0: number, p1: number, t0: (p: number) => number, t1: (p: number) => number, nu: number, nv: number, k = 1) {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const e = 1e-3;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const phi = p0 + ((p1 - p0) * i) / nu;
      const th = t0(phi) + ((t1(phi) - t0(phi)) * j) / nv;
      const P = lastPt(phi, th, k);
      pos.push(...P);
      const tt = Math.max(th, 0.02);
      a.fromArray(lastPt(phi, tt + e, k)).sub(new THREE.Vector3(...lastPt(phi, tt - e, k)));
      b.fromArray(lastPt(phi + e, tt, k)).sub(new THREE.Vector3(...lastPt(phi - e, tt, k)));
      const n = th < 0.02 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3().crossVectors(a, b).normalize();
      nor.push(n.x, n.y, n.z);
      uv.push((i / nu) * 6, (j / nv) * 2);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const q = j * (nu + 1) + i;
      idx.push(q, q + nu + 1, q + 1, q + 1, q + nu + 1, q + nu + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}
// Kalıbın üst çizgisi: verilen x'te üst yüzeyin yüksekliği
function lastTop(x: number) {
  const sx = THREE.MathUtils.clamp(2 * x, -0.999, 0.999);
  const th = Math.asin(Math.pow(Math.abs(sx), 1 / 0.55));
  return lastPt(sx > 0 ? Math.PI : 0, th)[1];
}
// Kalıbın tabandaki yarı genişliği (taban dış çizgisi buna uyar)
function lastHalfW(x: number) {
  const sx = THREE.MathUtils.clamp(2 * x, -1, 1);
  const w = 0.17 * (1 - 0.38 * smooth(0.2, 1, sx) - 0.14 * smooth(-0.3, -1, sx));
  return w * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(sx), 2 / 0.55)), 0.3);
}
function shoes() {
  const g = new THREE.Group();
  const suede = mat('#33415e', 0.95, { map: linenTex() });
  const grey = mat('#7c838c', 0.95, { map: linenTex() });
  const leather = mat('#f1f0ec', 0.45, { cc: 0.3, ccr: 0.3 });
  const sole = mat('#f4f3ef', 0.6);
  const gum = mat('#8c6a48', 0.8);
  const lace = mat('#f6f6f2', 0.7);
  const inside = mat('#2a2a2e', 0.9);
  const tab = mat('#b8332e', 0.6);
  const sh = sub(g, 0, 0, 0, 0, 0.42, 0);
  // Taban: yandan profil kalınlaştırılır, sonra genişliği kalıba uydurulur
  const soleGeo = (pts: number[], d: number, bev: number, extra: number) => {
    const geo = extrude(pts, d, bev, 2, false);
    const p = geo.attributes.position;
    const half = d / 2 + bev;
    for (let i = 0; i < p.count; i++) p.setZ(i, (p.getZ(i) / half) * (lastHalfW(p.getX(i) * 0.96) + extra));
    return soften(geo);
  };
  put(sh, soleGeo([-0.52, 0.025, 0.41, 0.025, 0.49, 0.045, 0.525, 0.09, 0.515, 0.125, -0.52, 0.125, -0.545, 0.07], 0.3, 0.02, 0.035), sole);
  put(sh, soleGeo([-0.5, 0, 0.37, 0, 0.46, 0.015, 0.49, 0.035, -0.52, 0.035], 0.3, 0.01, 0.028), gum);
  // Üst kısım ve süet parçalar (biraz dışarıda)
  put(sh, lastPatch(0, Math.PI * 2, () => 0, () => Math.PI / 2, 36, 12), suede);
  put(sh, lastPatch(Math.PI - 1.25, Math.PI + 1.25, () => 0.62, () => Math.PI / 2, 16, 5, 1.025), grey);
  put(sh, lastPatch(-1.05, 1.05, () => 0.8, () => Math.PI / 2, 12, 4, 1.025), grey);
  // Yan şerit: topuktan buruna doğru alçalan bant (kameraya bakan +z yanında)
  put(sh, lastPatch(0.65, 2.45, p => 0.78 + 0.32 * ((p - 0.65) / 1.8), p => 0.95 + 0.32 * ((p - 0.65) / 1.8), 18, 2, 1.04), leather);
  // Ayak deliği, dolgulu yaka ve dil
  const cy = lastTop(-0.28);
  put(sh, cylGeo(1, 1, 0.02, 22).scale(0.15, 1, 0.095), inside, -0.28, cy + 0.004, 0);
  put(sh, new THREE.TorusGeometry(1, 0.2, 6, 24).rotateX(Math.PI / 2).scale(0.155, 0.12, 0.1), suede, -0.28, cy + 0.008, 0);
  put(sh, rbox(0.12, 0.05, 0.15, 0.02, 2), suede, -0.11, lastTop(-0.11) + 0.03, 0, 0, 0, -0.35);
  // Bağcıklar
  for (const x of [-0.02, 0.06, 0.14, 0.22]) {
    const y = lastTop(x);
    const sl = Math.atan2(lastTop(x + 0.01) - lastTop(x - 0.01), 0.02);
    put(sh, rbox(0.03, 0.02, 0.2, 0.009, 1), lace, x, y + 0.008, 0, 0, 0, sl);
  }
  // Topuk etiketi
  put(sh, rbox(0.05, 0.12, 0.08, 0.015, 1), tab, -0.5, lastTop(-0.45) - 0.04, 0);
  return g;
}

// Fidan: toprak saksıda genç ağaç; ince kavisli gövde, küçük yapraklardan sık taç
function sapling() {
  const g = new THREE.Group();
  const pot = mat('#ffffff', 0.85, { map: terracottaTex() });
  const soil = mat('#ffffff', 1, { map: soilTex() });
  const bark = mat('#8a6a50', 0.9, { map: barkTex() });
  const leaves = ['#4f8a3a', '#5e9a43', '#3f7a32', '#6ea84c'].map(c => mat(c, 0.6, { both: true }));
  const pg = lathe([0, 0, 0.19, 0, 0.21, 0.015, 0.26, 0.34, 0.3, 0.345, 0.31, 0.36, 0.31, 0.44, 0.29, 0.45, 0.27, 0.43, 0.255, 0.4], 28);
  uvs(pg, 3, 1);
  put(g, pg, pot);
  put(g, cylGeo(0.256, 0.256, 0.01, 24), soil, 0, 0.405, 0);
  // Gövde ve dallar
  const trunk: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    trunk.push(new THREE.Vector2(0.03 * Math.sin(t * 3), 0.4 + t * 0.5));
  }
  put(g, sweep(trunk, t => [0.03 - 0.014 * t, 0.03 - 0.014 * t], 8), bark);
  rod(g, [0.02, 0.7, 0], [0.17, 0.85, 0.05], 0.012, bark, 5);
  rod(g, [0.02, 0.76, 0], [-0.15, 0.9, -0.04], 0.011, bark, 5);
  // Yaprak: sivri uçlu elips
  const ls = new THREE.Shape();
  ls.moveTo(0, 0);
  ls.quadraticCurveTo(0.042, 0.05, 0, 0.125);
  ls.quadraticCurveTo(-0.042, 0.05, 0, 0);
  const leafGeo = new THREE.ShapeGeometry(ls, 3);
  const r = rng(13);
  const clusters: [number, number, number, number, number][] = [
    [0.02, 1.0, 0.0, 0.22, 70], [0.18, 0.87, 0.07, 0.15, 34], [-0.16, 0.93, -0.04, 0.15, 34], [0.05, 0.86, 0.17, 0.14, 26],
  ];
  const dirV = new THREE.Vector3();
  for (const [cx, cy, cz, cr, n] of clusters) {
    for (let k = 0; k < n; k++) {
      dirV.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
      const d = cr * (0.55 + 0.45 * Math.cbrt(r()));
      const o = put(g, leafGeo, leaves[k % 4], cx + dirV.x * d, cy + dirV.y * d * 0.8, cz + dirV.z * d);
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirV.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize());
      o.rotateZ(r() * Math.PI * 2);
    }
  }
  return g;
}

// Bahçe cücesi: sırlı seramik heykelcik; kıvrık uçlu kırmızı külah, telli beyaz sakal, mavi ceket,
// kemer ve tokası, çizmeler; yosunlu taş üstünde
function gnome() {
  const g = new THREE.Group();
  const gn = sub(g, 0, 0, 0, 0, 0.45, 0);
  const glaze = (c: string) => mat(c, 0.45, { cc: 0.7, ccr: 0.2 });
  const stone = mat('#8f9a7c', 0.95, { map: rockTex(), flat: true });
  const coat = glaze('#3a5f94');
  const hat = glaze('#b3312b');
  const beard = glaze('#ece6d8');
  const boot = glaze('#3b2a20');
  const skin = glaze('#e6b694');
  const cheek = glaze('#e3a08a');
  const eye = glaze('#1f1a18');
  const belt = glaze('#2d2420');
  const buckle = mat('#c9a24a', 0.3, { metal: 1 });
  const base = new THREE.DodecahedronGeometry(0.3, 1);
  const bp = base.attributes.position;
  for (let i = 0; i < bp.count; i++) bp.setY(i, bp.getY(i) * 0.3);
  base.computeVertexNormals();
  put(gn, base, stone, 0, 0.06, 0);
  for (const sx of [-1, 1]) put(gn, egg(0.08, 0.055, 0.12, 10, 7), boot, sx * 0.08, 0.13, 0.05);
  put(gn, lathe([0, 0.11, 0.19, 0.11, 0.2, 0.14, 0.17, 0.34, 0.13, 0.45, 0, 0.47], 24), coat);
  put(gn, cylGeo(0.183, 0.19, 0.045, 24, true), belt, 0, 0.255, 0);
  put(gn, rbox(0.07, 0.055, 0.025, 0.008, 1), buckle, 0, 0.255, 0.185);
  for (const sx of [-1, 1]) {
    const arm = sub(gn, sx * 0.16, 0.39, 0.03, 0.55, 0, sx * 0.3);
    put(arm, new THREE.CapsuleGeometry(0.048, 0.13, 3, 10), coat, 0, -0.07, 0);
    put(arm, ball(0.045, 10, 8), skin, 0, -0.16, 0.01);
  }
  put(gn, ball(0.12, 16, 10), skin, 0, 0.55, 0.01);
  // Sakal: aşağı sivrilen, telli koni
  const bg = new THREE.ConeGeometry(0.15, 0.3, 28, 2).rotateX(Math.PI);
  const bpp = bg.attributes.position;
  for (let i = 0; i < bpp.count; i++) {
    const a = Math.atan2(bpp.getZ(i), bpp.getX(i));
    const k = 1 + 0.07 * Math.cos(a * 14);
    bpp.setX(i, bpp.getX(i) * k);
    bpp.setZ(i, bpp.getZ(i) * k);
  }
  bg.computeVertexNormals();
  put(gn, bg, beard, 0, 0.4, 0.075);
  for (const sx of [-1, 1]) put(gn, egg(0.055, 0.03, 0.04, 8, 6), beard, sx * 0.048, 0.515, 0.115, 0, 0, sx * 0.3);
  put(gn, ball(0.042, 12, 10), cheek, 0, 0.545, 0.125);
  for (const sx of [-1, 1]) put(gn, ball(0.014, 8, 6), eye, sx * 0.042, 0.585, 0.105);
  // Külah: düz alt gövde, sweep ile sağa kıvrılan uç
  put(gn, new THREE.TorusGeometry(0.135, 0.028, 6, 20).rotateX(Math.PI / 2), hat, 0, 0.625, 0);
  put(gn, cylGeo(0.085, 0.145, 0.2, 22), hat, 0, 0.73, 0);
  const tipPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    tipPts.push(new THREE.Vector2(0.14 * t * t, 0.83 + 0.22 * t - 0.04 * t * t));
  }
  const tip = sub(gn, 0, 0, 0);
  put(tip, sweep(tipPts, t => [0.085 * (1 - t) + 0.004, 0.085 * (1 - t) + 0.004], 14), hat);
  return g;
}

// Dondurma: waffle külah (elmas ızgara), üstte çilekli, altta vanilyalı top; topların altında kepçe izi
// kenarlar ve külaha süzülen damla
function scoopGeo(r: number, seed: number) {
  const geo = ball(r, 22, 14);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    let k = 1 + 0.035 * Math.sin(x * 30 + seed) * Math.sin(z * 27 + y * 9) + 0.025 * Math.sin(a * 9 + y * 20);
    // alt kenarda kepçenin bıraktığı çıkıntılı dudak
    if (y < -r * 0.25) k *= 1 + 0.12 * smooth(-r * 0.25, -r * 0.55, y) * (0.7 + 0.3 * Math.sin(a * 7 + seed));
    p.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return uvs(geo, 3, 2);
}
function icecream() {
  const g = new THREE.Group();
  const waffle = mat('#ffffff', 0.75, { map: waffleTex() });
  const rimM = mat('#c58a46', 0.7, { map: crustTex() });
  const vanilla = mat('#ffffff', 0.55, { map: vanillaTex() });
  const straw = mat('#ffffff', 0.5, { map: strawCreamTex() });
  const CH = 0.62;
  const CR = 0.205;
  put(g, new THREE.ConeGeometry(CR, CH, 32, 1, true).rotateX(Math.PI), waffle, 0, CH / 2, 0);
  put(g, new THREE.TorusGeometry(CR, 0.028, 8, 32).rotateX(Math.PI / 2), rimM, 0, CH, 0);
  put(g, scoopGeo(0.235, 1), vanilla, 0, CH + 0.13, 0);
  put(g, scoopGeo(0.215, 4), straw, 0.01, CH + 0.39, 0.01);
  put(g, new THREE.CapsuleGeometry(0.028, 0.12, 3, 8), vanilla, 0.12, CH - 0.02, 0.15);
  return g;
}

// Hamburger: kızarmış susamlı ekmek, ızgara köfte, eriyen peynir, marul ve domates
function burger() {
  const g = new THREE.Group();
  const bunLow = mat('#ffffff', 0.6, { map: crustTex() });
  const bunTop = mat('#ffffff', 0.45, { map: bunTex(), cc: 0.35, ccr: 0.35 });
  const lettuce = mat('#ffffff', 0.55, { map: lettuceTex() });
  const tomSide = mat('#c62a26', 0.35, { cc: 0.6, ccr: 0.1 });
  const tomCut = mat('#ffffff', 0.35, { map: tomatoTex(), cc: 0.6, ccr: 0.1 });
  const patty = mat('#ffffff', 0.9, { map: pattyTex() });
  const cheese = mat('#f0b03c', 0.4, { cc: 0.4, ccr: 0.2 });
  const sesame = mat('#f1e3c0', 0.5);
  const bl = lathe([0, 0, 0.38, 0, 0.43, 0.025, 0.455, 0.075, 0.445, 0.12, 0.3, 0.135, 0, 0.135], 32);
  uvs(bl, 4, 1);
  put(g, bl, bunLow);
  // Marul: dalgalı halka
  const lt = new THREE.TorusGeometry(0.44, 0.045, 5, 48).rotateX(Math.PI / 2);
  const lp = lt.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const x = lp.getX(i);
    const z = lp.getZ(i);
    const u = Math.atan2(z, x);
    const k = 1 + 0.035 * Math.sin(14 * u + 1);
    lp.setXYZ(i, x * k, lp.getY(i) + 0.025 * Math.sin(14 * u), z * k);
  }
  lt.computeVertexNormals();
  uvs(lt, 6, 1);
  put(g, lt, lettuce, 0, 0.16, 0);
  put(g, cylGeo(0.43, 0.43, 0.04, 32), lettuce, 0, 0.15, 0);
  // Domates dilimleri (kenardan taşar)
  for (const a of [0.1, 0.9, 1.7, 3.4, 4.6]) put(g, cylGeo(0.15, 0.15, 0.045, 20), [tomSide, tomCut, tomCut], Math.sin(a) * 0.31, 0.2, Math.cos(a) * 0.31, 0, a, 0);
  // Köfte: pürüzlü kenar
  const pg = new THREE.CylinderGeometry(0.46, 0.47, 0.13, 36, 2);
  const pp = pg.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i);
    const z = pp.getZ(i);
    const a = Math.atan2(x, z);
    const k = 1 + 0.02 * Math.sin(7 * a) + 0.015 * Math.sin(13 * a + 1);
    pp.setXYZ(i, x * k, pp.getY(i) + 0.006 * Math.sin(a * 23), z * k);
  }
  pg.computeVertexNormals();
  uvs(pg, 4, 1);
  put(g, pg, patty, 0, 0.29, 0);
  // Peynir: kare dilim, köşeleri sarkar (bir köşesi kameraya bakar)
  const cg = new THREE.BoxGeometry(0.76, 0.025, 0.76, 10, 1, 10);
  const cp = cg.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const d = Math.hypot(cp.getX(i), cp.getZ(i));
    if (d > 0.4) cp.setY(i, cp.getY(i) - (d - 0.4) * 1.0);
  }
  cg.computeVertexNormals();
  put(g, cg, cheese, 0, 0.37, 0);
  // Üst ekmek ve susamlar
  put(g, lathe([0, 0, 0.45, 0, 0.47, 0.04, 0.46, 0.11, 0.41, 0.19, 0.32, 0.26, 0.18, 0.31, 0, 0.33], 36), bunTop, 0, 0.385, 0);
  const r = rng(5);
  const seed = new THREE.OctahedronGeometry(1, 0).scale(0.026, 0.011, 0.015);
  for (let k = 0; k < 22; k++) {
    const al = 0.15 + r() * 1.0;
    const ph = r() * Math.PI * 2;
    const nrm = new THREE.Vector3((Math.sin(al) * Math.sin(ph)) / 0.46, Math.cos(al) / 0.33, (Math.sin(al) * Math.cos(ph)) / 0.46).normalize();
    const o = put(g, seed, sesame, 0.46 * Math.sin(al) * Math.sin(ph), 0.385 + 0.33 * Math.cos(al), 0.46 * Math.sin(al) * Math.cos(ph));
    o.quaternion.setFromUnitVectors(UP, nrm);
    o.rotateY(r() * Math.PI);
  }
  return g;
}

// Televizyon: ince çerçeveli düz ekran (camlı, ışıklı manzara görüntüsü), fırçalanmış alüminyum ayak
function tv() {
  const g = new THREE.Group();
  const t = sub(g, 0, 0, 0, 0, 0.45, 0);
  const body = mat('#1b1d21', 0.4);
  const bezel = mat('#0f1012', 0.25, { cc: 0.6, ccr: 0.1 });
  const screen = mat('#101214', 0.12, { map: screenTex(), glow: '#ffffff', glowK: 0.95, glowMap: screenTex(), cc: 1, ccr: 0.04 });
  const alu = mat('#c3c8ce', 0.32, { metal: 1, map: brushedTex() });
  const led = mat('#4cff6a', 0.3, { glow: '#2aff4a', glowK: 0.8 });
  const W = 1.0;
  const H = 0.6;
  const cy = 0.22 + H / 2;
  put(t, rbox(W - 0.04, H - 0.04, 0.06, 0.02, 2), body, 0, cy, -0.02);
  put(t, rbox(W, H, 0.025, 0.008, 2), bezel, 0, cy, 0.01);
  put(t, new THREE.PlaneGeometry(W - 0.03, H - 0.03), screen, 0, cy, 0.0235);
  put(t, ball(0.006, 6, 4), led, 0.44, cy - H / 2 + 0.006, 0.022);
  // Ayak: boyun ve taban plakası
  put(t, rbox(0.1, 0.24, 0.035, 0.012, 2), alu, 0, 0.13, -0.04);
  put(t, rbox(0.46, 0.022, 0.24, 0.011, 2), alu, 0, 0.011, -0.03);
  return g;
}

// Buzdolabı: paslanmaz çelik iki kapılı buzdolabı (üstte dondurucu), çubuk kollar, siyah contalar
function fridge() {
  const g = new THREE.Group();
  const f = sub(g, 0, 0, 0, 0, 0.42, 0);
  const steel = mat('#cfd4d9', 0.34, { metal: 1, map: brushedTex() });
  const sideM = mat('#b9bec4', 0.4, { metal: 1, map: brushedTex() });
  const gasket = mat('#2a2d31', 0.7);
  const bar = mat('#e0e4e8', 0.18, { metal: 1 });
  const black = mat('#18191b', 0.4);
  put(f, rbox(0.62, 1.0, 0.56, 0.03, 2), sideM, 0, 0.53, 0);
  put(f, rbox(0.6, 0.33, 0.05, 0.015, 2), steel, 0, 0.86, 0.275);
  put(f, rbox(0.6, 0.62, 0.05, 0.015, 2), steel, 0, 0.375, 0.275);
  put(f, new THREE.BoxGeometry(0.6, 0.012, 0.04), gasket, 0, 0.69, 0.27);
  // Kollar: uzun çubuk ve iki ayakçık
  for (const [y0, y1] of [[0.73, 0.98], [0.42, 0.66]]) {
    rod(f, [-0.23, y0, 0.335], [-0.23, y1, 0.335], 0.014, bar, 10);
    for (const y of [y0 + 0.02, y1 - 0.02]) put(f, rbox(0.03, 0.03, 0.04, 0.008, 1), bar, -0.23, y, 0.31);
  }
  put(f, rbox(0.1, 0.025, 0.004, 0.004, 1), black, 0.0, 0.995, 0.301);
  put(f, new THREE.BoxGeometry(0.56, 0.05, 0.02), black, 0, 0.035, 0.27);
  return g;
}

const BUILD: Record<ItemId, () => THREE.Object3D> = {
  metal, wood, plastic, mineral, seeds, textile, chem, sugar, glass, parts,
  nails, hammer, paint: paintCan, brick, veggies, flour, chair, sofa, simit, cake, shirt, shoes,
  sapling, gnome, icecream, burger, tv, fridge,
};

// Eşyanın modeli: her çağrıda yeni bir grup (malzemeler ve dokular ortak)
export function makeItem(id: ItemId): THREE.Group {
  return bake(BUILD[id](), id);
}
