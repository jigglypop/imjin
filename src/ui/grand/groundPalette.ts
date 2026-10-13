import { MESH_SCALE } from './mapMath';

// The colours of the campaign world's land, one per facet, baked on the CPU when the ground is built: the DEM's TIN
// (groundLand.ts) and the far land north of it (farLand.ts) both colour their facets here, so the two match at the join.
// No three.js: the shader of the ground only passes these colours through.
//
// The ground reads as a few calm kinds of country, chosen by the lie of the land rather than by noise: paddies and fields
// on the flat low ground, woods on the slopes and the hills, darker pines higher up, bare rock on the steepest faces and
// the high ridges, and a pale beach where flat land meets the sea. Noise only wanders their borders and tints them a
// little across tens of kilometres, and a facet too big to hold a pattern takes its mean, so no facet stands out alone.

/** A colour written in sRGB as linear light, which is what vertex colours hold. */
const rgb = (r: number, g: number, b: number) => [(r / 255) ** 2.2, (g / 255) ** 2.2, (b / 255) ** 2.2] as const;

const PADDY = rgb(142, 170, 84);
const FIELD = rgb(116, 150, 72);
const FIELD_DRY = rgb(166, 160, 96);
const BROADLEAF = rgb(74, 116, 60);
const PINE = rgb(44, 82, 52);
const ROCK = rgb(124, 116, 102);
const ROCK_HIGH = rgb(176, 170, 158);
const SAND = rgb(230, 214, 166);

// The map's sun (the sky dome's glow shares it), a warm direct light and a cool sky light from above.
const SUN_LEN = Math.hypot(-0.55, 0.62, -0.55);
const SUN_X = -0.55 / SUN_LEN, SUN_Y = 0.62 / SUN_LEN, SUN_Z = -0.55 / SUN_LEN;
const SUN_LIGHT = [0.7, 0.665, 0.6] as const;
const SKY_LIGHT = [0.46, 0.5, 0.56] as const;
/**
 * The relief is drawn 4.2 times as steep as it is; lit at that slope every hillside facing away from the sun would go
 * dark. Light reads a normal flattened to about half of it, as the old relief shader did.
 */
const SHADE_SLOPE = 0.55;

/** Map units of the old relief (one is about 3.3 km) per world unit: the noise scales below are in them. */
const TO_MAP = 1 / MESH_SCALE;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mixInto = (a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: number[]) => {
  out[0] = a[0]! + (b[0]! - a[0]!) * t;
  out[1] = a[1]! + (b[1]! - a[1]!) * t;
  out[2] = a[2]! + (b[2]! - a[2]!) * t;
};

/** A well-mixed hash of a lattice point to 0..1. */
function hash(ix: number, iz: number, seed: number) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1 with one lattice cell per unit. */
function noise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/**
 * Noise of `scale` lattice cells per map unit at (mx, mz), faded to its mean on a facet `cells` map units wide that spans
 * more than about half a cell of it: one sample cannot speak for a patch that big.
 */
function filtered(mx: number, mz: number, scale: number, seed: number, cells: number) {
  const keep = 1 - smoothstep(0.3, 0.7, cells * scale);
  return keep > 0 ? 0.5 + (noise(mx * scale, mz * scale, seed) - 0.5) * keep : 0.5;
}

/** What `faceColor` needs to know of a facet. */
export interface Facet {
  /** Mean height in metres above the sea plane. */
  metres: number;
  /** Unit normal as drawn (y up, the relief 4.2 times as steep as it is). */
  nx: number;
  ny: number;
  nz: number;
  /** Centre in the campaign scene's units (x = u - 0.5, z = (v - 0.5) / MAP_ASPECT), the same for every caller. */
  x: number;
  z: number;
  /** Width in world units: patterns finer than the facet give way to their mean. */
  size: number;
  /** Slope of the ground round the facet as drawn (rise over run), from `groundSlopes`. */
  slope: number;
  /** Whether a corner of the facet lies under the sea plane: the facet draws a stretch of the coast. */
  shore: boolean;
}

const ground: number[] = [0, 0, 0];
const wood: number[] = [0, 0, 0];
const bare: number[] = [0, 0, 0];

