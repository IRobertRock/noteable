// Phase 6 spike: Kokoro in Node on this desktop. DirectML (GPU) vs CPU, plus MP3 encoding.
// Run: npx tsx worker/spike.ts [dml|cpu]
import { writeFileSync } from 'node:fs';
import { KokoroTTS } from 'kokoro-js';
import { createMp3Encoder } from 'wasm-media-encoders';
import { textToGroups } from '../src/tts/chunk';

const TEXT = `Opportunity cost is the value of the next best alternative you give up when you make a choice.
Every decision has one, even when no money changes hands. If you spend an evening studying, the opportunity cost is whatever else you would have done with that time.
Economists care about opportunity cost because it captures the real trade-offs people face. Prices are one signal of cost, but time, effort and forgone income matter too.
Consider a student who works part time for twenty dollars an hour. A three-hour concert costs the ticket price plus sixty dollars of wages not earned.
If that student's wage rises, the cost of the concert rises with it, even though the ticket price has not changed.
Firms face the same logic. A factory that makes chairs cannot use the same machines to make tables at the same moment, so each chair costs some tables.
This idea leads directly to the production possibilities frontier, which shows the combinations of goods an economy can produce with its resources.
Points on the frontier are efficient. Points inside it waste resources. Points outside it cannot be reached with current resources and technology.
Moving along the frontier means producing more of one good and less of the other, and the slope tells you the opportunity cost.
When the frontier is bowed outward, opportunity costs increase as you specialise, because resources are not equally suited to every task.
Economic growth shifts the whole frontier outward. Better technology, more workers, or more capital all let an economy produce more of everything.
The key lesson is simple. Nothing is free, because every choice closes the door on something else.`;

const device = (process.argv[2] ?? 'dml') as 'cpu';
const dtype = 'fp32';
let t = performance.now();
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype, device });
console.log(`device=${device} dtype=${dtype} load ${((performance.now() - t) / 1000).toFixed(1)} s`);

t = performance.now();
await tts.generate('Warming up.', { voice: 'af_bella' });
console.log(`warm-up ${((performance.now() - t) / 1000).toFixed(1)} s`);

const enc = await createMp3Encoder();
enc.configure({ sampleRate: 24000, channels: 1, bitrate: 64 });
const parts: Uint8Array[] = [];
let audio = 0;
t = performance.now();
for (const g of textToGroups(TEXT)) {
  const raw = await tts.generate(g, { voice: 'af_bella' });
  const pcm = raw.audio as Float32Array;
  audio += pcm.length / 24000;
  parts.push(enc.encode([pcm]).slice());
}
parts.push(enc.finalize().slice());
const sec = (performance.now() - t) / 1000;
const bytes = Buffer.concat(parts);
writeFileSync(`worker/spike-${device}.mp3`, bytes);
console.log(`RESULT device=${device}: ${audio.toFixed(1)} s audio in ${sec.toFixed(1)} s = ${(audio / sec).toFixed(1)}x real time; mp3 ${(bytes.length / 1024).toFixed(0)} KB, ${((bytes.length * 8) / audio / 1000).toFixed(1)} kbps, first bytes ${bytes.subarray(0, 2).toString('hex')}`);
