// Append-only log at %APPDATA%\Noteable\worker.log, rotated at 5 MB.

import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { LOG_FILE } from './config';

const MAX_BYTES = 5 * 1024 * 1024;

export function log(message: string, err?: unknown): void {
  const line = `${new Date().toISOString()} ${message}${err ? ` — ${err instanceof Error ? err.stack ?? err.message : String(err)}` : ''}\n`;
  process.stdout.write(line);
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_BYTES) renameSync(LOG_FILE, `${LOG_FILE}.1`);
    appendFileSync(LOG_FILE, line);
  } catch {
    // Logging must never stop the worker.
  }
}
