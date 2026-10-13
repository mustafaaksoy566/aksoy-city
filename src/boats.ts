import * as THREE from 'three';
import { mergeStatic } from './batcher';
import { windowMat } from './utilities';
import { signMat } from './signs';
import { pm, BULB, PAINT, add, box, cyl, rod, type V3 } from './parts';
import { YT, hullGeo, deckGeo, sailboat, motorYacht } from './landmarks';

// Denizde dolaşan gemi ve tekneler (kodla, gökdelenler kadar ayrıntılı çizilir): konteyner gemisi, dökme yük
// gemisi, yolcu gemisi, römorkör, balıkçı teknesi; yelkenli ve sürat teknesi marinadaki modeller.
// Hepsinde: boyalı gövde (su altı, su hattı ve beyaz çizgi), başta isim ve çapalar, korkuluklar, gece yanan
// pencereler, seyir fenerleri (iskele kırmızı, sancak yeşil, direkte beyaz). Denizde gidenlerin önünde baş dalgası,
// arkasında köpük izi. Çizimde baş +x (sancak +z), en sonda baş +z'ye döndürülür ve istenen boya ölçeklenir.
// Dönen nesnenin y=0'ı su hattının 0.04 altıdır (gemiler su yüzünün 0.04 altına konur).

export type BoatKind = 'container' | 'bulk' | 'liner' | 'sail-a' | 'sail-b' | 'speed' | 'tug' | 'fishing';
// Denizde dolaşanlar (sırası gemilerin denizdeki yerini belirler)
export const SEA_BOATS: BoatKind[] = ['container', 'sail-a', 'liner', 'speed', 'bulk', 'sail-b', 'tug', 'fishing'];

// Malzemeler ilk kullanımda yapılır (parts.ts bu dosyadan önce yüklenmemiş olabilir)
type Mats = ReturnType<typeof makeMats>;
let BM: Mats | null = null;
function makeMats() {
  const lamp = (color: string) => {
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0 });
    m.name = 'lamp'; // gece yanar (DayNight)
    return m;
  };
  return {
    rust: pm('#8e2b22', 0.8),
    boot: pm('#f4f4f0', 0.6),
    navy: pm('#1f3b63', 0.6),
    hullRed: pm('#a33a2c', 0.7),
    deck: pm('#7b8794', 0.85),
    white: pm('#f4f4f0', 0.5),
    cream: pm('#e9e4d6', 0.7),
    funnel: pm('#d84a2f', 0.6),
    black: pm('#22262c', 0.7),
    steel: pm('#9aa5b1', 0.5, 0.5),
    lifeboat: pm('#ff8a1e', 0.6),
    crane: pm('#f2b705', 0.6),
    pool: pm('#2f9be0', 0.15, 0.1),
    teak: pm('#c9a77a', 0.8),
    court: pm('#3f9d5a', 0.9),
    net: pm('#3e7d4d', 0.95),
    rope: pm('#d8c49a', 0.9),
    fender: pm('#2a2a2a', 0.95),
    fishBlue: pm('#2d6fb8', 0.6),
    crate: pm('#1e88e5', 0.7),
    sideRed: lamp('#ff3b30'),
    sideGreen: lamp('#34c759'),
    containers: ['#c62828', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#ef6c00', '#00838f'].map(containerMat),
  };
}
const bm = () => (BM ??= makeMats());

// Konteyner dokusu: oluklu yan yüz, üst ve alt kenar çizgisi (renk malzemeden gelir)
let RIBS: THREE.Texture | null = null;
function containerMat(color: string) {
  if (!RIBS) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 16;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 64, 16);
    x.fillStyle = 'rgba(0,0,0,0.22)';
    for (let k = 0; k < 64; k += 4) x.fillRect(k, 0, 1.5, 16);
    x.fillStyle = 'rgba(0,0,0,0.35)';
    x.fillRect(0, 0, 64, 1);
    x.fillRect(0, 15, 64, 1);
    RIBS = new THREE.CanvasTexture(c);
    RIBS.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshStandardMaterial({ color, map: RIBS, roughness: 0.75 });
}

