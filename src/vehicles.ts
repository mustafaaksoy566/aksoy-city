import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Otobüs ve tren modelleri (kodla çizilir).
// Gövde, boy boyunca dizilen kesitlerden (köşeleri yuvarlak dikdörtgenler) örülür; uçlarda kesitler küçülerek
// burun ve köşeler yuvarlanır. Boya bantları ve camlar gövdeyi kesen düzlemlerle ayrılır: çizgiler keskin
// çıkar ve burnun etrafından dolanır. Ön taraf +z, taban y = 0.

type V2 = [number, number];
type V3 = [number, number, number];
// Renk: düz ya da y0..y1 arası alttan üste geçiş (camlar)
type Paint = string | [string, string, number, number];
// Kesen düzlem: a*x + b*y + c*z = d
type Cut = [number, number, number, number];
const atY = (y: number): Cut => [0, 1, 0, y];
const atZ = (z: number): Cut => [0, 0, 1, z];

// Parçalar üç gruba ayrılır: gövde, camlar (gece yanar), farlar (gece yanar)
interface Kit {
  body: THREE.BufferGeometry[];
  glass: THREE.BufferGeometry[];
  lights: THREE.BufferGeometry[];
}

const colors = new Map<string, THREE.Color>();
const col = (c: string) => colors.get(c) ?? colors.set(c, new THREE.Color(c)).get(c)!;
function tint(p: Paint, y: number, out: THREE.Color) {
  if (typeof p === 'string') return out.copy(col(p));
  const [a, b, y0, y1] = p;
  return out.copy(col(a)).lerp(col(b), THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1));
}

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

