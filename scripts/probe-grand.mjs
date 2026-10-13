// Campaign map (진영 전역) performance on desktop WebGPU (Edge + D3D11 on Windows, Chrome + Metal on macOS): how long the
// 3D world takes to appear, then GPU frames, GPU time per frame, draw calls and triangles, and main-thread frame times
// while the map rests, pans, turns and zooms. The GPU is shared with whatever else runs, so compare runs back to back.
// Usage: node scripts/probe-grand.mjs [--url=http://127.0.0.1:5291/] [--size=1920x1080] [--dpr=1] [--uncapped] [--shots=<dir>] [--tag=<name>]
//   [--also=busan,fleet:0]   with --shots, one more close-up over each of these ports (or the Nth fleet marker) at the end
//   [--block=<url glob>]     requests that fail, to see a fallback
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
const url = args.url ?? 'http://127.0.0.1:5291/';
const [width, height] = (args.size ?? '1920x1080').split('x').map(Number);
const dpr = Number(args.dpr ?? 1);
const tag = args.tag ?? 'run';
const shots = args.shots ?? null;
if (shots) await mkdir(shots, { recursive: true });

// A war in progress with camps of every navy and tier along the coast, built by the game's own rules.
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const { newGrand } = await vite.ssrLoadModule('/src/sim/grand/turn.ts');
const save = newGrand('joseon', 551);
save.phase = 'orders';
save.events.pending = null;
for (const [id, level, owner] of [['yeosu', 3], ['noryang', 2], ['bangdap', 1], ['busan', 3], ['angolpo', 2], ['geoje', 2], ['sacheon', 3, 'japan'], ['ungcheon', 2, 'ming']]) {
  const r = save.regions[id];
  if (!r) continue;
  if (owner) r.owner = owner;
  const camp = r.buildings.find((b) => b.kind === 'camp');
  if (camp) camp.level = level; else r.buildings.push({ kind: 'camp', level, upgradeLeft: 0, hp: 1 });
}
await vite.close();

