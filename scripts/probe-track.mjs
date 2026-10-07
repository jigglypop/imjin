import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:5291/?scenario=${process.argv[2] ?? 'hansan'}&hud=0&paused=1`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
const r = await page.evaluate(() => {
  const e = window.__engine;
  const b = e.battle;
  const out = [];
  const pick = b.ships.filter((s) => s.team === 'japan').slice(0, 3).concat(b.ships.filter((s) => s.team === 'joseon').slice(10, 12));
  for (let t = 0; t <= 90; t += 1) {
    for (let k = 0; k < 30; k += 1) b.step(1 / 30);
    if (t % 15 === 0) out.push(pick.map((s) => `${s.team[0]}${s.id}:(${Math.round(s.x)},${Math.round(s.z)}) h${s.heading.toFixed(2)} v${s.speed.toFixed(1)} t${s.targetId} ${b.activityOf(s.id)} r${s.rudder.toFixed(2)} th${s.throttle.toFixed(2)}`).join(' | '));
  }
  return out;
});
console.log(r.join('\n'));
await browser.close();
