import * as THREE from 'three';

// Yazılı tabela malzemesi (bina adları). Aynı yazı ve renkteki tabelalar tek malzemeyi paylaşır
// (her binada yeni doku yapılmaz, birleştirilen parçalar da aynı malzemeyle tek seferde çizilir).
const cache = new Map<string, THREE.MeshStandardMaterial>();
export function signMat(text: string, bg: string, fg = '#ffffff') {
  const key = `${text}|${bg}|${fg}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = bg;
  x.fillRect(0, 0, 256, 64);
  x.fillStyle = fg;
  x.font = 'bold 34px Fredoka, Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
  cache.set(key, m);
  return m;
}
