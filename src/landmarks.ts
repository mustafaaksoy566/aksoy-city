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
import { station, busStop, metro, airport, university, beach, palm, RUNWAY, pMat } from './places';
import { KIT } from './towers';
import { signMat } from './signs';
import { zoo, type ZooWalker } from './zoo';
import { pm, M as PM, BULB, BULB_GEO, WATER, SPRAY, FLOWERS, PAINT, UP, type V3, add, box, cyl, rod, item, bench, lamp, flowerBed, planter } from './parts';

export { palm, RUNWAY };

// Simge yapılar. Dönme dolap, lunapark, müze, çeşme ve heykel fun.ts'te; tarihi yapılar historic.ts'te.
// Deniz feneri, yat limanı, cami ve saat kulesi gökdelenler gibi ayrıntılı çizilir; hayvanat bahçesi zoo.ts'te.
// Sabit parçalar birleştirilir (telefon yorulmasın); dönen huzme, sallanan yatlar ve yürüyen hayvanlar ayrı kalır.
// Yerel ölçü 1x1; n karelik yapılar n*0.96 kat büyütülür, içlerindeki bank, lamba, ağaç gibi eşyalar 1/n ile küçültülür.

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
// Otopark (1x1): asfalt, arka sırada üç park yeri (tekerlek takozları, biri engelli, birinde şarj direği),
// önü yola açık; kenarlarda bordür, köşelerde çalı, iki lamba, ödeme makinesi ve mavi "P" tabelası.
// Park eden arabaları trafik çizer (traffic.ts); park yerlerinin yeri değişmemeli (BAYS: x -0.3, 0, 0.3; arkası z -0.47).
const LOT = {
  asphalt: pm('#4f5560', 0.95),
  line: pm('#f4f4f2', 0.8),
  stop: pm('#c9c5bc', 0.9),
  curb: pm('#d9d6cf', 0.9),
  blue: pm('#1e6fd9', 0.8),
  charger: pm('#2e7d32', 0.6),
};
function parkingLot() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.034, 0.98, LOT.asphalt, 0, 0, 0);
  // Park yeri çizgileri, arka çizgi, tekerlek takozları
  for (const x of [-0.45, -0.15, 0.15, 0.45]) box(st, 0.014, 0.003, 0.44, LOT.line, x, 0.034, -0.25);
  box(st, 0.92, 0.003, 0.014, LOT.line, 0, 0.034, -0.47);
  for (const x of [-0.3, 0, 0.3]) box(st, 0.12, 0.014, 0.022, LOT.stop, x, 0.034, -0.42);
  // Sağdaki yer engelliler için (mavi zemin ve işaret), soldakinde elektrikli araç şarj direği
  box(st, 0.27, 0.002, 0.42, LOT.blue, 0.3, 0.034, -0.25);
  add(st, new THREE.CircleGeometry(0.035, 16).rotateX(-Math.PI / 2), LOT.line, 0.3, 0.037, -0.16);
  box(st, 0.034, 0.09, 0.024, LOT.charger, -0.3, 0.034, -0.465);
  box(st, 0.024, 0.02, 0.004, BULB, -0.3, 0.09, -0.452);
  // Koridorda yön oku
  box(st, 0.03, 0.003, 0.16, LOT.line, 0, 0.034, 0.2);
  for (const sx of [-1, 1]) {
    const ar = box(st, 0.03, 0.003, 0.09, LOT.line, sx * 0.025, 0.034, 0.12);
    ar.rotation.y = sx * 0.7;
  }
  // Bordürler (önü açık), köşelerde çalı
  box(st, 0.98, 0.05, 0.03, LOT.curb, 0, 0, -0.485);
  for (const sx of [-1, 1]) box(st, 0.03, 0.05, 0.98, LOT.curb, sx * 0.485, 0, 0);
  for (const sx of [-1, 1]) st.add(tree(PROPS.bush, sx * 0.47, -0.47, 1, sx, 0.45));
  // Lambalar, ödeme makinesi, P tabelası
  lamp(st, -0.475, -0.05, 1, 0.3);
  lamp(st, 0.475, -0.05, 1, 0.3);
  box(st, 0.05, 0.11, 0.035, PM.iron, -0.43, 0.034, 0.42);
  box(st, 0.034, 0.03, 0.004, windowMat, -0.43, 0.1, 0.438);
  cyl(st, 0.006, 0.008, 0.3, PM.steel, 0.43, 0.034, 0.3, 6);
  box(st, 0.11, 0.11, 0.01, pMat, 0.43, 0.29, 0.3);
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

// ======================= Ortak yardımcılar =======================
// Kesme taş dokusu: sıra sıra taş bloklar, her blok biraz farklı tonda. KIT.facadeBox / facadeCylinder ile
// gerçek ölçüde kaplanır (bir doku tekrarı 0.4 x 0.44), böylece her duvarda taşlar aynı büyüklükte görünür.
const ASHLAR = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#cdc2ad';
  x.fillRect(0, 0, 256, 256);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let row = 0; row < 16; row++) {
    const y = row * 16;
    const start = row % 2 ? 22 : 0;
    for (let bx = start; bx < start + 256; ) {
      let w = 34 + Math.floor(rnd() * 26);
      if (start + 256 - bx - w < 30) w = start + 256 - bx;
      const t = 230 + Math.floor(rnd() * 24);
      x.fillStyle = `rgb(${t},${t - 5},${t - 14})`;
      // Sağdan taşan blok soldan devam etsin (doku dikişsiz tekrarlansın)
      for (const ox of [0, -256]) x.fillRect(bx + ox + 1, y + 1, w - 2, 14);
      bx += w;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
})();
const stoneMat = (color: string) => new THREE.MeshStandardMaterial({ color, map: ASHLAR, roughness: 0.92 });
// Çekilmiş (Extrude) parçaların doku koordinatlarını taş dokusunun ölçüsüne getir
function stoneUV(geo: THREE.BufferGeometry) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 0.4, uv.getY(i) / 0.44);
  return geo;
}
// Kaya: köşeli, düz gölgeli
const ROCK = new THREE.MeshStandardMaterial({ color: '#8f8a80', roughness: 1, flatShading: true });
const ROCK_LIGHT = new THREE.MeshStandardMaterial({ color: '#b0a796', roughness: 1, flatShading: true });
// Saydam cam (fener odası, hayvan bölmesi camı, teras korkuluğu)
const GLASS = new THREE.MeshStandardMaterial({ color: '#d4eef8', transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.3, depthWrite: false });

function rock(g: THREE.Object3D, x: number, y: number, z: number, r: number, sx = 1, sy = 0.7, sz = 1, m: THREE.Material = ROCK) {
  const o = add(g, new THREE.IcosahedronGeometry(r, 0), m, x, y, z);
  o.scale.set(sx, sy, sz);
  o.rotation.set(Math.sin(x * 9) * 0.3, x * 7 + z * 13, Math.cos(z * 9) * 0.3);
  return o;
}
// İki nokta arasında incelen çubuk (r0 a ucunda, r1 b ucunda)
function taper(g: THREE.Object3D, a: V3, b: V3, r0: number, r1: number, m: THREE.Material, seg = 6) {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const o = add(g, new THREE.CylinderGeometry(r1, r0, d.length(), seg), m, A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
  return o;
}
// Sivri kemer biçimi: alt orta (x, y), w genişlik, h tepe yüksekliği
function archPath(p: THREE.Path, x: number, y: number, w: number, h: number) {
  const r = w / 2;
  const spring = y + h - w * 0.62;
  p.moveTo(x - r, y);
  p.lineTo(x + r, y);
  p.lineTo(x + r, spring);
  p.quadraticCurveTo(x + r, y + h - w * 0.12, x, y + h);
  p.quadraticCurveTo(x - r, y + h - w * 0.12, x - r, spring);
  p.closePath();
}
// Kemerli pencere / kapı / niş (yüzü +z, alt orta 0,0). Aynı ölçüler tek geometriyi paylaşır.
const archCache = new Map<string, THREE.BufferGeometry>();
function archGeo(w: number, h: number, depth = 0.004) {
  const key = `${w}|${h}|${depth}`;
  let geo = archCache.get(key);
  if (!geo) {
    const s = new THREE.Shape();
    archPath(s, 0, 0, w, h);
    geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 5 }).translate(0, 0, -depth / 2);
    archCache.set(key, geo);
  }
  return geo;
}
// Revak cephesi: n sivri kemerli açıklığı olan duvar (yüzü +z, alt orta 0,0). open: açıklığın bölmeye oranı
function arcadeGeo(w: number, h: number, n: number, depth: number, open = 0.74, rise = 0.78) {
  const s = new THREE.Shape();
  const bay = w / n, r = (bay * open) / 2, top = h * rise;
  s.moveTo(-w / 2, 0);
  for (let k = 0; k < n; k++) {
    const cx = -w / 2 + bay * (k + 0.5);
    s.lineTo(cx - r, 0);
    s.lineTo(cx - r, top - r * 1.24);
    s.quadraticCurveTo(cx - r, top - r * 0.24, cx, top);
    s.quadraticCurveTo(cx + r, top - r * 0.24, cx + r, top - r * 1.24);
    s.lineTo(cx + r, 0);
  }
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  s.lineTo(-w / 2, h);
  s.closePath();
  return stoneUV(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 5 }).translate(0, 0, -depth / 2));
}
// Yarım küre kubbe (tabanı y=0)
const dome = (r: number, seg = 20) => new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 2), 0, Math.PI * 2, 0, Math.PI / 2);
// Üçgen çatı kütlesi: w genişlik (x), d derinlik (z), h yükseklik; tabanı y=0'da
function gable(w: number, d: number, h: number) {
  const sh = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, h)]);
  return new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-w / 2, 0, 0);
}
// Beşik çatı: üçgen alınlık duvarı (wall) ve saçaklı iki eğik çatı plakası. Mahya x yönünde; y alt kenar.
function pitched(g: THREE.Object3D, w: number, d: number, h: number, roof: THREE.Material, wall: THREE.Material | null, x: number, y: number, z: number, over = 0.012) {
  if (wall) add(g, gable(w, d, h), wall, x, y, z);
  const ang = Math.atan2(h, d / 2);
  const run = d / 2 + over;
  const len = run / Math.cos(ang);
  for (const s of [-1, 1]) {
    const p = add(g, new THREE.BoxGeometry(w + over * 2, 0.007, len), roof, x, y + h - (run * Math.tan(ang)) / 2 + 0.0035, z + (s * run) / 2);
    p.rotation.x = s * ang;
  }
}
// Çit: iki nokta arasında direkler ve kirişler (h boy, step direk aralığı, y0 zemin)
function fenceLine(g: THREE.Object3D, a: [number, number], b: [number, number], h: number, step: number, post: THREE.Material, rail: THREE.Material, y0 = 0.03, rails = 2, pw = 0.007) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(len / step));
  for (let k = 0; k <= n; k++) box(g, pw, h, pw, post, a[0] + (dx * k) / n, y0, a[1] + (dz * k) / n);
  for (let r = 1; r <= rails; r++) {
    const m = box(g, len, 0.004, 0.004, rail, (a[0] + b[0]) / 2, y0 + (h * r) / (rails + 0.3) - 0.002, (a[1] + b[1]) / 2);
    m.rotation.y = -Math.atan2(dz, dx);
  }
}
// Ot öbeği: üç sivri yaprak
function tuft(g: THREE.Object3D, x: number, z: number, m: THREE.Material, h = 0.02, y = 0.03) {
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + x * 13;
    const c = add(g, new THREE.ConeGeometry(0.005, h * (0.8 + 0.2 * k), 4), m, x + Math.cos(a) * 0.006, y + h * 0.42, z + Math.sin(a) * 0.006);
    c.rotation.z = Math.cos(a) * 0.25;
  }
}
// Can simidi: turuncu-beyaz halka (yüzü +z)
const BUOY = pm('#f4511e', 0.6);
function lifebuoy(g: THREE.Object3D, x: number, y: number, z: number, rot = 0, r = 0.012) {
  const o = item(g, x, z, rot, 1, y);
  for (let k = 0; k < 4; k++) add(o, new THREE.TorusGeometry(r, r * 0.33, 4, 6, Math.PI / 2).rotateZ((k * Math.PI) / 2), k % 2 ? PM.white : BUOY, 0, 0, 0);
}
// Sabit tekne/şemsiye vb. için sözde rastgele sayı (her yapıda aynı)
const hash = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

