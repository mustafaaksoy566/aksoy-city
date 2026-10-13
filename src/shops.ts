import * as THREE from 'three';
import { PROPS } from './config';
import { part, windowMat } from './utilities';
import { mergeStatic } from './batcher';
import { KIT } from './towers';
import { signMat } from './signs';
import { carModel } from './cars';
import { pm, M, BULB, BULB_GEO, FLOWERS, FLOWER_GEO, PAINT, type V3, UP, add, box, cyl, rod, item, frustum, lamp, tree } from './parts';

// Üretim zincirinin yeni dükkanları gökdelenler gibi ayrıntılı çizilir: bahçe market (cam sera, fidanlar,
// çiçek tezgahları, cüceler), dondurma ve burger dükkanı (retro lokanta, çatıda dev külah ve burger, arabalı
// servis) ve beyaz eşya mağazası (camlı vitrinde buzdolapları, çamaşır makineleri ve televizyonlar, buzdolabı
// indiren teslimat kamyoneti). Yerel ölçü 1x1, y=0 zemin, ön yüz +z (yola bakar). Eşyalar gerçek boylarının
// küçültülmüş hali (1 m yaklaşık 0.08 birim). Sabit parçalar birleştirilir (mergeStatic).

// --- Ortak malzemeler ---
const ASPHALT = pm('#4b5058', 0.95);
const LINE = pm('#f4f4f0', 0.7);
const CONCRETE = pm('#c9ccd1', 0.9);
const GRAVEL = pm('#cbbd9e', 1);
const FRAME = pm('#f7f9f8', 0.5); // sera çerçevesi
const TERRACOTTA = pm('#c8693f', 0.9);
const POT = pm('#2d2f33', 0.8); // fidan saksısı
const CARDBOARD = pm('#c79a5f', 0.95);
const TAPE = pm('#e8d3a6', 0.8);
const CHROME = pm('#d5dbe1', 0.3, 0.6);
const LEAVES = ['#4f9a3e', '#6cbd55', '#3f7f3a', '#86c95b'].map(c => pm(c, 1));
const BLOSSOM = pm('#f3a6c8', 1);
const PINE = pm('#2f6b3a', 1);

// Gece yanan malzeme (DayNight 'window' adlı malzemeleri yakar); emissiveMap hangi yerin yanacağını söyler
function glowMat(map: THREE.Texture, glow: THREE.Texture | null, rough = 0.3, metal = 0.05) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: metal, emissive: '#000000' });
  if (glow) m.emissiveMap = glow;
  m.name = 'window';
  return m;
}
// Tuvale çizilen doku (tekrar edebilir)
function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void) {
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
// Doku ve malzemeler ilk kullanımda bir kere yapılır (bütün binalar aynı malzemeyi paylaşır)
const once = <T,>(f: () => T) => {
  let v: T | undefined;
  return () => (v ??= f());
};
// Sabit tohumlu rastgele sayı (her seferinde aynı desen)
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// Kutu: doku her yüzde gerçek ölçüyle tekrar eder (tu x tv birimde bir doku)
function tiledBox(w: number, h: number, d: number, tu: number, tv: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const span: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x, -x, +y, -y, +z, -z
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * span[f][0]) / tu, (uv.getY(i) * span[f][1]) / tv);
    }
  }
  return g;
}
// Üçgen alınlık (taban b, yükseklik h, kalınlık d); doku tu birimde bir tekrar eder
function gableGeo(b: number, h: number, d: number, tu: number) {
  const s = new THREE.Shape([new THREE.Vector2(-b / 2, 0), new THREE.Vector2(b / 2, 0), new THREE.Vector2(0, h)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tu, uv.getY(i) / tu);
  return g;
}
// Köşeleri yuvarlatılmış kutu (taban y=0, w genişlik, d derinlik, r köşe yarıçapı)
function roundedBox(w: number, d: number, r: number, h: number) {
  const s = new THREE.Shape();
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - r);
  s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  s.lineTo(x0 + r, y1);
  s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + r);
  s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 4 }).rotateX(-Math.PI / 2);
}
// Dokunun bir bölgesini gösteren düz yüzey (ekran, pano): rect = [u0, v0, u1, v1], yüzü +z
function screenGeo(w: number, h: number, rect: [number, number, number, number]) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + uv.getX(i) * (rect[2] - rect[0]), rect[1] + uv.getY(i) * (rect[3] - rect[1]));
  return g;
}

