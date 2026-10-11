// Paired, equal-resource benchmarks. --cohort=holdout uses seeds excluded from tuning.
// node scripts/balance-competitive.mjs --mode=conquest --seeds=8 --map=hallyeo --out=shots/balance/train.json
// node scripts/balance-competitive.mjs --mode=autoresolve --seeds=200 --comps=default,heavy,mobile
// node scripts/balance-competitive.mjs --cohort=holdout --map=gyeonnaeryang --comps=default,heavy,mobile
// This is a seeded AI benchmark, not evidence of perfect balance between human players.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePaths = ['scripts/balance-competitive.mjs', 'src/sim/types.ts', 'src/sim/grand/types.ts', 'src/sim/catalog.ts', 'src/sim/scenarios.ts', 'src/sim/competitive.ts', 'src/sim/battle.ts', 'src/sim/visibility.ts', 'src/sim/current.ts', 'src/sim/environment.ts', 'src/sim/coastal-tactics.ts', 'src/sim/conquest.ts', 'src/sim/maps.ts', 'src/sim/strategy.ts', 'src/sim/grand/economy.ts', 'src/sim/grand/autoresolve.ts', 'src/sim/grand/turn.ts', 'src/sim/grand/ai.ts', 'src/sim/grand/events.ts', 'src/sim/grand/regions.ts', 'src/sim/grand/coast.ts', 'src/sim/grand/regionPoints.json', 'src/sim/grand/world.ts', 'src/sim/grand/orders.ts', 'src/sim/grand/bridge.ts', 'src/sim/grand/spawn.ts'];
const sourceHashes = Object.fromEntries(sourcePaths.map((p) => [p, createHash('sha256').update(readFileSync(join(root, p))).digest('hex')]));
const args = process.argv.slice(2);
const flag = (n, d) => args.find((s) => s.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const cohort = flag('cohort', 'train');
const modes = flag('mode', 'conquest,autoresolve').split(',');
const seeds = Number(flag('seeds', modes.includes('conquest') ? 4 : 200));
const ruleset = flag('ruleset', 'ranked');
if (!['ranked', 'ordinary'].includes(ruleset)) throw new Error('Unknown ruleset ' + ruleset);
const budget = Number(flag('budget', ruleset === 'ordinary' ? 15600 : 5200));
const cap = Number(flag('minutes', 30)) * 60;
const terrainMode = flag('terrain', 'map');
if (!['map', 'flat', 'banks'].includes(terrainMode)) throw new Error('Unknown diagnostic terrain ' + terrainMode);
const diplomacy = flag('diplomacy', 'map');
if (!['map', 'three-way', 'allied'].includes(diplomacy)) throw new Error('Unknown campaign diplomacy ' + diplomacy);
const victoryPolicy = flag('victory', 'map');
if (!['map', 'legacy', 'growth'].includes(victoryPolicy)) throw new Error('Unknown campaign victory policy ' + victoryPolicy);
const expedition = flag('expedition', 'map');
if (!['map', 'legacy', 'three-way'].includes(expedition)) throw new Error('Unknown campaign expedition policy ' + expedition);
const comps = flag('comps', 'default').split(',');
const maps = flag('map', 'hallyeo,gyeonnaeryang').split(',');
const startSeed = Number(flag('seed0', cohort === 'holdout' ? 3141592 : cohort === 'development' ? 97241 : 1592));
const factions = ['joseon', 'japan', 'ming'];
const pairs = flag('match', 'joseon:japan,joseon:ming,japan:ming,joseon:joseon,japan:japan,ming:ming').split(',').map((s) => s.split(':'));
if (!Number.isInteger(seeds) || seeds < 1 || !Number.isFinite(budget) || budget <= 0 || !Number.isFinite(cap) || cap <= 0) throw new Error('Seeds, budget and minutes must be positive finite values; seeds must be an integer.');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule('/src/sim/' + p + '.ts');
const { Battle, SIM_DT } = await load('battle');
const { shipSpec, shipMods, shipGunSpec, COMPETITIVE_UNITS, COMPETITIVE_APPRAISAL, combatStats, COMPETITIVE_PROFILE } = await load('competitive');
const { autoFleet, buildConquest, CONQUEST_MAPS, fleetCost, FLEET_MIX } = await load('maps');
const { ROSTER, RANKED_OPTIONS, DEFAULT_OPTIONS } = await load('conquest');
// The benchmark must not silently change when the general skirmish economy changes.
const battleOptions = ruleset === 'ranked' ? RANKED_OPTIONS : DEFAULT_OPTIONS;
const { autoResolve } = await load('grand/autoresolve');
const { shipDef, TUNING, factionIncome, factionUpkeep } = await load('grand/economy');
const { newGrand, endTurn, growthVictoryRules, controlValue, scoreOf, objectiveProgress } = await load('grand/turn');
const { generateHeightmap } = await server.ssrLoadModule('/src/terrain/generate.ts');
const { SEA_STATES } = await server.ssrLoadModule('/src/ocean/waves.ts');
// Candidate changes are process-local and must precede the first appraisal; they never alter a save or source file.
for (const assignment of flag('set', '').split(',').filter(Boolean)) {
  const [path, raw] = assignment.split('=');
  const [target, kind, field] = path.split('.');
  if (target === 'unit') shipSpec(kind)[field] = Number(raw);
  else if (target === 'mods') (COMPETITIVE_UNITS[kind].mods ??= {})[field] = Number(raw);
  else if (target === 'gun') for (const battery of shipSpec(kind).batteries) shipGunSpec(kind, battery.gun)[field] = Number(raw);
  else if (target === 'faction') TUNING.faction[kind][field] = Number(raw);
  else if (target === 'startFleet' && factions.includes(kind)) TUNING.startFleet[kind] = Number(raw);
  else if (target === 'appraisal') COMPETITIVE_APPRAISAL[kind] = Number(raw);
  else if (target === 'mix') FLEET_MIX[kind] = raw.split('|');
  else throw new Error('Unknown candidate field ' + path);
}
if (flag('layout', '') === 'hallyeo7') CONQUEST_MAPS.gyeonnaeryang.points = CONQUEST_MAPS.hallyeo.points.filter((p) => p.home === undefined || p.home < 2).map((p) => ({ ...p }));
else if (flag('layout', '') === 'hallyeo9') CONQUEST_MAPS.gyeonnaeryang.points = CONQUEST_MAPS.hallyeo.points.map((p) => ({ ...p, home: p.home >= 2 ? undefined : p.home }));

const cache = join(root, 'node_modules/.cache/balance');
mkdirSync(cache, { recursive: true });
const terrains = new Map();
function landOf(spec) {
  const key = createHash('sha1').update(JSON.stringify(spec)).digest('hex').slice(0, 12);
  let h = terrains.get(key);
  if (!h) {
    const file = join(cache, `terrain-${key}.f32`);
    if (existsSync(file)) { const bytes = readFileSync(file); h = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }
    else { h = generateHeightmap(spec); writeFileSync(file, Buffer.from(h.buffer)); }
    terrains.set(key, h);
  }
  const { size, res } = spec;
  return (x, z) => {
    const fx = (x + size / 2) / size * res - 0.5, fz = (z + size / 2) / size * res - 0.5;
    const ix = Math.max(0, Math.min(res - 2, Math.floor(fx))), iz = Math.max(0, Math.min(res - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - ix)), tz = Math.max(0, Math.min(1, fz - iz));
    const a = h[iz * res + ix], b = h[iz * res + ix + 1], c = h[(iz + 1) * res + ix], d = h[(iz + 1) * res + ix + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };
}

function fleet(faction, composition, money = budget, price = (kind) => shipSpec(kind).cost) {
  if (composition === 'default' && price('panokseon') === shipSpec('panokseon').cost) return autoFleet(faction, money, COMPETITIVE_PROFILE, battleOptions.maxShips);
  const kinds = [...ROSTER[faction]].sort((a, b) => price(a) - price(b));
  const mix = composition === 'heavy' ? [kinds.at(-1)] : composition === 'mobile' ? [kinds[0]] : FLEET_MIX[faction];
  const out = []; let left = money;
  for (let i = 0; i < Math.min(battleOptions.maxShips, Math.floor(money / price(kinds[0])) + 1); i++) {
    let kind = mix[i % mix.length];
    if (price(kind) > left) kind = kinds.find((k) => price(k) <= left);
    if (!kind) break;
    out.push(kind); left -= price(kind);
  }
  return out;
}
const unit = (kind, i) => ({ id: 'u' + i, kind, name: kind, hull: 1, crew: 1, supply: 1, kills: 0 });

function wilson(wins, games) {
  if (!games) return null;
  const z = 1.959963984540054, p = wins / games, d = 1 + z * z / games;
  const centre = (p + z * z / (2 * games)) / d;
  const radius = z * Math.sqrt(p * (1 - p) / games + z * z / (4 * games * games)) / d;
  return [Math.max(0, centre - radius), Math.min(1, centre + radius)];
}

function fight(mode, map, a, b, comp, seed, swap) {
  const west = swap ? b : a, east = swap ? a : b;
  const opening = [fleet(west, comp), fleet(east, comp)];
  if (mode === 'autoresolve') {
    // Both forces buy from the same campaign treasury at a plain yard; defender/attacker is mirrored.
    const gold = Math.round(budget * TUNING.goldPerCost);
    const forces = [fleet(west, comp, gold, (k) => shipDef(k).gold), fleet(east, comp, gold, (k) => shipDef(k).gold)];
    const result = autoResolve({ seed, tags: [1], attacker: { ships: forces[0].map(unit), leader: 1 }, defender: { ships: forces[1].map((k, i) => unit(k, i + 100)), leader: 1 } });
    const win = result.outcome.winner === 'attacker' ? 0 : 1;
    return { seed, swap, winner: win === (swap ? 1 : 0) ? a : b, westWin: win === 0, draw: false, timeout: false, seconds: 0, purchased: forces.map((f) => f.reduce((s, k) => s + shipDef(k).gold, 0)), gold, strength: result.strength };
  }
  let battle, conquest;
  if (mode === 'conquest') {
    const terrain = terrainMode === 'banks' ? { ...CONQUEST_MAPS[map].terrain, shapes: CONQUEST_MAPS[map].terrain.shapes.filter((s) => s.rx > 1000) } : CONQUEST_MAPS[map].terrain;
    ({ battle, conquest } = buildConquest(map, [{ name: 'west', faction: west, team: 'joseon', human: false, fleet: opening[0] }, { name: 'east', faction: east, team: 'japan', human: false, fleet: opening[1] }], terrainMode === 'flat' ? () => -50 : landOf(terrain), seed, { ...battleOptions, musterBudget: budget, timeLimit: cap }));
    // Explicit equal-resource contract, including unspent opening money.
    conquest.players.forEach((p, i) => p.funds = battleOptions.startFunds + budget - fleetCost(opening[i]));
  } else {
    battle = new Battle(seed, COMPETITIVE_PROFILE); battle.humans.clear(); battle.autopilot = true;
    battle.retreatBelow = { joseon: 0, japan: 0 }; battle.windDrift = 0;
    opening.forEach((ships, side) => {
      const sq = battle.addSquadron(side ? 'japan' : 'joseon', '', '', '', '', side);
      ships.forEach((kind, i) => battle.addShip(kind, (side ? 650 : -650) + (side ? 1 : -1) * Math.floor(i / 6) * 60, ((i % 6) - 2.5) * 60, side ? Math.PI : 0, '', sq));
    });
  }
  const losses = [0, 0], taken = [0, 0];
  const grounded = [0, 0]; let groundAt = 0;
  const timeline = []; let traceAt = 0;
  const combatEvents = { guns: [0, 0], boards: [0, 0], rams: [0, 0], casualties: [0, 0], hits: [0, 0] };
  if (flag('sea', null)) battle.setSea(SEA_STATES[flag('sea', null)]);
  const environment = { sea: { ...battle.waves.state }, night: battle.night, visibility: battle.visibilityScale, wind: { angle: battle.windAngle, drift: battle.windDrift }, current: battle.flow?.spec ?? null };
  const started = performance.now();
  while (!battle.ended && battle.time < cap + SIM_DT) {
    battle.step(SIM_DT);
    if (battle.time >= groundAt) { groundAt += 1; for (const s of battle.ships) if (battle.isActive(s) && s.aground > 0) grounded[s.team === 'joseon' ? 0 : 1]++; }
    if (args.includes('--trace-fleets') && battle.time >= traceAt) {
      traceAt += 30;
      timeline.push({ time: battle.time, teams: ['joseon', 'japan'].map((team) => {
        const ships = battle.activeOf(team), foes = battle.activeOf(team === 'joseon' ? 'japan' : 'joseon');
        const modes = {}, kinds = {}, byKind = {};
        for (const s of ships) {
          const mode = battle.activityOf(s.id), kind = s.spec.kind;
          modes[mode] = (modes[mode] ?? 0) + 1; kinds[kind] = (kinds[kind] ?? 0) + 1;
          const group = byKind[kind] ??= { ships: 0, throttle: 0, speed: 0, contact: 0, modes: {}, targets: {} };
          group.ships++; group.throttle += s.throttle; group.speed += s.speed; group.modes[mode] = (group.modes[mode] ?? 0) + 1;
          const target = battle.get(s.targetId);
          if (target) group.targets[target.spec.kind] = (group.targets[target.spec.kind] ?? 0) + 1;
          if (foes.some((f) => Math.hypot(f.x - s.x, f.z - s.z) < 70)) group.contact++;
        }
        for (const group of Object.values(byKind)) { group.throttle /= group.ships; group.speed /= group.ships; }
        const avg = (fn) => ships.length ? ships.reduce((sum, s) => sum + fn(s), 0) / ships.length : 0;
        return { kinds, byKind, modes, ships: ships.length, hull: avg((s) => s.hull / s.spec.hull), crew: avg((s) => s.crew / s.spec.crew), throttle: avg((s) => s.throttle), speed: avg((s) => s.speed), gunRounds: ships.reduce((sum, s) => sum + s.guns.reduce((n, g) => n + g.ammo, 0), 0), targetsClosed: ships.filter((s) => s.targetId && battle.get(s.targetId)?.spec.boardable === false).length, contact: ships.filter((s) => foes.some((f) => Math.hypot(f.x - s.x, f.z - s.z) < 70)).length };
      }), events: structuredClone(combatEvents), tickets: structuredClone(conquest?.tickets), funds: conquest?.players.map((p) => p.funds) });
    }
    for (const e of battle.events) {
      if (['gun', 'casualty', 'hit'].includes(e.type)) { const side = battle.get(e.ship)?.team === 'joseon' ? 0 : 1; combatEvents[e.type === 'gun' ? 'guns' : e.type === 'casualty' ? 'casualties' : 'hits'][side] += e.type === 'casualty' ? e.count : e.type === 'hit' ? e.damage : 1; }
      if (e.type === 'board' || e.type === 'ram') { const side = battle.get(e.a)?.team === 'joseon' ? 0 : 1; combatEvents[e.type === 'board' ? 'boards' : 'rams'][side]++; }
      if (e.type === 'struck') { const s = battle.get(e.ship); taken[s.team === 'joseon' ? 0 : 1]++; }
      if (e.type === 'sinking') { const s = battle.get(e.ship); if (!s.struck) losses[s.team === 'joseon' ? 0 : 1]++; }
    }
    battle.events.length = 0;
  }
  const winningSide = battle.winner === 'joseon' ? 0 : battle.winner === 'japan' ? 1 : null;
  return { seed, swap, winner: winningSide === null ? null : winningSide === (swap ? 1 : 0) ? a : b, westWin: winningSide === 0, draw: battle.draw, timeout: !battle.ended, time: battle.time, seconds: (performance.now() - started) / 1000, environment, losses, taken, groundedShipSeconds: grounded, combatEvents, timeline: timeline.length ? timeline : undefined, purchased: opening.map((f) => fleetCost(f)), funds: conquest?.players.map((p) => p.funds), income: conquest?.players.map((p) => p.income), tickets: conquest?.tickets, remaining: ['joseon', 'japan'].map((t) => battle.strength(t)) };
}

function summary(rows, a, same, comp) {
  const wins = rows.filter((r) => same ? r.westWin : r.winner === a).length;
  const draws = rows.filter((r) => r.draw).length, timeouts = rows.filter((r) => r.timeout).length;
  const n = rows.length, score = (wins + draws / 2) / n;
  const decided = n - draws - timeouts;
  const westWins = rows.filter((r) => r.westWin).length;
  const bounds = same ? [0.4, 0.6] : comp === 'default' ? [0.45, 0.55] : null;
  const target = terrainMode !== 'map' || flag('layout', '') || !bounds ? null : score >= bounds[0] && score <= bounds[1] && timeouts === 0;
  return { games: n, wins, draws, timeouts, score, decidedWinRate: decided ? wins / decided : null, westScore: (westWins + draws / 2) / n, decidedInterval95: wilson(wins, decided), target, targetBounds: bounds, meanSeconds: rows.reduce((s, r) => s + r.seconds, 0) / n };
}
const results = [];
try {
  console.log(`${COMPETITIVE_PROFILE} ${cohort}; ${seeds} paired seeds; budget ${budget}; timeout and draw are separate`);
  for (const mode of modes.filter((m) => m !== 'war')) for (const map of mode === 'conquest' ? maps : ['open']) for (const comp of comps) for (const [a, b] of pairs) {
    if (a === b && comp !== 'default') continue;
    const rows = [];
    for (let k = 0; k < seeds; k++) for (const swap of a === b ? [false] : [false, true]) rows.push(fight(mode, map, a, b, comp, startSeed + k * 1019, swap));
    const stats = summary(rows, a, a === b, comp);
    results.push({ mode, map, composition: comp, pair: [a, b], ...stats, rows });
    console.log(`${mode.padEnd(11)} ${map.padEnd(14)} ${comp.padEnd(7)} ${a}:${b} score ${(stats.score * 100).toFixed(1)}% W ${stats.wins} D ${stats.draws} T ${stats.timeouts} west ${(stats.westScore * 100).toFixed(1)}% (${stats.meanSeconds.toFixed(2)}s/game)`);
  }
  if (modes.includes('war')) {
    const rows = [];
    for (let k = 0; k < seeds; k++) {
      const g = newGrand(null, startSeed + k * 1019);
      if (diplomacy === 'three-way') g.relations['joseon:ming'] = 'war';
      if (diplomacy === 'allied') g.relations['joseon:ming'] = 'allied';
      if (victoryPolicy === 'growth') g.victoryRules = growthVictoryRules(g);
      if (victoryPolicy === 'legacy') delete g.victoryRules;
      if (expedition === 'three-way') g.strategicLinks = 'three-way-v1';
      if (expedition === 'legacy') delete g.strategicLinks;
      const opening = Object.fromEntries(factions.map((f) => [f, { gold: g.factions[f].gold, income: factionIncome(g, f), upkeep: factionUpkeep(g, f), regions: Object.values(g.regions).filter((r) => r.owner === f).length, ships: g.fleets.filter((fl) => fl.faction === f).reduce((n, fl) => n + fl.ships.length, 0), fleetValue: g.fleets.filter((fl) => fl.faction === f).reduce((s, fl) => s + fl.ships.reduce((v, u) => v + shipDef(u.kind).gold, 0), 0) }]));
      for (let turn = 0; turn < 60 && g.phase !== 'over'; turn++) endTurn(g);
      rows.push({ seed: startSeed + k * 1019, winner: g.victory?.faction ?? null, victory: g.victory?.kind, turns: g.turn, timeout: g.phase !== 'over', opening, endingGold: Object.fromEntries(factions.map((f) => [f, g.factions[f].gold])), ending: Object.fromEntries(factions.map((f) => [f, { control: controlValue(g, f), objective: objectiveProgress(g, f), score: scoreOf(g, f), alive: g.factions[f].alive, credit: g.credit[f] }])), stats: args.includes('--trace-war') ? g.stats : undefined });
    }
    const wins = Object.fromEntries(factions.map((f) => [f, rows.filter((r) => r.winner === f).length]));
    const ending = rows.filter((r) => !r.timeout), counts = Object.fromEntries(factions.map((f) => [f, rows.filter((r) => r.winner === f).length]));
    results.push({ mode: 'war', games: seeds, wins, winRates: Object.fromEntries(factions.map((f) => [f, counts[f] / seeds])), decidedIntervals95: Object.fromEntries(factions.map((f) => [f, wilson(counts[f], ending.length)])), timeouts: rows.filter((r) => r.timeout).length, meanTurns: rows.reduce((s, r) => s + r.turns, 0) / seeds, rows });
    console.log('war', wins, 'timeouts', rows.filter((r) => r.timeout).length);
  }
  const report = { profile: COMPETITIVE_PROFILE, ruleset, rules: battleOptions, diagnostics: { terrain: terrainMode, sea: flag('sea', null), layout: flag('layout', null), diplomacy, victory: victoryPolicy, expedition }, acceptance: { defaultPairScore: [0.45, 0.55], sameFactionWestScore: [0.4, 0.6], counterCompositions: 'Reported as counters; individual matchups do not have a 50% target.', timeouts: 0, qualification: 'Predeclared bot targets; uncertainty and minimum cohort size must be considered separately.' }, command: ['node', 'scripts/balance-competitive.mjs', ...args], sources: sourceHashes, cohort, seed0: startSeed, seeds, paired: true, budget, cap, candidate: flag('set', ''), appraisal: COMPETITIVE_APPRAISAL, fleetMix: FLEET_MIX, maps: Object.fromEntries(maps.map((id) => [id, { sea: CONQUEST_MAPS[id].sea, terrain: CONQUEST_MAPS[id].terrain, points: CONQUEST_MAPS[id].points }])), limits: ['Seeded built-in AI only; human decision quality is not measured.', 'Different compositions are counters, not a promise that every unit beats every other unit.', 'Flat/banks terrain overrides are synthetic diagnostics and do not qualify as map acceptance.', 'War opening geography, objectives and event reinforcements are asymmetric; war results are reported separately from equal-resource fights.', 'Wilson intervals describe decisive wins; draws and timeouts stay separate. Mirrored paired games are correlated, so these are descriptive intervals.'], catalog: Object.fromEntries(Object.keys(COMPETITIVE_UNITS).map((k) => [k, { ...shipSpec(k), mods: shipMods(k), guns: Object.fromEntries(shipSpec(k).batteries.map((b) => [b.gun, shipGunSpec(k, b.gun)])), appraisal: combatStats(k), campaign: shipDef(k) }])), results };
  report.sourcesChangedDuringRun = Object.fromEntries(sourcePaths.flatMap((p) => {
    const after = createHash('sha256').update(readFileSync(join(root, p))).digest('hex');
    return after === sourceHashes[p] ? [] : [[p, { before: sourceHashes[p], after }]];
  }));
  const out = flag('out', null);
  if (out) { mkdirSync(dirname(join(root, out)), { recursive: true }); writeFileSync(join(root, out), JSON.stringify(report, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2) + '\n'); }
  if (args.includes('--assert-target') && results.some((r) => r.target === false)) process.exitCode = 1;
} finally { await server.close(); }
