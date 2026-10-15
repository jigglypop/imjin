import { MeshBuilder, type MeshData, type Paint } from '../../../ships/build/parts';
import { bakeGrime } from '../../../ships/build/bake';
import { buildingPaints } from '../buildingAtlas';
import type { Kit } from '../kitParts';
import type { FactionId } from '../types';
import { buildPiece } from './pieces';
import type { Facing, Pad, Piece, Plan } from './plan';

// A hero camp's plan turned into meshes: every piece built once in its own frame for each level of detail, its occlusion
// baked there with the ground under it, then stamped where it stands (barracks in a row are one build); the pads'
// retaining skirts down to the ground; one mesh per navy and level for the whole camp. Pure TS (node runs it in tests).

export interface HeroMesh { navy: FactionId; near: MeshData; far: MeshData; triangles: number }

/** The vertex streams of a mesh being put together from stamped pieces. */
class Merge {
  p: number[] = []; n: number[] = []; uv: number[] = []; c: number[] = []; m: number[] = []; s: number[] = []; idx: number[] = [];

  /** Adds `d` turned by `rot` about the vertical (three's rotation.y) and moved to (x, y, z). */
  stamp(d: MeshData, x: number, y: number, z: number, rot: number) {
    const base = this.p.length / 3, c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < d.position.length; i += 3) {
      const px = d.position[i]!, py = d.position[i + 1]!, pz = d.position[i + 2]!;
      this.p.push(px * c + pz * s + x, py + y, -px * s + pz * c + z);
      const nx = d.normal[i]!, ny = d.normal[i + 1]!, nz = d.normal[i + 2]!;
      this.n.push(nx * c + nz * s, ny, -nx * s + nz * c);
    }
    for (const v of d.uv) this.uv.push(v);
    for (const v of d.color) this.c.push(v);
    for (const v of d.mat) this.m.push(v);
    for (const v of d.sway) this.s.push(v);
    for (const i of d.index) this.idx.push(i + base);
  }

  data(): MeshData {
    return {
      position: new Float32Array(this.p), normal: new Float32Array(this.n), uv: new Float32Array(this.uv), color: new Float32Array(this.c),
      mat: new Float32Array(this.m), sway: new Float32Array(this.s), index: new Uint32Array(this.idx),
    };
  }
}

/** Where a piece stands: its origin in the site's frame, its turn, and for a wall its half length. */
function placeOf(p: Piece) {
  if (p.kind === 'wall') {
    const dx = p.b[0] - p.a[0], dz = p.b[1] - p.a[1], L = Math.hypot(dx, dz);
    // Its local +z is the line's outward side, (dz, -dx) for an outline wound like `rect`; its ends overlap the next run.
    return { x: (p.a[0] + p.b[0]) / 2, y: p.y, z: (p.a[1] + p.b[1]) / 2, rot: Math.atan2(dz, -dx), L: L / 2 + p.thick * 0.22 };
  }
  if (p.kind === 'tenshu' || p.kind === 'yamen' || p.kind === 'tree' || p.kind === 'soldiers') return { x: p.x, y: p.y, z: p.z, rot: 0, L: 0 };
  // Flags all fly east, square to a camera looking north.
  if (p.kind === 'banner') return { x: p.x, y: p.y, z: p.z, rot: 0, L: 0 };
  return { x: p.x, y: p.y, z: p.z, rot: p.rot, L: 0 };
}

/** What makes two pieces the same build: everything but where they stand. */
function keyOf(navy: FactionId, p: Piece, L: number) {
  const { x: _x, z: _z, y: _y, rot: _r, a: _a, b: _b, ...rest } = p as Piece & { x?: number; z?: number; y?: number; rot?: number; a?: unknown; b?: unknown };
  return `${navy}|${JSON.stringify(rest)}|${L.toFixed(2)}`;
}

/** The paint of a pad's retaining face in a navy's atlas. */
function facingPaint(P: Kit['P'], navy: FactionId, face: Facing): Paint {
  switch (face) {
    case 'granite': return P(navy === 'japan' ? 'ishigaki' : navy === 'ming' ? 'stone' : 'granite');
    case 'rubble': return navy === 'joseon' ? P('fieldstone') : P(navy === 'japan' ? 'ishigaki' : 'stone', { tint: [0.9, 0.88, 0.85] });
    case 'ishigaki': return P(navy === 'japan' ? 'ishigaki' : navy === 'ming' ? 'stone' : 'granite');
    case 'brick': return P(navy === 'ming' ? 'brick' : navy === 'japan' ? 'ishigaki' : 'granite');
    case 'earth': return navy === 'joseon' ? P('mud', { tint: [0.62, 0.54, 0.44] }) : P(navy === 'japan' ? 'ishigaki' : 'stone', { tint: [0.72, 0.62, 0.5] });
  }
}

/**
 * A pad's retaining skirt: from its edge at h0 down to the ground a step outside it (or to the terrace below), a little
 * battered, its top course lighter and its foot darker where earth and damp gather. None where the ground stands higher.
 */
