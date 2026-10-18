// Load timeline on the WebKit iPhone path: every change of the loading step, the bar and the GPU counters, with the time.
//   node scripts/probe-load.mjs [url] [--orient=landscape] [--engine=chromium]   (chromium = desktop Chrome with WebGPU, 1600x900)
import { webkit, chromium, devices } from 'playwright-core';
const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://127.0.0.1:5291/?scenario=hansan';
const landscape = process.argv.includes('--orient=landscape');
const desktop = process.argv.includes('--engine=chromium');
const base = devices['iPhone 15 Pro'];
const viewport = desktop ? { width: 1600, height: 900 } : landscape ? { width: base.viewport.height, height: base.viewport.width } : base.viewport;
const browser = desktop
  ? await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] })
  : await webkit.launch({ headless: true });
const ctx = await browser.newContext(desktop ? { viewport } : { ...base, viewport, screen: viewport });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(String(e)));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
let last = '';
let ready = false;
while (Date.now() - t0 < 90000 && !ready) {
  const s = await page.evaluate(() => {
    const m = window.__engine?.renderer?.info?.memory;
    return {
      text: document.querySelector('.loading-meta span')?.textContent ?? '',
      pct: document.querySelector('.loading-meta b')?.textContent ?? '',
      tex: m ? Math.round(m.texturesSize / 1e6) : 0,
      programs: m?.programs ?? 0,
      ready: window.__ready === true,
    };
  }).catch(() => null);
  if (!s) { await page.waitForTimeout(200); continue; }
  const line = `${s.text} ${s.pct} tex=${s.tex}MB programs=${s.programs}`;
  if (line !== last) console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${line}`);
  last = line;
  ready = s.ready;
  await page.waitForTimeout(150);
}
console.log(`ready=${ready} at ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (logs.length) console.log(logs.slice(-5).join('\n'));
await browser.close();
