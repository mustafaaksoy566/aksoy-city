// Hazır şehir üreticisi (public/ornek-sehir.txt): geliştirme sunucusunda açık oyun sayfasında çalışır.
//   await import('/tools/demo-city.js')  -> yeni şehri kurar (window.__demo), özetini window.__demoReport'a yazar
//   await __saveDemo()                    -> sıkıştırıp public/ornek-sehir.txt olarak kaydeder (vite.config.ts)
// Oyunun kendi kurallarıyla kurar (City.apply, placeHouse...): yollar, simgeler, otoparklı dükkânlar, hizmetler
// (evlerin yerini önceden kapsayacak şekilde), konutlar (merkeze yaklaştıkça yükselir), metro ağı, enerji ve sanayi.
const cityMod = await import('/src/city.ts');
const cfg = await import('/src/config.ts');
const { City, serviceArea } = cityMod;
const W = cfg.SIZE;
const I = (x, z) => z * W + x;
const c = new City();
// Hazır şehir eski 48x64'lük alanda ve doğudaki yeni arazide (Dünya Harikaları) kurulur; güneydeki yeni
// araziler satın alınmamış kalır
c.owned.forEach((_, p) => (c.owned[p] = Math.floor(p / cfg.PLOTS) < 8 ? 1 : 0));
// Büyük havalimanı (6x6) için şehrin güneyinde iki parça arazi daha (z 64-71, x 8-23)
for (const px of [1, 2]) c.owned[8 * cfg.PLOTS + px] = 1;
c.xp = 99999;
c.money = 5e8;
const errs = [];
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// --- Yollar ---
function line(x0, z0, x1, z1) {
  const out = [];
  if (z0 === z1) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push(I(x, z0));
  else for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) out.push(I(x0, z));
  return out;
}
function road(x0, z0, x1, z1, grade = 0) {
  const cells = line(x0, z0, x1, z1);
  c.apply('road', cells.filter(i => !c.tiles[i]));
  if (grade) {
    const r = c.apply(grade === 2 ? 'avenue' : 'boulevard', cells.filter(i => (c.tiles[i]?.grade ?? 0) < grade));
    if (r.error && !r.done.length) errs.push(`grade ${x0},${z0}: ${r.error}`);
  }
}
// Doğu-batı
road(0, 20, 40, 20, 1);
road(0, 23, 40, 23);
road(0, 26, 40, 26);
road(0, 29, 40, 29, 1);
road(5, 32, 11, 32);
road(17, 32, 29, 32);
road(35, 32, 40, 32);
road(0, 35, 40, 35);
road(0, 40, 40, 40, 2);
road(0, 43, 40, 43);
road(0, 46, 40, 46, 1);
road(17, 49, 29, 49);
road(0, 52, 40, 52);
road(0, 55, 40, 55);
// Kuzey-güney
road(5, 20, 5, 55);
road(11, 20, 11, 55, 1);
road(17, 20, 17, 55);
road(23, 20, 23, 55, 2);
road(29, 20, 29, 55);
road(35, 20, 35, 55, 1);
road(40, 20, 40, 55);
// Nehrin doğusu: köprüler ve sanayi yolu
road(41, 29, 44, 29);
road(41, 46, 44, 46);
road(45, 18, 45, 63);
// Nehrin güneyi: köprüler ve havalimanı yolu
road(11, 56, 11, 63);
road(35, 56, 35, 63);
road(0, 63, 44, 63);
// Ada: asma köprü ve adanın yolları
road(23, 12, 23, 19);
road(23, 4, 23, 11);
road(13, 7, 30, 7);

