import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  SIZE, PLOT, PLOTS, DAY_SECONDS, COST, TOOL_INFO, SERVICES, DECOR, ALL_MODELS, SKINS, ENTRANCE_Z, ENTRANCE_LEN, MATERIALS, MAT_IDS, UNLOCK,
  LEVEL_REWARD, type Tool, type BuildTool, type MatId, type ServiceKind,
} from './config';
import { City, isUtility, isService, isIndustry, isDecor, areaAround, sizeOf, block } from './city';
import {
  describeTile, describeStorage, describeQuests, describeHall, describeBudget, describeCity, describeUtility, type CardActions,
} from './info';
import { Sky } from './sky';
import { Weather } from './weather';
import { questDone } from './quests';
import { loadModels } from './assets';
import { CityView, tileCenter } from './view';
import { Traffic, Walkers } from './traffic';
import { Trains } from './trains';
import { railPiece } from './rails';
import { DayNight, CYCLE_DAYS } from './daynight';
import { renderThumbs } from './thumbs';
import { makeUtility } from './utilities';
import { makeService, makeHall } from './services';
import { makeIndustry } from './industry';
import { makeDecor } from './landmarks';
import { makeModel, loadSkins } from './assets';
import { buildSurroundings } from './terrain';
import { TileInput } from './input';
import { setupAudioUnlock, play, isMuted, setMuted } from './audio';
import {
  buildCatalog, setMode, setStats, toast, setChip, floatIncome, floatText, hideLoading, showInfo, celebrateLevel, setThumbs,
  setLoading, loadFailed, openSettings, confirmDialog, onInfoClose, fmt, type Quality,
} from './ui';

const SAVE_KEY = 'aksoy-city-save-v1';
const QUALITY_KEY = 'aksoy-city-quality';
const RAIN_KEY = 'aksoy-city-rain';

const readPref = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writePref = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // gizli sekmede kaydedilemeyebilir
  }
};

// --- Sahne, kamera, ışık ---
const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
// Çözünürlük: grafik ayarına göre; telefon zorlanırsa kendiliğinden düşürülür (bkz. adaptQuality)
let quality: Quality = (readPref(QUALITY_KEY) as Quality) || 'high';
const maxRatio = () => (quality === 'high' ? Math.min(window.devicePixelRatio, 2) : quality === 'mid' ? Math.min(window.devicePixelRatio, 1.5) : 1);
let pixelRatio = maxRatio();
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFShadowMap;
// Gölgeler her karede değil, sadece şehir değişince yeniden hesaplanır
renderer.shadowMap.autoUpdate = false;
// Canlı renkler için ışık ayarı (renkleri soldurmayan tonlama + ortam yansıması)
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
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
sun.castShadow = quality !== 'low';
sun.shadow.mapSize.set(2048, 2048);
const half = SIZE / 2 + 2;
Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 80 });
sun.shadow.normalBias = 0.02;
scene.add(sun);

// Şehrin çimen zemini. Yolların asfaltı y=0'da olduğu için zemin biraz aşağıda,
// yoksa çimen yolun içinden titreyerek görünüyor.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshStandardMaterial({ color: '#56a03a' }));
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
  if (raw) writePref(`${SAVE_KEY}-yedek-${Date.now()}`, raw);
  return new City();
}

function save() {
  writePref(SAVE_KEY, JSON.stringify(city.serialize()));
}

let city = loadCity();
const view = new CityView(city);
scene.add(view.root);
const traffic = new Traffic(city);
scene.add(traffic.root);
const walkers = new Walkers(city);
scene.add(walkers.root);
const trains = new Trains(city);
scene.add(trains.root);
const sky = new Sky(city);
scene.add(sky.root);
const weather = new Weather();
weather.enabled = readPref(RAIN_KEY) !== '0';
scene.add(weather.root);
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
    const tools = (Object.entries(UNLOCK) as [BuildTool, number][])
      .filter(([, l]) => l === level)
      .map(([t]) => ({ key: t as string, icon: TOOL_INFO[t].icon, label: TOOL_INFO[t].label }));
    const mats = MAT_IDS.filter(m => MATERIALS[m].unlock === level).map(m => ({ icon: MATERIALS[m].icon, label: MATERIALS[m].name }));
    celebrateLevel(level, LEVEL_REWARD * level, [...tools, ...mats]);
    play('grow', 0.6);
  }
}

