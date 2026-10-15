// The ground of the faction campaign's 3D world (캠페인) as a triangulated irregular network: the select screen's DEM
// (public/ui/korea_dem.webp, src/select/demMeta.json) cut into a few tens of thousands of flat facets, dense along the
// coasts and the ridges and sparse on flat ground and open sea, written to public/ui/grand_terrain.bin for
// src/ui/grand/worldGround.ts. The game itself keeps reading the DEM's own heights (groundElevation in mapMath.ts); this
// mesh only draws them, so it may differ from the DEM by at most its error budget.
//
//   node scripts/build-grand-terrain.mjs            writes the asset
//   node scripts/build-grand-terrain.mjs --check    rebuilds it in memory and fails unless it matches the file byte for byte
//   node scripts/build-grand-terrain.mjs --preview=<dir>  also writes PNGs of the facets and of where the drawn coast differs
//
// How it is made: greedy Delaunay refinement (Garland and Heckbert's "Fast polygonal approximation of terrains and height
// fields", in the style of Mapbox's delatin): start from the DEM's four corners and keep inserting the texel of largest
// error until every texel is within budget. The error of a land texel is its height error over RELIEF metres; every
// texel whose drawn side of the waterline differs from the DEM's (land under the sea plane, or sea above it) costs MISS
// more than any height error, so the coasts, every island and every strait get their vertices first. The sea floor is
// never fitted (the opaque sea plane hides it): sea vertices only keep the coast where the DEM has it, at their depth
// clamped to SEA_DEPTH, and triangles wholly under water are left out. Land stands at least LAND_MIN metres above the
// sea plane, so the plane and the land never meet in a flat. Low pockets inside the land smaller than POCKET texels,
// which are noise of the source rather than lakes, count as land. Land that touches the DEM's west, east or south edge
// eases down to the sea plane over RIM texels (the world's sea goes on past them); the north edge keeps its relief for
// the far land (src/ui/grand/farLand.ts), which takes the heights of the seam's vertices.
//
// Parameters: RELIEF 18 m, MISS 4, LAND_MIN 1.5 m, SEA_DEPTH 3..40 m, POCKET 48 texels, RIM 12 texels, BLUR 16 taps (the
// land is fitted to a binomial blur of the DEM, a Gaussian of 2 texels, not to its texel noise), SPIKE 300 m; vertices on the
// DEM's texel grid (u = x / (width - 1), v = y / (height - 1), as groundElevation reads it), heights in decimetres.
// The header of the asset records these and the SHA-256 of the source DEM; the build is deterministic, so rerunning it
// on the same DEM reproduces the file byte for byte.
//
// The settlements' pads (public/ui/grand_sites.json, solved by scripts/build-grand-sites.mjs) are levelled into the land
// before it is fitted: flat at their height inside each pad and PAD.margin texels beyond it, so the ground under anything
// built there reads flat however it is sampled, then eased back into the land over a bank as wide as the step needs. Land
// within PAD.guard texels of the sea is never touched, so no coastline moves, nor is low land outside a pad (under
// PAD.contour metres), so a pad on a coastal flat rises as a terrace instead of tilting the flat round it. Pads and banks
// are fitted far closer than the rest of the land (PAD.flatRelief, PAD.bankRelief), and the header lists the pads.
//
// Format (little-endian): "IMJT", u32 version, u32 header length, header JSON (padded to 4 bytes), then three streams,
// each a u32 byte length and its bytes padded to 4: the vertices (meshopt vertex codec, 8 bytes each: u16 x, u16 y,
// i16 height dm, u16 ground: 0 the land's own, 1 a pad's bank, 2 a pad), the kept triangles (meshopt index codec, u32
// indices, counter-clockwise from above) and the seam (every vertex on the DEM's north row, west to east: u16 x, i16
// height dm).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import sharp from 'sharp';
import { MeshoptEncoder } from 'meshoptimizer';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = 'public/ui/korea_dem.webp';
const OUT = 'public/ui/grand_terrain.bin';
const SITES = 'public/ui/grand_sites.json';
const VERSION = 1;

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
const num = (key, fallback) => (args[key] !== undefined ? Number(args[key]) : fallback);
const PARAMS = {
  relief: num('relief', 18),
  miss: 4,
  landMin: num('landMin', 1.5),
  seaDepth: [num('seaMin', 3), num('seaMax', 40)],
  pocket: num('pocket', 48),
  rim: num('rim', 12),
  blur: num('blur', 16),
  spike: 300,
};
/**
 * How pads are levelled, in texels and metres: the flat reaches `margin` texels past a pad's outline; the bank beyond is
 * a texel wide and one more per `bankRun` metres of step, up to `bankMax`; land within `guard` texels of the sea, and land
 * outside a pad under `contour` metres, keeps its height; a pad is fitted to `flatRelief` metres and a bank to `bankRelief`.
 */
export const PAD = { margin: 1.5, bankRun: 25, bankMax: 8, guard: 3, contour: 4, flatRelief: 0.5, bankRelief: 3 };
/** What a texel's ground is, as the vertices carry it: the land's own, a pad's bank or a pad. */
const OWN = 0, BANK = 1, FLAT = 2;

