import * as THREE from 'three';

// Geceleri lunapark, stadyum ve dönme dolabın üstünde havai fişekler patlar
const COLORS = ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb', '#ffab40', '#ffffff'];
const SPARKS = 70;
const LIFE = 1.8;

// Yuvarlak, ortası parlak kıvılcım dokusu
function sparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const SPARK = sparkTexture();

interface Burst {
  points: THREE.Points;
  vel: Float32Array;
  age: number;
}

export class Fireworks {
  readonly root = new THREE.Group();
  private bursts: Burst[] = [];
  private timer = 2;

  // night: gece ne kadar (0..1), spots: patlayabilecekleri yerler
  update(dt: number, night: number, spots: THREE.Vector3[]) {
    this.timer -= dt;
    if (night > 0.7 && spots.length && this.timer <= 0 && this.bursts.length < 4) {
      this.timer = 0.6 + Math.random() * 2.2;
      const s = spots[Math.floor(Math.random() * spots.length)];
      this.spawn(new THREE.Vector3(s.x + (Math.random() - 0.5) * 3, 6 + Math.random() * 4, s.z + (Math.random() - 0.5) * 3));
    }
    this.bursts = this.bursts.filter(b => {
      b.age += dt;
      const pos = b.points.geometry.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      for (let k = 0; k < SPARKS; k++) {
        b.vel[k * 3 + 1] -= 2.2 * dt; // yerçekimi
        for (let j = 0; j < 3; j++) {
          b.vel[k * 3 + j] *= 1 - dt * 0.9; // hava direnci
          a[k * 3 + j] += b.vel[k * 3 + j] * dt;
        }
      }
      pos.needsUpdate = true;
      const m = b.points.material as THREE.PointsMaterial;
      m.opacity = Math.max(0, 1 - b.age / LIFE);
      if (b.age < LIFE) return true;
      this.root.remove(b.points);
      b.points.geometry.dispose();
      m.dispose();
      return false;
    });
  }

  private spawn(at: THREE.Vector3) {
    const pos = new Float32Array(SPARKS * 3);
    const vel = new Float32Array(SPARKS * 3);
    const speed = 3 + Math.random() * 2;
    for (let k = 0; k < SPARKS; k++) {
      // Kürenin üstünde eşit dağılım
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      vel.set([Math.cos(t) * r * speed, u * speed, Math.sin(t) * r * speed], k * 3);
      pos.set([at.x, at.y, at.z], k * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 0.32,
      map: SPARK,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.root.add(points);
    this.bursts.push({ points, vel, age: 0 });
  }
}
