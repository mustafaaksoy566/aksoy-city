import * as THREE from 'three';
import { mergeStatic } from './batcher';
import { windowMat } from './utilities';
import { pm, M, PAINT, add, box, cyl, rod } from './parts';
import { YT, hullGeo, deckGeo, sailboat, motorYacht } from './landmarks';

// Denizde dolaşan gemi ve tekneler (kodla çizilir): konteyner gemisi, dökme yük gemisi, yolcu gemisi, römorkör,
// balıkçı teknesi, yelkenliler ve sürat teknesi (son ikisi marinadaki modeller). Çizimde baş +x, en sonda
// baş +z'ye döndürülür ve istenen boya ölçeklenir. Dönen nesnenin y=0'ı su hattının 0.04 altıdır (eskiden
// gövdenin dibi y=0'dı ve gemiler su yüzünün 0.04 altına konuyordu).

export type BoatKind = 'container' | 'bulk' | 'liner' | 'sail-a' | 'sail-b' | 'speed' | 'tug' | 'fishing';
// Denizde dolaşanlar (sırası gemilerin denizdeki yerini belirler)
export const SEA_BOATS: BoatKind[] = ['container', 'sail-a', 'liner', 'speed', 'bulk', 'sail-b', 'tug', 'fishing'];

// Malzemeler ilk kullanımda yapılır (parts.ts bu dosyadan önce yüklenmemiş olabilir)
let BM: Record<'RUST' | 'HULL_BLUE' | 'HULL_RED' | 'DECK' | 'SUPER' | 'FUNNEL' | 'BLACK' | 'LIFEBOAT' | 'CRANE', THREE.Material> | null = null;
const bm = () =>
  (BM ??= {
    RUST: pm('#8e2b22', 0.8),
    HULL_BLUE: pm('#1f3b63', 0.6),
    HULL_RED: pm('#a33a2c', 0.7),
    DECK: pm('#7b8794', 0.85),
    SUPER: pm('#f4f4f0', 0.5),
    FUNNEL: pm('#d84a2f', 0.6),
    BLACK: pm('#22262c', 0.7),
    LIFEBOAT: pm('#ff8a1e', 0.6),
    CRANE: pm('#f2b705', 0.6),
  });

// Gemi gövdesi: su altı boyası, su hattı şeridi, üst borda ve güverte plakası. Döndürür: su hattının yüksekliği
function shipHull(b: THREE.Object3D, L: number, B: number, D: number, top: THREE.Material, stripe: THREE.Material = bm().RUST) {
  add(b, hullGeo(L, B, D, 0, 0.36), YT.anti, 0, 0, 0);
  add(b, hullGeo(L, B, D, 0.36, 0.46), stripe, 0, 0, 0);
  add(b, hullGeo(L, B, D, 0.46, 1), top, 0, 0, 0);
  add(b, deckGeo(L * 0.95, B * 0.9, 0.002), bm().DECK, -L * 0.01, D, 0);
  return D * 0.4;
}
// Kat kat beyaz köşk: her katta pencere şeridi
function tiers(b: THREE.Object3D, x: number, y: number, w: number, d: number, h: number, n: number, shrink = 0.9) {
  for (let k = 0; k < n; k++) {
    const s = shrink ** k;
    box(b, w * s, h, d * s, bm().SUPER, x, y + k * h, 0);
    box(b, w * s + 0.002, h * 0.36, d * s + 0.002, windowMat, x, y + k * h + h * 0.38, 0);
  }
  return y + n * h;
}
function funnel(b: THREE.Object3D, x: number, y: number, r: number, h: number, body: THREE.Material) {
  cyl(b, r * 0.9, r, h, body, x, y, 0, 14);
  cyl(b, r * 0.92, r * 0.92, h * 0.18, bm().BLACK, x, y + h, 0, 14);
}

