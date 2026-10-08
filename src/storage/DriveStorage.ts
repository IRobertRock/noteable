// Storage backed by the Google Drive v3 REST API. This is the only file in the
// app that talks to Drive.

import {
  STALE_JOB_MS,
  basename,
  dirname,
  normalizePath,
  readJson,
  writeJson,
  type Entry,
  type Job,
  type JobResult,
  type NewJob,
  type Storage,
} from './Storage';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,modifiedTime,createdTime';
const MAX_TRIES = 4;
/** Files above this use a resumable upload (MP3 chapters longer than about 10 minutes). */
export const RESUMABLE_OVER = 5 * 1024 * 1024;
/** Resumable chunk size; must be a multiple of 256 KiB. */
export const CHUNK = 8 * 1024 * 1024;

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  createdTime?: string;
}

export interface DriveStorageOptions {
  /** Returns a valid access token. May throw if the user has to tap to reconnect. */
  getToken: () => Promise<string>;
  /** Called after a 401; should return a fresh token. */
  refreshToken: () => Promise<string>;
  rootName?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

export class DriveStorage implements Storage {
  readonly rootName: string;
  /** Set when more than one Noteable/ folder exists in My Drive; the oldest is used. */
  duplicateRoot = false;

  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly cache = new Map<string, Entry>();
  private rootPromise: Promise<Entry | null> | null = null;

  constructor(private readonly opts: DriveStorageOptions) {
    this.rootName = opts.rootName ?? 'Noteable';
    this.fetchImpl = opts.fetch ?? fetch.bind(globalThis);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  // ---- Storage ----

  async list(path: string): Promise<Entry[]> {
    const dir = await this.stat(path);
    if (!dir) throw new DriveError(404, `Not found: ${path || this.rootName}`);
    if (dir.kind !== 'folder') throw new DriveError(400, `Not a folder: ${path}`);
    const files = await this.query(`'${dir.id}' in parents and trashed=false`, 'name');
    const base = normalizePath(path);
    return files.map((f) => this.remember(join(base, f.name), f));
  }

  async read(path: string): Promise<Blob> {
    const entry = await this.requireFile(path);
    const res = await this.request(`${API}/files/${entry.id}?alt=media`);
    return res.blob();
  }

  async write(path: string, data: Blob | string, mimeType?: string): Promise<Entry> {
    const p = normalizePath(path);
    const blob = typeof data === 'string' ? new Blob([data], { type: mimeType ?? 'text/plain' }) : data;
    const type = mimeType ?? (blob.type || 'application/octet-stream');
    const existing = await this.stat(p);
    if (existing?.kind === 'folder') throw new DriveError(400, `Is a folder: ${p}`);

    if (blob.size > RESUMABLE_OVER) {
      const parentId = existing ? undefined : (await this.mkdir(dirname(p))).id;
      return this.remember(p, await this.resumableUpload(blob, type, existing?.id, basename(p), parentId));
    }

    if (existing) {
      const res = await this.request(`${UPLOAD}/files/${existing.id}?uploadType=media&fields=${FIELDS}`, {
        method: 'PATCH',
        headers: { 'Content-Type': type },
        body: blob,
      });
      return this.remember(p, (await res.json()) as DriveFile);
    }

    const parent = await this.mkdir(dirname(p));
    const meta = { name: basename(p), parents: [parent.id], mimeType: type };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', new Blob([blob], { type }));
    const res = await this.request(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
      method: 'POST',
      body: form,
    });
    return this.remember(p, (await res.json()) as DriveFile);
  }

