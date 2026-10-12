import * as THREE from 'three';
import { PROPS, type DecorKind } from './config';
import { part, mat, pad, windowMat, showcaseMat } from './utilities';
import { makeModel } from './assets';
import { makeAirliner } from './planes';
import { mergeStatic } from './batcher';
import { SEA_Y } from './water';
import { HISTORIC } from './historic';
import { lake, hill, volley, casino } from './extras';
import { ferrisWheel, funfair, museum, fountain, statue, observatory } from './fun';
import { station, busStop, metro, airport, university, beach, palm, RUNWAY } from './places';
import { bench, lamp } from './parts';

export { palm, RUNWAY };

// Simge yapılar. Dönme dolap, lunapark, müze, çeşme ve heykel fun.ts'te; tarihi yapılar historic.ts'te.

const M = {
  white: mat('#f4f4f2'),
  steel: mat('#8d99a6'),
  red: mat('#e53935'),
  grass: mat('#5cb85c'),
  line: mat('#ffffff'),
  seat: mat('#3b6fd8'),
  stand: mat('#d0d6dc'),
};

// Otopark (1x1): asfalt, arka sırada üç park yeri, önü yola açık; köşede mavi "P" tabelası.
// Park eden arabaları trafik çizer (traffic.ts), burada sadece zemin var.
function parkingLot() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.036, 0.98), mat('#555b63'), 0, 0.018, 0));
  const white = mat('#f4f4f2');
  // Park yeri çizgileri ve arka çizgi
  for (const x of [-0.45, -0.15, 0.15, 0.45]) st.add(part(new THREE.BoxGeometry(0.014, 0.003, 0.44), white, x, 0.037, -0.25));
  st.add(part(new THREE.BoxGeometry(0.92, 0.003, 0.014), white, 0, 0.037, -0.47));
  // Koridorda yön oku
  st.add(part(new THREE.BoxGeometry(0.03, 0.003, 0.16), white, 0, 0.037, 0.2));
  for (const s of [-1, 1]) {
    const a = part(new THREE.BoxGeometry(0.03, 0.003, 0.09), white, s * 0.025, 0.037, 0.12);
    a.rotation.y = s * 0.7;
    st.add(a);
  }
  // Kenarlarda bordür ve çiçeklik
  const curb = mat('#d9d6cf');
  st.add(part(new THREE.BoxGeometry(0.98, 0.05, 0.03), curb, 0, 0.025, -0.485));
  for (const s of [-1, 1]) {
    st.add(part(new THREE.BoxGeometry(0.03, 0.05, 0.98), curb, s * 0.485, 0.025, 0));
    st.add(part(new THREE.BoxGeometry(0.1, 0.05, 0.1), mat('#5aa646'), s * 0.43, 0.06, 0.43));
  }
  // "P" tabelası
  const blue = mat('#1565c0');
  st.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), M.steel, 0.43, 0.15, 0.3));
  st.add(part(new THREE.BoxGeometry(0.012, 0.1, 0.1), blue, 0.43, 0.32, 0.3));
  st.add(part(new THREE.BoxGeometry(0.014, 0.06, 0.012), white, 0.43, 0.32, 0.28));
  st.add(part(new THREE.BoxGeometry(0.014, 0.012, 0.03), white, 0.43, 0.345, 0.29));
  st.add(part(new THREE.BoxGeometry(0.014, 0.012, 0.03), white, 0.43, 0.32, 0.29));
  st.add(part(new THREE.BoxGeometry(0.014, 0.03, 0.012), white, 0.43, 0.333, 0.303));
  g.add(mergeStatic([st]));
  return g;
}

// Büyütülen yapıların içindeki ağaç gibi eşyalar normal boyda kalsın (n = kaç kare)
function tree(path: string, x: number, z: number, n: number, rot = 0, size = 0.65) {
  const t = makeModel(path);
  t.scale.multiplyScalar(size / (n * 0.96));
  t.position.set(x, 0.03, z);
  t.rotation.y = rot;
  return t;
}