// Depo düğmesinin yanında küçük "+🔩" yazısı uçsun
function floatStorage(mats: MatId[]) {
  floatText('storage', '+' + mats.map(m => MATERIALS[m].icon).join(''));
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

// --- Bilgi kartı (binaya ya da göstergelere dokununca) ---
type CardKey = number | 'storage' | 'quests' | 'budget' | 'city' | 'power' | 'water' | 'hall';
let openCard: CardKey | null = null;

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
  sell(mat) {
    const err = city.sell(mat);
    if (err) toast(err, 'error');
    else {
      floatIncome(MATERIALS[mat].price);
      play('place', 0.4);
    }
    afterChange();
  },
  buy(mat) {
    const err = city.buy(mat);
    if (err) toast(err, 'error');
    else play('click', 0.4);
    afterChange();
  },
  claim(n) {
    if (city.claimQuest(n)) {
      play('grow', 0.6);
      toast('🎁 Görev ödülü alındı!');
    }
    afterChange();
  },
  openCatalog(group) {
    openTile(null);
    catalog.open(group);
    play('click', 0.3);
  },
};

function renderCard() {
  if (openCard === null) return showInfo(null);
  const card =
    openCard === 'storage' ? describeStorage(city)
    : openCard === 'quests' ? describeQuests(city, cardActions)
    : openCard === 'budget' ? describeBudget(city, cardActions)
    : openCard === 'city' ? describeCity(city)
    : openCard === 'power' || openCard === 'water' ? describeUtility(city, openCard, cardActions)
    : openCard === 'hall' ? describeHall(city, cardActions)
    : describeTile(city, openCard, cardActions);
  if (!card) openCard = null;
  showInfo(card);
}

function openTile(cell: CardKey | null) {
  openCard = cell;
  renderCard();
  highlight();
}
onInfoClose(() => {
  openCard = null;
  highlight();
});

// Kartı açık binanın (ya da satılık arazinin) altını işaretle
function highlight() {
  if (tool !== 'pan') return;
  if (typeof openCard !== 'number' || openCard < 0) return view.showSelection([]);
  if (!city.isOwned(openCard) && city.tiles[openCard]?.kind !== 'road') {
    const p = city.plotOf(openCard);
    const x0 = (p % PLOTS) * PLOT, z0 = Math.floor(p / PLOTS) * PLOT;
    return view.showSelection(block(x0, z0, PLOT) ?? []);
  }
  view.showSelection(city.tiles[openCard] ? city.cellsOf(openCard) : []);
}

