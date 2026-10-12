import * as THREE from 'three';
import { SIZE, CAR_MODELS, EMERGENCY_CARS, ROAD_GRADES, ENTRANCE_Z } from './config';
import { City, DIRS, idx, inBounds } from './city';
import { makeModel } from './assets';
import { bakeTextured, bakeModel, vertexColorMat } from './batcher';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeBus } from './sky';
import { tileCenter } from './view';
import { isGreen } from './signals';

const CAR_LANE = 0.16; // arabalar: şeridin yol ortasından uzaklığı (sağdan gidiş)
const WIDE_LANES = [0.09, 0.27]; // caddede (çift şerit) iç ve dış şerit
const CAR_Y = 0.066; // asfalt (0.036) + tekerleklerin altı
const CAR_SCALE = 0.9;
const WALK_LANE = 0.43; // yayalar: kaldırım
const MAX_CARS = 70;
const MAX_WALKERS = 80;
const GAP = 0.45; // arka arkaya iki araç arasındaki en az mesafe (kare)
const STOP = 0.58; // kırmızı ışıkta durulan yer (kavşaktan önceki karede)

// Yolda giden bir şey (araba ya da yaya)
interface Mover {
  tile: number; // içinde bulunduğu yol karesi
  dIn: number; // kareye giriş yönü
  dOut: number; // kareden çıkış yönü
  t: number; // karedeki ilerleme (0..1)
  speed: number; // saniyede kaç kare
  fade: number; // görünürlük (belirirken 0'dan 1'e, kaybolurken 1'den 0'a)
  out?: boolean; // gidiyor (kaybolup silinecek)
}

const fwd = (d: number) => new THREE.Vector3(DIRS[d][0], 0, DIRS[d][1]);
const right = (d: number) => new THREE.Vector3(-DIRS[d][1], 0, DIRS[d][0]);
const xz = (tile: number) => [tile % SIZE, Math.floor(tile / SIZE)];

function roadDirs(city: City, tile: number) {
  const [x, z] = xz(tile);
  return [0, 1, 2, 3].filter(d => city.isRoad(x + DIRS[d][0], z + DIRS[d][1]));
}
const neighbor = (tile: number, d: number) => {
  const [x, z] = xz(tile);
  return inBounds(x + DIRS[d][0], z + DIRS[d][1]) ? idx(x + DIRS[d][0], z + DIRS[d][1]) : -1;
};
// Kavşak: üç ya da dört yöne yol açılan kare
const isJunction = (city: City, tile: number) => tile >= 0 && city.tiles[tile]?.kind === 'road' && roadDirs(city, tile).length >= 3;
const isDeadEnd = (city: City, tile: number) => roadDirs(city, tile).length === 1;

// Bir sonraki çıkış yönü: geri dönmemeye çalış, çıkmaz sokakta dön.
// Arabalar kalabalık (trafiği yoğun) yolları daha çok seçer: ana yollar dolu görünür.
function pickExit(city: City, tile: number, dIn: number, busy = false) {
  const options = roadDirs(city, tile).filter(d => d !== (dIn + 2) % 4);
  if (!options.length) return (dIn + 2) % 4;
  if (!busy) return options[Math.floor(Math.random() * options.length)];
  const weights = options.map(d => 1 + city.traffic[neighbor(tile, d)] / 12);
  let r = Math.random() * weights.reduce((s, w) => s + w, 0);
  for (let k = 0; k < options.length; k++) if ((r -= weights[k]) <= 0) return options[k];
  return options[options.length - 1];
}

// Rastgele bir yol karesinde (yürüyenler için)
function randomStart(city: City, speed: number): Mover | null {
  const roads: number[] = [];
  city.tiles.forEach((t, i) => t?.kind === 'road' && roads.push(i));
  if (!roads.length) return null;
  const tile = roads[Math.floor(Math.random() * roads.length)];
  const dirs = roadDirs(city, tile);
  if (!dirs.length) return null;
  const dIn = (dirs[Math.floor(Math.random() * dirs.length)] + 2) % 4;
  return { tile, dIn, dOut: pickExit(city, tile, dIn), t: Math.random(), speed, fade: 0 };
}

