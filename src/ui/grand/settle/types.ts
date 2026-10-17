import type { MeshData } from '../../../ships/build/parts';
import { V_SCALE } from '../mapTheatre';
import { METRES_PER_RADIUS } from '../campPieces';
import { MESH_SCALE } from '../mapMath';
import { SETTLEMENT_RADIUS } from '../mapWorld';
import { MAP_ASPECT } from '../projection';
import type { BuildingKind, FactionId } from '../types';

// The contract of the campaign map's settlements (README.md beside this file): one baked site per on-map region, solved
// offline into public/ui/grand_sites.json with its pads flattened into the terrain, and the builders that turn a site and
// its region's state into geometry. Plain data and pure functions, no three.js: the builders run in a worker and in node.
//
// A site has its own frame in model metres: x east, z south, y up, the origin in the middle of its core pad at the frame
// point (u, v), the sea plane at y = 0. A model metre is MODEL_METRE frame units across and up alike, the scale the
// settlement kits are already drawn at. The terrain is not drawn at that scale: a DEM texel is about 0.98 model metres
// across but a metre of real elevation only ELEVATION_METRE model metres high, so hills are low and buildings large, as on
// any strategy map. `rot` turns a thing about +y as three.js's rotation.y does: its front (its own +z) then looks along
// facing(rot) = (sin rot, cos rot). Outlines run counter-clockwise seen from above on a north-up map, the order of
// kitParts.rect, so the outward normal of an edge a -> b is (a.z - b.z, b.x - a.x). kitParts.walls turns its faces the
// other way, inward, and is no model for new walls.

/** Frame units in one model metre, across and up. mapWorld.ts takes only types from here, so the two never load in a circle. */
export const MODEL_METRE = SETTLEMENT_RADIUS / METRES_PER_RADIUS;
/** Model metres in one metre of real elevation (about 0.026): a hill 100 m high stands 2.6 model metres. */
export const ELEVATION_METRE = (V_SCALE * MESH_SCALE) / MODEL_METRE;

export type Vec2 = [x: number, z: number];
export type Vec3 = [x: number, y: number, z: number];

/** A point of a site and the way something there faces. */
export interface Place { x: number; z: number; rot: number }

/** The direction a thing turned by `rot` faces, in a site's x and z. */
export const facing = (rot: number): Vec2 => [Math.sin(rot), Math.cos(rot)];
/** The turn that faces a thing along (dx, dz). */
export const rotToward = (dx: number, dz: number) => Math.atan2(dx, dz);

/** The frame point (u east, v south, as project() gives) of a point of a site. */
export function siteToFrame(site: { u: number; v: number }, x: number, z: number) {
  return { u: site.u + x * MODEL_METRE, v: site.v + z * MODEL_METRE * MAP_ASPECT };
}

/** The point of a site at a frame point. */
export function frameToSite(site: { u: number; v: number }, u: number, v: number): Vec2 {
  return [(u - site.u) / MODEL_METRE, (v - site.v) / (MODEL_METRE * MAP_ASPECT)];
}

/**
 * Where a point of a site stands in the campaign scene (worldCamera.ts: x = u - 0.5, z = (v - 0.5) / MAP_ASPECT, y in
 * frame units): a site's meshes take the matrix translate(site.u - 0.5, 0, (site.v - 0.5) / MAP_ASPECT) x scale(MODEL_METRE).
 */
export function siteToWorld(site: { u: number; v: number }, x: number, y: number, z: number): Vec3 {
  return [site.u - 0.5 + x * MODEL_METRE, y * MODEL_METRE, (site.v - 0.5) / MAP_ASPECT + z * MODEL_METRE];
}

/** The area an outline encloses, positive when it runs the contract's way round. */
export function outlineArea(points: readonly Vec2[]) {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, az] = points[i]!, [bx, bz] = points[(i + 1) % points.length]!;
    twice += az * bx - ax * bz;
  }
  return twice / 2;
}

/**
 * The drawn ground under a site, in its frame. At run time it is the terrain as groundLand.ts draws it, pads included,
 * bilinear between DEM texels like MapLayer.surface; in node it is a fixture's grid (fixtures.ts).
 */
export interface Ground {
  /** Height of the land in model metres above the sea plane; 0 over open water. */
  height(x: number, z: number): number;
  /** Whether the point is open water as drawn. */
  water(x: number, z: number): boolean;
}

