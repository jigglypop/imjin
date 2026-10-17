import { at } from '../subjects';
import type { Pick, Shot, Target } from '../types';

/**
 * The camera set-ups of the battle openings (settled in .claude/skills/cinematics/SKILL.md): ships only, the commanders
 * speak through their comms thumbnails (CinemaOverlay), never a 3D close-up.
 */

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

/**
 * On his flagship while he talks (owner 2026-10-17): the battle opening shows ships, and the commander speaks through
 * his comms thumbnail (CinemaOverlay `say`), not a 3D close-up. A slow push along her quarter; `side` mirrors the angle
 * for the reverse (shot / reverse shot between the two flagships) and `alt` gives a second set-up on the same ship, so a
 * cut can fall on each line change.
 */
export const aboard = (ship: Pick, dur: number, side: 1 | -1, alt = false): Shot => ({
  dur,
  cam: alt
    ? { type: 'orbit', at: at(ship), yaw: [side * 0.35, side * 0.2], pitch: [0.11, 0.09], dist: [58, 46], lift: [7, 6] }
    : { type: 'orbit', at: at(ship), yaw: [side * 1.05, side * 0.8], pitch: [0.06, 0.08], dist: [90, 66], lift: [5, 7] },
  fov: [30, 27],
  ease: 'inOut',
});
