import * as THREE from 'three';
import { PROPS } from './config';
import { part, windowMat, showcaseMat } from './utilities';
import { mergeStatic } from './batcher';
import { KIT } from './towers';
import { signMat } from './signs';
import { pm, M, BULB, BULB_GEO, FLOWERS, FLOWER_GEO, PAINT, add, box, cyl, rod, item, tree, planter, flowerBed } from './parts';
import { SITES, drawLot, lotLight, entrance, type Site } from './sites';
import {
  person, car, greenhouse, sapling, flowerStand, gnome, wheelbarrow, soilPallet, plantCart, potStack, umbrella, patioTable,
  giantCone, giantBurger, fridge, washer, tv, carton, featherFlag, handTruck, roundedBox, screenGeo, screenMat, menuMat,
  AD, SHOP_GLASS, litWall, CHROME, CARDBOARD, GRAVEL, CONCRETE, LEAVES, LINE, LEAF_MOUND, BLOOM,
} from './shops';

// Otoparklı 2x2 dükkânlar (SimCity'deki gibi): arkada dükkân binası, önünde yaya yolu ve çizgili otopark.
// Arabalar park yerlerine park eder, insanlar arabadan inip ortadaki yoldan dükkânın kapısına yürür.
// Dünya ölçüsünde çizilir (1 kare = 1 birim; alan -0.96..0.96, ön yüz +z yola bakar); şehirdeki arabalar ve
// insanlar aynı boyda kalsın diye model, görünümün 2x2 büyütmesini geri alacak şekilde küçültülür.
// Park yerleri ve kapı sites.ts'te (trafik de oradan okur).

const CURB = pm('#c9c4b8', 0.9);

// Dünya ölçüsünde çiz, 2x2 büyütmeyi geri al
function store2(build: (st: THREE.Group, site: Site) => void, site: Site) {
  const st = new THREE.Group();
  build(st, site);
  st.scale.setScalar(1 / 1.92);
  return mergeStatic([st]);
}

// Ortak zemin: taban taşı, otopark (z 0.1..0.96), otoparkla yaya yolu arasında alçak bordür, ortada kapıdan yola
// yaya geçidi, iki köşede aydınlatma direği
function lotAndWalk(st: THREE.Group, site: Site) {
  box(st, 1.92, 0.03, 1.92, M.paving, 0, 0, 0);
  drawLot(st, site, -0.94, 0.94, 0.1, 0.96);
  box(st, 0.84, 0.008, 0.012, CURB, -0.5, 0.03, 0.094);
  box(st, 0.84, 0.008, 0.012, CURB, 0.5, 0.03, 0.094);
  for (let k = 0; k < 7; k++) box(st, 0.1, 0.0012, 0.035, LINE, 0, 0.034, 0.47 + k * 0.07);
  lotLight(st, -0.935, 0.6);
  lotLight(st, 0.935, 0.6);
}

// Düz çatı: kenar duvarı ve klima/havalandırma kutuları
export function flatRoof(st: THREE.Object3D, cx: number, cz: number, w: number, d: number, y: number, edge: THREE.Material) {
  box(st, w + 0.012, 0.006, d + 0.012, pm('#8f979f', 0.9), cx, y, cz);
  for (const s of [-1, 1]) {
    box(st, w + 0.02, 0.03, 0.012, edge, cx, y, cz + (s * (d + 0.008)) / 2);
    box(st, 0.012, 0.03, d - 0.004, edge, cx + (s * (w + 0.008)) / 2, y, cz);
  }
}
export function hvac(st: THREE.Object3D, x: number, z: number, y: number) {
  box(st, 0.09, 0.045, 0.07, pm('#cfd8dc', 0.5), x, y, z);
  for (const dx of [-0.022, 0.022]) add(st, new THREE.CylinderGeometry(0.016, 0.016, 0.003, 14), M.iron, x + dx, y + 0.0465, z);
}

