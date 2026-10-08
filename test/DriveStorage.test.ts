import { describe, expect, it } from 'vitest';
import { escapeQuery } from '../src/storage/DriveStorage';
import { readText } from '../src/storage/Storage';
import { FakeDrive, makeStorage } from './fakeDrive';

describe('DriveStorage', () => {
  it('creates the root and nested folders once, even when called twice', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.mkdir('Library/General');
    await storage.mkdir('Library/General');
    expect(drive.find('Noteable')).toHaveLength(1);
    expect(drive.find('Noteable/Library')).toHaveLength(1);
    expect(drive.find('Noteable/Library/General')).toHaveLength(1);
  });

  it('does not create duplicates from a fresh instance (new device, same Drive)', async () => {
    const drive = new FakeDrive();
    await makeStorage(drive).storage.mkdir('Inbox');
    await makeStorage(drive).storage.mkdir('Inbox');
    expect(drive.find('Noteable/Inbox')).toHaveLength(1);
  });

  it('writes, replaces and reads a file without duplicating it', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.write('State/a.json', '{"v":1}');
    await storage.write('State/a.json', '{"v":2}');
    expect(drive.find('Noteable/State/a.json')).toHaveLength(1);
    expect(await readText(makeStorage(drive).storage, 'State/a.json')).toBe('{"v":2}');
  });

  it('lists a folder with paths relative to the root', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.write('Inbox/one.md', '# One');
    await storage.mkdir('Inbox/sub');
    const entries = await storage.list('Inbox');
    expect(entries.map((e) => [e.path, e.kind]).sort()).toEqual([
      ['Inbox/one.md', 'file'],
      ['Inbox/sub', 'folder'],
    ]);
  });

  it('moves and renames, creating the destination folder', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.write('Inbox/notes.md', 'hi');
    await storage.move('Inbox/notes.md', 'Library/General/Item/sources/notes-renamed.md');
    expect(await storage.stat('Inbox/notes.md')).toBeNull();
    expect(drive.find('Noteable/Library/General/Item/sources/notes-renamed.md')).toHaveLength(1);
  });

  it('delete moves to trash and refuses the root', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.write('Inbox/x.md', 'x');
    await storage.delete('Inbox/x.md');
    const [file] = [...drive.files.values()].filter((f) => f.name === 'x.md');
    expect(file.trashed).toBe(true);
    await expect(storage.delete('')).rejects.toThrow(/root/);
  });

  it('handles names with quotes and backslashes', async () => {
    expect(escapeQuery(`Rob's \\notes`)).toBe(`Rob\\'s \\\\notes`);
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.write(`Inbox/Rob's notes.md`, 'x');
    expect(await makeStorage(drive).storage.stat(`Inbox/Rob's notes.md`)).not.toBeNull();
  });

  it('uses the oldest Noteable folder and flags duplicates', async () => {
    const drive = new FakeDrive();
    const older = drive.add('Noteable', 'root');
    drive.add('Noteable', 'root');
    const { storage } = makeStorage(drive);
    const root = await storage.stat('');
    expect(root?.id).toBe(older.id);
    expect(storage.duplicateRoot).toBe(true);
  });

  it('ignores trashed folders', async () => {
    const drive = new FakeDrive();
    drive.add('Noteable', 'root').trashed = true;
    const { storage } = makeStorage(drive);
    await storage.mkdir('');
    expect(drive.find('Noteable')).toHaveLength(1);
  });

  it('refreshes the token once on 401 and retries', async () => {
    const drive = new FakeDrive();
    let token = 'stale';
    let refreshes = 0;
    const { storage } = makeStorage(drive, {
      getToken: async () => token,
      refreshToken: async () => {
        refreshes++;
        return (token = drive.validToken);
      },
    });
    await storage.mkdir('Inbox');
    expect(refreshes).toBe(1);
    expect(drive.find('Noteable/Inbox')).toHaveLength(1);
  });

  it('does not loop when a refreshed token is still rejected', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive, { getToken: async () => 'bad', refreshToken: async () => 'still-bad' });
    await expect(storage.stat('')).rejects.toThrow(/Drive 401/);
  });

  it('backs off and retries on 429, 5xx and rate-limit 403', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    drive.failures = [429, 503, 403];
    await storage.mkdir('Queue');
    expect(drive.find('Noteable/Queue')).toHaveLength(1);
  });

  it('uploads large files in resumable chunks, and replaces them the same way', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    const big = 'a'.repeat(17 * 1024 * 1024);
    await storage.write('Library/General/Item/audio/01.mp3', new Blob([big]), 'audio/mpeg');
    const [file] = drive.find('Noteable/Library/General/Item/audio/01.mp3');
    expect(file.content.length).toBe(big.length);
    expect(drive.chunkPuts).toBe(3);

    await storage.write('Library/General/Item/audio/01.mp3', new Blob(['b'.repeat(6 * 1024 * 1024)]), 'audio/mpeg');
    expect(drive.find('Noteable/Library/General/Item/audio/01.mp3')).toHaveLength(1);
    expect(file.content[0]).toBe('b');
  });

  it('resumes a resumable upload after a dropped connection', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    drive.dropChunk = 2;
    const big = 'x'.repeat(20 * 1024 * 1024);
    await storage.write('State/big.bin', new Blob([big]));
    expect(drive.find('Noteable/State/big.bin')[0].content.length).toBe(big.length);
  });

  it('gives up after 4 tries', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    drive.failures = [500, 500, 500, 500];
    await expect(storage.stat('')).rejects.toThrow(/Drive 500/);
  });
});
