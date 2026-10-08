// Runs Kokoro off the main thread. WebGPU fp32 when available, else WASM q8.

import { KokoroTTS } from 'kokoro-js';
import type { WorkerRequest, WorkerResponse } from './engine';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let tts: KokoroTTS | null = null;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      const hasGpu = msg.device !== 'wasm' && !!(await gpu?.requestAdapter().catch(() => null));
      const device = hasGpu ? 'webgpu' : 'wasm';
      const dtype = hasGpu ? 'fp32' : 'q8';
      tts ??= await KokoroTTS.from_pretrained(MODEL, {
        device,
        dtype,
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status === 'progress' && p.file && p.total) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total });
        },
      });
      post({ type: 'loaded', id: msg.id, device, dtype });
    } else if (msg.type === 'generate') {
      if (!tts) throw new Error('Model not loaded');
      const raw = await tts.generate(msg.text, { voice: msg.voice as never });
      const pcm = raw.audio as Float32Array;
      post({ type: 'audio', id: msg.id, pcm, sampleRate: raw.sampling_rate }, [pcm.buffer]);
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
