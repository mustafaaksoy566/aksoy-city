import * as THREE from 'three';
import { withSnow } from './season';

// Trafik ışıkları: kavşaklarda kuzey-güney ve doğu-batı yönleri sırayla yeşil yanar.
// Kavşakların yarısı ters sırayla çalışır (hepsi aynı anda değişmesin).
// Arabalar ve yayalar kırmızıda kavşağa girmeden bekler.

export const CYCLE = 6; // bir yönün yeşil kalma süresi (saniye)
const AMBER = 1.2; // değişmeden önceki sarı/kırmızı süre (bu sürede yeni giren olmaz)

let now = 0;
export function setSignalTime(t: number) {
  now = t;
}

// Kavşağın hangi grupta olduğu (0 ya da 1)
export const signalGroup = (tile: number) => ((tile * 7919) >> 3) & 1;

// Bu yöne (0 kuzey, 1 doğu, 2 güney, 3 batı) giden için ışık yeşil mi?
export function isGreen(tile: number, dir: number) {
  const phase = ((now / CYCLE) | 0) + signalGroup(tile);
  const nsGreen = phase % 2 === 0;
  const inPhase = now % CYCLE;
  if (inPhase > CYCLE - AMBER) return false; // sarı: kimse yeni girmesin
  return dir % 2 === 0 ? nsGreen : !nsGreen;
}

// Işık başlıklarının lambaları: hepsi tek malzeme (bölge başına tek çizim; eskiden altı ayrı malzemeydi ve her
// bölgede altı ayrı çizim oluyordu). Lambanın rengi köşe renginde, hangi lamba olduğu (yuva) uv.x'te:
// 0..2 = kuzey-güney kırmızı/sarı/yeşil, 3..5 = doğu-batı. Parlaklıklar her karede SIG_ON'a yazılır.
const SIG_ON = { value: [2.2, 0.05, 0.05, 2.2, 0.05, 0.05] };
export const SIGNAL_LAMP = new THREE.MeshStandardMaterial({ color: '#2a2a2a', vertexColors: true, emissive: '#ffffff', emissiveIntensity: 1 });
SIGNAL_LAMP.name = 'signal';
withSnow(SIGNAL_LAMP, sh => {
  sh.uniforms.uSigOn = SIG_ON;
  sh.vertexShader = 'varying float vSlot;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSlot = uv.x;');
  sh.fragmentShader = 'uniform float uSigOn[6];\nvarying float vSlot;\n' + sh.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
    {
      int slot = int(vSlot + 0.5);
      float on = 0.0;
      for (int i = 0; i < 6; i++) if (i == slot) on = uSigOn[i];
      totalEmissiveRadiance = vColor.rgb * on;
    }`,
  );
});
SIGNAL_LAMP.customProgramCacheKey = () => 'signal-lamp';
const LAMP_COLORS = ['#ff2a2a', '#ffb300', '#2bff6a'].map(c => new THREE.Color(c));
// Lamba geometrisi: renk (0 kırmızı, 1 sarı, 2 yeşil) ve yön (0 kuzey-güney, 1 doğu-batı) içine yazılı
const lampGeos = new Map<number, THREE.BufferGeometry>();
export function signalLampGeo(color: number, axis: number) {
  const slot = axis * 3 + color;
  let g = lampGeos.get(slot);
  if (!g) {
    g = new THREE.SphereGeometry(0.0085, 8, 6);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      LAMP_COLORS[color].toArray(col, k * 3);
      uv[k * 2] = slot;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    lampGeos.set(slot, g);
  }
  return g;
}

// Her karede lambaları güncelle (grup 0 için; grup 1 yuvaları ters kullanır)
export function updateSignals() {
  const phase = (now / CYCLE) | 0;
  const nsGreen = phase % 2 === 0;
  const amber = now % CYCLE > CYCLE - AMBER;
  // index 0: kuzey-güney başlığı (grup 0), index 1: doğu-batı başlığı (grup 0)
  const green = [nsGreen && !amber, !nsGreen && !amber];
  const yellow = [nsGreen && amber, !nsGreen && amber];
  const on = SIG_ON.value;
  for (let k = 0; k < 2; k++) {
    on[k * 3] = green[k] || yellow[k] ? 0.05 : 2.2;
    on[k * 3 + 1] = yellow[k] ? 2.2 : 0.05;
    on[k * 3 + 2] = green[k] ? 2.2 : 0.05;
  }
}