// Saat kulesi: taş gövde, dört yüzde saat, sivri çatı, çevresinde çiçekli meydan
function clockTower() {
  const g = new THREE.Group();
  g.add(part(new THREE.BoxGeometry(0.92, 0.04, 0.92), mat('#d8d2c4'), 0, 0.02, 0));
  const stone = mat('#c9a77c');
  const light = mat('#e8dcc4');
  for (const [x, z] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) {
    g.add(part(new THREE.BoxGeometry(0.16, 0.04, 0.16), mat('#5aa53c'), x, 0.06, z));
    for (let k = 0; k < 3; k++) g.add(part(new THREE.SphereGeometry(0.022, 6, 4), mat(k % 2 ? '#e53935' : '#fdd835'), x - 0.04 + k * 0.04, 0.09, z + (k - 1) * 0.03));
  }
  // Gerçek oranına yakın boy: yapı 1.6 kat büyütülür (zemin aynı kalır)
  const tw = new THREE.Group();
  tw.scale.setScalar(1.6);
  tw.position.y = -0.024;
  g.add(tw);
  tw.add(part(new THREE.BoxGeometry(0.26, 0.1, 0.26), light, 0, 0.09, 0));
  tw.add(part(new THREE.BoxGeometry(0.18, 0.62, 0.18), stone, 0, 0.45, 0));
  for (const s of [-1, 1]) {
    tw.add(part(new THREE.BoxGeometry(0.02, 0.6, 0.19), light, s * 0.08, 0.45, 0));
    tw.add(part(new THREE.BoxGeometry(0.19, 0.6, 0.02), light, 0, 0.45, s * 0.08));
  }
  tw.add(part(new THREE.BoxGeometry(0.22, 0.2, 0.22), light, 0, 0.86, 0));
  // Dört yüzde saat kadranı ve akrep-yelkovan
  const white = mat('#ffffff');
  const dark = mat('#2b2f36');
  for (let k = 0; k < 4; k++) {
    const face = new THREE.Group();
    face.rotation.y = (k * Math.PI) / 2;
    face.add(part(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 18).rotateX(Math.PI / 2), white, 0, 0.86, 0.112));
    face.add(part(new THREE.BoxGeometry(0.008, 0.055, 0.004), dark, 0, 0.88, 0.119));
    const hour = part(new THREE.BoxGeometry(0.008, 0.04, 0.004), dark, 0.012, 0.86, 0.119);
    hour.rotation.z = -Math.PI / 2.5;
    face.add(hour);
    tw.add(face);
  }
  tw.add(part(new THREE.BoxGeometry(0.25, 0.03, 0.25), stone, 0, 0.975, 0));
  tw.add(part(new THREE.ConeGeometry(0.17, 0.3, 4).rotateY(Math.PI / 4), mat('#5d6d7e'), 0, 1.14, 0));
  tw.add(part(new THREE.SphereGeometry(0.025, 8, 6), mat('#e0b84c'), 0, 1.3, 0));
  // Banklar ve lambalar
  bench(g, 0, 0.3, Math.PI);
  bench(g, 0, -0.3, 0);
  for (const x of [-0.2, 0.2]) lamp(g, x, 0.3);
  return g;
}

// --- Sahil ---
const LH = {
  white: mat('#f6f5f1'),
  red: mat('#d63a32'),
  dark: mat('#37474f'),
  stone: mat('#9b958a'),
  lamp: new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff2c0', emissiveIntensity: 0 }),
};
LH.lamp.name = 'lamp'; // gece yanar (DayNight)

// Deniz feneri kulesi: kırmızı-beyaz kuşaklar, balkon, gece yanan fener odası (yerel ölçüde boyu ~0.93)
export function lighthouseTower() {
  const g = new THREE.Group();
  g.add(part(new THREE.CylinderGeometry(0.17, 0.2, 0.06, 12), LH.stone, 0, 0.03, 0));
  for (let k = 0; k < 4; k++) {
    g.add(part(new THREE.CylinderGeometry(0.098 - k * 0.012, 0.11 - k * 0.012, 0.17, 14), k % 2 ? LH.red : LH.white, 0, 0.145 + k * 0.17, 0));
  }
  // Küçük pencereler
  for (const [y, a] of [[0.2, 0], [0.37, 2], [0.54, 4]]) {
    const r = 0.105 - y * 0.07;
    g.add(part(new THREE.BoxGeometry(0.02, 0.035, 0.02), LH.dark, Math.sin(a) * r, y, Math.cos(a) * r));
  }
  g.add(part(new THREE.CylinderGeometry(0.095, 0.095, 0.018, 14), LH.dark, 0, 0.74, 0));
  g.add(part(new THREE.CylinderGeometry(0.092, 0.092, 0.03, 14, 1, true), LH.dark, 0, 0.765, 0));
  g.add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 10), LH.lamp, 0, 0.79, 0));
  g.add(part(new THREE.ConeGeometry(0.072, 0.08, 10), LH.red, 0, 0.87, 0));
  g.add(part(new THREE.SphereGeometry(0.012, 6, 4), LH.dark, 0, 0.915, 0));
  return g;
}