  async move(from: string, to: string): Promise<void> {
    const src = normalizePath(from);
    const dest = normalizePath(to);
    const entry = await this.stat(src);
    if (!entry) throw new DriveError(404, `Not found: ${src}`);
    if (await this.stat(dest)) throw new DriveError(409, `Already exists: ${dest}`);
    const oldParent = await this.stat(dirname(src));
    const newParent = await this.mkdir(dirname(dest));
    const params = new URLSearchParams({ fields: FIELDS });
    if (oldParent!.id !== newParent.id) {
      params.set('addParents', newParent.id);
      params.set('removeParents', oldParent!.id);
    }
    const res = await this.request(`${API}/files/${entry.id}?${params}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: basename(dest) }),
    });
    this.forget(src);
    this.remember(dest, (await res.json()) as DriveFile);
  }

  async delete(path: string): Promise<void> {
    const p = normalizePath(path);
    if (!p) throw new DriveError(400, 'Refusing to delete the Noteable root');
    const entry = await this.stat(p);
    if (!entry) return;
    await this.request(`${API}/files/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    this.forget(p);
  }

  watch(path: string, cb: (entries: Entry[]) => void, intervalMs = 120_000): () => void {
    let last = '';
    let stopped = false;
    const tick = async () => {
      try {
        const entries = await this.list(path);
        const sig = entries
          .map((e) => `${e.id}:${e.name}:${e.modifiedTime}`)
          .sort()
          .join('|');
        if (!stopped && sig !== last) {
          last = sig;
          cb(entries);
        }
      } catch {
        // Next tick will try again (offline, token needs a tap, etc.).
      }
    };
    void tick();
    const timer = setInterval(tick, intervalMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  async enqueue(input: NewJob): Promise<string> {
    const id = input.id ?? crypto.randomUUID();
    const at = new Date(this.now()).toISOString();
    const job: Job = { ...input, id, status: 'pending', createdAt: at, updatedAt: at };
    await writeJson(this, jobPath(id), job);
    return id;
  }

  async claim(jobId: string, worker: string): Promise<Job | null> {
    const job = await readJson<Job>(this, jobPath(jobId));
    const lastSeen = Date.parse(job.heartbeat ?? job.updatedAt);
    const stale = job.status === 'working' && this.now() - lastSeen > STALE_JOB_MS;
    if (job.status !== 'pending' && !stale) return null;

    const at = new Date(this.now()).toISOString();
    const claimed: Job = { ...job, status: 'working', claimedBy: worker, heartbeat: at, updatedAt: at };
    await writeJson(this, jobPath(jobId), claimed);
    // Drive has no compare-and-swap; re-read so a racing worker that wrote last wins.
    const check = await readJson<Job>(this, jobPath(jobId));
    return check.claimedBy === worker && check.status === 'working' ? check : null;
  }

  async complete(jobId: string, result: JobResult): Promise<void> {
    const job = await readJson<Job>(this, jobPath(jobId));
    const at = new Date(this.now()).toISOString();
    await writeJson(this, jobPath(jobId), { ...job, ...result, updatedAt: at });
  }

  async stat(path: string): Promise<Entry | null> {
    const p = normalizePath(path);
    const cached = this.cache.get(p);
    if (cached) return cached;
    if (!p) return this.root();

    const parent = await this.stat(dirname(p));
    if (!parent || parent.kind !== 'folder') return null;
    const name = basename(p);
    const [file] = await this.query(`'${parent.id}' in parents and name='${escapeQuery(name)}' and trashed=false`);
    return file ? this.remember(p, file) : null;
  }

  async mkdir(path: string): Promise<Entry> {
    const p = normalizePath(path);
    if (!p) return (await this.root()) ?? (await this.createRoot());

    const found = await this.stat(p);
    if (found) {
      if (found.kind !== 'folder') throw new DriveError(409, `A file is in the way: ${p}`);
      return found;
    }
    const parent = await this.mkdir(dirname(p));
    const res = await this.request(`${API}/files?fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: basename(p), mimeType: FOLDER, parents: [parent.id] }),
    });
    return this.remember(p, (await res.json()) as DriveFile);
  }

  // ---- internals ----

  /** Forget cached ids, e.g. after signing out or after Rob reorganises Drive. */
  clearCache(): void {
    this.cache.clear();
    this.rootPromise = null;
    this.duplicateRoot = false;
  }

  private root(): Promise<Entry | null> {
    this.rootPromise ??= (async () => {
      const files = await this.query(
        `name='${escapeQuery(this.rootName)}' and 'root' in parents and mimeType='${FOLDER}' and trashed=false`,
        'createdTime',
      );
      this.duplicateRoot = files.length > 1;
      return files[0] ? this.remember('', files[0]) : null;
    })();
    this.rootPromise.catch(() => (this.rootPromise = null));
    return this.rootPromise;
  }

  private async createRoot(): Promise<Entry> {
    const res = await this.request(`${API}/files?fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.rootName, mimeType: FOLDER, parents: ['root'] }),
    });
    const entry = this.remember('', (await res.json()) as DriveFile);
    this.rootPromise = Promise.resolve(entry);
    return entry;
  }