// Üstteki göstergeye dokununca kartını aç; tekrar dokununca kapat
function toggleCard(key: CardKey) {
  if (tool !== 'pan') pickTool('pan');
  catalog.close();
  openTile(openCard === key ? null : key);
  play('click', 0.3);
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
    power: ['⚡ Elektrik yok! İnşa Et → Altyapı\'dan rüzgar türbini kur.', '⚡ Elektrik yetmiyor! Yeni türbin ya da santral kur.'],
    water: ['💧 Su yok! İnşa Et → Altyapı\'dan su kulesi kur.', '💧 Su yetmiyor! Yeni su kulesi ya da pompa kur.'],
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
    toast('🏭 Evleri büyütmek için İnşa Et → Sanayi\'den fabrika kur.');
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

function applyControls() {
  const build = tool !== 'pan';
  controls.touches.ONE = build ? null : THREE.TOUCH.PAN;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.mouseButtons.LEFT = build ? null : THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
}

// Bu araç hangi hizmetin alanını kaplıyor? (üniversite = okul)
function coverKind(t: Tool): ServiceKind | null {
  if (isService(t)) return t;
  if (isDecor(t) && DECOR[t].covers) return DECOR[t].covers!;
  return null;
}

// Hizmet binası seçiliyken o hizmetin kapsadığı alanı haritada renklendir
function showCoverage(candidate?: number) {
  const kind = coverKind(tool);
  if (!kind) return view.showCoverage([], '#fff');
  const cells = new Set(city.coverageOf(kind));
  if (candidate !== undefined) {
    const r = isService(tool) ? SERVICES[tool].radius : DECOR[tool as keyof typeof DECOR].radius;
    for (const c of areaAround(candidate, r, sizeOf(tool as BuildTool))) cells.add(c);
  }
  view.showCoverage([...cells], SERVICES[kind].color);
}

// Aracın kilidi hangi seviyede açılıyor (açıksa null)
const lockedAt = (t: Tool) => (t === 'pan' || city.isUnlocked(t) ? null : city.unlockLevel(t));

function pickTool(t: Tool) {
  const lock = lockedAt(t);
  if (lock) {
    toast(`🔒 Şehir seviyesi ${lock}'te açılır`, 'error');
    play('error', 0.3);
    return;
  }
  catalog.close();
  tool = t;
  openCard = null;
  input.cancelDrag();
  view.showPreview([]);
  showInfo(null);
  showCoverage();
  setChip(null);
  setMode(t);
  applyControls();
  play('click', 0.4);
}

const input = new TileInput(renderer.domElement, camera, {
  tool: () => tool,
  preview(cells) {
    if (tool === 'pan') return;
    const build = tool as Exclude<Tool, 'pan'>;
    let items = cells.map(i => ({ i, ok: city.check(build, i % SIZE, Math.floor(i / SIZE)) === null }));
    // Büyük binalarda kaplayacağı bütün alanı göster
    const size = sizeOf(build);
    if (size > 1 && items.length === 1) {
      const area = block(items[0].i % SIZE, Math.floor(items[0].i / SIZE), size) ?? [items[0].i];
      items = area.map(i => ({ i, ok: items[0].ok }));
    }
    view.showPreview(items);
    const n = items.filter(c => c.ok).length;
    if (coverKind(tool)) showCoverage(items[0]?.ok ? cells[0] : undefined);
    if (cells.length === 1 && (isUtility(tool) || isService(tool) || isIndustry(tool) || isDecor(tool))) {
      setChip(`${TOOL_INFO[tool].label} · 💰${fmt(COST[tool])}${size > 1 ? ` · ${size}×${size} kare` : ''}`);
    } else if (cells.length > 1) {
      const okCells = items.filter(c => c.ok).map(c => c.i);
      setChip(tool === 'bulldoze' ? `${n} kare yıkılacak` : `${n} kare · 💰${fmt(city.costOf(tool, okCells))}`);
    }
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

const catalog = buildCatalog(t => pickTool(t), lockedAt, () => city.money);
setMode(tool);
applyControls();
setupAudioUnlock();
renderer.domElement.addEventListener('pointerdown', () => openTile(null));

// Ana düğmeler
document.getElementById('build')!.addEventListener('click', () => {
  if (tool !== 'pan') pickTool('pan');
  openTile(null);
  catalog.open();
  play('click', 0.4);
});
document.getElementById('bulldoze')!.addEventListener('click', () => pickTool(tool === 'bulldoze' ? 'pan' : 'bulldoze'));
document.querySelector('#mode .mode-done')!.addEventListener('click', () => pickTool('pan'));

// Üstteki göstergeler
const cardButtons: [string, CardKey][] = [
  ['storage', 'storage'], ['quests', 'quests'], ['money', 'budget'], ['pop', 'city'], ['lvl', 'city'],
  ['power', 'power'], ['water', 'water'], ['happy', 'hall'],
];
for (const [id, key] of cardButtons) document.getElementById(id)!.addEventListener('click', () => toggleCard(key));

// --- Ayarlar ---
function applyQuality(q: Quality) {
  quality = q;
  writePref(QUALITY_KEY, q);
  pixelRatio = maxRatio();
  renderer.setPixelRatio(pixelRatio);
  resize();
  const shadows = q !== 'low';
  if (renderer.shadowMap.enabled !== shadows) {
    renderer.shadowMap.enabled = shadows;
    sun.castShadow = shadows;
    // Gölge açılıp kapanınca malzemelerin yeniden derlenmesi gerekir
    scene.traverse(o => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach(x => (x.needsUpdate = true));
    });
    renderer.shadowMap.needsUpdate = true;
  }
}

async function resetCity() {
  const ok = await confirmDialog('Yeni şehir', 'Şehrin tamamen silinip baştan başlansın mı? Bu geri alınamaz.', 'Sil, baştan başla');
  if (!ok) return;
  city = new City();
  openCard = null;
  pickTool('pan');
  view.setCity(city);
  traffic.setCity(city);
  walkers.setCity(city);
  trains.setCity(city);
  sky.setCity(city);
  afterChange();
  toast('Yeni şehir kuruldu!');
}

document.getElementById('settings')!.addEventListener('click', () => {
  play('click', 0.3);
  openSettings(
    { sound: !isMuted(), quality, rain: weather.enabled },
    {
      sound: on => setMuted(!on),
      quality: applyQuality,
      rain: on => {
        weather.enabled = on;
        writePref(RAIN_KEY, on ? '1' : '0');
      },
      reset: resetCity,
    },
  );
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
  if (e.key === 'Escape') {
    pickTool('pan');
    catalog.close();
    openTile(null);
  }
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

  // Fabrika ve dükkan üretimlerini yarım saniyede bir kontrol et
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
  trains.update(dt);
  sky.update(dt);
  weather.update(dt, controls.target);
  dayNight.update(((city.day % CYCLE_DAYS) + dayTimer / DAY_SECONDS) / CYCLE_DAYS, dt, weather.amount);
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
  const items: [string, THREE.Object3D][] = [
    ['road', makeModel('kaykit/road_junction')],
    ['rail', railPiece(0b0110)],
    ['res', makeModel('kaykit/building_C')],
    ['com', makeModel('kaykit/building_E')],
    ['park', makeModel('kenney/models/grass-trees-tall')],
    ['hall', makeHall()],
  ];
  for (const k of ['wind', 'solar', 'plant', 'tower', 'pump'] as const) items.push([k, makeUtility(k)]);
  for (const k of ['police', 'fire', 'health', 'school'] as const) items.push([k, makeService(k)]);
  for (const k of ['factory', 'store', 'market', 'furniture', 'depot', 'trade'] as const) items.push([k, makeIndustry(k)]);
  for (const k of ['fountain', 'statue', 'wheel', 'stadium', 'station', 'busstop', 'uni', 'airport'] as const) items.push([k, makeDecor(k)]);
  try {
    setThumbs(renderThumbs(items));
  } catch (err) {
    console.warn('Menü resimleri çizilemedi', err);
  }
}

Promise.all([loadModels(ALL_MODELS, (done, total) => setLoading(done / total)), loadSkins(SKINS)])
  .then(() => {
    scene.add(buildSurroundings());
    traffic.init();
    trains.init();
    sky.init();
    view.rebuildAll();
    makeMenuPictures();
    // Oyun kapalıyken biten üretimleri depoya al
    const got = city.collect(Date.now());
    if (got.length) toast(`Sen yokken ${got.length} malzeme üretildi! 📦`);
    afterChange();
    hideLoading();
    if (!city.hasZones) toast('Hoş geldin! Sağ alttaki İnşa Et düğmesinden yol ve konut yap.');
    renderer.setAnimationLoop(frame);
    // Geliştirirken performansı ölçebilmek için (yayında çalışmaz)
    if (import.meta.env.DEV) Object.assign(window, { __aksoy: { renderer, scene, camera, controls, city: () => city, weather, view, sky, open: openTile, pick: pickTool, refresh: afterChange } });
  })
  .catch(err => {
    console.error(err);
    loadFailed();
  });
