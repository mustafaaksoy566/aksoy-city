import * as THREE from 'three';
import { ROAD_COLORS } from './assets';
import { mergeStatic, bakeModel, vertexColorMat } from './batcher';
import { makeBus } from './sky';
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
const CITY_LANE = 0.26; // şehre giren yolda (cadde ve bulvarda da şeridin ortası)
const TUNNEL_END = -60; // arabalar dağın içinde (tünelde) başlar/biter
const { ring, clover } = HW;
const CITY_X = -24; // şehrin girişi: şehirdeki ilk yol karesinin başı (araba orada şehir trafiğine geçer)
const LINK_X = -26; // buradan şehre kadar yol, şehirdeki yol parçalarıyla çizilir (main.ts entranceRoad)

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

// Noktaları, keep(k) doğru olan ardışık parçalara böl (kavşak ağzında bariyer ve kenar çizgisinde boşluk için)
function pieces(pts: V2[], hs: number[], keep: (k: number) => boolean) {
  const out: { pts: V2[]; hs: number[] }[] = [];
  let cur: { pts: V2[]; hs: number[] } = { pts: [], hs: [] };
  pts.forEach((p, k) => {
    if (keep(k)) {
      cur.pts.push(p);
      cur.hs.push(hs[k]);
    } else {
      if (cur.pts.length > 1) out.push(cur);
      cur = { pts: [], hs: [] };
    }
  });
  if (cur.pts.length > 1) out.push(cur);
  return out;
}

// Yere yatık şerit (a..b arası), istenirse kesik kesik (dash: [dolu, boş] uzunluk); hs: her noktada yükseklik (köprü, rampa)
function strip(pts: V2[], a: number, b: number, y: number, dash?: [number, number], hs?: number[]) {
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
    for (const j of [k, k + 1]) for (const o of [a, b]) pos.push(pts[j].x + n[j].x * o, y + (hs?.[j] ?? 0), pts[j].y + n[j].y * o);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  return geo;
}

// Dik duvar şeridi (bariyer, korkuluk): o merkezinde, t kalınlığında, y0..y1 arası
// hs: her noktada yükseklik (üst kenara eklenir; ground true ise alt kenar yerde kalır: köprü yan yüzü)
function wall(pts: V2[], o: number, t: number, y0: number, y1: number, hs?: number[], ground = false) {
  const n = normals(pts);
  const pos: number[] = [];
  const idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  };
  for (let k = 0; k < pts.length - 1; k++) {
    const h0 = hs?.[k] ?? 0, h1 = hs?.[k + 1] ?? 0;
    const lo0 = ground ? y0 : y0 + h0, lo1 = ground ? y0 : y0 + h1;
    const P = (j: number, off: number, y: number) => [pts[j].x + n[j].x * off, y, pts[j].y + n[j].y * off];
    for (const side of [-t / 2, t / 2]) quad(P(k, o + side, lo0), P(k, o + side, y1 + h0), P(k + 1, o + side, lo1), P(k + 1, o + side, y1 + h1));
    quad(P(k, o - t / 2, y1 + h0), P(k, o + t / 2, y1 + h0), P(k + 1, o - t / 2, y1 + h1), P(k + 1, o + t / 2, y1 + h1));
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
  south: path([[ring.x, HW.z0 + ARM], [HW.x, HW.south]]), // kavşaktan güneye: kelebek kavşağın altından geçer
  cross: path([[HW.west, HW.z1], [HW.east, HW.z1]]), // batıdan doğuya: kelebek kavşakta köprüyle üstten geçer
  city: path([[ring.x + ARM, HW.z0], [CITY_X, HW.z0]]), // kavşaktan şehrin girişine
  ski: path(SKI_ROAD.map(([x, z], k) => (k === 0 ? [x, z - 0.3] : [x, z]) as [number, number]), 2.2),
};

