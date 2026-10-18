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
 * A clean medium close-up (owner 2026-10-18): chest up, the camera at his eye level a little off his face, the
 * figure centred (the camera looks at his upper chest), a very slow push-in, fixed focus. `side` only says which side
 * of his face the camera stands, by 0.25 m. No orbit, no over-the-shoulder.
 */
/** `clear`: a turn about him and a share of the distance found by scripts/probe-cine-occlusion.mjs --search. */
export const closeUp = (who: string, ship: Pick, dur: number, side: 1 | -1, acts?: Act[], clear?: { turn: number; reach: number }): Shot => ({
  dur,
  cam: { type: 'figure', who, at: at(ship), from: [3.1, 1.9, 0.25 * side], to: [2.8, 1.9, 0.22 * side], look: [0, 1.75, 0], fallback: around(ship), ...clear },
  fov: 24,
  aperture: 0.6,
  ease: 'inOut',
  acts,
});

/**
 * The order, as a camera beat (the figures only stand, owner 2026-10-17): low off his flagship's quarter, pushing in as
 * she leads toward the enemy, the order as a subtitle over it.
 */
export const order = (ship: Pick, toward: Pick, dur: number): Shot => ({
  dur,
  cam: { type: 'orbit', at: at(ship, { toward }), yaw: [Math.PI - 0.62, Math.PI - 0.4], pitch: [0.07, 0.045], dist: [130, 82], lift: [9, 6] },
  fov: [32, 27],
  ease: 'inOut',
});

/** The hand-off: from the last shot into the battle camera. */
export const home = (target: Target, dur = 4.5): Shot => ({ dur, cam: { type: 'home', at: target }, ease: 'inOut' });
