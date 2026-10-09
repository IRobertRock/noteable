// What was shared to Noteable from another app (kept by public/share-target.js).

export interface SharedMeta {
  title: string;
  text: string;
  url: string;
  files: { key: string; name: string; type: string }[];
  at: number;
}

const CACHE = 'noteable-share';
const base = () => import.meta.env.BASE_URL;

export async function readShared(): Promise<SharedMeta | null> {
  if (!('caches' in self)) return null;
  const res = await (await caches.open(CACHE)).match(`${base()}share-meta`);
  return res ? ((await res.json()) as SharedMeta) : null;
}

export async function sharedFiles(meta: SharedMeta): Promise<File[]> {
  const cache = await caches.open(CACHE);
  const out: File[] = [];
  for (const f of meta.files) {
    const res = await cache.match(f.key);
    if (res) out.push(new File([await res.blob()], f.name, { type: f.type }));
  }
  return out;
}

export async function clearShared(): Promise<void> {
  if ('caches' in self) await caches.delete(CACHE);
}

/** Android often puts the link inside "text" (e.g. "Article title https://…"). */
export function sharedLink(meta: Pick<SharedMeta, 'url' | 'text'>): string {
  return meta.url || meta.text.match(/https?:\/\/\S+/)?.[0] || '';
}

/** A markdown note for the Inbox: plain shared text becomes a narratable file; a link becomes a reminder for Claude. */
export function sharedNote(meta: Pick<SharedMeta, 'title' | 'text' | 'url'>): { name: string; markdown: string; isLink: boolean } {
  const link = sharedLink(meta);
  const text = meta.text.replace(link, '').trim();
  const title = (meta.title || text.split('\n')[0] || (link ? new URL(link).hostname : 'Shared text')).replace(/\s+/g, ' ').trim().slice(0, 80);
  const safe = title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Shared';
  if (link) {
    return {
      isLink: true,
      name: `Shared link - ${safe}.md`,
      markdown: `---\ntitle: ${title.replace(/:/g, ' -')}\ncollection: General\n---\n\n## ${title}\n\nShared link: ${link}\n\n${text ? `${text}\n\n` : ''}This is a reminder: ask Claude to read the page and save a guide to the Inbox.\n`,
    };
  }
  return { isLink: false, name: `${safe}.md`, markdown: `---\ntitle: ${title.replace(/:/g, ' -')}\ncollection: General\n---\n\n## ${title}\n\n${text}\n` };
}

export function claudeLinkPrompt(link: string): string {
  return `Please read ${link} and turn it into a Noteable guide: markdown with a short YAML header (title, collection, mode: narrate), ## headings for chapters, written to be read aloud (no tables or images, spell out symbols). Save it to my Google Drive as Noteable/Inbox/<a short title>.md.`;
}
