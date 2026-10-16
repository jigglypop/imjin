import type { Battle } from './battle';
import { wrapAngle } from './battle';
import { Tactician } from './tactician';
import { otherTeam, type Ship, type Squadron, type Team } from './types';

/**
 * Tactical maneuvers under the battle depth rules (depth-v2): orders given to a squadron as a whole, each with its own
 * rules in the simulation, so that a lure into a crane wing, an ambush at a narrows, a pincer, a charge through the
 * enemy's line or a blockade of a bay mouth come out of play instead of a script.
 *
 *   ambush    ships take stations round a kill zone, dark and with guns held, and spring on the first enemy to enter it
 *   pincer    the selection splits into two wings that stage on both sides of a target and close together
 *   breach    a column drives through a gap in the enemy line; ships it passes between and their leader are cut off
 *   encircle  a ring (or the crane wing, a half ring) round the enemy that closes, with one side left open if wanted
 *   blockade  a line across a channel or bay mouth that holds its place and fires at anything passing
 *   lure      bait shows itself, then withdraws to a point just ahead of its pursuers and beats the drum there
 *   pursue    ships run down the enemy's routing crews
 *
 * A flagship's signals reach only so far (flags by day, drum and lanterns by night): ships beyond that, or cut off from
 * their leader, take each change of a plan's phase late and hold their nerve less well.
 */
export type ManeuverKind = 'ambush' | 'pincer' | 'breach' | 'encircle' | 'crane' | 'blockade' | 'lure' | 'pursue';
export const MANEUVER_KINDS: readonly ManeuverKind[] = ['ambush', 'pincer', 'breach', 'encircle', 'crane', 'blockade', 'lure', 'pursue'];
/** forming: taking stations; waiting: in place, holding for the trigger; striking: the maneuver itself; done: released. */
export type ManeuverPhase = 'forming' | 'waiting' | 'striking' | 'done';
/** The drum to advance (springs waiting plans and opens fire) and the gong to fall back. */
export type SignalKind = 'advance' | 'withdraw';
export const SIGNAL_KINDS: readonly SignalKind[] = ['advance', 'withdraw'];
/** How a commander leads: a rash one takes any bait, a cautious one keeps near its anchorage and its friends. */
export type Temper = 'rash' | 'bold' | 'steady' | 'cautious';

export type Slot = { x: number; z: number; face: number };

export type Plan = {
  id: number;
  owner: number;
  team: Team;
  kind: ManeuverKind;
  ids: number[];
  phase: ManeuverPhase;
  /** The phase before the last change, which ships that have not yet heard the signal still follow. */
  prev: ManeuverPhase | null;
  since: number;
  /** The geometry the order was given with: a zone (centre and rim), a line, or a point and a direction. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  open: boolean;
  /** The moving frame of a ring or a pincer: its centre and radius, and the direction its open side or first wing faces. */
  cx: number;
  cz: number;
  r: number;
  face: number;
  /** A ring's span in radians; a sprung ambush's radius when it sprang. */
  span: number;
  /** Per ship: the bearing from the frame centre and the rank, fixed when the ring is laid out. */
  layout: Map<number, { a: number; rank: number }>;
  /** Pincer wings, by ship. */
  wing: Map<number, 0 | 1>;
  /** Stations while forming or waiting (ambush, blockade, pincer staging). */
  stations: Map<number, Slot>;
  /** Seconds each ship takes to hear the last phase change. */
  lag: Map<number, number>;
  /** Breach: the column's order and the next waypoint; lure: the leading bait ship. */
  column: number[];
  leg: number;
  /** When the ring last had an enemy inside it, and when its layout was last built. */
  contact: number;
  laidAt: number;
  layoutR: number;
};

/** Seconds between two looks at each plan, and between the computer's tactical decisions. */
const PLAN_TICK = 0.5;
/** Ships in a line keep at least this much water between their centres: a panokseon's length and room to turn. */
const SPACING = 70;
/** A ring's ranks stand this far apart, the outer one staggered half a station. */
const RANK_GAP = 80;
/** A gun ship on station backs away from a boarder closing within this distance. */
const EVADE = 120;
/** Station keeping: a ship is on station within ARRIVE metres and leaves it beyond LEAVE. */
const ARRIVE = 25;
const LEAVE = 60;
/** A ring closes at this pace (m/s) and its centre follows the enemy no faster than FRAME_SPEED. */
const CLOSE_RATE = 2.5;
const FRAME_SPEED = 2.5;
/** Released when no enemy has been within its reach for this long. */
const IDLE_RELEASE = 40;
/** A flagship's signals: flags seen by day, the drum and lanterns heard and seen by night. */
const COMMAND_DAY = 1500;
const COMMAND_NIGHT = 800;
/** A ship beyond its flagship's signals hears a phase change this late, plus a second per LAG_STEP metres, at most LAG_MAX. */
const LAG_BASE = 4;
const LAG_STEP = 40;
const LAG_MAX = 25;
/** Cut off by a breach: how long, and how close to the line between a ship and its leader the breaching ship must pass. */
const CUT_TIME = 60;
const CUT_NEAR = 55;
const CUT_LAG = 8;
/** Only enemies the column passes close by, and commanders not too far off for the line between them to matter. */
const CUT_REACH = 250;
const CUT_SPAN = 1500;
/** Ambush: the zone's rim is this far inside the stations, and an enemy this close to an ambusher finds it. */
const AMBUSH_STANDOFF = 110;
const AMBUSH_FOUND = 200;
/** Ambushes laid this close together spring together: the first one's guns are the signal. */
const AMBUSH_JOIN = 1200;
/** An ambush springs on an enemy within reach of stations whose bearings from it are more than this many radians apart. */
const AMBUSH_CROSS = 1.75;
/**
 * An ambush leaves its rim open this many radians either side of the bearing of the enemy within ENTRY_LOOK, and of
 * the bearing across from it.
 */
const ENTRY_GAP = 0.6;
const ENTRY_LOOK = 8000;
/** A sprung ambush: hits in the first seconds catch crews not at their stations. */
export const SURPRISE_TIME = 10;
export const SURPRISE_CREW = 1.5;
export const SURPRISE_SHOCK = 0.04;
/** The computer's waiting plans spring or dissolve after this long, so no battle waits on them forever. */
const AI_WAIT = 240;
/** Breach: the column's ships fire both broadsides when both have an enemy this close, at most once per VOLLEY_GAP. */
const BREACH_VOLLEY = 170;
const VOLLEY_GAP = 8;
/** Lure: the bait keeps its pursuers between these distances. */
const LURE_NEAR = 220;
const LURE_FAR = 450;
const LURE_SHOW = 500;
/** Routing crews: how far they look for open water, by day and by night, and how often they look again. */
const ROUT_SIGHT_DAY = 1000;
const ROUT_SIGHT_NIGHT = 600;
const ROUT_LOOK = 3;
/** A crew that finds no water this far ahead with an enemy close gives itself up after TRAPPED seconds. */
const TRAPPED_OPEN = 300;
const TRAPPED_FOE = 500;
const TRAPPED = 15;
/**
 * A crew whose way home is barred runs for its side's haven within HAVEN_REACH, the pull weighing about as much as open
 * water dead ahead; within HAVEN_IN of the haven it is in. Barred: cut off, less than BARRED_OPEN of open water toward
 * home, or BARRED_SHIPS enemies still fighting within BARRED_RANGE inside BARRED_CONE radians of the way home.
 */
const BARRED_OPEN = 350;
const BARRED_RANGE = 900;
const BARRED_CONE = 1;
const BARRED_SHIPS = 2;
const HAVEN_REACH = 4200;
const HAVEN_IN = 650;
const HAVEN_PULL = 1;
/** Crews of a rash or bold commander chase a fleeing ship this far; a cautious one leaves its anchorage no further than WANDER. */
const CHASE = 1400;
const WANDER = 900;

const hyp = (x: number, z: number) => Math.sqrt(x * x + z * z);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const TAU = Math.PI * 2;

/** Whether the straight line from a to b passes through the hull of `o`, with a margin of a few metres. */
function crosses(ax: number, az: number, bx: number, bz: number, o: Ship) {
  const c = Math.cos(o.heading);
  const n = Math.sin(o.heading);
  const px = ax - o.x;
  const pz = az - o.z;
  const qx = bx - o.x;
  const qz = bz - o.z;
  const la0 = px * c + pz * n;
  const la1 = -px * n + pz * c;
  const dx = qx * c + qz * n - la0;
  const dz = -qx * n + qz * c - la1;
  const hl = o.spec.length * 0.5 + 2;
  const hb = o.spec.beam * 0.5 + 2;
  let t0 = 0;
  let t1 = 1;
  const edges = [-dx, la0 + hl, dx, hl - la0, -dz, la1 + hb, dz, hb - la1];
  for (let i = 0; i < 8; i += 2) {
    const p = edges[i]!;
    const q = edges[i + 1]!;
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false;
      continue;
    }
    const k = q / p;
    if (p < 0) {
      if (k > t1) return false;
      if (k > t0) t0 = k;
    } else {
      if (k < t0) return false;
      if (k < t1) t1 = k;
    }
  }
  return t0 <= t1;
}

