// GPU generation for the desktop worker: Kokoro on WebGPU inside headless Chrome
// (15.5× real time on the RX 9070 XT vs 8.5× on the CPU; DirectML in Node fails on
// Kokoro). Falls back to the CPU engine if Chrome or WebGPU isn't available.

import { join } from 'node:path';
import type { Browser, Page } from 'puppeteer';
import type { TtsEngine } from '../src/tts/engine';
import { DATA_DIR } from './config';
import { NodeKokoroEngine } from './engine';

export const ENGINE_URL = process.env.NOTEABLE_ENGINE_URL || 'https://irobertrock.github.io/noteable/spikes/engine.html';
const CHROME_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];

/**
 * Speech should sit well inside ±1 with a modest RMS. Some GPU drivers make Kokoro
 * return garbage on WebGPU (huge or non-finite samples), so every chunk is checked.
 * Returns why the audio is bad, or null if it looks like speech.
 */
export function badAudio(pcm: Float32Array): string | null {
  if (!pcm.length) return 'no samples';
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const x = pcm[i];
    if (!Number.isFinite(x)) return 'non-finite samples';
    sum += x * x;
    if (Math.abs(x) > peak) peak = Math.abs(x);
  }
  const rms = Math.sqrt(sum / pcm.length);
  if (peak > 4) return `samples out of range (peak ${peak.toExponential(1)})`;
  if (pcm.length > 12000 && rms < 0.003) return `near-silent output (rms ${rms.toFixed(4)})`;
  return null;
}

const PROBE = 'Good morning. This is a short check that the voice sounds right.';

interface EnginePage {
  noteable?: { load(): Promise<{ device: string; dtype: string }>; generate(text: string, voice: string): Promise<string> };
}

export class GpuEngine implements TtsEngine {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private loading: Promise<{ device: string; dtype: string }> | null = null;

  load(): Promise<{ device: string; dtype: string }> {
    this.loading ??= this.start().catch(async (err) => {
      this.loading = null;
      await this.close();
      throw err;
    });
    return this.loading;
  }

  private async start(): Promise<{ device: string; dtype: string }> {
    const puppeteer = (await import('puppeteer')).default;
    // A persistent profile keeps the ~310 MB voice model cached between runs.
    this.browser = await puppeteer.launch({ headless: true, args: CHROME_ARGS, userDataDir: join(DATA_DIR, 'chrome-profile') });
    this.page = await this.browser.newPage();
    await this.page.goto(ENGINE_URL, { waitUntil: 'networkidle0', timeout: 120_000 });
    await this.page.waitForFunction(() => !!(window as unknown as EnginePage).noteable, { timeout: 60_000 });
    const info = await this.page.evaluate(() => (window as unknown as EnginePage).noteable!.load());
    if (info.device !== 'webgpu') throw new Error(`Chrome has no WebGPU here (got ${info.device})`);
    // Make sure the GPU actually produces speech before trusting it with a job.
    const bad = badAudio(await this.raw(PROBE, 'af_bella'));
    if (bad) throw new Error(`GPU voice output failed the check: ${bad}`);
    return { device: 'webgpu', dtype: info.dtype };
  }

  async generate(text: string, voice: string): Promise<Float32Array> {
    await this.load();
    const pcm = await this.raw(text, voice);
    const bad = badAudio(pcm);
    if (bad) throw new Error(`GPU voice output failed the check: ${bad}`);
    return pcm;
  }

  private async raw(text: string, voice: string): Promise<Float32Array> {
    const b64 = await this.page!.evaluate((t, v) => (window as unknown as EnginePage).noteable!.generate(t, v), text, voice);
    const bytes = Buffer.from(b64, 'base64');
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.page = null;
  }
}

/** GPU when it works, CPU otherwise. NOTEABLE_ENGINE=cpu forces the CPU. */
export class AutoEngine implements TtsEngine {
  private active: TtsEngine | null = null;
  /** 'GPU' or 'CPU' once loaded. */
  get kind(): string | undefined {
    return this.active === null ? undefined : this.active === this.gpu ? 'GPU' : 'CPU';
  }
  private loaded: Promise<{ device: string; dtype: string }> | null = null;

  constructor(
    private readonly log: (msg: string, err?: unknown) => void,
    private readonly gpu = new GpuEngine(),
    private readonly cpu: TtsEngine = new NodeKokoroEngine(),
  ) {}

  load(): Promise<{ device: string; dtype: string }> {
    this.loaded ??= (async () => {
      if (process.env.NOTEABLE_ENGINE !== 'cpu') {
        try {
          const info = await this.gpu.load();
          this.active = this.gpu;
          this.log('Voice engine: GPU (WebGPU in headless Chrome).');
          return info;
        } catch (err) {
          this.log('GPU engine unavailable; using the CPU.', err);
        }
      }
      this.active = this.cpu;
      return this.cpu.load();
    })();
    this.loaded.catch(() => (this.loaded = null));
    return this.loaded;
  }

  async generate(text: string, voice: string): Promise<Float32Array> {
    await this.load();
    try {
      return await this.active!.generate(text, voice);
    } catch (err) {
      if (this.active !== this.gpu) throw err;
      // The GPU page crashed or Chrome went away: finish the job on the CPU.
      this.log('GPU engine failed mid-job; switching to the CPU.', err);
      await this.gpu.close();
      this.active = this.cpu;
      await this.cpu.load();
      return this.cpu.generate(text, voice);
    }
  }

  close(): Promise<void> {
    return this.gpu.close();
  }
}
