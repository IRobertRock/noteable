// Fails if any file other than DriveStorage.ts calls the Drive API directly.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ALLOWED = ['src/storage/DriveStorage.ts'];
const PATTERN = /googleapis\.com\/(upload\/)?drive/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|js|mjs)$/.test(name)) yield path;
  }
}

const offenders = [...walk('src')]
  .map((p) => relative('.', p).split(sep).join('/'))
  .filter((p) => !ALLOWED.includes(p) && PATTERN.test(readFileSync(p, 'utf8')));

if (offenders.length) {
  console.error('Direct Drive API calls outside DriveStorage:\n  ' + offenders.join('\n  '));
  process.exit(1);
}
console.log('Drive boundary OK');
