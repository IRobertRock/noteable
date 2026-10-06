import { writeJson, type Storage } from './Storage';
import { LAYOUT_FILES, LAYOUT_FOLDERS } from '../config';

export type LayoutState = 'found' | 'created' | 'error';

export interface LayoutStatus {
  path: string;
  state: LayoutState;
  error?: string;
}

/**
 * Makes sure the Noteable/ folder tree and State files exist. Everything is
 * looked up first, so running this again never creates duplicates or
 * overwrites existing files.
 */
export async function ensureLayout(storage: Storage): Promise<LayoutStatus[]> {
  // Reach Drive once outside the per-entry error handling, so sign-in and
  // network failures surface as one error rather than seven.
  await storage.stat('');

  const out: LayoutStatus[] = [];

  for (const path of LAYOUT_FOLDERS) {
    try {
      const existed = await storage.stat(path);
      if (!existed) await storage.mkdir(path);
      out.push({ path, state: existed ? 'found' : 'created' });
    } catch (err) {
      out.push({ path, state: 'error', error: message(err) });
    }
  }

  for (const [path, initial] of Object.entries(LAYOUT_FILES)) {
    try {
      const existed = await storage.stat(path);
      if (!existed) await writeJson(storage, path, initial);
      out.push({ path, state: existed ? 'found' : 'created' });
    } catch (err) {
      out.push({ path, state: 'error', error: message(err) });
    }
  }

  return out;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
