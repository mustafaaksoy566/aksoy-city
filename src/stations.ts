import * as THREE from 'three';
import { PROPS } from './config';
import { part, windowMat } from './utilities';
import { mergeStatic } from './batcher';
import { KIT } from './towers';
import { signMat } from './signs';
import { pm, M, add, box, cyl, rod, item, tree, planter, bench } from './parts';
import { SITES, drawLot, lotLight, entrance } from './sites';
import { person } from './shops';
import { flatRoof, hvac } from './stores';
import { glowSign, RED_LIGHT } from './skyline';

// =====================================================================================================
// Yükseltilen hizmet binası gökdelen gibi büyür: kule ayrı bir parça gibi köşeye eklenmez, binanın kendisi
// yükselir. Alttaki bloğun aynı cephe dokusu (katlar hizalı), aynı renk bantları ve girişin üstünden tepeye
// çıkan camlı şerit (giriş holünün devamı) tek parça bir bina gibi görünür. 2. seviyede üst kısım geri çekilir
// (ışıklı teras), tepede renkli taç ve ışıklı tabela; çatıda binaya özgü: polis pisti ve telsiz direği,
// itfaiyenin kırmızı fenerli gözetleme odası, hastanenin kızıl haçı ve pisti, okulun bahçesi ve gözlemevi.
// =====================================================================================================
export type RiseKind = 'police' | 'fire' | 'health' | 'school';
// Alttaki bloğun üstüne eklenen boy (seviye 0..3)
export const RISE: Record<RiseKind, number[]> = { police: [0, 0.66, 1.3, 2.0], fire: [0, 0.66, 1.21, 1.87], health: [0, 0.55, 1.1, 1.76], school: [0, 0.55, 0.99, 1.54] };
const FLOOR = 0.11; // towers.ts ile aynı kat yüksekliği (pencereler alttaki blokla hizalı kalsın)
const BLUE_GLOW = new THREE.MeshStandardMaterial({ color: '#3d7bff', emissive: '#2a66ff', emissiveIntensity: 1.1 });
const STEEL_DOME = pm('#c3ccd3', 0.3, 0.7);
interface Rise {
  kind: RiseKind; level: number;
  x: number; z: number; w: number; d: number; y0: number; // gövdenin ortası, ölçüsü ve alttaki bloğun üstü
  facade: THREE.Material; band: THREE.Material; accent: THREE.Material; spine: THREE.Material; spineW: number;
  sign: [string, string];
}
// Çatının ortası ve ölçüsü (çatıdaki eşyalar için) ya da seviye 0'da null
export function serviceRise(st: THREE.Object3D, o: Rise): { top: number; w: number; d: number; z: number } | null {
  const lv = Math.min(3, o.level);
  if (lv < 1) return null;
  const h = RISE[o.kind][lv];
  const F3 = FLOOR * 3;
  const body = (w: number, d: number, z: number, y: number, hh: number) => {
    st.add(part(KIT.facadeBox(w, hh, d, y), o.facade, o.x, y + hh / 2, z));
    // Üç katta bir kat hizasında bant (alttaki bloğun bandıyla aynı renk)
    for (let yy = Math.ceil((y + 0.08) / F3) * F3; yy < y + hh - 0.12; yy += F3) box(st, w + 0.014, 0.02, d + 0.014, o.band, o.x, yy - 0.01, z);
    // Ön yüzde girişin üstünden yükselen camlı şerit ve çerçevesi
    box(st, o.spineW, hh - 0.03, 0.012, o.spine, o.x, y + 0.015, z + d / 2 + 0.004);
    for (const sd of [-1, 1]) box(st, 0.014, hh - 0.03, 0.02, M.white, o.x + sd * (o.spineW / 2 + 0.007), y + 0.015, z + d / 2 + 0.006);
    // Camın kat çizgileri ve ortadaki dikey kayıt (cam cephe gibi görünsün)
    for (let yy = Math.ceil((y + 0.03) / FLOOR) * FLOOR; yy < y + hh - 0.03; yy += FLOOR) box(st, o.spineW, 0.007, 0.008, M.white, o.x, yy - 0.0035, z + d / 2 + 0.008);
    box(st, 0.006, hh - 0.03, 0.008, M.white, o.x, y + 0.015, z + d / 2 + 0.008);
  };
  let w = o.w, d = o.d, z = o.z;
  const low = lv >= 2 ? Math.round((h * 0.62) / FLOOR) * FLOOR : h;
  body(w, d, z, o.y0, low);
  if (lv >= 2) {
    // Kademe: alt gövdenin çatısı teras (cam korkuluk, gece yanan ışık şeridi), üst gövde daha dar; önü hizalı
    const ty = o.y0 + low;
    box(st, w + 0.02, 0.026, d + 0.02, M.white, o.x, ty, z);
    box(st, w + 0.024, 0.008, d + 0.024, BLUE_GLOW_OF[o.kind], o.x, ty + 0.009, z);
    const w2 = w * 0.78, d2 = d * 0.82;
    z = z + (d - d2) / 2 - 0.0;
    for (const sd of [-1, 1]) box(st, 0.006, 0.035, d2, KIT.GLASS[0], o.x + sd * (w / 2 - 0.02), ty + 0.026, z - 0.01);
    w = w2;
    d = d2;
    body(w, d, z, ty + 0.026, h - low - 0.026);
  }
  // Taç: tepede renkli bant, ışıklı tabela ve düz çatı
  const top = o.y0 + h;
  box(st, w + 0.02, 0.075, d + 0.02, o.accent, o.x, top - 0.075, z);
  box(st, Math.min(w * 0.8, 0.52), 0.06, 0.008, glowSign(o.sign[0], o.sign[1]), o.x, top - 0.07, z + d / 2 + 0.014);
  flatRoof(st, o.x, z, w, d, top, M.white);
  return { top: top + 0.006, w, d, z };
}
// Yükselen binanın çatısı: binaya özgü eşyalar (r: serviceRise'ın döndürdüğü çatı)
export function riseRoof(st: THREE.Object3D, kind: RiseKind, level: number, x: number, r: { top: number; w: number; d: number; z: number }) {
  const { top, w, d, z } = r;
  const pr = Math.min(w, d) * 0.36;
  if (kind === 'police') {
    // Tacın altında gece gündüz yanan mavi şerit, pist (2. seviyeden), telsiz direği
    box(st, w + 0.026, 0.014, d + 0.026, BLUE_GLOW, x, top - 0.1, z);
    if (level >= 2) helipad(st, x - w * 0.1, z, top, pr);
    else for (const dx of [-0.1, 0.06]) hvac(st, x + dx, z, top);
    mast(st, x + w / 2 - 0.07, z - d / 2 + 0.07, top, 0.28 + level * 0.1, 0.035);
  } else if (kind === 'fire') {
    // Arka köşede gözetleme odası: beyaz gövde, kırmızı yanan camlar, sivri çatı; 2. seviyeden pist
    const fx = x + w / 2 - 0.09, fz = z - d / 2 + 0.09, fh = 0.08 + level * 0.04;
    box(st, 0.12, fh, 0.12, M.white, fx, top, fz);
    box(st, 0.13, 0.055, 0.13, RED_LIGHT, fx, top + fh, fz);
    box(st, 0.15, 0.012, 0.15, M.white, fx, top + fh + 0.055, fz);
    add(st, new THREE.ConeGeometry(0.11, 0.08, 4).rotateY(Math.PI / 4), DARK, fx, top + fh + 0.107, fz);
    if (level >= 2) helipad(st, x - w * 0.12, z + 0.01, top, pr * 0.9);
    else hvac(st, x - w * 0.15, z, top);
  } else if (kind === 'health') {
    // Ön ve arka yüzde parlayan kızıl haç, çatıda ambulans helikopteri pisti
    for (const sd of [1, -1]) {
      const fz = z + sd * (d / 2 + 0.02);
      box(st, 0.15, 0.045, 0.01, RED_LIGHT, x + w * 0.3, top - 0.27, fz);
      box(st, 0.045, 0.15, 0.01, RED_LIGHT, x + w * 0.3, top - 0.322, fz);
    }
    helipad(st, x, z, top, pr);
  } else {
    // Okul: çatı bahçesi (çimen, çalılar, ağaçlar), ön yüzde saat, 3. seviyede gözlemevi kubbesi
    box(st, w - 0.05, 0.018, d - 0.05, M.lawn, x, top, z);
    const garden = new THREE.Group();
    garden.position.y = top + 0.018 - 0.03;
    st.add(garden);
    tree(garden, PROPS.treeSmall, x - w / 2 + 0.08, z - d / 2 + 0.08, 0.22);
    tree(garden, PROPS.treeLarge, x - w / 2 + 0.1, z + d / 2 - 0.1, 0.2);
    tree(garden, PROPS.bush, x - 0.05, z + d / 2 - 0.07, 0.35);
    const cz = z + d / 2 + 0.012;
    add(st, new THREE.CylinderGeometry(0.055, 0.055, 0.01, 24).rotateX(Math.PI / 2), M.white, x + w * 0.32, top - 0.2, cz);
    box(st, 0.006, 0.04, 0.004, DARK, x + w * 0.32, top - 0.205, cz + 0.007);
    box(st, 0.03, 0.006, 0.004, DARK, x + w * 0.32 + 0.012, top - 0.203, cz + 0.007);
    if (level >= 3) {
      const R = Math.min(w, d) * 0.24, dx = x + w / 2 - R - 0.04;
      cyl(st, R, R, 0.06, M.white, dx, top, z, 20);
      add(st, new THREE.SphereGeometry(R, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), STEEL_DOME, dx, top + 0.06, z);
      box(st, 0.03, R * 0.9, 0.02, DARK, dx, top + 0.06, z + R * 0.7);
    }
  }
}

