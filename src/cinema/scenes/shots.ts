import { at } from '../subjects';
import type { Act, Orbit, Pick, Shot, Target } from '../types';

/**
 * The camera set-ups of the commander close-ups (settled in .claude/skills/cinematics/SKILL.md). Metres in the
 * commander's frame: forward the way he faces (toward the enemy), up from his feet, right to his right. A flagship's
 * figure stands 1.12 x 1.8 m, his eyes about 1.85 m up.
 */

/** His ship from a little off the bow, while his figure is not on deck yet (or never comes, on a failed load). */
const around = (ship: Pick): Orbit => ({ type: 'orbit', at: at(ship), yaw: [0.95, 0.75], pitch: [0.07, 0.09], dist: [62, 54], lift: 6 });

/**
 * Head and shoulders, about 85 mm, the lens wide open so the sea behind him melts: a slow push-in. `side` puts the
 * camera off his left (-1, the side's own commander, looking screen right) or his right (+1, the reverse shot).
 */
export const closeUp = (who: string, ship: Pick, dur: number, side: 1 | -1, acts?: Act[]): Shot => ({
  dur,
  cam: { type: 'figure', who, at: at(ship), from: [3.3, 1.86, 0.7 * side], to: [2.7, 1.88, 0.58 * side], look: [0, 1.7, 0], fallback: around(ship) },
  fov: 20,
  aperture: 1.6,
  ease: 'inOut',
  acts,
});

/** Waist up, about 50 mm, as he gives the order: the command clip starts at once and the camera pushes in on it. */
export const command = (who: string, ship: Pick, dur: number): Shot => ({
  dur,
  cam: { type: 'figure', who, at: at(ship), from: [3.7, 2.0, 0.9], to: [2.7, 1.95, 0.6], look: [0, 1.55, 0], fallback: around(ship) },
  fov: 30,
  aperture: 0.8,
  ease: 'out',
  acts: [{ who, move: 'command', at: 0.4 }],
});

/** Over his shoulder toward the enemy he faces: his back sharp, the enemy fleet soft beyond. */
export const overShoulder = (who: string, ship: Pick, dur: number): Shot => ({
  dur,
  cam: { type: 'figure', who, at: at(ship), from: [-1.7, 2.02, 0.8], to: [-1.45, 2.0, 0.7], look: [40, 0.2, -3], fallback: around(ship) },
  fov: 28,
  aperture: 0.3,
});

/** The hand-off: from the last shot into the battle camera. */
export const home = (target: Target, dur = 4.5): Shot => ({ dur, cam: { type: 'home', at: target }, ease: 'inOut' });
