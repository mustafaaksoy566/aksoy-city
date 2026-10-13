import * as THREE from 'three';
import { pm, box, add } from './parts';

// Arabayla gidilen binaların kendi otoparkı ve kapısı (SimCity'deki gibi): araba binanın önündeki park yerine
// park eder, sürücü inip yürüyerek kapıdan girer; işi bitince kapıdan çıkıp arabasına yürür ve yola çıkar.
// Ölçüler dünya ölçüsünde (1 kare = 1 birim; büyük binada da arabalar ve insanlar şehirdekiyle aynı boyda),
// binanın kendi düzleminde: kapladığı alanın ortası 0,0, ön yüz +z (yola bakar). Park eden arabanın burnu binaya
// (-z) bakar. Modeller bu tanımla çizer (çizgiler, kapı), trafik arabaları aynı yerlere koyar.

export interface SiteBay {
  x: number;
  z: number; // park yerinin ortası
  truck?: boolean; // kamyon yükleme yeri (daha geniş, sarı çizgili)
  fleet?: 'police' | 'ambulance' | 'truck' | 'garbage'; // binanın kendi aracının yeri (başta araç park etmiş gelir)
}
export interface Site {
  n: number; // kapladığı alan n x n kare
  bays: SiteBay[];
  door: [number, number]; // giriş kapısı (x, z); insanlar buradan -z yönünde içeri girer
  walk: number; // binanın önündeki yaya yolunun z'si: arabadan kapıya bu yoldan yürünür
  garages?: [number, number][]; // itfaiye: araçların girip çıktığı açık garaj kapıları
}

export const BAY_W = 0.2, BAY_D = 0.34; // araba park yeri (araba 0.13 x 0.28)
export const TRUCK_W = 0.24, TRUCK_D = 0.42; // kamyon yeri (kamyon 0.14 x 0.35)

// 2x2 dükkânın önünde sekiz park yeri, ortada kapıya giden yaya yolu
const ROW = [-0.77, -0.57, -0.37, -0.17, 0.17, 0.37, 0.57, 0.77];
const shop = (doorZ: number): Site => ({ n: 2, bays: ROW.map(x => ({ x, z: 0.27 })), door: [0, doorZ], walk: 0.04 });

export const SITES: Record<string, Site> = {
  store: shop(-0.04),
  market: shop(-0.2),
  furniture: shop(-0.04),
  bakery: shop(-0.04),
  fashion: shop(-0.04),
  garden: shop(-0.2),
  cafe: shop(-0.35),
  electro: shop(-0.04),
  // Fabrika: holün üç yükleme kapısının önünde kamyon yerleri, ofisin önünde çalışanların park yerleri
  factory: {
    n: 2,
    bays: [
      { x: -0.72, z: 0.21, truck: true, fleet: 'truck' }, { x: -0.42, z: 0.21, truck: true }, { x: -0.12, z: 0.21, truck: true },
      { x: 0.25, z: 0.25 }, { x: 0.45, z: 0.25 }, { x: 0.65, z: 0.25 }, { x: 0.85, z: 0.25 },
    ],
    door: [0.66, -0.06],
    walk: -0.01,
  },
  // Depo: üç yükleme kapısının önünde kamyon yerleri (biri deponun kamyonu, biri çöp kamyonu)
  depot: {
    n: 1,
    bays: [{ x: -0.25, z: 0.24, truck: true, fleet: 'truck' }, { x: 0, z: 0.24, truck: true }, { x: 0.25, z: 0.24, truck: true, fleet: 'garbage' }],
    door: [0.39, -0.02],
    walk: 0.0,
  },
  // Karakol: iki polis arabası ve bir ziyaretçi yeri
  police: {
    n: 1,
    bays: [{ x: -0.02, z: 0.27, fleet: 'police' }, { x: 0.18, z: 0.27, fleet: 'police' }, { x: 0.38, z: 0.27 }],
    door: [-0.3, -0.08],
    walk: 0.03,
  },
  // İtfaiye: araçlar açık garaj kapılarından girip çıkar; çalışanlar yürüyerek gelir
  fire: { n: 1, bays: [], door: [0.29, 0.09], walk: 0.14, garages: [[-0.2, 0.095], [0.08, 0.095]] },
  // Hastane: ana girişin iki yanında ziyaretçi yerleri, acil girişinin önünde iki ambulans yeri
  health: {
    n: 2,
    bays: [
      { x: -0.84, z: 0.27 }, { x: -0.64, z: 0.27 }, { x: -0.16, z: 0.27 }, { x: 0.04, z: 0.27 },
      { x: 0.44, z: 0.27, fleet: 'ambulance' }, { x: 0.66, z: 0.27, fleet: 'ambulance' }, { x: 0.87, z: 0.27 },
    ],
    door: [-0.4, -0.3],
    walk: 0.03,
  },
  // Okul: önde öğretmenlerin otoparkı (sağda koşu pisti)
  school: {
    n: 2,
    bays: [{ x: -0.82, z: 0.27 }, { x: -0.62, z: 0.27 }, { x: -0.17, z: 0.27 }, { x: 0.03, z: 0.27 }],
    door: [-0.37, -0.48],
    walk: 0.03,
  },
};