// Teras ışık şeridinin rengi: polis mavi, diğerleri sıcak beyaz
const WARM_GLOW = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffe6a0', emissiveIntensity: 0.9 });
const BLUE_GLOW_OF: Record<RiseKind, THREE.Material> = { police: BLUE_GLOW, fire: WARM_GLOW, health: WARM_GLOW, school: WARM_GLOW };

// Otoparklı 2x2 karakol, itfaiye ve depo (SimCity'deki gibi): arkada bina, önünde kendi otoparkı ve kapısı.
// Dünya ölçüsünde çizilir (alan -0.96..0.96, ön yüz +z yola bakar); şehirdeki arabalar ve insanlar aynı boyda
// kalsın diye görünümün 2x2 büyütmesi geri alınır. Park yerleri, kapılar ve garaj kapıları sites.ts'te.

const K = 1 / 1.92;
const CURB = pm('#c9c4b8', 0.9);
const LINE = pm('#f4f4f0', 0.7);
const YELLOW = pm('#f2c14e', 0.6);
const BLUE = pm('#1e4fa3', 0.6);
const RED = pm('#c62828', 0.65);
const APRON = pm('#565c66', 0.95);
const DARK = pm('#232a33', 0.5);
const SHUTTER = pm('#d9dde2', 0.5, 0.3);