/** Writes the linear RGB of a land facet, its kind of country lit by the map's sun and sky, into out[at..at+2]. */
export function faceColor(f: Facet, out: Float32Array, at: number): void {
  const mx = f.x * TO_MAP, mz = f.z * TO_MAP, cells = f.size * TO_MAP;
  // Two scales of wander: districts of about ten kilometres and single valleys or hillsides of about three.
  const district = filtered(mx, mz, 0.3, 1, cells);
  const valley = filtered(mx, mz, 1.1, 2, cells);
  const wander = district * 0.65 + valley * 0.35 - 0.5;
  const own = Math.hypot(f.nx, f.nz) / Math.max(1e-6, f.ny);
  const h = f.metres;

  // Low flat ground is farmland: paddies on the wettest and flattest, fields round them, drier in some districts.
  const paddy = (1 - smoothstep(18, 55, h + wander * 40)) * (1 - smoothstep(0.1, 0.24, f.slope));
  mixInto(FIELD, FIELD_DRY, smoothstep(0.62, 0.9, district) * 0.7, ground);
  mixInto(ground, PADDY, paddy, ground);
  // Slopes and hills are wooded, broadleaf low down and pine on the higher ground.
  mixInto(BROADLEAF, PINE, smoothstep(160, 650, h + wander * 200), wood);
  const woods = Math.max(smoothstep(0.26, 0.55, f.slope + wander * 0.22), smoothstep(70, 190, h + wander * 90));
  mixInto(ground, wood, woods, ground);
  // Bare rock on the steepest faces and the high ridges (Jirisan reaches about 1900 m), paler the higher it stands.
  mixInto(ROCK, ROCK_HIGH, smoothstep(900, 1700, h), bare);
  mixInto(ground, bare, Math.max(smoothstep(1.7, 2.6, own), smoothstep(1050, 1500, h + wander * 150)), ground);
  // A pale beach where flat land meets the sea, in the narrow facets along the coast; cliffs keep their own colour.
  if (f.shore) mixInto(ground, SAND, (1 - smoothstep(0.5, 1.1, own)) * (1 - smoothstep(0.0018, 0.0026, f.size)), ground);

  const sx = f.nx * SHADE_SLOPE, sz = f.nz * SHADE_SLOPE;
  const len = Math.hypot(sx, f.ny, sz) || 1;
  const sun = Math.max(0, (sx * SUN_X + f.ny * SUN_Y + sz * SUN_Z) / len);
  // The sky lights what faces up; a slight tint of the district's own keeps a wide plain from reading as one sheet.
  const sky = 0.75 + 0.25 * (f.ny / len);
  const tint = 1 + (valley - 0.5) * 0.05;
  for (let k = 0; k < 3; k += 1) out[at + k] = ground[k]! * (SUN_LIGHT[k]! * sun + SKY_LIGHT[k]! * sky) * tint;
}

/**
 * The slope of the ground round every facet of an indexed mesh, as drawn (rise over run): each vertex takes the mean
 * slope of the facets round it, weighted by their area, and each facet the mean of its three vertices. Woods and fields
 * chosen by it come in patches as wide as a facet's neighbours instead of flickering from one facet to the next.
 * `world` holds x, y, z per vertex.
 */
export function groundSlopes(index: ArrayLike<number>, world: ArrayLike<number>, vertices: number): Float32Array {
  const sum = new Float64Array(vertices), weight = new Float64Array(vertices);
  const triangles = index.length / 3;
  const facet = new Float32Array(triangles);
  for (let t = 0; t < triangles; t += 1) {
    const a = index[t * 3]!, b = index[t * 3 + 1]!, c = index[t * 3 + 2]!;
    const ux = world[b * 3]! - world[a * 3]!, uy = world[b * 3 + 1]! - world[a * 3 + 1]!, uz = world[b * 3 + 2]! - world[a * 3 + 2]!;
    const vx = world[c * 3]! - world[a * 3]!, vy = world[c * 3 + 1]! - world[a * 3 + 1]!, vz = world[c * 3 + 2]! - world[a * 3 + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const area = Math.abs(ny);
    const slope = area > 0 ? Math.hypot(nx, nz) / area : 0;
    for (const v of [a, b, c]) {
      sum[v] += slope * area;
      weight[v] += area;
    }
  }
  for (let t = 0; t < triangles; t += 1) {
    let s = 0;
    for (let k = 0; k < 3; k += 1) {
      const v = index[t * 3 + k]!;
      s += weight[v]! > 0 ? sum[v]! / weight[v]! : 0;
    }
    facet[t] = s / 3;
  }
  return facet;
}