// =====================================================================================================
// Hırdavat (büyük yapı market): oluklu metal mağaza, turuncu bant ve tabela, camlı giriş bölümü ve saçak,
// sağda kereste sundurması (yığılı keresteler, forklift), önde tuğla paletleri, tüp kafesi, alışveriş arabaları.
// =====================================================================================================
export function makeStore2() {
  return store2((st, site) => {
    lotAndWalk(st, site);
    const orange = pm('#ef6c00', 0.6), dark = pm('#37474f', 0.6);
    const W = 1.28, D = 0.86, H = 0.34, cx = -0.28, cz = -0.49, front = cz + D / 2;
    st.add(part(KIT.facadeBox(W, H, D, 0.03), KIT.METAL[0], cx, 0.03 + H / 2, cz));
    flatRoof(st, cx, cz, W, D, 0.03 + H, pm('#dfe3e8', 0.6));
    box(st, W + 0.012, 0.06, 0.014, orange, cx, 0.03 + H - 0.075, front + 0.007);
    box(st, 0.6, 0.1, 0.014, signMat('HIRDAVAT', '#ef6c00'), -0.45, 0.16, front + 0.008);
    // Vitrin camları (solda): içinde aletler
    for (const x of [-0.84, -0.7]) {
      box(st, 0.12, 0.09, 0.008, showcaseMat, x, 0.06, front + 0.004);
      for (let k = 0; k < 3; k++) box(st, 0.025, 0.04, 0.012, PAINT[(k + (x > -0.8 ? 2 : 0)) % PAINT.length], x - 0.035 + k * 0.035, 0.06, front - 0.01);
    }
    // Camlı giriş bölümü, kapı ve turuncu saçak
    box(st, 0.28, 0.22, 0.05, windowMat, 0, 0.03, front + 0.02);
    box(st, 0.29, 0.02, 0.055, dark, 0, 0.25, front + 0.02);
    entrance(st, 0, front + 0.045, 0.14, 0.17, dark);
    box(st, 0.36, 0.014, 0.12, orange, 0, 0.27, front + 0.09);
    for (const s of [-1, 1]) cyl(st, 0.005, 0.005, 0.24, M.iron, s * 0.16, 0.03, front + 0.14, 6);
    // Kereste sundurması (sağda): çatı, direkler, yığınlar, forklift, alçak tel çit
    const sx0 = 0.4, sx1 = 0.92, sz0 = -0.92, sz1 = -0.1;
    const roof = box(st, sx1 - sx0 + 0.03, 0.014, sz1 - sz0 + 0.03, pm('#78838e', 0.5, 0.4), (sx0 + sx1) / 2, 0.27, (sz0 + sz1) / 2);
    roof.rotation.x = 0.04;
    for (const x of [sx0 + 0.015, sx1 - 0.015]) for (const z of [sz0 + 0.02, (sz0 + sz1) / 2, sz1 - 0.02]) cyl(st, 0.008, 0.008, 0.24, M.iron, x, 0.03, z, 6);
    box(st, 0.3, 0.05, 0.012, signMat('KERESTE', '#6d4c41'), (sx0 + sx1) / 2, 0.21, sz1 + 0.006);
    const plank = pm('#d7b17a', 0.8), plankDark = pm('#b98e57', 0.8);
    for (const [k, x] of [0.5, 0.64, 0.78].entries()) {
      for (let l = 0; l < 4 - (k % 2); l++) {
        box(st, 0.1, 0.02, 0.5, l % 2 ? plankDark : plank, x, 0.03 + l * 0.021, -0.55);
        box(st, 0.104, 0.004, 0.02, M.iron, x, 0.03 + l * 0.021 + 0.017, -0.4);
      }
    }
    // Forklift: sarı gövde, direk, çatallarda palet
    const fl = item(st, 0.66, -0.22, Math.PI);
    box(fl, 0.07, 0.04, 0.1, pm('#fbc02d', 0.5), 0, 0.008, 0);
    box(fl, 0.06, 0.035, 0.035, M.iron, 0, 0.048, 0.025);
    for (const s of [-1, 1]) {
      rod(fl, [s * 0.03, 0.05, -0.02], [s * 0.03, 0.12, -0.02], 0.003, M.iron, 4);
      add(fl, new THREE.CylinderGeometry(0.012, 0.012, 0.008, 10).rotateZ(Math.PI / 2), M.iron, s * 0.038, 0.012, 0.03);
      add(fl, new THREE.CylinderGeometry(0.012, 0.012, 0.008, 10).rotateZ(Math.PI / 2), M.iron, s * 0.038, 0.012, -0.035);
    }
    rod(fl, [-0.03, 0.12, -0.02], [0.03, 0.12, -0.02], 0.003, M.iron, 4);
    for (const s of [-1, 1]) box(fl, 0.008, 0.004, 0.07, M.iron, s * 0.018, 0.03, -0.085);
    box(fl, 0.07, 0.03, 0.07, plank, 0, 0.036, -0.085);
    for (let k = 0; k <= 6; k++) rod(st, [sx0 + 0.02 + k * 0.08, 0.03, -0.075], [sx0 + 0.02 + k * 0.08, 0.1, -0.075], 0.003, M.gray, 4);
    rod(st, [sx0 + 0.02, 0.1, -0.075], [sx1 - 0.02, 0.1, -0.075], 0.0025, M.gray, 4);
    // Yaya yolunda: tuğla paletleri, tüp kafesi, alışveriş arabaları, saksılar
    const brick = pm('#b5523b', 0.9);
    for (const x of [-0.82, -0.68]) {
      box(st, 0.1, 0.012, 0.08, M.wood, x, 0.03, 0.02);
      for (let l = 0; l < 3; l++) box(st, 0.094, 0.018, 0.074, brick, x, 0.042 + l * 0.019, 0.02);
      box(st, 0.096, 0.004, 0.076, pm('#e0e0e0', 0.4), x, 0.1, 0.02);
    }
    box(st, 0.1, 0.11, 0.06, pm('#9aa5b1', 0.4, 0.6), -0.52, 0.03, 0.0);
    for (let k = 0; k < 3; k++) cyl(st, 0.012, 0.012, 0.07, pm('#1e88e5', 0.4, 0.3), -0.55 + k * 0.03, 0.035, 0.0, 10);
    for (let k = 0; k < 4; k++) {
      const c = item(st, 0.2 + k * 0.024, 0.02, Math.PI);
      box(c, 0.05, 0.03, 0.07, pm('#ef6c00', 0.5), 0, 0.02, 0);
      rod(c, [-0.025, 0.05, -0.035], [0.025, 0.05, -0.035], 0.0025, M.iron, 4);
    }
    // Çatıda klimalar ve tepe pencereleri
    for (const [x, z] of [[-0.75, -0.7], [-0.55, -0.7], [0.1, -0.75]]) hvac(st, x, z, 0.03 + H + 0.006);
    for (let k = 0; k < 4; k++) box(st, 0.12, 0.018, 0.12, windowMat, -0.7 + k * 0.28, 0.03 + H + 0.006, -0.35);
    person(st, 0.55, -0.15, 2.4, 3, 'stand', 0.03, 1.05, orange);
  }, SITES.store);
}