// Gövdenin genişliği (yukarıdan): landmarks.ts'teki tekne gövdesiyle aynı biçim. u: 0 kıç, 1 baş; t: alttan üste
const beamAt = (u: number) => (u > 0.45 ? 1 - ((u - 0.45) / 0.55) ** 2 : 1 - (0.45 - u) * 0.22);
const halfWidth = (B: number, u: number, t: number) => (B / 2) * beamAt(u) * (0.25 + 0.75 * Math.sqrt(t));

// Gemi gövdesi: su altı boyası, su hattı şeridi, beyaz çizgi, üst borda, güverte; başta isim ve çapalar.
// Döndürür: su hattının yüksekliği
function shipHull(b: THREE.Object3D, L: number, B: number, D: number, top: THREE.Material, topHex: string, name: string, stripe?: THREE.Material) {
  const m = bm();
  add(b, hullGeo(L, B, D, 0, 0.36), YT.anti, 0, 0, 0);
  add(b, hullGeo(L, B, D, 0.36, 0.44), stripe ?? m.rust, 0, 0, 0);
  add(b, hullGeo(L, B, D, 0.44, 0.47), m.boot, 0, 0, 0);
  add(b, hullGeo(L, B, D, 0.47, 1), top, 0, 0, 0);
  add(b, deckGeo(L * 0.95, B * 0.9, 0.002), m.deck, -L * 0.01, D, 0);
  // Baş tarafta iki yanda isim (borda rengine boyanmış gibi) ve çapalar
  const u = 0.7, x = (u - 0.5) * L;
  const t = 0.8, w = halfWidth(B, u, t);
  const slope = (halfWidth(B, u + 0.01, t) - halfWidth(B, u - 0.01, t)) / (0.02 * L);
  const nameMat = signMat(name, topHex, '#ffffff');
  for (const s of [-1, 1]) {
    const p = add(b, new THREE.PlaneGeometry(L * 0.16, D * 0.22), nameMat, x, D * t, s * (w + 0.002));
    // Düzlem borda boyunca eğik dursun, yazı dışa baksın
    p.rotation.y = s > 0 ? -Math.atan(slope) : Math.PI + Math.atan(slope);
    const ax = (0.86 - 0.5) * L, aw = halfWidth(B, 0.86, 0.75);
    add(b, new THREE.CylinderGeometry(D * 0.06, D * 0.06, 0.004, 10).rotateX(Math.PI / 2), m.black, ax, D * 0.75, s * aw);
    box(b, D * 0.07, D * 0.16, 0.003, m.black, ax, D * 0.5, s * (aw - 0.0005));
  }
  return D * 0.4;
}
// Korkuluk: noktalar boyunca dikmeler ve üst tırabzan
function rail(b: THREE.Object3D, pts: V3[], h: number, r: number, mat: THREE.Material = YT.chrome, step = 0.03) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1];
    const len = Math.hypot(c[0] - a[0], c[2] - a[2]);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k <= n; k++) {
      if (k === n && i < pts.length - 2) continue;
      const f = k / n;
      const p: V3 = [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f];
      rod(b, p, [p[0], p[1] + h, p[2]], r, mat, 3);
    }
    rod(b, [a[0], a[1] + h, a[2]], [c[0], c[1] + h, c[2]], r * 1.2, mat, 3);
  }
}
// Seyir fenerleri: iskele (sol, -z) kırmızı, sancak (sağ, +z) yeşil
function sideLights(b: THREE.Object3D, x: number, y: number, halfSpan: number, size = 0.006) {
  const m = bm();
  add(b, new THREE.BoxGeometry(size, size, size * 0.6), m.sideRed, x, y, -halfSpan - size * 0.3);
  add(b, new THREE.BoxGeometry(size, size, size * 0.6), m.sideGreen, x, y, halfSpan + size * 0.3);
}
// Köşk katları: her katta pencere şeridi ve kat kirişi; üstte boydan boya kanatlı köprü, önde geniş camlar,
// korkuluk, direkte radar ve fener. Döndürür: köprü tavanının yüksekliği
function accommodation(b: THREE.Object3D, x: number, y0: number, w: number, d: number, h: number, n: number, wingSpan: number) {
  const m = bm();
  for (let k = 0; k < n; k++) {
    const y = y0 + k * h;
    box(b, w, h, d, m.white, x, y, 0);
    box(b, w + 0.002, h * 0.34, d + 0.002, windowMat, x, y + h * 0.42, 0);
    box(b, w + 0.004, 0.0025, d + 0.004, m.cream, x, y + h - 0.0025, 0);
  }
  const top = y0 + n * h;
  box(b, w * 0.9, h * 1.05, wingSpan, m.white, x, top, 0);
  box(b, 0.002, h * 0.5, wingSpan * 0.94, windowMat, x + (w * 0.9) / 2 + 0.001, top + h * 0.38, 0);
  box(b, w * 0.96, 0.004, wingSpan + 0.004, m.cream, x, top + h * 1.05, 0);
  const rt = top + h * 1.05 + 0.004;
  rail(b, [[x - w * 0.45, rt, -wingSpan / 2], [x + w * 0.45, rt, -wingSpan / 2], [x + w * 0.45, rt, wingSpan / 2], [x - w * 0.45, rt, wingSpan / 2]], 0.008, 0.0007, YT.chrome, 0.02);
  sideLights(b, x + w * 0.2, top + h * 0.5, wingSpan / 2);
  const mx = x - w * 0.1;
  rod(b, [mx, rt, 0], [mx, rt + 0.07, 0], 0.0018, m.steel, 5);
  box(b, 0.004, 0.003, 0.05, m.steel, mx, rt + 0.035, 0);
  box(b, 0.02, 0.003, 0.004, m.black, mx + 0.006, rt + 0.05, 0);
  add(b, new THREE.SphereGeometry(0.004, 6, 4), BULB, mx, rt + 0.072, 0);
  for (const z of [-0.012, 0.012]) rod(b, [mx, rt + 0.035, z], [mx, rt + 0.06, z], 0.0007, m.steel, 3);
  return rt;
}
// Baca: şirket şeridi, siyah ağız, egzoz boruları
function funnel(b: THREE.Object3D, x: number, y: number, r: number, h: number, body: THREE.Material, band?: THREE.Material) {
  const m = bm();
  cyl(b, r * 0.85, r, h, body, x, y, 0, 16);
  if (band) cyl(b, r * 0.9, r * 0.92, h * 0.22, band, x, y + h * 0.5, 0, 16);
  cyl(b, r * 0.87, r * 0.86, h * 0.14, m.black, x, y + h, 0, 16);
  for (const z of [-r * 0.3, r * 0.3]) cyl(b, r * 0.18, r * 0.18, h * 0.12, m.black, x, y + h * 1.12, z, 6);
}
// Baş kasarası: yükseltilmiş baş güvertesi, V dalgakıran, babalar, ırgatlar, baş direği ve feneri, korkuluk
function forecastle(b: THREE.Object3D, L: number, B: number, D: number) {
  const m = bm();
  const x0 = L * 0.33, y = D * 1.16;
  box(b, L * 0.13, D * 0.16, B * 0.62, m.deck, x0 + L * 0.07, D, 0);
  for (const s of [-1, 1]) {
    const p = add(b, new THREE.BoxGeometry(0.004, D * 0.3, B * 0.42), m.white, x0, D + D * 0.15, s * B * 0.17);
    p.rotation.y = s * 0.5;
    cyl(b, 0.008, 0.008, 0.01, m.black, x0 + L * 0.08, y, s * B * 0.18, 8);
    cyl(b, 0.004, 0.004, 0.012, m.black, x0 + L * 0.11, y, s * B * 0.22, 6);
  }
  rod(b, [L * 0.44, y, 0], [L * 0.44, y + 0.05, 0], 0.0014, m.steel, 4);
  add(b, new THREE.SphereGeometry(0.0035, 6, 4), BULB, L * 0.44, y + 0.052, 0);
  rail(b, [[L * 0.33, y, -B * 0.3], [L * 0.45, y, -B * 0.14], [L * 0.48, y, 0], [L * 0.45, y, B * 0.14], [L * 0.33, y, B * 0.3]], 0.008, 0.0006);
}

