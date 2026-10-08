import { describe, expect, it } from 'vitest';
import { aboutMinutes, estimate, median, recordRun, type EstimateKv } from '../src/generate/estimate';
import type { Item } from '../src/model/item';

function kv(): EstimateKv {
  const m = new Map<string, unknown>();
  return { get: async <T,>(k: string) => m.get(k) as T | undefined, set: async (k, v) => void m.set(k, v) };
}

function item(chapters: { chars: number; done?: boolean; durationSec?: number }[]): Item {
  return {
    schema: 1,
    id: 'x',
    title: 't',
    collection: 'General',
    mode: 'narrate',
    voice: 'af_bella',
    sources: [],
    status: 'draft',
    createdAt: '',
    updatedAt: '',
    chapters: chapters.map((c, i) => ({ n: i + 1, title: `c${i}`, textFile: '', chars: c.chars, status: c.done ? 'done' : 'pending', durationSec: c.durationSec })),
  };
}

describe('estimate', () => {
  it('uses 15 characters per second and no device speed before the first run', async () => {
    const e = await estimate(item([{ chars: 9000 }, { chars: 9000 }]), kv());
    expect(e.audioSec).toBe(1200);
    expect(e.generateSec).toBeUndefined();
  });

  it('learns this device speed (median of last 5) and the speaking rate', async () => {
    const store = kv();
    for (const rtf of [1.1, 1.5, 1.4, 9, 1.3, 1.45]) await recordRun(item([]), rtf, store);
    const finished = item([{ chars: 3000, done: true, durationSec: 150 }]); // 20 chars/s
    await recordRun(finished, 0, store);
    const e = await estimate(item([{ chars: 17500 }]), store);
    expect(e.realTimeFactor).toBe(1.45); // 1.5, 1.4, 9, 1.3, 1.45 → median 1.45
    expect(e.charsPerSec).toBe(17.5); // halfway from 15 to 20
    expect(e.audioSec).toBe(1000);
    expect(Math.round(e.generateSec!)).toBe(690);
  });

  it('only counts chapters still to generate', async () => {
    const e = await estimate(item([{ chars: 9000, done: true }, { chars: 900 }]), kv());
    expect(e.audioSec).toBe(60);
  });

  it('formats durations for people', () => {
    expect([20, 60, 14 * 60 + 40, 80 * 60, 120 * 60].map(aboutMinutes)).toEqual(['under a minute', 'about 1 min', 'about 15 min', 'about 1 h 20 min', 'about 2 h']);
    expect(median([3, 1, 2, 10])).toBe(2.5);
  });
});