// =====================================================================================================
// Pazar: kırmızı ahşap pazar ambarı (kırma çatı, büyük açık kapı, beyaz çaprazlı kanatlar, PAZAR tabelası),
// önündeki meydanda tenteli tezgâhlar ve sebze-meyve kasaları, ampul zincirleri; solda kasası dolu kamyonet,
// sağda kasalar, çuvallar ve saman balyaları.
// =====================================================================================================
export function makeMarket2() {
  return store2((st, site) => {
    lotAndWalk(st, site);
    const barn = pm('#b23b2e', 0.85), trim = pm('#f6f0e6', 0.7), roofM = pm('#3e4650', 0.7);
    const W = 1.24, D = 0.7, H = 0.26, cz = -0.57, front = cz + D / 2;
    box(st, W, H, D, barn, 0, 0.03, cz);
    // Ambar çatısı (alnı öne bakar)
    const s = new THREE.Shape([new THREE.Vector2(-0.67, 0), new THREE.Vector2(0.67, 0), new THREE.Vector2(0.44, 0.17), new THREE.Vector2(0, 0.3), new THREE.Vector2(-0.44, 0.17)]);
    add(st, new THREE.ExtrudeGeometry(s, { depth: D + 0.06, bevelEnabled: false }), roofM, 0, 0.03 + H, cz - D / 2 - 0.03);
    // Alınlık (öndeki üçgen): ambar renginde, önünde PAZAR tabelası
    const gs = new THREE.Shape([new THREE.Vector2(-0.6, 0), new THREE.Vector2(0.6, 0), new THREE.Vector2(0.4, 0.15), new THREE.Vector2(0, 0.26), new THREE.Vector2(-0.4, 0.15)]);
    add(st, new THREE.ShapeGeometry(gs), barn, 0, 0.03 + H, front + 0.032);
    box(st, 0.4, 0.08, 0.012, signMat('PAZAR', '#2e7d32'), 0, 0.03 + H + 0.05, front + 0.038);
    // Köşelerde beyaz kenar çıtaları
    for (const x of [-W / 2, W / 2]) box(st, 0.02, H, 0.02, trim, x, 0.03, front);
    // Büyük kapı: karanlık açıklık, iki yana açılmış çaprazlı kanatlar
    entrance(st, 0, front + 0.001, 0.24, 0.2, trim);
    for (const sx of [-1, 1]) {
      const leaf = item(st, sx * 0.135, front + 0.004, sx * 1.2, 1, 0.03);
      box(leaf, 0.13, 0.2, 0.008, barn, sx * 0.065, 0, 0.004);
      rod(leaf, [sx * 0.005, 0.01, 0.01], [sx * 0.125, 0.19, 0.01], 0.004, trim, 4);
      rod(leaf, [sx * 0.125, 0.01, 0.01], [sx * 0.005, 0.19, 0.01], 0.004, trim, 4);
    }
    // Yan pencereler
    for (const x of [-0.42, 0.42]) {
      box(st, 0.12, 0.08, 0.008, trim, x, 0.12, front + 0.003);
      box(st, 0.1, 0.064, 0.008, windowMat, x, 0.128, front + 0.006);
    }
    // Meydanda tenteli tezgâhlar (ortada kapıya giden yol açık)
    const awnings = ['#43a047', '#e53935', '#fbc02d', '#1e88e5'];
    const goods = ['#ff8f00', '#7cb342', '#e53935', '#8e24aa', '#fdd835'].map(c => pm(c, 0.7));
    [-0.62, -0.32, 0.32, 0.62].forEach((x, k) => {
      const z = -0.09;
      box(st, 0.22, 0.06, 0.1, M.wood, x, 0.03, z);
      for (const dx of [-0.1, 0.1]) cyl(st, 0.005, 0.005, 0.2, M.iron, x + dx, 0.03, z - 0.045, 6);
      for (let q = 0; q < 4; q++) {
        const strip = add(st, new THREE.BoxGeometry(0.06, 0.008, 0.14), pm(q % 2 ? '#ffffff' : awnings[k], 0.8), x - 0.09 + q * 0.06, 0.24, z + 0.01);
        strip.rotation.x = 0.3;
      }
      for (let c = 0; c < 3; c++) {
        box(st, 0.06, 0.028, 0.06, pm('#c8955a', 0.9), x - 0.07 + c * 0.07, 0.09, z);
        for (let f = 0; f < 3; f++) add(st, new THREE.SphereGeometry(0.014, 8, 6), goods[(k + c + f) % goods.length], x - 0.085 + c * 0.07 + f * 0.015, 0.128, z + (f % 2) * 0.012 - 0.006);
      }
      // Tezgâhın önünde yerde kasalar
      box(st, 0.05, 0.03, 0.05, pm('#c8955a', 0.9), x + 0.06, 0.03, z + 0.08);
      add(st, new THREE.SphereGeometry(0.014, 8, 6), goods[(k + 2) % goods.length], x + 0.06, 0.07, z + 0.08);
    });
    // Ampul zincirleri: ambardan meydanın önündeki direklere
    for (const sx of [-1, 1]) {
      const px = sx * 0.85, pz = 0.06;
      cyl(st, 0.005, 0.006, 0.26, M.iron, px, 0.03, pz, 6);
      const a = new THREE.Vector3(sx * 0.3, 0.27, front + 0.03), b = new THREE.Vector3(px, 0.29, pz);
      for (let k = 1; k < 12; k++) {
        const p = a.clone().lerp(b, k / 12);
        p.y -= Math.sin((k / 12) * Math.PI) * 0.04;
        add(st, BULB_GEO, BULB, p.x, p.y, p.z);
      }
    }
    // Solda kasası dolu kamyonet, sağda kasalar, çuvallar ve saman balyaları
    car(st, 'pickup', -0.8, -0.55, 0, '#6d8b74', 1);
    for (let c = 0; c < 2; c++) box(st, 0.05, 0.025, 0.05, pm('#c8955a', 0.9), -0.8 + (c - 0.5) * 0.055, 0.105, -0.63);
    const hay = pm('#e5c46a', 1);
    for (const [x, z, y] of [[0.78, -0.55, 0.03], [0.86, -0.55, 0.03], [0.82, -0.55, 0.075]]) box(st, 0.075, 0.045, 0.11, hay, x, y, z);
    for (let k = 0; k < 3; k++) {
      const sack = add(st, new THREE.CapsuleGeometry(0.02, 0.03, 4, 8), pm('#d7c4a3', 1), 0.72 + k * 0.05, 0.055, -0.3);
      sack.rotation.z = 0.2 * (k - 1);
    }
    for (let k = 0; k < 4; k++) box(st, 0.06, 0.03, 0.06, pm('#c8955a', 0.9), 0.82, 0.03 + k * 0.031, -0.82);
    tree(st, PROPS.treeLarge, 0.8, -0.2, 0.32);
    person(st, -0.3, 0.0, Math.PI, 1, 'stand', 0.03, 1.05);
    person(st, 0.62, -0.18, 0, 6, 'stand', 0.03, 1.05);
  }, SITES.market);
}

