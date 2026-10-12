import * as THREE from 'three';
import { ROAD_COLORS } from './assets';
import { mergeStatic } from './batcher';
import { CarSet, CAR_KINDS, NORMAL_CARS, carPaint } from './cars';
import { HW, SKI_ROAD, riverAt } from './terrain';
import { part, mat } from './utilities';

// Şehrin dışındaki yollar: dört şeritli otoban (ortada beton bariyer, kenarlarda bariyer ve aydınlatma),
// şehrin girişinin önünde göbek kavşak, kayak merkezine çıkan yol ve bunların üzerindeki trafik.
// Yollar kare kare değil, kıvrımlı şeritler halinde çizilir (SimCity'deki otobanlar gibi).

const Y = 0.036; // asfaltın üstü (şehirdeki yollarla aynı)
const CAR_Y = 0.066;
const CAR_SCALE = 0.78;
const MW = 0.92; // otobanın yarı genişliği
const LANES = [0.24, 0.6]; // otobanda şeritler (yol ortasından; sağdan gidiş)
const SMALL = 0.45; // iki şeritli yolun yarı genişliği
const SMALL_LANE = 0.2;
const TUNNEL_END = -60; // arabalar dağın içinde (tünelde) başlar/biter
const { ring } = HW;
const CITY_X = -24.2; // şehrin girişi

type V2 = THREE.Vector2;
const v2 = (x: number, z: number) => new THREE.Vector2(x, z);

// Köşeleri yuvarlatılmış çizgi boyunca sık noktalar (x, z)
function path(corners: [number, number][], radius = 3, step = 0.35): V2[] {
  const pts = corners.map(([x, z]) => v2(x, z));
  const out: V2[] = [];
  const line = (a: V2, b: V2) => {
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 0; k < n; k++) out.push(a.clone().lerp(b, k / n));
  };
  let start = pts[0];
  for (let k = 1; k < pts.length - 1; k++) {
    const a = pts[k].clone().sub(pts[k - 1]).normalize(), b = pts[k + 1].clone().sub(pts[k]).normalize();
    const r = Math.min(radius, pts[k].distanceTo(pts[k - 1]) / 2, pts[k + 1].distanceTo(pts[k]) / 2);
    const p0 = pts[k].clone().addScaledVector(a, -r), p2 = pts[k].clone().addScaledVector(b, r);
    line(start, p0);
    for (let s = 0; s < 12; s++) {
      const t = s / 12, u = 1 - t;
      out.push(v2(0, 0).addScaledVector(p0, u * u).addScaledVector(pts[k], 2 * u * t).addScaledVector(p2, t * t));
    }
    start = p2;
  }
  line(start, pts[pts.length - 1]);
  out.push(pts[pts.length - 1].clone());
  return out;
}

// Gidiş yönüne göre sağ taraf
function normals(pts: V2[]) {
  return pts.map((_, k) => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    const t = b.clone().sub(a).normalize();
    return v2(-t.y, t.x);
  });
}
const offset = (pts: V2[], o: number) => {
  const n = normals(pts);
  return pts.map((p, k) => p.clone().addScaledVector(n[k], o));
};

// Yere yatık şerit (a..b arası), istenirse kesik kesik (dash: [dolu, boş] uzunluk)
function strip(pts: V2[], a: number, b: number, y: number, dash?: [number, number]) {
  const n = normals(pts);
  const pos: number[] = [];
  const idx: number[] = [];
  let s = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const len = pts[k].distanceTo(pts[k + 1]);
    const mid = s + len / 2;
    s += len;
    if (dash && mid % (dash[0] + dash[1]) > dash[0]) continue;
    const base = pos.length / 3;
    for (const j of [k, k + 1]) for (const o of [a, b]) pos.push(pts[j].x + n[j].x * o, y, pts[j].y + n[j].y * o);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  return geo;
}

