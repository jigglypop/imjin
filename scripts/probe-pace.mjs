// Pacing probe: loads a battle and logs battle time, fast-forward state and the closest enemy distance over real time.
//   node scripts/probe-pace.mjs [--url=http://127.0.0.1:5291/?scenario=hansan] [--seconds=40]
import { chromium } from 'playwright-core';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const url = args.url ?? 'http://127.0.0.1:5291/?scenario=hansan';
const seconds = Number(args.seconds ?? 40);
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
for (let t = 0; t <= seconds; t += 5) {
  const s = await page.evaluate(() => {
    const e = window.__engine; const b = e.battle;
    let min = Infinity;
    const live = b.ships.filter((s) => s.alive && s.sinking <= 0);
    for (const a of live) for (const c of live) if (a.team !== c.team) min = Math.min(min, Math.hypot(a.x - c.x, a.z - c.z));
    return { simTime: Math.round(b.time), ff: e.fastForward, auto: e.autoFast, speed: e.speed, fps: e.fps, closest: Math.round(min), shots: b.projectiles.length, own: b.teamCount(e.team), winner: b.winner };
  });
  console.log(`real ${t}s`, JSON.stringify(s));
  if (t < seconds) await page.waitForTimeout(5000);
}
await browser.close();
