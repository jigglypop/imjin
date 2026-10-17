// Lepanto (1571) and Trafalgar (1805) commander portraits (--chapter lepanto|trafalgar), after generate-armada-portraits.mjs: in the same film-still set as generate-commander-portraits.mjs (same model, prompt
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
const SETS_DIR = () => ({ lepanto: 'commanders-lepanto-2026-10-17', trafalgar: 'commanders-trafalgar-2026-10-17' })[process.argv.includes('--chapter') ? process.argv[process.argv.indexOf('--chapter') + 1] : 'lepanto'];
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ENV = [join(ROOT, '.env'), 'C:/dev/imjin/.env'].find((p) => existsSync(p));
if (ENV) process.loadEnvFile(ENV);
const SRC = join(ROOT, 'assets-src', SETS_DIR());
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
  'Shallow depth of field, desaturated filmic grade, subtle 35mm grain. Period practical materials: salt-stained cloth, rubbed iron, worn leather, no luxurious fantasy ornament. ' +
  'No painting or illustration look, no plastic CGI skin, no modern items, no text, no letters, no logo, no border, no frame. Opaque background. ';
const REF_NOTE =
  'The attached picture is the existing casting of this same man: keep his face, age, beard and features recognisable, and redraw him in the film-still look described here, with the costume described here. ';

