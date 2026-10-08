// Builds the worker's tray icons: the app icon with a status dot, as PNG-in-ICO files.
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const base = readFileSync('public/icon.svg', 'utf8');
const colours = { idle: '#6fcf97', working: '#56b4f2', paused: '#f2b84b', error: '#f2786d' };

function ico(png) {
  // ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes) + PNG payload (Vista+ reads PNG inside ICO).
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head.writeUInt8(0, 6); // 256 px
  head.writeUInt8(0, 7);
  head.writeUInt8(0, 8);
  head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10);
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}

for (const [name, colour] of Object.entries(colours)) {
  const svg = base.replace('</svg>', `<circle cx="392" cy="392" r="104" fill="${colour}" stroke="#0b0d10" stroke-width="24"/></svg>`);
  const png = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
  writeFileSync(`worker/icons/${name}.ico`, ico(png));
  console.log(`worker/icons/${name}.ico ${png.length} bytes`);
}
