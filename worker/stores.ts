// On-disk versions of the phone's IndexedDB stores: finished chapters waiting
// to upload, and mid-chapter checkpoints. A worker restart resumes from them.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChapterCheckpoint, CheckpointStore, PendingAudio, PendingStore } from '../src/generate/pending';

const safe = (itemPath: string) => itemPath.replace(/[^\p{L}\p{N}._-]+/gu, '_');

export function filePending(dir: string): PendingStore {
  mkdirSync(dir, { recursive: true });
  const base = (itemPath: string, n: number) => join(dir, `${safe(itemPath)}__${String(n).padStart(4, '0')}`);
  return {
    async put(p) {
      writeFileSync(`${base(p.itemPath, p.n)}.mp3`, Buffer.from(await p.blob.arrayBuffer()));
      writeFileSync(`${base(p.itemPath, p.n)}.json`, JSON.stringify({ itemPath: p.itemPath, n: p.n, durationSec: p.durationSec }));
    },
    async list(itemPath) {
      const prefix = `${safe(itemPath)}__`;
      return readdirSync(dir)
        .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
        .sort()
        .map((f) => {
          const meta = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Omit<PendingAudio, 'blob'>;
          const blob = new Blob([readFileSync(join(dir, f.replace(/\.json$/, '.mp3')))], { type: 'audio/mpeg' });
          return { ...meta, blob };
        })
        .filter((p) => p.itemPath === itemPath);
    },
    async delete(itemPath, n) {
      rmSync(`${base(itemPath, n)}.mp3`, { force: true });
      rmSync(`${base(itemPath, n)}.json`, { force: true });
    },
  };
}

export function fileCheckpoints(dir: string): CheckpointStore {
  mkdirSync(dir, { recursive: true });
  const base = (itemPath: string, n: number) => join(dir, `${safe(itemPath)}__${String(n).padStart(4, '0')}`);
  return {
    async get(itemPath, n) {
      try {
        const meta = JSON.parse(readFileSync(`${base(itemPath, n)}.json`, 'utf8')) as Omit<ChapterCheckpoint, 'blob'>;
        if (meta.itemPath !== itemPath) return undefined;
        return { ...meta, blob: new Blob([readFileSync(`${base(itemPath, n)}.mp3`)], { type: 'audio/mpeg' }) };
      } catch {
        return undefined;
      }
    },
    async put(c) {
      const { blob, ...meta } = c;
      writeFileSync(`${base(c.itemPath, c.n)}.mp3`, Buffer.from(await blob.arrayBuffer()));
      writeFileSync(`${base(c.itemPath, c.n)}.json`, JSON.stringify(meta));
    },
    async delete(itemPath, n) {
      rmSync(`${base(itemPath, n)}.mp3`, { force: true });
      rmSync(`${base(itemPath, n)}.json`, { force: true });
    },
  };
}
