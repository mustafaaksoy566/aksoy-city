import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  SIZE, DAY_SECONDS, COST, TOOL_INFO, SERVICES, ALL_MODELS, SKINS, ENTRANCE_Z, ENTRANCE_LEN, MATERIALS, MAT_IDS, UNLOCK, LEVEL_REWARD,
  type Tool, type BuildTool, type MatId,
} from './config';
import { City, isUtility, isService, isIndustry, serviceArea } from './city';
import { describeTile, describeStorage, describeQuests, describeHall, type CardActions } from './info';
import { questDone } from './quests';
import { loadModels } from './assets';
import { CityView, tileCenter } from './view';
import { Traffic, Walkers } from './traffic';
import { DayNight, CYCLE_DAYS } from './daynight';
import { renderThumbs } from './thumbs';
import { makeUtility } from './utilities';
import { makeService } from './services';
import { makeIndustry } from './industry';
import { makeDecor } from './landmarks';
import { makeModel, loadSkins } from './assets';
import { buildSurroundings } from './terrain';
import { TileInput } from './input';
import { setupAudioUnlock, play, isMuted, setMuted } from './audio';
import {
  buildToolbar, setActiveTool, setStats, toast, setChip, floatIncome, hideLoading, showInfo, celebrateLevel, setThumbs, fmt,
} from './ui';

const SAVE_KEY = 'aksoy-city-save-v1';

// --- Sahne, kamera, ışık ---
const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
// Çözünürlük: telefon zorlanırsa kendiliğinden düşürülür (bkz. adaptQuality)
let pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Gölgeler her karede değil, sadece şehir değişince yeniden hesaplanır
renderer.shadowMap.autoUpdate = false;
// Daha canlı ve gerçekçi renkler için ışık ayarı (film tonlaması + ortam yansıması)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fd8f0');
scene.fog = new THREE.Fog('#9fd8f0', 70, 150);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 400);
const start = tileCenter(ENTRANCE_LEN + 6, ENTRANCE_Z);
camera.position.set(start.x + 8, 11, start.z + 8);

const controls = new MapControls(camera, renderer.domElement);
controls.target.copy(start);
controls.enableDamping = true;
controls.enableRotate = false;
controls.minDistance = 8;
controls.maxDistance = 60;

