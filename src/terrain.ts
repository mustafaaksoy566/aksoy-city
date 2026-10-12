import * as THREE from 'three';
import { SIZE, ENTRANCE_Z, PROPS } from './config';
import { makeModel } from './assets';
import { mergeStatic } from './batcher';
import { SEA_Y, RIVER_Y, riverMat, seaMat, worldUV } from './water';

// Haritanın çevresi: şehrin kenarından başlayan yumuşak tepeler, batıda ve güneyde karlı dağlar,
// kuzeyde kumsal ve deniz. Nehir batıdaki dağlardan gelir, şehrin içinden geçer ve kuzeyde denize dökülür.
// Hepsi sadece görüntü, üzerine bina yapılmaz.

const EXTENT = 240; // çevre arazinin genişliği
const SEG = 240; // arazi ızgarası (1 birimde bir köşe; şehrin kenarı tam köşelere denk gelir)
const HALF = SIZE / 2;
const CITY_Y = -0.03; // şehrin çimeninin hemen altı
const ROAD_Z = ENTRANCE_Z - HALF + 0.5; // otoyolun z konumu
const RIVER_C = 18; // nehrin şehirden çıktığı yerin ortası (41-42. kareler)

const smooth = (x: number, a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);
const lerp = THREE.MathUtils.lerp;

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

// Kıyı çizgisi: pozitifse deniz. Kuzeyde şehirden ~9 birim ötede, doğuya doğru şehre yaklaşır.
export const coast = (x: number, z: number) => -z - 33 + Math.max(0, x - 20) * 0.3 + (fbm(x + 50, z) - 0.5) * 5;

// Şehir alanının kenarına uzaklık (içerideyse 0)
const edgeDist = (x: number, z: number) => Math.hypot(Math.max(Math.abs(x) - HALF, 0), Math.max(Math.abs(z) - HALF, 0));

// --- Nehir ---
// Batı kolu: şehrin batı kenarından (z = 18) dağlara doğru kıvrılarak yükselir
const westZ = (t: number) => RIVER_C + Math.sin(t * 0.07) * 5 * smooth(t, 0, 14);
const westY = (t: number) => RIVER_Y + Math.max(0, t - 14) * 0.045;
// Kuzey kolu: şehrin kuzey kenarından (x = 18) denize akar, ağzında genişler
const northX = (t: number) => RIVER_C + Math.sin(t * 0.13) * 2 * smooth(t, 0, 6);
const northY = (x: number, z: number) => lerp(RIVER_Y, SEA_Y - 0.004, smooth(coast(x, z), -5, -0.5));
const northHalf = (x: number, z: number) => 1 + smooth(coast(x, z), -7, 1) * 1.6;

// Bir noktanın nehre uzaklığı, su yüksekliği ve yarım genişlik (nehir yakında değilse null)
function riverAt(x: number, z: number): { d: number; y: number; half: number } | null {
  let best: { d: number; y: number; half: number } | null = null;
  if (x < -HALF + 0.5) {
    const t = -HALF - x;
    const d = Math.abs(z - westZ(Math.max(0, t)));
    if (d < 14) best = { d, y: westY(Math.max(0, t)), half: 1 };
  }
  if (z < -HALF + 0.5) {
    const t = -HALF - z;
    const cx = northX(Math.max(0, t));
    const d = Math.abs(x - cx);
    if (d < 14 && (!best || d < best.d)) best = { d, y: northY(cx, z), half: northHalf(cx, z) };
  }
  return best;
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
  if (d <= 0) return CITY_Y;
  const c = coast(x, z);
  if (c > 0) return SEA_Y - 0.06 - Math.min(2.5, c * 0.3); // deniz tabanı
  let h = hills(x, z, d) * smooth(-c, 2, 14); // kıyıya doğru alçalır
  if (x < -HALF + 1) h *= smooth(Math.abs(z - ROAD_Z), 2.5, 10); // otoyol koridoru düz
  let y = CITY_Y + h;
  const r = riverAt(x, z);
  if (r) y = lerp(r.y + 0.04, y, smooth(r.d, r.half + 0.6, r.half + 9)); // nehir vadisi
  y = lerp(SEA_Y - 0.06, y, smooth(-c, 0, 4)); // kumsal denize doğru iner
  if (r) y = lerp(r.y - 0.22, y, smooth(r.d, r.half - 0.15, r.half + 1)); // nehir yatağı
  return lerp(CITY_Y, y, smooth(d, 0, 2.5)); // şehrin kenarı şehirle aynı hizada
}

