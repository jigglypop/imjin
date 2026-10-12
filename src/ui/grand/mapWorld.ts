import { MAP_ASPECT, project } from './projection';
import { campLevel } from './campArt';
import type { FactionId, FleetView, RegionView, ReplayView, SpotView } from './types';

// What stands on the campaign map besides the terrain: a settlement at every camp and a few ships where a fleet lies.
// Pure layout, no three.js (MapScene turns it into instances), so the shape of each camp level can be tested alone.

/** A settlement's radius in frame units: a camp covers about this much ground. */
export const SETTLEMENT_RADIUS = 0.013;

/** Unprefixed pieces are Joseon, `wa_` Japanese, `mg_` Ming, `pier` serves both; every kind is a procedural kit (campKits). */
export type PieceKind =
  | 'choga' | 'giwa' | 'hall' | 'fortgate' | 'bongsu' | 'battery' | 'dock' | 'magazine' | 'shipyard' | 'palisade' | 'stone'
  | 'pier' | 'wa_fence' | 'wa_tent' | 'wa_banner' | 'wa_wall' | 'wa_gate' | 'wa_tower' | 'wa_keep3' | 'wa_keep4' | 'wa_yard'
  | 'mg_palisade' | 'mg_watch' | 'mg_flag' | 'mg_brick' | 'mg_gate' | 'mg_corner' | 'mg_platform' | 'mg_beacon' | 'mg_yard';
/** The kinds that are one stretch of wall: they make a camp's ring and do not count as buildings. */
export const WALL_KINDS: ReadonlySet<PieceKind> = new Set<PieceKind>(['palisade', 'stone', 'wa_fence', 'wa_wall', 'mg_palisade', 'mg_brick']);
/** The kinds that stand in the water, not on the ground beside it. */
export const WATER_KINDS: ReadonlySet<PieceKind> = new Set<PieceKind>(['dock', 'shipyard', 'pier', 'wa_yard', 'mg_yard']);
/** One building of a settlement: offset from its centre and size, both in settlement radii; `rot` turns it about the vertical axis. */
export interface Piece { kind: PieceKind; x: number; z: number; rot: number; size: number }

const WALL_RADIUS = 0.92;
const WALL_SEGMENTS = 16;

/** The wall is a ring of segments; a gap at `gate` (radians) is left for the gate when there is one. */
function ring(kind: PieceKind, gate: number | null): Piece[] {
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
/** A building at (x, z) turned so its front looks at the camp's centre. */
const facingIn = (kind: PieceKind, x: number, z: number, size: number): Piece => ({ kind, x, z, rot: Math.atan2(-x, -z), size });
/** A building at (x, z) turned by `rot`. */
const stand = (kind: PieceKind, x: number, z: number, rot: number, size: number): Piece => ({ kind, x, z, rot, size });

/** The side of a camp that wants water: dock and battery stand here (the gate is on the opposite side). */
export const SEA_SIDE = Math.PI;

/** The four sides of a square wall `half` radii out, in segments as long as the round ones; the east side leaves a gap for a gate. */
function square(kind: PieceKind, half: number, gate: boolean): Piece[] {
  const pieces: Piece[] = [];
  const count = Math.round(half * 5);
  const length = ((2 * half) / count) * 1.06;
  for (let side = 0; side < 4; side += 1) {
    const a = (side * Math.PI) / 2;
    for (let i = 0; i < count; i += 1) {
      const along = -half + ((i + 0.5) * 2 * half) / count;
      if (gate && side === 0 && Math.abs(along) < 0.3) continue;
      pieces.push({ kind, x: Math.cos(a) * half - Math.sin(a) * along, z: Math.sin(a) * half + Math.cos(a) * along, rot: Math.PI / 2 - a, size: length });
    }
  }
  return pieces;
}

const corners = (kind: PieceKind, half: number, size: number): Piece[] =>
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => ({ kind, x: sx! * half, z: sz! * half, rot: 0, size }));