// Konteyner gemisi: ambar kapaklarında oluklu renkli konteynerler, aralarında bağlama köprüleri, kıça yakın yüksek
// köşk, ayrı baca, kıçta serbest düşmeli filika
function container() {
  const m = bm();
  const b = new THREE.Group();
  const L = 1, B = 0.17, D = 0.08;
  const wl = shipHull(b, L, B, D, m.navy, '#1f3b63', 'AKSOY EXPRESS');
  forecastle(b, L, B, D);
  const bays = 8, bayL = 0.07;
  for (let i = 0; i < bays; i++) {
    const x = -0.2 + i * (bayL + 0.006);
    const tiers = i === bays - 1 ? 2 : i === 0 ? 3 : 4;
    box(b, bayL, 0.006, B * 0.84, m.deck, x, D, 0);
    for (let r = 0; r < tiers; r++) {
      for (let z = -2; z <= 2; z++) {
        const c = m.containers[(i * 3 + r * 5 + z * 7 + 70) % m.containers.length];
        box(b, bayL - 0.004, 0.022, 0.0275, c, x, D + 0.006 + r * 0.0225, z * 0.029);
      }
    }
    if (i < bays - 1) {
      const bx = x + bayL / 2 + 0.003;
      for (const z of [-B * 0.4, 0, B * 0.4]) rod(b, [bx, D, z], [bx, D + 0.045, z], 0.0012, m.steel, 3);
      rod(b, [bx, D + 0.045, -B * 0.4], [bx, D + 0.045, B * 0.4], 0.0012, m.steel, 3);
    }
  }
  accommodation(b, -0.3, D, 0.07, 0.13, 0.022, 6, 0.19);
  funnel(b, -0.42, D, 0.022, 0.1, m.funnel, m.white);
  const lb = add(b, new THREE.CapsuleGeometry(0.008, 0.035, 3, 8).rotateZ(Math.PI / 2), m.lifeboat, -0.475, D + 0.02, 0);
  lb.rotation.z = 0.35;
  rail(b, [[-0.49, D, -B * 0.38], [-0.49, D, B * 0.38]], 0.008, 0.0006);
  return { g: b, L, B, wl };
}

