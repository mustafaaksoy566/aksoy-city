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
