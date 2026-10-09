// Writes a 1024 px copy (diff_1k.jpg) next to each terrain ground texture in public/textures/*/diff.jpg.
// Phones load the 1k files: a quarter of the GPU memory (about 33 MB for the six instead of 118 MB) and of the download.
//   node scripts/build-terrain-tex.mjs
import sharp from 'sharp';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const dir = new URL('../public/textures', import.meta.url).pathname;
for (const name of await readdir(dir)) {
  const src = join(dir, name, 'diff.jpg');
  const out = join(dir, name, 'diff_1k.jpg');
  try {
    await stat(src);
  } catch {
    continue;
  }
  await sharp(src).resize(1024, 1024, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 88, mozjpeg: true }).toFile(out);
  console.log(`${name}/diff_1k.jpg ${Math.round((await stat(out)).size / 1024)} KB`);
}
