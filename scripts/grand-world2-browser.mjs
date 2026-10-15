// The campaign map as a map: every navy's own camps at levels 1-3, readable settlements and non-overlapping city cards,
// ships on their lanes and a replay with ships sailing, plus the wheel/drag frame rate, the frames drawn at rest (the
// ambient thirty a second, none under reduced motion), the GPU objects left after the campaign closes and a phone that
// must keep the flat map. Windows Edge + D3D11.
// Usage: node scripts/grand-world2-browser.mjs --url=http://127.0.0.1:5345/ [--out=shots/grand-world2-2026-10-12] [--only=default,camps,replay,phone]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const url = args.url ?? 'http://127.0.0.1:5345/';
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Runs on localhost only');
const out = args.out ?? 'shots/grand-world2-2026-10-12';
const only = new Set((args.only ?? 'default,camps,replay,phone').split(','));
await mkdir(out, { recursive: true });

const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const { newGrand } = await vite.ssrLoadModule('/src/sim/grand/turn.ts');
/** A war on turn 1 with the given camp levels and owners, optionally with fleets sent sailing. */
const campaign = (camps, extra) => {
  const g = newGrand('joseon', 551);
  g.phase = 'orders'; g.events.pending = null;
  for (const [id, level, owner] of camps) {
    const r = g.regions[id];
    if (owner) r.owner = owner;
    const camp = r.buildings.find((b) => b.kind === 'camp');
    if (camp) camp.level = level; else r.buildings.push({ kind: 'camp', level, upgradeLeft: 0, hp: 1 });
  }
  extra?.(g);
  return g;
};
// The first view's war: the player's Yeosu 3, Noryang 2, Bangdap 1; Busan 3 and Angolpo 2 on the other side.
const opening = campaign([['yeosu', 3], ['noryang', 2], ['bangdap', 1], ['busan', 3], ['angolpo', 2], ['geoje', 2]]);
// One navy's camps from level 3 down along the south coast.
const COAST = ['yeosu', 'noryang', 'bangdap'];
const of = (faction) => campaign(COAST.map((id, i) => [id, 3 - i, faction]));
await vite.close();

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const errors = [];
const open = async (save, contextOptions) => {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((data) => {
    localStorage.setItem('imjin.grand.v1', JSON.stringify(data));
    localStorage.setItem('imjin.grand.guide.v1', '1');
    // Counts every GPU submit and every frame the 3D view presents (each asks its canvas for a texture once), so a map
    // at rest shows it draws only its ambient frames, and the buffers and textures alive on each device (a destroyed
    // device frees all of its own), so a closed map shows nothing left behind.
    window.__submits = 0;
    window.__drawn = 0;
    window.__devices = [];
    // A slow-motion switch for the replay: animation frames see time pass `__slow` times slower from when it is set.
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => frame((t) => cb(window.__slow ? window.__slowFrom + (t - window.__slowFrom) / window.__slow : t));
    const live = new Map();
    window.__liveOn = (i) => live.get(window.__devices[i]) ?? 0;
    if (window.GPUQueue) {
      const submit = GPUQueue.prototype.submit;
      GPUQueue.prototype.submit = function (...a) { window.__submits += 1; return submit.apply(this, a); };
    }
    if (window.GPUCanvasContext) {
      const texture = GPUCanvasContext.prototype.getCurrentTexture;
      GPUCanvasContext.prototype.getCurrentTexture = function (...a) { window.__drawn += 1; return texture.apply(this, a); };
    }
    if (window.GPUAdapter) {
      const request = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = async function (...a) { const device = await request.apply(this, a); window.__devices.push(device); return device; };
    }
    if (window.GPUDevice) {
      for (const make of ['createBuffer', 'createTexture']) {
        const original = GPUDevice.prototype[make];
        GPUDevice.prototype[make] = function (...a) {
          const device = this, object = original.apply(this, a);
          live.set(device, (live.get(device) ?? 0) + 1);
          const destroy = object.destroy.bind(object);
          let gone = false;
          object.destroy = () => { if (!gone) { gone = true; live.set(device, live.get(device) - 1); } destroy(); };
          return object;
        };
      }
      const destroyDevice = GPUDevice.prototype.destroy;
      GPUDevice.prototype.destroy = function () { live.set(this, 0); return destroyDevice.apply(this); };
    }
  }, save);
  await page.goto(`${url}?lang=en`, { waitUntil: 'domcontentloaded' });
  await page.locator('.menu-primary[data-mode="faction"]').click({ timeout: 60000 });
  await page.locator('.g-hub__actions .g-btn--primary').click();
  await page.locator('.gm[data-relief="ready"], .gm[data-relief="image"]').waitFor({ timeout: 60000 });
  await page.waitForTimeout(4000);
  return page;
};
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const submits = (page) => page.evaluate(() => window.__submits);
const drawn = (page) => page.evaluate(() => window.__drawn);
/** Frames the page painted, GPU submits made and frames the 3D view drew while `action` runs. */
const measure = async (page, action) => {
  await page.evaluate(() => { window.__frames = 0; window.__run = true; const tick = () => { window.__frames += 1; if (window.__run) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const s0 = await submits(page), d0 = await drawn(page), t0 = Date.now();
  await action();
  const ms = Date.now() - t0;
  const frames = await page.evaluate(() => { window.__run = false; return window.__frames; });
  return { fps: Math.round((frames * 1000) / ms), submits: (await submits(page)) - s0, drawn: (await drawn(page)) - d0, ms };
};
/**
 * The map at rest, as WorldCanvas has it: about thirty ambient frames a second (AMBIENT_MS) so the sea, the smoke and
 * the boats keep moving, never every display frame; and for a player who asks for reduced motion, nothing at all.
 */
const atRest = async (page, what, ms = 3000) => {
  const idle = await measure(page, () => page.waitForTimeout(ms));
  const rate = (idle.drawn * 1000) / idle.ms;
  console.log(`${what}: ${rate.toFixed(1)} frames a second at rest, ${idle.submits} submits`);
  assert.ok(rate >= 10 && rate <= 36, `${what}: the map draws its ambient frames at rest, not every display frame (${rate.toFixed(1)}/s)`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(300);
  const still = await measure(page, () => page.waitForTimeout(1500));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(still.drawn, 0, `${what}: with reduced motion the map draws nothing while nothing moves`);
};
/** Wheel in on a port until it fills the view (the camp stands beside it), then park the mouse on empty map. */
const zoomTo = async (page, id, ticks, outAfter = 0) => {
  for (let i = 0; i < outAfter; i++) { await page.mouse.wheel(0, 60); await page.waitForTimeout(8); }
  await page.waitForTimeout(300);
  const at = await center(page.locator(`.gm-node[data-region="${id}"] .gm-node__disc`));
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < ticks; i++) { await page.mouse.wheel(0, -60); await page.waitForTimeout(16); }
  await page.mouse.move(8, 450);
  await page.waitForTimeout(900);
};
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });

try {
  if (only.has('default')) {
    const page = await open(opening, { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    assert.equal(await page.locator('.gm').getAttribute('data-relief'), 'ready');
    await shot(page, 'after-1-default');
    await atRest(page, 'the opening view');
    const yeosu = await center(page.locator('.gm-node[data-region="yeosu"] .gm-node__disc'));
    await page.mouse.move(yeosu.x, yeosu.y);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -60); await page.waitForTimeout(16); }
    await page.mouse.move(8, 450);
    await page.waitForTimeout(900);
    await shot(page, 'after-2-mid');
    // Wheel all the way in and back out over Yeosu with every camp and fleet of the opening on screen at some point.
    await page.mouse.move(yeosu.x, yeosu.y);
    const wheel = await measure(page, async () => {
      for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -60); await page.waitForTimeout(16); }
      for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 60); await page.waitForTimeout(16); }
      await page.waitForTimeout(300);
    });
    console.log('wheel in and out:', wheel);
    const drag = await measure(page, async () => {
      await page.mouse.move(800, 450); await page.mouse.down();
      for (let i = 0; i < 60; i++) { await page.mouse.move(800 + Math.sin(i / 8) * 120, 450 + Math.cos(i / 8) * 80); await page.waitForTimeout(16); }
      await page.mouse.up();
    });
    console.log('drag:', drag);
    await atRest(page, 'after the wheel and the drag', 1500);
    await zoomTo(page, 'yeosu', 30);
    await shot(page, 'after-3-close-joseon');
    await zoomTo(page, 'busan', 40, 70);
    await shot(page, 'after-6-busan');
    // Back to the main menu: the map's device must have nothing left on it.
    const device = (await page.evaluate(() => window.__devices.length)) - 1;
    const before = await page.evaluate((i) => window.__liveOn(i), device);
    await page.locator('.g-top__turn .g-icon-btn').click();
    await page.locator('.g-menu .g-btn').nth(2).click();
    await page.locator('.menu-primary[data-mode="faction"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const after = await page.evaluate((i) => window.__liveOn(i), device);
    console.log('GPU buffers and textures on the map device: open', before, 'after leaving', after);
    assert.equal(after, 0, 'the closed map leaves nothing on the GPU');
    await page.context().close();
  }

  if (only.has('camps')) {
    for (const faction of ['joseon', 'japan', 'ming']) {
      const page = await open(of(faction), { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
      await shot(page, `camps-${faction}-0-default`);
      await zoomTo(page, 'noryang', 36);
      await shot(page, `camps-${faction}-1-levels`);
      // Each level at the closest zoom: Yeosu 3, Noryang 2, Bangdap 1.
      await zoomTo(page, 'yeosu', 26, 70);
      await shot(page, `camps-${faction}-2-level3`);
      await zoomTo(page, 'noryang', 26, 70);
      await shot(page, `camps-${faction}-3-level2`);
      await zoomTo(page, 'bangdap', 26, 70);
      await shot(page, `camps-${faction}-4-level1`);
      await page.context().close();
    }
  }

  if (only.has('replay')) {
    // A Joseon fleet sails Yeosu to Noryang when the turn ends; a Hansan fleet is already at sea from Mijo to Dangpo, one
    // in the narrow Gyeonnaeryang strait, and Busan's on its lane to Angolpo.
    const sailing = campaign([['yeosu', 3], ['noryang', 2], ['hansan', 2], ['geoje', 2], ['busan', 3], ['angolpo', 2]], (g) => {
      const f = (id) => g.fleets.find((x) => x.id === id);
      f('f457').route = ['noryang'];
      for (const [id, from, to, left] of [['f472', 'mijo', 'dangpo', 1], ['f481', 'hansan', 'geoje', 2], ['f535', 'busan', 'angolpo', 2]]) { const fl = f(id); fl.at = null; fl.transit = { from, to, left }; }
    });
    const page = await open(sailing, { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    await zoomTo(page, 'hansan', 0);
    await shot(page, 'replay-0-transit');
    // Close on the fleet between Mijo and Dangpo: hulls heading east, bows first, wakes behind, the leader's flag.
    const lane = await center(page.locator('.gm-fleet[data-fleet="f472"]'));
    // Beside the marker, not on it: the wheel zooms about the cursor.
    await page.mouse.move(lane.x, lane.y + 40);
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -60); await page.waitForTimeout(16); }
    await page.mouse.move(8, 450);
    await page.waitForTimeout(900);
    await shot(page, 'replay-1-transit-close');
    await atRest(page, 'with ships on their lanes');
    await zoomTo(page, 'noryang', 0, 16);
    // The replay runs about two seconds: the closed turn's in slow motion (six times slower) for pictures of the ships
    // under way, then the next turn's at its own pace for the frame rate.
    await page.evaluate(() => { window.__slowFrom = performance.now(); window.__slow = 6; });
    await page.locator('.g-top__end').click();
    await page.locator('.gm-replay').waitFor({ timeout: 20000 });
    let n = 0;
    while (n < 8 && (await page.locator('.gm-replay').count())) { await shot(page, `replay-2-sail-${n}`); n += 1; await page.waitForTimeout(700); }
    console.log('slow replay frames captured', n);
    await page.evaluate(() => { window.__slow = 0; });
    await page.waitForTimeout(1500);
    const next = page.locator('.g-btn--primary.g-btn--block');
    if (await next.count()) await next.first().click();
    await page.waitForTimeout(500);
    await page.locator('.g-top__end').click();
    if (await page.locator('.gm-replay').waitFor({ timeout: 15000 }).then(() => true, () => false)) {
      console.log('replay at its own pace:', await measure(page, () => page.locator('.gm-replay').waitFor({ state: 'detached', timeout: 20000 })));
    }
    await page.waitForTimeout(1500);
    await atRest(page, 'once the replay has ended');
    await page.context().close();
  }

  if (only.has('phone')) {
    // A phone keeps the flat map image and never creates the canvas renderer.
    const phone = await open(opening, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    assert.equal(await phone.locator('.gm').getAttribute('data-relief'), 'image');
    assert.equal(await submits(phone), 0);
    await shot(phone, 'after-phone-portrait');
    await phone.context().close();
  }
  assert.deepEqual(errors, []);
  console.log('Grand world 2 browser QA passed');
} finally {
  await browser.close();
}
