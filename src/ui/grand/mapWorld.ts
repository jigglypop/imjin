import { MAP_ASPECT, project } from './projection';
import { campLevel } from './campArt';
import type { FactionId, FleetView, RegionView } from './types';

// What stands on the campaign map besides the terrain: a settlement at every camp and a few ships where a fleet lies.
// Pure layout, no three.js (MapScene turns it into instances), so the shape of each camp level can be tested alone.

/** A settlement's radius in frame units: a camp covers about this much ground. */
export const SETTLEMENT_RADIUS = 0.013;

export type PieceKind = 'choga' | 'giwa' | 'fortgate' | 'bongsu' | 'battery' | 'dock' | 'magazine' | 'shipyard' | 'palisade' | 'stone';
/** One building of a settlement: offset from its centre and size, both in settlement radii; `rot` turns it about the vertical axis. */
export interface Piece { kind: PieceKind; x: number; z: number; rot: number; size: number }

const WALL_RADIUS = 0.92;
const WALL_SEGMENTS = 16;

/** Where the huts and roofs stand inside the wall, in the order they are added as the camp grows. */
const INNER: [number, number][] = [[-0.38, -0.22], [0.3, -0.38], [0.08, 0.34], [-0.42, 0.3], [0.48, 0.16], [-0.04, -0.6]];

/** The wall is a ring of segments; a gap at `gate` (radians) is left for the gate when there is one. */
function ring(kind: 'palisade' | 'stone', gate: number | null): Piece[] {
  const pieces: Piece[] = [];
  const length = ((2 * Math.PI * WALL_RADIUS) / WALL_SEGMENTS) * 1.06;
  for (let i = 0; i < WALL_SEGMENTS; i += 1) {
    const a = (i / WALL_SEGMENTS) * Math.PI * 2;
    if (gate !== null && Math.abs(Math.atan2(Math.sin(a - gate), Math.cos(a - gate))) < 0.2) continue;
    pieces.push({ kind, x: Math.cos(a) * WALL_RADIUS, z: Math.sin(a) * WALL_RADIUS, rot: -a + Math.PI / 2, size: length });
  }
  return pieces;
}

const at = (kind: PieceKind, angle: number, radius: number, size: number, face = angle): Piece => ({ kind, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, rot: -face + Math.PI / 2, size });
const inner = (kind: PieceKind, i: number, size: number, rot: number): Piece => ({ kind, x: INNER[i]![0], z: INNER[i]![1], rot, size });

/** The side of a camp that wants water: dock and battery stand here (the gate is on the opposite side). */
export const SEA_SIDE = Math.PI;

/**
 * The pieces of a camp of this level, before it is turned to face the sea. Level 1 is a palisade and a few huts, level 2
 * adds tiled roofs and a dock, level 3 swaps the palisade for a stone wall with a gate, two beacon towers and a battery,
 * level 4 a shipyard and a second battery.
 */
export function settlementPieces(level: number): Piece[] {
  if (level < 1) return [];
  if (level === 1) return [...ring('palisade', null), inner('choga', 0, 0.45, 0.3), inner('choga', 1, 0.45, -0.5), inner('choga', 2, 0.45, 1.2)];
  if (level === 2) {
    return [
      ...ring('palisade', null),
      inner('choga', 0, 0.45, 0.3), inner('choga', 1, 0.45, -0.5), inner('choga', 2, 0.45, 1.2),
      inner('giwa', 3, 0.62, 0.1), inner('giwa', 4, 0.62, -0.2),
      at('dock', SEA_SIDE, 1.35, 0.85),
    ];
  }
  const pieces: Piece[] = [
    ...ring('stone', 0),
    at('fortgate', 0, WALL_RADIUS, 0.85),
    at('bongsu', Math.PI / 2, WALL_RADIUS, 0.5), at('bongsu', -Math.PI / 2, WALL_RADIUS, 0.5),
    inner('choga', 0, 0.45, 0.3), inner('choga', 1, 0.45, -0.5),
    inner('giwa', 2, 0.62, 1.2), inner('giwa', 3, 0.62, 0.1), inner('giwa', 4, 0.62, -0.2),
    inner('magazine', 5, 0.55, 0),
    at('dock', SEA_SIDE, 1.4, 0.85),
    at('battery', SEA_SIDE + 0.62, 1.3, 0.65),
  ];
  if (level >= 4) pieces.push(at('shipyard', SEA_SIDE - 0.7, 1.45, 0.9), at('battery', SEA_SIDE - 0.2, 1.4, 0.65));
  return pieces;
}

/** Cheap string hash (FNV-1a) so each camp keeps its own turn and flag spot between renders. */
export function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Turns a camp so its dock side looks at the most open sea. `isSea` takes an offset in settlement radii; of eight
 * candidate turns the one with the most sea around the dock wins, ties go to the hash so neighbouring camps differ.
 */
