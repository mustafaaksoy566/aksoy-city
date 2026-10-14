import * as THREE from 'three';
import { PROPS, PARK_KINDS } from './config';
import { part, windowMat } from './utilities';
import { mergeStatic } from './batcher';
import { KIT } from './towers';
import { signMat } from './signs';
import { pm, M, BULB, BULB_GEO, WATER, SPRAY, PYRAMID, FLOWERS, FLOWER_GEO, PAINT, type V3, UP, add, box, cyl, rod, item, frustum, bench, lamp, tree, flowerBed, planter } from './parts';

// Eğlence ve park yapıları gökdelenler gibi ayrıntılı çizilir: dönme dolap, lunapark, müze, çeşme, heykel ve parklar.
// Sabit parçalar birleştirilir (telefon yorulmasın); dönen, sallanan ve inip çıkan parçalar ayrı kalır.
// Ön yüz +z (yola bakar). Yerel ölçü 1x1; n karelik yapılar n*0.96 kat büyütülür, içlerindeki
// ağaç, bank ve lamba gibi eşyalar 1/n ile küçültülür ki şehirdeki boylarıyla aynı kalsınlar.

// ======================= Dönme dolap (2x2) =======================
// A şeklinde beyaz çelik ayaklar, kafes kasnak, göbekten çıkan teller, gece yanan ampuller, 16 renkli kabin.
// Tekerlek döner, kabinler hep dik durur (animateDecor: userData.wheel).
export function ferrisWheel() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  const s = 1 / (2 * 0.96);
  const HUB = 0.77;
  const R = 0.56;
  const RI = 0.47;
  box(st, 0.98, 0.03, 0.98, M.paving, 0, 0, 0);
  cyl(st, 0.34, 0.34, 0.004, M.terracotta, 0, 0.03, 0, 40);
  box(st, 0.12, 0.004, 0.46, M.terracotta, 0, 0.03, 0.26);
  // Biniş platformu ve basamaklar
  box(st, 0.3, 0.06, 0.2, M.stone, 0, 0.03, 0);
  box(st, 0.3, 0.003, 0.012, M.yellow, 0, 0.09, 0.094);
  for (let k = 0; k < 3; k++) box(st, 0.14, 0.045 - k * 0.015, 0.03, M.stone, 0, 0.03, 0.115 + k * 0.03);
  // A ayaklar (önde ve arkada), ara kuşaklar, aks ve yatak kutuları
  const leg = (sx: number, sz: number, y: number): V3 => {
    const t = (y - 0.03) / (HUB - 0.03);
    return [sx * 0.3 * (1 - t), y, sz * (0.24 - 0.11 * t)];
  };
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      rod(st, leg(sx, sz, 0.03), [0, HUB, sz * 0.13], 0.017, M.steel, 8);
      box(st, 0.06, 0.03, 0.06, M.stone, sx * 0.3, 0.03, sz * 0.24);
    }
    for (const y of [0.28, 0.52]) rod(st, leg(-1, sz, y), leg(1, sz, y), 0.008, M.steel, 6);
    rod(st, leg(-1, sz, 0.28), leg(1, sz, 0.52), 0.006, M.steel, 6);
    rod(st, leg(1, sz, 0.28), leg(-1, sz, 0.52), 0.006, M.steel, 6);
    box(st, 0.06, 0.06, 0.04, M.gray, 0, HUB - 0.03, sz * 0.135);
  }
  add(st, new THREE.CylinderGeometry(0.022, 0.022, 0.32, 12).rotateX(Math.PI / 2), M.gray, 0, HUB, 0);
  // Bilet gişesi
  const tb = item(st, 0.3, 0.36, -0.4, s);
  box(tb, 0.12, 0.1, 0.09, M.white, 0, 0, 0);
  box(tb, 0.08, 0.04, 0.004, windowMat, 0, 0.04, 0.045);
  box(tb, 0.13, 0.03, 0.006, signMat('BİLET', '#c62828'), 0, 0.1, 0.044);
  box(tb, 0.15, 0.014, 0.12, M.red, 0, 0.13, 0);
  // Çevre: çiçeklikler, ağaçlar, banklar, lambalar
  planter(st, -0.36, 0.36, 0.06, 1);
  planter(st, 0.4, -0.02, 0.05, 3);
  planter(st, -0.4, -0.02, 0.05, 4);
  tree(st, PROPS.treeLarge, -0.4, -0.4, 0.75 * s, 1);
  tree(st, PROPS.treeLarge, 0.4, -0.4, 0.7 * s, 2);
  tree(st, PROPS.treeBlossom, -0.2, 0.44, 0.6 * s, 3);
  bench(st, -0.2, 0.3, Math.PI / 2, s);
  bench(st, 0.42, 0.2, -Math.PI / 2, s);
  for (const x of [-0.1, 0.1]) lamp(st, x, 0.44, s);
  g.add(mergeStatic([st]));

  // Dönen tekerlek
  const wheel = new THREE.Group();
  wheel.position.set(0, HUB, 0);
  const ws = new THREE.Group();
  for (const sz of [-1, 1]) {
    const zr = sz * 0.055;
    add(ws, new THREE.TorusGeometry(R, 0.011, 6, 80), M.steel, 0, 0, zr);
    add(ws, new THREE.TorusGeometry(RI, 0.007, 6, 80), M.steel, 0, 0, zr);
    // Kasnak kafesi: iki çember arasında zikzak
    const N = 32;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const b = ((k + 0.5) / N) * Math.PI * 2;
      const c = ((k + 1) / N) * Math.PI * 2;
      rod(ws, [Math.cos(a) * R, Math.sin(a) * R, zr], [Math.cos(b) * RI, Math.sin(b) * RI, zr], 0.0035, M.steel, 4);
      rod(ws, [Math.cos(b) * RI, Math.sin(b) * RI, zr], [Math.cos(c) * R, Math.sin(c) * R, zr], 0.0035, M.steel, 4);
    }
    // Göbekten çembere teller (göbek geniş: yandan bakınca tekerlek derinlikli görünür)
    for (let k = 0; k < 24; k++) {
      const a = ((k + 0.5) / 24) * Math.PI * 2;
      rod(ws, [Math.cos(a) * 0.05, Math.sin(a) * 0.05, sz * 0.12], [Math.cos(a) * RI, Math.sin(a) * RI, zr], 0.003, M.steel, 4);
    }
    // Kasnaktaki ampuller
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      add(ws, BULB_GEO, BULB, Math.cos(a) * (R + 0.014), Math.sin(a) * (R + 0.014), zr);
    }
  }
  add(ws, new THREE.CylinderGeometry(0.065, 0.065, 0.26, 16).rotateX(Math.PI / 2), M.red, 0, 0, 0);
  for (const sz of [-1, 1]) add(ws, new THREE.CylinderGeometry(0.075, 0.075, 0.012, 16).rotateX(Math.PI / 2), M.white, 0, 0, sz * 0.12);
  const NC = 16;
  for (let k = 0; k < NC; k++) {
    const a = (k / NC) * Math.PI * 2;
    rod(ws, [Math.cos(a) * R, Math.sin(a) * R, -0.055], [Math.cos(a) * R, Math.sin(a) * R, 0.055], 0.006, M.gray, 6);
  }
  wheel.add(mergeStatic([ws]));
  // Kabinler: renkli alt gövde, camlı orta, kubbe çatı; kasnağa asılı
  const cabins: THREE.Object3D[] = [];
  for (let k = 0; k < NC; k++) {
    const a = (k / NC) * Math.PI * 2;
    const cab = new THREE.Group();
    cab.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    const c = new THREE.Group();
    const paint = PAINT[k % PAINT.length];
    rod(c, [0, 0.004, 0], [0, -0.03, 0], 0.004, M.gray, 4);
    cyl(c, 0.031, 0.024, 0.022, paint, 0, -0.1, 0, 12);
    cyl(c, 0.031, 0.031, 0.032, windowMat, 0, -0.078, 0, 12);
    add(c, new THREE.SphereGeometry(0.033, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), paint, 0, -0.047, 0);
    cyl(c, 0.033, 0.033, 0.004, M.white, 0, -0.08, 0, 12);
    cab.add(mergeStatic([c]));
    wheel.add(cab);
    cabins.push(cab);
  }
  g.add(wheel);
  g.userData.wheel = { wheel, cabins };
  return g;
}

