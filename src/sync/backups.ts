// Safety copies of progress: once a day, State/*.json is copied to
// State/backups/<YYYY-MM-DD>/, keeping the last 7 days. Restore replaces the
// current files with a chosen day's copies (after a confirm in the UI).

import { kvGet, kvSet } from '../db';
import type { Storage } from '../storage/Storage';

export const BACKED_UP = ['playback.json', 'bookmarks.json', 'cards.json', 'upnext.json'] as const;
export const KEEP_DAYS = 7;
const LAST_KEY = 'backups.lastDay';

export function dayStamp(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Which backup folders to delete, keeping the newest `keep`. */
export function toPrune(days: string[], keep = KEEP_DAYS): string[] {
  return [...days].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(keep);
}

export interface LocalMarker {
  get(): Promise<string | undefined>;
  set(day: string): Promise<void>;
}

const idbMarker: LocalMarker = { get: () => kvGet<string>(LAST_KEY), set: (d) => kvSet(LAST_KEY, d) };

/** Makes today's copy if this device hasn't yet and no other device has. Returns the day if it wrote one. */
export async function backupIfDue(storage: Storage, now = new Date(), marker: LocalMarker = idbMarker): Promise<string | null> {
  const today = dayStamp(now);
  if ((await marker.get()) === today) return null;
  if (await storage.stat(`State/backups/${today}`)) {
    await marker.set(today);
    return null;
  }
  for (const name of BACKED_UP) {
    const src = await storage.stat(`State/${name}`);
    if (!src) continue;
    await storage.write(`State/backups/${today}/${name}`, await storage.read(`State/${name}`), 'application/json');
  }
  const days = (await storage.list('State/backups').catch(() => [])).filter((e) => e.kind === 'folder').map((e) => e.name);
  for (const old of toPrune(days)) await storage.delete(`State/backups/${old}`);
  await marker.set(today);
  return today;
}

export async function listBackups(storage: Storage): Promise<string[]> {
  const days = (await storage.list('State/backups').catch(() => [])).filter((e) => e.kind === 'folder').map((e) => e.name);
  return days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
}

/** Replaces the current State files with a day's copies. The app then reloads its local copies. */
export async function restoreBackup(storage: Storage, day: string): Promise<string[]> {
  const restored: string[] = [];
  for (const name of BACKED_UP) {
    const src = await storage.stat(`State/backups/${day}/${name}`);
    if (!src) continue;
    await storage.write(`State/${name}`, await storage.read(`State/backups/${day}/${name}`), 'application/json');
    restored.push(name);
  }
  return restored;
}
