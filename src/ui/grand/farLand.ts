import { demHeightAtUV, V_SCALE } from '../../select/demFrame';
import { DEM_RECT, MESH_SCALE } from './mapMath';
import { MAP_ASPECT } from './projection';

// The Korean mainland north of the DEM, out to the horizon: a coarse relief of hills that carries the DEM's last row of
// land on into the haze, between a west and an east coast, so the world has no edge where the terrain rectangle ends.
// Pure TS (no three.js): it returns the mesh's arrays, which MapScene draws with vertex colours under the scene's fog.

/** Frame units of height per metre, the same as the terrain's. */
const UNIT = V_SCALE * MESH_SCALE;
/** World z of the DEM's north edge; the land runs from a little inside it to this far north of it. */
const NORTH_Z = (DEM_RECT.v - 0.5) / MAP_ASPECT;
const DEPTH = 6;
const OVERLAP = 0.012;
/** The land's east-west span in frame u: past the peninsula's coasts on both sides, where it is sea. */
const U0 = 0.2, U1 = 0.93;
const COLUMNS = 400, ROWS = 480;

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
  return (sum / norm) ** 1.4 * (250 + 1300 * range * range) + 15;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const srgb = (r: number, g: number, b: number): [number, number, number] => [linear(r / 255), linear(g / 255), linear(b / 255)];
const GRASS = srgb(122, 146, 84), FOREST = srgb(44, 80, 50), ROCK = srgb(124, 114, 100), SAND = srgb(196, 178, 138);
const mix3 = (a: number[], b: number[], t: number) => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];

/**
 * The far land's mesh in world units (x east, y up, z south): positions, linear vertex colours and the index. `heights`
 * are the DEM's metres: next to the seam the relief is the DEM's own north band mirrored, so ridges and valleys run on
 * across it, and hills take over from it within about twenty kilometres.
 */
export function buildFarLand(heights: Float32Array) {
  const position = new Float32Array((COLUMNS + 1) * (ROWS + 1) * 3);
  const color = new Float32Array(position.length);
  const metres = new Float32Array((COLUMNS + 1) * (ROWS + 1));
  // Rows close together at the seam, where the DEM's detail has to carry on, and wide apart in the haze.
  const rowZ = (j: number) => NORTH_Z + OVERLAP - (OVERLAP + DEPTH) * (j / ROWS) ** 2.6;
  for (let j = 0; j <= ROWS; j += 1) {
    const z = rowZ(j);
    const north = NORTH_Z - z;
    for (let i = 0; i <= COLUMNS; i += 1) {
      const u = U0 + ((U1 - U0) * i) / COLUMNS;
      const x = u - 0.5;
      const lu = (u - DEM_RECT.u) / DEM_RECT.w;
      // The DEM's own height inside it while the two overlap, mirrored north of its edge (sea outside its sides).
      const lv = Math.min(1, Math.abs(z - NORTH_Z) * MAP_ASPECT / DEM_RECT.h);
      const mirrored = lu < 0 || lu > 1 ? -60 : demHeightAtUV(heights, lu, lv);
      // The peninsula between its coasts: the west coast near 126.4 E wanders a little, the east coast stays near 129.4 E.
      const west = 0.28 + (noise(z * 3, 4.2) - 0.5) * 0.05 - north * 0.006;
      const east = 0.835 + (noise(z * 3, 9.7) - 0.5) * 0.03;
      const land = smoothstep(west - 0.012, west + 0.02, u) * smoothstep(east + 0.012, east - 0.02, u);
      const far = hills(x, z) * land - 80 * (1 - land);
      const h = mirrored + (far - mirrored) * smoothstep(0.02, 0.16, north);
      const k = j * (COLUMNS + 1) + i;
      metres[k] = h;
      // Where it overlaps the DEM it lies a hair under it, so the terrain's own surface shows there.
      const under = north < 0 ? 0.0003 : 0;
      position[k * 3] = x;
      // Water lies well under the sea plane, which draws it; land stands on the relief's own scale.
      position[k * 3 + 1] = (h > 0 ? h * UNIT : Math.min(h * UNIT, -0.0012)) - under;
      position[k * 3 + 2] = z;
    }
  }
  // Colour by height and the sun on the slope, in the terrain's palette: beaches, fields and woods, bare ridges.
  const at = (i: number, j: number) => metres[Math.min(ROWS, Math.max(0, j)) * (COLUMNS + 1) + Math.min(COLUMNS, Math.max(0, i))]!;
  const cell = ((U1 - U0) / COLUMNS) / UNIT;
  for (let j = 0; j <= ROWS; j += 1) {
    const dz = (rowZ(Math.max(0, j - 1)) - rowZ(Math.min(ROWS, j + 1))) / UNIT || 1;
    for (let i = 0; i <= COLUMNS; i += 1) {
      const h = at(i, j);
      // The slope as drawn (the relief's own exaggeration), a little steepened so the hills keep their shading in the haze.
      const gx = ((at(i + 1, j) - at(i - 1, j)) / (2 * cell)) * 2.5, gz = ((at(i, j - 1) - at(i, j + 1)) / dz) * 2.5;
      const n = [-gx, 1, -gz];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!);
      const sun = Math.max(0, (n[0]! * -0.55 + n[1]! * 0.62 + n[2]! * -0.55) / len / 0.98);
      const slope = 1 - 1 / len;
      const x = U0 + ((U1 - U0) * i) / COLUMNS - 0.5, z = rowZ(j);
      // Woods and fields at the terrain's broad scale (0.7 cycles per map unit, about 104 per frame unit) and a wider one.
      const woods = smoothstep(0.25, 0.55, noise(x * 104, z * 104) * 0.7 + noise(x * 40, z * 40) * 0.3);
      let c = mix3(GRASS, FOREST, Math.max(woods, smoothstep(40, 180, h)));
      c = mix3(c, ROCK, Math.max(smoothstep(0.2, 0.45, slope), smoothstep(800, 1300, h) * 0.7));
      c = mix3(c, SAND, 1 - smoothstep(1, 12, h));
      const light = 0.5 + 0.65 * sun;
      const k = (j * (COLUMNS + 1) + i) * 3;
      color[k] = c[0]! * light;
      color[k + 1] = c[1]! * light;
      color[k + 2] = c[2]! * light;
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
  return { position, color, index };
}
