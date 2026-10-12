import * as THREE from 'three';
import { SIZE, CAR_MODELS } from './config';
import { City, DIRS, idx, inBounds } from './city';
import { makeModel } from './assets';
import { tileCenter } from './view';

const LANE = 0.17; // şeridin yol ortasından uzaklığı (sağdan gidiş)
const MAX_CARS = 45;

interface Car {
  obj: THREE.Object3D;
  tile: number; // içinde bulunduğu yol karesi
  dIn: number; // kareye giriş yönü
  dOut: number; // kareden çıkış yönü
  t: number; // karedeki ilerleme (0..1)
  speed: number; // saniyede kaç kare
}

const fwd = (d: number) => new THREE.Vector3(DIRS[d][0], 0, DIRS[d][1]);
const right = (d: number) => new THREE.Vector3(-DIRS[d][1], 0, DIRS[d][0]);

// Arabalar yollarda rastgele dolaşır; sayısı nüfusla artar
export class Traffic {
  readonly root = new THREE.Group();
  private cars: Car[] = [];
  private wanted = 0;
  private recount = 0;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();

  constructor(private city: City) {}

  setCity(city: City) {
    this.city = city;
    for (const car of this.cars) this.root.remove(car.obj);
    this.cars = [];
  }

  private roadDirs(tile: number) {
    const x = tile % SIZE, z = Math.floor(tile / SIZE);
    return [0, 1, 2, 3].filter(d => this.city.isRoad(x + DIRS[d][0], z + DIRS[d][1]));
  }

  // Bir sonraki çıkış yönü: geri dönmemeye çalış, çıkmaz sokakta dön
  private pickExit(tile: number, dIn: number) {
    const options = this.roadDirs(tile).filter(d => d !== (dIn + 2) % 4);
    if (options.length) return options[Math.floor(Math.random() * options.length)];
    return (dIn + 2) % 4;
  }

  private spawn() {
    const roads: number[] = [];
    this.city.tiles.forEach((t, i) => t?.kind === 'road' && roads.push(i));
    if (!roads.length) return;
    const tile = roads[Math.floor(Math.random() * roads.length)];
    const dirs = this.roadDirs(tile);
    if (!dirs.length) return;
    const dIn = (dirs[Math.floor(Math.random() * dirs.length)] + 2) % 4;
    const obj = makeModel(CAR_MODELS[Math.floor(Math.random() * CAR_MODELS.length)]);
    const car: Car = { obj, tile, dIn, dOut: this.pickExit(tile, dIn), t: Math.random(), speed: 0.8 + Math.random() * 0.6 };
    this.root.add(obj);
    this.cars.push(car);
  }

  update(dt: number) {
    // Kaç araba olması gerektiğini saniyede bir hesapla
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 1;
      const roads = this.city.tiles.filter(t => t?.kind === 'road').length;
      this.wanted = Math.min(MAX_CARS, Math.floor(roads / 3), 2 + Math.floor(this.city.population / 15));
      if (this.cars.length < this.wanted) this.spawn();
      else if (this.cars.length > this.wanted) this.root.remove(this.cars.pop()!.obj);
    }

    this.cars = this.cars.filter(car => {
      car.t += dt * car.speed;
      while (car.t >= 1) {
        car.t -= 1;
        const x = car.tile % SIZE + DIRS[car.dOut][0];
        const z = Math.floor(car.tile / SIZE) + DIRS[car.dOut][1];
        if (!inBounds(x, z) || !this.city.isRoad(x, z)) {
          // Yol yıkıldıysa ya da harita bittiyse dön
          car.dIn = car.dOut;
          car.dOut = (car.dOut + 2) % 4;
          continue;
        }
        car.tile = idx(x, z);
        car.dIn = car.dOut;
        car.dOut = this.pickExit(car.tile, car.dIn);
      }
      if (this.city.tiles[car.tile]?.kind !== 'road') {
        this.root.remove(car.obj);
        return false;
      }
      this.place(car);
      return true;
    });
  }

  // Kare içinde girişten çıkışa yumuşak bir eğri (ikinci derece Bezier) üzerinde ilerle
  private place(car: Car) {
    const center = tileCenter(car.tile % SIZE, Math.floor(car.tile / SIZE)).setY(0.06);
    const { dIn, dOut, t } = car;
    this.a.copy(center).addScaledVector(fwd(dIn), -0.5).addScaledVector(right(dIn), LANE);
    this.b.copy(center).addScaledVector(fwd(dOut), 0.5).addScaledVector(right(dOut), LANE);
    if (dIn === dOut) this.c.copy(center).addScaledVector(right(dIn), LANE);
    else if (dOut === (dIn + 2) % 4) this.c.copy(center).addScaledVector(fwd(dIn), 0.35);
    else this.c.copy(center).addScaledVector(right(dIn), LANE).addScaledVector(right(dOut), LANE);

    const u = 1 - t;
    car.obj.position.set(0, 0, 0)
      .addScaledVector(this.a, u * u)
      .addScaledVector(this.c, 2 * u * t)
      .addScaledVector(this.b, t * t);
    // Gidiş yönü: eğrinin türevi
    const dx = 2 * u * (this.c.x - this.a.x) + 2 * t * (this.b.x - this.c.x);
    const dz = 2 * u * (this.c.z - this.a.z) + 2 * t * (this.b.z - this.c.z);
    car.obj.rotation.y = Math.atan2(dx, dz);
  }
}
