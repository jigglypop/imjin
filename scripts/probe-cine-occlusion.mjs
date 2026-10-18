// Occlusion, enclosure and camera-jerk audit of the battle openings' commander close-ups.
// Ship and terrain geometry leaves the CPU after upload, so occlusion is measured on the GPU: every ~0.4 s of a close-up
// the scene is drawn three times into small targets with the speaker in flat magenta — with everything (A), alone (B),
// and without him nor the sea with the far plane 6 m behind him (C).
//   core: share of his head-to-chest silhouette (top 60% of B) not magenta in A; all: of the whole silhouette.
//   box:  share of the frame's upper half (beside him) that C fills: structure right behind him (cabin, canopy, castle).
// Jerk: lens position resampled at a fixed 1/60 s, third difference away from cuts (m/frame^3).
// --search: at each close-up's middle, pauses and tries turns about him and nearer lenses, prints the best set-up.
// Usage: node scripts/probe-cine-occlusion.mjs [--base=http://127.0.0.1:5291] [--ids=hansan,plymouth] [--noframe]
//        [--search] [--out=<dir for frames>] [--json=<file>] [--conc=2]
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const base = args.base ?? 'http://127.0.0.1:5291';
const ALL = ['hansan', 'myeongnyang', 'noryang', 'plymouth', 'portland', 'wight', 'calais', 'gravelines', 'preveza', 'djerba', 'lepanto-north', 'lepanto-centre', 'lepanto-south', 'st-vincent', 'nile', 'finisterre', 'trafalgar-weather', 'trafalgar-lee'];
const ids = args.ids ? args.ids.split(',') : ALL;
const out = args.out;
if (out) await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'] });

