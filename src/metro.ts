import * as THREE from 'three';
import { SIZE, ROWS, X0, Z0 } from './config';
import type { City } from './city';

// Yeraltı (metro) görünümü: şehir koyu bir örtüyle kararır, sokaklar silik görünür, metro hatları
// metro haritası gibi renkli şeritler, istasyonlar beyaz halkalar olarak çizilir; hatlarda trenler gidip gelir.
// Hat = birbirine değen tünel kareleri; en az iki istasyonu bağlayan hat çalışır (renkli), diğerleri gri.

export const LINE_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fbc02d', '#8e24aa', '#fb8c00', '#00acc1', '#d81b60'];
const IDLE = '#9aa5b1';
const Y = 0.14;
const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const center = (i: number, y = Y) => new THREE.Vector3((i % SIZE) - X0 + 0.5, y, Math.floor(i / SIZE) - Z0 + 0.5);

// Üstte çizilen (örtünün üstünde kalan) düz malzeme
const overlay = (color: string, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });

interface Train {
  path: THREE.Vector3[]; // kare ortaları (uçlarda istasyon)
  stops: Set<number>; // yol üstündeki istasyonların sırası
  s: number; // trenin ortasının yol üstündeki konumu (kare cinsinden)
  gap: number; // vagonlar arası
  dir: 1 | -1;
  wait: number;
  cars: THREE.Object3D[];
}

export class MetroView {
  readonly root = new THREE.Group();
  private veil: THREE.Mesh;
  private streets: THREE.InstancedMesh;
  private tunnels: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private dots: THREE.InstancedMesh;
  private trainGroup = new THREE.Group();
  private trains: Train[] = [];
  private tmp = new THREE.Object3D();
  private key = '';

  constructor() {
    this.veil = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'void main() { gl_FragColor = vec4(0.05, 0.09, 0.16, 0.8); }',
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.veil.frustumCulled = false;
    this.veil.renderOrder = 900;
    const n = SIZE * ROWS;
    this.streets = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), overlay('#6f8199', 0.35), n);
    this.tunnels = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), overlay('#ffffff'), n * 3);
    this.rings = new THREE.InstancedMesh(new THREE.CircleGeometry(0.42, 28).rotateX(-Math.PI / 2), overlay('#ffffff'), 256);
    this.dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.26, 24).rotateX(-Math.PI / 2), overlay('#ffffff'), 256);
    this.streets.renderOrder = 940;
    this.tunnels.renderOrder = 960;
    this.rings.renderOrder = 970;
    this.dots.renderOrder = 971;
    this.trainGroup.renderOrder = 980;
    for (const m of [this.streets, this.tunnels, this.rings, this.dots]) {
      m.count = 0;
      m.frustumCulled = false;
    }
    this.root.add(this.veil, this.streets, this.tunnels, this.rings, this.dots, this.trainGroup);
    this.root.visible = false;
  }

  get visible() {
    return this.root.visible;
  }
  set visible(on: boolean) {
    this.root.visible = on;
  }

  // Şehir değişince hatları, istasyonları ve trenleri yeniden kur (bir şey değişmediyse dokunma)
  rebuild(city: City) {
    const lines = city.metroLines();
    const key = `${city.metroKey()}|${lines.stations.map(s => s.join(',')).join(';')}|${city.roadKey()}`;
    if (key === this.key) return;
    this.key = key;
    const put = (m: THREE.InstancedMesh, k: number, p: THREE.Vector3, sx: number, sz: number, color: THREE.Color) => {
      this.tmp.position.copy(p);
      this.tmp.scale.set(sx, 1, sz);
      this.tmp.updateMatrix();
      m.setMatrixAt(k, this.tmp.matrix);
      m.setColorAt(k, color);
    };
    // Sokaklar (yerin üstündeki yolların silik izi)
    let n = 0;
    const gray = new THREE.Color('#ffffff');
    city.tiles.forEach((t, i) => {
      if (t?.kind === 'road') put(this.streets, n++, center(i, 0.11), 0.96, 0.96, gray);
    });
    this.streets.count = n;
    // Tüneller: kare ortası ve komşu tünele uzanan kollar (hat renginde)
    n = 0;
    const col = new THREE.Color();
    city.metro.forEach((v, i) => {
      if (!v) return;
      const line = lines.comp[i];
      col.set(lines.active[line] ? LINE_COLORS[lines.colorOf[line] % LINE_COLORS.length] : IDLE);
      put(this.tunnels, n++, center(i), 0.34, 0.34, col);
      const x = i % SIZE, z = Math.floor(i / SIZE);
      DIRS.forEach(([dx, dz], d) => {
        const nx = x + dx, nz = z + dz;
        if (d > 1 || nx >= SIZE || nz >= ROWS || !city.metro[nz * SIZE + nx]) return; // her bağlantı bir kez
        const p = center(i).add(new THREE.Vector3(dx * 0.5, 0, dz * 0.5));
        put(this.tunnels, n++, p, dx ? 1 : 0.34, dz ? 1 : 0.34, col);
      });
    });
    this.tunnels.count = n;
    // İstasyonlar: hat renginde halka, ortası beyaz
    n = 0;
    const white = new THREE.Color('#ffffff');
    lines.stationList.forEach(({ i, line }) => {
      col.set(line >= 0 && lines.active[line] ? LINE_COLORS[lines.colorOf[line] % LINE_COLORS.length] : IDLE);
      put(this.rings, n, center(i, Y + 0.002), 1, 1, col);
      put(this.dots, n, center(i, Y + 0.004), 1, 1, white);
      n++;
    });
    this.rings.count = this.dots.count = n;
    for (const m of [this.streets, this.tunnels, this.rings, this.dots]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.buildTrains(city, lines);
  }

  // Her çalışan hatta en uzak iki istasyon arasında gidip gelen trenler (uzun hatta daha çok tren)
  private buildTrains(city: City, lines: ReturnType<City['metroLines']>) {
    this.trainGroup.clear();
    this.trains = [];
    lines.stations.forEach((st, line) => {
      if (!lines.active[line]) return;
      const path = farthestPath(city, st);
      if (path.length < 2) return;
      const color = LINE_COLORS[lines.colorOf[line] % LINE_COLORS.length];
      const stops = new Set<number>();
      path.forEach((c, k) => st.some(s => near(s, c)) && stops.add(k));
      const count = 1 + Math.floor(path.length / 14);
      for (let k = 0; k < count; k++) {
        const cars = [0, 1, 2].map(() => makeCar(color));
        cars.forEach(c => this.trainGroup.add(c));
        const last = path.length - 1;
        const gap = Math.min(0.46, last / 2.5);
        this.trains.push({ path: path.map(c => center(c, Y + 0.03)), stops, s: gap + (k / count) * (last - 2 * gap), dir: k % 2 ? -1 : 1, wait: 0, gap, cars });
      }
    });
  }

  update(dt: number) {
    if (!this.root.visible) return;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const t of this.trains) {
      const last = t.path.length - 1;
      if (t.wait > 0) t.wait -= dt;
      else {
        const before = t.s;
        t.s += t.dir * dt * 2.2;
        // İstasyondan geçerken durur; uçta döner
        const passed = [...t.stops].find(k => (before - k) * (t.s - k) < 0 || t.s === k);
        // Tren ortası uçlara bir vagon payı kala döner (vagonlar üst üste binmesin)
        if (t.s <= t.gap || t.s >= last - t.gap) {
          t.s = Math.max(t.gap, Math.min(last - t.gap, t.s));
          t.dir = t.dir === 1 ? -1 : 1;
          t.wait = 1.6;
        } else if (passed !== undefined) {
          t.s = passed;
          t.wait = 1.2;
        }
      }
      t.cars.forEach((car, k) => {
        const s = Math.max(0, Math.min(last, t.s + (1 - k) * t.dir * t.gap));
        const i = Math.min(last - 1, Math.floor(s));
        a.copy(t.path[i]);
        b.copy(t.path[i + 1]);
        car.position.lerpVectors(a, b, s - i);
        car.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      });
    }
  }
}

