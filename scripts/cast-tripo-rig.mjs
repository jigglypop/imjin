// Tripo's own rig and preset motions on a cast model made by Tripo (<key>_<cand>/raw.glb.json), for comparing with
// Meshy's rig. Outputs <dir>/tripo_rig.glb and tripo_<preset>.glb, each with a .json record; resumes running tasks.
//   node scripts/cast-tripo-rig.mjs --dir=yi__yi_tongjesa_t2 --presets=idle,slash
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.loadEnvFile(join(ROOT, '.env'));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const PKG = join(ROOT, 'assets-src', 'generals-cast-2026-10-17');
const D = join(PKG, args.dir);
const TRIPO = 'https://api.tripo3d.ai/v2/openapi';
const auth = { Authorization: `Bearer ${process.env.TRIPO_API_KEY}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
async function http(method, url, body) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url, { method, headers: auth, body, signal: AbortSignal.timeout(300_000) }); const t = await r.text(); if (r.ok) return JSON.parse(t); if (r.status < 500 && r.status !== 429) throw Object.assign(new Error(`${r.status} ${t}`), { fatal: true }); throw new Error(String(r.status)); }
    catch (e) { if (e.fatal || i > 10) throw e; console.error('retry', i, String(e)); await sleep(5000 * (i + 1)); }
  }
}
function ledger(entry) {
  const f = join(PKG, 'ledger.json'); const l = JSON.parse(readFileSync(f, 'utf8'));
  if (l.entries.some((e) => e.task === entry.task && e.what === entry.what)) return;
  l.entries.push({ at: new Date().toISOString(), ...entry });
  l.totals = {}; for (const e of l.entries) l.totals[e.provider] = (l.totals[e.provider] ?? 0) + (e.credits ?? 0);
  writeFileSync(f, JSON.stringify(l, null, 2) + '\n');
}
async function task(out, body, what) {
  const rec = `${out}.json`; const r = existsSync(rec) ? JSON.parse(readFileSync(rec, 'utf8')) : {};
  if (!r.task) { const j = await http('POST', `${TRIPO}/task`, JSON.stringify(body)); if (j.code !== 0) throw new Error(JSON.stringify(j)); Object.assign(r, { task: j.data.task_id, body, at: new Date().toISOString() }); writeFileSync(rec, JSON.stringify(r, null, 2)); log(what, 'task', r.task); }
  for (let last = -1; ; ) {
    const d = (await http('GET', `${TRIPO}/task/${r.task}`)).data;
    if (d.status === 'success') {
      r.credits = d.consumed_credit ?? d.credits_consumed ?? null; writeFileSync(rec, JSON.stringify(r, null, 2));
      const url = d.output.pbr_model ?? d.output.model ?? d.output.base_model;
      if (!existsSync(out)) for (let i = 0; ; i++) { try { writeFileSync(out, Buffer.from(await (await fetch(url)).arrayBuffer())); break; } catch (e) { if (i > 8) throw e; await sleep(5000 * (i + 1)); } }
      ledger({ provider: 'tripo', what: `${args.dir} ${what}`, task: r.task, credits: r.credits });
      return r;
    }
    if (['failed', 'banned', 'expired', 'cancelled', 'unknown'].includes(d.status)) throw new Error(`${what} ${d.status}: ${JSON.stringify(d).slice(0, 300)}`);
    if (d.progress !== last) log(what, `${d.progress}%`); last = d.progress; await sleep(10_000);
  }
}
const model = JSON.parse(readFileSync(join(D, 'raw.glb.json'), 'utf8'));
const rig = await task(join(D, 'tripo_rig.glb'), { type: 'animate_rig', original_model_task_id: model.task, out_format: 'glb', rig_type: 'biped', spec: 'tripo' }, 'rig');
for (const p of (args.presets ?? 'idle,slash').split(',')) await task(join(D, `tripo_${p}.glb`), { type: 'animate_retarget', original_model_task_id: rig.task, out_format: 'glb', animation: `preset:biped:${p}`, animate_in_place: true }, p);
log('done');
