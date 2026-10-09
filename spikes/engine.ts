// Exposes the browser Kokoro engine (WebGPU) to the desktop worker, which drives
// this page in headless Chrome. PCM comes back base64-encoded (Float32, 24 kHz mono).
import { KokoroEngine } from '../src/tts/engine';

const engine = new KokoroEngine();

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

(window as unknown as { noteable: unknown }).noteable = {
  version: 1,
  load: () => engine.load(),
  async generate(text: string, voice: string): Promise<string> {
    const pcm = await engine.generate(text, voice);
    return toBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  },
};
