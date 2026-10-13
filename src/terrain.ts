import * as THREE from 'three';
import { SIZE, ROWS, Z0, ENTRANCE_Z, COAST_ROW, ISLAND } from './config';
import { mergeStatic } from './batcher';
import { SEA_Y, RIVER_Y, riverMat, seaMat, worldUV, WATER, waterColor } from './water';
import { isRiverXZ } from './city';
import { forest, type TreeSpot, type TreeType } from './trees';
import { palm, lighthouseTower } from './landmarks';

// Şehrin zemini ve çevresi tek parça arazi: şehrin çimeni kenarda yumuşak tepelere, batıda ve güneyde
// karlı dağlara dönüşür. Kuzeyde deniz şehrin içine kadar gelir (ilk iki sıra deniz, sonraki iki sıra kumsal);
// kıyı şehrin dışında da aynı çizgiden doğal şekilde devam eder. Nehir batıdaki dağlardan gelir,
// şehrin içinden geçer ve kuzeyde denize dökülür. Şehrin dışı sadece görüntü, üzerine bina yapılmaz.

const EXTENT = 240; // çevre arazinin genişliği
const HALF = SIZE / 2; // şehrin doğu-batı yarı genişliği
const ZN = -Z0; // şehrin kuzey kenarı (denizin içinde)
const ZS = ROWS - Z0; // şehrin güney kenarı
const CITY_Y = -0.03; // şehrin zemini (yollar y=0'da)
const RIVER_C = 18; // nehrin şehrin batısından çıktığı yerin ortası (41-42. sıralar)
// Kıyı çizgisi (şehrin içinde): kumsal z = -22'de başlar, su biraz ileride
const COAST_Z = COAST_ROW - Z0 - 0.5;

const smooth = (x: number, a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);
const lerp = THREE.MathUtils.lerp;
const clampX = (v: number) => THREE.MathUtils.clamp(v, -HALF, HALF);
const clampZ = (v: number) => THREE.MathUtils.clamp(v, ZN, ZS);

// Basit, tekrar edilebilir gürültü
function hash(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, z: number) => noise(x * 0.06, z * 0.06) * 0.65 + noise(x * 0.15, z * 0.15) * 0.35;

// Şehir alanının kenarına uzaklık (içerideyse 0)
const edgeDist = (x: number, z: number) => Math.hypot(Math.max(Math.abs(x) - HALF, 0), Math.max(ZN - z, z - ZS, 0));

// --- Kıyı ---
// Denizdeki adalar [x, z, yarıçap] (gemilerin yolundan uzakta)
const ISLANDS: [number, number, number][] = [[-48, -84, 9], [38, -97, 11], [66, -74, 3.5]];

// Kıyıya uzaklık: pozitifse deniz. Şehrin yanlarında şehirdeki kıyıyla aynı çizgiden başlar;
// batıda kara kuzeye doğru uzanır, doğuda deniz güneye doğru sokulur.
// Şehrin içindeki ada (yapılabilir kareler elipsin içinde; görünen kıyı biraz daha dışarıda, etrafı kumsal)
const ISLE = { x: ISLAND.cx - HALF, z: ISLAND.cz - Z0, rx: ISLAND.rx + 1.3, rz: ISLAND.rz + 1.3 };
function islandCoast(x: number, z: number) {
  const dx = (x - ISLE.x) / ISLE.rx, dz = (z - ISLE.z) / ISLE.rz;
  return (Math.hypot(dx, dz) - 1) * ISLE.rz + (fbm(x * 3 + 20, z * 3) - 0.5) * 0.6;
}
export function coast(x: number, z: number) {
  const ex = Math.max(Math.abs(x) - HALF, 0);
  const bend = x < 0 ? -smooth(ex, 0, 50) * 10 : 0.3 * ex * smooth(ex, 0, 10);
  let c = COAST_Z - z + bend + (fbm(x + 50, z) - 0.5) * 5 * smooth(ex, 0, 14);
  for (const [ix, iz, r] of ISLANDS) c = Math.min(c, Math.hypot(x - ix, z - iz) - r + (fbm(x * 2 + ix, z * 2) - 0.5) * r * 0.5);
  return Math.min(c, islandCoast(x, z));
}

