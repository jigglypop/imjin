// End-to-end campaign dispatch acceptance through real controls and saves, on localhost only.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=')]; }));
const url = args.url ?? 'http://127.0.0.1:5292/';
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Campaign QA runs on localhost only');
const out = args.out ?? 'shots/grand-orders-2026-10-11';
await mkdir(out, { recursive: true });
const modulePath = fileURLToPath(new URL(`../${out}/source.mjs`, import.meta.url));
await build({ stdin: { contents: `export { shipSpec } from './src/sim/competitive.ts'; export { REGION_ORDER } from './src/sim/grand/regions.ts';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)) }, bundle: true, outfile: modulePath, format: 'esm', platform: 'node', logLevel: 'silent' });
const { shipSpec, REGION_ORDER } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const report = { passed: false, url, assets: [], checks: [], screenshots: [], errors: [], turns: [] };
page.on('pageerror', (error) => report.errors.push(error.message));
const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('imjin.grand.v1')));
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); report.screenshots.push(name); };
const roster = (units) => units.map((s) => ({ id: s.id, kind: s.kind, name: s.name, crew: s.crew, crewCount: Math.round(shipSpec(s.kind).crew * s.crew), hull: s.hull, supply: s.supply })).sort((a, b) => a.id.localeCompare(b.id));
const allUnits = (g) => [...g.fleets.flatMap((f) => f.ships), ...Object.values(g.regions).flatMap((r) => r.garrison)];
const selectedUnits = (g, ids) => {
  const units = allUnits(g).filter((s) => ids.has(s.id));
  assert.equal(units.length, ids.size, 'Every selected hull exists exactly once');
  assert.equal(new Set(units.map((s) => s.id)).size, ids.size, 'No duplicated selected hull');
  return roster(units);
};

async function settleDialogs() {
  for (let i = 0; i < 100; i++) {
    // A replay/event dismissal can reveal its next modal in the following React commit.
    await page.waitForTimeout(200);
    if (await page.locator('.gm-replay').count()) { await page.waitForTimeout(400); continue; }
    if (await page.locator('.g-event__choices button').count()) { await page.locator('.g-event__choices button').last().click(); await page.waitForTimeout(100); continue; }
    if (await page.locator('.g-battle').count()) {
      const sure = page.locator('.g-battle .g-sure .g-btn--danger');
      if (await sure.count()) await sure.click(); else await page.locator('.g-battle .g-actions .g-btn').nth(1).click();
      report.checks.push('Unrelated pending battle resolved through the actual Auto battle control');
      await page.waitForTimeout(100); continue;
    }
    const close = page.locator('.g-modal:not(.g-battle) .g-sheet__head .g-icon-btn');
    if (await close.count()) { await close.first().click(); await page.waitForTimeout(100); continue; }
    const acknowledge = page.locator('.g-modal:not(.g-battle) .g-sheet__foot .g-btn--primary');
    if (await acknowledge.count()) { await acknowledge.first().click(); continue; }
    const g = await save();
    if (g.phase === 'battles') { await page.locator('.g-top__end').click(); await page.waitForTimeout(100); continue; }
    if (await page.locator('.g-guide__actions').count()) { await page.locator('.g-guide__actions button').last().click(); continue; }
    assert.equal(g.phase, 'orders', 'Campaign remains in order phase');
    return;
  }
  throw new Error('Campaign dialogs failed to settle');
}

try {
  await page.goto(`${url}?lang=en&q=low&webgl=1`, { waitUntil: 'domcontentloaded' });
  await page.locator('.mode-card').nth(1).click({ timeout: 60000 }); await page.locator('.g-pick__go').click();
  await page.locator('.gm[data-relief="ready"]').waitFor({ timeout: 60000 });
  await settleDialogs(); await page.waitForTimeout(700);
  const before = await save();
  const own = before.fleets.filter((f) => f.faction === before.player);
  const fleets = own.filter((f) => f.at && !f.transit && !f.rest).slice(0, 2);
  assert.equal(fleets.length, 2);
  const ports = REGION_ORDER.filter((id) => before.regions[id].owner === before.player && before.regions[id].garrison.length);
  assert.ok(ports.length); const port = ports[0]; const destination = 'noryang';
  const selected = [...fleets.flatMap((f) => f.ships), ...before.regions[port].garrison];
  const ids = new Set(selected.map((s) => s.id)); assert.equal(ids.size, selected.length);
  report.before = { seed: before.seed, turn: before.turn, selectedFleets: fleets.map((f) => ({ id: f.id, at: f.at, ships: roster(f.ships) })), port, portShips: roster(before.regions[port].garrison), destination, ships: roster(selected) };
  report.assets = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((name) => /\/(index|GrandScreen)-[^/]+\.js$/.test(name)));
  await page.locator('.g-top__batch').click();
  for (const fleet of fleets) await page.locator('.g-batch .g-list').nth(0).locator('input').nth(own.findIndex((f) => f.id === fleet.id)).check();
  await page.locator('.g-batch .g-list').nth(1).locator('input').nth(ports.indexOf(port)).check();
  assert.equal(await page.locator('.g-batch input:checked').count(), 3);
  report.selectedSummary = await page.locator('.g-batch-summary').textContent();
  await shot('desktop-selected-fleets-and-port');
  await page.locator('.g-batch .g-actions .g-btn').click();
  await page.locator(`.gm-node--target[data-region="${destination}"] .gm-node__disc`).click();
  await page.waitForTimeout(700);
  const dispatched = await save(); const oldIds = new Set(before.fleets.map((f) => f.id));
  const mobilized = dispatched.fleets.filter((f) => !oldIds.has(f.id)); assert.equal(mobilized.length, 1);
  const movedIds = [...fleets.map((f) => f.id), mobilized[0].id];
  assert.equal(dispatched.regions[port].garrison.length, 0);
  assert.deepEqual(roster(mobilized[0].ships), roster(before.regions[port].garrison));
  assert.deepEqual(selectedUnits(dispatched, ids), report.before.ships, 'Dispatch preserves all selected crew, hull and supplies');
  for (const id of movedIds) assert.ok(dispatched.fleets.find((f) => f.id === id).route.length > 0);
  report.dispatched = { turn: dispatched.turn, sourceGarrison: dispatched.regions[port].garrison.length, fleets: dispatched.fleets.filter((f) => movedIds.includes(f.id)), ships: selectedUnits(dispatched, ids) };
  await shot('desktop-issued-batch-routes');
  let arrived = null;
  for (let i = 0; i < 8; i++) {
    const current = await save();
    if (movedIds.every((id) => { const f = current.fleets.find((f) => f.id === id); return f?.at === destination && !f.transit && !f.route.length; })) { arrived = current; break; }
    await settleDialogs(); console.log(`Ending turn ${current.turn}`); await page.locator('.g-top__end').click(); await settleDialogs();
    const after = await save();
    report.turns.push({ turn: after.turn, fleets: after.fleets.filter((f) => movedIds.includes(f.id)).map((f) => ({ id: f.id, at: f.at, transit: f.transit, route: f.route })), ships: selectedUnits(after, ids) });
  }
  assert.ok(arrived, 'Every selected fleet and mobilized port defence arrives at the actual destination');
  report.arrived = { turn: arrived.turn, fleets: arrived.fleets.filter((f) => movedIds.includes(f.id)), ships: selectedUnits(arrived, ids) };
  assert.deepEqual(report.arrived.ships.map((s) => ({ id: s.id, crew: s.crew })), report.before.ships.map((s) => ({ id: s.id, crew: s.crew })), 'Safe movement preserves every selected crew');
  await page.locator(`.gm-node[data-region="${destination}"] .gm-node__disc`).click(); await page.waitForTimeout(700); await shot('desktop-all-selected-forces-arrived');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.mode-card').nth(1).click(); await page.locator('.g-hub__actions .g-btn--primary').click();
  await page.locator('.gm[data-relief="ready"]').waitFor({ timeout: 60000 }); await page.waitForTimeout(700);
  const restored = await save();
  assert.deepEqual(restored, arrived, 'Continue reload restores the exact saved campaign after arrival');
  report.restored = { turn: restored.turn, ships: selectedUnits(restored, ids), fleets: restored.fleets.filter((f) => movedIds.includes(f.id)) };
  await page.locator(`.gm-node[data-region="${destination}"] .gm-node__disc`).click(); await page.waitForTimeout(700); await shot('desktop-save-reload-arrived-forces');
  report.checks.push('Fresh campaign started and historical event answered through UI', 'Two real fleets and one port defence selected through actual checkbox controls', 'One destination dispatch transfers exact hull IDs, crews and supplies without duplication', 'Actual End turn controls sail every selected group to destination', 'Reload and Continue restore exact campaign and all selected hull IDs/crews');
  assert.deepEqual(report.errors, []); report.passed = true; console.log('Campaign batch dispatch browser QA passed');
} catch (error) {
  report.failure = error.stack;
  report.dialogs = await page.locator('.g-scrim').evaluateAll((els) => els.map((el) => el.textContent));
  await shot('failure'); console.error(error); process.exitCode = 1;
}
finally { await writeFile(`${out}/verification.json`, JSON.stringify(report, null, 2)); await browser.close(); }