/**
 * A wajo: a curtain camp of cloth fences, tents and tall banners; a white watch tower and a pier; then a stone-based
 * plaster wall with a gate round a three-tier keep; at the top a four-tier keep and a shipyard.
 */
function japan(level: number): Piece[] {
  const tents = [facingIn('wa_tent', 0.22, -0.55, 0.42), facingIn('wa_tent', 0.22, 0.55, 0.42), facingIn('wa_tent', -0.3, -0.58, 0.42)];
  const banners = [at('wa_banner', 2.6, 0.78, 0.28), at('wa_banner', -2.6, 0.78, 0.28)];
  const tower = stand('wa_tower', -0.28, 0.54, 0.1, 0.38);
  const pier = at('pier', SEA_SIDE, 1.4, 0.85);
  if (level === 1) return [...ring('wa_fence', null), ...tents, ...banners];
  if (level === 2) return [...ring('wa_fence', null), ...tents, ...banners, tower, pier];
  const pieces: Piece[] = [
    ...ring('wa_wall', 0),
    at('wa_gate', 0, WALL_RADIUS, 0.85),
    ...tents, ...banners, stand('wa_banner', 0.55, 0.3, Math.PI / 2, 0.28), stand('wa_banner', 0.55, -0.3, Math.PI / 2, 0.28),
    tower,
    // The keep stands at the back of the yard and looks at the gate.
    stand(level >= 4 ? 'wa_keep4' : 'wa_keep3', -0.3, 0, Math.PI / 2, 0.62),
    pier,
  ];
  if (level >= 4) pieces.push(at('wa_yard', SEA_SIDE - 0.7, 1.45, 0.9), at('wa_tower', -0.8, WALL_RADIUS, 0.38));
  return pieces;
}

/**
 * A Ming fort: a square palisade with a wooden watch tower and flags; a brick wall with merlons, a square gate tower and
 * a pier; corner towers, a cannon platform and a beacon; at the top a larger yard and a shipyard.
 */
function ming(level: number): Piece[] {
  const half = level >= 4 ? 1 : 0.8;
  const flags = [stand('mg_flag', 0.3, -0.5, 0.6, 0.5), stand('mg_flag', -0.1, 0.55, -0.4, 0.5)];
  const watch = stand('mg_watch', -0.3, -0.35, 0.3, 0.55);
  if (level === 1) return [...square('mg_palisade', half, false), watch, ...flags];
  const pieces: Piece[] = [...square('mg_brick', half, true), at('mg_gate', 0, half, 0.85), watch, ...flags, at('pier', SEA_SIDE, half + 0.55, 0.85)];
  if (level === 2) return pieces;
  // The guns look out over the water, the beacon stands where the yard is open.
  pieces.push(...corners('mg_corner', half, 0.46), stand('mg_beacon', 0.3, 0.3, 0, 0.45), stand('mg_platform', -0.5, 0.3,-Math.PI / 2, 0.5));
  if (level >= 4) pieces.push(at('mg_yard', SEA_SIDE - 0.45, 1.55, 0.9));
  return pieces;
}

/** Where the owner's flag stands in an unturned camp, in settlement radii: the centre unless a keep or the great hall is there. */
export function flagSpot(level: number, faction: FactionId): [number, number] {
  if (faction === 'japan' && level >= 3) return [0.52, -0.12];
  return faction === 'joseon' && level >= 4 ? [0.24, 0] : [0, 0];
}

/**
 * A Joseon camp: a palisade round three thatched huts; then two tiled houses and a pier with a boat shed; then a stone wall
 * with a gatehouse, two beacon mounds, a battery and a powder store; at the top a great hall facing the gate across the
 * yard, a shipyard and a second battery. The gate looks away from the sea, the water works stand on the sea side.
 */
