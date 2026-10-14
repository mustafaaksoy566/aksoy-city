import * as THREE from 'three';
import { part, mat, windowMat } from './utilities';
import { mergeStatic } from './batcher';
import { PROPS } from './config';
import { signMat } from './signs';
import { carModel } from './cars';
import { pm, M, BULB, BULB_GEO, add, box, cyl, rod, item, bench, tree } from './parts';

// Tarihi yapılar ve yeni stadyum: gerçeğe benzesinler diye kafes, kemer ve koltuk dokuları kodla çizilir.
// Yerel ölçü: taban 1x1 kare (büyük yapılar sonra 2x2 / 3x3 büyütülür), y = 0 zemin, ön yüz +z.

// --- Dokular ---
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Eyfel'in demir kafesi: koyu çubuklar açık zeminde (delik yok, uzaktan da temiz görünür).
// Gece kafes çubukları altın gibi yanar ('window' adlı malzemeleri DayNight yakar).
const LATTICE = canvasTexture(64, 64, g => {
  g.fillStyle = '#b48d68';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#5a4030';
  g.lineWidth = 6;
  g.strokeRect(0, 0, 64, 64);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.stroke();
});
const LATTICE_GLOW = canvasTexture(64, 64, g => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#ffd27a';
  g.lineWidth = 4;
  g.strokeRect(0, 0, 64, 64);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.stroke();
});
const ironMat = new THREE.MeshStandardMaterial({ color: '#9a7656', map: LATTICE, emissiveMap: LATTICE_GLOW, emissive: '#000000', roughness: 0.65, metalness: 0.25 });
ironMat.name = 'window';

// Kolezyum duvarı: üç kat kemer, kemerlerin içi boş
const ARCHES = canvasTexture(128, 128, g => {
  g.fillStyle = '#e7d7b4';
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'destination-out';
  // Her katta iki kemer: yarım daire tepeli açıklıklar, aralarında kalın ayaklar
  for (let row = 0; row < 3; row++) {
    const top = 6 + row * 41;
    for (const cx of [32, 96]) {
      g.beginPath();
      g.moveTo(cx - 14, top + 36);
      g.lineTo(cx - 14, top + 18);
      g.arc(cx, top + 18, 14, Math.PI, 0);
      g.lineTo(cx + 14, top + 36);
      g.closePath();
      g.fill();
    }
  }
  g.globalCompositeOperation = 'source-over';
  // Katlar arasında saçak
  g.fillStyle = '#d4c19a';
  for (const y of [0, 43, 83, 123]) g.fillRect(0, y, 128, 5);
});
const archMat = new THREE.MeshStandardMaterial({ map: ARCHES, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });

// Doku koordinatlarını gerçek ölçüye göre büyüt (u: çevre, v: boy, cell: bir doku tekrarının boyu)
function scaleUV(geo: THREE.BufferGeometry, u: number, v: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  return geo;
}

// İki nokta arasında kare kesitli, incelen kafes ayak
function strut(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, cell: number) {
  const len = a.distanceTo(b);
  const geo = scaleUV(new THREE.CylinderGeometry(rb, ra, len, 4, 1, true), (ra + rb) * 2.8 / cell, len / cell);
  const m = new THREE.Mesh(geo, ironMat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.rotateY(Math.PI / 4);
  m.castShadow = true;
  return m;
}

// --- Eyfel Kulesi (3x3) ---
// Dört kavisli ayak birinci katta birleşir, ikinci kattan sonra tek, incelen bir kule olarak yükselir.
// Ayakların arasında süs kemerleri; çevresinde Champ de Mars gibi çim ve yollar.
function eiffel() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#7cc35f'), 0, 0.01, 0));
  st.add(part(new THREE.BoxGeometry(0.86, 0.022, 0.86), mat('#dccfb2'), 0, 0.012, 0));
  for (const s of [-1, 1]) {
    st.add(part(new THREE.BoxGeometry(0.98, 0.023, 0.07), mat('#dccfb2'), 0, 0.012, s * 0.46));
    st.add(part(new THREE.BoxGeometry(0.07, 0.023, 0.98), mat('#dccfb2'), s * 0.46, 0.012, 0));
  }
  const bronze = mat('#6e5039');
  const rail = mat('#8d6b4d');
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Bir ayak: köşeden içe doğru kavis çizen parçalar (alt geniş, üst ince)
  const leg = (sx: number, sz: number, pts: [number, number][], r0: number, r1: number) => {
    for (let k = 0; k < pts.length - 1; k++) {
      const [a0, y0] = pts[k], [a1, y1] = pts[k + 1];
      const f = k / (pts.length - 1), f2 = (k + 1) / (pts.length - 1);
      st.add(strut(V(sx * a0, y0, sz * a0), V(sx * a1, y1, sz * a1), r0 + (r1 - r0) * f, r0 + (r1 - r0) * f2, 0.045));
    }
  };
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    leg(sx, sz, [[0.38, 0], [0.33, 0.1], [0.28, 0.19], [0.235, 0.27]], 0.075, 0.05);
    leg(sx, sz, [[0.215, 0.29], [0.17, 0.42], [0.125, 0.56]], 0.046, 0.032);
    st.add(part(new THREE.BoxGeometry(0.1, 0.03, 0.1), mat('#8c7a62'), sx * 0.38, 0.015, sz * 0.38));
  }
  // Ayakların arasındaki kemerler
  for (let k = 0; k < 4; k++) {
    const arch = part(new THREE.TorusGeometry(0.255, 0.014, 6, 28, Math.PI), bronze, 0, 0.0, 0);
    arch.rotation.y = (k * Math.PI) / 2;
    arch.translateZ(0.29);
    arch.scale.set(1, 0.82, 1);
    st.add(arch);
  }
  // Birinci kat: geniş, galerili
  st.add(part(new THREE.BoxGeometry(0.54, 0.045, 0.54), bronze, 0, 0.29, 0));
  st.add(part(new THREE.BoxGeometry(0.56, 0.02, 0.56), rail, 0, 0.32, 0));
  // İkinci kat
  st.add(part(new THREE.BoxGeometry(0.29, 0.035, 0.29), bronze, 0, 0.575, 0));
  st.add(part(new THREE.BoxGeometry(0.3, 0.015, 0.3), rail, 0, 0.6, 0));
  // Üst kule: dört yüzlü, incelerek yükselen kafes; arada küçük bir kat, tepede seyir kabini ve anten
  const tower = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(0.045, 0.13, 0.55, 4, 1, true), 4, 9), ironMat);
  tower.position.y = 0.61 + 0.275;
  tower.rotation.y = Math.PI / 4;
  st.add(tower);
  st.add(part(new THREE.BoxGeometry(0.1, 0.02, 0.1), bronze, 0, 0.92, 0));
  const spire = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(0.02, 0.045, 0.42, 4, 1, true), 1.5, 7), ironMat);
  spire.position.y = 1.16;
  spire.rotation.y = Math.PI / 4;
  st.add(spire);
  st.add(part(new THREE.BoxGeometry(0.06, 0.05, 0.06), bronze, 0, 1.39, 0));
  st.add(part(new THREE.BoxGeometry(0.065, 0.012, 0.065), rail, 0, 1.415, 0));
  st.add(part(new THREE.CylinderGeometry(0.006, 0.01, 0.16, 6), mat('#d9d9d9'), 0, 1.5, 0));
  // Önde iki çim tarhı ve çiçekler
  for (const x of [-0.3, 0.3]) st.add(part(new THREE.BoxGeometry(0.22, 0.026, 0.06), mat('#5aa646'), x, 0.014, 0.44));
  g.add(mergeStatic([st]));
  const lamp = new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffd27a', emissiveIntensity: 0 });
  lamp.name = 'lamp';
  g.add(part(new THREE.SphereGeometry(0.016, 8, 6), lamp, 0, 1.585, 0));
  g.scale.y = 1.25; // daha uzun (en yüksek simge)
  return g;
}

// Pisa ve Galata kuleleri wonders.ts'te (gerçek ölçüsünde, 2x2)