// Işık huzmesi (gece, fener yanınca görünür)
const beamMat = new THREE.MeshBasicMaterial({
  color: '#fff6c8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
});

// Deniz feneri (1x1): kayalık kıyıda kule ve bekçi evi. Ön yüz (+z) denize bakar.
function lighthouse() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#efdca4'), 0, 0.01, 0));
  st.add(part(new THREE.BoxGeometry(0.98, 0.022, 0.5), mat('#8fc76a'), 0, 0.011, -0.24));
  for (const [x, z, s] of [[0.28, 0.36, 0.11], [0.1, 0.42, 0.08], [0.38, 0.12, 0.08], [-0.05, 0.3, 0.06]]) {
    const r = part(new THREE.IcosahedronGeometry(s, 0), LH.stone, x, s * 0.4, z);
    r.rotation.set(x * 5, z * 7, 0);
    st.add(r);
  }
  const tower = lighthouseTower();
  tower.position.set(0.12, 0, 0.12);
  st.add(tower);
  // Bekçi evi
  st.add(part(new THREE.BoxGeometry(0.26, 0.12, 0.18), LH.white, -0.24, 0.08, -0.22));
  const roof = part(new THREE.CylinderGeometry(0.11, 0.11, 0.28, 3), LH.red, -0.24, 0.18, -0.22);
  roof.rotation.set(0, 0, Math.PI / 2);
  roof.scale.set(0.6, 1, 1);
  st.add(roof);
  st.add(part(new THREE.BoxGeometry(0.05, 0.07, 0.006), LH.dark, -0.24, 0.055, -0.128));
  st.add(part(new THREE.BoxGeometry(0.04, 0.035, 0.006), windowMat, -0.32, 0.09, -0.128));
  st.add(part(new THREE.BoxGeometry(0.04, 0.035, 0.006), windowMat, -0.16, 0.09, -0.128));
  for (let k = 0; k < 4; k++) st.add(part(new THREE.BoxGeometry(0.05, 0.006, 0.05), mat('#d8d2c4'), -0.12 + k * 0.07, 0.024, -0.04 + k * 0.05));
  g.add(mergeStatic([st]));
  // Dönen ışık huzmesi
  const beam = new THREE.Group();
  beam.position.set(0.12, 0.79, 0.12);
  for (const turn of [0, Math.PI]) {
    const geo = new THREE.ConeGeometry(0.28, 2.6, 16, 1, true).rotateZ(Math.PI / 2).translate(1.3, 0, 0);
    const m = new THREE.Mesh(geo, beamMat);
    m.rotation.y = turn;
    beam.add(m);
  }
  beam.visible = false;
  g.add(beam);
  g.userData.beam = beam;
  return g;
}

// Yat: beyaz gövde, renkli şerit, ahşap güverte, kabin; yelkenli ya da motorlu
const sailMat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.7 });
function yacht(sail: boolean, stripe: string) {
  const b = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-0.08, -0.027);
  shape.lineTo(0.04, -0.027);
  shape.quadraticCurveTo(0.085, -0.016, 0.1, 0);
  shape.quadraticCurveTo(0.085, 0.016, 0.04, 0.027);
  shape.lineTo(-0.08, 0.027);
  shape.lineTo(-0.08, -0.027);
  const hull = new THREE.ExtrudeGeometry(shape, { depth: 0.032, bevelEnabled: false, curveSegments: 4 }).rotateX(-Math.PI / 2);
  b.add(part(hull, LH.white, 0, 0, 0));
  b.add(part(new THREE.BoxGeometry(0.15, 0.007, 0.056), mat(stripe), -0.005, 0.02, 0));
  b.add(part(new THREE.BoxGeometry(0.13, 0.004, 0.044), mat('#c9a06a'), -0.01, 0.034, 0));
  b.add(part(new THREE.BoxGeometry(0.06, 0.026, 0.038), LH.white, -0.02, 0.047, 0));
  b.add(part(new THREE.BoxGeometry(0.062, 0.008, 0.04), LH.dark, -0.02, 0.052, 0));
  if (sail) {
    b.add(part(new THREE.CylinderGeometry(0.0025, 0.0025, 0.24, 5), mat('#dddddd'), 0.012, 0.16, 0));
    const tri = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-0.085, 0), new THREE.Vector2(0, 0.2)]));
    b.add(part(tri, sailMat, 0.01, 0.06, 0));
  } else {
    b.add(part(new THREE.BoxGeometry(0.035, 0.02, 0.032), LH.white, -0.025, 0.07, 0));
    b.add(part(new THREE.BoxGeometry(0.037, 0.007, 0.034), LH.dark, -0.025, 0.074, 0));
  }
  return b;
}

