import type { Battle } from './battle';
import type { Ship } from './types';

/** A fire larger than this throws sparks and burning pitch onto the hulls around it, the more the nearer it is to a blaze. */
const SPREAD_FROM = 0.5;
/** Hull-to-hull gap in metres beyond which nothing reaches across the wind; a full wind carries sparks twice as far downwind. */
const SPREAD_REACH = 30;
const DOWNWIND_REACH = 1;
/** Chance per second that a blaze catches an alongside hull in a crosswind. */
const SPREAD_RATE = 0.12;
/** A ship under way can sheer off from a burning neighbour; one lying still cannot. */
const UNDER_WAY = 1.5;
const UNDER_WAY_SHARE = 0.15;
/** How much a following wind helps, at WIND_FULL m/s and above. */
const DOWNWIND = 0.85;
const WIND_FULL = 10;
/** Most new fires per second that spreading lights across the whole battle, so a packed bay burns over minutes, not in a breath. */
const SPREAD_BUDGET = 1;
const SPREAD_IGNITE = 0.2;

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
    const wind = Math.min(1, b.waves.state.wind / WIND_FULL);
    const wx = Math.cos(b.windAngle);
    const wz = Math.sin(b.windAngle);
    const look = s.spec.length * 0.5 + SPREAD_REACH * (1 + DOWNWIND_REACH) + 20;
    b.near(s.x, s.z, look, (o) => {
      if (o === s || !o.alive || o.sinking > 0 || o.fire > 0.6 || this.budget < 1) return;
      const dx = o.x - s.x;
      const dz = o.z - s.z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      const gap = d - (s.spec.length + o.spec.length) * 0.35;
      const along = (dx * wx + dz * wz) / d;
      const reach = SPREAD_REACH * (1 + DOWNWIND_REACH * wind * Math.max(0, along));
      if (gap > reach) return;
      const closeness = 1 - Math.max(0, gap) / reach;
      const downwind = 1 + DOWNWIND * wind * along;
      const blaze = (s.fire - SPREAD_FROM) / (1 - SPREAD_FROM);
      const chance = SPREAD_RATE * blaze * closeness * downwind * (Math.abs(o.speed) > UNDER_WAY ? UNDER_WAY_SHARE : 1) * dt;
      if (b.random() >= chance) return;
      this.budget -= 1;
      b.ignite(o, SPREAD_IGNITE, s.id);
    });
  }
}
