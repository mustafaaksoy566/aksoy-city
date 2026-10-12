import * as THREE from 'three';
import { part, mat } from './utilities';
import { mergeStatic } from './batcher';

// Örneklerden esinlenen yeni yapılar: göl, büyük göl, tepe (manzara); plaj voleybolu (sahil);
// kumarhane kulesi ve gözlemevi (eğlence). Yerel ölçü 1x1 kare (büyükler sonra büyütülür), ön yüz +z.

const water = new THREE.MeshStandardMaterial({ color: '#3fa7dc', roughness: 0.08, metalness: 0.25 });
const neon = (color: string) => {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0 });
  m.name = 'lamp'; // gece yanar
  return m;
};

// Dalgalı kenarlı düz şekil (göl, ada)
function blobShape(r: number, seed: number, wobble = 0.12) {
  const s = new THREE.Shape();
  const n = 40;
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r * (1 + Math.sin(a * 3 + seed) * wobble + Math.sin(a * 5 + seed * 2) * wobble * 0.5);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr * 0.85;
    if (k === 0) s.moveTo(x, z);
    else s.lineTo(x, z);
  }
  return s;
}
const flat = (shape: THREE.Shape, m: THREE.Material, y: number, depth = 0.01) => {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 }).rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.y = y + depth;
  mesh.receiveShadow = true;
  return mesh;
};
function tree(x: number, z: number, s: number, color = '#4f9f3f') {
  const g = new THREE.Group();
  g.add(part(new THREE.CylinderGeometry(0.012 * s, 0.016 * s, 0.1 * s, 6), mat('#6b4a33'), x, 0.05 * s + 0.02, z));
  g.add(part(new THREE.IcosahedronGeometry(0.07 * s, 1), mat(color), x, 0.14 * s + 0.02, z));
  g.add(part(new THREE.IcosahedronGeometry(0.05 * s, 1), mat('#6cbb4b'), x + 0.03 * s, 0.19 * s + 0.02, z - 0.01 * s));
  return g;
}

// --- Göl: kumlu kıyı, sazlar, nilüferler, iskele, ördekler ---
export function lake(big: boolean) {
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#6cbd55'), 0, 0.01, 0));
  st.add(flat(blobShape(0.43, big ? 2 : 1), mat('#e6d39a'), 0.02));
  st.add(flat(blobShape(0.38, big ? 2 : 1), water, 0.024));
  if (big) {
    // Ortada ağaçlı küçük ada
    st.add(flat(blobShape(0.09, 5, 0.2), mat('#e6d39a'), 0.025, 0.012));
    st.add(flat(blobShape(0.07, 5, 0.2), mat('#6cbd55'), 0.03, 0.012));
    st.add(tree(0.0, 0.0, 0.6));
  }
  // Sazlar ve nilüferler
  for (let k = 0; k < 14; k++) {
    const a = k * 0.45 + 0.3;
    const r = 0.36 + (k % 3) * 0.01;
    st.add(part(new THREE.CylinderGeometry(0.003, 0.004, 0.06, 4), mat('#5c8a32'), Math.cos(a) * r, 0.055, Math.sin(a) * r * 0.85));
  }
  for (const [x, z] of [[-0.15, 0.1], [0.12, -0.16], [0.2, 0.12], [-0.22, -0.1]]) {
    st.add(part(new THREE.CylinderGeometry(0.025, 0.025, 0.004, 10), mat('#4f9a3a'), x, 0.04, z));
    st.add(part(new THREE.SphereGeometry(0.008, 6, 4), mat('#ff9fc0'), x, 0.045, z));
  }
  // Ahşap iskele
  st.add(part(new THREE.BoxGeometry(0.06, 0.01, 0.2), mat('#9a6a43'), 0.28, 0.045, 0.24));
  for (const z of [0.16, 0.32]) st.add(part(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 5), mat('#6b4a33'), 0.3, 0.03, z));
  // Kıyıda ağaçlar ve bank
  for (const [x, z, s] of [[-0.42, -0.42, 1], [0.42, -0.4, 0.9], [-0.42, 0.4, 0.8], [0.44, 0.42, 1.1]]) st.add(tree(x, z, s));
  st.add(part(new THREE.BoxGeometry(0.1, 0.012, 0.03), mat('#9a6a43'), -0.05, 0.05, 0.44));
  const g = new THREE.Group();
  g.add(mergeStatic([st]));
  // Ördekler (yüzer, animateDecor sallar)
  const ducks = new THREE.Group();
  for (const [x, z] of [[-0.05, -0.05], [0.0, -0.02], [0.04, -0.07]]) {
    ducks.add(part(new THREE.SphereGeometry(0.012, 8, 6).scale(1, 0.7, 1.4), mat('#ffffff'), x, 0.05, z));
    ducks.add(part(new THREE.SphereGeometry(0.007, 6, 4), mat('#2e7d32'), x, 0.062, z + 0.013));
  }
  ducks.position.set(big ? 0.18 : 0, 0, big ? -0.16 : 0);
  g.add(ducks);
  return g;
}

