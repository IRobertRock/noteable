// Auto-download on Wi-Fi: keep Up next items and items the desktop finished this
// week on the phone, within a size cap. Manual downloads are never evicted.

import type { IndexedItem } from '../library/libraryIndex';
import type { Job } from '../storage/Storage';
import type { DownloadRecord } from './downloads';

export const DEFAULT_CAP_BYTES = 1024 ** 3; // 1 GB
export const RECENT_MS = 7 * 24 * 3600_000;
/** 64 kbps MP3 ≈ 8 KB per second, for estimating before downloading. */
const BYTES_PER_SEC = 8000;

/** Android Chrome reports the connection type; elsewhere it's unknown (treated as not Wi-Fi). */
export function onWifi(): boolean {
  const c = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection;
  return c?.type === 'wifi' || c?.type === 'ethernet';
}

export interface Plan {
  download: IndexedItem[];
  evict: string[]; // item ids (auto-downloaded only)
}

export function planAutoDownloads(opts: {
  items: IndexedItem[];
  upNext: string[];
  jobs: Pick<Job, 'itemPath' | 'status' | 'updatedAt'>[];
  records: Record<string, DownloadRecord & { auto?: boolean }>;
  isDownloaded: (x: IndexedItem) => boolean;
  capBytes?: number;
  now?: number;
}): Plan {
  const cap = opts.capBytes ?? DEFAULT_CAP_BYTES;
  const now = opts.now ?? Date.now();
  const byId = new Map(opts.items.map((x) => [x.item.id, x]));
  const byPath = new Map(opts.items.map((x) => [x.path, x]));
  const playable = (x: IndexedItem | undefined): x is IndexedItem => !!x && x.item.chapters.some((c) => c.status === 'done' && !c.excluded);

  const wanted: IndexedItem[] = [];
  for (const id of opts.upNext) {
    const x = byId.get(id);
    if (playable(x) && !wanted.includes(x)) wanted.push(x);
  }
  for (const j of [...opts.jobs].filter((j) => j.status === 'done' && now - Date.parse(j.updatedAt) < RECENT_MS).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const x = byPath.get(j.itemPath);
    if (playable(x) && !wanted.includes(x)) wanted.push(x);
  }

  const size = (x: IndexedItem) => x.item.chapters.filter((c) => c.status === 'done' && !c.excluded).reduce((n, c) => n + (c.durationSec ?? 0) * BYTES_PER_SEC, 0);
  let used = Object.values(opts.records).reduce((n, r) => n + r.bytes, 0);
  const wantedIds = new Set(wanted.map((x) => x.item.id));
  // Auto-downloads no longer wanted can go first, oldest first.
  const evictable = Object.values(opts.records)
    .filter((r) => r.auto && !wantedIds.has(r.itemId))
    .sort((a, b) => a.at.localeCompare(b.at));

  const download: IndexedItem[] = [];
  const evict: string[] = [];
  for (const x of wanted) {
    if (opts.isDownloaded(x)) continue;
    const need = size(x);
    while (used + need > cap && evictable.length) {
      const r = evictable.shift()!;
      evict.push(r.itemId);
      used -= r.bytes;
    }
    if (used + need > cap) break;
    download.push(x);
    used += need;
  }
  return { download, evict };
}
