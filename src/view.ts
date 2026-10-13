import * as THREE from 'three';
import { SIZE, RES_LEVELS, COM_LEVELS, PROPS, PLOT, PLOTS, RIVER, RIVER_ROWS, COAST_ROW, ROWS, PLOT_ROWS, Z0, ENTRANCE_Z, MATERIALS, MAKERS, UNDERPASS, type MatId } from './config';
import { City, DIRS, idx, inBounds, isUtility, isService, isIndustry, isDecor, isZone, isWater, isWaterXZ, isSandXZ, isSeaXZ } from './city';
import { makeDecor, animateDecor, palm } from './landmarks';
import { makePark } from './fun';
import { parkingGarage, metro } from './places';
import { SIGNAL_MATS, signalGroup } from './signals';
import { mergeStatic, disposeMerged } from './batcher';
import { railPiece } from './rails';
import { riverMat, worldUV, RIVER_Y, SEA_Y, waterColor } from './water';

// Hareket eden parçası olan nesneler (pervane, duman, dönme dolap, ışık, alev) ayrı çizilir;
// geri kalan her şey 8x8'lik bölgeler halinde birleştirilir.
const needsLive = (o: THREE.Object3D) =>
  !!(o.userData.spin || o.userData.smoke || o.userData.blink || o.userData.wheel || o.userData.ship || o.userData.carousel || o.userData.drop || o.userData.swing || o.userData.spray || o.userData.beam || o.userData.bob || o.userData.animals || o.getObjectByName('flames'));
import { makeModel, ROAD_COLORS } from './assets';
import { arcBand, arcWall } from './roads';
import { makeUtility, animateUtility } from './utilities';
import { makeService, animateService, makeHall } from './services';
import { makeIndustry, setWorking, animatePort } from './industry';
import { makeItem, type ItemId } from './items';

// Yol parçalarının (roads.ts) hangi kenarları açık (kuzey 1, doğu 2, güney 4, batı 8)
const ROAD_BASES: [string, number][] = [
  ['proc/road-straight', 0b0101],
  ['proc/road-corner', 0b0110],
  ['proc/road-tsplit', 0b0111],
  ['proc/road-junction', 0b1111],
];

// Her kare için sabit "rastgele" sayı (aynı karede hep aynı süsler çıksın)
const hash = (x: number, z: number, seed = 0) => {
  const v = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

// Sokak lambasının ucunda gece yanan ışık (DayNight 'lamp' adlı malzemeyi yakar)
const lampMat = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff2c0', emissiveIntensity: 0 });
lampMat.name = 'lamp';
// Sokak lambası: kaldırımda ince koyu direk, yola doğru kavisli kol, ucunda yassı lamba başlığı (altı gece yanar).
// Kol yerel -x yönünde uzanır (rot ile yola çevrilir).
const POLE_MAT = new THREE.MeshStandardMaterial({ color: '#3a4652', roughness: 0.45, metalness: 0.55 });
const STREET = {
  base: new THREE.CylinderGeometry(0.014, 0.018, 0.016, 8),
  pole: new THREE.CylinderGeometry(0.0048, 0.0072, 0.42, 7),
  arm: new THREE.TorusGeometry(0.06, 0.0035, 5, 10, Math.PI / 2),
  reach: new THREE.CylinderGeometry(0.0035, 0.0035, 0.07, 5).rotateZ(Math.PI / 2),
  head: new THREE.BoxGeometry(0.07, 0.012, 0.03),
  lens: new THREE.BoxGeometry(0.056, 0.004, 0.022),
};
// Gece: lambanın etrafında parlak hale, altındaki yolda sıcak sarı ışık havuzu (DayNight 'glow' adlı malzemeleri
// gece görünür yapar). Yukarıdan bakınca lambanın camı görünmediği için yandığı böyle anlaşılır.
function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GLOW_TEX = radialTexture();
function glowMat(color: string, base: number) {
  const m = new THREE.MeshBasicMaterial({ map: GLOW_TEX, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  m.name = 'glow';
  m.userData.base = base;
  m.visible = false;
  return m;
}
const LAMP_POOL = glowMat('#ffc966', 0.85);
const LAMP_HALO = glowMat('#fff0c0', 0.85);
const POOL_GEO = new THREE.PlaneGeometry(0.44, 0.44).rotateX(-Math.PI / 2);
const HALO_GEO = new THREE.PlaneGeometry(0.09, 0.09);
// Hale her yönden görünsün diye çapraz iki düzlem + yatay bir düzlem
function lampGlow(g: THREE.Object3D, x: number, y: number, z: number, groundY: number) {
  const pool = new THREE.Mesh(POOL_GEO, LAMP_POOL);
  pool.position.set(x, groundY, z);
  g.add(pool);
  for (const r of [0, Math.PI / 2]) {
    const h = new THREE.Mesh(HALO_GEO, LAMP_HALO);
    h.position.set(x, y, z);
    h.rotation.y = r;
    g.add(h);
  }
  const top = new THREE.Mesh(HALO_GEO, LAMP_HALO);
  top.position.set(x, y, z);
  top.rotation.x = -Math.PI / 2;
  g.add(top);
}

export function streetLight(dx: number, dz: number, rot: number) {
  const g = new THREE.Group();
  g.position.set(dx, 0.03, dz);
  g.rotation.y = rot;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    g.add(o);
    return o;
  };
  add(STREET.base, POLE_MAT, 0, 0.008, 0);
  add(STREET.pole, POLE_MAT, 0, 0.21, 0);
  // Direğin tepesinden yola doğru kıvrılan kol
  add(STREET.arm, POLE_MAT, -0.06, 0.42, 0);
  add(STREET.reach, POLE_MAT, -0.095, 0.48, 0);
  add(STREET.head, POLE_MAT, -0.15, 0.475, 0);
  add(STREET.lens, lampMat, -0.15, 0.468, 0);
  // Işık havuzu yolun üstünde (yol 0.035, lamba kaldırımda 0.03'te duruyor)
  lampGlow(g, -0.15, 0.462, 0, 0.041 - 0.03);
  return g;
}

// Cadde ve bulvar süsleri (yol z yönünde uzanıyormuş gibi kurulur, x yönündeyse döndürülür).
// Arabalar şeridin ortasından 0.16 uzakta gider; refüj onlara değmeyecek kadar ince.
const roadDeco = {
  curb: new THREE.MeshStandardMaterial({ color: '#d4cec1', roughness: 0.9 }),
  lawn: new THREE.MeshStandardMaterial({ color: '#6cc35a', roughness: 0.9 }),
  pole: new THREE.MeshStandardMaterial({ color: '#2f3b45', roughness: 0.5, metalness: 0.4 }),
  stone: new THREE.MeshStandardMaterial({ color: '#d9d4c8', roughness: 0.9 }), // caddenin ince kaldırımı
  asphalt: new THREE.MeshStandardMaterial({ color: ROAD_COLORS.asphalt, roughness: 0.9 }),
  paint: new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.8 }),
  yellow: new THREE.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.8 }),
  brick: new THREE.MeshStandardMaterial({ color: '#c98a6a', roughness: 0.9 }), // bulvarın tuğla kaldırımı
  flowers: ['#ff5c8a', '#ffd23f', '#ffffff', '#ff8a3d', '#c77dff'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })),
  geo: {
    curbB: new THREE.BoxGeometry(0.14, 0.024, 1),
    lawnB: new THREE.BoxGeometry(0.12, 0.026, 0.98),
    flower: new THREE.IcosahedronGeometry(0.015, 0),
    walk: new THREE.BoxGeometry(0.1, 0.004, 1),
    asphalt: new THREE.BoxGeometry(0.86, 0.01, 1),
    curbC: new THREE.BoxGeometry(0.07, 0.014, 1),
    edge: new THREE.BoxGeometry(0.012, 0.002, 1),
    dash: new THREE.BoxGeometry(0.012, 0.002, 0.16),
    zebra: new THREE.BoxGeometry(0.06, 0.002, 0.2),
    barrier: new THREE.BoxGeometry(0.035, 0.03, 0.98),
    pole: new THREE.CylinderGeometry(0.005, 0.007, 0.3, 6),
    arm: new THREE.BoxGeometry(0.012, 0.006, 0.11),
    bulb: new THREE.SphereGeometry(0.016, 8, 6),
  },
};
function roadExtras(grade: number, alongX: boolean, along: number, nearJunction: boolean, seed: number) {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const lamp = (h: number) => {
    // Refüjde iki yana kollu lamba: kollar iki yöndeki şeritlerin üstüne uzanır
    const pole = add(roadDeco.geo.pole, POLE_MAT, 0, h / 2 + 0.06, 0);
    pole.scale.y = h / 0.3;
    for (const s of [-1, 1]) {
      const arm = add(STREET.reach, POLE_MAT, s * 0.06, h + 0.06, 0);
      arm.scale.x = 1.7;
      add(STREET.head, POLE_MAT, s * 0.13, h + 0.055, 0);
      add(STREET.lens, lampMat, s * 0.13, h + 0.048, 0);
      lampGlow(g, s * 0.13, h + 0.042, 0, grade === 2 ? 0.0545 : 0.041);
    }
  };
  if (grade === 1) {
    // Bulvar: tuğla kaldırım, iki yanda ağaçlar; çimenli refüjde çiçekler, bir karede ağaç ötekinde süslü lamba
    for (const side of [-1, 1]) add(roadDeco.geo.walk, roadDeco.brick, side * 0.448, 0.052, 0).receiveShadow = true;
    for (const side of [-1, 1]) g.add(prop(PROPS.treeStreet, side * 0.465, side * 0.22, seed + side, 0.42 + hash(seed, side + 3) * 0.08));
    if (!nearJunction) {
      add(roadDeco.geo.curbB, roadDeco.curb, 0, 0.048, 0);
      add(roadDeco.geo.lawnB, roadDeco.lawn, 0, 0.052, 0);
      for (let k = 0; k < 10; k++) {
        const z = -0.45 + k * 0.1;
        if (Math.abs(z) < 0.09) continue;
        add(roadDeco.geo.flower, roadDeco.flowers[(k + seed) % roadDeco.flowers.length], (k % 2 ? 1 : -1) * 0.03, 0.072, z);
      }
      if (along % 2 === 0) g.add(prop(PROPS.treeSmall, 0, 0, seed, 0.6));
      else lamp(0.3);
    }
  } else {
    // Cadde: çift şeritli geniş yol (her yönde iki şerit), ince kaldırım, ortada beton bariyer
    add(roadDeco.geo.asphalt, roadDeco.asphalt, 0, 0.047, 0).castShadow = false;
    for (const side of [-1, 1]) {
      add(roadDeco.geo.curbC, roadDeco.stone, side * 0.465, 0.053, 0);
      add(roadDeco.geo.edge, roadDeco.paint, side * 0.39, 0.0515, 0);
      for (const z of [-0.33, 0, 0.33]) add(roadDeco.geo.dash, roadDeco.paint, side * 0.2, 0.0515, z);
    }
    // Kavşağa bitişik karede yaya geçidi kavşağın kenarında çizili; burada sadece şerit çizgileri
    if (!nearJunction) {
      add(roadDeco.geo.barrier, roadDeco.curb, 0, 0.066, 0);
      for (const side of [-1, 1]) add(roadDeco.geo.edge, roadDeco.yellow, side * 0.03, 0.0515, 0);
      if (along % 3 === 0) lamp(0.36);
    }
  }
  if (alongX) g.rotation.y = Math.PI / 2;
  return g;
}