// Metro vagonu: yuvarlak uçlu beyaz gövde, hat renginde şerit (üstte çizilir)
const bodyGeo = new THREE.CapsuleGeometry(0.13, 0.28, 3, 10).rotateX(Math.PI / 2).scale(1, 0.7, 1);
const stripeGeo = new THREE.BoxGeometry(0.11, 0.02, 0.34);
const bodyMat = overlay('#f4f7fb');
function makeCar(color: string) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  const stripe = new THREE.Mesh(stripeGeo, overlay(color));
  stripe.position.y = 0.09;
  body.renderOrder = 980;
  stripe.renderOrder = 981;
  g.add(body, stripe);
  return g;
}

const near = (a: number, b: number) => {
  const ax = a % SIZE, az = Math.floor(a / SIZE), bx = b % SIZE, bz = Math.floor(b / SIZE);
  return Math.abs(ax - bx) + Math.abs(az - bz) <= 1;
};

// Tünellerde iki kare arası en kısa yol (BFS); istasyondan başlayıp en uzak istasyona
function bfs(city: City, from: number) {
  const prev = new Int32Array(city.metro.length).fill(-2);
  prev[from] = -1;
  const order = [from];
  for (let q = 0; q < order.length; q++) {
    const c = order[q];
    const x = c % SIZE, z = Math.floor(c / SIZE);
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= SIZE || nz >= ROWS) continue;
      const j = nz * SIZE + nx;
      if (prev[j] !== -2 || !city.metro[j]) continue;
      prev[j] = c;
      order.push(j);
    }
  }
  return prev;
}
// İstasyonların altındaki (ya da yanındaki) tünel karesi
function tunnelAt(city: City, s: number) {
  if (city.metro[s]) return s;
  const x = s % SIZE, z = Math.floor(s / SIZE);
  for (const [dx, dz] of DIRS) {
    const j = (z + dz) * SIZE + x + dx;
    if (x + dx >= 0 && x + dx < SIZE && z + dz >= 0 && z + dz < ROWS && city.metro[j]) return j;
  }
  return -1;
}
function farthestPath(city: City, stations: number[]): number[] {
  const starts = stations.map(s => tunnelAt(city, s)).filter(c => c >= 0);
  if (starts.length < 2) return [];
  const dist = (prev: Int32Array, to: number) => {
    let d = 0;
    for (let c = to; prev[c] >= 0; c = prev[c]) d++;
    return d;
  };
  // Önce bir istasyondan en uzak istasyonu, sonra ondan en uzak istasyonu bul (hattın iki ucu)
  let a = starts[0];
  let prev = bfs(city, a);
  let b = starts.reduce((best, c) => (prev[c] !== -2 && dist(prev, c) > dist(prev, best) ? c : best), a);
  prev = bfs(city, b);
  a = starts.reduce((best, c) => (prev[c] !== -2 && dist(prev, c) > dist(prev, best) ? c : best), b);
  const path: number[] = [];
  for (let c = a; c >= 0; c = prev[c]) path.push(c);
  return path;
}
