/**
 * Parts shared by the procedural ships: hull lofting, decks, plank walls with gun ports, cannons, oars, masts,
 * sails, flags and rigging. All take a Ctx so the same code builds every LOD at a different detail.
 */
import { type HullPlan, hullSection, hullTop, sideZ } from '../anchors';
import type { Faction } from './atlas';
import { flagRect } from './atlas';
import {
  type MeshBuilder,
  type Paint,
  type V2,
  type V3,
  add,
  box,
  cloth,
  cylinder,
  grid,
  lathe,
  lerp,
  mul,
  paints,
  polygon,
  rectSection,
  rotY,
  sub,
  sweep,
  tube,
  xlate,
  frameAlong,
  len,
  norm,
  pennant,
} from './parts';

export type Lod = 0 | 1 | 2;

export type Ctx = {
  b: MeshBuilder;
  lod: Lod;
  faction: Faction;
  /** Paint by atlas cell name. */
  P: ReturnType<typeof paints>;
  rnd: () => number;
};

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(arr: T[], step: number) => arr.filter((_, i) => i % step === 0 || i === arr.length - 1);
export const byLod = <T>(ctx: Ctx, a: T, b: T, c: T) => (ctx.lod === 0 ? a : ctx.lod === 1 ? b : c);

// ---------- hull ----------

/** Stations along the hull, denser toward the ends where the sections change fastest. */
function stations(L: number, n: number) {
  const xs: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const s = 0.5 - 0.5 * Math.cos(t * Math.PI);
    xs.push(-L / 2 + L * (0.65 * t + 0.35 * s));
  }
  return xs;
}

/** Outer hull skin lofted through the plan's sections, with end plates. Returns the stations used. */
export function loftHull(ctx: Ctx, plan: HullPlan, skin: Paint, endPaint: Paint, o: { tint?: V3 } = {}) {
  const n = byLod(ctx, 40, 16, 9);
  const step = byLod(ctx, 1, 2, 3);
  const xs = stations(plan.length, n);
  const rows: V3[][] = xs.map((x) => {
    const sec = pick(hullSection(plan, x), step);
    const port = sec.map(([z, y]): V3 => [x, y, -z]).reverse();
    const star = sec.slice(1).map(([z, y]): V3 => [x, y, z]);
    return [...port, ...star];
  });
  const paint = o.tint ? skin.tinted(o.tint) : skin;
  grid(ctx.b, paint, rows);
  const endUv = (p: V3): V2 => endPaint.map(p[2], p[1]);
  const bow = rows[rows.length - 1]!;
  const stern = rows[0]!;
  polygon(ctx.b, o.tint ? endPaint.tinted(o.tint) : endPaint, bow, [1, 0, 0], endUv);
  polygon(ctx.b, o.tint ? endPaint.tinted(o.tint) : endPaint, stern, [-1, 0, 0], endUv);
  return xs;
}

/** Flat deck plane across the hull top between x0 and x1 at height y. */
export function deckPlane(ctx: Ctx, plan: HullPlan, paint: Paint, x0: number, x1: number, y: number, inset: number) {
  const n = byLod(ctx, 12, 6, 3);
  const m = byLod(ctx, 9, 5, 3);
  const P: V3[][] = [];
  for (let i = 0; i <= n; i += 1) {
    const x = lerp(x0, x1, i / n);
    const z = sideZ(plan, x, Math.min(y, plan.deck)) - inset;
    const row: V3[] = [];
    for (let j = 0; j <= m; j += 1) row.push([x, y, lerp(-z, z, j / m)]);
    P.push(row);
  }
  grid(ctx.b, paint, P, { flip: true });
}

/** A horizontal timber (wale, coping, rail) following the hull side at height y between x0 and x1, both sides. */
export function sideTimber(ctx: Ctx, plan: HullPlan, paint: Paint, x0: number, x1: number, y: number, thick: number, tall: number, off = 0.06, yFn?: (x: number) => number) {
  const n = Math.max(4, Math.round(Math.abs(x1 - x0) / byLod(ctx, 1.6, 3, 6)));
  for (const sgn of [-1, 1]) {
    const path: V3[] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = lerp(x0, x1, i / n);
      const yy = yFn ? yFn(x) : y;
      path.push([x, yy, sgn * (sideZ(plan, x, Math.min(yy, plan.deck)) + off)]);
    }
    sweep(ctx.b, paint, path, rectSection(thick, tall), { caps: true });
  }
}

