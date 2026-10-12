// The camps' low-poly shapes, rebuilt from the Meshy originals as deliberate architecture rather than decimated scans.
// A camp is 2.5D seen from the map, so its top-down heightmap carries the whole form: the heightmap is cut into planar
// facets (region growing on plane fits), their shared boundaries are traced and straightened, each facet is triangulated
// at its own plane's heights, and wherever two facets meet at a step a vertical wall joins them; where they meet at a
// crease (a ridge, a hip) they share their edge. Banners, too thin for the heightmap, come back as flat cards.
//
// Used by scripts/build-camp-models.mjs. Pure maths on typed arrays (three.js only for its polygon triangulator).
import { ShapeUtils, Vector2 } from 'three';

const OUT = -1;
const FOUR = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- heightmap ----------

/**
 * The highest surface over each cell of an N x N grid spanning x and z in [-0.5, 0.5] (plus a margin of empty cells),
 * -Infinity where there is none. Triangle interiors are sampled at cell centres and edges every half cell, so thin
 * vertical sheets (banners, palisade stakes) still mark the cells they stand in.
 */
export function heightmap(P, I, N, margin = 3) {
  const W = N + 2 * margin, cell = 1 / N, x0 = -0.5 - margin * cell;
  const H = new Float64Array(W * W).fill(-Infinity);
  const put = (u, v, y) => { const i = Math.round(u), j = Math.round(v); if (i >= 0 && j >= 0 && i < W && j < W && y > H[j * W + i]) H[j * W + i] = y; };
  const g = (x) => (x - x0) / cell - 0.5;
  for (let t = 0; t < I.length; t += 3) {
    const A = [0, 1, 2].map((q) => [g(P[I[t + q] * 3]), P[I[t + q] * 3 + 1], g(P[I[t + q] * 3 + 2])]);
    const umin = Math.max(0, Math.ceil(Math.min(A[0][0], A[1][0], A[2][0]))), umax = Math.min(W - 1, Math.floor(Math.max(A[0][0], A[1][0], A[2][0])));
    const vmin = Math.max(0, Math.ceil(Math.min(A[0][2], A[1][2], A[2][2]))), vmax = Math.min(W - 1, Math.floor(Math.max(A[0][2], A[1][2], A[2][2])));
    const d = (A[1][0] - A[0][0]) * (A[2][2] - A[0][2]) - (A[2][0] - A[0][0]) * (A[1][2] - A[0][2]);
    if (Math.abs(d) > 1e-12) for (let v = vmin; v <= vmax; v++) for (let u = umin; u <= umax; u++) {
      const w1 = ((u - A[0][0]) * (A[2][2] - A[0][2]) - (A[2][0] - A[0][0]) * (v - A[0][2])) / d;
      const w2 = ((A[1][0] - A[0][0]) * (v - A[0][2]) - (u - A[0][0]) * (A[1][2] - A[0][2])) / d;
      if (w1 < -1e-9 || w2 < -1e-9 || w1 + w2 > 1 + 1e-9) continue;
      put(u, v, A[0][1] + w1 * (A[1][1] - A[0][1]) + w2 * (A[2][1] - A[0][1]));
    }
    for (const [p, q] of [[0, 1], [1, 2], [2, 0]]) {
      const n = Math.max(1, Math.ceil(Math.hypot(A[q][0] - A[p][0], A[q][2] - A[p][2]) * 2));
      for (let e = 0; e <= n; e++) { const f = e / n; put(A[p][0] + f * (A[q][0] - A[p][0]), A[p][2] + f * (A[q][2] - A[p][2]), A[p][1] + f * (A[q][1] - A[p][1])); }
    }
  }
  return { W, cell, x0, H };
}

/** Grey-scale erosion (fn = Math.min) or dilation (Math.max) with a (2r+1)^2 square, done as two 1D passes. */
export function morph(W, src, r, fn) {
  const tmp = new Float64Array(W * W), dst = new Float64Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { let m = src[j * W + i]; for (let q = Math.max(0, i - r); q <= Math.min(W - 1, i + r); q++) m = fn(m, src[j * W + q]); tmp[j * W + i] = m; }
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { let m = tmp[j * W + i]; for (let q = Math.max(0, j - r); q <= Math.min(W - 1, j + r); q++) m = fn(m, tmp[q * W + i]); dst[j * W + i] = m; }
  return dst;
}
const opening = (W, f, r) => morph(W, morph(W, f, r, Math.min), r, Math.max);

