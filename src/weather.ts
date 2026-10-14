import * as THREE from 'three';

// Hava durumu: arada bir yağmur yağar; kışın yağmur yerine kar yağar (mevsim main.ts'ten gelir).
// Gökyüzü kararır, ışık azalır, yağmur çizgileri ya da kar taneleri düşer. Sadece görüntü; oyunu etkilemez
// (kar örtüsü season.ts'te, yağan karla birikir).

const DROPS = 1400;
const FLAKES = 1800;
const AREA = 22; // kameranın baktığı yerin çevresinde bu kadar karelik alana yağar
const TOP = 16;
const FALL = 20; // yağmurun düşme hızı (birim/saniye)
const SNOW_FALL = 1.6; // kar tanesinin düşme hızı
const WIND = 0.12; // çizgilerin eğikliği

// Yumuşak kenarlı yuvarlak kar tanesi
function flakeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Weather {
  readonly root = new THREE.Group();
  amount = 0; // 0 = açık hava, 1 = sağanak ya da yoğun kar
  enabled = true; // ayarlardan kapatılabilir
  winter = false; // kışsa yağış kar olur
  snowing = false; // şu anki yağış kar mı
  private target = 0;
  private timer = 70 + Math.random() * 80; // ilk yağışa kadar
  private pos: Float32Array;
  private lines: THREE.LineSegments;
  private mat: THREE.LineBasicMaterial;
  private flakePos: Float32Array;
  private flakeSeed: Float32Array;
  private flakes: THREE.Points;
  private flakeMat: THREE.PointsMaterial;
  private t = 0;

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
    // Kar taneleri: yavaşça, sağa sola salınarak düşer
    this.flakePos = new Float32Array(FLAKES * 3);
    this.flakeSeed = new Float32Array(FLAKES);
    for (let k = 0; k < FLAKES; k++) {
      this.flakePos.set([(Math.random() - 0.5) * AREA * 2, Math.random() * TOP, (Math.random() - 0.5) * AREA * 2], k * 3);
      this.flakeSeed[k] = Math.random() * 100;
    }
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.BufferAttribute(this.flakePos, 3));
    this.flakeMat = new THREE.PointsMaterial({ color: '#ffffff', map: flakeTexture(), size: 0.12, transparent: true, opacity: 0, depthWrite: false });
    this.flakes = new THREE.Points(fgeo, this.flakeMat);
    this.flakes.frustumCulled = false;
    this.flakes.visible = false;
    this.root.add(this.flakes);
  }

  get raining() {
    return this.target > 0;
  }

  // Ayarlardan ya da test için yağışı başlat/durdur (kışın kar, yoksa yağmur). Kışın kar daha sık yağar.
  set(on: boolean) {
    this.target = on ? 1 : 0;
    if (on) this.snowing = this.winter;
    this.timer = on ? (this.winter ? 50 + Math.random() * 40 : 40 + Math.random() * 40) : this.winter ? 40 + Math.random() * 50 : 140 + Math.random() * 160;
  }

  update(dt: number, center: THREE.Vector3) {
    this.timer -= dt;
    this.t += dt;
    if (!this.enabled) this.target = 0;
    else if (this.timer <= 0) this.set(!this.raining);
    this.amount += (this.target - this.amount) * Math.min(1, dt * 0.35);
    const visible = this.amount > 0.02;
    this.lines.visible = visible && !this.snowing;
    this.flakes.visible = visible && this.snowing;
    if (!visible) return;
    this.root.position.set(center.x, 0, center.z);
    if (this.snowing) this.updateSnow(dt);
    else this.updateRain(dt);
  }

  private updateRain(dt: number) {
    this.mat.opacity = 0.55 * this.amount;
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

  private updateSnow(dt: number) {
    this.flakeMat.opacity = 0.95 * this.amount;
    const p = this.flakePos;
    const t = this.t;
    for (let k = 0; k < FLAKES; k++) {
      const o = k * 3;
      const s = this.flakeSeed[k];
      let y = p[o + 1] - SNOW_FALL * (0.7 + (s % 1) * 0.6) * dt;
      if (y < 0) {
        y += TOP;
        p[o] = (Math.random() - 0.5) * AREA * 2;
        p[o + 2] = (Math.random() - 0.5) * AREA * 2;
      }
      p[o] += (Math.sin(t * 0.9 + s) * 0.35 + 0.15) * dt;
      p[o + 2] += Math.cos(t * 0.7 + s * 1.3) * 0.25 * dt;
      p[o + 1] = y;
    }
    (this.flakes.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