export class Maneuvers {
  readonly plans = new Map<number, Plan>();
  private nextId = 1;
  private tick = 0;
  /** Ships on station, for the hysteresis between arriving and leaving. */
  private readonly onStation = new Set<number>();
  /** Ship id to when it stops being cut off from its leader, and who cut it off. */
  readonly cut = new Map<number, { until: number; by: number }>();
  /** Sprung ambushes: the shooter's plan and until when its hits are a surprise. */
  private readonly surprise = new Map<number, number>();
  private readonly volleyAt = new Map<number, number>();
  /** Friendly hulls across a firing line, cached for a fifth of a second. */
  private laneAt = -1;
  private readonly lanes = new Map<number, boolean>();
  /** Enemies each ship is shooting at, counted once a step, for spreading fire. */
  private targetsAt = -1;
  private readonly targeted = new Map<number, number>();
  /** Routing crews: the heading they chose and when, and how long they have been trapped. */
  private readonly runs = new Map<number, { h: number; at: number; open: number; trapped: number; haven: boolean }>();
  /** Where each squadron started, for cautious commanders who keep near it. */
  private homes: Map<number, { x: number; z: number }> | null = null;
  private readonly tactician: Tactician;

  constructor(private readonly b: Battle) {
    this.tactician = new Tactician(b);
  }

  /** The plan a ship is following, if it is. */
  planOf(s: Ship): Plan | undefined {
    return s.order.type === 'maneuver' ? this.plans.get(s.order.plan) : undefined;
  }

  temper(sq: Squadron | undefined): Temper {
    if (!sq) return 'bold';
    return sq.temper ?? (sq.team === 'japan' ? 'bold' : 'steady');
  }

  // ---- giving orders

  /**
   * A maneuver for these ships (already checked to be the owner's). The geometry is what the order was drawn with: for
   * an ambush the zone's centre and a point on its rim, for a pincer, breach, blockade or lure a line, for a ring its
   * centre and a point on its rim (which way its open side faces). Returns the plan, or null when nothing could be done.
   */
  order(owner: number, ids: number[], kind: ManeuverKind, x0: number, z0: number, x1: number, z1: number, open = false): Plan | null {
    const b = this.b;
    let ships = ids.map((id) => b.get(id)).filter((s): s is Ship => b.isActive(s) && s.moraleState !== 'routing');
    if (!ships.length) return null;
    const team = ships[0]!.team;
    const plan: Plan = {
      id: this.nextId++,
      owner,
      team,
      kind,
      ids: ships.map((s) => s.id),
      phase: 'forming',
      prev: null,
      since: b.time,
      x0, z0, x1, z1,
      open,
      cx: x0,
      cz: z0,
      r: 0,
      face: 0,
      span: 0,
      layout: new Map(),
      wing: new Map(),
      stations: new Map(),
      lag: new Map(),
      column: [],
      leg: 0,
      contact: b.time,
      laidAt: -1,
      layoutR: 0,
    };
    // A ship leaves whatever plan it was in for the new one.
    const before = new Map(ships.map((s) => [s.id, { order: s.order, queue: s.orderQueue }]));
    for (const s of ships) {
      s.order = { type: 'maneuver', plan: plan.id };
      s.orderQueue = undefined;
      this.onStation.delete(s.id);
    }
    this.plans.set(plan.id, plan);
    const laid = this.lay(plan, ships);
    for (const s of ships) {
      if (laid && plan.ids.includes(s.id)) continue;
      const was = before.get(s.id)!;
      s.order = was.order.type === 'maneuver' ? { type: 'auto' } : was.order;
      s.orderQueue = was.queue;
    }
    if (!laid) {
      this.plans.delete(plan.id);
      return null;
    }
    ships = ships.filter((s) => plan.ids.includes(s.id));
    // A ring has its stations from the moment it is ordered, not from the plan's next look.
    if (plan.kind === 'crane' || plan.kind === 'encircle') this.layRing(plan, ships);
    this.hear(plan, ships);
    this.announce(plan);
    return plan;
  }

  /** Sets up each kind's stations and frame. False when the geometry cannot be used (a line on dry land). */
  private lay(plan: Plan, ships: Ship[]) {
    const b = this.b;
    const { x0, z0, x1, z1 } = plan;
    const fleet = centroid(ships);
    switch (plan.kind) {
      case 'ambush': {
        // Stations on the zone's rim, each ship on the side it comes from: two squadrons on both shores of a narrows
        // lie on both sides of it. Guns held and lanterns out until it springs.
        plan.r = clamp(hyp(x1 - x0, z1 - z0), 150, 900);
        const ring = plan.r + AMBUSH_STANDOFF;
        // Stations already held by the side's other waiting plans are not handed out again.
        const taken: Slot[] = [];
        for (const other of this.plans.values()) if (other !== plan && other.team === plan.team && other.phase !== 'striking') taken.push(...other.stations.values());
        // The rim the enemy comes in by and the one across from it are left open, the ships lying on the two sides of
        // its way as on both shores of a narrows: a station across its way would meet the van head on, before anything
        // had come in between the two sides.
        const foe = this.enemyCentroid({ x: x0, z: z0 }, ENTRY_LOOK, plan.team);
        const entry = foe && hyp(foe.x - x0, foe.z - z0) > plan.r ? Math.atan2(foe.z - z0, foe.x - x0) : null;
        const sorted = [...ships].sort((p, q) => Math.atan2(p.z - z0, p.x - x0) - Math.atan2(q.z - z0, q.x - x0));
        for (const s of sorted) {
          const a = Math.atan2(s.z - z0, s.x - x0);
          // A rim crowded or run aground on that side: the ship lies in a rank further back on its own side instead,
          // and only then further round the rim, where the enemy might come on it before it comes into the zone.
          let spot: Slot | null = null;
          for (const turn of [0.6, Math.PI]) for (let rank = 0; rank < 5 && !spot; rank += 1) spot = this.wetNear(x0, z0, a, ring + rank * RANK_GAP, taken, turn, entry);
          if (!spot) continue;
          taken.push(spot);
          plan.stations.set(s.id, spot);
        }
        if (!plan.stations.size) return false;
        // A ship with no water to wait in keeps its old orders.
        plan.ids = plan.ids.filter((id) => plan.stations.has(id));
        b.configure(plan.ids, { fireMode: 'hold', ...(b.night ? { lights: false } : {}) });
        return true;
      }
      case 'pincer': {
        // Two wings, each staging at one end of the line drawn across the target, broadside on to it.
        const ax = x1 - x0;
        const az = z1 - z0;
        const len = hyp(ax, az);
        if (len < 60) return false;
        plan.cx = (x0 + x1) / 2;
        plan.cz = (z0 + z1) / 2;
        plan.face = Math.atan2(z0 - plan.cz, x0 - plan.cx);
        const along = (s: Ship) => (s.x - plan.cx) * ax + (s.z - plan.cz) * az;
        // Squadrons stay together: whole squadrons go to the end they lie nearer, the larger first, keeping the wings even.
        const groups = new Map<number, Ship[]>();
        for (const s of ships) {
          const list = groups.get(s.squadronId) ?? [];
          list.push(s);
          groups.set(s.squadronId, list);
        }
        const wings: [Ship[], Ship[]] = [[], []];
        if (groups.size >= 2) {
          const order = [...groups.values()].sort((p, q) => q.length - p.length || p[0]!.id - q[0]!.id);
          for (const g of order) {
            const lean = g.reduce((v, s) => v + along(s), 0) / g.length;
            const want: 0 | 1 = lean < 0 ? 0 : 1;
            const other: 0 | 1 = want ? 0 : 1;
            const pick = wings[want].length + g.length > wings[other].length + g.length + ships.length / 3 ? other : want;
            wings[pick].push(...g);
          }
        } else {
          const sorted = [...ships].sort((p, q) => along(p) - along(q));
          sorted.forEach((s, i) => wings[i < sorted.length / 2 ? 0 : 1].push(s));
        }
        if (!wings[0].length || !wings[1].length) {
          const all = [...wings[0], ...wings[1]];
          wings[0] = all.slice(0, Math.ceil(all.length / 2));
          wings[1] = all.slice(Math.ceil(all.length / 2));
        }
        const ends = [{ x: x0, z: z0 }, { x: x1, z: z1 }];
        wings.forEach((w, k) => {
          const end = ends[k]!;
          const toward = Math.atan2(plan.cz - end.z, plan.cx - end.x);
          const px = -Math.sin(toward);
          const pz = Math.cos(toward);
          w.sort((p, q) => (p.x - end.x) * px + (p.z - end.z) * pz - ((q.x - end.x) * px + (q.z - end.z) * pz));
          w.forEach((s, i) => {
            const off = (i - (w.length - 1) / 2) * SPACING;
            const spot = this.wetSpot(end.x + px * off, end.z + pz * off);
            plan.stations.set(s.id, { x: spot.x, z: spot.z, face: toward });
            plan.wing.set(s.id, k as 0 | 1);
          });
        });
        plan.r = 320;
        b.configure(plan.ids, { fireMode: 'free' });
        return true;
      }
      case 'breach': {
        if (hyp(x1 - x0, z1 - z0) < 60) return false;
        // The flagship leads if it is among them, then the squadron leaders, then the rest by distance from the start.
        const leaders = new Set(b.squadrons.map((sq) => sq.leaderId));
        plan.column = [...ships]
          .sort((p, q) => Number(q.flagship) - Number(p.flagship) || Number(leaders.has(q.id)) - Number(leaders.has(p.id)) || hyp(p.x - x0, p.z - z0) - hyp(q.x - x0, q.z - z0))
          .map((s) => s.id);
        b.configure(plan.ids, { fireMode: 'free' });
        return true;
      }
      case 'crane':
      case 'encircle': {
        // A ring round the drawn centre: the crane opens its wings toward the enemy from the fleet's side; the full ring
        // closes round the enemy, leaving its open side toward the drawn point if asked.
        plan.r = clamp(hyp(x1 - x0, z1 - z0), 220, 700);
        plan.cx = x0;
        plan.cz = z0;
        plan.face = plan.kind === 'crane' ? Math.atan2(fleet.z - z0, fleet.x - x0) : Math.atan2(z1 - z0, x1 - x0);
        b.configure(plan.ids, { fireMode: 'free' });
        return true;
      }
      case 'blockade': {
        const len = hyp(x1 - x0, z1 - z0);
        if (len < 40) return false;
        const ux = (x1 - x0) / len;
        const uz = (z1 - z0) / len;
        // The water along the line, in 10 m steps: the ships spread over it, two ranks when it is short.
        const wet: number[] = [];
        for (let d = 0; d <= len; d += 10) if (this.wetFor(x0 + ux * d, z0 + uz * d, 18)) wet.push(d);
        if (!wet.length) return false;
        const per = Math.max(1, Math.min(ships.length, Math.floor(wet.length * 10 / SPACING) + 1));
        const back = Math.atan2(fleet.z - (z0 + z1) / 2, fleet.x - (x0 + x1) / 2);
        const nx = -uz;
        const nz = ux;
        const behind = Math.cos(back) * nx + Math.sin(back) * nz >= 0 ? 1 : -1;
        const sorted = [...ships].sort((p, q) => (p.x - x0) * ux + (p.z - z0) * uz - ((q.x - x0) * ux + (q.z - z0) * uz));
        sorted.forEach((s, i) => {
          const rank = Math.floor(i / per);
          const inRank = Math.min(per, sorted.length - rank * per);
          const k = i % per;
          const at = wet[Math.min(wet.length - 1, Math.round(((k + 0.5 + (rank % 2) * 0.5) / inRank) * (wet.length - 1)))]!;
          const spot = this.wetSpot(x0 + ux * at + nx * behind * rank * RANK_GAP, z0 + uz * at + nz * behind * rank * RANK_GAP);
          plan.stations.set(s.id, { x: spot.x, z: spot.z, face: Math.atan2(uz, ux) });
        });
        b.configure(plan.ids, { fireMode: 'free' });
        return true;
      }
      case 'lure': {
        plan.column = [...ships].sort((p, q) => Number(q.flagship) - Number(p.flagship) || p.id - q.id).map((s) => s.id);
        b.configure(plan.ids, { fireMode: 'free', ...(b.night ? { lights: true } : {}) });
        return true;
      }
      case 'pursue':
        plan.phase = 'striking';
        b.configure(plan.ids, { fireMode: 'free' });
        return true;
    }
  }