// Kıyıdaki yükseklik: karada şehir hizası, suya doğru kumsal iner, sonra deniz derinleşir
const seaFloor = (c: number) => SEA_Y - 0.1 - Math.min(2.4, Math.max(0, c) * 0.25);
const shore = (c: number) => Math.max(seaFloor(c), CITY_Y - Math.max(0, c + 0.5) * 0.35);
// Kumsalın çimene döndüğü çizgi (hafif dalgalı)
const sandLine = (x: number) => -2.42 + 0.1 * Math.sin(x * 0.9) + 0.06 * Math.sin(x * 2.3 + 1);

// --- Otoban ---
// Batıdaki Aksoy Dağı'nın tünelinden çıkan dört şeritli otoban, şehrin girişinin önündeki göbek kavşağa gelir.
// Kavşaktan doğuya şehre giren yol, kuzeye kayak merkezine çıkan yol, güneye otoban ayrılır. Güneydeki otoban
// nehri köprüyle geçer, şehrin güneyinde ikiye ayrılır: biri doğuya ufka, biri güneye tepelere uzanır.
export const HW = {
  portal: -44, // tünel ağzı
  x: -30.5, // güneye inen otobanın ortası
  z0: ENTRANCE_Z - Z0 + 0.5, // şehrin girişi hizası
  z1: ZS + 4.5, // şehrin güneyinden doğuya giden otoban
  east: 118,
  south: 110,
  ring: { x: -30.5, z: ENTRANCE_Z - Z0 + 0.5, r: 2.05, outer: 2.75 }, // göbek kavşak (r: arabaların döndüğü çember)
  clover: { x: -30.5, z: ZS + 4.5, size: 7.5 }, // şehrin güneybatısındaki kelebek (yonca yaprağı) kavşak
  west: -75, // kelebek kavşaktan batıya giden otobanın ucu
};
// Kayak merkezine çıkan yol (kavşağın kuzeyinden dağın eteğine)
export const SKI_ROAD: [number, number][] = [[HW.x, HW.z0 - HW.ring.outer], [HW.x, -6.5], [-34, -9.5], [-42.2, -12.2]];
// Dağ evinin yeri (çevresi düz)
export const LODGE = { x: -44.4, z: -13.4 };
// Aksoy Dağı: zirve, yükseklik ve genişlik
export const MOUNTAIN = { x: -62, z: -7, h: 23, r: 13 };
// Kayak pistleri: zirveye yakın yerden dağın eteğindeki dağ evine iner (genişlik ve köşeler)
export const SKI_RUNS: { w: number; pts: [number, number][] }[] = [
  { w: 1.3, pts: [[-58.5, -9], [-55, -11.5], [-52, -10], [-49, -12.5], [-46, -12.2]] },
  { w: 1.1, pts: [[-58, -5.5], [-54.5, -3.5], [-51, -6], [-48, -4.5], [-46, -8]] },
  { w: 0.9, pts: [[-59.5, -12], [-56, -15.5], [-52, -15], [-48.5, -16.5], [-46.5, -13.5]] },
];
const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax, dz = bz - az;
  const t = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / Math.max(1e-9, dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
};
const lineDist = (x: number, z: number, pts: [number, number][]) => {
  let d = Infinity;
  for (let k = 1; k < pts.length; k++) d = Math.min(d, segDist(x, z, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]));
  return d;
};
// Yollara uzaklık (otoban, kavşak, kayak yolu): yolların çevresi düzleşir, ağaç dikilmez
export function roadDist(x: number, z: number) {
  const { ring } = HW;
  return Math.min(
    segDist(x, z, -EXTENT, HW.z0, ring.x, HW.z0),
    segDist(x, z, ring.x, HW.z0, -HALF, HW.z0),
    segDist(x, z, HW.x, HW.z0, HW.x, HW.z1),
    segDist(x, z, HW.x, HW.z1, EXTENT, HW.z1),
    segDist(x, z, HW.x, HW.z1, HW.x, EXTENT),
    Math.max(0, Math.hypot(x - ring.x, z - ring.z) - ring.outer),
    segDist(x, z, HW.west, HW.z1, HW.x, HW.z1),
    Math.max(0, Math.max(Math.abs(x - HW.clover.x), Math.abs(z - HW.clover.z)) - HW.clover.size),
    lineDist(x, z, SKI_ROAD) + 0.4,
    Math.max(0, Math.hypot(x - LODGE.x, z - LODGE.z) - 2.3),
  );
}
// Kayak pistine uzaklık (pistin ortasından; genişliğin yarısı çıkarılmış)
export function skiDist(x: number, z: number) {
  let d = Infinity;
  for (const run of SKI_RUNS) d = Math.min(d, lineDist(x, z, run.pts) - run.w / 2);
  return d;
}
// Dağın yüksekliği: zirvede sivri, eteklere doğru yumuşak; yamaçlarda sırtlar
function mountain(x: number, z: number) {
  const d = Math.hypot(x - MOUNTAIN.x, (z - MOUNTAIN.z) * 1.15) / MOUNTAIN.r;
  const ridge = 1 + (noise(x * 0.35 + 3, z * 0.35) - 0.5) * 0.35;
  return MOUNTAIN.h * Math.exp(-Math.pow(d, 1.55)) * ridge * smooth(-x, 32, 42);
}
// Tünelin içi (dağın altında kalan kısım): 0 dışarıda, 1 dağın içinde (sadece otobanın çevresinde)
const tunnelAt = (x: number, z: number) => smooth(-x, -HW.portal + 0.1, -HW.portal + 1.9) * (1 - smooth(Math.abs(z - HW.z0), 1.5, 7));

