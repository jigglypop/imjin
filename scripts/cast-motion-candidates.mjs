// Plays Meshy library candidates on an existing rig task, to choose the weapon-kind motion sets by eye.
//   node scripts/cast-motion-candidates.mjs --key=yi__yi_tongjesa --ids=335,334,... --tag=set1
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.loadEnvFile(join(ROOT, '.env'));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const PKG = join(ROOT, 'assets-src', 'generals-cast-2026-10-17');
const dir = join(PKG, args.key, 'motion-candidates'); mkdirSync(dir, { recursive: true });
const out = join(dir, `${args.tag}.glb`), rec = `${out}.json`;
const auth = { Authorization: `Bearer ${process.env.MESHY_API_KEY}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(method, url, body) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url, { method, headers: auth, body, signal: AbortSignal.timeout(300_000) }); const t = await r.text(); if (r.ok) return JSON.parse(t); if (r.status < 500 && r.status !== 429) throw Object.assign(new Error(`${r.status} ${t}`), { fatal: true }); throw new Error(`${r.status}`); }
    catch (e) { if (e.fatal || i > 10) throw e; console.error('retry', i, String(e)); await sleep(5000 * (i + 1)); }
  }
}
const r = existsSync(rec) ? JSON.parse(readFileSync(rec, 'utf8')) : {};
if (!r.task) {
  const rig = JSON.parse(readFileSync(join(PKG, args.key, 'rig.glb.json'), 'utf8')).task;
  const ids = args.ids.split(',').map(Number);
  r.task = (await http('POST', 'https://api.meshy.ai/openapi/v1/animations', JSON.stringify({ rig_task_id: rig, action_ids: ids }))).result;
  Object.assign(r, { ids, at: new Date().toISOString() }); writeFileSync(rec, JSON.stringify(r, null, 2));
}
let t;
for (;;) { t = await http('GET', `https://api.meshy.ai/openapi/v1/animations/${r.task}`); if (t.status === 'SUCCEEDED') break; if (['FAILED', 'CANCELED'].includes(t.status)) throw new Error(JSON.stringify(t)); await sleep(10000); }
for (let i = 0; ; i++) { try { writeFileSync(out, Buffer.from(await (await fetch(t.result.animation_glb_url)).arrayBuffer())); break; } catch (e) { if (i > 8) throw e; await sleep(5000 * (i + 1)); } }
r.credits = t.consumed_credits; writeFileSync(rec, JSON.stringify(r, null, 2));
const lf = join(PKG, 'ledger.json'); const l = JSON.parse(readFileSync(lf, 'utf8'));
l.entries.push({ at: new Date().toISOString(), provider: 'meshy', what: `${args.key} motion candidates ${args.ids}`, task: r.task, credits: r.credits });
l.totals = {}; for (const e of l.entries) l.totals[e.provider] = (l.totals[e.provider] ?? 0) + (e.credits ?? 0);
writeFileSync(lf, JSON.stringify(l, null, 2) + '\n');
console.log('saved', out, r.credits, 'credits');
