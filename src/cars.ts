import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Arabalar kodla çizilir: yandan bakınca gerçek araba silueti (kaput, eğik ön cam, tavan, bagaj), tekerlek
// kemerleri, yuvarlatılmış kenarlar ve yumuşak gölge, direkli koyu camlar, jantlı tekerlekler, tampon, ızgara,
// farlar ve stop lambaları. Her türün üç çoklu çizimi var: boya (her arabanın rengi ayrı), ayrıntılar
// (cam, lastik, tampon...) ve farlar (gece yanar). Ölçüler: boy +z yönünde (ön taraf +z), taban y = 0.

export type CarKind = 'sedan' | 'hatch' | 'suv' | 'taxi' | 'van' | 'pickup' | 'sport' | 'truck' | 'garbage' | 'police' | 'ambulance' | 'fire';
export const CAR_KINDS: CarKind[] = ['sedan', 'hatch', 'suv', 'taxi', 'van', 'pickup', 'sport', 'truck', 'garbage', 'police', 'ambulance', 'fire'];
// Trafikte sıradan arabalar (sık görülenler listede birden fazla)
export const NORMAL_CARS: CarKind[] = ['sedan', 'sedan', 'sedan', 'hatch', 'hatch', 'suv', 'suv', 'taxi', 'van', 'pickup', 'sport', 'truck', 'garbage'];
const PAINTS = ['#c62828', '#1565c0', '#f5f5f5', '#202124', '#9ea4ab', '#2e7d32', '#f9a825', '#6a1b9a', '#00838f', '#e64a19', '#455a64', '#8d6e63', '#ad1457', '#0d47a1', '#cfd8dc'];
const FIXED: Partial<Record<CarKind, string>> = { taxi: '#fbc02d', police: '#f5f5f5', ambulance: '#f5f5f5', fire: '#c62828', garbage: '#2e7d32' };

// Arabanın rengi: bazı türlerin rengi sabit, diğerleri rastgele
export function carPaint(kind: CarKind) {
  return new THREE.Color(FIXED[kind] ?? PAINTS[Math.floor(Math.random() * PAINTS.length)]);
}

type Bag = THREE.BufferGeometry[];
type V2 = [number, number];
interface Builder {
  paint: Bag;
  trim: Bag;
  lights: Bag;
}

// Sabit renkler
const GLASS = ['#131c25', '#4b677e'] as const; // cam: altı koyu, üstü gök yansıması
const TYRE = '#1b1c1f', RIM = '#c4c9d0', HUB = '#5a5f66', DARK = '#2a2d32', GRILLE = '#15171a', CHROME = '#b9bec5';
const HEAD = '#fff6d5', TAIL = '#c62828', TAIL_HI = '#ff5a4d', PLATE = '#eef1f4', LOW = '#c4c4c4';

// Yumuşak gölge: aynı noktada buluşan yüzlerin arasındaki açı küçükse normaller ortalanır, keskin köşeler keskin
// kalır. Yana bakan düz yüzler (x yönü) hep düz kalır; yuvarlatılmış kenarlar onlara yumuşakça bağlanır.
function smooth(geo: THREE.BufferGeometry, crease = 50) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count, tris = n / 3;
  const fn = new Float32Array(n);
  const flat = new Uint8Array(tris);
  const keys: string[] = new Array(n);
  const map = new Map<string, number[]>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    c.sub(b).cross(a.sub(b)).normalize();
    c.toArray(fn, t * 3);
    flat[t] = Math.abs(c.x) > 0.97 ? 1 : 0;
    for (let k = t * 3; k < t * 3 + 3; k++) {
      const key = `${Math.round(pos.getX(k) * 2e4)},${Math.round(pos.getY(k) * 2e4)},${Math.round(pos.getZ(k) * 2e4)}`;
      keys[k] = key;
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
  }
  const cos = Math.cos((crease * Math.PI) / 180);
  const out = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const t = (k / 3) | 0;
    let x = fn[t * 3], y = fn[t * 3 + 1], z = fn[t * 3 + 2];
    if (!flat[t]) {
      let sx = 0, sy = 0, sz = 0;
      for (const u of map.get(keys[k])!) {
        if (x * fn[u * 3] + y * fn[u * 3 + 1] + z * fn[u * 3 + 2] < cos) continue;
        const w = flat[u] ? 50 : 1;
        sx += fn[u * 3] * w;
        sy += fn[u * 3 + 1] * w;
        sz += fn[u * 3 + 2] * w;
      }
      const l = Math.hypot(sx, sy, sz);
      if (l > 0) [x, y, z] = [sx / l, sy / l, sz / l];
    }
    out[k * 3] = x;
    out[k * 3 + 1] = y;
    out[k * 3 + 2] = z;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}

// Renkli parça: köşelere renk yazılır. İkinci renk verilirse parçanın altından üstüne renk geçişi olur.
function colored(g: THREE.BufferGeometry, color: string, top?: string) {
  const geo = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(geo.attributes)) if (name !== 'position') geo.deleteAttribute(name);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  let y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < n; k++) {
    y0 = Math.min(y0, pos.getY(k));
    y1 = Math.max(y1, pos.getY(k));
  }
  const c0 = new THREE.Color(color), c1 = new THREE.Color(top ?? color), c = new THREE.Color();
  const arr = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) c.copy(c0).lerp(c1, top && y1 > y0 ? (pos.getY(k) - y0) / (y1 - y0) : 0).toArray(arr, k * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  smooth(geo);
  return geo;
}
const glass = (g: THREE.BufferGeometry) => colored(g, GLASS[0], GLASS[1]);

