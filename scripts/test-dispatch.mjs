// Exercise atomic campaign orders, exact crew transfer, save commits and strategic scout intelligence.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const saved = new Map();
globalThis.localStorage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: (k) => saved.delete(k) };
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name, e); } };
try {
  const { newGrand } = await vite.ssrLoadModule('/src/sim/grand/turn.ts');
  const { orderDispatch, orderMobilize, dispatchTargets } = await vite.ssrLoadModule('/src/sim/grand/dispatch.ts');
  const { visibleRegions } = await vite.ssrLoadModule('/src/sim/grand/world.ts');
  const { REGIONS, REGION_ORDER, LANES } = await vite.ssrLoadModule('/src/sim/grand/regions.ts');
  const { grandOrders, useGrand } = await vite.ssrLoadModule('/src/campaign/grand.ts');
  const fixture = () => {
    const g = newGrand('joseon', 551);
    g.phase = 'orders'; g.events.pending = null;
    for (const r of Object.values(g.regions)) r.owner = 'joseon';
    g.fleets = g.fleets.filter((f) => f.faction === 'joseon');
    for (const f of g.fleets) { f.rest = 0; f.transit = null; f.at = 'yeosu'; f.route = []; }
    return g;
  };
  check('batch validates every fleet and garrison before changing any route, identity or crew', () => {
    for (const invalid of ['missing', 'enemy', 'resting', 'sailing', 'empty-port', 'foreign-port', 'phase']) {
      const g = fixture(), f = g.fleets[0]; let fleet = f.id, port = 'yeosu';
      if (invalid === 'missing') fleet = 'does-not-exist';
      if (invalid === 'enemy') f.faction = 'japan';
      if (invalid === 'resting') f.rest = 1;
      if (invalid === 'sailing') f.transit = { from: 'yeosu', to: 'noryang', left: 1, total: 1 };
      if (invalid === 'empty-port') g.regions.yeosu.garrison = [];
      if (invalid === 'foreign-port') g.regions.yeosu.owner = 'japan';
      if (invalid === 'phase') g.phase = 'battles';
      const before = JSON.stringify(g);
      assert.equal(orderDispatch(g, [fleet], [port], 'noryang', 'joseon').ok, false, invalid);
      assert.equal(JSON.stringify(g), before, invalid + ' must be atomic');
    }
  });
  check('one order deduplicates inputs and preserves all ship ids, condition, supplies and crew', () => {
    const g = fixture(), f = g.fleets[0], beforeCount = g.fleets.length;
    const crew = g.regions.yeosu.garrison;
    assert.ok(crew.length); crew[0].crew = 0.43; crew[0].hull = 0.67; crew[0].supply = 0.29;
    const before = structuredClone(crew);
    assert.equal(orderDispatch(g, [f.id, f.id], ['yeosu', 'yeosu'], 'noryang', 'joseon').ok, true);
    assert.equal(g.fleets.length, beforeCount + 1); assert.equal(g.regions.yeosu.garrison.length, 0);
    assert.deepEqual(g.fleets.at(-1).ships, before); assert.deepEqual(f.route, ['noryang']);
    assert.deepEqual(g.fleets.at(-1).route, f.route);
  });
  check('targets are the intersection of real routes; failed UI commits leave memory and saved game untouched', () => {
    const g = fixture(), f = g.fleets[0];
    assert.ok(dispatchTargets(g, [f.id], ['yeosu'], 'joseon').includes('noryang'));
    assert.equal(dispatchTargets(g, [f.id, 'missing'], ['yeosu'], 'joseon').length, 0);
    useGrand.setState({ grand: g }); localStorage.setItem('imjin.grand.v1', JSON.stringify(g));
    const raw = saved.get('imjin.grand.v1');
    assert.equal(grandOrders.dispatch([f.id, 'missing'], ['yeosu'], 'noryang').ok, false);
    assert.equal(useGrand.getState().grand, g); assert.equal(saved.get('imjin.grand.v1'), raw);
    assert.equal(grandOrders.dispatch([f.id], ['yeosu'], 'noryang').ok, true);
    assert.notEqual(useGrand.getState().grand, g); assert.deepEqual(JSON.parse(saved.get('imjin.grand.v1')), useGrand.getState().grand);
  });
  check('mobilization creates a docked fleet without teleporting or inventing land troops', () => {
    const g = fixture(), before = structuredClone(g.regions.yeosu.garrison);
    const r = orderMobilize(g, 'yeosu', 'joseon'); assert.equal(r.ok, true);
    const f = g.fleets.find((f) => f.id === r.note); assert.ok(f);
    assert.deepEqual(f.ships, before); assert.equal(f.at, 'yeosu'); assert.equal(f.transit, null); assert.deepEqual(f.route, []);
  });
  check('ports reveal their own waters, main fleets one lane, scouting craft two lanes and beacons actual completed levels', () => {
    const g = fixture(); g.fleets = []; for (const id of REGION_ORDER) { g.regions[id].owner = 'japan'; g.regions[id].buildings = []; }
    g.regions.yeosu.owner = 'joseon';
    assert.deepEqual([...visibleRegions(g, 'joseon')], ['yeosu']);
    const a = LANES.yeosu[0].to;
    const b = LANES[a].find((l) => l.to !== 'yeosu' && !LANES.yeosu.some((x) => x.to === l.to))?.to;
    assert.ok(b, 'fixture has a second lane');
    g.fleets = [{ id: 'scout', faction: 'joseon', at: 'yeosu', ships: [{ kind: 'panokseon', hull: 1, crew: 1 }], transit: null }];
    assert.ok(visibleRegions(g, 'joseon').has(a)); assert.equal(visibleRegions(g, 'joseon').has(b), false);
    g.fleets[0].ships[0].kind = 'hyeopseon'; assert.ok(visibleRegions(g, 'joseon').has(b));
    g.fleets[0].ships[0].crew = 0; assert.equal(visibleRegions(g, 'joseon').has(b), false);
    g.fleets = []; g.regions.yeosu.buildings = [{ kind: 'beacon', level: 1 }]; assert.ok(visibleRegions(g, 'joseon').has(b));
    assert.equal(Object.keys(REGIONS).length, 25);
  });
} finally { await vite.close(); }
process.exitCode = failed ? 1 : 0;
