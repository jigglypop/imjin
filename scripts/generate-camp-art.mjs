// Bird's-eye art of each naval camp (군영) at levels 1-3, for the region panel of the faction campaign.
// Level 1 is generated from text; levels 2 and 3 edit the previous level so the site, angle and palette stay the same
// while the camp grows. Raw PNGs are cached in assets-src/ui-art/camps (gitignored); output is public/ui/camps/<id>-L<n>.webp
// and scripts/camp-art-provenance.json (the list of camps and the prompts used).
//
//   node scripts/generate-camp-art.mjs                    every missing image
//   node scripts/generate-camp-art.mjs --only=yi,won      some camps
//   node scripts/generate-camp-art.mjs --levels=1,2       some levels (a level needs the one below it)
//   node scripts/generate-camp-art.mjs --force            regenerate even if cached
//   node scripts/generate-camp-art.mjs --convert          skip the API, only re-encode cached raws and rewrite the provenance
//   node scripts/generate-camp-art.mjs --quality=high --jobs=4
//   node scripts/generate-camp-art.mjs --only=holyleague --provider=gemini   Gemini's image model instead of OpenAI's
// The provenance keeps the entries of camps whose raws are not on this machine (they live in the asset store).
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { geminiImage, geminiModel } from './gemini-image.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const RAW = join(ROOT, 'assets-src', 'ui-art', 'camps');
const OUT = join(ROOT, 'public', 'ui', 'camps');
const MODEL = 'gpt-image-2';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v = '1'] = a.replace(/^--/, '').split('='); return [k, v]; }));
const ONLY = args.only ? args.only.split(',') : null;
const LEVELS = (args.levels ?? '1,2,3').split(',').map(Number);
const QUALITY = args.quality ?? 'medium';
const JOBS = Number(args.jobs ?? 4);
const PROVIDER = args.provider ?? 'openai';

