import { describe, expect, it } from 'vitest';
import { chapterProgress, continueListening } from '../src/library/continue';
import type { IndexedItem } from '../src/library/libraryIndex';
import type { Item } from '../src/model/item';
import { findSilences, skipTarget } from '../src/player/skipSilence';
import { describeWorker, isOnline, type WorkerStatus } from '../src/queue/workerStatus';
import { mergePlayback, mergeUpNext, type PlaybackDoc, type PlaybackEntry } from '../src/sync/state';

const item = (id: string, durations: number[]): IndexedItem => ({
  path: `Library/General/${id}`,
  item: {
    schema: 1,
    id,
    title: id,
    collection: 'General',
    mode: 'narrate',
    voice: 'af_bella',
    sources: [],
    status: 'ready',
    createdAt: '',
    updatedAt: '',
    chapters: durations.map((d, i) => ({ n: i + 1, title: `c${i + 1}`, textFile: '', chars: 1, status: 'done', durationSec: d })),
  } as Item,
});

const entry = (chapter: number, positionSec: number, updatedAt: string, heard?: Record<string, number>): PlaybackEntry => ({ chapter, positionSec, speed: 1, updatedAt, device: 'x', heard });

describe('continue listening', () => {
  it('lists started, unfinished items, most recent first, at most 3', () => {
    const items = [item('a', [100, 100]), item('b', [100]), item('c', [100]), item('d', [100]), item('e', [100])];
    const pb: PlaybackDoc = {
      version: 1,
      items: {
        a: entry(2, 10, '2026-10-08T10:00:00Z'),
        b: entry(1, 95, '2026-10-08T11:00:00Z'), // finished (within 30 s of the end)
        c: entry(1, 40, '2026-10-08T09:00:00Z'),
        d: entry(1, 2, '2026-10-08T12:00:00Z'), // barely started
        e: entry(1, 50, '2026-10-08T08:00:00Z'),
      },
    };
    expect(continueListening(items, pb).map((x) => x.item.id)).toEqual(['a', 'c', 'e']);
  });

  it('shows per-chapter progress from the furthest point heard', () => {
    const it2 = item('a', [100, 100, 100]).item;
    const e = entry(2, 30, 't', { 1: 99, 2: 30 });
    expect(it2.chapters.map((c) => chapterProgress(e, c))).toEqual(['done', 'part', 'none']);
    // Older entries without "heard": chapters before the current one count as done.
    expect(it2.chapters.map((c) => chapterProgress(entry(2, 30, 't'), c))).toEqual(['done', 'part', 'none']);
  });

  it('merges "heard" as the max from both devices', () => {
    const a: PlaybackDoc = { version: 1, items: { x: entry(1, 50, '2026-10-08T10:00:00Z', { 1: 50, 2: 80 }) } };
    const b: PlaybackDoc = { version: 1, items: { x: entry(2, 10, '2026-10-08T11:00:00Z', { 1: 90, 2: 10 }) } };
    const m = mergePlayback(a, b).items.x;
    expect([m.chapter, m.positionSec]).toEqual([2, 10]);
    expect(m.heard).toEqual({ 1: 90, 2: 80 });
  });

  it('Up next: the latest list wins', () => {
    expect(mergeUpNext({ version: 1, items: ['a'], updatedAt: '2026-10-08T10:00:00Z' }, { version: 1, items: ['b', 'c'], updatedAt: '2026-10-08T11:00:00Z' }).items).toEqual(['b', 'c']);
  });
});

describe('skip silence', () => {
  const rate = 8000;
  const tone = (sec: number) => Float32Array.from({ length: sec * rate }, (_, i) => 0.3 * Math.sin(i / 3));
  const silence = (sec: number) => new Float32Array(sec * rate);
  const concat = (...parts: Float32Array[]) => {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) out.set(p, (o += p.length) - p.length);
    return out;
  };

  it('finds short dead air but leaves review pauses and tiny gaps alone', () => {
    const pcm = concat(tone(2), silence(1), tone(2), silence(5), tone(2), silence(0.3 as number), tone(1));
    const s = findSilences(pcm, rate);
    expect(s).toHaveLength(1);
    expect(s[0].start).toBeCloseTo(2, 1);
    expect(s[0].end).toBeCloseTo(3, 1);
  });

  it('jumps to just before the speech resumes', () => {
    const s = [{ start: 2, end: 3 }];
    expect(skipTarget(s, 2.1)).toBeCloseTo(2.8);
    expect(skipTarget(s, 1.5)).toBeNull();
    expect(skipTarget(s, 2.9)).toBeNull();
  });
});

describe('desktop online status', () => {
  const base: WorkerStatus = { name: 'desktop', lastSeen: '2026-10-08T12:00:00Z', version: '0.1.0', paused: false, signedIn: true, busy: false };
  const t = Date.parse('2026-10-08T12:01:00Z');
  it('is online when seen in the last 3 minutes, signed in and not paused', () => {
    expect(isOnline(base, t)).toBe(true);
    expect(describeWorker(base, t)).toBe('Desktop online · seen 60 s ago');
    expect(isOnline(base, t + 5 * 60_000)).toBe(false);
    expect(describeWorker(base, t + 2 * 3600_000)).toBe('Desktop offline · last seen 2 h ago');
    expect(isOnline({ ...base, paused: true }, t)).toBe(false);
    expect(isOnline(null, t)).toBe(false);
  });
});