// Renkli parça: köşelere renk yazılır, normaller yumuşatılır
function colored(g: THREE.BufferGeometry, p: Paint) {
  const geo = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(geo.attributes)) if (name !== 'position') geo.deleteAttribute(name);
  smooth(geo);
  const pos = geo.attributes.position;
  const arr = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) tint(p, pos.getY(k), c).toArray(arr, k * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Kesit: boydaki yeri, yarı genişlik, alt ve üst (tavanın ortası), tavan ve alt köşenin yarıçapı
interface Sec {
  z: number;
  hw: number;
  y0: number;
  y1: number;
  rt: number;
  rb: number;
}

// Kesitin sağ yarısı (x >= 0): alt ortadan alt köşeye, yan yüzden (boya çizgilerinin yüksekliklerinde
// noktalarla) tavan köşesine, tavanın ortasına
function ring(s: Sec, nb: number, nt: number, levels: number[]): V2[] {
  const rb = Math.min(s.rb, s.hw, (s.y1 - s.y0) / 2);
  const rt = Math.min(s.rt, s.hw, s.y1 - s.y0 - rb);
  const out: V2[] = [[0, s.y0]];
  for (let k = 0; k <= nb; k++) {
    const a = (k / nb - 1) * (Math.PI / 2);
    out.push([s.hw - rb + rb * Math.cos(a), s.y0 + rb + rb * Math.sin(a)]);
  }
  for (const l of levels) out.push([s.hw, THREE.MathUtils.clamp(l, s.y0 + rb, s.y1 - rt)]);
  for (let k = 0; k <= nt; k++) {
    const a = (k / nt) * (Math.PI / 2);
    out.push([s.hw - rt + rt * Math.cos(a), s.y1 - rt + rt * Math.sin(a)]);
  }
  out.push([0, s.y1]);
  return out;
}

// Kesitlerden gövde yüzeyi (z sırasıyla). İlk ve son kesitin genişliği 0 olursa uçlar kapanır.
function loft(secs: Sec[], nb = 2, nt = 4, levels: number[] = []) {
  const rings = secs.map(s => ring(s, nb, nt, levels));
  const pos: number[] = [];
  const tri = (a: V3, b: V3, c: V3) => {
    // Alanı olmayan üçgenler (kesitler çakışınca) atlanır
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-16) return;
    pos.push(...a, ...b, ...c);
  };
  for (let i = 0; i + 1 < secs.length; i++) {
    const A = rings[i], B = rings[i + 1], za = secs[i].z, zb = secs[i + 1].z;
    for (let j = 0; j + 1 < A.length; j++) {
      for (const s of [1, -1]) {
        const p: V3[] = [[s * A[j][0], A[j][1], za], [s * A[j + 1][0], A[j + 1][1], za], [s * B[j + 1][0], B[j + 1][1], zb], [s * B[j][0], B[j][1], zb]];
        if (s > 0) {
          tri(p[0], p[1], p[2]);
          tri(p[0], p[2], p[3]);
        } else {
          tri(p[0], p[2], p[1]);
          tri(p[0], p[3], p[2]);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  smooth(g);
  return g;
}

// Yüzeyi düzlemlerle parçala, her parçayı ortasındaki noktanın rengine boya
function paint(geo: THREE.BufferGeometry, cuts: Cut[], fn: (x: number, y: number, z: number) => Paint) {
  const P = geo.attributes.position, N = geo.attributes.normal;
  const pos: number[] = [], nor: number[] = [], cols: number[] = [];
  const c = new THREE.Color();
  for (let t = 0; t < P.count; t += 3) {
    let polys: number[][][] = [[0, 1, 2].map(k => [P.getX(t + k), P.getY(t + k), P.getZ(t + k), N.getX(t + k), N.getY(t + k), N.getZ(t + k)])];
    for (const [a, b, cc, d] of cuts) {
      const next: number[][][] = [];
      for (const poly of polys) {
        // Düzlemin üstündeki köşeler (kayan nokta payıyla) 0 sayılır, yoksa gereksiz ince parçalar çıkar
        const ds = poly.map(v => {
          const e = a * v[0] + b * v[1] + cc * v[2] - d;
          return Math.abs(e) < 1e-6 ? 0 : e;
        });
        if (ds.every(x => x >= 0) || ds.every(x => x <= 0)) {
          next.push(poly);
          continue;
        }
        const lo: number[][] = [], hi: number[][] = [];
        poly.forEach((u, i) => {
          const v = poly[(i + 1) % poly.length], du = ds[i], dv = ds[(i + 1) % poly.length];
          if (du <= 0) lo.push(u);
          if (du >= 0) hi.push(u);
          if ((du < 0 && dv > 0) || (du > 0 && dv < 0)) {
            const f = du / (du - dv);
            const w = u.map((x, k) => x + (v[k] - x) * f);
            lo.push(w);
            hi.push(w);
          }
        });
        if (lo.length > 2) next.push(lo);
        if (hi.length > 2) next.push(hi);
      }
      polys = next;
    }
    for (const poly of polys) {
      let mx = 0, my = 0, mz = 0;
      for (const v of poly) {
        mx += v[0] / poly.length;
        my += v[1] / poly.length;
        mz += v[2] / poly.length;
      }
      const p = fn(mx, my, mz);
      for (let k = 1; k + 1 < poly.length; k++) {
        for (const v of [poly[0], poly[k], poly[k + 1]]) {
          const l = Math.hypot(v[3], v[4], v[5]) || 1;
          pos.push(v[0], v[1], v[2]);
          nor.push(v[3] / l, v[4] / l, v[5] / l);
          tint(p, v[1], c);
          cols.push(c.r, c.g, c.b);
        }
      }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return out;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
// İnce yüzey (şerit, cam, kapı): yüzü verilen yöne bakar; yanlarda w boy (z) boyuncadır
function decal(w: number, h: number, x: number, y: number, z: number, dir: 'x' | '-x' | 'z' | '-z' | 'y') {
  const g = new THREE.PlaneGeometry(w, h);
  if (dir === 'x') g.rotateY(Math.PI / 2);
  else if (dir === '-x') g.rotateY(-Math.PI / 2);
  else if (dir === '-z') g.rotateY(Math.PI);
  else if (dir === 'y') g.rotateX(-Math.PI / 2);
  return g.translate(x, y, z);
}
// İki yana birden ince yüzey (x: yan yüzün uzaklığı)
function sides(list: THREE.BufferGeometry[], p: Paint, w: number, h: number, x: number, y: number, z: number) {
  for (const k of [-1, 1]) list.push(colored(decal(w, h, k * x, y, z, k > 0 ? 'x' : '-x'), p));
}
// Eğik yüzeye yapışık ince yüzey: n yönüne bakar
function patch(w: number, h: number, at: V3, n: V3) {
  const g = new THREE.PlaneGeometry(w, h);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...n).normalize()));
  return g.translate(...at);
}
// İki nokta arasında ince çubuk (ayna kolu, pantograf)
function rod(a: V3, b: V3, t: number) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.BoxGeometry(t, t, d.length());
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}
// Köşeleri yuvarlak kutu (tavandaki klima ve kapaklar): taban y = 0, ortası x = z = 0
function pod(l: number, w: number, h: number, r: number) {
  const S = (z: number, k: number, t: number): Sec => ({ z, hw: (w / 2) * k, y0: 0, y1: h * t, rt: r * k, rb: 0.001 });
  const e = Math.min(r, l / 2);
  return loft([S(-l / 2, 0, 0.8), S(-l / 2 + e * 0.3, 0.86, 0.94), S(-l / 2 + e, 1, 1), S(l / 2 - e, 1, 1), S(l / 2 - e * 0.3, 0.86, 0.94), S(l / 2, 0, 0.8)], 1, 3);
}
// Ucun (burun ya da arka) kesitleri: [uçtan uzaklık, yarı genişlik, alt, üst, tavan köşesi, alt köşe];
// tip: ucun z'si, s = 1 ön uç, -1 arka uç. z sırasıyla döner.
function endSecs(list: number[][], tip: number, s: number): Sec[] {
  const out = list.map(([d, hw, y0, y1, rt, rb]) => ({ z: tip - s * d, hw, y0, y1, rt, rb }));
  return s > 0 ? out.reverse() : out;
}
// Tekerlek kemeri: kesitlerin altı kemer boyunca yükselir (aks z, kemer yarıçapı ra, teker merkezi c)
function arch(base: Sec, z: number, ra: number, c: number, n = 6): Sec[] {
  const out: Sec[] = [{ ...base, z: z - ra }];
  for (let k = 0; k <= n; k++) {
    const a = Math.PI * (1 - k / n);
    out.push({ ...base, z: z + ra * Math.cos(a), y0: Math.max(base.y0, c + ra * Math.sin(a)) });
  }
  out.push({ ...base, z: z + ra });
  return out;
}
// Bir aralığı aralarında direk kalan eşit camlara böl: [orta z, boy]
function panes(a: number, b: number, size: number, gap: number): V2[] {
  const n = Math.max(1, Math.round((b - a) / size));
  const len = (b - a - (n - 1) * gap) / n;
  return Array.from({ length: n }, (_, i) => [a + len / 2 + i * (len + gap), len]);
}

// ---------------------------------------------------------------------------------------------------------
// Otobüs: 12 metrelik alçak tabanlı şehir otobüsü. Mavi-beyaz boya, sarı şerit, koyu cam bandı ve direkli
// camlar, saran ön cam, önde hat tabelası, tavanda klima, sağ yanda (kaldırım tarafı, -x) üç çift kanatlı
// kapı, boynuz aynalar, farlar, stoplar, motor ızgarası, kemerli iki aks, jantlı tekerlekler.
// Ölçüler eski kutu otobüsle aynı (boy ~0.61, en ~0.245, yükseklik 0.25); trafik bu kutuyu kullanır.
const BUS: Sec = { z: 0, hw: 0.113, y0: 0.03, y1: 0.236, rt: 0.022, rb: 0.008 };
const BUS_FRONT = 0.3045, BUS_REAR = -0.3005;
const BUS_AXLES = [-0.135, 0.165];
const BUS_WR = 0.04, BUS_RA = 0.048; // teker ve kemer yarıçapı
const BUS_DOORS: V2[] = [[-0.075, -0.019], [0.045, 0.103], [0.218, 0.274]]; // sağ yandaki kapılar (z aralığı)
const BUS_END = [
  [0, 0, 0.042, 0.216, 0, 0],
  [0.0005, 0.07, 0.04, 0.222, 0.012, 0.005],
  [0.002, 0.096, 0.036, 0.228, 0.016, 0.006],
  [0.0055, 0.106, 0.033, 0.232, 0.02, 0.007],
  [0.0125, 0.111, 0.031, 0.235, 0.022, 0.008],
  [0.0245, 0.113, 0.03, 0.236, 0.022, 0.008],
];
const BC = {
  blue: '#1e6fd9', white: '#f4f4f2', roof: '#dde1e5', band: '#161b21', screen: '#2b3d4f', pane: '#3a5268', skirt: '#2b2f35',
  accent: '#ffd34d', tyre: '#1b1c1f', rim: '#c4c9d0', hub: '#5a5f66', dark: '#15171a', amber: '#ffb300', lamp: '#fff6d5',
  tail: '#d32f2f', plate: '#eef1f4',
};

function busKit(): Kit {
  const k: Kit = { body: [], glass: [], lights: [] };
  const B = k.body;
  const T = (g: THREE.BufferGeometry, p: Paint) => B.push(colored(g, p));
  const X = BUS.hw;
  // Gövde: uçlar yuvarlak, aksların üstünde kemer
  const secs = [...endSecs(BUS_END, BUS_REAR, -1), ...BUS_AXLES.flatMap(z => arch(BUS, z, BUS_RA, BUS_WR, 4)), ...endSecs(BUS_END, BUS_FRONT, 1)];
  const levels = [0.042, 0.085, 0.104, 0.112, 0.124, 0.212];
  const cuts = [...levels, 0.232].map(atY);
  cuts.push(atZ(0.287));
  B.push(paint(loft(secs, 2, 2, levels), cuts, (_x, y, z) => {
    if (y < 0.042) return BC.skirt; // tampon ve etek
    if (z > 0.287 && y > 0.085 && y < 0.212) return BC.screen; // saran ön cam
    if (y < 0.124) return y > 0.104 && y < 0.112 ? BC.accent : BC.blue;
    if (y < 0.212) return BC.band;
    return y > 0.232 ? BC.roof : BC.white;
  }));
  // Tekerlekler (lastik, jant, göbek) ve kemerlerin içi koyu
  const wx = X - 0.016;
  for (const z of BUS_AXLES) {
    for (const s of [-1, 1]) {
      T(new THREE.CylinderGeometry(BUS_WR, BUS_WR, 0.03, 12, 1, true).rotateZ(Math.PI / 2).translate(s * wx, BUS_WR, z), BC.tyre);
      T(new THREE.CylinderGeometry(BUS_WR * 0.6, BUS_WR * 0.68, 0.004, 10, 1, true).rotateZ(-s * Math.PI / 2).translate(s * (wx + 0.015), BUS_WR, z), BC.rim);
      T(new THREE.CircleGeometry(BUS_WR * 0.6, 10).rotateY(s * Math.PI / 2).translate(s * (wx + 0.017), BUS_WR, z), BC.rim);
      T(new THREE.CircleGeometry(BUS_WR, 12).rotateY(s * Math.PI / 2).translate(s * (wx + 0.015), BUS_WR, z), BC.tyre);
      T(new THREE.CircleGeometry(BUS_WR * 0.22, 6).rotateY(s * Math.PI / 2).translate(s * (wx + 0.018), BUS_WR, z), BC.hub);
    }
    T(box((wx - 0.017) * 2, BUS_WR + BUS_RA - 0.034, BUS_RA * 2, 0, (BUS.y0 + BUS_WR + BUS_RA - 0.004) / 2, z), BC.dark);
  }
  // Yan camlar: sol yanda (+x) şoför camı ve yolcu camları, sağ yanda kapıların arası
  const left: V2[] = [[0.234, 0.283], [-0.272, 0.226]];
  const right: V2[] = [[0.109, 0.212], [-0.013, 0.039], [-0.272, -0.081]];
  for (const [list, s] of [[left, 1], [right, -1]] as [V2[], number][]) {
    for (const [a, b] of list) {
      for (const [z, len] of panes(a, b, 0.07, 0.007)) T(decal(len, 0.08, s * (X + 0.0012), 0.168, z, s > 0 ? 'x' : '-x'), BC.pane);
    }
  }
  // Kapılar (sağ yan): koyu çerçeve, iki cam kanat, ortada tutamak çizgisi
  for (const [z0, z1] of BUS_DOORS) {
    const zm = (z0 + z1) / 2, x = -(X + 0.0008);
    T(decal(z1 - z0 + 0.004, 0.181, x, 0.1245, zm, '-x'), BC.skirt);
    for (const s of [-1, 1]) {
      const w = (z1 - z0) / 2 - 0.0045;
      T(decal(w, 0.169, x - 0.0008, 0.1245, zm + s * (w / 2 + 0.0015), '-x'), BC.pane);
      T(decal(w, 0.004, x - 0.0016, 0.12, zm + s * (w / 2 + 0.0015), '-x'), BC.skirt);
    }
  }
  // Yan hat tabelası (ön kapının yanında) ve arka hat numarası
  T(decal(0.056, 0.016, -(X + 0.0024), 0.198, 0.16, '-x'), BC.dark);
  T(decal(0.048, 0.007, -(X + 0.0032), 0.198, 0.16, '-x'), BC.amber);
  // Ön: hat tabelası, farlar, sinyaller, gündüz farı şeridi, plaka, arma, silecekler
  const F = BUS_FRONT;
  T(box(0.17, 0.018, 0.003, 0, 0.203, F - 0.0005), BC.dark);
  T(box(0.024, 0.008, 0.003, -0.065, 0.203, F + 0.0008), BC.amber);
  T(box(0.1, 0.008, 0.003, 0.02, 0.203, F + 0.0008), BC.amber);
  for (const s of [-1, 1]) {
    T(box(0.04, 0.017, 0.008, s * 0.078, 0.063, F - 0.003), BC.dark);
    for (const x of [0.068, 0.087]) T(box(0.013, 0.011, 0.008, s * x, 0.063, F - 0.0018), BC.lamp);
    T(box(0.034, 0.003, 0.006, s * 0.078, 0.076, F - 0.002), BC.lamp);
    T(box(0.008, 0.008, 0.008, s * 0.104, 0.063, F - 0.006), BC.amber);
    T(rod([s * 0.075, 0.09, F + 0.0008], [s * 0.006, 0.097, F + 0.0008], 0.003), BC.dark);
  }
  T(box(0.042, 0.01, 0.004, 0, 0.036, F - 0.0025), BC.plate);
  T(box(0.016, 0.006, 0.004, 0, 0.078, F - 0.0015), BC.rim);
  // Arka: dik stop lambaları, sinyaller, motor ızgarası, hat numarası, üst stop, plaka
  const R = BUS_REAR;
  for (const s of [-1, 1]) {
    T(box(0.012, 0.055, 0.008, s * 0.098, 0.09, R + 0.003), BC.tail);
    T(box(0.012, 0.012, 0.008, s * 0.098, 0.052, R + 0.003), BC.amber);
  }
  T(box(0.13, 0.05, 0.004, 0, 0.088, R + 0.0008), BC.dark);
  for (const y of [0.074, 0.084, 0.094, 0.104]) T(decal(0.12, 0.003, 0, y, R - 0.0016, '-z'), BC.skirt);
  T(box(0.05, 0.01, 0.004, 0, 0.2, R + 0.0008), BC.amber);
  T(box(0.05, 0.005, 0.004, 0, 0.219, R + 0.0012), BC.tail);
  T(box(0.042, 0.01, 0.004, 0, 0.05, R + 0.0003), BC.plate);
  // Tavan: klima, arkada ikinci kutu, iki havalandırma kapağı
  T(pod(0.17, 0.15, 0.014, 0.01).translate(0, BUS.y1 - 0.0005, 0.07), '#e8ebee');
  for (const s of [-1, 1]) T(decal(0.05, 0.11, s * 0.035, BUS.y1 + 0.0143, 0.07, 'y'), '#9aa1a8');
  T(box(0.12, 0.009, 0.08, 0, BUS.y1 + 0.004, -0.2), '#d5d9dd');
  for (const z of [-0.08, 0.2]) T(box(0.04, 0.004, 0.04, 0, BUS.y1 + 0.001, z), '#c9ced3');
  // Boynuz aynalar: ön camın üstünden öne uzanan kol ve aşağı sarkan ayna
  for (const s of [-1, 1]) {
    T(rod([s * 0.104, 0.226, 0.29], [s * 0.118, 0.224, 0.307], 0.004), BC.dark);
    T(rod([s * 0.118, 0.224, 0.307], [s * 0.1195, 0.204, 0.307], 0.003), BC.dark);
    T(box(0.006, 0.032, 0.012, s * 0.1195, 0.19, 0.306), BC.dark);
  }
  return k;
}

// Tek renkli parçalara ayır (bakeModel her parçanın rengini malzemesinden alır)
function byColor(list: THREE.BufferGeometry[]) {
  const groups = new Map<string, { c: THREE.Color; pos: number[]; nor: number[] }>();
  for (const g of list) {
    const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
    for (let t = 0; t < P.count; t += 3) {
      const key = `${C.getX(t).toFixed(4)},${C.getY(t).toFixed(4)},${C.getZ(t).toFixed(4)}`;
      let grp = groups.get(key);
      if (!grp) groups.set(key, (grp = { c: new THREE.Color(C.getX(t), C.getY(t), C.getZ(t)), pos: [], nor: [] }));
      for (let v = t; v < t + 3; v++) {
        grp.pos.push(P.getX(v), P.getY(v), P.getZ(v));
        grp.nor.push(N.getX(v), N.getY(v), N.getZ(v));
      }
    }
  }
  const root = new THREE.Group();
  for (const { c, pos, nor } of groups.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    mesh.castShadow = true;
    root.add(mesh);
  }
  return root;
}

// Otobüs: düz renkli parçalardan oluşan grup (trafik bakeModel ile tek geometriye çevirir)
export function busModel(): THREE.Group {
  const k = busKit();
  return byColor([...k.body, ...k.glass, ...k.lights]);
}

// ---------------------------------------------------------------------------------------------------------
// Tren: banliyö treni. Beyaz gövde, kırmızı alt bant ve kırmızı burun, koyu cam bandı (yolcu camları gece
// yanar), kırmızı sürgülü kapılar, saran ön cam ve hat tabelası, farlar, tavanda klima ve pantograf,
// bojiler ve tekerlekler, vagonlar arasında körük. Kabinli vagon boyu ~0.8, ortadaki vagon ~0.9 (eski tren
// modelleriyle aynı); tekerlekler ray başının üstüne (y = 0.0075) basar, raylar ±0.08'de.
const TR: Sec = { z: 0, hw: 0.18, y0: 0.085, y1: 0.44, rt: 0.055, rb: 0.012 };
const HEAD_TIP = -0.392, MID_TIP = 0.442; // kabinli vagonun arka ucu, ortadaki vagonun uçları (körük hariç)
// Boya çizgileri: etek, kırmızı bant, beyaz, cam bandı, beyaz, kırmızı ince çizgi
const T_LEVELS = [0.1, 0.168, 0.222, 0.36, 0.37, 0.377];
const TC = {
  white: '#f2f4f5', red: '#c8102e', band: '#1d232a', roof: '#c3c9cf', skirt: '#3b4046', dark: '#2a2e33', steel: '#4a4f56',
  metal: '#8a9199', amber: '#ffb300', lamp: '#fff6d5', tail: '#e53935', insulator: '#8d4f36', ac: '#d5dade',
};
const T_PANE: Paint = ['#16212c', '#4b677e', 0.232, 0.35];
const T_SCREEN: Paint = ['#0f151c', '#3f5b72', 0.222, 0.43];
const T_END = [
  [0, 0, 0.09, 0.425, 0, 0],
  [0.002, 0.12, 0.087, 0.432, 0.037, 0.006],
  [0.006, 0.165, 0.085, 0.438, 0.05, 0.01],
  [0.014, 0.18, 0.085, 0.44, 0.055, 0.012],
];
// Burun: tavan aşağı kıvrılıp eğik ön cama, oradan dik alt yüze iner; köşeler giderek yuvarlanır
const NOSE: Sec[] = [
  [0.16, 0.18, 0.085, 0.44, 0.055, 0.012],
  [0.22, 0.18, 0.085, 0.438, 0.058, 0.012],
  [0.26, 0.18, 0.085, 0.43, 0.065, 0.012],
  [0.29, 0.179, 0.085, 0.414, 0.075, 0.012],
  [0.315, 0.177, 0.085, 0.391, 0.085, 0.012],
  [0.338, 0.173, 0.085, 0.363, 0.092, 0.012],
  [0.358, 0.168, 0.085, 0.333, 0.095, 0.012],
  [0.375, 0.161, 0.085, 0.303, 0.094, 0.012],
  [0.388, 0.153, 0.086, 0.276, 0.088, 0.012],
  [0.397, 0.145, 0.086, 0.254, 0.08, 0.012],
  [0.402, 0.125, 0.087, 0.242, 0.07, 0.011],
  [0.405, 0.09, 0.089, 0.236, 0.05, 0.01],
  [0.4065, 0.05, 0.091, 0.233, 0.028, 0.008],
  [0.407, 0, 0.093, 0.232, 0, 0],
].map(([z, hw, y0, y1, rt, rb]) => ({ z, hw, y0, y1, rt, rb }));
const GLASS_Z = 0.285; // ön cam burada başlar (tavanın kıvrıldığı yer)

// Burnun ortasında (tavan çizgisinde) verilen yükseklikteki nokta, yüzeyden d kadar dışarıda; ve yüzeyin yönü
function noseAt(x: number, y: number, d: number): { at: V3; n: V3 } {
  for (let i = 0; i + 1 < NOSE.length; i++) {
    const a = NOSE[i], b = NOSE[i + 1];
    if (y > a.y1 || y < b.y1) continue;
    const z = a.z + ((a.y1 - y) / (a.y1 - b.y1)) * (b.z - a.z);
    const dz = b.z - a.z, dy = a.y1 - b.y1, l = Math.hypot(dz, dy);
    return { at: [x, y + (dz / l) * d, z + (dy / l) * d], n: [0, dz, dy] };
  }
  return { at: [x, y, 0], n: [0, 1, 0] };
}

// Boji: dört tekerlek ve akslar, yan çerçeveler, aks kutuları, travers ve motor
function bogie(k: Kit, z: number) {
  const T = (g: THREE.BufferGeometry, p: Paint) => k.body.push(colored(g, p));
  for (const dz of [-0.05, 0.05]) {
    for (const s of [-1, 1]) {
      T(new THREE.CylinderGeometry(0.034, 0.034, 0.012, 12).rotateZ(Math.PI / 2).translate(s * 0.08, 0.0415, z + dz), TC.steel);
      T(box(0.016, 0.02, 0.026, s * 0.108, 0.0415, z + dz), TC.metal);
    }
    T(new THREE.CylinderGeometry(0.007, 0.007, 0.15, 6, 1, true).rotateZ(Math.PI / 2).translate(0, 0.0415, z + dz), TC.dark);
  }
  for (const s of [-1, 1]) T(box(0.014, 0.03, 0.17, s * 0.1, 0.052, z), TC.dark);
  T(box(0.2, 0.016, 0.05, 0, 0.074, z), TC.dark);
  T(box(0.11, 0.028, 0.05, 0, 0.05, z), '#262a2f');
}

// Körük ve kaplin (vagonların birleştiği uç): tip ucun z'si, s = 1 ön, -1 arka
function gangway(k: Kit, tip: number, s: number) {
  const T = (g: THREE.BufferGeometry, p: Paint) => k.body.push(colored(g, p));
  T(box(0.2, 0.27, 0.014, 0, 0.24, tip + s * 0.001), TC.dark);
  for (const d of [0.003, 0.0075]) T(box(0.21, 0.28, 0.002, 0, 0.24, tip + s * d), TC.skirt);
  T(box(0.04, 0.02, 0.016, 0, 0.075, tip + s * 0.002), TC.dark);
}

// Tek kollu pantograf (kalkık): yalıtkanlar, taban, alt ve üst kol, itme çubuğu, temas başlığı
function pantograph(k: Kit, z: number, y: number) {
  const T = (g: THREE.BufferGeometry, p: Paint) => k.body.push(colored(g, p));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) T(new THREE.CylinderGeometry(0.007, 0.009, 0.016, 8).translate(sx * 0.05, y + 0.008, z + sz * 0.045), TC.insulator);
  T(box(0.13, 0.006, 0.11, 0, y + 0.019, z), TC.skirt);
  for (const s of [-1, 1]) T(rod([s * 0.035, y + 0.022, z - 0.04], [s * 0.006, y + 0.105, z + 0.07], 0.007), TC.metal);
  T(rod([0, y + 0.105, z + 0.07], [0, y + 0.168, z - 0.005], 0.005), TC.metal);
  T(rod([0, y + 0.024, z - 0.05], [0, y + 0.1, z + 0.06], 0.003), TC.dark);
  T(box(0.18, 0.004, 0.006, 0, y + 0.172, z - 0.005), TC.metal);
  for (const sz of [-1, 1]) {
    T(box(0.15, 0.005, 0.008, 0, y + 0.177, z - 0.005 + sz * 0.014), TC.dark);
    for (const sx of [-1, 1]) T(rod([sx * 0.075, y + 0.177, z - 0.005 + sz * 0.014], [sx * 0.098, y + 0.166, z - 0.005 + sz * 0.014], 0.004), TC.dark);
  }
  // Pantograftan tavandaki şaltere giden kablo
  T(rod([0.04, y + 0.016, z - 0.06], [0.04, y + 0.012, z - 0.14], 0.004), TC.dark);
}

function trainKit(head: boolean): Kit {
  const k: Kit = { body: [], glass: [], lights: [] };
  const B = k.body;
  const T = (g: THREE.BufferGeometry, p: Paint) => B.push(colored(g, p));
  const X = TR.hw;
  // Gövde: kabinli vagonda arkası körüklü, önü burun; ortadaki vagonun iki ucu körüklü
  const secs = head ? [...endSecs(T_END, HEAD_TIP, -1), ...NOSE] : [...endSecs(T_END, -MID_TIP, -1), ...endSecs(T_END, MID_TIP, 1)];
  const cuts = [...T_LEVELS, 0.428].map(atY);
  // Burnun kırmızısı yanlardan eğik bir çizgiyle cama kadar yükselir: y = 0.1168 + 0.2842 z
  if (head) cuts.push(atZ(GLASS_Z), [0, 1, -0.2842, 0.1168]);
  B.push(paint(loft(secs, 2, 4, T_LEVELS), cuts, (_x, y, z) => {
    if (y < 0.1) return TC.skirt;
    if (head && z > GLASS_Z && y > 0.222) return T_SCREEN;
    if (y > 0.222 && y < 0.36) return TC.band;
    if (y < 0.168 || (head && z > 0.18 && y < 0.1168 + 0.2842 * z)) return TC.red;
    if (y > 0.37 && y < 0.377) return TC.red;
    return y > 0.428 ? TC.roof : TC.white;
  }));
  // Yolcu camları (gece yanar) ve kapılar (iki yanda)
  const doors = head ? [-0.2, 0.1] : [-0.25, 0.25];
  const wins: V2[] = head ? [[-0.372, -0.2475], [-0.1525, 0.0525], [0.1475, 0.255]] : [[-0.425, -0.2975], [-0.2025, 0.2025], [0.2975, 0.425]];
  for (const [a, b] of wins) for (const [z, len] of panes(a, b, 0.085, 0.012)) sides(k.glass, T_PANE, len, 0.118, X + 0.0012, 0.291, z);
  for (const z of doors) {
    sides(B, TC.dark, 0.081, 0.27, X + 0.0008, 0.231, z);
    for (const s of [-1, 1]) {
      sides(B, TC.red, 0.0355, 0.262, X + 0.0014, 0.231, z + s * 0.0195);
      sides(k.glass, T_PANE, 0.024, 0.11, X + 0.002, 0.287, z + s * 0.0195);
    }
  }
  // Altta bojiler ve aradaki cihaz kutuları
  const bogies = head ? [-0.25, 0.25] : [-0.31, 0.31];
  for (const z of bogies) bogie(k, z);
  const [u0, u1] = head ? [-0.16, 0.15] : [-0.22, 0.22];
  panes(u0, u1, 0.1, 0.012).forEach(([z, len], i) => T(box(0.25, 0.036, len, 0, 0.067, z), i % 2 ? '#454b52' : '#3a3f45'));
  // Uçlar
  if (head) gangway(k, HEAD_TIP, -1);
  else for (const s of [-1, 1]) gangway(k, s * MID_TIP, s);
  // Tavan: klima (üstünde ızgaralar); ortadaki vagonda şalter kutusu ve pantograf
  const ac = (z: number) => {
    T(pod(0.2, 0.2, 0.02, 0.012).translate(0, TR.y1 - 0.002, z), TC.ac);
    for (const dz of [-0.045, 0.045]) T(decal(0.12, 0.05, 0, TR.y1 + 0.0185, z + dz, 'y'), TC.metal);
  };
  if (head) {
    ac(-0.15);
    T(box(0.08, 0.012, 0.05, 0, TR.y1 + 0.004, 0.08), TC.ac);
    // Ön: farlar (gece yanar), stoplar, hat tabelası, tepe farı, kaplin, kar küreyici
    for (const s of [-1, 1]) {
      T(box(0.05, 0.024, 0.01, s * 0.08, 0.155, 0.4018), TC.dark);
      k.lights.push(colored(box(0.034, 0.013, 0.01, s * 0.08, 0.155, 0.4028), TC.lamp));
      T(box(0.016, 0.013, 0.01, s * 0.122, 0.155, 0.399), TC.tail);
    }
    // Hat tabelası ön camın üst kısmında, camın eğimine yapışık
    const sign = (list: THREE.BufferGeometry[], x: number, y: number, w: number, h: number, d: number, p: Paint) => {
      const { at, n } = noseAt(x, y, d);
      list.push(colored(patch(w, h, at, n), p));
    };
    sign(B, 0, 0.385, 0.14, 0.024, 0.0012, TC.dark);
    sign(B, -0.046, 0.385, 0.036, 0.01, 0.002, TC.amber);
    sign(B, 0.018, 0.385, 0.07, 0.01, 0.002, TC.amber);
    // Tepe farı: ön camın üstünde, koyu yuvanın içinde
    sign(B, 0, 0.42, 0.064, 0.018, 0.0008, TC.dark);
    sign(k.lights, 0, 0.42, 0.05, 0.01, 0.0016, TC.lamp);
    T(box(0.04, 0.02, 0.016, 0, 0.075, 0.405), TC.dark);
    T(new THREE.BoxGeometry(0.28, 0.045, 0.008).rotateX(-0.35).translate(0, 0.066, 0.393), TC.dark);
  } else {
    ac(-0.3);
    T(pod(0.07, 0.07, 0.02, 0.01).translate(0.04, TR.y1 - 0.002, -0.08), TC.ac);
    pantograph(k, 0.1, TR.y1);
  }
  return k;
}

const join = (list: THREE.BufferGeometry[]) => (list.length ? mergeGeometries(list, false)! : new THREE.BufferGeometry());

// Tren vagonu: gövde (köşe renkli), camlar (gece yanar) ve farlar (gece yanar) ayrı geometriler
export function trainCar(kind: 'head' | 'mid') {
  const k = trainKit(kind === 'head');
  return { body: join(k.body), glass: join(k.glass), lights: join(k.lights) };
}
