import { BufferAttribute, BufferGeometry, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import meta from '../../select/demMeta.json';
import { demHeightAtUV, V_SCALE } from '../../select/demFrame';
import { freeAfterDraw } from '../../render/dispose';
import { faceColor } from './groundPalette';
import { DEM_RECT, MESH_SCALE } from './mapMath';
import { MAP_ASPECT } from './projection';

// The Korean mainland north of the DEM, out to the horizon, so the world has no edge where the DEM ends: flat facets
// coloured by the DEM's own palette (groundPalette.ts), coarser the farther north they lie, until the haze takes them.
// Next to the DEM's north edge the relief is the DEM's own north band mirrored, so ridges and valleys run on across the
// join at the same height; within about thirty kilometres hills take over between a west and an east coast that start
// where the DEM's own coasts meet its edge. Its south row is the north edge of the DEM's facets (groundLand.ts), vertex
// for vertex, so the two meet without a step or a gap. The sea's shallows (groundSea.ts) read the same relief.

/** Frame units of height per metre, the same as the DEM's facets. */
const UNIT = V_SCALE * MESH_SCALE;
/** World z of the DEM's north edge, where the far land starts. */
const NORTH_Z = (DEM_RECT.v - 0.5) / MAP_ASPECT;
/** How far north the land runs, in world units: its end is lost in the fog from the farthest the camera may stand. */
const DEPTH = 9;
/** The land's east-west span in frame u: from the DEM's west edge to past the peninsula's east coast, where it is sea. */
const U0 = DEM_RECT.u, U1 = 0.93;
/**
 * Rows of vertices: the first this far north of the join (about four DEM texels, as fine as the DEM's facets there), each
 * farther one deeper than the last by GROWTH. A row's columns are WIDE times its depth apart, at least MIN_COLUMNS.
 */
const FIRST_ROW = 0.0013, GROWTH = 1.05, WIDE = 1.15, MIN_COLUMNS = 24;
/**
 * The mirrored DEM is sheared east as it goes north, by this many DEM widths per DEM height, so the band past the edge
 * is not a recognisable reflection of the mountains south of it (the shear is nothing at the edge itself).
 */
const SHEAR = 0.25;
/** How far north (world units) the mirrored DEM gives way to the hills: from `BLEND[0]` to `BLEND[1]`. */
const BLEND = [0.015, 0.1] as const;
/** As the DEM's facets: land stands at least LAND_MIN metres above the sea plane and the sea floor lies 3 to 40 m under it. */
const LAND_MIN = 1.5, SEA_MIN = 3, SEA_MAX = 40;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A cheap deterministic hash of two integers into 0..1. */
function hash(a: number, b: number) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A smooth hash noise in [0, 1], value noise on a grid with a smoothstep blend. */
function noise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/**
 * Ridged hills, in metres: sharp crests and soft valleys a few kilometres apart, in ranges and basins tens of kilometres
 * across, as the country north of the coast is (most of it under 500 m, ridges to about 1500 m). `cell` is the spacing of
 * the vertices that sample it: an octave less than about six of them across would only break the facets into a speckle
 * of light and shade, so it gives way to its mean.
 */
function hills(x: number, z: number, cell: number) {
  let sum = 0, amp = 1, freq = 34, norm = 0;
  for (let i = 0; i < 4; i += 1) {
    const keep = smooth(0.25, 0.125, cell * freq);
    const n = keep > 0 ? 1 - Math.abs(noise(x * freq + i * 17.3, z * freq - i * 9.1) * 2 - 1) : 0;
    sum += (keep * n * n + (1 - keep) * 0.4) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  const range = noise(x * 5 + 3.1, z * 5 - 7.7);
  // Valleys run down near sea level, as the DEM's do, so fields fill them and woods the slopes.
  return (sum / norm) ** 2.1 * (300 + 1500 * range * range) + 8;
}

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

/**
 * The DEM's north band under a 5 x 5 box blur, sampled bilinearly at (lu, lv) of the DEM: the mirror reads it, so vertices
 * kilometres apart sample the land's shape and not its single texels.
 */
function northBand(heights: Float32Array) {
  const W = meta.width, H = meta.height;
  const rows = Math.min(H, Math.ceil(((BLEND[1] * MAP_ASPECT) / DEM_RECT.h) * (H - 1)) + 4);
  const across = new Float32Array(W * rows), band = new Float32Array(W * rows);
  const R = 2, span = 2 * R + 1;
  for (let y = 0; y < rows; y += 1) {
    const row = y * W;
    let sum = 0;
    for (let k = -R; k <= R; k += 1) sum += heights[row + Math.max(0, k)]!;
    for (let x = 0; x < W; x += 1) {
      across[row + x] = sum / span;
      sum += heights[row + Math.min(W - 1, x + R + 1)]! - heights[row + Math.max(0, x - R)]!;
    }
  }
  // Down the columns a row at a time, with a running sum for each column, so the memory is read in order.
  const column = new Float32Array(W);
  for (let k = -R; k <= R; k += 1) {
    const row = Math.min(rows - 1, Math.max(0, k)) * W;
    for (let x = 0; x < W; x += 1) column[x] += across[row + x]!;
  }
  for (let y = 0; y < rows; y += 1) {
    const add = Math.min(rows - 1, y + R + 1) * W, drop = Math.max(0, y - R) * W, row = y * W;
    for (let x = 0; x < W; x += 1) {
      band[row + x] = column[x]! / span;
      column[x] += across[add + x]! - across[drop + x]!;
    }
  }
  return (lu: number, lv: number) => {
    const x = Math.max(0, Math.min(W - 1.001, lu * (W - 1))), y = Math.max(0, Math.min(rows - 1.001, lv * (H - 1)));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * W + x0;
    const top = band[i]! + (band[i + 1]! - band[i]!) * fx;
    const bottom = band[i + W]! + (band[i + W + 1]! - band[i + W]!) * fx;
    return top + (bottom - top) * fy;
  };
}

/** The far land's height in metres (below 0 is sea) at frame u and world z north of the DEM, for vertices `cell` apart. */
export type FarRelief = (u: number, z: number, cell: number) => number;

const reliefs = new WeakMap<Float32Array, FarRelief>();

/**
 * The relief north of the DEM, made once per set of DEM heights: its mesh and the sea's shallows (groundSea.ts) both read
 * it, so the drawn coasts and the water beside them agree.
 */
export function farRelief(heights: Float32Array): FarRelief {
  const known = reliefs.get(heights);
  if (known) return known;
  const coasts = seamCoasts(heights);
  const band = northBand(heights);
  // Callers walk the land a row at a time: the coasts of the last row asked for are kept.
  let rowZ = Number.NaN, west = 0, east = 0;
  const relief: FarRelief = (u, z, cell) => {
    const north = NORTH_Z - z;
    if (z !== rowZ) {
      rowZ = z;
      // The coasts start where the DEM's do and settle on the peninsula's, the west near 126.4 E, the east near 129.4 E.
      const settle = smooth(0, 0.8, north);
      west = coasts.west + (0.28 - coasts.west) * settle + wander(z, 4.2, 0.07) * settle - Math.max(0, north) * 0.006;
      east = coasts.east + (0.835 - coasts.east) * settle + wander(z, 9.7, 0.045) * settle;
    }
    // The DEM's own height mirrored (and sheared) north of its edge; sea outside its sides.
    const lv = Math.min(1, (Math.abs(north) * MAP_ASPECT) / DEM_RECT.h);
    const lu = (u - DEM_RECT.u) / DEM_RECT.w - (north > 0 ? lv * SHEAR : 0);
    const inside = lu >= 0 && lu <= 1;
    const t = inside ? smooth(BLEND[0], BLEND[1], north) : 1;
    const mirrored = inside ? band(lu, lv) : -60;
    if (t === 0) return mirrored;
    const land = smooth(west - 0.012, west + 0.02, u) * smooth(east + 0.012, east - 0.02, u);
    const far = land > 0 ? hills(u - 0.5, z, cell) * land - 80 * (1 - land) : -80;
    return mirrored + (far - mirrored) * t;
  };
  reliefs.set(heights, relief);
  return relief;
}

/** The spacing of the far land's vertices `north` world units north of the DEM's edge: its rows deepen as they go. */
export const farCell = (north: number) => (FIRST_ROW + Math.max(0, north) * (GROWTH - 1)) * WIDE;

/** A height as the facets draw it: land a little above the sea plane at least, the sea floor a little under it. */
const drawn = (metres: number) => (metres > 0 ? Math.max(LAND_MIN, metres) : -Math.min(SEA_MAX, Math.max(SEA_MIN, -metres)));

interface Row {
  /** World units north of the DEM's edge. */
  north: number;
  u: Float32Array;
  metres: Float32Array;
}

/** A row's height in metres at frame u, linear between its vertices. */
function rowAt(row: Row, u: number) {
  const n = row.u.length - 1;
  if (u <= row.u[0]! || u >= row.u[n]!) return u <= row.u[0]! ? row.metres[0]! : row.metres[n]!;
  let i = 0, hi = n;
  while (hi - i > 1) {
    const mid = (i + hi) >> 1;
    if (row.u[mid]! <= u) i = mid;
    else hi = mid;
  }
  const t = (u - row.u[i]!) / (row.u[i + 1]! - row.u[i]! || 1);
  return row.metres[i]! + (row.metres[i + 1]! - row.metres[i]!) * t;
}

/**
 * The far land's mesh in world units (x east, y up, z south). `heights` are the DEM's metres; `seam` is every vertex on
 * the north edge of the DEM's facets, west to east: its frame u and its height in metres.
 */
export function buildFarLandMesh(heights: Float32Array, seam: { u: Float32Array; metres: Float32Array }) {
  const relief = farRelief(heights);
  const rows: Row[] = [];
  // The seam, carried on with sea to the far land's own west and east ends where the DEM's facets stop short of them.
  {
    const u: number[] = [], metres: number[] = [];
    const pad = (FIRST_ROW * WIDE) / GROWTH;
    for (let x = U0; x < seam.u[0]! - pad * 0.5; x += pad) { u.push(x); metres.push(drawn(relief(x, NORTH_Z, pad))); }
    for (let i = 0; i < seam.u.length; i += 1) { u.push(seam.u[i]!); metres.push(seam.metres[i]!); }
    const last = seam.u[seam.u.length - 1]!;
    const extra = Math.ceil((U1 - last) / pad);
    for (let k = 1; k <= extra; k += 1) {
      const x = last + ((U1 - last) * k) / extra;
      u.push(x);
      metres.push(drawn(relief(x, NORTH_Z, pad)));
    }
    rows.push({ north: 0, u: Float32Array.from(u), metres: Float32Array.from(metres) });
  }
  for (let north = 0, step = FIRST_ROW; north < DEPTH; step *= GROWTH) {
    north = Math.min(DEPTH, north + step);
    const z = NORTH_Z - north;
    const columns = Math.max(MIN_COLUMNS, Math.round((U1 - U0) / (step * WIDE)));
    const cell = (U1 - U0) / columns;
    const u = new Float32Array(columns + 1), metres = new Float32Array(columns + 1);
    for (let i = 0; i <= columns; i += 1) {
      // Every vertex but the two ends strays a little east or west, so the facets do not line up as a grid.
      u[i] = U0 + cell * (i + (i > 0 && i < columns ? (hash(i, rows.length) - 0.5) * 0.7 : 0));
      metres[i] = drawn(relief(u[i]!, z, cell));
    }
    rows.push({ north, u, metres });
  }

  // Zip each row to the next, west to east, always advancing on the side whose next vertex lies farther west. Triangles
  // wholly under water are left out: the opaque sea plane covers them.
  const triangles: number[] = [];
  const offsets: number[] = [];
  let vertices = 0;
  for (const row of rows) {
    offsets.push(vertices);
    vertices += row.u.length;
  }
  for (let r = 0; r + 1 < rows.length; r += 1) {
    const a = rows[r]!, b = rows[r + 1]!, oa = offsets[r]!, ob = offsets[r + 1]!;
    let i = 0, k = 0;
    const na = a.u.length - 1, nb = b.u.length - 1;
    while (i < na || k < nb) {
      const stepA = i < na && (k >= nb || a.u[i + 1]! <= b.u[k + 1]!);
      const third = stepA ? [oa + i + 1, a.metres[i + 1]!] : [ob + k + 1, b.metres[k + 1]!];
      if (a.metres[i]! > 0 || b.metres[k]! > 0 || third[1]! > 0) triangles.push(oa + i, third[0]!, ob + k);
      if (stepA) i += 1;
      else k += 1;
    }
  }

  const world = new Float32Array(vertices * 3), metres = new Float32Array(vertices);
  rows.forEach((row, r) => {
    const z = NORTH_Z - row.north;
    for (let i = 0; i < row.u.length; i += 1) {
      const v = offsets[r]! + i;
      metres[v] = row.metres[i]!;
      world[v * 3] = row.u[i]! - 0.5;
      world[v * 3 + 1] = row.metres[i]! * UNIT;
      world[v * 3 + 2] = z;
    }
  });

  // One colour per facet, by the DEM's palette: three vertices of their own each, so nothing is interpolated across it.
  const count = triangles.length / 3;
  const sample = new Float32Array(3);
  const position = new Float32Array(count * 9);
  const color = new Float32Array(count * 9);
  for (let t = 0; t < count; t += 1) {
    const a = triangles[t * 3]!;
    let b = triangles[t * 3 + 1]!, c = triangles[t * 3 + 2]!;
    const ux = world[b * 3]! - world[a * 3]!, uy = world[b * 3 + 1]! - world[a * 3 + 1]!, uz = world[b * 3 + 2]! - world[a * 3 + 2]!;
    const vx = world[c * 3]! - world[a * 3]!, vy = world[c * 3 + 1]! - world[a * 3 + 1]!, vz = world[c * 3 + 2]! - world[a * 3 + 2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    // Front faces look up: three.js takes a counter-clockwise triangle as facing the viewer.
    if (ny < 0) {
      [b, c] = [c, b];
      nx = -nx; ny = -ny; nz = -nz;
    }
    const length = Math.hypot(nx, ny, nz) || 1;
    const o = t * 9;
    for (const [k, v] of [[0, a], [3, b], [6, c]] as const) {
      position[o + k] = world[v * 3]!;
      position[o + k + 1] = world[v * 3 + 1]!;
      position[o + k + 2] = world[v * 3 + 2]!;
    }
    const height = (Math.max(0, metres[a]!) + Math.max(0, metres[b]!) + Math.max(0, metres[c]!)) / 3;
    const cx = (position[o]! + position[o + 3]! + position[o + 6]!) / 3, cz = (position[o + 2]! + position[o + 5]! + position[o + 8]!) / 3;
    const n = [nx / length, ny / length, nz / length] as const;
    faceColor(height, n[0], n[1], n[2], cx, cz, color, o);
    // The palette's patches of field and wood are a few kilometres across: a facet much larger than that would take a
    // random one of them and the far land would read as a quilt. It takes the mean of the ground it covers instead,
    // sampled halfway to each corner; facets as small as the DEM's near the join keep their own colour as the DEM's do.
    const spread = smooth(0.003, 0.012, Math.max(Math.abs(position[o]! - position[o + 3]!), Math.abs(position[o]! - position[o + 6]!), Math.abs(position[o + 2]! - position[o + 5]!), Math.abs(position[o + 2]! - position[o + 8]!)));
    if (spread > 0) {
      let r = color[o]!, g = color[o + 1]!, bl = color[o + 2]!;
      for (const k of [0, 3, 6]) {
        faceColor(height, n[0], n[1], n[2], (cx + position[o + k]!) / 2, (cz + position[o + k + 2]!) / 2, sample, 0);
        r += sample[0]!; g += sample[1]!; bl += sample[2]!;
      }
      color[o] += (r / 4 - color[o]!) * spread;
      color[o + 1] += (g / 4 - color[o + 1]!) * spread;
      color[o + 2] += (bl / 4 - color[o + 2]!) * spread;
    }
    color.copyWithin(o + 3, o, o + 3);
    color.copyWithin(o + 6, o, o + 3);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  // Culled by its bounds, which must be known before the first draw frees the arrays.
  geometry.computeBoundingSphere();
  const material = new MeshBasicNodeMaterial({ vertexColors: true });
  const mesh = new Mesh(geometry, material);
  freeAfterDraw(mesh);

  const north = rows.map((row) => row.north);
  return {
    mesh,
    /** Ground height in frame units at a frame point north of the DEM (0 on the water), for the trees. */
    heightAt(u: number, v: number) {
      const d = NORTH_Z - (v - 0.5) / MAP_ASPECT;
      if (u < U0 || u > U1 || d < 0 || d >= DEPTH) return 0;
      let lo = 0, hi = north.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (north[mid]! <= d) lo = mid;
        else hi = mid;
      }
      const t = (d - north[lo]!) / (north[hi]! - north[lo]!);
      const h = rowAt(rows[lo]!, u) * (1 - t) + rowAt(rows[hi]!, u) * t;
      return Math.max(0, h) * UNIT;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
}
