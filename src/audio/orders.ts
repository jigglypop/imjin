// The score of a commanded fleet: which ships beat a drum, how fast and in what pattern. Pure arithmetic with no audio
// nodes and no sim state of its own, so battlefield.ts plays it and scripts/test-audio-orders.mjs checks it.

import type { MoraleState, Team } from '../sim/types';
import type { ShipActivity } from '../sim/battle';

/**
 * What a leader's drum is saying. `advance` is the march of a fleet under way, `charge` the quickening of one closing
 * to fight or boarding, `engage` the steadier beat of a fleet in the thick of it, `order` the drum order that steadies
 * and rallies the ships around it.
 */
export type BeatMode = 'advance' | 'charge' | 'engage' | 'order';

/** One stroke of a pattern: how hard, and the beats to wait before the next one. */
type Stroke = readonly [gain: number, wait: number];

/**
 * The patterns, per navy. Joseon beat an even, heavy march on the buk and quicken it into a rolling charge; the
 * Japanese played the taiko in pairs with a rest, and charged in rolls with an accent. Both drum the order the same
 * way: one hard stroke, two soft ones and a long pause, so a crew can tell it from a march at once.
 */
const PATTERNS: Record<Team, Record<BeatMode, readonly Stroke[]>> = {
  joseon: {
    advance: [[1, 1], [0.5, 1], [0.72, 1], [0.5, 1]],
    charge: [[1, 0.36], [0.6, 0.36], [0.85, 0.36], [0.6, 0.36]],
    engage: [[0.8, 1], [0.45, 1]],
    order: [[1, 1], [0.6, 0.8], [0.6, 2.2]],
  },
  japan: {
    advance: [[1, 0.5], [0.7, 1.5]],
    charge: [[1, 0.3], [0.5, 0.3], [0.7, 0.3], [0.5, 0.3], [1, 0.3], [0.7, 0.3], [1, 0.6], [0.8, 0.6]],
    engage: [[0.8, 1.2], [0.5, 0.8]],
    order: [[1, 1], [0.6, 0.8], [0.6, 2.2]],
  },
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Seconds in one beat. A fleet at a crawl is drummed slowly and one at full speed twice as fast and more, so the
 * tempo rises as the ships do; a charge is a steady quick beat whatever the pace.
 */
export function beatSeconds(mode: BeatMode, pace: number): number {
  switch (mode) {
    case 'advance':
      return 1.35 - 0.8 * Math.pow(clamp01(pace), 0.8);
    case 'charge':
      return 0.9 - 0.15 * clamp01(pace);
    case 'engage':
      return 1;
    case 'order':
      return 0.55;
  }
}

/** The stroke after `step` strokes of a pattern: its weight, and the seconds to wait for the one after it. */
export function stroke(team: Team, mode: BeatMode, step: number, pace: number): { gain: number; wait: number } {
  const pattern = PATTERNS[team][mode];
  const [gain, wait] = pattern[step % pattern.length]!;
  return { gain, wait: wait * beatSeconds(mode, pace) };
}

/** Pattern length in strokes, for callers that count bars. */
export function patternLength(team: Team, mode: BeatMode) {
  return PATTERNS[team][mode].length;
}

/** Below this share of its top speed a leader is lying to, not advancing. */
export const MARCH_PACE = 0.12;
/** Without the sim's own activity (an online client), a ship this fast is taken to be advancing. */
const FALLBACK_PACE = 0.35;

/**
 * What a leader's drum should say now, or null for silence. A crew that is running does not drum, and a ship at anchor
 * or lying to is quiet: the drum belongs to a fleet that is moving or fighting.
 */
export function modeOf(activity: ShipActivity, pace: number, nerve: MoraleState): BeatMode | null {
  if (nerve === 'routing') return null;
  switch (activity) {
    case 'charging':
    case 'boarding':
      return 'charge';
    case 'engaging':
      return 'engage';
    case 'moving':
      return pace >= MARCH_PACE ? 'advance' : null;
    case 'idle':
      return pace >= FALLBACK_PACE ? 'advance' : null;
    default:
      return null;
  }
}

export type Drummer = { id: number; team: Team; x: number; z: number; gain: number };

/**
 * The few leaders whose drums are voiced: the loudest first, at most `max` of them and `perTeam` of a side, and none
 * within `gap` metres of one already chosen (two ships of a squadron beating side by side are one drum to the ear).
 */
export function pickDrummers<T extends Drummer>(all: T[], max: number, perTeam: number, gap: number): T[] {
  const out: T[] = [];
  const taken: Record<Team, number> = { joseon: 0, japan: 0 };
  for (const d of [...all].sort((a, b) => b.gain - a.gain)) {
    if (out.length >= max) break;
    if (taken[d.team] >= perTeam) continue;
    if (out.some((o) => o.team === d.team && (o.x - d.x) ** 2 + (o.z - d.z) ** 2 < gap * gap)) continue;
    out.push(d);
    taken[d.team] += 1;
  }
  return out;
}
