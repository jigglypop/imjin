import type { ShipKind } from '../types';
import {
  MAX_TURNS,
  TUNING,
  batteryStrength,
  buildingCost,
  buildingOf,
  freeSlots,
  levelOf,
  listStrength,
  netIncome,
  queueSlots,
  regionIncome,
  shipDef,
  yardPrice,
} from './economy';
import { buildRequirement, orderBuild, commanderSuspended, orderCommander, orderMerge, orderMove, orderRecruit, orderRefit, recruitProblem, refitCost } from './orders';
import { LANES, REGIONS } from './regions';
import { next, range } from './rng';
import type { BuildingKind, Fleet, Grand, GrandFaction, RegionId } from './types';
import { BUILDING_KINDS, MAX_LEVEL } from './types';
import { allied, atWar, defenceStrength, findRoute, fleetStrength, laneDistance, ownedBy } from './world';

/**
 * The computer's three commanders. Each reads the same board and the same rules as the player; what differs is what
 * it wants. Everything is deterministic: ties and small jitters come from the seeded generator in the save.
 */
export type Personality = {
  /** Own strength over the defender's needed before it attacks. Lower is bolder. */
  attackRatio: number;
  /** Share of the treasury it will spend on works each turn before ships. */
  worksShare: number;
  /** Gold always kept back. */
  reserve: number;
  /** How much a fleet is worth keeping at a port that is threatened. */
  guard: number;
  /** Fleet composition aimed for, by share of fleet value. */
  doctrine: Partial<Record<ShipKind, number>>;
  /** Weights for each kind of work. */
  works: Record<BuildingKind, number>;
  /** Regions the faction wants most, as extra value. */
  wanted: Partial<Record<RegionId, number>>;
  /** Net income below which it stops raising a larger fleet, unless the home waters are in danger. */
  minNet: number;
  /** Share of the attack threshold dropped per turn without a fight, and the least it can fall to. */
  impatience: number;
  minPatience: number;
  /** Average hull below which a fleet in a friendly port rests instead of sailing out. */
  restBelow: number;
};

export const AI: Record<GrandFaction, Personality> = {
  // Defends with guns and docks, strikes when it has the better of it.
  joseon: {
    attackRatio: 1.35,
    worksShare: 0.45,
    reserve: 80,
    guard: 1,
    doctrine: { panokseon: 0.6, geobukseon: 0.22, hyeopseon: 0.18 },
    works: { camp: 1, shipyard: 1.1, battery: 1.5, dock: 1.2, granary: 1.2, beacon: 0.3 },
    wanted: { busan: 1.5, angolpo: 1, tsushima: 1 },
    minNet: 40,
    impatience: 0.03,
    minPatience: 0.7,
    restBelow: 0.7,
  },
  // Invades: many cheap hulls, bold attacks, little patience for walls.
  japan: {
    attackRatio: 0.95,
    worksShare: 0.3,
    reserve: 60,
    guard: 0.6,
    doctrine: { atakebune: 0.42, sekibune: 0.44, kobaya: 0.14 },
    works: { camp: 0.9, shipyard: 1.3, battery: 0.6, dock: 0.9, granary: 1.2, beacon: 0.3 },
    wanted: { hansan: 1.5, geoje: 1, yeosu: 1 },
    minNet: 0,
    impatience: 0.05,
    minPatience: 0.6,
    restBelow: 0.6,
  },
  // Rich and slow: builds up, then comes in force.
  ming: {
    attackRatio: 1.25,
    worksShare: 0.5,
    reserve: 200,
    guard: 1,
    doctrine: { mingship: 0.6, mingsmall: 0.4 },
    works: { camp: 1, shipyard: 1.1, battery: 0.8, dock: 1, granary: 1.3, beacon: 0.2 },
    wanted: { busan: 1.5, nagoya: 1.5, tsushima: 1 },
    minNet: 60,
    impatience: 0.03,
    minPatience: 0.75,
    restBelow: 0.7,
  },
};