export function faceSea(pieces: Piece[], seed: number, isSea: (x: number, z: number) => boolean): { pieces: Piece[]; turn: number } {
  let best = 0, bestScore = -1;
  for (let k = 0; k < 8; k += 1) {
    const turn = (((k + seed) % 8) / 8) * Math.PI * 2;
    let score = 0;
    for (const probe of [1.3, 1.7, 2.2]) for (const spread of [-0.5, 0, 0.5]) {
      const a = SEA_SIDE + turn + spread;
      if (isSea(Math.cos(a) * probe, Math.sin(a) * probe)) score += 1;
    }
    if (score > bestScore) { bestScore = score; best = turn; }
  }
  const c = Math.cos(best), s = Math.sin(best);
  return { turn: best, pieces: pieces.map((p) => ({ ...p, x: p.x * c - p.z * s, z: p.x * s + p.z * c, rot: p.rot - best })) };
}

export interface SettlementSpec { id: string; u: number; v: number; owner: FactionId; level: number }
export interface FleetSpec { key: string; u: number; v: number; faction: FactionId; count: number; seed: number; /** Bow direction in frame units, or null at anchor. */ heading: { du: number; dv: number } | null }
export interface MapWorld { settlements: SettlementSpec[]; fleets: FleetSpec[] }

/** How many hulls a force is drawn with: a few for a small squadron, never more than five. */
export const hullsFor = (ships: number) => (ships < 1 ? 0 : Math.min(5, Math.ceil(Math.sqrt(ships / 1.5))));

/** Which way (east, south) a camp is shifted from its port marker, by the side the label takes. */
const LABEL_AWAY: Record<'b' | 't' | 'l' | 'r', [number, number]> = { b: [0, -1], t: [0, 1], l: [1, 0], r: [-1, 0] };

/** Settlements for every owned camp, ships for every fleet in port (one group per faction) or on a lane (its midpoint, as the badge). */
export function buildWorld(regions: RegionView[], fleets: FleetView[]): MapWorld {
  const byId = new Map(regions.map((r) => [r.id, r]));
  const settlements: SettlementSpec[] = [];
  for (const r of regions) {
    const level = campLevel(r);
    if (!r.owner || r.offMap || level < 1) continue;
    const p = project(r.lon, r.lat);
    // The camp stands on the side away from the port's label and picture, so the DOM card never hides it.
    const [dx, dz] = LABEL_AWAY[r.labelSide ?? 'b'];
    settlements.push({ id: r.id, u: p.u + dx * SETTLEMENT_RADIUS * 1.1, v: p.v + dz * SETTLEMENT_RADIUS * 1.1 * MAP_ASPECT, owner: r.owner, level });
  }
  const groups = new Map<string, FleetSpec & { ships: number }>();
  for (const f of fleets) {
    if (!f.ships.length) continue;
    if (f.at) {
      const r = byId.get(f.at);
      if (!r) continue;
      const key = `${f.at}/${f.faction}`;
      const g = groups.get(key);
      if (g) { g.ships += f.ships.length; continue; }
      const p = project(r.lon, r.lat);
      groups.set(key, { key, u: p.u, v: p.v, faction: f.faction, count: 0, seed: hash(key), heading: null, ships: f.ships.length });
    } else if (f.transit) {
      const a = byId.get(f.transit.from), b = byId.get(f.transit.to);
      if (!a || !b) continue;
      const pa = project(a.lon, a.lat), pb = project(b.lon, b.lat);
      groups.set(f.id, { key: f.id, u: (pa.u + pb.u) / 2, v: (pa.v + pb.v) / 2, faction: f.faction, count: 0, seed: hash(f.id), heading: { du: pb.u - pa.u, dv: pb.v - pa.v }, ships: f.ships.length });
    }
  }
  const out: FleetSpec[] = [];
  for (const { ships, ...g } of groups.values()) out.push({ ...g, count: hullsFor(ships) });
  return { settlements, fleets: out };
}

/**
 * Anchorage spots for a squadron around a port, in settlement radii: on open water when `isSea` knows any, spread over
 * the arc facing the dock; otherwise on the ring itself.
 */
export function anchorage(count: number, seed: number, isSea: (x: number, z: number) => boolean): { x: number; z: number; rot: number }[] {
  const spots: { x: number; z: number; rot: number }[] = [];
  const first = (seed % 12) / 12 * Math.PI * 2;
  for (let ring = 0; ring < 3 && spots.length < count; ring += 1) {
    const radius = 1.7 + ring * 0.6;
    for (let i = 0; i < 12 && spots.length < count; i += 1) {
      const a = first + (i / 12) * Math.PI * 2;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      // A ship needs water under its whole length: probe the bow and the stern as well.
      if (isSea(x, z) && isSea(x * 1.15, z * 1.15)) spots.push({ x, z, rot: a + Math.PI / 2 + ((seed >> i) & 1 ? 0.35 : -0.35) });
    }
  }
  // A port with no open water close by (a river mouth, a cove) still gets its ships, ringed just outside the dock.
  for (let i = spots.length; i < count; i += 1) {
    const a = first + (i / Math.max(count, 1)) * Math.PI * 2;
    spots.push({ x: Math.cos(a) * 1.7, z: Math.sin(a) * 1.7, rot: a + Math.PI / 2 });
  }
  return spots;
}