// --- İnsanlar (şehirdeki boyda) ---
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524'].map(c => pm(c, 0.8));
const HAIR = ['#2b1d14', '#5a3825', '#c99a4e', '#161616', '#8a4b2a'].map(c => pm(c, 0.9));
const LEGS = [M.navy, pm('#3d4450'), pm('#c2a77e'), M.slate, pm('#5b6b7a')];
const BODY_GEO = new THREE.CylinderGeometry(0.0155, 0.0125, 0.046, 7).scale(1, 1, 0.66);
const HIP_GEO = new THREE.CylinderGeometry(0.0135, 0.0125, 0.02, 7, 1, true);
const HEAD_GEO = new THREE.SphereGeometry(0.0105, 7, 5);
const HAIR_GEO = new THREE.SphereGeometry(0.0113, 7, 3, 0, Math.PI * 2, 0, Math.PI * 0.5);
const SHOE_GEO = new THREE.BoxGeometry(0.008, 0.005, 0.015);
function limb(g: THREE.Object3D, a: V3, b: V3, r: number, m: THREE.Material) {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const o = add(g, new THREE.CylinderGeometry(r, r, d.length(), 4, 1, true), m, A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
}
type Pose = 'stand' | 'sit' | 'carry' | 'push';
// İnsan (yüzü +z). sit: kalça y'de (sandalyede), ayaklar 0.036 aşağıda. carry: kollar önde (kutu taşır),
// push: kollar önde bel hizasında (araba ya da el arabası iter). top: tişört rengi (iş kıyafeti)
function person(g: THREE.Object3D, x: number, z: number, rot: number, k: number, pose: Pose = 'stand', y = 0.03, s = 0.9, top?: THREE.Material) {
  const p = item(g, x, z, rot, s, y);
  const skin = SKIN[k % SKIN.length];
  const hair = HAIR[(k * 3 + 1) % HAIR.length];
  const shirt = top ?? PAINT[(k * 5 + 2) % PAINT.length];
  const legs = LEGS[(k * 7 + 3) % LEGS.length];
  const hip = pose === 'sit' ? 0 : 0.07;
  for (const sx of [-0.0065, 0.0065]) {
    if (pose === 'sit') {
      limb(p, [sx, hip, -0.006], [sx, hip, 0.03], 0.0062, legs);
      limb(p, [sx, hip, 0.03], [sx, hip - 0.036, 0.033], 0.0052, legs);
      add(p, SHOE_GEO, M.iron, sx, hip - 0.0365, 0.036);
    } else {
      limb(p, [sx, hip, 0], [sx, 0.032, 0], 0.0062, legs);
      limb(p, [sx, 0.032, 0], [sx, 0.004, 0], 0.0052, legs);
      add(p, SHOE_GEO, M.iron, sx, 0.0025, 0.003);
    }
  }
  add(p, HIP_GEO, legs, 0, hip + 0.002, 0);
  const up = item(p, 0, 0, 0, 1, hip + 0.01);
  up.rotation.x = pose === 'sit' ? -0.05 : pose === 'push' ? 0.18 : 0;
  add(up, BODY_GEO, shirt, 0, 0.022, 0);
  add(up, HEAD_GEO, skin, 0, 0.06, 0);
  add(up, HAIR_GEO, hair, 0, 0.0615, -0.0012);
  for (const sd of [-1, 1]) {
    const sh: V3 = [sd * 0.0175, 0.04, 0];
    const hand: V3 =
      pose === 'carry' ? [sd * 0.016, 0.03, 0.03] : pose === 'push' ? [sd * 0.016, 0.012, 0.036] : pose === 'sit' ? [sd * 0.016, 0.014, 0.026] : [sd * 0.021, -0.006, 0.003];
    const elbow: V3 = [sh[0] + (hand[0] - sh[0]) * 0.45, sh[1] + (hand[1] - sh[1]) * 0.45 - 0.006, sh[2] + (hand[2] - sh[2]) * 0.45];
    limb(up, elbow, hand, 0.0042, skin);
    limb(up, sh, elbow, 0.0056, shirt);
  }
  return p;
}

// Park etmiş ya da duran araba (dükkanlardaki gibi küçültülmüş)
function car(g: THREE.Object3D, kind: Parameters<typeof carModel>[0], x: number, z: number, rot: number, color?: string, s = 0.7) {
  const c = carModel(kind, color);
  c.position.set(x, 0.03, z);
  c.rotation.y = rot;
  c.scale.multiplyScalar(s);
  g.add(c);
  return c;
}

// =====================================================================================================
// Bahçe market: iki bölmeli cam sera (beyaz çerçeve, açık havalandırma kapakları, içi bitki dolu),
// önünde yeşil giriş ve BAHÇE tabelası; sağda çakıl zeminde sıra sıra saksılı fidanlar; önde basamaklı
// çiçek tezgahları, bahçe cüceleri, el arabası, palet üstünde toprak torbaları, saksı yığınları ve
// fidan taşıyan arabasıyla bir müşteri.
// =====================================================================================================

// Sera camı: üstte açık camlar, altta içerideki bitkiler görünür; gece içerisi yanar (bitkiler gölge gibi)
const ghWallMat = once(() => {
  const W = 256, H = 128, P = 64;
  const plants = (x: CanvasRenderingContext2D, night: boolean) => {
    const r = rng(11);
    for (let p = 0; p < 4; p++) {
      const x0 = p * P;
      // İçerideki tezgah
      x.fillStyle = night ? '#2a2216' : 'rgba(120,92,60,0.55)';
      x.fillRect(x0, 92, P, 5);
      for (let k = 0; k < 7; k++) {
        const cx = x0 + 6 + r() * (P - 12), cy = 70 + r() * 22, rx = 6 + r() * 9, ry = 8 + r() * 12;
        x.fillStyle = night ? '#3a3420' : ['rgba(79,154,62,0.85)', 'rgba(63,127,58,0.85)', 'rgba(108,189,85,0.85)', 'rgba(47,107,58,0.85)'][k % 4];
        x.beginPath();
        x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        x.fill();
      }
      // Uzun bitki (palmiye yaprakları gibi)
      if (p % 2 === 0) {
        x.strokeStyle = night ? '#3a3420' : 'rgba(47,107,58,0.9)';
        x.lineWidth = 4;
        for (let k = 0; k < 5; k++) {
          x.beginPath();
          x.moveTo(x0 + 32, 96);
          x.quadraticCurveTo(x0 + 32 + (k - 2) * 6, 50, x0 + 32 + (k - 2) * 13, 44 + Math.abs(k - 2) * 8);
          x.stroke();
        }
      }
      if (!night) {
        for (let k = 0; k < 6; k++) {
          x.fillStyle = ['#ec407a', '#fdd835', '#e53935', '#ffffff', '#ab47bc', '#ff7043'][(k + p) % 6];
          x.beginPath();
          x.arc(x0 + 8 + r() * (P - 16), 66 + r() * 22, 2.6, 0, Math.PI * 2);
          x.fill();
        }
      }
    }
  };
  const frames = (x: CanvasRenderingContext2D, c: string) => {
    x.fillStyle = c;
    for (let p = 0; p < 4; p++) x.fillRect(p * P, 0, 4, H);
    x.fillRect(0, 0, W, 4);
    x.fillRect(0, 52, W, 3);
    x.fillRect(0, 112, W, 16);
  };
  const day = canvasTex(W, H, x => {
    const gr = x.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#eaf9fb');
    gr.addColorStop(1, '#b9e2e8');
    x.fillStyle = gr;
    x.fillRect(0, 0, W, H);
    plants(x, false);
    // Camda gökyüzü yansıması
    x.fillStyle = 'rgba(255,255,255,0.3)';
    for (let p = 0; p < 4; p++) {
      x.beginPath();
      x.moveTo(p * P + 10, 52);
      x.lineTo(p * P + 26, 4);
      x.lineTo(p * P + 36, 4);
      x.lineTo(p * P + 20, 52);
      x.fill();
    }
    frames(x, '#ffffff');
    x.fillStyle = '#dfe6e8';
    x.fillRect(0, 114, W, 14);
  });
  const glow = canvasTex(W, H, x => {
    x.fillStyle = '#ffe6b0';
    x.fillRect(0, 0, W, H);
    plants(x, true);
    frames(x, '#000000');
  });
  return glowMat(day, glow, 0.15, 0.1);
});
// Sera çatısı: ince çıtalı cam paneller
const ghRoofMat = once(() => {
  const S = 128;
  const draw = (x: CanvasRenderingContext2D, glass: string, bar: string, night: boolean) => {
    x.fillStyle = glass;
    x.fillRect(0, 0, S, S);
    if (!night) {
      const gr = x.createLinearGradient(0, 0, S, S);
      gr.addColorStop(0, 'rgba(255,255,255,0.35)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0)');
      gr.addColorStop(1, 'rgba(160,200,210,0.25)');
      x.fillStyle = gr;
      x.fillRect(0, 0, S, S);
    }
    x.fillStyle = bar;
    x.fillRect(0, 0, 5, S);
    x.fillRect(64, 0, 3, S);
    x.fillRect(0, 0, S, 3);
  };
  return glowMat(canvasTex(S, S, x => draw(x, '#d3eff3', '#ffffff', false)), canvasTex(S, S, x => draw(x, '#b39660', '#000000', true)), 0.12, 0.15);
});

// İki bölmeli sera: (cx, cz) merkez, W genişlik, D derinlik; çatı mahyaları z yönünde
function greenhouse(st: THREE.Object3D, cx: number, cz: number, W: number, D: number) {
  const y0 = 0.045, H = 0.155, eave = y0 + H, rise = 0.085, bay = W / 2;
  const wall = ghWallMat(), roof = ghRoofMat();
  box(st, W + 0.014, 0.015, D + 0.014, CONCRETE, cx, 0.03, cz);
  add(st, tiledBox(W, H, D, 0.24, H), wall, cx, y0 + H / 2, cz);
  const len = Math.hypot(bay / 2, rise), ang = Math.atan2(rise, bay / 2);
  for (const bx of [cx - bay / 2, cx + bay / 2]) {
    // Ön ve arka cam alınlıklar
    add(st, gableGeo(bay, rise, 0.004, 0.06), roof, bx, eave, cz + D / 2 - 0.004);
    add(st, gableGeo(bay, rise, 0.004, 0.06), roof, bx, eave, cz - D / 2);
    // Eğik cam çatı ve havalandırma kapakları (sağ yüzde, açık)
    for (const s of [-1, 1]) {
      const r = add(st, tiledBox(len + 0.006, 0.005, D + 0.02, 0.06, 0.06), roof, bx + (s * bay) / 4, eave + rise / 2 + 0.003, cz);
      r.rotation.z = -s * ang;
    }
    for (const dz of [-0.11, 0.09]) {
      const v = add(st, new THREE.BoxGeometry(0.06, 0.004, 0.07), roof, bx + bay * 0.13, eave + rise * 0.78, cz + dz);
      v.rotation.z = -ang + 0.45;
      box(st, 0.004, 0.02, 0.004, FRAME, bx + bay * 0.16, eave + rise * 0.6, cz + dz + 0.03);
    }
    // Çerçeve: mahya, alınlık kenarları
    box(st, 0.012, 0.01, D + 0.024, FRAME, bx, eave + rise, cz);
    for (const z of [cz + D / 2 + 0.002, cz - D / 2 - 0.002]) {
      rod(st, [bx - bay / 2, eave, z], [bx, eave + rise + 0.004, z], 0.005, FRAME, 4);
      rod(st, [bx + bay / 2, eave, z], [bx, eave + rise + 0.004, z], 0.005, FRAME, 4);
    }
  }
  // Köşe ve orta dikmeler, saçak kirişleri, iki bölme arasındaki oluk
  for (const x of [cx - W / 2, cx, cx + W / 2]) {
    for (const z of [cz - D / 2, cz + D / 2]) box(st, 0.012, H + 0.006, 0.012, FRAME, x, y0, z);
  }
  for (const x of [cx - W / 2, cx + W / 2]) box(st, 0.014, 0.012, D + 0.016, FRAME, x, eave - 0.004, cz); // uçları cam çatının ucundan içeride
  for (const z of [cz - D / 2, cz + D / 2]) box(st, W + 0.014, 0.01, 0.012, FRAME, cx, eave - 0.004, z);
  box(st, 0.022, 0.012, D + 0.03, pm('#b8c2c8', 0.5, 0.4), cx, eave, cz);
}

// Saksıda fidan: 0 yuvarlak taçlı, 1 çam, 2 çiçekli, 3 çalı
function sapling(g: THREE.Object3D, x: number, z: number, k: number) {
  cyl(g, 0.014, 0.011, 0.022, k % 5 === 4 ? TERRACOTTA : POT, x, 0.034, z, 8);
  cyl(g, 0.012, 0.012, 0.002, M.soil, x, 0.056, z, 8); // toprak saksı ağzından belirgin yüksekte (aynı boyda titreşir)
  const kind = k % 4;
  const leaf = LEAVES[(k * 3) % LEAVES.length];
  if (kind === 0 || kind === 2) {
    const h = 0.07 + (k % 3) * 0.012;
    rod(g, [x, 0.056, z], [x, 0.056 + h, z], 0.0025, M.darkWood, 4);
    add(g, new THREE.IcosahedronGeometry(0.026 + (k % 2) * 0.004, 1), kind === 2 ? BLOSSOM : leaf, x, 0.056 + h + 0.012, z);
  } else if (kind === 1) {
    add(g, new THREE.ConeGeometry(0.022, 0.075, 8), PINE, x, 0.056 + 0.04, z);
    add(g, new THREE.ConeGeometry(0.016, 0.045, 8), PINE, x, 0.056 + 0.075, z);
  } else {
    add(g, new THREE.IcosahedronGeometry(0.022, 1), leaf, x, 0.074, z);
    add(g, new THREE.IcosahedronGeometry(0.016, 1), LEAVES[(k + 1) % LEAVES.length], x + 0.012, 0.084, z - 0.008);
  }
}
const LEAF_MOUND = new THREE.IcosahedronGeometry(0.011, 0).scale(1, 0.6, 1);
const BLOOM = new THREE.IcosahedronGeometry(0.0085, 0);
// Basamaklı çiçek tezgahı (yüzü +z): üç kat ahşap raf, her katta renk renk çiçekli saksılar
function flowerStand(g: THREE.Object3D, x: number, z: number, rot: number, w: number, seed: number) {
  const s = item(g, x, z, rot);
  const n = Math.max(3, Math.round(w / 0.036));
  for (let t = 0; t < 3; t++) {
    const zz = -0.03 + t * 0.03, y = 0.045 - t * 0.017;
    box(s, w, 0.006, 0.028, M.wood, 0, y, zz);
    for (const sx of [-1, 1]) box(s, 0.006, y, 0.006, M.darkWood, (sx * (w - 0.01)) / 2, 0, zz);
    for (let i = 0; i < n; i++) {
      const px = -w / 2 + ((i + 0.5) * w) / n;
      cyl(s, 0.011, 0.008, 0.013, TERRACOTTA, px, y + 0.006, zz, 6);
      add(s, LEAF_MOUND, LEAVES[(i + t) % 2], px, y + 0.021, zz);
      const fm = FLOWERS[(i * 2 + t * 3 + seed) % FLOWERS.length];
      add(s, BLOOM, fm, px - 0.004, y + 0.028, zz + 0.002);
      add(s, BLOOM, fm, px + 0.005, y + 0.027, zz - 0.003);
    }
  }
}
// Bahçe cücesi (yüzü +z): sivri kırmızı külah, beyaz sakal, renkli ceket
const GNOME_COATS = ['#1e6fd9', '#2e8b3a', '#f7c948', '#8e24aa'].map(c => pm(c, 0.6));
function gnome(g: THREE.Object3D, x: number, z: number, rot: number, k: number) {
  const n = item(g, x, z, rot, 1.1);
  for (const sx of [-0.004, 0.004]) box(n, 0.006, 0.004, 0.009, M.darkWood, sx, 0, 0.002);
  add(n, new THREE.CylinderGeometry(0.006, 0.011, 0.022, 8), GNOME_COATS[k % GNOME_COATS.length], 0, 0.015, 0);
  add(n, new THREE.SphereGeometry(0.0065, 8, 6), M.skin, 0, 0.031, 0.001);
  add(n, new THREE.ConeGeometry(0.0055, 0.012, 7).rotateX(Math.PI), M.white, 0, 0.025, 0.004);
  add(n, new THREE.SphereGeometry(0.0022, 5, 4), pm('#e57373', 0.7), 0, 0.031, 0.0068);
  add(n, new THREE.ConeGeometry(0.0072, 0.02, 8), M.red, 0, 0.044, -0.001);
}
// El arabası (yüzü +z, teker önde): yeşil tekne, içinde toprak ve bir fidan
function wheelbarrow(g: THREE.Object3D, x: number, z: number, rot: number) {
  const w = item(g, x, z, rot);
  add(w, frustum(0.034, 0.05, 0.022, 0.05, 0.072), pm('#2e9d4a', 0.5), 0, 0.044, 0); // ağzı geniş, tabanı dar
  box(w, 0.046, 0.004, 0.066, M.soil, 0, 0.053, 0);
  add(w, new THREE.IcosahedronGeometry(0.012, 0), LEAVES[1], 0.006, 0.062, -0.01);
  const wheel = add(w, new THREE.CylinderGeometry(0.012, 0.012, 0.007, 12).rotateZ(Math.PI / 2), M.iron, 0, 0.012, 0.045);
  wheel.castShadow = true;
  for (const sx of [-1, 1]) {
    rod(w, [sx * 0.012, 0.012, 0.045], [sx * 0.02, 0.035, -0.035], 0.0022, M.iron, 4);
    rod(w, [sx * 0.02, 0.035, -0.035], [sx * 0.022, 0.04, -0.065], 0.0025, M.darkWood, 4);
    rod(w, [sx * 0.014, 0.034, -0.02], [sx * 0.016, 0.0, -0.022], 0.002, M.iron, 4);
  }
}
// Palet üstünde toprak torbaları (kahverengi torba, yeşil etiket)
const BAG = pm('#5d4037', 0.9);
const BAG_LABEL = pm('#8bc34a', 0.8);
function soilPallet(g: THREE.Object3D, x: number, z: number, rot: number, layers: number) {
  const p = item(g, x, z, rot);
  box(p, 0.11, 0.012, 0.09, M.wood, 0, 0, 0);
  for (let l = 0; l < layers; l++) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const turn = l % 2 === 1;
        const bx = turn ? (i - 0.5) * 0.05 : (i - 0.5) * 0.052, bz = turn ? (j - 0.5) * 0.04 : (j - 0.5) * 0.042;
        const b = box(p, 0.048, 0.016, 0.036, BAG, bx, 0.012 + l * 0.016, bz);
        b.rotation.y = (i + j + l) % 2 ? 0.05 : -0.04;
        box(p, 0.02, 0.0165, 0.0365, BAG_LABEL, bx, 0.012 + l * 0.016, bz);
      }
    }
  }
}
// Fidan taşıyan düz el arabası (yüzü +z, sap arkada)
function plantCart(g: THREE.Object3D, x: number, z: number, rot: number) {
  const c = item(g, x, z, rot);
  box(c, 0.05, 0.005, 0.08, M.gray, 0, 0.012, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(c, new THREE.CylinderGeometry(0.006, 0.006, 0.005, 8).rotateZ(Math.PI / 2), M.iron, sx * 0.022, 0.006, sz * 0.032);
  rod(c, [-0.022, 0.017, -0.04], [-0.022, 0.07, -0.046], 0.0022, M.iron, 4);
  rod(c, [0.022, 0.017, -0.04], [0.022, 0.07, -0.046], 0.0022, M.iron, 4);
  rod(c, [-0.022, 0.07, -0.046], [0.022, 0.07, -0.046], 0.0025, M.red, 4);
  cyl(c, 0.012, 0.009, 0.016, TERRACOTTA, -0.01, 0.017, 0.015, 8);
  add(c, new THREE.IcosahedronGeometry(0.016, 1), LEAVES[0], -0.01, 0.045, 0.015);
  cyl(c, 0.011, 0.009, 0.014, POT, 0.012, 0.017, -0.016, 8);
  for (const [dx, dz] of [[-0.004, 0.003], [0.005, 0.002], [0, -0.005], [0.002, 0.006]]) add(c, FLOWER_GEO, FLOWERS[0], 0.012 + dx, 0.036, -0.016 + dz);
  add(c, new THREE.IcosahedronGeometry(0.01, 0), LEAVES[1], 0.012, 0.03, -0.016);
}
// Üst üste konmuş toprak saksılar
function potStack(g: THREE.Object3D, x: number, z: number) {
  for (let k = 0; k < 4; k++) cyl(g, 0.017, 0.012, 0.02, TERRACOTTA, x, 0.03 + k * 0.009, z, 10);
  cyl(g, 0.02, 0.015, 0.024, TERRACOTTA, x + 0.035, 0.03, z + 0.01, 10);
  cyl(g, 0.017, 0.017, 0.002, M.soil, x + 0.035, 0.054, z + 0.01, 10);
}

export function makeGarden(): THREE.Object3D {
  const st = new THREE.Group();
  box(st, 0.96, 0.03, 0.96, M.paving, 0, 0, 0);
  // Sera (sol arkada) ve giriş
  const cx = -0.15, cz = -0.25, W = 0.6, D = 0.42;
  greenhouse(st, cx, cz, W, D);
  const front = cz + D / 2;
  const green = pm('#2e7d32', 0.6);
  box(st, 0.2, 0.17, 0.06, green, cx, 0.03, front + 0.03);
  box(st, 0.22, 0.016, 0.075, M.white, cx, 0.2, front + 0.035); // üstü sera oluğundan belirgin yüksekte
  box(st, 0.13, 0.13, 0.004, pm('#1b4d22', 0.5), cx, 0.035, front + 0.061);
  box(st, 0.056, 0.12, 0.005, windowMat, cx - 0.031, 0.035, front + 0.063);
  box(st, 0.056, 0.12, 0.005, windowMat, cx + 0.031, 0.035, front + 0.063);
  box(st, 0.004, 0.12, 0.006, M.iron, cx, 0.035, front + 0.064);
  box(st, 0.16, 0.003, 0.05, pm('#6d4c41', 1), cx, 0.03, front + 0.085);
  // BAHÇE tabelası (girişin üstünde, iki alınlığın önünde)
  box(st, 0.34, 0.085, 0.014, green, cx, 0.205, front + 0.05);
  box(st, 0.31, 0.065, 0.012, signMat('BAHÇE', '#2e7d32'), cx, 0.215, front + 0.053); // arka yüzü panonun içinde, ön yüzü önünde
  for (const sx of [-1, 1]) {
    // Tabelanın iki yanında yaprak süsü
    add(st, new THREE.SphereGeometry(0.014, 8, 6).scale(1, 0.55, 0.4), LEAVES[1], cx + sx * 0.185, 0.27, front + 0.052).rotation.z = sx * 0.6;
    add(st, new THREE.SphereGeometry(0.012, 8, 6).scale(1, 0.55, 0.4), LEAVES[0], cx + sx * 0.18, 0.252, front + 0.052).rotation.z = -sx * 0.5;
  }
  for (let k = 0; k < 9; k++) add(st, BULB_GEO, BULB, cx - 0.1 + k * 0.025, 0.198, front + 0.074);
  // Girişin iki yanında asılı çiçek sepetleri
  for (const sx of [-1, 1]) {
    const hx = cx + sx * 0.125, hz = front + 0.07;
    box(st, 0.004, 0.004, 0.03, M.iron, hx, 0.19, hz - 0.012);
    rod(st, [hx, 0.19, hz], [hx, 0.16, hz], 0.0012, M.iron, 3);
    add(st, new THREE.SphereGeometry(0.016, 10, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.darkWood, hx, 0.152, hz);
    add(st, LEAF_MOUND, LEAVES[1], hx, 0.153, hz);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      add(st, BLOOM, FLOWERS[(k + (sx > 0 ? 3 : 0)) % FLOWERS.length], hx + Math.cos(a) * 0.012, 0.158, hz + Math.sin(a) * 0.012);
    }
  }
  // Çiçek tezgahının yanında sulama kabı
  const can = item(st, -0.25, 0.17, -0.6);
  cyl(can, 0.011, 0.012, 0.024, pm('#43a047', 0.5), 0, 0, 0, 10);
  rod(can, [0, 0.016, 0.009], [0, 0.034, 0.03], 0.0022, pm('#43a047', 0.5), 5);
  add(can, new THREE.TorusGeometry(0.009, 0.0018, 4, 10, Math.PI), pm('#43a047', 0.5), 0, 0.024, -0.002).rotation.y = Math.PI / 2;
  // Sağda fidanlık: çakıl zemin, sıra sıra saksılı fidanlar, kenarda alçak çit
  box(st, 0.29, 0.004, 0.5, GRAVEL, 0.325, 0.03, -0.22);
  let k = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 5; j++) sapling(st, 0.225 + i * 0.09 + (j % 2) * 0.012, -0.43 + j * 0.095, k++);
  }
  for (let j = 0; j <= 6; j++) rod(st, [0.47, 0.03, -0.46 + j * 0.08], [0.47, 0.075, -0.46 + j * 0.08], 0.003, M.darkWood, 4);
  rod(st, [0.47, 0.07, -0.46], [0.47, 0.07, 0.02], 0.003, M.wood, 4);
  rod(st, [0.47, 0.05, -0.46], [0.47, 0.05, 0.02], 0.003, M.wood, 4);
  // Girişten yola yürüme yolu
  box(st, 0.14, 0.003, 0.36, M.stone, cx, 0.03, front + 0.29);
  // Önde çiçek tezgahları
  flowerStand(st, -0.36, 0.12, 0, 0.17, 0);
  flowerStand(st, 0.05, 0.12, 0, 0.2, 3);
  flowerStand(st, 0.32, 0.12, 0, 0.18, 1);
  // Bahçe cüceleri (çimen üstünde)
  box(st, 0.16, 0.006, 0.06, M.lawn, 0.05, 0.03, 0.27);
  for (let g = 0; g < 4; g++) gnome(st, -0.01 + g * 0.04, 0.27, 0.15 - g * 0.1, g);
  // Sol önde toprak torbaları, saksı yığınları ve el arabası
  soilPallet(st, -0.39, 0.3, 0.1, 3);
  soilPallet(st, -0.39, 0.42, -0.05, 2);
  potStack(st, -0.27, 0.43);
  wheelbarrow(st, -0.27, 0.3, 0.5);
  // Sağ önde büyük saksılarda ağaçlar ve fidan taşıyan müşteri
  for (const [x, z, path, s] of [[0.28, 0.4, PROPS.treeBlossom, 0.22], [0.41, 0.3, PROPS.treeLarge, 0.21]] as [number, number, string, number][]) {
    box(st, 0.062, 0.034, 0.062, M.wood, x, 0.03, z);
    for (const dy of [0.012, 0.024]) box(st, 0.064, 0.002, 0.064, M.darkWood, x, 0.03 + dy, z);
    box(st, 0.054, 0.002, 0.054, M.soil, x, 0.064, z);
    tree(st, path, x, z, s, x * 10);
    (st.children[st.children.length - 1] as THREE.Object3D).position.y = 0.064;
  }
  person(st, cx + 0.01, 0.33, 0.1, 2, 'push');
  plantCart(st, cx + 0.017, 0.4, 0.1);
  person(st, 0.06, 0.2, Math.PI - 0.3, 4, 'stand');
  lamp(st, 0.47, 0.46);
  lamp(st, -0.46, 0.06);
  return mergeStatic([st]);
}

