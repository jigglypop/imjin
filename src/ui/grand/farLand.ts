import { BufferAttribute, BufferGeometry, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import meta from '../../select/demMeta.json';
import { demHeightAtUV, V_SCALE } from '../../select/demFrame';
import { freeAfterDraw } from '../../render/dispose';
import { vertexLight } from './landBake';
import { DEM_RECT, MESH_SCALE } from './mapMath';
import { MAP_ASPECT } from './projection';

// The Korean mainland north of the DEM, out to the horizon, so the world has no edge where the DEM ends: flat facets
// coloured by the DEM's own palette (groundPalette.ts), coarser the farther north they lie, until the haze takes them.
// Next to the DEM's north edge the relief is the DEM's own north band mirrored, so ridges and valleys run on across the
// join at the same height; within about thirty kilometres hills take over between a west and an east coast that start
// where the DEM's own coasts meet its edge. Its south row is the north edge of the DEM's facets (groundLand.ts), vertex
// for vertex, so the two meet without a step or a gap. Its vertices are scattered rows, triangulated and then flipped
// until the triangulation is Delaunay, so its facets lie every which way as the DEM's do instead of in strips.

/** Frame units of height per metre, the same as the DEM's facets. */
const UNIT = V_SCALE * MESH_SCALE;
/** World z of the DEM's north edge, where the far land starts. */
const NORTH_Z = (DEM_RECT.v - 0.5) / MAP_ASPECT;
/** How far north the land runs, in world units: past the farthest any view sees through the fog (worldGround.ts). */
export const FAR_DEPTH = 6;
/** The land's east-west span in frame u: from the DEM's west edge to past the peninsula's east coast, where it is sea. */
const U0 = DEM_RECT.u, U1 = 0.93;
/**
 * Vertices `north` world units north of the join stand about SPACING * (north + REACH) apart: near the join about as
 * close as the DEM's own facets there, and farther off in step with the distance, so from a camera near the join a
 * facet keeps about the same size on the screen however far north it lies.
 */
const SPACING = 0.017, REACH = 0.25;
/** No row has fewer columns than this. */
const MIN_COLUMNS = 24;
/** Every vertex but the seam's strays up to this share of its spacing east or west, and north or south. */
const STRAY_U = 0.35, STRAY_NORTH = 0.27;
/**
 * The mirrored DEM is sheared east as it goes north, by this many DEM widths per DEM height, so the band past the edge
 * is not a recognisable reflection of the mountains south of it (the shear is nothing at the edge itself).
 */
const SHEAR = 0.25;
/** How far north (world units) the mirrored DEM gives way to the hills: from `BLEND[0]` to `BLEND[1]`. */
const BLEND = [0.015, 0.1] as const;
/** Rows of the DEM, down from its north edge, whose hills the far land carries on: its northern part, nearly all land. */
const HILL_ROWS = 460;
/** The share of the DEM's width at either side that the carried-on hills turn back short of: mostly sea and islands. */
const HILL_SIDE = 0.12;
/** Metres of the low ground the carried-on hills put where those rows hold a bay or a river mouth. */
const HILL_FLOOR = 14;
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
 * The DEM's northern HILL_ROWS rows as relief that reads well at any vertex spacing: a pyramid of box-filtered levels,
 * each half the size of the one before, read bilinearly at the level whose texels are half the spacing wide and blended
 * with the next. A vertex kilometres from its neighbours so reads the land's shape round it, not a single texel's bump.
 * Coordinates are the DEM's texels (x east, y south from its north edge).
 */
function hillPyramid(heights: Float32Array) {
  let w = meta.width, h = HILL_ROWS;
  let data = heights.slice(0, w * h);
  const levels = [{ w, h, data }];
  while (w > 16 && h > 4) {
    const nw = w >> 1, nh = h >> 1, next = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y += 1) {
      for (let x = 0; x < nw; x += 1) {
        const k = 2 * y * w + 2 * x;
        next[y * nw + x] = (data[k]! + data[k + 1]! + data[k + w]! + data[k + w + 1]!) / 4;
      }
    }
    w = nw;
    h = nh;
    data = next;
    levels.push({ w, h, data });
  }
  const read = (level: (typeof levels)[number], x: number, y: number) => {
    const fx = Math.max(0, Math.min(level.w - 1.001, x)), fy = Math.max(0, Math.min(level.h - 1.001, y));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, i = y0 * level.w + x0, d = level.data;
    const top = d[i]! + (d[i + 1]! - d[i]!) * tx;
    const bottom = d[i + level.w]! + (d[i + level.w + 1]! - d[i + level.w]!) * tx;
    return top + (bottom - top) * ty;
  };
  /** A texel of level k is 2^k of the first level's: (x + 0.5) / 2^k - 0.5 is the same point on it. */
  const at = (k: number, x: number, y: number) => read(levels[k]!, (x + 0.5) / 2 ** k - 0.5, (y + 0.5) / 2 ** k - 0.5);
  const texel = DEM_RECT.w / (meta.width - 1);
  return (x: number, y: number, cell: number) => {
    const lod = Math.max(0, Math.min(levels.length - 1, Math.log2(cell / (2 * texel))));
    const k = Math.floor(lod), f = lod - k;
    const near = at(k, x, y);
    return f > 0 ? near + (at(k + 1, x, y) - near) * f : near;
  };
}

