import type { Battle } from './battle';
import type { Conquest } from './conquest';
import type { Ship, ShipSpec, Team } from './types';

export const MAIN_SIGHT = 900;
/** The sight of the scouting boats; a campaign fleet with one aboard watches two sea regions ahead. */
export const SCOUT_SIGHT = 1600;
/** Scouting craft carry their own lookout range (ShipSpec.sight); extra sight never changes weapons or durability. */
export const sightRange = (spec: ShipSpec) => spec.sight ?? MAIN_SIGHT;
const CELL = 500;
const NIGHT_SHARE = 0.4;

type Observer = { x: number; z: number; height: number; range: number; beacon: boolean };
/**
 * Lookouts by cell, a column (the cell's x index) holding its cells by z index, and remembered map coordinates by x
 * then z. Number keys spare building a text key for every cell a lookout covers and every query.
 */
type TeamSight = { cells: Map<number, Map<number, Observer[]>>; ships: Set<number>; points: Map<number, Map<number, boolean>> };
type Sight = { tick: number; count: number; night: boolean; scale: number; land: Battle['land']; rules: Battle['rules']; teams: Record<Team, TeamSight> };
const caches = new WeakMap<Battle, Sight>();

function exposedRange(s: Ship): number {
  return s.lights ? 1900 : s.fire > 0.08 ? 1400 : s.revealed > 0 ? 900 : 0;
}

function lineOfSight(b: Battle, o: Observer, x: number, z: number, height: number, distance: number): boolean {
  // Terrain sampling keeps this pure and identical in the server and the renderer's visibility queries.
  const samples = Math.max(2, Math.ceil(distance / 80));
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    if (b.land(o.x + (x - o.x) * t, o.z + (z - o.z) * t) > o.height + (height - o.height) * t + 1) return false;
  }
  return true;
}

function observed(b: Battle, sight: TeamSight, x: number, z: number, height: number, exposure = 0): boolean {
  const cell = sight.cells.get(Math.floor(x / CELL))?.get(Math.floor(z / CELL));
  if (!cell) return false;
  for (const o of cell) {
    const range = b.night && !o.beacon ? Math.max(o.range * NIGHT_SHARE, exposure) : o.range;
    const dx = x - o.x, dz = z - o.z, squared = dx * dx + dz * dz;
    if (squared > range * range) continue;
    if (lineOfSight(b, o, x, z, height, Math.sqrt(squared))) return true;
  }
  return false;
}

function addObserver(b: Battle, sight: TeamSight, o: Observer): void {
  // Index the cells this lookout can cover, so checking every target does not scan every friendly ship.
  const reach = b.night && !o.beacon ? Math.max(o.range, 1900 * visibilityScale(b)) : o.range;
  const x1 = Math.floor((o.x + reach) / CELL);
  const z0 = Math.floor((o.z - reach) / CELL);
  const z1 = Math.floor((o.z + reach) / CELL);
  for (let cx = Math.floor((o.x - reach) / CELL); cx <= x1; cx++) {
    let column = sight.cells.get(cx);
    if (!column) sight.cells.set(cx, (column = new Map()));
    for (let cz = z0; cz <= z1; cz++) {
      const list = column.get(cz);
      if (list) list.push(o); else column.set(cz, [o]);
    }
  }
}

