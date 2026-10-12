import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  SIZE, ROWS, Z0, PLOT, PLOTS, DAY_SECONDS, COST, TOOL_INFO, SERVICES, DECOR, ALL_MODELS, SKINS, ENTRANCE_Z, ENTRANCE_LEN, MATERIALS, MAT_IDS, UNLOCK,
  LEVEL_REWARD, ROAD_TOOLS, ROAD_GRADES, RES_LEVELS, HOUSE_PRICE, HOUSE_UNLOCK, houseName, type Tool, type BuildTool, type MatId, type ServiceKind,
} from './config';
import { City, isUtility, isService, isIndustry, isDecor, areaAround, sizeOf, block } from './city';
import {
  describeTile, describeStorage, describeQuests, describeHall, describeBudget, describeCity, describeUtility, describePort, type CardActions,
} from './info';
import { Sky } from './sky';
import { CameraRig } from './camera';
import { Weather } from './weather';
import { updateWater } from './water';
import { Fireworks } from './fireworks';
import { questDone } from './quests';
import { loadModels } from './assets';
import { CityView, tileCenter, gradedRoadModel } from './view';
import { Traffic, Walkers } from './traffic';
import { Trains } from './trains';
import { railPiece } from './rails';
import { DayNight, CYCLE_DAYS, phase } from './daynight';
import { renderThumbs, thumbRenderer } from './thumbs';
import { Helicopters } from './helicopters';
import { SkiResort } from './ski';
import { makeUtility } from './utilities';
import { makeService, makeHall } from './services';
import { makeIndustry } from './industry';
import { makeDecor } from './landmarks';
import { makeModel, loadSkins } from './assets';
import { buildSurroundings } from './terrain';
import { buildHighway, HighwayTraffic } from './highway';
import { updateTrees } from './trees';
import { setSignalTime, updateSignals } from './signals';
import { TileInput } from './input';
import { setupAudioUnlock, play, isMuted, setMuted } from './audio';
import {
  buildCatalog, setMode, setStats, toast, setChip, floatIncome, floatText, hideLoading, showInfo, celebrateLevel, setThumbs,
  setLoading, loadFailed, openSettings, confirmDialog, onInfoClose, setCityName, fmt, type Quality,
} from './ui';

const SAVE_KEY = 'aksoy-city-save-v1';
const QUALITY_KEY = 'aksoy-city-quality';
const RAIN_KEY = 'aksoy-city-rain';
const NAME_KEY = 'aksoy-city-name';

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
// Çözünürlük: grafik ayarına göre ekranın kendi keskinliği; telefon zorlanırsa kendiliğinden biraz düşürülür,
// ama bulanıklaşmasın diye bir alt sınırın altına inmez (bkz. adaptQuality)
let quality: Quality = (readPref(QUALITY_KEY) as Quality) || 'high';
const dpr = () => window.devicePixelRatio || 1;
const maxRatio = () => (quality === 'high' ? Math.min(dpr(), 3) : quality === 'mid' ? Math.min(dpr(), 2) : Math.min(dpr(), 1.25));
const minRatio = () => (quality === 'high' ? Math.min(dpr(), 2) : quality === 'mid' ? Math.min(dpr(), 1.5) : 1);
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

// Kamera: tek parmakla kaydır, iki parmakla yakınlaştır ve döndür (bkz. camera.ts)
// Kamera şehrin batısındaki dağın eteğine (kayak merkezi, tünel, kavşak) kadar gidebilir
const rig = new CameraRig(camera, renderer.domElement, { minX: -SIZE / 2 - 22, maxX: SIZE / 2, minZ: -Z0, maxZ: ROWS - Z0 + 6 });
rig.target.copy(start);
rig.distance = 15;
rig.apply();

const hemi = new THREE.HemisphereLight('#ffffff', '#7a9a5a', 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff6e0', 2.2);
sun.position.set(-12, 30, 18);
sun.castShadow = quality !== 'low';
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { near: 1, far: 90 });
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
// Gölgeler kameranın baktığı bölgeyi kapsar (yakınken daha keskin); kamera epey kayınca yeniden çizilir
let shadowKey = '';
function followShadow() {
  const half = THREE.MathUtils.clamp(Math.ceil((rig.distance * 0.95) / 4) * 4, 20, 48);
  const step = half / 4;
  const cx = Math.round(rig.target.x / step) * step, cz = Math.round(rig.target.z / step) * step;
  const key = `${cx},${cz},${half}`;
  if (key === shadowKey) return;
  shadowKey = key;
  sun.target.position.set(cx, 0, cz);
  sun.target.updateMatrixWorld();
  sun.position.set(cx - 12, 30, cz + 18);
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
  sun.shadow.camera.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;
}

