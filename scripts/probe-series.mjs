// Frame rate over time in a battle, with what could be growing: particle counts, debris, ships, boarding figures.
//   node scripts/probe-series.mjs [url] [--seconds=60] [--pre=12] [--close[=metres]] [--speed=1] [--approach: sample the 128x fast-forward instead of waiting it out]
import { chromium } from 'playwright-core';
import { fightFor, followFight, waitForContact } from './perf-camera.mjs';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
let url = positional[0] ?? 'http://127.0.0.1:5343/?scenario=busan';
if (!flags.auto && !/[?&]lv=/.test(url)) url += `${url.includes('?') ? '&' : '?'}lv=4`;
if (!/[?&]hud=/.test(url)) url += '&hud=0';
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal', '--enable-precise-memory-info'],
});
const page = await browser.newPage({ viewport: { width: Number(flags.w ?? 1440), height: Number(flags.h ?? 900) }, deviceScaleFactor: Number(flags.dpr ?? 1) });
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
if (!flags.approach) await waitForContact(page);
if (flags.pre) await fightFor(page, Number(flags.pre));
await page.evaluate((s) => { window.__engine.speed = s; }, Number(flags.speed ?? 1));
if (flags.close) console.log('camera follows', JSON.stringify(await followFight(page, Number(flags.close === 'true' ? 140 : flags.close))));
await page.evaluate(() => {
  window.__ft = [];
  let last = performance.now();
  const loop = (now) => {
    window.__ft.push(now - last);
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
const seconds = Number(flags.seconds ?? 60);
for (let t = 0; t < seconds; t += 3) {
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const e = window.__engine;
    const ft = window.__ft.splice(0);
    const sum = ft.reduce((a, b) => a + b, 0);
    const f = e.fx;
    const info = e.renderer.info;
    return {
      fps: +(ft.length / (sum / 1000)).toFixed(1),
      worst: +Math.max(...ft).toFixed(0),
      simT: Math.round(e.battle.time),
      speed: e.speed,
      ff: e.fastForward,
      ships: e.battle.ships.filter((s) => s.alive).length,
      smoke: f.smoke.count,
      fire: f.fire.count,
      spray: f.spray.count,
      debris: f.debris.count,
      streaks: f.streaks?.count,
      shots: e.battle.projectiles.length,
      dist: Math.round(e.rts.distance),
      follow: e.rts.followId,
      level: e.level,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      heap: Math.round(performance.memory.usedJSHeapSize / 1048576),
    };
  });
  console.log(JSON.stringify(r));
}
await browser.close();