// Dik duvar şeridi (bariyer, korkuluk): o merkezinde, t kalınlığında, y0..y1 arası
function wall(pts: V2[], o: number, t: number, y0: number, y1: number) {
  const n = normals(pts);
  const pos: number[] = [];
  const idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  };
  for (let k = 0; k < pts.length - 1; k++) {
    const P = (j: number, off: number, y: number) => [pts[j].x + n[j].x * off, y, pts[j].y + n[j].y * off];
    for (const side of [-t / 2, t / 2]) quad(P(k, o + side, y0), P(k, o + side, y1), P(k + 1, o + side, y0), P(k + 1, o + side, y1));
    quad(P(k, o - t / 2, y1), P(k, o + t / 2, y1), P(k + 1, o - t / 2, y1), P(k + 1, o + t / 2, y1));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const M = {
  asphalt: new THREE.MeshStandardMaterial({ color: ROAD_COLORS.asphalt, roughness: 0.85 }),
  line: new THREE.MeshStandardMaterial({ color: '#eceef3', roughness: 0.7 }),
  yellow: new THREE.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.7 }),
  concrete: new THREE.MeshStandardMaterial({ color: '#cfccc4', roughness: 0.9, side: THREE.DoubleSide }),
  rail: new THREE.MeshStandardMaterial({ color: '#b3bcc6', roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }),
  curb: new THREE.MeshStandardMaterial({ color: ROAD_COLORS.curb, roughness: 0.8, side: THREE.DoubleSide }),
  pole: new THREE.MeshStandardMaterial({ color: '#7d8791', roughness: 0.5, metalness: 0.5 }),
  grass: new THREE.MeshStandardMaterial({ color: '#69b94e', roughness: 1 }),
};
const lampMat = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff3c4', emissiveIntensity: 0 });
lampMat.name = 'lamp';
const mesh = (geo: THREE.BufferGeometry, m: THREE.Material) => {
  const o = new THREE.Mesh(geo, m);
  o.receiveShadow = true;
  return o;
};

// --- Yolların güzergâhları (orta çizgiler) ---
const ARM = ring.outer + 0.3; // kavşağın kolları burada başlar
const ROUTES = {
  west: path([[TUNNEL_END, HW.z0], [ring.x - ARM, HW.z0]]), // tünelden kavşağa (doğuya)
  south: path([[ring.x, HW.z0 + ARM], [HW.x, HW.z1], [HW.east, HW.z1]]), // kavşaktan güneye, sonra doğuya
  branch: path([[HW.x, HW.z1 - 3], [HW.x, HW.south]]), // ayrımdan güneye
  city: path([[ring.x + ARM, HW.z0], [CITY_X, HW.z0]]), // kavşaktan şehrin girişine
  ski: path(SKI_ROAD.map(([x, z], k) => (k === 0 ? [x, z - 0.3] : [x, z]) as [number, number]), 2.2),
};