// ======================= Lunapark (3x3) =======================
// Girişte "LUNAPARK" kemeri; atlıkarınca (döner), hız treni (raylarda tren gider), serbest düşüş kulesi
// (koltuklar yükselip düşer), korsan gemisi (sallanır), yemek tezgâhları, balonlar, ağaçlar ve gece yanan ampuller.
export function funfair() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  const s = 1 / (3 * 0.96);
  box(st, 0.98, 0.03, 0.98, M.paving, 0, 0, 0);
  box(st, 0.1, 0.004, 0.96, M.terracotta, 0, 0.03, 0);
  box(st, 0.4, 0.006, 0.66, M.lawn, 0.27, 0.03, -0.13);
  box(st, 0.2, 0.006, 0.2, M.lawn, -0.36, 0.03, -0.36);
  // Göbek: taş daire yol şeridiyle aynı boyda, ortadaki çimen ondan belirgin yüksekte (aynı boydaki yüzler titreşir)
  cyl(st, 0.1, 0.1, 0.004, M.terracotta, 0, 0.03, 0.03, 28);
  cyl(st, 0.05, 0.05, 0.009, M.lawn, 0, 0.03, 0.03, 20);
  planter(st, 0, 0.03, 0.035, 2);
  // Kenarlarda çit
  for (const sx of [-1, 1]) box(st, 0.02, 0.03, 0.9, M.hedge, sx * 0.48, 0.03, -0.02);
  box(st, 0.94, 0.03, 0.02, M.hedge, 0, 0.03, -0.48);

  // Giriş kemeri: çizgili kuleler, tabela, ampullü kemer, turnikeler
  for (const sx of [-1, 1]) {
    const x = sx * 0.1;
    box(st, 0.05, 0.2, 0.05, M.white, x, 0.03, 0.45);
    for (let k = 0; k < 4; k++) box(st, 0.056, 0.018, 0.056, k % 2 ? M.red : M.yellow, x, 0.06 + k * 0.045, 0.45); // şeritler kuleden belirgin dışarıda
    add(st, new THREE.ConeGeometry(0.045, 0.07, 4).rotateY(Math.PI / 4), M.red, x, 0.265, 0.45);
    rod(st, [x, 0.3, 0.45], [x, 0.36, 0.45], 0.002, M.iron, 4);
    box(st, 0.03, 0.018, 0.002, PAINT[sx > 0 ? 1 : 2], x + 0.015, 0.34, 0.45);
    box(st, 0.012, 0.03, 0.05, M.gray, sx * 0.04, 0.03, 0.44);
  }
  box(st, 0.2, 0.05, 0.02, M.navy, 0, 0.15, 0.45);
  box(st, 0.18, 0.04, 0.003, signMat('LUNAPARK', '#6a1b9a', '#ffe082'), 0, 0.155, 0.4615);
  add(st, new THREE.TorusGeometry(0.1, 0.008, 6, 24, Math.PI), M.yellow, 0, 0.2, 0.45);
  for (let k = 0; k <= 10; k++) {
    const a = (k / 10) * Math.PI;
    add(st, BULB_GEO, BULB, Math.cos(a) * 0.1, 0.2 + Math.sin(a) * 0.1, 0.46);
  }
  // Bilet gişesi
  const tb = item(st, -0.2, 0.44, 0, s);
  box(tb, 0.14, 0.11, 0.1, M.white, 0, 0, 0);
  box(tb, 0.1, 0.045, 0.004, windowMat, 0, 0.045, 0.054);
  box(tb, 0.15, 0.032, 0.006, signMat('BİLET', '#c62828'), 0, 0.11, 0.05);
  add(tb, new THREE.ConeGeometry(0.11, 0.07, 4).rotateY(Math.PI / 4), M.red, 0, 0.18, 0);

  // Atlıkarınca: taş taban (sabit) üstünde dönen platform, atlar, çizgili tente ve ampuller
  const cx = -0.28, cz = 0.24;
  cyl(st, 0.18, 0.185, 0.02, M.stone, cx, 0.03, cz, 32);
  const carousel = new THREE.Group();
  carousel.position.set(cx, 0.05, cz);
  const ci = new THREE.Group();
  // Ahşap döşeme ve kenarında altın şerit: şerit sadece yan yüz (eskiden döşemeyle aynı boyda dolu bir diskti, zemin titreşiyordu)
  cyl(ci, 0.165, 0.165, 0.012, M.wood, 0, 0, 0, 32);
  add(ci, new THREE.CylinderGeometry(0.168, 0.168, 0.006, 32, 1, true), M.gold, 0, 0.009, 0);
  for (let k = 0; k < 3; k++) cyl(ci, 0.036, 0.036, 0.045, k % 2 ? M.gold : windowMat, 0, 0.012 + k * 0.045, 0, 12);
  const horseCols = [M.white, pm('#f3e0c0'), pm('#9aa9b8'), pm('#3b3b3b')];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const x = Math.cos(a) * 0.12, z = Math.sin(a) * 0.12;
    rod(ci, [x, 0.012, z], [x, 0.15, z], 0.003, M.gold, 5);
    const h = item(ci, x, z, -a, 1, 0.055 + (k % 2) * 0.025);
    const hc = horseCols[k % 4];
    add(h, new THREE.CapsuleGeometry(0.009, 0.026, 2, 6).rotateX(Math.PI / 2), hc, 0, 0, 0);
    const neck = box(h, 0.008, 0.022, 0.01, hc, 0, 0.002, 0.018);
    neck.rotation.x = 0.5;
    box(h, 0.009, 0.01, 0.02, hc, 0, 0.018, 0.028);
    box(h, 0.012, 0.004, 0.014, M.red, 0, 0.008, -0.002);
    for (const lx of [-0.004, 0.004]) {
      rod(h, [lx, -0.004, 0.012], [lx, -0.022, 0.026], 0.0025, hc, 4);
      rod(h, [lx, -0.004, -0.012], [lx, -0.022, -0.026], 0.0025, hc, 4);
    }
    rod(h, [0, 0.004, -0.02], [0, -0.012, -0.032], 0.003, M.gold, 4);
  }
  for (let k = 0; k < 12; k++) {
    const th = (k / 12) * Math.PI * 2;
    const m = k % 2 ? M.white : M.red;
    add(ci, new THREE.ConeGeometry(0.19, 0.075, 3, 1, false, th, Math.PI / 6), m, 0, 0.19, 0);
    add(ci, new THREE.CylinderGeometry(0.19, 0.19, 0.026, 3, 1, true, th, Math.PI / 6), k % 2 ? M.yellow : M.blue, 0, 0.14, 0);
  }
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    add(ci, BULB_GEO, BULB, Math.cos(a) * 0.192, 0.127, Math.sin(a) * 0.192);
  }
  cyl(ci, 0.025, 0.03, 0.03, M.gold, 0, 0.225, 0, 10);
  add(ci, new THREE.SphereGeometry(0.014, 10, 8), M.gold, 0, 0.265, 0);
  rod(ci, [0, 0.27, 0], [0, 0.32, 0], 0.002, M.iron, 4);
  box(ci, 0.028, 0.016, 0.002, M.red, 0.014, 0.3, 0);
  carousel.add(mergeStatic([ci]));
  g.add(carousel);

  // Hız treni: yükselen tepe, dik iniş, viraj ve tümsekler; istasyondan geçen kapalı hat
  const pts: V3[] = [
    [0.14, 0.07, 0.34], [0.34, 0.07, 0.34], [0.44, 0.1, 0.24], [0.45, 0.3, 0.04], [0.45, 0.5, -0.18], [0.41, 0.53, -0.34],
    [0.28, 0.38, -0.44], [0.14, 0.1, -0.42], [0.06, 0.07, -0.3], [0.1, 0.26, -0.14], [0.22, 0.17, -0.02], [0.32, 0.15, 0.14],
    [0.2, 0.2, 0.2], [0.08, 0.1, 0.27],
  ];
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), true, 'catmullrom', 0.5);
  const N = 260;
  const rails: THREE.Vector3[][] = [[], [], []];
  const T = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(), basis = new THREE.Matrix4();
  for (let k = 0; k < N; k++) {
    const u = k / N;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, T);
    side.crossVectors(T, UP).normalize();
    up.crossVectors(side, T).normalize();
    rails[0].push(p.clone().addScaledVector(side, 0.011));
    rails[1].push(p.clone().addScaledVector(side, -0.011));
    rails[2].push(p.clone().addScaledVector(up, -0.012));
    if (k % 3 === 0) {
      const tie = add(st, new THREE.BoxGeometry(0.03, 0.004, 0.005), M.iron, p.x - up.x * 0.005, p.y - up.y * 0.005, p.z - up.z * 0.005);
      tie.quaternion.setFromRotationMatrix(basis.makeBasis(side, up, T));
    }
  }
  // Direkler: düzenli aralıkla, beton ayaklı; alçakta tek ayak, yüksekte iki ayak, kiriş ve çapraz bağ.
  // Altından başka bir ray geçen yere direk konmaz (direk rayın içinden geçmesin).
  const samples = Array.from({ length: N }, (_, k) => curve.getPointAt(k / N));
  const SUP = pm('#5c6b7a', 0.5, 0.5);
  for (let k = 0; k < N; k += 10) {
    const p = samples[k];
    if (p.y < 0.1) continue;
    const blocked = samples.some((q, j) => Math.min(Math.abs(j - k), N - Math.abs(j - k)) > 8 && q.y < p.y && Math.hypot(q.x - p.x, q.z - p.z) < 0.05);
    if (blocked) continue;
    curve.getTangentAt(k / N, T);
    side.crossVectors(T, UP).normalize();
    const y = p.y - 0.02;
    if (p.y < 0.26) {
      rod(st, [p.x, 0.03, p.z], [p.x, y, p.z], 0.0045, SUP, 6);
      cyl(st, 0.009, 0.011, 0.012, M.rim, p.x, 0.03, p.z, 8);
      continue;
    }
    const a: V3 = [p.x + side.x * 0.03, 0.03, p.z + side.z * 0.03];
    const b: V3 = [p.x - side.x * 0.03, 0.03, p.z - side.z * 0.03];
    for (const f of [a, b]) {
      rod(st, f, [f[0], y, f[2]], 0.0045, SUP, 6);
      cyl(st, 0.009, 0.011, 0.012, M.rim, f[0], 0.03, f[2], 8);
    }
    rod(st, [a[0], y, a[2]], [b[0], y, b[2]], 0.004, SUP, 6);
    rod(st, [a[0], 0.06, a[2]], [b[0], y - 0.02, b[2]], 0.0025, SUP, 4);
    rod(st, [b[0], 0.06, b[2]], [a[0], y - 0.02, a[2]], 0.0025, SUP, 4);
  }
  rails.forEach((line, k) => {
    const c = new THREE.CatmullRomCurve3(line, true);
    add(st, new THREE.TubeGeometry(c, N, k < 2 ? 0.0035 : 0.006, 5, true), k < 2 ? M.red : M.yellow, 0, 0, 0);
  });
  // İstasyon: peron, direkler, çatı ve tabela
  box(st, 0.22, 0.04, 0.05, M.stone, 0.24, 0.03, 0.39);
  for (const x of [0.14, 0.34]) for (const z of [0.31, 0.41]) rod(st, [x, 0.03, z], [x, 0.16, z], 0.005, M.white, 6);
  box(st, 0.24, 0.012, 0.13, M.red, 0.24, 0.16, 0.36);
  box(st, 0.16, 0.032, 0.004, signMat('HIZ TRENİ', '#d32f2f'), 0.24, 0.13, 0.4275);
  // Tren: dört vagon, içinde yolcular
  const cars: THREE.Object3D[] = [];
  for (let k = 0; k < 4; k++) {
    const c = new THREE.Group();
    const b = new THREE.Group();
    box(b, 0.026, 0.014, 0.032, PAINT[k === 0 ? 0 : 2], 0, 0.005, 0);
    box(b, 0.022, 0.012, 0.005, M.iron, 0, 0.012, -0.006);
    for (const sx of [-0.006, 0.006]) add(b, new THREE.SphereGeometry(0.005, 6, 5), M.skin, sx, 0.026, 0.002);
    if (k === 0) add(b, new THREE.ConeGeometry(0.014, 0.016, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4), PAINT[0], 0, 0.012, 0.022);
    c.add(mergeStatic([b]));
    g.add(c);
    cars.push(c);
  }

  // Serbest düşüş kulesi: çizgili kule, tepede ışıklar; koltuk halkası yükselip düşer
  const dx = -0.38, dz = -0.36;
  cyl(st, 0.07, 0.08, 0.03, M.stone, dx, 0.03, dz, 16);
  for (let k = 0; k < 8; k++) cyl(st, 0.022, 0.024, 0.1, k % 2 ? M.white : M.blue, dx, 0.06 + k * 0.1, dz, 10);
  cyl(st, 0.04, 0.03, 0.04, M.red, dx, 0.86, dz, 12);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    add(st, BULB_GEO, BULB, dx + Math.cos(a) * 0.042, 0.9, dz + Math.sin(a) * 0.042);
  }
  rod(st, [dx, 0.9, dz], [dx, 0.97, dz], 0.003, M.iron, 4);
  const drop = new THREE.Group();
  drop.position.set(dx, 0.07, dz);
  const dr = new THREE.Group();
  cyl(dr, 0.05, 0.05, 0.02, M.yellow, 0, 0, 0, 16);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const seat = box(dr, 0.016, 0.026, 0.012, PAINT[k % PAINT.length], Math.cos(a) * 0.058, -0.004, Math.sin(a) * 0.058);
    seat.rotation.y = -a + Math.PI / 2;
    add(dr, new THREE.SphereGeometry(0.005, 6, 5), M.skin, Math.cos(a) * 0.063, 0.026, Math.sin(a) * 0.063);
  }
  drop.add(mergeStatic([dr]));
  g.add(drop);

  // Korsan gemisi: iki A ayak arasında sallanan gemi
  const px = -0.25, py = 0.3, pz = -0.06;
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) rod(st, [px + sx * 0.14, 0.03, pz + sz * 0.08], [px, py, pz + sz * 0.065], 0.008, M.gray, 6);
  }
  add(st, new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8).rotateX(Math.PI / 2), M.iron, px, py, pz);
  rod(st, [px, py, pz], [px, py + 0.09, pz], 0.003, M.iron, 4);
  box(st, 0.04, 0.026, 0.002, M.iron, px + 0.02, py + 0.06, pz);
  box(st, 0.12, 0.03, 0.08, M.stone, px, 0.03, pz);
  for (const sz of [-1, 1]) {
    rod(st, [px - 0.2, 0.06, pz + sz * 0.1], [px + 0.2, 0.06, pz + sz * 0.1], 0.003, M.yellow, 4);
    for (let k = 0; k <= 4; k++) rod(st, [px - 0.2 + k * 0.1, 0.03, pz + sz * 0.1], [px - 0.2 + k * 0.1, 0.065, pz + sz * 0.1], 0.003, M.iron, 4);
  }
  const swing = new THREE.Group();
  swing.position.set(px, py, pz);
  const sh = new THREE.Group();
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) rod(sh, [0, 0, sz * 0.035], [sx * 0.06, -0.18, sz * 0.035], 0.005, M.gray, 5);
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-0.125, 0.035);
  hullShape.quadraticCurveTo(-0.1, -0.045, 0, -0.045);
  hullShape.quadraticCurveTo(0.1, -0.045, 0.125, 0.035);
  hullShape.lineTo(0.09, 0.01);
  hullShape.lineTo(-0.09, 0.01);
  hullShape.closePath();
  add(sh, new THREE.ExtrudeGeometry(hullShape, { depth: 0.06, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -0.03), M.darkWood, 0, -0.19, 0);
  box(sh, 0.2, 0.01, 0.064, M.red, 0, -0.205, 0);
  box(sh, 0.18, 0.004, 0.064, M.gold, 0, -0.182, 0);
  for (let k = 0; k < 5; k++) {
    const x = -0.07 + k * 0.035;
    box(sh, 0.01, 0.012, 0.05, M.iron, x, -0.18, 0);
    for (const z of [-0.012, 0.012]) add(sh, new THREE.SphereGeometry(0.005, 6, 5), M.skin, x + 0.008, -0.16, z);
  }
  add(sh, new THREE.SphereGeometry(0.012, 8, 6), M.gold, 0.125, -0.155, 0);
  swing.add(mergeStatic([sh]));
  g.add(swing);

  // Yemek tezgâhları, şemsiyeli masalar, balonlar
  for (const [x, c, label] of [[-0.24, '#ef6c00', 'DONDURMA'], [-0.11, '#2e7d32', 'MISIR']] as [number, string, string][]) {
    const k = item(st, x, -0.42, 0, s);
    box(k, 0.13, 0.08, 0.09, M.white, 0, 0, 0);
    box(k, 0.12, 0.014, 0.004, signMat(label, c), 0, 0.085, 0.047);
    for (let j = 0; j < 4; j++) {
      const a = box(k, 0.035, 0.004, 0.06, j % 2 ? M.white : pm(c), -0.052 + j * 0.035, 0.1, 0.05);
      a.rotation.x = 0.35;
    }
    box(k, 0.15, 0.012, 0.11, pm(c), 0, 0.11, 0);
  }
  for (const [x, z, c] of [[-0.2, -0.26, 0], [-0.08, -0.22, 2]] as [number, number, number][]) {
    const t = item(st, x, z, 0, s);
    cyl(t, 0.03, 0.03, 0.006, M.white, 0, 0.03, 0, 10);
    rod(t, [0, 0, 0], [0, 0.1, 0], 0.003, M.iron, 4);
    add(t, new THREE.ConeGeometry(0.06, 0.025, 8), PAINT[c], 0, 0.11, 0);
  }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const bx = -0.07 + Math.cos(a) * 0.012, bz = -0.12 + Math.sin(a) * 0.012, by = 0.13 + (k % 3) * 0.012;
    rod(st, [-0.07, 0.04, -0.12], [bx, by, bz], 0.001, M.white, 3);
    add(st, new THREE.SphereGeometry(0.009, 8, 6), PAINT[k], bx, by + 0.008, bz);
  }
  // Ağaçlar ve lambalar
  tree(st, PROPS.treeLarge, -0.44, 0.44, 0.7 * s, 1);
  tree(st, PROPS.treeLarge, 0.44, 0.45, 0.65 * s, 2);
  tree(st, PROPS.treeBlossom, -0.44, 0.04, 0.6 * s, 3);
  tree(st, PROPS.treeSmall, -0.44, -0.18, 0.6 * s, 4);
  tree(st, PROPS.treeSmall, 0.2, -0.3, 0.55 * s, 5);
  for (const z of [-0.3, 0.2, 0.36]) lamp(st, -0.065, z, s);
  for (const z of [-0.18, 0.2]) lamp(st, 0.065, z, s);
  g.add(mergeStatic([st]));

  g.userData.carousel = carousel;
  g.userData.coaster = { curve, cars, t: 0, gap: 0.045 / curve.getLength() };
  g.userData.drop = { obj: drop, t: 0, y0: 0.07, y1: 0.78 };
  g.userData.swing = { obj: swing, t: 0 };
  return g;
}

