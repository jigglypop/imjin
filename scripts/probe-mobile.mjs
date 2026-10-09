// Mobile probe: opens the game in WebKit (Safari's engine) with iPhone emulation, portrait and landscape,
// records console errors, WebGPU availability, load time and memory, and saves screenshots. It also checks the phone
// budget (exit code 1 when one fails): GPU textures under 300 MB, GPU memory under 400 MB, ready within 10 s, and a pixel
// ratio the engine keeps through a rotation.
//   node scripts/probe-mobile.mjs [--url=http://127.0.0.1:5291/?scenario=hansan] [--device="iPhone 15 Pro"] [--out=shots] [--timeout=120000] [--budget=false]
import { webkit, chromium, devices } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const url = args.url ?? 'http://127.0.0.1:5291/?scenario=hansan';
const deviceName = args.device ?? 'iPhone 15 Pro';
const out = args.out ?? join(ROOT, 'shots');
const timeout = Number(args.timeout ?? 120000);
const engineName = args.engine ?? 'webkit';
const orientations = (args.orient ?? 'portrait,landscape').split(',');
await mkdir(out, { recursive: true });

const browserType = engineName === 'chromium' ? chromium : webkit;
const browser = await browserType.launch({ headless: args.headed !== 'true', ...(engineName === 'chromium' ? { channel: 'chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'] } : {}) });
const base = devices[deviceName];
if (!base) throw new Error(`unknown device ${deviceName}`);
for (const orient of orientations) {
  const vp = orient === 'landscape' ? { width: base.viewport.height, height: base.viewport.width } : base.viewport;
  const ctx = await browser.newContext({ ...base, viewport: vp, screen: vp });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('crash', () => logs.push('[crash] page crashed'));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const gpu = await page.evaluate(async () => { const g = navigator.gpu; if (!g) return 'no navigator.gpu'; try { const a = await g.requestAdapter(); return a ? 'webgpu adapter ok' : 'no adapter'; } catch (e) { return 'adapter error ' + e; } });
  let ready = true;
  try { await page.waitForFunction(() => window.__ready === true || document.querySelector('.screen, .select, .battle-select, .mode-menu'), null, { timeout }); } catch { ready = false; }
  const ms = Date.now() - t0;
  await page.waitForTimeout(Number(args.wait ?? 2500));
  const info = await page.evaluate(() => ({ ready: window.__ready === true, loading: document.querySelector('.loading')?.textContent?.slice(0, 120) ?? null, backend: window.__engine?.renderer?.backend?.isWebGPUBackend ? 'webgpu' : (window.__engine ? 'webgl2?' : 'no engine'), w: innerWidth, h: innerHeight, dpr: devicePixelRatio, heap: performance.memory?.usedJSHeapSize ?? null })).catch((e) => ({ err: String(e) }));
  const file = join(out, `mobile_${deviceName.replace(/\s+/g, '_')}_${orient}.png`);
  await page.screenshot({ path: file }).catch((e) => logs.push('[shot] ' + e));
  const gpuStats = await page.evaluate(() => {
    const r = window.__engine?.renderer;
    if (!r) return null;
    const m = r.info.memory;
    return { textureMB: Math.round(m.texturesSize / 1e6), totalMB: Math.round(m.total / 1e6), programs: m.programs, pixelRatio: r.getPixelRatio(), level: window.__engine.level };
  }).catch(() => null);
  // Rotating resizes the canvas. The engine, not the page, decides the pixel ratio, so the ratio must not change.
  let rotated = null;
  if (gpuStats) {
    await page.setViewportSize({ width: vp.height, height: vp.width });
    await page.waitForTimeout(1500);
    rotated = await page.evaluate(() => ({ pixelRatio: window.__engine.renderer.getPixelRatio(), canvas: [document.querySelector('canvas')?.width, document.querySelector('canvas')?.height] }));
    await page.setViewportSize(vp);
  }
  const budget = [];
  if (args.budget !== 'false' && gpuStats) {
    const check = (name, ok, value) => budget.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${value}`);
    check('textures < 300 MB', gpuStats.textureMB < 300, `${gpuStats.textureMB} MB`);
    check('gpu memory < 400 MB', gpuStats.totalMB < 400, `${gpuStats.totalMB} MB`);
    check('ready < 10 s', ready && ms < 10000, `${(ms / 1000).toFixed(1)} s`);
    check('pixel ratio kept through rotation', rotated?.pixelRatio === gpuStats.pixelRatio, `${gpuStats.pixelRatio} -> ${rotated?.pixelRatio}, canvas ${rotated?.canvas?.join('x')}`);
  }
  console.log(JSON.stringify({ orient, gpu, ready, ms, info, gpuStats, rotated, file }));
  if (budget.length) console.log(budget.join('\n'));
  if (budget.some((b) => b.startsWith('FAIL'))) process.exitCode = 1;
  if (logs.length) console.log(logs.slice(-25).join('\n'));
  await ctx.close();
}
await browser.close();