function skirt(b: MeshBuilder, paint: Paint, pad: Pad, natural: (x: number, z: number) => number) {
  const poly = pad.poly, n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i += 1) area += poly[i]![0] * poly[(i + 1) % n]![1] - poly[(i + 1) % n]![0] * poly[i]![1];
  const sign = area >= 0 ? 1 : -1;
  const top = paint.tinted([paint.tint[0] * 1.06, paint.tint[1] * 1.05, paint.tint[2] * 1.03]);
  const foot = paint.tinted([paint.tint[0] * 0.62, paint.tint[1] * 0.6, paint.tint[2] * 0.58]);
  let run = 0;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i]!, c = poly[(i + 1) % n]!;
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L < 1e-6) continue;
    const ox = (sign * (c[1] - a[1])) / L, oz = (-sign * (c[0] - a[0])) / L;
    const k = Math.max(1, Math.ceil(L / 2));
    const groundAt = (x: number, z: number) => (pad.floor !== undefined ? pad.floor : natural(x + ox * 1.5, z + oz * 1.5));
    for (let j = 0; j < k; j += 1) {
      const t0 = j / k, t1 = (j + 1) / k;
      const x0 = a[0] + (c[0] - a[0]) * t0, z0 = a[1] + (c[1] - a[1]) * t0, x1 = a[0] + (c[0] - a[0]) * t1, z1 = a[1] + (c[1] - a[1]) * t1;
      const g0 = Math.min(groundAt(x0, z0), pad.h0), g1 = Math.min(groundAt(x1, z1), pad.h0);
      const u0 = run + t0 * L, u1 = run + t1 * L;
      if (pad.h0 - g0 < 0.05 && pad.h0 - g1 < 0.05) continue;
      // The foot reaches a little under the ground (or the sea) so no seam of light shows under it.
      const f0 = Math.max(-1.5, g0 - 0.35), f1 = Math.max(-1.5, g1 - 0.35);
      const lean = 0.12;
      const P0: [number, number, number] = [x0 + ox * lean * (pad.h0 - f0), f0, z0 + oz * lean * (pad.h0 - f0)];
      const P1: [number, number, number] = [x1 + ox * lean * (pad.h0 - f1), f1, z1 + oz * lean * (pad.h0 - f1)];
      const T0: [number, number, number] = [x0, pad.h0, z0], T1: [number, number, number] = [x1, pad.h0, z1];
      const nrm: [number, number, number] = [ox, lean, oz];
      const v = [
        b.vert(P0, nrm, paint.map(u0, f0), foot), b.vert(P1, nrm, paint.map(u1, f1), foot),
        b.vert(T1, nrm, paint.map(u1, pad.h0), top), b.vert(T0, nrm, paint.map(u0, pad.h0), top),
      ];
      // Wound so its front faces outwards.
      if (sign > 0) b.quadIdx(v[0]!, v[3]!, v[2]!, v[1]!);
      else b.quadIdx(v[0]!, v[1]!, v[2]!, v[3]!);
    }
    run += L;
  }
}

/** Builds a plan's meshes: one per navy that has pieces in it, close and far. */
export function buildHero(plan: Plan): HeroMesh[] {
  const cache = new Map<string, [MeshData, MeshData]>();
  const merges = new Map<FactionId, [Merge, Merge]>();
  const mergeOf = (navy: FactionId) => {
    let m = merges.get(navy);
    if (!m) merges.set(navy, (m = [new Merge(), new Merge()]));
    return m;
  };
  for (const { navy, piece } of plan.pieces) {
    const at = placeOf(piece);
    const key = keyOf(navy, piece, at.L);
    let lods = cache.get(key);
    if (!lods) {
      const P = buildingPaints(navy);
      lods = [true, false].map((near) => {
        const k: Kit = { b: new MeshBuilder(), near, P };
        buildPiece(k, navy, piece, at.L);
        return k.b.data();
      }) as [MeshData, MeshData];
      // Banners are cloth in the wind: no occlusion to speak of.
      if (piece.kind !== 'banner') bakeGrime(lods, null, { ground: 0, light: 0.3 });
      cache.set(key, lods);
    }
    const [near, far] = mergeOf(navy);
    near.stamp(lods[0], at.x, at.y, at.z, at.rot);
    far.stamp(lods[1], at.x, at.y, at.z, at.rot);
  }
  // The pads' skirts in the camp's own stone.
  if (plan.pads.length) {
    const P = buildingPaints(plan.navy);
    const b = new MeshBuilder();
    for (const pad of plan.pads) skirt(b, facingPaint(P, plan.navy, pad.face), pad, (x, z) => plan.natural(x, z));
    const d = b.data();
    const [near, far] = mergeOf(plan.navy);
    near.stamp(d, 0, 0, 0, 0);
    far.stamp(d, 0, 0, 0, 0);
  }
  return [...merges].map(([navy, [near, far]]) => {
    const n = near.data();
    return { navy, near: n, far: far.data(), triangles: n.index.length / 3 };
  });
}