// --- Kolezyum (3x3): kemerli eliptik duvar (bir yanı yıkık), içeride basamaklı oturma ve kum arena ---
function colosseum() {
  const g = new THREE.Group();
  const travertine = mat('#e3d2ad');
  g.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#d6cdb6'), 0, 0.01, 0));
  const rx = 0.44, rz = 0.36, H = 0.42;
  // Dış duvar: elips, güneydoğusu yıkık (daha alçak)
  const wall = new THREE.CylinderGeometry(1, 1, 1, 64, 4, true);
  const p = wall.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), z = p.getZ(k);
    let y = p.getY(k) + 0.5;
    const a = Math.atan2(x, z);
    const ruin = Math.max(0, Math.cos(a - 2.3)) ** 3;
    y *= 1 - ruin * 0.35 * (0.6 + 0.4 * Math.sin(a * 23));
    p.setXYZ(k, x * rx, y * H + 0.02, z * rz);
  }
  wall.computeVertexNormals();
  scaleUV(wall, 14, 1);
  const outer = new THREE.Mesh(wall, archMat);
  outer.castShadow = true;
  g.add(outer);
  // İç duvar (biraz içeride, daha alçak) ve basamaklı oturma yeri
  const inner = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), 11, 0.7), archMat);
  inner.scale.set(rx - 0.05, H * 0.7, rz - 0.05);
  inner.position.y = 0.02 + (H * 0.7) / 2;
  g.add(inner);
  const st = new THREE.Group();
  for (let k = 0; k < 5; k++) {
    const t = k / 5;
    const ring = new THREE.Shape();
    ring.absellipse(0, 0, rx - 0.05 - t * 0.12, rz - 0.05 - t * 0.12, 0, Math.PI * 2, false, 0);
    const hole = new THREE.Path();
    hole.absellipse(0, 0, rx - 0.05 - (t + 0.2) * 0.12, rz - 0.05 - (t + 0.2) * 0.12, 0, Math.PI * 2, true, 0);
    ring.holes.push(hole);
    st.add(part(new THREE.ExtrudeGeometry(ring, { depth: 0.02, bevelEnabled: false, curveSegments: 40 }).rotateX(-Math.PI / 2), k % 2 ? travertine : mat('#d7c49c'), 0, 0.3 - k * 0.05, 0));
  }
  // Arena: kum zemin ve altındaki odaların izleri
  const arena = new THREE.Shape();
  arena.absellipse(0, 0, rx - 0.17, rz - 0.17, 0, Math.PI * 2, false, 0);
  st.add(part(new THREE.ExtrudeGeometry(arena, { depth: 0.01, bevelEnabled: false, curveSegments: 40 }).rotateX(-Math.PI / 2), mat('#d8b77a'), 0, 0.03, 0));
  for (let k = -3; k <= 3; k++) st.add(part(new THREE.BoxGeometry(0.004, 0.003, 0.3), mat('#a58552'), k * 0.04, 0.042, 0));
  g.add(mergeStatic([st]));
  return g;
}

// --- Gize Piramitleri (4x4): büyük piramit, ortanca piramit (tepesinde kaplama taşı kalmış), küçük piramit ve Sfenks ---
// Kumtaşı yüzlerde taş sıraları dokusu; çevresi kum, birkaç palmiye.
const COURSES = canvasTexture(64, 64, g => {
  g.fillStyle = '#ddbd80';
  g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 8) {
    g.fillStyle = '#c4a067';
    g.fillRect(0, y, 64, 2);
    for (let x = (y / 8) % 2 ? 8 : 0; x < 64; x += 16) g.fillRect(x, y, 2, 8);
  }
});
const sandstone = new THREE.MeshStandardMaterial({ color: '#ffffff', map: COURSES, roughness: 0.95, flatShading: true });

function pyramidShape(base: number, h: number, x: number, z: number, cap?: THREE.Material) {
  const geo = new THREE.ConeGeometry(base / Math.SQRT2, h, 4, 1, true).rotateY(Math.PI / 4);
  scaleUV(geo, base * 10, h * 12);
  const m = new THREE.Mesh(geo, sandstone);
  m.position.set(x, 0.02 + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  const g = new THREE.Group();
  g.add(m);
  if (cap) {
    // Tepede kalan beyaz kaplama taşları
    const ch = h * 0.18;
    g.add(part(new THREE.ConeGeometry((base * 0.18) / Math.SQRT2 + 0.003, ch, 4).rotateY(Math.PI / 4), cap, x, 0.02 + h - ch / 2 + 0.002, z));
  }
  return g;
}

function pyramid() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#e8d09a'), 0, 0.01, 0));
  // Kum tepecikleri
  for (const [x, z, r] of [[0.38, -0.38, 0.08], [-0.42, 0.1, 0.06], [0.1, 0.44, 0.05]] as [number, number, number][]) {
    st.add(part(new THREE.SphereGeometry(r, 10, 6).scale(1.6, 0.25, 1), mat('#e2c88e'), x, 0.02, z));
  }
  st.add(pyramidShape(0.62, 0.52, -0.13, -0.12));
  st.add(pyramidShape(0.4, 0.36, 0.27, 0.22, mat('#efe3c4')));
  st.add(pyramidShape(0.2, 0.16, -0.33, 0.33));
  // Sfenks: yatan aslan gövdesi, başı ve ön patileri
  const lime = mat('#d2b47c');
  st.add(part(new THREE.BoxGeometry(0.05, 0.035, 0.12), lime, 0.02, 0.038, 0.4));
  st.add(part(new THREE.BoxGeometry(0.04, 0.045, 0.035), lime, 0.02, 0.07, 0.45));
  st.add(part(new THREE.BoxGeometry(0.05, 0.03, 0.02), mat('#3f6aa8'), 0.02, 0.085, 0.442));
  for (const s of [-1, 1]) st.add(part(new THREE.BoxGeometry(0.012, 0.012, 0.05), lime, 0.02 + s * 0.016, 0.026, 0.47));
  g.add(mergeStatic([st]));
  return g;
}

// ======================= Stadyum (3x3): AKSOY ARENA =======================
// Yuvarlatılmış dikdörtgen kase: alt ve üst tribün (kırmızı mozaik koltuklar, üst sıralara doğru beyaza döner;
// merdiven yolları, kale arkasında dolu taraftar tribünü, köşede mavi-sarı misafir tribünü), arada camlı loca kuşağı
// ve LED reklam bandı; koltuklarda renk renk seyirciler. Sahanın üstü açık: tribünleri beyaz çelik kafes kirişli,
// yarı saydam konsol çatı örter; çatının iç kenarında gece yanan ışık halkası, iki uçta dev ekran.
// Çizgili çim saha (bütün çizgiler), fileli kaleler, köşe bayrakları, reklam panoları, yedek kulübeleri, oyuncu tüneli
// ve maçtaki oyuncular. Dışta kırmızı baklava desenli cephe (gece kırmızı yanar), zemin katta cam ve sütunlar,
// köşelerde sarmal rampalı merdiven kuleleri, kapılar, dört ışık direği, önde ve arkada "AKSOY ARENA" yazısı.
// Önde meydan: cam giriş holü, turnikeler, bilet gişeleri, futbolcu heykeli, bayraklar, çimenler, ağaçlar, lambalar
// ve taraftarlar; yanlarda takım otobüsü ve yayın aracı, arkada otopark. Ön yüz (+z) yola bakar.

type P3 = [number, number, number];
type UV4 = [number, number, number, number];
const col3 = (hex: string) => new THREE.Color(hex);
const hash2 = (a: number, b: number) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);