// Otoban: asfalt, şerit çizgileri, ortada bariyer, kenarlarda korkuluk (köprüde beton korkuluk), aydınlatma direkleri
function motorway(pts: V2[], opts: { lamps?: boolean; skipMedian?: number } = {}) {
  const g = new THREE.Group();
  g.add(mesh(strip(pts, -MW, MW, Y), M.asphalt));
  for (const s of [-1, 1]) {
    g.add(mesh(strip(pts, s * 0.86 - 0.014, s * 0.86 + 0.014, Y + 0.001), M.line));
    g.add(mesh(strip(pts, s * 0.42 - 0.012, s * 0.42 + 0.012, Y + 0.001, [0.3, 0.45]), M.line));
    g.add(mesh(strip(pts, s * 0.075 - 0.01, s * 0.075 + 0.01, Y + 0.001), M.yellow));
  }
  // Ortada beton bariyer (kavşağa yakın uçlarda yok)
  const skip = opts.skipMedian ?? 0;
  const median = pts.slice(Math.ceil(skip / 0.35), pts.length - 2);
  if (median.length > 2) g.add(mesh(wall(median, 0, 0.07, Y, Y + 0.075), M.concrete));
  // Kenarlar: suyun üstünde beton korkuluk ve ayaklar, karada metal bariyer
  let run: V2[] = [];
  let water = false;
  const flush = () => {
    if (run.length > 1) {
      for (const s of [-1, 1]) {
        if (water) g.add(mesh(wall(run, s * (MW + 0.03), 0.06, Y - 0.04, Y + 0.11), M.concrete));
        else g.add(mesh(wall(run, s * (MW + 0.06), 0.012, Y + 0.035, Y + 0.075), M.rail));
      }
    }
    run = [run[run.length - 1]].filter(Boolean);
  };
  pts.forEach((p, k) => {
    const r = riverAt(p.x, p.y);
    const wet = !!r && r.d < r.half + 0.6;
    if (k > 0 && wet !== water) flush();
    water = wet;
    run.push(p);
    if (wet && k % 3 === 0) {
      // Köprü ayakları
      const n = normals(pts)[k];
      for (const s of [-0.55, 0.55]) g.add(part(new THREE.CylinderGeometry(0.07, 0.09, 0.7, 10), M.concrete, p.x + n.x * s, Y - 0.38, p.y + n.y * s));
    }
  });
  flush();
  // Bariyer direkleri ve aydınlatma
  const n = normals(pts);
  pts.forEach((p, k) => {
    if (p.x < HW.portal + 0.5) return; // tünelin içi
    if (k % 3 === 0) for (const s of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.018, 0.07, 0.018), M.pole, p.x + n[k].x * s * (MW + 0.06), Y + 0.035, p.y + n[k].y * s * (MW + 0.06)));
    if (opts.lamps !== false && k % 12 === 6 && k > skip / 0.35) {
      g.add(part(new THREE.CylinderGeometry(0.012, 0.016, 0.62, 8), M.pole, p.x, Y + 0.31, p.y));
      for (const s of [-1, 1]) {
        const arm = part(new THREE.BoxGeometry(0.34, 0.012, 0.016), M.pole, p.x + n[k].x * s * 0.17, Y + 0.61, p.y + n[k].y * s * 0.17);
        arm.rotation.y = Math.atan2(-n[k].y, n[k].x);
        g.add(arm);
        g.add(part(new THREE.BoxGeometry(0.06, 0.016, 0.03), lampMat, p.x + n[k].x * s * 0.33, Y + 0.6, p.y + n[k].y * s * 0.33));
      }
    }
  });
  return g;
}

// İki şeritli yol (şehrin girişine ve kayak merkezine): asfalt, orta çizgi, kenar çizgileri, bordür
function smallRoad(pts: V2[]) {
  const g = new THREE.Group();
  g.add(mesh(strip(pts, -SMALL, SMALL, Y), M.asphalt));
  g.add(mesh(strip(pts, -0.012, 0.012, Y + 0.001, [0.2, 0.2]), M.line));
  for (const s of [-1, 1]) {
    g.add(mesh(strip(pts, s * 0.3 - 0.01, s * 0.3 + 0.01, Y + 0.001), M.line));
    g.add(mesh(wall(pts, s * (SMALL + 0.02), 0.04, Y - 0.02, Y + 0.014), M.curb));
  }
  return g;
}

