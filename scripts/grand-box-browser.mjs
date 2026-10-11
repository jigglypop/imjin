// Drag-select on the campaign map, driven through real mouse and touch input on a saved war with forces in several ports.
// Usage: node scripts/grand-box-browser.mjs --url=http://127.0.0.1:5335/ [--out=shots/grand-box-2026-10-12]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const url = args.url ?? 'http://127.0.0.1:5335/';
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Runs on localhost only');
const out = args.out ?? 'shots/grand-box-2026-10-12';
await mkdir(out, { recursive: true });

// A war on turn 1 with the player's forces spread over the west of the coast, built by the game's own rules.
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const { newGrand } = await vite.ssrLoadModule('/src/sim/grand/turn.ts');
const g = newGrand('joseon', 551);
g.phase = 'orders'; g.events.pending = null;
const template = g.fleets.find((f) => f.faction === 'joseon');
const hull = template.ships[0];
g.fleets = g.fleets.filter((f) => f.faction !== 'joseon');
const make = (id, at, count) => ({ ...structuredClone(template), id, name: id, at, transit: null, route: [], rest: 0, commanderId: null, ships: Array.from({ length: count }, (_, i) => ({ ...structuredClone(hull), id: id + i })) });
for (const [id, at, n] of [['Yeosu-1', 'yeosu', 3], ['Yeosu-2', 'yeosu', 2], ['Yeosu-3', 'yeosu', 2], ['Hansan-1', 'hansan', 2], ['Noryang-1', 'noryang', 3], ['Sacheon-1', 'sacheon', 1]]) g.fleets.push(make(id, at, n));
await vite.close();

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const errors = [];
const open = async (contextOptions) => {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((save) => {
    localStorage.setItem('imjin.grand.v1', JSON.stringify(save));
    localStorage.setItem('imjin.grand.guide.v1', '1');
    localStorage.removeItem('imjin.grand.boxhint');
  }, g);
  await page.goto(`${url}?lang=en`, { waitUntil: 'domcontentloaded' });
  await page.locator('.menu-primary[data-mode="faction"]').click({ timeout: 60000 });
  await page.locator('.g-hub__actions .g-btn--primary').click();
  await page.locator('.gm[data-relief="ready"], .gm[data-relief="image"]').waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  return page;
};
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const selected = (page) => page.locator('.gm-fleet--sel').evaluateAll((els) => els.map((e) => e.dataset.fleet).sort());

try {
  // Desktop: Ctrl-drag over the Yeosu forces.
  const page = await open({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const badges = page.locator('.gm-fleet:not(.gm-fleet--foreign)');
  const all = [];
  for (let i = 0; i < await badges.count(); i++) all.push({ id: await badges.nth(i).getAttribute('data-fleet'), ...(await center(badges.nth(i))) });
  const yeosu = all.filter((b) => b.id.startsWith('Yeosu'));
  assert.equal(yeosu.length, 3);
  const port = await center(page.locator('.gm-node[data-region="yeosu"] .gm-node__disc'));
  const box = { x0: Math.min(...yeosu.map((b) => b.x), port.x) - 40, y0: Math.min(...yeosu.map((b) => b.y), port.y) - 40, x1: Math.max(...yeosu.map((b) => b.x), port.x) + 40, y1: Math.max(...yeosu.map((b) => b.y), port.y) + 40 };
  await page.keyboard.down('Control');
  await page.mouse.move(box.x0, box.y0); await page.mouse.down();
  await page.mouse.move((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, { steps: 6 }); await page.mouse.move(box.x1, box.y1, { steps: 6 });
  await page.screenshot({ path: `${out}/desktop-dragging.png` });
  await page.mouse.up(); await page.keyboard.up('Control');
  await page.waitForTimeout(600);
  assert.deepEqual(await selected(page), ['Yeosu-1', 'Yeosu-2', 'Yeosu-3']);
  await page.screenshot({ path: `${out}/desktop-batch-after-drag.png` });
  console.log('desktop: ctrl-drag picked the three Yeosu fleets and the garrison, ticked in panel:', await page.locator('.g-batch input:checked').count());
  // Shift as well adds the Hansan fleet instead of replacing.
  const hansan = all.find((b) => b.id === 'Hansan-1');
  await page.keyboard.down('Control'); await page.keyboard.down('Shift');
  await page.mouse.move(hansan.x - 30, hansan.y - 30); await page.mouse.down(); await page.mouse.move(hansan.x + 30, hansan.y + 30, { steps: 5 }); await page.mouse.up();
  await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  assert.equal((await selected(page)).length, 4, 'ctrl+shift adds');
  // Without Shift a new box replaces the batch.
  await page.keyboard.down('Control');
  await page.mouse.move(hansan.x - 30, hansan.y - 30); await page.mouse.down(); await page.mouse.move(hansan.x + 30, hansan.y + 30, { steps: 5 }); await page.mouse.up();
  await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  assert.deepEqual(await selected(page), ['Hansan-1'], 'ctrl alone replaces');
  // Esc ends the batch; a plain drag pans without selecting.
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const before = await page.locator('.gm-node[data-region="yeosu"]').evaluate((e) => e.style.transform);
  await page.mouse.move(800, 450); await page.mouse.down(); await page.mouse.move(700, 400, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  assert.notEqual(await page.locator('.gm-node[data-region="yeosu"]').evaluate((e) => e.style.transform), before);
  assert.equal((await selected(page)).length, 0);
  // Shift+click on an own port opens a batch with its garrison, and on a second port adds it.
  const ticked = () => page.locator('.g-batch input:checked').count();
  await page.keyboard.down('Shift'); await page.locator('.gm-node[data-region="yeosu"] .gm-node__disc').click(); await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  const one = await ticked();
  await page.keyboard.down('Shift'); await page.locator('.gm-node[data-region="hansan"] .gm-node__disc').click(); await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  assert.equal(await ticked(), one + 1);
  console.log('desktop: shift-click on own ports ticked their garrisons');
  await page.context().close();

  // Phones: the box-select switch on, and a one-finger drag draws the box.
  for (const [name, viewport] of [['phone-landscape', { width: 844, height: 390 }], ['phone-portrait', { width: 390, height: 844 }]]) {
    const p = await open({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await p.locator('.gm__box').tap();
    await p.waitForTimeout(400);
    assert.equal(await p.locator('.gm__box').getAttribute('aria-pressed'), 'true');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll');
    await p.screenshot({ path: `${out}/${name}-toggle-on.png` });
    const cdp = await p.context().newCDPSession(p);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', 4, 60);
    for (let i = 1; i <= 12; i++) await touch('touchMove', 4 + ((viewport.width - 8) * i) / 12, 60 + ((viewport.height - 120) * i) / 12);
    await p.screenshot({ path: `${out}/${name}-dragging.png` });
    await touch('touchEnd');
    await p.waitForTimeout(500);
    const n = (await selected(p)).length;
    console.log(name + ': one-finger drag picked', n, 'fleets');
    assert.ok(n > 0);
    await p.screenshot({ path: `${out}/${name}-after-drag.png` });
    await p.context().close();
  }
  assert.deepEqual(errors, []);
  console.log('Grand map box select browser QA passed');
} finally {
  await browser.close();
}
