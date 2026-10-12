import * as THREE from 'three';

// Gece-gündüz: bir tam döngü CYCLE_DAYS oyun günü sürer.
// Gece olunca ışık azalır, gökyüzü kararır, pencereler ve araba farları yanar.
export const CYCLE_DAYS = 30;

const SKY_DAY = new THREE.Color('#9fd8f0');
const SKY_DUSK = new THREE.Color('#f4a26b');
const SKY_NIGHT = new THREE.Color('#16223f');
const SUN_DAY = new THREE.Color('#fff6e0');
const SUN_DUSK = new THREE.Color('#ffae6b');
const WINDOW_GLOW = new THREE.Color('#ffd27a');
const LIGHT_GLOW = new THREE.Color('#fff2c0');

const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

// Günün saatine (0..1) göre: gece ne kadar (0..1) ve gün batımı ne kadar (0..1)
export function phase(tod: number) {
  const night = smooth(0.62, 0.74, tod) * (1 - smooth(0.9, 0.99, tod));
  const dusk = Math.max(0, 1 - Math.abs(tod - 0.68) / 0.07) + Math.max(0, 1 - Math.abs(tod - 0.945) / 0.05);
  return { night, dusk: Math.min(1, dusk) };
}

export class DayNight {
  private glowing = new Set<THREE.MeshStandardMaterial>();
  private lights = new Set<THREE.MeshStandardMaterial>();
  private scanTimer = 0;
  private lastNight = -1;

  constructor(
    private scene: THREE.Scene,
    private hemi: THREE.HemisphereLight,
    private sun: THREE.DirectionalLight,
  ) {}

  // Sahnedeki pencere ve far malzemelerini bul (yeni binalar eklendikçe ara ara tekrar bakılır)
  private scan() {
    this.scene.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || !(o as THREE.Mesh).isMesh || !('emissive' in m)) return;
      if (m.name === 'window') this.glowing.add(m);
      else if (/headlight/i.test(m.name)) this.lights.add(m);
    });
  }

  update(tod: number, dt: number) {
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 2;
      this.scan();
      this.lastNight = -1;
    }
    const { night, dusk } = phase(tod);
    const sky = this.scene.background as THREE.Color;
    sky.copy(SKY_DAY).lerp(SKY_DUSK, dusk * 0.6).lerp(SKY_NIGHT, night);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.sun.intensity = THREE.MathUtils.lerp(2.2, 0.25, night);
    this.sun.color.copy(SUN_DAY).lerp(SUN_DUSK, dusk);
    this.hemi.intensity = THREE.MathUtils.lerp(1.6, 0.5, night);
    // Pencereler yalnızca gece değeri belirgin değiştiğinde güncellensin
    if (Math.abs(night - this.lastNight) > 0.02) {
      this.lastNight = night;
      for (const m of this.glowing) {
        m.emissive.copy(WINDOW_GLOW);
        m.emissiveIntensity = night * 0.5;
      }
      for (const m of this.lights) {
        m.emissive.copy(LIGHT_GLOW);
        m.emissiveIntensity = night * 2;
      }
    }
  }
}