/** The footprint without its small separate crumbs. */
function keepLarge(W, inside, minPixels) {
  const comp = new Int32Array(W * W).fill(-1), sizes = [];
  for (let k = 0; k < W * W; k++) {
    if (!inside[k] || comp[k] >= 0) continue;
    const id = sizes.length, stack = [k];
    comp[k] = id;
    let n = 0;
    while (stack.length) {
      const p = stack.pop(), pi = p % W, pj = Math.floor(p / W);
      n += 1;
      for (const [di, dj] of FOUR) { const qi = pi + di, qj = pj + dj, q = qj * W + qi; if (qi >= 0 && qj >= 0 && qi < W && qj < W && inside[q] && comp[q] < 0) { comp[q] = id; stack.push(q); } }
    }
    sizes.push(n);
  }
  for (let k = 0; k < W * W; k++) if (inside[k] && sizes[comp[k]] < minPixels) inside[k] = 0;
}

// ---------- banners ----------

/**
 * Banner spots (in model units, the camp being 1 across): compact patches standing more than 0.14 above the heightmap's
 * opening by a 7 pixel square, at most 120 pixels and 24 across on a 256 px heightmap. Palisade stakes stand lower and
 * walls run long, so neither qualifies; a patch too big to be a banner (a banner joined to a screen) gives up its top,
 * the parts within 0.08 of its highest point. Returns the spots and the heightmap with them levelled away.
 */
function findBanners(W, G, grid) {
  // The limits are set for a 256 px heightmap and scale with it.
  const k = grid / 256, rise = 0.14, maxArea = 120 * k * k, maxSide = 24 * k;
  const O = opening(W, G, Math.max(1, Math.round(3 * k)));
  const D = Float64Array.from(G, (g, k) => g - O[k]);
  const patches = (set, floor) => {
    const left = new Set(set.filter((c) => D[c] > floor)), out = [];
    for (const k of left) {
      if (!left.has(k)) continue;
      const cells = [k], stack = [k];
      left.delete(k);
      while (stack.length) {
        const p = stack.pop(), pi = p % W, pj = Math.floor(p / W);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const q = (pj + dj) * W + pi + di;
          if (left.has(q)) { left.delete(q); cells.push(q); stack.push(q); }
        }
      }
      out.push(cells);
    }
    return out;
  };
  const compact = (cells) => {
    const is = cells.map((c) => c % W), js = cells.map((c) => Math.floor(c / W));
    return cells.length <= maxArea && Math.max(Math.max(...is) - Math.min(...is), Math.max(...js) - Math.min(...js)) + 1 <= maxSide;
  };
  const tall = [];
  for (let k = 0; k < W * W; k++) if (D[k] > rise) tall.push(k);
  const spots = [];
  for (const cells of patches(tall, rise)) {
    if (compact(cells)) { spots.push(cells); continue; }
    const top = Math.max(...cells.map((c) => D[c]));
    if (top - 0.08 > rise) for (const head of patches(cells, top - 0.08)) if (compact(head)) spots.push(head);
  }
  const level = G.slice();
  for (const cells of spots) for (const c of cells) {
    const ci = c % W, cj = Math.floor(c / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const qi = ci + di, qj = cj + dj;
      if (qi >= 0 && qj >= 0 && qi < W && qj < W) level[qj * W + qi] = Math.min(level[qj * W + qi], Math.max(O[qj * W + qi], O[c]));
    }
  }
  return { spots, level };
}

/**
 * A cloth card for each banner spot, and a pole card where the pole shows below the cloth. They come from the original
 * vertices within `reach` pixels of the spot that stand above `surface` (the levelled heightmap, which keeps palisades
 * and walls, so their vertices stay out): the vertices' principal horizontal axis is the cloth's direction, and bin by
 * bin up the height their width along it tells the cloth from the pole.
 */