/** `t` folded back and forth between 0 and `span`, as a mirror would: 0 to span, back to 0, and on. */
const pingPong = (t: number, span: number) => {
  const m = ((t % (2 * span)) + 2 * span) % (2 * span);
  return m <= span ? m : 2 * span - m;
};

/** The relief north of the DEM in metres (below 0 is sea) at frame u, `north` world units past its edge, for vertices `cell` apart. */
function farRelief(heights: Float32Array) {
  const coasts = seamCoasts(heights);
  const hills = hillPyramid(heights);
  const W = meta.width, H = meta.height;
  /** DEM rows per world unit north. */
  const rowsPerUnit = ((H - 1) * MAP_ASPECT) / DEM_RECT.h;
  return (u: number, north: number, cell: number) => {
    const z = NORTH_Z - north;
    // The coasts start where the DEM's do and settle on the peninsula's, the west near 126.4 E, the east near 129.4 E.
    const settle = smooth(0, 0.8, north);
    const west = coasts.west + (0.28 - coasts.west) * settle + wander(z, 4.2, 0.07) * settle - Math.max(0, north) * 0.006;
    const east = coasts.east + (0.835 - coasts.east) * settle + wander(z, 9.7, 0.045) * settle;
    // The DEM's own north band mirrored north of its edge, sheared so it is no recognisable reflection; sea outside its sides.
    const rows = Math.max(0, north) * rowsPerUnit;
    const lu = (u - DEM_RECT.u) / DEM_RECT.w - (rows / (H - 1)) * SHEAR;
    const inside = lu >= 0 && lu <= 1;
    const t = inside ? smooth(BLEND[0], BLEND[1], north) : 1;
    const mirrored = inside ? hills(lu * (W - 1), rows, cell) : -60;
    if (t === 0) return mirrored;
    // Farther north the same hills carry on between the far land's own coasts, mirrored back and forth between the
    // DEM's edge and HILL_ROWS down and turning back short of its sides, where it is mostly sea; its bays read as low ground.
    const land = smooth(west - 0.012, west + 0.02, u) * smooth(east + 0.012, east - 0.02, u);
    let far = -80;
    if (land > 0) {
      const across = HILL_SIDE + pingPong(lu - HILL_SIDE, 1 - 2 * HILL_SIDE);
      const hill = Math.max(HILL_FLOOR, hills(across * (W - 1), pingPong(rows, HILL_ROWS - 1), cell));
      far = hill * land - 80 * (1 - land);
    }
    return mirrored + (far - mirrored) * t;
  };
}

/** A height as the facets draw it: land a little above the sea plane at least, the sea floor a little under it. */
const drawn = (metres: number) => (metres > 0 ? Math.max(LAND_MIN, metres) : -Math.min(SEA_MAX, Math.max(SEA_MIN, -metres)));

/** The spacing of the far land's vertices `north` world units north of the DEM's edge. */
const spacing = (north: number) => SPACING * (Math.max(0, north) + REACH);

/** Twice the signed area of (a, b, c) in the plane of u and north: positive when they run counter-clockwise seen from above. */
const orient = (au: number, an: number, bu: number, bn: number, cu: number, cn: number) => (bu - au) * (cn - an) - (bn - an) * (cu - au);

/** Whether d lies inside the circle through the counter-clockwise triangle (a, b, c), by more than rounding. */
function inCircle(au: number, an: number, bu: number, bn: number, cu: number, cn: number, du: number, dn: number) {
  const adx = au - du, ady = an - dn, bdx = bu - du, bdy = bn - dn, cdx = cu - du, cdy = cn - dn;
  const ad = adx * adx + ady * ady, bd = bdx * bdx + bdy * bdy, cd = cdx * cdx + cdy * cdy;
  const det = ad * (bdx * cdy - cdx * bdy) - bd * (adx * cdy - cdx * ady) + cd * (adx * bdy - bdx * ady);
  return det > 1e-12 * (ad + bd + cd) * (ad + bd + cd);
}