/** A camp's tier, or a work's level: the rules stop at three (MAX_LEVEL), so nothing draws a fourth. */
export type Tier = 1 | 2 | 3;
/** A region's value (regions.ts, fixed for the war): it sets the size of the port's town. */
export type TownValue = 1 | 2 | 3;
export type WorkKind = Exclude<BuildingKind, 'camp'>;
export const WORK_KINDS: readonly WorkKind[] = ['battery', 'shipyard', 'dock', 'granary', 'beacon'];

/** The quay's top above the sea plane, model metres. */
export const QUAY_TOP = 0.9;
/** A pad's least height: a step above the quay, since the land at the coast stands only 0.04 above the sea plane. */
export const PAD_MIN = 1.2;
/** How far the drawn ground may stray from a pad's h0 anywhere inside its outline. */
export const PAD_TOLERANCE = 0.05;
/** The most the ground may vary under a footprint on a pad (lots and slots on pads are drawn as standing on the flat). */
export const PAD_RANGE = 0.35;
/** The most the ground may fall under a lot on open terrain (a town's houses): about a 10 % slope across a house. */
export const TERRAIN_DROP = 1.4;
/** The room one hull takes at a berth or at anchor: the longest hull on the map (HULL_LENGTH radii, 22 m) with clearance. */
export const BERTH = { length: 24, beam: 8 } as const;

// ---------- the baked site ----------

/** The file the sites are baked into (scripts/build-grand-sites.mjs). */
export interface SitesFile {
  version: 1;
  /** SHA-256 of public/ui/grand_terrain.bin as it was solved against: every height in the sites is that terrain's. */
  terrain: string;
  sites: SiteRecord[];
}

/**
 * One on-map region's settlement ground, the same whoever holds it and whatever stands there: a camp's tier, a work's
 * level and the owner only choose what the builders draw on it, so nothing ever moves when a port grows or changes hands.
 */
export interface SiteRecord {
  /** The region's id. */
  id: string;
  /** The frame point of the site's origin, the middle of its core pad. */
  u: number;
  v: number;
  /** Unit vector from the core pad through the harbour gate to open water: the sea axis the whole site is laid along. */
  seaward: Vec2;
  /** Model metres from the origin that hold everything the site can show at full build-out (culling and level of detail). */
  radius: number;
  /** The region's value and whether it is a navy's seat, copied from the rules (both are fixed for the war). */
  value: TownValue;
  seat: boolean;
  /** Ground the terrain build flattens: the core pad always, small pads under works that need a level floor, a town's if it has one. */
  pads: Pad[];
  harbour: Harbour;
  camp: CampSite;
  town: TownSite;
  /** Every work's slot, sized for its third level, reserved whether or not it is built. */
  works: Record<WorkKind, WorkSlot>;
  fields: Field[];
  /** Roads out of the camp's land gate, each this site's half of the way to a neighbour (they meet at the midpoint). */
  roads: Road[];
}

/**
 * Ground the terrain build flattens to h0 inside `poly` and eases back into the land outside it. Land within two texels
 * of the water is left as it is, so no coastline moves: a pad's outline stays that far from the drawn shore.
 */
export interface Pad {
  id: 'core' | 'town' | WorkKind;
  poly: Vec2[];
  h0: number;
}

/**
 * The harbour in front of the core pad, on the real shore. The camp builds the stretch of quay and the piers of its tier:
 * the quay is an apron QUAY_TOP high from this line back to the core pad's edge (land only, a metre to fifteen of it),
 * with steps up to the sea gate. Hulls at the port moor at the berths of the piers that stand and lie at the anchorage.
 */
export interface Harbour {
  /** The quay's face along the shore, half a metre inside the drawn waterline, in order along the coast. */
  quay: Vec2[];
  /** The stretch of `quay` each tier builds: metres along it from its first point (an empty stretch builds none). */
  span: Record<Tier, [from: number, to: number]>;
  /** Where the main street comes down to the quay, facing the sea: markers and cards anchor here. */
  gate: Place;
  piers: Pier[];
  /** Spots in open water beyond the piers, nearest first, for hulls that find no berth (BERTH room each, bows to sea). */
  anchorage: Place[];
  /** A breakwater for tier 3 where the cove allows one; empty where it does not. */
  breakwater: Vec2[];
}

/** A pier from its root on the quay out `len` metres along `rot`, standing from camp tier `from`. */
export interface Pier extends Place {
  len: number;
  width: number;
  from: Tier;
  /** Hulls moored alongside, bows out along the pier. */
  berths: Place[];
}

/** A wall's line on the ground. A closed line rings what it guards; its gates are openings exactly on it. */
export interface WallLine {
  points: Vec2[];
  closed: boolean;
  gates: Gate[];
}

