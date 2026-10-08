import { describe, expect, it } from 'vitest';
import type { Mp3Writer } from '../src/audio/mp3';
import { memoryCheckpoints, memoryPending } from '../src/generate/pending';
import { importMarkdown } from '../src/import/importMarkdown';
import type { Item } from '../src/model/item';
import { readJson, writeJson, type Job, type Storage } from '../src/storage/Storage';
import type { TtsEngine } from '../src/tts/engine';
import { QueueWorker } from '../worker/queue';
import { FakeDrive, makeStorage } from './fakeDrive';

const GUIDE = '---\ntitle: Queued\n---\n## One\nFirst.\n\n## Two\nSecond.\n';

const writer = async (): Promise<Mp3Writer> => {
  let sec = 0;
  return {
    push: (p) => void (sec += p.length / 24000),
    silence: (s) => void (sec += s),
    get durationSec() {
      return sec;
    },
    checkpoint: () => ({ blob: new Blob(['x']), samples: sec * 24000 }),
    finish: () => new Blob([`mp3 ${sec}`], { type: 'audio/mpeg' }),
  };
};

function engine(opts: { delayMs?: number; failWith?: Error } = {}): TtsEngine & { calls: number } {
  const e = {
    calls: 0,
    load: async () => ({ device: 'cpu', dtype: 'fp32' }),
    generate: async () => {
      e.calls++;
      if (opts.failWith) throw opts.failWith;
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      return new Float32Array(24000);
    },
  };
  return e;
}

async function setup() {
  const drive = new FakeDrive();
  const { storage } = makeStorage(drive);
  await storage.write('Inbox/q.md', GUIDE);
  const { itemPath } = await importMarkdown(storage, 'Inbox/q.md');
  const id = await storage.enqueue({ itemPath, chapters: [1, 2], voice: 'am_michael' });
  return { drive, storage, itemPath, id };
}

function worker(storage: Storage, name: string, e: TtsEngine, now?: () => number) {
  return new QueueWorker({ storage, engine: e, createWriter: writer, pending: memoryPending(), checkpoints: memoryCheckpoints(), workerName: name, heartbeatMs: 2, now });
}

