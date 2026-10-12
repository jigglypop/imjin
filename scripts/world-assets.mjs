// Concept images (OpenAI Images) and guarded Meshy image-to-3D jobs for the faction campaign's
// settlement models. Paid Meshy jobs need --confirm-spend and --ceiling, are submitted one at a
// time and are all recorded in the ledger before and after the request, so a crash mid-job
// never hides a spent credit.
//
//   node scripts/world-assets.mjs concepts <id> [--n=3] [--out=<dir>] [--tag=a]
//   node scripts/world-assets.mjs balance
//   node scripts/world-assets.mjs submit <id> --image=<png> --ceiling=240 --confirm-spend [--retry="reason"]
//   node scripts/world-assets.mjs poll <id>        (waits, then downloads the GLB into meshes/)
//   node scripts/world-assets.mjs reject <id> --reason="..."
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, 'assets-src/world-models-2026-10-12');
const LEDGER = join(DIR, 'ledger.json');
// The keys live only in the main checkout's .env (worktrees have none); never print them.
for (const env of [join(ROOT, '.env'), process.env.IMJIN_ENV].filter(Boolean)) if (existsSync(env)) process.loadEnvFile(env);

const MESHY = 'https://api.meshy.ai/openapi/v1';
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-sunburst';
const CREDITS_PER_TASK = 30;
// Never leave the account below one more job, whatever the ceiling says.
const FLOOR = 32;

const VIEW =
  'Single isolated game asset, a compact diorama of one settlement standing on a plain flat square-ish ground base of packed earth, ' +
  'seen from above at about 45 degrees in a three-quarter view, the whole object and its base fully visible and centered with a generous margin, ' +
  'stylized-realistic game-ready 3D model render, chunky readable forms and a strong silhouette, no tiny details, weathered natural materials, ' +
  'muted palette of grey stone, warm timber, straw and dark tile with only small accents of colour, soft even studio lighting, ' +
  'plain pure white background, no water, no people, no animals, no text, no watermark, no border.';

