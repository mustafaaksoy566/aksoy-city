import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Arabalar kodla çizilir: yandan bakınca gerçek araba silueti (kaput, ön cam, tavan, bagaj), yuvarlatılmış kenarlar,
// koyu camlar, jantlı tekerlekler, farlar ve stop lambaları. Her türün üç çoklu çizimi var:
// boya (her arabanın rengi ayrı), ayrıntılar (cam, lastik, tampon...) ve farlar (gece yanar).
// Ölçüler: boy +z yönünde (ön taraf +z), taban y = 0.

export type CarKind = 'sedan' | 'hatch' | 'suv' | 'taxi' | 'van' | 'pickup' | 'sport' | 'truck' | 'garbage' | 'police' | 'ambulance' | 'fire';
export const CAR_KINDS: CarKind[] = ['sedan', 'hatch', 'suv', 'taxi', 'van', 'pickup', 'sport', 'truck', 'garbage', 'police', 'ambulance', 'fire'];
// Trafikte sıradan arabalar (sık görülenler listede birden fazla)
export const NORMAL_CARS: CarKind[] = ['sedan', 'sedan', 'sedan', 'hatch', 'hatch', 'suv', 'suv', 'taxi', 'van', 'pickup', 'sport', 'truck', 'garbage'];
const PAINTS = ['#c62828', '#1565c0', '#f5f5f5', '#202124', '#9ea4ab', '#2e7d32', '#f9a825', '#6a1b9a', '#00838f', '#e64a19', '#455a64', '#8d6e63', '#ad1457', '#0d47a1', '#cfd8dc'];
const FIXED: Partial<Record<CarKind, string>> = { taxi: '#fbc02d', police: '#f5f5f5', ambulance: '#f5f5f5', fire: '#c62828', garbage: '#2e7d32' };

// Arabanın rengi: bazı türlerin rengi sabit, diğerleri rastgele
export function carPaint(kind: CarKind) {
  return new THREE.Color(FIXED[kind] ?? PAINTS[Math.floor(Math.random() * PAINTS.length)]);
}

type Bag = THREE.BufferGeometry[];
// Renkli parça: köşelere renk yazılır
function colored(g: THREE.BufferGeometry, color: string) {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) c.toArray(arr, k * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.computeVertexNormals();
  return geo;
}
// Yandan görünüşü (x: boy, y: yükseklik) verilen gövde parçası, genişliği w; kenarları yuvarlatılmış
function profile(points: [number, number][], w: number, bevel = 0.008) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: w - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 4 });
  // Boy +z'ye, genişlik x'e
  g.rotateY(-Math.PI / 2);
  g.translate(w / 2 - bevel, 0, 0);
  return g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

interface Builder {
  paint: Bag;
  trim: Bag;
  lights: Bag;
}
function wheels(b: Builder, zs: number[], halfW: number, r = 0.037) {
  for (const z of zs) {
    for (const s of [-1, 1]) {
      b.trim.push(colored(new THREE.CylinderGeometry(r, r, 0.032, 14).rotateZ(Math.PI / 2).translate(s * halfW, r, z), '#1c1d20'));
      b.trim.push(colored(new THREE.CylinderGeometry(r * 0.58, r * 0.58, 0.034, 8).rotateZ(Math.PI / 2).translate(s * halfW, r, z), '#c9ced6'));
    }
  }
}
// Farlar (önde), stop lambaları (arkada), tamponlar
function lamps(b: Builder, front: number, rear: number, y: number, halfW: number) {
  for (const s of [-1, 1]) {
    b.lights.push(colored(box(0.04, 0.018, 0.01, s * (halfW - 0.035), y, front), '#fff6d5'));
    b.trim.push(colored(box(0.035, 0.016, 0.01, s * (halfW - 0.032), y, rear), '#d32f2f'));
  }
  b.trim.push(colored(box(halfW * 2 - 0.01, 0.022, 0.016, 0, 0.04, front - 0.004), '#3a3d42'));
  b.trim.push(colored(box(halfW * 2 - 0.01, 0.022, 0.016, 0, 0.04, rear + 0.004), '#3a3d42'));
}
const GLASS = '#22303b';

