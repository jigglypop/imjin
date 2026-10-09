import type { Battle } from '../sim/battle';
import type { AmmoType, Projectile } from '../sim/types';

/**
 * How a shell is drawn. The sim flies shells at 120-150 m/s on the low-arc solution, so a 400 m shot rises barely ten
 * metres and reads as a laser. The render lifts the shell above the sim's path by 4*H*s*(1-s), s being the share of the
 * flight flown: nothing at the muzzle, nothing at the impact (where the sim says it is, so hits, splashes and debris do
 * not move) and a clear hump between. This file predicts when the sim will end a shell; it never changes the sim.
 */

/** The sim's gravity (battle.ts). */
const G = 9.81;
/** Peak lift of the drawn arc as a share of the horizontal range. */
const ARC: Record<AmmoType, number> = { ball: 0.07, fire: 0.07, arrow: 0.085, grape: 0.03 };
const SCAN = 0.02;
const LAND_STEP = 0.15;

/** Seconds until a shell at height y rising at vy comes down to height h (0 when it is already below). */
const fallTime = (y: number, vy: number, h: number) => {
  const disc = vy * vy + 2 * G * (y - h);
  return disc <= 0 ? 0 : Math.max(0, (vy + Math.sqrt(disc)) / G);
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Peak height of the arc drawn over a flight of this horizontal range. Point-blank shots stay flat. */
export const arcPeak = (ammo: AmmoType, range: number) => ARC[ammo] * range * smooth(15, 70, range);

/** Seconds from now until the sim ends this shell: a hull, the shore or the sea, whichever it reaches first. */
export function timeToImpact(p: Projectile, battle: Battle, sea: (x: number, z: number) => number, shipRate = 1): number {
  let t = fallTime(p.y, p.vy, 0.3);
  const w = Math.min(1.4, Math.max(-0.5, sea(p.x + p.vx * t, p.z + p.vz * t)));
  t = fallTime(p.y, p.vy, w);
  // The shore: the sim tests the land under a shell only while it flies below 60 m.
  const land = battle.land;
  let prev = 0;
  for (let u = LAND_STEP; prev < t; u += LAND_STEP) {
    const at = Math.min(u, t);
    const y = p.y + p.vy * at - 0.5 * G * at * at;
    if (y < 60) {
      const ground = land(p.x + p.vx * at, p.z + p.vz * at);
      if (ground > 0 && y <= ground) {
        let lo = prev;
        let hi = at;
        for (let i = 0; i < 6; i += 1) {
          const mid = (lo + hi) * 0.5;
          const ym = p.y + p.vy * mid - 0.5 * G * mid * mid;
          const gm = land(p.x + p.vx * mid, p.z + p.vz * mid);
          if (gm > 0 && ym <= gm) hi = mid;
          else lo = mid;
        }
        t = hi;
        break;
      }
    }
    prev = at;
  }
  // Hulls: the sim's own box test, on ships moved along their heading.
  for (const s of battle.ships) {
    if (!s.alive || s.team === p.team || s.sinking >= 0.6) continue;
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    const svx = c * s.speed * shipRate;
    const svz = n * s.speed * shipRate;
    const halfL = s.spec.length * 0.5;
    const reach = halfL + 4;
    const rx = p.x - s.x;
    const rz = p.z - s.z;
    const wx = p.vx - svx;
    const wz = p.vz - svz;
    const a = wx * wx + wz * wz;
    if (a < 1e-6) continue;
    const b = 2 * (rx * wx + rz * wz);
    const disc = b * b - 4 * a * (rx * rx + rz * rz - reach * reach);
    if (disc < 0) continue;
    const root = Math.sqrt(disc);
    const lo = Math.max(0, (-b - root) / (2 * a));
    const hi = Math.min(t, (-b + root) / (2 * a));
    for (let u = lo; u <= hi; u += SCAN) {
      const dx = p.x + p.vx * u - (s.x + svx * u);
      const dz = p.z + p.vz * u - (s.z + svz * u);
      const lx = dx * c + dz * n;
      const lz = -dx * n + dz * c;
      if (Math.abs(lx) > halfL) continue;
      const halfB = s.spec.beam * 0.5 * (1 - Math.pow(Math.abs(lx) / halfL, 3) * 0.6);
      if (Math.abs(lz) > halfB + 0.3) continue;
      const y = p.y + p.vy * u - 0.5 * G * u * u;
      const top = Math.abs(lx) < halfL * 0.5 ? s.spec.height * 0.7 : s.spec.deck + 1.5;
      if (y > top || y < -1.2) continue;
      t = u;
      break;
    }
  }
  return t;
}