// Trafik ışıkları: kavşağa gelen her yolun sağ köşesinde bir direk; direkten yolun üstüne uzanan kol,
// kolun ucunda gelen arabalara bakan üç lambalı başlık (kırmızı, sarı, yeşil). Lambalar her karede yakılır (signals.ts).
const signalGeo = {
  pole: new THREE.CylinderGeometry(0.0065, 0.0085, 0.36, 7),
  base: new THREE.CylinderGeometry(0.013, 0.016, 0.014, 8),
  armX: new THREE.BoxGeometry(0.2, 0.009, 0.009),
  armZ: new THREE.BoxGeometry(0.009, 0.009, 0.2),
  headX: new THREE.BoxGeometry(0.02, 0.072, 0.028),
  headZ: new THREE.BoxGeometry(0.028, 0.072, 0.02),
  lamp: new THREE.SphereGeometry(0.0085, 8, 6),
};
const SIGNAL_DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// mask: kavşağa hangi yönlerden yol geliyor (kuzey 1, doğu 2, güney 4, batı 8)
function signalPost(tile: number, mask: number) {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  };
  // Grup 0'da kuzey-güney ışıkları 0. malzemeyi kullanır; grup 1 tam tersini
  const ns = signalGroup(tile), ew = 1 - ns;
  for (let d = 0; d < 4; d++) {
    if (!(mask & (1 << d))) continue;
    // Bu yoldan gelen araba (d+2) yönünde gider; ışık onun sağ köşesinde, ona bakar
    const t = (d + 2) % 4;
    const [fx, fz] = SIGNAL_DIRS[t];
    const rx = -fz, rz = fx;
    const px = -fx * 0.47 + rx * 0.47, pz = -fz * 0.47 + rz * 0.47;
    const k = t % 2 === 0 ? ns : ew;
    add(signalGeo.base, POLE_MAT, px, 0.037, pz);
    add(signalGeo.pole, POLE_MAT, px, 0.21, pz);
    // Kol direkten şeridin üstüne uzanır
    add(rx ? signalGeo.armX : signalGeo.armZ, POLE_MAT, px - rx * 0.1, 0.38, pz - rz * 0.1);
    const hx = px - rx * 0.22, hz = pz - rz * 0.22;
    add(rx ? signalGeo.headZ : signalGeo.headX, POLE_MAT, hx, 0.335, hz);
    // Lambalar başlığın arabaya bakan yüzünde
    const lx = hx - fx * 0.012, lz = hz - fz * 0.012;
    add(signalGeo.lamp, SIGNAL_MATS.red[k], lx, 0.358, lz);
    add(signalGeo.lamp, SIGNAL_MATS.amber[k], lx, 0.335, lz);
    add(signalGeo.lamp, SIGNAL_MATS.green[k], lx, 0.312, lz);
  }
  return g;
}

// Çıkmaz sokağın ucu: yuvarlak dönüş meydanı, ortasında çimenli adacık ve ağaç
// Çıkmaz sokak: yol karenin ortasına kadar gelir ve yuvarlak bir uçla biter (yol ile aynı renk ve ölçü:
// asfalt ±0.45, kenarda ince yüksek bordür, ±0.3'te sarı çizgi). Sarı çizgiler uçta U çizerek birleşir;
// ortadaki küçük adacığın çevresinden arabalar geri döner.
const CUL = {
  asphalt: new THREE.MeshStandardMaterial({ color: ROAD_COLORS.asphalt, roughness: 0.4 }),
  curb: new THREE.MeshStandardMaterial({ color: ROAD_COLORS.curb, roughness: 0.4 }),
  yellow: new THREE.MeshStandardMaterial({ color: ROAD_COLORS.line, roughness: 0.4 }),
};
// Yarım halka (kapalı uç tarafı -z): iç ve dış yarıçap, kalınlık
function halfRing(r0: number, r1: number, depth: number) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r1, 0, Math.PI, false);
  s.lineTo(-r0, 0);
  s.absarc(0, 0, r0, Math.PI, 0, true);
  s.lineTo(r1, 0);
  // Şekil xy düzleminde çizilir; yere yatırınca +y yönü -z olur (kapalı uç), kalınlık yukarı doğru
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 32 }).rotateX(-Math.PI / 2);
}
const culGeo = {
  cap: new THREE.CircleGeometry(0.455, 40, 0, Math.PI).rotateX(-Math.PI / 2),
  curb: halfRing(0.452, 0.5, 0.05),
  line: halfRing(0.29, 0.31, 0.0016),
  island: new THREE.CylinderGeometry(0.085, 0.085, 0.03, 24),
  islandEdge: new THREE.CylinderGeometry(0.1, 0.1, 0.022, 24),
};
function culDeSac(mask: number, grade: number) {
  const g = new THREE.Group();
  const d = [1, 2, 4, 8].indexOf(mask); // yolun geldiği yön
  // Hepsi yol +z'den geliyormuş gibi çizilir, sonra döndürülür
  const r = new THREE.Group();
  r.rotation.y = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][d];
  g.add(r);
  // Açık yarı: normal yol (yarı boyda)
  const stub = makeModel(ROAD_BASES[0][0]);
  stub.scale.z *= 0.5;
  stub.position.z = 0.25;
  r.add(stub);
  if (grade) {
    const ex = roadExtras(grade, false, 1, false, 3);
    ex.scale.z = 0.5;
    ex.position.z = 0.25;
    r.add(ex);
  }
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.y = y;
    mesh.receiveShadow = true;
    r.add(mesh);
    return mesh;
  };
  // Kapalı yarı: yuvarlak asfalt uç, kenarında bordür, sarı U çizgisi
  add(culGeo.cap, CUL.asphalt, 0.035);
  add(culGeo.curb, CUL.curb, 0);
  add(culGeo.line, CUL.yellow, 0.0352);
  // Ortada küçük adacık ve ağaç
  add(culGeo.islandEdge, CUL.curb, 0.046);
  add(culGeo.island, roadDeco.lawn, 0.05);
  r.add(prop(PROPS.treeStreet, 0, 0, mask, 0.32));
  return g;
}

// Yükseltilmiş yolların kavşak ve dönemeçleri: caddede geniş asfalt ve yaya geçitleri, bulvarda tuğla köşeler ve çiçeklikler
// Bulvar ve caddenin virajı: kesit (kaldırım, refüj ya da bariyer, şerit çizgileri) dönemeci takip eder.
// (cx, cz) iç köşe; a0..a1 karenin içine bakan çeyrek. Virajın dış köşesi boş kalır (yandaki zemin görünür).
const CURVE_COLORS = { brick: '#c98a6a', lawn: '#6cc35a', curb: '#d4cec1', stone: '#d9d4c8', paint: '#f4f4f0', yellow: '#f2c14e' };
const curveVC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
function gradedCurve(g: THREE.Group, grade: number, cx: number, cz: number) {
  const a0 = Math.atan2(-cz, -cx) - Math.PI / 4, a1 = a0 + Math.PI / 2;
  const put = (geo: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(geo, curveVC);
    m.receiveShadow = true;
    g.add(m);
  };
  // Kesitin bir bandı: üst yüz ve iki yan yüz
  const band = (r0: number, r1: number, y0: number, y1: number, color: string, side = color, seg = 20) => {
    put(arcBand(cx, cz, r0, r1, a0, a1, y1, color, seg));
    if (r0 > 0.001) put(arcWall(cx, cz, r0, a0, a1, y0, y1, false, side, seg));
    put(arcWall(cx, cz, r1, a0, a1, y0, y1, true, side, seg));
  };
  const C = CURVE_COLORS;
  if (grade === 2) {
    // Cadde: yükseltilmiş asfalt, iki yanda taş bordür, şerit çizgileri, ortada beton bariyer
    put(arcBand(cx, cz, 0.07, 0.93, a0, a1, 0.052, ROAD_COLORS.asphalt, 24));
    band(0.93, 1, 0, 0.06, C.stone, '#b9b2a3');
    band(0, 0.07, 0.035, 0.06, C.stone, '#b9b2a3', 8);
    for (const r of [0.11, 0.89]) put(arcBand(cx, cz, r - 0.006, r + 0.006, a0, a1, 0.0535, C.paint, 20));
    for (const r of [0.47, 0.53]) put(arcBand(cx, cz, r - 0.006, r + 0.006, a0, a1, 0.0535, C.yellow, 16));
    for (const r of [0.3, 0.7]) {
      for (let k = 0; k < 3; k++) {
        const t = a0 + ((a1 - a0) * (k + 0.5)) / 3, half = 0.08 / r;
        put(arcBand(cx, cz, r - 0.006, r + 0.006, t - half, t + half, 0.0535, C.paint, 4));
      }
    }
    band(0.4825, 0.5175, 0.052, 0.081, C.curb, '#bdb6a8');
  } else {
    // Bulvar: iki yanda tuğla kaldırım, ortada bordürlü çimen refüj ve çiçekler, dış kaldırımda ağaç
    band(0.902, 1, 0, 0.054, C.brick, '#a8705a');
    band(0, 0.1, 0.035, 0.054, C.brick, '#a8705a', 8);
    band(0.43, 0.57, 0.035, 0.06, C.curb, '#bdb6a8');
    band(0.44, 0.56, 0.06, 0.065, C.lawn, '#4f9a3e');
    for (let k = 0; k < 7; k++) {
      const t = a0 + ((a1 - a0) * (k + 0.5)) / 7, r = 0.5 + (k % 2 ? 0.03 : -0.03);
      const f = new THREE.Mesh(roadDeco.geo.flower, roadDeco.flowers[k % roadDeco.flowers.length]);
      f.position.set(cx + Math.cos(t) * r, 0.072, cz + Math.sin(t) * r);
      g.add(f);
    }
    const tm = (a0 + a1) / 2;
    g.add(prop(PROPS.treeStreet, cx + Math.cos(tm) * 0.95, cz + Math.sin(tm) * 0.95, Math.floor(tm * 100), 0.45));
  }
}
// Sokak ayrıntıları (karede rastgele): rögar kapağı, bordür dibinde yağmur ızgarası, yama asfalt.
// Asfalttan (0.035) ve çizgilerden (0.0365) belirgin yüksekte; yamalar çizgilere değmez.
const DETAIL = {
  rim: new THREE.MeshStandardMaterial({ color: '#5b6170', roughness: 0.6, metalness: 0.3 }),
  lid: new THREE.MeshStandardMaterial({ color: '#2d313c', roughness: 0.7, metalness: 0.3 }),
  grate: new THREE.MeshStandardMaterial({ color: '#1f2229', roughness: 0.8 }),
  patch: new THREE.MeshStandardMaterial({ color: '#4a5064', roughness: 0.95 }),
  rimGeo: new THREE.CylinderGeometry(0.032, 0.032, 0.0025, 18),
  lidGeo: new THREE.CylinderGeometry(0.026, 0.026, 0.0045, 18),
  grateGeo: new THREE.BoxGeometry(0.02, 0.0035, 0.05),
  slotGeo: new THREE.BoxGeometry(0.014, 0.0045, 0.004),
};
function streetDetails(x: number, z: number, alongX: boolean) {
  const g = new THREE.Group();
  const put = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, y: number, pz: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(px, y + (geo as THREE.BoxGeometry).parameters.height / 2, pz);
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  const h = hash(x, z, 11), side = hash(x, z, 12) < 0.5 ? -1 : 1;
  const along = (hash(x, z, 13) - 0.5) * 0.7;
  if (h < 0.35) {
    // Rögar kapağı (şeridin ortasında)
    put(DETAIL.rimGeo, DETAIL.rim, side * 0.15, 0.035, along);
    put(DETAIL.lidGeo, DETAIL.lid, side * 0.15, 0.035, along);
  } else if (h < 0.6) {
    // Yağmur ızgarası (bordürün dibinde, oluğun üstünde)
    const gx = side * (0.45 - 0.012);
    put(DETAIL.grateGeo, DETAIL.grate, gx, 0.0365, along);
    for (let k = 0; k < 4; k++) put(DETAIL.slotGeo, DETAIL.rim, gx, 0.0365, along - 0.018 + k * 0.012);
  } else if (h < 0.75) {
    // Yama asfalt (orta çizgi ile kenar çizgisi arasında)
    const w = 0.08 + hash(x, z, 14) * 0.1, d = 0.1 + hash(x, z, 15) * 0.2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.002, d), DETAIL.patch);
    mesh.position.set(side * (0.03 + w / 2 + hash(x, z, 16) * (0.24 - w)), 0.036, along * 0.5);
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  if (alongX) g.rotation.y = Math.PI / 2;
  return g;
}

// Köşe kaldırımı (T ve dörtlü kavşakta): karenin köşesinde çeyrek daire
function cornerDisc(g: THREE.Group, cx: number, cz: number, r: number, y0: number, y1: number, color: string, side: string) {
  const a0 = Math.atan2(-cz, -cx) - Math.PI / 4, a1 = a0 + Math.PI / 2;
  for (const geo of [arcBand(cx, cz, 0, r, a0, a1, y1, color, 8), arcWall(cx, cz, r, a0, a1, y0, y1, true, side, 8)]) {
    const m = new THREE.Mesh(geo, curveVC);
    m.receiveShadow = true;
    g.add(m);
  }
}