// =====================================================================================================
// Mobilya: iki katlı mağaza; zemin katta boydan boya cam vitrin (içi aydınlık: köşe koltuk, berjer, sehpa,
// lambader, yemek masası, yatak), üst katta yeşil bant ve MOBİLYA tabelası; sağda yükleme yolu ve teslimat
// kamyoneti, yan duvarda yükleme kapısı, kolili el arabası iten görevli.
// =====================================================================================================
export function makeFurniture2() {
  return store2((st, site) => {
    lotAndWalk(st, site);
    const teal = pm('#00796b', 0.6), dark = pm('#263238', 0.5);
    const X0 = -0.92, X1 = 0.6, cx = (X0 + X1) / 2, W = X1 - X0, Z0 = -0.92, ZF = -0.06, SHOW = 0.18;
    const G = 0.22, H = 0.46; // zemin kat ve toplam yükseklik
    const zi = ZF - SHOW; // vitrinin arka duvarı
    // Arka dolu gövde, üst kat (öne kadar), vitrinin tabanı ve iç duvarı
    st.add(part(KIT.facadeBox(W, G, zi - Z0, 0.03), KIT.HOME[1], cx, 0.03 + G / 2, (Z0 + zi) / 2));
    st.add(part(KIT.facadeBox(W, H - G, ZF - Z0, 0.03 + G), KIT.HOME[1], cx, 0.03 + G + (H - G) / 2, (Z0 + ZF) / 2));
    box(st, W - 0.02, 0.006, SHOW, pm('#d7ccc8', 0.6), cx, 0.03, zi + SHOW / 2);
    st.add(part(new THREE.BoxGeometry(W - 0.03, G - 0.01, 0.002), litWall(), cx, 0.03 + (G - 0.01) / 2, zi + 0.001));
    for (const x of [X0 + 0.012, X1 - 0.012]) box(st, 0.024, G, SHOW, KIT.T.white, x, 0.03, zi + SHOW / 2);
    // Ön cam ve dikmeler; üstte yeşil bant ve tabela
    box(st, W - 0.03, G - 0.012, 0.004, SHOP_GLASS, cx, 0.036, ZF);
    for (let k = 0; k <= 8; k++) box(st, 0.008, G - 0.01, 0.008, dark, X0 + 0.015 + (k * (W - 0.03)) / 8, 0.036, ZF + 0.001);
    box(st, W + 0.012, 0.035, 0.03, teal, cx, 0.03 + G, ZF - 0.008);
    box(st, 0.62, 0.1, 0.012, signMat('MOBİLYA', '#00796b'), cx, 0.03 + G + 0.07, ZF + 0.007);
    flatRoof(st, cx, (Z0 + ZF) / 2, W, ZF - Z0, 0.03 + H, pm('#dfe3e8', 0.6));
    // Vitrindeki eşyalar: köşe koltuk, berjer, sehpa, lambader, yemek masası ve sandalyeler, yatak
    const sofa = pm('#c2185b', 0.9), beige = pm('#d7ccc8', 0.9), blue = pm('#3f51b5', 0.8);
    const zc = ZF - 0.08;
    box(st, 0.26, 0.04, 0.08, sofa, -0.72, 0.036, zc);
    box(st, 0.26, 0.06, 0.02, sofa, -0.72, 0.036, zc - 0.035);
    box(st, 0.08, 0.04, 0.12, sofa, -0.83, 0.036, zc + 0.03);
    box(st, 0.08, 0.012, 0.06, M.wood, -0.66, 0.06, zc + 0.04);
    box(st, 0.07, 0.05, 0.07, blue, -0.48, 0.036, zc);
    box(st, 0.07, 0.04, 0.015, blue, -0.48, 0.07, zc - 0.03);
    rod(st, [-0.4, 0.036, zc - 0.04], [-0.4, 0.17, zc - 0.04], 0.003, M.iron, 4);
    add(st, new THREE.ConeGeometry(0.025, 0.03, 10, 1, true), beige, -0.4, 0.17, zc - 0.04);
    box(st, 0.16, 0.008, 0.07, M.wood, -0.22, 0.08, zc);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(st, 0.006, 0.05, 0.006, M.darkWood, -0.22 + sx * 0.07, 0.036, zc + sz * 0.028);
    for (const dx of [-0.05, 0.05]) for (const sz of [-1, 1]) {
      box(st, 0.035, 0.005, 0.035, M.wood, -0.22 + dx, 0.06, zc + sz * 0.055);
      box(st, 0.035, 0.04, 0.005, M.wood, -0.22 + dx, 0.06, zc + sz * 0.072);
    }
    box(st, 0.22, 0.035, 0.13, M.white, 0.25, 0.036, zc + 0.01);
    box(st, 0.22, 0.012, 0.13, beige, 0.25, 0.071, zc + 0.01);
    box(st, 0.22, 0.08, 0.015, M.darkWood, 0.25, 0.036, zc - 0.06);
    for (const dx of [-0.05, 0.05]) box(st, 0.06, 0.015, 0.035, M.white, 0.25 + dx, 0.083, zc - 0.03);
    box(st, 0.1, 0.06, 0.05, M.wood, 0.47, 0.036, zc - 0.02);
    // Kapı ve saçak
    entrance(st, 0, ZF + 0.003, 0.14, 0.17, dark);
    box(st, 0.3, 0.012, 0.11, teal, 0, 0.215, ZF + 0.055);
    // Yan yükleme yolu: kamyonet, yükleme kapısı, koliler, el arabasıyla görevli
    box(st, 0.3, 0.004, 0.84, pm('#5b6170', 0.9), 0.77, 0.03, -0.5);
    car(st, 'van', 0.78, -0.62, 0, '#ffffff', 1);
    box(st, 0.003, 0.03, 0.2, teal, 0.78 + 0.067, 0.07, -0.66);
    box(st, 0.006, 0.17, 0.16, pm('#e9edf1', 0.5, 0.3), X1 + 0.003, 0.03, -0.3);
    for (let k = 0; k < 7; k++) box(st, 0.008, 0.003, 0.152, M.gray, X1 + 0.004, 0.05 + k * 0.022, -0.3);
    carton(st, 0.06, 0.07, 0.05, 0.7, 0.03, -0.18, 0.2);
    carton(st, 0.05, 0.06, 0.05, 0.7, 0.1, -0.18, -0.1);
    handTruck(st, 0.66, -0.36, -Math.PI / 2 + 0.3);
    person(st, 0.7, -0.33, -Math.PI / 2 + 0.3, 0, 'push', 0.03, 1.05, teal);
    // Yaya yolunda saksılar
    for (const x of [-0.42, 0.42]) planter(st, x, 0.03, 0.035, x > 0 ? 2 : 0);
  }, SITES.furniture);
}

// =====================================================================================================
// Fırın: iki katlı tuğla bina, kahverengi-krem çizgili tente, vitrinde ekmekler ve pastalar, FIRIN tabelası,
// arkada fırın bacası; solda ahşap terasta şemsiyeli masalarda oturan insanlar, kara tahta menü.
// =====================================================================================================
export function makeBakery2() {
  return store2((st, site) => {
    lotAndWalk(st, site);
    const brown = pm('#6d4c41', 0.7), cream = pm('#fff3e0', 0.8);
    const X0 = -0.46, X1 = 0.92, cx = (X0 + X1) / 2, W = X1 - X0, Z0 = -0.92, ZF = -0.06, H = 0.42;
    st.add(part(KIT.facadeBox(W, H, ZF - Z0, 0.03), KIT.BRICK[1], cx, 0.03 + H / 2, (Z0 + ZF) / 2));
    flatRoof(st, cx, (Z0 + ZF) / 2, W, ZF - Z0, 0.03 + H, pm('#efe6d8', 0.7));
    // Zemin kat vitrinleri (kapının iki yanında): krem çerçeve, cam, rafta ekmek ve pastalar
    const bread = pm('#d9a35b', 0.8), crust = pm('#b0742f', 0.8);
    for (const [x0, x1] of [[X0 + 0.06, -0.1], [0.1, X1 - 0.06]] as [number, number][]) {
      const w = x1 - x0, x = (x0 + x1) / 2;
      box(st, w + 0.02, 0.13, 0.01, cream, x, 0.045, ZF + 0.002);
      box(st, w, 0.11, 0.008, showcaseMat, x, 0.055, ZF + 0.006);
      box(st, w, 0.006, 0.04, M.wood, x, 0.07, ZF - 0.02);
      const n = Math.floor(w / 0.05);
      for (let k = 0; k < n; k++) {
        const px = x0 + 0.025 + k * (w / n);
        if (k % 3 === 2) {
          cyl(st, 0.018, 0.018, 0.02, pm(['#f8bbd0', '#fff1d0', '#8d6e63'][k % 3], 0.7), px, 0.076, ZF - 0.02, 12);
          add(st, new THREE.SphereGeometry(0.005, 6, 4), pm('#c62828', 0.4), px, 0.1, ZF - 0.02);
        } else {
          const loaf = add(st, new THREE.CapsuleGeometry(0.009, 0.022, 4, 8), k % 2 ? bread : crust, px, 0.085, ZF - 0.02);
          loaf.rotation.z = Math.PI / 2;
        }
      }
    }
    // Çizgili tente ve tabela
    for (let k = 0; k < 18; k++) {
      const x = X0 + 0.04 + k * ((W - 0.08) / 18) + (W - 0.08) / 36;
      const s = add(st, new THREE.BoxGeometry((W - 0.08) / 18, 0.006, 0.12), k % 2 ? cream : brown, x, 0.2, ZF + 0.05);
      s.rotation.x = 0.35;
    }
    box(st, 0.5, 0.09, 0.012, signMat('FIRIN', '#6d4c41'), 0.35, 0.27, ZF + 0.007);
    entrance(st, 0, ZF + 0.003, 0.11, 0.15, brown);
    // Üst kat pencerelerinin altında çiçeklikler
    for (const x of [-0.25, 0.1, 0.45, 0.78]) {
      box(st, 0.12, 0.016, 0.03, brown, x, 0.29, ZF + 0.015);
      for (let k = 0; k < 4; k++) add(st, FLOWER_GEO, FLOWERS[(k + Math.round(x * 10)) % FLOWERS.length], x - 0.045 + k * 0.03, 0.31, ZF + 0.015);
    }
    // Arkada fırın bacası ve tüten duman (sabit)
    box(st, 0.08, 0.2, 0.08, pm('#8d5a44', 0.9), 0.7, 0.03 + H, -0.75);
    box(st, 0.1, 0.02, 0.1, M.iron, 0.7, 0.03 + H + 0.2, -0.75);
    // Teras (solda): ahşap zemin, alçak korkuluk, şemsiyeli masalar, oturanlar, menü tahtası
    const tx0 = -0.92, tx1 = -0.5;
    box(st, tx1 - tx0, 0.006, 0.94, pm('#a1774f', 0.85), (tx0 + tx1) / 2, 0.03, -0.43);
    for (let k = 0; k < 9; k++) box(st, 0.003, 0.0008, 0.94, pm('#7b5634', 0.9), tx0 + 0.04 + k * 0.042, 0.0362, -0.43);
    for (const z of [-0.9, 0.035]) rod(st, [tx0 + 0.01, 0.08, z], [tx1 - 0.01, 0.08, z], 0.0035, M.white, 4);
    for (let k = 0; k <= 10; k++) rod(st, [tx0 + 0.01, 0.036, -0.9 + k * 0.0935], [tx0 + 0.01, 0.08, -0.9 + k * 0.0935], 0.0025, M.white, 4);
    const tables: [number, number, number[], [number, number][], string][] = [
      [-0.73, -0.7, [0.6, 2.4, 4.2], [[0, 1], [1, 3]], '#c62828'],
      [-0.73, -0.4, [0.9, 3.0, 5.0], [[1, 6]], '#2e7d32'],
      [-0.73, -0.1, [1.4, 3.6], [[0, 4]], '#6d4c41'],
    ];
    for (const [x, z, seats, sitters, c] of tables) {
      patioTable(st, x, z, seats, sitters, pm('#e53935', 0.5));
      umbrella(st, x, z, 0.17, 0.08, pm(c, 0.6), M.white);
    }
    const sign = item(st, -0.55, 0.0, 0.4);
    for (const s of [-1, 1]) rod(sign, [s * 0.025, 0, s * 0.012], [s * 0.025, 0.09, 0], 0.002, M.wood, 4);
    box(sign, 0.055, 0.07, 0.004, pm('#263238', 0.9), 0, 0.02, 0.008);
    person(st, 0.15, 0.02, Math.PI, 5, 'stand', 0.03, 1.05);
  }, SITES.bakery);
}

