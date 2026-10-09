import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://127.0.0.1:5291/?scenario=${process.argv[2] ?? 'okpo'}&hud=0`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const e = window.__engine;
  const st = e.terrain.structures;
  const counts = {};
  for (const s of st) counts[s.type] = (counts[s.type] ?? 0) + 1;
  const firstHouse = st.find((s) => s.type === 'choga' || s.type === 'giwa');
  const w = firstHouse ? e.terrain.toWorld(firstHouse.x, firstHouse.z) : null;
  const gate = st.find((s) => s.type === 'fortgate');
  const gw = gate ? e.terrain.toWorld(gate.x, gate.z) : null;
  if (w) { e.rts.followId = 0; e.rts.setPose({ tx: w.x, tz: w.z, yaw: 0.8, pitch: 0.42, distance: 260 }); }
  return { counts, w, gw, loaded: e.structures.ready };
});
console.log(JSON.stringify(r));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/village1.png' });
if (r.gw) {
  await page.evaluate((gw) => window.__engine.rts.setPose({ tx: gw.x, tz: gw.z, yaw: 2.2, pitch: 0.3, distance: 160 }), r.gw);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'shots/village2.png' });
}
await browser.close();
