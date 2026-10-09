// A screenshot of the thick of a battle: runs past the approach, fights at 32x for --pre seconds, looks at the densest
// fight from --close metres and saves the frame.
//   node scripts/perf-shot.mjs --url=http://127.0.0.1:5343/?scenario=busan --out=<png> [--pre=12] [--close=140] [--w=1440] [--h=900]
import { chromium } from 'playwright-core';
import { fightFor, followFight, waitForContact } from './perf-camera.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
let url = args.url ?? 'http://127.0.0.1:5343/?scenario=busan';
if (!/[?&]lv=/.test(url)) url += `${url.includes('?') ? '&' : '?'}lv=4`;
if (!/[?&]hud=/.test(url)) url += '&hud=0';
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: Number(args.w ?? 1440), height: Number(args.h ?? 900) }, deviceScaleFactor: 1 });
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await waitForContact(page);
if (args.pre) await fightFor(page, Number(args.pre));
await page.evaluate(() => { window.__engine.speed = 1; });
console.log('looking at', JSON.stringify(await followFight(page, Number(args.close ?? 140))));
await page.waitForTimeout(Number(args.wait ?? 3000));
await page.screenshot({ path: args.out });
console.log('saved', args.out);
await browser.close();
