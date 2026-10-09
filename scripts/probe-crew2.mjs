import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:5291/?scenario=hansan&hud=0&follow=18&dist=60&pitch=0.25&yaw=2.2');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const e = window.__engine;
  const c = e.crew;
  const m = c.meshes.joseon;
  const arr = m.instanceMatrix.array;
  const pos = [];
  for (let i = 0; i < 3; i += 1) pos.push([arr[i * 16 + 12], arr[i * 16 + 13], arr[i * 16 + 14]].map((v) => Math.round(v * 10) / 10));
  const ship = e.battle.get(18);
  const v = e.views.states.get(18);
  return { pos, ship: [Math.round(ship.x), Math.round(ship.z)], key: v.key, visible: v.visible, inScene: !!m.parent?.parent, geoCount: m.geometry.getAttribute('position').count, matVC: m.material.vertexColors };
});
console.log(JSON.stringify(r));
await browser.close();
