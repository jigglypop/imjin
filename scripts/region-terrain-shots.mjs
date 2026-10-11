// Screenshots of region battles for comparing the ground of several regions, and the load numbers of each.
// Opens the first region through the campaign screens (the way a player does), then swaps the others in with the engine's
// own setConquest, as scripts/region-browser.mjs does.
//   node scripts/region-terrain-shots.mjs --url=http://127.0.0.1:5334/ --out=shots/terrain-2026-10-12/after
//     [--root=<repo folder the url serves, default this one>] [--regions=yeosu,mokpo,...] [--phone] [--engine=chromium|webkit] [--q=high]
import { build } from 'esbuild';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { chromium, webkit, devices } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=') || 'true']; }));
const url = args.url ?? 'http://127.0.0.1:5334/';
const out = resolve(args.out ?? 'shots/terrain-2026-10-12/after');
const root = resolve(args.root ?? fileURLToPath(new URL('..', import.meta.url)));
const regions = (args.regions ?? 'yeosu,mokpo,busan,hansan,nagoya,liaodong').split(',');
const phone = args.phone === 'true';
const quality = args.q ?? (phone ? 'low' : 'high');
await mkdir(out, { recursive: true });
const modulePath = join(out, 'fixture-source.mjs');
await build({ stdin: { contents: `export { newGrand } from './src/sim/grand/turn.ts'; export { describeContact } from './src/sim/grand/bridge.ts'; export { grandSeats, grandYou } from './src/sim/grand/spawn.ts';`, resolveDir: root }, bundle: true, outfile: modulePath, format: 'esm', platform: 'node', logLevel: 'silent' });
const { newGrand, describeContact, grandSeats, grandYou } = await import(pathToFileURL(modulePath).href);
await rm(modulePath);

function fixture(region, seed) {
  const grand = newGrand('joseon', 710);
  const attacker = grand.fleets.find((f) => f.faction === 'japan');
  const defender = grand.fleets.find((f) => f.faction === 'joseon');
  for (const f of [attacker, defender]) { f.at = region; f.transit = null; f.route = []; f.rest = 0; }
  const contact = { id: `visual-${region}`, regionId: region, attacker: 'japan', defender: 'joseon', attackerFleets: [attacker.id], defenderFleets: [defender.id], player: true };
  grand.pending = [contact]; grand.phase = 'battles'; grand.events.pending = null;
  const battle = describeContact(grand, contact);
  battle.seed = seed;
  return { grand, setup: { grand: battle, seats: grandSeats(battle), you: grandYou(battle), seed } };
}

const flags = ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'];
const browser = args.engine === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'msedge', headless: true, args: flags });
const device = phone ? devices['iPhone 15 Pro'] : null;
const context = await browser.newContext(device ? { ...device } : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const ready = () => page.waitForFunction(() => window.__engine?.ready && !document.querySelector('.loading'), null, { timeout: 240000 });
const report = [];
const first = fixture(regions[0], 0);
await context.addInitScript((grand) => { localStorage.setItem('imjin.grand.v1', JSON.stringify(grand)); localStorage.setItem('imjin.grand.guide.v1', '1'); }, first.grand);
const t0 = Date.now();
await page.goto(`${url}?lang=en&q=${quality}&paused=1&tutorial=0${args.webgl ? '&webgl=1' : ''}`, { waitUntil: 'domcontentloaded' });
await page.locator('.menu-primary[data-mode="faction"]').click();
await page.locator('.g-hub__actions .g-btn--primary').click();
await page.locator('.g-battle .g-actions .g-btn--primary').click();
await ready();
let loadMs = Date.now() - t0;
for (const [n, region] of regions.entries()) {
  if (n > 0) {
    const data = fixture(region, 0);
    const started = Date.now();
    await page.evaluate(async (setup) => {
      setup.grand.options.cap = Infinity; setup.grand.options.maxShips = Infinity;
      const e = window.__engine; await e.setConquest(setup);
      e.paused = false; e.update(0.1); e.paused = true; e.publish(true);
    }, data.setup);
    await ready();
    loadMs = Date.now() - started;
  }
  await page.waitForTimeout(1500);
  const stats = await page.evaluate(() => {
    const e = window.__engine, m = e.renderer.info.memory;
    return { id: e.conquestSetup.grand.regionId, textureMB: Math.round(m.texturesSize / 1e6), totalMB: Math.round(m.total / 1e6), programs: m.programs, structures: e.terrain.structures.length, tiled: e.terrain.structures.filter((s) => s.type === 'giwa').length, beacons: e.terrain.structures.filter((s) => s.type === 'bongsu').length, backend: e.renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2' };
  });
  const frame = async (name, pose) => {
    await page.evaluate((p) => { const e = window.__engine; e.rts.setPose({ ...e.rts.goal, ...p }, true); e.rts.update(0); e.update(0); e.publish(true); }, pose);
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(out, `${region}-${name}.png`) });
  };
  await frame('battle', {});
  await frame('wide', { pitch: 0.42, distance: phone ? 2600 : 2200 });
  await frame('top', { pitch: 1.2, distance: 5200 });
  report.push({ ...stats, loadMs });
  console.log(JSON.stringify({ ...stats, loadMs }));
}
await writeFile(join(out, 'report.json'), JSON.stringify({ url, quality, phone, report, errors }, null, 2));
if (errors.length) console.log('page errors', errors.slice(0, 5));
await browser.close();
