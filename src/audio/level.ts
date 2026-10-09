// Loudness levelling: each sentence group is nudged towards the same loudness,
// so voices and chapters sound even. Gain is limited to ±6 dB and peaks are kept
// below clipping. Silence and near-silence are left alone.

export const TARGET_RMS = 0.1; // ≈ −20 dBFS
const MAX_GAIN = 2; // +6 dB
const MIN_GAIN = 0.5; // −6 dB
const PEAK_LIMIT = 0.97;
const QUIET_RMS = 0.005;

export function rms(pcm: Float32Array): number {
  let sum = 0;
  let n = 0;
  // Only count samples that aren't silence, so pauses don't drag the loudness down.
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    if (Math.abs(v) > 0.002) {
      sum += v * v;
      n++;
    }
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/** Returns a new, levelled copy (the input is not changed). */
export function levelPcm(pcm: Float32Array): Float32Array {
  const level = rms(pcm);
  if (level < QUIET_RMS) return pcm;
  let gain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET_RMS / level));
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak * gain > PEAK_LIMIT) gain = PEAK_LIMIT / peak;
  if (Math.abs(gain - 1) < 0.02) return pcm;
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * gain;
  return out;
}
