// Direct expedition retreat and legacy compatibility. The movement/replay UI contract is checked in test-grand-intel.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { newGrand, applyContactOutcome, endTurn } = await server.ssrLoadModule('/src/sim/grand/turn.ts');
  const { lanesOf, findRoute } = await server.ssrLoadModule('/src/sim/grand/world.ts');
  const { LANES } = await server.ssrLoadModule('/src/sim/grand/regions.ts');
  const before = JSON.stringify(LANES);
  // Lane-rule saves: the expedition graph and its retreat over the three-turn lane.
  const g = newGrand('japan', 77); delete g.march; g.relations['joseon:ming'] = 'war';
  const fl = g.fleets.find((f) => f.faction === 'japan' && f.at === 'nagoya');
  assert.equal(lanesOf(g, 'nagoya'), LANES.nagoya);
  assert.equal(findRoute(g, 'japan', 'nagoya', 'shandong'), null);
  g.strategicLinks = 'three-way-v1';
  assert.deepEqual(findRoute(g, 'japan', 'nagoya', 'shandong'), { path: ['shandong'], turns: 3 });
  fl.at = 'shandong'; fl.from = 'nagoya'; fl.route = [];
  const c = { id: 'expedition-retreat', regionId: 'shandong', attacker: 'japan', defender: 'ming', attackerFleets: [fl.id], defenderFleets: [], player: true };
  g.pending = [c];
  const outcome = { winner: 'defender', razed: [], ships: fl.ships.map((s) => ({ campaignId: s.id, alive: true, hull: 1, crew: 1, supply: 1, kills: 0 })) };
  applyContactOutcome(g, c, outcome);
  assert.equal(fl.at, null); assert.deepEqual(fl.transit, { from: 'shandong', to: 'nagoya', left: 2 });
  const copy = JSON.parse(JSON.stringify(g));
  g.pending = []; copy.pending = []; g.phase = 'orders'; copy.phase = 'orders';
  for (let k = 0; k < 2; k++) { endTurn(g); endTurn(copy); }
  assert.equal(fl.at, 'nagoya'); assert.equal(fl.transit, null);
  assert.equal(JSON.stringify(g), JSON.stringify(copy));
  assert.equal(JSON.stringify(LANES), before);
  console.log('ok   failed overseas expeditions retreat over the same three-turn lane and reload identically');
  console.log('ok   absent expedition rules retain the original graph and cannot sail through hostile Korea');
} finally { await server.close(); }