// Dökme yük gemisi: kırmızı borda, kaburgalı büyük ambar kapakları, kabinli sarı güverte vinçleri, kıçta köşk
function bulk() {
  const m = bm();
  const b = new THREE.Group();
  const L = 1, B = 0.16, D = 0.085;
  const wl = shipHull(b, L, B, D, m.hullRed, '#a33a2c', 'AKSOY BULK', m.black);
  forecastle(b, L, B, D);
  for (let i = 0; i < 5; i++) {
    const x = -0.2 + i * 0.11;
    box(b, 0.087, 0.004, 0.112, m.hullRed, x, D, 0); // ambar ağzı çerçevesi
    box(b, 0.085, 0.014, 0.11, m.deck, x, D + 0.004, 0);
    for (let k = 0; k < 5; k++) box(b, 0.085, 0.004, 0.004, m.steel, x, D + 0.018, -0.044 + k * 0.022);
    if (i < 4) {
      const cx = x + 0.055;
      cyl(b, 0.01, 0.012, 0.03, m.crane, cx, D, 0, 10);
      box(b, 0.018, 0.016, 0.016, m.crane, cx, D + 0.03, 0);
      box(b, 0.002, 0.008, 0.012, windowMat, cx + 0.0095, D + 0.035, 0);
      const tip: V3 = [cx + 0.06, D + 0.075, (i % 2 ? 1 : -1) * 0.025];
      rod(b, [cx, D + 0.04, 0], tip, 0.0035, m.crane, 5);
      rod(b, tip, [tip[0], D + 0.035, tip[2]], 0.0006, m.black, 3);
      box(b, 0.006, 0.006, 0.006, m.black, tip[0], D + 0.03, tip[2]);
    }
  }
  accommodation(b, -0.38, D, 0.08, 0.14, 0.023, 5, 0.18);
  funnel(b, -0.45, D, 0.02, 0.09, m.black, m.funnel);
  rail(b, [[-0.49, D, -B * 0.38], [-0.49, D, B * 0.38]], 0.008, 0.0006);
  return { g: b, L, B, wl };
}

