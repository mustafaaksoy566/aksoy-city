import * as THREE from 'three';
import { SIZE } from './config';
import { City, DIRS, idx, inBounds } from './city';
import { tileCenter } from './view';
import { trainCar } from './vehicles';

// Tren: öndeki vagon rayları izler, diğer vagonlar onun geçtiği yoldan gelir.
// Her istasyon için bir tren (en fazla MAX_TRAINS).

const MAX_TRAINS = 3;
const Y = 0.065;
const CAR_GAPS = [0, 0.86, 1.72]; // vagonların öndeki vagona uzaklığı (kare)

// Vagonlar kodla çizilir (vehicles.ts): gövde köşe renkli; yolcu camları ('window') ve farlar ('headlight')
// ayrı malzemede, gece yanarlar (DayNight bu adlara bakar)
const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.18 });
const glassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.35 });
glassMat.name = 'window';
const lampMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: '#000000' });
lampMat.name = 'headlight';

interface Train {
  tile: number;
  dIn: number;
  dOut: number;
  t: number;
  speed: number;
  trail: THREE.Vector3[]; // öndeki vagonun geçtiği noktalar (en yenisi başta)
}

const fwd = (d: number) => new THREE.Vector3(DIRS[d][0], 0, DIRS[d][1]);

export class Trains {
  readonly root = new THREE.Group();
  private trains: Train[] = [];
  private head: THREE.InstancedMesh[] = []; // kabinli vagon: gövde ve camlar
  private mid: THREE.InstancedMesh[] = []; // ortadaki yolcu vagonu: gövde ve camlar
  private lamps: THREE.InstancedMesh[] = []; // kabinli vagonun farları: öndeki yanar, arkadaki sönük
  private recount = 0;
  private tmp = new THREE.Object3D();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();

  constructor(private city: City) {}

