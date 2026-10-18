// Armada (1588) commander portraits in the same film-still set as generate-commander-portraits.mjs (same model, prompt
// style, sizes and export); each takes the finished Chen Lin raw as the style reference. Raws live in
// assets-src/commanders-armada-2026-10-17/src/; an existing raw is not generated again unless --force.
//
//   node scripts/generate-commander-portraits.mjs                 generate what is missing, convert, write provenance
//   node scripts/generate-commander-portraits.mjs --only yi,won   some ids
//   node scripts/generate-commander-portraits.mjs --force         regenerate the chosen ids
//   node scripts/generate-commander-portraits.mjs --convert       only (re)cut the webp files from the raws
//   node scripts/generate-commander-portraits.mjs --note "why"    stored with the request (use when redoing one)
//
// Output: portrait_<id>.webp (768) and portrait_<id>_sm.webp (192).
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import sharp from 'sharp';

const rawPath = (id) => join(RAW, `${id}.webp`);
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ENV = [join(ROOT, '.env'), 'C:/dev/imjin/.env'].find((p) => existsSync(p));
if (ENV) process.loadEnvFile(ENV);
const SRC = join(ROOT, 'assets-src', 'commanders-armada-2026-10-17');
const RAW = join(SRC, 'src');
const OUT = join(ROOT, 'public', 'ui', 'portraits');
const PROV = join(SRC, 'provenance.json');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const FORCE = args.includes('--force');
const CONVERT_ONLY = args.includes('--convert');
const ONLY = opt('only', '').split(',').filter(Boolean);
const NOTE = opt('note', '');
const MODEL = opt('model', 'gpt-image-2.5-sunburst');
const SIZE = '1024x1024';
const QUALITY = 'high';
// USD per million tokens, the gpt-image-2 list prices; the 2.5 preview is not priced publicly, so totals are estimates.
const PRICE = { textIn: 5, imageIn: 8, imageOut: 30 };

const STYLE =
  'Square live-action period naval war film still, head-to-upper-chest portrait of one man, face centred and large enough to read at 60 pixels, ' +
  'the whole head and any hat inside the frame with a little margin above it. Weathered sun-and-salt skin with pores and uneven stubble, believable asymmetrical face, understated expression. ' +
  'Cool overcast side light from one side with a faint warm firelight rim on the other, sea haze and gunpowder smoke, background of blurred dark timber rails, rigging and blue-grey water. ' +
  'Shallow depth of field, desaturated filmic grade, subtle 35mm grain. Late-sixteenth-century practical materials: salt-stained cloth, rubbed iron, worn leather, no luxurious fantasy ornament. ' +
  'No painting or illustration look, no plastic CGI skin, no modern items, no text, no letters, no logo, no border, no frame. Opaque background. ';
const REF_NOTE =
  'The attached picture is the existing casting of this same man: keep his face, age, beard and features recognisable, and redraw him in the film-still look described here, with the costume described here. ';

const STYLE_REF_RAW = join(ROOT, 'assets-src', 'commanders-2026-10-16', 'src', 'chenlin.webp');
const STYLE_NOTE =
  'The attached picture is a finished portrait from the same film: match its look exactly (framing, light, grade, grain, materials), but this is a different man from a different nation: do not reuse his face, beard or costume, and do not reuse his background ships or crew: behind this man are blurred European galleons of 1588 with square sails, a galleon deck and European sailors only, no Asian junks, no Asian soldiers, no red-armoured figures. ';
const LIKE = 'His face, beard and bearing follow his known contemporary portraits. ';
const ENG = 'Elizabethan English costume of 1588: ';
const SPA = 'Spanish costume of 1588: ';
const WHO = {
  howard: ENG + LIKE + 'Charles Howard, Lord Howard of Effingham, Lord High Admiral, about fifty-two, a long aristocratic face, high forehead, grey-streaked brown hair, a long pointed grey-brown beard and moustache, calm composed noble eyes; a small white starched lace ruff, a black-and-silver doublet under a blackened steel gorget, a thin gold chain of office, bareheaded.',
  drake: ENG + LIKE + 'Sir Francis Drake, vice-admiral, about forty-eight, a ruddy broad weathered face, auburn-red curly hair, a short pointed reddish beard and upturned moustache, bright confident shrewd eyes; a modest white ruff, a dark doublet under a burnished steel breastplate, a small black cap.',
  hawkins: ENG + LIKE + 'Sir John Hawkins, rear-admiral, about fifty-six, a lean hard weathered face, greying hair, a grey forked beard and moustache, stern experienced eyes; a small white ruff, a dark russet doublet with a plain steel gorget, a black flat cap.',
  frobisher: ENG + LIKE + 'Sir Martin Frobisher, about fifty, a big rugged blunt face, short curly brown hair, a thick brown beard and heavy moustache, fierce bold eyes; a small white ruff, a scuffed blackened steel half-armour cuirass over a buff leather jerkin, bareheaded.',
  medina: SPA + LIKE + 'Alonso Perez de Guzman, seventh Duke of Medina Sidonia, captain-general of the Armada, about thirty-eight, a pale long melancholy face, dark hair, a neat dark pointed beard and moustache, grave anxious dark eyes; a white starched cartwheel ruff, sober black silk doublet, a blackened steel gorget, the gold Order of the Golden Fleece hanging on a red ribbon at his chest, bareheaded.',
  recalde: SPA + LIKE + 'Juan Martinez de Recalde, Basque admiral, about sixty-two, a gaunt deeply lined sea-worn face, a full white-grey beard, tired grave eyes; a small white ruff, a black doublet under a plain dark steel breastplate, a black cap.',
  oquendo: SPA + LIKE + 'Miguel de Oquendo, Basque admiral of the Guipuzcoa squadron, about sixty, a strong weathered face, a grey-black pointed beard and moustache, proud fierce eyes; a white ruff, black doublet with a dark blued steel gorget, bareheaded with short grey hair.',
  leyva: SPA + LIKE + 'Alonso Martinez de Leyva, dashing commander of the land forces, about forty-three, a handsome lean face, dark wavy hair, a dark pointed beard and upturned moustache, bold proud eyes; a white lace ruff, an etched blackened-and-gilt steel half-armour cuirass over a black doublet, a red silk sash, bareheaded.',
};
const ORDER = Object.keys(WHO);
const refPath = () => STYLE_REF_RAW;
// The raws are kept as high-quality webp (a 1024 px PNG is 1.7 MB) so the sources stay in the repository.
const promptOf = (id) => STYLE_NOTE + STYLE + WHO[id];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = () => ({ Authorization: `Bearer ${process.env.OPENAI_API_KEY}` });

