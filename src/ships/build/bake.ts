/**
 * Baked grime for the procedural ships, pure CPU like the rest of the builder. The near model is voxelised once and
 * every vertex of every LOD samples that grid around its normal: crevices, joints, the underside of eaves and the
 * deck below a sail get darker (ambient occlusion folded into the vertex tint). Vertices near a gun port or the
 * dragon's mouth also get a soot amount the material turns into a scorch.
 */
import type { ShipAnchors } from '../anchors';
import type { MeshData } from './parts';

const CELL = 0.25;
const MAX_CELLS = 4_000_000;
/** Sample distances along each ray (m) and how much a hit there counts. */
const DIST = [0.42, 0.85, 1.5];
const WEIGHT = [1, 0.7, 0.45];
const TILT = 0.6;

type Grid = { min: [number, number, number]; n: [number, number, number]; cell: number; occ: Uint8Array };

function voxelise(m: MeshData): Grid {
  const p = m.position;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k]!, p[i + k]!);
      max[k] = Math.max(max[k]!, p[i + k]!);
    }
  }
  const pad = DIST[DIST.length - 1]! + 0.5;
  for (let k = 0; k < 3; k += 1) {
    min[k]! -= pad;
    max[k]! += pad;
  }
  const vol = (max[0]! - min[0]!) * (max[1]! - min[1]!) * (max[2]! - min[2]!);
  const cell = Math.max(CELL, Math.cbrt(vol / MAX_CELLS));
  const n: [number, number, number] = [Math.ceil((max[0]! - min[0]!) / cell), Math.ceil((max[1]! - min[1]!) / cell), Math.ceil((max[2]! - min[2]!) / cell)];
  const occ = new Uint8Array(n[0] * n[1] * n[2]);
  const mark = (x: number, y: number, z: number) => {
    const ix = Math.floor((x - min[0]) / cell);
    const iy = Math.floor((y - min[1]) / cell);
    const iz = Math.floor((z - min[2]) / cell);
    if (ix >= 0 && iy >= 0 && iz >= 0 && ix < n[0] && iy < n[1] && iz < n[2]) occ[ix + n[0] * (iy + n[1] * iz)] = 1;
  };
  const idx = m.index;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3;
    const b = idx[t + 1]! * 3;
    const c = idx[t + 2]! * 3;
    const longest = Math.max(Math.hypot(p[a]! - p[b]!, p[a + 1]! - p[b + 1]!, p[a + 2]! - p[b + 2]!), Math.hypot(p[b]! - p[c]!, p[b + 1]! - p[c + 1]!, p[b + 2]! - p[c + 2]!), Math.hypot(p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!));
    const steps = Math.max(1, Math.ceil(longest / (cell * 0.6)));
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= steps - i; j += 1) {
        const u = i / steps;
        const v = j / steps;
        const w = 1 - u - v;
        mark(p[a]! * w + p[b]! * u + p[c]! * v, p[a + 1]! * w + p[b + 1]! * u + p[c + 1]! * v, p[a + 2]! * w + p[b + 2]! * u + p[c + 2]! * v);
      }
    }
  }
  return { min, n, cell, occ };
}

const hit = (g: Grid, x: number, y: number, z: number) => {
  const ix = Math.floor((x - g.min[0]) / g.cell);
  const iy = Math.floor((y - g.min[1]) / g.cell);
  const iz = Math.floor((z - g.min[2]) / g.cell);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= g.n[0] || iy >= g.n[1] || iz >= g.n[2]) return 0;
  return g.occ[ix + g.n[0] * (iy + g.n[1] * iz)]!;
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Where soot collects: a point on the outside and the way the blast goes. */
function sootSources(anchors: ShipAnchors) {
  const out: { p: [number, number, number]; d: [number, number, number]; r: number }[] = [];
  for (const g of anchors.gunPorts) out.push({ p: g.pos, d: g.dir, r: 1.5 });
  if (anchors.smokeStack) out.push({ p: anchors.smokeStack, d: [1, 0, 0], r: 3.2 });
  return out;
}

/** Soot (0..1) rides in the fraction of the surface class in `mat`, scaled by this: one vertex attribute less for the GPU to hold. */
export const SOOT_STEP = 0.4;

/** Multiplies the vertex tint of every LOD by the occlusion of the near model and adds the soot to the surface class. */
export function bakeGrime(lods: MeshData[], anchors: ShipAnchors) {
  const grid = voxelise(lods[0]!);
  const sources = sootSources(anchors);
  const dirs: [number, number, number][] = [];
  for (const m of lods) {
    const { position: p, normal: nr, color: col, mat } = m;
    const count = p.length / 3;
    for (let i = 0; i < count; i += 1) {
      const nx = nr[i * 3]!;
      const ny = nr[i * 3 + 1]!;
      const nz = nr[i * 3 + 2]!;
      // Tangent frame around the normal for the four tilted rays.
      const ax = Math.abs(ny) < 0.9 ? 0 : 1;
      let t1x = ax === 0 ? 0 : 1;
      let t1y = ax === 0 ? 1 : 0;
      let t1z = 0;
      let tx = t1y * nz - t1z * ny;
      let ty = t1z * nx - t1x * nz;
      let tz = t1x * ny - t1y * nx;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      t1x = ny * tz - nz * ty;
      t1y = nz * tx - nx * tz;
      t1z = nx * ty - ny * tx;
      dirs.length = 0;
      dirs.push([nx, ny, nz]);
      for (const s of [-1, 1]) {
        dirs.push([nx + s * TILT * tx, ny + s * TILT * ty, nz + s * TILT * tz], [nx + s * TILT * t1x, ny + s * TILT * t1y, nz + s * TILT * t1z]);
      }
      let open = 0;
      let total = 0;
      for (const d of dirs) {
        const dl = Math.hypot(d[0], d[1], d[2]) || 1;
        for (let k = 0; k < DIST.length; k += 1) {
          const r = DIST[k]! / dl;
          total += WEIGHT[k]!;
          if (!hit(grid, p[i * 3]! + d[0] * r, p[i * 3 + 1]! + d[1] * r, p[i * 3 + 2]! + d[2] * r)) open += WEIGHT[k]!;
        }
      }
      const ao = 0.4 + 0.6 * Math.pow(open / total, 1.4);
      col[i * 3]! *= ao;
      col[i * 3 + 1]! *= ao;
      col[i * 3 + 2]! *= ao;
      let s = 0;
      for (const src of sources) {
        const dx = p[i * 3]! - src.p[0];
        const dy = p[i * 3 + 1]! - src.p[1];
        const dz = p[i * 3 + 2]! - src.p[2];
        const along = dx * src.d[0] + dy * src.d[1] + dz * src.d[2];
        if (along < -1.2 || along > 1.4) continue;
        const lx = dx - src.d[0] * along;
        const ly = dy - src.d[1] * along;
        const lz = dz - src.d[2] * along;
        // Soot climbs above the port further than it falls below it.
        const dist = Math.hypot(lx, ly * (ly > 0 ? 0.55 : 1.5), lz) + Math.abs(along) * 0.5;
        s = Math.max(s, 1 - smooth(src.r * 0.25, src.r, dist));
      }
      mat[i * 2 + 1]! += s * SOOT_STEP;
    }
  }
}
