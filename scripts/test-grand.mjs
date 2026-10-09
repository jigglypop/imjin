// Checks of the faction campaign's rules, headless: determinism, save/load, the order API, the battle bridge.
//   node scripts/test-grand.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const load = (p) => server.ssrLoadModule(p);
const { newGrand, endTurn, autoResolveContact, MAX_TURNS } = await load('/src/sim/grand/turn.ts');
const { planAi } = await load('/src/sim/grand/ai.ts');
const orders = await load('/src/sim/grand/orders.ts');
const bridge = await load('/src/sim/grand/bridge.ts');
const { REGION_ORDER } = await load('/src/sim/grand/regions.ts');
const { factionIncome, TUNING } = await load('/src/sim/grand/economy.ts');
const turn = await load('/src/sim/grand/turn.ts');
const spawn = await load('/src/sim/grand/spawn.ts');
const { SHIP_SPECS } = await load('/src/sim/catalog.ts');

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failed += 1;
};

function playOut(g) {
  for (let guard = 0; guard < 60 && g.phase !== 'over'; guard += 1) endTurn(g);
  return g;
}

// 1. Determinism and save/load.
{
  const a = playOut(newGrand(null, 77));
  const b = playOut(newGrand(null, 77));
  check('same seed, same war', JSON.stringify(a) === JSON.stringify(b));
  const c = newGrand(null, 78);
  for (let i = 0; i < 9; i += 1) endTurn(c);
  const copy = JSON.parse(JSON.stringify(c));
  playOut(c);
  playOut(copy);
  check('a reloaded save goes on identically', JSON.stringify(c) === JSON.stringify(copy));
  const sizeKb = JSON.stringify(newGrand(null, 1)).length / 1024;
  check(`save stays small (${sizeKb.toFixed(0)} kB at the start)`, sizeKb < 120);
}

// 2. Invariants over many games.
{
  let bad = '';
  for (let seed = 1; seed <= 12 && !bad; seed += 1) {
    const g = newGrand(null, seed);
    while (g.phase !== 'over' && !bad) {
      endTurn(g);
      const ids = new Set();
      for (const fl of g.fleets) {
        if (!fl.ships.length) bad = `empty fleet ${fl.id}`;
        if (fl.at === null && !fl.transit) bad = `lost fleet ${fl.id}`;
        for (const u of fl.ships) {
          if (ids.has(u.id)) bad = `duplicate ship ${u.id}`;
          ids.add(u.id);
          if (u.hull <= 0 || u.hull > 1 || u.crew <= 0 || u.crew > 1) bad = `ship out of range ${u.id} ${u.hull} ${u.crew}`;
        }
      }
      for (const f of Object.values(g.factions)) if (f.gold < 0) bad = `negative gold ${f.faction}`;
      for (const id of REGION_ORDER) if (!g.regions[id].owner) bad = `ownerless ${id}`;
      if (g.turn > MAX_TURNS + 1) bad = 'ran past the horizon';
    }
  }
  check('no empty fleets, duplicate ships, negative gold or ownerless ports in 12 wars', !bad, bad);
}

// 3. The order API.
{
  const g = newGrand('joseon', 5);
  const yeosu = g.regions.yeosu;
  check('a port starts a granary', orders.orderBuild(g, 'hansan', 'granary').ok);
  check('the same work is refused while building', !orders.orderBuild(g, 'hansan', 'granary').ok);
  check('cancelling the new work refunds it', orders.cancelBuild(g, 'hansan', 'granary').ok && !g.regions.hansan.buildings.some((b) => b.kind === 'granary'));
  check('a second shipyard level needs a camp first', orders.buildRequirement(g, 'sacheon', 'shipyard', 2) !== null && orders.buildRequirement(g, 'yeosu', 'shipyard', 3) === null);
  const before = g.factions.joseon.gold;
  check('a ship is ordered at a shipyard', orders.orderRecruit(g, 'yeosu', 'panokseon').ok && g.factions.joseon.gold < before);
  check('a turtle ship is not designed yet', !orders.orderRecruit(g, 'yeosu', 'geobukseon').ok);
  check('an enemy ship cannot be built', !orders.orderRecruit(g, 'yeosu', 'atakebune').ok);
  check('no shipyard, no ship', !orders.orderRecruit(g, 'sacheon', 'hyeopseon').ok);
  const item = yeosu.queue[0];
  check('a fresh order is cancelled for the full price', orders.cancelRecruit(g, 'yeosu', item.id).ok && g.factions.joseon.gold === before);
  const fleet = g.fleets.find((f) => f.faction === 'joseon' && f.at === 'yeosu');
  check('a fleet sails to a far port', orders.orderMove(g, fleet.id, 'busan').ok && fleet.route.length === 4);
  check('a fleet cannot sail through an enemy port', orders.orderMove(g, fleet.id, 'tsushima').ok === false);
  check('no road to the far shore for an invader', (() => { const j = g.fleets.find((f) => f.faction === 'japan'); return orders.orderMove(g, j.id, 'shandong').ok === false; })());
  const first = g.fleets.find((f) => f.faction === 'joseon' && f.at === 'yeosu');
  const split = orders.orderSplit(g, first.id, first.ships.slice(0, 2).map((s) => s.id));
  check('a fleet splits', split.ok && g.fleets.some((f) => f.id === split.note));
  check('and merges back', orders.orderMerge(g, first.id, split.note).ok);
}

