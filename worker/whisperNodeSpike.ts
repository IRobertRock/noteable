// Phase 13 spike: Whisper in Node (onnxruntime-node), CPU and DirectML, since
// WebGPU in Chrome returns garbage on the RX 9070 XT. Audio: the lecture text
// spoken by the worker's CPU Kokoro engine.
// Run: npx tsx worker/whisperNodeSpike.ts
import { pipeline } from '@huggingface/transformers';
import { NodeKokoroEngine } from './engine';
import { LECTURE, wer, words } from './spikeText';

const kokoro = new NodeKokoroEngine();
await kokoro.load();
const parts: Float32Array[] = [];
for (const para of LECTURE.split(/\n\s*\n/)) parts.push(await kokoro.generate(para.trim(), 'af_bella'), new Float32Array(12000));
const all = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
let off = 0;
for (const p of parts) {
  all.set(p, off);
  off += p.length;
}
const pcm = new Float32Array(Math.floor((all.length * 2) / 3));
for (let i = 0; i < pcm.length; i++) {
  const x = i * 1.5;
  const j = Math.floor(x);
  const f = x - j;
  pcm[i] = all[j] * (1 - f) + (all[j + 1] ?? 0) * f;
}
const audioSec = pcm.length / 16000;
console.log(`Audio: ${audioSec.toFixed(0)} s`);

const VARIANTS = (process.env.VARIANTS || 'whisper-base.en:cpu:fp32,whisper-small.en:cpu:fp32,whisper-small.en:cpu:q8,whisper-small.en:dml:fp32').split(',');
for (const v of VARIANTS) {
  const [model, device, dtype] = v.split(':');
  try {
    const t0 = performance.now();
    const asr = (await pipeline('automatic-speech-recognition', `onnx-community/${model}`, { device: device as never, dtype: dtype as never })) as unknown as (a: Float32Array, o: object) => Promise<{ text: string }>;
    const t1 = performance.now();
    const out = await asr(pcm, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
    const t2 = performance.now();
    const sec = (t2 - t1) / 1000;
    console.log(`RESULT ${v}: load ${((t1 - t0) / 1000).toFixed(1)} s, ${sec.toFixed(1)} s = ${(audioSec / sec).toFixed(1)}x real time, WER ${(wer(words(LECTURE), words(out.text)) * 100).toFixed(1)}%`);
    console.log(`  ${out.text.slice(0, 160)}`);
  } catch (err) {
    console.log(`RESULT ${v}: failed ${(err as Error).message.slice(0, 200)}`);
  }
}
