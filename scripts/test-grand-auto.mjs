// The player's one-click attack rule and "자동 건설": the works-only planner keeps a reserve and a cap, switched off it changes nothing
// (not one die of the campaign's generator), and a save made before it existed loads with it off.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name, e); } };
try {
  const { portClick } = await vite.ssrLoadModule('/src/ui/grand/clickTarget.ts');
  const { newGrand, endTurn } = await vite.ssrLoadModule('/src/sim/grand/turn.ts');
  const { autoWorks, autoWorkReserve, AUTO_WORK_CAP } = await vite.ssrLoadModule('/src/sim/grand/ai.ts');
  const { ownedBy } = await vite.ssrLoadModule('/src/sim/grand/world.ts');
  const { levelOf } = await vite.ssrLoadModule('/src/sim/grand/economy.ts');
  const auto = (g) => g.log.filter((l) => l.text.startsWith('자동 건설'));

  check('a selected fleet attacks an enemy port in one click, but a friendly port only opens its panel', () => {
    const reachable = ['busan', 'yeosu'];
    assert.equal(portClick({ moving: false, reachable, hostile: true, port: 'busan' }), 'order');
    assert.equal(portClick({ moving: false, reachable, hostile: false, port: 'yeosu' }), 'open');
    assert.equal(portClick({ moving: false, reachable, hostile: true, port: 'nagoya' }), 'open');
    assert.equal(portClick({ moving: false, reachable: undefined, hostile: true, port: 'busan' }), 'open');
  });
  check('the move mode still sends to a friendly port and refuses an unreachable one', () => {
    const reachable = ['busan', 'yeosu'];
    assert.equal(portClick({ moving: true, reachable, hostile: false, port: 'yeosu' }), 'order');
    assert.equal(portClick({ moving: true, reachable, hostile: true, port: 'nagoya' }), 'blocked');
    assert.equal(portClick({ moving: true, reachable: [], hostile: false, port: 'yeosu' }), 'blocked');
  });

  check('a funded player builds at most the cap, keeps the reserve, and logs each work', () => {
    const g = newGrand('joseon', 7);
    g.factions.joseon.gold = 100000;
    const placed = autoWorks(g, 'joseon');
    assert.equal(placed, AUTO_WORK_CAP);
    assert.equal(auto(g).length, AUTO_WORK_CAP);
    assert(auto(g).every((l) => l.tag === 'built' && l.tone === 'good'));
    assert(g.factions.joseon.gold >= autoWorkReserve(g, 'joseon'));
  });
  check('it never spends below the reserve, and does nothing when only the reserve is left', () => {
    const g = newGrand('joseon', 7);
    const reserve = autoWorkReserve(g, 'joseon');
    g.factions.joseon.gold = reserve;
    assert.equal(autoWorks(g, 'joseon'), 0);
    assert.equal(g.factions.joseon.gold, reserve);
    for (const gold of [reserve + 60, reserve + 200, reserve + 600]) {
      const h = newGrand('joseon', 7);
      h.factions.joseon.gold = gold;
      autoWorks(h, 'joseon');
      assert(h.factions.joseon.gold >= reserve, `gold ${h.factions.joseon.gold} fell under ${reserve}`);
    }
  });
  check('the first work of a port with a yard and no camp is the camp, and only own ports are touched', () => {
    const g = newGrand('joseon', 7);
    g.factions.joseon.gold = 100000;
    const before = Object.fromEntries(Object.keys(g.regions).map((id) => [id, JSON.stringify(g.regions[id].buildings)]));
    const yardNoCamp = ownedBy(g, 'joseon').filter((id) => levelOf(g.regions[id], 'shipyard') > 0 && levelOf(g.regions[id], 'camp') === 0);
    assert(yardNoCamp.length > 0, 'the start has no yard without a camp to test');
    autoWorks(g, 'joseon');
    const changed = Object.keys(g.regions).filter((id) => JSON.stringify(g.regions[id].buildings) !== before[id]);
    assert(changed.length > 0);
    assert(changed.every((id) => g.regions[id].owner === 'joseon'));
    for (const id of changed) if (yardNoCamp.includes(id)) assert(g.regions[id].buildings.some((b) => b.kind === 'camp' && b.upgradeLeft > 0), `${id} got no camp`);
  });
  check('turned off, ending the turn is the same as before: no auto works and the generator ends in the same state as with it on', () => {
    const run = (flag) => {
      const g = newGrand('joseon', 12);
      if (flag !== undefined) g.autoWorks = flag;
      g.factions.joseon.gold = 3000;
      endTurn(g);
      return g;
    };
    const absent = run(undefined), off = run(false), on = run(true);
    const { autoWorks: _flag, ...rest } = off;
    assert.deepEqual(absent, rest, 'flag false and flag absent must play identically');
    assert.equal(auto(absent).length, 0);
    assert.equal(auto(off).length, 0);
    assert(auto(on).length > 0);
    assert.equal(on.rng.s, off.rng.s, 'the switch must not draw from the campaign dice');
    for (const f of ['japan', 'ming']) assert.deepEqual(on.factions[f], off.factions[f]);
    for (const id of Object.keys(on.regions)) if (on.regions[id].owner !== 'joseon') assert.deepEqual(on.regions[id], off.regions[id]);
  });
  check('an old save without the field loads, plays a turn and stays off', () => {
    const g = newGrand('joseon', 5);
    const old = JSON.parse(JSON.stringify(g));
    assert(!('autoWorks' in old));
    endTurn(old);
    assert.equal(old.autoWorks, undefined);
    assert.equal(auto(old).length, 0);
  });
} finally {
  await vite.close();
}
if (failed) process.exit(1);
