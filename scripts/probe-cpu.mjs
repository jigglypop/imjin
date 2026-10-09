// Where the main thread spends a battle load: a CPU profile of Chrome from page start to ready, summed by function
// (self time) and by source file. ?webgl=1 profiles the WebGL2 path the phones use.
//   node scripts/probe-cpu.mjs [url] [--top=25]
import { chromium } from 'playwright-core';
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const top = Number((process.argv.find((a) => a.startsWith('--top=')) ?? '--top=25').split('=')[1]);
const url = positional[0] ?? 'http://127.0.0.1:5291/?scenario=hansan&webgl=1&q=low';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 393, height: 659 } });
const client = await page.context().newCDPSession(page);
await client.send('Profiler.enable');
await client.send('Profiler.setSamplingInterval', { interval: 500 });
await client.send('Profiler.start');
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const wall = Date.now() - t0;
const { profile } = await client.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)));
const byFunction = new Map();
const byFile = new Map();
let total = 0;
for (const [id, us] of self) {
  const n = byId.get(id);
  const f = n.callFrame;
  const file = f.url.replace(/^.*\/(node_modules\/\.vite\/deps|src|node_modules)\//, '$1/').replace(/\?.*$/, '') || '(native)';
  const key = `${f.functionName || '(anonymous)'} ${file}:${f.lineNumber}`;
  byFunction.set(key, (byFunction.get(key) ?? 0) + us);
  byFile.set(file, (byFile.get(file) ?? 0) + us);
  total += us;
}
const rows = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${String(Math.round(v / 1000)).padStart(6)} ms  ${k}`);
console.log(`ready after ${(wall / 1000).toFixed(1)} s wall, ${Math.round(total / 1000)} ms sampled\n\nby file\n${rows(byFile).join('\n')}\n\nby function\n${rows(byFunction).join('\n')}`);
await browser.close();