// Otoparkla bina önü arasında alçak bordür (kapının hizasında açık) ve kapıdan yola yaya geçidi
function walkway(st: THREE.Object3D, x0: number, x1: number, door: number) {
  const a = door - 0.12, b = door + 0.12;
  if (a - x0 > 0.02) box(st, a - x0, 0.008, 0.012, CURB, (x0 + a) / 2, 0.03, 0.094);
  if (x1 - b > 0.02) box(st, x1 - b, 0.008, 0.012, CURB, (b + x1) / 2, 0.03, 0.094);
  for (let k = 0; k < 7; k++) box(st, 0.1, 0.0012, 0.035, LINE, door, 0.034, 0.47 + k * 0.07);
}
// Bayrak direği (bayrak +z'ye dalgalanır)
function flag(st: THREE.Object3D, x: number, z: number, h: number, color: string, moon = true) {
  cyl(st, 0.005, 0.007, h, M.gray, x, 0.03, z, 6);
  add(st, new THREE.SphereGeometry(0.008, 8, 6), M.gold, x, 0.03 + h + 0.006, z);
  box(st, 0.004, 0.07, 0.11, pm(color, 0.8), x, 0.03 + h - 0.08, z + 0.058);
  if (moon) add(st, new THREE.CircleGeometry(0.017, 12).rotateY(Math.PI / 2), M.white, x + 0.003, 0.03 + h - 0.045, z + 0.045);
}
// Kepenkli kapı (yüzü +z): açık gri kepenk, ince çıtalar
function rollDoor(st: THREE.Object3D, x: number, z: number, w: number, h: number) {
  box(st, w, h, 0.008, SHUTTER, x, 0.03, z + 0.004);
  for (let k = 0; k < Math.floor(h / 0.022); k++) box(st, w - 0.008, 0.003, 0.012, M.gray, x, 0.05 + k * 0.022, z + 0.006);
}
// Yanıp sönen ışıklar (çatıda): birleştirilmez, animateService yakıp söndürür
function blinkers(g: THREE.Group, pts: [number, number, number][]) {
  const red = new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff3b30', emissiveIntensity: 0 });
  const blue = new THREE.MeshStandardMaterial({ color: '#2f80ff', emissive: '#2f80ff', emissiveIntensity: 0 });
  const s = new THREE.Group();
  s.scale.setScalar(K);
  for (const [x, y, z] of pts) {
    s.add(part(new THREE.BoxGeometry(0.045, 0.024, 0.034), red, x - 0.026, y, z));
    s.add(part(new THREE.BoxGeometry(0.045, 0.024, 0.034), blue, x + 0.026, y, z));
  }
  g.add(s);
  g.userData.blink = [red, blue];
}
// Telsiz direği: dört ayaklı, yukarı daralan kafes kule, tepesinde gece yanan kırmızı ışık
const MAST_LIGHT = new THREE.MeshStandardMaterial({ color: '#ff5252', emissive: '#ff5252', emissiveIntensity: 0 });
MAST_LIGHT.name = 'lamp';
function mast(st: THREE.Object3D, x: number, z: number, y0: number, h: number, base: number) {
  const at = (u: number, sx: number, sz: number): [number, number, number] => {
    const r = base * (1 - u * 0.8);
    return [x + sx * r, y0 + u * h, z + sz * r];
  };
  const legs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of legs) rod(st, at(0, sx, sz), at(1, sx, sz), 0.004, M.gray, 4);
  for (let k = 1; k <= 5; k++) {
    const u0 = (k - 1) / 5, u1 = k / 5;
    for (let q = 0; q < 4; q++) {
      const [ax, az] = legs[q], [bx, bz] = legs[(q + 1) % 4];
      rod(st, at(u1, ax, az), at(u1, bx, bz), 0.0025, M.gray, 4);
      rod(st, at(u0, ax, az), at(u1, bx, bz), 0.002, M.gray, 4);
    }
  }
  cyl(st, 0.002, 0.004, 0.16, M.gray, x, y0 + h, z, 4);
  add(st, new THREE.SphereGeometry(0.012, 8, 6), MAST_LIGHT, x, y0 + h + 0.16, z);
}
// Çatıda helikopter pisti
function helipad(st: THREE.Object3D, x: number, z: number, y: number, r: number) {
  cyl(st, r, r, 0.012, pm('#4b545e', 0.8), x, y, z, 28);
  add(st, new THREE.CylinderGeometry(r * 0.88, r * 0.88, 0.014, 28, 1, true), YELLOW, x, y + 0.007, z);
  for (const dx of [-0.05, 0.05]) box(st, 0.024, 0.003, 0.13, M.white, x + dx, y + 0.012, z);
  box(st, 0.1, 0.003, 0.024, M.white, x, y + 0.012, z);
}
// Uydu çanağı
function dish(st: THREE.Object3D, x: number, z: number, y: number, r: number) {
  cyl(st, 0.004, 0.004, 0.05, M.gray, x, y, z, 6);
  const d = add(st, new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, 0.9), M.white, x, y + 0.05 + r * 0.6, z);
  d.rotation.x = -2.2;
}
// Yangın musluğu
function hydrant(st: THREE.Object3D, x: number, z: number) {
  cyl(st, 0.012, 0.014, 0.05, RED, x, 0.03, z, 10);
  add(st, new THREE.SphereGeometry(0.013, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), RED, x, 0.08, z);
  for (const s of [-1, 1]) add(st, new THREE.CylinderGeometry(0.006, 0.006, 0.012, 8).rotateZ(Math.PI / 2), M.gray, x + s * 0.016, 0.065, z);
}

