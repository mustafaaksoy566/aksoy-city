import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const models = new Map<string, THREE.Object3D>();

// Kenney modellerini bir kere yükle, sonra kopyalarını kullan
export async function loadModels(names: string[]) {
  const loader = new GLTFLoader();
  await Promise.all(
    names.map(async name => {
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}kenney/models/${name}.glb`);
      gltf.scene.traverse(o => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      models.set(name, gltf.scene);
    }),
  );
}

export function makeModel(name: string): THREE.Object3D {
  const m = models.get(name);
  if (!m) throw new Error(`Model yüklenmedi: ${name}`);
  return m.clone(true);
}
