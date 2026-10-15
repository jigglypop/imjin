// The munitions gallery (?gallery=munitions): the whole jetty, then close-ups along it a few projectiles at a time so
// the labels can be read, and the great arrows' tails up close for their iron vanes.
//   node scripts/probe-munitions.mjs --url=http://127.0.0.1:5540/ --out=<dir> [--prefix=] [--lang=ko|en]
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const base = (flags.url ?? 'http://127.0.0.1:5540/').replace(/\/?(\?.*)?$/, '/');
const out = flags.out ?? 'shots/munitions';
const prefix = flags.prefix ?? '';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}?scenario=hansan&gallery=munitions&sea=calm&sky=day&hud=0&lv=4&lang=${flags.lang ?? 'ko'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await page.waitForTimeout(2000);
const shoot = async (label, tx, tz, yaw, pitch, distance) => {
  await page.evaluate(({ tx, tz, yaw, pitch, distance }) => {
    const e = window.__engine;
    e.rts.followId = 0;
    e.rts.setPose({ tx, tz, yaw, pitch, distance }, true);
  }, { tx, tz, yaw, pitch, distance });
  for (let k = 0; k < 8; k += 1) await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  await page.screenshot({ path: join(out, `${prefix}${label}.png`) });
};
// The rack's slots: 19 projectiles 0.52 m apart from 5.24 m left of the middle.
const slot = (i) => -5.24 + 0.3 + 0.52 * (i + 0.5);
await shoot('overview', 0, 0, Math.PI / 2, 0.3, 8.5);
for (let g = 0; g < 5; g += 1) {
  const first = g * 4;
  await shoot(`group${g}`, (slot(first) + slot(Math.min(18, first + 3))) / 2, 0.3, Math.PI / 2, 0.55, 2.7);
}
// The great arrows' tails: their vanes from the side and from behind.
await shoot('vanes_side', slot(0) + 0.1, 0.95, 0.55, 0.3, 1.05);
await shoot('vanes_tail', slot(1), 1.15, Math.PI / 2 - 0.2, 0.25, 0.85);
await browser.close();