// Yandan görünüşü (z: boy, y: yükseklik) verilen parça, genişliği w; kenarları r kadar yuvarlatılır
// (dış çizgi tam verilen noktalardan geçer, yuvarlama içeri doğru)
function profile(points: V2[], w: number, r = 0, seg = 2) {
  const s = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, r > 0
    ? { depth: w - r * 2, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelOffset: -r, bevelSegments: seg, curveSegments: 1 }
    : { depth: w, bevelEnabled: false, curveSegments: 1 });
  // Boy +z'ye, genişlik x'e
  g.rotateY(-Math.PI / 2);
  g.translate(w / 2 - r, 0, 0);
  return g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
// İnce yüzey (şerit, plaka, kapı çizgisi): yüzü verilen yöne bakar; yanlarda w boy (z) boyuncadır
function decal(w: number, h: number, x: number, y: number, z: number, dir: 'x' | '-x' | 'z' | '-z' | 'y') {
  const g = new THREE.PlaneGeometry(w, h);
  if (dir === 'x') g.rotateY(Math.PI / 2);
  else if (dir === '-x') g.rotateY(-Math.PI / 2);
  else if (dir === '-z') g.rotateY(Math.PI);
  else if (dir === 'y') g.rotateX(-Math.PI / 2);
  return g.translate(x, y, z);
}
// İki yana birden şerit (x: gövdenin yarı genişliği)
function sides(bag: Bag, color: string, len: number, h: number, x: number, y: number, z: number, top?: string) {
  for (const k of [-1, 1]) bag.push(colored(decal(len, h, k * (x + 0.0007), y, z, k > 0 ? 'x' : '-x'), color, top));
}
// Üste doğru daralma: y0'da tam genişlik, y1'de (1 - k) katı (yan yüzler düz kalsın diye doğrusal)
function lean(g: THREE.BufferGeometry, y0: number, y1: number, k: number) {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (1 - (k * (p.getY(i) - y0)) / (y1 - y0)));
  return g;
}
// Bir çizgi üstünde verilen yükseklikteki noktanın z'si
const zAt = (p: V2, q: V2, y: number) => p[0] + ((q[0] - p[0]) * (y - p[1])) / (q[1] - p[1]);
// Çizginin dışa bakan dik yönü (dz: +1 öne, -1 arkaya)
function outward(p: V2, q: V2, dz: number): V2 {
  const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
  const n: V2 = [dy / l, -dx / l];
  return n[0] * dz < 0 ? [-n[0], -n[1]] : n;
}
// Çokgenin, çizginin inset kadar içinde kalan kısmı (yan camlar direklere göre kırpılır)
function clip(poly: V2[], p: V2, n: V2, inset: number): V2[] {
  const out: V2[] = [];
  const d = (q: V2) => (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1] + inset;
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const da = d(A), db = d(B);
    if (da <= 0) out.push(A);
    if (da <= 0 !== db <= 0) {
      const t = da / (da - db);
      out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
    }
  }
  return out.filter((q, i) => {
    const o = out[(i + 1) % out.length];
    return Math.hypot(q[0] - o[0], q[1] - o[1]) > 1e-5;
  });
}
// Eğik yüzeyin (ön/arka cam) hemen üstünde cam: p-q çizgisi boyunca y0..y1 arası, dışa (n) bakan tek yüz
function pane(p: V2, q: V2, n: V2, y0: number, y1: number, w: number) {
  const o = 0.0012, h = w / 2;
  const A: V2 = [zAt(p, q, y0) + n[0] * o, y0 + n[1] * o], B: V2 = [zAt(p, q, y1) + n[0] * o, y1 + n[1] * o];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-h, A[1], A[0], h, A[1], A[0], h, B[1], B[0], -h, B[1], B[0]], 3));
  const out = (B[1] - A[1]) * n[0] - (B[0] - A[0]) * n[1] > 0;
  g.setIndex(out ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  return g;
}
// Yan camlar: iki yanda, yan yüzün (x) hemen dışında düz çokgen, dışa bakan tek yüz
function sideGlass(poly: V2[], x: number) {
  return mergeGeometries([-1, 1].map(k => {
    const s = new THREE.Shape(poly.map(([z, y]) => new THREE.Vector2(k > 0 ? -z : z, y)));
    return new THREE.ShapeGeometry(s).rotateY((k * Math.PI) / 2).translate(k * x, 0, 0);
  }))!;
}
// Alt kenara tekerlek kemerleri (yuvarlak oyuk): [aks z, kemer yarıçapı, teker merkezi y]; arkadan öne sıralı
function arches(y: number, list: [number, number, number][], n = 7): V2[] {
  const out: V2[] = [];
  for (const [z, r, c] of [...list].sort((p, q) => p[0] - q[0])) {
    const d = Math.asin(THREE.MathUtils.clamp((c - y) / r, -0.9, 0.9));
    for (let k = 0; k <= n; k++) {
      const t = Math.PI + d - (k / n) * (Math.PI + 2 * d);
      out.push([z + r * Math.cos(t), c + r * Math.sin(t)]);
    }
  }
  return out;
}
// Gövde çizgisinde verilen yükseklikteki ön (s = 1) ya da arka (s = -1) yüzey: z ve eğimi
function surf(top: V2[], y: number, s: number): V2 {
  let best: V2 = [0, 0], bz = -Infinity;
  for (let i = 0; i + 1 < top.length; i++) {
    const [z0, y0] = top[i], [z1, y1] = top[i + 1];
    if (y0 === y1 || (y - y0) * (y - y1) > 0) continue;
    const z = z0 + ((z1 - z0) * (y - y0)) / (y1 - y0);
    if (z * s <= bz) continue;
    bz = z * s;
    best = [z, y1 > y0 ? Math.atan2(z1 - z0, y1 - y0) : Math.atan2(z0 - z1, y0 - y1)];
  }
  return best;
}
// Gövdeye gömülü, yüzeyin eğimine uyan lamba/ızgara (iki yanda ya da x = 0'da tek)
function lamp(bag: Bag, color: string, top: V2[], s: number, y: number, x: number, w: number, h: number, hi?: string) {
  const [z, t] = surf(top, y, s);
  for (const k of x ? [-1, 1] : [0]) bag.push(colored(new THREE.BoxGeometry(w, h, 0.02).translate(0, 0, -s * 0.0075).rotateX(t).translate(k * x, y, z), color, hi));
}