export const ASSETS = {
  wajo: {
    faction: 'japan', levels: [3, 4], kind: 'fort',
    prompt:
      'A Japanese wajo castle fort built during the Imjin War (1592-1598) on the Korean coast: a tall sloped dry-stone ishigaki platform of large grey fitted stones, ' +
      'on it a three-tier white-plaster castle keep (tenshu) with dark grey tiled gabled roofs and curved eaves, a surrounding low stone wall topped with a white plaster parapet, ' +
      'two small corner turrets (yagura) with dark tiled roofs, and one gate with a tiled roof at the front. ',
    texture: 'Grey weathered granite stone base, white lime plaster walls, dark charcoal grey ceramic roof tiles, dark brown timber, matte aged materials, no baked shadows.',
  },
  joseon_fort: {
    faction: 'joseon', levels: [3, 4], kind: 'fort',
    prompt:
      'A Joseon Korean naval fortress (suyeong) of 1592 on the coast: an enclosing wall of grey fieldstone and earth, at the front a stone gateway topped by a wooden gate pavilion (nugak) with a dark grey giwa tiled roof, ' +
      'inside a two-storey command pavilion with red-brown wooden pillars and a sweeping dark grey giwa tiled hip-and-gable roof with upturned eaves, two long low tiled-roof barracks, ' +
      'a small wooden watch tower, and two flag poles with blue banners. ',
    texture: 'Grey fieldstone and earth wall, dark red-brown timber pillars, white plaster, dark charcoal grey giwa roof tiles, small blue banners, matte aged materials, no baked shadows.',
  },
  ming_fort: {
    faction: 'ming', levels: [3, 4], kind: 'fort',
    prompt:
      'A Ming dynasty Chinese coastal guard fortress (weisuo) of the 1590s: a square enclosure of thick grey brick walls with crenellated battlements, ' +
      'a large two-storey square gate tower over an arched gateway at the front with a grey-green glazed tiled hip roof, small square watch towers on the corners with tiled roofs, ' +
      'a few low tiled-roof buildings inside, and two poles with red and yellow banners. ',
    texture: 'Grey weathered brick walls, dark red timber, grey-green glazed roof tiles, small red and yellow banners, matte aged materials, no baked shadows.',
  },
  joseon_village: {
    faction: 'joseon', levels: [1, 2], kind: 'village',
    prompt:
      'A small Joseon Korean fishing village of the 16th century: a tight cluster of six or seven low thatched-roof (choga) houses with thick rounded golden straw roofs and pale mud walls on low stone bases, ' +
      'two houses with dark grey tiled roofs, a round straw stack, low woven wattle fences between the houses, and a small wooden rack with drying fish. ',
    texture: 'Golden-brown rice straw thatch, pale ochre clay walls, dark brown timber, grey fieldstone, dark charcoal roof tiles, matte aged materials, no baked shadows.',
  },
  japan_camp: {
    faction: 'japan', levels: [1, 2], kind: 'camp',
    prompt:
      'A Japanese samurai army field camp (jinmaku) of the Sengoku period, 1592: a rectangular ring of tall white cloth curtains on wooden posts with one large black circular family crest on each panel, ' +
      'inside it a larger open-fronted command tent and three low tents, several tall vertical white nobori banners, stacked straw rice bales and a small wooden watch platform on stilts. ',
    texture: 'Off-white cotton curtains with simple black crests, dark brown wooden posts, golden straw bales, beige canvas tents, matte aged materials, no baked shadows.',
  },
  ming_camp: {
    faction: 'ming', levels: [1, 2], kind: 'camp',
    prompt:
      'A Ming dynasty Chinese army camp of the 1590s: a square palisade of sharpened vertical logs with a wooden gate at the front, inside several ridge tents of beige canvas, ' +
      'a tall watch tower of lashed timber poles with a small platform, and a few square red and yellow flags on poles. ',
    texture: 'Weathered brown timber logs, beige canvas tents, rope lashing, small red and yellow flags, packed earth, matte aged materials, no baked shadows.',
  },
  harbor: {
    faction: 'any', levels: [2, 3, 4], kind: 'harbor',
    prompt:
      'A small 16th-century East Asian wooden harbor on a flat earth shore base: a wooden quay of heavy planks on posts with one short pier sticking out at the front, ' +
      'two small wooden fishing boats and one small junk resting beside the pier on the base, stacked wooden crates, barrels and sacks of cargo on the quay, and a wooden frame with drying fishing nets. ' +
      'The water is not shown, the boats sit on the ground. ',
    texture: 'Weathered grey-brown timber planks and posts, dark wood boats, tan woven sails and nets, burlap sacks, matte aged materials, no baked shadows.',
  },
  japan_village: {
    faction: 'japan', levels: [1, 2], kind: 'village',
    prompt:
      'A small Japanese coastal fishing village of the late 16th century: a cluster of five or six simple wooden houses with dark wooden walls, some with grey wooden shingle roofs held by stones and some with thick thatched roofs, ' +
      'low bamboo fences, a few fishing baskets and one small red-orange wooden torii shrine gate at the edge. ',
    texture: 'Dark weathered timber walls, grey wooden shingles, golden-brown thatch, bamboo, one small vermilion torii, matte aged materials, no baked shadows.',
  },
};

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const today = () => new Date().toISOString();

function readLedger() {
  if (!existsSync(LEDGER)) return { schema: 'imjin.world-models-ledger.v1', ceilingCredits: 240, creditsPerTask: CREDITS_PER_TASK, entries: [] };
  return JSON.parse(readFileSync(LEDGER, 'utf8'));
}

function writeLedger(ledger) {
  mkdirSync(DIR, { recursive: true });
  const temp = `${LEDGER}.tmp`;
  writeFileSync(temp, JSON.stringify(ledger, null, 2) + '\n');
  renameSync(temp, LEDGER);
}

