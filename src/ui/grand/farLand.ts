import meta from '../../select/demMeta.json';
import { demHeightAtUV, EXAGGERATION, MAP_H, MAP_W, V_SCALE } from '../../select/demFrame';
import { DEM_RECT, MESH_SCALE } from './mapMath';
import { MAP_ASPECT } from './projection';

// The Korean mainland north of the DEM, out to the horizon, so the world has no edge where the terrain rectangle ends.
// Next to the DEM's north edge the relief is the DEM's own north band mirrored, so ridges and valleys run on across the
// join at the same height; within about twenty kilometres hills take over between a west and an east coast that start
// where the DEM's own coasts meet its edge. Pure TS (no three.js): it returns the mesh's arrays and what the terrain's
// shader needs to colour it exactly as it colours the DEM (terrain.ts, `buildFarLandMaterial`), and the ground height the
// trees stand on.

/** Frame units of height per metre, the same as the terrain's. */
const UNIT = V_SCALE * MESH_SCALE;
/** World z of the DEM's north edge; the land runs from a little inside it to this far north of it. */
const NORTH_Z = (DEM_RECT.v - 0.5) / MAP_ASPECT;
// Deep enough that its north end is lost in the fog from the farthest the camera may stand.
const DEPTH = 9;
const OVERLAP = 0.012;
/** The land's east-west span in frame u: past the peninsula's coasts on both sides, where it is sea. */
const U0 = 0.2, U1 = 0.93;
const COLUMNS = 400, ROWS = 480;
/**
 * The mirrored DEM is sheared east as it goes north, by this many DEM widths per DEM height, so the band past the edge
 * is not a recognisable reflection of the mountains south of it (the shear is nothing at the edge itself).
 */
export const MIRROR_SHEAR = 0.25;
/** How far north (frame units) the mirrored DEM gives way to the hills: from `BLEND[0]` to `BLEND[1]`. */
const BLEND = [0.015, 0.1] as const;
/** Where the terrain mesh sits in the world: its centre and the world units per unit of its own (map) frame. */
const TERRAIN = { x: DEM_RECT.u + DEM_RECT.w / 2 - 0.5, z: (DEM_RECT.v + DEM_RECT.h / 2 - 0.5) / MAP_ASPECT, sx: MESH_SCALE, sz: DEM_RECT.h / MAP_ASPECT / MAP_H };
/** Ground metres per world unit east-west and north-south, for slopes in the terrain's own measure. */
const METRES = { x: (meta.width * meta.metersPerPixel) / (MAP_W * TERRAIN.sx), z: (meta.height * meta.metersPerPixel) / (MAP_H * TERRAIN.sz) };
/** The terrain's shading steepness (terrain.ts): slopes in metres per metre times this. */
const SHADE = EXAGGERATION * 0.55;

/** A smooth hash noise in [0, 1], value noise on a grid with a smoothstep blend. */
function noise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const h = (a: number, b: number) => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const top = h(ix, iz) + (h(ix + 1, iz) - h(ix, iz)) * sx;
  const bottom = h(ix, iz + 1) + (h(ix + 1, iz + 1) - h(ix, iz + 1)) * sx;
  return top + (bottom - top) * sz;
}

/**
 * Ridged hills, in metres: sharp crests and soft valleys a few kilometres apart, in ranges and basins tens of kilometres
 * across, as the country north of the coast is (most of it under 500 m, ridges to about 1500 m).
 */
