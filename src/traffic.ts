import * as THREE from 'three';
import { SIZE, CAR_MODELS, EMERGENCY_CARS } from './config';
import { City, DIRS, idx, inBounds } from './city';
import { makeModel } from './assets';
import { bakeTextured, bakeModel, vertexColorMat } from './batcher';
import { makeBus } from './sky';
import { tileCenter } from './view';

const CAR_LANE = 0.16; // arabalar: şeridin yol ortasından uzaklığı (sağdan gidiş)
const CAR_Y = 0.066; // asfalt (0.036) + tekerleklerin altı
const WALK_LANE = 0.43; // yayalar: kaldırım
const MAX_CARS = 40;
const MAX_WALKERS = 70;

// Yolda giden bir şey (araba ya da yaya)
interface Mover {
  tile: number; // içinde bulunduğu yol karesi
  dIn: number; // kareye giriş yönü
  dOut: number; // kareden çıkış yönü
  t: number; // karedeki ilerleme (0..1)
  speed: number; // saniyede kaç kare
}

const fwd = (d: number) => new THREE.Vector3(DIRS[d][0], 0, DIRS[d][1]);
const right = (d: number) => new THREE.Vector3(-DIRS[d][1], 0, DIRS[d][0]);

function roadDirs(city: City, tile: number) {
  const x = tile % SIZE, z = Math.floor(tile / SIZE);
  return [0, 1, 2, 3].filter(d => city.isRoad(x + DIRS[d][0], z + DIRS[d][1]));
}

// Bir sonraki çıkış yönü: geri dönmemeye çalış, çıkmaz sokakta dön
function pickExit(city: City, tile: number, dIn: number) {
  const options = roadDirs(city, tile).filter(d => d !== (dIn + 2) % 4);
  if (options.length) return options[Math.floor(Math.random() * options.length)];
  return (dIn + 2) % 4;
}

function randomStart(city: City, speed: number): Mover | null {
  const roads: number[] = [];
  city.tiles.forEach((t, i) => t?.kind === 'road' && roads.push(i));
  if (!roads.length) return null;
  const tile = roads[Math.floor(Math.random() * roads.length)];
  const dirs = roadDirs(city, tile);
  if (!dirs.length) return null;
  const dIn = (dirs[Math.floor(Math.random() * dirs.length)] + 2) % 4;
  return { tile, dIn, dOut: pickExit(city, tile, dIn), t: Math.random(), speed };
}

// İlerlet; yol yok olduysa false döner
function advance(city: City, m: Mover, dt: number) {
  m.t += dt * m.speed;
  while (m.t >= 1) {
    m.t -= 1;
    const x = (m.tile % SIZE) + DIRS[m.dOut][0];
    const z = Math.floor(m.tile / SIZE) + DIRS[m.dOut][1];
    if (!inBounds(x, z) || !city.isRoad(x, z)) {
      // Yol yıkıldıysa ya da harita bittiyse dön
      m.dIn = m.dOut;
      m.dOut = (m.dOut + 2) % 4;
      continue;
    }
    m.tile = idx(x, z);
    m.dIn = m.dOut;
    m.dOut = pickExit(city, m.tile, m.dIn);
  }
  return city.tiles[m.tile]?.kind === 'road';
}

// Kare içinde girişten çıkışa yumuşak bir eğri (ikinci derece Bezier) üzerinde konum ve yön
const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
function lanePos(m: Mover, lane: number, y: number, out: THREE.Vector3): number {
  const center = tileCenter(m.tile % SIZE, Math.floor(m.tile / SIZE)).setY(y);
  const { dIn, dOut, t } = m;
  A.copy(center).addScaledVector(fwd(dIn), -0.5).addScaledVector(right(dIn), lane);
  B.copy(center).addScaledVector(fwd(dOut), 0.5).addScaledVector(right(dOut), lane);
  if (dIn === dOut) C.copy(center).addScaledVector(right(dIn), lane);
  else if (dOut === (dIn + 2) % 4) C.copy(center).addScaledVector(fwd(dIn), 0.35);
  else C.copy(center).addScaledVector(right(dIn), lane).addScaledVector(right(dOut), lane);
  const u = 1 - t;
  out.set(0, 0, 0).addScaledVector(A, u * u).addScaledVector(C, 2 * u * t).addScaledVector(B, t * t);
  // Gidiş yönü: eğrinin türevi
  const dx = 2 * u * (C.x - A.x) + 2 * t * (B.x - C.x);
  const dz = 2 * u * (C.z - A.z) + 2 * t * (B.z - C.z);
  return Math.atan2(dx, dz);
}

