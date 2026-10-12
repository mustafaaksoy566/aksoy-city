import * as THREE from 'three';
import { SIZE, ENTRANCE_Z, SEA_ROWS } from './config';
import { mergeStatic } from './batcher';
import { SEA_Y, RIVER_Y, riverMat, seaMat, worldUV } from './water';
import { forest, type TreeSpot, type TreeType } from './trees';
import { palm, lighthouseTower } from './landmarks';

// Şehrin zemini ve çevresi tek parça arazi: şehrin çimeni kenarda yumuşak tepelere, batıda ve güneyde
// karlı dağlara dönüşür. Kuzeyde deniz şehrin içine kadar gelir (ilk iki sıra deniz, sonraki iki sıra kumsal);
// kıyı şehrin dışında da aynı çizgiden doğal şekilde devam eder. Nehir batıdaki dağlardan gelir,
// şehrin içinden geçer ve kuzeyde denize dökülür. Şehrin dışı sadece görüntü, üzerine bina yapılmaz.

const EXTENT = 240; // çevre arazinin genişliği
const HALF = SIZE / 2;
const CITY_Y = -0.03; // şehrin zemini (yollar y=0'da)
const RIVER_C = 18; // nehrin şehrin batısından çıktığı yerin ortası (41-42. sıralar)
// Kıyı çizgisi (şehrin içinde): kumsal z = -22'de başlar, su biraz ileride
const COAST_Z = SEA_ROWS - HALF - 0.5;

const smooth = (x: number, a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);
const lerp = THREE.MathUtils.lerp;
const clampCity = (v: number) => THREE.MathUtils.clamp(v, -HALF, HALF);

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
const edgeDist = (x: number, z: number) => Math.hypot(Math.max(Math.abs(x) - HALF, 0), Math.max(Math.abs(z) - HALF, 0));

// --- Kıyı ---
// Denizdeki adalar [x, z, yarıçap] (gemilerin yolundan uzakta)
const ISLANDS: [number, number, number][] = [[-48, -84, 9], [38, -97, 11], [66, -74, 3.5]];

// Kıyıya uzaklık: pozitifse deniz. Şehrin yanlarında şehirdeki kıyıyla aynı çizgiden başlar;
// batıda kara kuzeye doğru uzanır, doğuda deniz güneye doğru sokulur.
export function coast(x: number, z: number) {
  const ex = Math.max(Math.abs(x) - HALF, 0);
  const bend = x < 0 ? -smooth(ex, 0, 50) * 10 : 0.3 * ex * smooth(ex, 0, 10);
  let c = COAST_Z - z + bend + (fbm(x + 50, z) - 0.5) * 5 * smooth(ex, 0, 14);
  for (const [ix, iz, r] of ISLANDS) c = Math.min(c, Math.hypot(x - ix, z - iz) - r + (fbm(x * 2 + ix, z * 2) - 0.5) * r * 0.5);
  return c;
}

// Kıyıdaki yükseklik: karada şehir hizası, suya doğru kumsal iner, sonra deniz derinleşir
const seaFloor = (c: number) => SEA_Y - 0.1 - Math.min(2.4, Math.max(0, c) * 0.25);
const shore = (c: number) => Math.max(seaFloor(c), CITY_Y - Math.max(0, c + 0.5) * 0.35);
// Kumsalın çimene döndüğü çizgi (hafif dalgalı)
const sandLine = (x: number) => -2.42 + 0.1 * Math.sin(x * 0.9) + 0.06 * Math.sin(x * 2.3 + 1);

// --- Otoyol ---
// Batıdaki dağın tünelinden çıkar, şehrin girişine bağlanır; şehrin batısından güneye döner,
// nehri köprüyle geçer ve şehrin güneyinden doğuya, ufka kadar uzanır.
export const HW = { portal: -96.75, x: -30.5, z0: ENTRANCE_Z - HALF + 0.5, z1: HALF + 4.5, east: 118 };
const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) =>
  Math.hypot(px - THREE.MathUtils.clamp(px, Math.min(ax, bx), Math.max(ax, bx)), pz - THREE.MathUtils.clamp(pz, Math.min(az, bz), Math.max(az, bz)));