  /** Drive resumable upload: start a session, then PUT chunks, resuming after network errors. */
  private async resumableUpload(blob: Blob, type: string, fileId: string | undefined, name: string, parentId?: string): Promise<DriveFile> {
    const start = await this.request(
      fileId ? `${UPLOAD}/files/${fileId}?uploadType=resumable&fields=${FIELDS}` : `${UPLOAD}/files?uploadType=resumable&fields=${FIELDS}`,
      {
        method: fileId ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': type,
          'X-Upload-Content-Length': String(blob.size),
        },
        body: JSON.stringify(fileId ? {} : { name, parents: [parentId], mimeType: type }),
      },
    );
    const session = start.headers.get('Location');
    if (!session) throw new DriveError(500, 'Drive did not return an upload session');

    let offset = 0;
    let failures = 0;
    while (true) {
      const end = Math.min(offset + CHUNK, blob.size);
      let res: Response;
      try {
        // The session URL carries its own authorisation; no bearer token needed.
        res = await this.fetchImpl(session, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}` },
          body: blob.slice(offset, end),
        });
      } catch (err) {
        if (++failures >= MAX_TRIES) throw err;
        await this.sleep(2 ** failures * 500);
        offset = await this.uploadedBytes(session, blob.size);
        continue;
      }
      if (res.ok) return (await res.json()) as DriveFile;
      if (res.status === 308) {
        const range = res.headers.get('Range');
        offset = range ? Number(range.split('-')[1]) + 1 : 0;
        failures = 0;
        continue;
      }
      const text = await res.text().catch(() => '');
      if (++failures < MAX_TRIES && isRetryable(res.status, text)) {
        await this.sleep(2 ** failures * 500);
        offset = await this.uploadedBytes(session, blob.size);
        continue;
      }
      throw new DriveError(res.status, `Drive upload ${res.status}: ${text.slice(0, 300)}`);
    }
  }

  /** Asks an upload session how much it already has. */
  private async uploadedBytes(session: string, size: number): Promise<number> {
    const res = await this.fetchImpl(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` } });
    if (res.status !== 308) return 0;
    const range = res.headers.get('Range');
    return range ? Number(range.split('-')[1]) + 1 : 0;
  }

  private async requireFile(path: string): Promise<Entry> {
    const entry = await this.stat(path);
    if (!entry) throw new DriveError(404, `Not found: ${path}`);
    if (entry.kind === 'folder') throw new DriveError(400, `Is a folder: ${path}`);
    return entry;
  }

  private async query(q: string, orderBy?: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q, fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000', spaces: 'drive' });
      if (orderBy) params.set('orderBy', orderBy);
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.request(`${API}/files?${params}`);
      const body = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
      out.push(...body.files);
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    let token = await this.opts.getToken();
    let refreshed = false;
    for (let attempt = 1; ; attempt++) {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      const res = await this.fetchImpl(url, { ...init, headers });
      if (res.ok) return res;

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        token = await this.opts.refreshToken();
        continue;
      }
      const text = await res.text().catch(() => '');
      if (attempt < MAX_TRIES && isRetryable(res.status, text)) {
        await this.sleep(2 ** attempt * 500 + Math.random() * 250);
        continue;
      }
      throw new DriveError(res.status, `Drive ${res.status}: ${text.slice(0, 300)}`);
    }
  }

  private remember(path: string, f: DriveFile): Entry {
    const entry: Entry = {
      id: f.id,
      name: f.name,
      path,
      kind: f.mimeType === FOLDER ? 'folder' : 'file',
      mimeType: f.mimeType,
      size: f.size === undefined ? undefined : Number(f.size),
      modifiedTime: f.modifiedTime,
    };
    this.cache.set(path, entry);
    return entry;
  }

  private forget(path: string): void {
    for (const key of [...this.cache.keys()]) {
      if (key === path || key.startsWith(path + '/')) this.cache.delete(key);
    }
  }
}

function jobPath(id: string): string {
  return `Queue/${id}.json`;
}

function join(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isRetryable(status: number, body: string): boolean {
  if (status === 429 || status >= 500) return true;
  return status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(body);
}
