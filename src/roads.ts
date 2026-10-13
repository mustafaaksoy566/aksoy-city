import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Yol parçaları (kodla çizilir): düz yol, yaya geçitli düz yol, viraj, T kavşak, dörtlü kavşak.
// Bir parça bir kare (1x1). Asfalt 0.035, çizgiler 0.0365, kaldırım (bordür) 0.05 yükseklikte; kare kenarlarında
// yere inen yan yüzler var. Parçalar hep aynı yönde çizilir, view.ts döndürür:
// düz: kuzey-güney (z boyunca), viraj: doğu (+x) ile güney (+z) arası, T: kuzey + doğu + güney.

export const ROAD_COLORS = { asphalt: '#3f4559', line: '#d9dde6', curb: '#c9ccd2' };
const DASH = '#e3e7e9'; // orta kesik çizgi ve yaya geçidi
const CURB_FACE = '#a9aeb6'; // bordürün asfalta bakan yüzü
const SIDE = '#6a7277'; // kare kenarında yere inen yüz

export const ROAD_Y = 0.035; // asfalt
const LINE_Y = 0.0365;
const CURB_Y = 0.05;
const IN = 0.45; // bordürün asfalt tarafı (merkezden)
const EDGE = 0.3; // kenar çizgisi
const LW = 0.02; // çizgi genişliği

type P = [number, number]; // [x, z]
const col = new THREE.Color();

// Düz çokgen (yukarı bakar), köşeler [x, z]
function flat(pts: P[], y: number, color: string) {
  const shape = pts.map(([x, z]) => new THREE.Vector2(x, z));
  if (THREE.ShapeUtils.isClockWise(shape)) shape.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(shape, []);
  const pos: number[] = [];
  for (const t of tris) {
    // x-z düzleminde yukarı bakması için sıra ters
    for (const k of [t[0], t[2], t[1]]) pos.push(shape[k].x, y, shape[k].y);
  }
  return painted(pos, color);
}
function painted(pos: number[], color: string) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  col.set(color);
  const c: number[] = [];
  for (let i = 0; i < pos.length / 3; i++) c.push(col.r, col.g, col.b);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  geo.computeVertexNormals();
  return geo;
}
const rect = (x0: number, z0: number, x1: number, z1: number, y: number, color: string) =>
  flat([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y, color);

// Yay şeklinde bant: (cx, cz) merkezli, r0..r1 arası, a0..a1 açıları (açı: x = cx + cos, z = cz + sin)
function arcBand(cx: number, cz: number, r0: number, r1: number, a0: number, a1: number, y: number, color: string, seg = 10) {
  const pos: number[] = [];
  for (let k = 0; k < seg; k++) {
    const t0 = a0 + ((a1 - a0) * k) / seg, t1 = a0 + ((a1 - a0) * (k + 1)) / seg;
    const p = (r: number, t: number): P => [cx + Math.cos(t) * r, cz + Math.sin(t) * r];
    const A = p(r0, t0), B = p(r1, t0), C = p(r1, t1), D = p(r0, t1);
    for (const q of [A, B, C, A, C, D]) pos.push(q[0], y, q[1]);
  }
  // Yukarı baksın
  const up = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  e1.set(pos[3] - pos[0], 0, pos[5] - pos[2]);
  e2.set(pos[6] - pos[0], 0, pos[8] - pos[2]);
  up.crossVectors(e1, e2);
  if (up.y < 0) for (let i = 0; i < pos.length; i += 9) for (const j of [0, 1, 2]) [pos[i + 3 + j], pos[i + 6 + j]] = [pos[i + 6 + j], pos[i + 3 + j]];
  return painted(pos, color);
}

// Dikey yüz: a'dan b'ye, y0..y1; yüzü dışa (n yönüne) baksın
function wall(a: P, b: P, y0: number, y1: number, n: P, color: string) {
  const pos = [a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]];
  const ex = b[0] - a[0], ez = b[1] - a[1];
  // (ex, 0, ez) x (0, 1, 0) = (-ez, 0, ex): bu normal n ile ters ise sırayı çevir
  if (-ez * n[0] + ex * n[1] < 0) {
    for (let i = 0; i < pos.length; i += 9) for (const j of [0, 1, 2]) [pos[i + 3 + j], pos[i + 6 + j]] = [pos[i + 6 + j], pos[i + 3 + j]];
  }
  return painted(pos, color);
}
// Yay boyunca dikey yüz (bordürün kavisli yüzü); merkezden dışa ya da içe bakar
function arcWall(cx: number, cz: number, r: number, a0: number, a1: number, y0: number, y1: number, outward: boolean, color: string, seg = 10) {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < seg; k++) {
    const t0 = a0 + ((a1 - a0) * k) / seg, t1 = a0 + ((a1 - a0) * (k + 1)) / seg, tm = (t0 + t1) / 2;
    const s = outward ? 1 : -1;
    parts.push(wall([cx + Math.cos(t0) * r, cz + Math.sin(t0) * r], [cx + Math.cos(t1) * r, cz + Math.sin(t1) * r], y0, y1, [Math.cos(tm) * s, Math.sin(tm) * s], color));
  }
  return mergeGeometries(parts)!;
}

