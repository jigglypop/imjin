// Card art of the six campaign works (군영, 선소, 포대, 수리소, 창고, 봉수대) per navy and level, for the building slots of
// the region panel (src/ui/grand/RegionPanel.tsx). The look follows the camp art (scripts/generate-camp-art.mjs): the same
// blue-hour palette and painterly realism, but one work on its own as a vignette that fades into the dark of the card.
// Level 1 is generated from text; levels 2 and 3 edit the level below so the work keeps its site and angle while it grows.
// Raw PNGs are cached in assets-src/ui-art/buildings (gitignored); output is public/ui/buildings/<faction>-<work>-L<n>.webp
// and scripts/building-art-provenance.json (the prompts used).
//
//   node scripts/generate-building-art.mjs                         every missing image
//   node scripts/generate-building-art.mjs --only=joseon-beacon    some cards (<faction>-<work>, or a faction or a work)
//   node scripts/generate-building-art.mjs --levels=1              some levels (a level needs the one below it)
//   node scripts/generate-building-art.mjs --force                 regenerate even if cached
//   node scripts/generate-building-art.mjs --convert               skip the API, only re-encode cached raws
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// A git worktree has no .env of its own: fall back to the main checkout's.
const ENV = [join(ROOT, '.env'), join(ROOT, '..', '..', '..', '.env')].find((p) => existsSync(p));
if (ENV) process.loadEnvFile(ENV);
const RAW = join(ROOT, 'assets-src', 'ui-art', 'buildings');
const OUT = join(ROOT, 'public', 'ui', 'buildings');
const MODEL = 'gpt-image-2';
const SIZE = 384;

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v = '1'] = a.replace(/^--/, '').split('='); return [k, v]; }));
const ONLY = args.only ? args.only.split(',') : null;
const LEVELS = (args.levels ?? '1,2,3').split(',').map(Number);
const QUALITY = args.quality ?? 'medium';
const JOBS = Number(args.jobs ?? 6);

const FACTION = {
  joseon: 'Joseon Korea, 1590s: grey ceramic-tiled roofs with gently upturned eaves, white plastered walls and dark timber frames, grey fieldstone, plain blue and white cloth banners without any emblem.',
  japan: 'Sengoku Japan, 1590s: black-lacquered timber, white plastered walls, dark grey tiled roofs, steep battered stone walls, plain white cloth banners without any emblem or marking.',
  ming: 'Ming China, 1590s: grey brick walls, red lacquered timber, yellow and green glazed tiled roofs with sweeping ridges, plain red and yellow cloth banners without any emblem.',
};

