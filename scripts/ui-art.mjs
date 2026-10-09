// UI art generator (gpt-image-2). Re-runnable: raw PNGs are cached in assets-src/ui-art/ (gitignored)
// and never regenerated unless --force. Output: public/ui/art/*.webp + manifest.json.
//
//   node scripts/ui-art.mjs                    generate everything missing, then convert
//   node scripts/ui-art.mjs --only hansan      one id (hero_wide, mode_history, emblem_ming, hansan, ...)
//   node scripts/ui-art.mjs --only mode        every id that starts with the text
//   node scripts/ui-art.mjs --force            regenerate even if cached
//   node scripts/ui-art.mjs --convert          skip the API, only (re)convert cached raws
//   node scripts/ui-art.mjs --jobs 6           parallel API calls (default 5)
//   node scripts/ui-art.mjs --model gpt-image-2.5-...   fall back to another model
//
// Items with two candidates (hero, mode cards) are generated as <id>.A.png / <id>.B.png; PICKS says which
// one ships. Change a pick after looking at both raws, then run with --convert.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ENV = [join(ROOT, '.env'), '/Users/yeomdonghwan/Desktop/imjin/.env'].find((p) => existsSync(p));
if (ENV) process.loadEnvFile(ENV);
const RAW = join(ROOT, 'assets-src', 'ui-art');
const OUT = join(ROOT, 'public', 'ui', 'art');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ONLY = opt('only', '');
const FORCE = flag('force');
const CONVERT_ONLY = flag('convert');
const JOBS = Number(opt('jobs', 5));
const MODELS = [opt('model', 'gpt-image-2'), 'gpt-image-2.5'];

// Which candidate ships. A or B, chosen by eye.
const PICKS = {
  menu_hero_wide: 'A',
  menu_hero_tall: 'B',
  mode_history: 'A',
  mode_campaign: 'A',
  mode_skirmish: 'A',
  mode_online: 'A',
};

// ---------- style ----------
const FILM =
  'Cinematic film still in the grounded, painterly-realistic look of the Korean films Roaring Currents (Myeongnyang, 2014) and Noryang: Deadly Sea (2023). ' +
  'Historically grounded 16th-century East Asian naval warfare, the Imjin War (1592-1598). ' +
  'Joseon panokseon: broad flat-bottomed wooden warships with a continuous wall of vertical plank shields around the upper deck, a roofed command pavilion, two masts with tan hemp sails, many oars, blue, red and white military banners. ' +
  'Korean turtle ship (geobukseon): low hull entirely covered by an armored roof studded with iron spikes, a carved dragon head at the bow breathing smoke. ' +
  'Japanese atakebune and sekibune: boxy black-lacquered and white-plastered fortress hulls with loopholes, straw-colored sails, tall white nobori banners with plain dark crests, no readable lettering. ';
// Japanese sides are shown by clan mon on plain nobori only. A red sun disc or radiating rays reads as the Rising Sun
// Flag (旭日旗), which is deeply offensive in Korea, so every prompt carries this and no emblem may use a sunburst.
const NO_SUN =
  ' No rising sun flag, no sunburst rays, no radiating stripes, no red sun disc on any flag or banner; Japanese banners are plain white or black nobori with a small dark clan mon (crest) only.';
const CLEAN = NO_SUN +
  ' Premium, refined, high-end look: soft atmospheric depth, restrained desaturated palette, fine film grain, shallow haze. ' +
  'Absolutely no text, no letters, no Chinese characters, no Korean script, no numbers, no logos, no watermark, no borders, no frames, no UI.';
// Light, airy grade for the artwork that sits under white glass panels.
// Near-white key art: the menu background itself, so white glass cards sit on it without a dark ground.
const HIGHKEY =
  ' High-key grade: the whole frame is bright, pearly white and pale grey-blue like a sumi-e wash on white paper, luminance mostly above 80 percent, no dark areas, no black, ships as soft muted grey-brown silhouettes dissolving into white fog, restrained and desaturated.';
const AIRY =
  ' Overall tonality is airy and relatively bright with luminous pale mist, lifted shadows and pearly sky so that white translucent panels laid over it stay legible.';
const DARK =
  ' Overall tonality is moody and low-key with deep blue-black water, but with a readable mid-tone and a few glowing highlights, never pure black.';

// ---------- items ----------
const items = [];
const add = (it) => items.push(it);