// Dörtgen toplayıcı: binlerce küçük yüzey (koltuk sıraları, seyirciler, kirişler) tek geometride birikir.
// Her yüzün rengi köşelere yazılır; yüzün bakacağı yön 'hint' ile verilir (ters dizildiyse köşeler çevrilir).
class Quads {
  private pos: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  quad(a: P3, b: P3, c: P3, d: P3, color: THREE.Color, hint: P3, uv: UV4 = [0, 1, 0, 1]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * hint[0] + (uz * vx - ux * vz) * hint[1] + (ux * vy - uy * vx) * hint[2] < 0;
    const t: [number, number][] = [[uv[0], uv[2]], [uv[1], uv[2]], [uv[1], uv[3]], [uv[0], uv[3]]];
    const p = flip ? [a, d, c, b] : [a, b, c, d];
    const w = flip ? [t[0], t[3], t[2], t[1]] : t;
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.col.push(color.r, color.g, color.b);
      this.uv.push(w[i][0], w[i][1]);
    }
  }
  // Kutu (alt yüzü çizilmez): c taban ortası, ry y ekseninde dönüş (yerel +z ön yüz).
  // faces: 1 üst, 2 ön, 4 arka, 8 sağ, 16 sol
  box(c: P3, w: number, h: number, d: number, ry: number, side: THREE.Color, top = side, faces = 31) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const P = (x: number, y: number, z: number): P3 => [c[0] + x * cs + z * sn, c[1] + y, c[2] - x * sn + z * cs];
    const x = w / 2, z = d / 2;
    if (faces & 1) this.quad(P(-x, h, -z), P(x, h, -z), P(x, h, z), P(-x, h, z), top, [0, 1, 0]);
    if (faces & 2) this.quad(P(-x, 0, z), P(x, 0, z), P(x, h, z), P(-x, h, z), side, [sn, 0, cs]);
    if (faces & 4) this.quad(P(-x, 0, -z), P(x, 0, -z), P(x, h, -z), P(-x, h, -z), side, [-sn, 0, -cs]);
    if (faces & 8) this.quad(P(x, 0, -z), P(x, 0, z), P(x, h, z), P(x, h, -z), side, [cs, 0, -sn]);
    if (faces & 16) this.quad(P(-x, 0, -z), P(-x, 0, z), P(-x, h, z), P(-x, h, -z), side, [-cs, 0, sn]);
  }
  // İki nokta arasında kare kesitli ince çubuk (uçları açık)
  bar(a: P3, b: P3, r: number, color: THREE.Color) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const u = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? AX_X : AX_Y).normalize();
    const v = new THREE.Vector3().crossVectors(d, u);
    const off = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => u.clone().multiplyScalar(i * r).addScaledVector(v, j * r));
    const at = (p: P3, o: THREE.Vector3): P3 => [p[0] + o.x, p[1] + o.y, p[2] + o.z];
    for (let i = 0; i < 4; i++) {
      const o = off[i], o2 = off[(i + 1) % 4];
      this.quad(at(a, o), at(a, o2), at(b, o2), at(b, o), color, [o.x + o2.x, o.y + o2.y, o.z + o2.z]);
    }
  }
  mesh(m: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return new THREE.Mesh(g, m);
  }
}

// Kase: köşe yayları (±cx, ±cz) merkezli yuvarlatılmış dikdörtgen; R kenardan dışarı uzaklık.
// Her R'de aynı numaralı nokta aynı yöne bakar, böylece basamaklar her yerde aynı derinlikte olur.
const BOWL = { z: -0.06, cx: 0.175, cz: 0.105 };
const R_GRASS = 0.06; // çim kenarı (alt tribünün ön duvarı)
const R_FACE = 0.235; // dış cephe
// Tribün basamakları: alt kat 7, üst kat 8 sıra (üst kat daha dik)
const NL = 7, DL = 0.0095, HL = 0.0072, Y0 = 0.052;
const NU = 8, DU = 0.0115, HU = 0.0102;
interface RimPt { bx: number; bz: number; nx: number; nz: number }
// Çevre noktaları: kısa kenarlar 6, uzun kenarlar 10, her köşe yayı 10 parça (toplam 72).
// Sıra: +x kenarı (0-5), köşe, ön kenar (16-25), köşe, -x kenarı (36-41), köşe, arka kenar (52-61), köşe (62-71)
const RIM: RimPt[] = (() => {
  const { cx, cz } = BOWL;
  const from = [[cx, -cz], [cx, cz], [-cx, cz], [-cx, -cz]];
  const to = [[cx, cz], [-cx, cz], [-cx, -cz], [cx, -cz]];
  const segs = [6, 10, 6, 10];
  const out: RimPt[] = [];
  for (let s = 0; s < 4; s++) {
    const th = (s * Math.PI) / 2;
    for (let i = 0; i < segs[s]; i++) {
      const f = i / segs[s];
      out.push({ bx: from[s][0] + (to[s][0] - from[s][0]) * f, bz: from[s][1] + (to[s][1] - from[s][1]) * f, nx: Math.cos(th), nz: Math.sin(th) });
    }
    for (let i = 0; i < 10; i++) {
      const a = th + (i / 10) * (Math.PI / 2);
      out.push({ bx: to[s][0], bz: to[s][1], nx: Math.cos(a), nz: Math.sin(a) });
    }
  }
  return out;
})();
const NS = RIM.length;
const rimAt = (k: number, R: number, y: number): P3 => {
  const p = RIM[k % NS];
  return [p.bx + R * p.nx, y, BOWL.z + p.bz + R * p.nz];
};
// Doku koordinatı: verilen R'de çevre boyunca uzunluk, dikiş yerinde desen kaymasın diye tam sayıda tekrar
function rimU(R: number, tile: number) {
  const L = [0];
  for (let k = 0; k < NS; k++) {
    const a = rimAt(k, R, 0), b = rimAt(k + 1, R, 0);
    L.push(L[k] + Math.hypot(b[0] - a[0], b[2] - a[2]));
  }
  const n = Math.max(1, Math.round(L[NS] / tile));
  return L.map(l => (l / L[NS]) * n);
}
// Kesit çizgisini (R, y) kase boyunca süpür. Kesit dışa giderse yüz yukarı, yukarı giderse sahaya,
// aşağı giderse dışarı, içe giderse aşağı bakar.
function sweep(q: Quads, prof: [number, number][], color: (k: number, j: number) => THREE.Color, uv?: (k: number, j: number) => UV4) {
  for (let k = 0; k < NS; k++) {
    const p = RIM[k], p2 = RIM[(k + 1) % NS];
    const nl = Math.hypot(p.nx + p2.nx, p.nz + p2.nz);
    const mx = (p.nx + p2.nx) / nl, mz = (p.nz + p2.nz) / nl;
    for (let j = 0; j + 1 < prof.length; j++) {
      const [ra, ya] = prof[j], [rb, yb] = prof[j + 1];
      q.quad(rimAt(k, ra, ya), rimAt(k + 1, ra, ya), rimAt(k + 1, rb, yb), rimAt(k, rb, yb), color(k, j), [(ya - yb) * mx, rb - ra, (ya - yb) * mz], uv?.(k, j));
    }
  }
}