function bannerCards(W, cell, x0, spots, surface, P, { reach = 3, above = 0.02, minWidth = 0.008, maxWidth = 0.09, poles = true } = {}) {
  const owner = new Int32Array(W * W).fill(-1);
  spots.forEach((cells, s) => {
    for (const c of cells) for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      const qi = (c % W) + di, qj = Math.floor(c / W) + dj;
      if (qi >= 0 && qj >= 0 && qi < W && qj < W && owner[qj * W + qi] < 0) owner[qj * W + qi] = s;
    }
  });
  const members = spots.map(() => []);
  for (let v = 0; v < P.length / 3; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const i = Math.round((x - x0) / cell - 0.5), j = Math.round((z - x0) / cell - 0.5);
    if (i < 0 || j < 0 || i >= W || j >= W) continue;
    const s = owner[j * W + i];
    if (s >= 0 && y > surface[j * W + i] + above) members[s].push([x, y, z, surface[j * W + i]]);
  }
  const cards = [];
  for (const pts of members) {
    if (pts.length < 4) continue;
    let y0 = Infinity, y1 = -Infinity, base = Infinity, mx = 0, mz = 0;
    for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); base = Math.min(base, p[3]); mx += p[0] / pts.length; mz += p[2] / pts.length; }
    let sxx = 0, sxz = 0, szz = 0;
    for (const [x, , z] of pts) { sxx += (x - mx) ** 2; sxz += (x - mx) * (z - mz); szz += (z - mz) ** 2; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), u = [Math.cos(ang), Math.sin(ang)];
    const along = (p) => (p[0] - mx) * u[0] + (p[2] - mz) * u[1];
    const v = pts.reduce((s, p) => s - (p[0] - mx) * u[1] + (p[2] - mz) * u[0], 0) / pts.length;
    const bins = 12, ext = Array.from({ length: bins }, () => [Infinity, -Infinity]);
    for (const p of pts) {
      const b = Math.min(bins - 1, Math.floor(((p[1] - y0) / (y1 - y0 || 1)) * bins)), t = along(p);
      ext[b][0] = Math.min(ext[b][0], t); ext[b][1] = Math.max(ext[b][1], t);
    }
    const widths = ext.map(([a, b]) => (b > a ? b - a : 0)), wmax = Math.max(...widths);
    const cloth = widths.map((w) => w >= Math.max(minWidth, wmax * 0.45));
    const c0 = cloth.indexOf(true), c1 = cloth.lastIndexOf(true);
    const corner = (t, y) => [mx + u[0] * t - u[1] * v, y, mz + u[1] * t + u[0] * v];
    const normal = [-u[1], 0, u[0]];
    let poleTop = y1;
    if (c0 >= 0) {
      let a = Infinity, b = -Infinity;
      for (let k = c0; k <= c1; k++) { a = Math.min(a, ext[k][0]); b = Math.max(b, ext[k][1]); }
      const yb = y0 + ((y1 - y0) * c0) / bins, yt = y0 + ((y1 - y0) * (c1 + 1)) / bins;
      if (b - a <= maxWidth && yt - yb >= 0.02) {
        cards.push({ kind: 'cloth', quad: [corner(a, yb), corner(b, yb), corner(b, yt), corner(a, yt)], normal });
        poleTop = yb;
      }
    }
    if (poles && poleTop - base > 0.03) {
      const low = pts.filter((p) => p[1] < poleTop);
      const t = low.length ? low.reduce((s, p) => s + along(p), 0) / low.length : 0, w = minWidth / 2;
      cards.push({ kind: 'pole', quad: [corner(t - w, base), corner(t + w, base), corner(t + w, poleTop), corner(t - w, poleTop)], normal });
    }
  }
  return cards;
}

// ---------- planar facets ----------

/** Least-squares plane y = a*i + b*j + c from accumulated sums [n, Si, Sj, Sy, Sii, Sij, Sjj, Siy, Sjy]. */
function solvePlane(s) {
  const [n, si, sj, sy, sii, sij, sjj, siy, sjy] = s;
  if (n < 3) return [0, 0, n ? sy / n : 0];
  const A = [[sii, sij, si], [sij, sjj, sj], [si, sj, n]], b = [siy, sjy, sy];
  const det3 = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const det = det3(A);
  if (Math.abs(det) < 1e-9 * Math.max(1, n * n * n)) return [0, 0, sy / n];
  const swap = (k) => det3(A.map((row, r) => row.map((x, c) => (c === k ? b[r] : x))));
  return [swap(0) / det, swap(1) / det, swap(2) / det];
}
const addSum = (s, i, j, y) => { s[0] += 1; s[1] += i; s[2] += j; s[3] += y; s[4] += i * i; s[5] += i * j; s[6] += j * j; s[7] += i * y; s[8] += j * y; };
/** A plane's unit normal in world units: its slopes are height per pixel, so they are divided by the pixel size. */
const unitNormal = ([a, b], cell) => { const l = Math.hypot(a / cell, b / cell, 1); return [-a / cell / l, 1 / l, -b / cell / l]; };