add({
  id: 'menu_hero_wide', kind: 'hero', variants: ['A', 'B'], gen: [2400, 1344], out: [2400, 1350], small: [1200, 675], q: 80,
  prompt:
    FILM + 'Main-menu key art, ultra-wide landscape. Early morning on the southern Korean sea, thick pearly mist. In the right two thirds of the frame a long line of Joseon panokseon ' +
    'under oar and sail with a single turtle ship in the lead, bronze cannon smoke drifting, spray from the bows, facing a distant dense fleet of Japanese atakebune dissolving into the haze on the far right horizon. ' +
    'Rugged green islands silhouetted in the mist. The LEFT third of the frame is calm, open, softly misted sea and pale sky, deliberately empty and clean negative space for a title and menu.' + AIRY + HIGHKEY + CLEAN,
});
add({
  id: 'menu_hero_tall', kind: 'hero', variants: ['A', 'B'], gen: [1088, 1920], out: [1080, 1920], q: 78,
  prompt:
    FILM + 'Main-menu key art, tall vertical portrait composition for a phone. Dawn on the southern Korean sea in heavy mist. The bottom 45 percent of the frame: a Joseon panokseon line and a turtle ship ' +
    'advancing toward the viewer-left, spray and gunpowder smoke, a distant Japanese atakebune fleet fading into fog behind them. The TOP 55 percent of the frame is soft luminous pale sky and mist with a faint pale sun, ' +
    'calm and almost empty, deliberately clean negative space for a title and menu buttons.' + AIRY + HIGHKEY + CLEAN,
});

const MODES = {
  mode_history:
    'Mode card art "historic battle": a famous naval battle moment at the strait of Myeongnyang. Admiral Yi Sun-sin\'s lone flagship panokseon in the foreground, armored commander standing under a blue command flag on the pavilion, ' +
    'surrounded by a swarm of Japanese ships, whirlpool currents churning white around the hulls, arrows and smoke. Dramatic overcast light.',
  mode_campaign:
    'Mode card art "faction campaign": a strategic war table seen from above at an angle. A large aged hand-painted map of the Korean peninsula and the southern sea on the table, with small carved wooden warship miniatures ' +
    'and cloth flags of three factions: Joseon (blue and white), Japan (plain white nobori with a small black clan crest), Ming China (yellow and red). Brass compass, ink stone, brushes, a candle glow, a general\'s armored hand moving a ship token. Warm low light. No readable writing on the map.',
  mode_skirmish:
    'Mode card art "contested harbor skirmish": a fight at a fortified harbor. A wooden palisade fort with a gate tower on a rocky shore firing matchlocks and cannons, a Japanese harbor mooring full of ships, ' +
    'Joseon panokseon and a turtle ship attacking in the foreground with cannon smoke, a captured flag being contested on the fort wall. Dynamic, afternoon sun through smoke.',
  mode_online:
    'Mode card art "online duel": two fleets facing each other across open water, symmetrical wide composition. On the left a Joseon fleet of panokseon and a turtle ship under blue banners, on the right a Japanese fleet of atakebune and sekibune under white nobori banners, ' +
    'a stretch of sparkling choppy sea between them, first cannon shots and smoke, tense stillness before the clash, low sun on the horizon.',
};
for (const [id, p] of Object.entries(MODES)) {
  add({ id, kind: 'mode', variants: ['A', 'B'], gen: [1536, 1024], out: [1200, 800], small: [600, 400], q: 78, prompt: FILM + p + AIRY + CLEAN });
}

const EMBLEM_STYLE =
  ' Clean modern seal / crest design, flat vector-like illustration with subtle depth, perfectly centered, a single circular badge filling about 88 percent of the square, ' +
  'bold simple shapes that stay legible at 32 pixels, refined thin gold rim. No sun disc, no rays, no sunburst. The area outside the circular badge is a pure flat white background (#FFFFFF) with nothing else, no shadow, no glow. ' +
  'No text, no letters, no Chinese characters, no numbers.';
add({
  id: 'emblem_joseon', kind: 'emblem', variants: [''], gen: [1024, 1024], out: [512, 512], small: [128, 128],
  prompt:
    'Emblem of the Joseon navy: a deep indigo-navy circular badge with a white stylized panokseon ship silhouette (two sails, plank-shield hull) riding on abstract stylized white waves, a calm pale moon-like circle of white behind the sails, ' +
    'accents of Joseon blue and white with a little red.' + EMBLEM_STYLE,
});
add({
  id: 'emblem_japan', kind: 'emblem', variants: [''], gen: [1024, 1024], out: [512, 512], small: [128, 128],
  prompt:
    'Emblem of the Japanese Sengoku navy: a plain matte black circular badge with one large bold gold Toyotomi paulownia crest (go-shichi no kiri: three leaves topped by flower spikes of five, seven and five blossoms) centered, ' +
    'thin gold rim, nothing else on the badge: no rays, no sun disc, no red stripes, no banners, no waves.' + EMBLEM_STYLE,
});
add({
  id: 'emblem_ming', kind: 'emblem', variants: [''], gen: [1024, 1024], out: [512, 512], small: [128, 128],
  prompt:
    'Emblem of the Ming dynasty navy: an imperial yellow and vermilion circular badge with a bold stylized coiled Chinese dragon medallion in the center, cloud scrolls, ' +
    'imperial gold, vermilion and deep teal accents.' + EMBLEM_STYLE,
});