function junctionExtras(grade: number, mask: number) {
  const g = new THREE.Group();
  // İki komşu yönü bağlayan viraj: kesit dönemeci takip eder
  const dirs = [0, 1, 2, 3].filter(d => mask & (1 << d));
  if (dirs.length === 2 && (dirs[1] - dirs[0]) % 2 === 1) {
    const [a, b] = dirs.map(d => DIRS[d]);
    gradedCurve(g, grade, (a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5);
    return g;
  }
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rot = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rot;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const corners: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  if (grade === 2) {
    add(new THREE.BoxGeometry(0.96, 0.01, 0.96), roadDeco.asphalt, 0, 0.047, 0);
    for (let d = 0; d < 4; d++) {
      const [dx, dz] = DIRS[d];
      const rot = d % 2 ? Math.PI / 2 : 0;
      if (mask & (1 << d)) {
        // Bu yönde yol var: yaya geçidi
        for (let k = 0; k < 6; k++) {
          const s = -0.3 + k * 0.12;
          add(roadDeco.geo.zebra, roadDeco.paint, dx * 0.4 + (d % 2 ? 0 : s), 0.0525, dz * 0.4 + (d % 2 ? s : 0), rot);
        }
      } else {
        // Yol yok: kaldırım
        add(new THREE.BoxGeometry(0.96, 0.014, 0.07), roadDeco.stone, dx * 0.465, 0.053, dz * 0.465, rot);
      }
    }
    for (const [sx, sz] of corners) cornerDisc(g, sx * 0.5, sz * 0.5, 0.07, 0.035, 0.06, CURVE_COLORS.stone, '#b9b2a3');
  } else {
    for (const [sx, sz] of corners) {
      cornerDisc(g, sx * 0.5, sz * 0.5, 0.12, 0.035, 0.054, CURVE_COLORS.brick, '#a8705a');
      // Köşede çiçeklik
      add(new THREE.CylinderGeometry(0.035, 0.03, 0.04, 10), roadDeco.brick, sx * 0.44, 0.075, sz * 0.44);
      for (let k = 0; k < 3; k++) add(roadDeco.geo.flower, roadDeco.flowers[k + (sx > 0 ? 1 : 0)], sx * 0.44 + (k - 1) * 0.018, 0.1, sz * 0.44 + ((k % 2) - 0.5) * 0.015);
    }
    for (let d = 0; d < 4; d++) {
      if (mask & (1 << d)) continue;
      const [dx, dz] = DIRS[d];
      add(roadDeco.geo.walk, roadDeco.brick, dx * 0.448, 0.052, dz * 0.448, d % 2 ? 0 : Math.PI / 2);
    }
  }
  return g;
}

// --- Alt geçit rampası: caddenin iç şeritleri beton duvarlı bir hendekle kavşağın altına iner,
// dış şeritler iki yanda yukarıda kalır. Kare, kavşak +z yönündeymiş gibi çizilir (sonra döndürülür).
const UNDER_DEPTH = UNDERPASS.depth;
const UNDER = {
  W: 0.19, // hendeğin iç yarı genişliği
  top: 0.052, // yolun üst yüzü
  concrete: new THREE.MeshStandardMaterial({ color: '#c9c6bf', roughness: 0.85 }),
  dark: new THREE.MeshStandardMaterial({ color: '#10141b', roughness: 1 }),
  rail: new THREE.MeshStandardMaterial({ color: '#8f9aa6', roughness: 0.4, metalness: 0.6 }),
};
const tunnelLamp = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffd27a', emissiveIntensity: 0.6 });
tunnelLamp.name = 'lamp';
// Hendeğin ağzı: şehrin zemini ve altındaki su burada çizilmez, böylece hendeğin içi görünür.
// Delik her şeyden önce şablon tamponuna (stencil) işaretlenir; zemin ve su o yerleri atlar (terrain.ts holeCut).
const HOLE_MAT = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
  depthTest: false,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilZPass: THREE.ReplaceStencilOp,
});
// Rampanın tabanı: kavşaktan uzak uçta yol hizasında, kavşağın kenarında derinde
const floorY = (z: number) => UNDER.top - UNDER_DEPTH * (z + 0.5);
function underRamp(dirToJunction: number) {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const { W, top } = UNDER;
  const T = 0.035; // duvar kalınlığı
  const wallTop = top + 0.03;
  // Yukarıda kalan dış şeritler (yan yol), kaldırım ve çizgiler
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.43 - (W + T), top + 0.03, 1), roadDeco.asphalt, s * ((W + T + 0.43) / 2), (top - 0.03) / 2, 0).castShadow = false;
    add(roadDeco.geo.curbC, roadDeco.stone, s * 0.465, 0.053, 0);
    add(roadDeco.geo.edge, roadDeco.paint, s * 0.39, 0.0525, 0);
    add(roadDeco.geo.edge, roadDeco.paint, s * (W + T + 0.012), 0.0525, 0);
  }
  // Duvarlar: tabanı rampayla iner, üstü yolun biraz üstünde; üstünde metal korkuluk
  const wallShape = new THREE.Shape([
    new THREE.Vector2(-0.5, floorY(-0.5) - 0.02),
    new THREE.Vector2(0.5, floorY(0.5) - 0.02),
    new THREE.Vector2(0.5, wallTop),
    new THREE.Vector2(-0.5, wallTop),
  ]);
  const wallGeo = new THREE.ExtrudeGeometry(wallShape, { depth: T, bevelEnabled: false }).rotateY(-Math.PI / 2);
  for (const s of [-1, 1]) {
    // Döndürülen şekil x'te 0..-T arasında; iç yüzü ±W'ye gelsin
    add(wallGeo, UNDER.concrete, s > 0 ? W + T : -W, 0, 0);
    add(new THREE.BoxGeometry(0.008, 0.008, 1), UNDER.rail, s * (W + T / 2), wallTop + 0.028, 0);
    for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.006, 0.028, 0.006), UNDER.rail, s * (W + T / 2), wallTop + 0.014, -0.375 + k * 0.25);
  }
  // Rampanın asfaltı ve çizgileri (ortada sarı çift çizgi, kenarlarda beyaz)
  const slope = Math.atan(UNDER_DEPTH);
  const len = Math.hypot(1, UNDER_DEPTH);
  const ramp = (w: number, x: number, m: THREE.Material, lift: number) => {
    const mesh = add(new THREE.BoxGeometry(w, 0.02, len), m, x, (floorY(-0.5) + floorY(0.5)) / 2 - 0.01 + lift, 0);
    mesh.rotation.x = slope;
    return mesh;
  };
  ramp(W * 2, 0, roadDeco.asphalt, 0).castShadow = false;
  for (const x of [-0.012, 0.012]) ramp(0.008, x, roadDeco.yellow, 0.0012);
  for (const s of [-1, 1]) ramp(0.008, s * (W - 0.02), roadDeco.paint, 0.0012);
  // Kavşağın altına giren tünelin ağzı: üstte beton alın, içi karanlık, tavanında lambalar
  const mouthTop = top - 0.04;
  const mouthBottom = floorY(0.5);
  const dark = add(new THREE.PlaneGeometry(W * 2, mouthTop - mouthBottom), UNDER.dark, 0, (mouthTop + mouthBottom) / 2, 0.5 - 0.002);
  dark.rotation.y = Math.PI;
  dark.castShadow = false;
  add(new THREE.BoxGeometry(W * 2 + T * 2, wallTop - mouthTop, 0.04), UNDER.concrete, 0, (wallTop + mouthTop) / 2, 0.48);
  for (const x of [-0.12, 0, 0.12]) add(new THREE.BoxGeometry(0.04, 0.008, 0.012), tunnelLamp, x, mouthTop - 0.01, 0.47).castShadow = false;
  g.rotation.y = Math.atan2(DIRS[dirToJunction][0], DIRS[dirToJunction][1]);
  return g;
}
// Alt geçidin kapalı karesi (uzatılmış alt geçitte düz cadde): iki yanda yukarıda kalan yan yollar, ortada
// tünelin üstü bordürlü çim refüj, havalandırma kapakları ve çalılar. İç şeritteki arabalar altta, görünmez.
// axis 0: yol kuzey-güney (z boyunca), 1: doğu-batı.
const COVER = {
  vent: new THREE.MeshStandardMaterial({ color: '#7d8590', roughness: 0.6, metalness: 0.4 }),
  slot: new THREE.MeshStandardMaterial({ color: '#2a2f38', roughness: 0.9 }),
};
function underCover(axis: number, seed: number) {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const { W, top } = UNDER;
  const T = 0.035, half = W + T;
  // Yan yollar, kaldırım ve çizgiler (rampadakiyle aynı)
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.43 - half, top + 0.03, 1), roadDeco.asphalt, s * ((half + 0.43) / 2), (top - 0.03) / 2, 0).castShadow = false;
    add(roadDeco.geo.curbC, roadDeco.stone, s * 0.465, 0.053, 0);
    add(roadDeco.geo.edge, roadDeco.paint, s * 0.39, 0.0525, 0);
    add(roadDeco.geo.edge, roadDeco.paint, s * (half + 0.012), 0.0525, 0);
    // Refüjün beton kenarı
    add(new THREE.BoxGeometry(0.02, top + 0.012, 1), UNDER.concrete, s * (half - 0.01), (top + 0.012) / 2, 0);
  }
  // Tünelin üstü: çim
  add(new THREE.BoxGeometry(half * 2 - 0.04, top + 0.008, 1), roadDeco.lawn, 0, (top + 0.008) / 2, 0).castShadow = false;
  // Havalandırma kapakları (ızgaralı) ve çalılar
  for (const z of [-0.28, 0.22]) {
    add(new THREE.BoxGeometry(0.12, 0.02, 0.09), COVER.vent, 0, top + 0.018, z);
    for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(0.1, 0.0035, 0.008), COVER.slot, 0, top + 0.0285, z - 0.034 + k * 0.017);
  }
  for (const [x, z] of [[-0.12, -0.05], [0.12, 0.02], [-0.1, 0.42], [0.11, -0.42]] as [number, number][]) g.add(prop(PROPS.bush, x, z, seed + x * 10, 0.55));
  if (axis === 1) g.rotation.y = Math.PI / 2;
  return g;
}

// Hendeğin ağzındaki "delik" (birleştirilmez, kendi çizim sırasıyla durur)
function underHole(dirToJunction: number) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(UNDER.W * 2, 1).rotateX(-Math.PI / 2), HOLE_MAT);
  mesh.position.y = UNDER.top + 0.0005;
  mesh.rotation.y = Math.atan2(DIRS[dirToJunction][0], DIRS[dirToJunction][1]);
  mesh.renderOrder = -3;
  mesh.castShadow = mesh.receiveShadow = false;
  return mesh;
}

// Menü resmi için: süslü düz yol parçası (grade: 0 yol, 1 bulvar, 2 cadde)
// Şehrin girişinden göbek kavşağa giden yolun şehir dışındaki kareleri: şehirdeki düz yolun aynısı (x doğrultusunda)
export function entranceTile(grade: number, along: number) {
  const g = new THREE.Group();
  const r = makeModel(ROAD_BASES[0][0]);
  r.rotation.y = Math.PI / 2;
  g.add(r);
  if (grade) g.add(roadExtras(grade, true, along, false, along * 7));
  else if (along % 3 === 0) g.add(streetLight(0, 0.46, -Math.PI / 2));
  return g;
}

export function gradedRoadModel(grade: number) {
  const g = new THREE.Group();
  g.add(makeModel(ROAD_BASES[0][0]));
  if (grade) g.add(roadExtras(grade, false, 1, false, 3));
  return g;
}

// Bir modeli kare merkezine göre (dx, dz) konumuna, verilen açıyla koy
function prop(path: string, dx: number, dz: number, rot = 0, scale = 1) {
  const o = makeModel(path);
  o.position.set(dx, 0, dz);
  o.rotation.y = rot;
  if (scale !== 1) o.scale.multiplyScalar(scale);
  return o;
}

// Boş arsaların zemin rengi
const lotGeo = new THREE.BoxGeometry(0.92, 0.03, 0.92);
const lotMats = {
  res: new THREE.MeshStandardMaterial({ color: '#8fd46f' }),
  com: new THREE.MeshStandardMaterial({ color: '#7cc3f2' }),
};

// Maskeyi k kere 90° döndür (three.js'te +90° doğuyu kuzeye çevirir)
function rotateMask(m: number, k: number) {
  let r = 0;
  for (let d = 0; d < 4; d++) if (m & (1 << d)) r |= 1 << ((d + 3 * k) % 4);
  return r;
}

const ROAD_TABLE = new Map<number, { model: string; k: number }>();
for (const [model, base] of ROAD_BASES) {
  for (let k = 0; k < 4; k++) {
    const m = rotateMask(base, k);
    if (!ROAD_TABLE.has(m)) ROAD_TABLE.set(m, { model, k });
  }
}

export function roadPiece(mask: number) {
  return ROAD_TABLE.get(mask) ?? { model: ROAD_BASES[0][0], k: mask & 0b1010 ? 1 : 0 };
}

// Binaların kapısı modelde güneye bakıyor; istenen yöne çevirmek için kaç tur
export const FACING_TURNS = [2, 1, 0, 3];

export const tileCenter = (x: number, z: number) => new THREE.Vector3(x - SIZE / 2 + 0.5, 0, z - Z0 + 0.5);
// Kare kenarlarının dünya koordinatı
const wx = (x: number) => x - SIZE / 2;
const wz = (z: number) => z - Z0;

