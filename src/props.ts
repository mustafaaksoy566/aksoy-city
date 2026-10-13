import * as THREE from 'three';
import { mergeStatic } from './batcher';
import { pm, M, add, box, cyl, rod } from './parts';

// Küçük sokak eşyaları (kodla çizilir): yangın musluğu, inşaat alanındaki karton koli ve tahta sandık,
// trafik konisi, çizgili bariyer ve projektör. Ölçüler kare cinsinden, tabanları y=0'da.

// Malzemeler ilk kullanımda yapılır (parts.ts bu dosyadan önce yüklenmemiş olabilir)
let MATS: { RED: THREE.Material; ORANGE: THREE.Material; CARD: THREE.Material; TAPE: THREE.Material } | null = null;
const mats = () =>
  (MATS ??= { RED: pm('#d32f2f', 0.45, 0.2), ORANGE: pm('#ff7a1a', 0.6), CARD: pm('#c89a5e', 0.95), TAPE: pm('#e8d3a8', 0.7) });

// Yangın musluğu: kırmızı gövde, kubbe başlık, iki yanda ve önde ağız, altta flanş
function hydrant() {
  const { RED } = mats();
  const g = new THREE.Group();
  cyl(g, 0.03, 0.032, 0.012, RED, 0, 0, 0, 12);
  cyl(g, 0.02, 0.022, 0.07, RED, 0, 0.012, 0, 12);
  cyl(g, 0.026, 0.026, 0.008, RED, 0, 0.074, 0, 12);
  add(g, new THREE.SphereGeometry(0.021, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), RED, 0, 0.082, 0);
  cyl(g, 0.005, 0.006, 0.012, M.gray, 0, 0.1, 0, 6);
  for (const s of [-1, 1]) {
    add(g, new THREE.CylinderGeometry(0.009, 0.009, 0.014, 10).rotateZ(Math.PI / 2), RED, s * 0.026, 0.055, 0);
    add(g, new THREE.CylinderGeometry(0.006, 0.006, 0.006, 6).rotateZ(Math.PI / 2), M.gray, s * 0.035, 0.055, 0);
  }
  add(g, new THREE.CylinderGeometry(0.011, 0.011, 0.012, 10).rotateX(Math.PI / 2), RED, 0, 0.05, 0.026);
  add(g, new THREE.CylinderGeometry(0.007, 0.007, 0.006, 6).rotateX(Math.PI / 2), M.gray, 0, 0.05, 0.034);
  return mergeStatic([g]);
}

// Bantlı karton koli (iki tane üst üste, biraz döndürülmüş)
function boxA() {
  const { CARD, TAPE } = mats();
  const g = new THREE.Group();
  const one = (y: number, s: number, rot: number) => {
    const b = new THREE.Group();
    b.position.y = y;
    b.rotation.y = rot;
    box(b, s, s * 0.8, s, CARD, 0, 0, 0);
    box(b, s * 0.22, s * 0.8 + 0.002, s + 0.002, TAPE, 0, -0.001, 0);
    g.add(b);
  };
  one(0, 0.1, 0);
  one(0.08, 0.07, 0.35);
  return mergeStatic([g]);
}

// Tahta sandık: çıtalı yüzler, köşe dikmeleri
function boxB() {
  const g = new THREE.Group();
  const s = 0.076;
  box(g, s - 0.006, s - 0.004, s - 0.006, M.wood, 0, 0.002, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.008, s, 0.008, M.darkWood, sx * (s / 2 - 0.004), 0, sz * (s / 2 - 0.004));
  for (const y of [0.012, s - 0.014]) {
    box(g, s - 0.008, 0.008, s + 0.002, M.darkWood, 0, y, 0);
    box(g, s + 0.002, 0.008, s - 0.008, M.darkWood, 0, y, 0);
  }
  return mergeStatic([g]);
}

// Trafik konisi: siyah kare taban, turuncu koni, iki beyaz yansıtıcı bant
function cone() {
  const { ORANGE } = mats();
  const g = new THREE.Group();
  box(g, 0.07, 0.008, 0.07, M.iron, 0, 0, 0);
  add(g, new THREE.ConeGeometry(0.026, 0.079, 14), ORANGE, 0, 0.008 + 0.0395, 0);
  // Yansıtıcı bantlar koninin yüzeyinden biraz dışarıda
  const r = (y: number) => 0.026 * (1 - (y - 0.008) / 0.079) + 0.0008;
  for (const y of [0.03, 0.052]) add(g, new THREE.CylinderGeometry(r(y + 0.0045), r(y - 0.0045), 0.009, 14, 1, true), M.white, 0, y, 0);
  return mergeStatic([g]);
}

// Çizgili bariyer (z boyunca uzun): iki A ayak, üstte kırmızı-beyaz çizgili tahta, ortasında uyarı lambası
function barrier() {
  const { RED } = mats();
  const g = new THREE.Group();
  const L = 0.315, H = 0.15;
  for (const z of [-L / 2 + 0.03, L / 2 - 0.03]) {
    for (const s of [-1, 1]) rod(g, [s * 0.09, 0, z], [0, H, z], 0.006, M.gray, 5);
    rod(g, [-0.05, 0.06, z], [0.05, 0.06, z], 0.004, M.gray, 4);
  }
  const n = 7;
  for (let k = 0; k < n; k++) box(g, 0.012, 0.04, L / n, k % 2 ? M.white : RED, 0, H - 0.02, -L / 2 + (k + 0.5) * (L / n));
  cyl(g, 0.012, 0.012, 0.004, M.iron, 0, H + 0.02, 0, 10);
  add(g, new THREE.SphereGeometry(0.011, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), pm('#ffb300', 0.3), 0, H + 0.024, 0);
  return mergeStatic([g]);
}

// Projektör: tekerlekli jeneratör kasası, direk, üstte dört lambalı başlık
function workLight() {
  const g = new THREE.Group();
  box(g, 0.08, 0.04, 0.06, pm('#f2b705', 0.6), 0, 0.012, 0);
  for (const s of [-1, 1]) add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.008, 10).rotateX(Math.PI / 2), M.iron, s * 0.026, 0.012, 0.032);
  rod(g, [0, 0.05, 0], [0, 0.29, 0], 0.005, M.gray, 6);
  box(g, 0.07, 0.006, 0.01, M.iron, 0, 0.29, 0);
  for (const sx of [-1, 1]) for (const dy of [0, 0.022]) {
    box(g, 0.026, 0.02, 0.016, M.iron, sx * 0.018, 0.293 + dy, 0.004);
    box(g, 0.022, 0.016, 0.002, pm('#fff6d0', 0.3), sx * 0.018, 0.295 + dy, 0.0125);
  }
  return mergeStatic([g]);
}

export const PROP_MODELS: Record<string, () => THREE.Object3D> = {
  'proc/hydrant': hydrant,
  'proc/box-a': boxA,
  'proc/box-b': boxB,
  'proc/cone': cone,
  'proc/barrier': barrier,
  'proc/work-light': workLight,
};
