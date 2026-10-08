// End-to-end check against the real Drive, using the worker's saved sign-in:
// imports Inbox/<file>, sends it to the desktop queue, and waits for the running
// worker to finish it.  Run: npx tsx worker/e2e.ts desktop-worker-test.md
import type { Item } from '../src/model/item';
import { importMarkdown } from '../src/import/importMarkdown';
import { DriveStorage } from '../src/storage/DriveStorage';
import { readJson, type Job } from '../src/storage/Storage';
import { sendToDesktop } from '../src/queue/jobs';
import { DesktopAuth } from './auth';
import { readConfig } from './config';

const file = process.argv[2] ?? 'desktop-worker-test.md';
const cfg = readConfig();
const auth = new DesktopAuth(cfg);
const storage = new DriveStorage({ getToken: auth.getToken, refreshToken: auth.refreshToken, rootName: cfg.rootName });

const { itemPath, item } = await importMarkdown(storage, `Inbox/${file}`);
console.log(`Imported ${itemPath} (${item.chapters.length} chapters, voice ${item.voice})`);
const id = await sendToDesktop(storage, itemPath, item, item.voice);
console.log(`Queued job ${id}; waiting for the worker (checks every minute)…`);

const start = Date.now();
let last = '';
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  const job = await readJson<Job>(storage, `Queue/${id}.json`);
  const line = `${job.status}${job.claimedBy ? ` by ${job.claimedBy}` : ''}${job.progress ? ` (${job.progress.chaptersDone}/${job.progress.chaptersTotal})` : ''}`;
  if (line !== last) console.log(`  ${Math.round((Date.now() - start) / 1000)} s: ${line}`);
  last = line;
  if (job.status === 'done' || job.status === 'failed') {
    const done = await readJson<Item>(storage, `${itemPath}/item.json`);
    console.log(`E2E job=${job.status}${job.error ? ` error=${job.error}` : ''} item=${done.status} chapters=${done.chapters.map((c) => `${c.n}:${c.status}:${c.durationSec}s`).join(',')} engine=${done.lastGenerated?.engine} rtf=${done.lastGenerated?.realTimeFactor} total=${Math.round((Date.now() - start) / 1000)}s`);
    break;
  }
  if (Date.now() - start > 5 * 60_000) {
    console.log('E2E timed out after 5 minutes');
    break;
  }
}
