import { autoWorks, planAi } from './ai';
import { autoResolve, previewStrength, type Force, type ResolveResult } from './autoresolve';
import {
  BUILDING_DEFS,
  GARRISON_KIND,
  MAX_TURNS,
  TUNING,
  buildingOf,
  factionIncome,
  factionUpkeep,
  garrisonCap,
  guardScale,
  listStrength,
  batteryStrength,
  repairRates,
  shipDef,
  levelOf,
  navyName,
} from './economy';
import { KOREA_COAST, REGION_ORDER, REGIONS, START } from './regions';
import { makeRng, next } from './rng';
import type { BattleOutcome, BuildingKind, Contact, Fleet, Grand, GrandFaction, RegionId, Result, ShipUnit } from './types';
import { GRAND_FACTIONS, fail, ok } from './types';
import { allied, atWar, fleetById, fleetStrength, lanesOf, mintId, note, ownedBy, passable, shipCount } from './world';
import { LEVEL_XP, SHIP_PREFIX, grantXp, spawnFleet, spawnShip } from './roster';
import { fireEvents } from './events';
import type { ShipKind } from '../types';
import { newAllySupport, scaleAllyOpening, supportReinforcements } from './support';
import { MARCH, laneKm, marchFleets, marching, winterTurn, type SeaMeeting } from './march';
import { battleGrade, GRADE_TEXT } from './report';
import { advanceResearch, fleetXp, growing, growthMods, joinCommanders } from './growth';

export { MAX_TURNS, LEVEL_XP, spawnShip };

/**
 * A new campaign. `spread` perturbs each navy's opening fleet by up to that share, from the seed: 0 for a real game,
 * a few hundredths when the balance scripts want to know how stable an outcome is.
 */
export function newGrand(player: GrandFaction | null, seed = 1592, difficulty: Grand['difficulty'] = 'normal', spread = 0): Grand {
  const g: Grand = {
    version: 1,
    balanceProfile: 'competitive-v1',
    forces: 'wide-v1',
    march: 'tw-v1',
    growth: 'v1',
    seed,
    rng: makeRng(seed),
    player,
    difficulty,
    turn: 1,
    phase: 'orders',
    regions: {} as Grand['regions'],
    fleets: [],
    factions: {} as Grand['factions'],
    relations: { 'japan:joseon': 'war', 'japan:ming': 'war', 'joseon:ming': 'allied' },
    pending: [],
    fought: 0,
    credit: { joseon: 0, japan: 0, ming: 0 },
    nextId: 0,
    log: [],
    stats: [],
    victory: null,
    events: { done: {}, pending: null, flags: [], mods: [] },
  };
  const support = newAllySupport(player);
  if (support) g.allySupport = support;
  for (const id of REGION_ORDER) {
    const owner = START.owners[id];
    g.regions[id] = { owner, buildings: [], garrison: [], queue: [], unrest: 0, garrisonRule: 'equal-power-v2', garrisonReserve: 0 };
    for (const [kind, level] of Object.entries(START.buildings[id] ?? {}) as [BuildingKind, number][]) g.regions[id].buildings.push({ kind, level, upgradeLeft: 0, hp: 1 });
    const cap = garrisonCap(id, g.regions[id]);
    for (let i = 0; i < cap; i += 1) g.regions[id].garrison.push(spawnShip(g, GARRISON_KIND[owner]));
  }
  for (const f of GRAND_FACTIONS) {
    g.factions[f] = {
      faction: f,
      gold: START.gold[f],
      alive: true,
      commanders: [],
      unlocked: [],
      tech: { done: [], doing: null },
      objectiveHold: 0,
      idle: 0,
    };
  }
  joinCommanders(g, true);
  const scale = Object.fromEntries(GRAND_FACTIONS.map((f) => [f, TUNING.startFleet[f] * TUNING.forceScale * (1 + spread * (2 * next(g.rng) - 1))])) as Record<GrandFaction, number>;
  const scaled = START.fleets.map((s) => ({ ...s, ships: Object.fromEntries(Object.entries(s.ships).map(([k, n]) => [k, Math.floor(n * scale[s.faction])])) as Partial<Record<ShipKind, number>> }));
  // Round a navy's total once, then allocate the remaining hulls by fractional remainder. Rounding each fleet
  // separately made a tiny slider change add several expensive warships to only the navy with three fleets.
  for (const f of GRAND_FACTIONS) {
    const kinds = new Set(START.fleets.filter((s) => s.faction === f).flatMap((s) => Object.keys(s.ships) as ShipKind[]));
    for (const kind of kinds) {
      const pieces = START.fleets.map((s, i) => ({ i, n: s.faction === f ? s.ships[kind] ?? 0 : 0 })).filter((s) => s.n > 0);
      let left = Math.round(pieces.reduce((sum, s) => sum + s.n, 0) * scale[f]) - pieces.reduce((sum, s) => sum + (scaled[s.i]!.ships[kind] ?? 0), 0);
      pieces.sort((a, b) => (b.n * scale[f] % 1) - (a.n * scale[f] % 1) || a.i - b.i);
      for (const p of pieces) if (left-- > 0) scaled[p.i]!.ships[kind] = (scaled[p.i]!.ships[kind] ?? 0) + 1;
    }
  }
  scaleAllyOpening(g, scaled);
  for (const s of scaled) {
    spawnFleet(g, s.faction, s.at, s.name, s.ships, s.commander);
  }
  note(g, '조선, 일본, 명 세 진영이 남해의 물길을 두고 맞섭니다.');
  recordStats(g, 0, 0);
  fireEvents(g);
  return g;
}

// --- Fights -----------------------------------------------------------------------------------------------------

const commanderOf = (g: Grand, fl: Fleet) => (fl.commanderId ? g.factions[fl.faction].commanders.find((c) => c.id === fl.commanderId) : undefined);
export const commanderLevel = (g: Grand, fl: Fleet) => {
  const c = commanderOf(g, fl);
  return c?.alive ? c.level : 1;
};

export function contactForces(g: Grand, c: Contact): { attacker: Force; defender: Force; attackers: Fleet[]; defenders: Fleet[] } {
  const attackers = c.attackerFleets.flatMap((id) => fleetById(g, id) ?? []);
  const defenders = c.defenderFleets.flatMap((id) => fleetById(g, id) ?? []);
  const region = g.regions[c.regionId];
  // Out at sea neither the port's guard boats nor its guns take part.
  const home = !c.sea && region.owner === c.defender;
  // A side caught on a forced march fights tired.
  const morale = (list: Fleet[]) => (list.some((f) => f.stance === 'march') ? MARCH.tired : 1);
  // Under the growth rules each ship fights with its navy's research and its own commander's trait and skills.
  const mods = (list: Fleet[], guards: ShipUnit[] = []) => {
    if (!growing(g)) return undefined;
    const out: Record<string, ReturnType<typeof growthMods>> = {};
    for (const fl of list) for (const u of fl.ships) out[u.id] = growthMods(g, fl.faction, u.kind, fl);
    for (const u of guards) out[u.id] = growthMods(g, c.defender, u.kind, undefined);
    return out;
  };
  const guards = home ? region.garrison : [];
  return {
    attacker: { ships: attackers.flatMap((f) => f.ships), leader: Math.max(1, ...attackers.map((f) => commanderLevel(g, f))), morale: morale(attackers), mods: mods(attackers) },
    defender: { ships: [...defenders.flatMap((f) => f.ships), ...guards], leader: Math.max(1, ...defenders.map((f) => commanderLevel(g, f))), region: home ? region : undefined, morale: morale(defenders), mods: mods(defenders, guards) },
    attackers,
    defenders,
  };
}

