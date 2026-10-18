// Where a battle load's time goes on the WebKit phone path (?q=low): node builds, program links and other renderer/GL
// calls by total time, the frames until ready, and (BUILDS=1) every node build over 2 ms with its material and program hash.
//   node scripts/probe-compile.mjs [url]
import { webkit, devices } from 'playwright-core';
const url = process.argv[2] ?? 'http://127.0.0.1:5291/?scenario=trafalgar-weather&q=low';
const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
const page = await ctx.newPage();
let base = 0;
page.on('console', (m) => { const t = m.text(); if (t.startsWith('LAP')) { const [, ms, ...rest] = t.split(' '); if (!base) base = Number(ms); console.log('LAP', String(Number(ms) - base).padStart(6), ms, rest.join(' ')); } });
await page.addInitScript(() => {
  const log = (window.__loadLog = []);
  const t0 = performance.now();
  let last = '';
  const poll = () => {
    if (window.__engine?.ready && !window.__readyAt) {
      window.__readyAt = performance.now() - t0;
      const frames = (window.__frames = []);
      let prev = performance.now();
      const tick = () => {
        const now = performance.now();
        frames.push(Math.round(now - prev));
        prev = now;
        if (frames.length < 40) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    if (!window.__ready) setTimeout(poll, 50);
    else window.__doneAt = performance.now() - t0;
  };
  performance.setResourceTimingBufferSize(10000);
  const prof = (window.__prof = {});
  const wrap = (obj, name, key) => {
    const f = obj[name];
    if (typeof f !== 'function' || f.__w) return;
    const g = function (...a) {
      const s = performance.now();
      try { return f.apply(this, a); } finally { const e = (prof[key] ??= [0, 0]); e[0] += performance.now() - s; e[1] += 1; }
    };
    g.__w = true;
    obj[name] = g;
  };
  for (const n of ['compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter', 'shaderSource', 'texImage2D', 'texSubImage2D', 'compressedTexImage2D', 'bufferData', 'drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'readPixels', 'getError', 'useProgram', 'getUniformLocation', 'texStorage2D', 'generateMipmap']) wrap(WebGL2RenderingContext.prototype, n, 'gl.' + n);
  const hook = () => {
    const r = window.__engine?.renderer;
    if (!r) return setTimeout(hook, 20);
    wrap(r._nodes, 'getForRender', 'nodes.getForRender');
    const builds = (window.__builds = []);
    const gfr = r._nodes.getForRender;
    r._nodes.getForRender = function (ro, ...a) {
      const s = performance.now();
      const out = gfr.call(this, ro, ...a);
      const ms = performance.now() - s;
      if (ms > 2) {
        const chain = [];
        for (let o = ro.object; o && chain.length < 6; o = o.parent) chain.push(o.name || o.type);
        let h = 0;
        const code = (out?.vertexShader ?? '') + (out?.fragmentShader ?? '');
        for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) | 0;
        builds.push([Math.round(performance.now()), Math.round(ms), ro.material.type, ro.material.name || '', 'm' + ro.material.id, (h >>> 0).toString(36), code.length, ro.camera === window.__engine.sun?.shadow?.camera ? 'shadow' : '', chain.join('<')]);
      }
      return out;
    };
    wrap(r._pipelines, 'getForRender', 'pipelines.getForRender');
    wrap(r._objects, 'get', 'renderObjects.get');
    wrap(r, 'render', 'renderer.render');
    wrap(r.backend, 'createProgram', 'backend.createProgram');
    wrap(r.backend, 'createRenderPipeline', 'backend.createRenderPipeline');
    wrap(r.backend, 'draw', 'backend.draw');
  };
  hook();
  setTimeout(poll, 0);
  setTimeout(async function sub() {
    try {
      const m = await import('/src/state/store.ts');
      let prevText = null;
      let prevP = -1;
      m.useUi.subscribe((st) => {
        const p = Math.round((st.progress ?? 0) * 100);
        if (st.loading !== prevText || p - prevP >= 4) log.push([Math.round(performance.now() - t0), `${p}% ${st.loading}`]);
        prevText = st.loading;
        prevP = p;
      });
    } catch (e) {
      setTimeout(sub, 50);
    }
  }, 300);
});
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000, polling: 500 });
const out = await page.evaluate(() => {
  const res = performance.getEntriesByType('resource').map((r) => [r.name.replace(location.origin, ''), Math.round(r.startTime), Math.round(r.duration), r.transferSize]);
  return { log: window.__loadLog, readyAt: Math.round(window.__readyAt), doneAt: Math.round(window.__doneAt), frames: window.__frames, prof: window.__prof, builds: window.__builds, programs: window.__engine.renderer.info.memory.programs, res, last: Math.round(Math.max(...res.map((r) => r[1] + r[2]))) };
});
for (const [t, s] of out.log) console.log(String(t).padStart(6), s);
console.log('init resolved', out.readyAt, 'ready', out.doneAt, 'programs', out.programs, 'last fetch end', out.last);
console.log('frames after init', out.frames.join(' '));
for (const [k, [ms, n]] of Object.entries(out.prof).sort((a, b) => b[1][0] - a[1][0])) console.log('prof', k.padEnd(28), Math.round(ms), 'ms', n);
if (process.env.BUILDS) for (const b of out.builds) console.log('build', b.join(' | '));
const big = out.res.sort((a, b) => b[2] - a[2]).slice(0, 12);
for (const r of big) console.log('fetch', r[1], '+', r[2], r[0].slice(0, 90));
await browser.close();