// Bu bina kendi otoparklı haliyle mi duruyor? (eski kayıtlardaki 1x1 dükkânların otoparkı yok)
export function siteOf(kind: string, fp: number | undefined): Site | null {
  const s = SITES[kind];
  return s && s.n === (fp ?? 1) ? s : null;
}

// --- Çizim yardımcıları (dünya ölçüsünde, binanın düzleminde) ---
const ASPHALT = pm('#4b5058', 0.95);
const WHITE_LINE = pm('#f4f4f0', 0.7);
const YELLOW_LINE = pm('#f2c14e', 0.6);
const WHEEL_STOP = pm('#c9c4b8', 0.9);
const POLICE_MARK = pm('#1e4fa3', 0.7);
const RED_MARK = pm('#d32f2f', 0.7);

// Otoparkın asfaltı (x0..x1, z0..z1) ve park yerlerinin çizgileri: her yerin iki yanında çizgi, burun tarafında
// tekerlek takozu; kamyon yerleri sarı; polis ve ambulans yerlerinde yerde renkli işaret.
export function drawLot(g: THREE.Object3D, site: Site, x0: number, x1: number, z0: number, z1: number) {
  box(g, x1 - x0, 0.004, z1 - z0, ASPHALT, (x0 + x1) / 2, 0.03, (z0 + z1) / 2);
  paintBays(g, site);
}
export function paintBays(g: THREE.Object3D, site: Site) {
  for (const b of site.bays) {
    const w = b.truck ? TRUCK_W : BAY_W, d = b.truck ? TRUCK_D : BAY_D;
    const line = b.truck ? YELLOW_LINE : WHITE_LINE;
    for (const s of [-1, 1]) box(g, 0.01, 0.0012, d, line, b.x + (s * w) / 2, 0.034, b.z);
    // Tekerlek takozu: burnun (binanın) tarafında
    box(g, w * 0.55, 0.01, 0.018, WHEEL_STOP, b.x, 0.034, b.z - d / 2 + 0.035);
    if (b.fleet === 'police' || b.fleet === 'ambulance') {
      // Yerde dikdörtgen işaret: polis mavi, ambulans kırmızı haç
      const m = b.fleet === 'police' ? POLICE_MARK : RED_MARK;
      if (b.fleet === 'ambulance') {
        box(g, 0.08, 0.0012, 0.025, m, b.x, 0.034, b.z + d / 2 - 0.05);
        box(g, 0.025, 0.0012, 0.08, m, b.x, 0.034, b.z + d / 2 - 0.05);
      } else box(g, w - 0.04, 0.0012, 0.02, m, b.x, 0.034, b.z + d / 2 - 0.03);
    }
  }
}
// Kapı (yüzü +z, x ortası, z binanın ön yüzü): çerçeve, koyu camlı iki kanat, kulplar, önünde paspas.
// İnsanlar kanatların arkasına geçince kaybolur (içeri girmiş olur).
const DOOR_DARK = pm('#22303c', 0.25, 0.4);
const HANDLE = pm('#d5dbe1', 0.3, 0.6);
const DOORMAT = pm('#4e4e4e', 1);
export function entrance(g: THREE.Object3D, x: number, z: number, w: number, h: number, frame: THREE.Material) {
  box(g, w + 0.024, h + 0.014, 0.012, frame, x, 0.03, z - 0.004);
  box(g, w, h, 0.006, DOOR_DARK, x, 0.03, z + 0.005);
  for (const s of [-1, 1]) box(g, 0.004, h * 0.6, 0.006, HANDLE, x + s * 0.012, 0.03 + h * 0.2, z + 0.007);
  box(g, w * 0.9, 0.002, 0.05, DOORMAT, x, 0.03, z + 0.035);
}

// Otopark aydınlatma direği: iki kollu, gece yanan lambalar
const POLE = pm('#4a5562', 0.5, 0.4);
const LAMP = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff3c4', emissiveIntensity: 0 });
LAMP.name = 'lamp';
export function lotLight(g: THREE.Object3D, x: number, z: number, h = 0.36) {
  add(g, new THREE.CylinderGeometry(0.006, 0.009, h, 6), POLE, x, 0.03 + h / 2, z);
  for (const s of [-1, 1]) {
    box(g, 0.07, 0.006, 0.008, POLE, x + s * 0.035, 0.03 + h - 0.006, z);
    box(g, 0.04, 0.008, 0.02, LAMP, x + s * 0.06, 0.03 + h - 0.014, z);
  }
}

// Binanın düzlemindeki bir nokta dünyada nerede: ox, oz kapladığı alanın ortası, turns FACING_TURNS'den
export function siteToWorld(ox: number, oz: number, turns: number, x: number, z: number, out = new THREE.Vector3()) {
  const a = (turns * Math.PI) / 2;
  const c = Math.cos(a), s = Math.sin(a);
  return out.set(ox + x * c + z * s, 0, oz - x * s + z * c);
}