const hemi = new THREE.HemisphereLight('#ffffff', '#7a9a5a', 1.0);
scene.add(hemi);
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
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Parameters<typeof City.load>[0];
      if (City.canLoad(data)) return City.load(data);
    }
  } catch {
    // Aşağıda yedeklenip yeni şehirle başlanır
  }
  // Kayıt okunamadıysa üstüne yazmadan önce yedeğini al
  if (raw) {
    try {
      localStorage.setItem(`${SAVE_KEY}-yedek-${Date.now()}`, raw);
    } catch {
      // yer yoksa yapacak bir şey yok
    }
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
const walkers = new Walkers(city);
scene.add(walkers.root);
const dayNight = new DayNight(scene, hemi, sun);

const updateStats = () =>
  setStats({
    money: city.money,
    pop: city.population,
    income: city.dailyIncome,
    service: city.service,
    level: city.levelProgress,
    storage: { used: city.storageUsed, cap: city.storageCap },
    happiness: city.happiness,
    questsReady: city.quests.filter(q => questDone(city, q)).length,
  });

// Seviye atlanınca kutla ve yeni açılanları göster
function checkLevelUps() {
  while (city.levelUps.length) {
    const level = city.levelUps.shift()!;
    const tools = (Object.entries(UNLOCK) as [BuildTool, number][]).filter(([, l]) => l === level).map(([t]) => `${TOOL_INFO[t].icon} ${TOOL_INFO[t].label}`);
    const mats = MAT_IDS.filter(m => MATERIALS[m].unlock === level).map(m => `${MATERIALS[m].icon} ${MATERIALS[m].name}`);
    celebrateLevel(level, LEVEL_REWARD * level, [...tools, ...mats]);
    play('grow', 0.6);
  }
}

// Depo düğmesinin yanında küçük "+🔩" yazısı uçsun
function floatStorage(mats: MatId[]) {
  const el = document.createElement('div');
  el.className = 'float';
  el.textContent = '+' + mats.map(m => MATERIALS[m].icon).join('');
  document.getElementById('storage')!.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// Yangın, hırsızlık, deprem gibi olayları ekranda göster
let shake = 0;
function showEvents() {
  for (const e of city.events.splice(0)) {
    if (e.type === 'fire') {
      toast('🔥 Yangın çıktı! Yanan eve dokunup söndür ya da yakına itfaiye kur.', 'error');
      play('error', 0.5);
    } else if (e.type === 'fireOut') toast('🚒 İtfaiye yangını söndürdü.');
    else if (e.type === 'collapse') {
      toast('💥 Söndürülmeyen yangın yüzünden bir bina yıkıldı!', 'error');
      play('remove', 0.6);
    } else if (e.type === 'crime') {
      toast(`🚨 Hırsızlık! Polisin olmadığı mahallede 💰${fmt(e.amount)} çalındı.`, 'error');
      play('error', 0.5);
    } else if (e.type === 'quake') {
      toast(`🌋 Deprem! ${e.tiles.length} bina hasar gördü. Dokunup onar.`, 'error');
      play('remove', 0.8);
      shake = 1.6;
    }
  }
}

// --- Bilgi kartı (binaya dokununca) ---
let openCard: number | 'storage' | 'quests' | null = null;

const cardActions: CardActions = {
  upgrade(i) {
    const err = city.upgrade(i);
    if (err) {
      toast(err, 'error');
      play('error', 0.3);
    } else {
      view.refresh([i], true);
      play('grow', 0.6);
      toast(`⬆️ Bina ${city.tiles[i]!.level}. seviyeye yükseldi!`);
    }
    afterChange();
  },
  make(i, mat) {
    const err = city.startJob(i, mat, Date.now());
    if (err) {
      toast(err, 'error');
      play('error', 0.3);
    } else play('click', 0.4);
    afterChange();
  },
  collect() {
    const got = city.collectTaxes();
    if (got > 0) {
      floatIncome(got);
      play('place', 0.6);
    }
    afterChange();
  },
  extinguish(i) {
    const err = city.extinguish(i);
    if (err) toast(err, 'error');
    else {
      toast('🚒 Yangın söndürüldü!');
      view.refresh([i], false);
      play('click', 0.5);
    }
    afterChange();
  },
  repair(i) {
    const err = city.repair(i);
    if (err) toast(err, 'error');
    else {
      toast('🔧 Bina onarıldı!');
      view.refresh([i], true);
      play('grow', 0.5);
    }
    afterChange();
  },
  buyLand(plot) {
    const err = city.buyPlot(plot);
    if (err) {
      toast(err, 'error');
      play('error', 0.3);
    } else {
      view.updateLand();
      openCard = null;
      play('grow', 0.6);
      toast('🏞️ Yeni arazi senin! Şehrini büyütebilirsin.');
    }
    afterChange();
  },
  claim(n) {
    if (city.claimQuest(n)) {
      play('grow', 0.6);
      toast('🎁 Görev ödülü alındı!');
    }
    afterChange();
  },
};

function renderCard() {
  if (openCard === null) return showInfo(null);
  const card =
    openCard === 'storage' ? describeStorage(city)
    : openCard === 'quests' ? describeQuests(city, cardActions)
    : describeTile(city, openCard, cardActions);
  if (!card) openCard = null;
  showInfo(card);
}

function openTile(cell: number | null) {
  openCard = cell;
  renderCard();
}

// Bir şey değişince her yeri güncelle ve kaydet
function afterChange() {
  showEvents();
  checkLevelUps();
  view.updateIcons();
  renderCard();
  updateStats();
  save();
}

// Elektrik ya da su eksikse ara sıra hatırlat
const lastWarned = { power: -99, water: -99, factory: -99 };
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
  // Evler var ama fabrika yoksa yükseltmeyi hatırlat
  const hasHouse = city.tiles.some(t => t?.kind === 'res' && t.level > 0);
  const hasFactory = city.tiles.some(t => t?.kind === 'factory');
  if (hasHouse && !hasFactory && city.day - lastWarned.factory >= 20) {
    lastWarned.factory = city.day;
    toast('🏭 Evleri büyütmek için Sanayi menüsünden fabrika kur ve metal, odun üret.');
    return;
  }
  // Belediyede çok vergi birikmişse hatırlat
  if (city.hall !== null && city.treasury > Math.max(200, city.dailyTax * 15) && city.day - lastWarned.factory >= 20) {
    lastWarned.factory = city.day;
    toast('🏛️ Belediyede vergi birikti! Belediyeye dokunup topla.');
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

// Hizmet binası seçiliyken o hizmetin kapsadığı alanı haritada renklendir
function showCoverage(candidate?: number) {
  if (!isService(tool)) return view.showCoverage([], '#fff');
  const cells = new Set(city.coverageOf(tool));
  if (candidate !== undefined) for (const c of serviceArea(candidate, tool)) cells.add(c);
  view.showCoverage([...cells], SERVICES[tool].color);
}

// Aracın kilidi hangi seviyede açılıyor (açıksa null)
const lockedAt = (t: Tool) => (t === 'pan' || city.isUnlocked(t) ? null : city.unlockLevel(t));

function pickTool(t: Tool) {
  // Seçili araca tekrar basınca araç bırakılır
  if (t === tool) t = 'pan';
  const lock = lockedAt(t);
  if (lock) {
    toast(`🔒 Şehir seviyesi ${lock}'te açılır`, 'error');
    play('error', 0.3);
    return;
  }
  tool = t;
  openCard = null;
  input.cancelDrag();
  view.showPreview([]);
  showInfo(null);
  showCoverage();
  setChip(null);
  setActiveTool(t);
  applyControls();
  play('click', 0.4);
  if (t !== 'pan' && !hinted.has(t)) {
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
    if (isService(tool)) showCoverage(items[0]?.ok ? items[0].i : undefined);
    if (cells.length > 1 || isUtility(tool) || isService(tool) || isIndustry(tool)) setChip(tool === 'bulldoze' ? `${n} kare yıkılacak` : `${n} kare · 💰${fmt(n * COST[tool])}`);
  },
  commit(cells) {
    view.showPreview([]);
    setChip(null);
    if (tool === 'pan') return;
    const res = city.apply(tool, cells);
    showCoverage();
    if (res.error) {
      toast(res.error, 'error');
      play('error', 0.3);
      return;
    }
    view.refresh(res.done, tool !== 'bulldoze');
    play(tool === 'bulldoze' ? 'remove' : 'place');
    afterChange();
    if (tool !== 'road' && tool !== 'bulldoze' && tool !== 'park' && res.done.some(i => !city.isConnected(i))) {
      toast('Bu yol şehir girişine bağlı değil. Yolu soldaki otoyola bağla!', 'error');
    }
  },
  cancel() {
    view.showPreview([]);
    setChip(null);
    showCoverage();
  },
  tap(cell) {
    openTile(cell);
    if (openCard !== null) play('click', 0.3);
  },
});

buildToolbar(pickTool, lockedAt);
setActiveTool(tool);
applyControls();
setupAudioUnlock();
renderer.domElement.addEventListener('pointerdown', () => openTile(null));
document.getElementById('storage')!.addEventListener('click', () => {
  openCard = openCard === 'storage' ? null : 'storage';
  renderCard();
  play('click', 0.3);
});
document.getElementById('quests')!.addEventListener('click', () => {
  openCard = openCard === 'quests' ? null : 'quests';
  renderCard();
  play('click', 0.3);
});
document.getElementById('happy')!.addEventListener('click', () => {
  const hall = city.hall;
  openCard = hall === null || openCard === hall ? null : hall;
  renderCard();
  play('click', 0.3);
});

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
  openCard = null;
  view.setCity(city);
  traffic.setCity(city);
  walkers.setCity(city);
  afterChange();
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
let prodTimer = 0;
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
    const { changed } = city.nextDay();
    if (changed.length) {
      view.refresh(changed, true);
      play('grow', 0.35);
    }
    warnShortages();
    afterChange();
  }

  // Fabrika ve hırdavatçı üretimlerini yarım saniyede bir kontrol et
  prodTimer += dt;
  if (prodTimer >= 0.5) {
    prodTimer = 0;
    const got = city.collect(Date.now());
    if (got.length) {
      floatStorage(got);
      play('place', 0.25);
      afterChange();
    } else {
      view.updateIcons();
      if (openCard !== null) renderCard();
    }
  }

  view.update(dt);
  if (view.shadowDirty) {
    view.shadowDirty = false;
    renderer.shadowMap.needsUpdate = true;
  }
  adaptQuality(dt);
  traffic.update(dt);
  walkers.update(dt);
  dayNight.update(((city.day % CYCLE_DAYS) + dayTimer / DAY_SECONDS) / CYCLE_DAYS, dt);
  // Depremde kamera sallansın (sadece çizim sırasında kaydırılır, sonra geri alınır)
  const jolt = new THREE.Vector3();
  if (shake > 0) {
    shake = Math.max(0, shake - dt);
    jolt.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake * 0.25);
  }
  camera.position.add(jolt);
  renderer.render(scene, camera);
  camera.position.sub(jolt);
}