// --- Yapılar ---
function place(kind, x, z) {
  const r = c.apply(kind, [I(x, z)]);
  if (r.error) errs.push(`${kind}@${x},${z}: ${r.error}`);
  return !r.error;
}
// Sahil (kumsal): liman, yat limanları, plajlar, voleybol, deniz feneri
place('port', 1, 18);
place('marina', 7, 18);
place('beach', 13, 18);
place('volley', 19, 18);
place('beach', 25, 18);
place('beach', 31, 18);
place('marina', 36, 18);
place('lighthouse', 39, 18);
// Eyfel parkı (doğu, 30-34 sıraları): 3x3 Eyfel güneydeki yola bakar; çevresinde göl, heykel, çeşme ve parklar
place('eiffel', 31, 32);
place('lake', 32, 30);
place('statue', 30, 30);
place('fountain', 34, 30);
for (let z = 30; z <= 34; z++) for (let x = 30; x <= 34; x++) if (!c.tiles[I(x, z)]) place('park', x, z);
// Lunapark (batı, 30-34 sıraları)
place('funfair', 12, 30);
place('wheel', 15, 30);
place('lake', 15, 32);
place('fountain', 14, 34);
for (const [x, z] of [[12, 33], [13, 33], [14, 33], [12, 34], [13, 34], [15, 34], [16, 34]]) place('park', x, z);
// Merkez park: büyük göl, çevresinde parklar, heykel
place('biglake', 19, 36);
place('statue', 20, 39);
for (let z = 36; z <= 39; z++) {
  place('park', 18, z);
  place('park', 22, z);
}
place('fountain', 19, 39);
place('park', 21, 39);
// Güneyde büyük yapılar: hayvanat bahçesi, üniversite, stadyum, kolezyum, cami, piramit
place('zoo', 2, 47);
place('hill', 0, 48);
place('uni', 6, 47);
place('stadium', 12, 47);
place('colosseum', 30, 47);
place('mosque', 36, 47);
// Diğer simgeler
place('museum', 30, 21);
place('galata', 36, 21);
place('pisa', 38, 21);
place('clocktower', 8, 36);
place('observatory', 24, 4);
place('casino', 22, 6);
place('beach', 14, 8);
place('volley', 16, 8);
place('marina', 28, 8);
place('lighthouse', 31, 7);
// Hizmet binaları kurulur kurulmaz en üst seviyeye yükseltilir (alanları büyür, az bina yeter)
const TOP_SERVICE = cfg.SERVICE_LEVELS.length - 1;
const service = (kind, x, z) => {
  if (!place(kind, x, z)) return false;
  for (let u = 0; u < TOP_SERVICE; u++) { const e = c.upgradeService(I(x, z)); if (e) errs.push(kind + ' yükseltme: ' + e); }
  return true;
};
service('fire', 20, 8);
service('police', 25, 8);
const HOTELS = new Set([[22, 4], [22, 5], [21, 6], [24, 6], [22, 8], [22, 9], [22, 10], [24, 10], [24, 11], [22, 11]].map(([x, z]) => z * W + x));
// Şehir merkezi: merkez parkın yanında hizmet meydanı (itfaiye, karakol, hastane, okul)
service('fire', 24, 36);
service('police', 26, 36);
service('health', 24, 38);
service('school', 26, 38);
// Kuzey ve güneyde ikinci üniversite ve okullar
place('uni', 0, 30);
// Otoparklı dükkânlar: hepsi doğudaki çarşıda (aşağıda); evler çarşıdan beslenir (city.ts updateShops)
const shops = [
  ['store', 0, 38], ['market', 2, 38], ['furniture', 6, 38], ['bakery', 13, 38], ['fashion', 15, 38],
  ['garden', 12, 36], ['electro', 15, 36], ['store', 30, 38], ['market', 32, 38], ['cafe', 30, 36], ['fashion', 32, 36],
  ['garden', 36, 38], ['bakery', 38, 38], ['cafe', 6, 21], ['bakery', 9, 21], ['fashion', 12, 24], ['electro', 0, 41],
  ['cafe', 36, 41], ['furniture', 30, 53], ['store', 12, 53], ['market', 36, 53], ['electro', 24, 53],
  ['cafe', 6, 44], ['bakery', 33, 27],
];
// Mahallelerdeki eski dükkân yerleri yeşil alan olur: sırayla gölet, çimenli tepe ya da dört küçük park
// (evlerin sayısı ve şehir girişine giden trafik değişmez)
shops.forEach(([, x, z], n) => {
  if (n % 3 === 0) place('lake', x, z);
  else if (n % 3 === 1) place('hill', x, z);
  else for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) place('park', x + dx, z + dz);
});
// Metro istasyonları ve tüneller
for (const [x, z] of [[24, 31], [22, 44], [12, 39], [34, 39], [24, 50]]) place('metro', x, z);
const tun = [...line(23, 31, 23, 50), ...line(12, 40, 34, 40), I(24, 31), I(22, 44), I(12, 39), I(34, 39), I(24, 50)];
c.apply('tunnel', [...new Set(tun)].filter(i => !c.metro[i]));

