// Phase 13 spike: Whisper on WebGPU in headless Chrome (same setup as the voices).
// Speaks a lecture-style text with Kokoro, then times each Whisper model on it and
// estimates the word error rate against the known text.
// Run (with `npx vite --port 5199` running): npx tsx worker/whisperSpike.ts
import puppeteer from 'puppeteer';
import { join } from 'node:path';
import { DATA_DIR } from './config';

const URL = process.env.NOTEABLE_ENGINE_URL || 'http://localhost:5199/noteable/spikes/engine.html';
const MODELS = (process.env.MODELS || 'onnx-community/whisper-base.en,onnx-community/whisper-small.en').split(',');
const REPEAT = Number(process.env.REPEAT || 3);

const LECTURE = `Good morning, everyone. Today we're going to talk about opportunity cost, which is one of the most important ideas in the whole course. Every time you make a choice, you give something up. The opportunity cost of a decision is the value of the next best alternative that you didn't choose.

Let's start with a simple example. Suppose you have a free evening. You could go to a concert, or you could work a shift at the coffee shop and earn eighty dollars. If you go to the concert, the ticket is free, but you still pay a price. You give up the eighty dollars you would have earned. That's the opportunity cost of the concert.

Notice that opportunity cost isn't always money. If you spend Saturday studying for the midterm, you give up time with your friends, sleep, or a hike in the mountains. Economists try to put all of these on the same scale, but in everyday life we usually compare them in our heads without writing anything down.

Now, why does this matter for a whole economy? Because resources are scarce. A country has a limited number of workers, machines, and acres of farmland. If it uses more of them to build cars, it has fewer left over to grow wheat. We can draw this trade-off as a production possibilities frontier. Points on the curve are efficient. Points inside the curve mean some resources are sitting idle. Points outside the curve can't be reached with what we have today.

The frontier is usually bowed outward. That shape tells us that opportunity cost rises as we specialize. The first workers we move from farming into car factories are the ones who are best at building cars and worst at farming, so we lose very little wheat. But as we keep going, we have to move people who are excellent farmers and terrible mechanics, and each extra car costs us more and more wheat.

Before next class, please read chapter two and try the practice questions at the end. In particular, think about the opportunity cost of attending university instead of working full time. Don't forget to count the income you're giving up, not just tuition and books.`;

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
}

/** Word error rate by edit distance over words. */
function wer(ref: string[], hyp: string[]): number {
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const cur = [i];
    for (let j = 1; j <= hyp.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[hyp.length] / ref.length;
}

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