/** Heights in metres, as terrain.ts decodes them. */
export async function readDem() {
  const file = await readFile(join(ROOT, SOURCE));
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const heights = new Float32Array(info.width * info.height);
  for (let i = 0; i < heights.length; i += 1) heights[i] = data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768;
  return { width: info.width, height: info.height, heights, sha256: createHash('sha256').update(file).digest('hex') };
}

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The land's heights under a binomial blur of `order` taps (a Gaussian of sigma = sqrt(order) / 2 texels, with exact
 * integer weights so the build gives the same bits on every machine), averaged over land texels only so a coast is not
 * pulled down towards the sea floor beside it. The source's texel-scale noise would otherwise cost a facet per bump.
 */
function blurLand(W, H, heights, land, order) {
  if (!(order > 0)) return heights;
  const radius = order / 2;
  const kernel = new Float64Array(order + 1);
  kernel[0] = 1;
  for (let n = 1; n <= order; n += 1) for (let k = n; k > 0; k -= 1) kernel[k] += kernel[k - 1];
  /** One direction: `lines` lines of `length` texels, `step` apart within a line and `stride` apart between lines. */
  const pass = (src, weight, lines, length, step, stride) => {
    const out = new Float32Array(W * H), outWeight = new Float32Array(W * H);
    for (let line = 0; line < lines; line += 1) {
      const base = line * stride;
      for (let p = 0; p < length; p += 1) {
        let sum = 0, total = 0;
        const k0 = Math.max(-radius, -p), k1 = Math.min(radius, length - 1 - p);
        for (let k = k0; k <= k1; k += 1) {
          const j = base + (p + k) * step, w = kernel[k + radius] * weight[j];
          sum += src[j] * w;
          total += w;
        }
        const i = base + p * step;
        out[i] = total > 0 ? sum / total : 0;
        outWeight[i] = total;
      }
    }
    return { out, outWeight };
  };
  const weight = Float32Array.from(land, (l) => (l ? 1 : 0));
  const rows = pass(heights, weight, H, W, 1, W);
  // The second pass weighs each column sample by how much land the first pass saw there.
  return pass(rows.out, rows.outWeight, W, H, W, 1).out;
}

/** What a texel must be drawn as: under the sea plane, above it, or above it unless it sinks to smooth the coast. */
const SEA = 0, LAND = 1, SHORE = 2;
/** Metres a texel must clear the sea plane by, so rounding never puts it on the wrong side. */
const MARGIN = 0.1;

/** Visits the 8-connected component of `start` among the texels `inside` accepts, calling `visit` on each. */
function flood(W, H, start, inside, seen, stack, visit) {
  let top = 0;
  stack[top++] = start;
  seen[start] = 1;
  while (top) {
    const k = stack[--top];
    visit(k);
    const x = k % W, y = (k - x) / W;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (!seen[j] && inside(j)) { seen[j] = 1; stack[top++] = j; }
    }
  }
}

/**
 * The source has a few dozen spikes and pits a kilometre or two high or deep in pairs, where its tiles were stitched:
 * a texel this far from the middle of its eight neighbours takes the median of the 5 x 5 texels round it instead.
 */
function despike(W, H, source) {
  const heights = Float32Array.from(source);
  const ring = new Float64Array(8), square = new Float64Array(25);
  /** The middle of `values`, sorted in place by insertion (the lists are short). */
  const median = (values) => {
    for (let i = 1; i < values.length; i += 1) {
      const v = values[i];
      let j = i - 1;
      while (j >= 0 && values[j] > v) { values[j + 1] = values[j]; j -= 1; }
      values[j + 1] = v;
    }
    const m = values.length >> 1;
    return values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2;
  };
  let fixed = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    const before = Float32Array.from(heights);
    for (let y = 2; y < H - 2; y += 1) for (let x = 2; x < W - 2; x += 1) {
      const v = before[y * W + x];
      let n = 0, lo = Infinity, hi = -Infinity;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const h = before[(y + dy) * W + x + dx];
        ring[n++] = h;
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
      // The median lies between the lowest and the highest neighbour, so most texels need no sort at all.
      if (v - lo <= PARAMS.spike && hi - v <= PARAMS.spike) continue;
      if (Math.abs(v - median(ring)) <= PARAMS.spike) continue;
      n = 0;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) square[n++] = before[(y + dy) * W + x + dx];
      heights[y * W + x] = median(square);
      fixed += 1;
    }
  }
  return { heights, fixed };
}

/**
 * What the mesh must draw at each texel: `land` (SEA, LAND or SHORE) and `target`, the height a land texel should be
 * drawn at or the depth a sea vertex takes.
 */
