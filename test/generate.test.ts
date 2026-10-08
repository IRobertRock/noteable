import { describe, expect, it } from 'vitest';
import { finishUploads, generateItem, type GenerateDeps } from '../src/generate/generateItem';
import { memoryCheckpoints, memoryPending } from '../src/generate/pending';
import { importMarkdown } from '../src/import/importMarkdown';
import type { Item } from '../src/model/item';
import { readJson, type Storage } from '../src/storage/Storage';
import type { Mp3Writer } from '../src/audio/mp3';
import type { TtsEngine } from '../src/tts/engine';
import { FakeDrive, makeStorage } from './fakeDrive';

const GUIDE = `---
title: Week 3
collection: ECON 1000
voice: Michael
---
## One
First chapter text.

## Two
Second chapter text.

## Three
Third chapter text.
`;

/** 1 second of "audio" per call; can be told to fail on a given call. */
function fakeEngine(failOnCall?: number) {
  let calls = 0;
  const engine: TtsEngine & { calls: () => number } = {
    calls: () => calls,
    load: async () => ({ device: 'webgpu', dtype: 'fp32' }),
    generate: async () => {
      calls++;
      if (calls === failOnCall) throw new Error('GPU lost');
      return new Float32Array(24000);
    },
  };
  return engine;
}

const fakeWriter = async (resume?: { blob: Blob; samples: number }): Promise<Mp3Writer> => {
  let sec = resume ? resume.samples / 24000 : 0;
  return {
    push: (pcm) => void (sec += pcm.length / 24000),
    silence: (s) => void (sec += s),
    get durationSec() {
      return sec;
    },
    checkpoint: () => ({ blob: new Blob([`mp3:${sec.toFixed(2)}`]), samples: Math.round(sec * 24000) }),
    finish: () => new Blob([`mp3:${sec.toFixed(2)}`], { type: 'audio/mpeg' }),
  };
};

async function setup() {
  const drive = new FakeDrive();
  const { storage } = makeStorage(drive);
  await storage.write('Inbox/week3.md', GUIDE);
  const { itemPath } = await importMarkdown(storage, 'Inbox/week3.md');
  return { drive, storage, itemPath };
}

function deps(storage: Storage, engine: TtsEngine, pending = memoryPending()): GenerateDeps {
  return { storage, engine, createWriter: fakeWriter, pending, deviceName: 'test' };
}

describe('importMarkdown', () => {
  it('creates the item folder, chapter text and item.json, and moves the source out of the Inbox', async () => {
    const { drive, storage, itemPath } = await setup();
    expect(itemPath).toBe('Library/ECON 1000/Week 3');
    const item = await readJson<Item>(storage, `${itemPath}/item.json`);
    expect(item.voice).toBe('am_michael');
    expect(item.chapters.map((c) => [c.n, c.title, c.textFile, c.status])).toEqual([
      [1, 'One', 'text/01.md', 'pending'],
      [2, 'Two', 'text/02.md', 'pending'],
      [3, 'Three', 'text/03.md', 'pending'],
    ]);
    expect(drive.find('Noteable/Library/ECON 1000/Week 3/sources/week3.md')).toHaveLength(1);
    expect(drive.find('Noteable/Inbox/week3.md')).toHaveLength(0);
  });

  it('names a second import with the same title "(2)"', async () => {
    const { storage } = await setup();
    await storage.write('Inbox/again.md', GUIDE);
    const { itemPath } = await importMarkdown(storage, 'Inbox/again.md');
    expect(itemPath).toBe('Library/ECON 1000/Week 3 (2)');
  });
});

