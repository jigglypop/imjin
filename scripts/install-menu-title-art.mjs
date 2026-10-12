import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const directory = 'assets-src/menu-title-2026-10-12';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assets = [];
// Only the English title is a picture now; the Korean one is set in type (src/ui/menu-cinematic.css). The Korean
// lettering this script once installed is kept in the folder as history.
const files = { en: ['title-en-gpt-image-2.5.png', 'prompt-en.txt'] };
for (const language of ['en']) {
  const source = `${directory}/${files[language][0]}`;
  const prompt = `${directory}/${files[language][1]}`;
  const target = `public/ui/art/menu_title_${language}.webp`;
  const original = await readFile(source);
  const { data, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1, transparent = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const alpha = data[(y * info.width + x) * 4 + 3];
    if (!alpha) transparent++;
    if (alpha > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  if (transparent < info.width * info.height * 0.1 || x1 < x0) throw new Error(`${language}: invalid transparent artwork`);
  // Remove empty margins only; preserve the generated pixels and alpha without repainting or recoloring.
  const pad = 24;
  const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
  const crop = { left, top, width: Math.min(info.width, x1 + pad + 1) - left, height: Math.min(info.height, y1 + pad + 1) - top };
  await sharp(original).extract(crop).webp({ lossless: true, effort: 6 }).toFile(target);
  const output = await readFile(target);
  assets.push({ language, source, prompt, target, input: { width: info.width, height: info.height, sha256: sha256(original) }, crop,
    output: { bytes: output.length, sha256: sha256(output) }, promptSha256: sha256(await readFile(prompt)) });
}
await writeFile(`${directory}/provenance.json`, `${JSON.stringify({
  generated: '2026-10-12', provider: 'OpenAI Images API', execution: 'bundled imagegen CLI generate',
  modelRequested: 'gpt-image-2.5-sunburst', quality: 'high', size: '1024x1536 (en, first ko); 1536x1024 (ko one line)', background: 'transparent', imagesPerLanguage: 1,
  generationRequests: 5,
  generationNotes: 'Requests 1-2: en and the first two-row ko (title-ko-gpt-image-2.5.png, superseded). Requests 3-5: three one-line ko candidates in candidates-oneline/; cand1 was chosen after a visual check of all syllables and is copied to title-ko-oneline-gpt-image-2.5.png.', sourceImagesPreserved: true, processing: 'transparent margin crop; lossless WebP; no recoloring or compositing', assets,
}, null, 2)}\n`);
console.log(JSON.stringify(assets.map(({ language, crop, output }) => ({ language, crop, ...output })), null, 2));
