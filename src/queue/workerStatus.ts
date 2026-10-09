// State/worker.json: the desktop worker's "I'm here" note, written on every poll.

import { readJson, type Storage } from '../storage/Storage';

export interface WorkerStatus {
  name: string;
  lastSeen: string;
  version: string;
  paused: boolean;
  signedIn: boolean;
  busy: boolean;
  realTimeFactor?: number;
  /** 'GPU' or 'CPU', once the voice engine has loaded. */
  engine?: string;
  /** What it's doing now, e.g. "Chapter 3 of 8". */
  current?: string;
  lastError?: string;
  /** Keeping Windows awake for a job right now. */
  keepingAwake?: boolean;
  /** Last 10 jobs, newest first. */
  recent?: RecentJob[];
}

export interface RecentJob {
  at: string;
  item: string;
  chapters: number;
  result: 'done' | 'failed';
  realTimeFactor?: number;
  minutes?: number;
  error?: string;
}

/** Written by the app to pause or resume the worker from the phone. */
export interface WorkerControl {
  paused: boolean;
  updatedAt: string;
}

export const WORKER_STATUS_PATH = 'State/worker.json';
export const WORKER_CONTROL_PATH = 'State/worker-control.json';

export async function setWorkerPaused(storage: Storage, paused: boolean): Promise<void> {
  const control: WorkerControl = { paused, updatedAt: new Date().toISOString() };
  await storage.write(WORKER_CONTROL_PATH, JSON.stringify(control, null, 2), 'application/json');
}
/** The worker polls every minute; three missed polls means offline. */
export const ONLINE_WITHIN_MS = 3 * 60_000;

export async function readWorkerStatus(storage: Storage): Promise<WorkerStatus | null> {
  return readJson<WorkerStatus>(storage, WORKER_STATUS_PATH).catch(() => null);
}

export function isOnline(s: WorkerStatus | null, now = Date.now()): boolean {
  return !!s && !s.paused && s.signedIn && now - Date.parse(s.lastSeen) < ONLINE_WITHIN_MS;
}

export function describeWorker(s: WorkerStatus | null, now = Date.now()): string {
  if (!s) return 'Desktop worker not set up';
  const ago = agoText(now - Date.parse(s.lastSeen));
  if (!s.signedIn) return `Desktop needs Google sign-in (seen ${ago} ago)`;
  if (s.paused) return `Desktop paused (seen ${ago} ago)`;
  return isOnline(s, now) ? `Desktop online · seen ${ago} ago` : `Desktop offline · last seen ${ago} ago`;
}

function agoText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}