// --- Hizmetler: evlerin kurulacağı yerleri önceden kapsayacak şekilde itfaiye, karakol, hastane ve okul ---
const near = (x, z) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => c.tiles[I(x + dx, z + dz)]?.kind === 'road' && x + dx >= 0 && x + dx < W);
const futureHome = (x, z) => !c.tiles[I(x, z)] && near(x, z) && z >= 21 && z <= 55 && x <= 40;
const future = new Set();
for (let z = 3; z <= 55; z++) for (let x = 0; x <= 40; x++) if (futureHome(x, z)) future.add(I(x, z));
function covered(kind) {
  const out = new Set();
  c.tiles.forEach((t, i) => {
    if (!t) return;
    if (t.kind === kind) for (const q of serviceArea(i, kind, t.fp ?? 1, t.level)) out.add(q);
    if (kind === 'school' && t.kind === 'uni') for (const q of cityMod.areaAround(i, cfg.DECOR.uni.radius, 3)) out.add(q);
  });
  return out;
}
function serve(kind) {
  for (let guard = 0; guard < 40; guard++) {
    const cov = covered(kind);
    const open = [...future].filter(i => !cov.has(i) && !c.tiles[i]);
    if (!open.length) return;
    const openSet = new Set(open);
    let best = null, bestGain = kind === 'fire' ? 0 : 2;
    for (let z = 3; z <= 54; z++) {
      for (let x = 0; x <= 39; x++) {
        if (z <= 20) continue;
        const cells = [I(x, z), I(x + 1, z), I(x, z + 1), I(x + 1, z + 1)];
        if (cells.some(q => c.tiles[q] || cityMod.isSea(q) || cityMod.isWater(q))) continue;
        if (!cells.some(q => near(q % W, Math.floor(q / W)))) continue;
        let gain = 0;
        for (const q of serviceArea(I(x, z), kind, 2, TOP_SERVICE)) if (openSet.has(q) && !cells.includes(q)) gain++;
        if (gain > bestGain) {
          bestGain = gain;
          best = [x, z];
        }
      }
    }
    if (!best) return;
    service(kind, best[0], best[1]);
  }
}
for (const k of ['fire', 'police', 'health', 'school']) serve(k);

// --- Konutlar: şehir merkezine yaklaştıkça yükselir ---
function levelAt(x, z) {
  if (z <= 12) return rnd() < 0.5 ? 6 : 5; // ada: oteller
  if (z <= 22) return x >= 12 && x <= 39 ? (rnd() < 0.3 ? 6 : 5) : 4; // sahil oteli
  const d = Math.hypot(x - 23, (z - 38) * 1.05);
  if (d <= 5.5) return 8;
  if (d <= 8.5) return 7;
  if (d <= 11.5) return 6;
  if (d <= 14.5) return 5;
  if (d <= 17) return 4;
  if (d <= 20) return 3;
  return rnd() < 0.5 ? 2 : 1;
}
const MARINA_FRONT = new Set([I(28, 10), I(29, 10)]);
const GREEN = window.__demoGreen ?? [0.55, 0.4, 0.2]; // alçak, orta ve yüksek mahallelerde park olasılığı
let sinceLot = 0;
for (let z = 3; z <= 56; z++) {
  for (let x = 0; x <= 40; x++) {
    const i = I(x, z);
    if (c.tiles[i] || (z >= 13 && z <= 19)) continue;
    if (z <= 12 && !cityMod.isIslandXZ(x, z)) continue;
    // Ada: sadece birkaç otel kulesi, gerisi park (yat limanının iskelelerinin uzandığı kıyı boş kalır)
    if (z <= 12 && !HOTELS.has(i)) {
      if (!MARINA_FRONT.has(i)) place('park', x, z);
      continue;
    }
    if (z === 56) {
      place('park', x, z);
      continue;
    }
    if (!near(x, z)) {
      if (z >= 21 || cityMod.isIslandXZ(x, z)) place('park', x, z);
      continue;
    }
    const lv = levelAt(x, z);
    // Hizmet binaları yükseltildiği için az sayıda; boşalan yerlerin bir kısmı mahalle parkı (nüfus ve trafik
    // şehrin girişinin kaldırabileceği kadar kalsın)
    if (z >= 21 && rnd() < (lv <= 4 ? GREEN[0] : lv <= 6 ? GREEN[1] : GREEN[2])) {
      place('park', x, z);
      continue;
    }
    // Alçak evlerin mahallelerinde arada bir otopark ve otobüs durağı (arabalar ve otobüsler buradan çıkar)
    if (lv <= 4 && ++sinceLot >= 9) {
      sinceLot = 0;
      if (place('parking', x, z)) continue;
    }
    const models = cfg.RES_LEVELS[lv - 1].models.length;
    const r = c.placeHouse([i], lv, Math.floor(rnd() * models));
    if (r.error) errs.push(`res@${x},${z}: ${r.error}`);
  }
}