// =====================================================================================================
// Butik: iki katlı modern mağaza; zemin katta boydan boya cam vitrin ve renkli kıyafetli mankenler, üstte cam
// cephe ve pembe BUTİK tabelası, solda yuvarlak cam köşe kulesi; girişte pembe saçak ve kırmızı halı,
// yaya yolunda top şeklinde budanmış bitkiler.
// =====================================================================================================
export function makeFashion2() {
  return store2((st, site) => {
    lotAndWalk(st, site);
    const pink = pm('#c2185b', 0.5), dark = pm('#263238', 0.5);
    const X0 = -0.92, X1 = 0.92, cx = 0, W = X1 - X0, Z0 = -0.92, ZF = -0.06, SHOW = 0.16, G = 0.22, H = 0.5;
    const zi = ZF - SHOW;
    st.add(part(KIT.facadeBox(W, G, zi - Z0, 0.03), KIT.GLASS[4], cx, 0.03 + G / 2, (Z0 + zi) / 2));
    st.add(part(KIT.facadeBox(W, H - G, ZF - Z0, 0.03 + G), KIT.GLASS[4], cx, 0.03 + G + (H - G) / 2, (Z0 + ZF) / 2));
    box(st, W - 0.02, 0.006, SHOW, pm('#f5f5f5', 0.4), cx, 0.03, zi + SHOW / 2);
    st.add(part(new THREE.BoxGeometry(W - 0.03, G - 0.01, 0.002), litWall(), cx, 0.03 + (G - 0.01) / 2, zi + 0.001));
    for (const x of [X0 + 0.012, X1 - 0.012]) box(st, 0.024, G, SHOW, KIT.T.white, x, 0.03, zi + SHOW / 2);
    box(st, W - 0.03, G - 0.012, 0.004, SHOP_GLASS, cx, 0.036, ZF);
    for (let k = 0; k <= 10; k++) box(st, 0.006, G - 0.01, 0.008, M.white, X0 + 0.015 + (k * (W - 0.03)) / 10, 0.036, ZF + 0.001);
    box(st, W + 0.012, 0.03, 0.03, M.white, cx, 0.03 + G, ZF - 0.008);
    box(st, 0.62, 0.11, 0.012, signMat('BUTİK', '#c2185b'), 0.3, 0.03 + G + 0.08, ZF + 0.008);
    flatRoof(st, cx, (Z0 + ZF) / 2, W, ZF - Z0, 0.03 + H, M.white);
    // Solda yuvarlak cam köşe kulesi ve pembe tepe
    cyl(st, 0.15, 0.15, 0.6, KIT.GLASS[2], -0.74, 0.03, -0.24, 20);
    cyl(st, 0.16, 0.16, 0.03, pink, -0.74, 0.62, -0.24, 20);
    // Vitrinde mankenler (renk renk elbise ve takım), kaidelerde
    const outfits = ['#42a5f5', '#ffb300', '#ab47bc', '#ef5350', '#26a69a', '#f06292', '#5c6bc0', '#8d6e63'];
    for (let k = 0; k < 10; k++) {
      const x = X0 + 0.12 + k * 0.17;
      if (Math.abs(x) < 0.1) continue;
      const z = ZF - 0.07;
      cyl(st, 0.02, 0.022, 0.012, M.white, x, 0.036, z, 12);
      add(st, new THREE.CylinderGeometry(0.013, k % 2 ? 0.024 : 0.016, 0.07, 10), pm(outfits[k % outfits.length], 0.7), x, 0.083, z);
      add(st, new THREE.SphereGeometry(0.011, 8, 6), M.white, x, 0.132, z);
      rod(st, [x, 0.048, z], [x, 0.05, z], 0.003, M.white, 4);
    }
    // Giriş: pembe saçak, kapı, kırmızı halı
    entrance(st, 0, ZF + 0.003, 0.13, 0.17, dark);
    box(st, 0.32, 0.012, 0.12, pink, 0, 0.215, ZF + 0.06);
    box(st, 0.12, 0.002, 0.12, pm('#b71c1c', 0.9), 0, 0.03, ZF + 0.06);
    for (const s of [-1, 1]) {
      // Kapının iki yanında topiari (budanmış top bitki) saksıları
      box(st, 0.05, 0.05, 0.05, pm('#9e9e9e', 0.6), s * 0.16, 0.03, ZF + 0.05);
      add(st, new THREE.IcosahedronGeometry(0.03, 1), M.hedge, s * 0.16, 0.11, ZF + 0.05);
      add(st, new THREE.IcosahedronGeometry(0.02, 1), M.hedge, s * 0.16, 0.16, ZF + 0.05);
    }
    for (const x of [-0.55, 0.55]) {
      box(st, 0.16, 0.035, 0.05, pm('#9e9e9e', 0.6), x, 0.03, 0.03);
      flowerBed(st, x, 0.03, 0.14, 0.035, x > 0 ? 3 : 1, 0.065);
    }
    person(st, -0.3, 0.02, Math.PI - 0.4, 7, 'stand', 0.03, 1.05);
    person(st, 0.42, 0.03, Math.PI + 0.5, 2, 'carry', 0.03, 1.05);
  }, SITES.fashion);
}