// --- Nehir (batı kolu) ---
// Şehrin batı kenarından (z = 18) önce dümdüz çıkar, sonra kıvrılarak dağlara doğru yükselir
const westZ = (t: number) => RIVER_C + Math.sin(t * 0.07) * 5 * smooth(t, 2, 24);
const westY = (t: number) => RIVER_Y + Math.max(0, t - 14) * 0.045;
const westHalf = (t: number) => 1 - smooth(t, 70, 115) * 0.4;

// Bir noktanın nehre uzaklığı, su yüksekliği ve yarım genişlik (nehir yakında değilse null)
export function riverAt(x: number, z: number): { d: number; y: number; half: number } | null {
  if (x > -HALF + 0.5) return null;
  const t = Math.max(0, -HALF - x);
  const slope = westZ(t + 0.5) - westZ(Math.max(0, t - 0.5));
  const d = Math.abs(z - westZ(t)) / Math.hypot(1, slope);
  return d < 14 ? { d, y: westY(t), half: westHalf(t) } : null;
}

// Tepeler ve dağlar (şehirden uzaklaştıkça yükselir; batıda ve güneyde dağlar daha yüksek)
function hills(x: number, z: number, d: number) {
  let h = smooth(d, 1, 22) * (0.15 + fbm(x, z) * 2.2);
  const far = smooth(d, 14, 70);
  const bias = 0.35 + 0.65 * Math.max(smooth(-x, 10, 70), smooth(z, 20, 80));
  const ridge = 1 - Math.abs(noise(x * 0.03 + 7, z * 0.03 - 3) * 2 - 1);
  h += far * bias * (ridge * ridge * 15 + fbm(x * 1.8, z * 1.8) * 3);
  h = Math.min(h, 17);
  return Math.max(h, mountain(x, z));
}

export function heightAt(x: number, z: number) {
  const d = edgeDist(x, z);
  // Şehrin içi düz; sadece kuzeydeki deniz sıralarında kumsal suya iner
  const inner = shore(coast(clampX(x), clampZ(z)));
  if (d <= 0) return inner;
  const c = coast(x, z);
  let h = hills(x, z, d) * smooth(-c, 2, 14); // kıyıya doğru alçalır
  const rd = roadDist(x, z);
  const tunnel = tunnelAt(x, z);
  h *= lerp(smooth(rd, 1.2, 8), 1, tunnel); // otoyolun çevresi düz, tünelde dağ yolun üstünü örter
  h += tunnel * 3 * (1 - smooth(rd, 3, 10));
  let y = shore(c) + h;
  const r = riverAt(x, z);
  if (r) {
    y = lerp(r.y + 0.015, y, smooth(r.d, r.half + 0.5, r.half + 9)); // nehir vadisi
    y = lerp(r.y - 0.06, y, smooth(r.d, r.half + 0.05, r.half + 0.5)); // nehir yatağı (kıyı şeridinin altında kalır)
  }
  return lerp(inner, y, smooth(d, 0, 2.5)); // şehrin kenarı şehirle aynı hizada
}