const flags = ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'];
if (process.platform === 'win32') flags.push('--use-angle=d3d11');
if (args.uncapped) flags.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true, args: flags });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((data) => {
    localStorage.setItem('imjin.grand.v1', JSON.stringify(data));
    localStorage.setItem('imjin.grand.guide.v1', '1');
    // Every GPU submit: when it was made, how long the GPU took to finish it, its draw calls and triangles.
    const log = { submits: [], draws: 0, tris: 0, frames: [], long: [] };
    window.__probe = log;
    if (window.GPUQueue) {
      const submit = GPUQueue.prototype.submit;
      GPUQueue.prototype.submit = function (...a) {
        const t0 = performance.now();
        const entry = { t: t0, draws: log.draws, tris: log.tris, gpu: -1 };
        log.draws = 0; log.tris = 0;
        log.submits.push(entry);
        const out = submit.apply(this, a);
        this.onSubmittedWorkDone().then(() => { entry.gpu = performance.now() - t0; });
        return out;
      };
    }
    if (window.GPURenderPassEncoder) {
      const draw = GPURenderPassEncoder.prototype.draw, drawIndexed = GPURenderPassEncoder.prototype.drawIndexed;
      GPURenderPassEncoder.prototype.draw = function (count, instances = 1, ...rest) { log.draws += 1; log.tris += (count * instances) / 3; return draw.call(this, count, instances, ...rest); };
      GPURenderPassEncoder.prototype.drawIndexed = function (count, instances = 1, ...rest) { log.draws += 1; log.tris += (count * instances) / 3; return drawIndexed.call(this, count, instances, ...rest); };
    }
    // The page's own frames: a busy main thread stretches them.
    const tick = (now) => { log.frames.push(now); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    try { new PerformanceObserver((list) => { for (const e of list.getEntries()) log.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch { /* not supported */ }
  }, save);
  // A failed download, to see the map's fallbacks (for example --block=**/models/ships-map/**).
  if (args.block) await page.route(args.block, (route) => route.abort());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('.menu-primary[data-mode="faction"]').click({ timeout: 60000 });
  const start = await page.evaluate(() => performance.now());
  await page.locator('.g-hub__actions .g-btn--primary').click();
  await page.locator('.gm[data-relief="ready"]').waitFor({ timeout: 90000 });
  const ready = await page.evaluate(() => performance.now());
  await page.waitForTimeout(3000);

  const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1) : null; };
  /** What the GPU and the page did while `action` ran. */
  const measure = async (name, action) => {
    const t0 = await page.evaluate(() => performance.now());
    await action();
    await page.waitForTimeout(400);
    const t1 = await page.evaluate(() => performance.now());
    const raw = await page.evaluate(([a, b]) => {
      const log = window.__probe;
      return { submits: log.submits.filter((s) => s.t >= a && s.t <= b), frames: log.frames.filter((f) => f >= a && f <= b), long: log.long.filter(([s]) => s >= a && s <= b) };
    }, [t0, t1]);
    const seconds = (t1 - t0) / 1000;
    const gaps = raw.submits.slice(1).map((s, i) => s.t - raw.submits[i].t);
    const frameGaps = raw.frames.slice(1).map((f, i) => f - raw.frames[i]);
    const gpu = raw.submits.map((s) => s.gpu).filter((g) => g >= 0);
    const row = {
      phase: name,
      gpuFps: +(raw.submits.length / seconds).toFixed(1),
      submitGapP50: pct(gaps, 0.5), submitGapP95: pct(gaps, 0.95),
      gpuMsP50: pct(gpu, 0.5), gpuMsP95: pct(gpu, 0.95),
      drawsP50: pct(raw.submits.map((s) => s.draws), 0.5),
      trisP50: Math.round(pct(raw.submits.map((s) => s.tris), 0.5) ?? 0),
      pageFrameP50: pct(frameGaps, 0.5), pageFrameP95: pct(frameGaps, 0.95), pageFrameMax: pct(frameGaps, 1),
      longTasks: raw.long.length, longTaskMs: Math.round(raw.long.reduce((a, [, d]) => a + d, 0)),
    };
    console.log(JSON.stringify(row));
    return row;
  };
  const shot = (name) => (shots ? page.screenshot({ path: `${shots}/${tag}-${name}.png` }) : Promise.resolve());
  const cx = width / 2, cy = height / 2;
  const drag = async (button, dx, dy, ms = 2000) => {
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button });
    const steps = Math.round(ms / 16);
    for (let i = 1; i <= steps; i += 1) { await page.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps); await page.waitForTimeout(16); }
    await page.mouse.up({ button });
  };

  console.log(JSON.stringify({ tag, size: `${width}x${height}@${dpr}`, uncapped: !!args.uncapped, readyMs: Math.round(ready - start) }));
  await shot('1-open');
  await measure('idle', () => page.waitForTimeout(4000));
  await measure('pan', async () => { await drag('left', -420, 160); await drag('left', 420, -160); });
  await measure('rotate', async () => { await drag('right', 360, 0); await drag('right', -360, 60); });
  await shot('2-turned');
  await measure('zoom', async () => {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 40; i += 1) { await page.mouse.wheel(0, -60); await page.waitForTimeout(25); }
    for (let i = 0; i < 20; i += 1) { await page.mouse.wheel(0, 60); await page.waitForTimeout(25); }
  });
  // Close over a camp, where the camps, ships and trees are at their most detailed.
  const disc = page.locator('.gm-node[data-region="yeosu"] .gm-node__disc');
  if (await disc.count()) {
    const b = await disc.boundingBox();
    if (b) {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      for (let i = 0; i < 26; i += 1) { await page.mouse.wheel(0, -60); await page.waitForTimeout(25); }
      await page.waitForTimeout(1500);
    }
  }
  await measure('close-idle', () => page.waitForTimeout(3000));
  await shot('3-close');
  await measure('close-pan', async () => { await drag('left', -300, 120); });
  // More close-ups for the screenshots: out to the whole coast, then in over each port named by --also (no measuring).
  for (const id of args.also ? args.also.split(',') : []) {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 40; i += 1) { await page.mouse.wheel(0, 60); await page.waitForTimeout(25); }
    await page.waitForTimeout(800);
    // `fleet:N` closes in on the Nth fleet marker instead of a port, nearer still.
    const fleet = id.startsWith('fleet:') ? Number(id.slice(6)) : -1;
    const node = fleet >= 0 ? page.locator('.gm-fleet').nth(fleet) : page.locator(`.gm-node[data-region="${id}"] .gm-node__disc`);
    const b = (await node.count()) ? await node.boundingBox() : null;
    if (!b) { console.log(`no marker for ${id}`); continue; }
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    for (let i = 0; i < (fleet >= 0 ? 34 : 26); i += 1) { await page.mouse.wheel(0, -60); await page.waitForTimeout(25); }
    await page.waitForTimeout(1500);
    await shot(`4-${id.replace(':', '')}`);
  }
  console.log(errors.slice(0, 8).join('\n') || 'no page errors');
} finally {
  await browser.close();
}
