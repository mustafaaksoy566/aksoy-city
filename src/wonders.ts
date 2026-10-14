import * as THREE from 'three';
import { PROPS, type DecorKind } from './config';
import { part, windowMat } from './utilities';
import { mergeStatic } from './batcher';
import { SEA_Y } from './water';
import { pm, BULB, WATER, UP, type V3, add, box, cyl, rod, item, bench, lamp, frame, basin, frustum, tree } from './parts';
import { carModel } from './cars';
import { EXTRA_DECOR, archGeo, dome, gable, pitched, stoneMat, stoneUV, rock, motorYacht } from './landmarks';

// Dünya harikaları: Özgürlük Anıtı, Kız Kulesi, Ayasofya, Tac Mahal, Big Ben, Parthenon, Chichen Itza,
// Sidney Opera Binası, Stonehenge, Kapadokya (uçan balonlarıyla), Efes (Celsus Kütüphanesi), Pamukkale ve
// Truva Atı. Hepsi kodla
// çizilir; dokular da (bayrak, saat kadranı, gotik cephe, karo, tüf katmanları, balon boyası) tuvale kodla boyanır. Yerel ölçü 1x1: n karelik yapı n*0.96 kat büyütülür, içindeki bank, lamba ve
// ağaç gibi eşyalar 1/(n*0.96) ile küçültülür. y = 0 yol hizası, zemin plakası 0.03'te biter; ön yüz +z yola
// bakar (Opera'da suya, Kız Kulesi denizin içinde). Sabit parçalar tek parçada birleştirilir.

// --- Ortak yardımcılar ---
const small = (n: number) => 1 / (n * 0.96);
const hash = (k: number) => {
  const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
// Parlak metal: birleştirilince köşe rengine dönüp parlaklığını kaybetmesin diye beyaz dokulu
const WHITE = (() => {
  const t = new THREE.DataTexture(new Uint8Array(64).fill(255), 4, 4);
  t.needsUpdate = true;
  return t;
})();
const shiny = (color: string, metal: number, rough: number) => new THREE.MeshStandardMaterial({ color, map: WHITE, metalness: metal, roughness: rough });
// Gece yanan ışık (DayNight 'lamp' adlı malzemeleri yakar)
const lit = (color: string, metal = 0, rough = 0.5) => {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, metalness: metal, roughness: rough });
  m.name = 'lamp';
  return m;
};
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
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
// Kutu: yüzlerin doku koordinatı gerçek ölçüye göre (cu x cv bir doku tekrarı). y0: dokuyu katlara hizalar
function uvBox(w: number, h: number, d: number, cu: number, cv: number, y0 = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const span: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x, -x, +y, -y, +z, -z
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const [su, sv] = span[f];
      const v = f === 2 || f === 3 ? uv.getY(i) * sv : uv.getY(i) * sv + y0;
      uv.setXY(i, (uv.getX(i) * su) / cu, v / cv);
    }
  }
  return g;
}
// Döner yüzey: [yarıçap, y] noktaları
const lathe = (pts: [number, number][], seg = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
// İki nokta arasında incelen uzuv (r0 a ucunda, r1 b ucunda)
function limb(g: THREE.Object3D, a: V3, b: V3, r0: number, r1: number, m: THREE.Material, seg = 10) {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const o = add(g, new THREE.CylinderGeometry(r1, r0, d.length(), seg), m, A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
  return o;
}
// Bir doğrultuya bakan koni (ucu dir yönünde, tabanı p'de)
function spike(g: THREE.Object3D, p: THREE.Vector3, dir: THREE.Vector3, r: number, len: number, m: THREE.Material, seg = 4) {
  const o = add(g, new THREE.ConeGeometry(r, len, seg), m, p.x + (dir.x * len) / 2, p.y + (dir.y * len) / 2, p.z + (dir.z * len) / 2);
  o.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  return o;
}
const plant = (g: THREE.Object3D, path: string, x: number, z: number, n: number, size = 0.6, rot = 0) => tree(g, path, x, z, size * small(n), rot);
// Bayrak: iki yüzü de görünen dokulu levha ve direği
function flag(g: THREE.Object3D, tex: THREE.Texture, x: number, y: number, z: number, h: number, w: number, rot = 0) {
  rod(g, [x, y, z], [x, y + h, z], w * 0.035, POLE, 6);
  let m = FLAG_MATS.get(tex);
  if (!m) FLAG_MATS.set(tex, (m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 })));
  const f = add(g, new THREE.PlaneGeometry(w, w * 0.66).translate(w / 2, 0, 0), m, x, y + h - w * 0.36, z);
  f.rotation.y = rot;
}
const POLE = pm('#e8e8e4', 0.4);
const FLAG_MATS = new Map<THREE.Texture, THREE.Material>();
// Köşeleri yuvarlatılmış dikdörtgen biçim (x, z düzleminde; Extrude'dan sonra -x ekseninde döndürülür)
function roundRect(x: number, z: number, w: number, d: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(x + r, z);
  s.lineTo(x + w - r, z);
  s.quadraticCurveTo(x + w, z, x + w, z + r);
  s.lineTo(x + w, z + d - r);
  s.quadraticCurveTo(x + w, z + d, x + w - r, z + d);
  s.lineTo(x + r, z + d);
  s.quadraticCurveTo(x, z + d, x, z + d - r);
  s.lineTo(x, z + r);
  s.quadraticCurveTo(x, z, x + r, z);
  return s;
}
// Biçimi yere yatır: Shape'in (x, y) noktası dünyada (x, -y) olur; bu yüzden biçimler z'si ters çizilir
const flat = (geo: THREE.BufferGeometry) => geo.rotateX(-Math.PI / 2);
// Doku tekrarını sıklaştır (taşlar küçük görünsün)
function fineUV(geo: THREE.BufferGeometry, k: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  return geo;
}
// Düz gölgeli (köşeli) yüzey: kaya, taş blok
const faceted = (geo: THREE.BufferGeometry) => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
};

// --- Bayraklar ---
function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, r: number, rot: number) {
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = rot + (k * Math.PI) / 5;
    const rr = k % 2 ? r : R;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (k) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
}
const TR_FLAG = canvasTex(96, 64, g => {
  g.fillStyle = '#e30a17';
  g.fillRect(0, 0, 96, 64);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(34, 32, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e30a17';
  g.beginPath();
  g.arc(38, 32, 12.8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  starPath(g, 55, 32, 8, 3.2, Math.PI);
});
const US_FLAG = canvasTex(96, 64, g => {
  for (let k = 0; k < 13; k++) {
    g.fillStyle = k % 2 ? '#ffffff' : '#b22234';
    g.fillRect(0, (k * 64) / 13, 96, 64 / 13 + 0.5);
  }
  g.fillStyle = '#3c3b6e';
  g.fillRect(0, 0, 40, 34);
  g.fillStyle = '#ffffff';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) g.fillRect(3 + c * 6.3, 3 + r * 6.4, 1.6, 1.6);
});
const UK_FLAG = canvasTex(96, 64, g => {
  g.fillStyle = '#012169';
  g.fillRect(0, 0, 96, 64);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(96, 64);
  g.moveTo(96, 0);
  g.lineTo(0, 64);
  g.stroke();
  g.strokeStyle = '#c8102e';
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fillRect(38, 0, 20, 64);
  g.fillRect(0, 22, 96, 20);
  g.fillStyle = '#c8102e';
  g.fillRect(42, 0, 12, 64);
  g.fillRect(0, 26, 96, 12);
});

// ======================= Özgürlük Anıtı (2x2) =======================
// Liberty Adası: çimen, kıyıda yürüyüş halkası ve ağaçlar; ortada on bir köşeli yıldız biçimli Fort Wood
// kalesi, üstünde granit kaide (kademeli taban, kesme taş gövde, her yüzde sütunlu loca ve yuvarlak kalkan
// dizisi, saçak ve seyir terası). Heykel bakır yeşili (patina): kıvrımlı uzun elbise (chiton) ve çapraz
// atılmış pelerin, yedi ışınlı taç, havaya kaldırılmış sağ kolda altın yaldızlı meşale (gece yanar), sol
// kolunda kitabe. Elbisenin kıvrımları köşe renkleriyle gölgelenir.
const LIB = {
  stone: stoneMat('#e4dccd'),
  fort: stoneMat('#d3c9b7'),
  trim: pm('#d8cfbf', 0.85),
  dark: pm('#7d7466', 0.9),
  lawn: pm('#6fbf55', 1),
  paving: pm('#d9d2c3', 0.95),
  copper: pm('#74b39e', 0.75),
  robe: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }),
  gilt: shiny('#d9a93a', 0.75, 0.3),
  flame: lit('#f2c040', 0.6, 0.3),
};
// Elbise: yükseklikle değişen yarıçap (x) ve derinlik oranı (z/x); alt kısım geniş, bel ince, omuzlar geniş ve yassı
const ROBE: [number, number, number][] = [
  [0, 0.09, 0.86], [0.05, 0.088, 0.85], [0.15, 0.08, 0.82], [0.28, 0.069, 0.78], [0.38, 0.061, 0.74], [0.46, 0.063, 0.72],
  [0.52, 0.069, 0.68], [0.57, 0.075, 0.6], [0.6, 0.068, 0.6], [0.62, 0.046, 0.72], [0.64, 0.02, 1],
];
function robeAt(y: number): [number, number] {
  for (let k = 1; k < ROBE.length; k++) {
    if (y <= ROBE[k][0]) {
      const [y0, r0, k0] = ROBE[k - 1], [y1, r1, k1] = ROBE[k];
      const t = THREE.MathUtils.smoothstep(y, y0, y1);
      return [r0 + (r1 - r0) * t, k0 + (k1 - k0) * t];
    }
  }
  return [ROBE[ROBE.length - 1][1], 1];
}
function robeGeo() {
  const NA = 48, NY = 64, TOP = 0.64;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const light = new THREE.Color('#9fd3bf'), dark = new THREE.Color('#3f7f6d'), c = new THREE.Color();
  for (let j = 0; j <= NY; j++) {
    const y = (TOP * j) / NY;
    const [r, k] = robeAt(y);
    const fade = 1 - THREE.MathUtils.smoothstep(y, 0.55, 0.63);
    for (let i = 0; i <= NA; i++) {
      // Dikiş arkada kalsın: açı 0 = ön (+z)
      const a = Math.PI + (i / NA) * Math.PI * 2;
      // Pelerin: sol omzun üstünden çapraz iner; sağ önde yüksekte, sol arkada aşağıda biter
      const hem = 0.17 + 0.08 * Math.cos(a + Math.PI / 4);
      const top = 0.5 + 0.07 * Math.cos(a - Math.PI / 2);
      const mantle = y > hem && y < top;
      const fold = mantle
        ? 0.75 * Math.sin(7 * a + 11 * y) + 0.25 * Math.sin(13 * a - 5 * y)
        : 0.6 * Math.sin(17 * a + 2 * y) + 0.4 * Math.sin(29 * a - 3 * y + 1);
      const amp = (mantle ? 0.055 : 0.032) * fade;
      const rr = r * (1 + amp * fold) + (mantle ? 0.005 * fade : 0);
      pos.push(Math.sin(a) * rr, y, Math.cos(a) * rr * k);
      // Kıvrımın içi koyu, sırtı açık; bakır akıntısı gibi hafif dikey çizgiler
      const streak = 0.5 + 0.5 * Math.sin(a * 23 + Math.sin(y * 40) * 0.6);
      c.copy(dark).lerp(light, THREE.MathUtils.clamp(0.55 + fold * 0.3 * (amp > 0 ? 1 : 0) + (streak - 0.5) * 0.15, 0, 1));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NA; i++) {
      const a = j * (NA + 1) + i, b = a + 1, d = a + NA + 1, e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
// Heykel (boyu 1: ayaktan meşalenin ucuna). Yüzü +z; sağ kolu -x tarafında.
function libertyFigure() {
  const f = new THREE.Group();
  const C = LIB.copper;
  f.add(part(robeGeo(), LIB.robe, 0, 0, 0));
  // Ön ayağın ucu elbisenin altından görünür
  box(f, 0.03, 0.014, 0.024, C, 0.024, 0, 0.078);
  // Boyun, baş, toplu saç
  cyl(f, 0.021, 0.025, 0.05, C, 0, 0.615, 0.003, 12);
  add(f, new THREE.SphereGeometry(0.037, 16, 12), C, 0, 0.693, 0.008).scale.set(0.9, 1.12, 1);
  add(f, new THREE.SphereGeometry(0.035, 14, 10), C, 0, 0.7, -0.01).scale.set(1, 1.04, 1.05);
  box(f, 0.008, 0.014, 0.01, C, 0, 0.684, 0.043);
  // Taç: alın bandı ve yedi ışın (önde yelpaze gibi açılır)
  add(f, new THREE.CylinderGeometry(0.04, 0.042, 0.018, 18), C, 0, 0.728, 0.004);
  for (let k = 0; k < 7; k++) {
    const a = -1.35 + k * 0.45;
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(0.38), Math.sin(0.38), Math.cos(a) * Math.cos(0.38));
    spike(f, new THREE.Vector3(Math.sin(a) * 0.04, 0.732, 0.004 + Math.cos(a) * 0.04), dir, 0.007, 0.078, C);
  }
  // Sağ kol: omuzdan yukarı kalkar, kolun altından elbisenin yeni sarkar
  const S: V3 = [-0.062, 0.582, 0.004], E: V3 = [-0.088, 0.735, 0.012], W: V3 = [-0.079, 0.865, 0.02];
  add(f, new THREE.SphereGeometry(0.025, 10, 8), C, ...S);
  limb(f, S, E, 0.025, 0.019, C);
  add(f, new THREE.SphereGeometry(0.019, 10, 8), C, ...E);
  limb(f, E, W, 0.017, 0.013, C);
  limb(f, [-0.094, 0.72, 0.006], [-0.106, 0.6, -0.002], 0.006, 0.024, C);
  add(f, new THREE.SphereGeometry(0.015, 10, 8), C, ...W);
  // Meşale: sap, yaldızlı kase ve korkuluk, altın alev (gece yanar)
  const tx = W[0] + 0.002, ty = W[1] + 0.05, tz = W[2] + 0.002;
  limb(f, [W[0], W[1] - 0.012, W[2]], [tx, ty, tz], 0.008, 0.01, LIB.gilt, 8);
  add(f, lathe([[0.007, 0], [0.019, 0.012], [0.026, 0.02], [0.028, 0.026], [0, 0.026]], 18), LIB.gilt, tx, ty, tz);
  add(f, new THREE.TorusGeometry(0.029, 0.0022, 4, 22).rotateX(Math.PI / 2), LIB.gilt, tx, ty + 0.031, tz);
  add(f, lathe([[0, 0], [0.014, 0.006], [0.018, 0.018], [0.014, 0.034], [0.007, 0.048], [0, 0.06]], 16), LIB.flame, tx, ty + 0.025, tz);
  // Sol kol: dirsekten öne kıvrılır, kitabeyi göğsüne dayar
  const LS: V3 = [0.066, 0.568, 0.0], LE: V3 = [0.09, 0.455, 0.018], LH: V3 = [0.072, 0.47, 0.064];
  add(f, new THREE.SphereGeometry(0.023, 10, 8), C, ...LS);
  limb(f, LS, LE, 0.022, 0.017, C);
  add(f, new THREE.SphereGeometry(0.017, 10, 8), C, ...LE);
  limb(f, LE, LH, 0.015, 0.012, C);
  add(f, new THREE.SphereGeometry(0.013, 8, 6), C, ...LH);
  const tab = new THREE.Shape([new THREE.Vector2(-0.023, 0), new THREE.Vector2(0.023, 0), new THREE.Vector2(0.028, 0.09), new THREE.Vector2(-0.028, 0.09)]);
  const t = add(f, new THREE.ExtrudeGeometry(tab, { depth: 0.013, bevelEnabled: false }).translate(0, 0, -0.0065), C, 0.084, 0.462, 0.052);
  t.rotation.set(-0.22, 0.4, -0.14);
  return f;
}
function liberty() {
  const n = 2, s = small(n);
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, LIB.lawn, 0, 0, 0);
  // Kıyı yürüyüş halkası ve yola inen yol
  add(st, flat(new THREE.RingGeometry(0.405, 0.452, 64)), LIB.paving, 0, 0.033, 0);
  box(st, 0.09, 0.003, 0.05, LIB.paving, 0, 0.03, 0.465);
  // Fort Wood: on bir köşeli yıldız kale (granit duvarlar), üstü taş teras
  const star = new THREE.Shape();
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2;
    const r = k % 2 ? 0.27 : 0.37;
    if (k) star.lineTo(Math.sin(a) * r, Math.cos(a) * r);
    else star.moveTo(Math.sin(a) * r, Math.cos(a) * r);
  }
  add(st, fineUV(stoneUV(flat(new THREE.ExtrudeGeometry(star, { depth: 0.065, bevelEnabled: false }))), 2), LIB.fort, 0, 0.03, 0);
  // Kaide: iki kademeli taban, kesme taş alt gövde ve kapı, daralan geçiş, localı üst gövde
  st.add(part(uvBox(0.3, 0.03, 0.3, 0.2, 0.22), LIB.stone, 0, 0.11, 0));
  st.add(part(uvBox(0.265, 0.03, 0.265, 0.2, 0.22, 0.03), LIB.stone, 0, 0.14, 0));
  st.add(part(uvBox(0.235, 0.2, 0.235, 0.2, 0.22, 0.06), LIB.stone, 0, 0.255, 0));
  for (const y of [0.2, 0.25, 0.3]) box(st, 0.239, 0.006, 0.239, LIB.trim, 0, y, 0);
  for (let k = 0; k < 4; k++) {
    const f = item(st, 0, 0, (k * Math.PI) / 2, 1, 0);
    add(f, archGeo(0.05, 0.085, 0.004), LIB.dark, 0, 0.155, 0.1185);
    box(f, 0.07, 0.008, 0.008, LIB.trim, 0, 0.245, 0.118);
  }
  add(st, frustum(0.235, 0.235, 0.03, 0.205, 0.205), LIB.trim, 0, 0.37, 0);
  st.add(part(uvBox(0.205, 0.2, 0.205, 0.2, 0.22, 0.35), LIB.stone, 0, 0.485, 0));
  for (let k = 0; k < 4; k++) {
    const f = item(st, 0, 0, (k * Math.PI) / 2, 1, 0);
    // Loca: koyu girinti, dört sütun, korkuluk ve lento
    box(f, 0.15, 0.075, 0.004, LIB.dark, 0, 0.462, 0.1045);
    for (let c = 0; c < 4; c++) cyl(f, 0.0055, 0.0062, 0.072, LIB.trim, -0.0675 + c * 0.045, 0.463, 0.108, 8);
    box(f, 0.152, 0.012, 0.006, LIB.trim, 0, 0.463, 0.109);
    box(f, 0.164, 0.009, 0.012, LIB.trim, 0, 0.535, 0.106);
    // Yuvarlak kalkan dizisi
    for (let d = 0; d < 7; d++) add(f, new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 14).rotateX(Math.PI / 2), LIB.trim, -0.075 + d * 0.025, 0.565, 0.1045);
  }
  // Saçak, seyir terası korkuluğu ve heykelin taban taşı
  box(st, 0.226, 0.012, 0.226, LIB.trim, 0, 0.585, 0);
  box(st, 0.2, 0.004, 0.2, LIB.paving, 0, 0.597, 0);
  frame(st, 0.218, 0.218, 0.024, 0.01, LIB.trim, 0, 0.597, 0);
  st.add(part(uvBox(0.165, 0.03, 0.165, 0.2, 0.22), LIB.stone, 0, 0.616, 0));
  const fig = libertyFigure();
  fig.scale.setScalar(0.82);
  fig.position.y = 0.631;
  st.add(fig);
  // Ada: ağaçlar, banklar, lambalar, bayrak
  for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.43, 0.4], [0.43, 0.4], [-0.45, 0], [0.45, 0.02], [0.02, -0.45], [-0.3, -0.46], [0.3, -0.46]] as [number, number][]) {
    plant(st, PROPS.treeLarge, x, z, n, 0.5 + hash(x * 10 + z) * 0.15);
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.39;
    bench(st, Math.sin(a) * 0.392, Math.cos(a) * 0.392, a + Math.PI, s);
    lamp(st, Math.sin(a + 0.39) * 0.462, Math.cos(a + 0.39) * 0.462, s, 0.2);
  }
  flag(st, US_FLAG, 0.12, 0.033, 0.43, 0.2, 0.07);
  g.add(mergeStatic([st]));
  return g;
}

