import { describe, expect, it } from 'vitest';
import type { Mp3Writer } from '../src/audio/mp3';
import { buildAuthUrl, parseRedirectHash } from '../src/auth/redirect';
import { memoryCheckpoints, memoryPending } from '../src/generate/pending';
import { importMarkdown } from '../src/import/importMarkdown';
import { cleanSpeech, isRecording, paragraphs, recordingTitle, sectionChapter, sectionStarts } from '../src/import/transcript';
import type { IndexedItem } from '../src/library/libraryIndex';
import type { Item } from '../src/model/item';
import { itemsToSend, jobName, listJobs, markChapterForRegenerating, sendCollection, sendRecording } from '../src/queue/jobs';
import { setWorkerPaused, WORKER_CONTROL_PATH, type WorkerStatus } from '../src/queue/workerStatus';
import { readJson, type Job } from '../src/storage/Storage';
import type { TtsEngine } from '../src/tts/engine';
import { badAudio } from '../worker/gpuEngine';
import { KeepAwake } from '../worker/keepAwake';
import { QueueWorker } from '../worker/queue';
import { applyControl, writeStatus } from '../worker/status';
import { downsample24to16, transcribeRecording } from '../worker/transcribe';
import { FakeDrive, makeStorage } from './fakeDrive';

const writer = async (): Promise<Mp3Writer> => {
  let sec = 0;
  return {
    push: (p) => void (sec += p.length / 24000),
    silence: (s) => void (sec += s),
    get durationSec() {
      return sec;
    },
    checkpoint: () => ({ blob: new Blob(['x']), samples: sec * 24000 }),
    finish: () => new Blob([`mp3 ${sec.toFixed(1)}`], { type: 'audio/mpeg' }),
  };
};

const engine: TtsEngine = { load: async () => ({ device: 'cpu', dtype: 'fp32' }), generate: async () => new Float32Array(24000) };

async function library() {
  const drive = new FakeDrive();
  const { storage } = makeStorage(drive);
  const make = async (name: string, title: string) => {
    await storage.write(`Inbox/${name}.md`, `---\ntitle: ${title}\ncollection: ECON\n---\n## One\nFirst.\n\n## Two\nSecond.\n`);
    const { itemPath, item } = await importMarkdown(storage, `Inbox/${name}.md`);
    return { path: itemPath, item } as IndexedItem;
  };
  const a = await make('a', 'Week 1');
  const b = await make('b', 'Week 2');
  const c = await make('c', 'Week 3');
  return { drive, storage, a, b, c };
}

function worker(storage: ReturnType<typeof makeStorage>['storage'], extra: Partial<ConstructorParameters<typeof QueueWorker>[0]> = {}) {
  return new QueueWorker({ storage, engine, createWriter: writer, pending: memoryPending(), checkpoints: memoryCheckpoints(), workerName: 'desk', heartbeatMs: 5, ...extra });
}

describe('send a whole course', () => {
  it('queues items that need audio, oldest first, skipping queued, finished and review items', async () => {
    const { storage, a, b, c } = await library();
    b.item.chapters.forEach((x) => (x.status = 'done'));
    const review = { ...c, path: 'Library/ECON/Review', item: { ...c.item, review: true } };
    await sendRecording(storage, 'Inbox/lecture.m4a'); // other job types don't count
    await storage.enqueue({ itemPath: c.path, chapters: [1, 2], voice: c.item.voice });
    expect(itemsToSend([c, b, a, review], await listJobs(storage)).map((x) => x.item.title)).toEqual(['Week 1']);
    expect(await sendCollection(storage, [a, b, c])).toBe(1);
    expect(await sendCollection(storage, [a, b, c])).toBe(0);
    const jobs = await listJobs(storage);
    expect(jobs.find((j) => j.itemPath === a.path)).toMatchObject({ chapters: [1, 2], voice: a.item.voice });
  });
});

describe('regenerate one chapter', () => {
  it('marks just that chapter, and generation then redoes only it', async () => {
    const { storage, a } = await library();
    let calls = 0;
    const counting: TtsEngine = { load: engine.load, generate: async () => (calls++, new Float32Array(24000)) };
    await storage.enqueue({ itemPath: a.path, chapters: [1, 2], voice: a.item.voice });
    await worker(storage, { engine: counting }).tick();
    const fullItemCalls = calls;
    const before = await readJson<Item>(storage, `${a.path}/item.json`);
    expect(before.chapters.map((c) => c.status)).toEqual(['done', 'done']);

    const marked = await markChapterForRegenerating(storage, a.path, 2);
    expect(marked.chapters.map((c) => c.status)).toEqual(['done', 'pending']);
    expect(marked.chapters[1].audioFile).toBeDefined(); // old audio stays until replaced

    calls = 0;
    await storage.enqueue({ itemPath: a.path, chapters: [2], voice: a.item.voice });
    await worker(storage, { engine: counting }).tick();
    expect(calls).toBe(fullItemCalls / 2); // the two chapters are the same size
    const after = await readJson<Item>(storage, `${a.path}/item.json`);
    expect(after.chapters.map((c) => c.status)).toEqual(['done', 'done']);
    expect(after.status).toBe('ready');
  });
});

