import type { Battle } from './battle';
import { applyCommand } from './commands';
import type { ManeuverKind, Plan, Temper } from './maneuvers';
import { otherTeam, type Ship, type Team } from './types';
import { isUnarmed } from './catalog';

/** Seconds between a computer commander's looks at the battle. */
const LOOK = 2;
/** The enemy within this distance of the one nearest the fleet counts as one group. */
const GROUP = 700;
/** Where a crane is spread: the enemy this far off and coming on, the ring this wide. */
const CRANE_FAR = 2600;
const CRANE_NEAR = 650;
const CRANE_R = 400;
/** The same kind of maneuver is not ordered again this soon after one ended. */
const AGAIN = 90;
/** Pursuit: this many enemy crews running, or this share of them, is worth sending ships after. */
const PURSUE_MIN = 3;
const PURSUE_SHARE = 0.25;
/** A lure is sent against an anchored enemy at least this far away, with this many ships. */
const LURE_FAR = 900;
const LURE_SHIPS = 5;

type Group = { x: number; z: number; vx: number; vz: number; n: number; strength: number; anchored: number; ships: Ship[] };

/**
 * The computer's commanders under the maneuver rules. Each one looks at the battle every few seconds and gives the same
 * commands a person could (applyCommand), chosen by its temper: a steady commander spreads the crane wing before the
 * enemy reaches it, or lures an anchored fleet out onto it; a bold one sends two squadrons round both sides; by night
 * either lies in wait, dark, where the enemy's way runs narrowest; every one sends ships after a broken enemy. A rash
 * commander's ships just go in.
 */
export class Tactician {
  private next = 0;
  /** When each commander's last maneuver of a kind ended, and the plans it has running. */
  private readonly ended = new Map<string, number>();
  private readonly issued = new Map<number, string>();
  private readonly seen = new Map<number, { x: number; z: number; at: number }>();

  constructor(private readonly b: Battle) {}

  step() {
    const b = this.b;
    if (b.time < this.next || b.rules) return;
    this.next = b.time + LOOK;
    const owners = new Map<number, Ship[]>();
    for (const s of b.ships) {
      if (!b.isActive(s) || !b.isAi(s)) continue;
      const list = owners.get(s.owner) ?? [];
      list.push(s);
      owners.set(s.owner, list);
    }
    for (const [owner, ships] of owners) this.lead(owner, ships);
  }

  private plansOf(owner: number) {
    const out: Plan[] = [];
    for (const p of this.b.maneuvers!.plans.values()) if (p.owner === owner && p.phase !== 'done') out.push(p);
    return out;
  }

