import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeStatic } from './batcher';
import { part, windowMat } from './utilities';
import { signMat } from './signs';
import { treeParts, type TreeType } from './trees';
import { pm, M, BULB, BULB_GEO, FLOWERS, PAINT, type V3, UP, add, box, cyl, rod, item, bench, frustum } from './parts';

// ======================= Hayvanat bahçesi (3x3) =======================
// Doğal görünümlü, modern hayvanat bahçesi: kutu biçimli çitli bölmeler yerine kıvrımlı sınırlı yaşam alanları.
// Zemin tek parça, köşe renkli bir arazi: hafif tepecikler, kuru otlu savan, kızıl topraklı aslan alanı, çam ormanlı
// ayı yamacı, beyaz kayalı penguen havuzu ve ortada su ile çevrili maymun adası. Ziyaretçi tarafında görünmez kuru
// hendek (ha-ha) ve alçak taş duvar ya da cam panel var; yüksek çit yok.
// Hayvanlar gerçek oranlarda çizilir ve köşe renkleriyle desenlenir (zürafada ağ benekler, zebrada çizgiler).
// Bazıları yavaşça yürür, durup otlar (başlarını eğer), fil hortumunu sallar, penguenler yüzüp dalar, orangutan
// ipte sallanır (animateDecor: userData.animals, her hayvanın kendi step işlevi).
// Ziyaretçi yolları kıvrılarak dolaşır: girişte saz çatılı bilet kulübeleri ve tabelalı kapı, hediyelik eşya dükkânı,
// terası şemsiyeli kafe, zürafa besleme kulesi, seyir terasları, banklar, lambalar, çiçekler ve gezen insanlar.
// Sabit parçalar tek seferde çizilir (mergeStatic); yürüyen hayvanlar ayrı küçük gruplardır.

const G = 0.0305; // çimen yüzeyi (komşu karelerle aynı)
const S = THREE.MathUtils.smoothstep;
const SC = 1 / (3 * 0.96); // şehirdeki boyda kalan eşyalar (bank, lamba, insan, ağaç)
const AM = 0.038; // hayvanlar: metre -> yerel ölçü (görünsünler diye gerçeğinden biraz iri)
const HW = 0.019; // yol yarı genişliği
const MD = 0.02; // kuru hendeğin derinliği

const VC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
const POOL = new THREE.MeshStandardMaterial({ color: '#2f8db8', transparent: true, opacity: 0.72, roughness: 0.05, metalness: 0.3, emissive: '#06263a', emissiveIntensity: 0.3 });
const GLASS = new THREE.MeshStandardMaterial({ color: '#d4eef8', transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.3, depthWrite: false });
const FALL = new THREE.MeshStandardMaterial({ color: '#f2fbff', transparent: true, opacity: 0.62, roughness: 0.1, depthWrite: false });
const col = (h: string) => new THREE.Color(h);
const Z = {
  bark: pm('#5b4636', 0.95),
  log: pm('#7a5a3c', 0.95),
  timber: pm('#8a5d38', 0.85),
  timberDark: pm('#5e3d24', 0.85),
  plaster: pm('#d8bf94', 0.95),
  stone: pm('#a59a88', 0.95),
  stoneLight: pm('#c4b9a5', 0.95),
  stoneDark: pm('#857b6c', 0.95),
  rope: pm('#c8b07a', 1),
  pave: pm('#d9ccb1', 0.95),
  paveDark: pm('#bfae90', 0.95),
  board: pm('#4a3220', 0.8),
  green: pm('#2e6b3a', 0.7),
  canvas: pm('#f1ead9', 0.9),
  hedge: pm('#3f8a35', 1),
};

// ---------- Küçük yardımcılar ----------
function rand(seed: number) {
  let v = ((seed * 7919) % 2147483646) + 1;
  return () => (v = (v * 16807) % 2147483647) / 2147483647;
}
const hash3 = (x: number, y: number, z: number) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
};
// Yumuşak dalgalı gürültü (yaklaşık -1..1)
const noise = (x: number, z: number) => Math.sin(x * 37.1 + z * 11.3) * 0.5 + Math.sin(x * 13.7 - z * 29.9) * 0.3 + Math.sin(x * 71.3 + z * 53.1) * 0.2;
type Pt = [number, number];
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
// Her yüzeye tek renk ver (fn yüzün ortası ve yönüyle çağrılır); geometri indekssiz olur
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3(), _col = new THREE.Color();
function faceColors(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i + 2 < pos.count; i += 3) {
    _a.fromBufferAttribute(pos, i);
    _b.fromBufferAttribute(pos, i + 1);
    _c.fromBufferAttribute(pos, i + 2);
    _p.copy(_a).add(_b).add(_c).divideScalar(3);
    _n.subVectors(_b, _a).cross(_c.clone().sub(_a)).normalize();
    fn(_p, _n, _col);
    for (let k = 0; k < 3; k++) _col.toArray(cols, (i + k) * 3);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
}
// Köşe renkli yüzey; yüzü yukarı baksın
function upward(pos: number[], colors: number[], idx: number[]) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  let up = 0;
  for (let k = 0; k < nrm.count; k++) up += nrm.getY(k);
  if (up < 0) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  return geo;
}

// ---------- Yerleşim ----------
// Yaşam alanları kıvrımlı sınırlı lekeler: merkez, iki yarıçap ve birkaç dalga (kenar karenin dışına taşmaz)
interface Blob { cx: number; cz: number; rx: number; rz: number; w: number[] }
const blob = (cx: number, cz: number, rx: number, rz: number, seed: number, wob = 1): Blob => {
  const r = rand(seed);
  return { cx, cz, rx, rz, w: [r() * 6.28, r() * 6.28, r() * 6.28, wob] };
};
const LIM = 0.472;
function radius(b: Blob, a: number) {
  const c = Math.cos(a), sn = Math.sin(a);
  let r = (1 + b.w[3] * (0.06 * Math.sin(2 * a + b.w[0]) + 0.035 * Math.sin(3 * a + b.w[1]) + 0.02 * Math.sin(5 * a + b.w[2]))) / Math.hypot(c / b.rx, sn / b.rz);
  if (Math.abs(c) > 1e-6) r = Math.min(r, (LIM - Math.sign(c) * b.cx) / Math.abs(c));
  if (Math.abs(sn) > 1e-6) r = Math.min(r, (LIM - Math.sign(sn) * b.cz) / Math.abs(sn));
  return r;
}
// Sınıra işaretli uzaklık (içeride eksi)
function sd(b: Blob, x: number, z: number) {
  const dx = x - b.cx, dz = z - b.cz;
  return Math.hypot(dx, dz) - radius(b, Math.atan2(dz, dx));
}
function edgePt(b: Blob, a: number, off = 0): Pt {
  const r = radius(b, a) + off;
  return [b.cx + Math.cos(a) * r, b.cz + Math.sin(a) * r];
}

const SAV = blob(-0.215, -0.27, 0.25, 0.2, 3, 0.8); // Afrika savanı
const LION = blob(0.3, -0.3, 0.17, 0.16, 5, 0.8); // aslanlar
const BEAR = blob(0.35, 0.09, 0.12, 0.13, 7, 0.7); // ayı ormanı
const PENG = blob(-0.34, 0.19, 0.125, 0.105, 9, 0.6); // penguenler
const LAGOON = blob(0.0, 0.12, 0.118, 0.1, 11, 0.6); // maymun adasının gölü
const ISLAND = blob(0.006, 0.118, 0.062, 0.054, 13, 0.8);
const HOLE = blob(-0.1, -0.205, 0.052, 0.033, 15); // savandaki su birikintisi
const PPOOL = blob(-0.325, 0.2, 0.088, 0.066, 17, 0.8); // penguen havuzu
const BPOND = blob(0.3, 0.145, 0.072, 0.05, 19, 0.7); // ayı göleti

interface Hab { b: Blob; relief: (x: number, z: number) => number; paint: (x: number, z: number, n1: number, n2: number, out: THREE.Color) => void; moat: boolean; glass?: (x: number, z: number) => boolean }
interface Pond { b: Blob; wl: number; depth: number; shallow: THREE.Color; deep: THREE.Color; shore: THREE.Color }

const bump = (x: number, z: number, cx: number, cz: number, r: number, h: number) => h * (1 - S(Math.hypot(x - cx, z - cz), 0, r));

const C = {
  lawnD: col('#4f9a3c'), lawnL: col('#78bf55'),
  savGrass: col('#c2a45c'), savLight: col('#d9c27e'), savGreen: col('#98994e'), savDirt: col('#b0906a'),
  lionGrass: col('#cfae68'), lionDirt: col('#b48b62'),
  forest: col('#3d5a29'), forestL: col('#5d7234'), needles: col('#6e5737'),
  pebble: col('#d6d2ca'), pebbleD: col('#b3aea5'),
  lush: col('#4c9638'), lushL: col('#6eae46'),
  moat: col('#8c7a5c'), moatD: col('#6f6048'),
  mud: col('#7a6448'), sand: col('#d9c79c'),
  pave: col('#dacdb2'), paveEdge: col('#b8a88c'),
};
const HABS: Hab[] = [
  {
    b: SAV,
    moat: true,
    relief: (x, z) => 0.005 * noise(x * 1.4, z * 1.4) + bump(x, z, -0.38, -0.4, 0.09, 0.022) + bump(x, z, -0.02, -0.42, 0.08, 0.01) + bump(x, z, -0.44, -0.2, 0.06, 0.012),
    paint: (x, z, n1, n2, out) => {
      out.copy(C.savGrass).lerp(C.savLight, S(n1, -0.2, 0.9) * 0.7);
      out.lerp(C.savGreen, S(n2, 0.15, 0.85) * 0.75);
      out.lerp(C.savDirt, S(-n2, 0.35, 0.95) * 0.5);
      // Hayvanların açtığı toprak patikalar ve su birikintisi çevresi
      const trail = Math.min(Math.abs(Math.hypot((x + 0.29) / 0.09, (z + 0.28) / 0.065) - 1) * 0.07, Math.abs(Math.hypot((x + 0.1) / 0.09, (z + 0.235) / 0.062) - 1) * 0.07);
      out.lerp(C.savDirt, (1 - S(trail, 0.002, 0.008)) * 0.55);
      out.lerp(C.savDirt, (1 - S(sd(HOLE, x, z), 0.0, 0.035)) * 0.8);
    },
  },
  {
    b: LION,
    moat: true,
    relief: (x, z) => 0.004 * noise(x * 1.6 + 2, z * 1.6) + bump(x, z, 0.33, -0.37, 0.09, 0.018) + bump(x, z, 0.42, -0.2, 0.06, 0.01),
    paint: (x, z, n1, n2, out) => {
      out.copy(C.lionGrass).lerp(C.savLight, S(n1, 0, 1) * 0.5);
      out.lerp(C.lionDirt, S(n2, 0.1, 0.8) * 0.7);
      out.lerp(C.lionDirt, (1 - S(Math.hypot(x - 0.32, z + 0.35), 0.03, 0.09)) * 0.6);
    },
  },
  {
    b: BEAR,
    moat: true,
    relief: (x, z) => 0.034 * S((x - 0.33) * 0.6 - (z - 0.1), -0.02, 0.13) + 0.004 * noise(x * 2, z * 2),
    paint: (x, z, n1, n2, out) => {
      out.copy(C.forest).lerp(C.forestL, S(n1, -0.3, 0.9) * 0.6);
      out.lerp(C.needles, S(n2, -0.35, 0.55) * 0.75);
    },
  },
  {
    b: PENG,
    moat: false,
    relief: (x, z) => 0.004 + 0.003 * noise(x * 3, z * 3),
    paint: (x, z, n1, n2, out) => {
      out.copy(C.pebble).lerp(C.pebbleD, S(n2, -0.4, 0.8) * 0.6);
    },
    glass: () => true,
  },
];
const PONDS: Pond[] = [
  { b: HOLE, wl: G - 0.004, depth: 0.007, shallow: col('#8f7d5a'), deep: col('#4d5a44'), shore: col('#7d6a4c') },
  { b: PPOOL, wl: G - 0.002, depth: 0.024, shallow: col('#bfe8ea'), deep: col('#3aa7c9'), shore: col('#e6e3dc') },
  { b: BPOND, wl: G - 0.001, depth: 0.012, shallow: col('#7f8a62'), deep: col('#2f4b48'), shore: col('#6c6047') },
  { b: LAGOON, wl: G - 0.005, depth: 0.014, shallow: col('#7ea07a'), deep: col('#2d5654'), shore: col('#8a7b58') },
];
const LAG = PONDS[3];

// Ziyaretçi yolları (orta çizgiler)
const PLAZA = { cx: 0, cz: 0.385, rx: 0.135, rz: 0.072 };
const PATHS: { pts: Pt[]; closed: boolean }[] = [
  { pts: [[0, 0.33], [-0.11, 0.285], [-0.168, 0.17], [-0.158, 0.05], [-0.1, -0.03], [0.0, -0.055], [0.1, -0.048], [0.165, 0.02], [0.178, 0.13], [0.14, 0.255]], closed: true },
  { pts: [[-0.14, 0.0], [-0.22, 0.02], [-0.31, 0.03], [-0.4, 0.012]], closed: false },
  { pts: [[0.05, -0.055], [0.085, -0.12], [0.09, -0.21], [0.078, -0.29]], closed: false },
  { pts: [[0.135, -0.03], [0.21, -0.08], [0.3, -0.088], [0.4, -0.078]], closed: false },
  { pts: [[-0.1, 0.375], [-0.18, 0.39], [-0.26, 0.395]], closed: false },
  { pts: [[0.1, 0.375], [0.18, 0.385], [0.24, 0.39]], closed: false },
  { pts: [[0, 0.44], [0, 0.49]], closed: false },
];
// Binaların ve terasların düz zemini: [x0, z0, x1, z1]
const FLAT: [number, number, number, number][] = [
  [-0.4, 0.34, -0.25, 0.47], // hediyelik
  [0.22, 0.33, 0.47, 0.47], // kafe ve terası
  [-0.15, 0.4, 0.15, 0.49], // giriş
  [-0.47, -0.04, -0.37, 0.06], // batı seyir terası
  [0.37, -0.12, 0.47, -0.04], // doğu seyir terası
];

let polyCache: Pt[][] | null = null;
function curvePts(pts: Pt[], closed: boolean, n: number): Pt[] {
  const c = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), closed, 'centripetal');
  return c.getSpacedPoints(n).map(v => [v.x, v.z] as Pt);
}
function polys() {
  if (!polyCache) polyCache = PATHS.map(p => curvePts(p.pts, p.closed, p.closed ? 110 : 20));
  return polyCache;
}
function pathDist(x: number, z: number) {
  let d = 9;
  for (const pl of polys()) {
    for (let k = 0; k + 1 < pl.length; k++) {
      const a = pl[k], b = pl[k + 1];
      if (Math.abs(x - a[0]) > d + 0.05 && Math.abs(x - b[0]) > d + 0.05) continue;
      d = Math.min(d, segDist(x, z, a[0], a[1], b[0], b[1]));
    }
  }
  return d;
}
const plazaD = (x: number, z: number) => (Math.hypot((x - PLAZA.cx) / PLAZA.rx, (z - PLAZA.cz) / PLAZA.rz) - 1) * PLAZA.rz;
const rectD = (x: number, z: number, r: [number, number, number, number]) => Math.max(r[0] - x, x - r[2], r[1] - z, z - r[3]);
// Ziyaretçi tarafı mı? (yola yakın sınırlarda hendek ve duvar var)
const moatF = (x: number, z: number) => 1 - S(pathDist(x, z), 0.04, 0.072);
function moatDepth(hb: Hab, d: number, x: number, z: number) {
  if (!hb.moat || d > 0.002 || d < -0.045) return 0;
  const f = moatF(x, z);
  if (f <= 0) return 0;
  const t = -d;
  return f * MD * S(t, -0.001, 0.007) * (1 - S(t, 0.02, 0.042));
}
// Yolların, meydanın ve binaların altında zemin düz
function flatF(x: number, z: number) {
  let f = 1 - S(pathDist(x, z), HW + 0.002, HW + 0.014);
  f = Math.max(f, 1 - S(plazaD(x, z), 0, 0.012));
  for (const r of FLAT) f = Math.max(f, 1 - S(rectD(x, z, r), 0, 0.012));
  return f;
}