// =====================================================================================================
// Dondurma & Burger: köşeleri yuvarlak retro lokanta (krom alt duvar, kırmızı şerit, geniş camlar,
// kırmızı saçak), çatıda dev dondurma külahı ve dev burger; önde tenteli dondurma penceresi, şemsiyeli
// masalarda oturan insanlar ve ampul zincirleri; binanın çevresinden dolaşan arabalı servis yolu
// (yükseklik kirişi, ışıklı menü panosu, servis penceresinde bekleyen araba).
// =====================================================================================================

// Külah dokusu: çapraz waffle deseni
const waffleMat = once(() => {
  const t = canvasTex(64, 64, x => {
    x.fillStyle = '#dca35a';
    x.fillRect(0, 0, 64, 64);
    x.strokeStyle = '#a86d2c';
    x.lineWidth = 5;
    for (let k = -64; k <= 128; k += 32) {
      x.beginPath();
      x.moveTo(k, 0);
      x.lineTo(k + 64, 64);
      x.stroke();
      x.beginPath();
      x.moveTo(k + 64, 0);
      x.lineTo(k, 64);
      x.stroke();
    }
  });
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 });
});
// Işıklı menü panosu (gece yanar)
const menuMat = once(() => {
  const t = canvasTex(128, 96, x => {
    x.fillStyle = '#263238';
    x.fillRect(0, 0, 128, 96);
    x.fillStyle = '#d32f2f';
    x.fillRect(0, 0, 128, 22);
    x.fillStyle = '#ffffff';
    x.font = 'bold 16px ui-rounded, system-ui, Arial, sans-serif';
    x.textAlign = 'center';
    x.fillText('MENÜ', 64, 17);
    // Burger, patates ve dondurma resimleri
    const cxs = [22, 64, 106];
    x.fillStyle = '#e0a050';
    x.beginPath();
    x.arc(cxs[0], 46, 13, Math.PI, 0);
    x.fill();
    x.fillStyle = '#7cb342';
    x.fillRect(cxs[0] - 14, 46, 28, 3);
    x.fillStyle = '#5d3a1a';
    x.fillRect(cxs[0] - 13, 49, 26, 5);
    x.fillStyle = '#e0a050';
    x.fillRect(cxs[0] - 12, 54, 24, 5);
    x.fillStyle = '#fdd835';
    for (let k = 0; k < 5; k++) x.fillRect(cxs[1] - 9 + k * 4, 32 + (k % 2) * 3, 3, 16);
    x.fillStyle = '#e53935';
    x.fillRect(cxs[1] - 11, 44, 22, 16);
    x.fillStyle = '#dca35a';
    x.beginPath();
    x.moveTo(cxs[2] - 9, 44);
    x.lineTo(cxs[2] + 9, 44);
    x.lineTo(cxs[2], 62);
    x.fill();
    x.fillStyle = '#f48fb1';
    x.beginPath();
    x.arc(cxs[2], 40, 10, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#fdd835';
    x.font = 'bold 13px ui-rounded, system-ui, Arial, sans-serif';
    for (const [k, p] of ['45₺', '25₺', '30₺'].entries()) x.fillText(p, cxs[k], 84);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return glowMat(t, t, 0.4, 0);
});

// Çizgili şemsiye: 8 dilim, iki renk sırayla
function umbrella(g: THREE.Object3D, x: number, z: number, h: number, r: number, a: THREE.Material, b: THREE.Material) {
  rod(g, [x, 0.088, z], [x, 0.03 + h + 0.01, z], 0.0024, M.white, 6); // masanın üstünden çıkar (masa ayağıyla iç içe titreşmesin)
  for (let k = 0; k < 8; k++) {
    add(g, new THREE.ConeGeometry(r, r * 0.38, 2, 1, true, (k * Math.PI) / 4, Math.PI / 4), k % 2 ? b : a, x, 0.03 + h, z);
  }
  add(g, new THREE.SphereGeometry(0.005, 6, 4), M.white, x, 0.03 + h + r * 0.2, z);
}
// Yuvarlak masa ve sandalyeler; seats: sandalyelerin açıları, sitters: oturanlar (sandalye sırası -> renk)
function patioTable(g: THREE.Object3D, x: number, z: number, seats: number[], sitters: [number, number][], chair: THREE.Material) {
  cyl(g, 0.014, 0.016, 0.008, CHROME, x, 0.03, z, 10); // ayak tabanı teras zemininden ve damalardan belirgin yüksekte
  cyl(g, 0.003, 0.003, 0.056, CHROME, x, 0.034, z, 6);
  cyl(g, 0.03, 0.03, 0.005, M.white, x, 0.088, z, 14);
  seats.forEach((a, i) => {
    const cxp = x + Math.sin(a) * 0.05, czp = z + Math.cos(a) * 0.05;
    const c = item(g, cxp, czp, a + Math.PI);
    box(c, 0.026, 0.005, 0.024, chair, 0, 0.032, 0);
    box(c, 0.026, 0.03, 0.004, chair, 0, 0.037, -0.012);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(c, 0.003, 0.032, 0.003, CHROME, sx * 0.011, 0, sz * 0.01);
    const who = sitters.find(s => s[0] === i);
    if (who) person(g, cxp - Math.sin(a) * 0.004, czp - Math.cos(a) * 0.004, a + Math.PI, who[1], 'sit', 0.065, 0.88);
  });
  // Masada içecek ve dondurma
  cyl(g, 0.004, 0.003, 0.012, M.red, x + 0.008, 0.093, z + 0.006, 6);
  add(g, new THREE.ConeGeometry(0.004, 0.012, 6).rotateX(Math.PI), waffleMat(), x - 0.01, 0.099, z - 0.004);
  add(g, new THREE.SphereGeometry(0.005, 6, 4), pm('#f48fb1', 0.6), x - 0.01, 0.106, z - 0.004);
}
// Dev dondurma külahı: waffle külah, üç top (çilek, vanilya, çikolata), damlalar, şeker serpintisi ve kiraz
function giantCone(g: THREE.Object3D, x: number, y: number, z: number) {
  const c = item(g, x, z, 0, 1, y);
  cyl(c, 0.022, 0.026, 0.02, CHROME, 0, 0, 0, 12);
  add(c, new THREE.ConeGeometry(0.056, 0.17, 18, 1, true).rotateX(Math.PI), waffleMat(), 0, 0.02 + 0.085, 0);
  add(c, new THREE.TorusGeometry(0.054, 0.011, 6, 18).rotateX(Math.PI / 2), pm('#f8bbd0', 0.5), 0, 0.19, 0);
  const pink = pm('#f48fb1', 0.5), vanilla = pm('#fff1d0', 0.5), choco = pm('#6d4c41', 0.5);
  add(c, new THREE.SphereGeometry(0.06, 16, 12), pink, 0, 0.225, 0);
  // Damlalar
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    add(c, new THREE.CapsuleGeometry(0.008, 0.012 + (k % 3) * 0.008, 3, 6), pink, Math.cos(a) * 0.055, 0.19 - (k % 3) * 0.004, Math.sin(a) * 0.055);
  }
  add(c, new THREE.SphereGeometry(0.052, 16, 12), vanilla, 0.004, 0.3, 0.002);
  add(c, new THREE.SphereGeometry(0.043, 14, 10), choco, -0.002, 0.365, 0);
  const r = rng(5);
  for (let k = 0; k < 16; k++) {
    const a = r() * Math.PI * 2, el = 0.25 + r() * 0.9;
    const R = k < 8 ? 0.053 : 0.044, cy = k < 8 ? 0.3 : 0.365;
    const sp = add(c, new THREE.BoxGeometry(0.004, 0.004, 0.012), PAINT[k % PAINT.length], Math.cos(a) * Math.cos(el) * R, cy + Math.sin(el) * R, Math.sin(a) * Math.cos(el) * R);
    sp.rotation.set(r() * 3, r() * 3, 0);
  }
  add(c, new THREE.SphereGeometry(0.013, 10, 8), pm('#c62828', 0.3), 0, 0.414, 0);
  rod(c, [0, 0.424, 0], [0.006, 0.445, -0.004], 0.0015, M.darkWood, 4);
}
// Dev burger: alt ekmek, marul, köfte, peynir, domates, susamlı üst ekmek
function giantBurger(g: THREE.Object3D, x: number, y: number, z: number) {
  const b = item(g, x, z, 0, 1, y);
  cyl(b, 0.008, 0.01, 0.05, CHROME, 0, 0, 0, 8);
  const bun = pm('#d9954a', 0.7);
  cyl(b, 0.068, 0.06, 0.026, bun, 0, 0.05, 0, 20);
  cyl(b, 0.077, 0.077, 0.008, pm('#7cb342', 0.8), 0, 0.076, 0, 14);
  cyl(b, 0.072, 0.072, 0.024, pm('#5d3a1a', 0.9), 0, 0.084, 0, 20);
  const cheese = box(b, 0.118, 0.006, 0.118, pm('#ffc107', 0.5), 0, 0.106, 0);
  cheese.rotation.y = Math.PI / 4;
  cyl(b, 0.066, 0.066, 0.01, pm('#e53935', 0.6), 0, 0.112, 0, 18);
  add(b, new THREE.SphereGeometry(0.072, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1), pm('#e5a04f', 0.6), 0, 0.122, 0);
  const seed = pm('#fff3d0', 0.6);
  const r = rng(9);
  for (let k = 0; k < 14; k++) {
    const a = r() * Math.PI * 2, d = 0.012 + r() * 0.05;
    const yy = 0.122 + 0.62 * Math.sqrt(Math.max(0, 0.072 * 0.072 - d * d));
    add(b, new THREE.SphereGeometry(0.004, 5, 3).scale(1, 0.5, 1.6), seed, Math.cos(a) * d, yy, Math.sin(a) * d).rotation.y = a;
  }
}
// Yerde ok işareti (yönü +z, rot ile döner)
function arrow(g: THREE.Object3D, x: number, z: number, rot: number) {
  const a = item(g, x, z, rot, 1, 0.034);
  box(a, 0.012, 0.001, 0.05, LINE, 0, 0, -0.01);
  add(a, new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.018, 0), new THREE.Vector2(0.018, 0), new THREE.Vector2(0, 0.026)])).rotateX(-Math.PI / 2), LINE, 0, 0.0012, 0.015);
}