const C = {
  ground: new THREE.Color('#56a03a'), // şehrin çimeniyle aynı
  meadow: new THREE.Color('#5aa53c'),
  hill: new THREE.Color('#4a9535'),
  forest: new THREE.Color('#3b7f33'),
  rock: new THREE.Color('#8e877b'),
  snow: new THREE.Color('#f4f4f0'),
  sand: new THREE.Color('#ecd9a0'),
  bank: new THREE.Color('#cdb98a'),
  shallow: new THREE.Color('#dcc58e'),
  deep: new THREE.Color('#a99a6c'),
};

function colorAt(x: number, z: number, y: number, out: THREE.Color) {
  const d = edgeDist(x, z);
  const c = coast(x, z);
  const r = riverAt(x, z);
  if (y < SEA_Y + 0.01 && c > -1.5) return out.lerpColors(C.shallow, C.deep, Math.min(1, (SEA_Y - y) / 1.5));
  if (r && r.d < r.half + 0.45) return out.copy(C.bank);
  if (c > -3.5 && y < 0.35) return out.copy(C.sand);
  if (y < 1.5) out.lerpColors(C.meadow, C.hill, Math.max(0, y) / 1.5);
  else if (y < 5) out.lerpColors(C.hill, C.forest, (y - 1.5) / 3.5);
  else if (y < 9) out.lerpColors(C.forest, C.rock, (y - 5) / 4);
  else out.lerpColors(C.rock, C.snow, Math.min(1, (y - 9) / 3));
  // Hafif renk dalgalanması, şehrin kenarında şehrin çimeni
  out.multiplyScalar(0.94 + fbm(x * 3, z * 3) * 0.12);
  return out.lerp(C.ground, 1 - smooth(d, 0.5, 5));
}

function buildGround() {
  const geo = new THREE.PlaneGeometry(EXTENT, EXTENT, SEG, SEG).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    colorAt(x, z, y, col).toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildSea() {
  const geo = worldUV(new THREE.PlaneGeometry(EXTENT * 2, EXTENT * 2, 1, 1).rotateX(-Math.PI / 2).translate(0, SEA_Y, 0));
  const sea = new THREE.Mesh(geo, seaMat);
  sea.renderOrder = -1;
  return sea;
}

// Nehrin şehir dışındaki suyu: ortaçizgi boyunca şerit
function ribbon(points: { x: number; z: number; y: number; half: number }[]) {
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
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Yüzey hep yukarı baksın
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return new THREE.Mesh(worldUV(geo), riverMat);
}

function buildRiver() {
  const g = new THREE.Group();
  const west: { x: number; z: number; y: number; half: number }[] = [];
  for (let t = 0; t <= 115; t += 0.5) west.push({ x: -HALF - t, z: westZ(t), y: westY(t), half: 1 - smooth(t, 70, 115) * 0.4 });
  const north: { x: number; z: number; y: number; half: number }[] = [];
  for (let t = 0; t <= 18; t += 0.5) {
    const z = -HALF - t, x = northX(t);
    north.push({ x, z, y: northY(x, z), half: northHalf(x, z) });
  }
  g.add(ribbon(west), ribbon(north));
  return g;
}

// Ağaçlar: şehirdekiyle aynı modeller, binlercesi tek seferde çizilir
function instanced(path: string, mats: THREE.Matrix4[], tints: THREE.Color[]) {
  const src = makeModel(path);
  src.updateMatrixWorld(true);
  const out: THREE.InstancedMesh[] = [];
  src.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    const inst = new THREE.InstancedMesh(geo, m.material, mats.length);
    mats.forEach((mat, i) => {
      inst.setMatrixAt(i, mat);
      inst.setColorAt(i, tints[i % tints.length]);
    });
    out.push(inst);
  });
  return out;
}