type IconType = 'road' | 'power' | 'water' | 'upgrade' | 'full' | 'fire' | 'repair' | 'coin' | 'sale' | 'traffic';
const ICON_COLORS: Record<IconType, string> = {
  road: '#e53935', power: '#ffb300', water: '#1e88e5', upgrade: '#43a047', full: '#8e44ad',
  fire: '#ff5722', repair: '#607d8b', coin: '#f9a825', sale: '#00897b', traffic: '#d32f2f',
};

// Binaların üstünde çıkan simgeler: yol yok (!), elektrik yok (şimşek), su yok (damla),
// yükseltilebilir (yeşil ok), depo dolu (mor kutu)
function iconTexture(type: IconType) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = ICON_COLORS[type];
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#fff';
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = '#fff';
  g.beginPath();
  if (type === 'road') {
    g.fillRect(28, 14, 8, 24);
    g.arc(32, 46, 5, 0, Math.PI * 2);
  } else if (type === 'power') {
    // Şimşek
    g.moveTo(36, 10);
    g.lineTo(18, 36);
    g.lineTo(30, 36);
    g.lineTo(26, 54);
    g.lineTo(46, 26);
    g.lineTo(34, 26);
    g.lineTo(40, 10);
  } else if (type === 'upgrade') {
    // Yukarı ok
    g.moveTo(32, 10);
    g.lineTo(52, 32);
    g.lineTo(40, 32);
    g.lineTo(40, 52);
    g.lineTo(24, 52);
    g.lineTo(24, 32);
    g.lineTo(12, 32);
  } else if (type === 'fire') {
    // Alev
    g.moveTo(32, 10);
    g.bezierCurveTo(44, 24, 48, 34, 44, 44);
    g.bezierCurveTo(40, 54, 24, 54, 20, 44);
    g.bezierCurveTo(16, 34, 24, 28, 26, 20);
    g.bezierCurveTo(30, 28, 32, 26, 32, 10);
  } else if (type === 'repair') {
    // İngiliz anahtarı
    g.save();
    g.translate(32, 32);
    g.rotate(-Math.PI / 4);
    g.fillRect(-5, -6, 10, 26);
    g.arc(0, -12, 10, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ICON_COLORS.repair;
    g.fillRect(-4, -26, 8, 12);
    g.restore();
    g.fillStyle = '#fff';
  } else if (type === 'traffic') {
    // Trafik sıkışıklığı: araba
    g.fillRect(13, 30, 38, 13);
    g.moveTo(20, 30);
    g.lineTo(25, 19);
    g.lineTo(39, 19);
    g.lineTo(45, 30);
    g.fill();
    g.beginPath();
    g.fillStyle = ICON_COLORS.traffic;
    g.arc(22, 44, 5.5, 0, Math.PI * 2);
    g.arc(42, 44, 5.5, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.fillStyle = '#fff';
    g.arc(22, 44, 3.5, 0, Math.PI * 2);
    g.arc(42, 44, 3.5, 0, Math.PI * 2);
  } else if (type === 'sale') {
    // Artı işareti: satın alınabilir arazi
    g.fillRect(28, 14, 8, 36);
    g.fillRect(14, 28, 36, 8);
  } else if (type === 'coin') {
    // Para: içinde ₺ yazan altın
    g.font = 'bold 34px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('₺', 32, 34);
  } else if (type === 'full') {
    // Kutu
    g.fillRect(16, 24, 32, 26);
    g.fillStyle = ICON_COLORS.full;
    g.fillRect(28, 24, 8, 12);
    g.fillStyle = '#fff';
    g.moveTo(14, 22);
    g.lineTo(50, 22);
    g.lineTo(44, 14);
    g.lineTo(20, 14);
  } else {
    // Su damlası
    g.moveTo(32, 12);
    g.bezierCurveTo(32, 12, 16, 32, 16, 40);
    g.arc(32, 40, 16, Math.PI, 0, true);
    g.bezierCurveTo(48, 32, 32, 12, 32, 12);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const ICON_MATS = Object.fromEntries(
  (Object.keys(ICON_COLORS) as IconType[]).map(t => [t, new THREE.SpriteMaterial({ map: iconTexture(t), depthTest: false })]),
) as Record<IconType, THREE.SpriteMaterial>;

// Ürün resimleri (3D modelden çizilmiş, veri adresi); hazır ürün baloncuklarında kullanılır
const ITEM_PICS = new Map<string, string>();
const READY_MATS = new Map<MatId, THREE.SpriteMaterial>();
// Hazır ürün baloncuğu: beyaz konuşma balonu, içinde ürünün resmi (SimCity'deki gibi; dokununca depoya gelir)
function readyMat(mat: MatId) {
  let m = READY_MATS.get(mat);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const draw = (img?: HTMLImageElement) => {
    g.clearRect(0, 0, 128, 128);
    // Balon ve kuyruğu
    g.fillStyle = 'rgba(16,33,56,0.25)';
    g.beginPath();
    g.arc(64, 58, 50, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(64, 54, 48, 0, Math.PI * 2);
    g.moveTo(52, 96);
    g.lineTo(64, 122);
    g.lineTo(76, 96);
    g.fill();
    g.strokeStyle = '#34a853';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(64, 54, 45, 0, Math.PI * 2);
    g.stroke();
    if (img) g.drawImage(img, 22, 12, 84, 84);
    else {
      g.font = '54px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(MATERIALS[mat].icon, 64, 58);
    }
  };
  draw();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const src = ITEM_PICS.get(mat);
  if (src) {
    const img = new Image();
    img.onload = () => {
      draw(img);
      tex.needsUpdate = true;
    };
    img.src = src;
  }
  m = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  READY_MATS.set(mat, m);
  return m;
}
// Hazır ürünün 3D modeli: ürün yavaşça döner, altında parlayan yeşil halka (dokununca depoya gelir).
// Her ürünün modeli bir kere kurulur, sonra kopyalanır (geometri ve malzemeler ortak)
const READY_3D_MAX = 24; // bundan fazla hazır bina varsa kalanlarda baloncuk resmi
const READY_TEMPLATES = new Map<MatId, THREE.Object3D>();
const READY_RING = new THREE.TorusGeometry(0.42, 0.035, 8, 40).rotateX(-Math.PI / 2);
const READY_RING_MAT = new THREE.MeshStandardMaterial({ color: '#3fdc5a', emissive: '#3fdc5a', emissiveIntensity: 0.8 });
const READY_GLOW = new THREE.CircleGeometry(0.46, 32).rotateX(-Math.PI / 2);
const READY_GLOW_MAT = new THREE.MeshBasicMaterial({ color: '#fffbd0', transparent: true, opacity: 0.35, depthWrite: false });
function readyMarker(mat: MatId) {
  let tpl = READY_TEMPLATES.get(mat);
  if (!tpl) {
    tpl = makeItem(mat as ItemId);
    tpl.traverse(o => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    READY_TEMPLATES.set(mat, tpl);
  }
  const g = new THREE.Group();
  const item = tpl.clone();
  item.scale.setScalar(0.62);
  item.position.y = 0.06;
  g.add(item);
  const ring = new THREE.Mesh(READY_RING, READY_RING_MAT);
  g.add(ring);
  const glow = new THREE.Mesh(READY_GLOW, READY_GLOW_MAT);
  glow.position.y = -0.005;
  g.add(glow);
  return g;
}

// Boşta bekleyen fabrika ve dükkanın üstünde "Zz"
const IDLE_MAT = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 30px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = '#1f2d3d';
  g.fillStyle = '#ffffff';
  for (const [t, x, y, s] of [['Z', 24, 42, 30], ['z', 42, 22, 22]] as [string, number, number, number][]) {
    g.font = `bold ${s}px sans-serif`;
    g.strokeText(t, x, y);
    g.fillText(t, x, y);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: tex, depthTest: false, opacity: 0.9, transparent: true });
})();
const ICON_Y = 2.2;
const MAX_ICONS = 60;

// Yanan binanın üstünde titreyen alevler
const flameMats = [new THREE.MeshBasicMaterial({ color: '#ff6d00' }), new THREE.MeshBasicMaterial({ color: '#ffc400' })];
function flames() {
  const g = new THREE.Group();
  g.name = 'flames';
  for (let n = 0; n < 5; n++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.48, 6).translate(0, 0.24, 0), flameMats[n % 2]);
    c.position.set(Math.cos(n * 1.3) * 0.22, 0.6 + (n % 3) * 0.15, Math.sin(n * 1.3) * 0.22);
    g.add(c);
  }
  return g;
}

// Park: çardaklı bahçe, göletli park ya da oyun parkı (fun.ts)
function park(variant: number, x: number, z: number) {
  return makePark(variant, hash(x, z, 9));
}

// Nehir: iki uzun su şeridi ve kıyılarda toprak/kum şeritleri
const bankMat = new THREE.MeshStandardMaterial({ color: '#cdb98a', roughness: 1 });
// Nehrin denize karıştığı yer: nehir suyuyla aynı, denize doğru saydamlaşıp denize karışır
const mouthMat = riverMat.clone();
Object.assign(mouthMat, { vertexColors: true, transparent: true, depthWrite: false });

// Şehirdeki nehrin kıyıları (dünya koordinatında doğru parçaları): suyun rengi kıyıya uzaklığa göre
function riverBanks(): [number, number, number, number][] {
  const [a, b] = RIVER;
  const [ra, rb] = RIVER_ROWS;
  const top = wz(COAST_ROW);
  return [
    [wx(a), top, wx(a), wz(ra)], [wx(b + 1), top, wx(b + 1), wz(rb + 1)],
    [wx(0), wz(rb + 1), wx(b + 1), wz(rb + 1)], [wx(0), wz(ra), wx(a), wz(ra)],
  ];
}
function bankDist(x: number, z: number, banks: [number, number, number, number][]) {
  let d = Infinity;
  for (const [ax, az, bx, bz] of banks) {
    const cx = THREE.MathUtils.clamp(x, Math.min(ax, bx), Math.max(ax, bx));
    const cz = THREE.MathUtils.clamp(z, Math.min(az, bz), Math.max(az, bz));
    d = Math.min(d, Math.hypot(x - cx, z - cz));
  }
  return d;
}
function river() {
  const g = new THREE.Group();
  const [a, b] = RIVER;
  const [ra, rb] = RIVER_ROWS;
  const add = (w: number, d: number, x: number, z: number, m: THREE.Material, y: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), m);
    mesh.position.set(wx(x), y, wz(z));
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  // Su: doğu kolu (denizden köşeye) ve güney kolu (batıdan köşeye), şehir dışındaki nehirle aynı yükseklikte
  const banks = riverBanks();
  const water = (geo: THREE.BufferGeometry) => {
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let k = 0; k < p.count; k++) waterColor(bankDist(p.getX(k), p.getZ(k), banks), c).toArray(col, k * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(worldUV(geo), riverMat);
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  const plane = (w: number, d: number, x: number, z: number) =>
    new THREE.PlaneGeometry(w, d, Math.round(w * 2), Math.round(d * 2)).rotateX(-Math.PI / 2).translate(wx(x), RIVER_Y, wz(z));
  const s = COAST_ROW;
  water(plane(2, rb + 1 - s, a + 1, (rb + 1 + s) / 2));
  water(plane(a, 2, a / 2, ra + 1));
  // Ağız: nehir kumsalın kenarından deniz seviyesine iner, genişleyip denizin rengine karışarak kaybolur
  const rows: [number, number, number, number][] = [
    // [kıyıdan uzaklık, yükseklik, yarım genişlik, görünürlük]
    [0, RIVER_Y, 1, 1], [0.5, SEA_Y + 0.004, 1.1, 0.95], [1.4, SEA_Y + 0.004, 1.45, 0.6], [2.6, SEA_Y + 0.004, 1.9, 0.25], [3.8, SEA_Y + 0.004, 2.3, 0],
  ];
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const cx = wx(a + 1), z0 = wz(s);
  const edge = waterColor(0), mid = waterColor(1);
  rows.forEach(([d, y, h, alpha], k) => {
    // Her sırada üç köşe: kenarlar sığ, ortası koyu
    pos.push(cx - h, y, z0 - d, cx, y, z0 - d, cx + h, y, z0 - d);
    col.push(edge.r, edge.g, edge.b, alpha, mid.r, mid.g, mid.b, alpha, edge.r, edge.g, edge.b, alpha);
    if (k) {
      const o = (k - 1) * 3;
      for (const c of [0, 1]) idx.push(o + c, o + c + 1, o + c + 3, o + c + 3, o + c + 1, o + c + 4);
    }
  });
  const mouth = new THREE.BufferGeometry();
  mouth.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mouth.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  mouth.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  mouth.setIndex(idx);
  const mouthMesh = new THREE.Mesh(worldUV(mouth), mouthMat);
  mouthMesh.renderOrder = 0;
  g.add(mouthMesh);
  // Kıyı şeritleri
  add(0.12, ra - s, a + 0.06, (ra + s) / 2, bankMat, -0.004);
  add(0.12, rb + 1 - s, b + 0.94, (rb + 1 + s) / 2, bankMat, -0.004);
  add(a, 0.12, a / 2, ra + 0.06, bankMat, -0.004);
  add(b + 1, 0.12, (b + 1) / 2, rb + 0.94, bankMat, -0.004);
  return g;
}

