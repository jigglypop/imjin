// The campaign map's 3D layer (camps by level, ships at port) on a staged war: screenshots at three zooms on desktop, the
// idle and interaction GPU submit counts, and a phone that must keep the flat map. Windows Edge + D3D11.
// Usage: node scripts/grand-world-browser.mjs --url=http://127.0.0.1:5340/ [--out=shots/grand-world-2026-10-12]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const url = args.url ?? 'http://127.0.0.1:5340/';
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Runs on localhost only');
const out = args.out ?? 'shots/grand-world-2026-10-12';
await mkdir(out, { recursive: true });

// A war on turn 1 where the camps stand at every level: the player's Yeosu 3, Noryang 2, Bangdap 1; Busan 3 and Angolpo 2 on the other side.
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const { newGrand } = await vite.ssrLoadModule('/src/sim/grand/turn.ts');
const g = newGrand('joseon', 551);
g.phase = 'orders'; g.events.pending = null;
const setCamp = (id, level) => {
  const r = g.regions[id];
  const camp = r.buildings.find((b) => b.kind === 'camp');
  if (camp) camp.level = level; else r.buildings.push({ kind: 'camp', level, upgradeLeft: 0, hp: 1 });
};
for (const [id, level] of [['yeosu', 3], ['noryang', 2], ['bangdap', 1], ['busan', 3], ['angolpo', 2], ['geoje', 2]]) setCamp(id, level);
await vite.close();

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const errors = [];
const open = async (contextOptions) => {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((save) => {
    localStorage.setItem('imjin.grand.v1', JSON.stringify(save));
    localStorage.setItem('imjin.grand.guide.v1', '1');
    // Counts every GPU submit, so a map that renders on demand shows zero while nothing moves.
    window.__submits = 0;
    if (window.GPUQueue) {
      const submit = GPUQueue.prototype.submit;
      GPUQueue.prototype.submit = function (...a) { window.__submits += 1; return submit.apply(this, a); };
    }
  }, g);
  await page.goto(`${url}?lang=en`, { waitUntil: 'domcontentloaded' });
  await page.locator('.menu-primary[data-mode="faction"]').click({ timeout: 60000 });
  await page.locator('.g-hub__actions .g-btn--primary').click();
  await page.locator('.gm[data-relief="ready"], .gm[data-relief="image"]').waitFor({ timeout: 60000 });
  await page.waitForTimeout(4000);
  return page;
};
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const submits = (page) => page.evaluate(() => window.__submits);
/** Frames the page painted and GPU submits made while `action` runs. */
const measure = async (page, action) => {
  await page.evaluate(() => { window.__frames = 0; window.__run = true; const tick = () => { window.__frames += 1; if (window.__run) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const s0 = await submits(page), t0 = Date.now();
  await action();
  const ms = Date.now() - t0;
  const frames = await page.evaluate(() => { window.__run = false; return window.__frames; });
  return { fps: Math.round((frames * 1000) / ms), submits: (await submits(page)) - s0, ms };
};

try {
  const page = await open({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  assert.equal(await page.locator('.gm').getAttribute('data-relief'), 'ready');
  await page.screenshot({ path: `${out}/desktop-1-coast.png` });
  const idle = await measure(page, () => page.waitForTimeout(3000));
  console.log('idle 3 s:', idle);
  assert.equal(idle.submits, 0, 'the map renders on demand: nothing is drawn while nothing moves');

  const yeosu = await center(page.locator('.gm-node[data-region="yeosu"] .gm-node__disc'));
  await page.mouse.move(yeosu.x, yeosu.y);
  const wheel = await measure(page, async () => {
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -60); await page.waitForTimeout(16); }
    await page.waitForTimeout(300);
  });
  console.log('wheel zoom in:', wheel);
  await page.screenshot({ path: `${out}/desktop-2-mid.png` });
  const drag = await measure(page, async () => {
    await page.mouse.move(800, 450); await page.mouse.down();
    for (let i = 0; i < 60; i++) { await page.mouse.move(800 + Math.sin(i / 8) * 120, 450 + Math.cos(i / 8) * 80); await page.waitForTimeout(16); }
    await page.mouse.up();
  });
  console.log('drag:', drag);
  const again = await center(page.locator('.gm-node[data-region="yeosu"] .gm-node__disc'));
  await page.mouse.move(again.x, again.y);
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, -60); await page.waitForTimeout(16); }
  await page.mouse.move(40, 450);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/desktop-3-close.png` });
  // Camps of every level in one frame: Yeosu 3, Noryang 2, Bangdap 1 sit within a few ports of each other.
  await page.mouse.move(800, 450);
  for (let i = 0; i < 7; i++) { await page.mouse.wheel(0, 60); await page.waitForTimeout(16); }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/desktop-4-levels.png` });
  // Rotating still works: the 3D layer follows the pose.
  await page.keyboard.down('Shift');
  await page.mouse.move(800, 450); await page.mouse.down(); await page.mouse.move(850, 430, { steps: 10 }); await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/desktop-5-rotated.png` });
  // The Japanese side: Busan holds a level-3 camp with the owner's red banner.
  for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, 60); await page.waitForTimeout(8); }
  await page.waitForTimeout(400);
  const busan = await center(page.locator('.gm-node[data-region="busan"] .gm-node__disc'));
  await page.mouse.move(busan.x, busan.y);
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -60); await page.waitForTimeout(16); }
  await page.mouse.move(40, 450);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/desktop-6-busan.png` });
  await page.context().close();

  // A phone keeps the flat map image and never creates the canvas renderer.
  const phone = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  assert.equal(await phone.locator('.gm').getAttribute('data-relief'), 'image');
  assert.equal(await submits(phone), 0);
  await phone.screenshot({ path: `${out}/phone-portrait.png` });
  await phone.context().close();
  assert.deepEqual(errors, []);
  console.log('Grand world browser QA passed');
} finally {
  await browser.close();
}
