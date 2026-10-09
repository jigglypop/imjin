// The e2e checks. Each one gets a context {base, args, browsers, shot(page)} and returns {status, details, metrics}.
// Screens are recognised by generic signals (no fatal errors, a canvas or a populated root, window.__ready for battles),
// never by class names, so the checks survive UI restyles.
import { backendOf, fatalProblems, openPage, sampleFrames, screenState, sleep, waitForScreen, waitReady } from './util.mjs';

const DESKTOP = [
  { id: 'desktop-1440x900', viewport: { width: 1440, height: 900 } },
  { id: 'desktop-1280x720', viewport: { width: 1280, height: 720 } },
];
const PHONE = [
  { id: 'ios-portrait', orient: 'portrait' },
  { id: 'ios-landscape', orient: 'landscape' },
];

const num = (v, d) => (v === undefined ? d : Number(v));
const urlOf = (base, query) => new URL(query ? `/?${query}` : '/', base).toString();
const MB = 1024 * 1024;

function viewportOf(spec) {
  const [w, h] = String(spec ?? '1280x720').split('x').map(Number);
  return { width: w, height: h };
}

/** Opens the menu/select screen and reports whether it rendered cleanly. */
async function menuCheck(ctx, kind, viewport, orient, { overflow = false } = {}) {
  const s = await openPage(ctx.browsers, kind, viewport, orient, urlOf(ctx.base));
  try {
    const state = await waitForScreen(s.page, num(ctx.args['menu-timeout'], 45000));
    await sleep(2500);
    const settled = await screenState(s.page);
    const issues = fatalProblems(s.problems);
    if (!state || state.error || !(state.canvas > 0 || (state.rootChildren > 0 && state.textLength > 0))) issues.push('no canvas or populated root appeared');
    if (settled.fatalText) issues.push(`fatal text on screen: ${settled.fatalText}`);
    const metrics = { canvas: settled.canvas, textLength: settled.textLength, scrollWidth: settled.scrollWidth, innerWidth: settled.innerWidth };
    if (overflow && settled.scrollWidth > settled.innerWidth + 1) issues.push(`horizontal overflow: scrollWidth ${settled.scrollWidth} > innerWidth ${settled.innerWidth}`);
    const shot = await ctx.shot(s.page);
    return { status: issues.length ? 'FAIL' : 'PASS', details: issues.length ? issues : [`canvas=${settled.canvas} text=${settled.textLength} scrollWidth=${settled.scrollWidth}/${settled.innerWidth}`], metrics, warnings: s.problems.consoleErrors.slice(0, 3), shot };
  } finally {
    await s.close();
  }
}

/** Loads a battle URL on desktop Chrome and waits for window.__ready; optionally samples frames. */
async function battleCheck(ctx, query, { frames = true } = {}) {
  const viewport = viewportOf(ctx.args['battle-size']);
  const readyTimeout = num(ctx.args['ready-timeout'], 150000);
  const s = await openPage(ctx.browsers, 'chrome', viewport, undefined, urlOf(ctx.base, query));
  try {
    const ms = await waitReady(s.page, readyTimeout);
    const issues = fatalProblems(s.problems);
    const metrics = { readyMs: ms };
    if (ms == null) {
      const st = await screenState(s.page);
      issues.push(`window.__ready not set within ${Math.round(readyTimeout / 1000)}s${st.fatalText ? ` (${st.fatalText})` : ''}`);
    } else {
      const st = await screenState(s.page);
      if (st.fatalText) issues.push(`fatal text on screen: ${st.fatalText}`);
      metrics.backend = await backendOf(s.page);
      if (ctx.args['allow-webgl'] !== 'true') {
        if (!metrics.backend) issues.push('backend unknown (window.__info and engine.renderer.backend unavailable; pass --allow-webgl to skip)');
        else if (metrics.backend !== 'webgpu') issues.push(`renderer backend is ${metrics.backend}, expected webgpu (pass --allow-webgl to accept)`);
      }
      if (frames) {
        const f = await sampleFrames(s.page, 3000);
        Object.assign(metrics, { engineFps: f.engineFps, framesIn3s: f.frames });
        if (!(f.engineFps > 0) && !(f.frames > 0)) issues.push(`no frames rendered (fps ${f.engineFps}, frames ${f.frames})`);
        else if (f.frames != null && !(f.frames > 0)) issues.push(`renderer frame counter did not advance (fps ${f.engineFps})`);
      }
    }
    const shot = await ctx.shot(s.page);
    return { status: issues.length ? 'FAIL' : 'PASS', details: issues.length ? issues : [`ready in ${(ms / 1000).toFixed(1)}s, ${metrics.backend ?? '?'}, fps ${metrics.engineFps ?? '-'}`], metrics, warnings: s.problems.consoleErrors.slice(0, 3), shot };
  } finally {
    await s.close();
  }
}