// =====================================================================================================
// Karakol: üç katlı emniyet binası (beyaz bantlı cephe, üstte lacivert şerit), öne çıkan camlı giriş holü,
// lacivert saçak ve POLİS tabelası, iki bayrak; sağda kepenkli garaj ve üstünde telsiz direği; çatıda
// helikopter pisti, uydu çanağı, klimalar ve yanıp sönen ışıklar. Önde meydan (ağaçlar, banklar) ve otopark:
// solda ziyaretçi yerleri, sağda polis arabalarının yerleri.
// =====================================================================================================
export function makePolice2(level = 0) {
  const site = SITES.police;
  const g = new THREE.Group();
  const st = new THREE.Group();
  st.scale.setScalar(K);
  box(st, 1.92, 0.03, 1.92, M.paving, 0, 0, 0);
  drawLot(st, site, -0.94, 0.94, 0.1, 0.96);
  const [dx, dz] = site.door;
  walkway(st, -0.94, 0.94, dx);
  // Ana bina (x -0.88..0.36, z -0.88..-0.38); yükseltildikçe içinden emniyet kulesi yükselir
  const W = 1.24, D = 0.5, H = 0.42, cx = -0.26, cz = -0.63, front = cz + D / 2;
  st.add(part(KIT.facadeBox(W, H, D, 0.03), KIT.BAND[1], cx, 0.03 + H / 2, cz));
  box(st, W + 0.012, 0.04, D + 0.012, BLUE, cx, 0.4, cz);
  flatRoof(st, cx, cz, W, D, 0.03 + H, M.white);
  // Camlı giriş holü (binanın içine biraz girer), çerçeveler, saçak, tabela
  box(st, 0.36, 0.3, 0.15, windowMat, dx, 0.03, dz - 0.075);
  box(st, 0.37, 0.02, 0.16, M.white, dx, 0.33, dz - 0.075);
  for (const x of [-0.18, -0.12, 0.12, 0.18]) box(st, 0.01, 0.3, 0.006, M.white, dx + x, 0.03, dz + 0.003);
  box(st, 0.36, 0.008, 0.006, M.white, dx, 0.23, dz + 0.003);
  entrance(st, dx, dz, 0.12, 0.17, M.white);
  box(st, 0.44, 0.014, 0.18, BLUE, dx, 0.25, dz + 0.09);
  box(st, 0.24, 0.06, 0.012, signMat('POLİS', '#1e4fa3'), dx, 0.352, front + 0.006);
  box(st, 0.3, 0.012, 0.08, M.stone, dx, 0.03, dz + 0.04);
  // Ön cephede ikinci tabela ve polis yıldızı (sağda)
  add(st, new THREE.CylinderGeometry(0.05, 0.05, 0.01, 6).rotateX(Math.PI / 2), M.gold, 0.18, 0.3, front + 0.006);
  add(st, new THREE.CylinderGeometry(0.034, 0.034, 0.012, 6).rotateX(Math.PI / 2), BLUE, 0.18, 0.3, front + 0.008);
  // Garaj (x 0.42..0.9, z -0.88..-0.44): iki kepenk, üstünde telsiz direği
  const gW = 0.48, gD = 0.44, gH = 0.22, gx = 0.66, gz = -0.66, gf = gz + gD / 2;
  st.add(part(KIT.facadeBox(gW, gH, gD, 0.03), KIT.BAND[1], gx, 0.03 + gH / 2, gz));
  box(st, gW + 0.012, 0.03, gD + 0.012, BLUE, gx, 0.03 + gH - 0.05, gz);
  flatRoof(st, gx, gz, gW, gD, 0.03 + gH, M.white);
  for (const x of [0.55, 0.77]) rollDoor(st, x, gf, 0.17, 0.15);
  mast(st, 0.78, -0.76, 0.03 + gH + 0.006, 0.9, 0.06);
  // Çatı: helikopter pisti, uydu çanağı, klimalar. Yükseltilince bina girişin üstünden yükselir (pist tepeye
  // çıkar, alçak kanatta klimalar ve çanak kalır)
  const roofY = 0.03 + H + 0.006;
  const rise = serviceRise(st, {
    kind: 'police', level, x: dx, z: cz, w: 0.84, d: D - 0.06, y0: 0.03 + H,
    facade: KIT.BAND[1], band: BLUE, accent: BLUE, spine: windowMat, spineW: 0.26, sign: ['POLİS', '#1e4fa3'],
  });
  if (rise) {
    riseRoof(st, 'police', level, dx, rise);
    hvac(st, -0.78, -0.74, roofY);
    dish(st, -0.72, -0.52, roofY, 0.035);
  } else {
    helipad(st, -0.6, -0.64, roofY, 0.17);
    dish(st, 0.18, -0.5, roofY, 0.035);
    hvac(st, -0.12, -0.78, roofY);
    hvac(st, 0.04, -0.78, roofY);
    cyl(st, 0.003, 0.004, 0.22, M.gray, 0.28, roofY, -0.8, 4);
  }
  // Meydan: bayraklar, ağaçlar, banklar, çiçeklikler, bisiklet parkı
  flag(st, dx - 0.3, -0.13, 0.5, '#e53935');
  flag(st, dx + 0.3, -0.13, 0.5, '#1e4fa3', false);
  tree(st, PROPS.treeLarge, -0.78, -0.2, 0.3);
  tree(st, PROPS.treeSmall, -0.6, -0.26, 0.32);
  tree(st, PROPS.treeLarge, 0.86, -0.26, 0.28);
  planter(st, 0.42, -0.24, 0.045, 2);
  planter(st, 0.6, -0.24, 0.045, 4);
  bench(st, -0.7, -0.08, 0, 1);
  bench(st, 0.26, -0.3, 0, 1);
  for (let k = 0; k < 4; k++) {
    const r = add(st, new THREE.TorusGeometry(0.02, 0.003, 4, 12, Math.PI), M.gray, 0.72 + k * 0.035, 0.03, -0.12);
    r.rotation.y = Math.PI / 2;
  }
  person(st, dx + 0.14, dz + 0.06, 0.3, 2, 'stand', 0.03, 1.05, BLUE);
  person(st, dx - 0.2, -0.04, Math.PI * 0.8, 5, 'stand', 0.03, 1.05);
  lotLight(st, -0.935, 0.6);
  lotLight(st, 0.935, 0.6);
  g.add(mergeStatic([st]));
  blinkers(g, rise ? [[dx - 0.2, rise.top + 0.04, rise.z + rise.d / 2 - 0.05]] : [[cx + 0.3, 0.03 + H + 0.045, front - 0.05]]);
  return g;
}

