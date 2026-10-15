import type { Battle } from './battle';
import type { AmmoType, Ship } from './types';

/** A shot within this cosine of the target's keel line (about 23 degrees either way) rakes it from bow or stern. */
const RAKE_COS = 0.92;
/** A raking ball travels the length of the hull: more planking broken, and the open deck swept end to end. */
export const RAKE_HULL = 1.25;
export const RAKE_CREW = 1.4;
const RAKE_SHOCK = 0.02;
/** Hits from two quarters this far apart (radians) within CROSS_WINDOW seconds: the crew cannot face both. */
const CROSS_ANGLE = 1.75;
const CROSS_WINDOW = 3;
export const CROSS_DAMAGE = 1.15;
const CROSS_SHOCK = 0.03;
/** Ships keeping station in a formation: friends this close on the same heading hold the line together. */
const COHESION_RANGE = 110;
const COHESION_HEADING = 0.35;
const COHESION_FRIENDS = 2;
/** A crew that keeps its place in the line aims better; one sailing in its leader's wake rows a little faster. */
export const COHESION_AIM = 1.08;
export const WAKE_SPEED = 1.05;

type Recent = { t: number; bearing: number; shooter: number }[];

/**
 * The geometry of a gun fight under the depth rules. Shots down a ship's keel line rake it; hits from two quarters at
 * once catch it in a crossfire; ships that keep their place in a formation shoot straighter and hold their nerve.
 * These make the crane, the line and the column more than ways of standing.
 */
export class Tactics {
  /** The last few hits on each ship: when, from which bearing and by whom, for the crossfire. */
  private readonly recent = new Map<number, Recent>();
  /** When each ship was last caught in a crossfire, so one fight does not shake it twice in a breath. */
  private readonly crossAt = new Map<number, number>();
  /** Ships keeping station in a formation, as of their last look. */
  readonly cohesive = new Set<number>();

  constructor(private readonly b: Battle) {}

  /**
   * A shot travelling (vx, vz) struck `target`. Returns what its hull damage and crew losses are multiplied by and
   * which bonus it earned, and shakes the crew for a rake or a crossfire.
   */
  hit(target: Ship, shooter: number, ammo: AmmoType, vx: number, vz: number) {
    const b = this.b;
    const speed = Math.sqrt(vx * vx + vz * vz) || 1;
    const along = (vx * Math.cos(target.heading) + vz * Math.sin(target.heading)) / speed;
    let hull = 1;
    let crew = 1;
    let bonus: 'rake' | 'cross' | undefined;
    // A round or a heavy arrow down the keel breaks more planking; shot and grape sweep the deck end to end.
    if (ammo !== 'fire' && Math.abs(along) > RAKE_COS) {
      hull = ammo === 'grape' ? 1 : RAKE_HULL;
      crew = ammo === 'arrow' ? 1 : RAKE_CREW;
      bonus = 'rake';
      b.morale?.shock(target, RAKE_SHOCK);
    }
    const bearing = Math.atan2(-vz, -vx);
    let list = this.recent.get(target.id);
    if (!list) {
      list = [];
      this.recent.set(target.id, list);
    }
    let cross = false;
    for (const r of list) {
      if (b.time - r.t > CROSS_WINDOW || r.shooter === shooter) continue;
      const diff = Math.abs(Math.atan2(Math.sin(r.bearing - bearing), Math.cos(r.bearing - bearing)));
      if (diff > CROSS_ANGLE) cross = true;
    }
    if (list.length >= 4) list.shift();
    list.push({ t: b.time, bearing, shooter });
    if (cross) {
      hull *= CROSS_DAMAGE;
      crew *= CROSS_DAMAGE;
      bonus ??= 'cross';
      if (b.time - (this.crossAt.get(target.id) ?? -Infinity) > CROSS_WINDOW) {
        this.crossAt.set(target.id, b.time);
        b.morale?.shock(target, CROSS_SHOCK);
      }
    }
    return { hull, crew, bonus };
  }

  /** Whether `target` was hit in the last seconds from a quarter far from where `from` lies: a shot from it now is a crossfire. */
  crossing(target: Ship, from: Ship) {
    const list = this.recent.get(target.id);
    if (!list) return false;
    const mine = Math.atan2(from.z - target.z, from.x - target.x);
    for (const r of list) {
      if (this.b.time - r.t > CROSS_WINDOW + 1 || r.shooter === from.id) continue;
      if (Math.abs(Math.atan2(Math.sin(r.bearing - mine), Math.cos(r.bearing - mine))) > CROSS_ANGLE) return true;
    }
    return false;
  }

  /** Whether a ship keeping station in a formation still has its neighbours beside it on the same heading. */
  formation(s: Ship) {
    const b = this.b;
    const type = s.order.type;
    // A ship cut off from its leader by a breach has lost its place in the line, whatever its order.
    if ((type !== 'slot' && type !== 'follow' && type !== 'maneuver') || s.moraleState === 'routing' || b.maneuvers?.isCut(s)) {
      this.cohesive.delete(s.id);
      return;
    }
    let friends = 0;
    b.near(s.x, s.z, COHESION_RANGE, (o) => {
      if (o === s || o.team !== s.team || !b.isActive(o) || (o.order.type !== 'slot' && o.order.type !== 'follow' && o.order.type !== 'maneuver')) return;
      const diff = Math.abs(Math.atan2(Math.sin(o.heading - s.heading), Math.cos(o.heading - s.heading)));
      if (diff < COHESION_HEADING) friends += 1;
    });
    if (friends >= COHESION_FRIENDS) this.cohesive.add(s.id);
    else this.cohesive.delete(s.id);
  }

  /** A ship left the fight: nothing about it needs remembering. */
  forget(id: number) {
    this.recent.delete(id);
    this.crossAt.delete(id);
    this.cohesive.delete(id);
  }
}
