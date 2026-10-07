import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('pageerror', (e) => logs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
await page.goto('http://127.0.0.1:5291/?scenario=hansan&hud=0&follow=18&dist=30&pitch=0.55&yaw=2.2');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForTimeout(2000);
const r = await page.evaluate(() => {
  const c = window.__engine.crew;
  return { j: c.meshes.joseon.count, w: c.meshes.japan.count, cam: window.__engine.camera.position.toArray().map(Math.round) };
});
console.log(JSON.stringify(r), logs.slice(-3));
await page.screenshot({ path: 'shots/crew_probe.png' });
await browser.close();
