import { describe, expect, it } from 'vitest';
import { levelPcm, rms, TARGET_RMS } from '../src/audio/level';
import type { IndexedItem } from '../src/library/libraryIndex';
import type { Item } from '../src/model/item';
import { planAutoDownloads } from '../src/offline/autoDownload';
import { smartRewindSec } from '../src/player/rewind';
import { backupIfDue, dayStamp, listBackups, restoreBackup, toPrune } from '../src/sync/backups';
import { readText } from '../src/storage/Storage';
import { FakeDrive, makeStorage } from './fakeDrive';

describe('smart rewind', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it('rewinds more the longer you were away', () => {
    expect([smartRewindSec(ago(60_000), now), smartRewindSec(ago(30 * 60_000), now), smartRewindSec(ago(5 * 3600_000), now), smartRewindSec(ago(3 * 86400_000), now)]).toEqual([2, 10, 20, 30]);
    expect(smartRewindSec(undefined, now)).toBe(2);
  });
});

describe('loudness levelling', () => {
  const tone = (amp: number) => Float32Array.from({ length: 24000 }, (_, i) => amp * Math.sin(i / 5));
  it('brings quiet and loud speech towards the same level, within ±6 dB', () => {
    expect(rms(levelPcm(tone(0.08)))).toBeCloseTo(TARGET_RMS, 2);
    expect(rms(levelPcm(tone(0.2)))).toBeCloseTo(TARGET_RMS, 2);
    expect(rms(levelPcm(tone(0.01)))).toBeCloseTo(0.01 * 2 / Math.SQRT2, 3); // capped at +6 dB
  });
  it('never clips and leaves silence alone', () => {
    const loud = tone(0.9);
    expect(Math.max(...levelPcm(loud).map(Math.abs))).toBeLessThanOrEqual(0.97);
    const quiet = new Float32Array(1000);
    expect(levelPcm(quiet)).toBe(quiet);
  });
});

describe('safety copies', () => {
  it('copies State files once a day, keeps 7 days, and restores a day', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.write('State/playback.json', '{"v":"day1"}');
    await storage.write('State/bookmarks.json', '{"b":1}');
    let marker: string | undefined;
    const m = { get: async () => marker, set: async (d: string) => void (marker = d) };
    const d1 = new Date(2026, 9, 1, 9);
    expect(await backupIfDue(storage, d1, m)).toBe('2026-10-01');
    expect(await backupIfDue(storage, d1, m)).toBeNull(); // already done today on this device
    marker = undefined;
    expect(await backupIfDue(storage, d1, m)).toBeNull(); // another device already did today
    for (let d = 2; d <= 9; d++) {
      await storage.write('State/playback.json', `{"v":"day${d}"}`);
      await backupIfDue(storage, new Date(2026, 9, d, 9), m);
    }
    const days = await listBackups(storage);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-10-09');
    expect(days.at(-1)).toBe('2026-10-03');
    expect(await restoreBackup(storage, '2026-10-05')).toEqual(['playback.json', 'bookmarks.json']);
    expect(await readText(storage, 'State/playback.json')).toBe('{"v":"day5"}');
  });
  it('prunes oldest first and names days locally', () => {
    expect(toPrune(['2026-10-01', '2026-10-03', '2026-10-02', 'junk'], 2)).toEqual(['2026-10-01']);
    expect(dayStamp(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('auto-download plan', () => {
  const item = (id: string, minutes: number): IndexedItem => ({
    path: `Library/General/${id}`,
    item: { id, title: id, collection: 'General', chapters: [{ n: 1, status: 'done', durationSec: minutes * 60 }] } as unknown as Item,
  });
  const now = Date.parse('2026-10-09T12:00:00Z');
  it('downloads Up next and recent desktop jobs, evicting old auto-downloads but never manual ones', () => {
    const a = item('a', 60); // ~29 MB
    const b = item('b', 60);
    const c = item('c', 60);
    const plan = planAutoDownloads({
      items: [a, b, c],
      upNext: ['a'],
      jobs: [
        { itemPath: b.path, status: 'done', updatedAt: '2026-10-08T12:00:00Z' },
        { itemPath: c.path, status: 'done', updatedAt: '2026-09-01T12:00:00Z' }, // too old
      ],
      records: {
        old: { itemId: 'old', chapters: [1], bytes: 20e6, at: '2026-10-01', auto: true },
        mine: { itemId: 'mine', chapters: [1], bytes: 20e6, at: '2026-09-01' },
      },
      isDownloaded: () => false,
      capBytes: 90e6,
      now,
    });
    expect(plan.download.map((x) => x.item.id)).toEqual(['a', 'b']);
    expect(plan.evict).toEqual(['old']);
  });
});