// =====================================================================================================
// Bahçe market: büyük iki bölmeli cam sera (içi bitki dolu), yeşil giriş ve BAHÇE tabelası, sağda çakıl
// zeminde sıra sıra fidanlar ve çit, önde basamaklı çiçek tezgâhları, cüceler, toprak torbaları, el arabası.
// =====================================================================================================
export function makeGarden2() {
  return store2((st, site) => {
    lotAndWalk(st, site);
    const green = pm('#2e7d32', 0.6);
    const cx = -0.36, cz = -0.57, W = 1.1, D = 0.7, front = cz + D / 2;
    greenhouse(st, cx, cz, W, D);
    // Giriş bölümü (kapı x = 0), BAHÇE tabelası, ampuller, asılı çiçek sepetleri
    box(st, 0.24, 0.18, 0.06, green, 0, 0.03, front + 0.03);
    box(st, 0.26, 0.016, 0.075, M.white, 0, 0.21, front + 0.035);
    entrance(st, 0, front + 0.06, 0.12, 0.14, green);
    box(st, 0.36, 0.08, 0.014, green, 0, 0.215, front + 0.07);
    box(st, 0.33, 0.06, 0.012, signMat('BAHÇE', '#2e7d32'), 0, 0.225, front + 0.075);
    for (let k = 0; k < 9; k++) add(st, BULB_GEO, BULB, -0.1 + k * 0.025, 0.205, front + 0.095);
    for (const sx of [-1, 1]) {
      const hx = sx * 0.15, hz = front + 0.09;
      rod(st, [hx, 0.19, hz], [hx, 0.16, hz], 0.0012, M.iron, 3);
      add(st, new THREE.SphereGeometry(0.016, 10, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.darkWood, hx, 0.152, hz);
      add(st, LEAF_MOUND, LEAVES[1], hx, 0.153, hz);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        add(st, BLOOM, FLOWERS[(k + (sx > 0 ? 3 : 0)) % FLOWERS.length], hx + Math.cos(a) * 0.012, 0.158, hz + Math.sin(a) * 0.012);
      }
    }
    // Sağda fidanlık: çakıl zemin, sıra sıra saksılı fidanlar, çit, toprak torbaları
    box(st, 0.66, 0.004, 0.84, GRAVEL, 0.58, 0.03, -0.5);
    let k = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 7; j++) sapling(st, 0.32 + i * 0.12 + (j % 2) * 0.015, -0.86 + j * 0.1, k++);
    for (let j = 0; j <= 10; j++) rod(st, [0.915, 0.03, -0.92 + j * 0.084], [0.915, 0.08, -0.92 + j * 0.084], 0.003, M.darkWood, 4);
    for (const y of [0.05, 0.075]) rod(st, [0.915, y, -0.92], [0.915, y, -0.08], 0.003, M.wood, 4);
    soilPallet(st, 0.4, -0.13, 0.1, 3);
    soilPallet(st, 0.55, -0.13, -0.05, 2);
    potStack(st, 0.7, -0.12);
    wheelbarrow(st, 0.82, -0.15, 0.5);
    // Önde çiçek tezgâhları (yolun iki yanında), çimende cüceler, büyük saksılarda ağaçlar
    flowerStand(st, -0.32, -0.08, 0, 0.26, 0);
    flowerStand(st, 0.3, -0.08, 0, 0.26, 3);
    box(st, 0.22, 0.006, 0.08, M.lawn, -0.66, 0.03, -0.1);
    for (let g = 0; g < 5; g++) gnome(st, -0.75 + g * 0.045, -0.1, 0.15 - g * 0.1, g);
    for (const [x, path, s] of [[-0.88, PROPS.treeBlossom, 0.28], [0.18, PROPS.treeLarge, 0.24]] as [number, string, number][]) {
      box(st, 0.07, 0.04, 0.07, M.wood, x, 0.03, -0.1);
      box(st, 0.06, 0.002, 0.06, M.soil, x, 0.07, -0.1);
      tree(st, path, x, -0.1, s, x * 10);
      (st.children[st.children.length - 1] as THREE.Object3D).position.y = 0.07;
    }
    person(st, -0.15, 0.02, 0.1, 2, 'push', 0.03, 1.05);
    plantCart(st, -0.143, 0.09, 0.1);
  }, SITES.garden);
}

