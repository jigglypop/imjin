import { listStrength, batteryStrength } from './economy';
import { LANES, REGION_ORDER, REGIONS } from './regions';
import type { Fleet, Grand, GrandFaction, LogEntry, RegionId, ShipUnit } from './types';
import { pairKey } from './types';

/** Read-only questions about a campaign, shared by the orders, the turn and the computer players. */

export const allied = (g: Grand, a: GrandFaction, b: GrandFaction) => a === b || g.relations[pairKey(a, b)] === 'allied';
export const atWar = (g: Grand, a: GrandFaction, b: GrandFaction) => a !== b && g.relations[pairKey(a, b)] === 'war';

export const fleetById = (g: Grand, id: string) => g.fleets.find((f) => f.id === id);
export const ownedBy = (g: Grand, f: GrandFaction): RegionId[] => REGION_ORDER.filter((id) => g.regions[id].owner === f);
export const shipCount = (g: Grand, f: GrandFaction) => g.fleets.reduce((a, fl) => a + (fl.faction === f ? fl.ships.length : 0), 0);
export const fleetStrength = (f: Fleet) => listStrength(f.ships);

export function mintId(g: Grand, prefix: string): string {
  g.nextId += 1;
  return `${prefix}${g.nextId}`;
}

export function note(g: Grand, text: string, tone: LogEntry['tone'] = 'info', tag?: LogEntry['tag']) {
  g.log.push(tag ? { turn: g.turn, text, tone, tag } : { turn: g.turn, text, tone });
  if (g.log.length > 160) g.log.splice(0, g.log.length - 160);
}

export const regionName = (id: RegionId) => REGIONS[id].name;

/** A faction can sail through a region that is its own, an ally's or nobody's. Hostile ports have to be fought for. */
export const passable = (g: Grand, f: GrandFaction, id: RegionId) => {
  const owner = g.regions[id].owner;
  return owner === null || allied(g, f, owner);
};

/**
 * Cheapest route in turns from one region to another. Only the last region may be hostile. Returns the regions to
 * visit after `from`, or null when there is none.
 */
export function findRoute(g: Grand, f: GrandFaction, from: RegionId, to: RegionId): { path: RegionId[]; turns: number } | null {
  if (from === to) return { path: [], turns: 0 };
  const dist = new Map<RegionId, number>([[from, 0]]);
  const prev = new Map<RegionId, RegionId>();
  const open: RegionId[] = [from];
  while (open.length) {
    open.sort((a, b) => dist.get(a)! - dist.get(b)! || REGION_ORDER.indexOf(a) - REGION_ORDER.indexOf(b));
    const here = open.shift()!;
    if (here === to) break;
    // A hostile port ends the sail: do not expand through it.
    if (here !== from && !passable(g, f, here)) continue;
    for (const lane of LANES[here]) {
      const d = dist.get(here)! + lane.turns;
      if (d < (dist.get(lane.to) ?? Infinity)) {
        dist.set(lane.to, d);
        prev.set(lane.to, here);
        if (!open.includes(lane.to)) open.push(lane.to);
      }
    }
  }
  if (!dist.has(to)) return null;
  const path: RegionId[] = [];
  for (let at: RegionId | undefined = to; at && at !== from; at = prev.get(at)) path.unshift(at);
  return { path, turns: dist.get(to)! };
}

/** Turns from `from` to `to` over the bare lanes, ignoring who owns what. For threat estimates. */
export function laneDistance(from: RegionId, to: RegionId): number {
  const dist = new Map<RegionId, number>([[from, 0]]);
  const open: RegionId[] = [from];
  while (open.length) {
    open.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const here = open.shift()!;
    for (const lane of LANES[here]) {
      const d = dist.get(here)! + lane.turns;
      if (d < (dist.get(lane.to) ?? Infinity)) {
        dist.set(lane.to, d);
        open.push(lane.to);
      }
    }
  }
  return dist.get(to) ?? Infinity;
}

/** Everything that would defend a region right now: its garrison and the fleets of its owner and the owner's allies. */
export function defenders(g: Grand, id: RegionId): { ships: ShipUnit[]; fleets: Fleet[]; shore: number } {
  const r = g.regions[id];
  const fleets = r.owner ? g.fleets.filter((f) => f.at === id && allied(g, f.faction, r.owner!)) : [];
  const ships = [...r.garrison, ...fleets.flatMap((f) => f.ships)];
  return { ships, fleets, shore: batteryStrength(r) };
}

export const defenceStrength = (g: Grand, id: RegionId) => {
  const d = defenders(g, id);
  return listStrength(d.ships) + d.shore;
};

/** Regions whose fleets this faction can see: its own and its allies' ports, and everything within two lanes of a beacon. */
export function visibleRegions(g: Grand, f: GrandFaction): Set<RegionId> {
  const seen = new Set<RegionId>();
  for (const id of REGION_ORDER) {
    const r = g.regions[id];
    const mine = r.owner !== null && allied(g, f, r.owner);
    const hasFleet = g.fleets.some((fl) => fl.at === id && allied(g, f, fl.faction));
    if (!mine && !hasFleet) continue;
    seen.add(id);
    for (const lane of LANES[id]) {
      seen.add(lane.to);
      if (mine && r.buildings.some((b) => b.kind === 'beacon' && b.level > 0)) for (const l2 of LANES[lane.to]) seen.add(l2.to);
    }
  }
  return seen;
}
