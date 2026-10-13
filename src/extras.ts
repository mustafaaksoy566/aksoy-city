import * as THREE from 'three';
import { PROPS } from './config';
import { part, windowMat } from './utilities';
import { mergeStatic } from './batcher';
import { makeModel } from './assets';
import { KIT } from './towers';
import { signMat } from './signs';
import { palm } from './places';
import { pm, M, BULB, BULB_GEO, WATER, SPRAY, PYRAMID, FLOWERS, FLOWER_GEO, PAINT, type V3, UP, add, box, cyl, rod, item, bench, lamp, flowerBed, frame, basin } from './parts';

// Manzara, sahil ve eğlence yapıları gökdelenler gibi ayrıntılı çizilir: göl ve adalı büyük göl, seyir tepesi,
// plaj voleybolu sahası ve kumarhane kulesi. Yerel ölçü 1x1 kare, ön yüz +z (yola bakar). n karelik yapılar n*0.96 kat
// büyütülür; içlerindeki bank, lamba, ağaç, insan ve ördek gibi eşyalar s = 1/(n*0.96) ile küçültülür ki şehirdeki boylarında kalsınlar.

const G = 0.0305; // çimen ve kum yüzeyi (komşu karelerin zeminiyle aynı boyda)
const S = THREE.MathUtils.smoothstep;
const col = (hex: string) => new THREE.Color(hex);
// Köşe renkli arazi ve yollar (birleştirilince renkleri korunur)
const VC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

// Tekrarlanabilir rastgele sayılar (model her açılışta aynı çıksın)
function rand(seed: number) {
  let v = ((seed * 7919) % 2147483646) + 1;
  return () => (v = (v * 16807) % 2147483647) / 2147483647;
}
// Yumuşak dalgalı gürültü (yaklaşık -1..1): çimen lekeleri, kum dalgaları
const noise = (x: number, z: number) => Math.sin(x * 37.1 + z * 11.3) * 0.5 + Math.sin(x * 13.7 - z * 29.9) * 0.3 + Math.sin(x * 71.3 + z * 53.1) * 0.2;
// Bir noktanın doğru parçasına uzaklığı
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
// Eşyayı verilen yüksekliğe koyan kap (bank ve lamba gibi yardımcılar y=0.03 varsayar)
const at = (g: THREE.Object3D, y: number) => item(g, 0, 0, 0, 1, y - 0.03);

type Paint = (x: number, z: number, y: number, c: THREE.Color) => void;
// Köşe renkli yüzey; yüzü yukarı baksın (ters dizildiyse üçgenleri çevir)
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
// Kenarlarda yan duvar (komşu karelere bitişik): dışa bakan düz yüzler, üstleri yok. Eskiden ince kutulardı; kutuların
// üstü arazinin hemen altında kalıp titreşiyordu.
function walls(g: THREE.Object3D, side: THREE.Material) {
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    add(g, new THREE.PlaneGeometry(0.98, G).rotateY(a), side, Math.sin(a) * 0.49, G / 2, Math.cos(a) * 0.49);
  }
}
// Halka ızgara: (cx, cz) çevresinde açılar x halkalar; halka yarıçapları açıya bağlı (içten dışa sıralı).
// Kıyı çevresinde sık halkalar sayesinde kıyı çizgisi pürüzsüz, kum şeridi keskin olur ve üçgen sayısı az kalır.
function polarGround(g: THREE.Object3D, cx: number, cz: number, angles: number[], rings: ((a: number) => number)[], height: (x: number, z: number, ring: number) => number, paint: Paint) {
  const N = angles.length;
  const pos: number[] = [], colors: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  rings.forEach((R, k) => {
    for (const a of angles) {
      const r = R(a);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const y = height(x, z, k);
      pos.push(x, y, z);
      paint(x, z, y, c);
      colors.push(c.r, c.g, c.b);
    }
  });
  for (let k = 0; k < rings.length - 1; k++) {
    for (let j = 0; j < N; j++) {
      const a = k * N + j, b = k * N + ((j + 1) % N);
      idx.push(a, b, a + N, a + N, b, b + N);
    }
  }
  return add(g, upward(pos, colors, idx), VC, 0, 0, 0);
}
// Arazi: kareyi kaplayan ızgara; yükseklik ve renk fonksiyonla verilir
function terrain(g: THREE.Object3D, n: number, height: (x: number, z: number) => number, paint: Paint, side: THREE.Material) {
  const geo = new THREE.PlaneGeometry(0.98, 0.98, n, n).rotateX(-Math.PI / 2);
  geo.deleteAttribute('uv');
  const p = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), z = p.getZ(k);
    const y = height(x, z);
    p.setY(k, y);
    paint(x, z, y, c);
    c.toArray(colors, k * 3);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  add(g, geo, VC, 0, 0, 0);
  walls(g, side);
}

// Yol şeridi: noktalar boyunca arazinin üstüne yatırılır (her köşe arazinin yüksekliğini alır), kenarları biraz koyu
function ribbon(g: THREE.Object3D, pts: THREE.Vector3[], w: number, yAt: (x: number, z: number) => number, color: THREE.Color, closed = false, lift = 0.0035) {
  const pos: number[] = [], colors: number[] = [], idx: number[] = [];
  const n = pts.length;
  const c = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const a = pts[closed ? (k - 1 + n) % n : Math.max(k - 1, 0)];
    const b = pts[closed ? (k + 1) % n : Math.min(k + 1, n - 1)];
    const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1;
    for (const sd of [-1, 0, 1]) {
      const x = pts[k].x - (tz / L) * (w / 2) * sd, z = pts[k].z + (tx / L) * (w / 2) * sd;
      pos.push(x, yAt(x, z) + lift, z);
      c.copy(color).offsetHSL(0, 0, noise(x * 2.3, z * 2.3) * 0.03 - (sd ? 0.035 : 0));
      colors.push(c.r, c.g, c.b);
    }
  }
  const rows = closed ? n : n - 1;
  for (let k = 0; k < rows; k++) {
    const a = k * 3, b = ((k + 1) % n) * 3;
    for (let j = 0; j < 2; j++) idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
  }
  return add(g, upward(pos, colors, idx), VC, 0, 0, 0);
}

// Ağaç (hazır çizilmiş ağaç modelleri), istenen yükseklikte
function treeAt(g: THREE.Object3D, path: string, x: number, z: number, y: number, sc: number, rot = 0) {
  const t = makeModel(path);
  t.scale.multiplyScalar(sc);
  t.position.set(x, y, z);
  t.rotation.y = rot;
  g.add(t);
}

// Kaya: yamuk yirmi yüzlü (aynı köşeler aynı miktarda itilir, yüzeyler arasında çatlak olmaz)
const ROCK_GEOS = [1, 2, 3].map(k => {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = Math.sin(Math.round(x * 97) * 12.9898 + Math.round(y * 89) * 78.233 + Math.round(z * 83) * 37.719 + k * 11.1) * 43758.5453;
    const f = 0.72 + (h - Math.floor(h)) * 0.5;
    p.setXYZ(i, x * f, y * f, z * f);
  }
  geo.computeVertexNormals();
  return geo;
});
const STONES = ['#9b968c', '#857f75', '#b3ac9e', '#76726a', '#a59a86'].map(c => pm(c, 0.9));
function rock(g: THREE.Object3D, x: number, y: number, z: number, r: number, k: number, sy = 0.6) {
  const o = add(g, ROCK_GEOS[k % ROCK_GEOS.length], STONES[k % STONES.length], x, y, z);
  o.scale.set(r, r * sy, r * (0.8 + (k % 3) * 0.12));
  o.rotation.y = k * 1.7;
  return o;
}

// --- İnsanlar (şehirdeki boyda, ~0.15) ---
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524'].map(c => pm(c, 0.8));
const HAIR = ['#2b1d14', '#5a3825', '#c99a4e', '#161616', '#8a4b2a'].map(c => pm(c, 0.9));
const LEGS = [M.navy, pm('#3d4450'), M.white, pm('#c2a77e'), M.teal];
const SUIT = pm('#1d1f24', 0.6);
const BODY_GEO = new THREE.CylinderGeometry(0.0155, 0.0125, 0.046, 7).scale(1, 1, 0.66);
const HIP_GEO = new THREE.CylinderGeometry(0.0135, 0.0125, 0.02, 7, 1, true);
const HEAD_GEO = new THREE.SphereGeometry(0.0105, 7, 5);
const HAIR_GEO = new THREE.SphereGeometry(0.0113, 7, 3, 0, Math.PI * 2, 0, Math.PI * 0.5);
const SHOE_GEO = new THREE.BoxGeometry(0.008, 0.006, 0.015).translate(0, 0.0005, 0); // üstü zeminden belirgin yüksekte
// İnce uzuv: uçları açık dört köşeli silindir (az üçgen)
function limb(g: THREE.Object3D, a: V3, b: V3, r: number, m: THREE.Material) {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const o = add(g, new THREE.CylinderGeometry(r, r, d.length(), 4, 1, true), m, A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
}
// k: renk seçimi. pose: 0 ayakta, 1 oturuyor (kalça y'de, ayaklar 0.04 aşağıda), 2 kollar havada (smaç, blok),
// 3 hazır duruş (dizler bükük, kollar önde), 4 yerde oturuyor (bacaklar önde). suit: takım elbise. Yüzü +z
function person(g: THREE.Object3D, x: number, z: number, rot: number, s: number, k: number, pose = 0, y = 0.03, suit = false) {
  const p = item(g, x, z, rot, s, y);
  const skin = SKIN[k % SKIN.length];
  const hair = HAIR[(k * 3 + 1) % HAIR.length];
  const top = suit ? SUIT : PAINT[(k * 5 + 2) % PAINT.length];
  const legs = suit ? SUIT : LEGS[(k * 7 + 3) % LEGS.length];
  const shin = suit ? SUIT : skin;
  const hip = pose === 1 ? 0 : pose === 4 ? 0.012 : pose === 3 ? 0.056 : 0.07;
  for (const sx of [-0.0065, 0.0065]) {
    if (pose === 1) {
      limb(p, [sx, hip, -0.006], [sx, hip, 0.03], 0.0062, legs);
      limb(p, [sx, hip, 0.03], [sx, hip - 0.036, 0.033], 0.0052, shin);
      add(p, SHOE_GEO, M.iron, sx, hip - 0.0335, 0.036); // ayakkabı yere basar (üstü zeminden belirgin yüksekte)
    } else if (pose === 4) {
      limb(p, [sx, hip, -0.004], [sx, 0.006, 0.062], 0.0058, legs);
      add(p, SHOE_GEO, M.iron, sx, 0.007, 0.066).rotation.x = Math.PI / 2;
    } else if (pose === 3) {
      limb(p, [sx, hip, -0.004], [sx, 0.03, 0.014], 0.0062, legs);
      limb(p, [sx, 0.03, 0.014], [sx, 0.004, 0], 0.0052, shin);
      add(p, SHOE_GEO, M.iron, sx, 0.0025, 0.004);
    } else {
      limb(p, [sx, hip, 0], [sx, 0.032, 0], 0.0062, legs);
      limb(p, [sx, 0.032, 0], [sx, 0.004, 0], 0.0052, shin);
      add(p, SHOE_GEO, M.iron, sx, 0.0025, 0.003);
    }
  }
  add(p, HIP_GEO, legs, 0, hip + 0.002, 0);
  const up = item(p, 0, 0, 0, 1, hip + 0.01);
  up.rotation.x = pose === 3 ? 0.4 : pose === 1 || pose === 4 ? -0.05 : 0;
  add(up, BODY_GEO, top, 0, 0.022, 0);
  add(up, HEAD_GEO, skin, 0, 0.06, 0);
  add(up, HAIR_GEO, hair, 0, 0.0615, -0.0012);
  for (const sd of [-1, 1]) {
    const sh: V3 = [sd * 0.0175, 0.04, 0];
    const hand: V3 =
      pose === 2 ? [sd * 0.013, 0.1, 0.012] : pose === 3 ? [sd * 0.01, 0.006, 0.034] : pose === 1 || pose === 4 ? [sd * 0.016, -0.004, 0.022] : [sd * 0.021, -0.006, 0.003];
    const elbow: V3 = [sh[0] + (hand[0] - sh[0]) * 0.42, sh[1] + (hand[1] - sh[1]) * 0.42, sh[2] + (hand[2] - sh[2]) * 0.42];
    limb(up, elbow, hand, 0.0042, suit ? SUIT : skin);
    limb(up, sh, elbow, 0.0056, top);
  }
  return p;
}

// --- Su kuşları ve tekneler (şehirdeki boyda) ---
const BIRD = { grey: pm('#b8b2a6'), brown: pm('#8b6a47'), chest: pm('#6e3f2a'), green: pm('#1d6a3c'), beak: pm('#f0a030'), chick: pm('#d8b45a'), white: pm('#f7f5f0', 0.6), black: pm('#222222') };
const DUCK_BODY = new THREE.SphereGeometry(0.014, 8, 6).scale(0.8, 0.6, 1.3);
const DUCK_HEAD = new THREE.SphereGeometry(0.0078, 8, 6);
// Ördek (yüzü +z): 0 yeşil başlı erkek, 1 kahverengi dişi, 2 yavru (küçük, sarı)
function duck(g: THREE.Object3D, x: number, z: number, rot: number, s: number, kind: number, y = 0) {
  const d = item(g, x, z, rot, s * (kind === 2 ? 0.55 : 1), y);
  const body = kind === 0 ? BIRD.grey : kind === 1 ? BIRD.brown : BIRD.chick;
  add(d, DUCK_BODY, body, 0, 0.004, 0);
  if (kind === 0) add(d, new THREE.SphereGeometry(0.0095, 8, 5), BIRD.chest, 0, 0.007, 0.009);
  add(d, new THREE.ConeGeometry(0.006, 0.014, 5), kind === 0 ? BIRD.black : body, 0, 0.009, -0.018).rotation.x = -1.25;
  add(d, new THREE.CylinderGeometry(0.004, 0.0055, 0.012, 6), kind === 0 ? BIRD.green : body, 0, 0.014, 0.012);
  add(d, DUCK_HEAD, kind === 0 ? BIRD.green : body, 0, 0.022, 0.015);
  add(d, new THREE.BoxGeometry(0.0045, 0.0022, 0.009), BIRD.beak, 0, 0.0205, 0.024);
  if (kind === 0) add(d, new THREE.TorusGeometry(0.0046, 0.0012, 3, 10).rotateX(Math.PI / 2), BIRD.white, 0, 0.0145, 0.012);
}
// Kuğu: beyaz gövde, kabarık kanatlar, S biçimli boyun, turuncu gaga
function swan(g: THREE.Object3D, x: number, z: number, rot: number, s: number, y = 0) {
  const d = item(g, x, z, rot, s, y);
  add(d, new THREE.SphereGeometry(0.026, 10, 7).scale(0.8, 0.55, 1.3), BIRD.white, 0, 0.006, 0);
  for (const sd of [-1, 1]) add(d, new THREE.SphereGeometry(0.02, 8, 5).scale(0.45, 0.55, 1.25), BIRD.white, sd * 0.012, 0.014, -0.006);
  rod(d, [0, 0.01, 0.024], [0, 0.036, 0.03], 0.0045, BIRD.white, 6);
  rod(d, [0, 0.036, 0.03], [0, 0.055, 0.022], 0.004, BIRD.white, 6);
  add(d, new THREE.SphereGeometry(0.0062, 8, 6), BIRD.white, 0, 0.057, 0.024);
  add(d, new THREE.ConeGeometry(0.0028, 0.012, 5).rotateX(Math.PI / 2), BIRD.beak, 0, 0.0555, 0.033);
  add(d, new THREE.SphereGeometry(0.0026, 5, 4), BIRD.black, 0, 0.0575, 0.028);
}
// Kayık gövdesi: alt yarım küre, baş tarafı sivriltilmiş
function bow(geo: THREE.BufferGeometry, sx: number, sy: number, sz: number) {
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (z > 0) p.setX(i, p.getX(i) * (1 - 0.6 * z * z));
  }
  geo.scale(sx, sy, sz);
  geo.computeVertexNormals();
  return geo;
}
const HULL_GEO = bow(new THREE.SphereGeometry(1, 14, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0.026, 0.017, 0.062);
const GUNWALE_GEO = bow(new THREE.TorusGeometry(1, 0.07, 4, 24).rotateX(Math.PI / 2), 0.026, 0.03, 0.062);
const BOAT_FLOOR_GEO = bow(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), 0.024, 1, 0.057);
// Kayık (~0.12 boyunda): boyalı gövde, beyaz küpeşte, ahşap taban, iki oturak ve içeride yatan kürekler
function rowboat(g: THREE.Object3D, x: number, z: number, rot: number, s: number, y: number, paint: THREE.Material) {
  const b = item(g, x, z, rot, s, y);
  add(b, HULL_GEO, paint, 0, 0.007, 0);
  add(b, GUNWALE_GEO, M.white, 0, 0.007, 0);
  add(b, BOAT_FLOOR_GEO, M.wood, 0, 0.003, 0);
  for (const zz of [-0.022, 0.014]) box(b, 0.046, 0.003, 0.012, M.darkWood, 0, 0.006, zz); // oturaklar tabandan belirgin yüksekte
  for (const sd of [-1, 1]) rod(b, [sd * 0.013, 0.0065, -0.034], [sd * 0.007, 0.0085, 0.04], 0.0018, M.wood, 4);
}
// Kuğu biçimli pedallı tekne: beyaz gövde, renkli oturak ve tente, önde kuğu boynu
function swanBoat(g: THREE.Object3D, x: number, z: number, rot: number, s: number, y: number, k: number) {
  const b = item(g, x, z, rot, s, y);
  add(b, new THREE.SphereGeometry(1, 10, 6).scale(0.034, 0.022, 0.052), BIRD.white, 0, 0.004, 0);
  for (const sd of [-1, 1]) add(b, new THREE.SphereGeometry(1, 6, 4).scale(0.012, 0.016, 0.034), BIRD.white, sd * 0.026, 0.018, -0.01);
  box(b, 0.04, 0.012, 0.03, PAINT[k % PAINT.length], 0, 0.018, -0.012);
  box(b, 0.042, 0.022, 0.006, PAINT[k % PAINT.length], 0, 0.03, -0.027);
  rod(b, [0, 0.016, 0.034], [0, 0.05, 0.044], 0.0065, BIRD.white, 6);
  rod(b, [0, 0.05, 0.044], [0, 0.072, 0.034], 0.006, BIRD.white, 6);
  add(b, new THREE.SphereGeometry(0.009, 8, 6), BIRD.white, 0, 0.074, 0.037);
  add(b, new THREE.ConeGeometry(0.0042, 0.016, 5).rotateX(Math.PI / 2), BIRD.beak, 0, 0.072, 0.05);
  for (const sd of [-1, 1]) add(b, new THREE.SphereGeometry(0.0022, 5, 4), BIRD.black, sd * 0.006, 0.077, 0.042);
}