  /** A signal from the selection's flagships: the drum springs the owner's waiting plans; the gong breaks them off. */
  signal(owner: number, ids: number[], kind: SignalKind) {
    const b = this.b;
    const ships = ids.map((id) => b.get(id)).filter((s): s is Ship => b.isActive(s) && s.owner === owner);
    if (!ships.length) return 0;
    const from = this.signaller(ships);
    b.events.push({ type: 'signal', ship: from.id, signal: kind });
    if (kind === 'advance') {
      let n = 0;
      for (const plan of this.plans.values()) {
        if (plan.owner !== owner || plan.phase === 'done' || plan.phase === 'striking') continue;
        if (plan.kind === 'ambush' || plan.kind === 'pincer' || plan.kind === 'crane' || plan.kind === 'encircle') {
          this.setPhase(plan, 'striking', from);
          n += 1;
        }
      }
      b.configure(ships.map((s) => s.id), { fireMode: 'free' });
      return Math.max(n, 1);
    }
    // The gong: the ships break off whatever they were doing and fall back behind their flagship, away from the enemy.
    const foe = this.enemyCentroid(from, 3000);
    const away = foe ? Math.atan2(from.z - foe.z, from.x - foe.x) : from.heading + Math.PI;
    const list = ships.map((s) => {
      const spot = this.wetSpot(s.x + Math.cos(away) * 500, s.z + Math.sin(away) * 500);
      return { s, spot };
    });
    for (const { s, spot } of list) {
      b.setOrder([s.id], { type: 'move', x: spot.x, z: spot.z });
    }
    return list.length;
  }

  /** The ship a signal is flown from: the fleet's flagship among them, else the first squadron leader, else the first. */
  private signaller(ships: Ship[]) {
    const b = this.b;
    return ships.find((s) => s.flagship) ?? ships.find((s) => b.squadron(s.squadronId)?.leaderId === s.id) ?? ships[0]!;
  }

  // ---- each step

  step(dt: number) {
    const b = this.b;
    this.homes ??= this.findHomes();
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick += PLAN_TICK;
    for (const [id, c] of this.cut) if (b.time >= c.until) this.cut.delete(id);
    this.tactician.step();
    for (const plan of this.plans.values()) this.update(plan);
    for (const [id, plan] of this.plans) if (plan.phase === 'done') this.plans.delete(id);
  }

  private findHomes() {
    const homes = new Map<number, { x: number; z: number }>();
    for (const sq of this.b.squadrons) {
      const ships = sq.shipIds.map((id) => this.b.get(id)).filter((s): s is Ship => !!s);
      if (ships.length) homes.set(sq.id, centroid(ships));
    }
    return homes;
  }

  private members(plan: Plan) {
    const b = this.b;
    const out: Ship[] = [];
    for (const id of plan.ids) {
      const s = b.get(id);
      if (b.isActive(s) && s.order.type === 'maneuver' && s.order.plan === plan.id) out.push(s);
    }
    return out;
  }

  private update(plan: Plan) {
    const b = this.b;
    const ships = this.members(plan);
    if (!ships.length) {
      plan.phase = 'done';
      return;
    }
    const waited = b.time - plan.since;
    const ai = b.isAi(ships[0]!);
    switch (plan.kind) {
      case 'ambush': {
        if (plan.phase === 'forming' && ships.every((s) => this.onStation.has(s.id) || waited > 120)) this.setPhase(plan, 'waiting', null);
        if (plan.phase === 'forming' || plan.phase === 'waiting') {
          const trigger = this.ambushTrigger(plan, ships);
          // The computer gives up waiting after a while, unless it lies in wait beside a person's ambush: theirs is the call.
          if (trigger || (ai && waited > AI_WAIT && !this.besideHuman(plan))) {
            this.setPhase(plan, 'striking', trigger ?? this.signaller(ships));
            break;
          }
        }
        if (plan.phase === 'striking') this.closeRing(plan, ships);
        break;
      }
      case 'pincer': {
        if (plan.phase === 'forming') {
          let ready = 0;
          for (const s of ships) if (this.onStation.has(s.id)) ready += 1;
          const near = ships.some((s) => this.enemyWithin(s, 320));
          if (ready >= ships.length * 0.7 || near || waited > (ai ? 150 : 240)) this.setPhase(plan, 'striking', this.signaller(ships));
        }
        if (plan.phase === 'striking') this.closeRing(plan, ships);
        break;
      }
      case 'crane':
      case 'encircle': {
        if (plan.phase === 'forming') {
          let ready = 0;
          for (const s of ships) if (this.onStation.has(s.id)) ready += 1;
          if (ready >= ships.length * 0.6 || waited > 150) this.setPhase(plan, 'waiting', null);
        }
        // Enemies inside the ring's reach: it starts to close on them.
        if (plan.phase !== 'striking' && this.enemyNear(plan.cx, plan.cz, plan.r + 120, plan.team)) this.setPhase(plan, 'striking', this.signaller(ships));
        if (plan.phase === 'striking' || plan.kind === 'encircle') this.closeRing(plan, ships);
        else this.layRing(plan, ships);
        if (plan.phase !== 'striking' && ai && waited > AI_WAIT) this.release(plan, ships);
        break;
      }
      case 'breach':
        this.breach(plan, ships);
        break;
      case 'blockade':
        if (plan.phase === 'forming' && ships.every((s) => this.onStation.has(s.id) || waited > 90)) this.setPhase(plan, 'waiting', null);
        break;
      case 'lure':
        this.lure(plan, ships);
        break;
      case 'pursue': {
        const routers = this.routersNear(ships, 1800);
        if (routers) plan.contact = b.time;
        else if (b.time - plan.contact > 30) this.release(plan, ships);
        break;
      }
    }
  }