// Otoban: asfalt, şerit çizgileri, ortada bariyer, kenarlarda korkuluk (köprüde beton korkuluk), aydınlatma direkleri
function motorway(pts: V2[], opts: { lamps?: boolean; trim?: [number, number]; height?: (p: V2) => number; noLamp?: (p: V2) => boolean; clear?: (p: V2) => boolean; open?: (q: V2) => boolean } = {}) {
  const g = new THREE.Group();
  const hs = pts.map(p => opts.height?.(p) ?? 0);
  const nn = normals(pts);
  // s tarafındaki kenar o noktada açık mı (rampa ya da göbek kavşağın ağzı bağlanıyor)
  const open = (k: number, s: number) => !!opts.open?.(v2(pts[k].x + nn[k].x * s * MW, pts[k].y + nn[k].y * s * MW));
  // trim: baştan ve sondan bu kadar (göbek kavşağın ayırıcı adacığı) orta bariyer ve sarı çizgi yok
  const [t0, t1] = opts.trim ?? [0, 0.7];
  const a = Math.ceil(t0 / 0.35), b = pts.length - Math.max(2, Math.ceil(t1 / 0.35));
  const middle = pts.slice(a, b), mh = hs.slice(a, b);
  g.add(mesh(strip(pts, -MW, MW, Y, undefined, hs), M.asphalt));
  for (const s of [-1, 1]) {
    for (const pc of pieces(pts, hs, k => !open(k, s))) g.add(mesh(strip(pc.pts, s * 0.86 - 0.014, s * 0.86 + 0.014, Y + 0.001, undefined, pc.hs), M.line));
    g.add(mesh(strip(pts, s * 0.42 - 0.012, s * 0.42 + 0.012, Y + 0.001, [0.3, 0.45], hs), M.line));
    if (middle.length > 1) g.add(mesh(strip(middle, s * 0.075 - 0.01, s * 0.075 + 0.01, Y + 0.001, undefined, mh), M.yellow));
  }
  const skip = t0;
  if (middle.length > 2) g.add(mesh(wall(middle, 0, 0.07, Y, Y + 0.075, mh), M.concrete));
  // Kenarlar: suyun üstünde beton korkuluk ve ayaklar, karada metal bariyer
  let run: V2[] = [];
  let rh: number[] = [];
  let ri: number[] = [];
  let water = false;
  const flush = () => {
    if (run.length > 1) {
      for (const s of [-1, 1]) {
        // Rampa ya da kavşak ağzının bağlandığı yerde korkuluk yok
        for (const pc of pieces(run, rh, k => !open(ri[k], s))) {
          if (water) g.add(mesh(wall(pc.pts, s * (MW + 0.03), 0.06, Y - 0.04, Y + 0.11, pc.hs), M.concrete));
          else g.add(mesh(wall(pc.pts, s * (MW + 0.06), 0.012, Y + 0.035, Y + 0.075, pc.hs), M.rail));
        }
        if (water) {
          // Yükseltilmiş yolun yan yüzü (yere kadar)
          // Altından yol geçen yerde (clear) yan yüz yok
          let seg: V2[] = [], sh: number[] = [];
          const skirt = () => {
            if (seg.length > 1 && sh.some(h => h > 0.01)) g.add(mesh(wall(seg, s * (MW + 0.005), 0.012, 0, Y - 0.02, sh, true), M.concrete));
            seg = [];
            sh = [];
          };
          run.forEach((p, k) => {
            if (opts.clear?.(p) || open(ri[k], s)) return skirt();
            seg.push(p);
            sh.push(rh[k]);
          });
          skirt();
        }
      }
    }
    run = [run[run.length - 1]].filter(Boolean);
    rh = [rh[rh.length - 1]].filter(h => h !== undefined);
    ri = [ri[ri.length - 1]].filter(i => i !== undefined);
  };
  pts.forEach((p, k) => {
    const r = riverAt(p.x, p.y);
    const wet = (!!r && r.d < r.half + 0.6) || hs[k] > 0.03;
    if (k > 0 && wet !== water) flush();
    water = wet;
    run.push(p);
    rh.push(hs[k]);
    ri.push(k);
    if (wet && k % 3 === 0) {
      // Köprü ayakları (nehirde suya, kavşakta yere iner)
      const n = normals(pts)[k];
      const top = Y - 0.03 + hs[k];
      const bottom = r && r.d < r.half + 0.6 ? Y - 0.73 : 0;
      if (top - bottom > 0.08 && !opts.clear?.(p)) for (const s of [-0.55, 0.55]) g.add(part(new THREE.CylinderGeometry(0.07, 0.09, top - bottom, 10), M.concrete, p.x + n.x * s, (top + bottom) / 2, p.y + n.y * s));
    }
  });
  flush();
  // Bariyer direkleri ve aydınlatma
  const n = normals(pts);
  pts.forEach((p, k) => {
    if (p.x < HW.portal + 0.5) return; // tünelin içi
    const h = hs[k];
    if (k % 3 === 0 && h < 0.03) for (const s of [-1, 1]) if (!open(k, s)) g.add(part(new THREE.BoxGeometry(0.018, 0.07, 0.018), M.pole, p.x + n[k].x * s * (MW + 0.06), Y + 0.035, p.y + n[k].y * s * (MW + 0.06)));
    if (opts.lamps !== false && k % 12 === 6 && k > skip / 0.35 && !opts.noLamp?.(p)) {
      g.add(part(new THREE.CylinderGeometry(0.012, 0.016, 0.62, 8), M.pole, p.x, Y + 0.31 + h, p.y));
      for (const s of [-1, 1]) {
        const arm = part(new THREE.BoxGeometry(0.34, 0.012, 0.016), M.pole, p.x + n[k].x * s * 0.17, Y + 0.61 + h, p.y + n[k].y * s * 0.17);
        arm.rotation.y = Math.atan2(-n[k].y, n[k].x);
        g.add(arm);
        g.add(part(new THREE.BoxGeometry(0.06, 0.016, 0.03), lampMat, p.x + n[k].x * s * 0.33, Y + 0.6 + h, p.y + n[k].y * s * 0.33));
      }
    }
  });
  return g;
}

// İki şeritli yol (şehrin girişine ve kayak merkezine): asfalt, orta çizgi, kenar çizgileri, bordür
// Göbek kavşağın ağzında (yolun genişlediği kısım) kenar çizgisi ve bordür, ayırıcı adacığa kadar orta çizgi çizilmez
const ringDist = (p: V2) => Math.hypot(p.x - ring.x, p.y - ring.z);
const edgeParts = (pts: V2[]) => pieces(pts, pts.map(() => 0), k => ringDist(pts[k]) > ring.outer + 1.0);
const midParts = (pts: V2[]) => pieces(pts, pts.map(() => 0), k => ringDist(pts[k]) > ring.outer + 1.15);
function smallRoad(pts: V2[]) {
  const g = new THREE.Group();
  g.add(mesh(strip(pts, -SMALL, SMALL, Y), M.asphalt));
  for (const pc of midParts(pts)) g.add(mesh(strip(pc.pts, -0.012, 0.012, Y + 0.001, [0.2, 0.2]), M.line));
  for (const s of [-1, 1]) {
    for (const pc of edgeParts(pts)) {
      g.add(mesh(strip(pc.pts, s * 0.3 - 0.01, s * 0.3 + 0.01, Y + 0.001), M.line));
      g.add(mesh(wall(pc.pts, s * (SMALL + 0.02), 0.04, Y - 0.02, Y + 0.014), M.curb));
    }
  }
  return g;
}

// Dünya koordinatında (x, z) verilen çokgen: düz yüzey ya da yükseltilmiş (depth > 0)
function poly(points: V2[], m: THREE.Material, y: number, depth = 0) {
  const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, -p.y)));
  const geo = depth > 0 ? new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const o = mesh(geo, m);
  o.position.y = y;
  if (depth > 0) o.castShadow = true;
  return o;
}