// Konteyner gemisi: başta yüksek pruva, güvertede renk renk konteyner yığınları, kıçta köşk ve baca
function container() {
  const b = new THREE.Group();
  const L = 1, B = 0.17, D = 0.08;
  const wl = shipHull(b, L, B, D, bm().HULL_BLUE);
  const cols = [0, 1, 2, 4, 5, 6, 7].map(k => PAINT[k % PAINT.length]);
  for (let i = 0; i < 9; i++) {
    const x = -0.24 + i * 0.065;
    const rows = i === 8 ? 2 : 3;
    for (let r = 0; r < rows; r++) {
      for (let z = -2; z <= 2; z++) {
        const c = cols[(i * 3 + r * 5 + z * 7 + 70) % cols.length];
        box(b, 0.06, 0.024, 0.028, c, x, D + 0.002 + r * 0.025, z * 0.029);
      }
    }
  }
  const top = tiers(b, -0.38, D, 0.1, 0.15, 0.03, 4, 0.94);
  box(b, 0.03, 0.006, 0.19, bm().SUPER, -0.36, top - 0.006, 0);
  funnel(b, -0.43, D + 0.08, 0.022, 0.09, bm().FUNNEL);
  rod(b, [-0.37, top, 0], [-0.37, top + 0.06, 0], 0.002, M.gray, 4);
  return { g: b, L, wl };
}
// Dökme yük gemisi: kırmızı borda, güvertede büyük ambar kapakları ve sarı vinçler
function bulk() {
  const b = new THREE.Group();
  const L = 1, B = 0.16, D = 0.085;
  const wl = shipHull(b, L, B, D, bm().HULL_RED, pm('#f0f0f0', 0.6));
  for (let i = 0; i < 5; i++) {
    const x = -0.22 + i * 0.12;
    box(b, 0.09, 0.016, 0.11, pm('#5f6b77', 0.7), x, D + 0.002, 0);
    if (i < 4) {
      const cx = x + 0.06;
      cyl(b, 0.01, 0.012, 0.09, bm().CRANE, cx, D, 0, 8);
      rod(b, [cx, D + 0.08, 0], [cx + 0.05, D + 0.05, 0.03], 0.004, bm().CRANE, 4);
    }
  }
  const top = tiers(b, -0.4, D, 0.09, 0.14, 0.03, 4, 0.92);
  funnel(b, -0.45, D + 0.07, 0.02, 0.08, bm().BLACK);
  rod(b, [-0.39, top, 0], [-0.39, top + 0.05, 0], 0.002, M.gray, 4);
  return { g: b, L, wl };
}
// Yolcu gemisi: lacivert alt borda, beyaz üst, beş kat güverte, iki kırmızı baca, iki yanda turuncu filikalar
function liner() {
  const b = new THREE.Group();
  const L = 1, B = 0.15, D = 0.09;
  const wl = shipHull(b, L, B, D, bm().SUPER, bm().HULL_BLUE);
  // Bordada pencere sırası
  for (const z of [-1, 1]) box(b, L * 0.7, 0.008, 0.002, windowMat, -0.04, D * 0.7, z * B * 0.45);
  const top = tiers(b, -0.05, D, 0.66, 0.13, 0.026, 5, 0.94);
  box(b, 0.42, 0.004, 0.1, pm('#c9a77a', 0.8), -0.06, top, 0); // ahşap güverte
  box(b, 0.12, 0.006, 0.06, pm('#2f8fd0', 0.2), 0.08, top, 0); // havuz
  for (const x of [-0.18, 0.02]) funnel(b, x, top, 0.024, 0.07, bm().FUNNEL);
  for (const z of [-1, 1]) {
    for (let k = 0; k < 6; k++) add(b, new THREE.CapsuleGeometry(0.008, 0.03, 2, 6).rotateZ(Math.PI / 2), bm().LIFEBOAT, -0.3 + k * 0.1, D + 0.04, z * 0.08);
  }
  rod(b, [0.24, top, 0], [0.24, top + 0.06, 0], 0.002, M.gray, 4);
  return { g: b, L, wl };
}
// Römorkör: kısa ve geniş kırmızı gövde, siyah lastik usturmaçalar, yüksek beyaz köprü, baca
function tug() {
  const b = new THREE.Group();
  const L = 0.2, B = 0.08, D = 0.04;
  const wl = shipHull(b, L, B, D, bm().HULL_RED, bm().BLACK);
  for (let k = 0; k < 7; k++) {
    const x = -L * 0.4 + k * (L * 0.12);
    for (const z of [-1, 1]) add(b, new THREE.TorusGeometry(0.006, 0.003, 4, 8).rotateY(Math.PI / 2), bm().BLACK, x, D * 0.75, z * B * 0.47);
  }
  box(b, 0.07, 0.03, 0.05, bm().SUPER, 0.0, D, 0);
  box(b, 0.05, 0.022, 0.044, bm().SUPER, 0.01, D + 0.03, 0);
  box(b, 0.052, 0.008, 0.046, windowMat, 0.01, D + 0.04, 0);
  funnel(b, -0.035, D + 0.03, 0.009, 0.03, bm().FUNNEL);
  rod(b, [0.01, D + 0.052, 0], [0.01, D + 0.08, 0], 0.0015, M.gray, 4);
  return { g: b, L, wl };
}
// Balıkçı teknesi: mavi gövde, kıçta küçük kamara, direk ve bumbalar, turuncu şamandıralar
function fishing() {
  const b = new THREE.Group();
  const L = 0.2, B = 0.07, D = 0.038;
  const wl = shipHull(b, L, B, D, pm('#2d6fb8', 0.6), M.white);
  box(b, 0.05, 0.03, 0.045, M.white, -0.04, D, 0);
  box(b, 0.052, 0.008, 0.047, windowMat, -0.04, D + 0.018, 0);
  box(b, 0.056, 0.004, 0.05, pm('#2d6fb8', 0.6), -0.04, D + 0.03, 0);
  rod(b, [0.02, D, 0], [0.02, D + 0.11, 0], 0.002, M.gray, 4);
  for (const z of [-1, 1]) rod(b, [0.02, D + 0.08, 0], [0.06, D + 0.03, z * 0.05], 0.0012, M.gray, 3);
  for (let k = 0; k < 4; k++) add(b, new THREE.SphereGeometry(0.006, 6, 4), PAINT[0], 0.04 + k * 0.012, D + 0.006, (k % 2 ? 1 : -1) * 0.02);
  box(b, 0.04, 0.008, 0.03, pm('#3e7d4d', 0.9), 0.05, D, 0); // ağ yığını
  return { g: b, L, wl };
}
// Marinadaki yelkenli ve motor yat: yerel boyları 0.2 / 0.22, su hattı derinliğin %40'ı
const marinaBoat = (g: THREE.Group, L: number, D: number) => ({ g, L, wl: D * 0.4 });