// Şehrin zemini çevre araziyle tek parça (terrain.ts); yolların asfaltı y=0'da, zemin biraz aşağıda
// İnşa ızgarası: haritanın kareleri (dikdörtgen)
const grid = (() => {
  const pts: number[] = [];
  const x0 = -SIZE / 2, x1 = SIZE / 2, z0 = -Z0, z1 = ROWS - Z0;
  for (let x = x0; x <= x1; x++) pts.push(x, 0, z0, x, 0, z1);
  for (let z = z0; z <= z1; z++) pts.push(x0, 0, z, x1, 0, z);
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18 }));
})();
grid.position.y = -0.01;
grid.visible = false; // ızgara sadece bir şey inşa ederken görünür
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
view.showLandShade(false);
const traffic = new Traffic(city);
scene.add(traffic.root);
const walkers = new Walkers(city);
scene.add(walkers.root);
traffic.link(walkers);
walkers.cars = () => traffic.boxes;
const trains = new Trains(city);
scene.add(trains.root);
const sky = new Sky(city);
scene.add(sky.root);
const helis = new Helicopters(city);
scene.add(helis.root);
const ski = new SkiResort();
scene.add(ski.root);
const highway = new HighwayTraffic();
scene.add(highway.root);
const weather = new Weather();
weather.enabled = readPref(RAIN_KEY) !== '0';
scene.add(weather.root);
const dayNight = new DayNight(scene, hemi, sun);
scene.add(dayNight.dome);
const fireworks = new Fireworks();
scene.add(fireworks.root);
// Havai fişeklerin atılacağı yerler: lunapark, stadyum, dönme dolap
let showSpots: THREE.Vector3[] = [];
function findShowSpots() {
  showSpots = [];
  city.tiles.forEach((t, i) => {
    if (!t || (t.kind !== 'funfair' && t.kind !== 'stadium' && t.kind !== 'wheel')) return;
    const n = t.fp ?? 1;
    showSpots.push(tileCenter((i % SIZE) + (n - 1) / 2, Math.floor(i / SIZE) + (n - 1) / 2));
  });
}

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
    day: city.day,
    night: phase(((city.day % CYCLE_DAYS) + 0.5) / CYCLE_DAYS).night > 0.5,
  });