function sail(g: Grand, fl: Fleet, from: RegionId, to: RegionId) {
  const turns = lanesOf(g, from).find((l) => l.to === to)?.turns ?? 1;
  fl.route = [];
  fl.besieging = false;
  fl.assault = false;
  // Under the march rules a beaten fleet falls straight back into the port, as an army retreats a short way.
  if (turns <= 1 || marching(g)) {
    fl.at = to;
    fl.transit = null;
  } else {
    // The turn of the fight counts as the first turn at sea, like a departure, so the voyage is as long as the lane.
    fl.at = null;
    fl.transit = { from, to, left: turns - 1 };
  }
}

/** A beaten fleet falls back to the port it came from, or to the nearest friendly one; with nowhere to go it is lost. */
function retreat(g: Grand, fl: Fleet, from: RegionId) {
  const safe = (id: RegionId) => id !== from && passable(g, fl.faction, id) && !g.fleets.some((o) => o.at === id && atWar(g, o.faction, fl.faction));
  const lanes = lanesOf(g, from).filter((l) => safe(l.to));
  const home = fl.from && lanes.find((l) => l.to === fl.from);
  const mine = (id: RegionId) => (g.regions[id].owner === fl.faction ? 0 : 1);
  const length = (to: RegionId, turns: number) => (marching(g) ? laneKm(g, from, to) : turns);
  const choice = home ?? [...lanes].sort((a, b) => length(a.to, a.turns) - length(b.to, b.turns) || mine(a.to) - mine(b.to))[0];
  if (!choice) {
    note(g, '{fleet|이/가} 퇴로를 잃고 전멸했습니다', { fleet: fl.name }, fl.faction === g.player ? 'bad' : 'info');
    g.fleets.splice(g.fleets.indexOf(fl), 1);
    return;
  }
  for (const u of fl.ships) u.supply = Math.max(0.2, u.supply * 0.7);
  sail(g, fl, from, choice.to);
}

/** A fleet beaten out at sea falls back to the lane end it came from, else the other end, else on from the one behind it. */
function retreatAtSea(g: Grand, fl: Fleet) {
  const t = fl.transit;
  if (!t) {
    if (fl.at) retreat(g, fl, fl.at);
    return;
  }
  const end = seaRefuge(g, fl);
  for (const u of fl.ships) u.supply = Math.max(0.2, u.supply * 0.7);
  fl.route = [];
  fl.besieging = false;
  fl.assault = false;
  if (end) {
    fl.transit = null;
    fl.at = end;
    return;
  }
  // Hemmed in at both ends, it stays out at sea, drawn back a little toward where it came from, and waits for orders.
  t.sailed = Math.max(0.5, (t.sailed ?? 0) - 5);
}

/** A port a beaten fleet can fall back to: friendly or open water with no hostile fleet in it. */
const refuge = (g: Grand, fl: Fleet, id: RegionId) => passable(g, fl.faction, id) && !g.fleets.some((o) => o.at === id && atWar(g, o.faction, fl.faction));

/** The end of its lane a fleet at sea falls back to: the one it came from first. */
const seaRefuge = (g: Grand, fl: Fleet) => (fl.transit ? [fl.transit.from, fl.transit.to].find((id) => refuge(g, fl, id)) : undefined);

/** Whether a fleet in a port fight at `from` has a port to fall back to; one at sea can always pull back on its lane. */
const canFallBack = (g: Grand, fl: Fleet, from: RegionId) => !!fl.transit || lanesOf(g, from).some((l) => l.to !== from && refuge(g, fl, l.to));

/** The region changes hands. Its works are damaged, its queue is lost and its people are restless. */
export function captureRegion(g: Grand, id: RegionId, taker: GrandFaction) {
  const r = g.regions[id];
  const prev = r.owner;
  delete r.siege;
  // An ally that drives the enemy out of a port hands it back to the navy it was taken from.
  const rightful = START.owners[id];
  const liberated = rightful !== taker && g.factions[rightful].alive && allied(g, taker, rightful);
  const by = liberated ? rightful : taker;
  g.credit[taker] += REGIONS[id].value * TUNING.score.captureCredit;
  r.owner = by;
  r.garrison = [];
  if (r.garrisonRule) r.garrisonReserve = 0;
  r.queue = [];
  r.unrest = liberated ? 1 : TUNING.unrestTurns;
  r.buildings = r.buildings
    .filter((b) => b.kind !== 'battery')
    .map((b) => ({ ...b, level: b.level - 1, upgradeLeft: 0, hp: 1 }))
    .filter((b) => b.level > 0);
  const tone = by === g.player ? 'good' : prev === g.player ? 'bad' : 'info';
  if (liberated) note(g, '{navy|이/가} {place|을/를} 되찾아 {owner}에 돌려주었습니다', { navy: navyName(taker), place: REGIONS[id].name, owner: navyName(by) }, tone);
  else note(g, '{navy|이/가} {place|을/를} 차지했습니다', { navy: navyName(by), place: REGIONS[id].name }, tone);
}

function dropEmpty(g: Grand) {
  g.fleets = g.fleets.filter((f) => f.ships.length > 0);
}

function giveXp(g: Grand, fl: Fleet, kills: number, won: boolean) {
  const cmd = commanderOf(g, fl);
  if (!cmd || !cmd.alive) return;
  grantXp(g, fl.faction, cmd, Math.round((25 + kills * 8 + (won ? 50 : 0)) * fleetXp(g, fl)));
}

