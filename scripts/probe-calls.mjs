// Draw calls per rendered frame on the WebKit iPhone path (WebGL2), counted at the backend over real frames, split by
// what is drawn. renderer.info.render.calls is the number of render() calls since the page started, not draw calls.
//   node scripts/probe-calls.mjs [url] [seconds]
import { webkit, devices } from 'playwright-core';
const url = process.argv[2] ?? 'http://127.0.0.1:5291/?scenario=hansan';
const seconds = Number(process.argv[3] ?? 3);
const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const out = await page.evaluate(async (ms) => {
  const e = window.__engine;
  const backend = e.renderer.backend;
  const counts = {};
  let total = 0;
  let frames = 0;
  const draw = backend.draw.bind(backend);
  backend.draw = (renderObject, info) => {
    const o = renderObject.object;
    const target = renderObject.context?.renderTarget ? 'target' : 'screen';
    const k = `${o.constructor.name}${o.isInstancedMesh ? '*' : ''} ${o.geometry?.type ?? ''} ${target}`;
    counts[k] = (counts[k] ?? 0) + 1;
    total += 1;
    return draw(renderObject, info);
  };
  const render = e.render.bind(e);
  e.render = () => {
    frames += 1;
    render();
  };
  await new Promise((r) => setTimeout(r, ms));
  backend.draw = draw;
  e.render = render;
  const per = (n) => Math.round((n / Math.max(1, frames)) * 10) / 10;
  return { frames, drawsPerFrame: per(total), parts: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, per(v)])) };
}, seconds * 1000);
console.log(JSON.stringify(out, null, 1));
await browser.close();