const enemiesOf = (g: Grand, f: GrandFaction) => (['joseon', 'japan', 'ming'] as const).filter((o) => atWar(g, f, o));

/** Enemy strength that can be in a region by the end of this turn: already there, a lane away, or about to land. */
export function threatTo(g: Grand, f: GrandFaction, id: RegionId): number {
  let t = 0;
  for (const fl of g.fleets) {
    if (!atWar(g, fl.faction, f)) continue;
    if (fl.at === id || fl.transit?.to === id || (fl.at && LANES[fl.at].some((l) => l.to === id && l.turns === 1))) t += fleetStrength(fl);
  }
  return t;
}

function idleGroups(g: Grand, f: GrandFaction): Map<RegionId, Fleet[]> {
  const out = new Map<RegionId, Fleet[]>();
  for (const fl of g.fleets) {
    if (fl.faction !== f || !fl.at || fl.transit || fl.rest > 0) continue;
    out.set(fl.at, [...(out.get(fl.at) ?? []), fl]);
  }
  return out;
}

const avgHull = (list: Fleet[]) => {
  let n = 0;
  let h = 0;
  for (const fl of list) for (const u of fl.ships) {
    n += 1;
    h += u.hull;
  }
  return n ? h / n : 1;
};

// --- Economy ----------------------------------------------------------------------------------------------------

function fleetShares(g: Grand, f: GrandFaction): Map<ShipKind, number> {
  const out = new Map<ShipKind, number>();
  for (const fl of g.fleets) if (fl.faction === f) for (const u of fl.ships) out.set(u.kind, (out.get(u.kind) ?? 0) + shipDef(u.kind).gold);
  for (const id of ownedBy(g, f)) for (const q of g.regions[id].queue) out.set(q.kind, (out.get(q.kind) ?? 0) + shipDef(q.kind).gold);
  return out;
}

function recruit(g: Grand, f: GrandFaction, spendLimit: number) {
  const P = AI[f];
  const st = g.factions[f];
  const shares = fleetShares(g, f);
  const yards = ownedBy(g, f).filter((id) => levelOf(g.regions[id], 'shipyard') > 0 && g.regions[id].queue.length < queueSlots(g.regions[id]));
  // The front-most yards first: they launch where the fleet is wanted.
  for (const id of yards) {
    const r = g.regions[id];
    while (r.queue.length < queueSlots(r)) {
      const total = [...shares.values()].reduce((a, b) => a + b, 0) || 1;
      let best: ShipKind | null = null;
      let bestScore = -Infinity;
      for (const [kind, target] of Object.entries(P.doctrine) as [ShipKind, number][]) {
        if (recruitProblem(g, id, kind)) continue;
        const price = yardPrice(kind, levelOf(r, 'shipyard'));
        if (price > spendLimit || st.gold - price < P.reserve) continue;
        const score = target - (shares.get(kind) ?? 0) / total + range(g.rng, 0, 0.03);
        if (score > bestScore) {
          bestScore = score;
          best = kind;
        }
      }
      if (!best) break;
      // A larger fleet costs upkeep; keep the budget in the black unless the home waters are in danger.
      const price = yardPrice(best, levelOf(r, 'shipyard'));
      const threatened = ownedBy(g, f).some((o) => threatTo(g, f, o) > defenceStrength(g, o) * 0.8);
      if (!threatened && netIncome(g, f) - price * TUNING.upkeepRate < P.minNet) break;
      if (!orderRecruit(g, id, best).ok) break;
      spendLimit -= price;
      shares.set(best, (shares.get(best) ?? 0) + shipDef(best).gold);
    }
  }
}

type Work = { id: RegionId; kind: BuildingKind; level: number; gold: number; score: number };

