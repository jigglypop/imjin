import type { ShipKind } from '../sim/types';
import {
  ATAKE_PLANS,
  atakeLevels,
  GEOBUK_PLAN,
  geobukRoofY,
  halfBeamAt,
  hullTop,
  HYEOP_PLAN,
  KOBAYA_PLAN,
  MING_PLAN,
  MINGSMALL_PLAN,
  modelKind,
  PANOK_PLANS,
  SEKI_PLANS,
  anchorScale,
  buildAnchorsFor,
  type HullPlan,
} from './anchors';

/**
 * The outside of each ship model as the shot sees it, in the model's plan metres: the hull's lofted side, the plank
 * wall standing on the deck edge, the castles and cabins as boxes, and the sails. The marks a fight leaves (shot holes,
 * embedded arrows, knocked-out boards, src/fx/Scars.ts) are put on this surface, so they sit on the planks the shell
 * actually reached rather than on the sim's coarse hit box. It mirrors the builders in build/*.ts (wallRun's `outer`
 * and `top`, the sail planes) and reads the same plans, so a changed plan moves the marks with the model. Three-free.
 */

/** A plank wall along one side: from `base(x)` up to `top(x)`, its outer face at `outer(x)`, between x0 and x1. */
type Wall = { x0: number; x1: number; base: (x: number) => number; top: (x: number) => number; outer: (x: number) => number; thick: number };
/** A castle storey, cabin or pavilion. */
type Block = { x0: number; x1: number; y0: number; y1: number; hz: number };
/** A set sail: the plane at x (it bulges forward by up to `billow` in the middle), from yTop down h, w wide. */
export type SailPlane = { x: number; yTop: number; w: number; h: number; billow: number };

export type ShipSurface = {
  hull: HullPlan;
  /** Plan metres to the ship's view space (the turtle ship's enlargement, an aliased kind's scale). */
  scale: number;
  walls: Wall | null;
  blocks: Block[];
  sails: SailPlane[];
  /** The turtle ship's iron-spiked roof over the whole deck. */
  roof: boolean;
  /** The boards along each wall that can be knocked out one by one: their centres along the ship and their width. */
  boards: number[];
  boardW: number;
  /** Where the painted shield boards sit on the wall (the Joseon panokseon's), or the whole wall height for plank walls. */
  boardY: [number, number];
  /** Side planking in centimetres (the weapons table: panokseon "並厚四寸", the others estimated). */
  plank: number;
};

const sheerAt = (rise: number, L: number, x: number, pow: number) => rise * Math.pow(Math.abs((2 * x) / L), pow);

/**
 * Outer half-breadth of the hull at station x and height y, without the allocation of hullSection: the round of the
 * bilge as a quarter ellipse, then the flared side straight up to the top edge. 0 under the keel.
 */
export function sideAt(p: HullPlan, x: number, y: number) {
  const hw = halfBeamAt(p, x);
  const a = Math.abs((x / p.length) * 2);
  const yk = -p.draft + p.rise * Math.pow(a, p.risePow);
  if (y < yk) return 0;
  const fh = hw * p.flat * (1 - 0.25 * a);
  const top = hullTop(p, x);
  const br = Math.min(p.bilge, Math.max(0.3, top * 0.55 - yk));
  if (y < yk + br) {
    const c = 1 - (y - yk) / br;
    return fh + (hw - fh) * Math.sqrt(Math.max(0, 1 - c * c));
  }
  return hw + (p.flare * Math.max(0, y)) / top;
}

/** Board centres every `pitch` metres between x0 and x1. */
const run = (x0: number, x1: number, pitch: number) => {
  const n = Math.max(1, Math.round((x1 - x0) / pitch));
  return Array.from({ length: n }, (_, i) => x0 + ((x1 - x0) * (i + 0.5)) / n);
};

