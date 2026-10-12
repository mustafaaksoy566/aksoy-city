import * as THREE from 'three';
import { heightAt, SKI_RUNS, LODGE as LODGE_AT } from './terrain';
import { part, mat } from './utilities';
import { mergeStatic } from './batcher';

// Aksoy Dağı Kayak Merkezi: dağın eteğinde ahşap dağ evi, zirveye çıkan teleferik (direkler, halatlar,
// hareket eden koltuklar, alt ve üst istasyon) ve pistlerden zikzak çizerek inen kayakçılar.

const BOTTOM = new THREE.Vector2(-45.5, -11.6); // teleferiğin alt istasyonu
const TOP = new THREE.Vector2(-58.6, -7.6); // üst istasyon (zirveye yakın)
const LODGE = new THREE.Vector2(LODGE_AT.x, LODGE_AT.z);
const CABLE_SIDE = 0.22; // halatların hattın ortasından uzaklığı
const CHAIRS = 22;
const SKIERS = 14;

const ground = (x: number, z: number) => heightAt(x, z);

// Dağ evi: taş temel, ahşap duvarlar, karlı dik çatı, balkon, yanan pencereler, baca
function lodge() {
  const g = new THREE.Group();
  const wood = mat('#8a5a36'), dark = mat('#5d3a22'), stone = mat('#9b958a'), snow = mat('#f6f7f9'), trim = mat('#efe6d2');
  const win = new THREE.MeshStandardMaterial({ color: '#ffd58a', emissive: '#000000', roughness: 0.4 });
  win.name = 'window';
  g.add(part(new THREE.BoxGeometry(1.9, 0.14, 1.2), stone, 0, 0.07, 0));
  g.add(part(new THREE.BoxGeometry(1.8, 0.5, 1.1), wood, 0, 0.39, 0));
  // Dik çatı (iki eğimli), üstünde kar
  const roof = new THREE.Shape();
  roof.moveTo(-0.7, 0);
  roof.lineTo(0, 0.55);
  roof.lineTo(0.7, 0);
  roof.lineTo(-0.7, 0);
  const r = new THREE.Mesh(new THREE.ExtrudeGeometry(roof, { depth: 2.0, bevelEnabled: false }), dark);
  r.rotation.y = Math.PI / 2;
  r.position.set(-1.0, 0.63, 0);
  r.castShadow = true;
  g.add(r);
  const s = new THREE.Mesh(new THREE.ExtrudeGeometry(roof, { depth: 2.02, bevelEnabled: false }), snow);
  s.rotation.y = Math.PI / 2;
  s.scale.set(0.96, 0.96, 1);
  s.position.set(-1.01, 0.66, 0);
  g.add(s);
  // Ön cephe: pencereler, kapı, balkon
  for (const x of [-0.6, -0.2, 0.2, 0.6]) {
    g.add(part(new THREE.BoxGeometry(0.2, 0.18, 0.02), win, x, 0.45, 0.56));
    g.add(part(new THREE.BoxGeometry(0.24, 0.025, 0.04), trim, x, 0.35, 0.57));
  }
  g.add(part(new THREE.BoxGeometry(0.24, 0.3, 0.03), dark, 0, 0.29, 0.57));
  g.add(part(new THREE.BoxGeometry(1.8, 0.03, 0.22), dark, 0, 0.63, 0.66));
  g.add(part(new THREE.BoxGeometry(1.8, 0.08, 0.02), trim, 0, 0.69, 0.77));
  g.add(part(new THREE.BoxGeometry(0.12, 0.4, 0.12), stone, 0.6, 1.05, -0.2));
  // Tabela
  const sign = document.createElement('canvas');
  sign.width = 256;
  sign.height = 64;
  const c = sign.getContext('2d')!;
  c.fillStyle = '#5d3a22';
  c.fillRect(0, 0, 256, 64);
  c.fillStyle = '#fff6e0';
  c.font = 'bold 30px Fredoka, Arial, sans-serif';
  c.textAlign = 'center';
  c.fillText('KAYAK MERKEZİ', 128, 43);
  const tex = new THREE.CanvasTexture(sign);
  tex.colorSpace = THREE.SRGBColorSpace;
  g.add(part(new THREE.BoxGeometry(1.0, 0.25, 0.02), new THREE.MeshStandardMaterial({ map: tex }), 0, 0.85, 0.58));
  // Önünde kar, kayak askısı ve bankların yerine birkaç kar topu
  g.add(part(new THREE.BoxGeometry(2.4, 0.03, 1.0), snow, 0, 0.015, 1.05));
  for (let k = 0; k < 5; k++) g.add(part(new THREE.BoxGeometry(0.02, 0.22, 0.04), mat(['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa'][k]), -0.9 + k * 0.06, 0.13, 0.95));
  return g;
}