export function makeCafe(): THREE.Object3D {
  const st = new THREE.Group();
  box(st, 0.96, 0.03, 0.96, M.paving, 0, 0, 0);
  // Arabalı servis yolu: sağdan girer, binanın arkasından dolaşır, soldan çıkar
  const L = 0.15;
  box(st, L, 0.004, 0.96, ASPHALT, 0.48 - L / 2, 0.03, 0);
  box(st, L, 0.004, 0.96, ASPHALT, -0.48 + L / 2, 0.03, 0);
  box(st, 0.96 - 2 * L, 0.004, L, ASPHALT, 0, 0.03, -0.48 + L / 2);
  for (const sx of [-1, 1]) box(st, 0.01, 0.012, 0.8, CONCRETE, sx * (0.48 - L - 0.005), 0.03, 0.08);
  box(st, 0.96 - 2 * L - 0.02, 0.012, 0.01, CONCRETE, 0, 0.03, -0.48 + L + 0.005);
  arrow(st, 0.405, 0.3, Math.PI);
  arrow(st, -0.405, 0.3, 0);
  arrow(st, 0.0, -0.405, -Math.PI / 2);
  // Yükseklik kirişi (girişte kırmızı-beyaz çizgili)
  for (const x of [0.335, 0.472]) cyl(st, 0.006, 0.007, 0.21, M.iron, x, 0.03, 0.42, 8);
  for (let k = 0; k < 6; k++) box(st, 0.024, 0.016, 0.014, k % 2 ? M.white : M.red, 0.343 + k * 0.024, 0.205, 0.42);
  // Lokanta: yuvarlak köşeli bantlar (koyu kaide, krom duvar, kırmızı şerit, camlar, kırmızı saçak)
  const bw = 0.56, bd = 0.28, bz = -0.17, R = 0.06;
  const front = bz + bd / 2;
  const red = pm('#d32f2f', 0.5), cream = pm('#fff3e0', 0.6);
  add(st, roundedBox(bw + 0.008, bd + 0.008, R, 0.018), pm('#8e2424', 0.7), 0, 0.03, bz);
  add(st, roundedBox(bw, bd, R, 0.06), pm('#dfe4ea', 0.4, 0.5), 0, 0.048, bz);
  add(st, roundedBox(bw + 0.004, bd + 0.004, R, 0.012), red, 0, 0.082, bz);
  add(st, roundedBox(bw - 0.006, bd - 0.006, R, 0.086), windowMat, 0, 0.094, bz);
  add(st, roundedBox(bw + 0.012, bd + 0.012, R, 0.046), red, 0, 0.18, bz);
  add(st, roundedBox(bw + 0.02, bd + 0.02, R, 0.01), cream, 0, 0.226, bz);
  add(st, roundedBox(bw - 0.01, bd - 0.01, R, 0.004), pm('#b0b8c0', 0.8), 0, 0.236, bz);
  // Cam aralarında krom dikmeler (ön ve sağ yüz)
  for (let k = 0; k < 8; k++) box(st, 0.005, 0.086, 0.006, CHROME, -0.21 + k * 0.06, 0.094, front - 0.001);
  for (let k = 0; k < 3; k++) box(st, 0.006, 0.086, 0.005, CHROME, bw / 2 - 0.001, 0.094, bz - 0.08 + k * 0.08);
  // Giriş: kırmızı çerçeveli krom kapı, yuvarlak saçak
  const dx = -0.02;
  box(st, 0.1, 0.17, 0.03, red, dx, 0.03, front + 0.012);
  box(st, 0.06, 0.13, 0.004, windowMat, dx, 0.034, front + 0.028);
  box(st, 0.004, 0.13, 0.005, CHROME, dx, 0.034, front + 0.029);
  add(st, new THREE.CylinderGeometry(0.06, 0.06, 0.008, 16, 1, false, -Math.PI / 2, Math.PI), cream, dx, 0.175, front + 0.025);
  // Tabelalar: önde BURGER, dondurma penceresinin üstünde DONDURMA
  box(st, 0.2, 0.042, 0.008, signMat('BURGER', '#ffd54f', '#c62828'), -0.165, 0.182, front + 0.006);
  box(st, 0.17, 0.036, 0.008, signMat('DONDURMA', '#ec407a'), 0.17, 0.185, front + 0.006);
  // Dondurma penceresi: krom tezgah, pembe-beyaz çizgili tente, vitrinde renkli kaplar
  box(st, 0.16, 0.006, 0.03, CHROME, 0.17, 0.094, front + 0.012);
  for (let k = 0; k < 6; k++) cyl(st, 0.008, 0.008, 0.006, pm(['#f48fb1', '#fff1d0', '#6d4c41', '#aed581', '#ffcc80', '#ce93d8'][k], 0.5), 0.11 + k * 0.024, 0.1, front + 0.012, 8);
  for (let k = 0; k < 6; k++) {
    const s = add(st, new THREE.BoxGeometry(0.03, 0.005, 0.07), k % 2 ? M.white : pm('#f06292', 0.7), 0.095 + k * 0.03, 0.172, front + 0.03);
    s.rotation.x = 0.4;
  }
  // Çatıda dev külah ve burger, saçak boyunca ampuller
  giantCone(st, -0.12, 0.24, bz + 0.01);
  giantBurger(st, 0.14, 0.24, bz - 0.01);
  for (let k = 0; k < 14; k++) add(st, BULB_GEO, BULB, -0.24 + k * 0.037, 0.231, front + 0.012);
  for (let k = 0; k < 6; k++) add(st, BULB_GEO, BULB, bw / 2 + 0.012, 0.231, bz - 0.1 + k * 0.04);
  // Servis penceresi (sağ yüz): küçük tente ve bekleyen araba
  box(st, 0.012, 0.07, 0.07, CHROME, bw / 2 + 0.004, 0.1, bz - 0.02);
  for (let k = 0; k < 4; k++) {
    const s = add(st, new THREE.BoxGeometry(0.06, 0.005, 0.022), k % 2 ? M.white : red, bw / 2 + 0.03, 0.185, bz - 0.053 + k * 0.022);
    s.rotation.z = -0.4;
  }
  car(st, 'hatch', 0.405, bz - 0.02, Math.PI, '#1e88e5');
  // Işıklı menü panosu ve hoparlör direği
  const mb = item(st, 0.322, 0.13, Math.PI / 2);
  box(mb, 0.13, 0.1, 0.012, M.iron, 0, 0.05, 0);
  add(mb, screenGeo(0.12, 0.09, [0, 0, 1, 1]), menuMat(), 0, 0.1, 0.0065);
  for (const sx of [-0.05, 0.05]) box(mb, 0.008, 0.05, 0.008, M.iron, sx, 0, 0);
  box(mb, 0.14, 0.008, 0.024, red, 0, 0.15, 0.004);
  cyl(st, 0.008, 0.01, 0.08, M.iron, 0.322, 0.03, 0.27, 8);
  box(st, 0.022, 0.03, 0.02, red, 0.322, 0.09, 0.27);
  // Teras: dama desenli zemin, alçak beyaz parmaklık, şemsiyeli masalar, oturan insanlar
  box(st, 0.62, 0.004, 0.46, cream, 0, 0.03, 0.245);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 6; j++) if ((i + j) % 2) box(st, 0.0775, 0.002, 0.0767, pm('#ef9a9a', 0.9), -0.31 + 0.0388 + i * 0.0775, 0.034, 0.015 + 0.0383 + j * 0.0767);
  }
  for (const sx of [-1, 1]) {
    const x = sx * 0.318;
    for (let k = 0; k <= 6; k++) rod(st, [x, 0.034, 0.03 + k * 0.065], [x, 0.07, 0.03 + k * 0.065], 0.0022, M.white, 4);
    rod(st, [x, 0.07, 0.03], [x, 0.07, 0.42], 0.003, M.white, 4);
    box(st, 0.03, 0.03, 0.07, M.darkWood, sx * 0.29, 0.034, 0.43);
    for (let k = 0; k < 6; k++) add(st, FLOWER_GEO, FLOWERS[(k + (sx > 0 ? 2 : 0)) % FLOWERS.length], sx * 0.29 + ((k % 2) - 0.5) * 0.012, 0.07, 0.405 + Math.floor(k / 2) * 0.022);
  }
  const chairRed = pm('#e53935', 0.5), chairTeal = pm('#26a69a', 0.5);
  const tables: [number, number, THREE.Material, THREE.Material, number[], [number, number][]][] = [
    [-0.18, 0.13, M.red, M.white, [0.6, 2.4, 4.2], [[0, 1], [1, 3]]],
    [0.19, 0.15, pm('#26a69a', 0.6), M.white, [0.9, 3.0, 5.0], [[1, 6]]],
    [-0.17, 0.34, pm('#fbc02d', 0.6), M.white, [1.4, 3.6], [[0, 4]]],
    [0.18, 0.36, M.red, M.white, [0.2, 2.6, 4.4], []],
  ];
  for (const [x, z, a, b, seats, sitters] of tables) {
    patioTable(st, x, z, seats, sitters, a === M.red ? chairTeal : chairRed);
    umbrella(st, x, z, 0.17, 0.075, a, b);
  }
  // Dondurma penceresinde sıra bekleyenler
  person(st, 0.15, front + 0.07, Math.PI, 5);
  person(st, 0.2, front + 0.11, Math.PI + 0.3, 7);
  // Ampul zinciri: binadan teras köşelerindeki direklere
  for (const sx of [-1, 1]) {
    const px = sx * 0.3, pz = 0.455;
    cyl(st, 0.004, 0.005, 0.2, M.iron, px, 0.03, pz, 6);
    const a = new THREE.Vector3(sx * 0.06, 0.21, front + 0.02), b = new THREE.Vector3(px, 0.225, pz);
    for (let k = 1; k < 10; k++) {
      const t = k / 10;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(t * Math.PI) * 0.03;
      add(st, BULB_GEO, BULB, p.x, p.y, p.z);
    }
  }
  return mergeStatic([st]);
}