function build(model: string): ShipSurface | null {
  const [kind, v] = model.split('#') as [ShipKind, string | undefined];
  const variant = Number(v ?? 0);
  const plain = { blocks: [] as Block[], sails: [] as SailPlane[], roof: false, boards: [] as number[], boardW: 1, boardY: [0, 0] as [number, number] };
  if (kind === 'panokseon') {
    const plan = PANOK_PLANS[variant] ?? PANOK_PLANS[0]!;
    const h = plan.hull;
    const L = h.length;
    const deck = h.deck;
    // The shield boards stand between the gun ports, as panokseon.ts places them.
    const ports = (buildAnchorsFor(`panokseon#${PANOK_PLANS[variant] ? variant : 0}`)?.gunPorts ?? []).filter((g) => g.side === 0).map((g) => g.pos[0]);
    const gap = ports.length > 1 ? ports[1]! - ports[0]! : 4.4;
    const boards = ports.length ? [ports[0]! - gap / 2, ...ports.slice(0, -1).map((x, i) => (x + ports[i + 1]!) / 2), ports[ports.length - 1]! + gap / 2] : [];
    const pv = plan.pavilion;
    return {
      ...plain,
      hull: h,
      scale: 1,
      walls: { x0: -L / 2 + 0.3, x1: L / 2 - 0.3, base: () => deck, top: (x) => deck + plan.parapet + sheerAt(plan.sheer, L, x, 2.2), outer: (x) => sideAt(h, x, deck) + 0.04, thick: 0.26 },
      blocks: [{ x0: pv.x - pv.hx, x1: pv.x + pv.hx, y0: deck + pv.floorUp, y1: deck + pv.floorUp + pv.postH + pv.roofRise * 0.5, hz: pv.hz }],
      sails: plan.masts.filter((m) => m.set).map((m) => ({ x: m.x + 0.42, yTop: deck + m.h - 1.3, w: m.sailW, h: m.sailH, billow: 0.85 })),
      boards,
      boardW: 1.7,
      boardY: [deck + 0.28, deck + plan.parapet - 0.27],
      plank: 12,
    };
  }
  if (kind === 'geobukseon') {
    return { ...plain, hull: GEOBUK_PLAN.hull, walls: null, roof: true, scale: anchorScale('geobukseon'), plank: 12 };
  }
  if (kind === 'hyeopseon') {
    const h = HYEOP_PLAN.hull;
    const m = HYEOP_PLAN.mast;
    return { ...plain, hull: h, scale: 1, walls: null, sails: [{ x: m.x + 0.42, yTop: h.deck + m.h - 0.4, w: m.sailW, h: m.sailH, billow: 0.45 }], plank: 6 };
  }
  if (kind === 'atakebune') {
    const plan = ATAKE_PLANS[variant] ?? ATAKE_PLANS[0]!;
    const h = plan.hull;
    const L = h.length;
    const deck = h.deck;
    const levels = atakeLevels(plan);
    return {
      ...plain,
      hull: h,
      scale: 1,
      walls: { x0: -L / 2 + 0.3, x1: L / 2 - 0.3, base: () => deck, top: (x) => deck + plan.parapet + sheerAt(plan.sheer, L, x, 2.2), outer: (x) => sideAt(h, x, deck) + 0.04, thick: 0.26 },
      blocks: levels.map((l) => ({ x0: plan.cx - l.hx, x1: plan.cx + l.hx, y0: l.y0, y1: l.y1, hz: l.hz })),
      sails: [{ x: plan.mast.x + 0.42, yTop: deck + plan.mast.h - 1.3, w: plan.mast.sailW, h: plan.mast.sailH, billow: 0.8 }],
      // Tate-ita: the wall is itself the row of shield boards, a metre or so each, hinged to drop for boarding.
      boards: run(-L / 2 + 1, L / 2 - 1, 1.1),
      boardW: 1.1,
      boardY: [deck, deck + plan.parapet],
      plank: 7,
    };
  }
  if (kind === 'sekibune') {
    const plan = SEKI_PLANS[variant] ?? SEKI_PLANS[0]!;
    const h = plan.hull;
    const L = h.length;
    const deck = h.deck;
    const c = plan.cabin;
    return {
      ...plain,
      hull: h,
      scale: 1,
      walls: { x0: -L / 2 + 0.3, x1: L / 2 - 0.3, base: (x) => hullTop(h, x), top: (x) => hullTop(h, x) + plan.parapet + sheerAt(plan.sheer, L, x, 2.2), outer: (x) => sideAt(h, x, hullTop(h, x)) + 0.03, thick: 0.18 },
      blocks: [{ x0: c.x - c.hx, x1: c.x + c.hx, y0: deck, y1: deck + c.h, hz: c.hz }],
      sails: [{ x: plan.mast.x + 0.42, yTop: deck + plan.mast.h - 1.0, w: plan.mast.sailW, h: plan.mast.sailH, billow: 0.55 }],
      boards: run(-L / 2 + 1, L / 2 - 1, 1),
      boardW: 1,
      boardY: [deck, deck + plan.parapet],
      plank: 6,
    };
  }
  if (kind === 'kobaya') {
    return { ...plain, hull: KOBAYA_PLAN.hull, scale: 1, walls: null, plank: 4 };
  }
  if (kind === 'mingship') {
    const plan = MING_PLAN;
    const h = plan.hull;
    const L = h.length;
    const deck = h.deck;
    const c = plan.castle;
    return {
      ...plain,
      hull: h,
      scale: 1,
      walls: { x0: -L / 2 + 0.3, x1: L / 2 - 0.3, base: () => deck, top: (x) => deck + plan.parapet + (x < 0 ? 0.95 : 0.5) * Math.pow(Math.abs((2 * x) / L), 2.4), outer: (x) => sideAt(h, x, deck) + 0.04, thick: 0.26 },
      blocks: [{ x0: c.x - c.hx, x1: c.x + c.hx, y0: deck, y1: deck + c.h1 + c.h2, hz: c.hz }],
      sails: plan.masts.map((m) => ({ x: m.x + 0.42, yTop: deck + m.h - 1.2, w: m.sailW, h: m.sailH, billow: 1.1 })),
      boards: run(-L / 2 + 1, L / 2 - 1, 1.4),
      boardW: 1.4,
      boardY: [deck, deck + plan.parapet],
      plank: 10,
    };
  }
  if (kind === 'mingsmall') {
    const plan = MINGSMALL_PLAN;
    const h = plan.hull;
    const L = h.length;
    const deck = h.deck;
    const c = plan.cabin;
    return {
      ...plain,
      hull: h,
      scale: 1,
      walls: { x0: -L / 2 + 0.3, x1: L / 2 - 0.3, base: () => deck, top: (x) => deck + plan.parapet + 0.4 * Math.pow(Math.abs((2 * x) / L), 2.4), outer: (x) => sideAt(h, x, deck) + 0.04, thick: 0.2 },
      blocks: [{ x0: c.x - c.hx, x1: c.x + c.hx, y0: deck, y1: deck + c.h, hz: c.hz }],
      sails: plan.masts.map((m) => ({ x: m.x + 0.42, yTop: deck + m.h - 0.9, w: m.sailW, h: m.sailH, billow: 0.7 })),
      boards: run(-L / 2 + 1, L / 2 - 1, 1.2),
      boardW: 1.2,
      boardY: [deck, deck + plan.parapet],
      plank: 8,
    };
  }
  return null;
}

