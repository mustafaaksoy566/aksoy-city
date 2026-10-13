// Sesler kodla üretilir (dışarıdan ses dosyası yok). iPhone'da ses ancak ilk dokunuştan sonra açılabiliyor ve
// sessiz moddayken çalmıyor.
const SOUNDS = {
  place: ['place-0', 'place-1', 'place-2', 'place-3'],
  remove: ['remove-0', 'remove-1', 'remove-2', 'remove-3'],
  grow: ['grow'],
  click: ['click'],
  error: ['error'],
};
export type Sound = keyof typeof SOUNDS;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambience: AudioBufferSourceNode | null = null;
const buffers = new Map<string, AudioBuffer>();
let muted = readMuted();
let musicOn = readMusic();

function readMusic() {
  try {
    return localStorage.getItem('aksoy-city-music') !== '0';
  } catch {
    return true;
  }
}

function readMuted() {
  try {
    return localStorage.getItem('aksoy-city-muted') === '1';
  } catch {
    return false;
  }
}

// --- Ses sentezi ---
// Rastgele sayı (her çalışta aynı ses çıksın diye tohumlu)
function rng(seed: number) {
  let x = seed * 9301 + 49297;
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
}
function buffer(dur: number, fill: (t: number, r: () => number) => number, seed = 1) {
  const c = ctx!;
  const n = Math.ceil(dur * c.sampleRate);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  const r = rng(seed);
  for (let i = 0; i < n; i++) d[i] = fill(i / c.sampleRate, r);
  // Başta ve sonda çok kısa yumuşatma (tık sesi çıkmasın)
  const fade = Math.min(64, n >> 2);
  for (let i = 0; i < fade; i++) {
    d[i] *= i / fade;
    d[n - 1 - i] *= i / fade;
  }
  return buf;
}
const env = (t: number, attack: number, decay: number) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));
const TAU = Math.PI * 2;

// Yerleştirme: tahta blok konur gibi tok "tok" (perdesi düşen kısa ton ve küçük bir gürültü vuruşu)
function placeSound(k: number) {
  const f0 = [196, 220, 247, 262][k];
  let ph = 0;
  return buffer(0.22, (t, r) => {
    const f = f0 * (1 + 0.6 * Math.exp(-t / 0.02));
    ph += (TAU * f) / ctx!.sampleRate;
    const body = Math.sin(ph) * env(t, 0.003, 0.06) * 0.8;
    const knock = (r() * 2 - 1) * env(t, 0.001, 0.008) * 0.5;
    const ring = Math.sin(ph * 2.01) * env(t, 0.004, 0.04) * 0.25;
    return (body + knock + ring) * 0.8;
  }, k + 1);
}
// Yıkma: aşağı inen hışırtı ve ufalanan küçük vuruşlar
function removeSound(k: number) {
  let lp = 0;
  return buffer(0.35, (t, r) => {
    const cut = 0.25 * Math.exp(-t / 0.12) + 0.02;
    lp += (r() * 2 - 1 - lp) * cut;
    const crumble = r() < 0.004 * Math.exp(-t / 0.1) ? (r() - 0.5) * 2 : 0;
    return (lp * env(t, 0.005, 0.1) * 1.6 + crumble * 0.4 + Math.sin(TAU * (110 - k * 8) * t) * env(t, 0.002, 0.05) * 0.3) * 0.8;
  }, 10 + k);
}
// Büyüme / yükseltme: iki notalı parlak çan (yukarı doğru)
function growSound() {
  const notes: [number, number][] = [[784, 0], [1175, 0.09], [1568, 0.18]];
  return buffer(0.75, t => {
    let v = 0;
    for (const [f, at] of notes) {
      if (t < at) continue;
      const u = t - at;
      v += (Math.sin(TAU * f * u) + 0.3 * Math.sin(TAU * f * 2 * u)) * env(u, 0.004, 0.18) * 0.32;
    }
    return v;
  });
}
// Düğme: kısa, yumuşak "tık"
function clickSound() {
  return buffer(0.06, t => Math.sin(TAU * 1500 * t) * env(t, 0.001, 0.012) * 0.6 + Math.sin(TAU * 750 * t) * env(t, 0.001, 0.02) * 0.3);
}
// Hata: alçak, iki kez inen vızıltı
function errorSound() {
  return buffer(0.3, t => {
    const f = t < 0.13 ? 220 : 165;
    const u = t < 0.13 ? t : t - 0.15;
    if (u < 0) return 0;
    const sq = Math.sign(Math.sin(TAU * f * u)) * 0.35 + Math.sin(TAU * f * u) * 0.4;
    return sq * env(u, 0.004, 0.06) * 0.5;
  });
}
// Şehir uğultusu: alçak, yavaş dalgalanan gürültü; arada uzaktan kuş cıvıltısı. Uçları birbirine bağlanır (döngü)
function ambienceSound() {
  const dur = 8;
  let lp = 0, lp2 = 0;
  const r0 = rng(77);
  const birds = Array.from({ length: 5 }, () => ({ at: 1 + r0() * (dur - 2), f: 2600 + r0() * 1400 }));
  const buf = buffer(dur, (t, r) => {
    lp += (r() * 2 - 1 - lp) * 0.02;
    lp2 += (lp - lp2) * 0.05;
    const swell = 0.75 + 0.25 * Math.sin((TAU * t) / dur) * Math.sin((TAU * 3 * t) / dur);
    let v = lp2 * 6 * swell;
    for (const b of birds) {
      const u = t - b.at;
      if (u < 0 || u > 0.5) continue;
      const chirp = Math.floor(u / 0.12);
      const w = u - chirp * 0.12;
      if (w < 0.07) v += Math.sin(TAU * (b.f + 900 * w * 10) * w) * Math.sin((Math.PI * w) / 0.07) * 0.05;
    }
    return v;
  }, 5);
  // Döngü dikişini yumuşat: son yarım saniyeyi başa karıştır
  const d = buf.getChannelData(0);
  const n = d.length, m = Math.floor(ctx!.sampleRate * 0.5);
  for (let i = 0; i < m; i++) {
    const a = i / m;
    d[i] = d[i] * a + d[n - m + i] * (1 - a);
  }
  return buf;
}