// One camp per commander portrait. `regions` are the strategic-map ports whose camp it draws while its own faction
// holds them (the table in src/ui/grand/RegionPanel.tsx mirrors this); every other port, and a seat taken by another
// faction, shows that faction's shared camp ('admiral' for Joseon, 'japan', 'deng' for Ming).
const CAMPS = [
  { id: 'yi', faction: 'joseon', commander: '이순신', regions: ['yeosu'], site: 'a deep sheltered bay with a wide timber pier, the headquarters of the Jeolla Left Naval District, a modest single-storey tiled hall facing the water' },
  { id: 'won', faction: 'joseon', commander: '원균', regions: ['geoje'], site: 'a broad island cove on a rocky shore, the Gyeongsang Right Naval District, with a long stone-faced wharf' },
  { id: 'eokgi', faction: 'joseon', commander: '이억기', regions: ['myeongnyang'], site: 'a windswept island headland beside a fast tidal strait, the Jeolla Right Naval District, with pine-covered hills and a short pier' },
  { id: 'kwon', faction: 'joseon', commander: '권준', regions: ['hansan'], site: 'a small island harbour among steep wooded islets, with a narrow landing beach and a watch post on the ridge' },
  { id: 'jeongun', faction: 'joseon', commander: '정운', regions: ['nokdo'], site: 'a small walled coastal fort on a peninsula, a village of thatched houses behind it and a fishing-boat shore' },
  { id: 'eo', faction: 'joseon', commander: '어영담', regions: ['bangdap'], site: 'an island fort overlooking a channel, terraced hillside, rice fields behind and a modest landing' },
  { id: 'anwi', faction: 'joseon', commander: '안위', regions: ['mokpo'], site: 'a river-mouth port on a muddy estuary with reed banks, wooden quays and a signal-fire hill' },
  { id: 'admiral', faction: 'joseon', commander: '수군 통제사 (공용)', regions: [], site: 'a typical Joseon coastal naval post on a bay, hills with pines behind and a timber pier' },
  { id: 'wakisaka', faction: 'japan', commander: '와키자카 야스하루', regions: ['busan'], site: 'a captured harbour town on a curved bay, a Japanese-built hill fortress above the quay, large anchorage' },
  { id: 'kuki', faction: 'japan', commander: '구키 요시타카', regions: ['angolpo'], site: 'a narrow inlet camp on a rocky shore, large warships beached on the sand and moored in rows' },
  { id: 'kato', faction: 'japan', commander: '가토 요시아키', regions: ['nagoya'], site: 'the vast staging base of the invasion on a bay of north-west Kyushu, a castle on the hill and encampments of many clans stretching along the shore' },
  { id: 'kurushima', faction: 'japan', commander: '구루시마 미치후사', regions: ['cheonseongpo'], site: 'a rocky island stronghold of a sea-raider clan, boats hidden in a small cove, a wooden lookout tower' },
  { id: 'konishi', faction: 'japan', commander: '고니시 유키나가', regions: ['tsushima'], site: 'a steep island harbour, a hill fortress and a fleet gathering point on a long narrow inlet' },
  { id: 'todo', faction: 'japan', commander: '도도 다카토라', regions: ['dadaepo'], site: 'a coastal fort on a headland, a wide gravel landing and stacked supply crates' },
  { id: 'shimazu', faction: 'japan', commander: '시마즈 요시히로', regions: ['jepo'], site: 'a hillside encampment above a river mouth with a defended landing, palisades terraced up the slope' },
  { id: 'japan', faction: 'japan', commander: '일본 수군 (공용)', regions: [], site: 'a typical captured Korean coastal port held by Japanese troops, a bay with hills behind' },
  { id: 'chenlin', faction: 'ming', commander: '진린', regions: ['liaodong'], site: 'a northern Chinese river-mouth garrison on a flat coast, a brick-faced earthen wall and a long canal dock' },
  { id: 'deng', faction: 'ming', commander: '등자룡', regions: ['shandong'], site: 'a large Chinese naval harbour on a flat coast with a walled yamen compound, brick towers and a broad quay' },
  // The Armada theatre: one shared camp for each navy (src/ui/grand/campArt.ts).
  { id: 'england', faction: 'england', commander: '잉글랜드 수군 (공용)', regions: [], site: 'an English Channel harbour in a green Devon combe, chalk-and-slate cliffs, a small town of half-timbered houses and a stone church tower behind the quay' },
  { id: 'spain', faction: 'spain', commander: '에스파냐 수군 (공용)', regions: [], site: 'a Flemish or Galician harbour on a low sandy coast with dunes, a walled town with red-tiled roofs and a church spire behind the quay' },
  // The Lepanto theatre: one shared camp for each navy.
  { id: 'holyleague', faction: 'holyleague', commander: '신성동맹 함대 (공용)', regions: [], site: 'a Venetian-held Ionian harbour below a stone sea fortress on a rocky point, olive and cypress hills behind, a small town of whitewashed houses with low red-tiled roofs and a square bell tower' },
  { id: 'ottoman', faction: 'ottoman', commander: '오스만 함대 (공용)', regions: [], site: 'an Ottoman-held Greek harbour below a stone sea fortress on a dry hillside of olive trees, a small town of whitewashed houses with low red-tiled roofs, a domed mosque and a slender minaret' },
];

