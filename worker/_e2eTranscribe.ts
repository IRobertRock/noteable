import { createMp3Writer } from '../src/audio/mp3';
import { readJson, type Job } from '../src/storage/Storage';
import type { Item } from '../src/model/item';
import { FakeDrive, makeStorage } from '../test/fakeDrive';
import { NodeKokoroEngine } from './engine';
import { LECTURE, wer, words } from './spikeText';
import { chromeDecode, NodeWhisper, transcribeRecording } from './transcribe';

const k = new NodeKokoroEngine();
await k.load();
const w = await createMp3Writer();
for (const para of LECTURE.split(/\n\s*\n/)) { w.push(await k.generate(para.trim(), 'af_bella')); w.silence(0.8); }
const mp3 = w.finish();
console.log(`MP3 ${(mp3.size / 1024).toFixed(0)} KB, ${w.durationSec.toFixed(0)} s`);
const { storage } = makeStorage(new FakeDrive());
await storage.write('Inbox/Lecture test.mp3', mp3, 'audio/mpeg');
const job = { id: 'j', kind: 'transcribe', source: 'Inbox/Lecture test.mp3', itemPath: '', chapters: [], voice: '', status: 'working', createdAt: '', updatedAt: '' } as Job;
const whisper = new NodeWhisper();
const t0 = performance.now();
const r = await transcribeRecording(job, { storage, decode: chromeDecode, asr: whisper.transcribe, createWriter: createMp3Writer, voice: 'af_bella', onDetail: (d) => console.log('  ', d) });
console.log(`Done in ${((performance.now() - t0) / 1000).toFixed(1)} s → ${r.itemPath} at ${r.realTimeFactor.toFixed(1)}x`);
const item = await readJson<Item>(storage, `${r.itemPath}/item.json`);
console.log(JSON.stringify(item.chapters.map((c) => [c.title, c.durationSec, c.status])));
const text = await (await storage.read(`${r.itemPath}/text/01.md`)).text();
console.log(`WER ${(wer(words(LECTURE), words(text.replace(/^##.*$/m, ''))) * 100).toFixed(1)}%`);
console.log(text.slice(0, 700));
const audio = await storage.read(`${r.itemPath}/audio/01.mp3`);
console.log(`audio part 1: ${(audio.size / 1024).toFixed(0)} KB`);
