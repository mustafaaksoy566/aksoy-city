import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, skiDist, SKI_RUNS, SKI_ROAD, LODGE as LODGE_AT } from './terrain';
import { mergeStatic } from './batcher';
import { pm, BULB, SPRAY, type V3, UP } from './parts';
import { signMat } from './signs';
import { carModel, type CarKind } from './cars';

// Aksoy Dağı Kayak Merkezi (gökdelenler gibi ayrıntılı çizilir):
// - Dağ evi oteli: taş zemin kat, balkonlu ahşap katlar, karlı dik çatı, çatı pencereleri ve bacalar, gece yanan camlar,
//   şemsiyeli güneş terası, ışıklı "AKSOY DAĞI" tabelası, kayak askıları, kar motorları, ratrak, otopark, lambalar, karlı çamlar.
// - Telesiyej: alt ve üst istasyon (döner tekerleği örten kaporta, raylar, yükleme bandı, sıra bariyerleri, kulübe),
//   boru ve kafes direkler (kollar, makara dizileri, merdiven), sarkan çelik halat, emniyet barlı ve ayaklıklı dörtlü koltuklar.
//   Koltuklar istasyonda halattan ayrılıp yavaşlar, tekerleğin çevresinden döner; yukarı çıkanlarda kayakçılar oturur.
// - Pistler: renkli pist direkleri, virajlarda turuncu güvenlik ağları, kar makineleri, yön tabelaları.
// - Kayakçılar ve snowboardcular pistlerden zikzak çizerek iner; dağ evinin çevresinde kayağını omzunda taşıyanlar yürür.
// Duran her şey birkaç büyük parçada birleşir; koltuklar ve insanlar çoklu çizimle (her tür tek çizim) hareket eder.

const BOTTOM = new THREE.Vector2(-45.5, -11.6); // telesiyejin alt istasyonu (döner tekerleğin ortası)
const TOP = new THREE.Vector2(-58.6, -7.6); // üst istasyon (zirveye yakın)
// Dağ evi arazinin düzleştirildiği alanın içinde; istasyona yer kalsın diye biraz kuzeydoğuya kayık
const LODGE = new THREE.Vector2(LODGE_AT.x + 0.5, LODGE_AT.z - 1.0);
const LODGE_ROT = Math.atan2(1, 0.15); // ön yüzü (+z) doğuya, yola bakar
const CABLE_SIDE = 0.22; // halatların hattın ortasından uzaklığı (döner tekerleğin yarıçapı)
const ROPE_H = 0.3; // istasyonda halatın platformdan yüksekliği
const HANG = 0.255; // oturağın halatın altında kaldığı mesafe
const STN = 0.9; // koltukların istasyonda raylarda gittiği yol (yavaşlar, döner, hızlanır)
const CLEAR = 0.42; // halatla zemin arasında en az boşluk (sarkan koltuk ve kayaklar için)
const CHAIRS = 44;
const SKIERS = 16;
const BOARDERS = 5;
const V_LINE = 0.45; // halatta hız
const V_SLOW = 0.13; // istasyonda hız
const SEATS = [-0.075, -0.025, 0.025, 0.075]; // dörtlü koltukta oturma yerleri
const JACKETS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#ff7043', '#00acc1', '#f06292', '#fafafa', '#263238', '#ff9800', '#3949ab'];
const RUN_COLORS = ['#1e66c9', '#d32f2f', '#1d1d1d']; // mavi, kırmızı, siyah pist

const ground = (x: number, z: number) => heightAt(x, z);
const lerp = THREE.MathUtils.lerp;
const smooth = THREE.MathUtils.smoothstep;

// Telesiyej hattı: alttan üste yön, yan (yukarı çıkan halat +yan tarafta) ve hattın açısı
const DIR = TOP.clone().sub(BOTTOM);
const LINE_LEN = DIR.length();
DIR.normalize();
const SIDE = new THREE.Vector2(-DIR.y, DIR.x);
const HEADING = Math.atan2(DIR.x, DIR.y);

// ---------------- Yardımcılar ----------------
type G = THREE.Object3D;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const arr = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];

function mesh(g: G, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  g.add(o);
  return o;
}
// Kutu ve silindir: y alt kenar
const box = (g: G, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) =>
  mesh(g, new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z);
const cyl = (g: G, rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 10) =>
  mesh(g, new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y + h / 2, z);
