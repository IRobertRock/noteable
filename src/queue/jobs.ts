// The desktop queue as the app sees it: Queue/<job-id>.json files.

import { readJson, STALE_JOB_MS, writeJson, type Job, type Storage } from '../storage/Storage';
import type { Item } from '../model/item';

export type JobView = Job & { stalled: boolean; waitingMs: number; sinceHeartbeatMs?: number };

export async function listJobs(storage: Storage, now = Date.now()): Promise<JobView[]> {
  const files = (await storage.list('Queue')).filter((e) => e.kind === 'file' && e.name.endsWith('.json'));
  const jobs = await Promise.all(files.map((f) => readJson<Job>(storage, f.path).catch(() => null)));
  return jobs
    .filter((j): j is Job => !!j)
    .map((j) => {
      const beat = j.heartbeat ? now - Date.parse(j.heartbeat) : undefined;
      return {
        ...j,
        waitingMs: now - Date.parse(j.createdAt),
        sinceHeartbeatMs: beat,
        stalled: j.status === 'working' && (beat ?? now - Date.parse(j.updatedAt)) > STALE_JOB_MS,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function activeJobFor(jobs: JobView[], itemPath: string): JobView | undefined {
  return jobs.find((j) => j.itemPath === itemPath && (j.status === 'pending' || j.status === 'working'));
}

/** Queue an item for the desktop worker: the chapters still to generate, in the chosen voice. */
export async function sendToDesktop(storage: Storage, itemPath: string, item: Item, voice: string): Promise<string> {
  const chapters = item.chapters.filter((c) => !c.excluded && (c.status !== 'done' || voice !== item.voice)).map((c) => c.n);
  if (!chapters.length) throw new Error('Every chapter already has audio.');
  return storage.enqueue({ itemPath, chapters, voice });
}

/** Cancel a job that hasn't started, or clear a finished one from the list. */
export async function removeJob(storage: Storage, job: Job): Promise<void> {
  if (job.status === 'working') throw new Error('The desktop is working on this job; it can only be removed once it finishes.');
  await storage.delete(`Queue/${job.id}.json`);
}

/** Send a failed job back to the queue. */
export async function retryJob(storage: Storage, job: Job): Promise<void> {
  const at = new Date().toISOString();
  await writeJson(storage, `Queue/${job.id}.json`, { ...job, status: 'pending', error: undefined, claimedBy: undefined, heartbeat: undefined, createdAt: at, updatedAt: at });
}
