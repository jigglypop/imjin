// A big battle on the WebKit iPhone path (WebGL2, ?q=low): draw calls and triangles per frame in the thick of the fight,
// shader programs, GPU memory from renderer.info and the WebKit processes' RSS. The Mac's frame rate says nothing about a
// phone, so this reports what a phone would have to draw and hold.
//   node scripts/probe-phone.mjs [url] [--pre=10] [--close[=metres]] [--seconds=6] [--speed=1] [--shot=<png>]
import { webkit, devices } from 'playwright-core';
import { execSync } from 'node:child_process';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
let url = positional[0] ?? 'http://127.0.0.1:5343/?scenario=busan';
if (!/[?&]q=/.test(url)) url += `${url.includes('?') ? '&' : '?'}q=low`;
const before = new Set(execSync('ps -axo pid=').toString().trim().split(/\s+/));
const rss = () => {
  const rows = execSync('ps -axo pid=,rss=,comm=').toString().trim().split('\n').map((l) => l.trim().split(/\s+/));
  return Math.round(rows.filter(([pid, , comm]) => !before.has(pid) && /WebKit/.test(comm ?? '')).reduce((s, r) => s + Number(r[1]), 0) / 1024);
};
const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const t0 = Date.now();
while (Date.now() - t0 < 120000 && (await page.evaluate(() => window.__engine.fastForward || window.__engine.autoFast))) await page.waitForTimeout(500);
const readyRss = rss();
if (flags.pre) {
  await page.evaluate(() => { window.__engine.speed = 32; });
  await page.waitForTimeout(Number(flags.pre) * 1000);
}
await page.evaluate((s) => { window.__engine.speed = s; }, Number(flags.speed ?? 1));
if (flags.close) {
  await page.evaluate((dist) => {
    const e = window.__engine;
    const live = e.battle.ships.filter((s) => s.alive && s.sinking <= 0);
    let best = null;
    let bestScore = -1;
    for (const a of live) {
      let near = 0;
      for (const b of live) if (b.team !== a.team && (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < 250 * 250) near += 1;
      const score = near + (a.grappledWith ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    if (best) e.rts.setPose({ tx: best.x, tz: best.z, yaw: 0.8, pitch: 0.5, distance: dist });
  }, Number(flags.close === 'true' ? 140 : flags.close));
}
await page.waitForTimeout(4000);
const out = await page.evaluate(async (ms) => {
  const e = window.__engine;
  const be = e.renderer.backend;
  const parts = {};
  let draws = 0;
  let tris = 0;
  let frames = 0;
  const draw = be.draw.bind(be);
  be.draw = (ro, info) => {
    // An instanced mesh with nothing to draw reaches the backend and returns there: it is not a draw call.
    if (ro.getDrawParameters() === null) return draw(ro, info);
    const o = ro.object;
    const g = ro.geometry;
    const idx = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
    const inst = o.isInstancedMesh ? o.count : (g.instanceCount ?? 1);
    const k = `${o.name || o.constructor.name}${o.isInstancedMesh ? '*' : ''} ${g.type}${ro.context?.renderTarget ? ' target' : ''}`;
    parts[k] = (parts[k] ?? 0) + 1;
    draws += 1;
    tris += (idx / 3) * inst;
    return draw(ro, info);
  };
  const render = e.render.bind(e);
  e.render = () => {
    frames += 1;
    render();
  };
  const h0 = performance.memory?.usedJSHeapSize;
  await new Promise((r) => setTimeout(r, ms));
  be.draw = draw;
  e.render = render;
  const m = e.renderer.info.memory;
  const per = (n) => Math.round((n / Math.max(1, frames)) * 10) / 10;
  return {
    scenario: e.scenarioId,
    ships: e.battle.ships.filter((s) => s.alive).length,
    level: e.level,
    frames,
    drawsPerFrame: per(draws),
    trianglesPerFrame: Math.round(tris / Math.max(1, frames)),
    top: Object.fromEntries(Object.entries(parts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, per(v)])),
    programs: m.programs,
    geometries: m.geometries,
    textures: m.textures,
    gpuTotalMB: Math.round(m.total / 1e6),
    textureMB: Math.round(m.texturesSize / 1e6),
    h0,
  };
}, Number(flags.seconds ?? 6) * 1000);
if (flags.shot) await page.screenshot({ path: flags.shot });
const total = rss();
console.log(JSON.stringify({ ...out, rssAtContactMB: readyRss, rssMB: total }, null, 1));
await browser.close();
