// The campaign's march rules (Total War-like movement): sailing distance per turn over several ports, stopping at sea,
// meetings on a lane, the zone of control of a port, reinforcements, blockades, the forced march, withdrawing, battle
// grades, determinism and the old lane rules for saves without `march`.
//   node scripts/test-grand-march.mjs
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const turn = await server.ssrLoadModule('/src/sim/grand/turn.ts');
  const march = await server.ssrLoadModule('/src/sim/grand/march.ts');
  const orders = await server.ssrLoadModule('/src/sim/grand/orders.ts');
  const { regionIncome } = await server.ssrLoadModule('/src/sim/grand/economy.ts');
  const { battleGrade } = await server.ssrLoadModule('/src/sim/grand/report.ts');
  const { buildReplay } = await server.ssrLoadModule('/src/sim/grand/replay.ts');
  const { describeContact } = await server.ssrLoadModule('/src/sim/grand/bridge.ts');
  const { EVENTS } = await server.ssrLoadModule('/src/sim/grand/events.ts');
  const { newGrand, endTurn } = turn;
  const { MARCH, laneKm, fleetReach, marchRoute, marchStops, transitShare } = march;

  /**
   * A quiet war: no fleets but the test's own, no silver for the computer navies to build or recruit with, no queues and
   * no historical card left to deal, so nothing moves unless the test says so.
   */
  const quiet = (seed = 11) => {
    const g = newGrand(null, seed);
    g.fleets = [];
    // October 1592: an ordinary season (the January turns are winter).
    g.turn = 3;
    g.events.pending = null;
    for (const e of EVENTS) g.events.done[e.id] = -2;
    for (const f of ['joseon', 'japan', 'ming']) g.factions[f].gold = 0;
    for (const r of Object.values(g.regions)) r.queue = [];
    return g;
  };
  let n = 0;
  const ship = (kind) => ({ id: `t${++n}`, kind, name: kind, hull: 1, crew: 1, supply: 1, kills: 0 });
  const fleet = (g, faction, at, ships) => {
    const fl = { id: `tf${++n}`, faction, name: 'test', commanderId: null, ships: ships.map(ship), at, transit: null, route: [], from: at, rest: 0 };
    g.fleets.push(fl);
    return fl;
  };
  /** Ends a turn as the Joseon player, so the Joseon fleets keep the test's orders; any fight is settled by the numbers. */
  const sail = (g) => {
    g.player = 'joseon';
    const report = endTurn(g);
    for (const c of [...g.pending]) turn.autoResolveContact(g, c.id);
    return report;
  };

  // New wars march; a fleet's reach follows its slowest hull.
  {
    const g = quiet();
    assert.equal(g.march, 'tw-v1');
    const slow = fleet(g, 'joseon', 'yeosu', ['panokseon', 'hyeopseon']);
    const fast = fleet(g, 'joseon', 'yeosu', ['hyeopseon']);
    assert.ok(Math.abs(fleetReach(g, slow) - MARCH.base * 5 / MARCH.pace) < 1e-6, 'a panokseon sets the pace');
    assert.ok(fleetReach(g, fast) > fleetReach(g, slow) * 1.2, 'light ships sail farther');
    slow.stance = 'march';
    assert.ok(Math.abs(fleetReach(g, slow) - MARCH.base * 5 / MARCH.pace * MARCH.forced) < 1e-6, 'the forced march sails half again as far');
    assert.equal(laneKm(g, 'hansan', 'dangpo'), laneKm(g, 'dangpo', 'hansan'));
    slow.stance = undefined;
    const autumn = fleetReach(g, slow);
    g.turn = 4;
    assert.ok(march.winterTurn(4) && Math.abs(fleetReach(g, slow) - autumn * MARCH.winter) < 1e-6, 'winter shortens the sailing');
    console.log('ok   reach by the slowest hull, the commander, the forced march and the winter');
  }

  // Several friendly ports in one turn, and a long lane sailed over two turns with a stop at sea between.
  {
    const g = quiet();
    const fl = fleet(g, 'joseon', 'dangpo', ['panokseon']);
    const route = marchRoute(g, fl, 'geoje');
    assert.ok(route && route.path.length >= 2 && route.turns === 1, `two ports in one turn: ${JSON.stringify(route)}`);
    assert.ok(orders.orderMove(g, fl.id, 'geoje').ok);
    sail(g);
    assert.equal(fl.at, 'geoje');
    const far = fleet(g, 'joseon', 'myeongnyang', ['panokseon']);
    assert.ok(orders.orderMove(g, far.id, 'yeosu').ok);
    const stops = marchStops(g, far, far.route);
    assert.ok(stops.length >= 2 && 'from' in stops[0], 'the first turn ends at sea');
    sail(g);
    assert.equal(far.at, null);
    assert.ok(far.transit && far.transit.sailed > 0 && transitShare(g, far.transit) < 1, 'it lies out at sea after a turn');
    const share = transitShare(g, far.transit);
    // Turned about, it makes for the port behind it.
    assert.ok(orders.orderMove(g, far.id, 'myeongnyang').ok);
    sail(g);
    assert.equal(far.at, 'myeongnyang', `turned back home (was ${share})`);
    console.log('ok   several ports a turn, a long lane over two turns, a fleet at sea turned back');
  }

  // Two hostile fleets sailing the same lane toward each other meet at sea, and the fight is out there.
  {
    const g = quiet();
    g.regions.yeosu.owner = 'japan';
    const a = fleet(g, 'joseon', 'myeongnyang', ['panokseon']);
    const b = fleet(g, 'japan', 'yeosu', ['atakebune']);
    a.at = null; a.transit = { from: 'myeongnyang', to: 'yeosu', left: 2, sailed: 30 }; a.route = ['yeosu'];
    b.at = null; b.transit = { from: 'yeosu', to: 'myeongnyang', left: 2, sailed: 30 }; b.route = ['myeongnyang'];
    g.player = 'joseon';
    const report = endTurn(g);
    const sea = report.contacts.find((c) => c.sea);
    assert.ok(sea, 'they met on the lane');
    assert.ok(sea.sea.t > 0 && sea.sea.t < 1);
    const rb = describeContact(g, sea);
    assert.equal(rb.defenderBuildings.length, 0, 'no works out at sea');
    assert.equal(rb.battery, 0);
    console.log('ok   fleets meet where their ways cross, and the sea fight has no port works');
  }

  // A port holding an enemy fleet stops a fleet that would sail through it.
  {
    const g = quiet();
    const mover = fleet(g, 'joseon', 'hansan', ['panokseon']);
    // Refitting, the Japanese fleet gets no orders from its own navy and stays where it lies.
    fleet(g, 'japan', 'dangpo', ['atakebune']).rest = 3;
    // The route is planned through Dangpo (Joseon water); the Japanese fleet lying there holds the passage.
    mover.route = ['dangpo', 'mijo'];
    g.player = 'joseon';
    const report = endTurn(g);
    assert.equal(mover.at, 'dangpo');
    assert.ok(report.contacts.some((c) => c.regionId === 'dangpo'), 'the passage is fought for');
    console.log('ok   a port with an enemy fleet in it stops whoever sails in');
  }

  // Fleets lying close by join a fight when it gives their side a chance; a hopeless one they stay out of.
  {
    const g = quiet();
    for (const id of ['hansan', 'dangpo']) g.regions[id].owner = 'joseon';
    g.regions.hansan.garrison = [];
    g.regions.dangpo.garrison = [];
    const near = fleet(g, 'joseon', 'dangpo', ['panokseon', 'panokseon', 'panokseon']);
    // Already under way (the computer replans only fleets lying idle), the raider is a lane's few km off Hansan.
    const raider = fleet(g, 'japan', 'gyeonnaeryang', ['atakebune', 'atakebune', 'sekibune']);
    g.regions.gyeonnaeryang.owner = 'japan';
    raider.at = null;
    raider.transit = { from: 'gyeonnaeryang', to: 'hansan', left: 1, sailed: 2 };
    raider.route = ['hansan'];
    const port = fleet(g, 'joseon', 'hansan', ['hyeopseon']);
    assert.ok(laneKm(g, 'hansan', 'dangpo') <= MARCH.reinforce);
    g.player = 'joseon';
    const report = endTurn(g);
    const fight = report.contacts.find((c) => c.regionId === 'hansan');
    assert.ok(fight, 'Hansan is attacked');
    assert.ok(fight.reinforcements.includes(near.id), 'the Dangpo fleet comes to help');
    assert.ok(fight.defenderFleets.includes(near.id) && fight.defenderFleets.includes(port.id));
    const lone = quiet();
    for (const id of ['hansan', 'dangpo']) lone.regions[id].owner = 'joseon';
    lone.regions.hansan.garrison = [];
    const scout = fleet(lone, 'joseon', 'dangpo', ['hyeopseon']);
    const armada = fleet(lone, 'japan', 'gyeonnaeryang', Array(12).fill('atakebune'));
    lone.regions.gyeonnaeryang.owner = 'japan';
    armada.at = null;
    armada.transit = { from: 'gyeonnaeryang', to: 'hansan', left: 1, sailed: 2 };
    armada.route = ['hansan'];
    fleet(lone, 'joseon', 'hansan', ['hyeopseon']);
    lone.player = 'joseon';
    const lost = endTurn(lone).contacts.find((c) => c.regionId === 'hansan');
    assert.ok(lost && !lost.reinforcements.includes(scout.id), 'a lone boat does not throw itself into a lost fight');
    console.log('ok   reinforcements join only with a fighting chance');
  }

  // A blockade: no income, the garrison starves, and the port gives up after it has held out.
  {
    const g = quiet();
    g.regions.angolpo.owner = 'japan';
    const r = g.regions.angolpo;
    r.buildings = [];
    const weak = r.garrison.length;
    assert.ok(weak > 0);
    const blockade = fleet(g, 'joseon', 'jepo', Array(8).fill('panokseon'));
    g.regions.jepo.owner = 'joseon';
    assert.ok(orders.orderMove(g, blockade.id, 'angolpo', true).ok);
    assert.equal(blockade.besieging, true);
    sail(g);
    assert.equal(blockade.at, 'angolpo');
    assert.ok(r.siege && r.siege.by === 'joseon', 'the blockade began');
    assert.equal(regionIncome(g, 'angolpo'), 0, 'a blockaded port trades nothing');
    const hold = r.siege.hold;
    for (let k = 0; k < hold + 1 && r.owner === 'japan'; k++) sail(g);
    assert.equal(r.owner, 'joseon', 'the garrison gave up');
    assert.equal(r.siege, undefined);
    assert.equal(blockade.besieging, false);
    console.log(`ok   a blockade starves a port into giving up after ${hold} turns`);
  }

  // A blockade too weak for the garrison is fought off instead of holding.
  {
    const g = quiet();
    g.regions.angolpo.owner = 'japan';
    g.regions.jepo.owner = 'joseon';
    const boat = fleet(g, 'joseon', 'jepo', ['hyeopseon']);
    assert.ok(orders.orderMove(g, boat.id, 'angolpo', true).ok);
    g.player = 'joseon';
    const report = endTurn(g);
    assert.ok(report.contacts.some((c) => c.regionId === 'angolpo'), 'the garrison sallies against a weak blockade');
    console.log('ok   a garrison sallies against a blockade weaker than itself');
  }

  // The forced march may not attack; a player can turn an assault into a blockade or withdraw from a fight.
  {
    const g = quiet();
    g.player = 'joseon';
    g.regions.angolpo.owner = 'japan';
    g.regions.jepo.owner = 'joseon';
    const fl = fleet(g, 'joseon', 'jepo', Array(8).fill('panokseon'));
    assert.ok(orders.orderStance(g, fl.id, 'march').ok);
    assert.equal(orders.orderMove(g, fl.id, 'angolpo').ok, false, 'no attack on a forced march');
    assert.ok(orders.orderStance(g, fl.id, 'normal').ok);
    assert.ok(orders.orderMove(g, fl.id, 'angolpo').ok);
    endTurn(g);
    assert.equal(g.phase, 'battles');
    const c = g.pending[0];
    assert.ok(turn.besiegeContact(g, c.id, 'joseon').ok);
    assert.equal(g.regions.angolpo.siege?.by, 'joseon');
    assert.equal(fl.besieging, true);
    assert.equal(g.phase, 'orders');
    // Storming it later.
    assert.ok(orders.orderAssault(g, fl.id, true).ok);
    endTurn(g);
    const storm = g.pending.find((p) => p.regionId === 'angolpo');
    assert.ok(storm && storm.siege, 'the assault is a fight at the blockaded port');
    assert.ok(turn.withdrawContact(g, storm.id, 'joseon').ok);
    assert.ok(!g.pending.some((p) => p.id === storm.id), 'withdrawn, the fight is off');
    assert.notEqual(fl.at, 'angolpo');
    console.log('ok   forced march cannot attack; assault into blockade, storm order, withdrawal');
  }

  // Grades of a win, the replay through the ports called at, and determinism with save/load in the middle.
  {
    assert.equal(battleGrade(1000, 100, 1000, 800), 'decisive');
    assert.equal(battleGrade(400, 100, 1000, 600), 'heroic');
    assert.equal(battleGrade(1000, 600, 1000, 900), 'pyrrhic');
    assert.equal(battleGrade(1000, 350, 1000, 500), 'close');
    const g = quiet();
    const fl = fleet(g, 'joseon', 'dangpo', ['panokseon']);
    assert.ok(orders.orderMove(g, fl.id, 'geoje').ok);
    const before = structuredClone(g);
    const report = sail(g);
    const replay = buildReplay(before, g, report.contacts, 'joseon');
    const move = replay.moves.find((m) => m.fleetId === fl.id);
    assert.ok(move && move.path.length > 2, 'the playback calls at the ports between');
    const a = newGrand(null, 4242), b = newGrand(null, 4242);
    for (let k = 0; k < 12; k++) {
      endTurn(a);
      const saved = JSON.parse(JSON.stringify(b));
      endTurn(saved);
      Object.assign(b, saved);
    }
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'the same war plays the same through a save and load');
    console.log('ok   grades, replay through called ports, determinism through save/load');
  }

  // A save without `march` keeps one lane a turn.
  {
    const g = quiet();
    delete g.march;
    const fl = fleet(g, 'joseon', 'dangpo', ['panokseon']);
    assert.ok(orders.orderMove(g, fl.id, 'geoje').ok);
    sail(g);
    assert.notEqual(fl.at, 'geoje', 'lane rules: one lane per turn');
    assert.equal(fl.route.length, 1);
    console.log('ok   saves without march keep the lane rules');
  }
  // Found in review: no fleet in two meetings, no slipping past at a quay, a detachment keeps a blockade, only the attacker
  // blockades, a withdrawal never sinks a fleet, and a fight the player leaves is settled at once.
  {
    const lane = laneKm(undefined, 'myeongnyang', 'yeosu');
    const atSea = (g, faction, kinds, from, to, sailed, route) => {
      const fl = fleet(g, faction, null, kinds);
      fl.transit = { from, to, left: 1, sailed };
      fl.route = route;
      fl.from = from;
      return fl;
    };
    for (let rs = 30; rs < 70; rs += 2) for (let ss = 25; ss < rs; ss += 2) {
      const g = quiet();
      atSea(g, 'joseon', ['hyeopseon'], 'yeosu', 'myeongnyang', lane - rs, ['myeongnyang']).stance = 'march';
      atSea(g, 'japan', ['atakebune'], 'yeosu', 'myeongnyang', lane - ss, ['myeongnyang']);
      atSea(g, 'japan', ['atakebune'], 'myeongnyang', 'yeosu', 20, []);
      atSea(g, 'joseon', ['panokseon'], 'myeongnyang', 'yeosu', 10, ['yeosu']);
      const seen = new Set();
      for (const m of march.marchFleets(g)) for (const id of m.fleets) { assert.ok(!seen.has(id), 'a fleet stands in one meeting only'); seen.add(id); }
    }
    for (const order of ['port first', 'sea first']) {
      const g = quiet();
      const out = fleet(g, 'joseon', 'myeongnyang', ['panokseon']);
      out.route = ['yeosu'];
      const inbound = atSea(g, 'japan', ['atakebune'], 'yeosu', 'myeongnyang', lane - 1.5, ['myeongnyang']);
      if (order === 'sea first') g.fleets.reverse();
      march.marchFleets(g);
      assert.equal(out.at, 'myeongnyang', `${order}: caught at the quay`);
      assert.equal(inbound.at, 'myeongnyang', `${order}: the arrival stops there too`);
    }
    {
      const g = quiet();
      g.player = 'joseon';
      g.regions.angolpo.owner = 'japan';
      g.regions.angolpo.buildings = [];
      g.regions.jepo.owner = 'joseon';
      const fl = fleet(g, 'joseon', 'angolpo', Array(8).fill('panokseon'));
      fl.besieging = true;
      g.regions.angolpo.siege = { by: 'joseon', turns: 0, hold: 3 };
      const split = orders.orderSplit(g, fl.id, [fl.ships[0].id]);
      assert.ok(split.ok);
      assert.equal(g.fleets.find((f) => f.id === split.note).besieging, true, 'the detachment keeps the blockade');
      const report = endTurn(g);
      assert.ok(!report.contacts.some((c) => c.regionId === 'angolpo'), 'a split does not turn the blockade into an assault');
    }
    {
      const g = quiet();
      g.player = 'joseon';
      const raider = atSea(g, 'japan', Array(6).fill('atakebune'), 'gyeonnaeryang', 'hansan', 2, ['hansan']);
      g.regions.gyeonnaeryang.owner = 'japan';
      endTurn(g);
      const c = g.pending.find((p) => p.regionId === 'hansan');
      assert.ok(c, 'Hansan is attacked');
      assert.equal(turn.besiegeContact(g, c.id, 'joseon').ok, false, 'the defender cannot turn the attack into a blockade');
      assert.ok(raider.at === 'hansan');
    }
    {
      const g = quiet();
      g.player = 'joseon';
      // A Joseon fleet trapped in Hansan with every way out held by Japan cannot withdraw: it would only sink.
      for (const l of ['dangpo', 'gabaeryang', 'gyeonnaeryang', 'sacheon', 'noryang', 'geoje']) g.regions[l].owner = 'japan';
      const own = fleet(g, 'joseon', 'hansan', ['panokseon']);
      atSea(g, 'japan', Array(4).fill('atakebune'), 'gyeonnaeryang', 'hansan', 2, ['hansan']);
      endTurn(g);
      const c = g.pending.find((p) => p.regionId === 'hansan');
      assert.ok(c);
      assert.equal(turn.withdrawContact(g, c.id, 'joseon').ok, false, 'nowhere to fall back to: no withdrawal');
      assert.ok(g.fleets.includes(own), 'the fleet is still there to fight');
    }
    {
      const g = quiet();
      g.player = 'joseon';
      // Japan attacks Ming-held Hansan; the player's fleet in Dangpo comes to help, then withdraws: the fight goes on without the player.
      g.regions.hansan.owner = 'ming';
      fleet(g, 'joseon', 'dangpo', Array(6).fill('panokseon'));
      atSea(g, 'japan', Array(5).fill('atakebune'), 'gyeonnaeryang', 'hansan', 2, ['hansan']);
      g.regions.gyeonnaeryang.owner = 'japan';
      endTurn(g);
      const c = g.pending.find((p) => p.regionId === 'hansan');
      assert.ok(c && c.reinforcements.length, 'the Joseon fleet joined as a reinforcement');
      assert.ok(turn.withdrawContact(g, c.id, 'joseon').ok);
      assert.ok(!g.pending.some((p) => p.id === c.id), 'settled by the numbers once the player is out of it');
    }
    console.log('ok   one meeting per fleet, caught at the quay, detachments keep blockades, blockade and withdrawal rules');
  }
  console.log('grand march: all checks passed');
} finally {
  await server.close();
}