/** The one way a battle, played or auto-resolved, changes the campaign. */
export function applyContactOutcome(g: Grand, c: Contact, outcome: BattleOutcome): void {
  const { attackers, defenders } = contactForces(g, c);
  const region = g.regions[c.regionId];
  const home = !c.sea && region.owner === c.defender;
  for (const f of [c.attacker, c.defender, ...attackers.map((x) => x.faction), ...defenders.map((x) => x.faction)]) g.factions[f].idle = -1;
  const byId = new Map(outcome.ships.map((s) => [s.campaignId, s]));
  const kills = new Map<string, number>();
  let lostA = 0;
  let lostD = 0;
  // Each side's worth before the fight, for the grade of the win.
  const worth = (list: ShipUnit[]) => list.reduce((s, u) => s + shipDef(u.kind).strength * u.hull, 0);
  const startA = worth(attackers.flatMap((f) => f.ships));
  const startD = worth([...defenders.flatMap((f) => f.ships), ...(home ? region.garrison : [])]);
  // Strength each side lost, which is the other side's credit toward a score.
  const worn = { a: 0, d: 0 };
  const settle = (list: ShipUnit[], side: 'a' | 'd', fleetId: string | null) =>
    list.filter((u) => {
      const o = byId.get(u.id);
      if (!o) return true;
      u.kills += o.kills;
      if (fleetId) kills.set(fleetId, (kills.get(fleetId) ?? 0) + o.kills);
      worn[side] += shipDef(u.kind).strength * (u.hull - (o.alive ? o.hull : 0));
      if (!o.alive) {
        if (side === 'a') lostA += 1;
        else lostD += 1;
        return false;
      }
      u.hull = o.hull;
      u.crew = o.crew;
      u.supply = o.supply;
      return true;
    });
  for (const f of attackers) f.ships = settle(f.ships, 'a', f.id);
  for (const f of defenders) f.ships = settle(f.ships, 'd', f.id);
  if (home) region.garrison = settle(region.garrison, 'd', null);
  const attackerWon = outcome.winner === 'attacker';
  const credit = (to: GrandFaction[], amount: number) => {
    for (const f of to) g.credit[f] += amount / to.length;
  };
  credit([...new Set([c.defender, ...defenders.map((x) => x.faction)])], worn.a);
  credit([...new Set([c.attacker, ...attackers.map((x) => x.faction)])], worn.d);
  for (const f of [...attackers, ...defenders]) giveXp(g, f, kills.get(f.id) ?? 0, (attackerWon ? attackers : defenders).includes(f));
  // The works take the damage the fight did to them; out at sea there are none.
  if (!c.sea) {
    for (const kind of outcome.razed) downgrade(region, kind);
    for (const [kind, loss] of Object.entries(outcome.damage ?? {}) as [BuildingKind, number][]) {
      const b = buildingOf(region, kind);
      if (!b || loss <= 0) continue;
      b.hp -= loss;
      if (b.hp <= 0.15) downgrade(region, kind);
    }
  }
  dropEmpty(g);
  g.pending = g.pending.filter((p) => p.id !== c.id);
  const mine = g.player === c.attacker || g.player === c.defender;
  const winner = attackerWon ? c.attacker : c.defender;
  const params = { place: REGIONS[c.regionId].name, navy: navyName(winner), a: TUNING.faction[c.attacker].label, lostA, d: TUNING.faction[c.defender].label, lostD };
  const tone = !mine ? 'info' : winner === g.player ? 'good' : 'bad';
  if (marching(g)) {
    const grade = attackerWon ? battleGrade(startA, worn.a, startD, worn.d) : battleGrade(startD, worn.d, startA, worn.a);
    const text = c.sea ? '{place} 앞바다에서 {navy|이/가} {grade|을/를} 거두었습니다 (손실: {a} {lostA}척 · {d} {lostD}척)' : '{place} 해전에서 {navy|이/가} {grade|을/를} 거두었습니다 (손실: {a} {lostA}척 · {d} {lostD}척)';
    note(g, text, { ...params, grade: GRADE_TEXT[grade] }, tone);
  } else note(g, '{place} 해전에서 {navy|이/가} 승리했습니다 (손실: {a} {lostA}척 · {d} {lostD}척)', params, tone);
  // The turn closes right after the fight and takes one off, so the rest is counted from the next turn.
  for (const f of [...attackers, ...defenders]) f.rest = TUNING.restAfterBattle + 1;
  // Fleets that joined from a neighbouring port fought from where they lay and stay there, win or lose.
  const joined = new Set(c.reinforcements ?? []);
  const fallBack = (f: Fleet) => {
    if (!g.fleets.includes(f) || joined.has(f.id)) return;
    if (c.sea) retreatAtSea(g, f);
    else retreat(g, f, c.regionId);
  };
  if (attackerWon) {
    for (const f of defenders) fallBack(f);
    for (const f of attackers) if (g.fleets.includes(f)) {
      f.route = [];
      f.besieging = false;
      f.assault = false;
    }
    if (!c.sea) captureRegion(g, c.regionId, c.attacker);
  } else {
    for (const f of attackers) fallBack(f);
  }
}

function downgrade(region: Grand['regions'][RegionId], kind: BuildingKind) {
  const b = buildingOf(region, kind);
  if (!b) return;
  b.level -= 1;
  b.hp = 1;
  b.upgradeLeft = 0;
  if (b.level <= 0) region.buildings.splice(region.buildings.indexOf(b), 1);
}

/** What the player is shown before choosing between fighting and auto-resolving. */
export function previewContact(g: Grand, contactId: string) {
  const c = g.pending.find((p) => p.id === contactId);
  if (!c) return null;
  const f = contactForces(g, c);
  const odds = previewStrength(f.attacker.ships, f.defender.ships, f.defender.region);
  return { contact: c, attacker: odds.attacker, defender: odds.defender, ratio: odds.ratio, attackerShips: f.attacker.ships.length, defenderShips: f.defender.ships.length, battery: f.defender.region ? levelOf(f.defender.region, 'battery') : 0 };
}

/** How often the attacker wins when the numbers settle the meeting, over differently seeded luck. For the preview's odds. */
export function oddsOfContact(g: Grand, contactId: string, samples = 40): number | null {
  const c = g.pending.find((p) => p.id === contactId);
  if (!c) return null;
  const f = contactForces(g, c);
  let wins = 0;
  for (let i = 0; i < samples; i += 1) {
    const r = autoResolve({ attacker: f.attacker, defender: f.defender, seed: g.seed + 7919 * (i + 1), tags: [g.turn, REGION_ORDER.indexOf(c.regionId)] });
    if (r.outcome.winner === 'attacker') wins += 1;
  }
  return wins / samples;
}

/** Settles a contact without playing it. The same game state always gives the same result. */
export function autoResolveContact(g: Grand, contactId: string): ResolveResult | null {
  const c = g.pending.find((p) => p.id === contactId);
  if (!c) return null;
  const result = resolveContact(g, c);
  applyContactOutcome(g, c, result.outcome);
  settlePending(g);
  return result;
}

export function resolveContact(g: Grand, c: Contact): ResolveResult {
  const f = contactForces(g, c);
  return autoResolve({ attacker: f.attacker, defender: f.defender, seed: g.seed, tags: [g.turn, REGION_ORDER.indexOf(c.regionId)] });
}

/** After the last waiting battle is decided, the turn goes on. */
export function settlePending(g: Grand) {
  if (g.phase === 'battles' && g.pending.length === 0) advanceTurn(g);
}

// --- Movement and contact ---------------------------------------------------------------------------------------