/** Keeps the regions that still own pixels, renumbered densely; `planeOf` gives each survivor its plane. */
function compactRegions(W, label, regions, pixels, planeOf) {
  const map = new Int32Array(regions.length).fill(OUT), out = [];
  regions.forEach((g, r) => { if (pixels[r].length) { map[r] = out.length; out.push({ sums: g.sums, plane: planeOf(r), area: pixels[r].length }); } });
  for (let k = 0; k < W * W; k++) if (label[k] >= 0) label[k] = map[label[k]];
  regions.length = 0;
  regions.push(...out);
}
const pixelsOf = (W, label, n) => { const px = Array.from({ length: n }, () => []); for (let k = 0; k < W * W; k++) if (label[k] >= 0) px[label[k]].push(k); return px; };
function neighbours(W, label, cells, own) {
  const counts = new Map();
  for (const p of cells) for (const [di, dj] of FOUR) {
    const qi = (p % W) + di, qj = Math.floor(p / W) + dj;
    const l = qi < 0 || qj < 0 || qi >= W || qj >= W ? OUT : label[qj * W + qi];
    if (l !== own) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return counts;
}
const meanResidual = (W, Hs, cells, [a, b, c]) => cells.reduce((e, p) => e + Math.abs(Hs[p] - (a * (p % W) + b * Math.floor(p / W) + c)), 0) / cells.length;

/**
 * Cuts the footprint into planar regions: flattest pixels first, each region grows while a pixel lies within `eps` of
 * its plane (refitted as it grows), which stops it at steps and at creases. Then specks under `minArea` join the
 * neighbour that fits them best; compact bumps under `bumpArea` lying on a neighbour that faces the same way (merlons,
 * cannons, bollards) are flattened into it; and neighbours one plane fits within 1.5 `eps` become one.
 */
function segment(W, Hs, inside, { eps, minArea, bumpArea, bumpHeight, cell }) {
  const label = new Int32Array(W * W).fill(OUT);
  for (let k = 0; k < W * W; k++) if (inside[k]) label[k] = -2;
  const rough = new Float64Array(W * W).fill(Infinity);
  for (let j = 1; j < W - 1; j++) for (let i = 1; i < W - 1; i++) {
    const k = j * W + i;
    if (!inside[k]) continue;
    const s = new Array(9).fill(0);
    let ok = true;
    for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1; di++) { const q = k + dj * W + di; if (!inside[q]) { ok = false; break; } addSum(s, di, dj, Hs[q]); }
    if (!ok) continue;
    const [a, b, c] = solvePlane(s);
    let r = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) r = Math.max(r, Math.abs(Hs[k + dj * W + di] - (a * di + b * dj + c)));
    rough[k] = r;
  }
  const order = [];
  for (let k = 0; k < W * W; k++) if (inside[k]) order.push(k);
  order.sort((x, y) => rough[x] - rough[y]);
  const regions = [], queue = new Int32Array(W * W);
  for (const seed of order) {
    if (label[seed] !== -2) continue;
    const r = regions.length, own = new Array(9).fill(0), si = seed % W, sj = Math.floor(seed / W);
    // The seed's own 3x3 plane starts it off.
    const local = new Array(9).fill(0);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const q = seed + dj * W + di; if (inside[q]) addSum(local, si + di, sj + dj, Hs[q]); }
    let plane = solvePlane(local), head = 0, tail = 0, refit = 8;
    queue[tail++] = seed; label[seed] = r; addSum(own, si, sj, Hs[seed]);
    while (head < tail) {
      const p = queue[head++], pi = p % W, pj = Math.floor(p / W);
      for (const [di, dj] of FOUR) {
        const qi = pi + di, qj = pj + dj, q = qj * W + qi;
        if (qi < 0 || qj < 0 || qi >= W || qj >= W || label[q] !== -2) continue;
        if (Math.abs(Hs[q] - (plane[0] * qi + plane[1] * qj + plane[2])) > eps) continue;
        label[q] = r; addSum(own, qi, qj, Hs[q]); queue[tail++] = q;
        if (tail >= refit) { plane = solvePlane(own); refit = Math.ceil(tail * 1.5); }
      }
    }
    regions.push({ sums: own, plane: solvePlane(own), area: tail });
  }
  // Specks join the neighbour whose plane fits them best, taking that plane as it is.
  {
    const px = pixelsOf(W, label, regions.length);
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      const small = regions.map((g, r) => r).filter((r) => px[r].length && px[r].length < minArea).sort((x, y) => px[x].length - px[y].length);
      for (const r of small) {
        if (!px[r].length || px[r].length >= minArea) continue;
        let best = OUT, bestErr = Infinity;
        const around = neighbours(W, label, px[r], r);
        for (const [l] of around) if (l >= 0 && px[l].length) { const e = meanResidual(W, Hs, px[r], regions[l].plane); if (e < bestErr) { bestErr = e; best = l; } }
        if (best === OUT && !around.has(OUT)) continue;
        for (const p of px[r]) label[p] = best;
        if (best >= 0) px[best] = px[best].concat(px[r]);
        px[r] = []; changed = true;
      }
      if (!changed) break;
    }
    compactRegions(W, label, regions, px, (r) => regions[r].plane);
  }
  for (let round = 0; round < 2; round++) {
    // Bumps on a surface facing the same way are flattened into it.
    const px = pixelsOf(W, label, regions.length);
    const cos = Math.cos((25 * Math.PI) / 180);
    const order2 = regions.map((g, r) => r).filter((r) => px[r].length < bumpArea).sort((x, y) => px[x].length - px[y].length);
    for (const r of order2) {
      if (!px[r].length || px[r].length >= bumpArea) continue;
      // Bumps are compact; a long strip (a wall top, a parapet) is structure however low it stands.
      const is = px[r].map((p) => p % W), js = px[r].map((p) => Math.floor(p / W));
      if (Math.max(Math.max(...is) - Math.min(...is), Math.max(...js) - Math.min(...js)) + 1 > 3 * Math.sqrt(px[r].length)) continue;
      const nr = unitNormal(regions[r].plane, cell);
      let best = -1, bestErr = bumpHeight;
      for (const [l] of neighbours(W, label, px[r], r)) {
        if (l < 0 || !px[l].length) continue;
        const nl = unitNormal(regions[l].plane, cell);
        if (nr[0] * nl[0] + nr[1] * nl[1] + nr[2] * nl[2] < cos) continue;
        const e = meanResidual(W, Hs, px[r], regions[l].plane);
        if (e < bestErr) { bestErr = e; best = l; }
      }
      if (best < 0) continue;
      for (const p of px[r]) label[p] = best;
      px[best] = px[best].concat(px[r]);
      px[r] = [];
    }
    compactRegions(W, label, regions, px, (r) => regions[r].plane);
    mergeCoplanar(W, Hs, label, regions, eps * 1.5);
  }
  return { label, regions };
}

