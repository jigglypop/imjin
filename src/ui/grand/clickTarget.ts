/**
 * What a click on a port means once a force of the player's is selected. Kept apart from the screen so the rule can be
 * tested: an attack is one click, a friendly port still opens its panel unless the move mode was asked for.
 */
export type PortClick = 'order' | 'blocked' | 'open';

export interface PortClickInput {
  /** The "move" mode is on (a fleet panel's button): any reachable port is a destination. */
  moving: boolean;
  /** Ports the selected fleet can reach, or undefined when no ready fleet of ours is selected. */
  reachable: readonly string[] | undefined;
  /** The clicked port belongs to a faction at war with the player. */
  hostile: boolean;
  port: string;
}

export function portClick({ moving, reachable, hostile, port }: PortClickInput): PortClick {
  const inReach = !reachable || reachable.includes(port);
  if (moving) return inReach ? 'order' : 'blocked';
  // Outside the move mode only an enemy port is a target; anything else is looked at, as before.
  return hostile && !!reachable && inReach ? 'order' : 'open';
}