describe('desktop queue worker', () => {
  it('claims a pending job, generates every chapter, uploads and marks it done', async () => {
    const { drive, storage, itemPath, id } = await setup();
    const w = worker(storage, 'desktop', engine({ delayMs: 3 }));
    const states: string[] = [];
    w.onState = (s) => states.push(s.kind);
    expect(await w.tick()).toBe(id);
    const job = await readJson<Job>(storage, `Queue/${id}.json`);
    expect(job.status).toBe('done');
    expect(job.claimedBy).toBe('desktop');
    expect(job.heartbeat).toBeDefined();
    expect(job.progress?.chaptersTotal).toBe(2);
    const item = await readJson<Item>(storage, `${itemPath}/item.json`);
    expect(item.status).toBe('ready');
    expect(item.voice).toBe('am_michael');
    expect(drive.find(`Noteable/${itemPath}/audio/02.mp3`)).toHaveLength(1);
    expect(states).toContain('working');
    expect(states[states.length - 1]).toBe('idle');
    expect(await w.tick()).toBeNull(); // nothing left
  });

  it('two workers racing for one job: exactly one runs it', async () => {
    const { storage, id } = await setup();
    const ea = engine();
    const eb = engine();
    const [ra, rb] = await Promise.all([worker(storage, 'a', ea).tick(), worker(storage, 'b', eb).tick()]);
    expect([ra, rb].filter(Boolean)).toEqual([id]);
    expect(Number(ea.calls > 0) + Number(eb.calls > 0)).toBe(1);
  });

  it("reclaims another worker's job after 15 minutes without a heartbeat", async () => {
    const { drive, id } = await setup();
    let now = Date.parse('2026-10-08T12:00:00Z');
    const clock = () => now;
    // Worker and storage share the clock, as they share the real one in use.
    const { storage } = makeStorage(drive, { now: clock });
    const claimed = await storage.claim(id, 'laptop');
    await writeJson(storage, `Queue/${id}.json`, { ...claimed, heartbeat: new Date(now).toISOString() });
    const w = worker(storage, 'desktop', engine(), clock);
    now += 14 * 60_000;
    expect(await w.tick()).toBeNull();
    now += 2 * 60_000;
    expect(await w.tick()).toBe(id);
  });

  it('picks its own interrupted job straight back up after a restart', async () => {
    const { storage, id } = await setup();
    await storage.claim(id, 'desktop'); // then the worker was killed
    const e = engine();
    expect(await worker(storage, 'desktop', e).tick()).toBe(id);
    expect((await readJson<Job>(storage, `Queue/${id}.json`)).status).toBe('done');
  });

  it('marks a job failed with the error, and remembers it for the tray', async () => {
    const { storage, id } = await setup();
    const w = worker(storage, 'desktop', engine({ failWith: new Error('out of memory') }));
    await w.tick();
    const job = await readJson<Job>(storage, `Queue/${id}.json`);
    expect(job.status).toBe('failed');
    expect(job.error).toBe('out of memory');
    expect(w.lastError).toBe('out of memory');
  });

  it('puts the job back when Google sign-in is needed', async () => {
    const { storage, id } = await setup();
    const err = Object.assign(new Error('Google sign-in needed: expired'), { name: 'SignInNeeded' });
    const w = worker(storage, 'desktop', engine({ failWith: err }));
    await w.tick();
    expect((await readJson<Job>(storage, `Queue/${id}.json`)).status).toBe('pending');
    expect(w.state.kind).toBe('signed-out');
  });

  it('ignores cancelled (deleted) jobs and does nothing while paused', async () => {
    const { storage, id } = await setup();
    const w = worker(storage, 'desktop', engine());
    w.paused = true;
    expect(await w.tick()).toBeNull();
    expect(w.state.kind).toBe('paused');
    await storage.delete(`Queue/${id}.json`);
    w.paused = false;
    expect(await w.tick()).toBeNull();
  });
});

describe('queue actions in the app', async () => {
  const { listJobs, removeJob, retryJob, sendToDesktop, activeJobFor } = await import('../src/queue/jobs');

  it('sends only the chapters still to generate, and shows the job on the item', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.write('Inbox/q.md', GUIDE);
    const { itemPath, item } = await importMarkdown(storage, 'Inbox/q.md');
    item.chapters[0].status = 'done';
    const id = await sendToDesktop(storage, itemPath, item, item.voice);
    const job = (await listJobs(storage)).find((j) => j.id === id)!;
    expect(job.chapters).toEqual([2]);
    expect(activeJobFor(await listJobs(storage), itemPath)?.id).toBe(id);
  });

  it('a new voice sends every chapter', async () => {
    const { storage, itemPath } = await setup();
    const item = await readJson<Item>(storage, `${itemPath}/item.json`);
    item.chapters.forEach((c) => (c.status = 'done'));
    const id = await sendToDesktop(storage, itemPath, item, 'bf_emma');
    expect((await readJson<Job>(storage, `Queue/${id}.json`)).chapters).toEqual([1, 2]);
  });

  it('cancel works only before the desktop starts; failed jobs can be retried', async () => {
    const { storage, id } = await setup();
    const claimed = (await storage.claim(id, 'desktop'))!;
    await expect(removeJob(storage, claimed)).rejects.toThrow(/working/);
    await storage.complete(id, { status: 'failed', error: 'boom' });
    await retryJob(storage, await readJson<Job>(storage, `Queue/${id}.json`));
    const again = await readJson<Job>(storage, `Queue/${id}.json`);
    expect([again.status, again.error, again.claimedBy]).toEqual(['pending', undefined, undefined]);
    await removeJob(storage, again);
    expect(await listJobs(storage)).toHaveLength(0);
  });

  it('flags a working job with no heartbeat for 15 minutes as stalled', async () => {
    const { storage, id } = await setup();
    await storage.claim(id, 'desktop');
    const later = Date.now() + 16 * 60_000;
    expect((await listJobs(storage, later))[0].stalled).toBe(true);
  });
});
