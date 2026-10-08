// Runs the real worker pieces (Kokoro on CPU, MP3 encoder, on-disk stores) end to end
// against an in-memory Drive. No Google account needed.  Run: npx tsx worker/selftest.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMp3Writer } from '../src/audio/mp3';
import { importMarkdown } from '../src/import/importMarkdown';
import type { Item } from '../src/model/item';
import { readJson, type Job } from '../src/storage/Storage';
import { FakeDrive, makeStorage } from '../test/fakeDrive';
import { NodeKokoroEngine } from './engine';
import { QueueWorker } from './queue';
import { fileCheckpoints, filePending } from './stores';

const dir = mkdtempSync(join(tmpdir(), 'noteable-selftest-'));
const drive = new FakeDrive();
const { storage } = makeStorage(drive);
await storage.write(
  'Inbox/selftest.md',
  `---\ntitle: Worker self-test\nvoice: Fable\n---\n## One\nThe desktop worker turns queued items into audio while your phone is locked.\n\n## Two\nIt uses the same chunking, voices and MP3 settings as the phone.\n`,
);
const { itemPath } = await importMarkdown(storage, 'Inbox/selftest.md');
const id = await storage.enqueue({ itemPath, chapters: [1, 2], voice: 'bm_fable' });

const worker = new QueueWorker({
  storage,
  engine: new NodeKokoroEngine(),
  createWriter: createMp3Writer,
  pending: filePending(join(dir, 'pending')),
  checkpoints: fileCheckpoints(join(dir, 'checkpoints')),
  workerName: 'selftest',
  heartbeatMs: 500,
  log: (m, e) => console.log(m, e ?? ''),
});
const t = performance.now();
const ran = await worker.tick();
const job = await readJson<Job>(storage, `Queue/${id}.json`);
const item = await readJson<Item>(storage, `${itemPath}/item.json`);
const mp3 = Buffer.from(await (await storage.read(`${itemPath}/audio/01.mp3`)).arrayBuffer());
console.log(
  `SELFTEST ran=${ran === id} job=${job.status} item=${item.status} chapters=${item.chapters.map((c) => `${c.n}:${c.status}:${c.durationSec}s`).join(',')} ` +
    `mp3=${mp3.length}B header=${mp3.subarray(0, 2).toString('hex')} rtf=${item.lastGenerated?.realTimeFactor} seconds=${((performance.now() - t) / 1000).toFixed(1)}`,
);
rmSync(dir, { recursive: true, force: true });
