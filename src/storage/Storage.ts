// The only way the app touches its data. V1 ships DriveStorage; a later
// RailwayStorage implements the same interface.
//
// Paths are relative to the Noteable/ root and use "/" (e.g. "State/settings.json").
// The empty string "" is the root itself.

export type EntryKind = 'file' | 'folder';

export interface Entry {
  /** Opaque backend id. Callers may pass it back to the same backend but never build it. */
  id: string;
  name: string;
  path: string;
  kind: EntryKind;
  size?: number;
  mimeType?: string;
  modifiedTime: string;
}

export type JobStatus = 'pending' | 'working' | 'done' | 'failed';

export interface Job {
  id: string;
  /** Library path of the item folder, e.g. "Library/General/My item". */
  itemPath: string;
  /** Chapter numbers to generate (1-based). */
  chapters: number[];
  voice: string;
  /** 'transcribe': make an item from a recording (`source`); itemPath is set when done. Default 'generate'. */
  kind?: 'generate' | 'transcribe';
  /** For transcribe jobs: the recording, e.g. "Inbox/Lecture 3.m4a". */
  source?: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  claimedBy?: string;
  /** Last time the worker reported progress (ISO). */
  heartbeat?: string;
  /** Set by the worker while working, for the app's Queue screen. */
  progress?: { chapter?: number; chaptersDone: number; chaptersTotal: number; realTimeFactor?: number };
  error?: string;
}

export type NewJob = Pick<Job, 'itemPath' | 'chapters' | 'voice' | 'kind' | 'source'> & { id?: string };

export interface JobResult {
  status: 'done' | 'failed';
  error?: string;
  /** Transcribe jobs: the item that was made. */
  itemPath?: string;
}

/** A job in `working` with no heartbeat for this long goes back to `pending`. */
export const STALE_JOB_MS = 15 * 60 * 1000;

export interface Storage {
  list(path: string): Promise<Entry[]>;
  read(path: string): Promise<Blob>;
  /** Creates the file (and any missing parent folders) or replaces its content. */
  write(path: string, data: Blob | string, mimeType?: string): Promise<Entry>;
  move(from: string, to: string): Promise<void>;
  /** Moves to the backend's trash; never a hard delete. */
  delete(path: string): Promise<void>;
  /** Polls `path` and calls `cb` when its listing changes. Returns a stop function. */
  watch(path: string, cb: (entries: Entry[]) => void, intervalMs?: number): () => void;

  enqueue(job: NewJob): Promise<string>;
  /** Returns the claimed job, or null if another worker has it. */
  claim(jobId: string, worker: string): Promise<Job | null>;
  complete(jobId: string, result: JobResult): Promise<void>;

  // Not in the spec's list; needed to check before creating (agreed with Rob in phase 1).
  stat(path: string): Promise<Entry | null>;
  /** Idempotent, like `mkdir -p`. */
  mkdir(path: string): Promise<Entry>;

  // Phase 5: files elsewhere in the user's Drive (Drive import, Google Docs).
  // Optional, because a future RailwayStorage may not reach the user's Drive.
  /** Lists a folder anywhere in My Drive; no id means My Drive's top level. */
  browse?(folderId?: string): Promise<ExternalEntry[]>;
  /** Reads a file by its backend id (from `browse` or an Entry). */
  readById?(id: string): Promise<Blob>;
  /** Converts a Google Docs/Slides file, e.g. to text/markdown or .pptx. */
  exportById?(id: string, mimeType: string): Promise<Blob>;

  // Phase 11: what changed since `token` (Drive's change feed). Without a token,
  // returns a starting token and no changes.
  /** Uploads markdown converted to a Google Doc; returns its id and a link to open it. Optional. */
  writeAsGoogleDoc?(path: string, markdown: string): Promise<{ id: string; url: string }>;
  changes?(token?: string): Promise<{ token: string; changed: ChangedFile[] }>;
}

export interface ChangedFile {
  id: string;
  name?: string;
  parents: string[];
  removed: boolean;
  isFolder: boolean;
}

export interface ExternalEntry {
  id: string;
  name: string;
  kind: EntryKind;
  mimeType: string;
  size?: number;
  modifiedTime: string;
}

export const GOOGLE_DOC = 'application/vnd.google-apps.document';
export const GOOGLE_SLIDES = 'application/vnd.google-apps.presentation';

export async function readText(storage: Storage, path: string): Promise<string> {
  return (await storage.read(path)).text();
}

export async function readJson<T>(storage: Storage, path: string): Promise<T> {
  return JSON.parse(await readText(storage, path)) as T;
}

export function writeJson(storage: Storage, path: string, value: unknown): Promise<Entry> {
  return storage.write(path, JSON.stringify(value, null, 2) + '\n', 'application/json');
}

export function normalizePath(path: string): string {
  return path.split('/').filter(Boolean).join('/');
}

export function dirname(path: string): string {
  const parts = normalizePath(path).split('/');
  parts.pop();
  return parts.join('/');
}

export function basename(path: string): string {
  return normalizePath(path).split('/').pop() ?? '';
}