function sightOf(b: Battle): Sight {
  const tick = Math.floor(b.time * 4);
  const scale = visibilityScale(b);
  const previous = caches.get(b);
  if (previous && previous.tick === tick && previous.count === b.ships.length && previous.night === b.night && previous.scale === scale && previous.land === b.land && previous.rules === b.rules) return previous;
  const fresh = (): TeamSight => ({ cells: new Map(), ships: new Set(), points: new Map() });
  const sight: Sight = { tick, count: b.ships.length, night: b.night, scale, land: b.land, rules: b.rules, teams: { joseon: fresh(), japan: fresh() } };
  for (const s of b.ships) {
    sight.teams[s.team].ships.add(s.id);
    if (b.isActive(s)) addObserver(b, sight.teams[s.team], { x: s.x, z: s.z, height: s.spec.deck + 4, range: sightRange(s.spec) * scale, beacon: false });
  }
  const c = b.rules as Conquest | null;
  if (c && Array.isArray(c.points) && Array.isArray(c.players)) {
    for (const p of c.points) {
      const team = c.players[p.owner]?.team;
      if (!team) continue;
      const levels = p.buildings.reduce((n, bd) => n + (bd?.kind === 'beacon' && bd.progress >= 1 && bd.hp > 0 ? bd.level : 0), 0);
      if (levels) {
        const slot = p.slots[p.buildings.findIndex((bd) => bd?.kind === 'beacon' && bd.progress >= 1 && bd.hp > 0)];
        addObserver(b, sight.teams[team], { x: slot?.x ?? p.x, z: slot?.z ?? p.z, height: (slot?.y ?? 0) + 18, range: (1800 + (levels - 1) * 450) * scale, beacon: true });
      }
      // A shore battery has its own lookout and can defend the port when the fleet has sailed elsewhere.
      if (p.buildings.some((bd) => bd?.kind === 'battery' && bd.progress >= 1 && bd.hp > 0)) {
        const slot = p.slots[p.buildings.findIndex((bd) => bd?.kind === 'battery' && bd.progress >= 1 && bd.hp > 0)];
        addObserver(b, sight.teams[team], { x: slot?.x ?? p.x, z: slot?.z ?? p.z, height: (slot?.y ?? 0) + 6, range: MAIN_SIGHT * scale, beacon: false });
      }
    }
  }
  for (const team of ['joseon', 'japan'] as const) for (const s of b.ships) {
    if (s.team !== team && s.alive && observed(b, sight.teams[team], s.x, s.z, s.spec.deck + 3, exposedRange(s) * scale)) sight.teams[team].ships.add(s.id);
  }
  caches.set(b, sight);
  return sight;
}

function visibilityScale(b: Battle): number {
  return Number.isFinite(b.visibilityScale) ? Math.max(0.1, Math.min(1.5, b.visibilityScale)) : 1;
}

const allShips = new WeakMap<Battle, { ids: number[]; set: Set<number> }>();

/** Every ship id, reused while the ship list holds the same ids in the same order (callers get a ReadonlySet). */
function historicalShips(b: Battle): ReadonlySet<number> {
  const ships = b.ships;
  const hit = allShips.get(b);
  if (hit && hit.ids.length === ships.length) {
    let same = true;
    for (let i = 0; i < ships.length; i++) if (hit.ids[i] !== ships[i]!.id) { same = false; break; }
    if (same) return hit.set;
  }
  const ids = ships.map((s) => s.id);
  const set = new Set(ids);
  allShips.set(b, { ids, set });
  return set;
}

/** Shared team observation; historical scenarios retain their original unrestricted map. */
export function visibleShips(b: Battle, team: Team): ReadonlySet<number> {
  if (b.profile === 'historical') return historicalShips(b);
  return sightOf(b).teams[team].ships;
}

export function isShipVisible(b: Battle, team: Team, id: number): boolean {
  return b.profile === 'historical' ? !!b.get(id) : sightOf(b).teams[team].ships.has(id);
}

/** Observe a hull's final position even after it leaves the live-ship set at the end of sinking. */
export function shipPositionVisible(b: Battle, team: Team, s: Ship): boolean {
  if (b.profile === 'historical' || s.team === team) return true;
  return observed(b, sightOf(b).teams[team], s.x, s.z, s.spec.deck + 3, exposedRange(s) * visibilityScale(b));
}

/** Ground and remembered map coordinates are visible only when a live lookout can observe them. */
export function pointVisible(b: Battle, team: Team, x: number, z: number): boolean {
  if (b.profile === 'historical') return true;
  const sight = sightOf(b).teams[team];
  let row = sight.points.get(x);
  const previous = row?.get(z);
  if (previous !== undefined) return previous;
  const visible = observed(b, sight, x, z, Math.max(0, b.land(x, z)) + 3);
  if (!row) sight.points.set(x, (row = new Map()));
  row.set(z, visible);
  return visible;
}
