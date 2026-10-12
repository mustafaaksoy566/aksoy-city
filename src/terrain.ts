import * as THREE from 'three';
import { SIZE, ENTRANCE_Z, RIVER } from './config';
import { makeModel } from './assets';
import { mergeStatic } from './batcher';

// Haritanın çevresi: kuzeyde deniz ve kumsal, batıda ve güneyde ağaçlı tepeler,
// batıdan şehre giren otoyol. Hepsi sadece görüntü, üzerine bina yapılmaz.

const EXTENT = 240; // çevre arazinin genişliği
const HALF = SIZE / 2;
const ROAD_Z = ENTRANCE_Z - HALF + 0.5; // otoyolun z konumu

// Basit, tekrar edilebilir gürültü (tepelerin şekli için)
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

// Kıyı çizgisi: pozitifse deniz tarafı
// (kamera kuzeybatıya baktığı için deniz ve tepeler ufukta görünür)
const coast = (x: number, z: number) => -z - HALF - 5 + x * 0.3 + (fbm(x + 50, z) - 0.5) * 8;

// Nehrin harita dışındaki devamı (dünya koordinatında): kuzeye denize ve batıya doğru
const RIVER_LO = RIVER[0] - HALF, RIVER_HI = RIVER[1] + 1 - HALF;
function riverOutside(x: number, z: number) {
  return (x >= RIVER_LO && x <= RIVER_HI && z < -HALF) || (z >= RIVER_LO && z <= RIVER_HI && x < -HALF);
}

export function heightAt(x: number, z: number) {
  const dx = Math.max(Math.abs(x) - HALF, 0), dz = Math.max(Math.abs(z) - HALF, 0);
  const dist = Math.hypot(dx, dz);
  if (dist <= 0.01) return -0.06; // şehir alanı (çimen zemin bunun üstünde)
  if (riverOutside(x, z)) return -0.6; // nehir yatağı
  const c = coast(x, z);
  if (c > 0) return Math.max(-3, -c * 0.45) - 0.03; // deniz tabanı
  // Tepeler şehirden uzaklaştıkça yükselir, kıyıya yaklaştıkça alçalır
  let h = Math.pow(Math.max(dist - 1.5, 0), 1.15) * 0.22 * (0.35 + fbm(x, z) * 1.3);
  h *= 1 + THREE.MathUtils.smoothstep(-x, 0, 40) * 0.8; // batıda dağlar daha yüksek
  h *= THREE.MathUtils.smoothstep(-c, 0, 10);
  // Otoyol koridoru düz kalsın
  if (x < -HALF) h *= THREE.MathUtils.smoothstep(Math.abs(z - ROAD_Z), 1.2, 4);
  return Math.min(h, 14) - 0.06;
}

const COLORS = {
  sand: new THREE.Color('#e9d8a6'),
  grass: new THREE.Color('#78bf55'),
  forest: new THREE.Color('#58a043'),
  rock: new THREE.Color('#9a9488'),
  snow: new THREE.Color('#f5f5f2'),
  seabed: new THREE.Color('#d6c48c'),
};

function colorFor(h: number, c: number, out: THREE.Color) {
  if (h < -0.05) return out.copy(COLORS.seabed);
  if (c > -2.5 && h < 0.5) return out.copy(COLORS.sand);
  if (h < 2) return out.copy(COLORS.grass);
  if (h < 6) return out.lerpColors(COLORS.grass, COLORS.forest, (h - 2) / 4);
  if (h < 10) return out.lerpColors(COLORS.forest, COLORS.rock, (h - 6) / 4);
  return out.lerpColors(COLORS.rock, COLORS.snow, Math.min(1, (h - 10) / 2));
}

function buildGround() {
  const seg = 160;
  const geo = new THREE.PlaneGeometry(EXTENT, EXTENT, seg, seg).rotateX(-Math.PI / 2).toNonIndexed();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  // Her üçgen tek renk olsun (low-poly görünüm)
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    colorFor(cy, coast(cx, cz), col);
    for (let k = 0; k < 3; k++) col.toArray(colors, (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildWater() {
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(EXTENT * 2, EXTENT * 2).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#3ba7e0', roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.88 }),
  );
  water.position.y = -0.35;
  return water;
}

// Basit low-poly ağaçlar (çok sayıda olduğu için tek seferde çizilir)
function buildTrees() {
  const group = new THREE.Group();
  const spots: THREE.Matrix4[] = [];
  const tmp = new THREE.Object3D();
  let tries = 0;
  while (spots.length < 900 && tries++ < 20000) {
    const x = (Math.random() - 0.5) * EXTENT * 0.8;
    const z = (Math.random() - 0.5) * EXTENT * 0.8;
    const h = heightAt(x, z);
    const dist = Math.hypot(Math.max(Math.abs(x) - HALF, 0), Math.max(Math.abs(z) - HALF, 0));
    if (dist < 2 || h < 0.3 || h > 9 || coast(x, z) > -3) continue;
    if (x < -HALF && Math.abs(z - ROAD_Z) < 2.5) continue;
    if (fbm(x * 2 + 9, z * 2) < 0.42) continue; // ağaçlar kümeler halinde olsun
    tmp.position.set(x, h, z);
    tmp.rotation.y = Math.random() * Math.PI * 2;
    tmp.scale.setScalar(0.7 + Math.random() * 0.9);
    tmp.updateMatrix();
    spots.push(tmp.matrix.clone());
  }
  const leaves = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.42, 1.1, 6).translate(0, 0.85, 0),
    new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }),
    spots.length,
  );
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.07, 0.09, 0.35, 5).translate(0, 0.17, 0),
    new THREE.MeshStandardMaterial({ color: '#7a5233', roughness: 1 }),
    spots.length,
  );
  const greens = ['#3f8f3a', '#4ea444', '#2f7a35', '#5bb04c'].map(c => new THREE.Color(c));
  spots.forEach((m, i) => {
    leaves.setMatrixAt(i, m);
    trunk.setMatrixAt(i, m);
    leaves.setColorAt(i, greens[i % greens.length]);
  });
  leaves.castShadow = true;
  group.add(leaves, trunk);
  return group;
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
  group.add(buildGround(), buildWater(), buildTrees(), buildHighway());
  return group;
}