// ======================= Kız Kulesi (2x2, denizin içinde) =======================
// Boğaz'daki küçük adacık: çevresi dalgakıran kayaları, kesme taş rıhtım ve korkuluk; iki katlı kemer
// pencereli taş bina, damında küçük kurşun kubbe, batı ucunda kare taş kule; kulenin tepesinde balkon,
// sekizgen fener odası (gece yanar), kurşun külah ve Türk bayrağı. Önde ahşap iskele ve dalgada sallanan
// tekne, rıhtımda kafe şemsiyeleri. Zemin plakası yok: çevresi deniz.
const KK = {
  wall: stoneMat('#f1e8d6'),
  quay: stoneMat('#cfc3ab'),
  trim: pm('#e8dfcb', 0.85),
  paving: pm('#dcd2bf', 0.95),
  lead: shiny('#8a99a8', 0.25, 0.6),
  wood: pm('#8a6440', 0.85),
  rail: pm('#f5f3ee', 0.5),
  red: pm('#c62828', 0.7),
  cloth: pm('#f7f4ee', 0.8),
  light: lit('#eaf4f8'),
  gold: shiny('#e0b84c', 0.7, 0.3),
};
function maiden() {
  const n = 2, s = small(n);
  const ys = SEA_Y / (n * 0.96);
  const g = new THREE.Group();
  const st = new THREE.Group();
  // Rıhtım: yuvarlatılmış dikdörtgen taş duvar (denizin içinden yükselir), üstü taş döşeme
  const quay = roundRect(-0.25, -0.155, 0.5, 0.31, 0.075);
  add(st, stoneUV(flat(new THREE.ExtrudeGeometry(quay, { depth: 0.095, bevelEnabled: false, curveSegments: 6 }))), KK.quay, 0, ys - 0.035, 0);
  add(st, flat(new THREE.ShapeGeometry(roundRect(-0.243, -0.148, 0.486, 0.296, 0.07), 6)), KK.paving, 0, ys + 0.062, 0);
  const deck = ys + 0.06;
  // Dalgakıran kayaları
  for (let k = 0; k < 46; k++) {
    const a = (k / 46) * Math.PI * 2;
    const r = 1.04 + hash(k) * 0.12;
    const x = Math.sin(a) * 0.27 * r, z = Math.cos(a) * 0.18 * r;
    rock(st, x, ys + 0.004, z, 0.02 + hash(k + 9) * 0.018, 1.2, 0.7, 1);
  }
  // Rıhtım korkuluğu
  const edge = roundRect(-0.242, -0.147, 0.484, 0.294, 0.068).getSpacedPoints(60);
  edge.forEach((p, k) => {
    if (k % 2 === 0) cyl(st, 0.0018, 0.0018, 0.022, KK.rail, p.x, deck, -p.y, 5);
    if (k < edge.length - 1) {
      const q = edge[k + 1];
      if (!(Math.abs(p.x - 0.03) < 0.03 && -p.y > 0.12)) rod(st, [p.x, deck + 0.022, -p.y], [q.x, deck + 0.022, -q.y], 0.0016, KK.rail, 4);
    }
  });
  // Ana bina: iki kat, kemerli pencereler, saçak, korkuluklu dam ve küçük kubbe
  const bx = 0.055, bw = 0.22, bd = 0.15, bh = 0.088;
  st.add(part(uvBox(bw, bh, bd, 0.4, 0.44), KK.wall, bx, deck + bh / 2, 0));
  for (const side of [-1, 1]) {
    for (let k = 0; k < 7; k++) {
      const x = bx - bw / 2 + 0.02 + k * ((bw - 0.04) / 6);
      for (const y of [0.012, 0.052]) {
        const w = add(st, archGeo(0.017, 0.03, 0.003), windowMat, x, deck + y, side * (bd / 2 + 0.001));
        if (side < 0) w.rotation.y = Math.PI;
      }
    }
  }
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      for (const y of [0.012, 0.052]) {
        const w = add(st, archGeo(0.017, 0.03, 0.003), windowMat, bx + side * (bw / 2 + 0.001), deck + y, -bd / 2 + 0.025 + k * ((bd - 0.05) / 3));
        w.rotation.y = (side * Math.PI) / 2;
      }
    }
  }
  box(st, bw + 0.002, 0.004, bd + 0.002, KK.trim, bx, deck + 0.045, 0);
  box(st, bw + 0.012, 0.008, bd + 0.012, KK.trim, bx, deck + bh, 0);
  box(st, bw - 0.004, 0.004, bd - 0.004, KK.paving, bx, deck + bh + 0.008, 0);
  frame(st, bw + 0.008, bd + 0.008, 0.014, 0.005, KK.trim, bx, deck + bh + 0.008, 0);
  const dy = deck + bh + 0.012;
  cyl(st, 0.034, 0.036, 0.016, KK.wall, 0.12, dy, 0, 16);
  add(st, dome(0.034, 18), KK.lead, 0.12, dy + 0.016, 0);
  rod(st, [0.12, dy + 0.048, 0], [0.12, dy + 0.066, 0], 0.0018, KK.gold, 4);
  for (const [x, z] of [[0.02, -0.05], [0.16, 0.05]] as [number, number][]) box(st, 0.012, 0.03, 0.012, KK.trim, x, dy, z);
  // Kule: kare taş gövde, dar kemerli pencereler, balkon, sekizgen fener odası, kurşun külah, bayrak
  const tx = -0.125, tw = 0.082, th = 0.24;
  st.add(part(uvBox(tw, th, tw, 0.4, 0.44), KK.wall, tx, deck + th / 2, 0));
  for (let k = 0; k < 4; k++) {
    const f = item(st, tx, 0, (k * Math.PI) / 2, 1, 0);
    for (const y of [0.1, 0.16]) add(f, archGeo(0.014, 0.032, 0.003), windowMat, 0, deck + y, tw / 2 + 0.001);
    box(f, tw + 0.002, 0.004, 0.004, KK.trim, 0, deck + 0.095, tw / 2);
  }
  box(st, tw + 0.016, 0.01, tw + 0.016, KK.trim, tx, deck + th, 0);
  frame(st, tw + 0.016, tw + 0.016, 0.016, 0.003, KK.rail, tx, deck + th + 0.01, 0);
  const ly = deck + th + 0.01;
  cyl(st, 0.034, 0.036, 0.022, KK.wall, tx, ly, 0, 8);
  add(st, new THREE.CylinderGeometry(0.03, 0.03, 0.036, 8), KK.light, tx, ly + 0.04, 0);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    box(st, 0.004, 0.036, 0.004, KK.rail, tx + Math.sin(a) * 0.0305, ly + 0.022, Math.cos(a) * 0.0305);
  }
  cyl(st, 0.038, 0.038, 0.006, KK.trim, tx, ly + 0.058, 0, 8);
  add(st, new THREE.ConeGeometry(0.04, 0.08, 8), KK.lead, tx, ly + 0.064 + 0.04, 0);
  add(st, new THREE.SphereGeometry(0.006, 8, 6), KK.gold, tx, ly + 0.146, 0);
  flag(st, TR_FLAG, tx, ly + 0.146, 0, 0.06, 0.045, -0.3);
  // Doğudaki alçak ek bina ve kafe terası
  st.add(part(uvBox(0.05, 0.05, 0.11, 0.4, 0.44), KK.wall, 0.19, deck + 0.025, 0));
  box(st, 0.056, 0.006, 0.116, KK.trim, 0.19, deck + 0.05, 0);
  for (const [x, z] of [[-0.19, -0.1], [-0.2, 0.1], [0.215, -0.11]] as [number, number][]) {
    rod(st, [x, deck, z], [x, deck + 0.04, z], 0.0015, KK.rail, 4);
    add(st, new THREE.ConeGeometry(0.026, 0.012, 8), KK.cloth, x, deck + 0.045, z);
    cyl(st, 0.01, 0.01, 0.012, KK.wood, x + 0.012, deck, z + 0.008, 8);
  }
  // Rıhtımın dört köşesinde lamba (rıhtımın döşemesinde dururlar; deniz seviyesi değişse de)
  const onDeck = item(st, 0, 0, 0, 1, deck - 0.03);
  for (const [x, z] of [[-0.22, 0.12], [0.22, 0.12], [-0.22, -0.12], [0.22, -0.12]] as [number, number][]) lamp(onDeck, x, z, s, 0.14);
  // İskele: ahşap döşeme ve denize inen kazıklar
  box(st, 0.05, 0.006, 0.11, KK.wood, 0.03, deck - 0.006, 0.2);
  for (const [x, z] of [[0.008, 0.16], [0.052, 0.16], [0.008, 0.25], [0.052, 0.25]] as [number, number][]) cyl(st, 0.003, 0.003, 0.06, KK.wood, x, ys - 0.03, z, 6);
  g.add(mergeStatic([st]));
  // Dalgada sallanan tekne (landmarks.ts animateDecor: userData.bob)
  const boat = motorYacht('#c62828', 0.16);
  boat.position.set(0.108, ys - 0.012, 0.21);
  boat.rotation.y = Math.PI / 2;
  g.add(boat);
  g.userData.bob = [{ obj: boat, phase: 0.7 }];
  return g;
}