// Göbek kavşak: halka yol, ortada çimenli ada, çiçekler ve bayrak direkleri
function roundabout() {
  const g = new THREE.Group();
  const flat = (geo: THREE.BufferGeometry, m: THREE.Material, y: number) => {
    const o = mesh(geo.rotateX(-Math.PI / 2), m);
    o.position.set(ring.x, y, ring.z);
    g.add(o);
  };
  flat(new THREE.RingGeometry(1.55, ring.outer + 0.15, 64), M.asphalt, Y);
  flat(new THREE.RingGeometry(1.82, 1.85, 64), M.line, Y + 0.001);
  flat(new THREE.RingGeometry(ring.outer - 0.06, ring.outer - 0.03, 64), M.line, Y + 0.001);
  // Ada: bordür, çimen, çiçek tarhı ve bayraklar
  const island = new THREE.Group();
  island.position.set(ring.x, 0, ring.z);
  g.add(island);
  island.add(part(new THREE.CylinderGeometry(1.55, 1.55, 0.06, 48), M.curb, 0, 0.03, 0));
  island.add(part(new THREE.CylinderGeometry(1.48, 1.48, 0.065, 48), M.grass, 0, 0.035, 0));
  const flowers = ['#ff5c8a', '#ffd23f', '#ffffff', '#c77dff'];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    island.add(part(new THREE.IcosahedronGeometry(0.05, 0), mat(flowers[k % 4]), Math.cos(a) * 1.25, 0.09, Math.sin(a) * 1.25));
  }
  island.add(part(new THREE.CylinderGeometry(0.5, 0.55, 0.08, 24), mat('#d8d2c4'), 0, 0.08, 0));
  const flagColors = ['#e53935', '#1e88e5', '#43a047'];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * 0.3, z = Math.sin(a) * 0.3;
    island.add(part(new THREE.CylinderGeometry(0.01, 0.012, 0.9, 6), M.pole, x, 0.53, z));
    island.add(part(new THREE.BoxGeometry(0.004, 0.14, 0.22), mat(flagColors[k]), x, 0.88, z + 0.11));
  }
  return g;
}

// Tünel ağzı (doğuya bakar; ön yüzü x = 0'da), dört şeritli otobana göre geniş
function tunnelPortal() {
  const g = new THREE.Group();
  const stone = mat('#b3ada2');
  const dark = new THREE.MeshBasicMaterial({ color: '#121416' });
  const w = MW + 0.18;
  for (const z of [-w - 0.18, w + 0.18]) g.add(part(new THREE.BoxGeometry(0.35, 1.05, 0.36), stone, -0.17, 0.52, z));
  g.add(part(new THREE.BoxGeometry(0.35, 0.34, 2 * w + 0.72), stone, -0.17, 0.88, 0));
  g.add(part(new THREE.BoxGeometry(0.4, 0.07, 2 * w + 0.8), mat('#8f897e'), -0.17, 1.08, 0));
  for (const z of [-w, w]) g.add(part(new THREE.BoxGeometry(3, 0.75, 0.14), stone, -1.5, 0.37, z));
  const inside = new THREE.Mesh(new THREE.BoxGeometry(3, 0.72, 2 * w), dark);
  inside.position.set(-1.6, 0.36, 0);
  g.add(inside);
  for (let k = 0; k < 12; k++) g.add(part(new THREE.BoxGeometry(0.02, 0.08, (2 * w) / 12), mat(k % 2 ? '#222222' : '#f2c14e'), 0.005, 0.75, -w + (k + 0.5) * ((2 * w) / 12)));
  // Ağzın içinde sarı tünel lambaları
  for (const z of [-w + 0.1, w - 0.1]) for (let k = 0; k < 4; k++) g.add(part(new THREE.BoxGeometry(0.12, 0.02, 0.03), lampMat, -0.4 - k * 0.6, 0.62, z));
  return g;
}

// Otobanın üstünde yön tabelası (köprü şeklinde direkler, yeşil levhalar)
function signTexture(lines: string[]) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b7a3a';
  g.fillRect(0, 0, 256, 96);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 4;
  g.strokeRect(5, 5, 246, 86);
  g.fillStyle = '#ffffff';
  g.font = 'bold 30px Fredoka, Arial, sans-serif';
  g.textAlign = 'center';
  lines.forEach((t, k) => g.fillText(t, 128, 40 + k * 36));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function gantry(x: number, z: number) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(part(new THREE.CylinderGeometry(0.02, 0.025, 0.8, 8), M.pole, x, 0.4, z + s * (MW + 0.12)));
  g.add(part(new THREE.BoxGeometry(0.05, 0.05, 2 * MW + 0.3), M.pole, x, 0.78, z));
  const board = (lines: string[], dz: number) => {
    const m = new THREE.MeshStandardMaterial({ map: signTexture(lines), roughness: 0.6 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.24, 0.66), [M.pole, m, M.pole, M.pole, M.pole, M.pole]);
    b.position.set(x + 0.03, 0.66, z + dz);
    g.add(b);
  };
  board(['AKSOY CITY', '→ Merkez'], 0.42);
  board(['↑ Kayak', '↓ Otoban'], -0.42);
  return g;
}