// Dokulu kutu: doku koordinatları gerçek ölçüye göre (taşlar ve tahtalar her yerde aynı büyüklükte)
function sizedBox(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const span: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x, -x, +y, -y, +z, -z
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * span[f][0], uv.getY(i) * span[f][1]);
    }
  }
  return g;
}
const tbox = (g: G, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => mesh(g, sizedBox(w, h, d), m, x, y + h / 2, z);
// İki nokta arasında çubuk (uçları açık, az üçgen)
function bar(g: G, a: V3, b: V3, r: number, m: THREE.Material, seg = 5) {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const o = mesh(g, new THREE.CylinderGeometry(r, r, d.length(), seg, 1, true), m, A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
  return o;
}
// İki nokta arasında kutu (kalaslar, kirişler)
function beam(g: G, a: V3, b: V3, w: number, h: number, m: THREE.Material) {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const o = mesh(g, new THREE.BoxGeometry(w, h, d.length()), m, A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
  o.quaternion.setFromUnitVectors(Z_AXIS, d.normalize());
  return o;
}
// Konumlu ve döndürülmüş alt grup
function grp(g: G, x: number, y: number, z: number, ry = 0) {
  const o = new THREE.Group();
  o.position.set(x, y, z);
  o.rotation.y = ry;
  g.add(o);
  return o;
}
// x ekseni boyunca yatan silindir
function xcyl(g: G, r: number, len: number, m: THREE.Material, x: number, y: number, z: number, seg = 8) {
  const o = mesh(g, new THREE.CylinderGeometry(r, r, len, seg), m, x, y, z);
  o.rotation.z = Math.PI / 2;
  return o;
}
// Tekrarlanabilir rastgele sayılar (her açılışta aynı görünsün)
function rand(seed: number) {
  let v = ((seed * 7919) % 2147483646) + 1;
  return () => (v = (v * 16807) % 2147483647) / 2147483647;
}
// Dünya koordinatından yerel koordinata (bir grubun içinde)
function local(cx: number, cz: number, ry: number, x: number, z: number) {
  const dx = x - cx, dz = z - cz;
  return { x: dx * Math.cos(ry) - dz * Math.sin(ry), z: dx * Math.sin(ry) + dz * Math.cos(ry) };
}
// Yerelden dünyaya
function world(cx: number, cz: number, ry: number, x: number, z: number) {
  return new THREE.Vector2(cx + x * Math.cos(ry) + z * Math.sin(ry), cz - x * Math.sin(ry) + z * Math.cos(ry));
}
// Dikdörtgen bir alanın altındaki en alçak ve en yüksek zemin
function footprint(cx: number, cz: number, ry: number, x0: number, x1: number, z0: number, z1: number) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 6; j++) {
      const p = world(cx, cz, ry, lerp(x0, x1, i / 6), lerp(z0, z1, j / 6));
      const y = ground(p.x, p.y);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  }
  return { lo, hi };
}

// ---------------- Dokular ve malzemeler ----------------
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function rrect(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
  x.fill();
}
const rgb = (r: number, g: number, b: number) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
// Taş duvar: sıra sıra yassı, yuvarlak köşeli taşlar (yanlardan ve alttan tekrarlanır)
function stoneCanvas() {
  const c = canvas(128, 128), x = c.getContext('2d')!;
  const r = rand(11);
  x.fillStyle = '#6a645b';
  x.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 8; row++) {
    let px = -r() * 24;
    while (px < 128) {
      const w = 15 + r() * 18, t = 0.78 + r() * 0.32, warm = (r() - 0.5) * 18, jy = (r() - 0.5) * 1.6;
      for (const off of [-128, 0, 128]) {
        x.fillStyle = rgb(176 * t + warm, 168 * t, 154 * t - warm);
        rrect(x, px + off + 1.3, row * 16 + 1.3 + jy, w - 2.6, 13.2, 5);
        x.fillStyle = 'rgba(255,255,255,0.13)';
        rrect(x, px + off + 3, row * 16 + 2.4 + jy, w - 7, 4, 2);
      }
      px += w;
    }
  }
  return c;
}
// Ahşap: yatay tahtalar, damarlar ve aralarda koyu derz
function woodCanvas() {
  const c = canvas(128, 128), x = c.getContext('2d')!;
  const r = rand(5);
  for (let k = 0; k < 8; k++) {
    const t = 0.86 + r() * 0.24;
    x.fillStyle = rgb(150 * t, 93 * t, 54 * t);
    x.fillRect(0, k * 16, 128, 16);
    x.strokeStyle = 'rgba(70,38,18,0.28)';
    x.lineWidth = 1;
    for (let j = 0; j < 3; j++) {
      const y = k * 16 + 3 + r() * 9;
      x.beginPath();
      x.moveTo(0, y);
      x.bezierCurveTo(40, y + (r() - 0.5) * 5, 88, y + (r() - 0.5) * 5, 128, y);
      x.stroke();
    }
    x.fillStyle = 'rgba(255,230,190,0.12)';
    x.fillRect(0, k * 16, 128, 2);
    x.fillStyle = '#3a2213';
    x.fillRect(0, k * 16 + 14.4, 128, 1.6);
  }
  return c;
}
function texture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
// Tekrarlanan doku: tile = dokunun dünyadaki boyu
function tiled(name: string, c: HTMLCanvasElement, tile: number, rough: number) {
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tile, 1 / tile);
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: rough });
  m.name = name;
  return m;
}
// Gece harfleri yanan tabela (DayNight 'window' adlı malzemeleri yakar)
function litSign(text: string, bg: string, fg: string) {
  const day = canvas(256, 64), glow = canvas(256, 64);
  for (const [c, back, front] of [[day, bg, fg], [glow, '#000000', '#ffffff']] as [HTMLCanvasElement, string, string][]) {
    const x = c.getContext('2d')!;
    x.fillStyle = back;
    x.fillRect(0, 0, 256, 64);
    if (c === day) {
      x.strokeStyle = fg;
      x.lineWidth = 3;
      x.strokeRect(5, 5, 246, 54);
    }
    x.fillStyle = front;
    x.font = 'bold 36px Fredoka, Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, 128, 35);
  }
  const m = new THREE.MeshStandardMaterial({ map: texture(day), emissiveMap: texture(glow), emissive: '#000000', roughness: 0.6 });
  m.name = 'window';
  return m;
}
// Pist haritası panosu: karlı dağ, telesiyej hattı ve üç renkli pist
function trailMap() {
  const c = canvas(256, 128), x = c.getContext('2d')!;
  const sky = x.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0, '#5aa0e6');
  sky.addColorStop(1, '#cfe6f7');
  x.fillStyle = sky;
  x.fillRect(0, 0, 256, 128);
  x.fillStyle = '#f7f9fb';
  x.beginPath();
  x.moveTo(0, 128);
  x.lineTo(40, 70);
  x.lineTo(70, 82);
  x.lineTo(128, 22);
  x.lineTo(180, 74);
  x.lineTo(214, 60);
  x.lineTo(256, 96);
  x.lineTo(256, 128);
  x.fill();
  x.fillStyle = '#3f7f46';
  for (let k = 0; k < 18; k++) {
    const px = 8 + k * 14, py = 112 + (k % 3) * 4;
    x.beginPath();
    x.moveTo(px, py - 12);
    x.lineTo(px - 5, py);
    x.lineTo(px + 5, py);
    x.fill();
  }
  x.lineWidth = 4;
  x.lineCap = 'round';
  const runs: [string, number[]][] = [['#1e66c9', [122, 30, 96, 60, 112, 82, 84, 112]], ['#d32f2f', [130, 30, 160, 58, 140, 80, 166, 110]], ['#1d1d1d', [126, 28, 120, 64, 128, 90, 118, 114]]];
  for (const [col, p] of runs) {
    x.strokeStyle = col;
    x.beginPath();
    x.moveTo(p[0], p[1]);
    for (let k = 2; k < p.length; k += 2) x.lineTo(p[k], p[k + 1]);
    x.stroke();
  }
  x.strokeStyle = '#37474f';
  x.lineWidth = 2;
  x.setLineDash([5, 3]);
  x.beginPath();
  x.moveTo(126, 26);
  x.lineTo(196, 112);
  x.stroke();
  x.setLineDash([]);
  x.fillStyle = 'rgba(255,255,255,0.85)';
  x.fillRect(0, 0, 256, 22);
  x.fillStyle = '#c62828';
  x.font = 'bold 18px Fredoka, Arial, sans-serif';
  x.textAlign = 'center';
  x.fillText('AKSOY DAĞI · PİSTLER', 128, 17);
  return new THREE.MeshStandardMaterial({ map: texture(c), roughness: 0.7 });
}
// Türk bayrağı
function flagMat() {
  const c = canvas(96, 64), x = c.getContext('2d')!;
  x.fillStyle = '#e30a17';
  x.fillRect(0, 0, 96, 64);
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.arc(32, 32, 16, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#e30a17';
  x.beginPath();
  x.arc(36, 32, 12.8, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#ffffff';
  x.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = Math.PI + (k * Math.PI) / 5;
    const rr = k % 2 ? 3.2 : 8;
    x.lineTo(53 + Math.cos(a) * rr, 32 + Math.sin(a) * rr);
  }
  x.fill();
  return new THREE.MeshStandardMaterial({ map: texture(c), roughness: 0.8, side: THREE.DoubleSide });
}

function makeMats() {
  const glass = new THREE.MeshStandardMaterial({ color: '#5a7891', roughness: 0.18, metalness: 0.4 });
  glass.name = 'window'; // gece yanar
  return {
    stone: tiled('ski-stone', stoneCanvas(), 0.26, 0.95),
    wood: tiled('ski-wood', woodCanvas(), 0.2, 0.85),
    glass,
    beam: pm('#4a2f1e', 0.85),
    timber: pm('#80522f', 0.8),
    deck: pm('#b07d4f', 0.85),
    trim: pm('#f0e6d2', 0.75),
    roof: pm('#3b2a20', 0.9),
    snow: pm('#f5f8fb', 0.8),
    pack: pm('#e3eaf0', 0.9),
    shutter: pm('#3d6e45', 0.7),
    leaf: pm('#3f7a34', 0.95),
    red: pm('#c62828', 0.45, 0.1),
    white: pm('#eef1f3', 0.5),
    concrete: pm('#b4b0a8', 0.95),
    steel: pm('#8d99a5', 0.4, 0.6),
    dark: pm('#30363e', 0.5, 0.5),
    rubber: pm('#1c1e21', 0.9),
    yellow: pm('#f9c21b', 0.55),
    orange: pm('#ff6d00', 0.7),
    blue: pm('#1f5fa8', 0.6),
    asphalt: pm('#3d4550', 0.95),
    line: pm('#f4f4f4', 0.8),
    logs: pm('#8b5a2b', 0.9),
    flag: flagMat(),
    map: trailMap(),
    sign: litSign('AKSOY DAĞI', '#4a2f1e', '#ffe9b8'),
  };
}
let K: ReturnType<typeof makeMats>;

// ---------------- İnsanlar ----------------
// Duruşlar: eklem yerleri (yüzü +z; snowboardcu +x'e bakar). 'chair' oturağın üstü y=0'da, ayaklar ayaklıkta
type Pose = 'stand' | 'sit' | 'tuck' | 'board' | 'chair' | 'walk';
interface Joints { hip: V3; knee: [V3, V3]; foot: [V3, V3]; neck: V3; hand: [V3, V3]; fwd: [number, number] }
const POSES: Record<Pose, Joints> = {
  stand: { hip: [0, 0.068, 0], knee: [[-0.009, 0.037, 0.007], [0.009, 0.037, 0.007]], foot: [[-0.011, 0.007, 0], [0.011, 0.007, 0]], neck: [0, 0.11, 0.004], hand: [[-0.027, 0.064, 0.022], [0.027, 0.064, 0.022]], fwd: [0, 1] },
  sit: { hip: [0, 0.05, -0.006], knee: [[-0.009, 0.051, 0.034], [0.009, 0.051, 0.034]], foot: [[-0.01, 0.007, 0.04], [0.01, 0.007, 0.04]], neck: [0, 0.094, -0.008], hand: [[-0.017, 0.064, 0.046], [0.017, 0.064, 0.046]], fwd: [0, 1] },
  tuck: { hip: [0, 0.06, -0.014], knee: [[-0.012, 0.041, 0.018], [0.012, 0.041, 0.018]], foot: [[-0.012, 0.007, -0.002], [0.012, 0.007, -0.002]], neck: [0, 0.097, 0.02], hand: [[-0.024, 0.068, 0.05], [0.024, 0.068, 0.05]], fwd: [0, 1] },
  board: { hip: [-0.006, 0.056, 0], knee: [[0.012, 0.034, -0.03], [0.012, 0.034, 0.03]], foot: [[0, 0.009, -0.036], [0, 0.009, 0.036]], neck: [0.004, 0.097, 0.004], hand: [[0.006, 0.07, -0.06], [0.004, 0.088, 0.062]], fwd: [1, 0] },
  chair: { hip: [0, 0.012, -0.014], knee: [[-0.01, 0.015, 0.03], [0.01, 0.015, 0.03]], foot: [[-0.011, -0.036, 0.04], [0.011, -0.036, 0.04]], neck: [0, 0.056, -0.022], hand: [[-0.022, 0.042, 0.052], [0.022, 0.042, 0.052]], fwd: [0, 1] },
  walk: { hip: [0, 0.069, 0], knee: [[-0.008, 0.037, 0.014], [0.008, 0.038, -0.006]], foot: [[-0.009, 0.007, 0.018], [0.009, 0.007, -0.016]], neck: [0, 0.111, 0.002], hand: [[-0.024, 0.062, 0.004], [0.019, 0.118, 0.012]], fwd: [0, 1] },
};
interface Look { jacket: THREE.Material; pants: THREE.Material; helmet: THREE.Material; skin: THREE.Material; ski: THREE.Material; glove: THREE.Material; lens: THREE.Material; boot: THREE.Material; pole: THREE.Material }
const GEO = {
  pelvis: new THREE.SphereGeometry(0.011, 6, 4),
  chest: new THREE.SphereGeometry(0.0145, 7, 4),
  head: new THREE.SphereGeometry(0.0105, 8, 5),
  helmet: new THREE.SphereGeometry(0.0122, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.55),
  goggle: new THREE.BoxGeometry(0.019, 0.0065, 0.006),
  hand: new THREE.SphereGeometry(0.0052, 4, 3),
  knee: new THREE.SphereGeometry(0.0062, 4, 3),
  boot: new THREE.BoxGeometry(0.013, 0.014, 0.022),
  ski: new THREE.BoxGeometry(0.011, 0.003, 0.13),
  tip: new THREE.BoxGeometry(0.011, 0.003, 0.02),
};
// Kayak: bot altında, ucu kalkık
function skiAt(g: G, x: number, y: number, z: number, yaw: number, m: THREE.Material) {
  const s = grp(g, x, y, z, yaw);
  mesh(s, GEO.ski, m, 0, 0, 0.012);
  mesh(s, GEO.tip, m, 0, 0.004, 0.084).rotation.x = -0.55;
}
function pole(g: G, a: V3, b: V3, m: THREE.Material) {
  bar(g, a, b, 0.0013, m, 4);
  const d = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
  mesh(g, new THREE.CylinderGeometry(0.0045, 0.0045, 0.0015, 5, 1, true), m, b[0] - d.x * 0.08, b[1] - d.y * 0.08, b[2] - d.z * 0.08);
}
// Bir insan (mont, pantolon, kask ve gözlük, eldiven, botlar) ve duruşa göre kayak, baton ya da snowboard
function figure(pose: Pose, L: Look, hat = true, gear = true) {
  const g = new THREE.Group();
  const J = POSES[pose];
  const side = v3(J.fwd[1], 0, J.fwd[0]);
  const yaw = Math.atan2(J.fwd[0], J.fwd[1]);
  const hip = v3(...J.hip), neck = v3(...J.neck);
  const up = neck.clone().sub(hip).normalize();
  for (const k of [0, 1]) {
    const s = k ? 1 : -1;
    const hp = hip.clone().addScaledVector(side, s * 0.0075);
    const kn = v3(...J.knee[k]), ft = v3(...J.foot[k]);
    bar(g, arr(hp), arr(kn), 0.0068, L.pants, 5);
    bar(g, arr(kn), arr(ft), 0.0057, L.pants, 5);
    mesh(g, GEO.knee, L.pants, kn.x, kn.y, kn.z);
    mesh(g, GEO.boot, L.boot, ft.x + J.fwd[0] * 0.003, ft.y - 0.0005, ft.z + J.fwd[1] * 0.003).rotation.y = yaw;
    const sh = neck.clone().addScaledVector(side, s * 0.0165).addScaledVector(up, -0.004);
    const hd = v3(...J.hand[k]);
    const el = sh.clone().lerp(hd, 0.5).add(v3(0, -0.006, 0)).addScaledVector(side, s * 0.004);
    bar(g, arr(sh), arr(el), 0.0052, L.jacket, 5);
    bar(g, arr(el), arr(hd), 0.0046, L.jacket, 5);
    mesh(g, GEO.hand, L.glove, hd.x, hd.y, hd.z);
  }
  mesh(g, GEO.pelvis, L.pants, hip.x, hip.y, hip.z);
  bar(g, arr(hip), arr(neck), 0.0135, L.jacket, 8);
  mesh(g, GEO.chest, L.jacket, neck.x - up.x * 0.006, neck.y - up.y * 0.006, neck.z - up.z * 0.006).scale.set(1, 0.85, 0.8);
  const head = neck.clone().add(v3(J.fwd[0] * 0.003, 0.017, J.fwd[1] * 0.003));
  mesh(g, GEO.head, L.skin, head.x, head.y, head.z);
  if (hat) mesh(g, GEO.helmet, L.helmet, head.x, head.y + 0.002, head.z);
  if (pose !== 'sit' && gear) mesh(g, GEO.goggle, L.lens, head.x + J.fwd[0] * 0.0092, head.y + 0.003, head.z + J.fwd[1] * 0.0092).rotation.y = yaw;
  // Donanım
  const [h0, h1] = J.hand;
  if (!gear) return g;
  if (pose === 'stand' || pose === 'tuck' || pose === 'chair') {
    for (const f of J.foot) skiAt(g, f[0], f[1] - 0.0085, f[2], yaw, L.ski);
  }
  if (pose === 'stand') {
    pole(g, h0, [h0[0] * 1.25, 0, h0[2] + 0.012], L.pole);
    pole(g, h1, [h1[0] * 1.25, 0, h1[2] + 0.012], L.pole);
  } else if (pose === 'tuck') {
    pole(g, h0, [h0[0] * 1.45, 0.004, -0.06], L.pole);
    pole(g, h1, [h1[0] * 1.45, 0.004, -0.06], L.pole);
  } else if (pose === 'chair') {
    pole(g, [h1[0] + 0.004, h1[1] + 0.04, h1[2]], [h1[0] + 0.01, -0.09, h1[2] + 0.012], L.pole);
  } else if (pose === 'board') {
    const b = grp(g, 0, 0.0045, 0);
    mesh(b, new THREE.BoxGeometry(0.036, 0.004, 0.13), L.ski, 0, 0, 0);
    for (const s of [-1, 1]) mesh(b, new THREE.BoxGeometry(0.036, 0.004, 0.022), L.ski, 0, 0.004, s * 0.073).rotation.x = s * -0.45;
  } else if (pose === 'walk') {
    // Kayaklar sağ omuzda, batonlar sol elde
    for (const dx of [0.0, 0.011]) beam(g, [0.019 + dx, 0.092, -0.07], [0.019 + dx, 0.138, 0.075], 0.01, 0.003, L.ski);
    pole(g, [h0[0], h0[1] + 0.03, h0[2]], [h0[0] - 0.006, 0, h0[2] + 0.03], L.pole);
  }
  return g;
}
// Duran insanlar için renkli görünüş
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#ffdbac'];
function look(k: number): Look {
  return {
    jacket: pm(JACKETS[k % JACKETS.length], 0.7),
    pants: pm(['#263238', '#37474f', '#1a237e', '#4e342e', '#212121'][k % 5], 0.8),
    helmet: pm(['#fafafa', '#212121', JACKETS[(k + 3) % JACKETS.length], '#c62828'][k % 4], 0.4),
    skin: pm(SKINS[k % SKINS.length], 0.8),
    ski: pm(JACKETS[(k * 5 + 2) % JACKETS.length], 0.4),
    glove: pm('#212121', 0.8),
    lens: pm('#ffb300', 0.2, 0.6),
    boot: pm('#37474f', 0.6),
    pole: pm('#b0bec5', 0.3, 0.7),
  };
}
// Çoklu çizim için görünüş: mont, kask ve kayak her insanın kendi rengiyle boyanır ('tint' payı kadar)
function tintLook(): Look {
  const t = (c: string, tint: number, rough = 0.7) => {
    const m = pm(c, rough);
    m.userData.tint = tint;
    return m;
  };
  return {
    jacket: t('#ffffff', 1),
    pants: t('#263238', 0, 0.8),
    helmet: t('#ffffff', 0.45, 0.4),
    skin: t('#f1c27d', 0),
    ski: t('#ffffff', 0.8, 0.4),
    glove: t('#212121', 0),
    lens: t('#ffb300', 0, 0.3),
    boot: t('#37474f', 0),
    pole: t('#b0bec5', 0, 0.3),
  };
}

// Parçaları tek geometriye çevir: renkler köşelere, mont rengi payı 'tint' bilgisine yazılır
function bake(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true);
  const list: THREE.BufferGeometry[] = [];
  obj.traverse(node => {
    const m = node as THREE.Mesh;
    if (!m.isMesh) return;
    const mt = m.material as THREE.MeshStandardMaterial;
    const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) mt.color.toArray(col, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n).fill(mt.userData.tint ?? 0), 1));
    list.push(geo);
  });
  const out = mergeGeometries(list, false)!;
  list.forEach(g => g.dispose());
  return out;
}
// Köşe renkli malzeme; her kopyanın rengi yalnızca 'tint' payı kadar uygulanır (mont renkli, yüz ve pantolon değil)
function tintMat() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <color_pars_vertex>', '#include <color_pars_vertex>\nattribute float tint;')
      .replace(
        '#include <color_vertex>',
        `vColor = vec4(1.0);
        #ifdef USE_COLOR
          vColor.rgb *= color;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, tint);
        #endif`,
      );
  };
  m.customProgramCacheKey = () => 'ski-tint';
  return m;
}
function crowd(geo: THREE.BufferGeometry, n: number, m: THREE.Material) {
  const im = new THREE.InstancedMesh(geo, m, n);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.frustumCulled = false;
  im.castShadow = true;
  im.receiveShadow = true;
  return im;
}

// ---------------- Dağ evi oteli ----------------
const LW = 2.0, LD = 1.0; // boyu (x) ve derinliği (z); ön yüz +z
const F0 = 0.28; // taş zemin katın üstü
const FH = 0.22; // ahşap katların yüksekliği
const EAVE = F0 + 2 * FH; // saçak hizası
const PITCH = 0.9; // çatı eğimi
const PW = 0.36; // öne çıkan orta bölümün yarı genişliği
const PD = 0.28; // orta bölümün öne çıkması

