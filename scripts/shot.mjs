import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);

const url = args.url ?? 'http://127.0.0.1:5291/';
const out = args.out ?? join(ROOT, 'shots', 'shot.png');
const width = Number(args.w ?? 1600);
const height = Number(args.h ?? 900);
const wait = Number(args.wait ?? 4000);
const headed = args.headed === 'true';

await mkdir(join(out, '..'), { recursive: true });
const browser = await chromium.launch({
  channel: args.channel ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
  headless: !headed,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'domcontentloaded' });
const started = Date.now();
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: Number(args.timeout ?? 90000) });
} catch {
  logs.push('[shot] ready flag timeout');
}
if (args.eval) {
  await page.evaluate(args.eval);
}
await page.waitForTimeout(wait);
const info = await page.evaluate(() => window.__info?.() ?? null).catch(() => null);
await page.screenshot({ path: out });
console.log('saved', out, 'in', Date.now() - started, 'ms');
if (info) console.log('info', JSON.stringify(info));
const interesting = logs.filter((l) => !l.includes('[vite]') && !l.includes('Download the React DevTools'));
if (interesting.length) console.log(interesting.slice(-40).join('\n'));
await browser.close();