function build(kind: CarKind): Builder {
  const b: Builder = { paint: [], trim: [], lights: [] };
  const P = (g: THREE.BufferGeometry) => b.paint.push(colored(g, '#ffffff'));
  const T = (g: THREE.BufferGeometry, c: string) => b.trim.push(colored(g, c));
  if (kind === 'sedan' || kind === 'taxi' || kind === 'police' || kind === 'sport') {
    const sport = kind === 'sport';
    const L = sport ? 0.23 : 0.22, h = sport ? 0.085 : 0.095, roof = sport ? 0.13 : 0.152;
    P(profile([[-L, 0.03], [L, 0.03], [L + 0.004, 0.068], [L - 0.025, h - 0.006], [0.07, h], [-0.15, h], [-L + 0.01, h - 0.012], [-L - 0.004, 0.06]], 0.19));
    T(profile([[0.075, h - 0.004], [sport ? -0.005 : 0.015, roof], [-0.1, roof + 0.002], [-0.16, h - 0.004]], 0.168, 0.004), GLASS);
    P(profile([[0.02, roof - 0.006], [0.012, roof + 0.004], [-0.095, roof + 0.006], [-0.105, roof - 0.004]], 0.172, 0.003));
    wheels(b, [0.135, -0.135], 0.088);
    lamps(b, L + 0.002, -L - 0.002, 0.07, 0.095);
    for (const s of [-1, 1]) P(box(0.018, 0.012, 0.02, s * 0.1, h + 0.008, 0.06));
    if (sport) T(box(0.17, 0.008, 0.035, 0, h + 0.03, -L + 0.02), '#202124');
    if (kind === 'taxi') {
      T(box(0.06, 0.022, 0.035, 0, roof + 0.016, -0.04), '#202124');
      T(box(0.056, 0.012, 0.037, 0, roof + 0.016, -0.04), '#fff59d');
    }
    if (kind === 'police') {
      T(box(0.19, 0.03, 0.12, 0, 0.055, -0.02), '#202124');
      T(box(0.05, 0.016, 0.03, -0.03, roof + 0.012, -0.04), '#e53935');
      T(box(0.05, 0.016, 0.03, 0.03, roof + 0.012, -0.04), '#1e88e5');
    }
  } else if (kind === 'hatch') {
    const L = 0.19, h = 0.095, roof = 0.158;
    P(profile([[-L, 0.03], [L, 0.03], [L + 0.004, 0.07], [L - 0.025, h - 0.004], [0.08, h], [-L + 0.005, h + 0.004], [-L - 0.004, 0.06]], 0.188));
    T(profile([[0.085, h - 0.004], [0.02, roof], [-0.155, roof - 0.004], [-L + 0.012, h]], 0.166, 0.004), GLASS);
    P(profile([[0.025, roof - 0.006], [0.018, roof + 0.004], [-0.15, roof], [-0.16, roof - 0.01]], 0.17, 0.003));
    wheels(b, [0.115, -0.115], 0.087);
    lamps(b, L + 0.002, -L - 0.002, 0.075, 0.094);
  } else if (kind === 'suv' || kind === 'van' || kind === 'ambulance') {
    const van = kind !== 'suv';
    const L = van ? 0.24 : 0.215, h = van ? 0.11 : 0.105, roof = van ? 0.2 : 0.175;
    P(profile([[-L, 0.035], [L, 0.035], [L + 0.004, 0.075], [L - 0.03, h], [van ? 0.16 : 0.09, h + 0.004], [-L + 0.01, h + 0.004], [-L - 0.004, 0.07]], 0.2));
    if (van) {
      P(profile([[0.16, h], [0.12, roof], [-L + 0.01, roof], [-L + 0.005, h]], 0.196, 0.006));
      T(profile([[0.165, h + 0.004], [0.13, roof - 0.012], [0.07, roof - 0.012], [0.08, h + 0.004]], 0.2, 0.002), GLASS);
      T(box(0.202, 0.035, 0.26, 0, roof - 0.04, -0.06), kind === 'ambulance' ? '#f5f5f5' : GLASS);
    } else {
      T(profile([[0.095, h], [0.05, roof], [-0.18, roof], [-0.2, h]], 0.18, 0.004), GLASS);
      P(profile([[0.055, roof - 0.006], [0.05, roof + 0.004], [-0.18, roof + 0.004], [-0.185, roof - 0.006]], 0.184, 0.003));
      for (const s of [-1, 1]) T(box(0.008, 0.008, 0.2, s * 0.08, roof + 0.01, -0.06), '#2a2d31');
    }
    wheels(b, [0.15, -0.15], 0.09, 0.042);
    lamps(b, L + 0.002, -L - 0.002, 0.08, 0.1);
    if (kind === 'ambulance') {
      T(box(0.203, 0.02, 0.4, 0, 0.09, -0.01), '#d32f2f');
      T(box(0.03, 0.03, 0.08, 0.01, roof + 0.02, -0.12), '#d32f2f');
      T(box(0.08, 0.016, 0.03, -0.03, roof + 0.008, 0.1), '#e53935');
      T(box(0.08, 0.016, 0.03, 0.05, roof + 0.008, 0.1), '#1e88e5');
    }
  } else if (kind === 'pickup') {
    const L = 0.23, h = 0.1, roof = 0.17;
    P(profile([[-L, 0.035], [L, 0.035], [L + 0.004, 0.075], [L - 0.03, h], [0.1, h + 0.004], [-L, h + 0.004], [-L - 0.004, 0.07]], 0.2));
    P(profile([[0.1, h], [0.06, roof], [-0.04, roof], [-0.045, h]], 0.19, 0.005));
    T(profile([[0.098, h + 0.003], [0.062, roof - 0.01], [-0.035, roof - 0.01], [-0.04, h + 0.003]], 0.194, 0.002), GLASS);
    // Kasa: yan duvarlar ve içi
    T(box(0.18, 0.005, 0.18, 0, h + 0.004, -0.14), '#2a2d31');
    for (const s of [-1, 1]) P(box(0.012, 0.04, 0.18, s * 0.094, h + 0.02, -0.14));
    P(box(0.2, 0.04, 0.012, 0, h + 0.02, -L + 0.006));
    wheels(b, [0.15, -0.15], 0.092, 0.042);
    lamps(b, L + 0.002, -L - 0.002, 0.075, 0.1);
  } else {
    // Kamyonlar: kabin ve arkada kasa (kamyon: beyaz kutu, çöp kamyonu: yeşil konteyner, itfaiye: kırmızı ve merdiven)
    const L = kind === 'fire' ? 0.29 : 0.27;
    const cabZ = L - 0.07;
    P(profile([[cabZ - 0.08, 0.04], [L, 0.04], [L + 0.004, 0.1], [L - 0.01, 0.19], [cabZ - 0.08, 0.2]], 0.21, 0.008));
    T(box(0.2, 0.06, 0.012, 0, 0.15, L - 0.006), GLASS);
    for (const s of [-1, 1]) T(box(0.012, 0.05, 0.07, s * 0.1, 0.15, cabZ), GLASS);
    T(box(0.2, 0.025, 0.5, 0, 0.045, 0), '#2a2d31');
    if (kind === 'truck') {
      T(box(0.21, 0.19, 0.38, 0, 0.06, -0.08).translate(0, 0.095, 0), '#f1f1ef');
      T(box(0.212, 0.04, 0.2, 0, 0.17, -0.08), '#1e88e5');
    } else if (kind === 'garbage') {
      P(profile([[-L, 0.06], [cabZ - 0.09, 0.06], [cabZ - 0.09, 0.22], [-L + 0.05, 0.22], [-L, 0.16]], 0.21, 0.008));
      T(box(0.214, 0.02, 0.3, 0, 0.12, -0.08), '#f9a825');
    } else {
      P(box(0.21, 0.12, 0.38, 0, 0.12, -0.08));
      for (const s of [-1, 1]) T(box(0.006, 0.006, 0.42, s * 0.05, 0.19, -0.06), '#d7dce2');
      for (let k = 0; k < 8; k++) T(box(0.1, 0.005, 0.006, 0, 0.19, -0.26 + k * 0.05), '#d7dce2');
      T(box(0.214, 0.015, 0.38, 0, 0.1, -0.08), '#f5f5f5');
      T(box(0.08, 0.018, 0.03, -0.04, 0.21, cabZ), '#e53935');
      T(box(0.08, 0.018, 0.03, 0.04, 0.21, cabZ), '#1e88e5');
    }
    wheels(b, [L - 0.06, -0.08, -0.2], 0.098, 0.045);
    lamps(b, L + 0.002, -L - 0.002, 0.08, 0.105);
  }
  return b;
}