  /** The first enemy to find an ambush: one inside its zone, one close to an ambusher, or a shot landing on one. */
  private ambushTrigger(plan: Plan, ships: Ship[]): Ship | null {
    const b = this.b;
    // An enemy inside the zone within reach of the guns on two sides of it at once, this ambush's or a friend's lying in
    // wait at the same place: a van just inside the mouth is let come on until the first volley takes it from both
    // sides, as at a narrows.
    const guns = [...ships];
    for (const other of this.plans.values()) {
      if (other !== plan && other.team === plan.team && other.kind === 'ambush' && (other.phase === 'forming' || other.phase === 'waiting') && hyp(other.x0 - plan.x0, other.z0 - plan.z0) < AMBUSH_JOIN) guns.push(...this.members(other));
    }
    let found: Ship | null = null;
    b.near(plan.x0, plan.z0, plan.r, (o) => {
      if (found || o.team === plan.team || !b.isActive(o) || !b.canSee(o, hyp(o.x - plan.x0, o.z - plan.z0), plan.team)) return;
      let side: number | null = null;
      for (const s of guns) {
        const reach = this.range(s) * 0.85;
        if ((o.x - s.x) ** 2 + (o.z - s.z) ** 2 >= reach * reach) continue;
        const a = Math.atan2(s.z - o.z, s.x - o.x);
        if (side !== null && Math.abs(wrapAngle(a - side)) > AMBUSH_CROSS) {
          found = o;
          return;
        }
        side ??= a;
      }
    });
    if (found) return found;
    for (const s of ships) {
      if (b.time - s.lastHit < 1) return s;
      if (this.enemyWithin(s, AMBUSH_FOUND)) return s;
    }
    // The guns of a friend's ambush close by are the signal for this one too.
    for (const other of this.plans.values()) {
      if (other === plan || other.team !== plan.team || other.kind !== 'ambush' || other.phase !== 'striking') continue;
      if (hyp(other.x0 - plan.x0, other.z0 - plan.z0) < AMBUSH_JOIN) return this.members(other)[0] ?? null;
    }
    return null;
  }

  /** Whether a person's ambush on the same side is waiting close by. */
  private besideHuman(plan: Plan) {
    const b = this.b;
    for (const other of this.plans.values()) {
      if (other === plan || other.team !== plan.team || other.kind !== 'ambush' || other.phase === 'striking' || other.phase === 'done') continue;
      const first = b.get(other.ids[0] ?? 0);
      if (first && !b.isAi(first) && hyp(other.x0 - plan.x0, other.z0 - plan.z0) < AMBUSH_JOIN) return true;
    }
    return false;
  }

  /** Changes a plan's phase. Each ship hears it after its delay from `from`, the ship that gave the signal. */
  private setPhase(plan: Plan, phase: ManeuverPhase, from: Ship | null) {
    if (plan.phase === phase) return;
    const b = this.b;
    plan.prev = plan.phase;
    plan.phase = phase;
    plan.since = b.time;
    const ships = this.members(plan);
    if (phase === 'striking') {
      plan.contact = b.time;
      if (plan.kind === 'ambush') {
        // Fire is opened and the zone becomes the ring that closes on whatever came into it.
        plan.cx = plan.x0;
        plan.cz = plan.z0;
        plan.r += AMBUSH_STANDOFF;
        // The radius it sprang at: its stations' bearings were spaced for it.
        plan.span = plan.r;
        for (const s of ships) {
          const st = plan.stations.get(s.id);
          plan.layout.set(s.id, { a: st ? Math.atan2(st.z - plan.z0, st.x - plan.x0) : Math.atan2(s.z - plan.z0, s.x - plan.x0), rank: 0 });
        }
        this.surprise.set(plan.id, b.time + SURPRISE_TIME);
        // Guns run out and every broadside with an enemy in reach goes off at once.
        const ids = ships.map((s) => s.id);
        b.configure(ids, { fireMode: 'free' });
        b.volley(ships.filter((s) => this.enemyWithin(s, this.range(s))).map((s) => s.id), 3);
      }
      if (plan.kind === 'pincer') {
        // The target is what lies between the two wings, held from now on by the frame.
        const t = this.enemyCentroid({ x: plan.cx, z: plan.cz } as Ship, 700, plan.team);
        if (t) {
          plan.cx = t.x;
          plan.cz = t.z;
        }
        const w0 = ships.filter((s) => plan.wing.get(s.id) === 0);
        const c0 = w0.length ? centroid(w0) : { x: plan.x0, z: plan.z0 };
        plan.face = Math.atan2(c0.z - plan.cz, c0.x - plan.cx);
        for (const k of [0, 1] as const) {
          const wing = ships.filter((s) => plan.wing.get(s.id) === k);
          const face = plan.face + (k ? Math.PI : 0);
          this.arc(plan, wing, face, Math.min(1.9, Math.max(0.5, (wing.length * SPACING) / plan.r)), plan.r);
        }
      }
    }
    this.hear(plan, ships, from);
    this.announce(plan);
  }

  /** Each ship's delay before it acts on the plan's current phase. */
  private hear(plan: Plan, ships: Ship[], from: Ship | null = null) {
    plan.lag.clear();
    for (const s of ships) plan.lag.set(s.id, this.delay(s, from));
  }

  /** How late a ship acts on a signal: at once within its flagship's signals, later the further beyond, later still cut off. */
  delay(s: Ship, from: Ship | null = null) {
    const leader = this.leaderOf(s);
    const anchor = leader && leader !== s ? leader : from && from !== s ? from : null;
    let lag = 0;
    if (anchor) {
      const range = this.commandRange();
      const d = hyp(anchor.x - s.x, anchor.z - s.z);
      if (d > range) lag = Math.min(LAG_MAX, LAG_BASE + (d - range) / LAG_STEP);
    } else if (leader === undefined && s.squadronId) lag = LAG_BASE;
    if (this.cut.has(s.id)) lag += CUT_LAG;
    return lag;
  }

  commandRange() {
    return this.b.night ? COMMAND_NIGHT : COMMAND_DAY;
  }

  private leaderOf(s: Ship): Ship | undefined {
    const b = this.b;
    const sq = b.squadron(s.squadronId);
    const leader = sq ? b.get(sq.leaderId) : undefined;
    return b.isActive(leader) && leader.moraleState !== 'routing' ? leader : undefined;
  }

  /** Whether a ship is beyond its flagship's signals or cut off from it: it hears late and its nerve holds less. */
  outOfCommand(s: Ship) {
    if (this.cut.has(s.id)) return true;
    const leader = this.leaderOf(s);
    if (!leader) return s.squadronId > 0 && this.b.squadron(s.squadronId)?.leaderId !== s.id;
    if (leader === s) return false;
    const range = this.commandRange();
    return (leader.x - s.x) ** 2 + (leader.z - s.z) ** 2 > range * range;
  }

  isCut(s: Ship) {
    return this.cut.has(s.id);
  }

  /** The phase this ship acts on: the plan's, once it has heard it. */
  private phaseFor(plan: Plan, s: Ship): ManeuverPhase | null {
    const lag = plan.lag.get(s.id) ?? 0;
    return this.b.time >= plan.since + lag ? plan.phase : plan.prev;
  }

  private announce(plan: Plan) {
    const b = this.b;
    const lead = plan.ids.map((id) => b.get(id)).find((s) => b.isActive(s));
    if (lead) b.events.push({ type: 'maneuver', plan: plan.id, kind: plan.kind, phase: plan.phase, ship: lead.id, team: plan.team });
  }

  /** The ships leave the plan for free combat. */
  private release(plan: Plan, ships: Ship[]) {
    for (const s of ships) {
      s.order = { type: 'auto' };
      this.onStation.delete(s.id);
    }
    plan.prev = plan.phase;
    plan.phase = 'done';
    plan.since = this.b.time;
    this.announce(plan);
  }

  // ---- rings: the crane, the full ring, a pincer's wings and a sprung ambush

