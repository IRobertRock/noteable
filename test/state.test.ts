import { describe, expect, it } from 'vitest';
import { clampSpeed, mergeBookmarks, mergePlayback, StateStore, type LocalKv, type PlaybackDoc } from '../src/sync/state';
import { readJson, writeJson } from '../src/storage/Storage';
import { FakeDrive, makeStorage } from './fakeDrive';

function memoryKv(): LocalKv {
  const m = new Map<string, unknown>();
  return { get: async <T,>(k: string) => structuredClone(m.get(k)) as T | undefined, set: async (k, v) => void m.set(k, structuredClone(v)) };
}

function clock(start = '2026-10-08T10:00:00Z') {
  let t = Date.parse(start);
  return { now: () => new Date(t), tick: (sec: number) => (t += sec * 1000) };
}

describe('merges', () => {
  it('playback: latest updatedAt wins per item, other items untouched', () => {
    const a: PlaybackDoc = {
      version: 1,
      items: {
        x: { chapter: 2, positionSec: 90, speed: 1, updatedAt: '2026-10-08T10:05:00Z', device: 'laptop' },
        y: { chapter: 1, positionSec: 5, speed: 1, updatedAt: '2026-10-08T09:00:00Z', device: 'laptop' },
      },
    };
    const b: PlaybackDoc = {
      version: 1,
      items: { x: { chapter: 1, positionSec: 10, speed: 1.5, updatedAt: '2026-10-08T10:01:00Z', device: 'phone' } },
    };
    const m = mergePlayback(b, a);
    expect(m.items.x.device).toBe('laptop');
    expect(m.items.y.positionSec).toBe(5);
    expect(mergePlayback(a, b)).toEqual(m);
  });

  it('bookmarks: soft deletes win when newer', () => {
    const base = { itemId: 'x', chapter: 1, positionSec: 1, note: 'n', createdAt: '2026-10-08T10:00:00Z' };
    const a = { version: 1 as const, bookmarks: [{ ...base, id: '1', updatedAt: '2026-10-08T10:00:00Z' }] };
    const b = { version: 1 as const, bookmarks: [{ ...base, id: '1', deleted: true, updatedAt: '2026-10-08T10:02:00Z' }, { ...base, id: '2', updatedAt: '2026-10-08T10:01:00Z' }] };
    const m = mergeBookmarks(a, b);
    expect(m.bookmarks.find((x) => x.id === '1')?.deleted).toBe(true);
    expect(m.bookmarks).toHaveLength(2);
  });

  it('speed snaps to 0.25 steps between 0.75 and 2', () => {
    expect([0.5, 0.8, 1.1, 1.6, 3, NaN].map(clampSpeed)).toEqual([0.75, 0.75, 1, 1.5, 2, 1]);
  });
});

describe('StateStore', () => {
  async function devices() {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await writeJson(storage, 'State/playback.json', { version: 1, items: {} });
    await writeJson(storage, 'State/bookmarks.json', { version: 1, bookmarks: [] });
    const c = clock();
    const laptop = new StateStore(makeStorage(drive).storage, 'laptop', memoryKv(), c.now);
    const phone = new StateStore(makeStorage(drive).storage, 'phone', memoryKv(), c.now);
    await laptop.load();
    await phone.load();
    return { storage, laptop, phone, c };
  }

  it('a position saved on the laptop reaches the phone', async () => {
    const { laptop, phone } = await devices();
    await laptop.savePosition('item1', { chapter: 2, positionSec: 92.34, speed: 1 });
    await laptop.sync();
    await phone.sync();
    expect(phone.position('item1')).toMatchObject({ chapter: 2, positionSec: 92.3, device: 'laptop' });
  });

  it('offline progress syncs later and the newer position wins', async () => {
    const { laptop, phone, c } = await devices();
    await laptop.savePosition('item1', { chapter: 2, positionSec: 90, speed: 1 });
    await laptop.sync();
    await phone.sync();
    c.tick(60);
    await phone.savePosition('item1', { chapter: 3, positionSec: 10, speed: 1.5 }); // offline: no sync yet
    await phone.sync(); // back online
    await laptop.sync();
    expect(laptop.position('item1')).toMatchObject({ chapter: 3, speed: 1.5, device: 'phone' });
  });

  it('two devices adding bookmarks at once keep both', async () => {
    const { storage, laptop, phone } = await devices();
    await laptop.addBookmark('item1', 1, 30, 'from laptop');
    await phone.addBookmark('item1', 2, 40, 'from phone');
    await laptop.sync();
    await phone.sync();
    await laptop.sync();
    expect(laptop.bookmarksFor('item1').map((b) => b.note).sort()).toEqual(['from laptop', 'from phone']);
    expect((await readJson<{ bookmarks: unknown[] }>(storage, 'State/bookmarks.json')).bookmarks).toHaveLength(2);
  });

  it('deleting a bookmark on one device removes it on the other', async () => {
    const { laptop, phone, c } = await devices();
    const b = await laptop.addBookmark('item1', 1, 30, 'x');
    await laptop.sync();
    await phone.sync();
    c.tick(5);
    await phone.deleteBookmark(b.id);
    await phone.sync();
    await laptop.sync();
    expect(laptop.bookmarksFor('item1')).toHaveLength(0);
  });

  it('does not rewrite Drive when nothing changed', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await writeJson(storage, 'State/playback.json', { version: 1, items: {} });
    await writeJson(storage, 'State/bookmarks.json', { version: 1, bookmarks: [] });
    const s = new StateStore(makeStorage(drive).storage, 'x', memoryKv());
    await s.load();
    drive.calls = [];
    await s.sync();
    expect(drive.count('PATCH', /upload/)).toBe(0);
  });

  it('clamps the speed it saves', async () => {
    const { laptop } = await devices();
    await laptop.savePosition('a', { chapter: 1, positionSec: 0, speed: 9 });
    expect(laptop.position('a')?.speed).toBe(2);
  });
});