const cache = new Map<string, ShipSurface | null>();

/** The surface of a ship drawn with model `key` (kind#variant of the model's kind) for a ship of `kind`. */
export function surfaceFor(key: string, kind: ShipKind): ShipSurface | null {
  const id = `${key}@${kind}`;
  let s = cache.get(id);
  if (s === undefined) {
    const base = build(key);
    s = base ? { ...base, scale: kind === 'geobukseon' ? base.scale : anchorScale(kind) } : null;
    cache.set(id, s);
  }
  return s;
}

/** The model a kind is drawn with: the model key for a ship's view key. */
export const surfaceKey = (kind: ShipKind, variant: number) => `${modelKind(kind)}#${variant}`;

/** What a shell reached. */
export const Part = { Hull: 0, Water: 1, Deck: 2, Wall: 3, Castle: 4, Roof: 5 } as const;
export type PartId = (typeof Part)[keyof typeof Part];

/** Where a shell met the surface: the point and outward normal in plan metres, the part, and the wall board (or -1). */
export type Strike = { x: number; y: number; z: number; nx: number; ny: number; nz: number; part: PartId; board: number };

/** Which solid holds a point, or -1: 0 hull (deck from above), 1 wall, 2 castle block, 3 turtle roof. */
function inside(s: ShipSurface, x: number, y: number, z: number) {
  const h = s.hull;
  const L = h.length;
  if (Math.abs(x) > L / 2) return -1;
  const az = Math.abs(z);
  const top = hullTop(h, x);
  if (y <= top) return az <= sideAt(h, x, y) ? 0 : -1;
  if (s.roof) return az <= sideAt(h, x, top) + 0.45 && y <= geobukRoofY(GEOBUK_PLAN, x, z) ? 3 : -1;
  for (const b of s.blocks) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && az <= b.hz) return 2;
  const w = s.walls;
  if (w && x >= w.x0 && x <= w.x1 && y >= w.base(x) && y <= w.top(x)) {
    const o = w.outer(x);
    if (az <= o && az >= o - w.thick) return 1;
  }
  return -1;
}

/**
 * Walks a shell's line back from the sim's hit point (px, py, pz, inside or near the sim's box) to where it first met
 * the model's surface, coming in along (dx, dy, dz) (unit, plan frame). Fills `out` and returns true, or false when the
 * line passes the model by (a shot the sim's box caught over an open deck).
 */