// Yolcu gemisi: lacivert alt borda ve iki sıra lomboz, balkonlu kat kat beyaz köşk (önleri yuvarlak), camlı köprü,
// tik güverte, havuz ve şezlonglar, su kaydırağı, spor sahası, şirket şeritli baca, kızaklarında turuncu filikalar
function liner() {
  const m = bm();
  const b = new THREE.Group();
  const L = 1, B = 0.15, D = 0.09;
  const wl = shipHull(b, L, B, D, m.white, '#f4f4f0', 'AKSOY STAR', m.navy);
  // Alt borda lacivert (su hattı şeridinin üstünden beyaz çizgiye kadar)
  add(b, hullGeo(L, B, D, 0.44, 0.47), m.navy, 0, 0, 0);
  for (const s of [-1, 1]) {
    for (const y of [0.6, 0.78]) {
      for (let k = 0; k < 26; k++) {
        const x = -0.36 + k * 0.025;
        box(b, 0.012, 0.005, 0.002, windowMat, x, D * y, s * (halfWidth(B, x / L + 0.5, y) + 0.001));
      }
    }
  }
  const x0 = -0.37, x1 = 0.24, d = 0.13, h = 0.024;
  for (let k = 0; k < 6; k++) {
    const s = 1 - k * 0.035;
    const a = x0 + k * 0.012, c = x1 - k * 0.035;
    const y = D + k * h;
    const dd = d * s;
    box(b, c - a, h, dd, m.white, (a + c) / 2, y, 0);
    // Yuvarlak burun (yarım silindir, öne bakar)
    add(b, new THREE.CylinderGeometry(dd / 2, dd / 2, h, 16, 1, false, 0, Math.PI), m.white, c, y + h / 2, 0);
    add(b, new THREE.CylinderGeometry(dd / 2 + 0.0015, dd / 2 + 0.0015, h * 0.42, 16, 1, true, 0, Math.PI), windowMat, c, y + h * 0.6, 0);
    for (const sz of [-1, 1]) {
      box(b, c - a, h * 0.5, 0.002, windowMat, (a + c) / 2, y + h * 0.35, sz * (dd / 2 + 0.001));
      for (let j = 0; j <= Math.floor((c - a) / 0.02); j++) box(b, 0.002, h * 0.55, 0.004, m.white, a + j * 0.02, y + h * 0.3, sz * (dd / 2 + 0.002));
      box(b, c - a, 0.002, 0.004, m.cream, (a + c) / 2, y + h * 0.3, sz * (dd / 2 + 0.003));
    }
  }
  const top = D + 6 * h;
  // Camlı köprü ve kanatlar (önde, en üst katın üstünde)
  box(b, 0.05, h, 0.15, m.white, 0.15, top, 0);
  box(b, 0.002, h * 0.5, 0.14, windowMat, 0.176, top + h * 0.35, 0);
  sideLights(b, 0.16, top + h * 0.5, 0.075);
  // Güneş güvertesi
  box(b, 0.42, 0.003, 0.1, m.teak, -0.12, top, 0);
  box(b, 0.104, 0.005, 0.054, m.white, -0.02, top, 0);
  box(b, 0.1, 0.0065, 0.05, m.pool, -0.02, top, 0);
  for (let k = 0; k < 6; k++) for (const z of [-0.038, 0.038]) box(b, 0.008, 0.003, 0.012, PAINT[(k + (z > 0 ? 3 : 0)) % PAINT.length], -0.07 + k * 0.022, top + 0.003, z);
  box(b, 0.06, 0.004, 0.05, m.court, -0.3, top, 0);
  box(b, 0.06, 0.005, 0.002, m.white, -0.3, top, 0);
  const slide = new THREE.CatmullRomCurve3(([[0.06, top + 0.06, -0.03], [0.09, top + 0.05, 0.03], [0.05, top + 0.035, 0.04], [0.03, top + 0.02, -0.01], [0.06, top + 0.008, -0.03]] as V3[]).map(p => new THREE.Vector3(...p)));
  add(b, new THREE.TubeGeometry(slide, 24, 0.005, 6, false), m.crane, 0, 0, 0);
  rod(b, [0.06, top, -0.03], [0.06, top + 0.06, -0.03], 0.002, m.steel, 4);
  for (const z of [-0.05, 0.05]) rail(b, [[-0.33, top + 0.003, z], [0.1, top + 0.003, z]], 0.008, 0.0006, YT.chrome, 0.025);
  funnel(b, -0.2, top, 0.03, 0.06, m.white, m.funnel);
  rod(b, [0.15, top + h, 0], [0.15, top + h + 0.05, 0], 0.0018, m.steel, 5);
  box(b, 0.004, 0.003, 0.04, m.steel, 0.15, top + h + 0.03, 0);
  add(b, new THREE.SphereGeometry(0.004, 6, 4), BULB, 0.15, top + h + 0.052, 0);
  // Kızaklarda filikalar (iki yanda, ikinci kat hizasında): turuncu tekne, beyaz tavan, kızak kolları
  for (const s of [-1, 1]) {
    for (let k = 0; k < 7; k++) {
      const x = -0.3 + k * 0.075, z = s * (d / 2 + 0.014);
      add(b, new THREE.CapsuleGeometry(0.008, 0.028, 2, 8).rotateZ(Math.PI / 2), m.lifeboat, x, D + h * 1.6, z);
      box(b, 0.026, 0.006, 0.012, m.white, x, D + h * 1.6 + 0.005, z);
      for (const dx of [-0.014, 0.014]) rod(b, [x + dx, D + h * 1.6 + 0.008, z], [x + dx, D + h * 2.3, s * (d / 2 - 0.004)], 0.0008, m.steel, 3);
    }
  }
  return { g: b, L, B, wl };
}

