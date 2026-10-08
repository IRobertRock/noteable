// End-to-end check of import → Kokoro worker → MP3 → upload, against an in-memory Drive.
import { createMp3Writer } from '../src/audio/mp3';
import { generateItem } from '../src/generate/generateItem';
import { memoryPending } from '../src/generate/pending';
import { importMarkdown } from '../src/import/importMarkdown';
import type { Item } from '../src/model/item';
import { readJson } from '../src/storage/Storage';
import { KokoroEngine } from '../src/tts/engine';
import { LibraryIndex } from '../src/library/libraryIndex';
import { Downloads } from '../src/offline/downloads';
import { Player } from '../src/player/player';
import { StateStore } from '../src/sync/state';
import { writeJson } from '../src/storage/Storage';
import { startJob } from '../src/generate/jobs';
import { enterSleepMode } from '../src/sleep/sleepScreen';
import { wakeLockHeld } from '../src/sleep/wakeLock';
import '../src/style.css';
import { FakeDrive, makeStorage } from '../test/fakeDrive';

const GUIDE = `---
title: Pipeline test
voice: Fable
mode: teach
---
## Overview
This short guide checks that Noteable can turn markdown into chaptered audio. It has three chapters.

## Key terms
- **Opportunity cost:** the value of the next best alternative given up.
- **Scarcity:** having less of something than people want.

## Review questions
**Q:** If your hourly wage rises, does the cost of a night off go up or down?

[pause 3s]

**A:** It goes up, because each hour off now means giving up more income.
`;

const log = (s: string) => ((document.getElementById('log') as HTMLPreElement).textContent += s + '\n');