// ---------- plank wall with gun ports ----------

export type WallPort = { x: number; w: number; y0: number; y1: number };

/**
 * Solid bulwark along one side from x0 to x1, standing on `base`, with real openings at the ports.
 * outer(x) is the outer face's half-breadth (positive), top(x) the wall top, thick the wall thickness.
 */
export function wallRun(ctx: Ctx, side: -1 | 1, x0: number, x1: number, base: number, top: (x: number) => number, outer: (x: number) => number, thick: number, ports: WallPort[], boards: Paint, inner: Paint) {
  const b = ctx.b;
  const breaks = new Set<number>();
  const step = byLod(ctx, 0.95, 2.2, 6);
  for (let x = x0; x < x1; x += step) breaks.add(Math.round(x * 1000) / 1000);
  breaks.add(x1);
  const useP = ctx.lod < 2 ? ports : [];
  for (const p of useP) {
    breaks.add(Math.round((p.x - p.w / 2) * 1000) / 1000);
    breaks.add(Math.round((p.x + p.w / 2) * 1000) / 1000);
  }
  const xs = [...breaks].filter((x) => x >= x0 - 1e-6 && x <= x1 + 1e-6).sort((a, c) => a - c);
  const zo = (x: number) => side * outer(x);
  const zi = (x: number) => side * (outer(x) - thick);
  // Board faces: u runs up the board (vertical grain), v along the ship.
  const face = (p: Paint, pts: [V3, V3, V3, V3], facing: V3) => b.quadF(p, pts, facing, pts.map((pt) => [pt[1], pt[0]] as V2) as [V2, V2, V2, V2]);
  const flat = (p: Paint, pts: [V3, V3, V3, V3], facing: V3) => b.quadF(p, pts, facing, pts.map((pt) => [pt[0], pt[2]] as V2) as [V2, V2, V2, V2]);
  for (let k = 0; k < xs.length - 1; k += 1) {
    const xa = xs[k]!;
    const xb = xs[k + 1]!;
    const xm = (xa + xb) / 2;
    const port = useP.find((p) => xm > p.x - p.w / 2 && xm < p.x + p.w / 2);
    // Vertical pieces of wall in this interval: lo and hi can follow the sheer at the top.
    const pieces: { lo: (x: number) => number; hi: (x: number) => number; capped: boolean }[] = port
      ? [
          { lo: () => base, hi: () => port.y0, capped: false },
          { lo: () => port.y1, hi: top, capped: true },
        ]
      : [{ lo: () => base, hi: top, capped: true }];
    for (const pc of pieces) {
      face(boards, [[xa, pc.lo(xa), zo(xa)], [xb, pc.lo(xb), zo(xb)], [xb, pc.hi(xb), zo(xb)], [xa, pc.hi(xa), zo(xa)]], [0, 0, side]);
      face(inner, [[xa, pc.lo(xa), zi(xa)], [xb, pc.lo(xb), zi(xb)], [xb, pc.hi(xb), zi(xb)], [xa, pc.hi(xa), zi(xa)]], [0, 0, -side]);
      if (pc.capped) flat(inner, [[xa, pc.hi(xa), zi(xa)], [xb, pc.hi(xb), zi(xb)], [xb, pc.hi(xb), zo(xb)], [xa, pc.hi(xa), zo(xa)]], [0, 1, 0]);
    }
    if (port) {
      // sill and head of the opening
      flat(inner, [[xa, port.y0, zi(xa)], [xb, port.y0, zi(xb)], [xb, port.y0, zo(xb)], [xa, port.y0, zo(xa)]], [0, 1, 0]);
      flat(inner, [[xa, port.y1, zi(xa)], [xb, port.y1, zi(xb)], [xb, port.y1, zo(xb)], [xa, port.y1, zo(xa)]], [0, -1, 0]);
    }
  }
  // jambs at the port edges
  for (const p of useP) {
    for (const [x, nx] of [[p.x - p.w / 2, 1], [p.x + p.w / 2, -1]] as [number, number][]) {
      b.quadF(inner, [[x, p.y0, zi(x)], [x, p.y0, zo(x)], [x, p.y1, zo(x)], [x, p.y1, zi(x)]], [nx, 0, 0], [[0, 0], [thick, 0], [thick, p.y1 - p.y0], [0, p.y1 - p.y0]]);
    }
  }
}

