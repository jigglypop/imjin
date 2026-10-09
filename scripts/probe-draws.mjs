// Where the draw calls and triangles of one frame go on desktop Chrome (WebGPU): every draw the backend issues in a
// frame, grouped by object, geometry, pass kind (shadow depth or colour) and material.
//   node scripts/probe-draws.mjs [url] [--wait=120] [--pre=12] [--close[=metres]]
import { chromium } from 'playwright-core';
import { fightFor, followFight, waitForContact } from './perf-camera.mjs';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
let url = positional[0] ?? 'http://127.0.0.1:5343/?scenario=busan';
if (!/[?&]lv=/.test(url)) url += `${url.includes('?') ? '&' : '?'}lv=4`;
if (!/[?&]hud=/.test(url)) url += '&hud=0';
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: Number(flags.w ?? 1440), height: Number(flags.h ?? 900) } });
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await waitForContact(page, Number(flags.wait ?? 120));
if (flags.pre) await fightFor(page, Number(flags.pre));
await page.evaluate(() => { window.__engine.speed = 1; });
if (flags.close) console.log('camera follows', JSON.stringify(await followFight(page, Number(flags.close === 'true' ? 140 : flags.close))));
await page.waitForTimeout(Number(flags.settle ?? 8) * 1000);
const out = await page.evaluate(async () => {
  const e = window.__engine;
  const be = e.renderer.backend;
  const rows = {};
  let draws = 0;
  let tris = 0;
  const draw = be.draw.bind(be);
  be.draw = (ro, info) => {
    // An instanced mesh with nothing to draw reaches the backend and returns there: it is not a draw call.
    if (ro.getDrawParameters() === null) return draw(ro, info);
    const o = ro.object;
    const g = ro.geometry;
    const rt = ro.context?.renderTarget;
    const pass = rt ? (rt.depthTexture && rt.textures?.length === 0 ? 'depth' : `rt${rt.width}`) : 'screen';
    const idx = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
    const inst = o.isInstancedMesh ? o.count : (g.instanceCount ?? 1);
    const k = `${o.name || o.constructor.name}${o.isInstancedMesh ? '*' : ''} ${g.type} ${pass} ${o.material?.type ?? ''}`;
    const x = rows[k] ?? (rows[k] = { n: 0, tris: 0, inst: 0 });
    x.n += 1;
    x.tris += (idx / 3) * inst;
    x.inst += inst;
    draws += 1;
    tris += (idx / 3) * inst;
    return draw(ro, info);
  };
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  be.draw = draw;
  const list = Object.entries(rows).sort((a, b) => b[1].tris - a[1].tris).slice(0, 28).map(([k, v]) => `${k} | draws ${v.n} inst ${v.inst} tris ${(v.tris / 1e6).toFixed(2)}M`);
  return { draws, trisM: +(tris / 1e6).toFixed(2), list };
});
console.log(`draws ${out.draws} triangles ${out.trisM}M`);
console.log(out.list.join('\n'));
await browser.close();
