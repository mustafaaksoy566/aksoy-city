import * as THREE from 'three';
import { SIZE, X0 } from './config';
import { makeBoat, SEA_BOATS } from './boats';
import { makeAirliner } from './planes';
import { busModel } from './vehicles';
import { RUNWAY } from './landmarks';
import { SEA_Y } from './water';
import { FACING_TURNS, tileCenter } from './view';
import type { City } from './city';

// Şehrin üstü ve çevresi: süzülen bulutlar, uçaklar, denizde gemiler.
// Havalimanı varsa uçaklar pistten kalkıp iner; yoksa arada bir şehrin üstünden geçer.
// Hepsi sadece görüntü; oyunu etkilemez.

const HALF = X0; // gemi yolları: şehrin kuzeyindeki deniz (eski haritanın yarısı kadar açıkta)
const UP = new THREE.Vector3(0, 1, 0);

// --- Basit modeller ---

// Şehir otobüsü (vehicles.ts'de kodla çizilir): uzunluk +z yönünde, ön taraf +z, taban y = 0.
// Düz renkli parçalardan oluşur; trafik ve otoyol bakeModel ile tek geometriye çevirir.
export function makeBus(): THREE.Object3D {
  return busModel();
}

const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, transparent: true, opacity: 0.92 });
function makeCloud(seed: number) {
  const g = new THREE.Group();
  const n = 4 + (seed % 4);
  for (let k = 0; k < n; k++) {
    const r = 0.9 + ((seed * (k + 3)) % 7) * 0.15;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloudMat);
    m.position.set(k * 1.1 - n * 0.55, ((seed + k) % 3) * 0.25, ((seed * k) % 5) * 0.2 - 0.4);
    m.scale.y = 0.6;
    g.add(m);
  }
  return g;
}

// --- Hareket ---

interface Flyer {
  obj: THREE.Object3D;
  speed: number;
  dir: THREE.Vector3;
  limit: number;
}

// Havalimanındaki bir uçuş: pist başı (a), yön (dir), pist uzunluğu (len), s = pist başından uzaklık
interface Flight {
  obj: THREE.Object3D;
  kind: 'takeoff' | 'landing';
  a: THREE.Vector3;
  dir: THREE.Vector3;
  len: number;
  s: number;
  v: number;
  wait: number;
}

const PLANE_SCALE = 0.4; // pistteki uçak boyu ~1.2 kare
const CRUISE = 15; // uçuş yüksekliği

// Havalimanının pisti (dünya koordinatında): baş, yön ve uzunluk
export function runwayOf(city: City, i: number) {
  const t = city.tiles[i]!;
  const n = t.fp ?? 4;
  const x = i % SIZE, z = Math.floor(i / SIZE);
  const center = tileCenter(x + (n - 1) / 2, z + (n - 1) / 2);
  const rot = (FACING_TURNS[t.facing] * Math.PI) / 2;
  const s = n * 0.96;
  const world = (lx: number) => new THREE.Vector3(lx * s, 0, RUNWAY.z * s).applyAxisAngle(UP, rot).add(center);
  const a = world(RUNWAY.x0), b = world(RUNWAY.x1);
  const len = a.distanceTo(b);
  return { a, dir: b.sub(a).normalize(), len };
}

export class Sky {
  readonly root = new THREE.Group();
  private clouds: Flyer[] = [];
  private boats: Flyer[] = [];
  private plane: Flyer | null = null;
  private planeTimer = 8;
  private time = 0;
  private flights = new Map<number, Flight | null>(); // havalimanı karesi -> şu anki uçuş
  private airportWait = new Map<number, number>();
  private nextKind = new Map<number, 'takeoff' | 'landing'>();
  private livery = 0;
  private pool: THREE.Object3D[] = []; // biten uçuşların uçakları tekrar kullanılır (bellek dolmasın)

  constructor(private city: City) {}

  setCity(city: City) {
    this.city = city;
    for (const f of this.flights.values()) if (f) this.release(f.obj);
    this.flights.clear();
  }

  private release(obj: THREE.Object3D) {
    this.root.remove(obj);
    this.pool.push(obj);
  }

  init() {
    // Bulutlar: şehrin çevresinde, ufukta geniş bir halka halinde yavaşça döner (görüşü kapatmasın)
    for (let k = 0; k < 14; k++) {
      const c = makeCloud(k * 7 + 3);
      c.userData.angle = (k / 14) * Math.PI * 2;
      c.userData.radius = 52 + (k % 3) * 12;
      c.position.y = 9 + (k % 4) * 2;
      c.scale.setScalar(1.2 + (k % 3) * 0.4);
      this.root.add(c);
      this.clouds.push({ obj: c, speed: 0.008 + (k % 3) * 0.003, dir: new THREE.Vector3(), limit: 0 });
    }
    // Denizde gemiler: kuzeyde doğu-batı yönünde gidip gelir
    SEA_BOATS.forEach((kind, k) => {
      const b = makeBoat(kind);
      const dir = new THREE.Vector3(k % 2 ? -1 : 1, 0, 0);
      b.position.set(-80 + k * 22, SEA_Y - 0.04, -HALF - 24 - (k % 4) * 6);
      b.rotation.y = Math.atan2(dir.x, dir.z);
      this.root.add(b);
      this.boats.push({ obj: b, speed: 0.6 + (k % 3) * 0.4, dir, limit: 100 });
    });
  }

