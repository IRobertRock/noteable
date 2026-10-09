// Smart rewind: the longer you've been away, the more you hear again on resume.

const STEPS: [maxAwayMs: number, rewindSec: number][] = [
  [5 * 60_000, 2],
  [60 * 60_000, 10],
  [24 * 3600_000, 20],
];
const LONGEST = 30;

export function smartRewindSec(lastPlayedIso: string | undefined, now = Date.now()): number {
  if (!lastPlayedIso) return STEPS[0][1];
  const away = now - Date.parse(lastPlayedIso);
  if (!Number.isFinite(away) || away < 0) return STEPS[0][1];
  for (const [max, sec] of STEPS) if (away < max) return sec;
  return LONGEST;
}
