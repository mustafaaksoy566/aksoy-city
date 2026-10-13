import * as THREE from 'three';
import { TREE_MODELS } from './trees';
import { TOWER_MODELS } from './towers';
import { ROAD_KIT } from './roads';
import { PROP_MODELS } from './props';

export { ROAD_COLORS } from './roads';

// Bütün modeller kodla çizilir (dışarıdan model dosyası yok): ağaçlar, evler ve gökdelenler, yol parçaları,
// sokak eşyaları. Her model bir kere çizilir, sonra kopyaları kullanılır.
const PROC = (path: string) => TREE_MODELS[path] ?? TOWER_MODELS[path] ?? ROAD_KIT[path] ?? PROP_MODELS[path];

const models = new Map<string, THREE.Object3D>();

export async function loadModels(paths: string[], onProgress?: (done: number, total: number) => void) {
  let done = 0;
  for (const path of paths) {
    const build = PROC(path);
    if (!build) throw new Error(`Model yok: ${path}`);
    if (!models.has(path)) models.set(path, build());
    onProgress?.(++done, paths.length);
    // Yükleme çubuğu ilerlesin diye arada bir tarayıcıya nefes aldır
    if (done % 8 === 0) await new Promise(r => setTimeout(r, 0));
  }
}

// Modelin bir kopyasını ver
export function makeModel(path: string): THREE.Object3D {
  let m = models.get(path);
  if (!m) {
    // Önceden yüklenmemiş kodla çizilen model: şimdi çiz
    const build = PROC(path);
    if (!build) throw new Error(`Model yüklenmedi: ${path}`);
    m = build();
    models.set(path, m);
  }
  return m.clone(true);
}