// Römorkör: kırmızı gövde, başta kalın kauçuk usturmaça, yanlarda lastikler, dört yanı camlı köprü, çeki vinci ve
// çeki kemeri, direkte fenerler, projektör, can simitleri
function tug() {
  const m = bm();
  const b = new THREE.Group();
  const L = 0.2, B = 0.08, D = 0.04;
  const wl = shipHull(b, L, B, D, m.hullRed, '#a33a2c', 'AKSOY', m.black);
  add(b, new THREE.CapsuleGeometry(0.009, 0.05, 3, 8).rotateX(Math.PI / 2), m.fender, L * 0.47, D * 0.85, 0);
  for (let k = 0; k < 6; k++) {
    const x = -L * 0.35 + k * (L * 0.12);
    for (const z of [-1, 1]) add(b, new THREE.TorusGeometry(0.006, 0.003, 5, 10).rotateY(Math.PI / 2), m.fender, x, D * 0.72, z * (halfWidth(B, x / L + 0.5, 0.72) + 0.002));
  }
  box(b, 0.07, 0.026, 0.052, m.white, 0.005, D, 0);
  box(b, 0.072, 0.008, 0.054, windowMat, 0.005, D + 0.012, 0);
  box(b, 0.05, 0.024, 0.046, m.white, 0.012, D + 0.026, 0);
  box(b, 0.052, 0.012, 0.048, windowMat, 0.012, D + 0.034, 0);
  box(b, 0.058, 0.004, 0.054, m.black, 0.012, D + 0.05, 0);
  sideLights(b, 0.02, D + 0.04, 0.026, 0.005);
  rod(b, [0.01, D + 0.054, 0], [0.01, D + 0.09, 0], 0.0015, m.steel, 4);
  for (const y of [0.075, 0.085]) add(b, new THREE.SphereGeometry(0.0028, 6, 4), BULB, 0.01, D + y, 0);
  cyl(b, 0.004, 0.005, 0.006, m.steel, 0.03, D + 0.054, 0.012, 8);
  funnel(b, -0.032, D + 0.026, 0.009, 0.03, m.white, m.hullRed);
  add(b, new THREE.CylinderGeometry(0.01, 0.01, 0.022, 10).rotateX(Math.PI / 2), m.steel, -0.055, D + 0.012, 0);
  for (const z of [-0.03, 0.03]) rod(b, [-0.08, D, z], [-0.08, D + 0.035, 0], 0.002, m.steel, 4);
  rod(b, [-0.055, D + 0.016, 0], [-0.1, D + 0.004, 0], 0.0012, m.rope, 3);
  for (const z of [-1, 1]) add(b, new THREE.TorusGeometry(0.006, 0.0018, 4, 10), m.lifeboat, -0.02, D + 0.016, z * 0.027);
  rail(b, [[-0.095, D, -0.035], [-0.095, D, 0.035]], 0.008, 0.0006);
  return { g: b, L, B, wl };
}