function moveFleets(g: Grand) {
  // Two hostile fleets sailing opposite ways along one lane meet at sea: the one that was already in port is held there
  // and the other arrives to fight it, so fleets cannot slip past each other.
  for (const a of g.fleets) {
    const to = a.route[0];
    if (!to || !a.at || a.transit || a.rest > 0) continue;
    for (const b of g.fleets) {
      if (b.at === to && b.route[0] === a.at && !b.transit && b.rest <= 0 && atWar(g, a.faction, b.faction) && lanesOf(g, a.at).find((l) => l.to === to)?.turns === 1) b.route = [];
    }
  }
  for (const fl of [...g.fleets]) {
    if (fl.transit) {
      fl.transit.left -= 1;
      if (fl.transit.left <= 0) {
        fl.at = fl.transit.to;
        fl.transit = null;
      }
      continue;
    }
    const to = fl.route[0];
    if (!to || !fl.at || fl.rest > 0) continue;
    const last = fl.route.length === 1;
    // A port that fell to the enemy on the way ends the voyage short of it.
    if (!last && !passable(g, fl.faction, to)) {
      fl.route = [];
      continue;
    }
    const lane = lanesOf(g, fl.at).find((l) => l.to === to);
    if (!lane) {
      fl.route = [];
      continue;
    }
    const from = fl.at;
    fl.route.shift();
    if (lane.turns <= 1) fl.at = to;
    else {
      fl.at = null;
      fl.transit = { from, to, left: lane.turns - 1 };
    }
  }
  // Multi-leg AI routes can become a two-port exchange after both groups arrive this turn.
  // Keep the larger body in port so the smaller one can join it; player-written routes remain explicit orders.
  for (let i = 0; i < g.fleets.length; i += 1) {
    const a = g.fleets[i]!;
    if (a.faction === g.player || !a.at || a.transit || a.rest > 0 || a.route.length !== 1) continue;
    const ownerA = g.regions[a.at].owner;
    if (!ownerA || !allied(g, a.faction, ownerA)) continue;
    for (const b of g.fleets.slice(i + 1)) {
      if (b.faction !== a.faction || !b.at || b.transit || b.rest > 0 || b.route.length !== 1 || a.at === b.at || a.route[0] !== b.at || b.route[0] !== a.at) continue;
      const ownerB = g.regions[b.at].owner;
      if (!ownerB || !allied(g, b.faction, ownerB)) continue;
      const host = fleetStrength(a) >= fleetStrength(b) ? a : b;
      host.route = [];
    }
  }
}

function findContacts(g: Grand): Contact[] {
  const out: Contact[] = [];
  for (const id of REGION_ORDER) {
    const here = g.fleets.filter((f) => f.at === id);
    if (!here.length) continue;
    const r = g.regions[id];
    if (!r.owner) {
      // Open water is claimed by whoever sails in first.
      r.owner = here[0]!.faction;
      continue;
    }
    const owner = r.owner;
    const hostile = here.filter((f) => atWar(g, f.faction, owner));
    if (!hostile.length) continue;
    const power = new Map<GrandFaction, number>();
    for (const f of hostile) power.set(f.faction, (power.get(f.faction) ?? 0) + fleetStrength(f));
    const primary = [...power.entries()].sort((a, b) => b[1] - a[1] || GRAND_FACTIONS.indexOf(a[0]) - GRAND_FACTIONS.indexOf(b[0]))[0]![0];
    const attackers = hostile.filter((f) => allied(g, f.faction, primary));
    for (const f of hostile) if (!attackers.includes(f) && g.fleets.includes(f)) retreat(g, f, id);
    const defenders = here.filter((f) => allied(g, f.faction, owner));
    const hasDefence = defenders.length > 0 || r.garrison.length > 0 || levelOf(r, 'battery') > 0;
    if (!hasDefence) {
      for (const f of attackers) f.route = [];
      captureRegion(g, id, primary);
      continue;
    }
    const player = g.player !== null && [primary, owner, ...attackers.map((f) => f.faction), ...defenders.map((f) => f.faction)].includes(g.player);
    out.push({ id: `${g.turn}:${id}`, regionId: id, attacker: primary, defender: owner, attackerFleets: attackers.map((f) => f.id), defenderFleets: defenders.map((f) => f.id), player });
  }
  return out;
}

/** Turns a blockaded port holds out: longer with a granary's stores and behind a strong camp. */
export const holdOf = (r: Grand['regions'][RegionId]) => MARCH.holdBase + levelOf(r, 'granary') + (levelOf(r, 'camp') >= 2 ? 1 : 0);

/**
 * Under the march rules: the meetings at sea first (they happened on the way), then the ports. A fleet lying idle in a
 * port within `MARCH.reinforce` km of a fight joins whichever side it is allied to, and is marked a reinforcement. Fleets
 * that only blockade a port fight nobody until a fleet of the port's side comes in or they are ordered to storm it.
 */
