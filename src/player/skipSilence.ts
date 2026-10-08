// Skip silence: shortens dead air while listening at 1.25× or faster.
//
// Rather than routing playback through Web Audio (which can stop background
// playback on some Android builds), each chapter is decoded once at a low sample
// rate to find its silent stretches, and the player jumps over them on
// timeupdate. Review-question pauses (~5 s) are deliberately left alone.

export interface Silence {
  start: number;
  end: number;
}

export const MIN_SKIP_SEC = 0.7;
/** Longer silences are intentional (review-question pauses); never skip them. */
export const KEEP_OVER_SEC = 2.5; // [pause Ns] markers (2 s+) and answer pauses are intentional
/** Leave this much of each silence so speech doesn't run together. */
export const KEEP_SEC = 0.2;
export const SKIP_FROM_SPEED = 1.25;

const ANALYSIS_RATE = 8000;
const WINDOW_SEC = 0.05;
const THRESHOLD = 0.01; // RMS; Kokoro's silence is near-digital-zero

/** Finds silent stretches worth skipping in mono PCM. Pure, for tests. */
export function findSilences(samples: Float32Array, sampleRate: number): Silence[] {
  const win = Math.max(1, Math.round(sampleRate * WINDOW_SEC));
  const out: Silence[] = [];
  let runStart = -1;
  for (let i = 0; i < samples.length; i += win) {
    let sum = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    const quiet = Math.sqrt(sum / (end - i)) < THRESHOLD;
    if (quiet && runStart < 0) runStart = i;
    if ((!quiet || end === samples.length) && runStart >= 0) {
      const stop = quiet ? end : i;
      const len = (stop - runStart) / sampleRate;
      if (len >= MIN_SKIP_SEC && len <= KEEP_OVER_SEC) out.push({ start: runStart / sampleRate, end: stop / sampleRate });
      runStart = -1;
    }
  }
  return out;
}

/** Where to jump to, if `time` is inside a skippable silence. */
export function skipTarget(silences: Silence[], time: number): number | null {
  for (const s of silences) {
    if (time >= s.start && time < s.end - KEEP_SEC - 0.05) return s.end - KEEP_SEC;
    if (s.start > time) break;
  }
  return null;
}

/** Decodes an MP3 at 8 kHz (small enough for long chapters on a phone) and finds its silences. */
export async function silenceMap(blob: Blob): Promise<Silence[]> {
  const ctx = new OfflineAudioContext(1, 1, ANALYSIS_RATE);
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  return findSilences(audio.getChannelData(0), audio.sampleRate);
}