function hills(x: number, z: number) {
  let sum = 0, amp = 1, freq = 34, norm = 0;
  for (let i = 0; i < 4; i += 1) {
    const n = 1 - Math.abs(noise(x * freq + i * 17.3, z * freq - i * 9.1) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  const range = noise(x * 5 + 3.1, z * 5 - 7.7);
  // Valleys run down near sea level, as the DEM's do, so fields fill them and woods the slopes.
  return (sum / norm) ** 2.1 * (300 + 1500 * range * range) + 8;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How far a coast strays east or west at `z`, up to about `amount` frame units: broad bays and headlands with smaller coves
 * along them, so a coast tens of kilometres long never runs as a straight line.
 */
const wander = (z: number, seed: number, amount: number) =>
  ((noise(z * 1.2, seed) - 0.5) + (noise(z * 5, seed + 1.7) - 0.5) * 0.6 + (noise(z * 18, seed + 3.1) - 0.5) * 0.35 + (noise(z * 60, seed + 7.3) - 0.5) * 0.15) * amount * 1.6;

/** The frame u of the DEM's westernmost and easternmost land along its north edge: where the far land's coasts start. */
function seamCoasts(heights: Float32Array) {
  const n = 400, land: boolean[] = [];
  for (let i = 0; i <= n; i += 1) {
    let count = 0;
    for (const lv of [0.005, 0.02, 0.04]) if (demHeightAtUV(heights, i / n, lv) > 0) count += 1;
    land.push(count >= 2);
  }
  // The first and last runs of land at least 2% of the DEM wide: single islands at the corners do not count.
  const run = Math.ceil(n * 0.02);
  const solid = (i: number) => land.slice(i, i + run).every(Boolean);
  let a = 0, b = n;
  while (a < n && !solid(a)) a += 1;
  while (b > 0 && !solid(b - run + 1)) b -= 1;
  const u = (i: number) => DEM_RECT.u + (DEM_RECT.w * i) / n;
  return a < b ? { west: u(a), east: u(b) } : { west: 0.28, east: 0.835 };
}

export interface FarLand {
  position: Float32Array;
  /** The terrain mesh's own frame (map units) at each vertex: the terrain shader's noise and DEM lookups run in it. */
  local: Float32Array;
  /** The hills' own height in metres and their shading normal, which the shader blends in over the mirrored DEM's. */
  hills: Float32Array;
  hillNormal: Float32Array;
  /** 0 where the mirrored DEM shows, 1 where the hills do. */
  blend: Float32Array;
  index: Uint32Array;
  /** Ground height in frame units at a frame point north of the DEM (0 on the water), for the trees. */
  heightAt: (u: number, v: number) => number;
}

/** The far land's mesh in world units (x east, y up, z south). `heights` are the DEM's metres. */
export function buildFarLand(heights: Float32Array): FarLand {
  const count = (COLUMNS + 1) * (ROWS + 1);
  const position = new Float32Array(count * 3);
  const local = new Float32Array(count * 2);
  const hillsH = new Float32Array(count);
  const hillNormal = new Float32Array(count * 3);
  const blend = new Float32Array(count);
  const metres = new Float32Array(count);
  const coasts = seamCoasts(heights);
  // Rows close together at the seam, where the DEM's detail has to carry on, and wide apart in the haze.
  const rowZ = (j: number) => NORTH_Z + OVERLAP - (OVERLAP + DEPTH) * (j / ROWS) ** 2.6;
  const colU = (i: number) => U0 + ((U1 - U0) * i) / COLUMNS;
  for (let j = 0; j <= ROWS; j += 1) {
    const z = rowZ(j);
    const north = NORTH_Z - z;
    // The coasts start where the DEM's do and settle on the peninsula's, the west near 126.4 E, the east near 129.4 E.
    const settle = smoothstep(0, 0.8, north);
    const west = coasts.west + (0.28 - coasts.west) * settle + wander(z, 4.2, 0.07) * settle - Math.max(0, north) * 0.006;
    const east = coasts.east + (0.835 - coasts.east) * settle + wander(z, 9.7, 0.045) * settle;
    for (let i = 0; i <= COLUMNS; i += 1) {
      const u = colU(i);
      const x = u - 0.5;
      // The DEM's own height inside it while the two overlap, mirrored (and sheared) north of its edge, sea outside its sides.
      const lv = Math.min(1, (Math.abs(z - NORTH_Z) * MAP_ASPECT) / DEM_RECT.h);
      const lu = (u - DEM_RECT.u) / DEM_RECT.w - (north > 0 ? lv * MIRROR_SHEAR : 0);
      const inside = lu >= 0 && lu <= 1;
      const mirrored = inside ? demHeightAtUV(heights, lu, lv) : -60;
      const land = smoothstep(west - 0.012, west + 0.02, u) * smoothstep(east + 0.012, east - 0.02, u);
      const far = hills(x, z) * land - 80 * (1 - land);
      const t = inside ? smoothstep(BLEND[0], BLEND[1], north) : 1;
      const h = mirrored + (far - mirrored) * t;
      const k = j * (COLUMNS + 1) + i;
      metres[k] = h;
      hillsH[k] = far;
      blend[k] = t;
      local[k * 2] = (x - TERRAIN.x) / TERRAIN.sx;
      local[k * 2 + 1] = (z - TERRAIN.z) / TERRAIN.sz;
      // Where it overlaps the DEM it lies a hair under it, so the terrain's own surface shows there.
      const under = north < 0 ? 0.0003 : 0;
      position[k * 3] = x;
      // Water lies well under the sea plane, which draws it; land stands on the relief's own scale.
      position[k * 3 + 1] = (h > 0 ? h * UNIT : Math.min(h * UNIT, -0.0012)) - under;
      position[k * 3 + 2] = z;
    }
  }
  // The hills' shading normal, by the terrain's own rule: slopes in metres per metre, steepened by its shading factor.
  const at = (i: number, j: number) => hillsH[Math.min(ROWS, Math.max(0, j)) * (COLUMNS + 1) + Math.min(COLUMNS, Math.max(0, i))]!;
  const dx = ((U1 - U0) / COLUMNS) * METRES.x;
  for (let j = 0; j <= ROWS; j += 1) {
    const dz = (rowZ(Math.max(0, j - 1)) - rowZ(Math.min(ROWS, j + 1))) * METRES.z || 1;
    for (let i = 0; i <= COLUMNS; i += 1) {
      // East and south slopes: z runs south, rows run north.
      const sx = (at(i + 1, j) - at(i - 1, j)) / (2 * dx), sz = (at(i, j - 1) - at(i, j + 1)) / dz;
      const n = [-sx * SHADE, 1, -sz * SHADE];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!);
      const k = (j * (COLUMNS + 1) + i) * 3;
      hillNormal[k] = n[0]! / len;
      hillNormal[k + 1] = n[1]! / len;
      hillNormal[k + 2] = n[2]! / len;
    }
  }
  const index = new Uint32Array(COLUMNS * ROWS * 6);
  let o = 0;
  for (let j = 0; j < ROWS; j += 1) {
    for (let i = 0; i < COLUMNS; i += 1) {
      const a = j * (COLUMNS + 1) + i, b = a + 1, c = a + COLUMNS + 1, d = c + 1;
      // Rows run north, columns east: (a, b, c) winds counter-clockwise seen from above.
      index.set([a, b, c, b, d, c], o);
      o += 6;
    }
  }
  const heightAt = (u: number, v: number) => {
    const z = (v - 0.5) / MAP_ASPECT;
    const fi = ((u - U0) / (U1 - U0)) * COLUMNS, fj = ROWS * Math.max(0, (NORTH_Z + OVERLAP - z) / (OVERLAP + DEPTH)) ** (1 / 2.6);
    if (fi < 0 || fi > COLUMNS || fj > ROWS) return 0;
    const i = Math.min(COLUMNS - 1, Math.floor(fi)), j = Math.min(ROWS - 1, Math.floor(fj)), a = fi - i, b = fj - j;
    const m = (ii: number, jj: number) => metres[jj * (COLUMNS + 1) + ii]!;
    const h = (m(i, j) * (1 - a) + m(i + 1, j) * a) * (1 - b) + (m(i, j + 1) * (1 - a) + m(i + 1, j + 1) * a) * b;
    return Math.max(0, h) * UNIT;
  };
  return { position, local, hills: hillsH, hillNormal, blend, index, heightAt };
}