const STYLE_REF_RAW = join(ROOT, 'assets-src', 'commanders-2026-10-16', 'src', 'chenlin.webp');
const CHAPTER = opt('chapter', 'lepanto');
const SETS = {
  lepanto: {
    dir: 'commanders-lepanto-2026-10-17',
    note: 'behind this man are blurred Mediterranean war galleys of 1571 with lateen sails and long banks of oars, a galley deck and European or Ottoman sailors only, no Asian junks, no Asian soldiers. ',
    who: {
      donjuan: 'Spanish costume of 1571: His face follows his known contemporary portraits. Don Juan of Austria, captain-general of the Holy League, about twenty-four, a young handsome fair face, light brown-blond wavy hair, a thin young moustache and wisp of beard, bright eager eyes; a small white ruff, an etched blackened-and-gilt steel cuirass, a red silk sash, bareheaded.',
      doria: 'Genoese costume of 1571: His face follows his known contemporary portraits. Giovanni Andrea Doria, Genoese admiral, about thirty-releaseyears, a long narrow dark face, short black hair, a dark pointed beard, cool calculating eyes; a small ruff, a black doublet under a dark steel gorget, bareheaded.'.replace('thirty-releaseyears', 'thirty-two'),
      barbarigo: 'Venetian costume of 1571: His face follows his known contemporary portraits. Agostino Barbarigo, Venetian provveditore, about fifty-three, a lean grave face, a long grey beard, steady eyes; a dark crimson Venetian patrician robe over a steel breastplate, a small dark cap.',
      venier: 'Venetian costume of 1571: His face follows his known contemporary portraits. Sebastiano Venier, Venetian captain-general, about seventy-five, a fierce old weathered face, a long full white beard, hard defiant eyes; a steel cuirass over a red doublet, a fur-collared cloak, a dark cap.',
      alipasha: 'Ottoman costume of 1571: His face follows his known contemporary portraits. Muezzinzade Ali Pasha, Kapudan Pasha of the Ottoman fleet, about fifty, a broad dignified face, a full dark beard streaked with grey, grave proud eyes; a large white turban, a rich green-and-gold kaftan over mail, no ruff.',
      uluc: 'Ottoman costume of 1571: Uluc Ali (Occhiali), beylerbey of Algiers, about fifty, a sun-darkened hawkish face, a short grey-black beard, sharp cunning eyes; a red-and-white turban, a dark red kaftan over a mail shirt, no ruff.',
      siroco: 'Ottoman costume of 1571: Mehmed Siroco (Suluk Mehmed Pasha), governor of Alexandria, about fifty-five, a lean weathered face, a grey beard, stern eyes; a white turban, a blue kaftan over mail, no ruff.',
      pertev: 'Ottoman costume of 1571: Pertev Pasha, serdar of the land forces, about sixty, a heavy aged face, a white beard, tired grave eyes; a tall white turban with a plume, an ochre fur-trimmed kaftan, no ruff.',
    },
  },
  trafalgar: {
    dir: 'commanders-trafalgar-2026-10-17',
    note: 'behind this man are blurred ships of the line of 1805 with tiers of gun ports and square sails, a quarterdeck and European sailors only, no Asian junks, no Asian soldiers. The period is 1805, Napoleonic: no ruffs. ',
    who: {
      nelson: 'Royal Navy uniform of 1805: His face follows his known contemporary portraits. Vice-Admiral Horatio Nelson, forty-seven, a thin pale sensitive face, greying sandy hair, a scar over the blind right eye, no beard; a dark blue full-dress vice-admiral coat with gold lace and epaulettes and stars of his orders, a white stock, bareheaded.',
      collingwood: 'Royal Navy uniform of 1805: His face follows his known contemporary portraits. Vice-Admiral Cuthbert Collingwood, fifty-seven, a long serious face, powdered grey hair tied back, no beard, calm steady eyes; a dark blue admiral coat with gold lace, a white stock.',
      hardy: 'Royal Navy uniform of 1805: His face follows his known contemporary portraits. Captain Thomas Masterman Hardy, thirty-six, a very large heavy-jawed fleshy face with a broad nose and small deep-set eyes, thinning light-brown hair, no beard, no hat; a dark blue post-captain coat with gold lace, a white stock.',
      blackwood: 'Royal Navy uniform of 1805: Captain Henry Blackwood, thirty-five, a lean energetic face, dark hair, side-whiskers, no beard; a dark blue captain coat, a white stock, a bicorne hat.',
      villeneuve: 'French Imperial Navy uniform of 1805: His face follows his known contemporary portraits. Vice-amiral Pierre-Charles Villeneuve, forty-two, a long anxious face, dark hair, no beard, worried eyes; a dark blue French admiral coat with heavy gold oak-leaf embroidery, a white stock.',
      gravina: 'Spanish Navy uniform of 1805: His face follows his known contemporary portraits. Admiral Federico Gravina, forty-nine, a dignified olive face, powdered grey hair, no beard; a dark blue Spanish admiral coat with red facings and gold lace, a white stock.',
      lucas: 'French Imperial Navy uniform of 1805: Captain Jean-Jacques Lucas, forty-one, a small wiry man with a narrow sharp-featured face, hooked nose, receding black hair with grey at the temples, thin lips, clean-shaven, no hat; a dark blue French captain coat with gold.',
      churruca: 'Spanish Navy uniform of 1805: His face follows his known contemporary portraits. Brigadier Cosme Damian Churruca, forty-four, a fine intelligent face, dark hair, no beard; a dark blue Spanish captain coat with red facings, a white stock.',
      jervis: 'Royal Navy uniform of 1797: His face follows his known contemporary portraits. Admiral Sir John Jervis, sixty-two, a heavy square stern face with a strong jaw and thick dark eyebrows, powdered white hair, no beard; a dark blue admiral full-dress coat with gold lace, a white stock, bareheaded.',
      calder: 'Royal Navy uniform of 1805: His face follows his known contemporary portraits. Vice-Admiral Sir Robert Calder, sixty, a broad fleshy face, powdered grey hair, no beard, a guarded expression; a dark blue vice-admiral coat with gold lace, a white stock.',
      brueys: 'French Republican Navy uniform of 1798: His face follows his known contemporary portraits. Vice-amiral François-Paul Brueys, forty-five, a long thin face, dark hair tied back, no beard, a weary look; a dark blue French admiral coat with gold embroidery and a tricolour sash, a white stock.',
      cordoba: 'Spanish Navy uniform of 1797: Teniente general José de Córdoba y Ramos, about sixty, a lined olive face, powdered white hair, no beard, a hesitant look; a dark blue Spanish admiral coat with red facings and gold lace, a white stock.',
    },
  },
};
const SET = SETS[CHAPTER];
const STYLE_NOTE =
  'The attached picture is a finished portrait from the same film: match its look exactly (framing, light, grade, grain, materials), but this is a different man from a different nation: do not reuse his face, beard or costume, and do not reuse his background ships or crew: ' + SET.note;
const WHO = SET.who;
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
  prov.script = 'scripts/generate-chapter-portraits.mjs --chapter ' + CHAPTER;
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
  if (args.includes('--provider=gemini')) {
    // Gemini's image model with the same style reference, while the OpenAI images API is out of credit.
    const { geminiImage, geminiModel } = await import('./gemini-image.mjs');
    const refPng = ref ? await sharp(await readFile(ref)).png().toBuffer() : null;
    await sharp(await geminiImage(prompt, { aspect: '1:1', image: refPng })).webp({ quality: 94, effort: 5 }).toFile(rawPath(id));
    Object.assign(entry, { endpoint: 'gemini generateContent', model: geminiModel(), finishedAt: new Date().toISOString(), estimatedCostUsd: 0.04 });
    prov.requests.push(entry);
    await writeFile(PROV, JSON.stringify(finish(prov), null, 2));
    return;
  }
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