const install = () => {
  const e = window.__engine;
  const cin = e.cinema;
  const S = (window.__occ = { cams: [] });
  const tick = () => {
    requestAnimationFrame(tick);
    const r = cin.running;
    if (!r || r.kind !== 'cutscene') return;
    const c = e.camera.position;
    S.cams.push([performance.now(), r.player.t, r.player.shotIndex, c.x, c.y, c.z]);
  };
  tick();
  const ctorOf = (pred) => {
    for (const v of Object.values(e)) {
      if (!v || typeof v !== 'object') continue;
      if (pred(v)) return v.constructor;
      for (const w of Object.values(v)) if (w && typeof w === 'object' && pred(w)) return w.constructor;
    }
    return null;
  };
  const W = 320, H = 180;
  let rts = null, flat = null;
  window.__occMeasure = async () => {
    const r = cin.running;
    if (!r || r.kind !== 'cutscene') return null;
    const pl = r.player;
    const shot = pl.scene.shots[pl.shotIndex];
    if (!shot || shot.cam.type !== 'figure' || !pl.closeOn) return null;
    const cast = cin.cast;
    const m = cast?.members.get(shot.cam.who);
    if (!m?.figure || !m.holder.visible) return null;
    const R = e.renderer, scene = e.scene, cam = e.camera;
    if (!rts) {
      const RT = ctorOf((o) => o.isRenderTarget);
      rts = [0, 1, 2].map(() => new RT(W, H));
      flat = new cast.shadowMat.constructor({ color: 0xff00ff });
    }
    const figs = [];
    m.figure.root.traverse((o) => { if (o.isMesh) figs.push([o, o.material]); });
    const clear = R.getClearColor(cast.shadowMat.color.clone());
    const clearA = R.getClearAlpha();
    const saved = { bg: scene.background, bgn: scene.backgroundNode, fog: scene.fog, fogn: scene.fogNode };
    const disc = m.holder.children[0];
    const dist = m.holder.getWorldPosition(cast.tmp.clone()).distanceTo(cam.position);
    R.setClearColor(0x000000, 0);
    for (const [o] of figs) o.material = flat;
    disc.visible = false;
    scene.fog = null; scene.fogNode = null;
    R.setRenderTarget(rts[0]); R.render(scene, cam);
    const top = scene.children.map((c) => [c, c.visible]);
    for (const c of scene.children) if (c.name !== 'cinema_cast') c.visible = false;
    scene.background = null; scene.backgroundNode = null;
    R.setRenderTarget(rts[1]); R.render(scene, cam);
    for (const [c, v] of top) c.visible = v;
    m.holder.visible = false;
    const oc = e.ocean?.mesh; const ov = oc?.visible; if (oc) oc.visible = false;
    const far = cam.far; cam.far = dist + 6; cam.updateProjectionMatrix();
    R.setRenderTarget(rts[2]); R.render(scene, cam);
    cam.far = far; cam.updateProjectionMatrix();
    if (oc) oc.visible = ov;
    m.holder.visible = true; disc.visible = true;
    for (const [o, mat] of figs) o.material = mat;
    Object.assign(scene, { background: saved.bg, backgroundNode: saved.bgn, fog: saved.fog, fogNode: saved.fogn });
    R.setRenderTarget(null);
    R.setClearColor(clear, clearA);
    const [A, B, C] = await Promise.all(rts.map((rt) => R.readRenderTargetPixelsAsync(rt, 0, 0, W, H)));
    // Which way is up: his silhouette runs off the bottom edge of a chest-up frame.
    let r0 = 0, rN = 0;
    for (let x = 0; x < W; x++) { if (B[x * 4 + 3]) r0++; if (B[((H - 1) * W + x) * 4 + 3]) rN++; }
    const fromTop = (y) => (r0 > rN ? H - 1 - y : y);
    let minT = H, maxT = 0, minX = W, maxX = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (B[(y * W + x) * 4 + 3]) { const t = fromTop(y); minT = Math.min(minT, t); maxT = Math.max(maxT, t); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    if (minT >= H) return { core: 1, all: 1, box: 0, empty: true };
    const coreEnd = minT + (maxT - minT) * 0.6;
    let mc = 0, vc = 0, ma = 0, va = 0, bx = 0, bn = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const t = fromTop(y);
      if (B[i + 3]) {
        const vis = A[i] > 170 && A[i + 1] < 90 && A[i + 2] > 170;
        ma++; if (vis) va++;
        if (t <= coreEnd) { mc++; if (vis) vc++; }
      } else if (t < H * 0.5 && (x < minX - 4 || x > maxX + 4)) { bn++; if (C[i + 3]) bx++; }
    }
    return { core: mc ? 1 - vc / mc : 1, all: ma ? 1 - va / ma : 1, box: bn ? bx / bn : 0 };
  };
  const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  // Slides his post forward along the deck (metres in the ship's frame) and measures each: for decks whose post is walled in.
  window.__occPost = async (args = {}) => {
    const pl = cin.running.player;
    const m = cin.cast.members.get(pl.scene.shots[pl.shotIndex].cam.who);
    const own = { ...m.post };
    cin.togglePause();
    const out = [];
    const grid = [];
    for (const dy of [0, 2.4, 4.8]) for (const dx of [0, -4, -8, -12, -16, -20, -24, -28, 4, 8, 12]) grid.push([dx, dy]);
    const ship = e.battle.get(m.ship);
    const r = e.crew.roster(ship);
    const qd = r.layout.command;
    if (args.qd && qd) { grid.length = 0; for (const f of [0, 2, 4, 6, 8, 10, 12, 14, 16]) grid.push([qd.x + f - own.x, r.main + qd.up - own.y]); }
    for (const [dx, dy] of grid) {
      m.post = { ...own, x: own.x + dx, y: own.y + dy };
      // Paused, the cast does not move him: place him by hand, then let the lens find him.
      cin.cast.update(0, cin.ctx, pl.scene.shots[pl.shotIndex].cam.who);
      await frames(3);
      const g = await window.__occMeasure();
      out.push([+(own.x + dx).toFixed(1), +(own.y + dy).toFixed(1), g && +g.core.toFixed(2), g && +g.box.toFixed(2), +m.holder.position.y.toFixed(2)]);
    }
    m.post = own;
    cin.cast.update(0, cin.ctx, pl.scene.shots[pl.shotIndex].cam.who);
    cin.togglePause();
    return { own, x0: own.x, out };
  };
  // Pauses, tries set-ups about him (a turn, a nearer lens), keeps the best, puts the shot's own back and resumes.
  window.__occSearch = async () => {
    const pl = cin.running.player;
    const own = { ...pl.clear };
    cin.togglePause();
    await frames(3);
    const first = await window.__occMeasure();
    const cost = (g, yaw, dist) => g.core + 0.25 * g.all + 0.5 * g.box + 0.03 * Math.abs(yaw - own.yaw) + 0.1 * (1 - dist);
    let best = { yaw: own.yaw, dist: own.dist, ...first, cost: cost(first, own.yaw, own.dist) };
    const tried = [];
    for (const dist of [1, 0.85, 0.7]) for (const yaw of [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1]) {
      pl.clear = { yaw, dist };
      await frames(3);
      const g = await window.__occMeasure();
      if (!g) continue;
      const c = cost(g, yaw, dist);
      tried.push([yaw, dist, +g.core.toFixed(2), +g.box.toFixed(2)]);
      if (g.core <= 0.05 && c < best.cost - 0.02) best = { yaw, dist, ...g, cost: c };
    }
    pl.clear = own;
    await frames(2);
    cin.togglePause();
    return { first, best, tried };
  };
};