/**
 * Flips edges of a triangulation (counter-clockwise triangles in `tri`) until every edge is Delaunay in the plane of
 * `pu` and `pn`: of the two ways to cut each quadrilateral, the one with the fatter triangles. The outline is kept.
 */
function makeDelaunay(tri: Int32Array, pu: Float64Array, pn: Float64Array) {
  const n = tri.length;
  const next = (e: number) => e - (e % 3) + ((e + 1) % 3);
  const prev = (e: number) => e - (e % 3) + ((e + 2) % 3);
  // The twin of every half-edge, the same edge run the other way in the neighbouring triangle, or -1 on the outline.
  const twin = new Int32Array(n).fill(-1);
  const open = new Map<number, number>();
  const vertices = pu.length;
  for (let e = 0; e < n; e += 1) {
    const a = tri[e]!, b = tri[next(e)]!;
    const other = open.get(b * vertices + a);
    if (other === undefined) open.set(a * vertices + b, e);
    else {
      twin[e] = other;
      twin[other] = e;
      open.delete(b * vertices + a);
    }
  }
  const link = (e: number, f: number) => {
    twin[e] = f;
    if (f >= 0) twin[f] = e;
  };
  const stack: number[] = [];
  for (let e = 0; e < n; e += 1) if (twin[e]! > e) stack.push(e);
  // A cap on the work, so near-cocircular points can never keep two cuts flipping back and forth.
  let budget = n * 8;
  while (stack.length && budget > 0) {
    budget -= 1;
    const e = stack.pop()!;
    const f = twin[e]!;
    if (f < 0) continue;
    // e runs a -> b in (a, b, c); its twin runs b -> a in (b, a, d).
    const a = tri[e]!, b = tri[next(e)]!, c = tri[prev(e)]!, d = tri[prev(f)]!;
    if (!inCircle(pu[a]!, pn[a]!, pu[b]!, pn[b]!, pu[c]!, pn[c]!, pu[d]!, pn[d]!)) continue;
    // The cut a-b becomes c-d: (a, b, c) becomes (a, d, c) and (b, a, d) becomes (b, c, d).
    const outerAD = twin[next(f)]!, outerBC = twin[next(e)]!;
    tri[next(e)] = d;
    tri[next(f)] = c;
    link(e, outerAD);
    link(f, outerBC);
    link(next(e), next(f));
    stack.push(e, prev(e), f, prev(f));
  }
}

/**
 * The far land's mesh in world units (x east, y up, z south). `heights` are the DEM's metres; `seam` is every vertex on
 * the north edge of the DEM's facets, west to east: its frame u and its height in metres.
 */