async function readProv() {
  try { return JSON.parse(await readFile(PROV, 'utf8')); } catch { return { requests: [] }; }
}
const costOf = (u) => {
  if (!u) return null;
  const d = u.input_tokens_details ?? {};
  const imgIn = d.image_tokens ?? 0;
  const txtIn = d.text_tokens ?? (u.input_tokens ?? 0) - imgIn;
  return +((txtIn * PRICE.textIn + imgIn * PRICE.imageIn + (u.output_tokens ?? 0) * PRICE.imageOut) / 1e6).toFixed(4);
};

function finish(prov) {
  prov.model = MODEL;
  prov.script = 'scripts/generate-armada-portraits.mjs';
  prov.pricingNote = `Estimated from returned token usage at gpt-image-2 list prices per million tokens (${JSON.stringify(PRICE)}); the 2.5 preview has no public price.`;
  prov.requestCount = prov.requests.length;
  prov.totalEstimatedCostUsd = +prov.requests.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0).toFixed(3);
  return prov;
}

async function generate(id, prov) {
  const prompt = promptOf(id);
  const ref = refPath(id);
  const entry = { id, endpoint: ref ? 'images/edits' : 'images/generations', model: MODEL, prompt, reference: ref ? relative(ROOT, ref).replaceAll('\\', '/') : null, size: SIZE, quality: QUALITY, requestedAt: new Date().toISOString(), note: NOTE || undefined };
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      let res;
      if (ref) {
        const form = new FormData();
        form.set('model', MODEL); form.set('prompt', prompt); form.set('size', SIZE); form.set('quality', QUALITY); form.set('n', '1'); form.set('output_format', 'png');
        form.set('image', new Blob([await readFile(ref)], { type: ref.endsWith('.webp') ? 'image/webp' : 'image/jpeg' }), ref.endsWith('.webp') ? 'reference.webp' : 'reference.jpg');
        res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: headers(), body: form });
      } else {
        res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: MODEL, prompt, size: SIZE, quality: QUALITY, n: 1, output_format: 'png' }),
        });
      }
      const j = await res.json();
      if (!res.ok) {
        lastErr = `${res.status} ${j.error?.message}`;
        if (res.status === 429 || res.status >= 500) { await sleep(8000 * (attempt + 1)); continue; }
        break;
      }
      await sharp(Buffer.from(j.data[0].b64_json, 'base64')).webp({ quality: 94, effort: 5 }).toFile(rawPath(id));
      entry.finishedAt = new Date().toISOString();
      entry.usage = j.usage ?? null;
      entry.estimatedCostUsd = costOf(j.usage);
      prov.requests.push(entry);
      await writeFile(PROV, JSON.stringify(finish(prov), null, 2));
      return;
    } catch (e) { lastErr = String(e); await sleep(5000); }
  }
  throw new Error(`${id}: ${lastErr}`);
}

async function convert(id) {
  const png = await readFile(rawPath(id));
  // Busy armour can push a file past the 120 KB budget: step the quality down until it fits.
  const full = sharp(png).resize(768, 768, { kernel: 'lanczos3' });
  let buf;
  for (let q = 84; q >= 70; q -= 2) { buf = await full.clone().webp({ quality: q, effort: 5 }).toBuffer(); if (buf.length < 120_000) break; }
  await writeFile(join(OUT, `portrait_${id}.webp`), buf);
  await sharp(png).resize(192, 192, { kernel: 'lanczos3' }).webp({ quality: 82, effort: 5 }).toFile(join(OUT, `portrait_${id}_sm.webp`));
}

await mkdir(RAW, { recursive: true });
const ids = ORDER.filter((id) => !ONLY.length || ONLY.includes(id));
if (!CONVERT_ONLY) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing (.env)');
  const prov = await readProv();
  const queue = ids.filter((id) => FORCE || !existsSync(rawPath(id)));
  const worker = async () => {
    for (let id; (id = queue.shift()); ) {
      try { await generate(id, prov); console.log('made', id); } catch (e) { console.error(String(e)); }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}
for (const id of ids) if (existsSync(rawPath(id))) await convert(id);
console.log('done');
