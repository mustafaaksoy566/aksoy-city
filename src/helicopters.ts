import * as THREE from 'three';
import { RES_LEVELS } from './config';
import { City } from './city';
import { HELIPADS } from './towers';
import { tileCenter } from './view';

// Helikopterler: gökdelenlerin çatısındaki helikopter pistlerinde durur; pervanesi dönmeye başlar,
// dikine kalkar, başka bir gökdelenin pistine uçar ve yavaşça iner.

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra });
const LIVERIES = ['#d32f2f', '#1565c0', '#f9a825', '#2e7d32', '#ffffff', '#212121'];

function makeHeli(color: string) {
  const g = new THREE.Group();
  const body = mat(color, { metalness: 0.3, roughness: 0.35 });
  const glass = mat('#1f3b57', { metalness: 0.6, roughness: 0.15 });
  const metal = mat('#3c4148', { metalness: 0.6, roughness: 0.4 });
  const stripe = mat(color === '#ffffff' ? '#d32f2f' : '#ffffff');
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // Gövde ve kokpit camı
  add(new THREE.SphereGeometry(0.055, 16, 12).scale(1, 0.85, 1.55), body, 0, 0.068, 0);
  add(new THREE.SphereGeometry(0.047, 16, 12).scale(0.92, 0.72, 0.95), glass, 0, 0.078, 0.045);
  add(new THREE.BoxGeometry(0.112, 0.012, 0.09), stripe, 0, 0.055, -0.01);
  // Kuyruk, dikey ve yatay dengeleyici
  const boom = add(new THREE.CylinderGeometry(0.011, 0.019, 0.19, 10), body, 0, 0.082, -0.155);
  boom.rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(0.006, 0.055, 0.04), body, 0, 0.108, -0.245);
  add(new THREE.BoxGeometry(0.07, 0.004, 0.025), body, 0, 0.085, -0.225);
  // Kuyruk pervanesi
  const tail = new THREE.Group();
  tail.position.set(0.007, 0.11, -0.25);
  g.add(tail);
  add(new THREE.BoxGeometry(0.003, 0.06, 0.008), metal, 0, 0, 0, tail);
  add(new THREE.BoxGeometry(0.003, 0.008, 0.06), metal, 0, 0, 0, tail);
  // Kızaklar
  for (const s of [-1, 1]) {
    const skid = add(new THREE.CylinderGeometry(0.004, 0.004, 0.17, 6), metal, s * 0.04, 0.005, 0.005);
    skid.rotation.x = Math.PI / 2;
    for (const z of [-0.035, 0.045]) {
      const strut = add(new THREE.CylinderGeometry(0.003, 0.003, 0.035, 5), metal, s * 0.033, 0.022, z);
      strut.rotation.z = s * 0.35;
    }
  }
  // Ana pervane: direk ve dört kanat
  add(new THREE.CylinderGeometry(0.006, 0.008, 0.03, 8), metal, 0, 0.128, 0);
  const rotor = new THREE.Group();
  rotor.position.set(0, 0.145, 0);
  g.add(rotor);
  for (let k = 0; k < 4; k++) {
    const blade = add(new THREE.BoxGeometry(0.17, 0.003, 0.016), metal, 0, 0, 0, rotor);
    blade.rotation.y = (k * Math.PI) / 2;
    blade.translateX(0.085);
  }
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 10), metal, 0, 0, 0, rotor);
  // Gece yanan kırmızı ışık
  const lamp = new THREE.MeshStandardMaterial({ color: '#ff4444', emissive: '#ff4444', emissiveIntensity: 0 });
  lamp.name = 'lamp';
  add(new THREE.SphereGeometry(0.008, 8, 6), lamp, 0, 0.138, -0.245);
  add(new THREE.SphereGeometry(0.007, 8, 6), lamp, 0, 0.03, 0.06);
  g.scale.setScalar(1.1);
  return { g, rotor, tail };
}

interface Pad {
  tile: number;
  pos: THREE.Vector3;
}
type State = 'parked' | 'spinup' | 'up' | 'fly' | 'down';
interface Heli {
  obj: THREE.Group;
  rotor: THREE.Group;
  tail: THREE.Group;
  pad: Pad | null;
  target: Pad | null;
  state: State;
  timer: number;
  spin: number; // pervane hızı
  heading: number;
  cruise: number;
}

export class Helicopters {
  readonly root = new THREE.Group();
  private helis: Heli[] = [];
  private pads: Pad[] = [];
  private scanTimer = 0;
  private livery = 0;

  constructor(private city: City) {}

  setCity(city: City) {
    this.city = city;
    for (const h of this.helis) this.root.remove(h.obj);
    this.helis = [];
    this.scanTimer = 0;
  }