function bestWork(g: Grand, f: GrandFaction, budget: number, floor = 0.35): Work | null {
  const P = AI[f];
  const st = g.factions[f];
  const turnsLeft = Math.max(0, MAX_TURNS - g.turn);
  const owned = ownedBy(g, f);
  const yards = owned.filter((id) => levelOf(g.regions[id], 'shipyard') > 0).length;
  const enemyNear = (id: RegionId) => LANES[id].some((l) => g.regions[l.to].owner !== null && atWar(g, f, g.regions[l.to].owner!));
  let best: Work | null = null;
  for (const id of owned) {
    const r = g.regions[id];
    const def = REGIONS[id];
    const threat = threatTo(g, f, id);
    const border = enemyNear(id);
    for (const kind of BUILDING_KINDS) {
      const have = buildingOf(r, kind);
      if (have && have.upgradeLeft > 0) continue;
      const level = (have?.level ?? 0) + 1;
      if (level > MAX_LEVEL || (!have && freeSlots(id, r) <= 0)) continue;
      if (buildRequirement(g, id, kind, level)) continue;
      const cost = buildingCost(kind, level);
      if (cost.gold > budget || st.gold - cost.gold < P.reserve) continue;
      let u = 0;
      if (kind === 'granary') {
        const gain = regionIncome(g, id) * (TUNING.granaryBonus / (1 + TUNING.granaryBonus * (level - 1)));
        u = turnsLeft > cost.turns + 4 ? (gain * Math.min(turnsLeft - cost.turns, 16)) / cost.gold : 0;
      } else if (kind === 'shipyard') {
        if (level === 1) u = yards < 2 || (yards < 4 && st.gold > 700) ? (def.value >= 2 ? 2.4 : 1.4) : 0;
        else if (level === 2) u = f === 'joseon' ? 2 : 1.1;
        else u = 0.7;
      } else if (kind === 'camp') {
        u = (level === 1 ? 1.1 : 0.7) * (levelOf(r, 'shipyard') > 0 ? 1.4 : 1) + (border ? 0.3 : 0);
      } else if (kind === 'battery') {
        u = (threat > 0 ? 1.5 + Math.min(2, threat / 1200) : border ? 1.1 : 0.2) * (level === 1 ? 1.2 : 0.7);
      } else if (kind === 'dock') {
        const here = g.fleets.filter((fl) => fl.faction === f && fl.at === id);
        u = here.length && avgHull(here) < 0.8 ? 1.8 : here.length ? 0.9 : 0.3;
        if (level > 1) u *= 0.6;
      } else {
        u = border ? 0.7 : 0.3;
      }
      u *= P.works[kind] * (def.value >= 2 ? 1 : 0.85);
      const score = (u / cost.gold) * 400 + range(g.rng, 0, 0.02);
      if (score > floor && (!best || score > best.score)) best = { id, kind, level, gold: cost.gold, score };
    }
  }
  return best;
}

function economy(g: Grand, f: GrandFaction) {
  const P = AI[f];
  const st = g.factions[f];
  let works = st.gold * P.worksShare;
  for (let i = 0; i < 4; i += 1) {
    const w = bestWork(g, f, works);
    if (!w || !orderBuild(g, w.id, w.kind).ok) break;
    works -= w.gold;
  }
  recruit(g, f, st.gold);
  // Gold that is still idle goes to works, whatever the share.
  for (let i = 0; i < 3 && st.gold > P.reserve + 500; i += 1) {
    const w = bestWork(g, f, st.gold - P.reserve - 300, 0.1);
    if (!w || !orderBuild(g, w.id, w.kind).ok) break;
  }
}

// --- Fleets -----------------------------------------------------------------------------------------------------