// Yat limanı (2x2): kulüp binası, kafe, ahşap iskeleler denize uzanır, iskelelerin arasında yatlar sallanır.
// Ön yüz (+z) denize bakar; iskeleler arazinin dışına, denizin üstüne taşar.
function marina() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  const wood = mat('#b98a56');
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.76), mat('#ddd6c6'), 0, 0.01, -0.11));
  st.add(part(new THREE.BoxGeometry(0.98, 0.016, 0.22), mat('#efdca4'), 0, 0.008, 0.38));
  // Kulüp binası: beyaz, mavi çatı, geniş camlar ve üst kat
  st.add(part(new THREE.BoxGeometry(0.34, 0.12, 0.2), LH.white, -0.2, 0.08, -0.3));
  st.add(part(new THREE.BoxGeometry(0.38, 0.018, 0.24), mat('#1e88e5'), -0.2, 0.149, -0.3));
  st.add(part(new THREE.BoxGeometry(0.3, 0.05, 0.006), windowMat, -0.2, 0.085, -0.197));
  st.add(part(new THREE.BoxGeometry(0.18, 0.06, 0.12), LH.white, -0.26, 0.19, -0.33));
  st.add(part(new THREE.BoxGeometry(0.2, 0.012, 0.14), mat('#1e88e5'), -0.26, 0.226, -0.33));
  // Şemsiyeli kafe masaları
  ['#e53935', '#fdd835', '#43a047'].forEach((c, n) => {
    const x = 0.08 + n * 0.12;
    st.add(part(new THREE.CylinderGeometry(0.003, 0.003, 0.08, 4), mat('#eeeeee'), x, 0.06, -0.3));
    st.add(part(new THREE.ConeGeometry(0.05, 0.025, 8), mat(c), x, 0.1, -0.3));
    st.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.004, 8), LH.white, x, 0.045, -0.3));
  });
  // Bayraklar
  ['#e53935', '#1e88e5', '#fdd835'].forEach((c, n) => {
    const x = -0.4 + n * 0.08;
    st.add(part(new THREE.CylinderGeometry(0.003, 0.003, 0.2, 4), mat('#eeeeee'), x, 0.11, 0.18));
    st.add(part(new THREE.BoxGeometry(0.045, 0.028, 0.003), mat(c), x + 0.024, 0.19, 0.18));
  });
  st.add(palm(0.42, -0.4, 0.2, 0.1));
  st.add(palm(0.3, -0.12, 0.18, -0.15));
  // İskeleler: kıyı boyunca yürüyüş yolu ve denize uzanan üç parmak
  const deck = 0.016;
  st.add(part(new THREE.BoxGeometry(0.96, 0.012, 0.07), wood, 0, deck, 0.42));
  for (const x of [-0.3, 0, 0.3]) {
    st.add(part(new THREE.BoxGeometry(0.045, 0.012, 0.56), wood, x, deck, 0.72));
    for (const z of [0.6, 0.8, 0.98]) st.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 5), mat('#7b5a3a'), x + 0.025, -0.04, z));
  }
  g.add(mergeStatic([st]));
  // Yatlar: iskelelerin arasında, burunları denize dönük; deniz seviyesinde yüzer (bina 2x2 büyütülür)
  const water = SEA_Y / (2 * 0.96);
  const boats: { obj: THREE.Object3D; phase: number }[] = [];
  ([[-0.15, true, '#1e88e5'], [0.15, false, '#e53935'], [0.44, true, '#00897b'], [-0.44, false, '#3949ab']] as [number, boolean, string][]).forEach(
    ([x, sail, c], n) => {
      const b = yacht(sail, c);
      b.rotation.y = -Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(mergeStatic([b]));
      holder.position.set(x, water - 0.012, 0.74 + (n % 2) * 0.05);
      g.add(holder);
      boats.push({ obj: holder, phase: n * 1.7 });
    },
  );
  g.userData.bob = boats;
  return g;
}

