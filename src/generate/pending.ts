// Finished chapter MP3s that haven't reached Drive yet. Kept on the device so a
// lapsed sign-in or dropped connection never loses generated audio.

import { idbDelete, idbGet, idbKeys, idbPut } from '../db';

export interface PendingAudio {
  itemPath: string;
  n: number;
  blob: Blob;
  durationSec: number;
}

export interface PendingStore {
  put(p: PendingAudio): Promise<void>;
  list(itemPath: string): Promise<PendingAudio[]>;
  delete(itemPath: string, n: number): Promise<void>;
}

const key = (itemPath: string, n: number) => `${itemPath}#${String(n).padStart(4, '0')}`;

export const idbPending: PendingStore = {
  put: (p) => idbPut('pending', key(p.itemPath, p.n), p),
  async list(itemPath) {
    const keys = (await idbKeys('pending')).filter((k) => k.startsWith(`${itemPath}#`)).sort();
    const out: PendingAudio[] = [];
    for (const k of keys) {
      const p = await idbGet<PendingAudio>('pending', k);
      if (p) out.push(p);
    }
    return out;
  },
  delete: (itemPath, n) => idbDelete('pending', key(itemPath, n)),
};

export function memoryPending(): PendingStore & { items: Map<string, PendingAudio> } {
  const items = new Map<string, PendingAudio>();
  return {
    items,
    async put(p) {
      items.set(key(p.itemPath, p.n), p);
    },
    async list(itemPath) {
      return [...items.entries()]
        .filter(([k]) => k.startsWith(`${itemPath}#`))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => v);
    },
    async delete(itemPath, n) {
      items.delete(key(itemPath, n));
    },
  };
}

/** A chapter part-way through generation. */
export interface ChapterCheckpoint {
  itemPath: string;
  n: number;
  voice: string;
  /** Detects edited chapter text, which makes the step index meaningless. */
  textHash: string;
  /** Index of the next speech step to generate. */
  step: number;
  said: number;
  blob: Blob;
  samples: number;
}

export interface CheckpointStore {
  get(itemPath: string, n: number): Promise<ChapterCheckpoint | undefined>;
  put(c: ChapterCheckpoint): Promise<void>;
  delete(itemPath: string, n: number): Promise<void>;
}

export const idbCheckpoints: CheckpointStore = {
  get: (itemPath, n) => idbGet<ChapterCheckpoint>('checkpoints', key(itemPath, n)),
  put: (c) => idbPut('checkpoints', key(c.itemPath, c.n), c),
  delete: (itemPath, n) => idbDelete('checkpoints', key(itemPath, n)),
};

export function memoryCheckpoints(): CheckpointStore & { items: Map<string, ChapterCheckpoint> } {
  const items = new Map<string, ChapterCheckpoint>();
  return {
    items,
    get: async (itemPath, n) => items.get(key(itemPath, n)),
    put: async (c) => void items.set(key(c.itemPath, c.n), c),
    delete: async (itemPath, n) => void items.delete(key(itemPath, n)),
  };
}

/** Cheap, stable fingerprint of chapter text (FNV-1a). */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}:${(h >>> 0).toString(16)}`;
}
