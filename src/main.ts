import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { SIZE, DAY_SECONDS, COST, TOOL_INFO, ALL_MODELS, ENTRANCE_Z, type Tool } from './config';
import { City, isUtility } from './city';
import { loadModels } from './assets';
import { CityView, tileCenter } from './view';
import { Traffic } from './traffic';
import { buildSurroundings } from './terrain';
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
scene.fog = new THREE.Fog('#9fd8f0', 70, 150);

const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 400);
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

// Şehrin çimen zemini. Yolların asfaltı y=0'da olduğu için zemin biraz aşağıda,
// yoksa çimen yolun içinden titreyerek görünüyor.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshStandardMaterial({ color: '#7cc05c' }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(SIZE, SIZE, '#ffffff', '#ffffff');
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.18;
grid.position.y = -0.01;
scene.add(grid);

// --- Şehir ---
function loadCity(): City {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Parameters<typeof City.load>[0];
      if (data?.v === 1 || data?.v === 2) return City.load(data);
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
const traffic = new Traffic(city);
scene.add(traffic.root);

const updateStats = () => setStats(city.money, city.population, city.day, city.dailyIncome, city.service);

// Elektrik ya da su eksikse ara sıra hatırlat
const lastWarned = { power: -99, water: -99 };
function warnShortages() {
  if (!city.hasZones) return;
  const texts = {
    power: ['⚡ Elektrik yok! Altyapı menüsünden rüzgar türbini kur.', '⚡ Elektrik yetmiyor! Yeni türbin ya da santral kur.'],
    water: ['💧 Su yok! Altyapı menüsünden su kulesi kur.', '💧 Su yetmiyor! Yeni su kulesi ya da pompa kur.'],
  };
  for (const k of ['power', 'water'] as const) {
    const { supply, demand } = city.service[k];
    const none = supply === 0;
    if ((none || demand > supply) && city.day - lastWarned[k] >= 15) {
      lastWarned[k] = city.day;
      toast(texts[k][none ? 0 : 1], 'error');
      return;
    }
  }
}

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
    toast(TOOL_INFO[t].hint);
  }
}

const input = new TileInput(renderer.domElement, camera, {
  tool: () => tool,
  preview(cells) {
    if (tool === 'pan') return;
    const items = cells.map(i => ({ i, ok: city.check(tool as Exclude<Tool, 'pan'>, i % SIZE, Math.floor(i / SIZE)) === null }));
    view.showPreview(items);
    const n = items.filter(c => c.ok).length;
    if (cells.length > 1 || isUtility(tool)) setChip(tool === 'bulldoze' ? `${n} kare yıkılacak` : `${n} kare · 💰${fmt(n * COST[tool])}`);
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
    if (tool !== 'road' && tool !== 'bulldoze' && tool !== 'park' && res.done.some(i => !city.isConnected(i))) {
      toast('Bu yol şehir girişine bağlı değil. Yolu soldaki otoyola bağla!', 'error');
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
  traffic.setCity(city);
  save();
  updateStats();
  toast('Yeni şehir kuruldu!');
});

// --- Kamera döndürme (90 derece, yumuşak geçişle) ---
const UP = new THREE.Vector3(0, 1, 0);
let turn: { total: number; t: number; applied: number } | null = null;
function rotateCamera(dir: 1 | -1) {
  if (turn) return;
  turn = { total: (dir * Math.PI) / 2, t: 0, applied: 0 };
  play('click', 0.3);
}
document.getElementById('rot-left')!.addEventListener('click', () => rotateCamera(-1));
document.getElementById('rot-right')!.addEventListener('click', () => rotateCamera(1));
window.addEventListener('keydown', e => {
  if (e.key === 'q' || e.key === 'Q') rotateCamera(-1);
  if (e.key === 'e' || e.key === 'E') rotateCamera(1);
});

function stepTurn(dt: number) {
  if (!turn) return;
  turn.t = Math.min(1, turn.t + dt / 0.45);
  const k = turn.t < 0.5 ? 2 * turn.t * turn.t : 1 - Math.pow(-2 * turn.t + 2, 2) / 2;
  const step = turn.total * k - turn.applied;
  turn.applied += step;
  const offset = camera.position.clone().sub(controls.target).applyAxisAngle(UP, step);
  camera.position.copy(controls.target).add(offset);
  camera.lookAt(controls.target);
  if (turn.t >= 1) turn = null;
}

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
  stepTurn(dt);
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
    const { income, changed } = city.nextDay();
    if (changed.length) {
      view.refresh(changed, true);
      play('grow', 0.35);
    }
    view.updateIcons();
    floatIncome(income);
    updateStats();
    warnShortages();
    save();
  }

  view.update(dt);
  traffic.update(dt);
  renderer.render(scene, camera);
}

loadModels(ALL_MODELS)
  .then(() => {
    scene.add(buildSurroundings());
    view.rebuildAll();
    updateStats();
    hideLoading();
    renderer.setAnimationLoop(frame);
  })
  .catch(err => {
    console.error(err);
    document.getElementById('loading')!.textContent = 'Oyun yüklenemedi. Sayfayı yenilemeyi dene.';
  });
