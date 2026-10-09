// Exposes the browser engines (WebGPU) to the desktop worker, which drives this
// page in headless Chrome:
//   - Kokoro voices: PCM comes back base64-encoded (Float32, 24 kHz mono).
//   - Whisper transcription: the worker puts the recording in the file input;
//     Chrome decodes it (MP3, M4A, WAV, WebM…) and Whisper returns timed text.
import { KokoroEngine } from '../src/tts/engine';

const engine = new KokoroEngine();

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface TimedText {
  text: string;
  start: number;
  end: number;
}

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;
const asrByModel = new Map<string, Promise<Asr>>();

export interface AsrOptions {
  device?: 'webgpu' | 'wasm';
  encoder?: string;
  decoder?: string;
}
const DEFAULT_ASR: Required<AsrOptions> = { device: 'webgpu', encoder: 'fp32', decoder: 'fp32' };

function loadAsr(model: string, o: AsrOptions = {}): Promise<Asr> {
  const opts = { ...DEFAULT_ASR, ...o };
  const key = `${model}|${opts.device}|${opts.encoder}|${opts.decoder}`;
  let p = asrByModel.get(key);
  if (!p) {
    p = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      const asr = await pipeline('automatic-speech-recognition', model, {
        device: opts.device,
        dtype: { encoder_model: opts.encoder, decoder_model_merged: opts.decoder } as never,
      });
      return asr as unknown as Asr;
    })();
    p.catch(() => asrByModel.delete(key));
    asrByModel.set(key, p);
  }
  return p;
}

async function decode16k(data: ArrayBuffer): Promise<Float32Array> {
  // An OfflineAudioContext at 16 kHz resamples while decoding.
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const buf = await ctx.decodeAudioData(data);
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
  }
  return out;
}

async function transcribePcm(pcm16k: Float32Array, model: string, o?: AsrOptions): Promise<TimedText[]> {
  const asr = await loadAsr(model, o);
  const out = await asr(pcm16k, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
  const total = pcm16k.length / 16000;
  return (out.chunks ?? [{ text: out.text, timestamp: [0, total] }]).map((c) => ({ text: c.text.trim(), start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? total }));
}

function resample24to16(pcm: Float32Array): Float32Array {
  const out = new Float32Array(Math.floor((pcm.length * 2) / 3));
  for (let i = 0; i < out.length; i++) {
    const x = i * 1.5;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = pcm[j] * (1 - f) + (pcm[j + 1] ?? 0) * f;
  }
  return out;
}

const fileInput = Object.assign(document.createElement('input'), { type: 'file', id: 'recording' });
document.body.append(fileInput);

(window as unknown as { noteable: unknown }).noteable = {
  version: 2,
  load: () => engine.load(),
  async generate(text: string, voice: string): Promise<string> {
    const pcm = await engine.generate(text, voice);
    return toBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  },
  /** Transcribes the file the worker put in #recording. */
  async transcribeFile(model: string, o?: AsrOptions): Promise<{ durationSec: number; segments: TimedText[]; elapsedSec: number }> {
    const file = fileInput.files?.[0];
    if (!file) throw new Error('No recording given');
    const t0 = performance.now();
    const pcm = await decode16k(await file.arrayBuffer());
    const segments = await transcribePcm(pcm, model, o);
    return { durationSec: pcm.length / 16000, segments, elapsedSec: (performance.now() - t0) / 1000 };
  },
  /** Spike: speak `text` with Kokoro, then time Whisper on it. */
  async spikeTranscribe(text: string, voice: string, model: string, o?: AsrOptions): Promise<{ audioSec: number; loadSec: number; elapsedSec: number; transcript: string }> {
    const parts: Float32Array[] = [];
    for (const para of text.split(/\n\s*\n/)) if (para.trim()) parts.push(await engine.generate(para.trim(), voice), new Float32Array(12000));
    const all = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
    let off = 0;
    for (const p of parts) all.set(p, (off += p.length) - p.length);
    const pcm16 = resample24to16(all);
    const t0 = performance.now();
    await loadAsr(model, o);
    const t1 = performance.now();
    const segs = await transcribePcm(pcm16, model, o);
    const t2 = performance.now();
    return { audioSec: pcm16.length / 16000, loadSec: (t1 - t0) / 1000, elapsedSec: (t2 - t1) / 1000, transcript: segs.map((s) => s.text).join(' ') };
  },
};
