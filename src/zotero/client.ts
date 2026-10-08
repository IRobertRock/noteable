// Zotero web API v3: your personal library, read-only. The API key is entered
// in Settings and stored in your Drive (State/settings.json), never in the app's code.

const API = 'https://api.zotero.org';

export interface ZoteroCreds {
  apiKey: string;
  userId: string;
  username?: string;
}

export interface ZoteroCollection {
  key: string;
  name: string;
  parent?: string;
}

export interface ZoteroItem {
  key: string;
  title: string;
  authors: string;
  year?: string;
  itemType: string;
  publication?: string;
  hasChildren: boolean;
}

export interface ZoteroAttachment {
  key: string;
  filename: string;
  contentType: string;
  /** Only files stored in Zotero (not links to elsewhere) can be downloaded. */
  downloadable: boolean;
}

export class ZoteroError extends Error {}

export class ZoteroClient {
  constructor(
    private readonly creds: ZoteroCreds,
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  /** Checks a key and finds whose library it opens. */
  static async connect(apiKey: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<ZoteroCreds> {
    const res = await fetchImpl(`${API}/keys/current`, { headers: headers(apiKey.trim()) });
    if (res.status === 403 || res.status === 404) throw new ZoteroError('Zotero did not accept that key. Check it at zotero.org/settings/keys.');
    if (!res.ok) throw new ZoteroError(`Zotero error ${res.status}`);
    const body = (await res.json()) as { userID: number; username?: string; access?: { user?: { library?: boolean; files?: boolean } } };
    if (!body.access?.user?.library) throw new ZoteroError('This key cannot read your personal library. Give it "Allow library access".');
    return { apiKey: apiKey.trim(), userId: String(body.userID), username: body.username };
  }

  async collections(): Promise<ZoteroCollection[]> {
    const rows = await this.getAll<{ key: string; data: { name: string; parentCollection: string | false } }>(`/users/${this.creds.userId}/collections`);
    return rows.map((r) => ({ key: r.key, name: r.data.name, parent: r.data.parentCollection || undefined })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Top-level items (not notes or attachments), newest first; optionally in a collection or matching a search. */
  async items(opts: { collection?: string; q?: string; limit?: number } = {}): Promise<ZoteroItem[]> {
    const base = opts.collection ? `/users/${this.creds.userId}/collections/${opts.collection}/items/top` : `/users/${this.creds.userId}/items/top`;
    const params = new URLSearchParams({ limit: String(opts.limit ?? 50), sort: 'dateModified', direction: 'desc', itemType: '-attachment || note' });
    if (opts.q?.trim()) params.set('q', opts.q.trim());
    const rows = await this.get<ZoteroRow[]>(`${base}?${params}`);
    return rows.map(toItem);
  }

  async attachments(itemKey: string): Promise<ZoteroAttachment[]> {
    const rows = await this.get<{ key: string; data: { itemType: string; contentType?: string; filename?: string; title?: string; linkMode?: string } }[]>(`/users/${this.creds.userId}/items/${itemKey}/children`);
    return rows
      .filter((r) => r.data.itemType === 'attachment')
      .map((r) => ({
        key: r.key,
        filename: r.data.filename || `${r.data.title || 'attachment'}.pdf`,
        contentType: r.data.contentType ?? '',
        downloadable: r.data.linkMode === 'imported_file' || r.data.linkMode === 'imported_url',
      }));
  }

  /** The attachment's file (Zotero redirects to its file storage). */
  async download(att: ZoteroAttachment): Promise<File> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}/users/${this.creds.userId}/items/${att.key}/file`, { headers: headers(this.creds.apiKey) });
    } catch {
      throw new ZoteroError("Couldn't download the file from Zotero. If this keeps happening, save the PDF to Noteable/Inbox from Zotero instead.");
    }
    if (res.status === 404) throw new ZoteroError('Zotero has no stored file for this attachment (it may only be on your computer). Sync Zotero files or save the PDF to the Inbox.');
    if (!res.ok) throw new ZoteroError(`Zotero file error ${res.status}`);
    return new File([await res.blob()], att.filename, { type: att.contentType || 'application/pdf' });
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, { headers: headers(this.creds.apiKey) });
    if (res.status === 403) throw new ZoteroError('Zotero refused the request; the key may have been revoked.');
    if (!res.ok) throw new ZoteroError(`Zotero error ${res.status}`);
    return (await res.json()) as T;
  }

  private async getAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let start = 0; start < 2000; start += 100) {
      const page = await this.get<T[]>(`${path}?limit=100&start=${start}`);
      out.push(...page);
      if (page.length < 100) break;
    }
    return out;
  }
}

interface ZoteroRow {
  key: string;
  meta?: { numChildren?: number; creatorSummary?: string; parsedDate?: string };
  data: { title?: string; itemType: string; creators?: { firstName?: string; lastName?: string; name?: string }[]; date?: string; publicationTitle?: string; bookTitle?: string };
}

function toItem(r: ZoteroRow): ZoteroItem {
  const names = (r.data.creators ?? []).map((c) => c.name ?? [c.firstName, c.lastName].filter(Boolean).join(' ')).filter(Boolean);
  const authors = names.length > 3 ? `${names[0]} et al.` : names.join(', ');
  const year = r.meta?.parsedDate?.slice(0, 4) ?? r.data.date?.match(/\d{4}/)?.[0];
  return {
    key: r.key,
    title: r.data.title?.trim() || '(untitled)',
    authors: authors || r.meta?.creatorSummary || '',
    year,
    itemType: r.data.itemType,
    publication: r.data.publicationTitle || r.data.bookTitle || undefined,
    hasChildren: (r.meta?.numChildren ?? 0) > 0,
  };
}

function headers(apiKey: string): HeadersInit {
  return { 'Zotero-API-Key': apiKey, 'Zotero-API-Version': '3' };
}
