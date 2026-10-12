import * as THREE from 'three';
import { part, mat } from './utilities';
import { mergeStatic } from './batcher';

// Tarihi yapılar ve yeni stadyum: gerçeğe benzesinler diye kafes, kemer ve koltuk dokuları kodla çizilir.
// Yerel ölçü: taban 1x1 kare (büyük yapılar sonra 2x2 / 3x3 büyütülür), y = 0 zemin, ön yüz +z.

// --- Dokular ---
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
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

// Eyfel'in demir kafesi: çapraz çubuklar, arası boş
const LATTICE = canvasTexture(64, 64, g => {
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#fff';
  g.lineWidth = 5;
  g.strokeRect(2, 2, 60, 60);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.stroke();
});
const ironMat = new THREE.MeshStandardMaterial({ color: '#8a6748', map: LATTICE, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, metalness: 0.3 });

// Kolezyum duvarı: üç kat kemer, kemerlerin içi boş
const ARCHES = canvasTexture(128, 128, g => {
  g.fillStyle = '#e7d7b4';
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'destination-out';
  // Her katta iki kemer: yarım daire tepeli açıklıklar, aralarında kalın ayaklar
  for (let row = 0; row < 3; row++) {
    const top = 6 + row * 41;
    for (const cx of [32, 96]) {
      g.beginPath();
      g.moveTo(cx - 14, top + 36);
      g.lineTo(cx - 14, top + 18);
      g.arc(cx, top + 18, 14, Math.PI, 0);
      g.lineTo(cx + 14, top + 36);
      g.closePath();
      g.fill();
    }
  }
  g.globalCompositeOperation = 'source-over';
  // Katlar arasında saçak
  g.fillStyle = '#d4c19a';
  for (const y of [0, 43, 83, 123]) g.fillRect(0, y, 128, 5);
});
const archMat = new THREE.MeshStandardMaterial({ map: ARCHES, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });

// Doku koordinatlarını gerçek ölçüye göre büyüt (u: çevre, v: boy, cell: bir doku tekrarının boyu)
function scaleUV(geo: THREE.BufferGeometry, u: number, v: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  return geo;
}

// İki nokta arasında kare kesitli, incelen kafes ayak
function strut(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, cell: number) {
  const len = a.distanceTo(b);
  const geo = scaleUV(new THREE.CylinderGeometry(rb, ra, len, 4, 1, true), (ra + rb) * 2.8 / cell, len / cell);
  const m = new THREE.Mesh(geo, ironMat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.rotateY(Math.PI / 4);
  m.castShadow = true;
  return m;
}

// --- Eyfel Kulesi (2x2) ---
function eiffel() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#cbbf9f'), 0, 0.01, 0));
  for (const [x, z] of [[-0.3, 0.44], [0.3, 0.44]] as [number, number][]) st.add(part(new THREE.BoxGeometry(0.3, 0.022, 0.08), mat('#7cc35f'), x, 0.012, z));
  const bronze = mat('#7a5a3e');
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Dört ayak: köşelerden birinci kata, oradan ikinci kata
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    st.add(strut(V(sx * 0.37, 0, sz * 0.37), V(sx * 0.21, 0.32, sz * 0.21), 0.07, 0.045, 0.05));
    st.add(strut(V(sx * 0.21, 0.34, sz * 0.21), V(sx * 0.1, 0.66, sz * 0.1), 0.042, 0.028, 0.04));
    st.add(part(new THREE.BoxGeometry(0.09, 0.02, 0.09), bronze, sx * 0.37, 0.01, sz * 0.37));
  }
  // Ayakların arasındaki kemerler
  for (let k = 0; k < 4; k++) {
    const arch = part(new THREE.TorusGeometry(0.26, 0.012, 6, 24, Math.PI), bronze, 0, 0.06, 0);
    arch.rotation.y = (k * Math.PI) / 2;
    arch.translateZ(0.3);
    arch.scale.set(1, 0.95, 1);
    st.add(arch);
  }
  // Birinci ve ikinci kat
  st.add(part(new THREE.BoxGeometry(0.5, 0.035, 0.5), bronze, 0, 0.33, 0));
  st.add(part(new THREE.BoxGeometry(0.52, 0.025, 0.52), mat('#5c432e'), 0, 0.36, 0));
  st.add(part(new THREE.BoxGeometry(0.25, 0.03, 0.25), bronze, 0, 0.67, 0));
  // Üst gövde: incelerek yükselen kafes kule
  st.add(strut(V(0, 0.68, 0), V(0, 1.5, 0), 0.105, 0.03, 0.045));
  st.add(part(new THREE.BoxGeometry(0.075, 0.05, 0.075), bronze, 0, 1.52, 0));
  st.add(part(new THREE.CylinderGeometry(0.008, 0.012, 0.14, 6), bronze, 0, 1.61, 0));
  g.add(mergeStatic([st]));
  const lamp = new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffd27a', emissiveIntensity: 0 });
  lamp.name = 'lamp';
  g.add(part(new THREE.SphereGeometry(0.018, 8, 6), lamp, 0, 1.69, 0));
  g.scale.y = 1.25; // daha uzun (en yüksek simge)
  return g;
}

