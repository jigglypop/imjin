// End-to-end check suite for the fix-deploy loop.
//   node scripts/e2e.mjs [--url=http://127.0.0.1:5291] [--only=menu,battle:hansan] [--list]
// Checks: menu/select screen (desktop 1440x900 + 1280x720, iPhone 15 Pro portrait + landscape), historical battles,
// approach fast-forward, conquest and enemy-side boots, WebKit low-tier GPU memory, horizontal overflow.
// Flags: --battle-size=1280x720  --ready-timeout=150000  --ff-timeout=90  --max-total-mb=450  --max-textures-mb=350
//        --allow-webgl  --channel=chrome|msedge  --headed  --out=<dir>
// Output: PASS/FAIL table, <out>/report.json and screenshots in shots/e2e/<timestamp>/. Exit code 1 on any failure.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CHECKS } from './e2e/checks.mjs';
import { Browsers, parseArgs, withTimeout } from './e2e/util.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const args = parseArgs(process.argv.slice(2));
const base = args.url ?? 'http://127.0.0.1:5291';

if (args.list === 'true') {
  for (const c of CHECKS) console.log(`${c.id.padEnd(30)} ${c.browser}`);
  process.exit(0);
}

// --only matches a full id, a group name, or an id prefix ("battle" runs both battles, "battle:hansan" one).
const only = args.only ? args.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
const selected = only ? CHECKS.filter((c) => only.some((o) => c.id === o || c.group === o || c.id.startsWith(o))) : CHECKS;
if (!selected.length) {
  console.error(`no check matches --only=${args.only}; try --list`);
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const outDir = args.out ?? join(ROOT, 'shots', 'e2e', stamp);
await mkdir(outDir, { recursive: true });

try {
  const res = await fetch(base, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (e) {
  console.error(`cannot reach ${base}: ${e.message}. Start a dev server or pass --url=`);
  process.exit(2);
}

const browsers = new Browsers(args);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await browsers.closeAll();
    process.exit(130);
  });
}

const results = [];
const checkTimeout = Number(args['check-timeout'] ?? 360000);
console.log(`e2e against ${base} -> ${outDir}`);
for (const check of selected) {
  const t0 = Date.now();
  const name = check.id.replace(/[^a-z0-9]+/gi, '_');
  const ctx = {
    base,
    args,
    browsers,
    shot: async (page) => {
      const file = join(outDir, `${name}.png`);
      try {
        await page.screenshot({ path: file, timeout: 15000 });
        return file;
      } catch {
        return null;
      }
    },
  };
  let r;
  try {
    r = await withTimeout(check.run(ctx), checkTimeout, check.id);
  } catch (e) {
    r = { status: 'FAIL', details: [String(e.message ?? e).split('\n')[0]] };
  }
  const row = { id: check.id, status: r.status, ms: Date.now() - t0, details: r.details ?? [], metrics: r.metrics ?? {}, warnings: r.warnings ?? [], screenshot: r.shot ?? null };
  results.push(row);
  console.log(`${row.status}  ${row.id}  (${(row.ms / 1000).toFixed(1)}s)  ${row.details[0] ?? ''}`);
}
await browsers.closeAll();

const failed = results.filter((r) => r.status !== 'PASS');
const idW = Math.max(...results.map((r) => r.id.length), 5);
const lines = ['', `${'CHECK'.padEnd(idW)}  RESULT  TIME  DETAIL`];
for (const r of results) lines.push(`${r.id.padEnd(idW)}  ${r.status.padEnd(6)}  ${(r.ms / 1000).toFixed(0).padStart(3)}s  ${r.details.join(' | ').slice(0, 160)}`);
lines.push('', `${results.length - failed.length}/${results.length} passed${failed.length ? `, failed: ${failed.map((r) => r.id).join(', ')}` : ''}`);
console.log(lines.join('\n'));

const report = { url: base, startedAt: stamp, platform: process.platform, flags: args, passed: failed.length === 0, results };
await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(`report: ${join(outDir, 'report.json')}`);
process.exit(failed.length ? 1 : 0);