// ---------- guns ----------

export type GunKind = 'cheonja' | 'jija' | 'hyeonja' | 'hwangja' | 'seungja' | string;

const GUN_SCALE: Record<string, number> = { cheonja: 1.25, jija: 1.1, hyeonja: 1, hwangja: 0.9, seungja: 0.7, ozutsu: 1.1, folangji: 0.85, hudun: 0.8 };

/** Cannon on a carriage whose muzzle pokes out through a port. pos is the port centre on the outer face. */
export function cannon(ctx: Ctx, pos: V3, dir: V3, gun: GunKind, carriage: Paint, bronze: Paint, band: Paint) {
  if (ctx.lod > 1) return;
  const s = GUN_SCALE[gun] ?? 1;
  const d = norm(dir);
  const back = add(pos, mul(d, -1.15 * s));
  const muzzle = add(pos, mul(d, 0.85 * s));
  const r = 0.2 * s;
  if (ctx.lod === 1) {
    cylinder(ctx.b, bronze, back, muzzle, r * 1.05, r * 1.15, 5, true);
    return;
  }
  const seg = 7;
  // barrel in four tapered pieces: breech, chase, muzzle swell, muzzle face
  const at = (t: number) => add(back, mul(sub(muzzle, back), t));
  cylinder(ctx.b, bronze, back, at(0.14), r * 0.8, r * 1.15, seg, true);
  cylinder(ctx.b, bronze, at(0.14), at(0.78), r * 1.15, r * 0.88, seg, false);
  cylinder(ctx.b, band, at(0.7), at(0.78), r * 1.05, r * 1.05, seg, false);
  cylinder(ctx.b, bronze, at(0.78), muzzle, r * 1.0, r * 1.2, seg, false);
  cylinder(ctx.b, band, add(muzzle, mul(d, -0.12 * s)), muzzle, r * 1.28, r * 1.28, seg, true);
  // carriage: a timber block under the barrel with cheeks
  const f = frameAlong(add(pos, mul(d, -0.15 * s)), d);
  ctx.b.with(f, () => {
    box(ctx.b, carriage, [-0.9 * s, -0.55 * s, -0.4 * s], [0.5 * s, -0.22 * s, 0.4 * s]);
    box(ctx.b, carriage, [-0.7 * s, -0.25 * s, -0.42 * s], [0.4 * s, 0.0, -0.3 * s]);
    box(ctx.b, carriage, [-0.7 * s, -0.25 * s, 0.3 * s], [0.4 * s, 0.0, 0.42 * s]);
  });
}

export function oar(ctx: Ctx, port: V3, side: -1 | 1, pitch: number, wood: Paint, blade: Paint, inboard = 2.4, outboard = 6.0) {
  if (ctx.lod > 1) return;
  const d = norm([-0.1, -Math.sin(pitch), side * Math.cos(pitch)]);
  const seg = byLod(ctx, 5, 4, 4);
  cylinder(ctx.b, wood, add(port, mul(d, -inboard)), add(port, mul(d, outboard - 1.6)), 0.07, 0.085, seg, true);
  // Blade: flat paddle whose width runs along the ship (the frame's local y is world x for an oar lying across).
  const f = frameAlong(add(port, mul(d, outboard - 1.7)), d, [1, 0, 0]);
  ctx.b.with(f, () => box(ctx.b, blade, [0, -0.2, -0.025], [1.7, 0.2, 0.025], { grain: 0 }));
}

/** Dark port opening and frame on the hull side where an oar passes. */
export function oarPortFrame(ctx: Ctx, pos: V3, side: -1 | 1, dark: Paint) {
  if (ctx.lod > 1) return;
  const [x, y, z] = pos;
  const w = 0.22;
  const zz = z + side * 0.025;
  ctx.b.quadF(dark, [[x - w, y - w, zz], [x + w, y - w, zz], [x + w, y + w, zz], [x - w, y + w, zz]], [0, 0, side]);
}

