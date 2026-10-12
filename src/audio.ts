// Kenney sesleri (iPhone OGG çalamadığı için MP3'e çevrildi, bkz. scripts/convert-sounds.mjs).
// iPhone'da ses ancak ilk dokunuştan sonra açılabiliyor ve sessiz moddayken çalmıyor.
const SOUNDS = {
  place: ['placement-a', 'placement-b', 'placement-c', 'placement-d'],
  remove: ['removal-a', 'removal-b', 'removal-c', 'removal-d'],
  grow: ['rotate'],
  click: ['toggle'],
  error: ['removal-a'],
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

async function load(name: string) {
  if (!ctx) return;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}kenney/sounds/${name}.mp3`);
    buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
  } catch {
    // Bu tarayıcı bu ses dosyasını çalamıyorsa sessiz devam et
  }
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
  const names = new Set(Object.values(SOUNDS).flat());
  void Promise.all([...names].map(load));
  void load('ambience').then(startAmbience);
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