  /** Lays the crane or the ring out round its frame: ranks of stations SPACING apart, the outer ones staggered. */
  private layRing(plan: Plan, ships: Ship[]) {
    const n = ships.length;
    const spread = plan.layoutR ? plan.r / plan.layoutR : 0;
    if (plan.laidAt >= 0 && plan.layout.size >= n && spread > 0.85 && spread < 1.25) return;
    plan.laidAt = this.b.time;
    plan.layoutR = plan.r;
    if (plan.kind === 'crane') {
      const span = clamp((n * SPACING) / plan.r, 1.2, 3.6);
      this.arc(plan, ships, plan.face, span, plan.r);
    } else {
      // The open side is a gap of a quarter turn round the drawn direction; the rest of the circle is filled.
      const gap = plan.open ? Math.PI / 2 : 0;
      this.arc(plan, ships, plan.face + Math.PI, TAU - gap - (plan.open ? 0 : TAU / Math.max(4, n)), plan.r);
    }
    plan.span = plan.kind === 'crane' ? clamp((n * SPACING) / plan.r, 1.2, 3.6) : TAU;
  }

  /** Assigns ships to stations on an arc round the frame centre, by their bearing so no two cross. */
  private arc(plan: Plan, ships: Ship[], face: number, span: number, r: number) {
    if (!ships.length) return;
    const perRank = Math.max(1, Math.floor((span * r) / SPACING) + 1);
    const slots: { a: number; rank: number }[] = [];
    for (let rank = 0; slots.length < ships.length; rank += 1) {
      const radius = r + rank * RANK_GAP;
      const count = Math.min(ships.length - slots.length, Math.max(1, Math.floor((span * radius) / SPACING) + 1), rank === 0 ? perRank : Infinity);
      for (let i = 0; i < count; i += 1) {
        const f = count === 1 ? 0 : i / (count - 1) - 0.5 + (rank % 2 ? 0.5 / count : 0);
        slots.push({ a: face + f * span, rank });
      }
    }
    // Nearest pairs first: a ship takes the free station closest to it, so the ranks do not have to cross each other
    // to reach their places (sorting by bearing alone sent neighbours across each other's bows between the ranks).
    const pairs: { d: number; i: number; k: number }[] = [];
    ships.forEach((s, i) => slots.forEach((slot, k) => {
      const radius = r + slot.rank * RANK_GAP;
      pairs.push({ d: hyp(plan.cx + Math.cos(slot.a) * radius - s.x, plan.cz + Math.sin(slot.a) * radius - s.z), i, k });
    }));
    pairs.sort((p, q) => p.d - q.d || p.i - q.i || p.k - q.k);
    const shipDone = new Set<number>();
    const slotDone = new Set<number>();
    for (const p of pairs) {
      if (shipDone.has(p.i) || slotDone.has(p.k)) continue;
      shipDone.add(p.i);
      slotDone.add(p.k);
      plan.layout.set(ships[p.i]!.id, slots[p.k]!);
    }
  }

  /**
   * A ring with enemies inside closes on them: its centre follows theirs and its radius shrinks to just outside them,
   * laid out again when it has shrunk enough that the stations would crowd.
   */
  private closeRing(plan: Plan, ships: Ship[]) {
    const b = this.b;
    const reach = plan.r + 250;
    // The enemies within the ring's reach are what it closes on: its centre follows theirs, so the wings come round them.
    // A sprung ambush closes only on what came into it, and does not follow the rest of a column back the way it came.
    const grip = plan.kind === 'ambush' ? plan.r : reach;
    let x = 0;
    let z = 0;
    let n = 0;
    let near = false;
    b.near(plan.cx, plan.cz, reach, (o) => {
      if (o.team === plan.team || !b.isActive(o) || o.moraleState === 'routing') return;
      near = true;
      if ((o.x - plan.cx) ** 2 + (o.z - plan.cz) ** 2 > grip * grip) return;
      x += o.x;
      z += o.z;
      n += 1;
    });
    const dt = PLAN_TICK;
    if (near) plan.contact = b.time;
    if (n) {
      x /= n;
      z /= n;
      let extent = 0;
      b.near(x, z, grip, (o) => {
        if (o.team !== plan.team && b.isActive(o) && o.moraleState !== 'routing') extent = Math.max(extent, hyp(o.x - x, o.z - z));
      });
      const dx = x - plan.cx;
      const dz = z - plan.cz;
      const d = hyp(dx, dz);
      const step = Math.min(d, FRAME_SPEED * dt);
      if (d > 1) {
        plan.cx += (dx / d) * step;
        plan.cz += (dz / d) * step;
      }
      // A sprung ambush keeps its bearings round the zone, so it closes no further than its stations can crowd.
      const inner = Math.max(clamp(Math.min(extent, 350) + 170, 220, 520), plan.kind === 'ambush' ? plan.span * 0.7 : 0);
      if (plan.r > inner) plan.r = Math.max(inner, plan.r - CLOSE_RATE * dt);
    } else if (!near && b.time - plan.contact > IDLE_RELEASE) {
      this.release(plan, ships);
      return;
    }
    if (plan.kind === 'crane' || plan.kind === 'encircle') this.layRing(plan, ships);
    else if (plan.layoutR && (plan.r / plan.layoutR < 0.85)) {
      // A pincer's wings or a sprung ambush keep their bearings; their outer ranks come in when the ring has shrunk.
      plan.layoutR = plan.r;
      for (const k of [0, 1] as const) {
        const wing = plan.kind === 'pincer' ? ships.filter((s) => plan.wing.get(s.id) === k) : k ? [] : ships;
        if (!wing.length) continue;
        const bearings = wing.map((s) => plan.layout.get(s.id)?.a ?? 0);
        const mid = Math.atan2(bearings.reduce((v, a) => v + Math.sin(a), 0), bearings.reduce((v, a) => v + Math.cos(a), 0));
        const spread = Math.max(0.5, ...bearings.map((a) => Math.abs(wrapAngle(a - mid)) * 2));
        if (plan.kind === 'pincer') this.arc(plan, wing, mid, Math.min(spread, 1.9), plan.r);
      }
    } else if (!plan.layoutR) plan.layoutR = plan.r;
  }

  /** Where a ship's station in a ring is now. */
  private ringSlot(plan: Plan, s: Ship): Slot | null {
    const l = plan.layout.get(s.id);
    if (!l) return null;
    const radius = plan.r + l.rank * RANK_GAP;
    const x = plan.cx + Math.cos(l.a) * radius;
    const z = plan.cz + Math.sin(l.a) * radius;
    const spot = this.b.land(x, z) < -3 ? { x, z } : this.wetSpot(x, z);
    return { x: spot.x, z: spot.z, face: l.a + Math.PI / 2 };
  }

  // ---- the breach

  private breach(plan: Plan, ships: Ship[]) {
    const b = this.b;
    if (plan.phase === 'forming') this.setPhase(plan, 'striking', ships[0]!);
    const lead = this.columnLead(plan);
    if (!lead) return;
    const legs = this.breachLegs(plan);
    const goal = legs[Math.min(plan.leg, legs.length - 1)]!;
    if (hyp(goal.x - lead.x, goal.z - lead.z) < 90) {
      plan.leg += 1;
      if (plan.leg >= legs.length) {
        this.release(plan, ships);
        return;
      }
    }
    for (const s of ships) {
      // Both broadsides at point blank as the column passes through.
      if (b.time - (this.volleyAt.get(s.id) ?? -Infinity) > VOLLEY_GAP && this.flanked(s, BREACH_VOLLEY)) {
        this.volleyAt.set(s.id, b.time);
        b.volley([s.id], 3);
      }
      // Enemies the column passes between and their squadron's leader, or their admiral, are cut off from them.
      b.near(s.x, s.z, CUT_REACH, (o) => {
        if (o.team === s.team || !b.isActive(o)) return;
        const sq = b.squadron(o.squadronId);
        const leader = sq ? b.get(sq.leaderId) : undefined;
        if (!this.between(s, o, leader) && !this.between(s, o, this.admiral(o))) return;
        const was = this.cut.has(o.id);
        this.cut.set(o.id, { until: b.time + CUT_TIME, by: s.id });
        if (!was) b.events.push({ type: 'cutoff', ship: o.id, by: s.id });
      });
    }
  }

  /** Whether ship `s` lies across the line from `o` to its commander `c`. */
  private between(s: Ship, o: Ship, c: Ship | undefined) {
    if (!c || c === o || !this.b.isActive(c)) return false;
    const lx = c.x - o.x;
    const lz = c.z - o.z;
    const len2 = lx * lx + lz * lz;
    if (len2 < 100 * 100 || len2 > CUT_SPAN * CUT_SPAN) return false;
    const t = ((s.x - o.x) * lx + (s.z - o.z) * lz) / len2;
    if (t < 0.05 || t > 0.95) return false;
    const px = o.x + lx * t - s.x;
    const pz = o.z + lz * t - s.z;
    return px * px + pz * pz <= CUT_NEAR * CUT_NEAR;
  }