function prepare(W, H, source) {
  const { heights, fixed } = despike(W, H, source);
  const land = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) land[i] = heights[i] > 0 ? LAND : SEA;
  const stack = new Int32Array(W * H);
  // Low pockets inside the land: sea components that do not reach the DEM's border and are small.
  const seen = new Uint8Array(W * H);
  const members = [];
  let filled = 0;
  for (let start = 0; start < W * H; start += 1) {
    if (land[start] || seen[start]) continue;
    let border = false;
    members.length = 0;
    flood(W, H, start, (j) => !land[j], seen, stack, (k) => {
      members.push(k);
      const x = k % W, y = (k - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
    });
    if (!border && members.length < PARAMS.pocket) for (const k of members) { land[k] = LAND; filled += 1; }
  }
  // A filled pocket takes its height from the land round it: the blur weighs only the source's own land.
  const smooth = blurLand(W, H, heights, Uint8Array.from(heights, (h) => (h > 0 ? 1 : 0)), PARAMS.blur);
  const target = new Float32Array(W * H);
  const [seaMin, seaMax] = PARAMS.seaDepth;
  for (let y = 0; y < H; y += 1) {
    // West, east and south edges ease the land down; the north edge does not.
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (!land[i]) { target[i] = -Math.min(seaMax, Math.max(seaMin, -heights[i])); continue; }
      const edge = Math.min(x, W - 1 - x, H - 1 - y);
      const rim = smoothstep(0, PARAMS.rim, edge);
      target[i] = PARAMS.landMin + Math.max(0, smooth[i] - PARAMS.landMin) * rim;
    }
  }
  // Land beside the sea may sink under the sea plane (the coast then moves up to a texel inland), so a staircase coast
  // costs a few long facets instead of a vertex per step. The sea never rises above it, so a strait never closes and a
  // ship on the DEM's water never sits on drawn land; an island all of whose texels touch the sea keeps its highest one.
  const shore = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = y * W + x;
    if (!land[i]) continue;
    for (let dy = -1; dy <= 1 && !shore[i]; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && !land[yy * W + xx]) { shore[i] = 1; break; }
    }
  }
  const visited = new Uint8Array(W * H);
  for (let start = 0; start < W * H; start += 1) {
    if (!land[start] || visited[start]) continue;
    let inner = false, peak = start;
    flood(W, H, start, (j) => land[j] !== SEA, visited, stack, (k) => {
      if (!shore[k]) inner = true;
      if (target[k] > target[peak]) peak = k;
    });
    if (!inner) shore[peak] = 0;
  }
  for (let i = 0; i < W * H; i += 1) if (shore[i]) land[i] = SHORE;
  return { land, target, filled, fixed, clean: heights };
}

/** The land as the build fits it, before any pad: what a texel must be drawn as and the height it should be drawn at. */
export function prepareTerrain(dem) {
  return prepare(dem.width, dem.height, dem.heights);
}

/** Texels within PAD.guard texels of the sea, along both axes and the diagonals: no pad or bank may touch them. */
export function seaGuard(W, H, land) {
  const r = PAD.guard;
  const near = new Uint8Array(W * H), out = new Uint8Array(W * H);
  const sum = new Int32Array(Math.max(W, H) + 1);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) sum[x + 1] = sum[x] + (land[y * W + x] === SEA ? 1 : 0);
    for (let x = 0; x < W; x += 1) near[y * W + x] = sum[Math.min(W, x + r + 1)] - sum[Math.max(0, x - r)] > 0 ? 1 : 0;
  }
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) sum[y + 1] = sum[y] + near[y * W + x];
    for (let y = 0; y < H; y += 1) out[y * W + x] = sum[Math.min(H, y + r + 1)] - sum[Math.max(0, y - r)] > 0 ? 1 : 0;
  }
  return out;
}

/** Distance from (x, y) to a polygon's outline, negative inside it. */
function polygonDistance(poly, x, y) {
  let d = Infinity, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
    d = Math.min(d, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return inside ? -d : d;
}

/**
 * Levels the pads into `target` (metres) and returns each texel's ground (OWN, BANK or FLAT). Every pad's flat is laid
 * before any bank, so no bank eats into a neighbouring pad; where two banks meet, the one that pulls the texel hardest
 * wins. Pads are { h0 metres, poly texels }.
 */
function levelPads(W, H, land, target, pads) {
  const ground = new Uint8Array(W * H);
  if (!pads.length) return ground;
  const guard = seaGuard(W, H, land);
  const own = Float32Array.from(target);
  const reach = PAD.margin + PAD.bankMax + 1;
  const boxes = pads.map(({ poly }) => {
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    return {
      x0: Math.max(0, Math.floor(Math.min(...xs) - reach)), x1: Math.min(W - 1, Math.ceil(Math.max(...xs) + reach)),
      y0: Math.max(0, Math.floor(Math.min(...ys) - reach)), y1: Math.min(H - 1, Math.ceil(Math.max(...ys) + reach)),
    };
  });
  const open = (i) => land[i] !== SEA && !guard[i];
  pads.forEach((pad, k) => {
    const { x0, x1, y0, y1 } = boxes[k];
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const i = y * W + x;
      if (open(i) && polygonDistance(pad.poly, x, y) <= PAD.margin) { target[i] = pad.h0; ground[i] = FLAT; }
    }
  });
  const weight = new Float32Array(W * H), toward = new Float32Array(W * H);
  pads.forEach((pad, k) => {
    const { x0, x1, y0, y1 } = boxes[k];
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const i = y * W + x;
      if (ground[i] === FLAT || !open(i) || own[i] <= PAD.contour) continue;
      const d = polygonDistance(pad.poly, x, y) - PAD.margin;
      const width = Math.min(PAD.bankMax, 1 + Math.abs(own[i] - pad.h0) / PAD.bankRun);
      if (d >= width) continue;
      const w = 1 - smoothstep(0, width, d);
      if (w > weight[i]) { weight[i] = w; toward[i] = pad.h0; }
    }
  });
  for (let i = 0; i < W * H; i += 1) {
    if (weight[i] <= 0) continue;
    target[i] = own[i] + (toward[i] - own[i]) * weight[i];
    ground[i] = BANK;
  }
  return ground;
}

