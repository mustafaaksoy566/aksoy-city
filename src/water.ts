import * as THREE from 'three';
import { noSnow } from './season';

// Su yüzeyi: nehir ve deniz aynı dalga dokusunu paylaşır; doku yavaşça kayınca su ışıldar.
// Dokunun yeri dünya koordinatından hesaplanır, böylece nehir parçaları ve deniz birbirine dikişsiz bağlanır.

export const SEA_Y = -0.12; // deniz seviyesi
export const RIVER_Y = -0.008; // şehirdeki nehrin yüzeyi
const UV_SCALE = 7; // dalga dokusu kaç birimde bir tekrar etsin

// Kendini tekrar eden dalga yüksekliğinden normal doku üret (tam sayı frekanslı sinüsler = dikişsiz)
function waveNormals(size = 128) {
  const waves = [
    [1, 2, 0.5, 0.3], [3, -1, 0.35, 1.7], [-2, 3, 0.25, 4.1], [5, 2, 0.15, 2.2], [-4, -5, 0.12, 0.9], [7, -3, 0.08, 5.3],
  ];
  const height = (u: number, v: number) =>
    waves.reduce((s, [fx, fy, a, p]) => s + a * Math.sin(Math.PI * 2 * (fx * u + fy * v) + p), 0);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const e = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const dx = (height(u + e, v) - height(u - e, v)) * 1.6;
      const dy = (height(u, v + e) - height(u, v - e)) * 1.6;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const k = (y * size + x) * 4;
      img.data[k] = (n.x * 0.5 + 0.5) * 255;
      img.data[k + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[k + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const normals = waveNormals();

// Suyun renkleri: kıyıda köpük ve turkuaz sığ su, açıldıkça mavi, açık denizde lacivert
export const WATER = {
  foam: new THREE.Color('#dff7f2'),
  shallow: new THREE.Color('#38c0d0'),
  mid: new THREE.Color('#1f95d4'),
  deep: new THREE.Color('#1a66b5'),
};
// Kıyıya uzaklığa göre su rengi (nehirlerde ve kıyıya yakın denizde)
export function waterColor(dist: number, out = new THREE.Color()) {
  return out.lerpColors(WATER.shallow, WATER.mid, THREE.MathUtils.smoothstep(dist, 0.05, 1.1));
}

// Deniz ve nehir aynı su: hafif saydam (dipteki kum görünsün), rengi köşelerden gelir
export const seaMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.28, metalness: 0.05, normalMap: normals, normalScale: new THREE.Vector2(0.22, 0.22),
  transparent: true, opacity: 0.88,
});
export const riverMat = seaMat;
noSnow(seaMat); // su donmaz, kar tutmaz

// Geometrinin doku koordinatlarını dünya konumundan ver (geometri dünya yerinde olmalı)
export function worldUV(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / UV_SCALE;
    uv[i * 2 + 1] = pos.getZ(i) / UV_SCALE;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// Dalgalar yavaşça aksın
export function updateWater(time: number) {
  normals.offset.set(time * 0.018, time * 0.011);
}