const homes = () => c.tiles.map((t, i) => (t?.kind === 'res' && t.level > 0 ? i : -1)).filter(i => i >= 0);

// --- Metro ağı: her mahallede istasyon, caddelerin altında tüneller (metro olan yerde araba az olur) ---
for (const [x0, z0] of [[8, 24], [20, 24], [32, 24], [2, 45], [34, 45], [8, 53], [20, 53], [32, 53], [6, 34], [30, 27], [14, 44]]) {
  // Yeri doluysa yakınındaki bir evin ya da parkın yerine
  const spot = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [3, 0], [-3, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 2], [0, -2]].map(([dx, dz]) => [x0 + dx, z0 + dz]).find(([x, z]) => {
    const t = c.tiles[I(x, z)];
    return (!t || t.kind === 'res' || t.kind === 'park') && near(x, z) && z >= 21;
  });
  if (!spot) {
    errs.push('metro yer yok ' + x0 + ',' + z0);
    continue;
  }
  const i = I(spot[0], spot[1]);
  if (c.tiles[i]) c.apply('bulldoze', [i]);
  if (place('metro', spot[0], spot[1])) c.apply('tunnel', [i].filter(q => !c.metro[q]));
}
const net = [...line(1, 23, 39, 23), ...line(23, 23, 23, 52), ...line(1, 40, 39, 40), ...line(2, 46, 39, 46), ...line(8, 52, 32, 52), ...line(14, 29, 39, 29), ...line(4, 34, 4, 40), ...line(39, 23, 39, 46)];
c.apply('tunnel', [...new Set(net)].filter(i => !c.metro[i]));
// Ağa bağlı olmayan istasyon: en yakın tünele kısa bir tünelle bağlanır
c.tiles.forEach((t, i) => {
  if (t?.kind !== 'metro') return;
  const L = c.metroLines();
  const st = L.stationList.find(q => q.i === i);
  if (st && st.line >= 0 && L.active[st.line]) return;
  const sx = i % W, sz = Math.floor(i / W);
  let best = -1, bd = 1e9;
  c.metro.forEach((v, q) => {
    if (!v || q === i) return;
    const d = Math.abs((q % W) - sx) + Math.abs(Math.floor(q / W) - sz);
    if (d > 1 && d < bd) {
      bd = d;
      best = q;
    }
  });
  if (best < 0) return;
  const qx = best % W, qz = Math.floor(best / W);
  c.apply('tunnel', [...line(sx, sz, sx, qz), ...line(sx, qz, qx, qz)].filter(q => !c.metro[q]));
});

// --- Doğuda sanayi ve enerji, güneyde havalimanı ve güneş-rüzgâr tarlası ---
const westSlots = [18, 20, 22, 24, 26, 30, 32, 34, 36, 38, 40, 42, 44, 47, 49, 51, 53, 55, 57, 59, 61];
// 20, 32, 44 ve 56 boş kalır: z = 21, 33, 45 ve 57 sıralarından doğudaki Dünya Harikaları bölgesine ve
// çarşıya yol geçer
const eastSlots = [18, 22, 24, 26, 28, 30, 34, 36, 38, 40, 42, 46, 48, 50, 52, 54, 58, 60];
const slots = [...westSlots.map(z => [43, z]), ...eastSlots.map(z => [46, z])].sort((a, b) => a[1] - b[1]);
const industry = [];
for (const [x, z] of slots) industry.push([x, z]);
// Fabrikalar ve depolar nehrin doğusundaki bu şeritte değil, aşağıdaki sanayi ve çarşı bölgesinde
// Güneyde büyük havalimanı (yeni arazide, 6x6), güneş tarlaları ve rüzgâr türbinleri (en üst seviyede)
const maxUtil = (x, z) => {
  const t = c.tiles[I(x, z)];
  for (let u = 0; u < cfg.UTIL_LEVELS[t.kind].length - 1; u++) { const e = c.upgradeUtility(I(x, z)); if (e) errs.push(t.kind + ' yükseltme: ' + e); }
};
if (place('airport', 13, 64)) {
  const up = c.upgradeAirport(I(13, 64));
  if (up) errs.push('havalimanı yükseltme: ' + up);
}
for (const x of [1, 4, 7, 14, 16, 20, 24, 28, 31, 38, 41]) if (place('solar', x, 61)) maxUtil(x, 61);
for (const x of [0, 3, 6, 9, 13, 19, 22, 26, 30, 33, 37, 40, 43]) if (!c.tiles[I(x, 62)] && place('wind', x, 62)) maxUtil(x, 62);
// Elektrik ve su: şehir santralle dolmasın; ihtiyaç kadar (birkaç) santral ve pompa, hepsi en üst seviyede
const free = industry.filter(([x, z]) => [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dz]) => !c.tiles[I(x + dx, z + dz)]));
c.refresh();
let k = 0;
while ((c.service.power.supply < c.service.power.demand * 1.12 || c.service.water.supply < c.service.water.demand * 1.12) && k < free.length) {
  const [x, z] = free[k++];
  const kind = c.service.power.supply - c.service.power.demand * 1.12 < c.service.water.supply - c.service.water.demand * 1.12 ? 'plant' : 'pump';
  if (place(kind, x, z)) {
    maxUtil(x, z);
    c.refresh();
  }
}
// Nehir kıyısında kalan yerler yeşil: sırayla gölet, çimenli tepe ve dört küçük park
for (let q = 0; k < free.length; k++, q++) {
  const [x, z] = free[k];
  if (q % 3 === 0) place('lake', x, z);
  else if (q % 3 === 1) place('hill', x, z);
  else for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) place('park', x + dx, z + dz);
}
// Eski havaalanının yeri: gölet ve çimenli tepe
place('lake', 14, 59);
place('hill', 16, 59);
c.refresh();