// What each work is, in each navy's own building language, and how it grows. Level 1 is the text of the first picture;
// levels 2 and 3 say what the edit adds to it.
const WORKS = {
  camp: {
    label: '군영',
    joseon: 'a naval command post: a small timber command hall on a stone platform inside a palisade, a flagpole and a drum stand in a swept yard',
    japan: 'a naval command post: a small black-timbered command hall with a curtain enclosure (jinmaku) of plain white cloth on poles, a flagpole in a swept yard',
    ming: 'a naval command post: a small red-pillared yamen hall with a glazed roof inside a low brick wall, a flagpole in a paved yard',
    2: 'a sturdier wall with a gate tower, a second hall and a row of barracks, more banners',
    3: 'a fortified headquarters: a continuous stone wall with corner towers, a grand two-storey command hall, many barracks, an assembly ground with ranks of tiny soldiers, lanterns lit everywhere',
  },
  shipyard: {
    label: '선소',
    joseon: 'a shipyard: one wooden slipway on a shingle beach with the half-planked hull of a broad flat-bottomed Korean warship on it, timber props, stacked pine logs and a carpenters\' shed',
    japan: 'a shipyard: one wooden slipway on a sandy beach with the half-planked hull of a boxy Japanese warship on it, timber props, stacked cedar logs and a carpenters\' shed',
    ming: 'a shipyard: one wooden slipway on a mud bank with the half-built hull of a Chinese junk on it, timber props, stacked logs and a carpenters\' shed',
    2: 'a second slipway with another hull, a roofed timber shed over the slipways, a log-hauling crane and a sawpit',
    3: 'a great shipyard: three slipways under long roofed sheds, a large nearly finished warship on the main slipway, a stone launching quay, many workers, lanterns',
  },
  battery: {
    label: '포대',
    joseon: 'a shore battery: a low earthen and fieldstone gun platform on a headland with two bronze Korean cannons (cheonja chongtong) on wooden carriages pointing out to sea, powder chests',
    japan: 'a shore battery: a battered stone wall on a headland with loopholes and two bronze cannons on wooden blocks pointing out to sea, plain white banners',
    ming: 'a shore battery: a grey brick bastion on a headland with two breech-loading Chinese cannons (folangji) on wooden stands pointing out to sea, powder chests',
    2: 'a taller stone rampart with crenellations, four cannons in embrasures and a roofed powder store',
    3: 'a great coastal fortress battery: a curved stone bastion with many cannons in tiers, a tower, gun smoke drifting, braziers lit',
  },
  dock: {
    label: '수리소',
    joseon: 'a repair dock: a broad Korean warship hauled up on a timber cradle at the water\'s edge with its side partly opened, carpenters, a tar cauldron steaming over a fire, stacked planks',
    japan: 'a repair dock: a Japanese warship hauled up on a timber cradle at the water\'s edge with its side partly opened, carpenters, a tar cauldron steaming over a fire, stacked planks',
    ming: 'a repair dock: a Chinese junk hauled up on a timber cradle at the water\'s edge with its side partly opened, carpenters, a tar cauldron steaming over a fire, stacked planks',
    2: 'a stone-lined dry dock basin holding the ship, a roofed workshop, rope and sail stores',
    3: 'a large stone dry dock with a timber gate, two ships under repair, cranes, a forge glowing, many lanterns',
  },
  granary: {
    label: '창고',
    joseon: 'a storehouse: a raised wooden granary with a tiled roof on stone posts, stacked straw rice sacks and a few wooden gunpowder kegs in front',
    japan: 'a storehouse: a white-plastered kura storehouse with a dark tiled roof, stacked straw rice bales and a few gunpowder kegs in front',
    ming: 'a storehouse: a brick granary with a glazed roof, stacked grain sacks and a few gunpowder kegs in front',
    2: 'a second storehouse, a walled yard, carts and more stacked sacks and kegs',
    3: 'a large walled depot: a row of great storehouses, a separate guarded powder magazine behind an earth bank, mountains of sacks, lanterns',
  },
  beacon: {
    label: '봉수대',
    joseon: 'a beacon station (bongsudae) on a rocky hilltop: a round stone mound with a small signal fire burning in one stone chimney pit, a guard hut, thin smoke rising',
    japan: 'a signal post on a rocky hilltop: a wooden watchtower (yagura) with a fire basket burning on top, a guard hut, thin smoke rising',
    ming: 'a beacon tower (fenghuotai) on a rocky hilltop: a square rammed-earth and brick tower with a signal fire burning on top, a guard hut, thin smoke rising',
    2: 'a taller tower with a lookout platform, two fires burning, a low wall around it',
    3: 'a great beacon fortress: a tall stone tower with five fire pits blazing, a walled compound and a column of smoke rising high into the dusk sky',
  },
};

const STYLE =
  'Square card illustration for a historical strategy game, like the building cards of a Total War settlement panel. ' +
  'One single structure seen from above at a three-quarter oblique angle (about 40 degrees down), centred and large, filling about two thirds of the square, on a small patch of ground or shore; ' +
  'the surroundings fade softly into dark misty shadow toward all four edges and corners, a vignette with no hard border. ' +
  'Dark, moody hand-painted cinematic look: blue-hour dusk, deep navy water, dark pines, warm lantern and fire light, soft mist; the structure itself is clearly lit by warm torchlight with a cool moonlit rim so its shape reads at a small size, fine film grain, rich but desaturated colours. ' +
  'Painterly realism like a concept painting for a historical naval epic. Tiny figures are dark unrecognizable silhouettes, no faces. ' +
  'Absolutely no text, no letters, no Chinese characters, no Korean script, no numbers, no logos, no watermark, no border, no frame, no UI, no modern objects, no rising-sun flag, no sunburst.';