// Üçgen alın (çatı arası): mahya x boyunca
function prism(width: number, height: number, length: number, m: THREE.Material) {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(0, height);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: length, bevelEnabled: false });
  geo.translate(0, 0, -length / 2);
  geo.rotateY(Math.PI / 2);
  return new THREE.Mesh(geo, m);
}
// Karlı beşik çatı (mahya x boyunca, z=0'da). half: duvardan mahyaya, over: saçak taşması, gable: alın taşması
function gableRoof(g: G, len: number, half: number, over: number, eave: number, pitch: number, gable = 0.12) {
  const a = Math.atan(pitch);
  const run = half + over;
  const top = eave + half * pitch, low = eave - over * pitch;
  const sl = run / Math.cos(a);
  const L = len + 2 * gable;
  for (const s of [-1, 1]) {
    const n = v3(0, Math.cos(a), s * Math.sin(a));
    const mz = (s * run) / 2, my = (top + low) / 2;
    const slab = mesh(g, new THREE.BoxGeometry(L, 0.03, sl), K.roof, 0, my - n.y * 0.015, mz - n.z * 0.015);
    slab.rotation.x = s * a;
    const snow = mesh(g, new THREE.BoxGeometry(L - 0.02, 0.034, sl - 0.01), K.snow, 0, my + n.y * 0.017, mz + n.z * 0.017);
    snow.rotation.x = s * a;
    // Saçak ucunda yuvarlak kar yığını ve saçak tahtası
    xcyl(g, 0.019, L - 0.03, K.snow, 0, low + 0.018, s * (run - 0.01), 8);
    box(g, L, 0.045, 0.014, K.timber, 0, low - 0.05, s * (run + 0.002));
    // Alın tahtaları (yan kenarlar)
    for (const e of [-1, 1]) {
      const b = mesh(g, new THREE.BoxGeometry(0.016, 0.055, sl), K.timber, e * (L / 2 + 0.003), my - n.y * 0.03, mz - n.z * 0.03);
      b.rotation.x = s * a;
    }
    // Aşıklar (çatının altında, alın tarafında uçları görünür)
    const pz = s * half * 0.55;
    box(g, L - 0.05, 0.026, 0.026, K.beam, 0, top - Math.abs(pz) * pitch - 0.03 / Math.cos(a) - 0.03, pz);
  }
  box(g, L - 0.05, 0.026, 0.026, K.beam, 0, top - 0.03 / Math.cos(a) - 0.03, 0);
  xcyl(g, 0.027, L - 0.02, K.snow, 0, top + 0.012, 0, 8);
}
// Pencere (duvar yüzeyi z=0, dışarısı +z): cam, çerçeve, orta kayıt, denizlik ve isteğe bağlı panjurlar
function windowAt(f: G, cx: number, cy: number, w: number, h: number, shutters = true, sill = true) {
  const b = 0.011;
  box(f, w, h, 0.006, K.glass, cx, cy - h / 2, 0.001);
  box(f, w + 2 * b, b, 0.014, K.trim, cx, cy + h / 2, 0.004);
  box(f, w + 2 * b, b, 0.014, K.trim, cx, cy - h / 2 - b, 0.004);
  for (const s of [-1, 1]) box(f, b, h, 0.014, K.trim, cx + s * (w / 2 + b / 2), cy - h / 2, 0.004);
  box(f, 0.005, h, 0.01, K.trim, cx, cy - h / 2, 0.003);
  if (w > 0.12) box(f, w, 0.004, 0.01, K.trim, cx, cy + h * 0.12, 0.003);
  if (sill) box(f, w + 0.035, 0.009, 0.026, K.beam, cx, cy - h / 2 - b - 0.009, 0.01);
  if (shutters) for (const s of [-1, 1]) box(f, w * 0.48, h + 2 * b, 0.006, K.shutter, cx + s * (w / 2 + b + w * 0.24 + 0.004), cy - h / 2 - b, 0.004);
}
// Balkon (duvar yüzeyi z=0, dışarısı +z): konsollar, döşeme, tahta korkuluk ve çiçeklik (sarkan sardunyalar)
function balcony(f: G, x0: number, x1: number, y0: number, depth: number, flowers: THREE.Material) {
  const len = x1 - x0, cx = (x0 + x1) / 2;
  box(f, len, 0.018, depth, K.timber, cx, y0 - 0.018, depth / 2);
  for (let x = x0 + 0.05; x < x1 - 0.02; x += 0.2) box(f, 0.016, 0.034, depth * 0.85, K.beam, x, y0 - 0.052, depth * 0.42);
  const zf = depth - 0.008;
  box(f, len, 0.012, 0.016, K.timber, cx, y0 + 0.056, zf);
  box(f, len, 0.01, 0.012, K.timber, cx, y0 + 0.006, zf);
  for (let x = x0 + 0.014; x <= x1 - 0.013; x += 0.024) box(f, 0.014, 0.05, 0.005, K.timber, x, y0 + 0.006, zf);
  for (const x of [x0 + 0.008, x1 - 0.008]) {
    box(f, 0.016, 0.012, depth, K.timber, x, y0 + 0.056, depth / 2);
    for (let z = 0.02; z < depth - 0.012; z += 0.024) box(f, 0.005, 0.05, 0.014, K.timber, x, y0 + 0.006, z);
  }
  // Çiçeklik: tırabzanın üstünde kutu, çiçekler ve önüne sarkan yeşillik
  box(f, len - 0.04, 0.016, 0.022, K.beam, cx, y0 + 0.068, zf);
  box(f, len - 0.05, 0.013, 0.02, flowers, cx, y0 + 0.084, zf);
  box(f, len - 0.06, 0.026, 0.006, K.leaf, cx, y0 + 0.046, zf + 0.012);
}
// Masa, sandalyeler ve şemsiye
function cafeTable(g: G, x: number, z: number, y: number, canopy: THREE.Material, seed: number, people: number) {
  const t = grp(g, x, y, z, seed * 0.7);
  cyl(t, 0.032, 0.032, 0.005, K.white, 0, 0.06, 0, 10);
  cyl(t, 0.004, 0.004, 0.06, K.dark, 0, 0, 0, 5);
  cyl(t, 0.014, 0.016, 0.004, K.dark, 0, 0, 0, 8);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const c = grp(t, Math.sin(a) * 0.055, 0, Math.cos(a) * 0.055, a + Math.PI);
    box(c, 0.026, 0.004, 0.024, K.timber, 0, 0.038, 0);
    box(c, 0.026, 0.034, 0.004, K.timber, 0, 0.042, -0.012);
    for (const sx of [-0.011, 0.011]) for (const sz of [-0.01, 0.01]) box(c, 0.003, 0.038, 0.003, K.dark, sx, 0, sz);
    if (k < people) {
      const p = figure('sit', look(seed * 3 + k), seed % 2 === 0);
      p.position.set(0, -0.004, 0.0);
      p.scale.setScalar(0.95);
      c.add(p);
    }
  }
  // Şemsiye: direk, sekiz dilimli kubbe ve saçaklık
  cyl(t, 0.0028, 0.0028, 0.16, K.white, 0, 0.046, 0, 5);
  mesh(t, new THREE.ConeGeometry(0.08, 0.032, 8), canopy, 0, 0.222, 0);
  mesh(t, new THREE.CylinderGeometry(0.08, 0.08, 0.012, 8, 1, true), canopy, 0, 0.2, 0);
  mesh(t, new THREE.SphereGeometry(0.005, 5, 4), K.white, 0, 0.241, 0);
}
// Sokak lambası (fener biçimli, gece yanar)
function lampPost(g: G, x: number, z: number, h = 0.2, y = 0) {
  const l = grp(g, x, y, z);
  cyl(l, 0.01, 0.012, 0.014, K.dark, 0, 0, 0, 8);
  cyl(l, 0.0045, 0.006, h, K.dark, 0, 0, 0, 6);
  box(l, 0.022, 0.026, 0.022, K.dark, 0, h, 0);
  mesh(l, new THREE.SphereGeometry(0.011, 8, 6), BULB, 0, h + 0.014, 0);
  mesh(l, new THREE.ConeGeometry(0.02, 0.016, 4), K.dark, 0, h + 0.034, 0).rotation.y = Math.PI / 4;
  return l;
}
// Kar motoru: önde iki kızak, gövde, cam siperlik, sele, arkada palet
function snowmobile(g: G, x: number, z: number, ry: number, color: THREE.Material) {
  const s = grp(g, x, 0, z, ry);
  for (const sx of [-0.038, 0.038]) {
    box(s, 0.012, 0.005, 0.1, K.dark, sx, 0, 0.06);
    mesh(s, new THREE.BoxGeometry(0.012, 0.005, 0.025), K.dark, sx, 0.008, 0.115).rotation.x = -0.6;
    bar(s, [sx, 0.004, 0.06], [sx * 0.6, 0.04, 0.05], 0.003, K.dark, 4);
  }
  box(s, 0.06, 0.03, 0.12, K.rubber, 0, 0.004, -0.045);
  const hood = box(s, 0.072, 0.04, 0.1, color, 0, 0.03, 0.045);
  hood.rotation.x = 0.12;
  box(s, 0.06, 0.035, 0.008, K.glass, 0, 0.065, 0.02).rotation.x = -0.5;
  box(s, 0.05, 0.022, 0.1, K.rubber, 0, 0.034, -0.05);
  box(s, 0.075, 0.025, 0.06, color, 0, 0.03, -0.08);
  bar(s, [-0.035, 0.07, 0.0], [0.035, 0.07, 0.0], 0.0025, K.dark, 4);
}
// Ratrak: paletler, kırmızı gövde, camlı kabin, önde bıçak, arkada freze, tepede ışık
function snowcat(g: G, x: number, z: number, ry: number) {
  const s = grp(g, x, 0, z, ry);
  for (const sx of [-0.12, 0.12]) {
    box(s, 0.085, 0.07, 0.34, K.rubber, sx, 0.004, 0);
    for (const ez of [-0.17, 0.17]) {
      const w = mesh(s, new THREE.CylinderGeometry(0.039, 0.039, 0.085, 10), K.rubber, sx, 0.039, ez);
      w.rotation.z = Math.PI / 2;
    }
    for (let k = 0; k < 4; k++) xcyl(s, 0.022, 0.087, K.dark, sx, 0.033, -0.12 + k * 0.08, 8);
  }
  box(s, 0.2, 0.06, 0.4, K.red, 0, 0.07, -0.01);
  box(s, 0.21, 0.012, 0.41, K.dark, 0, 0.068, -0.01);
  box(s, 0.19, 0.11, 0.17, K.red, 0, 0.13, 0.07);
  box(s, 0.195, 0.06, 0.175, K.glass, 0, 0.165, 0.07);
  box(s, 0.21, 0.014, 0.19, K.white, 0, 0.24, 0.07);
  box(s, 0.11, 0.012, 0.03, K.dark, 0, 0.254, 0.1);
  mesh(s, new THREE.SphereGeometry(0.011, 8, 6), BULB, -0.03, 0.27, 0.1);
  mesh(s, new THREE.SphereGeometry(0.011, 8, 6), BULB, 0.03, 0.27, 0.1);
  box(s, 0.17, 0.05, 0.06, K.red, 0, 0.13, -0.12);
  // Bıçak: öne eğik geniş kalkan ve kolları
  const blade = box(s, 0.42, 0.1, 0.018, K.dark, 0, 0.0, 0.27);
  blade.rotation.x = -0.2;
  box(s, 0.43, 0.012, 0.022, K.yellow, 0, 0.096, 0.25);
  for (const sx of [-0.08, 0.08]) beam(s, [sx, 0.09, 0.16], [sx, 0.05, 0.265], 0.022, 0.022, K.dark);
  // Freze ve tarak
  box(s, 0.36, 0.06, 0.07, K.dark, 0, 0.012, -0.27);
  box(s, 0.38, 0.008, 0.08, K.rubber, 0, 0.004, -0.34);
  beam(s, [0, 0.07, -0.19], [0, 0.05, -0.25], 0.06, 0.03, K.dark);
}
// Kayak askısı: iki direk, iki yatay boru ve yaslanmış renkli kayaklar, snowboardlar
function skiRack(g: G, x: number, z: number, ry: number, n: number, seed: number) {
  const r = grp(g, x, 0, z, ry);
  const len = n * 0.034 + 0.04;
  for (const sx of [-len / 2, len / 2]) cyl(r, 0.005, 0.005, 0.12, K.dark, sx, 0, 0, 6);
  xcyl(r, 0.0035, len, K.steel, 0, 0.1, 0, 5);
  xcyl(r, 0.0035, len, K.steel, 0, 0.035, 0.012, 5);
  const rnd = rand(seed);
  for (let k = 0; k < n; k++) {
    const x = -len / 2 + 0.03 + k * 0.034;
    if (rnd() < 0.12) continue;
    const m = pm(JACKETS[Math.floor(rnd() * JACKETS.length)], 0.4);
    if (rnd() < 0.2) {
      const b = box(r, 0.034, 0.14, 0.005, m, x, 0.005, -0.012);
      b.rotation.x = -0.12;
    } else {
      for (const dx of [-0.006, 0.006]) {
        const s = box(r, 0.01, 0.15, 0.004, m, x + dx, 0.004, -0.014);
        s.rotation.x = -0.14;
      }
    }
  }
}
// Bayrak direği
function flagPole(g: G, x: number, z: number, m: THREE.Material, h = 0.42) {
  cyl(g, 0.004, 0.006, h, K.white, x, 0, z, 6);
  mesh(g, new THREE.SphereGeometry(0.007, 6, 4), K.yellow, x, h + 0.004, z);
  mesh(g, new THREE.BoxGeometry(0.003, 0.08, 0.12), m, x, h - 0.05, z + 0.062);
}

