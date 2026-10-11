// Merge-all and the batch flow of the faction campaign screen: one-step merge per port, dispatch with "merge on arrival",
// and the guarantee that the wish to merge never reaches the saved game.
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
  const { useGrand, mergeFleets, dispatchForces, mergeArrived } = await vite.ssrLoadModule('/src/campaign/grand.ts');
  const ship = (g, n) => ({ ...structuredClone(g.fleets.find((f) => f.ships.length).ships[0]), id: 'merge-test-' + n });
  // Four own fleets: three in Yeosu (one refitting), one in Hansando.
  const fixture = () => {
    const g = newGrand('joseon', 551);
    g.phase = 'orders'; g.events.pending = null;
    for (const r of Object.values(g.regions)) r.owner = 'joseon';
    const template = g.fleets.find((f) => f.faction === 'joseon');
    g.fleets = g.fleets.filter((f) => f.faction !== 'joseon');
    const make = (id, at, count) => ({ ...structuredClone(template), id, name: id, at, transit: null, route: [], rest: 0, commanderId: null, ships: Array.from({ length: count }, (_, i) => ship(g, id + i)) });
    g.fleets.push(make('a', 'yeosu', 3), make('b', 'yeosu', 2), make('c', 'yeosu', 1), make('d', 'hansan', 2), make('e', 'hansan', 1));
    g.fleets.find((f) => f.id === 'c').rest = 2;
    useGrand.setState({ grand: g, arrivalMerge: {} });
    return g;
  };
  const fleets = () => useGrand.getState().grand.fleets;
  const mine = () => fleets().filter((f) => f.faction === 'joseon');
  check('mergeFleets joins each port into its largest fleet and leaves a refitting fleet out', () => {
    fixture();
    const res = mergeFleets(['a', 'b', 'c', 'd', 'e']);
    assert.equal(res.ok, true); assert.equal(res.params.n, 2);
    const ids = mine().map((f) => f.id).sort();
    assert.deepEqual(ids, ['a', 'c', 'd']);
    assert.equal(fleets().find((f) => f.id === 'a').ships.length, 5);
    assert.equal(fleets().find((f) => f.id === 'd').ships.length, 3);
    assert.equal(fleets().find((f) => f.id === 'c').ships.length, 1);
  });
  check('mergeFleets explains itself and changes nothing when there is nothing to join', () => {
    fixture();
    const before = JSON.stringify(useGrand.getState().grand);
    for (const ids of [['a'], ['a', 'd'], ['a', 'c']]) {
      const res = mergeFleets(ids);
      assert.equal(res.ok, false, ids.join());
      assert.ok(res.reason.length);
    }
    assert.equal(mergeFleets(['a', 'nope']).ok, false);
    assert.equal(JSON.stringify(useGrand.getState().grand), before);
  });
  check('mergeFleets refuses a fleet of another navy', () => {
    const g = fixture();
    g.fleets.push({ ...structuredClone(g.fleets[0]), id: 'foe', faction: 'japan', ships: [ship(g, 'foe')], at: 'yeosu' });
    useGrand.setState({ grand: g });
    const before = fleets().length;
    assert.equal(mergeFleets(['a', 'foe']).ok, false);
    assert.equal(fleets().length, before);
  });
  check('dispatch with merge on arrival marks the sailing fleets and the garrison fleet, and the save carries no mark', () => {
    const g = fixture();
    const known = new Set(fleets().map((f) => f.id));
    const res = dispatchForces(['a', 'b'], ['yeosu'], 'noryang', true);
    assert.equal(res.ok, true);
    const sortie = fleets().find((f) => !known.has(f.id));
    assert.ok(sortie);
    assert.deepEqual(Object.keys(useGrand.getState().arrivalMerge).sort(), ['a', 'b', sortie.id].sort());
    assert.ok(!saved.get('imjin.grand.v1').includes('arrivalMerge'));
  });
  check('without the option no mark is kept, and a failed dispatch marks nothing', () => {
    fixture();
    assert.equal(dispatchForces(['a', 'b'], [], 'noryang', false).ok, true);
    assert.deepEqual(useGrand.getState().arrivalMerge, {});
    fixture();
    assert.equal(dispatchForces(['a', 'c'], [], 'noryang', true).ok, false);
    assert.deepEqual(useGrand.getState().arrivalMerge, {});
  });
  check('mergeArrived waits for the stragglers, then joins everyone and spends the mark', () => {
    fixture();
    assert.equal(dispatchForces(['a', 'b', 'd'], [], 'noryang', true).ok, true);
    const move = (id, at) => { const f = useGrand.getState().grand.fleets.find((x) => x.id === id); f.at = at; f.route = []; };
    move('a', 'noryang');
    assert.equal(mergeArrived(), 0);
    assert.equal(Object.keys(useGrand.getState().arrivalMerge).length, 3);
    move('b', 'noryang'); move('d', 'noryang');
    assert.equal(mergeArrived(), 2);
    assert.equal(fleets().filter((f) => f.at === 'noryang').length, 1);
    assert.equal(fleets().find((f) => f.id === 'a').ships.length, 7);
    assert.deepEqual(useGrand.getState().arrivalMerge, {});
    assert.equal(mergeArrived(), 0);
  });
  check('mergeArrived leaves the mark of a fleet that has not come in, and ignores other phases', () => {
    fixture();
    dispatchForces(['a', 'b'], [], 'noryang', true);
    const g = useGrand.getState().grand;
    g.fleets.find((f) => f.id === 'a').at = 'noryang';
    g.fleets.find((f) => f.id === 'a').route = [];
    g.phase = 'battles';
    assert.equal(mergeArrived(), 0);
    g.phase = 'orders';
    assert.equal(mergeArrived(), 0);
    assert.ok('b' in useGrand.getState().arrivalMerge);
  });
} finally {
  await vite.close();
}
if (failed) { console.error(failed + ' failed'); process.exit(1); }