const C = {
  ground: new THREE.Color('#56a03a'), // şehrin çimeni
  meadow: new THREE.Color('#5aa53c'),
  hill: new THREE.Color('#4a9535'),
  forest: new THREE.Color('#3b7f33'),
  rock: new THREE.Color('#8e877b'),
  snow: new THREE.Color('#f4f4f0'),
  sand: new THREE.Color('#efdca4'),
  wet: new THREE.Color('#d9c085'),
  shallow: new THREE.Color('#e2cd94'),
  deep: new THREE.Color('#6f8c86'),
  bed: new THREE.Color('#d6c08a'), // nehrin kumlu dibi
};

// Kıyıda renk: su altında kumlu taban; karada kumsal çimene yumuşakça geçer, suya yakın kum ıslak ve koyu
const tmpSand = new THREE.Color();
function shoreColor(x: number, y: number, c: number, land: THREE.Color, out: THREE.Color) {
  if (c > -0.25 && y < SEA_Y + 0.02) return out.lerpColors(C.shallow, C.deep, Math.min(1, (SEA_Y - y) / 1.2));
  const sand = smooth(c - sandLine(x), -0.2, 0.2) * (1 - smooth(y, 0.2, 0.45));
  tmpSand.lerpColors(C.sand, C.wet, smooth(c, -0.95, -0.45));
  return out.copy(land).lerp(tmpSand, sand);
}

// Şehrin içindeki zemin rengi (nehrin dibi kumlu)
function cityColor(x: number, z: number, out: THREE.Color) {
  // Sadece suyun altında kalan köşeler (iki yanı da nehir olan) kumlu; kıyıdaki köşeler çimen kalır
  const tx = (v: number) => Math.min(SIZE - 1, Math.max(0, Math.floor(v + HALF)));
  const tz = (v: number) => Math.min(ROWS - 1, Math.max(0, Math.floor(v + Z0)));
  const e = 0.001;
  if (isRiverXZ(tx(x - e), tz(z - e)) && isRiverXZ(tx(x + e), tz(z + e)) && isRiverXZ(tx(x - e), tz(z + e)) && isRiverXZ(tx(x + e), tz(z - e))) {
    return out.copy(C.bed);
  }
  const c = coast(x, z);
  return shoreColor(x, shore(c), c, C.ground, out);
}

const tmpLand = new THREE.Color();
function colorAt(x: number, z: number, y: number, out: THREE.Color) {
  const d = edgeDist(x, z);
  if (d <= 0) return cityColor(x, z, out);
  const land = tmpLand;
  // Dağda kaya ve kar daha aşağıdan başlar
  y += Math.min(3.5, mountain(x, z) * 0.2);
  if (y < 1.5) land.lerpColors(C.meadow, C.hill, Math.max(0, y) / 1.5);
  else if (y < 5) land.lerpColors(C.hill, C.forest, (y - 1.5) / 3.5);
  else if (y < 9) land.lerpColors(C.forest, C.rock, (y - 5) / 4);
  else land.lerpColors(C.rock, C.snow, Math.min(1, (y - 9) / 3));
  // Kayak pistleri ve dağın üst kısmı karla kaplı
  const ski = skiDist(x, z);
  if (ski < 0.3) land.lerp(C.snow, 1 - smooth(ski, 0.05, 0.3));
  land.multiplyScalar(0.94 + fbm(x * 3, z * 3) * 0.12); // hafif renk dalgalanması
  shoreColor(x, y, coast(x, z), land, out);
  const r = riverAt(x, z);
  if (r && r.d < r.half - 0.3) out.copy(C.bed);
  // Şehrin kenarında şehrin kendi rengine geçer
  const edge = 1 - smooth(d, 0.5, 5);
  if (edge > 0) out.lerp(cityColor(clampX(x), clampZ(z), new THREE.Color()), edge);
  return out;
}

// Izgara çizgileri: şehrin kenarı ve kıyısı çevresinde sık (yarım kare), şehrin düz ortasında ve
// uzaklarda seyrek. inner: ortadaki aralık (innerTo'ya kadar)
function axis(half: number, fine: number, fineTo: number, far: number, inner = fine, innerTo = 0) {
  const out = [0];
  let v = 0;
  while (v < half - 1e-6) {
    const s = v < innerTo ? inner : v < fineTo ? fine : fine + ((far - fine) * (v - fineTo)) / (half - fineTo);
    v = Math.min(half, v + s);
    out.push(v);
  }
  return [...out.slice(1).reverse().map(p => -p), ...out];
}

