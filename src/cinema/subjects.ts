import type { Ship, Team } from '../sim/types';
import type { Pick, SceneContext, Target } from './types';

/** Subjects a script names: a commander's flagship, a fleet, the ship of the event that started a beat. */

const alive = (s: Ship | undefined) => !!s && s.alive && s.sinking === 0;

/** The flagship of the squadron whose commander's name contains `name`; else that squadron's first ship afloat. */
export const commander = (name: string): Pick => (ctx: SceneContext) => {
  const b = ctx.battle;
  for (const sq of b.squadrons) {
    if (!sq.commander.includes(name)) continue;
    const ships = sq.shipIds.map((id) => b.get(id)).filter(alive) as Ship[];
    return ships.find((s) => s.flagship) ?? ships[0];
  }
  return undefined;
};

/** Every ship afloat of a team; `faction` narrows it (the Ming fleet sails on the Joseon team). */
export const fleet = (team: Team, faction?: string): Pick => (ctx) => {
  const ships = ctx.battle.ships.filter((s) => s.team === team && alive(s) && (!faction || s.spec.faction === faction));
  return ships.length ? ships : undefined;
};

/** The ships afloat of the squadrons whose commander's name contains `name`. */
export const squadron = (name: string): Pick => (ctx) => {
  const b = ctx.battle;
  const ships = b.squadrons.filter((sq) => sq.commander.includes(name)).flatMap((sq) => sq.shipIds.map((id) => b.get(id)).filter(alive) as Ship[]);
  return ships.length ? ships : undefined;
};

/** The first pick that finds a ship: a commander's flagship, else any flagship of the team, else its nearest ship. */
export const first = (...picks: Pick[]): Pick => (ctx) => {
  for (const p of picks) {
    const found = p(ctx);
    if (found && (!Array.isArray(found) || found.length)) return found;
  }
  return undefined;
};

/** A team's flagship afloat, the one with the most crew when there are several. */
export const flagship = (team: Team, faction?: string): Pick => (ctx) => {
  const ships = ctx.battle.ships.filter((s) => s.team === team && s.flagship && alive(s) && (!faction || s.spec.faction === faction));
  return ships.sort((a, b) => b.crew - a.crew)[0];
};

/** The ship of the event that started a beat (it may already be sinking: the beat is about that). */
export const eventShip: Pick = (ctx) => {
  const s = ctx.battle.get(ctx.event);
  return s && s.alive ? s : undefined;
};

/** The enemy ship nearest a subject. */
export const nearestFoe = (of: Pick): Pick => (ctx) => {
  const got = of(ctx);
  const s = Array.isArray(got) ? got[0] : got;
  if (!s) return undefined;
  let best: Ship | undefined;
  let d = Infinity;
  for (const o of ctx.battle.ships) {
    if (o.team === s.team || !alive(o)) continue;
    const e = Math.hypot(o.x - s.x, o.z - s.z);
    if (e < d) {
      d = e;
      best = o;
    }
  }
  return best;
};

export const at = (pick: Pick, frame?: Target['frame']): Target => ({ pick, frame });
