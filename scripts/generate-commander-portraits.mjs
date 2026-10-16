// Commander portraits, one consistent film-still set (gpt-image 2.5). Resumable: an id whose raw webp exists in
// assets-src/commanders-2026-10-16/src/ is not generated again unless --force.
//
//   node scripts/generate-commander-portraits.mjs                 generate what is missing, convert, write provenance
//   node scripts/generate-commander-portraits.mjs --only yi,won   some ids
//   node scripts/generate-commander-portraits.mjs --force         regenerate the chosen ids
//   node scripts/generate-commander-portraits.mjs --convert       only (re)cut the webp files from the raws
//   node scripts/generate-commander-portraits.mjs --note "why"    stored with the request (use when redoing one)
//
// Where public/ui/portraits/portrait_<id>.jpg exists it goes to the images edit endpoint as the face reference;
// the others come from text. Output: portrait_<id>.webp (768) and portrait_<id>_sm.webp (192).
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ENV = [join(ROOT, '.env'), 'C:/dev/imjin/.env'].find((p) => existsSync(p));
if (ENV) process.loadEnvFile(ENV);
const SRC = join(ROOT, 'assets-src', 'commanders-2026-10-16');
const RAW = join(SRC, 'src');
const OUT = join(ROOT, 'public', 'ui', 'portraits');
const PROV = join(SRC, 'provenance.json');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const FORCE = args.includes('--force');
const CONVERT_ONLY = args.includes('--convert');
const ONLY = opt('only', '').split(',').filter(Boolean);
const NOTE = opt('note', '');
const MODEL = 'gpt-image-2.5-sunburst';
const SIZE = '1024x1024';
const QUALITY = 'high';
// USD per million tokens, the gpt-image-2 list prices; the 2.5 preview is not priced publicly, so totals are estimates.
const PRICE = { textIn: 5, imageIn: 8, imageOut: 30 };

const STYLE =
  'Square live-action period naval war film still, helmet-to-upper-chest portrait of one man, face centred and large enough to read at 60 pixels, ' +
  'complete headgear with a little margin above it. Weathered sun-and-salt skin with pores and uneven stubble, believable asymmetrical face, understated expression. ' +
  'Cool overcast side light from one side with a faint warm firelight rim on the other, sea haze and gunpowder smoke, background of blurred dark timber rails, rigging and blue-grey water. ' +
  'Shallow depth of field, desaturated filmic grade, subtle 35mm grain. Late-sixteenth-century practical materials: salt-stained cloth, rubbed iron, worn lacquer, no luxurious fantasy ornament. ' +
  'Original cast face, not any real actor. No painting or illustration look, no plastic CGI skin, no modern items, no text, no letters, no logo, no border, no frame. ' +
  'No rising sun flag, no sunburst or radiating rays and no red sun disc anywhere. Opaque background. ';
const REF_NOTE =
  'The attached picture is the existing casting of this same man: keep his face, age, beard and features recognisable, and redraw him in the film-still look described here, with the costume described here. ';