// Otoyola uzaklık
export function roadDist(x: number, z: number) {
  return Math.min(
    segDist(x, z, -EXTENT, HW.z0, -HALF, HW.z0),
    segDist(x, z, HW.x, HW.z0, HW.x, HW.z1),
    segDist(x, z, HW.x, HW.z1, EXTENT, HW.z1),
  );
}
// Tünelin içi (dağın altında kalan kısım): 0 dışarıda, 1 dağın içinde
const tunnelAt = (x: number) => smooth(-x, -HW.portal + 0.1, -HW.portal + 1.9);

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
  return Math.min(h, 17);
}

export function heightAt(x: number, z: number) {
  const d = edgeDist(x, z);
  // Şehrin içi düz; sadece kuzeydeki deniz sıralarında kumsal suya iner
  const inner = shore(COAST_Z - clampCity(z));
  if (d <= 0) return inner;
  const c = coast(x, z);
  let h = hills(x, z, d) * smooth(-c, 2, 14); // kıyıya doğru alçalır
  const rd = roadDist(x, z);
  const tunnel = tunnelAt(x);
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
};

// Kıyıda renk: su altında kumlu taban; karada kumsal çimene yumuşakça geçer, suya yakın kum ıslak ve koyu
const tmpSand = new THREE.Color();
function shoreColor(x: number, y: number, c: number, land: THREE.Color, out: THREE.Color) {
  if (c > -0.25 && y < SEA_Y + 0.02) return out.lerpColors(C.shallow, C.deep, Math.min(1, (SEA_Y - y) / 1.2));
  const sand = smooth(c - sandLine(x), -0.2, 0.2) * (1 - smooth(y, 0.2, 0.45));
  tmpSand.lerpColors(C.sand, C.wet, smooth(c, -0.95, -0.45));
  return out.copy(land).lerp(tmpSand, sand);
}

// Şehrin içindeki zemin rengi
function cityColor(x: number, z: number, out: THREE.Color) {
  return shoreColor(x, shore(COAST_Z - z), COAST_Z - z, C.ground, out);
}

const tmpLand = new THREE.Color();
function colorAt(x: number, z: number, y: number, out: THREE.Color) {
  const d = edgeDist(x, z);
  if (d <= 0) return cityColor(x, z, out);
  const land = tmpLand;
  if (y < 1.5) land.lerpColors(C.meadow, C.hill, Math.max(0, y) / 1.5);
  else if (y < 5) land.lerpColors(C.hill, C.forest, (y - 1.5) / 3.5);
  else if (y < 9) land.lerpColors(C.forest, C.rock, (y - 5) / 4);
  else land.lerpColors(C.rock, C.snow, Math.min(1, (y - 9) / 3));
  land.multiplyScalar(0.94 + fbm(x * 3, z * 3) * 0.12); // hafif renk dalgalanması
  shoreColor(x, y, coast(x, z), land, out);
  // Şehrin kenarında şehrin kendi rengine geçer
  const edge = 1 - smooth(d, 0.5, 5);
  if (edge > 0) out.lerp(cityColor(clampCity(x), clampCity(z), new THREE.Color()), edge);
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
  const zs = axis(EXTENT / 2, 0.5, 34, 3.2, 1, 18);
  const xs = refine(zs, HW.portal - 3, HW.portal + 1, 0.5);
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
const SEA = {
  foam: new THREE.Color('#dff7f2'),
  shallow: new THREE.Color('#38c0d0'),
  mid: new THREE.Color('#1f95d4'),
  deep: new THREE.Color('#1a66b5'),
};
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
function ribbon(points: RiverPoint[], material: THREE.Material) {
  const pos: number[] = [];
  const idx: number[] = [];
  points.forEach((p, k) => {
    const a = points[Math.max(0, k - 1)], b = points[Math.min(points.length - 1, k + 1)];
    const tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len, nz = tx / len;
    pos.push(p.x + nx * p.half, p.y, p.z + nz * p.half, p.x - nx * p.half, p.y, p.z - nz * p.half);
    if (k) {
      const o = (k - 1) * 2;
      idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
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
  g.add(ribbon(pts.map(p => ({ ...p, half: p.half - 0.12 })), riverMat));
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
  while (spots.length < 2700 && tries++ < 90000) {
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
    // Ağaçlar kümeler halinde (tepelerde orman daha sık); ormanların dışında seyrek tek ağaçlar
    const dense = fbm(x * 1.6 + 9, z * 1.6) > (y > 2.5 ? 0.4 : 0.52);
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

export function buildSurroundings() {
  const group = new THREE.Group();
  group.add(buildGround(), buildSea(), buildRiver(), buildTrees(), buildPalms(), buildRocks());
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