let cityName = readPref(NAME_KEY) || 'Aksoy City';
setCityName(cityName);

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
  upgradeMaker(i) {
    const err = city.upgradeMaker(i);
    if (err) {
      toast(err, 'error');
      play('error', 0.3);
    } else {
      view.refresh([i], true);
      play('grow', 0.6);
      toast(`⭐ ${TOOL_INFO[city.tiles[i]!.kind as BuildTool].label} ${city.tiles[i]!.level + 1}. seviyeye yükseldi: daha hızlı üretiyor!`);
    }
    afterChange();
  },
  upgradeUtil(i) {
    const err = city.upgradeUtility(i);
    if (err) {
      toast(err, 'error');
      play('error', 0.3);
    } else {
      const t = city.tiles[i]!;
      view.refresh([i], true);
      play('grow', 0.6);
      toast(`⭐ ${TOOL_INFO[t.kind as BuildTool].label} ${t.level + 1}. seviyeye yükseldi: ${t.level + 1} kat üretiyor!`);
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
  ship(n) {
    const err = city.ship(n, Date.now());
    if (err) {
      toast(err, 'error');
      play('error', 0.3);
    } else {
      play('grow', 0.6);
      toast('🚢 Gemi yola çıktı! Ödül kasaya eklendi.');
    }
    afterChange();
  },
  renewOrders() {
    const err = city.renewOrders();
    if (err) toast(err, 'error');
    else play('click', 0.4);
    afterChange();
  },
  upgradeRoad(i) {
    const before = city.tiles[i]?.grade ?? 0;
    const res = city.upgradeStreet(i);
    if (res.error) {
      toast(res.error, 'error');
      play('error', 0.3);
    } else {
      view.refresh(res.done, true);
      play('grow', 0.6);
      toast(`⬆️ Yol ${ROAD_GRADES[before + 1].label.toLocaleLowerCase('tr')} oldu! Kenarındaki evler daha mutlu.`);
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
    : openCard === 'city' ? describeCity(city, cityName)
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

// Trafik haritası: yol aracı seçiliyken ya da bir yolun kartı açıkken
function updateTrafficView() {
  view.showTraffic(ROAD_TOOLS.includes(tool as BuildTool) || (typeof openCard === 'number' && city.tiles[openCard]?.kind === 'road'));
}

// Kartı açık binanın (ya da satılık arazinin) altını işaretle
function highlight() {
  updateTrafficView();
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
// Trafik ilk kez sıkışınca haber ver
let lastJams = -1;
function warnTraffic() {
  const jams = city.jams;
  if (jams > 0 && lastJams === 0) toast('🚗 Trafik sıkıştı! Kırmızı simgeli yollara dokunup bulvar ya da caddeye yükselt.', 'error');
  lastJams = jams;
}

function afterChange() {
  warnTraffic();
  findShowSpots();
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
// Konut sekmesinden seçilen ev modeli (yoksa konut alanı kendiliğinden büyür)
let house: { level: number; model: number } | null = null;

// İnşa modunda tek parmak çizer, gez modunda kaydırır
rig.singlePan = () => tool === 'pan';
function applyControls() {
  rig.stop();
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
  house = null;
  openCard = null;
  input.cancelDrag();
  view.showPreview([]);
  showInfo(null);
  showCoverage();
  setChip(null);
  setMode(t);
  grid.visible = t !== 'pan';
  view.showLandShade(t !== 'pan');
  updateTrafficView();
  applyControls();
  play('click', 0.4);
}

function pickHouse(level: number, model: number) {
  const lock = city.houseBlocker(level);
  if (lock) {
    toast(`🔒 ${lock}`, 'error');
    play('error', 0.3);
    return;
  }
  pickTool('res');
  house = { level, model };
  const path = RES_LEVELS[level - 1].models[model];
  setMode('res', { thumb: `house:${level}:${model}`, label: houseName(path), hint: `${level}. seviye · 💰${fmt(HOUSE_PRICE[level])} · yol kenarına dokun ya da sürükle` });
}

// Ev modellerinin menü resimleri: Konut sekmesi ilk açılınca parça parça çizilir (oyun takılmasın)
let housePics = false;
function makeHousePictures() {
  if (housePics) return;
  housePics = true;
  const list: [string, string][] = [];
  RES_LEVELS.forEach((lv, l) => lv.models.forEach((path, m) => list.push([`house:${l + 1}:${m}`, path])));
  const r = thumbRenderer();
  let k = 0;
  const step = () => {
    try {
      setThumbs(r.render(list.slice(k, k + 6).map(([key, path]) => [key, makeModel(path)])));
    } catch (err) {
      console.warn('Ev resimleri çizilemedi', err);
      k = list.length;
    }
    k += 6;
    if (k < list.length) requestAnimationFrame(step);
    else r.dispose();
  };
  requestAnimationFrame(step);
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
    if (ROAD_TOOLS.includes(build)) {
      // Yol: çizilecek yolun kendisi görünsün; olmayan yerler kırmızı
      view.showRoadPreview(items.filter(c => c.ok).map(c => c.i), ROAD_TOOLS.indexOf(build));
      view.showPreview(items.filter(c => !c.ok));
    } else view.showPreview(items);
    const n = items.filter(c => c.ok).length;
    if (coverKind(tool)) showCoverage(items[0]?.ok ? cells[0] : undefined);
    if (tool === 'res' && house) {
      const path = RES_LEVELS[house.level - 1].models[house.model];
      setChip(`${n > 1 ? `${n} × ` : ''}${houseName(path)} · 💰${fmt(n * HOUSE_PRICE[house.level])}`);
    } else if (cells.length === 1 && (isUtility(tool) || isService(tool) || isIndustry(tool) || isDecor(tool))) {
      setChip(`${TOOL_INFO[tool].label} · 💰${fmt(COST[tool])}${size > 1 ? ` · ${size}×${size} kare` : ''}`);
    } else if (cells.length > 1) {
      const okCells = items.filter(c => c.ok).map(c => c.i);
      setChip(tool === 'bulldoze' ? `${n} kare yıkılacak` : `${n} kare · 💰${fmt(city.costOf(tool, okCells))}`);
    }
  },
  commit(cells) {
    view.showPreview([]);
    view.showRoadPreview([], 0);
    setChip(null);
    if (tool === 'pan') return;
    const res = tool === 'res' && house ? city.placeHouse(cells, house.level, house.model) : city.apply(tool, cells);
    showCoverage();
    if (res.error) {
      toast(res.error, 'error');
      play('error', 0.3);
      return;
    }
    view.refresh(res.done, tool !== 'bulldoze');
    play(tool === 'bulldoze' ? 'remove' : 'place');
    afterChange();
    if (!ROAD_TOOLS.includes(tool) && tool !== 'bulldoze' && tool !== 'park' && res.done.some(i => !city.isConnected(i))) {
      toast('Bu yol şehir girişine bağlı değil. Yolu soldaki otoyola bağla!', 'error');
    }
  },
  cancel() {
    view.showPreview([]);
    view.showRoadPreview([], 0);
    setChip(null);
    showCoverage();
  },
  tap(cell) {
    openTile(cell);
    if (openCard !== null) play('click', 0.3);
  },
});

const catalog = buildCatalog(t => pickTool(t), lockedAt, () => city.money, {
  pick: pickHouse,
  lock: level => (city.level < HOUSE_UNLOCK[level] ? HOUSE_UNLOCK[level] : null),
  pictures: makeHousePictures,
});
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
  ['power', 'power'], ['water', 'water'], ['happy', 'hall'], ['clock', 'city'],
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
  helis.setCity(city);
  afterChange();
  toast('Yeni şehir kuruldu!');
}

document.getElementById('settings')!.addEventListener('click', () => {
  play('click', 0.3);
  openSettings(
    { sound: !isMuted(), quality, rain: weather.enabled, name: cityName },
    {
      sound: on => setMuted(!on),
      quality: applyQuality,
      rain: on => {
        weather.enabled = on;
        writePref(RAIN_KEY, on ? '1' : '0');
      },
      reset: resetCity,
      rename: name => {
        cityName = name;
        writePref(NAME_KEY, name);
        setCityName(name);
      },
    },
  );
});

// --- Kamera döndürme: iki parmakla serbestçe; pusulaya dokununca ilk açıya döner ---
const needle = document.querySelector<HTMLElement>('#compass .needle')!;
let shownYaw = NaN;
function updateCompass() {
  if (Math.abs(rig.yaw - shownYaw) < 0.002) return;
  shownYaw = rig.yaw;
  needle.style.transform = `rotate(${(rig.yaw * 180) / Math.PI}deg)`;
}
document.getElementById('compass')!.addEventListener('click', () => {
  rig.resetRotation();
  play('click', 0.3);
});
window.addEventListener('keydown', e => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (e.key === 'q' || e.key === 'Q') rig.rotateBy(-Math.PI / 4);
  if (e.key === 'e' || e.key === 'E') rig.rotateBy(Math.PI / 4);
  if (e.key === 'Escape') {
    pickTool('pan');
    catalog.close();
    openTile(null);
  }
});

// --- Ekran boyutu ve oyun döngüsü ---
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  rig.apply();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let dayTimer = 0;
let prodTimer = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.25);
  rig.update(dt);
  updateCompass();

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
    // Gemisi dönen limana yeni sipariş gelsin
    if (city.updateOrders(Date.now())) afterChange();
  }

  view.update(dt);
  if (view.shadowDirty) {
    view.shadowDirty = false;
    renderer.shadowMap.needsUpdate = true;
  }
  adaptQuality(dt);
  setSignalTime(clock.elapsedTime);
  updateSignals();
  traffic.update(dt);
  walkers.update(dt, weather.amount);
  trains.update(dt);
  highway.update(dt);
  sky.update(dt);
  helis.update(dt);
  ski.update(dt);
  weather.update(dt, rig.target);
  updateWater(clock.elapsedTime);
  updateTrees(clock.elapsedTime);
  followShadow();
  dayNight.dome.position.copy(camera.position);
  fireworks.update(dt, phase(((city.day % CYCLE_DAYS) + dayTimer / DAY_SECONDS) / CYCLE_DAYS).night, showSpots);
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