const FACTION = {
  joseon: 'Joseon Korea: grey ceramic-tiled roofs with upturned eaves, white plastered and dark timber walls, plain blue and white cloth banners without any emblem, Joseon panokseon warships (broad flat hulls with plank-shield walls and roofed command pavilions).',
  japan: 'Sengoku Japan: black-lacquered timber, white plastered walls, dark grey tiled roofs, plain white cloth banners without any emblem or marking, boxy atakebune and sekibune warships with loopholes.',
  ming: 'Ming China: brick walls, red and yellow lacquered gate towers with yellow-glazed tiled roofs, plain red and yellow cloth banners without any emblem, large Chinese junk warships with batten sails.',
  england: 'Tudor England: grey dressed-stone curtain walls and round artillery towers, half-timbered houses with red clay tile and slate roofs, thatched cottages, the red St George cross on white flags and green-and-white Tudor pennants, low sleek race-built English galleons with three masts and square sails.',
  spain: 'Habsburg Spain and Flanders: pale stone bastions and walls, whitewashed and red-brick houses with red tiled roofs, the red ragged cross of Burgundy on white flags and crimson banners, tall Spanish galleons with high castles fore and aft and four masts.',
  holyleague: 'the Holy League of 1571 (Venice, Spain, the Papacy): pale limestone bastions and walls of an Italian-style sea fortress, whitewashed houses with low-pitched red clay tile roofs, plain crimson and plain blue cloth banners without any emblem, long low Mediterranean war galleys with a single bank of oars, a bow spur and lateen sails, beached and moored stern-to along the quay.',
  ottoman: 'the Ottoman Empire of 1571: grey stone fortress walls and round towers, whitewashed houses with low-pitched red clay tile roofs, a lead-domed mosque with a slender pencil minaret, plain red and plain green cloth banners without any emblem, long low Mediterranean war galleys (kadirga) and smaller galiots with a single bank of oars and lateen sails, moored stern-to along the quay.',
};

const STYLE =
  "Bird's-eye strategy-game illustration of a sixteenth-century naval camp, seen from high above at a fixed three-quarter oblique angle (about 50 degrees down), the whole camp centred and fully inside the frame with sea at the top and land at the bottom. " +
  'Dark, moody hand-painted cinematic look: blue-hour dusk, deep navy sea and dark pine hills, warm lantern and brazier light spilling from doors, soft drifting mist, fine film grain, rich but desaturated colours, a little gunpowder haze. ' +
  'Painterly realism like a concept painting for a historical naval epic. Tiny soldiers are dark unrecognizable figures, no faces. ' +
  'Absolutely no text, no letters, no Chinese characters, no Korean script, no numbers, no logos, no watermark, no border, no UI, no modern objects, no rising-sun flag, no sunburst. Use only the colours of the faction.';

const LEVEL_TEXT = {
  1: (c) => `LEVEL 1, a modest new camp: a low wooden palisade of sharpened logs around a small yard, one simple gate, three or four small thatched or plain tiled huts, a drying rack and a campfire, a short wooden jetty with two small fishing boats and no warships at all. Empty surroundings, plenty of untouched wild land and forest around it. Site: ${c.site}.`,
  2: () => 'Grow this very same camp into LEVEL 2 on the identical site, identical camera angle and identical coastline: replace the palisade with a sturdier timber-and-earth wall with a watchtower at the gate, add a row of tiled barracks, a storehouse and a small parade ground, extend the pier and moor two or three proper warships. Keep the terrain, shoreline and composition exactly as they are.',
  3: () => "Grow this very same camp into LEVEL 3, a fully fortified naval base, on the identical site, identical camera angle and identical coastline: a continuous stone-and-timber wall with corner towers and a fortified gate, many tiled barracks, a large command hall, storehouses, cannon emplacements on the ramparts, a long stone quay with a large dock, and a fleet of several warships including the faction's best, lanterns lit everywhere. Keep the terrain, shoreline and composition exactly as they are.",
};

const promptOf = (c, level) => `${STYLE} ${FACTION[c.faction]} ${LEVEL_TEXT[level](c)}`;
const rawPath = (c, level) => join(RAW, `${c.id}-L${level}.png`);
const outPath = (c, level) => join(OUT, `${c.id}-L${level}.webp`);
const headers = () => ({ Authorization: `Bearer ${process.env.OPENAI_API_KEY}` });