/** An opening in a wall `width` metres wide, its centre on the line, facing out of what the wall rings. */
export interface Gate extends Place {
  width: number;
  /** The sea gate opens onto the harbour (the main gate, under the camera's usual view), the land gate onto the roads. */
  role: 'sea' | 'land' | 'side';
}

export interface CampSite {
  /** The wall of each tier, all on the core pad and nested: tier 1 inside tier 2 inside tier 3. */
  walls: Record<Tier, WallLine>;
  /** Streets inside the walls, the main street from the sea gate up to the hall first. */
  streets: Street[];
  lots: Lot[];
}

/**
 * The port's town. buildTown(value) draws what stands from that value or below: the solver lays a town out up to its
 * region's value, the fixtures to 3 where the ground allows, so every size can be seen on one site.
 */
export interface TownSite {
  /** Whose houses it has whoever holds it: Korean, or Japanese on Tsushima. */
  culture: 'korean' | 'japanese';
  /** The shore street first; a street stands from the town value `from`. */
  streets: Street[];
  lots: Lot[];
  /** A walled town's wall (value 3) or the stub of one (value 2), standing from the value `from`. */
  walls: (WallLine & { from: TownValue })[];
}

export interface Street { points: Vec2[]; width: number; from: 1 | 2 | 3 }

/**
 * What a lot holds. Kinds are roles, not models: each navy and tier draws its own building for a role (a tier-1 hall is a
 * small office, a tier-3 one the commander's hall; Japanese barracks are tents at tier 1). A yard is open ground the
 * builder dresses with the camp's fire, flagpoles and racks.
 */
export type CampLotKind = 'hall' | 'office' | 'barracks' | 'store' | 'yard' | 'well' | 'pavilion' | 'tower';
export type TownLotKind = 'house' | 'market' | 'tree' | 'well' | 'pavilion' | 'temple' | 'yamen' | 'store' | 'racks' | 'boats' | 'landing';
export type LotKind = CampLotKind | TownLotKind;

/** A rectangle of ground for one thing, its front (+z) along facing(rot). */
export interface Lot extends Place {
  kind: LotKind;
  /** Width along the lot's own x and depth along its z, metres: what the builder makes stays inside, eaves included. */
  w: number;
  d: number;
  /** The floor: the pad's h0 on a pad, else the highest ground under the lot, so nothing is buried. */
  y: number;
  /** How far the ground falls below `y` somewhere under the lot: the footing reaches at least this deep. */
  drop: number;
  /** The camp tier (camp lots) or town value (town lots) it stands from; its place is the same at every tier. */
  from: 1 | 2 | 3;
  /** Its order among the lots of its kind, 0 the best placed: the first houses are tiled, the first rows built first. */
  rank: number;
  /** Stands only at a navy's seat. */
  seat?: true;
}

/**
 * A work's slot. A shipyard's or a dock's straddles the waterline: land for local z below `shore`, water beyond, its +z
 * out to sea. A battery faces the open water, a granary its street, a beacon (on the summit) the sea.
 */
export interface WorkSlot extends Place {
  kind: WorkKind;
  w: number;
  d: number;
  y: number;
  drop: number;
  shore?: number;
}

/** A field as strips along `dir` (a turn, as rot), standing from the town value `from`. */
export interface Field { poly: Vec2[]; kind: 'paddy' | 'dry'; dir: number; from: 1 | 2 | 3 }

/** A road `width` metres wide towards the neighbouring region `to`. */
export interface Road { to: string; points: Vec2[]; width: number }

/** Width and depth ranges of each lot kind (metres): the solver sizes lots within them and every builder fills any lot within them. */
export const LOT_SIZE: Record<LotKind, { w: [number, number]; d: [number, number] }> = {
  hall: { w: [18, 26], d: [12, 18] },
  office: { w: [9, 14], d: [7, 10] },
  barracks: { w: [10, 30], d: [6, 9] },
  store: { w: [7, 12], d: [6, 9] },
  yard: { w: [10, 34], d: [8, 24] },
  well: { w: [2.5, 4], d: [2.5, 4] },
  pavilion: { w: [7, 16], d: [7, 12] },
  tower: { w: [5, 8], d: [5, 8] },
  house: { w: [8, 16], d: [6, 10] },
  market: { w: [12, 24], d: [10, 20] },
  tree: { w: [6, 9], d: [6, 9] },
  temple: { w: [12, 18], d: [10, 16] },
  yamen: { w: [18, 26], d: [14, 20] },
  racks: { w: [5, 12], d: [3, 6] },
  boats: { w: [8, 16], d: [4, 8] },
  landing: { w: [3, 5], d: [8, 18] },
};