// Tekerlekler: lastik, jant kapağı ve göbek; gövdenin biraz içinde
function wheels(b: Builder, zs: number[], x: number, r: number, tw: number) {
  for (const z of zs) {
    for (const s of [-1, 1]) {
      b.trim.push(colored(new THREE.CylinderGeometry(r, r, tw, 12).rotateZ(Math.PI / 2).translate(s * x, r, z), TYRE));
      b.trim.push(colored(new THREE.CylinderGeometry(r * 0.56, r * 0.64, 0.006, 10).rotateZ(-s * Math.PI / 2).translate(s * (x + tw / 2 - 0.001), r, z), RIM));
      b.trim.push(colored(new THREE.CircleGeometry(r * 0.2, 6).rotateY(s * Math.PI / 2).translate(s * (x + tw / 2 + 0.0026), r, z), HUB));
    }
  }
}
// Kemerin içi koyu (kemerden karşı taraf görünmesin)
function liner(b: Builder, z: number, x: number, y: number, top: number, ra: number) {
  b.trim.push(colored(box(x * 2, top - y, ra * 2, 0, (y + top) / 2, z), DARK));
}
// Yan aynalar (gövde renginde kapak, arkası cam)
function mirrors(b: Builder, z: number, y: number, x: number) {
  for (const k of [-1, 1]) {
    b.paint.push(colored(box(0.012, 0.012, 0.02, k * x, y, z), '#ffffff'));
    b.paint.push(colored(box(0.016, 0.004, 0.008, k * (x - 0.012), y - 0.003, z + 0.003), '#ffffff'));
    b.trim.push(colored(decal(0.009, 0.008, k * x, y, z - 0.0102, '-z'), GLASS[0]));
  }
}

// Kabin (camların olduğu üst kısım): gövdeden dar, üste doğru daralır; ön ve arka cam eğik levha,
// yan camlar direklerle (A, B, C) bölünür
interface Cabin {
  front: [V2, V2]; // ön cam: alt ve üst nokta
  roof: V2[]; // tavan noktaları (önden arkaya)
  back: [V2, V2]; // arka cam: üst ve alt nokta
  w: number; // genişlik
  lean: number; // üste doğru daralma
  windows: V2[]; // yan camların z aralıkları (ön/arka direklerle kırpılır)
  cInset?: number; // arka direk kalınlığı
  rear?: V2 | false; // arka camın yükseklik aralığı (false: arka cam yok)
}
function cabin(b: Builder, c: Cabin) {
  const [a0, a1] = c.front, [c1, c0] = c.back;
  const yb = Math.min(a0[1], c0[1]);
  const yt = Math.max(a1[1], c1[1], ...c.roof.map(p => p[1]));
  // Kabin gövdenin içine doğru dik iner (alt kenarı görünmesin)
  const base = yb - 0.03;
  const L = (g: THREE.BufferGeometry) => lean(g, yb, yt, c.lean);
  b.paint.push(colored(L(profile([[a0[0], base], a0, a1, ...c.roof, c1, c0, [c0[0], base]], c.w, 0.012)), '#ffffff'));
  const nA = outward(a0, a1, 1), nC = outward(c0, c1, -1);
  const yl = yb + 0.006, yh = Math.min(a1[1], c1[1]) - 0.011;
  for (const [z0, z1] of c.windows) {
    const poly = clip(clip([[z0, yl], [z1, yl], [z1, yh], [z0, yh]], a0, nA, 0.015), c0, nC, c.cInset ?? 0.015);
    if (poly.length > 2) b.trim.push(glass(L(sideGlass(poly, c.w / 2 + 0.0012))));
  }
  b.trim.push(glass(L(pane(a0, a1, nA, a0[1] + 0.003, a1[1] - 0.004, c.w - 0.032))));
  if (c.rear !== false) {
    const [r0, r1] = c.rear ?? [c0[1] + 0.004, c1[1] - 0.004];
    b.trim.push(glass(L(pane(c0, c1, nC, r0, r1, c.w - 0.032))));
  }
}