// ======================= Müze (2x2) =======================
// U biçimli taş saray: arkada ana kanat ve sütunlu orta köşk, yanlarda kanatlar ve köşe köşkleri,
// mansart çatılar ve çatı pencereleri; avluda cam piramit ve havuzlar, önde demir parmaklık ve "MÜZE" tabelası.
export function museum() {
  const st = new THREE.Group();
  const s = 1 / (2 * 0.96);
  const F = KIT.STONE[1];
  const H = 0.24;
  const top = 0.03 + H;
  box(st, 0.98, 0.03, 0.98, M.paving, 0, 0, 0);
  box(st, 0.5, 0.004, 0.72, M.stone, 0, 0.03, 0.09);
  // Ana kanat ve yan kanatlar
  st.add(part(KIT.facadeBox(0.92, H, 0.2, 0.03), F, 0, 0.03 + H / 2, -0.36));
  for (const sx of [-1, 1]) st.add(part(KIT.facadeBox(0.2, H, 0.53, 0.03), F, sx * 0.36, 0.03 + H / 2, 0.005));
  // Korniş ve mansart çatılar, çatı pencereleri
  box(st, 0.94, 0.016, 0.22, M.stone, 0, top, -0.36);
  add(st, frustum(0.92, 0.2, 0.08, 0.86, 0.1), M.slate, 0, top + 0.056, -0.36);
  for (const sx of [-1, 1]) {
    box(st, 0.22, 0.016, 0.55, M.stone, sx * 0.36, top, 0.005);
    add(st, frustum(0.2, 0.53, 0.08, 0.1, 0.47), M.slate, sx * 0.36, top + 0.056, 0.005);
  }
  const dormer = (x: number, z: number, rot: number) => {
    const d = item(st, x, z, rot, 1, top + 0.03);
    box(d, 0.032, 0.036, 0.03, M.stone, 0, 0, 0);
    box(d, 0.02, 0.022, 0.004, windowMat, 0, 0.006, 0.015);
    add(d, new THREE.ConeGeometry(0.026, 0.022, 4).rotateY(Math.PI / 4), M.slate, 0, 0.047, 0);
  };
  for (const x of [-0.38, -0.29, -0.2, 0.2, 0.29, 0.38]) dormer(x, -0.282, 0);
  for (const sx of [-1, 1]) for (const z of [-0.12, -0.03, 0.06]) dormer(sx * 0.282, z, (-sx * Math.PI) / 2);
  // Orta köşk: daha yüksek, sütunlu giriş, alınlık, kare kubbe ve fener
  st.add(part(KIT.facadeBox(0.28, 0.33, 0.25, 0.03), F, 0, 0.03 + 0.165, -0.345));
  box(st, 0.3, 0.016, 0.27, M.stone, 0, 0.36, -0.345);
  add(st, frustum(0.28, 0.25, 0.13, 0.08, 0.07), M.slate, 0, 0.376 + 0.065, -0.345);
  cyl(st, 0.025, 0.03, 0.04, M.stone, 0, 0.506, -0.345, 8);
  add(st, new THREE.SphereGeometry(0.012, 8, 6), M.gold, 0, 0.556, -0.345);
  for (let k = 0; k < 3; k++) box(st, 0.3 - k * 0.02, 0.012, 0.04, M.stone, 0, 0.03 + k * 0.012, -0.17 - k * 0.012);
  for (let k = 0; k < 6; k++) cyl(st, 0.011, 0.013, 0.2, M.white, -0.11 + k * 0.044, 0.066, -0.205, 10);
  box(st, 0.27, 0.026, 0.05, M.stone, 0, 0.266, -0.205);
  const tri = new THREE.Shape([new THREE.Vector2(-0.14, 0), new THREE.Vector2(0.14, 0), new THREE.Vector2(0, 0.06)]);
  add(st, new THREE.ExtrudeGeometry(tri, { depth: 0.05, bevelEnabled: false }), M.stone, 0, 0.292, -0.23);
  box(st, 0.16, 0.03, 0.003, signMat('MÜZE', '#5d4037', '#ffe082'), 0, 0.266, -0.179);
  // Köşe köşkleri (yan kanatların ön ucu) ve afişler
  for (const sx of [-1, 1]) {
    st.add(part(KIT.facadeBox(0.24, 0.29, 0.15, 0.03), F, sx * 0.36, 0.03 + 0.145, 0.21));
    box(st, 0.26, 0.016, 0.17, M.stone, sx * 0.36, 0.32, 0.21);
    add(st, frustum(0.24, 0.15, 0.1, 0.09, 0.04), M.slate, sx * 0.36, 0.336 + 0.05, 0.21);
    rod(st, [sx * 0.36, 0.43, 0.21], [sx * 0.36, 0.47, 0.21], 0.003, M.gold, 4);
    for (const dx of [-0.06, 0.06]) box(st, 0.04, 0.13, 0.004, sx < 0 ? M.red : M.navy, sx * 0.36 + dx, 0.11, 0.287);
  }
  // Avlu: cam piramit (çelik çerçeveli), iki yanında havuz ve fıskiyeler, küçük piramitler
  box(st, 0.25, 0.012, 0.25, M.granite, 0, 0.03, 0.06);
  add(st, new THREE.ConeGeometry(0.17, 0.18, 4, 1, true).rotateY(Math.PI / 4), PYRAMID, 0, 0.042 + 0.09, 0.06);
  const P = 0.12, PH = 0.18, base = 0.042;
  for (const [cxp, czp] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) rod(st, [cxp * P, base, 0.06 + czp * P], [0, base + PH, 0.06], 0.0025, M.gray, 4);
  for (const f of [0.25, 0.5, 0.75]) {
    const r = P * (1 - f), y = base + PH * f;
    for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
      rod(st, [a[0] * r, y, 0.06 + a[1] * r], [b[0] * r, y, 0.06 + b[1] * r], 0.0018, M.gray, 4);
    }
  }
  for (const sx of [-1, 1]) {
    box(st, 0.1, 0.02, 0.26, M.granite, sx * 0.19, 0.03, 0.06);
    box(st, 0.084, 0.004, 0.244, WATER, sx * 0.19, 0.048, 0.06);
    for (const z of [-0.02, 0.06, 0.14]) add(st, new THREE.ConeGeometry(0.008, 0.05, 6), SPRAY, sx * 0.19, 0.075, z);
    add(st, new THREE.ConeGeometry(0.05, 0.05, 4, 1, true).rotateY(Math.PI / 4), PYRAMID, sx * 0.16, 0.055, 0.31);
    box(st, 0.075, 0.008, 0.075, M.granite, sx * 0.16, 0.03, 0.31);
  }
  // Ön bahçe: çimler, ağaçlar, lambalar, parmaklık ve kapı
  for (const sx of [-1, 1]) {
    box(st, 0.22, 0.008, 0.17, M.lawn, sx * 0.37, 0.03, 0.385);
    tree(st, PROPS.treeSmall, sx * 0.43, 0.4, 0.65 * s, sx);
    tree(st, PROPS.treeSmall, sx * 0.31, 0.4, 0.55 * s, sx * 2);
    bench(st, sx * 0.19, 0.38, Math.PI, s);
    for (let k = 0; k <= 7; k++) rod(st, [sx * (0.13 + k * 0.05), 0.03, 0.475], [sx * (0.13 + k * 0.05), 0.09, 0.475], 0.003, M.iron, 4);
    rod(st, [sx * 0.13, 0.08, 0.475], [sx * 0.48, 0.08, 0.475], 0.003, M.iron, 4);
    box(st, 0.04, 0.12, 0.04, M.stone, sx * 0.11, 0.03, 0.47);
    add(st, new THREE.SphereGeometry(0.014, 8, 6), M.gold, sx * 0.11, 0.165, 0.47);
    lamp(st, sx * 0.1, 0.3, s);
  }
  return mergeStatic([st]);
}

