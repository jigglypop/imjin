import { listStrength, batteryStrength } from './economy';
import { LANES, REGION_ORDER, REGIONS, type Lane } from './regions';
import type { Fleet, Grand, GrandFaction, LogEntry, MsgParams, RegionId, ShipUnit } from './types';
import { pairKey } from './types';

/** Read-only questions about a campaign, shared by the orders, the turn and the computer players. */

export const allied = (g: Grand, a: GrandFaction, b: GrandFaction) => a === b || g.relations[pairKey(a, b)] === 'allied';
export const atWar = (g: Grand, a: GrandFaction, b: GrandFaction) => a !== b && g.relations[pairKey(a, b)] === 'war';

export const fleetById = (g: Grand, id: string) => g.fleets.find((f) => f.id === id);
export const ownedBy = (g: Grand, f: GrandFaction): RegionId[] => REGION_ORDER.filter((id) => g.regions[id].owner === f);
export const shipCount = (g: Grand, f: GrandFaction) => g.fleets.reduce((a, fl) => a + (fl.faction === f ? fl.ships.length : 0), 0);
export const fleetStrength = (f: Fleet) => listStrength(f.ships);

/** Optional open-ocean expeditions let Japan and Ming fight without first conquering Joseon's coast. */
const EXPEDITION_LANES: Partial<Record<RegionId, readonly Lane[]>> = {
  shandong: [...LANES.shandong, { to: 'nagoya', turns: 3 }],
  nagoya: [...LANES.nagoya, { to: 'shandong', turns: 3 }],
  liaodong: [...LANES.liaodong, { to: 'tsushima', turns: 3 }],
  tsushima: [...LANES.tsushima, { to: 'liaodong', turns: 3 }],
};
export function lanesOf(g: Grand | undefined, id: RegionId): readonly Lane[] {
  return g?.strategicLinks === 'three-way-v1' ? EXPEDITION_LANES[id] ?? LANES[id] : LANES[id];
}

export function mintId(g: Grand, prefix: string): string {
  g.nextId += 1;
  return `${prefix}${g.nextId}`;
}

/**
 * Adds a line to the war's log. `text` is a Korean template with `{name}` and `{name|이/가}` placeholders and `params`
 * fills them in the interface, so names are stored in the log as the data they are, not as finished sentences.
 */
export function note(g: Grand, text: string, params?: MsgParams, tone: LogEntry['tone'] = 'info', tag?: LogEntry['tag']) {
  const entry: LogEntry = { turn: g.turn, text, tone };
  if (params) entry.params = params;
  if (tag) entry.tag = tag;
  g.log.push(entry);
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
    for (const lane of lanesOf(g, here)) {
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
export function laneDistance(from: RegionId, to: RegionId, g?: Grand): number {
  const dist = new Map<RegionId, number>([[from, 0]]);
  const open: RegionId[] = [from];
  while (open.length) {
    open.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const here = open.shift()!;
    for (const lane of lanesOf(g, here)) {
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

/** Ports report their own waters. A sailing scout observes two sea lanes; a main fleet observes one. */
export function visibleRegions(g: Grand, f: GrandFaction): Set<RegionId> {
  const seen = new Set<RegionId>();
  const reach = (from: RegionId, depth: number) => {
    let edge = [from];
    const visited = new Set<RegionId>(edge);
    seen.add(from);
    for (let i = 0; i < depth; i++) {
      const next: RegionId[] = [];
      for (const at of edge) for (const lane of lanesOf(g, at)) if (!visited.has(lane.to)) { visited.add(lane.to); seen.add(lane.to); next.push(lane.to); }
      edge = next;
    }
  };
  for (const id of REGION_ORDER) {
    const r = g.regions[id];
    const mine = r.owner !== null && allied(g, f, r.owner);
    if (!mine) continue;
    const beacon = r.buildings.find((b) => b.kind === 'beacon' && b.level > 0);
    reach(id, beacon ? Math.min(3, 1 + beacon.level) : 0);
  }
  for (const fleet of g.fleets) if (allied(g, f, fleet.faction)) {
    const scout = fleet.ships.some((s) => s.hull > 0 && s.crew > 0 && ['hyeopseon', 'kobaya', 'mingsmall'].includes(s.kind));
    if (fleet.at) reach(fleet.at, scout ? 2 : 1);
    else if (fleet.transit) { reach(fleet.transit.from, scout ? 1 : 0); reach(fleet.transit.to, scout ? 1 : 0); }
  }
  return seen;
}

/** The UI and computer commanders share the same fleet observation, including incoming sea lanes. */
export function fleetObserved(g: Grand, f: GrandFaction, fl: Fleet, seen = visibleRegions(g, f)): boolean {
  return allied(g, f, fl.faction) || (fl.at ? seen.has(fl.at) : fl.transit ? seen.has(fl.transit.from) || seen.has(fl.transit.to) : false);
}