async function generate(c, level) {
  const prompt = promptOf(c, level);
  if (PROVIDER === 'gemini') {
    await writeFile(rawPath(c, level), await geminiImage(prompt, { aspect: '3:2', image: level > 1 ? await readFile(rawPath(c, level - 1)) : null }));
    return;
  }
  let res;
  if (level === 1) {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, size: '1536x1024', quality: QUALITY, n: 1, output_format: 'png' }),
    });
  } else {
    const form = new FormData();
    form.set('model', MODEL); form.set('prompt', prompt); form.set('size', '1536x1024'); form.set('quality', QUALITY); form.set('n', '1'); form.set('output_format', 'png');
    form.set('image', new Blob([await readFile(rawPath(c, level - 1))], { type: 'image/png' }), 'previous.png');
    res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: headers(), body: form });
  }
  const j = await res.json();
  if (!res.ok) throw new Error(`${c.id} L${level}: ${res.status} ${j.error?.message}`);
  await writeFile(rawPath(c, level), Buffer.from(j.data[0].b64_json, 'base64'));
}

async function convert(c, level) {
  await sharp(await readFile(rawPath(c, level))).resize(1024, null, { kernel: 'lanczos3' }).webp({ quality: 80, effort: 5 }).toFile(outPath(c, level));
}

async function main() {
  await mkdir(RAW, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const camps = CAMPS.filter((c) => !ONLY || ONLY.includes(c.id));
  if (!args.convert) {
    if (PROVIDER !== 'gemini' && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing (.env)');
    // A camp's levels must go in order, but different camps run side by side.
    const queue = [...camps];
    const worker = async () => {
      for (let c; (c = queue.shift()); ) {
        for (const level of LEVELS) {
          if (existsSync(rawPath(c, level)) && !args.force) continue;
          if (level > 1 && !existsSync(rawPath(c, level - 1))) throw new Error(`${c.id}: level ${level - 1} missing`);
          for (let attempt = 1; ; attempt++) {
            try { await generate(c, level); break; } catch (e) { if (attempt >= 5) throw e; console.warn(String(e.message), e.cause?.code); await new Promise((r) => setTimeout(r, 5000)); }
          }
          console.log(`generated ${c.id} L${level}`);
        }
      }
    };
    await Promise.all(Array.from({ length: JOBS }, worker));
  }
  const have = (c, level) => existsSync(rawPath(c, level));
  for (const c of camps) for (const level of [1, 2, 3]) if (have(c, level)) await convert(c, level);
  // Camps made in this run (or whose raws are here) get fresh entries; the others keep what the provenance had, so a run
  // on a machine without every camp's raws (they live in the asset store) drops nothing.
  const file = join(ROOT, 'scripts', 'camp-art-provenance.json');
  const old = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : { camps: [] };
  const made = PROVIDER === 'gemini' ? { provider: 'Google Gemini API', model: geminiModel(), size: '3:2' } : { provider: 'OpenAI Images API', model: MODEL, quality: QUALITY, size: '1536x1024' };
  await writeFile(file, JSON.stringify({
    ...old,
    note: 'Level 1 from text; levels 2 and 3 are edits of the level below. Exported as WebP, 1024 px wide. A camp without its own `made` was made with the top-level provider and model.',
    style: STYLE, factions: FACTION,
    camps: await Promise.all(CAMPS.map(async (c) => {
      const prev = old.camps?.find((p) => p.id === c.id);
      if (!camps.includes(c) && prev) return prev;
      const own = PROVIDER === 'gemini' ? { made: { ...made, generatedAt: new Date().toISOString().slice(0, 10) } } : prev?.made ? { made: prev.made } : {};
      return {
        ...c,
        ...own,
        levels: await Promise.all([1, 2, 3].filter((l) => existsSync(outPath(c, l))).map(async (l) => ({ level: l, file: `public/ui/camps/${c.id}-L${l}.webp`, bytes: (await readFile(outPath(c, l))).length, prompt: promptOf(c, l) }))),
      };
    })),
  }, null, 2) + '\n');
  console.log('done');
}
await main();
