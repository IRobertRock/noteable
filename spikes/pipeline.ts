// End-to-end check of import → Kokoro worker → MP3 → upload, against an in-memory Drive.
import { createMp3Writer } from '../src/audio/mp3';
import { generateItem } from '../src/generate/generateItem';
import { memoryPending } from '../src/generate/pending';
import { importMarkdown } from '../src/import/importMarkdown';
import type { Item } from '../src/model/item';
import { readJson } from '../src/storage/Storage';
import { KokoroEngine } from '../src/tts/engine';
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
  (window as unknown as { pipelineResult: unknown }).pipelineResult = { status: item.status, rtf: result.realTimeFactor, summary };
});
