// Card art of every ship class for the shipbuilding cards of the campaign's region panel (src/ui/grand/RegionPanel.tsx),
// in the look of the work cards (scripts/generate-building-art.mjs). Each card is an edit of a render of the game's own
// procedural model, so the painting keeps the ship the player sails; a kind drawn with a relative's model (MODEL_ALIAS
// in src/ships/anchors.ts) is painted from that relative with the differences its prompt names.
//
//   1. node scripts/ship-shots.mjs --url=http://127.0.0.1:<port>/ --out=assets-src/ui-art/ships/renders \
//        --shots=pano0_34,geo_34,hyeop_34,atake_34,seki_34,koba_34,ming_34,msmall_34 --w=1200 --h=900
//   2. node scripts/generate-ship-card-art.mjs [--only=kind,kind] [--force] [--convert]
//
// Raw PNGs are cached in assets-src/ui-art/ships (gitignored); output is public/ui/ships/<kind>.webp and
// scripts/ship-card-art-provenance.json.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// A git worktree has no .env of its own: fall back to the main checkout's.
const ENV = [join(ROOT, '.env'), join(ROOT, '..', '..', '..', '.env')].find((p) => existsSync(p));
if (ENV) process.loadEnvFile(ENV);
const RAW = join(ROOT, 'assets-src', 'ui-art', 'ships');
const RENDERS = join(RAW, 'renders');
const OUT = join(ROOT, 'public', 'ui', 'ships');
const MODEL = 'gpt-image-2';
const SIZE = 384;

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v = '1'] = a.replace(/^--/, '').split('='); return [k, v]; }));
const ONLY = args.only ? args.only.split(',') : null;
const QUALITY = args.quality ?? 'medium';
const JOBS = Number(args.jobs ?? 3);

// The render each model is painted from (the shot names of scripts/ship-shots.mjs).
const RENDER = { panokseon: 'pano0_34', geobukseon: 'geo_34', hyeopseon: 'hyeop_34', atakebune: 'atake_34', sekibune: 'seki_34', kobaya: 'koba_34', mingship: 'ming_34', mingsmall: 'msmall_34' };
/** Where the ship sits across its render, when it is not the middle: the turtle ship's dragon head reaches the right edge. */
const CENTER = { geobukseon: 0.6 };

const SHIPS = [
  { kind: 'panokseon', model: 'panokseon', ship: 'this Joseon panokseon warship exactly as it is: the broad flat hull, the plank-shield walls, the roofed command pavilion on the upper deck, the oars and sails' },
  { kind: 'geobukseon', model: 'geobukseon', ship: 'this Joseon turtle ship exactly as it is: the armoured roof with iron spikes, the carved dragon head at the bow clearly visible, the oars' },
  { kind: 'hyeopseon', model: 'hyeopseon', ship: 'this small Joseon escort boat exactly as it is: the open deck, the single mast and its oars' },
  { kind: 'sahuseon', model: 'hyeopseon', ship: 'a smaller and lighter version of this Korean boat: a tiny scout boat (sahuseon) with only a few oarsmen and a short mast, quick and low' },
  { kind: 'pojakseon', model: 'hyeopseon', ship: 'a version of this Korean boat as a rough local fishing boat pressed into service (pojakseon): weathered planks, a patched straw-mat sail, nets and baskets on deck, a few men' },
  { kind: 'atakebune', model: 'atakebune', ship: 'this Japanese atakebune exactly as it is: the boxy armoured hull with gun loopholes, the multi-storey tower, the square sail' },
  { kind: 'sekibune', model: 'sekibune', ship: 'this Japanese sekibune exactly as it is: the long narrow hull with shield walls and loopholes, the single square sail, many oars' },
  { kind: 'kobaya', model: 'kobaya', ship: 'this small Japanese kobaya exactly as it is: the light open boat with low shield boards and oars' },
  { kind: 'sogantaek', model: 'atakebune', ship: 'a smaller version of this Japanese warship (a lesser atakebune): a shorter hull and only a low one-storey turret instead of the tall tower' },
  { kind: 'daeantaek', model: 'atakebune', ship: 'a larger and grander version of this Japanese warship, the great flagship (Nihon-maru class): a longer hull, an even taller three-storey castle tower, more banners and gun ports' },
  { kind: 'daegwanseon', model: 'sekibune', ship: 'a larger version of this Japanese warship as a command ship: a roofed command cabin amidships hung with plain white curtains, more banners' },
  { kind: 'byeongnyangseon', model: 'sekibune', ship: 'a version of this Japanese ship as a supply transport: a deeper hull piled with straw rice bales and wooden crates, a big sail, almost no guns' },
  { kind: 'mingship', model: 'mingship', ship: 'this Ming Chinese war junk exactly as it is: the high stern castle, the painted eye on the bow, the batten sails' },
  { kind: 'mingsmall', model: 'mingsmall', ship: 'this small Ming Chinese war boat exactly as it is: the flat hull, the batten sail and oars' },
  { kind: 'gwangseon', model: 'mingship', ship: 'a heavier version of this Chinese war junk, a Guangdong ironwood warship (guangchuan): a dark, massive ironwood hull, a tall stern castle and more cannons' },
  { kind: 'haechangseon', model: 'mingship', ship: 'a smaller version of this Chinese war junk (haicang ship): a medium junk with two batten sails and a lower stern' },
  { kind: 'hoseon', model: 'mingsmall', ship: 'a lighter version of this Chinese boat (hu chuan): a narrow fast oared boat with a small sail and a few soldiers' },
];