// --- Tepe: çimenli yumuşak tepe, kayalar, ağaçlar, tepede bank ve bayrak ---
export function hill() {
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#6cbd55'), 0, 0.01, 0));
  const mound = new THREE.SphereGeometry(0.46, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = mound.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), z = p.getZ(k);
    p.setY(k, p.getY(k) * (0.55 + Math.sin(x * 9) * 0.04 + Math.cos(z * 7) * 0.04));
  }
  mound.computeVertexNormals();
  const m = new THREE.Mesh(mound, new THREE.MeshStandardMaterial({ color: '#5fae45', roughness: 1, flatShading: true }));
  m.position.y = 0.01;
  m.receiveShadow = m.castShadow = true;
  st.add(m);
  for (const [x, z, r] of [[0.2, 0.15, 0.06], [-0.18, 0.22, 0.04], [0.28, -0.18, 0.05]]) st.add(part(new THREE.IcosahedronGeometry(r, 0), mat('#a39e94'), x, 0.12, z));
  for (const [x, z, s] of [[-0.2, -0.15, 1], [0.05, -0.28, 0.9], [-0.3, 0.05, 0.8], [0.32, 0.3, 0.7]]) {
    const t = tree(x, z, s, '#3f8a34');
    t.position.y = 0.12;
    st.add(t);
  }
  // Tepede bank ve bayrak
  st.add(part(new THREE.BoxGeometry(0.1, 0.012, 0.03), mat('#9a6a43'), 0.05, 0.27, 0.06));
  st.add(part(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 5), mat('#7d8791'), -0.02, 0.35, 0));
  st.add(part(new THREE.BoxGeometry(0.003, 0.05, 0.08), mat('#e53935'), -0.02, 0.43, 0.04));
  // Patika
  st.add(part(new THREE.BoxGeometry(0.06, 0.008, 0.3), mat('#d9c9a3'), 0.1, 0.03, 0.34));
  return mergeStatic([st]);
}

// --- Plaj voleybolu: kum saha, file, oyuncular, şemsiyeler ---
export function volley() {
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#efdca4'), 0, 0.01, 0));
  st.add(part(new THREE.BoxGeometry(0.7, 0.005, 0.4), mat('#f4e3b2'), 0, 0.022, -0.05));
  const line = mat('#1e88e5');
  for (const s of [-1, 1]) {
    st.add(part(new THREE.BoxGeometry(0.7, 0.003, 0.01), line, 0, 0.026, -0.05 + s * 0.2));
    st.add(part(new THREE.BoxGeometry(0.01, 0.003, 0.4), line, s * 0.35, 0.026, -0.05));
    st.add(part(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6), mat('#eceff1'), 0, 0.1, -0.05 + s * 0.23));
  }
  st.add(part(new THREE.BoxGeometry(0.004, 0.05, 0.46), mat('#fafafa'), 0, 0.15, -0.05));
  // Oyuncular
  const colors = ['#e53935', '#e53935', '#1e88e5', '#1e88e5'];
  [[-0.18, -0.12], [-0.22, 0.04], [0.18, -0.1], [0.2, 0.05]].forEach(([x, z], k) => {
    st.add(part(new THREE.BoxGeometry(0.02, 0.04, 0.014), mat(colors[k]), x, 0.06, z));
    st.add(part(new THREE.BoxGeometry(0.014, 0.035, 0.012), mat('#f1c27d'), x, 0.032, z));
    st.add(part(new THREE.SphereGeometry(0.011, 6, 5), mat('#e0ac69'), x, 0.09, z));
  });
  st.add(part(new THREE.SphereGeometry(0.012, 8, 6), mat('#fdd835'), 0.06, 0.2, -0.05));
  // Şemsiyeler, şezlonglar, havlular
  for (const [x, c] of [[-0.3, '#ff7043'], [0.0, '#26a69a'], [0.3, '#ab47bc']] as [number, string][]) {
    st.add(part(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 5), mat('#eeeeee'), x, 0.09, 0.34));
    st.add(part(new THREE.ConeGeometry(0.08, 0.035, 12), mat(c), x, 0.17, 0.34));
    st.add(part(new THREE.BoxGeometry(0.05, 0.004, 0.09), mat(c), x + 0.06, 0.025, 0.36));
  }
  return mergeStatic([st]);
}