const orient =(ax, ay, bx, by, cx, cy) => (bx - cx) * (ay - cy) - (by - cy) * (ax - cx);

function inCircle(ax, ay, bx, by, cx, cy, px, py) {
  const dx = ax - px, dy = ay - py, ex = bx - px, ey = by - py, fx = cx - px, fy = cy - py;
  const ap = dx * dx + dy * dy, bp = ex * ex + ey * ey, cp = fx * fx + fy * fy;
  return dx * (ey * cp - bp * fy) - dy * (ex * cp - bp * fx) + ap * (ex * fy - ey * fx) < 0;
}

/**
 * Greedy refinement of a Delaunay triangulation of the grid. Triangles are kept as three vertex ids and three half-edges
 * (the opposite half-edge of each side, -1 on the border); a binary heap orders them by the error of their worst texel.
 */
class Refiner {
  constructor(W, H, land, target, ground) {
    this.W = W;
    this.H = H;
    this.land = land;
    this.target = target;
    this.ground = ground;
    /** The inverse of the height budget by what a texel's ground is (OWN, BANK, FLAT). */
    this.invRelief = [1 / PARAMS.relief, 1 / PAD.bankRelief, 1 / PAD.flatRelief];
    this.coords = [];
    this.triangles = [];
    this.halfedges = [];
    this.candidates = [];
    this.heap = [];
    this.heapErrors = [];
    this.heapIndex = [];
    this.pending = [];
    const p0 = this.addPoint(0, 0), p1 = this.addPoint(W - 1, 0), p2 = this.addPoint(0, H - 1), p3 = this.addPoint(W - 1, H - 1);
    const t0 = this.addTriangle(p3, p0, p2, -1, -1, -1);
    this.addTriangle(p0, p3, p1, t0, -1, -1);
    this.flush();
  }

  /** The largest error left, in units of the budget (1 is the budget). */
  maxError() {
    return this.heapErrors.length ? this.heapErrors[0] : 0;
  }

  refine() {
    this.step();
    this.flush();
  }

  addPoint(x, y) {
    const i = this.coords.length >> 1;
    this.coords.push(x, y);
    return i;
  }

  addTriangle(a, b, c, ab, bc, ca, e = this.triangles.length) {
    const t = e / 3;
    this.triangles[e] = a;
    this.triangles[e + 1] = b;
    this.triangles[e + 2] = c;
    this.halfedges[e] = ab;
    this.halfedges[e + 1] = bc;
    this.halfedges[e + 2] = ca;
    if (ab >= 0) this.halfedges[ab] = e;
    if (bc >= 0) this.halfedges[bc] = e + 1;
    if (ca >= 0) this.halfedges[ca] = e + 2;
    this.candidates[2 * t] = 0;
    this.candidates[2 * t + 1] = 0;
    this.heapIndex[t] = -1;
    this.pending.push(t);
    return e;
  }

  /** Measures every triangle made or changed by the last step and queues it by its worst texel. */
  flush() {
    const { coords, triangles } = this;
    for (const t of this.pending) {
      const a = 2 * triangles[3 * t], b = 2 * triangles[3 * t + 1], c = 2 * triangles[3 * t + 2];
      this.measure(coords[a], coords[a + 1], coords[b], coords[b + 1], coords[c], coords[c + 1], t);
    }
    this.pending.length = 0;
  }

