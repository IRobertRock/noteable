// Phase 10 spike: can headless Chrome use the desktop GPU (WebGPU) for Kokoro, and is it
// faster than the worker's CPU path (8.5×)? Runs the deployed speed-test page.
// Run: npx tsx worker/gpuSpike.ts
import puppeteer from 'puppeteer';

const URL = 'https://irobertrock.github.io/noteable/spikes/kokoro-mp3.html';
const variants: { name: string; args: string[]; headless: boolean | 'shell' }[] = [
  { name: 'headless (new) + D3D12 WebGPU', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] },
  { name: 'headless (new) + Vulkan WebGPU', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] },
  { name: 'windowed, off-screen', headless: false, args: ['--enable-unsafe-webgpu', '--window-position=-2400,0', '--window-size=800,600'] },
];

for (const v of variants) {
  const browser = await puppeteer.launch({ headless: v.headless, args: v.args });
  try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'networkidle0' }); // WebGPU needs a secure (https) page
    const adapter = await page.evaluate(async () => {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { vendor?: string; architecture?: string; description?: string } } | null> } }).gpu;
      const a = await gpu?.requestAdapter();
      return a ? JSON.stringify(a.info ?? {}) : null;
    });
    console.log(`${v.name}: adapter=${adapter}`);
    if (!adapter) continue;
    await page.select('#device', 'webgpu');
    await page.click('#run');
    await page.waitForFunction(() => (window as unknown as { spikeResult?: unknown }).spikeResult, { timeout: 300_000 });
    const r = await page.evaluate(() => (window as unknown as { spikeResult: { rtf: number; audioSec: number; elapsed: number } }).spikeResult);
    console.log(`RESULT ${v.name}: ${r.audioSec.toFixed(1)} s audio in ${r.elapsed.toFixed(1)} s = ${r.rtf.toFixed(2)}x`);
  } catch (err) {
    console.log(`${v.name}: failed — ${(err as Error).message}`);
  } finally {
    await browser.close();
  }
}
