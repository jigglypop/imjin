// The explicitly approved 75-credit pilot: two fresh Meshy 7.1 models and ONE body rig.
// A create is never retried, including after an ambiguous network failure.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, openSync, fsyncSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = join(ROOT, 'assets-src/generals-regeneration-2026-10-17');
const JOBS = join(BASE, 'jobs');
mkdirSync(JOBS, { recursive: true });
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const [command = 'status', operation] = process.argv.slice(2);
const api = 'https://api.meshy.ai/openapi/v1';
const SHA = (bytes) => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();
const filename = (id) => join(JOBS, `${id}.json`);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
function save(p, value) {
  const temp = `${p}.${process.pid}.tmp`;
  const fd = openSync(temp, 'wx');
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, p);
}
const specs = {
  body: { estimate: 35, endpoint: 'multi-image-to-3d', template: 'meshy-body.template.json', refs: ['body-front-v1.png', 'body-left-v1.png', 'body-back-v1.png', 'body-right-v1.png'] },
  coat: { estimate: 35, endpoint: 'multi-image-to-3d', template: 'meshy-coat.template.json', refs: ['joseon-dujeong-coat-front-v2.png', 'joseon-dujeong-coat-left-v1.png', 'joseon-dujeong-coat-back-v1.png', 'joseon-dujeong-coat-right-v1.png'] },
  'body-rig': { estimate: 5, endpoint: 'rigging', template: 'meshy-body-rig.template.json' },
};
const approvalPath = join(JOBS, 'approval.json');
if (!existsSync(approvalPath)) save(approvalPath, {
  schema: 'imjin.meshy-pilot-approval.v1', recordedAt: now(), provider: 'Meshy', maximumCredits: 75,
  userAuthorization: 'Meshy 75크레딧 예산으로 실행 (권장)', latestModelInstruction: '최신모델로 실행. 그리고 검술은 멋있는걸로',
  operations: { body: 35, coat: 35, 'body-rig': 5 }, automaticRetries: false,
  priceSource: 'https://docs.meshy.ai/en/api/pricing', modelSource: 'https://docs.meshy.ai/en/api/multi-image-to-3d',
  resolvedModel: 'meshy-7.1', excludes: ['paid animation', 'helmet generation', 'regeneration', 'Tripo'],
  enforcement: 'Local reservation and one create per operation. Provider does not document a per-task credit cap.',
});
function credentials() {
  if (!process.env.MESHY_API_KEY) throw new Error('MESHY_API_KEY is not configured');
  return { Authorization: `Bearer ${process.env.MESHY_API_KEY}`, 'Content-Type': 'application/json' };
}
async function get(endpoint) {
  const res = await fetch(`${api}/${endpoint}`, { headers: credentials(), signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Meshy GET ${res.status} (${endpoint})`);
  return res.json();
}
const ledger = () => Object.keys(specs).flatMap((id) => existsSync(filename(id)) ? [read(filename(id))] : []);
function committed(jobs) { return jobs.reduce((n, j) => n + (j.consumedCredits ?? j.reservedCredits), 0); }
async function prepare(id) {
  const s = specs[id];
  if (!s) throw new Error('Unknown operation');
  const payload = read(join(BASE, 'requests', s.template));
  const refs = [];
  if (s.refs) {
    payload.image_urls = [];
    for (const name of s.refs) {
      const path = join(BASE, 'references', name);
      const bytes = readFileSync(path);
      const meta = await sharp(bytes).metadata();
      if (meta.width !== 1254 || meta.height !== 1254) throw new Error(`Reference dimensions changed: ${name}`);
      refs.push({ path: relative(ROOT, path).replaceAll('\\', '/'), sha256: SHA(bytes), bytes: bytes.length, width: meta.width, height: meta.height });
      payload.image_urls.push(`data:image/png;base64,${bytes.toString('base64')}`);
    }
    if (payload.ai_model !== 'meshy-7.1' || payload.geometry_resolution !== '2k' || payload.texture_resolution !== '4k') throw new Error('Unapproved generation settings');
  } else {
    const body = read(filename('body'));
    const gatePath = join(BASE, 'review/body-raw.json');
    if (body.status !== 'SUCCEEDED' || !existsSync(gatePath)) throw new Error('Body must pass raw visual inspection before rigging');
    const gate = read(gatePath);
    if (gate.acceptedForRigging !== true || gate.taskId !== body.taskId || !(gate.triangles > 0 && gate.triangles <= 300000)) throw new Error('Body raw review gate failed');
    payload.input_task_id = body.taskId;
  }
  return { payload, refs, requestSha256: SHA(JSON.stringify(payload)) };
}
async function submit(id) {
  const lockPath = join(JOBS, 'create.lock');
  const fd = openSync(lockPath, 'wx');
  try {
    if (existsSync(filename(id))) throw new Error('Operation already has a durable intent: observe it; never resubmit');
    const approval = read(approvalPath);
    const s = specs[id];
    if (!s || approval.operations[id] !== s.estimate || approval.maximumCredits !== 75) throw new Error('Approval scope mismatch');
    const jobs = ledger();
    if (jobs.some((j) => ['submitting', 'submission-uncertain'].includes(j.status))) throw new Error('Unresolved create blocks every subsequent paid operation');
    if (jobs.some((j) => j.consumedCredits > j.reservedCredits)) throw new Error('Observed cost exceeded reservation');
    if (committed(jobs) + s.estimate > approval.maximumCredits) throw new Error('75-credit ceiling reached');
    const prepared = await prepare(id);
    const balance = await get('balance');
    if (balance.balance < s.estimate) throw new Error('Insufficient available balance');
    const intent = {
      schema: 'imjin.meshy-pilot-job.v1', operation: id, endpoint: s.endpoint, createdAt: now(), status: 'submitting',
      reservedCredits: s.estimate, requestSha256: prepared.requestSha256, references: prepared.refs,
      request: { ...prepared.payload, ...(prepared.refs.length ? { image_urls: prepared.refs.map((r) => `sha256:${r.sha256}`) } : {}) },
      balanceBefore: balance, createAttempts: 1,
    };
    // Intent + reservation must reach disk BEFORE the only POST.
    save(filename(id), intent);
    let response;
    try {
      const res = await fetch(`${api}/${s.endpoint}`, { method: 'POST', headers: credentials(), body: JSON.stringify(prepared.payload), signal: AbortSignal.timeout(180_000) });
      const raw = await res.text();
      if (!res.ok) {
        intent.status = 'create-rejected'; intent.httpStatus = res.status;
        // Avoid provider error bodies, which can echo input image data.
        intent.rejectionBodySha256 = SHA(raw); save(filename(id), intent);
        throw new Error(`Meshy create rejected: HTTP ${res.status}; no automatic retry`);
      }
      response = JSON.parse(raw);
      if (typeof response.result !== 'string' || !response.result) throw new Error('Missing task ID');
    } catch (error) {
      if (intent.status === 'submitting') { intent.status = 'submission-uncertain'; intent.lastObservedAt = now(); save(filename(id), intent); }
      throw error;
    }
    intent.taskId = response.result; intent.status = 'PENDING'; intent.submittedAt = now();
    save(filename(id), intent);
    console.log(JSON.stringify({ operation: id, taskId: intent.taskId, status: intent.status, reservedCredits: s.estimate, committedCredits: committed(ledger()) }));
  } finally { closeSync(fd); unlinkSync(lockPath); }
}
async function download(url, path) {
  if (existsSync(path)) return { path: relative(ROOT, path).replaceAll('\\', '/'), bytes: readFileSync(path).length, sha256: SHA(readFileSync(path)) };
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Result download HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 100) throw new Error('Empty/invalid result');
  if (path.endsWith('.glb') && (bytes.toString('utf8', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length)) throw new Error('Invalid GLB bytes');
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, bytes, { flag: 'wx' });
  return { path: relative(ROOT, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: SHA(bytes) };
}
async function observe(id) {
  const file = filename(id);
  if (!existsSync(file)) return;
  const job = read(file);
  if (!job.taskId) { console.log(JSON.stringify({ operation: id, status: job.status })); return; }
  const task = await get(`${job.endpoint}/${job.taskId}`);
  job.status = task.status; job.progress = task.progress; job.lastObservedAt = now();
  if (typeof task.consumed_credits === 'number') job.consumedCredits = task.consumed_credits;
  job.balanceAfter = await get('balance');
  if (task.task_error) job.taskError = { message: String(task.task_error.message ?? '').slice(0, 250) };
  save(file, job);
  if (task.status === 'SUCCEEDED') {
    const dest = join(BASE, 'raw', id);
    job.downloads ??= {};
    for (const [key, url] of Object.entries(task.model_urls ?? task.result ?? {})) {
      if (typeof url === 'string' && /^https:\/\//.test(url) && /glb/.test(key)) job.downloads[key] = await download(url, join(dest, `${key}.glb`));
    }
    for (const [key, url] of Object.entries(task.thumbnail_urls ?? {})) if (typeof url === 'string') job.downloads[`thumbnail_${key}`] = await download(url, join(dest, `thumbnail_${key}.png`));
    if (task.thumbnail_url) job.downloads.thumbnail = await download(task.thumbnail_url, join(dest, 'thumbnail.png'));
    // Rigging nests downloadable URLs under result; only GLBs are needed locally.
    const walk = async (value, prefix = '') => {
      for (const [key, item] of Object.entries(value ?? {})) {
        const name = prefix ? `${prefix}_${key}` : key;
        if (typeof item === 'string' && /^https:\/\//.test(item) && /glb/i.test(key)) job.downloads[name] = await download(item, join(dest, `${name}.glb`));
        else if (item && typeof item === 'object' && !Array.isArray(item)) await walk(item, name);
      }
    };
    if (id === 'body-rig') await walk(task.result);
    save(file, job);
  }
  console.log(JSON.stringify({ operation: id, taskId: job.taskId, status: job.status, progress: job.progress, consumedCredits: job.consumedCredits, balance: job.balanceAfter.balance, downloads: Object.keys(job.downloads ?? {}) }));
}
try {
  if (command === 'submit') await submit(operation);
  else if (command === 'prepare') { const p = await prepare(operation); console.log(JSON.stringify({ operation, requestSha256: p.requestSha256, references: p.refs, settings: { ...p.payload, image_urls: p.refs.map((r) => r.path) } }, null, 2)); }
  else if (command === 'status') for (const id of operation ? [operation] : Object.keys(specs)) await observe(id);
  else throw new Error('Usage: regenerate-generals.mjs prepare|submit|status [body|coat|body-rig]');
} catch (error) { console.error(error.message); process.exitCode = 1; }