// Cami (2x2): arkada büyük kubbeli ana bina ve köşe kubbeleri, iki yanda şerefeli ince minareler,
// önde revaklı avlu ve ortasında şadırvan. Ön yüz (+z) yola bakar. Minare şerefeleri gece ışıklanır.
const MQ = {
  stone: mat('#f1e8d8'),
  dome: mat('#8fa5b8'),
  dark: mat('#3d4b58'),
  gold: new THREE.MeshStandardMaterial({ color: '#e0b84c', metalness: 0.6, roughness: 0.35 }),
  court: mat('#ddd4c2'),
  lamp: new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff2c0', emissiveIntensity: 0 }),
};
MQ.lamp.name = 'lamp';
const halfDome = (r: number) => new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
function mosque() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#cfc6b3'), 0, 0.01, 0));
  st.add(part(new THREE.BoxGeometry(0.62, 0.012, 0.38), MQ.court, 0, 0.026, 0.27));
  // Ana bina ve kubbe
  const cz = -0.17;
  st.add(part(new THREE.BoxGeometry(0.52, 0.2, 0.46), MQ.stone, 0, 0.12, cz));
  st.add(part(new THREE.BoxGeometry(0.54, 0.02, 0.48), mat('#e2d6c0'), 0, 0.225, cz));
  st.add(part(new THREE.CylinderGeometry(0.17, 0.185, 0.06, 18), MQ.stone, 0, 0.26, cz));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const w = part(new THREE.BoxGeometry(0.018, 0.03, 0.006), MQ.dark, Math.sin(a) * 0.183, 0.262, cz + Math.cos(a) * 0.183);
    w.rotation.y = a;
    st.add(w);
  }
  st.add(part(halfDome(0.2), MQ.dome, 0, 0.29, cz));
  st.add(part(new THREE.CylinderGeometry(0.004, 0.006, 0.08, 6), MQ.gold, 0, 0.53, cz));
  st.add(part(new THREE.SphereGeometry(0.013, 8, 6), MQ.gold, 0, 0.575, cz));
  // Köşe kubbeleri
  for (const dx of [-0.18, 0.18]) {
    for (const dz of [cz - 0.15, cz + 0.15]) {
      st.add(part(new THREE.CylinderGeometry(0.06, 0.06, 0.025, 12), MQ.stone, dx, 0.245, dz));
      st.add(part(halfDome(0.06), MQ.dome, dx, 0.257, dz));
    }
  }
  // Ön cephe: taç kapı ve kemerli pencereler
  const front = cz + 0.231;
  st.add(part(new THREE.BoxGeometry(0.16, 0.24, 0.04), MQ.stone, 0, 0.14, front + 0.01));
  st.add(part(new THREE.BoxGeometry(0.07, 0.12, 0.006), MQ.dark, 0, 0.08, front + 0.032));
  st.add(part(new THREE.CylinderGeometry(0.035, 0.035, 0.006, 12, 1, false, -Math.PI / 2, Math.PI), MQ.dark, 0, 0.14, front + 0.032).rotateX(-Math.PI / 2));
  for (const x of [-0.19, -0.12, 0.12, 0.19]) {
    st.add(part(new THREE.BoxGeometry(0.035, 0.06, 0.006), MQ.dark, x, 0.13, front + 0.003));
    st.add(part(new THREE.CylinderGeometry(0.0175, 0.0175, 0.006, 10, 1, false, -Math.PI / 2, Math.PI), MQ.dark, x, 0.16, front + 0.003).rotateX(-Math.PI / 2));
  }
  // Avlunun iki yanında revaklar (küçük kubbeler)
  for (const x of [-0.27, 0.27]) {
    st.add(part(new THREE.BoxGeometry(0.08, 0.07, 0.34), MQ.stone, x, 0.055, 0.27));
    for (let k = 0; k < 3; k++) {
      st.add(part(halfDome(0.034), MQ.dome, x, 0.09, 0.15 + k * 0.12));
      st.add(part(new THREE.BoxGeometry(0.006, 0.04, 0.05), MQ.dark, x + (x < 0 ? 0.041 : -0.041), 0.05, 0.15 + k * 0.12));
    }
  }
  // Şadırvan
  st.add(part(new THREE.CylinderGeometry(0.06, 0.065, 0.03, 8), MQ.stone, 0, 0.047, 0.28));
  st.add(part(new THREE.CylinderGeometry(0.045, 0.045, 0.006, 8), mat('#4fb3e8'), 0, 0.063, 0.28));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    st.add(part(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 5), MQ.stone, Math.sin(a) * 0.055, 0.09, 0.28 + Math.cos(a) * 0.055));
  }
  st.add(part(new THREE.ConeGeometry(0.075, 0.045, 8), MQ.dome, 0, 0.142, 0.28));
  // Minareler: ana binanın ön köşelerinde
  for (const x of [-0.33, 0.33]) {
    const z = cz + 0.2;
    st.add(part(new THREE.BoxGeometry(0.06, 0.08, 0.06), MQ.stone, x, 0.04, z));
    st.add(part(new THREE.CylinderGeometry(0.022, 0.027, 1.0, 12), MQ.stone, x, 0.58, z));
    for (const [y, r] of [[0.7, 0.036], [0.98, 0.034]]) {
      st.add(part(new THREE.CylinderGeometry(r, 0.026, 0.018, 12), MQ.stone, x, y, z));
      st.add(part(new THREE.CylinderGeometry(r - 0.002, r - 0.002, 0.012, 12, 1, true), MQ.lamp, x, y + 0.015, z));
    }
    st.add(part(new THREE.CylinderGeometry(0.017, 0.02, 0.14, 12), MQ.stone, x, 1.05, z));
    st.add(part(new THREE.CylinderGeometry(0.027, 0.02, 0.012, 12), MQ.stone, x, 1.125, z));
    st.add(part(new THREE.ConeGeometry(0.022, 0.16, 12), MQ.dome, x, 1.21, z));
    st.add(part(new THREE.CylinderGeometry(0.0025, 0.0025, 0.05, 5), MQ.gold, x, 1.31, z));
  }
  // Servi ağaçları
  for (const [x, z] of [[-0.42, 0.42], [0.42, 0.42], [-0.43, -0.42], [0.43, -0.42]] as [number, number][]) st.add(tree(PROPS.treeSmall, x, z, 2, x * 5, 0.6));
  g.add(mergeStatic([st]));
  return g;
}