// Balıkçı teknesi (trol): mavi gövde, başa yakın köprü, kıçta A çerçeve ve ağ tamburu, kalkık trol kolları,
// şamandıralar, balık kasaları, direkte fener
function fishing() {
  const m = bm();
  const b = new THREE.Group();
  const L = 0.2, B = 0.07, D = 0.038;
  const wl = shipHull(b, L, B, D, m.fishBlue, '#2d6fb8', 'DENİZ', m.white);
  box(b, 0.05, 0.028, 0.046, m.white, 0.025, D, 0);
  box(b, 0.052, 0.009, 0.048, windowMat, 0.025, D + 0.016, 0);
  box(b, 0.056, 0.004, 0.05, m.fishBlue, 0.025, D + 0.028, 0);
  sideLights(b, 0.04, D + 0.02, 0.024, 0.005);
  rod(b, [0.0, D, 0], [0.0, D + 0.1, 0], 0.002, m.steel, 4);
  add(b, new THREE.SphereGeometry(0.0028, 6, 4), BULB, 0, D + 0.102, 0);
  for (const z of [-1, 1]) {
    rod(b, [0.0, D + 0.01, z * 0.02], [-0.01, D + 0.11, z * 0.07], 0.0016, m.steel, 4);
    rod(b, [-0.01, D + 0.11, z * 0.07], [-0.01, D + 0.02, z * 0.075], 0.0005, m.rope, 3);
    rod(b, [-0.085, D, z * 0.028], [-0.075, D + 0.06, z * 0.022], 0.0022, m.crane, 4);
  }
  rod(b, [-0.075, D + 0.06, -0.022], [-0.075, D + 0.06, 0.022], 0.0022, m.crane, 4);
  add(b, new THREE.CylinderGeometry(0.012, 0.012, 0.04, 12).rotateX(Math.PI / 2), m.net, -0.055, D + 0.014, 0);
  for (const z of [-0.022, 0.022]) add(b, new THREE.CylinderGeometry(0.015, 0.015, 0.003, 12).rotateX(Math.PI / 2), m.steel, -0.055, D + 0.014, z);
  for (let k = 0; k < 5; k++) add(b, new THREE.SphereGeometry(0.0055, 6, 4), PAINT[k % 2 ? 0 : 3], -0.03 + k * 0.009, D + 0.006, (k % 2 ? 1 : -1) * 0.022);
  for (let k = 0; k < 3; k++) box(b, 0.014, 0.008, 0.012, m.crate, 0.065, D + k * 0.008, -0.01 + (k % 2) * 0.004);
  return { g: b, L, B, wl };
}