// --- Kelebek (yonca yaprağı) kavşak ---
// Kuzey-güney otobanı (A) yerde düz gider; batı-doğu otobanı (B) ortada köprüyle üstünden geçer.
// Dört köşede 270° dönen döngü rampa (sola dönüş) ve dışında sağa dönüş rampası var. Sağdan gidiş.
const CL = { x: clover.x, z: clover.z };
const BRIDGE_H = 0.55; // köprünün yüksekliği
const BRIDGE_HALF = 1.3; // köprünün düz kısmının yarı boyu
const APPROACH = 4.2; // köprüye çıkan rampanın boyu
const LOOP_R = 1.7; // döngü rampanın yarıçapı
// B yolunun o noktadaki yüksekliği (ortada en yüksek, iki yanda yere iner)
const bHeight = (x: number) => BRIDGE_H * THREE.MathUtils.smoothstep(BRIDGE_HALF + APPROACH - Math.abs(x - CL.x), 0, APPROACH);
const onB = (p: V2) => Math.abs(p.y - CL.z) < Math.abs(p.x - CL.x); // uç nokta B'nin şeridinde mi?
// Kuzeybatı köşesindeki rampalar (kavşağın ortasına göre); diğer köşeler 90° döndürülerek bulunur
function cloverQuadrant(k: number) {
  const o = LANES[1];
  const rot = (x: number, z: number) => {
    for (let r = 0; r < k; r++) [x, z] = [-z, x];
    return v2(CL.x + x, CL.z + z);
  };
  const c = [-o - LOOP_R, -o - LOOP_R];
  // Döngü: batıya giden (B) şeritten çıkar, 270° dönüp güneye giden (A) şeride katılır
  const loop: V2[] = [];
  for (let s = 0; s <= 40; s++) {
    const a = Math.PI / 2 + (s / 40) * 1.5 * Math.PI;
    loop.push(rot(c[0] + Math.cos(a) * LOOP_R, c[1] + Math.sin(a) * LOOP_R));
  }
  // Dış rampa: güneye giden (A) şeritten önce ayrılır, döngünün dışından dolaşıp batıya giden (B) şeride katılır
  const r = LOOP_R + 0.95;
  const ctrl: [number, number][] = [
    [-o, -o - LOOP_R - 3.6], [-o - 0.12, -o - LOOP_R - 2.4],
    ...[262, 244, 225, 206, 188].map(d => [c[0] + Math.cos((d * Math.PI) / 180) * r, c[1] + Math.sin((d * Math.PI) / 180) * r] as [number, number]),
    [-o - LOOP_R - 2.4, -o - 0.12], [-o - LOOP_R - 3.6, -o],
  ];
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const outer = curve.getSpacedPoints(48).map(p => rot(p.x, p.z));
  return { loop, outer };
}
// Rampanın her noktasındaki yükseklik: uçları bağlandığı yolun yüksekliğinde, arası yumuşak geçiş
function rampHeights(pts: V2[]) {
  const end = (p: V2) => (onB(p) ? bHeight(p.x) : 0);
  const h0 = end(pts[0]), h1 = end(pts[pts.length - 1]);
  const acc = [0];
  for (let k = 1; k < pts.length; k++) acc.push(acc[k - 1] + pts[k].distanceTo(pts[k - 1]));
  const L = acc[acc.length - 1];
  return acc.map(s => h0 + (h1 - h0) * THREE.MathUtils.smoothstep(s / L, 0, 1));
}
// Tek şeritli rampa: asfalt, kenar çizgileri; yüksekte beton korkuluk, yan yüz ve ayaklar
function rampRoad(pts: V2[]) {
  const g = new THREE.Group();
  const hs = rampHeights(pts);
  const W = 0.26;
  g.add(mesh(strip(pts, -W, W, Y + 0.0004, undefined, hs), M.asphalt));
  // Uçlar ana yolun asfaltına karışır: otobanın içinde kalan kısımda çizgi ve korkuluk yok
  const outside = (k: number) => Math.abs(pts[k].x - CL.x) > MW + 0.12 && Math.abs(pts[k].y - CL.z) > MW + 0.12;
  for (const pc of pieces(pts, hs, outside)) {
    for (const s of [-1, 1]) {
      g.add(mesh(strip(pc.pts, s * 0.2 - 0.012, s * 0.2 + 0.012, Y + 0.0014, undefined, pc.hs), M.line));
      g.add(mesh(wall(pc.pts, s * (W + 0.02), 0.04, Y - 0.01, Y + 0.06, pc.hs), M.concrete));
      g.add(mesh(wall(pc.pts, s * (W + 0.005), 0.012, 0, Y - 0.01, pc.hs, true), M.concrete));
    }
  }
  pts.forEach((p, k) => {
    if (k % 5 || hs[k] < 0.15) return;
    g.add(part(new THREE.CylinderGeometry(0.05, 0.065, hs[k] + Y - 0.02, 8), M.concrete, p.x, (hs[k] + Y - 0.02) / 2, p.y));
  });
  return g;
}
// Rampaların otobanların kenarına bağlandığı noktalar (oralarda otobanın bariyeri ve kenar çizgisi açılır)
let touches: V2[] | null = null;
function cloverTouches() {
  if (touches) return touches;
  touches = [];
  for (let k = 0; k < 4; k++) {
    const q = cloverQuadrant(k);
    for (const p of [...q.loop, ...q.outer]) {
      const dx = Math.abs(p.x - CL.x), dz = Math.abs(p.y - CL.z);
      if ((Math.abs(dx - MW) < 0.3 && dz > MW) || (Math.abs(dz - MW) < 0.3 && dx > MW)) touches.push(p);
    }
  }
  return touches;
}
const cloverOpen = (q: V2) => cloverTouches().some(t => t.distanceTo(q) < 0.5);
const ringOpen = (q: V2) => Math.hypot(q.x - ring.x, q.y - ring.z) < ring.outer + 0.95;