// --- Kumarhane kulesi: koyu cam kule, dikey neon şeritler, tepede zarlar, ışıklı giriş saçağı ---
export function casino() {
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#2b2f3a'), 0, 0.01, 0));
  const glass = new THREE.MeshStandardMaterial({ color: '#2a2f4a', roughness: 0.15, metalness: 0.6 });
  st.add(part(new THREE.BoxGeometry(0.7, 0.2, 0.7), mat('#3a2f4a'), 0, 0.12, -0.02));
  st.add(part(new THREE.CylinderGeometry(0.28, 0.3, 1.5, 8), glass, 0, 0.97, -0.05));
  st.add(part(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 8), mat('#d4af37'), 0, 1.74, -0.05));
  // Neon şeritler (gece yanar)
  const gold = neon('#ffd54f'), pink = neon('#ff4fa3'), cyan = neon('#4fe3ff');
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    st.add(part(new THREE.BoxGeometry(0.02, 1.45, 0.02), k % 2 ? pink : cyan, Math.sin(a) * 0.29, 0.97, -0.05 + Math.cos(a) * 0.29));
  }
  for (const y of [0.4, 0.8, 1.2, 1.6]) st.add(part(new THREE.CylinderGeometry(0.305, 0.305, 0.015, 8, 1, true), gold, 0, y, -0.05));
  // Tepede iki zar
  const die = mat('#fafafa');
  const dot = mat('#c62828');
  for (const [x, r] of [[-0.09, 0.3], [0.1, -0.4]] as [number, number][]) {
    const d = new THREE.Group();
    d.add(part(new THREE.BoxGeometry(0.14, 0.14, 0.14), die, 0, 0, 0));
    for (const [dx, dy] of [[-0.035, 0.035], [0.035, -0.035], [0, 0]]) d.add(part(new THREE.SphereGeometry(0.014, 6, 4), dot, dx, dy, 0.071));
    d.add(part(new THREE.SphereGeometry(0.014, 6, 4), dot, 0, 0.071, 0));
    d.position.set(x, 1.84, -0.05);
    d.rotation.set(0.3, r, 0.2);
    st.add(d);
  }
  // Giriş: ışıklı saçak, kırmızı halı, palmiyeye benzer bitkiler
  st.add(part(new THREE.BoxGeometry(0.5, 0.03, 0.18), mat('#d4af37'), 0, 0.22, 0.4));
  for (let k = 0; k < 9; k++) st.add(part(new THREE.SphereGeometry(0.01, 6, 4), gold, -0.22 + k * 0.055, 0.205, 0.49));
  st.add(part(new THREE.BoxGeometry(0.14, 0.004, 0.24), mat('#b71c1c'), 0, 0.023, 0.4));
  for (const x of [-0.38, 0.38]) {
    st.add(part(new THREE.CylinderGeometry(0.012, 0.016, 0.22, 6), mat('#8d6e63'), x, 0.13, 0.4));
    st.add(part(new THREE.IcosahedronGeometry(0.07, 0), mat('#43a047'), x, 0.26, 0.4));
  }
  return mergeStatic([st]);
}

// --- Gözlemevi: beyaz kubbe ve yarığından uzanan teleskop, yanında uydu çanağı ---
export function observatory() {
  const st = new THREE.Group();
  st.add(part(new THREE.BoxGeometry(0.98, 0.02, 0.98), mat('#cfd3d8'), 0, 0.01, 0));
  st.add(part(new THREE.CylinderGeometry(0.3, 0.32, 0.2, 24), mat('#eceff1'), -0.12, 0.12, -0.08));
  st.add(part(new THREE.SphereGeometry(0.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat('#f5f7f9'), -0.12, 0.22, -0.08));
  st.add(part(new THREE.BoxGeometry(0.08, 0.3, 0.32), mat('#37474f'), -0.12, 0.33, 0.0).rotateX(-0.5));
  const scope = part(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 10), mat('#90a4ae'), -0.12, 0.42, 0.06);
  scope.rotation.x = 0.9;
  st.add(scope);
  // Uydu çanağı
  st.add(part(new THREE.CylinderGeometry(0.02, 0.03, 0.2, 8), mat('#b0bec5'), 0.3, 0.12, 0.25));
  const dish = part(new THREE.SphereGeometry(0.13, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), mat('#fafafa'), 0.3, 0.3, 0.25);
  dish.rotation.x = -2.2;
  st.add(dish);
  // Giriş binası ve çimler
  st.add(part(new THREE.BoxGeometry(0.3, 0.12, 0.2), mat('#e0e0e0'), 0.25, 0.08, -0.3));
  st.add(part(new THREE.BoxGeometry(0.2, 0.06, 0.012), new THREE.MeshStandardMaterial({ color: '#9fd0ee' }), 0.25, 0.08, -0.195));
  st.add(part(new THREE.BoxGeometry(0.3, 0.02, 0.25), mat('#6cbd55'), 0.25, 0.02, 0.0));
  return mergeStatic([st]);
}