// ======================= Ayasofya (3x3) =======================
// Bizans bazilikası, Osmanlı eklemeleriyle: pembe-aşı sıvalı gövde ve iri payandalar, kırk pencereli kasnağın
// üstünde basık kurşun ana kubbe, doğu ve batıda yarım kubbeler ve yanlarında küçük eksedra kubbeleri; kuzey ve
// güney yüzünde pencereli büyük kemer duvarları, batıda narteks. Dört minare: üçü beyaz taş, biri kırmızı tuğla
// (şerefeler gece yanar). Önde çimenli bahçe, şadırvan, serviler ve kubbeli türbeler.
const AS = {
  wall: pm('#dc9f78', 0.95),
  wall2: pm('#e6b18e', 0.95),
  trim: pm('#f1dcc3', 0.9),
  lead: shiny('#8593a0', 0.2, 0.62),
  white: pm('#f1ebdf', 0.8),
  brick: pm('#b0553d', 0.9),
  stone: pm('#e4dccb', 0.85),
  paving: pm('#d8cfbf', 0.95),
  lawn: pm('#6cbd55', 1),
  gold: shiny('#e0b84c', 0.7, 0.3),
  lamp: lit('#fff2c0'),
};
// Kemerli pencere dizisi (yüzü +z olan bir grupta): n pencere span genişliğine yayılır
function windowRow(f: THREE.Object3D, n: number, span: number, y: number, z: number, w = 0.016, h = 0.03, m: THREE.Material = windowMat) {
  for (let k = 0; k < n; k++) add(f, archGeo(w, h, 0.003), m, -span / 2 + (span * (k + 0.5)) / n, y, z);
}
// Osmanlı minaresi: kare kaide, sekizgen pabuç, ince gövde, şerefeler (gece yanan korkuluk), kurşun külah, alem
function minaret(g: THREE.Object3D, x: number, z: number, h: number, r: number, body: THREE.Material, serefe: number[]) {
  box(g, r * 2.8, 0.03, r * 2.8, AS.stone, x, 0.03, z);
  cyl(g, r * 1.3, r * 1.45, 0.03, body, x, 0.06, z, 8);
  cyl(g, r, r * 1.08, h - 0.1, body, x, 0.09, z, 12);
  for (const y of serefe) {
    cyl(g, r * 1.75, r * 1.1, 0.012, AS.stone, x, y - 0.012, z, 12);
    cyl(g, r * 1.8, r * 1.8, 0.005, AS.trim, x, y, z, 12);
    add(g, new THREE.CylinderGeometry(r * 1.76, r * 1.76, 0.009, 12, 1, true), AS.lamp, x, y + 0.0095, z);
  }
  const top = h - 0.01;
  cyl(g, r * 1.15, r * 1.02, 0.012, AS.trim, x, top, z, 12);
  add(g, new THREE.ConeGeometry(r * 1.15, 0.085, 12), AS.lead, x, top + 0.0545, z);
  rod(g, [x, top + 0.095, z], [x, top + 0.12, z], 0.0013, AS.gold, 4);
}
// Alem: altın çubuk, top ve hilal
function crescent(g: THREE.Object3D, x: number, y: number, z: number, k = 1, m: THREE.Material = AS.gold) {
  rod(g, [x, y, z], [x, y + 0.04 * k, z], 0.0022 * k, m, 5);
  add(g, new THREE.SphereGeometry(0.0055 * k, 8, 6), m, x, y + 0.014 * k, z);
  const c = add(g, new THREE.TorusGeometry(0.009 * k, 0.0022 * k, 4, 12, Math.PI * 1.3), m, x, y + 0.05 * k, z);
  c.rotation.z = -1.15 * Math.PI;
}
function hagia() {
  const n = 3, s = small(n);
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, AS.paving, 0, 0, 0);
  for (const sx of [-1, 1]) box(st, 0.33, 0.004, 0.2, AS.lawn, sx * 0.245, 0.03, 0.36);
  for (const sx of [-1, 1]) box(st, 0.07, 0.004, 0.6, AS.lawn, sx * 0.445, 0.03, -0.13);
  const cz = -0.08, W = 0.5, D = 0.44, H = 0.13, B = 0.03;
  // Ana gövde: iki sıra kemerli pencere
  box(st, W, H, D, AS.wall, 0, B, cz);
  box(st, W + 0.008, 0.008, D + 0.008, AS.trim, 0, B + H, cz);
  for (const [rot, len, off] of [[0, W, D / 2], [Math.PI, W, D / 2], [Math.PI / 2, D, W / 2], [-Math.PI / 2, D, W / 2]] as [number, number, number][]) {
    const f = item(st, 0, cz, rot, 1, 0);
    const k = Math.round(len / 0.042);
    windowRow(f, k, len - 0.06, B + 0.022, off + 0.001);
    windowRow(f, k, len - 0.06, B + 0.076, off + 0.001);
    box(f, len, 0.005, 0.004, AS.trim, 0, B + 0.062, off);
  }
  // Narteks (batı): alçak uzun giriş binası, kurşun çatı
  box(st, 0.07, 0.1, D - 0.04, AS.wall2, -W / 2 - 0.035, B, cz);
  box(st, 0.076, 0.006, D - 0.034, AS.lead, -W / 2 - 0.035, B + 0.1, cz);
  windowRow(item(st, -W / 2 - 0.07, cz, -Math.PI / 2, 1, 0), 8, D - 0.1, B + 0.03, 0.001);
  // Orta kule ve kuzey-güney timpan duvarları
  const T = 0.27, TY = B + H, TH = 0.085;
  box(st, T, TH, T, AS.wall2, 0, TY, cz);
  for (const sz of [-1, 1]) {
    const f = item(st, 0, cz, sz > 0 ? 0 : Math.PI, 1, 0);
    add(f, new THREE.TorusGeometry(0.11, 0.008, 6, 26, Math.PI), AS.trim, 0, TY + TH - 0.11, T / 2 + 0.004);
    windowRow(f, 5, 0.16, TY + 0.008, T / 2 + 0.001);
    windowRow(f, 4, 0.12, TY + 0.045, T / 2 + 0.001, 0.014, 0.026);
  }
  // İri payandalar ve ana kubbeye uzanan destek kemerleri
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 0.115, z = cz + sz * (D / 2 + 0.035);
      box(st, 0.07, 0.2, 0.07, AS.wall, x, B, z);
      add(st, frustum(0.07, 0.07, 0.03, 0.04, 0.03), AS.wall2, x, B + 0.215, z);
      box(st, 0.05, 0.03, 0.07, AS.wall2, x, B + H + 0.035, cz + sz * (D / 2));
    }
  }
  // Ana kubbe: pencereli kasnak (aralarda payanda), saçak, basık kurşun kubbe, alem
  const DY = TY + TH, DR = 0.142;
  cyl(st, DR, DR + 0.004, 0.026, AS.wall2, 0, DY, cz, 40);
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    const w = box(st, 0.009, 0.015, 0.004, windowMat, Math.sin(a) * (DR + 0.002), DY + 0.006, cz + Math.cos(a) * (DR + 0.002));
    w.rotation.y = a;
    const b = a + Math.PI / 40;
    const p = box(st, 0.006, 0.026, 0.012, AS.wall, Math.sin(b) * (DR + 0.004), DY, cz + Math.cos(b) * (DR + 0.004));
    p.rotation.y = b;
  }
  cyl(st, DR + 0.007, DR + 0.007, 0.005, AS.trim, 0, DY + 0.026, cz, 40);
  add(st, dome(DR + 0.002, 36), AS.lead, 0, DY + 0.031, cz).scale.y = 0.55;
  crescent(st, 0, DY + 0.031 + (DR + 0.002) * 0.55 - 0.004, cz, 1.2);
  // Yarım kubbeler (doğu ve batı), altlarında pencere dizisi; yanlarında küçük eksedra kubbeleri
  for (const sx of [-1, 1]) {
    const phi = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    add(st, new THREE.SphereGeometry(0.122, 28, 8, phi, Math.PI, 0, Math.PI / 2), AS.lead, sx * (T / 2), TY + 0.012, cz).scale.y = 0.72;
    cyl(st, 0.124, 0.124, 0.012, AS.wall2, sx * (T / 2), TY, cz, 28);
    for (let k = 0; k < 7; k++) {
      const a = sx * (Math.PI / 2) + (-0.5 + k / 6) * Math.PI * 0.8;
      const w = box(st, 0.009, 0.009, 0.004, windowMat, sx * (T / 2) + Math.sin(a) * 0.125, TY + 0.002, cz + Math.cos(a) * 0.125);
      w.rotation.y = a;
    }
    for (const sz of [-1, 1]) {
      add(st, new THREE.SphereGeometry(0.052, 18, 6, phi, Math.PI, 0, Math.PI / 2), AS.lead, sx * 0.2, TY, cz + sz * 0.105).scale.y = 0.8;
    }
  }
  // Çatı köşelerindeki küçük kubbeli kuleler
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      cyl(st, 0.02, 0.021, 0.035, AS.wall2, sx * 0.215, TY, cz + sz * 0.19, 12);
      add(st, dome(0.02, 12), AS.lead, sx * 0.215, TY + 0.035, cz + sz * 0.19);
    }
  }
  // Minareler: batıdakiler beyaz ve iki şerefeli, güneydoğudaki kırmızı tuğla, kuzeydoğudaki kalın beyaz
  minaret(st, -0.36, cz + 0.27, 0.48, 0.011, AS.white, [0.35, 0.42]);
  minaret(st, -0.36, cz - 0.27, 0.48, 0.011, AS.white, [0.35, 0.42]);
  minaret(st, 0.33, cz + 0.27, 0.42, 0.014, AS.brick, [0.35]);
  minaret(st, 0.33, cz - 0.27, 0.44, 0.015, AS.white, [0.36]);
  // Bahçe: şadırvan, serviler, ağaçlar, türbeler, banklar ve lambalar
  {
    const fx = 0, fz = 0.3;
    cyl(st, 0.05, 0.05, 0.012, AS.stone, fx, 0.03, fz, 8);
    cyl(st, 0.044, 0.044, 0.004, WATER, fx, 0.04, fz, 8);
    cyl(st, 0.012, 0.014, 0.03, AS.white, fx, 0.042, fz, 8);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      cyl(st, 0.0035, 0.0035, 0.045, AS.white, fx + Math.sin(a) * 0.052, 0.03, fz + Math.cos(a) * 0.052, 5);
    }
    add(st, new THREE.ConeGeometry(0.075, 0.035, 8), AS.lead, fx, 0.075 + 0.0175, fz);
    crescent(st, fx, 0.11, fz, 0.6);
  }
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 5; k++) plant(st, PROPS.treeSmall, sx * 0.09, 0.2 + k * 0.065, n, 0.5);
    plant(st, PROPS.treeLarge, sx * 0.3, 0.34, n, 0.6);
    plant(st, PROPS.treeLarge, sx * 0.44, -0.4, n, 0.55);
    plant(st, PROPS.treeSmall, sx * 0.45, 0.05, n, 0.5);
    const tx = sx * 0.4, tz = 0.43;
    cyl(st, 0.032, 0.034, 0.05, AS.white, tx, 0.03, tz, 8);
    cyl(st, 0.036, 0.036, 0.005, AS.trim, tx, 0.08, tz, 8);
    add(st, dome(0.03, 14), AS.lead, tx, 0.085, tz);
    crescent(st, tx, 0.113, tz, 0.5);
    for (const z of [0.25, 0.4]) {
      bench(st, sx * 0.13, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2, s);
      lamp(st, sx * 0.055, z + 0.04, s, 0.2);
    }
  }
  g.add(mergeStatic([st]));
  return g;
}

// ======================= Tac Mahal (3x3) =======================
// Beyaz mermer türbe: köşeleri pahlı kare gövde, her yüzde kaligrafi çerçeveli büyük kemerli eyvan ve iki
// katlı yan nişler, çatıda dört küçük köşk (chhatri) ve köşe sivrileri; kasnağın üstünde soğan biçimli büyük
// kubbe ve altın alem. Kaidesinin köşelerinde balkonlu dört minare. Önde dört tarhlı bahçe, ortada uzun havuz,
// fıskiyeli orta havuz ve servi sıraları; yanlarda kırmızı kumtaşı cami ve misafirhane (beyaz kubbeli),
// en önde kumtaşı büyük kapı.
const TJ = {
  marble: pm('#f7f4ee', 0.45),
  shade: pm('#e8e1d4', 0.6),
  inlay: pm('#d2c7b5', 0.8),
  dark: pm('#5a4f47', 0.8),
  sand: pm('#b8593f', 0.9),
  sand2: pm('#cc7b5f', 0.9),
  deep: pm('#7a3526', 0.9),
  paving: pm('#dccab0', 0.95),
  lawn: pm('#5fb34c', 1),
  gold: shiny('#e3bd5c', 0.75, 0.3),
};
// Soğan kubbe profili (taban yarıçapı 1 için; r ile büyütülür)
const ONION: [number, number][] = [[1, 0], [1.1, 0.25], [1.23, 0.62], [1.28, 1.0], [1.22, 1.38], [1.03, 1.75], [0.72, 2.08], [0.4, 2.32], [0.16, 2.5], [0.05, 2.62], [0, 2.68]];
const onion = (r: number, seg = 28) => lathe(ONION.map(([a, b]) => [a * r, b * r] as [number, number]), seg);
function finial(g: THREE.Object3D, x: number, y: number, z: number, k = 1) {
  rod(g, [x, y, z], [x, y + 0.05 * k, z], 0.0022 * k, TJ.gold, 5);
  for (const [yy, rr] of [[0.012, 0.0065], [0.024, 0.0055], [0.034, 0.0045]]) add(g, new THREE.SphereGeometry(rr * k, 8, 6), TJ.gold, x, y + yy * k, z);
  const c = add(g, new THREE.TorusGeometry(0.008 * k, 0.002 * k, 4, 12, Math.PI * 1.3), TJ.gold, x, y + 0.058 * k, z);
  c.rotation.z = -1.15 * Math.PI;
}
// Köşk (chhatri): sekiz ince sütun, saçak ve küçük soğan kubbe
function chhatri(g: THREE.Object3D, x: number, y: number, z: number, r: number, m: THREE.Material = TJ.marble) {
  cyl(g, r * 1.15, r * 1.2, 0.008, m, x, y, z, 8);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    cyl(g, r * 0.09, r * 0.09, r * 1.1, m, x + Math.sin(a) * r * 0.95, y + 0.008, z + Math.cos(a) * r * 0.95, 5);
  }
  const top = y + 0.008 + r * 1.1;
  cyl(g, r * 1.3, r * 1.05, 0.007, m, x, top, z, 8);
  add(g, onion(r * 0.75, 14), TJ.marble, x, top + 0.007, z);
  finial(g, x, top + 0.007 + r * 0.75 * 2.6, z, 0.4);
}
function tajMinaret(g: THREE.Object3D, x: number, z: number, y0: number) {
  const H = 0.3;
  cyl(g, 0.0115, 0.0135, H, TJ.marble, x, y0, z, 12);
  for (const f of [0.16, 0.5, 0.82]) {
    const r = 0.0135 - 0.002 * f + 0.0005;
    cyl(g, r, r, 0.002, TJ.inlay, x, y0 + H * f, z, 12);
  }
  for (const f of [0.33, 0.66, 0.97]) {
    const y = y0 + H * f;
    cyl(g, 0.021, 0.012, 0.01, TJ.marble, x, y - 0.01, z, 12);
    cyl(g, 0.0215, 0.0215, 0.004, TJ.inlay, x, y, z, 12);
  }
  chhatri(g, x, y0 + H + 0.004, z, 0.016);
}
function taj() {
  const n = 3, s = small(n);
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, TJ.paving, 0, 0, 0);
  const cz = -0.2;
  // Bahçe: dört çimen tarhı, uzun havuz (ortada fıskiyeli kare havuz), servi sıraları
  for (const sx of [-1, 1]) for (const [z0, z1] of [[0.07, 0.22], [0.32, 0.42]] as [number, number][]) box(st, 0.34, 0.004, z1 - z0, TJ.lawn, sx * 0.23, 0.03, (z0 + z1) / 2);
  basin(st, 0.05, 0.17, 0.012, 0.006, TJ.marble, WATER, 0, 0.03, 0.13);
  basin(st, 0.05, 0.13, 0.012, 0.006, TJ.marble, WATER, 0, 0.03, 0.4);
  basin(st, 0.11, 0.11, 0.014, 0.008, TJ.marble, WATER, 0, 0.03, 0.27);
  cyl(st, 0.006, 0.01, 0.025, TJ.marble, 0, 0.036, 0.27, 8);
  for (const sx of [-1, 1]) {
    for (const z of [0.06, 0.1, 0.14, 0.18, 0.36, 0.4, 0.44]) plant(st, PROPS.treeSmall, sx * 0.055, z, n, 0.42);
    for (const z of [0.1, 0.4]) plant(st, PROPS.treeLarge, sx * 0.23, z, n, 0.45);
    for (const z of [0.15, 0.37]) bench(st, sx * 0.09, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2, s);
  }
  // Kaide: mermer, yüzlerinde kemerli nişler, önde basamaklar
  box(st, 0.46, 0.042, 0.46, TJ.marble, 0, 0.03, cz);
  for (let k = 0; k < 4; k++) windowRow(item(st, 0, cz, (k * Math.PI) / 2, 1, 0), 13, 0.42, 0.034, 0.231, 0.017, 0.028, TJ.shade);
  for (let k = 0; k < 4; k++) box(st, 0.06, 0.006 + k * 0.0105, 0.012, TJ.marble, 0, 0.03, cz + 0.236 + (3 - k) * 0.012);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tajMinaret(st, sx * 0.205, cz + sz * 0.205, 0.072);
  // Türbe gövdesi: köşeleri pahlı kare
  const P = 0.125, C = 0.045, MY = 0.072, MH = 0.16;
  const octPts: [number, number][] = [[P, -P + C], [P, P - C], [P - C, P], [-P + C, P], [-P, P - C], [-P, -P + C], [-P + C, -P], [P - C, -P]];
  const oct = new THREE.Shape(octPts.map(([x, y]) => new THREE.Vector2(x, y)));
  add(st, flat(new THREE.ExtrudeGeometry(oct, { depth: MH, bevelEnabled: false })), TJ.marble, 0, MY, cz);
  add(st, flat(new THREE.ExtrudeGeometry(oct, { depth: 0.008, bevelEnabled: false })), TJ.inlay, 0, MY + MH, cz).scale.set(1.04, 1, 1.04);
  for (let k = 0; k < 4; k++) {
    const f = item(st, 0, cz, (k * Math.PI) / 2, 1, 0);
    // Pishtak: biraz öne çıkan yüksek çerçeve, kaligrafi bandı, büyük eyvan, kapı ve kafes pencere
    box(f, 0.11, MH + 0.018, 0.006, TJ.marble, 0, MY, P + 0.002);
    box(f, 0.1, 0.004, 0.0015, TJ.dark, 0, MY + 0.15, P + 0.0055);
    for (const sx of [-1, 1]) box(f, 0.004, 0.14, 0.0015, TJ.dark, sx * 0.048, MY + 0.01, P + 0.0055);
    add(f, archGeo(0.07, 0.125, 0.004), TJ.shade, 0, MY + 0.006, P + 0.0062);
    add(f, archGeo(0.03, 0.052, 0.003), TJ.dark, 0, MY + 0.006, P + 0.0085);
    add(f, archGeo(0.032, 0.042, 0.003), windowMat, 0, MY + 0.074, P + 0.0085);
    for (const sx of [-1, 1]) for (const y of [0.012, 0.088]) add(f, archGeo(0.019, 0.058, 0.003), TJ.shade, sx * 0.0675, MY + y, P + 0.0015);
  }
  for (let k = 0; k < 4; k++) {
    const sx = k % 2 ? 1 : -1, sz = k < 2 ? 1 : -1;
    const f = item(st, sx * (P - C / 2), cz + sz * (P - C / 2), Math.atan2(sx, sz), 1, 0);
    for (const y of [0.012, 0.088]) add(f, archGeo(0.026, 0.058, 0.003), TJ.shade, 0, MY + y, 0.0015);
  }
  // Köşe sivrileri, kasnak, lotus bandı, soğan kubbe ve alem; çatıda dört köşk
  for (const [x, z] of octPts) {
    cyl(st, 0.004, 0.005, 0.035, TJ.marble, x * 1.02, MY + MH, cz - z * 1.02, 6);
    add(st, onion(0.0045, 8), TJ.marble, x * 1.02, MY + MH + 0.035, cz - z * 1.02);
  }
  const DY = MY + MH + 0.008;
  cyl(st, 0.07, 0.072, 0.04, TJ.marble, 0, DY, cz, 32);
  add(st, new THREE.TorusGeometry(0.0715, 0.004, 6, 32).rotateX(Math.PI / 2), TJ.inlay, 0, DY + 0.041, cz);
  add(st, onion(0.07, 36), TJ.marble, 0, DY + 0.04, cz);
  finial(st, 0, DY + 0.04 + 0.07 * 2.64, cz, 1.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) chhatri(st, sx * 0.087, DY, cz + sz * 0.087, 0.026);
  // Yanlarda kırmızı kumtaşı cami ve misafirhane: üç beyaz kubbe, köşe kuleleri, türbeye bakan eyvan
  for (const sx of [-1, 1]) {
    const x = sx * 0.4, w = 0.12, d = 0.28, h = 0.065;
    box(st, w + 0.02, 0.012, d + 0.02, TJ.sand2, x, 0.03, cz);
    box(st, w, h, d, TJ.sand, x, 0.042, cz);
    const f = item(st, x - (sx * w) / 2, cz, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 1, 0);
    box(f, 0.075, h + 0.025, 0.006, TJ.sand2, 0, 0.042, 0.002);
    add(f, archGeo(0.048, 0.07, 0.004), TJ.deep, 0, 0.044, 0.0055);
    for (const u of [-0.1, -0.065, 0.065, 0.1]) add(f, archGeo(0.024, 0.045, 0.003), TJ.deep, u, 0.044, 0.0015);
    for (const dz of [-0.085, 0, 0.085]) {
      const r = dz === 0 ? 0.028 : 0.022;
      cyl(st, r + 0.002, r + 0.003, 0.012, TJ.sand2, x, 0.042 + h, cz + dz, 16);
      add(st, onion(r * 0.85, 18), TJ.marble, x, 0.054 + h, cz + dz);
      finial(st, x, 0.054 + h + r * 0.85 * 2.6, cz + dz, 0.5);
    }
    for (const ex of [-1, 1]) {
      for (const ez of [-1, 1]) {
        const tx = x + (ex * w) / 2, tz = cz + (ez * d) / 2;
        cyl(st, 0.012, 0.013, h + 0.03, TJ.sand2, tx, 0.042, tz, 8);
        chhatri(st, tx, 0.072 + h, tz, 0.012, TJ.sand2);
      }
    }
  }
  // Ön kapı (Darvaza): kumtaşı kütle, iki yüzde mermer çerçeveli eyvan, tepesinde köşk dizisi, köşe kuleleri
  box(st, 0.24, 0.085, 0.06, TJ.sand, 0, 0.03, 0.44);
  for (const side of [1, -1]) {
    const f = item(st, 0, 0.44 + side * 0.03, side > 0 ? 0 : Math.PI, 1, 0);
    box(f, 0.1, 0.085, 0.004, TJ.marble, 0, 0.03, 0.002);
    add(f, archGeo(0.06, 0.072, 0.004), TJ.deep, 0, 0.03, 0.005);
  }
  for (let k = 0; k < 6; k++) chhatri(st, -0.1 + k * 0.04, 0.115, 0.44, 0.009, TJ.sand2);
  for (const sx of [-1, 1]) {
    cyl(st, 0.016, 0.017, 0.105, TJ.sand2, sx * 0.12, 0.03, 0.44, 8);
    chhatri(st, sx * 0.12, 0.135, 0.44, 0.014, TJ.marble);
  }
  for (const [x, z] of [[-0.44, 0.1], [0.44, 0.1], [-0.44, 0.38], [0.44, 0.38], [-0.44, -0.44], [0.44, -0.44]] as [number, number][]) plant(st, PROPS.treeLarge, x, z, n, 0.55);
  g.add(mergeStatic([st]));
  return g;
}