export function strike(s: ShipSurface, px: number, py: number, pz: number, dx: number, dy: number, dz: number, out: Strike) {
  const back = 6;
  const step = 0.1;
  let x = px - dx * back;
  let y = py - dy * back;
  let z = pz - dz * back;
  let solid = -1;
  let i = 0;
  const n = Math.round((back * 2 + 4) / step);
  for (; i < n; i += 1) {
    solid = inside(s, x, y, z);
    if (solid >= 0) break;
    x += dx * step;
    y += dy * step;
    z += dz * step;
  }
  if (solid < 0) return false;
  // Bisect the last step down to a centimetre.
  let lo = 0;
  let hi = step;
  for (let k = 0; k < 4; k += 1) {
    const mid = (lo + hi) / 2;
    if (inside(s, x - dx * mid, y - dy * mid, z - dz * mid) >= 0) lo = mid;
    else hi = mid;
  }
  x -= dx * lo;
  y -= dy * lo;
  z -= dz * lo;
  out.x = x;
  out.y = y;
  out.z = z;
  out.board = -1;
  const sz = z >= 0 ? 1 : -1;
  const h = s.hull;
  const e = 0.05;
  if (solid === 0) {
    const top = hullTop(h, x);
    if (y > top - 0.08 && Math.abs(z) < sideAt(h, x, top) - 0.15) {
      // Came down on the deck.
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      out.part = Part.Deck;
      return true;
    }
    // The side: the gradient of |z| - side(x, y).
    const gx = -(sideAt(h, x + e, y) - sideAt(h, x - e, y)) / (2 * e);
    const gy = y < top - e ? -(sideAt(h, x, y + e) - sideAt(h, x, y - e)) / (2 * e) : 0;
    const l = Math.hypot(gx, gy, 1);
    out.nx = gx / l;
    out.ny = gy / l;
    out.nz = sz / l;
    out.part = y < 0.4 ? Part.Water : Part.Hull;
    return true;
  }
  if (solid === 1) {
    const w = s.walls!;
    const gx = -(w.outer(x + e) - w.outer(x - e)) / (2 * e);
    const l = Math.hypot(gx, 1);
    out.nx = gx / l;
    out.ny = 0;
    out.nz = sz / l;
    out.part = Part.Wall;
    out.board = boardAt(s, x);
    return true;
  }
  if (solid === 2) {
    // The face of the block the line entered by: the one the point is nearest.
    for (const b of s.blocks) {
      if (x < b.x0 - 0.01 || x > b.x1 + 0.01 || y < b.y0 - 0.01 || y > b.y1 + 0.01) continue;
      const faces = [x - b.x0, b.x1 - x, b.hz - Math.abs(z), b.y1 - y];
      let f = 0;
      for (let k = 1; k < 4; k += 1) if (faces[k]! < faces[f]!) f = k;
      out.nx = f === 0 ? -1 : f === 1 ? 1 : 0;
      out.ny = f === 3 ? 1 : 0;
      out.nz = f === 2 ? sz : 0;
      break;
    }
    out.part = Part.Castle;
    return true;
  }
  const gx = -(geobukRoofY(GEOBUK_PLAN, x + e, z) - geobukRoofY(GEOBUK_PLAN, x - e, z)) / (2 * e);
  const gz = -(geobukRoofY(GEOBUK_PLAN, x, z + e) - geobukRoofY(GEOBUK_PLAN, x, z - e)) / (2 * e);
  const l = Math.hypot(gx, 1, gz);
  out.nx = gx / l;
  out.ny = 1 / l;
  out.nz = gz / l;
  out.part = Part.Roof;
  return true;
}

/** The wall board at station x, or -1. */
export function boardAt(s: ShipSurface, x: number) {
  const b = s.boards;
  for (let i = 0; i < b.length; i += 1) if (Math.abs(x - b[i]!) <= s.boardW / 2) return i;
  return -1;
}

/** A point on a sail at fractions (u across, v down) and its forward normal, for a fire arrow landing in it. */
export function sailPoint(sail: SailPlane, u: number, v: number, out: Strike) {
  const bulge = sail.billow * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
  out.x = sail.x + bulge;
  out.y = sail.yTop - sail.h * v;
  out.z = (u - 0.5) * sail.w;
  out.nx = 1;
  out.ny = 0;
  out.nz = 0;
  out.part = Part.Castle;
  out.board = -1;
  return out;
}