// Köprü: yol/rayın kenarlarına korkuluk, altına ayak
const railMat = new THREE.MeshStandardMaterial({ color: '#e8e4dc' });
const pillarMat = new THREE.MeshStandardMaterial({ color: '#9a9690' });
export function bridge(mask: number) {
  const g = new THREE.Group();
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  // Bağlantı olmayan kenarlara korkuluk
  if (!(mask & 1)) add(1, 0.08, 0.04, 0, 0.09, -0.48, railMat);
  if (!(mask & 4)) add(1, 0.08, 0.04, 0, 0.09, 0.48, railMat);
  if (!(mask & 2)) add(0.04, 0.08, 1, 0.48, 0.09, 0, railMat);
  if (!(mask & 8)) add(0.04, 0.08, 1, -0.48, 0.09, 0, railMat);
  // Köprü ayağı ve gövde
  add(0.98, 0.04, 0.98, 0, -0.01, 0, pillarMat);
  add(0.16, 0.12, 0.16, 0, -0.06, 0, pillarMat);
  return g;
}

// Asma köprü: denizin üstündeki düz yolun iki ucunda kuleler, kulelerin tepesinden sarkan ana kablolar
// ve kablodan yola inen askı telleri. a, b: köprünün iki ucundaki karelerin ortası; along: köprünün yönü
const suspMat = new THREE.MeshStandardMaterial({ color: '#d0462f', roughness: 0.55, metalness: 0.2 });
// Kule tepesindeki uyarı ışığı (gece yanar)
const beaconMat = new THREE.MeshStandardMaterial({ color: '#ff5252', emissive: '#ff5252', emissiveIntensity: 0 });
beaconMat.name = 'lamp';
function suspension(a: THREE.Vector3, b: THREE.Vector3, tiles: number) {
  const g = new THREE.Group();
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, p: THREE.Vector3, rotY = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.copy(p);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    g.add(mesh);
  };
  const ang = Math.atan2(dir.x, dir.z);
  const height = 1.1 + tiles * 0.07;
  const inset = tiles >= 5 ? 1 : 0.3;
  const towerAt = [inset, len - inset];
  // Kuleler: iki ayak, iki kat kiriş, tepede gece yanan uyarı ışığı
  for (const d of towerAt) {
    const c = a.clone().addScaledVector(dir, d);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.07, height, 0.09), suspMat, c.clone().addScaledVector(side, s * 0.5).setY(height / 2 - 0.12), ang);
      add(new THREE.SphereGeometry(0.03, 8, 6), beaconMat, c.clone().addScaledVector(side, s * 0.5).setY(height - 0.08));
    }
    for (const y of [0.55, 0.93]) add(new THREE.BoxGeometry(1.07, 0.07, 0.07), suspMat, c.clone().setY(height * y - 0.12), ang + Math.PI / 2);
  }
  // Ana kablolar ve askılar
  const top = height - 0.16;
  const cableY = (d: number) => {
    if (d <= towerAt[0]) return THREE.MathUtils.lerp(0.06, top, d / Math.max(0.01, towerAt[0]));
    if (d >= towerAt[1]) return THREE.MathUtils.lerp(top, 0.06, (d - towerAt[1]) / Math.max(0.01, len - towerAt[1]));
    const t = (d - towerAt[0]) / (towerAt[1] - towerAt[0]);
    return 0.16 + (top - 0.16) * (2 * t - 1) ** 2; // aşağı sarkan eğri
  };
  for (const s of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 48; k++) {
      const d = (k / 48) * len;
      pts.push(a.clone().addScaledVector(dir, d).addScaledVector(side, s * 0.5).setY(cableY(d)));
    }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.014, 5), suspMat));
    for (let d = towerAt[0] + 0.25; d < towerAt[1] - 0.1; d += 0.25) {
      const h = cableY(d) - 0.06;
      if (h < 0.03) continue;
      add(new THREE.CylinderGeometry(0.004, 0.004, h, 4), suspMat, a.clone().addScaledVector(dir, d).addScaledVector(side, s * 0.5).setY(0.06 + h / 2));
    }
  }
  return g;
}

// Yükseltilmiş fabrika ve dükkanların önündeki tabela: seviyesi kadar altın yıldız
const signMats = {
  pole: new THREE.MeshStandardMaterial({ color: '#455a64', roughness: 0.6 }),
  plate: new THREE.MeshStandardMaterial({ color: '#1e5fbf', roughness: 0.5 }),
  star: new THREE.MeshStandardMaterial({ color: '#ffc928', emissive: '#7a5600', metalness: 0.4, roughness: 0.35 }),
};
function starSign(level: number, k: number) {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), signMats.pole, 0, 0.15);
  add(new THREE.BoxGeometry(0.06 + level * 0.045, 0.07, 0.012), signMats.plate, 0, 0.3);
  for (let s = 0; s < level; s++) add(new THREE.OctahedronGeometry(0.02, 0), signMats.star, (s - (level - 1) / 2) * 0.045, 0.3, 0.012);
  g.scale.setScalar(k);
  g.position.set(0.38, 0, 0.42);
  return g;
}

// İnşaat alanı: çit, iskele, (büyük binalarda) dönen vinç ve toz. n: kaç kare, h: binanın boyu
const siteMats = {
  scaffold: new THREE.MeshStandardMaterial({ color: '#d9a441', roughness: 0.6, metalness: 0.3 }),
  fence: new THREE.MeshStandardMaterial({ color: '#ff8f00', roughness: 0.8 }),
  white: new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.8 }),
  crane: new THREE.MeshStandardMaterial({ color: '#fbc02d', roughness: 0.6 }),
  net: new THREE.MeshStandardMaterial({ color: '#2e7d32', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
  dust: new THREE.MeshStandardMaterial({ color: '#d7ccc8', transparent: true, opacity: 0.6, depthWrite: false }),
};
function constructionSite(n: number, h: number) {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const half = n * 0.47, H = Math.max(0.3, h + 0.08);
  // Çit (turuncu-beyaz)
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(half * 2, 0.06, 0.015), s > 0 ? siteMats.fence : siteMats.white, 0, 0.03, s * half);
    add(new THREE.BoxGeometry(0.015, 0.06, half * 2), s > 0 ? siteMats.white : siteMats.fence, s * half, 0.03, 0);
  }
  // İskele: köşe direkleri, kat kat yatay borular, yeşil file
  const w = half * 0.9;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.014, H, 0.014), siteMats.scaffold, sx * w, H / 2, sz * w);
  for (let y = 0.15; y < H; y += 0.18) {
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(w * 2, 0.01, 0.01), siteMats.scaffold, 0, y, s * w);
      add(new THREE.BoxGeometry(0.01, 0.01, w * 2), siteMats.scaffold, s * w, y, 0);
    }
  }
  add(new THREE.PlaneGeometry(w * 2, H), siteMats.net, 0, H / 2, w);
  add(new THREE.PlaneGeometry(w * 2, H), siteMats.net, 0, H / 2, -w).rotation.y = Math.PI;
  // Vinç (yüksek ya da büyük binalarda)
  if (h > 0.7 || n > 1) {
    const ch = H + 0.45;
    const cx = half + 0.08, cz = -half + 0.1;
    add(new THREE.BoxGeometry(0.05, ch, 0.05), siteMats.crane, cx, ch / 2, cz);
    const jib = new THREE.Group();
    jib.position.set(cx, ch, cz);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(half * 2.4, 0.035, 0.035), siteMats.crane);
    arm.position.x = -half * 0.8;
    jib.add(arm);
    const weight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.07), siteMats.scaffold);
    weight.position.x = half * 0.35;
    jib.add(weight);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.4, 4), siteMats.scaffold);
    cable.position.set(-half * 1.4, -0.2, 0);
    jib.add(cable);
    g.add(jib);
    g.userData.jib = jib;
  }
  // Toz bulutları
  const dust: THREE.Mesh[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    dust.push(add(new THREE.SphereGeometry(0.08 + (k % 2) * 0.04, 8, 6), siteMats.dust, Math.cos(a) * half * 0.8, 0.06, Math.sin(a) * half * 0.8));
  }
  g.userData.dust = dust;
  return g;
}

// Yol önizlemesinin yarı saydam malzemeleri (asıl malzemenin kopyası)
const ghostMats = new Map<string, THREE.Material>();
function ghostify(obj: THREE.Object3D) {
  obj.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    let m = ghostMats.get(src.uuid);
    if (!m) {
      const c = src.clone();
      c.transparent = true;
      c.opacity = 0.82;
      c.depthWrite = false;
      c.emissive = new THREE.Color('#2e7d32');
      c.emissiveIntensity = 0.25;
      ghostMats.set(src.uuid, (m = c));
    }
    mesh.material = m;
    mesh.castShadow = false;
  });
  return obj;
}

export class CityView {
  readonly root = new THREE.Group();
  private objs = new Map<number, THREE.Object3D>();
  private tall = new Map<number, { x: number; z: number; half: number; top: number }>(); // binaların tepeleri (kamera için)
  private hidden = new Set<number>(); // üretim ekranında görüşü kapattığı için geçici gizlenen binalar
  private holes = new Map<number, THREE.Mesh>(); // alt geçit rampalarında zemindeki delikler
  private unders = new Set<number>(); // alt geçitli kavşaklar (değişince rampalar yeniden çizilir)
  private iconsOn = true; // binaların üstündeki simgeler görünsün mü (üretim ekranında gizlenir)
  private icons = new Map<string, THREE.Object3D>();
  cam: THREE.Camera | null = null; // hazır ürünler uzaktan da görünsün diye boyları kameraya göre ayarlanır
  private animated = new Set<THREE.Object3D>(); // türbin, santral, polis ışıkları
  private live = new Set<number>(); // ayrı çizilen kareler
  private chunks = new Map<number, THREE.Group>(); // birleştirilmiş bölgeler
  private dirty = new Set<number>(); // yeniden birleştirilecek bölgeler
  shadowDirty = true; // gölgeler yeniden çizilmeli mi
  private coverage: THREE.InstancedMesh;
  // Hizmet haritası: şehir beyazlaşır, hizmet alanı yeşil, binalar yeşil (hizmet var) ya da kırmızı (yok)
  private mapVeil: THREE.Mesh;
  private mapArea: THREE.InstancedMesh;
  private mapBldg: THREE.InstancedMesh;
  private pops: { obj: THREE.Object3D; t: number; i: number }[] = [];
  // Yapılmakta olan binalar: iskele içinde yerden yükselir
  private sites: { obj: THREE.Object3D; site: THREE.Group; t: number; i: number; scale: THREE.Vector3 }[] = [];
  private ghost = new THREE.Group(); // yol çizerken önizleme
  private preview: THREE.InstancedMesh;
  private tmp = new THREE.Object3D();
  private time = 0;
  private land = new THREE.Group(); // satılık arazilerin "+" işaretleri
  private spans = new THREE.Group(); // asma köprülerin kuleleri ve kabloları
  private landShade = new THREE.Group(); // satın alınmamış arazinin koyu örtüsü (sadece inşa ederken)
  private landMat = new THREE.MeshBasicMaterial({ color: '#1d3b24', transparent: true, opacity: 0.26, depthWrite: false });