// Binek araç: kemerli gövde, kabin, tekerlekler, tamponlar, plakalar, farlar, stoplar, ızgara, aynalar
interface Car {
  w: number; // gövde genişliği
  y: number; // gövdenin alt kenarı
  wr: number; // teker yarıçapı
  tw: number; // teker genişliği
  axles: number[];
  top: V2[]; // gövde çizgisi: ön alt köşeden üstten dolaşıp arka alt köşeye
  cabin: Cabin;
  bump: [number, number, number, number, string?]; // tampon: ön z, arka z, alt y, üst y (renk)
  head: [number, number, number, number]; // far: y, x, en, boy
  tail: [number, number, number, number] | null; // stop: y, x, en, boy
  grille: [number, number, number]; // ızgara: y, en, boy
  mirror: [number, number, number]; // ayna: z, y, x
}
function car(b: Builder, c: Car) {
  const ra = c.wr + 0.006;
  b.paint.push(colored(profile([...arches(c.y, c.axles.map(z => [z, ra, c.wr])), ...c.top], c.w, 0.008), LOW, '#ffffff'));
  cabin(b, c.cabin);
  const wx = c.w / 2 - c.tw / 2 - 0.003;
  wheels(b, c.axles, wx, c.wr, c.tw);
  for (const z of c.axles) liner(b, z, wx - c.tw / 2 - 0.002, c.y, c.wr + ra - 0.004, ra);
  const [bf, br, by0, by1, bc = DARK] = c.bump;
  for (const [z, s] of [[bf, 1], [br, -1]] as V2[]) {
    b.trim.push(colored(profile([[z - s * 0.03, by0], [z - s * 0.006, by0], [z, by0 + 0.006], [z, by1 - 0.005], [z - s * 0.007, by1], [z - s * 0.03, by1]], c.w + 0.004, 0.005, 1), bc));
    b.trim.push(colored(decal(0.04, 0.011, 0, (by0 + by1) / 2, z + s * 0.0008, s > 0 ? 'z' : '-z'), PLATE));
  }
  lamp(b.lights, HEAD, c.top, 1, ...c.head);
  if (c.tail) lamp(b.trim, TAIL, c.top, -1, ...c.tail, TAIL_HI);
  lamp(b.trim, GRILLE, c.top, 1, c.grille[0], 0, c.grille[1], c.grille[2]);
  mirrors(b, ...c.mirror);
}

