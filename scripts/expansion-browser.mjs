// Real controls/building UI and a local 480-ship renderer fixture. Never runs against production.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=')]; }));
const url = args.url ?? 'http://127.0.0.1:5292/';
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Expansion fixtures are local only');
const out = args.out ?? 'shots/expansion-2026-10-11';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const report = { passed: false, url, assets: [], checks: [], screenshots: [], errors: [], desktop: null, mobile: null, fixture: null };
const battleUrl = `${url}?conquest=hallyeo&me=japan&foe=ming&size=2&lang=en&q=low&webgl=1&paused=1&tutorial=0`;
const open = async (viewport, touch = false) => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  return { context, page };
};
const shot = async (page, name) => { await page.screenshot({ path: `${out}/${name}.png` }); report.screenshots.push(name); };
const ready = (page) => page.waitForFunction(() => window.__ready === true && window.__engine?.conquest && !document.querySelector('.loading'), null, { timeout: 180000 });
const tick = (page, seconds) => page.evaluate((seconds) => {
  const e = window.__engine;
  for (let i = 0; i < Math.ceil(seconds * 30); i++) e.conquest.step(e.battle, 1 / 30);
  e.publish(true);
}, seconds);
const ownHome = (page) => page.evaluate(() => { const e = window.__engine; const p = e.conquest.homeOf(e.owner); e.selectPoint(p.id); return p.id; });
const work = (page, title) => page.locator(`.cq-work[title="${title}"]`);
const water = (page) => page.evaluate(() => {
  const e = window.__engine;
  for (const fy of [0.38, 0.45, 0.3, 0.52]) for (const fx of [0.54, 0.62, 0.45, 0.7]) {
    const x = innerWidth * fx, y = innerHeight * fy;
    const p = e.input.waterPoint(x, y);
    const hit = document.elementFromPoint(x, y);
    if (p && e.terrain.heightAt(p.x, p.z) < -8 && hit === e.renderer.domElement && !e.input.pickShip(x, y) && !e.input.pickWorks(x, y)) return { x, y, worldX: p.x, worldZ: p.z };
  }
  throw new Error('No visible open water under canvas');
});
const overflow = (page) => page.evaluate(() => ({ page: document.documentElement.scrollWidth > innerWidth + 1, groups: [...document.querySelectorAll('.fleet-group')].some((b) => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight; }) }));
try {
  const { page, context } = await open({ width: 1920, height: 1080 });
  console.log('desktop setup');
  await page.goto(`${url}?lang=en&q=low&webgl=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('.mode-card').nth(2).click({ timeout: 60000 });
  await page.locator('.cs').waitFor();
  assert.equal(await page.locator('.cs-scale').count(), 0);
  await shot(page, 'setup-unlimited');
  report.checks.push('normal conquest setup has no scale selector');
  console.log('desktop battle');
  await page.goto(battleUrl, { waitUntil: 'domcontentloaded' }); await ready(page);
  report.assets = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((name) => /\/(index|BattleView)-[^/]+\.js$/.test(name)));
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.fleet-group').count(), 8);
  await page.locator('.fleet-group-tools button').getByText('Select all', { exact: true }).click();
  const ownCount = await page.evaluate(() => { const e = window.__engine; return e.battle.ships.filter((s) => e.isOwn(s)).length; });
  await page.keyboard.press('Control+1');
  await page.waitForFunction((n) => window.__engine.input.getGroups()[0].count === n, ownCount);
  await page.locator('.fleet-group-tools button').getByText('Name', { exact: true }).click();
  await page.locator('#fleet-name').fill('Main fleet');
  await page.locator('.fleet-group-name button[type="submit"]').click();
  assert.ok((await page.locator('.fleet-group[data-group="1"]').textContent()).includes('Main fleet'));
  await page.locator('.cards .card').first().click(); await page.keyboard.press('Control+2');
  await page.keyboard.press('1'); await page.keyboard.press('1');
  const cameraBefore = await page.evaluate(() => ({ tx: window.__engine.rts.goal.tx, tz: window.__engine.rts.goal.tz }));
  await page.keyboard.press('Control+a'); await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => ({ tx: window.__engine.rts.goal.tx, tz: window.__engine.rts.goal.tz })), cameraBefore);
  await page.waitForTimeout(600);
  const route = await water(page); await page.mouse.click(route.x, route.y, { button: 'right' });
  await page.keyboard.down('Shift'); await page.mouse.click(route.x, route.y, { button: 'right' }); await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(() => window.__engine.input.queuedWaypoints()), 1);
  await shot(page, 'controls-groups-waypoint');
  await page.keyboard.press('h'); assert.equal(await page.evaluate(() => window.__engine.input.queuedWaypoints()), 0);
  report.checks.push('8 groups assign/name/select/focus', 'Ctrl+A without camera pan', 'actual Shift right-click waypoint and hold cancellation');
  console.log('building upgrades');
  await ownHome(page); await page.locator('.cq-point').waitFor();
  await page.locator('.cq-buttons .cq-buy').filter({ hasText: 'Naval camp' }).click();
  await tick(page, 35.1); assert.ok((await work(page, 'Naval camp').textContent()).includes('Level 1'));
  await work(page, 'Naval camp').locator('.cq-upgrade-btn').click(); await tick(page, 35.1);
  assert.ok((await work(page, 'Naval camp').textContent()).includes('Level 2'));
  await work(page, 'Naval camp').locator('.cq-upgrade-btn').click(); await tick(page, 44);
  assert.ok((await work(page, 'Naval camp').textContent()).includes('Level 3'));
  assert.equal(await page.evaluate(() => { const e = window.__engine; return e.conquest.shipLimit(e.owner) === Infinity && e.conquest.player(e.owner).cap === Infinity; }), true);
  await work(page, 'Shipyard').locator('.cq-upgrade-btn').click(); await tick(page, 40.1);
  await work(page, 'Shipyard').locator('.cq-upgrade-btn').click(); await tick(page, 50.1);
  assert.ok((await work(page, 'Shipyard').textContent()).includes('Level 3'));
  for (let i = 0; i < 3; i++) await page.locator('.cq-buttons .cq-buy').filter({ hasText: 'Kobaya' }).click();
  await tick(page, 2);
  assert.equal(await page.evaluate(() => { const e = window.__engine; const p = e.conquest.homeOf(e.owner); return e.conquest.queueWorkers(p); }), 3);
  assert.equal(await page.evaluate(() => window.__engine.conquest.homeOf(window.__engine.owner).queue.filter((q) => q.left < q.total).length), 3);
  await shot(page, 'buildings-level3-parallel');
  for (let remaining = await page.locator('.cq-q').count(); remaining > 0; remaining--) {
    await page.locator('.cq-q').first().click();
    await page.waitForFunction((count) => document.querySelectorAll('.cq-q').length === count, remaining - 1);
  }
  await page.locator('.cq-rally-set').click();
  const rally = await water(page); await page.mouse.click(rally.x, rally.y, { button: 'right' });
  await page.waitForFunction(() => !!window.__engine.conquest.homeOf(window.__engine.owner).rally);
  await shot(page, 'rally-point-set');
  report.checks.push('camp levels 1/2/3 with normal fleet/strength limits absent', 'yard levels 2/3 and three progressing slipways', 'real rally button and right-click water');
  console.log('480-ship local fixture');
  report.fixture = await page.evaluate(() => {
    const e = window.__engine, c = e.conquest, b = e.battle;
    // This local-only rendering fixture launches real simulation ships on verified wet, unoccupied water.
    b.removeShips(() => true);
    const occupied = [];
    const candidates = [];
    for (let z = -2400; z <= 2400; z += 60) for (let x = -2400; x <= 2400; x += 60) if (e.terrain.heightAt(x, z) < -9) candidates.push({ x, z });
    candidates.sort((a, z) => Math.hypot(a.x, a.z) - Math.hypot(z.x, z.z));
    for (const p of c.players) {
      const home = c.homeOf(p.slot), kind = p.faction === 'japan' ? 'kobaya' : 'mingsmall';
      const target = p.slot === e.owner ? 300 : 180;
      let count = b.ships.filter((s) => s.owner === p.slot && b.isActive(s)).length;
      for (const spot of candidates) {
        if (count >= target) break;
        if (occupied.some((o) => (o.x - spot.x) ** 2 + (o.z - spot.z) ** 2 < 48 ** 2)) continue;
        c.launch(b, home, kind, spot.x, spot.z, p.slot ? Math.PI : 0);
        occupied.push(spot); count++;
      }
      if (count !== target) throw new Error(`Could not place ${target} ships for owner ${p.slot}`);
    }
    e.input.selectAll(); e.rts.setPose({ tx: 0, tz: 0, yaw: 0.7, pitch: 0.6, distance: 4300 }); e.selectPoint(-1); e.publish(true);
    return { kind: 'local paused renderer capacity fixture', total: b.ships.filter((s) => b.isActive(s)).length, owners: c.players.map((p) => ({ slot: p.slot, count: b.ships.filter((s) => s.owner === p.slot && b.isActive(s)).length, limit: String(c.shipLimit(p.slot)) })), onLand: b.ships.filter((s) => b.isActive(s) && e.terrain.heightAt(s.x, s.z) >= -2).length };
  });
  assert.equal(report.fixture.total, 480); assert.equal(report.fixture.onLand, 0);
  await page.keyboard.press('Control+3');
  await page.waitForFunction(() => window.__engine.input.getGroups()[2].count === 300);
  await page.waitForTimeout(1800); await shot(page, 'fleet-480-desktop');
  report.desktop = await page.evaluate(async () => {
    const e = window.__engine, backend = e.renderer.backend;
    const originalDraw = backend.draw, originalRender = e.render;
    let draws = 0, frames = 0;
    backend.draw = function (...args) { draws++; return originalDraw.apply(this, args); };
    e.render = function (...args) { frames++; return originalRender.apply(this, args); };
    const start = performance.now(); await new Promise((resolve) => setTimeout(resolve, 4000)); const elapsed = performance.now() - start;
    backend.draw = originalDraw; e.render = originalRender;
    return { context: '1920x1080 Edge D3D11 WebGL2, low quality, paused local 480-ship fixture; observation only', elapsedMs: elapsed, renderedFrames: frames, observedFps: frames * 1000 / elapsed, drawsPerFrame: draws / Math.max(1, frames), info: e.info(), ownRings: e.views.ringsOwn.count, enemyRings: e.views.ringsEnemy.count, ringCapacity: e.views.ringsOwn.instanceMatrix.count, batches: e.views.renderer.stats(), capacities: [...e.views.renderer.capacity], groups: e.input.getGroups() };
  });
  assert.ok(report.desktop.renderedFrames > 0); assert.equal((await overflow(page)).page, false);
  assert.equal(report.desktop.ownRings, 300, 'all 300 selected ships need their selection ring');
  assert.ok(report.desktop.capacities.find(([key]) => key === 'kobaya#0')?.[1] >= 300);
  await page.evaluate(() => window.__engine.rts.setPose({ tx: 0, tz: 0, yaw: 0.7, pitch: 0.9, distance: 1700 }));
  await page.waitForTimeout(700); await shot(page, 'fleet-300-selected-close');
  report.checks.push('480 actual ships on wet water, renderer capacity and draw/FPS observations');
  await context.close();
  console.log('mobile touch');
  const mobile = await open({ width: 390, height: 844 }, true);
  await mobile.page.goto(battleUrl, { waitUntil: 'domcontentloaded' }); await ready(mobile.page); await mobile.page.waitForTimeout(500);
  await mobile.page.locator('.fleet-group-tools button').getByText('Select all', { exact: true }).tap();
  await mobile.page.locator('.fleet-group-tools button').getByText('Assign', { exact: true }).tap();
  await mobile.page.locator('.fleet-group[data-group="8"]').tap();
  assert.ok(await mobile.page.evaluate(() => window.__engine.input.getGroups()[7].count > 0));
  await mobile.page.locator('.fleet-group[data-group="8"]').tap();
  await mobile.page.locator('.fleet-group[data-group="8"]').tap();
  await mobile.page.waitForTimeout(700);
  await mobile.page.locator('.fleet-route').tap(); assert.equal(await mobile.page.evaluate(() => window.__engine.input.queueMoves), true);
  const dock = mobile.page.locator('.dock-fold');
  if (await dock.getAttribute('aria-expanded') === 'true') await dock.tap();
  await shot(mobile.page, 'mobile-groups-folded'); assert.deepEqual(await overflow(mobile.page), { page: false, groups: false });
  await ownHome(mobile.page); await mobile.page.locator('.cq-point').waitFor(); await mobile.page.waitForTimeout(1800);
  await shot(mobile.page, 'mobile-building-panel');
  const panelLayout = await mobile.page.evaluate(() => ({ panel: document.querySelector('.cq-point').getBoundingClientRect().toJSON(), groups: document.querySelector('.fleet-groups').getBoundingClientRect().toJSON() }));
  assert.ok(panelLayout.panel.bottom <= panelLayout.groups.top - 5, 'point panel must end above persistent group controls');
  await mobile.page.locator('.cq-rally-set').tap();
  if (await mobile.page.locator('.cq-point').isVisible()) await mobile.page.locator('.cq-point .cq-close').tap();
  const touchRally = await water(mobile.page); await mobile.page.touchscreen.tap(touchRally.x, touchRally.y);
  await mobile.page.waitForFunction(() => !!window.__engine.conquest.homeOf(window.__engine.owner).rally);
  report.mobile = await mobile.page.evaluate(() => ({ viewport: [innerWidth, innerHeight], groups: window.__engine.input.getGroups(), queueMode: window.__engine.input.queueMoves, info: window.__engine.info(), rally: window.__engine.conquest.homeOf(window.__engine.owner).rally }));
  report.mobile.layout = panelLayout;
  report.checks.push('390x844 actual touch assignment/queue mode, folded persistent groups, point panel and rally water tap');
  await mobile.context.close();
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log('expansion browser acceptance passed');
} catch (error) { report.failure = error.stack ?? String(error); console.error(report.failure); process.exitCode = 1; }
finally { await writeFile(`${out}/browser-verification.json`, JSON.stringify(report, null, 2)); await browser.close(); }
