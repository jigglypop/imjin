// Structural regressions for competitive rules. Rate estimates belong to balance-competitive.mjs, not a tiny CI sample.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule('/src/sim/' + p + '.ts');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); } };
try {
  const { Battle, SIM_DT } = await load('battle');
  const { SHIP_SPECS, GUN_SPECS } = await load('catalog');
  const { COMPETITIVE_PROFILE, COMPETITIVE_FACTIONS, shipSpec, shipMods, combatValue, engagementRange } = await load('competitive');
  const { buildScenario, SCENARIOS } = await load('scenarios');
  const { buildConquest, autoFleet, fleetCost, CONQUEST_ORDER } = await load('maps');
  const { RANKED_ROSTER, RANKED_OPTIONS, DEFAULT_OPTIONS } = await load('conquest');
  const { Strategist } = await load('strategy');
  const { shipDef, TUNING, factionIncome, migrateGrandBalance } = await load('grand/economy');
  const { newGrand } = await load('grand/turn');
  const { describeContact } = await load('grand/bridge');
  const { buildGrandConquest } = await load('grand/spawn');
  const { autoResolve } = await load('grand/autoresolve');
  const { orderRecruit, cancelRecruit } = await load('grand/orders');
  const factions = ['joseon', 'japan', 'ming'];
  const fingerprint = () => createHash('sha256').update(JSON.stringify({ SHIP_SPECS, GUN_SPECS, SCENARIOS })).digest('hex');
  const original = fingerprint();

  check('historical scenarios and the default battle retain their original catalog and formations', () => {
    assert.equal(new Battle(1).profile, 'historical');
    for (const id of Object.keys(SCENARIOS)) {
      const b = buildScenario(id, 0, 77);
      assert.equal(b.profile, 'historical');
      for (const s of b.ships) assert.equal(s.spec, SHIP_SPECS[s.spec.kind]);
      const again = buildScenario(id, 0, 77);
      assert.equal(JSON.stringify(b.ships), JSON.stringify(again.ships));
    }
  });
  check('competitive ships have separate hull, movement, price and crew rules with conserved stations', () => {
    const b = new Battle(33, COMPETITIVE_PROFILE);
    for (const kind of Object.keys(SHIP_SPECS)) {
      const s = b.addShip(kind, 0, 0, 0, kind, null);
      assert.equal(s.spec, shipSpec(kind)); assert.notEqual(s.spec, SHIP_SPECS[kind]);
      assert.equal(s.hull, s.spec.hull); assert.ok(Math.abs(s.crew - s.spec.crew) < 1e-9);
      assert.ok(Math.abs(s.roles.reduce((a, n) => a + n, 0) - s.crew) < 1e-9);
      assert.deepEqual(s.mods, shipMods(kind));
      assert.equal(s.spec.length, SHIP_SPECS[kind].length); assert.deepEqual(s.spec.batteries, SHIP_SPECS[kind].batteries);
    }
    assert.ok(shipSpec('panokseon').armor > shipSpec('mingship').armor);
    assert.ok(shipSpec('atakebune').maxSpeed > shipSpec('panokseon').maxSpeed);
    assert.ok(shipSpec('sekibune').cost < shipSpec('panokseon').cost);
    assert.equal(shipSpec('geobukseon').boardable, false);
  });
  check('Ming long-range guns can fire beyond Joseon gun range without altering the historical gun type', () => {
    const b = new Battle(2, COMPETITIVE_PROFILE);
    const a = b.addShip('mingship', 0, 0, Math.PI / 2, 'a', b.addSquadron('joseon', '', '', '', '', 0));
    const z = b.addShip('panokseon', 530, 0, Math.PI / 2, 'z', b.addSquadron('japan', '', '', '', '', 1));
    b.humans = new Set([0, 1]);
    for (const s of [a, z]) { s.speed = 0; s.order = { type: 'hold' }; s.guns.forEach((g) => { g.stage = 4; g.t = 0; }); }
    for (let k = 0; k < 60; k++) b.step(SIM_DT);
    assert.ok(b.events.some((e) => e.type === 'gun' && e.ship === a.id));
    assert.ok(!b.events.some((e) => e.type === 'gun' && e.ship === z.id));
    assert.ok(b.gunSpec('mingship', 'folangji').range > GUN_SPECS.cheonja.range);
    assert.equal(new Battle().gunSpec('mingship', 'folangji'), GUN_SPECS.folangji);
    assert.equal(engagementRange('historical', ['mingship']), 400);
    assert.equal(engagementRange(COMPETITIVE_PROFILE, ['mingship']), 540);
    assert.equal(engagementRange(COMPETITIVE_PROFILE, ['kobaya']), 400);
  });
  check('competitive gun lines move around an island and preserve ammunition until the firing lane clears', () => {
    const b = new Battle(2, COMPETITIVE_PROFILE);
    const a = b.addShip('mingship', 0, 0, Math.PI / 2, '', b.addSquadron('joseon', '', '', '', '', 0));
    const z = b.addShip('panokseon', 350, 0, Math.PI / 2, '', b.addSquadron('japan', '', '', '', '', 1));
    b.land = (x) => x > 110 && x < 240 ? 30 : -50;
    // A scout beyond the island supplies observation, while the firing ship still has no ballistic lane.
    b.addShip('hyeopseon', 350, 300, 0, '', b.addSquadron('joseon', '', '', '', '', 0));
    b.humans.clear(); b.thinkGunner(a, z);
    assert.equal(b.activityOf(a.id), 'moving'); assert.ok(a.throttle > 0);
    b.humans = new Set([0, 1]);
    for (const s of [a, z]) { s.speed = 0; s.order = { type: 'hold' }; s.guns.forEach((g) => { g.stage = 4; g.t = 0; }); }
    for (let k = 0; k < 60; k++) b.step(SIM_DT);
    assert.ok(!b.events.some((e) => e.type === 'gun' && e.ship === a.id));
    b.land = () => -50;
    for (let k = 0; k < 60; k++) b.step(SIM_DT);
    assert.ok(b.events.some((e) => e.type === 'gun' && e.ship === a.id));
  });
  check('Ming standoff preserves its competitive range while historical standoff keeps the original distance', () => {
    for (const profile of [COMPETITIVE_PROFILE, 'historical']) {
      const b = new Battle(8, profile);
      const a = b.addShip('mingship', 0, 0, Math.PI / 2, '', b.addSquadron('joseon', '', '', '', '', 0));
      const z = b.addShip('panokseon', 450, 0, Math.PI / 2, '', b.addSquadron('japan', '', '', '', '', 1));
      a.stance = 'standoff'; b.thinkGunner(a, z);
      assert.equal(b.activityOf(a.id), profile === 'historical' ? 'moving' : 'engaging');
      a.stance = 'auto'; b.thinkGunner(a, z);
      assert.equal(b.activityOf(a.id), profile === 'historical' ? 'moving' : 'engaging');
    }
  });
  check('competitive gunners keep an open gun line when the closest enemy is hidden by an island', () => {
    const b = new Battle(9, COMPETITIVE_PROFILE);
    const a = b.addShip('mingship', 0, 0, Math.PI / 2, '', b.addSquadron('joseon', '', '', '', '', 0));
    const sq = b.addSquadron('japan', '', '', '', '', 1);
    const hidden = b.addShip('panokseon', 350, 0, Math.PI / 2, '', sq);
    const open = b.addShip('panokseon', 0, 450, 0, '', sq);
    b.land = (x, z) => x > 110 && x < 240 && Math.abs(z) < 60 ? 30 : -50;
    b.step(SIM_DT); a.stance = 'standoff'; b.thinkGunner(a, undefined);
    assert.equal(a.targetId, open.id); assert.notEqual(a.targetId, hidden.id);
    assert.equal(b.activityOf(a.id), 'engaging');
    assert.equal(b.setOrder([a.id], { type: 'attack', targetId: hidden.id }), 0);
    b.thinkGunner(a, hidden); assert.equal(a.targetId, open.id);
  });
  check('competitive shore bombardment uses the firing ships range and gunless boarding craft still capture', () => {
    for (const [kind, distance, activity] of [['atakebune', 350, 'moving'], ['mingship', 450, 'engaging']]) {
      const b = new Battle(10, COMPETITIVE_PROFILE);
      const s = b.addShip(kind, 0, 0, Math.PI / 2, '', null);
      s.order = { type: 'bombard', x: distance, y: 3, z: 0 };
      b.think(s); assert.equal(b.activityOf(s.id), activity);
    }
    const b = new Battle(10), legacy = b.addShip('atakebune', 0, 0, Math.PI / 2, '', null);
    legacy.order = { type: 'bombard', x: 350, y: 3, z: 0 }; b.think(legacy);
    assert.equal(b.activityOf(legacy.id), 'engaging');
    const c = new Battle(10, COMPETITIVE_PROFILE);
    const ships = ['sekibune', 'atakebune'].map((kind) => c.addShip(kind, 0, 0, 0, '', null));
    const p = { x: 100, z: 0, r: 220 };
    const fixture = { player: () => ({ team: 'joseon' }), teamOfPoint: () => 'japan', targetNear: () => ({ x: 150, y: 3, z: 0 }) };
    assert.equal(new Strategist(0).bombard(fixture, ships, p), true);
    assert.deepEqual(ships[0].order, { type: 'move', x: 100, z: 0 });
    assert.equal(ships[1].order.type, 'bombard');
  });
  check('competitive rams damage both identical hulls and crews equally regardless of insertion order', () => {
    for (const reverse of [false, true]) {
      const b = new Battle(3, COMPETITIVE_PROFILE);
      const positions = reverse ? [10.5, -10.5] : [-10.5, 10.5];
      const ships = positions.map((x, i) => b.addShip('sekibune', x, 0, x < 0 ? 0 : Math.PI, '', b.addSquadron(i ? 'japan' : 'joseon', '', '', '', '', i)));
      for (const s of ships) s.speed = 6;
      b.grid.rebuild(b.ships); b.collide(SIM_DT);
      assert.ok(b.events.some((e) => e.type === 'ram'));
      assert.ok(Math.abs(ships[0].hull - ships[1].hull) < 1e-9);
      assert.ok(Math.abs(ships[0].crew - ships[1].crew) < 1e-9);
    }
  });
  check('competitive boarders slow to a grapple-compatible speed against a ship moving across their bow', () => {
    for (const profile of [COMPETITIVE_PROFILE, 'historical']) {
      const b = new Battle(11, profile);
      const a = b.addShip('sekibune', 0, 0, 0, '', b.addSquadron('joseon', '', '', '', '', 0));
      const z = b.addShip('panokseon', 20, 0, Math.PI / 2, '', b.addSquadron('japan', '', '', '', '', 1));
      z.speed = 3; b.thinkBoarder(a, z);
      a.speed = a.throttle * a.spec.maxSpeed * a.mods.speed;
      b.grid.rebuild(b.ships); b.reachGrapples();
      if (profile === COMPETITIVE_PROFILE) assert.equal(a.grappledWith, z.id, 'A broadside-moving ship must not make a boarder approach faster than its grapple permits.');
      else assert.equal(a.grappledWith, 0);
    }
  });
  check('strategic formations rotate with their seat instead of favouring the absolute east', () => {
    const a = new Strategist(0), z = new Strategist(1);
    a.axis = 0.3; z.axis = a.axis + Math.PI;
    const left = Array.from({ length: 7 }, () => ({ x: -2000, z: -800, spec: { maxSpeed: 5 }, mods: { speed: 1 }, order: { type: 'hold' } }));
    const right = left.map((s) => ({ ...s, x: -s.x, z: -s.z, order: { type: 'hold' } }));
    a.sail(left, 300, 200, 160); z.sail(right, -300, -200, 160);
    left.forEach((s, i) => { assert.equal(s.order.type, 'move'); assert.ok(Math.abs(s.order.x + right[i].order.x) < 1e-9); assert.ok(Math.abs(s.order.z + right[i].order.z) < 1e-9); });
  });
  check('fast AI escorts regroup at the heavy ships pace instead of reaching a gun line alone', () => {
    const a = new Strategist(0), b = new Battle(22, COMPETITIVE_PROFILE);
    const ships = ['atakebune', 'sekibune'].map((kind) => b.addShip(kind, -2000, 0, 0, '', null));
    a.sail(ships, 0, 0, 80);
    assert.equal(ships[0].speedCap, 1);
    assert.ok(ships[1].speedCap < 1);
    assert.equal(ships[0].spec.maxSpeed * ships[0].mods.speed * ships[0].speedCap, ships[1].spec.maxSpeed * ships[1].mods.speed * ships[1].speedCap);
  });
  check('AI stragglers fight an observed gun line before its first effective volley instead of regrouping through fire', () => {
    const b = new Battle(22, COMPETITIVE_PROFILE), ai = new Strategist(0);
    const own = b.addSquadron('joseon', '', '', '', '', 0), enemy = b.addSquadron('japan', '', '', '', '', 1);
    const main = b.addShip('geobukseon', -1500, 0, 0, '', own), spare = b.addShip('sekibune', 0, 0, 0, '', own), foe = b.addShip('mingship', 450, 0, 0, '', enemy);
    spare.order = { type: 'move', x: main.x, z: main.z };
    b.active = { joseon: [main, spare], japan: [foe] }; ai.lead = () => {}; ai.raid = () => {};
    ai.military(b, { player: () => ({ team: 'joseon' }), points: [], options: RANKED_OPTIONS });
    assert.equal(spare.order.type, 'auto', 'The 540m gun line already threatens a ship at 450m.');
  });
  check('uncapped AI fleets receive navigable non-overlapping destinations mirrored with their side', () => {
    const run = (mirror) => {
      const b = new Battle(22, COMPETITIVE_PROFILE), ai = new Strategist(0);
      ai.spreadHulls = true; ai.axis = mirror ? Math.PI : 0;
      ai.waterGoal = (x, z) => x * x + z * z > 160 * 160;
      const fleet = Array.from({ length: 90 }, (_, i) => b.addShip(i % 3 ? 'sekibune' : 'atakebune', mirror ? 2500 : -2500, 0, ai.axis, '', null));
      ai.sail(fleet, 0, 0, 60);
      for (const s of fleet) { assert.equal(s.order.type, 'move'); s.x = s.order.x; s.z = s.order.z; assert.ok(ai.waterGoal(s.x, s.z)); }
      for (let i = 0; i < fleet.length; i++) for (let j = 0; j < i; j++) assert.ok(b.hullGap(fleet[i], fleet[j]) >= -1e-7, 'Assigned hull destinations must be physically attainable.');
      return fleet;
    };
    const left = run(false), right = run(true);
    left.forEach((s, i) => { assert.ok(Math.abs(s.x + right[i].x) < 1e-8); assert.ok(Math.abs(s.z + right[i].z) < 1e-8); });
  });
  check('AI saves for its missing main ship when cheap replacements would keep the treasury below its price', () => {
    const b = new Battle(23, COMPETITIVE_PROFILE), ai = new Strategist(0);
    b.addShip('sekibune', 0, 0, 0, '', b.addSquadron('joseon', '', '', '', '', 0));
    const me = { faction: 'japan', funds: 120 }, bought = [];
    const fixture = { player: () => me, shipSpec, canRecruit: () => true, recruitIn: (_b, _owner, _point, kind) => { bought.push(kind); return true; } };
    ai.frontline = (_c, yards) => yards;
    ai.recruit(b, fixture, [{ id: 0, queue: [] }]);
    assert.deepEqual(bought, [], 'An 85-cost boat must not consume savings for the missing 470-cost main ship.');
    me.funds = shipSpec('atakebune').cost;
    ai.recruit(b, fixture, [{ id: 0, queue: [] }]);
    assert.deepEqual(bought, ['atakebune']);
  });
  check('small doctrine deficits save money and never buy an already overrepresented scout', () => {
    const { battle: b, conquest: c } = buildConquest('hallyeo', [{ name: '', faction: 'joseon', team: 'joseon', human: false, fleet: [] }, { name: '', faction: 'japan', team: 'japan', human: false, fleet: [] }], () => -50, 23);
    const sq = b.addSquadron('joseon', '', '', '', '', 0), p = c.homeOf(0), me = c.player(0), ai = new Strategist(0);
    for (const [kind, count] of [['panokseon', 20], ['geobukseon', 2], ['hyeopseon', 73]]) {
      for (let i = 0; i < count; i++) b.addShip(kind, -2000, i * 50, 0, '', sq);
    }
    // The most missing kind has a 14.2% deficit, below the old 15% arbitrary savings threshold.
    me.funds = shipSpec('hyeopseon').cost;
    for (let i = 0; i < 20; i++) ai.recruit(b, c, [p]);
    assert.equal(me.funds, shipSpec('hyeopseon').cost); assert.equal(p.queue.length, 0);
    me.funds = shipSpec('geobukseon').cost; ai.recruit(b, c, [p]);
    assert.equal(p.queue[0].kind, 'geobukseon');
    assert.ok(c.cancel(0, p.id, 0));
    me.funds = 2000; me.cap = c.fleet(b, 0).value + shipSpec('panokseon').cost;
    ai.recruit(b, c, [p]); assert.equal(p.queue[0].kind, 'panokseon');
  });
  check('scouts keep safe objectives instead of chasing a gunship 450m away, in every faction', () => {
    for (const kind of ['hyeopseon', 'kobaya', 'mingsmall']) {
      const b = new Battle(23, COMPETITIVE_PROFILE), ai = new Strategist(0);
      const scouts = Array.from({ length: 6 }, (_, i) => b.addShip(kind, 550, (i - 2.5) * 15, 0, '', null));
      const enemy = b.addShip('panokseon', 1000, 0, 0, '', null);
      const p = { id: 0, x: 0, z: 0, r: 220, value: 1, home: -1, hold: 0 };
      const fixture = { player: () => ({ team: 'joseon' }), points: [p], teamOfPoint: () => null };
      ai.raid(b, fixture, scouts, [{ x: enemy.x, z: enemy.z, ships: [enemy], power: combatValue(enemy.spec.kind) }]);
      for (const s of scouts) {
        assert.equal(s.order.type, 'move');
        assert.ok(Math.hypot(s.order.x, s.order.z) <= p.r * 0.4 + 1e-9);
      }
    }
  });
  check('eighteen scouts split into three small groups with mirrored separate goals', () => {
    const run = (mirror) => {
      const b = new Battle(23, COMPETITIVE_PROFILE), ai = new Strategist(0), sign = mirror ? -1 : 1;
      ai.axis = mirror ? Math.PI : 0; ai.spreadHulls = true;
      const scouts = Array.from({ length: 18 }, (_, i) => b.addShip('kobaya', -1500 * sign, (i - 8.5) * 20 * sign, ai.axis, '', null));
      const points = [-600, 0, 600].map((z, i) => ({ id: i, x: 0, z: z * sign, r: 220, value: 1, home: -1, hold: 0 }));
      const fixture = { player: () => ({ team: 'joseon' }), points, teamOfPoint: () => null };
      ai.raid(b, fixture, scouts, []);
      const counts = new Map();
      for (const s of scouts) {
        assert.equal(s.order.type, 'move');
        const p = points.find((p) => Math.hypot(p.x - s.order.x, p.z - s.order.z) <= p.r * 0.4 + 1e-9);
        assert.ok(p); counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
      }
      assert.deepEqual([...counts.values()].sort(), [6, 6, 6]);
      return scouts.map((s) => s.order);
    };
    const a = run(false), z = run(true);
    a.forEach((o, i) => { assert.ok(Math.abs(o.x + z[i].x) < 1e-9); assert.ok(Math.abs(o.z + z[i].z) < 1e-9); });
  });
  check('parallel light-scout capture retains its real weighted rate instead of assuming six small ships saturate it', () => {
    const run = (split) => {
      const { battle: b, conquest: c } = buildConquest('hallyeo', [{ name: '', faction: 'japan', team: 'joseon', human: false, fleet: [] }, { name: '', faction: 'ming', team: 'japan', human: false, fleet: [] }], () => -50, 23);
      c.points = c.points.filter((p) => p.home < 0).slice(0, 3);
      assert.equal(c.points.length, 3);
      for (const p of c.points) { p.owner = -1; p.hold = 0; }
      const sq = b.addSquadron('joseon', '', '', '', '', 0);
      for (let i = 0; i < 18; i++) {
        const p = c.points[split ? Math.floor(i / 6) : 0];
        b.addShip('kobaya', p.x, p.z, 0, '', sq);
      }
      b.grid.rebuild(b.ships); c.capture(b, 10);
      return c.points.map((p) => p.hold);
    };
    const split = run(true), together = run(false);
    split.forEach((hold) => assert.ok(Math.abs(hold - 0.025 * 1.44 * 10) < 1e-9));
    assert.ok(Math.abs(together[0] - 0.025 * 3 * 10) < 1e-9);
    assert.ok(split.reduce((a, n) => a + n, 0) > together.reduce((a, n) => a + n, 0));
  });
  check('scouts fight nearby weak opposition but withdraw from a stronger gunship', () => {
    const run = (kind) => {
      const b = new Battle(23, COMPETITIVE_PROFILE), ai = new Strategist(0);
      const scouts = Array.from({ length: 6 }, (_, i) => b.addShip('kobaya', 0, i * 10, 0, '', null));
      const enemy = b.addShip(kind, 100, 0, 0, '', null);
      const p = { id: 0, x: -2000, z: 0, r: 220, value: 1, home: 0, hold: 1 };
      const fixture = { player: () => ({ team: 'joseon' }), points: [p], teamOfPoint: () => 'joseon', count: () => 0 };
      ai.raid(b, fixture, scouts, [{ x: enemy.x, z: enemy.z, ships: [enemy], power: combatValue(enemy.spec.kind) }]);
      return scouts;
    };
    assert.ok(run('hyeopseon').every((s) => s.order.type === 'auto'));
    assert.ok(run('panokseon').every((s) => s.order.type === 'move' && s.order.x < -1900));
  });
  check('competitive weather varies by battle seed while historical weather stays unchanged', () => {
    const a = new Battle(77, COMPETITIVE_PROFILE), b = new Battle(77, COMPETITIVE_PROFILE), z = new Battle(78, COMPETITIVE_PROFILE);
    assert.deepEqual(a.waves.ampQ, b.waves.ampQ); assert.notDeepEqual(a.waves.ampQ, z.waves.ampQ);
    assert.deepEqual(new Battle(77).waves.ampQ, new Battle(78).waves.ampQ);
  });
  check('all factions keep equal opening resources, including change, on both conquest maps', () => {
    for (const id of CONQUEST_ORDER) for (const faction of factions) {
      const fleet = autoFleet(faction, 5200, COMPETITIVE_PROFILE, 36, false);
      assert.ok(fleet.length <= 36); assert.ok(fleet.every((k) => RANKED_ROSTER[faction].includes(k)));
      const seats = [false, true].map((human, i) => ({ name: '', faction, team: i ? 'japan' : 'joseon', human, fleet }));
      const { battle, conquest } = buildConquest(id, seats, () => -50, 77, RANKED_OPTIONS);
      assert.equal(battle.profile, COMPETITIVE_PROFILE);
      for (const p of conquest.players) assert.equal(conquest.fleet(battle, p.slot).value + p.funds, 5200 + 1200);
      assert.equal(fleetCost(fleet), fleet.reduce((s, k) => s + shipSpec(k).cost, 0));
      const p = conquest.homeOf(0), kind = RANKED_ROSTER[faction][0], funds = conquest.player(0).funds;
      conquest.player(0).funds += 1000;
      assert.ok(conquest.recruitIn(battle, 0, p.id, kind));
      assert.equal(conquest.player(0).funds, funds + 1000 - shipSpec(kind).cost);
      assert.equal(p.queue[0].total, shipSpec(kind).build);
      assert.ok(conquest.cancel(0, p.id, 0)); assert.equal(conquest.player(0).funds, funds + 1000);
    }
  });
  check('ordinary conquest has no fleet count or value ceiling while ranked retains its separate limits', () => {
    assert.equal(DEFAULT_OPTIONS.maxShips, Infinity); assert.equal(DEFAULT_OPTIONS.cap, Infinity);
    assert.equal(RANKED_OPTIONS.maxShips, 36); assert.equal(RANKED_OPTIONS.cap, 10000);
    const opening = autoFleet('japan'); assert.ok(opening.length > 36);
    const seats = [{ name: '', faction: 'japan', team: 'joseon', human: false, fleet: opening }, { name: '', faction: 'ming', team: 'japan', human: false, fleet: autoFleet('ming') }];
    const { battle, conquest } = buildConquest('hallyeo', seats, () => -50, 17);
    const p = conquest.homeOf(0), sq = battle.squadrons.find((s) => s.owner === 0);
    while (conquest.fleet(battle, 0).count <= 240) battle.addShip('atakebune', -2000, 0, 0, '', sq);
    conquest.player(0).funds = 1000;
    assert.ok(conquest.fleet(battle, 0).value > 10000);
    assert.ok(conquest.recruitIn(battle, 0, p.id, 'atakebune'));
  });
  check('campaign prices, combat appraisal and real-time spawn use the same competitive profile', () => {
    for (const kind of Object.keys(SHIP_SPECS)) {
      assert.equal(shipDef(kind).gold, Math.round(shipSpec(kind).cost * TUNING.goldPerCost * TUNING.faction[shipSpec(kind).faction].cost));
      assert.equal(shipDef(kind).turns, Math.ceil(shipSpec(kind).build / TUNING.shipSecondsPerTurn));
      assert.equal(shipDef(kind).strength, combatValue(kind) * TUNING.faction[shipSpec(kind).faction].power);
    }
    const g = newGrand('japan', 8);
    const contact = { id: 'profile', regionId: 'hansan', attacker: 'japan', defender: 'joseon', attackerFleets: g.fleets.filter((f) => f.faction === 'japan').map((f) => f.id), defenderFleets: g.fleets.filter((f) => f.faction === 'joseon').map((f) => f.id), player: true };
    const rb = describeContact(g, contact), { battle } = buildGrandConquest(rb, () => -50);
    assert.equal(battle.profile, COMPETITIVE_PROFILE);
    for (const s of battle.ships) {
      const u = [...rb.attacker.ships, ...rb.defender.ships].find((u) => u.campaignId === s.campaignId);
      assert.ok(Math.abs(s.hull / s.spec.hull - Math.max(0.05, u.hull)) < 1e-9);
      assert.ok(Math.abs(s.crew / s.spec.crew - Math.max(0.05, u.crew)) < 1e-9);
      for (const key of Object.keys(s.mods)) assert.equal(s.mods[key], shipMods(s.spec.kind)[key] * u.mods[key]);
    }
    assert.ok(factions.every((f) => COMPETITIVE_FACTIONS[f].cost === 1 && COMPETITIVE_FACTIONS[f].income === 1));
    assert.ok(factions.every((f) => factionIncome(g, f) > 0));
  });
  check('every roster and side of auto-resolve remains deterministic with valid survivors', () => {
    const unit = (kind, i) => ({ id: 'u' + i, kind, name: '', hull: 1, crew: 1, supply: 1, kills: 0 });
    for (const a of factions) for (const z of factions) {
      const input = { seed: 77123, tags: [4], attacker: { ships: autoFleet(a).map(unit), leader: 1 }, defender: { ships: autoFleet(z).map((k, i) => unit(k, i + 100)), leader: 1 } };
      const x = autoResolve(input), y = autoResolve(input);
      assert.deepEqual(x, y); assert.deepEqual(input.attacker.ships, autoFleet(a).map(unit));
      assert.ok(x.outcome.ships.every((s) => Number.isFinite(s.hull) && s.hull >= 0 && s.hull <= 1 && s.crew >= 0 && s.crew <= 1));
    }
  });
  check('saved ship queues refund their paid price across profile migration and future price changes', () => {
    for (const [faction, region, kind, legacyPrice] of [['japan', 'busan', 'atakebune', 145], ['ming', 'liaodong', 'mingship', 369]]) {
      const g = newGrand(faction, 8);
      g.events.pending = null; delete g.balanceProfile;
      const r = g.regions[region]; r.queue = [{ id: 'old', kind, left: 4, total: 4 }];
      const copy = JSON.parse(JSON.stringify(g));
      migrateGrandBalance(g); migrateGrandBalance(copy);
      assert.deepEqual(g, copy); assert.equal(r.queue[0].paidGold, legacyPrice);
      migrateGrandBalance(g); assert.equal(r.queue[0].paidGold, legacyPrice);
      const gold = g.factions[faction].gold;
      assert.ok(cancelRecruit(g, region, 'old').ok); assert.equal(g.factions[faction].gold, gold + legacyPrice);
      assert.ok(orderRecruit(g, region, kind).ok);
      const q = r.queue[0], paid = q.paidGold, spec = shipSpec(kind), originalCost = spec.cost;
      try { spec.cost += 100; const before = g.factions[faction].gold; assert.ok(cancelRecruit(g, region, q.id).ok); assert.equal(g.factions[faction].gold, before + paid); } finally { spec.cost = originalCost; }
    }
  });
  check('competitive battles never mutate historical catalogs or scenario data', () => assert.equal(fingerprint(), original));
  check('computer boarders use player station presets to preserve approach speed and move fighters after grappling', () => {
    const make = (profile, human) => {
      const b = new Battle(7, profile); b.windDrift = 0; b.humans = human ? new Set([0]) : new Set();
      const a = b.addShip('atakebune', 0, 0, 0, '', b.addSquadron('joseon', '', '', '', '', 0));
      const z = b.addShip('panokseon', 180, 0, 0, '', b.addSquadron('japan', '', '', '', '', 1));
      b.setCrew(a, 150); return { b, a, z };
    };
    const ai = make(COMPETITIVE_PROFILE, false), human = make(COMPETITIVE_PROFILE, true);
    const expected = ai.a.spec.crewPlan.map((v, i) => i === 0 ? 0.6 : v * 0.4 / 0.6);
    ai.b.thinkBoarder(ai.a, ai.z); human.b.setPlan([human.a.id], expected); human.b.thinkBoarder(human.a, human.z);
    ai.a.plan.forEach((v, i) => assert.ok(Math.abs(v - human.a.plan[i]) < 1e-12));
    for (let i = 0; i < 600; i++) { ai.b.reassign(ai.a, SIM_DT); human.b.reassign(human.a, SIM_DT); }
    ai.a.roles.forEach((v, i) => assert.ok(Math.abs(v - human.a.roles[i]) < 1e-9)); assert.ok(ai.b.rowing(ai.a) > 0.9);
    assert.ok(Math.abs(ai.a.crew - 150) < 1e-9);
    ai.a.grappledWith = ai.z.id; ai.b.think(ai.a); assert.ok(Math.abs(ai.a.plan[3] - 0.45) < 1e-12);
    assert.ok(Math.abs(ai.a.plan.reduce((s, v) => s + v, 0) - 1) < 1e-12);
    assert.ok(Math.abs(ai.a.roles.reduce((s, v) => s + v, 0) - ai.a.crew) < 1e-9);
    const historical = make('historical', false), plan = [...historical.a.plan];
    historical.b.thinkBoarder(historical.a, historical.z); assert.deepEqual(historical.a.plan, plan);
    const custom = [0.3, 0.1, 0.2, 0.4]; human.b.setPlan([human.a.id], custom); human.b.thinkBoarder(human.a, human.z);
    assert.deepEqual(human.a.plan, custom);
  });
  check('large computer boarding fleets distribute visible targets instead of jamming one friendly approach', () => {
    const targets = (profile, mirror) => {
      const b = new Battle(92, profile); b.humans.clear(); b.windDrift = 0;
      const a = b.addSquadron('joseon', '', '', '', '', 0), z = b.addSquadron('japan', '', '', '', '', 1);
      const sign = mirror ? -1 : 1;
      for (let i = 0; i < 24; i++) {
        const q = b.addShip('atakebune', -Math.floor(i / 6) * 50 * sign, ((i % 6) - 2.5) * 35, mirror ? Math.PI : 0, '', a);
        q.thinkTimer = 0;
      }
      for (let i = 0; i < 6; i++) b.addShip('panokseon', (400 + i * 35) * sign, (i - 2.5) * 55, 0, '', z);
      b.step(0);
      const counts = new Map();
      for (const id of a.shipIds) {
        const q = b.get(id); assert.ok(q.targetId);
        counts.set(q.targetId, (counts.get(q.targetId) ?? 0) + 1);
      }
      return [...counts.values()].sort((a, z) => a - z);
    };
    const plain = targets(COMPETITIVE_PROFILE, false), mirrored = targets(COMPETITIVE_PROFILE, true);
    assert.equal(plain.length, 6); assert.ok(Math.max(...plain) <= 6);
    assert.deepEqual(mirrored, plain);
    assert.ok(Math.max(...targets('historical', false)) > 6);
  });
  check('computer light boarders counter nearby scouts while heavy ships commit to the gun line', () => {
    for (const profile of [COMPETITIVE_PROFILE, 'historical']) for (const kind of ['kobaya', 'sekibune', 'atakebune']) {
      const b = new Battle(92, profile); b.humans.clear(); b.windDrift = 0;
      const a = b.addShip(kind, 0, 0, 0, '', b.addSquadron('joseon', '', '', '', '', 0));
      const gunship = b.addShip('panokseon', 100, 0, 0, '', b.addSquadron('japan', '', '', '', '', 1));
      const scout = b.addShip('hyeopseon', 200, 0, 0, '', b.squadrons[1]);
      a.thinkTimer = 0; b.step(0);
      assert.equal(a.targetId, profile === COMPETITIVE_PROFILE && kind !== 'atakebune' ? scout.id : gunship.id);
      // A player may explicitly select the defended gunship even though the computer favours the soft escort.
      b.setOrder([a.id], { type: 'attack', targetId: gunship.id }); b.think(a); assert.equal(a.targetId, gunship.id);
    }
  });
  check('boarding approach assignments discard retired hulls in an uncapped battle', () => {
    const b = new Battle(92, COMPETITIVE_PROFILE);
    const s = b.addShip('kobaya', 0, 0, 0, '', null);
    b.boardingSlots.set(s.id, 1); s.alive = false;
    b.step(0); assert.equal(b.boardingSlots.size, 0);
  });
  const grappleFixture = (profile = COMPETITIVE_PROFILE, seed = 97241, closestKind = 'panokseon') => {
    const b = new Battle(seed, profile); b.land = () => -50; b.time = 10;
    const own = b.addSquadron('joseon', '', '', '', '', 0), foe = b.addSquadron('japan', '', '', '', '', 1);
    const a = b.addShip('sekibune', 0, 0, 0, '', own), closest = b.addShip(closestKind, 0, 0, 0, '', foe), next = b.addShip('panokseon', 0, 0, 0, '', foe);
    closest.z = (a.spec.beam + closest.spec.beam) * 0.5 + 4;
    next.z = -((a.spec.beam + next.spec.beam) * 0.5 + 8);
    a.stance = 'board'; closest.stance = next.stance = 'standoff';
    const hold = (target, count) => {
      const sq = target.team === own.team ? foe : own;
      const width = (target.spec.beam + shipSpec('sekibune', profile).beam) * 0.5 + 1;
      for (let i = 0; i < count; i++) {
        const offset = [[0, width], [0, -width], [(target.spec.length + shipSpec('sekibune', profile).length) * 0.5 + 1, 0], [-((target.spec.length + shipSpec('sekibune', profile).length) * 0.5 + 1), 0]][i];
        const h = b.addShip('sekibune', target.x + offset[0], target.z + offset[1], 0, '', sq);
        h.grappledWith = target.id; h.grappleTime = 2;
      }
      b.boarders.set(target.id, count);
    };
    const ready = () => {
      for (const s of b.ships) { s.speed = 0; s.repel = false; }
      b.active = { joseon: b.ships.filter((s) => s.team === 'joseon' && b.isActive(s)), japan: b.ships.filter((s) => s.team === 'japan' && b.isActive(s)) };
      b.grid.rebuild(b.ships); b.events.length = 0;
    };
    return { b, a, closest, next, hold, ready };
  };
  check('boarding reach skips a full deck but uses the closest deck when its fourth place is free', () => {
    for (const count of [3, 4]) {
      const { b, a, closest, next, hold, ready } = grappleFixture(); hold(closest, count); ready();
      assert.equal(b.ships.filter((s) => b.isActive(s) && s.grappledWith === closest.id).length, count);
      assert.ok(Math.abs(b.hullGap(a, closest) - 4) < 1e-9); assert.ok(Math.abs(b.hullGap(a, next) - 8) < 1e-9);
      b.reachGrapples();
      const target = count === 4 ? next : closest;
      assert.equal(a.grappledWith, target.id);
      assert.equal(b.events.filter((e) => e.type === 'board' && e.a === a.id && e.b === target.id).length, 1);
      assert.equal(b.boarders.get(closest.id), 4); assert.equal(b.boarders.get(next.id) ?? 0, count === 4 ? 1 : 0);
    }
  });
  check('boarding reach skips locked, closed and unsafe-speed targets without expanding other navies reach', () => {
    for (const reason of ['locked', 'closed', 'speed']) {
      const { b, a, closest, next, ready } = grappleFixture(COMPETITIVE_PROFILE, 97241, reason === 'closed' ? 'geobukseon' : 'panokseon'); ready();
      if (reason === 'locked') b.lockGrapple(a, closest.id);
      if (reason === 'speed') closest.speed = 7;
      b.reachGrapples(); assert.equal(a.grappledWith, next.id, reason);
    }
    const { b, a, closest, ready } = grappleFixture(); ready();
    a.stance = 'standoff'; closest.stance = 'board'; b.reachGrapples();
    assert.equal(closest.grappledWith, 0); assert.equal(b.events.filter((e) => e.type === 'board').length, 0);
  });
  check('Japanese mirrors use the available boarding direction and respect its own speed and lock', () => {
    for (const fullTarget of ['a', 'closest']) {
      const { b, a, closest, hold, ready } = grappleFixture(COMPETITIVE_PROFILE, 97241, 'sekibune'); closest.stance = 'board';
      hold(fullTarget === 'a' ? a : closest, 4); ready();
      b.rand = () => { throw new Error('Only one eligible direction needs no tie-break roll'); };
      b.tryGrapple(a, closest);
      const attacker = fullTarget === 'a' ? a : closest, defender = attacker === a ? closest : a;
      assert.equal(attacker.grappledWith, defender.id); assert.equal(defender.grappledWith, 0);
      assert.equal(b.boarders.get(fullTarget === 'a' ? a.id : closest.id), 4);
    }
    for (const reason of ['speed', 'locked']) {
      const { b, a, closest, ready } = grappleFixture(COMPETITIVE_PROFILE, 97241, 'sekibune'); closest.stance = 'board'; ready();
      if (reason === 'speed') { a.speed = 8; closest.speed = 2; closest.heading = Math.PI / 2; }
      else b.lockGrapple(a, closest.id);
      b.tryGrapple(a, closest); assert.equal(closest.grappledWith, a.id, reason); assert.equal(a.grappledWith, 0);
    }
  });
  check('a reverse non-Japanese grapple keeps its shorter throwing reach', () => {
    const { b, a, closest, ready } = grappleFixture(); ready();
    b.setCrew(a, a.spec.crew * 0.2); closest.stance = 'board';
    assert.ok(b.wantsBoard(a, closest) && b.wantsBoard(closest, a));
    b.rand = () => { throw new Error('The other navy cannot throw from a four-metre gap'); };
    b.reachGrapples(); assert.equal(a.grappledWith, closest.id); assert.equal(closest.grappledWith, 0);
  });
  check('contact rejection still injures boarders at closed and repelling decks', () => {
    for (const profile of [COMPETITIVE_PROFILE, 'historical']) for (const repel of [false, true]) {
      const { b, a, closest, ready } = grappleFixture(profile, 97241, 'geobukseon'); ready(); closest.repel = repel;
      const crew = a.crew; let rolls = 0; b.rand = () => { rolls++; return 0.1; };
      b.tryGrapple(a, closest);
      assert.equal(a.grappledWith, 0); assert.ok(Math.abs(crew - a.crew - (repel ? 2 : 3)) < 1e-9);
      assert.equal(rolls, repel ? 1 : 0);
      assert.equal(b.events.some((e) => e.type === 'repelled'), repel);
    }
  });
  check('historical capacity rejection and seeded mirror outcomes retain their original random sequence', () => {
    const full = grappleFixture('historical'); full.hold(full.closest, 4); full.ready(); full.b.reachGrapples();
    assert.equal(full.a.grappledWith, 0); assert.equal(full.b.boarders.get(full.next.id) ?? 0, 0);
    for (const seed of [2, 7, 23, 92, 1592, 97241]) {
      const actual = grappleFixture('historical', seed, 'sekibune'), control = grappleFixture('historical', seed, 'sekibune');
      for (const f of [actual, control]) { f.closest.stance = 'board'; f.hold(f.closest, 4); f.ready(); }
      const choice = control.b.rand(), following = control.b.rand(); actual.b.tryGrapple(actual.a, actual.closest);
      assert.equal(actual.a.grappledWith, 0);
      assert.equal(actual.closest.grappledWith, choice < 0.5 ? 0 : actual.a.id);
      assert.equal(actual.b.rand(), following, 'historical coin and subsequent random draw');
    }
  });
} finally { await server.close(); }
console.log(failed ? `${failed} failed` : 'all passed');
process.exitCode = failed ? 1 : 0;
