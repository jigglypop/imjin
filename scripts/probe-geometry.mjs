// Where the vertex and index memory of a battle goes (the part of renderer.info.memory.total that is not textures):
// every geometry in the scene by size, with the object it belongs to. On the WebKit iPhone path unless --chromium.
//   node scripts/probe-geometry.mjs [url] [--chromium]
import { chromium, webkit, devices } from 'playwright-core';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
let url = positional[0] ?? 'http://127.0.0.1:5343/?scenario=busan';
if (!flags.chromium && !/[?&]q=/.test(url)) url += `${url.includes('?') ? '&' : '?'}q=low`;
const browser = flags.chromium
  ? await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] })
  : await webkit.launch({ headless: true });
const page = await (flags.chromium ? browser.newPage({ viewport: { width: 1440, height: 900 } }) : (await browser.newContext({ ...devices['iPhone 15 Pro'] })).newPage());
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const out = await page.evaluate(() => {
  const e = window.__engine;
  const seen = new Set();
  const counted = new Set();
  const rows = [];
  e.scene.traverse((o) => {
    const g = o.geometry;
    if (!g || seen.has(g)) return;
    seen.add(g);
    const attrs = new Set(Object.values(g.attributes));
    if (g.index) attrs.add(g.index);
    let bytes = 0;
    // Tiles and crown variants share vertex buffers: each buffer counts once, for the first geometry that has it.
    for (const a of attrs) {
      if (counted.has(a)) continue;
      counted.add(a);
      bytes += a.array.byteLength;
    }
    const inst = o.isInstancedMesh ? o.instanceMatrix.array.byteLength : 0;
    let path = o.name || o.type;
    for (let p = o.parent; p && p !== e.scene; p = p.parent) path = `${p.name || p.type}/${path}`;
    rows.push({ mb: +((bytes + inst) / 1048576).toFixed(2), path: `${path} ${g.type}`, verts: g.attributes.position?.count ?? 0, tris: Math.round((g.index?.count ?? g.attributes.position?.count ?? 0) / 3) });
  });
  rows.sort((a, b) => b.mb - a.mb);
  const m = e.renderer.info.memory;
  return { totalMB: Math.round(m.total / 1e6), attributesMB: Math.round((m.attributesSize + m.indexAttributesSize) / 1e6), sceneMB: +rows.reduce((s, r) => s + r.mb, 0).toFixed(1), top: rows.slice(0, 14) };
});
console.log(JSON.stringify({ totalMB: out.totalMB, attributesMB: out.attributesMB, sceneGeometryMB: out.sceneMB }));
for (const r of out.top) console.log(String(r.mb).padStart(7), 'MB', String(r.verts).padStart(8), 'verts', String(r.tris).padStart(8), 'tris', r.path);
await browser.close();
