import * as THREE from 'three';
import { CAR_MODELS } from './config';
import { makeModel } from './assets';
import { mergeStatic, bakeTextured } from './batcher';
import { roadPiece, bridge, streetLight } from './view';
import { HW, riverAt } from './terrain';
import { part, mat } from './utilities';

// Şehrin dışındaki otoyol ve üzerindeki trafik.
// Yol, şehirdeki yollarla aynı parçalardan kare kare dizilir (bkz. terrain.ts HW).

const CAR_Y = 0.066; // asfaltın üstü + tekerleklerin altı
const LANE = 0.16; // şeridin yol ortasından uzaklığı (sağdan gidiş)
const CARS_PER_LANE = 14;
const START = -104; // batıdan gelen arabalar dağın içinde (tünelde) başlar

// Yolun kareleri (dünya koordinatında kare köşeleri: merkez = köşe + 0.5)
function cells(): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const add = (x: number, z: number) => out.set(`${x},${z}`, [x, z]);
  const gx = Math.floor(HW.x), z0 = Math.floor(HW.z0), z1 = Math.floor(HW.z1);
  for (let x = Math.floor(HW.portal) - 1; x <= -25; x++) add(x, z0); // tünelden şehrin girişine
  for (let z = z0 + 1; z <= z1; z++) add(gx, z); // şehrin batısından güneye
  for (let x = gx + 1; x <= HW.east; x++) add(x, z1); // şehrin güneyinden doğuya
  return out;
}

// Dağın içine giren tünelin ağzı (doğuya bakar; ön yüzü x = 0'da)
function tunnelPortal() {
  const g = new THREE.Group();
  const stone = mat('#b3ada2');
  const dark = new THREE.MeshBasicMaterial({ color: '#121416' });
  // Ön cephe: iki yan ayak ve üstte kalın kiriş
  for (const z of [-0.72, 0.72]) g.add(part(new THREE.BoxGeometry(0.3, 0.95, 0.4), stone, -0.15, 0.47, z));
  g.add(part(new THREE.BoxGeometry(0.3, 0.3, 1.84), stone, -0.15, 0.8, 0));
  g.add(part(new THREE.BoxGeometry(0.34, 0.06, 1.9), mat('#8f897e'), -0.15, 0.97, 0));
  // Yan duvarlar dağın içine uzanır
  for (const z of [-0.6, 0.6]) g.add(part(new THREE.BoxGeometry(1.8, 0.7, 0.12), stone, -1.1, 0.35, z));
  // İçerisi karanlık
  const inside = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.66, 1.1), dark);
  inside.position.set(-1.1, 0.33, 0);
  g.add(inside);
  // Ağzın üstünde sarı-siyah uyarı şeridi
  for (let k = 0; k < 8; k++) g.add(part(new THREE.BoxGeometry(0.02, 0.07, 0.16), mat(k % 2 ? '#222222' : '#f2c14e'), 0.005, 0.72, -0.56 + k * 0.16));
  return g;
}

export function buildHighway() {
  const parts: THREE.Object3D[] = [];
  const map = cells();
  const has = (x: number, z: number) => map.has(`${x},${z}`) || (x === -24 && z === Math.floor(HW.z0)); // şehrin girişi
  let n = 0;
  for (const [x, z] of map.values()) {
    const mask = (has(x, z - 1) ? 1 : 0) | (has(x + 1, z) ? 2 : 0) | (has(x, z + 1) ? 4 : 0) | (has(x - 1, z) ? 8 : 0);
    const p = roadPiece(mask);
    const tile = new THREE.Group();
    tile.position.set(x + 0.5, 0, z + 0.5);
    const r = makeModel(p.model);
    r.rotation.y = (p.k * Math.PI) / 2;
    tile.add(r);
    const river = riverAt(x + 0.5, z + 0.5);
    if (river && river.d < river.half + 0.6) tile.add(bridge(mask));
    else if (p.model === 'kaykit/road_straight' && n++ % 4 === 0) {
      // Yol kenarında sokak lambaları (karşılıklı)
      const alongX = (mask & 0b1010) !== 0;
      const side = (x + z) % 8 < 4 ? 1 : -1;
      if (alongX) tile.add(streetLight(0, side * 0.46, side > 0 ? -Math.PI / 2 : Math.PI / 2));
      else tile.add(streetLight(side * 0.46, 0, side > 0 ? 0 : Math.PI));
    }
    parts.push(tile);
  }
  const portal = tunnelPortal();
  portal.position.set(HW.portal, 0, HW.z0);
  parts.push(portal);
  return mergeStatic(parts);
}