function synthAll() {
  for (let k = 0; k < 4; k++) {
    buffers.set(`place-${k}`, placeSound(k));
    buffers.set(`remove-${k}`, removeSound(k));
  }
  buffers.set('grow', growSound());
  buffers.set('click', clickSound());
  buffers.set('error', errorSound());
}

// iPhone sesi ancak parmak kalktığında (touchend/click) açıyor, o yüzden birkaç olayı dinliyoruz
export function setupAudioUnlock() {
  const events = ['pointerdown', 'touchend', 'click'];
  const handler = () => {
    unlockAudio();
    if (ctx?.state === 'running') events.forEach(e => document.removeEventListener(e, handler, true));
  };
  events.forEach(e => document.addEventListener(e, handler, true));
}

function unlockAudio() {
  if (ctx) {
    if (ctx.state !== 'running') {
      void ctx.resume();
      // Sessiz kısa bir ses çalmak iPhone'da kilidi açıyor
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start();
    }
    return;
  }
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);
  synthAll();
  // Uzun uğultu biraz sonra hazırlanır (ilk dokunuşta takılma olmasın)
  setTimeout(() => {
    if (!ctx) return;
    buffers.set('ambience', ambienceSound());
    startAmbience();
    startMusic();
  }, 400);
}

function startAmbience() {
  const buf = buffers.get('ambience');
  if (!ctx || !master || !buf || ambience) return;
  const g = ctx.createGain();
  g.gain.value = 0.25;
  g.connect(master);
  ambience = ctx.createBufferSource();
  ambience.buffer = buf;
  ambience.loop = true;
  ambience.connect(g);
  ambience.start();
}

export function play(sound: Sound, volume = 0.7) {
  if (!ctx || !master || muted) return;
  const list = SOUNDS[sound];
  const buf = buffers.get(list[Math.floor(Math.random() * list.length)]);
  if (!buf) return;
  const g = ctx.createGain();
  g.gain.value = volume;
  g.connect(master);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(g);
  src.start();
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 1;
  try {
    localStorage.setItem('aksoy-city-muted', m ? '1' : '0');
  } catch {
    // önemli değil
  }
}

