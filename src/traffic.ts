import * as THREE from 'three';
import { SIZE, CAR_MODELS, EMERGENCY_CARS, ROAD_GRADES } from './config';
import { City, DIRS, idx, inBounds } from './city';
import { makeModel } from './assets';
import { bakeTextured, bakeModel, vertexColorMat } from './batcher';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeBus } from './sky';
import { tileCenter } from './view';

const CAR_LANE = 0.16; // arabalar: şeridin yol ortasından uzaklığı (sağdan gidiş)
const CAR_Y = 0.066; // asfalt (0.036) + tekerleklerin altı
const WALK_LANE = 0.43; // yayalar: kaldırım
const MAX_CARS = 40;
const MAX_WALKERS = 80;

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

// İlerlet; yol yok olduysa false döner. Arabalar caddede ve bulvarda daha hızlı gider.
function advance(city: City, m: Mover, dt: number, car = false) {
  m.t += dt * m.speed * (car ? ROAD_GRADES[city.tiles[m.tile]?.grade ?? 0].speed : 1);
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
    this.buses = this.buses.filter(b => advance(this.city, b, dt, true));
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

    this.cars = this.cars.filter(car => advance(this.city, car, dt, true));
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

// Kaldırımlarda yürüyen insanlar: bacakları ve kolları yürürken sallanır, herkesin kıyafeti ve saçı farklı.
// Yağmurda renkli şemsiyeler açılır. Her parça için tek çoklu çizim (InstancedMesh) kullanılır.
const SHIRTS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292', '#ffffff', '#26a69a', '#5c6bc0', '#ff7043'];
const PANTS = ['#2b3a55', '#1f2937', '#5b4636', '#3b5b8a', '#6b7280', '#8d6e4c', '#37474f', '#1e3a5f'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#f5cfa0'];
const HAIR = ['#2b1d14', '#3b2a1e', '#5a3a22', '#d4a85a', '#141414', '#9e9e9e', '#a0522d', '#e8c27a'];
const UMBRELLAS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#ff7043', '#ffffff'];
const HIP = 0.052; // kalçanın yüksekliği
const SHOULDER = 0.104;

interface Person extends Mover {
  phase: number;
  look: [number, number, number, number, number]; // gömlek, pantolon, ten, saç, şemsiye
}

// Parçalar: [geometri, renk listesi seçici]
function personParts() {
  const leg = new THREE.CylinderGeometry(0.0085, 0.0075, HIP, 6).translate(0, -HIP / 2, 0);
  const arm = new THREE.CylinderGeometry(0.0062, 0.0055, 0.046, 5).translate(0, -0.023, 0);
  const torso = new THREE.CylinderGeometry(0.0195, 0.0155, 0.058, 8).translate(0, HIP + 0.029, 0);
  const head = new THREE.SphereGeometry(0.0185, 10, 8).translate(0, 0.128, 0);
  const hair = new THREE.SphereGeometry(0.02, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.52).translate(0, 0.131, -0.002);
  const canopy = new THREE.ConeGeometry(0.062, 0.028, 10, 1, true).translate(0, 0.205, 0);
  const stick = new THREE.CylinderGeometry(0.0022, 0.0022, 0.09, 4).translate(0, 0.16, 0);
  const umbrella = mergeGeometries([canopy.toNonIndexed(), stick.toNonIndexed()], false)!;
  return { leg, arm, torso, head, hair, umbrella };
}

export class Walkers {
  readonly root = new THREE.Group();
  private people: Person[] = [];
  private parts: Record<'torso' | 'head' | 'hair' | 'legL' | 'legR' | 'armL' | 'armR' | 'umbrella', THREE.InstancedMesh>;
  private recount = 0;
  private time = 0;
  private colorsDirty = true;
  private tmp = new THREE.Object3D();
  private base = new THREE.Matrix4();
  private local = new THREE.Matrix4();
  private out = new THREE.Matrix4();

  constructor(private city: City) {
    const g = personParts();
    const mesh = (geo: THREE.BufferGeometry, side: THREE.Side = THREE.FrontSide) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85, side }), MAX_WALKERS);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      this.root.add(m);
      return m;
    };
    this.parts = {
      torso: mesh(g.torso), head: mesh(g.head), hair: mesh(g.hair),
      legL: mesh(g.leg), legR: mesh(g.leg), armL: mesh(g.arm), armR: mesh(g.arm),
      umbrella: mesh(g.umbrella, THREE.DoubleSide),
    };
  }

  setCity(city: City) {
    this.city = city;
    this.people = [];
    this.colorsDirty = true;
  }

  private paint() {
    const c = new THREE.Color();
    const p = this.parts;
    this.people.forEach((person, n) => {
      const [shirt, pants, skin, hair, umb] = person.look;
      p.torso.setColorAt(n, c.set(SHIRTS[shirt]));
      p.armL.setColorAt(n, c);
      p.armR.setColorAt(n, c);
      p.legL.setColorAt(n, c.set(PANTS[pants]));
      p.legR.setColorAt(n, c);
      p.head.setColorAt(n, c.set(SKINS[skin]));
      p.hair.setColorAt(n, c.set(HAIR[hair]));
      p.umbrella.setColorAt(n, c.set(UMBRELLAS[umb]));
    });
    for (const m of Object.values(p)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    this.colorsDirty = false;
  }

  // rain: yağmurun şiddeti (0..1)
  update(dt: number, rain = 0) {
    this.time += dt;
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 0.5;
      const roads = this.city.tiles.filter(t => t?.kind === 'road').length;
      const wanted = Math.min(MAX_WALKERS, roads, Math.floor(this.city.population / 8));
      if (this.people.length < wanted) {
        const m = randomStart(this.city, 0.18 + Math.random() * 0.14);
        const pick = (list: unknown[]) => Math.floor(Math.random() * list.length);
        if (m) {
          this.people.push({ ...m, phase: Math.random() * 6, look: [pick(SHIRTS), pick(PANTS), pick(SKINS), pick(HAIR), pick(UMBRELLAS)] });
          this.colorsDirty = true;
        }
      } else if (this.people.length > wanted) {
        this.people.pop();
        this.colorsDirty = true;
      }
    }
    const before = this.people.length;
    this.people = this.people.filter(p => advance(this.city, p, dt));
    if (this.people.length !== before) this.colorsDirty = true;
    if (this.colorsDirty) this.paint();

    const p = this.parts;
    const put = (m: THREE.InstancedMesh, n: number, x: number, y: number, swing: number) => {
      this.local.makeRotationX(swing).setPosition(x, y, 0);
      m.setMatrixAt(n, this.out.multiplyMatrices(this.base, this.local));
    };
    this.people.forEach((person, n) => {
      this.tmp.rotation.y = lanePos(person, WALK_LANE, 0.05, this.tmp.position);
      const step = Math.sin(this.time * 9 + person.phase);
      this.tmp.position.y += Math.abs(step) * 0.005; // adım atarken hafifçe yükselir
      this.tmp.updateMatrix();
      this.base.copy(this.tmp.matrix);
      for (const m of [p.torso, p.head, p.hair, p.umbrella]) m.setMatrixAt(n, this.base);
      put(p.legL, n, -0.0095, HIP, step * 0.55);
      put(p.legR, n, 0.0095, HIP, -step * 0.55);
      // Şemsiyeyi tutan kol öne kalkar
      put(p.armL, n, -0.025, SHOULDER, -step * 0.5);
      put(p.armR, n, 0.025, SHOULDER, rain > 0.25 ? -1.2 : step * 0.5);
    });
    for (const [name, m] of Object.entries(p)) {
      m.count = name === 'umbrella' && rain <= 0.25 ? 0 : this.people.length;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}
