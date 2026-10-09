// Plays a conquest battle for a while at high speed and screenshots it, optionally after picking a point.
//   node scripts/shot-conquest.mjs --map=hallyeo --me=joseon --foe=japan --run=60 --out=shots/cq.png [--point=0] [--cam=x,z,yaw,pitch,dist]
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const url = `http://127.0.0.1:5291/?conquest=${args.map ?? 'hallyeo'}&me=${args.me ?? 'joseon'}&foe=${args.foe ?? 'japan'}&size=${args.size ?? 2}${args.cam ? `&cam=${args.cam}` : ''}`;
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: Number(args.w ?? 1600), height: Number(args.h ?? 900) } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 150000 });
const run = Number(args.run ?? 0);
if (run > 0) {
  await page.evaluate(() => {
    window.__engine.speed = 4;
  });
  await page.waitForTimeout((run / 4) * 1000);
  await page.evaluate(() => {
    window.__engine.speed = 1;
  });
}
if (args.point !== undefined) await page.evaluate((id) => window.__engine.selectPoint(Number(id)), args.point);
if (args.select) await page.evaluate(() => {
  const e = window.__engine;
  const own = e.battle.ships.filter((s) => s.owner === e.owner && e.battle.isActive(s));
  e.views.selected.clear();
  if (own[0]) e.views.selected.add(own[0].id);
  e.publish(true);
});
if (args.follow) await page.evaluate(() => {
  const e = window.__engine;
  const own = e.battle.ships.find((s) => s.owner === e.owner && e.battle.isActive(s));
  if (own) { e.rts.followId = own.id; e.rts.goal.distance = 140; e.rts.goal.pitch = 0.3; }
});
await page.waitForTimeout(Number(args.wait ?? 2500));
const info = await page.evaluate(() => {
  const e = window.__engine;
  const c = e.conquest;
  return { time: Math.round(e.battle.time), fps: e.fps, tickets: c && { ...c.tickets }, held: c && [c.held('joseon'), c.held('japan')], ships: [e.battle.teamCount('joseon'), e.battle.teamCount('japan')], funds: c && c.players.map((p) => Math.round(p.funds)) };
});
await page.screenshot({ path: args.out ?? 'shots/cq.png' });
console.log(JSON.stringify(info), errors.slice(-5));
await browser.close();
