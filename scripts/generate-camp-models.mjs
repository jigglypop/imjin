// The camps of the faction campaign map (진영 전역) as Meshy models: three navies by three camp tiers. This script holds
// only the paid steps: a concept image per camp from the OpenAI Images API, then one Meshy Image-to-3D task per chosen
// image. Every request, task id, parameter, credit and hash goes into assets-src/camps-meshy-2026-10-13/provenance.json;
// scripts/build-camp-models.mjs turns the downloaded originals into public/models/camps/* without contacting anyone.
//
//   node scripts/generate-camp-models.mjs balance                                  Meshy credits left (recorded)
//   node scripts/generate-camp-models.mjs concept --id=joseon-1,japan-1            one image request per id
//        [--from=joseon-1|none] [--extra="..."]                                    tiers 2 and 3 edit the chosen tier below
//   node scripts/generate-camp-models.mjs choose --id=joseon-1 --variant=2 --note="why"
//   node scripts/generate-camp-models.mjs submit --id=joseon-1 --confirm-spend     one Meshy task (30 credits)
//   node scripts/generate-camp-models.mjs poll [--wait]                            status; a finished model lands in originals/
//   node scripts/generate-camp-models.mjs reject --id=joseon-1 --reason="..."      allows one more charged attempt
//   node scripts/generate-camp-models.mjs status
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const PKG = join(ROOT, 'assets-src', 'camps-meshy-2026-10-13');
const MANIFEST = join(PKG, 'provenance.json');
const rel = (path) => path.slice(ROOT.length).replace(/\\/g, '/').replace(/^\//, '');

const args = Object.fromEntries(process.argv.slice(3).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
const command = process.argv[2];

// ---------- art direction ----------

const IMAGE = { model: 'gpt-image-2.5-sunburst', size: '1024x1024', quality: 'high', background: 'transparent', output_format: 'png', requestBudget: 20 };

const STYLE =
  'A single isolated 3D game-asset render made for image-to-3D conversion. One compact sixteenth-century naval camp modelled as a single object ' +
  'standing on its own thin, flat ground base of packed earth and short grass, only a few centimetres thick, with softly bevelled edges, the base about as deep as it is wide. ' +
  'Camera: high three-quarter view about 40 degrees above the horizon, looking at one corner of the base so two sides are visible; ' +
  'the whole model is centred and completely inside the frame with a generous empty margin all round. ' +
  'Lighting: soft, even, shadowless studio light from all sides, no cast shadows, no dark ambient-occlusion halos. ' +
  'Look: clean stylised realism like a premium historical strategy-game building, chunky simplified architecture with large clearly readable roofs ' +
  'and strong clean colours that still read when the model is tiny on screen; no fine clutter, no small props. ' +
  'The waterfront is on ONE side only: the left-front edge of the base, where the jetty or quay projects out toward the lower left of the picture, its deck level with the base. ' +
  'Transparent background. Nothing beyond the base: no water, no sea, no terrain or trees outside the base, no ships or boats, no people, no animals. ' +
  'Absolutely no text, letters, characters, numbers, logos, emblems or crests anywhere, no rising-sun flag, no sunburst, no watermark, no border.';

const FACTION = {
  joseon: 'Joseon Korean navy, 1592: grey ceramic-tiled roofs with gracefully upturned eaves and white mortar ridges, white lime-plaster walls framed by dark brown timber, grey granite and rammed-earth walls, plain blue and plain white cloth banners with no emblem.',
  japan: 'Sengoku Japanese navy, 1592, in the style of a wajo coastal fortress: white plaster walls standing on steeply sloped fitted grey stone bases, black and dark grey tiled roofs with curved gables, dark timber, plain white and plain red cloth nobori banners with no emblem or symbol of any kind.',
  ming: 'Ming Chinese navy, 1598: grey brick walls with crenellated battlements, red-lacquered timber gate towers with yellow-glazed tiled roofs, grey stone, grey-tiled barracks, plain red and plain yellow cloth banners with no emblem.',
};

const TIER = {
  'joseon-1': 'TIER 1, a modest new camp: a ring of sharpened upright log palisade with one simple timber gate around a small earthen yard, two small thatched huts and one small grey-tiled hut, a tall pole with a plain blue banner, and a short timber jetty on the waterfront side.',
  'joseon-2': 'TIER 2, a walled naval station: a continuous wall of grey granite blocks topped with a white plastered parapet, a gate with a small grey-tiled gate pavilion, a wooden watchtower, two long grey-tiled barracks and a storehouse inside, plain blue and white banners, and a broad timber pier on the waterfront side.',
  'joseon-3': 'TIER 3, a fortress port: high grey granite fortress walls with crenellated white parapets and four corner towers with small tiled pavilions, a fortified gate, in the centre a large Joseon command hall on a raised stone platform with many dark red pillars and a huge grey hip-and-gable tiled roof with upturned eaves, tiled barracks, bronze cannon emplacements on the ramparts, and a long straight stone quay along the waterfront side with a roofed boathouse dock, empty, no ship.',
  'japan-1': 'TIER 1, a modest new camp: a ring of sharpened upright log palisade partly hung with plain white cloth curtain screens, one simple gate, three white canvas tents and a small dark-roofed timber hut around a small yard, tall plain white and plain red nobori banners, and a short timber jetty on the waterfront side.',
  'japan-2': 'TIER 2, a walled naval station: a wall of white plaster on a sloped fitted stone base with dark tiled coping, a gate with a white plaster turret over it, a two-storey white corner turret (yagura) with black tiled roofs, two dark-tiled barracks and a storehouse inside, plain white and red banners, and a timber pier on the waterfront side.',
  'japan-3': 'TIER 3, a fortress port (wajo): tiers of steeply sloped stone walls topped with white plaster walls, white two-storey corner turrets, a fortified gate, in the centre a tall four-storey white tenshu keep with black tiled roofs and curved gables, dark-tiled barracks, cannon emplacements on the walls, plain white and red banners, and a long straight stone quay along the waterfront side with a roofed dock, empty, no ship.',
  'ming-1': 'TIER 1, a modest new camp: a square palisade of sharpened upright logs with one simple gate around a small earthen yard, a tall square wooden watchtower, three canvas tents and a small grey-tiled hut, plain red and plain yellow banners, and a short timber jetty on the waterfront side.',
  'ming-2': 'TIER 2, a walled naval station: a square grey brick wall with crenellated battlements, a gate with a red-lacquered gate tower under a yellow-glazed tiled roof, a brick watchtower at one corner, two grey-tiled barracks and a storehouse inside, plain red and yellow banners, and a timber pier on the waterfront side.',
  'ming-3': 'TIER 3, a fortress port: a square fortress of high grey brick walls with crenellated battlements and four square corner towers, over the main gate a great two-storey red-lacquered gate tower with double yellow-glazed tiled roofs, grey-tiled barracks and a yellow-roofed hall inside, cannon emplacements on the walls, plain red and yellow banners, and a long straight stone quay along the waterfront side with a roofed dock, empty, no ship.',
};

/** Said when a tier is drawn as an edit of the tier below, so a navy's three tiers share one look. */
const GROW =
  'The reference image is the previous tier of this very camp. Keep exactly its rendering style, lighting, camera angle, base size and shape, ' +
  'colour palette and transparent background, and keep the waterfront on the same left-front side; rebuild the camp on that base as follows. ';

/** Meshy texturing text, at most 800 characters with the tier clause. */
const TEXTURE = {
  joseon: 'Joseon Korean naval camp, stylised realistic hand-painted look: grey ceramic roof tiles with white mortar ridges, white lime-plaster walls, dark brown timber, grey granite blocks, packed light-brown earth ground with short green grass at the edges, weathered grey-brown timber decks, plain blue and plain white cloth banners.',
  japan: 'Sengoku Japanese naval fortress, stylised realistic hand-painted look: black and dark grey roof tiles, bright white plaster walls, dark timber, grey fitted stone bases, packed light-brown earth ground with short green grass at the edges, weathered grey-brown timber decks, plain white and plain red cloth banners.',
  ming: 'Ming Chinese naval fort, stylised realistic hand-painted look: grey brick walls and battlements, red-lacquered timber, yellow-glazed roof tiles on the gate towers, grey roof tiles on the barracks, grey stone, packed light-brown earth ground with short green grass at the edges, weathered grey-brown timber decks, plain red and plain yellow cloth banners.',
};
const TEXTURE_TAIL = ' Matte surfaces, even soft lighting, no baked shadows, no text, no letters, no emblems, no logos.';
const TEXTURE_TIER = { 1: ' Sharpened log palisade, small huts and tents.', 2: ' Stone or brick walls, tiled barracks.', 3: ' Fortress walls, corner towers, dark bronze cannons, stone quay.' };

const MESHY = {
  provider: 'Meshy', endpoint: 'https://api.meshy.ai/openapi/v1/image-to-3d', apiModel: 'meshy-7.1', creditsPerTask: 30, hardCreditCeiling: 400, maxChargedAttemptsPerModel: 2,
  pricingSource: 'https://docs.meshy.ai/en/api/pricing', pricingVerifiedAt: '2026-10-13', pricingNote: 'meshy-7.1 mesh with 2K texture: 30 credits; failed tasks are refunded',
};
const polycount = (tier) => (tier === 3 ? 15000 : 12000);
const ACTIVE = new Set(['SUBMITTING', 'SUBMITTED', 'PENDING', 'IN_PROGRESS']);
const IDS = Object.keys(TIER);

// ---------- manifest ----------

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();
const fail = (message) => { console.error(message); process.exit(1); };

function load() {
  if (existsSync(MANIFEST)) return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  return {
    schema: 'imjin.camps-meshy.v1',
    purpose: 'Faction camp models for the 3D campaign map (진영 전역): joseon, japan and ming navies at camp tiers 1-3.',
    images: { provider: 'OpenAI Images API', ...IMAGE, style: STYLE, factions: FACTION, tiers: TIER, grow: GROW },
    meshy: { ...MESHY, texturePrompts: TEXTURE, textureTail: TEXTURE_TAIL, textureTier: TEXTURE_TIER, balance: [] },
    imageRequests: [],
    models: Object.fromEntries(IDS.map((id) => [id, { faction: id.split('-')[0], tier: Number(id.split('-')[1]), concept: null, attempts: [] }])),
  };
}
const manifest = load();
function save() {
  mkdirSync(PKG, { recursive: true });
  const temp = `${MANIFEST}.tmp`;
  writeFileSync(temp, JSON.stringify(manifest, null, 2) + '\n');
  renameSync(temp, MANIFEST);
}
const model = (id) => manifest.models[id] ?? fail(`unknown camp ${id}; one of ${IDS.join(', ')}`);

// ---------- OpenAI concept images ----------

function conceptPrompt(id, from, extra) {
  const faction = id.split('-')[0];
  return `${STYLE} ${FACTION[faction]} ${from ? GROW : ''}${TIER[id]}${extra ? ` ${extra}` : ''}`;
}

/** Requests that count against the budget: all but uploads the server dropped before it had the whole request. */
const billable = () => manifest.imageRequests.filter((r) => r.billable !== false).length;

async function concept(id, from, extra) {
  model(id);
  if (billable() >= IMAGE.requestBudget && !args['over-budget']) fail(`image request budget of ${IMAGE.requestBudget} is spent`);
  const reference = from ? manifest.models[from]?.concept : null;
  if (from && !reference) fail(`${from} has no chosen concept to edit from`);
  const prompt = conceptPrompt(id, from, extra);
  const variant = manifest.imageRequests.filter((r) => r.id === id && r.status === 'done').length + 1;
  const file = join(PKG, 'candidates', `${id}-v${variant}.png`);
  // The reference goes up as a small lossy WebP: multipart uploads of the 1.3 MB PNG were often cut off by the far side.
  const upload = from ? await sharp(await readFile(join(ROOT, reference.file))).webp({ quality: 92, alphaQuality: 100 }).toBuffer() : null;
  const auth = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
  for (let attempt = 1; ; attempt += 1) {
    const entry = { n: manifest.imageRequests.length + 1, id, variant, kind: from ? 'edit' : 'generate',
      from: from ? { id: from, file: reference.file, sha256: reference.sha256, upload: 'WebP quality 92 of that file', uploadSha256: sha256(upload) } : null,
      model: IMAGE.model, size: IMAGE.size, quality: IMAGE.quality, background: IMAGE.background, output_format: IMAGE.output_format, prompt, extra: extra ?? null,
      requestedAt: now(), status: 'requested' };
    manifest.imageRequests.push(entry);
    save();
    const started = Date.now();
    let res;
    try {
      if (!from) {
        res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: IMAGE.model, prompt, size: IMAGE.size, quality: IMAGE.quality, background: IMAGE.background, output_format: IMAGE.output_format, n: 1 }),
        });
      } else {
        const form = new FormData();
        for (const [k, v] of Object.entries({ model: IMAGE.model, prompt, size: IMAGE.size, quality: IMAGE.quality, background: IMAGE.background, output_format: IMAGE.output_format, n: '1' })) form.set(k, v);
        form.set('image', new Blob([upload], { type: 'image/webp' }), 'previous-tier.webp');
        res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: auth, body: form });
      }
    } catch (error) {
      entry.status = 'failed';
      entry.error = `network: ${error.message} ${error.cause?.code ?? ''} ${error.cause?.message ?? ''}`.trim();
      // Dropped within seconds, while the request was still going up: nothing was generated, so it is retried and not billed.
      // A later drop may have come after the image was made, so it counts.
      const quick = Date.now() - started < 10000;
      if (quick) entry.billable = false;
      save();
      if (quick && attempt < 4) { await new Promise((r) => setTimeout(r, 3000)); continue; }
      throw new Error(`${id}: ${entry.error}`);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.data?.[0]?.b64_json) {
      entry.status = 'failed';
      entry.error = `${res.status} ${json.error?.message ?? 'no image'}`.slice(0, 400);
      save();
      throw new Error(`${id}: ${entry.error}`);
    }
    const bytes = Buffer.from(json.data[0].b64_json, 'base64');
    await mkdir(join(PKG, 'candidates'), { recursive: true });
    await writeFile(file, bytes);
    Object.assign(entry, { status: 'done', finishedAt: now(), file: rel(file), sha256: sha256(bytes), bytes: bytes.length, revisedPrompt: json.data[0].revised_prompt ?? null, usage: json.usage ?? null });
    save();
    console.log(`${id} v${variant}: ${rel(file)}`);
    return;
  }
}