const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35 });
const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
const lightMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: '#000000' });
lightMat.name = 'headlight'; // DayNight geceleri yakar

const join = (list: Bag) => (list.length ? mergeGeometries(list, false)! : new THREE.BufferGeometry());

// Bir trafik için bütün araba türlerinin çoklu çizimleri
export class CarSet {
  readonly root = new THREE.Group();
  readonly lengths: number[] = [];
  readonly widths: number[] = [];
  private parts: { paint: THREE.InstancedMesh; trim: THREE.InstancedMesh; lights: THREE.InstancedMesh }[] = [];
  private counts: number[] = [];

  constructor(readonly kinds: CarKind[], private capacity: number) {
    for (const kind of kinds) {
      const b = build(kind);
      const paint = join(b.paint), trim = join(b.trim), lights = join(b.lights);
      const bb = new THREE.Box3().setFromBufferAttribute(trim.attributes.position as THREE.BufferAttribute).union(new THREE.Box3().setFromBufferAttribute(paint.attributes.position as THREE.BufferAttribute));
      this.lengths.push(bb.max.z - bb.min.z);
      this.widths.push(bb.max.x - bb.min.x);
      const make = (geo: THREE.BufferGeometry, m: THREE.Material) => {
        const im = new THREE.InstancedMesh(geo, m, capacity);
        im.count = 0;
        im.frustumCulled = false;
        im.castShadow = false;
        im.receiveShadow = true;
        this.root.add(im);
        return im;
      };
      const p = make(paint, paintMat);
      p.setColorAt(0, new THREE.Color('#ffffff'));
      this.parts.push({ paint: p, trim: make(trim, trimMat), lights: make(lights, lightMat) });
      this.counts.push(0);
    }
  }

  begin() {
    this.counts.fill(0);
  }

  put(kind: number, matrix: THREE.Matrix4, color: THREE.Color) {
    const n = this.counts[kind];
    if (n >= this.capacity) return;
    const p = this.parts[kind];
    p.paint.setMatrixAt(n, matrix);
    p.paint.setColorAt(n, color);
    p.trim.setMatrixAt(n, matrix);
    p.lights.setMatrixAt(n, matrix);
    this.counts[kind] = n + 1;
  }

  end() {
    this.parts.forEach((p, k) => {
      for (const m of [p.paint, p.trim, p.lights]) {
        m.count = this.counts[k];
        m.instanceMatrix.needsUpdate = true;
      }
      if (p.paint.instanceColor) p.paint.instanceColor.needsUpdate = true;
    });
  }
}