// --- Özgürlük Anıtı (2x2): yıldız biçimli kale, kaide ve bakır yeşili heykel ---
function liberty() {
  const g = new THREE.Group();
  const copper = mat('#6fb59a');
  const granite = mat('#bdb5a6');
  const stone = mat('#d4ccbc');
  g.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#7cc35f'), 0, 0.01, 0));
  // Yıldız kale
  const star = new THREE.Shape();
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const r = k % 2 ? 0.3 : 0.44;
    const p = [Math.sin(a) * r, Math.cos(a) * r];
    if (k) star.lineTo(p[0], p[1]);
    else star.moveTo(p[0], p[1]);
  }
  g.add(part(new THREE.ExtrudeGeometry(star, { depth: 0.08, bevelEnabled: false }).rotateX(-Math.PI / 2), granite, 0, 0.02, 0));
// Gerçek oranına yakın boy: yapı 2 kat büyütülür (zemin aynı kalır)
  const s = new THREE.Group();
  s.scale.setScalar(2);
  s.position.y = -0.1;
  g.add(s);
    // Kaide
  s.add(part(new THREE.BoxGeometry(0.3, 0.06, 0.3), stone, 0, 0.13, 0));
  s.add(part(new THREE.CylinderGeometry(0.105, 0.14, 0.28, 4).rotateY(Math.PI / 4), stone, 0, 0.3, 0));
  s.add(part(new THREE.BoxGeometry(0.18, 0.04, 0.18), stone, 0, 0.46, 0));
  for (let k = 0; k < 4; k++) {
    const w = part(new THREE.BoxGeometry(0.03, 0.06, 0.005), mat('#9c9484'), 0, 0.33, 0);
    w.rotation.y = (k * Math.PI) / 2;
    w.translateZ(0.11);
    s.add(w);
  }
  // Heykel: uzun elbise, baş, taç, meşale tutan kol, tablet
  const robe = new THREE.LatheGeometry(
    [[0.07, 0], [0.065, 0.05], [0.055, 0.15], [0.05, 0.24], [0.042, 0.29], [0.02, 0.31], [0, 0.315]].map(([x, y]) => new THREE.Vector2(x, y)),
    12,
  );
  s.add(part(robe, copper, 0, 0.48, 0));
  s.add(part(new THREE.SphereGeometry(0.03, 10, 8), copper, 0, 0.82, 0.005));
  for (let k = 0; k < 7; k++) {
    const ray = part(new THREE.ConeGeometry(0.006, 0.05, 4), copper, 0, 0.845, 0);
    ray.rotation.set(-0.5 + (k / 6) * 1.0 - 0.0, 0, 0);
    ray.rotation.z = -0.9 + (k / 6) * 1.8;
    ray.translateY(0.03);
    s.add(ray);
  }
  const arm = part(new THREE.CylinderGeometry(0.012, 0.015, 0.17, 6), copper, 0.04, 0.84, 0);
  arm.rotation.z = -0.25;
  s.add(arm);
  s.add(part(new THREE.CylinderGeometry(0.012, 0.008, 0.04, 6), mat('#c9a14a'), 0.062, 0.93, 0));
  const flame = new THREE.MeshStandardMaterial({ color: '#ffcf4a', emissive: '#ffb300', emissiveIntensity: 0.4 });
  flame.name = 'lamp';
  s.add(part(new THREE.ConeGeometry(0.016, 0.045, 8), flame, 0.064, 0.97, 0));
  const tablet = part(new THREE.BoxGeometry(0.05, 0.07, 0.014), copper, -0.05, 0.69, 0.035);
  tablet.rotation.z = 0.3;
  s.add(tablet);
  return g;
}