export function buildHighway() {
  const parts: THREE.Object3D[] = [];
  parts.push(motorway(ROUTES.west, { skipMedian: 0 }));
  parts.push(motorway(ROUTES.south, { skipMedian: 1.5 }));
  const branch = motorway(ROUTES.branch, { skipMedian: 6, lamps: false });
  branch.position.y = -0.002;
  parts.push(branch);
  parts.push(smallRoad(ROUTES.city), smallRoad(ROUTES.ski), roundabout());
  // Otobanın kavşağa açılan ucunda, ortadaki bariyerin başında sarı-siyah uyarı bloğu
  const portal = tunnelPortal();
  portal.position.set(HW.portal, 0, HW.z0);
  parts.push(portal);
  parts.push(gantry(-37.5, HW.z0));
  return mergeStatic(parts);
}

// --- Trafik ---

// Bir şerit boyunca konum: noktalar ve uzunluk
class Lane {
  readonly pts: V2[];
  readonly acc: number[] = [0];
  readonly length: number;
  constructor(pts: V2[]) {
    this.pts = pts;
    for (let k = 1; k < pts.length; k++) this.acc.push(this.acc[k - 1] + pts[k].distanceTo(pts[k - 1]));
    this.length = this.acc[this.acc.length - 1];
  }
  at(s: number, out: THREE.Vector3) {
    let lo = 0, hi = this.acc.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.acc[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo], b = this.pts[hi];
    const t = THREE.MathUtils.clamp((s - this.acc[lo]) / Math.max(1e-6, this.acc[hi] - this.acc[lo]), 0, 1);
    out.set(a.x + (b.x - a.x) * t, CAR_Y, a.y + (b.y - a.y) * t);
    return Math.atan2(b.x - a.x, b.y - a.y);
  }
}

// Göbek kavşakta bir koldan ötekine (saat yönünün tersine döner). Açılar haritada: doğu 0, kuzey π/2, batı π, güney 3π/2
const ARMS = { east: 0, north: Math.PI / 2, west: Math.PI, south: (3 * Math.PI) / 2 };
function ringPath(from: number, to: number, laneIn: number, laneOut: number): V2[] {
  const C = v2(ring.x, ring.z);
  const u = (a: number) => v2(Math.cos(a), -Math.sin(a));
  const right = (h: V2) => v2(-h.y, h.x);
  const onRing = (a: number) => C.clone().add(u(a).multiplyScalar(ring.r));
  const tangent = (a: number) => v2(-Math.sin(a), -Math.cos(a));
  const hin = u(from).negate();
  const e0 = C.clone().add(u(from).multiplyScalar(ARM)).add(right(hin).multiplyScalar(laneIn));
  const x0 = C.clone().add(u(to).multiplyScalar(ARM)).add(right(u(to)).multiplyScalar(laneOut));
  const a0 = from + 0.45;
  let a1 = to - 0.45;
  while (a1 <= a0) a1 += Math.PI * 2;
  const out: V2[] = [];
  const quad = (p0: V2, p1: V2, p2: V2) => {
    for (let s = 0; s < 10; s++) {
      const t = s / 10, w = 1 - t;
      out.push(v2(0, 0).addScaledVector(p0, w * w).addScaledVector(p1, 2 * w * t).addScaledVector(p2, t * t));
    }
  };
  quad(e0, e0.clone().addScaledVector(hin, 0.8), onRing(a0));
  const n = Math.max(4, Math.ceil(((a1 - a0) * ring.r) / 0.25));
  for (let k = 0; k < n; k++) out.push(onRing(a0 + ((a1 - a0) * k) / n));
  quad(onRing(a1), onRing(a1).addScaledVector(tangent(a1), 0.8), x0);
  out.push(x0);
  return out;
}

