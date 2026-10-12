// Kenney'nin OGG seslerini iPhone'un çalabildiği MP3'e çevirir.
// Kullanım: node scripts/convert-sounds.mjs
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';
import { Mp3Encoder } from '@breezystack/lamejs';

const dir = new URL('../public/kenney/sounds/', import.meta.url);
const decoder = new OggVorbisDecoder();
await decoder.ready;

for (const file of (await readdir(dir)).filter(f => f.endsWith('.ogg'))) {
  const { channelData, sampleRate } = await decoder.decodeFile(await readFile(new URL(file, dir)));
  await decoder.reset();
  const toInt16 = ch => Int16Array.from(ch, s => Math.max(-32768, Math.min(32767, Math.round(s * 32767))));
  const left = toInt16(channelData[0]);
  const right = channelData[1] ? toInt16(channelData[1]) : null;
  const enc = new Mp3Encoder(right ? 2 : 1, sampleRate, file.startsWith('ambience') ? 96 : 128);
  const parts = [];
  for (let i = 0; i < left.length; i += 1152) {
    const l = left.subarray(i, i + 1152);
    parts.push(right ? enc.encodeBuffer(l, right.subarray(i, i + 1152)) : enc.encodeBuffer(l));
  }
  parts.push(enc.flush());
  const out = file.replace(/\.ogg$/, '.mp3');
  await writeFile(new URL(out, dir), Buffer.concat(parts.map(p => Buffer.from(p.buffer, p.byteOffset, p.byteLength))));
  console.log(`${file} -> ${out} (${(left.length / sampleRate).toFixed(1)} sn)`);
}
decoder.free();
