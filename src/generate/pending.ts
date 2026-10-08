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