// ======================= Göl (2x2) ve büyük göl (3x3) =======================
// Doğal kıvrımlı kıyı: sığ yerde açık, derinde koyu su (yarı saydam su yüzünün altında eğimli göl tabanı), kumlu ve
// çakıllı kenar, kıyı taşları, saz öbekleri ve püsküller, çiçekli nilüferler. Gölün çevresinde yürüyüş yolu,
// banklar, lambalar, ağaçlar ve çalılar; ahşap iskele, bağlı kayık, olta atan balıkçı ve gezen insanlar.
// Büyük gölde ortada ağaçlı ada, adada beyaz çardak, kıyıdan adaya kemerli ahşap köprü ve kuğu biçimli pedallı tekneler.
// Ördekler (anne ve yavruları) ile kuğular suda daire çizerek yüzer (animateDecor: userData.animals).
const WL = 0.022; // su yüzü (çevredeki çimenden biraz aşağıda)
const LAKE = new THREE.MeshStandardMaterial({ color: '#2a7fb3', transparent: true, opacity: 0.72, roughness: 0.05, metalness: 0.3, emissive: '#06263a', emissiveIntensity: 0.35 });
const PLANK2 = pm('#8d6239', 0.85);
const REED2 = pm('#6d9a3c', 1);
const CATTAIL = pm('#5a3b22', 1);
const LILY = [pm('#f6a3c4', 0.7), pm('#fbf7ef', 0.7)];
const LILY_HEART = pm('#f7d046', 0.7);
const PAD_GEO = new THREE.CircleGeometry(1, 10, 0.4, Math.PI * 2 - 0.55).rotateX(-Math.PI / 2);
const BLOOM_GEO = new THREE.SphereGeometry(0.0055, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
const REED_GEO = new THREE.ConeGeometry(0.0028, 1, 3);
const CATTAIL_GEO = new THREE.CylinderGeometry(0.0038, 0.0038, 0.016, 4);
const BIN = pm('#3e6b48', 0.6);

type Ring = (a: number) => number;
// Doğal kıyı çizgisi: yarıçap açıya göre birkaç dalgayla değişir; karenin kenarına 'margin'den fazla yaklaşmaz
function shoreline(cx: number, cz: number, R: number, sx: number, sz: number, seed: number, margin: number): Ring {
  const r = rand(seed);
  const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
  const lim = 0.49 - margin;
  return a => {
    const c = Math.cos(a), sn = Math.sin(a);
    let rr = (R * (1 + 0.07 * Math.sin(2 * a + ph[0]) + 0.05 * Math.sin(3 * a + ph[1]) + 0.025 * Math.sin(5 * a + ph[2]))) / Math.hypot(c / sx, sn / sz);
    if (Math.abs(c) > 1e-6) rr = Math.min(rr, (lim - Math.sign(c) * cx) / Math.abs(c));
    if (Math.abs(sn) > 1e-6) rr = Math.min(rr, (lim - Math.sign(sn) * cz) / Math.abs(sn));
    return rr;
  };
}
// Kıyıdan uzaklığa göre arazi (d: karada +, suda -): suda çukur taban, kıyıda hafif şev, ötesi düz çimen
function lakeY(d: number) {
  if (d < 0) return WL - 0.004 * S(-d, 0, 0.01) - 0.012 * S(-d, 0.008, 0.1);
  return WL + 0.003 * S(d, 0, 0.008) + (G - WL - 0.003) * S(d, 0.004, 0.05);
}
// Saz öbeği: ince yapraklar, bazılarında kahverengi püskül
function reeds(g: THREE.Object3D, x: number, y: number, z: number, s: number, seed: number, n = 12) {
  const r = rand(seed);
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.032 * s;
    const h = (0.05 + r() * 0.055) * s;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const o = add(g, REED_GEO, r() < 0.5 ? M.reed : REED2, px, y + h / 2, pz);
    o.scale.set(s, h, s);
    if (k % 4) o.rotation.set((r() - 0.5) * 0.35, 0, (r() - 0.5) * 0.35);
    else add(g, CATTAIL_GEO, CATTAIL, px, y + h * 0.82, pz).scale.setScalar(s);
  }
}
// Nilüfer öbeği: çentikli yapraklar, bazılarında pembe ya da beyaz çiçek
function lilies(g: THREE.Object3D, x: number, z: number, s: number, seed: number, n = 6) {
  const r = rand(seed);
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.05 * s;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const pad = add(g, PAD_GEO, M.pad, px, WL + 0.0032, pz); // yapraklar sudan belirgin yüksekte (yoksa titreşir)
    pad.scale.setScalar((0.016 + r() * 0.012) * s);
    pad.rotation.y = r() * 6.28;
    if (k % 3 === 0) {
      add(g, BLOOM_GEO, LILY[k % 2], px, WL + 0.0034, pz).scale.setScalar(s * 1.3);
      add(g, FLOWER_GEO, LILY_HEART, px, WL + 0.004 * s, pz).scale.setScalar(s * 0.3);
    }
  }
}
// İskele: karadaki başı (x, z), suya doğru açı ang, yerel uzunluk len. Tahta yol, ucunda korkuluklu geniş platform,
// fener, can simidi ve merdiven; yanında bağlı kayık. fisher: platformda taburede olta atan balıkçı
function pier(g: THREE.Object3D, x: number, z: number, ang: number, len: number, s: number, fisher: boolean) {
  const ux = Math.cos(ang), uz = Math.sin(ang);
  const p = item(g, x, z, Math.atan2(-ux, -uz), s, WL);
  const L = len / s;
  const top = (G + 0.007 - WL) / s; // tahtaların üstü (karadaki başı çimenden ve yoldan belirgin yüksekte; aynı boyda titreşir)
  const W = 0.12, W2 = 0.24, PL = 0.11;
  const walk = L - PL;
  // Yol tahtaları platformdan geriye doğru dizilir (platform tahtalarıyla üst üste binmesinler)
  for (let k = 0; -walk + 0.008 + k * 0.016 < 0.00675; k++) box(p, W, 0.004, 0.0135, k % 3 ? M.wood : PLANK2, 0, top - 0.004, -walk + 0.008 + k * 0.016);
  for (let k = 0; k * 0.016 < PL - 0.004; k++) box(p, W2, 0.004, 0.0135, k % 3 ? M.wood : PLANK2, 0, top - 0.004, -walk - 0.008 - k * 0.016);
  // Kirişler ve kazıklar
  for (const sd of [-1, 1]) {
    box(p, 0.008, 0.008, walk - 0.02, M.darkWood, sd * (W / 2 - 0.012), top - 0.014, -walk / 2 - 0.01); // kirişler tahtaların biraz altında, karadaki yola değmez
    box(p, 0.008, 0.008, PL, M.darkWood, sd * (W2 / 2 - 0.012), top - 0.014, -walk - PL / 2);
    for (let zz = 0.035; zz < walk; zz += 0.07) cyl(p, 0.0055, 0.0055, top + 0.026, M.darkWood, sd * (W / 2 - 0.004), -0.03, -zz, 6);
    // Platform köşe dikmeleri ve yan korkuluk
    const x2 = sd * (W2 / 2 - 0.02); // dikmeler tahtaların kenarından ve kirişlerden içeride (yan yüzleri çakışmasın)
    for (const zz of [walk + 0.005, walk + PL / 2, L - 0.005]) cyl(p, 0.0055, 0.0055, top + 0.085, M.darkWood, x2, -0.03, -zz, 6);
    for (const h of [0.03, 0.054]) rod(p, [x2, top + h, -walk - 0.005], [x2, top + h, -L + 0.005], 0.0028, M.wood, 4);
  }
  // Fener, can simidi, merdiven
  lamp(at(p, top), -W2 / 2 + 0.014, -walk - 0.014, 1, 0.12);
  const ring = item(p, W2 / 2 + 0.002, -walk - PL / 2, Math.PI / 2, 1, top + 0.03);
  add(ring, new THREE.TorusGeometry(0.014, 0.0042, 6, 8, Math.PI), M.red, 0, 0, 0);
  add(ring, new THREE.TorusGeometry(0.014, 0.0042, 6, 8, Math.PI), M.white, 0, 0, 0).rotation.z = Math.PI;
  for (const xx of [0.07, 0.1]) rod(p, [xx, top, -L], [xx, -0.012, -L - 0.004], 0.0022, M.steel, 4);
  for (let k = 0; k < 3; k++) rod(p, [0.07, top - 0.012 - k * 0.012, -L - 0.001], [0.1, top - 0.012 - k * 0.012, -L - 0.001], 0.0018, M.steel, 4);
  // Bağlı kayık ve halatı
  rowboat(p, W / 2 + 0.04, -walk * 0.6, 0.08, 1, 0.0045, PAINT[1]); // taban su yüzünden belirgin yüksekte
  rod(p, [W / 2 + 0.035, 0.012, -walk * 0.6 + 0.058], [W / 2 - 0.004, top, -walk * 0.6 + 0.07], 0.0012, M.wood, 3);
  if (fisher) {
    cyl(p, 0.011, 0.012, 0.036, M.darkWood, -0.03, top, -L + 0.03, 8); // ayakları tahtaların üstüne basacak boyda
    const f = person(p, -0.03, -L + 0.03, Math.PI, 1, 4, 1, top + 0.036);
    rod(f, [0.012, 0.012, 0.03], [0.04, 0.11, 0.17], 0.0014, M.iron, 4);
    rod(f, [0.04, 0.11, 0.17], [0.045, -top - 0.038, 0.19], 0.0005, M.white, 3);
    cyl(p, 0.009, 0.007, 0.016, M.blue, 0.01, top, -L + 0.04, 8);
  }
}
// Kemerli ahşap köprü (yerel ölçüde): (x0, z0, y0) → (x1, z1, y1), ortası rise kadar yüksek, genişliği w
function archBridge(g: THREE.Object3D, x0: number, z0: number, y0: number, x1: number, z1: number, y1: number, rise: number, w: number, s: number) {
  const L = Math.hypot(x1 - x0, z1 - z0);
  const b = item(g, x0, z0, Math.atan2(x1 - x0, z1 - z0), 1, 0);
  const N = 10;
  const yAt = (t: number) => y0 + (y1 - y0) * t + rise * Math.sin(Math.PI * t);
  for (let k = 0; k < N; k++) {
    const t0 = k / N, t1 = (k + 1) / N, ya = yAt(t0), yb = yAt(t1);
    // Tahtalar bir geniş bir dar: birbirine binen uçlarda yan yüzleri aynı düzlemde kalmasın
    const plank = add(b, new THREE.BoxGeometry(k % 2 ? w : w - 0.012 * s, 0.006 * s, (L / N) * 1.05), k % 2 ? M.wood : PLANK2, 0, (ya + yb) / 2 - 0.003 * s, ((t0 + t1) / 2) * L);
    plank.rotation.x = -Math.atan2(yb - ya, L / N);
  }
  const rh = 0.075 * s;
  for (const sd of [-1, 1]) {
    const xx = sd * (w / 2 - 0.004 * s);
    for (let k = 0; k < N; k++) {
      const t0 = k / N, t1 = (k + 1) / N;
      rod(b, [sd * (w / 2 - 0.01 * s), yAt(t0) - 0.014 * s, t0 * L], [sd * (w / 2 - 0.01 * s), yAt(t1) - 0.014 * s, t1 * L], 0.008 * s, M.darkWood, 4);
      rod(b, [xx, yAt(t0) + rh, t0 * L], [xx, yAt(t1) + rh, t1 * L], 0.0045 * s, M.white, 4);
      rod(b, [xx, yAt(t0) + rh * 0.5, t0 * L], [xx, yAt(t1) + rh * 0.5, t1 * L], 0.003 * s, M.white, 4);
    }
    for (let k = 0; k <= N; k += 2) rod(b, [xx, yAt(k / N) - 0.004 * s, (k / N) * L], [xx, yAt(k / N) + rh + 0.006 * s, (k / N) * L], 0.0055 * s, M.white, 4);
  }
  // Taş ayaklar (iki uçta)
  for (const t of [0, 1]) box(b, w + 0.012 * s, 0.03 * s, 0.03 * s, M.rim, 0, yAt(t) - 0.04 * s, t * L); // üstü tahtaların altında, çimenden belirgin aşağıda
}
// Beyaz sekizgen çardak: taş taban, ahşap döşeme, sütunlar ve korkuluk, yeşil kubbemsi çatı, içinde bank
function gazebo(g: THREE.Object3D, x: number, y: number, z: number, s: number, rot: number) {
  const p = item(g, x, z, rot, s, y);
  cyl(p, 0.135, 0.14, 0.02, M.rim, 0, -0.004, 0, 8);
  cyl(p, 0.128, 0.128, 0.007, M.wood, 0, 0.016, 0, 8); // döşeme taş kaideden belirgin yüksekte
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, b = ((k + 1) / 8) * Math.PI * 2;
    const P: V3 = [Math.sin(a) * 0.115, 0.02, Math.cos(a) * 0.115];
    rod(p, P, [P[0], 0.15, P[2]], 0.0055, M.white, 6);
    if (k !== 0 && k !== 7) {
      for (const h of [0.05, 0.072]) rod(p, [P[0], h, P[2]], [Math.sin(b) * 0.115, h, Math.cos(b) * 0.115], 0.0028, M.white, 4);
    }
  }
  cyl(p, 0.135, 0.135, 0.014, M.white, 0, 0.15, 0, 8);
  add(p, new THREE.ConeGeometry(0.16, 0.085, 8), M.teal, 0, 0.164 + 0.0425, 0);
  cyl(p, 0.012, 0.016, 0.02, M.white, 0, 0.245, 0, 8);
  add(p, new THREE.SphereGeometry(0.01, 8, 6), M.gold, 0, 0.27, 0);
  add(p, new THREE.SphereGeometry(0.012, 8, 6), BULB, 0, 0.13, 0);
  bench(at(p, 0.02), 0, -0.06, 0, 1);
}

