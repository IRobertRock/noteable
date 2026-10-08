// Streaming 64 kbps mono MP3 encoder (LAME in WASM). Audio is encoded as it is
// generated, so a long chapter is never held in memory as raw PCM.

import { createMp3Encoder } from 'wasm-media-encoders';
import { SAMPLE_RATE } from '../tts/engine';

export interface Mp3Writer {
  push(pcm: Float32Array): void;
  silence(seconds: number): void;
  readonly durationSec: number;
  /** The MP3 frames written so far, for a mid-chapter checkpoint. */
  checkpoint(): Mp3Checkpoint;
  finish(): Blob;
}

export interface Mp3Checkpoint {
  blob: Blob;
  samples: number;
}

/**
 * `resume` continues a chapter from a checkpoint. Constant-bitrate MP3 frames can be
 * concatenated, so a new encoder simply appends; the join loses at most one
 * frame (~50 ms) that was still inside the old encoder.
 */
export type CreateMp3Writer = (resume?: Mp3Checkpoint) => Promise<Mp3Writer>;

export const createMp3Writer: CreateMp3Writer = async (resume) => {
  const encoder = await createMp3Encoder();
  encoder.configure({ sampleRate: SAMPLE_RATE, channels: 1, bitrate: 64 });
  const parts: BlobPart[] = resume ? [resume.blob] : [];
  let samples = resume?.samples ?? 0;

  // encode() returns a view into WASM memory that the next call overwrites, so copy it.
  const push = (pcm: Float32Array) => {
    if (!pcm.length) return;
    samples += pcm.length;
    const out = encoder.encode([pcm]);
    if (out.length) parts.push(out.slice());
  };

  return {
    push,
    silence(seconds) {
      const n = Math.round(seconds * SAMPLE_RATE);
      for (let left = n; left > 0; left -= SAMPLE_RATE) push(new Float32Array(Math.min(left, SAMPLE_RATE)));
    },
    get durationSec() {
      return samples / SAMPLE_RATE;
    },
    checkpoint() {
      return { blob: new Blob(parts, { type: 'audio/mpeg' }), samples };
    },
    finish() {
      const out = encoder.finalize();
      if (out.length) parts.push(out.slice());
      return new Blob(parts, { type: 'audio/mpeg' });
    },
  };
};
