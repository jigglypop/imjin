// A review sheet of a general's concept views, cut-outs composited on magenta (halos and leftovers show):
// portrait | face | costume sheet on the top row, front | left | back | right below.
//   GENERALS_PKG=… node scripts/generals-concept-sheet.mjs <key>[,<key>…]  → <PKG>/review/concept_<key>.jpg
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PKG = process.env.GENERALS_PKG ?? join(ROOT, 'assets-src', 'generals-cast-2026-10-17');
const MAGENTA = { r: 255, g: 0, b: 255 };
const T = 640;

const tile = async (f, w = T, h = T) => (existsSync(f)
  ? sharp(f).resize(w, h, { fit: 'contain', background: MAGENTA }).flatten({ background: MAGENTA }).jpeg().toBuffer()
  : sharp({ create: { width: w, height: h, channels: 3, background: '#333' } }).jpeg().toBuffer());

for (const key of process.argv[2].split(',')) {
  const d = join(PKG, key);
  const id = key.split('__')[0];
  const top = [
    { input: await tile(join(ROOT, 'public', 'ui', 'portraits', `portrait_${id}.webp`)), left: 0, top: 0 },
    { input: await tile(join(d, 'face.png')), left: T, top: 0 },
    { input: await tile(join(d, 'armor.png'), T * 2, T), left: T * 2, top: 0 },
  ];
  const views = await Promise.all(['front', 'left', 'back', 'right'].map(async (w, i) => ({ input: await tile(join(d, `${w}.png`), T, T * 1.5 | 0), left: i * T, top: T })));
  mkdirSync(join(PKG, 'review'), { recursive: true });
  const out = join(PKG, 'review', `concept_${key}.jpg`);
  await sharp({ create: { width: T * 4, height: T * 2.5 | 0, channels: 3, background: '#222' } }).composite([...top, ...views]).jpeg({ quality: 85 }).toFile(out);
  console.log(out);
}
