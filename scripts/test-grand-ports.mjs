// Expanded coastal campaign: actual routes, recruitment, old saves, translation and terrain-backed battle handoff.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { groundHeights } from './region-ground.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const saved = new Map();
globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) };
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
const load = (path) => server.ssrLoadModule(path);
let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}`, error); }
};

try {
  const [regions, turn, orders, world, economy, migration, coast, spawn, bridge, roster, terrain, i18n, names, dispatch, environmentModule] = await Promise.all([
    load('/src/sim/grand/regions.ts'), load('/src/sim/grand/turn.ts'), load('/src/sim/grand/orders.ts'), load('/src/sim/grand/world.ts'),
    load('/src/sim/grand/economy.ts'), load('/src/sim/grand/migration.ts'), load('/src/sim/grand/coast.ts'), load('/src/sim/grand/spawn.ts'),
    load('/src/sim/grand/bridge.ts'), load('/src/sim/grand/roster.ts'), load('/src/terrain/generate.ts'), load('/src/i18n/index.ts'),
    load('/src/ui/grand/text.ts'), load('/src/sim/grand/dispatch.ts'), load('/src/sim/environment.ts'),
  ]);
  const { ADDED_PORTS, LEGACY_REGION_ORDER, REGION_ORDER, REGIONS, LANES, KOREA_COAST, PORT_EXPANSION_PARENT, START } = regions;
  const { newGrand, endTurn } = turn;
  const { migrateGrandRegions } = migration;
  const { REGION_MAPS } = coast;
  const legacySave = () => {
    const g = newGrand('joseon', 591);
    for (const id of ADDED_PORTS) delete g.regions[id];
    return g;
  };
  const legacyFields = (g) => ({ ...g, nextId: 0, regions: Object.fromEntries(LEGACY_REGION_ORDER.map((id) => [id, g.regions[id]])) });
  const idsOf = (g) => [...Object.values(g.regions).flatMap((r) => [...r.garrison.map((s) => s.id), ...r.queue.map((q) => q.id)]), ...g.fleets.flatMap((f) => [f.id, ...f.ships.map((s) => s.id)])];

  await check('40 connected regions retain all 12 legacy IDs; every added coastal port has a cited record', () => {
    assert.deepEqual(LEGACY_REGION_ORDER, ['myeongnyang', 'yeosu', 'noryang', 'sacheon', 'hansan', 'geoje', 'angolpo', 'busan', 'tsushima', 'nagoya', 'shandong', 'liaodong']);
    assert.deepEqual(REGION_ORDER.slice(0, 12), LEGACY_REGION_ORDER);
    assert.equal(REGION_ORDER.length, 40); assert.equal(new Set(REGION_ORDER).size, 40); assert.equal(KOREA_COAST.length, 36);
    // Appended, never reordered: battle seeds use the index in this list.
    assert.deepEqual(REGION_ORDER.slice(12, 25), ['nokdo', 'balpo', 'bangdap', 'dangpo', 'danghangpo', 'gabaeryang', 'yeongdeungpo', 'yulpo', 'jangmunpo', 'jepo', 'cheonseongpo', 'dadaepo', 'mokpo']);
    const reached = new Set(['yeosu']), todo = ['yeosu'];
    while (todo.length) for (const lane of LANES[todo.shift()]) if (!reached.has(lane.to)) { reached.add(lane.to); todo.push(lane.to); }
    assert.equal(reached.size, 40);
    for (const id of REGION_ORDER) {
      assert.equal(new Set(LANES[id].map((l) => l.to)).size, LANES[id].length, `${id}: duplicate lane`);
      for (const lane of LANES[id]) assert(LANES[lane.to].some((back) => back.to === id && back.turns === lane.turns), `${id}: one-way lane`);
    }
    for (const id of ADDED_PORTS) {
      assert(REGIONS[id].korea); assert.equal(REGIONS[id].value, 1); assert(REGIONS[id].source?.title);
      assert.equal(new URL(REGIONS[id].source.url).protocol, 'https:');
    }
    // The second expansion: each new port has two to four lanes, the Busan east-coast chain reaches the rest only through Busan,
    // and a parent is listed before its child so a migrated save always finds the parent's owner.
    for (const id of ADDED_PORTS.slice(13)) {
      assert(LANES[id].length >= 2 && LANES[id].length <= 4, `${id}: ${LANES[id].length} lanes`);
      assert(ADDED_PORTS.indexOf(PORT_EXPANSION_PARENT[id]) < ADDED_PORTS.indexOf(id), `${id}: parent after child`);
    }
    for (const id of ['gijang', 'seosaengpo', 'ulsan']) for (const lane of LANES[id]) assert(['busan', 'gijang', 'seosaengpo', 'ulsan'].includes(lane.to), `${id}: lane to ${lane.to}`);
    const holds = (f) => ADDED_PORTS.filter((id) => START.owners[id] === f).length;
    assert.deepEqual([holds('joseon'), holds('japan')], [16, 12]);
  });

  await check('new ports have real income, standing garrisons, working shipyards and finite campaign upkeep', () => {
    const g = newGrand('joseon', 512);
    for (const id of ADDED_PORTS) {
      const r = g.regions[id];
      assert(economy.regionIncome(g, id) > 0, id);
      assert.equal(r.garrison.length, economy.garrisonCap(id, r), id);
      assert(r.garrison.every((s) => s.kind === economy.GARRISON_KIND[r.owner] && s.hull === 1 && s.crew === 1 && s.supply === 1), id);
      if (r.buildings.some((b) => b.kind === 'shipyard')) {
        const kind = economy.GARRISON_KIND[r.owner];
        const gold = g.factions[r.owner].gold;
        assert(orders.orderRecruit(g, id, kind).ok, id);
        assert(g.factions[r.owner].gold < gold); assert.equal(r.queue.length, 1);
      }
    }
    for (const f of ['joseon', 'japan', 'ming']) assert(Number.isFinite(economy.factionUpkeep(g, f)));
  });

  await check('a fleet really sails Nokdo → Balpo → Bangdap over two closing turns', () => {
    // One lane a turn is the lane rules'; under the march rules the voyage is measured in km (test-grand-march).
    const g = newGrand('joseon', 515);
    delete g.march;
    const fl = g.fleets.find((f) => f.faction === 'joseon');
    g.fleets = [fl]; fl.at = 'nokdo'; fl.from = 'nokdo';
    assert.deepEqual(world.findRoute(g, 'joseon', 'nokdo', 'bangdap'), { path: ['balpo', 'bangdap'], turns: 2 });
    assert(orders.orderMove(g, fl.id, 'bangdap').ok);
    const hulls = fl.ships.map((s) => s.id);
    endTurn(g); assert.equal(fl.at, 'balpo'); assert.deepEqual(fl.route, ['bangdap']);
    endTurn(g); assert.equal(fl.at, 'bangdap'); assert.deepEqual(fl.route, []); assert.deepEqual(fl.ships.map((s) => s.id), hulls);
  });

  await check('new port garrisons dispatch with existing fleets, retain exact ship state, and fail atomically across hostile intermediate ports', () => {
    const g = newGrand('joseon', 516);
    const fl = g.fleets.find((f) => f.faction === 'joseon');
    const units = structuredClone([...g.regions.nokdo.garrison, ...g.regions.balpo.garrison]);
    assert(dispatch.orderDispatch(g, [fl.id], ['nokdo', 'balpo'], 'bangdap', 'joseon').ok);
    assert.equal(g.regions.nokdo.garrison.length, 0); assert.equal(g.regions.balpo.garrison.length, 0);
    const launched = g.fleets.filter((f) => ['nokdo', 'balpo'].includes(f.at));
    assert.equal(launched.length, 2); assert.deepEqual(launched.flatMap((f) => f.ships), units);
    assert.deepEqual(fl.route, ['bangdap']);
    const before = JSON.stringify(g);
    assert(!dispatch.orderDispatch(g, [fl.id], ['bangdap'], 'tsushima', 'joseon').ok);
    assert.equal(JSON.stringify(g), before);
  });

  await check('legacy migration preserves all existing campaign fields and ID uniqueness; repeat loads add nothing', () => {
    const g = legacySave();
    g.regions.yeosu.owner = 'japan'; g.regions.geoje.owner = null;
    g.regions.yeosu.queue.push({ id: 'q90000', kind: 'panokseon', left: 2, total: 4, paidGold: 290 });
    g.fleets[0].route = ['noryang', 'hansan']; g.fleets[0].ships[0].hull = 0.47; g.fleets[0].ships[0].crew = 0.62;
    g.pending.push({ id: 'legacy-contact', regionId: 'hansan', attacker: 'japan', defender: 'joseon', attackerFleets: [g.fleets.find((f) => f.faction === 'japan').id], defenderFleets: [g.fleets[1].id], player: true });
    g.phase = 'battles'; g.turn = 14; g.nextId = 0;
    const before = JSON.stringify(legacyFields(g));
    assert.equal(migrateGrandRegions(g), ADDED_PORTS.length);
    assert.equal(JSON.stringify(legacyFields(g)), before);
    for (const id of ADDED_PORTS) assert.equal(g.regions[id].owner, g.regions[PORT_EXPANSION_PARENT[id]].owner, id);
    assert.equal(g.regions.gabaeryang.garrison.length, 0);
    assert(g.regions.balpo.garrison.every((s) => s.kind === economy.GARRISON_KIND.japan));
    const ids = idsOf(g); assert.equal(new Set(ids).size, ids.length); assert(g.nextId > 90000);
    const expanded = JSON.stringify(g); assert.equal(migrateGrandRegions(g), 0); assert.equal(JSON.stringify(g), expanded);
    const reloaded = JSON.parse(expanded); assert.equal(migrateGrandRegions(reloaded), 0); assert.equal(JSON.stringify(reloaded), expanded);
  });

  await check('migrated ports join the starting holdings of a save with growth rules, so they never count as progress toward the objective', () => {
    for (const keep of [0, 13]) {
      const g = legacySave();
      if (keep) for (const id of ADDED_PORTS.slice(0, keep)) g.regions[id] = newGrand('joseon', 591).regions[id];
      // What the older game wrote: the opening holdings of the regions that save had, counted by value.
      const held = (f) => Object.entries(g.regions).filter(([, r]) => r.owner === f).reduce((sum, [id]) => sum + REGIONS[id].value, 0);
      g.victoryRules = { kind: 'growth-v1', initialControl: { joseon: held('joseon'), japan: held('japan'), ming: held('ming') }, target: 9 };
      const target = g.victoryRules.target, before = structuredClone(g.victoryRules.initialControl);
      assert.equal(migrateGrandRegions(g), ADDED_PORTS.length - keep);
      for (const f of ['joseon', 'japan', 'ming']) {
        assert.equal(g.victoryRules.initialControl[f], turn.controlValue(g, f), `${keep}: ${f} opening holding`);
        assert(g.victoryRules.initialControl[f] >= before[f]);
        assert.equal(turn.objectiveProgress(g, f).have, 0, `${keep}: ${f} starts at zero progress`);
      }
      assert.equal(g.victoryRules.target, target);
      // Taking an enemy port afterwards still counts.
      const free = ADDED_PORTS.find((id) => g.regions[id].owner === 'japan');
      g.regions[free].owner = 'joseon';
      assert.equal(turn.objectiveProgress(g, 'joseon').have, REGIONS[free].value);
    }
    const plain = legacySave(); migrateGrandRegions(plain); assert.equal(plain.victoryRules, undefined);
  });

  await check('partially expanded saves add only missing ports, while incomplete legacy maps are never repaired', () => {
    const g = legacySave();
    const kept = { owner: 'ming', buildings: [], garrison: [roster.spawnShip(g, 'mingsmall', 0.3, 0.4)], queue: [], unrest: 2 };
    g.regions.nokdo = kept;
    assert.equal(migrateGrandRegions(g), ADDED_PORTS.length - 1); assert.equal(g.regions.nokdo, kept);
    const broken = legacySave(); delete broken.regions.yeosu;
    const before = JSON.stringify(broken); assert.equal(migrateGrandRegions(broken), 0); assert.equal(JSON.stringify(broken), before);
    assert.equal(migrateGrandRegions(null), 0); assert.equal(migrateGrandRegions({ version: 1 }), 0);
  });

  await check('production campaign load accepts an old twelve-region save before current-map validation', async () => {
    const old = legacySave(); const ships = old.fleets.map((f) => f.ships); const rng = structuredClone(old.rng);
    saved.set('imjin.grand.v1', JSON.stringify(old));
    const { useGrand } = await load('/src/campaign/grand.ts');
    const loaded = useGrand.getState().grand;
    assert(loaded, 'the previous campaign must survive load()');
    assert.equal(Object.keys(loaded.regions).length, 40); assert.deepEqual(loaded.fleets.map((f) => f.ships), ships); assert.deepEqual(loaded.rng, rng);
  });

  await check('every new region, blurb, capture point, generated fleet and battle title displays in English', () => {
    i18n.setLang('en');
    for (const id of ADDED_PORTS) {
      const def = REGIONS[id];
      const texts = [def.name, def.blurb, `${def.name} 해전`, `${def.name} 신규 함대`, `${def.name} 출동 함대`, ...REGION_MAPS[id].points.map((p) => p.name), REGIONS[id].source.title];
      for (const text of texts) assert(!/[가-힣]/.test(names.tName(text)), `${id}: untranslated ${text}`);
    }
    i18n.setLang('ko');
  });

  // Region windows are read from public/terrain, so they are built up front.
  const heightmaps = new Map();
  for (const id of regions.REGION_ORDER) heightmaps.set(`${REGION_MAPS[id].terrain.seed}:${REGION_MAPS[id].terrain.size}`, await groundHeights(load, REGION_MAPS[id].terrain));
  function landOf(spec, axis) {
    const key = `${spec.seed}:${spec.size}`;
    if (!heightmaps.has(key)) heightmaps.set(key, terrain.generateHeightmap(spec));
    const h = heightmaps.get(key), ca = Math.cos(axis), sa = Math.sin(axis), { size, res } = spec;
    return (wx, wz) => {
      const sx = wx * ca + wz * sa, sz = -wx * sa + wz * ca;
      const fx = ((sx + size / 2) / size) * res - 0.5, fz = ((sz + size / 2) / size) * res - 0.5;
      const x = Math.max(0, Math.min(res - 2, Math.floor(fx))), z = Math.max(0, Math.min(res - 2, Math.floor(fz)));
      const tx = Math.max(0, Math.min(1, fx - x)), tz = Math.max(0, Math.min(1, fz - z));
      return (h[z * res + x] + (h[z * res + x + 1] - h[z * res + x]) * tx) * (1 - tz) + (h[(z + 1) * res + x] + (h[(z + 1) * res + x + 1] - h[(z + 1) * res + x]) * tx) * tz;
    };
  }
  await check('all new port battles spawn persistent ships in deep water and preserve shore levels at rotated terrain anchors', () => {
    for (const id of ADDED_PORTS) {
      const g = newGrand('joseon', 519);
      const jp = g.fleets.find((f) => f.faction === 'japan'), jo = g.fleets.find((f) => f.faction === 'joseon');
      jp.ships = jp.ships.slice(0, 4); jo.ships = jo.ships.slice(0, 4);
      g.regions[id].owner = 'joseon';
      g.regions[id].buildings = [{ kind: 'camp', level: 3, upgradeLeft: 0, hp: 1 }, { kind: 'shipyard', level: 2, upgradeLeft: 0, hp: 1 }, { kind: 'battery', level: 2, upgradeLeft: 0, hp: 1 }];
      const c = { id: `port-${id}`, regionId: id, attacker: 'japan', defender: 'joseon', attackerFleets: [jp.id], defenderFleets: [jo.id], player: true };
      g.pending = [c]; g.phase = 'battles';
      const rb = bridge.describeBattle(g, c.id), map = REGION_MAPS[id];
      assert.equal(rb.mapId, id); assert.equal(rb.options.maxShips, Infinity); assert.equal(rb.options.cap, Infinity);
      const axis = map.axis * 0.5 + 0.3, land = landOf(map.terrain, axis);
      const { battle, conquest } = spawn.buildGrandConquest(rb, land, axis);
      const environment = coast.regionEnvironment(id, rb.seed), info = spawn.grandInfo(rb), wind = environmentModule.environmentWind(environment, axis);
      assert.equal(info.sky, environment.sky); assert.equal(info.night, environment.night); assert.equal(info.sea, environment.sea);
      assert.equal(battle.night, environment.night); assert.equal(battle.visibilityScale, environment.visibility);
      assert.equal(battle.windAngle, wind.angle); assert.equal(battle.windDrift, wind.drift); assert.equal(battle.flow?.spec, environment.current);
      assert.deepEqual(battle.ships.map((s) => s.campaignId).sort(), [...rb.attacker.ships, ...rb.defender.ships].map((s) => s.campaignId).sort(), id);
      assert(battle.ships.every((s) => land(s.x, s.z) <= -4), `${id}: ship aground`);
      assert(conquest.points.every((p) => land(p.x, p.z) <= -6), `${id}: point on land`);
      assert(conquest.homeOf(0).slots.length >= 3 && conquest.homeOf(1).slots.length >= 3, `${id}: no construction space`);
      assert.deepEqual(conquest.homeOf(1).buildings.filter(Boolean).map((w) => [w.kind, w.level]).sort(), [['camp', 3], ['shipyard', 2], ['battery', 2]].sort(), id);
      assert.deepEqual(spawn.worksAfter(rb, conquest).razed, []);
      assert(map.current?.vortices?.length > 0, `${id}: no designed coastal eddies`);
      for (let step = 0; step < 60; step++) battle.step(1 / 30);
      assert(battle.ships.every((s) => Number.isFinite(s.x) && Number.isFinite(s.z)), id);
      assert.equal(battle.ships.filter((s) => s.campaignId).length, rb.attacker.ships.length + rb.defender.ships.length);
      battle.flow?.texture.dispose();
    }
  });

  console.log(`${failures ? 'FAIL' : 'PASS'} expanded coastal campaign (${failures} failed)`);
} finally {
  await server.close();
}
process.exitCode = failures ? 1 : 0;