// --- Hayvanat bahçesi (3x3): üç bölme (zürafa, fil, aslan), gölet, ağaçlar, giriş kapısı; hayvanlar dolaşır ---
function giraffe() {
  const g = new THREE.Group();
  const skin = mat('#e8b04a'), spot = mat('#9a5b2a');
  for (const [x, z] of [[-0.012, -0.018], [0.012, -0.018], [-0.012, 0.018], [0.012, 0.018]]) g.add(part(new THREE.BoxGeometry(0.008, 0.06, 0.008), skin, x, 0.03, z));
  g.add(part(new THREE.BoxGeometry(0.03, 0.03, 0.05), skin, 0, 0.07, 0));
  const neck = part(new THREE.BoxGeometry(0.014, 0.08, 0.014), skin, 0, 0.115, 0.022);
  neck.rotation.x = 0.35;
  g.add(neck);
  g.add(part(new THREE.BoxGeometry(0.016, 0.016, 0.03), skin, 0, 0.16, 0.042));
  for (const [x, y, z] of [[0.016, 0.075, 0.01], [-0.016, 0.07, -0.012], [0.016, 0.065, -0.015]]) g.add(part(new THREE.BoxGeometry(0.001, 0.01, 0.01), spot, x, y, z));
  return g;
}
function elephant() {
  const g = new THREE.Group();
  const skin = mat('#8f969e');
  for (const [x, z] of [[-0.018, -0.024], [0.018, -0.024], [-0.018, 0.024], [0.018, 0.024]]) g.add(part(new THREE.CylinderGeometry(0.008, 0.009, 0.04, 6), skin, x, 0.02, z));
  g.add(part(new THREE.SphereGeometry(0.035, 10, 8).scale(0.9, 0.8, 1.2), skin, 0, 0.065, 0));
  g.add(part(new THREE.SphereGeometry(0.022, 8, 6), skin, 0, 0.075, 0.045));
  for (const s of [-1, 1]) g.add(part(new THREE.BoxGeometry(0.004, 0.03, 0.025), skin, s * 0.022, 0.075, 0.04));
  const trunk = part(new THREE.CylinderGeometry(0.004, 0.007, 0.045, 5), skin, 0, 0.045, 0.062);
  trunk.rotation.x = 0.3;
  g.add(trunk);
  return g;
}
function lion() {
  const g = new THREE.Group();
  const fur = mat('#d9a441'), mane = mat('#8a4b1e');
  for (const [x, z] of [[-0.01, -0.015], [0.01, -0.015], [-0.01, 0.015], [0.01, 0.015]]) g.add(part(new THREE.BoxGeometry(0.007, 0.022, 0.007), fur, x, 0.011, z));
  g.add(part(new THREE.BoxGeometry(0.022, 0.02, 0.045), fur, 0, 0.03, 0));
  g.add(part(new THREE.SphereGeometry(0.017, 8, 6), mane, 0, 0.04, 0.025));
  g.add(part(new THREE.SphereGeometry(0.01, 8, 6), fur, 0, 0.04, 0.036));
  return g;
}
function zoo() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#7cc35f'), 0, 0.01, 0));
  // Yürüyüş yolları
  st.add(part(new THREE.BoxGeometry(0.12, 0.022, 0.98), mat('#e3cf9c'), 0, 0.012, 0));
  st.add(part(new THREE.BoxGeometry(0.98, 0.022, 0.1), mat('#e3cf9c'), 0, 0.012, 0.05));
  // Bölmeler: [merkez x, z, yarı genişlik, yarı derinlik, zemin rengi]
  const pens: [number, number, number, number, string][] = [[-0.27, -0.24, 0.2, 0.2, '#c9b46b'], [0.27, -0.24, 0.2, 0.2, '#8fc76a'], [-0.27, 0.32, 0.2, 0.14, '#d8c27e']];
  const wood = mat('#8d6e4c');
  for (const [cx, cz, w, d, ground] of pens) {
    st.add(part(new THREE.BoxGeometry(w * 2, 0.024, d * 2), mat(ground), cx, 0.013, cz));
    for (const s of [-1, 1]) {
      st.add(part(new THREE.BoxGeometry(w * 2, 0.03, 0.006), wood, cx, 0.03, cz + s * d));
      st.add(part(new THREE.BoxGeometry(0.006, 0.03, d * 2), wood, cx + s * w, 0.03, cz));
    }
  }
  // Fil bölmesinde gölet
  st.add(part(new THREE.CylinderGeometry(0.07, 0.07, 0.006, 18), mat('#4fb3e8'), 0.32, 0.027, -0.16));
  // Ağaçlar ve kayalar
  for (const [x, z] of [[-0.36, -0.36], [-0.15, -0.36], [0.4, -0.38], [0.38, 0.38], [0.15, 0.4], [-0.4, 0.42]] as [number, number][]) st.add(tree(PROPS.treeLarge, x, z, 3, x * 5, 0.75));
  st.add(part(new THREE.IcosahedronGeometry(0.04, 0), mat('#a1998d'), -0.2, 0.03, 0.38));
  // Giriş kapısı ve tabela
  for (const s of [-1, 1]) st.add(part(new THREE.BoxGeometry(0.025, 0.12, 0.025), wood, s * 0.08, 0.07, 0.46));
  st.add(part(new THREE.BoxGeometry(0.2, 0.04, 0.02), mat('#2e7d32'), 0, 0.14, 0.46));
  st.add(part(new THREE.BoxGeometry(0.14, 0.02, 0.022), mat('#fdd835'), 0, 0.14, 0.462));
  g.add(mergeStatic([st]));
  // Hayvanlar: her biri kendi bölmesinde küçük bir daire çizerek dolaşır
  const animals: { obj: THREE.Object3D; cx: number; cz: number; r: number; phase: number; speed: number }[] = [];
  const addAnimal = (make: () => THREE.Group, cx: number, cz: number, r: number, k: number) => {
    const holder = new THREE.Group();
    holder.add(mergeStatic([make()]));
    holder.scale.setScalar(1 / (3 * 0.96) * 2.4);
    g.add(holder);
    animals.push({ obj: holder, cx, cz, r, phase: k * 2.1, speed: 0.25 + (k % 3) * 0.08 });
  };
  addAnimal(giraffe, -0.27, -0.24, 0.1, 0);
  addAnimal(giraffe, -0.25, -0.2, 0.07, 1);
  addAnimal(elephant, 0.22, -0.28, 0.08, 2);
  addAnimal(lion, -0.27, 0.32, 0.08, 3);
  addAnimal(lion, -0.22, 0.3, 0.05, 4);
  g.userData.animals = animals;
  return g;
}