// ---------- masts, sails, flags ----------

export function mast(ctx: Ctx, wood: Paint, band: Paint, x: number, y0: number, h: number, r: number) {
  const seg = byLod(ctx, 10, 7, 5);
  cylinder(ctx.b, wood, [x, y0 - 0.6, 0], [x, y0 + h, 0], r * 1.0, r * 0.62, seg, true, 3);
  if (ctx.lod === 0) {
    cylinder(ctx.b, band, [x, y0 + 0.2, 0], [x, y0 + 0.55, 0], r * 1.3, r * 1.3, seg, true);
    cylinder(ctx.b, band, [x, y0 + h - 1.2, 0], [x, y0 + h - 1.05, 0], r * 1.0, r * 1.0, seg, true);
    cylinder(ctx.b, wood, [x, y0 + h, 0], [x, y0 + h + 0.4, 0], r * 0.62, 0.05, seg, true);
  }
}

export type SailOpts = { x: number; yTop: number; w: number; h: number; billow: number; battens: number; phase: number };

/** Square battened sail hung from a yard on the mast: yard, sail cloth with bulge, bamboo battens. */
export function sail(ctx: Ctx, cloth_: Paint, wood: Paint, rope: Paint, o: SailOpts) {
  const nu = byLod(ctx, 6, 3, 1);
  const nv = byLod(ctx, 8, 4, 1);
  const x = o.x + 0.42;
  cloth(ctx.b, cloth_, [x, o.yTop, -o.w / 2], [0, 0, o.w], [0, -o.h, 0], { nu, nv, billow: o.billow, flutter: 0.5, phase: o.phase });
  cylinder(ctx.b, wood, [x - 0.12, o.yTop + 0.05, -o.w / 2 - 0.5], [x - 0.12, o.yTop + 0.05, o.w / 2 + 0.5], 0.1, 0.1, byLod(ctx, 6, 4, 3), true);
  if (ctx.lod === 0) {
    for (let k = 1; k <= o.battens; k += 1) {
      const t = k / (o.battens + 1);
      const y = o.yTop - o.h * t;
      const path: V3[] = [];
      for (let i = 0; i <= 6; i += 1) {
        const u = i / 6;
        const bulge = o.billow * Math.sin(Math.PI * u) * Math.sin(Math.PI * t);
        path.push([x + bulge + 0.04, y, lerp(-o.w / 2, o.w / 2, u)]);
      }
      sweep(ctx.b, wood, path, rectSection(0.07, 0.09), { up: [1, 0, 0] });
    }
    // bottom boom and sheet ropes
    cylinder(ctx.b, wood, [x + 0.05, o.yTop - o.h, -o.w / 2], [x + 0.05, o.yTop - o.h, o.w / 2], 0.075, 0.075, 5, true);
    for (const sgn of [-1, 1]) sweep(ctx.b, rope, [[x + 0.1, o.yTop - o.h, sgn * o.w / 2], [x - 2.0, o.yTop - o.h - 1.6, sgn * (o.w / 2 + 0.7)]], rectSection(0.05, 0.05));
  }
}

/** A sail rolled up on its yard. */
export function furledSail(ctx: Ctx, cloth_: Paint, wood: Paint, rope: Paint, o: SailOpts) {
  const x = o.x + 0.42;
  cylinder(ctx.b, wood, [x - 0.12, o.yTop + 0.05, -o.w / 2 - 0.5], [x - 0.12, o.yTop + 0.05, o.w / 2 + 0.5], 0.1, 0.1, byLod(ctx, 6, 4, 3), true);
  const seg = byLod(ctx, 9, 6, 4);
  cylinder(ctx.b, cloth_, [x, o.yTop - 0.38, -o.w / 2], [x, o.yTop - 0.38, o.w / 2], 0.46, 0.46, seg, true, 4);
  if (ctx.lod === 0) {
    for (let k = 1; k <= 6; k += 1) {
      const z = lerp(-o.w / 2 + 0.6, o.w / 2 - 0.6, k / 7);
      cylinder(ctx.b, rope, [x, o.yTop - 0.38, z], [x, o.yTop - 0.38, z + 0.14], 0.5, 0.5, 8, false);
    }
  }
}