const STYLE =
  'Repaint the ship in the reference image as a square card illustration for a historical strategy game, like a unit card of a Total War game. ' +
  'Show only that one ship, alone, at the same three-quarter angle, centred and large, filling about two thirds of the square, on dark water; remove every other ship, the islands and the sky. ' +
  'The surroundings fade softly into dark misty shadow toward all four edges and corners, a vignette with no hard border. ' +
  'Dark, moody hand-painted cinematic look: blue-hour dusk, deep navy sea, a little mist and spray, the ship clearly lit by warm lantern light with a cool moonlit rim so its shape reads at a small size, fine film grain, rich but desaturated colours. ' +
  'Painterly realism like a concept painting for a historical naval epic. Tiny figures are dark unrecognizable silhouettes, no faces. ' +
  'Absolutely no text, no letters, no Chinese characters, no Korean script, no numbers, no logos, no watermark, no border, no frame, no UI, no modern objects, no rising-sun flag, no sunburst.';

const promptOf = (s) => `${STYLE} The ship: ${s.ship}.`;
const rawPath = (s) => join(RAW, `${s.kind}.png`);
const renderPath = (s) => join(RENDERS, `${RENDER[s.model]}.png`);
const outPath = (s) => join(OUT, `${s.kind}.webp`);

async function generate(s) {
  // A square of the render around the ship, with as little of its neighbours in the gallery row as possible.
  const meta = await sharp(renderPath(s)).metadata();
  const side = Math.min(meta.width, meta.height);
  const left = Math.max(0, Math.min(meta.width - side, Math.round(meta.width * (CENTER[s.model] ?? 0.5) - side / 2)));
  const ref = await sharp(renderPath(s)).extract({ left, top: Math.round((meta.height - side) / 2), width: side, height: side }).resize(1024, 1024).png().toBuffer();
  const form = new FormData();
  form.set('model', MODEL); form.set('prompt', promptOf(s)); form.set('size', '1024x1024'); form.set('quality', QUALITY); form.set('n', '1'); form.set('output_format', 'png');
  form.set('image', new Blob([ref], { type: 'image/png' }), 'render.png');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
  const j = await res.json();
  if (!res.ok) throw new Error(`${s.kind}: ${res.status} ${j.error?.message}`);
  await writeFile(rawPath(s), Buffer.from(j.data[0].b64_json, 'base64'));
}

async function convert(s) {
  await sharp(await readFile(rawPath(s))).resize(SIZE, SIZE, { kernel: 'lanczos3' }).modulate({ brightness: 1.1 }).webp({ quality: 78, effort: 6 }).toFile(outPath(s));
}

async function main() {
  await mkdir(RAW, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const ships = SHIPS.filter((s) => !ONLY || ONLY.includes(s.kind));
  if (!args.convert) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing (.env)');
    for (const s of ships) if (!existsSync(renderPath(s))) throw new Error(`${s.kind}: render ${renderPath(s)} missing (step 1)`);
    const queue = [...ships];
    const worker = async () => {
      for (let s; (s = queue.shift()); ) {
        if (existsSync(rawPath(s)) && !args.force) continue;
        for (let attempt = 1; ; attempt++) {
          try { await generate(s); break; } catch (e) { if (attempt >= 8) throw e; console.warn(String(e.message), e.cause?.code); await new Promise((r) => setTimeout(r, 5000 * attempt)); }
        }
        console.log(`generated ${s.kind}`);
      }
    };
    await Promise.all(Array.from({ length: JOBS }, worker));
  }
  const have = SHIPS.filter((s) => existsSync(rawPath(s)));
  for (const s of have) await convert(s);
  await writeFile(join(ROOT, 'scripts', 'ship-card-art-provenance.json'), JSON.stringify({
    provider: 'OpenAI Images API', model: MODEL, quality: QUALITY, size: '1024x1024', generatedAt: new Date().toISOString().slice(0, 10),
    note: `Edits of the game's own ship renders (scripts/ship-shots.mjs, a square around the ship). Exported as WebP, ${SIZE} px square.`,
    style: STYLE,
    ships: await Promise.all(have.map(async (s) => ({ ...s, render: RENDER[s.model], file: `public/ui/ships/${s.kind}.webp`, bytes: (await readFile(outPath(s))).length, prompt: promptOf(s) }))),
  }, null, 2) + '\n');
  console.log('done');
}
await main();