// ======================= Çeşme (1x1) =======================
// Sekizgen taş havuz, iki kat taş kâse; kâselerden dökülen su perdeleri, tepede fışkıran su ve havuz kenarından fıskiyeler.
// Çevresinde desenli meydan, banklar, lambalar, çiçek tarhları ve ağaçlar. Su hafifçe kıpırdar (userData.spray).
export function fountain() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, M.paving, 0, 0, 0);
  cyl(st, 0.44, 0.44, 0.004, M.terracotta, 0, 0.03, 0, 40);
  cyl(st, 0.4, 0.4, 0.007, M.stone, 0, 0.03, 0, 40);
  // Havuz: dolu taban, su ve sekiz kenarlı taş kenar
  cyl(st, 0.27, 0.28, 0.04, M.rim, 0, 0.03, 0, 8);
  cyl(st, 0.25, 0.25, 0.004, WATER, 0, 0.07, 0, 8);
  const R = 0.28;
  const side = 2 * R * Math.sin(Math.PI / 8);
  const ap = R * Math.cos(Math.PI / 8);
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    const e = box(st, side + 0.01, 0.035, 0.03, M.stone, Math.sin(a) * (ap - 0.015), 0.07, Math.cos(a) * (ap - 0.015));
    e.rotation.y = a;
  }
  // Ortadaki sütun ve kâseler
  cyl(st, 0.035, 0.045, 0.15, M.stone, 0, 0.07, 0, 12);
  cyl(st, 0.13, 0.045, 0.035, M.stone, 0, 0.2, 0, 20);
  cyl(st, 0.12, 0.12, 0.003, WATER, 0, 0.234, 0, 20); // su kâsenin ağzından belirgin yüksekte (aynı boyda titreşiyordu)
  cyl(st, 0.022, 0.03, 0.09, M.stone, 0, 0.235, 0, 10);
  cyl(st, 0.07, 0.025, 0.025, M.stone, 0, 0.31, 0, 16);
  cyl(st, 0.062, 0.062, 0.003, WATER, 0, 0.334, 0, 16);
  add(st, new THREE.SphereGeometry(0.018, 10, 8), M.stone, 0, 0.345, 0);
  // Su perdeleri ve havuz fıskiyeleri
  add(st, new THREE.CylinderGeometry(0.131, 0.16, 0.161, 24, 1, true), SPRAY, 0, 0.074 + 0.08, 0);
  add(st, new THREE.CylinderGeometry(0.071, 0.088, 0.1, 18, 1, true), SPRAY, 0, 0.235 + 0.05, 0);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const c = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(Math.cos(a) * 0.245, 0.1, Math.sin(a) * 0.245),
      new THREE.Vector3(Math.cos(a) * 0.21, 0.2, Math.sin(a) * 0.21),
      new THREE.Vector3(Math.cos(a) * 0.175, 0.074, Math.sin(a) * 0.175),
    );
    add(st, new THREE.TubeGeometry(c, 8, 0.004, 4, false), SPRAY, 0, 0, 0);
  }
  // Çevre: banklar, lambalar, köşelerde çiçek tarhı ve ağaç
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    bench(st, Math.sin(a) * 0.37, Math.cos(a) * 0.37, a + Math.PI);
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    lamp(st, sx * 0.27, sz * 0.27);
    flowerBed(st, sx * 0.42, sz * 0.42, 0.12, 0.12, sx + sz + 2);
  }
  tree(st, PROPS.treeBlossom, -0.42, -0.42, 0.55, 1);
  tree(st, PROPS.treeBlossom, 0.42, -0.42, 0.5, 2);
  g.add(mergeStatic([st]));
  // Tepede fışkıran su (boyu kıpırdar)
  const jet = new THREE.Group();
  jet.position.set(0, 0.35, 0);
  jet.add(part(new THREE.ConeGeometry(0.012, 0.11, 8).translate(0, 0.055, 0), SPRAY, 0, 0, 0));
  jet.add(part(new THREE.SphereGeometry(0.02, 8, 6), SPRAY, 0, 0.11, 0));
  g.add(jet);
  g.userData.spray = jet;
  return g;
}