/** Neighbouring regions whose pixels one plane fits within `tol` become one (longest shared boundary first). */
function mergeCoplanar(W, Hs, label, regions, tol) {
  const px = pixelsOf(W, label, regions.length);
  const parent = regions.map((g, r) => r), sums = regions.map((g) => g.sums.slice());
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let round = 0; round < 4; round++) {
    const shared = new Map();
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const a = label[j * W + i];
      if (a < 0) continue;
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        if (i + di >= W || j + dj >= W) continue;
        const b = label[(j + dj) * W + i + di];
        if (b < 0) continue;
        const x = find(a), y = find(b);
        if (x !== y) { const key = x < y ? `${x},${y}` : `${y},${x}`; shared.set(key, (shared.get(key) ?? 0) + 1); }
      }
    }
    let merged = 0;
    for (const [key] of [...shared].sort((p, q) => q[1] - p[1])) {
      const [x, y] = key.split(',').map((n) => find(Number(n)));
      if (x === y) continue;
      const s = sums[x].map((v, n) => v + sums[y][n]), [a, b, c] = solvePlane(s);
      const fits = (cells) => cells.every((p) => Math.abs(Hs[p] - (a * (p % W) + b * Math.floor(p / W) + c)) <= tol);
      if (!fits(px[x]) || !fits(px[y])) continue;
      parent[y] = x; sums[x] = s; px[x] = px[x].concat(px[y]); px[y] = [];
      merged += 1;
    }
    for (let k = 0; k < W * W; k++) if (label[k] >= 0) label[k] = find(label[k]);
    if (!merged) break;
  }
  regions.forEach((g, r) => { g.sums = sums[r]; });
  compactRegions(W, label, regions, px, (r) => solvePlane(sums[r]));
}

// ---------- boundaries ----------

/** Breaks every 2x2 pattern where one region's pixels meet only diagonally, so no boundary pinches at a corner. */
function unpinch(W, label) {
  for (let pass = 0; pass < 8; pass++) {
    let fixed = 0;
    for (let j = 0; j + 1 < W; j++) for (let i = 0; i + 1 < W; i++) {
      const a = label[j * W + i], b = label[j * W + i + 1], c = label[(j + 1) * W + i], d = label[(j + 1) * W + i + 1];
      if (a === d && a !== b && a !== c) { label[j * W + i + 1] = a; fixed += 1; }
      else if (b === c && b !== a && b !== d) { label[j * W + i] = b; fixed += 1; }
    }
    if (!fixed) break;
  }
}

/**
 * The label image's boundaries on the grid of pixel corners, as chains between junctions (corners where three or more
 * regions meet) and closed loops: each with its corner path and the regions on its left and right (i east, j south).
 */
