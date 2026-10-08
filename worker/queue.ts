// The queue loop: every minute, look in Queue/ for a pending job (or one whose
// worker went quiet for 15 minutes), claim it, generate it chapter by chapter
// with the same code the phone uses, and mark it done or failed.

import type { CreateMp3Writer } from '../src/audio/mp3';
import { finishUploads, generateItem } from '../src/generate/generateItem';
import type { CheckpointStore, PendingStore } from '../src/generate/pending';
import { readJson, STALE_JOB_MS, writeJson, type Job, type Storage } from '../src/storage/Storage';
import type { TtsEngine } from '../src/tts/engine';

export type WorkerState = { kind: 'idle' } | { kind: 'working'; job: Job; detail: string } | { kind: 'paused' } | { kind: 'error'; message: string } | { kind: 'signed-out' };

export interface QueueDeps {
  storage: Storage;
  engine: TtsEngine;
  createWriter: CreateMp3Writer;
  pending: PendingStore;
  checkpoints: CheckpointStore;
  workerName: string;
  heartbeatMs: number;
  now?: () => number;
  log?: (msg: string, err?: unknown) => void;
}

export class QueueWorker {
  state: WorkerState = { kind: 'idle' };
  paused = false;
  /** The last failure, shown in the tray menu until the next success. */
  lastError?: string;
  /** Speed of the last finished job, for State/worker.json. */
  lastRealTimeFactor?: number;
  onState?: (s: WorkerState) => void;
  private running = false;

  constructor(private readonly d: QueueDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  private set(s: WorkerState): void {
    this.state = s;
    this.onState?.(s);
  }

  /** Jobs that can be started now, oldest first. */
  async available(): Promise<Job[]> {
    const files = (await this.d.storage.list('Queue')).filter((e) => e.kind === 'file' && e.name.endsWith('.json'));
    const jobs: Job[] = [];
    for (const f of files) {
      try {
        jobs.push(await readJson<Job>(this.d.storage, f.path));
      } catch {
        this.d.log?.(`Skipping unreadable job file ${f.name}`);
      }
    }
    const stale = (j: Job) => j.status === 'working' && this.now() - Date.parse(j.heartbeat ?? j.updatedAt) > STALE_JOB_MS;
    const mine = (j: Job) => j.status === 'working' && j.claimedBy === this.d.workerName; // interrupted by a restart
    return jobs.filter((j) => j.status === 'pending' || stale(j) || mine(j)).sort((a, b) => Number(mine(b)) - Number(mine(a)) || a.createdAt.localeCompare(b.createdAt));
  }

  /** One pass: claim and run at most one job. Returns the job id it ran, if any. */
  async tick(): Promise<string | null> {
    if (this.running) return null;
    if (this.paused) {
      this.set({ kind: 'paused' });
      return null;
    }
    this.running = true;
    try {
      for (const candidate of await this.available()) {
        const job =
          candidate.status === 'working' && candidate.claimedBy === this.d.workerName
            ? candidate // our own job from before a restart: carry on
            : await this.d.storage.claim(candidate.id, this.d.workerName);
        if (!job) continue; // someone else got it
        await this.run(job);
        return job.id;
      }
      this.set({ kind: 'idle' });
      return null;
    } finally {
      this.running = false;
    }
  }

  private async run(job: Job): Promise<void> {
    const { storage } = this.d;
    const jobPath = `Queue/${job.id}.json`;
    this.d.log?.(`Working on ${job.itemPath} (job ${job.id}, voice ${job.voice})`);
    this.set({ kind: 'working', job, detail: 'Starting…' });

    let progress: Job['progress'] = { chaptersDone: 0, chaptersTotal: job.chapters.length };
    const beat = async () => {
      try {
        const current = await readJson<Job>(storage, jobPath);
        if (current.claimedBy !== this.d.workerName) return;
        const at = new Date(this.now()).toISOString();
        await writeJson(storage, jobPath, { ...current, heartbeat: at, updatedAt: at, progress });
      } catch (err) {
        this.d.log?.('Heartbeat failed (will retry)', err);
      }
    };
    const timer = setInterval(() => void beat(), this.d.heartbeatMs);

    try {
      const result = await generateItem(job.itemPath, job.voice, {
        storage,
        engine: this.d.engine,
        createWriter: this.d.createWriter,
        pending: this.d.pending,
        checkpoints: this.d.checkpoints,
        deviceName: 'Desktop worker',
        onProgress: (p) => {
          progress = { chapter: p.chapter, chaptersDone: p.chaptersDone, chaptersTotal: p.chaptersTotal, realTimeFactor: p.realTimeFactor ? Math.round(p.realTimeFactor * 10) / 10 : undefined };
          const detail = p.phase === 'loading-model' ? 'Loading the voice model…' : p.phase === 'uploading' ? `Uploading chapter ${p.chaptersDone}` : `Chapter ${p.chapter ?? '?'} of ${p.chaptersTotal}`;
          this.set({ kind: 'working', job, detail });
        },
      });
      if (!result.uploaded) {
        // Try once more before giving up; the audio stays on disk either way.
        await finishUploads(job.itemPath, storage, this.d.pending);
      }
      clearInterval(timer);
      await storage.complete(job.id, { status: 'done' });
      this.d.log?.(`Done: ${job.itemPath} at ${result.realTimeFactor.toFixed(1)}× real time`);
      this.lastError = undefined;
      this.lastRealTimeFactor = Math.round(result.realTimeFactor * 10) / 10;
      this.set({ kind: 'idle' });
    } catch (err) {
      clearInterval(timer);
      const message = err instanceof Error ? err.message : String(err);
      this.d.log?.(`Job ${job.id} failed`, err);
      if ((err as Error)?.name === 'SignInNeeded') {
        // Not the job's fault: put it back for when sign-in is fixed.
        await writeJson(storage, jobPath, { ...job, status: 'pending', claimedBy: undefined, error: message, updatedAt: new Date(this.now()).toISOString() }).catch(() => {});
        this.set({ kind: 'signed-out' });
        return;
      }
      await storage.complete(job.id, { status: 'failed', error: message }).catch(() => {});
      this.lastError = message;
      this.set({ kind: 'error', message });
    }
  }
}
