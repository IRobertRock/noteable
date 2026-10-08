// State/settings.json in Drive: settings that follow Rob to every device.

import { readJson, writeJson, type Storage } from './storage/Storage';
import type { ZoteroCreds } from './zotero/client';

export interface Settings {
  version: 1;
  voice?: string;
  zotero?: ZoteroCreds;
  [key: string]: unknown;
}

const PATH = 'State/settings.json';

export async function readSettings(storage: Storage): Promise<Settings> {
  return readJson<Settings>(storage, PATH).catch(() => ({ version: 1 }) as Settings);
}

/** Merges `patch` into settings.json, keeping keys this version doesn't know about. */
export async function updateSettings(storage: Storage, patch: Partial<Settings>): Promise<Settings> {
  const next: Settings = { ...(await readSettings(storage)), ...patch, version: 1 };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
  await writeJson(storage, PATH, next);
  return next;
}
