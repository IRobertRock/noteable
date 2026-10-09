// In-memory stand-in for the parts of the Drive v3 REST API DriveStorage uses.

import { DriveStorage, type DriveStorageOptions } from '../src/storage/DriveStorage';

const FOLDER = 'application/vnd.google-apps.folder';

// File content is kept as a "binary string" (one char per byte) so MP3s survive intact.
async function bytes(b: Blob): Promise<string> {
  const u = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return s;
}

function toBytes(s: string): Uint8Array<ArrayBuffer> {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  content: string;
  createdTime: string;
  modifiedTime: string;
}

export class FakeDrive {
  files = new Map<string, FakeFile>();
  calls: { method: string; url: string }[] = [];
  /** Responses to return (in order) before handling requests normally. */
  failures: number[] = [];
  validToken = 'token-1';
  /** Throw a network error on the Nth resumable chunk PUT (1-based). */
  dropChunk?: number;
  chunkPuts = 0;
  /** File ids in the order they changed (the change feed). */
  changeLog: string[] = [];
  private sessions = new Map<string, { fileId?: string; name?: string; parent?: string; mimeType: string; size: number; data: string }>();
  private seq = 0;
  private clock = Date.parse('2026-10-06T12:00:00Z');

  add(name: string, parent: string, mimeType = FOLDER, content = ''): FakeFile {
    const at = new Date(this.clock++).toISOString();
    const f: FakeFile = { id: `id${++this.seq}`, name, mimeType, parents: [parent], trashed: false, content, createdTime: at, modifiedTime: at };
    this.files.set(f.id, f);
    this.changeLog.push(f.id);
    return f;
  }

  /** Live (non-trashed) files whose path from My Drive matches, e.g. "Noteable/State". */
  find(path: string): FakeFile[] {
    const parts = path.split('/');
    let level = [...this.files.values()].filter((f) => !f.trashed && f.parents.includes('root') && f.name === parts[0]);
    for (const name of parts.slice(1)) {
      const ids = new Set(level.map((f) => f.id));
      level = [...this.files.values()].filter((f) => !f.trashed && f.name === name && f.parents.some((p) => ids.has(p)));
    }
    return level;
  }

  count(method: string, pattern: RegExp): number {
    return this.calls.filter((c) => c.method === method && pattern.test(c.url)).length;
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    this.calls.push({ method, url: url.pathname + url.search });

    if (url.hostname === 'upload.fake') return this.sessionPut(url.pathname.split('/').pop()!, init);

    const auth = new Headers(init.headers).get('Authorization');
    if (auth !== `Bearer ${this.validToken}`) return json({ error: { code: 401 } }, 401);
    const fail = this.failures.shift();
    if (fail) return json({ error: { code: fail, message: fail === 403 ? 'rateLimitExceeded' : 'fail' } }, fail);

    if (url.pathname === '/drive/v3/changes/startPageToken') return json({ startPageToken: String(this.changeLog.length) });
    if (url.pathname === '/drive/v3/changes') {
      const from = Number(url.searchParams.get('pageToken'));
      const changes = this.changeLog.slice(from).map((id) => {
        const f = this.files.get(id)!;
        return { fileId: id, removed: false, file: { id, name: f.name, mimeType: f.mimeType, parents: f.parents, trashed: f.trashed } };
      });
      return json({ changes, newStartPageToken: String(this.changeLog.length) });
    }
    const m = url.pathname.match(/^\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?$/);
    if (!m) return json({ error: 'unknown route' }, 404);
    const [, upload, id] = m;

    if (upload && url.searchParams.get('uploadType') === 'resumable') {
      const headers = new Headers(init.headers);
      const meta = JSON.parse(String(init.body)) as { name?: string; parents?: string[] };
      const sid = `s${++this.seq}`;
      this.sessions.set(sid, {
        fileId: id,
        name: meta.name,
        parent: meta.parents?.[0],
        mimeType: headers.get('X-Upload-Content-Type')!,
        size: Number(headers.get('X-Upload-Content-Length')),
        data: '',
      });
      return new Response(null, { status: 200, headers: { Location: `https://upload.fake/session/${sid}` } });
    }
    if (method === 'GET' && !id) return json(this.query(url.searchParams.get('q')!, url.searchParams.get('orderBy')));
    if (method === 'GET' && id && url.searchParams.get('alt') === 'media') {
      const f = this.files.get(id);
      return f ? new Response(toBytes(f.content)) : json({}, 404);
    }
    if (method === 'POST' && !upload) {
      const body = JSON.parse(String(init.body)) as { name: string; mimeType: string; parents: string[] };
      return json(meta(this.add(body.name, body.parents[0], body.mimeType)));
    }
    if (method === 'POST' && upload) {
      const form = init.body as FormData;
      const metadata = JSON.parse(await (form.get('metadata') as Blob).text()) as { name: string; parents: string[]; mimeType: string };
      const content = await bytes(form.get('file') as Blob);
      return json(meta(this.add(metadata.name, metadata.parents[0], metadata.mimeType, content)));
    }
    if (method === 'PATCH' && id) {
      const f = this.files.get(id);
      if (!f) return json({}, 404);
      if (upload) {
        f.content = await bytes(init.body as Blob);
      } else {
        const body = JSON.parse(String(init.body)) as { name?: string; trashed?: boolean };
        if (body.name) f.name = body.name;
        if (body.trashed) f.trashed = true;
        const add = url.searchParams.get('addParents');
        const remove = url.searchParams.get('removeParents');
        if (add && remove) f.parents = f.parents.filter((p) => p !== remove).concat(add);
      }
      f.modifiedTime = new Date(this.clock++).toISOString();
      this.changeLog.push(f.id);
      return json(meta(f));
    }
    return json({ error: 'unhandled' }, 400);
  };