// Kare kenarındaki yan yüzler: kenar boyunca kaldırım olan aralıklar 0.05'e, gerisi asfalt boyuna kadar
function skirts(walks: [number, P, P][]) {
  const g: THREE.BufferGeometry[] = [];
  const sides: [P, P, P][] = [
    [[-0.5, -0.5], [0.5, -0.5], [0, -1]],
    [[0.5, -0.5], [0.5, 0.5], [1, 0]],
    [[0.5, 0.5], [-0.5, 0.5], [0, 1]],
    [[-0.5, 0.5], [-0.5, -0.5], [-1, 0]],
  ];
  for (const [a, b, n] of sides) g.push(wall(a, b, 0, ROAD_Y, n, SIDE));
  for (const [side, a, b] of walks) g.push(wall(a, b, ROAD_Y, CURB_Y, sides[side][2], SIDE));
  return g;
}

// Kenar kaldırımı: x = s * (IN..0.5) boyunca, z0..z1
function sideWalk(s: number, z0: number, z1: number) {
  const x0 = s * IN, x1 = s * 0.5;
  return [rect(Math.min(x0, x1), z0, Math.max(x0, x1), z1, CURB_Y, ROAD_COLORS.curb), wall([x0, z0], [x0, z1], ROAD_Y, CURB_Y, [-s, 0], CURB_FACE)];
}
// Köşe kaldırımı: (cx, cz) köşesinde 0.05 yarıçaplı çeyrek daire (yanındaki düz yolların bordürleriyle birleşir)
function cornerWalk(cx: number, cz: number) {
  const a0 = Math.atan2(-cz, -cx) - Math.PI / 4;
  const R = 0.5 - IN;
  const pts: P[] = [[cx, cz]];
  for (let k = 0; k <= 8; k++) {
    const t = a0 + ((Math.PI / 2) * k) / 8;
    pts.push([cx + Math.cos(t) * R, cz + Math.sin(t) * R]);
  }
  return [flat(pts, CURB_Y, ROAD_COLORS.curb), arcWall(cx, cz, R, a0, a0 + Math.PI / 2, ROAD_Y, CURB_Y, true, CURB_FACE, 8)];
}
// Köşeyi dönen kenar çizgisi: (cx, cz) köşesi etrafında 0.2 yarıçaplı çeyrek yay
function cornerLine(cx: number, cz: number) {
  const a0 = Math.atan2(-cz, -cx) - Math.PI / 4;
  const r = 0.5 - EDGE;
  return arcBand(cx, cz, r - LW / 2, r + LW / 2, a0, a0 + Math.PI / 2, LINE_Y, ROAD_COLORS.line, 10);
}

function straight(crossing: boolean) {
  const g: THREE.BufferGeometry[] = [rect(-IN, -0.5, IN, 0.5, ROAD_Y, ROAD_COLORS.asphalt)];
  g.push(...sideWalk(-1, -0.5, 0.5), ...sideWalk(1, -0.5, 0.5));
  if (crossing) {
    // Yaya geçidi ortada; kenar çizgileri geçidin iki yanında kesilir
    for (const x of [-0.375, -0.225, -0.075, 0.075, 0.225, 0.375]) g.push(rect(x - 0.035, -0.15, x + 0.035, 0.15, LINE_Y, DASH));
    for (const s of [-1, 1]) {
      g.push(rect(s * EDGE - LW / 2, -0.5, s * EDGE + LW / 2, -0.217, LINE_Y, ROAD_COLORS.line));
      g.push(rect(s * EDGE - LW / 2, 0.217, s * EDGE + LW / 2, 0.5, LINE_Y, ROAD_COLORS.line));
    }
  } else {
    for (const s of [-1, 1]) g.push(rect(s * EDGE - LW / 2, -0.5, s * EDGE + LW / 2, 0.5, LINE_Y, ROAD_COLORS.line));
    for (const z of [-0.4, -0.2, 0, 0.2, 0.4]) g.push(rect(-LW / 2, z - 0.05, LW / 2, z + 0.05, LINE_Y, DASH));
  }
  g.push(...skirts([[0, [-0.5, -0.5], [-IN, -0.5]], [0, [IN, -0.5], [0.5, -0.5]], [2, [0.5, 0.5], [IN, 0.5]], [2, [-IN, 0.5], [-0.5, 0.5]], [1, [0.5, -0.5], [0.5, 0.5]], [3, [-0.5, 0.5], [-0.5, -0.5]]]));
  return g;
}