function traceChains(W, label) {
  const L = (i, j) => (i < 0 || j < 0 || i >= W || j >= W ? OUT : label[j * W + i]);
  const hEdge = (i, j) => L(i, j - 1) !== L(i, j);
  const vEdge = (i, j) => L(i - 1, j) !== L(i, j);
  const dirs = (i, j) => {
    const out = [];
    if (i < W && hEdge(i, j)) out.push([1, 0]);
    if (i > 0 && hEdge(i - 1, j)) out.push([-1, 0]);
    if (j < W && vEdge(i, j)) out.push([0, 1]);
    if (j > 0 && vEdge(i, j - 1)) out.push([0, -1]);
    return out;
  };
  const junction = (i, j) => new Set([L(i - 1, j - 1), L(i, j - 1), L(i - 1, j), L(i, j)]).size >= 3;
  const sides = (i, j, di, dj) => (di === 1 ? [L(i, j - 1), L(i, j)] : di === -1 ? [L(i - 1, j), L(i - 1, j - 1)] : dj === 1 ? [L(i, j), L(i - 1, j)] : [L(i - 1, j - 1), L(i, j - 1)]);
  const edgeKey = (i, j, di, dj) => (di === 1 ? `h${i},${j}` : di === -1 ? `h${i - 1},${j}` : dj === 1 ? `v${i},${j}` : `v${i},${j - 1}`);
  const visited = new Set(), out = [];
  const walk = (i0, j0, di0, dj0) => {
    const [left, right] = sides(i0, j0, di0, dj0);
    const path = [[i0, j0]];
    let i = i0, j = j0, di = di0, dj = dj0;
    for (;;) {
      visited.add(edgeKey(i, j, di, dj));
      i += di; j += dj;
      path.push([i, j]);
      if (junction(i, j) || (i === i0 && j === j0)) break;
      const next = dirs(i, j).filter(([a, b]) => !(a === -di && b === -dj));
      if (next.length !== 1) break;
      [di, dj] = next[0];
    }
    out.push({ path, left, right });
  };
  for (const pass of [true, false]) for (let j = 0; j <= W; j++) for (let i = 0; i <= W; i++) {
    if (pass && !junction(i, j)) continue;
    for (const [di, dj] of dirs(i, j)) if (!visited.has(edgeKey(i, j, di, dj))) walk(i, j, di, dj);
  }
  return out;
}