// ======================= Big Ben (2x2) =======================
// Elizabeth Kulesi: bal rengi kireçtaşı gotik gövde (sivri kemerli pencere panelleri dokuyla çizilir), köşe
// payeleri ve kat silmeleri; dört yüzde altın çerçeveli opal saat kadranı (gece içten aydınlanır), köşe
// sivrileri, kemerli çan katı, altın kenarlı dik arduvaz külah, çatı pencereleri, gece yanan Ayrton feneri ve
// sivri uç. Arkasında Westminster Sarayı'nın gotik kanadı (sivri kuleler, Victoria Kulesi ve İngiliz bayrağı).
// Önde çimen, kırmızı telefon kulübesi, banklar ve lambalar.
function lancet(g: CanvasRenderingContext2D, cx: number, top: number, hw: number, bottom: number) {
  g.beginPath();
  g.moveTo(cx - hw, bottom);
  g.lineTo(cx - hw, top + hw);
  g.quadraticCurveTo(cx - hw, top + hw * 0.2, cx, top);
  g.quadraticCurveTo(cx + hw, top + hw * 0.2, cx + hw, top + hw);
  g.lineTo(cx + hw, bottom);
  g.closePath();
  g.fill();
}
const GOTHIC = canvasTex(128, 256, g => {
  g.fillStyle = '#dccb9f';
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#c9b689';
  for (const x of [0, 62, 125]) g.fillRect(x, 0, 3, 256);
  for (const cx of [32, 94]) {
    g.fillStyle = '#c2ad7c';
    lancet(g, cx, 34, 21, 214);
    g.fillStyle = '#3c434d';
    lancet(g, cx, 42, 14, 206);
    g.fillStyle = '#c2ad7c';
    g.fillRect(cx - 1.5, 42, 3, 164);
    g.fillRect(cx - 14, 124, 28, 3);
  }
  g.fillStyle = '#c6b283';
  g.fillRect(0, 0, 128, 7);
  g.fillRect(0, 226, 128, 30);
  g.fillStyle = '#b8a473';
  g.fillRect(0, 226, 128, 3);
});
const BELFRY = canvasTex(128, 64, g => {
  g.fillStyle = '#d6c495';
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#24282e';
  for (const cx of [22, 64, 106]) lancet(g, cx, 8, 15, 64);
  g.fillStyle = '#c9b689';
  for (const cx of [22, 64, 106]) g.fillRect(cx - 1.5, 14, 3, 50);
});
const CLOCK = canvasTex(256, 256, g => {
  g.fillStyle = '#1d2c55';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#c9a24a';
  g.fillRect(6, 6, 244, 244);
  g.fillStyle = '#1d2c55';
  g.fillRect(16, 16, 224, 224);
  const circle = (r: number, c: string) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(128, 128, r, 0, Math.PI * 2);
    g.fill();
  };
  circle(110, '#d4af55');
  circle(99, '#f3eedf');
  g.strokeStyle = '#2a2a2a';
  g.lineWidth = 2;
  for (const r of [93, 82]) {
    g.beginPath();
    g.arc(128, 128, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#1b1b1b';
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * Math.PI * 2;
    const r0 = k % 5 ? 84 : 62, w = k % 5 ? 1.5 : 5;
    g.save();
    g.translate(128, 128);
    g.rotate(a);
    g.fillRect(-w / 2, -92, w, 92 - r0);
    g.restore();
  }
  g.strokeStyle = '#151515';
  g.lineCap = 'round';
  for (const [a, len, wd] of [[-Math.PI / 3, 46, 8], [Math.PI / 3, 74, 5]] as [number, number, number][]) {
    g.lineWidth = wd;
    g.beginPath();
    g.moveTo(128, 128);
    g.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len);
    g.stroke();
  }
  circle(7, '#151515');
});
const BB = {
  stone: new THREE.MeshStandardMaterial({ map: GOTHIC, roughness: 0.85 }),
  belfry: new THREE.MeshStandardMaterial({ map: BELFRY, roughness: 0.85 }),
  clock: (() => {
    const m = new THREE.MeshStandardMaterial({ map: CLOCK, emissiveMap: CLOCK, roughness: 0.45 });
    m.name = 'window';
    return m;
  })(),
  plain: pm('#d8c79a', 0.85),
  trim: pm('#c9b483', 0.85),
  slate: pm('#3a4250', 0.7),
  gold: shiny('#d9b14c', 0.75, 0.3),
  paving: pm('#cfcac0', 0.95),
  lawn: pm('#68b851', 1),
  red: pm('#c8102e', 0.55),
  light: lit('#fff1c4'),
};
// Gotik sivri: ince gövde ve küçük piramit uç
function pinnacle(g: THREE.Object3D, x: number, y: number, z: number, h: number, r: number, cap: THREE.Material = BB.slate) {
  cyl(g, r, r * 1.1, h * 0.6, BB.plain, x, y, z, 6);
  add(g, new THREE.ConeGeometry(r * 1.2, h * 0.4, 4), cap, x, y + h * 0.8, z).rotation.y = Math.PI / 4;
}
function bigBen() {
  const n = 2, s = small(n);
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, BB.paving, 0, 0, 0);
  box(st, 0.5, 0.004, 0.28, BB.lawn, -0.2, 0.03, 0.3);
  box(st, 0.2, 0.004, 0.18, BB.lawn, 0.35, 0.03, 0.36);
  const X = 0.2, Z = -0.02, T = 0.16;
  // Gövde: kaide, gotik pencereli kare kule, köşe payeleri, silmeler
  box(st, T + 0.03, 0.03, T + 0.03, BB.trim, X, 0.03, Z);
  st.add(part(uvBox(T, 0.58, T, 0.053, 0.116), BB.stone, X, 0.06 + 0.29, Z));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(st, 0.014, 0.6, 0.014, BB.plain, X + (sx * T) / 2, 0.06, Z + (sz * T) / 2);
  for (const y of [0.2, 0.36, 0.52]) box(st, T + 0.006, 0.006, T + 0.006, BB.trim, X, y, Z);
  // Saat katı: dışa taşan konsol, dört yüzde kadran, köşe sivrileri
  const CY = 0.64, CW = 0.19, CH = 0.19;
  box(st, CW + 0.01, 0.012, CW + 0.01, BB.trim, X, CY - 0.012, Z);
  st.add(part(uvBox(CW, CH, CW, 0.0633, 0.095), BB.stone, X, CY + CH / 2, Z));
  for (let k = 0; k < 4; k++) add(item(st, X, Z, (k * Math.PI) / 2, 1, 0), new THREE.PlaneGeometry(0.162, 0.162), BB.clock, 0, CY + CH / 2, CW / 2 + 0.002);
  box(st, CW + 0.014, 0.012, CW + 0.014, BB.trim, X, CY + CH, Z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pinnacle(st, X + (sx * CW) / 2, CY + CH + 0.012, Z + (sz * CW) / 2, 0.08, 0.009, BB.gold);
  // Çan katı: sivri kemerli açıklıklar
  const BY = CY + CH + 0.012, BW = 0.17, BH = 0.075;
  st.add(part(uvBox(BW, BH, BW, BW, BH), BB.belfry, X, BY + BH / 2, Z));
  box(st, BW + 0.012, 0.01, BW + 0.012, BB.trim, X, BY + BH, Z);
  // Külah: dik dört yüzlü arduvaz, altın kenarlar, her yüzde çatı penceresi
  const RY = BY + BH + 0.01, RH = 0.26;
  add(st, new THREE.ConeGeometry(0.121, RH, 4), BB.slate, X, RY + RH / 2, Z).rotation.y = Math.PI / 4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(st, [X + sx * 0.0855, RY, Z + sz * 0.0855], [X, RY + RH, Z], 0.0022, BB.gold, 4);
  for (let k = 0; k < 4; k++) {
    const f = item(st, X, Z, (k * Math.PI) / 2, 1, 0);
    box(f, 0.03, 0.03, 0.03, BB.plain, 0, RY + 0.035, 0.05);
    add(f, new THREE.PlaneGeometry(0.016, 0.018), windowMat, 0, RY + 0.05, 0.0655);
    add(f, new THREE.ConeGeometry(0.024, 0.03, 4), BB.slate, 0, RY + 0.08, 0.05).rotation.y = Math.PI / 4;
  }
  // Ayrton feneri (gece yanar) ve sivri uç
  const LY = RY + 0.2;
  box(st, 0.036, 0.03, 0.036, BB.light, X, LY, Z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(st, 0.005, 0.03, 0.005, BB.gold, X + sx * 0.019, LY, Z + sz * 0.019);
  add(st, new THREE.ConeGeometry(0.026, 0.1, 4), BB.gold, X, LY + 0.03 + 0.05, Z).rotation.y = Math.PI / 4;
  rod(st, [X, LY + 0.12, Z], [X, LY + 0.16, Z], 0.002, BB.gold, 4);
  rod(st, [X - 0.008, LY + 0.15, Z], [X + 0.008, LY + 0.15, Z], 0.0016, BB.gold, 4);
  // Westminster Sarayı: gotik kanat, beşik çatı, sivri dizisi, ortada sekizgen kule, solda Victoria Kulesi
  const PX0 = -0.46, PX1 = X - T / 2 - 0.012, PW = PX1 - PX0, PZ = Z - 0.06, PD = 0.17, PH = 0.19;
  st.add(part(uvBox(PW, PH, PD, 0.053, 0.116), BB.stone, (PX0 + PX1) / 2, 0.03 + PH / 2, PZ));
  pitched(st, PW, PD, 0.06, BB.slate, BB.plain, (PX0 + PX1) / 2, 0.03 + PH, PZ);
  for (let k = 0; k <= 10; k++) {
    const x = PX0 + 0.01 + (k * (PW - 0.02)) / 10;
    for (const sz of [-1, 1]) pinnacle(st, x, 0.03 + PH, PZ + (sz * PD) / 2, 0.05, 0.005);
  }
  cyl(st, 0.032, 0.034, 0.1, BB.plain, -0.12, 0.03 + PH + 0.03, PZ, 8);
  add(st, new THREE.ConeGeometry(0.036, 0.12, 8), BB.slate, -0.12, 0.03 + PH + 0.19, PZ);
  st.add(part(uvBox(0.1, 0.38, 0.1, 0.05, 0.116), BB.stone, -0.4, 0.03 + 0.19, PZ));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pinnacle(st, -0.4 + sx * 0.05, 0.41, PZ + sz * 0.05, 0.07, 0.008, BB.gold);
  box(st, 0.1, 0.01, 0.1, BB.trim, -0.4, 0.41, PZ);
  flag(st, UK_FLAG, -0.4, 0.42, PZ, 0.08, 0.06);
  // Önde telefon kulübesi, banklar, lambalar ve ağaçlar
  box(st, 0.026, 0.055, 0.026, BB.red, 0.36, 0.03, 0.24);
  box(st, 0.03, 0.008, 0.03, BB.red, 0.36, 0.085, 0.24);
  for (const [x, z] of [[-0.42, 0.42], [-0.2, 0.44], [0.0, 0.42], [0.44, 0.44]] as [number, number][]) plant(st, PROPS.treeLarge, x, z, n, 0.5);
  for (const x of [-0.32, -0.08]) bench(st, x, 0.2, 0, s);
  for (const x of [-0.42, 0.06, 0.32]) lamp(st, x, 0.16, s, 0.22);
  g.add(mergeStatic([st]));
  return g;
}

// ======================= Parthenon (2x2) =======================
// Akropolis: kayalık tepe (köşeli kireçtaşı yamaçlar, eteklerde kayalar ve zeytin ağaçları), öne inen taş
// basamaklar ve tepede küçük giriş kapısı (Propylaia). Tepede Parthenon'un kalıntısı: üç basamaklı kaide,
// 8 x 17 yivli Dor sütunu (taşların tonu biraz farklı), çatısı olmayan saçak (arşitrav, triglifli friz,
// korniş), iki uçta üçgen alınlık, içeride yıkık duvarlar ve yere düşmüş sütun parçaları. Yanında İon
// sütunlu küçük Erekhtheion.
const PT = {
  rock: new THREE.MeshStandardMaterial({ color: '#c4b493', roughness: 1 }),
  ground: pm('#d8cba9', 1),
  dry: pm('#a4b46c', 1),
  m1: pm('#ebe3d2', 0.8),
  m2: pm('#ddd1bb', 0.85),
  m3: pm('#f2ebdd', 0.8),
  dark: pm('#b9ab92', 0.9),
};
// Yivli sütun: 24 köşeli açık silindir, tek köşeler içe çekilir (yiv); aşağısı biraz kalın
const FLUTED = (() => {
  const geo = new THREE.CylinderGeometry(0.0086, 0.0106, 0.124, 24, 1, true);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if ((i % 25) % 2) p.setXYZ(i, p.getX(i) * 0.86, p.getY(i), p.getZ(i) * 0.86);
  }
  geo.computeVertexNormals();
  return geo;
})();
// Daralan çokgen gövde (tepe, kaya): taban noktaları y0'da, üstü k oranında küçülmüş y0 + h'de; düz gölgeli
function taperPrism(pts: [number, number][], y0: number, h: number, k: number) {
  const pos: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
    const A0 = new THREE.Vector3(ax, y0, az), B0 = new THREE.Vector3(bx, y0, bz);
    const A1 = new THREE.Vector3(ax * k, y0 + h, az * k), B1 = new THREE.Vector3(bx * k, y0 + h, bz * k);
    const out = new THREE.Vector3((ax + bx) / 2, 0, (az + bz) / 2);
    const nrm = new THREE.Vector3().crossVectors(B0.clone().sub(A0), B1.clone().sub(A0));
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    if (nrm.dot(out) > 0) {
      tri(A0, B0, B1);
      tri(A0, B1, A1);
    } else {
      tri(A0, B1, B0);
      tri(A0, A1, B1);
    }
    const C = new THREE.Vector3(0, y0 + h, 0);
    const up = new THREE.Vector3().crossVectors(A1.clone().sub(C), B1.clone().sub(C)).y > 0;
    if (up) tri(C, A1, B1);
    else tri(C, B1, A1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
function parthenon() {
  const n = 2, s = small(n);
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, PT.dry, 0, 0, 0);
  // Tepe: iki kademeli köşeli kaya gövde, eteklerinde kaya parçaları
  const pts: [number, number][] = [];
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    const r = 0.45 + (hash(k) - 0.5) * 0.06;
    pts.push([Math.sin(a) * r, Math.cos(a) * r * 0.9]);
  }
  add(st, taperPrism(pts, 0.03, 0.06, 0.93), PT.rock, 0, 0, 0);
  add(st, taperPrism(pts.map(([x, z]) => [x * 0.93, z * 0.93] as [number, number]), 0.09, 0.05, 0.92), PT.rock, 0, 0, 0);
  const top = 0.14;
  const plateau = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x * 0.84, -z * 0.84)));
  add(st, flat(new THREE.ShapeGeometry(plateau)), PT.ground, 0, top + 0.002, 0);
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2 + hash(k + 3);
    const r = 0.45 + hash(k + 7) * 0.04;
    rock(st, Math.sin(a) * r, 0.035, Math.cos(a) * r * 0.9, 0.018 + hash(k + 1) * 0.02, 1.3, 0.8, 1, PT.rock);
  }
  // Öne inen basamaklar ve Propylaia
  for (let i = 0; i < 10; i++) box(st, 0.07, 0.011 * (i + 1), 0.016, PT.m2, -0.25, 0.03, 0.46 - i * 0.016);
  const py = top + 0.002;
  box(st, 0.12, 0.008, 0.05, PT.m2, -0.25, py, 0.3);
  for (let k = 0; k < 6; k++) cyl(st, 0.006, 0.007, 0.06, PT.m1, -0.295 + k * 0.018, py + 0.008, 0.315, 10);
  box(st, 0.12, 0.012, 0.03, PT.m1, -0.25, py + 0.068, 0.31);
  // Tapınak: üç basamaklı kaide
  const L = 0.58, Wd = 0.26, cx = 0.04, cz = -0.06, y0 = top + 0.002;
  box(st, L + 0.05, 0.01, Wd + 0.05, PT.m2, cx, y0, cz);
  box(st, L + 0.032, 0.01, Wd + 0.032, PT.m1, cx, y0 + 0.01, cz);
  box(st, L + 0.014, 0.01, Wd + 0.014, PT.m3, cx, y0 + 0.02, cz);
  const y1 = y0 + 0.03;
  // Sütunlar (çevrede 8 x 17, iç revakta 6'şar)
  const cols: [number, number][] = [];
  for (let i = 0; i < 17; i++) {
    const x = -L / 2 + 0.012 + (i * (L - 0.024)) / 16;
    cols.push([x, -(Wd / 2 - 0.012)], [x, Wd / 2 - 0.012]);
  }
  for (let j = 1; j < 7; j++) {
    const z = -(Wd / 2 - 0.012) + (j * (Wd - 0.024)) / 7;
    cols.push([-(L / 2 - 0.012), z], [L / 2 - 0.012, z]);
  }
  for (let j = 0; j < 6; j++) {
    const z = -0.075 + j * 0.03;
    cols.push([-(L / 2 - 0.055), z], [L / 2 - 0.055, z]);
  }
  const tones = [PT.m1, PT.m2, PT.m3];
  cols.forEach(([x, z], k) => {
    const m = tones[Math.floor(hash(k * 3.1) * 3)];
    add(st, FLUTED, m, cx + x, y1 + 0.062, cz + z);
    cyl(st, 0.0122, 0.0088, 0.006, m, cx + x, y1 + 0.124, cz + z, 12);
    box(st, 0.026, 0.006, 0.026, m, cx + x, y1 + 0.13, cz + z);
  });
  // Saçak (çatısız): arşitrav, triglifli friz, korniş
  const y2 = y1 + 0.136;
  frame(st, L, Wd, 0.018, 0.026, PT.m1, cx, y2, cz);
  frame(st, L - 0.004, Wd - 0.004, 0.016, 0.022, PT.m3, cx, y2 + 0.018, cz);
  for (const sz of [-1, 1]) for (let k = 0; k < 34; k++) box(st, 0.006, 0.014, 0.002, PT.dark, cx - L / 2 + 0.01 + (k * (L - 0.02)) / 33, y2 + 0.019, cz + sz * ((Wd - 0.004) / 2 + 0.001));
  for (const sx of [-1, 1]) for (let k = 0; k < 14; k++) box(st, 0.002, 0.014, 0.006, PT.dark, cx + sx * ((L - 0.004) / 2 + 0.001), y2 + 0.019, cz - Wd / 2 + 0.01 + (k * (Wd - 0.02)) / 13);
  frame(st, L + 0.012, Wd + 0.012, 0.008, 0.03, PT.m2, cx, y2 + 0.034, cz);
  // Alınlıklar (iki uçta), batıdakinde birkaç heykel kalıntısı
  for (const sx of [-1, 1]) {
    add(st, gable(0.026, Wd + 0.012, 0.05), PT.m1, cx + sx * (L / 2 - 0.007), y2 + 0.042, cz);
    add(st, gable(0.004, Wd - 0.05, 0.03), PT.dark, cx + sx * (L / 2 + 0.0075), y2 + 0.046, cz);
  }
  for (let k = 0; k < 5; k++) box(st, 0.008, 0.01 + hash(k) * 0.012, 0.012, PT.m3, cx - L / 2 - 0.004, y2 + 0.046, cz - 0.06 + k * 0.03);
  // Yıkık iç duvarlar (cella)
  const cl = L * 0.64, cw = Wd * 0.6;
  for (const sz of [-1, 1]) {
    for (let k = 0; k < 10; k++) {
      const h = 0.02 + hash(k * 2 + sz) * 0.07;
      box(st, cl / 10 - 0.003, h, 0.012, tones[k % 3], cx - cl / 2 + ((k + 0.5) * cl) / 10, y1, cz + (sz * cw) / 2);
    }
  }
  for (const sx of [-1, 1]) box(st, 0.012, 0.035 + (sx > 0 ? 0.03 : 0), cw, PT.m2, cx + (sx * cl) / 2, y1, cz);
  // Yere düşmüş sütun parçaları ve bloklar
  for (let k = 0; k < 9; k++) {
    const x = -0.3 + hash(k + 20) * 0.6, z = 0.12 + hash(k + 30) * 0.12;
    const d = add(st, new THREE.CylinderGeometry(0.0105, 0.0105, 0.02 + hash(k) * 0.015, 12), tones[k % 3], x, top + 0.0125, z);
    d.rotation.set(0, hash(k + 40) * 3, Math.PI / 2);
  }
  // Erekhtheion: küçük tapınak ve İon sütunlu doğu revağı
  const ex = -0.17, ez = 0.19;
  box(st, 0.13, 0.008, 0.07, PT.m2, ex, y0, ez);
  box(st, 0.1, 0.065, 0.06, PT.m1, ex - 0.012, y0 + 0.008, ez);
  for (let k = 0; k < 6; k++) cyl(st, 0.0045, 0.005, 0.06, PT.m3, ex + 0.05, y0 + 0.008, ez - 0.026 + k * 0.0104, 10);
  box(st, 0.13, 0.008, 0.07, PT.m3, ex, y0 + 0.07, ez);
  // Zeytin ağaçları
  for (const [x, z] of [[-0.44, -0.42], [0.44, -0.42], [0.45, 0.42], [-0.44, 0.4], [0.2, 0.46], [-0.1, 0.46]] as [number, number][]) plant(st, PROPS.treeLarge, x, z, n, 0.4);
  lamp(st, -0.2, 0.44, s, 0.18);
  g.add(mergeStatic([st]));
  return g;
}