// Arazinin yüksekliği
function height(x: number, z: number) {
  let h = G;
  for (const hb of HABS) {
    const d = sd(hb.b, x, z);
    if (d > 0.01) continue;
    h += (1 - S(d, -0.035, -0.002)) * hb.relief(x, z);
    h -= moatDepth(hb, d, x, z);
  }
  for (const p of PONDS) {
    const d = sd(p.b, x, z);
    if (d > 0.02) continue;
    if (d >= 0) h = p.wl + 0.0015 + (h - p.wl - 0.0015) * S(d, 0, 0.018);
    else h = p.wl - 0.001 - p.depth * S(-d, 0, 0.03);
  }
  const di = sd(ISLAND, x, z);
  if (di < 0.016) h = Math.max(h, LAG.wl - 0.008 + (G + 0.032 - LAG.wl + 0.008) * S(-di, -0.016, 0.05));
  const f = flatF(x, z);
  return h + (G - h) * f;
}

// ---------- Zemin ----------
function ground(st: THREE.Group) {
  const N = 72;
  const geo = new THREE.PlaneGeometry(0.98, 0.98, N, N).rotateX(-Math.PI / 2);
  geo.deleteAttribute('uv');
  const p = geo.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(p.count * 3);
  const c = new THREE.Color(), tmp = new THREE.Color();
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), z = p.getZ(k);
    const y = height(x, z);
    p.setY(k, y);
    const n1 = noise(x * 2.3, z * 2.3), n2 = noise(x * 5.1 + 3, z * 4.7 - 1);
    c.copy(C.lawnD).lerp(C.lawnL, 0.45 + 0.4 * n1);
    for (const hb of HABS) {
      const d = sd(hb.b, x, z);
      if (d > 0.012) continue;
      hb.paint(x, z, n1, n2, tmp);
      c.lerp(tmp, 1 - S(d, -0.01, 0.006));
      const md = moatDepth(hb, d, x, z);
      if (md > 0) c.lerp(tmp.copy(C.moat).lerp(C.moatD, S(n2, -0.5, 0.5)), S(md / MD, 0.1, 0.7));
    }
    for (const pd of PONDS) {
      const d = sd(pd.b, x, z);
      if (d > 0.012) continue;
      if (d < 0) tmp.copy(pd.shallow).lerp(pd.deep, S(-d, 0.0, 0.03));
      else tmp.copy(pd.shore);
      c.lerp(tmp, 1 - S(d, 0.002, 0.012));
    }
    // Ada: su üstünde kalan yer yemyeşil, kıyısı çamurlu
    if (sd(ISLAND, x, z) < 0.02) {
      c.lerp(LAG.shore, S(y, LAG.wl - 0.003, LAG.wl + 0.001));
      c.lerp(tmp.copy(C.lush).lerp(C.lushL, S(n1, -0.4, 0.8)), S(y, LAG.wl + 0.002, LAG.wl + 0.007));
    }
    // Yol altı (kenarlar sonradan çizilen yol şeridiyle örtüşsün)
    c.lerp(C.paveEdge, (1 - S(pathDist(x, z), HW, HW + 0.006)) * 0.8);
    c.toArray(cols, k * 3);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  add(st, geo, VC, 0, 0, 0);
  // Kenarlarda yan duvar (komşu karelere bitişik): dışa bakan düz yüzler, üstleri yok (ince kutuların üstü çimenle
  // aynı boyda kalıp titreşiyordu)
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    add(st, new THREE.PlaneGeometry(0.98, G).rotateY(a), M.soil, Math.sin(a) * 0.49, G / 2, Math.cos(a) * 0.49);
  }
}

// Su yüzleri (kıyının biraz altına kadar uzanır; kara örter)
function waters(st: THREE.Group) {
  for (const p of PONDS) {
    const shape = new THREE.Shape();
    for (let k = 0; k <= 64; k++) {
      const [x, z] = edgePt(p.b, (k / 64) * Math.PI * 2, 0.014);
      if (k === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    }
    add(st, new THREE.ShapeGeometry(shape, 1).rotateX(-Math.PI / 2), POOL, 0, p.wl, 0);
  }
}

// Yol şeridi: ortası açık taş, kenarları koyu bordür
function ribbon(st: THREE.Group, pts: Pt[], w: number, lift: number, closed: boolean) {
  const pos: number[] = [], colors: number[] = [], idx: number[] = [];
  const n = pts.length - (closed ? 1 : 0);
  const offs = [-1, -0.8, 0, 0.8, 1];
  const c = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const a = pts[closed ? (k - 1 + n) % n : Math.max(k - 1, 0)];
    const b = pts[closed ? (k + 1) % n : Math.min(k + 1, n - 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], L = Math.hypot(tx, tz) || 1;
    for (const o of offs) {
      const x = pts[k][0] - (tz / L) * (w / 2) * o, z = pts[k][1] + (tx / L) * (w / 2) * o;
      pos.push(x, G + lift, z);
      c.copy(Math.abs(o) > 0.9 ? C.paveEdge : C.pave).offsetHSL(0, 0, noise(x * 3.3, z * 3.3) * 0.025);
      colors.push(c.r, c.g, c.b);
    }
  }
  const rows = closed ? n : n - 1;
  const m = offs.length;
  for (let k = 0; k < rows; k++) {
    const a0 = k * m, b0 = ((k + 1) % n) * m;
    for (let j = 0; j < m - 1; j++) idx.push(a0 + j, b0 + j, a0 + j + 1, a0 + j + 1, b0 + j, b0 + j + 1);
  }
  add(st, upward(pos, colors, idx), VC, 0, 0, 0);
}
function pathsAndPlaza(st: THREE.Group) {
  polys().forEach((pl, k) => {
    // Her yol bir öncekinden belirgin yüksekte: kesiştikleri yerde kenar ve orta renkleri titreşmesin
    ribbon(st, pl, HW * 2, 0.0014 + k * 0.0006, PATHS[k].closed);
    if (!PATHS[k].closed) for (const e of [pl[0], pl[pl.length - 1]]) add(st, new THREE.CircleGeometry(HW, 14).rotateX(-Math.PI / 2), Z.pave, e[0], G + 0.0011 + k * 0.0006, e[1]);
  });
  // Giriş meydanı: taş döşeme, ortada çember desen ve yuvarlak çiçeklik
  add(st, new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2).scale(PLAZA.rx, 1, PLAZA.rz), Z.pave, PLAZA.cx, G + 0.0062, PLAZA.cz); // bütün yolların üstünde
  add(st, new THREE.RingGeometry(0.85, 0.9, 40).rotateX(-Math.PI / 2).scale(PLAZA.rx, 1, PLAZA.rz), Z.paveDark, PLAZA.cx, G + 0.0068, PLAZA.cz);
  box(st, 0.1, 0.0024, 0.07, Z.pave, 0, G, 0.455);
}

// ---------- Kayalar ----------
// Yamuk yirmi yüzlü (aynı köşeler aynı miktarda itilir), tabanı düz. Boyarken: üst yüzler açık, yanlar koyu,
// ince katman çizgileri (tortul taş gibi), yosunlu türlerde üstte yeşillik.
const rockBase = (detail: number) => Array.from({ length: 6 }, (_, k) => {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = 0.78 + 0.32 * hash3(Math.round(x * 40) + k * 13, Math.round(y * 40), Math.round(z * 40)) + 0.12 * Math.sin(x * 2.3 + k) * Math.cos(z * 1.9 - k);
    // Biraz basamaklı (katmanlı kaya)
    let yy = y * f;
    yy += (Math.round(yy * 3) / 3 - yy) * 0.35;
    p.setXYZ(i, x * f, Math.max(yy, -0.3), z * f);
  }
  geo.deleteAttribute('uv');
  return geo;
});
const ROCK_BASE = rockBase(1);
const ROCK_SMALL = rockBase(0); // küçük taşlar (az üçgen)
interface Tone { dark: THREE.Color; light: THREE.Color; moss?: THREE.Color }
const T: Record<string, Tone> = {
  sav: { dark: col('#6e6457'), light: col('#b9ab92') },
  lion: { dark: col('#77695a'), light: col('#bfae92') },
  grey: { dark: col('#585955'), light: col('#a19f97'), moss: col('#6d7a45') },
  white: { dark: col('#8a9198'), light: col('#dde1e3') },
  moss: { dark: col('#55594a'), light: col('#9a9c88'), moss: col('#5f7a3a') },
};
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
// Kaya: (x, z) zemininde, ölçüleri sx, sy, sz; flatTop: üstü düz (aslanların yattığı kaya, basamaklı kayalık)
// Kayanın tepe yüksekliğini döndürür
function rock(st: THREE.Group, x: number, z: number, sx: number, sy: number, sz: number, tone: Tone, seed: number, y?: number, flatTop = false) {
  let geo: THREE.BufferGeometry = (Math.max(sx, sz) < 0.016 ? ROCK_SMALL : ROCK_BASE)[seed % ROCK_BASE.length].clone();
  if (flatTop) {
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, Math.min(p.getY(i), 0.5));
  }
  const r = rand(seed + 101);
  _e.set((r() - 0.5) * 0.2, r() * 6.28, (r() - 0.5) * 0.2);
  const y0 = y ?? height(x, z) - sy * 0.15;
  _m.compose(_v.set(x, y0, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  geo.computeVertexNormals();
  const band = 900 + (seed % 5) * 120;
  geo = faceColors(geo, (p, n, out) => {
    out.copy(tone.dark).lerp(tone.light, S(n.y, -0.5, 0.95));
    out.multiplyScalar((0.88 + 0.2 * hash3(p.x * 913, p.y * 977, p.z * 953)) * (0.95 + 0.05 * Math.sin(p.y * band)));
    if (tone.moss && n.y > 0.7) out.lerp(tone.moss, 0.55 * hash3(p.x * 500, p.z * 500, seed));
  });
  add(st, geo, VC, 0, 0, 0);
  return y0 + sy * (flatTop ? 0.5 : 0.85);
}
// Kaya öbeği: ortada büyük, çevresinde küçükler
function rockPile(st: THREE.Group, x: number, z: number, r: number, tone: Tone, seed: number, n = 5) {
  const rr = rand(seed);
  rock(st, x, z, r, r * 0.7, r * 0.85, tone, seed);
  for (let k = 0; k < n; k++) {
    const a = rr() * 6.28, d = r * (0.6 + rr() * 0.6), sz = r * (0.3 + rr() * 0.4);
    rock(st, x + Math.cos(a) * d, z + Math.sin(a) * d, sz, sz * (0.5 + rr() * 0.4), sz * (0.7 + rr() * 0.4), tone, seed + k + 1);
  }
}

// ---------- Bitkiler ----------
const treeCache = new Map<string, { crown: THREE.BufferGeometry; wood: THREE.BufferGeometry | null }>();
// Hazır ağaç (trees.ts) kendi renginde: gri tonlu çizilip istenen yeşile boyanır
function tree(st: THREE.Group, type: TreeType, x: number, z: number, size: number, tint: string, rot = 0, detail = 1) {
  const key = `${type}|${detail}`;
  let base = treeCache.get(key);
  if (!base) treeCache.set(key, (base = treeParts(type, detail, true)));
  const crown = base.crown.clone();
  const c = crown.attributes.color as THREE.BufferAttribute;
  const t = col(tint);
  for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * t.r * 1.1, c.getY(i) * t.g * 1.1, c.getZ(i) * t.b * 1.1);
  const o = item(st, x, z, rot, size * SC, height(x, z) - 0.002);
  add(o, crown, VC, 0, 0, 0);
  if (base.wood) add(o, base.wood, VC, 0, 0, 0);
}
// Yaprak kümesi (akasya tacı, çiçek öbeği): altı koyu, üstü açık
const clumpGeo = (detail: number) => {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = 0.82 + 0.34 * hash3(Math.round(x * 40), Math.round(y * 40), Math.round(z * 40));
    p.setXYZ(i, x * f, y * f, z * f);
  }
  geo.deleteAttribute('uv');
  return geo;
};
const CLUMP = clumpGeo(1);
const CLUMP_LO = clumpGeo(0);
function clump(o: THREE.Object3D, x: number, y: number, z: number, sx: number, sy: number, sz: number, lo: THREE.Color, hi: THREE.Color, seed: number, low = false) {
  let geo: THREE.BufferGeometry = (low ? CLUMP_LO : CLUMP).clone().scale(sx, sy, sz).translate(x, y, z);
  geo.computeVertexNormals();
  geo = faceColors(geo, (p, n, out) => {
    out.copy(lo).lerp(hi, S(n.y, -0.4, 0.95));
    out.multiplyScalar(0.82 + 0.34 * hash3(p.x * 731 + seed, p.y * 677, p.z * 619));
  });
  add(o, geo, VC, 0, 0, 0);
}
// İki nokta arasında incelen dal/gövde
function branch(o: THREE.Object3D, a: V3, b: V3, r0: number, r1: number, m: THREE.Material, seg = 6) {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const p = add(o, new THREE.CylinderGeometry(r1, r0, d.length(), seg, 1, true), m, A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
  p.quaternion.setFromUnitVectors(UP, d.normalize());
}
// Akasya (şemsiye ağaç): ince eğik gövde, ortada çatallanıp yayılan dallar, dalların ucunda yassı yaprak katları;
// tepesi düz geniş bir şemsiye gibi
const ACACIA = { lo: col('#3e4c22'), hi: col('#93a64c') };
function acacia(st: THREE.Group, x: number, z: number, h: number, seed: number) {
  const r = rand(seed);
  const o = item(st, x, z, r() * 6.28, 1, height(x, z) - 0.002);
  const fork: V3 = [(r() - 0.5) * 0.02, h * 0.42, (r() - 0.5) * 0.02];
  branch(o, [0, 0, 0], fork, 0.0062, 0.0042, Z.bark, 6);
  const n = 4;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r() * 0.7;
    const d = h * (0.24 + r() * 0.1), y = h * (0.8 + r() * 0.07);
    const tip: V3 = [Math.cos(a) * d, y, Math.sin(a) * d];
    const mid: V3 = [fork[0] + (tip[0] - fork[0]) * 0.5, h * 0.64, fork[2] + (tip[2] - fork[2]) * 0.5];
    branch(o, fork, mid, 0.003, 0.0024, Z.bark, 5);
    branch(o, mid, tip, 0.0024, 0.0014, Z.bark, 4);
    clump(o, tip[0], y + h * 0.04, tip[2], h * (0.15 + r() * 0.04), h * 0.04, h * (0.14 + r() * 0.04), ACACIA.lo, ACACIA.hi, seed + k);
  }
  clump(o, 0, h * 0.92, 0, h * 0.2, h * 0.045, h * 0.18, ACACIA.lo, ACACIA.hi, seed + 9);
}
// Kuru ağaç: çıplak, kıvrık dallar (savan ve aslanlar için)
function deadTree(st: THREE.Group, x: number, z: number, h: number, seed: number) {
  const r = rand(seed);
  const o = item(st, x, z, r() * 6.28, 1, height(x, z) - 0.002);
  const top: V3 = [(r() - 0.5) * 0.01, h * 0.55, (r() - 0.5) * 0.01];
  branch(o, [0, 0, 0], top, 0.0055, 0.0035, Z.bark, 6);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + r() * 0.9;
    const y0 = h * (0.3 + k * 0.07);
    const b0: V3 = [top[0] * (y0 / (h * 0.55)), y0, top[2] * (y0 / (h * 0.55))];
    const b1: V3 = [Math.cos(a) * h * 0.22, h * (0.62 + r() * 0.2), Math.sin(a) * h * 0.22];
    branch(o, b0, b1, 0.0028, 0.0016, Z.bark, 4);
    const b2: V3 = [b1[0] * 1.5 + (r() - 0.5) * 0.02, b1[1] + h * 0.15, b1[2] * 1.5 + (r() - 0.5) * 0.02];
    branch(o, b1, b2, 0.0016, 0.0008, Z.bark, 3);
  }
}
// Ot öbeği: ince sivri yapraklar, dibi koyu ucu açık (tek geometri, çok kez kullanılır)
function tuftGeo(lo: string, hi: string, n: number, seed: number) {
  const r = rand(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    const h = 0.6 + r() * 0.5;
    const g = new THREE.ConeGeometry(0.07, h, 3, 1, true).translate(0, h / 2, 0).rotateZ((r() - 0.5) * 0.7).rotateY(r() * 6.28).translate((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3);
    g.deleteAttribute('uv');
    parts.push(g.toNonIndexed());
  }
  const geo = mergeGeometries(parts)!;
  const L = col(lo), H = col(hi);
  return faceColors(geo, (p, _n, out) => out.copy(L).lerp(H, S(p.y, 0, 0.9)));
}
const TUFTS = {
  dry: tuftGeo('#8f7a3c', '#e0cb85', 5, 1),
  gold: tuftGeo('#98823a', '#d4b866', 5, 2),
  green: tuftGeo('#3f6e2a', '#8cbf55', 5, 3),
  reed: tuftGeo('#3d6b2e', '#9bbf5a', 8, 4),
};
function tuft(st: THREE.Group, geo: THREE.BufferGeometry, x: number, z: number, size: number, rot = 0) {
  const o = add(st, geo, VC, x, height(x, z) - 0.001, z);
  o.scale.setScalar(size);
  o.rotation.y = rot;
}
// Çiçek öbeği: alçak yeşil yaprak tümseği, üstünde renk renk küçük çiçekler
const FLOWER = new THREE.OctahedronGeometry(0.0028, 0);
const LEAF = { lo: col('#2f6a26'), hi: col('#6fae48') };
function flowers(st: THREE.Group, x: number, z: number, r: number, n: number, seed: number, y = height(x, z)) {
  const rr = rand(seed);
  clump(st, x, y, z, r * 1.1, r * 0.35, r * 0.9, LEAF.lo, LEAF.hi, seed, true);
  const c = [FLOWERS[seed % FLOWERS.length], FLOWERS[(seed + 2) % FLOWERS.length], FLOWERS[4]];
  for (let k = 0; k < n; k++) {
    const a = rr() * 6.28, d = Math.sqrt(rr()) * r * 0.85;
    add(st, FLOWER, c[k % 3], x + Math.cos(a) * d, y + r * 0.3 * (1 - (d / r) ** 2) + 0.002, z + Math.sin(a) * d * 0.85);
  }
}
// Kütük: kabuklu gövde, uçlarında açık renk kesik
function log(st: THREE.Group, x: number, z: number, len: number, r: number, rot: number, y?: number) {
  const o = item(st, x, z, rot, 1, (y ?? height(x, z)) + r * 0.7);
  add(o, new THREE.CylinderGeometry(r, r * 1.1, len, 7, 1, true).rotateZ(Math.PI / 2), Z.log, 0, 0, 0);
  for (const sd2 of [-1, 1]) add(o, new THREE.CircleGeometry(r * 0.95, 7).rotateY((sd2 * Math.PI) / 2), Z.rope, (sd2 * len) / 2, 0, 0);
}

// ---------- Hayvanlar ----------
// Parçalar metre cinsinden (yüzü +z); her parçanın adı (etiketi) boyarken kullanılır.
// Desenler (zürafa benekleri, zebra çizgileri, tüy tonları) küçük bir dokuya (atlas) pişirilir: her parçanın dokuda
// kendi alanı var ve her doku noktasının rengi, o noktanın hayvanın üstündeki 3 boyutlu yerinden hesaplanır.
// Böylece desenler az üçgenle keskin ve dikişsiz görünür; bütün hayvanlar tek malzemeyi paylaşır (birleşince tek çizim).
const DUMMY = new THREE.MeshBasicMaterial();
const SPH = new Map<string, THREE.SphereGeometry>();
function sph(w: number, h: number) {
  const k = `${w}|${h}`;
  let g = SPH.get(k);
  if (!g) SPH.set(k, (g = new THREE.SphereGeometry(1, w, h)));
  return g;
}
function el(g: THREE.Object3D, tag: string, c: V3, r: V3, rot: V3 = [0, 0, 0], seg: [number, number] = [12, 8]) {
  const o = new THREE.Mesh(sph(seg[0], seg[1]), DUMMY);
  o.name = tag;
  o.position.set(...c);
  o.scale.set(...r);
  o.rotation.set(...rot);
  g.add(o);
  return o;
}
// Yatay elipsoid: kutupları z yönünde (gövde boyunca daha çok halka)
function elz(g: THREE.Object3D, tag: string, c: V3, r: V3, rx: number, seg: [number, number]) {
  return el(g, tag, c, [r[0], r[2], r[1]], [Math.PI / 2 + rx, 0, 0], seg);
}
// İki nokta arasında incelen uzuv (uçları açık; uçlar gövdeye ya da küreye gömülü)
function tp(g: THREE.Object3D, tag: string, a: V3, b: V3, r0: number, r1: number, seg = 8, hs = 1) {
  const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A);
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, d.length(), seg, hs, true), DUMMY);
  o.name = tag;
  o.position.copy(A).addScaledVector(d, 0.5);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
  g.add(o);
  return o;
}
// Eklemli kıvrık uzuv (hortum, kuyruk, kol): noktalar ve yarıçaplar; eklemlerde ve uçlarda küre
function chain(g: THREE.Object3D, tag: string, pts: V3[], rr: number[], seg = 8) {
  for (let k = 0; k < pts.length; k++) {
    if (k + 1 < pts.length) tp(g, tag, pts[k], pts[k + 1], rr[k], rr[k + 1], seg);
    el(g, tag, pts[k], [rr[k], rr[k], rr[k]], [0, 0, 0], [seg, Math.max(4, seg >> 1)]);
  }
}
type Painter = (p: THREE.Vector3, n: THREE.Vector3, tag: string, out: THREE.Color) => void;

