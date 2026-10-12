import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { SIZE, DAY_SECONDS, COST, TOOLS, ALL_MODELS, ENTRANCE_Z, type Tool } from './config';
import { City, type SaveData } from './city';
import { loadModels } from './assets';
import { CityView, tileCenter } from './view';
import { TileInput } from './input';
import { setupAudioUnlock, play, isMuted, setMuted } from './audio';
import { buildToolbar, setActiveTool, setStats, toast, setChip, floatIncome, hideLoading, fmt } from './ui';

const SAVE_KEY = 'aksoy-city-save-v1';

// --- Sahne, kamera, ışık ---
const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fd8f0');

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
const start = tileCenter(8, ENTRANCE_Z);
camera.position.set(start.x + 12, 18, start.z + 12);

const controls = new MapControls(camera, renderer.domElement);
controls.target.copy(start);
controls.enableDamping = true;
controls.enableRotate = false;
controls.minDistance = 8;
controls.maxDistance = 60;

scene.add(new THREE.HemisphereLight('#ffffff', '#7a9a5a', 1.6));
const sun = new THREE.DirectionalLight('#fff6e0', 2.2);
sun.position.set(-12, 30, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const half = SIZE / 2 + 2;
Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 80 });
sun.shadow.normalBias = 0.02;
scene.add(sun);

// Çimen zemin: harita içi açık yeşil, dışı biraz koyu
const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#5f9e4a' }));
outer.rotation.x = -Math.PI / 2;
outer.position.y = -0.02;
scene.add(outer);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshStandardMaterial({ color: '#7cc05c' }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(SIZE, SIZE, '#ffffff', '#ffffff');
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.18;
grid.position.y = 0.005;
scene.add(grid);

// --- Şehir ---
function loadCity(): City {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as SaveData;
      if (data?.v === 1) return City.load(data);
    }
  } catch {
    // Kayıt okunamazsa yeni şehirle başla
  }
  return new City();
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(city.serialize()));
  } catch {
    // Gizli sekmede kayıt yapılamayabilir
  }
}

let city = loadCity();
const view = new CityView(city);
scene.add(view.root);

const updateStats = () => setStats(city.money, city.population, city.day, city.dailyIncome);

// --- Araçlar ---
let tool: Tool = 'pan';
const hinted = new Set<Tool>();

function applyControls() {
  const build = tool !== 'pan';
  controls.touches.ONE = build ? null : THREE.TOUCH.PAN;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.mouseButtons.LEFT = build ? null : THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
}

function pickTool(t: Tool) {
  tool = t;
  input.cancelDrag();
  view.showPreview([]);
  setChip(null);
  setActiveTool(t);
  applyControls();
  play('click', 0.4);
  if (!hinted.has(t)) {
    hinted.add(t);
    toast(TOOLS.find(x => x.id === t)!.hint);
  }
}

const input = new TileInput(renderer.domElement, camera, {
  tool: () => tool,
  preview(cells) {
    if (tool === 'pan') return;
    const items = cells.map(i => ({ i, ok: city.check(tool as Exclude<Tool, 'pan'>, i % SIZE, Math.floor(i / SIZE)) === null }));
    view.showPreview(items);
    const n = items.filter(c => c.ok).length;
    if (cells.length > 1) setChip(tool === 'bulldoze' ? `${n} kare yıkılacak` : `${n} kare · 💰${fmt(n * COST[tool])}`);
  },
  commit(cells) {
    view.showPreview([]);
    setChip(null);
    if (tool === 'pan') return;
    const res = city.apply(tool, cells);
    if (res.error) {
      toast(res.error, 'error');
      play('error', 0.3);
      return;
    }
    view.refresh(res.done, tool !== 'bulldoze');
    play(tool === 'bulldoze' ? 'remove' : 'place');
    if (tool === 'house' && res.done.some(i => !city.isConnected(i))) {
      toast('Bu yol şehir girişine bağlı değil. Yolu soldaki girişe bağla!', 'error');
    }
    updateStats();
    save();
  },
  cancel() {
    view.showPreview([]);
    setChip(null);
  },
});

buildToolbar(pickTool);
setActiveTool(tool);
applyControls();
setupAudioUnlock();

// Ses ve sıfırlama düğmeleri
const soundBtn = document.getElementById('sound')!;
soundBtn.textContent = isMuted() ? '🔇' : '🔊';
soundBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  soundBtn.textContent = isMuted() ? '🔇' : '🔊';
});
document.getElementById('reset')!.addEventListener('click', () => {
  if (!confirm('Şehrin tamamen silinip baştan başlansın mı?')) return;
  city = new City();
  view.setCity(city);
  save();
  updateStats();
  toast('Yeni şehir kuruldu!');
});

// --- Ekran boyutu ve oyun döngüsü ---
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let dayTimer = 0;
const limit = SIZE / 2;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.25);
  controls.update();
  // Kamera haritanın dışına kaçmasın
  const t = controls.target;
  const cx = THREE.MathUtils.clamp(t.x, -limit, limit) - t.x;
  const cz = THREE.MathUtils.clamp(t.z, -limit, limit) - t.z;
  if (cx || cz) {
    t.x += cx;
    t.z += cz;
    camera.position.x += cx;
    camera.position.z += cz;
  }

  dayTimer += dt;
  if (dayTimer >= DAY_SECONDS) {
    dayTimer -= DAY_SECONDS;
    const { income, grown } = city.nextDay();
    if (grown.length) {
      view.refresh(grown, true);
      play('grow', 0.35);
    }
    floatIncome(income);
    updateStats();
    save();
  }

  view.update(dt);
  renderer.render(scene, camera);
}

loadModels(ALL_MODELS)
  .then(() => {
    view.rebuildAll();
    updateStats();
    hideLoading();
    renderer.setAnimationLoop(frame);
  })
  .catch(err => {
    console.error(err);
    document.getElementById('loading')!.textContent = 'Oyun yüklenemedi. Sayfayı yenilemeyi dene.';
  });