// ======================= Chichen Itza (2x2) =======================
// Kukulkan Piramidi (El Castillo): dokuz kademeli, kenarları eğik kireçtaşı basamak piramidi (her kademede
// gölge çizgisi), dört yüzde de tepeye çıkan merdiven ve korkulukları, ön merdivenin dibinde yılan başları;
// tepede kapılı taş tapınak, friz ve mazgallar. Çevresi toprak meydan, çimen ve orman ağaçları.
const CI = {
  stone: pm('#dbd1b4', 0.95),
  stone2: pm('#cdbf9c', 0.95),
  dark: pm('#5e5648', 0.9),
  temple: pm('#d2c6a6', 0.95),
  grass: pm('#79bd57', 1),
  dirt: pm('#d8c398', 1),
  snake: pm('#8e8572', 0.9),
};
function chichen() {
  const n = 2, s = small(n);
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, CI.grass, 0, 0, 0);
  box(st, 0.78, 0.003, 0.78, CI.dirt, 0, 0.03, 0);
  const B = 0.56, Tp = 0.2, levels = 9, H = 0.3, lh = H / levels, y0 = 0.033;
  for (let k = 0; k < levels; k++) {
    const w = B - ((B - Tp) * k) / levels, w2 = w - 0.014;
    add(st, frustum(w, w, lh, w2, w2), k % 2 ? CI.stone : CI.stone2, 0, y0 + k * lh + lh / 2, 0);
    box(st, w - 0.006, 0.003, w - 0.006, CI.dark, 0, y0 + k * lh + lh * 0.52, 0);
  }
  const top = y0 + H;
  // Dört yüzde merdiven, korkuluklar; önde yılan başları
  const N = 24, out = B / 2 + 0.03, run = (out - Tp / 2) / N;
  for (let side = 0; side < 4; side++) {
    const f = item(st, 0, 0, (side * Math.PI) / 2, 1, 0);
    for (let i = 0; i < N; i++) {
      const yTop = y0 + (H * (i + 1)) / N;
      box(f, 0.085, yTop - y0, run, i % 2 ? CI.stone : CI.stone2, 0, y0, out - run * (i + 0.5));
    }
    for (const sx of [-1, 1]) rod(f, [sx * 0.048, y0 + 0.006, out], [sx * 0.048, top + 0.008, Tp / 2], 0.008, CI.stone2, 4);
    if (side === 0) {
      for (const sx of [-1, 1]) {
        box(f, 0.03, 0.026, 0.036, CI.snake, sx * 0.048, y0, out + 0.012);
        box(f, 0.024, 0.004, 0.006, CI.dark, sx * 0.048, y0 + 0.008, out + 0.0305);
      }
    }
  }
  // Tapınak: kapılar (önde iki yılan sütunlu üç kapı), friz, dam ve mazgallar
  box(st, Tp + 0.008, 0.006, Tp + 0.008, CI.stone2, 0, top, 0);
  const tw = 0.14, th = 0.07, ty = top + 0.006;
  box(st, tw, th, tw, CI.temple, 0, ty, 0);
  for (let k = 0; k < 4; k++) {
    const f = item(st, 0, 0, (k * Math.PI) / 2, 1, 0);
    if (k === 0) {
      for (const x of [-0.04, 0, 0.04]) box(f, 0.026, 0.04, 0.003, CI.dark, x, ty, tw / 2 + 0.0005);
      for (const x of [-0.02, 0.02]) cyl(f, 0.006, 0.006, 0.04, CI.stone, x, ty, tw / 2 + 0.004, 8);
    } else box(f, 0.03, 0.04, 0.003, CI.dark, 0, ty, tw / 2 + 0.0005);
  }
  box(st, tw + 0.006, 0.016, tw + 0.006, CI.stone2, 0, ty + th - 0.022, 0);
  box(st, tw - 0.01, 0.008, tw - 0.01, CI.stone, 0, ty + th, 0);
  for (let k = 0; k < 8; k++) {
    for (const sz of [-1, 1]) {
      box(st, 0.008, 0.012, 0.008, CI.stone, -0.056 + k * 0.016, ty + th + 0.008, sz * 0.058);
      box(st, 0.008, 0.012, 0.008, CI.stone, sz * 0.058, ty + th + 0.008, -0.056 + k * 0.016);
    }
  }
  // Çevrede orman ağaçları
  for (const [x, z] of [[-0.44, -0.44], [0.44, -0.44], [-0.45, 0.44], [0.45, 0.44], [-0.45, 0], [0.45, -0.05], [0, -0.45], [-0.25, -0.46], [0.25, -0.46]] as [number, number][]) plant(st, PROPS.treeLarge, x, z, n, 0.55 + hash(x + z * 3) * 0.15);
  for (const x of [-0.25, 0.25]) bench(st, x, 0.43, Math.PI, s);
  g.add(mergeStatic([st]));
  return g;
}

// ======================= Sidney Opera Binası (3x3, su kıyısında) =======================
// Pembe granit kaplı geniş podyum, karada (arkada) anıtsal merdiven; üstünde iki salonun iç içe yelken
// kabukları ve küçük restoran kabukları. Kabuklar küre parçası gibi kıvrılır, yüzeyleri krem-beyaz
// şevron desenli karo; ağızları bronz tonlu camla kapalı (gece içeriden yanar). Ön yüz (+z) suya bakar.
const TILES = canvasTex(128, 128, g => {
  g.fillStyle = '#eeeadf';
  g.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      g.fillStyle = (r + c) % 2 ? '#f8f6f0' : '#e6e1d4';
      g.fillRect(c * 8 + 0.5, r * 8 + 0.5, 7, 7);
    }
  }
  g.strokeStyle = '#d6cfbf';
  g.lineWidth = 2;
  for (let r = 0; r < 4; r++) {
    g.beginPath();
    g.moveTo(0, r * 32 + 4);
    g.lineTo(64, r * 32 + 28);
    g.lineTo(128, r * 32 + 4);
    g.stroke();
  }
});
const BRONZE_GLASS = canvasTex(64, 64, g => {
  g.fillStyle = '#4a3a2a';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#5c4a36';
  g.fillRect(0, 0, 64, 30);
  g.fillStyle = '#a88b5a';
  for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 1.5, 64);
  for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 1.5);
});
const OP = {
  podium: pm('#c9a48a', 0.85),
  podium2: pm('#b8917a', 0.85),
  paving: pm('#d8cfc0', 0.95),
  shell: new THREE.MeshStandardMaterial({ map: TILES, roughness: 0.32, side: THREE.DoubleSide }),
  glass: (() => {
    const m = new THREE.MeshStandardMaterial({ map: BRONZE_GLASS, emissiveMap: BRONZE_GLASS, roughness: 0.2, metalness: 0.35, side: THREE.DoubleSide });
    m.name = 'window';
    return m;
  })(),
  rail: pm('#f2f2ee', 0.5),
  lawn: pm('#68b851', 1),
};
const bez2 = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, t: number) =>
  a.clone().multiplyScalar((1 - t) * (1 - t)).add(b.clone().multiplyScalar(2 * t * (1 - t))).add(c.clone().multiplyScalar(t * t));
const bez3 = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number) => {
  const u = 1 - t;
  return a.clone().multiplyScalar(u * u * u).add(b.clone().multiplyScalar(3 * u * u * t)).add(c.clone().multiplyScalar(3 * u * t * t)).add(d.clone().multiplyScalar(t * t * t));
};
// Yelken kabuğu: tabanı x boyunca w genişliğinde (z = 0), sırtı arkadan (z = -d) yükselip öne eğilen tepeye
// (y = h, z = lean) çıkar. Kesitler iki kenar ile sırttan geçen eğriler. Ağız (+z) camla kapanır.
function shell(w: number, h: number, d: number, lean: number) {
  const A = new THREE.Vector3(0, h, lean);
  const ridge = (t: number) => bez3(new THREE.Vector3(0, 0, -d), new THREE.Vector3(0, h * 0.75, -d * 1.05), new THREE.Vector3(0, h, lean - d * 0.6), A, t);
  const edge = (sx: number, t: number) => bez2(new THREE.Vector3((sx * w) / 2, 0, 0), new THREE.Vector3(sx * w * 0.3, h * 0.55, lean * 0.2), A, t);
  const NS = 16, NT = 18;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const gpos: number[] = [], guv: number[] = [];
  for (let j = 0; j <= NT; j++) {
    const t = j / NT;
    const R = ridge(t), Lm = edge(-1, t), Lp = edge(1, t);
    const ctrl = R.clone().multiplyScalar(2).sub(Lm.clone().add(Lp).multiplyScalar(0.5));
    for (let i = 0; i <= NS; i++) {
      const u = i / NS;
      const p = bez2(Lm, ctrl, Lp, u);
      pos.push(p.x, p.y, p.z);
      uv.push((u * (w + d)) / 0.06, (t * h) / 0.06);
      // Cam, kabuğun içine geri çekilir (önden bakınca beyaz kabuğun kenarı ve gölgeli cam görünür)
      const q = Lm.clone().lerp(Lp, u).add(R.clone().sub(Lm.clone().add(Lp).multiplyScalar(0.5)).multiplyScalar(0.55));
      gpos.push(q.x, q.y, q.z);
      guv.push((u * w) / 0.035, (t * h) / 0.035);
    }
  }
  for (let j = 0; j < NT; j++) {
    for (let i = 0; i < NS; i++) {
      const a = j * (NS + 1) + i, b = a + 1, c = a + NS + 1, e = c + 1;
      idx.push(a, c, b, b, c, e);
    }
  }
  const make = (p: number[], t: number[]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(t, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };
  const grp = new THREE.Group();
  grp.add(part(make(pos, uv), OP.shell, 0, 0, 0));
  grp.add(part(make(gpos, guv), OP.glass, 0, 0, 0));
  return grp;
}
function opera() {
  const n = 3, s = small(n);
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, OP.paving, 0, 0, 0);
  // Podyum: granit kaplı geniş kaide, arkada (karada) anıtsal merdiven, önde su kıyısı korkuluğu
  const PY = 0.03, PH = 0.06, top = PY + PH;
  box(st, 0.86, PH, 0.6, OP.podium, 0, PY, 0.04);
  box(st, 0.87, 0.006, 0.61, OP.podium2, 0, top - 0.006, 0.04);
  for (let k = 0; k < 6; k++) box(st, 0.56, PH - k * 0.01, 0.022, k % 2 ? OP.podium : OP.podium2, 0, PY, -0.27 - k * 0.022);
  for (const sx of [-1, 1]) box(st, 0.1, PH, 0.13, OP.podium, sx * 0.33, PY, -0.33);
  for (let k = 0; k <= 20; k++) cyl(st, 0.0018, 0.0018, 0.02, OP.rail, -0.42 + k * 0.042, PY, 0.475, 4);
  rod(st, [-0.43, PY + 0.02, 0.475], [0.43, PY + 0.02, 0.475], 0.0015, OP.rail, 4);
  // Kabuklar: iki salon yan yana (biri biraz büyük), her birinde arkaya doğru büyüyen üç kabuk ve
  // arkaya bakan bir kabuk; sağ önde küçük restoran kabukları
  const halls: [number, number][] = [[-0.19, 1.08], [0.17, 0.95]];
  for (const [hx, k] of halls) {
    const list: [number, number, number, number, number, number][] = [
      // [z, w, h, d, lean, dönüş]
      [0.2, 0.17, 0.15, 0.09, 0.04, 0],
      [0.09, 0.22, 0.23, 0.12, 0.05, 0],
      [-0.04, 0.24, 0.3, 0.13, 0.06, 0],
      [-0.12, 0.2, 0.2, 0.08, 0.04, Math.PI],
    ];
    for (const [z, w, h, d, lean, rot] of list) {
      const sh = shell(w * k, h * k, d * k, lean * k);
      sh.position.set(hx, top, z);
      sh.rotation.y = rot;
      st.add(sh);
    }
  }
  for (const [z, w, h, d, lean, rot] of [[0.33, 0.1, 0.08, 0.05, 0.02, 0], [0.27, 0.09, 0.07, 0.04, 0.02, Math.PI]] as [number, number, number, number, number, number][]) {
    const sh = shell(w, h, d, lean);
    sh.position.set(0.36, top, z);
    sh.rotation.y = rot;
    st.add(sh);
  }
  // Podyumun üstünde yürüyüş alanı lambaları ve banklar; karada ağaçlar
  for (const x of [-0.38, 0.0, 0.38]) lamp(st, x, 0.3, s, 0.16);
  for (const sx of [-1, 1]) {
    plant(st, PROPS.treeLarge, sx * 0.44, -0.44, n, 0.55);
    plant(st, PROPS.treeLarge, sx * 0.44, -0.3, n, 0.5);
    bench(st, sx * 0.36, -0.44, 0, s);
  }
  g.add(mergeStatic([st]));
  return g;
}