function cloverleaf() {
  const g = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const q = cloverQuadrant(k);
    g.add(rampRoad(q.loop), rampRoad(q.outer));
    // Döngünün içinde çiçek tarhı ve ağaç gibi süs: düz çimen üstünde birkaç servi
    const center = q.loop.reduce((s, p) => s.add(p), v2(0, 0)).multiplyScalar(1 / q.loop.length);
    for (let t = 0; t < 3; t++) {
      const a = (t / 3) * Math.PI * 2 + k;
      const x = center.x + Math.cos(a) * 0.55, z = center.y + Math.sin(a) * 0.55;
      g.add(part(new THREE.CylinderGeometry(0.025, 0.035, 0.16, 6), mat('#6b4a33'), x, 0.08, z));
      g.add(part(new THREE.ConeGeometry(0.13, 0.5, 7), mat('#3f8a3a'), x, 0.4, z));
    }
  }
  // Köprünün altında orta ayak sırası ve kirişler
  for (const dx of [-1.12, 1.12]) {
    g.add(part(new THREE.BoxGeometry(0.16, BRIDGE_H + Y - 0.03, 1.5), M.concrete, CL.x + dx, (BRIDGE_H + Y - 0.03) / 2, CL.z));
  }
  g.add(part(new THREE.BoxGeometry(2.4, 0.06, 1.9), M.concrete, CL.x, BRIDGE_H + Y - 0.06, CL.z));
  return g;
}

// Kavşağın kolları: açı (haritada doğu 0, kuzey π/2), yolun yarı genişliği, otoban mı
const MOUTHS = [
  { a: Math.PI, w: MW, big: true }, // batı: tünelden gelen otoban
  { a: (3 * Math.PI) / 2, w: MW, big: true }, // güney otoban
  { a: 0, w: SMALL, big: false }, // doğu: şehre giden yol
  { a: Math.PI / 2, w: SMALL, big: false }, // kuzey: kayak yolu
];
const FLARE = 0.5; // kol kavşağa girerken bu kadar genişler

// Şehre giren yol: şehrin girişindeki yolla aynı türde (0 yol, 1 bulvar, 2 cadde) çizilir ki sınırda birden değişmesin
function cityRoad(pts: V2[], grade: number) {
  if (grade === 0) return smallRoad(pts);
  const g = new THREE.Group();
  g.add(mesh(strip(pts, -SMALL, SMALL, Y), M.asphalt));
  for (const s of [-1, 1]) {
    for (const pc of edgeParts(pts)) {
      g.add(mesh(wall(pc.pts, s * (SMALL + 0.02), 0.04, Y - 0.02, Y + 0.014), M.curb));
      g.add(mesh(strip(pc.pts, s * 0.39 - 0.01, s * 0.39 + 0.01, Y + 0.001), M.line));
    }
  }
  const mid = midParts(pts);
  if (grade === 2) {
    // Cadde: ortada beton bariyer ve sarı çizgiler, şeritler arasında kesik çizgi
    for (const pc of mid) {
      g.add(mesh(wall(pc.pts, 0, 0.035, Y, Y + 0.03), M.concrete));
      for (const s of [-1, 1]) g.add(mesh(strip(pc.pts, s * 0.035 - 0.008, s * 0.035 + 0.008, Y + 0.001), M.yellow));
    }
    for (const s of [-1, 1]) g.add(mesh(strip(pts, s * 0.2 - 0.008, s * 0.2 + 0.008, Y + 0.001, [0.16, 0.17]), M.line));
  } else {
    // Bulvar: ortada çimenli refüj
    for (const pc of mid) {
      g.add(mesh(wall(pc.pts, 0, 0.12, Y, Y + 0.02), M.curb));
      g.add(mesh(strip(pc.pts, -0.05, 0.05, Y + 0.0205), M.grass));
    }
  }
  return g;
}