const results = [];
const run = async (id) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (er) => errs.push(er.message));
  // --fixed: every frame advances the page clock by exactly 1/60 s, so jerk is the lens's own, not frame pacing.
  if (args.fixed) await page.addInitScript(() => {
    let now = performance.now();
    performance.now = () => now;
    const raf = window.requestAnimationFrame.bind(window);
    let pending = [];
    window.requestAnimationFrame = (cb) => { pending.push(cb); return pending.length; };
    const pump = () => { now += 1000 / 60; const run = pending; pending = []; for (const cb of run) cb(now); raf(pump); };
    raf(pump);
  });
  await page.goto(`${base}/?scenario=${id}&cutscene=1${args.noframe ? '&noframe=1' : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__engine?.cinema?.progress, null, { timeout: 120000 }).catch(() => {});
  await page.evaluate(install);
  const info = await page.evaluate(() => { const p = window.__engine.cinema.running.player; let t = 0; return p.scene.shots.map((s, i) => { const r = { i, type: s.cam.type, who: s.cam.who, t0: t, t1: t + s.dur }; t += s.dur; return r; }); });
  const figs = info.filter((s) => s.type === 'figure');
  const per = {};
  const frames = [];
  for (const s of figs) {
    const key = `${s.i}:${s.who}`;
    const samples = [];
    let searched = null;
    const mid = s.t0 + (s.t1 - s.t0) * 0.55;
    let shotTaken = false;
    for (;;) {
      const t = await page.evaluate(() => window.__engine.cinema.progress?.t ?? 99);
      if (t >= s.t1 - 0.1) break;
      if (t < s.t0 + 0.6) { await page.waitForTimeout(80); continue; }
      const g = args.jerk ? null : await page.evaluate(() => window.__occMeasure()).catch(() => null);
      if (g && !g.empty) samples.push({ ...g, t });
      if (!shotTaken && t >= mid) {
        shotTaken = true;
        if (out) {
          await page.evaluate(() => window.__engine.cinema.togglePause());
          const f = join(out, `${id}-${s.i}-${s.who}${args.noframe ? '-before' : ''}.png`);
          await page.screenshot({ path: f });
          await page.evaluate(() => window.__engine.cinema.togglePause());
          frames.push(f);
        }
        if (args.post) per[`${s.i}:${s.who}:post`] = await page.evaluate((a) => window.__occPost(a), { qd: !!args.qd }).catch((er) => String(er));
        if (args.search) searched = await page.evaluate(() => window.__occSearch()).catch((er) => ({ error: String(er) }));
      }
      await page.waitForTimeout(250);
    }
    const avg = (k) => (samples.length ? +(samples.reduce((a, x) => a + x[k], 0) / samples.length).toFixed(3) : null);
    const max = (k) => (samples.length ? +Math.max(...samples.map((x) => x[k])).toFixed(3) : null);
    per[key] = { ...per[key], trace: args.trace ? samples.map((x) => [x.t, +x.core.toFixed(2), +x.box.toFixed(2)]) : undefined, samples: samples.length, coreAvg: avg('core'), coreMax: max('core'), allAvg: avg('all'), boxAvg: avg('box'), searched: searched && { best: searched.best && { yaw: searched.best.yaw, dist: searched.best.dist, core: +searched.best.core?.toFixed(3), box: +searched.best.box?.toFixed(3) }, first: searched.first, error: searched.error } };
  }
  const S = await page.evaluate(() => window.__occ);
  await page.close();
  for (const s of figs) {
    const cams = S.cams.filter((c) => c[2] === s.i);
    const rs = [];
    if (cams.length > 10) {
      for (let t = cams[0][0] + 250 + (args.fixed ? 1e-3 : 0), j = 0; t <= cams[cams.length - 1][0]; t += 1000 / 60) {
        while (j < cams.length - 2 && cams[j + 1][0] < t) j++;
        const a = cams[j], b = cams[j + 1];
        // A pause (the screenshot, the search) holds the clock: skip spans where the scene time stood still.
        if (b[1] - a[1] < 1e-4 && b[0] - a[0] > 40) continue;
        const k = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0] || 1)));
        rs.push([3, 4, 5].map((q) => a[q] + (b[q] - a[q]) * k));
      }
    }
    if (args.fixed) {
      // One sample per page frame, each exactly 1/60 s apart: no resampling, past the first 0.25 s after the cut.
      rs.length = 0;
      let last = -1;
      for (const c of cams) if (c[0] !== last && c[0] >= cams[0][0] + 250) { last = c[0]; rs.push(c.slice(3)); }
    }
    const js = [];
    for (let i = 3; i < rs.length; i++) js.push(Math.hypot(...[0, 1, 2].map((q) => rs[i][q] - 3 * rs[i - 1][q] + 3 * rs[i - 2][q] - rs[i - 3][q])));
    js.sort((a, b) => a - b);
    const key = `${s.i}:${s.who}`;
    per[key].jerkMean = +(js.reduce((a, x) => a + x, 0) / (js.length || 1)).toFixed(4);
    per[key].jerkP95 = +(js[Math.floor(js.length * 0.95)] ?? 0).toFixed(4);
    per[key].jerkMax = +(js[js.length - 1] ?? 0).toFixed(4);
  }
  const r = { id, shots: per, frames, errors: errs.slice(0, 3) };
  results.push(r);
  console.log(JSON.stringify(r));
};

const conc = Number(args.conc ?? 2);
const queue = [...ids];
await Promise.all(Array.from({ length: conc }, async () => { while (queue.length) { const id = queue.shift(); try { await run(id); } catch (er) { console.log(JSON.stringify({ id, fail: String(er).slice(0, 200) })); } } }));
await browser.close();
if (args.json) await writeFile(args.json, JSON.stringify(results, null, 1));