// --- Doku atlası ---
const ATLAS = 512; // doku boyu
const PAD = 2; // alanlar arasında boşluk (uzaktan bakınca renkler birbirine karışmasın)
export const ANIMAL_MAT = new THREE.MeshStandardMaterial({ roughness: 0.9 });
// Geliştirme için: dokunun ne kadarı dolu
export const zooAtlasUse = () => (atlas.y + atlas.row) / ATLAS;
const atlas = { data: null as Uint8ClampedArray | null, done: null as Uint8Array | null, x: 0, y: 0, row: 0, dirty: false, canvas: null as HTMLCanvasElement | null, tex: null as THREE.CanvasTexture | null };
function atlasInit() {
  if (atlas.data) return;
  atlas.data = new Uint8ClampedArray(ATLAS * ATLAS * 4);
  atlas.done = new Uint8Array(ATLAS * ATLAS);
  atlas.canvas = document.createElement('canvas');
  atlas.canvas.width = atlas.canvas.height = ATLAS;
  atlas.tex = new THREE.CanvasTexture(atlas.canvas);
  atlas.tex.colorSpace = THREE.SRGBColorSpace;
  atlas.tex.anisotropy = 4;
  ANIMAL_MAT.map = atlas.tex;
  ANIMAL_MAT.needsUpdate = true;
}
// Rafa dizerek yer ayır (doku dolarsa en baştaki alan yeniden kullanılır; renk biraz yanlış olur ama bozulmaz)
function alloc(w: number, h: number): [number, number] {
  if (atlas.x + w + PAD * 2 > ATLAS) {
    atlas.x = 0;
    atlas.y += atlas.row;
    atlas.row = 0;
  }
  if (atlas.y + h + PAD * 2 > ATLAS) {
    if (import.meta.env?.DEV) console.warn('hayvan dokusu doldu');
    return [PAD, PAD];
  }
  const at: [number, number] = [atlas.x + PAD, atlas.y + PAD];
  atlas.x += w + PAD * 2;
  atlas.row = Math.max(atlas.row, h + PAD * 2);
  return at;
}
function flushAtlas() {
  if (!atlas.dirty || !atlas.canvas || !atlas.data) return;
  const ctx = atlas.canvas.getContext('2d')!;
  const img = ctx.createImageData(ATLAS, ATLAS);
  img.data.set(atlas.data);
  ctx.putImageData(img, 0, 0);
  atlas.tex!.needsUpdate = true;
  atlas.dirty = false;
}
// Parçanın doku ölçüsü: u ve v yönünde metre (üçgenlerden ortalama ve en büyük değerin ortası)
function uvScale(geo: THREE.BufferGeometry) {
  const P = geo.attributes.position, U = geo.attributes.uv;
  let su = 0, sv = 0, ws = 0, mu = 0, mv = 0;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i + 2 < P.count; i += 3) {
    e1.set(P.getX(i + 1) - P.getX(i), P.getY(i + 1) - P.getY(i), P.getZ(i + 1) - P.getZ(i));
    e2.set(P.getX(i + 2) - P.getX(i), P.getY(i + 2) - P.getY(i), P.getZ(i + 2) - P.getZ(i));
    const du1 = U.getX(i + 1) - U.getX(i), dv1 = U.getY(i + 1) - U.getY(i), du2 = U.getX(i + 2) - U.getX(i), dv2 = U.getY(i + 2) - U.getY(i);
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-9) continue;
    const pu = t.copy(e1).multiplyScalar(dv2).addScaledVector(e2, -dv1).length() / Math.abs(det);
    const pv = t.copy(e2).multiplyScalar(du1).addScaledVector(e1, -du2).length() / Math.abs(det);
    const w = Math.abs(det);
    su += pu * w;
    sv += pv * w;
    ws += w;
    mu = Math.max(mu, pu);
    mv = Math.max(mv, pv);
  }
  return ws ? [(su / ws + mu) / 2, (sv / ws + mv) / 2] : [0.1, 0.1];
}
// Parçayı dokuya boya: üçgenleri doku alanında tara, her noktada 3 boyutlu yeri bul, rengini hesapla
const _cl = new THREE.Color(), _pp = new THREE.Vector3(), _nn = new THREE.Vector3();
function paintPart(geo: THREE.BufferGeometry, tag: string, w: number, h: number, paint: Painter) {
  const [x0, y0] = alloc(w, h);
  const D = atlas.data!, done = atlas.done!;
  const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv as THREE.BufferAttribute;
  const X = [0, 0, 0], Y = [0, 0, 0];
  for (let i = 0; i + 2 < P.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      X[k] = x0 + U.getX(i + k) * w;
      Y[k] = y0 + (1 - U.getY(i + k)) * h;
    }
    const area = (X[1] - X[0]) * (Y[2] - Y[0]) - (X[2] - X[0]) * (Y[1] - Y[0]);
    if (Math.abs(area) > 1e-9) {
      const minX = Math.max(x0 - 1, Math.floor(Math.min(X[0], X[1], X[2]) - 0.5)), maxX = Math.min(x0 + w, Math.ceil(Math.max(X[0], X[1], X[2]) + 0.5));
      const minY = Math.max(y0 - 1, Math.floor(Math.min(Y[0], Y[1], Y[2]) - 0.5)), maxY = Math.min(y0 + h, Math.ceil(Math.max(Y[0], Y[1], Y[2]) + 0.5));
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const cx = px + 0.5, cy = py + 0.5;
          let l1 = ((X[2] - X[0]) * (cy - Y[0]) - (cx - X[0]) * (Y[2] - Y[0])) / -area;
          let l2 = ((X[1] - X[0]) * (cy - Y[0]) - (cx - X[0]) * (Y[1] - Y[0])) / area;
          let l0 = 1 - l1 - l2;
          const mn = Math.min(l0, l1, l2);
          const idx = py * ATLAS + px;
          if (mn < -0.12 || (mn < 0 && done[idx] === 2)) continue;
          l0 = Math.max(0, l0);
          l1 = Math.max(0, l1);
          l2 = Math.max(0, l2);
          const s = l0 + l1 + l2;
          const w0 = l0 / s, w1 = l1 / s, w2 = l2 / s;
          _pp.set(P.getX(i) * w0 + P.getX(i + 1) * w1 + P.getX(i + 2) * w2, P.getY(i) * w0 + P.getY(i + 1) * w1 + P.getY(i + 2) * w2, P.getZ(i) * w0 + P.getZ(i + 1) * w1 + P.getZ(i + 2) * w2);
          _nn.set(N.getX(i) * w0 + N.getX(i + 1) * w1 + N.getX(i + 2) * w2, N.getY(i) * w0 + N.getY(i + 1) * w1 + N.getY(i + 2) * w2, N.getZ(i) * w0 + N.getZ(i + 1) * w1 + N.getZ(i + 2) * w2).normalize();
          paint(_pp, _nn, tag, _cl);
          _cl.convertLinearToSRGB();
          D[idx * 4] = _cl.r * 255;
          D[idx * 4 + 1] = _cl.g * 255;
          D[idx * 4 + 2] = _cl.b * 255;
          D[idx * 4 + 3] = 255;
          done[idx] = mn >= 0 ? 2 : 1;
        }
      }
    }
    for (let k = 0; k < 3; k++) U.setXY(i + k, X[k] / ATLAS, 1 - Y[k] / ATLAS);
  }
  // Kenar boşluğunu komşu renklerle doldur
  for (let pass = 0; pass <= PAD; pass++) {
    for (let py = y0 - PAD; py < y0 + h + PAD; py++) {
      for (let px = x0 - PAD; px < x0 + w + PAD; px++) {
        const idx = py * ATLAS + px;
        if (px < 0 || py < 0 || px >= ATLAS || py >= ATLAS || done[idx]) continue;
        for (const o of [-1, 1, -ATLAS, ATLAS]) {
          const j = idx + o;
          if (j >= 0 && j < done.length && done[j] && done[j] !== 3 + pass) {
            D.copyWithin(idx * 4, j * 4, j * 4 + 4);
            done[idx] = 3 + pass;
            break;
          }
        }
      }
    }
  }
  atlas.dirty = true;
}
// Parçaları tek geometride birleştir, dokuya boya. ref: desenin hesaplandığı çerçeve (hayvanın kendisi), skip: ayrı çizilen parçalar
function bake(target: THREE.Object3D, paint: Painter, tpm: number, ref: THREE.Object3D = target, skip: THREE.Object3D[] = []) {
  atlasInit();
  ref.updateMatrixWorld(true);
  const refInv = ref.matrixWorld.clone().invert();
  const back = target.matrixWorld.clone().invert().multiply(ref.matrixWorld);
  const parts: { geo: THREE.BufferGeometry; tag: string; w: number; h: number }[] = [];
  const m = new THREE.Matrix4();
  const walk = (o: THREE.Object3D) => {
    if (skip.includes(o)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      m.multiplyMatrices(refInv, mesh.matrixWorld);
      let geo = mesh.geometry.clone().applyMatrix4(m);
      if (geo.index) geo = geo.toNonIndexed();
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
      const [su, sv] = uvScale(geo);
      const cl = (v: number) => THREE.MathUtils.clamp(Math.round(v * tpm), 2, 200);
      parts.push({ geo, tag: mesh.name, w: cl(su), h: cl(sv) });
    }
    for (const c of o.children) walk(c);
  };
  walk(target);
  parts.sort((a, b) => b.h - a.h);
  for (const p of parts) {
    paintPart(p.geo, p.tag, p.w, p.h, paint);
    p.geo.applyMatrix4(back);
  }
  const geo = mergeGeometries(parts.map(p => p.geo))!;
  parts.forEach(p => p.geo.dispose());
  return geo;
}
// Pişmiş hayvan modeli: gövde ve (varsa) ayrı dönen parça (boyun, baş, hortum). Her tür bir kez pişirilir.
interface Model { body: THREE.BufferGeometry; pivot?: { geo: THREE.BufferGeometry; pos: THREE.Vector3; quat: THREE.Quaternion } }
const MODELS = new Map<string, Model>();
// tpm: metre başına doku noktası (desenli hayvanlarda sık, düz renklilerde seyrek)
function model(key: string, build: () => { g: THREE.Group; pivot?: THREE.Object3D }, paint: Painter, tpm: number): Model {
  let md = MODELS.get(key);
  if (md) return md;
  const b = build();
  b.g.updateMatrixWorld(true);
  md = { body: bake(b.g, paint, tpm, b.g, b.pivot ? [b.pivot] : []) };
  if (b.pivot) md.pivot = { geo: bake(b.pivot, paint, tpm, b.g), pos: b.pivot.position.clone(), quat: b.pivot.quaternion.clone() };
  MODELS.set(key, md);
  return md;
}