// 4. The battle bridge, played by a stand-in for the 3D engine, and auto-resolve.
{
  const g = newGrand('joseon', 9);
  let played = 0;
  let auto = 0;
  let stale = true;
  for (let guard = 0; guard < 80 && g.phase !== 'over'; guard += 1) {
    planAi(g, 'joseon');
    let report = endTurn(g);
    while (report.pending.length) {
      const c = report.pending[0];
      if ((played + auto) % 2 === 0) {
        const rb = bridge.describeBattle(g, c.id);
        // The "engine" reports the defender holding with every ship slightly worn.
        const ships = [...rb.attacker.ships, ...rb.defender.ships].map((s) => ({ campaignId: s.campaignId, alive: s.hull > 0.5, hull: s.hull * 0.8, crew: s.crew * 0.9, supply: s.supply * 0.8, kills: 0 }));
        const outcome = bridge.outcomeOfBattle(rb, rb.defender.team, ships);
        check(`battle ${played + auto + 1}: seats and teams are described`, rb.attacker.ships.length > 0 && rb.attacker.team !== rb.defender.team && rb.options.tickets === 500 && rb.mapId);
        if (!bridge.applyBattleResult(g, rb, outcome)) check('a played battle is applied', false);
        if (stale) {
          check('a second report of the same battle is refused', bridge.applyBattleResult(g, rb, outcome) === false);
          stale = false;
        }
        played += 1;
      } else {
        const r = autoResolveContact(g, c.id);
        if (!r) check('auto-resolve finds the waiting battle', false);
        auto += 1;
      }
      report = { pending: g.pending };
    }
  }
  check(`a player war runs to its end (${played} played, ${auto} auto-resolved, ${g.victory ? g.victory.faction + '/' + g.victory.kind : 'no victory'})`, g.phase === 'over' && played + auto > 0);
}

// 5. Economy sanity.
{
  const g = newGrand(null, 3);
  const income = Object.fromEntries(['joseon', 'japan', 'ming'].map((f) => [f, factionIncome(g, f)]));
  check(`opening incomes are close (${JSON.stringify(income)})`, Math.max(...Object.values(income)) / Math.min(...Object.values(income)) < 2.2);
}

