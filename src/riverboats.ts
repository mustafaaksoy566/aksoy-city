import * as THREE from 'three';
import { RIVER, RIVER_ROWS, COAST_ROW, X0, Z0 } from './config';
import { RIVER_Y } from './water';
import { windowMat } from './utilities';
import { mergeStatic } from './batcher';
import { pm } from './parts';

// Nehirde gezi tekneleri: denizin ağzından şehrin içindeki nehir boyunca güneydeki köşeye, oradan batıya
// şehrin kenarına kadar gidip döner; köprülerin altından geçer (ayaklar akıntı yönünde, teknenin şeridinde
// değil). Her tekne gidiş yönünün sağından gider, karşıdan gelenle çarpışmaz. Gece pencereleri yanar.

const LANE = 0.3; // nehrin ortasından sağ şeride uzaklık
const SPEED = 0.45; // birim/saniye

function riverPath() {
  const cx = RIVER[1] - X0; // doğu kolunun ortası (iki sütunun arası)
  const cz = RIVER_ROWS[1] - Z0; // güney kolunun ortası
  const p = new THREE.CurvePath<THREE.Vector3>();
  const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);
  const top = COAST_ROW - Z0 + 0.7;
  p.add(new THREE.LineCurve3(v(cx, top), v(cx, cz - 1.2)));
  p.add(new THREE.QuadraticBezierCurve3(v(cx, cz - 1.2), v(cx, cz), v(cx - 1.2, cz)));
  p.add(new THREE.LineCurve3(v(cx - 1.2, cz), v(-X0 + 1.2, cz)));
  return p;
}

// Gezi teknesi: lacivert ve beyaz tekne, camlı kabin, üstte tenteli seyir güvertesi, kıçta bayrak
function tourBoat(k: number) {
  const g = new THREE.Group();
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-0.24, -0.085);
  hullShape.lineTo(0.15, -0.085);
  hullShape.quadraticCurveTo(0.27, -0.06, 0.29, 0);
  hullShape.quadraticCurveTo(0.27, 0.06, 0.15, 0.085);
  hullShape.lineTo(-0.24, 0.085);
  hullShape.lineTo(-0.24, -0.085);
  const hull = (h: number, y: number, color: string) => {
    const geo = new THREE.ExtrudeGeometry(hullShape, { depth: h, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, pm(color, 0.5));
    m.position.y = y;
    g.add(m);
  };
  const colors = ['#1d3d6e', '#8b1e2b', '#1d6e4f'];
  hull(0.035, -0.02, colors[k % colors.length]);
  hull(0.03, 0.015, '#f5f5f2');
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y + h / 2, z);
    g.add(o);
    return o;
  };
  const white = pm('#ffffff', 0.4);
  // Kabin ve pencereler
  box(0.3, 0.055, 0.13, white, -0.03, 0.045, 0);
  for (const s of [-1, 1]) box(0.26, 0.026, 0.004, windowMat, -0.03, 0.06, s * 0.066);
  box(0.004, 0.026, 0.1, windowMat, 0.122, 0.06, 0);
  // Seyir güvertesi, korkuluk direkleri ve tente
  box(0.33, 0.008, 0.15, white, -0.04, 0.1, 0);
  const post = pm('#c9ced4', 0.4, 0.5);
  for (const x of [-0.18, 0.08]) for (const z of [-0.065, 0.065]) box(0.006, 0.05, 0.006, post, x, 0.108, z);
  const awning = ['#d32f2f', '#1565c0', '#2e7d32'][k % 3];
  box(0.29, 0.008, 0.15, pm(awning, 0.7), -0.05, 0.158, 0);
  // Kıçta direk ve bayrak
  box(0.004, 0.07, 0.004, post, -0.23, 0.045, 0);
  box(0.035, 0.022, 0.002, pm('#e30a17', 0.7), -0.212, 0.09, 0);
  const merged = mergeStatic([g]);
  merged.traverse(o => {
    o.castShadow = false; // gölge haritası her karede çizilmiyor: yürüyen teknenin gölgesi yerde kalmasın
    o.receiveShadow = false;
  });
  return merged;
}

export class RiverBoats {
  readonly root = new THREE.Group();
  private path = riverPath();
  private length = this.path.getLength();
  private boats: { obj: THREE.Object3D; s: number; dir: number; wait: number; side: number; heading: number }[] = [];
  private p = new THREE.Vector3();
  private t = new THREE.Vector3();

  constructor() {
    for (let k = 0; k < 3; k++) {
      const obj = tourBoat(k);
      this.root.add(obj);
      const dir = k % 2 ? 1 : -1;
      this.boats.push({ obj, s: (this.length * (k + 0.3)) / 3, dir, wait: 0, side: dir, heading: NaN });
    }
  }

  update(dt: number, time: number) {
    for (const b of this.boats) {
      // Uçlarda biraz bekleyip döner
      if (b.wait > 0) b.wait -= dt;
      else {
        b.s += b.dir * SPEED * dt;
        if (b.s > this.length || b.s < 0) {
          b.s = THREE.MathUtils.clamp(b.s, 0, this.length);
          b.dir = -b.dir;
          b.wait = 4;
        }
      }
      const u = b.s / this.length;
      this.path.getPointAt(u, this.p);
      this.path.getTangentAt(u, this.t);
      // Sağ şerit: gidiş yönüne göre sağ; uçta dönerken yavaşça karşı şeride geçer ve burnunu çevirir
      b.side += (b.dir - b.side) * Math.min(1, dt * 0.8);
      const nx = -this.t.z, nz = this.t.x;
      b.obj.position.set(this.p.x + nx * LANE * b.side, RIVER_Y + Math.sin(time * 1.7 + b.s) * 0.004, this.p.z + nz * LANE * b.side);
      const want = Math.atan2(-this.t.z * b.dir, this.t.x * b.dir);
      if (Number.isNaN(b.heading)) b.heading = want;
      let d = want - b.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      b.heading += Math.sign(d) * Math.min(Math.abs(d), dt * 1.2);
      b.obj.rotation.y = b.heading;
      b.obj.rotation.z = Math.sin(time * 1.3 + b.s * 2) * 0.02;
    }
  }
}
