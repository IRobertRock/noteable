// Main-thread side of the Kokoro worker.

export const SAMPLE_RATE = 24000;

export interface LoadProgress {
  /** 0–1 across all model files seen so far. */
  fraction: number;
  loadedBytes: number;
  totalBytes: number;
}

export interface TtsEngine {
  load(onProgress?: (p: LoadProgress) => void): Promise<{ device: string; dtype: string }>;
  /** 24 kHz mono PCM. */
  generate(text: string, voice: string): Promise<Float32Array>;
}

export type WorkerRequest =
  | { type: 'load'; id: number; device?: 'webgpu' | 'wasm' }
  | { type: 'generate'; id: number; text: string; voice: string };

export type WorkerResponse =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'loaded'; id: number; device: string; dtype: string }
  | { type: 'audio'; id: number; pcm: Float32Array; sampleRate: number }
  | { type: 'error'; id: number; message: string };

export class KokoroEngine implements TtsEngine {
  private worker: Worker | null = null;
  private seq = 0;
  private readonly waiting = new Map<number, { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void }>();
  private readonly files = new Map<string, { loaded: number; total: number }>();
  private onProgress?: (p: LoadProgress) => void;
  private loaded: Promise<{ device: string; dtype: string }> | null = null;

  load(onProgress?: (p: LoadProgress) => void): Promise<{ device: string; dtype: string }> {
    this.onProgress = onProgress;
    this.loaded ??= this.call({ type: 'load', id: 0 }).then((r) => {
      if (r.type !== 'loaded') throw new Error('Unexpected reply');
      return { device: r.device, dtype: r.dtype };
    });
    this.loaded.catch(() => (this.loaded = null));
    return this.loaded;
  }

  async generate(text: string, voice: string): Promise<Float32Array> {
    const r = await this.call({ type: 'generate', id: 0, text, voice });
    if (r.type !== 'audio') throw new Error('Unexpected reply');
    if (r.sampleRate !== SAMPLE_RATE) throw new Error(`Kokoro returned ${r.sampleRate} Hz, expected ${SAMPLE_RATE}`);
    return r.pcm;
  }

  private call(req: WorkerRequest): Promise<WorkerResponse> {
    const worker = this.ensureWorker();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      worker.postMessage({ ...req, id });
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module', name: 'tts' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        this.files.set(msg.file, { loaded: msg.loaded, total: msg.total });
        let loaded = 0;
        let total = 0;
        for (const f of this.files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        this.onProgress?.({ fraction: total ? loaded / total : 0, loadedBytes: loaded, totalBytes: total });
        return;
      }
      const waiter = this.waiting.get(msg.id);
      if (!waiter) return;
      this.waiting.delete(msg.id);
      if (msg.type === 'error') waiter.reject(new Error(msg.message));
      else waiter.resolve(msg);
    };
    w.onerror = (e) => {
      for (const waiter of this.waiting.values()) waiter.reject(new Error(e.message || 'Voice engine crashed'));
      this.waiting.clear();
      this.worker = null;
      this.loaded = null;
    };
    this.worker = w;
    return w;
  }
}
