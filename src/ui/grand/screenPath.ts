// The overlay's curves cut to the screen. A sea lane or a fleet's way is one quadratic curve between two ports' points on
// the screen, and close in those points lie tens of thousands of pixels off it. The browser dashes a stroke along its
// whole length before it clips it, on the GPU process's main thread, where the 3D view's commands wait behind it: a
// close view's dashed lanes took it up to a second a frame. So each curve is cut to the part the screen shows first, and
// the dashes of the cut curve are kept in step with the whole one's, so they do not crawl as the view moves.

export interface Point {
  x: number;
  y: number;
}

/** A screen rectangle: x0..x1 across, y0..y1 down. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A curve as drawn: its path, how far along the whole curve the drawn part starts (px) and whether it reaches the curve's end. */
export interface CutCurve {
  d: string;
  skipped: number;
  end: boolean;
}

/** Gauss-Legendre nodes and weights on 0..1: exact for a polynomial of degree 9, and a curve's speed is nearly one. */
const GAUSS = [
  [0.046910077030668, 0.118463442528095],
  [0.230765344947158, 0.239314335249683],
  [0.5, 0.284444444444444],
  [0.769234655052842, 0.239314335249683],
  [0.953089922969332, 0.118463442528095],
] as const;

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The point at `t` of the curve from a through control c to b. */
function pointAt(a: Point, c: Point, b: Point, t: number): Point {
  const s = 1 - t;
  return { x: s * s * a.x + 2 * s * t * c.x + t * t * b.x, y: s * s * a.y + 2 * s * t * c.y + t * t * b.y };
}

/** Pixels the curve covers from its start to `t`. */
function lengthTo(a: Point, c: Point, b: Point, t: number) {
  let sum = 0;
  for (const [node, weight] of GAUSS) {
    const u = node * t;
    sum += weight * Math.hypot((1 - u) * (c.x - a.x) + u * (b.x - c.x), (1 - u) * (c.y - a.y) + u * (b.y - c.y));
  }
  return 2 * t * sum;
}

/** Where along one coordinate the curve passes `k`: the roots in 0..1 of the quadratic. */
function crossings(p0: number, p1: number, p2: number, k: number, out: number[]) {
  const qa = p0 - 2 * p1 + p2, qb = 2 * (p1 - p0), qc = p0 - k;
  if (Math.abs(qa) < 1e-9 * (Math.abs(qb) + Math.abs(qc) + 1)) {
    if (qb !== 0) out.push(-qc / qb);
    return;
  }
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return;
  const root = Math.sqrt(disc);
  out.push((-qb - root) / (2 * qa), (-qb + root) / (2 * qa));
}

const inside = (p: Point, r: Rect) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
const f = (n: number) => n.toFixed(1);

/**
 * The curve from `a` through control `c` to `b`, cut to the part inside `rect` (from where it first comes in to where it
 * last goes out), or null when none of it is. With a `period` (the dash pattern's length, px) the cut starts on a whole
 * period of the uncut curve, so a dash pattern that is animated and cannot be offset still lines up; otherwise `skipped`
 * is the length cut off before the start, the stroke-dashoffset that lines the dashes up.
 */
export function cutCurve(a: Point, c: Point, b: Point, rect: Rect, period = 0): CutCurve | null {
  const whole = { d: `M${f(a.x)} ${f(a.y)}Q${f(c.x)} ${f(c.y)} ${f(b.x)} ${f(b.y)}`, skipped: 0, end: true };
  // A curve lies inside the triangle of its points: one wholly on the screen is drawn as it is, one wholly off it not at all.
  const xs = [a.x, c.x, b.x], ys = [a.y, c.y, b.y];
  if (Math.min(...xs) >= rect.x0 && Math.max(...xs) <= rect.x1 && Math.min(...ys) >= rect.y0 && Math.max(...ys) <= rect.y1) return whole;
  if (Math.max(...xs) < rect.x0 || Math.min(...xs) > rect.x1 || Math.max(...ys) < rect.y0 || Math.min(...ys) > rect.y1) return null;
  const ts = [0, 1];
  crossings(a.x, c.x, b.x, rect.x0, ts);
  crossings(a.x, c.x, b.x, rect.x1, ts);
  crossings(a.y, c.y, b.y, rect.y0, ts);
  crossings(a.y, c.y, b.y, rect.y1, ts);
  const cuts = ts.filter((t) => t >= 0 && t <= 1).sort((p, q) => p - q);
  let t0 = -1, t1 = -1;
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    if (cuts[i + 1]! - cuts[i]! < 1e-12 || !inside(pointAt(a, c, b, (cuts[i]! + cuts[i + 1]!) / 2), rect)) continue;
    if (t0 < 0) t0 = cuts[i]!;
    t1 = cuts[i + 1]!;
  }
  if (t0 < 0) return null;
  if (t0 <= 0 && t1 >= 1) return whole;
  let skipped = t0 > 0 ? lengthTo(a, c, b, t0) : 0;
  if (period > 0 && skipped > 0) {
    // Back to the last whole period before the cut, found by halving: the length grows with t.
    const want = Math.floor(skipped / period) * period;
    let lo = 0, hi = t0;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (lengthTo(a, c, b, mid) < want) lo = mid;
      else hi = mid;
    }
    t0 = want > 0 ? lo : 0;
    skipped = 0;
  }
  // The piece from t0 to t1, by de Casteljau: split at t1, then split the first part where t0 falls in it.
  const end = pointAt(a, c, b, t1), mid1 = lerp(a, c, t1);
  const u = t1 > 0 ? t0 / t1 : 0;
  const start = pointAt(a, mid1, end, u), control = lerp(mid1, end, u);
  return { d: `M${f(start.x)} ${f(start.y)}Q${f(control.x)} ${f(control.y)} ${f(end.x)} ${f(end.y)}`, skipped, end: t1 >= 1 };
}
