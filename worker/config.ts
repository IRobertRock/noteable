// Worker settings and where it keeps its files.
//
// Secrets (the desktop OAuth client's secret) live in worker/.env, which is
// git-ignored. Everything the worker writes goes to %APPDATA%\Noteable.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKER_DIR = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(process.env.APPDATA ?? join(homedir(), '.config'), 'Noteable');
export const TOKEN_FILE = join(DATA_DIR, 'token.bin');
export const LOG_FILE = join(DATA_DIR, 'worker.log');
export const LOCK_FILE = join(DATA_DIR, 'worker.lock');
export const PENDING_DIR = join(DATA_DIR, 'pending');
export const CHECKPOINT_DIR = join(DATA_DIR, 'checkpoints');

export const POLL_MS = 60_000;
export const HEARTBEAT_MS = 60_000;

mkdirSync(DATA_DIR, { recursive: true });

/** Reads worker/.env (KEY=value lines) into process.env without overriding real env vars. */
export function loadEnv(file = join(WORKER_DIR, '.env')): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

export interface WorkerConfig {
  clientId: string;
  clientSecret: string;
  rootName: string;
  workerName: string;
}

export function readConfig(): WorkerConfig {
  loadEnv();
  const clientId = process.env.GOOGLE_DESKTOP_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_DESKTOP_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) {
    throw new Error(`Missing GOOGLE_DESKTOP_CLIENT_ID / GOOGLE_DESKTOP_CLIENT_SECRET in ${join(WORKER_DIR, '.env')}`);
  }
  return {
    clientId,
    clientSecret,
    rootName: process.env.NOTEABLE_ROOT || 'Noteable',
    workerName: process.env.NOTEABLE_WORKER_NAME || `desktop-${process.env.COMPUTERNAME ?? 'pc'}`.toLowerCase(),
  };
}
