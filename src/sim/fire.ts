import type { Battle } from './battle';
import type { Ship } from './types';

/** A fire this large throws sparks and burning pitch onto the hulls around it. */
const SPREAD_FROM = 0.4;
/** Hull-to-hull gap in metres beyond which nothing reaches. */
const SPREAD_REACH = 45;
/** Chance per second that a full fire catches an alongside hull in a crosswind. */
const SPREAD_RATE = 0.1;
/** A ship under way can sheer off from a burning neighbour; one lying still cannot. */
const UNDER_WAY = 1.5;
const UNDER_WAY_SHARE = 0.35;
/** How much a following wind helps, at WIND_FULL m/s and above. */
const DOWNWIND = 0.85;
const WIND_FULL = 10;
/** Most new fires per second that spreading lights across the whole battle, so a packed bay burns over minutes, not in a breath. */
const SPREAD_BUDGET = 1.5;
const SPREAD_IGNITE = 0.15;

/**
 * Fire that jumps between hulls under the depth rules. A ship burning hard sets the ships lying close to it alight,
 * friend or foe, more readily downwind; a wet-straw screen (ShipSpec.fireResist) keeps some of what lands off. A fleet at
 * anchor or packed in a crowd can go up together; one that scatters loses a ship or two.
 */
export class FireSpread {
  private budget = SPREAD_BUDGET;
  private at = 0;

  constructor(private readonly b: Battle) {}

  /** One look at a burning ship, `dt` seconds after the last. */
  spread(s: Ship, dt: number) {
    const b = this.b;
    if (s.fire < SPREAD_FROM || s.sinking > 0.5) return;
    // The budget refills with battle time, whichever ship is looked at.
    this.budget = Math.min(SPREAD_BUDGET, this.budget + (b.time - this.at) * SPREAD_BUDGET);
    this.at = b.time;
    const wind = DOWNWIND * Math.min(1, b.waves.state.wind / WIND_FULL);
    const wx = Math.cos(b.windAngle);
    const wz = Math.sin(b.windAngle);
    const reach = s.spec.length * 0.5 + SPREAD_REACH + 20;
    b.near(s.x, s.z, reach, (o) => {
      if (o === s || !o.alive || o.sinking > 0 || o.fire > 0.6 || this.budget < 1) return;
      const dx = o.x - s.x;
      const dz = o.z - s.z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      const gap = d - (s.spec.length + o.spec.length) * 0.35;
      if (gap > SPREAD_REACH) return;
      const closeness = 1 - Math.max(0, gap) / SPREAD_REACH;
      const downwind = 1 + wind * ((dx * wx + dz * wz) / d);
      const chance = SPREAD_RATE * s.fire * closeness * downwind * (Math.abs(o.speed) > UNDER_WAY ? UNDER_WAY_SHARE : 1) * dt;
      if (b.random() >= chance) return;
      this.budget -= 1;
      b.ignite(o, SPREAD_IGNITE, s.id);
    });
  }
}