// --- Ulaşım: otobüs durakları, katlı otoparklar, metro yükseltmesi, alt geçit ---
for (const [x, z] of [[4, 24], [10, 27], [16, 41], [28, 44], [34, 45], [6, 53], [28, 27], [24, 8], [18, 50], [6, 31], [4, 28], [10, 24], [2, 37], [4, 21], [10, 33]]) {
  const i = I(x, z);
  // Ev ya da park olan yere kurulur (adadaki otellerin durağı parkın yerine)
  if (c.tiles[i] && c.tiles[i].kind !== 'res' && !(c.tiles[i].kind === 'park' && near(x, z))) continue;
  if (c.tiles[i]) c.apply('bulldoze', [i]);
  place('busstop', x, z);
}
let garages = 0;
c.tiles.forEach((t, i) => {
  if (t?.kind !== 'parking' || garages >= 6 || rnd() > 0.35) return;
  garages++;
  for (let u = 0; u < 2; u++) c.upgradeParking(i);
});
c.tiles.forEach((t, i) => {
  if (t?.kind === 'metro') for (let u = 0; u < 2; u++) c.upgradeMetro(i);
});
const up = c.buildUnderpass(I(23, 40));
if (up) errs.push('underpass: ' + up);
c.refresh();
// Hâlâ tıkanan yollar caddeye yükseltilir
for (let pass = 0; pass < 4; pass++) {
  const jam = [];
  c.tiles.forEach((t, i) => {
    if (t?.kind === 'road' && !t.locked && c.congestion(i) > 1 && (t.grade ?? 0) < 2 && !cityMod.isSea(i)) jam.push(i);
  });
  if (!jam.length) break;
  c.apply('avenue', jam);
  c.refresh();
}

// --- Doğudaki yeni arazide Dünya Harikaları parkı, denizde Kız Kulesi ---
// Sanayi yolundan (x=45) doğuya yollar: z=21 ve z=45 yol, z=33 bulvar; x=55 bulvarı kuzeyden güneye
// Yollar: z = 33 bulvar ve z = 45 yol sanayi yolundan (x = 45) doğuya; z = 21 yolu yalnızca x = 53'ten doğuya
// (batısında kıyıda 5x5 Opera var); x = 55 bulvarı kuzeyden güneye
for (const [z, gr] of [[33, 1], [45, 0]]) {
  if (c.tiles[I(46, z)] || c.tiles[I(47, z)]) errs.push('doğu yolu dolu ' + z);
  road(46, z, 63, z, gr);
}
road(53, 21, 63, 21);
road(55, 21, 55, 45, 1);
// Kuzey bloklar (z 18-32): kıyıda Opera, yanında Tac Mahal ve Ayasofya; doğuda Gize Piramitleri, Parthenon,
// Big Ben ve Stonehenge; Kapadokya bulvarın kuzeyinde
const wonder = (kind, x, z) => place(kind, x, z) || errs.push(kind);
wonder('opera', 48, 18);
wonder('taj', 50, 23);
wonder('hagia', 51, 28);
wonder('cappadocia', 48, 30);
place('lake', 48, 23);
place('hill', 48, 26);
wonder('pyramid', 56, 22);
wonder('stonehenge', 62, 22);
place('lake', 62, 24);
wonder('parthenon', 56, 29);
wonder('bigben', 60, 30);
// Güney bloklar (z 34-44): Özgürlük Anıtı, Chichen Itza, Efes, Pamukkale ve Truva Atı
wonder('liberty', 52, 34);
wonder('chichen', 48, 34);
wonder('ephesus', 53, 37);
wonder('pamukkale', 52, 42);
wonder('troy', 60, 43);
place('hill', 49, 37);
place('lake', 57, 37);
place('statue', 60, 34);
place('fountain', 58, 34);
wonder('maiden', 8, 13);
// Aralarda kalan boş yerler park
for (let z = 18; z <= 44; z++) {
  for (let x = 46; x <= 63; x++) {
    if (x === 55 || c.tiles[I(x, z)] || cityMod.isSea(I(x, z))) continue;
    place('park', x, z);
  }
}
c.refresh();

