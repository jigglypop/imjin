// Which GPU textures and render targets stay alive after further battles in the same page, on the WebKit iPhone path.
// Every texture the backend creates is tracked until its dispose event; after each battle the live ones are listed
// by kind, so a battle that leaves something behind shows up as a growing row.
//   node scripts/probe-leak.mjs [url] [--then=myeongnyang,hansan]
import { webkit, devices } from 'playwright-core';
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const url = positional[0] ?? 'http://127.0.0.1:5291/?scenario=hansan&paused=1';
const then = (flags.then ?? 'myeongnyang,hansan').split(',');
const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
const page = await ctx.newPage();
await page.addInitScript(() => {
  const iv = setInterval(() => {
    const backend = window.__engine?.renderer?.backend;
    if (!backend || !backend.createTexture || window.__live) return;
    window.__live = new Map();
    const create = backend.createTexture.bind(backend);
    backend.createTexture = (texture, options) => {
      if (!window.__live.has(texture)) {
        const img = texture.image ?? {};
        window.__live.set(texture, `${texture.constructor.name} ${options?.width ?? img.width}x${options?.height ?? img.height}${options?.levels ? ' mips' + options.levels : ''}${texture.isRenderTargetTexture ? ' RT' : ''} ${texture.name || ''}`.trim());
        if (!texture.isRenderTargetTexture) texture.addEventListener('dispose', () => window.__live.delete(texture));
        else window.__live.delete(texture);
      }
      return create(texture, options);
    };
    // Render targets: tracked until their own dispose event (a target's texture is freed with it, without its own event).
    const textures = window.__engine.renderer._textures;
    const update = textures.updateRenderTarget.bind(textures);
    textures.updateRenderTarget = (rt, level) => {
      if (!window.__live.has(rt)) {
        window.__live.set(rt, `RenderTarget ${rt.width}x${rt.height} ${rt.texture?.name || ''} ${rt.depthTexture ? 'depth' : ''}`.trim());
        rt.addEventListener('dispose', () => window.__live.delete(rt));
      }
      return update(rt, level);
    };
    clearInterval(iv);
  }, 5);
});
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const live = () => page.evaluate(() => {
  const rows = {};
  for (const v of window.__live.values()) rows[v] = (rows[v] ?? 0) + 1;
  return rows;
});
const show = (label, rows) => console.log(label, Object.entries(rows).sort().map(([k, v]) => `${v}x ${k}`).join(' | '));
const base = await live();
show('battle 1:', base);
for (const id of then) {
  await page.evaluate((scenario) => { void window.__engine.setScenario(scenario); }, id);
  await page.waitForFunction(() => window.__engine.ready === true, null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  const rows = await live();
  const diff = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(rows)])) if ((rows[k] ?? 0) !== (base[k] ?? 0)) diff[k] = (rows[k] ?? 0) - (base[k] ?? 0);
  console.log(`after ${id}: ${Object.values(rows).reduce((a, b) => a + b, 0)} live textures; change against battle 1:`, JSON.stringify(diff));
}
await browser.close();