function joseon(level: number): Piece[] {
  const huts = [facingIn('choga', -0.44, -0.5, 0.36), facingIn('choga', -0.62, 0, 0.36), facingIn('choga', -0.44, 0.5, 0.36)];
  const houses: Piece[] = [{ kind: 'giwa', x: 0.3, z: -0.5, rot: 0, size: 0.48 }, { kind: 'giwa', x: 0.3, z: 0.5, rot: Math.PI, size: 0.48 }];
  const dock = at('dock', SEA_SIDE, 1.38, 0.85);
  if (level === 1) return [...ring('palisade', null), ...huts];
  if (level === 2) return [...ring('palisade', null), ...huts, ...houses, dock];
  const pieces: Piece[] = [
    ...ring('stone', 0),
    at('fortgate', 0, WALL_RADIUS, 0.7),
    at('bongsu', 1.15, WALL_RADIUS, 0.32), at('bongsu', -1.15, WALL_RADIUS, 0.32),
    ...huts, ...houses,
    facingIn('magazine', -0.06, -0.72, 0.3),
    dock,
    at('battery', SEA_SIDE + 0.62, 1.3, 0.6),
  ];
  if (level >= 4) pieces.push({ kind: 'hall', x: -0.2, z: 0, rot: Math.PI / 2, size: 0.56 }, at('shipyard', SEA_SIDE - 0.72, 1.45, 0.95), at('battery', SEA_SIDE + 1.3, 1.22, 0.6));
  return pieces;
}

/**
 * The pieces of a camp of this level and owner, before it is turned to face the sea. Each navy has its own look, and in
 * every look a higher level has at least the buildings of the lower one.
 */
export function settlementPieces(level: number, faction: FactionId = 'joseon'): Piece[] {
  if (level < 1) return [];
  if (faction === 'japan') return japan(level);
  if (faction === 'ming') return ming(level);
  return joseon(level);
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
/** A fleet that sailed during the closed turn, for the 3D ships to follow: its way as points in map units (x east, z south) and how many hulls. */
export interface SailSpec { key: string; faction: FactionId; count: number; points: { x: number; z: number }[]; lost: boolean }
export interface MapWorld { settlements: SettlementSpec[]; fleets: FleetSpec[]; sails: SailSpec[] }

/** At most this many hulls over the whole map, whatever the fleets: the layer stops adding ships here. */
export const SHIP_CAP = 140;

/** How many hulls a force is drawn with: a few for a small squadron, never more than five. */
export const hullsFor = (ships: number) => (ships < 1 ? 0 : Math.min(5, Math.ceil(Math.sqrt(ships / 1.5))));

/** Which way (east, south) a camp is shifted from its port marker, by the side the label takes. */
const LABEL_AWAY: Record<'b' | 't' | 'l' | 'r', [number, number]> = { b: [0, -1], t: [0, 1], l: [1, 0], r: [-1, 0] };

/**
 * How far along its lane a fleet in transit is, kept off both ports so it stays clear of their discs: the share of the
 * lane's turns already sailed, or the middle when the lane's length is unknown.
 */
export function transitShare(left: number, turns: number | undefined) {
  if (!turns || turns < 1) return 0.5;
  return Math.min(0.75, Math.max(0.25, (turns - left) / turns));
}

/** Frame point to "is this open water", for keeping ships off the islands a straight lane crosses. */
export type IsSea = (u: number, v: number) => boolean;

/**
 * Where the lane between two ports has the fleet that left `from` for `to`, and the share it has sailed. With `isSea` the
 * spot moves to the nearest open water, along the lane (never closer than 15% to either port) or up to two camp radii
 * to its side, so the hulls do not stand on an island the straight lane crosses; the map's marker takes the same spot.
 */
export function transitSpot(from: RegionView, to: RegionView, left: number, isSea?: IsSea) {
  const want = transitShare(left, from.laneTurns?.[to.id]);
  const pa = project(from.lon, from.lat), pb = project(to.lon, to.lat);
  // Along and across the lane in frame units, where v is MAP_ASPECT times shorter than u.
  const lu = pb.u - pa.u, lz = (pb.v - pa.v) / MAP_ASPECT;
  const length = Math.hypot(lu, lz) || 1;
  const at = (share: number, side: number) => ({ u: pa.u + lu * share + (lz / length) * side, v: pa.v + (lz * share - (lu / length) * side) * MAP_ASPECT });
  let best = { share: want, side: 0, cost: Infinity };
  if (isSea) {
    for (let step = -35; step <= 35; step += 1) {
      const share = want + step * 0.02;
      if (share < 0.15 || share > 0.85) continue;
      for (let k = -4; k <= 4; k += 1) {
        const side = k * SETTLEMENT_RADIUS * 0.5;
        const cost = Math.abs(share - want) * length + Math.abs(side);
        if (cost >= best.cost) continue;
        const p = at(share, side);
        if (isSea(p.u, p.v)) best = { share, side, cost };
      }
    }
  }
  return { share: best.share, ...at(best.share, best.side), du: lu, dv: pb.v - pa.v };
}

/**
 * Settlements for every owned camp, ships for every fleet in port (one group per faction) or on a lane (kept off land when
 * `isSea` is given), and the closed turn's sailings.
 */
export function buildWorld(regions: RegionView[], fleets: FleetView[], replay: ReplayView | null = null, isSea?: IsSea): MapWorld {
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
      const spot = transitSpot(a, b, f.transit.left, isSea);
      groups.set(f.id, { key: f.id, u: spot.u, v: spot.v, faction: f.faction, count: 0, seed: hash(f.id), heading: { du: spot.du, dv: spot.dv }, ships: f.ships.length });
    }
  }
  const out: FleetSpec[] = [];
  for (const { ships, ...g } of groups.values()) out.push({ ...g, count: hullsFor(ships) });
  return { settlements, fleets: out, sails: replay ? buildSails(replay, byId) : [] };
}