// --- Sanayi ve Çarşı: bütün dükkânlar ve fabrikalar doğudaki tek bölgede (z 46-62, x 49-63) ---
// Yollar: x = 48 ve 55 (bulvar) kuzeyden güneye, z = 51, 57 ve 63 doğu-batı. Her şeritte yola bakan iki sıra 2x2
// bina: kuzey şeritlerinde dükkânlar (çarşı), en güneyde fabrikalar ve depolar (evlerden uzakta, kirlilik yok).
road(48, 45, 48, 63);
road(55, 45, 55, 63, 1);
road(48, 51, 63, 51);
if (c.tiles[I(46, 57)] || c.tiles[I(47, 57)]) errs.push('çarşı yolu dolu 57');
road(46, 57, 63, 57);
road(46, 63, 63, 63);
const lots = z0 => [49, 51, 53, 56, 58, 60, 62].flatMap(x => [[x, z0], [x, z0 + 3]]);
const bazaar = [...lots(46), ...lots(52)].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
shops.forEach(([k], n) => {
  const spot = bazaar[n];
  if (spot) place(k, spot[0], spot[1]);
  else errs.push('çarşıda yer yok: ' + k);
});
// Çarşıda kalan yerlere birkaç dükkân daha (sıra boş kalmasın)
const extra = ['furniture', 'garden', 'electro', 'market'];
bazaar.slice(shops.length).forEach(([x, z], n) => place(extra[n % extra.length], x, z));
// Sanayi şeridi dolu: on fabrika ve dört depo
const yard = lots(58).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
yard.forEach(([x, z], n) => place(n % 4 === 2 ? 'depot' : 'factory', x, z));
c.refresh();

// --- Son ayarlar ---
c.money = 250000;
c.day = 9;
c.treasury = 0;
window.__demo = c;
const pop = c.population;
const lacking = c.lacking.size;
const res = homes();
const uncovered = {};
for (const kind of ['fire', 'police', 'health', 'school']) uncovered[kind] = res.filter(i => !c.isCovered(i, kind)).length;
const lv = {};
res.forEach(i => (lv[c.tiles[i].level] = (lv[c.tiles[i].level] || 0) + 1));
const disconnected = c.tiles.map((t, i) => (t && t.kind !== 'road' && t.kind !== 'part' && t.kind !== 'park' && !c.isConnected(i) ? t.kind + '@' + (i % W) + ',' + Math.floor(i / W) : null)).filter(Boolean);
window.__demoReport = JSON.stringify({ jams: c.jams, metro: c.tiles.filter(t => t?.kind === 'metro').length, pop, homes: res.length, lv, lacking, power: c.service.power, water: c.service.water, uncovered, disconnected: disconnected.slice(0, 12), errs: errs.slice(0, 40), nerr: errs.length });

// Sıkıştırıp hazır şehir dosyasına yaz (geliştirme sunucusu public/ornek-sehir.txt olarak kaydeder)
window.__saveDemo = async () => {
  const json = JSON.stringify(window.__demo.serialize());
  const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  let bin = '';
  const u8 = new Uint8Array(gz);
  for (let k = 0; k < u8.length; k += 0x8000) bin += String.fromCharCode(...u8.subarray(k, k + 0x8000));
  const b64 = btoa(bin);
  const r = await fetch('/__hazir-sehir', { method: 'POST', body: b64 });
  return (await r.text()) + ' ' + b64.length + ' bayt (json ' + json.length + ')';
};
