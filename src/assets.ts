import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const models = new Map<string, THREE.Object3D>();
const tinted = new Map<string, THREE.Material>();

const BUILDING_FIT = 0.86; // ticari binalar karenin bu kadarını kaplasın
const BUILDING_MAX_SCALE = 1.4;
export const CAR_LENGTH = 0.4;

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

// Arabanın ön farlarının olduğu tarafı bulup +z yönüne çevirmek için açı
function carTurn(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true);
  const all = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
  let front: THREE.Vector3 | null = null;
  obj.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (!front && m && /headlight/i.test(m.name)) front = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  });
  if (!front) return 0;
  const f = (front as THREE.Vector3).sub(all);
  const dir = Math.abs(f.x) > Math.abs(f.z) ? new THREE.Vector3(Math.sign(f.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(f.z));
  return -Math.atan2(dir.x, dir.z);
}

// Modelleri bir kere yükle, sonra kopyalarını kullan
export async function loadModels(paths: string[]) {
  const loader = new GLTFLoader();
  await Promise.all(
    paths.map(async path => {
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${path}.glb`);
      let obj: THREE.Object3D = gltf.scene;
      obj.traverse(o => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      if (path.startsWith('polypizza/city/') || path.startsWith('polypizza/extra/')) {
        obj = normalize(obj, 0, s => Math.min(BUILDING_MAX_SCALE, BUILDING_FIT / Math.max(s.x, s.z)));
      } else if (path.startsWith('polypizza/cars/')) {
        obj = normalize(obj, carTurn(obj), s => CAR_LENGTH / Math.max(s.x, s.z));
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
