// The desktop queue as the app sees it: Queue/<job-id>.json files.

import { readJson, STALE_JOB_MS, writeJson, type Job, type Storage } from '../storage/Storage';
import { ITEM_FILE, type Item } from '../model/item';
import type { IndexedItem } from '../library/libraryIndex';
import { recordingTitle } from '../import/transcript';

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

/** Items in a course that still need audio and aren't already queued, oldest first. */
export function itemsToSend(items: IndexedItem[], jobs: JobView[]): IndexedItem[] {
  return items
    .filter((x) => !x.item.review && x.item.chapters.some((c) => !c.excluded && c.status !== 'done'))
    .filter((x) => !activeJobFor(jobs, x.path))
    .sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt));
}

/** Send a whole course to the desktop: one job per item, each in its own voice. */
export async function sendCollection(storage: Storage, items: IndexedItem[]): Promise<number> {
  const todo = itemsToSend(items, await listJobs(storage));
  for (const x of todo) await sendToDesktop(storage, x.path, x.item, x.item.voice);
  return todo.length;
}

/** Marks one chapter for regenerating (e.g. after a pronunciation fix); the old audio plays until replaced. */
export async function markChapterForRegenerating(storage: Storage, itemPath: string, n: number): Promise<Item> {
  const file = `${itemPath}/${ITEM_FILE}`;
  const item = await readJson<Item>(storage, file);
  const c = item.chapters.find((x) => x.n === n);
  if (!c) throw new Error(`No chapter ${n}`);
  c.status = 'pending';
  item.status = 'draft';
  item.updatedAt = new Date().toISOString();
  await writeJson(storage, file, item);
  return item;
}

/** Queue a lecture recording (already in Drive, e.g. the Inbox) for transcription on the desktop. */
export async function sendRecording(storage: Storage, sourcePath: string): Promise<string> {
  const name = sourcePath.split('/').pop() ?? sourcePath;
  return storage.enqueue({ kind: 'transcribe', source: sourcePath, itemPath: `Library/General/${recordingTitle(name)}`, chapters: [], voice: '' });
}

/** What a job is about, for lists. */
export function jobName(j: Job): string {
  return j.kind === 'transcribe' && j.status !== 'done' ? `🎙 ${(j.source ?? '').split('/').pop()}` : (j.itemPath.split('/').pop() ?? j.itemPath);
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
