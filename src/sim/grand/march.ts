import { shipSpec } from '../competitive';
import { dateOf } from './economy';
import { fleetBonus } from './officerEffects';
import { REGION_ORDER, REGIONS } from './regions';
import type { Fleet, Grand, RegionId, Transit } from './types';
import { atWar, lanesOf, passable } from './world';

/**
 * The march rules (`Grand.march`), the campaign's Total War-like movement. A fleet sails a distance each turn instead
 * of one lane: it may pass several friendly ports, or stop out at sea and go on next turn. Hostile fleets meet where
 * their ways cross; a port holding a hostile fleet stops whoever sails in. Nothing here draws on the campaign's dice,
 * so a turn's movement follows from the orders alone.
 */
export const MARCH = {
  /** Km a fleet of middling pace sails in a turn: two short coastal stages, or a long one sailed over two turns. */
  base: 50,
  /** Sea routes bend round headlands and islands: a lane is this much longer than the straight line. */
  detour: 1.1,
  /**
   * A lane to an off-map seat is placed for the map, not by its distance: each of its turns under the lane rules is this
   * share of a turn's sailing, so the crossing from China or Kyushu keeps its length in turns whatever `base` is.
   */
  offMap: 0.8,
  /** Top speed (battle maxSpeed) of a middling ship, how strongly a fleet's pace follows its speed, and the bounds of that pace. */
  pace: 5.5,
  paceCurve: 1,
  paceMin: 0.8,
  paceMax: 1.4,
  /** Share of distance added per commander level above the first. */
  commander: 0.04,
  /** The forced march: this many times the distance, but no fight may be started and a fleet caught is tired. */
  forced: 1.5,
  /** Fighting worth of a force caught on a forced march. */
  tired: 0.85,
  /** Winter (the turn that opens in January) is hard sailing: this share of the distance, and this much supply lost at sea. */
  winter: 0.8,
  winterSupply: 0.05,
  /** Km apart at which two hostile fleets on one lane close and fight. */
  meet: 4,
  /** Steps a turn's sailing is cut into, so fleets meet about where their ways cross. */
  steps: 24,
  /** Km of lane within which an idle fleet at a neighbouring port joins a fight, on either side. */
  reinforce: 25,
  /** Neighbours join a fight only if with them their side has at least this share of the other side's strength. */
  join: 0.8,
  /** A blockaded port holds out this many turns, one more per granary level and one more behind a level 2 camp. */
  holdBase: 2,
  /** A blockade holds only with this share of the port's garrison and guns in strength; a weaker one is fought off. */
  sally: 0.75,
  /** What a blockade costs each turn: the garrison's crew and supply, and the blockaders' hulls per battery level. */
  starve: { crew: 0.12, supply: 0.25 },
  shoreFire: 0.03,
};

export const marching = (g: Grand | undefined) => g?.march === 'tw-v1';

