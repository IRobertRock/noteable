// The ten Kokoro voices chosen for Noteable (spec: Locked decisions → Voices).

export const VOICES = [
  { id: 'af_bella', name: 'Bella', label: 'US female' },
  { id: 'af_nicole', name: 'Nicole', label: 'US female' },
  { id: 'af_river', name: 'River', label: 'US female' },
  { id: 'af_sky', name: 'Sky', label: 'US female' },
  { id: 'bf_emma', name: 'Emma', label: 'UK female' },
  { id: 'bf_lily', name: 'Lily', label: 'UK female' },
  { id: 'am_adam', name: 'Adam', label: 'US male' },
  { id: 'am_eric', name: 'Eric', label: 'US male' },
  { id: 'am_michael', name: 'Michael', label: 'US male' },
  { id: 'bm_fable', name: 'Fable', label: 'UK male' },
] as const;

export type VoiceId = (typeof VOICES)[number]['id'];

export const DEFAULT_VOICE: VoiceId = 'af_bella';

export function isVoice(id: unknown): id is VoiceId {
  return VOICES.some((v) => v.id === id);
}

/** Accepts a Kokoro id ("am_michael") or a name ("Michael"). */
export function toVoiceId(value: unknown): VoiceId | undefined {
  if (isVoice(value)) return value;
  if (typeof value !== 'string') return undefined;
  return VOICES.find((v) => v.name.toLowerCase() === value.trim().toLowerCase())?.id;
}