const SEDAN: Car = {
  w: 0.19, y: 0.03, wr: 0.038, tw: 0.032, axles: [0.138, -0.136],
  top: [[0.214, 0.03], [0.226, 0.04], [0.231, 0.055], [0.23, 0.069], [0.222, 0.08], [0.2, 0.09], [0.15, 0.097], [0.1, 0.101], [-0.16, 0.104], [-0.2, 0.103], [-0.222, 0.097], [-0.23, 0.083], [-0.23, 0.058], [-0.224, 0.04], [-0.212, 0.03]],
  cabin: { front: [[0.1, 0.101], [0.03, 0.152]], roof: [[0.005, 0.157], [-0.07, 0.158], [-0.098, 0.155]], back: [[-0.114, 0.15], [-0.172, 0.104]], w: 0.164, lean: 0.14, windows: [[-0.013, 1], [-1, -0.026]], cInset: 0.018 },
  bump: [0.234, -0.234, 0.026, 0.05],
  head: [0.072, 0.058, 0.042, 0.013],
  tail: [0.088, 0.062, 0.044, 0.014],
  grille: [0.06, 0.07, 0.014],
  mirror: [0.092, 0.108, 0.102],
};
const HATCH: Car = {
  w: 0.186, y: 0.03, wr: 0.037, tw: 0.032, axles: [0.122, -0.122],
  top: [[0.184, 0.03], [0.194, 0.04], [0.199, 0.056], [0.197, 0.07], [0.188, 0.081], [0.165, 0.09], [0.12, 0.098], [0.08, 0.101], [-0.17, 0.104], [-0.191, 0.101], [-0.198, 0.09], [-0.199, 0.06], [-0.194, 0.04], [-0.183, 0.03]],
  cabin: { front: [[0.085, 0.101], [0.022, 0.155]], roof: [[0, 0.161], [-0.118, 0.163]], back: [[-0.152, 0.158], [-0.193, 0.104]], w: 0.166, lean: 0.13, windows: [[-0.035, 1], [-1, -0.048]], cInset: 0.024 },
  bump: [0.203, -0.203, 0.026, 0.05],
  head: [0.074, 0.058, 0.04, 0.013],
  tail: [0.088, 0.066, 0.034, 0.016],
  grille: [0.062, 0.07, 0.012],
  mirror: [0.08, 0.108, 0.098],
};
const SUV: Car = {
  w: 0.194, y: 0.04, wr: 0.044, tw: 0.038, axles: [0.145, -0.145],
  top: [[0.212, 0.04], [0.222, 0.05], [0.227, 0.068], [0.226, 0.088], [0.218, 0.103], [0.2, 0.111], [0.15, 0.116], [0.085, 0.12], [-0.2, 0.123], [-0.219, 0.12], [-0.226, 0.105], [-0.227, 0.07], [-0.222, 0.05], [-0.21, 0.04]],
  cabin: { front: [[0.09, 0.12], [0.032, 0.172]], roof: [[0.012, 0.177], [-0.17, 0.178]], back: [[-0.197, 0.174], [-0.219, 0.122]], w: 0.176, lean: 0.1, windows: [[-0.03, 1], [-0.113, -0.043], [-1, -0.125]] },
  bump: [0.231, -0.231, 0.034, 0.066],
  head: [0.093, 0.064, 0.044, 0.014],
  tail: [0.102, 0.068, 0.04, 0.016],
  grille: [0.078, 0.09, 0.022],
  mirror: [0.088, 0.128, 0.101],
};
const SPORT: Car = {
  w: 0.198, y: 0.024, wr: 0.036, tw: 0.036, axles: [0.15, -0.142],
  top: [[0.228, 0.024], [0.237, 0.032], [0.242, 0.046], [0.238, 0.059], [0.222, 0.072], [0.19, 0.088], [0.14, 0.096], [0.05, 0.099], [-0.13, 0.1], [-0.18, 0.099], [-0.218, 0.096], [-0.238, 0.088], [-0.242, 0.066], [-0.238, 0.04], [-0.228, 0.024]],
  cabin: { front: [[0.055, 0.099], [-0.03, 0.133]], roof: [[-0.055, 0.137], [-0.09, 0.136]], back: [[-0.11, 0.132], [-0.195, 0.099]], w: 0.16, lean: 0.16, windows: [[-1, 1]], cInset: 0.02 },
  bump: [0.245, -0.245, 0.02, 0.042],
  head: [0.062, 0.062, 0.044, 0.01],
  tail: [0.084, 0.064, 0.05, 0.01],
  grille: [0.05, 0.08, 0.012],
  mirror: [0.045, 0.104, 0.104],
};
const PICKUP: Car = {
  w: 0.198, y: 0.042, wr: 0.044, tw: 0.038, axles: [0.155, -0.15],
  top: [[0.226, 0.042], [0.235, 0.054], [0.239, 0.075], [0.237, 0.095], [0.228, 0.108], [0.205, 0.115], [0.15, 0.119], [0.085, 0.12], [-0.236, 0.117], [-0.239, 0.104], [-0.239, 0.06], [-0.232, 0.042]],
  cabin: { front: [[0.09, 0.12], [0.04, 0.166]], roof: [[0.02, 0.171], [-0.03, 0.172]], back: [[-0.045, 0.168], [-0.052, 0.12]], w: 0.18, lean: 0.08, windows: [[-1, 1]], cInset: 0.014, rear: [0.128, 0.16] },
  bump: [0.243, -0.243, 0.036, 0.066, CHROME],
  head: [0.09, 0.066, 0.046, 0.016],
  tail: null,
  grille: [0.078, 0.09, 0.03],
  mirror: [0.09, 0.132, 0.103],
};
const VAN: Car = {
  w: 0.196, y: 0.034, wr: 0.04, tw: 0.034, axles: [0.165, -0.162],
  top: [[0.235, 0.034], [0.244, 0.044], [0.249, 0.062], [0.248, 0.082], [0.241, 0.096], [0.225, 0.104], [0.19, 0.109], [-0.245, 0.112], [-0.249, 0.1], [-0.249, 0.05], [-0.244, 0.04], [-0.236, 0.034]],
  cabin: { front: [[0.192, 0.109], [0.125, 0.192]], roof: [[0.105, 0.2], [-0.235, 0.203]], back: [[-0.247, 0.197], [-0.249, 0.112]], w: 0.192, lean: 0.04, windows: [[0.07, 1]], rear: [0.14, 0.19] },
  bump: [0.252, -0.252, 0.03, 0.058],
  head: [0.084, 0.066, 0.048, 0.016],
  tail: null,
  grille: [0.07, 0.09, 0.016],
  mirror: [0.172, 0.126, 0.103],
};
const AMBULANCE: Car = {
  ...VAN,
  cabin: { ...VAN.cabin, front: [[0.192, 0.109], [0.13, 0.196]], roof: [[0.11, 0.206], [-0.235, 0.212]], back: [[-0.247, 0.206], [-0.249, 0.112]], rear: [0.15, 0.198] },
};

// Kamyon kabini: önde tekerlek kemeri, büyük ön cam, kapı camları, ızgara, farlar, tampon, aynalar
interface Cab {
  top: V2[]; // kabin çizgisi: ön alt köşeden üstten arka alt köşeye
  axle: number; // ön aks z
  glass: [V2, V2]; // ön cam çizgisi (alt, üst)
  windows: V2[]; // yan camlar (z aralıkları)
  bump: number; // ön tampon z
}
const TW = 0.206, TR = 0.046; // kamyon kabin genişliği ve teker yarıçapı
function cab(b: Builder, c: Cab) {
  const ra = TR + 0.006, y = c.top[0][1];
  b.paint.push(colored(profile([...arches(y, [[c.axle, ra, TR]]), ...c.top], TW, 0.01), LOW, '#ffffff'));
  const [g0, g1] = c.glass, n = outward(g0, g1, 1);
  const yl = g0[1] + 0.005, yh = g1[1] - 0.004;
  b.trim.push(glass(pane(g0, g1, n, yl, yh, TW - 0.034)));
  for (const [z0, z1] of c.windows) {
    const poly = clip([[z0, yl], [z1, yl], [z1, yh], [z0, yh]], g0, n, 0.016);
    if (poly.length > 2) b.trim.push(glass(sideGlass(poly, TW / 2 + 0.0012)));
  }
  liner(b, c.axle, 0.058, y, TR + ra - 0.004, ra);
  lamp(b.trim, GRILLE, c.top, 1, 0.098, 0, 0.13, 0.036);
  lamp(b.lights, HEAD, c.top, 1, 0.074, 0.074, 0.032, 0.014);
  const z = c.bump;
  b.trim.push(colored(profile([[z - 0.03, 0.044], [z - 0.005, 0.044], [z, 0.05], [z, 0.07], [z - 0.005, 0.075], [z - 0.03, 0.075]], TW + 0.006, 0.005, 1), DARK));
  b.trim.push(colored(decal(0.04, 0.011, 0, 0.06, z + 0.0008, 'z'), PLATE));
  // Ayna kolları ve büyük aynalar
  for (const k of [-1, 1]) {
    b.trim.push(colored(box(0.016, 0.004, 0.004, k * 0.109, 0.19, c.glass[0][0] - 0.02), DARK));
    b.trim.push(colored(box(0.006, 0.042, 0.014, k * 0.116, 0.172, c.glass[0][0] - 0.02), DARK));
  }
  // Tavanın önünde turuncu işaret lambaları
  const ry = Math.max(...c.top.map(p => p[1]));
  const rz = c.top.find(p => p[1] === ry)![0];
  for (const k of [-1, 0, 1]) b.trim.push(colored(box(0.012, 0.005, 0.008, k * 0.03, ry + 0.0025, rz - 0.006), '#ffb300'));
}
const CAB: Cab = {
  top: [[0.27, 0.054], [0.278, 0.062], [0.281, 0.09], [0.279, 0.125], [0.274, 0.198], [0.265, 0.214], [0.245, 0.222], [0.135, 0.222], [0.122, 0.216], [0.118, 0.054]],
  axle: 0.198,
  glass: [[0.279, 0.125], [0.274, 0.198]],
  windows: [[0.17, 1]],
  bump: 0.287,
};
const FIRE_CAB: Cab = {
  top: [[0.284, 0.054], [0.291, 0.062], [0.294, 0.09], [0.292, 0.125], [0.287, 0.19], [0.279, 0.201], [0.262, 0.207], [0.075, 0.207], [0.062, 0.2], [0.058, 0.054]],
  axle: 0.212,
  glass: [[0.292, 0.125], [0.287, 0.19]],
  windows: [[0.19, 1], [0.08, 0.175]],
  bump: 0.3,
};

