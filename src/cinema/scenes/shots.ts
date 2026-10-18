import { at } from '../subjects';
import { splitLine } from '../lines';
import type { Act, Caption, Orbit, Pick, Shot, Target } from '../types';

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
  // Chest up, never his feet (a pitching deck shows them clipping), sharp throughout (no depth of field), and the
  // world in slow motion while he speaks so the sea barely moves and he holds steady (owner 2026-10-18).
  cam: { type: 'figure', who, at: at(ship), from: [2.9, 1.85, 0.24 * side], to: [2.6, 1.85, 0.21 * side], look: [0, 1.6, 0], fallback: around(ship), ...clear },
  fov: 22,
  slow: 0.3,
  ease: 'inOut',
  acts,
});

/** Low and a little off his side, waist up, looking up at him against the sky (owner 2026-10-18). */
export const lowMedium = (who: string, ship: Pick, dur: number, side: 1 | -1): Shot => ({
  dur,
  cam: { type: 'figure', who, at: at(ship), from: [3.2, 1.15, 0.62 * side], to: [2.95, 1.18, 0.55 * side], look: [0, 1.55, 0], fallback: around(ship) },
  fov: 25,
  slow: 0.3,
  ease: 'inOut',
});

/** Over his shoulder toward the way he faces (the enemy), his head and shoulder dark in the near frame. */
export const overShoulder = (who: string, ship: Pick, dur: number, side: 1 | -1): Shot => ({
  dur,
  cam: { type: 'figure', who, at: at(ship), from: [-1.45, 1.95, 0.62 * side], to: [-1.2, 1.93, 0.55 * side], look: [16, 1.2, -1.2 * side], fallback: around(ship) },
  fov: 32,
  slow: 0.3,
  ease: 'inOut',
});

/** An insert of his command flag in the wind, from beside him. */
export const flagInsert = (who: string, ship: Pick, dur: number, side: 1 | -1): Shot => ({
  dur,
  cam: { type: 'figure', who, at: at(ship), from: [1.4, 1.5, 1.5 * side], to: [1.3, 1.45, 1.35 * side], look: [0, 4, 0], lookFlag: true, fallback: around(ship) },
  fov: 21,
  slow: 0.3,
  ease: 'inOut',
});

export type Setup = 'low' | 'close' | 'ots' | 'flag';
const SETUPS = { low: lowMedium, close: (who: string, ship: Pick, dur: number, side: 1 | -1) => closeUp(who, ship, dur, side), ots: overShoulder, flag: flagInsert };

type Say = Omit<Extract<Caption, { kind: 'say' }>, 'at' | 'dur' | 'part'>;

/**
 * A commander's line filmed as 1-3 set-ups (owner 2026-10-18: low medium, over the shoulder, close-up, insert), cut on
 * the line's breaks: the subtitle shows one piece per set-up (`splitLine`), each shot as long as its piece reads.
 * `lead`: seconds of the first shot before the subtitle comes in; `tail`: after the last goes.
 */
export function speech(o: { ship: Pick; side: 1 | -1; start: number; dur: number; setups: Setup[]; say: Say; lead?: number; tail?: number }) {
  const lead = o.lead ?? 0.7;
  const tail = o.tail ?? 0.5;
  const parts = o.say.text ? splitLine(o.say.text, o.setups.length) : [''];
  const n = parts.length;
  const total = parts.reduce((sum, p) => sum + Math.max(8, p.length), 0);
  const body = o.dur - lead - tail;
  const shots: Shot[] = [];
  const captions: Caption[] = [];
  let t = o.start;
  for (const [i, p] of parts.entries()) {
    const read = (body * Math.max(8, p.length)) / total;
    const dur = read + (i === 0 ? lead : 0) + (i === n - 1 ? tail : 0);
    shots.push(SETUPS[o.setups[i]!](o.say.cast, o.ship, dur, o.side));
    const at = t + (i === 0 ? lead : 0.12);
    captions.push({ ...o.say, kind: 'say', at, dur: read - 0.3, part: n > 1 ? [i, n] : undefined });
    t += dur;
  }
  return { shots, captions };
}

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