describe('keep the PC awake', () => {
  it('starts one helper while working and stops it after', () => {
    const kills: number[] = [];
    let spawned = 0;
    const handlers: Record<string, () => void> = {};
    const k = new KeepAwake(() => {
      const id = ++spawned;
      return { kill: () => (kills.push(id), true), on: (ev: string, fn: () => void) => ((handlers[ev] = fn), undefined) } as never;
    });
    k.start();
    k.start();
    expect(spawned).toBe(1);
    expect(k.active).toBe(true);
    k.stop();
    expect(kills).toEqual([1]);
    expect(k.active).toBe(false);
    k.stop();
    expect(kills).toEqual([1]);
    // If the helper dies on its own, the next job starts a new one.
    k.start();
    handlers.exit();
    expect(k.active).toBe(false);
    k.start();
    expect(spawned).toBe(3);
  });
});

describe('GPU output check', () => {
  it('accepts speech-like audio and rejects garbage', () => {
    const speech = new Float32Array(48000).map((_, i) => 0.2 * Math.sin(i / 7));
    expect(badAudio(speech)).toBeNull();
    expect(badAudio(new Float32Array(48000).fill(5e14))).toMatch(/out of range/);
    expect(badAudio(new Float32Array([0.1, Number.NaN]))).toMatch(/non-finite/);
    expect(badAudio(new Float32Array(48000))).toMatch(/near-silent/);
    expect(badAudio(new Float32Array(0))).toBe('no samples');
  });
});

describe('worker dashboard and pause from the phone', () => {
  it('records recent jobs in the status note', async () => {
    const { storage, a } = await library();
    const w = worker(storage);
    await storage.enqueue({ itemPath: a.path, chapters: [1, 2], voice: a.item.voice });
    await w.tick();
    await writeStatus(storage, 'desk', w, true, { engine: 'CPU', keepingAwake: false });
    const s = await readJson<WorkerStatus>(storage, 'State/worker.json');
    expect(s.engine).toBe('CPU');
    expect(s.recent).toHaveLength(1);
    expect(s.recent![0]).toMatchObject({ item: 'Week 1', chapters: 2, result: 'done' });
    expect(s.keepingAwake).toBeUndefined();
  });

  it('applies each pause or resume once, and ignores an old pause at start-up', async () => {
    const { storage } = await library();
    const w = worker(storage);
    const applied: { at?: string } = {};
    expect(await applyControl(storage, w, applied)).toBe(false); // no file
    await setWorkerPaused(storage, true);
    expect(await applyControl(storage, w, applied)).toBe(true);
    expect(w.paused).toBe(true);
    expect(await applyControl(storage, w, applied)).toBe(false); // same request
    w.paused = false; // resumed from the tray
    expect(await applyControl(storage, w, applied)).toBe(false); // the old pause isn't re-applied
    await new Promise((r) => setTimeout(r, 5));
    await setWorkerPaused(storage, false);
    expect(await applyControl(storage, w, applied)).toBe(false); // already running
    await storage.write(WORKER_CONTROL_PATH, JSON.stringify({ paused: true, updatedAt: '2020-01-01T00:00:00Z' }));
    const fresh: { at?: string } = {};
    expect(await applyControl(storage, w, fresh)).toBe(false); // stale pause on start-up
  });
});