// =====================================================================================================
// İtfaiye: tuğla araç holü, üç büyük açık garaj kapısı (araçlar karanlık içeriden çıkar, üstte toplanmış kırmızı
// kepenkler), büyük İTFAİYE tabelası, hortum kulesi; önlerinde sarı çizgili çıkış alanı. Sağda iki katlı ofis ve
// yatakhane (kırmızı saçaklı kapı), önünde çalışanların otoparkı. Çatıda siren ve yanıp sönen ışıklar.
// =====================================================================================================
export function makeFire2(level = 0) {
  const site = SITES.fire;
  const g = new THREE.Group();
  const st = new THREE.Group();
  st.scale.setScalar(K);
  box(st, 1.92, 0.03, 1.92, M.paving, 0, 0, 0);
  // Çıkış alanı (garajların önünden yola) ve şerit çizgileri
  box(st, 1.06, 0.004, 1.26, APRON, -0.39, 0.03, 0.33);
  for (const x of [-0.88, -0.56, -0.24, 0.08]) box(st, 0.01, 0.0012, 1.22, YELLOW, x, 0.034, 0.33);
  for (let k = 0; k < 9; k++) {
    const s = box(st, 0.012, 0.0012, 0.12, YELLOW, -0.84 + k * 0.11, 0.034, 0.86);
    s.rotation.y = 0.6;
  }
  // Çalışanların otoparkı
  drawLot(st, site, 0.16, 0.94, 0.1, 0.96);
  const [dx, dz] = site.door;
  walkway(st, 0.16, 0.94, dx);
  // Araç holü (x -0.92..0.14, z -0.92..-0.3)
  const W = 1.06, D = 0.62, H = 0.42, cx = -0.39, cz = -0.61, front = cz + D / 2;
  st.add(part(KIT.facadeBox(W, H, D, 0.03), KIT.BRICK[0], cx, 0.03 + H / 2, cz));
  box(st, W + 0.012, 0.03, D + 0.012, M.white, cx, 0.03 + H - 0.03, cz);
  flatRoof(st, cx, cz, W, D, 0.03 + H, M.white);
  for (const [x] of site.garages!) {
    box(st, 0.29, 0.275, 0.01, M.white, x, 0.03, front + 0.004);
    box(st, 0.25, 0.25, 0.012, DARK, x, 0.03, front + 0.007);
    box(st, 0.27, 0.03, 0.03, RED, x, 0.03 + 0.245, front + 0.016);
    for (const s of [-1, 1]) box(st, 0.012, 0.03, 0.02, YELLOW, x + s * 0.155, 0.03, front + 0.018);
  }
  box(st, 0.3, 0.075, 0.012, signMat('İTFAİYE', '#c62828'), cx, 0.31, front + 0.006);
  add(st, new THREE.CylinderGeometry(0.035, 0.035, 0.01, 18).rotateX(Math.PI / 2), M.white, cx + 0.26, 0.35, front + 0.006);
  add(st, new THREE.CylinderGeometry(0.028, 0.028, 0.012, 18).rotateX(Math.PI / 2), RED, cx + 0.26, 0.35, front + 0.008);
  // Hortum kulesi (holün arka sol köşesinden yükselir)
  st.add(part(KIT.facadeBox(0.16, 0.98, 0.16, 0.03), KIT.BRICK[0], -0.8, 0.03 + 0.49, -0.78));
  box(st, 0.18, 0.03, 0.18, M.white, -0.8, 1.0, -0.78);
  add(st, new THREE.ConeGeometry(0.14, 0.12, 4).rotateY(Math.PI / 4), DARK, -0.8, 1.09, -0.78);
  // Ofis ve yatakhane (x 0.18..0.92, z -0.92..-0.4); yükseltildikçe içinden itfaiye kulesi yükselir
  const oW = 0.74, oD = 0.52, oH = 0.34, ox = 0.55, oz = -0.66, of = oz + oD / 2;
  st.add(part(KIT.facadeBox(oW, oH, oD, 0.03), KIT.BRICK[1], ox, 0.03 + oH / 2, oz));
  box(st, oW + 0.012, 0.025, oD + 0.012, M.white, ox, 0.03 + oH - 0.025, oz);
  flatRoof(st, ox, oz, oW, oD, 0.03 + oH, M.white);
  entrance(st, dx, dz, 0.1, 0.15, M.white);
  box(st, 0.22, 0.014, 0.14, RED, dx, 0.21, of + 0.07);
  box(st, 0.18, 0.012, 0.06, M.stone, dx, 0.03, of + 0.03);
  // Yükseltilince ofis bloğu aynı tuğlayla kat kat yükselir (kapısının üstünden camlı şerit)
  const rise = serviceRise(st, {
    kind: 'fire', level, x: ox, z: oz, w: oW - 0.06, d: oD - 0.06, y0: 0.03 + oH,
    facade: KIT.BRICK[1], band: M.white, accent: RED, spine: windowMat, spineW: 0.2, sign: ['İTFAİYE', '#c62828'],
  });
  if (rise) riseRoof(st, 'fire', level, ox, rise);
  else {
    hvac(st, 0.38, -0.8, 0.03 + oH + 0.006);
    hvac(st, 0.76, -0.8, 0.03 + oH + 0.006);
  }
  // Çatıda siren
  cyl(st, 0.004, 0.004, 0.08, M.gray, -0.1, 0.03 + H + 0.006, -0.8, 6);
  add(st, new THREE.CylinderGeometry(0.025, 0.03, 0.03, 10), RED, -0.1, 0.03 + H + 0.1, -0.8);
  // Ofisin önü: bayrak, musluk, bank, çalışanlar, ağaç
  flag(st, 0.86, -0.3, 0.46, '#e53935');
  hydrant(st, 0.2, -0.16);
  bench(st, 0.32, -0.3, 0, 1);
  tree(st, PROPS.treeSmall, 0.74, -0.3, 0.3);
  person(st, 0.28, -0.14, 0.4, 1, 'stand', 0.03, 1.05, pm('#263238', 0.7));
  person(st, 0.36, -0.12, -2.6, 6, 'stand', 0.03, 1.05, pm('#263238', 0.7));
  lotLight(st, 0.935, 0.6);
  g.add(mergeStatic([st]));
  blinkers(g, [[cx, 0.03 + H + 0.045, front - 0.05]]);
  return g;
}