// =====================================================================================================
// Beyaz eşya ve elektronik mağazası: oluklu metal kutu mağaza, yola bakan boydan boya cam vitrin (içi
// aydınlık; buzdolapları, çamaşır makineleri, kurutma makinesi, duvarda ve sehpada televizyonlar - ekranlar
// gece yanar), lacivert saçakta ELEKTRONİK tabelası, çatıda ışıklı reklam panosu, klimalar ve çanak anten.
// Önde otopark (park etmiş araba, televizyon kutusu taşıyan müşteri), bayraklar; sağda yükleme alanında
// arka kapıları açık teslimat kamyoneti, rampada buzdolabı kutusu ve el arabasıyla kutu taşıyan görevli.
// =====================================================================================================

// Televizyon ekranları ve reklam panosu tek dokuda (gece yanar): üstte dört ekran resmi, altta reklam
const screenMat = once(() => {
  const t = canvasTex(256, 256, x => {
    // 1: maç (yeşil saha)
    for (let k = 0; k < 8; k++) {
      x.fillStyle = k % 2 ? '#3f9b3f' : '#4caf50';
      x.fillRect(k * 16, 0, 16, 64);
    }
    x.strokeStyle = '#ffffff';
    x.lineWidth = 2;
    x.strokeRect(6, 6, 116, 52);
    x.beginPath();
    x.moveTo(64, 6);
    x.lineTo(64, 58);
    x.stroke();
    x.beginPath();
    x.arc(64, 32, 10, 0, Math.PI * 2);
    x.stroke();
    for (let k = 0; k < 8; k++) {
      x.fillStyle = k % 2 ? '#e53935' : '#1e88e5';
      x.fillRect(20 + ((k * 37) % 90), 14 + ((k * 23) % 36), 4, 6);
    }
    // 2: gün batımı ve deniz
    const gr = x.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, '#ff7043');
    gr.addColorStop(0.6, '#ffca28');
    gr.addColorStop(0.61, '#1e88e5');
    gr.addColorStop(1, '#0d47a1');
    x.fillStyle = gr;
    x.fillRect(128, 0, 128, 64);
    x.fillStyle = '#fff59d';
    x.beginPath();
    x.arc(192, 38, 13, Math.PI, 0);
    x.fill();
    // 3: çizgi film (gökyüzü, tepeler, gökkuşağı)
    x.fillStyle = '#81d4fa';
    x.fillRect(0, 64, 128, 64);
    ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5'].forEach((c, k) => {
      x.strokeStyle = c;
      x.lineWidth = 4;
      x.beginPath();
      x.arc(64, 128, 52 - k * 4, Math.PI, 0);
      x.stroke();
    });
    x.fillStyle = '#7cb342';
    x.beginPath();
    x.ellipse(30, 128, 50, 22, 0, Math.PI, 0);
    x.ellipse(100, 128, 45, 18, 0, Math.PI, 0);
    x.fill();
    // 4: deniz altı (balıklar)
    const g2 = x.createLinearGradient(0, 64, 0, 128);
    g2.addColorStop(0, '#26c6da');
    g2.addColorStop(1, '#006064');
    x.fillStyle = g2;
    x.fillRect(128, 64, 128, 64);
    for (let k = 0; k < 6; k++) {
      x.fillStyle = ['#ffb300', '#ff7043', '#ffffff'][k % 3];
      x.beginPath();
      x.ellipse(145 + ((k * 41) % 95), 78 + ((k * 17) % 40), 7, 4, 0, 0, Math.PI * 2);
      x.fill();
    }
    // Reklam panosu (alt yarı): lacivert zemin, büyük indirim yazısı, televizyon ve buzdolabı resmi
    const g3 = x.createLinearGradient(0, 128, 256, 256);
    g3.addColorStop(0, '#1a237e');
    g3.addColorStop(1, '#3949ab');
    x.fillStyle = g3;
    x.fillRect(0, 128, 256, 128);
    x.fillStyle = '#ff6f00';
    x.beginPath();
    x.arc(206, 192, 40, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#ffffff';
    x.font = 'bold 30px ui-rounded, system-ui, Arial, sans-serif';
    x.textAlign = 'center';
    x.fillText('%50', 206, 203);
    x.font = 'bold 26px ui-rounded, system-ui, Arial, sans-serif';
    x.fillText('BÜYÜK', 84, 168);
    x.fillStyle = '#ffeb3b';
    x.fillText('İNDİRİM', 84, 200);
    x.fillStyle = '#212121';
    x.fillRect(22, 214, 50, 30);
    x.fillStyle = '#4fc3f7';
    x.fillRect(25, 217, 44, 24);
    x.fillStyle = '#eceff1';
    x.fillRect(96, 206, 26, 44);
    x.fillStyle = '#90a4ae';
    x.fillRect(96, 222, 26, 2);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return glowMat(t, t, 0.25, 0.1);
});
const SCREENS: [number, number, number, number][] = [[0, 0.75, 0.5, 1], [0.5, 0.75, 1, 1], [0, 0.5, 0.5, 0.75], [0.5, 0.5, 1, 0.75]];
const AD: [number, number, number, number] = [0, 0, 1, 0.5];
// Vitrin camı: hafif mavi, çok saydam (içerideki eşyalar net görünsün)
const SHOP_GLASS = new THREE.MeshStandardMaterial({ color: '#d8efff', transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.2, depthWrite: false });
// Mağazanın içi: aydınlık beyaz duvar (gece yanar)
const litWall = once(() => {
  const m = new THREE.MeshStandardMaterial({ color: '#f3f1ec', roughness: 0.8 });
  m.name = 'window';
  return m;
});
// Buzdolabı (yüzü +z): kind 0 çelik çift kapılı, 1 beyaz alttan donduruculu, 2 kırmızı retro
function fridge(g: THREE.Object3D, x: number, z: number, kind: number) {
  const w = kind === 0 ? 0.07 : 0.05, h = kind === 2 ? 0.13 : 0.15;
  const body = kind === 0 ? pm('#c3c9cf', 0.35, 0.4) : kind === 1 ? M.white : pm('#e53935', 0.4);
  box(g, w, h, 0.045, body, x, 0.036, z);
  const f = z + 0.0226;
  if (kind === 0) {
    box(g, 0.0015, h - 0.01, 0.002, M.iron, x, 0.041, f);
    for (const sx of [-1, 1]) box(g, 0.003, 0.05, 0.004, CHROME, x + sx * 0.005, 0.1, f + 0.002);
    box(g, 0.018, 0.026, 0.002, pm('#37474f', 0.4), x - 0.018, 0.11, f);
  } else {
    box(g, w - 0.004, 0.0015, 0.002, M.iron, x, 0.036 + h * 0.36, f);
    box(g, 0.003, 0.03, 0.004, CHROME, x + w / 2 - 0.008, 0.036 + h * 0.5, f + 0.002);
    box(g, 0.003, 0.02, 0.004, CHROME, x + w / 2 - 0.008, 0.036 + h * 0.12, f + 0.002);
  }
}
// Çamaşır makinesi (yüzü +z): beyaz gövde, yuvarlak kapak, düğme paneli
const DOOR_GLASS = pm('#5b7f95', 0.15, 0.3);
function washer(g: THREE.Object3D, x: number, y: number, z: number, dark = false) {
  box(g, 0.06, 0.066, 0.05, dark ? pm('#54606b', 0.4, 0.3) : M.white, x, y, z);
  const f = z + 0.025;
  box(g, 0.056, 0.012, 0.002, pm('#cfd8dc', 0.5), x, y + 0.05, f);
  add(g, new THREE.TorusGeometry(0.018, 0.0035, 6, 16), CHROME, x, y + 0.028, f + 0.002);
  add(g, new THREE.CircleGeometry(0.016, 16), DOOR_GLASS, x, y + 0.028, f + 0.0015);
  add(g, new THREE.CylinderGeometry(0.004, 0.004, 0.003, 8).rotateX(Math.PI / 2), M.iron, x + 0.018, y + 0.056, f + 0.002);
}
// Televizyon (yüzü +z): ince siyah çerçeve, resimli ekran (k: hangi resim)
function tv(g: THREE.Object3D, x: number, y: number, z: number, w: number, k: number) {
  const h = w * 0.58;
  box(g, w, h, 0.005, pm('#1b1d21', 0.4), x, y, z);
  add(g, screenGeo(w - 0.006, h - 0.006, SCREENS[k % 4]), screenMat(), x, y + h / 2, z + 0.0027);
}
// Karton kutu (koli bantlı); arrow: üstünde ok işaretleri
function carton(g: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, rot = 0) {
  const c = item(g, x, z, rot, 1, y);
  box(c, w, h, d, CARDBOARD, 0, 0, 0);
  box(c, w + 0.001, 0.008, d + 0.001, TAPE, 0, h * 0.8, 0);
  box(c, 0.008, h + 0.001, d + 0.001, TAPE, 0, 0, 0);
  box(c, w * 0.5, h * 0.25, 0.001, pm('#1a237e', 0.7), 0, h * 0.35, d / 2 + 0.0005);
  return c;
}
// Rüzgâr bayrağı (yelken biçimli)
function featherFlag(g: THREE.Object3D, x: number, z: number, color: THREE.Material, accent: THREE.Material) {
  rod(g, [x, 0.03, z], [x, 0.26, z], 0.002, M.iron, 4);
  const s = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.035, 0.01), new THREE.Vector2(0.04, 0.12), new THREE.Vector2(0.02, 0.17), new THREE.Vector2(0, 0.17)]);
  add(g, new THREE.ExtrudeGeometry(s, { depth: 0.002, bevelEnabled: false }), color, x, 0.08, z).rotation.y = Math.PI / 4;
  add(g, new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0.06), new THREE.Vector2(0.038, 0.07), new THREE.Vector2(0.038, 0.085), new THREE.Vector2(0, 0.075)]), { depth: 0.0025, bevelEnabled: false }), accent, x, 0.08, z - 0.0002).rotation.y = Math.PI / 4;
}
// El arabası (çatallı yük arabası): yüzü +z, üstünde kutu
function handTruck(g: THREE.Object3D, x: number, z: number, rot: number) {
  const h = item(g, x, z, rot);
  for (const sx of [-1, 1]) {
    rod(h, [sx * 0.016, 0.01, 0.0], [sx * 0.016, 0.13, -0.035], 0.0022, M.red, 4);
    add(h, new THREE.CylinderGeometry(0.01, 0.01, 0.006, 10).rotateZ(Math.PI / 2), M.iron, sx * 0.024, 0.01, -0.008);
  }
  rod(h, [-0.016, 0.13, -0.035], [0.016, 0.13, -0.035], 0.0025, M.iron, 4);
  box(h, 0.04, 0.003, 0.02, M.gray, 0, 0.0, 0.01);
  const c = carton(h, 0.05, 0.075, 0.045, 0, 0.003, 0.008, 0);
  c.rotation.x = -0.27;
}

