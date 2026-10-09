// Big-battle performance on desktop Chrome (WebGPU): fps, frame-time breakdown by engine stage, draw calls and
// triangles per frame, JS heap churn and GC-sized frame hitches over a window of real fighting.
//   node scripts/probe-perf.mjs --url=http://127.0.0.1:5343/?scenario=busan [--speed=1] [--seconds=30] [--wait=120] [--alloc] [--cpu [--callers=fn]] [--uncapped] [--audio] [--close[=metres]] [--pre=seconds at 32x before the window]
// It lets the approach fast-forward run (up to --wait seconds), pins the quality level (?lv=4 unless the url sets it) so
// the adaptive controller cannot change the picture, sets --speed and measures --seconds of combat. --alloc adds a CDP
// sampling allocation profile and prints the top allocating functions.
import { chromium } from 'playwright-core';
import { fightFor, followFight, waitForContact } from './perf-camera.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
let url = args.url ?? 'http://127.0.0.1:5343/?scenario=busan';
if (!/[?&]lv=/.test(url)) url += `${url.includes('?') ? '&' : '?'}lv=4`;
if (!/[?&]hud=/.test(url)) url += '&hud=0';
const speed = Number(args.speed ?? 1);
const seconds = Number(args.seconds ?? 30);
const wait = Number(args.wait ?? 120);
const w = Number(args.w ?? 1440);
const h = Number(args.h ?? 900);

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal', '--enable-precise-memory-info', '--js-flags=--expose-gc', ...(args.uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
if (args.audio) {
  // Counts the Web Audio nodes the battle creates, as nodes per second of real time.
  await page.addInitScript(() => {
    window.__nodes = {};
    const ctxs = [window.BaseAudioContext].filter(Boolean);
    for (const C of ctxs) {
      for (const name of Object.getOwnPropertyNames(C.prototype)) {
        if (!/^create/.test(name) || typeof C.prototype[name] !== 'function') continue;
        const f = C.prototype[name];
        C.prototype[name] = function (...a) {
          window.__nodes[name] = (window.__nodes[name] ?? 0) + 1;
          return f.apply(this, a);
        };
      }
    }
  });
}
page.on('pageerror', (e) => console.error('pageerror', String(e).slice(0, 200)));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });

// Let the approach run at 128x until contact ends it.
const t0 = Date.now();
await waitForContact(page, wait);
console.log('contact after', ((Date.now() - t0) / 1000).toFixed(1), 's real');
if (args.pre) await fightFor(page, Number(args.pre));
await page.evaluate((s) => {
  window.__engine.speed = s;
}, speed);
if (args.close) console.log('camera follows', JSON.stringify(await followFight(page, Number(args.close === 'true' ? 140 : args.close))));
// Fighting needs a few sim seconds to build up (crews, boarding, fires) before the window starts.
await page.waitForTimeout(Number(args.settle ?? 8) * 1000);

// The sound starts on the first touch of the page.
if (args.audio) await page.mouse.click(w / 2, h / 2);
if (args.audio) await page.waitForTimeout(1500);
if (args.audio) await page.evaluate(() => { window.__nodes0 = { ...window.__nodes }; });
const cdp = args.alloc || args.cpu ? await page.context().newCDPSession(page) : null;
if (cdp && args.cpu) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  await cdp.send('Profiler.start');
}
if (cdp && args.alloc) {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
}