// ======================= Saat kulesi (1x1) =======================
// Basamaklı kaide, kabartma taşlı giriş katı (kemerli kapı, yuvarlak pencereler), köşe ayaklı uzun taş gövde ve
// dar kemerli pencereler, dört yüzünde saat olan saat katı (kadranlar gece aydınlanır), korkuluklu korniş,
// kemerli çan katı ve içinde çan, köşe kuleleri, çatı pencereli yeşil bakır külah, altın küre ve rüzgârgülü.
// Çevresinde desenli meydan, çitli çiçek tarhları, ağaçlar, banklar, lambalar ve güvercinler.
const CT = {
  stone: stoneMat('#efdfbf'),
  rustic: stoneMat('#d2b98c'),
  trim: pm('#f3e9d3', 0.85),
  groove: pm('#a8916b', 0.9),
  dark: pm('#2b2f36', 0.6),
  wood: pm('#5b3a22', 0.8),
  copper: pm('#5e9e88', 0.55, 0.3),
  bell: pm('#c9a03a', 0.35, 0.7),
  pigeon: pm('#8d929b', 0.9),
  bin: pm('#2e5e3a', 0.7),
};
const DIAL = new THREE.MeshStandardMaterial({ color: '#fbf6e8', emissive: '#fff1c9', emissiveIntensity: 0, roughness: 0.5 });
DIAL.name = 'lamp'; // saat kadranları gece aydınlanır (DayNight)
const BELL_GEO = new THREE.LatheGeometry(
  [[0.001, 0.07], [0.016, 0.068], [0.022, 0.056], [0.025, 0.032], [0.031, 0.012], [0.04, 0.002], [0.039, 0]].map(([r, y]) => new THREE.Vector2(r, y)),
  16,
);
function clockTower() {
  const st = new THREE.Group();
  // --- Meydan ---
  box(st, 0.98, 0.03, 0.98, PM.paving, 0, 0, 0);
  cyl(st, 0.37, 0.37, 0.004, PM.terracotta, 0, 0.03, 0, 40);
  cyl(st, 0.34, 0.34, 0.005, PM.stone, 0, 0.03, 0, 40);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const r = box(st, 0.008, 0.001, 0.07, PM.terracotta, Math.sin(a) * 0.3, 0.035, Math.cos(a) * 0.3);
    r.rotation.y = a;
  }
  // Köşelerde çitle çevrili çiçek tarhları, arka köşelerde çiçekli ağaçlar
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = sx * 0.4, z = sz * 0.4;
    for (const s of [-1, 1]) {
      box(st, 0.17, 0.022, 0.016, PM.hedge, x, 0.03, z + s * 0.077);
      box(st, 0.016, 0.022, 0.14, PM.hedge, x + s * 0.077, 0.03, z);
    }
    flowerBed(st, x, z, 0.13, 0.13, sx + sz + 2);
    if (sz < 0) st.add(tree(PROPS.treeBlossom, x, z, 1, sx, 0.5));
    lamp(st, sx * 0.27, sz * 0.27);
  }
  // Banklar (kuleye dönük), çöp kutuları, güvercinler
  bench(st, 0.36, 0, -Math.PI / 2);
  bench(st, -0.36, 0, Math.PI / 2);
  bench(st, 0, -0.36, 0);
  for (const sx of [-1, 1]) bench(st, sx * 0.17, 0.37, Math.PI);
  for (const [x, z] of [[0.36, 0.08], [-0.36, -0.08], [0.08, -0.37]]) cyl(st, 0.01, 0.009, 0.03, CT.bin, x, 0.03, z, 8);
  for (const [x, z, r] of [[0.08, 0.3, 0.4], [0.11, 0.33, 2], [-0.07, 0.36, -1], [0.02, 0.42, 3], [-0.24, 0.12, 1.2]]) {
    const p = item(st, x, z, r, 1, 0.034);
    add(p, new THREE.SphereGeometry(0.007, 8, 6).scale(0.8, 0.75, 1.3), CT.pigeon, 0, 0.006, 0);
    add(p, new THREE.SphereGeometry(0.0045, 8, 6), CT.pigeon, 0, 0.012, 0.008);
  }

  // --- Kule ---
  for (let k = 0; k < 3; k++) box(st, 0.52 - k * 0.04, 0.015, 0.52 - k * 0.04, CT.trim, 0, 0.03 + k * 0.015, 0);
  const B0 = 0.075;
  // Giriş katı: kabartma taş (yatay oluklar), korniş
  st.add(part(KIT.facadeBox(0.38, 0.2, 0.38, B0), CT.rustic, 0, B0 + 0.1, 0));
  for (const y of [0.115, 0.155, 0.195, 0.235]) box(st, 0.384, 0.004, 0.384, CT.groove, 0, y, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const f = item(st, Math.sin(a) * 0.192, Math.cos(a) * 0.192, a, 1, 0);
    if (k === 0) {
      // Kemerli kapı: taş çerçeve, ahşap kanatlar, kilit taşı, iki yanda fener
      add(f, archGeo(0.13, 0.175, 0.008), CT.trim, 0, B0, 0.002);
      add(f, archGeo(0.09, 0.145, 0.008), CT.wood, 0, B0, 0.005);
      box(f, 0.003, 0.11, 0.003, CT.dark, 0, B0, 0.0095);
      box(f, 0.022, 0.032, 0.012, CT.trim, 0, B0 + 0.152, 0.006);
      for (const sx of [-1, 1]) {
        box(f, 0.006, 0.006, 0.016, PM.iron, sx * 0.085, B0 + 0.12, 0.008);
        add(f, new THREE.SphereGeometry(0.009, 8, 6), BULB, sx * 0.085, B0 + 0.112, 0.018);
      }
    } else {
      // Yuvarlak pencere (gece yanar) ve taş çerçevesi
      add(f, new THREE.TorusGeometry(0.03, 0.007, 6, 18), CT.trim, 0, B0 + 0.12, 0.004);
      add(f, new THREE.CircleGeometry(0.03, 18), windowMat, 0, B0 + 0.12, 0.004);
    }
  }
  box(st, 0.41, 0.018, 0.41, CT.trim, 0, 0.275, 0);
  box(st, 0.39, 0.012, 0.39, CT.trim, 0, 0.293, 0);
  // Gövde: kesme taş, köşe ayakları, kuşaklar, dar kemerli pencereler
  const S0 = 0.305, SH = 0.84;
  st.add(part(KIT.facadeBox(0.3, SH, 0.3, S0), CT.stone, 0, S0 + SH / 2, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(st, 0.046, SH, 0.046, CT.trim, sx * 0.142, S0, sz * 0.142);
  for (const y of [0.58, 0.86]) box(st, 0.31, 0.012, 0.31, CT.trim, 0, y, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const f = item(st, Math.sin(a) * 0.15, Math.cos(a) * 0.15, a, 1, 0);
    for (const y of [0.4, 0.66, 0.94]) {
      add(f, archGeo(0.05, 0.12, 0.006), CT.trim, 0, y - 0.01, 0.001);
      add(f, archGeo(0.034, 0.1, 0.006), windowMat, 0, y, 0.003);
      box(f, 0.056, 0.008, 0.014, CT.trim, 0, y - 0.014, 0.005);
    }
  }
  // Saat katı: dışa taşan taş blok, köşe ayakları, dört yüzde saat (taş çerçeve, gece yanan kadran, altın çember,
  // saat çizgileri, akrep ve yelkovan 10:10'u gösterir)
  const C0 = 1.145;
  box(st, 0.34, 0.016, 0.34, CT.trim, 0, C0, 0);
  st.add(part(KIT.facadeBox(0.32, 0.26, 0.32, C0 + 0.016), CT.stone, 0, C0 + 0.016 + 0.13, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(st, 0.05, 0.26, 0.05, CT.trim, sx * 0.16, C0 + 0.016, sz * 0.16);
  const CY = C0 + 0.016 + 0.13;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const f = item(st, Math.sin(a) * 0.16, Math.cos(a) * 0.16, a, 1, CY);
    add(f, new THREE.CylinderGeometry(0.115, 0.115, 0.01, 32).rotateX(Math.PI / 2), CT.trim, 0, 0, 0.003);
    add(f, new THREE.CylinderGeometry(0.1, 0.1, 0.006, 32).rotateX(Math.PI / 2), DIAL, 0, 0, 0.008);
    add(f, new THREE.TorusGeometry(0.1, 0.006, 6, 32), PM.gold, 0, 0, 0.011);
    for (let h = 0; h < 12; h++) {
      const ha = (h / 12) * Math.PI * 2;
      const big = h % 3 === 0;
      const m = add(f, new THREE.BoxGeometry(big ? 0.008 : 0.005, big ? 0.02 : 0.013, 0.002), CT.dark, Math.sin(ha) * 0.083, Math.cos(ha) * 0.083, 0.0115);
      m.rotation.z = -ha;
    }
    const hourH = add(f, new THREE.BoxGeometry(0.007, 0.05, 0.002).translate(0, 0.022, 0), CT.dark, 0, 0, 0.0125);
    hourH.rotation.z = -(10 / 12) * Math.PI * 2;
    const minH = add(f, new THREE.BoxGeometry(0.005, 0.078, 0.002).translate(0, 0.034, 0), CT.dark, 0, 0, 0.0135);
    minH.rotation.z = -(2 / 12) * Math.PI * 2;
    add(f, new THREE.SphereGeometry(0.007, 8, 6), PM.gold, 0, 0, 0.014);
    // Korniş altında diş sırası
    for (let j = -4; j <= 4; j++) box(f, 0.012, 0.01, 0.01, CT.trim, j * 0.034, 0.12, 0.004);
  }
  // Korniş ve taş korkuluk
  const BF0 = C0 + 0.016 + 0.26 + 0.022;
  box(st, 0.37, 0.022, 0.37, CT.trim, 0, BF0 - 0.022, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const f = item(st, Math.sin(a) * 0.172, Math.cos(a) * 0.172, a, 1, BF0);
    for (let j = -4; j <= 4; j++) cyl(f, 0.005, 0.006, 0.026, CT.trim, j * 0.038, 0, 0, 6);
    box(f, 0.35, 0.008, 0.014, CT.trim, 0, 0.026, 0);
  }
  // Çan katı: dört yanda iki kemerli açıklık, köşe ayakları, içinde kirişe asılı çan
  const BH = 0.2;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const f = item(st, Math.sin(a) * 0.125, Math.cos(a) * 0.125, a, 1, BF0);
    add(f, arcadeGeo(0.27, BH, 2, 0.03, 0.6, 0.8), CT.stone, 0, 0, 0);
    box(f, 0.27, 0.006, 0.012, CT.trim, 0, 0.045, 0.012);
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(st, 0.056, BH, 0.056, CT.trim, sx * 0.125, BF0, sz * 0.125);
  add(st, BELL_GEO, CT.bell, 0, BF0 + 0.07, 0);
  box(st, 0.25, 0.012, 0.012, CT.wood, 0, BF0 + 0.14, 0);
  box(st, 0.3, 0.01, 0.3, CT.trim, 0, BF0, 0);
  // Üst korniş, köşe kuleleri, çatı pencereli bakır külah, altın küre, rüzgârgülü
  const R0 = BF0 + BH;
  box(st, 0.31, 0.022, 0.31, CT.trim, 0, R0, 0);
  box(st, 0.29, 0.012, 0.29, CT.trim, 0, R0 + 0.022, 0);
  const R1 = R0 + 0.034;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    cyl(st, 0.016, 0.018, 0.04, CT.trim, sx * 0.135, R1, sz * 0.135, 8);
    add(st, new THREE.ConeGeometry(0.02, 0.07, 8), CT.copper, sx * 0.135, R1 + 0.075, sz * 0.135);
    add(st, new THREE.SphereGeometry(0.006, 8, 6), PM.gold, sx * 0.135, R1 + 0.112, sz * 0.135);
  }
  add(st, new THREE.ConeGeometry(0.19, 0.38, 4).rotateY(Math.PI / 4), CT.copper, 0, R1 + 0.19, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const f = item(st, Math.sin(a) * 0.1, Math.cos(a) * 0.1, a, 1, R1 + 0.05);
    box(f, 0.04, 0.04, 0.03, CT.trim, 0, 0, 0.012);
    box(f, 0.022, 0.026, 0.004, CT.dark, 0, 0.006, 0.028);
    add(f, new THREE.ConeGeometry(0.032, 0.03, 4).rotateY(Math.PI / 4), CT.copper, 0, 0.055, 0.012);
  }
  const top = R1 + 0.38;
  add(st, new THREE.SphereGeometry(0.016, 10, 8), PM.gold, 0, top + 0.004, 0);
  rod(st, [0, top, 0], [0, top + 0.1, 0], 0.0025, PM.gold, 5);
  box(st, 0.05, 0.004, 0.004, PM.iron, 0, top + 0.07, 0);
  box(st, 0.004, 0.004, 0.05, PM.iron, 0, top + 0.055, 0);
  add(st, new THREE.ConeGeometry(0.006, 0.014, 4).rotateZ(-Math.PI / 2), PM.iron, 0.029, top + 0.072, 0);
  box(st, 0.004, 0.014, 0.012, PM.iron, -0.024, top + 0.065, 0);
  return mergeStatic([st]);
}

// ======================= Deniz feneri =======================
const LH = {
  white: mat('#f6f5f1'),
  red: mat('#d63a32'),
  dark: mat('#37474f'),
  stone: mat('#9b958a'),
  roof: pm('#b4442c', 0.8),
  shutter: pm('#2f6fb3', 0.7),
  lamp: new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff2c0', emissiveIntensity: 0 }),
};
LH.lamp.name = 'lamp'; // gece yanar (DayNight)
const LANTERN_Y = 0.787; // kule içinde fener lambasının yüksekliği

// Deniz feneri kulesi: sekizgen taş kaide, kemerli kapılı giriş odası, yukarı doğru incelen kırmızı-beyaz kuşaklı gövde,
// beyaz çerçeveli küçük pencereler, konsollu seyir balkonu ve korkuluk, camlı fener odası (içinde gece yanan lamba),
// kırmızı kubbe, havalandırma topu, paratoner ve rüzgârgülü. Kapı +z'de; yerel ölçüde boyu ~0.97.
function towerBody() {
  const g = new THREE.Group();
  cyl(g, 0.168, 0.185, 0.05, LH.stone, 0, 0, 0, 8);
  cyl(g, 0.172, 0.172, 0.012, PM.rim, 0, 0.05, 0, 8);
  const Y0 = 0.062, Y1 = 0.7, R0 = 0.118, R1 = 0.074;
  const rAt = (y: number) => R0 + ((R1 - R0) * (y - Y0)) / (Y1 - Y0);
  for (let k = 0; k < 5; k++) {
    const a = Y0 + ((Y1 - Y0) * k) / 5, b = Y0 + ((Y1 - Y0) * (k + 1)) / 5;
    cyl(g, rAt(b), rAt(a), b - a, k % 2 ? LH.red : LH.white, 0, a, 0, 20);
  }
  // Giriş odası, kemerli kapı ve basamaklar
  box(g, 0.075, 0.095, 0.06, LH.white, 0, Y0, 0.1);
  box(g, 0.088, 0.012, 0.07, LH.red, 0, Y0 + 0.095, 0.103);
  add(g, archGeo(0.052, 0.082, 0.006), PM.rim, 0, Y0, 0.13);
  add(g, archGeo(0.04, 0.072, 0.006), LH.dark, 0, Y0, 0.132);
  box(g, 0.064, 0.034, 0.024, LH.stone, 0, 0, 0.197);
  box(g, 0.064, 0.017, 0.022, LH.stone, 0, 0, 0.219);
  // Merdiven pencereleri: gövde boyunca döner
  for (const [y, a] of [[0.2, 2.6], [0.32, 4.4], [0.44, 0.9], [0.56, 2.9]] as [number, number][]) {
    const r = rAt(y);
    const f = add(g, archGeo(0.03, 0.05, 0.006), LH.white, Math.sin(a) * (r - 0.001), y - 0.025, Math.cos(a) * (r - 0.001));
    f.rotation.y = a;
    const w = add(g, archGeo(0.019, 0.036, 0.006), LH.dark, Math.sin(a) * (r + 0.002), y - 0.018, Math.cos(a) * (r + 0.002));
    w.rotation.y = a;
  }
  // Seyir balkonu: konsollar, döşeme, iki sıra korkuluk
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const c = box(g, 0.01, 0.026, 0.034, LH.white, Math.sin(a) * 0.092, Y1 - 0.018, Math.cos(a) * 0.092);
    c.rotation.y = a;
  }
  cyl(g, 0.116, 0.1, 0.014, LH.dark, 0, Y1 + 0.008, 0, 20);
  const GY = Y1 + 0.022;
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    rod(g, [Math.sin(a) * 0.111, GY, Math.cos(a) * 0.111], [Math.sin(a) * 0.111, GY + 0.034, Math.cos(a) * 0.111], 0.0016, LH.dark, 4);
  }
  add(g, new THREE.TorusGeometry(0.111, 0.0026, 4, 28).rotateX(Math.PI / 2), LH.dark, 0, GY + 0.034, 0);
  add(g, new THREE.TorusGeometry(0.111, 0.0015, 4, 28).rotateX(Math.PI / 2), LH.dark, 0, GY + 0.017, 0);
  // Fener odası: kırmızı kasnak, cam oda, içinde lamba, koyu çerçeveler; üstte kubbe
  cyl(g, 0.074, 0.076, 0.03, LH.red, 0, GY, 0, 18);
  cyl(g, 0.078, 0.078, 0.005, LH.dark, 0, GY + 0.03, 0, 18);
  const LY = GY + 0.035;
  cyl(g, 0.03, 0.036, 0.05, LH.lamp, 0, LY + 0.006, 0, 12);
  cyl(g, 0.066, 0.066, 0.058, GLASS, 0, LY, 0, 18);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    rod(g, [Math.sin(a) * 0.067, LY, Math.cos(a) * 0.067], [Math.sin(a) * 0.067, LY + 0.058, Math.cos(a) * 0.067], 0.0018, LH.dark, 4);
  }
  add(g, new THREE.TorusGeometry(0.067, 0.0015, 4, 24).rotateX(Math.PI / 2), LH.dark, 0, LY + 0.029, 0);
  cyl(g, 0.076, 0.07, 0.008, LH.dark, 0, LY + 0.058, 0, 18);
  add(g, dome(0.07, 18), LH.red, 0, LY + 0.066, 0);
  add(g, new THREE.SphereGeometry(0.013, 10, 8), LH.dark, 0, LY + 0.14, 0);
  rod(g, [0, LY + 0.15, 0], [0, LY + 0.22, 0], 0.0016, LH.dark, 4);
  box(g, 0.04, 0.003, 0.003, LH.dark, 0, LY + 0.19, 0);
  add(g, new THREE.ConeGeometry(0.005, 0.012, 4).rotateZ(-Math.PI / 2), LH.dark, 0.022, LY + 0.1915, 0);
  box(g, 0.003, 0.012, 0.01, LH.dark, -0.02, LY + 0.186, 0);
  return g;
}
// Tek başına kule (terrain.ts şehrin dışındaki kumsala koyar): birleştirilmiş, taşınabilir grup
export function lighthouseTower() {
  return mergeStatic([towerBody()]);
}