const JOSEON = 'Joseon Korean costume: ';
const WHO = {
  yi: JOSEON + 'Yi Sun-sin, about fifty, long lean oval face, deeply observant tired eyes, thin moustache and a long narrow beard streaked grey, calm resolve; low iron tugu helmet with a short red plume over a cloth cap, oxblood cloth dujeong brigandine with visible rivets.',
  won: JOSEON + 'Won Gyun, early fifties, heavyset, broad face, thick irregular black beard, tired stubborn expression; wide black felt jeonlip military hat with a small red plume, salt-worn dark-blue brigandine.',
  eokgi: JOSEON + 'Yi Eok-gi, about thirty, narrow refined face, fine moustache, alert reserved eyes; low iron tugu helmet with a red plume, deep-teal cloth brigandine.',
  kwon: JOSEON + 'Gwon Jun, Suncheon magistrate in his forties, scholarly oval face, neat short black beard, quiet intelligent eyes; black jeonlip military hat with a hat cord of amber beads, subdued dark-green cloth brigandine over a blue cheolik coat.',
  eo: JOSEON + 'Eo Yeong-dam, Gwangyang magistrate and veteran pilot, about sixty, deeply weathered thin face, short grey beard, sharp thoughtful eyes squinting as if reading the water; worn black jeonlip hat, faded brown-grey cheolik military coat with a leather belt, no armour.',
  jeongun: JOSEON + 'Jeong Un, Nokdo commander in his late forties, rugged angular face, short coarse beard, a faint old healed scar on the cheek, fierce intense eyes; faded wine-red brigandine and a low iron tugu helmet.',
  anwi: JOSEON + 'An Wi, Geoje magistrate in his forties, broad cheekbones, compact black beard, resilient concentrated expression, sweat and soot on the face; low iron helmet with a modest red plume, worn charcoal brigandine.',
  baeseol: JOSEON + 'Bae Seol, Gyeongsang right naval commander, about forty-five, long pale tense face, thin moustache, wary evasive eyes and a drawn mouth; black jeonlip hat with a plume, dark-blue brigandine, clean and less battered than the others.',
  songhuirip: JOSEON + 'Song Hui-rip, staff officer, about forty, square strong jaw, short black beard, bruised and soot-stained face, resolute shouting expression; plain iron helmet with a red tassel, brown cloth brigandine.',
  iwan: JOSEON + "Yi Wan, Yi Sun-sin's nephew, about thirty, young firm face, a light thin moustache, composed steady eyes; iron tugu helmet with a red plume, dark-blue brigandine, a little dried blood on the sleeve.",
  kimwan: JOSEON + 'Kim Wan, Sado garrison commander, about forty, broad weathered face, short thick beard, bold direct gaze; jeonlip hat with a small plume, dark-brown brigandine.',
  nadaeyong: JOSEON + 'Na Dae-yong, the officer who built the turtle ship, about forty, a thoughtful craftsman-officer, narrow clever face, short trimmed beard, calloused attentive eyes; black jeonlip hat, indigo cheolik coat with a leather tool-pouch strap across the chest and a little sawdust on the shoulder, no armour.',
  iyeongnam: JOSEON + 'Yi Yeong-nam, Yulpo commander, about forty, lean tanned earnest face, light moustache and short beard, resolute eyes; iron tugu helmet with a red plume, dull-green brigandine.',
  chenlin: 'Late-Ming Chinese costume: Chen Lin, naval commissioner in his fifties, broad imposing face, full long dark beard, arrogant heavy-lidded eyes and a raised chin; rounded Ming steel helmet with a thick red tassel and a short back flap, brick-red cotton brigandine with rows of brass studs, a dark red official cloak collar.',
  deng: 'Late-Ming Chinese costume: Deng Zilong, over seventy, lean deeply lined face, a long white beard, fierce unbowed eyes; rounded Ming steel helmet with a red tassel, weathered rust-red brigandine over pale grey cloth.',
  shimazu: 'Sengoku Japanese costume: Shimazu Yoshihiro, Satsuma lord in his late fifties, strong battle-hardened face, grey moustache and short beard, heavy-lidded fearless eyes; black iron kabuto with a plain low crest, black lacquer lamellar cuirass under an off-white jinbaori surcoat bearing a small black cross-in-circle mon, the same mon on a white banner blurred behind.',
  konishi: "Sengoku Japanese costume: Konishi Yukinaga, about forty, thoughtful long face, small thin moustache, shrewd measured eyes, a merchant's calculating calm; black kabuto with a restrained crest, charcoal-purple lacquer cuirass, a small plain wooden cross hanging at the collar, a banner with a plain paulownia-style mon blurred behind.",
  wakisaka: 'Sengoku Japanese costume: Wakisaka Yasuharu, naval daimyo in his late thirties, sharp lean face, thin moustache, cool confident eyes; dark blue-black lacquer cuirass with modest gold detail, kabuto with a modest gilded crest, entirely inside the frame.',
  kurushima: 'Sengoku Japanese costume: Kurushima Michifusa, Murakami-line pirate admiral in his thirties, sun-browned broad face, sparse facial hair, tense attentive eyes; dark charcoal and green lacquered armour, kabuto with a modest low crest, a rope-and-sea-salt look.',
  michiyuki: 'Sengoku Japanese costume: Kurushima Michiyuki, Murakami-line pirate lord and the elder brother of Kurushima Michifusa, late thirties, the same broad sun-browned family face and jaw as his younger brother but heavier and older, short beard, confident proud eyes; dark indigo and brown lacquered armour, kabuto with a modest low crest.',
  todo: 'Sengoku Japanese costume: Todo Takatora, very tall and broad, about forty, long imposing face, short rough beard, serious thoughtful expression, his head close to the top of the frame; black lacquered cuirass, kabuto with a narrow tall pointed crest and large segmented shikoro neck guard, a banner with a plain ivy-leaf mon blurred behind.',
  kato: 'Sengoku Japanese costume: Kato Yoshiaki, about thirty, angular clean-shaven face, steady sharp eyes; blue-black lacquered cuirass, kabuto with a narrow long curved horn-like crest.',
  kuki: 'Sengoku Japanese costume: Kuki Yoshitaka, Kuki pirate navy lord in his fifties, windburnt cheeks, salt-and-pepper short beard, narrow watchful eyes; worn dark-red lacquered cuirass, black kabuto with a restrained crescent crest, wide shikoro, a plain white banner with a small dark Kuki mon blurred behind.',
  admiral: JOSEON + 'a nameless naval captain, forty-five, short irregular black beard, serious mature face; low iron tugu helmet with a red plume, dark-indigo cloth brigandine.',
  japan: 'Sengoku Japanese costume: a nameless ship captain in his thirties, lean salt-weathered face, short sparse moustache, hard attentive eyes; broad conical black iron jingasa hat, practical black lacquer cuirass with segmented shoulder guards.',
  tachibana: 'Sengoku Japanese costume: Tachibana Muneshige, about thirty, young famed general, handsome hard lean face, faint moustache, fearless clear eyes; black lacquer cuirass with lamellar shoulder guards, a kabuto with a modest gilded crescent crest, the whole crest entirely inside the frame with margin above it.',
};
// Existing castings used as the face reference; michiyuki takes his brother's.
const REF = { admiral: 'admiral', japan: 'japan', yi: 'yi', won: 'won', eokgi: 'eokgi', kwon: 'kwon', eo: 'eo', jeongun: 'jeongun', anwi: 'anwi', chenlin: 'chenlin', deng: 'deng', shimazu: 'shimazu', konishi: 'konishi', wakisaka: 'wakisaka', kurushima: 'kurushima', michiyuki: 'kurushima', todo: 'todo', kato: 'kato', kuki: 'kuki' };
const ORDER = ['admiral', 'japan', 'yi', 'won', 'eokgi', 'kwon', 'eo', 'jeongun', 'anwi', 'baeseol', 'songhuirip', 'iwan', 'kimwan', 'nadaeyong', 'iyeongnam', 'chenlin', 'deng', 'shimazu', 'konishi', 'wakisaka', 'kurushima', 'michiyuki', 'todo', 'kato', 'kuki', 'tachibana'];