function findMarchContacts(g: Grand, meetings: SeaMeeting[]): Contact[] {
  const out: Contact[] = [];
  const busy = new Set<string>();
  // Fleets that have a fight of their own this turn, where they lie, are nobody's reinforcement.
  for (const m of meetings) for (const id of m.fleets) busy.add(id);
  for (const id of REGION_ORDER) {
    const here = g.fleets.filter((f) => f.at === id);
    const owner = g.regions[id].owner;
    if (here.some((a) => (owner && atWar(g, a.faction, owner)) || here.some((b) => atWar(g, a.faction, b.faction)))) for (const f of here) busy.add(f.id);
  }
  /**
   * The idle fleets near a fight that come to it: `near` lists the ports round it with their km to the fight, `power` the
   * strength each side has there already. A side's neighbours join only when, with them, it has a fighting chance:
   * nobody sails out to be sunk beside a lost cause.
   */
  const helpers = (near: [RegionId, number][], attacker: GrandFaction, defender: GrandFaction, power: { a: number; d: number }) => {
    let a: Fleet[] = [];
    let d: Fleet[] = [];
    for (const f of g.fleets) {
      if (!f.at || busy.has(f.id) || f.route.length || f.besieging) continue;
      if (!near.some(([id, km]) => f.at === id && km <= MARCH.reinforce)) continue;
      // A fleet still refitting after a fight defends its neighbours but does not sail out to attack.
      if (allied(g, f.faction, attacker) && atWar(g, f.faction, defender) && f.rest <= 0) a.push(f);
      else if (allied(g, f.faction, defender) && atWar(g, f.faction, attacker)) d.push(f);
    }
    const sum = (list: Fleet[]) => list.reduce((s, f) => s + fleetStrength(f), 0);
    if (power.a + sum(a) < (power.d + sum(d)) * MARCH.join) a = [];
    if (power.d + sum(d) < (power.a + sum(a)) * MARCH.join) d = [];
    for (const f of [...a, ...d]) busy.add(f.id);
    return { a, d };
  };
  const strongest = (fleets: Fleet[]) => {
    const power = new Map<GrandFaction, number>();
    for (const f of fleets) power.set(f.faction, (power.get(f.faction) ?? 0) + fleetStrength(f));
    return [...power.entries()].sort((a, b) => b[1] - a[1] || GRAND_FACTIONS.indexOf(a[0]) - GRAND_FACTIONS.indexOf(b[0]))[0]?.[0];
  };
  const involves = (factions: GrandFaction[]) => g.player !== null && factions.includes(g.player);

  for (const m of meetings) {
    const fleets = m.fleets.flatMap((id) => fleetById(g, id) ?? []);
    // The navy that sailed into the meeting with the most behind it attacks; the strongest of its enemies there defends.
    const attacker = strongest(fleets.filter((f) => m.movers.includes(f.id))) ?? strongest(fleets);
    if (!attacker) continue;
    const defender = strongest(fleets.filter((f) => atWar(g, f.faction, attacker)));
    if (!defender) continue;
    const attackers = fleets.filter((f) => allied(g, f.faction, attacker) && atWar(g, f.faction, defender));
    const defenders = fleets.filter((f) => allied(g, f.faction, defender) && atWar(g, f.faction, attacker));
    const km = laneKm(g, m.from, m.to);
    const extra = helpers([[m.from, m.t * km], [m.to, (1 - m.t) * km]], attacker, defender, { a: attackers.reduce((s, f) => s + fleetStrength(f), 0), d: defenders.reduce((s, f) => s + fleetStrength(f), 0) });
    const all = [...attackers, ...defenders, ...extra.a, ...extra.d];
    out.push({
      id: `${g.turn}:sea${out.length}:${m.from}`,
      regionId: m.t < 0.5 ? m.from : m.to,
      attacker,
      defender,
      attackerFleets: [...attackers, ...extra.a].map((f) => f.id),
      defenderFleets: [...defenders, ...extra.d].map((f) => f.id),
      player: involves([attacker, defender, ...all.map((f) => f.faction)]),
      sea: { from: m.from, to: m.to, t: m.t },
      reinforcements: [...extra.a, ...extra.d].map((f) => f.id),
    });
  }

  for (const id of REGION_ORDER) {
    const here = g.fleets.filter((f) => f.at === id);
    if (!here.length) continue;
    const r = g.regions[id];
    if (!r.owner) {
      r.owner = here[0]!.faction;
      continue;
    }
    const owner = r.owner;
    const hostile = here.filter((f) => atWar(g, f.faction, owner));
    if (!hostile.length) continue;
    const primary = strongest(hostile)!;
    const attackers = hostile.filter((f) => allied(g, f.faction, primary));
    for (const f of hostile) if (!attackers.includes(f) && g.fleets.includes(f)) retreat(g, f, id);
    const defenders = here.filter((f) => allied(g, f.faction, owner));
    const hasDefence = defenders.length > 0 || r.garrison.length > 0 || levelOf(r, 'battery') > 0;
    if (!hasDefence) {
      for (const f of attackers) {
        f.route = [];
        f.besieging = false;
        f.assault = false;
      }
      captureRegion(g, id, primary);
      continue;
    }
    // Blockaders without an order to storm lie off the port: the blockade begins or goes on, and nobody fights. A
    // blockade holds only while it outweighs what the port can throw at it; against a stronger garrison it is a fight.
    const bottled = attackers.reduce((a, f) => a + fleetStrength(f), 0) >= (listStrength(r.garrison) + batteryStrength(r)) * MARCH.sally;
    if (!defenders.length && bottled && attackers.every((f) => f.besieging && !f.assault)) {
      if (!r.siege || !allied(g, r.siege.by, primary)) {
        r.siege = { by: primary, turns: 0, hold: holdOf(r) };
        note(g, '{navy|이/가} {place|을/를} 봉쇄했습니다', { navy: navyName(primary), place: REGIONS[id].name }, owner === g.player ? 'bad' : primary === g.player ? 'good' : 'info');
      }
      for (const f of attackers) f.route = [];
      continue;
    }
    const extra = helpers(lanesOf(g, id).map((l) => [l.to, laneKm(g, id, l.to)] as [RegionId, number]), primary, owner, {
      a: attackers.reduce((s, f) => s + fleetStrength(f), 0),
      d: defenders.reduce((s, f) => s + fleetStrength(f), 0) + listStrength(r.garrison) + batteryStrength(r),
    });
    const all = [...attackers, ...defenders, ...extra.a, ...extra.d];
    out.push({
      id: `${g.turn}:${id}`,
      regionId: id,
      attacker: primary,
      defender: owner,
      attackerFleets: [...attackers, ...extra.a].map((f) => f.id),
      defenderFleets: [...defenders, ...extra.d].map((f) => f.id),
      player: involves([primary, owner, ...all.map((f) => f.faction)]),
      reinforcements: [...extra.a, ...extra.d].map((f) => f.id),
      siege: !!r.siege,
    });
  }
  return out;
}

/** Why `faction` cannot turn this waiting assault into a blockade, or null when it can. */
export function besiegeProblem(g: Grand, c: Contact, faction: GrandFaction): string | null {
  if (!marching(g) || c.sea || c.siege) return '봉쇄할 수 없는 전투입니다';
  if (!allied(g, faction, c.attacker) || !atWar(g, faction, c.defender)) return '공격하는 쪽만 봉쇄할 수 있습니다';
  if (c.defenderFleets.some((id) => fleetById(g, id)?.at === c.regionId)) return '적 함대가 지키는 포구는 봉쇄할 수 없습니다';
  const r = g.regions[c.regionId];
  const blockaders = c.attackerFleets.flatMap((id) => fleetById(g, id) ?? []).filter((f) => f.at === c.regionId);
  if (blockaders.reduce((a, f) => a + fleetStrength(f), 0) < (listStrength(r.garrison) + batteryStrength(r)) * MARCH.sally) return '봉쇄하기에는 수비대가 너무 강합니다';
  return null;
}

/** Turns a waiting assault on a port into a blockade: the attacking fleets lie off the port and nobody fights there now. */
export function besiegeContact(g: Grand, contactId: string, faction: GrandFaction): Result {
  const c = g.pending.find((p) => p.id === contactId);
  if (!c) return fail('해당 전투가 없습니다');
  const problem = besiegeProblem(g, c, faction);
  if (problem) return fail(problem);
  const r = g.regions[c.regionId];
  for (const id of c.attackerFleets) {
    const f = fleetById(g, id);
    if (!f || f.at !== c.regionId) continue;
    f.besieging = true;
    f.assault = false;
    f.route = [];
  }
  r.siege = { by: c.attacker, turns: 0, hold: holdOf(r) };
  note(g, '{navy|이/가} {place|을/를} 봉쇄했습니다', { navy: navyName(c.attacker), place: REGIONS[c.regionId].name }, c.defender === g.player ? 'bad' : c.attacker === g.player ? 'good' : 'info');
  g.pending = g.pending.filter((p) => p.id !== c.id);
  settlePending(g);
  return ok();
}