export type FlagOpts = { pole: V3; poleH: number; w: number; h: number; sheet: string; flag: string; phase: number; flutter?: number; wood: Paint; nu?: number; nv?: number };

/** Pole with a flag streaming aft (-x). */
export function flag(ctx: Ctx, o: FlagOpts) {
  const [x, y, z] = o.pole;
  cylinder(ctx.b, o.wood, [x, y, z], [x, y + o.poleH, z], 0.045, 0.035, byLod(ctx, 5, 4, 3), true);
  if (ctx.lod > 1) return;
  const fr = flagRect(ctx.faction, o.sheet, o.flag);
  const paint = ctx.P(o.sheet, { rect: fr.rect });
  cloth(ctx.b, paint, [x - 0.04, y + o.poleH - 0.05, z], [-o.w, 0, 0], [0, -o.h, 0], {
    nu: o.nu ?? byLod(ctx, 6, 2, 1),
    nv: o.nv ?? byLod(ctx, 4, 2, 1),
    flutter: o.flutter ?? 1,
    wave: 0.07 * o.w,
    phase: o.phase,
  });
  // finial
  if (ctx.lod === 0) cylinder(ctx.b, o.wood, [x, y + o.poleH, z], [x, y + o.poleH + 0.22, z], 0.07, 0.0, 5, false);
}

/** Long swallow-tailed pennant from a mast top. */
export function longPennant(ctx: Ctx, color: Paint, from: V3, length: number, width: number, phase: number) {
  if (ctx.lod > 1) return;
  pennant(ctx.b, color, from, [-1, -0.05, 0], [0, -1, 0], length, width, width * 0.12, byLod(ctx, 8, 3, 1), { flutter: 1.2, phase });
}

// ---------- small props ----------

export function barrel(ctx: Ctx, wood: Paint, band: Paint, p: V3, r: number, h: number) {
  if (ctx.lod > 0) return;
  const profile: V2[] = [
    [r * 0.82, 0],
    [r * 0.96, h * 0.25],
    [r, h * 0.5],
    [r * 0.96, h * 0.75],
    [r * 0.82, h],
  ];
  ctx.b.with(xlate(p[0], p[1], p[2]), () => {
    lathe(ctx.b, wood, profile, 9);
    cylinder(ctx.b, band, [0, h * 0.22, 0], [0, h * 0.28, 0], r * 0.975, r * 0.975, 9, false);
    cylinder(ctx.b, band, [0, h * 0.72, 0], [0, h * 0.78, 0], r * 0.975, r * 0.975, 9, false);
    cylinder(ctx.b, wood, [0, h, 0], [0, h + 0.01, 0], r * 0.82, r * 0.82, 9, true);
  });
}

export function ropeCoil(ctx: Ctx, rope: Paint, p: V3, r: number) {
  if (ctx.lod > 0) return;
  const prof: V2[] = [];
  const tr = r * 0.28;
  for (let i = 0; i <= 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    prof.push([r + Math.cos(a) * tr, tr + Math.sin(a) * tr]);
  }
  ctx.b.with(xlate(p[0], p[1], p[2]), () => lathe(ctx.b, rope, prof, 12));
}

/** Round-section post with a square cap, e.g. for rails and pavilion pillars. */
export function post(ctx: Ctx, paint: Paint, x: number, y0: number, y1: number, z: number, w: number) {
  box(ctx.b, paint, [x - w / 2, y0, z - w / 2], [x + w / 2, y1, z + w / 2], { grain: 1 });
}

export { tube, rotY, len };

/** Paint showing only the plain cloth of a flag (a patch away from its lettering and trim): pennants, streamers. */
export function clothPatch(ctx: Ctx, sheet: string, name: string): Paint {
  const r = flagRect(ctx.faction, sheet, name).rect;
  const w = r[2] - r[0];
  const h = r[3] - r[1];
  return ctx.P(sheet, { rect: [r[0] + w * 0.14, r[1] + h * 0.14, r[0] + w * 0.24, r[1] + h * 0.24] });
}

/**
 * A painted band hugging the hull side between two heights (a second skin a few centimetres proud of the hull), one per
 * side: lacquered topsides, dancheong friezes. yLo/yHi may follow the sheer.
 */
