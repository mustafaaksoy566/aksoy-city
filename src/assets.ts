import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TREE_MODELS } from './trees';
import { TOWER_MODELS } from './towers';

// Kodla çizilen modeller (ağaçlar, gökdelenler)
const PROC = (path: string) => TREE_MODELS[path] ?? TOWER_MODELS[path];

const models = new Map<string, THREE.Object3D>();
// Aynı klasördeki modeller aynı doku atlasını kullanır; tek malzemede birleştirilir ki çizim sayısı azalsın
const atlasMats = new Map<string, THREE.Material>();
export const KAYKIT_SCALE = 0.5; // KayKit parçaları 2x2 birim, oyunda 1 kare

const BUILDING_FIT = 0.86; // binalar karenin bu kadarını kaplasın
const BUILDING_MAX_SCALE = 1.4;
// Model yolu başı -> kaplayacağı en geniş ölçü (ilk eşleşen kullanılır)
const FITS: [string, number][] = [
  ['kenney-sub/tree', 0.36],
  ['kenney-sub/planter', 0.3],
  ['kenney-sub/fence', 0.5],
  ['kenney-sub/', 0.8], // banliyö evleri, bahçeye yer kalsın
  ['kenney-ind/chimney-large', 0.2],
  ['kenney-ind/chimney', 0.16],
  ['kenney-ind/detail-tank', 0.3],
  ['kenney-ind/shipping-container', 0.42],
  ['kenney-ind/solar', 0.86],
  ['kenney-ind/', BUILDING_FIT],
  ['kenney-cars/ambulance', 0.56],
  ['kenney-cars/firetruck', 0.6],
  ['kenney-cars/garbage-truck', 0.58],
  ['kenney-cars/delivery', 0.56],
  ['kenney-cars/', 0.48],
  ['kenney-boats/ship-ocean-liner', 4.5],
  ['kenney-boats/ship', 3.5],
  ['kenney-boats/', 1.4],
  ['kenney-roads/construction-cone', 0.07],
  ['kenney-roads/construction-light', 0.14],
  ['kenney-roads/', 0.32],
  ['polypizza/extra/', BUILDING_FIT],
  ['kenney2/', BUILDING_FIT],
];
const skinMats = new Map<string, THREE.Material>();
const skinTextures = new Map<string, THREE.Texture[]>();

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

// Yollar SimCity'deki gibi: koyu lacivert asfalt, beyaz çizgiler, açık renk kaldırım kenarı.
// KayKit doku atlasının bir kopyasında yol renkleri değiştirilir; bu kopyayı sadece yol parçaları kullanır.
export const ROAD_COLORS = { asphalt: '#3f4559', line: '#d9dde6', curb: '#c9ccd2' };
let roadMat: THREE.MeshStandardMaterial | null = null;
function roadMaterial(base: THREE.MeshStandardMaterial) {
  if (roadMat) return roadMat;
  const img = base.map!.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const rgb = (h: string) => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  const swap = [
    [rgb('#60676c'), rgb(ROAD_COLORS.asphalt)],
    [rgb('#e0ad51'), rgb(ROAD_COLORS.line)],
    [rgb('#7d878c'), rgb(ROAD_COLORS.curb)],
  ];
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    for (const [from, to] of swap) {
      if (Math.abs(d[i] - from[0]) < 7 && Math.abs(d[i + 1] - from[1]) < 7 && Math.abs(d[i + 2] - from[2]) < 7) {
        d[i] = to[0];
        d[i + 1] = to[1];
        d[i + 2] = to[2];
        break;
      }
    }
  }
  g.putImageData(data, 0, 0);
  const src = base.map!;
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = src.flipY;
  tex.colorSpace = src.colorSpace;
  tex.wrapS = src.wrapS;
  tex.wrapT = src.wrapT;
  tex.magFilter = src.magFilter;
  tex.minFilter = src.minFilter;
  roadMat = base.clone();
  roadMat.map = tex;
  return roadMat;
}

// Modelleri bir kere yükle, sonra kopyalarını kullan
export async function loadModels(paths: string[], onProgress?: (done: number, total: number) => void) {
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(
    paths.map(async path => {
      // Kodla çizilen modeller (ağaçlar) dosyadan yüklenmez
      if (PROC(path)) {
        models.set(path, PROC(path)());
        onProgress?.(++done, paths.length);
        return;
      }
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
          if (path.startsWith('kaykit/road')) mesh.material = roadMaterial(mesh.material as THREE.MeshStandardMaterial);
        }
      });
      if (path.startsWith('kaykit/')) {
        const g = new THREE.Group();
        obj.scale.setScalar(KAYKIT_SCALE);
        g.add(obj);
        obj = g;
      } else {
        // Diğer modeller: ne kadar yer kaplayacakları (en geniş yer, oyun karesi cinsinden)
        const fit = FITS.find(([p]) => path.startsWith(p))?.[1];
        if (fit) obj = normalize(obj, 0, s => Math.min(BUILDING_MAX_SCALE, fit / Math.max(s.x, s.z)));
      }
      models.set(path, obj);
      onProgress?.(++done, paths.length);
    }),
  );
}

// Kenney paketlerinin renk çeşidi dokularını yükle (yüklenemezse asıl renkler kullanılır)
export async function loadSkins(skins: Record<string, string[]>) {
  const loader = new THREE.TextureLoader();
  await Promise.all(
    Object.entries(skins).map(async ([folder, names]) => {
      const list = await Promise.all(
        names.map(async n => {
          try {
            const t = await loader.loadAsync(`${import.meta.env.BASE_URL}${folder}/Textures/${n}.png`);
            t.flipY = false; // glTF dokuları gibi
            t.colorSpace = THREE.SRGBColorSpace;
            t.magFilter = THREE.NearestFilter;
            return t;
          } catch {
            return null;
          }
        }),
      );
      skinTextures.set(folder, list.filter(t => t !== null) as THREE.Texture[]);
    }),
  );
}

// Modelin bir kopyasını ver; skin > 0 ise o paketin farklı renk düzeni kullanılır
export function makeModel(path: string, skin = 0): THREE.Object3D {
  const m = models.get(path);
  if (!m) throw new Error(`Model yüklenmedi: ${path}`);
  const copy = m.clone(true);
  const folder = path.slice(0, path.lastIndexOf('/'));
  const tex = skin > 0 ? skinTextures.get(folder)?.[skin - 1] : undefined;
  if (tex) {
    copy.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat.map) return;
      const key = `${mat.uuid}|${skin}`;
      let t = skinMats.get(key);
      if (!t) {
        const c = mat.clone();
        c.map = tex;
        skinMats.set(key, c);
        t = c;
      }
      mesh.material = t;
    });
  }
  return copy;
}