// ======================= Heykel (1x1) =======================
// Basamaklı granit kaide üstünde bronz atlı heykel (ön bacağını kaldırmış at ve ileriyi gösteren süvari),
// çevresinde yuvarlak çimen, çiçekler, bayrak direkleri, banklar ve lambalar.
export function statue() {
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, M.paving, 0, 0, 0);
  cyl(st, 0.43, 0.43, 0.006, M.lawn, 0, 0.03, 0, 40);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const p = box(st, 0.1, 0.008, 0.3, M.path, Math.sin(a) * 0.34, 0.03, Math.cos(a) * 0.34);
    p.rotation.y = a;
  }
  cyl(st, 0.22, 0.22, 0.008, M.path, 0, 0.03, 0, 32);
  // Çiçek halkası
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2;
    if (Math.abs(Math.sin(2 * a)) < 0.25) continue;
    add(st, FLOWER_GEO, FLOWERS[k % FLOWERS.length], Math.cos(a) * 0.27, 0.045, Math.sin(a) * 0.27);
  }
  // Kaide: üç basamak, granit gövde, korniş, bronz yazıt
  for (let k = 0; k < 3; k++) box(st, 0.34 - k * 0.04, 0.02, 0.22 - k * 0.03, M.rim, 0, 0.038 + k * 0.02, 0);
  box(st, 0.24, 0.16, 0.12, M.granite, 0, 0.098, 0);
  box(st, 0.26, 0.016, 0.14, M.granite, 0, 0.258, 0);
  box(st, 0.25, 0.012, 0.13, M.rim, 0, 0.09, 0);
  box(st, 0.08, 0.04, 0.003, M.bronze, 0, 0.15, 0.061);
  // At (x yönünde), dört bacak; sağ ön bacak havada
  const H = item(st, 0, 0, 0, 1.15, 0.274);
  const B = M.bronze;
  box(H, 0.2, 0.008, 0.07, B, 0, 0, 0);
  add(H, new THREE.CapsuleGeometry(0.03, 0.08, 4, 10).rotateZ(Math.PI / 2), B, 0, 0.1, 0);
  add(H, new THREE.SphereGeometry(0.034, 10, 8), B, 0.05, 0.102, 0);
  add(H, new THREE.SphereGeometry(0.034, 10, 8), B, -0.05, 0.106, 0);
  const neck = add(H, new THREE.CapsuleGeometry(0.019, 0.06, 4, 8), B, 0.085, 0.15, 0);
  neck.rotation.z = -0.6;
  const head = add(H, new THREE.CapsuleGeometry(0.014, 0.04, 4, 8), B, 0.12, 0.175, 0);
  head.rotation.z = -2.1;
  for (const z of [-0.007, 0.007]) add(H, new THREE.ConeGeometry(0.005, 0.016, 4), B, 0.103, 0.2, z);
  box(H, 0.04, 0.012, 0.006, B, 0.075, 0.165, 0).rotation.z = -0.6;
  for (const z of [-0.016, 0.016]) {
    rod(H, [-0.06, 0.09, z], [-0.064, 0.008, z], 0.008, B, 6);
    if (z < 0) {
      rod(H, [0.055, 0.09, z], [0.09, 0.07, z], 0.008, B, 6);
      rod(H, [0.09, 0.07, z], [0.085, 0.035, z], 0.007, B, 6);
    } else rod(H, [0.055, 0.09, z], [0.06, 0.008, z], 0.008, B, 6);
  }
  rod(H, [-0.09, 0.115, 0], [-0.115, 0.04, 0], 0.008, B, 5);
  // Süvari: gövde, baş ve kalpak, ileriyi gösteren kol, pelerin
  const torso = add(H, new THREE.CapsuleGeometry(0.016, 0.04, 4, 8), B, 0.005, 0.175, 0);
  torso.rotation.z = -0.15;
  add(H, new THREE.SphereGeometry(0.014, 10, 8), B, 0.01, 0.222, 0);
  cyl(H, 0.012, 0.014, 0.014, B, 0.01, 0.232, 0, 8);
  rod(H, [0.012, 0.195, -0.018], [0.07, 0.235, -0.03], 0.005, B, 5);
  rod(H, [0.012, 0.19, 0.018], [0.045, 0.155, 0.02], 0.005, B, 5);
  for (const z of [-0.022, 0.022]) {
    rod(H, [0, 0.15, z * 0.7], [0.025, 0.12, z * 1.6], 0.007, B, 5);
    rod(H, [0.025, 0.12, z * 1.6], [0.015, 0.085, z * 1.5], 0.006, B, 5);
  }
  const cape = box(H, 0.006, 0.06, 0.036, B, -0.017, 0.13, 0);
  cape.rotation.z = 0.25;
  // Bayraklar, banklar, lambalar, ağaçlar
  for (const sx of [-1, 1]) {
    rod(st, [sx * 0.24, 0.03, -0.24], [sx * 0.24, 0.45, -0.24], 0.005, M.steel, 6);
    box(st, 0.002, 0.06, 0.1, M.red, sx * 0.24, 0.37, -0.19);
    add(st, new THREE.CircleGeometry(0.014, 12).rotateY(Math.PI / 2), M.white, sx * 0.24 + 0.002, 0.4, -0.2);
    bench(st, sx * 0.34, 0.15, (-sx * Math.PI) / 2);
    lamp(st, sx * 0.13, 0.33);
    tree(st, PROPS.treeLarge, sx * 0.4, -0.4, 0.6, sx);
  }
  return mergeStatic([st]);
}