/** Value of taking a region, in region-value units. */
function prize(g: Grand, f: GrandFaction, id: RegionId): number {
  const def = REGIONS[id];
  let v = def.value + (AI[f].wanted[id] ?? 0);
  if (def.capitalOf && def.capitalOf !== f) v += 1.5;
  if (def.korea && f === 'japan') v += 0.6;
  if (def.korea && f !== 'japan') v += 0.4;
  const r = g.regions[id];
  v += 0.4 * levelOf(r, 'shipyard') + 0.2 * levelOf(r, 'camp');
  return v;
}

/** What a defended region fields against an attack: its works, garrison, fleets, and the help one lane away. */
function enemyDefence(g: Grand, id: RegionId): number {
  const r = g.regions[id];
  let d = defenceStrength(g, id);
  if (!r.owner) return d;
  for (const lane of LANES[id]) {
    if (lane.turns !== 1) continue;
    for (const fl of g.fleets) if (fl.at === lane.to && fl.faction !== r.owner && allied(g, fl.faction, r.owner)) d += fleetStrength(fl) * 0.5;
    for (const fl of g.fleets) if (fl.at === lane.to && fl.faction === r.owner) d += fleetStrength(fl) * 0.6;
  }
  return d;
}

function nearestEnemyDistance(g: Grand, f: GrandFaction, from: RegionId): number {
  let best = Infinity;
  for (const e of enemiesOf(g, f)) for (const id of ownedBy(g, e)) best = Math.min(best, laneDistance(from, id));
  return best;
}

function fleetsPlan(g: Grand, f: GrandFaction) {
  const P = AI[f];
  // A navy that has not fought for a while grows bolder: the standoff has to end.
  const patience = Math.max(P.minPatience, 1 - P.impatience * g.factions[f].idle);
  // Small groups decide first, so they flow into the larger body and the larger one, seeing them coming, stays; two groups never swap ports.
  const strength = (fleets: Fleet[]) => fleets.reduce((a, fl) => a + fleetStrength(fl), 0);
  const groups = [...idleGroups(g, f)].sort((a, b) => strength(a[1]) - strength(b[1]));
  // The first turn is a lull: the player gets one turn to see the board before any computer navy attacks.
  const targets = g.turn <= TUNING.openingPeace ? [] : enemiesOf(g, f).flatMap((e) => ownedBy(g, e));
  for (const [at, fleets] of groups) {
    const here = g.regions[at];
    const power = fleets.reduce((a, fl) => a + fleetStrength(fl), 0);
    const myPort = here.owner !== null && allied(g, f, here.owner);
    // Put the fleet right before it fights, if the port can do it.
    if (myPort && avgHull(fleets) < 0.85) for (const fl of fleets) if (g.factions[f].gold - refitCost(fl) > P.reserve + 120) orderRefit(g, fl.id);
    // Friends in the same port fight beside us, though they may choose otherwise.
    const friends = g.fleets.filter((o) => o.at === at && o.faction !== f && allied(g, f, o.faction)).reduce((a, o) => a + fleetStrength(o), 0);
    const joint = power + friends * 0.6;
    const threat = myPort ? threatTo(g, f, at) : 0;
    const sources = new Set<RegionId>();
    for (const o of g.fleets) if (o.at && atWar(g, o.faction, f) && LANES[at].some((l) => l.to === o.at)) sources.add(o.at);
    const portDefence = myPort ? listStrength(here.garrison) + batteryStrength(here) : 0;
    const holdBack = Math.max(0, threat * P.guard * 1.1 - portDefence);
    // Pick the best target the fleet can reach in three turns.
    let pick: { id: RegionId; u: number } | null = null;
    for (const t of targets) {
      const route = findRoute(g, f, at, t);
      if (!route || route.turns > 3) continue;
      // Striking the enemy stack that threatens the port removes the danger; any other move leaves the port exposed.
      const force = myPort && !sources.has(t) ? Math.max(0, joint - holdBack) : joint;
      const ratio = force / Math.max(1, enemyDefence(g, t));
      if (ratio < P.attackRatio * patience * (1 + 0.08 * (route.turns - 1))) continue;
      const u = prize(g, f, t) - 0.35 * route.turns + Math.min(ratio, 3) * 0.2 + range(g.rng, 0, 0.1);
      if (!pick || u > pick.u) pick = { id: t, u };
    }
    const resting = myPort && avgHull(fleets) < P.restBelow && threat < power * 0.5;
    if (pick && !resting) {
      for (const fl of fleets) orderMove(g, fl.id, pick.id);
      continue;
    }
    if (resting || threat > 0) continue;
    // No fight to be had: gather at the port nearest the enemy, where the fleet is useful.
    const front = stagingPort(g, f, at, fleets);
    // A group already ordered from that port to this one has the same idea: one of the two stays, so they do not swap.
    const swapping = front !== null && g.fleets.some((o) => o.faction === f && o.at === front && o.route[o.route.length - 1] === at);
    if (front && front !== at && !swapping) for (const fl of fleets) orderMove(g, fl.id, front);
  }
}

