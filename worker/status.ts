// The worker's presence note (State/worker.json) and its answer to the app's
// "Report a problem" (Logs/request-worker.json → Logs/<time>-worker.md).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkerStatus } from '../src/queue/workerStatus';
import { WORKER_STATUS_PATH } from '../src/queue/workerStatus';
import { writeJson, type Storage } from '../src/storage/Storage';
import { LOG_FILE, WORKER_DIR } from './config';
import type { QueueWorker } from './queue';
import { LOG_REQUEST_PATH as LOG_REQUEST } from '../src/queue/logRequest';
import { WORKER_CONTROL_PATH, type WorkerControl } from '../src/queue/workerStatus';
import { readJson } from '../src/storage/Storage';

/** Applies a pause/resume sent from the phone (each request once). Returns true if it changed anything. */
export async function applyControl(storage: Storage, worker: QueueWorker, applied: { at?: string }): Promise<boolean> {
  const c = await readJson<WorkerControl>(storage, WORKER_CONTROL_PATH).catch(() => null);
  if (!c || c.updatedAt === applied.at) return false;
  const first = applied.at === undefined;
  applied.at = c.updatedAt;
  // On start-up, only honour a recent pause (a stale one would leave the worker idle forever).
  if (first && (!c.paused || Date.now() - Date.parse(c.updatedAt) > 7 * 86_400_000)) return false;
  if (worker.paused === c.paused) return false;
  worker.paused = c.paused;
  return true;
}

const VERSION = (JSON.parse(readFileSync(join(WORKER_DIR, '..', 'package.json'), 'utf8')) as { version: string }).version;

export interface StatusExtras {
  engine?: string;
  keepingAwake?: boolean;
}

export async function writeStatus(storage: Storage, name: string, worker: QueueWorker, signedIn: boolean, extras: StatusExtras = {}, now = Date.now()): Promise<void> {
  const s = worker.state;
  const status: WorkerStatus = {
    name,
    lastSeen: new Date(now).toISOString(),
    version: VERSION,
    paused: worker.paused,
    signedIn,
    busy: worker.state.kind === 'working',
    realTimeFactor: worker.lastRealTimeFactor,
    ...(extras.engine ? { engine: extras.engine } : {}),
    ...(s.kind === 'working' ? { current: `${s.job.itemPath.split('/').pop()} · ${s.detail}` } : {}),
    ...(worker.lastError ? { lastError: worker.lastError } : {}),
    ...(extras.keepingAwake ? { keepingAwake: true } : {}),
    recent: worker.recent,
  };
  await writeJson(storage, WORKER_STATUS_PATH, status);
}

/** If the app asked for the worker's log, write the last 300 lines to Logs/ and clear the request. */
export async function answerLogRequest(storage: Storage, name: string): Promise<boolean> {
  if (!(await storage.stat(LOG_REQUEST))) return false;
  const lines = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8').trimEnd().split('\n').slice(-300) : ['(no log yet)'];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await storage.write(`Logs/${stamp}-worker.md`, `# Noteable desktop worker log\n\n- Worker: ${name}\n- Version: ${VERSION}\n- Written: ${new Date().toISOString()}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`, 'text/markdown');
  await storage.delete(LOG_REQUEST);
  return true;
}