  /** The admiral of a ship's navy: the leader of the navy's first squadron, while that ship is a flagship. */
  private admiral(o: Ship) {
    const b = this.b;
    for (const sq of b.squadrons) {
      if (sq.faction !== o.spec.faction || sq.team !== o.team) continue;
      const leader = b.get(sq.leaderId);
      return leader?.flagship ? leader : undefined;
    }
    return undefined;
  }

  private breachLegs(plan: Plan) {
    const len = hyp(plan.x1 - plan.x0, plan.z1 - plan.z0) || 1;
    const ux = (plan.x1 - plan.x0) / len;
    const uz = (plan.z1 - plan.z0) / len;
    // Ends drawn on the shore are taken at the nearest water a column can pass.
    return [this.wetSpot(plan.x0, plan.z0), this.wetSpot(plan.x1, plan.z1), this.wetSpot(plan.x1 + ux * 350, plan.z1 + uz * 350)];
  }

  private columnLead(plan: Plan) {
    const b = this.b;
    for (const id of plan.column) {
      const s = b.get(id);
      if (b.isActive(s) && s.order.type === 'maneuver' && s.order.plan === plan.id) return s;
    }
    return undefined;
  }

  /** Whether both broadsides of a ship have an enemy within range. */
  private flanked(s: Ship, range: number) {
    const b = this.b;
    let port = false;
    let starboard = false;
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    b.near(s.x, s.z, range, (o) => {
      if (o.team === s.team || !b.isActive(o)) return;
      const across = (o.z - s.z) * c - (o.x - s.x) * n;
      const along = (o.x - s.x) * c + (o.z - s.z) * n;
      if (Math.abs(along) > Math.abs(across) * 1.2) return;
      if (across < 0) port = true;
      else starboard = true;
    });
    return port && starboard;
  }

  // ---- the lure

  private lure(plan: Plan, ships: Ship[]) {
    const b = this.b;
    const lead = this.columnLead(plan);
    if (!lead) return;
    if (plan.phase === 'forming') {
      // Show the bait: close on the drawn point until the enemy is near, then a broadside and away.
      const foe = this.nearestFoe(lead, LURE_SHOW);
      if (foe || hyp(plan.x0 - lead.x, plan.z0 - lead.z) < 90 || b.time - plan.since > 240) {
        if (foe) for (const s of ships) b.volley([s.id], b.sideToward(s, foe.x, foe.z));
        this.setPhase(plan, 'striking', lead);
      }
      return;
    }
    if (plan.phase === 'striking') {
      if (hyp(plan.x1 - lead.x, plan.z1 - lead.z) < 130) {
        // Home: the drum, and every waiting plan of the owner turns on the pursuers at once.
        this.signal(plan.owner, [lead.id], 'advance');
        this.release(plan, ships);
        return;
      }
      if (this.nearestFoe(lead, 1200)) plan.contact = b.time;
      else if (b.time - plan.contact > 90) this.release(plan, ships);
    }
  }

  // ---- driving the ships

  /** Steers a ship in a plan. False when the plan no longer has it and the battle's own thinking should. */
  drive(s: Ship): boolean {
    const b = this.b;
    const plan = this.planOf(s);
    if (!plan || plan.phase === 'done') {
      if (s.order.type === 'maneuver') s.order = { type: 'auto' };
      return false;
    }
    const phase = this.phaseFor(plan, s);
    if (!phase) {
      // Not yet heard: keeps its way.
      s.rudder *= 0.5;
      b.act(s, 'moving');
      return true;
    }
    switch (plan.kind) {
      case 'ambush':
        if (phase === 'striking') return this.inRing(plan, s);
        return this.toStation(plan, s, phase === 'waiting' ? 0 : -1);
      case 'pincer':
        if (phase === 'striking') return this.inRing(plan, s);
        return this.toStation(plan, s, this.range(s));
      case 'crane':
      case 'encircle':
        return this.inRing(plan, s);
      case 'blockade':
        return this.toStation(plan, s, this.range(s));
      case 'breach':
        return this.inColumn(plan, s, this.breachLegs(plan)[Math.min(plan.leg, 2)]!, 1);
      case 'lure': {
        if (phase === 'forming') return this.inColumn(plan, s, { x: plan.x0, z: plan.z0 }, 0.8);
        const lead = this.columnLead(plan);
        let pace = 1;
        if (lead === s) {
          // Just ahead of the pursuers: hurry when they are close, wait for them when they fall behind.
          const foe = this.nearestFoe(s, 1200);
          const d = foe ? hyp(foe.x - s.x, foe.z - s.z) : Infinity;
          pace = d < LURE_NEAR ? 1 : d < LURE_FAR ? 0.7 : d < 1200 ? 0.35 : 0.5;
        }
        return this.inColumn(plan, s, { x: plan.x1, z: plan.z1 }, pace);
      }
      case 'pursue':
        return this.hunt(s);
    }
  }

  /** Keeps a ship on its station in a ring, turning its nearer broadside onto the best enemy in range. */
  private inRing(plan: Plan, s: Ship) {
    const slot = this.ringSlot(plan, s) ?? (plan.stations.get(s.id) ?? null);
    if (!slot) {
      s.order = { type: 'auto' };
      return false;
    }
    this.station(s, slot.x, slot.z, slot.face, this.range(s));
    return true;
  }

  /** Station keeping on a plan's fixed station. `engage` is the range to fight from it, 0 to hold fire, -1 to sail there. */
  private toStation(plan: Plan, s: Ship, engage: number) {
    const st = plan.stations.get(s.id);
    if (!st) {
      s.order = { type: 'auto' };
      return false;
    }
    this.station(s, st.x, st.z, st.face, Math.max(0, engage));
    return true;
  }

  /**
   * Station keeping: a ship sails to its station, stops there with its oars, and turns on the spot to face the way the
   * station faces, or, given a range, to bring its nearer broadside onto the best enemy within it. Arriving within
   * ARRIVE metres and leaving only beyond LEAVE keeps it from circling its station.
   */
  station(s: Ship, x: number, z: number, face: number, engage: number) {
    const b = this.b;
    const dx = x - s.x;
    const dz = z - s.z;
    const d = hyp(dx, dz);
    let on = this.onStation.has(s.id);
    if (on && d > LEAVE) on = false;
    else if (!on && d < ARRIVE) on = true;
    if (on) this.onStation.add(s.id);
    else this.onStation.delete(s.id);
    // A gun ship does not wait on its station for boarders: it backs away from one closing on it, and comes back after.
    const boarder = engage > 0 ? this.closingBoarder(s) : undefined;
    if (boarder) {
      const away = Math.atan2(s.z - boarder.z, s.x - boarder.x);
      const side = wrapAngle(away - s.heading) > 0 ? 1 : -1;
      const h = away - side * 0.5;
      b.steerTo(s, s.x + Math.cos(h) * 150, s.z + Math.sin(h) * 150, 60, 1);
      b.avoid(s, true);
      b.act(s, 'evading');
      return;
    }
    if (!on) {
      b.steerTo(s, x, z, 70, d > 200 ? 1 : 0.6);
      b.avoid(s, true);
      b.act(s, 'moving');
      return;
    }
    let want = face;
    // Either way round is a broadside toward the centre: the nearer one is turned to.
    if (Math.abs(wrapAngle(face + Math.PI - s.heading)) < Math.abs(wrapAngle(face - s.heading))) want = face + Math.PI;
    if (engage > 0) {
      const target = this.stationTarget(s, engage);
      if (target) {
        const bearing = Math.atan2(target.z - s.z, target.x - s.x);
        const p = bearing + Math.PI / 2;
        const q = bearing - Math.PI / 2;
        want = Math.abs(wrapAngle(p - s.heading)) < Math.abs(wrapAngle(q - s.heading)) ? p : q;
        s.targetId = target.id;
      }
    }
    const diff = wrapAngle(want - s.heading);
    s.rudder = clamp(diff * 2.8, -1, 1);
    // Creep back along the keel; turning on the spot is the oars' work.
    const along = dx * Math.cos(s.heading) + dz * Math.sin(s.heading);
    s.throttle = d > 12 ? clamp(along / 100, -0.15, 0.25) : 0;
    b.act(s, engage > 0 && s.targetId ? 'engaging' : 'anchored');
  }

  /** A boarding crew closing on a gun ship within EVADE metres. */
  private closingBoarder(s: Ship) {
    const b = this.b;
    if (s.spec.faction === 'japan' || !s.guns.length) return undefined;
    let best: Ship | undefined;
    let bestD = EVADE;
    b.near(s.x, s.z, EVADE, (o) => {
      if (o.team === s.team || !b.isActive(o) || o.spec.faction !== 'japan' || o.moraleState === 'routing' || o.grappledWith) return;
      const dx = s.x - o.x;
      const dz = s.z - o.z;
      const d = hyp(dx, dz);
      // Coming at us: its way carries it toward this ship.
      if (d < bestD && (Math.cos(o.heading) * dx + Math.sin(o.heading) * dz) / Math.max(1, d) > 0.5 && o.speed > 1) {
        bestD = d;
        best = o;
      }
    });
    return best;
  }