// ======================= Gözlemevi (2x2) =======================
// Taş gövdeli büyük kubbe (yarığından teleskop uzanır), yanında küçük kubbe, camlı araştırma binası,
// büyük radyo çanağı, otopark, yürüyüş yolları, ağaçlar ve lambalar.
const DOME = pm('#dfe6ec', 0.25, 0.75);
function domeHouse(st: THREE.Object3D, x: number, z: number, r: number, h: number, slitTurn: number) {
  cyl(st, r * 1.08, r * 1.12, 0.02, M.rim, x, 0.03, z, 28);
  cyl(st, r, r, h, M.white, x, 0.05, z, 28);
  cyl(st, r * 1.01, r * 1.01, h * 0.12, M.slate, x, 0.05 + h * 0.55, z, 28);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const w = box(st, r * 0.22, h * 0.22, 0.004, windowMat, x + Math.sin(a) * r * 1.005, 0.05 + h * 0.25, z + Math.cos(a) * r * 1.005);
    w.rotation.y = a;
  }
  cyl(st, r * 1.04, r * 1.04, 0.012, M.stone, x, 0.05 + h, z, 28);
  // Kubbe: yarığı olan gümüş yarım küre, içi koyu
  const top = 0.062 + h;
  const gap = 0.55;
  const d = add(st, new THREE.SphereGeometry(r, 28, 12, gap / 2, Math.PI * 2 - gap, 0, Math.PI / 2), DOME, x, top, z);
  d.rotation.y = slitTurn;
  add(st, new THREE.SphereGeometry(r * 0.96, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.iron, x, top, z);
  return top;
}
export function observatory() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  const s = 1 / (2 * 0.96);
  box(st, 0.98, 0.03, 0.98, M.lawn, 0, 0, 0);
  // Yollar ve otopark
  box(st, 0.12, 0.007, 0.5, M.path, 0.05, 0.03, 0.24); // yol, meydandan ve otoparktan belirgin yüksekte (üst üste binen yerler titreşmesin)
  cyl(st, 0.3, 0.3, 0.004, M.paving, -0.12, 0.03, -0.1, 36);
  box(st, 0.36, 0.004, 0.2, M.granite, 0.28, 0.03, 0.36);
  for (let k = 0; k < 5; k++) box(st, 0.004, 0.002, 0.09, M.white, 0.14 + k * 0.07, 0.034, 0.32);
  // Büyük kubbe ve teleskop
  const top = domeHouse(st, -0.12, -0.1, 0.19, 0.17, Math.PI / 2);
  const scope = new THREE.Group();
  scope.position.set(-0.12, top + 0.02, -0.1);
  const tube = add(scope, new THREE.CylinderGeometry(0.03, 0.036, 0.3, 14), M.white, 0, 0.11, 0);
  tube.rotation.x = 0.75;
  tube.position.set(0, 0.1, 0.09);
  add(scope, new THREE.CylinderGeometry(0.031, 0.031, 0.01, 14), M.iron, 0, 0.21, 0.19).rotation.x = 0.75;
  st.add(scope);
  // Küçük kubbe
  domeHouse(st, 0.3, -0.3, 0.09, 0.1, 0.4);
  // Araştırma binası: camlı iki kat, tabela
  st.add(part(KIT.facadeBox(0.34, 0.14, 0.16, 0.03), KIT.GLASS[3], -0.22, 0.03 + 0.07, 0.3));
  box(st, 0.36, 0.014, 0.18, M.white, -0.22, 0.17, 0.3);
  box(st, 0.22, 0.034, 0.004, signMat('GÖZLEMEVİ', '#1a237e', '#ffe082'), -0.22, 0.13, 0.381);
  box(st, 0.08, 0.012, 0.06, M.white, -0.12, 0.12, 0.41);
  // Radyo teleskop: üç ayak, çanak, alıcı kolu
  const dx = 0.3, dz = 0.02;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    rod(st, [dx + Math.cos(a) * 0.07, 0.03, dz + Math.sin(a) * 0.07], [dx, 0.17, dz], 0.008, M.steel, 6);
  }
  cyl(st, 0.06, 0.07, 0.02, M.rim, dx, 0.03, dz, 12);
  const dish = new THREE.Group();
  dish.position.set(dx, 0.19, dz);
  dish.rotation.x = -0.7;
  dish.rotation.y = 0.5;
  const prof = [];
  for (let k = 0; k <= 8; k++) {
    const r = (k / 8) * 0.15;
    prof.push(new THREE.Vector2(r, (r * r) / 0.3));
  }
  add(dish, new THREE.LatheGeometry(prof, 24), M.white, 0, 0, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    rod(dish, [Math.cos(a) * 0.14, 0.065, Math.sin(a) * 0.14], [0, 0.13, 0], 0.003, M.gray, 4);
  }
  cyl(dish, 0.012, 0.012, 0.02, M.iron, 0, 0.125, 0, 8);
  st.add(dish);
  // Ağaçlar, banklar, lambalar
  tree(st, PROPS.treePine, -0.42, 0.42, 0.7 * s, 1);
  tree(st, PROPS.treePine, 0.44, -0.44, 0.6 * s, 2);
  tree(st, PROPS.treePine, -0.44, -0.42, 0.65 * s, 3);
  tree(st, PROPS.treeLarge, 0.44, 0.18, 0.6 * s, 4);
  bench(st, 0.14, 0.12, -Math.PI / 2, s);
  for (const z of [0.1, 0.4]) lamp(st, -0.02, z, s);
  g.add(mergeStatic([st]));
  return g;
}