/**
 * The fleets of `faction`'s side in a waiting fight withdraw from it before it is fought, losing some supply. An attack
 * then simply ends; a port whose defending fleets leave is held by its garrison and guns alone, or falls if it has none.
 */
export function withdrawContact(g: Grand, contactId: string, faction: GrandFaction): Result {
  const c = g.pending.find((p) => p.id === contactId);
  if (!c) return fail('해당 전투가 없습니다');
  const side = allied(g, faction, c.attacker) && atWar(g, faction, c.defender) ? 'attacker' : 'defender';
  const ids = side === 'attacker' ? c.attackerFleets : c.defenderFleets;
  const leaving = ids.flatMap((id) => fleetById(g, id) ?? []).filter((f) => f.faction === faction);
  if (!leaving.length) return fail('물러날 함대가 없습니다');
  const joined = new Set(c.reinforcements ?? []);
  // Withdrawing must not sink a fleet that would otherwise have fought: every one needs somewhere to fall back to.
  if (leaving.some((f) => !joined.has(f.id) && !canFallBack(g, f, c.regionId))) return fail('물러날 곳이 없습니다');
  const gone = new Set(leaving.map((f) => f.id));
  for (const f of leaving) {
    if (joined.has(f.id)) continue;
    if (c.sea) retreatAtSea(g, f);
    else retreat(g, f, c.regionId);
  }
  note(g, '{navy|이/가} {place} 싸움에서 물러났습니다', { navy: navyName(faction), place: REGIONS[c.regionId].name }, faction === g.player ? 'bad' : 'info');
  if (side === 'attacker') c.attackerFleets = c.attackerFleets.filter((id) => !gone.has(id));
  else c.defenderFleets = c.defenderFleets.filter((id) => !gone.has(id));
  c.reinforcements = c.reinforcements?.filter((id) => !gone.has(id));
  const region = g.regions[c.regionId];
  const guarded = !c.sea && region.owner === c.defender && (region.garrison.length > 0 || levelOf(region, 'battery') > 0);
  const attackersLeft = c.attackerFleets.some((id) => fleetById(g, id));
  const defendersLeft = c.defenderFleets.some((id) => fleetById(g, id)) || guarded;
  if (!attackersLeft || !defendersLeft) {
    g.pending = g.pending.filter((p) => p.id !== c.id);
    // Nobody is left to hold the port: it falls without a fight.
    if (attackersLeft && !c.sea) {
      for (const id of c.attackerFleets) {
        const f = fleetById(g, id);
        if (!f || f.at !== c.regionId) continue;
        f.route = [];
        f.besieging = false;
        f.assault = false;
      }
      captureRegion(g, c.regionId, c.attacker);
    }
  } else {
    // A fight the player is no longer part of is settled at once, by the numbers, like any other between computer navies.
    const sides = [c.attacker, c.defender, ...[...c.attackerFleets, ...c.defenderFleets].flatMap((id) => fleetById(g, id)?.faction ?? [])];
    c.player = g.player !== null && sides.includes(g.player);
    if (!c.player) applyContactOutcome(g, c, resolveContact(g, c).outcome);
  }
  settlePending(g);
  return ok();
}

const isOver = (g: Grand) => g.phase === 'over';

/**
 * What the closing turn did: the meetings still waiting for the player, every meeting it brought about, and the route
 * each fleet was sailing on once every navy had given its orders (for the map's replay).
 */
export type TurnReport = { pending: Contact[]; finished: boolean; contacts: Contact[]; routes: Record<string, RegionId[]> };

/**
 * Ends the player's turn: the computer factions give their orders, every fleet sails one lane, and the meetings that
 * result are fought. Meetings that involve the player wait in `g.pending`; when none is left the turn closes.
 */
export function endTurn(g: Grand): TurnReport {
  if (g.phase !== 'orders') return { pending: g.pending, finished: g.phase === 'over', contacts: [], routes: {} };
  for (const f of GRAND_FACTIONS) if (g.factions[f].alive && f !== g.player) planAi(g, f);
  if (g.autoWorks && g.player && g.factions[g.player].alive) autoWorks(g, g.player);
  for (const fl of g.fleets) fl.from = fl.at ?? fl.transit?.from ?? null;
  const routes = Object.fromEntries(g.fleets.map((fl) => [fl.id, [...fl.route]]));
  let contacts: Contact[];
  if (marching(g)) contacts = findMarchContacts(g, marchFleets(g));
  else {
    moveFleets(g);
    contacts = findContacts(g);
  }
  const waiting: Contact[] = [];
  for (const c of contacts) {
    // A fleet may have been bounced or lost by an earlier meeting this turn.
    if (!c.attackerFleets.some((id) => fleetById(g, id))) continue;
    if (c.player) waiting.push(c);
    else applyContactOutcome(g, c, resolveContact(g, c).outcome);
  }
  g.fought = contacts.length;
  g.pending = waiting;
  if (waiting.length) {
    g.phase = 'battles';
    return { pending: waiting, finished: false, contacts, routes };
  }
  advanceTurn(g);
  return { pending: [], finished: isOver(g), contacts, routes };
}

// --- The turn closes --------------------------------------------------------------------------------------------

function recordStats(g: Grand, battles: number, turn = g.turn, paid?: Record<GrandFaction, { earned: number; upkeep: number }>) {
  const row = { turn, battles, gold: {}, regions: {}, ships: {}, strength: {}, income: {}, earned: {}, upkeep: {} } as unknown as Required<Grand['stats'][number]>;
  for (const f of GRAND_FACTIONS) {
    row.gold[f] = Math.round(g.factions[f].gold);
    row.regions[f] = ownedBy(g, f).length;
    row.ships[f] = shipCount(g, f);
    row.strength[f] = Math.round(g.fleets.reduce((a, fl) => a + (fl.faction === f ? fleetStrength(fl) : 0), 0));
    row.income[f] = factionIncome(g, f) - factionUpkeep(g, f);
    row.earned[f] = paid?.[f].earned ?? 0;
    row.upkeep[f] = paid?.[f].upkeep ?? 0;
  }
  g.stats.push(row);
}

function joinOrNewFleet(g: Grand, faction: GrandFaction, at: RegionId, unit: ShipUnit) {
  const open = g.fleets.filter((f) => f.faction === faction && f.at === at && f.ships.length < TUNING.fleetCap && !f.route.length);
  const host = open.sort((a, b) => b.ships.length - a.ships.length)[0];
  if (host) {
    host.ships.push(unit);
    return;
  }
  g.fleets.push({ id: mintId(g, 'f'), faction, name: `${REGIONS[at].name} 신규 함대`, commanderId: null, ships: [unit], at, transit: null, route: [], from: at, rest: 0 }); // i18n-ignore: new fleet name; the UI translates the pattern
}

