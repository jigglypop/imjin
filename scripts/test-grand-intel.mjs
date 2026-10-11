// Hidden forces must not alter computer orders or reveal global enemy fleet totals in the UI.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name, e); } };
try {
  const { newGrand, endTurn, growthVictoryRules } = await vite.ssrLoadModule('/src/sim/grand/turn.ts');
  const { threatTo, estimatedDefence, planAi } = await vite.ssrLoadModule('/src/sim/grand/ai.ts');
  const { visibleRegions, fleetObserved, lanesOf, findRoute } = await vite.ssrLoadModule('/src/sim/grand/world.ts');
  const { LANES, REGION_ORDER } = await vite.ssrLoadModule('/src/sim/grand/regions.ts');
  const { scoreViews, fleetViews, regionViews, routeText } = await vite.ssrLoadModule('/src/ui/grand/adapt.ts');
  const { orderDispatch } = await vite.ssrLoadModule('/src/sim/grand/dispatch.ts');
  const { buildReplay } = await vite.ssrLoadModule('/src/sim/grand/replay.ts');
  const unit = (kind, id) => ({ id, kind, name: id, hull: 1, crew: 1, supply: 1, kills: 0 });
  const fleet = (faction, at, ships, id) => ({ id, faction, at, ships, name: id, commanderId: null, transit: null, route: [], from: at, rest: 0 });
  const first = LANES.yeosu.find((l) => l.turns === 1).to;
  const second = LANES[first].find((l) => l.to !== 'yeosu' && !LANES.yeosu.some((x) => x.to === l.to)).to;
  const fixture = () => {
    const g = newGrand('joseon', 441);
    g.turn = 3; g.phase = 'orders'; g.events.pending = null; g.fleets = [];
    g.relations['joseon:ming'] = 'war';
    for (const id of REGION_ORDER) { g.regions[id].owner = 'japan'; g.regions[id].buildings = []; g.regions[id].garrison = []; g.regions[id].queue = []; }
    g.regions.yeosu.owner = 'joseon';
    return g;
  };
  check('threat estimates use the same observed fleets as the map, including incoming lanes', () => {
    const g = fixture(), enemy = fleet('japan', first, [unit('atakebune', 'enemy')], 'enemy-fleet');
    g.fleets = [enemy];
    assert.equal(fleetObserved(g, 'joseon', enemy), false);
    assert.equal(threatTo(g, 'joseon', 'yeosu'), 0);
    g.fleets.push(fleet('joseon', 'yeosu', [unit('panokseon', 'own')], 'own-fleet'));
    assert.equal(fleetObserved(g, 'joseon', enemy), true);
    assert.ok(threatTo(g, 'joseon', 'yeosu') > 0);
    g.fleets.pop(); enemy.at = null; enemy.transit = { from: first, to: 'yeosu', left: 1 };
    assert.equal(fleetObserved(g, 'joseon', enemy), true);
    assert.ok(threatTo(g, 'joseon', 'yeosu') > 0);
  });
  check('hidden guard and battery changes cannot alter estimates; scouting replaces the estimate', () => {
    const g = fixture();
    const own = fleet('joseon', 'yeosu', [unit('panokseon', 'own')], 'own-fleet'); g.fleets = [own];
    assert.equal(visibleRegions(g, 'joseon').has(second), false);
    const before = estimatedDefence(g, 'joseon', second);
    g.regions[second].garrison = Array.from({ length: 80 }, (_, i) => unit('atakebune', 'guard' + i));
    g.regions[second].buildings = [{ kind: 'camp', level: 3, upgradeLeft: 0, hp: 1 }, { kind: 'battery', level: 3, upgradeLeft: 0, hp: 1 }];
    assert.equal(estimatedDefence(g, 'joseon', second), before);
    own.ships.push(unit('hyeopseon', 'scout'));
    assert.equal(visibleRegions(g, 'joseon').has(second), true);
    assert.ok(estimatedDefence(g, 'joseon', second) > before * 5);
  });
  check('identical public information and RNG produce identical AI orders despite hidden reinforcements', () => {
    const a = fixture(); a.regions[first].owner = 'joseon';
    a.fleets = [fleet('joseon', 'yeosu', Array.from({ length: 12 }, (_, i) => unit('panokseon', 'own' + i)), 'own-fleet')];
    const b = structuredClone(a);
    b.regions[second].garrison = Array.from({ length: 100 }, (_, i) => unit('atakebune', 'secret' + i));
    b.regions[second].buildings = [{ kind: 'battery', level: 3, upgradeLeft: 0, hp: 1 }, { kind: 'shipyard', level: 3, upgradeLeft: 0, hp: 1 }];
    b.fleets.push(fleet('japan', 'nagoya', Array.from({ length: 100 }, (_, i) => unit('atakebune', 'hidden' + i)), 'hidden-fleet'));
    assert.equal(visibleRegions(a, 'joseon').has(second), false);
    planAi(a, 'joseon'); planAi(b, 'joseon');
    assert.deepEqual(a.fleets.filter((f) => f.faction === 'joseon'), b.fleets.filter((f) => f.faction === 'joseon'));
    assert.deepEqual(a.factions.joseon, b.factions.joseon);
    assert.deepEqual(a.rng, b.rng);
  });
  check('war status shows observed enemy hulls and withholds private score until the war ends', () => {
    const g = fixture();
    const hidden = fleet('japan', 'nagoya', [unit('atakebune', 'secret')], 'hidden-fleet'); g.fleets = [hidden];
    let japan = scoreViews(g).find((s) => s.faction === 'japan');
    assert.equal(japan.score, null); assert.equal(japan.ships, 0); assert.equal(japan.observedOnly, true);
    assert.equal(fleetViews(g).some((f) => f.id === hidden.id), false);
    g.fleets.push(fleet('joseon', 'tsushima', [unit('hyeopseon', 'scout')], 'scout-fleet'));
    japan = scoreViews(g).find((s) => s.faction === 'japan');
    assert.equal(japan.score, null); assert.equal(japan.ships, 1);
    assert.equal(fleetViews(g).some((f) => f.id === hidden.id), true);
    g.phase = 'over'; japan = scoreViews(g).find((s) => s.faction === 'japan');
    assert.equal(typeof japan.score, 'number'); assert.equal(japan.observedOnly, false); assert.equal(japan.ships, 1);
  });
  check('optional expedition lanes share map orders, three-turn sailing, replay progress and exact reload', () => {
    const g = newGrand('ming', 701);
    g.turn = 3; g.phase = 'orders'; g.events.pending = null;
    assert.equal(lanesOf(g, 'shandong'), LANES.shandong, 'legacy graph keeps its original array');
    assert.equal(lanesOf(g, 'shandong').some((l) => l.to === 'nagoya'), false);
    g.strategicLinks = 'three-way-v1'; g.relations['joseon:ming'] = 'war';
    g.regions.nagoya.owner = 'ming';
    for (const r of Object.values(g.regions)) { r.buildings = []; r.garrison = []; r.queue = []; }
    for (const f of ['joseon', 'japan', 'ming']) g.factions[f].gold = 0;
    g.victoryRules = growthVictoryRules(g);
    g.fleets = [fleet('ming', 'shandong', [unit('mingship', 'expedition-main')], 'expedition-fleet')];
    g.regions.shandong.garrison = [unit('mingsmall', 'expedition-guard')];
    assert.deepEqual(findRoute(g, 'ming', 'shandong', 'nagoya'), { path: ['nagoya'], turns: 3 });
    const mapPort = regionViews(g).find((p) => p.id === 'shandong');
    assert.ok(mapPort.adj.includes('nagoya')); assert.equal(mapPort.laneTurns.nagoya, 3);
    assert.equal(orderDispatch(g, ['expedition-fleet'], ['shandong'], 'nagoya', 'ming').ok, true);
    assert.ok(routeText(g, g.fleets[0]).includes('3'));
    const ids = g.fleets.map((f) => f.id);
    let state = g;
    for (let step = 1; step <= 3; step++) {
      const before = structuredClone(state), reloaded = JSON.parse(JSON.stringify(state));
      const report = endTurn(state); endTurn(reloaded);
      assert.deepEqual(reloaded, state, 'same expedition continues after serialization');
      const replay = buildReplay(before, state, report.contacts, 'ming');
      for (const id of ids) {
        const fl = state.fleets.find((f) => f.id === id), move = replay.moves.find((m) => m.fleetId === id);
        assert.ok(fl && move);
        const end = move.path.at(-1);
        if (step < 3) { assert.equal(fl.at, null); assert.equal(fl.transit.left, 3 - step); assert.equal(end.t, step / 3); }
        else { assert.equal(fl.at, 'nagoya'); assert.equal(fl.transit, null); assert.deepEqual(end, { at: 'nagoya' }); }
      }
    }
    const movedIds = state.fleets.filter((f) => ids.includes(f.id)).flatMap((f) => f.ships.map((s) => s.id)).sort();
    assert.deepEqual(movedIds, ['expedition-guard', 'expedition-main']);
  });
} finally { await vite.close(); }
process.exitCode = failed ? 1 : 0;