// Işık huzmesi (gece, fener yanınca görünür)
const beamMat = new THREE.MeshBasicMaterial({
  color: '#fff6c8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
});

// Deniz feneri (1x1): kayalık burunda taş teras üstünde kule (kapısı bekçi evine bakar), çitle çevrili çimen bahçede
// kiremit çatılı bekçi evi (bacası, panjurları, saksıları, sundurması), bayrak direği, çapa, bank ve lamba;
// önde denize uzanan taş iskele, ucunda liman feneri, yanında bağlı sandal. Ön yüz (+z) denize bakar.
function lighthouse() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  const sea = SEA_Y / 0.96; // deniz seviyesi (yerel ölçü)
  box(st, 0.98, 0.02, 0.98, PM.sand, 0, 0, 0);
  box(st, 0.98, 0.006, 0.5, PM.lawn, 0, 0.02, -0.24);
  // Kayalık: kıyıda ve terasın çevresinde iri kayalar, çakıllar
  for (const [x, z, r, k] of [[0.38, 0.32, 0.07, 1.2], [0.24, 0.42, 0.06, 1], [0.43, 0.13, 0.055, 1], [0.05, 0.4, 0.05, 1.1], [-0.1, 0.33, 0.04, 1], [0.45, 0.45, 0.05, 1], [-0.06, 0.47, 0.045, 1.3], [0.4, -0.06, 0.04, 1], [0.14, 0.48, 0.04, 1]] as [number, number, number, number][]) {
    rock(st, x, r * 0.25, z, r, k, 0.7, 1, k > 1.1 ? ROCK_LIGHT : ROCK);
  }
  for (let k = 0; k < 10; k++) rock(st, -0.45 + hash(k) * 0.9, 0.02, 0.36 + hash(k + 20) * 0.12, 0.008 + hash(k + 40) * 0.008, 1, 0.6, 1, ROCK_LIGHT);
  // Taş teras ve korkuluk (bekçi evine bakan yerde açıklık ve basamak)
  const TX = 0.13, TZ = 0.11;
  const DOOR = Math.atan2(-0.4, -0.36);
  cyl(st, 0.24, 0.255, 0.03, LH.stone, TX, 0.02, TZ, 20);
  cyl(st, 0.245, 0.245, 0.006, PM.rim, TX, 0.05, TZ, 20);
  const near = (a: number) => Math.abs(Math.atan2(Math.sin(a - DOOR), Math.cos(a - DOOR))) < 0.22;
  const RR = 0.236;
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2, b = ((k + 1) / 28) * Math.PI * 2;
    if (near(a)) continue;
    rod(st, [TX + Math.sin(a) * RR, 0.056, TZ + Math.cos(a) * RR], [TX + Math.sin(a) * RR, 0.09, TZ + Math.cos(a) * RR], 0.0018, LH.white, 4);
    if (!near(b)) rod(st, [TX + Math.sin(a) * RR, 0.088, TZ + Math.cos(a) * RR], [TX + Math.sin(b) * RR, 0.088, TZ + Math.cos(b) * RR], 0.0018, LH.white, 4);
  }
  const step = item(st, TX + Math.sin(DOOR) * 0.262, TZ + Math.cos(DOOR) * 0.262, DOOR, 1, 0.026);
  box(step, 0.07, 0.016, 0.026, LH.stone, 0, 0, 0);
  const tower = towerBody();
  tower.position.set(TX, 0.056, TZ);
  tower.rotation.y = DOOR;
  st.add(tower);
  // Bahçe yolu (arkadan) ve bekçi evinden kuleye basamak taşları
  box(st, 0.06, 0.003, 0.4, PM.path, -0.08, 0.026, -0.29);
  for (let k = 0; k < 4; k++) {
    const t = k / 3;
    const s = box(st, 0.036, 0.004, 0.03, PM.rim, -0.27 + t * 0.16, 0.026, -0.128 + t * 0.02 + Math.sin(t * Math.PI) * 0.018);
    s.rotation.y = k * 0.5;
  }
  // Beyaz çit (arkada kapı açıklığı)
  const picket = (a: [number, number], b: [number, number]) => fenceLine(st, a, b, 0.04, 0.03, LH.white, LH.white, 0.026, 2, 0.006);
  picket([-0.475, -0.475], [-0.12, -0.475]);
  picket([-0.04, -0.475], [0.475, -0.475]);
  picket([-0.475, -0.475], [-0.475, 0.0]);
  picket([0.475, -0.475], [0.475, -0.12]);
  // Bekçi evi: taş temel, beyaz duvar, kiremit beşik çatı, baca, kapı, panjurlu pencereler, saksılar, sundurma
  const hx = -0.27, hz = -0.25;
  box(st, 0.272, 0.016, 0.182, LH.stone, hx, 0.026, hz);
  box(st, 0.26, 0.09, 0.17, LH.white, hx, 0.042, hz);
  pitched(st, 0.26, 0.17, 0.07, LH.roof, LH.white, hx, 0.132, hz);
  box(st, 0.028, 0.08, 0.028, LH.stone, hx - 0.07, 0.15, hz - 0.03);
  box(st, 0.034, 0.008, 0.034, LH.dark, hx - 0.07, 0.23, hz - 0.03);
  const fz = hz + 0.086;
  box(st, 0.048, 0.072, 0.004, LH.white, hx, 0.042, fz);
  box(st, 0.038, 0.066, 0.006, PM.darkWood, hx, 0.042, fz);
  add(st, new THREE.SphereGeometry(0.003, 6, 4), PM.gold, hx + 0.012, 0.075, fz + 0.004);
  const bloom = new THREE.SphereGeometry(0.005, 6, 4);
  for (const dx of [-0.08, 0.08]) {
    box(st, 0.042, 0.04, 0.004, LH.white, hx + dx, 0.067, fz);
    box(st, 0.034, 0.032, 0.006, windowMat, hx + dx, 0.071, fz);
    for (const sx of [-1, 1]) box(st, 0.012, 0.038, 0.004, LH.shutter, hx + dx + sx * 0.029, 0.068, fz + 0.002);
    box(st, 0.04, 0.01, 0.012, PM.terracotta, hx + dx, 0.058, fz + 0.006);
    for (let k = 0; k < 3; k++) add(st, bloom, FLOWERS[(k + (dx > 0 ? 2 : 0)) % FLOWERS.length], hx + dx - 0.012 + k * 0.012, 0.071, fz + 0.007);
  }
  for (const sx of [-1, 1]) {
    box(st, 0.004, 0.032, 0.034, windowMat, hx + sx * 0.131, 0.071, hz);
    box(st, 0.004, 0.04, 0.042, LH.white, hx + sx * 0.1305, 0.067, hz);
  }
  const porch = box(st, 0.08, 0.005, 0.045, LH.roof, hx, 0.113, fz + 0.02);
  porch.rotation.x = 0.3;
  for (const sx of [-1, 1]) rod(st, [hx + sx * 0.035, 0.026, fz + 0.04], [hx + sx * 0.035, 0.11, fz + 0.04], 0.0025, LH.white, 4);
  for (const sx of [-1, 1]) flowerBed(st, hx + sx * 0.085, fz + 0.016, 0.07, 0.02, sx + 2, 0.026);
  // Bayrak direği, çapa, bank, lamba
  rod(st, [-0.42, 0.026, -0.42], [-0.42, 0.34, -0.42], 0.003, LH.white, 6);
  box(st, 0.002, 0.045, 0.07, LH.red, -0.42, 0.29, -0.385);
  for (const sx of [-1, 1]) add(st, new THREE.CircleGeometry(0.009, 12).rotateY((sx * Math.PI) / 2), LH.white, -0.42 + sx * 0.0035, 0.3125, -0.395); // bezden belirgin uzakta (yapışık daire titreşiyordu)
  const ax = -0.44, az = -0.11;
  box(st, 0.06, 0.008, 0.04, LH.stone, ax, 0.026, az);
  rod(st, [ax, 0.034, az], [ax, 0.09, az], 0.004, LH.dark, 6);
  add(st, new THREE.TorusGeometry(0.008, 0.002, 4, 10), LH.dark, ax, 0.095, az);
  add(st, new THREE.TorusGeometry(0.022, 0.0035, 4, 12, Math.PI), LH.dark, ax, 0.056, az).rotation.z = Math.PI;
  box(st, 0.03, 0.004, 0.004, LH.dark, ax, 0.077, az);
  bench(st, -0.33, -0.03, 0);
  lamp(st, -0.04, -0.13);
  // Taş iskele: denize uzanır; babalar, can simidi, ucunda yeşil liman feneri; yanında bağlı sandal
  const jx = -0.3;
  box(st, 0.075, 0.177, 0.42, LH.stone, jx, sea - 0.02, 0.43);
  const jt = sea + 0.157 + 0.004; // iskele üstü
  box(st, 0.07, 0.004, 0.42, PM.paving, jx, jt - 0.004, 0.43);
  for (const z of [0.5, 0.6]) for (const sx of [-1, 1]) cyl(st, 0.006, 0.007, 0.014, LH.dark, jx + sx * 0.026, jt, z, 8);
  rod(st, [jx, jt, 0.625], [jx, jt + 0.08, 0.625], 0.004, pm('#2e7d32', 0.6), 6);
  cyl(st, 0.008, 0.008, 0.012, pm('#2e7d32', 0.6), jx, jt + 0.08, 0.625, 8);
  add(st, new THREE.SphereGeometry(0.008, 8, 6), BULB, jx, jt + 0.097, 0.625);
  lifebuoy(st, jx + 0.04, 0.05, 0.25, 0);
  rod(st, [jx + 0.04, 0.02, 0.245], [jx + 0.04, 0.06, 0.245], 0.002, LH.white, 4);
  const rb = item(st, jx - 0.062, 0.54, -Math.PI / 2, 1, sea - 0.007);
  add(rb, hullGeo(0.11, 0.042, 0.022, 0, 0.45), PM.blue, 0, 0, 0);
  add(rb, hullGeo(0.11, 0.042, 0.022, 0.45, 1), LH.white, 0, 0, 0);
  for (const x of [-0.02, 0.018]) box(rb, 0.01, 0.003, 0.034, PM.wood, x, 0.014, 0);
  for (const sz of [-1, 1]) rod(rb, [-0.03, 0.019, sz * 0.006], [0.035, 0.017, sz * 0.012], 0.0013, PM.wood, 4);
  rod(st, [jx - 0.062, sea + 0.016, 0.59], [jx - 0.026, jt + 0.01, 0.6], 0.0007, PM.white, 3);
  g.add(mergeStatic([st]));
  // Dönen ışık huzmesi (fener lambasının hizasında)
  const beam = new THREE.Group();
  beam.position.set(TX, 0.056 + LANTERN_Y, TZ);
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

