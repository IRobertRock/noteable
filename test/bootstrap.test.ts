import { describe, expect, it } from 'vitest';
import { ensureLayout } from '../src/storage/bootstrap';
import { readJson } from '../src/storage/Storage';
import { FakeDrive, makeStorage } from './fakeDrive';

const PATHS = [
  'Inbox',
  'Library/General',
  'Queue',
  'State',
  'State/playback.json',
  'State/bookmarks.json',
  'State/settings.json',
];

describe('ensureLayout', () => {
  it('creates the whole tree on an empty Drive', async () => {
    const drive = new FakeDrive();
    const status = await ensureLayout(makeStorage(drive).storage);
    expect(status.map((s) => [s.path, s.state])).toEqual(PATHS.map((p) => [p, 'created']));
    for (const p of PATHS) expect(drive.find(`Noteable/${p}`)).toHaveLength(1);
    expect(drive.find('Noteable/Library')).toHaveLength(1);
  });

  it('finds everything on a second run and creates nothing', async () => {
    const drive = new FakeDrive();
    await ensureLayout(makeStorage(drive).storage);
    const before = drive.files.size;
    drive.calls = [];

    // A new DriveStorage simulates signing out and in, or another device.
    const status = await ensureLayout(makeStorage(drive).storage);
    expect(status.every((s) => s.state === 'found')).toBe(true);
    expect(drive.files.size).toBe(before);
    expect(drive.count('POST', /files/)).toBe(0);
    expect(drive.count('PATCH', /files/)).toBe(0);
  });

  it('never overwrites an existing settings file', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.write('State/settings.json', '{"version":1,"voice":"bm_fable"}');
    await ensureLayout(makeStorage(drive).storage);
    const settings = await readJson<{ voice: string }>(makeStorage(drive).storage, 'State/settings.json');
    expect(settings.voice).toBe('bm_fable');
  });

  it('fills in only what is missing', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.mkdir('Inbox');
    const status = await ensureLayout(makeStorage(drive).storage);
    expect(status.find((s) => s.path === 'Inbox')?.state).toBe('found');
    expect(status.find((s) => s.path === 'Queue')?.state).toBe('created');
  });

  it('writes valid starter JSON', async () => {
    const drive = new FakeDrive();
    await ensureLayout(makeStorage(drive).storage);
    const s = makeStorage(drive).storage;
    expect(await readJson(s, 'State/playback.json')).toEqual({ version: 1, items: {} });
    expect(await readJson(s, 'State/bookmarks.json')).toEqual({ version: 1, bookmarks: [] });
  });
});