// Göbek kavşak: halka yol, kollar kavşağa yaklaşırken kavisle genişleyip halkaya birleşir.
// Girişlerde "yol ver" çizgisi, gidiş ile geliş arasında ayırıcı adacık; ortada çimenli ada, çiçekler, bayraklar.
function roundabout() {
  const g = new THREE.Group();
  const C = v2(ring.x, ring.z);
  const flat = (geo: THREE.BufferGeometry, m: THREE.Material, y: number) => {
    const o = mesh(geo.rotateX(-Math.PI / 2), m);
    o.position.set(ring.x, y, ring.z);
    g.add(o);
  };
  const inner = 1.4;
  flat(new THREE.RingGeometry(inner, ring.outer, 72), M.asphalt, Y);
  flat(new THREE.RingGeometry(inner + 0.1, inner + 0.13, 72), M.line, Y + 0.001);
  // Halkada iki şeridi ayıran kesik çizgi
  const midR = (inner + 0.13 + ring.outer - 0.08) / 2;
  for (let k = 0; k < 44; k++) flat(new THREE.RingGeometry(midR - 0.012, midR + 0.012, 3, 1, (k / 44) * Math.PI * 2, 0.07), M.line, Y + 0.001);
  // Dış kenar çizgisi: kolların ağızlarında boşluk bırakır
  const gaps = MOUTHS.map(m => ({ a: m.a, half: Math.asin(Math.min(0.99, (m.w + FLARE - (m.big ? 0.06 : 0.15)) / (ring.outer - 0.065))) })).sort((p, q) => p.a - q.a);
  gaps.forEach((gp, k) => {
    const next = gaps[(k + 1) % gaps.length];
    const start = gp.a + gp.half;
    let end = next.a - next.half;
    if (end <= start) end += Math.PI * 2;
    flat(new THREE.RingGeometry(ring.outer - 0.08, ring.outer - 0.05, 24, 1, start, end - start), M.line, Y + 0.001);
  });
  for (const mouth of MOUTHS) {
    const u = v2(Math.cos(mouth.a), -Math.sin(mouth.a));
    const p = v2(-u.y, u.x);
    const at = (d: number, l: number) => C.clone().addScaledVector(u, d).addScaledVector(p, l);
    // Genişleyen ağız: kolun ucundan halkanın içine kadar asfalt
    // Kenar, halkanın dış çemberine değdiği yerde biter (taşmaz)
    const d1 = ARM + 0.7;
    const meet = Math.sqrt(Math.max(0, ring.outer * ring.outer - (mouth.w + FLARE) * (mouth.w + FLARE)));
    const width = (d: number) => mouth.w + FLARE * Math.pow(THREE.MathUtils.clamp((d1 - d) / (d1 - meet), 0, 1), 2);
    const left: V2[] = [], right: V2[] = [];
    for (let k = 0; k <= 14; k++) {
      const d = d1 - ((d1 - meet) * k) / 14;
      left.push(at(d, width(d)));
      right.push(at(d, -width(d)));
    }
    g.add(poly([...left, at(1.6, 0), ...right.reverse()], M.asphalt, Y - 0.0006));
    // Kenar çizgileri ağzın kavsini izler, halkanın çizgisine kadar
    const edge = mouth.big ? 0.06 : 0.15;
    for (const s of [-1, 1]) {
      const line: V2[] = [];
      for (let k = 0; k <= 14; k++) {
        const d = d1 - ((d1 - meet) * k) / 14;
        const l = width(d) - edge;
        // Halkanın içine girmesin
        const r = Math.hypot(d, l);
        if (r < ring.outer - 0.065) break;
        line.push(at(d, s * l));
      }
      if (line.length > 1) g.add(mesh(strip(line, -0.013, 0.013, Y + 0.0012), M.line));
    }
    // "Yol ver" çizgisi: gelen şeritlerin önünde kesik çizgi (gelen taraf -p yönünde)
    for (let l = 0.08; l < mouth.w - 0.05; l += 0.13) {
      const q = at(ring.outer + 0.04, -l);
      const dash = part(new THREE.BoxGeometry(0.07, 0.003, 0.035), M.line, q.x, Y + 0.0015, q.y);
      dash.rotation.y = Math.atan2(u.x, u.y);
      g.add(dash);
    }
    // Ayırıcı adacık: gidiş ile gelişin arasında, kavşağa doğru genişleyen üçgen
    const base = mouth.big ? 0.19 : 0.11, len = mouth.big ? 1.5 : 0.9;
    const tri = [at(ring.outer + 0.14, base), at(ring.outer + 0.14 + len, 0), at(ring.outer + 0.14, -base)];
    g.add(poly(tri, M.curb, Y - 0.005, 0.04));
    const triIn = [at(ring.outer + 0.2, base * 0.6), at(ring.outer + 0.08 + len * 0.85, 0), at(ring.outer + 0.2, -base * 0.6)];
    g.add(poly(triIn, M.grass, Y + 0.036, 0.004));
  }
  // Ada: bordür, çimen, çiçek tarhı ve bayraklar
  const island = new THREE.Group();
  island.position.set(ring.x, 0, ring.z);
  g.add(island);
  island.add(part(new THREE.CylinderGeometry(inner, inner, 0.06, 48), M.curb, 0, 0.03, 0));
  island.add(part(new THREE.CylinderGeometry(inner - 0.07, inner - 0.07, 0.065, 48), M.grass, 0, 0.035, 0));
  const flowers = ['#ff5c8a', '#ffd23f', '#ffffff', '#c77dff'];
  for (let k = 0; k < 22; k++) {
    const t = (k / 22) * Math.PI * 2;
    island.add(part(new THREE.IcosahedronGeometry(0.045, 0), mat(flowers[k % 4]), Math.cos(t) * (inner - 0.25), 0.09, Math.sin(t) * (inner - 0.25)));
  }
  island.add(part(new THREE.CylinderGeometry(0.45, 0.5, 0.08, 24), mat('#d8d2c4'), 0, 0.08, 0));
  const flagColors = ['#e53935', '#1e88e5', '#43a047'];
  for (let k = 0; k < 3; k++) {
    const t = (k / 3) * Math.PI * 2 + 0.4;
    const x = Math.cos(t) * 0.28, z = Math.sin(t) * 0.28;
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

export function buildHighway(entranceGrade = 0) {
  const parts: THREE.Object3D[] = [];
  parts.push(motorway(ROUTES.west, { trim: [0, 1.4], open: ringOpen }));
  // Kelebek kavşağın köprüsünün altında direk olmasın; rampaların bağlandığı yerde bariyer açık
  parts.push(motorway(ROUTES.south, { trim: [1.4, 0], noLamp: p => Math.abs(p.y - CL.z) < 3, open: q => ringOpen(q) || cloverOpen(q) }));
  parts.push(motorway(ROUTES.cross, { height: p => bHeight(p.x), noLamp: p => Math.abs(p.x - CL.x) < 6, clear: p => Math.abs(p.x - CL.x) < 1.25, open: cloverOpen }));
  parts.push(cityRoad(path([[ring.x + ARM, HW.z0], [LINK_X, HW.z0]]), entranceGrade), smallRoad(ROUTES.ski), roundabout(), cloverleaf());
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
  readonly hs: number[];
  readonly acc: number[] = [0];
  readonly length: number;
  constructor(pts: V2[], hs?: number[]) {
    this.pts = pts;
    this.hs = hs ?? pts.map(() => 0);
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
    out.set(a.x + (b.x - a.x) * t, CAR_Y + this.hs[lo] + (this.hs[hi] - this.hs[lo]) * t, a.y + (b.y - a.y) * t);
    return Math.atan2(b.x - a.x, b.y - a.y);
  }
}

// Göbek kavşakta bir koldan ötekine (saat yönünün tersine döner). Açılar haritada: doğu 0, kuzey π/2, batı π, güney 3π/2
const ARMS = { east: 0, north: Math.PI / 2, west: Math.PI, south: (3 * Math.PI) / 2 };
function ringPath(from: number, to: number, laneIn: number, laneOut: number): V2[] {
  const C = v2(ring.x, ring.z);
  const u = (a: number) => v2(Math.cos(a), -Math.sin(a));
  const right = (h: V2) => v2(-h.y, h.x);
  // Halkada iki şerit: dış şeritten gelen dışta, içten gelen içte döner (ortadaki kesik çizginin üstünde değil)
  const R = laneIn > 0.4 ? ring.r + 0.3 : ring.r - 0.22;
  const onRing = (a: number) => C.clone().add(u(a).multiplyScalar(R));
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
  const n = Math.max(4, Math.ceil(((a1 - a0) * R) / 0.25));
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
  gate?: 'toCity' | 'fromCity'; // şehre giren / şehirden çıkan yol: araba şehir trafiğine devredilir
  wide?: number; // şehirdeki hangi şeride bağlı (0 iç, 1 dış)
}

// Otobanda ve kavşakta akan trafik: tünelden çıkan, şehre giren, şehirden çıkıp otobana katılan,
// kayak merkezine giden arabalar. Önündeki arabaya yaklaşan yavaşlar; kavşakta yol verir.
export class HighwayTraffic {
  readonly root = new THREE.Group();
  private routes: Route[] = [];
  private cars: Car[] = [];
  private set: CarSet | null = null;
  private tmp = new THREE.Object3D();
  private exits: { type: number; paint: THREE.Color; wide: number }[] = [];
  private busMesh: THREE.InstancedMesh | null = null;
  // Şehrin girişindeki şeritlerin yol ortasına uzaklığı (caddede iç ve dış şerit): otobandaki şerit bunlarla aynı hizada
  private cityLanes: [number, number] = [0.125, 0.3];
  private gates: { to: number[]; from: number[] } = { to: [], from: [] };
  private gateDef: ((kind: 'toCity' | 'fromCity', k: number) => { parts: { pts: V2[]; v: number; h?: number[] }[] }) | null = null;
  // Şehrin trafiği: girişe gelen arabayı alır (yol doluysa false, araba bekler)
  enterCity: ((type: number, paint: THREE.Color, wide: number) => boolean) | null = null;
  // Şehrin girişi (o şeritte) dolu mu? Doluysa şehre giden araba bir araba boyu geride bekler
  cityBusy: ((wide: number) => boolean) | null = null;

  // Şehirden çıkan araba aynı renk ve modelle otobana devam eder
  leaveCity(type: number, paint: THREE.Color, wide: number) {
    this.exits.push({ type, paint, wide: Math.min(1, Math.max(0, wide)) });
  }
  // Şehre otobüs gönder: tünelden çıkar, şehrin girişinde şehir trafiğine geçer (dış şerit)
  sendBus() {
    const r = this.gates.to[1];
    if (r === undefined || this.cars.some(c => c.route === r && c.s < 1.5)) return;
    this.cars.push({ route: r, s: 0, speed: 0.75, type: -1, paint: new THREE.Color('#ffffff'), v: 0, pos: new THREE.Vector3(), h: 0, fade: 1 });
  }
  busesComing() {
    return this.cars.filter(c => c.type < 0 && this.routes[c.route].gate === 'toCity').length;
  }

  // Şehirden çıkan araba otobana geçebilir mi? (yolun başı boş değilse şehrin kenarında bekler, kaybolmaz)
  canLeave(wide: number) {
    const r = this.gates.from[Math.min(1, Math.max(0, wide))];
    return !this.exits.length && (r === undefined || !this.cars.some(c => c.route === r && c.s < 0.9));
  }
  // Şehrin girişindeki yol değişince (yol, bulvar, cadde) otobandaki şeritler de ona göre kayar
  setCityLanes(lanes: [number, number]) {
    if (lanes[0] === this.cityLanes[0] && lanes[1] === this.cityLanes[1]) return;
    this.cityLanes = lanes;
    if (!this.gateDef) return;
    for (const kind of ['toCity', 'fromCity'] as const) {
      (kind === 'toCity' ? this.gates.to : this.gates.from).forEach((r, k) => {
        this.routes[r] = this.makeRoute({ ...this.gateDef!(kind, k), gate: kind }, k);
        for (const c of this.cars) if (c.route === r) c.s = Math.min(c.s, this.routes[r].lane.length);
      });
    }
  }

  // Parçalardan yol (şerit ve her noktadaki hız sınırı)
  private makeRoute(def: { parts: { pts: V2[]; v: number; h?: number[] }[]; fadeIn?: boolean; fadeOut?: boolean; gate?: Route['gate'] }, wide?: number): Route {
    const pts: V2[] = [];
    const caps: number[] = [];
    const hs: number[] = [];
    for (const p of def.parts) {
      p.pts.forEach((q, k) => {
        pts.push(q);
        caps.push(p.v);
        hs.push(p.h?.[k] ?? 0);
      });
    }
    // Arka arkaya aynı noktalar olmasın
    const clean: V2[] = [], cc: number[] = [], ch: number[] = [];
    pts.forEach((p, k) => {
      if (!clean.length || clean[clean.length - 1].distanceTo(p) > 1e-3) {
        clean.push(p);
        cc.push(caps[k]);
        ch.push(hs[k]);
      }
    });
    return { lane: new Lane(clean, ch), slow: new Float32Array(cc), fadeIn: !!def.fadeIn, fadeOut: !!def.fadeOut, gate: def.gate, wide };
  }

  init() {
    const rev = (p: V2[]) => [...p].reverse();
    const W = ROUTES.west;
    type Part = { pts: V2[]; v: number; h?: number[] };
    const defs: { parts: Part[]; fadeIn?: boolean; fadeOut?: boolean; gate?: Route['gate']; wide?: number; cars: number }[] = [];
    // Kelebek kavşaktaki yollar: A kuzey-güney (yerde), B batı-doğu (ortada köprüde)
    const zN = HW.z0 + ARM, zS = HW.south, xW = HW.west, xE = HW.east;
    const A = (o: number, z0: number, z1: number): Part => ({ pts: path([[CL.x + (z1 > z0 ? -o : o), z0], [CL.x + (z1 > z0 ? -o : o), z1]]), v: 3 });
    const B = (o: number, x0: number, x1: number): Part => {
      const pts = path([[x0, CL.z + (x1 > x0 ? o : -o)], [x1, CL.z + (x1 > x0 ? o : -o)]]);
      return { pts, v: 3, h: pts.map(p => bHeight(p.x)) };
    };
    const Q = [0, 1, 2, 3].map(cloverQuadrant);
    const ramp = (pts: V2[], v: number): Part => ({ pts, v, h: rampHeights(pts) });
    const first = (p: Part) => p.pts[0], last = (p: Part) => p.pts[p.pts.length - 1];
    const NW = Q[0], NE = Q[1], SE = Q[2], SW = Q[3];
    const toA = { pts: ringPath(ARMS.west, ARMS.south, LANES[1], LANES[1]), v: 1.1 };
    const fromA = { pts: ringPath(ARMS.south, ARMS.west, LANES[1], LANES[1]), v: 1.1 };
    const lp = (pts: V2[]) => ramp(pts, 0.9), op = (pts: V2[]) => ramp(pts, 1.4);
    for (const o of LANES) {
      // Tünel <-> güney (kelebek kavşağın altından düz geçer); batı <-> doğu (köprünün üstünden)
      defs.push({ cars: 4, parts: [{ pts: offset(W, o), v: 3 }, { pts: ringPath(ARMS.west, ARMS.south, o, o), v: 1.1 }, A(o, zN, zS)] });
      defs.push({ cars: 4, parts: [A(o, zS, zN), { pts: ringPath(ARMS.south, ARMS.west, o, o), v: 1.1 }, { pts: offset(rev(W), o), v: 3 }] });
      defs.push({ cars: 3, fadeIn: true, parts: [B(o, xW, xE)] });
      defs.push({ cars: 3, fadeOut: true, parts: [B(o, xE, xW)] });
    }
    const o = LANES[1];
    const loopIn = (q: typeof NW) => lp(q.loop), outerIn = (q: typeof NW) => op(q.outer);
    // Tünel -> doğu: güneye iner, güneybatı döngüsünden doğuya
    defs.push({ cars: 3, parts: [{ pts: offset(W, o), v: 3 }, toA, A(o, zN, first(loopIn(SW)).y), loopIn(SW), B(o, last(loopIn(SW)).x, xE)] });
    // Doğu -> tünel: batıya gelir, kuzeydoğu dış rampasından kuzeye
    defs.push({ cars: 3, parts: [B(o, xE, first(outerIn(NE)).x), outerIn(NE), A(o, last(outerIn(NE)).y, zN), fromA, { pts: offset(rev(W), o), v: 3 }] });
    // Tünel -> batı: kuzeybatı dış rampası; batı -> tünel: güneydoğu döngüsü
    defs.push({ cars: 1, fadeOut: true, parts: [{ pts: offset(W, o), v: 3 }, toA, A(o, zN, first(outerIn(NW)).y), outerIn(NW), B(o, last(outerIn(NW)).x, xW)] });
    defs.push({ cars: 1, fadeIn: true, parts: [B(o, xW, first(loopIn(SE)).x), loopIn(SE), A(o, last(loopIn(SE)).y, zN), fromA, { pts: offset(rev(W), o), v: 3 }] });
    // Doğu -> güney: kuzeybatı döngüsü; güney -> doğu: güneydoğu dış rampası
    defs.push({ cars: 2, parts: [B(o, xE, first(loopIn(NW)).x), loopIn(NW), A(o, last(loopIn(NW)).y, zS)] });
    defs.push({ cars: 2, parts: [A(o, zS, first(outerIn(SE)).y), outerIn(SE), B(o, last(outerIn(SE)).x, xE)] });
    // Güney -> batı: kuzeydoğu döngüsü; batı -> güney: güneybatı dış rampası
    defs.push({ cars: 1, fadeOut: true, parts: [A(o, zS, first(loopIn(NE)).y), loopIn(NE), B(o, last(loopIn(NE)).x, xW)] });
    defs.push({ cars: 1, fadeIn: true, parts: [B(o, xW, first(outerIn(SW)).x), outerIn(SW), A(o, last(outerIn(SW)).y, zS)] });
    // Tünelden şehre ve şehirden otobana: şehirdeki iki şeride ayrı ayrı bağlanır (araba aynı şeritten devam eder).
    // Şehirden çıkan güneye iner, güneybatı döngüsünden doğuya gider.
    this.gateDef = (kind, k) => {
      const cl = this.cityLanes[k];
      return kind === 'toCity'
        ? { parts: [{ pts: offset(W, LANES[1]), v: 3 }, { pts: ringPath(ARMS.west, ARMS.east, LANES[1], cl), v: 1.1 }, { pts: offset(ROUTES.city, cl), v: 1.3 }] }
        : { parts: [{ pts: offset(rev(ROUTES.city), cl), v: 1.3 }, { pts: ringPath(ARMS.east, ARMS.south, cl, LANES[1]), v: 1.1 }, A(o, zN, first(loopIn(SW)).y), loopIn(SW), B(o, last(loopIn(SW)).x, xE)] };
    };
    for (let k = 0; k < 2; k++) {
      defs.push({ cars: 3, gate: 'toCity', wide: k, ...this.gateDef('toCity', k) });
      defs.push({ cars: 0, gate: 'fromCity', wide: k, ...this.gateDef('fromCity', k) });
    }
    defs.push({ cars: 2, fadeOut: true, parts: [{ pts: offset(W, LANES[1]), v: 3 }, { pts: ringPath(ARMS.west, ARMS.north, LANES[1], SMALL_LANE), v: 1.1 }, { pts: offset(ROUTES.ski, SMALL_LANE), v: 1.3 }] });
    defs.push({ cars: 2, fadeIn: true, parts: [{ pts: offset(rev(ROUTES.ski), SMALL_LANE), v: 1.3 }, { pts: ringPath(ARMS.north, ARMS.west, SMALL_LANE, LANES[1]), v: 1.1 }, { pts: offset(rev(W), LANES[1]), v: 3 }] });

    for (const def of defs) {
      this.routes.push(this.makeRoute(def, def.wide));
      const r = this.routes.length - 1;
      const lane = this.routes[r].lane;
      if (def.gate === 'toCity') this.gates.to[def.wide ?? 0] = r;
      if (def.gate === 'fromCity') this.gates.from[def.wide ?? 0] = r;
      for (let k = 0; k < def.cars; k++) {
        const type = CAR_KINDS.indexOf(NORMAL_CARS[Math.floor(Math.random() * NORMAL_CARS.length)]);
        this.cars.push({ route: r, s: ((k + Math.random() * 0.4) / def.cars) * lane.length, speed: 0.85 + Math.random() * 0.3, type, paint: carPaint(CAR_KINDS[type]), v: 0, pos: new THREE.Vector3(), h: 0, fade: 1 });
      }
    }
    this.set = new CarSet(CAR_KINDS, this.cars.length + 30);
    this.root.add(this.set.root);
    // Otobüsler (şehre gelip giden): tek parça model
    const busGeo = bakeModel(makeBus());
    if (busGeo) {
      this.busMesh = new THREE.InstancedMesh(busGeo, vertexColorMat, 24);
      this.busMesh.count = 0;
      this.busMesh.frustumCulled = false;
      this.root.add(this.busMesh);
    }
  }

  // Aracın boyu (çizildiği ölçekte)
  private lengthOf(c: Car) {
    return (c.type < 0 ? 0.6 : this.set?.lengths[c.type] ?? 0.47) * CAR_SCALE;
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
    // Şehirden çıkan arabalar aynı şeritten otobana katılır
    while (this.exits.length) {
      const e = this.exits.shift()!;
      const out = this.gates.from[e.wide];
      if (out === undefined) continue;
      this.cars.push({ route: out, s: 0, speed: 0.85 + Math.random() * 0.3, type: e.type, paint: e.paint, v: 1, pos: new THREE.Vector3(), h: 0, fade: 1 });
    }
    for (const c of this.cars) c.h = this.routes[c.route].lane.at(c.s, c.pos);
    set.begin();
    let buses = 0;
    const gone = new Set<Car>();
    this.cars.forEach((car, ci) => {
      const route = this.routes[car.route];
      let v = this.cap(route, car.s) * car.speed;
      // Önündeki araç (aynı ya da başka yoldan gelen): yavaşla ya da dur
      const fx = Math.sin(car.h), fz = Math.cos(car.h);
      for (const o of this.cars) {
        if (o === car || Math.abs(o.pos.y - car.pos.y) > 0.15) continue;
        const rx = o.pos.x - car.pos.x, rz = o.pos.z - car.pos.z;
        const ahead = rx * fx + rz * fz;
        if (ahead <= 0.02 || ahead > 1.2) continue;
        if (Math.abs(rx * fz - rz * fx) > 0.16) continue;
        // İkisi birbirini bekliyorsa (kavşakta) biri geçsin, kilitlenmesin
        const ox = Math.sin(o.h), oz = Math.cos(o.h);
        const back = -rx * ox - rz * oz;
        if (back > 0.02 && back < 1.2 && Math.abs(-rx * oz + rz * ox) < 0.16 && ci < this.cars.indexOf(o)) continue;
        // Arada iki aracın boylarının yarısı ve küçük bir boşluk kalsın (otobüs ve kamyon daha uzun)
        v = Math.min(v, Math.max(0, (ahead - (this.lengthOf(car) + this.lengthOf(o)) / 2 - 0.09) * 3));
      }
      // Şehre giden: giriş doluysa sınırın dışında bekle (şehirdeki kuyruğun içine girmesin)
      if (route.gate === 'toCity' && car.s > route.lane.length - 1.2 && this.cityBusy?.(route.wide ?? 1)) v = Math.min(v, Math.max(0, (route.lane.length - 0.55 - car.s) * 3));
      car.v += (v - car.v) * Math.min(1, dt * 3);
      car.s += car.v * dt;
      if (car.s > route.lane.length) {
        if (route.gate === 'toCity') {
          // Şehrin girişine geldi: şehir trafiğine geçer, tünelden yeni araba gelir (giriş doluysa bekler)
          if (!this.enterCity || this.enterCity(car.type, car.paint, route.wide ?? 1)) {
            car.s = 0;
            car.type = CAR_KINDS.indexOf(NORMAL_CARS[Math.floor(Math.random() * NORMAL_CARS.length)]);
            car.paint = carPaint(CAR_KINDS[car.type]);
          } else {
            car.s = route.lane.length;
            car.v = 0;
          }
        } else if (route.gate === 'fromCity') {
          gone.add(car);
          return;
        } else car.s = 0;
      }
      const fadeIn = route.fadeIn ? THREE.MathUtils.smoothstep(car.s, 0, 1.2) : 1;
      const fadeOut = route.fadeOut ? THREE.MathUtils.smoothstep(route.lane.length - car.s, 0, 1.2) : 1;
      car.fade = Math.min(fadeIn, fadeOut);
      this.tmp.rotation.y = route.lane.at(car.s, this.tmp.position);
      this.tmp.scale.setScalar(CAR_SCALE * car.fade);
      this.tmp.updateMatrix();
      if (car.type < 0) {
        if (this.busMesh && buses < 24) this.busMesh.setMatrixAt(buses++, this.tmp.matrix);
      } else set.put(car.type, this.tmp.matrix, car.paint);
    });
    if (gone.size) this.cars = this.cars.filter(c => !gone.has(c));
    set.end();
    if (this.busMesh) {
      this.busMesh.count = buses;
      this.busMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