function lodge() {
  const g = new THREE.Group();
  const fz = LD / 2; // ön duvar (taş)
  // --- Gövde: taş zemin kat, kat kirişleri, ahşap katlar, köşe dikmeleri ---
  tbox(g, LW, F0 + 0.08, LD, K.stone, 0, -0.08, 0);
  box(g, LW + 0.03, 0.026, LD + 0.03, K.beam, 0, F0 - 0.006, 0);
  tbox(g, LW - 0.02, EAVE - F0 - 0.03, LD - 0.02, K.wood, 0, F0 + 0.02, 0);
  box(g, LW + 0.004, 0.016, LD + 0.004, K.beam, 0, F0 + 0.02 + FH - 0.008, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.032, EAVE - F0 - 0.03, 0.032, K.beam, sx * (LW / 2 - 0.012), F0 + 0.02, sz * (LD / 2 - 0.012));
  const attic = prism(LD - 0.02, (LD / 2 - 0.01) * PITCH, LW - 0.02, K.wood);
  attic.position.y = EAVE - 0.012;
  g.add(attic);
  gableRoof(g, LW, LD / 2, 0.14, EAVE, PITCH, 0.16);

  // --- Öne çıkan orta bölüm: giriş, büyük camlar, ışıklı tabela, camlı üçgen alın ---
  const pz = fz + PD / 2;
  tbox(g, PW * 2, F0 + 0.08, PD, K.stone, 0, -0.08, pz);
  box(g, PW * 2 + 0.03, 0.026, PD + 0.015, K.beam, 0, F0 - 0.006, pz + 0.008);
  tbox(g, PW * 2 - 0.02, EAVE - F0 - 0.03, PD, K.wood, 0, F0 + 0.02, pz - 0.01);
  box(g, PW * 2 + 0.004, 0.016, PD + 0.002, K.beam, 0, F0 + 0.02 + FH - 0.008, pz - 0.009);
  for (const sx of [-1, 1]) box(g, 0.032, EAVE - F0 - 0.03, 0.032, K.beam, sx * (PW - 0.012), F0 + 0.02, fz + PD - 0.022);
  const pAttic = prism(PW * 2 - 0.02, (PW - 0.01) * PITCH, PD + 0.4, K.wood);
  pAttic.rotation.y = Math.PI / 2;
  pAttic.position.set(0, EAVE - 0.012, fz + PD - 0.01 - (PD + 0.4) / 2);
  g.add(pAttic);
  const pr = grp(g, 0, 0, fz + PD - 0.31, Math.PI / 2);
  gableRoof(pr, 0.62, PW, 0.08, EAVE, PITCH, 0.11);
  const pf = grp(g, 0, 0, fz + PD - 0.01); // orta bölümün ön yüzü (ahşap)
  const pfs = grp(g, 0, 0, fz + PD); // orta bölümün ön yüzü (taş)
  // Giriş: çift cam kapı, saçak, iki yanında pencere, basamak
  windowAt(pfs, 0, 0.13, 0.15, 0.2, false, false);
  box(pfs, 0.32, 0.014, 0.13, K.beam, 0, 0.255, 0.06);
  box(pfs, 0.31, 0.014, 0.12, K.snow, 0, 0.269, 0.058);
  for (const sx of [-0.13, 0.13]) beam(pfs, [sx, 0.2, 0.0], [sx, 0.254, 0.11], 0.012, 0.012, K.beam);
  for (const sx of [-0.235, 0.235]) windowAt(pfs, sx, 0.15, 0.1, 0.14, false);
  // Üst katlarda geniş camlar (kayıtlı), birinci katta balkon
  for (const y of [F0 + 0.13, F0 + FH + 0.12]) {
    box(pf, 0.54, 0.15, 0.006, K.glass, 0, y - 0.075, 0.001);
    box(pf, 0.56, 0.012, 0.014, K.trim, 0, y + 0.075, 0.004);
    box(pf, 0.56, 0.012, 0.014, K.trim, 0, y - 0.087, 0.004);
    for (let k = 0; k <= 4; k++) box(pf, 0.012, 0.15, 0.014, K.trim, -0.27 + k * 0.135, y - 0.075, 0.004);
  }
  balcony(pf, -PW - 0.01, PW + 0.01, F0 + 0.02, 0.11, pm('#e53935', 0.9));
  // Işıklı tabela ve camlı üçgen alın
  box(pf, 0.5, 0.13, 0.014, K.beam, 0, EAVE + 0.005, 0.004);
  mesh(pf, new THREE.PlaneGeometry(0.47, 0.115), K.sign, 0, EAVE + 0.07, 0.0115);
  const tri = new THREE.Shape();
  tri.moveTo(-0.14, 0);
  tri.lineTo(0.14, 0);
  tri.lineTo(0, 0.11);
  tri.closePath();
  mesh(pf, new THREE.ShapeGeometry(tri), K.glass, 0, EAVE + 0.16, 0.003);
  box(pf, 0.3, 0.012, 0.012, K.trim, 0, EAVE + 0.154, 0.006);
  for (const s of [-1, 1]) {
    const e = mesh(pf, new THREE.BoxGeometry(0.19, 0.012, 0.012), K.trim, s * 0.07, EAVE + 0.16 + 0.055, 0.006);
    e.rotation.z = -s * Math.atan2(0.11, 0.14);
  }
  box(pf, 0.01, 0.11, 0.01, K.trim, 0, EAVE + 0.16, 0.006);

  // --- Ön yüz (orta bölümün iki yanı): restoran camları, balkon kapıları, iki kat balkon ---
  const fs = grp(g, 0, 0, fz); // taş yüz
  const fw = grp(g, 0, 0, fz - 0.01); // ahşap yüz
  for (const sx of [-1, 1]) {
    for (const k of [0, 1, 2]) {
      const x = sx * (0.5 + k * 0.2);
      windowAt(fs, x, 0.15, 0.14, 0.14, false);
      box(fs, 0.18, 0.02, 0.016, K.beam, x, 0.235, 0.006);
      for (const fl of [0, 1]) windowAt(fw, x, F0 + 0.02 + fl * FH + 0.095, 0.085, 0.16, false, false);
    }
    for (const fl of [0, 1]) balcony(fw, sx > 0 ? PW + 0.01 : -LW / 2 + 0.01, sx > 0 ? LW / 2 - 0.01 : -PW - 0.01, F0 + 0.02 + fl * FH, 0.1, pm(fl ? '#ec407a' : '#e53935', 0.9));
  }
  // Çatı pencereleri (ön eğimde)
  for (const sx of [-0.66, 0.66]) {
    const d = grp(g, sx, 0, 0);
    const y0 = EAVE + (LD / 2 - 0.42) * PITCH - 0.012;
    tbox(d, 0.22, 0.2, 0.34, K.wood, 0, y0, 0.25);
    const dw = grp(d, 0, 0, 0.42);
    windowAt(dw, 0, y0 + 0.1, 0.12, 0.1, true);
    const dr = grp(d, 0, 0, 0.27, Math.PI / 2);
    gableRoof(dr, 0.3, 0.11, 0.035, y0 + 0.2, 1.0, 0.03);
    const dat = prism(0.21, 0.1, 0.34, K.wood);
    dat.rotation.y = Math.PI / 2;
    dat.position.set(0, y0 + 0.195, 0.25);
    d.add(dat);
  }
  // Bacalar (arka eğimde, taş, şapkalı)
  for (const [sx, sz] of [[-0.58, -0.22], [0.62, -0.26]]) {
    tbox(g, 0.1, 0.52, 0.11, K.stone, sx, 0.85, sz);
    box(g, 0.13, 0.018, 0.14, K.beam, sx, 1.37, sz);
    for (const ex of [-0.04, 0.04]) box(g, 0.012, 0.03, 0.012, K.beam, sx + ex, 1.388, sz);
    box(g, 0.13, 0.012, 0.14, K.beam, sx, 1.418, sz);
    box(g, 0.12, 0.016, 0.13, K.snow, sx, 1.43, sz);
  }
  // --- Arka yüz: mutfak kapısı, pencereler ---
  const bs = grp(g, 0, 0, -fz, Math.PI), bw = grp(g, 0, 0, -fz + 0.01, Math.PI);
  for (let k = 0; k < 7; k++) {
    const x = -0.78 + k * 0.26;
    if (k === 3) windowAt(bs, x, 0.12, 0.1, 0.19, false, false);
    else windowAt(bs, x, 0.15, 0.11, 0.12, false);
    for (const fl of [0, 1]) windowAt(bw, x, F0 + 0.02 + fl * FH + 0.11, 0.1, 0.12, true);
  }
  // --- Yan (alın) yüzler: pencereler, çatı arası penceresi; güneyde kayak kiralama girişi ve balkon ---
  for (const sx of [-1, 1]) {
    const es = grp(g, sx * (LW / 2), 0, 0, (sx * Math.PI) / 2), ew = grp(g, sx * (LW / 2 - 0.01), 0, 0, (sx * Math.PI) / 2);
    for (const z of [-0.24, 0.24]) {
      if (sx < 0 && z > 0) {
        // Kayak kiralama kapısı, saçağı ve tabelası
        windowAt(es, z, 0.12, 0.12, 0.19, false, false);
        box(es, 0.24, 0.012, 0.1, K.beam, z, 0.245, 0.05);
        box(es, 0.23, 0.012, 0.09, K.snow, z, 0.257, 0.048);
        // Tabela saçağın ön kenarında, dikine
        box(es, 0.2, 0.05, 0.006, K.beam, z, 0.252, 0.103);
        mesh(es, new THREE.PlaneGeometry(0.19, 0.0475), signMat('KİRALAMA', '#1f5fa8'), z, 0.277, 0.1065);
      } else windowAt(es, z, 0.15, 0.12, 0.13, false);
      for (const fl of [0, 1]) windowAt(ew, z, F0 + 0.02 + fl * FH + 0.11, 0.1, 0.12, !(sx < 0 && fl === 0));
    }
    windowAt(ew, 0, EAVE + 0.13, 0.12, 0.12, false);
    if (sx < 0) balcony(ew, -0.42, 0.42, F0 + 0.02, 0.1, pm('#ec407a', 0.9));
  }
  // Odun yığını (kuzey alnında, küçük saçaklı)
  const wood = grp(g, LW / 2 + 0.05, 0, -0.22);
  box(wood, 0.07, 0.15, 0.36, K.logs, 0, 0, 0);
  for (let k = 0; k < 9; k++) {
    const l = mesh(wood, new THREE.CylinderGeometry(0.014, 0.014, 0.004, 6), pm('#c69c6d', 0.9), 0.036, 0.016 + (k % 3) * 0.045, -0.13 + Math.floor(k / 3) * 0.13);
    l.rotation.z = Math.PI / 2;
  }
  box(wood, 0.1, 0.012, 0.4, K.beam, 0.005, 0.15, 0);
  box(wood, 0.1, 0.012, 0.39, K.snow, 0.005, 0.162, 0);

  // --- Güneş terası: ahşap döşeme, basamak, korkuluk, şemsiyeli masalar, fenerler ---
  const ty = 0.05, tz0 = fz, tz1 = fz + 1.0;
  box(g, LW + 0.1, ty + 0.03, tz1 - tz0, K.deck, 0, -0.03, (tz0 + tz1) / 2);
  box(g, LW + 0.12, 0.03, tz1 - tz0 + 0.02, K.beam, 0, -0.025, (tz0 + tz1) / 2);
  for (let k = 0; k < 12; k++) box(g, LW + 0.09, 0.0015, 0.004, K.beam, 0, ty, tz0 + 0.05 + k * 0.08);
  box(g, 0.44, 0.026, 0.07, K.deck, 0, -0.01, tz1 + 0.035);
  const rx = LW / 2 + 0.04;
  const railLine = (ax: number, az: number, bx: number, bz: number) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.17));
    for (let k = 0; k <= n; k++) box(g, 0.016, 0.07, 0.016, K.beam, lerp(ax, bx, k / n), ty, lerp(az, bz, k / n));
    beam(g, [ax, ty + 0.068, az], [bx, ty + 0.068, bz], 0.02, 0.012, K.timber);
    beam(g, [ax, ty + 0.03, az], [bx, ty + 0.03, bz], 0.01, 0.01, K.timber);
  };
  railLine(-rx, tz1 - 0.01, -0.22, tz1 - 0.01);
  railLine(0.22, tz1 - 0.01, rx, tz1 - 0.01);
  railLine(-rx, tz0 + 0.02, -rx, tz1 - 0.01);
  railLine(rx, tz0 + 0.02, rx, tz1 - 0.01);
  const canopies = [pm('#c62828', 0.8), pm('#f3e9d2', 0.8), pm('#2e7d32', 0.8), pm('#c62828', 0.8)];
  let seed = 1;
  for (const x of [-0.84, -0.5, 0.5, 0.84]) {
    for (const z of [tz0 + 0.38, tz0 + 0.74]) {
      cafeTable(g, x, z, ty, canopies[seed % canopies.length], seed, [2, 0, 3, 1, 2, 4, 0, 2][seed % 8]);
      seed++;
    }
  }
  // Garson
  const waiter = figure('walk', { ...look(9), jacket: K.white, pants: pm('#212121') }, false, false);
  cyl(waiter, 0.022, 0.022, 0.003, K.steel, 0.019, 0.122, 0.012, 10);
  cyl(waiter, 0.006, 0.006, 0.014, pm('#ffb74d', 0.4), 0.012, 0.125, 0.01, 6);
  waiter.position.set(-0.2, ty, tz0 + 0.55);
  waiter.rotation.y = 0.6;
  g.add(waiter);
  for (const sx of [-1, 1]) lampPost(g, sx * rx, tz1 + 0.06, 0.18);
  for (const sx of [-0.2, 0.2]) {
    const l = grp(g, sx, 0, tz1 + 0.06);
    cyl(l, 0.006, 0.008, 0.1, K.dark, 0, 0, 0, 6);
    mesh(l, new THREE.SphereGeometry(0.01, 8, 6), BULB, 0, 0.11, 0);
  }

  // --- Çevresi: kayak askıları, kar motorları, ratrak, bayraklar, bank ---
  skiRack(g, -LW / 2 - 0.3, 0.7, Math.PI / 2, 14, 3);
  skiRack(g, -LW / 2 - 0.3, -0.4, Math.PI / 2, 10, 8);
  snowmobile(g, LW / 2 + 0.32, 0.42, 0.35, K.yellow);
  snowmobile(g, LW / 2 + 0.47, 0.7, 0.25, K.blue);
  snowcat(g, LW / 2 + 0.55, -0.35, 0.1);
  flagPole(g, -LW / 2 - 0.2, tz1 + 0.12, K.flag);
  flagPole(g, -LW / 2 - 0.38, tz1 + 0.0, pm('#1f5fa8', 0.8), 0.38);
  flagPole(g, -LW / 2 - 0.56, tz1 - 0.12, pm('#fdd835', 0.8), 0.38);
  // Kapının önünde bekleyen ve konuşan kayakçılar
  const chat: [number, number, number, number][] = [[-1.55, -0.02, 1.2, 4], [-1.66, 0.1, 2.6, 7], [-1.5, 1.15, -2.0, 2]];
  for (const [x, z, r, k] of chat) {
    const p = figure('stand', look(k));
    p.position.set(x, 0.012, z);
    p.rotation.y = r;
    g.add(p);
  }
  return g;
}