function build(kind: CarKind): Builder {
  const b: Builder = { paint: [], trim: [], lights: [] };
  const P = (g: THREE.BufferGeometry, grad = false) => b.paint.push(grad ? colored(g, LOW, '#ffffff') : colored(g, '#ffffff'));
  const T = (g: THREE.BufferGeometry, c: string, top?: string) => b.trim.push(colored(g, c, top));
  if (kind === 'sedan' || kind === 'taxi' || kind === 'police') {
    car(b, SEDAN);
    if (kind === 'taxi') {
      // Tavanda ışıklı taksi lambası (gece yanar), yanlarda damalı şerit
      T(box(0.064, 0.006, 0.036, 0, 0.16, -0.05), DARK);
      b.lights.push(colored(box(0.058, 0.014, 0.03, 0, 0.17, -0.05), '#fff59d'));
      for (let k = 0; k < 8; k++) sides(b.trim, '#202124', 0.012, 0.012, 0.095, k % 2 ? 0.054 : 0.066, -0.084 + k * 0.024);
    }
    if (kind === 'police') {
      // Lacivert kapılar, tavanda kırmızı-mavi tepe lambası
      sides(b.trim, '#1a2b5c', 0.17, 0.05, 0.095, 0.066, 0);
      T(box(0.12, 0.006, 0.032, 0, 0.16, -0.045), DARK);
      T(box(0.05, 0.011, 0.028, -0.031, 0.1685, -0.045), '#e53935');
      T(box(0.05, 0.011, 0.028, 0.031, 0.1685, -0.045), '#1e88e5');
    }
  } else if (kind === 'hatch') {
    car(b, HATCH);
    // Tavanın arkasında küçük rüzgarlık
    P(lean(profile([[-0.122, 0.161], [-0.152, 0.164], [-0.16, 0.159], [-0.138, 0.157]], 0.15, 0.003, 1), 0.101, 0.163, 0.13));
  } else if (kind === 'suv') {
    car(b, SUV);
    // Tavan rayları ve kemerler arasında koyu eşik
    for (const k of [-1, 1]) T(box(0.007, 0.006, 0.2, k * 0.062, 0.1805, -0.075), DARK);
    T(box(0.198, 0.012, 0.186, 0, 0.047, 0), DARK);
  } else if (kind === 'sport') {
    car(b, SPORT);
    // Arka kanat, egzozlar, yan hava girişleri
    T(profile([[-0.208, 0.114], [-0.236, 0.116], [-0.238, 0.12], [-0.21, 0.119]], 0.18, 0.002, 1), DARK);
    for (const k of [-1, 1]) {
      T(box(0.006, 0.018, 0.012, k * 0.06, 0.106, -0.226), DARK);
      T(box(0.014, 0.009, 0.01, k * 0.05, 0.03, -0.247), CHROME);
    }
  } else if (kind === 'pickup') {
    car(b, PICKUP);
    // Açık kasa: yan duvarlar, arka kapak, koyu taban
    for (const k of [-1, 1]) P(profile([[-0.054, 0.112], [-0.054, 0.142], [-0.241, 0.142], [-0.241, 0.112]], 0.012, 0.004, 1).translate(k * 0.093, 0, 0));
    P(profile([[-0.229, 0.112], [-0.229, 0.142], [-0.241, 0.142], [-0.241, 0.112]], 0.198, 0.004, 1));
    T(box(0.172, 0.003, 0.176, 0, 0.1205, -0.143), DARK);
    for (const k of [-1, 1]) T(box(0.012, 0.024, 0.006, k * 0.088, 0.126, -0.2425), TAIL);
  } else if (kind === 'van' || kind === 'ambulance') {
    const amb = kind === 'ambulance';
    const spec = amb ? AMBULANCE : VAN;
    car(b, spec);
    const [yb, yt] = [0.109, amb ? 0.212 : 0.203];
    // Dik stop lambaları ve sürgülü kapı çizgileri (gövdede ve kabinde)
    for (const k of [-1, 1]) T(box(0.014, 0.05, 0.006, k * 0.086, 0.086, -0.2505), TAIL);
    for (const z of [0.064, -0.066]) {
      sides(b.trim, DARK, 0.003, 0.06, 0.098, 0.075, z);
      for (const k of [-1, 1]) T(lean(decal(0.003, 0.07, k * 0.0967, 0.153, z, k > 0 ? 'x' : '-x'), yb, yt, 0.04), DARK);
    }
    if (amb) {
      // Kırmızı şerit ve haç, tavanda kırmızı-mavi lamba ve arkada döner lambalar
      sides(b.trim, '#d32f2f', 0.44, 0.012, 0.098, 0.095, -0.02);
      for (const k of [-1, 1]) {
        const x = k * 0.0968, dir = k > 0 ? 'x' : '-x';
        T(lean(decal(0.036, 0.011, x, 0.163, -0.13, dir), yb, yt, 0.04), '#d32f2f');
        T(lean(decal(0.011, 0.036, x, 0.163, -0.13, dir), yb, yt, 0.04), '#d32f2f');
        T(box(0.016, 0.012, 0.016, k * 0.078, 0.217, -0.226), '#e53935');
      }
      T(box(0.13, 0.006, 0.03, 0, 0.21, 0.085), DARK);
      T(box(0.055, 0.016, 0.026, -0.032, 0.221, 0.085), '#e53935');
      T(box(0.055, 0.016, 0.026, 0.032, 0.221, 0.085), '#1e88e5');
    }
  } else {
    // Kamyonlar: kabin, şasi, arkada kasa (kamyon: beyaz kutu, çöp kamyonu: yeşil konteyner, itfaiye: kırmızı ve merdiven)
    const fire = kind === 'fire';
    cab(b, fire ? FIRE_CAB : CAB);
    const rear = kind === 'garbage' ? [-0.07, -0.175] : [-0.09, -0.2];
    wheels(b, [fire ? FIRE_CAB.axle : CAB.axle, ...rear], 0.08, TR, 0.04);
    T(box(0.12, 0.024, 0.47, 0, 0.07, fire ? -0.05 : -0.035), DARK);
    if (kind === 'truck') {
      // Rüzgarlık, yakıt deposu, beyaz kasa ve mavi şerit, arka kapılar
      P(profile([[0.235, 0.22], [0.17, 0.247], [0.15, 0.246], [0.15, 0.22]], 0.18, 0.006, 1));
      T(new THREE.CylinderGeometry(0.018, 0.018, 0.06, 10).rotateX(Math.PI / 2).translate(0.082, 0.074, 0.08), CHROME);
      T(box(0.03, 0.03, 0.05, -0.082, 0.074, 0.08), DARK);
      T(profile([[0.106, 0.1], [0.106, 0.249], [-0.278, 0.249], [-0.278, 0.1]], 0.214, 0.006, 1), '#d3d7dc', '#f6f7f9');
      sides(b.trim, '#1e88e5', 0.36, 0.03, 0.107, 0.18, -0.088);
      sides(b.trim, '#e53935', 0.36, 0.006, 0.107, 0.158, -0.088);
      T(decal(0.0025, 0.14, 0, 0.175, -0.2788, '-z'), DARK);
      for (const k of [-1, 1]) T(decal(0.003, 0.12, k * 0.03, 0.175, -0.2788, '-z'), CHROME);
      T(box(0.17, 0.012, 0.01, 0, 0.062, -0.272), DARK);
      for (const k of [-1, 1]) T(box(0.03, 0.012, 0.008, k * 0.08, 0.078, -0.276), TAIL);
    } else if (kind === 'garbage') {
      // Yuvarlak tavanlı konteyner, arkada eğik sıkıştırma kapağı (koyu ağız), sarı şerit, kaburgalar, turuncu tepe lambaları
      P(profile([[0.108, 0.098], [0.108, 0.212], [0.094, 0.226], [-0.212, 0.226], [-0.236, 0.214], [-0.268, 0.186], [-0.282, 0.122], [-0.276, 0.084], [-0.238, 0.074], [-0.205, 0.098]], 0.21, 0.01), true);
      b.trim.push(colored(pane([-0.282, 0.122], [-0.268, 0.186], outward([-0.282, 0.122], [-0.268, 0.186], -1), 0.13, 0.18, 0.16), GRILLE));
      sides(b.trim, '#f9a825', 0.34, 0.01, 0.105, 0.118, -0.08);
      for (const z of [0.04, -0.06, -0.16]) for (const k of [-1, 1]) P(box(0.006, 0.1, 0.008, k * 0.106, 0.163, z));
      for (const k of [-1, 1]) {
        T(box(0.016, 0.01, 0.016, k * 0.07, 0.227, 0.2), '#ffa000');
        T(box(0.016, 0.012, 0.008, k * 0.085, 0.092, -0.279), TAIL);
      }
    } else {
      // Ekipman dolapları (gri kepenkler), beyaz şerit, tavanda merdiven, kabinde kırmızı tepe lambaları
      P(profile([[0.052, 0.096], [0.052, 0.184], [-0.294, 0.184], [-0.294, 0.096]], 0.21, 0.008, 1), true);
      for (const [z0, z1] of [[0, 0.046], [-0.124, -0.014], [-0.28, -0.138]]) sides(b.trim, '#a9afb6', z1 - z0, 0.062, 0.105, 0.141, (z0 + z1) / 2, '#e3e6ea');
      sides(b.trim, '#f5f5f5', 0.344, 0.007, 0.105, 0.103, -0.121);
      sides(b.trim, '#f5f5f5', 0.226, 0.007, 0.103, 0.103, 0.171);
      for (const k of [-1, 1]) T(box(0.006, 0.008, 0.5, k * 0.045, 0.212, -0.04), CHROME);
      for (let k = 0; k < 9; k++) T(box(0.084, 0.004, 0.005, 0, 0.212, -0.27 + k * 0.056), CHROME);
      T(box(0.07, 0.024, 0.06, 0, 0.196, -0.25), DARK);
      T(box(0.07, 0.024, 0.014, 0, 0.196, 0.03), DARK);
      T(box(0.14, 0.004, 0.03, 0, 0.209, 0.25), DARK);
      for (const k of [-1, 1]) {
        T(box(0.055, 0.008, 0.026, k * 0.034, 0.214, 0.25), '#e53935');
        T(box(0.016, 0.03, 0.006, k * 0.088, 0.115, -0.2955), TAIL);
      }
      T(box(0.19, 0.01, 0.02, 0, 0.065, -0.288), DARK);
    }
  }
  return b;
}