// --- Müzik ---
// Kodla çalınan sakin arka plan müziği: dört akorlu yumuşak bir döngü (Do, La minör, Fa, Sol), altta bas,
// üstte pentatonik dizide marimba gibi tıngırdayan notalar (her ölçüde önceki notaya yakın, rastgele) ve
// hafif yankı. Her 16 ölçüde ton değişir. Gece notalar seyrekleşir. Ses efektlerinden ayrı açılıp kapanır.
let musicBus: GainNode | null = null;
let padBus: BiquadFilterNode | null = null;
let musicNext = 0;
let musicBar = 0;
let musicNote = 4;
let musicNight = 0;
const BAR = 2.6;
const PROG = [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]];
const KEYS = [0, 5, -3, 2];
const PENTA = [0, 2, 4, 7, 9];
const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function startMusic() {
  if (!ctx || musicBus) return;
  musicBus = ctx.createGain();
  musicBus.gain.value = musicOn ? 0.55 : 0;
  musicBus.connect(ctx.destination);
  // Yankı: hızla sönen gürültüden yapılmış küçük bir oda
  const rev = ctx.createConvolver();
  rev.buffer = buffer(2.4, (t, r) => (r() * 2 - 1) * Math.exp(-t / 0.55), 31);
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  musicBus.connect(rev);
  rev.connect(wet);
  wet.connect(ctx.destination);
  // Akorlar yumuşak dursun diye tizleri kısılır
  padBus = ctx.createBiquadFilter();
  padBus.type = 'lowpass';
  padBus.frequency.value = 1400;
  padBus.connect(musicBus);
  musicNext = ctx.currentTime + 0.6;
  setInterval(scheduleMusic, 300);
}

// Önümüzdeki bir saniyenin ölçülerini sıraya koy (sekme gizliyken ya da müzik kapalıyken çalmaz)
function scheduleMusic() {
  if (!ctx || !musicBus || ctx.state !== 'running') return;
  if (!musicOn || document.hidden) {
    musicNext = ctx.currentTime + 0.3;
    return;
  }
  if (musicNext < ctx.currentTime) musicNext = ctx.currentTime + 0.05;
  while (musicNext < ctx.currentTime + 1.2) {
    musicBarAt(musicNext);
    musicNext += BAR;
  }
}

function musicBarAt(t0: number) {
  const chord = PROG[musicBar % PROG.length];
  const root = 48 + KEYS[Math.floor(musicBar / 16) % KEYS.length];
  for (const iv of chord.slice(0, 3)) pad(hz(root + 12 + iv), t0, BAR + 0.5, 0.03);
  pluck(hz(root + chord[0] - 12), t0, 1.8, 0.09);
  pluck(hz(root + chord[0] - 12 + 7), t0 + BAR / 2, 1.2, 0.05);
  // Melodi: sekizlik notalar; vuruş başlarında daha sık, gece daha seyrek
  const density = 1 - musicNight * 0.45;
  for (let k = 0; k < 8; k++) {
    if (Math.random() > (k % 2 ? 0.28 : 0.55) * density) continue;
    const steps = [-2, -1, -1, 0, 1, 1, 2];
    musicNote = Math.max(0, Math.min(9, musicNote + steps[Math.floor(Math.random() * steps.length)]));
    const deg = PENTA[musicNote % 5] + 12 * Math.floor(musicNote / 5);
    mallet(hz(root + 24 + deg), t0 + (k * BAR) / 8 + Math.random() * 0.015, 1.1, 0.055);
  }
  musicBar++;
}

// Akor sesi: yavaş açılan, iki hafif ayrı akortlu üçgen dalga
function pad(f: number, t: number, dur: number, vol: number) {
  const c = ctx!;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.7);
  g.gain.setValueAtTime(vol, t + dur - 0.8);
  g.gain.linearRampToValueAtTime(0, t + dur);
  g.connect(padBus!);
  for (const det of [-6, 6]) {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    o.detune.value = det;
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
// Marimba: temel ton ve hızla sönen parlak üst ton
function mallet(f: number, t: number, dur: number, vol: number) {
  const c = ctx!;
  for (const [mul, v, d] of [[1, vol, dur], [4, vol * 0.35, 0.12]] as [number, number, number][]) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * mul;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g);
    g.connect(musicBus!);
    o.start(t);
    o.stop(t + d + 0.05);
  }
}
// Bas: yuvarlak, kısa sönen ton
function pluck(f: number, t: number, dur: number, vol: number) {
  const c = ctx!;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.value = f;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(musicBus!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function isMusicOn() {
  return musicOn;
}

export function setMusic(on: boolean) {
  musicOn = on;
  if (musicBus && ctx) musicBus.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.3);
  try {
    localStorage.setItem('aksoy-city-music', on ? '1' : '0');
  } catch {
    // önemli değil
  }
}

// Gece müzik sakinleşir (0 gündüz, 1 gece)
export function setMusicNight(n: number) {
  musicNight = n;
}