// Arabalar yollarda rastgele dolaşır; sayısı nüfusla artar.
// Her araba modeli için tek bir çoklu çizim (InstancedMesh) kullanılır: telefonda çok daha hızlı.
export class Traffic {
  readonly root = new THREE.Group();
  private cars: (Mover & { type: number })[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private paths: string[] = [];
  private buses: Mover[] = [];
  private busMesh: THREE.InstancedMesh | null = null;
  private recount = 0;
  private tmp = new THREE.Object3D();

  constructor(private city: City) {}

  // Modeller yüklendikten sonra çağrılır
  init() {
    const busGeo = bakeModel(makeBus());
    if (busGeo) {
      this.busMesh = new THREE.InstancedMesh(busGeo, vertexColorMat, 12);
      this.busMesh.count = 0;
      this.busMesh.frustumCulled = false;
      this.root.add(this.busMesh);
    }
    for (const path of [...CAR_MODELS, EMERGENCY_CARS.health, EMERGENCY_CARS.fire]) {
      const baked = bakeTextured(makeModel(path));
      if (!baked) continue;
      this.paths.push(path);
      const mesh = new THREE.InstancedMesh(baked.geo, baked.mat, MAX_CARS);
      mesh.castShadow = false;
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.root.add(mesh);
    }
  }

  setCity(city: City) {
    this.city = city;
    this.cars = [];
    this.buses = [];
  }

  // Otobüsler: her durak için bir tane (en fazla 12), arabalar gibi dolaşır ama yavaş
  private updateBuses(dt: number) {
    if (!this.busMesh) return;
    const stops = this.city.tiles.filter(t => t?.kind === 'busstop').length;
    const wanted = Math.min(12, stops);
    if (this.buses.length < wanted && this.recount === 1) {
      const m = randomStart(this.city, 0.55);
      if (m) this.buses.push(m);
    } else if (this.buses.length > wanted) this.buses.pop();
    this.buses = this.buses.filter(b => advance(this.city, b, dt));
    this.buses.forEach((b, n) => {
      this.tmp.rotation.y = lanePos(b, CAR_LANE, 0.03, this.tmp.position);
      this.tmp.updateMatrix();
      this.busMesh!.setMatrixAt(n, this.tmp.matrix);
    });
    this.busMesh.count = this.buses.length;
    this.busMesh.instanceMatrix.needsUpdate = true;
  }

  // Hangi araç türü: çoğu normal araba; hastane/itfaiye varsa bazen ambulans/itfaiye aracı
  private pickType() {
    const has = (k: string) => this.city.tiles.some(t => t?.kind === k);
    const r = Math.random();
    const emergency = r < 0.08 && has('health') ? EMERGENCY_CARS.health : r > 0.93 && has('fire') ? EMERGENCY_CARS.fire : null;
    const i = emergency ? this.paths.indexOf(emergency) : -1;
    if (i >= 0) return i;
    const normal = this.paths.filter(p => CAR_MODELS.includes(p));
    return this.paths.indexOf(normal[Math.floor(Math.random() * normal.length)]);
  }

  update(dt: number) {
    // Kaç araba olması gerektiğini saniyede bir hesapla
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 1;
      const roads = this.city.tiles.filter(t => t?.kind === 'road').length;
      const wanted = Math.min(MAX_CARS, Math.floor(roads / 3), 2 + Math.floor(this.city.population / 15));
      if (this.cars.length < wanted) {
        const m = randomStart(this.city, 0.8 + Math.random() * 0.6);
        if (m) this.cars.push({ ...m, type: this.pickType() });
      } else if (this.cars.length > wanted) this.cars.pop();
    }
    this.updateBuses(dt);
    if (!this.meshes.length) return;

    this.cars = this.cars.filter(car => advance(this.city, car, dt));
    const counts = this.meshes.map(() => 0);
    for (const car of this.cars) {
      this.tmp.rotation.y = lanePos(car, CAR_LANE, CAR_Y, this.tmp.position);
      this.tmp.updateMatrix();
      this.meshes[car.type].setMatrixAt(counts[car.type]++, this.tmp.matrix);
    }
    this.meshes.forEach((m, n) => {
      m.count = counts[n];
      m.instanceMatrix.needsUpdate = true;
    });
  }
}

// Kaldırımlarda yürüyen insanlar (çok sayıda olduğu için tek seferde çizilir)
const SHIRTS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292', '#5d4037', '#eceff1'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];

export class Walkers {
  readonly root = new THREE.Group();
  private people: (Mover & { phase: number })[] = [];
  private bodies: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private recount = 0;
  private time = 0;
  private tmp = new THREE.Object3D();

  constructor(private city: City) {
    this.bodies = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.022, 0.028, 0.1, 6).translate(0, 0.05, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      MAX_WALKERS,
    );
    this.heads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.024, 8, 6).translate(0, 0.125, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      MAX_WALKERS,
    );
    const c = new THREE.Color();
    for (let n = 0; n < MAX_WALKERS; n++) {
      this.bodies.setColorAt(n, c.set(SHIRTS[n % SHIRTS.length]));
      this.heads.setColorAt(n, c.set(SKINS[(n * 7) % SKINS.length]));
    }
    this.bodies.count = this.heads.count = 0;
    this.bodies.frustumCulled = this.heads.frustumCulled = false;
    this.root.add(this.bodies, this.heads);
  }

  setCity(city: City) {
    this.city = city;
    this.people = [];
  }

  update(dt: number) {
    this.time += dt;
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 0.5;
      const roads = this.city.tiles.filter(t => t?.kind === 'road').length;
      const wanted = Math.min(MAX_WALKERS, roads, Math.floor(this.city.population / 8));
      if (this.people.length < wanted) {
        const m = randomStart(this.city, 0.18 + Math.random() * 0.14);
        if (m) this.people.push({ ...m, phase: Math.random() * 6 });
      } else if (this.people.length > wanted) this.people.pop();
    }
    this.people = this.people.filter(p => advance(this.city, p, dt));
    this.people.forEach((p, n) => {
      this.tmp.rotation.y = lanePos(p, WALK_LANE, 0.05, this.tmp.position);
      // Yürürken hafifçe zıplasın
      this.tmp.position.y += Math.abs(Math.sin(this.time * 9 + p.phase)) * 0.012;
      this.tmp.updateMatrix();
      this.bodies.setMatrixAt(n, this.tmp.matrix);
      this.heads.setMatrixAt(n, this.tmp.matrix);
    });
    this.bodies.count = this.heads.count = this.people.length;
    this.bodies.instanceMatrix.needsUpdate = this.heads.instanceMatrix.needsUpdate = true;
  }
}