// Scenario loading backgrounds. Scene text follows src/sim/scenarios.ts (place, date, season, description).
const SCENES = {
  okpo: {
    tone: AIRY,
    p: 'Okpo Bay, Geoje island, 7 May 1592, late spring afternoon, rough sea. The first sortie of the Joseon navy. A bay with a small fishing village burning with smoke columns on the shore, about fifty Japanese ships anchored in the cove ' +
      'looting the village, while a disciplined line of Joseon panokseon enters the bay under calm command, cannon flashes and smoke, choppy blue-green water.',
  },
  sacheon: {
    tone: AIRY,
    p: 'Sacheon harbor quay, 29 May 1592, early summer, bright day, the tide rising. A Japanese stronghold on a hill above a small wharf with moored ships and matchlock gunmen on the slope. ' +
      'For the first time in history a Joseon turtle ship surges toward the quay, dragon head belching smoke, spiked armored roof, panokseon following behind, rising tide.',
  },
  dangpo: {
    tone: AIRY,
    p: 'Dangpo anchorage near Tongyeong, 2 June 1592, summer afternoon. About twenty Japanese ships moored at a pier; a tall multi-storey Japanese flagship with a red parasol on the upper deck. ' +
      'A Joseon turtle ship rams the flagship while panokseon fire cannons, arrows fly, wooden splinters and smoke.',
  },
  hansan: {
    tone: AIRY,
    p: 'Hansan Island open sea off the Gyeonnaeryang strait, 8 July 1592, summer afternoon. The crane-wing formation (hak-ik-jin): a huge Joseon fleet of panokseon arranged in a crescent curving like the outspread wings of a crane, ' +
      'enclosing a crowd of Japanese atakebune in open water, cannon smoke, burning Japanese ships, green islets beyond.',
  },
  angolpo: {
    tone: AIRY,
    p: 'Angolpo, Jinhae, 10 July 1592, overcast summer sky. A narrow shallow inlet where Japanese ships are packed deep inside the cove beneath shore batteries; Joseon panokseon take turns firing cannons at the cove mouth then withdrawing. ' +
      'Grey overcast sky, sheets of smoke, steep wooded hills.',
  },
  busan: {
    tone: AIRY,
    p: 'Busanpo harbor, 1 September 1592, autumn day. A vast Japanese fleet moored in dense rows in the harbor of the enemy home base, hundreds of masts and banners along the shore under tiled-roof fortifications and wooden palisades. ' +
      'Joseon panokseon column storms into the harbor in a long line, burning Japanese ships billow smoke, golden autumn light.',
  },
  chilcheon: {
    tone: DARK,
    p: 'Chilcheonryang strait, Geoje, 16 July 1597, the hour before dawn, a night defeat. Dark water, a Joseon fleet at anchor with lanterns snuffed, hundreds of Japanese ships closing in from all sides in the darkness with torches, ' +
      'fire arrows arcing, several Joseon panokseon already burning and sinking, orange fire reflections on black water. Tragic, desperate mood.',
  },
  myeongnyang: {
    tone: AIRY,
    p: 'Myeongnyang strait (Uldolmok), 16 September 1597, autumn, overcast. A very narrow strait between steep hills with violent whirlpool currents and white water racing through. A single Joseon flagship panokseon stands alone in the foreground ' +
      'facing a swarm of one hundred thirty Japanese ships crowding the narrows, some spun round by the whirlpools, grey light, determined heroic atmosphere.',
  },
  noryang: {
    tone: DARK,
    p: 'Noryang strait near Gwaneumpo, 19 November 1598, the last night of the war, before dawn, winter. A large night battle lit by fires: burning ships, torches, fire arrows and cannon flashes illuminating Joseon, Ming and Japanese warships ' +
      'in a narrow strait between dark hills, orange flames reflected on black water, embers in the smoky air, epic and solemn.',
  },
};
for (const [id, s] of Object.entries(SCENES)) {
  add({ id, kind: 'loading', variants: [''], gen: [1632, 912], out: [1600, 900], small: [800, 450], q: 72, prompt: FILM + s.p + s.tone + ' Leave the center-bottom area a little calmer for a loading bar.' + CLEAN });
}

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rawPath = (it, v) => join(RAW, `${it.id}${v ? '.' + v : ''}.png`);
const sizeStr = (it) => `${it.gen[0]}x${it.gen[1]}`;