// --- Pisa Kulesi (1x1): altı katlı sütunlu galeriler, eğik duruşu ---
function pisa() {
  const g = new THREE.Group();
  g.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#7cc35f'), 0, 0.01, 0));
  const tower = new THREE.Group();
  const marble = mat('#f3eee2');
  const shade = mat('#d9d2c2');
  tower.add(part(new THREE.CylinderGeometry(0.16, 0.17, 0.16, 20), marble, 0, 0.08, 0));
  for (let s = 0; s < 6; s++) {
    const y = 0.16 + s * 0.13;
    tower.add(part(new THREE.CylinderGeometry(0.13, 0.13, 0.13, 20), shade, 0, y + 0.065, 0));
    tower.add(part(new THREE.CylinderGeometry(0.168, 0.168, 0.016, 20), marble, 0, y + 0.122, 0));
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      tower.add(part(new THREE.CylinderGeometry(0.007, 0.007, 0.11, 5), marble, Math.sin(a) * 0.155, y + 0.06, Math.cos(a) * 0.155));
    }
  }
  // Çan kulesi
  const top = 0.16 + 6 * 0.13;
  tower.add(part(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 18), marble, 0, top + 0.05, 0));
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    tower.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.09, 5), marble, Math.sin(a) * 0.11, top + 0.05, Math.cos(a) * 0.11));
  }
  tower.add(part(new THREE.CylinderGeometry(0.12, 0.12, 0.015, 18), marble, 0, top + 0.105, 0));
  tower.scale.setScalar(2.3); // gerçek oranına yakın boy
  tower.rotation.z = 0.075; // meşhur eğiklik
  g.add(mergeStatic([tower]));
  return g;
}

// --- Galata Kulesi (1x1): taş gövde, seyir balkonu, sivri külah ---
function galata() {
  const g = new THREE.Group();
  const stone = mat('#cdbb9c');
  const dark = mat('#4b5563');
  const roof = mat('#55606e');
  g.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#cfc6b3'), 0, 0.01, 0));
  // Gerçek oranına yakın boy: yapı 2.2 kat büyütülür (zemin aynı kalır)
  const t = new THREE.Group();
  t.scale.setScalar(2.2);
  t.position.y = -0.024;
  g.add(t);
  t.add(part(new THREE.CylinderGeometry(0.2, 0.22, 0.08, 20), stone, 0, 0.06, 0));
  t.add(part(new THREE.CylinderGeometry(0.17, 0.19, 0.72, 20), stone, 0, 0.46, 0));
  // Pencere sıraları
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + row * 0.5;
      const w = part(new THREE.BoxGeometry(0.025, 0.045, 0.01), dark, Math.sin(a) * 0.182, 0.22 + row * 0.15, Math.cos(a) * 0.182);
      w.rotation.y = a;
      t.add(w);
    }
  }
  // Balkon: dışa taşan halka, korkuluk ve kemerli pencereler
  t.add(part(new THREE.CylinderGeometry(0.22, 0.2, 0.03, 20), stone, 0, 0.84, 0));
  t.add(part(new THREE.CylinderGeometry(0.215, 0.215, 0.03, 20, 1, true), dark, 0, 0.87, 0));
  t.add(part(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 20), mat('#e0d3b8'), 0, 0.91, 0));
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const w = part(new THREE.BoxGeometry(0.03, 0.07, 0.01), dark, Math.sin(a) * 0.162, 0.91, Math.cos(a) * 0.162);
    w.rotation.y = a;
    t.add(w);
  }
  t.add(part(new THREE.ConeGeometry(0.175, 0.36, 20), roof, 0, 1.15, 0));
  t.add(part(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 5), mat('#e0b84c'), 0, 1.36, 0));
  return mergeStatic([g]);
}