// İstasyon: beton taban, büyük döner tekerlek, çatı
function station(facing: number) {
  const g = new THREE.Group();
  g.add(part(new THREE.BoxGeometry(0.8, 0.25, 0.9), mat('#d9d4cb'), 0, 0.12, 0));
  g.add(part(new THREE.CylinderGeometry(0.06, 0.08, 0.7, 8), mat('#6b7580'), 0, 0.5, 0));
  g.add(part(new THREE.CylinderGeometry(CABLE_SIDE + 0.03, CABLE_SIDE + 0.03, 0.05, 24), mat('#c62828'), 0, 0.88, 0));
  g.add(part(new THREE.BoxGeometry(0.75, 0.04, 0.85), mat('#37474f'), 0, 1.0, 0));
  g.rotation.y = facing;
  return g;
}

interface Chair {
  s: number; // döngüdeki yer (0..1)
  rider: boolean;
  obj: THREE.Group;
}
interface Skier {
  run: number;
  s: number;
  speed: number;
  phase: number;
  obj: THREE.Group;
}

const JACKETS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#ff7043', '#00acc1', '#f06292'];

// Küçük insan: mont, kask, pantolon; kayakçıysa kayak ve batonlar
function person(color: string, skis: boolean) {
  const g = new THREE.Group();
  const jacket = mat(color), pants = mat('#263238'), skin = mat('#f1c27d'), helmet = mat('#fafafa');
  g.add(part(new THREE.BoxGeometry(0.018, 0.05, 0.018), pants, -0.01, 0.025, 0));
  g.add(part(new THREE.BoxGeometry(0.018, 0.05, 0.018), pants, 0.01, 0.025, 0));
  g.add(part(new THREE.BoxGeometry(0.04, 0.05, 0.026), jacket, 0, 0.075, 0));
  g.add(part(new THREE.SphereGeometry(0.014, 8, 6), skin, 0, 0.112, 0));
  g.add(part(new THREE.SphereGeometry(0.016, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), helmet, 0, 0.114, 0));
  if (skis) {
    for (const x of [-0.012, 0.012]) g.add(part(new THREE.BoxGeometry(0.008, 0.004, 0.11), mat('#212121'), x, 0.002, 0.01));
    for (const x of [-0.03, 0.03]) {
      const pole = part(new THREE.CylinderGeometry(0.0015, 0.0015, 0.08, 4), mat('#90a4ae'), x, 0.05, -0.01);
      pole.rotation.x = -0.4;
      g.add(pole);
    }
  }
  return g;
}

export class SkiResort {
  readonly root = new THREE.Group();
  private chairs: Chair[] = [];
  private skiers: Skier[] = [];
  private loop: THREE.Vector3[] = []; // koltukların döngüsü: yukarı çıkan halat, sonra aşağı inen
  private loopLen: number[] = [0];
  private time = 0;