interface Car {
  route: number;
  s: number;
  speed: number;
  type: number;
  paint: THREE.Color;
  v: number; // şu anki hız
  pos: THREE.Vector3;
  h: number;
  fade: number;
}
interface Route {
  lane: Lane;
  slow: Float32Array; // her noktada en yüksek hız (kavşakta yavaş)
  fadeIn: boolean;
  fadeOut: boolean;
}

// Otobanda ve kavşakta akan trafik: tünelden çıkan, şehre giren, şehirden çıkıp otobana katılan,
// kayak merkezine giden arabalar. Önündeki arabaya yaklaşan yavaşlar; kavşakta yol verir.
export class HighwayTraffic {
  readonly root = new THREE.Group();
  private routes: Route[] = [];
  private cars: Car[] = [];
  private set: CarSet | null = null;
  private tmp = new THREE.Object3D();

  init() {
    const rev = (p: V2[]) => [...p].reverse();
    const W = ROUTES.west, S = ROUTES.south, B = path([[HW.x, HW.z0 + ARM], [HW.x, HW.south]]);
    const defs: { parts: { pts: V2[]; v: number }[]; fadeIn?: boolean; fadeOut?: boolean; cars: number }[] = [];
    for (const o of LANES) {
      const k = LANES.indexOf(o);
      // Tünel <-> güney/doğu
      defs.push({ cars: 5, parts: [{ pts: offset(W, o), v: 3 }, { pts: ringPath(ARMS.west, ARMS.south, o, o), v: 1.1 }, { pts: offset(S, o), v: 3 }] });
      defs.push({ cars: 5, parts: [{ pts: offset(rev(S), o), v: 3 }, { pts: ringPath(ARMS.south, ARMS.west, o, o), v: 1.1 }, { pts: offset(rev(W), o), v: 3 }] });
      // Tünel <-> güneydeki tepeler; doğu <-> güney
      defs.push({ cars: 2, parts: [{ pts: offset(W, o), v: 3 }, { pts: ringPath(ARMS.west, ARMS.south, o, o), v: 1.1 }, { pts: offset(B, o), v: 3 }] });
      defs.push({ cars: 2 + k, parts: [{ pts: offset(rev(B), o), v: 3 }, { pts: ringPath(ARMS.south, ARMS.west, o, o), v: 1.1 }, { pts: offset(rev(W), o), v: 3 }] });
    }
    // Tünelden şehre ve şehirden otobana; kayak merkezine gidip gelenler
    defs.push({ cars: 3, fadeOut: true, parts: [{ pts: offset(W, LANES[1]), v: 3 }, { pts: ringPath(ARMS.west, ARMS.east, LANES[1], SMALL_LANE), v: 1.1 }, { pts: offset(ROUTES.city, SMALL_LANE), v: 1.3 }] });
    defs.push({ cars: 3, fadeIn: true, parts: [{ pts: offset(rev(ROUTES.city), SMALL_LANE), v: 1.3 }, { pts: ringPath(ARMS.east, ARMS.south, SMALL_LANE, LANES[1]), v: 1.1 }, { pts: offset(S, LANES[1]), v: 3 }] });
    defs.push({ cars: 2, fadeOut: true, parts: [{ pts: offset(W, LANES[1]), v: 3 }, { pts: ringPath(ARMS.west, ARMS.north, LANES[1], SMALL_LANE), v: 1.1 }, { pts: offset(ROUTES.ski, SMALL_LANE), v: 1.3 }] });
    defs.push({ cars: 2, fadeIn: true, parts: [{ pts: offset(rev(ROUTES.ski), SMALL_LANE), v: 1.3 }, { pts: ringPath(ARMS.north, ARMS.west, SMALL_LANE, LANES[1]), v: 1.1 }, { pts: offset(rev(W), LANES[1]), v: 3 }] });

    for (const def of defs) {
      const pts: V2[] = [];
      const caps: number[] = [];
      for (const p of def.parts) {
        for (const q of p.pts) {
          pts.push(q);
          caps.push(p.v);
        }
      }
      // Arka arkaya aynı noktalar olmasın
      const clean: V2[] = [], cc: number[] = [];
      pts.forEach((p, k) => {
        if (!clean.length || clean[clean.length - 1].distanceTo(p) > 1e-3) {
          clean.push(p);
          cc.push(caps[k]);
        }
      });
      const lane = new Lane(clean);
      this.routes.push({ lane, slow: new Float32Array(cc), fadeIn: !!def.fadeIn, fadeOut: !!def.fadeOut });
      const r = this.routes.length - 1;
      for (let k = 0; k < def.cars; k++) {
        const type = CAR_KINDS.indexOf(NORMAL_CARS[Math.floor(Math.random() * NORMAL_CARS.length)]);
        this.cars.push({ route: r, s: ((k + Math.random() * 0.4) / def.cars) * lane.length, speed: 0.85 + Math.random() * 0.3, type, paint: carPaint(CAR_KINDS[type]), v: 0, pos: new THREE.Vector3(), h: 0, fade: 1 });
      }
    }
    this.set = new CarSet(CAR_KINDS, this.cars.length);
    this.root.add(this.set.root);
  }