// Ağ benekler (zürafa): 3 boyutlu hücreler; hücre sınırları açık renk çizgi
function voronoi(p: THREE.Vector3, cs: number) {
  const ix = Math.floor(p.x / cs), iy = Math.floor(p.y / cs), iz = Math.floor(p.z / cs);
  let d1 = 9, d2 = 9, id = 0;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const X = ix + a, Y = iy + b, Zc = iz + c;
    const sx = (X + 0.15 + 0.7 * hash3(X, Y, Zc)) * cs, sy = (Y + 0.15 + 0.7 * hash3(Y + 7, Zc, X)) * cs, sz = (Zc + 0.15 + 0.7 * hash3(Zc - 3, X, Y)) * cs;
    const d = Math.hypot(p.x - sx, p.y - sy, p.z - sz);
    if (d < d1) {
      d2 = d1;
      d1 = d;
      id = hash3(X * 1.3, Y * 1.7, Zc * 2.1);
    } else if (d < d2) d2 = d;
  }
  return { edge: d2 - d1, id };
}
// Tüy dokusu: ince, düzensiz açık-koyu oynama
const fur = (p: THREE.Vector3, k = 1) => 1 + k * (0.07 * Math.sin(p.x * 61 + p.y * 37) * Math.sin(p.z * 53 - p.y * 29) + 0.05 * (hash3(Math.round(p.x * 70), Math.round(p.y * 70), Math.round(p.z * 70)) - 0.5));

const GIR = { line: col('#efdcb2'), a: col('#7e4016'), b: col('#a35a22'), leg: col('#ecdcb8'), head: col('#c98d4a'), muzzle: col('#e6cfa6'), mane: col('#6b3a1a'), dark: col('#2b1d14') };
const paintGiraffe: Painter = (p, n, tag, out) => {
  if (tag === 'dark') out.copy(GIR.dark);
  else if (tag === 'mane') out.copy(GIR.mane);
  else if (tag === 'muzzle') out.copy(GIR.muzzle);
  else if (tag === 'ear' || tag === 'horn') out.copy(GIR.head);
  else if (tag === 'head') {
    const v = voronoi(p, 0.11);
    out.copy(v.edge < 0.03 || p.z > 0.95 ? GIR.head : GIR.a.clone().lerp(GIR.head, 0.45));
  } else if (tag === 'leg') {
    const v = voronoi(p, 0.13);
    out.copy(p.y < 0.6 + 0.2 * v.id || v.edge < 0.035 ? GIR.leg : GIR.b.clone().lerp(GIR.leg, 0.35));
  } else {
    const v = voronoi(p, 0.24);
    out.copy(v.edge < 0.045 ? GIR.line : GIR.a.clone().lerp(GIR.b, v.id * 0.8));
    if (n.y < -0.5 && p.y < 2.1) out.lerp(GIR.line, 0.55);
  }
  out.multiplyScalar(fur(p, 0.6));
};
// Zürafa: uzun ince bacaklar ve dizler, önü yüksek gövde, yele, uzun boyun, kulaklar, boynuzcuklar, püsküllü kuyruk.
// neck: boyun ve başın bağlı olduğu grup (omuzda döner)
function giraffe() {
  const g = new THREE.Group();
  for (const [x, z, top] of [[-0.19, 0.7, 2.05], [0.19, 0.7, 2.05], [-0.18, -0.72, 1.9], [0.18, -0.72, 1.9]] as V3[]) {
    tp(g, 'dark', [x, 0, z], [x, 0.08, z], 0.075, 0.06, 7);
    tp(g, 'leg', [x, 0.07, z], [x, 1.0, z + 0.02], 0.055, 0.072, 6);
    el(g, 'leg', [x, 1.0, z + 0.03], [0.085, 0.09, 0.09], [0, 0, 0], [6, 4]);
    tp(g, 'body', [x, 1.0, z + 0.02], [x * 1.08, top, z * 0.94], 0.075, 0.16, 7);
  }
  elz(g, 'body', [0, 2.22, 0.0], [0.42, 0.55, 1.08], -0.18, [12, 12]);
  el(g, 'body', [0, 2.45, 0.52], [0.38, 0.5, 0.55], [0, 0, 0], [10, 7]);
  el(g, 'body', [0, 2.12, -0.72], [0.36, 0.42, 0.42], [0, 0, 0], [9, 7]);
  tp(g, 'body', [0, 2.3, -1.06], [0, 1.25, -1.2], 0.045, 0.025, 5);
  el(g, 'dark', [0, 1.13, -1.21], [0.06, 0.15, 0.06], [0, 0, 0], [6, 5]);
  const neck = new THREE.Group();
  neck.position.set(0, 2.45, 0.78);
  g.add(neck);
  tp(neck, 'body', [0, -0.1, -0.04], [0, 1.9, 0.58], 0.31, 0.15, 9);
  el(neck, 'body', [0, -0.05, -0.02], [0.32, 0.34, 0.32], [0, 0, 0], [9, 6]);
  el(neck, 'body', [0, 1.92, 0.6], [0.15, 0.16, 0.15], [0, 0, 0], [8, 5]);
  tp(neck, 'mane', [0, 0.15, -0.22], [0, 1.88, 0.44], 0.05, 0.035, 4);
  el(neck, 'head', [0, 2.02, 0.75], [0.14, 0.16, 0.33], [0.5, 0, 0], [9, 7]);
  el(neck, 'muzzle', [0, 1.88, 1.0], [0.11, 0.11, 0.13], [0.5, 0, 0], [6, 4]);
  for (const sx of [-1, 1]) {
    tp(neck, 'horn', [sx * 0.06, 2.1, 0.6], [sx * 0.085, 2.32, 0.55], 0.032, 0.026, 5);
    el(neck, 'dark', [sx * 0.085, 2.33, 0.55], [0.04, 0.04, 0.04], [0, 0, 0], [5, 4]);
    el(neck, 'ear', [sx * 0.17, 2.12, 0.58], [0.12, 0.035, 0.055], [0, sx * 0.3, sx * 0.35], [6, 4]);
    el(neck, 'dark', [sx * 0.115, 2.06, 0.8], [0.035, 0.035, 0.035], [0, 0, 0], [5, 4]);
  }
  return { g, pivot: neck };
}

const ZEB = { white: col('#f1efe8'), black: col('#1d1d20'), nose: col('#2a2624') };
const stripe = (v: number, out: THREE.Color, th = 0.1) => out.copy(Math.sin(v * Math.PI * 2) > th ? ZEB.black : ZEB.white);
const paintZebra: Painter = (p, n, tag, out) => {
  if (tag === 'dark') out.copy(ZEB.nose);
  else if (tag === 'leg') {
    if (p.y < 0.14) out.copy(p.y < 0.07 ? ZEB.black : ZEB.white);
    else stripe(p.y * 6, out, 0.15);
  } else if (tag === 'mane') stripe(p.y * 10 + p.z * 3, out, -0.1);
  else if (tag === 'head') stripe(p.z * 9 + p.y * 3.5, out, 0.25);
  else if (tag === 'ear') out.copy(p.y > 1.95 ? ZEB.black : ZEB.white);
  else if (tag === 'neck') stripe(p.y * 5.5 + p.z * 2.4, out, 0.05);
  else {
    // Gövde: önde dik, arkada (sağrıda) yatık çizgiler; karın beyaz, sırtta ince koyu çizgi
    const w = 0.05 * Math.sin(p.y * 9 + p.x * 4);
    if (p.z < -0.32) stripe(p.y * 4.2 + (p.z + 0.32) * 2.8 + w, out, 0.05);
    else stripe(p.z * 3.7 + p.y * 0.45 + w, out, 0.05);
    if (p.y < 0.82 && n.y < -0.4) out.copy(ZEB.white);
    if (n.y > 0.93 && Math.abs(p.x) < 0.05) out.copy(ZEB.black);
  }
  out.multiplyScalar(fur(p, 0.4));
};
// Zebra: tıknaz at gövdesi, dik yele, çizgili baş ve bacaklar, koyu burun, püsküllü kuyruk
function zebra() {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.15, 0.52], [0.15, 0.52], [-0.15, -0.55], [0.15, -0.55]]) {
    tp(g, 'dark', [x, 0, z], [x, 0.06, z], 0.06, 0.05, 6);
    tp(g, 'leg', [x, 0.05, z], [x, 0.52, z], 0.045, 0.06, 6);
    tp(g, 'body', [x, 0.5, z], [x * 1.05, 0.98, z * 0.96], 0.07, 0.13, 7);
  }
  elz(g, 'body', [0, 1.05, 0], [0.29, 0.36, 0.8], 0, [11, 13]);
  el(g, 'body', [0, 1.06, -0.48], [0.29, 0.35, 0.32], [0, 0, 0], [9, 6]);
  el(g, 'body', [0, 1.03, 0.48], [0.26, 0.35, 0.3], [0, 0, 0], [9, 6]);
  tp(g, 'body', [0, 1.2, -0.78], [0, 0.66, -0.88], 0.03, 0.02, 4);
  el(g, 'dark', [0, 0.6, -0.89], [0.04, 0.1, 0.04], [0, 0, 0], [5, 4]);
  const neck = new THREE.Group();
  neck.position.set(0, 1.12, 0.6);
  g.add(neck);
  tp(neck, 'neck', [0, -0.05, -0.08], [0, 0.55, 0.38], 0.21, 0.12, 8);
  el(neck, 'neck', [0, -0.03, -0.06], [0.21, 0.22, 0.21], [0, 0, 0], [8, 5]);
  el(neck, 'neck', [0, 0.55, 0.38], [0.12, 0.12, 0.12], [0, 0, 0], [8, 5]);
  tp(neck, 'mane', [0, 0.1, -0.2], [0, 0.68, 0.26], 0.035, 0.03, 4);
  el(neck, 'head', [0, 0.56, 0.62], [0.11, 0.13, 0.28], [0.95, 0, 0], [9, 6]);
  el(neck, 'dark', [0, 0.38, 0.82], [0.085, 0.08, 0.09], [0.95, 0, 0], [7, 5]);
  for (const sx of [-1, 1]) {
    el(neck, 'ear', [sx * 0.08, 0.76, 0.46], [0.04, 0.1, 0.03], [-0.3, 0, sx * 0.35], [5, 4]);
    el(neck, 'dark', [sx * 0.1, 0.6, 0.6], [0.025, 0.025, 0.025], [0, 0, 0], [4, 3]);
  }
  return { g, pivot: neck };
}

const ELE = { skin: col('#8e8882'), dust: col('#8d7563'), dark: col('#3d3a37'), tusk: col('#efe6d0'), ear: col('#8b7d79') };
const paintElephant: Painter = (p, n, tag, out) => {
  if (tag === 'tusk') return void out.copy(ELE.tusk);
  if (tag === 'dark') return void out.copy(ELE.dark);
  out.copy(ELE.skin).lerp(ELE.dust, 1 - S(p.y, 0.5, 1.7));
  if (tag === 'ear' && n.z > 0.2) out.lerp(ELE.ear, 0.5);
  // Kırışıklıklar: hortumda halka halka, gövdede ağ gibi
  const w = tag === 'trunk' ? Math.sin(p.y * 70) : Math.sin(p.y * 22 + p.z * 7) * Math.sin(p.x * 17 + p.z * 11);
  out.multiplyScalar(0.92 + 0.07 * w + 0.05 * hash3(Math.round(p.x * 40), Math.round(p.y * 40), Math.round(p.z * 40)) - (n.y < -0.4 ? 0.12 : 0));
};
// Afrika fili: kalın sütun bacaklar, fıçı gövde, iri baş ve alın, yelpaze kulaklar, fildişleri, uzun hortum.
// trunk: hortumun bağlı olduğu grup (alında döner)
function elephant() {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.42, 0.78], [0.42, 0.78], [-0.42, -0.78], [0.42, -0.78]]) {
    tp(g, 'body', [x, 0.0, z], [x, 0.16, z], 0.32, 0.3, 8);
    tp(g, 'body', [x, 0.14, z], [x * 0.95, 1.55, z * 0.95], 0.28, 0.34, 8);
    for (const k of [-1, 0, 1]) el(g, 'tusk', [x + k * 0.12, 0.05, z + 0.28], [0.05, 0.045, 0.03], [0, 0, 0], [5, 4]);
  }
  el(g, 'body', [0, 2.0, -0.1], [0.78, 0.95, 1.45], [0, 0, 0], [13, 10]);
  el(g, 'body', [0, 2.2, 0.72], [0.72, 0.88, 0.62], [0, 0, 0], [9, 7]);
  el(g, 'body', [0, 2.45, 1.4], [0.5, 0.62, 0.5], [0.2, 0, 0], [9, 7]);
  el(g, 'body', [0, 2.82, 1.5], [0.36, 0.3, 0.3], [0, 0, 0], [10, 6]);
  for (const sx of [-1, 1]) {
    el(g, 'ear', [sx * 0.62, 2.35, 1.12], [0.07, 0.75, 0.56], [0, sx * 0.55, sx * 0.1], [9, 7]);
    el(g, 'dark', [sx * 0.43, 2.55, 1.72], [0.05, 0.05, 0.05], [0, 0, 0], [5, 4]);
    chain(g, 'tusk', [[sx * 0.22, 2.05, 1.8], [sx * 0.27, 1.75, 2.12], [sx * 0.24, 1.66, 2.42]], [0.07, 0.055, 0.025], 6);
  }
  tp(g, 'body', [0, 2.3, -1.52], [0, 1.35, -1.66], 0.05, 0.03, 5);
  el(g, 'dark', [0, 1.28, -1.67], [0.05, 0.1, 0.05], [0, 0, 0], [5, 4]);
  const trunk = new THREE.Group();
  trunk.position.set(0, 2.3, 1.85);
  g.add(trunk);
  chain(trunk, 'trunk', [[0, 0, 0], [0, -0.45, 0.22], [0, -0.95, 0.28], [0, -1.42, 0.24], [0, -1.78, 0.36], [0, -1.86, 0.5]], [0.24, 0.19, 0.15, 0.115, 0.085, 0.07], 7);
  return { g, pivot: trunk };
}