export function lake(big: boolean) {
  const g = new THREE.Group();
  const st = new THREE.Group();
  const n = big ? 3 : 2;
  const s = 1 / (n * 0.96);
  const cx = 0, cz = -0.03;
  const pw = 0.13 * s; // yol genişliği
  const po = 0.05 + pw / 2; // yolun kıyıdan uzaklığı
  const rw = shoreline(cx, cz, big ? 0.31 : 0.27, big ? 1.15 : 1.18, big ? 0.95 : 0.92, big ? 7 : 3, 0.05 + pw + 0.015);
  // Büyük gölün adası
  const ix = -0.06, iz = -0.08;
  const ri: Ring | null = big ? shoreline(ix, iz, 0.088, 1.25, 0.9, 11, 0) : null;
  const angL = (x: number, z: number) => Math.atan2(z - cz, x - cx);
  const islandD = (x: number, z: number) => (ri ? ri(Math.atan2(z - iz, x - ix)) - Math.hypot(x - ix, z - iz) : -1);
  // Kıyıya işaretli uzaklık: karada +, suda -
  const lakeD = (x: number, z: number) => Math.hypot(x - cx, z - cz) - rw(angL(x, z));
  const landD = (x: number, z: number) => Math.max(lakeD(x, z), islandD(x, z));
  const yAt = (x: number, z: number) => {
    const di = islandD(x, z);
    return lakeY(landD(x, z)) + (di > 0 ? 0.026 * S(di, 0.012, 0.075) : 0);
  };
  const ringPt = (a: number, off: number) => new THREE.Vector3(cx + Math.cos(a) * (rw(a) + off), 0, cz + Math.sin(a) * (rw(a) + off));
  const sandW = (a: number) => 0.008 + 0.024 * (0.5 + 0.5 * Math.sin(2 * a + 0.7)) ** 2;

  // Arazi: göl tabanı (derinde koyu, sığda açık), kum ve çakıllı kıyı, lekeli çimen
  const deep = col('#1d464d'), mid = col('#5a785a'), wet = col('#a3906a'), sand = col('#dfcc99'), grass = col('#6cbd55'), gDark = col('#529f42'), gLight = col('#88cc69');
  const tmp = new THREE.Color();
  const paint: Paint = (x, z, _y, c) => {
    const d = landD(x, z);
    const sw = islandD(x, z) > lakeD(x, z) ? 0.014 : sandW(angL(x, z));
    const nz = noise(x * 3.1, z * 3.1);
    if (d < -0.025) c.copy(deep).lerp(mid, S(d, -0.13, -0.025));
    else if (d < 0) c.copy(mid).lerp(wet, S(d, -0.025, 0));
    else {
      c.copy(grass).lerp(nz > 0 ? gLight : gDark, Math.abs(nz) * 0.75);
      tmp.copy(wet).lerp(sand, S(d, 0, 0.007)).offsetHSL(0, 0, nz * 0.03);
      c.lerp(tmp, 1 - S(d, sw, sw + 0.014));
    }
  };
  // Göl çevresinde halkalar: ortada seyrek, kıyıda sık; en dış halka karenin kenarı (köşeler de açı listesinde)
  const edge = (a: number) => {
    const c = Math.cos(a), sn = Math.sin(a);
    let rr = 9;
    if (Math.abs(c) > 1e-9) rr = Math.min(rr, (0.49 - Math.sign(c) * cx) / Math.abs(c));
    if (Math.abs(sn) > 1e-9) rr = Math.min(rr, (0.49 - Math.sign(sn) * cz) / Math.abs(sn));
    return rr;
  };
  const angles = [...Array.from({ length: 84 }, (_, k) => -Math.PI + (k / 84) * Math.PI * 2), ...[[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => Math.atan2(sz * 0.49 - cz, sx * 0.49 - cx))].sort((a, b) => a - b);
  const flat = 0.05; // bu uzaklıktan sonra çimen düz
  const rings: ((a: number) => number)[] = [
    () => 0,
    a => rw(a) * 0.4,
    ...[-0.12, -0.07, -0.04, -0.02, -0.008, 0, 0.004, 0.01, 0.018, 0.03, flat].map(o => (a: number) => Math.max(rw(a) * 0.5, rw(a) + o)),
    a => rw(a) + flat + (edge(a) - rw(a) - flat) / 3,
    a => rw(a) + flat + ((edge(a) - rw(a) - flat) * 2) / 3,
    edge,
  ];
  polarGround(st, cx, cz, angles, rings, (x, z) => lakeY(lakeD(x, z)), paint);
  walls(st, M.soil);
  // Ada: kendi halkaları; en dıştaki halka göl tabanının biraz altına iner (arada boşluk kalmaz)
  if (ri) {
    const ia = Array.from({ length: 56 }, (_, k) => -Math.PI + (k / 56) * Math.PI * 2);
    const iRings: ((a: number) => number)[] = [() => 0, a => ri(a) * 0.5, ...[-0.03, -0.012, -0.004, 0, 0.006, 0.015, 0.03, 0.055].map(o => (a: number) => ri(a) + o)];
    polarGround(st, ix, iz, ia, iRings, (x, z, k) => (k === iRings.length - 1 ? lakeY(lakeD(x, z)) - 0.006 : yAt(x, z)), paint);
  }
  // Su yüzü (kıyının altına kadar uzanır, karanın altında görünmez)
  const shape = new THREE.Shape();
  for (let k = 0; k <= 72; k++) {
    const p = ringPt((k / 72) * Math.PI * 2, 0.03);
    if (k === 0) shape.moveTo(p.x, -p.z);
    else shape.lineTo(p.x, -p.z);
  }
  add(st, new THREE.ShapeGeometry(shape, 1).rotateX(-Math.PI / 2), LAKE, 0, WL, 0);

  // Kıyı taşları, çakıllar ve kayalar
  const r = rand(big ? 5 : 2);
  for (let k = 0; k < (big ? 60 : 40); k++) {
    const a = r() * Math.PI * 2;
    const p = ringPt(a, -0.006 + r() * 0.024);
    const sz = (0.006 + r() * r() * 0.022) * s;
    rock(st, p.x, yAt(p.x, p.z) - sz * 0.2, p.z, sz, k);
  }
  for (const a of big ? [0.35, 2.6, 4.1, 5.3] : [0.2, 2.9, 4.4]) {
    for (let j = 0; j < 3; j++) {
      const p = ringPt(a + j * 0.05, 0.004 + j * 0.008);
      const sz = (0.045 - j * 0.01) * s;
      rock(st, p.x, yAt(p.x, p.z) - sz * 0.25, p.z, sz, j + 2, 0.7);
    }
  }
  if (ri) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + r() * 0.2;
      const rr = ri(a) + 0.002 - r() * 0.01;
      const x = ix + Math.cos(a) * rr, z = iz + Math.sin(a) * rr;
      const sz = (0.008 + r() * 0.016) * s;
      rock(st, x, yAt(x, z) - sz * 0.2, z, sz, k + 3);
    }
  }
  // Sazlar ve nilüferler
  const reedAngles = big ? [0.6, 1.9, 3.3, 3.9, 4.8, 5.8] : [0.5, 2.3, 3.6, 4.9, 5.6];
  reedAngles.forEach((a, k) => {
    for (let j = 0; j < 2; j++) {
      const p = ringPt(a + j * 0.08, -0.01 + j * 0.01);
      reeds(st, p.x, yAt(p.x, p.z), p.z, s, k * 7 + j + 1, 9);
    }
  });
  const lilyAngles = big ? [1.1, 2.9, 4.3, 5.5] : [1.6, 3.1, 4.6, 5.9];
  lilyAngles.forEach((a, k) => {
    const p = ringPt(a, -0.06);
    lilies(st, p.x, p.z, s, k + 3, 7);
  });

  // Çevre yolu ve girişe bağlanan yol
  const pathC = col('#dccba3');
  const loop = Array.from({ length: 96 }, (_, k) => ringPt((k / 96) * Math.PI * 2, po));
  ribbon(st, loop, pw, yAt, pathC, true);
  const ex = big ? ix : 0; // giriş yolu (büyük gölde köprüyle aynı hizada)
  const ea = Math.atan2(0.3, ex - cx); // çevre yolunun giriş hizasındaki açısı
  const frontZ = cz + Math.sin(ea) * (rw(ea) + po) + pw * 0.45;
  ribbon(st, Array.from({ length: 8 }, (_, k) => new THREE.Vector3(ex, 0, frontZ + ((0.49 - frontZ) * k) / 7)), pw, yAt, pathC, false, 0.007);
  for (const sd of [-1, 1]) {
    lamp(st, ex + sd * (pw / 2 + 0.016), 0.45, s);
    flowerBed(st, ex + sd * (pw / 2 + 0.07), 0.45, 0.08, 0.05, sd + 2);
  }

  // Engeller (yüzen kuşlar buralara girmez)
  const blocked: ((x: number, z: number) => boolean)[] = [];
  // İskele: önde sağda (büyük gölde sağda), kıyıdan göl ortasına doğru
  const pa = big ? 0.55 : 1.15;
  const p0 = ringPt(pa, 0.048);
  const pAng = Math.atan2(cz - p0.z, cx - p0.x);
  const pLen = big ? 0.2 : 0.19;
  pier(st, p0.x, p0.z, pAng, pLen, s, !big);
  const p1x = p0.x + Math.cos(pAng) * pLen, p1z = p0.z + Math.sin(pAng) * pLen;
  blocked.push((x, z) => segDist(x, z, p0.x, p0.z, p1x, p1z) < 0.075);
  if (big) {
    // İskelenin yanında kuğu tekneler
    const sx = -Math.sin(pAng), sz = Math.cos(pAng);
    for (const [f, k] of [[0.27, 0], [0.47, 2], [0.67, 4]] as [number, number][]) {
      const bx = p0.x + Math.cos(pAng) * pLen * f - sx * 0.05, bz = p0.z + Math.sin(pAng) * pLen * f - sz * 0.05;
      swanBoat(st, bx, bz, -pAng + Math.PI / 2 + (k - 2) * 0.05, s, WL, k);
    }
    // Ada: çardak, ağaçlar, çalılar; kıyıdan adaya kemerli köprü
    gazebo(st, ix + 0.01, yAt(ix + 0.01, iz + 0.005), iz + 0.005, s, 0);
    treeAt(st, PROPS.treeLarge, ix - 0.07, iz - 0.035, yAt(ix - 0.07, iz - 0.035) - 0.003, 0.62 * s, 1);
    treeAt(st, PROPS.treeBlossom, ix + 0.075, iz - 0.04, yAt(ix + 0.075, iz - 0.04) - 0.003, 0.55 * s, 2);
    treeAt(st, PROPS.treeSmall, ix - 0.02, iz - 0.07, yAt(ix - 0.02, iz - 0.07) - 0.003, 0.5 * s, 3);
    rock(st, ix - 0.085, yAt(ix - 0.085, iz + 0.03) - 0.004, iz + 0.03, 0.035 * s, 4, 0.7);
    let bz0 = iz;
    while (islandD(ix, bz0) > 0.012) bz0 += 0.004;
    let bz1 = bz0;
    while (landD(ix, bz1) < 0.044 && bz1 < 0.45) bz1 += 0.004;
    bz0 -= 0.006;
    const by0 = yAt(ix, bz0), by1 = yAt(ix, bz1);
    archBridge(st, ix, bz0, by0, ix, bz1, by1, 0.03, 0.05, s);
    blocked.push((x, z) => segDist(x, z, ix, bz0, ix, bz1) < 0.06);
    // Köprüden adaya geçen kişi
    const t = 0.62;
    person(st, ix + 0.008, bz0 + (bz1 - bz0) * t, Math.PI, s, 6, 0, by0 + (by1 - by0) * t + 0.03 * Math.sin(Math.PI * t));
  }

  // Banklar (yolun dışında, göle bakar), lambalar, çöp kutuları
  const inside = (p: THREE.Vector3, m = 0.465) => Math.abs(p.x) < m && Math.abs(p.z) < m;
  const nearPier = (p: THREE.Vector3) => segDist(p.x, p.z, p0.x, p0.z, p1x, p1z) < 0.06 || (Math.abs(p.x - ex) < 0.07 && p.z > 0);
  const benchOff = 0.05 + pw + 0.018 + 0.02 * s; // oturanların ayakları yola basmasın
  const sitting: THREE.Vector3[] = [];
  for (const a of big ? [-2.6, -1.9, -1.2, -0.5, 0.1, 1.3, 2.05, 2.6, 3.4] : [-2.3, -1.5, -0.7, 0.3, 2.0, 2.7, 3.6]) {
    const p = ringPt(a, benchOff);
    if (!inside(p) || nearPier(p)) continue;
    const rot = Math.atan2(cx - p.x, cz - p.z);
    bench(st, p.x, p.z, rot, s);
    sitting.push(p);
    const b = ringPt(a + 0.12, benchOff);
    if (inside(b)) cyl(st, 0.01 * s * 1.6, 0.009 * s * 1.6, 0.035 * s * 1.6, BIN, b.x, G, b.z, 8);
  }
  // İki bankta oturan insanlar
  sitting.slice(0, 2).forEach((p, k) => {
    const rot = Math.atan2(cx - p.x, cz - p.z);
    person(st, p.x, p.z, rot, s, k + 2, 1, G + 0.035 * s);
  });
  for (let k = 0; k < (big ? 5 : 4); k++) {
    const a = ((k + 0.5) / (big ? 5 : 4)) * Math.PI * 2;
    const p = ringPt(a, 0.05 + pw + 0.008);
    if (inside(p, 0.47) && !nearPier(p)) lamp(st, p.x, p.z, s);
  }
  // Yolda yürüyenler
  for (const [a, k] of (big ? [[-0.9, 1], [-0.84, 3], [2.4, 5], [3.9, 7]] : [[-1.0, 1], [-0.94, 3], [2.3, 5]]) as [number, number][]) {
    const p = ringPt(a, po), q = ringPt(a + 0.05, po);
    person(st, p.x, p.z, Math.atan2(q.x - p.x, q.z - p.z), s, k, 0, G + 0.0035); // yolun üstünde
  }

  // Ağaçlar ve çalılar (yolun dışında kalan köşelerde)
  const treeSpots: [number, number, string, number][] = [
    [-0.42, -0.42, PROPS.treeLarge, 0.7], [0.42, -0.42, PROPS.treePine, 0.75], [-0.43, 0.42, PROPS.treeBlossom, 0.6], [0.43, 0.43, PROPS.treeStreet, 0.65],
    [-0.44, 0.0, PROPS.treeSmall, 0.6], [0.44, -0.05, PROPS.treeSmall, 0.6], [0.0, -0.45, PROPS.treePine, 0.62], [-0.22, -0.45, PROPS.treePine, 0.55],
    [0.24, -0.45, PROPS.bush, 0.8], [-0.45, -0.22, PROPS.treeStreet, 0.6], [0.45, 0.22, PROPS.bush, 0.75], [0.3, 0.46, PROPS.treeSmall, 0.55],
  ];
  treeSpots.forEach(([x, z, path, sc], k) => {
    if (landD(x, z) > 0.05 + pw + 0.03) treeAt(st, path, x, z, G - 0.002, sc * s * (big ? 1.25 : 1), k * 1.3);
  });

  // Kıyıda dinlenen ördekler
  for (const [a, k] of [[3.3, 0], [3.36, 1]] as [number, number][]) {
    const p = ringPt(a, 0.006);
    duck(st, p.x, p.z, a + Math.PI / 2, s, k, yAt(p.x, p.z));
  }

  g.add(mergeStatic([st]));
  // Su yüzü gölge düşürmesin (altındaki taban kararmasın)
  for (const m of g.children[0].children) if ((m as THREE.Mesh).material === LAKE) m.castShadow = false;

  // Yüzen kuşlar: her sürü açık suda kendi elipsini dolaşır (kıyıya, iskeleye, köprüye değmeyen en büyük elips)
  const animals: { obj: THREE.Object3D; cx: number; cz: number; r: number; phase: number; speed: number }[] = [];
  const open = (x: number, z: number) => landD(x, z) < -0.035 && !blocked.some(f => f(x, z));
  const fits = (fx: number, fz: number, rr: number) => {
    for (let j = 0; j < 32; j++) {
      const t = (j / 32) * Math.PI * 2;
      if (!open(fx + Math.cos(t) * (rr + 0.02), fz + Math.sin(t) * (rr + 0.02) * 0.7)) return false;
    }
    return true;
  };
  // İstenen merkezin çevresinde en büyük elipsi arar; yerleşen sürünün alanı ötekilere kapanır (yolları kesişmez)
  const swimmer = (fx0: number, fz0: number, rMax: number, k: number, speed: number, make: (inner: THREE.Group) => void) => {
    let fx = fx0, fz = fz0, rr = 0;
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        const x = fx0 + i * 0.03, z = fz0 + j * 0.03;
        let r0 = rMax;
        while (r0 > 0.02 && !fits(x, z, r0)) r0 -= 0.005;
        if (fits(x, z, r0) && r0 > rr + 0.004) [fx, fz, rr] = [x, z, r0];
      }
    }
    if (!rr) return;
    const er = rr + 0.045;
    blocked.push((x, z) => ((x - fx) / er) ** 2 + ((z - fz) / (er * 0.7)) ** 2 < 1);
    const inner = new THREE.Group();
    inner.position.y = WL;
    make(inner);
    const holder = new THREE.Group();
    holder.add(mergeStatic([inner]));
    holder.position.set(fx + rr, 0, fz);
    g.add(holder);
    animals.push({ obj: holder, cx: fx, cz: fz, r: rr, phase: k * 2.4, speed });
  };
  // Anne ördek ve arkasında yavruları
  const brood = (count: number, kind: number) => (inner: THREE.Group) => {
    duck(inner, 0, 0, 0, s, kind);
    for (let j = 1; j <= count; j++) duck(inner, (j % 2 ? 0.006 : -0.006) * s, -(0.022 + j * 0.026) * s, (j % 2 ? 0.2 : -0.2), s, 2);
  };
  if (big) {
    swimmer(0.16, -0.2, 0.14, 0, 0.16, brood(4, 1));
    swimmer(-0.25, 0.1, 0.1, 1, 0.2, inner => {
      swan(inner, 0, 0, 0, s);
      swan(inner, 0.025 * s, -0.075 * s, 0.15, s);
    });
    swimmer(-0.24, -0.2, 0.07, 2, 0.24, inner => duck(inner, 0, 0, 0, s, 0));
  } else {
    swimmer(-0.1, -0.06, 0.13, 0, 0.17, brood(3, 1));
    swimmer(0.14, -0.1, 0.07, 1, 0.22, inner => {
      duck(inner, 0, 0, 0, s, 0);
      duck(inner, -0.02 * s, -0.05 * s, 0, s, 1);
    });
  }
  g.userData.animals = animals;
  return g;
}

