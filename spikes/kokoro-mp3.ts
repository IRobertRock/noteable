// Phase 2 spike: is kokoro-js + wasm-media-encoders fast enough, and is the MP3 right?
import { KokoroTTS } from 'kokoro-js';
import { createMp3Encoder } from 'wasm-media-encoders';

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

const log = (s: string) => ((document.getElementById('log') as HTMLPreElement).textContent += s + '\n');

function groups(text: string, max = 300): string[] {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences.map((x) => x.trim())) {
    if (cur && cur.length + s.length + 1 > max) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

document.getElementById('run')!.addEventListener('click', async () => {
  const choice = (document.getElementById('device') as HTMLSelectElement).value;
  const hasGpu = !!(await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter());
  const device = choice === 'auto' ? (hasGpu ? 'webgpu' : 'wasm') : (choice as 'webgpu' | 'wasm');
  const dtype = device === 'webgpu' ? 'fp32' : 'q8';
  log(`UA: ${navigator.userAgent}`);
  log(`WebGPU adapter: ${hasGpu}; using ${device} ${dtype}; crossOriginIsolated=${self.crossOriginIsolated}; cores=${navigator.hardwareConcurrency}`);

  let t = performance.now();
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype,
    device,
    progress_callback: (p: { status: string; file?: string; progress?: number }) => {
      if (p.status === 'done') log(`  loaded ${p.file}`);
    },
  });
  log(`Model ready in ${((performance.now() - t) / 1000).toFixed(1)} s`);

  // Warm-up (first WebGPU run compiles shaders)
  t = performance.now();
  await tts.generate('Warming up.', { voice: 'af_bella' });
  log(`Warm-up ${((performance.now() - t) / 1000).toFixed(1)} s`);

  const enc = await createMp3Encoder();
  enc.configure({ sampleRate: 24000, channels: 1, bitrate: 64 });
  const parts: Uint8Array[] = [];
  const gap = new Float32Array(24000 * 0.25);
  let audioSec = 0;
  const chunks = groups(TEXT);
  t = performance.now();
  for (const [i, chunk] of chunks.entries()) {
    const raw = await tts.generate(chunk, { voice: 'af_bella' });
    const pcm = raw.audio as Float32Array;
    if (raw.sampling_rate !== 24000) log(`  unexpected sample rate ${raw.sampling_rate}`);
    audioSec += pcm.length / 24000 + 0.25;
    parts.push(enc.encode([pcm]).slice(), enc.encode([gap]).slice());
    const el = (performance.now() - t) / 1000;
    log(`  group ${i + 1}/${chunks.length}: ${chunk.length} chars, audio ${audioSec.toFixed(1)} s, elapsed ${el.toFixed(1)} s, RTF ${(audioSec / el).toFixed(2)}x`);
  }
  parts.push(enc.finalize().slice());
  const elapsed = (performance.now() - t) / 1000;
  const blob = new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
  log(`DONE: ${audioSec.toFixed(1)} s of audio in ${elapsed.toFixed(1)} s => ${(audioSec / elapsed).toFixed(2)}x real time`);
  log(`MP3 ${(blob.size / 1024).toFixed(0)} KB => ${((blob.size * 8) / audioSec / 1000).toFixed(1)} kbps average`);

  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  log(`First bytes: ${[...head].map((b) => b.toString(16).padStart(2, '0')).join(' ')} (ff f3/f2 = MPEG-2 Layer III frame sync)`);
  const decoded = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
  log(`Decoded duration ${decoded.duration.toFixed(1)} s, ${decoded.sampleRate} Hz, ${decoded.numberOfChannels} ch`);
  const player = document.getElementById('player') as HTMLAudioElement;
  player.src = URL.createObjectURL(blob);
  (window as unknown as { spikeResult: unknown }).spikeResult = { device, dtype, audioSec, elapsed, rtf: audioSec / elapsed, bytes: blob.size, decoded: decoded.duration };
});