// --- Kolezyum (3x3): kemerli eliptik duvar (bir yanı yıkık), içeride basamaklı oturma ve kum arena ---
function colosseum() {
  const g = new THREE.Group();
  const travertine = mat('#e3d2ad');
  g.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#d6cdb6'), 0, 0.01, 0));
  const rx = 0.44, rz = 0.36, H = 0.42;
  // Dış duvar: elips, güneydoğusu yıkık (daha alçak)
  const wall = new THREE.CylinderGeometry(1, 1, 1, 64, 4, true);
  const p = wall.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), z = p.getZ(k);
    let y = p.getY(k) + 0.5;
    const a = Math.atan2(x, z);
    const ruin = Math.max(0, Math.cos(a - 2.3)) ** 3;
    y *= 1 - ruin * 0.35 * (0.6 + 0.4 * Math.sin(a * 23));
    p.setXYZ(k, x * rx, y * H + 0.02, z * rz);
  }
  wall.computeVertexNormals();
  scaleUV(wall, 14, 1);
  const outer = new THREE.Mesh(wall, archMat);
  outer.castShadow = true;
  g.add(outer);
  // İç duvar (biraz içeride, daha alçak) ve basamaklı oturma yeri
  const inner = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), 11, 0.7), archMat);
  inner.scale.set(rx - 0.05, H * 0.7, rz - 0.05);
  inner.position.y = 0.02 + (H * 0.7) / 2;
  g.add(inner);
  const st = new THREE.Group();
  for (let k = 0; k < 5; k++) {
    const t = k / 5;
    const ring = new THREE.Shape();
    ring.absellipse(0, 0, rx - 0.05 - t * 0.12, rz - 0.05 - t * 0.12, 0, Math.PI * 2, false, 0);
    const hole = new THREE.Path();
    hole.absellipse(0, 0, rx - 0.05 - (t + 0.2) * 0.12, rz - 0.05 - (t + 0.2) * 0.12, 0, Math.PI * 2, true, 0);
    ring.holes.push(hole);
    st.add(part(new THREE.ExtrudeGeometry(ring, { depth: 0.02, bevelEnabled: false, curveSegments: 40 }).rotateX(-Math.PI / 2), k % 2 ? travertine : mat('#d7c49c'), 0, 0.3 - k * 0.05, 0));
  }
  // Arena: kum zemin ve altındaki odaların izleri
  const arena = new THREE.Shape();
  arena.absellipse(0, 0, rx - 0.17, rz - 0.17, 0, Math.PI * 2, false, 0);
  st.add(part(new THREE.ExtrudeGeometry(arena, { depth: 0.01, bevelEnabled: false, curveSegments: 40 }).rotateX(-Math.PI / 2), mat('#d8b77a'), 0, 0.03, 0));
  for (let k = -3; k <= 3; k++) st.add(part(new THREE.BoxGeometry(0.004, 0.003, 0.3), mat('#a58552'), k * 0.04, 0.042, 0));
  g.add(mergeStatic([st]));
  return g;
}

// --- Piramit (3x3): basamaklı kumtaşı ---
function pyramid() {
  const g = new THREE.Group();
  g.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#e9d29a'), 0, 0.01, 0));
  const steps = 14;
  const colors = ['#d9b36c', '#cfa862'];
  for (let k = 0; k < steps; k++) {
    const w = 0.86 * (1 - k / steps);
    g.add(part(new THREE.BoxGeometry(w, 0.06, w), mat(colors[k % 2]), 0, 0.02 + k * 0.06 + 0.03, 0));
  }
  g.add(part(new THREE.ConeGeometry(0.05, 0.07, 4).rotateY(Math.PI / 4), mat('#e8c46a'), 0, 0.02 + steps * 0.06 + 0.035, 0));
  // Giriş ve palmiye benzeri küçük ağaçlar yerine taş dikilitaş
  g.add(part(new THREE.BoxGeometry(0.08, 0.06, 0.02), mat('#5c4a33'), 0, 0.06, 0.43));
  for (const x of [-0.42, 0.42]) {
    g.add(part(new THREE.CylinderGeometry(0.012, 0.022, 0.28, 4).rotateY(Math.PI / 4), mat('#d4b26f'), x, 0.16, 0.42));
    g.add(part(new THREE.ConeGeometry(0.016, 0.03, 4).rotateY(Math.PI / 4), mat('#e0b84c'), x, 0.315, 0.42));
  }
  return mergeStatic([g]);
}

