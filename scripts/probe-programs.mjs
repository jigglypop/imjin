// Shader programs of a battle load on the WebKit iPhone path (WebGL2): how many are built, how many have identical
// source (same shader, only the texture differs), the largest, and where the time goes.
//   node scripts/probe-programs.mjs [url] [--engine=chromium]   (chromium with ?webgl=1 times the driver's compile; WebKit defers it to the first draw)
import { webkit, chromium, devices } from 'playwright-core';
const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://127.0.0.1:5291/?scenario=hansan';
const browser = process.argv.includes('--engine=chromium')
  ? await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] })
  : await webkit.launch({ headless: true });
const ctx = await browser.newContext(process.argv.includes('--engine=chromium') ? { viewport: { width: 393, height: 659 } } : { ...devices['iPhone 15 Pro'] });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const iv = setInterval(() => {
    const e = window.__engine;
    const backend = e?.renderer?.backend;
    if (!backend || !backend.createProgram || window.__programLog) return;
    window.__programLog = [];
    const create = backend.createProgram.bind(backend);
    backend.createProgram = (program) => {
      const t = performance.now();
      const r = create(program);
      window.__programLog.push({ stage: program.stage, len: program.code.length, ms: performance.now() - t, code: program.code });
      return r;
    };
    const link = backend.createRenderPipeline.bind(backend);
    backend.createRenderPipeline = (ro, promises) => {
      const t = performance.now();
      const r = link(ro, promises);
      window.__linkMs = (window.__linkMs ?? 0) + performance.now() - t;
      window.__links = (window.__links ?? 0) + 1;
      const o = ro.object;
      const kind = `${o.constructor.name} ${o.geometry?.type ?? ''} ${ro.material.type}${ro.material.isDepthMaterial ? '' : ''} ${ro.context?.renderTarget?.depthTexture && !ro.context.renderTarget.texture ? 'depth' : ''}${o.isMesh && ro.material.name ? ' ' + ro.material.name : ''}`;
      window.__kinds = window.__kinds ?? {};
      window.__kinds[kind] = (window.__kinds[kind] ?? 0) + 1;
      return r;
    };
    // The wait for the driver: linking blocks here until the program is built.
    const complete = backend._completeCompile.bind(backend);
    backend._completeCompile = (ro, pipeline) => {
      const t = performance.now();
      const r = complete(ro, pipeline);
      const ms = performance.now() - t;
      const o = ro.object;
      const kind = `${o.constructor.name} ${o.geometry?.type ?? ''} ${ro.material.type} ${ro.material.name || ''}`.trim();
      window.__wait = window.__wait ?? {};
      window.__wait[kind] = (window.__wait[kind] ?? 0) + ms;
      window.__waitTotal = (window.__waitTotal ?? 0) + ms;
      return r;
    };
    clearInterval(iv);
  }, 5);
});
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const out = await page.evaluate(() => {
  const log = window.__programLog ?? [];
  const seen = new Map();
  for (const p of log) seen.set(p.code, (seen.get(p.code) ?? 0) + 1);
  const frag = log.filter((p) => p.stage === 'fragment');
  const vert = log.filter((p) => p.stage === 'vertex');
  return {
    shaders: log.length,
    fragment: frag.length,
    vertex: vert.length,
    distinct: seen.size,
    totalKB: Math.round(log.reduce((s, p) => s + p.len, 0) / 1024),
    compileCallMs: Math.round(log.reduce((s, p) => s + p.ms, 0)),
    linkCalls: window.__links,
    linkMs: Math.round(window.__linkMs ?? 0),
    driverWaitMs: Math.round(window.__waitTotal ?? 0),
    slowest: Object.entries(window.__wait ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${Math.round(v)}ms ${k}`),
    kinds: Object.entries(window.__kinds ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 25),
    biggest: log.map((p) => `${p.stage}:${Math.round(p.len / 1024)}KB`).sort((a, b) => parseInt(b.split(':')[1]) - parseInt(a.split(':')[1])).slice(0, 8),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