const RAD = Math.PI / 180;
function greatCircleKm(a: RegionId, b: RegionId) {
  const p = REGIONS[a], q = REGIONS[b];
  const dLat = (q.lat - p.lat) * RAD, dLon = (q.lon - p.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * RAD) * Math.cos(q.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The lane's length in km. Lanes to the seats off the map keep the lane rules' length in turns. */
export function laneKm(g: Grand | undefined, a: RegionId, b: RegionId): number {
  if (REGIONS[a].edge || REGIONS[b].edge) return Math.round((lanesOf(g, a).find((l) => l.to === b)?.turns ?? 1) * MARCH.offMap * MARCH.base);
  return Math.max(4, Math.round(greatCircleKm(a, b) * MARCH.detour));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A fleet sails at the pace of its slowest hull. */
export function fleetPace(fl: Fleet): number {
  if (!fl.ships.length) return 1;
  let slowest = Infinity;
  for (const u of fl.ships) slowest = Math.min(slowest, shipSpec(u.kind).maxSpeed);
  return clamp((slowest / MARCH.pace) ** MARCH.paceCurve, MARCH.paceMin, MARCH.paceMax);
}

/** A turn is a season: the one that opens in January is winter, with rough seas and short days. */
export const winterTurn = (turn: number) => dateOf(turn).month === 1;

/** Km the fleet can sail this turn: its pace, its commander's seamanship, its stance and the season. */
export function fleetReach(g: Grand, fl: Fleet): number {
  const cmd = fl.commanderId ? g.factions[fl.faction].commanders.find((c) => c.id === fl.commanderId && c.alive) : undefined;
  const level = cmd?.level ?? 1;
  return MARCH.base * fleetPace(fl) * (1 + MARCH.commander * (level - 1) + fleetBonus(g, fl).reach) * (fl.stance === 'march' ? MARCH.forced : 1) * (winterTurn(g.turn) ? MARCH.winter : 1);
}

/** Share of its lane a fleet at sea has sailed, from `from` toward `to`, under either rules. */
export function transitShare(g: Grand | undefined, t: Transit): number {
  if (t.sailed !== undefined) return clamp(t.sailed / laneKm(g, t.from, t.to), 0, 1);
  const turns = lanesOf(g, t.from).find((l) => l.to === t.to)?.turns ?? 1;
  return clamp((turns - t.left) / turns, 0, 1);
}

/** Where the fleet lies: its port, or the two ends of its lane with the km to each. */
function startsOf(g: Grand, fl: Fleet): [RegionId, number][] {
  if (fl.at) return [[fl.at, 0]];
  const t = fl.transit;
  if (!t) return [];
  const sailed = t.sailed ?? transitShare(g, t) * laneKm(g, t.from, t.to);
  return [[t.to, laneKm(g, t.from, t.to) - sailed], [t.from, sailed]];
}

/**
 * Km to every port the fleet can reach by friendly or open water, from where it lies (a fleet at sea may go on or turn
 * back). A hostile port can be reached but not sailed through. Stops looking past `limit` km.
 */
export function marchDistances(g: Grand, fl: Fleet, limit = Infinity): { dist: Map<RegionId, number>; prev: Map<RegionId, RegionId | null> } {
  const dist = new Map<RegionId, number>();
  const prev = new Map<RegionId, RegionId | null>();
  const open: RegionId[] = [];
  for (const [id, d] of startsOf(g, fl)) {
    if (d < (dist.get(id) ?? Infinity)) {
      dist.set(id, d);
      prev.set(id, null);
      if (!open.includes(id)) open.push(id);
    }
  }
  while (open.length) {
    open.sort((a, b) => dist.get(a)! - dist.get(b)! || REGION_ORDER.indexOf(a) - REGION_ORDER.indexOf(b));
    const here = open.shift()!;
    // A hostile port ends the way: it is fought for, not sailed through. The port the fleet lies in may be left.
    if (here !== fl.at && !passable(g, fl.faction, here)) continue;
    for (const lane of lanesOf(g, here)) {
      const d = dist.get(here)! + laneKm(g, here, lane.to);
      if (d > limit || d >= (dist.get(lane.to) ?? Infinity)) continue;
      dist.set(lane.to, d);
      prev.set(lane.to, here);
      if (!open.includes(lane.to)) open.push(lane.to);
    }
  }
  return { dist, prev };
}

export type MarchRoute = { path: RegionId[]; km: number; turns: number };

/** Turns a distance takes the fleet, from the start of a turn. */
export const turnsFor = (g: Grand, fl: Fleet, km: number) => (km <= 0 ? 0 : Math.max(1, Math.ceil(km / fleetReach(g, fl) - 1e-9)));

/**
 * The shortest way to `dest` in km and the ports to call at, the first being where the fleet makes for first (for a fleet
 * at sea, the lane end ahead of it or the one behind). Only `dest` may be hostile. Null when there is no way.
 */
export function marchRoute(g: Grand, fl: Fleet, dest: RegionId): MarchRoute | null {
  if (fl.at === dest) return { path: [], km: 0, turns: 0 };
  const { dist, prev } = marchDistances(g, fl);
  const km = dist.get(dest);
  if (km === undefined) return null;
  const path: RegionId[] = [];
  for (let at: RegionId | null | undefined = dest; at; at = prev.get(at)) path.unshift(at);
  if (fl.at) path.shift();
  return { path, km, turns: turnsFor(g, fl, km) };
}

/** A place on the map at the end of a turn: a port, or `t` of the way along the lane from `from` to `to`. */
export type MarchSpot = { at: RegionId } | { from: RegionId; to: RegionId; t: number };

/**
 * Where the fleet will lie at the end of each turn sailing `path` (orders given at the start of this turn), the last spot
 * being the destination. For the map's movement line: one mark per turn, like a general's march on a campaign map.
 */
export function marchStops(g: Grand, fl: Fleet, path: readonly RegionId[]): MarchSpot[] {
  const reach = fleetReach(g, fl);
  const stops: MarchSpot[] = [];
  if (!path.length) return stops;
  let at: RegionId | null = fl.at;
  let lane: { from: RegionId; to: RegionId; sailed: number; km: number } | null = null;
  if (!at) {
    const t = fl.transit;
    if (!t) return stops;
    const km = laneKm(g, t.from, t.to);
    const sailed = t.sailed ?? transitShare(g, t) * km;
    // A fleet whose way begins with the port behind it turns about.
    if (path[0] === t.to) lane = { from: t.from, to: t.to, sailed, km };
    else if (path[0] === t.from) lane = { from: t.to, to: t.from, sailed: km - sailed, km };
    else return stops;
  }
  // `i` is the port of `path` being sailed for.
  let i = 0;
  let budget = reach;
  for (let guard = 0; guard < 500; guard += 1) {
    if (!lane) {
      // Out of distance just as it made port: the fleet spends the turn's end there.
      if (budget <= 1e-6) {
        stops.push({ at: at! });
        budget = reach;
      }
      lane = { from: at!, to: path[i]!, sailed: 0, km: laneKm(g, at!, path[i]!) };
    }
    const go = Math.min(budget, lane.km - lane.sailed);
    lane.sailed += go;
    budget -= go;
    if (lane.sailed >= lane.km - 1e-6) {
      at = lane.to;
      lane = null;
      i += 1;
      if (i >= path.length) {
        stops.push({ at });
        return stops;
      }
    } else {
      stops.push({ from: lane.from, to: lane.to, t: lane.sailed / lane.km });
      budget = reach;
    }
  }
  return stops;
}

/** Two hostile fleets that closed on one lane during the sailing: where (`t` of the way from `from` to `to`) and who. */
export type SeaMeeting = { from: RegionId; to: RegionId; t: number; fleets: string[]; movers: string[] };

type Walker = { fl: Fleet; budget: number; step: number; stopped: boolean; moved: boolean };

/** A fleet's place along the lane between `a` and `b` (a < b), in km from `a`; null when it is not on that lane. */
function laneSpot(g: Grand, fl: Fleet, a: RegionId, b: RegionId): number | null {
  const t = fl.transit;
  if (!t) return null;
  const sailed = t.sailed ?? transitShare(g, t) * laneKm(g, t.from, t.to);
  if (t.from === a && t.to === b) return sailed;
  if (t.from === b && t.to === a) return laneKm(g, a, b) - sailed;
  return null;
}

const laneKey = (t: Transit) => (t.from < t.to ? `${t.from}|${t.to}` : `${t.to}|${t.from}`);

/**
 * Sails every fleet with a route, all at once in small steps. A fleet stops where its route ends, where it runs out
 * of distance (in port or at sea), at a hostile port, at a port holding a hostile fleet (the fleets passing through such
 * a port are caught there too), and where it closes with a hostile fleet on its lane: those meetings are returned.
 */
export function marchFleets(g: Grand): SeaMeeting[] {
  const walkers: Walker[] = [];
  for (const fl of g.fleets) {
    if (fl.rest > 0 || !fl.route.length || (!fl.at && !fl.transit)) continue;
    const t = fl.transit;
    // A fleet at sea can only make for one end of its lane; any other order is void and it stays where it is.
    if (t && fl.route[0] !== t.to && fl.route[0] !== t.from) {
      fl.route = [];
      continue;
    }
    // A fleet at sea whose way begins with the port behind it turns about.
    if (t && fl.route[0] === t.from) {
      const km = laneKm(g, t.from, t.to);
      fl.transit = { from: t.to, to: t.from, left: t.left, sailed: km - (t.sailed ?? transitShare(g, t) * km) };
    }
    const reach = fleetReach(g, fl);
    walkers.push({ fl, budget: reach, step: reach / MARCH.steps, stopped: false, moved: false });
  }
  const walking = new Map(walkers.map((w) => [w.fl.id, w]));
  const meetings: SeaMeeting[] = [];
  /** The fleets that sailed out of each port during the step under way: one sailing in now has met them at the quay. */
  let departed = new Map<RegionId, Fleet[]>();
  const halt = (fl: Fleet) => {
    const w = walking.get(fl.id);
    if (w) w.stopped = true;
    fl.route = [];
  };

  const advance = (w: Walker, distance: number) => {
    let left = distance;
    const fl = w.fl;
    while (left > 1e-6 && !w.stopped) {
      if (fl.at) {
        const next = fl.route[0];
        if (!next || !lanesOf(g, fl.at).some((l) => l.to === next)) {
          halt(fl);
          return;
        }
        // A port that fell to the enemy on the way ends the voyage short of it; a forced march never sails into one.
        if (!passable(g, fl.faction, next) && (fl.route.length > 1 || fl.stance === 'march')) {
          halt(fl);
          return;
        }
        departed.set(fl.at, [...(departed.get(fl.at) ?? []), fl]);
        fl.transit = { from: fl.at, to: next, left: 0, sailed: 0 };
        fl.at = null;
      }
      const t = fl.transit!;
      const km = laneKm(g, t.from, t.to);
      const go = Math.min(left, km - t.sailed!);
      t.sailed! += go;
      left -= go;
      w.budget -= go;
      w.moved = true;
      if (t.sailed! < km - 1e-6) continue;
      fl.at = t.to;
      fl.transit = null;
      fl.route.shift();
      if (!fl.route.length) w.stopped = true;
      // A hostile port is fought for where the fleet now lies.
      if (!passable(g, fl.faction, fl.at)) halt(fl);
      // A port holding a hostile fleet stops whoever sails in, and holds whoever of them was passing through. A hostile
      // fleet that sailed out of it in this same step is caught at the quay too, whichever of the two moved first.
      const port = fl.at;
      const leaving = (departed.get(port) ?? []).filter((o) => o.transit?.from === port && atWar(g, o.faction, fl.faction));
      for (const o of leaving) {
        o.at = port;
        o.transit = null;
      }
      const foes = g.fleets.filter((o) => o !== fl && o.at === port && atWar(g, o.faction, fl.faction));
      if (foes.length) {
        halt(fl);
        for (const o of foes) if (walking.get(o.id) && !walking.get(o.id)!.stopped) halt(o);
      }
    }
  };

  /** Puts a fleet at `at` km from `a` on the lane a–b and stops it there. */
  const holdAt = (o: Fleet, a: RegionId, at: number, km: number) => {
    const t = o.transit!;
    t.sailed = t.from === a ? at : km - at;
    halt(o);
  };
  const meetingOf = (id: string) => meetings.find((m) => m.fleets.includes(id));
  for (let s = 0; s < MARCH.steps; s += 1) {
    departed = new Map();
    // Where everyone on a lane was before the step, to see who passed whom.
    const before = new Map<string, { key: string; spot: number }>();
    for (const fl of g.fleets) if (fl.transit) {
      const [a, b] = fl.transit.from < fl.transit.to ? [fl.transit.from, fl.transit.to] : [fl.transit.to, fl.transit.from];
      before.set(fl.id, { key: laneKey(fl.transit), spot: laneSpot(g, fl, a, b)! });
    }
    for (const w of walkers) if (!w.stopped && w.budget > 1e-6) advance(w, Math.min(w.step, w.budget));
    // Meetings on the lanes: two hostile fleets that came within reach of each other or passed each other this step.
    const byLane = new Map<string, Fleet[]>();
    for (const fl of g.fleets) if (fl.transit) byLane.set(laneKey(fl.transit), [...(byLane.get(laneKey(fl.transit)) ?? []), fl]);
    for (const [key, list] of byLane) {
      if (list.length < 2) continue;
      const [a, b] = key.split('|') as [RegionId, RegionId];
      const km = laneKm(g, a, b);
      // A fleet that came onto this lane during the step was at the port it left when the step began.
      const was = (fl: Fleet) => {
        const prior = before.get(fl.id);
        return prior && prior.key === key ? prior.spot : fl.transit!.from === a ? 0 : km;
      };
      for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
        const p = list[i]!, q = list[j]!;
        if (!atWar(g, p.faction, q.faction)) continue;
        const wp = walking.get(p.id), wq = walking.get(q.id);
        if (!(wp?.moved || wq?.moved)) continue;
        const sp = laneSpot(g, p, a, b)!, sq = laneSpot(g, q, a, b)!;
        const bp = was(p), bq = was(q);
        const crossed = bp !== bq && Math.sign(bp - bq) !== Math.sign(sp - sq);
        if (Math.abs(sp - sq) > MARCH.meet && !crossed) continue;
        // They close where the one that lay still waits, or halfway when both were under way.
        const still = wp && !wp.stopped ? (wq && !wq.stopped ? null : q) : p;
        const at = clamp(still ? laneSpot(g, still, a, b)! : (sp + sq) / 2, 0.5, km - 0.5);
        const party = list.filter((o) => o === p || o === q || Math.abs(laneSpot(g, o, a, b)! - at) <= MARCH.meet);
        // A fight already joined on this lane draws in whoever comes upon it, and two fights that touch become one, so
        // no fleet ever stands in two meetings.
        const touched = [...new Set(party.flatMap((o) => meetingOf(o.id) ?? []))];
        const into = touched[0] ?? { from: a, to: b, t: at / km, fleets: [], movers: [] };
        if (!touched.length) meetings.push(into);
        for (const other of touched.slice(1)) {
          for (const id of other.fleets) if (!into.fleets.includes(id)) into.fleets.push(id);
          for (const id of other.movers) if (!into.movers.includes(id)) into.movers.push(id);
          meetings.splice(meetings.indexOf(other), 1);
        }
        for (const o of [...party, ...g.fleets.filter((f) => into.fleets.includes(f.id))]) {
          holdAt(o, a, into.t * km, km);
          if (!into.fleets.includes(o.id)) into.fleets.push(o.id);
          if (walking.get(o.id)?.moved && !into.movers.includes(o.id)) into.movers.push(o.id);
        }
      }
    }
  }
  // What is left of a voyage, in turns at the fleet's pace, for the panels.
  for (const fl of g.fleets) {
    if (!fl.transit) continue;
    const t = fl.transit;
    t.sailed ??= transitShare(g, t) * laneKm(g, t.from, t.to);
    t.left = Math.max(1, Math.ceil((laneKm(g, t.from, t.to) - t.sailed) / fleetReach(g, fl) - 1e-9));
  }
  return meetings;
}