  init() {
    const head = trainCar('head'), mid = trainCar('mid');
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow: boolean) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.root.add(m);
      return m;
    };
    this.head = [make(head.body, bodyMat, MAX_TRAINS * 2, true), make(head.glass, glassMat, MAX_TRAINS * 2, false)];
    this.mid = [make(mid.body, bodyMat, MAX_TRAINS, true), make(mid.glass, glassMat, MAX_TRAINS, false)];
    this.lamps = [make(head.lights, lampMat, MAX_TRAINS, false), make(head.lights, bodyMat, MAX_TRAINS, false)];
  }

  setCity(city: City) {
    this.city = city;
    this.trains = [];
  }

  private railDirs(tile: number) {
    const x = tile % SIZE, z = Math.floor(tile / SIZE);
    return [0, 1, 2, 3].filter(d => this.city.isRail(x + DIRS[d][0], z + DIRS[d][1]));
  }

  private pickExit(tile: number, dIn: number) {
    const options = this.railDirs(tile).filter(d => d !== (dIn + 2) % 4);
    if (options.length) return options[Math.floor(Math.random() * options.length)];
    return (dIn + 2) % 4; // hattın sonu: geri dön
  }

  // İstasyonların yanındaki ray kareleri (trenler buradan başlar)
  private startTiles() {
    const out: number[] = [];
    this.city.tiles.forEach((t, i) => {
      if (t?.kind !== 'station') return;
      for (const c of this.city.cellsOf(i)) {
        const x = c % SIZE, z = Math.floor(c / SIZE);
        for (const [dx, dz] of DIRS) if (this.city.isRail(x + dx, z + dz)) out.push(idx(x + dx, z + dz));
      }
    });
    return out;
  }

  update(dt: number) {
    if (!this.head.length) return;
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 1;
      const starts = this.startTiles();
      const stations = this.city.tiles.filter(t => t?.kind === 'station').length;
      const wanted = Math.min(MAX_TRAINS, stations, starts.length ? stations : 0);
      if (this.trains.length < wanted) {
        const tile = starts[Math.floor(Math.random() * starts.length)];
        const dirs = this.railDirs(tile);
        const dIn = dirs.length ? (dirs[0] + 2) % 4 : 0;
        this.trains.push({ tile, dIn, dOut: this.pickExit(tile, dIn), t: 0, speed: 0.9, trail: [] });
      } else if (this.trains.length > wanted) this.trains.pop();
    }

    let heads = 0, mids = 0, lit = 0, unlit = 0;
    this.trains = this.trains.filter(tr => {
      // Ray yıkıldıysa tren kaybolur
      if (!this.city.isRail(tr.tile % SIZE, Math.floor(tr.tile / SIZE))) return false;
      tr.t += dt * tr.speed;
      while (tr.t >= 1) {
        tr.t -= 1;
        const x = (tr.tile % SIZE) + DIRS[tr.dOut][0];
        const z = Math.floor(tr.tile / SIZE) + DIRS[tr.dOut][1];
        if (!inBounds(x, z) || !this.city.isRail(x, z)) {
          tr.dIn = tr.dOut;
          tr.dOut = (tr.dOut + 2) % 4;
          continue;
        }
        tr.tile = idx(x, z);
        tr.dIn = tr.dOut;
        tr.dOut = this.pickExit(tr.tile, tr.dIn);
      }
      const p = this.pathPoint(tr);
      if (!tr.trail.length || tr.trail[0].distanceTo(p) > 0.03) {
        tr.trail.unshift(p);
        if (tr.trail.length > 160) tr.trail.length = 160;
      }
      // Vagonları iz üzerinde yerleştir: öndeki ve en arkadaki kabinli, ortadaki yolcu vagonu
      CAR_GAPS.forEach((gap, k) => {
        const front = this.along(tr.trail, gap);
        const back = this.along(tr.trail, gap + 0.3);
        if (!front || !back) return;
        this.tmp.position.copy(front).lerp(back, 0.5);
        const ang = Math.atan2(front.x - back.x, front.z - back.z);
        this.tmp.rotation.set(0, k === CAR_GAPS.length - 1 ? ang + Math.PI : ang, 0);
        this.tmp.updateMatrix();
        const m = this.tmp.matrix;
        if (k === 1) {
          for (const mesh of this.mid) mesh.setMatrixAt(mids, m);
          mids++;
        } else {
          for (const mesh of this.head) mesh.setMatrixAt(heads, m);
          heads++;
          // Öndeki kabinin farları yanar, en arkadakinin farları sönük
          if (k === 0) this.lamps[0].setMatrixAt(lit++, m);
          else this.lamps[1].setMatrixAt(unlit++, m);
        }
      });
      return true;
    });
    const counts: [THREE.InstancedMesh[], number][] = [[this.head, heads], [this.mid, mids], [[this.lamps[0]], lit], [[this.lamps[1]], unlit]];
    for (const [list, n] of counts) {
      for (const m of list) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
      }
    }
  }

  // Öndeki vagonun izinden, baştan d kare gerideki nokta
  private along(trail: THREE.Vector3[], d: number): THREE.Vector3 | null {
    let left = d;
    for (let k = 0; k < trail.length - 1; k++) {
      const seg = trail[k].distanceTo(trail[k + 1]);
      if (seg >= left) return trail[k].clone().lerp(trail[k + 1], seg ? left / seg : 0);
      left -= seg;
    }
    return trail.length && d === 0 ? trail[0].clone() : null;
  }

  // Karenin içinde girişten çıkışa yumuşak eğri (rayın ortasından)
  private pathPoint(tr: Train) {
    const center = tileCenter(tr.tile % SIZE, Math.floor(tr.tile / SIZE)).setY(Y);
    const { dIn, dOut, t } = tr;
    this.a.copy(center).addScaledVector(fwd(dIn), -0.5);
    this.b.copy(center).addScaledVector(fwd(dOut), 0.5);
    if (dOut === (dIn + 2) % 4) this.c.copy(center).addScaledVector(fwd(dIn), 0.35);
    else this.c.copy(center);
    const u = 1 - t;
    return new THREE.Vector3().addScaledVector(this.a, u * u).addScaledVector(this.c, 2 * u * t).addScaledVector(this.b, t * t);
  }
}