const scaleShips = (ships: Partial<Record<ShipKind, number>>, k: number) => Object.fromEntries(Object.entries(ships).map(([kind, n]) => [kind, n! * k])) as Partial<Record<ShipKind, number>>;

function runEvents(g: Grand) {
  // Under the growth rules a navy researches its new hulls (growth.ts) instead of being handed them on a date.
  for (const u of growing(g) ? [] : TUNING.unlocks) {
    if (g.turn !== u.turn || !g.factions[u.faction].alive || g.factions[u.faction].unlocked.includes(u.kind)) continue;
    g.factions[u.faction].unlocked.push(u.kind);
    note(g, u.note, undefined, g.player === u.faction ? 'good' : 'info');
  }
  for (const f of GRAND_FACTIONS) {
    const plan = TUNING.reinforce[f];
    if (!g.factions[f].alive || g.turn < plan.first || (g.turn - plan.first) % plan.every !== 0) continue;
    if (g.regions[plan.at].owner !== f) continue;
    const ships = supportReinforcements(g, f, g.forces === 'wide-v1' ? scaleShips(plan.ships, TUNING.forceScale) : plan.ships);
    if (!Object.values(ships).some((n) => n && n > 0)) continue;
    const fleet = spawnFleet(g, f, plan.at, f === 'japan' ? '후속 함대' : f === 'ming' ? '원군 함대' : '의병 함대', ships, null);
    note(g, '{navy}의 {fleet} {n}척이 {place}에 도착했습니다', { navy: navyName(f), fleet: fleet.name, n: fleet.ships.length, place: REGIONS[plan.at].name }, f === g.player ? 'good' : 'info');
  }
}

/** What each faction must hold to win outright, and for how many turns in a row. */
export const OBJECTIVE_HOLD = 2;

export function controlValue(g: Grand, f: GrandFaction): number {
  return ownedBy(g, f).reduce((sum, id) => sum + REGIONS[id].value, 0);
}

/** Snapshot the opening territory once; losing and retaking the same port cannot farm objective progress. */
export function growthVictoryRules(g: Grand): NonNullable<Grand['victoryRules']> {
  return { kind: 'growth-v1', initialControl: Object.fromEntries(GRAND_FACTIONS.map((f) => [f, controlValue(g, f)])) as Record<GrandFaction, number>, target: Math.ceil(REGION_ORDER.reduce((sum, id) => sum + REGIONS[id].value, 0) / 4) };
}

export function objectiveText(f: GrandFaction, g?: Grand): string {
  if (g?.victoryRules?.kind === 'growth-v1') return '시작 영토보다 점령 가치를 늘려 공통 목표를 달성하고 반년 동안 유지합니다.';
  if (f === 'joseon') return '남해안의 모든 포구와 쓰시마를 차지하고 반년 동안 유지합니다.';
  if (f === 'japan') return '한산도를 포함해 남해안 포구에서 두 곳을 제외한 나머지를 차지하고 반년 동안 유지합니다.';
  return '부산포와 함께 쓰시마나 나고야를 차지하고 반년 동안 유지합니다.';
}

export function objectiveMet(g: Grand, f: GrandFaction): boolean {
  if (g.victoryRules?.kind === 'growth-v1') return controlValue(g, f) - g.victoryRules.initialControl[f] >= g.victoryRules.target;
  const own = (id: RegionId) => g.regions[id].owner === f;
  const coast = KOREA_COAST.filter(own).length;
  if (f === 'joseon') return coast === KOREA_COAST.length && own('tsushima');
  if (f === 'japan') return coast >= KOREA_COAST.length - 2 && own('hansan');
  return own('busan') && (own('tsushima') || own('nagoya'));
}

/** Progress toward the objective as have/need, for the strategic map. */
export function objectiveProgress(g: Grand, f: GrandFaction): { have: number; need: number } {
  if (g.victoryRules?.kind === 'growth-v1') return { have: Math.max(0, controlValue(g, f) - g.victoryRules.initialControl[f]), need: g.victoryRules.target };
  const own = (id: RegionId) => g.regions[id].owner === f;
  const coast = KOREA_COAST.filter(own).length;
  if (f === 'joseon') return { have: coast + (own('tsushima') ? 1 : 0), need: KOREA_COAST.length + 1 };
  if (f === 'japan') return { have: Math.min(coast, KOREA_COAST.length - 2), need: KOREA_COAST.length - 2 };
  return { have: (own('busan') ? 1 : 0) + (own('tsushima') || own('nagoya') ? 1 : 0), need: 2 };
}

export function scoreOf(g: Grand, f: GrandFaction): number {
  let s = (controlValue(g, f) - (g.victoryRules?.initialControl[f] ?? 0)) * TUNING.score.region;
  for (const fl of g.fleets) if (fl.faction === f) s += fleetStrength(fl) * TUNING.score.strength;
  return Math.round(s + Math.max(0, g.factions[f].gold) * TUNING.score.gold + g.credit[f] * TUNING.score.credit);
}

function checkVictory(g: Grand) {
  for (const f of GRAND_FACTIONS) {
    const st = g.factions[f];
    if (st.alive && ownedBy(g, f).length === 0) {
      st.alive = false;
      g.fleets = g.fleets.filter((fl) => fl.faction !== f);
      note(g, '{navy|은/는} 모든 포구를 잃고 패망했습니다', { navy: navyName(f) }, f === g.player ? 'bad' : 'info');
    }
    st.idle += 1;
    st.objectiveHold = st.alive && objectiveMet(g, f) ? st.objectiveHold + 1 : 0;
  }
  const alive = GRAND_FACTIONS.filter((f) => g.factions[f].alive);
  const best = (list: GrandFaction[]) => [...list].sort((a, b) => scoreOf(g, b) - scoreOf(g, a) || GRAND_FACTIONS.indexOf(a) - GRAND_FACTIONS.indexOf(b))[0]!;
  const done = (faction: GrandFaction, kind: 'objective' | 'score' | 'elimination') => {
    g.victory = { faction, kind, turn: g.turn };
    g.phase = 'over';
    note(g, '{navy|이/가} 캠페인에서 승리했습니다', { navy: navyName(faction) }, faction === g.player ? 'good' : 'bad');
  };
  if (g.player && !g.factions[g.player].alive) return done(best(alive.length ? alive : [g.player]), 'elimination');
  const objective = alive.find((f) => g.factions[f].objectiveHold >= OBJECTIVE_HOLD);
  if (objective) return done(objective, 'objective');
  // Only friends are left: they share the victory, credited to the one with the most to show.
  if (alive.length <= 1 || alive.every((a) => alive.every((b) => allied(g, a, b)))) return done(best(alive), 'elimination');
  if (g.turn >= MAX_TURNS) done(best(alive), 'score');
}