await page.evaluate(() => {
  const e = window.__engine;
  const r = e.renderer;
  r.info.autoReset = false;
  const stages = {};
  const wrap = (obj, name, label) => {
    if (!obj || typeof obj[name] !== 'function') return;
    const f = obj[name].bind(obj);
    obj[name] = (...a) => {
      const t = performance.now();
      const v = f(...a);
      stages[label] = (stages[label] ?? 0) + performance.now() - t;
      return v;
    };
  };
  wrap(e.battle, 'step', 'sim.step');
  wrap(e.views, 'sync', 'views.sync');
  wrap(e.sound, 'update', 'sound.update');
  wrap(e.sound, 'tick', 'sound.tick');
  wrap(e.fx, 'handle', 'fx.handle');
  wrap(e.crew, 'handle', 'crew.handle');
  wrap(e.fx, 'update', 'fx.update');
  wrap(e.crew, 'update', 'crew.update');
  wrap(e.lanterns, 'update', 'lanterns.update');
  wrap(e.ocean, 'update', 'ocean.update');
  wrap(e.clouds, 'update', 'clouds.update');
  wrap(e.vegetation, 'update', 'vegetation.update');
  wrap(e.structures, 'update', 'structures.update');
  wrap(e.banners, 'update', 'banners.update');
  wrap(e.director, 'update', 'director.update');
  wrap(e.rts, 'update', 'rts.update');
  wrap(e.wake, 'update', 'wake.update');
  wrap(e.fft, 'update', 'fft.update');
  wrap(e.clouds, 'render', 'clouds.render');
  wrap(e.pipeline, 'render', 'pipeline.render');
  wrap(e, 'publish', 'publish');
  wrap(e, 'stepSim', 'stepSim');
  const log = { frames: 0, intervals: [], updateMs: [], renderMs: [], heap: [], draws: [], tris: [], calls: [], stepsSim: 0, simTime0: e.battle.time, level: e.level };
  window.__perf = { stages, log, stop: false };
  const upd = e.update.bind(e);
  e.update = (dt) => {
    const t = performance.now();
    upd(dt);
    log.updateMs.push(performance.now() - t);
  };
  const ren = e.render.bind(e);
  e.render = () => {
    r.info.reset();
    const t = performance.now();
    ren();
    log.renderMs.push(performance.now() - t);
    log.draws.push(r.info.render.drawCalls);
    log.tris.push(r.info.render.triangles);
    log.calls.push(r.info.render.calls);
    log.heap.push(performance.memory.usedJSHeapSize);
  };
  let last = performance.now();
  const loop = (now) => {
    log.intervals.push(now - last);
    last = now;
    log.frames += 1;
    if (!window.__perf.stop) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
await page.waitForTimeout(seconds * 1000);
const out = await page.evaluate(() => {
  window.__perf.stop = true;
  const e = window.__engine;
  const { stages, log } = window.__perf;
  const sorted = (a) => [...a].sort((x, y) => x - y);
  const pct = (a, p) => {
    const s = sorted(a);
    return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
  };
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const iv = log.intervals.slice(1);
  let up = 0;
  let gcDrops = 0;
  let gcFrames = 0;
  let maxDrop = 0;
  for (let i = 1; i < log.heap.length; i += 1) {
    const d = log.heap[i] - log.heap[i - 1];
    if (d > 0) up += d;
    else if (d < -1e6) {
      gcDrops += 1;
      maxDrop = Math.max(maxDrop, -d);
      if (log.updateMs[i] + log.renderMs[i] > 30 || iv[i] > 50) gcFrames += 1;
    }
  }
  const r = e.renderer;
  const fr = Math.max(1, log.updateMs.length);
  const total = iv.reduce((a, b) => a + b, 0) / 1000;
  const stageMs = Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, +(v / fr).toFixed(3)]).sort((a, b) => b[1] - a[1]));
  const m = r.info.memory;
  return {
    level: e.level,
    scenario: e.scenarioId ?? null,
    ships: e.battle.ships.filter((s) => s.alive).length,
    simSecondsAdvanced: +(e.battle.time - log.simTime0).toFixed(1),
    seconds: +total.toFixed(1),
    fps: +(iv.length / total).toFixed(1),
    engineFps: e.fps,
    frameMs: { avg: +avg(iv).toFixed(2), p50: +pct(iv, 0.5).toFixed(2), p95: +pct(iv, 0.95).toFixed(2), p99: +pct(iv, 0.99).toFixed(2), max: +Math.max(...iv).toFixed(1) },
    framesOver33: iv.filter((x) => x > 33.5).length,
    framesOver50: iv.filter((x) => x > 50).length,
    updateMs: { avg: +avg(log.updateMs).toFixed(2), p95: +pct(log.updateMs, 0.95).toFixed(2), max: +Math.max(...log.updateMs).toFixed(1) },
    renderCpuMs: { avg: +avg(log.renderMs).toFixed(2), p95: +pct(log.renderMs, 0.95).toFixed(2), max: +Math.max(...log.renderMs).toFixed(1) },
    stageMsPerFrame: stageMs,
    drawCalls: { avg: Math.round(avg(log.draws)), max: Math.max(...log.draws) },
    renderPasses: Math.round(avg(log.calls)),
    triangles: { avg: Math.round(avg(log.tris)), max: Math.max(...log.tris) },
    heapMB: { start: +(log.heap[0] / 1048576).toFixed(0), end: +(log.heap[log.heap.length - 1] / 1048576).toFixed(0), max: +(Math.max(...log.heap) / 1048576).toFixed(0) },
    allocMBPerSec: +(up / 1048576 / total).toFixed(2),
    gcDrops,
    gcDropsInSlowFrames: gcFrames,
    biggestGcMB: +(maxDrop / 1048576).toFixed(1),
    gpu: { geometries: m.geometries, textures: m.textures, programs: m.programs, totalMB: Math.round(m.total / 1e6) },
    gpuProbeMs: e.gpuMs == null ? null : +e.gpuMs.toFixed(1),
  };
});
console.log(JSON.stringify(out, null, 1));
if (args.audio) {
  const nodes = await page.evaluate(() => Object.fromEntries(Object.entries(window.__nodes).map(([k, v]) => [k, v - (window.__nodes0[k] ?? 0)])));
  const per = Object.fromEntries(Object.entries(nodes).map(([k, v]) => [k, +(v / seconds).toFixed(1)]));
  console.log('audio nodes created per second of the window', JSON.stringify(per));
}
if (cdp && args.cpu) {
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => {
    const f = byId.get(id).callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/').split('?')[0]}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
  });
  if (args.callers) {
    // Who calls the named function, by the caller's own line.
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const by = new Map();
    profile.samples.forEach((id, i) => {
      if (byId.get(id).callFrame.functionName !== args.callers) return;
      const f = byId.get(parent.get(id)).callFrame;
      const key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/').split('?')[0]}:${f.lineNumber + 1}`;
      by.set(key, (by.get(key) ?? 0) + (dt[i] ?? 0));
    });
    console.log(`callers of ${args.callers}`);
    for (const [k, v] of [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(String((v / 1000 / seconds).toFixed(1)).padStart(8), 'ms/s', k);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  console.log('cpu self time over', (total / 1e6).toFixed(1), 's of samples');
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(args.top ?? 28))) console.log(String((v / 1000 / seconds).toFixed(1)).padStart(8), 'ms/s', k);
}
if (cdp && args.alloc) {
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const self = new Map();
  const walk = (n) => {
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + n.selfSize);
    n.children.forEach(walk);
  };
  walk(profile.head);
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
  const tot = [...self.values()].reduce((a, b) => a + b, 0);
  console.log('allocation sampling (retained+freed samples) total', Math.round(tot / 1024), 'KB');
  for (const [k, v] of rows) console.log(String(Math.round(v / 1024)).padStart(8), 'KB', k);
}
await browser.close();