const LIO = { coat: col('#c79a56'), back: col('#a97d43'), belly: col('#e6cca0'), mane: col('#7a4a22'), maneD: col('#4a2b14'), muzzle: col('#efdcb8'), dark: col('#33241a') };
const paintLion: Painter = (p, n, tag, out) => {
  if (tag === 'dark') out.copy(LIO.dark);
  else if (tag === 'mane') out.copy(LIO.mane).lerp(LIO.maneD, S(-n.z, -0.2, 0.8) * 0.6).multiplyScalar(fur(p, 2.2));
  else if (tag === 'muzzle') out.copy(LIO.muzzle);
  else {
    out.copy(LIO.coat).lerp(LIO.back, S(n.y, 0.5, 1) * 0.6);
    if (n.y < -0.3) out.lerp(LIO.belly, 0.6);
    out.multiplyScalar(fur(p, 0.8));
  }
};
function lionHead(h: THREE.Object3D, male: boolean) {
  if (male) {
    el(h, 'mane', [0, 0.03, 0.06], [0.36, 0.4, 0.33], [0, 0, 0], [9, 6]);
    el(h, 'mane', [0, -0.22, -0.02], [0.28, 0.32, 0.3], [0, 0, 0], [9, 6]);
  }
  el(h, 'head', [0, 0.06, 0.26], [0.19, 0.2, 0.23], [0, 0, 0], [10, 7]);
  el(h, 'muzzle', [0, -0.03, 0.44], [0.11, 0.09, 0.11], [0, 0, 0], [8, 6]);
  el(h, 'dark', [0, 0.02, 0.54], [0.045, 0.03, 0.025], [0, 0, 0], [5, 4]);
  for (const sx of [-1, 1]) {
    el(h, 'head', [sx * 0.13, 0.22, 0.2], [0.06, 0.065, 0.035], [0, 0, 0], [6, 4]);
    el(h, 'dark', [sx * 0.08, 0.1, 0.45], [0.025, 0.02, 0.02], [0, 0, 0], [4, 3]);
  }
}
// Aslan (ayakta, yürür): uzun gövde, kaslı omuz ve kalçalar, erkekte koyu kabarık yele, püsküllü kuyruk
function lion(male: boolean) {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.15, 0.5], [0.15, 0.5], [-0.15, -0.52], [0.15, -0.52]]) {
    tp(g, 'body', [x, 0.06, z], [x, 0.66, z], 0.065, 0.1, 6);
    el(g, 'body', [x, 0.05, z + 0.05], [0.08, 0.05, 0.1], [0, 0, 0], [6, 4]);
    el(g, 'body', [x * 1.05, 0.78, z * 0.95], [0.12, 0.22, 0.18], [0, 0, 0], [7, 5]);
  }
  elz(g, 'body', [0, 0.84, 0], [0.26, 0.3, 0.78], 0, [10, 10]);
  chain(g, 'body', [[0, 0.92, -0.75], [0, 0.62, -1.05], [0, 0.5, -1.4], [0, 0.6, -1.58]], [0.035, 0.03, 0.026, 0.022], 5);
  el(g, 'dark', [0, 0.63, -1.62], [0.05, 0.06, 0.07], [0, 0, 0], [5, 4]);
  const head = new THREE.Group();
  head.position.set(0, 1.0, 0.72);
  g.add(head);
  lionHead(head, male);
  return { g, pivot: head };
}
// Yatan aslan: ön patiler öne uzanmış, başı dik
function lionLying(male: boolean) {
  const g = new THREE.Group();
  elz(g, 'body', [0, 0.3, -0.1], [0.3, 0.29, 0.78], 0, [10, 10]);
  el(g, 'body', [0.16, 0.24, -0.55], [0.18, 0.2, 0.3], [0, 0, 0], [8, 6]);
  for (const sx of [-1, 1]) {
    tp(g, 'body', [sx * 0.13, 0.14, 0.42], [sx * 0.14, 0.07, 0.92], 0.08, 0.065, 7);
    el(g, 'body', [sx * 0.14, 0.06, 0.98], [0.085, 0.055, 0.11], [0, 0, 0], [6, 4]);
  }
  chain(g, 'body', [[0.1, 0.25, -0.86], [0.3, 0.05, -1.1], [0.45, 0.04, -1.4]], [0.035, 0.03, 0.025], 5);
  el(g, 'dark', [0.48, 0.05, -1.46], [0.05, 0.05, 0.07], [0, 0, 0], [5, 4]);
  const head = new THREE.Group();
  head.position.set(0, 0.55, 0.52);
  head.rotation.y = male ? -0.3 : 0.4;
  g.add(head);
  lionHead(head, male);
  return { g, pivot: head };
}

const BRB = { fur: col('#5a3b23'), top: col('#80593a'), dark: col('#2e2017'), snout: col('#8f6e4c') };
const paintBear: Painter = (p, n, tag, out) => {
  if (tag === 'dark') out.copy(BRB.dark);
  else if (tag === 'snout') out.copy(BRB.snout);
  else out.copy(BRB.fur).lerp(BRB.top, S(n.y, 0.3, 1) * 0.7).multiplyScalar(fur(p, 1.8));
};
// Boz ayı: kalın bacaklar, omuz kamburu, iri baş, kısa burun, yuvarlak kulaklar
function bear() {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.24, 0.5], [0.24, 0.5], [-0.24, -0.55], [0.24, -0.55]]) {
    tp(g, 'body', [x, 0.08, z], [x, 0.72, z], 0.13, 0.17, 7);
    el(g, 'dark', [x, 0.06, z + 0.06], [0.15, 0.07, 0.18], [0, 0, 0], [7, 5]);
  }
  el(g, 'body', [0, 0.95, -0.05], [0.45, 0.5, 0.88], [0, 0, 0], [9, 7]);
  el(g, 'body', [0, 1.2, 0.38], [0.36, 0.32, 0.38], [0, 0, 0], [9, 7]);
  el(g, 'body', [0, 0.97, -0.6], [0.4, 0.45, 0.38], [0, 0, 0], [9, 7]);
  const head = new THREE.Group();
  head.position.set(0, 1.08, 0.78);
  g.add(head);
  el(head, 'body', [0, 0, 0.22], [0.26, 0.25, 0.28], [0, 0, 0], [9, 7]);
  el(head, 'body', [0, 0.02, -0.05], [0.27, 0.27, 0.25], [0, 0, 0], [8, 5]);
  el(head, 'snout', [0, -0.06, 0.5], [0.13, 0.12, 0.18], [0, 0, 0], [8, 6]);
  el(head, 'dark', [0, -0.02, 0.67], [0.06, 0.045, 0.04], [0, 0, 0], [5, 4]);
  for (const sx of [-1, 1]) {
    el(head, 'body', [sx * 0.18, 0.2, 0.13], [0.08, 0.08, 0.05], [0, 0, 0], [6, 4]);
    el(head, 'dark', [sx * 0.11, 0.07, 0.42], [0.025, 0.025, 0.02], [0, 0, 0], [4, 3]);
  }
  return { g, pivot: head };
}

const PEN = { back: col('#262a31'), silver: col('#7d8692'), white: col('#f3f2ee'), yellow: col('#f3d27e'), orange: col('#f09a2c'), dark: col('#15171b') };
const paintPenguin: Painter = (p, n, tag, out) => {
  if (tag === 'beak') out.copy(p.z > 0.2 ? PEN.dark : PEN.orange);
  else if (tag === 'foot' || tag === 'flip') out.copy(PEN.back);
  else if (tag === 'head') out.copy(Math.abs(n.x) > 0.55 && p.y < 0.9 && n.z < 0.3 ? PEN.orange : PEN.dark);
  else if (n.z > 0.1 + 0.25 * Math.abs(n.x) && p.y < 0.8) out.copy(p.y > 0.64 ? PEN.yellow : PEN.white);
  else out.copy(n.z < -0.1 && p.y > 0.25 ? PEN.silver : PEN.back);
};
// Kral pengueni: yumurta gövde, beyaz göğüs, sarı boyun, turuncu kulak lekesi, uzun gaga, kanatçıklar
function penguin(swim = false) {
  const g = new THREE.Group();
  el(g, 'body', [0, 0.42, 0], [0.17, 0.42, 0.16], [0, 0, 0], [9, 7]);
  el(g, 'head', [0, 0.85, 0.03], [0.1, 0.1, 0.11], [0, 0, 0], [7, 5]);
  tp(g, 'beak', [0, 0.84, 0.11], [0, 0.8, 0.26], 0.03, 0.008, 4);
  for (const sx of [-1, 1]) {
    el(g, 'flip', [sx * 0.16, 0.5, -0.02], [0.03, 0.22, 0.08], [0, 0, sx * (swim ? 0.9 : 0.25)], [5, 4]);
    if (!swim) el(g, 'foot', [sx * 0.06, 0.02, 0.06], [0.05, 0.02, 0.07], [0, 0, 0], [4, 3]);
  }
  return { g };
}

const ORA = { hair: col('#9a4220'), light: col('#c4652d'), face: col('#4a3a32'), dark: col('#2a201b') };
const paintOrangutan: Painter = (p, n, tag, out) => {
  if (tag === 'face') out.copy(ORA.face);
  else if (tag === 'dark') out.copy(ORA.dark);
  else out.copy(ORA.hair).lerp(ORA.light, S(n.y, 0.2, 1) * 0.5).multiplyScalar(fur(p, 2.5));
};
// Orangutan: oturan ya da (hang) ipe asılı; uzun kollar, turuncu-kızıl tüyler, koyu yüz
function orangutan(hang = false) {
  const g = new THREE.Group();
  el(g, 'body', [0, 0.45, 0], [0.3, 0.4, 0.26], [0, 0, 0], [9, 7]);
  el(g, 'body', [0, 0.95, 0.04], [0.17, 0.18, 0.16], [0, 0, 0], [8, 6]);
  el(g, 'face', [0, 0.92, 0.15], [0.13, 0.13, 0.06], [0, 0, 0], [8, 6]);
  el(g, 'dark', [0, 0.9, 0.2], [0.05, 0.03, 0.02], [0, 0, 0], [4, 3]);
  for (const sx of [-1, 1]) {
    if (hang) {
      chain(g, 'body', [[sx * 0.24, 0.75, 0], [sx * 0.2, 1.25, 0.02], [sx * 0.06, 1.7, 0]], [0.09, 0.075, 0.065], 6);
      chain(g, 'body', [[sx * 0.16, 0.15, 0], [sx * 0.2, -0.25, 0.08], [sx * 0.17, -0.55, 0.05]], [0.1, 0.08, 0.07], 6);
    } else {
      chain(g, 'body', [[sx * 0.27, 0.72, 0], [sx * 0.42, 0.36, 0.1], [sx * 0.38, 0.06, 0.28]], [0.09, 0.08, 0.07], 6);
      el(g, 'dark', [sx * 0.38, 0.04, 0.32], [0.07, 0.04, 0.08], [0, 0, 0], [5, 4]);
      tp(g, 'body', [sx * 0.16, 0.2, 0.08], [sx * 0.26, 0.12, 0.38], 0.1, 0.08, 6);
      el(g, 'body', [sx * 0.26, 0.12, 0.38], [0.08, 0.08, 0.08], [0, 0, 0], [6, 4]);
    }
  }
  return { g };
}
// Modeller (her tür bir kez pişirilir)
const MOD = {
  giraffe: () => model('giraffe', giraffe, paintGiraffe, 30),
  zebra: () => model('zebra', zebra, paintZebra, 34),
  elephant: () => model('elephant', elephant, paintElephant, 12),
  lioness: () => model('lioness', () => lion(false), paintLion, 20),
  lionLie: () => model('lionLie', () => lionLying(true), paintLion, 20),
  lionessLie: () => model('lionessLie', () => lionLying(false), paintLion, 20),
  bear: () => model('bear', bear, paintBear, 14),
  penguin: () => model('penguin', () => penguin(), paintPenguin, 40),
  penguinSwim: () => model('penguinSwim', () => penguin(true), paintPenguin, 30),
  orangutan: () => model('orangutan', () => orangutan(), paintOrangutan, 20),
  orangutanHang: () => model('orangutanHang', () => orangutan(true), paintOrangutan, 20),
};
// Sabit hayvan: pişmiş modeli yerine koy; pose ile boyun/baş döndürülebilir
function placeAnimal(st: THREE.Group, md: Model, x: number, z: number, rot: number, size = 1, y?: number, pose?: (p: THREE.Object3D) => void) {
  const o = item(st, x, z, rot, AM * size, y ?? height(x, z) - 0.001);
  add(o, md.body, ANIMAL_MAT, 0, 0, 0);
  if (md.pivot) {
    const p = new THREE.Group();
    p.position.copy(md.pivot.pos);
    p.quaternion.copy(md.pivot.quat);
    pose?.(p);
    o.add(p);
    add(p, md.pivot.geo, ANIMAL_MAT, 0, 0, 0);
  }
  return o;
}

