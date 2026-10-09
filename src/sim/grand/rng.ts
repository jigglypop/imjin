/**
 * Seeded random numbers for the grand campaign. The generator's whole state is one 32-bit integer that lives in the
 * save, so a reloaded game goes on exactly as the original would have, and the same code can run on a server.
 */
export type Rng = { s: number };

/** Scrambles any integer into a well mixed 32-bit value (the "lowbias32" finalizer). */
export function mix32(n: number): number {
  let x = n >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

export function makeRng(seed: number): Rng {
  return { s: mix32(seed) || 1 };
}

/** An independent generator derived from a seed and some tags, so a battle's result does not depend on what else was rolled. */
export function forkRng(seed: number, ...tags: number[]): Rng {
  let h = mix32(seed);
  for (const t of tags) h = mix32(h ^ mix32(t + 0x9e3779b9));
  return { s: h || 1 };
}

/** Uniform in [0, 1). mulberry32. */
export function next(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const range = (r: Rng, lo: number, hi: number) => lo + (hi - lo) * next(r);