  // Yolun o noktasındaki hız sınırı
  private cap(route: Route, s: number) {
    const lane = route.lane;
    let lo = 0, hi = lane.acc.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lane.acc[mid] <= s) lo = mid;
      else hi = mid;
    }
    // Kavşağa yaklaşırken önceden yavaşla
    let v = route.slow[lo];
    for (let k = lo; k < Math.min(route.slow.length, lo + 8); k++) v = Math.min(v, route.slow[k] + (lane.acc[k] - s) * 1.2);
    return v;
  }

  update(dt: number) {
    const set = this.set;
    if (!set) return;
    for (const c of this.cars) c.h = this.routes[c.route].lane.at(c.s, c.pos);
    set.begin();
    this.cars.forEach((car, ci) => {
      const route = this.routes[car.route];
      let v = this.cap(route, car.s) * car.speed;
      // Önündeki araç (aynı ya da başka yoldan gelen): yavaşla ya da dur
      const fx = Math.sin(car.h), fz = Math.cos(car.h);
      for (const o of this.cars) {
        if (o === car) continue;
        const rx = o.pos.x - car.pos.x, rz = o.pos.z - car.pos.z;
        const ahead = rx * fx + rz * fz;
        if (ahead <= 0.02 || ahead > 1.2) continue;
        if (Math.abs(rx * fz - rz * fx) > 0.16) continue;
        // İkisi birbirini bekliyorsa (kavşakta) biri geçsin, kilitlenmesin
        const ox = Math.sin(o.h), oz = Math.cos(o.h);
        const back = -rx * ox - rz * oz;
        if (back > 0.02 && back < 1.2 && Math.abs(-rx * oz + rz * ox) < 0.16 && ci < this.cars.indexOf(o)) continue;
        v = Math.min(v, Math.max(0, (ahead - 0.45) * 3));
      }
      car.v += (v - car.v) * Math.min(1, dt * 3);
      car.s += car.v * dt;
      if (car.s > route.lane.length) car.s = 0;
      const fadeIn = route.fadeIn ? THREE.MathUtils.smoothstep(car.s, 0, 1.2) : 1;
      const fadeOut = route.fadeOut ? THREE.MathUtils.smoothstep(route.lane.length - car.s, 0, 1.2) : 1;
      car.fade = Math.min(fadeIn, fadeOut);
      this.tmp.rotation.y = route.lane.at(car.s, this.tmp.position);
      this.tmp.scale.setScalar(CAR_SCALE * car.fade);
      this.tmp.updateMatrix();
      set.put(car.type, this.tmp.matrix, car.paint);
    });
    set.end();
  }
}