// ---------- İnsanlar (şehirdeki boyda, ~0.15) ----------
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524'].map(c => pm(c, 0.8));
const HAIR = ['#2b1d14', '#5a3825', '#c99a4e', '#161616', '#8a4b2a'].map(c => pm(c, 0.9));
const LEGS = [M.navy, pm('#3d4450'), M.white, pm('#c2a77e'), M.teal];
const BODY_GEO = new THREE.CylinderGeometry(0.0155, 0.0125, 0.046, 7).scale(1, 1, 0.66);
const HIP_GEO = new THREE.CylinderGeometry(0.0135, 0.0125, 0.02, 7, 1, true);
const HEAD_GEO = new THREE.SphereGeometry(0.0105, 6, 4);
const HAIR_GEO = new THREE.SphereGeometry(0.0113, 6, 2, 0, Math.PI * 2, 0, Math.PI * 0.5);
const SHOE_GEO = new THREE.BoxGeometry(0.008, 0.005, 0.015);
function limb(g: THREE.Object3D, a: V3, b: V3, r: number, m: THREE.Material) {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const o = add(g, new THREE.CylinderGeometry(r, r, d.length(), 4, 1, true), m, A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
}
// k: renk seçimi. pose: 0 ayakta, 1 oturuyor, 2 el sallıyor / hayvanı besliyor (bir kol önde yukarıda). size: çocuklar küçük
function person(g: THREE.Object3D, x: number, z: number, rot: number, k: number, pose = 0, y = G, size = 1) {
  const p = item(g, x, z, rot, SC * size, y);
  const skin = SKIN[k % SKIN.length];
  const hair = HAIR[(k * 3 + 1) % HAIR.length];
  const top = PAINT[(k * 5 + 2) % PAINT.length];
  const legs = LEGS[(k * 7 + 3) % LEGS.length];
  const hip = pose === 1 ? 0 : 0.07;
  for (const sx of [-0.0065, 0.0065]) {
    if (pose === 1) {
      limb(p, [sx, hip, -0.006], [sx, hip, 0.03], 0.0062, legs);
      limb(p, [sx, hip, 0.03], [sx, hip - 0.036, 0.033], 0.0052, skin);
      add(p, SHOE_GEO, M.iron, sx, hip - 0.0365, 0.036);
    } else {
      limb(p, [sx, hip, 0], [sx, 0.032, 0], 0.0062, legs);
      limb(p, [sx, 0.032, 0], [sx, 0.004, 0], 0.0052, skin);
      add(p, SHOE_GEO, M.iron, sx, 0.0025, 0.003);
    }
  }
  add(p, HIP_GEO, legs, 0, hip + 0.002, 0);
  const up = item(p, 0, 0, 0, 1, hip + 0.01);
  add(up, BODY_GEO, top, 0, 0.022, 0);
  add(up, HEAD_GEO, skin, 0, 0.06, 0);
  add(up, HAIR_GEO, hair, 0, 0.0615, -0.0012);
  for (const sd2 of [-1, 1]) {
    const sh: V3 = [sd2 * 0.0175, 0.04, 0];
    const hand: V3 = pose === 2 && sd2 > 0 ? [0.016, 0.075, 0.03] : pose === 1 ? [sd2 * 0.016, -0.004, 0.022] : [sd2 * 0.021, -0.006, 0.003];
    const elbow: V3 = [sh[0] + (hand[0] - sh[0]) * 0.42, sh[1] + (hand[1] - sh[1]) * 0.42, sh[2] + (hand[2] - sh[2]) * 0.42];
    limb(up, elbow, hand, 0.0042, skin);
    limb(up, sh, elbow, 0.0056, top);
  }
  return p;
}

// ---------- Yapılar ----------
// Saz çatı: kat kat dizilmiş saman (halkalar açık-koyu), tepede ahşap tepelik
const THATCH = { lo: col('#8f6a32'), hi: col('#d2b06a') };
function thatchCone(o: THREE.Object3D, r: number, h: number, y: number, seg = 14) {
  let geo: THREE.BufferGeometry = new THREE.ConeGeometry(r, h, seg, 4).translate(0, y + h / 2, 0);
  geo.deleteAttribute('uv');
  geo = faceColors(geo, (p, n, out) => {
    const t = (p.y - y) / h;
    out.copy(THATCH.lo).lerp(THATCH.hi, 0.35 + 0.5 * ((t * 4) % 1)).multiplyScalar(n.y < -0.5 ? 0.55 : 0.88 + 0.22 * hash3(p.x * 300, p.y * 300, p.z * 300));
  });
  add(o, geo, VC, 0, 0, 0);
}
function thatchHip(o: THREE.Object3D, w: number, d: number, h: number, y: number) {
  let geo: THREE.BufferGeometry = frustum(w, d, h, w * 0.18, d * 0.05).translate(0, y + h / 2, 0);
  geo = faceColors(geo, (p, n, out) => {
    const t = (p.y - y) / h;
    out.copy(THATCH.lo).lerp(THATCH.hi, 0.35 + 0.5 * ((t * 4) % 1)).multiplyScalar(n.y < -0.5 ? 0.55 : 0.9 + 0.2 * hash3(p.x * 300, p.y * 300, p.z * 300));
  });
  add(o, geo, VC, 0, 0, 0);
}
// Yuvarlak saz çatılı kulübe (bilet gişesi, seyir kulübesi): taş etek, sıva duvar, pencere
function hut(st: THREE.Group, x: number, z: number, r: number, wallH: number, rot: number, glassFront = true) {
  const o = item(st, x, z, rot, 1, G);
  cyl(o, r * 1.04, r * 1.08, 0.008, Z.stone, 0, 0, 0, 14);
  cyl(o, r, r, wallH, Z.plaster, 0, 0.008, 0, 14);
  if (glassFront) {
    box(o, r * 0.9, wallH * 0.4, 0.004, windowMat, 0, wallH * 0.38, r * 0.93);
    box(o, r * 1.05, 0.004, 0.012, Z.timber, 0, wallH * 0.36, r * 0.98);
  }
  box(o, r * 0.5, wallH * 0.75, 0.004, Z.timberDark, 0, 0.008, -r * 0.99).rotation.y = 0;
  thatchCone(o, r * 1.45, wallH * 1.05, wallH + 0.004);
  cyl(o, 0.003, 0.004, 0.012, Z.timberDark, 0, wallH * 2.05, 0, 5);
}
// Giriş: iki yanda saz çatılı bilet kulübesi, ortada kütük kemer ve "HAYVANAT BAHÇESİ" tabelası, turnikeler
function gate(st: THREE.Group) {
  const gz = 0.455;
  for (const sx of [-1, 1]) {
    hut(st, sx * 0.1, gz - 0.005, 0.034, 0.05, 0);
    // Taş duvar parçası ve çalılar kulübeden çite
    box(st, 0.07, 0.016, 0.012, Z.stone, sx * 0.165, G, gz + 0.012);
    box(st, 0.074, 0.004, 0.016, Z.stoneLight, sx * 0.165, G + 0.016, gz + 0.012);
  }
  // Kütük kemer
  for (const sx of [-1, 1]) {
    cyl(st, 0.0065, 0.0075, 0.125, Z.log, sx * 0.052, G, gz + 0.012, 8);
    rock(st, sx * 0.052, gz + 0.012, 0.012, 0.01, 0.012, T.grey, 40 + sx);
  }
  add(st, new THREE.CylinderGeometry(0.006, 0.006, 0.13, 8).rotateZ(Math.PI / 2), Z.log, 0, G + 0.12, gz + 0.012);
  add(st, new THREE.CylinderGeometry(0.005, 0.005, 0.12, 8).rotateZ(Math.PI / 2), Z.log, 0, G + 0.098, gz + 0.012);
  box(st, 0.095, 0.042, 0.006, Z.board, 0, G + 0.06, gz + 0.012);
  box(st, 0.088, 0.017, 0.002, signMat('HAYVANAT', '#3e2a1a', '#f6dfa8'), 0, G + 0.0815, gz + 0.016);
  box(st, 0.088, 0.017, 0.002, signMat('BAHÇESİ', '#3e2a1a', '#f6dfa8'), 0, G + 0.0625, gz + 0.016);
  for (const sx of [-1, 1]) rod(st, [sx * 0.03, G + 0.098, gz + 0.012], [sx * 0.03, G + 0.103, gz + 0.012], 0.0015, Z.rope, 4);
  // Kemerin üstünde küçük saz saçak
  thatchHip(item(st, 0, gz + 0.012, 0, 1, 0), 0.13, 0.03, 0.022, G + 0.125);
  // Turnikeler
  for (const x of [-0.025, 0, 0.025]) {
    box(st, 0.006, 0.02, 0.022, M.gray, x, G, gz - 0.02);
    box(st, 0.002, 0.002, 0.016, M.steel, x + 0.006, G + 0.017, gz - 0.02);
  }
}
// Hediyelik eşya dükkânı: taş etekli ahşap ev, saz kırma çatı, vitrin ve tabela
function shop(st: THREE.Group, x: number, z: number, rot: number, label: string, color: string) {
  const o = item(st, x, z, rot, 1, G);
  box(o, 0.12, 0.012, 0.08, Z.stone, 0, 0, 0);
  box(o, 0.112, 0.05, 0.072, Z.timber, 0, 0.012, 0);
  for (let k = 0; k < 9; k++) box(o, 0.0015, 0.05, 0.0015, Z.timberDark, -0.05 + k * 0.0125, 0.012, 0.0365);
  box(o, 0.07, 0.026, 0.003, windowMat, -0.015, 0.024, 0.037);
  box(o, 0.018, 0.04, 0.003, Z.timberDark, 0.04, 0.012, 0.037);
  box(o, 0.08, 0.014, 0.003, signMat(label, color), -0.005, 0.064, 0.038);
  thatchHip(o, 0.14, 0.1, 0.05, 0.062);
}
// Kafe: geniş saz çatılı ahşap köşk, önünde ahşap teras, şemsiyeli masalar ve oturan insanlar
function cafe(st: THREE.Group) {
  const o = item(st, 0.39, 0.4, -Math.PI / 2, 1, G);
  box(o, 0.12, 0.012, 0.09, Z.stone, 0, 0, 0);
  box(o, 0.11, 0.05, 0.08, Z.plaster, 0, 0.012, 0);
  box(o, 0.08, 0.026, 0.003, windowMat, 0, 0.026, 0.0415);
  box(o, 0.09, 0.006, 0.02, Z.timber, 0, 0.024, 0.052);
  box(o, 0.08, 0.014, 0.003, signMat('KAFE', '#ef6c00'), 0, 0.064, 0.0425);
  thatchHip(o, 0.15, 0.11, 0.05, 0.062);
  // Teras (üstü kafeye gelen yoldan belirgin yüksekte; yol terasın altına girer)
  const TY = G + 0.007;
  box(st, 0.12, TY - G, 0.11, Z.timber, 0.27, G, 0.4);
  for (let k = 0; k < 8; k++) box(st, 0.12, 0.001, 0.001, Z.timberDark, 0.27, TY, 0.35 + k * 0.014);
  for (const [tx, tz, c] of [[0.24, 0.37, 0], [0.3, 0.375, 2], [0.25, 0.43, 5], [0.31, 0.435, 1]] as V3[]) {
    const t = item(st, tx, tz, tx * 7, SC, TY);
    cyl(t, 0.026, 0.026, 0.005, M.white, 0, 0.03, 0, 10);
    rod(t, [0, 0, 0], [0, 0.03, 0], 0.003, M.iron, 4);
    rod(t, [0, 0.03, 0], [0, 0.1, 0], 0.0025, M.iron, 4);
    for (let j = 0; j < 8; j++) add(t, new THREE.ConeGeometry(0.06, 0.024, 2, 1, true, (j * Math.PI) / 4, Math.PI / 4), j % 2 ? M.white : PAINT[c], 0, 0.11, 0);
    for (const sd2 of [-1, 1]) box(t, 0.018, 0.018, 0.018, Z.timberDark, sd2 * 0.04, 0, 0);
  }
  person(st, 0.24 - 0.014, 0.37, Math.PI / 2, 3, 1, TY + 0.035 * SC);
  person(st, 0.31 + 0.014, 0.435, -Math.PI / 2, 6, 1, TY + 0.035 * SC);
  person(st, 0.25 - 0.014, 0.43, Math.PI / 2, 8, 1, TY + 0.035 * SC);
}
// Ahşap seyir terası: kazıklar üstünde döşeme, korkuluk; isteğe bağlı saz çatı
function deck(st: THREE.Group, x: number, z: number, w: number, d: number, h: number, rot: number, roof: boolean, glassSide = false) {
  const o = item(st, x, z, rot, 1, G);
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cyl(o, 0.003, 0.003, h + (roof ? 0.06 : 0.02), Z.log, (px * w) / 2.2, -0.02, (pz * d) / 2.2, 6);
  box(o, w, 0.004, d, Z.timber, 0, h, 0);
  for (let k = 0; k < Math.round(w / 0.012); k++) box(o, 0.0006, 0.0006, d, Z.timberDark, -w / 2 + k * 0.012, h + 0.004, 0);
  const rh = 0.018;
  // Korkuluk (arka taraf hayvanlara bakar; cam ya da ahşap)
  if (glassSide) box(o, w, rh, 0.002, GLASS, 0, h + 0.004, -d / 2);
  else for (const yy of [rh * 0.5, rh]) box(o, w, 0.002, 0.002, Z.timberDark, 0, h + yy, -d / 2);
  for (const sx of [-1, 1]) for (const yy of [rh * 0.5, rh]) box(o, 0.002, 0.002, d, Z.timberDark, (sx * w) / 2, h + yy, 0);
  if (roof) thatchHip(o, w * 1.15, d * 1.2, 0.03, h + 0.05);
  return o;
}

// ---------- Duvarlar ve hendekler ----------
// Kesintisiz alçak taş duvar: hendeğin dibinden yolun biraz üstüne kadar; her taş bölümü biraz farklı tonda, üstü açık renk
const WALL = { a: col('#a2978a'), b: col('#8b8172'), top: col('#cdc3af') };
function wallStrip(st: THREE.Group, pts: Pt[], seed: number) {
  const y0 = G - MD - 0.004, y1 = G + 0.011, t = 0.0045;
  const pos: number[] = [], cols: number[] = [];
  const c = new THREE.Color();
  const n = pts.length;
  const off = (i: number): Pt => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    return [(-dz / L) * t, (dx / L) * t];
  };
  // Dört köşeli yüz: dışa bakacak şekilde (want yönüne göre) iki üçgen
  const quad = (p: V3[], want: V3, color: THREE.Color) => {
    const e1 = new THREE.Vector3(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]);
    const e2 = new THREE.Vector3(p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]);
    const flip = e1.cross(e2).dot(new THREE.Vector3(...want)) < 0;
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const k of order) {
      pos.push(...p[k]);
      cols.push(color.r, color.g, color.b);
    }
  };
  for (let i = 0; i + 1 < n; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const oa = off(i), ob = off(i + 1);
    c.copy(WALL.a).lerp(WALL.b, hash3(i, seed, 7)).multiplyScalar(0.92 + 0.12 * hash3(seed, i, 3));
    for (const sd2 of [-1, 1]) {
      const A: V3 = [ax + oa[0] * sd2, y0, az + oa[1] * sd2], B: V3 = [bx + ob[0] * sd2, y0, bz + ob[1] * sd2];
      quad([A, B, [B[0], y1, B[2]], [A[0], y1, A[2]]], [oa[0] * sd2, 0, oa[1] * sd2], c);
    }
    c.copy(WALL.top).multiplyScalar(0.94 + 0.08 * hash3(i, seed, 1));
    quad([[ax + oa[0] * 1.4, y1, az + oa[1] * 1.4], [bx + ob[0] * 1.4, y1, bz + ob[1] * 1.4], [bx - ob[0] * 1.4, y1, bz - ob[1] * 1.4], [ax - oa[0] * 1.4, y1, az - oa[1] * 1.4]], [0, 1, 0], c);
  }
  // Uçlar
  for (const i of [0, n - 1]) {
    const [x, z] = pts[i], o = off(i);
    const prev = pts[i === 0 ? 1 : n - 2];
    quad([[x + o[0], y0, z + o[1]], [x - o[0], y0, z - o[1]], [x - o[0], y1, z - o[1]], [x + o[0], y1, z + o[1]]], [x - prev[0], 0, z - prev[1]], WALL.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  add(st, geo, VC, 0, 0, 0);
}
// Yaşam alanının yola yakın sınırında alçak taş duvar (hendeğin dik yüzünü örter) ya da cam panel;
// ziyaretçi tarafı olmayan sınırlarda doğal kaya sırası
function barrier(st: THREE.Group, hb: Hab) {
  const N = 150;
  const tone = hb.b === SAV ? T.sav : hb.b === LION ? T.lion : hb.b === BEAR ? T.grey : T.white;
  const kind: number[] = []; // 0 yok, 1 duvar, 2 cam
  const P: Pt[] = [];
  for (let k = 0; k < N; k++) P.push(edgePt(hb.b, (k / N) * Math.PI * 2, 0.003));
  for (let k = 0; k < N; k++) {
    const [x0, z0] = P[k], [x1, z1] = P[(k + 1) % N];
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    kind.push(moatF(mx, mz) < 0.5 ? 0 : hb.glass?.(mx, mz) ? 2 : 1);
  }
  // Duvar parçalarını kesintisiz şeritler halinde çiz (döngü boş bir yerden başlasın)
  const start = Math.max(0, kind.indexOf(0));
  let run: Pt[] = [];
  let g0 = 0;
  for (let j = 0; j <= N; j++) {
    const k = (start + j) % N;
    if (j < N && kind[k] === 1) {
      if (!run.length) run.push(P[k]);
      run.push(P[(k + 1) % N]);
      continue;
    }
    if (run.length > 1) wallStrip(st, run, k);
    run = [];
    if (j === N) break;
    const [x0, z0] = P[k], [x1, z1] = P[(k + 1) % N];
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    if (kind[k] === 2) {
      const o = item(st, mx, mz, -Math.atan2(z1 - z0, x1 - x0), 1, G);
      const len = Math.hypot(x1 - x0, z1 - z0) * 1.04;
      box(o, len, 0.006, 0.006, Z.stoneLight, 0, -0.003, 0);
      box(o, len, 0.022, 0.0025, GLASS, 0, 0.003, 0);
      if (g0++ % 5 === 0) box(o, 0.0015, 0.026, 0.003, M.steel, 0, 0, 0);
    } else if (k % 4 === 0 && LIM - Math.max(Math.abs(mx), Math.abs(mz)) > 0.03) {
      rock(st, mx, mz, 0.014, 0.013, 0.011, tone, k + 300);
    }
  }
}

// ---------- Yaşam alanları ----------
function termiteMound(st: THREE.Group, x: number, z: number, s: number) {
  const o = item(st, x, z, x * 7, s, height(x, z) - 0.002);
  let geo: THREE.BufferGeometry = new THREE.LatheGeometry([[0.018, 0], [0.016, 0.01], [0.01, 0.03], [0.006, 0.045], [0.0, 0.05]].map(([a, b]) => new THREE.Vector2(a, b)), 8);
  geo.deleteAttribute('uv');
  geo = faceColors(geo, (p, n, out) => out.copy(col('#a86a3e')).multiplyScalar(0.85 + 0.25 * hash3(p.x * 500, p.y * 500, p.z * 500) + 0.1 * n.y));
  add(o, geo, VC, 0, 0, 0);
  add(o, geo.clone().scale(0.6, 0.7, 0.6).translate(0.012, 0, 0.006), VC, 0, 0, 0);
}
function savanna(st: THREE.Group) {
  // Kaya tepeciği (kopje), akasyalar, kuru ağaç, termit tümseği, devrik kütük
  rockPile(st, -0.385, -0.405, 0.034, T.sav, 3, 5);
  rock(st, -0.335, -0.42, 0.022, 0.016, 0.02, T.sav, 11);
  rock(st, -0.42, -0.36, 0.018, 0.012, 0.016, T.sav, 14);
  acacia(st, -0.13, -0.43, 0.17, 7);
  acacia(st, -0.35, -0.1, 0.15, 8);
  acacia(st, -0.44, -0.26, 0.14, 10);
  acacia(st, -0.02, -0.37, 0.16, 9);
  deadTree(st, -0.25, -0.44, 0.12, 4);
  termiteMound(st, -0.235, -0.14, 1);
  log(st, -0.19, -0.31, 0.05, 0.005, 0.6);
  // Kuru ot öbekleri ve çalılar
  const r = rand(21);
  for (let k = 0; k < 120; k++) {
    const x = -0.46 + r() * 0.5, z = -0.47 + r() * 0.42;
    const d = sd(SAV, x, z);
    if (d > -0.045 || sd(HOLE, x, z) < 0.006 || Math.hypot(x + 0.385, z + 0.405) < 0.045) continue;
    tuft(st, k % 3 ? TUFTS.dry : TUFTS.gold, x, z, 0.016 + r() * 0.012, r() * 6);
  }
  for (const [x, z] of [[-0.45, -0.34], [-0.29, -0.45], [-0.06, -0.45], [-0.45, -0.12]] as Pt[]) tree(st, 'bush', x, z, 0.28, '#9a9a52', x * 9, 0);
  // Su birikintisinin kıyısında sazlar
  for (const a of [0.4, 2.6, 3.6]) {
    const [x, z] = edgePt(HOLE, a, -0.002);
    tuft(st, TUFTS.reed, x, z, 0.02, a);
  }
}
function lionArea(st: THREE.Group) {
  // Aslan kayası: üstü düz büyük kaya ve çevresinde kaya öbekleri
  const top = rock(st, 0.33, -0.365, 0.07, 0.048, 0.052, T.lion, 2, undefined, true);
  rock(st, 0.385, -0.335, 0.038, 0.03, 0.034, T.lion, 4);
  rock(st, 0.28, -0.4, 0.034, 0.024, 0.03, T.lion, 5);
  rockPile(st, 0.43, -0.22, 0.022, T.lion, 6, 3);
  rockPile(st, 0.2, -0.41, 0.02, T.lion, 8, 3);
  // Kuru ağaç (kedilerin tırmandığı), devrik gövde ve gölgelik akasya
  deadTree(st, 0.21, -0.28, 0.13, 6);
  log(st, 0.17, -0.36, 0.06, 0.0055, 1.2);
  acacia(st, 0.42, -0.41, 0.14, 12);
  const r = rand(31);
  for (let k = 0; k < 70; k++) {
    const x = 0.12 + r() * 0.36, z = -0.47 + r() * 0.34;
    if (sd(LION, x, z) > -0.045 || Math.hypot(x - 0.33, z + 0.365) < 0.07) continue;
    tuft(st, k % 4 ? TUFTS.dry : TUFTS.gold, x, z, 0.02 + r() * 0.012, r() * 6);
  }
  // Kayanın üstünde yatan erkek aslan, gölgede dişi
  placeAnimal(st, MOD.lionLie(), 0.335, -0.36, 0.6, 1, top - 0.002);
  placeAnimal(st, MOD.lionessLie(), 0.24, -0.345, -2.3, 0.95);
}
function bearArea(st: THREE.Group) {
  // Göletin kuzeyinde katman katman kaya duvarı; tepesinden gölete dökülen şelale
  const ledges: [number, number, number, number, number, number][] = [
    // x, z, en, boy, derinlik, kat
    [0.25, 0.098, 0.03, 0.016, 0.022, 0], [0.29, 0.092, 0.034, 0.016, 0.024, 0], [0.335, 0.098, 0.03, 0.015, 0.022, 0],
    [0.265, 0.082, 0.028, 0.015, 0.02, 1], [0.315, 0.078, 0.032, 0.015, 0.022, 1],
    [0.29, 0.064, 0.03, 0.014, 0.022, 2], [0.33, 0.068, 0.024, 0.013, 0.02, 2],
  ];
  let lip = G;
  ledges.forEach(([x, z, sx, sy, sz, k], i) => {
    const t = rock(st, x, z, sx, sy, sz, T.grey, 20 + i, G - 0.006 + k * 0.013, true);
    if (Math.abs(x - 0.29) < 0.01) lip = Math.max(lip, t);
  });
  rock(st, 0.22, 0.12, 0.02, 0.016, 0.018, T.grey, 30);
  rock(st, 0.26, 0.19, 0.02, 0.016, 0.018, T.grey, 31);
  // Şelale: kaya kenarından gölete inen su perdesi ve köpük
  {
    const pos: number[] = [], idx: number[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const y = lip + 0.001 - t * (lip + 0.001 - (G - 0.002));
      const z = 0.088 + 0.016 * Math.sin(t * Math.PI * 0.5) + t * 0.006;
      const w = 0.007 + k * 0.0009;
      pos.push(0.29 - w, y, z, 0.29 + w, y, z);
      if (k) idx.push((k - 1) * 2, k * 2, (k - 1) * 2 + 1, (k - 1) * 2 + 1, k * 2, k * 2 + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    add(st, geo, FALL, 0, 0, 0);
    // Arka yüzü (kamera döndürülünce de görünsün)
    const back = geo.clone();
    back.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]]));
    back.computeVertexNormals();
    add(st, back, FALL, 0, 0, 0);
    for (let k = 0; k < 5; k++) add(st, sph(6, 4), FALL, 0.282 + k * 0.004, G - 0.003, 0.112 + (k % 2) * 0.004).scale.set(0.007, 0.003, 0.006);
    // Kayanın üstündeki dere
    add(st, new THREE.PlaneGeometry(0.012, 0.04).rotateX(-Math.PI / 2), POOL, 0.29, lip + 0.0012, 0.068);
  }
  for (const [x, z, sz] of [[0.3, 0.0, 0.5], [0.255, 0.035, 0.42], [0.345, -0.015, 0.46], [0.455, 0.235, 0.4]] as V3[]) {
    tree(st, 'pine', x, z, sz, '#4f8a4a', x * 13, 1);
  }
  log(st, 0.33, 0.205, 0.045, 0.005, 2.6);
  const r = rand(41);
  for (let k = 0; k < 30; k++) {
    const x = 0.23 + r() * 0.24, z = -0.03 + r() * 0.24;
    if (sd(BEAR, x, z) > -0.04 || sd(BPOND, x, z) < 0.008 || (z < 0.11 && z > 0.05 && x < 0.36)) continue;
    tuft(st, TUFTS.green, x, z, 0.016 + r() * 0.01, r() * 6);
  }
  for (const [x, z] of [[0.25, 0.19], [0.36, 0.035], [0.465, 0.175]] as Pt[]) tree(st, 'bush', x, z, 0.28, '#5f8f45', x * 7, 0);
  rockPile(st, 0.44, 0.215, 0.016, T.grey, 33, 2);
  log(st, 0.455, 0.06, 0.04, 0.0045, 1.4);
  for (const a of [0.6, 2.4]) {
    const [x, z] = edgePt(BPOND, a, -0.002);
    tuft(st, TUFTS.reed, x, z, 0.018, a);
  }
  // Gölette balık avlayan ayı
  placeAnimal(st, MOD.bear(), 0.31, 0.15, -2.4, 1, G - 0.013, p => (p.rotation.x = 0.5));
}
function penguinArea(st: THREE.Group) {
  // Açık gri kayalar havuzun arka kıyısında; havuzun ortasında kayalık ada; arkada yuvalı kaya öbekleri
  const r = rand(51);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + r() * 0.2;
    if (a > 5.0 || a < 0.5) continue; // ön-sağ (ziyaretçi camı tarafı) açık kalsın
    const [x, z] = edgePt(PPOOL, a, 0.006 + r() * 0.01);
    const sz = 0.011 + r() * 0.012;
    rock(st, x, z, sz, sz * 0.75, sz * 0.9, T.white, k + 60);
  }
  rockPile(st, -0.43, 0.13, 0.028, T.white, 13, 3);
  rock(st, -0.405, 0.27, 0.028, 0.022, 0.024, T.white, 66);
  const islandTop = rock(st, -0.335, 0.195, 0.024, 0.016, 0.02, T.white, 67, undefined, true);
  // Kayada yuva kovukları
  for (const [x, z, a] of [[-0.425, 0.155, 0.6], [-0.4, 0.252, -0.3]] as V3[]) add(st, new THREE.CircleGeometry(0.006, 8, 0, Math.PI), M.iron, x, height(x, z) + 0.001, z).rotation.y = a;
  // Kıyıda ve kayalarda duran penguenler (küçük gruplar)
  const spots: V3[] = [[-0.25, 0.115, 0.4], [-0.238, 0.13, 1.2], [-0.262, 0.104, -0.2], [-0.415, 0.21, 1.5], [-0.405, 0.226, 2.1], [-0.3, 0.27, 3.3], [-0.285, 0.268, 2.6]];
  spots.forEach(([x, z, rot], k) => placeAnimal(st, MOD.penguin(), x, z, rot, 0.95 + (k % 3) * 0.06));
  placeAnimal(st, MOD.penguin(), -0.338, 0.19, 0.8, 0.95, islandTop - 0.002);
}
function islandArea(st: THREE.Group) {
  // Adada büyük ağaç, tırmanma iskelesi (kütükler, platform, halatlar), kayalar; kıyıda sazlar
  tree(st, 'round', 0.03, 0.09, 0.6, '#5aa245', 0.3, 1);
  tree(st, 'bush', -0.035, 0.15, 0.26, '#4f9a3c', 1, 0);
  tree(st, 'bush', 0.05, 0.15, 0.22, '#5aa245', 2, 0);
  rock(st, -0.035, 0.085, 0.016, 0.012, 0.014, T.moss, 70);
  const x0 = -0.02, z0 = 0.13, y0 = height(x0, z0);
  const H = 0.075;
  const posts: Pt[] = [[x0 - 0.022, z0 - 0.015], [x0 + 0.022, z0 - 0.015], [x0, z0 + 0.022]];
  for (const [px, pz] of posts) cyl(st, 0.0028, 0.0034, H + 0.012, Z.log, px, height(px, pz) - 0.004, pz, 6);
  for (let k = 0; k < 3; k++) {
    const [ax, az] = posts[k], [bx, bz] = posts[(k + 1) % 3];
    rod(st, [ax, y0 + H, az], [bx, y0 + H, bz], 0.0022, Z.log, 5);
    rod(st, [ax, y0 + H * 0.5, az], [bx, y0 + H * 0.5, bz], 0.0018, Z.log, 5);
  }
  add(st, new THREE.CylinderGeometry(0.02, 0.02, 0.003, 3), Z.timber, x0, y0 + H * 0.5 + 0.003, z0).rotation.y = Math.PI / 6;
  // Halatlar: iskeleden ağaca ve kıyıya sarkan
  rod(st, [x0 + 0.022, y0 + H, z0 - 0.015], [0.03, y0 + 0.11, 0.09], 0.0009, Z.rope, 4);
  rod(st, [x0 - 0.022, y0 + H, z0 - 0.015], [-0.07, y0 + 0.012, 0.075], 0.0009, Z.rope, 4);
  for (const a of [0.3, 1.4, 2.5, 3.5, 4.6, 5.6]) {
    const [x, z] = edgePt(ISLAND, a, -0.004);
    tuft(st, TUFTS.reed, x, z, 0.018, a);
  }
  for (const a of [0.9, 3.0, 5.1]) {
    const [x, z] = edgePt(ISLAND, a, -0.002);
    rock(st, x, z, 0.012, 0.009, 0.011, T.moss, 72 + Math.round(a * 3));
  }
  // Platformda ve yerde oturan orangutanlar
  placeAnimal(st, MOD.orangutan(), x0, z0, 0.6, 0.9, y0 + H * 0.5 + 0.004);
  placeAnimal(st, MOD.orangutan(), -0.045, 0.105, 2.2, 0.95);
}
// Park lambası: ince direk, fener başlığı, gece yanan ampul (az üçgen)
function parkLamp(st: THREE.Group, x: number, z: number) {
  const l = item(st, x, z, 0, SC, G);
  cyl(l, 0.008, 0.01, 0.012, M.iron, 0, 0, 0, 6);
  cyl(l, 0.004, 0.005, 0.16, M.iron, 0, 0, 0, 5);
  add(l, BULB_GEO, BULB, 0, 0.172, 0).scale.setScalar(1.6);
  cyl(l, 0.003, 0.013, 0.01, M.iron, 0, 0.183, 0, 6);
}
// Park alanları: ağaçlar, çalılar, çiçekler, banklar, lambalar, çöp kutuları, bilgi panoları
function parkland(st: THREE.Group) {
  const trees: [TreeType, number, number, number, string, number][] = [
    ['round', -0.46, 0.32, 0.6, '#6aab4c', 1], ['round', -0.2, 0.44, 0.5, '#7ab352', 0], ['blossom', -0.44, 0.44, 0.48, '#e7a1bd', 0],
    ['round', 0.2, 0.3, 0.5, '#5f9f45', 1], ['round', 0.46, 0.27, 0.55, '#6aab4c', 0], ['round', -0.2, 0.08, 0.42, '#71b04f', 0],
    ['round', 0.19, -0.18, 0.45, '#6aab4c', 0], ['blossom', 0.21, 0.07, 0.4, '#f0b3c8', 0], ['round', -0.07, 0.3, 0.42, '#78b553', 0],
    ['round', 0.11, -0.13, 0.38, '#6aab4c', 0], ['pine', -0.46, 0.04, 0.5, '#4f8a4a', 1], ['cypress', -0.23, 0.33, 0.4, '#5a9a48', 0],
  ];
  for (const [type, x, z, sz, tint, det] of trees) tree(st, type, x, z, sz, tint, x * 11 + z, det);
  const bushes: Pt[] = [[-0.19, 0.33], [-0.205, 0.255], [0.075, 0.3], [-0.06, 0.25], [0.205, 0.2], [0.2, -0.03], [-0.17, -0.06], [0.03, -0.1], [-0.07, -0.08], [0.125, -0.25], [-0.29, 0.06], [-0.4, 0.07], [0.31, -0.13], [0.15, 0.31]];
  bushes.forEach(([x, z], k) => tree(st, 'bush', x, z, 0.24 + (k % 3) * 0.04, k % 2 ? '#5f9f45' : '#78b553', k, 0));
  // Çiçek öbekleri yol kenarlarında
  for (const [x, z, k] of [[-0.05, 0.315, 1], [0.06, 0.32, 3], [-0.2, 0.3, 2], [0.2, 0.25, 4], [-0.14, -0.075, 5], [0.15, -0.08, 0], [-0.16, 0.42, 1], [0.17, 0.42, 3]] as V3[]) flowers(st, x, z, 0.013, 9, k);
  // Giriş meydanında yuvarlak taş saksılar
  for (const [x, z, k] of [[-0.075, 0.37, 2], [0.075, 0.37, 5]] as V3[]) {
    cyl(st, 0.017, 0.018, 0.009, Z.stoneLight, x, G, z, 12);
    flowers(st, x, z, 0.014, 10, k, G + 0.008);
  }
  // Ön sınır: alçak taş duvar üstünde budanmış çit (giriş açık)
  for (const sx of [-1, 1]) {
    const x0 = sx * 0.215, x1 = sx * 0.475, cx = (x0 + x1) / 2, w = Math.abs(x1 - x0);
    box(st, w, 0.007, 0.016, Z.stone, cx, G, 0.476);
    box(st, w - 0.004, 0.013, 0.012, Z.hedge, cx, G + 0.007, 0.476);
    for (let k = 0; k < 6; k++) clump(st, x0 + sx * (0.02 + k * 0.045), G + 0.02, 0.476, 0.012, 0.006, 0.008, LEAF.lo, LEAF.hi, k + (sx > 0 ? 9 : 0), true);
  }
  // Banklar (yola bakar), lambalar, çöp kutuları
  const benches: V3[] = [[-0.055, 0.3, Math.PI], [0.06, 0.305, Math.PI], [-0.195, 0.12, Math.PI / 2], [0.205, 0.12, -Math.PI / 2], [-0.24, -0.02, 0], [0.26, -0.115, 0], [0.12, -0.2, -Math.PI / 2]];
  for (const [x, z, a] of benches) bench(st, x, z, a, SC);
  for (const [x, z] of [[-0.13, 0.31], [0.13, 0.31], [-0.19, 0.04], [0.2, 0.06], [-0.04, -0.085], [0.11, -0.25], [-0.33, 0.055], [0.33, -0.06]] as Pt[]) parkLamp(st, x, z);
  for (const [x, z] of [[-0.16, 0.13], [0.11, -0.09], [-0.27, 0.05]] as Pt[]) cyl(st, 0.0035, 0.003, 0.012, Z.green, x, G, z, 7);
  // Bilgi panoları
  for (const [x, z, a, c] of [[-0.125, -0.06, 0.4, 3], [0.245, -0.055, Math.PI, 4], [-0.2, 0.16, Math.PI / 2, 1], [0.145, 0.05, -Math.PI / 2, 5]] as [number, number, number, number][]) {
    const o = item(st, x, z, a, 1, G);
    for (const sx of [-1, 1]) box(o, 0.002, 0.024, 0.002, Z.timberDark, sx * 0.008, 0, 0);
    box(o, 0.022, 0.014, 0.003, Z.timber, 0, 0.014, 0);
    box(o, 0.018, 0.01, 0.0005, PAINT[c], 0, 0.016, 0.0016);
  }
}
// Ziyaretçiler
function visitors(st: THREE.Group) {
  const ppl: [number, number, number, number, number, number?][] = [
    [0.02, 0.4, Math.PI, 1, 0], [-0.03, 0.42, Math.PI - 0.3, 4, 0], [0.045, 0.36, -2.6, 7, 0], [-0.02, 0.35, 0.4, 2, 0, 0.7],
    [-0.15, 0.2, 0.3, 5, 0], [-0.135, 0.06, 1.2, 9, 0], [-0.16, 0.07, 1.4, 3, 0, 0.72],
    [0.155, 0.17, -1.7, 6, 0], [0.16, -0.0, -0.5, 8, 0], [0.05, -0.06, -0.2, 10, 0],
    [-0.23, 0.035, Math.PI, 11, 0], [-0.3, 0.05, Math.PI, 12, 0, 0.7], [0.3, -0.075, 0, 13, 0], [0.235, -0.1, 0.2, 14, 0],
    [0.09, -0.17, Math.PI, 15, 0], [-0.13, 0.15, -1.3, 16, 0], [0.1, 0.24, 2.2, 17, 0],
  ];
  for (const [x, z, rot, k, pose, size] of ppl) person(st, x, z, rot, k, pose, G + 0.004, size ?? 1);
}

