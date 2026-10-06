import { describe, expect, it } from 'vitest';
import { readJson, type Job } from '../src/storage/Storage';
import { FakeDrive, makeStorage } from './fakeDrive';

const NEW_JOB = { itemPath: 'Library/General/Item', chapters: [1, 2], voice: 'am_michael' };

describe('queue', () => {
  it('enqueue → claim → complete', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    const id = await storage.enqueue(NEW_JOB);
    const claimed = await storage.claim(id, 'desktop');
    expect(claimed?.status).toBe('working');
    expect(claimed?.claimedBy).toBe('desktop');
    await storage.complete(id, { status: 'done' });
    expect((await readJson<Job>(storage, `Queue/${id}.json`)).status).toBe('done');
  });

  it('a working job cannot be claimed again', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    const id = await storage.enqueue(NEW_JOB);
    await storage.claim(id, 'desktop');
    expect(await storage.claim(id, 'other')).toBeNull();
  });

  it('a working job with a heartbeat older than 15 minutes can be reclaimed', async () => {
    const drive = new FakeDrive();
    let now = Date.parse('2026-10-06T12:00:00Z');
    const { storage } = makeStorage(drive, { now: () => now });
    const id = await storage.enqueue(NEW_JOB);
    await storage.claim(id, 'desktop');
    now += 14 * 60 * 1000;
    expect(await storage.claim(id, 'other')).toBeNull();
    now += 2 * 60 * 1000;
    expect((await storage.claim(id, 'other'))?.claimedBy).toBe('other');
  });

  it('done jobs are never claimed', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    const id = await storage.enqueue(NEW_JOB);
    await storage.complete(id, { status: 'done' });
    expect(await storage.claim(id, 'desktop')).toBeNull();
  });
});
