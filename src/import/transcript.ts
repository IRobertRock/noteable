// Lecture recordings → a Narrate item: where to cut ~10-minute sections (at the
// quietest moment near each mark), light clean-up of speech fillers, and
// paragraphs from Whisper's timed segments.

export const AUDIO_FILE = /\.(mp3|m4a|mp4|aac|wav|webm|ogg|oga|opus|flac)$/i;

export function isRecording(name: string, mimeType = ''): boolean {
  return AUDIO_FILE.test(name) || /^audio\//.test(mimeType);
}

export interface TimedSegment {
  text: string;
  start: number;
  end: number;
}

/**
 * Sample indexes where sections start (always including 0): one near every
 * `targetSec`, moved to the quietest `windowSec` within ±`searchSec`.
 */
export function sectionStarts(pcm: Float32Array, rate: number, targetSec = 600, searchSec = 30, windowSec = 0.5, minTailSec = targetSec / 3): number[] {
  const starts = [0];
  const total = pcm.length;
  const win = Math.max(1, Math.round(windowSec * rate));
  for (let mark = targetSec * rate; mark < total - minTailSec * rate; mark += targetSec * rate) {
    const from = Math.max(starts[starts.length - 1] + win, Math.round(mark - searchSec * rate));
    const to = Math.min(total - win, Math.round(mark + searchSec * rate));
    let best = Math.round(mark);
    let bestEnergy = Infinity;
    for (let s = from; s + win <= to; s += Math.round(win / 2)) {
      let e = 0;
      for (let i = s; i < s + win; i += 4) e += pcm[i] * pcm[i];
      if (e < bestEnergy) {
        bestEnergy = e;
        best = s + Math.round(win / 2);
      }
    }
    starts.push(best);
  }
  return starts;
}

const FILLERS = /(^|[\s,.;:!?])(?:u+m+|u+h+|e+r+m*|h+m+|m+h+m*)(?=[\s,.;:!?]|$)[,.]?/gi;

/** Removes "um", "uh", "erm", "hmm" and immediately repeated words ("the the"). */
export function cleanSpeech(text: string): string {
  let t = text.replace(FILLERS, '$1');
  // Repeated words, case-insensitive, keeping the first.
  t = t.replace(/\b(\w+)(?:[\s,]+\1\b)+/gi, '$1');
  return t
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?:\s*[,])+/g, '$1')
    .replace(/^\s*[,.]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const capitalise = (s: string) => s.replace(/^(\p{Ll})/u, (c) => c.toUpperCase());

/** Paragraphs from timed segments: break on a pause over `gapSec`, or at a sentence end after ~`maxChars`. */
export function paragraphs(segments: TimedSegment[], gapSec = 1.5, maxChars = 700): string[] {
  const out: string[] = [];
  let cur = '';
  let lastEnd = -Infinity;
  for (const seg of segments) {
    const text = cleanSpeech(seg.text);
    if (!text || /^[[(].*[\])]$/.test(text)) continue; // empty, or "[BLANK_AUDIO]" / "(music)": the silence counts as a pause
    const gap = seg.start - lastEnd;
    if (cur && (gap > gapSec || (cur.length > maxChars && /[.!?]["')]?$/.test(cur)))) {
      out.push(cur);
      cur = '';
    }
    // Whisper capitalises each piece; only a sentence start should be.
    const piece = cur && !/[.!?]["')]?$/.test(cur) && /^\p{Lu}\p{Ll}/u.test(text) && !/^I\b/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
    cur = cur ? `${cur} ${piece}` : capitalise(piece);
    lastEnd = seg.end;
  }
  if (cur) out.push(cur);
  return out;
}

export function clock(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Chapter title and markdown for one section. */
export function sectionChapter(index: number, startSec: number, endSec: number, segments: TimedSegment[]): { title: string; markdown: string } {
  const title = `Part ${index + 1} (${clock(startSec)}–${clock(endSec)})`;
  const body = paragraphs(segments);
  return { title, markdown: `## ${title}\n\n${body.length ? body.join('\n\n') : '_(No speech recognised in this part.)_'}\n` };
}

/** "Lecture 3.m4a" → "Lecture 3" */
export function recordingTitle(fileName: string): string {
  return fileName.replace(AUDIO_FILE, '').replace(/[_]+/g, ' ').trim() || 'Recording';
}