  private lead(owner: number, ships: Ship[]) {
    const b = this.b;
    const m = b.maneuvers!;
    const team = ships[0]!.team;
    if (b.isRetreating(team)) return;
    for (const [id, key] of this.issued) {
      if (m.plans.has(id)) continue;
      this.issued.delete(id);
      this.ended.set(key, b.time);
    }
    const plans = this.plansOf(owner);
    const free = ships.filter((s) => s.order.type !== 'maneuver' && s.moraleState !== 'routing' && s.moraleState !== 'rallying' && !s.grappledWith && !isUnarmed(s.spec));
    if (!free.length) return;
    // Every commander sends ships after a broken enemy.
    if (this.pursue(owner, team, free)) return;
    if (plans.some((p) => p.kind !== 'pursue')) return;
    const group = this.enemyGroup(team, free);
    if (!group) return;
    const gunners = free.filter((s) => !boardsFirstKind(s) && s.spec.kind !== 'hyeopseon' && m.temper(b.squadron(s.squadronId)) !== 'rash');
    if (gunners.length < 4) return;
    const fleet = centroid(gunners);
    const d = Math.hypot(group.x - fleet.x, group.z - fleet.z);
    // In contact already: each ship fights its own fight.
    if (d < CRANE_NEAR || this.engaged(gunners)) return;
    const temper = this.temperOf(gunners);
    const closing = (group.vx * (fleet.x - group.x) + group.vz * (fleet.z - group.z)) / Math.max(1, d) > 0.5;
    if (b.night && temper !== 'rash' && closing && d > 1300 && this.ready(owner, 'ambush')) {
      const zone = this.narrows(group, fleet);
      if (zone) {
        this.order(owner, gunners, 'ambush', zone.x, zone.z, zone.x + 330, zone.z);
        return;
      }
    }
    if (temper === 'bold' && closing && d < 2400 && this.squadronsOf(gunners) >= 2 && this.ready(owner, 'pincer')) {
      // Two wings round both sides of where the enemy will be in a minute.
      const cx = group.x + group.vx * 60;
      const cz = group.z + group.vz * 60;
      const a = Math.atan2(fleet.z - cz, fleet.x - cx) + Math.PI / 2;
      this.order(owner, gunners, 'pincer', cx + Math.cos(a) * 600, cz + Math.sin(a) * 600, cx - Math.cos(a) * 600, cz - Math.sin(a) * 600);
      return;
    }
    if (group.anchored > group.n * 0.6 && d > LURE_FAR && temper !== 'bold' && this.ready(owner, 'lure')) {
      // An anchored enemy is drawn out: a few ships show themselves and fall back onto the crane.
      const bait = [...gunners].sort((p, q) => Math.hypot(p.x - group.x, p.z - group.z) - Math.hypot(q.x - group.x, q.z - group.z)).slice(0, LURE_SHIPS);
      const rest = gunners.filter((s) => !bait.includes(s));
      const u = { x: (group.x - fleet.x) / d, z: (group.z - fleet.z) / d };
      const c = rest.length >= 4 ? this.crane(owner, rest, fleet, u) : { x: fleet.x, z: fleet.z };
      this.order(owner, bait, 'lure', group.x - u.x * 350, group.z - u.z * 350, c.x, c.z);
      return;
    }
    if ((closing || d < 1500) && d < CRANE_FAR && this.ready(owner, 'crane')) {
      const u = { x: (group.x - fleet.x) / d, z: (group.z - fleet.z) / d };
      // Against boarders with room to spare, a few ships go out as bait and lead the chase into the bowl's middle,
      // where both wings reach it, as at Hansan; the rest spread the wings.
      const boarders = group.ships.filter((o) => o.spec.faction === 'japan').length > group.n / 2;
      if (boarders && d > LURE_FAR && gunners.length >= 12 && this.ready(owner, 'lure')) {
        const bait = gunners.filter((s) => !s.flagship).sort((p, q) => Math.hypot(p.x - group.x, p.z - group.z) - Math.hypot(q.x - group.x, q.z - group.z)).slice(0, LURE_SHIPS - 1);
        const rest = gunners.filter((s) => !bait.includes(s));
        const c = this.crane(owner, rest, fleet, u);
        this.order(owner, bait, 'lure', group.x - u.x * 380, group.z - u.z * 380, c.x, c.z);
      } else this.crane(owner, gunners, fleet, u);
    }
  }

  /** The crane wing: its bowl where the fleet lies, its wings reaching toward the enemy. */
  private crane(owner: number, ships: Ship[], fleet: { x: number; z: number }, u: { x: number; z: number }) {
    const r = CRANE_R;
    const cx = fleet.x + u.x * r;
    const cz = fleet.z + u.z * r;
    this.order(owner, ships, 'crane', cx, cz, cx + u.x * r, cz + u.z * r);
    return { x: cx, z: cz };
  }

  private order(owner: number, ships: Ship[], kind: ManeuverKind, x0: number, z0: number, x1: number, z1: number) {
    const m = this.b.maneuvers!;
    const spot0 = m.wetSpot(x0, z0);
    if (applyCommand(this.b, owner, { type: 'maneuver', ids: ships.map((s) => s.id), kind, x0: spot0.x, z0: spot0.z, x1, z1 })) this.track(owner, kind);
  }

  /** Remembers the plan just ordered, to know when it ends. */
  private track(owner: number, kind: ManeuverKind) {
    let last = 0;
    for (const p of this.b.maneuvers!.plans.values()) if (p.owner === owner && p.kind === kind) last = Math.max(last, p.id);
    if (last) this.issued.set(last, `${owner}:${kind}`);
  }

  private ready(owner: number, kind: ManeuverKind) {
    const at = this.ended.get(`${owner}:${kind}`);
    return at === undefined || this.b.time - at >= AGAIN;
  }

  /** Ships after the enemy's running crews, when enough of them run. Returns whether it sent any. */
  private pursue(owner: number, team: Team, free: Ship[]) {
    const b = this.b;
    const foes = b.activeOf(otherTeam(team));
    let running = 0;
    for (const o of foes) if (o.moraleState === 'routing') running += 1;
    if (running < PURSUE_MIN || running < foes.length * PURSUE_SHARE) return false;
    const idle = free.filter((s) => {
      if (boardsFirstKind(s)) return false;
      let busy = false;
      b.near(s.x, s.z, 380, (o) => {
        if (!busy && o.team !== s.team && b.isActive(o) && o.moraleState !== 'routing') busy = true;
      });
      return !busy;
    });
    if (idle.length < 2) return false;
    if (!applyCommand(b, owner, { type: 'maneuver', ids: idle.map((s) => s.id), kind: 'pursue', x0: idle[0]!.x, z0: idle[0]!.z, x1: idle[0]!.x, z1: idle[0]!.z })) return false;
    this.track(owner, 'pursue');
    return true;
  }