async function approachCheck(ctx) {
  const limit = num(ctx.args['ff-timeout'], 90) * 1000;
  const s = await openPage(ctx.browsers, 'chrome', viewportOf(ctx.args['battle-size']), undefined, urlOf(ctx.base, 'scenario=hansan'));
  try {
    const ms = await waitReady(s.page, num(ctx.args['ready-timeout'], 150000));
    if (ms == null) return { status: 'FAIL', details: [...fatalProblems(s.problems), 'window.__ready not set, cannot measure the approach'], shot: await ctx.shot(s.page) };
    // At the top multipliers the whole approach can finish during the 30 frames before __ready: the battle clock is
    // then already far ahead of the second or two of real time those frames took.
    const atReady = await s.page.evaluate(() => ({ auto: window.__engine?.autoFast === true, sim: window.__engine?.battle?.time ?? 0 })).catch(() => null);
    if (atReady && !atReady.auto && atReady.sim > 15) {
      const issues = fatalProblems(s.problems);
      return {
        status: issues.length ? 'FAIL' : 'PASS',
        details: issues.length ? issues : [`approach already fast-forwarded before ready: sim ${Math.round(atReady.sim)}s`],
        metrics: { sawFastForward: true, simTime: Math.round(atReady.sim) },
        shot: await ctx.shot(s.page),
      };
    }
    // Page-side per-frame watcher: the fast-forward window is ~0.5 s real time, far shorter than any sane polling interval.
    await s.page.evaluate(() => {
      const w = window;
      w.__ffProbe = { ever: false, startedAt: null, endedAt: null, maxSpeedup: 0 };
      let prevSim = null;
      let prevT = null;
      const tick = (t) => {
        const e = w.__engine;
        const p = w.__ffProbe;
        const sim = e?.battle?.time;
        if (e?.fastForward === true) {
          if (!p.ever) {
            p.ever = true;
            p.startedAt = t;
          }
          p.endedAt = null;
          if (prevSim != null && sim != null && t > prevT) p.maxSpeedup = Math.max(p.maxSpeedup, (sim - prevSim) / ((t - prevT) / 1000));
        } else if (p.ever && p.endedAt == null) p.endedAt = t;
        prevSim = sim ?? null;
        prevT = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const t0 = Date.now();
    let sawFast = false;
    let ended = null;
    let last = null;
    let probe_ = null;
    while (Date.now() - t0 < limit) {
      last = await s.page.evaluate(() => ({ ff: window.__engine?.fastForward === true, auto: window.__engine?.autoFast === true, sim: Math.round(window.__engine?.battle?.time ?? 0), speed: window.__engine?.speed })).catch(() => null);
      const probe = await s.page.evaluate(() => window.__ffProbe).catch(() => null);
      probe_ = probe ?? probe_;
      if (last?.ff || probe?.ever) sawFast = true;
      if (sawFast && !last?.ff) {
        ended = Date.now() - t0;
        break;
      }
      // Contact before fast-forward ever engaged also means there is no approach left to skip.
      if (!sawFast && last && !last.auto && Date.now() - t0 > 3000) {
        ended = Date.now() - t0;
        break;
      }
      await sleep(100);
    }
    const issues = fatalProblems(s.problems);
    if (!sawFast) issues.push('fast-forward never engaged on scenario=hansan (autoFast cleared too early or never set)');
    if (ended == null) issues.push(`fastForward still ${last?.ff ? 'true' : 'false'} after ${limit / 1000}s real time (sim time ${last?.sim}s, speed ${last?.speed})`);
    return {
      status: issues.length ? 'FAIL' : 'PASS',
      details: issues.length ? issues : [`fast-forward ended after ${(ended / 1000).toFixed(1)}s real, sim ${last?.sim}s`],
      metrics: { sawFastForward: sawFast, maxSimSpeedup: probe_ ? +probe_.maxSpeedup.toFixed(1) : null, endedAfterMs: ended, simTime: last?.sim },
      shot: await ctx.shot(s.page),
    };
  } finally {
    await s.close();
  }
}

async function memoryCheck(ctx) {
  const maxTotal = num(ctx.args['max-total-mb'], 450);
  const maxTex = num(ctx.args['max-textures-mb'], 350);
  const s = await openPage(ctx.browsers, 'webkit', undefined, 'portrait', urlOf(ctx.base, 'scenario=hansan'));
  try {
    const ms = await waitReady(s.page, num(ctx.args['ready-timeout'], 150000));
    const issues = fatalProblems(s.problems);
    if (ms == null) {
      issues.push('window.__ready not set (battle did not load on the iPhone profile)');
      return { status: 'FAIL', details: issues, shot: await ctx.shot(s.page) };
    }
    await sleep(num(ctx.args['mem-settle'], 5000));
    const mem = await s.page.evaluate(() => {
      const m = window.__engine?.renderer?.info?.memory;
      return m ? { total: m.total, textures: m.textures, texturesSize: m.texturesSize, geometriesSize: m.geometriesSize, backend: window.__info?.().backend } : null;
    });
    if (!mem) {
      issues.push('renderer.info.memory unavailable');
      return { status: 'FAIL', details: issues, shot: await ctx.shot(s.page) };
    }
    const totalMb = mem.total / MB;
    const texMb = mem.texturesSize / MB;
    const metrics = { totalMB: +totalMb.toFixed(1), texturesMB: +texMb.toFixed(1), geometriesMB: +(mem.geometriesSize / MB).toFixed(1), textureCount: mem.textures, backend: mem.backend, readyMs: ms, limits: { totalMB: maxTotal, texturesMB: maxTex } };
    if (totalMb > maxTotal) issues.push(`memory.total ${totalMb.toFixed(0)} MB > ${maxTotal} MB`);
    if (texMb > maxTex) issues.push(`texturesSize ${texMb.toFixed(0)} MB > ${maxTex} MB`);
    return {
      status: issues.length ? 'FAIL' : 'PASS',
      details: issues.length ? issues : [`total ${totalMb.toFixed(0)} MB, textures ${texMb.toFixed(0)} MB`],
      metrics,
      shot: await ctx.shot(s.page),
    };
  } finally {
    await s.close();
  }
}

export const CHECKS = [
  ...DESKTOP.map((d) => ({ id: `menu:${d.id}`, group: 'menu', browser: 'chrome', run: (ctx) => menuCheck(ctx, 'chrome', d.viewport, undefined) })),
  ...PHONE.map((p) => ({ id: `menu:${p.id}`, group: 'menu', browser: 'webkit', run: (ctx) => menuCheck(ctx, 'webkit', undefined, p.orient) })),
  ...PHONE.map((p) => ({ id: `overflow:${p.orient}`, group: 'overflow', browser: 'webkit', run: (ctx) => menuCheck(ctx, 'webkit', undefined, p.orient, { overflow: true }) })),
  { id: 'battle:hansan', group: 'battle', browser: 'chrome', run: (ctx) => battleCheck(ctx, 'scenario=hansan') },
  { id: 'battle:myeongnyang', group: 'battle', browser: 'chrome', run: (ctx) => battleCheck(ctx, 'scenario=myeongnyang') },
  { id: 'approach:fast-forward-ends', group: 'approach', browser: 'chrome', run: approachCheck },
  { id: 'boot:conquest', group: 'boot', browser: 'chrome', run: (ctx) => battleCheck(ctx, 'conquest=hallyeo&me=joseon&foe=japan&size=2') },
  { id: 'boot:hansan-as-japan', group: 'boot', browser: 'chrome', run: (ctx) => battleCheck(ctx, 'scenario=hansan&side=japan') },
  { id: 'memory:webkit-low-tier', group: 'memory', browser: 'webkit', run: memoryCheck },
];