  /** Whether a ship is holding a station in a plan: the current and the wind move it less, as at a kedge. */
  holding(s: Ship) {
    // Every ship asks every step: its order is cheaper to read than the set, and rules out those under their own orders.
    return s.order.type !== 'auto' && this.onStation.has(s.id);
  }

  /** The enemy a ship on station fires at: within range, on a clear line, preferring one already hit from another quarter. */
  private stationTarget(s: Ship, range: number) {
    const b = this.b;
    let best: Ship | undefined;
    let bestScore = Infinity;
    const tactics = b.tactics;
    b.near(s.x, s.z, range, (o) => {
      if (o.team === s.team || !b.isActive(o)) return;
      const d = hyp(o.x - s.x, o.z - s.z);
      if (!b.canSee(o, d, s.team)) return;
      let score = d - (o.id === s.targetId ? 60 : 0);
      if (tactics?.crossing(o, s)) score -= 150;
      if (score < bestScore && this.clear(s, o)) {
        bestScore = score;
        best = o;
      }
    });
    return best;
  }

  /** A column behind its leader to a point: the leader steers for it, each other ship for the wake of the one ahead. */
  private inColumn(plan: Plan, s: Ship, goal: { x: number; z: number }, pace: number) {
    const b = this.b;
    let ahead: Ship | undefined;
    for (const id of plan.column) {
      if (id === s.id) break;
      const o = b.get(id);
      if (b.isActive(o) && o.order.type === 'maneuver' && o.order.plan === plan.id) ahead = o;
    }
    if (!ahead) {
      b.steerTo(s, goal.x, goal.z, 40, pace);
      b.avoid(s, true);
      b.act(s, plan.kind === 'breach' ? 'charging' : 'moving');
      return true;
    }
    const tx = ahead.x - Math.cos(ahead.heading) * 60;
    const tz = ahead.z - Math.sin(ahead.heading) * 60;
    const d = hyp(tx - s.x, tz - s.z);
    b.steerTo(s, tx, tz, 30, 1);
    s.throttle = Math.min(1, s.throttle * (d > 60 ? 1.2 : 0.9));
    b.avoid(s, true);
    b.act(s, plan.kind === 'breach' ? 'charging' : 'moving');
    return true;
  }