// ---------- Hareket eden hayvanlar ----------
export interface ZooWalker { obj: THREE.Object3D; cx: number; cz: number; r: number; phase: number; speed: number; step?: (t: number) => void }
// Kapalı yol üstünde yürür: bir süre yürür (yavaşça hızlanıp yavaşlar), sonra durur; dururken otlar (baş eğilir)
// lead: yol üstünde öndekine göre sabit uzaklık; side: yolun dış tarafına kayma (yavru annesinin yanında aynı adımla yürür)
function wander(holder: THREE.Object3D, loop: Pt[], o: { speed: number; walk: number; pause: number; phase: number; lead?: number; side?: number; dir?: number; pivot?: THREE.Object3D; graze?: number; sway?: number; y?: (x: number, z: number) => number }) {
  const pts = curvePts(loop, true, 96);
  const n = pts.length - 1;
  const cum = [0];
  for (let k = 1; k <= n; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const L = cum[n];
  const ys = pts.map(([x, z]) => (o.y ?? height)(x, z));
  const mid = pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0]);
  const dir = o.dir ?? 1;
  const cyc = o.walk + o.pause;
  const at = (t: number) => {
    const tt = t + o.phase * cyc;
    const k = Math.floor(tt / cyc), f = tt - k * cyc;
    const w = f < o.walk ? S(f, 0, o.walk) : 1;
    const dist = ((((k + w) * o.speed * o.walk + (o.lead ?? 0)) * dir) % L + L) % L;
    let i = 0;
    while (i < n - 1 && cum[i + 1] < dist) i++;
    const u = (dist - cum[i]) / (cum[i + 1] - cum[i] || 1);
    const a = pts[i], b = pts[i + 1];
    const moving = f < o.walk ? Math.sin((Math.PI * f) / o.walk) : 0;
    let x = a[0] + (b[0] - a[0]) * u, z = a[1] + (b[1] - a[1]) * u, y = ys[i] + (ys[i + 1] - ys[i]) * u;
    if (o.side) {
      // Yolun dışına doğru (döngünün ortasından uzağa) kay
      const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1;
      let nx = tz / tl, nz = -tx / tl;
      if (nx * (x - mid[0]) + nz * (z - mid[1]) < 0) [nx, nz] = [-nx, -nz];
      x += nx * o.side;
      z += nz * o.side;
      y = (o.y ?? height)(x, z);
    }
    return { x, z, y, hx: (b[0] - a[0]) * dir, hz: (b[1] - a[1]) * dir, moving, f };
  };
  const step = (t: number) => {
    const s = at(t);
    holder.position.set(s.x, s.y + Math.abs(Math.sin(t * 5)) * 0.0012 * s.moving, s.z);
    holder.rotation.y = Math.atan2(s.hx, s.hz);
    if (o.pivot) {
      // Dururken baş yere iner (otlar), yürürken kalkar; hafifçe sallanır
      const rest = 1 - S(s.moving, 0, 0.35);
      o.pivot.rotation.x = (o.graze ?? 0) * rest + Math.sin(t * 1.3 + o.phase * 5) * 0.05;
      o.pivot.rotation.y = Math.sin(t * 0.7 + o.phase * 3) * (o.sway ?? 0.12);
    }
  };
  step(0);
  return step;
}
// Hareketli hayvan: gövde ve ayrı dönen parça (boyun, baş ya da hortum) iki küçük parça olarak.
// split false ise baş gövdeyle tek parça olur (bir çizim az; yavru fil gibi başı oynamayanlar için)
const whole = new Map<Model, THREE.BufferGeometry>();
function mover(g: THREE.Group, md: Model, size: number, split = true) {
  const holder = new THREE.Group();
  holder.scale.setScalar(AM * size);
  let pivot: THREE.Object3D | undefined;
  if (md.pivot && !split) {
    let geo = whole.get(md);
    if (!geo) {
      const pg = md.pivot.geo.clone().applyMatrix4(new THREE.Matrix4().compose(md.pivot.pos, md.pivot.quat, new THREE.Vector3(1, 1, 1)));
      whole.set(md, (geo = mergeGeometries([md.body, pg])!));
    }
    holder.add(part(geo, ANIMAL_MAT, 0, 0, 0));
  } else holder.add(part(md.body, ANIMAL_MAT, 0, 0, 0));
  if (md.pivot && split) {
    pivot = new THREE.Group();
    pivot.position.copy(md.pivot.pos);
    pivot.quaternion.copy(md.pivot.quat);
    pivot.add(part(md.pivot.geo, ANIMAL_MAT, 0, 0, 0));
    holder.add(pivot);
  }
  g.add(holder);
  return { holder, pivot };
}

