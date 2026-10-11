// Real construction, economy and ownership regressions for large casual naval battles.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
function check(name, run) { try { run(); console.log('ok   ' + name); } catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); } }
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
try {
  const { Battle, SIM_DT } = await server.ssrLoadModule('/src/sim/battle.ts');
  const { Conquest, BUILDINGS, upgradeCost, upgradeTime, buildingHp, ROSTER, DEFAULT_OPTIONS, RANKED_OPTIONS } = await server.ssrLoadModule('/src/sim/conquest.ts');
  const { COMPETITIVE_PROFILE } = await server.ssrLoadModule('/src/sim/competitive.ts');
  const { buildConquest, autoFleet, CONQUEST_ORDER } = await server.ssrLoadModule('/src/sim/maps.ts');
  const { buildBattle, sanitizeChoice, DEFAULT_CHOICE, choiceKey } = await server.ssrLoadModule('/server/battles.ts');
  const { newGrand } = await server.ssrLoadModule('/src/sim/grand/turn.ts');
  const { describeContact, outcomeOfBattle, applyBattleResult, BATTLE_SHIP_CAP } = await server.ssrLoadModule('/src/sim/grand/bridge.ts');
  const { buildGrandConquest, shipOutcomes } = await server.ssrLoadModule('/src/sim/grand/spawn.ts');
  const { SHIP_SPECS } = await server.ssrLoadModule('/src/sim/catalog.ts');
  const { SCENARIOS, buildScenario } = await server.ssrLoadModule('/src/sim/scenarios.ts');
  const { REGION_MAPS } = await server.ssrLoadModule('/src/sim/grand/coast.ts');
  const { generateHeightmap } = await server.ssrLoadModule('/src/terrain/generate.ts');
  const { encodeSnapshot, decodeSnapshot } = await server.ssrLoadModule('/src/net/protocol.ts');
  const { Strategist } = await server.ssrLoadModule('/src/sim/strategy.ts');
  function terrainLand(spec) {
    const heights = generateHeightmap(spec), { size, res } = spec;
    return (x, z) => {
      const fx = ((x + size / 2) / size) * res - 0.5, fz = ((z + size / 2) / size) * res - 0.5;
      const x0 = Math.max(0, Math.min(res - 2, Math.floor(fx))), z0 = Math.max(0, Math.min(res - 2, Math.floor(fz)));
      const tx = Math.max(0, Math.min(1, fx - x0)), tz = Math.max(0, Math.min(1, fz - z0));
      const a = heights[z0 * res + x0], b = heights[z0 * res + x0 + 1], c = heights[(z0 + 1) * res + x0], d = heights[(z0 + 1) * res + x0 + 1];
      return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    };
  }
  const land = (_x, z) => Math.abs(z) > 320 ? 3 : -50;
  const map = [
    { name: 'west', hanja: '', x: -1600, z: 0, r: 250, value: 1, home: 0 },
    { name: 'east', hanja: '', x: 1600, z: 0, r: 250, value: 1, home: 1 },
    { name: 'centre', hanja: '', x: 0, z: 0, r: 250, value: 2 },
  ];
  function fixture(options = {}, faction = 'joseon') {
    const b = new Battle(77123, COMPETITIVE_PROFILE);
    const c = new Conquest(map, [
      { slot: 0, name: 'west', faction, team: 'joseon', human: true },
      { slot: 1, name: 'east', faction, team: 'japan', human: true },
    ], land, { ...DEFAULT_OPTIONS, ...options });
    b.land = land; b.rules = c; b.humans = new Set([0, 1]);
    c.players.forEach((p) => { p.funds = 100000; });
    c.points.forEach((p) => { p.buildings = p.buildings.map((bd) => bd?.kind === 'battery' ? null : bd); });
    return { b, c, p: c.homeOf(0) };
  }
  function buildFinished(f, kind) {
    assert.ok(f.c.build(f.b, 0, f.p.id, kind));
    const slot = f.p.buildings.findIndex((bd) => bd?.kind === kind);
    f.c.step(f.b, f.c.buildTime(kind));
    assert.equal(f.p.buildings[slot].progress, 1);
    return slot;
  }
  function upgradeFinished(f, slot) {
    const time = f.c.upgradeDuration(f.p.buildings[slot].kind, f.p.buildings[slot].level);
    assert.ok(f.c.upgrade(f.b, 0, f.p.id, slot));
    f.c.step(f.b, time);
  }
  function addShips(f, count, owner = 0) {
    const pl = f.c.player(owner), sq = f.b.addSquadron(pl.team, '', '', '', '', owner);
    const kind = ROSTER[pl.faction].at(-1);
    for (let i = 0; i < count; i++) {
      const s = f.b.addShip(kind, (owner ? 2500 : -2500) + i * 40, 0, 0, '', sq);
      s.order = { type: 'hold' }; s.fireMode = 'hold';
    }
    f.b.grid.rebuild(f.b.ships);
    return kind;
  }

  check('ranked-size conquest retains the original 36 ship cap, income, slots and one slipway', () => {
    const f = fixture(RANKED_OPTIONS);
    assert.equal(f.c.shipLimit(0), 36); assert.equal(f.p.slots.length, 4); assert.equal(f.c.points[2].slots.length, 3);
    assert.equal(f.c.yardSlots(f.p), 1);
    assert.equal(f.c.canBuild(0, f.p.id, 'camp'), false);
    assert.equal(f.c.upgrade(f.b, 0, f.p.id, 0), false);
    assert.equal(f.c.setRally(0, f.p.id, 0, 0), false);
    f.c.step(f.b, 1); assert.equal(f.c.player(0).income, 105);
    addShips(f, 36); assert.equal(f.c.canRecruit(f.b, 0, f.p.id, 'hyeopseon'), false);
  });
  check('every navy receives the same faster work factor and ranked retains original ship and building times', () => {
    for (const faction of ['joseon', 'japan', 'ming']) {
      const ordinary = fixture({}, faction), ranked = fixture(RANKED_OPTIONS, faction);
      for (const kind of ROSTER[faction]) {
        close(ordinary.c.recruitTime(kind), Math.round(ordinary.c.shipSpec(kind).build * 0.36 * 10) / 10);
        close(ranked.c.recruitTime(kind), ranked.c.shipSpec(kind).build);
        assert.ok(ordinary.c.recruitIn(ordinary.b, 0, ordinary.p.id, kind));
        assert.ok(ranked.c.recruitIn(ranked.b, 0, ranked.p.id, kind));
        close(ordinary.p.queue.at(-1).total, ordinary.c.recruitTime(kind));
        close(ranked.p.queue.at(-1).total, ranked.c.shipSpec(kind).build);
      }
      for (const kind of Object.keys(BUILDINGS)) {
        close(ordinary.c.buildTime(kind), BUILDINGS[kind].time * 0.36);
        close(ranked.c.buildTime(kind), BUILDINGS[kind].time);
        close(ordinary.c.upgradeDuration(kind, 1), upgradeTime(kind, 1) * 0.36);
      }
      assert.equal(ordinary.c.yardSlots(ordinary.p), 2);
      assert.equal(ranked.c.yardSlots(ranked.p), 1);
    }
  });
  check('imported old ship, building and upgrade work keeps its ordered duration and progress', () => {
    const f = fixture(), st = f.c.state(), kind = 'panokseon';
    st.points[0].queue = [{ kind, left: 27, total: 54 }];
    st.points[0].buildings[1] = { kind: 'dock', hp: BUILDINGS.dock.hp, progress: 0.5, level: 1, upgradeLeft: 0, upgradeTotal: 0 };
    st.points[0].buildings[0].upgradeLeft = 20; st.points[0].buildings[0].upgradeTotal = 40;
    f.c.applyState(st);
    assert.deepEqual(f.p.queue[0], { kind, left: 27, total: 54 });
    f.c.step(f.b, 1);
    close(f.p.queue[0].left, 26); close(f.p.queue[0].total, 54);
    close(f.p.buildings[1].progress, 0.5 + 1 / 35);
    close(f.p.buildings[0].upgradeLeft, 19); close(f.p.buildings[0].upgradeTotal, 40);
    const funds = f.c.player(0).funds;
    assert.ok(f.c.cancel(0, f.p.id, 0));
    assert.equal(f.c.player(0).funds, funds + Math.round(f.c.shipSpec(kind).cost * (0.5 + 0.5 * 26 / 54)));
  });
  check('ordinary camps favor crews and docks favor hulls while ranked dock recovery stays unchanged', () => {
    for (const faction of ['joseon', 'japan', 'ming']) for (const ranked of [false, true]) {
      const f = fixture(ranked ? RANKED_OPTIONS : {}, faction), kind = ROSTER[faction].at(-1);
      buildFinished(f, 'dock');
      const s = f.b.addShip(kind, f.p.x, f.p.z, 0, '', f.b.addSquadron('joseon', '', '', '', '', 0));
      s.hull = s.spec.hull / 2; s.roles = s.roles.map((n) => n / 2); s.crew = s.spec.crew / 2; s.lastHit = -20;
      f.b.grid.rebuild(f.b.ships); f.c.step(f.b, 1);
      close(s.hull / s.spec.hull, 0.5 + (ranked ? 0.006 : 0.01));
      close(s.crew / s.spec.crew, 0.5 + (ranked ? 0.004 : 0.002));
      if (!ranked) {
        buildFinished(f, 'camp'); s.hull = s.spec.hull / 2; s.roles = s.roles.map((n) => n * (s.spec.crew / 2) / s.crew); s.crew = s.spec.crew / 2;
        f.c.step(f.b, 1); close(s.hull / s.spec.hull, 0.51); close(s.crew / s.spec.crew, 0.51);
      }
    }
  });
  check('all three factions can construct a real fleet beyond 36 ships with the same expanded capacity', () => {
    for (const faction of ['joseon', 'japan', 'ming']) {
      const f = fixture({}, faction), kind = addShips(f, 36), total = f.c.shipSpec(kind).build;
      assert.equal(f.c.shipLimit(0), Infinity); assert.equal(f.p.slots.length, 6); assert.equal(f.c.points[2].slots.length, 5);
      for (let n = 0; n < 4; n++) {
        assert.ok(f.c.recruitIn(f.b, 0, f.p.id, kind));
        f.c.step(f.b, total + 21);
      }
      assert.equal(f.b.ships.filter((s) => s.owner === 0).length, 40);
      assert.equal(f.c.fleet(f.b, 0).count, 40); assert.equal(f.p.queue.length, 0);
    }
  });
  check('completed camps and upgrades improve construction without restricting ordinary fleet capacity', () => {
    const f = fixture();
    assert.ok(f.c.build(f.b, 0, f.p.id, 'camp'));
    const slot = f.p.buildings.findIndex((bd) => bd?.kind === 'camp');
    assert.equal(f.c.shipLimit(0), Infinity); assert.equal(f.c.constructionRate(0), 1); assert.equal(f.c.canBuild(0, f.p.id, 'camp'), false);
    f.c.step(f.b, f.c.buildTime('camp') / 2); assert.equal(f.c.constructionRate(0), 1);
    assert.equal(f.c.canUpgrade(0, f.p.id, slot), false);
    f.c.step(f.b, f.c.buildTime('camp') / 2); assert.equal(f.c.constructionRate(0), 1.1);
    const funds = f.c.player(0).funds;
    assert.ok(f.c.upgrade(f.b, 0, f.p.id, slot));
    assert.equal(f.c.player(0).funds, funds - upgradeCost('camp', 1));
    assert.equal(f.c.upgrade(f.b, 0, f.p.id, slot), false);
    f.c.step(f.b, f.c.upgradeDuration('camp', 1) - 1); assert.equal(f.c.constructionRate(0), 1.1); assert.equal(f.p.buildings[slot].level, 1);
    f.c.step(f.b, 1); assert.equal(f.c.constructionRate(0), 1.2); assert.equal(f.p.buildings[slot].level, 2);
    assert.equal(f.p.buildings[slot].hp, buildingHp('camp', 2));
    upgradeFinished(f, slot); assert.equal(f.c.constructionRate(0), 1.3); assert.equal(f.c.shipLimit(0), Infinity);
    assert.equal(f.c.canUpgrade(0, f.p.id, slot), false);
  });
  check('only ranked queued ships reserve capacity; ordinary recruitment and camp loss never cap a fleet', () => {
    const ranked = fixture(RANKED_OPTIONS), rankedKind = addShips(ranked, 35);
    assert.ok(ranked.c.recruitIn(ranked.b, 0, ranked.p.id, rankedKind));
    assert.equal(ranked.c.fleet(ranked.b, 0).count, 36); assert.equal(ranked.c.canRecruit(ranked.b, 0, ranked.p.id, rankedKind), false);
    assert.ok(ranked.c.cancel(0, ranked.p.id, 0)); assert.ok(ranked.c.recruitIn(ranked.b, 0, ranked.p.id, rankedKind));
    const f = fixture(), kind = addShips(f, 300), slot = buildFinished(f, 'camp');
    assert.ok(f.c.recruitIn(f.b, 0, f.p.id, kind));
    const before = f.b.ships.length;
    assert.ok(f.c.demolish(f.b, 0, f.p.id, slot)); assert.equal(f.c.shipLimit(0), Infinity);
    f.c.step(f.b, f.c.shipSpec(kind).build + 100);
    assert.equal(f.b.ships.length, before + 1); assert.equal(f.p.queue.length, 0);
    assert.equal(f.c.canRecruit(f.b, 0, f.p.id, kind), true);
  });
  check('upgraded yards build ships concurrently and cancel every active job at its actual progress', () => {
    const f = fixture(), kind = 'hyeopseon', total = f.c.recruitTime(kind), cost = f.c.shipSpec(kind).cost;
    upgradeFinished(f, 0); assert.equal(f.c.yardSlots(f.p), 3);
    for (let i = 0; i < 4; i++) assert.ok(f.c.recruitIn(f.b, 0, f.p.id, kind));
    assert.equal(f.c.queueWorkers(f.p), 3); f.c.step(f.b, total / 2);
    for (let i = 0; i < 3; i++) close(f.p.queue[i].left, total / 2);
    close(f.p.queue[3].left, total);
    const funds = f.c.player(0).funds;
    assert.ok(f.c.cancel(0, f.p.id, 1)); assert.equal(f.c.player(0).funds, funds + Math.round(cost * 0.75));
    assert.ok(f.c.recruitIn(f.b, 0, f.p.id, kind));
    f.c.step(f.b, total / 2);
    assert.equal(f.b.ships.length, 2); assert.equal(f.p.queue.length, 2);
    f.c.step(f.b, total + 21); assert.equal(f.b.ships.length, 4); assert.equal(f.p.queue.length, 0);
    upgradeFinished(f, 0); assert.equal(f.c.yardSlots(f.p), 4);
    for (let i = 0; i < 4; i++) assert.ok(f.c.recruitIn(f.b, 0, f.p.id, kind));
    f.c.step(f.b, total + 21); assert.equal(f.b.ships.length, 8);
  });
  check('rally coordinates are authorized water orders for real launched ships and survive network copies', () => {
    const f = fixture();
    assert.equal(f.c.setRally(1, f.p.id, 200, 0), false);
    for (const [x, z] of [[NaN, 0], [0, Infinity], [1e8, 0], [0, 500]]) assert.equal(f.c.setRally(0, f.p.id, x, z), false);
    assert.ok(f.c.setRally(0, f.p.id, 200, 80));
    assert.ok(f.c.recruitIn(f.b, 0, f.p.id, 'hyeopseon'));
    f.c.step(f.b, f.c.shipSpec('hyeopseon').build + 21);
    assert.deepEqual(f.b.ships[0].order, { type: 'move', x: 200, z: 80 });
    const slot = buildFinished(f, 'camp'); assert.ok(f.c.upgrade(f.b, 0, f.p.id, slot)); f.c.step(f.b, 7);
    const remote = fixture(); remote.c.applyState(f.c.state());
    assert.deepEqual(remote.c.state(), f.c.state()); assert.notEqual(remote.p.rally, f.p.rally);
    remote.p.rally.x = 300; assert.equal(f.p.rally.x, 200);
  });
  check('parallel yards never stack newly launched ships when an adjacent slipway falls on dry land', () => {
    const f = fixture(); upgradeFinished(f, 0);
    const spawn = { ...f.p.spawn };
    f.c.land = (x, z) => Math.abs(x - spawn.x) < 18 && Math.abs(z - spawn.z) < 18 ? -50 : 3;
    for (let n = 0; n < 2; n++) assert.ok(f.c.recruitIn(f.b, 0, f.p.id, 'hyeopseon'));
    f.c.step(f.b, f.c.shipSpec('hyeopseon').build + 21);
    assert.equal(f.b.ships.length, 1); assert.equal(f.p.queue.length, 1);
    // Once the first launch clears the single wet berth, the second leaves instead of overlapping the first.
    f.b.ships[0].x += 100; f.b.grid.rebuild(f.b.ships); f.c.step(f.b, 0.1);
    assert.equal(f.b.ships.length, 2); assert.equal(f.p.queue.length, 0);
  });
  check('capture clears the prior owner rally point and slipways; foreign and invalid commands never spend funds', () => {
    const f = fixture(), money = f.c.player(0).funds;
    assert.equal(f.c.upgrade(f.b, 1, f.p.id, 0), false);
    for (const value of [-1, 0.5, NaN, Infinity, 999]) {
      assert.equal(f.c.canBuild(0, value, 'camp'), false);
      assert.equal(f.c.canRecruit(f.b, 0, value, 'hyeopseon'), false);
      assert.equal(f.c.canUpgrade(0, f.p.id, value), false);
    }
    f.c.player(0).funds = 0; assert.equal(f.c.upgrade(f.b, 0, f.p.id, 0), false);
    f.c.player(0).funds = money; assert.ok(f.c.setRally(0, f.p.id, 200, 0));
    assert.ok(f.c.recruitIn(f.b, 0, f.p.id, 'hyeopseon'));
    f.c.release(f.b, f.p); assert.equal(f.p.rally, undefined); assert.equal(f.p.queue.length, 0);
    assert.equal(f.c.upgrade(f.b, 0, f.p.id, 0), false);
    f.c.take(f.b, f.p, 1); assert.equal(f.c.shipLimit(0), Infinity); assert.equal(f.p.owner, 1);
  });
  check('upgrade cancellation cannot mint funds, and damaged upgrades preserve prior damage', () => {
    const f = fixture(), initial = f.c.player(0).funds;
    assert.ok(f.c.upgrade(f.b, 0, f.p.id, 0));
    assert.ok(f.c.cancelUpgrade(f.b, 0, f.p.id, 0));
    assert.equal(f.c.player(0).funds, initial - upgradeCost('shipyard', 1) + Math.round(upgradeCost('shipyard', 1) * 0.7));
    assert.equal(f.c.cancelUpgrade(f.b, 0, f.p.id, 0), false);
    f.p.buildings[0].hp -= 80; upgradeFinished(f, 0);
    assert.equal(f.p.buildings[0].hp, buildingHp('shipyard', 2) - 80);
  });
  check('leveled magazines, docks and beacons have real economy, ammunition, repair and vision effects', () => {
    const f = fixture(), mag = buildFinished(f, 'magazine'), dock = buildFinished(f, 'dock'), beacon = buildFinished(f, 'beacon');
    const kind = addShips(f, 1), s = f.b.ships[0];
    s.x = f.p.x; s.z = f.p.z; s.hull = s.spec.hull / 2; s.roles = s.roles.map((n) => n / 2); s.crew = s.spec.crew / 2; s.supply = 0;
    s.lastHit = -20; f.b.grid.rebuild(f.b.ships);
    f.c.step(f.b, 1); assert.equal(f.c.player(0).income, Math.round((60 + 45 * 1.3) * 3));
    const hull1 = s.hull, crew1 = s.crew; close(s.supply, 0.01);
    assert.equal(f.c.held('joseon'), 1.5);
    upgradeFinished(f, mag); upgradeFinished(f, dock); upgradeFinished(f, beacon);
    s.hull = s.spec.hull / 2; s.roles = s.roles.map(() => s.spec.crew / 8); s.crew = s.spec.crew / 2; s.supply = 0;
    f.c.step(f.b, 1); assert.equal(f.c.player(0).income, Math.round((60 + 45 * 1.6) * 3));
    close(s.hull - s.spec.hull / 2, (hull1 - s.spec.hull / 2) * 2);
    close(s.crew - s.spec.crew / 2, (crew1 - s.spec.crew / 2) * 2); close(s.supply, 0.02);
    assert.equal(f.c.held('joseon'), 2);
    const foe = f.b.addShip(kind, f.p.x + 2100, f.p.z, 0, '', f.b.addSquadron('japan', '', '', '', '', 1));
    f.b.night = true; f.b.grid.rebuild(f.b.ships); f.c.step(f.b, 0.1); assert.equal(foe.revealed, 1.5);
  });
  check('naval camps replenish actual crew stations and speed construction up to a symmetric 60% bonus', () => {
    for (const faction of ['joseon', 'japan', 'ming']) {
      const f = fixture({}, faction), slot = buildFinished(f, 'camp'), kind = ROSTER[faction].at(-1);
      const s = f.b.addShip(kind, f.p.x, f.p.z, 0, '', f.b.addSquadron('joseon', '', '', '', '', 0));
      s.roles = s.roles.map((n) => n / 2); s.crew = s.spec.crew / 2; s.lastHit = -20;
      f.b.grid.rebuild(f.b.ships); assert.ok(f.c.recruitIn(f.b, 0, f.p.id, kind));
      const beforeCrew = s.crew, total = f.p.queue[0].total;
      f.c.step(f.b, 1); close(s.crew - beforeCrew, s.spec.crew * 0.008); close(s.roles.reduce((a, n) => a + n, 0), s.crew);
      close(f.p.queue[0].left, total - 1.1);
      s.lastHit = f.b.time; const underFireCrew = s.crew; f.c.step(f.b, 1); close(s.crew, underFireCrew);
      f.c.cancel(0, f.p.id, 0); upgradeFinished(f, slot); upgradeFinished(f, slot);
      f.c.points[2].owner = 0; f.c.points[2].hold = 1;
      const extra = { ...f, p: f.c.points[2] }, second = buildFinished(extra, 'camp');
      upgradeFinished(extra, second); upgradeFinished(extra, second); assert.equal(f.c.constructionRate(0), 1.6);
      // A third port cannot exceed the published throughput bound, and the enemy does not share this player's bonus.
      const enemyHome = f.c.homeOf(1); enemyHome.owner = 0; enemyHome.hold = 1;
      const third = { ...f, p: enemyHome }; buildFinished(third, 'camp');
      assert.equal(f.c.constructionRate(0), 1.6); assert.equal(f.c.constructionRate(1), 1);
      assert.equal(f.c.shipLimit(0), Infinity);
    }
  });
  check('computer commanders actually raise and upgrade camps under construction pressure without buying them when underfunded or ranked', () => {
    const f = fixture(), brain = new Strategist(0);
    for (let n = 0; n < 2; n++) assert.ok(f.c.recruitIn(f.b, 0, f.p.id, 'hyeopseon'));
    f.c.player(0).funds = 5000; brain.economy(f.b, f.c);
    const slot = f.p.buildings.findIndex((bd) => bd?.kind === 'camp');
    assert.ok(slot >= 0); assert.equal(f.p.buildings[slot].progress, 0);
    f.c.step(f.b, BUILDINGS.camp.time); addShips(f, 40);
    f.c.player(0).funds = 5000; brain.economy(f.b, f.c);
    assert.equal(f.p.buildings[slot].level, 1); assert.ok(f.p.buildings[slot].upgradeLeft > 0);
    const low = fixture();
    for (let n = 0; n < 2; n++) assert.ok(low.c.recruitIn(low.b, 0, low.p.id, 'hyeopseon'));
    low.c.player(0).funds = 800; new Strategist(0).economy(low.b, low.c);
    assert.ok(low.p.buildings.every((bd) => bd?.kind !== 'camp'));
    const ranked = fixture(RANKED_OPTIONS); addShips(ranked, 35); ranked.c.player(0).funds = 5000;
    new Strategist(0).economy(ranked.b, ranked.c);
    assert.ok(ranked.p.buildings.every((bd) => bd?.kind !== 'camp'));
    assert.ok(ranked.p.buildings.every((bd) => !bd || bd.level === 1 && bd.upgradeLeft === 0));
  });
  check('upgraded batteries add guns and effective damage without changing level-one shore fire', () => {
    const f = fixture(), slot = buildFinished(f, 'battery'), bd = f.p.buildings[slot];
    const spot = f.p.slots[slot];
    const foe = f.b.addShip('atakebune', spot.x + Math.cos(spot.rot) * 120, spot.z + Math.sin(spot.rot) * 120, 0, '', f.b.addSquadron('japan', '', '', '', '', 1));
    f.b.grid.rebuild(f.b.ships); f.b.canSee = () => true;
    bd.reload.fill(0); f.c.step(f.b, 0.1);
    const level1 = f.b.projectiles.filter((p) => p.shooter === 0);
    assert.equal(level1.length, 3); const damage = level1[0].damage;
    foe.x = spot.x + Math.cos(spot.rot) * 200; f.b.grid.rebuild(f.b.ships);
    upgradeFinished(f, slot); f.b.projectiles.length = 0; bd.reload.fill(0); f.c.step(f.b, 0.1);
    assert.equal(f.b.projectiles.length, 4); close(f.b.projectiles[0].damage, damage * 1.15);
  });
  check('the same seed and command sequence produce identical expanded construction and ship state', () => {
    function run() {
      const f = fixture();
      const camp = buildFinished(f, 'camp'); upgradeFinished(f, camp); upgradeFinished(f, 0);
      assert.ok(f.c.setRally(0, f.p.id, 300, 0));
      for (let k = 0; k < 5; k++) assert.ok(f.c.recruitIn(f.b, 0, f.p.id, 'hyeopseon'));
      for (let k = 0; k < 100; k++) f.c.step(f.b, 0.5);
      return { state: f.c.state(), ships: f.b.ships, events: f.b.events };
    }
    assert.deepEqual(run(), run());
  });
  check('ordinary conquest gives every navy equal opening resources on both maps without count/value caps', () => {
    for (const map of CONQUEST_ORDER) for (const faction of ['joseon', 'japan', 'ming']) {
      const fleet = autoFleet(faction, DEFAULT_OPTIONS.musterBudget, COMPETITIVE_PROFILE, Infinity);
      const seats = [0, 1].map((slot) => ({ name: 'seat' + slot, faction, team: slot ? 'japan' : 'joseon', human: true, fleet }));
      const { battle, conquest } = buildConquest(map, seats, land, 991123);
      for (const pl of conquest.players) {
        const own = conquest.fleet(battle, pl.slot);
        assert.equal(own.value + pl.funds, DEFAULT_OPTIONS.musterBudget + DEFAULT_OPTIONS.startFunds);
        assert.equal(conquest.shipLimit(pl.slot), Infinity);
        assert.equal(pl.cap, Infinity);
      }
    }
    const custom = Array.from({ length: 301 }, () => 'kobaya');
    const seats = [0, 1].map((slot) => ({ name: '', faction: 'japan', team: slot ? 'japan' : 'joseon', human: true, fleet: custom }));
    const { battle, conquest } = buildConquest('hallyeo', seats, land, 91, { musterBudget: 100000 });
    for (const pl of conquest.players) {
      const own = conquest.fleet(battle, pl.slot);
      assert.equal(own.count, 301); assert.equal(own.value + pl.funds, 100000 + DEFAULT_OPTIONS.startFunds);
    }
  });
  check('server and client construct identical ordinary battles; only the ranked room flag imposes limits', () => {
    for (const map of CONQUEST_ORDER) {
      const choice = { kind: 'conquest', map, size: 2 };
      const serverBuilt = buildBattle(choice, land, [{ faction: 'ming', team: 'joseon' }, { faction: 'japan', team: 'japan' }], ['A', 'B'], [true, true], 117771);
      const local = buildConquest(map, serverBuilt.seats, land, 117771);
      assert.deepEqual(serverBuilt.conquest.state(), local.conquest.state());
      assert.deepEqual(serverBuilt.battle.ships, local.battle.ships);
      assert.equal(serverBuilt.conquest.shipLimit(0), Infinity);
      assert.equal(choiceKey(choice), `conquest:${map}`);
    }
    const ranked = buildBattle(DEFAULT_CHOICE, land, [{ faction: 'joseon', team: 'joseon' }, { faction: 'ming', team: 'japan' }], ['A', 'B'], [true, true], 1, true);
    assert.equal(ranked.conquest.options.expanded, false); assert.equal(ranked.conquest.options.maxShips, 36);
    assert.equal(ranked.conquest.canBuild(0, 0, 'camp'), false);
    assert.equal(sanitizeChoice({ kind: 'conquest', map: 'hallyeo', size: 2, scale: 'arbitrary' }).scale, undefined);
  });
  check('mixed Japanese gunless escorts and armed hulls decode exact owner gun stages and queued-waypoint counts', () => {
    const f = fixture({}, 'japan'), sq = f.b.addSquadron('joseon', '', '', '', '', 0);
    const ships = ['kobaya', 'atakebune', 'sekibune', 'atakebune'].map((kind, i) => f.b.addShip(kind, i * 50, 0, 0, '', sq));
    ships.forEach((s, i) => { s.orderQueue = Array.from({ length: i + 1 }, (_, n) => ({ type: 'move', x: n * 50, z: 0 })); s.guns.forEach((g, n) => { g.stage = (n + i) % 4; g.t = n + 0.5; g.ammo = 11 + n; }); });
    const decoded = decodeSnapshot(encodeSnapshot(12.5, ships, 0, (s) => f.b.isActive(s)));
    assert.equal(decoded.ships.length, 4); assert.equal(decoded.time, 12.5);
    ships.forEach((s, i) => {
      const frame = decoded.ships[i]; assert.equal(frame.queuedWaypoints, i + 1);
      if (s.guns.length) assert.deepEqual(frame.guns, s.guns.map((g) => ({ stage: g.stage, t: g.t, ammo: g.ammo })));
      else assert.equal(frame.guns, null);
    });
  });
  check('ordinary fleets exceed 150 and 300 ships for every navy and both sides without camps or count caps', () => {
    for (const size of [150, 300]) for (const faction of ['joseon', 'japan', 'ming']) {
      const f = fixture({}, faction);
      for (const owner of [0, 1]) {
        const home = f.c.homeOf(owner), kind = ROSTER[faction].at(-1);
        assert.equal(f.c.shipLimit(owner), Infinity);
        const sq = f.b.addSquadron(owner ? 'japan' : 'joseon', '', '', '', '', owner);
        for (let n = 0; n < size - 1; n++) {
          const s = f.b.addShip(kind, (owner ? 2800 : -2800) + (n % 15) * 65, -260 + Math.floor(n / 15) * 25, 0, '', sq);
          s.fireMode = 'hold'; s.order = { type: 'hold' };
        }
        assert.ok(f.c.recruitIn(f.b, owner, home.id, kind));
        assert.equal(f.c.fleet(f.b, owner).count, size);
        assert.equal(f.c.canRecruit(f.b, owner, home.id, kind), true);
      }
      f.b.grid.rebuild(f.b.ships);
      f.c.step(f.b, Math.max(...ROSTER[faction].map((kind) => f.c.shipSpec(kind).build)) + 21);
      assert.equal(f.b.ships.length, size * 2);
      f.b.step(SIM_DT);
      assert.equal(f.b.ships.filter((s) => s.alive && s.sinking === 0).length, size * 2);
      assert.ok(f.b.ships.every((s) => land(s.x, s.z) < -6));
    }
  });
  check('campaign handoff never omits ships above 120 or 300 and preserves every id, condition and standing work', () => {
    assert.equal(BATTLE_SHIP_CAP, Infinity);
    const g = newGrand('japan', 81199), attack = g.fleets.find((fl) => fl.faction === 'japan'), defend = g.fleets.find((fl) => fl.faction === 'joseon');
    const make = (prefix, kind) => Array.from({ length: 301 }, (_, i) => ({ id: prefix + i, kind, name: prefix + i, hull: 0.8 - i * 0.001, crew: 0.9, supply: 0.7, kills: i % 2 }));
    attack.ships = make('atk', 'sekibune'); defend.ships = make('def', 'panokseon');
    g.regions.hansan.owner = 'joseon'; g.regions.hansan.garrison = [];
    g.regions.hansan.buildings = [{ kind: 'shipyard', level: 3, upgradeLeft: 0, hp: 0.8 }, { kind: 'battery', level: 2, upgradeLeft: 0, hp: 0.7 }, { kind: 'camp', level: 2, upgradeLeft: 0, hp: 0.9 }];
    const c = { id: 'depth-uncapped', regionId: 'hansan', attacker: 'japan', defender: 'joseon', attackerFleets: [attack.id], defenderFleets: [defend.id], player: true };
    // Another waiting meeting keeps the strategic turn open: routine port refitting after the last battle is a separate effect.
    g.pending = [c, { ...c, id: 'depth-awaiting-other-meeting', regionId: 'geoje' }]; g.phase = 'battles';
    const rb = describeContact(g, c);
    assert.equal(rb.attacker.ships.length, 301); assert.equal(rb.defender.ships.length, 301);
    assert.equal(rb.attacker.reserve.length, 0); assert.equal(rb.defender.reserve.length, 0);
    const actualLand = terrainLand(REGION_MAPS[rb.mapId].terrain);
    const { battle, conquest } = buildGrandConquest(rb, actualLand);
    assert.equal(battle.ships.length, 602); assert.equal(conquest.options.maxShips, Infinity); assert.equal(conquest.players[0].cap, Infinity);
    const source = new Map([...rb.attacker.ships, ...rb.defender.ships].map((u) => [u.campaignId, u]));
    assert.equal(new Set(battle.ships.map((s) => s.campaignId)).size, 602);
    for (const s of battle.ships) {
      const u = source.get(s.campaignId); assert.ok(u);
      close(s.hull / s.spec.hull, u.hull); close(s.crew / s.spec.crew, u.crew); assert.equal(s.name, u.name);
      assert.ok(actualLand(s.x, s.z) < -6);
    }
    const home = conquest.homeOf(1);
    assert.equal(home.buildings.find((bd) => bd?.kind === 'shipyard').level, 3);
    assert.equal(home.buildings.find((bd) => bd?.kind === 'battery').level, 2);
    assert.equal(home.buildings.find((bd) => bd?.kind === 'camp').level, 2);
    assert.ok(applyBattleResult(g, rb, outcomeOfBattle(rb, rb.attacker.team, shipOutcomes(battle.ships))));
    const after = new Map(g.fleets.flatMap((fl) => fl.ships).map((u) => [u.id, u]));
    for (const id of source.keys()) assert.ok(after.has(id));
  });
  check('historical battles retain their exact catalog and written counts despite expanded casual modes', () => {
    for (const id of Object.keys(SCENARIOS)) {
      const b = buildScenario(id, 0, 881);
      assert.equal(b.profile, 'historical');
      for (const s of b.ships) assert.equal(s.spec, SHIP_SPECS[s.spec.kind]);
      const second = buildScenario(id, 0, 881); assert.deepEqual(second.ships, b.ships);
    }
  });
  if (process.argv.includes('--benchmark') || process.argv.includes('--benchmark-combat')) {
    const f = fixture({}, 'japan');
    for (const owner of [0, 1]) {
      const home = f.c.homeOf(owner);
      assert.ok(f.c.build(f.b, owner, home.id, 'camp')); f.c.step(f.b, BUILDINGS.camp.time);
      const slot = home.buildings.findIndex((bd) => bd?.kind === 'camp');
      for (let level = 1; level < 3; level++) { assert.ok(f.c.upgrade(f.b, owner, home.id, slot)); f.c.step(f.b, upgradeTime('camp', level)); }
      const sq = f.b.addSquadron(owner ? 'japan' : 'joseon', '', '', '', '', owner);
      for (let n = 0; n < 240; n++) {
        const s = f.b.addShip('kobaya', (owner ? 2100 : -2900) + (n % 12) * 65, -260 + Math.floor(n / 12) * 25, 0, '', sq);
        s.fireMode = 'hold'; s.order = { type: 'hold' };
      }
    }
    const combat = process.argv.includes('--benchmark-combat');
    if (combat) {
      f.c.setHuman(0, false); f.c.setHuman(1, false); f.b.humans.clear();
      f.b.ships.forEach((s) => { s.x += s.owner === 0 ? 1600 : -1600; s.fireMode = 'free'; });
    }
    const steps = combat ? 5400 : 600, before = performance.now(), events = new Map();
    for (let step = 0; step < steps; step++) { f.b.step(SIM_DT); for (const e of f.b.events.splice(0)) events.set(e.type, (events.get(e.type) ?? 0) + 1); }
    const elapsedMs = performance.now() - before;
    if (!combat) assert.equal(f.b.ships.length, 480);
    assert.ok(f.b.ships.every((s) => Number.isFinite(s.x) && Number.isFinite(s.z)));
    if (combat) assert.ok((events.get('ram') ?? 0) + (events.get('board') ?? 0) + (events.get('musket') ?? 0) > 0, 'the CPU sample must include real combat');
    console.log(JSON.stringify({ benchmark: 'local simulation CPU only', scenario: combat ? '480 ships, two AI commanders, formation approach and combat' : '480 human-owned ships holding in open water', initialShips: 480, finalShips: f.b.ships.length, activeShips: f.b.ships.filter((s) => f.b.isActive(s)).length, steps, dt: SIM_DT, simulatedSeconds: steps * SIM_DT, elapsedMs: Math.round(elapsedMs), msPerStep: elapsedMs / steps, events: Object.fromEntries(events), browserFpsMeasured: false }));
  }
} finally { await server.close(); }
console.log(failed ? `${failed} failed` : 'all passed');
process.exitCode = failed ? 1 : 0;
