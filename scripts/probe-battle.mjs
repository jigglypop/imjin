import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:5291/?scenario=${process.argv[2] ?? 'hansan'}&hud=0&warm=${process.argv[3] ?? 0}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
const r = await page.evaluate(() => {
  const b = window.__engine.battle;
  const sum = (team) => {
    const list = b.ships.filter((s) => s.team === team && s.alive);
    const cx = list.reduce((a, s) => a + s.x, 0) / list.length;
    const cz = list.reduce((a, s) => a + s.z, 0) / list.length;
    const orders = {};
    for (const s of list) orders[s.order.type] = (orders[s.order.type] ?? 0) + 1;
    const speeds = list.reduce((a, s) => a + s.speed, 0) / list.length;
    const act = {};
    for (const s of list) { const k = b.activityOf(s.id); act[k] = (act[k] ?? 0) + 1; }
    return { n: list.length, cx: Math.round(cx), cz: Math.round(cz), orders, speed: speeds.toFixed(2), act, targets: list.filter((s) => s.targetId).length, ammo: list[0]?.guns?.map((g) => g.ammo).join(',') };
  };
  return { time: b.time.toFixed(1), joseon: sum('joseon'), japan: sum('japan'), proj: b.projectiles.length, winner: b.winner, retreat: b.retreatBelow };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