// Bir aralıkta ızgarayı sıklaştır (tünel ağzı gibi keskin yerler için)
function refine(list: number[], from: number, to: number, step: number) {
  const out = list.filter(v => v < from - step / 2 || v > to + step / 2);
  for (let v = from; v <= to + 1e-6; v += step) out.push(v);
  return out.sort((a, b) => a - b);
}

function grid(xs: number[], zs: number[], at: (x: number, z: number, pos: Float32Array, col: Float32Array, k: number) => void) {
  const n = xs.length, m = zs.length;
  const pos = new Float32Array(n * m * 3);
  const col = new Float32Array(n * m * 3);
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) at(xs[i], zs[j], pos, col, j * n + i);
  const index = new Uint32Array((n - 1) * (m - 1) * 6);
  let k = 0;
  for (let j = 0; j < m - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      index.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  return geo;
}

function buildGround() {
  const col = new THREE.Color();
  const base = axis(EXTENT / 2, 0.5, 34, 3.2, 1, 18);
  // Tünel ağzında ve kayak pistlerinde sık ızgara (keskin kenarlar, net pistler)
  const xs = refine(refine(base, HW.portal - 3, HW.portal + 1, 0.5), -61, HW.portal - 3.5, 0.5);
  const zs = refine(base, -18, -2, 0.5);
  const geo = grid(xs, zs, (x, z, pos, colors, k) => {
    const y = heightAt(x, z);
    pos.set([x, y, z], k * 3);
    colorAt(x, z, y, col).toArray(colors, k * 3);
  });
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

// Deniz: kıyıda köpük ve turkuaz sığ su, açıkta koyu mavi
const SEA = WATER;
function buildSea() {
  const lines = axis(EXTENT, 1, 30, 24);
  const geo = grid(lines, lines, (x, z, pos, colors, k) => {
    pos.set([x, SEA_Y, z], k * 3);
    const c = coast(x, z);
    const col = new THREE.Color();
    if (c < 0.2) col.lerpColors(SEA.foam, SEA.shallow, smooth(c, -0.3, 0.2));
    else if (c < 5) col.lerpColors(SEA.shallow, SEA.mid, smooth(c, 0.2, 5));
    else col.lerpColors(SEA.mid, SEA.deep, smooth(c, 5, 30));
    col.toArray(colors, k * 3);
  });
  const normals = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  const sea = new THREE.Mesh(worldUV(geo), seaMat);
  sea.renderOrder = -1;
  return sea;
}

// Nehrin şehir dışındaki kısmı: su şeridi ve iki yanında kum şeridi (şehirdeki nehirle aynı genişlikte)
interface RiverPoint { x: number; z: number; y: number; half: number }
// water: suyun kendisi (ortada bir sıra köşe daha; kenarlar sığ, ortası koyu)
function ribbon(points: RiverPoint[], material: THREE.Material, water = false) {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const across = water ? [1, 0, -1] : [1, -1];
  const n = across.length;
  const edge = waterColor(0.12), center = waterColor(1);
  points.forEach((p, k) => {
    const a = points[Math.max(0, k - 1)], b = points[Math.min(points.length - 1, k + 1)];
    const tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len, nz = tx / len;
    for (const s of across) {
      pos.push(p.x + nx * p.half * s, p.y, p.z + nz * p.half * s);
      (s ? edge : center).toArray(col, col.length);
    }
    if (k) {
      const o = (k - 1) * n;
      for (let c = 0; c < n - 1; c++) idx.push(o + c, o + c + n, o + c + 1, o + c + 1, o + c + n, o + c + n + 1);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (water) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(worldUV(geo), material);
  mesh.receiveShadow = true;
  return mesh;
}

const bankMat = new THREE.MeshStandardMaterial({ color: '#cdb98a', roughness: 1 });
function buildRiver() {
  const pts: RiverPoint[] = [];
  for (let t = 0; t <= 115; t += 0.5) pts.push({ x: -HALF - t, z: westZ(t), y: westY(t), half: westHalf(t) });
  const g = new THREE.Group();
  // Şehirdeki gibi: suyun kenarında 0.12 genişliğinde kum şeridi
  g.add(ribbon(pts.map(p => ({ ...p, half: p.half - 0.12 })), riverMat, true));
  g.add(ribbon(pts.map(p => ({ ...p, y: p.y - 0.003 })), bankMat));
  return g;
}

// --- Ağaçlar ---
const LEAF = {
  green: ['#5fae45', '#6cbb4b', '#4f9f3f', '#7cc551', '#8cbf45', '#59a84a'],
  pine: ['#3f7f46', '#4a8c4c', '#37723f', '#52905a'],
  autumn: ['#e0913a', '#d8693a', '#e8c04a', '#c9a23f'],
  blossom: ['#f7b3cd', '#ffd9e6', '#f39ab9'],
};
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

function buildTrees() {
  const spots: TreeSpot[] = [];
  const tmp = new THREE.Object3D();
  let tries = 0;
  // Önce dağın yamaçlarına sık çam ormanı (pistlerin, teleferiğin ve dağ evinin dışında)
  let mount = 0;
  while (mount < 520 && tries++ < 20000) {
    const x = MOUNTAIN.x - 4 + (Math.random() - 0.5) * 32;
    const z = MOUNTAIN.z + (Math.random() - 0.5) * 34;
    const y = heightAt(x, z);
    if (y < 0.8 || y > 11.5 || mountain(x, z) < 1.2) continue;
    if (skiDist(x, z) < 0.5 || roadDist(x, z) < 1.6 || Math.hypot(x - LODGE.x, z - LODGE.z) < 3) continue;
    if (lineDist(x, z, [[-45.5, -11.6], [-58.6, -7.6]]) < 0.9) continue;
    tmp.position.set(x, y - 0.03, z);
    tmp.rotation.set(0, Math.random() * Math.PI * 2, 0);
    tmp.scale.setScalar(1.1 + Math.random() * 0.6);
    tmp.updateMatrix();
    spots.push({ type: Math.random() < 0.85 ? 'pine' : 'cypress', matrix: tmp.matrix.clone(), color: new THREE.Color(pick(LEAF.pine)) });
    mount++;
  }
  tries = 0;
  while (spots.length < 2700 + mount && tries++ < 90000) {
    const x = (Math.random() - 0.5) * EXTENT * 0.9;
    const z = (Math.random() - 0.5) * EXTENT * 0.9;
    const d = edgeDist(x, z);
    if (d < 1) continue;
    if (coast(x, z) > -2.9) continue; // kumsalda ve denizde ağaç yok
    const y = heightAt(x, z);
    if (y > 10.5) continue;
    const r = riverAt(x, z);
    if (r && r.d < r.half + 1.3) continue;
    if (roadDist(x, z) < 2.2) continue;
    if (skiDist(x, z) < 0.9 || Math.hypot(x + 44.5, z + 11.5) < 4.5) continue; // pistler ve dağ evi
    if (lineDist(x, z, [[-45.5, -11.6], [-58.6, -7.6]]) < 1.4) continue; // teleferik hattı
    // Ağaçlar kümeler halinde (tepelerde orman daha sık); ormanların dışında seyrek tek ağaçlar
    // Dağın yamaçlarında sık çam ormanı (pistlerin arasında)
    const dense = fbm(x * 1.6 + 9, z * 1.6) > (y > 2.5 ? 0.4 : 0.52) || (mountain(x, z) > 1.5 && y < 9 && Math.random() < 0.55);
    if (!dense && Math.random() > 0.05) continue;
    const roll = Math.random();
    let type: TreeType;
    if (y > 4.5) type = roll < 0.75 ? 'pine' : roll < 0.85 ? 'cypress' : 'round';
    else if (y > 2) type = roll < 0.35 ? 'pine' : roll < 0.85 ? 'round' : roll < 0.95 ? 'cypress' : 'bush';
    else type = roll < 0.55 ? 'round' : roll < 0.7 ? 'cypress' : roll < 0.88 ? 'bush' : 'pine';
    let color = pick(type === 'pine' || type === 'cypress' ? LEAF.pine : LEAF.green);
    // Arada bir sonbahar renginde ya da çiçek açmış ağaç
    if (type === 'round' && y < 3) {
      const s = Math.random();
      if (s < 0.05) type = 'blossom';
      else if (s < 0.12) color = pick(LEAF.autumn);
    }
    if (type === 'blossom') color = pick(LEAF.blossom);
    tmp.position.set(x, y - 0.02, z);
    tmp.rotation.set(0, Math.random() * Math.PI * 2, 0);
    tmp.scale.setScalar((0.95 + Math.random() * 0.6) * (1.15 + Math.min(d, 60) / 45) * (type === 'bush' ? 1.3 : 1));
    tmp.updateMatrix();
    spots.push({ type, matrix: tmp.matrix.clone(), color: new THREE.Color(color) });
  }
  return forest(spots);
}

// Kumsallarda palmiyeler
function buildPalms() {
  const list: THREE.Object3D[] = [];
  let tries = 0;
  while (list.length < 60 && tries++ < 30000) {
    const x = (Math.random() - 0.5) * EXTENT * 0.85;
    const z = (Math.random() - 0.5) * EXTENT * 0.85;
    if (edgeDist(x, z) < 1.5) continue;
    const c = coast(x, z);
    if (c < -2.3 || c > -0.9 || roadDist(x, z) < 1.5) continue;
    const holder = new THREE.Group();
    holder.add(palm(0, 0, 0.75 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4));
    holder.position.set(x, heightAt(x, z) - 0.02, z);
    holder.rotation.y = Math.random() * Math.PI * 2;
    list.push(holder);
  }
  return mergeStatic(list);
}

// Dağlarda kayalar
function buildRocks() {
  const mats: THREE.Matrix4[] = [];
  const tmp = new THREE.Object3D();
  let tries = 0;
  while (mats.length < 260 && tries++ < 8000) {
    const x = (Math.random() - 0.5) * EXTENT * 0.85;
    const z = (Math.random() - 0.5) * EXTENT * 0.85;
    const y = heightAt(x, z);
    if (y < 2 || coast(x, z) > -3 || edgeDist(x, z) < 10) continue;
    tmp.position.set(x, y - 0.1, z);
    tmp.rotation.set(Math.random(), Math.random() * 6, Math.random());
    tmp.scale.set(0.5 + Math.random() * 1.2, 0.35 + Math.random() * 0.6, 0.5 + Math.random() * 1.2);
    tmp.updateMatrix();
    mats.push(tmp.matrix.clone());
  }
  const rocks = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.6, 0),
    new THREE.MeshStandardMaterial({ color: '#9b958a', flatShading: true, roughness: 1 }),
    mats.length,
  );
  mats.forEach((m, i) => rocks.setMatrixAt(i, m));
  return rocks;
}

// Bu malzeme alt geçit deliklerinin (şablon tamponunda 1 olan yerlerin) içine çizilmez
export function holeCut(m: THREE.Material) {
  m.stencilWrite = true; // three.js şablon testini bununla açar (yazma maskesi değişmez, işlemler Keep)
  m.stencilRef = 1;
  m.stencilFunc = THREE.NotEqualStencilFunc;
  m.stencilFail = THREE.KeepStencilOp;
  m.stencilZFail = THREE.KeepStencilOp;
  m.stencilZPass = THREE.KeepStencilOp;
}

export function buildSurroundings() {
  const group = new THREE.Group();
  // Alt geçit hendeklerinin ağzında zemin ve altındaki su çizilmez (bkz. view.ts underHole): delik önce
  // şablon tamponuna işaretlenir, zemin ve su işaretli yerleri atlar
  const ground = buildGround();
  ground.renderOrder = -2;
  const sea = buildSea();
  const river = buildRiver();
  for (const o of [ground, sea, river]) o.traverse(m => (m as THREE.Mesh).isMesh && holeCut((m as THREE.Mesh).material as THREE.Material));
  group.add(ground, sea, river, buildTrees(), buildPalms(), buildRocks());
  // Deniz feneri: şehrin doğusundaki kumsalın ucunda
  const lx = HALF + 9;
  let z = 0;
  while (coast(lx, z) < -0.9 && z > -60) z -= 0.25;
  const lh = lighthouseTower();
  lh.scale.setScalar(2.6);
  lh.position.set(lx, Math.max(heightAt(lx, z), CITY_Y), z);
  group.add(lh);
  return group;
}
