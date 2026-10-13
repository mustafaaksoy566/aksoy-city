import * as THREE from 'three';
import { DAY_STEPS } from './config';

// Gece-gündüz: bir tam döngü CYCLE_DAYS oyun günü sürer.
// Gece olunca ışık azalır, gökyüzü kararır, pencereler ve araba farları yanar.
export const CYCLE_DAYS = DAY_STEPS;

const SKY_DAY = new THREE.Color('#9fd8f0');
const SKY_DUSK = new THREE.Color('#f4a26b');
const SKY_NIGHT = new THREE.Color('#16223f');
const SKY_RAIN = new THREE.Color('#8d99a6');
const TOP_DAY = new THREE.Color('#3f8fe0');
const TOP_NIGHT = new THREE.Color('#060b1e');

// Gökyüzü kubbesi: ufuktan tepeye renk geçişi (kameranın etrafında durur)
function makeDome() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, pow(smoothstep(0.0, 0.65, h), 0.7)), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  return dome;
}
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
  // Gece görünen ışık haleleri ve yerdeki ışık havuzları (saydam, ışık ekleyen); userData.base: en parlak hâli
  private halos = new Set<THREE.Material>();
  private scanTimer = 0;
  private lastNight = -1;
  readonly dome = makeDome();

  constructor(
    private scene: THREE.Scene,
    private hemi: THREE.HemisphereLight,
    private sun: THREE.DirectionalLight,
  ) {}

  // Sahnedeki pencere ve far malzemelerini bul (yeni binalar eklendikçe ara ara tekrar bakılır)
  private scan() {
    this.scene.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && (o as THREE.Mesh).isMesh && m.name === 'glow') this.halos.add(m);
      if (!m || !(o as THREE.Mesh).isMesh || !('emissive' in m)) return;
      if (m.name === 'window') this.glowing.add(m);
      else if (m.name === 'lamp') this.lights.add(m);
      else if (/headlight/i.test(m.name)) this.lights.add(m);
    });
  }

  // gloom: yağmurun şiddeti (0..1); gökyüzü grileşir, güneş zayıflar
  update(tod: number, dt: number, gloom = 0) {
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 2;
      this.scan();
      this.lastNight = -1;
    }
    const { night, dusk } = phase(tod);
    const sky = this.scene.background as THREE.Color;
    sky.copy(SKY_DAY).lerp(SKY_DUSK, dusk * 0.6).lerp(SKY_RAIN, gloom * 0.75).lerp(SKY_NIGHT, night);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    const u = (this.dome.material as THREE.ShaderMaterial).uniforms;
    u.horizon.value.copy(sky);
    u.top.value.copy(TOP_DAY).lerp(SKY_RAIN, gloom * 0.7).lerp(SKY_DUSK, dusk * 0.25).lerp(TOP_NIGHT, night);
    this.sun.intensity = THREE.MathUtils.lerp(2.2, 0.25, night) * (1 - 0.5 * gloom);
    this.sun.color.copy(SUN_DAY).lerp(SUN_DUSK, dusk);
    this.hemi.intensity = THREE.MathUtils.lerp(1.0, 0.35, night) * (1 - 0.2 * gloom);
    // Ortam yansıması da gece kısılsın (yoksa gece aydınlık kalıyor)
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.55, 0.1, night);
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
      for (const m of this.halos) {
        m.opacity = night * ((m.userData.base as number | undefined) ?? 0.6);
        m.visible = night > 0.03;
      }
    }
  }
}
