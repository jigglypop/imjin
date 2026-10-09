import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
await page.goto('http://127.0.0.1:5291/?scenario=hansan&hud=0&follow=18&dist=40&pitch=0.3&yaw=2.2');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForTimeout(1000);
await page.evaluate(() => {
  const e = window.__engine;
  const c = e.crew;
  c.update = () => {};
  const m = c.meshes.joseon;
  const ship = e.battle.get(18);
  const arr = m.instanceMatrix.array;
  for (let i = 0; i < 3; i += 1) {
    arr.fill(0, i * 16, i * 16 + 16);
    arr[i * 16] = 6; arr[i * 16 + 5] = 6; arr[i * 16 + 10] = 6; arr[i * 16 + 15] = 1;
    arr[i * 16 + 12] = ship.x + i * 8; arr[i * 16 + 13] = 10; arr[i * 16 + 14] = ship.z;
  }
  m.count = 3;
  m.instanceMatrix.needsUpdate = true;
});
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/crew_debug.png' });
console.log(logs.filter((l) => l.includes('error') || l.includes('warn')).slice(-6).join('\n'));
await browser.close();