  constructor(private city: City) {
    const geo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
    this.preview = new THREE.InstancedMesh(geo, mat, SIZE * ROWS);
    this.preview.count = 0;
    this.preview.renderOrder = 1;
    this.root.add(this.preview);

    // Hizmet binalarının kapsama alanı (renkli, yarı saydam kareler)
    this.coverage = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false }),
      SIZE * ROWS,
    );
    this.coverage.count = 0;
    this.coverage.renderOrder = 1;
    this.root.add(this.coverage);

    // Hizmet haritası: bütün ekranı açık griye boyayan örtü (saydam şeylerden sonra), üstünde renkli alan ve kutular
    this.mapVeil = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'void main() { gl_FragColor = vec4(0.93, 0.95, 0.97, 0.68); }',
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.mapVeil.frustumCulled = false;
    this.mapVeil.renderOrder = 900;
    this.mapVeil.visible = false;
    this.mapArea = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.42, depthWrite: false }),
      SIZE * ROWS,
    );
    this.mapBldg = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.62, depthWrite: false }),
      SIZE * ROWS,
    );
    this.mapArea.renderOrder = 950;
    this.mapBldg.renderOrder = 960;
    for (const m of [this.mapArea, this.mapBldg]) {
      m.count = 0;
      m.frustumCulled = false;
    }
    this.root.add(this.mapVeil, this.mapArea, this.mapBldg);
    this.root.add(this.land);
    this.root.add(river());
    this.root.add(this.spans);
    this.root.add(this.ghost);
  }

  // Satın alınmamış arazi parçalarını koyulaştır, satılık olanların ortasına "+" koy
  updateLand() {
    for (let c = 0; c < PLOTS * PLOT_ROWS; c++) this.dirty.add(c);
    this.land.clear();
    this.landShade.clear();
    this.land.add(this.landShade);
    const geo = new THREE.PlaneGeometry(PLOT, PLOT).rotateX(-Math.PI / 2);
    for (let p = 0; p < PLOTS * PLOT_ROWS; p++) {
      if (this.city.owned[p]) continue;
      const px = p % PLOTS, pz = Math.floor(p / PLOTS);
      const m = new THREE.Mesh(geo, this.landMat);
      m.position.set(wx((px + 0.5) * PLOT), 0.09, wz((pz + 0.5) * PLOT));
      m.renderOrder = 1;
      this.landShade.add(m);
      const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => this.city.owned[(pz + dz) * PLOTS + px + dx] === 1 && px + dx >= 0 && px + dx < PLOTS && pz + dz >= 0 && pz + dz < PLOT_ROWS);
      if (next) {
        const s = new THREE.Sprite(ICON_MATS.sale);
        s.position.set(m.position.x, 0.8, m.position.z);
        s.scale.setScalar(0.9);
        this.land.add(s);
      }
    }
  }

  // İnşa ederken satın alınmamış arazi koyulaşsın; gezerken doğal görünsün
  showLandShade(on: boolean) {
    this.landShade.visible = on;
  }

  setCity(city: City) {
    this.city = city;
    this.rebuildAll();
  }

  rebuildAll() {
    this.updateLand();
    for (const i of [...this.objs.keys()]) this.remove(i);
    this.unders = new Set();
    this.city.tiles.forEach((t, i) => t?.under !== undefined && this.unders.add(i));
    for (let i = 0; i < SIZE * ROWS; i++) this.build(i, false);
    this.updateSpans();
    for (let c = 0; c < PLOTS * PLOT_ROWS; c++) this.dirty.add(c);
    this.flush();
    this.updateIcons();
  }

  private chunkOf(i: number) {
    return Math.floor(Math.floor(i / SIZE) / PLOT) * PLOTS + Math.floor((i % SIZE) / PLOT);
  }

  // Değişen bölgeleri yeniden birleştir
  private flush() {
    for (const c of this.dirty) {
      const old = this.chunks.get(c);
      if (old) {
        this.root.remove(old);
        disposeMerged(old);
        this.chunks.delete(c);
      }
      const cx = (c % PLOTS) * PLOT, cz = Math.floor(c / PLOTS) * PLOT;
      const list: THREE.Object3D[] = [];
      for (let z = cz; z < cz + PLOT; z++) {
        for (let x = cx; x < cx + PLOT; x++) {
          const i = idx(x, z);
          const o = this.objs.get(i);
          if (o && !this.live.has(i) && !this.hidden.has(i)) list.push(o);
          else if (!this.city.tiles[i] && !isWater(i)) {
            const n = this.nature(i);
            if (n) list.push(n);
          }
        }
      }
      if (list.length) {
        const g = mergeStatic(list);
        g.matrixAutoUpdate = false; // bölge hiç kıpırdamaz
        this.root.add(g);
        this.chunks.set(c, g);
      }
    }
    if (this.dirty.size) this.shadowDirty = true;
    this.dirty.clear();
  }

  // Değişen kareleri ve yanlarındaki yolları yeniden çiz
  refresh(cells: number[], animate: boolean) {
    const all = new Set<number>();
    // Alt geçidi yapılan ya da kalkan kavşakların rampaları da yeniden çizilsin
    const unders = new Set<number>();
    this.city.tiles.forEach((t, i) => t?.under !== undefined && unders.add(i));
    const extra: number[] = [];
    for (const j of new Set([...unders, ...this.unders])) if (unders.has(j) !== this.unders.has(j)) extra.push(j);
    this.unders = unders;
    for (const i of [...cells, ...extra]) {
      all.add(i);
      const x = i % SIZE, z = Math.floor(i / SIZE);
      for (const [dx, dz] of DIRS) if (inBounds(x + dx, z + dz)) all.add(idx(x + dx, z + dz));
    }
    for (const i of all) this.build(i, animate && cells.includes(i));
    if (cells.some(i => isSeaXZ(i % SIZE, Math.floor(i / SIZE)))) this.updateSpans();
    this.updateIcons();
  }

  // Trafik haritası: yollar doluluğuna göre yeşil, sarı, kırmızı (yol aracı seçiliyken ya da yol kartı açıkken)
  private trafficOn = false;
  private trafficMap: THREE.InstancedMesh | null = null;
  showTraffic(on: boolean) {
    this.trafficOn = on;
    if (!this.trafficMap) {
      this.trafficMap = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.42, depthWrite: false }),
        SIZE * ROWS,
      );
      this.trafficMap.renderOrder = 1;
      this.root.add(this.trafficMap);
    }
    const m = this.trafficMap;
    m.count = 0;
    if (!on) return;
    const c = new THREE.Color();
    this.city.tiles.forEach((t, i) => {
      if (t?.kind !== 'road') return;
      const load = this.city.congestion(i);
      c.set(load > 1 ? '#e53935' : load > 0.6 ? '#fbc02d' : '#43a047');
      this.tmp.position.copy(tileCenter(i % SIZE, Math.floor(i / SIZE))).setY(0.09);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.scale.setScalar(1);
      this.tmp.updateMatrix();
      m.setMatrixAt(m.count, this.tmp.matrix);
      m.setColorAt(m.count++, c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  // Denizdeki düz yolları bul (en az 3 kare), her birine asma köprü kur
  updateSpans() {
    for (const c of this.spans.children) disposeMerged(c as THREE.Group);
    this.spans.clear();
    const sea = (x: number, z: number) => inBounds(x, z) && isSeaXZ(x, z) && this.city.isRoad(x, z);
    const parts: THREE.Object3D[] = [];
    const runs = (along: 'x' | 'z') => {
      const outer = along === 'z' ? SIZE : ROWS, inner = along === 'z' ? ROWS : SIZE;
      for (let o = 0; o < outer; o++) {
        let start = -1;
        for (let k = 0; k <= inner; k++) {
          const [x, z] = along === 'z' ? [o, k] : [k, o];
          // Köprü düz gitmeli: yoldan yana sapan kare köprüyü böler
          const ok = k < inner && sea(x, z) && (along === 'z' ? (this.city.roadMask(x, z) & 0b1010) === 0 : (this.city.roadMask(x, z) & 0b0101) === 0);
          if (ok && start < 0) start = k;
          if (!ok && start >= 0) {
            const n = k - start;
            if (n >= 3) {
              const [ax, az] = along === 'z' ? [o, start] : [start, o];
              const [bx, bz] = along === 'z' ? [o, k - 1] : [k - 1, o];
              const a = tileCenter(ax, az), b = tileCenter(bx, bz);
              const d = b.clone().sub(a).normalize().multiplyScalar(0.5);
              parts.push(suspension(a.sub(d), b.add(d), n));
            }
            start = -1;
          }
        }
      }
    };
    runs('z');
    runs('x');
    if (parts.length) this.spans.add(mergeStatic(parts));
    this.shadowDirty = true;
  }

  private remove(i: number) {
    const old = this.objs.get(i);
    if (!old) return;
    if (this.live.has(i)) {
      this.root.remove(old);
      this.live.delete(i);
    }
    this.animated.delete(old);
    this.objs.delete(i);
    this.tall.delete(i);
    this.hidden.delete(i);
    const hole = this.holes.get(i);
    if (hole) {
      this.root.remove(hole);
      this.holes.delete(i);
    }
    this.dirty.add(this.chunkOf(i));
  }

  // Hedeften kameraya giden çizginin (yukarıdan bakınca) üstündeki yüksek binalar: görüşü kapatmamak için
  // kameranın en az ne kadar dik bakması gerektiği (eğim, tan). Engel yoksa 0. skip: bakılan binanın kendisi
  // slope: kameranın baktığı eğim (tan); bu çizginin üstüne çıkan binalar listelenir
  blockers(tx: number, tz: number, ty: number, dx: number, dz: number, len: number, slope: number, skip: number) {
    const out: number[] = [];
    for (const [i, b] of this.tall) {
      if (i === skip) continue;
      const s = (b.x - tx) * dx + (b.z - tz) * dz;
      if (s <= 0 || s - b.half > len + 0.3) continue;
      const off = Math.abs((b.x - tx) * dz - (b.z - tz) * dx);
      if (off > b.half + 0.45) continue;
      if (b.top + 0.1 > ty + Math.max(0, s - b.half) * slope) out.push(i);
    }
    return out;
  }

  // Görüşü kapatan binaları geçici gizle (boş liste: hepsi geri gelir)
  setHidden(tiles: number[]) {
    const next = new Set(tiles);
    for (const i of new Set([...this.hidden, ...next])) {
      if (this.hidden.has(i) === next.has(i)) continue;
      const o = this.objs.get(i);
      if (o && this.live.has(i)) o.visible = !next.has(i);
      this.dirty.add(this.chunkOf(i));
    }
    this.hidden = next;
    this.flush();
  }

  // Bu noktanın yakınındaki en yüksek binanın tepesi (kamera kulelerin içine girmesin diye; yoksa 0)
  topNear(x: number, z: number, reach = 0.4) {
    let top = 0;
    for (const [i, b] of this.tall) {
      if (this.hidden.has(i) || b.top < 1.2) continue;
      const dx = Math.max(0, Math.abs(x - b.x) - b.half), dz = Math.max(0, Math.abs(z - b.z) - b.half);
      if (dx * dx + dz * dz < reach * reach) top = Math.max(top, b.top);
    }
    return top;
  }

  private build(i: number, animate: boolean) {
    this.remove(i);
    const t = this.city.tiles[i];
    if (!t || t.kind === 'part') return; // büyük binaların diğer kareleri ana karede çizilir
    const x = i % SIZE, z = Math.floor(i / SIZE);
    let o: THREE.Object3D;
    if (t.kind === 'road') {
      o = this.road(x, z);
      if (isWaterXZ(x, z)) o.add(bridge(this.city.roadMask(x, z)));
      // Hemzemin geçit: yolun üstünden yola dik raylar geçer
      if (t.level === 1) {
        const across = railPiece(this.city.roadMask(x, z) === 0b0101 ? 0b1010 : 0b0101, false);
        across.position.y = 0.03;
        o.add(across);
      }
    } else if (t.kind === 'rail') {
      o = railPiece(this.city.railMask(x, z));
      if (isWaterXZ(x, z)) o.add(bridge(this.city.railMask(x, z)));
    } else if (t.kind === 'park') {
      o = park(t.variant, x, z);
    } else if (isUtility(t.kind)) {
      // Yükseltilmiş yapı: yeni parçalar eklenmiş model ve yıldızlı tabela
      o = makeUtility(t.kind, t.level);
      if (t.level > 0) {
        const w = new THREE.Group();
        w.add(o);
        w.add(starSign(t.level, 1 / ((t.fp ?? 1) * 0.96)));
        w.userData = o.userData;
        o = w;
      }
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
    } else if (t.kind === 'hall') {
      o = makeHall();
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
    } else if (isService(t.kind)) {
      o = makeService(t.kind);
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
    } else if (isDecor(t.kind)) {
      o = t.kind === 'parking' && t.level > 0 ? parkingGarage(t.level) : t.kind === 'metro' ? metro(t.level) : makeDecor(t.kind);
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
      if ((t.kind === 'parking' || t.kind === 'metro') && t.level > 0) o.add(starSign(t.level, 1));
    } else if (isIndustry(t.kind)) {
      o = makeIndustry(t.kind, t.variant);
      o.rotation.y = (FACING_TURNS[t.facing] * Math.PI) / 2;
      if (t.level > 0) o.add(starSign(t.level, 1 / ((t.fp ?? 1) * 0.96)));
    } else if (t.level === 0) {
      // Boş arsa: bölge renginde zemin ve birkaç inşaat kasası
      o = new THREE.Group();
      const plate = new THREE.Mesh(lotGeo, lotMats[t.kind]);
      plate.position.y = 0.015;
      plate.receiveShadow = true;
      o.add(plate);
      const kind = hash(x, z, 3);
      if (kind < 0.4) o.add(prop(hash(x, z, 4) < 0.5 ? PROPS.boxA : PROPS.boxB, (hash(x, z, 5) - 0.5) * 0.5, (hash(x, z, 6) - 0.5) * 0.5, hash(x, z, 7) * 6));
      else if (kind < 0.75) {
        // İnşaat alanı: bariyer ve koniler
        o.add(prop(PROPS.barrier, 0, 0.3));
        for (const dx of [-0.3, 0.3]) o.add(prop(PROPS.cone, dx, -0.25));
        if (kind < 0.55) o.add(prop(PROPS.workLight, -0.3, 0.05, 1));
      }
    } else {
      o = this.building(t.kind, t.level, t.variant, t.facing);
      if (t.fire) {
        // Alevler çatının üstünde yansın
        const top = new THREE.Box3().setFromObject(o).max.y;
        const fl = flames();
        fl.position.y = top - 0.65;
        o.add(fl);
      }
      // Depremde hasar gören bina biraz eğilsin
      if (t.damaged) o.children[0].rotation.z = 0.08;
    }

    // Büyük binalar: modeli büyüt ve kapladığı alanın ortasına koy
    const n = t.fp ?? 1;
    if (n > 1) {
      const wrap = new THREE.Group();
      o.scale.multiplyScalar(n * 0.96);
      wrap.add(o);
      wrap.userData = o.userData;
      o = wrap;
    }
    o.position.add(tileCenter(x + (n - 1) / 2, z + (n - 1) / 2));
    this.objs.set(i, o);
    // Alt geçit rampası: zemindeki delik ayrı çizilir (birleştirilmez)
    const ramp = t.kind === 'road' ? this.city.rampOf(i) : null;
    if (ramp) {
      const hole = underHole(ramp.dir);
      hole.position.add(tileCenter(x, z));
      this.root.add(hole);
      this.holes.set(i, hole);
    }
    // Yüksek binalar (gökdelenler, kuleler): kamera bunların tepesinin altına inmesin
    if (t.kind !== 'road' && t.kind !== 'rail' && t.kind !== 'park') {
      const top = new THREE.Box3().setFromObject(o).max.y;
      if (top > 0.45) this.tall.set(i, { x: o.position.x, z: o.position.z, half: n / 2, top });
    }
    this.dirty.add(this.chunkOf(i));
    const moving = needsLive(o);
    if (moving) this.animated.add(o);
    if (moving || animate) {
      this.root.add(o);
      this.live.add(i);
    }
    if (animate) {
      const building = t.kind !== 'road' && t.kind !== 'rail' && t.kind !== 'park' && !(isZone(t.kind) && t.level === 0);
      if (building) {
        // İnşaat: bina iskelenin içinde yerden yükselir
        this.sites = this.sites.filter(s => {
          if (s.i !== i) return true;
          this.root.remove(s.site);
          return false;
        });
        const box = new THREE.Box3().setFromObject(o);
        const site = constructionSite(n, box.max.y);
        site.position.copy(o.position);
        site.scale.y = 0.01;
        this.root.add(site);
        this.sites.push({ obj: o, site, t: 0, i, scale: o.scale.clone() });
        o.scale.y *= 0.02;
      } else {
        o.scale.setScalar(0.01);
        this.pops.push({ obj: o, t: 0, i });
      }
    }
  }

  // Yol çizerken: çizilecek yolun parçaları yarı saydam görünür (grade: 0 yol, 1 bulvar, 2 cadde)
  showRoadPreview(cells: number[], grade: number) {
    this.ghost.clear();
    if (!cells.length) return;
    const set = new Set(cells);
    const isRoadAt = (x: number, z: number) => inBounds(x, z) && (this.city.isRoad(x, z) || set.has(idx(x, z)));
    for (const i of cells) {
      const x = i % SIZE, z = Math.floor(i / SIZE);
      let mask = 0;
      DIRS.forEach(([dx, dz], d) => {
        if (isRoadAt(x + dx, z + dz)) mask |= 1 << d;
      });
      const p = roadPiece(mask);
      const g = new THREE.Group();
      const r = makeModel(p.model);
      r.rotation.y = (p.k * Math.PI) / 2;
      g.add(r);
      const straight = p.model === ROAD_BASES[0][0];
      const alongX = straight && (mask & 0b1010) !== 0 && (mask & 0b0101) === 0;
      if (grade && straight) g.add(roadExtras(grade, alongX, alongX ? x : z, false, 3));
      g.position.copy(tileCenter(x, z)).setY(0.012);
      this.ghost.add(ghostify(g));
    }
  }

  // Yol karesi: yön ve kavşak türü komşulara göre; kenarlarda sokak lambası, kavşakta trafik ışığı
  private road(x: number, z: number) {
    const g = new THREE.Group();
    const mask = this.city.roadMask(x, z);
    const p = roadPiece(mask);
    const straight = p.model === ROAD_BASES[0][0];
    const alongX = straight && (mask & 0b1010) !== 0 && (mask & 0b0101) === 0;
    // Kavşağa bitişik düz yollarda yaya geçidi
    const nearJunction = straight && DIRS.some(([dx, dz]) => {
      const m = this.city.isRoad(x + dx, z + dz) ? this.city.roadMask(x + dx, z + dz) : 0;
      return [1, 2, 4, 8].filter(b => m & b).length >= 3;
    });
    const deadEnd = [1, 2, 4, 8].includes(mask) && !(x === 0 && z === ENTRANCE_Z);
    const grade = this.city.get(x, z)?.grade ?? 0;
    // Alt geçidin rampası: iç şeritler hendekle kavşağın altına iner
    const ramp = this.city.rampOf(idx(x, z));
    if (ramp) {
      g.add(underRamp(ramp.dir));
      return g;
    }
    // Uzatılmış alt geçidin kapalı düz karesi
    const cover = this.city.get(x, z)?.under;
    if (cover !== undefined && straight) {
      g.add(underCover(cover, Math.floor(hash(x, z, 9) * 100)));
      return g;
    }
    if (deadEnd) {
      // Çıkmaz sokak: yarım yol ve yuvarlak dönüş meydanı (lamba ve süs yok)
      g.add(culDeSac(mask, grade));
      return g;
    }
    const r = makeModel(nearJunction ? 'proc/road-crossing' : p.model);
    r.rotation.y = (p.k * Math.PI) / 2;
    g.add(r);
    if (straight && grade) g.add(roadExtras(grade, alongX, alongX ? x : z, nearJunction, Math.floor(hash(x, z, 5) * 1000)));
    if (straight && !grade && !nearJunction) g.add(streetDetails(x, z, alongX));
    if (straight) {
      const along = alongX ? x : z;
      const side = hash(x, z) < 0.5 ? 1 : -1;
      // Lambanın kolu yola doğru uzansın (bulvarda lambalar refüjde)
      if (grade === 0 && along % 3 === 0) {
        if (alongX) g.add(streetLight(0, side * 0.46, side > 0 ? -Math.PI / 2 : Math.PI / 2));
        else g.add(streetLight(side * 0.46, 0, side > 0 ? 0 : Math.PI));
      } else if (grade === 0 && along % 5 === 1 && hash(x, z, 2) < 0.6) {
        if (alongX) g.add(prop(PROPS.hydrant, 0.2, -side * 0.45));
        else g.add(prop(PROPS.hydrant, -side * 0.45, 0.2));
      }
    } else if (p.model === 'proc/road-junction' || p.model === 'proc/road-tsplit') {
      g.add(signalPost(idx(x, z), mask));
    }
    if (!straight && grade) g.add(junctionExtras(grade, mask));
    return g;
  }

  // Seviyeye göre bina: model rastgele sayıdan seçilir (bütün evler ve kuleler kodla çizilir)
  private building(kind: 'res' | 'com', level: number, variant: number, facing: number) {
    const models = (kind === 'res' ? RES_LEVELS : COM_LEVELS)[level - 1].models;
    const path = models[variant % models.length];
    const group = new THREE.Group();
    const b = makeModel(path);
    b.rotation.y = (FACING_TURNS[facing] * Math.PI) / 2;
    group.add(b);
    return group;
  }

  // Boş karelerde ağaç ve çalı (şehir boş görünmesin); satın alınmamış arazide daha sık
  private nature(i: number): THREE.Object3D | null {
    const x = i % SIZE, z = Math.floor(i / SIZE);
    const owned = this.city.isOwned(i);
    // Kumsalda arada bir palmiye
    if (isSandXZ(x, z)) {
      if (hash(x, z, 9) > 0.22) return null;
      const o = palm((hash(x, z, 11) - 0.5) * 0.5, (hash(x, z, 12) - 0.5) * 0.4, 0.26 + hash(x, z, 14) * 0.12, (hash(x, z, 13) - 0.5) * 0.4);
      o.rotation.y = hash(x, z, 10) * 6;
      o.position.add(tileCenter(x, z));
      return o;
    }
    if (hash(x, z, 9) > (owned ? 0.16 : 0.32)) return null;
    const pick = hash(x, z, 10);
    const path = pick < 0.4 ? PROPS.treeLarge : pick < 0.58 ? PROPS.treeSmall : pick < 0.72 ? PROPS.treePine : pick < 0.76 ? PROPS.treeBlossom : PROPS.bush;
    const o = prop(path, (hash(x, z, 11) - 0.5) * 0.5, (hash(x, z, 12) - 0.5) * 0.5, hash(x, z, 13) * 6, 0.8 + hash(x, z, 14) * 0.5);
    o.position.add(tileCenter(x, z));
    return o;
  }

  // Binaların üstündeki simgeleri göster/gizle (üretim ekranında yakın planı kapatmasınlar)
  showIcons(on: boolean) {
    this.iconsOn = on;
    for (const s of this.icons.values()) s.visible = on;
  }

  // Ürün resimlerini al (hazır ürün baloncukları bunlarla çizilir)
  setItemPics(pics: Map<string, string>) {
    for (const [k, v] of pics) ITEM_PICS.set(k, v);
    for (const m of READY_MATS.values()) m.map?.dispose();
    READY_MATS.clear();
    for (const [key, s] of this.icons) {
      if (!key.includes('|ready|')) continue;
      this.root.remove(s);
      this.icons.delete(key);
    }
    this.updateIcons();
  }

  // Ekranda bu noktaya dokununca hangi binanın hazır ürün baloncuğu var? (yoksa null)
  readyBubbleAt(x: number, y: number, camera: THREE.Camera, rect: DOMRect): number | null {
    let best: number | null = null, bestD = Infinity;
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    for (const s of this.icons.values()) {
      if (s.userData.ready === undefined) continue;
      p.copy(s.position).project(camera);
      if (p.z > 1) continue;
      const sx = rect.left + ((p.x + 1) / 2) * rect.width, sy = rect.top + ((1 - p.y) / 2) * rect.height;
      // Baloncuğun ya da 3D ürünün ekrandaki yarıçapı (uzaklığa göre)
      q.copy(s.position).addScaledVector(camera.up, s.scale.y * (s.userData.foot ? 0.6 : 0.5)).project(camera);
      const r = Math.max(22, Math.abs(q.y - p.y) * rect.height * 0.5 * 1.1);
      const d = Math.hypot(x - sx, y - sy);
      if (d < r && d < bestD) {
        bestD = d;
        best = s.userData.ready as number;
      }
    }
    return best;
  }

  // Binaların üstündeki simgeleri güncelle (sorunlar, yükseltme, depo dolu)
  updateIcons() {
    if (this.trafficOn) this.showTraffic(true);
    const want = new Map<string, { i: number; type: IconType; slot: number }>();
    const now = Date.now();
    // Hazır ürünler: binanın üstünde ürünün resmi olan baloncuk (dokununca depoya gelir); boştakilerde "Zz"
    const extra = new Map<string, { i: number; mat: MatId | null }>();
    for (const i of this.city.waiting(now)) {
      const mat = this.city.readyAt(i, now)[0];
      extra.set(`${i}|ready|${mat}`, { i, mat });
    }
    this.city.tiles.forEach((t, i) => {
      if (t && (MAKERS as string[]).includes(t.kind) && !this.city.jobs.has(i) && this.city.isConnected(i)) extra.set(`${i}|idle`, { i, mat: null });
      if (t?.kind === 'factory') {
        const obj = this.objs.get(i);
        if (obj) setWorking(obj, (this.city.jobs.get(i) ?? []).some(j => j.end > now));
      }
      if (t?.kind === 'hall' && this.city.treasury >= 1) want.set(`${i}|coin`, { i, type: 'coin', slot: 0 });
      // Tıkalı yollar (birkaç karede bir simge yeter)
      if (t?.kind === 'road' && ((i % SIZE) + Math.floor(i / SIZE)) % 3 === 0 && this.city.congestion(i) > 1) {
        want.set(`${i}|traffic`, { i, type: 'traffic', slot: 0 });
      }
      if (!t || !isZone(t.kind) || t.level === 0) return;
      if (t.fire) {
        want.set(`${i}|fire`, { i, type: 'fire', slot: 0 });
        return;
      }
      if (t.damaged) {
        want.set(`${i}|repair`, { i, type: 'repair', slot: 0 });
        return;
      }
      if (this.city.canUpgrade(i)) {
        want.set(`${i}|upgrade`, { i, type: 'upgrade', slot: 0 });
        return;
      }
      if (!this.city.isConnected(i)) {
        want.set(`${i}|road`, { i, type: 'road', slot: 0 });
        return;
      }
      const lack = this.city.lacking.get(i);
      if (lack?.power) want.set(`${i}|power`, { i, type: 'power', slot: 0 });
      if (lack?.water) want.set(`${i}|water`, { i, type: 'water', slot: lack.power ? 1 : 0 });
    });
    // Çok fazla simge telefonu yavaşlatır: en önemli 60 tanesi gösterilsin
    const ORDER: IconType[] = ['fire', 'road', 'traffic', 'repair', 'full', 'coin', 'power', 'water', 'upgrade'];
    if (want.size > MAX_ICONS) {
      const keep = [...want].sort((a, b) => ORDER.indexOf(a[1].type) - ORDER.indexOf(b[1].type)).slice(0, MAX_ICONS);
      want.clear();
      for (const [k, v] of keep) want.set(k, v);
    }
    for (const [key, s] of this.icons) {
      if (!want.has(key) && !extra.has(key)) {
        this.root.remove(s);
        this.icons.delete(key);
      }
    }
    for (const [key, { i, type, slot }] of want) {
      if (this.icons.has(key)) continue;
      const s = new THREE.Sprite(ICON_MATS[type]);
      s.position.copy(tileCenter(i % SIZE, Math.floor(i / SIZE)));
      const t = this.city.tiles[i];
      // Yükseltme oku binanın üstünde dursun, uyarılar sabit yükseklikte
      const top = (type === 'upgrade' || type === 'fire' || type === 'repair') && t ? 1 + t.level * 0.45 : type === 'full' || type === 'coin' ? 1.25 : ICON_Y;
      s.userData.y = top + slot * 0.55;
      s.userData.phase = (i * 0.37) % (Math.PI * 2);
      s.scale.setScalar(type === 'upgrade' ? 0.42 : type === 'traffic' ? 0.42 : 0.5);
      s.renderOrder = 2;
      s.visible = this.iconsOn;
      this.root.add(s);
      this.icons.set(key, s);
    }
    // Hazır ürün baloncukları ve "Zz": büyük binada ortada, binanın tepesinin biraz üstünde
    let shown3d = 0;
    for (const [key, { i, mat }] of extra) {
      if (this.icons.has(key)) {
        if (mat && this.icons.get(key)!.userData.foot) shown3d++;
        continue;
      }
      const n = this.city.tiles[i]?.fp ?? 1;
      // Hazır ürün: ürünün gerçekçi 3D modeli binanın üstünde döner (çok fazlaysa baloncuk resmi)
      const use3d = !!mat && shown3d < READY_3D_MAX;
      if (use3d) shown3d++;
      const s: THREE.Object3D = use3d ? readyMarker(mat!) : new THREE.Sprite(mat ? readyMat(mat) : IDLE_MAT);
      s.position.copy(tileCenter((i % SIZE) + (n - 1) / 2, Math.floor(i / SIZE) + (n - 1) / 2));
      const top = this.tall.get(i)?.top ?? 0.45;
      s.userData.y = use3d ? top + 0.25 : (mat ? 1.05 : 0.95) + (n - 1) * 0.35;
      s.userData.phase = (i * 0.37) % (Math.PI * 2);
      s.userData.ready = mat ? i : undefined;
      if (use3d) s.userData.foot = 0.45 + n * 0.12;
      s.scale.setScalar(use3d ? s.userData.foot : mat ? 0.62 : 0.34);
      s.renderOrder = 2;
      s.visible = this.iconsOn;
      this.root.add(s);
      this.icons.set(key, s);
    }
  }

  // Seçili binanın altını sarı renkle işaretle
  showSelection(cells: number[]) {
    this.showPreview(cells.map(i => ({ i, ok: true })), '#ffd54a');
  }

  showPreview(cells: { i: number; ok: boolean }[], color = '#4caf50') {
    const okColor = new THREE.Color(color);
    const badColor = new THREE.Color('#e53935');
    cells.forEach(({ i, ok }, n) => {
      this.tmp.position.copy(tileCenter(i % SIZE, Math.floor(i / SIZE))).setY(0.08);
      this.tmp.updateMatrix();
      this.preview.setMatrixAt(n, this.tmp.matrix);
      this.preview.setColorAt(n, ok ? okColor : badColor);
    });
    this.preview.count = cells.length;
    this.preview.instanceMatrix.needsUpdate = true;
    if (this.preview.instanceColor) this.preview.instanceColor.needsUpdate = true;
  }

  // --- Bina taşınırken: birleşik bölgeden çıkar, havaya kalkar ve parmağı izler ---
  private lifted: { i: number; obj: THREE.Object3D; pos: THREE.Vector3; rot: number; wasLive: boolean } | null = null;
  startMove(i: number) {
    const o = this.objs.get(i);
    if (!o) return;
    const wasLive = this.live.has(i);
    if (!wasLive) {
      this.live.add(i);
      this.root.add(o);
      this.dirty.add(this.chunkOf(i));
    }
    this.lifted = { i, obj: o, pos: o.position.clone(), rot: o.rotation.y, wasLive };
    o.position.y += 0.3;
    this.shadowDirty = true;
  }
  // cx, cz: binanın yeni ortasının kare koordinatı (büyük binada kesirli)
  moveLifted(cx: number, cz: number) {
    const l = this.lifted;
    if (!l) return;
    const p = tileCenter(cx, cz);
    l.obj.position.set(p.x, l.pos.y + 0.3, p.z);
    this.shadowDirty = true;
  }
  // Kalkan binayı çeyrek tur döndür (turns: kaç kez saat yönünde)
  turnLifted(turns: number) {
    const l = this.lifted;
    if (!l) return;
    l.obj.rotation.y = l.rot - (turns * Math.PI) / 2;
    this.shadowDirty = true;
  }
  // moved: taşındıysa yeni yerinde yeniden çizilir (refresh); taşınmadıysa eski yerine iner
  endMove(moved: boolean) {
    const l = this.lifted;
    if (!l) return;
    this.lifted = null;
    this.shadowDirty = true;
    if (moved) return;
    l.obj.position.copy(l.pos);
    l.obj.rotation.y = l.rot;
    if (!l.wasLive && this.objs.get(l.i) === l.obj) {
      this.root.remove(l.obj);
      this.live.delete(l.i);
      this.dirty.add(this.chunkOf(l.i));
    }
  }

  // Hizmet haritasını göster (null: kapat). area: hizmetin ulaştığı kareler; bldgs: renklendirilecek binalar
  showServiceMap(map: { area: number[]; color: string; bldgs: { i: number; ok: boolean }[] } | null) {
    this.mapVeil.visible = !!map;
    this.mapArea.count = 0;
    this.mapBldg.count = 0;
    if (!map) return;
    const c = new THREE.Color(map.color);
    map.area.forEach((i, n) => {
      this.tmp.position.copy(tileCenter(i % SIZE, Math.floor(i / SIZE))).setY(0.05);
      this.tmp.updateMatrix();
      this.mapArea.setMatrixAt(n, this.tmp.matrix);
      this.mapArea.setColorAt(n, c);
    });
    this.mapArea.count = map.area.length;
    const okColor = new THREE.Color('#3fcf4a');
    const badColor = new THREE.Color('#ff3b30');
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    let n = 0;
    for (const { i, ok } of map.bldgs) {
      const o = this.objs.get(i);
      if (!o) continue;
      o.updateMatrixWorld(true);
      box.setFromObject(o);
      if (box.isEmpty()) continue;
      box.getSize(size);
      this.tmp.position.set((box.min.x + box.max.x) / 2, Math.max(0, box.min.y), (box.min.z + box.max.z) / 2);
      this.tmp.scale.set(size.x * 1.03 + 0.02, Math.max(0.05, box.max.y) * 1.02 + 0.01, size.z * 1.03 + 0.02);
      this.tmp.updateMatrix();
      this.mapBldg.setMatrixAt(n, this.tmp.matrix);
      this.mapBldg.setColorAt(n, ok ? okColor : badColor);
      n++;
    }
    this.tmp.scale.set(1, 1, 1);
    this.mapBldg.count = n;
    for (const m of [this.mapArea, this.mapBldg]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  showCoverage(cells: number[], color: string) {
    const c = new THREE.Color(color);
    cells.forEach((i, n) => {
      this.tmp.position.copy(tileCenter(i % SIZE, Math.floor(i / SIZE))).setY(0.07);
      this.tmp.updateMatrix();
      this.coverage.setMatrixAt(n, this.tmp.matrix);
      this.coverage.setColorAt(n, c);
    });
    this.coverage.count = cells.length;
    this.coverage.instanceMatrix.needsUpdate = true;
    if (this.coverage.instanceColor) this.coverage.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    this.time += dt;
    // İnşaat: iskele kurulur, bina yükselir, iskele sökülür (toz kalkar, vinç döner)
    if (this.sites.length) this.shadowDirty = true;
    this.sites = this.sites.filter(s => {
      s.t = Math.min(1, s.t + dt / 2);
      const e = (a: number, b: number) => THREE.MathUtils.smoothstep(s.t, a, b);
      s.site.scale.y = Math.max(0.01, e(0, 0.15) * (1 - e(0.86, 1)));
      s.obj.scale.set(s.scale.x, s.scale.y * Math.max(0.02, e(0.12, 0.85)), s.scale.z);
      const jib = s.site.userData.jib as THREE.Object3D | undefined;
      if (jib) jib.rotation.y = Math.sin(this.time * 0.8 + s.i) * 1.2;
      (s.site.userData.dust as THREE.Mesh[]).forEach((d, k) => {
        const p = (this.time * 0.9 + k * 0.37) % 1;
        d.scale.setScalar(0.6 + p * 0.8);
        d.position.y = 0.05 + p * 0.25;
      });
      if (s.t < 1) return true;
      this.root.remove(s.site);
      s.obj.scale.copy(s.scale);
      if (this.objs.get(s.i) === s.obj && !needsLive(s.obj)) {
        this.root.remove(s.obj);
        this.live.delete(s.i);
        this.dirty.add(this.chunkOf(s.i));
      }
      return false;
    });
    // Yeni yollar ve parklar "zıplayarak" ortaya çıksın; bitince bölgesiyle birleştirilsin
    if (this.pops.length) this.shadowDirty = true;
    this.pops = this.pops.filter(p => {
      p.t = Math.min(1, p.t + dt / 0.35);
      const s = 1 + 2.7 * Math.pow(p.t - 1, 3) + 1.7 * Math.pow(p.t - 1, 2);
      p.obj.scale.setScalar(Math.max(0.01, s));
      if (p.t < 1) return true;
      if (this.objs.get(p.i) === p.obj && !needsLive(p.obj)) {
        this.root.remove(p.obj);
        this.live.delete(p.i);
        this.dirty.add(this.chunkOf(p.i));
      }
      return false;
    });
    this.flush();
    // Uyarı simgeleri hafifçe zıplasın
    for (const s of this.icons.values()) {
      s.position.y = s.userData.y + Math.sin(this.time * 3 + s.userData.phase) * 0.06;
      // 3D hazır ürün: yavaşça döner; harita ne kadar uzaktan görünürse görünsün en az binası kadar, ekranda da seçilecek boyda kalır
      if (s.userData.foot) {
        s.rotation.y = this.time * 1.1 + s.userData.phase;
        const d = this.cam ? this.cam.position.distanceTo(s.position) : 10;
        s.scale.setScalar(Math.max(s.userData.foot, d * 0.045));
      }
    }
    for (const o of this.animated) {
      animateUtility(o, this.time, dt);
      animateService(o, this.time);
      animateDecor(o, dt);
      animatePort(o, this.time, (Date.now() - this.city.lastShipped) / 1000);
      const fl = o.getObjectByName('flames');
      if (fl) {
        fl.children.forEach((c, n) => {
          const k = 0.75 + Math.sin(this.time * 12 + n * 1.7) * 0.25;
          c.scale.set(k, 0.8 + Math.sin(this.time * 9 + n) * 0.3, k);
        });
      }
    }
  }
}