// ======================= Stonehenge (2x2) =======================
// Çimenli ovada toprak set ve hendek halkası, ziyaretçi yolu. Dış çemberde kumtaşı (sarsen) dikili taşlar
// (bazıları eksik ya da yıkık), bir kısmının üstünde lento taşları; içeride at nalı biçiminde beş üçlü taş
// (biri yıkık), mavi taş çemberi, ortada sunak taşı, dışarıda Topuk Taşı. Taşlar köşeli ve her biri farklı
// tonda (gri, yosunlu). Çevrede otlayan koyunlar.
const SH = {
  grass: pm('#86b85f', 1),
  bank: pm('#79ac56', 1),
  path: pm('#cfc3a2', 1),
  stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  wool: pm('#f1efe8', 1),
  head: pm('#2e2b29', 0.9),
};
// Köşeli taş: kutunun köşeleri konuma göre biraz oynatılır (aynı köşe her yüzde aynı kayar), renk tonlu
function sarsen(w: number, h: number, d: number, seed: number) {
  const geo = new THREE.BoxGeometry(w, h, d, 1, 2, 1);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = seed * 13.7 + x * 91 + y * 57 + z * 33;
    const top = y > 0 ? 0.85 : 1;
    p.setXYZ(i, x * (0.82 + hash(k) * 0.3) * top, y + (hash(k + 1) - 0.5) * h * 0.08, z * (0.8 + hash(k + 2) * 0.3) * top);
  }
  const flatGeo = faceted(geo);
  const base = new THREE.Color().setHSL(0.11 + hash(seed) * 0.05, 0.05 + hash(seed + 1) * 0.05, 0.4 + hash(seed + 2) * 0.1);
  const moss = new THREE.Color('#8f9a7a');
  const col: number[] = [];
  const q = flatGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < q.count; i++) {
    const c = base.clone().lerp(moss, hash(seed + i * 0.37) * 0.35 * (q.getY(i) < 0 ? 1 : 0.5));
    col.push(c.r, c.g, c.b);
  }
  flatGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return flatGeo;
}
function stonehenge() {
  const n = 2, s = small(n);
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, SH.grass, 0, 0, 0);
  // Toprak set, ziyaretçi yolu, yola uzanan patika ve geçit (avenue)
  const bank = add(st, new THREE.TorusGeometry(0.42, 0.024, 6, 56).rotateX(Math.PI / 2), SH.bank, 0, 0.03, 0);
  bank.scale.y = 0.35;
  add(st, flat(new THREE.RingGeometry(0.315, 0.335, 56)), SH.path, 0, 0.032, 0);
  box(st, 0.02, 0.002, 0.16, SH.path, 0.12, 0.03, 0.41);
  const stone = (w: number, h: number, d: number, seed: number, x: number, z: number, a: number, lying = false) => {
    const o = add(st, sarsen(w, h, d, seed), SH.stone, x, 0.03 + (lying ? d / 2 : h / 2), z);
    o.rotation.y = a;
    if (lying) o.rotation.x = Math.PI / 2;
    else o.rotation.z = (hash(seed + 5) - 0.5) * 0.08;
    return o;
  };
  // Dış sarsen çemberi (açıklığı önde, +z yönünde)
  const R = 0.2, H = 0.08;
  const standing = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 14, 15, 16, 20, 21, 22, 26, 27, 28, 29]);
  for (let k = 0; k < 30; k++) {
    const a = (k / 30) * Math.PI * 2 + Math.PI / 30;
    const x = Math.sin(a) * R, z = Math.cos(a) * R;
    if (standing.has(k)) stone(0.036, H, 0.022, k + 1, x, z, a);
    else if (k === 9 || k === 18) stone(0.036, H, 0.022, k + 1, Math.sin(a) * (R + 0.04), Math.cos(a) * (R + 0.04), a, true);
  }
  const chord = 2 * R * Math.sin(Math.PI / 30);
  for (const k of [26, 27, 28, 29, 0, 1, 2, 3, 4, 5, 6, 7, 14, 15, 20, 21]) {
    if (!standing.has((k + 1) % 30)) continue;
    const a = ((k + 1) / 30) * Math.PI * 2;
    const o = add(st, sarsen(chord + 0.006, 0.016, 0.024, 200 + k), SH.stone, Math.sin(a) * R, 0.03 + H + 0.008, Math.cos(a) * R);
    o.rotation.y = a;
  }
  // At nalı: beş üçlü taş (en büyüğü arkada, yarısı yıkık)
  const tri: [number, number][] = [[Math.PI, 0.125], [Math.PI - 0.75, 0.1], [Math.PI + 0.75, 0.1], [Math.PI - 1.45, 0.09], [Math.PI + 1.45, 0.09]];
  tri.forEach(([a, h], k) => {
    const r = 0.115, cx = Math.sin(a) * r, cz = Math.cos(a) * r;
    const tx = Math.cos(a), tz = -Math.sin(a);
    if (k === 0) {
      stone(0.032, h, 0.026, 300, cx - tx * 0.02, cz - tz * 0.02, a);
      stone(0.032, h, 0.026, 301, cx + tx * 0.04, cz + tz * 0.04 + 0.03, a + 0.4, true);
      stone(0.08, 0.02, 0.03, 302, cx - 0.01, cz + 0.06, a + 1.2, true);
      return;
    }
    for (const sx of [-1, 1]) stone(0.03, h, 0.024, 310 + k * 2 + sx, cx + sx * tx * 0.02, cz + sx * tz * 0.02, a);
    const l = add(st, sarsen(0.074, 0.018, 0.028, 330 + k), SH.stone, cx, 0.03 + h + 0.009, cz);
    l.rotation.y = a;
  });
  // Mavi taşlar (küçük), sunak taşı, Topuk Taşı
  for (let k = 0; k < 22; k++) {
    if (k % 7 === 3) continue;
    const a = (k / 22) * Math.PI * 2;
    stone(0.016, 0.034 + hash(k + 50) * 0.012, 0.014, 400 + k, Math.sin(a) * 0.158, Math.cos(a) * 0.158, a);
  }
  for (let k = 0; k < 9; k++) {
    const a = Math.PI + (-1 + k / 4) * 1.2;
    stone(0.014, 0.045, 0.012, 450 + k, Math.sin(a) * 0.07, Math.cos(a) * 0.07, a);
  }
  stone(0.07, 0.016, 0.026, 470, 0, -0.04, 0.3, true);
  const heel = stone(0.04, 0.07, 0.034, 480, 0.12, 0.36, 0.2);
  heel.rotation.x = 0.15;
  // Koyunlar
  for (let k = 0; k < 7; k++) {
    const a = hash(k + 90) * Math.PI * 2, r = 0.36 + hash(k + 91) * 0.08;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (z > 0.3 && x > 0.05) continue;
    const b = item(st, x, z, a, 1, 0.03);
    add(b, new THREE.SphereGeometry(0.014, 8, 6), SH.wool, 0, 0.016, 0).scale.set(1, 0.8, 1.4);
    add(b, new THREE.SphereGeometry(0.006, 6, 5), SH.head, 0, 0.02, 0.021);
    for (const [lx, lz] of [[-0.006, -0.01], [0.006, -0.01], [-0.006, 0.01], [0.006, 0.01]]) box(b, 0.003, 0.008, 0.003, SH.head, lx, 0, lz);
  }
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.46, 0.44]] as [number, number][]) plant(st, PROPS.treeLarge, x, z, n, 0.45);
  bench(st, 0.0, 0.36, Math.PI, s);
  g.add(mergeStatic([st]));
  return g;
}

// ======================= Kapadokya (3x3) =======================
// Peri bacaları: yumuşak tüf kayadan, katman katman renkli konik kuleler; tepelerinde koyu bazalt şapka, içlerine
// oyulmuş kapı ve pencereler (bir kısmı gece yanan mağara odaları). Arkada oyma pencereli tüf sırtı, yanda bağ,
// önde balonların kalktığı düzlük. Sıcak hava balonları sabah sırayla kalkıp şehrin üstünde yavaşça süzülür,
// akşam sırayla iner; gece yerde bekler, brülörleri ara ara yanınca balon içten turuncu parlar.
const STRATA = canvasTex(8, 128, g => {
  const bands = ['#e8d6b8', '#e2caa6', '#eddfc6', '#dcc09c', '#e6d0b2', '#dfc4a3', '#efe3cd', '#d9b693', '#e7d2b4'];
  for (let y = 0, k = 0; y < 128; k++) {
    const h = 5 + Math.floor(hash(k * 3.7) * 13);
    g.fillStyle = bands[k % bands.length];
    g.fillRect(0, y, 8, h);
    g.fillStyle = 'rgba(120, 90, 60, 0.1)';
    g.fillRect(0, y, 8, 1);
    y += h;
  }
});
const KP = {
  ground: pm('#d8c29c', 1),
  field: pm('#cbb487', 1),
  pad: pm('#bba57a', 1),
  vine: pm('#6e9a3f', 0.9),
  soil: pm('#b59a74', 1),
  tuff: new THREE.MeshStandardMaterial({ map: STRATA, roughness: 1 }),
  cap: pm('#6c5847', 0.95),
  hole: pm('#3a2d25', 1),
  path: pm('#e6d6b4', 1),
  basket: pm('#8a5a2c', 0.9),
  rim: pm('#5b3b1e', 0.9),
  rope: pm('#4a3a2a', 0.9),
  burner: pm('#50565e', 0.4, 0.6),
};
// Mağara penceresi: koyu oyuk, gece sarı yanar (DayNight 'window' adlı malzemeleri yakar)
const CAVE_WIN = (() => {
  const m = new THREE.MeshStandardMaterial({ color: '#3d2f26', roughness: 0.9 });
  m.name = 'window';
  return m;
})();
// Tüf gövde: aşağıdan yukarı daralan döner yüzey; prof(t) 0 tabanda 1 tepede yarıçap çarpanı. Katman dokusu
// gövdenin boyuna göre tekrar eder (bütün kayalarda katmanlar aynı kalınlıkta)
function tuffBody(prof: (t: number) => number, r: number, h: number, seed: number, flatTop = false) {
  const pts: [number, number][] = [];
  const n = 10;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    pts.push([r * prof(t) * (1 + (hash(seed + k * 1.3) - 0.5) * 0.12), t * h]);
  }
  if (flatTop) pts.push([0, h]);
  const geo = lathe(pts, 14);
  geo.scale(1 + (hash(seed) - 0.5) * 0.24, 1, 1 + (hash(seed + 1) - 0.5) * 0.24);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (h / 0.12) + hash(seed + 2));
  return geo;
}
const spire = (t: number) => 0.26 + 0.74 * Math.pow(1 - t, 1.5);
const mesa = (t: number) => 1 - 0.45 * Math.pow(t, 1.8);
// Kayanın yüzüne oyulmuş kapı ya da pencere (a: hangi yöne baktığı, t: yükseklik oranı)
function carve(g: THREE.Object3D, x: number, z: number, r: number, h: number, prof: (t: number) => number, a: number, t: number, w: number, hh: number, m: THREE.Material) {
  const rr = r * prof(t) * 0.96;
  const o = box(g, w, hh, 0.008, m, x + Math.sin(a) * rr, 0.03 + t * h, z + Math.cos(a) * rr);
  o.rotation.y = a;
}
// Balon zarfı: ağzı altta (y = 0), en geniş yeri üçte ikide; dilimli renkli boyası tuvale çizilir
const ENVELOPE = lathe(
  ([[0.2, 0], [0.3, 0.15], [0.5, 0.42], [0.72, 0.75], [0.9, 1.08], [0.99, 1.4], [1.0, 1.6], [0.95, 1.8], [0.82, 1.98], [0.6, 2.12], [0.32, 2.2], [0, 2.23]] as [number, number][]).map(
    ([r, y]) => [r * 0.085, y * 0.085] as [number, number],
  ),
  18,
);
const BALLOON_STYLES = [
  ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'],
  ['#d32f2f', '#fafafa'],
  ['#1565c0', '#ffd54f'],
  ['#2e7d32', '#ff8f00', '#fff3e0'],
  ['#6a1b9a', '#ec407a', '#ffd1e8'],
  ['#00897b', '#ffffff', '#fbc02d'],
];
const BALLOON_MATS: THREE.MeshStandardMaterial[] = [];
function balloonMat(k: number) {
  const i = k % BALLOON_STYLES.length;
  if (BALLOON_MATS[i]) return BALLOON_MATS[i];
  const pal = BALLOON_STYLES[i];
  const tex = canvasTex(192, 128, g => {
    const n = 12;
    for (let s = 0; s < n; s++) {
      g.fillStyle = pal[s % pal.length];
      g.fillRect((s * 192) / n, 0, 192 / n + 1, 128);
    }
    // Ekvatorda süslü bant, tepede koyu kapak, ağızda kenar şeridi (doku yukarıdan aşağı: tepe y = 0)
    const by = 128 * (1 - 0.66);
    g.fillStyle = i % 2 ? '#fff6d0' : '#fdd835';
    g.fillRect(0, by - 6, 192, 12);
    g.fillStyle = pal[0];
    for (let x = 0; x < 192; x += 16) {
      g.beginPath();
      g.moveTo(x, by + 6);
      g.lineTo(x + 8, by - 6);
      g.lineTo(x + 16, by + 6);
      g.fill();
    }
    g.fillStyle = 'rgba(0, 0, 0, 0.3)';
    g.fillRect(0, 0, 192, 5);
    g.fillStyle = pal[pal.length - 1];
    g.fillRect(0, 120, 192, 8);
  });
  const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ff9a40', emissiveIntensity: 0, roughness: 0.7, side: THREE.DoubleSide });
  m.name = 'balloon';
  return (BALLOON_MATS[i] = m);
}
const FLAME = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const BASKET_Y = -0.055; // sepetin altı zarfın ağzından bu kadar aşağıda
function balloon(k: number) {
  const b = new THREE.Group();
  const mat = balloonMat(k);
  add(b, ENVELOPE, mat, 0, 0, 0);
  const rig = new THREE.Group();
  const bw = 0.026, bh = 0.02;
  box(rig, bw, bh, bw, KP.basket, 0, BASKET_Y, 0);
  frame(rig, bw + 0.004, bw + 0.004, 0.004, 0.003, KP.rim, 0, BASKET_Y + bh - 0.002, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rod(rig, [(sx * bw) / 2, BASKET_Y + bh, (sz * bw) / 2], [sx * 0.012, 0.004, sz * 0.012], 0.0011, KP.rope, 4);
  cyl(rig, 0.0055, 0.0055, 0.008, KP.burner, 0, BASKET_Y + bh + 0.012, 0, 8);
  add(rig, new THREE.TorusGeometry(0.017, 0.0016, 4, 18).rotateX(Math.PI / 2), KP.rope, 0, 0.002, 0);
  b.add(mergeStatic([rig]));
  const flame = add(b, new THREE.ConeGeometry(0.0055, 0.03, 8), FLAME, 0, BASKET_Y + bh + 0.034, 0);
  flame.visible = false;
  b.traverse(o => {
    o.castShadow = false; // gölge haritası her karede çizilmiyor: uçan balonun gölgesi yerde takılı kalmasın
    o.receiveShadow = false;
  });
  return { b, flame, mat };
}
function cappadocia() {
  const n = 3, s = small(n);
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, KP.ground, 0, 0, 0);
  // Balon düzlüğü, kalkış yerleri ve yola inen patika
  box(st, 0.74, 0.003, 0.38, KP.field, 0.11, 0.03, 0.28);
  const PADS: [number, number][] = [[-0.2, 0.2], [0, 0.16], [0.2, 0.2], [0.38, 0.27], [-0.08, 0.37], [0.17, 0.39]];
  for (const [x, z] of PADS) add(st, flat(new THREE.CircleGeometry(0.05, 18)), KP.pad, x, 0.0345, z);
  box(st, 0.05, 0.002, 0.2, KP.path, -0.29, 0.03, 0.39);
  // Bağ: toprak sıraların arasında asma sıraları
  box(st, 0.15, 0.003, 0.3, KP.soil, -0.39, 0.03, 0.29);
  for (let k = 0; k < 6; k++) box(st, 0.012, 0.014, 0.27, KP.vine, -0.45 + k * 0.024, 0.033, 0.29);
  // Arka sırt: düz tepeli, katmanlı tüf tümsekleri ve yüzlerine oyulmuş mağara otelinin pencereleri
  const ridge: [number, number, number, number][] = [[-0.36, -0.37, 0.12, 0.13], [-0.17, -0.38, 0.13, 0.16], [0.03, -0.37, 0.12, 0.12], [0.21, -0.38, 0.13, 0.15], [0.37, -0.37, 0.11, 0.11]];
  ridge.forEach(([x, z, r, h], k) => {
    add(st, tuffBody(mesa, r, h, 50 + k, true), KP.tuff, x, 0.03, z);
    for (let w = 0; w < 6; w++) {
      const a = (hash(k * 7 + w) - 0.5) * 1.3, t = 0.18 + (w % 3) * 0.24 + hash(k + w * 3) * 0.06;
      carve(st, x, z, r, h, mesa, a, t, 0.012, 0.016, w % 2 ? CAVE_WIN : KP.hole);
    }
  });
  // Peri bacaları: kümeler halinde; bazılarının dibinde ortak tümsek
  const CH: [number, number, number, number][] = [
    [-0.4, -0.18, 0.17, 0.06], [-0.3, -0.1, 0.12, 0.05], [-0.38, -0.01, 0.09, 0.045], [-0.2, -0.21, 0.21, 0.065], [-0.11, -0.09, 0.14, 0.05],
    [-0.22, 0.03, 0.08, 0.04], [-0.01, -0.2, 0.16, 0.055], [0.07, -0.07, 0.11, 0.045], [-0.02, 0.04, 0.07, 0.035], [0.15, -0.22, 0.19, 0.06],
    [0.23, -0.09, 0.13, 0.05], [0.13, 0.03, 0.085, 0.04], [0.33, -0.17, 0.15, 0.055], [0.41, -0.05, 0.11, 0.05], [0.31, 0.04, 0.08, 0.04],
    [-0.45, 0.1, 0.06, 0.03], [0.45, 0.1, 0.07, 0.033],
  ];
  CH.forEach(([x0, z0, h, r], k) => {
    const x = x0 + (hash(k + 11) - 0.5) * 0.02, z = z0 + (hash(k + 13) - 0.5) * 0.02;
    if (k % 3 === 0) add(st, tuffBody(t => 1 - 0.6 * t, r * 1.7, h * 0.22, 80 + k, true), KP.tuff, x, 0.03, z);
    add(st, tuffBody(spire, r, h, 100 + k), KP.tuff, x, 0.03, z);
    // Bazalt şapka
    const rc = r * 0.5;
    add(st, lathe([[0.001, -0.004], [rc, 0], [rc * 1.06, 0.006], [rc * 0.82, 0.013], [rc * 0.35, 0.02], [0, 0.022]], 12), KP.cap, x, 0.03 + h - 0.005, z);
    // Oyma kapı ve pencereler (bir kısmı yaşanan oda: gece yanar)
    const a = (hash(k + 17) - 0.5) * 2.4;
    if (h > 0.09) carve(st, x, z, r, h, spire, a, 0.06, 0.014, 0.022, KP.hole);
    for (let w = 0; w < (h > 0.14 ? 3 : 1); w++) carve(st, x, z, r, h, spire, a + (w - 1) * 0.9, 0.3 + w * 0.12, 0.01, 0.013, (k + w) % 3 ? CAVE_WIN : KP.hole);
  });
  // Kavaklar, kayısı ağaçları, kayalar
  for (const [x, z] of [[-0.46, -0.46], [-0.3, 0.14], [0.46, 0.4], [0.46, -0.27], [-0.46, 0.44]] as [number, number][]) plant(st, PROPS.treeSmall, x, z, n, 0.55);
  for (const [x, z] of [[0.08, -0.13], [-0.32, 0.1]] as [number, number][]) plant(st, PROPS.treeLarge, x, z, n, 0.4);
  // Yere serili (şişirilmeyi bekleyen) iki balon, yanlarında fan; balon ekiplerinin arabaları
  for (const [x, z, a, color] of [[0.07, 0.28, 0.7, '#ef6c00'], [0.44, 0.13, Math.PI / 2, '#5e35b1']] as [number, number, number, string][]) {
    const e = add(st, new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), pm(color, 0.8), x, 0.033, z);
    e.scale.set(0.055, 0.01, 0.022);
    e.rotation.y = a;
    const fx = x - Math.cos(a) * 0.065, fz = z + Math.sin(a) * 0.065;
    cyl(st, 0.008, 0.008, 0.016, KP.burner, fx, 0.033, fz, 10).rotation.set(Math.PI / 2, a, 0, 'YXZ');
  }
  for (const [kind, x, z, rot, color] of [['pickup', -0.19, 0.45, Math.PI / 2, '#f5f5f5'], ['van', 0.37, 0.43, 0, '#ffca28']] as const) {
    const c = carModel(kind, color);
    c.position.set(x, 0.033, z);
    c.rotation.y = rot;
    c.scale.multiplyScalar(s);
    st.add(c);
  }
  for (let k = 0; k < 10; k++) rock(st, -0.45 + hash(k + 60) * 0.9, 0.035, -0.06 + hash(k + 61) * 0.14, 0.008 + hash(k) * 0.01, 1.2, 0.7, 1, PT.rock);
  for (const [x, z] of [[-0.29, 0.28], [0.47, 0.03], [0.02, 0.475]] as [number, number][]) lamp(st, x, z, s, 0.14);
  g.add(mergeStatic([st]));
  // Sıcak hava balonları (her biri kendi kalkış yerinde başlar)
  const fly = PADS.map(([px, pz], k) => {
    const { b, flame, mat } = balloon(k);
    b.position.set(px, 0.03 - BASKET_Y, pz);
    g.add(b);
    return {
      b, flame, mat, px, pz, lift: 0,
      th: hash(k + 4) * Math.PI * 2,
      // Ne kadar yükseğe çıkar ve süzüldüğü yolun yarıçapları (yerel ölçü; 1 = 3 kare): Kapadokya'nın
      // çevresinde kalır, ekranda yapıyla birlikte görünür
      alt: 1.2 + hash(k + 9) * 0.4,
      rx: 0.7 + hash(k + 3) * 0.6, rz: 0.6 + hash(k + 5) * 0.5,
      cx: (hash(k + 7) - 0.5) * 0.4, cz: (hash(k + 8) - 0.5) * 0.4,
      sp: (0.02 + hash(k + 2) * 0.012) * (k % 2 ? 1 : -1),
    };
  });
  let last = 0;
  const step = (t: number) => {
    const dt = Math.min(0.25, Math.max(0, t - last));
    last = t;
    // Gece ne kadar: lambalar (BULB) gece yanar
    const night = Math.min(1, BULB.emissiveIntensity / 2);
    fly.forEach((f, k) => {
      // Sabah sırayla kalkar, akşam ters sırayla iner
      const want = 1 - night > 0.3 + k * 0.09 ? 1 : 0;
      f.lift += Math.max(-dt * 0.07, Math.min(dt * 0.07, want - f.lift));
      f.th += dt * f.sp * Math.min(1, f.lift * 2);
      const up = THREE.MathUtils.smoothstep(f.lift, 0, 1), out = THREE.MathUtils.smoothstep(f.lift, 0.3, 1);
      const qx = f.cx + Math.cos(f.th) * f.rx, qz = f.cz + Math.sin(f.th) * f.rz;
      f.b.position.set(f.px + (qx - f.px) * out, 0.03 - BASKET_Y + up * f.alt + Math.sin(t * 0.4 + k) * 0.012 * up, f.pz + (qz - f.pz) * out);
      f.b.rotation.y = t * 0.04 + k * 1.3;
      // Brülör: kalkarken sık, havada ara ara, gece yerde arada bir yanar (balon içten parlar)
      const rising = f.lift > 0.01 && f.lift < 0.99;
      const burn = rising ? Math.sin(t * 2.2 + k) > -0.3 : Math.sin(t * 0.7 + k * 1.9) + Math.sin(t * 1.9 + k) * 0.3 > (f.lift > 0.5 ? 0.85 : 1.05);
      f.flame.visible = burn;
      f.flame.scale.set(1, 0.75 + Math.sin(t * 23 + k) * 0.25, 1);
      f.mat.emissiveIntensity = burn ? 0.08 + night * 0.85 : 0;
    });
  };
  g.userData.animals = [{ obj: g, cx: 0, cz: 0, r: 0, phase: 0, speed: 0, step }];
  return g;
}