// Viraj: doğu (+x) ve güney (+z) kenarlarını bağlar; yol (0.5, 0.5) köşesi etrafında çeyrek halka
function corner() {
  const cx = 0.5, cz = 0.5, A0 = Math.PI, A1 = Math.PI * 1.5; // köşeden kuzeybatıya bakan çeyrek
  const rIn = 0.5 - IN, rOut = 0.5 + IN;
  const g: THREE.BufferGeometry[] = [];
  // Asfalt halka
  g.push(arcBand(cx, cz, rIn, rOut, A0, A1, ROAD_Y, ROAD_COLORS.asphalt, 16));
  // İç köşedeki küçük kaldırım
  g.push(...cornerWalk(0.5, 0.5));
  // Dış kaldırım: halkanın dışında kalan bölge (kuzeybatı köşesi)
  const outer: P[] = [[0.5, -0.5], [-0.5, -0.5], [-0.5, 0.5]];
  for (let k = 0; k <= 16; k++) {
    const t = A0 + ((A1 - A0) * k) / 16; // güneybatıdaki (-0.45, 0.5) noktasından kuzeydoğudaki (0.5, -0.45) noktasına
    outer.push([cx + Math.cos(t) * rOut, cz + Math.sin(t) * rOut]);
  }
  g.push(flat(outer, CURB_Y, ROAD_COLORS.curb));
  g.push(arcWall(cx, cz, rOut, A0, A1, ROAD_Y, CURB_Y, false, CURB_FACE, 16));
  // Kenar çizgileri ve orta kesik çizgi
  g.push(arcBand(cx, cz, 0.2 - LW / 2, 0.2 + LW / 2, A0, A1, LINE_Y, ROAD_COLORS.line, 10));
  g.push(arcBand(cx, cz, 0.8 - LW / 2, 0.8 + LW / 2, A0, A1, LINE_Y, ROAD_COLORS.line, 20));
  const dashes = 4;
  for (let k = 0; k < dashes; k++) {
    const t = A0 + ((A1 - A0) * (k + 0.5)) / dashes, half = 0.1 / 0.5 / 2;
    g.push(arcBand(cx, cz, 0.5 - LW / 2, 0.5 + LW / 2, t - half, t + half, LINE_Y, DASH, 3));
  }
  g.push(...skirts([[0, [-0.5, -0.5], [0.5, -0.5]], [3, [-0.5, 0.5], [-0.5, -0.5]], [1, [0.5, IN], [0.5, 0.5]], [2, [0.5, 0.5], [IN, 0.5]], [1, [0.5, -0.5], [0.5, -IN]], [2, [-IN, 0.5], [-0.5, 0.5]]]));
  return g;
}

// T kavşak: kuzey, doğu, güney; batıda düz kaldırım, doğu köşelerinde yuvarlak kaldırım
function tsplit() {
  const g: THREE.BufferGeometry[] = [rect(-IN, -0.5, 0.5, 0.5, ROAD_Y, ROAD_COLORS.asphalt)];
  g.push(...sideWalk(-1, -0.5, 0.5));
  g.push(...cornerWalk(0.5, -0.5), ...cornerWalk(0.5, 0.5));
  g.push(rect(-EDGE - LW / 2, -0.5, -EDGE + LW / 2, 0.5, LINE_Y, ROAD_COLORS.line));
  g.push(cornerLine(0.5, -0.5), cornerLine(0.5, 0.5));
  g.push(...skirts([[3, [-0.5, 0.5], [-0.5, -0.5]], [0, [-0.5, -0.5], [-IN, -0.5]], [2, [-IN, 0.5], [-0.5, 0.5]], [0, [IN, -0.5], [0.5, -0.5]], [2, [0.5, 0.5], [IN, 0.5]], [1, [0.5, -0.5], [0.5, -IN]], [1, [0.5, IN], [0.5, 0.5]]]));
  return g;
}

// Dörtlü kavşak: dört köşede yuvarlak kaldırım ve köşeyi dönen kenar çizgileri
function junction() {
  const g: THREE.BufferGeometry[] = [rect(-0.5, -0.5, 0.5, 0.5, ROAD_Y, ROAD_COLORS.asphalt)];
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as P[]) g.push(...cornerWalk(x, z), cornerLine(x, z));
  g.push(...skirts([[0, [-0.5, -0.5], [-IN, -0.5]], [0, [IN, -0.5], [0.5, -0.5]], [1, [0.5, -0.5], [0.5, -IN]], [1, [0.5, IN], [0.5, 0.5]], [2, [0.5, 0.5], [IN, 0.5]], [2, [-IN, 0.5], [-0.5, 0.5]], [3, [-0.5, 0.5], [-0.5, IN]], [3, [-0.5, -IN], [-0.5, -0.5]]]));
  return g;
}

const ROAD_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
const BUILD: Record<string, () => THREE.BufferGeometry[]> = {
  'proc/road-straight': () => straight(false),
  'proc/road-crossing': () => straight(true),
  'proc/road-corner': corner,
  'proc/road-tsplit': tsplit,
  'proc/road-junction': junction,
};

export const ROAD_KIT: Record<string, () => THREE.Object3D> = {};
for (const [path, build] of Object.entries(BUILD)) {
  ROAD_KIT[path] = () => {
    const geo = mergeGeometries(build().map(g => g.toNonIndexed()))!;
    const mesh = new THREE.Mesh(geo, ROAD_MAT);
    mesh.receiveShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    return g;
  };
}