const BUILD: Record<BoatKind, () => { g: THREE.Group; L: number; wl: number }> = {
  container,
  bulk,
  liner,
  tug,
  fishing,
  'sail-a': () => marinaBoat(sailboat('#1e6fd9', 0.2, '#1e5aa8'), 0.2, 0.2 * 0.16),
  'sail-b': () => marinaBoat(sailboat('#d63a32', 0.2, '#2e7d32'), 0.2, 0.2 * 0.16),
  speed: () => marinaBoat(motorYacht('#1e6fd9', 0.22), 0.22, 0.22 * 0.2),
};
// Denizdeki boyları (baş-kıç arası, kare cinsinden)
const LENGTH: Record<BoatKind, number> = { container: 3.5, bulk: 3.5, liner: 4.5, 'sail-a': 1.4, 'sail-b': 1.4, speed: 1.4, tug: 1.4, fishing: 1.4 };

export function makeBoat(kind: BoatKind, length = LENGTH[kind]) {
  const { g, L, wl } = BUILD[kind]();
  const s = length / L;
  const merged = mergeStatic([g]);
  merged.rotation.y = -Math.PI / 2; // baş +x'ten +z'ye
  merged.scale.setScalar(s);
  merged.position.y = 0.04 - wl * s; // su hattı y=0.04'te
  const root = new THREE.Group();
  root.add(merged);
  return root;
}