const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35 });
const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
const lightMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: '#000000' });
lightMat.name = 'headlight'; // DayNight geceleri yakar

const join = (list: Bag) => (list.length ? mergeGeometries(list, false)! : new THREE.BufferGeometry());

// Her türün birleştirilmiş üç parçası (boya, ayrıntı, far) bir kez yapılır, sonra kopyalanır
const built = new Map<CarKind, THREE.BufferGeometry[]>();
function parts(kind: CarKind) {
  let list = built.get(kind);
  if (!list) {
    const b = build(kind);
    built.set(kind, (list = [join(b.paint), join(b.trim), join(b.lights)]));
  }
  return list.map(g => g.clone());
}

// Bir trafik için bütün araba türlerinin çoklu çizimleri
export class CarSet {
  readonly root = new THREE.Group();
  readonly lengths: number[] = [];
  readonly widths: number[] = [];
  private parts: { paint: THREE.InstancedMesh; trim: THREE.InstancedMesh; lights: THREE.InstancedMesh }[] = [];
  private counts: number[] = [];

  constructor(readonly kinds: CarKind[], private capacity: number) {
    for (const kind of kinds) {
      const [paint, trim, lights] = parts(kind);
      const bb = new THREE.Box3().setFromBufferAttribute(trim.attributes.position as THREE.BufferAttribute).union(new THREE.Box3().setFromBufferAttribute(paint.attributes.position as THREE.BufferAttribute));
      this.lengths.push(bb.max.z - bb.min.z);
      this.widths.push(bb.max.x - bb.min.x);
      const make = (geo: THREE.BufferGeometry, m: THREE.Material) => {
        const im = new THREE.InstancedMesh(geo, m, capacity);
        im.count = 0;
        im.frustumCulled = false;
        im.castShadow = false;
        im.receiveShadow = true;
        this.root.add(im);
        return im;
      };
      const p = make(paint, paintMat);
      p.setColorAt(0, new THREE.Color('#ffffff'));
      this.parts.push({ paint: p, trim: make(trim, trimMat), lights: make(lights, lightMat) });
      this.counts.push(0);
    }
  }