/** Idle fleets of one port are joined into the larger ones, so a stream of new hulls does not become a crowd of single ships. */
function consolidate(g: Grand, f: GrandFaction) {
  for (const [, fleets] of idleGroups(g, f)) {
    const list = fleets.filter((fl) => !fl.route.length).sort((a, b) => Number(!!b.commanderId) - Number(!!a.commanderId) || b.ships.length - a.ships.length);
    let host = list.shift();
    for (const fl of list) {
      if (!host) break;
      if (!orderMerge(g, host.id, fl.id).ok) host = fl;
    }
  }
}

/**
 * Where idle fleets gather when there is no fight to be had: the friendly port within two lanes where the most
 * friendly strength already lies, leaning toward the enemy. Fleets flow into the largest body instead of dribbling
 * into the enemy one by one.
 */
function stagingPort(g: Grand, f: GrandFaction, from: RegionId, moving: Fleet[]): RegionId | null {
  // The strength already lying in a port, not counting the fleets that are deciding where to go.
  const mass = (id: RegionId) => g.fleets.reduce((a, fl) => a + (moving.includes(fl) ? 0 : fl.at === id && fl.faction === f ? fleetStrength(fl) : fl.at === id && allied(g, f, fl.faction) ? fleetStrength(fl) * 0.6 : 0), 0);
  const here = nearestEnemyDistance(g, f, from);
  let best: { id: RegionId; score: number } | null = null;
  for (const id of Object.keys(g.regions) as RegionId[]) {
    const o = g.regions[id].owner;
    if (o === null || !allied(g, f, o)) continue;
    const route = findRoute(g, f, from, id);
    if (!route || route.turns > 4) continue;
    const lean = Math.min(3, here - nearestEnemyDistance(g, f, id));
    const score = mass(id) + 500 * lean - 300 * route.turns + (o === f ? 150 : 0) + 120 * REGIONS[id].value;
    if (!best || score > best.score) best = { id, score };
  }
  return best?.id ?? null;
}

/** Fleets without a commander get the best officer who has none. */
function assignCommanders(g: Grand, f: GrandFaction) {
  const free = g.factions[f].commanders.filter((c) => c.alive && !commanderSuspended(g, c.id) && !g.fleets.some((fl) => fl.commanderId === c.id)).sort((a, b) => b.level - a.level);
  const bare = g.fleets.filter((fl) => fl.faction === f && !fl.commanderId).sort((a, b) => b.ships.length - a.ships.length);
  for (const fl of bare) {
    const c = free.shift();
    if (!c) return;
    orderCommander(g, fl.id, c.id);
  }
}

/** Gives the faction's orders for the turn. */
export function planAi(g: Grand, f: GrandFaction) {
  // Advance the generator by a fixed amount per faction so plans do not shift when an earlier faction died.
  next(g.rng);
  consolidate(g, f);
  assignCommanders(g, f);
  economy(g, f);
  fleetsPlan(g, f);
}