// Kare hızı düşükse çözünürlüğü biraz azalt, hızlanınca geri artır. Açılıştaki ilk saniyeler (yükleme)
// ve arka planda geçen süre sayılmaz. Pil tasarrufunda telefon 30 kareye inse bile alt sınırın altına düşmez.
let slowTime = 0;
let fastTime = 0;
let warmup = 5;
function adaptQuality(dt: number) {
  if (warmup > 0 || dt > 0.25) {
    warmup -= Math.min(dt, 0.25);
    return;
  }
  if (dt > 1 / 40) {
    slowTime += dt;
    fastTime = 0;
  } else {
    slowTime = Math.max(0, slowTime - dt * 0.5);
    if (dt < 1 / 52) fastTime += dt;
  }
  let next = pixelRatio;
  if (slowTime > 2 && pixelRatio > minRatio()) next = Math.max(minRatio(), pixelRatio - 0.25);
  else if (fastTime > 6 && pixelRatio < maxRatio()) next = Math.min(maxRatio(), pixelRatio + 0.25);
  if (next === pixelRatio) return;
  pixelRatio = next;
  renderer.setPixelRatio(pixelRatio);
  resize();
  slowTime = fastTime = 0;
}

// Menü düğmeleri için her binanın küçük resmini çiz
function makeMenuPictures() {
  const items: [string, THREE.Object3D][] = [
    ['road', makeModel('kaykit/road_junction')],
    ['avenue', gradedRoadModel(2)],
    ['boulevard', gradedRoadModel(1)],
    ['rail', railPiece(0b0110)],
    ['res', makeModel('kaykit/building_C')],
    ['com', makeModel('kaykit/building_E')],
    ['park', makeModel('kenney/models/grass-trees-tall')],
    ['hall', makeHall()],
  ];
  for (const k of ['wind', 'solar', 'plant', 'tower', 'pump'] as const) items.push([k, makeUtility(k)]);
  for (const k of ['police', 'fire', 'health', 'school'] as const) items.push([k, makeService(k)]);
  for (const k of ['factory', 'store', 'market', 'furniture', 'bakery', 'fashion', 'depot', 'port'] as const) items.push([k, makeIndustry(k)]);
  for (const k of ['fountain', 'statue', 'wheel', 'stadium', 'station', 'busstop', 'parking', 'uni', 'airport', 'beach', 'metro', 'clocktower', 'museum', 'funfair', 'lighthouse', 'marina', 'mosque', 'zoo', 'eiffel', 'liberty', 'pisa', 'colosseum', 'galata', 'pyramid'] as const) items.push([k, makeDecor(k)]);
  try {
    setThumbs(renderThumbs(items));
  } catch (err) {
    console.warn('Menü resimleri çizilemedi', err);
  }
}

