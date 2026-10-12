import * as THREE from 'three';

// Hava durumu: arada bir yağmur yağar. Gökyüzü kararır, ışık azalır, yağmur çizgileri düşer.
// Sadece görüntü; oyunu etkilemez.

const DROPS = 1400;
const AREA = 22; // kameranın baktığı yerin çevresinde bu kadar karelik alana yağar
const TOP = 16;
const FALL = 20; // düşme hızı (birim/saniye)
const WIND = 0.12; // çizgilerin eğikliği

export class Weather {
  readonly root = new THREE.Group();
  amount = 0; // 0 = açık hava, 1 = sağanak
  enabled = true; // ayarlardan kapatılabilir
  private target = 0;
  private timer = 70 + Math.random() * 80; // ilk yağmura kadar
  private pos: Float32Array;
  private lines: THREE.LineSegments;
  private mat: THREE.LineBasicMaterial;

  constructor() {
    this.pos = new Float32Array(DROPS * 6);
    for (let k = 0; k < DROPS; k++) {
      const x = (Math.random() - 0.5) * AREA * 2;
      const z = (Math.random() - 0.5) * AREA * 2;
      const y = Math.random() * TOP;
      this.pos.set([x, y, z, x + WIND, y + 0.55, z], k * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: '#dfe9f2', transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.root.add(this.lines);
  }

  get raining() {
    return this.target > 0;
  }

  // Ayarlardan ya da test için yağmuru başlat/durdur
  set(on: boolean) {
    this.target = on ? 1 : 0;
    this.timer = on ? 40 + Math.random() * 40 : 140 + Math.random() * 160;
  }

  update(dt: number, center: THREE.Vector3) {
    this.timer -= dt;
    if (!this.enabled) this.target = 0;
    else if (this.timer <= 0) this.set(!this.raining);
    this.amount += (this.target - this.amount) * Math.min(1, dt * 0.35);
    const visible = this.amount > 0.02;
    this.lines.visible = visible;
    if (!visible) return;
    this.mat.opacity = 0.55 * this.amount;
    this.root.position.set(center.x, 0, center.z);
    const p = this.pos;
    const fall = FALL * dt;
    for (let k = 0; k < DROPS; k++) {
      const o = k * 6;
      let y = p[o + 1] - fall;
      if (y < 0) {
        y += TOP;
        // Yere değince yeni bir yerden tekrar başlasın
        const x = (Math.random() - 0.5) * AREA * 2;
        const z = (Math.random() - 0.5) * AREA * 2;
        p[o] = x;
        p[o + 2] = z;
        p[o + 3] = x + WIND;
        p[o + 5] = z;
      }
      p[o + 1] = y;
      p[o + 4] = y + 0.55;
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
