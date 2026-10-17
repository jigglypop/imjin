/**
 * Where a held sword points while the figure stands (owner 2026-10-17): the body clip stays the pure Meshy idle, only
 * the held weapon turns, so the whole blade hangs outside the legs: down, out to the sword side and a little forward,
 * the edge forward. Body space (+Y up, +Z the figure's front); `hand` and `hips` are positions in that space.
 * Returns the blade direction (weapon +Y) and the edge direction (weapon +X after EDGE_TO_FINGERS), both unit length.
 * scripts/test-idle-blade.mjs checks every idle frame of the live figures: no blade point within 5 cm of the body.
 */
export const IDLE_BLADE = { out: 0.75, forward: 0.3 };
export function idleBlade(hand: readonly number[], hips: readonly number[], tune = IDLE_BLADE) {
  let ox = hand[0]! - hips[0]!, oz = 0;
  const ol = Math.hypot(ox, oz) || 1;
  ox /= ol; oz /= ol;
  const d = [ox * tune.out, -1, oz * tune.out + tune.forward];
  const dl = Math.hypot(d[0]!, d[1]!, d[2]!);
  const dir = d.map((v) => v / dl);
  // edge: the body's front with the blade direction taken out
  const k = dir[2]!;
  const e = [-k * dir[0]!, -k * dir[1]!, 1 - k * dir[2]!];
  const el = Math.hypot(e[0]!, e[1]!, e[2]!);
  return { dir, edge: e.map((v) => v / el) };
}