// --- Stadyum dokuları ---
// Saha: biçilmiş çim şeritleri, kale önlerinde yıpranmış çim ve gerçek oranlarda bütün çizgiler
const PITCH_W = 0.47, PITCH_D = 0.33; // çim alanı (tribün ön duvarları arası)
const PITCH = canvasTexture(640, 448, g => {
  const W = 640, H = 448, k = W / PITCH_W;
  const X = (x: number) => W / 2 + x * k, Y = (z: number) => H / 2 + z * k;
  const L = 0.2, T = 0.13, r9 = 0.0349; // saha yarı boyu, yarı eni, 9.15 m
  const sw = (2 * L) / 14;
  for (let i = -3; i < 17; i++) {
    g.fillStyle = Math.abs(i) % 2 ? '#4d9b43' : '#5aaa4e';
    g.fillRect(X(-L + i * sw), 0, sw * k + 1, H);
  }
  for (const sd of [-1, 1]) {
    const gr = g.createRadialGradient(X(sd * 0.188), Y(0), 2, X(sd * 0.188), Y(0), 34);
    gr.addColorStop(0, 'rgba(160,140,90,0.5)');
    gr.addColorStop(1, 'rgba(160,140,90,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  }
  g.strokeStyle = '#f4f7f2';
  g.fillStyle = '#f4f7f2';
  g.lineWidth = 3;
  g.strokeRect(X(-L), Y(-T), 2 * L * k, 2 * T * k);
  g.beginPath();
  g.moveTo(X(0), Y(-T));
  g.lineTo(X(0), Y(T));
  g.stroke();
  g.beginPath();
  g.arc(X(0), Y(0), r9 * k, 0, Math.PI * 2);
  g.stroke();
  const spot = (x: number) => {
    g.beginPath();
    g.arc(X(x), Y(0), 3, 0, Math.PI * 2);
    g.fill();
  };
  spot(0);
  for (const sd of [-1, 1]) {
    // Ceza alanı (16,5 m), kale alanı (5,5 m), penaltı noktası (11 m) ve yayı
    g.strokeRect(Math.min(X(sd * L), X(sd * (L - 0.063))), Y(-0.077), 0.063 * k, 0.154 * k);
    g.strokeRect(Math.min(X(sd * L), X(sd * (L - 0.021))), Y(-0.035), 0.021 * k, 0.07 * k);
    const pen = sd * (L - 0.042);
    spot(pen);
    const a = Math.acos(0.021 / r9);
    g.beginPath();
    g.arc(X(pen), Y(0), r9 * k, sd > 0 ? Math.PI - a : -a, sd > 0 ? Math.PI + a : a);
    g.stroke();
  }
  // Köşe yayları (sahanın içinde kalan çeyrekler)
  g.save();
  g.beginPath();
  g.rect(X(-L), Y(-T), 2 * L * k, 2 * T * k);
  g.clip();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.beginPath();
      g.arc(X(sx * L), Y(sz * T), 6, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.restore();
});
// Kale filesi: şeffaf zeminde beyaz ağ
const NET = canvasTexture(64, 64, g => {
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 1; i < 64; i += 8) {
    g.moveTo(i, 0);
    g.lineTo(i, 64);
    g.moveTo(0, i);
    g.lineTo(64, i);
  }
  g.stroke();
});
// Cephe kaplaması: kırmızı (ortası şişkin) paneller üstünde beyaz baklava kafes; gece paneller kırmızı yanar
const diagrid = (g: CanvasRenderingContext2D, color: string, width: number) => {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(128, 128);
  g.moveTo(128, 0);
  g.lineTo(0, 128);
  g.stroke();
};
const SKIN = canvasTexture(128, 128, g => {
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#d23232');
  gr.addColorStop(1, '#a81e1e');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,0.13)';
  for (const [cx, cy] of [[64, 0], [0, 64], [128, 64], [64, 128]]) {
    g.beginPath();
    g.moveTo(cx, cy - 34);
    g.lineTo(cx + 34, cy);
    g.lineTo(cx, cy + 34);
    g.lineTo(cx - 34, cy);
    g.fill();
  }
  diagrid(g, '#f5f5f2', 10);
});
const SKIN_GLOW = canvasTexture(128, 128, g => {
  g.fillStyle = '#8c1a20';
  g.fillRect(0, 0, 128, 128);
  diagrid(g, '#000000', 12);
});
// Saha kenarı ve loca kuşağındaki LED reklam panoları
const ADS = canvasTexture(512, 32, g => {
  const list: [string, string, string][] = [['#c62828', '#ffffff', 'AKSOY'], ['#0d47a1', '#ffffff', 'CITY'], ['#fdd835', '#1b1b1b', 'GOL!'], ['#2e7d32', '#ffffff', 'SPOR']];
  g.font = 'bold 22px ui-rounded, system-ui, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  list.forEach(([bg, fg, t], i) => {
    g.fillStyle = bg;
    g.fillRect(i * 128, 0, 128, 32);
    g.fillStyle = fg;
    g.fillText(t, i * 128 + 64, 17);
  });
});
// Dev ekran: takımlar, skor ve dakika
const SCREEN = canvasTexture(256, 128, g => {
  g.fillStyle = '#0b1222';
  g.fillRect(0, 0, 256, 128);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 22px ui-rounded, system-ui, Arial, sans-serif';
  for (const [x, bg, t] of [[10, '#c62828', 'AKSOY'], [150, '#1565c0', 'KONUK']] as [number, string, string][]) {
    g.fillStyle = bg;
    g.fillRect(x, 10, 96, 32);
    g.fillStyle = '#ffffff';
    g.fillText(t, x + 48, 27);
  }
  g.font = 'bold 46px ui-rounded, system-ui, Arial, sans-serif';
  g.fillStyle = '#ffffff';
  g.fillText('2 - 1', 128, 78);
  g.font = 'bold 20px ui-rounded, system-ui, Arial, sans-serif';
  g.fillStyle = '#ffd54f';
  g.fillText('67:12', 128, 113);
});