async function generate(it, v) {
  const path = rawPath(it, v);
  if (!FORCE && existsSync(path)) return 'cached';
  let prompt = it.prompt;
  if (v === 'B') prompt += ' Alternative composition: change the camera angle and arrangement noticeably from the obvious first idea.';
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const model of MODELS) {
      try {
        const res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: JSON.stringify({ model, prompt, size: sizeStr(it), quality: 'high', n: 1, output_format: 'png' }),
        });
        const j = await res.json();
        if (!res.ok) {
          lastErr = `${model} ${res.status} ${j.error?.message}`;
          if (res.status === 429 || res.status >= 500) { await sleep(8000 * (attempt + 1)); break; }
          continue; // 4xx: try the next model
        }
        await writeFile(path, Buffer.from(j.data[0].b64_json, 'base64'));
        return model;
      } catch (e) { lastErr = String(e); await sleep(5000); break; }
    }
  }
  throw new Error(`${it.id}${v}: ${lastErr}`);
}

// Emblem: remove the flat white backdrop connected to the image border, keep inner whites.
async function matteEmblem(buf, size) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const dist = (i) => Math.max(255 - data[i], 255 - data[i + 1], 255 - data[i + 2]);
  const bg = new Uint8Array(w * h);
  const stack = [];
  const T = 14;
  const push = (x, y) => { const p = y * w + x; if (!bg[p] && dist(p * 4) <= T) { bg[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop(); const x = p % w, y = (p / w) | 0;
    if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
  }
  // alpha: 0 in bg, ramp on the first ring of pixels next to bg (anti-aliased rim), 255 elsewhere
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (bg[p]) { data[i + 3] = 0; continue; }
    const x = p % w, y = (p / w) | 0;
    const nearBg = (x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (y > 0 && bg[p - w]) || (y < h - 1 && bg[p + w]);
    if (nearBg) {
      const d = dist(i); // 0 = white .. high = colored
      const a = Math.min(255, Math.round((d / 90) * 255));
      data[i + 3] = a;
      if (a > 0 && a < 255) { // un-premultiply the white fringe
        for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - 255 * (1 - a / 255)) / (a / 255))));
      }
    }
  }
  // crop to content bounds, pad square, resize
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let p = 0; p < w * h; p++) if (data[p * 4 + 3] > 8) { const x = p % w, y = (p / w) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const cw = maxX - minX + 1, ch = maxY - minY + 1, side = Math.round(Math.max(cw, ch) * 1.04);
  // sharp applies resize before extend inside one pipeline, so pad first and resize in a second pass
  const padded = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: cw, height: ch })
    .extend({ top: Math.floor((side - ch) / 2), bottom: Math.ceil((side - ch) / 2), left: Math.floor((side - cw) / 2), right: Math.ceil((side - cw) / 2), background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  return sharp(padded).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
}

async function convert(it, manifest) {
  const v = it.variants.length > 1 ? PICKS[it.id] || 'A' : it.variants[0];
  const src = rawPath(it, v);
  if (!existsSync(src)) {
    // Raws are not kept in git. A missing small copy can still be cut from the shipped full-size file.
    const main = join(OUT, `${it.kind === 'loading' ? 'loading_' : ''}${it.id}.webp`);
    const smallName = `${it.kind === 'loading' ? 'loading_' : ''}${it.id}_sm.webp`;
    if (it.small && existsSync(main) && !existsSync(join(OUT, smallName))) {
      const sm = await sharp(main).resize(it.small[0], it.small[1], { fit: 'cover', kernel: 'lanczos3' }).webp(it.kind === 'emblem' ? { quality: 88, alphaQuality: 100 } : { quality: it.q - 2, effort: 5 }).toBuffer();
      await writeFile(join(OUT, smallName), sm);
      if (manifest[it.id]) Object.assign(manifest[it.id], { small: smallName, smallSize: it.small, smallBytes: sm.length });
      return console.log(`  cut ${smallName} from the shipped file`);
    }
    return console.log(`  skip ${it.id} (no raw)`);
  }
  const buf = await readFile(src);
  const files = {};
  const prefix = it.kind === 'loading' ? 'loading_' : '';
  if (it.kind === 'emblem') {
    const png = await matteEmblem(buf, it.out[0]);
    await writeFile(join(OUT, `${it.id}.webp`), await sharp(png).webp({ quality: 88, alphaQuality: 100 }).toBuffer());
    files.file = `${it.id}.webp`;
    files.size = it.out;
    if (it.small) { // badges are drawn at 30-60 px: a 128 px copy keeps them cheap
      const sm = await sharp(png).resize(it.small[0], it.small[1], { kernel: 'lanczos3' }).webp({ quality: 88, alphaQuality: 100 }).toBuffer();
      await writeFile(join(OUT, `${it.id}_sm.webp`), sm);
      files.small = `${it.id}_sm.webp`; files.smallSize = it.small; files.smallBytes = sm.length;
    }
  } else {
    const main = await sharp(buf).resize(it.out[0], it.out[1], { fit: 'cover', kernel: 'lanczos3' }).webp({ quality: it.q, effort: 5 }).toBuffer();
    await writeFile(join(OUT, `${prefix}${it.id}.webp`), main);
    files.file = `${prefix}${it.id}.webp`; files.size = it.out; files.bytes = main.length;
    if (it.small) {
      const sm = await sharp(buf).resize(it.small[0], it.small[1], { fit: 'cover', kernel: 'lanczos3' }).webp({ quality: it.q - 2, effort: 5 }).toBuffer();
      await writeFile(join(OUT, `${prefix}${it.id}_sm.webp`), sm);
      files.small = `${prefix}${it.id}_sm.webp`; files.smallSize = it.small; files.smallBytes = sm.length;
    }
  }
  manifest[it.id] = { kind: it.kind, ...files, prompt: it.prompt, model: MODELS[0], generated: sizeStr(it), ...(it.variants.length > 1 ? { pick: v } : {}) };
}

// ---------- main ----------
await mkdir(RAW, { recursive: true });
await mkdir(OUT, { recursive: true });
const selected = items.filter((it) => !ONLY || it.id.startsWith(ONLY));
if (!selected.length) { console.error('no item matches --only', ONLY); process.exit(1); }

if (!CONVERT_ONLY) {
  if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY missing'); process.exit(1); }
  const jobs = selected.flatMap((it) => it.variants.map((v) => [it, v]));
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [it, v] = jobs[next++];
      const t = Date.now();
      try {
        const r = await generate(it, v);
        console.log(`${r === 'cached' ? 'cached ' : 'made   '} ${it.id}${v ? '.' + v : ''} ${r !== 'cached' ? ((Date.now() - t) / 1000).toFixed(0) + 's ' + r : ''}`);
      } catch (e) { console.error('FAILED', e.message); }
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));
}