function douglasPeucker(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    let best = -1, dist = tol;
    for (let k = a + 1; k < b; k++) {
      const d = len ? Math.abs((pts[k][0] - ax) * dz - (pts[k][1] - az) * dx) / len : Math.hypot(pts[k][0] - ax, pts[k][1] - az);
      if (d > dist) { dist = d; best = k; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((p, k) => keep[k]);
}

/** A chain straightened within `tol` pixels; a loop is split at its farthest corner and kept at least a triangle. */
function simplifyChain(path, tol) {
  const loop = path.length > 3 && path[0][0] === path.at(-1)[0] && path[0][1] === path.at(-1)[1];
  if (!loop) return douglasPeucker(path, tol);
  const p = path.slice(0, -1);
  let far = 0;
  for (let k = 0; k < p.length; k++) if (Math.hypot(p[k][0] - p[0][0], p[k][1] - p[0][1]) > Math.hypot(p[far][0] - p[0][0], p[far][1] - p[0][1])) far = k;
  const ring = [...douglasPeucker(p.slice(0, far + 1), tol), ...douglasPeucker([...p.slice(far), p[0]], tol).slice(1)];
  if (ring.length >= 4) return ring;
  let third = 0, area = -1;
  for (let k = 0; k < p.length; k++) {
    const a = Math.abs((p[k][0] - p[0][0]) * (p[far][1] - p[0][1]) - (p[k][1] - p[0][1]) * (p[far][0] - p[0][0]));
    if (a > area) { area = a; third = k; }
  }
  return [...[0, far, third].sort((x, y) => x - y).map((k) => p[k]), p[0]];
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const properCross = (p1, p2, q1, q2) => {
  const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
  return d1 * d2 < 0 && d3 * d4 < 0;
};

/** Every chain straightened, with no two segments crossing: chains that would cross are redone at a smaller tolerance. */
function simplifyAll(list, tol) {
  const tolOf = list.map(() => tol);
  const simple = list.map((ch) => simplifyChain(ch.path, tol));
  for (let round = 0; round < 6; round++) {
    const segs = [], bucket = new Map(), size = 8;
    simple.forEach((pts, c) => { for (let k = 0; k + 1 < pts.length; k++) segs.push([c, pts[k], pts[k + 1]]); });
    segs.forEach((s, n) => {
      for (let x = Math.floor(Math.min(s[1][0], s[2][0]) / size); x <= Math.floor(Math.max(s[1][0], s[2][0]) / size); x++)
        for (let z = Math.floor(Math.min(s[1][1], s[2][1]) / size); z <= Math.floor(Math.max(s[1][1], s[2][1]) / size); z++) {
          const key = `${x},${z}`;
          (bucket.get(key) ?? bucket.set(key, []).get(key)).push(n);
        }
    });
    const bad = new Set();
    for (const ids of bucket.values()) for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const s = segs[ids[a]], t = segs[ids[b]];
      if (properCross(s[1], s[2], t[1], t[2])) { bad.add(s[0]); bad.add(t[0]); }
    }
    if (!bad.size) break;
    for (const c of bad) { tolOf[c] *= 0.5; simple[c] = tolOf[c] < 0.3 ? list[c].path.slice() : simplifyChain(list[c].path, tolOf[c]); }
  }
  return simple;
}

/** Each region's boundary rings (region on the left) assembled from the simplified chains. */
function regionRings(list, simple) {
  const halves = new Map(), at = (p) => `${p[0]},${p[1]}`;
  list.forEach((ch, c) => {
    for (const [region, seq] of [[ch.left, simple[c]], [ch.right, simple[c].slice().reverse()]]) {
      if (region === OUT) continue;
      const m = halves.get(region) ?? halves.set(region, new Map()).get(region);
      (m.get(at(seq[0])) ?? m.set(at(seq[0]), []).get(at(seq[0]))).push(seq);
    }
  });
  const result = new Map();
  for (const [region, m] of halves) {
    const used = new Set(), polys = [];
    for (const seqs of m.values()) for (const seq of seqs) {
      if (used.has(seq)) continue;
      const ring = [];
      for (let cur = seq, guard = 0; cur && !used.has(cur) && guard < 100000; guard++) {
        used.add(cur);
        ring.push(...cur.slice(0, -1));
        cur = (m.get(at(cur.at(-1))) ?? []).find((s) => !used.has(s));
      }
      if (ring.length >= 3) polys.push(ring);
    }
    result.set(region, polys);
  }
  return result;
}

const signedArea = (ring) => ring.reduce((a, p, k) => { const q = ring[(k + 1) % ring.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
function pointInRing([x, z], ring) {
  let inside = false;
  for (let k = 0, m = ring.length - 1; k < ring.length; m = k++) {
    const [xi, zi] = ring[k], [xj, zj] = ring[m];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** A region's triangles in corner coordinates: its outer rings (negative area, region on the left) with their holes. */
function triangulateRegion(polys) {
  const outers = polys.filter((r) => signedArea(r) < 0), holes = polys.filter((r) => signedArea(r) > 0), tris = [];
  for (const outer of outers) {
    const mine = holes.filter((h) => pointInRing(h[0], outer) || pointInRing([(h[0][0] + h[1][0]) / 2, (h[0][1] + h[1][1]) / 2], outer));
    const faces = ShapeUtils.triangulateShape(outer.map(([x, z]) => new Vector2(x, z)), mine.map((h) => h.map(([x, z]) => new Vector2(x, z))));
    const pts = [...outer, ...mine.flat()];
    for (const [a, b, c] of faces) tris.push([pts[a], pts[b], pts[c]]);
  }
  return tris;
}

/**
 * The facets of a segmented heightmap as triangles [a, b, c, normal]: each region at its plane's heights (averaged
 * with its neighbours along creases, chains where two regions stay within `creaseTol` of each other), and a vertical
 * wall along every other chain, facing the lower side. Corner (i, j) of the pixel grid is world (x0 + i cell, x0 + j cell).
 */
function facetTriangles(W, cell, x0, label, regions, { tol, creaseTol }) {
  unpinch(W, label);
  const list = traceChains(W, label);
  const simple = simplifyAll(list, tol);
  const rings = regionRings(list, simple);
  const planeHeight = (r, p) => { const [a, b, c] = regions[r].plane; return a * (p[0] - 0.5) + b * (p[1] - 0.5) + c; };
  const at = (p) => `${p[0]},${p[1]}`;
  const crease = list.map((ch, c) => ch.left !== OUT && ch.right !== OUT && simple[c].every((p) => Math.abs(planeHeight(ch.left, p) - planeHeight(ch.right, p)) < creaseTol));
  const parent = new Map(), byCorner = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  list.forEach((ch, c) => {
    for (const p of simple[c]) {
      const k = at(p), m = byCorner.get(k) ?? byCorner.set(k, new Map()).get(k);
      for (const r of [ch.left, ch.right]) if (r !== OUT && !m.has(r)) { m.set(r, planeHeight(r, p)); parent.set(`${k}|${r}`, `${k}|${r}`); }
      if (crease[c]) { const a = find(`${k}|${ch.left}`), b = find(`${k}|${ch.right}`); if (a !== b) parent.set(a, b); }
    }
  });
  const height = new Map();
  for (const [k, m] of byCorner) {
    const groups = new Map();
    for (const [r, h] of m) { const g = find(`${k}|${r}`); (groups.get(g) ?? groups.set(g, []).get(g)).push([r, h]); }
    for (const members of groups.values()) { const avg = members.reduce((s, [, h]) => s + h, 0) / members.length; for (const [r] of members) height.set(`${k}|${r}`, avg); }
  }
  const y = (p, r) => (r === OUT ? 0 : height.get(`${at(p)}|${r}`) ?? planeHeight(r, p));
  const X = (p) => x0 + p[0] * cell, Z = (p) => x0 + p[1] * cell;
  const tris = [];
  const push = (a, b, c, n) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (Math.hypot(...g) < 1e-12) return;
    tris.push(g[0] * n[0] + g[1] * n[1] + g[2] * n[2] >= 0 ? [a, b, c, n] : [a, c, b, n]);
  };
  for (const [r, polys] of rings) {
    const n = unitNormal(regions[r].plane, cell);
    for (const [p, q, s] of triangulateRegion(polys)) push([X(p), y(p, r), Z(p)], [X(q), y(q, r), Z(q)], [X(s), y(s, r), Z(s)], n);
  }
  list.forEach((ch, c) => {
    if (crease[c]) return;
    const pts = simple[c];
    for (let k = 0; k + 1 < pts.length; k++) {
      const p = pts[k], q = pts[k + 1];
      const lp = y(p, ch.left), lq = y(q, ch.left), rp = y(p, ch.right), rq = y(q, ch.right);
      if (Math.abs(lp - rp) < 1e-5 && Math.abs(lq - rq) < 1e-5) continue;
      const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz), s = lp + lq >= rp + rq ? 1 : -1;
      const n = [(-dz / len) * s, 0, (dx / len) * s];
      const tp = Math.max(lp, rp), bp = Math.min(lp, rp), tq = Math.max(lq, rq), bq = Math.min(lq, rq);
      push([X(p), tp, Z(p)], [X(q), tq, Z(q)], [X(q), bq, Z(q)], n);
      push([X(p), tp, Z(p)], [X(q), bq, Z(q)], [X(p), bp, Z(p)], n);
    }
  });
  return { tris, regions: regions.length };
}

// ---------- the camp ----------

/** The footprint of a heightmap: where there is geometry, without crumbs, with bollards and posts off its outline. */
function footprint(W, H, grid) {
  const inside = new Uint8Array(W * W), minPixels = 200 * (grid / 256) ** 2;
  for (let k = 0; k < W * W; k++) inside[k] = H[k] > -Infinity ? 1 : 0;
  keepLarge(W, inside, minPixels);
  const open = opening(W, Float64Array.from(inside), grid >= 256 ? 3 : 2);
  for (let k = 0; k < W * W; k++) inside[k] = open[k] > 0.5 ? 1 : 0;
  keepLarge(W, inside, minPixels);
  return inside;
}

/** The banner and pole cards of a camp, found once on a 256 px heightmap and shared by every level. */
export function campCards(P, I) {
  const { W, cell, x0, H } = heightmap(P, I, 256);
  const inside = footprint(W, H, 256);
  const { spots, level } = findBanners(W, Float64Array.from(H, (h, k) => (inside[k] ? h : 0)), 256);
  return bannerCards(W, cell, x0, spots, level, P);
}

/**
 * A camp's low-poly shape from its normalised original (positions P, indices I): facet triangles plus the `cards`, at
 * most `budget` triangles. On a fine heightmap the banners (already cards) are levelled away; a 3x3 opening then
 * takes off what is thinner still, and on a coarse one the banners are specks it takes too. The plane tolerance stays fixed while
 * the budget loop grows the bump merging and the edge tolerance (up to `maxTol` pixels) until the shape fits.
 */
export function campShape(P, I, { budget, grid, maxTol, cards, creaseTol, maxBump, minArea }) {
  const { W, cell, x0, H } = heightmap(P, I, grid);
  const inside = footprint(W, H, grid);
  const G = Float64Array.from(H, (h, k) => (inside[k] ? h : 0));
  const levelled = grid >= 160 ? findBanners(W, G, grid).level : G;
  const base = opening(W, levelled, 1);
  // A 3x3 median takes the speckle out of Meshy's surfaces before the plane fits.
  const Hs = base.slice();
  for (let j = 1; j < W - 1; j++) for (let i = 1; i < W - 1; i++) {
    const k = j * W + i;
    if (!inside[k]) continue;
    const v = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (inside[k + dj * W + di]) v.push(base[k + dj * W + di]);
    v.sort((a, b) => a - b);
    Hs[k] = v[v.length >> 1];
  }
  const cardTris = cards.flatMap(({ quad: [a, b, c, d], normal }) => [[a, b, c, normal], [a, c, d, normal]]);
  let opts = { eps: 0.005, minArea, bumpArea: 160, bumpHeight: 0.03, tol: 1, creaseTol }, best = null;
  for (let step = 0; step < 24; step++) {
    const { label, regions } = segment(W, Hs, inside, { ...opts, cell });
    const facets = facetTriangles(W, cell, x0, label, regions, opts);
    best = { tris: [...facets.tris, ...cardTris], regions: facets.regions, settings: { ...opts } };
    if (best.tris.length <= budget) break;
    opts = { ...opts, tol: Math.min(maxTol, opts.tol * 1.2), bumpArea: Math.round(opts.bumpArea * 1.3), bumpHeight: Math.min(maxBump, opts.bumpHeight * 1.1) };
  }
  if (best.tris.length > budget) throw new Error(`no shape within ${budget} triangles (${best.tris.length})`);
  return best;
}