// ======================= Parklar (1x1, üç çeşit) =======================
// 0: çardaklı bahçe, 1: göletli park, 2: oyun parkı. seed: ağaçların yönü için
export function makePark(variant: number, seed: number) {
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, M.lawn, 0, 0, 0);
  for (const sx of [-1, 1]) {
    box(st, 0.98, 0.012, 0.016, M.rim, 0, 0.03, sx * 0.482);
    box(st, 0.016, 0.012, 0.98, M.rim, sx * 0.482, 0.03, 0);
  }
  const type = ((variant % PARK_KINDS) + PARK_KINDS) % PARK_KINDS;
  const rot = seed * 6.28;
  if (type === 0) gardenPark(st, rot);
  else if (type === 1) pondPark(st, rot);
  else playPark(st, rot);
  return mergeStatic([st]);
}

// Çardaklı bahçe: halka yol ve dört giriş, ortada beyaz çardak, çit sıraları, çiçekler, banklar
function gardenPark(st: THREE.Group, rot: number) {
  add(st, new THREE.RingGeometry(0.24, 0.31, 40).rotateX(-Math.PI / 2), M.path, 0, 0.033, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const p = box(st, 0.08, 0.004, 0.19, M.path, Math.sin(a) * 0.395, 0.03, Math.cos(a) * 0.395);
    p.rotation.y = a;
    for (const sd of [-1, 1]) {
      const h = box(st, 0.016, 0.03, 0.15, M.hedge, Math.sin(a) * 0.405 + Math.cos(a) * sd * 0.055, 0.03, Math.cos(a) * 0.405 - Math.sin(a) * sd * 0.055);
      h.rotation.y = a;
    }
  }
  // Çardak
  cyl(st, 0.12, 0.125, 0.025, M.stone, 0, 0.03, 0, 8);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    rod(st, [Math.sin(a) * 0.105, 0.055, Math.cos(a) * 0.105], [Math.sin(a) * 0.105, 0.175, Math.cos(a) * 0.105], 0.006, M.white, 6);
    if (k % 2) {
      const b = (a + ((k + 1) / 8) * Math.PI * 2) / 2;
      const r = box(st, 0.08, 0.008, 0.006, M.white, Math.sin(b) * 0.1, 0.09, Math.cos(b) * 0.1);
      r.rotation.y = b;
    }
  }
  cyl(st, 0.145, 0.145, 0.012, M.white, 0, 0.175, 0, 8);
  add(st, new THREE.ConeGeometry(0.15, 0.08, 8), M.teal, 0, 0.227, 0);
  add(st, new THREE.SphereGeometry(0.012, 8, 6), M.gold, 0, 0.27, 0);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    add(st, new THREE.IcosahedronGeometry(0.026, 0), M.hedge, Math.sin(a) * 0.19, 0.055, Math.cos(a) * 0.19);
    bench(st, Math.sin(a) * 0.345, Math.cos(a) * 0.345, a + Math.PI);
  }
  // Köşeler: iki köşede ağaç, ikisinde çiçek tarhı
  const flip = Math.sin(rot) > 0 ? 1 : -1;
  tree(st, PROPS.treeLarge, -0.4 * flip, -0.4, 0.62, rot);
  tree(st, PROPS.treeLarge, 0.4 * flip, 0.4, 0.58, rot + 1);
  flowerBed(st, 0.4 * flip, -0.4, 0.13, 0.13, 1);
  flowerBed(st, -0.4 * flip, 0.4, 0.13, 0.13, 3);
  lamp(st, 0.075, 0.33);
  lamp(st, -0.075, -0.33);
}

