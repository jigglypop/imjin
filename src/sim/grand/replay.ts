import type { Contact, Fleet, Grand, GrandFaction, RegionId } from './types';
import { allied, visibleRegions } from './world';
import { transitShare } from './march';

/**
 * What the closing turn did to the map, as the viewer saw it, for the strategic map to play back: where the fleets
 * sailed, where they met, which ports changed hands. Derived from the campaign before and after the turn, so it is not
 * saved and costs the sim nothing.
 */

/** A point on the map: a region, or a fraction `t` of the way along the lane from `at` to `to`. */
export type Spot = { at: RegionId; to?: RegionId; t?: number };

export type ReplayMove = {
  fleetId: string;
  faction: GrandFaction;
  name: string;
  ships: number;
  /** The way sailed, two spots at least. */
  path: Spot[];
  /** True when the fleet is gone afterwards: it fades where it fought. */
  lost: boolean;
};

/** A fight the turn brought about: at a port, or out at sea (`sea`, the spot on the lane where the fleets met). */
export type ReplayClash = { regionId: RegionId; attacker: GrandFaction; defender: GrandFaction; waiting: boolean; sea?: Spot };

export type ReplayChange = { regionId: RegionId; from: GrandFaction | null; to: GrandFaction };

export type TurnReplay = { turn: number; moves: ReplayMove[]; clashes: ReplayClash[]; changes: ReplayChange[] };

export const isEmpty = (r: TurnReplay) => !r.moves.length && !r.clashes.length && !r.changes.length;

const spotOf = (fl: Fleet, g: Grand): Spot => {
  if (fl.at) return { at: fl.at };
  const t = fl.transit!;
  return { at: t.from, to: t.to, t: transitShare(g, t) };
};

const same = (a: Spot, b: Spot) => a.at === b.at && a.to === b.to && (a.t ?? 0) === (b.t ?? 0);

/**
 * The ports a fleet called at on its way to `target`, from the route it was given before the turn: under the march
 * rules one turn may take it past several, and the playback should follow the coast through them, not cut across the
 * land. None when the target is not on that route (a retreat, a fleet thrown back).
 */
function calls(route: readonly RegionId[], start: Spot, target: Spot): Spot[] {
  const out: Spot[] = [];
  let prev: RegionId | null = start.to === undefined ? start.at : null;
  for (const id of route) {
    if (target.to === undefined ? id === target.at : (id === target.at || id === target.to) && (prev === null || prev === target.at || prev === target.to)) return out;
    out.push({ at: id });
    prev = id;
  }
  return [];
}

/**
 * `routes` are the routes the fleets sailed on (endTurn's report: the computer gives its orders inside the turn); without
 * them the routes saved before the turn are used.
 */
export function buildReplay(before: Grand, after: Grand, contacts: Contact[], viewer: GrandFaction, routes?: Record<string, RegionId[]>): TurnReplay {
  const seenBefore = visibleRegions(before, viewer);
  const seenAfter = visibleRegions(after, viewer);
  const visible = (id: RegionId) => seenBefore.has(id) || seenAfter.has(id);
  const involved = (f: GrandFaction) => allied(before, viewer, f);
  const afterFleets = new Map(after.fleets.map((f) => [f.id, f]));

  const clashes: ReplayClash[] = contacts
    .filter((c) => c.player || involved(c.attacker) || involved(c.defender) || visible(c.regionId))
    .map((c) => ({ regionId: c.regionId, attacker: c.attacker, defender: c.defender, waiting: after.pending.some((p) => p.id === c.id), ...(c.sea ? { sea: { at: c.sea.from, to: c.sea.to, t: c.sea.t } } : {}) }));
  const clashAt = new Map<string, Spot>();
  // The fleets that sailed into a fight are drawn to where it was; those that joined from a port nearby stay put.
  for (const c of contacts) {
    const joined = new Set(c.reinforcements ?? []);
    const spot: Spot = c.sea ? { at: c.sea.from, to: c.sea.to, t: c.sea.t } : { at: c.regionId };
    for (const id of [...c.attackerFleets, ...(c.sea ? c.defenderFleets : [])]) if (!joined.has(id)) clashAt.set(id, spot);
  }

  const moves: ReplayMove[] = [];
  for (const fl of before.fleets) {
    const end = afterFleets.get(fl.id);
    const start = spotOf(fl, before);
    const path: Spot[] = [start];
    const hit = clashAt.get(fl.id);
    const finish = end ? spotOf(end, after) : null;
    const target = hit ?? finish;
    if (target) path.push(...calls(routes?.[fl.id] ?? fl.route, start, target));
    if (hit) path.push(hit);
    if (finish) path.push(finish);
    const trimmed = path.filter((p, i) => i === 0 || !same(p, path[i - 1]!));
    if (trimmed.length < 2) continue;
    const reaches = trimmed.some((p) => visible(p.at) || (p.to !== undefined && visible(p.to)));
    if (!involved(fl.faction) && !reaches) continue;
    moves.push({ fleetId: fl.id, faction: fl.faction, name: fl.name, ships: fl.ships.length, path: trimmed, lost: !end });
  }

  const changes: ReplayChange[] = [];
  for (const id of Object.keys(after.regions) as RegionId[]) {
    const from = before.regions[id].owner;
    const to = after.regions[id].owner;
    if (!to || from === to) continue;
    if (involved(to) || (from && involved(from)) || visible(id)) changes.push({ regionId: id, from, to });
  }
  return { turn: before.turn, moves, clashes, changes };
}