// 6. Fixes and the 3D hand-off.
{
  // A fleet that fought rests two whole turns: the closing turn takes one off at once, so the order counts one more.
  const g = newGrand('joseon', 5);
  const jp = g.fleets.find((f) => f.faction === 'japan' && f.at === 'busan');
  g.turn = 3;
  orders.orderMove(g, jp.id, 'geoje');
  planAi(g, 'ming');
  const report = endTurn(g);
  check('a meeting with the player waits for a decision', report.pending.length === 1);
  autoResolveContact(g, report.pending[0].id);
  const rested = g.fleets.filter((f) => f.rest > 0);
  check(`fleets that fought rest ${TUNING.restAfterBattle} turns after the turn closes`, rested.length > 0 && rested.every((f) => f.rest === TUNING.restAfterBattle));
}
{
  // A razed shipyard builds nothing: the order waits in the queue.
  const g = newGrand('joseon', 6);
  orders.orderRecruit(g, 'yeosu', 'hyeopseon');
  const item = g.regions.yeosu.queue[0];
  g.regions.yeosu.buildings.find((b) => b.kind === 'shipyard').level = 0;
  endTurn(g);
  check('a ship ordered at a razed shipyard does not advance', item.left === item.total && g.regions.yeosu.queue.length === 1);
}
{
  // A beaten fleet falls back along the lane in as many turns as the lane is long.
  const lane = (from, to, owner, relation) => {
    const g = newGrand('joseon', 7);
    if (relation) g.relations[relation] = 'war';
    const fl = g.fleets.find((f) => f.faction === 'ming');
    fl.at = from === 'myeongnyang' ? 'myeongnyang' : 'busan';
    fl.from = to;
    g.regions[to].owner = owner;
    g.regions[fl.at].owner = 'joseon';
    const c = { id: 'x', regionId: fl.at, attacker: 'ming', defender: 'joseon', attackerFleets: [fl.id], defenderFleets: [], player: false };
    g.pending.push(c);
    turn.applyContactOutcome(g, c, { winner: 'defender', ships: [], razed: [] });
    return fl;
  };
  const far = lane('myeongnyang', 'shandong', 'ming', 'joseon:ming');
  check('a retreat along a three turn lane takes three turns', far.transit && far.transit.left === 2);
}
{
  // The computer never swaps two fleets between two ports.
  let swaps = 0;
  for (let seed = 1; seed <= 4; seed += 1) {
    const g = newGrand(null, seed);
    for (let t = 0; t < 30 && g.phase !== 'over'; t += 1) {
      for (const f of ['joseon', 'japan', 'ming']) {
        if (!g.factions[f].alive) continue;
        planAi(g, f);
        for (const a of g.fleets) for (const b of g.fleets) if (a !== b && a.faction === b.faction && a.at && b.at && a.at !== b.at && a.route[0] === b.at && b.route[0] === a.at && a.route.length === 1 && b.route.length === 1) swaps += 1;
      }
      endTurn(g);
    }
  }
  check(`no two fleets of one navy swap ports (${swaps})`, swaps === 0);
}
{
  // The conquest battle of a campaign meeting: the campaign's ships, the defender's works, the funds and the options.
  const g = newGrand('japan', 3);
  const jp = g.fleets.find((f) => f.faction === 'japan' && f.at === 'busan');
  jp.ships[0].hull = 0.5;
  jp.ships[1].crew = 0.4;
  const defenders = g.fleets.filter((f) => f.faction === 'joseon' && f.at === 'hansan').map((f) => f.id);
  const c = { id: 'h', regionId: 'hansan', attacker: 'japan', defender: 'joseon', attackerFleets: [jp.id], defenderFleets: defenders, player: true };
  g.pending.push(c);
  const rb = bridge.describeContact(g, c);
  const land = (x, z) => (z < -1700 ? 20 : -50);
  const built = spawn.buildGrandConquest(rb, land, 0);
  const ships = built.battle.ships;
  check('every campaign ship is in the battle', ships.length === rb.attacker.ships.length + rb.defender.ships.length && ships.every((s) => s.campaignId));
  const worn = ships.find((s) => s.campaignId === jp.ships[0].id);
  check('hull, crew and name carry over', Math.abs(worn.hull / worn.spec.hull - 0.5) < 1e-6 && worn.name === jp.ships[0].name && Math.abs(built.battle.get(ships.find((s) => s.campaignId === jp.ships[1].id).id).crew / SHIP_SPECS[jp.ships[1].kind].crew - 0.4) < 1e-6);
  check('the sides sit in their own seats and teams', ships.filter((s) => s.owner === 0).length === rb.attacker.ships.length && ships.every((s) => s.team === (s.owner === 0 ? rb.attacker.team : rb.defender.team)));
  const home = built.conquest.homeOf(1);
  const kinds = home.buildings.filter(Boolean).map((b) => b.kind);
  check(`the defender's port stands with its works (${kinds.join(',')})`, kinds.includes('shipyard') && kinds.includes('battery') && built.conquest.homeOf(0).buildings.every((b) => !b));
  check('funds and options follow the description', built.conquest.players[0].funds === rb.options.startFunds.attacker && built.conquest.players[1].funds === rb.options.startFunds.defender && built.conquest.options.tickets === 500 && built.conquest.options.maxShips === 30);
  check('the outcome lists one entry per campaign ship', spawn.shipOutcomes(ships).length === ships.length);
  check('untouched works are not razed', spawn.worksAfter(rb, built.conquest).razed.length === 0);
  const slot = home.buildings.findIndex((b) => b && b.kind === 'battery');
  home.buildings[slot] = null;
  check('a battery that fell is reported razed', spawn.worksAfter(rb, built.conquest).razed.join() === 'battery');
  for (let i = 0; i < 1200; i += 1) built.battle.step(1 / 20);
  check('the battle runs', built.battle.ships.length > 0);
}

await server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