const refPath = (id) => (REF[id] ? join(OUT, `portrait_${REF[id]}.jpg`) : null);
// The raws are kept as high-quality webp (a 1024 px PNG is 1.7 MB) so the sources stay in the repository.
const rawPath = (id) => join(RAW, `${id}.webp`);
const promptOf = (id) =>
  (refPath(id) ? REF_NOTE + (id === 'michiyuki' ? 'The reference is his younger brother; make them clearly brothers, not the same man. ' : '') : '') + STYLE + WHO[id];
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
  prov.script = 'scripts/generate-commander-portraits.mjs';
  prov.pricingNote = `Estimated from returned token usage at gpt-image-2 list prices per million tokens (${JSON.stringify(PRICE)}); the 2.5 preview has no public price.`;
  prov.requestCount = prov.requests.length;
  prov.totalEstimatedCostUsd = +prov.requests.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0).toFixed(3);
  return prov;
}

async function generate(id, prov) {
  const prompt = promptOf(id);
  const ref = refPath(id);
  const entry = { id, endpoint: ref ? 'images/edits' : 'images/generations', model: MODEL, prompt, reference: ref ? `public/ui/portraits/portrait_${REF[id]}.jpg` : null, size: SIZE, quality: QUALITY, requestedAt: new Date().toISOString(), note: NOTE || undefined };
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      let res;
      if (ref) {
        const form = new FormData();
        form.set('model', MODEL); form.set('prompt', prompt); form.set('size', SIZE); form.set('quality', QUALITY); form.set('n', '1'); form.set('output_format', 'png');
        form.set('image', new Blob([await readFile(ref)], { type: 'image/jpeg' }), 'reference.jpg');
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