function buildTrees() {
  const big: THREE.Matrix4[] = [], small: THREE.Matrix4[] = [];
  const tmp = new THREE.Object3D();
  let tries = 0;
  while (big.length + small.length < 2000 && tries++ < 40000) {
    const x = (Math.random() - 0.5) * EXTENT * 0.85;
    const z = (Math.random() - 0.5) * EXTENT * 0.85;
    const d = edgeDist(x, z);
    if (d < 1.2) continue;
    const y = heightAt(x, z);
    const r = riverAt(x, z);
    if (coast(x, z) > -3.5 || y < 0.02 || y > 10.5) continue;
    if (r && r.d < r.half + 1.4) continue;
    if (x < -HALF && Math.abs(z - ROAD_Z) < 2) continue;
    // Ağaçlar kümeler halinde; tepelerde orman daha sık
    if (fbm(x * 1.6 + 9, z * 1.6) < (y > 2.5 ? 0.36 : 0.5)) continue;
    tmp.position.set(x, y - 0.02, z);
    tmp.rotation.y = Math.random() * Math.PI * 2;
    tmp.scale.setScalar((0.9 + Math.random() * 0.7) * (1 + Math.min(d, 60) / 60));
    tmp.updateMatrix();
    (Math.random() < 0.55 ? big : small).push(tmp.matrix.clone());
  }
  const tints = ['#ffffff', '#eaf6e4', '#f6fff0', '#dcebd6', '#fff8e8'].map(c => new THREE.Color(c));
  const g = new THREE.Group();
  for (const m of [...instanced(PROPS.treeLarge, big, tints), ...instanced(PROPS.treeSmall, small, tints)]) g.add(m);
  return g;
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

// Nehrin ağzında deniz feneri (gece ışığı yanar)
function lighthouse() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#f4f4f2' });
  const red = new THREE.MeshStandardMaterial({ color: '#d63a32' });
  const lamp = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff2c0', emissiveIntensity: 0 });
  lamp.name = 'lamp';
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.y = y;
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(new THREE.CylinderGeometry(0.75, 0.85, 0.3, 10), new THREE.MeshStandardMaterial({ color: '#9b958a' }), 0.15);
  for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(0.34 - k * 0.04, 0.38 - k * 0.04, 0.6, 12), k % 2 ? red : white, 0.6 + k * 0.6);
  add(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 12), lamp, 2.85);
  add(new THREE.ConeGeometry(0.36, 0.4, 12), red, 3.2);
  return g;
}

// Şehre batıdan giren otoyol
function buildHighway() {
  const parts: THREE.Object3D[] = [];
  for (let x = -HALF - 0.5; x > -EXTENT / 2; x--) {
    const r = makeModel('kaykit/road_straight');
    r.position.set(x, 0, ROAD_Z);
    r.rotation.y = Math.PI / 2;
    parts.push(r);
    // Otoyol kenarında sokak lambaları
    if (Math.round(x) % 4 === 0) {
      const l = makeModel('kaykit/streetlight');
      l.position.set(x, 0, ROAD_Z + 0.46);
      l.rotation.y = -Math.PI / 2;
      parts.push(l);
    }
  }
  return mergeStatic(parts);
}

export function buildSurroundings() {
  const group = new THREE.Group();
  group.add(buildGround(), buildSea(), buildRiver(), buildTrees(), buildRocks(), buildHighway());
  // Deniz feneri: nehir ağzının doğusundaki kumsalda
  let z = -HALF - 4;
  while (coast(RIVER_C + 6, z) < -1.5 && z > -60) z -= 0.5;
  const lh = lighthouse();
  lh.position.set(RIVER_C + 6, Math.max(heightAt(RIVER_C + 6, z), SEA_Y), z);
  group.add(lh);
  return group;
}