  /** Walks the texels inside a triangle with edge functions and finds the one of largest error. */
  measure(p0x, p0y, p1x, p1y, p2x, p2y, t) {
    const { W, land, target, ground, invRelief } = this;
    const miss = PARAMS.miss;
    const minX = Math.min(p0x, p1x, p2x), minY = Math.min(p0y, p1y, p2y);
    const maxX = Math.max(p0x, p1x, p2x), maxY = Math.max(p0y, p1y, p2y);
    let w00 = orient(p1x, p1y, p2x, p2y, minX, minY);
    let w01 = orient(p2x, p2y, p0x, p0y, minX, minY);
    let w02 = orient(p0x, p0y, p1x, p1y, minX, minY);
    const a01 = p1y - p0y, b01 = p0x - p1x, a12 = p2y - p1y, b12 = p1x - p2x, a20 = p0y - p2y, b20 = p2x - p0x;
    const area = orient(p0x, p0y, p1x, p1y, p2x, p2y);
    const z0 = target[p0y * W + p0x] / area, z1 = target[p1y * W + p1x] / area, z2 = target[p2y * W + p2x] / area;
    let worst = 0, wx = 0, wy = 0;
    for (let y = minY; y <= maxY; y += 1) {
      let dx = 0;
      if (w00 < 0 && a12 !== 0) dx = Math.max(dx, Math.floor(-w00 / a12));
      if (w01 < 0 && a20 !== 0) dx = Math.max(dx, Math.floor(-w01 / a20));
      if (w02 < 0 && a01 !== 0) dx = Math.max(dx, Math.floor(-w02 / a01));
      let w0 = w00 + a12 * dx, w1 = w01 + a20 * dx, w2 = w02 + a01 * dx;
      let inside = false;
      for (let x = minX + dx; x <= maxX; x += 1) {
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
          inside = true;
          const z = z0 * w0 + z1 * w1 + z2 * w2;
          const i = y * W + x;
          let e;
          const kind = land[i];
          if (kind) {
            e = Math.abs(z - target[i]) * invRelief[ground[i]];
            if (z <= MARGIN && kind === LAND) e += miss;
          } else {
            e = z >= -MARGIN ? miss + (z + MARGIN) * invRelief[OWN] : 0;
          }
          if (e > worst) { worst = e; wx = x; wy = y; }
        } else if (inside) {
          break;
        }
        w0 += a12; w1 += a20; w2 += a01;
      }
      w00 += b12; w01 += b20; w02 += b01;
    }
    if ((wx === p0x && wy === p0y) || (wx === p1x && wy === p1y) || (wx === p2x && wy === p2y)) worst = 0;
    this.candidates[2 * t] = wx;
    this.candidates[2 * t + 1] = wy;
    this.heapPush(t, worst);
  }

  /** Splits the worst triangle at its worst texel and restores the Delaunay condition round it. */
  step() {
    const t = this.heapPop();
    const e0 = 3 * t, e1 = e0 + 1, e2 = e0 + 2;
    const { coords, triangles } = this;
    const p0 = triangles[e0], p1 = triangles[e1], p2 = triangles[e2];
    const ax = coords[2 * p0], ay = coords[2 * p0 + 1], bx = coords[2 * p1], by = coords[2 * p1 + 1], cx = coords[2 * p2], cy = coords[2 * p2 + 1];
    const px = this.candidates[2 * t], py = this.candidates[2 * t + 1];
    const pn = this.addPoint(px, py);
    if (orient(ax, ay, bx, by, px, py) === 0) this.splitEdge(pn, e0);
    else if (orient(bx, by, cx, cy, px, py) === 0) this.splitEdge(pn, e1);
    else if (orient(cx, cy, ax, ay, px, py) === 0) this.splitEdge(pn, e2);
    else {
      const h0 = this.halfedges[e0], h1 = this.halfedges[e1], h2 = this.halfedges[e2];
      const t0 = this.addTriangle(p0, p1, pn, h0, -1, -1, e0);
      const t1 = this.addTriangle(p1, p2, pn, h1, -1, t0 + 1);
      const t2 = this.addTriangle(p2, p0, pn, h2, t0 + 2, t1 + 1);
      this.legalize(t0);
      this.legalize(t1);
      this.legalize(t2);
    }
  }

  /** Flips the edge `a` while the point across it lies inside the circumcircle of its triangle. */
  legalize(a) {
    const b = this.halfedges[a];
    if (b < 0) return;
    const a0 = a - (a % 3), b0 = b - (b % 3);
    const al = a0 + ((a + 1) % 3), ar = a0 + ((a + 2) % 3);
    const bl = b0 + ((b + 2) % 3), br = b0 + ((b + 1) % 3);
    const { coords, triangles } = this;
    const p0 = triangles[ar], pr = triangles[a], pl = triangles[al], p1 = triangles[bl];
    if (!inCircle(coords[2 * p0], coords[2 * p0 + 1], coords[2 * pr], coords[2 * pr + 1], coords[2 * pl], coords[2 * pl + 1], coords[2 * p1], coords[2 * p1 + 1])) return;
    const hal = this.halfedges[al], har = this.halfedges[ar], hbl = this.halfedges[bl], hbr = this.halfedges[br];
    this.heapRemove(a0 / 3);
    this.heapRemove(b0 / 3);
    const t0 = this.addTriangle(p0, p1, pl, -1, hbl, hal, a0);
    const t1 = this.addTriangle(p1, p0, pr, t0, har, hbr, b0);
    this.legalize(t0 + 1);
    this.legalize(t1 + 2);
  }

  /** A new point on the edge `a`: both triangles that share it are split in two. */
  splitEdge(pn, a) {
    const a0 = a - (a % 3), al = a0 + ((a + 1) % 3), ar = a0 + ((a + 2) % 3);
    const { triangles } = this;
    const p0 = triangles[ar], pr = triangles[a], pl = triangles[al];
    const hal = this.halfedges[al], har = this.halfedges[ar];
    const b = this.halfedges[a];
    if (b < 0) {
      const t0 = this.addTriangle(pn, p0, pr, -1, har, -1, a0);
      const t1 = this.addTriangle(p0, pn, pl, t0, -1, hal);
      this.legalize(t0 + 1);
      this.legalize(t1 + 2);
      return;
    }
    const b0 = b - (b % 3), bl = b0 + ((b + 2) % 3), br = b0 + ((b + 1) % 3);
    const p1 = triangles[bl];
    const hbl = this.halfedges[bl], hbr = this.halfedges[br];
    this.heapRemove(b0 / 3);
    const t0 = this.addTriangle(p0, pr, pn, har, -1, -1, a0);
    const t1 = this.addTriangle(pr, p1, pn, hbr, -1, t0 + 1, b0);
    const t2 = this.addTriangle(p1, pl, pn, hbl, -1, t1 + 1);
    const t3 = this.addTriangle(pl, p0, pn, hal, t0 + 2, t2 + 1);
    this.legalize(t0);
    this.legalize(t1);
    this.legalize(t2);
    this.legalize(t3);
  }

  heapPush(t, error) {
    const i = this.heap.length;
    this.heapIndex[t] = i;
    this.heap.push(t);
    this.heapErrors.push(error);
    this.heapUp(i);
  }

  heapPop() {
    const n = this.heap.length - 1;
    this.heapSwap(0, n);
    this.heapDown(0, n);
    return this.heapPopBack();
  }

  heapPopBack() {
    const t = this.heap.pop();
    this.heapErrors.pop();
    this.heapIndex[t] = -1;
    return t;
  }

  heapRemove(t) {
    const i = this.heapIndex[t];
    if (i < 0) {
      // Not measured yet: it is still waiting in the pending list.
      const at = this.pending.indexOf(t);
      if (at < 0) throw new Error('broken triangulation');
      this.pending[at] = this.pending[this.pending.length - 1];
      this.pending.pop();
      return;
    }
    const n = this.heap.length - 1;
    if (n !== i) {
      this.heapSwap(i, n);
      if (!this.heapDown(i, n)) this.heapUp(i);
    }
    this.heapPopBack();
  }

  heapSwap(i, j) {
    const ti = this.heap[i], tj = this.heap[j];
    this.heap[i] = tj;
    this.heap[j] = ti;
    this.heapIndex[ti] = j;
    this.heapIndex[tj] = i;
    const e = this.heapErrors[i];
    this.heapErrors[i] = this.heapErrors[j];
    this.heapErrors[j] = e;
  }

  heapUp(j) {
    while (j > 0) {
      const i = (j - 1) >> 1;
      if (!(this.heapErrors[j] > this.heapErrors[i])) break;
      this.heapSwap(i, j);
      j = i;
    }
  }

  heapDown(i0, n) {
    let i = i0;
    for (;;) {
      const j1 = 2 * i + 1;
      if (j1 >= n || j1 < 0) break;
      const j2 = j1 + 1;
      const j = j2 < n && this.heapErrors[j2] > this.heapErrors[j1] ? j2 : j1;
      if (!(this.heapErrors[j] > this.heapErrors[i])) break;
      this.heapSwap(i, j);
      i = j;
    }
    return i > i0;
  }
}