const PREPARE = 'alpha below 32 (the faint glow the model paints round banners) cleared, alpha from 224 opaque, colour composited over white, so the image reads the same whether or not alpha is honoured';
/** The image Meshy gets: the generated pixels with the glow cut and a white ground under whatever is transparent. */
async function prepare(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] < 32 ? 0 : data[i + 3] >= 224 ? 255 : Math.round(((data[i + 3] - 32) / 192) * 255);
    for (let c = 0; c < 3; c += 1) data[i + c] = Math.round((data[i + c] * a + 255 * (255 - a)) / 255);
    data[i + 3] = a;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}

/** The words behind a chosen concept, kept beside it: the image request's prompt and what Meshy is told to paint. */
const promptsText = (id, request) =>
  `${request.model}, ${request.kind}${request.from ? ` of the chosen ${request.from.id} concept` : ''}, ${request.size}, quality ${request.quality}, background ${request.background}:\n` +
  `${request.prompt}\n\nMeshy ${MESHY.apiModel} texture_prompt:\n${texturePrompt(id)}\n`;

async function choose(id, variant, note) {
  const m = model(id);
  const request = manifest.imageRequests.find((r) => r.id === id && r.variant === variant && r.status === 'done');
  if (!request) fail(`${id} has no finished variant ${variant}`);
  const last = m.attempts.at(-1);
  if (last && (ACTIVE.has(last.status) || !last.rejectionReason)) fail(`${id} already went to Meshy; reject that attempt before changing its image`);
  const source = await readFile(join(ROOT, request.file));
  if (sha256(source) !== request.sha256) fail(`${request.file} changed since it was generated`);
  const target = join(PKG, 'concepts', `${id}.png`);
  await mkdir(join(PKG, 'concepts'), { recursive: true });
  await writeFile(target, await prepare(source));
  for (const r of manifest.imageRequests) if (r.id === id) r.chosen = r.variant === variant;
  // A replaced concept stays on record: a rejected attempt names the file, which now holds the new image.
  if (m.concept) (m.conceptHistory ??= []).push({ ...m.concept, replacedAt: now() });
  m.concept = { file: rel(target), sha256: sha256(await readFile(target)), source: request.file, sourceSha256: request.sha256, processing: PREPARE, variant, request: request.n,
    chosenBy: 'agent review (delegated by the owner brief)', note: note ?? '', chosenAt: now() };
  await writeFile(join(PKG, 'concepts', `${id}.txt`), promptsText(id, request));
  save();
  console.log(`${id}: concept v${variant} -> ${rel(target)}`);
}

