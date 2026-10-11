// Local region battle fixtures use real campaign descriptors, Engine staging, UI orders and renderers.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=')]; }));
const url = args.url ?? 'http://127.0.0.1:5292/';
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Region fixtures are localhost only');
const out = args.out ?? 'shots/regions-2026-10-11';
await mkdir(out, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const modulePath = fileURLToPath(new URL(`../${out}/fixture-source.mjs`, import.meta.url));
await build({ stdin: { contents: `export { newGrand } from './src/sim/grand/turn.ts'; export { describeContact } from './src/sim/grand/bridge.ts'; export { grandSeats, grandYou } from './src/sim/grand/spawn.ts'; export { regionEnvironment } from './src/sim/grand/coast.ts';`, resolveDir: root }, bundle: true, outfile: modulePath, format: 'esm', platform: 'node', logLevel: 'silent' });
const { newGrand, describeContact, grandSeats, grandYou, regionEnvironment } = await import(pathToFileURL(modulePath).href);
function fixture(region, seed) {
  const grand = newGrand('joseon', 710);
  const attacker = grand.fleets.find((f) => f.faction === 'japan'); const defender = grand.fleets.find((f) => f.faction === 'joseon');
  for (const f of [attacker, defender]) { f.at = region; f.transit = null; f.route = []; f.rest = 0; }
  const contact = { id: `visual-${region}`, regionId: region, attacker: 'japan', defender: 'joseon', attackerFleets: [attacker.id], defenderFleets: [defender.id], player: true };
  grand.pending = [contact]; grand.phase = 'battles'; grand.events.pending = null;
  const battle = describeContact(grand, contact);
  // The fixture varies only the descriptor's seed to exercise each deterministic weather preset.
  battle.seed = seed;
  return { grand, battle, setup: { grand: battle, seats: grandSeats(battle), you: grandYou(battle), seed }, environment: regionEnvironment(region, seed) };
}
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const report = { passed: false, url, assets: [], cases: [], screenshots: [], errors: [], checks: [] };
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage(); page.on('pageerror', (error) => report.errors.push(error.message));
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); report.screenshots.push(name); };
const ready = () => page.waitForFunction(() => window.__engine?.ready && !document.querySelector('.loading'), null, { timeout: 180000 });
try {
  const opening = fixture('yeosu', 0);
  await context.addInitScript((grand) => { localStorage.setItem('imjin.grand.v1', JSON.stringify(grand)); localStorage.setItem('imjin.grand.guide.v1', '1'); }, opening.grand);
  await page.goto(`${url}?lang=en&q=low&webgl=1&paused=1&tutorial=0`, { waitUntil: 'domcontentloaded' });
  await page.locator('.mode-card').nth(1).click(); await page.locator('.g-hub__actions .g-btn--primary').click();
  await page.locator('.g-battle .g-actions .g-btn--primary').click(); await ready();
  assert.equal(await page.evaluate(() => window.__engine.conquestSetup?.grand?.regionId), 'yeosu');
  report.checks.push('actual campaign save → continue → pending region battle → Fight loads Grand engine');
  report.assets = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((name) => /\/(index|BattleView)-[^/]+\.js$/.test(name)));
  for (const region of ['yeosu', 'mokpo']) {
    for (const seed of args['vortex-only'] ? [0] : [0, 2, 6, 7]) {
      const data = fixture(region, seed); console.log(`region ${region} seed ${seed}`);
      await page.evaluate(async (setup) => {
        setup.grand.options.cap = Infinity; setup.grand.options.maxShips = Infinity;
        const e = window.__engine; await e.setConquest(setup);
        // A running game initializes its tide in its first simulation step. Exercise that real frame before pausing.
        e.paused = false; e.update(0.1); e.paused = true; e.publish(true);
      }, data.setup);
      await ready(); await page.waitForTimeout(800);
      const observed = await page.evaluate(() => {
        const e = window.__engine, b = e.battle;
        const vortices = e.current.vortexData();
        return { region: e.conquestSetup.grand.regionId, seed: e.conquestSetup.grand.seed, sky: e.skyName, sea: e.seaName, night: b.night,
          visibility: b.visibilityScale, windDrift: b.windDrift, time: b.time, tide: b.tide, expectedTide: b.flow.tideAt(b.time), oceanTide: e.ocean.tide.value, flowShared: e.current === b.flow,
          terrainRotation: e.phi, vortices, ships: b.ships.length, drySpawn: b.ships.filter((s) => e.terrain.heightAt(s.x, s.z) > -4).length,
          tactic: b.coastalTactic, backend: e.renderer.backend.isWebGLBackend ? 'WebGL2' : 'WebGPU' };
      });
      assert.equal(observed.sky, data.environment.sky); assert.equal(observed.sea, data.environment.sea); assert.equal(observed.night, data.environment.night);
      assert.equal(observed.visibility, data.environment.visibility); assert.equal(observed.flowShared, true); assert.equal(observed.drySpawn, 0);
      assert.ok(observed.time > 0); assert.equal(observed.tide, observed.expectedTide); assert.equal(observed.oceanTide, observed.tide);
      assert.equal(observed.tactic, region === 'yeosu' ? 'yeosu-wings' : 'mokpo-depth');
      assert.ok(observed.vortices.slice(0, 16).some((n, i) => i % 4 === 3 && Math.abs(n) > 0));
      if (args['vortex-only']) {
        observed.vortexFrames = [];
        for (const phase of ['flood', 'slack', 'ebb']) {
          await page.evaluate((phase) => {
            const e = window.__engine, b = e.battle, v = e.current.vortexData(), spec = e.current.spec;
            // Exercise the actual tidal function at its three designed phases, with a local clock fixture.
            b.time = phase === 'flood' ? spec.turnAt - spec.slack : phase === 'slack' ? spec.turnAt : spec.turnAt + spec.slack;
            e.stepSim(0); e.rts.followId = 0; e.rts.cinematic = false;
            e.rts.setPose({ tx: v[0], tz: v[1], yaw: 0, pitch: 1.15, distance: 550 }, true);
            e.rts.update(0); e.update(0); e.publish(true);
          }, phase);
          await page.waitForTimeout(500);
          const camera = await page.evaluate(() => {
            const e = window.__engine, v = e.current.vortexData();
            const p = e.camera.position.clone().set(v[0], 0, v[1]).project(e.camera);
            return { time: e.battle.time, tide: e.battle.tide, oceanTide: e.ocean.tide.value, target: { ...e.rts.goal }, actualTarget: { x: e.rts.target.x, z: e.rts.target.z },
              vortex: { x: v[0], z: v[1], radius: v[2], spin: (e.battle.tide < 0 ? v[3] : v[19]) },
              projected: { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 }, width: innerWidth, height: innerHeight };
          });
          assert.equal(camera.oceanTide, camera.tide); assert.equal(camera.tide, phase === 'flood' ? -1 : phase === 'slack' ? 0 : 1);
          assert.ok(Math.abs(camera.projected.x - camera.width / 2) < 30 && Math.abs(camera.projected.y - camera.height / 2) < 30);
          observed.vortexFrames.push({ phase, ...camera }); await shot(`${region}-vortex-${phase}`);
        }
        report.cases.push(observed); continue;
      }
      await shot(`${region}-seed${seed}-${observed.sky}-${observed.sea}`); report.cases.push(observed);
      if (seed === 0) {
        await page.keyboard.press('Control+a'); await page.locator(`.order[data-tip="${observed.tactic}"]`).click();
        const slots = await page.evaluate(() => {
          const e = window.__engine, own = e.battle.ships.filter((s) => e.isOwn(s));
          return { count: own.length, moved: own.filter((s) => s.order.type === 'slot').length, dry: own.filter((s) => s.order.type === 'slot' && e.terrain.heightAt(s.order.x, s.order.z) > -4).length,
            unique: new Set(own.map((s) => s.order.type === 'slot' ? `${s.order.x.toFixed(2)},${s.order.z.toFixed(2)}` : '')).size };
        });
        assert.equal(slots.moved, slots.count); assert.equal(slots.dry, 0); assert.equal(slots.unique, slots.count);
        observed.formation = slots; await shot(`${region}-coastal-formation-orders`);
        await page.evaluate(() => {
          const e = window.__engine, v = e.current.vortexData();
          e.rts.setPose({ tx: v[0], tz: v[1], yaw: e.rts.goal.yaw, pitch: 0.52, distance: 700 }); e.rts.update(0);
        }); await page.waitForTimeout(500); await shot(`${region}-designed-vortex-water`);
        const damage = await page.evaluate(() => {
          const e = window.__engine, b = e.battle, ship = b.ships.find((s) => e.isOwn(s));
          // A local hit fixture calls the same hull/impact methods as a projectile, without fabricating a result.
          const amount = ship.spec.hull * 0.8; b.damage(ship, amount); b.impactDamage(ship, amount, -Math.sin(ship.heading), Math.cos(ship.heading));
          e.views.selected.clear(); e.views.selected.add(ship.id); e.publish(true);
          e.rts.setPose({ tx: ship.x, tz: ship.z, yaw: ship.heading + Math.PI / 2, pitch: 0.23, distance: 150 }); e.rts.update(0);
          return { hull: ship.hull / ship.spec.hull, state: { ...ship.damageState }, alive: ship.alive, sinking: ship.sinking };
        });
        assert.equal(damage.alive, true); assert.equal(damage.sinking, 0); assert.ok(damage.state.flooding > 0.2);
        await page.waitForTimeout(700); const detail = await page.locator('.detail-body').textContent(); assert.match(detail, /Flooding/); assert.match(detail, /Propulsion/); assert.match(detail, /Steering/);
        observed.damage = damage; await shot(`${region}-flooding-hull-and-hud`);
      }
    }
  }
  if (args['vortex-only']) report.checks.push('Both regional eddies are projected within 30 px of screen center', 'Real tide function drives Ocean at flood -1, slack 0, ebb +1', 'Both regional tide phases are captured with the actual water shader');
  else report.checks.push('8 deterministic day/night/fog/rough region render cases match simulation weather', 'render/sim share CurrentField and nonzero rotated eddies', 'both coastal tactics issue unique wet destinations for every own ship', 'real damage/impact fixture retains live listing hull and all three HUD damage indicators');
  assert.deepEqual(report.errors, []); report.passed = true; console.log('Region browser QA passed');
} catch (error) { report.failure = error.stack; console.error(error); process.exitCode = 1; }
finally { await writeFile(`${out}/verification.json`, JSON.stringify(report, null, 2)); await browser.close(); }
