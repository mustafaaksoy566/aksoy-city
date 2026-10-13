import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  SIZE, ROWS, X0, Z0, PLOT, PLOTS, DAY_SECONDS, dayNumber, COST, TOOL_INFO, SERVICES, DECOR, UTILITIES, ALL_MODELS, ENTRANCE_Z, ENTRANCE_LEN, MATERIALS, MAT_IDS, UNLOCK,
  LEVEL_REWARD, ROAD_TOOLS, ROAD_GRADES, RES_LEVELS, HOUSE_PRICE, HOUSE_UNLOCK, MAKERS, houseName, type Tool, type BuildTool, type MatId, type ServiceKind,
} from './config';
import { City, DIRS, idx, isUtility, isService, isIndustry, isDecor, isZone, areaAround, sizeOf, block } from './city';
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
import { CityView, tileCenter, gradedRoadModel, entranceTile } from './view';
import { mergeStatic } from './batcher';
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
import { makePark } from './fun';
import { MetroView } from './metro';
import { tunnelThumb } from './places';
import { makeModel } from './assets';
import { buildSurroundings, heightAt } from './terrain';
import { buildHighway, HighwayTraffic } from './highway';
import { updateTrees } from './trees';
import { setSignalTime, updateSignals } from './signals';
import { TileInput } from './input';
import { setupAudioUnlock, play, isMuted, setMuted } from './audio';
import {
  buildCatalog, setMode, setStats, toast, setChip, floatIncome, floatText, hideLoading, showInfo, celebrateLevel, setThumbs,
  setLoading, loadFailed, openSettings, confirmDialog, onInfoClose, setCityName, fmt, setServiceBar, setPlaceBar, thumbOf, type Quality,
} from './ui';
import { ProductionPanel, setProductPics } from './production';
import { makeItem, ITEM_IDS } from './items';

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
// stencil: alt geçit hendeklerinde zemini delmek için (bkz. view.ts underHole)
const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
// Çözünürlük: grafik ayarına göre ekranın kendi keskinliği; telefon zorlanırsa kendiliğinden biraz düşürülür,
// ama bulanıklaşmasın diye bir alt sınırın altına inmez (bkz. adaptQuality)
let quality: Quality = (readPref(QUALITY_KEY) as Quality) || 'high';
const dpr = () => window.devicePixelRatio || 1;
const maxRatio = () => (quality === 'high' ? Math.min(dpr(), 3) : quality === 'mid' ? Math.min(dpr(), 2) : Math.min(dpr(), 1.25));
// Yüksek grafikte ekranın kendi keskinliğinin altına hiç inilmez (telefonda bulanık görünmesin)
const minRatio = () => (quality === 'high' ? Math.min(dpr(), 3) : quality === 'mid' ? Math.min(dpr(), 1.5) : 1);
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
// Batıda göbek kavşağa ve tünel ağzına kadar gezilir (tünel ağzı x = -44'te; hedef dağın içine girmesin)
const rig = new CameraRig(camera, renderer.domElement, { minX: -X0 - 19, maxX: SIZE - X0, minZ: -Z0, maxZ: ROWS - Z0 + 6 });
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
  const x0 = -X0, x1 = SIZE - X0, z0 = -Z0, z1 = ROWS - Z0;
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
view.cam = camera;
// Yeraltı (metro) görünümü: metro hatları, istasyonlar ve trenler
const metroView = new MetroView();
scene.add(metroView.root);
let metroButton = false; // Metro düğmesiyle açıldı mı (araç değişince kapanmasın)
function setUnderground(on: boolean) {
  if (on === metroView.visible) return;
  metroView.visible = on;
  if (on) {
    metroView.rebuild(city);
    mapKind = null;
    renderServiceMap();
  }
  document.getElementById('metro-btn')?.classList.toggle('on', on);
}
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
// Otobandan şehre giren ve şehirden otobana çıkan arabalar birbirine devredilir (girişte birden belirip kaybolmasınlar)
traffic.highway = highway;
highway.enterCity = (type, paint, wide) => traffic.enterFromHighway(type, paint, wide);
highway.cityBusy = wide => traffic.entranceBusy(wide);
highway.cityWants = () => traffic.wantsCars();
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
    day: dayNumber(city.day),
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
  upgradeMetro(i) {
    const err = city.upgradeMetro(i);
    if (err) {
      toast(err, 'error');
      play('error', 0.3);
    } else {
      view.refresh([i], true);
      play('grow', 0.6);
      toast(`🚇 Metro istasyonu ${city.tiles[i]!.level + 1}. seviyeye yükseldi: daha geniş alana hizmet veriyor!`);
    }
    afterChange();
  },
  showMetro() {
    openTile(null);
    metroButton = true;
    setUnderground(true);
  },
  upgradeParking(i) {
    const err = city.upgradeParking(i);
    if (err) {
      toast(err, 'error');
      play('error', 0.3);
    } else {
      view.refresh([i], true);
      play('grow', 0.6);
      toast(`🅿️ Otopark ${city.tiles[i]!.level + 1} katlı oldu: daha çok araba sığıyor!`);
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
  underpass(i) {
    const err = city.buildUnderpass(i);
    if (err) {
      toast(err, 'error');
      play('error', 0.3);
    } else {
      city.refresh();
      const cells = [i];
      for (const [dx, dz] of DIRS) cells.push(idx((i % SIZE) + dx, Math.floor(i / SIZE) + dz));
      view.refresh(cells, false);
      play('grow', 0.6);
      toast('🚇 Alt geçit yapıldı! Caddenin iç şeritleri artık ışıkta beklemeden alttan geçiyor.');
    }
    afterChange();
  },
  underpassExtend(i) {
    const plan = city.extendPlan(i);
    const err = city.extendUnderpass(i);
    if (err) {
      toast(err, 'error');
      play('error', 0.3);
    } else {
      city.refresh();
      view.refresh('error' in plan ? [i] : [...plan.cover, plan.ramp], false);
      play('grow', 0.6);
      toast('🚇 Alt geçit uzatıldı! Yeni rampa ileride.');
      openTile(i);
    }
    afterChange();
  },
  underpassSwitch(i) {
    const err = city.switchUnderpass(i);
    if (err) {
      toast(err, 'error');
      play('error', 0.3);
    } else {
      city.refresh();
      view.refresh([i], false);
      play('click', 0.5);
      toast('🚇 Alt geçit öbür caddeye alındı.');
      openTile(i);
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
  // Taşınabilen binanın kartında "Taşı" (döndürmek de taşıma çubuğundaki ↻ ile). Eski küçük dükkân taşınınca
  // otoparklı 2x2 dükkân olur.
  if (card && typeof openCard === 'number' && tool === 'pan' && city.tiles[openCard] && city.canMove(openCard)) {
    const i = openCard;
    const label = grows(city.anchorOf(i)) ? '🅿️ Taşı · otoparklı 2x2 olsun' : '✋ Taşı';
    card.actions = [...(card.actions ?? []), { label, enabled: true, run: () => startMove(i) }];
  }
  showInfo(card);
}

// --- Üretim ekranı (fabrika ve dükkanlar, SimCity'deki gibi) ---
const isMaker = (k: string | undefined) => !!k && (MAKERS as string[]).includes(k);
// Binanın ortası (büyük binada kapladığı alanın ortası)
function buildingCenter(i: number) {
  const n = city.tiles[i]?.fp ?? 1;
  return tileCenter((i % SIZE) + (n - 1) / 2, Math.floor(i / SIZE) + (n - 1) / 2);
}
// Kamera yumuşakça bir yerden bir yere gider (konum, uzaklık, dönüş ve eğim birlikte)
type CamPose = { target: THREE.Vector3; distance: number; yaw: number; tilt: number };
let camTween: { from: CamPose; to: CamPose; t: number; done?: () => void } | null = null;
const poseNow = (): CamPose => ({ target: rig.target.clone(), distance: rig.distance, yaw: rig.yaw, tilt: rig.tilt });
function tweenTo(to: CamPose, done?: () => void) {
  const from = poseNow();
  // Kısa yoldan dönsün
  let d = (to.yaw - from.yaw) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  camTween = { from, to: { ...to, yaw: from.yaw + d }, t: 0, done };
}
function stepCamTween(dt: number) {
  if (!camTween) return;
  camTween.t = Math.min(1, camTween.t + dt / 0.6);
  const k = camTween.t < 0.5 ? 4 * camTween.t ** 3 : 1 - Math.pow(-2 * camTween.t + 2, 3) / 2;
  const { from, to } = camTween;
  rig.target.lerpVectors(from.target, to.target, k);
  rig.distance = from.distance + (to.distance - from.distance) * k;
  rig.yaw = from.yaw + (to.yaw - from.yaw) * k;
  rig.tilt = from.tilt + (to.tilt - from.tilt) * k;
  rig.apply();
  if (camTween.t >= 1) {
    const done = camTween.done;
    camTween = null;
    done?.();
  }
}
// Üretim ekranında kamera binanın önüne iner (yakın plan); kapatınca eski yerine döner
let savedPose: (CamPose & { min: number }) | null = null;
const MIN_DISTANCE = rig.minDistance;
function focusOn(i: number) {
  const t = city.tiles[i];
  const n = t?.fp ?? 1;
  if (!savedPose) savedPose = { ...poseNow(), min: rig.minDistance };
  rig.minDistance = 3;
  const f = t?.facing ?? 2;
  const distance = n > 1 ? 4.4 + n * 1.25 : 4.2;
  const target = buildingCenter(i).setY(0.12 * n);
  const want = n > 1 ? 0.5 : 0.42;
  // Binanın kapısının baktığı yönden, biraz yandan (üç çeyrek görünüm). Önünde gökdelen varsa
  // binayı en iyi gören açı seçilir; gerekirse kamera biraz yukarıdan bakar.
  const front = Math.atan2(DIRS[f][0], DIRS[f][1]);
  // Önünü en az binanın kapattığı açı seçilir (öne yakın olan tercih edilir); kalan binalar geçici gizlenir
  let best = { yaw: front + 0.38, hide: [] as number[], cost: Infinity };
  const len = Math.cos(want) * distance;
  for (const [off, penalty] of [[0.38, 0], [-0.38, 0.05], [0, 0.1], [0.85, 0.3], [-0.85, 0.35], [Math.PI / 2, 0.8], [-Math.PI / 2, 0.8], [Math.PI, 1.2]] as [number, number][]) {
    const yaw = front + off;
    const hide = view.blockers(target.x, target.z, target.y, Math.sin(yaw), Math.cos(yaw), len, Math.tan(want), i);
    const cost = hide.length + penalty;
    if (cost < best.cost) best = { yaw, hide, cost };
  }
  view.setHidden(best.hide);
  tweenTo({ target, distance, yaw: best.yaw, tilt: rig.tiltFor(want, distance) });
}
function unfocus() {
  if (!savedPose) return;
  const p = savedPose;
  savedPose = null;
  tweenTo(p, () => (rig.minDistance = p.min || MIN_DISTANCE));
}
// Hazır ürünleri depoya al; ekrandaki yerden depo düğmesine uçsunlar
function collectFrom(i: number, from?: { x: number; y: number }) {
  const before = city.readyAt(i, Date.now()).length;
  const got = city.collectAt(i, Date.now());
  if (got.length) {
    floatStorage(got);
    if (from) prod.flyToStorage(got, from);
    play('place', 0.45);
  }
  if (got.length < before) {
    toast('📦 Depo dolu! Depo kur, liman siparişi gönder ya da ev yükselt.', 'error');
    play('error', 0.3);
  }
  afterChange();
  return got;
}
// Fabrika ve dükkanlar sırayla (◀ ▶ ile gezilir)
function makerList() {
  const out: number[] = [];
  city.tiles.forEach((t, i) => t && isMaker(t.kind) && out.push(i));
  return out.sort((a, b) => MAKERS.indexOf(city.tiles[a]!.kind as never) - MAKERS.indexOf(city.tiles[b]!.kind as never) || a - b);
}
const prodHandlers = {
  city: () => city,
  thumb: (k: string) => thumbOf(k),
  anchor(i: number) {
    const n = city.tiles[i]?.fp ?? 1;
    const p = buildingCenter(i).setY(0.3 + n * 0.12).project(camera);
    if (p.z > 1) return null;
    const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  },
  make(i: number, mat: MatId) {
    const err = city.startJob(i, mat, Date.now());
    if (!err) afterChange();
    return err;
  },
  collect: (i: number) => collectFrom(i),
  speedUp(i: number, k: number) {
    const err = city.speedUp(i, k, Date.now());
    if (!err) afterChange();
    return err;
  },
  cancel(i: number, k: number) {
    const err = city.cancelJob(i, k, Date.now());
    if (!err) afterChange();
    return err;
  },
  async buySlot(i: number) {
    const price = city.slotPrice(i);
    if (price === null) return;
    const ok = await confirmDialog('Yeni üretim yeri', `Bu binaya bir üretim yeri daha açılsın mı? Fiyatı 💰${fmt(price)}.`, `Aç 💰${fmt(price)}`);
    if (!ok) return;
    const err = city.buySlot(i);
    if (err) {
      toast(err, 'error');
      play('error', 0.3);
    } else {
      play('grow', 0.5);
      toast('➕ Yeni üretim yeri açıldı!');
    }
    afterChange();
  },
  upgrade(i: number) {
    cardActions.upgradeMaker(i);
  },
  info(i: number) {
    closeProduction();
    openTile(i);
  },
  cycle(d: number) {
    const list = makerList();
    if (!list.length || prod.i === null) return;
    const k = list.indexOf(prod.i);
    const next = list[(k + d + list.length) % list.length];
    openProduction(next);
    play('click', 0.3);
  },
  close: () => closeProduction(),
  sound: (name: 'click' | 'place' | 'error' | 'grow') => play(name, name === 'error' ? 0.3 : 0.4),
  toast: (text: string, error?: boolean) => toast(text, error ? 'error' : 'info'),
};
const prod = new ProductionPanel(prodHandlers);
function openProduction(i: number) {
  if (openCard !== null) openTile(null);
  focusOn(i);
  // Açılınca hazır ürünler hemen depoya gelir
  const ready = city.readyAt(i, Date.now()).length;
  prod.open(i);
  if (ready) {
    const a = prodHandlers.anchor(i);
    collectFrom(i, a ?? undefined);
  }
  view.showSelection(city.cellsOf(i));
  view.showIcons(false);
}
function closeProduction() {
  if (!prod.isOpen) return;
  prod.close();
  view.showSelection([]);
  view.setHidden([]);
  view.showIcons(true);
  unfocus();
}

function openTile(cell: CardKey | null) {
  if (cell !== null) closeProduction();
  openCard = cell;
  renderCard();
  highlight();
  // Hizmet, elektrik ya da su binasına (ya da üstteki elektrik/su göstergesine) dokununca hizmet haritası açılır.
  // Harita açıkken haritayı kaydırmak, boşa ya da başka binaya dokunmak onu kapatmaz (alanı rahatça görülsün);
  // başka bir hizmet binasına dokununca onun haritasına geçer, sadece haritanın ✕ düğmesi kapatır.
  const k = typeof cell === 'number' ? mapKindOf(cell) : cell === 'power' || cell === 'water' ? cell : null;
  if (k) mapKind = k;
  renderServiceMap();
}
onInfoClose(() => {
  openCard = null;
  highlight();
});

// --- Hizmet haritası (SimCity'deki gibi): şehir beyazlaşır; hizmetin ulaştığı yer yeşil, ulaşmayan evler kırmızı ---
type MapKind = 'power' | 'water' | ServiceKind;
const MAP_KINDS: MapKind[] = ['power', 'water', 'police', 'fire', 'health', 'school'];
const MAP_INFO: Record<MapKind, { icon: string; name: string }> = {
  power: { icon: '⚡', name: 'Elektrik' },
  water: { icon: '💧', name: 'Su' },
  police: { icon: '🚓', name: 'Polis' },
  fire: { icon: '🚒', name: 'İtfaiye' },
  health: { icon: '🏥', name: 'Sağlık' },
  school: { icon: '🎓', name: 'Eğitim' },
};
let mapKind: MapKind | null = null;
function mapKindOf(i: number): MapKind | null {
  const t = city.tiles[city.anchorOf(i)];
  if (!t) return null;
  if (isUtility(t.kind)) return UTILITIES[t.kind].power > 0 ? 'power' : 'water';
  if (isService(t.kind)) return t.kind;
  if (isDecor(t.kind) && DECOR[t.kind].covers) return DECOR[t.kind].covers!;
  return null;
}
function renderServiceMap() {
  const k = mapKind;
  if (!k) {
    view.showServiceMap(null);
    setServiceBar(null);
    return;
  }
  const fk = k === 'power' || k === 'water' ? k : null;
  const flow = fk !== null;
  const bldgs: { i: number; ok: boolean }[] = [];
  let ok = 0, bad = 0;
  city.tiles.forEach((t, i) => {
    if (!t || t.level === 0) return;
    if (flow ? !isZone(t.kind) : t.kind !== 'res') return;
    const good = fk ? city.isConnected(i) && !city.lacking.get(i)?.[fk] : city.isCovered(i, k as ServiceKind);
    bldgs.push({ i, ok: good });
    if (good) ok++;
    else bad++;
  });
  // Hizmeti veren binalar kendi renkleriyle görünür (hizmet nereden geliyor belli olsun)
  const srcs: number[] = [];
  city.tiles.forEach((t, i) => {
    if (t && t.kind !== 'part' && mapKindOf(i) === k) srcs.push(i);
  });
  const sources = srcs.length;
  view.showServiceMap({ area: fk ? [] : city.coverageOf(k as ServiceKind), color: '#3fcf4a', bldgs, sources: srcs });
  const s = fk ? city.service[fk] : null;
  setServiceBar(
    {
      ...MAP_INFO[k],
      ok,
      bad,
      okText: flow ? 'Var' : 'Hizmet var',
      badText: flow ? 'Yok' : 'Hizmet yok',
      extra: s
        ? `Üretim ${fmt(s.supply)} · Kullanım ${fmt(s.demand)}${s.supply < s.demand ? ' · Yetmiyor!' : ''}`
        : sources
          ? `${sources} bina hizmet veriyor · yeşil alan hizmetin ulaştığı yer`
          : 'Henüz hiç yok · İnşa Et → Hizmetler',
    },
    {
      prev: () => cycleMap(-1),
      next: () => cycleMap(1),
      close: () => {
        mapKind = null;
        renderServiceMap();
        if (openCard !== null) openTile(null);
      },
    },
  );
}
function cycleMap(d: number) {
  if (!mapKind) return;
  mapKind = MAP_KINDS[(MAP_KINDS.indexOf(mapKind) + d + MAP_KINDS.length) % MAP_KINDS.length];
  renderServiceMap();
  play('click', 0.3);
}

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
  // Elektrik/su göstergesine ikinci kez dokununca haritası da kapanır
  if (openCard === key && (key === 'power' || key === 'water')) {
    mapKind = null;
    renderServiceMap();
  }
  openTile(openCard === key ? null : key);
  play('click', 0.3);
}

// Metro düğmesi: yeraltını aç/kapat
document.getElementById('metro-btn')!.addEventListener('click', () => {
  metroButton = !metroView.visible;
  if (!metroButton && tool === 'tunnel') pickTool('pan');
  setUnderground(metroButton);
  toast(metroButton ? '🚇 Yeraltı: renkli hatlarda trenler çalışıyor, gri hatlar bir istasyona daha bağlanmalı' : 'Yeryüzüne dönüldü');
  play('click', 0.4);
});

// Bir şey değişince her yeri güncelle ve kaydet
// Trafik ilk kez sıkışınca haber ver
let lastJams = -1;
function warnTraffic() {
  const jams = city.jams;
  if (jams > 0 && lastJams === 0) toast('🚗 Trafik sıkıştı! Kırmızı simgeli yollara dokunup bulvar ya da caddeye yükselt.', 'error');
  lastJams = jams;
}

// Şehir dışındaki yollar: şehre giren yol, girişteki yolun türüne göre çizilir (giriş yükseltilince yeniden)
let highwayMesh: THREE.Object3D | null = null;
let highwayGrade = -1;
function syncHighway() {
  const grade = city.tiles[idx(0, ENTRANCE_Z)]?.grade ?? 0;
  if (grade === highwayGrade) return;
  highwayGrade = grade;
  if (highwayMesh) scene.remove(highwayMesh);
  highwayMesh = buildHighway(grade);
  // Şehrin girişinden şehir dışına iki kare: şehirdeki yolun aynısı (yol, bulvar ya da cadde), kesintisiz birleşir
  const link = new THREE.Group();
  for (const x of [-1, -2]) {
    const t = entranceTile(grade, x + 30);
    t.position.copy(tileCenter(x, ENTRANCE_Z));
    link.add(t);
  }
  highwayMesh.add(mergeStatic([link]));
  scene.add(highwayMesh);
  highway.setCityLanes(traffic.entranceLanes());
}

function afterChange() {
  if (highwayMesh) syncHighway();
  warnTraffic();
  findShowSpots();
  showEvents();
  checkLevelUps();
  view.updateIcons();
  renderCard();
  if (prod.isOpen) prod.refresh();
  if (mapKind) renderServiceMap();
  if (metroView.visible) metroView.rebuild(city);
  const mb = document.getElementById('metro-btn');
  if (mb) mb.hidden = !city.isUnlocked('metro') && !city.tiles.some(t => t?.kind === 'metro');
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
rig.clearance = (x, z) => view.topNear(x, z);
// Şehir dışındaki tepe ve dağlar: kamera dağın içine girmez (içinden bakınca tünel ve yollar beyaz boşlukta asılı
// görünüyordu). Arazinin yüksekliği karelik ızgarada bir kez hesaplanıp saklanır (karenin en yüksek köşesi).
const groundMemo = new Map<number, number>();
rig.terrain = (x, z) => {
  const ix = Math.floor(x), iz = Math.floor(z);
  const key = (ix + 1000) * 4000 + (iz + 1000);
  let h = groundMemo.get(key);
  if (h === undefined) {
    h = Math.max(heightAt(ix, iz), heightAt(ix + 1, iz), heightAt(ix, iz + 1), heightAt(ix + 1, iz + 1));
    groundMemo.set(key, h);
  }
  return h;
};
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
  cancelMove();
  closeProduction();
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
  mapKind = null;
  renderServiceMap();
  // Metro hattı çizerken yeraltı görünür; Metro düğmesiyle açıldıysa yıkma aracı tünel siler
  if (t !== 'pan' && t !== 'tunnel' && t !== 'bulldoze') metroButton = false;
  setUnderground(t === 'tunnel' || metroButton);
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

// --- Binayı taşıma ve döndürme ---
// Basılı tut (ya da kartta "Taşı"): bina kalkar. Sürükle: yeni yeri yeşil/kırmızı görünür. Bırakınca orada bekler:
// ✓ yerleştir, ✗ eski yerine ve eski yönüne dön, ↻ çeyrek tur döndür. Beklerken binaya dokunup yeniden sürüklenebilir.
let moving: { from: number; n: number; to: number; turns: number; dragging: boolean } | null = null;
// Eski kayıttan kalan küçük bina (1x1 dükkân): taşınınca yeni boyunda (otoparklı 2x2) yerleşir
const grows = (a: number) => (city.tiles[a]?.fp ?? 1) < sizeOf(city.tiles[a]!.kind);
function startMove(cell: number) {
  const a = city.anchorOf(cell);
  moving = { from: a, n: Math.max(city.tiles[a]!.fp ?? 1, sizeOf(city.tiles[a]!.kind)), to: a, turns: 0, dragging: false };
  openTile(null);
  view.startMove(a);
  setPlaceBar(true, { ok: confirmMove, cancel: cancelMove, rotate: rotateMove });
  showMovePreview();
  play('click', 0.5);
  navigator.vibrate?.(25);
}
function moveError() {
  const m = moving!;
  return m.to === m.from && !grows(m.from) ? null : city.moveCheck(m.from, m.to % SIZE, Math.floor(m.to / SIZE));
}
function showMovePreview() {
  const m = moving!;
  const err = moveError();
  view.showPreview((block(m.to % SIZE, Math.floor(m.to / SIZE), m.n) ?? []).map(i => ({ i, ok: err === null })));
  setChip(err ? `⛔ ${err}` : m.dragging ? '✅ Buraya koyabilirsin' : '✓ Tamam: buraya koy · ✗ Vazgeç: eski yerine · ↻ Döndür');
}
function endMoving() {
  moving = null;
  view.showPreview([]);
  setChip(null);
  setPlaceBar(false);
}
function confirmMove() {
  const m = moving;
  if (!m) return;
  if (m.to === m.from && m.turns === 0 && !grows(m.from)) {
    view.endMove(false);
    endMoving();
    return;
  }
  // Önü yola bakmalı (arkası yola dönmez)
  const ok = city.facingsAt(m.from, m.to % SIZE, Math.floor(m.to / SIZE));
  const facing = ok.includes(movingFacing(m)) ? movingFacing(m) : ok[0];
  const res = city.moveBuilding(m.from, m.to % SIZE, Math.floor(m.to / SIZE), facing);
  if (res.error) {
    toast(res.error, 'error');
    play('error', 0.3);
    return;
  }
  view.endMove(true);
  view.refresh(res.cells, true);
  endMoving();
  play('place', 0.6);
  toast(m.to === m.from ? '↻ Binanın yönü değişti' : '🚚 Bina yeni yerine taşındı');
  afterChange();
}
function cancelMove() {
  if (!moving) return;
  view.endMove(false);
  endMoving();
  play('click', 0.3);
}
// Taşınan binanın şu anki yönü (kapısının baktığı yön)
function movingFacing(m: NonNullable<typeof moving>) {
  return (city.tiles[m.from]!.facing + m.turns) % 4;
}
function setMovingFacing(f: number) {
  const m = moving!;
  m.turns = (f - city.tiles[m.from]!.facing + 4) % 4;
  view.turnLifted(m.turns);
}
// Bina önü ancak yola bakacak şekilde döner: ↻ bir sonraki yola bakan yöne çevirir
function rotateMove() {
  if (!moving) return;
  const m = moving;
  const ok = city.facingsAt(m.from, m.to % SIZE, Math.floor(m.to / SIZE));
  const f = movingFacing(m);
  const next = [1, 2, 3].map(k => (f + k) % 4).find(d => ok.includes(d));
  if (next === undefined) {
    toast('Binanın önü yola bakmalı; burada başka yöne dönemez');
    play('error', 0.2);
    return;
  }
  setMovingFacing(next);
  play('click', 0.3);
}
// Yeni yerinde önü yola bakmıyorsa yola bakan yöne kendiliğinden döner
function faceRoad() {
  const m = moving!;
  const ok = city.facingsAt(m.from, m.to % SIZE, Math.floor(m.to / SIZE));
  if (!ok.includes(movingFacing(m))) setMovingFacing(ok[0]);
}
const input = new TileInput(renderer.domElement, camera, {
  tool: () => tool,
  lift(cell) {
    if (moving || tool !== 'pan' || cell === null || !city.canMove(cell)) return false;
    rig.releaseGrab();
    startMove(cell);
    moving!.dragging = true;
    showMovePreview();
    return true;
  },
  grab(cell) {
    if (!moving || cell === null) return false;
    const m = moving;
    if (!(block(m.to % SIZE, Math.floor(m.to / SIZE), m.n) ?? []).includes(cell)) return false;
    rig.releaseGrab();
    m.dragging = true;
    showMovePreview();
    return true;
  },
  moveTo(cell) {
    if (!moving || cell === null) return;
    // Parmak binanın ortasında: büyük binada sol üst kare biraz geride
    const off = Math.floor((moving.n - 1) / 2);
    const x = Math.max(0, Math.min(SIZE - moving.n, (cell % SIZE) - off));
    const z = Math.max(0, Math.min(ROWS - moving.n, Math.floor(cell / SIZE) - off));
    moving.to = idx(x, z);
    view.moveLifted(x + (moving.n - 1) / 2, z + (moving.n - 1) / 2);
    faceRoad();
    showMovePreview();
  },
  drop() {
    if (!moving) return;
    // Bırakınca yerleşmez: ✓ ya da ✗ beklenir
    moving.dragging = false;
    showMovePreview();
  },
  preview(cells) {
    if (tool === 'pan') return;
    const build = tool as Exclude<Tool, 'pan'>;
    let items = cells.map(i => ({ i, ok: city.check(build, i % SIZE, Math.floor(i / SIZE)) === null }));
    // Yeraltında yıkma: sadece tünel olan kareler silinir
    if (build === 'bulldoze' && metroView.visible) items = cells.map(i => ({ i, ok: city.metro[i] === 1 }));
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
    if (tool === 'bulldoze' && metroView.visible) {
      const n = city.removeTunnels(cells);
      if (!n) {
        toast('Burada metro hattı yok', 'error');
        play('error', 0.3);
        return;
      }
      play('remove');
      afterChange();
      return;
    }
    const res = tool === 'res' && house ? city.placeHouse(cells, house.level, house.model) : city.apply(tool, cells);
    showCoverage();
    if (res.error) {
      toast(res.error, 'error');
      play('error', 0.3);
      return;
    }
    if (tool !== 'tunnel') view.refresh(res.done, tool !== 'bulldoze');
    play(tool === 'bulldoze' ? 'remove' : 'place');
    afterChange();
    if (!ROAD_TOOLS.includes(tool) && tool !== 'bulldoze' && tool !== 'park' && tool !== 'tunnel' && res.done.some(i => !city.isConnected(i))) {
      toast('Bu yol şehir girişine bağlı değil. Yolu soldaki otoyola bağla!', 'error');
    }
  },
  cancel() {
    view.showPreview([]);
    view.showRoadPreview([], 0);
    setChip(null);
    showCoverage();
  },
  tap(cell, x, y) {
    if (moving) return; // yerleştirme beklerken kart açılmasın
    // Binanın üstündeki hazır ürün baloncuğuna dokununca ürünler depoya gelir
    const bubble = view.readyBubbleAt(x, y, camera, renderer.domElement.getBoundingClientRect());
    if (bubble !== null) {
      collectFrom(bubble, { x, y });
      if (prod.isOpen && prod.i !== bubble) openProduction(bubble);
      return;
    }
    // Fabrika ya da dükkan: hazır ürün varsa önce toplanır, yoksa üretim ekranı açılır
    const a = cell !== null ? city.anchorOf(cell) : null;
    if (a !== null && isMaker(city.tiles[a]?.kind)) {
      if (!prod.isOpen && city.readyAt(a, Date.now()).length) collectFrom(a, { x, y });
      else openProduction(a);
      play('click', 0.3);
      return;
    }
    // Üretim ekranı açıkken başka yere dokununca kapanır
    if (prod.isOpen) {
      closeProduction();
      return;
    }
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
  cancelMove();
  closeProduction();
  if (tool !== 'pan') pickTool('pan');
  openTile(null);
  mapKind = null;
  renderServiceMap();
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

// Şehri değiştir (yeni şehir, hazır şehir ya da yedekten geri dönüş)
function swapCity(next: City) {
  city = next;
  openCard = null;
  pickTool('pan');
  view.setCity(city);
  traffic.setCity(city);
  walkers.setCity(city);
  trains.setCity(city);
  sky.setCity(city);
  helis.setCity(city);
  syncHighway();
  afterChange();
}

// Hazır şehir: geliştirirken kurulan büyük örnek şehir (public/ornek-sehir.txt, sıkıştırılmış).
// Açmadan önce oyuncunun kendi şehri yedeklenir; Ayarlar'dan geri dönülebilir.
const BACKUP_KEY = `${SAVE_KEY}-kendi`;
const DEMO_KEY = 'aksoy-city-hazir';
async function openDemo() {
  const ok = await confirmDialog('Hazır şehir', 'Gökdelenli, otoparklı, kayak merkezli hazır şehir açılsın mı? Kendi şehrin yedeklenir; Ayarlar\'dan "Kendi şehrime dön" ile geri dönebilirsin.', 'Hazır şehri aç');
  if (!ok) return;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}ornek-sehir.txt`);
    const b64 = (await res.text()).trim();
    const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    const json = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const data = JSON.parse(json) as Parameters<typeof City.load>[0];
    if (!City.canLoad(data)) throw new Error('kayıt açılamadı');
    if (readPref(DEMO_KEY) !== '1') writePref(BACKUP_KEY, JSON.stringify(city.serialize()));
    writePref(DEMO_KEY, '1');
    swapCity(City.load(data));
    toast('🏙️ Hazır şehir açıldı! Kendi şehrine Ayarlar\'dan dönebilirsin.');
  } catch (err) {
    console.warn(err);
    toast('Hazır şehir açılamadı, internet bağlantını kontrol et.', 'error');
  }
}
async function restoreOwn() {
  const raw = readPref(BACKUP_KEY);
  if (!raw) return;
  const ok = await confirmDialog('Kendi şehrin', 'Hazır şehirden çıkıp kendi şehrine dönülsün mü?', 'Kendi şehrime dön');
  if (!ok) return;
  try {
    const data = JSON.parse(raw) as Parameters<typeof City.load>[0];
    swapCity(City.canLoad(data) ? City.load(data) : new City());
    writePref(DEMO_KEY, '0');
    toast('🏠 Kendi şehrine döndün!');
  } catch {
    toast('Yedek açılamadı.', 'error');
  }
}

// Şehri yazı olarak kopyala / yapıştır: ana ekran uygulaması silinip yeniden eklenirken (ya da başka telefona
// geçerken) şehir kaybolmasın. İçinde şu anki şehir, hazır şehir açıksa kendi şehrinin yedeği ve şehrin adı var;
// sıkıştırılıp yazıya çevrilir.
async function packText(obj: unknown) {
  const json = JSON.stringify(obj);
  const buf = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'AKSOY1:' + btoa(bin);
}
async function unpackText(text: string) {
  const b64 = text.trim().replace(/^AKSOY1:/, '').replace(/\s+/g, '');
  const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  return JSON.parse(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
async function copyCity() {
  try {
    const text = await packText({ city: city.serialize(), own: readPref(DEMO_KEY) === '1' ? readPref(BACKUP_KEY) : null, name: cityName });
    await navigator.clipboard.writeText(text);
    toast('📋 Şehir kopyalandı! Yeni uygulamada Ayarlar → "Kopyalanan şehri yükle"ye dokun.');
  } catch (err) {
    console.warn(err);
    toast('Kopyalanamadı. Tekrar dene.', 'error');
  }
}
async function pasteCity() {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    // iPhone panoyu okumaya izin vermezse elle yapıştırma
  }
  if (!text.startsWith('AKSOY1:')) text = prompt('Kopyaladığın şehri buraya yapıştır:') ?? '';
  if (!text.trim()) return;
  try {
    const pack = (await unpackText(text)) as { city: Parameters<typeof City.load>[0]; own: string | null; name?: string };
    if (!City.canLoad(pack.city)) throw new Error('kayıt açılamadı');
    const ok = await confirmDialog('Şehri yükle', 'Kopyaladığın şehir açılsın mı? Şu anki şehrin yerine geçer.', 'Yükle');
    if (!ok) return;
    if (pack.own) {
      writePref(BACKUP_KEY, pack.own);
      writePref(DEMO_KEY, '1');
    } else writePref(DEMO_KEY, '0');
    if (pack.name) {
      cityName = pack.name;
      writePref(NAME_KEY, pack.name);
      setCityName(pack.name);
    }
    swapCity(City.load(pack.city));
    toast('🏙️ Şehir yüklendi!');
  } catch (err) {
    console.warn(err);
    toast('Bu yazı bir şehir değil ya da eksik kopyalanmış.', 'error');
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

// Ekran bilgisi (ayarların altında): ana ekrandan açılınca bulanıklık olursa nedenini görmek için
declare const __BUILD__: string;
function screenInfo() {
  const nav = navigator as Navigator & { standalone?: boolean };
  const app = nav.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  const el = renderer.domElement;
  // Güvenli alan (saat çubuğu) yüksekliği: env() değeri ancak bir öğeye uygulanınca okunabiliyor
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;padding-top:env(safe-area-inset-top);visibility:hidden';
  document.body.appendChild(probe);
  const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return `Sürüm ${__BUILD__} · ${app ? 'Ana ekran' : 'Tarayıcı'} · üst boşluk ${Math.round(inset)} · pencere ${innerWidth}×${innerHeight} · ekran ${screen.width}×${screen.height} · tuval ${el.clientWidth}×${el.clientHeight} → ${el.width}×${el.height} · keskinlik ${pixelRatio.toFixed(2)}/${dpr()} · ${Math.round(fpsAvg)} fps`;
}

document.getElementById('settings')!.addEventListener('click', () => {
  play('click', 0.3);
  openSettings(
    { sound: !isMuted(), quality, rain: weather.enabled, name: cityName, demo: readPref(DEMO_KEY) === '1' && !!readPref(BACKUP_KEY), screen: screenInfo() },
    {
      sound: on => setMuted(!on),
      quality: applyQuality,
      rain: on => {
        weather.enabled = on;
        writePref(RAIN_KEY, on ? '1' : '0');
      },
      reset: resetCity,
      copyCity: () => void copyCity(),
      pasteCity: () => void pasteCity(),
      demo: openDemo,
      restore: restoreOwn,
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
// iPhone'da ana ekrandan açılınca (tam ekran uygulama) bazı iOS sürümleri sayfanın boyunu saat çubuğu kadar kısa
// hesaplıyor ve altta boşluk kalıyor. O durumda oyun alanı doğrudan telefonun ekran boyuna ayarlanır.
function fitStandalone() {
  const app = document.getElementById('app');
  if (!app) return;
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = nav.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  document.documentElement.classList.toggle('standalone', standalone);
  if (!standalone) {
    app.removeAttribute('style');
    document.documentElement.style.removeProperty('--sgap');
    return;
  }
  // Sayfa saat çubuğunun altına uzanmıyorsa (saat çubuğu opak) aradaki fark doğaldır, düzeltme yapılmaz
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;padding-top:env(safe-area-inset-top);visibility:hidden';
  document.body.appendChild(probe);
  const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  if (inset <= 0) {
    app.removeAttribute('style');
    document.documentElement.style.removeProperty('--sgap');
    return;
  }
  const portrait = matchMedia('(orientation: portrait)').matches;
  const a = screen.width, b = screen.height;
  const w = portrait ? Math.min(a, b) : Math.max(a, b), h = portrait ? Math.max(a, b) : Math.min(a, b);
  // Sadece saat çubuğu kadar küçük bir fark varsa düzelt (bilgisayarda ya da bölünmüş ekranda pencere ekrandan küçüktür)
  const gap = h - window.innerHeight;
  if (Math.abs(w - window.innerWidth) > 2 || gap <= 0 || gap > 120) {
    app.removeAttribute('style');
    document.documentElement.style.removeProperty('--sgap');
    return;
  }
  app.style.cssText = `top:0;left:0;right:auto;bottom:auto;width:${w}px;height:${h}px`;
  // Sayfa kısa kaldıysa alttaki düğmeler de o kadar aşağı insin (ekranın gerçek altına göre dursun)
  document.documentElement.style.setProperty('--sgap', `${gap}px`);
}
function resize() {
  fitStandalone();
  const el = renderer.domElement;
  const w = el.clientWidth || window.innerWidth, h = el.clientHeight || window.innerHeight;
  if (!w || !h) return;
  // Tuvalin boyutu CSS'ten gelir (ekranın tamamı); sadece çizim çözünürlüğü ayarlanır
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  rig.apply();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 350));
window.visualViewport?.addEventListener('resize', resize);
if ('ResizeObserver' in window) new ResizeObserver(() => resize()).observe(renderer.domElement);
resize();

const clock = new THREE.Clock();
let dayTimer = 0;
let prodTimer = 0;
let lastReady = 0;
let fpsAvg = 60;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.25);
  if (dt > 0) fpsAvg += (1 / dt - fpsAvg) * 0.05;
  rig.update(dt);
  stepCamTween(dt);
  prod.update(dt);
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

  // Fabrika ve dükkan üretimleri: biten ürün binada baloncukla bekler (dokununca depoya gelir)
  prodTimer += dt;
  if (prodTimer >= 0.5) {
    prodTimer = 0;
    const ready = city.waiting(Date.now()).length;
    if (ready !== lastReady) {
      if (ready > lastReady) play('place', 0.2);
      lastReady = ready;
      if (prod.isOpen) prod.refresh();
    }
    view.updateIcons();
    if (openCard !== null) renderCard();
    // Gemisi dönen limana yeni sipariş gelsin
    if (city.updateOrders(Date.now())) afterChange();
  }

  view.update(dt);
  metroView.update(dt);
  if (view.shadowDirty) {
    view.shadowDirty = false;
    renderer.shadowMap.needsUpdate = true;
  }
  adaptQuality(dt);
  setSignalTime(clock.elapsedTime);
  updateSignals();
  // Günün saati (0..1): arabalar ve yayalar sabah işe, akşam eve gider
  const tod = ((city.day % CYCLE_DAYS) + dayTimer / DAY_SECONDS) / CYCLE_DAYS;
  traffic.update(dt, tod);
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
  fireworks.update(dt, phase(tod).night, showSpots);
  dayNight.update(tod, dt, weather.amount);
  // Depremde kamera sallansın (sadece çizim sırasında kaydırılır, sonra geri alınır)
  const jolt = new THREE.Vector3();
  if (shake > 0) {
    shake = Math.max(0, shake - dt);
    jolt.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake * 0.25);
  }
  camera.position.add(jolt);
  renderer.render(scene, camera);
  syncEdgeColor(dt);
  camera.position.sub(jolt);
}

// Saat çubuğu arazinin yeşili olsun: iOS 27'de ana ekrandaki web uygulaması saatin arkasına uzanınca bulanıklaşıyor,
// o yüzden saat ayrı bir şeritte; şerit oyunun devamı gibi görünsün diye tepedeki çimenin o anki rengini alır
// (gündüz açık, gece koyu yeşil). iOS şeridi sayfanın zemin renginden boyuyor. Saniyede bir, çizimin hemen
// ardından tepedeki satır okunur.
let edgeTimer = 0;
let edgeHex = '';
const EDGE_DAY = new THREE.Color().setRGB(133 / 255, 209 / 255, 96 / 255, THREE.SRGBColorSpace);
const EDGE_NIGHT = new THREE.Color().setRGB(34 / 255, 62 / 255, 38 / 255, THREE.SRGBColorSpace);
const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
function syncEdgeColor(dt: number) {
  edgeTimer -= dt;
  if (edgeTimer > 0) return;
  edgeTimer = 0.8;
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  if (!w || !h) return;
  // Tuval ekranın üstünden taşıyorsa görünen ilk satırı oku (WebGL'de satırlar alttan sayılır)
  const over = Math.max(0, -renderer.domElement.getBoundingClientRect().top) * renderer.getPixelRatio();
  const y = Math.max(0, Math.min(h - 1, Math.round(h - 2 - over)));
  const px = new Uint8Array(w * 4);
  gl.readPixels(0, y, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // Sadece arazinin (çimenin) pikselleri: yeşili kırmızı ve maviden belirgin fazla olanlar. Tepede çimen yoksa
  // (şehir, deniz) son yeşil kalır; gece çimen koyulaştıkça şerit de koyulaşır.
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < w; i++) {
    const pr = px[i * 4], pg = px[i * 4 + 1], pb = px[i * 4 + 2];
    if (pg > pr * 1.12 && pg > pb * 1.12) {
      r += pr;
      g += pg;
      b += pb;
      n++;
    }
  }
  let hex: string;
  if (n >= w * 0.05) hex = '#' + [r, g, b].map(v => Math.round(v / n).toString(16).padStart(2, '0')).join('');
  else {
    // Tepede çimen yok (şehir, deniz): gündüz-gece durumuna göre arazi yeşili
    const night = phase(((city.day % CYCLE_DAYS) + dayTimer / DAY_SECONDS) / CYCLE_DAYS).night;
    hex = '#' + EDGE_DAY.clone().lerp(EDGE_NIGHT, night).getHexString();
  }
  if (hex === edgeHex) return;
  edgeHex = hex;
  document.documentElement.style.backgroundColor = hex;
  document.body.style.backgroundColor = hex;
  themeMeta?.setAttribute('content', hex);
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
    ['road', makeModel('proc/road-junction')],
    ['avenue', gradedRoadModel(2)],
    ['boulevard', gradedRoadModel(1)],
    ['rail', railPiece(0b0110)],
    ['res', makeModel(RES_LEVELS[1].models[0])],
    ['com', makeModel(RES_LEVELS[4].models[0])],
    ['park', makePark(0, 0.3)],
    ['tunnel', tunnelThumb()],
    ['hall', makeHall()],
  ];
  for (const k of ['wind', 'solar', 'plant', 'tower', 'pump'] as const) items.push([k, makeUtility(k)]);
  for (const k of ['police', 'fire', 'health', 'school'] as const) items.push([k, makeService(k)]);
  for (const k of ['factory', 'store', 'market', 'furniture', 'bakery', 'fashion', 'garden', 'cafe', 'electro', 'depot', 'port'] as const) items.push([k, makeIndustry(k)]);
  for (const k of ['fountain', 'statue', 'wheel', 'stadium', 'station', 'busstop', 'parking', 'lake', 'biglake', 'hill', 'volley', 'casino', 'observatory', 'uni', 'airport', 'beach', 'metro', 'clocktower', 'museum', 'funfair', 'lighthouse', 'marina', 'mosque', 'zoo', 'eiffel', 'liberty', 'pisa', 'colosseum', 'galata', 'pyramid'] as const) items.push([k, makeDecor(k)]);
  try {
    setThumbs(renderThumbs(items));
  } catch (err) {
    console.warn('Menü resimleri çizilemedi', err);
  }
}

// Ürün resimleri: her ürünün gerçekçi 3D modeli bir kere çizilir (atölye, depo, liman ve baloncuklarda kullanılır)
function makeProductPictures() {
  try {
    const r = thumbRenderer(160, { env: true });
    const pics = r.render(ITEM_IDS.map(id => [id, makeItem(id)] as [string, THREE.Object3D]));
    r.dispose();
    setProductPics(pics);
    view.setItemPics(pics);
    if (prod.isOpen) prod.refresh();
    renderCard();
  } catch (err) {
    console.warn('Ürün resimleri çizilemedi', err);
  }
}

loadModels(ALL_MODELS, (done, total) => setLoading(done / total))
  .then(() => {
    scene.add(buildSurroundings());
    syncHighway();
    highway.init();
    ski.init();
    traffic.init();
    trains.init();
    sky.init();
    view.rebuildAll();
    makeMenuPictures();
    // Oyun kapalıyken biten üretimler binalarda bekler
    const done = city.waiting(Date.now()).length;
    if (done) toast(`Sen yokken ${done} binada ürün hazır oldu! Baloncuklara dokunup topla 📦`);
    if (city.tradeRefund) toast(`Ticaret merkezi kaldırıldı, parası iade edildi: 💰${fmt(city.tradeRefund)}`);
    if (city.seaRefund) toast(`Kuzey kıyısı artık deniz! Oradaki yapıların parası iade edildi: 💰${fmt(city.seaRefund)}`);
    afterChange();
    hideLoading();
    // Ürün resimleri oyun açıldıktan hemen sonra çizilir (açılışı yavaşlatmasın)
    setTimeout(makeProductPictures, 300);
    if (!city.hasZones) toast('Hoş geldin! Sağ alttaki İnşa Et düğmesinden yol ve konut yap.');
    renderer.setAnimationLoop(frame);
    // Geliştirirken performansı ölçebilmek için (yayında çalışmaz)
    if (import.meta.env.DEV) Object.assign(window, { __aksoy: { renderer, scene, camera, rig, city: () => city, weather, view, sky, highway, traffic, walkers, helis, open: openTile, pick: pickTool, refresh: afterChange, production: openProduction, prod, dayNight, frame } });
  })
  .catch(err => {
    console.error(err);
    loadFailed();
  });