// =====================================================================================================
// Dondurma ve burger: köşeleri yuvarlak retro lokanta (krom alt duvar, kırmızı şerit, geniş camlar, kırmızı
// saçak), çatıda dev dondurma külahı ve dev burger; önde dama desenli terasta şemsiyeli masalar ve oturanlar,
// sağ yüzde dondurma penceresi ve sırada bekleyenler, ışıklı menü panosu, ampul zincirleri.
// =====================================================================================================
export function makeCafe2() {
  return store2((st, site) => {
    lotAndWalk(st, site);
    const red = pm('#d32f2f', 0.5), cream = pm('#fff3e0', 0.6);
    const bw = 1.0, bd = 0.46, bz = -0.62, R = 0.1, front = bz + bd / 2;
    add(st, roundedBox(bw + 0.008, bd + 0.008, R, 0.018), pm('#8e2424', 0.7), 0, 0.03, bz);
    add(st, roundedBox(bw, bd, R, 0.06), pm('#dfe4ea', 0.4, 0.5), 0, 0.048, bz);
    add(st, roundedBox(bw + 0.004, bd + 0.004, R, 0.012), red, 0, 0.082, bz);
    add(st, roundedBox(bw - 0.006, bd - 0.006, R, 0.086), windowMat, 0, 0.094, bz);
    add(st, roundedBox(bw + 0.012, bd + 0.012, R, 0.046), red, 0, 0.18, bz);
    add(st, roundedBox(bw + 0.02, bd + 0.02, R, 0.01), cream, 0, 0.226, bz);
    add(st, roundedBox(bw - 0.01, bd - 0.01, R, 0.004), pm('#b0b8c0', 0.8), 0, 0.236, bz);
    for (let k = 0; k < 14; k++) box(st, 0.005, 0.086, 0.006, CHROME, -0.4 + k * 0.062, 0.094, front - 0.001);
    // Giriş: kırmızı çerçeveli kapı, yuvarlak saçak; iki yanda tabelalar
    entrance(st, 0, front + 0.012, 0.09, 0.14, red);
    add(st, new THREE.CylinderGeometry(0.08, 0.08, 0.008, 16, 1, false, -Math.PI / 2, Math.PI), cream, 0, 0.19, front + 0.02);
    box(st, 0.26, 0.05, 0.008, signMat('BURGER', '#ffd54f', '#c62828'), -0.28, 0.182, front + 0.006);
    box(st, 0.24, 0.045, 0.008, signMat('DONDURMA', '#ec407a'), 0.28, 0.185, front + 0.006);
    // Çatıda dev külah ve dev burger (biraz büyük), saçak boyunca ampuller
    giantCone(item(st, -0.24, bz, 0, 1.25, 0.24), 0, 0, 0);
    giantBurger(item(st, 0.24, bz - 0.02, 0, 1.25, 0.24), 0, 0, 0);
    for (let k = 0; k < 24; k++) add(st, BULB_GEO, BULB, -0.43 + k * 0.0375, 0.231, front + 0.012);
    // Sağ yüzde dondurma penceresi, pembe-beyaz tente, sırada bekleyenler
    const wx = bw / 2 + 0.004;
    box(st, 0.012, 0.07, 0.14, CHROME, wx, 0.1, bz);
    for (let k = 0; k < 6; k++) cyl(st, 0.008, 0.008, 0.006, pm(['#f48fb1', '#fff1d0', '#6d4c41', '#aed581', '#ffcc80', '#ce93d8'][k], 0.5), wx + 0.012, 0.1, bz - 0.06 + k * 0.024, 8);
    for (let k = 0; k < 5; k++) {
      const s = add(st, new THREE.BoxGeometry(0.07, 0.005, 0.03), k % 2 ? M.white : pm('#f06292', 0.7), wx + 0.035, 0.185, bz - 0.06 + k * 0.03);
      s.rotation.z = -0.4;
    }
    person(st, wx + 0.07, bz + 0.0, -Math.PI / 2, 5, 'stand', 0.03, 1.05);
    person(st, wx + 0.12, bz + 0.05, -Math.PI / 2 + 0.3, 7, 'stand', 0.03, 1.05);
    // Işıklı menü panosu
    const mb = item(st, -0.72, -0.62, Math.PI / 2);
    box(mb, 0.13, 0.1, 0.012, M.iron, 0, 0.05, 0);
    add(mb, screenGeo(0.12, 0.09, [0, 0, 1, 1]), menuMat(), 0, 0.1, 0.0065);
    for (const sx of [-0.05, 0.05]) box(mb, 0.008, 0.05, 0.008, M.iron, sx, 0, 0);
    box(mb, 0.14, 0.008, 0.024, red, 0, 0.15, 0.004);
    // Teras: dama desenli zemin, alçak beyaz korkuluk (ortası açık), şemsiyeli masalar
    const tz0 = front + 0.03, tz1 = 0.08;
    box(st, 1.76, 0.004, tz1 - tz0, cream, 0, 0.03, (tz0 + tz1) / 2);
    const n = 22, m = 4;
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if ((i + j) % 2) box(st, 1.76 / n, 0.002, (tz1 - tz0) / m, pm('#ef9a9a', 0.9), -0.88 + (i + 0.5) * (1.76 / n), 0.034, tz0 + (j + 0.5) * ((tz1 - tz0) / m));
    for (const sx of [-1, 1]) {
      rod(st, [sx * 0.1, 0.07, tz1], [sx * 0.88, 0.07, tz1], 0.003, M.white, 4);
      for (let k = 0; k <= 8; k++) rod(st, [sx * (0.1 + k * 0.0975), 0.034, tz1], [sx * (0.1 + k * 0.0975), 0.07, tz1], 0.0022, M.white, 4);
    }
    const chairRed = pm('#e53935', 0.5), chairTeal = pm('#26a69a', 0.5);
    const tables: [number, number, THREE.Material, number[], [number, number][]][] = [
      [-0.68, -0.18, M.red, [0.6, 2.4, 4.2], [[0, 1], [1, 3]]],
      [-0.32, -0.16, pm('#26a69a', 0.6), [0.9, 3.0, 5.0], [[1, 6]]],
      [0.32, -0.17, pm('#fbc02d', 0.6), [1.4, 3.6], [[0, 4]]],
      [0.68, -0.16, M.red, [0.2, 2.6, 4.4], [[2, 2]]],
    ];
    for (const [x, z, a, seats, sitters] of tables) {
      patioTable(st, x, z, seats, sitters, a === M.red ? chairTeal : chairRed);
      umbrella(st, x, z, 0.17, 0.08, a, M.white);
    }
    // Ampul zincirleri: lokantadan terasın köşelerindeki direklere
    for (const sx of [-1, 1]) {
      const px = sx * 0.88, pz = 0.07;
      cyl(st, 0.004, 0.005, 0.22, M.iron, px, 0.03, pz, 6);
      const a = new THREE.Vector3(sx * 0.3, 0.215, front + 0.02), b = new THREE.Vector3(px, 0.245, pz);
      for (let k = 1; k < 12; k++) {
        const p = a.clone().lerp(b, k / 12);
        p.y -= Math.sin((k / 12) * Math.PI) * 0.035;
        add(st, BULB_GEO, BULB, p.x, p.y, p.z);
      }
    }
    // Arkada ağaçlar
    tree(st, PROPS.treeLarge, -0.82, -0.85, 0.3);
    tree(st, PROPS.treeSmall, 0.82, -0.85, 0.35);
  }, SITES.cafe);
}

