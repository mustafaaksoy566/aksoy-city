import * as THREE from 'three';

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

// Işık başlıklarının lambaları: grup ve yöne göre dört malzeme (kırmızı/yeşil x kuzey-güney/doğu-batı).
// İlk parlaklık sıfır değil ki birleştirilmesinler (her karede yanıp sönmeleri gerekiyor).
const lamp = (color: string) => new THREE.MeshStandardMaterial({ color: '#222', emissive: color, emissiveIntensity: 1 });
export const SIGNAL_MATS = {
  red: [lamp('#ff2a2a'), lamp('#ff2a2a')], // [kuzey-güney yeşilken kırmızı yanan, doğu-batı ...]
  green: [lamp('#2bff6a'), lamp('#2bff6a')],
};

// Her karede lambaları güncelle (grup 0 için; grup 1 malzemeleri ters kullanır)
export function updateSignals() {
  const phase = (now / CYCLE) | 0;
  const nsGreen = phase % 2 === 0;
  const amber = now % CYCLE > CYCLE - AMBER;
  // index 0: kuzey-güney başlığı (grup 0), index 1: doğu-batı başlığı (grup 0)
  const green = [nsGreen && !amber, !nsGreen && !amber];
  for (let k = 0; k < 2; k++) {
    SIGNAL_MATS.green[k].emissiveIntensity = green[k] ? 2.2 : 0.05;
    SIGNAL_MATS.red[k].emissiveIntensity = green[k] ? 0.05 : 2.2;
  }
}