  private async sessionPut(sid: string, init: RequestInit): Promise<Response> {
    const s = this.sessions.get(sid);
    if (!s) return json({}, 404);
    const range = new Headers(init.headers).get('Content-Range')!;
    if (range.startsWith('bytes */')) {
      return new Response(null, { status: 308, headers: s.data.length ? { Range: `bytes=0-${s.data.length - 1}` } : {} });
    }
    this.chunkPuts++;
    if (this.chunkPuts === this.dropChunk) throw new TypeError('Failed to fetch');
    const [, from] = range.match(/bytes (\d+)-/)!;
    if (Number(from) !== s.data.length) return json({ error: 'bad offset' }, 400);
    s.data += await bytes(init.body as Blob);
    if (s.data.length < s.size) return new Response(null, { status: 308, headers: { Range: `bytes=0-${s.data.length - 1}` } });
    this.sessions.delete(sid);
    if (s.fileId) {
      const f = this.files.get(s.fileId)!;
      f.content = s.data;
      f.modifiedTime = new Date(this.clock++).toISOString();
      this.changeLog.push(f.id);
      return json(meta(f));
    }
    return json(meta(this.add(s.name!, s.parent!, s.mimeType, s.data)));
  }

  private query(q: string, orderBy: string | null) {
    const parent = q.match(/'([^']+)' in parents/)?.[1];
    const nameMatch = q.match(/name='((?:\\.|[^'\\])*)'/)?.[1];
    const name = nameMatch?.replace(/\\(.)/g, '$1');
    const mime = q.match(/mimeType='([^']+)'/)?.[1];
    let files = [...this.files.values()].filter(
      (f) => !f.trashed && (!parent || f.parents.includes(parent)) && (name === undefined || f.name === name) && (!mime || f.mimeType === mime),
    );
    if (orderBy === 'createdTime') files = files.sort((a, b) => a.createdTime.localeCompare(b.createdTime));
    return { files: files.map(meta) };
  }
}

function meta(f: FakeFile) {
  return { id: f.id, name: f.name, mimeType: f.mimeType, size: String(f.content.length), modifiedTime: f.modifiedTime, createdTime: f.createdTime };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function makeStorage(drive: FakeDrive, extra: Partial<DriveStorageOptions> = {}) {
  let refreshes = 0;
  const storage = new DriveStorage({
    fetch: drive.fetch as typeof fetch,
    getToken: async () => drive.validToken,
    refreshToken: async () => {
      refreshes++;
      return drive.validToken;
    },
    sleep: async () => {},
    ...extra,
  });
  return { storage, refreshes: () => refreshes };
}
