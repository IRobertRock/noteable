import { describe, expect, it } from 'vitest';
import { applyGuide, dismissGuide, newGuide } from '../src/import/guideInItem';
import { importMarkdown } from '../src/import/importMarkdown';
import type { Item } from '../src/model/item';
import { readJson, readText, writeJson } from '../src/storage/Storage';
import { FakeDrive, makeStorage } from './fakeDrive';

const GUIDE = `---
title: Week 3 study guide
mode: teach
voice: Michael
---
## Overview
What this covers.

## Review questions
**Q:** Up or down?

**A:** Up.
`;

async function itemWithAudio() {
  const drive = new FakeDrive();
  const { storage } = makeStorage(drive);
  await storage.write('Inbox/w.md', '## A\na\n\n## B\nb\n\n## C\nc\n');
  const { itemPath } = await importMarkdown(storage, 'Inbox/w.md');
  const item = await readJson<Item>(storage, `${itemPath}/item.json`);
  item.chapters = item.chapters.map((c) => ({ ...c, status: 'done', audioFile: `audio/0${c.n}.mp3`, durationSec: 5 }));
  for (const c of item.chapters) await storage.write(`${itemPath}/${c.audioFile}`, 'mp3');
  await writeJson(storage, `${itemPath}/item.json`, item);
  return { drive, storage, itemPath, item };
}

describe('guide.md dropped into an item folder', () => {
  it('is noticed, and switching makes a Teach item from its chapters with its voice', async () => {
    const { drive, storage, itemPath, item } = await itemWithAudio();
    expect(await newGuide(storage, itemPath, item)).toBeNull();
    await storage.write(`${itemPath}/guide.md`, GUIDE);
    const guide = await newGuide(storage, itemPath, item);
    expect(guide).not.toBeNull();

    const next = await applyGuide(storage, itemPath, item, guide!);
    expect(next.mode).toBe('teach');
    expect(next.voice).toBe('am_michael');
    expect(next.title).toBe('Week 3 study guide');
    expect(next.chapters.map((c) => [c.title, c.status])).toEqual([
      ['Overview', 'pending'],
      ['Review questions', 'pending'],
    ]);
    expect(await readText(storage, `${itemPath}/text/02.md`)).toContain('**Q:** Up or down?');
    // The third chapter's leftover text and audio are trashed.
    expect(drive.find(`Noteable/${itemPath}/text/03.md`)).toHaveLength(0);
    expect(drive.find(`Noteable/${itemPath}/audio/03.mp3`)).toHaveLength(0);
    expect(await newGuide(storage, itemPath, next)).toBeNull();
  });

  it('is offered again only when the guide changes after being dismissed', async () => {
    const { storage, itemPath, item } = await itemWithAudio();
    await storage.write(`${itemPath}/guide.md`, GUIDE);
    const kept = await dismissGuide(storage, itemPath, item, (await newGuide(storage, itemPath, item))!);
    expect(await newGuide(storage, itemPath, kept)).toBeNull();
    await storage.write(`${itemPath}/guide.md`, GUIDE + '\n## Recap\nDone.\n');
    expect(await newGuide(storage, itemPath, kept)).not.toBeNull();
  });
});