  begin() {
    this.counts.fill(0);
  }

  put(kind: number, matrix: THREE.Matrix4, color: THREE.Color) {
    const n = this.counts[kind];
    if (n >= this.capacity) return;
    const p = this.parts[kind];
    p.paint.setMatrixAt(n, matrix);
    p.paint.setColorAt(n, color);
    p.trim.setMatrixAt(n, matrix);
    p.lights.setMatrixAt(n, matrix);
    this.counts[kind] = n + 1;
  }

  end() {
    this.parts.forEach((p, k) => {
      for (const m of [p.paint, p.trim, p.lights]) {
        m.count = this.counts[k];
        m.instanceMatrix.needsUpdate = true;
      }
      if (p.paint.instanceColor) p.paint.instanceColor.needsUpdate = true;
    });
  }
}

// Binaların önünde duran araba (tek parça, hareketsiz): fabrika kamyonu, polis arabası, ambulans...
// Boya rengi köşelere yazılır (binalar birleştirilirken malzeme rengi kaybolmasın); alttaki gölge korunur
export function carModel(kind: CarKind, color?: string): THREE.Group {
  const [paint, trim, lights] = parts(kind);
  const g = new THREE.Group();
  const c = new THREE.Color(color ?? FIXED[kind] ?? '#c62828');
  const col = paint.attributes.color as THREE.BufferAttribute | undefined;
  if (col) for (let k = 0; k < col.count; k++) col.setXYZ(k, c.r * col.getX(k), c.g * col.getY(k), c.b * col.getZ(k));
  for (const [geo, m] of [[paint, trimMat], [trim, trimMat], [lights, lightMat]] as [THREE.BufferGeometry, THREE.Material][]) {
    if (!geo.attributes.position) continue;
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    g.add(mesh);
  }
  g.scale.setScalar(0.78);
  return g;
}
