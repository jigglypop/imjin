// One board of many generals' concept views (front | left | back | right per row, on magenta) for a quick batch review.
//   GENERALS_PKG=… node scripts/generals-concept-board.mjs <out.jpg> <key>[,<key>…]
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PKG = process.env.GENERALS_PKG ?? join(ROOT, 'assets-src', 'generals-cast-2026-10-17');
const M = { r: 255, g: 0, b: 255 };
const W = 300, H = 420;
const [out, list] = process.argv.slice(2);
const keys = list.split(',');
const parts = [];
for (const [row, key] of keys.entries()) {
  for (const [i, w] of ['face', 'front', 'left', 'back', 'right'].entries()) {
    const f = join(PKG, key, `${w}.png`);
    if (!existsSync(f)) continue;
    parts.push({ input: await sharp(f).trim({ threshold: 1 }).resize(W, H, { fit: 'contain', background: M }).flatten({ background: M }).jpeg().toBuffer(), left: i * W, top: row * H });
  }
}
await sharp({ create: { width: W * 5, height: H * keys.length, channels: 3, background: '#222' } }).composite(parts).jpeg({ quality: 80 }).toFile(out);
