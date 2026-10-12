import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const models = new Map<string, THREE.Object3D>();
// Aynı klasördeki modeller aynı doku atlasını kullanır; tek malzemede birleştirilir ki çizim sayısı azalsın
const atlasMats = new Map<string, THREE.Material>();
export const KAYKIT_SCALE = 0.5; // KayKit parçaları 2x2 birim, oyunda 1 kare
const tinted = new Map<string, THREE.Material>();

const BUILDING_FIT = 0.86; // ticari binalar karenin bu kadarını kaplasın
const BUILDING_MAX_SCALE = 1.4;

// Modeli bir kutuya sığdırıp ortala; tabanı y=0'a otursun
function normalize(obj: THREE.Object3D, turn: number, scaleFor: (size: THREE.Vector3) => number) {
  const pivot = new THREE.Group();
  pivot.add(obj);
  obj.rotation.y = turn;
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = scaleFor(size);
  obj.scale.setScalar(s);
  obj.position.set(-center.x * s, -box.min.y * s, -center.z * s);
  return pivot;
}

// Modelleri bir kere yükle, sonra kopyalarını kullan
export async function loadModels(paths: string[]) {
  const loader = new GLTFLoader();
  await Promise.all(
    paths.map(async path => {
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${path}${path.startsWith('kaykit/') ? '.gltf' : '.glb'}`);
      let obj: THREE.Object3D = gltf.scene;
      const folder = path.slice(0, path.lastIndexOf('/'));
      obj.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.map) {
          const key = `${folder}|${mat.name}`;
          if (!atlasMats.has(key)) atlasMats.set(key, mat);
          mesh.material = atlasMats.get(key)!;
        }
      });
      if (path.startsWith('kaykit/')) {
        const g = new THREE.Group();
        obj.scale.setScalar(KAYKIT_SCALE);
        g.add(obj);
        obj = g;
      } else if (path.startsWith('kenney-sub/')) {
        obj = normalize(obj, 0, s => 0.36 / Math.max(s.x, s.z));
      } else if (path.startsWith('polypizza/extra/') || path.startsWith('kenney2/')) {
        obj = normalize(obj, 0, s => Math.min(BUILDING_MAX_SCALE, BUILDING_FIT / Math.max(s.x, s.z)));
      }
      models.set(path, obj);
    }),
  );
}

// Modelin bir kopyasını ver; istenirse duvarları ve çatıyı verilen renklere boya
export function makeModel(path: string, wallColor?: string, roofColor?: string): THREE.Object3D {
  const m = models.get(path);
  if (!m) throw new Error(`Model yüklenmedi: ${path}`);
  const copy = m.clone(true);
  if (wallColor || roofColor) {
    copy.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const color = mat.name === '_defaultMat' ? wallColor : mat.name === 'roof' ? roofColor : undefined;
      if (!color) return;
      const key = `${mat.uuid}|${color}`;
      let t = tinted.get(key);
      if (!t) {
        const c = mat.clone();
        c.color.set(color);
        tinted.set(key, c);
        t = c;
      }
      mesh.material = t;
    });
  }
  return copy;
}