// A task counts as spent from the moment it is submitted; only a provider-confirmed figure replaces the estimate.
const spent = (ledger) => ledger.entries.reduce((n, e) => n + (e.consumedCredits ?? (e.taskId || e.status === 'submitting' ? CREDITS_PER_TASK : 0)), 0);

async function meshy(method, path, body) {
  const key = process.env.MESHY_API_KEY;
  if (!key) fail('MESHY_API_KEY is not set');
  const res = await fetch(`${MESHY}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) fail(`Meshy ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 600)}`);
  return JSON.parse(text);
}

const balance = async () => (await meshy('GET', '/balance')).balance;

async function concepts(id) {
  const asset = ASSETS[id] ?? fail(`unknown asset ${id}`);
  const key = process.env.OPENAI_API_KEY ?? fail('OPENAI_API_KEY is not set');
  const n = Number(arg('n', 3));
  const out = resolve(arg('out', join(DIR, 'candidates')));
  const tag = arg('tag', 'a');
  mkdirSync(out, { recursive: true });
  const prompt = asset.prompt + VIEW;
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, n, size: '1024x1024', quality: 'high', background: 'opaque', output_format: 'png' }),
  });
  const json = await res.json();
  if (!res.ok) fail(`OpenAI ${res.status}: ${JSON.stringify(json).slice(0, 600)}`);
  json.data.forEach((item, i) => {
    const file = join(out, `${id}_${tag}${i + 1}.png`);
    writeFileSync(file, Buffer.from(item.b64_json, 'base64'));
    console.log('concept', file);
  });
  writeFileSync(join(out, `${id}_${tag}.prompt.txt`), `${IMAGE_MODEL}\n${prompt}\n`);
}

async function submit(id) {
  const asset = ASSETS[id] ?? fail(`unknown asset ${id}`);
  const image = arg('image') ?? fail('--image=<png> is required');
  const ceiling = Number(arg('ceiling', NaN));
  if (!Number.isFinite(ceiling) || ceiling <= 0 || ceiling > 240) fail('--ceiling=<credits> (at most 240) is required');
  const ledger = readLedger();
  const mine = ledger.entries.filter((e) => e.asset === id);
  if (mine.some((e) => e.status === 'submitting' || e.status === 'submitted' || e.status === 'in_progress')) fail(`${id} already has an unfinished task`);
  if (mine.length >= 2) fail(`${id} already used its one retry`);
  const retry = arg('retry');
  if (mine.length === 1 && (typeof retry !== 'string' || !mine[0].rejectionReason)) fail(`${id} was already submitted: a retry needs a rejected first attempt and --retry="what changed"`);
  if (ledger.entries.some((e) => e.status === 'submitting' && !e.taskId)) fail('an earlier submission never got a task id: reconcile it on the Meshy dashboard first');
  if (spent(ledger) + CREDITS_PER_TASK > ceiling) fail(`ceiling: ${spent(ledger)} spent + ${CREDITS_PER_TASK} > ${ceiling}`);
  const before = await balance();
  if (before - CREDITS_PER_TASK < FLOOR) fail(`balance ${before}: one more task would leave less than ${FLOOR}`);
  const buf = readFileSync(image);
  const imageSha = sha(buf);
  const attempt = mine.length + 1;
  const reference = `images/${id}${attempt > 1 ? `-retry` : ''}.png`;
  const request = {
    ai_model: 'meshy-7.1',
    model_type: 'standard',
    should_texture: true,
    enable_pbr: true,
    texture_resolution: '2k',
    should_remesh: true,
    topology: 'triangle',
    target_polycount: 20000,
    target_formats: ['glb'],
    moderation: true,
    image_enhancement: false,
    texture_prompt: asset.texture,
  };
  if (!arg('confirm-spend')) {
    console.log(JSON.stringify({ dryRun: true, asset: id, balance: before, spent: spent(ledger), imageSha, request }, null, 2));
    return;
  }
  mkdirSync(join(DIR, 'images'), { recursive: true });
  copyFileSync(image, join(DIR, reference));
  const entry = {
    asset: id, attempt, date: today(), status: 'submitting', taskId: null,
    prompt: asset.prompt + VIEW, imageModel: IMAGE_MODEL, referenceImage: reference, referenceSha256: imageSha,
    request, creditsBefore: before, creditsAfter: null, consumedCredits: null, glb: null, glbSha256: null,
    retryReason: typeof retry === 'string' ? retry : undefined, rejectionReason: '',
  };
  ledger.entries.push(entry);
  writeLedger(ledger);
  const response = await meshy('POST', '/image-to-3d', { ...request, image_url: `data:image/png;base64,${buf.toString('base64')}` });
  entry.taskId = response.result ?? fail('no task id in the Meshy response; the entry stays "submitting"');
  entry.status = 'submitted';
  entry.creditsAfter = await balance();
  writeLedger(ledger);
  console.log('submitted', id, entry.taskId, 'balance', before, '->', entry.creditsAfter);
}

async function poll(id) {
  const ledger = readLedger();
  const entry = ledger.entries.filter((e) => e.asset === id && e.taskId).at(-1) ?? fail(`${id} has no task`);
  for (;;) {
    const task = await meshy('GET', `/image-to-3d/${entry.taskId}`);
    console.log(new Date().toISOString(), id, task.status, task.progress);
    if (task.status === 'SUCCEEDED' || task.status === 'FAILED' || task.status === 'CANCELED') {
      entry.status = task.status.toLowerCase();
      entry.consumedCredits = task.consumed_credits ?? entry.consumedCredits;
      entry.finishedAt = task.finished_at ? new Date(task.finished_at).toISOString() : today();
      entry.creditsAfter = await balance();
      if (task.status === 'SUCCEEDED') {
        const url = task.model_urls?.glb ?? fail('no GLB url');
        if (!new URL(url).hostname.endsWith('meshy.ai')) fail('untrusted GLB host');
        const res = await fetch(url);
        if (!res.ok) fail(`download ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        mkdirSync(join(DIR, 'meshes'), { recursive: true });
        entry.glb = `meshes/${id}-attempt-${entry.attempt}.glb`;
        writeFileSync(join(DIR, entry.glb), buf);
        entry.glbSha256 = sha(buf);
        entry.glbBytes = buf.length;
        if (task.thumbnail_url) {
          const thumb = await fetch(task.thumbnail_url);
          if (thumb.ok) writeFileSync(join(DIR, 'meshes', `${id}-attempt-${entry.attempt}-thumb.png`), Buffer.from(await thumb.arrayBuffer()));
        }
      } else entry.error = task.task_error?.message ?? '';
      writeLedger(ledger);
      console.log('done', id, entry.status, entry.glb ?? entry.error, 'credits', entry.consumedCredits, 'balance', entry.creditsAfter);
      return;
    }
    entry.status = task.status === 'IN_PROGRESS' ? 'in_progress' : entry.status;
    await new Promise((r) => setTimeout(r, 15000));
  }
}

function reject(id) {
  const reason = arg('reason');
  if (typeof reason !== 'string' || !reason.trim()) fail('--reason="..." is required');
  const ledger = readLedger();
  const entry = ledger.entries.filter((e) => e.asset === id && e.taskId).at(-1) ?? fail(`${id} has no task`);
  entry.rejectionReason = reason.trim();
  writeLedger(ledger);
}

const [command, id] = process.argv.slice(2);
if (command === 'concepts') await concepts(id);
else if (command === 'balance') console.log('balance', await balance(), 'ledger spent', spent(readLedger()));
else if (command === 'submit') await submit(id);
else if (command === 'poll') await poll(id);
else if (command === 'reject') reject(id);
else if (command !== undefined) fail(`unknown command ${command}`);