/**
 * Builds the mesh with `pads` levelled in ({ site, id, h0 metres, poly texels }, sitePads) and returns the asset's bytes
 * and what it is made of.
 */
export async function buildGrandTerrain(dem, pads = []) {
  const { width: W, height: H, heights } = dem;
  const { land, target, filled, fixed, clean } = prepare(W, H, heights);
  const ground = levelPads(W, H, land, target, pads);
  const refiner = new Refiner(W, H, land, target, ground);
  while (refiner.maxError() > 1) refiner.refine();
  const { coords, triangles } = refiner;
  const height = (v) => target[coords[2 * v + 1] * W + coords[2 * v]];
  // Only triangles that reach above the sea plane are drawn.
  const kept = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    if (height(a) > 0 || height(b) > 0 || height(c) > 0) kept.push(a, b, c);
  }
  // Compact to the vertices the kept triangles use, then let meshopt order them for its codecs.
  const vertexCount = coords.length / 2;
  const remap = new Int32Array(vertexCount).fill(-1);
  let used = 0;
  for (const v of kept) if (remap[v] < 0) remap[v] = used++;
  const indices = Uint32Array.from(kept, (v) => remap[v]);
  await MeshoptEncoder.ready;
  const [order, unique] = MeshoptEncoder.reorderMesh(indices, true, true);
  const vertices = new Uint16Array(unique * 4);
  for (let v = 0; v < vertexCount; v += 1) {
    if (remap[v] < 0) continue;
    const o = order[remap[v]] * 4;
    vertices[o] = coords[2 * v];
    vertices[o + 1] = coords[2 * v + 1];
    vertices[o + 2] = Math.round(height(v) * 10) & 0xffff;
    vertices[o + 3] = ground[coords[2 * v + 1] * W + coords[2 * v]];
  }
  // The seam: every vertex of the north row, kept or not, west to east.
  const seam = [];
  for (let v = 0; v < vertexCount; v += 1) if (coords[2 * v + 1] === 0) seam.push([coords[2 * v], Math.round(height(v) * 10)]);
  seam.sort((a, b) => a[0] - b[0]);
  const seamBytes = new Uint16Array(seam.length * 2);
  seam.forEach(([x, h], i) => { seamBytes[2 * i] = x; seamBytes[2 * i + 1] = h & 0xffff; });

  const vertexStream = MeshoptEncoder.encodeVertexBuffer(new Uint8Array(vertices.buffer), unique, 8);
  const indexStream = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(indices.buffer), indices.length, 4);
  const header = {
    source: SOURCE,
    sha256: dem.sha256,
    width: W,
    height: H,
    vertices: unique,
    triangles: indices.length / 3,
    seam: seam.length,
    heightScale: 0.1,
    params: PARAMS,
  };
  if (pads.length) {
    header.pad = PAD;
    header.pads = pads.map((p) => ({ site: p.site, id: p.id, h0: Math.round(p.h0 * 10) / 10, poly: p.poly.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]) }));
  }
  const pad4 = (n) => (n + 3) & ~3;
  const json = new TextEncoder().encode(JSON.stringify(header));
  const streams = [vertexStream, indexStream, new Uint8Array(seamBytes.buffer)];
  const size = 12 + pad4(json.length) + streams.reduce((s, b) => s + 4 + pad4(b.length), 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode('IMJT'), 0);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, json.length, true);
  out.set(json, 12);
  let o = 12 + pad4(json.length);
  for (const bytes of streams) {
    view.setUint32(o, bytes.length, true);
    out.set(bytes, o + 4);
    o += 4 + pad4(bytes.length);
  }
  return { bytes: out, header, refiner, land, target, ground, kept, filled, fixed, clean };
}