// Hilal: R yarıçaplı dairenin, merkezi x ekseninde ox kadar kaymış r yarıçaplı daire çıkarılmış hâli (tek parça yüz)
function crescent(R: number, r: number, ox: number) {
  const x = (R * R - r * r + ox * ox) / (2 * ox), y = Math.sqrt(R * R - x * x);
  const cw = ox < 0;
  const sh = new THREE.Shape();
  sh.moveTo(x, y);
  sh.absarc(0, 0, R, Math.atan2(y, x), Math.atan2(-y, x), cw);
  sh.absarc(ox, 0, r, Math.atan2(-y, x - ox), Math.atan2(y, x - ox), !cw);
  return sh;
}

// ======================= Seyir tepesi (2x2) =======================
// Doğal yuvarlak çimenli tepe (aşağıda açık, yukarıda koyu çimen, dik yerlerde toprak), yamaçlarda kaya öbekleri,
// çam ve yuvarlak ağaçlar, çalılar ve kır çiçekleri. Önden başlayıp dolanarak zirveye çıkan patika (dik yerlerde ahşap
// basamaklar), başında tabela ve lambalar. Zirvede korkuluklu ahşap seyir terası (dürbün, bank, bayrak), yamaçtaki
// düzlükte piknik çardağı; piknik yapan aile, yürüyüşçüler ve uçurtma uçuran çocuk.
const TIMBER = pm('#8a5a34', 0.85);
const SHINGLE = pm('#7b3f2e', 0.8);
export function hill() {
  const st = new THREE.Group();
  const s = 1 / (2 * 0.96);
  const H = 0.25, PX = -0.05, PZ = -0.1, CAP = H * 0.93;
  const raw = (x: number, z: number) => {
    const dx = (x - PX) / 1.2, dz = z - PZ;
    let y = H * Math.exp(-(dx * dx + dz * dz) / 0.05);
    y += 0.06 * Math.exp(-((x - 0.25) ** 2 + (z - 0.17) ** 2) / 0.016);
    y += 0.035 * Math.exp(-((x + 0.3) ** 2 + (z - 0.25) ** 2) / 0.012);
    y += (noise(x * 5, z * 5) + 1) * 0.003;
    if (y > CAP) y = CAP + (y - CAP) * 0.15;
    return y;
  };
  const hY = (x: number, z: number) => G + raw(x, z) * (1 - S(Math.max(Math.abs(x), Math.abs(z)), 0.33, 0.485));
  const maxY = (x0: number, z0: number, x1: number, z1: number) => {
    let m = -1;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) m = Math.max(m, hY(x0 + ((x1 - x0) * i) / 4, z0 + ((z1 - z0) * j) / 4));
    return m;
  };
  const minY = (x0: number, z0: number, x1: number, z1: number) => {
    let m = 9;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) m = Math.min(m, hY(x0 + ((x1 - x0) * i) / 4, z0 + ((z1 - z0) * j) / 4));
    return m;
  };

  // Arazi: yükseldikçe koyulaşan çimen, lekeler, dik yerlerde toprak
  const low = col('#62ad4a'), high = col('#4f9a3d'), dry = col('#a9b061'), dark = col('#3f8a35'), dirt = col('#98805a');
  terrain(st, 40, hY, (x, z, y, c) => {
    const e = 0.004;
    const slope = Math.hypot(hY(x + e, z) - hY(x - e, z), hY(x, z + e) - hY(x, z - e)) / (2 * e);
    const nz = noise(x * 4.3, z * 4.3);
    c.copy(low).lerp(high, S((y - G) / H, 0.15, 0.9));
    c.lerp(nz > 0 ? dry : dark, Math.abs(nz) * 0.35);
    c.lerp(dirt, S(slope, 0.75, 1.35) * 0.55);
  }, M.soil);

  // Patika: önden başlar, dolanarak zirvedeki terasa çıkar
  const curve = new THREE.CatmullRomCurve3([
    [0.07, 0.488], [0.08, 0.37], [0.17, 0.29], [0.13, 0.18], [-0.03, 0.13], [-0.19, 0.13], [-0.28, 0.02], [-0.26, -0.09], [-0.205, -0.07],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const pts = curve.getSpacedPoints(90);
  const pw = 0.045;
  ribbon(st, pts, pw, hY, col('#cdb48a'), false, 0.0045); // kıvrımlı yamaçta da çimenin belirgin üstünde
  const pathDist = (x: number, z: number) => Math.min(...pts.map(p => Math.hypot(p.x - x, p.z - z)));
  // Dik yerlerde ahşap basamaklar
  for (let k = 2; k < pts.length - 2; k += 2) {
    const a = pts[k], b = pts[k + 1];
    const dl = Math.hypot(b.x - a.x, b.z - a.z);
    if ((hY(b.x, b.z) - hY(a.x, a.z)) / dl < 0.3) continue;
    const step = add(st, new THREE.BoxGeometry(pw + 0.004, 0.004, 0.006), M.darkWood, a.x, hY(a.x, a.z) + 0.005, a.z);
    step.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  }
  // Yolun başında tabela ve lambalar
  const sg = item(st, 0.16, 0.45, -0.2, s, hY(0.16, 0.45));
  for (const sx of [-0.04, 0.04]) rod(sg, [sx, 0, 0], [sx, 0.11, 0], 0.0045, TIMBER, 5);
  box(sg, 0.12, 0.04, 0.006, signMat('SEYİR TEPESİ', '#2e5d34', '#ffe9a8'), 0, 0.065, 0.004);
  add(sg, new THREE.ConeGeometry(0.08, 0.025, 4).rotateY(Math.PI / 4).scale(1, 1, 0.25), SHINGLE, 0, 0.122, 0);
  for (const k of [6, 26, 46]) {
    const p = pts[k], q = pts[k + 1];
    const L = Math.hypot(q.x - p.x, q.z - p.z);
    const x = p.x + ((q.z - p.z) / L) * (pw / 2 + 0.014), z = p.z - ((q.x - p.x) / L) * (pw / 2 + 0.014);
    lamp(at(st, hY(x, z) - 0.002), x, z, s);
  }

  // Zirvede seyir terası: ahşap döşeme, kazıklar, korkuluk, dürbün, bank, bayrak; patikadan basamaklar
  const DX = -0.05, DZ = -0.07, DW = 0.17, DD = 0.13;
  const x0 = DX - DW / 2, x1 = DX + DW / 2, z0 = DZ - DD / 2, z1 = DZ + DD / 2;
  const deckY = maxY(x0, z0, x1, z1) + 0.012;
  for (let k = 0; k < 11; k++) box(st, DW, 0.003, 0.0105, k % 3 ? M.wood : PLANK2, DX, deckY - 0.003, z0 + 0.006 + k * 0.0118);
  for (const sd of [-1, 1]) box(st, 0.006, 0.006, DD, M.darkWood, DX + sd * (DW / 2 - 0.006), deckY - 0.009, DZ);
  // Kazıklar tahtaların altında biter (üstleri tahtalarla aynı boyda olunca titreşiyordu)
  for (const px of [x0 + 0.005, DX, x1 - 0.005]) {
    for (const pz of [z0 + 0.005, DZ, z1 - 0.005]) cyl(st, 0.004, 0.004, deckY - hY(px, pz) + 0.001, M.darkWood, px, hY(px, pz) - 0.004, pz, 6);
  }
  const RH = 0.042;
  const rail = (ax: number, az: number, bx: number, bz: number) => {
    for (const h of [RH * 0.5, RH]) rod(st, [ax, deckY + h, az], [bx, deckY + h, bz], 0.0018, M.wood, 4);
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.04));
    for (let k = 0; k <= n; k++) rod(st, [ax + ((bx - ax) * k) / n, deckY, az + ((bz - az) * k) / n], [ax + ((bx - ax) * k) / n, deckY + RH + 0.002, az + ((bz - az) * k) / n], 0.0024, M.darkWood, 4);
  };
  rail(x0 + 0.003, z1 - 0.003, x1 - 0.003, z1 - 0.003);
  rail(x1 - 0.003, z0 + 0.003, x1 - 0.003, z1 - 0.003);
  rail(x0 + 0.003, z0 + 0.003, x1 - 0.003, z0 + 0.003);
  rail(x0 + 0.003, z1 - 0.003, x0 + 0.003, DZ + 0.03);
  rail(x0 + 0.003, z0 + 0.003, x0 + 0.003, DZ - 0.03);
  const end = pts[pts.length - 1];
  const endY = hY(end.x, end.z) + 0.0045;
  const nSteps = Math.max(1, Math.round((deckY - endY) / 0.009));
  for (let k = 0; k < nSteps; k++) {
    const t = (k + 1) / (nSteps + 1);
    const yy = endY + (deckY - endY) * ((k + 1) / nSteps);
    box(st, 0.012, yy - hY(end.x + (x0 - end.x) * t, DZ) + 0.002, 0.05, M.wood, end.x + (x0 - end.x) * t, hY(end.x + (x0 - end.x) * t, DZ) - 0.002, DZ);
  }
  // Dürbün (öne bakar), bank, seyreden kişi
  const bino = item(st, DX + 0.03, z1 - 0.018, 0, s, deckY);
  cyl(bino, 0.006, 0.008, 0.07, M.gray, 0, 0, 0, 8);
  add(bino, new THREE.BoxGeometry(0.03, 0.022, 0.03), M.blue, 0, 0.082, 0);
  for (const sx of [-0.008, 0.008]) add(bino, new THREE.CylinderGeometry(0.006, 0.006, 0.02, 8).rotateX(Math.PI / 2), M.iron, sx, 0.084, 0.02);
  person(st, DX - 0.03, z1 - 0.03, 0.2, s, 7, 0, deckY);
  bench(at(st, deckY), DX - 0.02, z0 + 0.02, 0, s);
  // Bayrak (al bayrak, ay yıldız)
  const fx = x1 - 0.01, fz = z0 + 0.01;
  rod(st, [fx, deckY, fz], [fx, deckY + 0.24, fz], 0.0025, M.steel, 6);
  add(st, new THREE.SphereGeometry(0.004, 6, 4), M.gold, fx, deckY + 0.243, fz);
  // Bez direğin dışından başlar; ay ve yıldız bezin iki yüzünde, bezden belirgin uzakta tek kat (üst üste daireler titreşiyordu)
  const flag = item(st, fx, fz, 0, 1, deckY + 0.2);
  box(flag, 0.002, 0.04, 0.062, M.red, 0, -0.02, 0.034);
  for (const sd of [-1, 1]) {
    // Ayın içi bayrağın uç tarafına (+z) bakar; dönüşle şeklin x'i iki yüzde ters yöne gider
    add(flag, new THREE.ShapeGeometry(crescent(0.011, 0.009, -sd * 0.003), 8).rotateY((sd * Math.PI) / 2), M.white, sd * 0.0042, 0, 0.025);
    add(flag, new THREE.CircleGeometry(0.0045, 5).rotateY((sd * Math.PI) / 2), M.white, sd * 0.0042, 0, 0.04);
  }

  // Yamaçtaki piknik çardağı: taş kaide, dört direk, kiremit çatı, içinde masa ve banklar
  const PVX = 0.25, PVZ = 0.17, PR = 0.045;
  const pvTop = maxY(PVX - PR, PVZ - PR, PVX + PR, PVZ + PR) + 0.006;
  const pvLow = minY(PVX - PR, PVZ - PR, PVX + PR, PVZ + PR) - 0.004;
  box(st, PR * 2 + 0.01, pvTop - pvLow, PR * 2 + 0.01, M.rim, PVX, pvLow, PVZ);
  box(st, PR * 2, 0.003, PR * 2, M.wood, PVX, pvTop, PVZ);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(st, [PVX + sx * (PR - 0.006), pvTop, PVZ + sz * (PR - 0.006)], [PVX + sx * (PR - 0.006), pvTop + 0.08, PVZ + sz * (PR - 0.006)], 0.0035, TIMBER, 5);
  box(st, PR * 2 + 0.006, 0.006, PR * 2 + 0.006, TIMBER, PVX, pvTop + 0.08, PVZ);
  add(st, new THREE.ConeGeometry(PR * 1.75, 0.05, 4).rotateY(Math.PI / 4), SHINGLE, PVX, pvTop + 0.086 + 0.025, PVZ);
  add(st, new THREE.SphereGeometry(0.004, 6, 4), M.gold, PVX, pvTop + 0.114, PVZ);
  const tbl = item(st, PVX, PVZ, Math.PI / 2, s, pvTop + 0.003);
  box(tbl, 0.1, 0.005, 0.045, M.wood, 0, 0.035, 0);
  for (const sx of [-0.04, 0.04]) box(tbl, 0.005, 0.035, 0.035, TIMBER, sx, 0, 0);
  for (const sz of [-0.045, 0.045]) box(tbl, 0.1, 0.004, 0.016, M.wood, 0, 0.02, sz);
  person(st, PVX + 0.022, PVZ - 0.006, -Math.PI / 2, s, 3, 1, pvTop + 0.003 + 0.024 * s);

  // Kaya öbekleri (yarısı toprağa gömülü)
  [[0.13, -0.27], [-0.25, -0.24], [0.09, 0.02], [-0.33, 0.12], [0.3, -0.08], [-0.12, -0.3], [0.03, -0.16]].forEach(([x, z], k) => {
    for (let j = 0; j < 3; j++) {
      const rx = x + Math.cos(j * 2.1 + k) * 0.022, rz = z + Math.sin(j * 2.1 + k) * 0.018;
      const r = (0.028 - j * 0.007) * (k % 2 ? 0.9 : 1.1);
      if (pathDist(rx, rz) < pw / 2 + r) continue;
      rock(st, rx, hY(rx, rz) - r * 0.3, rz, r, k + j, 0.65);
    }
  });
  // Ağaçlar ve çalılar
  const trees: [number, number, string, number][] = [
    [-0.38, -0.36, PROPS.treePine, 0.75], [-0.24, -0.4, PROPS.treePine, 0.65], [0.32, -0.33, PROPS.treePine, 0.7], [0.41, -0.15, PROPS.treePine, 0.6],
    [0.1, -0.4, PROPS.treePine, 0.6], [-0.42, -0.2, PROPS.treePine, 0.6], [0.22, -0.42, PROPS.treePine, 0.55], [-0.4, -0.05, PROPS.treeStreet, 0.6],
    [-0.4, 0.36, PROPS.treeLarge, 0.62], [0.4, 0.4, PROPS.treeStreet, 0.6], [0.38, 0.08, PROPS.treeSmall, 0.55], [0.18, 0.08, PROPS.treeSmall, 0.5],
    [-0.14, 0.42, PROPS.treeBlossom, 0.55], [-0.1, 0.22, PROPS.bush, 0.75], [0.25, 0.32, PROPS.bush, 0.7], [-0.2, -0.16, PROPS.bush, 0.6],
  ];
  trees.forEach(([x, z, path, sc], k) => {
    if (pathDist(x, z) < pw / 2 + 0.02) return;
    treeAt(st, path, x, z, hY(x, z) - 0.004, sc * s, k * 1.7);
  });
  // Kır çiçekleri (aşağı çayırda)
  const r = rand(9);
  for (let k = 0; k < 45; k++) {
    const x = -0.45 + r() * 0.9, z = -0.1 + r() * 0.56;
    if (raw(x, z) > 0.12 || pathDist(x, z) < pw / 2 + 0.01) continue;
    add(st, FLOWER_GEO, FLOWERS[k % FLOWERS.length], x, hY(x, z) + 0.004, z).scale.setScalar(s * 0.9);
  }

  // Piknik: kareli örtü, sepet, yere oturan aile
  const PX2 = -0.31, PZ2 = 0.36;
  // Örtü yan yana kırmızı ve beyaz karelerden (üst üste serilince yüzler titreşiyordu); çimenden belirgin yüksekte
  const py = maxY(PX2 - 0.04, PZ2 - 0.03, PX2 + 0.04, PZ2 + 0.03) + 0.001;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) box(st, 0.075 / 4, 0.0025, 0.058 / 3, (i + j) % 2 ? M.white : M.red, PX2 - 0.075 / 2 + (i + 0.5) * (0.075 / 4), py, PZ2 - 0.029 + (j + 0.5) * (0.058 / 3));
  box(st, 0.016, 0.01, 0.011, M.darkWood, PX2 + 0.012, py + 0.0025, PZ2 - 0.006);
  add(st, new THREE.TorusGeometry(0.006, 0.0012, 4, 10, Math.PI), M.darkWood, PX2 + 0.012, py + 0.0125, PZ2 - 0.006);
  person(st, PX2 - 0.02, PZ2 - 0.022, 0.3, s, 1, 4, py);
  person(st, PX2 + 0.026, PZ2 + 0.018, Math.PI + 0.4, s, 2, 4, py);
  // Patikada yürüyüşçüler
  for (const [k, c] of [[30, 5], [34, 8], [70, 9]] as [number, number][]) {
    const p = pts[k], q = pts[k + 1];
    person(st, p.x, p.z, Math.atan2(q.x - p.x, q.z - p.z), s, c, 0, hY(p.x, p.z) + 0.0045); // patikanın üstünde
  }
  // Uçurtma uçuran çocuk
  const kx = 0.3, kz = 0.42;
  const kid = person(st, kx, kz, Math.PI - 0.3, s * 0.75, 6, 2, hY(kx, kz) + 0.002);
  kid.updateMatrix();
  const hand = new THREE.Vector3(0.013, 0.18, 0.012).applyMatrix4(kid.matrix);
  const kite: V3 = [0.2, 0.42, 0.18];
  rod(st, [hand.x, hand.y, hand.z], kite, 0.0006, M.white, 3);
  const kt = item(st, kite[0], kite[2], Math.atan2(kx - kite[0], kz - kite[2]), 1, kite[1]);
  kt.rotation.x = -0.3;
  add(kt, new THREE.CircleGeometry(0.03, 4).scale(0.75, 1.15, 1), PAINT[0], 0, 0, 0);
  add(kt, new THREE.CircleGeometry(0.03, 4).scale(0.75, 1.15, 1).rotateY(Math.PI), PAINT[2], 0, 0, -0.0005);
  for (let k = 1; k <= 4; k++) add(kt, new THREE.BoxGeometry(0.008, 0.004, 0.002), PAINT[k], Math.sin(k * 1.4) * 0.006, -0.035 - k * 0.014, 0);
  return mergeStatic([st]);
}

