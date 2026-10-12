// The hyeopseon's tender trait: it tops up friends beside it under the expanded conquest rules and nowhere else.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
function check(name, run) { try { run(); console.log('ok   ' + name); } catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); } }
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
try {
  const { Battle, SIM_DT } = await server.ssrLoadModule('/src/sim/battle.ts');
  const { Conquest, DEFAULT_OPTIONS, RANKED_OPTIONS } = await server.ssrLoadModule('/src/sim/conquest.ts');
  const { COMPETITIVE_PROFILE } = await server.ssrLoadModule('/src/sim/competitive.ts');
  const { SHIP_SPECS } = await server.ssrLoadModule('/src/sim/catalog.ts');
  const { buildScenario } = await server.ssrLoadModule('/src/sim/scenarios.ts');
  const land = () => -50;
  const map = [
    { name: 'west', hanja: '', x: -4000, z: 0, r: 250, value: 1, home: 0 },
    { name: 'east', hanja: '', x: 4000, z: 0, r: 250, value: 1, home: 1 },
  ];
  const spec = SHIP_SPECS.hyeopseon.tender;
  function fixture(options = {}) {
    const b = new Battle(5150, COMPETITIVE_PROFILE);
    const c = new Conquest(map, [
      { slot: 0, name: 'west', faction: 'joseon', team: 'joseon', human: true },
      { slot: 1, name: 'east', faction: 'japan', team: 'japan', human: true },
    ], land, { ...DEFAULT_OPTIONS, ...options });
    b.land = land; b.rules = c; b.humans = new Set([0, 1]);
    const squad = b.addSquadron('joseon', '', '', '', '', 0);
    const ship = (kind, x, z, hurt = 0.5) => {
      const s = b.addShip(kind, x, z, 0, '', squad);
      s.order = { type: 'hold' }; s.speed = 0; s.lastHit = -100;
      s.hull = s.spec.hull * (1 - hurt); s.crew = s.spec.crew * (1 - hurt); s.roles = s.roles.map((n) => n * (1 - hurt)); s.supply = 1 - hurt;
      return s;
    };
    return { b, c, ship };
  }
  const tick = (f, seconds) => { for (let t = 0; t < seconds; t += SIM_DT) { f.b.time += SIM_DT; f.b.grid.rebuild(f.b.ships); f.c.step(f.b, SIM_DT); } };
  const frac = (s) => [s.hull / s.spec.hull, s.crew / s.spec.crew, s.supply];

  check('only the hyeopseon and the Japanese transport carry the trait', () => {
    for (const [kind, s] of Object.entries(SHIP_SPECS)) assert.equal(!!s.tender, kind === 'hyeopseon' || kind === 'byeongnyangseon', kind);
  });
  check('a tender restores hull, crew and supply at the spec rates', () => {
    const f = fixture(), t = f.ship('hyeopseon', 0, 0, 0), s = f.ship('panokseon', 50, 0);
    tick(f, 10);
    const [h, c, a] = frac(s);
    assert.ok(Math.abs(h - 0.5 - 10 * spec.hull) < 1e-3 && Math.abs(c - 0.5 - 10 * spec.crew) < 1e-3 && Math.abs(a - 0.5 - 10 * spec.ammo) < 1e-3, `${h} ${c} ${a}`);
    assert.deepEqual(frac(t), [1, 1, 1]);
  });
  check('a tender serves up to its capacity and the neediest first', () => {
    const f = fixture(), hurts = [0.2, 0.9, 0.5, 0.7, 0.4];
    f.ship('hyeopseon', 0, 0, 0);
    const ships = hurts.map((n, i) => f.ship('panokseon', 30 + i * 8, 20, n));
    tick(f, 10);
    const gained = ships.map((s, i) => frac(s)[1] > 1 - hurts[i] + 1e-6);
    assert.deepEqual(gained, [false, true, true, true, false]);
  });
  check('a ship in range of several tenders is served by one only', () => {
    const gain = (tenders) => {
      const f = fixture();
      for (let i = 0; i < tenders; i += 1) f.ship('hyeopseon', -20 + i * 6, 30, 0);
      const s = f.ship('panokseon', 0, 0);
      tick(f, 10);
      return frac(s)[0] - 0.5;
    };
    const one = gain(1);
    assert.ok(one > 0);
    close(gain(5), one);
  });
  check('a ship hit within 8 seconds or out of range is not served', () => {
    const f = fixture();
    f.ship('hyeopseon', 0, 0, 0);
    const hit = f.ship('panokseon', 40, 0), far = f.ship('panokseon', spec.range + 20, 0);
    hit.lastHit = f.b.time;
    tick(f, 7);
    assert.deepEqual(frac(hit), [0.5, 0.5, 0.5]); assert.deepEqual(frac(far), [0.5, 0.5, 0.5]);
    tick(f, 3);
    assert.ok(frac(hit)[0] > 0.5); assert.deepEqual(frac(far), [0.5, 0.5, 0.5]);
  });
  check('enemies are not served and a tender does not serve itself', () => {
    const f = fixture(), t = f.ship('hyeopseon', 0, 0, 0.5);
    const foe = f.ship('atakebune', 40, 0); foe.team = 'japan';
    tick(f, 5);
    assert.deepEqual(frac(foe), [0.5, 0.5, 0.5]); assert.deepEqual(frac(t), [0.5, 0.5, 0.5]);
  });
  check('nothing is served in the ranked rules or without conquest rules', () => {
    const ranked = fixture(RANKED_OPTIONS);
    ranked.ship('hyeopseon', 0, 0, 0);
    const s = ranked.ship('panokseon', 40, 0);
    tick(ranked, 10);
    assert.deepEqual(frac(s), [0.5, 0.5, 0.5]);
    const b = new Battle(5150, 'historical'), squad = b.addSquadron('joseon', '', '', '', '', 0);
    b.addShip('hyeopseon', 0, 0, 0, '', squad);
    const hurt = b.addShip('panokseon', 40, 0, 0, '', squad);
    hurt.hull *= 0.5; hurt.supply = 0.5;
    for (let i = 0; i < 300; i += 1) b.step(SIM_DT);
    assert.ok(hurt.hull <= SHIP_SPECS.panokseon.hull * 0.5); assert.equal(hurt.supply, 0.5);
    assert.equal(buildScenario('okpo', 0).rules ?? null, null);
  });
  check('two identical runs end in the same state', () => {
    const run = () => {
      const f = fixture();
      f.ship('hyeopseon', 0, 0, 0); f.ship('hyeopseon', 10, 5, 0.2);
      for (let i = 0; i < 6; i += 1) f.ship('panokseon', 20 + i * 6, 15, 0.1 * i + 0.2);
      tick(f, 20);
      return JSON.stringify(f.b.ships.map((s) => [s.hull, s.crew, s.supply, s.roles]));
    };
    assert.equal(run(), run());
  });
  check('the computer hyeopseon goes to a hurt friend and keeps clear of a close enemy', () => {
    const f = fixture();
    const t = f.b.addShip('hyeopseon', 0, 0, 0, '', f.b.addSquadron('joseon', '', '', '', '', 2));
    const friend = f.ship('panokseon', 350, 0);
    const gap = () => Math.hypot(friend.x - t.x, friend.z - t.z);
    const before = gap();
    for (let i = 0; i < 50 / SIM_DT; i += 1) f.b.step(SIM_DT);
    assert.ok(gap() < before - 200 && gap() < 120, `${before} -> ${gap()}`);
    assert.ok(frac(friend)[0] > 0.5);

    const g = fixture();
    const t2 = g.b.addShip('hyeopseon', 0, 0, 0, '', g.b.addSquadron('joseon', '', '', '', '', 2));
    g.ship('panokseon', 300, 0);
    const foe = g.b.addShip('atakebune', -150, 0, 0, '', g.b.addSquadron('japan', '', '', '', '', 1));
    foe.order = { type: 'hold' }; foe.speed = 0;
    for (let i = 0; i < 4 / SIM_DT; i += 1) g.b.step(SIM_DT);
    assert.ok(Math.hypot(t2.x - foe.x, t2.z - foe.z) > 150 && t2.x > -150, `${t2.x}`);
  });
} finally {
  await server.close();
}
if (failed) { console.error(`${failed} test(s) failed`); process.exit(1); }