export function buildFarLandMesh(heights: Float32Array, seam: { u: Float32Array; metres: Float32Array }) {
  const relief = farRelief(heights);
  // Every vertex's place (frame u, world units north of the join), the north of its own row where it would stand
  // without straying, and the spacing of its row; the seam's vertices come with their heights.
  const pu: number[] = [], pn: number[] = [], line: number[] = [], cells: number[] = [], pm: number[] = [];
  const rows: { start: number; count: number }[] = [];
  // The seam, carried on with sea to the far land's own west and east ends where the DEM's facets stop short of them.
  {
    const start = pu.length;
    const pad = spacing(0);
    const add = (u: number, metres: number) => { pu.push(u); pn.push(0); line.push(0); cells.push(pad); pm.push(metres); };
    for (let x = U0; x < seam.u[0]! - pad * 0.5; x += pad) add(x, Number.NaN);
    for (let i = 0; i < seam.u.length; i += 1) add(seam.u[i]!, seam.metres[i]!);
    const last = seam.u[seam.u.length - 1]!;
    const extra = Math.ceil((U1 - last) / pad);
    for (let k = 1; k <= extra; k += 1) add(last + ((U1 - last) * k) / extra, Number.NaN);
    rows.push({ start, count: pu.length - start });
  }
  for (let north = 0; north < FAR_DEPTH; ) {
    const step = spacing(north);
    north = Math.min(FAR_DEPTH, north + step);
    const columns = Math.max(MIN_COLUMNS, Math.round((U1 - U0) / step));
    const cell = (U1 - U0) / columns;
    // The last row stays straight; the others stray north or south by less than half the gap to their neighbours.
    const stray = north < FAR_DEPTH ? STRAY_NORTH * Math.min(step, spacing(north)) : 0;
    const start = pu.length, r = rows.length;
    for (let i = 0; i <= columns; i += 1) {
      const end = i === 0 || i === columns;
      pu.push(U0 + cell * (i + (end ? 0 : (hash(i, r) - 0.5) * 2 * STRAY_U)));
      pn.push(north + (end ? 0 : (hash(i + 7919, r) - 0.5) * 2 * stray));
      line.push(north);
      cells.push(cell);
      pm.push(Number.NaN);
    }
    rows.push({ start, count: columns + 1 });
  }

  // Zip each row to the next, west to east, always advancing on the side whose next vertex lies farther west; then flip
  // to Delaunay. Triangles wholly under water are left out afterwards: the opaque sea plane covers them.
  const zipped: number[] = [];
  for (let r = 0; r + 1 < rows.length; r += 1) {
    const a = rows[r]!, b = rows[r + 1]!;
    let i = 0, k = 0;
    const na = a.count - 1, nb = b.count - 1;
    while (i < na || k < nb) {
      const stepA = i < na && (k >= nb || pu[a.start + i + 1]! <= pu[b.start + k + 1]!);
      zipped.push(a.start + i, stepA ? a.start + i + 1 : b.start + k + 1, b.start + k);
      if (stepA) i += 1;
      else k += 1;
    }
  }
  const tri = Int32Array.from(zipped);
  const U = Float64Array.from(pu), N = Float64Array.from(pn);
  // A vertex that strays north or south can fold a zipped triangle over its neighbour. The corners of a folded one go
  // back onto their rows, where a zip never folds, until none is left: the flips need a triangulation without folds.
  for (let folded = true; folded; ) {
    folded = false;
    for (let t = 0; t < tri.length; t += 3) {
      const a = tri[t]!, b = tri[t + 1]!, c = tri[t + 2]!;
      if (orient(U[a]!, N[a]!, U[b]!, N[b]!, U[c]!, N[c]!) > 0) continue;
      for (const v of [a, b, c]) {
        folded ||= N[v] !== line[v];
        N[v] = line[v]!;
      }
    }
  }
  for (let v = 0; v < N.length; v += 1) {
    pn[v] = N[v]!;
    if (Number.isNaN(pm[v])) pm[v] = drawn(relief(pu[v]!, pn[v]!, cells[v]!));
  }
  makeDelaunay(tri, U, N);
  const kept: number[] = [];
  for (let t = 0; t < tri.length; t += 3) if (pm[tri[t]!]! > 0 || pm[tri[t + 1]!]! > 0 || pm[tri[t + 2]!]! > 0) kept.push(tri[t]!, tri[t + 1]!, tri[t + 2]!);

  const vertices = pu.length;
  const world = new Float32Array(vertices * 3);
  for (let v = 0; v < vertices; v += 1) {
    world[v * 3] = pu[v]! - 0.5;
    world[v * 3 + 1] = pm[v]! * UNIT;
    world[v * 3 + 2] = NORTH_Z - pn[v]!;
  }
  // The facets share their vertices and are drawn with the land's look (landLook.ts) like the DEM's, lit by smooth
  // normals: each vertex carries the light it gets, its slope and its height, as the DEM's bake would give them.
  const normals = new Float64Array(vertices * 3);
  const count = kept.length / 3;
  const facets = new Float32Array(count * 9);
  for (let t = 0; t < count; t += 1) {
    const a = kept[t * 3]!, b = kept[t * 3 + 1]!, c = kept[t * 3 + 2]!;
    const ux = world[b * 3]! - world[a * 3]!, uy = world[b * 3 + 1]! - world[a * 3 + 1]!, uz = world[b * 3 + 2]! - world[a * 3 + 2]!;
    const vx = world[c * 3]! - world[a * 3]!, vy = world[c * 3 + 1]! - world[a * 3 + 1]!, vz = world[c * 3 + 2]! - world[a * 3 + 2]!;
    // The cross product's length is twice the facet's area: bigger facets weigh more in the normals round them.
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const o = t * 9;
    for (const [k, v] of [[0, a], [3, b], [6, c]] as const) {
      facets[o + k] = world[v * 3]!;
      facets[o + k + 1] = world[v * 3 + 1]!;
      facets[o + k + 2] = world[v * 3 + 2]!;
      normals[v * 3] += nx; normals[v * 3 + 1] += ny; normals[v * 3 + 2] += nz;
    }
  }
  const land = new Float32Array(vertices * 4);
  for (let v = 0; v < vertices; v += 1) {
    const ny = Math.max(1e-6, normals[v * 3 + 1]!);
    const gx = -normals[v * 3]! / ny, gz = -normals[v * 3 + 2]! / ny;
    land.set(vertexLight(gx, gz, Math.max(0, pm[v]!)), v * 4);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(world, 3));
  geometry.setAttribute('land', new BufferAttribute(land, 4));
  geometry.setIndex(kept);
  // Culled by its bounds, which must be known before the first draw frees the arrays.
  geometry.computeBoundingSphere();
  // Its colour is the land's look, which the ground gives it once the look has loaded.
  const material = new MeshBasicNodeMaterial();
  const mesh = new Mesh(geometry, material);
  freeAfterDraw(mesh);

  const lookup = triangleLookup(kept, U, N);
  return {
    mesh,
    /** The drawn facets, nine floats each (x, y, z of three corners, y in frame units), for the sea to bake its coasts from before the first draw frees them (freeAfterDraw). */
    facets,
    /** Ground height in frame units at a frame point north of the DEM (0 on the water), for the trees. */
    heightAt(u: number, v: number) {
      const north = NORTH_Z - (v - 0.5) / MAP_ASPECT;
      const h = lookup(u, north, pm);
      return h > 0 ? h * UNIT : 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
}

/**
 * Finds the triangle under a point in the plane of u and north and reads its height there: the triangles are filed in
 * buckets a fixed width across and deepening northwards as the facets do, so a lookup tests only a few of them.
 * Returns -Infinity where no triangle is.
 */
function triangleLookup(tri: ArrayLike<number>, pu: Float64Array, pn: Float64Array) {
  const WIDE = 0.008, DEEP = 0.012;
  const columns = Math.ceil((U1 - U0) / WIDE);
  const row = (north: number) => Math.floor(Math.log(1 + Math.max(0, north) / REACH) / DEEP);
  const rows = row(FAR_DEPTH) + 1;
  const count = new Int32Array(columns * rows + 1);
  const each = (t: number, visit: (bucket: number) => void) => {
    const a = tri[t * 3]!, b = tri[t * 3 + 1]!, c = tri[t * 3 + 2]!;
    const c0 = Math.max(0, Math.floor((Math.min(pu[a]!, pu[b]!, pu[c]!) - U0) / WIDE));
    const c1 = Math.min(columns - 1, Math.floor((Math.max(pu[a]!, pu[b]!, pu[c]!) - U0) / WIDE));
    const r0 = Math.max(0, row(Math.min(pn[a]!, pn[b]!, pn[c]!)));
    const r1 = Math.min(rows - 1, row(Math.max(pn[a]!, pn[b]!, pn[c]!)));
    for (let r = r0; r <= r1; r += 1) for (let k = c0; k <= c1; k += 1) visit(r * columns + k);
  };
  const triangles = tri.length / 3;
  for (let t = 0; t < triangles; t += 1) each(t, (bucket) => { count[bucket + 1] += 1; });
  for (let i = 1; i < count.length; i += 1) count[i] += count[i - 1]!;
  const filed = new Int32Array(count[count.length - 1]!);
  const fill = count.slice(0, -1);
  for (let t = 0; t < triangles; t += 1) each(t, (bucket) => { filed[fill[bucket]!++] = t; });
  return (u: number, north: number, metres: ArrayLike<number>) => {
    if (u < U0 || u > U1 || north < 0 || north > FAR_DEPTH) return -Infinity;
    const bucket = row(north) * columns + Math.min(columns - 1, Math.floor((u - U0) / WIDE));
    for (let i = count[bucket]!; i < count[bucket + 1]!; i += 1) {
      const t = filed[i]!;
      const a = tri[t * 3]!, b = tri[t * 3 + 1]!, c = tri[t * 3 + 2]!;
      const area = orient(pu[a]!, pn[a]!, pu[b]!, pn[b]!, pu[c]!, pn[c]!);
      const wa = orient(u, north, pu[b]!, pn[b]!, pu[c]!, pn[c]!) / area;
      const wb = orient(pu[a]!, pn[a]!, u, north, pu[c]!, pn[c]!) / area;
      const wc = 1 - wa - wb;
      if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) return metres[a]! * wa + metres[b]! * wb + metres[c]! * wc;
    }
    return -Infinity;
  };
}