function advanceTurn(g: Grand) {
  if (marching(g)) holdSieges(g);
  // Works and ships under construction.
  for (const id of REGION_ORDER) {
    const r = g.regions[id];
    for (const b of r.buildings) {
      if (b.upgradeLeft > 0) {
        b.upgradeLeft -= 1;
        if (b.upgradeLeft === 0) {
          b.level += 1;
          b.hp = 1;
          b.upgradeTotal = 0;
          if (r.owner === g.player) note(g, '{place}의 {work} {level}단계가 완공되었습니다', { place: REGIONS[id].name, work: BUILDING_DEFS[b.kind].label, level: b.level }, 'good', 'built');
        }
      }
    }
    // A blockaded port builds no ships and raises no guard boats.
    if (!r.owner || r.siege) continue;
    // A shipyard that is razed or still in its foundations builds nothing: the queue waits.
    for (const q of levelOf(r, 'shipyard') > 0 ? [...r.queue] : []) {
      q.left -= 1;
      if (q.left > 0) continue;
      r.queue.splice(r.queue.indexOf(q), 1);
      joinOrNewFleet(g, r.owner, id, spawnShip(g, q.kind));
      if (r.owner === g.player) note(g, '{place}에서 {ship|이/가} 완성되었습니다', { place: REGIONS[id].name, ship: SHIP_PREFIX[q.kind] }, 'good', 'built');
    }
    if (r.unrest > 0) r.unrest -= 1;
    else {
      for (const u of r.garrison) u.hull = Math.min(1, u.hull + 0.2);
      const cap = garrisonCap(id, r);
      if (r.garrisonRule) {
        if (r.garrison.length >= cap) r.garrisonReserve = 0;
        else {
          r.garrisonReserve = (r.garrisonReserve ?? 0) + shipDef(GARRISON_KIND.joseon).strength * TUNING.garrison.regen * guardScale(r);
          const kind = GARRISON_KIND[r.owner], price = shipDef(kind).strength;
          while (r.garrison.length < cap && r.garrisonReserve >= price) {
            r.garrisonReserve -= price;
            r.garrison.push(spawnShip(g, kind));
          }
          if (r.garrison.length >= cap) r.garrisonReserve = 0;
        }
      } else if (r.garrison.length < cap) for (let i = 0; i < TUNING.garrison.regen && r.garrison.length < cap; i += 1) r.garrison.push(spawnShip(g, GARRISON_KIND[r.owner]));
    }
  }
  // Fleets rest in friendly ports and wear down in foreign water.
  for (const fl of g.fleets) {
    if (fl.rest > 0) fl.rest -= 1;
    if (!fl.at) {
      // Under the march rules a winter spent out at sea costs more.
      const lost = 0.04 + (marching(g) && winterTurn(g.turn) ? MARCH.winterSupply : 0);
      for (const u of fl.ships) u.supply = Math.max(0.15, u.supply - lost);
      continue;
    }
    const r = g.regions[fl.at];
    if (r.owner && allied(g, fl.faction, r.owner)) {
      const rate = repairRates(r);
      for (const u of fl.ships) {
        u.hull = Math.min(1, u.hull + rate.hull);
        u.crew = Math.min(1, u.crew + rate.crew);
        u.supply = Math.min(1, u.supply + rate.supply);
      }
    } else {
      for (const u of fl.ships) {
        u.supply = Math.max(0.15, u.supply - TUNING.attrition.supply);
        u.crew = Math.max(0.25, u.crew - TUNING.attrition.crew);
      }
    }
  }
  // Treasury.
  const paid = {} as Record<GrandFaction, { earned: number; upkeep: number }>;
  for (const f of GRAND_FACTIONS) {
    const st = g.factions[f];
    paid[f] = { earned: 0, upkeep: 0 };
    if (!st.alive) continue;
    paid[f] = { earned: factionIncome(g, f), upkeep: factionUpkeep(g, f) };
    st.gold += paid[f].earned - paid[f].upkeep;
    if (st.gold < 0) {
      st.gold = 0;
      desert(g, f);
    }
  }
  g.events.mods = g.events.mods.map((m) => ({ ...m, left: m.left - 1 })).filter((m) => m.left > 0);
  // A stance and an order to storm are for one turn.
  for (const fl of g.fleets) {
    delete fl.stance;
    delete fl.assault;
  }
  advanceResearch(g);
  runEvents(g);
  recordStats(g, g.fought, g.turn, paid);
  checkVictory(g);
  if (g.phase !== 'over') {
    g.turn += 1;
    g.phase = 'orders';
    if (growing(g)) joinCommanders(g);
    fireEvents(g);
  }
}

/**
 * The blockades go on or end: a port no blockader lies off any more is free; otherwise its garrison goes hungry, its
 * guns wear the blockaders down, and when it has held out as long as it can it gives up to the blockading navy.
 */
function holdSieges(g: Grand) {
  for (const id of REGION_ORDER) {
    const r = g.regions[id];
    const s = r.siege;
    if (!s) continue;
    const owner = r.owner;
    const blockaders = owner ? g.fleets.filter((f) => f.at === id && f.besieging && atWar(g, f.faction, owner)) : [];
    if (!owner || !blockaders.length) {
      delete r.siege;
      continue;
    }
    s.turns += 1;
    for (const u of r.garrison) {
      u.crew = Math.max(0.2, u.crew - MARCH.starve.crew);
      u.supply = Math.max(0.1, u.supply - MARCH.starve.supply);
    }
    const guns = levelOf(r, 'battery');
    if (guns) for (const f of blockaders) for (const u of f.ships) u.hull = Math.max(0.25, u.hull - MARCH.shoreFire * guns);
    if (s.turns < s.hold) continue;
    const taker = blockaders.some((f) => f.faction === s.by) ? s.by : blockaders[0]!.faction;
    note(g, '{place}의 수비대가 봉쇄를 견디지 못하고 항복했습니다', { place: REGIONS[id].name }, owner === g.player ? 'bad' : taker === g.player ? 'good' : 'info');
    for (const f of blockaders) {
      f.besieging = false;
      f.assault = false;
    }
    captureRegion(g, id, taker);
  }
}

/** With the treasury empty, the weakest ships desert. */
function desert(g: Grand, f: GrandFaction) {
  const all = g.fleets.filter((fl) => fl.faction === f).flatMap((fl) => fl.ships.map((u) => ({ fl, u })));
  all.sort((a, b) => shipDef(a.u.kind).strength * a.u.hull - shipDef(b.u.kind).strength * b.u.hull);
  const n = Math.ceil(all.length * 0.08);
  for (const { fl, u } of all.slice(0, n)) fl.ships.splice(fl.ships.indexOf(u), 1);
  dropEmpty(g);
  if (n) note(g, n === 1 ? '{navy}: 은이 부족해 함선 1척이 이탈했습니다' : '{navy}: 은이 부족해 함선 {n}척이 이탈했습니다', { navy: navyName(f), n }, f === g.player ? 'bad' : 'info');
}