  /** Runs down the nearest routing crew, else fights the nearest enemy. */
  private hunt(s: Ship) {
    const b = this.b;
    let best: Ship | undefined;
    let bestD = 1800;
    for (const o of b.activeOf(otherTeam(s.team))) {
      if (o.moraleState !== 'routing') continue;
      const d = hyp(o.x - s.x, o.z - s.z);
      if (d < bestD && b.canSee(o, d, s.team)) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return false;
    s.targetId = best.id;
    const bearing = Math.atan2(best.z - s.z, best.x - s.x);
    if (bestD > 260) {
      const lead = Math.min(20, bestD / 6);
      b.steerTo(s, best.x + Math.cos(best.heading) * best.speed * lead, best.z + Math.sin(best.heading) * best.speed * lead, 30, 1);
      b.avoid(s, true);
      b.act(s, 'charging');
    } else b.broadsideDuel(s, best, bestD, bearing, 60, 180);
    return true;
  }

  // ---- what the rest of the battle asks

  /** Whether the line from a ship to an enemy is clear of its own fleet's hulls. Cached for a fifth of a second. */
  clear(s: Ship, t: Ship) {
    const b = this.b;
    const tick = Math.floor(b.time * 5);
    if (tick !== this.laneAt) {
      this.lanes.clear();
      this.laneAt = tick;
    }
    const key = s.id * 65536 + t.id;
    const known = this.lanes.get(key);
    if (known !== undefined) return known;
    const mx = (s.x + t.x) / 2;
    const mz = (s.z + t.z) / 2;
    const half = hyp(t.x - s.x, t.z - s.z) / 2 + 25;
    let open = true;
    b.near(mx, mz, half, (o) => {
      if (!open || o === s || o === t || o.team !== s.team || !o.alive || o.sinking > 0.5) return;
      if (crosses(s.x, s.z, t.x, t.z, o)) open = false;
    });
    this.lanes.set(key, open);
    return open;
  }

  /** Enemies a ship's friends are already shooting at, as of this step, for spreading the fire. */
  crowd(t: Ship) {
    const b = this.b;
    if (this.targetsAt !== b.time) {
      this.targetsAt = b.time;
      this.targeted.clear();
      for (const s of b.ships) if (s.targetId && b.isActive(s)) this.targeted.set(s.targetId, (this.targeted.get(s.targetId) ?? 0) + 1);
    }
    return this.targeted.get(t.id) ?? 0;
  }

  /** Whether a waiting ambusher lies hidden from an enemy this far off: under the land by day, dark by night. */
  hidden(target: Ship, d: number) {
    const plan = this.planOf(target);
    if (!plan || plan.kind !== 'ambush' || plan.phase === 'striking') return false;
    if (this.b.night) return !target.lights && d > 260;
    return d > 450 && this.underLand(target);
  }

  private readonly shelter = new Map<number, { at: number; under: boolean }>();
  /** Land close by: a ship lying under a headland is hard to make out against it. */
  private underLand(s: Ship) {
    const b = this.b;
    const known = this.shelter.get(s.id);
    if (known && b.time - known.at < 5) return known.under;
    let under = false;
    for (let k = 0; k < 8 && !under; k += 1) {
      const a = (k / 8) * TAU;
      for (const d of [120, 240]) if (b.land(s.x + Math.cos(a) * d, s.z + Math.sin(a) * d) > 0) under = true;
    }
    this.shelter.set(s.id, { at: b.time, under });
    return under;
  }

  /** A hit by a ship of a sprung ambush in its first seconds: the crew it hits was not at its stations. */
  surprised(shooter: Ship | undefined) {
    if (!shooter) return false;
    const plan = this.planOf(shooter);
    if (!plan) return false;
    const until = this.surprise.get(plan.id);
    return until !== undefined && this.b.time < until;
  }

  /**
   * Where a routing crew steers: of sixteen headings, the one with the most open water within its sight, away from the
   * enemy and clear of jammed friends and of enemy hulls. Water it cannot see the end of looks like the open sea, so a
   * wide bay mouth draws a panicking fleet in as readily as the way home; inside, the water runs out.
   */
  routeOf(s: Ship): { x: number; z: number; trapped: boolean; haven: boolean } {
    const b = this.b;
    let run = this.runs.get(s.id);
    const haven = b.havens[s.team];
    const inside = !!haven && hyp(haven.x - s.x, haven.z - s.z) < HAVEN_IN;
    if (!run || b.time - run.at >= ROUT_LOOK) {
      const pick = this.chooseRun(s, run?.h ?? s.heading, !inside);
      if (!run) {
        run = { h: pick.h, at: b.time, open: pick.open, trapped: 0, haven: inside || pick.haven };
        this.runs.set(s.id, run);
      } else {
        const elapsed = b.time - run.at;
        run.trapped = pick.open < TRAPPED_OPEN && this.enemyWithin(s, TRAPPED_FOE) ? run.trapped + elapsed : 0;
        run.h = pick.h;
        run.at = b.time;
        run.open = pick.open;
        run.haven = inside || pick.haven;
      }
    }
    // Inside the haven the crew makes for its innermost water and lies there; it gives up only if the enemy follows it in.
    if (inside) return { x: haven.x, z: haven.z, trapped: run.trapped >= TRAPPED, haven: true };
    const reach = Math.max(120, Math.min(400, run.open));
    return { x: s.x + Math.cos(run.h) * reach, z: s.z + Math.sin(run.h) * reach, trapped: run.trapped >= TRAPPED, haven: false };
  }

  forgetRun(id: number) {
    this.runs.delete(id);
  }

  /** Whether a routing crew is lying in its side's haven or, its way home barred, running for it. */
  havenBound(s: Ship) {
    return this.runs.get(s.id)?.haven ?? false;
  }

  /**
   * `useHaven`: whether the side's haven may draw the crew. It does when the haven is near enough to run for and the way
   * home is barred: cut off from its leader by a column breaking through, enemies still fighting between it and where
   * its squadron came from, or no open water that way. A crew with the sea open behind it runs home.
   */
  private chooseRun(s: Ship, current: number, useHaven: boolean) {
    const b = this.b;
    const sight = b.night ? ROUT_SIGHT_NIGHT : ROUT_SIGHT_DAY;
    let tx = 0;
    let tz = 0;
    let tw = 0;
    const foes: Ship[] = [];
    const friends: Ship[] = [];
    b.near(s.x, s.z, 1200, (o) => {
      if (o === s || !b.isActive(o)) return;
      const d = hyp(o.x - s.x, o.z - s.z);
      if (o.team === s.team) {
        if (d < 350) friends.push(o);
        return;
      }
      if (o.moraleState === 'routing') return;
      const w = 1 / Math.max(150, d);
      tx += (o.x - s.x) * w;
      tz += (o.z - s.z) * w;
      tw += w;
      if (d < 650) foes.push(o);
    });
    const away = tw ? Math.atan2(-tz, -tx) : current;
    const open: number[] = [];
    for (let k = 0; k < 16; k += 1) {
      const c = Math.cos((k / 16) * TAU);
      const n = Math.sin((k / 16) * TAU);
      let w = 0;
      for (let d = 50; d <= sight; d += 50) {
        if (!b.isWater(s.x + c * d, s.z + n * d)) break;
        w = d;
      }
      open.push(w);
    }
    const haven = useHaven ? this.havenPull(s, open) : null;
    let best = 0;
    let bestScore = -Infinity;
    for (let k = 0; k < 16; k += 1) {
      const h = (k / 16) * TAU;
      const c = Math.cos(h);
      const n = Math.sin(h);
      let score = ((open[k]! >= sight ? sight * 1.5 : open[k]!) / sight) * (1 + 0.7 * Math.cos(h - away));
      let jam = 0;
      for (const o of friends) {
        const along = (o.x - s.x) * c + (o.z - s.z) * n;
        if (along > 0 && Math.abs((o.z - s.z) * c - (o.x - s.x) * n) < 50) jam += 1;
      }
      let foe = 0;
      for (const o of foes) {
        const along = (o.x - s.x) * c + (o.z - s.z) * n;
        if (along > 0 && Math.abs((o.z - s.z) * c - (o.x - s.x) * n) < 160) foe += 1;
      }
      score -= 0.12 * Math.min(6, jam) + 0.3 * Math.min(4, foe);
      if (haven !== null) score += HAVEN_PULL * Math.cos(h - haven);
      if (Math.abs(wrapAngle(h - current)) < 0.2) score *= 1.1;
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    return { h: (best / 16) * TAU, open: open[best]!, haven: haven !== null };
  }

  /** The bearing of the side's haven for a crew whose way home is barred (see chooseRun), else null. */
  private havenPull(s: Ship, open: number[]): number | null {
    const b = this.b;
    const haven = b.havens[s.team];
    if (!haven || hyp(haven.x - s.x, haven.z - s.z) > HAVEN_REACH) return null;
    let barred = this.cut.has(s.id);
    const home = this.homes?.get(s.squadronId);
    if (!barred && home) {
      const toward = Math.atan2(home.z - s.z, home.x - s.x);
      const k = Math.round((((toward % TAU) + TAU) % TAU) / (TAU / 16)) % 16;
      barred = open[k]! < BARRED_OPEN;
      let n = 0;
      if (!barred) b.near(s.x, s.z, BARRED_RANGE, (o) => {
        if (o.team === s.team || !b.isActive(o) || o.moraleState === 'routing') return;
        if (Math.abs(wrapAngle(Math.atan2(o.z - s.z, o.x - s.x) - toward)) < BARRED_CONE) n += 1;
      });
      barred ||= n >= BARRED_SHIPS;
    }
    return barred ? Math.atan2(haven.z - s.z, haven.x - s.x) : null;
  }

  /**
   * Whether a computer boarder keeps after the ship it chases although another is nearer: a rash or bold commander's
   * crews run down a ship that turns away from them; a cautious one's do not leave their anchorage for it.
   */
  chases(s: Ship, target: Ship) {
    const b = this.b;
    if (!b.isActive(target)) return false;
    const d = hyp(target.x - s.x, target.z - s.z);
    if (d > CHASE) return false;
    const away = Math.atan2(target.z - s.z, target.x - s.x);
    if (!(target.speed > 1 && Math.abs(wrapAngle(target.heading - away)) < 1.05)) return false;
    const temper = this.temper(b.squadron(s.squadronId));
    if (temper === 'cautious' || temper === 'steady') return false;
    return !this.enemyWithin(s, 120, target);
  }

  /** Whether a cautious commander's ship has wandered too far from where its squadron lay to follow further. */
  tethered(s: Ship, target: Ship) {
    const temper = this.temper(this.b.squadron(s.squadronId));
    if (temper !== 'cautious') return false;
    const home = this.homes?.get(s.squadronId);
    return !!home && hyp(target.x - home.x, target.z - home.z) > WANDER;
  }

  // ---- small helpers

  range(s: Ship) {
    const b = this.b;
    let r = 0;
    for (const battery of s.spec.batteries) r = Math.max(r, b.gunSpec(s.spec.kind, battery.gun).range);
    return r * b.rangeFactor(s);
  }

  private enemyWithin(s: Ship, r: number, except?: Ship) {
    const b = this.b;
    let hit = false;
    b.near(s.x, s.z, r, (o) => {
      if (!hit && o !== except && o.team !== s.team && b.isActive(o)) hit = true;
    });
    return hit;
  }

  private nearestFoe(s: Ship, r: number) {
    const b = this.b;
    let best: Ship | undefined;
    let bestD = r;
    b.near(s.x, s.z, r, (o) => {
      if (o.team === s.team || !b.isActive(o) || o.moraleState === 'routing') return;
      const d = hyp(o.x - s.x, o.z - s.z);
      if (d < bestD && b.canSee(o, d, s.team)) {
        bestD = d;
        best = o;
      }
    });
    return best;
  }

  private enemyNear(x: number, z: number, r: number, team: Team) {
    const b = this.b;
    let hit = false;
    b.near(x, z, r, (o) => {
      if (!hit && o.team !== team && b.isActive(o) && o.moraleState !== 'routing') hit = true;
    });
    return hit;
  }

  private enemyCentroid(at: { x: number; z: number; team?: Team }, r: number, team = at.team) {
    const b = this.b;
    let x = 0;
    let z = 0;
    let n = 0;
    b.near(at.x, at.z, r, (o) => {
      if (o.team === team || !b.isActive(o)) return;
      x += o.x;
      z += o.z;
      n += 1;
    });
    return n ? { x: x / n, z: z / n } : null;
  }

  private routersNear(ships: Ship[], r: number) {
    const b = this.b;
    for (const s of ships) {
      let found = false;
      b.near(s.x, s.z, r, (o) => {
        if (!found && o.team !== s.team && b.isActive(o) && o.moraleState === 'routing') found = true;
      });
      if (found) return true;
    }
    return false;
  }

  /** Whether a ship of this size floats here with room round it. */
  private wetFor(x: number, z: number, r: number) {
    const b = this.b;
    return b.land(x, z) < -3 && b.land(x + r, z) < -2 && b.land(x - r, z) < -2 && b.land(x, z + r) < -2 && b.land(x, z - r) < -2;
  }

  /** The nearest water to a point, searched in widening rings. */
  wetSpot(x: number, z: number) {
    if (this.wetFor(x, z, 18)) return { x, z };
    for (let ring = 1; ring <= 30; ring += 1) {
      for (let k = 0; k < 12; k += 1) {
        const a = (k / 12) * TAU + ring * 0.4;
        const px = x + Math.cos(a) * ring * 40;
        const pz = z + Math.sin(a) * ring * 40;
        if (this.wetFor(px, pz, 18)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  /** A station on a circle near a bearing, on water and clear of the stations already taken. */
  private wetNear(cx: number, cz: number, a: number, r: number, taken: Slot[], turn = Math.PI, mouth: number | null = null): Slot | null {
    for (let k = 0; k < 40; k += 1) {
      const da = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (SPACING / r) * 0.5;
      if (Math.abs(da) > turn) break;
      if (mouth !== null && (Math.abs(wrapAngle(a + da - mouth)) < ENTRY_GAP || Math.abs(wrapAngle(a + da - mouth - Math.PI)) < ENTRY_GAP)) continue;
      for (const dr of [0, -60, 60, -120, 120]) {
        const rr = Math.max(80, r + dr);
        const x = cx + Math.cos(a + da) * rr;
        const z = cz + Math.sin(a + da) * rr;
        if (!this.wetFor(x, z, 18)) continue;
        if (taken.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < SPACING * SPACING * 0.8)) continue;
        return { x, z, face: a + da + Math.PI / 2 };
      }
    }
    return null;
  }

  /** A ship left the fight. */
  forget(id: number) {
    this.onStation.delete(id);
    this.cut.delete(id);
    this.runs.delete(id);
    this.volleyAt.delete(id);
    this.shelter.delete(id);
  }
}

function centroid(ships: readonly { x: number; z: number }[]) {
  let x = 0;
  let z = 0;
  for (const s of ships) {
    x += s.x;
    z += s.z;
  }
  return { x: x / Math.max(1, ships.length), z: z / Math.max(1, ships.length) };
}