// manifest covers every item (merge with what was converted earlier when --only is used)
let manifest = {};
const mpath = join(OUT, 'manifest.json');
try { manifest = JSON.parse(await readFile(mpath, 'utf8')).items || {}; } catch {}
for (const it of selected) await convert(it, manifest);
const ordered = Object.fromEntries(items.filter((it) => manifest[it.id]).map((it) => [it.id, manifest[it.id]]));
await writeFile(mpath, JSON.stringify({ model: MODELS[0], note: 'Generated by scripts/ui-art.mjs. No text in any image.', items: ordered }, null, 2));
console.log(`manifest: ${Object.keys(ordered).length} items`);

// Contact sheet of the shipped files (for review): --contact <out.png>
const contactOut = opt('contact', '');
if (contactOut) {
  const cell = 400, h = 225, gap = 10, cols = 4;
  const names = Object.values(ordered).map((m) => [m.file, m.kind === 'emblem']);
  const rows = Math.ceil(names.length / cols);
  const comps = [];
  for (const [i, [f, emb]] of names.entries()) {
    const left = gap + (i % cols) * (cell + gap), top = gap + Math.floor(i / cols) * (h + gap);
    const img = emb
      ? await sharp({ create: { width: cell, height: h, channels: 3, background: '#e9eef3' } }).composite([{ input: await sharp(join(OUT, f)).resize(h - 20, h - 20).png().toBuffer(), gravity: 'centre' }]).png().toBuffer()
      : await sharp(join(OUT, f)).resize(cell, h, { fit: 'cover' }).png().toBuffer();
    comps.push({ input: img, left, top });
  }
  await sharp({ create: { width: gap + cols * (cell + gap), height: gap + rows * (h + gap), channels: 3, background: '#ffffff' } }).composite(comps).png().toFile(contactOut);
  console.log('contact sheet', contactOut);
}
