import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:5291/?scenario=hansan&hud=0&follow=18&dist=30&pitch=0.55&yaw=2.2');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const e = window.__engine;
  const m = e.crew.meshes.joseon;
  const arr = m.instanceMatrix.array;
  const ship = e.battle.get(18);
  const v = e.views.states.get(18);
  const near = [];
  for (let i = 0; i < m.count; i += 1) {
    const x = arr[i * 16 + 12], y = arr[i * 16 + 13], z = arr[i * 16 + 14];
    if (Math.hypot(x - ship.x, z - ship.z) < 30) near.push([x - ship.x, y, z - ship.z].map((q) => Math.round(q * 10) / 10));
  }
  const hv = v.heave;
  return { near: near.slice(0, 6), count: near.length, heave: hv, crew: ship.crew, specCrew: ship.spec.crew };
});
console.log(JSON.stringify(r));
await browser.close();