// Şerit: köşeleri yuvarlatılmış çizgi; uzunluk boyunca konum ve yön verir
class Lane {
  private pts: THREE.Vector3[] = [];
  private acc: number[] = [0];
  readonly length: number;

  constructor(corners: [number, number][], radius = 0.4) {
    const v = corners.map(([x, z]) => new THREE.Vector3(x, CAR_Y, z));
    this.pts.push(v[0]);
    for (let k = 1; k < v.length - 1; k++) {
      const a = v[k].clone().sub(v[k - 1]).normalize(), b = v[k + 1].clone().sub(v[k]).normalize();
      const p0 = v[k].clone().addScaledVector(a, -radius), p2 = v[k].clone().addScaledVector(b, radius);
      for (let s = 0; s <= 6; s++) {
        const t = s / 6, u = 1 - t;
        this.pts.push(new THREE.Vector3().addScaledVector(p0, u * u).addScaledVector(v[k], 2 * u * t).addScaledVector(p2, t * t));
      }
    }
    this.pts.push(v[v.length - 1]);
    for (let k = 1; k < this.pts.length; k++) this.acc.push(this.acc[k - 1] + this.pts[k].distanceTo(this.pts[k - 1]));
    this.length = this.acc[this.acc.length - 1];
  }

  // s uzunluğundaki konum; dönüş: gidiş açısı
  at(s: number, out: THREE.Vector3) {
    let lo = 0, hi = this.acc.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.acc[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo], b = this.pts[hi];
    const t = (s - this.acc[lo]) / Math.max(1e-6, this.acc[hi] - this.acc[lo]);
    out.lerpVectors(a, b, THREE.MathUtils.clamp(t, 0, 1));
    return Math.atan2(b.x - a.x, b.z - a.z);
  }
}

interface Car { lane: number; s: number; speed: number; type: number }

// Otoyolda iki yönde akan trafik: biri tünelden çıkıp doğuya gider, öbürü doğudan gelip tünele girer
export class HighwayTraffic {
  readonly root = new THREE.Group();
  private lanes: Lane[] = [];
  private cars: Car[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private tmp = new THREE.Object3D();

  init() {
    const { x, z0, z1, east } = HW;
    this.lanes = [
      new Lane([[START, z0 + LANE], [x - LANE, z0 + LANE], [x - LANE, z1 + LANE], [east, z1 + LANE]]),
      new Lane([[east, z1 - LANE], [x + LANE, z1 - LANE], [x + LANE, z0 - LANE], [START, z0 - LANE]]),
    ];
    for (const path of CAR_MODELS) {
      const baked = bakeTextured(makeModel(path));
      if (!baked) continue;
      const mesh = new THREE.InstancedMesh(baked.geo, baked.mat, CARS_PER_LANE * 2);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.root.add(mesh);
    }
    this.lanes.forEach((lane, l) => {
      for (let k = 0; k < CARS_PER_LANE; k++) {
        this.cars.push({
          lane: l,
          s: ((k + Math.random() * 0.5) / CARS_PER_LANE) * lane.length,
          speed: 2.4 + Math.random() * 1.2,
          type: Math.floor(Math.random() * this.meshes.length),
        });
      }
    });
  }

  update(dt: number) {
    if (!this.meshes.length) return;
    const counts = this.meshes.map(() => 0);
    this.lanes.forEach((lane, l) => {
      // Öndeki arabaya yaklaşan yavaşlar (birbirinin içinden geçmesinler)
      const list = this.cars.filter(c => c.lane === l).sort((a, b) => b.s - a.s);
      list.forEach((car, k) => {
        let v = car.speed;
        const ahead = list[k - 1];
        if (ahead) {
          const gap = ahead.s - car.s;
          if (gap < 1.4) v = Math.min(v, Math.max(0, (gap - 0.7) * 4));
        }
        car.s += v * dt;
        if (car.s > lane.length) car.s -= lane.length;
        this.tmp.rotation.y = lane.at(car.s, this.tmp.position);
        // Doğudaki ucunda (ufukta) belirip kaybolurlar
        const fromEast = l === 0 ? lane.length - car.s : car.s;
        this.tmp.scale.setScalar(THREE.MathUtils.smoothstep(fromEast, 0.5, 5));
        this.tmp.updateMatrix();
        this.meshes[car.type].setMatrixAt(counts[car.type]++, this.tmp.matrix);
      });
    });
    this.meshes.forEach((m, n) => {
      m.count = counts[n];
      m.instanceMatrix.needsUpdate = true;
    });
  }
}