export function makeDecor(kind: DecorKind): THREE.Object3D {
  if (kind === 'zoo') return zoo();
  if (kind in HISTORIC) return HISTORIC[kind as keyof typeof HISTORIC]();
  if (kind === 'mosque') return mosque();
  if (kind === 'lighthouse') return lighthouse();
  if (kind === 'marina') return marina();
  if (kind === 'clocktower') return clockTower();
  if (kind === 'museum') return museum();
  if (kind === 'funfair') return funfair();
  if (kind === 'beach') return beach();
  if (kind === 'metro') return metro();
  if (kind === 'uni') return university();
  if (kind === 'airport') return airport();
  if (kind === 'busstop') return busStop();
  if (kind === 'parking') return parkingLot();
  if (kind === 'lake' || kind === 'biglake') return lake(kind === 'biglake');
  if (kind === 'hill') return hill();
  if (kind === 'volley') return volley();
  if (kind === 'casino') return casino();
  if (kind === 'observatory') return observatory();
  if (kind === 'station') return station();
  if (kind === 'wheel') return ferrisWheel();
  if (kind === 'fountain') return fountain();
  if (kind === 'statue') return statue();
  const g = new THREE.Group();
  g.add(pad());
  return g;
}

// Dönme dolap dönsün, kabinler hep düz dursun; atlıkarınca dönsün, hız treni rayda ilerlesin
const ahead = new THREE.Vector3();
export function animateDecor(obj: THREE.Object3D, dt: number) {
  // Fener huzmesi döner; fener yanınca (gece) görünür
  const beam = obj.userData.beam as THREE.Object3D | undefined;
  if (beam) {
    beam.rotation.y += dt * 0.9;
    beamMat.opacity = (LH.lamp.emissiveIntensity / 2) * 0.22;
    beam.visible = beamMat.opacity > 0.01;
  }
  // Hayvanat bahçesindeki hayvanlar bölmelerinde dolaşır
  const animals = obj.userData.animals as { obj: THREE.Object3D; cx: number; cz: number; r: number; phase: number; speed: number }[] | undefined;
  if (animals) {
    const t = (obj.userData.t = ((obj.userData.t as number | undefined) ?? 0) + dt);
    for (const a of animals) {
      const ang = t * a.speed + a.phase;
      a.obj.position.set(a.cx + Math.cos(ang) * a.r, Math.abs(Math.sin(t * 6 + a.phase)) * 0.002, a.cz + Math.sin(ang) * a.r * 0.7);
      a.obj.rotation.y = Math.atan2(-Math.sin(ang) * a.r, Math.cos(ang) * a.r * 0.7);
    }
  }
  // Yatlar dalgada sallanır
  const bob = obj.userData.bob as { obj: THREE.Object3D; phase: number }[] | undefined;
  if (bob) {
    const t = (obj.userData.t = ((obj.userData.t as number | undefined) ?? 0) + dt);
    for (const b of bob) {
      b.obj.position.y = SEA_Y / (2 * 0.96) - 0.012 + Math.sin(t * 1.3 + b.phase) * 0.004;
      b.obj.rotation.z = Math.sin(t * 1.1 + b.phase) * 0.03;
    }
  }
  const car = obj.userData.carousel as THREE.Object3D | undefined;
  if (car) car.rotation.y += dt * 0.8;
  // Serbest düşüş: koltuklar yavaşça yükselir, tepede bekler, birden düşer, aşağıda bekler
  const drop = obj.userData.drop as { obj: THREE.Object3D; t: number; y0: number; y1: number } | undefined;
  if (drop) {
    drop.t = (drop.t + dt) % 11;
    const t = drop.t;
    const f = t < 6 ? THREE.MathUtils.smoothstep(t, 0, 6) : t < 7.5 ? 1 : t < 8.1 ? 1 - ((t - 7.5) / 0.6) ** 2 : 0;
    drop.obj.position.y = drop.y0 + (drop.y1 - drop.y0) * f;
  }
  // Korsan gemisi ileri geri sallanır
  const swing = obj.userData.swing as { obj: THREE.Object3D; t: number } | undefined;
  if (swing) {
    swing.t += dt;
    swing.obj.rotation.z = Math.sin(swing.t * 1.15) * (0.55 + 0.3 * Math.sin(swing.t * 0.12));
  }
  // Çeşmenin tepesindeki su fışkırır
  const spray = obj.userData.spray as THREE.Object3D | undefined;
  if (spray) {
    const t = (obj.userData.t = ((obj.userData.t as number | undefined) ?? 0) + dt);
    spray.scale.y = 1 + Math.sin(t * 9) * 0.08 + Math.sin(t * 23) * 0.04;
  }
  const co = obj.userData.coaster as { curve: THREE.CatmullRomCurve3; cars: THREE.Object3D[]; t: number; gap?: number } | undefined;
  if (co) {
    // Aşağıdayken hızlı, yukarıdayken yavaş
    const h = co.curve.getPointAt(co.t % 1).y;
    co.t = (co.t + dt * (0.09 - h * 0.12)) % 1;
    co.cars.forEach((c, k) => {
      const u = (co.t - k * (co.gap ?? 0.022) + 1) % 1;
      c.position.copy(co.curve.getPointAt(u));
      co.curve.getPointAt((u + 0.004) % 1, ahead);
      c.lookAt(ahead.applyMatrix4(c.parent!.matrixWorld));
    });
  }
  const w = obj.userData.wheel as { wheel: THREE.Object3D; cabins: THREE.Object3D[] } | undefined;
  if (!w) return;
  w.wheel.rotation.z += dt * 0.25;
  for (const c of w.cabins) c.rotation.z = -w.wheel.rotation.z;
}