// =====================================================================================================
// Depo: oluklu sac depo binası (çatıda ışıklıklar ve havalandırmalar), dört yükleme kapısı (lastik kapı
// contaları, sarı tamponlar), önlerinde kamyon yerleri; DEPO tabelası; sağda iki katlı ofis (kapısı önde),
// önünde geri dönüşüm konteynerleri; rampada forklift ve paletler.
// =====================================================================================================
export function makeDepot2(variant: number) {
  const site = SITES.depot;
  const st = new THREE.Group();
  st.scale.setScalar(K);
  box(st, 1.92, 0.03, 1.92, M.paving, 0, 0, 0);
  // Yükleme rampası önü (asfalt) ve otopark
  box(st, 1.24, 0.004, 0.26, APRON, -0.32, 0.03, -0.13);
  drawLot(st, site, -0.94, 0.94, 0.0, 0.96);
  const [dx, dz] = site.door;
  for (let k = 0; k < 7; k++) box(st, 0.1, 0.0012, 0.035, LINE, dx, 0.034, 0.47 + k * 0.07);
  // Depo binası (x -0.94..0.3, z -0.94..-0.26)
  const W = 1.24, D = 0.68, H = 0.4, cx = -0.32, cz = -0.6, front = cz + D / 2;
  st.add(part(KIT.facadeBox(W, H, D, 0.03), KIT.METAL[variant % 3], cx, 0.03 + H / 2, cz));
  box(st, W + 0.012, 0.035, D + 0.012, pm(['#ef6c00', '#1565c0', '#2e7d32'][variant % 3], 0.6), cx, 0.03 + H - 0.05, cz);
  flatRoof(st, cx, cz, W, D, 0.03 + H, pm('#dfe3e8', 0.6));
  for (let k = 0; k < 4; k++) box(st, 0.16, 0.016, 0.42, windowMat, -0.8 + k * 0.32, 0.03 + H + 0.006, -0.62);
  for (const x of [-0.64, -0.32, 0.0]) cyl(st, 0.018, 0.018, 0.04, M.gray, x, 0.03 + H + 0.006, -0.84, 10);
  for (const x of [-0.76, -0.46, -0.16, 0.14]) {
    box(st, 0.22, 0.22, 0.012, DARK, x, 0.03, front + 0.004);
    rollDoor(st, x, front + 0.006, 0.18, 0.19);
    for (const s of [-1, 1]) box(st, 0.016, 0.03, 0.022, pm('#212121', 0.9), x + s * 0.1, 0.04, front + 0.016);
    for (const s of [-1, 1]) cyl(st, 0.008, 0.008, 0.06, YELLOW, x + s * 0.13, 0.03, front + 0.03, 8);
  }
  box(st, 0.34, 0.085, 0.012, signMat('DEPO', '#37474f'), -0.62, 0.285, front + 0.006);
  // Ofis (x 0.36..0.94, z -0.94..-0.36)
  const oW = 0.58, oD = 0.58, oH = 0.32, ox = 0.65, oz = -0.65, of = oz + oD / 2;
  st.add(part(KIT.facadeBox(oW, oH, oD, 0.03), KIT.BAND[variant % 3], ox, 0.03 + oH / 2, oz));
  flatRoof(st, ox, oz, oW, oD, 0.03 + oH, M.white);
  entrance(st, dx, dz, 0.1, 0.15, DARK);
  box(st, 0.22, 0.014, 0.12, DARK, dx, 0.21, of + 0.06);
  hvac(st, 0.52, -0.8, 0.03 + oH + 0.006);
  hvac(st, 0.78, -0.8, 0.03 + oH + 0.006);
  // Geri dönüşüm konteynerleri (ofisin önünde, kapının sağında)
  ['#1e88e5', '#fdd835', '#43a047', '#757575'].forEach((c, k) => {
    const x = 0.78 + (k % 2) * 0.08, z = -0.3 + Math.floor(k / 2) * 0.09;
    box(st, 0.065, 0.06, 0.06, pm(c, 0.6), x, 0.03, z);
    box(st, 0.069, 0.008, 0.064, pm('#263238', 0.6), x, 0.09, z);
  });
  // Rampada forklift ve paletler
  const fl = item(st, 0.24, -0.2, -Math.PI / 2);
  box(fl, 0.07, 0.04, 0.1, pm('#fbc02d', 0.5), 0, 0.008, 0);
  box(fl, 0.06, 0.035, 0.035, M.iron, 0, 0.048, 0.025);
  for (const s of [-1, 1]) rod(fl, [s * 0.03, 0.05, -0.02], [s * 0.03, 0.12, -0.02], 0.003, M.iron, 4);
  for (const s of [-1, 1]) box(fl, 0.008, 0.004, 0.07, M.iron, s * 0.018, 0.03, -0.085);
  for (const x of [-0.61, -0.31, -0.01]) {
    box(st, 0.09, 0.012, 0.08, M.wood, x, 0.03, -0.2);
    box(st, 0.08, 0.05, 0.07, pm('#c8955a', 0.9), x, 0.042, -0.2);
  }
  person(st, 0.32, -0.22, 2.2, 3, 'stand', 0.03, 1.05, pm('#ef6c00', 0.6));
  lotLight(st, -0.935, 0.6);
  lotLight(st, 0.935, 0.6);
  return mergeStatic([st]);
}
