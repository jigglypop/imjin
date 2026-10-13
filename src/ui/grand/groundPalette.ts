import { MESH_SCALE } from './mapMath';

// The colours of the campaign world's land, one per facet, baked on the CPU when the ground is built: the DEM's TIN
// (groundLand.ts) and the far land north of it (farLand.ts) both colour their facets here, so the two match at the join.
// No three.js: the shader of the ground only passes these colours through.

/** A colour written in sRGB as linear light, which is what vertex colours hold. */
const rgb = (r: number, g: number, b: number) => [(r / 255) ** 2.2, (g / 255) ** 2.2, (b / 255) ** 2.2] as const;

const FIELD_GREEN = rgb(118, 150, 80);
const FIELD_DRY = rgb(164, 166, 98);
const PADDY = rgb(140, 160, 92);
const FOREST_DARK = rgb(38, 72, 46);
const FOREST_LIGHT = rgb(64, 100, 58);
const ROCK_LOW = rgb(116, 106, 92);
const ROCK_HIGH = rgb(164, 156, 144);
const SAND = rgb(206, 190, 148);

// The sun of the map (the sky dome's glow and the old relief shader share it) and how much it lights a facet.
const SUN_LEN = Math.hypot(-0.55, 0.62, -0.55);
const SUN_X = -0.55 / SUN_LEN, SUN_Y = 0.62 / SUN_LEN, SUN_Z = -0.55 / SUN_LEN;
const AMBIENT = 0.52;
const DIRECT = 0.66;
/**
 * The relief is drawn 4.2 times as steep as it is; lit at that slope every hillside facing away from the sun would go
 * dark. Light reads a normal flattened to about half of it, as the old relief shader did.
 */
const SHADE_SLOPE = 0.55;

/** Map units of the old relief (one is about 3.3 km) per world unit: the noise scales below were tuned in them. */
const TO_MAP = 1 / MESH_SCALE;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mixInto = (a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: number[]) => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
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

const ground: number[] = [0, 0, 0];
const forest: number[] = [0, 0, 0];
const rock: number[] = [0, 0, 0];

/**
 * Writes the linear RGB of a land facet into out[at..at+2]: by its height in metres, its unit normal (nx, ny, nz; y up)
 * for the baked light of the map's fixed sun (-0.55, 0.62, -0.55) and a sky ambient, and its world position (x, z) for
 * the patchy variation of fields, woods and rock. The world position is in the campaign scene's units (x = u - 0.5,
 * z = (v - 0.5) / MAP_ASPECT), the same for every caller, so the woods run on across the join of two meshes.
 */
export function faceColor(metres: number, nx: number, ny: number, nz: number, x: number, z: number, out: Float32Array, at: number): void {
  const mx = x * TO_MAP, mz = z * TO_MAP;
  // Three scales of variation: farmland and woods a few kilometres across, fields about one, single stands of trees.
  const broad = noise(mx * 0.55, mz * 0.55, 1);
  const medium = noise(mx * 2.4, mz * 2.4, 2);
  const fine = noise(mx * 9, mz * 9, 3);
  const sx = nx * SHADE_SLOPE, sz = nz * SHADE_SLOPE;
  const len = Math.hypot(sx, ny, sz) || 1;
  const up = ny / len;
  const slope = 1 - up;

  // Lowland: fields of greens and dry yellows, paddies near the water. Hills and high ground: forest.
  mixInto(FIELD_GREEN, FIELD_DRY, smoothstep(0.35, 0.8, medium * 0.7 + fine * 0.3), ground);
  const paddy = (1 - smoothstep(10, 45, metres)) * (1 - smoothstep(0.03, 0.08, slope)) * 0.6;
  mixInto(ground, PADDY, paddy, ground);
  mixInto(FOREST_DARK, FOREST_LIGHT, fine * 0.6 + medium * 0.4, forest);
  const woody = Math.max(smoothstep(0.42, 0.7, broad * 0.7 + medium * 0.3), smoothstep(70, 260, metres) * smoothstep(0.02, 0.1, slope + broad * 0.1));
  mixInto(ground, forest, woody, ground);

  // Steep faces and the high ridges are bare rock, paler the higher they stand (Jirisan reaches about 1900 m).
  const bare = Math.max(smoothstep(0.2, 0.42, slope), smoothstep(800, 1600, metres) * 0.85);
  mixInto(ROCK_LOW, ROCK_HIGH, Math.min(1, smoothstep(600, 1800, metres) + fine * 0.3), rock);
  mixInto(ground, rock, bare, ground);

  // Pale sand where the land meets the sea, except on the cliffs.
  const beach = (1 - smoothstep(1, 5, metres)) * (1 - smoothstep(0.12, 0.3, slope)) * (0.65 + 0.35 * medium);
  mixInto(ground, SAND, beach, ground);

  const sun = Math.max(0, (nx * SHADE_SLOPE * SUN_X + ny * SUN_Y + nz * SHADE_SLOPE * SUN_Z) / len);
  // A slight tint of its own on every facet, so a wide plain or slope does not read as one flat sheet.
  const jitter = hash(Math.floor(mx * 40), Math.floor(mz * 40), 4) - 0.5;
  const light = (AMBIENT + DIRECT * sun) * (1 + jitter * 0.08);
  out[at] = ground[0]! * light * (1 + jitter * 0.04);
  out[at + 1] = ground[1]! * light;
  out[at + 2] = ground[2]! * light * (1 - jitter * 0.04);
}