export function makeElectro(): THREE.Object3D {
  const st = new THREE.Group();
  box(st, 0.96, 0.03, 0.96, M.paving, 0, 0, 0);
  // Mağaza kutusu: arkada dolu gövde (oluklu metal), önde 0.14 derin, boydan boya camlı vitrin (aydınlık iç duvar)
  const X0 = -0.47, X1 = 0.15, Z0 = -0.46, ZF = 0.06, DEPTH = 0.14, TOP = 0.3, GT = 0.265;
  const cxs = (X0 + X1) / 2, W = X1 - X0;
  const metal = KIT.METAL[1];
  const navy = pm('#1a237e', 0.5), orange = pm('#ff6f00', 0.5), dark = pm('#263238', 0.5);
  const zi = ZF - DEPTH; // iç duvar
  st.add(part(KIT.facadeBox(W, TOP - 0.03, zi - Z0, 0.03), metal, cxs, 0.03 + (TOP - 0.03) / 2, (Z0 + zi) / 2));
  for (const x of [X0 + 0.012, X1 - 0.012]) st.add(part(KIT.facadeBox(0.024, TOP - 0.03, DEPTH, 0.03), metal, x, 0.03 + (TOP - 0.03) / 2, zi + DEPTH / 2));
  st.add(part(new THREE.BoxGeometry(W - 0.03, TOP - 0.035, 0.002), litWall(), cxs, 0.03 + (TOP - 0.035) / 2, zi + 0.001));
  box(st, W - 0.024, 0.006, DEPTH, pm('#e3e6ea', 0.4), cxs, 0.03, zi + DEPTH / 2);
  // İç duvarda raflar ve küçük ev aletleri (mikrodalga, süpürge kutuları)
  for (const y of [0.09, 0.15]) {
    box(st, 0.2, 0.004, 0.025, pm('#90a4ae', 0.5), -0.33, y, zi + 0.014);
    for (let k = 0; k < 4; k++) box(st, 0.036, 0.024, 0.02, [M.white, pm('#37474f', 0.5), pm('#e53935', 0.5), M.white][(k + (y > 0.1 ? 1 : 0)) % 4], -0.405 + k * 0.05, y + 0.004, zi + 0.014);
  }
  // Çatı: kenar duvarı (parapet) ve çatı zarı
  box(st, W + 0.006, 0.01, ZF - Z0 + 0.006, pm('#9aa3ad', 0.9), cxs, TOP, (Z0 + ZF) / 2);
  for (const [w, d, x, z] of [[W + 0.012, 0.012, cxs, Z0], [0.012, ZF - Z0, X0, (Z0 + ZF) / 2], [0.012, ZF - Z0, X1, (Z0 + ZF) / 2]] as [number, number, number, number][]) box(st, w, 0.026, d, pm('#dfe3e8', 0.6), x, TOP, z);
  // Ön cam (ince siyah dikmeler); üstte lacivert saçak, turuncu şerit, ELEKTRONİK tabelası ve şimşek logosu
  box(st, W - 0.03, GT - 0.036, 0.004, SHOP_GLASS, cxs, 0.036, ZF);
  for (let k = 0; k <= 6; k++) box(st, 0.006, GT - 0.036, 0.008, dark, X0 + 0.015 + (k * (W - 0.03)) / 6, 0.036, ZF);
  box(st, W - 0.03, 0.006, 0.008, dark, cxs, 0.17, ZF);
  // Saçak, çatı kenar duvarından biraz yüksek (üstleri aynı boyda titreşiyordu)
  box(st, W + 0.014, TOP + 0.03 - GT, 0.03, navy, cxs, GT, ZF - 0.008);
  box(st, 0.03, TOP + 0.03 - GT, 0.16, navy, X1 + 0.001, GT, ZF - 0.07);
  box(st, W + 0.016, 0.01, 0.032, orange, cxs, GT, ZF - 0.008);
  box(st, 0.032, 0.01, 0.162, orange, X1 + 0.001, GT, ZF - 0.07);
  box(st, 0.44, 0.052, 0.006, signMat('ELEKTRONİK', '#1a237e', '#ffeb3b'), cxs - 0.05, GT + 0.012, ZF + 0.009);
  add(st, new THREE.CylinderGeometry(0.024, 0.024, 0.006, 16).rotateX(Math.PI / 2), orange, X1 - 0.065, GT + 0.04, ZF + 0.009);
  const bolt = new THREE.Shape([new THREE.Vector2(0.004, 0.018), new THREE.Vector2(-0.008, -0.002), new THREE.Vector2(0.0, -0.002), new THREE.Vector2(-0.004, -0.018), new THREE.Vector2(0.008, 0.003), new THREE.Vector2(0.0, 0.003)]);
  add(st, new THREE.ExtrudeGeometry(bolt, { depth: 0.002, bevelEnabled: false }), M.white, X1 - 0.065, GT + 0.04, ZF + 0.012);
  // Yan yüzde de logo
  add(st, new THREE.CylinderGeometry(0.024, 0.024, 0.006, 16).rotateZ(Math.PI / 2), orange, X1 + 0.019, GT + 0.033, ZF - 0.07);
  add(st, new THREE.ExtrudeGeometry(bolt, { depth: 0.002, bevelEnabled: false }).rotateY(Math.PI / 2), M.white, X1 + 0.022, GT + 0.033, ZF - 0.07);
  // Giriş: otomatik kapı, kapı üstü saçak, paspas
  const dx = -0.1;
  box(st, 0.09, 0.16, 0.006, dark, dx, 0.036, ZF + 0.002);
  for (const sx of [-1, 1]) box(st, 0.038, 0.15, 0.004, windowMat, dx + sx * 0.02, 0.036, ZF + 0.006);
  box(st, 0.13, 0.008, 0.07, navy, dx, 0.2, ZF + 0.035);
  box(st, 0.1, 0.002, 0.05, pm('#37474f', 1), dx, 0.03, ZF + 0.03);
  // Vitrinde (sol): buzdolapları, çamaşır ve kurutma makineleri (camın hemen arkasında)
  const zc = ZF - 0.04;
  fridge(st, -0.415, zc, 0);
  fridge(st, -0.34, zc, 1);
  fridge(st, -0.28, zc, 2);
  washer(st, -0.215, 0.036, zc + 0.005);
  washer(st, -0.215, 0.102, zc + 0.005, true);
  // Vitrinde (sağ): televizyon duvarı, sehpada dev televizyon, ses sistemi
  box(st, 0.15, 0.2, 0.01, pm('#37474f', 0.6), 0.055, 0.036, zc - 0.012);
  tv(st, 0.015, 0.165, zc - 0.006, 0.07, 1);
  tv(st, 0.095, 0.165, zc - 0.006, 0.07, 2);
  tv(st, 0.015, 0.115, zc - 0.006, 0.07, 3);
  tv(st, 0.095, 0.115, zc - 0.006, 0.07, 1);
  box(st, 0.13, 0.024, 0.03, dark, 0.055, 0.036, zc + 0.012);
  tv(st, 0.055, 0.07, zc + 0.012, 0.1, 0);
  box(st, 0.008, 0.01, 0.008, M.iron, 0.055, 0.06, zc + 0.012);
  box(st, 0.06, 0.008, 0.012, pm('#212121', 0.5), 0.055, 0.06, zc + 0.026);
  // Çatı: ışıklı reklam panosu (çelik ayaklar, üstte lambalar), güneş panelleri, klimalar, çanak anten
  const bzp = -0.36;
  for (const x of [cxs - 0.12, cxs + 0.12]) {
    box(st, 0.012, 0.2, 0.012, M.gray, x, TOP, bzp);
    rod(st, [x, TOP + 0.01, bzp - 0.07], [x, TOP + 0.19, bzp - 0.004], 0.004, M.gray, 4);
  }
  box(st, 0.36, 0.19, 0.012, dark, cxs, TOP + 0.13, bzp + 0.006);
  add(st, screenGeo(0.344, 0.172, AD), screenMat(), cxs, TOP + 0.225, bzp + 0.0125);
  box(st, 0.36, 0.006, 0.03, M.gray, cxs, TOP + 0.122, bzp + 0.02);
  for (let k = 0; k < 4; k++) {
    add(st, BULB_GEO, BULB, cxs - 0.13 + k * 0.087, TOP + 0.33, bzp + 0.03);
    box(st, 0.006, 0.006, 0.03, M.gray, cxs - 0.13 + k * 0.087, TOP + 0.322, bzp + 0.018);
  }
  const PANEL = pm('#1f3d72', 0.25, 0.4);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const p = item(st, -0.41 + c * 0.075, -0.22 + r * 0.085, 0, 1, TOP + 0.02);
      const tilt = item(p, 0, 0, 0, 1, 0.012);
      tilt.rotation.x = 0.35;
      box(tilt, 0.068, 0.004, 0.06, PANEL, 0, 0, 0);
      box(tilt, 0.069, 0.0045, 0.003, M.white, 0, 0, 0);
      box(tilt, 0.003, 0.0045, 0.061, M.white, 0, 0, 0);
      box(p, 0.004, 0.022, 0.004, M.gray, 0, -0.01, -0.02);
    }
  }
  for (const [x, z] of [[0.06, -0.05], [0.06, 0.0]]) {
    box(st, 0.07, 0.035, 0.04, pm('#cfd8dc', 0.5), x, TOP + 0.01, z);
    add(st, new THREE.CylinderGeometry(0.014, 0.014, 0.003, 14), M.iron, x - 0.015, TOP + 0.046, z);
    add(st, new THREE.CylinderGeometry(0.014, 0.014, 0.003, 14), M.iron, x + 0.017, TOP + 0.046, z);
  }
  const dish = item(st, 0.08, -0.2, -Math.PI / 4, 1, TOP + 0.01);
  cyl(dish, 0.004, 0.006, 0.04, M.gray, 0, 0, 0, 6);
  add(dish, new THREE.SphereGeometry(0.035, 14, 6, 0, Math.PI * 2, 0, 0.9).rotateX(-Math.PI / 2 - 0.5), M.white, 0, 0.05, 0.01);
  rod(dish, [0, 0.05, 0.012], [0, 0.07, 0.05], 0.0015, M.gray, 4);
  // Önde meydan: kaldırımda kampanyalı beyaz eşyalar (fiyat etiketli), bayraklar, saksılar
  box(st, W + 0.02, 0.003, 0.42, M.stone, cxs + 0.01, 0.03, ZF + 0.21);
  for (let k = 0; k < 8; k++) box(st, 0.002, 0.0005, 0.42, pm('#d5cbb5', 1), X0 + 0.08 * k + 0.04, 0.0335, ZF + 0.21);
  const tag = pm('#ffeb3b', 0.6);
  const zs = ZF + 0.07;
  box(st, 0.25, 0.008, 0.07, pm('#b0bec5', 0.6), -0.335, 0.03, zs);
  fridge(st, -0.42, zs, 1);
  washer(st, -0.355, 0.038, zs - 0.004);
  washer(st, -0.29, 0.038, zs - 0.004);
  fridge(st, -0.235, zs, 0);
  for (const x of [-0.42, -0.355, -0.29, -0.235]) box(st, 0.022, 0.016, 0.002, tag, x, x === -0.42 || x === -0.235 ? 0.09 : 0.075, zs + 0.0275); // kapı kollarının önünde
  box(st, 0.16, 0.035, 0.004, signMat('KAMPANYA', '#ff6f00'), -0.33, 0.2, ZF + 0.005);
  featherFlag(st, -0.45, 0.42, orange, navy);
  featherFlag(st, 0.12, 0.42, navy, orange);
  for (const x of [0.0, 0.1]) {
    box(st, 0.05, 0.03, 0.04, pm('#455a64', 0.6), x, 0.03, ZF + 0.06);
    add(st, new THREE.IcosahedronGeometry(0.022, 1), LEAVES[0], x, 0.078, ZF + 0.06);
  }
  // Yol kenarında park etmiş araba, bagajına televizyon kutusu taşıyan müşteri
  car(st, 'hatch', -0.27, 0.4, Math.PI / 2, '#c62828');
  carton(st, 0.08, 0.052, 0.012, -0.11, 0.064, 0.3, 1.2);
  person(st, -0.1, 0.285, 1.2, 3, 'carry');
  person(st, -0.05, ZF + 0.08, Math.PI + 0.3, 6);
  person(st, -0.39, ZF + 0.14, Math.PI - 0.2, 4);
  lamp(st, 0.155, 0.46);
  // Sağda yükleme alanı: asfalt, sarı çizgiler, yükleme kapısı, teslimat kamyoneti ve kutular
  box(st, 0.31, 0.004, 0.96, ASPHALT, 0.325, 0.03, 0);
  box(st, 0.004, 0.001, 0.96, pm('#f2c14e', 0.6), 0.172, 0.034, 0);
  for (let k = 0; k < 6; k++) {
    const s = box(st, 0.012, 0.001, 0.09, pm('#f2c14e', 0.6), 0.22 + k * 0.045, 0.034, -0.12);
    s.rotation.y = 0.6;
  }
  const dz = -0.3;
  box(st, 0.006, 0.16, 0.13, pm('#e9edf1', 0.5, 0.3), X1 + 0.003, 0.03, dz);
  for (let k = 0; k < 7; k++) box(st, 0.008, 0.003, 0.122, M.gray, X1 + 0.004, 0.05 + k * 0.021, dz); // çıtalar kapıdan dar
  box(st, 0.05, 0.01, 0.16, navy, X1 + 0.025, 0.21, dz);
  for (const z of [dz - 0.07, dz + 0.07]) box(st, 0.012, 0.03, 0.012, M.iron, X1 + 0.006, 0.03, z);
  const vx = 0.33, vz = 0.14;
  car(st, 'van', vx, vz, 0, '#ffffff');
  // Kamyonetin yan yüzünde mağaza renkleri
  box(st, 0.002, 0.026, 0.15, navy, vx + 0.06, 0.07, vz - 0.03);
  box(st, 0.002, 0.008, 0.15, orange, vx + 0.06, 0.098, vz - 0.03);
  // Açık arka kapılar ve yere inmiş asansörlü rampa, üstünde buzdolabı kutusu
  const rz = vz - 0.14;
  for (const sx of [-1, 1]) {
    const d = item(st, vx + sx * 0.058, rz, sx * 1.9, 1, 0.045);
    box(d, 0.003, 0.085, 0.055, M.white, 0, 0, 0.0275);
  }
  box(st, 0.1, 0.004, 0.06, M.gray, vx, 0.03, rz - 0.03);
  carton(st, 0.05, 0.14, 0.045, vx + 0.01, 0.034, rz - 0.03, 0.1);
  person(st, vx - 0.05, rz - 0.06, -Math.PI / 2 - 0.4, 1, 'stand', 0.03, 0.9, orange);
  // El arabasıyla kutu götüren görevli (yükleme kapısına doğru)
  handTruck(st, 0.235, -0.22, -Math.PI / 2 - 0.4);
  person(st, 0.285, -0.2, -Math.PI / 2 - 0.4, 0, 'push', 0.03, 0.9, orange);
  // Palette kutular
  box(st, 0.11, 0.012, 0.09, M.wood, 0.25, 0.03, -0.42);
  carton(st, 0.05, 0.06, 0.04, 0.225, 0.042, -0.4);
  carton(st, 0.05, 0.06, 0.04, 0.277, 0.042, -0.4);
  carton(st, 0.05, 0.05, 0.04, 0.25, 0.102, -0.4, 0.1);
  carton(st, 0.06, 0.07, 0.05, 0.4, 0.03, -0.42, 0.3);
  lamp(st, 0.46, 0.46);
  return mergeStatic([st]);
}

// Yeni 2x2 otoparklı dükkânlar (stores.ts) aynı parçaları kullanır
export {
  person, car, greenhouse, sapling, flowerStand, gnome, wheelbarrow, soilPallet, plantCart, potStack, umbrella, patioTable,
  giantCone, giantBurger, fridge, washer, tv, carton, featherFlag, handTruck, roundedBox, screenGeo, screenMat, menuMat,
  SCREENS, AD, SHOP_GLASS, litWall, waffleMat, rng, canvasTex, glowMat, once, tiledBox, gableGeo, arrow,
  CHROME, CARDBOARD, TAPE, TERRACOTTA, POT, GRAVEL, FRAME, CONCRETE, LEAVES, BLOSSOM, PINE, ASPHALT, LINE, LEAF_MOUND, BLOOM, DOOR_GLASS,
};