/** The ways the closed turn's fleets sailed, as points on the map. A move whose ports are not on the map is left out. */
export function buildSails(replay: ReplayView, byId: Map<string, RegionView>): SailSpec[] {
  const sails: SailSpec[] = [];
  const spotAt = (s: SpotView) => {
    const a = byId.get(s.at);
    if (!a) return null;
    const pa = project(a.lon, a.lat);
    const b = s.to ? byId.get(s.to) : undefined;
    const pb = b ? project(b.lon, b.lat) : pa;
    const share = s.t ?? 0;
    return { x: pa.u + (pb.u - pa.u) * share - 0.5, z: (pa.v + (pb.v - pa.v) * share - 0.5) / MAP_ASPECT };
  };
  for (const m of replay.moves) {
    const points = m.path.map(spotAt).filter((p): p is { x: number; z: number } => !!p);
    const count = hullsFor(m.ships);
    if (points.length >= 2 && count) sails.push({ key: m.id, faction: m.faction, count, points, lost: m.lost });
  }
  return sails;
}

/** The point a share of the way along a polyline, and the bow direction there (angle from +z towards +x). */
export function pointAlong(points: { x: number; z: number }[], share: number) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  let left = total * Math.min(1, Math.max(0, share));
  let angle = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!, b = points[i]!;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d > 0) angle = Math.atan2(b.x - a.x, b.z - a.z);
    if (left <= d && d > 0) return { x: a.x + ((b.x - a.x) * left) / d, z: a.z + ((b.z - a.z) * left) / d, angle };
    left -= d;
  }
  const end = points[points.length - 1]!;
  return { x: end.x, z: end.z, angle };
}

/**
 * Where each hull of a squadron of `count` rides relative to its leader, in hull lengths: `along` is behind it (negative),
 * `across` to starboard. A wedge rather than a column: the hulls of one rank ride abreast clear of each other's beam, so a
 * squadron stays about two hulls deep and does not trail back over the port it left.
 */
export function formation(count: number): { along: number; across: number }[] {
  const out: { along: number; across: number }[] = [];
  for (let k = 0; k < count; k += 1) {
    const rank = Math.ceil(k / 2);
    out.push({ along: rank ? -rank * 0.8 : 0, across: k === 0 ? 0 : (k % 2 ? -1 : 1) * rank * 0.45 });
  }
  return out;
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