  init() {
    const st: THREE.Object3D[] = [];
    // Dağ evi
    const l = lodge();
    l.position.set(LODGE.x, ground(LODGE.x, LODGE.y) - 0.02, LODGE.y);
    l.rotation.y = Math.atan2(1, 0.15);
    st.push(l);
    // Teleferik hattı: direkler ve halatlar
    const dir = TOP.clone().sub(BOTTOM);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector2(-dir.y, dir.x);
    const heading = Math.atan2(dir.x, dir.y);
    const n = Math.max(3, Math.round(len / 2.2));
    const heads: THREE.Vector3[] = [];
    for (let k = 0; k <= n; k++) {
      const p = BOTTOM.clone().addScaledVector(dir, (len * k) / n);
      const y = ground(p.x, p.y);
      const end = k === 0 || k === n;
      const h = end ? 0.9 : 1.15;
      heads.push(new THREE.Vector3(p.x, y + h, p.y));
      if (end) {
        const s = station(heading);
        s.position.set(p.x, y - 0.02, p.y);
        st.push(s);
      } else {
        const tower = new THREE.Group();
        tower.add(part(new THREE.CylinderGeometry(0.035, 0.05, h, 8), mat('#78909c'), 0, h / 2, 0));
        const arm = part(new THREE.BoxGeometry(CABLE_SIDE * 2 + 0.1, 0.03, 0.04), mat('#546e7a'), 0, h, 0);
        tower.add(arm);
        tower.position.set(p.x, y, p.y);
        tower.rotation.y = heading + Math.PI / 2;
        st.push(tower);
      }
    }
    const cableMat = mat('#37474f');
    for (const s of [-1, 1]) {
      for (let k = 0; k < heads.length - 1; k++) {
        const a = heads[k].clone().add(new THREE.Vector3(side.x * s * CABLE_SIDE, 0, side.y * s * CABLE_SIDE));
        const b = heads[k + 1].clone().add(new THREE.Vector3(side.x * s * CABLE_SIDE, 0, side.y * s * CABLE_SIDE));
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, a.distanceTo(b), 4), cableMat);
        c.position.copy(a).add(b).multiplyScalar(0.5);
        c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        st.push(c);
      }
    }
    this.root.add(mergeStatic(st));
    // Koltukların döngüsü: sağ halattan yukarı, sol halattan aşağı
    const up = heads.map(h => h.clone().add(new THREE.Vector3(side.x * CABLE_SIDE, 0, side.y * CABLE_SIDE)));
    const down = [...heads].reverse().map(h => h.clone().add(new THREE.Vector3(-side.x * CABLE_SIDE, 0, -side.y * CABLE_SIDE)));
    this.loop = [...up, ...down, up[0]];
    for (let k = 1; k < this.loop.length; k++) this.loopLen.push(this.loopLen[k - 1] + this.loop[k].distanceTo(this.loop[k - 1]));
    // Koltuklar: askı, oturak, sırtlık; bazılarında kayakçı
    for (let k = 0; k < CHAIRS; k++) {
      const obj = new THREE.Group();
      obj.add(part(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4), mat('#455a64'), 0, -0.06, 0));
      obj.add(part(new THREE.BoxGeometry(0.1, 0.012, 0.05), mat('#263238'), 0, -0.125, 0));
      obj.add(part(new THREE.BoxGeometry(0.1, 0.05, 0.01), mat('#263238'), 0, -0.1, -0.025));
      const rider = Math.random() < 0.6 && k % 2 === 0;
      if (rider) {
        const p = person(JACKETS[k % JACKETS.length], false);
        p.position.set(0, -0.17, 0.005);
        p.scale.setScalar(0.9);
        obj.add(p);
      }
      this.root.add(obj);
      this.chairs.push({ s: k / CHAIRS, rider, obj });
    }
    // Kayakçılar
    for (let k = 0; k < SKIERS; k++) {
      const obj = person(JACKETS[(k * 3) % JACKETS.length], true);
      this.root.add(obj);
      this.skiers.push({ run: k % SKI_RUNS.length, s: Math.random(), speed: 0.55 + Math.random() * 0.45, phase: Math.random() * 6, obj });
    }
  }

  private loopAt(s: number, out: THREE.Vector3) {
    const total = this.loopLen[this.loopLen.length - 1];
    const d = (s % 1) * total;
    let k = 1;
    while (k < this.loopLen.length - 1 && this.loopLen[k] < d) k++;
    const a = this.loop[k - 1], b = this.loop[k];
    const t = (d - this.loopLen[k - 1]) / Math.max(1e-6, this.loopLen[k] - this.loopLen[k - 1]);
    out.lerpVectors(a, b, t);
    // Halat iki direk arasında biraz sarkar
    out.y -= Math.sin(t * Math.PI) * 0.08;
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  update(dt: number) {
    if (!this.loop.length) return;
    this.time += dt;
    const total = this.loopLen[this.loopLen.length - 1];
    for (const c of this.chairs) {
      c.s = (c.s + (dt * 0.35) / total) % 1;
      const h = this.loopAt(c.s, c.obj.position);
      c.obj.rotation.y = h;
    }
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    for (const sk of this.skiers) {
      const run = SKI_RUNS[sk.run];
      const pts = run.pts;
      // Pistin uzunluğu boyunca ilerle, bitince tepeden yeniden başla
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      sk.s += (dt * sk.speed) / len;
      if (sk.s >= 1) {
        sk.s = 0;
        sk.run = Math.floor(Math.random() * SKI_RUNS.length);
      }
      const at = (s: number, out: THREE.Vector3) => {
        let d = s * len;
        for (let k = 1; k < pts.length; k++) {
          const seg = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
          if (d <= seg || k === pts.length - 1) {
            const t = Math.min(1, d / seg);
            return out.set(pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t, 0, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t);
          }
          d -= seg;
        }
        return out;
      };
      at(sk.s, p);
      at(Math.min(1, sk.s + 0.01), q);
      const fx = q.x - p.x, fz = q.z - p.z;
      const fl = Math.hypot(fx, fz) || 1;
      // Zikzak: pistin içinde sağa sola
      const swing = Math.sin(this.time * 1.6 + sk.phase) * run.w * 0.32;
      p.x += (-fz / fl) * swing;
      p.z += (fx / fl) * swing;
      sk.obj.position.set(p.x, ground(p.x, p.z) + 0.01, p.z);
      const turn = Math.cos(this.time * 1.6 + sk.phase);
      sk.obj.rotation.set(0, Math.atan2(fx, fz) + turn * 0.5, -turn * 0.25, 'YXZ');
    }
  }
}
