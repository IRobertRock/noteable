// Say your answer (Quiz me): listen once with the browser's speech recognition,
// then score by key-word overlap with the written answer. On Android Chrome the
// recognition runs on Google's servers, so it is off unless turned on.

import { tokenize } from '../search/searchIndex';

export type AnswerScore = 'right' | 'close' | 'missed';

/** Very light stemming so "costs" matches "cost" and "choosing" matches "choose". */
export function stem(w: string): string {
  return w
    .replace(/(ies)$/, 'y')
    .replace(/(ing|ed|es|s)$/, '')
    .replace(/e$/, '');
}

export function keyWords(text: string): string[] {
  return [...new Set(tokenize(text).filter((w) => w.length > 2 || /\d/.test(w)).map(stem))];
}

export function scoreAnswer(said: string, expected: string): { score: AnswerScore; matched: number; of: number } {
  const want = keyWords(expected);
  const got = new Set(keyWords(said));
  if (!want.length) return { score: got.size ? 'close' : 'missed', matched: 0, of: 0 };
  const matched = want.filter((w) => got.has(w)).length;
  const share = matched / want.length;
  return { score: share >= 0.6 ? 'right' : share >= 0.3 ? 'close' : 'missed', matched, of: want.length };
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => Recognition;

export function speechSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** Listens for one answer; resolves with what was heard ('' for silence or a timeout). */
export function listenOnce(timeoutMs = 9000, lang = 'en-US'): Promise<string> {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return Promise.reject(new Error('Speech recognition is not available in this browser.'));
  return new Promise((resolve, reject) => {
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let heard = '';
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(heard.trim());
    };
    const timer = setTimeout(() => {
      try {
        rec.stop();
      } catch {
        // already stopped
      }
      setTimeout(() => done(), 600);
    }, timeoutMs);
    rec.onresult = (e) => {
      heard = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? '')
        .join(' ');
    };
    rec.onerror = (e) => (e.error === 'no-speech' || e.error === 'aborted' ? done() : done(new Error(e.error === 'not-allowed' ? 'Microphone permission was refused.' : `Speech recognition: ${e.error}`)));
    rec.onend = () => done();
    rec.start();
  });
}