// ---------- Meshy ----------

async function meshy(method, url, payload) {
  const res = await fetch(url, {
    method, headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meshy ${method} ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

async function balance(label) {
  const { balance } = await meshy('GET', 'https://api.meshy.ai/openapi/v1/balance');
  manifest.meshy.balance.push({ at: now(), balance, label: label ?? '' });
  save();
  console.log(`Meshy balance: ${balance}`);
  return balance;
}

/** Credits already charged plus a full task for every attempt still running. */
function committed() {
  let total = 0;
  for (const m of Object.values(manifest.models)) for (const a of m.attempts) {
    if (ACTIVE.has(a.status)) total += Math.max(a.consumedCredits ?? 0, MESHY.creditsPerTask);
    else total += a.consumedCredits ?? 0;
  }
  return total;
}

function texturePrompt(id) {
  const m = model(id);
  const text = TEXTURE[m.faction] + TEXTURE_TIER[m.tier] + TEXTURE_TAIL;
  if (text.length > 800) fail(`${id}: texture prompt is ${text.length} characters`);
  return text;
}

async function submit(id) {
  const m = model(id);
  if (!m.concept) fail(`${id} has no chosen concept`);
  const image = await readFile(join(ROOT, m.concept.file));
  if (sha256(image) !== m.concept.sha256) fail(`${id}: concept file changed since it was chosen`);
  if (m.attempts.some((a) => ACTIVE.has(a.status))) fail(`${id} already has an active or unresolved attempt`);
  const charged = m.attempts.filter((a) => (a.consumedCredits ?? 0) > 0);
  if (charged.length >= MESHY.maxChargedAttemptsPerModel) fail(`${id} already has ${charged.length} charged attempts`);
  if (charged.length && !charged.at(-1).rejectionReason) fail(`${id}: a retry needs a rejection reason on the previous attempt`);
  if (committed() + MESHY.creditsPerTask > MESHY.hardCreditCeiling) fail(`a task would pass the ${MESHY.hardCreditCeiling} credit ceiling (${committed()} committed)`);
  const request = {
    ai_model: MESHY.apiModel, model_type: 'standard', should_texture: true, enable_pbr: false, texture_resolution: '2k',
    should_remesh: true, topology: 'triangle', target_polycount: polycount(m.tier), target_formats: ['glb'],
    texture_prompt: texturePrompt(id), image_enhancement: false, moderation: true, multi_view_thumbnails: true,
  };
  if (!args['confirm-spend']) {
    console.log(JSON.stringify({ ...request, imageSha256: m.concept.sha256 }, null, 2));
    fail('dry run: add --confirm-spend to submit');
  }
  const attempt = { number: m.attempts.length + 1, status: 'SUBMITTING', taskId: null, createdAt: now(),
    request: { ...request, imageSha256: m.concept.sha256, imageFile: m.concept.file, imageSource: m.concept.source, imageVariant: m.concept.variant },
    consumedCredits: null, rejectionReason: '' };
  m.attempts.push(attempt);
  save();
  const json = await meshy('POST', MESHY.endpoint, { image_url: `data:image/png;base64,${image.toString('base64')}`, ...request });
  if (typeof json.result !== 'string' || !json.result) fail(`${id}: Meshy did not return a task id; the attempt stays SUBMITTING`);
  Object.assign(attempt, { taskId: json.result, status: 'SUBMITTED', submittedAt: now() });
  save();
  console.log(`${id}: task ${json.result}`);
}

async function download(url, file) {
  const host = new URL(url).hostname;
  if (!(host === 'meshy.ai' || host.endsWith('.meshy.ai'))) throw new Error(`untrusted download host ${host}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(file, bytes);
  return bytes;
}

async function poll() {
  let pending = 0;
  for (const [id, m] of Object.entries(manifest.models)) {
    for (const a of m.attempts) {
      if (!a.taskId || !ACTIVE.has(a.status)) continue;
      const task = await meshy('GET', `${MESHY.endpoint}/${encodeURIComponent(a.taskId)}`);
      // Signed download URLs expire and are not kept.
      a.task = { id: task.id, status: task.status, progress: task.progress, created_at: task.created_at, started_at: task.started_at, finished_at: task.finished_at,
        consumed_credits: task.consumed_credits, task_error: task.task_error?.message ? task.task_error : undefined };
      a.status = task.status;
      a.consumedCredits = task.consumed_credits ?? a.consumedCredits;
      a.checkedAt = now();
      if (task.status === 'SUCCEEDED') {
        await mkdir(join(PKG, 'originals'), { recursive: true });
        await mkdir(join(PKG, 'candidates', 'meshy'), { recursive: true });
        const file = join(PKG, 'originals', `${id}-a${a.number}.glb`);
        const bytes = await download(task.model_urls.glb, file);
        a.original = { file: rel(file), sha256: sha256(bytes), bytes: bytes.length, downloadedAt: now() };
        // Meshy's own four previews are only a quick look; one that fails to download is skipped.
        for (const [view, url] of Object.entries(task.thumbnail_urls ?? {})) await download(url, join(PKG, 'candidates', 'meshy', `${id}-a${a.number}-${view}.png`)).catch(() => {});
      } else if (ACTIVE.has(task.status)) pending += 1;
      save();
      console.log(`${id} a${a.number} ${a.taskId}: ${task.status} ${task.progress ?? ''}% credits=${a.consumedCredits ?? '-'}${task.task_error?.message ? ` error=${task.task_error.message}` : ''}`);
    }
  }
  return pending;
}

function status() {
  for (const [id, m] of Object.entries(manifest.models)) {
    const attempts = m.attempts.map((a) => `a${a.number}:${a.status}${a.consumedCredits ? `/${a.consumedCredits}cr` : ''}${a.rejectionReason ? '(rejected)' : ''}`).join(' ');
    console.log(`${id.padEnd(9)} concept=${m.concept ? `v${m.concept.variant}` : '-'} ${attempts}`);
  }
  console.log(`image requests: ${billable()}/${IMAGE.requestBudget} billable (${manifest.imageRequests.length} sent); Meshy credits committed: ${committed()}/${MESHY.hardCreditCeiling}`);
}

// ---------- commands ----------

const ids = (args.id ?? '').split(',').filter(Boolean);
if (command === 'balance') await balance(args.label);
else if (command === 'concept') {
  if (!process.env.OPENAI_API_KEY) fail('OPENAI_API_KEY missing (.env)');
  if (ids.length + billable() > IMAGE.requestBudget && !args['over-budget']) fail('these requests would pass the image budget');
  const results = await Promise.allSettled(ids.map((id) => {
    const tier = Number(id.split('-')[1]);
    const from = args.from === 'none' ? null : args.from ?? (tier > 1 ? `${id.split('-')[0]}-${tier - 1}` : null);
    return concept(id, from, args.extra);
  }));
  for (const r of results) if (r.status === 'rejected') console.error(String(r.reason?.message ?? r.reason));
} else if (command === 'choose') for (const id of ids) await choose(id, Number(args.variant), args.note);
else if (command === 'submit') {
  if (!process.env.MESHY_API_KEY) fail('MESHY_API_KEY missing (.env)');
  for (const id of ids) await submit(id);
} else if (command === 'poll') {
  for (;;) {
    const pending = await poll();
    if (!args.wait || pending === 0) break;
    await new Promise((r) => setTimeout(r, 20000));
  }
} else if (command === 'reject') {
  if (!args.reason?.trim()) fail('a rejection needs --reason');
  for (const id of ids) {
    const a = model(id).attempts.at(-1);
    if (!a || ACTIVE.has(a.status)) fail(`${id} has no finished attempt to reject`);
    Object.assign(a, { rejectionReason: args.reason.trim(), rejectedAt: now() });
  }
  save();
} else if (command === 'status') status();
else console.log('usage: node scripts/generate-camp-models.mjs balance|concept|choose|submit|poll|reject|status (see the header)');
