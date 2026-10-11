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
const { factionIncome, factionUpkeep, shipDef, TUNING, garrisonCap, garrisonPowerBudget, GARRISON_KIND, listStrength, buildingCost, buildingWorkTotal, queueSlots, migrateGrandBalance } = await load('/src/sim/grand/economy.ts');
const { shipSpec } = await load('/src/sim/competitive.ts');
const turn = await load('/src/sim/grand/turn.ts');
const spawn = await load('/src/sim/grand/spawn.ts');
const { SHIP_SPECS } = await load('/src/sim/catalog.ts');
const { josa } = await load('/src/sim/grand/josa.ts');
const events = await load('/src/sim/grand/events.ts');
const { buildReplay, isEmpty } = await load('/src/sim/grand/replay.ts');
const { dateOf, dateLabel } = await load('/src/sim/grand/economy.ts');
const { REGION_MAPS, REGION_SITES } = await load('/src/sim/grand/coast.ts');
const { generateHeightmap } = await load('/src/terrain/generate.ts');
const { SIM_DT } = await load('/src/sim/battle.ts');

// The land sampler of a region's terrain as the engine hands it to the builder: world coordinates, the map turned by `axis`.
const heightmaps = new Map();
function landOf(spec, axis = 0) {
  let h = heightmaps.get(spec.seed + ':' + spec.size);
  if (!h) heightmaps.set(spec.seed + ':' + spec.size, (h = generateHeightmap(spec)));
  const { size, res } = spec;
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  return (wx, wz) => {
    const sx = wx * ca + wz * sa;
    const sz = -wx * sa + wz * ca;
    const fx = ((sx + size / 2) / size) * res - 0.5;
    const fz = ((sz + size / 2) / size) * res - 0.5;
    const x0 = Math.max(0, Math.min(res - 2, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(res - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const tz = Math.max(0, Math.min(1, fz - z0));
    const a = h[z0 * res + x0];
    const b = h[z0 * res + x0 + 1];
    const c = h[(z0 + 1) * res + x0];
    const d = h[(z0 + 1) * res + x0 + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };
}

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failed += 1;
};

function playOut(g) {
  for (let guard = 0; guard < 60 && g.phase !== 'over'; guard += 1) endTurn(g);
  return g;
}

// Fresh guards share a power budget. Loading an old count-based region does not alter its ships or rule.
{
  const g = newGrand('ming', 123), sample = structuredClone(g.regions.shandong);
  check('new campaigns mark guard power rules without changing an old region', Object.values(g.regions).every((r) => r.garrisonRule === 'equal-power-v2') && g.forces === 'wide-v1' && (() => {
    delete sample.garrisonRule; delete sample.garrisonReserve;
    const before = JSON.stringify(sample); garrisonCap('shandong', sample);
    return before === JSON.stringify(sample);
  })());
  const budgets = ['joseon', 'japan', 'ming'].map((f) => {
    const r = { ...sample, owner: f, garrisonRule: 'equal-power-v2' }, power = shipDef(GARRISON_KIND[f]).strength;
    return Math.abs(garrisonCap('shandong', r) * power - garrisonPowerBudget('shandong', r)) <= power * 0.5 + 1e-9;
  });
  check('all guard rosters buy the same power budget within one half of their hull denomination', budgets.every(Boolean));
  g.fleets = []; for (const f of ['joseon', 'japan']) g.factions[f].gold = -1e9;
  for (const ev of events.EVENTS) g.events.done[ev.id] = -2;
  g.events.pending = null;
  const r = g.regions.shandong; r.garrison = [];
  for (let i = 0; i < 6; i++) endTurn(g);
  check('guard reinforcement carries fractional power between turns without gifting expensive boats every turn', Math.abs(listStrength(r.garrison) + r.garrisonReserve - 6 * shipDef(GARRISON_KIND.joseon).strength * TUNING.garrison.regen * TUNING.forceScale) < 1e-7);
}

{
  const g = newGrand(null, 123), legacy = structuredClone(g), baseline = Object.fromEntries(['joseon', 'japan', 'ming'].map((f) => [f, turn.scoreOf(g, f)]));
  g.victoryRules = turn.growthVictoryRules(g);
  const initial = structuredClone(g.victoryRules);
  check('common objective progress starts at zero and territory score subtracts each opening holding', ['joseon', 'japan', 'ming'].every((f) => turn.objectiveProgress(g, f).have === 0 && turn.scoreOf(g, f) === baseline[f] - initial.initialControl[f] * TUNING.score.region));
  g.regions.busan.owner = 'ming'; g.regions.tsushima.owner = 'ming';
  legacy.regions.busan.owner = 'ming'; legacy.regions.tsushima.owner = 'ming';
  check('a legacy objective retains its original two ports while common objectives require net growth', turn.objectiveMet(legacy, 'ming') && !turn.objectiveMet(g, 'ming') && JSON.stringify(initial) === JSON.stringify(g.victoryRules));
  const copy = JSON.parse(JSON.stringify(g)); playOut(g); playOut(copy);
  check('common growth rules reload and continue deterministically', JSON.stringify(g) === JSON.stringify(copy));
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
  const navies = { joseon: { home: 'yeosu', kinds: ['panokseon', 'geobukseon', 'hyeopseon'] }, japan: { home: 'nagoya', kinds: ['atakebune', 'sekibune', 'kobaya'] }, ming: { home: 'liaodong', kinds: ['mingship', 'mingsmall'] } };
  for (const [faction, { home, kinds }] of Object.entries(navies)) {
    const g = newGrand(faction, 4801), r = g.regions[home];
    g.factions[faction].gold = 5000; g.factions[faction].unlocked.push('geobukseon');
    const yard = r.buildings.find((b) => b.kind === 'shipyard');
    check(`${faction}: all new ship orders use the common ${TUNING.shipSecondsPerTurn}-seconds-per-turn rate`, kinds.every((kind) => shipDef(kind).turns === Math.max(1, Math.ceil(shipSpec(kind).build / TUNING.shipSecondsPerTurn))));
    check(`${faction}: completed yard levels provide 4, 6 and 8 parallel slots`, [1, 2, 3].every((level) => { yard.level = level; return queueSlots(r) === (level + 1) * 2; }));
    yard.level = 1;
    check(`${faction}: four fresh jobs fit a level-one yard and a fifth is rejected`, [0, 1, 2, 3].every(() => orders.orderRecruit(g, home, kinds.at(-1)).ok) && !orders.orderRecruit(g, home, kinds.at(-1)).ok);
    for (const q of [...r.queue]) orders.cancelRecruit(g, home, q.id);
    const kind = kinds[0], oldTotal = Math.ceil(shipSpec(kind).build / 18);
    r.queue.push({ id: 'legacy-production', kind, left: oldTotal, total: oldTotal, paidGold: 300 });
    const reloaded = JSON.parse(JSON.stringify(g)); migrateGrandBalance(reloaded);
    check(`${faction}: loading preserves existing ship left, total and amount paid`, JSON.stringify(reloaded.regions[home].queue) === JSON.stringify(r.queue));
    const before = r.queue[0]; endTurn(g);
    while (g.pending.length) autoResolveContact(g, g.pending[0].id);
    check(`${faction}: an existing multi-turn ship advances exactly one old turn`, before.left === oldTotal - 1 && before.total === oldTotal);
  }
  const g = newGrand('joseon', 4802), r = g.regions.hansan;
  r.buildings = [{ kind: 'dock', level: 0, upgradeLeft: 3, hp: 1 }];
  check('an unstarted saved old building still cancels at its old three-turn duration', buildingWorkTotal(r.buildings[0]) === 3 && orders.cancelBuild(g, 'hansan', 'dock').ok);
  r.buildings = [{ kind: 'dock', level: 0, upgradeLeft: 2, hp: 1 }];
  check('a saved old partially worked building cannot become cancelable under the new two-turn rule', !orders.cancelBuild(g, 'hansan', 'dock').ok);
  r.buildings = []; const gold = g.factions.joseon.gold;
  check('a fresh work records its new duration and fully refunds only before the first turn', orders.orderBuild(g, 'hansan', 'dock').ok && r.buildings[0].upgradeTotal === buildingCost('dock', 1).turns && orders.cancelBuild(g, 'hansan', 'dock').ok && g.factions.joseon.gold === gold);
}
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
        check(`battle ${played + auto + 1}: seats and teams are described`, rb.attacker.ships.length > 0 && rb.attacker.team !== rb.defender.team && rb.options.tickets === 500 && rb.mapId === rb.regionId);
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
  // Geography and the number of ports differ. The war cohort measures outcomes; this guards a viable opening economy.
  const main = { joseon: 'panokseon', japan: 'atakebune', ming: 'mingship' };
  check(`each opening treasury can finance a main ship after upkeep (${JSON.stringify(income)})`, Object.entries(main).every(([f, kind]) => income[f] - factionUpkeep(g, f) >= shipDef(kind).gold));
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
  for (const player of [null, 'japan']) {
    const g = newGrand(player, 4803), japan = g.fleets.filter((fl) => fl.faction === 'japan');
    const small = japan[0], large = japan[1];
    small.at = 'jepo'; small.route = ['angolpo', 'busan']; small.transit = null; small.rest = 0; small.ships = small.ships.slice(0, 1);
    large.at = 'dadaepo'; large.route = ['busan', 'angolpo']; large.transit = null; large.rest = 0;
    g.fleets = [small, large];
    g.regions.busan.owner = g.regions.angolpo.owner = 'japan';
    endTurn(g);
    check(player ? 'player-written friendly routes remain intact when their final legs cross' : 'multi-leg computer routes consolidate instead of leaving opposite final legs', small.at === 'angolpo' && large.at === 'busan' && small.route[0] === 'busan' && (player ? large.route[0] === 'angolpo' : large.route.length === 0));
  }
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
  const land = landOf(REGION_MAPS.hansan.terrain, 0.4);
  const built = spawn.buildGrandConquest(rb, land, 0.4);
  const ships = built.battle.ships;
  check('every campaign ship is in the battle and afloat', ships.length === rb.attacker.ships.length + rb.defender.ships.length && ships.every((s) => s.campaignId && land(s.x, s.z) < -4));
  const worn = ships.find((s) => s.campaignId === jp.ships[0].id);
  const wornCrew = ships.find((s) => s.campaignId === jp.ships[1].id);
  check('hull, crew and name carry over', Math.abs(worn.hull / worn.spec.hull - 0.5) < 1e-6 && worn.name === jp.ships[0].name && Math.abs(wornCrew.crew / wornCrew.spec.crew - 0.4) < 1e-6);
  check('the sides sit in their own seats and teams', ships.filter((s) => s.owner === 0).length === rb.attacker.ships.length && ships.every((s) => s.team === (s.owner === 0 ? rb.attacker.team : rb.defender.team)));
  const home = built.conquest.homeOf(1);
  const kinds = home.buildings.filter(Boolean).map((b) => b.kind);
  check(`the defender's port stands with its works (${kinds.join(',')})`, kinds.includes('shipyard') && kinds.includes('battery') && built.conquest.homeOf(0).buildings.every((b) => !b));
  check('funds and options follow the description with no ship or fleet-value cap', built.conquest.players[0].funds === rb.options.startFunds.attacker && built.conquest.players[1].funds === rb.options.startFunds.defender && built.conquest.options.tickets === 500 && built.conquest.options.maxShips === Infinity && built.conquest.options.cap === Infinity);
  check('the outcome lists one entry per campaign ship', spawn.shipOutcomes(ships).length === ships.length);
  check('untouched works are not razed', spawn.worksAfter(rb, built.conquest).razed.length === 0);
  const slot = home.buildings.findIndex((b) => b && b.kind === 'battery');
  home.buildings[slot] = null;
  check('a battery that fell is reported razed', spawn.worksAfter(rb, built.conquest).razed.join() === 'battery');
  for (let i = 0; i < Math.round(60 / SIM_DT); i += 1) built.battle.step(SIM_DT);
  check('the battle runs', built.battle.ships.length > 0);
}

// 7. Every region fights on its own coast: real terrain, capture points on the water by a shore, no ship aground.
{
  const g = newGrand('japan', 3);
  const jp = g.fleets.filter((f) => f.faction === 'japan').map((f) => f.id);
  const jo = g.fleets.filter((f) => f.faction === 'joseon').map((f) => f.id);
  const bad = [];
  for (const id of REGION_ORDER) {
    const map = REGION_MAPS[id];
    const g2 = structuredClone(g);
    g2.regions[id].owner = 'joseon';
    g2.regions[id].buildings = [{ kind: 'shipyard', level: 1, upgradeLeft: 0, hp: 1 }, { kind: 'battery', level: 2, upgradeLeft: 0, hp: 1 }];
    const c = { id: 'r', regionId: id, attacker: 'japan', defender: 'joseon', attackerFleets: jp, defenderFleets: jo, player: true };
    g2.pending.push(c);
    const rb = bridge.describeContact(g2, c);
    const axis = spawn.grandAxis(rb);
    const land = landOf(map.terrain, axis * 0.5 + 0.3);
    const built = spawn.buildGrandConquest(rb, land, axis * 0.5 + 0.3);
    const pts = built.conquest.points;
    const homes = [built.conquest.homeOf(0), built.conquest.homeOf(1)];
    const gap = Math.hypot(homes[0].x - homes[1].x, homes[0].z - homes[1].z);
    if (pts.length < 3 || pts.length > 5) bad.push(`${id}: ${pts.length} points`);
    if (pts.some((p) => land(p.x, p.z) > -6)) bad.push(`${id}: a capture point on land`);
    if (homes.some((h) => h.slots.length < 3)) bad.push(`${id}: a home port without room for works`);
    if (gap < 1000 || gap > 1400) bad.push(`${id}: ports ${gap.toFixed(0)} m apart`);
    const aground = built.battle.ships.filter((s) => land(s.x, s.z) > -4).length;
    if (aground) bad.push(`${id}: ${aground} ships aground`);
    if (!map.current || !Number.isFinite(map.current.peak) || map.current.peak <= 0) bad.push(`${id}: no designed coastal current`);
    if (!map.terrain.reserve.length) bad.push(`${id}: shore works not kept clear`);
    const again = REGION_MAPS[id].points.map((p) => `${p.x},${p.z}`).join();
    if (again !== map.points.map((p) => `${p.x},${p.z}`).join()) bad.push(`${id}: map changes between reads`);
    if (rb.mapId !== id || REGION_SITES[id].terrain === undefined) bad.push(`${id}: no map`);
    // The computer plays the whole battle through on this coast.
    built.conquest.autopilot = true;
    for (const p of built.conquest.players) built.conquest.setHuman(p.slot, false);
    for (let i = 0; i < Math.round(60 * 6 / SIM_DT) && !built.battle.ended; i += 1) built.battle.step(SIM_DT);
    if (built.battle.ships.some((s) => !Number.isFinite(s.x) || !Number.isFinite(s.z))) bad.push(`${id}: a ship left the world`);
  }
  check(`all ${REGION_ORDER.length} regions have a coast to fight on${bad.length ? ': ' + bad.join('; ') : ''}`, !bad.length);
}

{
  check('josa picks the particle from the final sound', josa('옥포', '을/를') === '옥포를' && josa('일본', '은/는') === '일본은' && josa('명', '이/가') === '명이' && josa('한산도', '과/와') === '한산도와' && josa('쓰시마', '이/가') === '쓰시마가');
  check('josa 로 follows ㄹ like a vowel', josa('서울', '으로/로') === '서울로' && josa('조선', '으로/로') === '조선으로' && josa('여수', '으로/로') === '여수로');
  check('josa reads digits, letters and a trailing note', josa('Lv3', '이/가') === 'Lv3이' && josa('HMS', '은/는') === 'HMS는' && josa('나고야 (히젠)', '이/가') === '나고야 (히젠)가');
  const war = playOut(newGrand(null, 77));
  check('no particle placeholders in a played campaign log', !war.log.some((e) => /\((이|가|을|를|은|는|과|와|으)\)/.test(e.text)));
  // The log keeps Korean templates and their params, so the interface can write each line in the language set when it is read.
  const holes = war.log.filter((e) => [...e.text.matchAll(/\{(\w+)(?:\|[^}]+)?\}/g)].some((m) => e.params?.[m[1]] === undefined));
  check('every placeholder of a log line has its param', war.log.length > 10 && holes.length === 0);
  check('log lines carry names as params, not finished sentences', war.log.some((e) => e.params && Object.values(e.params).some((v) => typeof v === 'string')));
}

// 8. The calendar and the scripted events of the war's history.
{
  check('a turn is a season: turn 1 is April 1592, turn 4 January 1593, turn 21 April 1597', dateLabel(1) === '1592년 4월' && dateLabel(4) === '1593년 1월' && dateLabel(21) === '1597년 4월' && dateOf(27).year === 1598);
  const badDate = events.EVENTS.filter((e) => e.headline.slice(0, dateLabel(e.turn).length) !== dateLabel(e.turn));
  check(`every event's headline opens with the date of its turn${badDate.length ? ' (' + badDate.map((e) => e.id).join() + ')' : ''}`, badDate.length === 0);
  check('every event has a card and two described answers for each navy it names', events.EVENTS.every((e) => Object.values(e.cards).every((c) => c.choices.length === 2 && c.choices.every((x) => events.describeEffect(x.effect).length > 0))));

  const g = newGrand('joseon', 21);
  check('the first card is dealt to the player at the start of the war', g.events.pending === 'busan_landing' && events.pendingCard(g)?.card.choices.length === 2);
  const gold0 = g.factions.joseon.gold;
  const ships0 = g.fleets.length;
  const answered = events.chooseEvent(g, 1);
  check('answering applies the choice, closes the card and cannot be repeated', answered.ok && g.events.pending === null && g.factions.joseon.gold === gold0 + 250 && g.events.done.busan_landing === 1 && !events.chooseEvent(g, 0).ok && g.fleets.length === ships0);
  const ai = newGrand(null, 21);
  check('with nobody at the table the computer navies answer at once', ai.events.pending === null && ai.events.done.busan_landing === -2);
  const twin = newGrand('joseon', 21);
  events.chooseEvent(twin, 1);
  check('the same seed and answer give the same war', JSON.stringify(twin) === JSON.stringify(g));

  // A save with a card waiting reloads into the same card and goes on identically.
  const saved = newGrand('japan', 8);
  const copy = JSON.parse(JSON.stringify(saved));
  events.chooseEvent(saved, 0);
  events.chooseEvent(copy, 0);
  for (let i = 0; i < 25; i += 1) {
    if (saved.phase === 'over') break;
    planAi(saved, 'japan');
    planAi(copy, 'japan');
    endTurn(saved);
    endTurn(copy);
    for (const c of [...saved.pending]) autoResolveContact(saved, c.id);
    for (const c of [...copy.pending]) autoResolveContact(copy, c.id);
    if (saved.events.pending) events.chooseEvent(saved, 1);
    if (copy.events.pending) events.chooseEvent(copy, 1);
  }
  check('a reloaded war with its cards goes on identically', JSON.stringify(saved) === JSON.stringify(copy) && saved.events.done.busan_landing === 0);
  // A war may end before the fourth scheduled card. Exercise the entire event calendar independently of that victory.
  const calendar = newGrand('japan', 8), calendarCopy = JSON.parse(JSON.stringify(calendar));
  events.chooseEvent(calendar, 0); events.chooseEvent(calendarCopy, 0);
  for (const card of events.EVENTS) {
    calendar.turn = card.turn; calendarCopy.turn = card.turn;
    events.fireEvents(calendar); events.fireEvents(calendarCopy);
    if (calendar.events.pending) events.chooseEvent(calendar, 1);
    if (calendarCopy.events.pending) events.chooseEvent(calendarCopy, 1);
  }
  check('all scheduled cards remain identical after reload even when a war can end early', JSON.stringify(calendar) === JSON.stringify(calendarCopy) && Object.keys(calendar.events.done).length === events.EVENTS.length);

  // The path of Yi Sun-sin through 1597: taken off his fleet, and brought back by the next card.
  const yi = newGrand('joseon', 4);
  events.chooseEvent(yi, 0);
  const flag = yi.fleets.find((f) => f.commanderId === 'yi');
  yi.turn = 21;
  events.fireEvents(yi);
  check('the arrest card waits for the player', yi.events.pending === 'yi_arrest');
  events.chooseEvent(yi, 0);
  check('obeying the court takes him off his fleet', flag.commanderId === null && yi.events.flags.includes('yi_suspended'));
  yi.turn = 22;
  events.fireEvents(yi);
  check('the next card calls him back', yi.events.pending === 'yi_return');
  events.chooseEvent(yi, 1);
  check('and he commands a fleet again', yi.fleets.some((f) => f.commanderId === 'yi') && !yi.events.flags.includes('yi_suspended'));
  const kept = newGrand('joseon', 4);
  events.chooseEvent(kept, 0);
  kept.turn = 21;
  events.fireEvents(kept);
  events.chooseEvent(kept, 1);
  kept.turn = 22;
  events.fireEvents(kept);
  check('had the generals pleaded for him, no return card is needed', kept.events.pending === null && kept.fleets.some((f) => f.commanderId === 'yi'));

  // A pause on income runs out.
  const mod = newGrand('joseon', 4);
  events.chooseEvent(mod, 0);
  const full = factionIncome(mod, 'joseon');
  events.applyEffect(mod, 'joseon', { income: { mult: 0.5, turns: 2 } });
  const halved = factionIncome(mod, 'joseon');
  const turnOver = () => {
    endTurn(mod);
    for (const c of [...mod.pending]) autoResolveContact(mod, c.id);
  };
  turnOver();
  const during = mod.events.mods.length;
  turnOver();
  check(`income halved for two turns then back (${full} -> ${halved})`, halved === Math.round(full * 0.5) && during === 1 && mod.events.mods.length === 0);
}

// 9. The replay of a closed turn: fleets, meetings and captures as the player saw them.
{
  const g = newGrand('joseon', 1234);
  events.chooseEvent(g, 0);
  let moves = 0;
  let clashes = 0;
  let short = false;
  for (let t = 0; t < 10 && g.phase !== 'over'; t += 1) {
    const before = structuredClone(g);
    const report = endTurn(g);
    const replay = buildReplay(before, g, report.contacts, 'joseon');
    moves += replay.moves.length;
    clashes += replay.clashes.length;
    if (replay.moves.some((m) => m.path.length < 2)) short = true;
    if (g.events.pending) events.chooseEvent(g, 0);
    for (const c of [...g.pending]) autoResolveContact(g, c.id);
  }
  check(`ten turns replay (${moves} fleet moves, ${clashes} meetings)`, moves > 10 && clashes > 0 && !short);
  const quiet = newGrand('joseon', 5);
  check('a turn in which nothing moved replays as empty', isEmpty(buildReplay(quiet, structuredClone(quiet), [], 'joseon')));
}

await server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