  /** The enemy group nearest the fleet, with its heading over the last looks. */
  private enemyGroup(team: Team, own: Ship[]): Group | null {
    const b = this.b;
    const fleet = centroid(own);
    let seed: Ship | undefined;
    let bestD = Infinity;
    for (const o of b.activeOf(otherTeam(team))) {
      if (o.moraleState === 'routing') continue;
      const d = Math.hypot(o.x - fleet.x, o.z - fleet.z);
      if (d < bestD && b.canSee(o, d, team)) {
        bestD = d;
        seed = o;
      }
    }
    if (!seed) return null;
    const ships: Ship[] = [];
    let strength = 0;
    let anchored = 0;
    b.near(seed.x, seed.z, GROUP, (o) => {
      if (o.team === team || !b.isActive(o) || o.moraleState === 'routing') return;
      ships.push(o);
      strength += o.spec.hull;
      if (o.order.type === 'anchor' || o.order.type === 'hold' || o.speed < 0.5) anchored += 1;
    });
    const c = centroid(ships);
    const key = seed.squadronId;
    const last = this.seen.get(key);
    let vx = 0;
    let vz = 0;
    if (last && b.time - last.at > 0.5) {
      vx = (c.x - last.x) / (b.time - last.at);
      vz = (c.z - last.z) / (b.time - last.at);
    }
    if (!last || b.time - last.at >= 6) this.seen.set(key, { x: c.x, z: c.z, at: b.time });
    return { x: c.x, z: c.z, vx, vz, n: ships.length, strength, anchored, ships };
  }

  /** Whether the fleet is already in a gunfight. */
  private engaged(own: Ship[]) {
    const b = this.b;
    let n = 0;
    for (const s of own) {
      let near = false;
      b.near(s.x, s.z, 450, (o) => {
        if (!near && o.team !== s.team && b.isActive(o) && o.moraleState !== 'routing') near = true;
      });
      if (near) n += 1;
    }
    return n > own.length * 0.3;
  }

  /** The commander of most of the ships: the temper of the largest squadron among them. */
  private temperOf(ships: Ship[]): Temper {
    const b = this.b;
    const count = new Map<number, number>();
    for (const s of ships) count.set(s.squadronId, (count.get(s.squadronId) ?? 0) + 1);
    let best = 0;
    let bestN = -1;
    for (const [id, n] of count) if (n > bestN) {
      bestN = n;
      best = id;
    }
    return b.maneuvers!.temper(b.squadron(best));
  }

  private squadronsOf(ships: Ship[]) {
    const count = new Map<number, number>();
    for (const s of ships) count.set(s.squadronId, (count.get(s.squadronId) ?? 0) + 1);
    let n = 0;
    for (const v of count.values()) if (v >= 4) n += 1;
    return n;
  }

  /**
   * Where the enemy's way to the fleet runs narrowest: along the line from the enemy to the fleet, the point with the
   * least water across it, not too close to either. Null when the water is open all the way.
   */
  private narrows(group: Group, fleet: { x: number; z: number }) {
    const b = this.b;
    const dx = fleet.x - group.x;
    const dz = fleet.z - group.z;
    const d = Math.hypot(dx, dz);
    const ux = dx / d;
    const uz = dz / d;
    let best: { x: number; z: number } | null = null;
    let bestW = Infinity;
    for (let t = 500; t <= d - 400; t += 100) {
      const x = group.x + ux * t;
      const z = group.z + uz * t;
      if (!b.isWater(x, z)) continue;
      let w = 0;
      for (const side of [1, -1]) {
        for (let k = 50; k <= 2000; k += 50) {
          if (!b.isWater(x - uz * k * side, z + ux * k * side)) break;
          w += 50;
        }
      }
      if (w < bestW) {
        bestW = w;
        best = { x, z };
      }
    }
    return best && bestW < 2400 ? best : null;
  }
}

const boardsFirstKind = (s: Ship) => s.spec.faction === 'japan';

function centroid(ships: readonly { x: number; z: number }[]) {
  let x = 0;
  let z = 0;
  for (const s of ships) {
    x += s.x;
    z += s.z;
  }
  return { x: x / Math.max(1, ships.length), z: z / Math.max(1, ships.length) };
}
