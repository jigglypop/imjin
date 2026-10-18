// The famous generals as rigged 3D figures, one per armor they can wear, posed and animated on the 장수 screen.
// Every job runs end to end and all the jobs run side by side:
//   1. a T-pose reference, 2048 px, from the OpenAI Images API: the commander's portrait as the face reference, recast as
//      a film lead, both hands clenched so a sword sits in the right fist;
//   2. Meshy image-to-3D at 4k geometry and 4k PBR textures, remeshed to under 300k triangles (the most Meshy rigs);
//   3. Meshy auto-rigging;
//   4. the finish (scripts/lib/figure.mjs): the shared motions moved onto the skeleton, a `grip` node in the right fist,
//      and two levels of detail, public/models/generals/<general>_<armor>.glb and _lod1.glb, listed in index.json.
// The motions come from one Meshy animation request on one rig (assets-src/generals-3d-2026-10-16/motions.glb), so a
// figure costs its model (35 credits) and its rig (5). Resumable: pipeline.json keeps every task id, prompt and credit,
// a rerun picks each job up where it stopped, and the rigged figures are kept in rig/ so --finish redoes the last step
// without Meshy.
//
//   node scripts/generals-3d.mjs [--only=yi,wakisaka] [--armor=joseon_dujeong] [--tiers=basic,signature] [--jobs=12] [--dry] [--finish]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildFigure } from './lib/figure.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.loadEnvFile(join(ROOT, '.env'));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
const PKG = join(ROOT, 'assets-src', 'generals-3d-2026-10-16');
const STATE = join(PKG, 'pipeline.json');
const MOTIONS = join(PKG, 'motions.glb');
const FACES = join(ROOT, 'assets-src', 'commanders-2026-10-16', 'src');
const OUT = join(ROOT, 'public', 'models', 'generals');
for (const d of [join(PKG, 'tpose'), join(PKG, 'rig'), OUT]) mkdirSync(d, { recursive: true });

// The armor briefs are the ones the armor art was painted from (scripts/generate-armor-art.mjs), read from that file.
const armorArt = readFileSync(join(ROOT, 'scripts', 'generate-armor-art.mjs'), 'utf8');
const block = (name) => {
  const start = armorArt.indexOf(`const ${name} = {`);
  let depth = 0;
  for (let i = armorArt.indexOf('{', start); i < armorArt.length; i++) {
    if (armorArt[i] === '{') depth++;
    else if (armorArt[i] === '}' && --depth === 0) return armorArt.slice(armorArt.indexOf('{', start), i + 1);
  }
  throw new Error(`no ${name} in generate-armor-art.mjs`);
};
const LOOK = new Function(`return ${block('LOOK')};`)();
const WHO = new Function(`return ${block('WHO')};`)();
const look = (id) => (typeof LOOK[id] === 'string' ? LOOK[id] : LOOK[id].armor.replace('%MASK%', LOOK[id].portrait ?? ''));

const { GENERALS, armorsFor } = await import('../src/meta/catalog.ts');
const only = args.only?.split(',');
const armors = args.armor?.split(',');
const tiers = args.tiers?.split(',');
const famous = GENERALS.filter((g) => g.famous && (!only || only.includes(g.id)));
const JOBS = famous.flatMap((g) => armorsFor(g)
  .filter((a) => (!armors || armors.includes(a.id)) && (!tiers || tiers.includes(a.tier)))
  .map((a) => ({ general: g.id, armor: a.id, key: `${g.id}_${a.id}` })));

const IMAGE = { model: 'gpt-image-2.5-sunburst', size: '2048x2048', quality: 'high', background: 'transparent', output_format: 'png' };
// 4k geometry and textures are what make a face and armor read at a hand's width from the camera; 280k triangles stay
// under the 300k that Meshy rigs. The first set, at 25k triangles and 2k textures, was faceted and soft.
const MESHY = { ai_model: 'meshy-7.1', model_type: 'standard', geometry_resolution: '4k', should_remesh: true, target_polycount: 280000, topology: 'triangle', should_texture: true, enable_pbr: true, texture_resolution: '4k', pose_mode: 't-pose', target_formats: ['glb'] };

