import type { ShipKind } from '../types';
import {
  MAX_TURNS,
  TUNING,
  batteryStrength,
  buildingCost,
  buildingOf,
  BUILDING_DEFS,
  factionUpkeep,
  freeSlots,
  GARRISON_KIND,
  garrisonCap,
  levelOf,
  listStrength,
  netIncome,
  queueSlots,
  regionIncome,
  shipDef,
  yardPrice,
} from './economy';
import { buildRequirement, orderAssault, orderBuild, commanderSuspended, orderCommander, orderMerge, orderMove, orderRecruit, orderRefit, orderStance, recruitProblem, refitCost } from './orders';
import { REGIONS } from './regions';
import { forkRng, next, range, type Rng } from './rng';
import type { BuildingKind, Fleet, Grand, GrandFaction, RegionId } from './types';
import { BUILDING_KINDS, MAX_LEVEL } from './types';
import { allied, atWar, defenceStrength, findRoute, fleetObserved, fleetStrength, laneDistance, lanesOf, note, ownedBy, passable, visibleRegions } from './world';
import { MARCH, fleetReach, laneKm, marchDistances, marchRoute, marching } from './march';

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
  /** What the commander does differently under the march rules, where a fight draws in the fleets lying near it. */
  march?: Partial<Omit<Personality, 'march'>>;
};

/** A navy's personality in this war: the march rules may change some of its numbers. */
export const personality = (g: Grand, f: GrandFaction): Personality => (marching(g) && AI[f].march ? { ...AI[f], ...AI[f].march } : AI[f]);

export const AI: Record<GrandFaction, Personality> = {
  // Defends with guns and docks, strikes when it has the better of it.
  joseon: {
    attackRatio: 1.35,
    worksShare: 0.45,
    reserve: 80,
    guard: 1,
    doctrine: { panokseon: 0.58, geobukseon: 0.21, hyeopseon: 0.16, pojakseon: 0.03, sahuseon: 0.02 },
    works: { camp: 1, shipyard: 1.1, battery: 1.5, dock: 1.2, granary: 1.2, beacon: 0.3 },
    wanted: { busan: 1.5, angolpo: 1, tsushima: 1 },
    minNet: 40,
    impatience: 0.03,
    minPatience: 0.7,
    restBelow: 0.7,
    // An attack on the Japanese anchorages round Busan meets every fleet lying in them: waiting for a safer margin only
    // gives the invader time to gather more.
    march: { attackRatio: 1.1 },
  },
  // Invades: many cheap hulls, bold attacks, little patience for walls.
  japan: {
    attackRatio: 0.95,
    worksShare: 0.3,
    reserve: 60,
    guard: 0.6,
    doctrine: { daeantaek: 0.04, atakebune: 0.36, sogantaek: 0.06, daegwanseon: 0.06, sekibune: 0.36, kobaya: 0.12 },
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
    doctrine: { gwangseon: 0.06, mingship: 0.52, haechangseon: 0.08, mingsmall: 0.3, hoseon: 0.04 },
    works: { camp: 1, shipyard: 1.1, battery: 0.8, dock: 1, granary: 1.3, beacon: 0.2 },
    wanted: { busan: 1.5, nagoya: 1.5, tsushima: 1 },
    minNet: 60,
    impatience: 0.03,
    minPatience: 0.75,
    restBelow: 0.7,
  },
};

const enemiesOf = (g: Grand, f: GrandFaction) => (['joseon', 'japan', 'ming'] as const).filter((o) => atWar(g, f, o));

/**
 * The enemy strength each region can see arrive this turn under the march rules. It is asked for again and again while a
 * navy plans, so it is kept until a fleet moves, a ship is lost or launched, or a relation changes.
 */
const marchThreats = new WeakMap<Grand, { key: string; threat: Map<RegionId, number> }>();