// --- Stadyum malzemeleri ---
// Gece yanan ('lamp') malzeme; dokuluysa rengini emissiveMap verir
const glowing = (m: THREE.MeshStandardMaterial) => {
  m.name = 'lamp';
  return m;
};
const STAND_VC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
const FLOOD = glowing(new THREE.MeshStandardMaterial({ color: '#e8eef3', emissive: '#000000', roughness: 0.35 }));
const ROOF_CLEAR = new THREE.MeshStandardMaterial({ color: '#f1f5f9', transparent: true, opacity: 0.42, roughness: 0.2, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
const PITCH_MAT = new THREE.MeshStandardMaterial({ map: PITCH, roughness: 0.95 });
const NET_MAT = new THREE.MeshStandardMaterial({ map: NET, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9 });
const SKIN_MAT = glowing(new THREE.MeshStandardMaterial({ map: SKIN, emissiveMap: SKIN_GLOW, emissive: '#000000', roughness: 0.5, metalness: 0.15 }));
const ADS_MAT = glowing(new THREE.MeshStandardMaterial({ map: ADS, emissiveMap: ADS, emissive: '#000000', roughness: 0.5 }));
const SCREEN_MAT = glowing(new THREE.MeshStandardMaterial({ map: SCREEN, emissiveMap: SCREEN, emissive: '#000000', roughness: 0.4 }));
const AM = {
  plaza: pm('#cfd3d8', 0.95),
  walk: pm('#e4dfd4', 0.95),
  granite: pm('#8e959d', 0.6),
  asphalt: pm('#4b5058', 0.95),
  red: pm('#c62828', 0.55),
  glassDark: pm('#22303c', 0.25, 0.4),
  tyre: pm('#1d1f22', 0.9),
  bronze: pm('#a07a48', 0.4, 0.6),
  mast: pm('#b8c1ca', 0.4, 0.6),
  core: pm('#d9dde2', 0.9),
  dark: pm('#1f262d', 0.6),
};
// Köşe renkleri
const SC = {
  white: col3('#f7f8f9'), wall: col3('#2f3b45'), concrete: col3('#b9c0c7'), back: col3('#d5dade'), cap: col3('#e9edf0'),
  soffit: col3('#c3cad1'), dark: col3('#2b333b'), steps: col3('#a7afb8'), seatWhite: col3('#eef1f3'), granite: col3('#9aa1a9'),
  roofTop: col3('#f4f6f8'), roofUnder: col3('#cfd5db'), steel: col3('#f0f3f6'), steel2: col3('#d6dce2'),
  ramp: col3('#dfe3e7'), rampUnder: col3('#b4bcc4'), red: col3('#d32f2f'), blue: col3('#1e88e5'), navy: col3('#1f2b4d'),
  yellow: col3('#fdd835'), green: col3('#43a047'),
};
const SEAT_RED = ['#c62828', '#b71c1c', '#d32f2f'].map(col3);
const SEAT_AWAY = ['#1565c0', '#0d47a1', '#1565c0', '#fbc02d'].map(col3);
const SHIRTS = ['#d32f2f', '#c62828', '#e53935', '#fafafa', '#d32f2f', '#263238', '#1e88e5', '#ffb300', '#fafafa', '#b71c1c', '#c62828', '#455a64'].map(col3);
const AWAY_SHIRTS = ['#1565c0', '#1e88e5', '#fdd835', '#0d47a1'].map(col3);
const HAIRS = ['#2b1d14', '#161616', '#5a3825', '#c99a4e', '#8d8d8d', '#3b2a1e'].map(col3);
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524'].map(col3);
const FAN_TOPS = [AM.red, M.white, AM.red, pm('#b71c1c', 0.6), M.navy, AM.red, pm('#fafafa', 0.6)];
const FAN_LEGS = [M.navy, pm('#3d4450'), pm('#c2a77e'), pm('#1d1f24')];
const FAN_SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524'].map(c => pm(c));
const FAN_HAIR = ['#2b1d14', '#5a3825', '#161616', '#c99a4e'].map(c => pm(c, 0.9));

// Koltuk renkleri: merdiven yolları gri, köşede misafir tribünü mavi-sarı, ev sahibi kırmızı (üst katta yukarı doğru beyaza döner)
const aisle = (k: number) => k % 9 === 4;
const awayEnd = (k: number) => k >= 63 && k <= 70;
const ultras = (k: number) => k >= 36 && k < 42;
function seatColor(k: number, row: number, upper: boolean) {
  if (aisle(k)) return SC.steps;
  const h = hash2(k + (upper ? 97 : 0), row);
  if (!upper && awayEnd(k)) return SEAT_AWAY[Math.floor(h * SEAT_AWAY.length)];
  const fade = upper ? 0.08 + 0.7 * (row / (NU - 1)) ** 1.8 : 0.05;
  return h < fade ? SC.seatWhite : SEAT_RED[Math.floor(hash2(row + 31, k) * SEAT_RED.length)];
}
const dim = (c: THREE.Color) => c.clone().multiplyScalar(0.62);

// Takım otobüsü (şehirdeki boyda, önü +z): kırmızı gövde, koyu camlar, beyaz şerit ve tavan, yanında yazı
function teamBus(g: THREE.Object3D, x: number, z: number, rot: number, s: number) {
  const b = item(g, x, z, rot, s);
  box(b, 0.22, 0.1, 0.6, AM.red, 0, 0.04, 0);
  box(b, 0.224, 0.085, 0.604, AM.glassDark, 0, 0.14, 0);
  box(b, 0.22, 0.03, 0.6, M.white, 0, 0.225, 0);
  box(b, 0.226, 0.012, 0.59, M.white, 0, 0.122, 0);
  box(b, 0.228, 0.04, 0.16, signMat('AKSOY ARENA', '#b71c1c'), 0, 0.065, 0);
  for (const wz of [-0.19, 0.19]) box(b, 0.232, 0.075, 0.085, AM.tyre, 0, 0, wz);
  for (const wx of [-0.07, 0.07]) box(b, 0.04, 0.016, 0.004, BULB, wx, 0.06, 0.301);
}
// Yayın aracı: beyaz kasa, mavi şerit, kabin, çatıda uydu çanağı
function tvTruck(g: THREE.Object3D, x: number, z: number, rot: number, s: number) {
  const v = item(g, x, z, rot, s);
  box(v, 0.2, 0.19, 0.42, M.white, 0, 0.045, -0.07);
  box(v, 0.204, 0.025, 0.424, M.blue, 0, 0.1, -0.07);
  box(v, 0.19, 0.12, 0.13, M.white, 0, 0.045, 0.21);
  box(v, 0.17, 0.045, 0.006, AM.glassDark, 0, 0.11, 0.274);
  for (const wz of [-0.2, 0, 0.2]) box(v, 0.21, 0.06, 0.07, AM.tyre, 0, 0, wz);
  rod(v, [0.03, 0.235, -0.15], [0.03, 0.27, -0.15], 0.006, M.gray, 5);
  const dish = add(v, new THREE.CylinderGeometry(0.055, 0.012, 0.018, 12), M.white, 0.03, 0.285, -0.15);
  dish.rotation.set(0.7, 0, 0.3);
}
// Meydan lambası: ince direk, yassı LED başlık (gece yanar)
function plazaLamp(g: THREE.Object3D, x: number, z: number, s: number) {
  const l = item(g, x, z, 0, s);
  cyl(l, 0.008, 0.01, 0.01, M.iron, 0, 0, 0, 6);
  rod(l, [0, 0, 0], [0, 0.2, 0], 0.004, M.iron, 5);
  box(l, 0.05, 0.006, 0.018, M.iron, 0, 0.2, 0);
  box(l, 0.044, 0.003, 0.014, BULB, 0, 0.197, 0);
}
// Taraftar (şehirdeki boyda): bacaklar, forma, baş ve saç; k renk seçimi, yüzü +z
function fanFigure(g: THREE.Object3D, x: number, z: number, rot: number, s: number, k: number) {
  const f = item(g, x, z, rot, s);
  const legs = FAN_LEGS[k % FAN_LEGS.length];
  for (const sx of [-0.0085, 0.0085]) box(f, 0.014, 0.07, 0.017, legs, sx, 0, 0);
  box(f, 0.036, 0.052, 0.022, FAN_TOPS[(k * 3 + 1) % FAN_TOPS.length], 0, 0.07, 0);
  box(f, 0.02, 0.024, 0.021, FAN_SKIN[k % FAN_SKIN.length], 0, 0.122, 0);
  box(f, 0.021, 0.008, 0.022, FAN_HAIR[(k * 5 + 2) % FAN_HAIR.length], 0, 0.14, -0.001);
}
// Bayrak direği ve dalgalanan, iki yüzlü bayrak (üç şerit: a b a)
function flagPole(g: THREE.Object3D, q: Quads, x: number, z: number, s: number, a: THREE.Color, b: THREE.Color) {
  const top = 0.03 + 0.3 * s;
  rod(g, [x, 0.03, z], [x, top + 0.004, z], 0.0016, M.steel, 5);
  box(g, 0.005, 0.003, 0.005, M.gold, x, top + 0.004, z);
  const wave = [0, 0.004, -0.002, 0.003];
  for (let i = 0; i < 3; i++) {
    const x0 = x + i * 0.012, x1 = x0 + 0.012, z0 = z + wave[i], z1 = z + wave[i + 1];
    for (const e of [-1, 1]) q.quad([x0, top, z0], [x1, top, z1], [x1, top - 0.024, z1], [x0, top - 0.024, z0], i === 1 ? b : a, [0, 0, e]);
  }
}
// Futbolcu heykeli: granit kaide üstünde topa vuran bronz oyuncu
function footballerStatue(g: THREE.Object3D, x: number, z: number, s: number) {
  box(g, 0.034, 0.03, 0.034, M.granite, x, 0.03, z);
  box(g, 0.038, 0.004, 0.038, M.rim, x, 0.06, z);
  const f = item(g, x, z, -0.4, s * 1.5, 0.064);
  const br = AM.bronze;
  rod(f, [-0.008, 0.075, 0], [-0.008, 0, -0.005], 0.0065, br, 6);
  rod(f, [0.008, 0.075, 0], [0.01, 0.03, 0.045], 0.0065, br, 6);
  box(f, 0.034, 0.05, 0.02, br, 0, 0.07, 0).rotation.x = -0.15;
  add(f, new THREE.SphereGeometry(0.011, 8, 6), br, 0, 0.134, 0.004);
  rod(f, [-0.018, 0.115, 0], [-0.04, 0.08, -0.02], 0.004, br, 5);
  rod(f, [0.018, 0.115, 0], [0.042, 0.095, 0.02], 0.004, br, 5);
  add(f, new THREE.SphereGeometry(0.012, 8, 6), br, 0.01, 0.014, 0.068);
}

function stadium() {
  const st = new THREE.Group();
  const s = 1 / (5 * 0.96); // 5x5: taraftar, otobüs ve arabalar gerçek boyunda
  const W = SC.white;
  // Birikmiş yüzeyler: köşe renkli parçalar, camlar, ışıklar, saydam çatı, cephe, LED panolar, fileler
  const q = new Quads(), glass = new Quads(), lights = new Quads(), clear = new Quads(), skin = new Quads(), led = new Quads(), nets = new Quads();
  const zF = BOWL.z + BOWL.cz + R_FACE; // ön cephe
  const zB = BOWL.z - BOWL.cz - R_FACE; // arka cephe

  // --- Zemin: meydan taşı, kasenin çevresinde granit kuşak ---
  box(st, 0.98, 0.03, 0.98, AM.plaza, 0, 0, 0);
  sweep(q, [[R_FACE + 0.001, 0.032], [0.27, 0.032]], () => SC.granite);

  // --- Saha, reklam panoları, alt tribünün ön duvarı ---
  add(st, new THREE.PlaneGeometry(PITCH_W, PITCH_D).rotateX(-Math.PI / 2), PITCH_MAT, 0, 0.0335, BOWL.z);
  const uAd = rimU(0.05, 0.136);
  sweep(led, [[0.05, 0.0335], [0.05, 0.042]], () => W, k => [uAd[k], uAd[k + 1], 0, 1]);
  sweep(q, [[0.05, 0.042], [0.053, 0.042], [0.053, 0.0335]], () => SC.dark);
  sweep(q, [[R_GRASS, 0.0335], [R_GRASS, Y0]], () => SC.wall);

  // --- Alt tribün: basamaklar (oturak ve önündeki koltuk sırtları) ---
  const rL = (i: number) => R_GRASS + i * DL, yL = (i: number) => Y0 + i * HL;
  for (let i = 0; i < NL; i++) {
    const prof: [number, number][] = [[rL(i), yL(i)], [rL(i + 1), yL(i)]];
    if (i < NL - 1) prof.push([rL(i + 1), yL(i + 1)]);
    sweep(q, prof, (k, j) => (j ? dim(seatColor(k, i, false)) : seatColor(k, i, false)));
  }
  // Loca kuşağı: yürüyüş yolu, cam localar (gece yanar), LED reklam bandı
  const RC = rL(NL), RU = RC + 0.007, YG = yL(NL - 1), YU = YG + 0.034;
  const rU = (j: number) => RU + j * DU, yU = (j: number) => YU + j * HU;
  sweep(q, [[RC, YG], [RU, YG]], () => SC.concrete);
  sweep(glass, [[RU, YG], [RU, YG + 0.026]], () => W);
  const uLed = rimU(RU, 0.136);
  sweep(led, [[RU, YG + 0.026], [RU, YU]], () => W, k => [uLed[k], uLed[k + 1], 0, 1]);
  // --- Üst tribün; en arkada duvar, cephenin tepesi ve saçak ---
  for (let j = 0; j < NU; j++) {
    const last = j === NU - 1;
    sweep(q, [[rU(j), yU(j)], [rU(j + 1), yU(j)], [rU(j + 1), last ? 0.25 : yU(j + 1)]], (k, e) =>
      e === 0 ? seatColor(k, j, true) : last ? SC.back : dim(seatColor(k, j, true)));
  }
  sweep(q, [[rU(NU), 0.25], [0.247, 0.25], [0.247, 0.243], [R_FACE, 0.243]], (_k, e) => (e === 0 ? SC.cap : e === 1 ? W : SC.soffit));

  // --- Seyirciler: koltuklarda oturan küçük renkli insanlar (üstten saç ya da omuz, önden forma).
  // Yanları ve arkası komşu seyirciler ve arka sıranın basamağıyla örtülür, çizilmez ---
  const crowd = (ra: number, d: number, y: number, row: number, upper: boolean) => {
    for (let k = 0; k < NS; k++) {
      if (aisle(k)) continue;
      const a = rimAt(k, ra + d * 0.56, y), b = rimAt(k + 1, ra + d * 0.56, y);
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.0085));
      const p = RIM[k], p2 = RIM[(k + 1) % NS];
      const away = !upper && awayEnd(k);
      const fill = upper ? 0.2 : away ? 0.62 : ultras(k) ? 0.75 : 0.36;
      const pal = away ? AWAY_SHIRTS : SHIRTS;
      for (let i = 0; i < n; i++) {
        const h = hash2(k * 13.7 + i * 3.1 + (upper ? 500 : 0), row * 7.3 + i);
        if (h > fill) continue;
        const t = (i + 0.5) / n;
        const fx = -(p.nx + (p2.nx - p.nx) * t), fz = -(p.nz + (p2.nz - p.nz) * t);
        const shirt = pal[Math.floor(hash2(i + row * 11, k * 5.7) * pal.length)];
        const top = h < fill * 0.45 ? shirt : HAIRS[Math.floor(hash2(k + i * 0.7, row + 3.3) * HAIRS.length)];
        q.box([a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t], 0.0056, 0.0085, 0.0046, Math.atan2(fx, fz), shirt, top, 3);
      }
    }
  };
  for (let i = 0; i < NL; i++) crowd(rL(i), DL, yL(i), i, false);
  for (let j = 0; j < NU; j++) crowd(rU(j), DU, yU(j), j, true);

  // --- Dış cephe: baklava desenli kaplama, beyaz kuşak, zemin katta cam ve sütunlar ---
  const uSkin = rimU(R_FACE, 0.0815);
  sweep(skin, [[R_FACE, 0.243], [R_FACE, 0.08]], () => W, k => [uSkin[k], uSkin[k + 1], 2, 0]);
  sweep(q, [[R_FACE, 0.08], [0.24, 0.08], [0.24, 0.072], [0.226, 0.072]], (_k, e) => (e === 2 ? SC.soffit : W));
  sweep(glass, [[0.226, 0.072], [0.226, 0.03]], () => W);
  for (let k = 0; k < NS; k += 2) q.bar(rimAt(k, 0.231, 0.03), rimAt(k, 0.231, 0.072), 0.0026, W);
  // Yan ve arka kapılar: beyaz çerçeve, koyu kapı boşluğu, kırmızı alın bandı
  for (const k of [3, 39, 57]) {
    const ry = Math.atan2(RIM[k].nx, RIM[k].nz);
    q.box(rimAt(k, R_FACE + 0.004, 0.03), 0.064, 0.064, 0.012, ry, W);
    q.box(rimAt(k, R_FACE + 0.0105, 0.03), 0.04, 0.046, 0.002, ry, SC.dark);
    q.box(rimAt(k, R_FACE + 0.0105, 0.082), 0.05, 0.008, 0.002, ry, SC.red);
  }

  // --- Çatı: dışta beyaz kuşak, içe doğru yarı saydam örtü, iç kenarda ışık halkası ---
  const yT = (R: number) => 0.272 + (0.247 - R) * 0.09; // çatının üstü (içe doğru hafif yükselir)
  sweep(q, [[0.205, yT(0.205)], [0.252, yT(0.252)], [0.252, yT(0.252) - 0.012], [0.205, yT(0.205) - 0.012], [0.205, yT(0.205)]],
    (_k, e) => (e === 0 ? SC.roofTop : e === 1 ? W : e === 2 ? SC.roofUnder : SC.cap));
  sweep(clear, [[0.106, yT(0.106) - 0.004], [0.205, yT(0.205) - 0.004]], () => W);
  const yr = yT(0.1), ringTop = yr + 0.002, ringBot = yr - 0.012, ringMid = yr - 0.004;
  sweep(q, [[0.094, ringMid], [0.094, ringTop], [0.106, ringTop], [0.106, ringBot]], () => W);
  sweep(lights, [[0.106, ringBot], [0.094, ringBot], [0.094, ringMid]], () => W);
  // Kafes kirişler: arka dikme, üst ve alt başlık, zikzak dikmeler; tepeleri birbirine bağlı
  const chordTop = (R: number) => ringTop + 0.0003 + ((R - 0.1) / 0.144) * 0.0425;
  const chordBot = (R: number) => yT(R) + 0.002;
  for (let k = 0; k < NS; k += 3) {
    const P = (R: number, y: number) => rimAt(k, R, y);
    q.bar(P(0.244, 0.25), P(0.244, chordTop(0.244)), 0.0028, SC.steel);
    q.bar(P(0.244, chordTop(0.244)), P(0.1, chordTop(0.1)), 0.0022, SC.steel);
    q.bar(P(0.244, chordBot(0.244)), P(0.1, chordBot(0.1)), 0.0016, SC.steel);
    q.bar(P(0.244, chordBot(0.244)), P(0.196, chordTop(0.196)), 0.0013, SC.steel2);
    q.bar(P(0.196, chordTop(0.196)), P(0.148, chordBot(0.148)), 0.0013, SC.steel2);
    q.bar(P(0.148, chordBot(0.148)), P(0.1, chordTop(0.1)), 0.0013, SC.steel2);
    q.bar(P(0.244, chordTop(0.244)), rimAt(k + 3, 0.244, chordTop(0.244)), 0.0018, SC.steel);
  }
  // İki uçta çatıya asılı dev ekranlar (sahaya bakar, gece yanar)
  for (const sd of [-1, 1]) {
    const x = sd * (BOWL.cx + 0.1);
    box(st, 0.006, 0.044, 0.094, AM.dark, x, 0.228, BOWL.z);
    add(st, new THREE.PlaneGeometry(0.086, 0.038), SCREEN_MAT, x - sd * 0.0032, 0.25, BOWL.z).rotation.y = (-sd * Math.PI) / 2;
    for (const dz of [-0.03, 0.03]) rod(st, [x, 0.272, BOWL.z + dz], [x, ringBot + 0.001, BOWL.z + dz], 0.0012, M.iron, 4);
  }

  // --- Saha içi: kaleler ve fileler, köşe bayrakları, yedek kulübeleri, oyuncu tüneli ---
  const yP = 0.0335;
  for (const sd of [-1, 1]) {
    const gx = sd * 0.2, bx = sd * 0.212, H = 0.0115, Hb = 0.009, Wd = 0.016, z0 = BOWL.z;
    for (const e of [-1, 1]) {
      const z = z0 + e * Wd;
      q.bar([gx, yP, z], [gx, yP + H, z], 0.0008, W);
      q.bar([gx, yP + H, z], [bx, yP + Hb, z], 0.0005, W);
      q.bar([bx, yP, z], [bx, yP + Hb, z], 0.0005, W);
      nets.quad([gx, yP, z], [bx, yP, z], [bx, yP + Hb, z], [gx, yP + H, z], W, [0, 0, e], [0, 0.75, 0, 0.75]);
    }
    q.bar([gx, yP + H, z0 - Wd - 0.0008], [gx, yP + H, z0 + Wd + 0.0008], 0.0008, W);
    nets.quad([bx, yP, z0 - Wd], [bx, yP, z0 + Wd], [bx, yP + Hb, z0 + Wd], [bx, yP + Hb, z0 - Wd], W, [sd, 0, 0], [0, 2, 0, 0.6]);
    nets.quad([gx, yP + H, z0 - Wd], [gx, yP + H, z0 + Wd], [bx, yP + Hb, z0 + Wd], [bx, yP + Hb, z0 - Wd], W, [0, 1, 0], [0, 2, 0, 0.75]);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const fx = sx * 0.2, fz = BOWL.z + sz * 0.13;
      q.bar([fx, yP, fz], [fx, 0.048, fz], 0.0004, SC.yellow);
      for (const e of [-1, 1]) q.quad([fx, 0.048, fz], [fx, 0.0435, fz], [fx - sx * 0.005, 0.0445, fz], [fx - sx * 0.005, 0.048, fz], SC.red, [0, 0, e]);
    }
  }
  for (const sx of [-1, 1]) {
    const x = sx * 0.055, z = 0.088;
    q.box([x, yP, z + 0.002], 0.046, 0.0065, 0.006, Math.PI, SC.navy);
    q.box([x, yP, z + 0.0058], 0.048, 0.011, 0.0015, 0, SC.dark);
    clear.quad([x - 0.024, 0.045, z + 0.007], [x + 0.024, 0.045, z + 0.007], [x + 0.024, 0.0425, z - 0.006], [x - 0.024, 0.0425, z - 0.006], W, [0, 1, 0]);
    for (const e of [-1, 1]) {
      const ex = x + e * 0.024;
      clear.quad([ex, yP, z + 0.007], [ex, yP, z - 0.006], [ex, 0.0425, z - 0.006], [ex, 0.045, z + 0.007], W, [e, 0, 0]);
    }
  }
  add(st, new THREE.CylinderGeometry(0.0065, 0.0065, 0.022, 10, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), M.red, 0, yP, 0.084);
  // Oyuncular (4-4-2), hakem ve top: ev sahibi (kırmızı-beyaz) sağa, konuk (mavi) sola hücum ediyor
  const figure = (x: number, z: number, ry: number, shirt: THREE.Color, shorts: THREE.Color, k: number) => {
    const c: P3 = [x, yP, BOWL.z + z];
    q.box(c, 0.0036, 0.0068, 0.0024, ry, shorts);
    q.box([c[0], yP + 0.0068, c[2]], 0.0052, 0.0058, 0.003, ry, shirt);
    q.box([c[0], yP + 0.0126, c[2]], 0.003, 0.003, 0.003, ry, SKINS[k % SKINS.length], HAIRS[k % HAIRS.length]);
  };
  const home: [number, number][] = [[-0.188, 0], [-0.13, -0.085], [-0.135, -0.03], [-0.13, 0.035], [-0.125, 0.09], [-0.05, -0.095], [-0.03, -0.035], [-0.02, 0.04], [0.02, 0.1], [0.07, 0.02], [0.105, -0.045]];
  const guest: [number, number][] = [[0.19, 0.005], [0.14, -0.07], [0.135, -0.02], [0.13, 0.04], [0.11, 0.095], [0.06, -0.06], [0.04, 0], [0.05, 0.06], [0, -0.09], [-0.03, 0.01], [-0.07, 0.07]];
  home.forEach(([x, z], i) => figure(x, z, Math.PI / 2 + hash2(i, 1) - 0.5, i ? SC.red : SC.green, i ? W : SC.dark, i));
  guest.forEach(([x, z], i) => figure(x, z, -Math.PI / 2 + hash2(i, 2) - 0.5, i ? SC.blue : SC.yellow, i ? SC.navy : SC.dark, i + 3));
  figure(0.03, 0.05, -2.4, SC.dark, SC.dark, 7);
  add(st, new THREE.IcosahedronGeometry(0.0019, 0), M.white, 0.078, yP + 0.0019, BOWL.z + 0.02);

  // --- Köşelerde sarmal rampalı merdiven kuleleri (tepesi kırmızı) ---
  for (const k of [11, 31, 47, 67]) {
    const [tx, , tz] = rimAt(k, 0.266, 0);
    cyl(st, 0.017, 0.017, 0.222, AM.core, tx, 0.03, tz, 12);
    cyl(st, 0.035, 0.035, 0.006, AM.red, tx, 0.25, tz, 16);
    const n = 44, turns = 2.75, r0 = 0.017, r1 = 0.032, a0 = Math.atan2(RIM[k].nz, RIM[k].nx);
    const P = (a: number, r: number, y: number): P3 => [tx + Math.cos(a) * r, y, tz + Math.sin(a) * r];
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * turns * Math.PI * 2, b = a0 + ((i + 1) / n) * turns * Math.PI * 2;
      const ya = 0.04 + (i / n) * 0.2, yc = 0.04 + ((i + 1) / n) * 0.2;
      const out: P3 = [Math.cos((a + b) / 2), 0, Math.sin((a + b) / 2)];
      q.quad(P(a, r0, ya), P(b, r0, yc), P(b, r1, yc), P(a, r1, ya), SC.ramp, [0, 1, 0]);
      q.quad(P(a, r1, ya - 0.004), P(b, r1, yc - 0.004), P(b, r1, yc + 0.007), P(a, r1, ya + 0.007), W, out);
      q.quad(P(a, r0, ya - 0.004), P(b, r0, yc - 0.004), P(b, r1, yc - 0.004), P(a, r1, ya - 0.004), SC.rampUnder, [0, -1, 0]);
    }
  }
  // --- Dört ışık direği: sahaya eğik lamba panoları (gece yanar) ---
  const tile = new THREE.PlaneGeometry(0.0145, 0.0125);
  for (const [mx, mz] of [[-0.445, 0.35], [0.445, 0.35], [-0.44, -0.44], [0.44, -0.44]] as [number, number][]) {
    add(st, new THREE.CylinderGeometry(0.0035, 0.008, 0.43, 4, 1, true), AM.mast, mx, 0.245, mz);
    const head = new THREE.Group();
    head.position.set(mx, 0.47, mz);
    st.add(head);
    head.lookAt(0, 0.03, BOWL.z);
    box(head, 0.072, 0.05, 0.006, M.iron, 0, -0.025, 0);
    box(head, 0.076, 0.003, 0.018, M.iron, 0, -0.03, 0.004);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) add(head, tile, FLOOD, -0.027 + i * 0.018, -0.016 + j * 0.016, 0.0032);
  }

  // --- Ana giriş: cam hol, beyaz saçak, "AKSOY ARENA" yazısı ve arma; arkada da yazı ---
  const sign = signMat('AKSOY ARENA', '#b71c1c');
  box(st, 0.16, 0.078, 0.03, windowMat, 0, 0.03, zF + 0.012);
  for (let i = 0; i <= 8; i++) q.bar([-0.08 + i * 0.02, 0.03, zF + 0.0275], [-0.08 + i * 0.02, 0.108, zF + 0.0275], 0.0012, W);
  q.bar([-0.08, 0.07, zF + 0.0275], [0.08, 0.07, zF + 0.0275], 0.0012, W);
  box(st, 0.21, 0.007, 0.075, M.white, 0, 0.108, zF + 0.03);
  box(st, 0.212, 0.009, 0.003, AM.red, 0, 0.106, zF + 0.068);
  for (const x of [-0.095, 0.095]) rod(st, [x, 0.03, zF + 0.06], [x, 0.108, zF + 0.06], 0.0022, M.steel, 6);
  box(st, 0.2, 0.05, 0.004, sign, 0, 0.145, zF + 0.003);
  box(st, 0.2, 0.05, 0.004, sign, 0, 0.145, zB - 0.003);
  add(st, new THREE.CylinderGeometry(0.016, 0.016, 0.003, 16).rotateX(Math.PI / 2), M.white, 0, 0.22, zF + 0.0025);
  add(st, new THREE.CylinderGeometry(0.012, 0.012, 0.003, 16).rotateX(Math.PI / 2), AM.red, 0, 0.22, zF + 0.0045);
  add(st, new THREE.IcosahedronGeometry(0.005, 0), M.white, 0, 0.22, zF + 0.006);

  // --- Ön meydan: yürüyüş yolu, turnikeler ve saçağı, bilet gişeleri, heykel, çimenler, bayraklar ---
  box(st, 0.34, 0.0025, 0.175, AM.walk, 0, 0.03, 0.4025);
  for (const sx of [-1, 1]) box(st, 0.006, 0.003, 0.175, AM.granite, sx * 0.17, 0.03, 0.4025);
  for (const x of [-0.16, 0, 0.16]) rod(st, [x, 0.03, 0.385], [x, 0.085, 0.385], 0.0018, M.steel, 5);
  box(st, 0.33, 0.004, 0.036, M.white, 0, 0.085, 0.385);
  box(st, 0.33, 0.007, 0.003, AM.red, 0, 0.082, 0.4035);
  for (const x of [-0.1, 0, 0.1]) add(st, BULB_GEO, BULB, x, 0.083, 0.385);
  for (let i = 0; i < 8; i++) {
    const x = -0.14 + i * 0.04;
    box(st, 0.008, 0.018, 0.016, M.gray, x, 0.03, 0.385);
    rod(st, [x + 0.004, 0.044, 0.385], [x + 0.016, 0.044, 0.385], 0.0012, M.steel, 4);
  }
  for (const sx of [-1, 1]) {
    const bx = sx * 0.2;
    box(st, 0.036, 0.042, 0.03, AM.red, bx, 0.03, 0.39);
    box(st, 0.044, 0.005, 0.038, M.white, bx, 0.072, 0.39);
    box(st, 0.026, 0.014, 0.002, windowMat, bx, 0.05, 0.4055);
  }
  footballerStatue(st, 0, 0.44, s);
  for (const sx of [-1, 1]) {
    box(st, 0.228, 0.005, 0.128, M.rim, sx * 0.36, 0.03, 0.42);
    box(st, 0.22, 0.0055, 0.12, M.lawn, sx * 0.36, 0.03, 0.42);
    tree(st, PROPS.treeStreet, sx * 0.3, 0.415, 0.65 * s, sx);
    tree(st, PROPS.treeStreet, sx * 0.41, 0.415, 0.65 * s, sx * 2);
    tree(st, PROPS.treeSmall, sx * 0.465, 0.27, 0.6 * s, sx * 3);
    tree(st, PROPS.treePine, sx * 0.35, -0.45, 0.6 * s, sx * 4);
    bench(st, sx * 0.3, 0.335, 0, s);
    for (let i = 0; i < 4; i++) flagPole(st, q, sx * (0.27 + i * 0.06) - 0.018, 0.468, s, i % 2 ? W : SC.red, i % 2 ? SC.red : W);
    plazaLamp(st, sx * 0.13, 0.475, s);
    for (const z of [0.16, -0.01, -0.11]) plazaLamp(st, sx * 0.472, z, s);
  }
  // Taraftarlar: turnike kuyruğunda, girişe yürüyen ve gişede bekleyenler
  const fans: [number, number, number][] = [
    [-0.12, 0.415, Math.PI], [-0.12, 0.44, Math.PI], [-0.04, 0.41, Math.PI], [0.04, 0.415, Math.PI], [0.04, 0.445, Math.PI],
    [0.12, 0.41, Math.PI], [0.08, 0.465, Math.PI + 0.3], [-0.08, 0.47, Math.PI - 0.2], [-0.06, 0.345, Math.PI], [0.07, 0.335, Math.PI + 0.2],
    [-0.11, 0.32, 2.6], [0.12, 0.35, -2.8], [0.2, 0.42, Math.PI], [-0.2, 0.42, Math.PI],
  ];
  fans.forEach(([x, z, r], i) => fanFigure(st, x, z, r, s, i));

  // --- Yanlarda takım otobüsü ve yayın aracı, arkada otopark ---
  teamBus(st, 0.452, -0.25, 0, s);
  tvTruck(st, -0.452, -0.25, Math.PI, s);
  box(st, 0.62, 0.003, 0.053, AM.asphalt, 0, 0.03, -0.4635);
  for (const x of [-0.3, -0.14, 0.02, 0.15, 0.3]) box(st, 0.003, 0.0012, 0.045, M.white, x, 0.033, -0.463);
  for (const [kind, x, color] of [['sedan', -0.22, '#1565c0'], ['suv', -0.06, '#202124'], ['taxi', 0.225, undefined]] as const) {
    const c = carModel(kind, color);
    c.position.set(x, 0.03, -0.462);
    c.rotation.y = Math.PI / 2;
    c.scale.multiplyScalar(s);
    st.add(c);
  }

  st.add(q.mesh(STAND_VC), glass.mesh(windowMat), lights.mesh(FLOOD), clear.mesh(ROOF_CLEAR), skin.mesh(SKIN_MAT), led.mesh(ADS_MAT), nets.mesh(NET_MAT));
  return mergeStatic([st]);
}

// Özgürlük Anıtı wonders.ts'e taşındı (yeniden çizildi)
export type HistoricKind = 'eiffel' | 'colosseum' | 'pyramid';
export const HISTORIC: Record<HistoricKind | 'stadium', () => THREE.Object3D> = {
  eiffel, colosseum, pyramid, stadium,
};