  private airports() {
    const out: number[] = [];
    this.city.tiles.forEach((t, i) => {
      if (t?.kind === 'airport' && out.length < 2) out.push(i);
    });
    return out;
  }

  // Havuzdan bir uçak al (yoksa yenisini yap)
  private takePlane(scale: number) {
    const p = this.pool.pop() ?? makeAirliner(this.livery++);
    p.rotation.set(0, 0, 0, 'YXZ');
    p.scale.setScalar(scale);
    this.root.add(p);
    return p;
  }

  // Havalimanı uçuşları: sırayla bir kalkış, bir iniş
  private updateAirports(dt: number) {
    const list = this.airports();
    // Yıkılan havalimanlarının uçaklarını kaldır
    for (const [i, f] of this.flights) {
      if (!list.includes(i)) {
        if (f) this.release(f.obj);
        this.flights.delete(i);
      }
    }
    for (const i of list) {
      let f = this.flights.get(i) ?? null;
      if (!f) {
        const wait = (this.airportWait.get(i) ?? 3) - dt;
        this.airportWait.set(i, wait);
        if (wait > 0) continue;
        const { a, dir, len } = runwayOf(this.city, i);
        const kind = this.nextKind.get(i) ?? 'takeoff';
        this.nextKind.set(i, kind === 'takeoff' ? 'landing' : 'takeoff');
        f = { obj: this.takePlane(PLANE_SCALE), kind, a, dir, len, s: kind === 'takeoff' ? 0.4 : -70, v: kind === 'takeoff' ? 0 : 6, wait: 0 };
        this.flights.set(i, f);
      }
      if (this.stepFlight(f, dt)) {
        this.release(f.obj);
        this.flights.set(i, null);
        this.airportWait.set(i, 6 + Math.random() * 8);
      }
    }
  }

  // Uçağı bir adım ilerlet; uçuş bittiyse true
  private stepFlight(f: Flight, dt: number) {
    const lift = f.len * 0.62; // kalkışta tekerlerin yerden kesildiği yer
    const touch = f.len * 0.15; // inişte piste değdiği yer
    let y = 0;
    let pitch = 0;
    if (f.kind === 'takeoff') {
      f.v = Math.min(8, f.v + dt * (f.s < lift ? 1.2 : 1.6));
      f.s += f.v * dt;
      y = Math.min(CRUISE, Math.max(0, f.s - lift) * 0.28);
      pitch = f.s > lift && y < CRUISE ? -0.2 : 0;
      if (f.s > f.len + 85) return true;
    } else {
      if (f.s < touch) f.v = Math.max(2.4, Math.min(6, 2.4 + (touch - f.s) * 0.05));
      else f.v = Math.max(0, f.v - dt * 1.1);
      f.s += f.v * dt;
      y = Math.min(CRUISE, Math.max(0, touch - f.s) * 0.2);
      pitch = y > 0.05 ? -0.06 : 0;
      if (f.v === 0) {
        f.wait += dt;
        if (f.wait > 1.5) return true;
      }
    }
    f.obj.position.copy(f.a).addScaledVector(f.dir, f.s);
    f.obj.position.y = 0.24 + y; // pist yüzeyi + tekerlek yüksekliği
    f.obj.rotation.y = Math.atan2(f.dir.x, f.dir.z);
    f.obj.rotation.x = THREE.MathUtils.lerp(f.obj.rotation.x, pitch, Math.min(1, dt * 3));
    return false;
  }

  update(dt: number) {
    this.time += dt;
    const move = (f: Flyer) => {
      f.obj.position.addScaledVector(f.dir, f.speed * dt);
      // Görüş alanından çıkınca öbür taraftan geri gelsin
      if (f.dir.x > 0 && f.obj.position.x > f.limit) f.obj.position.x = -f.limit;
      if (f.dir.x < 0 && f.obj.position.x < -f.limit) f.obj.position.x = f.limit;
    };
    for (const c of this.clouds) {
      c.obj.userData.angle += c.speed * dt;
      const a = c.obj.userData.angle as number, r = c.obj.userData.radius as number;
      c.obj.position.x = Math.cos(a) * r;
      c.obj.position.z = Math.sin(a) * r;
    }
    this.boats.forEach((b, k) => {
      move(b);
      b.obj.position.y = SEA_Y - 0.04 + Math.sin(this.time * 1.5 + k) * 0.03; // dalgada sallanma
    });

    this.updateAirports(dt);

    // Havalimanı yoksa: arada bir şehrin üstünden bir uçak geçer
    if (!this.plane) {
      this.planeTimer -= dt;
      if (this.planeTimer <= 0 && this.flights.size === 0) {
        const obj = this.takePlane(0.55);
        const z = -20 + Math.random() * 40;
        const dir = new THREE.Vector3(1, 0, (Math.random() - 0.5) * 0.4).normalize();
        obj.position.set(-90, CRUISE + 6, z);
        obj.rotation.y = Math.atan2(dir.x, dir.z);
        this.plane = { obj, speed: 9, dir, limit: 90 };
      } else if (this.planeTimer <= 0) this.planeTimer = 20;
    } else {
      this.plane.obj.position.addScaledVector(this.plane.dir, this.plane.speed * dt);
      if (this.plane.obj.position.x > this.plane.limit) {
        this.release(this.plane.obj);
        this.plane = null;
        this.planeTimer = 25 + Math.random() * 25;
      }
    }
  }
}