function marchThreat(g: Grand, f: GrandFaction): Map<RegionId, number> {
  let key = [g.turn, f, g.relations['japan:joseon'], g.relations['japan:ming'], g.relations['joseon:ming']].join(':');
  for (const fl of g.fleets) {
    const t = fl.transit;
    key += '|' + fl.id + ':' + fl.ships.length + ':' + (fl.at ?? (t ? t.from + '>' + t.to + ':' + t.sailed : ''));
  }
  const cached = marchThreats.get(g);
  if (cached?.key === key) return cached.threat;
  const threat = new Map<RegionId, number>();
  const seen = visibleRegions(g, f);
  for (const fl of g.fleets) {
    if (!atWar(g, fl.faction, f) || !fleetObserved(g, f, fl, seen)) continue;
    const reach = fleetReach(g, fl);
    for (const [id, km] of marchDistances(g, fl, reach).dist) if (km <= reach) threat.set(id, (threat.get(id) ?? 0) + fleetStrength(fl));
  }
  marchThreats.set(g, { key, threat });
  return threat;
}

/** Enemy strength that can be in a region by the end of this turn: already there, a lane away, or about to land. */
export function threatTo(g: Grand, f: GrandFaction, id: RegionId): number {
  if (marching(g)) return marchThreat(g, f).get(id) ?? 0;
  let t = 0;
  const seen = visibleRegions(g, f);
  for (const fl of g.fleets) {
    if (!atWar(g, fl.faction, f) || !fleetObserved(g, f, fl, seen)) continue;
    if (fl.at === id || fl.transit?.to === id || (fl.at && lanesOf(g, fl.at).some((l) => l.to === id && l.turns === 1))) t += fleetStrength(fl);
  }
  return t;
}

/** Turns the slowest of `fleets` (lying together) needs to reach `to`, or null when one of them has no way there. */
function turnsTo(g: Grand, fleets: Fleet[], to: RegionId): number | null {
  if (!marching(g)) {
    const at = fleets[0]?.at;
    return at ? findRoute(g, fleets[0]!.faction, at, to)?.turns ?? null : null;
  }
  let worst = 0;
  for (const fl of fleets) {
    const route = marchRoute(g, fl, to);
    if (!route) return null;
    worst = Math.max(worst, route.turns);
  }
  return worst;
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
  const P = personality(g, f);
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

function bestWork(g: Grand, f: GrandFaction, budget: number, floor = 0.35, dice: Rng = g.rng, reserve = personality(g, f).reserve): Work | null {
  const P = personality(g, f);
  const st = g.factions[f];
  const turnsLeft = Math.max(0, MAX_TURNS - g.turn);
  const owned = ownedBy(g, f);
  const yards = owned.filter((id) => levelOf(g.regions[id], 'shipyard') > 0).length;
  const enemyNear = (id: RegionId) => lanesOf(g, id).some((l) => g.regions[l.to].owner !== null && atWar(g, f, g.regions[l.to].owner!));
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
      if (cost.gold > budget || st.gold - cost.gold < reserve) continue;
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
      const score = (u / cost.gold) * 400 + range(dice, 0, 0.02);
      if (score > floor && (!best || score > best.score)) best = { id, kind, level, gold: cost.gold, score };
    }
  }
  return best;
}