// Araba ya bir evin önünden (yolun kenarından) ya da şehir girişinden (otoyoldan) çıkar
function carStart(city: City, speed: number): Mover | null {
  const entrance = idx(0, ENTRANCE_Z);
  if (Math.random() < 0.35 && city.tiles[entrance]?.kind === 'road') {
    return { tile: entrance, dIn: 1, dOut: pickExit(city, entrance, 1, true), t: 0, speed, fade: 0 };
  }
  const homes: number[] = [];
  city.tiles.forEach((t, i) => t?.kind === 'res' && t.level > 0 && homes.push(i));
  if (!homes.length) return null;
  const home = homes[Math.floor(Math.random() * homes.length)];
  const roads = [0, 1, 2, 3].map(d => neighbor(home, d)).filter(n => n >= 0 && city.tiles[n]?.kind === 'road');
  if (!roads.length) return null;
  const tile = roads[Math.floor(Math.random() * roads.length)];
  const dirs = roadDirs(city, tile);
  if (!dirs.length) return null;
  const dIn = (dirs[Math.floor(Math.random() * dirs.length)] + 2) % 4;
  return { tile, dIn, dOut: pickExit(city, tile, dIn, true), t: 0.5, speed, fade: 0 };
}

// İlerlet; yol yok olduysa false döner. limit: bu karede en fazla nereye kadar gidebilir (öndeki araç, kırmızı ışık)
function advance(city: City, m: Mover, step: number, busy = false, limit = Infinity) {
  m.t = Math.min(m.t + step, limit);
  while (m.t >= 1) {
    const [x0, z0] = xz(m.tile);
    const x = x0 + DIRS[m.dOut][0], z = z0 + DIRS[m.dOut][1];
    if (!inBounds(x, z) || !city.isRoad(x, z)) {
      // Şehir girişinden otoyola çıkan araba kaybolur; yol yıkıldıysa geri döner
      if (busy && x < 0 && z0 === ENTRANCE_Z) {
        m.t = 0.999;
        m.out = true;
        break;
      }
      m.t -= 1;
      m.dIn = m.dOut;
      m.dOut = (m.dOut + 2) % 4;
      continue;
    }
    m.t -= 1;
    m.tile = idx(x, z);
    m.dIn = m.dOut;
    m.dOut = pickExit(city, m.tile, m.dIn, busy);
  }
  return city.tiles[m.tile]?.kind === 'road';
}

// Kare içinde girişten çıkışa yumuşak bir eğri (ikinci derece Bezier) üzerinde konum ve yön.
// laneAt: bir yol karesinde şeridin yol ortasına uzaklığı; kare sınırında iki karenin ortalaması alınır.
// Çıkmaz sokağın ucunda adacığın etrafından dönülür.
const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3();
function lanePos(city: City, m: Mover, laneAt: (tile: number) => number, y: number, out: THREE.Vector3, t = m.t): number {
  const [x, z] = xz(m.tile);
  const center = tileCenter(x, z).setY(y);
  const { dIn, dOut } = m;
  const lane = laneAt(m.tile);
  if (dOut === (dIn + 2) % 4 && isDeadEnd(city, m.tile)) {
    // Dönüş meydanı: kenardan girip adacığın çevresinden yarım daire çizerek geri çık
    const f = fwd(dIn), r = right(dIn);
    const R = Math.min(0.46, Math.max(lane + 0.1, 0.3));
    const at = (u: number, v: THREE.Vector3) => {
      if (u < 0.3) {
        const k = THREE.MathUtils.smoothstep(u / 0.3, 0, 1);
        return v.copy(center).addScaledVector(f, -0.5 * (1 - k)).addScaledVector(r, lane + (R - lane) * k);
      }
      if (u < 0.7) {
        const a = ((u - 0.3) / 0.4) * Math.PI;
        return v.copy(center).addScaledVector(r, R * Math.cos(a)).addScaledVector(f, R * Math.sin(a));
      }
      const k = THREE.MathUtils.smoothstep((u - 0.7) / 0.3, 0, 1);
      return v.copy(center).addScaledVector(f, -0.5 * k).addScaledVector(r, -(R + (lane - R) * k));
    };
    at(t, out);
    at(Math.min(1, t + 0.01), P);
    if (t >= 0.99) {
      at(0.99, P);
      at(1, out);
      return Math.atan2(out.x - P.x, out.z - P.z);
    }
    return Math.atan2(P.x - out.x, P.z - out.z);
  }
  const side = (d: number, s: number) => {
    const nx = x + DIRS[d][0] * s, nz = z + DIRS[d][1] * s;
    return city.isRoad(nx, nz) ? (laneAt(idx(nx, nz)) + lane) / 2 : lane;
  };
  const laneIn = side(dIn, -1), laneOut = side(dOut, 1);
  A.copy(center).addScaledVector(fwd(dIn), -0.5).addScaledVector(right(dIn), laneIn);
  B.copy(center).addScaledVector(fwd(dOut), 0.5).addScaledVector(right(dOut), laneOut);
  if (dIn === dOut) C.copy(center).addScaledVector(right(dIn), lane);
  else if (dOut === (dIn + 2) % 4) C.copy(center).addScaledVector(fwd(dIn), 0.35);
  else C.copy(center).addScaledVector(right(dIn), laneIn).addScaledVector(right(dOut), laneOut);
  const u = 1 - t;
  out.set(0, 0, 0).addScaledVector(A, u * u).addScaledVector(C, 2 * u * t).addScaledVector(B, t * t);
  // Gidiş yönü: eğrinin türevi
  const dx = 2 * u * (C.x - A.x) + 2 * t * (B.x - C.x);
  const dz = 2 * u * (C.z - A.z) + 2 * t * (B.z - C.z);
  return Math.atan2(dx, dz);
}