// ---------------- Telesiyej ----------------
// İstasyonların zemin ölçüsü (yerel): alt istasyon düz zeminde, üst istasyon sırtta taş bir binanın üstünde
const BOT_AREA = { x0: -1.0, x1: 1.0, z0: -0.95, z1: STN + 0.45 };
const TOP_AREA = { x0: -0.55, x1: 0.55, z0: -0.95, z1: STN - 0.05 };

// İstasyon (yerel: döner tekerlek z=0'da, hat +z yönünde; zemin/güverte y=0). up: yukarı çıkan halatın x yönü.
// top: üst istasyon (zirve binası, korkuluklar, yön tabelaları); drop: güverteden en alçak zemine
function station(top: boolean, up: number, drop: number) {
  const g = new THREE.Group();
  const R = CABLE_SIDE;
  if (top) {
    // Zirve binası: taş kaide, her katta panorama camları (gece yanar), karlı beton güverte, korkuluk
    const A = TOP_AREA, w = A.x1 - A.x0, d = A.z1 - A.z0, cz = (A.z0 + A.z1) / 2;
    tbox(g, w, drop + 0.05, d, K.stone, 0, -drop - 0.06, cz);
    for (let y = -0.2; y > -drop + 0.02; y -= 0.24) {
      box(g, w + 0.008, 0.1, d + 0.008, K.glass, 0, y, cz);
      box(g, w + 0.02, 0.014, d + 0.02, K.concrete, 0, y + 0.1, cz);
    }
    box(g, w + 0.08, 0.05, d + 0.08, K.concrete, 0, -0.05, cz);
    box(g, w + 0.06, 0.012, d + 0.06, K.pack, 0, -0.008, cz);
    const ex = w / 2 + 0.035;
    for (const [ax, az, bx, bz] of [[-ex, A.z0 - 0.035, ex, A.z0 - 0.035], [-ex, A.z0 - 0.035, -ex, A.z1], [ex, A.z0 - 0.035, ex, A.z1]]) {
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.2));
      for (let k = 0; k <= n; k++) box(g, 0.008, 0.07, 0.008, K.steel, lerp(ax, bx, k / n), 0, lerp(az, bz, k / n));
      beam(g, [ax, 0.07, az], [bx, 0.07, bz], 0.008, 0.008, K.yellow);
      beam(g, [ax, 0.035, az], [bx, 0.035, bz], 0.005, 0.005, K.steel);
    }
    box(g, 0.33, 0.095, 0.012, K.beam, 0, -0.17, A.z1 + 0.012);
    mesh(g, new THREE.PlaneGeometry(0.31, 0.0775), litSign('ZİRVE', '#3b2a20', '#ffe9b8'), 0, -0.1225, A.z1 + 0.0185);
  }
  // Kaportayı taşıyan çelik kolonlar
  for (const sx of [-0.42, 0.42]) for (const z of [0.36, STN - 0.12]) box(g, 0.045, 0.44, 0.045, K.steel, sx, 0, z);
  // Döner tekerlek (yatay), göbek ve tepeden inen mil
  const wheel = mesh(g, new THREE.TorusGeometry(R, 0.012, 6, 32), K.dark, 0, ROPE_H, 0);
  wheel.rotation.x = Math.PI / 2;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    bar(g, [0, ROPE_H, 0], [Math.cos(a) * R, ROPE_H, Math.sin(a) * R], 0.006, K.steel, 4);
  }
  cyl(g, 0.04, 0.04, 0.04, K.yellow, 0, ROPE_H - 0.02, 0, 12);
  cyl(g, 0.018, 0.018, 0.44 - ROPE_H, K.steel, 0, ROPE_H, 0, 8);
  // Raylar: koltuklar halattan ayrılıp bunların üstünde yavaşlar ve tekerleğin çevresinden döner
  for (const sx of [-R, R]) box(g, 0.016, 0.02, STN, K.dark, sx, ROPE_H + 0.02, STN / 2);
  const arc = mesh(g, new THREE.TorusGeometry(R, 0.008, 4, 16, Math.PI), K.dark, 0, ROPE_H + 0.03, 0);
  arc.rotation.x = -Math.PI / 2;
  // Kaporta: tekerlek tarafı yuvarlak, kenarları yumuşak; iki yanında cam şerit, üstünde havalandırma
  const hw = 0.38, hz1 = STN + 0.08;
  const s = new THREE.Shape();
  s.moveTo(-hw, -hz1);
  s.lineTo(hw, -hz1);
  s.lineTo(hw, 0);
  s.absarc(0, 0, hw, 0, Math.PI, false);
  s.lineTo(-hw, -hz1);
  const hoodGeo = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.045, bevelSegments: 3, curveSegments: 16 });
  hoodGeo.rotateX(-Math.PI / 2);
  mesh(g, hoodGeo, K.red, 0, 0.44 + 0.045, 0);
  box(g, 0.74, 0.012, STN + 0.06, K.dark, 0, 0.432, STN / 2 + 0.02);
  for (const sx of [-1, 1]) box(g, 0.006, 0.034, STN - 0.12, K.glass, sx * (hw + 0.047), 0.49, STN / 2 + 0.02);
  box(g, 0.22, 0.03, 0.16, K.white, 0, 0.585, -0.05);
  for (let k = 0; k < 4; k++) box(g, 0.2, 0.004, 0.012, K.dark, 0, 0.615, -0.11 + k * 0.04);
  // Tabela: altta tekerlek ucunda, üstte hat ucunda (ikisi de aşağıya, vadiye bakar)
  const signM = signMat('TELESİYEJ', '#ffffff', '#c62828');
  if (top) mesh(g, new THREE.PlaneGeometry(0.34, 0.085), signM, 0, 0.5, hz1 + 0.052);
  else mesh(g, new THREE.PlaneGeometry(0.34, 0.085), signM, 0, 0.5, -hw - 0.052).rotation.y = Math.PI;
  // Kumanda kulübesi: geniş camlar, karlı düz çatı (altta inen halat tarafında, kayakçıların yolundan uzakta; üstte arkada)
  const hut = top ? grp(g, -up * 0.24, 0, -0.76, Math.PI / 2) : grp(g, -up * 0.66, 0, 0.35, Math.PI);
  box(hut, 0.2, 0.17, 0.26, K.white, 0, 0, 0);
  box(hut, 0.204, 0.065, 0.264, K.glass, 0, 0.08, 0);
  box(hut, 0.004, 0.12, 0.06, K.dark, -0.1, 0, 0.05);
  box(hut, 0.25, 0.018, 0.31, K.dark, 0, 0.17, 0);
  box(hut, 0.24, 0.018, 0.3, K.snow, 0, 0.188, 0);
  if (!top) {
    for (const z of [BOT_AREA.z0 + 0.3, BOT_AREA.z1 - 0.1]) lampPost(g, -up * 0.62, z, 0.2);
    // Yükleme bandı, durma çizgisi, turnikeler
    box(g, 0.17, 0.012, 0.26, K.rubber, up * R, 0, 0.16);
    for (const sx of [-0.088, 0.088]) box(g, 0.008, 0.013, 0.26, K.yellow, up * R + sx, 0, 0.16);
    box(g, 0.17, 0.014, 0.012, K.red, up * R, 0, 0.3);
    for (let k = 0; k < 4; k++) {
      const x = up * (0.12 + k * 0.1);
      box(g, 0.018, 0.06, 0.03, K.steel, x, 0, -0.06);
      box(g, 0.004, 0.006, 0.07, K.yellow, x + up * 0.045, 0.045, -0.06).rotation.y = 0.3;
    }
    // Sıra bariyerleri (zikzak yollar) ve sırada bekleyen kayakçılar
    const lanes = [0.46, 0.6, 0.74, 0.88, 1.0];
    for (const lx of lanes) {
      const zs = [-0.88, -0.66, -0.44, -0.22];
      for (const z of zs) cyl(g, 0.006, 0.007, 0.055, K.dark, up * lx, 0, z, 6);
      box(g, 0.004, 0.012, 0.66, K.blue, up * lx, 0.036, -0.55);
    }
    const queue: [number, number][] = [[0.53, -0.3], [0.53, -0.52], [0.67, -0.75], [0.81, -0.38], [0.81, -0.6], [0.94, -0.82]];
    queue.forEach(([lx, z], k) => {
      const p = figure('stand', look(k * 5 + 1));
      p.position.set(up * lx, 0, z);
      p.rotation.y = lx > 0.6 && lx < 0.75 ? Math.PI : 0;
      g.add(p);
    });
    // Pist haritası panosu
    const b = grp(g, up * 1.12, 0, -0.7, Math.PI);
    for (const sx of [-0.2, 0.2]) cyl(b, 0.008, 0.008, 0.33, K.timber, sx, -drop, 0, 6);
    box(b, 0.44, 0.24, 0.016, K.beam, 0, 0.06, 0);
    mesh(b, new THREE.PlaneGeometry(0.41, 0.205), K.map, 0, 0.18, 0.009);
    beam(b, [-0.25, 0.32, 0.05], [0.25, 0.32, 0.05], 0.07, 0.012, K.beam);
  } else {
    lampPost(g, up * 0.5, TOP_AREA.z0 + 0.06, 0.2);
    lampPost(g, -up * 0.5, TOP_AREA.z1 - 0.06, 0.2);
    // Yön tabelaları: üç pist
    const sp = grp(g, up * 0.4, 0, TOP_AREA.z0 + 0.12);
    cyl(sp, 0.007, 0.008, 0.3, K.timber, 0, 0, 0, 6);
    ['MAVİ', 'KIRMIZI', 'SİYAH'].forEach((t, k) => {
      const b = grp(sp, 0, 0.27 - k * 0.055, 0, [0.6, -0.4, 1.4][k]);
      mesh(b, new THREE.PlaneGeometry(0.16, 0.04), signMat(t, RUN_COLORS[k]), 0.08, 0, 0.005);
      box(b, 0.165, 0.044, 0.008, K.white, 0.08, -0.022, 0);
      mesh(b, new THREE.PlaneGeometry(0.16, 0.04), signMat(t, RUN_COLORS[k]), 0.08, 0, -0.005).rotation.y = Math.PI;
    });
  }
  return g;
}

// Direk (yerel: zemin y=0, halat y=H, hat +z yönünde). pitch: halatın o noktadaki eğimi. lattice: kafes direk
function tower(H: number, pitch: number, lattice: boolean, rnd: () => number) {
  const g = new THREE.Group();
  const R = CABLE_SIDE;
  const armY = H - 0.075;
  box(g, 0.22, 0.4, 0.22, K.concrete, 0, -0.34, 0);
  if (lattice) {
    const b0 = 0.11, b1 = 0.045;
    const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const top = armY - 0.03;
    for (const [sx, sz] of legs) bar(g, [sx * b0, 0.05, sz * b0], [sx * b1, top, sz * b1], 0.0075, K.steel, 4);
    const n = Math.max(3, Math.round((top - 0.05) / 0.2));
    for (let i = 0; i < n; i++) {
      const y0 = lerp(0.05, top, i / n), y1 = lerp(0.05, top, (i + 1) / n);
      const w0 = lerp(b0, b1, i / n), w1 = lerp(b0, b1, (i + 1) / n);
      for (let f = 0; f < 4; f++) {
        const [ax, az] = legs[f], [bx, bz] = legs[(f + 1) % 4];
        bar(g, [ax * w0, y0, az * w0], [bx * w1, y1, bz * w1], 0.0032, K.steel, 3);
        bar(g, [bx * w0, y0, bz * w0], [ax * w1, y1, az * w1], 0.0032, K.steel, 3);
        bar(g, [ax * w1, y1, az * w1], [bx * w1, y1, bz * w1], 0.0035, K.steel, 3);
      }
    }
    box(g, 0.1, 0.03, 0.1, K.steel, 0, top - 0.01, 0);
  } else {
    cyl(g, 0.06, 0.06, 0.03, K.steel, 0, 0.0, 0, 10);
    cyl(g, 0.027, 0.04, armY - 0.01, K.steel, 0, 0.0, 0, 10);
    // Merdiven (aşağı bakan yüzde)
    for (const sx of [-0.011, 0.011]) bar(g, [sx, 0.06, -0.05], [sx, armY - 0.05, -0.036], 0.002, K.dark, 3);
    for (let y = 0.1; y < armY - 0.06; y += 0.07) box(g, 0.024, 0.003, 0.003, K.dark, 0, y, lerp(-0.05, -0.036, y / armY));
  }
  // Kol, bakım platformu ve korkuluğu
  box(g, 2 * R + 0.14, 0.04, 0.05, K.dark, 0, armY - 0.04, 0);
  box(g, 2 * R + 0.12, 0.006, 0.09, K.steel, 0, armY - 0.075, -0.01);
  xcyl(g, 0.003, 2 * R + 0.12, K.yellow, 0, armY - 0.025, -0.055, 4);
  for (const sx of [-R - 0.06, 0, R + 0.06]) box(g, 0.004, 0.05, 0.004, K.yellow, sx, armY - 0.075, -0.055);
  // Makara dizileri: halat dört makaranın üstünden geçer (eğime göre yatık)
  for (const s of [-1, 1]) {
    box(g, 0.022, 0.05, 0.022, K.dark, s * R, armY - 0.01, 0);
    const tr = grp(g, s * R, H, 0);
    tr.rotation.x = -pitch;
    box(tr, 0.026, 0.016, 0.24, K.dark, 0, -0.06, 0);
    for (let i = 0; i < 4; i++) {
      const z = -0.084 + i * 0.056;
      const w = mesh(tr, new THREE.CylinderGeometry(0.021, 0.021, 0.012, 12), K.rubber, 0, -0.021, z);
      w.rotation.z = Math.PI / 2;
      xcyl(tr, 0.009, 0.016, K.yellow, 0, -0.021, z, 6);
    }
  }
  if (rnd() < 0.5) mesh(g, new THREE.PlaneGeometry(0.04, 0.04), K.yellow, 0, armY - 0.2, -0.045).rotation.y = Math.PI;
  return g;
}