// Marinadaki yelkenli ve motor yat: yerel boyları 0.2 / 0.22, su hattı derinliğin %40'ı
const marinaBoat = (g: THREE.Group, L: number, B: number, D: number) => ({ g, L, B, wl: D * 0.4 });

const BUILD: Record<BoatKind, () => { g: THREE.Group; L: number; B: number; wl: number }> = {
  container,
  bulk,
  liner,
  tug,
  fishing,
  'sail-a': () => marinaBoat(sailboat('#1e6fd9', 0.2, '#1e5aa8'), 0.2, 0.064, 0.2 * 0.16),
  'sail-b': () => marinaBoat(sailboat('#d63a32', 0.2, '#2e7d32'), 0.2, 0.064, 0.2 * 0.16),
  speed: () => marinaBoat(motorYacht('#1e6fd9', 0.22), 0.22, 0.068, 0.22 * 0.2),
};
// Denizdeki boyları (baş-kıç arası, kare cinsinden)
const LENGTH: Record<BoatKind, number> = { container: 3.5, bulk: 3.5, liner: 4.5, 'sail-a': 1.4, 'sail-b': 1.4, speed: 1.4, tug: 1.4, fishing: 1.4 };

// Köpük dokusu: gemi tarafında yoğun, uzağa ve kenarlara doğru seyrelen beyaz köpük
let FOAM: THREE.MeshBasicMaterial | null = null;
function foamMat() {
  if (FOAM) return FOAM;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const x = c.getContext('2d')!;
  const r = (s: number) => {
    const v = Math.sin(s * 127.1) * 43758.5453;
    return v - Math.floor(v);
  };
  for (let k = 0; k < 260; k++) {
    const v = r(k) * 128; // 0 gemi tarafı, 128 uzak uç
    const u = 32 + (r(k + 999) - 0.5) * (14 + v * 0.38);
    x.fillStyle = `rgba(255,255,255,${((1 - v / 128) * 0.85).toFixed(2)})`;
    x.beginPath();
    x.ellipse(u, v, 1.2 + r(k + 77) * 2.5, 2 + r(k + 55) * 5, 0, 0, Math.PI * 2);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  FOAM = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
  return FOAM;
}
// Baş dalgası ve kıçtaki köpük izi (su hattında; gemiyle birlikte döner ve ölçeklenir).
// Dokunun v=0 tarafı gemiye bakar: plan önce (x, z) düzlemine yatırılır, sonra uzunluğu x boyunca durur.
function wake(L: number, B: number, wl: number) {
  const g = new THREE.Group();
  const m = foamMat();
  const plane = (w: number, len: number) => {
    const geo = new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2);
    return new THREE.Mesh(geo, m);
  };
  const trail = plane(B * 2.4, L * 0.9);
  trail.position.set(-L * 0.5 - L * 0.45, wl + 0.002, 0);
  g.add(trail);
  for (const s of [-1, 1]) {
    const bw = plane(B * 0.5, L * 0.35);
    bw.position.set(L * 0.3, wl + 0.002, s * B * 0.42);
    bw.rotation.y = -s * 0.35;
    g.add(bw);
  }
  return g;
}

// wakeOn: denizde giderken köpük izi (limanda bekleyen gemide yok)
export function makeBoat(kind: BoatKind, length = LENGTH[kind], wakeOn = true) {
  const { g, L, B, wl } = BUILD[kind]();
  const s = length / L;
  const inner = new THREE.Group();
  inner.add(mergeStatic([g]));
  if (wakeOn) inner.add(wake(L, B, wl));
  inner.rotation.y = -Math.PI / 2; // baş +x'ten +z'ye
  inner.scale.setScalar(s);
  inner.position.y = 0.04 - wl * s; // su hattı y=0.04'te
  const root = new THREE.Group();
  root.add(inner);
  return root;
}