// --- Stadyum (3x3): basamaklı tribünler, şeffaf çatı, çizgili çim saha, ışık direkleri, skorbord ---
function stadium() {
  const g = new THREE.Group();
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#c9ced4'), 0, 0.01, 0));
  const RX = 0.45, RZ = 0.4; // dış elips
  const IX = 0.27, IZ = 0.2; // saha kenarı
  // Tribünler: içeriden dışarı yükselen basamaklar; sıralar takım renklerinde
  const rows = 9, seg = 64;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  const seats = ['#d32f2f', '#c62828', '#fafafa', '#1565c0', '#0d47a1'];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const ex = THREE.MathUtils.lerp(IX, RX - 0.02, t), ez = THREE.MathUtils.lerp(IZ, RZ - 0.02, t);
    const y = 0.04 + t * 0.2;
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * ex, y, Math.sin(a) * ez);
      // Üst tribün mavi, alt kırmızı; merdivenler gri
      const aisle = s % 8 === 0;
      c.set(aisle ? '#9ea7b0' : r < 2 ? '#e0e0e0' : seats[r < 5 ? (r % 2) : 3 + (r % 2)]);
      c.toArray(col, col.length);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s, b = a + seg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const bowl = new THREE.BufferGeometry();
  bowl.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bowl.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  bowl.setIndex(idx);
  bowl.computeVertexNormals();
  const seatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  const bowlMesh = new THREE.Mesh(bowl, seatMat);
  bowlMesh.castShadow = bowlMesh.receiveShadow = true;
  st.add(bowlMesh);
  // Dış cephe: beyaz kaburgalı duvar
  const facade = new THREE.CylinderGeometry(1, 1, 0.24, seg, 1, true).translate(0, 0.14, 0);
  facade.scale(RX, 1, RZ);
  st.add(part(facade, mat('#eceff1'), 0, 0, 0));
  for (let s = 0; s < 32; s++) {
    const a = (s / 32) * Math.PI * 2;
    const rib = part(new THREE.BoxGeometry(0.012, 0.26, 0.02), mat('#b0bec5'), Math.cos(a) * (RX + 0.006), 0.14, Math.sin(a) * (RZ + 0.006));
    rib.rotation.y = -a;
    st.add(rib);
  }
  // Saha: çizgili çim ve beyaz çizgiler, kaleler
  const pitch = part(new THREE.BoxGeometry(0.4, 0.01, 0.27), mat('#3f9b3f'), 0, 0.045, 0);
  st.add(pitch);
  for (let k = 0; k < 8; k++) if (k % 2) st.add(part(new THREE.BoxGeometry(0.05, 0.002, 0.27), mat('#4fb34b'), -0.175 + k * 0.05, 0.051, 0));
  const white = mat('#ffffff');
  const line = (w: number, d: number, x: number, z: number) => st.add(part(new THREE.BoxGeometry(w, 0.002, d), white, x, 0.053, z));
  line(0.36, 0.004, 0, 0.115);
  line(0.36, 0.004, 0, -0.115);
  line(0.004, 0.23, 0.18, 0);
  line(0.004, 0.23, -0.18, 0);
  line(0.004, 0.23, 0, 0);
  for (const s of [-1, 1]) {
    line(0.05, 0.004, s * 0.155, 0.055);
    line(0.05, 0.004, s * 0.155, -0.055);
    line(0.004, 0.11, s * 0.13, 0);
    st.add(part(new THREE.BoxGeometry(0.006, 0.02, 0.05), white, s * 0.184, 0.062, 0));
  }
  st.add(part(new THREE.TorusGeometry(0.035, 0.002, 4, 24).rotateX(Math.PI / 2), white, 0, 0.053, 0));
  // Çatı: tribünlerin üstünde yarı saydam halka
  const roofShape = new THREE.Shape();
  roofShape.absellipse(0, 0, RX + 0.01, RZ + 0.01, 0, Math.PI * 2, false, 0);
  const roofHole = new THREE.Path();
  roofHole.absellipse(0, 0, RX - 0.11, RZ - 0.11, 0, Math.PI * 2, true, 0);
  roofShape.holes.push(roofHole);
  const roofMat = new THREE.MeshStandardMaterial({ color: '#f5f7fa', transparent: true, opacity: 0.55, roughness: 0.4, side: THREE.DoubleSide, depthWrite: false });
  g.add(part(new THREE.ExtrudeGeometry(roofShape, { depth: 0.008, bevelEnabled: false, curveSegments: 48 }).rotateX(-Math.PI / 2), roofMat, 0, 0.3, 0));
  st.add(part(new THREE.TorusGeometry(1, 0.006, 4, 64).rotateX(Math.PI / 2).scale(RX - 0.11, 1, RZ - 0.11), mat('#90a4ae'), 0, 0.3, 0));
  // Skorbord
  st.add(part(new THREE.BoxGeometry(0.14, 0.06, 0.012), mat('#263238'), 0, 0.33, -RZ + 0.03));
  // Işık direkleri (gece yanar)
  const light = new THREE.MeshStandardMaterial({ color: '#fffbe6', emissive: '#fff4c2', emissiveIntensity: 0 });
  light.name = 'lamp';
  for (const [x, z] of [[-0.46, -0.44], [0.46, -0.44], [-0.46, 0.44], [0.46, 0.44]] as [number, number][]) {
    st.add(part(new THREE.CylinderGeometry(0.006, 0.01, 0.46, 6), mat('#78909c'), x, 0.23, z));
    const bank = part(new THREE.BoxGeometry(0.07, 0.04, 0.012), light, x * 0.95, 0.46, z * 0.95);
    bank.lookAt(0, 0.2, 0);
    st.add(bank);
  }
  g.add(mergeStatic([st]));
  return g;
}

export type HistoricKind = 'eiffel' | 'liberty' | 'pisa' | 'colosseum' | 'galata' | 'pyramid';
export const HISTORIC: Record<HistoricKind | 'stadium', () => THREE.Object3D> = {
  eiffel, liberty, pisa, colosseum, galata, pyramid, stadium,
};
