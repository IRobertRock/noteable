// Phase 13 spike: Whisper on WebGPU in headless Chrome (same setup as the voices).
// Speaks a lecture-style text with Kokoro, then times each Whisper model on it and
// estimates the word error rate against the known text.
// Run (with `npx vite --port 5199` running): npx tsx worker/whisperSpike.ts
import puppeteer from 'puppeteer';
import { join } from 'node:path';
import { DATA_DIR } from './config';
import { LECTURE, wer, words } from './spikeText';

const URL = process.env.NOTEABLE_ENGINE_URL || 'http://localhost:5199/noteable/spikes/engine.html';
const MODELS = (process.env.MODELS || 'onnx-community/whisper-base.en,onnx-community/whisper-small.en').split(',');
const REPEAT = Number(process.env.REPEAT || 3);

const text = Array.from({ length: REPEAT }, () => LECTURE).join('\n\n');
const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
  userDataDir: join(DATA_DIR, 'chrome-profile-spike'),
  protocolTimeout: 1_800_000,
});
try {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('page:', m.text()));
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => !!(window as unknown as { noteable?: unknown }).noteable, { timeout: 60_000 });
  const info = await page.evaluate(() => (window as unknown as { noteable: { load(): Promise<unknown> } }).noteable.load());
  console.log('Kokoro:', JSON.stringify(info));
  const VARIANTS = (process.env.VARIANTS || 'webgpu:fp32:fp32,webgpu:fp32:q8,wasm:q8:q8').split(',').map((v) => {
    const [device, encoder, decoder] = v.split(':');
    return { device, encoder, decoder };
  });
  for (const model of MODELS) for (const o of VARIANTS) {
    const r = await page.evaluate(
      (t, m, opts) => (window as unknown as { noteable: { spikeTranscribe(t: string, v: string, m: string, o: unknown): Promise<{ audioSec: number; loadSec: number; elapsedSec: number; transcript: string }> } }).noteable.spikeTranscribe(t, 'af_heart', m, opts),
      text,
      model,
      o,
    ).catch((err: Error) => ({ audioSec: 1, loadSec: 0, elapsedSec: 1, transcript: `FAILED ${err.message}` }));
    const e = wer(words(text), words(r.transcript));
    console.log(`RESULT ${model} [${o.device} enc ${o.encoder} dec ${o.decoder}]: ${r.audioSec.toFixed(0)} s audio, model load ${r.loadSec.toFixed(1)} s, transcribed in ${r.elapsedSec.toFixed(1)} s = ${(r.audioSec / r.elapsedSec).toFixed(1)}x real time, WER ${(e * 100).toFixed(1)}%`);
    console.log(`  sample: ${r.transcript.slice(0, 300)}`);
  }
} finally {
  await browser.close();
}