export function hullBand(ctx: Ctx, plan: HullPlan, paint: Paint, x0: number, x1: number, yLo: number | ((x: number) => number), yHi: number | ((x: number) => number), off = 0.03) {
  const n = byLod(ctx, 26, 12, 6);
  const m = byLod(ctx, 5, 2, 1);
  const lo = typeof yLo === 'number' ? () => yLo : yLo;
  const hi = typeof yHi === 'number' ? () => yHi : yHi;
  for (const sgn of [-1, 1]) {
    const P: V3[][] = [];
    for (let i = 0; i <= n; i += 1) {
      const x = lerp(x0, x1, i / n);
      const row: V3[] = [];
      for (let j = 0; j <= m; j += 1) {
        const y = lerp(lo(x), hi(x), j / m);
        row.push([x, y, sgn * (sideZ(plan, x, Math.min(y, hullTop(plan, x))) + off)]);
      }
      P.push(row);
    }
    grid(ctx.b, paint, P, { flip: sgn < 0 });
  }
}

/** Row of small blocks along the hull side (bracket dentils, projecting beam ends), both sides. */
export function blockRow(ctx: Ctx, plan: HullPlan, paint: Paint, x0: number, x1: number, step: number, y: number | ((x: number) => number), size: V3, off: number) {
  if (ctx.lod > 0) return;
  const n = Math.max(1, Math.round((x1 - x0) / step));
  for (let i = 0; i <= n; i += 1) {
    const x = lerp(x0, x1, i / n);
    const yy = typeof y === 'number' ? y : y(x);
    for (const sgn of [-1, 1]) {
      const z = sgn * (sideZ(plan, x, Math.min(yy, hullTop(plan, x))) + off);
      box(ctx.b, paint, [x - size[0] / 2, yy - size[1] / 2, z - size[2] / 2], [x + size[0] / 2, yy + size[1] / 2, z + size[2] / 2], { grain: 2 });
    }
  }
}

/** Paper lantern hanging at p. */
export function lantern(ctx: Ctx, paint: Paint, trim: Paint, p: V3, r = 0.24) {
  if (ctx.lod > 0) return;
  const prof: V2[] = [
    [r * 0.45, 0],
    [r * 0.9, r * 0.35],
    [r, r * 1.0],
    [r * 0.9, r * 1.7],
    [r * 0.45, r * 2.0],
  ];
  ctx.b.with(xlate(p[0], p[1] - r * 2, p[2]), () => {
    lathe(ctx.b, paint, prof, 8);
    cylinder(ctx.b, trim, [0, r * 2.0, 0], [0, r * 2.15, 0], r * 0.5, r * 0.5, 8, true);
    cylinder(ctx.b, trim, [0, -0.03, 0], [0, 0.02, 0], r * 0.46, r * 0.46, 8, true);
  });
  cylinder(ctx.b, trim, [p[0], p[1], p[2]], [p[0], p[1] + 0.3, p[2]], 0.012, 0.012, 3, false);
}

/** A short pole from baseY with an arm over to p, where a lantern is hooked; (awayX, awayZ) is where the pole stands relative to p. */
export function lanternPole(ctx: Ctx, wood: Paint, p: V3, baseY: number, awayX: number, awayZ: number) {
  if (ctx.lod > 0) return;
  const px = p[0] + awayX;
  const pz = p[2] + awayZ;
  const top = p[1] + 0.34;
  cylinder(ctx.b, wood, [px, baseY, pz], [px, top + 0.06, pz], 0.05, 0.04, 5, true);
  cylinder(ctx.b, wood, [px, top, pz], [p[0], top, p[2]], 0.03, 0.03, 4, false);
}

/**
 * The ship's paper lanterns. Those on the centreline near bow or stern stand on a pole above the wall (`wallTop` is the
 * wall's height there), so they do not hang inside it; the rest hang from the structure the anchors put them on.
 */
export function hangLanterns(ctx: Ctx, paint: Paint, trim: Paint, wood: Paint, anchors: { length: number; lanterns: V3[] }, wallTop: (x: number) => number, r = 0.24) {
  for (const l of anchors.lanterns) {
    lantern(ctx, paint, trim, l, r);
    if (l[2] === 0 && Math.abs(l[0]) > anchors.length / 2 - 3) {
      const away = l[0] > 0 ? -0.5 : 0.5;
      lanternPole(ctx, wood, l, wallTop(l[0] + away) - 0.05, away, 0);
    }
  }
}