// Kare hızı düşükse çözünürlüğü biraz azalt (en az 1)
let slowTime = 0;
function adaptQuality(dt: number) {
  if (dt > 1 / 40) slowTime += dt;
  else slowTime = Math.max(0, slowTime - dt * 0.5);
  if (slowTime > 2 && pixelRatio > 1) {
    pixelRatio = Math.max(1, pixelRatio - 0.25);
    renderer.setPixelRatio(pixelRatio);
    resize();
    slowTime = 0;
  }
}

// Menü düğmeleri için her binanın küçük resmini çiz
function makeMenuPictures() {
  const items: [Tool, THREE.Object3D][] = [
    ['road', makeModel('kaykit/road_junction')],
    ['res', makeModel('kaykit/building_C')],
    ['com', makeModel('kaykit/building_E')],
    ['park', makeModel('kenney/models/grass-trees-tall')],
  ];
  for (const k of ['wind', 'solar', 'plant', 'tower', 'pump'] as const) items.push([k, makeUtility(k)]);
  for (const k of ['police', 'fire', 'health', 'school'] as const) items.push([k, makeService(k)]);
  for (const k of ['factory', 'store', 'depot'] as const) items.push([k, makeIndustry(k)]);
  for (const k of ['fountain', 'statue', 'wheel', 'stadium'] as const) items.push([k, makeDecor(k)]);
  try {
    setThumbs(renderThumbs(items));
  } catch (err) {
    console.warn('Menü resimleri çizilemedi', err);
  }
}

const loadingEl = document.getElementById('loading')!;
Promise.all([
  loadModels(ALL_MODELS, (done, total) => (loadingEl.textContent = `Aksoy City yükleniyor… %${Math.round((done / total) * 100)}`)),
  loadSkins(SKINS),
])
  .then(() => {
    scene.add(buildSurroundings());
    traffic.init();
    view.rebuildAll();
    makeMenuPictures();
    // Oyun kapalıyken biten üretimleri depoya al
    const got = city.collect(Date.now());
    if (got.length) toast(`Sen yokken ${got.length} malzeme üretildi! 📦`);
    afterChange();
    hideLoading();
    if (!city.hasZones) toast('Hoş geldin! Önce yol çiz, sonra Bölge menüsünden konut koy.');
    renderer.setAnimationLoop(frame);
    // Geliştirirken performansı ölçebilmek için (yayında çalışmaz)
    if (import.meta.env.DEV) Object.assign(window, { __aksoy: { renderer, scene } });
  })
  .catch(err => {
    console.error(err);
    document.getElementById('loading')!.textContent = 'Oyun yüklenemedi. Sayfayı yenilemeyi dene.';
  });