function economy(g: Grand, f: GrandFaction) {
  const P = personality(g, f);
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

/** Most works the player's auto-build starts in one turn: a few steady orders, not a spree that empties the treasury. */
export const AUTO_WORK_CAP = 2;

/** Silver auto-build leaves untouched: next turn's upkeep, and never less than this floor, so the fleet is always paid. */
export const AUTO_WORK_FLOOR = 150;

export function autoWorkReserve(g: Grand, f: GrandFaction): number {
  return Math.max(AUTO_WORK_FLOOR, factionUpkeep(g, f));
}

/**
 * The player's "자동 건설": the computer's choice of works (camp first where a yard or a front needs it, then yards,
 * batteries, docks, granaries) for the faction's own ports, with no ships. It keeps a reserve, places at most
 * AUTO_WORK_CAP orders and rolls its jitter from a fork of the seed, so the campaign's own dice are not touched.
 * Each order goes through orderBuild, so camp levels, one work per kind, free plots and prices apply as usual.
 */
export function autoWorks(g: Grand, f: GrandFaction): number {
  const dice = forkRng(g.seed, g.turn, 0x5eed);
  const reserve = autoWorkReserve(g, f);
  let placed = 0;
  while (placed < AUTO_WORK_CAP) {
    const w = bestWork(g, f, g.factions[f].gold - reserve, 0.1, dice, reserve);
    if (!w || !orderBuild(g, w.id, w.kind).ok) break;
    note(g, '자동 건설: {place}의 {work} {level}단계 ({gold}냥)', { place: REGIONS[w.id].name, work: BUILDING_DEFS[w.kind].label, level: w.level, gold: w.gold }, 'good', 'built');
    placed += 1;
  }
  return placed;
}

// --- Fleets -----------------------------------------------------------------------------------------------------

/** Value of taking a region, in region-value units. */
function prize(g: Grand, f: GrandFaction, id: RegionId, seen: ReadonlySet<RegionId>): number {
  const def = REGIONS[id];
  let v = def.value + (personality(g, f).wanted[id] ?? 0);
  if (def.capitalOf && def.capitalOf !== f) v += 1.5;
  if (def.korea && f === 'japan') v += 0.6;
  if (def.korea && f !== 'japan') v += 0.4;
  const r = g.regions[id];
  if (seen.has(id)) v += 0.4 * levelOf(r, 'shipyard') + 0.2 * levelOf(r, 'camp');
  return v;
}

/** What a defended region fields against an attack: its works, garrison, fleets, and the help one lane away. */
export function estimatedDefence(g: Grand, f: GrandFaction, id: RegionId, seen = visibleRegions(g, f)): number {
  const r = g.regions[id];
  // An unscouted port is an estimate from public region value and the common guard rules. Never read its
  // actual guards, works, fleet sizes or treasury. A scout replaces that estimate with observed defence.
  if (!seen.has(id)) {
    if (!r.owner) return 0;
    const assumed = { owner: r.owner, buildings: [], garrison: [], queue: [], unrest: 0, garrisonRule: r.garrisonRule };
    return garrisonCap(id, assumed) * shipDef(GARRISON_KIND[r.owner]).strength;
  }
  let d = defenceStrength(g, id);
  if (!r.owner) return d;
  // Under the march rules the fleets lying close enough reinforce the fight for certain; under the lane rules a fleet a lane
  // away only may come.
  const march = marching(g);
  for (const lane of lanesOf(g, id)) {
    if (march ? laneKm(g, id, lane.to) > MARCH.reinforce : lane.turns !== 1) continue;
    for (const fl of g.fleets) if (fl.at === lane.to && fleetObserved(g, f, fl, seen) && fl.faction !== r.owner && allied(g, fl.faction, r.owner)) d += fleetStrength(fl) * (march ? 0.9 : 0.5);
    for (const fl of g.fleets) if (fl.at === lane.to && fleetObserved(g, f, fl, seen) && fl.faction === r.owner) d += fleetStrength(fl) * (march ? 0.9 : 0.6);
  }
  return d;
}

/** What a blockade of the port would have to face: the fleets in and close round it, not its garrison or guns. */
function fleetDefence(g: Grand, f: GrandFaction, id: RegionId, seen: Set<RegionId>): number {
  const owner = g.regions[id].owner;
  if (!owner) return 0;
  let d = 0;
  for (const fl of g.fleets) {
    if (!fl.at || !allied(g, fl.faction, owner) || !atWar(g, fl.faction, f) || !fleetObserved(g, f, fl, seen)) continue;
    if (fl.at === id || lanesOf(g, id).some((l) => l.to === fl.at && laneKm(g, id, l.to) <= MARCH.reinforce)) d += fleetStrength(fl);
  }
  return d;
}

function nearestEnemyDistance(g: Grand, f: GrandFaction, from: RegionId): number {
  let best = Infinity;
  for (const e of enemiesOf(g, f)) for (const id of ownedBy(g, e)) best = Math.min(best, laneDistance(from, id, g));
  return best;
}

function fleetsPlan(g: Grand, f: GrandFaction) {
  const P = personality(g, f);
  const seen = visibleRegions(g, f);
  // A navy that has not fought for a while grows bolder: the standoff has to end.
  const patience = Math.max(P.minPatience, 1 - P.impatience * g.factions[f].idle);
  // Small groups decide first, so they flow into the larger body and the larger one, seeing them coming, stays; two groups never swap ports.
  const strength = (fleets: Fleet[]) => fleets.reduce((a, fl) => a + fleetStrength(fl), 0);
  const groups = [...idleGroups(g, f)].sort((a, b) => strength(a[1]) - strength(b[1]));
  // The first turn is a lull: the player gets one turn to see the board before any computer navy attacks.
  const targets = g.turn <= TUNING.openingPeace ? [] : enemiesOf(g, f).flatMap((e) => ownedBy(g, e));
  const march = marching(g);
  // Our ports under blockade call for relief: the blockaders lie in them, so sailing in brings on the fight.
  const besieged = march ? ownedBy(g, f).filter((id) => g.regions[id].siege) : [];
  if (march) for (const fl of g.fleets) {
    // A fleet left at sea without orders (it won a fight out there) makes for the nearest friendly port.
    if (fl.faction !== f || !fl.transit || fl.route.length || fl.rest > 0) continue;
    const ports = [...marchDistances(g, fl).dist].filter(([id]) => g.regions[id].owner !== null && allied(g, f, g.regions[id].owner!)).sort((a, b) => a[1] - b[1]);
    if (ports[0]) orderMove(g, fl.id, ports[0][0]);
  }
  for (const [at, fleets] of groups) {
    const here = g.regions[at];
    const power = fleets.reduce((a, fl) => a + fleetStrength(fl), 0);
    const myPort = here.owner !== null && allied(g, f, here.owner);
    if (march && !myPort && fleets.some((fl) => fl.besieging)) {
      holdBlockade(g, f, at, fleets, power, patience, seen);
      continue;
    }
    // Put the fleet right before it fights, if the port can do it.
    if (myPort && avgHull(fleets) < 0.85) for (const fl of fleets) if (g.factions[f].gold - refitCost(fl) > P.reserve + 120) orderRefit(g, fl.id);
    // Friends in the same port fight beside us, though they may choose otherwise.
    const friends = g.fleets.filter((o) => o.at === at && o.faction !== f && allied(g, f, o.faction)).reduce((a, o) => a + fleetStrength(o), 0);
    const joint = power + friends * 0.6;
    const threat = myPort ? threatTo(g, f, at) : 0;
    const sources = new Set<RegionId>();
    for (const o of g.fleets) if (o.at && atWar(g, o.faction, f) && fleetObserved(g, f, o, seen) && lanesOf(g, at).some((l) => l.to === o.at)) sources.add(o.at);
    const portDefence = myPort ? listStrength(here.garrison) + batteryStrength(here) : 0;
    const holdBack = Math.max(0, threat * P.guard * 1.1 - portDefence);
    // Pick the best target the fleet can reach in three turns.
    let pick: { id: RegionId; u: number; siege: boolean } | null = null;
    for (const t of targets) {
      const turns = turnsTo(g, fleets, t);
      if (turns === null || turns > 3) continue;
      // Striking the enemy stack that threatens the port removes the danger; any other move leaves the port exposed.
      const force = myPort && !sources.has(t) ? Math.max(0, joint - holdBack) : joint;
      const ratio = force / Math.max(1, estimatedDefence(g, f, t, seen));
      const bar = P.attackRatio * patience * (1 + 0.08 * (turns - 1));
      if (ratio >= bar) {
        const u = prize(g, f, t, seen) - 0.35 * turns + Math.min(ratio, 3) * 0.2 + range(g.rng, 0, 0.1);
        if (!pick || u > pick.u) pick = { id: t, u, siege: false };
        continue;
      }
      // Too strong to storm, but no fleet near enough to lift a blockade and a garrison too weak to drive it off: starve
      // it out instead. Slower, so worth less.
      const afloat = fleetDefence(g, f, t, seen);
      if (!march || turns > 2 || force < Math.max(1, afloat) * bar * 1.15 || force < Math.max(0, estimatedDefence(g, f, t, seen) - afloat) * MARCH.sally * 1.2) continue;
      if (g.fleets.some((o) => o.at === t && atWar(g, o.faction, f) && fleetObserved(g, f, o, seen))) continue;
      const u = prize(g, f, t, seen) - 0.35 * turns - 0.6 + range(g.rng, 0, 0.1);
      if (!pick || u > pick.u) pick = { id: t, u, siege: true };
    }
    // Our own ports under blockade come first when the fleet can beat the blockaders.
    for (const t of besieged) {
      const turns = turnsTo(g, fleets, t);
      if (turns === null || turns > 2) continue;
      const blockaders = g.fleets.filter((o) => o.at === t && atWar(g, o.faction, f)).reduce((a, o) => a + fleetStrength(o), 0);
      const ratio = joint / Math.max(1, blockaders);
      if (ratio < P.attackRatio * patience * 0.9) continue;
      const u = prize(g, f, t, seen) + 1 - 0.35 * turns + range(g.rng, 0, 0.1);
      if (!pick || u > pick.u) pick = { id: t, u, siege: false };
    }
    const resting = myPort && avgHull(fleets) < P.restBelow && threat < power * 0.5;
    if (pick && !resting) {
      for (const fl of fleets) orderMove(g, fl.id, pick.id, pick.siege);
      continue;
    }
    if (resting || threat > 0) continue;
    // No fight to be had: gather at the port nearest the enemy, where the fleet is useful.
    const front = stagingPort(g, f, at, fleets);
    // A group already ordered from that port to this one has the same idea: one of the two stays, so they do not swap.
    const swapping = front !== null && g.fleets.some((o) => o.faction === f && o.at === front && o.route[o.route.length - 1] === at);
    if (front && front !== at && !swapping) for (const fl of fleets) {
      orderMove(g, fl.id, front);
      // Under the march rules a long way through our own water is made on a forced march.
      if (march && (turnsTo(g, [fl], front) ?? 0) > 1) orderStance(g, fl.id, 'march');
    }
  }
}

/**
 * A blockade the navy keeps up off an enemy port: storm it once the fleet is strong enough, give it up when a stronger
 * enemy can come to its relief this turn, otherwise sit tight and let the garrison starve.
 */
function holdBlockade(g: Grand, f: GrandFaction, at: RegionId, fleets: Fleet[], power: number, patience: number, seen: Set<RegionId>) {
  const P = personality(g, f);
  const ratio = power / Math.max(1, estimatedDefence(g, f, at, seen));
  if (ratio >= P.attackRatio * patience) {
    for (const fl of fleets) if (fl.besieging) orderAssault(g, fl.id);
    return;
  }
  if (threatTo(g, f, at) <= power * 1.1) return;
  const home = [...marchDistances(g, fleets[0]!).dist].filter(([id]) => id !== at && passable(g, f, id) && g.regions[id].owner !== null).sort((a, b) => a[1] - b[1])[0];
  if (home) for (const fl of fleets) orderMove(g, fl.id, home[0]);
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