// ======================= Yat limanı (2x2) =======================
export const YT = {
  white: pm('#fbfbf9', 0.35),
  teak: pm('#b98a56', 0.8),
  teakDark: pm('#8a6238', 0.8),
  glass: pm('#2d3a46', 0.25, 0.3),
  chrome: pm('#d9dee3', 0.3, 0.7),
  anti: pm('#26324a', 0.7),
  cream: pm('#efe6d0', 0.8),
  tube: pm('#5f6872', 0.7),
  pile: pm('#5a4a3a', 0.9),
  green: pm('#43a047', 0.6),
};
// Tekne gövdesi yukarıdan: kıçta küt (ayna), başa doğru sivrilir. u: 0 kıç, 1 baş
const beamAt = (u: number) => (u > 0.45 ? 1 - ((u - 0.45) / 0.55) ** 2 : 1 - (0.45 - u) * 0.22);
// Gövde: altı V biçimli, baş tarafı yükselir. L boy (x, baş +x), B en, D derinlik; t0..t1 alttan üste dilim (boya şeritleri)
export function hullGeo(L: number, B: number, D: number, t0 = 0, t1 = 1) {
  const geo = new THREE.BoxGeometry(L, 1, B, 12, 2, 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < p.count; k++) {
    const u = p.getX(k) / L + 0.5;
    const t = t0 + (p.getY(k) + 0.5) * (t1 - t0);
    const bow = Math.max(0, u - 0.55) / 0.45;
    p.setXYZ(k, p.getX(k), t * D + bow * bow * D * (0.15 + 0.55 * (1 - t)), p.getZ(k) * beamAt(u) * (0.25 + 0.75 * Math.sqrt(t)));
  }
  geo.computeVertexNormals();
  return geo;
}
// Güverte kaplaması (gövde biçiminde ince plaka, y=0 alt yüz)
export function deckGeo(L: number, B: number, h: number) {
  const s = new THREE.Shape();
  const n = 12;
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    if (k) s.lineTo((u - 0.5) * L, (B / 2) * beamAt(u));
    else s.moveTo((u - 0.5) * L, (B / 2) * beamAt(u));
  }
  for (let k = n - 1; k >= 0; k--) {
    const u = k / n;
    s.lineTo((u - 0.5) * L, (-B / 2) * beamAt(u));
  }
  return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2);
}
// Boyalı gövde: su altı boyası, renkli su hattı şeridi, beyaz borda ve tik güverte
export function hull(b: THREE.Object3D, L: number, B: number, D: number, stripe: THREE.Material, top: THREE.Material = YT.white) {
  add(b, hullGeo(L, B, D, 0, 0.36), YT.anti, 0, 0, 0);
  add(b, hullGeo(L, B, D, 0.36, 0.52), stripe, 0, 0, 0);
  add(b, hullGeo(L, B, D, 0.52, 1), top, 0, 0, 0);
  add(b, deckGeo(L * 0.94, B * 0.86, 0.002), YT.teak, -L * 0.01, D, 0);
}
// Kıç bayrağı
function sternFlag(b: THREE.Object3D, L: number, D: number) {
  rod(b, [-L * 0.49, D, 0], [-L * 0.54, D + 0.032, 0], 0.0008, YT.chrome, 3);
  box(b, 0.014, 0.009, 0.001, PM.red, -L * 0.54 - 0.007, D + 0.022, 0);
}
// Yelkenli: kamara tavanı ve camları, kokpit ve dümen, direk, bumba üstünde kılıflı ana yelken, sarılı flok,
// çarmıhlar, gurcatalar, can halatları ve kıç bayrağı. Baş +x.
export function sailboat(stripe: string, L = 0.2, cover = '#1e5aa8') {
  const b = new THREE.Group();
  const B = L * 0.32, D = L * 0.16;
  hull(b, L, B, D, pm(stripe, 0.5));
  box(b, L * 0.3, 0.012, B * 0.56, YT.white, -L * 0.02, D, 0);
  box(b, L * 0.22, 0.005, B * 0.57, YT.glass, -L * 0.02, D + 0.004, 0);
  box(b, L * 0.18, 0.004, B * 0.36, YT.white, -L * 0.02, D + 0.012, 0);
  box(b, L * 0.2, 0.003, B * 0.62, YT.teakDark, -L * 0.3, D + 0.001, 0);
  add(b, new THREE.TorusGeometry(0.007, 0.0012, 4, 12).rotateY(Math.PI / 2), YT.chrome, -L * 0.38, D + 0.012, 0);
  const mx = L * 0.1, top = D + L * 1.3;
  rod(b, [mx, D, 0], [mx, top, 0], 0.0022, YT.chrome, 5);
  rod(b, [mx, D + 0.022, 0], [-L * 0.32, D + 0.024, 0], 0.0018, YT.chrome, 4);
  add(b, new THREE.CapsuleGeometry(0.0048, L * 0.34, 3, 6).rotateZ(Math.PI / 2), pm(cover, 0.7), -L * 0.12, D + 0.03, 0);
  const bow: V3 = [L * 0.5, D * 1.15, 0];
  const head: V3 = [mx, top - 0.01, 0];
  rod(b, head, bow, 0.0007, YT.chrome, 3);
  const jibTop: V3 = [bow[0] + (head[0] - bow[0]) * 0.72, bow[1] + (head[1] - bow[1]) * 0.72, 0];
  taper(b, [bow[0] - 0.004, bow[1] + 0.006, 0], jibTop, 0.0034, 0.0012, YT.white, 5);
  for (const z of [-1, 1]) rod(b, head, [mx - 0.004, D + 0.002, z * B * 0.46], 0.0005, YT.chrome, 3);
  rod(b, [mx, D + L * 0.7, -B * 0.32], [mx, D + L * 0.7, B * 0.32], 0.001, YT.chrome, 3);
  for (const z of [-1, 1]) rod(b, [-L * 0.47, D + 0.012, z * B * 0.4], [L * 0.38, D + 0.014, z * B * 0.24], 0.0006, YT.chrome, 3);
  sternFlag(b, L, D);
  return b;
}
// Motorlu yat: yüzme platformu, boydan boya camlı (gece yanan) ana kamara, eğik ön cam, flybridge ve koltuklar,
// direklerde sert tente, radar ve anten, başta güneşlenme minderi ve korkuluk. big: bir kat daha. Baş +x.
export function motorYacht(stripe: string, L = 0.22, big = false) {
  const b = new THREE.Group();
  const B = L * 0.31, D = L * 0.2;
  hull(b, L, B, D, pm(stripe, 0.5), big ? pm('#1f2b44', 0.4) : YT.white);
  box(b, L * 0.07, 0.003, B * 0.8, YT.teak, -L * 0.53, D * 0.45, 0);
  const x0 = -L * 0.3, x1 = L * 0.18;
  box(b, x1 - x0, 0.024, B * 0.8, YT.white, (x0 + x1) / 2, D, 0);
  box(b, (x1 - x0) * 0.86, 0.009, B * 0.81, windowMat, (x0 + x1) / 2, D + 0.009, 0);
  box(b, 0.012, 0.012, B * 0.74, YT.white, x1 + 0.006, D, 0);
  const ws = add(b, new THREE.BoxGeometry(0.03, 0.002, B * 0.74), YT.glass, x1 + 0.011, D + 0.012, 0);
  ws.rotation.z = -0.7;
  let y = D + 0.024;
  if (big) {
    box(b, L * 0.36, 0.018, B * 0.74, YT.white, -L * 0.1, y, 0);
    box(b, L * 0.3, 0.008, B * 0.75, windowMat, -L * 0.1, y + 0.006, 0);
    y += 0.018;
  }
  box(b, L * 0.3, 0.008, B * 0.72, YT.white, -L * 0.1, y, 0);
  box(b, L * 0.06, 0.008, B * 0.3, YT.cream, -L * 0.04, y + 0.008, 0);
  box(b, 0.012, 0.01, B * 0.24, YT.glass, 0, y + 0.008, 0);
  for (const x of [-L * 0.22, L * 0.02]) for (const z of [-1, 1]) rod(b, [x, y + 0.008, z * B * 0.3], [x, y + 0.032, z * B * 0.3], 0.0009, YT.chrome, 3);
  box(b, L * 0.3, 0.003, B * 0.7, YT.white, -L * 0.1, y + 0.032, 0);
  cyl(b, 0.008, 0.008, 0.006, YT.white, -L * 0.12, y + 0.035, 0, 10);
  rod(b, [-L * 0.2, y + 0.035, 0], [-L * 0.2, y + 0.055, 0], 0.0008, YT.chrome, 3);
  box(b, L * 0.14, 0.004, B * 0.5, YT.cream, L * 0.3, D + 0.002, 0);
  for (const z of [-1, 1]) rod(b, [L * 0.2, D + 0.012, z * B * 0.36], [L * 0.47, D + 0.02, z * 0.004], 0.0007, YT.chrome, 3);
  sternFlag(b, L, D);
  return b;
}
// Bot (şişme): gri yan tüpler, küçük konsol, kıçta motor. Su hattı yüksekte kalsın diye gövde biraz yukarıda.
function rib() {
  const b = new THREE.Group();
  const o = item(b, 0, 0, 0, 1, 0.006);
  const L = 0.09;
  add(o, hullGeo(L, 0.03, 0.012), YT.white, 0, 0, 0);
  for (const z of [-1, 1]) {
    const t = add(o, new THREE.CapsuleGeometry(0.0055, L * 0.72, 3, 8).rotateZ(Math.PI / 2), YT.tube, -L * 0.04, 0.012, z * 0.0135);
    t.rotation.y = z * 0.08;
  }
  box(o, 0.012, 0.012, 0.012, YT.white, 0.004, 0.01, 0);
  box(o, 0.012, 0.004, 0.012, YT.glass, 0.008, 0.022, 0);
  box(o, 0.01, 0.022, 0.01, PM.iron, -L * 0.52, 0.004, 0);
  return b;
}
function marina() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  const s = 1 / (2 * 0.96);
  const water = SEA_Y / (2 * 0.96);
  // Zemin: taş döşeli rıhtım, desen şeritleri, ahşap gezinti yolu, granit bordür ve denize inen rıhtım duvarı
  box(st, 0.98, 0.03, 0.955, PM.paving, 0, 0, -0.0125);
  for (const z of [-0.08, 0.28]) box(st, 0.98, 0.002, 0.012, PM.terracotta, 0, 0.03, z);
  box(st, 0.98, 0.004, 0.09, PM.wood, 0, 0.03, 0.4);
  for (let k = 0; k < 28; k++) box(st, 0.002, 0.002, 0.09, PM.darkWood, -0.47 + k * 0.035, 0.034, 0.4);
  box(st, 0.98, 0.008, 0.03, PM.granite, 0, 0.03, 0.46);
  box(st, 0.98, 0.03 - (water - 0.03), 0.02, PM.rim, 0, water - 0.03, 0.475);

  // Liman ofisi ve kafe: camlı giriş katı, üstte bantlı pencereli ofis katı, çatı terası, gözetleme odası ve direk
  const bx = -0.24, bz = -0.3;
  st.add(part(KIT.facadeBox(0.4, 0.085, 0.2, 0.03), KIT.GLASS[4], bx, 0.03 + 0.0425, bz));
  box(st, 0.42, 0.01, 0.22, PM.white, bx, 0.115, bz);
  st.add(part(KIT.facadeBox(0.26, 0.075, 0.18, 0.125), KIT.BAND[0], bx - 0.07, 0.125 + 0.0375, bz));
  box(st, 0.28, 0.01, 0.2, PM.white, bx - 0.07, 0.2, bz);
  for (const side of [-1, 1]) box(st, 0.16, 0.035, 0.004, signMat('MARİNA', '#0d47a1'), bx - 0.07, 0.145, bz + side * 0.0915);
  // Çatı terası: cam korkuluk, şemsiyeli masa
  box(st, 0.135, 0.022, 0.003, GLASS, bx + 0.13, 0.125, bz + 0.108);
  box(st, 0.003, 0.022, 0.215, GLASS, bx + 0.198, 0.125, bz);
  {
    const t = item(st, bx + 0.12, bz + 0.02, 0, s, 0.125);
    cyl(t, 0.03, 0.03, 0.006, PM.white, 0, 0.03, 0, 10);
    rod(t, [0, 0, 0], [0, 0.11, 0], 0.003, PM.iron, 4);
    for (let k = 0; k < 8; k++) add(t, new THREE.ConeGeometry(0.07, 0.03, 2, 1, true, (k * Math.PI) / 4, Math.PI / 4), k % 2 ? PM.white : PM.navy, 0, 0.115, 0);
  }
  // Gözetleme odası ve sinyal direği (radar, sinyal bayrakları)
  st.add(part(KIT.facadeBox(0.1, 0.06, 0.1, 0.21), KIT.GLASS[1], bx - 0.15, 0.21 + 0.03, bz - 0.02));
  box(st, 0.13, 0.008, 0.13, PM.navy, bx - 0.15, 0.27, bz - 0.02);
  const mx = bx - 0.15, mz = bz - 0.02;
  rod(st, [mx, 0.278, mz], [mx, 0.42, mz], 0.0025, PM.white, 6);
  rod(st, [mx - 0.035, 0.38, mz], [mx + 0.035, 0.38, mz], 0.0015, PM.white, 4);
  box(st, 0.05, 0.004, 0.008, PM.white, mx, 0.335, mz);
  for (let k = 0; k < 9; k++) {
    const t = k / 9;
    const p: V3 = [mx + t * 0.2, 0.41 - t * 0.19 - Math.sin(t * Math.PI) * 0.02, mz + t * 0.11];
    box(st, 0.012, 0.012, 0.0015, PAINT[k % PAINT.length], p[0], p[1] - 0.012, p[2]);
  }
  rod(st, [mx, 0.41, mz], [mx + 0.2, 0.22, mz + 0.11], 0.0006, PM.iron, 3);
  // Kafe: çizgili tente, tabela; ahşap terasta şemsiyeli masalar ve sandalyeler, saksılar
  for (let k = 0; k < 6; k++) {
    const a = box(st, 0.066, 0.004, 0.05, k % 2 ? PM.white : PM.navy, bx - 0.165 + k * 0.066, 0.1, bz + 0.124);
    a.rotation.x = 0.3;
  }
  box(st, 0.11, 0.026, 0.004, signMat('KAFE', '#00838f'), bx + 0.13, 0.072, bz + 0.102);
  box(st, 0.36, 0.006, 0.22, PM.wood, 0.17, 0.03, -0.28);
  for (let k = 0; k < 6; k++) {
    const x = 0.05 + (k % 3) * 0.12, z = -0.34 + Math.floor(k / 3) * 0.12;
    const t = item(st, x, z, k * 0.7, s, 0.036);
    cyl(t, 0.026, 0.026, 0.005, PM.white, 0, 0.035, 0, 10);
    rod(t, [0, 0, 0], [0, 0.035, 0], 0.003, PM.iron, 4);
    for (const sx of [-1, 1]) {
      box(t, 0.02, 0.004, 0.02, PM.wood, sx * 0.04, 0.02, 0);
      box(t, 0.004, 0.022, 0.02, PM.wood, sx * 0.05, 0.02, 0);
    }
    rod(t, [0, 0.04, 0], [0, 0.12, 0], 0.0025, PM.white, 4);
    const c = PAINT[[0, 1, 5, 6, 3, 7][k]];
    for (let j = 0; j < 8; j++) add(t, new THREE.ConeGeometry(0.065, 0.028, 2, 1, true, (j * Math.PI) / 4, Math.PI / 4), j % 2 ? PM.white : c, 0, 0.13, 0);
  }
  for (const x of [0.0, 0.34]) planter(st, x, -0.155, 0.022, x > 0 ? 3 : 1);
  // Bayrak direkleri (yol tarafında)
  for (let k = 0; k < 4; k++) {
    const x = 0.12 + k * 0.08;
    rod(st, [x, 0.03, -0.455], [x, 0.24, -0.455], 0.003, PM.white, 6);
    add(st, new THREE.SphereGeometry(0.005, 6, 4), PM.gold, x, 0.243, -0.455);
    box(st, 0.05, 0.03, 0.002, PAINT[[0, 1, 2, 4][k]], x + 0.026, 0.2, -0.455);
  }
  // Palmiyeler (biri yuvarlak saksıda), banklar, lambalar, can simitleri
  st.add(palm(-0.46, 0.0, 0.2, 0.1));
  st.add(palm(0.46, -0.1, 0.19, -0.12));
  cyl(st, 0.045, 0.045, 0.02, PM.rim, -0.06, 0.03, 0.12, 16);
  cyl(st, 0.04, 0.04, 0.004, PM.soil, -0.06, 0.05, 0.12, 16);
  const pp = palm(-0.06, 0.12, 0.22, 0.06);
  pp.position.y = 0.05;
  st.add(pp);
  for (const x of [-0.42, -0.16, 0.12]) bench(st, x, 0.32, 0, s);
  for (const x of [-0.45, -0.15, 0.15]) lamp(st, x, 0.43, s);
  for (const x of [-0.36, 0.36]) {
    rod(st, [x, 0.038, 0.452], [x, 0.09, 0.452], 0.002, PM.white, 4);
    lifebuoy(st, x, 0.075, 0.455, 0);
  }
  // Kara bakımı: sehpada duran tekne ve rıhtım kenarında tekne vinci
  {
    const cx = 0.3, cz = 0.12;
    for (const x of [-0.05, 0.05]) {
      box(st, 0.012, 0.012, 0.07, PM.blue, cx + x, 0.03, cz);
      for (const z of [-0.026, 0.026]) rod(st, [cx + x, 0.04, cz + z], [cx + x, 0.07, cz + z * 0.6], 0.003, PM.blue, 4);
    }
    const boat = motorYacht('#ef6c00', 0.16);
    boat.position.set(cx, 0.06, cz);
    st.add(boat);
    rod(st, [cx - 0.03, 0.03, cz + 0.05], [cx - 0.03, 0.1, cz + 0.022], 0.0015, PM.gray, 4);
  }
  {
    const kx = 0.44, kz = 0.36;
    cyl(st, 0.02, 0.024, 0.012, PM.rim, kx, 0.034, kz, 10);
    rod(st, [kx, 0.046, kz], [kx, 0.2, kz], 0.006, PM.yellow, 8);
    rod(st, [kx, 0.2, kz - 0.02], [kx, 0.2, kz + 0.2], 0.0045, PM.yellow, 6);
    rod(st, [kx, 0.14, kz], [kx, 0.2, kz + 0.08], 0.003, PM.yellow, 4);
    box(st, 0.016, 0.014, 0.022, PM.iron, kx, 0.188, kz + 0.17);
    rod(st, [kx, 0.188, kz + 0.17], [kx, 0.09, kz + 0.17], 0.0007, PM.iron, 3);
    box(st, 0.008, 0.01, 0.004, PM.iron, kx, 0.08, kz + 0.17);
  }

  // Yüzer iskeleler: rıhtımdan inen rampalar, tik kaplama, kenar kirişleri, kazıklar, babalar,
  // elektrik-su dolapları, uçlarda lamba ve can simidi
  const DY = -0.004;
  const z0 = 0.53, z1 = 0.99;
  const deck = item(st, 0, 0, 0, 1, DY - 0.03);
  for (const px of [-0.3, 0, 0.3]) {
    const len = z1 - z0, zc = (z0 + z1) / 2;
    box(st, 0.05, 0.01, len, PM.wood, px, DY - 0.01, zc);
    for (const sx of [-1, 1]) box(st, 0.006, 0.016, len - 0.006, PM.darkWood, px + sx * 0.026, DY - 0.018, zc); // kirişler tahtalardan kısa (uç yüzleri titreşmesin)
    for (let k = 0; k < 13; k++) box(st, 0.05, 0.0015, 0.002, PM.darkWood, px, DY, z0 + 0.02 + k * 0.036);
    for (const z of [0.6, 0.79, 0.97]) {
      for (const sx of [-1, 1]) {
        cyl(st, 0.007, 0.007, DY + 0.03 - (water - 0.04), YT.pile, px + sx * 0.032, water - 0.04, z, 6);
        cyl(st, 0.0075, 0.007, 0.004, PM.white, px + sx * 0.032, DY + 0.03, z, 6);
      }
    }
    for (const z of [0.56, 0.75, 0.9]) for (const sx of [-1, 1]) box(st, 0.004, 0.004, 0.014, PM.iron, px + sx * 0.02, DY, z);
    for (const z of [0.68, 0.86]) {
      box(st, 0.012, 0.028, 0.012, PM.white, px, DY, z);
      box(st, 0.013, 0.004, 0.013, YT.green, px, DY + 0.028, z);
      add(st, BULB_GEO, BULB, px, DY + 0.036, z);
    }
    // Uçta lamba ve can simidi (orta iskelede yakıt tentesinin önünde)
    const ez = px === 0 ? 0.92 : 0.975;
    lamp(deck, px + 0.018, ez, s);
    rod(st, [px - 0.018, DY, ez], [px - 0.018, DY + 0.05, ez], 0.002, PM.white, 4);
    lifebuoy(st, px - 0.018, DY + 0.04, ez + 0.005, 0);
    // Rampa ve tutamaklar
    const rl = Math.hypot(z0 - 0.465, 0.038 - DY);
    const r = add(st, new THREE.BoxGeometry(0.04, 0.004, rl), PM.gray, px, (0.038 + DY) / 2, (z0 + 0.465) / 2);
    r.rotation.x = Math.atan2(0.038 - DY, z0 - 0.465);
    for (const sx of [-1, 1]) rod(st, [px + sx * 0.02, 0.07, 0.465], [px + sx * 0.02, DY + 0.03, z0], 0.0012, PM.steel, 3);
  }
  // Yakıt iskelesi: orta iskelenin ucunda T biçimli iskele, pompalar, tente ve YAKIT tabelası
  box(st, 0.26, 0.01, 0.05, PM.wood, 0, DY - 0.01, 0.995);
  for (const sx of [-1, 1]) box(st, 0.254, 0.016, 0.006, PM.darkWood, 0, DY - 0.018, 0.995 + sx * 0.026);
  for (const x of [-0.05, 0.05]) {
    const p = item(st, x, 0.99, 0, s, DY);
    box(p, 0.03, 0.06, 0.022, PM.red, 0, 0, 0);
    box(p, 0.032, 0.012, 0.024, PM.white, 0, 0.06, 0);
    box(p, 0.016, 0.012, 0.002, YT.glass, 0, 0.04, 0.012);
    rod(p, [0.016, 0.045, 0], [0.024, 0.01, 0.01], 0.002, PM.iron, 4);
  }
  for (const x of [-0.1, 0.1]) for (const z of [0.975, 1.015]) rod(st, [x, DY, z], [x, DY + 0.075, z], 0.002, PM.white, 4);
  box(st, 0.23, 0.006, 0.062, PM.red, 0, DY + 0.075, 0.995);
  for (const side of [-1, 1]) box(st, 0.1, 0.022, 0.003, signMat('YAKIT', '#c62828'), 0, DY + 0.052, 0.995 + side * 0.032);
  // Kıçtan rıhtıma bağlama halatları ve rıhtım babaları
  const fleet: [number, number, number, () => THREE.Group][] = [
    [-0.42, 0.66, 0.26, () => motorYacht('#c9a227', 0.26, true)],
    [-0.21, 0.64, 0.2, () => sailboat('#1e88e5', 0.2, '#1e5aa8')],
    [-0.09, 0.625, 0.19, () => sailboat('#00897b', 0.19, '#0b6b5e')],
    [0.09, 0.65, 0.22, () => motorYacht('#c62828', 0.22)],
    [0.21, 0.63, 0.2, () => sailboat('#f9a825', 0.2, '#37474f')],
    [0.42, 0.645, 0.22, () => sailboat('#6a1b9a', 0.22, '#1e5aa8')],
  ];
  for (const [x, z, L] of fleet) {
    for (const sx of [-1, 1]) {
      cyl(st, 0.005, 0.006, 0.012, PM.iron, x + sx * 0.02, 0.038, 0.462, 8);
      rod(st, [x + sx * 0.02, 0.046, 0.462], [x + sx * 0.012, water - 0.012 + L * 0.17, z - L / 2 + 0.006], 0.0007, PM.white, 3);
    }
  }
  g.add(mergeStatic([st]));
  // Yatlar: iskelelerin arasında, burunları denize dönük; deniz seviyesinde yüzer ve dalgada sallanır
  const boats: { obj: THREE.Object3D; phase: number }[] = [];
  fleet.forEach(([x, z, , make], n) => {
    const b = make();
    b.rotation.y = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(mergeStatic([b]));
    holder.position.set(x, water - 0.012, z);
    g.add(holder);
    boats.push({ obj: holder, phase: n * 1.7 });
  });
  // Yakıt iskelesine yanaşmış bot
  const tender = new THREE.Group();
  tender.add(mergeStatic([rib()]));
  tender.position.set(0.02, water - 0.012, 1.055);
  g.add(tender);
  boats.push({ obj: tender, phase: 4.1 });
  g.userData.bob = boats;
  return g;
}