const LEVEL_TEXT = {
  1: (f, w) => `LEVEL 1, a modest first version: ${WORKS[w.kind][f]}. Small and simple, a lot of empty dark ground around it.`,
  2: (f, w) => `Grow this very same structure into LEVEL 2 on the identical site, identical camera angle and identical framing: ${WORKS[w.kind][2]}. Keep the palette, the vignette and the composition exactly as they are.`,
  3: (f, w) => `Grow this very same structure into LEVEL 3 on the identical site, identical camera angle and identical framing: ${WORKS[w.kind][3]}. Keep the palette, the vignette and the composition exactly as they are.`,
};

const CARDS = Object.keys(FACTION).flatMap((f) => Object.keys(WORKS).map((kind) => ({ id: `${f}-${kind}`, faction: f, kind, label: WORKS[kind].label })));

const promptOf = (c, level) => `${STYLE} ${FACTION[c.faction]} ${LEVEL_TEXT[level](c.faction, c)}`;
const rawPath = (c, level) => join(RAW, `${c.id}-L${level}.png`);
const outPath = (c, level) => join(OUT, `${c.id}-L${level}.webp`);
const headers = () => ({ Authorization: `Bearer ${process.env.OPENAI_API_KEY}` });

async function generate(c, level) {
  const prompt = promptOf(c, level);
  let res;
  if (level === 1) {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, size: '1024x1024', quality: QUALITY, n: 1, output_format: 'png' }),
    });
  } else {
    const form = new FormData();
    form.set('model', MODEL); form.set('prompt', prompt); form.set('size', '1024x1024'); form.set('quality', QUALITY); form.set('n', '1'); form.set('output_format', 'png');
    form.set('image', new Blob([await readFile(rawPath(c, level - 1))], { type: 'image/png' }), 'previous.png');
    res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: headers(), body: form });
  }
  const j = await res.json();
  if (!res.ok) throw new Error(`${c.id} L${level}: ${res.status} ${j.error?.message}`);
  await writeFile(rawPath(c, level), Buffer.from(j.data[0].b64_json, 'base64'));
}

async function convert(c, level) {
  await sharp(await readFile(rawPath(c, level))).resize(SIZE, SIZE, { kernel: 'lanczos3' }).modulate({ brightness: 1.1 }).webp({ quality: 78, effort: 6 }).toFile(outPath(c, level));
}

async function main() {
  await mkdir(RAW, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const cards = CARDS.filter((c) => !ONLY || ONLY.some((o) => c.id === o || c.faction === o || c.kind === o));
  if (!args.convert) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing (.env)');
    // A card's levels must go in order, but different cards run side by side.
    const queue = [...cards];
    const worker = async () => {
      for (let c; (c = queue.shift()); ) {
        for (const level of LEVELS) {
          if (existsSync(rawPath(c, level)) && !args.force) continue;
          if (level > 1 && !existsSync(rawPath(c, level - 1))) throw new Error(`${c.id}: level ${level - 1} missing`);
          for (let attempt = 1; ; attempt++) {
            try { await generate(c, level); break; } catch (e) { if (attempt >= 8) throw e; console.warn(String(e.message), e.cause?.code); await new Promise((r) => setTimeout(r, 5000 * attempt)); }
          }
          console.log(`generated ${c.id} L${level}`);
        }
      }
    };
    await Promise.all(Array.from({ length: JOBS }, worker));
  }
  const have = (c, level) => existsSync(rawPath(c, level));
  for (const c of CARDS) for (const level of [1, 2, 3]) if (have(c, level)) await convert(c, level);
  await writeFile(join(ROOT, 'scripts', 'building-art-provenance.json'), JSON.stringify({
    provider: 'OpenAI Images API', model: MODEL, quality: QUALITY, size: '1024x1024', generatedAt: new Date().toISOString().slice(0, 10),
    note: `Level 1 from text; levels 2 and 3 are edits of the level below. Exported as WebP, ${SIZE} px square.`,
    style: STYLE, factions: FACTION,
    cards: await Promise.all(CARDS.map(async (c) => ({
      ...c,
      levels: await Promise.all([1, 2, 3].filter((l) => have(c, l)).map(async (l) => ({ level: l, file: `public/ui/buildings/${c.id}-L${l}.webp`, bytes: (await readFile(outPath(c, l))).length, prompt: promptOf(c, l) }))),
    }))),
  }, null, 2) + '\n');
  console.log('done');
}
await main();
