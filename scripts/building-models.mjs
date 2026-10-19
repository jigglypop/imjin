// Per-nation shore-works building models: Gemini concept -> Tripo image_to_model -> phone-sized pack.
// usage: node scripts/building-models.mjs concept|submit|poll|pack [nation[:kind] ...]
// Sources and ledger: assets-src/buildings-tripo-2026-10-19/ (ledger.json, provenance.json); runtime:
// public/models/buildings/<nation>/<kind>.glb (+ _lod1.glb).
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
process.loadEnvFile(join(ROOT, '.env'));
const PACK = join(ROOT, 'assets-src', 'buildings-tripo-2026-10-19');
const LEDGER = join(PACK, 'ledger.json');
const OUT = join(ROOT, 'public', 'models', 'buildings');
const TRIPO = 'https://api.tripo3d.ai/v2/openapi';
const VERSION = process.env.TRIPO_MODEL_VERSION ?? 'v3.1-20260211';
const FACES = Number(process.env.FACES ?? 4000);

const STYLE =
  'Single isolated 3D game asset render of one historically accurate building, physically based materials, soft even daylight, ' +
  'standing on a small flat patch of bare earth, plain pure white background, whole building visible and centred, ' +
  'three-quarter view from above, compact chunky readable silhouette, no people, no water, no text, no watermark.';

const NATIONS = {
  joseon: 'Joseon Korea, 1592 (Imjin War): Korean timber architecture, grey giwa tile roofs with gently upturned eaves, dancheong painted brackets, granite stone walls (eupseong / sanseong), white plaster, blue-red-yellow Joseon banners',
  japan: 'Sengoku-period Japan, 1592: black-lacquered timber and white plaster walls, dark grey kawara tile roofs with steep curved gables, sloping ishigaki dry-stone castle bases, white nobori banners with black crests',
  ming: 'Ming dynasty China, late 16th century: grey brick walls with crenellations, glazed grey-green tile roofs with sweeping ridge ornaments, red lacquered pillars, yellow Ming banners',
  spain: 'Habsburg Spain, 1588: whitewashed lime-plaster walls, ochre sandstone, terracotta roof tiles, Renaissance arches, red Burgundy-cross flags',
  england: 'Tudor England, 1588: half-timbered oak and wattle, red brick, grey slate or thatch roofs, coursed grey stone, St George cross flags',
  ottoman: 'Ottoman Empire, 1571: cut limestone masonry, lead-covered domes, pointed arches, round towers with conical lead roofs, red flags with crescent',
  venice: 'Republic of Venice, 1571 (Arsenale style): red brick with white Istrian stone trim, terracotta tiles, crenellated walls, red-gold winged lion of St Mark banners',
  france: 'Bourbon France, 1805: Vauban-style dressed limestone bastions, blue-grey slate mansard roofs, rendered walls, French tricolour flags',
};

const KINDS = {
  fortress: 'a coastal fortress: a compact walled stronghold with gate, towers and a main keep or hall',
  arsenal: 'a military arsenal / armoury: a long storehouse workshop for weapons and cannon with a yard of stacked cannon barrels',
  shipyard: 'a naval shipyard: a timber slipway with an unfinished wooden warship hull on stocks, a roofed shed and stacked timber',
  battery: 'a coastal gun battery: a low earth-and-stone gun emplacement with several period cannons behind a parapet',
  magazine: 'a gunpowder magazine: a small thick-walled windowless stone powder house with a heavy door and a few powder barrels',
  dock: 'a harbour pier: a wooden jetty on piles with a small harbour storehouse, bollards and crates',
  beacon: 'a signal beacon tower: a stone fire-signal tower with a fire basin on top for smoke and fire signals',
  camp: 'a military camp: a flat cleared compound with a palisade and several small barracks huts or tents in rows, a commander hut and banners',
};
// Kind detail that only fits one nation.
const LOCAL = {
  'joseon:beacon': 'a Joseon bongsu beacon platform: round granite base with five chimney-like smoke stacks in a row',
  'joseon:fortress': 'a Joseon suyeong naval headquarters fortress: curved granite wall with a two-storey gate pavilion',
  'japan:fortress': 'a Japanese wajo castle: sloping ishigaki stone base with a small multi-storey tenshu keep',
  'ming:beacon': 'a Ming fenghuotai beacon tower: square tapering brick tower with crenellated top',
  'venice:arsenal': 'a Venetian Arsenale gateway and covered boathouse with brick walls',
};

const kinds = Object.keys(KINDS);
const ledger = existsSync(LEDGER) ? JSON.parse(await readFile(LEDGER, 'utf8')) : { tasks: {}, images: {} };
const save = () => writeFile(LEDGER, JSON.stringify(ledger, null, 2));
const sha = (b) => createHash('sha256').update(b).digest('hex');

function targets(args) {
  const list = [];
  for (const a of args.length ? args : ['joseon', 'japan', 'ming']) {
    const [n, k] = a.split(':');
    for (const kind of k ? [k] : kinds) list.push(`${n}:${kind}`);
  }
  return list;
}

function prompt(key) {
  const [n, k] = key.split(':');
  return `${LOCAL[key] ?? KINDS[k]}, in the architectural style of ${NATIONS[n]}. ${STYLE}`;
}