// ======================= Cami (2x2) =======================
// Osmanlı tarzı: kesme taş harim (her açıklıkta taş kemerli nişte iki sıra pencere), pencereli kasnak üstünde kurşun
// kaplı büyük kubbe, önde ve arkada yarım kubbeler, köşe ve yan kubbeler, ağırlık kuleleri; önde beş kubbeli son
// cemaat yeri ve taç kapı, revaklı avlu (küçük kubbeler), ortasında şadırvan, abdest muslukları; iki şerefeli ince
// minareler (sivri külah, hilalli alem) ve aralarında gece yanan mahya. Çevrede servili bahçe, çiçek tarhları,
// banklar, lambalar, demir parmaklıklı alçak duvar. Ön yüz (+z) yola bakar. Pencereler ve şerefeler gece yanar.
const MQ = {
  wall: stoneMat('#fbf4e6'),
  stone: pm('#efe6d4', 0.85),
  trim: pm('#e4d8c0', 0.85),
  recess: pm('#d3c3a4', 0.9),
  marble: pm('#f7f4ee', 0.45),
  paving: pm('#d9d0bf', 0.95),
  lead: pm('#8b9cad', 0.45, 0.45),
  wood: pm('#5d3f28', 0.8),
  gold: pm('#e0b84c', 0.35, 0.6),
  lamp: new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff2c0', emissiveIntensity: 0 }),
};
MQ.lamp.name = 'lamp';
// Alem: altın çubuk, iki top ve hilal
function alem(g: THREE.Object3D, x: number, y: number, z: number, k = 1) {
  rod(g, [x, y, z], [x, y + 0.05 * k, z], 0.0022 * k, MQ.gold, 5);
  add(g, new THREE.SphereGeometry(0.0055 * k, 8, 6), MQ.gold, x, y + 0.012 * k, z);
  add(g, new THREE.SphereGeometry(0.0045 * k, 8, 6), MQ.gold, x, y + 0.027 * k, z);
  const c = add(g, new THREE.TorusGeometry(0.009 * k, 0.0022 * k, 4, 12, Math.PI * 1.3), MQ.gold, x, y + 0.06 * k, z);
  c.rotation.z = -1.15 * Math.PI;
}
// Küçük kubbe: alçak kasnak, kurşun kubbe, tepede altın uç
function smallDome(g: THREE.Object3D, x: number, y: number, z: number, r: number, drum = 0.014) {
  cyl(g, r + 0.004, r + 0.005, drum, MQ.stone, x, y, z, 16);
  add(g, dome(r, 16), MQ.lead, x, y + drum, z);
  rod(g, [x, y + drum + r - 0.002, z], [x, y + drum + r + 0.014, z], 0.0016, MQ.gold, 4);
}
// Minare: kare taş kaide, sekizgen pabuç, ince gövde, iki şerefe (mukarnas konsol, gece yanan korkuluk),
// petek, külah eteği, sivri kurşun külah ve alem
function minaret(g: THREE.Object3D, x: number, z: number) {
  g.add(part(KIT.facadeBox(0.056, 0.17, 0.056, 0.03), MQ.wall, x, 0.03 + 0.085, z));
  box(g, 0.062, 0.008, 0.062, MQ.trim, x, 0.2, z);
  cyl(g, 0.026, 0.033, 0.035, MQ.stone, x, 0.208, z, 8);
  g.add(part(KIT.facadeCylinder(0.025, 0.023, 0.47, 12, 0.243), MQ.wall, x, 0.243 + 0.235, z));
  const serefe = (y: number, r: number, rb: number) => {
    cyl(g, r - 0.012, rb, 0.014, MQ.stone, x, y - 0.026, z, 12);
    cyl(g, r - 0.004, r - 0.012, 0.012, MQ.trim, x, y - 0.012, z, 12);
    cyl(g, r, r, 0.006, MQ.trim, x, y, z, 12);
    add(g, new THREE.CylinderGeometry(r - 0.001, r - 0.001, 0.014, 12, 1, true), MQ.lamp, x, y + 0.013, z);
    cyl(g, r + 0.001, r + 0.001, 0.003, MQ.trim, x, y + 0.02, z, 12);
  };
  serefe(0.713, 0.042, 0.023);
  g.add(part(KIT.facadeCylinder(0.022, 0.021, 0.2, 12, 0.719), MQ.wall, x, 0.719 + 0.1, z));
  serefe(0.919, 0.038, 0.021);
  cyl(g, 0.017, 0.018, 0.1, MQ.stone, x, 0.925, z, 12);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    const w = add(g, archGeo(0.008, 0.022, 0.003), windowMat, x + Math.sin(a) * 0.0172, 0.96, z + Math.cos(a) * 0.0172);
    w.rotation.y = a;
  }
  cyl(g, 0.024, 0.017, 0.012, MQ.trim, x, 1.025, z, 12);
  add(g, new THREE.ConeGeometry(0.022, 0.19, 12), MQ.lead, x, 1.037 + 0.095, z);
  alem(g, x, 1.224, z, 0.8);
}
function mosque() {
  const st = new THREE.Group();
  const s = 1 / (2 * 0.96);
  // --- Zemin ve bahçe ---
  box(st, 0.98, 0.03, 0.98, MQ.paving, 0, 0, 0);
  for (const sx of [-1, 1]) box(st, 0.18, 0.006, 0.94, PM.lawn, sx * 0.395, 0.03, 0);
  box(st, 0.62, 0.006, 0.07, PM.lawn, 0, 0.03, -0.445);

  // --- Harim ---
  const cz = -0.17, W = 0.46, D = 0.42, H = 0.16;
  box(st, W + 0.02, 0.012, D + 0.02, MQ.trim, 0, 0.03, cz);
  st.add(part(KIT.facadeBox(W, H, D, 0.042), MQ.wall, 0, 0.042 + H / 2, cz));
  const RY = 0.042 + H;
  box(st, W + 0.016, 0.012, D + 0.016, MQ.trim, 0, RY, cz);
  box(st, W - 0.01, 0.006, D - 0.01, MQ.lead, 0, RY + 0.012, cz);
  const R = RY + 0.012;
  // Cepheler: her açıklıkta taş kemerli niş, altta dikdörtgen, üstte sivri kemerli pencere; aralarda ayaklar
  const faces: [number, number, number, number][] = [[0, cz + D / 2, 0, W], [0, cz - D / 2, Math.PI, W], [W / 2, cz, Math.PI / 2, D], [-W / 2, cz, -Math.PI / 2, D]];
  faces.forEach(([x, z, rot, len], fi) => {
    const f = item(st, x, z, rot, 1, 0);
    const n = 5, bay = len / n;
    for (let k = 0; k < n; k++) {
      if (fi === 0 && k === 2) continue;
      const u = -len / 2 + bay * (k + 0.5);
      add(f, archGeo(0.05, 0.13, 0.004), MQ.recess, u, 0.058, 0.001);
      box(f, 0.026, 0.04, 0.004, windowMat, u, 0.068, 0.002);
      box(f, 0.032, 0.005, 0.01, MQ.trim, u, 0.064, 0.004);
      add(f, archGeo(0.02, 0.04, 0.004), windowMat, u, 0.128, 0.003);
    }
    for (let k = 0; k <= n; k++) box(f, 0.012, H, 0.008, MQ.trim, -len / 2 + bay * k, 0.042, 0.002);
  });
  // Ana kubbe: pencereli kasnak ve payandalar, kubbe eteği, kurşun kubbe, büyük alem
  const DR = 0.14;
  st.add(part(KIT.facadeCylinder(DR, DR, 0.05, 24, R), MQ.wall, 0, R + 0.025, cz));
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const w = add(st, archGeo(0.018, 0.032, 0.004), windowMat, Math.sin(a) * DR, R + 0.008, cz + Math.cos(a) * DR);
    w.rotation.y = a;
    const b = a + Math.PI / 16;
    const p = box(st, 0.01, 0.05, 0.014, MQ.trim, Math.sin(b) * (DR + 0.004), R, cz + Math.cos(b) * (DR + 0.004));
    p.rotation.y = b;
  }
  cyl(st, DR + 0.008, DR + 0.008, 0.008, MQ.trim, 0, R + 0.05, cz, 24);
  add(st, dome(DR + 0.002, 28), MQ.lead, 0, R + 0.058, cz);
  alem(st, 0, R + 0.056 + DR, cz, 1.4);
  // Yarım kubbeler (önde ve arkada)
  for (const sz of [-1, 1]) {
    add(st, new THREE.SphereGeometry(0.1, 20, 8, sz > 0 ? 0 : Math.PI, Math.PI, 0, Math.PI / 2), MQ.lead, 0, R, cz + sz * 0.1);
    add(st, new THREE.CylinderGeometry(0.104, 0.104, 0.008, 20, 1, false, sz > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI), MQ.trim, 0, R + 0.004, cz + sz * 0.1);
  }
  // Yan ve köşe kubbeleri, ağırlık kuleleri
  for (const sx of [-1, 1]) {
    smallDome(st, sx * 0.175, R, cz, 0.05, 0.02);
    for (const sz of [-1, 1]) {
      smallDome(st, sx * 0.172, R, cz + sz * 0.155, 0.044, 0.016);
      const tx = sx * 0.118, tz = cz + sz * 0.118;
      cyl(st, 0.016, 0.017, 0.075, MQ.stone, tx, R, tz, 8);
      add(st, dome(0.017, 10), MQ.lead, tx, R + 0.075, tz);
      rod(st, [tx, R + 0.09, tz], [tx, R + 0.108, tz], 0.0016, MQ.gold, 4);
    }
  }

  // --- Son cemaat yeri: sütunlu revak, beş kubbe, taç kapı ---
  const PZ0 = cz + D / 2, PZ1 = PZ0 + 0.09, PH = 0.125;
  box(st, W + 0.012, 0.012, PZ1 - PZ0 + 0.006, MQ.marble, 0, 0.03, (PZ0 + PZ1) / 2);
  {
    const pf = item(st, 0, PZ0, 0, 1, 0);
    box(pf, 0.11, 0.185, 0.014, MQ.trim, 0, 0.042, 0.007);
    add(pf, archGeo(0.07, 0.15, 0.004), MQ.recess, 0, 0.05, 0.015);
    add(pf, archGeo(0.038, 0.085, 0.004), MQ.wood, 0, 0.05, 0.017);
    for (let j = 0; j < 5; j++) box(pf, 0.012, 0.012, 0.01, MQ.trim, -0.044 + j * 0.022, 0.227, 0.007);
  }
  add(st, arcadeGeo(W, PH, 5, 0.014), MQ.wall, 0, 0.042, PZ1 - 0.007);
  for (const sx of [-1, 1]) {
    const a = add(st, arcadeGeo(PZ1 - PZ0, PH, 1, 0.014), MQ.wall, sx * (W / 2 - 0.007), 0.042, (PZ0 + PZ1) / 2);
    a.rotation.y = (sx * Math.PI) / 2;
  }
  for (let k = 0; k <= 5; k++) {
    const x = -W / 2 + (k * W) / 5;
    cyl(st, 0.0062, 0.0062, 0.054, MQ.marble, x, 0.042, PZ1 + 0.001, 8);
    box(st, 0.016, 0.006, 0.016, MQ.trim, x, 0.094, PZ1 + 0.001);
  }
  box(st, W + 0.012, 0.012, 0.1, MQ.trim, 0, 0.042 + PH, (PZ0 + PZ1) / 2);
  for (let k = 0; k < 5; k++) smallDome(st, -W / 2 + (W / 5) * (k + 0.5), 0.179, (PZ0 + PZ1) / 2, k === 2 ? 0.04 : 0.034, 0.012);

  // --- Avlu: üç yanda revak (taş dış duvar, sütunlu kemerler, küçük kubbeler), mermer zemin, taç kapı ---
  const AH = 0.09, RV = 0.065;
  box(st, 0.33, 0.006, 0.28, MQ.marble, 0, 0.03, 0.27);
  for (let k = 1; k < 5; k++) box(st, 0.002, 0.001, 0.28, MQ.trim, -0.165 + k * 0.066, 0.036, 0.27);
  for (let k = 1; k < 5; k++) box(st, 0.33, 0.001, 0.002, MQ.trim, 0, 0.036, PZ1 + k * 0.056);
  for (const sx of [-1, 1]) {
    st.add(part(KIT.facadeBox(0.012, AH, 0.345, 0.03), MQ.wall, sx * 0.224, 0.03 + AH / 2, 0.3025));
    const arc = add(st, arcadeGeo(0.28, AH, 4, 0.012), MQ.wall, sx * (W / 2 - RV), 0.03, 0.27);
    arc.rotation.y = (-sx * Math.PI) / 2;
    for (let k = 0; k <= 4; k++) cyl(st, 0.005, 0.005, 0.04, MQ.marble, sx * (W / 2 - RV - 0.007), 0.03, PZ1 + k * 0.07, 8);
    box(st, RV + 0.007, 0.01, 0.345, MQ.trim, sx * (W / 2 - RV / 2 + 0.003), 0.03 + AH, 0.3025);
    for (const z of [0.165, 0.235, 0.305, 0.375, 0.4425]) smallDome(st, sx * 0.197, 0.03 + AH + 0.01, z, 0.026, 0.01);
    // Abdest muslukları: dış duvar boyunca oturma taşı, tekne ve pirinç musluklar
    box(st, 0.016, 0.014, 0.26, MQ.marble, sx * 0.239, 0.03, 0.3);
    box(st, 0.012, 0.006, 0.26, MQ.recess, sx * 0.236, 0.056, 0.3);
    for (let k = 0; k < 6; k++) box(st, 0.008, 0.004, 0.004, MQ.gold, sx * 0.233, 0.075, 0.19 + k * 0.044);
  }
  st.add(part(KIT.facadeBox(0.448, AH, 0.012, 0.03), MQ.wall, 0, 0.03 + AH / 2, 0.469));
  {
    const fa = add(st, arcadeGeo(0.33, AH, 5, 0.012), MQ.wall, 0, 0.03, 0.41);
    fa.rotation.y = Math.PI;
  }
  for (let k = 0; k <= 5; k++) cyl(st, 0.005, 0.005, 0.04, MQ.marble, -0.165 + k * 0.066, 0.03, 0.403, 8);
  box(st, 0.33, 0.01, RV + 0.007, MQ.trim, 0, 0.03 + AH, 0.4425);
  for (const x of [-0.132, -0.066, 0.066, 0.132]) smallDome(st, x, 0.03 + AH + 0.01, 0.4425, 0.026, 0.01);
  smallDome(st, 0, 0.03 + AH + 0.01, 0.438, 0.032, 0.014);
  // Avlu taç kapısı: dışa taşan yüksek taş kütle, iki yüzde sivri kemerli niş ve kapı, mazgallı tepe
  st.add(part(KIT.facadeBox(0.1, 0.17, 0.034, 0.03), MQ.wall, 0, 0.03 + 0.085, 0.47));
  box(st, 0.108, 0.01, 0.04, MQ.trim, 0, 0.2, 0.47);
  for (let j = 0; j < 5; j++) box(st, 0.012, 0.012, 0.012, MQ.trim, -0.044 + j * 0.022, 0.21, 0.47);
  for (const side of [-1, 1]) {
    const f = item(st, 0, 0.47 + side * 0.017, side > 0 ? 0 : Math.PI, 1, 0);
    add(f, archGeo(0.064, 0.14, 0.004), MQ.recess, 0, 0.03, 0.001);
    add(f, archGeo(0.036, 0.08, 0.004), MQ.wood, 0, 0.03, 0.003);
  }
  // Şadırvan: sekizgen mermer havuz, ortada musluklu hazne, sekiz sütun, geniş saçaklı çatı, küçük kubbe
  {
    const fz = 0.27;
    cyl(st, 0.062, 0.066, 0.008, MQ.marble, 0, 0.036, fz, 8);
    cyl(st, 0.05, 0.052, 0.022, MQ.marble, 0, 0.044, fz, 8);
    cyl(st, 0.044, 0.044, 0.003, WATER, 0, 0.064, fz, 8);
    cyl(st, 0.022, 0.024, 0.04, MQ.marble, 0, 0.066, fz, 8);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const t = box(st, 0.004, 0.004, 0.008, MQ.gold, Math.sin(a) * 0.026, 0.08, fz + Math.cos(a) * 0.026);
      t.rotation.y = a;
      const b = a + Math.PI / 8;
      rod(st, [Math.sin(b) * 0.052, 0.066, fz + Math.cos(b) * 0.052], [Math.sin(b) * 0.052, 0.13, fz + Math.cos(b) * 0.052], 0.0028, MQ.marble, 6);
    }
    cyl(st, 0.074, 0.074, 0.006, MQ.trim, 0, 0.13, fz, 8);
    add(st, new THREE.ConeGeometry(0.084, 0.03, 8), MQ.lead, 0, 0.151, fz);
    cyl(st, 0.024, 0.026, 0.012, MQ.stone, 0, 0.158, fz, 12);
    add(st, dome(0.025, 12), MQ.lead, 0, 0.17, fz);
    alem(st, 0, 0.193, fz, 0.6);
  }

  // --- Minareler ve aralarında mahya ---
  const MZ = PZ0 + 0.03;
  for (const sx of [-1, 1]) minaret(st, sx * 0.265, MZ);
  {
    let prev: V3 | null = null;
    for (let k = 0; k <= 16; k++) {
      const u = k / 16;
      const p: V3 = [-0.226 + 0.452 * u, 0.935 - 0.07 * Math.sin(u * Math.PI), MZ];
      if (prev) rod(st, prev, p, 0.0007, PM.iron, 3);
      if (k > 0 && k < 16) add(st, BULB_GEO, BULB, p[0], p[1] - 0.007, p[2]);
      prev = p;
    }
  }

  // --- Bahçe: serviler, çınarlar, çiçek tarhları, banklar, lambalar, parmaklıklı alçak duvar ---
  for (const sx of [-1, 1]) {
    for (const z of [-0.42, -0.25, -0.08]) st.add(tree(PROPS.treeSmall, sx * 0.44, z, 2, sx * z * 9, 0.6));
    st.add(tree(PROPS.treeLarge, sx * 0.4, 0.27, 2, sx, 0.72));
    flowerBed(st, sx * 0.395, 0.43, 0.15, 0.05, sx + 2, 0.036);
    flowerBed(st, sx * 0.335, -0.2, 0.035, 0.26, sx + 4, 0.036);
    bench(st, sx * 0.36, 0.11, (-sx * Math.PI) / 2, s);
    for (const z of [-0.33, -0.02, 0.36]) lamp(st, sx * 0.288, z, s);
  }
  flowerBed(st, 0, -0.445, 0.42, 0.035, 3, 0.036);
  const railLine = (a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const w = box(st, Math.hypot(dx, dz) + 0.014, 0.02, 0.014, MQ.trim, (a[0] + b[0]) / 2, 0.03, (a[1] + b[1]) / 2);
    w.rotation.y = -Math.atan2(dz, dx);
    fenceLine(st, a, b, 0.035, 0.035, PM.iron, PM.iron, 0.05, 1, 0.003);
  };
  railLine([-0.483, -0.483], [0.483, -0.483]);
  for (const sx of [-1, 1]) {
    railLine([sx * 0.483, -0.483], [sx * 0.483, 0.483]);
    railLine([sx * 0.3, 0.483], [sx * 0.483, 0.483]);
  }
  return mergeStatic([st]);
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
  // Gölde yüzen kuşlar daire çizer; hayvanat bahçesindeki hayvanların kendi yürüyüşü var (step)
  const animals = obj.userData.animals as ZooWalker[] | undefined;
  if (animals) {
    const t = (obj.userData.t = ((obj.userData.t as number | undefined) ?? 0) + dt);
    for (const a of animals) {
      if (a.step) {
        a.step(t);
        continue;
      }
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