/** The ground each work's slot reserves (metres): its third level's footprint, so a work grows in place. */
export const SLOT_SIZE: Record<WorkKind, { w: number; d: number }> = {
  battery: { w: 18, d: 12 },
  shipyard: { w: 24, d: 28 },
  dock: { w: 20, d: 26 },
  granary: { w: 22, d: 16 },
  beacon: { w: 14, d: 12 },
};

// ---------- the builders ----------

/** What a region's state lets stand on its site: a site's meshes are rebuilt only when this changes. */
export interface SiteState {
  owner: FactionId | null;
  /** The camp's tier, 0 while none stands. */
  tier: 0 | Tier;
  /** The works standing, by level; a work absent or at 0 is not built. */
  works: Partial<Record<WorkKind, 0 | Tier>>;
}

export type Lod = 0 | 1 | 2;
/**
 * The levels of detail a builder makes, in the site's frame with absolute heights, as MeshData (packed for the GPU by
 * pack.toGeometry): 0 for a settlement wider than about 450 px on screen, 1 from about 130 px, 2 below that, merged with
 * every other site's into one draw for the whole map.
 */
export type Lods = [lod0: MeshData, lod1: MeshData, lod2: MeshData];
/** The levels to make; a level not asked for comes back empty (no vertices), so a builder can make one level on demand. */
export interface BuildOptions { lods?: readonly Lod[] }
/** Where a built thing shows life, in the site's frame. */
export interface Marks {
  /** Where smoke rises: hearths, forges, a camp's yard, a beacon's stacks (the top of the chimney). */
  smoke: Vec3[];
  /** Slipways, each with room for a hull `len` metres long: the yard's queue sits on them. */
  slips: (Place & { len: number })[];
}
export interface Built { lods: Lods; marks: Marks }

/**
 * settle/modules/camp.ts: the camp of a tier in a navy's style: its walls and gates (through BuildWall), the lots of its
 * tier and below, the yard floor inside the wall, the quay's stretch and the piers of the tier, its banners.
 */
export type BuildCamp = (navy: FactionId, tier: Tier, site: SiteRecord, ground: Ground, o?: BuildOptions) => Built;
/**
 * settle/modules/town.ts: the town's lots and walls up to a value (and a seat's lots), the owner's pennants and ridge tint,
 * none while nobody holds the port.
 */
export type BuildTown = (value: TownValue, owner: FactionId | null, site: SiteRecord, ground: Ground, o?: BuildOptions) => Built;
/** settle/modules/works.ts: one work of a level in a navy's style (Korea's own while nobody holds the port), inside its slot. */
export type BuildWork = (kind: WorkKind, level: Tier, navy: FactionId, slot: WorkSlot, ground: Ground, o?: BuildOptions) => Built;
/**
 * settle/walls.ts: a wall along its line, its gates in the openings and towers where it turns; its crown level on a pad,
 * stepping with the ground off one, its outer face skirted down to the ground.
 */
export type BuildWall = (line: WallLine, style: WallStyle, ground: Ground, o?: BuildOptions) => Built;
/**
 * settle/groundworks.ts: what lies on the ground whatever stands there: the pads' skirts and retaining walls, the town's
 * streets up to the site's value, roads and fields. Built once per site.
 */
export type BuildGroundworks = (site: SiteRecord, ground: Ground, o?: BuildOptions) => Built;

/** How a wall is built: a camp's by navy and tier, a town's by value. */
export type WallStyle =
  | 'jo-palisade' | 'jo-rampart' | 'jo-stone'
  | 'wa-curtain' | 'wa-earthwork' | 'wa-ishigaki'
  | 'mg-stockade' | 'mg-rammed' | 'mg-brick'
  | 'town-earth' | 'town-stone';

/** Each navy's camp wall by tier: logs, then earth and timber, then masonry. */
export const CAMP_WALL: Record<FactionId, Record<Tier, WallStyle>> = {
  joseon: { 1: 'jo-palisade', 2: 'jo-rampart', 3: 'jo-stone' },
  japan: { 1: 'wa-curtain', 2: 'wa-earthwork', 3: 'wa-ishigaki' },
  ming: { 1: 'mg-stockade', 2: 'mg-rammed', 3: 'mg-brick' },
  // The Armada theatre has no solved settlements; its camps are the European kits (campEurope.ts). Masonry stands in.
  england: { 1: 'mg-stockade', 2: 'mg-rammed', 3: 'mg-brick' },
  spain: { 1: 'mg-stockade', 2: 'mg-rammed', 3: 'mg-brick' },
  holyleague: { 1: 'mg-stockade', 2: 'mg-rammed', 3: 'mg-brick' },
  ottoman: { 1: 'mg-stockade', 2: 'mg-rammed', 3: 'mg-brick' },
};

