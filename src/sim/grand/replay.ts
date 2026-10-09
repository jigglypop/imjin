import { LANES } from './regions';
import type { Contact, Fleet, Grand, GrandFaction, RegionId } from './types';
import { allied, visibleRegions } from './world';

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

export type ReplayClash = { regionId: RegionId; attacker: GrandFaction; defender: GrandFaction; waiting: boolean };

export type ReplayChange = { regionId: RegionId; from: GrandFaction | null; to: GrandFaction };

export type TurnReplay = { turn: number; moves: ReplayMove[]; clashes: ReplayClash[]; changes: ReplayChange[] };

export const isEmpty = (r: TurnReplay) => !r.moves.length && !r.clashes.length && !r.changes.length;

const spotOf = (fl: Fleet): Spot => {
  if (fl.at) return { at: fl.at };
  const t = fl.transit!;
  const turns = LANES[t.from].find((l) => l.to === t.to)?.turns ?? 1;
  return { at: t.from, to: t.to, t: Math.min(1, Math.max(0, (turns - t.left) / turns)) };
};

const same = (a: Spot, b: Spot) => a.at === b.at && a.to === b.to && (a.t ?? 0) === (b.t ?? 0);

export function buildReplay(before: Grand, after: Grand, contacts: Contact[], viewer: GrandFaction): TurnReplay {
  const seenBefore = visibleRegions(before, viewer);
  const seenAfter = visibleRegions(after, viewer);
  const visible = (id: RegionId) => seenBefore.has(id) || seenAfter.has(id);
  const involved = (f: GrandFaction) => allied(before, viewer, f);
  const afterFleets = new Map(after.fleets.map((f) => [f.id, f]));

  const clashes: ReplayClash[] = contacts
    .filter((c) => c.player || involved(c.attacker) || involved(c.defender) || visible(c.regionId))
    .map((c) => ({ regionId: c.regionId, attacker: c.attacker, defender: c.defender, waiting: after.pending.some((p) => p.id === c.id) }));
  const clashAt = new Map<string, RegionId>();
  for (const c of contacts) for (const id of c.attackerFleets) clashAt.set(id, c.regionId);

  const moves: ReplayMove[] = [];
  for (const fl of before.fleets) {
    const end = afterFleets.get(fl.id);
    const path: Spot[] = [spotOf(fl)];
    const hit = clashAt.get(fl.id);
    if (hit) path.push({ at: hit });
    if (end) path.push(spotOf(end));
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