// ======================= Efes: Celsus Kütüphanesi (2x2) =======================
// İki katlı sütunlu cephe: altta dört çift sütun (her çiftin ortasında nişinde bir heykel: Bilgelik, Erdem,
// Düşünce, Bilgi), aralarında üç kapı; üstte üç çift sütun, yanlarda üçgen ortada kavisli alınlık, üst kat
// pencereleri. Önde mermer basamaklar ve meydan, arkada yıkık okuma salonu duvarları; iki yanda Kuretler
// Caddesi'nin kırık sütunları, yerde sütun parçaları, servi ve çam ağaçları.
const EF = {
  ground: pm('#c2bc88', 1),
  marble: pm('#f1ebde', 0.7), // sütunlar
  marble2: pm('#d8c9ac', 0.85), // duvarlar
  marble3: pm('#c6b28e', 0.9), // kaideler, saçak bantları
  dark: pm('#3c322b', 1),
  pave: stoneMat('#ddd2bb'),
  statue: pm('#f6f2ea', 0.6),
};
// Kavisli alınlık: yay biçimli levha (yüzü +z)
function segPediment(w: number, h: number, d: number) {
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, 0);
  sh.quadraticCurveTo(0, h * 2, w / 2, 0);
  sh.lineTo(-w / 2, 0);
  return new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -d / 2);
}
// Elbiseli mermer heykel (ayakta, kolları önde)
function figure(g: THREE.Object3D, x: number, y: number, z: number) {
  add(g, lathe([[0.0075, 0], [0.007, 0.02], [0.0058, 0.038], [0.0052, 0.046], [0.0028, 0.052], [0, 0.053]], 10), EF.statue, x, y, z);
  add(g, new THREE.SphereGeometry(0.0045, 10, 8), EF.statue, x, y + 0.0575, z);
  box(g, 0.008, 0.004, 0.006, EF.statue, x, y + 0.036, z + 0.004);
}
function ephesus() {
  const n = 2, s = small(n);
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, EF.ground, 0, 0, 0);
  // Mermer meydan (önde) ve kütüphanenin içi
  add(st, uvBox(0.98, 0.004, 0.32, 0.08, 0.08), EF.pave, 0, 0.032, 0.33);
  const W = 0.58;
  box(st, W + 0.04, 0.048, 0.42, EF.marble3, 0, 0.03, -0.09);
  const y0 = 0.078;
  // Basamaklar
  for (let i = 0; i < 6; i++) box(st, W + 0.03 - i * 0.004, 0.008 * (i + 1), 0.014, i % 2 ? EF.marble2 : EF.marble, 0, 0.03, 0.187 - i * 0.012);
  // Arka duvar (cephe), kapılar, nişler ve üst kat pencereleri
  box(st, W, 0.31, 0.03, EF.marble2, 0, y0, 0.035);
  for (const [x, w, h] of [[0, 0.055, 0.1], [-0.17, 0.042, 0.085], [0.17, 0.042, 0.085]] as [number, number, number][]) {
    add(st, archGeo(w, h, 0.004), EF.dark, x, y0 + 0.03, 0.051);
    box(st, w + 0.014, 0.008, 0.008, EF.marble3, x, y0 + 0.03 + h + 0.004, 0.054);
  }
  const PAIRS = [-0.255, -0.085, 0.085, 0.255];
  // Alt kat: çıkıntılı kaideler üstünde çift sütunlar, aralarında nişte heykel
  box(st, W, 0.022, 0.045, EF.marble2, 0, y0 + 0.142, 0.072);
  for (const px of PAIRS) {
    box(st, 0.085, 0.03, 0.05, EF.marble3, px, y0, 0.09);
    add(st, archGeo(0.028, 0.07, 0.004), EF.dark, px, y0 + 0.034, 0.051);
    figure(st, px, y0 + 0.03, 0.074);
    for (const sx of [-1, 1]) {
      const x = px + sx * 0.027;
      cyl(st, 0.0082, 0.0094, 0.1, EF.marble, x, y0 + 0.03, 0.097, 14);
      cyl(st, 0.0125, 0.0088, 0.011, EF.marble3, x, y0 + 0.13, 0.097, 12);
    }
    box(st, 0.092, 0.028, 0.056, EF.marble, px, y0 + 0.14, 0.092);
    box(st, 0.096, 0.007, 0.06, EF.marble3, px, y0 + 0.16, 0.092);
  }
  // Üst kat: kapıların üstünde üç çift sütun, alınlıklar
  for (const ux of [-0.17, 0, 0.17]) {
    const half = ux === 0 ? 0.034 : 0.03;
    box(st, half * 2 + 0.03, 0.016, 0.044, EF.marble3, ux, y0 + 0.164, 0.082);
    add(st, archGeo(0.034, 0.062, 0.004), EF.dark, ux, y0 + 0.19, 0.051);
    for (const sx of [-1, 1]) {
      const x = ux + sx * half;
      cyl(st, 0.0072, 0.0082, 0.085, EF.marble, x, y0 + 0.18, 0.088, 14);
      cyl(st, 0.011, 0.0078, 0.0095, EF.marble3, x, y0 + 0.265, 0.088, 12);
    }
    box(st, half * 2 + 0.036, 0.022, 0.05, EF.marble, ux, y0 + 0.274, 0.085);
    box(st, half * 2 + 0.04, 0.006, 0.054, EF.marble3, ux, y0 + 0.288, 0.085);
    if (ux === 0) add(st, segPediment(half * 2 + 0.034, 0.022, 0.044), EF.marble2, ux, y0 + 0.296, 0.085);
    else add(st, gable(0.044, half * 2 + 0.036, 0.034).rotateY(Math.PI / 2), EF.marble2, ux, y0 + 0.296, 0.085);
  }
  // Çatı saçağı
  box(st, W + 0.012, 0.014, 0.04, EF.marble3, 0, y0 + 0.305, 0.04);
  // Arkada yıkık okuma salonu: yan duvarlar ve arka duvar, kırık üst kenarlar
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 8; k++) {
      const h = 0.27 - k * 0.025 - hash(k + sx * 5) * 0.05;
      box(st, 0.024, Math.max(0.03, h), 0.04, EF.marble2, sx * (W / 2 - 0.012), y0, 0.0 - k * 0.04);
    }
  }
  for (let k = 0; k < 12; k++) box(st, W / 12 - 0.002, 0.04 + hash(k + 30) * 0.08, 0.024, EF.marble3, -W / 2 + (k + 0.5) * (W / 12), y0, -0.29);
  for (let k = 0; k < 6; k++) {
    const d = add(st, new THREE.CylinderGeometry(0.009, 0.009, 0.03, 12), EF.marble2, -0.2 + k * 0.08, y0 + 0.009, -0.16 + hash(k + 40) * 0.1);
    d.rotation.set(0, hash(k + 41) * 3, Math.PI / 2);
  }
  // Kuretler Caddesi: iki yanda sıra sütunlar (çoğu kırık)
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 9; k++) {
      const z = -0.42 + k * 0.1;
      const r = hash(k * 3 + sx);
      if (r < 0.15) continue;
      const h = r > 0.6 ? 0.13 : 0.03 + r * 0.12;
      const x = sx * 0.44;
      box(st, 0.026, 0.012, 0.026, EF.marble3, x, 0.03, z);
      cyl(st, 0.0085, 0.0095, h, EF.marble, x, 0.042, z, 12);
      if (r > 0.6) box(st, 0.024, 0.01, 0.024, EF.marble3, x, 0.042 + h, z);
    }
  }
  // Yerdeki parçalar: sütun gövdeleri, başlıklar, bloklar
  for (let k = 0; k < 8; k++) {
    const x = (hash(k + 50) - 0.5) * 0.7, z = 0.22 + hash(k + 51) * 0.2;
    if (Math.abs(x) < 0.33 && z < 0.26) continue;
    if (k % 2) {
      const d = add(st, new THREE.CylinderGeometry(0.009, 0.009, 0.02 + hash(k) * 0.02, 12), EF.marble2, x, 0.045, z);
      d.rotation.set(0, hash(k + 52) * 3, Math.PI / 2);
    } else box(st, 0.024, 0.012, 0.018, EF.marble3, x, 0.034, z).rotation.y = hash(k + 53) * 3;
  }
  // Meydanda basamakların iki yanında kaide üstünde heykeller
  for (const x of [-0.25, 0.25]) {
    box(st, 0.036, 0.04, 0.036, EF.marble3, x, 0.034, 0.27);
    box(st, 0.042, 0.006, 0.042, EF.marble, x, 0.074, 0.27);
    figure(st, x, 0.08, 0.27);
  }
  // Ağaçlar, lambalar, bank
  for (const [x, z] of [[-0.46, -0.46], [0.46, -0.46], [-0.37, -0.42], [0.37, 0.46], [-0.37, 0.46]] as [number, number][]) plant(st, PROPS.treeSmall, x, z, n, 0.55);
  for (const [x, z] of [[0.36, -0.36], [-0.36, -0.2]] as [number, number][]) plant(st, PROPS.treePine, x, z, n, 0.45);
  for (const x of [-0.33, 0.33]) lamp(st, x, 0.36, s, 0.16);
  bench(st, 0.18, 0.44, Math.PI, s);
  bench(st, -0.18, 0.44, Math.PI, s);
  g.add(mergeStatic([st]));
  return g;
}