// Halat: çokgen boyunca dört köşeli ince boru
function tube(points: THREE.Vector3[], r: number) {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const t = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  points.forEach((p, i) => {
    t.subVectors(points[Math.min(points.length - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
    a.crossVectors(t, UP).normalize();
    b.crossVectors(a, t).normalize();
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2 + Math.PI / 4;
      n.copy(a).multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang));
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nrm.push(n.x, n.y, n.z);
    }
    if (i) {
      for (let k = 0; k < 4; k++) {
        const c0 = (i - 1) * 4 + k, c1 = (i - 1) * 4 + ((k + 1) % 4);
        idx.push(c0, c0 + 4, c1, c1, c0 + 4, c1 + 4);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  return geo;
}

// Koltuk (yerel: halat kıskacı başlangıçta, gidiş +z). closed: emniyet barı ve ayaklık inik
function chairModel(closed: boolean) {
  const g = new THREE.Group();
  const frame = K.dark, pad = K.blue;
  box(g, 0.026, 0.028, 0.05, frame, 0, -0.02, 0);
  box(g, 0.03, 0.012, 0.07, K.steel, 0, 0.006, 0);
  bar(g, [0, -0.02, 0], [0, -0.19, -0.012], 0.0065, frame, 6);
  bar(g, [0, -0.19, -0.012], [0, -0.207, -0.05], 0.0065, frame, 6);
  bar(g, [-0.105, -0.207, -0.05], [0.105, -0.207, -0.05], 0.005, frame, 5);
  box(g, 0.206, 0.012, 0.06, frame, 0, -HANG - 0.02, -0.006);
  box(g, 0.2, 0.009, 0.054, pad, 0, -HANG - 0.009, -0.006);
  const back = box(g, 0.2, 0.052, 0.009, pad, 0, -HANG - 0.005, -0.036);
  back.rotation.x = -0.2;
  for (const s of [-1, 1]) {
    bar(g, [s * 0.105, -HANG - 0.014, 0.024], [s * 0.105, -0.207, -0.05], 0.0042, frame, 4);
    box(g, 0.008, 0.006, 0.052, frame, s * 0.105, -HANG + 0.028, -0.012);
  }
  // Emniyet barı ve ayaklık: sırtlığın üstündeki mafsaldan döner
  const p = grp(g, 0, -0.207, -0.05);
  p.rotation.x = closed ? 0 : -1.45;
  for (const s of [-1, 1]) {
    bar(p, [s * 0.105, 0, 0], [s * 0.105, -0.012, 0.115], 0.004, frame, 4);
    bar(p, [s * 0.05, -0.012, 0.115], [s * 0.05, -0.095, 0.13], 0.0035, frame, 4);
  }
  bar(p, [-0.105, -0.012, 0.115], [0.105, -0.012, 0.115], 0.0045, frame, 4);
  bar(p, [-0.09, -0.095, 0.13], [0.09, -0.095, 0.13], 0.004, K.yellow, 4);
  return g;
}

// ---------------- Pistler ----------------
// Pistin bir noktası: s (0..1) boyunca konum ve yön
function runAt(run: { pts: [number, number][] }, len: number, s: number) {
  let d = s * len;
  const pts = run.pts;
  for (let k = 1; k < pts.length; k++) {
    const seg = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    if (d <= seg || k === pts.length - 1) {
      const t = Math.min(1, d / seg);
      const dx = (pts[k][0] - pts[k - 1][0]) / seg, dz = (pts[k][1] - pts[k - 1][1]) / seg;
      return { x: pts[k - 1][0] + dx * seg * t, z: pts[k - 1][1] + dz * seg * t, dx, dz };
    }
    d -= seg;
  }
  return { x: pts[0][0], z: pts[0][1], dx: 0, dz: 1 };
}
const runLength = (run: { pts: [number, number][] }) => {
  let len = 0;
  for (let k = 1; k < run.pts.length; k++) len += Math.hypot(run.pts[k][0] - run.pts[k - 1][0], run.pts[k][1] - run.pts[k - 1][1]);
  return len;
};
// Köşelerde yumuşatılmış kenar çizgisi (pistin bir yanında, ortasından off kadar)
function edgeAt(run: { pts: [number, number][] }, len: number, s: number, off: number) {
  const a = runAt(run, len, Math.max(0, s - 0.02)), b = runAt(run, len, Math.min(1, s + 0.02)), p = runAt(run, len, s);
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
  return { x: p.x - (dz / l) * off, z: p.z + (dx / l) * off, nx: -dz / l, nz: dx / l };
}
// Çift yüzlü şerit (güvenlik ağı): noktaların üstünde h yüksekliğinde
function ribbon(points: THREE.Vector3[], h0: number, h1: number) {
  const pos: number[] = [], idx: number[] = [];
  for (const side of [0, 1]) {
    const o = pos.length / 3;
    for (const p of points) pos.push(p.x, p.y + h0, p.z, p.x, p.y + h1, p.z);
    for (let k = 0; k < points.length - 1; k++) {
      const a = o + k * 2, b = a + 1, c = a + 2, d = a + 3;
      if (side) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
// Kar makinesi: tekerlekli şasi, eğik fan gövdesi ve püskürttüğü kar bulutu
function snowGun(g: G, x: number, z: number, ry: number) {
  const s = grp(g, x, ground(x, z), z, ry);
  box(s, 0.1, 0.02, 0.1, K.dark, 0, 0.02, 0);
  for (const sx of [-0.055, 0.055]) {
    const w = mesh(s, new THREE.CylinderGeometry(0.022, 0.022, 0.014, 10), K.rubber, sx, 0.022, -0.02);
    w.rotation.z = Math.PI / 2;
  }
  bar(s, [0, 0.03, 0.05], [0, 0.0, 0.12], 0.004, K.dark, 4);
  cyl(s, 0.012, 0.016, 0.08, K.yellow, 0, 0.04, 0, 8);
  const head = grp(s, 0, 0.13, 0);
  head.rotation.x = -0.45;
  mesh(head, new THREE.CylinderGeometry(0.045, 0.04, 0.09, 14), K.yellow, 0, 0, 0).rotation.x = Math.PI / 2;
  mesh(head, new THREE.TorusGeometry(0.044, 0.006, 4, 14), K.dark, 0, 0, 0.046);
  mesh(head, new THREE.CylinderGeometry(0.02, 0.02, 0.01, 8), K.dark, 0, 0, -0.046).rotation.x = Math.PI / 2;
  const plume = mesh(head, new THREE.ConeGeometry(0.16, 0.7, 12, 1, true), SPRAY, 0, 0, 0.4);
  plume.rotation.x = -Math.PI / 2;
}
// Lans tipi kar makinesi: uzun eğik direk, tepede meme ve ince kar bulutu
function snowLance(g: G, x: number, z: number, ry: number) {
  const s = grp(g, x, ground(x, z), z, ry);
  box(s, 0.05, 0.05, 0.05, K.concrete, 0, -0.03, 0);
  const p = grp(s, 0, 0.02, 0);
  p.rotation.x = 0.35;
  cyl(p, 0.006, 0.008, 0.45, K.steel, 0, 0, 0, 6);
  cyl(p, 0.014, 0.012, 0.05, K.dark, 0, 0.44, 0, 8);
  const plume = mesh(p, new THREE.ConeGeometry(0.1, 0.45, 10, 1, true), SPRAY, 0, 0.49, 0.22);
  plume.rotation.x = -Math.PI / 2 - 0.1;
}

// Karlı çam: kat kat yeşil dallar, her katın üstünde kar örtüsü
function snowyPineGeo() {
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, lo: string, hi: string, y0: number, y1: number, seed: number) => {
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const a = new THREE.Color(lo), b = new THREE.Color(hi), c = new THREE.Color();
    for (let f = 0; f < p.count; f += 3) {
      const cy = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3;
      const n = Math.sin(f * 12.9898 + seed * 78.233) * 43758.5453;
      c.lerpColors(a, b, smooth(cy, y0, y1)).multiplyScalar(0.92 + (n - Math.floor(n)) * 0.14);
      for (let k = 0; k < 3; k++) c.toArray(col, (f + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  };
  const cone = (r: number, h: number, y: number, seg: number, rot: number) => {
    const g = new THREE.ConeGeometry(r, h, seg, 1, true).toNonIndexed();
    g.rotateY(rot);
    g.translate(0, y, 0);
    g.deleteAttribute('uv');
    return g;
  };
  for (let k = 0; k < 5; k++) {
    const r = 0.2 - k * 0.034, h = 0.2 - k * 0.012, y = 0.22 + k * 0.088;
    parts.push(paint(cone(r, h, y, 9, k * 0.5), '#24573a', '#3f7d45', 0.12, 0.66, k));
    parts.push(paint(cone(r * 0.8, h * 0.6, y + h * 0.2 + 0.006, 9, k * 0.5 + 0.35), '#dfe8ef', '#ffffff', 0.15, 0.7, k + 9));
  }
  const trunk = new THREE.CylinderGeometry(0.024, 0.034, 0.2, 6, 1, true).toNonIndexed();
  trunk.translate(0, 0.1, 0);
  trunk.deleteAttribute('uv');
  parts.push(paint(trunk, '#4e3424', '#6d4a33', 0, 0.2, 3));
  const m = mergeGeometries(parts, false)!;
  parts.forEach(p => p.dispose());
  return m;
}

// Kar örtüsü: dağ evi ve alt istasyonun çevresi; kenarları çimene doğru yumuşakça incelir
function snowField() {
  const cx = -44.3, cz = -13.1;
  const N = 64, RINGS = 14;
  // Kenar dalgalı; otoparka doğru (güneydoğu) daha geniş
  const radius = (a: number) => 3.55 + 0.32 * Math.sin(a * 3 + 1) + 0.2 * Math.sin(a * 7 + 2) + 0.1 * Math.sin(a * 13 + 0.5) + 1.3 * Math.pow(Math.max(0, Math.cos(a - 0.87)), 3);
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (let r = 0; r <= RINGS; r++) {
    const f = r / RINGS;
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      const rr = Math.pow(f, 0.8) * radius(a);
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      pos.push(x, ground(x, z) + 0.014, z);
      const n = Math.sin(x * 3.1 + z * 1.7) * 0.5 + Math.sin(x * 7.3 - z * 5.1) * 0.5;
      c.set('#f2f6f9').multiplyScalar(0.97 + n * 0.03);
      col.push(c.r, c.g, c.b, 1 - smooth(f, 0.7, 1));
    }
  }
  for (let r = 0; r < RINGS; r++) {
    for (let j = 0; j < N; j++) {
      const a = r * N + j, b = r * N + ((j + 1) % N), d = a + N, e = b + N;
      idx.push(a, b, d, b, e, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const o = new THREE.Mesh(geo, m);
  o.receiveShadow = true;
  return o;
}

// Yürüme yolları: otopark, dağ evi ve telesiyej arasında (yürüyenler gidip gelir, çamlar buralara dikilmez)
function walkPaths() {
  const L = (lx: number, lz: number) => world(LODGE.x, LODGE.y, LODGE_ROT, lx, lz);
  const S = (sx: number, sz: number) => world(BOTTOM.x, BOTTOM.y, HEADING, sx, sz);
  const V = (x: number, z: number) => new THREE.Vector2(x, z);
  return [
    [L(0, LD / 2 + 1.12), L(-0.3, LD / 2 + 1.7), V(-42.5, -12.45), V(-43.05, -11.6)],
    [L(-LW / 2 - 0.12, 0.24), L(-LW / 2 - 0.55, 0.3), S(-0.7, -1.1)],
    [V(-43.15, -11.2), V(-44.0, -11.75), S(-0.75, -1.15)],
    [L(-LW / 2 - 0.5, 0.95), L(-LW / 2 - 0.65, 0.2), S(-0.95, -1.05)],
    [L(0.6, LD / 2 + 1.15), L(1.4, LD / 2 + 1.2), L(1.5, 0.9)],
    [V(-42.9, -11.0), V(-43.5, -12.2), L(-0.15, LD / 2 + 1.12)],
    [S(-1.15, -0.5), S(-1.5, 0.4), S(-1.45, 1.2)],
  ];
}
// Bir noktanın çizgiye (nokta listesi) uzaklığı
function polyDist(x: number, z: number, pts: { x: number; y: number }[]) {
  let d = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const ax = pts[k - 1].x, az = pts[k - 1].y, dx = pts[k].x - ax, dz = pts[k].y - az;
    const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return d;
}

// ---------------- Hareketliler ----------------
interface Seg { a: THREE.Vector3; b: THREE.Vector3; len: number; sag: number; v0: number; v1: number }
interface Chair { d: number; k: number; riders: number[]; v: number; sw: number; sv: number }
interface Skier { run: number; s: number; speed: number; phase: number; board: boolean; idx: number }
interface Walker { path: THREE.Vector2[]; lens: number[]; total: number; s: number; dir: number; wait: number; speed: number; phase: number }

export class SkiResort {
  readonly root = new THREE.Group();
  private segs: Seg[] = []; // koltukların döngüsü (raylar, halat aralıkları, tekerlek çevreleri)
  private cum: number[] = [];
  private total = 0;
  private unloadAt = 0; // üst istasyonda inilen yer
  private lineFrom = 0; // emniyet barı bu aralıkta iner (yukarı çıkan halat)
  private lineTo = 0;
  private chairs: Chair[] = [];
  private skiers: Skier[] = [];
  private walkers: Walker[] = [];
  private runLens: number[] = [];
  private time = 0;
  private chairOpen!: THREE.InstancedMesh;
  private chairClosed!: THREE.InstancedMesh;
  private riderMesh!: THREE.InstancedMesh;
  private skierMesh!: THREE.InstancedMesh;
  private boardMesh!: THREE.InstancedMesh;
  private walkerMesh!: THREE.InstancedMesh;
  private colors = JACKETS.map(c => new THREE.Color(c));
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  init() {
    K = makeMats();
    const st: THREE.Object3D[] = [];
    // Dağ evi
    const l = lodge();
    l.position.set(LODGE.x, ground(LODGE.x, LODGE.y), LODGE.y);
    l.rotation.y = LODGE_ROT;
    st.push(l);
    this.buildLift(st);
    this.buildBase(st);
    this.buildPistes(st);
    this.root.add(mergeStatic(st));
    this.root.add(snowField());
    this.buildPeople();
  }

  // Telesiyej: istasyonlar, direkler, halat ve koltukların döngüsü
  private buildLift(st: THREE.Object3D[]) {
    const R = CABLE_SIDE;
    // İstasyonlar: güverte altındaki en yüksek zemine oturur; temel en alçak zemine iner
    const fb = footprint(BOTTOM.x, BOTTOM.y, HEADING, BOT_AREA.x0, BOT_AREA.x1, BOT_AREA.z0, BOT_AREA.z1);
    const fbTop = footprint(TOP.x, TOP.y, HEADING + Math.PI, TOP_AREA.x0, TOP_AREA.x1, TOP_AREA.z0, TOP_AREA.z1);
    // Altta zemin düz, kar örtüsünün hemen üstü; üstte güverte sırtın en yüksek yerinde
    const yb = fb.hi + 0.012, yt = fbTop.hi + 0.02;
    const sb = station(false, -1, yb - fb.lo + 0.05);
    sb.position.set(BOTTOM.x, yb, BOTTOM.y);
    sb.rotation.y = HEADING;
    const stp = station(true, 1, yt - fbTop.lo + 0.05);
    stp.position.set(TOP.x, yt, TOP.y);
    stp.rotation.y = HEADING + Math.PI;
    st.push(sb, stp);
    // Halatın düğümleri: alt istasyon çıkışı, direkler, üst istasyon girişi
    const at = (d: number) => BOTTOM.clone().addScaledVector(DIR, d);
    const towers = 7;
    const nodes: { p: THREE.Vector2; y: number; g: number; tower: boolean }[] = [];
    nodes.push({ p: at(STN), y: yb + ROPE_H, g: 0, tower: false });
    // Zeminin eğimli uzunluğu boyunca eşit aralık: dik yamaçta direkler sıklaşır
    const prof: number[] = [0];
    const step = 0.1;
    for (let d = step; d <= LINE_LEN + 1e-6; d += step) {
      const p0 = at(d - step), p1 = at(d);
      prof.push(prof[prof.length - 1] + Math.hypot(step, ground(p1.x, p1.y) - ground(p0.x, p0.y)));
    }
    const s0 = prof[Math.round(STN / step)], s1 = prof[Math.round((LINE_LEN - STN) / step)];
    for (let k = 1; k <= towers; k++) {
      const want = s0 + ((s1 - s0) * k) / (towers + 1);
      let i = 0;
      while (i < prof.length - 1 && prof[i] < want) i++;
      const p = at(i * step);
      const g = ground(p.x, p.y);
      nodes.push({ p, y: g + 1.0, g, tower: true });
    }
    nodes.push({ p: at(LINE_LEN - STN), y: yt + ROPE_H, g: 0, tower: false });
    const sagOf = (a: (typeof nodes)[0], b: (typeof nodes)[0]) => Math.min(0.12, 0.02 * Math.hypot(a.p.distanceTo(b.p), a.y - b.y));
    // Direk boylarını, halat her yerde zeminden yeterince yüksek olacak şekilde ayarla
    for (let iter = 0; iter < 40; iter++) {
      let worst = 0;
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i], b = nodes[i + 1];
        const sag = sagOf(a, b);
        let deficit = 0, worstT = 0.5;
        for (let t = 0.05; t < 0.96; t += 0.05) {
          const px = lerp(a.p.x, b.p.x, t), pz = lerp(a.p.y, b.p.y, t);
          const y = lerp(a.y, b.y, t) - sag * Math.sin(Math.PI * t);
          let g = -Infinity;
          for (const s of [-1, 0, 1]) g = Math.max(g, ground(px + SIDE.x * R * s, pz + SIDE.y * R * s));
          // İstasyonların yakınında halat alçalır (koltuklar platforma iner)
          const dA = a.tower ? 9 : t * a.p.distanceTo(b.p), dB = b.tower ? 9 : (1 - t) * a.p.distanceTo(b.p);
          const need = g + lerp(0.32, CLEAR, Math.min(1, Math.min(dA, dB) / 1.2));
          if (need - y > deficit) {
            deficit = need - y;
            worstT = t;
          }
        }
        if (deficit <= 0.001) continue;
        worst = Math.max(worst, deficit);
        // Eksik kalan yükseklik direklere paylaştırılır (istasyonun yanındaki direk daha çok yükselir)
        if (a.tower && b.tower) {
          a.y += deficit * 0.7;
          b.y += deficit * 0.7;
        } else if (a.tower) a.y += Math.min(deficit / Math.max(0.25, 1 - worstT), deficit * 4) * 0.7;
        else if (b.tower) b.y += Math.min(deficit / Math.max(0.25, worstT), deficit * 4) * 0.7;
      }
      if (worst < 0.002) break;
    }
    // Direkler
    const rnd = rand(17);
    for (let i = 1; i < nodes.length - 1; i++) {
      const a = nodes[i - 1], n = nodes[i], b = nodes[i + 1];
      const pitch = (Math.atan2(n.y - a.y, a.p.distanceTo(n.p)) + Math.atan2(b.y - n.y, n.p.distanceTo(b.p))) / 2;
      const H = n.y - n.g;
      const tw = tower(H, pitch, H > 1.2 || i % 3 === 2, rnd);
      tw.position.set(n.p.x, n.g, n.p.y);
      tw.rotation.y = HEADING;
      st.push(tw);
    }
    // Halatlar (iki yanda) ve koltuk döngüsü
    const side = (p: THREE.Vector2, y: number, s: number) => v3(p.x + SIDE.x * R * s, y, p.y + SIDE.y * R * s);
    const B = { p: BOTTOM, y: yb + ROPE_H }, T = { p: TOP, y: yt + ROPE_H };
    const segs: Seg[] = [];
    const push = (a: THREE.Vector3, b: THREE.Vector3, v0: number, v1: number, sag = 0) => segs.push({ a, b, len: a.distanceTo(b), sag, v0, v1 });
    const ropes: THREE.Vector3[][] = [[], []];
    for (const [si, s] of [[0, 1], [1, -1]]) {
      const pts = ropes[si];
      pts.push(side(B.p, B.y, s));
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i], b = nodes[i + 1], sag = sagOf(a, b);
        for (let k = 0; k <= 12; k++) {
          const t = k / 12;
          pts.push(side(a.p.clone().lerp(b.p, t), lerp(a.y, b.y, t) - sag * Math.sin(Math.PI * t), s));
        }
      }
      pts.push(side(T.p, T.y, s));
    }
    for (const pts of ropes) {
      const c = new THREE.Mesh(tube(pts, 0.006), K.dark);
      st.push(c);
    }
    // Döngü: alt istasyonda yukarı ray (hızlanır), halat, üst istasyonda ray (yavaşlar), tekerlek çevresi, aşağı...
    const arcPts = (c: { p: THREE.Vector2; y: number }, sgn: number, from: number, to: number) => {
      const out: THREE.Vector3[] = [];
      for (let k = 0; k <= 10; k++) {
        const f = lerp(from, to, k / 10);
        const dx = SIDE.x * Math.cos(f) + DIR.x * Math.sin(f) * sgn, dz = SIDE.y * Math.cos(f) + DIR.y * Math.sin(f) * sgn;
        out.push(v3(c.p.x + dx * R, c.y, c.p.y + dz * R));
      }
      return out;
    };
    const n0 = nodes[0], nN = nodes[nodes.length - 1];
    push(side(B.p, B.y, 1), side(n0.p, n0.y, 1), V_SLOW, V_LINE);
    this.lineFrom = segs.reduce((s, g) => s + g.len, 0);
    for (let i = 0; i < nodes.length - 1; i++) push(side(nodes[i].p, nodes[i].y, 1), side(nodes[i + 1].p, nodes[i + 1].y, 1), V_LINE, V_LINE, sagOf(nodes[i], nodes[i + 1]));
    this.lineTo = segs.reduce((s, g) => s + g.len, 0);
    push(side(nN.p, nN.y, 1), side(T.p, T.y, 1), V_LINE, V_SLOW);
    this.unloadAt = segs.reduce((s, g) => s + g.len, 0);
    const topArc = arcPts(T, 1, 0, Math.PI);
    for (let k = 1; k < topArc.length; k++) push(topArc[k - 1], topArc[k], V_SLOW, V_SLOW);
    push(side(T.p, T.y, -1), side(nN.p, nN.y, -1), V_SLOW, V_LINE);
    for (let i = nodes.length - 1; i > 0; i--) push(side(nodes[i].p, nodes[i].y, -1), side(nodes[i - 1].p, nodes[i - 1].y, -1), V_LINE, V_LINE, sagOf(nodes[i], nodes[i - 1]));
    push(side(n0.p, n0.y, -1), side(B.p, B.y, -1), V_LINE, V_SLOW);
    const botArc = arcPts(B, -1, Math.PI, 0);
    for (let k = 1; k < botArc.length; k++) push(botArc[k - 1], botArc[k], V_SLOW, V_SLOW);
    this.segs = segs;
    this.cum = [];
    let d = 0;
    for (const s of segs) {
      this.cum.push(d);
      d += s.len;
    }
    this.total = d;
  }

  // Dağ evinin çevresi: otopark, karlı çamlar, lambalar
  private buildBase(st: THREE.Object3D[]) {
    const g = new THREE.Group();
    st.push(g);
    // Otopark: yolun bittiği yerin güneyinde, yola paralel
    const E = SKI_ROAD[SKI_ROAD.length - 1], P0 = SKI_ROAD[SKI_ROAD.length - 2];
    const tl = Math.hypot(E[0] - P0[0], E[1] - P0[1]);
    const tx = (E[0] - P0[0]) / -tl, tz = (E[1] - P0[1]) / -tl; // yolun doğuya giden yönü
    const nx = -tz, nz = tx; // güney yanı
    const pc = new THREE.Vector2(E[0] + tx * 0.1 + nx * 1.27, E[1] + tz * 0.1 + nz * 1.27);
    const pry = Math.atan2(-tz, tx);
    const pf = footprint(pc.x, pc.y, pry, -1, 1, -0.65, 0.65);
    const lot = grp(g, pc.x, pf.hi, pc.y, pry);
    box(lot, 2.0, pf.hi - pf.lo + 0.1, 1.3, K.asphalt, 0, -(pf.hi - pf.lo) - 0.076, 0);
    for (const s of [-1, 1]) {
      box(lot, 2.04, 0.036, 0.024, K.concrete, 0, -0.002, s * 0.658);
      box(lot, 0.024, 0.036, 1.3, K.concrete, s * 1.008, -0.002, 0);
    }
    for (let k = 0; k <= 6; k++) box(lot, 0.012, 0.002, 0.42, K.line, -0.9 + k * 0.3, 0.024, 0.38);
    const cars: [CarKind, string][] = [['suv', '#eceff1'], ['sedan', '#c62828'], ['hatch', '#1565c0'], ['suv', '#263238'], ['van', '#f5f5f5'], ['pickup', '#2e7d32']];
    cars.forEach(([kind, color], k) => {
      if (k === 3) return; // boş yer
      const c = carModel(kind, color);
      c.position.set(-0.75 + k * 0.3, 0.052, 0.36);
      c.rotation.y = Math.PI;
      lot.add(c);
    });
    for (const sx of [-1.02, 1.02]) lampPost(lot, sx, -0.6, 0.24);
    // Kenarlarda küreme kar yığınları
    const pile = new THREE.IcosahedronGeometry(0.1, 1);
    for (const [x, z, s] of [[-1.15, 0.45, 1.2], [1.12, 0.2, 1.0], [0.4, 0.75, 1.3], [-0.5, 0.78, 1.1]]) {
      const o = mesh(lot, pile, K.snow, x, 0.0, z);
      o.scale.set(1.6 * s, 0.5 * s, 1.0 * s);
    }
    // Yürüme yollarındaki lambalar
    for (const [x, z] of [[-43.4, -11.35], [-44.25, -12.2], [-42.6, -13.0]]) lampPost(g, x, z, 0.22, ground(x, z));
    // Karlı çamlar: alanın çevresinde, yolların, pistin ve teleferik hattının dışında
    const pine = snowyPineGeo();
    const pineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const rnd = rand(29);
    const road = SKI_ROAD.map(([x, z]) => new THREE.Vector2(x, z));
    const line = [BOTTOM, TOP];
    const paths = walkPaths();
    let placed = 0;
    for (let tries = 0; tries < 900 && placed < 34; tries++) {
      const a = rnd() * Math.PI * 2, r = 2.4 + rnd() * 2.6;
      const x = -44.4 + Math.cos(a) * r, z = -12.9 + Math.sin(a) * r;
      if (polyDist(x, z, road) < 1.0 || polyDist(x, z, line) < 1.0 || skiDist(x, z) < 0.45) continue;
      if (paths.some(p => polyDist(x, z, p) < 0.4)) continue;
      const lo = local(LODGE.x, LODGE.y, LODGE_ROT, x, z);
      if (Math.abs(lo.x) < 2.2 && lo.z > -1.0 && lo.z < 2.3) continue;
      const pl = local(pc.x, pc.y, pry, x, z);
      if (Math.abs(pl.x) < 1.45 && Math.abs(pl.z) < 1.0) continue;
      const sl = local(BOTTOM.x, BOTTOM.y, HEADING, x, z);
      if (Math.abs(sl.x) < 1.6 && sl.z > -1.4 && sl.z < STN + 0.9) continue;
      const t = mesh(g, pine, pineMat, x, ground(x, z) - 0.02, z);
      t.rotation.y = rnd() * Math.PI * 2;
      t.scale.setScalar(0.85 + rnd() * 0.65);
      placed++;
    }
  }

  // Pistler: direkler, güvenlik ağları, kar makineleri
  private buildPistes(st: THREE.Object3D[]) {
    const g = new THREE.Group();
    st.push(g);
    const net = K.orange;
    SKI_RUNS.forEach((run, ri) => {
      const len = runLength(run);
      const colM = pm(RUN_COLORS[ri], 0.6);
      // Pist direkleri: iki kenarda, sağdakilerin tepesi turuncu
      const n = Math.max(4, Math.round(len / 0.85));
      for (let k = 1; k < n; k++) {
        for (const s of [-1, 1]) {
          const e = edgeAt(run, len, k / n, s * (run.w / 2 + 0.07));
          const y = ground(e.x, e.z);
          cyl(g, 0.0055, 0.0065, 0.15, colM, e.x, y - 0.01, e.z, 5);
          if (s > 0) cyl(g, 0.0062, 0.0062, 0.035, K.orange, e.x, y + 0.11, e.z, 5);
        }
      }
      // Virajların dış tarafında turuncu güvenlik ağı
      let d = 0;
      for (let k = 1; k < run.pts.length - 1; k++) {
        const [ax, az] = run.pts[k - 1], [bx, bz] = run.pts[k], [cx, cz] = run.pts[k + 1];
        d += Math.hypot(bx - ax, bz - az);
        const cross = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx);
        const out = cross > 0 ? -1 : 1;
        const pts: THREE.Vector3[] = [];
        for (let f = -0.7; f <= 0.71; f += 0.1) {
          const s = THREE.MathUtils.clamp((d + f) / len, 0.01, 0.99);
          const e = edgeAt(run, len, s, out * (run.w / 2 + 0.16));
          const p = v3(e.x, ground(e.x, e.z), e.z);
          pts.push(p);
          cyl(g, 0.003, 0.003, 0.1, K.dark, p.x, p.y - 0.01, p.z, 4);
        }
        mesh(g, ribbon(pts, 0.015, 0.085), net);
      }
      // Kar makineleri (pist kenarında, karı piste doğru savurur)
      const guns: [number, number, boolean][] = ri === 0 ? [[0.3, 1, true], [0.66, -1, false]] : ri === 1 ? [[0.45, -1, true]] : [[0.38, 1, true], [0.7, -1, false]];
      for (const [s, sd, fan] of guns) {
        const e = edgeAt(run, len, s, sd * (run.w / 2 + 0.22));
        const ry = Math.atan2(-e.nx * sd, -e.nz * sd);
        if (fan) snowGun(g, e.x, e.z, ry);
        else snowLance(g, e.x, e.z, ry);
      }
    });
  }

  // Koltuklar, oturanlar, kayakçılar, snowboardcular ve yürüyenler (çoklu çizim)
  private buildPeople() {
    const chairMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
    this.chairOpen = crowd(bake(chairModel(false)), CHAIRS, chairMat);
    this.chairClosed = crowd(bake(chairModel(true)), CHAIRS, chairMat);
    const tm = tintMat(), tl = tintLook();
    this.riderMesh = crowd(bake(figure('chair', tl)), CHAIRS * 4, tm);
    this.riderMesh.setColorAt(0, this.colors[0]);
    this.skierMesh = crowd(bake(figure('tuck', tl)), SKIERS, tm);
    this.boardMesh = crowd(bake(figure('board', tl)), BOARDERS, tm);
    this.walkerMesh = crowd(bake(figure('walk', tl)), 8, tm);
    this.root.add(this.chairOpen, this.chairClosed, this.riderMesh, this.skierMesh, this.boardMesh, this.walkerMesh);
    // Koltuklar: döngüde eşit zaman aralıklarıyla (istasyonda yavaşlayınca sıklaşır)
    const times: number[] = [0];
    for (const s of this.segs) times.push(times[times.length - 1] + this.segTime(s, s.len));
    const T = times[times.length - 1];
    let k = 0;
    for (let i = 0; i < CHAIRS; i++) {
      const want = (i / CHAIRS) * T;
      while (k < this.segs.length - 1 && times[k + 1] < want) k++;
      const seg = this.segs[k], d = this.cum[k] + this.segDist(seg, want - times[k]);
      const c: Chair = { d, k, riders: [], v: lerp(seg.v0, seg.v1, (d - this.cum[k]) / seg.len), sw: 0, sv: 0 };
      if (d < this.unloadAt) this.load(c);
      this.chairs.push(c);
    }
    // Kayakçılar ve snowboardcular
    this.runLens = SKI_RUNS.map(runLength);
    for (let i = 0; i < SKIERS + BOARDERS; i++) {
      const board = i >= SKIERS;
      const idx = board ? i - SKIERS : i;
      this.skiers.push({ run: i % SKI_RUNS.length, s: Math.random(), speed: (board ? 0.5 : 0.55) + Math.random() * 0.45, phase: Math.random() * 6, board, idx });
      (board ? this.boardMesh : this.skierMesh).setColorAt(idx, this.colors[(i * 5 + 1) % this.colors.length]);
    }
    // Yürüyenler: otopark, dağ evi ve telesiyej arasında gidip gelir
    walkPaths().forEach((path, i) => {
      const lens = [0];
      for (let k = 1; k < path.length; k++) lens.push(lens[k - 1] + path[k].distanceTo(path[k - 1]));
      const total = lens[lens.length - 1];
      this.walkers.push({ path, lens, total, s: Math.random() * total, dir: i % 2 ? 1 : -1, wait: 0, speed: 0.07 + Math.random() * 0.04, phase: Math.random() * 6 });
      this.walkerMesh.setColorAt(i, this.colors[(i * 7 + 3) % this.colors.length]);
    });
    this.walkerMesh.count = this.walkers.length;
    this.update(0);
  }

  // Bir aralığın t saniyede ve d mesafede ilişkisi (hız aralık boyunca doğrusal değişir)
  private segTime(s: Seg, d: number) {
    const a = (s.v1 - s.v0) / s.len;
    return Math.abs(a) < 1e-6 ? d / s.v0 : Math.log((s.v0 + a * d) / s.v0) / a;
  }
  private segDist(s: Seg, t: number) {
    const a = (s.v1 - s.v0) / s.len;
    return Math.min(s.len, Math.abs(a) < 1e-6 ? s.v0 * t : (s.v0 / a) * (Math.exp(a * t) - 1));
  }
  // Alt istasyonda koltuğa binenler (bazen boş gider)
  private load(c: Chair) {
    c.riders.length = 0;
    if (Math.random() < 0.22) return;
    const n = [1, 2, 2, 3, 4, 4][Math.floor(Math.random() * 6)];
    const slots = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, n);
    for (let k = 0; k < 4; k++) c.riders.push(slots.includes(k) ? Math.floor(Math.random() * this.colors.length) : -1);
  }

  update(dt: number) {
    if (!this.segs.length) return;
    this.time += dt;
    // --- Koltuklar ---
    let open = 0, closed = 0, riders = 0;
    for (const c of this.chairs) {
      let s = this.segs[c.k];
      const t0 = (c.d - this.cum[c.k]) / s.len;
      const v = lerp(s.v0, s.v1, THREE.MathUtils.clamp(t0, 0, 1));
      const prev = c.d;
      c.d += v * dt;
      if (c.d >= this.total) {
        c.d -= this.total;
        c.k = 0;
        this.load(c);
      }
      while (c.k < this.segs.length - 1 && c.d > this.cum[c.k] + this.segs[c.k].len) c.k++;
      if (prev < this.unloadAt && c.d >= this.unloadAt) c.riders.length = 0;
      s = this.segs[c.k];
      const t = THREE.MathUtils.clamp((c.d - this.cum[c.k]) / s.len, 0, 1);
      this.p.lerpVectors(s.a, s.b, t);
      this.p.y -= s.sag * Math.sin(Math.PI * t);
      // Hızlanınca ve yavaşlayınca koltuk sarkaç gibi sallanır
      if (dt > 0) {
        const acc = THREE.MathUtils.clamp((v - c.v) / dt, -0.3, 0.3);
        c.v = v;
        const h = Math.min(dt, 1 / 30); // büyük adımlarda sarkaç kararsızlaşmasın
        c.sv += (-14 * c.sw - 1.2 * c.sv - acc * 10) * h;
        c.sw = THREE.MathUtils.clamp(c.sw + c.sv * h, -0.35, 0.35);
      }
      this.e.set(c.sw, Math.atan2(s.b.x - s.a.x, s.b.z - s.a.z), 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p, this.q, this.one);
      const loaded = c.riders.some(r => r >= 0);
      const bar = loaded && c.d > this.lineFrom && c.d < this.lineTo;
      if (bar) this.chairClosed.setMatrixAt(closed++, this.m);
      else this.chairOpen.setMatrixAt(open++, this.m);
      if (loaded) {
        c.riders.forEach((col, k) => {
          if (col < 0) return;
          this.m2.makeTranslation(SEATS[k], -HANG, 0).premultiply(this.m);
          this.riderMesh.setMatrixAt(riders, this.m2);
          this.riderMesh.setColorAt(riders, this.colors[col]);
          riders++;
        });
      }
    }
    this.chairOpen.count = open;
    this.chairClosed.count = closed;
    this.riderMesh.count = riders;
    for (const im of [this.chairOpen, this.chairClosed, this.riderMesh]) im.instanceMatrix.needsUpdate = true;
    if (this.riderMesh.instanceColor) this.riderMesh.instanceColor.needsUpdate = true;

    // --- Kayakçılar: pistten zikzak çizerek iner, bitince tepeden yeniden başlar ---
    for (const sk of this.skiers) {
      sk.s += (dt * sk.speed) / this.runLens[sk.run];
      if (sk.s >= 1) {
        sk.s = 0;
        sk.run = Math.floor(Math.random() * SKI_RUNS.length);
      }
      const run = SKI_RUNS[sk.run], len = this.runLens[sk.run];
      const a = runAt(run, len, sk.s), b = runAt(run, len, Math.min(1, sk.s + 0.01));
      const fx = b.x - a.x || a.dx, fz = b.z - a.z || a.dz;
      const fl = Math.hypot(fx, fz) || 1;
      // Zikzak: pistin içinde sağa sola (başta ve sonda daha az)
      const ease = smooth(sk.s, 0, 0.06) * (1 - smooth(sk.s, 0.9, 1));
      const swing = Math.sin(this.time * 1.6 + sk.phase) * run.w * 0.32 * ease;
      const x = a.x + (-fz / fl) * swing, z = a.z + (fx / fl) * swing;
      const turn = Math.cos(this.time * 1.6 + sk.phase) * ease;
      this.p.set(x, ground(x, z) + 0.01, z);
      this.e.set(0, Math.atan2(fx, fz) + turn * 0.5, -turn * 0.25);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p, this.q, this.one);
      (sk.board ? this.boardMesh : this.skierMesh).setMatrixAt(sk.idx, this.m);
    }
    for (const im of [this.skierMesh, this.boardMesh]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }

    // --- Yürüyenler: yol boyunca gidip gelir, uçlarda biraz bekler ---
    this.walkers.forEach((w, i) => {
      if (w.wait > 0) w.wait -= dt;
      else {
        w.s += w.dir * w.speed * dt;
        if (w.s <= 0 || w.s >= w.total) {
          w.s = THREE.MathUtils.clamp(w.s, 0, w.total);
          w.dir *= -1;
          w.wait = 2 + Math.random() * 4;
        }
      }
      let k = 1;
      while (k < w.path.length - 1 && w.lens[k] < w.s) k++;
      const a = w.path[k - 1], b = w.path[k];
      const t = THREE.MathUtils.clamp((w.s - w.lens[k - 1]) / Math.max(1e-6, w.lens[k] - w.lens[k - 1]), 0, 1);
      const x = lerp(a.x, b.x, t), z = lerp(a.y, b.y, t);
      const moving = w.wait <= 0;
      const step = moving ? Math.abs(Math.sin(this.time * 7 + w.phase)) * 0.004 : 0;
      this.p.set(x, ground(x, z) + 0.012 + step, z);
      this.e.set(0, Math.atan2((b.x - a.x) * w.dir, (b.y - a.y) * w.dir), moving ? Math.sin(this.time * 7 + w.phase) * 0.03 : 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p, this.q, this.one);
      this.walkerMesh.setMatrixAt(i, this.m);
    });
    this.walkerMesh.instanceMatrix.needsUpdate = true;
  }
}