describe('recordings → text', () => {
  it('recognises audio files and names the item', () => {
    expect(isRecording('Lecture 3.m4a')).toBe(true);
    expect(isRecording('voice', 'audio/webm')).toBe(true);
    expect(isRecording('notes.pdf')).toBe(false);
    expect(recordingTitle('ECON_lecture_3.mp3')).toBe('ECON lecture 3');
  });

  it('cleans fillers and repeated words', () => {
    expect(cleanSpeech('Um, so the the cost, uh, is is high. Hmm.')).toBe('so the cost, is high.');
    expect(cleanSpeech('umbrella and humbug stay')).toBe('umbrella and humbug stay');
  });

  it('makes paragraphs on pauses and drops non-speech tags', () => {
    const p = paragraphs([
      { text: 'First idea.', start: 0, end: 2 },
      { text: 'Same paragraph.', start: 2.3, end: 4 },
      { text: '[BLANK_AUDIO]', start: 4, end: 9 },
      { text: 'After a pause.', start: 9, end: 11 },
    ]);
    expect(p).toEqual(['First idea. Same paragraph.', 'After a pause.']);
    // Whisper's per-piece capitals are dropped mid-sentence, kept after a full stop and for "I".
    expect(paragraphs([
      { text: 'so we start', start: 0, end: 1 },
      { text: 'With costs, and', start: 1, end: 2 },
      { text: 'I think. Then', start: 2, end: 3 },
      { text: 'More.', start: 3, end: 4 },
    ])).toEqual(['So we start with costs, and I think. Then more.']);
  });

  it('cuts sections at the quietest moment near each 10-minute mark', () => {
    const rate = 100; // tiny rate keeps the test fast
    const pcm = new Float32Array(25 * 60 * rate).fill(0.5);
    pcm.fill(0, 610 * rate, 611 * rate); // a pause 10 s after the mark
    const starts = sectionStarts(pcm, rate);
    expect(starts).toHaveLength(3);
    expect(starts[1] / rate).toBeGreaterThanOrEqual(610);
    expect(starts[1] / rate).toBeLessThanOrEqual(611);
    // A short tail joins the last part instead of making a tiny one.
    expect(sectionStarts(new Float32Array(22 * 60 * rate).fill(0.5), rate)).toHaveLength(2);
  });

  it('section chapters have a timed title', () => {
    const c = sectionChapter(1, 600, 1205, [{ text: 'Hello there.', start: 600, end: 602 }]);
    expect(c.title).toBe('Part 2 (10:00–20:05)');
    expect(c.markdown).toBe('## Part 2 (10:00–20:05)\n\nHello there.\n');
  });

  it('downsamples 24 kHz to 16 kHz', () => {
    expect(downsample24to16(new Float32Array(24000)).length).toBe(16000);
  });

  it('a transcribe job turns an Inbox recording into a playable item, moving the recording last', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.write('Inbox/Lecture 3.m4a', new Blob(['fake audio']), 'audio/mp4');
    const id = await sendRecording(storage, 'Inbox/Lecture 3.m4a');
    const pcm24 = new Float32Array(24000 * 60 * 14).fill(0.3); // 14 minutes
    pcm24.fill(0, 24000 * 600, 24000 * 601);
    const asrCalls: number[] = [];
    const w = worker(storage, {
      transcribe: (job, onDetail) =>
        transcribeRecording(job, {
          storage,
          decode: async () => pcm24,
          asr: async (pcm) => {
            asrCalls.push(Math.round(pcm.length / 16000));
            return [{ text: 'Um, today we talk about about costs.', start: 1, end: 4 }];
          },
          createWriter: writer,
          voice: 'af_bella',
          onDetail,
        }),
    });
    expect(await w.tick()).toBe(id);
    const job = await readJson<Job>(storage, `Queue/${id}.json`);
    expect(job.status).toBe('done');
    expect(job.itemPath).toBe('Library/General/Lecture 3');
    expect(jobName(job)).toBe('Lecture 3');
    expect(asrCalls).toEqual([600, 240]);

    const item = await readJson<Item>(storage, `${job.itemPath}/item.json`);
    expect(item).toMatchObject({ title: 'Lecture 3', mode: 'narrate', status: 'ready', sources: ['Lecture 3.m4a'], recording: { file: 'Lecture 3.m4a', durationSec: 840 } });
    expect(item.chapters.map((c) => c.status)).toEqual(['done', 'done']);
    expect(item.chapters.map((c) => c.title)).toEqual([expect.stringMatching(/^Part 1 \(0:00–10:0[01]\)$/), expect.stringMatching(/^Part 2 \(10:0[01]–14:00\)$/)]);
    expect(item.chapters[0].durationSec).toBeCloseTo(600.5, 0);
    expect(item.chapters[0].durationSec! + item.chapters[1].durationSec!).toBeCloseTo(840, 0);
    expect(await (await storage.read(`${job.itemPath}/text/02.md`)).text()).toContain('Today we talk about costs.');
    expect(await storage.stat('Inbox/Lecture 3.m4a')).toBeNull();
    expect(await storage.stat(`${job.itemPath}/sources/Lecture 3.m4a`)).not.toBeNull();
  });

  it('a failed transcription leaves the recording in the Inbox', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    await storage.write('Inbox/bad.mp3', new Blob(['x']), 'audio/mpeg');
    const id = await sendRecording(storage, 'Inbox/bad.mp3');
    const w = worker(storage, {
      transcribe: (job) => transcribeRecording(job, { storage, decode: async () => new Float32Array(10), asr: async () => [], createWriter: writer, voice: 'af_bella' }),
    });
    await w.tick();
    expect((await readJson<Job>(storage, `Queue/${id}.json`)).status).toBe('failed');
    expect(w.lastError).toMatch(/empty or could not be decoded/);
    expect(await storage.stat('Inbox/bad.mp3')).not.toBeNull();
    expect(jobName(await readJson<Job>(storage, `Queue/${id}.json`))).toBe('🎙 bad.mp3');
  });
});

describe('full-page sign-in', () => {
  it('builds the Google URL and reads the reply', () => {
    const url = new URL(buildAuthUrl({ clientId: 'cid', scope: 'a b', redirectUri: 'https://x.test/noteable/', state: 's1', loginHint: 'rob@example.com' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: 'cid', redirect_uri: 'https://x.test/noteable/', response_type: 'token', scope: 'a b', state: 's1', login_hint: 'rob@example.com' });
    expect(parseRedirectHash('#/library')).toBeNull();
    expect(parseRedirectHash('#access_token=tok&expires_in=3599&scope=a%20b&state=s1&token_type=Bearer')).toEqual({ accessToken: 'tok', expiresIn: 3599, scope: 'a b', state: 's1', error: undefined });
    expect(parseRedirectHash('#error=access_denied&state=s1')).toMatchObject({ error: 'access_denied' });
  });
});