// ======================= Pamukkale (3x3) =======================
// Bembeyaz traverten basamakları: önden arkaya yükselen beş kademe, her kademenin önü yay yay taşan havuzlar
// (turkuaz su, aralarında beyaz setler). Tepede Hierapolis: yarım daire tiyatro, sütunlu cadde, içinde sütun
// parçaları duran Antik Havuz; servi ve çam ağaçları, ziyaretçi merdiveni.
const PK = {
  trav: pm('#f4f5f0', 0.5),
  trav2: pm('#e8eae3', 0.55),
  water: new THREE.MeshStandardMaterial({ color: '#8ad9e3', roughness: 0.08, metalness: 0.1 }),
  deep: new THREE.MeshStandardMaterial({ color: '#63c6d6', roughness: 0.08, metalness: 0.1 }),
  grass: pm('#94b95e', 1),
  soil: pm('#d9cfb2', 1),
  ruin: pm('#dccaa5', 0.9),
  ruin2: pm('#cbb68e', 0.9),
};
// Bir kademenin ön kenarı: x boyunca yan yana havuzlar, her biri öne doğru yay çizer
function terraceEdge(seed: number) {
  const xs = [-0.47];
  while (xs[xs.length - 1] < 0.47) xs.push(Math.min(0.47, xs[xs.length - 1] + 0.12 + hash(seed + xs.length) * 0.09));
  if (0.47 - xs[xs.length - 2] < 0.06) xs.splice(xs.length - 2, 1);
  return xs;
}
// Kademenin gövdesi: önü yaylı, arkası düz; Shape (x, -z) düzleminde çizilir, yukarı doğru çekilir
function terraceBlock(xs: number[], zf: number, zb: number, bulge: number, h: number) {
  const s = new THREE.Shape();
  s.moveTo(xs[0], -zb);
  s.lineTo(xs[0], -zf);
  for (let j = 0; j < xs.length - 1; j++) s.quadraticCurveTo((xs[j] + xs[j + 1]) / 2, -(zf + bulge * 2), xs[j + 1], -zf);
  s.lineTo(xs[xs.length - 1], -zb);
  s.lineTo(xs[0], -zb);
  return flat(new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 }));
}
// Bir havuzun suyu: önü kademenin yayından rim kadar içeride, arkası bir üst kademenin önünde
function poolWater(x0: number, x1: number, zf: number, zb: number, bulge: number, rim: number) {
  const s = new THREE.Shape();
  const a = x0 + rim, b = x1 - rim;
  // Ön kenar kademenin yayından içeride: uçlarda rim / 2, ortada rim kadar beyaz set kalır
  const front = zf - rim / 2;
  s.moveTo(a, -zb);
  s.lineTo(a, -front);
  s.quadraticCurveTo((a + b) / 2, -(zf + bulge * 2 - rim * 2.5), b, -front);
  s.lineTo(b, -zb);
  s.lineTo(a, -zb);
  return flat(new THREE.ShapeGeometry(s, 6));
}
function pamukkale() {
  const n = 3, s = small(n);
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, PK.grass, 0, 0, 0);
  // Önde, en alttaki kademenin dibinde sığ turkuaz gölet
  box(st, 0.96, 0.003, 0.08, PK.trav2, 0, 0.03, 0.44);
  add(st, flat(new THREE.PlaneGeometry(0.92, 0.05)), PK.deep, 0, 0.0345, 0.445);
  // Beş kademe: her biri bir öncekinden geride ve yüksekte; arkada yayla (Hierapolis) en üst kademenin üstü
  const T = 5, back = -0.49;
  const fronts = [0.4, 0.31, 0.22, 0.13, 0.04];
  // Yukarı çıktıkça kademeler daralır (yamaç gibi): her kademe bir şerit, arkası bir üstteki kademenin altına
  // girer; yanlarda yamacın çimeni görünür. En üstteki kademe arkaya kadar uzanır (yayla).
  const half = (k: number) => 0.47 - k * 0.03;
  const edges = fronts.map((_, k) => terraceEdge(k * 17 + 3).map(x => (x * half(k)) / 0.47));
  for (let k = 0; k < T; k++) {
    const top = 0.03 + (k + 1) * 0.03;
    const zb = k < T - 1 ? fronts[k + 1] - 0.03 : back;
    add(st, terraceBlock(edges[k], fronts[k], zb, 0.016, top - 0.03), k % 2 ? PK.trav2 : PK.trav, 0, 0.03, 0);
    // Kademenin önünden sarkan traverten damlaları (her havuzun yayı boyunca)
    const ex = edges[k];
    for (let j = 0; j < ex.length - 1; j++) {
      for (const u of [0.2, 0.5, 0.8]) {
        const x = ex[j] + (ex[j + 1] - ex[j]) * u;
        const z = fronts[k] + 0.016 * 4 * u * (1 - u) + 0.002;
        const h = 0.02 + hash(k * 31 + j * 3 + u * 10) * 0.009;
        cyl(st, 0.0042, 0.0016, h, PK.trav, x, top - h - 0.001, z, 6);
      }
    }
    // Havuzlar (en üst kademede yalnızca önde; arkası yayla)
    const wb = k < T - 1 ? fronts[k + 1] - 0.004 : fronts[k] - 0.07;
    const xs = edges[k];
    for (let j = 0; j < xs.length - 1; j++) {
      const deep = hash(k * 9 + j) > 0.6;
      add(st, poolWater(xs[j], xs[j + 1], fronts[k], wb, 0.016, 0.008), deep ? PK.deep : PK.water, 0, top + 0.0025, 0);
    }
  }
  const py = 0.03 + T * 0.03; // yaylanın yüksekliği
  // Yayla: toprak ve çimen lekeleri
  box(st, 0.44, 0.003, 0.3, PK.soil, 0.1, py, -0.31);
  box(st, 0.2, 0.003, 0.22, PK.grass, -0.23, py, -0.36);
  // Tiyatro: yarım halka oturma basamakları (sahne öne bakar)
  const tx = 0.17, tz = -0.3;
  for (let k = 0; k < 6; k++) {
    const r0 = 0.05 + k * 0.016, r1 = r0 + 0.017;
    const sh = new THREE.Shape();
    sh.moveTo(r1, 0);
    sh.absarc(0, 0, r1, 0, Math.PI, false);
    sh.lineTo(-r0, 0);
    sh.absarc(0, 0, r0, Math.PI, 0, true);
    add(st, flat(new THREE.ExtrudeGeometry(sh, { depth: 0.006 * (k + 1), bevelEnabled: false, curveSegments: 12 })), k % 2 ? PK.ruin : PK.ruin2, tx, py + 0.003, tz);
  }
  box(st, 0.26, 0.012, 0.03, PK.ruin2, tx, py + 0.003, tz + 0.035);
  for (let k = 0; k < 6; k++) cyl(st, 0.0045, 0.005, 0.03 + hash(k + 70) * 0.03, PK.ruin, tx - 0.11 + k * 0.044, py + 0.015, tz + 0.045, 8);
  // Sütunlu cadde (bir kısmı kırık)
  for (let k = 0; k < 9; k++) {
    const r = hash(k + 80), x = -0.3 + k * 0.045;
    if (r < 0.15) continue;
    cyl(st, 0.0055, 0.0062, r > 0.55 ? 0.07 : 0.02 + r * 0.06, PK.ruin, x, py + 0.003, -0.2, 8);
  }
  // Antik Havuz: içinde devrik sütun parçaları duran turkuaz havuz
  frame(st, 0.14, 0.1, 0.012, 0.01, PK.ruin2, -0.23, py + 0.003, -0.35);
  add(st, flat(new THREE.PlaneGeometry(0.12, 0.08)), PK.deep, -0.23, py + 0.011, -0.35);
  for (let k = 0; k < 3; k++) {
    const d = add(st, new THREE.CylinderGeometry(0.006, 0.006, 0.04, 8), PK.ruin, -0.265 + k * 0.035, py + 0.012, -0.355 + (k % 2) * 0.02);
    d.rotation.set(0, k * 1.1, Math.PI / 2);
  }
  // Ziyaretçi merdiveni: sol yamaçta, her kademenin yanından yukarı çıkar
  for (let i = 0; i < 12; i++) {
    const z = 0.42 - i * 0.04;
    const k = Math.max(0, fronts.filter(f => f >= z).length - 1);
    box(st, 0.03, 0.013 * (i + 1), 0.04, PK.ruin2, -(half(k) + 0.018), 0.03, z);
  }
  // Yamacın iki yanı çimenli: ağaçlar
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.42], [0.45, -0.2], [0.46, 0.05], [-0.46, -0.25]] as [number, number][]) plant(st, PROPS.treeSmall, x, z, n, 0.5);
  for (const [x, z] of [[0.46, 0.2], [-0.45, -0.05]] as [number, number][]) plant(st, PROPS.treeLarge, x, z, n, 0.4);
  // Ağaçlar, lambalar, bank
  for (const [x, z] of [[-0.31, -0.46], [-0.08, -0.46], [0.32, -0.12], [-0.06, -0.3], [-0.33, -0.12]] as [number, number][]) {
    const t = makeTreeAt(PROPS.treeSmall, x, z, n, 0.5);
    t.position.y = py - 0.03;
    st.add(t);
  }
  for (const [x, z] of [[0.33, -0.22], [0.33, -0.44]] as [number, number][]) {
    const t = makeTreeAt(PROPS.treePine, x, z, n, 0.45);
    t.position.y = py - 0.03;
    st.add(t);
  }
  const l = item(st, 0.05, -0.22, 0, 1, py - 0.03);
  lamp(l, 0, 0, s, 0.14);
  g.add(mergeStatic([st]));
  return g;
}
// Ağacı yerden yüksekteki bir yüzeye dikmek için (tree() y = 0.03'e diker)
function makeTreeAt(path: string, x: number, z: number, n: number, size: number) {
  const holder = new THREE.Group();
  plant(holder, path, x, z, n, size);
  return holder;
}

// ======================= Truva Atı (2x2) =======================
// Çanakkale'deki tahta at: kalaslardan çakılmış gövde, yan pencereler, uzun boyun ve baş, yele ve kuyruk;
// tahta platform ve arka bacakların arasından karnına çıkan merdiven. Arkada Truva'nın eğimli taş surları ve
// yıkık kulesi, önde taş döşeli meydan, zeytin ve servi ağaçları.
const PLANKS = canvasTex(64, 128, g => {
  for (let y = 0, k = 0; y < 128; y += 16, k++) {
    g.fillStyle = ['#a8743f', '#9a6936', '#b07c45', '#946232'][k % 4];
    g.fillRect(0, y, 64, 16);
    g.fillStyle = 'rgba(60, 35, 15, 0.55)';
    g.fillRect(0, y, 64, 1.5);
    g.fillStyle = 'rgba(255, 220, 170, 0.12)';
    for (let x = 0; x < 64; x += 7) g.fillRect(x + (k % 2) * 3, y + 4 + (x % 3), 4, 1);
    g.fillStyle = 'rgba(40, 25, 10, 0.6)';
    g.fillRect(((k * 23) % 50) + 4, y + 6, 2, 2);
    g.fillRect(((k * 23) % 50) + 4, y + 10, 1, 4);
  }
});
const TR = {
  wood: new THREE.MeshStandardMaterial({ map: PLANKS, roughness: 0.85 }),
  dark: pm('#5b3a1e', 0.9),
  hole: pm('#2b1d12', 1),
  wall: stoneMat('#c8b48e'),
  wall2: pm('#b59f78', 0.95),
  ground: pm('#a9b46c', 1),
  plaza: pm('#d6c9a6', 1),
};
// Kalaslı kutu: dokusu gerçek ölçüye göre (bir kalas 0.02 yerel birim)
const plank = (w: number, h: number, d: number) => uvBox(w, h, d, 0.08, 0.16);
function troy() {
  const n = 2, s = small(n);
  const g = new THREE.Group();
  const st = new THREE.Group();
  box(st, 0.98, 0.03, 0.98, TR.ground, 0, 0, 0);
  box(st, 0.72, 0.003, 0.44, TR.plaza, 0.02, 0.03, 0.16);
  // Surlar: arkada yay çizen eğimli taş duvar, bir yerinde yıkık kule
  for (let k = 0; k < 9; k++) {
    const a = -1.1 + k * 0.275;
    const x = Math.sin(a) * 0.5, z = -0.53 + Math.cos(a) * 0.13;
    const h = k === 6 ? 0.06 : 0.11 + hash(k + 3) * 0.03;
    const w = add(st, frustum(0.13, 0.06, h, 0.12, 0.035), TR.wall2, x, 0.03 + h / 2, z);
    w.rotation.y = Math.atan2(0.13 * Math.sin(a), 0.5 * Math.cos(a));
  }
  const tw = add(st, uvBox(0.12, 0.17, 0.1, 0.08, 0.08), TR.wall, -0.3, 0.03 + 0.085, -0.4);
  tw.rotation.y = 0.35;
  for (let k = 0; k < 6; k++) rock(st, -0.15 + hash(k + 40) * 0.5, 0.04, -0.3 + hash(k + 41) * 0.08, 0.012 + hash(k) * 0.01, 1.3, 0.7, 1, PT.rock);
  // Atın platformu
  const ax = 0.0, az = 0.08;
  add(st, plank(0.44, 0.03, 0.2), TR.wood, ax, 0.045, az);
  const y0 = 0.06;
  // Bacaklar (hafif açık), toynaklar
  for (const [lx, lz] of [[-0.12, -0.045], [-0.12, 0.045], [0.11, -0.045], [0.11, 0.045]]) {
    add(st, plank(0.036, 0.14, 0.036), TR.wood, ax + lx, y0 + 0.07, az + lz);
    box(st, 0.042, 0.012, 0.042, TR.dark, ax + lx, y0, az + lz);
  }
  // Gövde: kalaslı kutu, göğüs ve sağrı biraz daha geniş
  const by = y0 + 0.14;
  add(st, plank(0.32, 0.12, 0.13), TR.wood, ax, by + 0.06, az);
  add(st, plank(0.06, 0.13, 0.14), TR.wood, ax - 0.135, by + 0.065, az);
  add(st, plank(0.06, 0.13, 0.14), TR.wood, ax + 0.135, by + 0.065, az);
  box(st, 0.33, 0.008, 0.135, TR.dark, ax, by + 0.12, az);
  // Yan pencereler (iki yanda üçer)
  for (const sz of [-1, 1]) for (let k = 0; k < 3; k++) box(st, 0.03, 0.03, 0.004, TR.hole, ax - 0.07 + k * 0.07, by + 0.04, az + sz * 0.0665);
  // Boyun (öne eğik), baş, kulaklar, gözler, yele
  const neck = add(st, plank(0.075, 0.22, 0.085), TR.wood, ax + 0.18, by + 0.17, az);
  neck.rotation.z = -0.5;
  const head = add(st, plank(0.16, 0.065, 0.07), TR.wood, ax + 0.27, by + 0.27, az);
  head.rotation.z = -0.35;
  box(st, 0.05, 0.03, 0.06, TR.dark, ax + 0.34, by + 0.225, az).rotation.z = -0.35;
  for (const sz of [-1, 1]) {
    const ear = add(st, new THREE.ConeGeometry(0.012, 0.04, 4), TR.wood, ax + 0.215, by + 0.32, az + sz * 0.022);
    ear.rotation.z = -0.3;
    add(st, new THREE.SphereGeometry(0.007, 8, 6), TR.hole, ax + 0.275, by + 0.29, az + sz * 0.036);
  }
  const mane = box(st, 0.02, 0.22, 0.02, TR.dark, ax + 0.155, by + 0.08, az);
  mane.rotation.z = -0.5;
  mane.position.set(ax + 0.138, by + 0.193, az);
  // Kuyruk
  const tail = box(st, 0.02, 0.12, 0.016, TR.dark, ax - 0.18, by - 0.04, az);
  tail.rotation.z = -0.35;
  // Arka bacakların arasından karna çıkan merdiven
  for (const sz of [-1, 1]) rod(st, [ax - 0.06, y0 + 0.01, az + sz * 0.018], [ax - 0.03, by, az + sz * 0.018], 0.003, TR.dark, 4);
  for (let k = 1; k < 7; k++) {
    const t = k / 7;
    rod(st, [ax - 0.06 + t * 0.03, y0 + 0.01 + t * (by - y0 - 0.01), az - 0.018], [ax - 0.06 + t * 0.03, y0 + 0.01 + t * (by - y0 - 0.01), az + 0.018], 0.0025, TR.dark, 4);
  }
  // Meydanda sütun parçaları, ağaçlar, lambalar, banklar
  for (let k = 0; k < 5; k++) {
    const d = add(st, new THREE.CylinderGeometry(0.01, 0.01, 0.03, 10), TR.wall2, -0.38 + hash(k + 60) * 0.2, 0.04, 0.3 + hash(k + 61) * 0.12);
    d.rotation.set(0, hash(k + 62) * 3, Math.PI / 2);
  }
  for (const [x, z] of [[0.42, -0.2], [0.44, 0.42], [-0.44, 0.1]] as [number, number][]) plant(st, PROPS.treeLarge, x, z, n, 0.42);
  for (const [x, z] of [[-0.44, -0.12], [0.44, 0.1], [-0.44, 0.44]] as [number, number][]) plant(st, PROPS.treeSmall, x, z, n, 0.5);
  for (const x of [-0.3, 0.3]) lamp(st, x, 0.38, s, 0.16);
  bench(st, 0.18, 0.43, Math.PI, s);
  bench(st, -0.12, 0.43, Math.PI, s);
  g.add(mergeStatic([st]));
  return g;
}

// Simge yapılar arasına kaydet (landmarks.ts makeDecor önce buraya bakar)
const WONDERS: Partial<Record<DecorKind, () => THREE.Object3D>> = {
  liberty, maiden, hagia, taj, bigben: bigBen, parthenon, chichen, opera, stonehenge, cappadocia, ephesus, pamukkale, troy,
};
Object.assign(EXTRA_DECOR, WONDERS);
export const WONDER_KINDS = Object.keys(WONDERS) as DecorKind[];
