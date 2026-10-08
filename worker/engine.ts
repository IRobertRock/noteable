// Kokoro in Node on the CPU. (DirectML fails on Kokoro's ConvTranspose layer in
// onnxruntime-node 1.21; the CPU path runs ~8.5× real time on the 9800X3D.)

import { KokoroTTS } from 'kokoro-js';
import { SAMPLE_RATE, type TtsEngine } from '../src/tts/engine';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export class NodeKokoroEngine implements TtsEngine {
  private tts: Promise<KokoroTTS> | null = null;

  async load(): Promise<{ device: string; dtype: string }> {
    this.tts ??= KokoroTTS.from_pretrained(MODEL, { dtype: 'fp32', device: 'cpu' });
    this.tts.catch(() => (this.tts = null));
    await this.tts;
    return { device: 'cpu', dtype: 'fp32' };
  }

  async generate(text: string, voice: string): Promise<Float32Array> {
    if (!this.tts) await this.load();
    const raw = await (await this.tts!).generate(text, { voice: voice as never });
    if (raw.sampling_rate !== SAMPLE_RATE) throw new Error(`Kokoro returned ${raw.sampling_rate} Hz`);
    return raw.audio as Float32Array;
  }
}