// ---------- colour and light ----------

const SUN_LENGTH = Math.hypot(-0.55, 0.62, -0.55);
/**
 * The map's light, the land's own (groundPalette.ts bakes it into every facet): a warm sun high in the north-west and a
 * cool sky; and, for walls only, the sunlit ground's light thrown back up at them. groundPalette.ts reads the first three
 * from here once the pads' colours go in, so land and buildings share one copy.
 */
export const LIGHT = {
  sun: [-0.55 / SUN_LENGTH, 0.62 / SUN_LENGTH, -0.55 / SUN_LENGTH] as Vec3,
  sunColour: [0.7, 0.665, 0.6] as Vec3,
  skyColour: [0.46, 0.5, 0.56] as Vec3,
  bounce: [0.2, 0.21, 0.17] as Vec3,
};

/**
 * The light a surface facing the unit normal n gets, baked into its vertices. Anything facing up gets exactly what the
 * land gets, so a yard, a pad or a flat roof matches the ground beside it; walls also get the bounce, since the sun stands
 * behind the faces the camera usually sees (it looks north), and a lime wall facing the camera would read grey without it
 * (0.48 with the bounce, 0.37 without, 0.9 facing up). A vertex's colour is palette (linear RGB, at most 1) x
 * bakedLight(n) x the occlusion bakeGrime folds in, and nothing lights it at run time.
 */
export function bakedLight(nx: number, ny: number, nz: number): Vec3 {
  const sun = Math.max(0, nx * LIGHT.sun[0] + ny * LIGHT.sun[1] + nz * LIGHT.sun[2]);
  const sky = 0.75 + 0.25 * ny, bounce = (1 - ny) / 2;
  return [0, 1, 2].map((k) => LIGHT.sunColour[k]! * sun + LIGHT.skyColour[k]! * sky + LIGHT.bounce[k]! * bounce) as Vec3;
}

/**
 * The optional detail atlas, one shared by every navy: 4 x 4 cells of 128 px in a 512 px texture. Only LOD0 samples it,
 * at the cell its vertices name (mat's atlas cell; 0 is none) with uv in metres over each cell's tile, fading out with
 * distance. Each cell averages mid grey and the material multiplies by twice it, so the detail never shifts a surface's
 * mean colour and the levels of detail match when they swap. Surface classes are SURF's: cloth and banners sway and take
 * no detail, embers glow, everything else is plain.
 */
export const DETAIL_ATLAS = { size: 512, grid: 4, cell: 128 } as const;

// ---------- budgets ----------

/**
 * Triangles at [LOD0, LOD1, LOD2] of each builder's output, walls, gates and harbour included in the camp's. A seat's
 * third-tier camp may spend `seatCamp`.
 */
export const TRIANGLES = {
  camp: { 1: [2500, 800, 150], 2: [6000, 1800, 250], 3: [14000, 3500, 400] },
  seatCamp: [20000, 5000, 500],
  town: { 1: [2500, 700, 100], 2: [6000, 1600, 200], 3: [12000, 3000, 350] },
  work: { 1: [800, 250, 40], 2: [1600, 450, 60], 3: [2500, 700, 80] },
  groundworks: [4000, 1500, 150],
} as const satisfies {
  camp: Record<Tier, readonly [number, number, number]>; seatCamp: readonly [number, number, number];
  town: Record<TownValue, readonly [number, number, number]>; work: Record<Tier, readonly [number, number, number]>;
  groundworks: readonly [number, number, number];
};

/**
 * The settlement layer as a whole on a desktop (the high and medium tiers; phones keep the flat map). Medium shows LOD0
 * from 1 / 0.75 of the width and fields only at LOD0.
 */
export const LAYER = {
  /** Settlement triangles on screen at a typical mid zoom, and at worst. */
  triangles: 90_000,
  trianglesWorst: 200_000,
  /** Draw calls of the whole layer: the aim and the limit. */
  draws: 40,
  drawsMax: 80,
  /** The one merged LOD2 mesh of every site. */
  lod2: 25_000,
  /** GPU memory of the layer at full build-out. */
  bytes: 12 * 1024 * 1024,
  /** A site's build in the worker, every level, and choosing every site's level in a frame (milliseconds). */
  buildMs: 25,
  lodMs: 0.2,
  /** Screen width (px, on a 1600 px window) from which a site shows LOD0 and LOD1, and the hysteresis on both. */
  lod0Pixels: 450,
  lod1Pixels: 130,
  hold: 1.12,
} as const;