describe('generateItem', () => {
  it('generates and uploads one MP3 per chapter and marks the item ready', async () => {
    const { drive, storage, itemPath } = await setup();
    const result = await generateItem(itemPath, 'am_michael', deps(storage, fakeEngine()));
    expect(result.uploaded).toBe(true);
    for (const n of ['01', '02', '03']) expect(drive.find(`Noteable/${itemPath}/audio/${n}.mp3`)).toHaveLength(1);
    const item = await readJson<Item>(storage, `${itemPath}/item.json`);
    expect(item.status).toBe('ready');
    expect(item.chapters.every((c) => c.status === 'done' && c.durationSec! > 0)).toBe(true);
  });

  it('resumes after an interruption without regenerating finished chapters', async () => {
    const { storage, itemPath } = await setup();
    // Each chapter is 2 calls (heading + text); fail during chapter 2.
    const first = fakeEngine(4);
    await expect(generateItem(itemPath, 'am_michael', deps(storage, first))).rejects.toThrow('GPU lost');
    let item = await readJson<Item>(storage, `${itemPath}/item.json`);
    expect(item.chapters.map((c) => c.status)).toEqual(['done', 'pending', 'pending']);
    expect(item.status).toBe('draft');

    const second = fakeEngine();
    await generateItem(itemPath, 'am_michael', deps(storage, second));
    expect(second.calls()).toBe(4); // chapters 2 and 3 only
    item = await readJson<Item>(storage, `${itemPath}/item.json`);
    expect(item.status).toBe('ready');
  });

  it('keeps audio on the device when uploads fail, then finishes uploading later', async () => {
    const { drive, storage, itemPath } = await setup();
    const pending = memoryPending();
    let offline = false;
    const flaky: Storage = Object.create(storage);
    flaky.write = (path, data, mime) => (offline && path.endsWith('.mp3') ? Promise.reject(new Error('Tap Reconnect')) : storage.write(path, data, mime));

    const engine = fakeEngine();
    const gen = generateItem(itemPath, 'am_michael', {
      ...deps(flaky, engine, pending),
      onProgress: (p) => {
        if (p.phase === 'generating') offline = true; // sign-in lapses once generation starts
      },
    });
    const result = await gen;
    expect(result.uploaded).toBe(false);
    expect(pending.items.size).toBe(3);
    expect(drive.find(`Noteable/${itemPath}/audio/01.mp3`)).toHaveLength(0);

    offline = false;
    await finishUploads(itemPath, flaky, pending);
    expect(pending.items.size).toBe(0);
    const item = await readJson<Item>(storage, `${itemPath}/item.json`);
    expect(item.status).toBe('ready');
    expect(engine.calls()).toBe(6);
  });

  it('starts over when the voice changes', async () => {
    const { storage, itemPath } = await setup();
    await generateItem(itemPath, 'am_michael', deps(storage, fakeEngine()));
    const engine = fakeEngine();
    await generateItem(itemPath, 'bf_emma', deps(storage, engine));
    expect(engine.calls()).toBe(6);
    expect((await readJson<Item>(storage, `${itemPath}/item.json`)).voice).toBe('bf_emma');
  });

  it('stops when aborted and leaves the item resumable', async () => {
    const { storage, itemPath } = await setup();
    const ctrl = new AbortController();
    const engine = fakeEngine();
    const d = { ...deps(storage, engine), signal: ctrl.signal, onProgress: () => engine.calls() >= 2 && ctrl.abort() };
    await expect(generateItem(itemPath, 'am_michael', d)).rejects.toThrow('Stopped');
    const item = await readJson<Item>(storage, `${itemPath}/item.json`);
    expect(item.status).toBe('draft');
    expect(item.error).toBeUndefined();
  });
});

describe('mid-chapter checkpoints', () => {
  const LONG = `---\ntitle: Long\n---\n## Only\n${Array.from({ length: 40 }, (_, i) => `Paragraph ${i} has one sentence.`).join('\n\n')}\n`;

  it('resumes a killed chapter from its last checkpoint, not from the start', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.write('Inbox/long.md', LONG);
    const { itemPath } = await importMarkdown(storage, 'Inbox/long.md');
    const checkpoints = memoryCheckpoints();

    // 1 heading + 40 paragraphs = 41 calls of 1 s each; die on call 36.
    const first = fakeEngine(36);
    await expect(generateItem(itemPath, 'af_bella', { ...deps(storage, first), checkpoints })).rejects.toThrow('GPU lost');
    const cp = checkpoints.items.values().next().value!;
    expect(cp.step).toBeGreaterThan(20);

    const second = fakeEngine();
    await generateItem(itemPath, 'af_bella', { ...deps(storage, second), checkpoints });
    expect(second.calls()).toBeLessThan(41 - 25);
    expect(checkpoints.items.size).toBe(0);
    const item = await readJson<Item>(storage, `${itemPath}/item.json`);
    expect(item.status).toBe('ready');
    // Duration covers the whole chapter: 41 s of speech plus pauses.
    expect(item.chapters[0].durationSec).toBeGreaterThan(41);
  });

  it('ignores a checkpoint made with a different voice', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.write('Inbox/long.md', LONG);
    const { itemPath } = await importMarkdown(storage, 'Inbox/long.md');
    const checkpoints = memoryCheckpoints();
    await expect(generateItem(itemPath, 'af_bella', { ...deps(storage, fakeEngine(36)), checkpoints })).rejects.toThrow();
    const engine = fakeEngine();
    await generateItem(itemPath, 'bf_emma', { ...deps(storage, engine), checkpoints });
    expect(engine.calls()).toBe(41);
  });
});
