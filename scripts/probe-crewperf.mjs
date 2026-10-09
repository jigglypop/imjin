// Times Crew.update (CPU) over a boarding fight and counts the heap it allocates, to check the presentation stays cheap.
//   node scripts/probe-crewperf.mjs --q=high|medium|low --seconds=6
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal', '--enable-precise-memory-info'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${args.url ?? 'http://127.0.0.1:5311/'}?scenario=hansan&hud=0&q=${args.q ?? 'high'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.evaluate(() => {
  const e = window.__engine;
  const b = e.battle;
  const a = b.ships.find((s) => s.alive && s.spec.kind === 'atakebune' && s.team === 'japan') ?? b.ships.find((s) => s.alive && s.team === 'japan');
  const d = b.ships.find((s) => s.alive && s.spec.kind === 'panokseon' && s.team === 'joseon');
  for (const s of [a, d]) {
    s.speed = 0;
    s.throttle = 0;
    s.fireMode = 'hold';
  }
  a.stance = 'board';
  a.heading = 0;
  d.heading = 0;
  for (let i = 0; i < 4; i += 1) a.roles[i] *= 3;
  a.crew *= 3;
  const hold = () => {
    a.speed = 0;
    d.speed = 0;
    a.x = d.x;
    a.z = d.z + (a.spec.beam + d.spec.beam) / 2 + 3;
    a.fire = 0;
    d.fire = 0;
  };
  hold();
  window.__hold = setInterval(hold, 16);
  b.tryGrapple(a, d);
  e.rts.setPose({ tx: d.x, tz: d.z + 6, yaw: 1.57, pitch: 0.6, distance: 40 });
});
await page.waitForTimeout(Number(args.seconds ?? 6) * 1000);
const out = await page.evaluate(() => {
  const e = window.__engine;
  e.paused = true;
  const view = { cutaway: 0, cut: new Set(), winner: null };
  // With the battle frozen, call the crew update in a loop and see what it costs and allocates.
  const N = 2000;
  const h0 = performance.memory.usedJSHeapSize;
  const t0 = performance.now();
  for (let i = 0; i < N; i += 1) e.crew.update(e.battle, 0.016, e.camera, view);
  const ms = (performance.now() - t0) / N;
  const h1 = performance.memory.usedJSHeapSize;
  // The same, for the boarding layer alone.
  const bo = e.crew.boarding;
  const z0 = performance.memory.usedJSHeapSize;
  let sink = 0;
  for (let i = 0; i < N; i += 1) sink += e.battle.get(i % 50)?.x ?? 0;
  const z1 = performance.memory.usedJSHeapSize;
  const g0 = performance.memory.usedJSHeapSize;
  for (let i = 0; i < N; i += 1) bo.begin(e.battle, bo.time + 0.016, 0.016, e.crew.frame);
  const g1 = performance.memory.usedJSHeapSize;
  for (let i = 0; i < N; i += 1) bo.draw(e.battle, e.crew.assets, e.camera);
  const g2 = performance.memory.usedJSHeapSize;
  return {
    baselineBytes: Math.round((z1 - z0) / N),
    sink: sink > 0,
    beginBytes: Math.round((g1 - g0) / N),
    drawBytes: Math.round((g2 - g1) / N),
    msPerUpdate: +ms.toFixed(3),
    bytesPerUpdate: Math.round((h1 - h0) / N),
    figs: e.crew.boarding.figs.filter((f) => f.used).length,
    fights: e.crew.boarding.fights.filter((f) => f.used).length,
    drawn: [...e.crew.assets.values()].reduce((n, x) => n + x.lods[0].count + x.lods[1].count + x.lods[2].count, 0),
    props: e.crew.boarding.nProps,
  };
});
console.log(JSON.stringify({ q: args.q ?? 'high', ...out }));
await browser.close();