export function zoo(): THREE.Group {
  const g = new THREE.Group();
  const st = new THREE.Group();
  ground(st);
  waters(st);
  pathsAndPlaza(st);
  for (const hb of HABS) barrier(st, hb);
  savanna(st);
  lionArea(st);
  bearArea(st);
  penguinArea(st);
  islandArea(st);
  gate(st);
  shop(st, -0.33, 0.405, Math.PI / 2, 'HEDİYE', '#6a1b9a');
  cafe(st);
  // Zürafa besleme kulesi (savanın doğu kenarında), batı ve doğu seyir terasları
  deck(st, 0.08, -0.33, 0.06, 0.05, 0.1, Math.PI / 2, true);
  // Kuleye çıkan merdiven (yoldan yukarı)
  for (let k = 0; k < 8; k++) box(st, 0.018, 0.003, 0.008, Z.timber, 0.085, G + 0.006 + k * 0.0125, -0.255 - k * 0.0062);
  for (const sx of [-1, 1]) rod(st, [0.085 + sx * 0.0095, G, -0.25], [0.085 + sx * 0.0095, G + 0.1, -0.304], 0.0018, Z.timberDark, 4);
  person(st, 0.075, -0.335, -Math.PI / 2, 2, 2, G + 0.104);
  person(st, 0.085, -0.318, -Math.PI / 2 - 0.4, 5, 0, G + 0.104, 0.75);
  deck(st, -0.42, 0.01, 0.07, 0.06, 0.014, 0, true);
  person(st, -0.42, -0.005, Math.PI, 9, 0, G + 0.018);
  person(st, -0.4, 0.015, Math.PI + 0.5, 4, 0, G + 0.018, 0.72);
  deck(st, 0.42, -0.08, 0.06, 0.05, 0.008, Math.PI, false, true);
  person(st, 0.425, -0.09, Math.PI, 7, 0, G + 0.012);
  parkland(st);
  visitors(st);
  // Zürafa B: besleme kulesinin yanında başını uzatmış; zebralar otluyor
  placeAnimal(st, MOD.giraffe(), -0.045, -0.335, Math.PI / 2 - 0.1, 1, undefined, p => (p.rotation.x = 0.35));
  placeAnimal(st, MOD.zebra(), -0.05, -0.41, 2.4, 1, undefined, p => (p.rotation.x = 1.55));
  placeAnimal(st, MOD.zebra(), -0.075, -0.385, 0.9, 0.95, undefined, p => (p.rotation.x = 1.4));
  g.add(mergeStatic([st]));
  for (const m of g.children[0].children) {
    const mat = (m as THREE.Mesh).material;
    if (mat === POOL || mat === GLASS || mat === FALL) m.castShadow = false;
  }

  // --- Yürüyen hayvanlar ---
  const animals: ZooWalker[] = [];
  const push = (holder: THREE.Object3D, step: (t: number) => void) => animals.push({ obj: holder, cx: 0, cz: 0, r: 0, phase: 0, speed: 0, step });
  const loop = (cx: number, cz: number, rx: number, rz: number, seed: number): Pt[] => {
    const r = rand(seed);
    return Array.from({ length: 8 }, (_, k) => {
      const a = (k / 8) * Math.PI * 2;
      const f = 0.85 + r() * 0.3;
      return [cx + Math.cos(a) * rx * f, cz + Math.sin(a) * rz * f] as Pt;
    });
  };
  {
    const m = mover(g, MOD.giraffe(), 1);
    push(m.holder, wander(m.holder, loop(-0.31, -0.29, 0.07, 0.055, 1), { speed: 0.012, walk: 9, pause: 5, phase: 0.2, pivot: m.pivot, graze: 0.25, sway: 0.15 }));
  }
  {
    const m = mover(g, MOD.elephant(), 1);
    // Filler su birikintisinin çevresinde geniş bir daire çizer; yavru annesinin arkasından gelir
    const path = Array.from({ length: 10 }, (_, k): Pt => [-0.125 + Math.cos((k / 10) * Math.PI * 2) * 0.068, -0.23 + Math.sin((k / 10) * Math.PI * 2) * 0.066]);
    push(m.holder, wander(m.holder, path, { speed: 0.009, walk: 10, pause: 6, phase: 0.0, pivot: m.pivot, graze: 0.35, sway: 0.18 }));
    const c = mover(g, MOD.elephant(), 0.55, false);
    push(c.holder, wander(c.holder, path, { speed: 0.009, walk: 10, pause: 6, phase: 0.0, lead: -0.13, pivot: c.pivot, graze: 0.3, sway: 0.25 }));
  }
  {
    const m = mover(g, MOD.zebra(), 1);
    push(m.holder, wander(m.holder, loop(-0.18, -0.39, 0.045, 0.025, 3), { speed: 0.007, walk: 5, pause: 7, phase: 0.5, dir: -1, pivot: m.pivot, graze: 1.0, sway: 0.1 }));
  }
  {
    const m = mover(g, MOD.lioness(), 1, false);
    push(m.holder, wander(m.holder, [[0.2, -0.22], [0.27, -0.19], [0.36, -0.21], [0.4, -0.28], [0.25, -0.24]], { speed: 0.01, walk: 7, pause: 8, phase: 0.3, pivot: m.pivot, graze: 0.2, sway: 0.25 }));
  }
  {
    const m = mover(g, MOD.bear(), 1);
    push(m.holder, wander(m.holder, [[0.41, 0.16], [0.445, 0.1], [0.425, 0.03], [0.385, 0.0], [0.385, 0.06], [0.39, 0.125]], { speed: 0.008, walk: 8, pause: 6, phase: 0.1, pivot: m.pivot, graze: 0.45, sway: 0.2 }));
  }
  {
    // Yüzen penguenler: suyun altına dalıp çıkarlar
    const holder = new THREE.Group();
    holder.scale.setScalar(AM * 0.95);
    const inner = new THREE.Group();
    for (const [dx, dz] of [[0, 0], [0.35, -0.6], [-0.3, -1.1]]) {
      const pg = add(inner, MOD.penguinSwim().body, ANIMAL_MAT, dx, 0.12, dz);
      pg.rotation.x = Math.PI / 2 - 0.15;
    }
    holder.add(mergeStatic([inner]));
    g.add(holder);
    const swim = wander(holder, loop(-0.33, 0.2, 0.06, 0.042, 4), { speed: 0.016, walk: 6, pause: 0.5, phase: 0, y: () => PONDS[1].wl - 0.006 });
    push(holder, t => {
      swim(t);
      const d = Math.max(0, Math.sin(t * 0.9));
      holder.position.y -= d * d * 0.009;
      holder.rotation.x = Math.cos(t * 0.9) * d * 0.4;
    });
  }
  {
    // İpte sallanan orangutan
    const x0 = 0.02, z0 = 0.09;
    const top = height(x0, z0) + 0.135;
    const holder = new THREE.Group();
    holder.position.set(x0 + 0.012, top, z0 + 0.015);
    const rope = new THREE.Group();
    add(rope, new THREE.CylinderGeometry(0.0009, 0.0009, 0.04, 4), Z.rope, 0, -0.02, 0);
    holder.add(mergeStatic([rope]));
    const body = new THREE.Group();
    body.scale.setScalar(AM * 0.9);
    body.position.y = -0.04 - 1.7 * AM * 0.9 + 0.003;
    body.add(part(MOD.orangutanHang().body, ANIMAL_MAT, 0, 0, 0));
    holder.add(body);
    holder.rotation.y = 0.8;
    g.add(holder);
    push(holder, t => {
      holder.rotation.z = Math.sin(t * 1.7) * 0.45;
      holder.rotation.x = Math.sin(t * 0.85) * 0.1;
    });
  }
  g.userData.animals = animals;
  flushAtlas();
  return g;
}