Promise.all([loadModels(ALL_MODELS, (done, total) => setLoading(done / total)), loadSkins(SKINS)])
  .then(() => {
    scene.add(buildSurroundings(), buildHighway());
    highway.init();
    ski.init();
    traffic.init();
    trains.init();
    sky.init();
    view.rebuildAll();
    makeMenuPictures();
    // Oyun kapalıyken biten üretimleri depoya al
    const got = city.collect(Date.now());
    if (got.length) toast(`Sen yokken ${got.length} malzeme üretildi! 📦`);
    if (city.tradeRefund) toast(`Ticaret merkezi kaldırıldı, parası iade edildi: 💰${fmt(city.tradeRefund)}`);
    if (city.seaRefund) toast(`Kuzey kıyısı artık deniz! Oradaki yapıların parası iade edildi: 💰${fmt(city.seaRefund)}`);
    afterChange();
    hideLoading();
    if (!city.hasZones) toast('Hoş geldin! Sağ alttaki İnşa Et düğmesinden yol ve konut yap.');
    renderer.setAnimationLoop(frame);
    // Geliştirirken performansı ölçebilmek için (yayında çalışmaz)
    if (import.meta.env.DEV) Object.assign(window, { __aksoy: { renderer, scene, camera, rig, city: () => city, weather, view, sky, highway, traffic, walkers, helis, open: openTile, pick: pickTool, refresh: afterChange } });
  })
  .catch(err => {
    console.error(err);
    loadFailed();
  });