  // Şehirdeki helikopter pistleri: çatısında pist olan gökdelenler
  private scan() {
    this.pads = [];
    this.city.tiles.forEach((t, i) => {
      if (t?.kind !== 'res' || t.level < 5) return;
      const models = RES_LEVELS[t.level - 1].models;
      const y = HELIPADS[models[t.variant % models.length]];
      if (y === undefined) return;
      const x = i % 48, z = Math.floor(i / 48);
      this.pads.push({ tile: i, pos: tileCenter(x, z).setY(y) });
    });
    // Eski pistler kaybolduysa o helikopterler havalansın
    for (const h of this.helis) {
      if (h.pad && !this.pads.some(p => p.tile === h.pad!.tile)) {
        h.pad = null;
        if (h.state === 'parked' || h.state === 'spinup') h.state = 'up';
      }
      if (h.target && !this.pads.some(p => p.tile === h.target!.tile)) h.target = null;
    }
  }

  private used(pad: Pad) {
    return this.helis.some(h => h.pad?.tile === pad.tile || h.target?.tile === pad.tile);
  }

  private spawn() {
    const free = this.pads.filter(p => !this.used(p));
    if (!free.length) return;
    const pad = free[Math.floor(Math.random() * free.length)];
    const { g, rotor, tail } = makeHeli(LIVERIES[this.livery++ % LIVERIES.length]);
    g.position.copy(pad.pos);
    const heading = Math.random() * Math.PI * 2;
    g.rotation.y = heading;
    this.root.add(g);
    this.helis.push({ obj: g, rotor, tail, pad, target: null, state: 'parked', timer: 3 + Math.random() * 12, spin: 0, heading, cruise: 0 });
  }

  update(dt: number) {
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 2;
      this.scan();
      const wanted = this.pads.length >= 2 ? Math.min(4, Math.floor(this.pads.length / 2)) : 0;
      if (this.helis.length < wanted) this.spawn();
    }
    const wanted = this.pads.length >= 2 ? Math.min(4, Math.floor(this.pads.length / 2)) : 0;
    this.helis = this.helis.filter(h => {
      const o = h.obj;
      // Pervaneler
      const goal = h.state === 'parked' ? 0 : 26;
      h.spin += (goal - h.spin) * Math.min(1, dt * (goal ? 0.9 : 0.5));
      h.rotor.rotation.y += h.spin * dt;
      h.tail.rotation.x += h.spin * 1.6 * dt;
      let pitch = 0, roll = 0;
      if (h.state === 'parked') {
        h.timer -= dt;
        if (h.timer <= 0) {
          if (this.helis.length > wanted) {
            // Fazla helikopter: havalanıp şehirden uzaklaşsın
            h.target = null;
            h.state = 'spinup';
            h.timer = 2.5;
          } else {
            const options = this.pads.filter(p => !this.used(p) && p.pos.distanceTo(o.position) > 2);
            if (options.length) {
              h.target = options[Math.floor(Math.random() * options.length)];
              h.state = 'spinup';
              h.timer = 2.5;
            } else h.timer = 4;
          }
        }
      } else if (h.state === 'spinup') {
        h.timer -= dt;
        if (h.timer <= 0) {
          h.state = 'up';
          h.cruise = Math.max(o.position.y, h.target?.pos.y ?? 0) + 1.6;
          h.pad = null;
        }
      } else if (h.state === 'up') {
        o.position.y += dt * 0.55;
        if (!h.target && this.pads.length >= 2 && this.helis.length <= wanted) {
          const options = this.pads.filter(p => !this.used(p));
          if (options.length) h.target = options[Math.floor(Math.random() * options.length)];
        }
        if (h.target) h.cruise = Math.max(h.cruise, h.target.pos.y + 1.2);
        if (o.position.y >= h.cruise || o.position.y > 12) h.state = 'fly';
      } else if (h.state === 'fly') {
        // Hedef yoksa şehirden uzaklaşıp kaybolur
        const to = h.target ? h.target.pos : new THREE.Vector3(Math.sin(h.heading) * 80, o.position.y, Math.cos(h.heading) * 80);
        const dx = to.x - o.position.x, dz = to.z - o.position.z;
        const dist = Math.hypot(dx, dz);
        const want = Math.atan2(dx, dz);
        let turn = want - h.heading;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        h.heading += turn * Math.min(1, dt * 1.6);
        roll = THREE.MathUtils.clamp(-turn * 0.6, -0.35, 0.35);
        const speed = Math.min(1.6, dist * 0.9 + 0.15);
        pitch = 0.18 * Math.min(1, speed);
        const step = Math.min(dist, speed * dt);
        if (dist > 1e-3) {
          o.position.x += (dx / dist) * step;
          o.position.z += (dz / dist) * step;
        }
        if (h.target) {
          o.position.y += (h.cruise - o.position.y) * Math.min(1, dt);
          if (dist < 0.03) h.state = 'down';
        } else if (dist < 1 || Math.hypot(o.position.x, o.position.z) > 70) {
          this.root.remove(o);
          return false;
        }
      } else if (h.state === 'down') {
        const ty = h.target!.pos.y;
        o.position.y = Math.max(ty, o.position.y - dt * Math.max(0.25, (o.position.y - ty) * 0.8));
        if (o.position.y <= ty + 1e-3) {
          h.pad = h.target;
          h.target = null;
          h.state = 'parked';
          h.timer = 8 + Math.random() * 14;
        }
      }
      o.rotation.set(pitch, h.heading, roll, 'YXZ');
      return true;
    });
  }
}