/**
 * The DEM's heights in metres as the campaign map holds them once the land is drawn (groundLand.ts, drawHeights): every
 * texel under a drawn facet takes the facet's height at the heights the asset stores; land texels no drawn facet covers
 * read -1, sunk under the sea plane; the sea keeps the DEM's own depths.
 */
export function drawnHeights(dem, built) {
  const { width: W, height: H } = dem;
  const { refiner: { coords }, kept } = built;
  const out = Float32Array.from(dem.heights);
  for (let i = 0; i < W * H; i += 1) if (out[i] > 0) out[i] = -1;
  // The asset's own heights: whole decimetres in an int16.
  const metres = new Float32Array(coords.length / 2);
  for (let v = 0; v < metres.length; v += 1) metres[v] = ((Math.round(built.target[coords[2 * v + 1] * W + coords[2 * v]] * 10) << 16) >> 16) * 0.1;
  for (let t = 0; t < kept.length; t += 3) {
    const a = kept[t], b = kept[t + 1], c = kept[t + 2];
    const ha = metres[a], hb = metres[b], hc = metres[c];
    if (ha <= 0 && hb <= 0 && hc <= 0) continue;
    const ax = coords[2 * a], ay = coords[2 * a + 1], bx = coords[2 * b], by = coords[2 * b + 1], cx = coords[2 * c], cy = coords[2 * c + 1];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) continue;
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx), minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const wa = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area;
      const wb = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area;
      const wc = 1 - wa - wb;
      if (wa < 0 || wb < 0 || wc < -1e-9) continue;
      const z = ha * wa + hb * wb + hc * wc;
      if (z > 0) out[y * W + x] = z;
    }
  }
  return out;
}