// =====================================================================================================
// Elektronik ve beyaz eşya: oluklu metal mağaza, boydan boya cam vitrin (buzdolapları, çamaşır makineleri,
// televizyon duvarı; ekranlar gece yanar), lacivert saçakta ELEKTRONİK tabelası ve şimşek logosu, çatıda ışıklı
// reklam panosu, güneş panelleri ve klimalar; sağda yükleme alanında teslimat kamyoneti, yaya yolunda
// kampanyalı eşyalar ve bayraklar.
// =====================================================================================================
export function makeElectro2() {
  return store2((st, site) => {
    lotAndWalk(st, site);
    const navy = pm('#1a237e', 0.5), orange = pm('#ff6f00', 0.5), dark = pm('#263238', 0.5);
    const X0 = -0.92, X1 = 0.58, cx = (X0 + X1) / 2, W = X1 - X0, Z0 = -0.92, ZF = -0.06, SHOW = 0.16, TOP = 0.36, GT = 0.29;
    const zi = ZF - SHOW;
    st.add(part(KIT.facadeBox(W, TOP - 0.03, zi - Z0, 0.03), KIT.METAL[1], cx, 0.03 + (TOP - 0.03) / 2, (Z0 + zi) / 2));
    for (const x of [X0 + 0.012, X1 - 0.012]) st.add(part(KIT.facadeBox(0.024, TOP - 0.03, SHOW, 0.03), KIT.METAL[1], x, 0.03 + (TOP - 0.03) / 2, zi + SHOW / 2));
    st.add(part(new THREE.BoxGeometry(W - 0.03, GT - 0.04, 0.002), litWall(), cx, 0.03 + (GT - 0.04) / 2, zi + 0.001));
    box(st, W - 0.024, 0.006, SHOW, pm('#e3e6ea', 0.4), cx, 0.03, zi + SHOW / 2);
    flatRoof(st, cx, (Z0 + ZF) / 2, W, ZF - Z0, TOP, pm('#dfe3e8', 0.6));
    box(st, W - 0.03, GT - 0.036, 0.004, SHOP_GLASS, cx, 0.036, ZF);
    for (let k = 0; k <= 10; k++) box(st, 0.006, GT - 0.036, 0.008, dark, X0 + 0.015 + (k * (W - 0.03)) / 10, 0.036, ZF);
    // Saçak, turuncu şerit, tabela ve logo
    box(st, W + 0.014, TOP + 0.03 - GT, 0.03, navy, cx, GT, ZF - 0.008);
    box(st, W + 0.016, 0.01, 0.032, orange, cx, GT, ZF - 0.008);
    box(st, 0.62, 0.06, 0.006, signMat('ELEKTRONİK', '#1a237e', '#ffeb3b'), cx - 0.12, GT + 0.015, ZF + 0.009);
    add(st, new THREE.CylinderGeometry(0.03, 0.03, 0.006, 16).rotateX(Math.PI / 2), orange, X1 - 0.12, GT + 0.045, ZF + 0.009);
    const bolt = new THREE.Shape([new THREE.Vector2(0.005, 0.022), new THREE.Vector2(-0.01, -0.002), new THREE.Vector2(0.0, -0.002), new THREE.Vector2(-0.005, -0.022), new THREE.Vector2(0.01, 0.004), new THREE.Vector2(0.0, 0.004)]);
    add(st, new THREE.ExtrudeGeometry(bolt, { depth: 0.002, bevelEnabled: false }), M.white, X1 - 0.12, GT + 0.045, ZF + 0.012);
    // Vitrin: buzdolapları, çamaşır makineleri (solda), televizyon duvarı ve sehpada dev televizyon (sağda)
    const zc = ZF - 0.05;
    [[-0.86, 0], [-0.77, 1], [-0.69, 2], [-0.61, 0], [-0.52, 1]].forEach(([x, k]) => fridge(st, x, zc, k));
    for (const x of [-0.43, -0.36]) {
      washer(st, x, 0.036, zc + 0.005);
      washer(st, x, 0.102, zc + 0.005, true);
    }
    box(st, 0.4, 0.22, 0.01, pm('#37474f', 0.6), 0.3, 0.036, zc - 0.014);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) tv(st, 0.15 + c * 0.1, 0.115 + r * 0.06, zc - 0.008, 0.085, (r * 4 + c) % 4);
    box(st, 0.18, 0.024, 0.03, dark, 0.3, 0.036, zc + 0.012);
    tv(st, 0.3, 0.064, zc + 0.012, 0.13, 0);
    entrance(st, 0, ZF + 0.003, 0.14, 0.17, dark);
    box(st, 0.3, 0.008, 0.08, navy, 0, 0.225, ZF + 0.04);
    // Çatı: ışıklı reklam panosu, güneş panelleri, klimalar
    const bzp = -0.7;
    for (const x of [cx - 0.16, cx + 0.16]) box(st, 0.014, 0.22, 0.014, M.gray, x, TOP, bzp);
    box(st, 0.46, 0.24, 0.014, dark, cx, TOP + 0.13, bzp + 0.008);
    add(st, screenGeo(0.44, 0.22, AD), screenMat(), cx, TOP + 0.24, bzp + 0.0155);
    const PANEL = pm('#1f3d72', 0.25, 0.4);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) {
      const p = item(st, -0.85 + c * 0.09, -0.45 + r * 0.1, 0, 1, TOP + 0.012);
      const tilt = item(p, 0, 0, 0, 1, 0.012);
      tilt.rotation.x = 0.35;
      box(tilt, 0.08, 0.004, 0.07, PANEL, 0, 0, 0);
      box(p, 0.004, 0.022, 0.004, M.gray, 0, -0.01, -0.024);
    }
    for (const [x, z] of [[0.2, -0.45], [0.35, -0.45]]) hvac(st, x, z, TOP + 0.006);
    // Sağda yükleme alanı: yükleme kapısı, teslimat kamyoneti (arka kapıları açık), rampada koliler
    box(st, 0.34, 0.004, 0.84, pm('#5b6170', 0.9), 0.76, 0.03, -0.5);
    for (let k = 0; k < 7; k++) {
      const s = box(st, 0.012, 0.001, 0.09, pm('#f2c14e', 0.6), 0.64 + k * 0.045, 0.034, -0.12);
      s.rotation.y = 0.6;
    }
    box(st, 0.006, 0.17, 0.15, pm('#e9edf1', 0.5, 0.3), X1 + 0.003, 0.03, -0.6);
    for (let k = 0; k < 7; k++) box(st, 0.008, 0.003, 0.142, M.gray, X1 + 0.004, 0.05 + k * 0.022, -0.6);
    car(st, 'truck', 0.78, -0.48, Math.PI, '#ffffff', 1);
    box(st, 0.002, 0.03, 0.18, navy, 0.78 - 0.065, 0.12, -0.42);
    carton(st, 0.06, 0.12, 0.05, 0.66, 0.03, -0.75, 0.1);
    handTruck(st, 0.68, -0.3, Math.PI / 2 + 0.4);
    person(st, 0.64, -0.32, Math.PI / 2 + 0.4, 0, 'push', 0.03, 1.05, orange);
    // Yaya yolunda kampanyalı eşyalar, bayraklar
    const tag = pm('#ffeb3b', 0.6);
    box(st, 0.3, 0.008, 0.07, pm('#b0bec5', 0.6), -0.62, 0.03, 0.02);
    fridge(st, -0.72, 0.02, 1);
    washer(st, -0.63, 0.038, 0.015);
    washer(st, -0.55, 0.038, 0.015);
    for (const x of [-0.72, -0.63, -0.55]) box(st, 0.022, 0.016, 0.002, tag, x, x === -0.72 ? 0.09 : 0.075, 0.0475);
    featherFlag(st, -0.9, 0.06, orange, navy);
    featherFlag(st, 0.5, 0.06, navy, orange);
    carton(st, 0.08, 0.052, 0.012, 0.3, 0.06, 0.03, 1.2);
    person(st, 0.32, 0.02, 1.2, 3, 'carry', 0.03, 1.05);
  }, SITES.electro);
}

export const STORES2: Record<string, () => THREE.Object3D> = {
  store: makeStore2,
  market: makeMarket2,
  furniture: makeFurniture2,
  bakery: makeBakery2,
  fashion: makeFashion2,
  garden: makeGarden2,
  cafe: makeCafe2,
  electro: makeElectro2,
};