// Kırmızı ışıkta beklenecek yer: bir sonraki kare kavşaksa ve o yöne ışık kırmızıysa durma çizgisi
function lightLimit(city: City, m: Mover, stop: number) {
  if (m.t > stop) return Infinity; // çizgiyi geçmiş, devam etsin
  const next = neighbor(m.tile, m.dOut);
  if (!isJunction(city, next) || isGreen(next, m.dOut)) return Infinity;
  return stop;
}

interface Vehicle extends Mover {
  type: number; // araba modeli (otobüste -1)
  wide: number; // caddede hangi şerit (0 iç, 1 dış)
}

// Arabalar ve otobüsler: ışıklarda durur, öndeki aracın arkasında sıraya girer.
// Sayıları nüfusla artar; evlerin önünden ya da şehir girişinden çıkıp yoğun yolları tercih ederler.
// Her araba modeli için tek bir çoklu çizim (InstancedMesh) kullanılır: telefonda çok daha hızlı.
export class Traffic {
  readonly root = new THREE.Group();
  private cars: Vehicle[] = [];
  private buses: Vehicle[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private paths: string[] = [];
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

  private laneOf(v: Vehicle) {
    return (tile: number) => (this.city.tiles[tile]?.grade === 2 ? WIDE_LANES[v.wide] : CAR_LANE);
  }

  // Aynı karede aynı yöne (ve caddede aynı şeride) giden araçlar
  private key(v: Vehicle, tile = v.tile, dir = v.dOut) {
    return `${tile}|${dir}|${this.city.tiles[tile]?.grade === 2 ? v.wide : 0}`;
  }

  update(dt: number) {
    // Kaç araç olması gerektiğini saniyede bir hesapla
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 0.6;
      const roads = this.city.tiles.filter(t => t?.kind === 'road').length;
      const wanted = Math.min(MAX_CARS, Math.floor(roads / 2.5), 3 + Math.floor(this.city.population / 12));
      const active = this.cars.filter(c => !c.out);
      if (active.length < wanted) {
        const m = carStart(this.city, 0.8 + Math.random() * 0.5);
        if (m) this.cars.push({ ...m, type: this.pickType(), wide: Math.random() < 0.5 ? 0 : 1 });
      } else if (active.length > wanted) active[0].out = true;
      // Otobüsler: her durak için bir tane (en fazla 12)
      const stops = this.city.tiles.filter(t => t?.kind === 'busstop').length;
      const busWanted = Math.min(12, stops);
      const activeBuses = this.buses.filter(b => !b.out);
      if (activeBuses.length < busWanted) {
        const m = carStart(this.city, 0.55);
        if (m) this.buses.push({ ...m, type: -1, wide: 1 });
      } else if (activeBuses.length > busWanted) activeBuses[0].out = true;
    }

    // Karelerdeki araçlar (sıra beklemek için)
    const all = [...this.cars, ...this.buses];
    const lanes = new Map<string, number[]>();
    const entering = new Map<string, number[]>();
    for (const v of all) {
      const k = this.key(v);
      (lanes.get(k) ?? lanes.set(k, []).get(k)!).push(v.t);
      const e = this.key(v, v.tile, v.dIn);
      (entering.get(e) ?? entering.set(e, []).get(e)!).push(v.t);
    }

    const move = (v: Vehicle) => {
      v.fade = Math.min(1, Math.max(0, v.fade + (v.out ? -dt : dt) * 2.2));
      if (v.out && v.fade <= 0) return false;
      const jam = this.city.congestion(v.tile);
      const step = dt * v.speed * ROAD_GRADES[this.city.tiles[v.tile]?.grade ?? 0].speed * (jam > 1 ? Math.max(0.35, 1 / jam) : 1);
      let limit = lightLimit(this.city, v, STOP);
      // Öndeki araç (aynı karede)
      for (const t of lanes.get(this.key(v)) ?? []) if (t > v.t + 1e-4) limit = Math.min(limit, t - GAP);
      // Bir sonraki karenin başındaki araç
      const next = neighbor(v.tile, v.dOut);
      if (next >= 0) for (const t of entering.get(this.key(v, next, v.dOut)) ?? []) limit = Math.min(limit, 1 + t - GAP);
      return advance(this.city, v, step, true, Math.max(v.t, limit));
    };
    this.cars = this.cars.filter(move);
    this.buses = this.buses.filter(move);
    if (!this.meshes.length) return;

    const place = (v: Vehicle, y: number) => {
      this.tmp.rotation.y = lanePos(this.city, v, this.laneOf(v), y, this.tmp.position);
      this.tmp.scale.setScalar(CAR_SCALE * THREE.MathUtils.smoothstep(v.fade, 0, 1));
      this.tmp.updateMatrix();
      return this.tmp.matrix;
    };
    const counts = this.meshes.map(() => 0);
    for (const car of this.cars) this.meshes[car.type].setMatrixAt(counts[car.type]++, place(car, CAR_Y));
    this.meshes.forEach((m, n) => {
      m.count = counts[n];
      m.instanceMatrix.needsUpdate = true;
    });
    if (this.busMesh) {
      this.buses.forEach((b, n) => this.busMesh!.setMatrixAt(n, place(b, 0.03)));
      this.busMesh.count = this.buses.length;
      this.busMesh.instanceMatrix.needsUpdate = true;
    }
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
      } else if (this.people.filter(p => !p.out).length > wanted) {
        const leaving = this.people.find(p => !p.out);
        if (leaving) leaving.out = true;
      }
    }
    const before = this.people.length;
    this.people = this.people.filter(p => {
      p.fade = Math.min(1, Math.max(0, p.fade + (p.out ? -dt : dt) * 2));
      if (p.out && p.fade <= 0) return false;
      return advance(this.city, p, dt * p.speed, false, Math.max(p.t, lightLimit(this.city, p, 0.7)));
    });
    if (this.people.length !== before) this.colorsDirty = true;
    if (this.colorsDirty) this.paint();

    const p = this.parts;
    const put = (m: THREE.InstancedMesh, n: number, x: number, y: number, swing: number) => {
      this.local.makeRotationX(swing).setPosition(x, y, 0);
      m.setMatrixAt(n, this.out.multiplyMatrices(this.base, this.local));
    };
    this.people.forEach((person, n) => {
      this.tmp.rotation.y = lanePos(this.city, person, tile => (this.city.tiles[tile]?.grade === 2 ? 0.468 : WALK_LANE), 0.05, this.tmp.position);
      const step = Math.sin(this.time * 9 + person.phase);
      this.tmp.position.y += Math.abs(step) * 0.005; // adım atarken hafifçe yükselir
      this.tmp.scale.setScalar(THREE.MathUtils.smoothstep(person.fade, 0, 1));
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
