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

const url = args.url ?? 'http://127.0.0.1:5291/?scenario=hansan&gallery=1&hud=0&sea=calm&sky=day';
const prefix = args.prefix ?? 'multi';
const poses = JSON.parse(args.poses ?? '[]');
const wait = Number(args.wait ?? 1500);

await mkdir(join(ROOT, 'shots'), { recursive: true });
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
});
const page = await browser.newPage({ viewport: { width: Number(args.w ?? 1600), height: Number(args.h ?? 900) }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: Number(args.timeout ?? 180000) });
for (let i = 0; i < poses.length; i += 1) {
  const p = poses[i];
  await page.evaluate((pose) => {
    const e = window.__engine;
    e.rts.followId = 0;
    e.rts.setPose(pose);
  }, p);
  await page.waitForTimeout(wait);
  const out = join(ROOT, 'shots', `${prefix}_${i}.png`);
  await page.screenshot({ path: out });
  console.log('saved', out);
}
const errors = logs.filter((l) => l.includes('error') || l.includes('Error'));
if (errors.length) console.log(errors.slice(-20).join('\n'));
await browser.close();