const prompt = (job) =>
  'A character reference image made for image-to-3D reconstruction and auto-rigging, in the look of a realistic live-action historical costume fitting photograph. ' +
  'Exactly one man standing alone in a strict T-pose: both arms stretched straight out to the sides at shoulder height, level; ' +
  'both hands clenched into firm, compact fists, the backs of the hands facing up, the fingers curled tight into the palms and the thumbs folded over them; ' +
  'legs straight, feet a shoulder width apart and flat; head up, facing straight ahead. Seen straight from the front at eye level through a long lens, no perspective distortion. ' +
  'The whole figure inside the frame with a clear margin: the top of the helmet and its plume or crest, both fists and the soles of the boots. His fists are empty: no weapon, nothing held. ' +
  'Soft, even, shadowless studio light from every side; the figure isolated on a fully transparent background with no ground, no floor line, no shadow, nothing else in the picture. ' +
  'Crisp, sharply focused detail everywhere: every plate, rivet, lacing cord, buckle and seam clearly separated, in believable late-sixteenth-century materials (rubbed iron, worn lacquer, silk, leather, brass). ' +
  'The attached picture is the existing casting of this man: keep who he is (his age, his beard and moustache style), but recast him as the strikingly handsome, charismatic leading man of a big-budget historical war film, ' +
  'an original face and not any real actor: strong jaw and cheekbones, intense confident eyes, healthy skin with fine natural texture, well-groomed facial hair, a heroic commanding presence. ' +
  `He is ${WHO[job.general]}. The armour he wears, with its helmet: ${look(job.armor)} ` +
  'No text, no letters, no logo, no border, no emblem, crest or mon unless named above. No rising sun flag, no sunburst or radiating rays, no red sun disc. No painting or illustration look, no cartoon, no plastic CGI look, no modern items.';

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { jobs: {} };
state.schema = 'imjin.generals-3d.v3';
state.image = IMAGE;
state.meshy = MESHY;
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
// The figures the 장수 screen can show (src/ui/generals/GeneralModel.tsx reads the list).
const writeIndex = () => writeFileSync(join(OUT, 'index.json'), JSON.stringify(readdirSync(OUT).filter((f) => f.endsWith('.glb') && !f.endsWith('_lod1.glb')).map((f) => f.slice(0, -4)).sort()) + '\n');
const log = (job, ...m) => console.log(new Date().toISOString().slice(11, 19), job.key.padEnd(32), ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, url, headers, body, tries = 8) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(900_000) });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (res.ok) return json;
      if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(5000 * (i + 1) + Math.random() * 3000); continue; }
      throw new Error(`${res.status} ${text.slice(0, 300)}`);
    } catch (e) {
      if (i < tries && /fetch failed|ECONNRESET|socket|network|timeout|terminated/i.test(`${e} ${e?.cause ?? ''}`)) { await sleep(4000 * (i + 1) + Math.random() * 3000); continue; }
      throw e;
    }
  }
}
const meshy = { Authorization: `Bearer ${process.env.MESHY_API_KEY}`, 'Content-Type': 'application/json' };
const poll = async (path, what) => {
  for (;;) {
    const t = await http('GET', `https://api.meshy.ai/openapi/v1/${path}`, meshy);
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${what} ${t.status}: ${JSON.stringify(t.task_error ?? {})}`);
    await sleep(10_000);
  }
};

async function concept(job, s) {
  const file = join(PKG, 'tpose', `${job.key}.png`);
  if (existsSync(file)) return file;
  const face = await sharp(join(FACES, `${job.general}.webp`)).png().toBuffer();
  const form = new FormData();
  for (const [k, v] of Object.entries(IMAGE)) form.set(k, String(v));
  form.set('n', '1');
  form.set('prompt', prompt(job));
  form.set('image', new Blob([face], { type: 'image/png' }), 'face.png');
  const j = await http('POST', 'https://api.openai.com/v1/images/edits', { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, form);
  writeFileSync(file, Buffer.from(j.data[0].b64_json, 'base64'));
  s.concept = { at: new Date().toISOString(), prompt: prompt(job), usage: j.usage ?? null };
  save();
  return file;
}

const rigFile = (job) => join(PKG, 'rig', `${job.key}.glb`);

async function finish(job, s) {
  const out = await buildFigure({ rig: rigFile(job), motions: MOTIONS, dir: OUT, name: job.key });
  s.done = { at: new Date().toISOString(), levels: out.levels, grip: out.grip, clips: ['idle', 'shout', 'slash'] };
  delete s.error;
  save();
  writeIndex();
  log(job, 'DONE', JSON.stringify(out.levels));
}

async function run(job) {
  const s = (state.jobs[job.key] ??= {});
  if (args.finish) return existsSync(rigFile(job)) && finish(job, s);
  if (s.done && !args.redo) return log(job, 'done already');
  if (!existsSync(rigFile(job))) {
    const file = await concept(job, s);
    log(job, 'concept ready');
    if (!s.model || s.model.request?.geometry_resolution !== MESHY.geometry_resolution) {
      const image = readFileSync(file);
      const r = await http('POST', 'https://api.meshy.ai/openapi/v1/image-to-3d', meshy, JSON.stringify({ image_url: `data:image/png;base64,${image.toString('base64')}`, ...MESHY }));
      s.model = { task: r.result, at: new Date().toISOString(), request: MESHY };
      delete s.rig;
      save();
    }
    const model = await poll(`image-to-3d/${s.model.task}`, 'model');
    s.model.credits = model.consumed_credits ?? null;
    log(job, 'model ready');
    if (!s.rig) {
      const r = await http('POST', 'https://api.meshy.ai/openapi/v1/rigging', meshy, JSON.stringify({ input_task_id: s.model.task, height_meters: 1.75 }));
      s.rig = { task: r.result, at: new Date().toISOString() };
      save();
    }
    const rig = await poll(`rigging/${s.rig.task}`, 'rig');
    s.rig.credits = rig.consumed_credits ?? null;
    const res = await fetch(rig.result.rigged_character_glb_url);
    writeFileSync(rigFile(job), Buffer.from(await res.arrayBuffer()));
    save();
    log(job, 'rig ready');
  }
  await finish(job, s);
}

console.log(`${JOBS.length} jobs`);
if (args.dry) { console.log(JOBS.map((j) => j.key).join('\n')); process.exit(0); }
const width = Math.min(JOBS.length, Number(args.jobs ?? JOBS.length));
const queue = [...JOBS];
let failed = 0;
await Promise.all(Array.from({ length: width }, async (_, n) => {
  // Staggered starts: a burst of uploads at the same instant gets connections reset.
  await sleep(n * 2500);
  for (let j; (j = queue.shift()); ) {
    try { await run(j); } catch (e) { failed++; log(j, 'FAILED', String(e).slice(0, 300)); (state.jobs[j.key] ??= {}).error = String(e).slice(0, 500); save(); }
  }
}));
console.log(`finished, ${failed} failed`);