// ======================= Plaj voleybolu (2x2) =======================
// Taranmış kum zeminde resmî ölçülü saha: mavi çizgi şeritleri ve köşe işaretleri, gerili file (antenler, kenar
// bantları, gergi halatları), dolgulu direkler, hakem kürsüsü ve skor tabelası. Maçta smaç vuran, blok yapan ve
// karşılamaya hazırlanan oyuncular, havada top. Arkada gölgelikli alüminyum tribün ve seyirciler; önde ahşap yürüyüş
// yolu, çizgili şemsiyeler ve şezlonglar, duş, sazdan çatılı plaj barı (tabureler, ışık zinciri, sörf tahtaları), palmiyeler.
const SAND = pm('#e9d39b', 1);
const STRAW = pm('#d8b46a', 1);
const STRAW_DARK = pm('#b8924f', 1);
const LINE = pm('#1565c0', 0.6);
const ALU = pm('#c9d1d9', 0.35, 0.6);
const PARASOL_GEOS = Array.from({ length: 8 }, (_, k) => new THREE.ConeGeometry(0.085, 0.03, 2, 1, true, (k * Math.PI) / 4, Math.PI / 4));
// Plaj şemsiyesi: direk, çizgili kumaş, tepe topuzu
function parasol(g: THREE.Object3D, x: number, z: number, s: number, m: THREE.Material, y = G) {
  const u = item(g, x, z, x * 5, s, y);
  rod(u, [0, -0.01, 0], [0, 0.14, 0], 0.0028, M.white, 5);
  for (let k = 0; k < 8; k++) add(u, PARASOL_GEOS[k], k % 2 ? M.white : m, 0, 0.141, 0);
  add(u, new THREE.SphereGeometry(0.005, 6, 4), M.white, 0, 0.158, 0);
}
// Şezlong: beyaz çerçeve, kalkık sırtlık, renkli havlu (başı -z). Havlu çerçevenin ortasındaki boşluğa, çerçeveyle aynı
// boyda tek yüz olarak oturur; çerçevenin dolu üstüne serilen ince havlu çerçeveyle neredeyse aynı boyda kalıp titreşiyordu.
function lounger(g: THREE.Object3D, x: number, z: number, rot: number, s: number, towel: THREE.Material, y = G) {
  const l = item(g, x, z, rot, s, y);
  const towelTop = (w: number, d: number) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  frame(l, 0.058, 0.11, 0.006, 0.004, M.white, 0, 0.018, 0.02);
  add(l, towelTop(0.05, 0.102), towel, 0, 0.024, 0.02);
  const back = item(l, 0, -0.06, 0, 1, 0.037);
  back.rotation.x = 0.6;
  frame(back, 0.058, 0.06, 0.006, 0.004, M.white, 0, 0, 0);
  add(back, towelTop(0.05, 0.052), towel, 0, 0.006, 0);
  for (const sx of [-0.024, 0.024]) for (const zz of [-0.03, 0.07]) box(l, 0.005, 0.018, 0.005, M.white, sx, 0, zz);
}
export function volley() {
  const st = new THREE.Group();
  const s = 1 / (2 * 0.96);
  const CZ = -0.06, LX = 0.34, LZ = 0.17;
  // Kum: hafif dalgalı, saha içi taranmış (açık), file önü çiğnenmiş (koyu)
  const sandC = col('#ead49c'), raked = col('#f4e4b6'), trodden = col('#d9bf84');
  terrain(st, 20, (x, z) => G + (noise(x * 3, z * 3) + 1) * 0.0012 * (1 - S(Math.max(Math.abs(x), Math.abs(z)), 0.4, 0.48)), (x, z, _y, c) => {
    const inCourt = S(-Math.max(Math.abs(x) - LX, Math.abs(z - CZ) - LZ), -0.02, 0.01);
    c.copy(sandC).lerp(raked, inCourt * 0.7).offsetHSL(0, 0, noise(x * 5, z * 5) * 0.025);
    c.lerp(trodden, inCourt * (1 - S(Math.abs(x), 0.02, 0.14)) * 0.45);
  }, SAND);
  const top = G + 0.0025;
  // Çizgi şeritleri ve köşe işaretleri
  for (const sd of [-1, 1]) {
    box(st, LX * 2 + 0.007, 0.004, 0.007, LINE, 0, G + 0.0015, CZ + sd * LZ); // şeritler dalgalı kumdan belirgin yüksekte
    box(st, 0.007, 0.004, LZ * 2, LINE, sd * LX, G + 0.0015, CZ);
    for (const sz of [-1, 1]) box(st, 0.008, 0.006, 0.008, M.white, sd * (LX + 0.006), G + 0.0045, CZ + sz * (LZ + 0.006));
  }
  // Köşe bayrakları
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const fx = sx * (LX + 0.025), fz = CZ + sz * (LZ + 0.025);
    rod(st, [fx, G - 0.004, fz], [fx, G + 0.07, fz], 0.0015, M.white, 4);
    box(st, 0.002, 0.016, 0.024, M.red, fx, G + 0.048, fz + 0.012); // üstü direğin tepesinden aşağıda
  }
  // File: dolgulu direkler, üst ve alt bant, ağ örgüsü, antenler, gergi halatları
  const NT = top + 0.11, NB = NT - 0.045, PZ = LZ + 0.035;
  for (const sd of [-1, 1]) {
    const z = CZ + sd * PZ;
    cyl(st, 0.005, 0.005, NT + 0.01 - G, M.steel, 0, G - 0.002, z, 8);
    cyl(st, 0.0085, 0.0085, 0.07, LINE, 0, G - 0.002, z, 10);
    add(st, new THREE.SphereGeometry(0.0055, 8, 6), M.yellow, 0, NT + 0.011, z);
    rod(st, [0, NT + 0.006, z], [0, G, CZ + sd * (PZ + 0.09)], 0.0009, M.iron, 3);
    box(st, 0.008, 0.007, 0.008, M.iron, 0, G - 0.001, CZ + sd * (PZ + 0.09));
    // Antenler (kırmızı-beyaz)
    for (let k = 0; k < 6; k++) cyl(st, 0.0012, 0.0012, 0.015, k % 2 ? M.red : M.white, 0, NB + k * 0.015, CZ + sd * LZ, 4);
  }
  box(st, 0.0035, 0.005, PZ * 2, M.white, 0, NT - 0.005, CZ);
  box(st, 0.003, 0.003, LZ * 2, M.white, 0, NB, CZ);
  for (const sd of [-1, 1]) box(st, 0.003, NT - NB, 0.004, M.white, 0, NB, CZ + sd * LZ);
  for (let k = 1; k < 30; k++) {
    const z = CZ - LZ + (k * LZ * 2) / 30;
    rod(st, [0, NB, z], [0, NT - 0.005, z], 0.0005, M.iron, 3);
  }
  for (let k = 1; k < 5; k++) rod(st, [0, NB + (k * (NT - NB)) / 5, CZ - LZ], [0, NB + (k * (NT - NB)) / 5, CZ + LZ], 0.0005, M.iron, 3);
  // Oyuncular: solda kırmızı (smaç), sağda mavi (blok) takım; havada top
  const red = pm('#d32f2f', 0.6), blue = pm('#1e5bd6', 0.6);
  const players: [number, number, number, number, number, THREE.Material][] = [
    [-0.045, CZ + 0.05, Math.PI / 2, 2, 0.024, red], [-0.2, CZ - 0.07, Math.PI / 2 + 0.3, 3, 0, red],
    [0.035, CZ + 0.045, -Math.PI / 2, 2, 0.018, blue], [0.23, CZ - 0.06, -Math.PI / 2 - 0.2, 3, 0, blue],
  ];
  players.forEach(([x, z, rot, pose, jump, shirt], k) => {
    const p = person(st, x, z, rot, s, k + 1, pose, top + jump);
    p.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh && PAINT.includes(m.material as THREE.MeshStandardMaterial)) m.material = shirt;
    });
  });
  const ball = item(st, -0.018, CZ + 0.062, 0.6, 1, NT + 0.03);
  add(ball, new THREE.SphereGeometry(0.0075, 10, 8), M.yellow, 0, 0, 0);
  add(ball, new THREE.TorusGeometry(0.0074, 0.0016, 4, 12), M.blue, 0, 0, 0);
  add(ball, new THREE.TorusGeometry(0.0074, 0.0016, 4, 12).rotateY(Math.PI / 2), M.blue, 0, 0, 0);
  // Hakem kürsüsü (filenin önünde, sahaya bakar)
  const ref = item(st, 0, CZ + LZ + 0.07, Math.PI, s, G);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(ref, [sx * 0.024, 0, sz * 0.024], [sx * 0.017, 0.116, sz * 0.017], 0.0028, M.steel, 5);
  for (const h of [0.04, 0.08]) {
    rod(ref, [-0.022, h, -0.022], [0.022, h, -0.022], 0.0022, M.steel, 4);
    rod(ref, [-0.022, h, 0.022], [0.022, h, 0.022], 0.0022, M.steel, 4);
  }
  box(ref, 0.05, 0.006, 0.05, M.wood, 0, 0.114, 0); // ayaklar bu tahtaya basar (üstü ayakkabıların altı)
  box(ref, 0.032, 0.036, 0.028, M.white, 0, 0.12, -0.006);
  box(ref, 0.034, 0.03, 0.004, M.white, 0, 0.156, -0.02);
  for (let k = 0; k < 4; k++) rod(ref, [-0.012, 0.02 + k * 0.03, -0.04 - k * 0.004], [0.012, 0.02 + k * 0.03, -0.04 - k * 0.004], 0.002, M.steel, 4);
  for (const sx of [-0.012, 0.012]) rod(ref, [sx, 0, -0.056], [sx, 0.117, -0.026], 0.0022, M.steel, 4);
  person(ref, 0, -0.004, 0, 1, 9, 1, 0.156, false);
  // Arkada tribün: üç basamak alüminyum oturak, ayak basamakları, çerçeve, sırt korkuluğu, gölgelik
  for (let k = 0; k < 3; k++) {
    const y = G + 0.024 + 0.022 * k, z = -0.345 - 0.042 * k;
    box(st, 0.56, 0.004, 0.022, ALU, 0, y - 0.004, z);
    box(st, 0.56, 0.003, 0.016, M.gray, 0, y - 0.0217, z + 0.022); // ayak basamağı: oturanların ayakkabısı üstüne basar
    for (let j = 0; j < 5; j++) rod(st, [-0.26 + j * 0.13, G, z - 0.006], [-0.26 + j * 0.13, y - 0.004, z - 0.006], 0.0022, M.gray, 4);
  }
  for (const sx of [-1, 1]) box(st, 0.004, 0.08, 0.14, M.gray, sx * 0.282, G, -0.39);
  rod(st, [-0.28, G + 0.1, -0.44], [0.28, G + 0.1, -0.44], 0.0022, M.gray, 4);
  for (let j = 0; j < 5; j++) rod(st, [-0.26 + j * 0.13, G + 0.068, -0.44], [-0.26 + j * 0.13, G + 0.1, -0.44], 0.0018, M.gray, 4);
  for (const sx of [-1, 1]) for (const zz of [-0.32, -0.465]) rod(st, [sx * 0.29, G, zz], [sx * 0.29, G + (zz < -0.4 ? 0.17 : 0.15), zz], 0.0032, M.white, 5);
  for (let k = 0; k < 6; k++) {
    const stripe = add(st, new THREE.BoxGeometry(0.6 / 6, 0.003, 0.16), k % 2 ? M.white : PAINT[6], -0.25 + k * 0.1, G + 0.16, -0.392);
    stripe.rotation.x = -0.13;
  }
  // Seyirciler
  const r = rand(4);
  for (let k = 0; k < 9; k++) {
    const row = k % 3, x = -0.24 + ((k * 0.137 + row * 0.05) % 0.48);
    person(st, x + (r() - 0.5) * 0.02, -0.345 - 0.042 * row + 0.004, (r() - 0.5) * 0.4, s, k + 3, 1, G + 0.024 + 0.022 * row);
  }
  // Skor tabelası (sahanın solunda, çapraz durur)
  const sb = item(st, -0.43, CZ + 0.02, Math.PI / 4, s, G);
  for (const sx of [-0.05, 0.05]) rod(sb, [sx, 0, 0], [sx, 0.15, 0], 0.004, M.iron, 5);
  box(sb, 0.13, 0.06, 0.012, M.iron, 0, 0.1, 0);
  box(sb, 0.12, 0.05, 0.002, signMat('18 : 15', '#0d2a4a', '#ffd54f'), 0, 0.105, 0.0115); // tabela panodan belirgin önde
  box(sb, 0.12, 0.05, 0.002, signMat('18 : 15', '#0d2a4a', '#ffd54f'), 0, 0.105, -0.0115);
  // Ahşap yürüyüş yolu (önden sahaya)
  const bwx = 0.18;
  for (let k = 0; k < 17; k++) box(st, 0.075, 0.004, 0.013, k % 3 ? M.wood : PLANK2, bwx, G + 0.0015, 0.479 - k * 0.0155); // kumdan ve kenar duvarından belirgin uzakta
  for (const sd of [-1, 1]) box(st, 0.004, 0.0095, 0.26, M.darkWood, bwx + sd * 0.04, G - 0.002, 0.35);
  for (const z of [0.44, 0.3]) lamp(st, bwx - 0.055, z, s);
  // Şemsiyeler ve şezlonglar
  const towels = [PAINT[0], PAINT[2], PAINT[4], PAINT[6], PAINT[7], PAINT[1]];
  [[-0.36, 0.29, 0], [-0.16, 0.38, 3], [-0.38, 0.42, 5]].forEach(([x, z, c], k) => {
    parasol(st, x, z, s, PAINT[c]);
    lounger(st, x - 0.045, z + 0.02, 0.15, s * 0.95, towels[k * 2]);
    lounger(st, x + 0.045, z + 0.02, -0.15, s * 0.95, towels[k * 2 + 1]);
  });
  person(st, -0.12, 0.27, 2.6, s, 11, 0, G + 0.0025);
  // Duş: ızgaralı taban, direk, kol ve başlık, akan su; duş alan kişi
  const sh = item(st, 0.075, 0.33, 0, s, G + 0.002); // taban dalgalı kumdan belirgin yüksekte
  box(sh, 0.07, 0.01, 0.07, M.gray, 0, -0.004, 0);
  for (let k = 0; k < 6; k++) box(sh, 0.056, 0.006, 0.004, M.iron, 0, 0.006, -0.03 + k * 0.012); // ızgara tabandan belirgin yüksek
  rod(sh, [-0.03, 0.006, -0.03], [-0.03, 0.2, -0.03], 0.0045, M.steel, 6);
  rod(sh, [-0.03, 0.2, -0.03], [-0.005, 0.2, -0.005], 0.0035, M.steel, 5);
  cyl(sh, 0.01, 0.004, 0.008, M.steel, -0.005, 0.188, -0.005, 8);
  add(sh, new THREE.ConeGeometry(0.02, 0.1, 8, 1, true), SPRAY, -0.005, 0.135, -0.005);
  person(sh, 0, 0.002, 0.4, 1, 12, 0, 0.012);
  // Plaj barı: ahşap döşeme, kulübe, tezgâh, raf ve şişeler, sazdan çatı, tabela, tabureler, buzluk, sörf tahtaları
  const bar = item(st, 0.35, 0.37, 0, s, G - 0.002);
  box(bar, 0.34, 0.012, 0.22, M.darkWood, 0, 0, 0);
  box(bar, 0.3, 0.138, 0.1, M.wood, 0, 0.012, -0.05);
  box(bar, 0.3, 0.058, 0.03, PLANK2, 0, 0.012, 0.042);
  box(bar, 0.32, 0.006, 0.044, M.white, 0, 0.07, 0.042);
  box(bar, 0.26, 0.004, 0.014, M.darkWood, 0, 0.09, 0.006);
  for (let k = 0; k < 9; k++) cyl(bar, 0.0035, 0.004, 0.018, PAINT[k % PAINT.length], -0.11 + k * 0.027, 0.094, 0.006, 6);
  for (const sx of [-1, 1]) rod(bar, [sx * 0.145, 0.07, 0.06], [sx * 0.145, 0.15, 0.06], 0.004, M.darkWood, 5);
  add(bar, new THREE.ConeGeometry(0.25, 0.085, 4).rotateY(Math.PI / 4).scale(1.05, 1, 0.72), STRAW, 0, 0.15 + 0.0425, -0.015);
  add(bar, new THREE.CylinderGeometry(0.25, 0.262, 0.016, 4, 1, true).rotateY(Math.PI / 4).scale(1.05, 1, 0.72), STRAW_DARK, 0, 0.145, -0.015);
  box(bar, 0.3, 0.03, 0.008, M.darkWood, 0, 0.118, 0.064);
  box(bar, 0.2, 0.026, 0.004, signMat('PLAJ BAR', '#00838f'), 0, 0.12, 0.07);
  for (let k = 0; k < 4; k++) {
    const x = -0.1 + k * 0.066;
    rod(bar, [x, 0.012, 0.09], [x, 0.048, 0.09], 0.003, M.steel, 4);
    cyl(bar, 0.011, 0.011, 0.005, PAINT[k + 1], x, 0.048, 0.09, 10);
  }
  person(bar, -0.034, 0.093, Math.PI, 1, 13, 1, 0.053);
  person(bar, 0.032, 0.093, Math.PI + 0.2, 1, 14, 1, 0.053);
  box(bar, 0.045, 0.03, 0.028, M.blue, 0.13, 0.012, 0.09);
  box(bar, 0.047, 0.006, 0.03, M.white, 0.13, 0.042, 0.09);
  for (const [dx, k] of [[0, 0], [0.022, 5], [0.044, 2]] as [number, number][]) {
    const sb2 = add(bar, new THREE.CapsuleGeometry(0.015, 0.11, 4, 8).scale(1, 1, 0.22), PAINT[k], 0.168 + dx * 0.15, 0.08, -0.06 + dx);
    sb2.rotation.set(0, Math.PI / 2, -0.22);
  }
  // Işık zinciri: bardan palmiyeye sarkan ampuller
  const L0 = new THREE.Vector3(0.27, G + 0.08, 0.41), L1 = new THREE.Vector3(0.408, G + 0.14, 0.15);
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    const p = L0.clone().lerp(L1, t);
    p.y -= Math.sin(Math.PI * t) * 0.03;
    add(st, BULB_GEO, BULB, p.x, p.y, p.z);
    if (k < 10) {
      const q = L0.clone().lerp(L1, t + 0.1);
      q.y -= Math.sin(Math.PI * (t + 0.1)) * 0.03;
      rod(st, [p.x, p.y + 0.004, p.z], [q.x, q.y + 0.004, q.z], 0.0006, M.iron, 3);
    }
  }
  // Top sepeti, tırmık
  const bk = item(st, -0.1, 0.18, 0.3, s, G);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(bk, [sx * 0.018, 0, sz * 0.018], [sx * 0.02, 0.05, sz * 0.02], 0.0018, M.steel, 4);
  box(bk, 0.04, 0.03, 0.04, pm('#2b2b2b', 0.9), 0, 0.02, 0);
  for (const [dx, dz, c] of [[-0.008, -0.007, 2], [0.009, 0.004, 1], [-0.002, 0.01, 2]] as [number, number, number][]) add(bk, new THREE.SphereGeometry(0.0085, 8, 6), PAINT[c], dx, 0.056, dz);
  // Palmiyeler
  for (const [x, z, h, lean] of [[-0.42, 0.13, 0.3, -0.1], [0.42, 0.15, 0.32, 0.1], [-0.42, -0.43, 0.28, -0.08], [0.42, -0.43, 0.3, 0.1], [0.03, 0.45, 0.26, 0.06]]) st.add(palm(x, z, h, lean));
  return mergeStatic([st]);
}

