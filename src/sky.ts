import * as THREE from 'three';
import { SIZE, BOAT_MODELS } from './config';
import { makeModel } from './assets';
import { mat, part } from './utilities';

// Şehrin üstü ve çevresi: süzülen bulutlar, arada geçen uçak, denizde gemiler.
// Hepsi sadece görüntü; oyunu etkilemez.

const HALF = SIZE / 2;

// --- Basit modeller ---

export function makeBus(): THREE.Object3D {
  const g = new THREE.Group();
  const body = mat('#1e6fd9');
  const white = mat('#f4f4f2');
  const glass = mat('#2b3440');
  const tire = mat('#1d1f22');
  // Gövde (uzunluk +z yönünde, ön taraf +z)
  g.add(part(new THREE.BoxGeometry(0.22, 0.12, 0.6), body, 0, 0.1, 0));
  g.add(part(new THREE.BoxGeometry(0.225, 0.07, 0.56), glass, 0, 0.19, -0.01));
  g.add(part(new THREE.BoxGeometry(0.22, 0.03, 0.6), white, 0, 0.235, 0));
  g.add(part(new THREE.BoxGeometry(0.2, 0.08, 0.01), glass, 0, 0.17, 0.301)); // ön cam
  g.add(part(new THREE.BoxGeometry(0.12, 0.025, 0.012), mat('#ffd34d'), 0, 0.225, 0.302)); // hat tabelası
  for (const z of [-0.19, 0.19]) {
    for (const x of [-0.105, 0.105]) {
      const w = part(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 10), tire, x, 0.045, z);
      w.rotation.z = Math.PI / 2;
      g.add(w);
    }
  }
  return g;
}

function makePlane() {
  const g = new THREE.Group();
  const white = mat('#f4f6f8');
  const red = mat('#d9363e');
  const glass = mat('#2b3440');
  const body = part(new THREE.CylinderGeometry(0.22, 0.18, 3, 12), white, 0, 0, 0);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = part(new THREE.SphereGeometry(0.22, 12, 8), white, 0, 0, 1.5);
  nose.scale.z = 1.4;
  g.add(nose);
  g.add(part(new THREE.BoxGeometry(0.3, 0.06, 0.05), glass, 0, 0.12, 1.62));
  g.add(part(new THREE.BoxGeometry(3.2, 0.05, 0.55), white, 0, -0.04, 0.1)); // kanatlar
  g.add(part(new THREE.BoxGeometry(1.1, 0.04, 0.3), white, 0, 0.05, -1.35)); // kuyruk kanatları
  g.add(part(new THREE.BoxGeometry(0.05, 0.6, 0.4), red, 0, 0.3, -1.35)); // dikey kuyruk
  g.add(part(new THREE.BoxGeometry(0.46, 0.04, 2.6), red, 0, -0.02, 0)); // kırmızı şerit
  for (const x of [-0.8, 0.8]) {
    const eng = part(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 10), white, x, -0.14, 0.25);
    eng.rotation.x = Math.PI / 2;
    g.add(eng);
  }
  g.traverse(o => ((o as THREE.Mesh).castShadow = false));
  return g;
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

export class Sky {
  readonly root = new THREE.Group();
  private clouds: Flyer[] = [];
  private boats: Flyer[] = [];
  private plane: Flyer | null = null;
  private planeTimer = 8;
  private time = 0;

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
    BOAT_MODELS.forEach((path, k) => {
      const b = makeModel(path);
      const dir = new THREE.Vector3(k % 2 ? -1 : 1, 0, 0);
      b.position.set(-80 + k * 22, -0.33, -HALF - 14 - (k % 4) * 7);
      b.rotation.y = Math.atan2(dir.x, dir.z);
      this.root.add(b);
      this.boats.push({ obj: b, speed: 0.6 + (k % 3) * 0.4, dir, limit: 100 });
    });
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
      b.obj.position.y = -0.33 + Math.sin(this.time * 1.5 + k) * 0.03; // dalgada sallanma
    });

    // Uçak: arada bir şehrin üstünden geçer
    if (!this.plane) {
      this.planeTimer -= dt;
      if (this.planeTimer <= 0) {
        const obj = makePlane();
        const z = -20 + Math.random() * 40;
        const dir = new THREE.Vector3(1, 0, (Math.random() - 0.5) * 0.4).normalize();
        obj.position.set(-90, 15, z);
        obj.rotation.y = Math.atan2(dir.x, dir.z);
        obj.scale.setScalar(0.8);
        this.root.add(obj);
        this.plane = { obj, speed: 9, dir, limit: 90 };
      }
    } else {
      this.plane.obj.position.addScaledVector(this.plane.dir, this.plane.speed * dt);
      if (this.plane.obj.position.x > this.plane.limit) {
        this.root.remove(this.plane.obj);
        this.plane = null;
        this.planeTimer = 25 + Math.random() * 25;
      }
    }
  }
}
