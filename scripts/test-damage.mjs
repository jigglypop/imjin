import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); } };
try {
  const { Battle, SIM_DT } = await server.ssrLoadModule('/src/sim/battle.ts');
  const { buildConquest } = await server.ssrLoadModule('/src/sim/maps.ts');
  const { RANKED_OPTIONS } = await server.ssrLoadModule('/src/sim/conquest.ts');
  const ram = (speed, reverse = false, profile = 'competitive-v1') => {
    const b = new Battle(7, profile); b.windDrift = 0;
    const ships = (reverse ? [10.5, -10.5] : [-10.5, 10.5]).map((x, i) => b.addShip('sekibune', x, 0, x < 0 ? 0 : Math.PI, '', b.addSquadron(i ? 'japan' : 'joseon', '', '', '', '', i)));
    for (const s of ships) s.speed = speed;
    b.grid.rebuild(b.ships); b.collide(SIM_DT);
    return { b, ships };
  };
  check('faster head-on collisions cause more hull, crew and machinery damage, equally on both sides', () => {
    const slow = ram(1), fast = ram(4), mirror = ram(4, true);
    for (const { ships } of [slow, fast, mirror]) {
      assert.ok(Math.abs(ships[0].hull - ships[1].hull) < 1e-9); assert.ok(Math.abs(ships[0].crew - ships[1].crew) < 1e-9);
      for (const field of ['flooding', 'propulsion', 'steering']) assert.ok(Math.abs(ships[0].damageState[field] - ships[1].damageState[field]) < 1e-9);
      for (const s of ships) assert.ok(Math.abs(s.crew - s.roles.reduce((sum, n) => sum + n, 0)) < 1e-9);
    }
    assert.ok(fast.ships[0].hull < slow.ships[0].hull); assert.ok(fast.ships[0].crew < slow.ships[0].crew);
    assert.ok(fast.ships[0].damageState.propulsion > slow.ships[0].damageState.propulsion);
    assert.deepEqual(fast.ships[0].damageState, mirror.ships[0].damageState);
  });
  check('equal impacts at the side admit more water and at the stern damage steering more than at the bow', () => {
    const b = new Battle(7, 'competitive-v1');
    const [bow, side, stern] = [0, 1, 2].map((i) => b.addShip('panokseon', i * 100, 0, 0, '', null));
    b.impactDamage(bow, 30, 1, 0); b.impactDamage(side, 30, 0, 1); b.impactDamage(stern, 30, -1, 0);
    assert.ok(side.damageState.flooding > bow.damageState.flooding); assert.ok(stern.damageState.steering > bow.damageState.steering);
  });
  check('parallel and separating friendly contacts preserve travel while an approaching collision removes closing speed', () => {
    for (const profile of ['competitive-v1', 'historical']) {
      const b = new Battle(7, profile), sq = b.addSquadron('joseon', '', '', '', '', 0);
      const a = b.addShip('sekibune', 0, -2, 0, '', sq), z = b.addShip('sekibune', 0, 2, 0, '', sq);
      a.speed = z.speed = 4; b.grid.rebuild(b.ships); b.collide(SIM_DT);
      if (profile === 'competitive-v1') { assert.equal(a.speed, 4); assert.equal(z.speed, 4); }
      else { assert.ok(a.speed < 4); assert.ok(z.speed < 4); }
    }
    const b = new Battle(7, 'competitive-v1'), sq = b.addSquadron('joseon', '', '', '', '', 0);
    const a = b.addShip('sekibune', -10.5, 0, Math.PI, '', sq), z = b.addShip('sekibune', 10.5, 0, 0, '', sq);
    a.speed = z.speed = 4; b.grid.rebuild(b.ships); b.collide(SIM_DT);
    assert.equal(a.speed, 4); assert.equal(z.speed, 4);
    const headOn = ram(4); assert.ok(Math.abs(headOn.ships[0].speed) < 1e-9); assert.ok(Math.abs(headOn.ships[1].speed) < 1e-9);
  });
  check('damaged propulsion and steering reduce actual travel and turning until the dock repairs them', () => {
    const b = new Battle(7, 'competitive-v1'); b.windDrift = 0;
    const fresh = b.addShip('panokseon', 0, 0, 0, '', null), damaged = b.addShip('panokseon', 0, 500, 0, '', null);
    damaged.damageState = { flooding: 0.5, propulsion: 0.7, steering: 0.7 };
    for (const s of [fresh, damaged]) { s.speed = 0; s.throttle = 1; s.rudder = 1; }
    for (let i = 0; i < 30 * 30; i++) { b.move(fresh, SIM_DT); b.move(damaged, SIM_DT); }
    assert.ok(damaged.speed < fresh.speed * 0.8); assert.ok(damaged.turn < fresh.turn * 0.8);
    // Repair still services machinery when the hull and all crew stations are already full.
    b.mend(damaged, 1, 0); assert.deepEqual(damaged.damageState, { flooding: 0, propulsion: 0, steering: 0 });
    damaged.speed = fresh.speed = 0; damaged.turn = fresh.turn = 0;
    for (let i = 0; i < 30 * 30; i++) { b.move(fresh, SIM_DT); b.move(damaged, SIM_DT); }
    assert.ok(Math.abs(damaged.speed - fresh.speed) < 1e-9); assert.ok(Math.abs(damaged.turn - fresh.turn) < 1e-9);
  });
  check('pumping and flood damage integrate independently of update frequency, and missing rowers cannot pump', () => {
    const run = (hz, crew) => {
      const b = new Battle(7, 'competitive-v1'), ship = b.addShip('panokseon', 0, 0, 0, '', null);
      b.setCrew(ship, crew * ship.spec.crew); ship.damageState.flooding = 0.5;
      for (let i = 0; i < 60 * hz; i++) b.damageOverTime(ship, 1 / hz);
      return ship;
    };
    const at20 = run(20, 1), at60 = run(60, 1), unattended = run(30, 0);
    assert.ok(at20.hull < at20.spec.hull); assert.ok(at20.damageState.flooding < 0.5);
    assert.ok(Math.abs(at20.hull - at60.hull) < 1e-8); assert.ok(Math.abs(at20.damageState.flooding - at60.damageState.flooding) < 1e-10);
    assert.equal(unattended.damageState.flooding, 0.5); assert.ok(unattended.hull < at20.hull);
  });
  check('an actual cannonball below the deck creates a breach while historical shot damage has no new machinery state', () => {
    for (const profile of ['competitive-v1', 'historical']) {
      const b = new Battle(7, profile), target = b.addShip('panokseon', 0, 0, 0, '', b.addSquadron('joseon', '', '', '', '', 0));
      b.grid.rebuild(b.ships);
      b.projectiles.push({ id: 1, x: 0, y: 3.5, z: 16, vx: 0, vy: 0, vz: -20, team: 'japan', shooter: 0, damage: 20, crewDamage: 4, ammo: 'ball', gun: 'cheonja', fireChance: 0, age: 0, alive: true });
      for (let i = 0; i < 25; i++) b.updateProjectiles(SIM_DT);
      assert.ok(b.events.some((e) => e.type === 'hit')); assert.ok(target.hull < target.spec.hull);
      if (profile === 'historical') assert.equal(target.damageState, undefined); else assert.ok(target.damageState.flooding > 0 && target.damageState.propulsion > 0);
    }
  });
  check('historical collisions and dock repairs retain their original machinery-free rules', () => {
    const { b, ships } = ram(4, false, 'historical');
    assert.ok(b.events.some((e) => e.type === 'ram')); for (const s of ships) { assert.equal(s.damageState, undefined); b.mend(s, 0.1, 0.1); assert.equal(s.damageState, undefined); }
  });
  check('a flooded ship can actually receive dock service after combat has stopped', () => {
    const { battle: b, conquest: c } = buildConquest('hallyeo', [{ name: '', faction: 'joseon', team: 'joseon', human: true, fleet: [] }, { name: '', faction: 'japan', team: 'japan', human: true, fleet: [] }], () => -50, 7, RANKED_OPTIONS);
    const p = c.homeOf(0), ship = b.addShip('panokseon', p.x, p.z, 0, '', b.addSquadron('joseon', '', '', '', '', 0));
    p.buildings[2] = { kind: 'dock', hp: 200, progress: 1, level: 1 };
    ship.lastHit = 0; ship.damageState = { flooding: 0.5, propulsion: 0.5, steering: 0.5 }; b.time = 10;
    b.grid.rebuild(b.ships); b.damageOverTime(ship, 1); assert.equal(ship.lastHit, 0);
    const before = structuredClone(ship.damageState); c.services(b, 1);
    assert.ok(ship.damageState.propulsion < before.propulsion); assert.ok(ship.damageState.flooding < before.flooding);
  });
  check('the same collision, flood and recovery sequence has the same result without randomness', () => {
    const run = () => { const { b, ships } = ram(4); for (let i = 0; i < 300; i++) for (const s of ships) { b.damageOverTime(s, SIM_DT); b.mend(s, 0.0001, 0.0001); } return ships.map((s) => ({ hull: s.hull, crew: s.crew, roles: s.roles, damage: s.damageState })); };
    assert.deepEqual(run(), run());
  });
} finally { await server.close(); }
console.log(failed ? `${failed} failed` : 'all passed'); process.exitCode = failed ? 1 : 0;