document.getElementById('run')!.addEventListener('click', async () => {
  const drive = new FakeDrive();
  const { storage } = makeStorage(drive);
  await storage.write('Inbox/pipeline-test.md', GUIDE);
  const { itemPath, item: imported } = await importMarkdown(storage, 'Inbox/pipeline-test.md');
  log(`Imported ${itemPath}: ${imported.chapters.length} chapters, voice ${imported.voice}`);

  const t = performance.now();
  let lastPhase = '';
  const result = await generateItem(itemPath, imported.voice, {
    storage,
    engine: new KokoroEngine(),
    createWriter: createMp3Writer,
    pending: memoryPending(),
    deviceName: 'pipeline test',
    onProgress: (p) => {
      const line = `${p.phase}${p.chapter ? ` ch ${p.chapter}` : ''}${p.device ? ` (${p.device})` : ''}`;
      if (line !== lastPhase) log(`  ${line}`);
      lastPhase = line;
    },
  });
  log(`Generated in ${((performance.now() - t) / 1000).toFixed(1)} s at ${result.realTimeFactor.toFixed(1)}× real time; uploaded=${result.uploaded}`);

  const item = await readJson<Item>(storage, `${itemPath}/item.json`);
  log(`item.json status=${item.status}`);
  const players = document.getElementById('players')!;
  const summary: { n: number; title: string; durationSec?: number; bytes: number; decodedSec: number }[] = [];
  for (const c of item.chapters) {
    const blob = new Blob([await (await storage.read(`${itemPath}/${c.audioFile}`)).arrayBuffer()], { type: 'audio/mpeg' });
    const decoded = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
    summary.push({ n: c.n, title: c.title, durationSec: c.durationSec, bytes: blob.size, decodedSec: Math.round(decoded.duration * 100) / 100 });
    log(`  ${c.audioFile}: ${c.title}, ${c.durationSec} s recorded, ${decoded.duration.toFixed(2)} s decoded, ${(blob.size / 1024).toFixed(0)} KB`);
    const a = document.createElement('audio');
    a.controls = true;
    a.src = URL.createObjectURL(blob);
    players.append(Object.assign(document.createElement('div'), { textContent: c.title }), a);
  }
  // ---- Player check (phase 3) ----
  log('Player check…');
  await writeJson(storage, 'State/playback.json', { version: 1, items: {} });
  await writeJson(storage, 'State/bookmarks.json', { version: 1, bookmarks: [] });
  const mem = new Map<string, unknown>();
  const state = new StateStore(storage, 'pipeline', { get: async (k) => mem.get(k) as never, set: async (k, v) => void mem.set(k, v) });
  const index = new LibraryIndex(storage, { all: async () => [], replace: async () => {} });
  await index.refresh();
  const entry = index.byPath(itemPath)!;
  const player = new Player(new Downloads(storage), state, location.origin + '/noteable/pwa-512x512.png');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const checks: Record<string, unknown> = {};

  await player.open(entry);
  await wait(800);
  checks.playingAfterOpen = !player.audio.paused;
  checks.chapterAfterOpen = player.chapter;
  const md = navigator.mediaSession?.metadata;
  checks.mediaSession = md ? { title: md.title, artist: md.artist, album: md.album } : null;

  player.setSpeed(1.5);
  checks.rate = player.audio.playbackRate;

  player.skip(15);
  await wait(300);
  checks.afterSkipForwardChapter = player.chapter; // ch 1 is ~9 s, so +15 s moves to ch 2
  await wait(1500);
  checks.playingAfterSkip = !player.audio.paused;

  player.seekTo(Math.max(0, player.audio.duration - 0.6));
  await wait(2500);
  checks.autoAdvancedTo = player.chapter; // ended → next chapter
  checks.playingAfterAdvance = !player.audio.paused;

  await player.previousChapter();
  await wait(300);
  checks.afterPrevious = player.chapter;

  player.pause();
  await wait(500);
  const saved = (await readJson<{ items: Record<string, { chapter: number; positionSec: number; speed: number }> }>(storage, 'State/playback.json')).items[entry.item.id];
  checks.savedToDrive = saved;
  log(`  ${JSON.stringify(checks)}`);

  // ---- Sleep mode check (phase 4) ----
  log('Sleep mode check…');
  const sleep: Record<string, unknown> = {};
  const press = (type: string, x = 120, y = 300) =>
    document.querySelector('.sleep')?.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  const overlayUp = () => !!document.querySelector('.sleep:not(.waking)');

  // Job 1: finishes on its own → screen wakes.
  await storage.write('Inbox/sleep-a.md', GUIDE.replace('title: Pipeline test', 'title: Sleep A'));
  const a = await importMarkdown(storage, 'Inbox/sleep-a.md');
  const jobA = startJob(storage, a.itemPath, a.item.voice, a.item, 15);
  await wait(300);
  enterSleepMode();
  sleep.overlayShown = overlayUp();
  sleep.wakeLockHeld = wakeLockHeld();
  sleep.pageVisible = document.visibilityState;
  press('pointerdown');
  await wait(400);
  press('pointerup');
  sleep.shortTapIgnored = overlayUp();
  await wait(1500);
  sleep.label = document.querySelector('.sleep-label')?.textContent;
  await jobA;
  await wait(700);
  sleep.wokeWhenDone = !overlayUp();
  sleep.wakeLockReleased = !wakeLockHeld();

  // Job 2: wake early with a 1.5 s hold; the job keeps running.
  await storage.write('Inbox/sleep-b.md', GUIDE.replace('title: Pipeline test', 'title: Sleep B'));
  const b = await importMarkdown(storage, 'Inbox/sleep-b.md');
  const jobB = startJob(storage, b.itemPath, b.item.voice, b.item, 15);
  await wait(300);
  enterSleepMode();
  press('pointerdown');
  await wait(1700);
  sleep.holdWakes = !overlayUp();
  const { currentJob } = await import('../src/generate/jobs');
  sleep.jobStillRunningAfterWake = !!currentJob()?.running;
  await jobB;
  log(`  ${JSON.stringify(sleep)}`);

  // ---- Phase 8: skip silence + Up next ----
  log('Phase 8 check…');
  const p8: Record<string, unknown> = {};
  const { silenceMap } = await import('../src/player/skipSilence');
  // The review chapter (3) has a 3 s pause before its answer plus the automatic 5 s; neither may be skipped.
  const ch3 = await storage.read(`${itemPath}/${item.chapters[2].audioFile}`);
  const sil = await silenceMap(new Blob([await ch3.arrayBuffer()], { type: 'audio/mpeg' }));
  p8.silences = sil.map((x) => [Math.round(x.start * 10) / 10, Math.round(x.end * 10) / 10]);
  p8.longestSkippable = Math.max(0, ...sil.map((x) => x.end - x.start));

  const b = await storage.read(`Library/General/Sleep B/item.json`).then((x) => x.text()).then((t) => JSON.parse(t) as Item);
  await index.refresh();
  const entryA = index.byPath(itemPath)!;
  const entryB = index.byPath('Library/General/Sleep B')!;
  const player2 = new Player(new Downloads(storage), state, location.origin + '/noteable/pwa-512x512.png', (id) => index.byId(id));
  await state.setUpNext([b.id]);
  const lastA = entryA.item.chapters[entryA.item.chapters.length - 1];
  await player2.open(entryA, lastA.n, (lastA.durationSec ?? 2) - 1.2);
  await wait(4000);
  p8.upNextStarted = player2.entry?.item.id === entryB.item.id;
  p8.playingB = !player2.audio.paused;
  p8.upNextEmptied = state.upNext.items.length === 0;
  player2.pause();
  log(`  ${JSON.stringify(p8)}`);

  (window as unknown as { pipelineResult: unknown }).pipelineResult = { status: item.status, rtf: result.realTimeFactor, summary, checks, sleep, p8 };
});