/** A TypeScript module of the game bundled for node (esbuild), from `source` that re-exports what is wanted. */
export async function importTs(source) {
  const bundled = await build({ stdin: { contents: source, resolveDir: ROOT, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  const dir = await mkdtemp(join(tmpdir(), 'imjin-terrain-'));
  try {
    const path = join(dir, 'module.mjs');
    await writeFile(path, bundled.outputFiles[0].contents);
    return await import(pathToFileURL(path).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The pads of public/ui/grand_sites.json in the DEM's texels with their heights in metres, none before it exists. */
export async function sitePads(dem) {
  if (!existsSync(join(ROOT, SITES))) return [];
  const { sites } = JSON.parse(await readFile(join(ROOT, SITES), 'utf8'));
  const { padsInTexels } = await importTs(`export { padsInTexels } from './src/ui/grand/settle/solver.ts';`);
  return padsInTexels(sites, dem.width, dem.height);
}

/** PNGs for a person to look at: the facets shaded by height, and where the drawn waterline differs from the DEM's. */
async function preview(dir, dem, built) {
  const { width: W, height: H } = dem;
  const { refiner, land, target } = built;
  const { coords, triangles } = refiner;
  const drawn = new Float32Array(W * H).fill(-1);
  const shade = new Uint8Array(W * H * 3);
  for (let t = 0; t < triangles.length; t += 3) {
    const v = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const p = v.map((i) => [coords[2 * i], coords[2 * i + 1], target[coords[2 * i + 1] * W + coords[2 * i]]]);
    const area = orient(p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1]);
    const minX = Math.min(p[0][0], p[1][0], p[2][0]), maxX = Math.max(p[0][0], p[1][0], p[2][0]);
    const minY = Math.min(p[0][1], p[1][1], p[2][1]), maxY = Math.max(p[0][1], p[1][1], p[2][1]);
    const tone = 90 + ((t / 3) * 2654435761 % 97);
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const w0 = orient(p[1][0], p[1][1], p[2][0], p[2][1], x, y), w1 = orient(p[2][0], p[2][1], p[0][0], p[0][1], x, y), w2 = orient(p[0][0], p[0][1], p[1][0], p[1][1], x, y);
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = (p[0][2] * w0 + p[1][2] * w1 + p[2][2] * w2) / area;
      const i = y * W + x;
      drawn[i] = z;
      const lit = z > 0 ? Math.min(255, tone + z * 0.08) : 40;
      shade[i * 3] = z > 0 ? lit * 0.8 : 20;
      shade[i * 3 + 1] = z > 0 ? lit : 40;
      shade[i * 3 + 2] = z > 0 ? lit * 0.6 : 90;
    }
  }
  // Grey land and dark sea as the DEM has them; yellow where the shore sank, red and blue where the rules were broken.
  const diff = new Uint8Array(W * H * 3);
  let landAsSea = 0, seaAsLand = 0, sunk = 0;
  const paint = (i, r, g, b) => { diff[i * 3] = r; diff[i * 3 + 1] = g; diff[i * 3 + 2] = b; };
  for (let i = 0; i < W * H; i += 1) {
    const drawnLand = drawn[i] > 0;
    paint(i, land[i] ? 120 : 30, land[i] ? 120 : 30, land[i] ? 120 : 30);
    if (land[i] === LAND && !drawnLand) { landAsSea += 1; paint(i, 255, 0, 0); }
    if (land[i] === SHORE && !drawnLand) { sunk += 1; paint(i, 230, 200, 40); }
    if (land[i] === SEA && drawnLand) { seaAsLand += 1; paint(i, 0, 120, 255); }
  }
  await mkdir(dir, { recursive: true });
  await sharp(Buffer.from(shade.buffer), { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(dir, 'grand-terrain-facets.png'));
  await sharp(Buffer.from(diff.buffer), { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(dir, 'grand-terrain-coast.png'));
  // How far the drawn land is from the DEM's own heights, which the markers, camps and ships stand on.
  const off = [];
  for (let i = 0; i < W * H; i += 1) if (land[i] && drawn[i] > 0) off.push(Math.abs(drawn[i] - Math.max(0, built.clean[i])));
  off.sort((a, b) => a - b);
  const at = (p) => +off[Math.min(off.length - 1, Math.floor(off.length * p))].toFixed(1);
  return { counts: { landAsSea, seaAsLand, sunk, offMetres: { p50: at(0.5), p90: at(0.9), p99: at(0.99), max: at(1) } }, drawn };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const t0 = performance.now();
  const dem = await readDem();
  const pads = await sitePads(dem);
  const built = await buildGrandTerrain(dem, pads);
  const seconds = ((performance.now() - t0) / 1000).toFixed(1);
  const { header, bytes, refiner, filled, fixed } = built;
  console.log(`${header.triangles} triangles drawn of ${refiner.triangles.length / 3}, ${header.vertices} vertices, ${header.seam} on the seam, ${pads.length} pads, ${filled} pocket texels filled, ${fixed} spikes flattened; ${bytes.length} bytes; ${seconds} s`);
  if (args.preview) {
    const coast = await preview(args.preview, dem, built);
    console.log(coast.counts);
    // The pads must leave the drawn coast as it was: the same texels on each side of the waterline.
    if (pads.length) {
      const bare = await preview(join(args.preview, 'no-pads'), dem, await buildGrandTerrain(dem));
      let moved = 0;
      for (let i = 0; i < coast.drawn.length; i += 1) if (coast.drawn[i] > 0 !== bare.drawn[i] > 0) moved += 1;
      console.log(`without the pads: ${JSON.stringify(bare.counts)}; ${moved} texels change sides of the waterline`);
    }
  }
  if (args.check) {
    const current = await readFile(join(ROOT, OUT));
    if (Buffer.compare(current, Buffer.from(bytes)) !== 0) {
      console.error(`${OUT} does not match a fresh build`);
      process.exit(1);
    }
    console.log(`${OUT} matches a fresh build`);
  } else if (!args.dry) {
    await writeFile(join(ROOT, OUT), bytes);
    console.log(`wrote ${OUT}`);
  }
}
