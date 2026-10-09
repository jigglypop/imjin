// Console warnings and errors of a battle load, grouped by message with the number of times each repeats (three's TSL
// warnings such as a missing vertex attribute print once per material that reads it). Chrome with WebGPU unless --webgl.
//   node scripts/probe-warnings.mjs [url] [--webgl] [--stack]
import { chromium } from 'playwright-core';
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const url = positional[0] ?? 'http://127.0.0.1:5351/?scenario=hansan&hud=0';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const counts = new Map();
page.on('console', (m) => {
  if (m.type() !== 'warning' && m.type() !== 'error') return;
  const key = `${m.type()}: ${m.text().slice(0, 200)}`;
  const row = counts.get(key) ?? { n: 0, where: m.location().url + ':' + m.location().lineNumber };
  row.n += 1;
  counts.set(key, row);
});
page.on('pageerror', (e) => {
  const key = `pageerror: ${String(e).slice(0, 200)}`;
  const row = counts.get(key) ?? { n: 0, where: '' };
  row.n += 1;
  counts.set(key, row);
});
await page.goto(flags.has('--webgl') ? `${url}${url.includes('?') ? '&' : '?'}webgl=1` : url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForTimeout(3000);
if (!counts.size) console.log('no warnings or errors');
for (const [key, row] of [...counts].sort((a, b) => b[1].n - a[1].n)) console.log(String(row.n).padStart(4), 'x', key, flags.has('--stack') ? row.where : '');
await browser.close();