async function concept(key) {
  const out = join(PACK, 'concepts', `${key.replace(':', '__')}.png`);
  if (existsSync(out)) return;
  const text = prompt(key);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_IMAGE_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } } }),
  });
  const json = await res.json();
  const img = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!img) throw new Error(`${key}: ${JSON.stringify(json).slice(0, 300)}`);
  const buf = Buffer.from(img.inlineData.data, 'base64');
  await mkdir(join(PACK, 'concepts'), { recursive: true });
  await writeFile(out, buf);
  ledger.images[key] = { provider: 'gemini', model: process.env.GEMINI_IMAGE_MODEL, prompt: text, sha256: sha(buf), usage: json.usageMetadata };
  console.log('concept', key);
}

const auth = () => ({ Authorization: `Bearer ${process.env.TRIPO_API_KEY}` });
const balance = async () => (await (await fetch(`${TRIPO}/user/balance`, { headers: auth() })).json()).data?.balance;

async function submit(key) {
  if (ledger.tasks[key]?.id) return console.log('skip', key, ledger.tasks[key].status);
  const file = join(PACK, 'concepts', `${key.replace(':', '__')}.png`);
  const form = new FormData();
  form.append('file', new Blob([await readFile(file)], { type: 'image/png' }), 'c.png');
  const up = await (await fetch(`${TRIPO}/upload`, { method: 'POST', headers: auth(), body: form })).json();
  if (up.code !== 0) throw new Error(`upload ${key}: ${JSON.stringify(up)}`);
  const request = { type: 'image_to_model', file: { type: 'png', file_token: up.data.image_token ?? up.data.file_token }, texture: true, pbr: true, texture_quality: process.env.TEXQ ?? 'detailed', geometry_quality: process.env.GEOQ ?? 'detailed', face_limit: FACES, model_version: VERSION };
  const before = await balance();
  const json = await (await fetch(`${TRIPO}/task`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(request) })).json();
  if (json.code !== 0) throw new Error(`task ${key}: ${JSON.stringify(json)}`);
  ledger.tasks[key] = { provider: 'tripo', model: VERSION, id: json.data.task_id, request: { ...request, file: { type: 'png' } }, status: 'queued', balanceBefore: before };
  await save();
  console.log('submitted', key, json.data.task_id);
}

async function poll(key) {
  const task = ledger.tasks[key];
  if (!task || ['downloaded', 'failed'].includes(task.status)) return 0;
  const data = (await (await fetch(`${TRIPO}/task/${task.id}`, { headers: auth() })).json()).data ?? {};
  task.status = data.status;
  if (data.status === 'success') {
    const url = data.output?.pbr_model ?? data.output?.model;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    await mkdir(join(PACK, 'originals'), { recursive: true });
    await writeFile(join(PACK, 'originals', `${key.replace(':', '__')}.glb`), buf);
    task.status = 'downloaded';
    task.originalSha256 = sha(buf);
    task.credits = data.consumed_credit ?? data.cost ?? undefined;
  } else if (['failed', 'banned', 'expired', 'cancelled', 'unknown'].includes(data.status)) task.status = 'failed';
  console.log(key, task.status, data.progress ?? '');
  return task.status === 'downloaded' || task.status === 'failed' ? 0 : 1;
}

const gt = (...a) => execFileSync(process.execPath, [join(ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js'), ...a], { stdio: 'pipe' });

async function pack(key) {
  const [n, k] = key.split(':');
  const src = join(PACK, 'originals', `${n}__${k}.glb`);
  if (!existsSync(src)) return;
  await mkdir(join(OUT, n), { recursive: true });
  const near = join(OUT, n, `${k}.glb`);
  const far = join(OUT, n, `${k}_lod1.glb`);
  const common = ['--compress', 'meshopt', '--texture-compress', 'webp', '--join', 'true', '--flatten', 'true', '--palette', 'false'];
  gt('optimize', src, near, ...common, '--texture-size', '1024', '--simplify', 'false');
  gt('optimize', src, far, ...common, '--texture-size', '256', '--simplify', 'true', '--simplify-ratio', '0.1', '--simplify-error', '0.1', '--simplify-lock-border', 'false');
  const files = {};
  for (const f of [near, far]) {
    const buf = await readFile(f);
    files[f.slice(ROOT.length + 1).replace(/\\/g, '/')] = { sha256: sha(buf), size: (await stat(f)).size };
  }
  ledger.tasks[key].runtime = files;
  console.log('packed', key, Object.values(files).map((f) => f.size).join(' / '));
}

const [cmd, ...args] = process.argv.slice(2);
const list = targets(args.filter((a) => !a.startsWith('--')));
await mkdir(PACK, { recursive: true });
if (cmd === 'concept') await Promise.all(list.map((k) => concept(k).catch((e) => console.error('fail', e.message))));
else if (cmd === 'submit') for (const k of list) await submit(k);
else if (cmd === 'poll') {
  for (;;) {
    let pending = 0;
    for (const k of list) pending += await poll(k).catch((e) => (console.error(k, e.message), 1));
    await save();
    if (!pending || !args.includes('--wait')) break;
    await new Promise((r) => setTimeout(r, 20000));
  }
} else if (cmd === 'pack') for (const k of list) await pack(k);
else if (cmd === 'balance') console.log(await balance());
await save();
// Provenance the model vault reads (`npm run assets -- models`).
const provenance = { tool: 'scripts/building-models.mjs', provider: 'tripo', model: VERSION, conceptModel: process.env.GEMINI_IMAGE_MODEL, images: ledger.images, tasks: ledger.tasks };
await writeFile(join(PACK, 'provenance.json'), JSON.stringify(provenance, null, 2));