/** Wooden hatch with a slatted grating. */
export function hatch(ctx: Ctx, wood: Paint, dark: Paint, x: number, y: number, z: number, w: number, d: number) {
  if (ctx.lod > 0) return;
  box(ctx.b, wood, [x - w / 2, y, z - d / 2], [x + w / 2, y + 0.18, z + d / 2], { grain: 0 });
  box(ctx.b, dark, [x - w / 2 + 0.12, y + 0.18, z - d / 2 + 0.12], [x + w / 2 - 0.12, y + 0.2, z + d / 2 - 0.12]);
  const n = Math.round(w / 0.28);
  for (let i = 0; i <= n; i += 1) {
    const sx = x - w / 2 + 0.12 + ((w - 0.24) * i) / n;
    box(ctx.b, wood, [sx - 0.04, y + 0.2, z - d / 2 + 0.12], [sx + 0.04, y + 0.27, z + d / 2 - 0.12], { grain: 2 });
  }
}

/** Windlass: a horizontal drum between two posts with handspikes. */
export function windlass(ctx: Ctx, wood: Paint, band: Paint, x: number, y: number, hw: number) {
  if (ctx.lod > 0) return;
  for (const sz of [-1, 1]) box(ctx.b, wood, [x - 0.2, y, sz * hw - 0.12], [x + 0.2, y + 1.0, sz * hw + 0.12], { grain: 1 });
  cylinder(ctx.b, wood, [x, y + 0.75, -hw], [x, y + 0.75, hw], 0.24, 0.24, 8, true);
  cylinder(ctx.b, band, [x, y + 0.75, -0.2], [x, y + 0.75, 0.2], 0.27, 0.27, 8, true);
  for (const [dy, dz] of [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) cylinder(ctx.b, wood, [x, y + 0.75, hw * 0.5 * Math.sign(dz)], [x + 0.3, y + 0.75 + dy * 0.9, hw * 0.5 * Math.sign(dz) + dz * 0.3], 0.035, 0.035, 4, true);
}

/** Wooden anchor hanging at the bow: shank, stock and two flukes. */
export function anchorProp(ctx: Ctx, wood: Paint, iron: Paint, p: V3) {
  if (ctx.lod > 0) return;
  cylinder(ctx.b, wood, [p[0], p[1] + 1.5, p[2]], [p[0], p[1] - 1.3, p[2]], 0.12, 0.1, 6, true);
  box(ctx.b, wood, [p[0] - 0.08, p[1] + 1.1, p[2] - 0.8], [p[0] + 0.08, p[1] + 1.25, p[2] + 0.8]);
  for (const s of [-1, 1]) sweep(ctx.b, iron, [[p[0], p[1] - 1.2, p[2]], [p[0], p[1] - 1.5, p[2] + s * 0.5], [p[0], p[1] - 1.1, p[2] + s * 0.95]], rectSection(0.12, 0.1), { up: [1, 0, 0] });
}

/** Inside of an open boat: the hull section inset by `thick`, facing inward, floor clamped at floorY. */
export function innerLiner(ctx: Ctx, plan: HullPlan, paint: Paint, thick: number, floorY: number) {
  const n = byLod(ctx, 14, 8, 4);
  const step = byLod(ctx, 1, 2, 3);
  const xs = Array.from({ length: n }, (_, i) => lerp(-plan.length / 2 + 0.05, plan.length / 2 - 0.05, i / (n - 1)));
  const rows: V3[][] = xs.map((x) => {
    const top = hullTop(plan, x);
    const sec = pick(hullSection(plan, x), step).map(([z, y]): [number, number] => [Math.max(0, z - thick), Math.max(floorY, y + thick * (1 - (y + plan.draft) / (top + plan.draft)))]);
    const port = sec.map(([z, y]): V3 => [x, y, -z]).reverse();
    const star = sec.slice(1).map(([z, y]): V3 => [x, y, z]);
    return [...port, ...star];
  });
  grid(ctx.b, paint, rows, { flip: true });
}
