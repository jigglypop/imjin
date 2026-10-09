// Which part of the scene costs the GPU: frame rate of real fighting with one part hidden at a time. In a headless
// window the frame rate is quantised to vsync, so the average frame interval over a few seconds is what to compare.
//   node scripts/probe-ablate.mjs [url] [--seconds=4] [--pre=12] [--close[=metres]] [--parts=vegetation,terrain,ocean,ships,fx,crew,clouds,shadows,bloom]
import { chromium } from 'playwright-core';
import { fightFor, followFight, waitForContact } from './perf-camera.mjs';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
let url = positional[0] ?? 'http://127.0.0.1:5343/?scenario=busan';
if (!/[?&]lv=/.test(url)) url += `${url.includes('?') ? '&' : '?'}lv=4`;
if (!/[?&]hud=/.test(url)) url += '&hud=0';
const seconds = Number(flags.seconds ?? 4);
const parts = (flags.parts ?? 'vegetation,terrain,ocean,ships,crew,clouds,smoke,fire,spray,debris,shadows').split(',');
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal', ...(flags.uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
});
const page = await browser.newPage({ viewport: { width: Number(flags.w ?? 1440), height: Number(flags.h ?? 900) }, deviceScaleFactor: Number(flags.dpr ?? 1) });
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await waitForContact(page);
if (flags.pre) await fightFor(page, Number(flags.pre));
await page.evaluate(() => { window.__engine.speed = 1; });
if (flags.close) console.log('camera follows', JSON.stringify(await followFight(page, Number(flags.close === 'true' ? 140 : flags.close))));
await page.waitForTimeout(6000);
const measure = async (label, hide, show) => {
  await page.evaluate(hide);
  await page.waitForTimeout(500);
  const r = await page.evaluate(async (ms) => {
    const iv = [];
    let last = performance.now();
    await new Promise((done) => {
      const loop = (now) => {
        iv.push(now - last);
        last = now;
        if (iv.length < 1e6 && now - start < ms) requestAnimationFrame(loop);
        else done();
      };
      const start = performance.now();
      requestAnimationFrame(loop);
    });
    iv.shift();
    return { fps: +(iv.length / (iv.reduce((a, b) => a + b, 0) / 1000)).toFixed(1), avgMs: +(iv.reduce((a, b) => a + b, 0) / iv.length).toFixed(2) };
  }, seconds * 1000);
  await page.evaluate(show);
  return r;
};
const sets = {
  vegetation: [() => { window.__engine.vegetation.group.visible = false; }, () => { window.__engine.vegetation.group.visible = true; }],
  terrain: [() => { window.__engine.terrain.group.visible = false; }, () => { window.__engine.terrain.group.visible = true; }],
  ocean: [() => { window.__engine.ocean.mesh.visible = false; }, () => { window.__engine.ocean.mesh.visible = true; }],
  ships: [() => { window.__engine.views.group.visible = false; }, () => { window.__engine.views.group.visible = true; }],
  fx: [() => { window.__engine.fx.group.visible = false; }, () => { window.__engine.fx.group.visible = true; }],
  crew: [() => { window.__engine.crew.group.visible = false; }, () => { window.__engine.crew.group.visible = true; }],
  clouds: [() => { if (window.__engine.clouds) window.__engine.clouds.mesh.visible = false; }, () => { if (window.__engine.clouds) window.__engine.clouds.mesh.visible = true; }],
  smoke: [() => { window.__engine.fx.smoke.sprite.visible = false; }, () => { window.__engine.fx.smoke.sprite.visible = true; }],
  fire: [() => { window.__engine.fx.fire.sprite.visible = false; }, () => { window.__engine.fx.fire.sprite.visible = true; }],
  spray: [() => { window.__engine.fx.spray.sprite.visible = false; }, () => { window.__engine.fx.spray.sprite.visible = true; }],
  debris: [() => { window.__engine.fx.debris.group.visible = false; }, () => { window.__engine.fx.debris.group.visible = true; }],
  bloom: [() => { window.__engine.bloomNode.strength.value = 0; }, () => { window.__engine.bloomNode.strength.value = 0.26; }],
  shadows: [() => { window.__engine.sun.castShadow = false; }, () => { window.__engine.sun.castShadow = true; }],
};
const reps = Number(flags.reps ?? 3);
const none = () => {};
const sum = new Map();
const add = (label, r) => {
  const x = sum.get(label) ?? { ms: 0, n: 0 };
  x.ms += r.avgMs;
  x.n += 1;
  sum.set(label, x);
};
// Baseline and each part alternate, so a GPU shared with other work shifts both alike.
for (let rep = 0; rep < reps; rep += 1) {
  for (const p of parts) {
    if (!sets[p]) continue;
    add('baseline', await measure('baseline', none, none));
    add(`no ${p}`, await measure(`no ${p}`, ...sets[p]));
  }
}
for (const [label, x] of sum) console.log(label.padEnd(14), `${(x.ms / x.n).toFixed(2)} ms/frame`, `(${x.n} windows)`);
await browser.close();