// Göletli park: kıvrımlı kıyılı gölet, taşlar, iskele, nilüferler, ördekler, sazlar; kıvrımlı yol ve banklar
function pondPark(st: THREE.Group, rot: number) {
  const cxp = -0.05, czp = -0.1;
  const shape = (scale: number) => {
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const r = (0.24 + Math.sin(2 * a + 0.7) * 0.035 + Math.cos(3 * a) * 0.025) * scale;
      pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    }
    const sh = new THREE.Shape();
    sh.moveTo(pts[0].x, pts[0].y);
    sh.splineThru([...pts.slice(1), pts[0]]);
    return new THREE.ShapeGeometry(sh, 6).rotateX(-Math.PI / 2);
  };
  add(st, shape(1.1), M.rim, cxp, 0.032, czp);
  add(st, shape(1), WATER, cxp, 0.036, czp);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + 0.2;
    const r = (0.24 + Math.sin(2 * a + 0.7) * 0.035 + Math.cos(3 * a) * 0.025) * 1.06;
    add(st, new THREE.IcosahedronGeometry(0.012 + (k % 3) * 0.004, 0), M.granite, cxp + Math.cos(a) * r, 0.036, czp - Math.sin(a) * r);
  }
  // Nilüferler ve ördekler
  for (const [x, z] of [[-0.18, -0.2], [-0.14, -0.24], [0.08, 0.0], [-0.2, 0.0]] as [number, number][]) cyl(st, 0.02, 0.02, 0.003, M.pad, x, 0.037, z, 10);
  for (const [x, z, r] of [[0.0, -0.18, 0.5], [0.05, -0.14, 1.2], [-0.12, -0.05, 2.6]] as [number, number, number][]) {
    const d = item(st, x, z, r, 1, 0.036);
    add(d, new THREE.SphereGeometry(0.012, 6, 4).scale(1, 0.7, 1.4), M.white, 0, 0.006, 0);
    add(d, new THREE.SphereGeometry(0.007, 6, 4), M.white, 0, 0.016, 0.012);
    add(d, new THREE.ConeGeometry(0.003, 0.008, 4).rotateX(Math.PI / 2), M.yellow, 0, 0.016, 0.021);
  }
  // Sazlar
  for (let k = 0; k < 14; k++) {
    const x = 0.12 + (k % 5) * 0.012, z = -0.3 + Math.floor(k / 5) * 0.014 + (k % 2) * 0.006;
    add(st, new THREE.ConeGeometry(0.003, 0.05 + (k % 3) * 0.01, 3), M.reed, x, 0.06, z);
  }
  // İskele
  box(st, 0.06, 0.008, 0.14, M.wood, -0.24, 0.042, 0.03);
  for (const [x, z] of [[-0.265, -0.03], [-0.215, -0.03], [-0.265, 0.09], [-0.215, 0.09]] as [number, number][]) rod(st, [x, 0.03, z], [x, 0.055, z], 0.004, M.darkWood, 4);
  // Kıvrımlı yol (çakıl taşlı)
  const path = new THREE.CubicBezierCurve3(
    new THREE.Vector3(-0.49, 0, 0.3), new THREE.Vector3(-0.1, 0, 0.3), new THREE.Vector3(0.2, 0, 0.3), new THREE.Vector3(0.49, 0, 0.0),
  );
  // Yalnız üst yüzü olan yuvarlak taşlar (yan yüzleri çimenin içinde görünmüyordu, boşa üçgendi)
  const disc = new THREE.CircleGeometry(0.045, 10).rotateX(-Math.PI / 2);
  for (let k = 0; k <= 22; k++) {
    const p = path.getPoint(k / 22);
    add(st, disc, M.path, p.x, 0.034, p.z);
  }
  bench(st, -0.12, 0.2, Math.PI);
  bench(st, 0.16, 0.2, Math.PI + 0.3);
  lamp(st, 0.02, 0.36);
  // Ağaçlar ve çalılar
  tree(st, PROPS.treeBlossom, 0.36, -0.36, 0.6, rot);
  tree(st, PROPS.treeLarge, -0.38, 0.42, 0.55, rot + 1);
  tree(st, PROPS.treeLarge, 0.38, 0.38, 0.5, rot + 2);
  tree(st, PROPS.bush, 0.3, -0.12, 0.8, rot);
  tree(st, PROPS.bush, -0.4, -0.38, 0.8, rot + 1);
}

// Oyun parkı: kauçuk zemin, kaydıraklı kule, salıncak, tahterevalli, kum havuzu, yaylı at; çevresinde bank ve ağaçlar
function playPark(st: THREE.Group, rot: number) {
  box(st, 0.08, 0.004, 0.42, M.path, 0, 0.03, 0.29);
  box(st, 0.62, 0.006, 0.52, M.rubber, 0.04, 0.03, -0.12);
  // Kule ve kaydırak
  const tx = 0.2, tz = -0.22;
  for (const x of [-0.045, 0.045]) for (const z of [-0.045, 0.045]) rod(st, [tx + x, 0.036, tz + z], [tx + x, 0.2, tz + z], 0.005, M.blue, 6);
  box(st, 0.1, 0.01, 0.1, M.wood, tx, 0.11, tz);
  for (const x of [-0.045, 0.045]) box(st, 0.004, 0.04, 0.09, M.yellow, tx + x, 0.12, tz);
  add(st, new THREE.ConeGeometry(0.085, 0.06, 4).rotateY(Math.PI / 4), M.red, tx, 0.23, tz);
  const slide = box(st, 0.04, 0.005, 0.17, M.yellow, tx, 0.038, tz + 0.12);
  slide.position.y = 0.075;
  slide.rotation.x = 0.6;
  for (const x of [-0.022, 0.022]) {
    const rail = box(st, 0.004, 0.012, 0.17, M.yellow, tx + x, 0.038, tz + 0.12);
    rail.position.y = 0.082;
    rail.rotation.x = 0.6;
  }
  for (const x of [-0.02, 0.02]) rod(st, [tx - 0.06 + x * 0, 0.036, tz + x], [tx - 0.06, 0.11, tz + x], 0.003, M.gray, 4);
  for (let k = 0; k < 4; k++) rod(st, [tx - 0.06, 0.05 + k * 0.018, tz - 0.02], [tx - 0.06, 0.05 + k * 0.018, tz + 0.02], 0.002, M.gray, 4);
  // Salıncak
  const sx0 = -0.12, sz0 = -0.02;
  for (const dx of [-0.12, 0.12]) {
    for (const dz of [-0.04, 0.04]) rod(st, [sx0 + dx, 0.036, sz0 + dz], [sx0 + dx, 0.17, sz0], 0.005, M.red, 6);
  }
  rod(st, [sx0 - 0.12, 0.17, sz0], [sx0 + 0.12, 0.17, sz0], 0.005, M.red, 6);
  for (const dx of [-0.05, 0.05]) {
    for (const cx of [-0.016, 0.016]) rod(st, [sx0 + dx + cx, 0.17, sz0], [sx0 + dx + cx, 0.06, sz0], 0.0015, M.gray, 3);
    box(st, 0.04, 0.005, 0.016, M.iron, sx0 + dx, 0.055, sz0);
  }
  // Tahterevalli, kum havuzu, yaylı at
  box(st, 0.016, 0.03, 0.016, M.gray, 0.2, 0.036, 0.04);
  const plank = box(st, 0.16, 0.006, 0.022, M.blue, 0.2, 0.06, 0.04);
  plank.rotation.z = 0.25;
  box(st, 0.16, 0.012, 0.16, M.wood, -0.14, 0.036, -0.26);
  box(st, 0.14, 0.014, 0.14, M.sand, -0.14, 0.036, -0.26);
  add(st, new THREE.ConeGeometry(0.025, 0.02, 8), M.sand, -0.16, 0.058, -0.28);
  rod(st, [0.03, 0.036, -0.32], [0.03, 0.06, -0.32], 0.006, M.gray, 6);
  add(st, new THREE.CapsuleGeometry(0.012, 0.03, 3, 6).rotateX(Math.PI / 2), PAINT[3], 0.03, 0.075, -0.32);
  box(st, 0.012, 0.022, 0.012, PAINT[3], 0.03, 0.08, -0.3);
  // Bank, ağaç, çalı, lamba
  bench(st, -0.2, 0.26, Math.PI / 2);
  bench(st, 0.22, 0.3, -Math.PI / 2);
  tree(st, PROPS.treeLarge, -0.38, 0.4, 0.6, rot);
  tree(st, PROPS.treeLarge, 0.4, 0.42, 0.55, rot + 1);
  tree(st, PROPS.treeSmall, -0.42, -0.42, 0.55, rot + 2);
  tree(st, PROPS.bush, 0.42, -0.42, 0.8, rot);
  lamp(st, 0.07, 0.42);
}