// ======================= Kumarhane kulesi (1x1) =======================
// Taş kaplı iki katlı kaide üstünde altın camlı, uçları yuvarlak (stadyum planlı) kule: beyaz taş dikey kanatlar,
// altın kuşaklar, köşelerde pembe ve altın neon şeritler. Tepede "CASINO" neon yazılı taç, ampullü altın sivri uçlar,
// iki kırmızı zar ve kırmızı uyarı ışıklı altın sivri kule. Kaidenin çatısında havuz terası; önde altın sütunlu,
// altı ışıklı ve ampul dizili giriş saçağı, "AKSOY CASINO" neon tabela, döner kapılar, kırmızı halı ve altın dikmeler,
// kapıcılar ve misafirler; iki yanda fıskiyeli havuzlar, köşelerde palmiyeler, köşede dikey "CASINO" tabelası.
// Neonlar ve ampuller gece yanar (DayNight 'lamp' malzemeleri; neonun rengini emissiveMap verir).
function solidTex(color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const x = c.getContext('2d')!;
  x.fillStyle = color;
  x.fillRect(0, 0, 4, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Neon tüp: gündüz renkli cam, gece kendi renginde parlar
function neon(color: string) {
  const m = new THREE.MeshStandardMaterial({ color, emissive: '#000000', emissiveMap: solidTex(color), roughness: 0.3 });
  m.name = 'lamp';
  return m;
}
// Neon tabela: koyu zemin, altın çerçeve, renkli harfler; gece harfler beyaz özlü ve renkli haleli parlar.
// aspect: tabelanın eni/boyu (1'den küçükse harfler alt alta dizilir)
const neonSigns = new Map<string, THREE.MeshStandardMaterial>();
function neonSign(text: string, color: string, aspect: number) {
  const key = `${text}|${color}|${aspect.toFixed(2)}`;
  const hit = neonSigns.get(key);
  if (hit) return hit;
  const vertical = aspect < 1;
  const w = vertical ? 96 : aspect > 6 ? 1024 : 512;
  const h = Math.max(32, Math.round(w / aspect));
  const make = (glow: boolean) => {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const x = cv.getContext('2d')!;
    x.fillStyle = glow ? '#000000' : '#1a0f22';
    x.fillRect(0, 0, w, h);
    if (!glow) {
      const b = Math.max(3, Math.round(Math.min(w, h) * 0.05));
      x.strokeStyle = '#e3bd5c';
      x.lineWidth = b;
      x.strokeRect(b, b, w - b * 2, h - b * 2);
    }
    const letters = vertical ? [...text] : [text];
    const size = vertical ? Math.min(w * 0.8, (h * 0.86) / letters.length) : h * 0.66;
    x.font = `bold ${size}px Fredoka, Arial, sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.shadowColor = color;
    x.shadowBlur = (glow ? 0.22 : 0.08) * size;
    x.lineWidth = (glow ? 0.09 : 0.05) * size;
    x.strokeStyle = color;
    x.fillStyle = glow ? '#ffffff' : color;
    letters.forEach((t, i) => {
      const fit = vertical ? 1 : Math.min(1, (w * 0.86) / Math.max(1, x.measureText(t).width));
      x.save();
      x.translate(w / 2, vertical ? ((i + 0.5) * h) / letters.length + size * 0.04 : h / 2 + size * 0.05);
      x.scale(fit, 1);
      x.strokeText(t, 0, 0);
      x.fillText(t, 0, 0);
      x.restore();
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  const m = new THREE.MeshStandardMaterial({ map: make(false), emissiveMap: make(true), emissive: '#000000', roughness: 0.4 });
  m.name = 'lamp';
  neonSigns.set(key, m);
  return m;
}
let CASINO_MATS: { pink: THREE.MeshStandardMaterial; gold: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial } | null = null;
const casinoMats = () => {
  if (!CASINO_MATS) {
    // Altın cam: kule cephesi dokusu altın renge boyanır (pencereler gece yine yanar)
    const glass = KIT.GLASS[0].clone();
    glass.color.set('#e2b866');
    glass.metalness = 0.55;
    glass.roughness = 0.18;
    CASINO_MATS = { pink: neon('#ff3fa4'), gold: neon('#ffc94a'), glass };
  }
  return CASINO_MATS;
};
const TRAVERTINE = pm('#e9dfcb', 0.8);
const CROWN = pm('#2a2230', 0.4, 0.5);
const DICE = pm('#c8102e', 0.25, 0.1);
const CARPET = pm('#a3121f', 0.95);
// Zar: kırmızı küp, beyaz noktalar (karşılıklı yüzlerin toplamı 7)
function die(g: THREE.Object3D, x: number, y: number, z: number, size: number, rx: number, ry: number, rz: number) {
  const d = item(g, x, z, 0, 1, y);
  d.rotation.set(rx, ry, rz);
  add(d, new THREE.BoxGeometry(size, size, size), DICE, 0, 0, 0);
  const P: Record<number, [number, number][]> = {
    1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
    5: [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0]], 6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
  };
  const faces: [V3, V3, V3, number][] = [
    [[0, 1, 0], [1, 0, 0], [0, 0, 1], 1], [[0, -1, 0], [1, 0, 0], [0, 0, 1], 6], [[0, 0, 1], [1, 0, 0], [0, 1, 0], 2],
    [[0, 0, -1], [1, 0, 0], [0, 1, 0], 5], [[1, 0, 0], [0, 0, 1], [0, 1, 0], 3], [[-1, 0, 0], [0, 0, 1], [0, 1, 0], 4],
  ];
  // Noktalar: yüzden hafifçe kabaran yassı beyaz kubbeler (yüze yapışık düz daire telefonda titreşiyordu)
  const h = size / 2, q = size * 0.26;
  for (const [nrm, u, v, count] of faces) {
    const pip = new THREE.SphereGeometry(size * 0.085, 8, 4).scale(1, 1, 0.3);
    pip.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...nrm)));
    for (const [a, b] of P[count]) add(d, pip, M.white, nrm[0] * h + (u[0] * a + v[0] * b) * q, nrm[1] * h + (u[1] * a + v[1] * b) * q, nrm[2] * h + (u[2] * a + v[2] * b) * q);
  }
}
export function casino() {
  const st = new THREE.Group();
  const { pink, gold, glass } = casinoMats();
  const ps = 0.75; // insanlar ve eşyalar (yapının ölçüsüne göre)
  // Meydan: traverten taşı, altın kakma çizgiler (taştan belirgin yüksekte, yoksa yüzleri titreşir)
  box(st, 0.98, 0.03, 0.98, TRAVERTINE, 0, 0, 0);
  for (const sd of [-1, 1]) box(st, 0.004, 0.006, 0.34, M.gold, sd * 0.09, 0.03, 0.31);
  // Kaide: taş cephe, altın korniş, çatı döşemesi
  const PY = 0.22, PZ0 = -0.46, PZ1 = 0.12;
  st.add(part(KIT.facadeBox(0.9, PY, PZ1 - PZ0, 0.03), KIT.STONE[0], 0, 0.03 + PY / 2, (PZ0 + PZ1) / 2));
  box(st, 0.91, 0.012, PZ1 - PZ0 + 0.01, M.stone, 0, 0.03, (PZ0 + PZ1) / 2);
  box(st, 0.924, 0.016, PZ1 - PZ0 + 0.024, M.gold, 0, 0.03 + PY, (PZ0 + PZ1) / 2);
  box(st, 0.9, 0.006, PZ1 - PZ0, M.paving, 0, 0.03 + PY + 0.016, (PZ0 + PZ1) / 2);
  const RT = 0.03 + PY + 0.022; // kaide çatısı
  // Kule: ortada kutu, iki uçta silindir (stadyum planı)
  const TZ = -0.2, R = 0.15, A = 0.15, TH = 1.4, y0 = RT;
  const stadium = (r: number, h: number, m: THREE.Material, y: number) => {
    box(st, A * 2, h, r * 2, m, 0, y, TZ);
    for (const sd of [-1, 1]) cyl(st, r, r, h, m, sd * A, y, TZ, 16);
  };
  stadium(R + 0.012, 0.03, M.stone, y0);
  st.add(part(KIT.facadeBox(A * 2, TH, R * 2, y0), glass, 0, y0 + TH / 2, TZ));
  for (const sd of [-1, 1]) st.add(part(KIT.facadeCylinder(R, R, TH, 20, y0), glass, sd * A, y0 + TH / 2, TZ));
  // Beyaz taş dikey kanatlar (ön ve arka yüz), altın kuşaklar
  for (const sz of [-1, 1]) for (const x of [-0.1, -0.035, 0.035, 0.1]) box(st, 0.012, TH - 0.03, 0.016, M.stone, x, y0 + 0.03, TZ + sz * (R + 0.006));
  for (let k = 1; k <= 4; k++) stadium(R + 0.006, 0.012, M.gold, y0 + (k * TH) / 4.6);
  // Neon şeritler: düz yüzle yuvarlak ucun birleştiği köşelerde pembe, en uçlarda altın (altın kuşaklardan belirgin dışarıda)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(st, 0.008, TH - 0.04, 0.008, pink, sx * (A + 0.003), y0 + 0.03, TZ + sz * (R + 0.008));
    box(st, 0.008, TH - 0.04, 0.008, gold, sx * (A + R + 0.008), y0 + 0.03, TZ);
  }
  // Taç: çatı plakası, "CASINO" yazılı koyu bant, altın kenarlar, ampullü sivri uçlar
  const TT = y0 + TH;
  stadium(R + 0.012, 0.02, M.gold, TT);
  const CB = TT + 0.02, CH = 0.16, CR = 0.12;
  // Koyu gövde üstteki altın bandın içinde biter: çatıyı tek başına altın bant örter (iki çatı aynı boyda titreşiyordu)
  box(st, A * 2, CH - 0.012, CR * 2, CROWN, 0, CB, TZ);
  for (const sd of [-1, 1]) cyl(st, CR, CR, CH - 0.012, CROWN, sd * A, CB, TZ, 16);
  for (const sz of [-1, 1]) box(st, 0.29, 0.11, 0.004, neonSign('CASINO', '#ff3fa4', 0.29 / 0.11), 0, CB + 0.025, TZ + sz * (CR + 0.002));
  for (const yy of [CB, CB + CH - 0.012]) {
    box(st, A * 2, 0.012, CR * 2 + 0.012, M.gold, 0, yy, TZ);
    for (const sd of [-1, 1]) cyl(st, CR + 0.006, CR + 0.006, 0.012, M.gold, sd * A, yy, TZ, 16);
  }
  const spikes: [number, number][] = [];
  for (let k = 0; k < 4; k++) for (const sz of [-1, 1]) spikes.push([-A + (k * 2 * A) / 3, TZ + sz * (CR - 0.004)]);
  for (const sd of [-1, 1]) for (let k = 1; k < 6; k++) {
    const a = -Math.PI / 2 + (k / 6) * Math.PI;
    spikes.push([sd * (A + Math.cos(a) * (CR - 0.004)), TZ + Math.sin(a) * (CR - 0.004)]);
  }
  for (const [x, z] of spikes) {
    add(st, new THREE.ConeGeometry(0.011, 0.05, 6), M.gold, x, CB + CH + 0.025, z);
    add(st, BULB_GEO, BULB, x, CB + CH + 0.053, z);
  }
  // Tepede iki zar ve altın sivri kule, kırmızı uyarı ışığı
  die(st, -0.085, CB + CH + 0.066, TZ + 0.01, 0.09, 0.25, 0.5, 0.15);
  die(st, 0.085, CB + CH + 0.064, TZ - 0.01, 0.09, -0.2, -0.35, 0.3);
  cyl(st, 0.003, 0.018, 0.34, M.gold, 0, CB + CH, TZ, 10);
  add(st, new THREE.SphereGeometry(0.016, 8, 6), KIT.LIGHT, 0, CB + CH + 0.35, TZ);

  // Kaide çatısında havuz terası: beyaz kenarlı havuz (su kenardan biraz aşağıda), şezlonglar, şemsiyeler, kenarlarda bahçeler
  basin(st, 0.34, 0.085, 0.012, 0.0125, M.white, WATER, 0, RT, 0.01);
  for (let k = 0; k < 6; k++) lounger(st, -0.15 + k * 0.06, 0.088, 0, 0.35, PAINT[k], RT);
  for (const sx of [-0.2, 0.2]) parasol(st, sx, 0.085, 0.42, PAINT[sx > 0 ? 0 : 1], RT);
  for (const sx of [-1, 1]) {
    box(st, 0.12, 0.016, 0.5, M.hedge, sx * 0.385, RT, -0.16);
    for (const z of [-0.36, -0.2, -0.04, 0.08]) treeAt(st, PROPS.treeSmall, sx * 0.385, z, RT + 0.016, 0.28, z * 7);
  }

  // Giriş: camlı kapı cephesi (alttaki taş kuşağın üstünden başlar), altın çerçeve, döner kapılar (cam, altın halkaların arasında)
  box(st, 0.34, 0.108, 0.004, windowMat, 0, 0.042, PZ1 + 0.002);
  for (const x of [-0.17, -0.12, 0.12, 0.17]) box(st, 0.012, 0.13, 0.01, M.gold, x, 0.03, PZ1 + 0.004);
  box(st, 0.36, 0.012, 0.01, M.gold, 0, 0.15, PZ1 + 0.004);
  for (const x of [-0.065, 0, 0.065]) {
    cyl(st, 0.026, 0.026, 0.076, PYRAMID, x, 0.044, PZ1 + 0.034, 14);
    cyl(st, 0.028, 0.028, 0.014, M.gold, x, 0.03, PZ1 + 0.034, 14); // alt halka halıdan belirgin yüksek
    cyl(st, 0.028, 0.028, 0.008, M.gold, x, 0.12, PZ1 + 0.034, 14);
    rod(st, [x - 0.024, 0.05, PZ1 + 0.034], [x + 0.024, 0.05, PZ1 + 0.034], 0.0015, M.gold, 3);
  }
  // Giriş saçağı: altın sütunlar, beyaz tavan, altında ışık paneli ve ampul dizisi, önünde neon tabela
  const CZ0 = PZ1, CZ1 = 0.29, CY = 0.165, CW = 0.52;
  box(st, CW, 0.02, CZ1 - CZ0, M.white, 0, CY, (CZ0 + CZ1) / 2);
  box(st, CW - 0.04, 0.002, CZ1 - CZ0 - 0.04, BULB, 0, CY - 0.002, (CZ0 + CZ1) / 2);
  box(st, CW + 0.01, 0.04, 0.012, M.gold, 0, CY - 0.01, CZ1);
  for (const sd of [-1, 1]) box(st, 0.012, 0.03, CZ1 - CZ0, M.gold, sd * (CW / 2), CY - 0.005, (CZ0 + CZ1) / 2);
  box(st, 0.44, 0.032, 0.004, neonSign('AKSOY CASINO', '#ffc94a', 0.44 / 0.032), 0, CY - 0.006, CZ1 + 0.01);
  for (let k = 0; k <= 16; k++) add(st, BULB_GEO, BULB, -CW / 2 + 0.01 + (k * (CW - 0.02)) / 16, CY - 0.014, CZ1 - 0.008);
  for (const sd of [-1, 1]) for (let k = 0; k <= 5; k++) add(st, BULB_GEO, BULB, sd * (CW / 2 - 0.012), CY - 0.014, CZ0 + 0.02 + (k * (CZ1 - CZ0 - 0.03)) / 5);
  for (const sd of [-1, 1]) {
    cyl(st, 0.018, 0.02, 0.012, M.stone, sd * 0.23, 0.03, CZ1 - 0.015, 12);
    cyl(st, 0.012, 0.013, CY - 0.042, M.gold, sd * 0.23, 0.042, CZ1 - 0.015, 12);
  }
  // Kırmızı halı (iki yanında altın şerit, halının dışında), altın dikmeler ve kırmızı kadife halatlar
  box(st, 0.12, 0.006, 0.36, CARPET, 0, 0.03, 0.3);
  for (const sd of [-1, 1]) box(st, 0.004, 0.006, 0.36, M.gold, sd * 0.062, 0.03, 0.3);
  for (const sd of [-1, 1]) {
    const x = sd * 0.078;
    for (let k = 0; k < 5; k++) {
      const z = 0.3 + k * 0.042;
      cyl(st, 0.0035, 0.005, 0.036, M.gold, x, 0.03, z, 6);
      add(st, new THREE.SphereGeometry(0.0055, 6, 4), M.gold, x, 0.068, z);
      if (k < 4) rod(st, [x, 0.06, z], [x, 0.056, z + 0.042], 0.002, CARPET, 4);
    }
  }
  // Kapıcılar ve misafirler
  for (const sd of [-1, 1]) person(st, sd * 0.11, 0.16, 0, ps, 2 + sd, 0, 0.03, true);
  person(st, 0.02, 0.36, Math.PI, ps, 5, 0, 0.036);
  person(st, -0.025, 0.4, Math.PI - 0.1, ps, 6, 0, 0.036);
  person(st, 0.03, 0.235, Math.PI + 0.2, ps, 8, 0, 0.036);
  // Fıskiyeli havuzlar (halının iki yanında): granit kenar, kenardan aşağıda su, sıra sıra fıskiyeler, kenar ışıkları
  for (const sd of [-1, 1]) {
    const x = sd * 0.235, z = 0.39, wy = 0.046;
    basin(st, 0.25, 0.16, 0.022, 0.012, M.granite, WATER, x, 0.03, z);
    for (let k = 0; k < 5; k++) {
      const jx = x - 0.08 + k * 0.04;
      add(st, new THREE.ConeGeometry(0.006, 0.07 + (k % 2) * 0.03, 6), SPRAY, jx, wy + 0.035 + (k % 2) * 0.015, z);
      add(st, new THREE.SphereGeometry(0.006, 6, 4), SPRAY, jx, wy + 0.07 + (k % 2) * 0.03, z);
    }
    for (const dx of [-0.11, 0.11]) for (const dz of [-0.066, 0.066]) add(st, BULB_GEO, BULB, x + dx, 0.054, z + dz);
  }
  // Köşelerde altın kenarlı saksılarda palmiyeler (altın kenar çerçeve, toprak içinde)
  for (const sd of [-1, 1]) {
    const x = sd * 0.42, z = 0.42;
    box(st, 0.07, 0.04, 0.07, M.stone, x, 0.03, z);
    frame(st, 0.074, 0.074, 0.006, 0.007, M.gold, x, 0.07, z);
    box(st, 0.06, 0.004, 0.06, M.soil, x, 0.07, z);
    const p = palm(x, z, 0.32, sd * 0.1);
    p.position.y = 0.074;
    st.add(p);
  }
  // Köşede dikey "CASINO" tabelası: altın çerçeve, ampul kenarlar
  const bx = -0.415, bz = PZ1 + 0.015, b0 = 0.06, bh = 0.32;
  box(st, 0.07, bh + 0.02, 0.03, M.gold, bx, b0 - 0.01, bz);
  box(st, 0.06, bh, 0.002, neonSign('CASINO', '#ff3fa4', 0.06 / bh), bx, b0, bz + 0.0205);
  for (const sd of [-1, 1]) for (let k = 0; k <= 10; k++) add(st, BULB_GEO, BULB, bx + sd * 0.038, b0 + (k * bh) / 10, bz + 0.018);
  add(st, new THREE.ConeGeometry(0.03, 0.04, 4).rotateY(Math.PI / 4), M.gold, bx, b0 + bh + 0.03, bz);
  add(st, new THREE.SphereGeometry(0.01, 8, 6), BULB, bx, b0 + bh + 0.055, bz);
  return mergeStatic([st]);
}
