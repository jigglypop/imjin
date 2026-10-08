import { waveField } from '../ocean/waves';
import { GUN_SHOTS, GUN_SPECS, NO_MODS, SHIP_SPECS } from './catalog';
import { ShipGrid } from './grid';
import type { CurrentField } from './current';
import {
  TEAMS,
  teamOf,
  type BattleEvent,
  type Faction,
  type GunState,
  type LandSampler,
  type Order,
  type Projectile,
  type Ship,
  type ShipKind,
  type Side,
  type Squadron,
  type Team,
} from './types';

export const SIM_DT = 1 / 30;
const GRAVITY = 9.81;
const SINK_DURATION = 38;
const TAU = Math.PI * 2;
const THINK_INTERVAL = 0.3;
const DRAFT = -1.4;
// Ships the player does not command start in the orders the scenario gave them: a formation slot, or holding still
// at anchorage. They leave that order for free combat when an enemy they can see comes close, or when the battle
// has gone on long enough that waiting no longer makes sense.
const WAKE_SLOT = 320;
const WAKE_HOLD = 700;
const WAKE_AFTER = 150;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wrapAngle(a: number) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

export type ShipActivity = 'idle' | 'moving' | 'engaging' | 'boarding' | 'sinking' | 'struck' | 'charging' | 'evading' | 'anchored' | 'fleeing' | 'aground';

type AimedGun = GunState & { target?: number };

export class Battle {
  ships: Ship[] = [];
  squadrons: Squadron[] = [];
  projectiles: Projectile[] = [];
  events: BattleEvent[] = [];
  time = 0;
  windAngle = 0.6;
  winner: Team | null = null;
  escaped = { joseon: 0, japan: 0 };
  initial = { joseon: 0, japan: 0 };
  /** A computer-led team turns and flees once its share of ships still fighting drops below this. 0 fights to the end. */
  retreatBelow: Record<Team, number> = { joseon: 0, japan: 0.3 };
  /** The faction the player commands. Its ships keep their orders until the player changes them, and its team never flees on its own. */
  player: Faction = 'joseon';
  /** Balance runs: the computer also leads the player's ships. */
  autopilot = false;
  night = false;
  current = { x: 0, z: 0 };
  land: LandSampler = () => -50;
  center = { x: 0, z: 0 };
  arenaRadius = 6000;
  private byId = new Map<number, Ship>();
  private nextId = 1;
  private nextProjectile = 1;
  private readonly rand: () => number;
  private readonly activity = new Map<number, ShipActivity>();
  private chargeTimer = new Map<number, number>();
  private readonly grid = new ShipGrid(120);
  private active: Record<Team, Ship[]> = { joseon: [], japan: [] };
  private retreating: Record<Team, boolean> = { joseon: false, japan: false };

  constructor(seed = 1592) {
    this.rand = mulberry32(seed);
  }

  random() {
    return this.rand();
  }

  addSquadron(team: Team, name: string, commander: string, portrait: string, card: string) {
    const sq: Squadron = { id: this.squadrons.length + 1, team, faction: team, name, commander, portrait, card, shipIds: [], leaderId: 0 };
    this.squadrons.push(sq);
    return sq;
  }

  addShip(kind: ShipKind, x: number, z: number, heading: number, name: string, squadron: Squadron | null, flagship = false, variant = 0): Ship {
    const spec = SHIP_SPECS[kind];
    const guns: GunState[] = [];
    spec.batteries.forEach((b, bi) => {
      for (let i = 0; i < b.count; i += 1) {
        const stages = GUN_SPECS[b.gun].stages;
        const stage = Math.floor(this.rand() * 4);
        guns.push({ battery: bi, index: i, side: b.side, stage, t: this.rand() * stages[stage]!, fireDelay: 0, ammo: GUN_SHOTS[b.gun] });
      }
    });
    const ship: Ship = {
      id: this.nextId++,
      spec,
      team: spec.team,
      name,
      squadronId: squadron?.id ?? 0,
      flagship,
      variant,
      x,
      z,
      heading,
      speed: spec.maxSpeed * 0.3,
      turn: 0,
      throttle: 0.3,
      rudder: 0,
      hull: spec.hull,
      crew: spec.crew,
      fire: 0,
      burn: 0,
      morale: 1,
      order: { type: 'auto' },
      targetId: 0,
      guns,
      musketReload: this.rand() * 3,
      grappledWith: 0,
      grappleTime: 0,
      alive: true,
      sinking: 0,
      sinkRoll: (this.rand() < 0.5 ? -1 : 1) * (0.35 + this.rand() * 0.5),
      sinkPitch: (this.rand() - 0.5) * 0.5,
      struck: false,
      lastHit: -100,
      kills: 0,
      thinkTimer: this.rand() * THINK_INTERVAL,
      aground: 0,
      fireMode: 'free',
      ammo: 'auto',
      speedCap: 1,
      stance: 'auto',
      lights: true,
      volleySide: -1,
      volleyTimer: 0,
      revealed: 0,
      repel: false,
      mods: { ...NO_MODS },
      supply: 1,
      campaignId: '',
    };
    this.ships.push(ship);
    this.byId.set(ship.id, ship);
    this.initial[ship.team] += 1;
    if (squadron) {
      if (!squadron.shipIds.length) squadron.faction = spec.faction;
      squadron.shipIds.push(ship.id);
      if (!squadron.leaderId || flagship) squadron.leaderId = ship.id;
    }
    return ship;
  }

  get(id: number) {
    return this.byId.get(id);
  }

  squadron(id: number) {
    return this.squadrons[id - 1];
  }

  isActive(s: Ship | undefined): s is Ship {
    return !!s && s.alive && s.sinking === 0 && !s.struck;
  }

  activityOf(id: number): ShipActivity {
    return this.activity.get(id) ?? 'idle';
  }

  teamCount(team: Team) {
    let n = 0;
    for (const s of this.ships) if (s.team === team && this.isActive(s)) n += 1;
    return n;
  }

  strength(team: Team) {
    let v = 0;
    for (const s of this.ships) {
      if (s.team !== team || !this.isActive(s)) continue;
      v += s.spec.hull * ((s.hull / s.spec.hull) * 0.6 + (s.crew / s.spec.crew) * 0.4);
    }
    return v;
  }

  setOrder(ids: number[], order: Order) {
    for (const id of ids) {
      const s = this.byId.get(id);
      if (this.isActive(s)) s.order = order;
    }
  }

  removeShips(pred: (s: Ship) => boolean) {
    const removed = new Set<number>();
    this.ships = this.ships.filter((s) => {
      if (!pred(s)) return true;
      removed.add(s.id);
      this.byId.delete(s.id);
      this.initial[s.team] -= 1;
      return false;
    });
    const kept = this.squadrons.filter((sq) => {
      sq.shipIds = sq.shipIds.filter((id) => !removed.has(id));
      return sq.shipIds.length > 0;
    });
    kept.forEach((sq, i) => {
      sq.id = i + 1;
      for (const id of sq.shipIds) this.byId.get(id)!.squadronId = sq.id;
      if (!sq.shipIds.includes(sq.leaderId)) sq.leaderId = sq.shipIds[0] ?? 0;
    });
    this.squadrons = kept;
  }

  applySupply(s: Ship, supply: number) {
    s.supply = supply;
    for (const g of s.guns) g.ammo = Math.max(0, Math.round(GUN_SHOTS[s.spec.batteries[g.battery]!.gun] * supply));
  }

  configure(ids: number[], patch: Partial<Pick<Ship, 'fireMode' | 'ammo' | 'speedCap' | 'stance' | 'lights' | 'repel'>>) {
    for (const id of ids) {
      const s = this.byId.get(id);
      if (this.isActive(s)) Object.assign(s, patch);
    }
  }

  volley(ids: number[], side: number) {
    let ships = 0;
    for (const id of ids) {
      const s = this.byId.get(id);
      if (!this.isActive(s)) continue;
      s.volleySide = side;
      s.volleyTimer = 2.4;
      ships += 1;
    }
    return ships;
  }

  cutGrapples(ids: number[]) {
    let cut = 0;
    for (const id of ids) {
      const s = this.byId.get(id);
      if (!this.isActive(s)) continue;
      if (s.grappledWith) {
        s.grappledWith = 0;
        cut += 1;
      }
      for (const o of this.ships) {
        if (o.grappledWith === s.id && this.rand() < 0.65) {
          o.grappledWith = 0;
          o.crew = Math.max(0, o.crew - 4);
          this.events.push({ type: 'repelled', a: o.id, b: s.id });
          cut += 1;
        }
      }
    }
    return cut;
  }

  canSee(target: Ship, d: number) {
    if (!this.night) return true;
    const range = target.lights ? 1900 : target.fire > 0.08 ? 1400 : target.revealed > 0 ? 900 : 260;
    return d <= range;
  }

  formation(ids: number[], kind: 'crane' | 'line' | 'column' | 'wedge', cx: number, cz: number) {
    const ships = ids.map((id) => this.byId.get(id)).filter((s): s is Ship => this.isActive(s));
    if (!ships.length) return;
    let fx = 0;
    let fz = 0;
    for (const s of ships) {
      fx += s.x;
      fz += s.z;
    }
    fx /= ships.length;
    fz /= ships.length;
    const toFleet = Math.atan2(fz - cz, fx - cx);
    const n = ships.length;
    if (kind === 'crane') {
      const radius = Math.max(320, n * 32);
      const span = Math.min(2.6, 0.6 + n * 0.06);
      const slots = Array.from({ length: n }, (_, i) => {
        const a = toFleet + (n === 1 ? 0 : (i / (n - 1) - 0.5) * span);
        return { a, x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius };
      });
      const sorted = [...ships].sort((p, q) => wrapAngle(Math.atan2(p.z - cz, p.x - cx) - toFleet) - wrapAngle(Math.atan2(q.z - cz, q.x - cx) - toFleet));
      sorted.forEach((s, i) => {
        const slot = slots[i]!;
        s.order = { type: 'slot', x: slot.x, z: slot.z, face: slot.a + Math.PI / 2 };
      });
    } else if (kind === 'line') {
      const along = toFleet + Math.PI / 2;
      const dist = Math.min(380, Math.hypot(fx - cx, fz - cz) * 0.8);
      const lx = cx + Math.cos(toFleet) * dist;
      const lz = cz + Math.sin(toFleet) * dist;
      const sorted = [...ships].sort((p, q) => (p.x - fx) * Math.cos(along) + (p.z - fz) * Math.sin(along) - ((q.x - fx) * Math.cos(along) + (q.z - fz) * Math.sin(along)));
      sorted.forEach((s, i) => {
        const off = (i - (n - 1) / 2) * 52;
        s.order = { type: 'slot', x: lx + Math.cos(along) * off, z: lz + Math.sin(along) * off, face: along };
      });
    } else {
      const heading = toFleet + Math.PI;
      const sorted = [...ships].sort((p, q) => (q.x - fx) * Math.cos(heading) + (q.z - fz) * Math.sin(heading) - ((p.x - fx) * Math.cos(heading) + (p.z - fz) * Math.sin(heading)));
      const leader = sorted.find((s) => s.flagship) ?? sorted[0]!;
      const rest = sorted.filter((s) => s !== leader);
      const stop = Math.hypot(fx - cx, fz - cz) > 200 ? 0.7 : 0;
      leader.order = { type: 'move', x: fx + (cx - fx) * (stop || 1), z: fz + (cz - fz) * (stop || 1) };
      rest.forEach((s, i) => {
        const rank = i + 1;
        if (kind === 'column') {
          s.order = { type: 'follow', leaderId: leader.id, dx: -rank * 60, dz: 0 };
        } else {
          const row = Math.ceil(rank / 2);
          const sideSign = rank % 2 === 1 ? 1 : -1;
          s.order = { type: 'follow', leaderId: leader.id, dx: -row * 52, dz: sideSign * row * 44 };
        }
      });
    }
  }

  flow: CurrentField | null = null;
  tide = 0;

  step(dt: number) {
    this.time += dt;
    if (this.flow) this.tide = this.flow.tideAt(this.time);
    for (const s of this.ships) if (s.revealed > 0) s.revealed -= dt;
    this.active.joseon.length = 0;
    this.active.japan.length = 0;
    for (const s of this.ships) if (this.isActive(s)) this.active[s.team].push(s);
    this.grid.rebuild(this.ships);
    this.checkRetreat();
    for (const s of this.ships) {
      if (!s.alive) continue;
      s.thinkTimer -= dt;
      if (s.thinkTimer <= 0) {
        s.thinkTimer += THINK_INTERVAL;
        this.think(s);
        this.avoidLand(s);
      }
    }
    for (const s of this.ships) if (s.alive) this.move(s, dt);
    this.collide(dt);
    for (const s of this.ships) if (s.alive) this.weapons(s, dt);
    this.updateProjectiles(dt);
    for (const s of this.ships) if (s.alive) this.damageOverTime(s, dt);
    this.resolveBoarding(dt);
    if (!this.winner) {
      if (this.active.japan.length === 0 && this.initial.japan > 0) this.winner = 'joseon';
      else if (this.active.joseon.length === 0 && this.initial.joseon > 0) this.winner = 'japan';
    }
  }

  private checkRetreat() {
    if (this.time <= 60) return;
    const own = teamOf(this.player);
    for (const team of TEAMS) {
      if (this.retreating[team] || team === own) continue;
      const ratio = this.active[team].length / Math.max(1, this.initial[team]);
      if (ratio < this.retreatBelow[team]) this.retreating[team] = true;
    }
  }

  /** Whether the computer leads this ship. */
  isAi(s: Ship) {
    return this.autopilot || s.spec.faction !== this.player;
  }

  /** A computer-led ship waiting in its starting order joins the fight once the enemy is close or the wait is over. */
  private wake(s: Ship) {
    const type = s.order.type;
    if ((type !== 'slot' && type !== 'hold') || !this.isAi(s)) return;
    const enemy = this.nearestEnemy(s);
    const reach = type === 'slot' ? WAKE_SLOT : WAKE_HOLD;
    if (this.time > WAKE_AFTER || (enemy && Math.hypot(enemy.x - s.x, enemy.z - s.z) < reach)) s.order = { type: 'auto' };
  }

  private nearestEnemy(s: Ship, preferBoardable = false) {
    const list = this.active[s.team === 'joseon' ? 'japan' : 'joseon'];
    let best: Ship | undefined;
    let bestScore = Infinity;
    for (const o of list) {
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      if (!this.canSee(o, d)) continue;
      let score = d;
      if (preferBoardable && !o.spec.boardable) score += 700;
      if (o.id === s.targetId) score -= 60;
      if (o.spec.kind === 'hyeopseon') score += 120;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  private steerTo(s: Ship, tx: number, tz: number, arrive: number, maxThrottle = 1) {
    const dx = tx - s.x;
    const dz = tz - s.z;
    const dist = Math.hypot(dx, dz);
    const diff = wrapAngle(Math.atan2(dz, dx) - s.heading);
    s.rudder = clamp(diff * 2.4, -1, 1);
    const turnPenalty = Math.abs(diff) > 1.4 ? 0.35 : Math.abs(diff) > 0.7 ? 0.7 : 1;
    s.throttle = clamp(dist / arrive, 0, 1) * maxThrottle * turnPenalty;
    return dist;
  }

  private face(s: Ship, heading: number, throttle = 0.25) {
    const diff = wrapAngle(heading - s.heading);
    s.rudder = clamp(diff * 2.8, -1, 1);
    s.throttle = Math.abs(diff) > 0.25 ? Math.max(throttle, 0.3) : throttle;
    return Math.abs(diff);
  }

  private isWater(x: number, z: number) {
    return this.land(x, z) < DRAFT - 1;
  }

  private avoidLand(s: Ship) {
    if (s.sinking > 0 || s.struck || s.order.type === 'anchor') return;
    const look = s.spec.length * 0.6 + 30 + Math.abs(s.speed) * 9;
    const desired = s.heading + clamp(s.rudder, -1, 1) * 0.6;
    const clear = (h: number) => {
      for (const f of [0.5, 1, 1.6]) {
        if (!this.isWater(s.x + Math.cos(h) * look * f, s.z + Math.sin(h) * look * f)) return false;
      }
      return true;
    };
    if (clear(desired)) return;
    for (const off of [0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.2, -2.2]) {
      const h = desired + off;
      if (clear(h)) {
        s.rudder = clamp(wrapAngle(h - s.heading) * 2.6, -1, 1);
        s.throttle = Math.min(s.throttle, 0.6);
        return;
      }
    }
    s.rudder = 1;
    s.throttle = 0.15;
  }

  private avoid(s: Ship) {
    const cos = Math.cos(s.heading);
    const sin = Math.sin(s.heading);
    const range = s.spec.length * 1.8 + 20;
    this.grid.query(s.x, s.z, range + 40, (o) => {
      if (o === s || !o.alive || o.id === s.grappledWith) return;
      if (s.team !== o.team && (s.team === 'japan' || s.stance === 'board' || s.stance === 'ram')) return;
      if (s.spec.kind === 'geobukseon' && o.team !== s.team) return;
      const dx = o.x - s.x;
      const dz = o.z - s.z;
      const r = (s.spec.length + o.spec.length) * 0.9 + 10;
      if (dx * dx + dz * dz > r * r) return;
      const lx = dx * cos + dz * sin;
      const lz = -dx * sin + dz * cos;
      if (lx < -s.spec.length * 0.3) return;
      const width = (s.spec.beam + o.spec.beam) * 0.75 + 6;
      if (Math.abs(lz) > width) return;
      const closeness = 1 - Math.min(1, Math.max(0, lx) / r);
      s.rudder = clamp(s.rudder - Math.sign(lz || 1) * 1.2 * closeness, -1, 1);
      s.throttle *= 1 - 0.6 * closeness;
    });
  }

  private think(s: Ship) {
    if (s.sinking > 0 || s.struck) {
      s.throttle = 0;
      s.rudder = 0;
      this.activity.set(s.id, s.sinking > 0 ? 'sinking' : 'struck');
      return;
    }
    if (s.grappledWith) {
      s.throttle = 0;
      s.rudder = 0;
      this.activity.set(s.id, 'boarding');
      return;
    }
    if (this.retreating[s.team] && s.order.type !== 'anchor') {
      this.flee(s);
      return;
    }
    this.wake(s);
    const order = s.order;
    if (order.type === 'anchor') {
      s.throttle = 0;
      s.rudder = 0;
      this.activity.set(s.id, 'anchored');
      const enemy = this.nearestEnemy(s);
      if (enemy && s.spec.kind !== 'atakebune' && Math.hypot(enemy.x - s.x, enemy.z - s.z) < 300) s.order = { type: 'auto' };
      return;
    }
    if (order.type === 'move') {
      const d = this.steerTo(s, order.x, order.z, 60);
      this.activity.set(s.id, 'moving');
      if (d < 25) s.order = { type: 'hold' };
      this.avoid(s);
      return;
    }
    if (order.type === 'slot') {
      const d = this.steerTo(s, order.x, order.z, 70);
      this.activity.set(s.id, 'moving');
      if (d < 30) {
        this.face(s, order.face, 0.12);
        this.activity.set(s.id, 'engaging');
      }
      this.avoid(s);
      return;
    }
    if (order.type === 'hold') {
      s.throttle = 0;
      s.rudder = 0;
      this.activity.set(s.id, 'idle');
      return;
    }
    if (order.type === 'follow') {
      const leader = this.byId.get(order.leaderId);
      if (!this.isActive(leader)) {
        s.order = { type: 'hold' };
        return;
      }
      const c = Math.cos(leader.heading);
      const n = Math.sin(leader.heading);
      const tx = leader.x + c * order.dx - n * order.dz;
      const tz = leader.z + n * order.dx + c * order.dz;
      const d = Math.hypot(tx - s.x, tz - s.z);
      if (d < 25) {
        this.face(s, leader.heading, Math.min(1, leader.speed / s.spec.maxSpeed + 0.05));
      } else {
        const ahead = Math.min(80, d);
        this.steerTo(s, tx + c * ahead * 0.4, tz + n * ahead * 0.4, 50, 1);
        s.throttle = Math.min(1, s.throttle * (0.7 + Math.min(0.6, d / 120)));
      }
      this.activity.set(s.id, 'moving');
      this.avoid(s);
      return;
    }
    if (order.type === 'broadside') {
      const target = this.byId.get(order.targetId);
      if (!this.isActive(target)) {
        s.order = { type: 'hold' };
        return;
      }
      s.targetId = target.id;
      const dx = target.x - s.x;
      const dz = target.z - s.z;
      const d = Math.hypot(dx, dz);
      const bearing = Math.atan2(dz, dx);
      if (d > 300) {
        this.steerTo(s, target.x, target.z, 120, 1);
        this.activity.set(s.id, 'moving');
      } else {
        const heading = order.side === 0 ? bearing + Math.PI / 2 : bearing - Math.PI / 2;
        const drift = clamp((d - 190) / 140, -0.5, 0.5) * (order.side === 0 ? -1 : 1) * 0.6;
        this.face(s, heading + drift, d < 120 ? 0.35 : 0.18);
        this.activity.set(s.id, 'engaging');
      }
      this.avoid(s);
      return;
    }
    let target: Ship | undefined;
    if (order.type === 'attack') {
      target = this.byId.get(order.targetId);
      if (!this.isActive(target)) {
        s.order = { type: 'auto' };
        target = undefined;
      }
    }
    if (s.team === 'joseon') this.thinkJoseon(s, target);
    else this.thinkJapan(s, target);
    this.avoid(s);
  }

  private flee(s: Ship) {
    const away = Math.atan2(s.z - this.center.z, s.x - this.center.x);
    this.steerTo(s, s.x + Math.cos(away) * 400, s.z + Math.sin(away) * 400, 50, 1);
    this.activity.set(s.id, 'fleeing');
    if (Math.hypot(s.x - this.center.x, s.z - this.center.z) > this.arenaRadius) {
      s.alive = false;
      this.escaped[s.team] += 1;
      this.events.push({ type: 'removed', ship: s.id });
    }
  }

  private thinkJoseon(s: Ship, forced: Ship | undefined) {
    const target = forced ?? this.nearestEnemy(s);
    if (!target) {
      s.throttle = 0.12;
      s.rudder = 0;
      this.activity.set(s.id, 'idle');
      return;
    }
    s.targetId = target.id;
    const dx = target.x - s.x;
    const dz = target.z - s.z;
    const d = Math.hypot(dx, dz);
    const bearing = Math.atan2(dz, dx);
    const stance = s.stance;
    if (stance === 'board' || stance === 'ram') {
      const lead = Math.min(3, d / 8);
      this.steerTo(s, target.x + Math.cos(target.heading) * target.speed * lead, target.z + Math.sin(target.heading) * target.speed * lead, stance === 'board' ? 14 : 10, 1);
      this.activity.set(s.id, 'charging');
      return;
    }
    if (stance === 'standoff' || stance === 'close') {
      this.broadsideDuel(s, target, d, bearing, stance === 'close' ? 45 : 150, stance === 'close' ? 140 : 380);
      return;
    }
    if (s.spec.kind === 'geobukseon') {
      const timer = (this.chargeTimer.get(s.id) ?? 0) - THINK_INTERVAL;
      this.chargeTimer.set(s.id, timer);
      if (timer > 0) {
        this.steerTo(s, s.x - Math.cos(bearing) * 200, s.z - Math.sin(bearing) * 200, 80, 0.8);
        this.activity.set(s.id, 'evading');
        return;
      }
      const lead = Math.min(3, d / 8);
      this.steerTo(s, target.x + Math.cos(target.heading) * target.speed * lead, target.z + Math.sin(target.heading) * target.speed * lead, 10, 1);
      this.activity.set(s.id, 'charging');
      return;
    }
    if (s.spec.kind === 'hyeopseon') {
      if (d < 240) {
        this.steerTo(s, s.x - Math.cos(bearing) * 150, s.z - Math.sin(bearing) * 150, 60, 1);
        this.activity.set(s.id, 'evading');
      } else {
        this.face(s, bearing + Math.PI / 2, 0.15);
        this.activity.set(s.id, 'idle');
      }
      return;
    }
    this.broadsideDuel(s, target, d, bearing, 150, 380);
  }

  private broadsideDuel(s: Ship, target: Ship, d: number, bearing: number, minRange: number, maxRange: number) {
    if (d < minRange) {
      const away = bearing + Math.PI;
      const side = wrapAngle(away - s.heading) > 0 ? 1 : -1;
      const h = away - side * 0.6;
      this.steerTo(s, s.x + Math.cos(h) * 150, s.z + Math.sin(h) * 150, 60, 1);
      this.activity.set(s.id, 'evading');
    } else if (d > maxRange) {
      this.steerTo(s, target.x, target.z, 120, 1);
      this.activity.set(s.id, 'moving');
    } else {
      const a = bearing + Math.PI / 2;
      const b = bearing - Math.PI / 2;
      const h = Math.abs(wrapAngle(a - s.heading)) < Math.abs(wrapAngle(b - s.heading)) ? a : b;
      const drift = (d - (minRange + maxRange) / 2) / (maxRange - minRange);
      this.face(s, h + clamp(drift, -0.5, 0.5) * (h === a ? -1 : 1) * 0.6, 0.3);
      this.activity.set(s.id, 'engaging');
    }
  }

  private thinkJapan(s: Ship, forced: Ship | undefined) {
    const target = forced ?? this.nearestEnemy(s, true);
    if (!target) {
      s.throttle = 0.2;
      this.activity.set(s.id, 'idle');
      return;
    }
    s.targetId = target.id;
    const d = Math.hypot(target.x - s.x, target.z - s.z);
    const lead = Math.min(4, d / Math.max(2, s.spec.maxSpeed));
    const tx = target.x + Math.cos(target.heading) * target.speed * lead;
    const tz = target.z + Math.sin(target.heading) * target.speed * lead;
    if (!target.spec.boardable && d < 120) {
      const away = Math.atan2(s.z - target.z, s.x - target.x);
      this.steerTo(s, target.x + Math.cos(away + 0.9) * 150, target.z + Math.sin(away + 0.9) * 150, 60, 1);
      this.activity.set(s.id, 'evading');
      return;
    }
    this.steerTo(s, tx, tz, 8, 1);
    this.activity.set(s.id, d < 200 ? 'charging' : 'moving');
  }

  private move(s: Ship, dt: number) {
    const spec = s.spec;
    const crewFactor = 0.35 + 0.65 * Math.max(0, s.crew / spec.crew);
    const sinkingFactor = s.sinking > 0 || s.struck ? 0 : 1;
    const anchored = s.order.type === 'anchor' ? 0 : 1;
    const target = s.throttle * s.speedCap * spec.maxSpeed * s.mods.speed * crewFactor * (1 - s.fire * 0.35) * sinkingFactor * anchored;
    const rate = target > s.speed ? spec.accel : spec.accel * 1.6;
    s.speed += clamp(target - s.speed, -rate * dt, rate * dt);
    if (s.grappledWith) s.speed *= Math.max(0, 1 - dt * 1.5);
    const steer = 0.4 + 0.6 * Math.min(1, Math.abs(s.speed) / spec.maxSpeed);
    const desiredTurn = s.rudder * spec.turnRate * s.mods.turn * steer * crewFactor * sinkingFactor * anchored;
    s.turn += (desiredTurn - s.turn) * Math.min(1, dt * 1.4);
    s.heading = wrapAngle(s.heading + s.turn * dt);
    const drift = anchored ? 0.15 : 0;
    const flow = this.flow ? this.flow.velocity(s.x, s.z, this.tide) : this.current;
    const set = s.order.type === 'anchor' ? 0.15 : 1;
    const nx = s.x + Math.cos(s.heading) * s.speed * dt + (Math.cos(this.windAngle) * drift + flow.x * set) * dt;
    const nz = s.z + Math.sin(s.heading) * s.speed * dt + (Math.sin(this.windAngle) * drift + flow.z * set) * dt;
    if (this.flow && (flow.x || flow.z)) {
      const cross = Math.cos(s.heading) * flow.z - Math.sin(s.heading) * flow.x;
      s.heading = wrapAngle(s.heading + cross * dt * 0.012 * (40 / s.spec.length));
    }
    const bowX = nx + Math.cos(s.heading) * spec.length * 0.45;
    const bowZ = nz + Math.sin(s.heading) * spec.length * 0.45;
    if (this.land(bowX, bowZ) > DRAFT || this.land(nx, nz) > DRAFT) {
      s.speed *= -0.2;
      s.aground = Math.min(5, s.aground + dt);
      const e = 6;
      const gx = this.land(s.x + e, s.z) - this.land(s.x - e, s.z);
      const gz = this.land(s.x, s.z + e) - this.land(s.x, s.z - e);
      const g = Math.hypot(gx, gz) || 1;
      s.x -= (gx / g) * dt * 3;
      s.z -= (gz / g) * dt * 3;
    } else {
      s.x = nx;
      s.z = nz;
      s.aground = Math.max(0, s.aground - dt);
    }
    if (s.sinking > 0) {
      s.sinking = Math.min(1, s.sinking + dt / SINK_DURATION);
      if (s.sinking >= 1) {
        s.alive = false;
        this.events.push({ type: 'removed', ship: s.id });
      }
    }
  }

  private circles(s: Ship, out: number[]) {
    const r = s.spec.beam * 0.5;
    const half = s.spec.length * 0.5 - r;
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    out.length = 0;
    for (let i = -1; i <= 1; i += 1) out.push(s.x + c * half * i, s.z + n * half * i, r);
    return out;
  }

  private collide(dt: number) {
    const ca: number[] = [];
    const cb: number[] = [];
    for (const a of this.ships) {
      if (!a.alive) continue;
      this.grid.query(a.x, a.z, a.spec.length + 25, (b) => {
        if (b.id <= a.id || !b.alive) return;
        const reach = (a.spec.length + b.spec.length) * 0.5;
        const dx0 = b.x - a.x;
        const dz0 = b.z - a.z;
        if (dx0 * dx0 + dz0 * dz0 > reach * reach) return;
        this.circles(a, ca);
        this.circles(b, cb);
        let bestPen = -Infinity;
        let nx = 0;
        let nz = 0;
        let px = 0;
        let pz = 0;
        for (let p = 0; p < 9; p += 3) {
          for (let q = 0; q < 9; q += 3) {
            const dx = cb[q]! - ca[p]!;
            const dz = cb[q + 1]! - ca[p + 1]!;
            const d = Math.hypot(dx, dz) || 0.001;
            const pen = ca[p + 2]! + cb[q + 2]! - d;
            if (pen > bestPen) {
              bestPen = pen;
              nx = dx / d;
              nz = dz / d;
              px = (ca[p]! + cb[q]!) * 0.5;
              pz = (ca[p + 1]! + cb[q + 1]!) * 0.5;
            }
          }
        }
        if (bestPen <= 0) {
          if (bestPen > -3) this.tryGrapple(a, b);
          return;
        }
        const ma = a.spec.length * a.spec.beam;
        const mb = b.spec.length * b.spec.beam;
        const wa = mb / (ma + mb);
        const wb = ma / (ma + mb);
        a.x -= nx * bestPen * wa;
        a.z -= nz * bestPen * wa;
        b.x += nx * bestPen * wb;
        b.z += nz * bestPen * wb;
        const vax = Math.cos(a.heading) * a.speed;
        const vaz = Math.sin(a.heading) * a.speed;
        const vbx = Math.cos(b.heading) * b.speed;
        const vbz = Math.sin(b.heading) * b.speed;
        const closing = (vax - vbx) * nx + (vaz - vbz) * nz;
        if (closing > 1.2 && a.team !== b.team && this.time - a.lastHit > 0.5) {
          const aHits = Math.max(0, vax * nx + vaz * nz);
          const bHits = Math.max(0, -(vbx * nx + vbz * nz));
          const toB = aHits * a.spec.ramPower * 5 * (1 - b.spec.armor);
          const toA = bHits * b.spec.ramPower * 5 * (1 - a.spec.armor);
          this.damage(b, toB + closing * 1.5, a);
          this.damage(a, toA + closing * (a.spec.kind === 'geobukseon' ? 0.3 : 1.2), b);
          const lostB = Math.round(toB * 0.4);
          b.crew = Math.max(0, b.crew - lostB);
          if (lostB > 0) this.events.push({ type: 'casualty', ship: b.id, count: lostB, melee: false });
          a.lastHit = this.time;
          b.lastHit = this.time;
          this.events.push({ type: 'ram', a: a.id, b: b.id, x: px, z: pz, power: closing });
          if (a.spec.kind === 'geobukseon') this.chargeTimer.set(a.id, 9);
          if (b.spec.kind === 'geobukseon') this.chargeTimer.set(b.id, 9);
        }
        a.speed *= Math.max(0, 1 - dt * 2.5);
        b.speed *= Math.max(0, 1 - dt * 2.5);
        this.tryGrapple(a, b);
      });
    }
  }

  private wantsBoard(s: Ship) {
    return s.team === 'japan' ? s.stance !== 'standoff' : s.stance === 'board';
  }

  private tryGrapple(a: Ship, b: Ship) {
    if (a.team === b.team) return;
    let attacker: Ship;
    if (this.wantsBoard(a) && !a.grappledWith) attacker = a;
    else if (this.wantsBoard(b) && !b.grappledWith) attacker = b;
    else return;
    const defender = attacker === a ? b : a;
    if (!this.isActive(attacker) || !this.isActive(defender)) return;
    if (attacker.grappledWith) return;
    if (defender.repel && this.rand() < 0.55) {
      if (this.time - attacker.lastHit > 1.2) {
        attacker.lastHit = this.time;
        attacker.crew = Math.max(0, attacker.crew - 2);
        this.events.push({ type: 'repelled', a: attacker.id, b: defender.id });
      }
      return;
    }
    if (!defender.spec.boardable) {
      if (this.time - attacker.lastHit > 1.5) {
        attacker.crew = Math.max(0, attacker.crew - 3);
        attacker.lastHit = this.time;
        this.events.push({ type: 'casualty', ship: attacker.id, count: 3, melee: true });
      }
      return;
    }
    const rel = Math.abs(attacker.speed - defender.speed * Math.cos(attacker.heading - defender.heading));
    if (rel > 3.5) return;
    attacker.grappledWith = defender.id;
    attacker.grappleTime = 0;
    this.events.push({ type: 'board', a: attacker.id, b: defender.id });
  }

  private resolveBoarding(dt: number) {
    for (const s of this.ships) {
      if (!s.grappledWith) continue;
      const d = this.byId.get(s.grappledWith);
      if (!this.isActive(s) || !this.isActive(d)) {
        s.grappledWith = 0;
        continue;
      }
      s.grappleTime += dt;
      const dist = Math.hypot(d.x - s.x, d.z - s.z);
      if (dist > (s.spec.length + d.spec.length) * 0.5 + 6) {
        s.grappledWith = 0;
        continue;
      }
      if (d.repel && this.rand() < dt * 0.14) {
        s.grappledWith = 0;
        this.events.push({ type: 'repelled', a: s.id, b: d.id });
        continue;
      }
      const atk = s.crew * s.spec.melee * s.mods.melee;
      const def = d.crew * d.spec.melee * d.spec.deckDefense * d.mods.defense * (d.repel ? 1.3 : 1);
      const beforeD = Math.floor(d.crew);
      const beforeS = Math.floor(s.crew);
      d.crew = Math.max(0, d.crew - atk * 0.045 * dt * (0.6 + this.rand() * 0.8));
      s.crew = Math.max(0, s.crew - def * 0.05 * dt * (0.6 + this.rand() * 0.8));
      const killedD = beforeD - Math.floor(d.crew);
      const killedS = beforeS - Math.floor(s.crew);
      if (killedD > 0) this.events.push({ type: 'casualty', ship: d.id, count: killedD, melee: true });
      if (killedS > 0) this.events.push({ type: 'casualty', ship: s.id, count: killedS, melee: true });
      if (d.crew < d.spec.crew * 0.06) {
        d.struck = true;
        d.fire = Math.max(d.fire, 0.5);
        s.grappledWith = 0;
        s.kills += 1;
        this.events.push({ type: 'struck', ship: d.id });
      } else if (s.crew < s.spec.crew * 0.12) {
        s.grappledWith = 0;
        s.struck = true;
        this.events.push({ type: 'struck', ship: s.id });
      }
    }
  }

  private rangeFactor(s: Ship) {
    return s.ammo === 'crew' ? 0.72 : s.ammo === 'fire' ? 0.85 : 1;
  }

  private weapons(s: Ship, dt: number) {
    if (!this.isActive(s)) return;
    const crewFactor = 0.25 + 0.75 * (s.crew / s.spec.crew);
    const spec = s.spec;
    const targets: (Ship | undefined | null)[] = [null, null, null];
    const volleyTargets: (Ship | undefined | null)[] = [null, null, null];
    const volleying = s.volleySide >= 0 && s.volleyTimer > 0;
    let volleyCount = 0;
    if (s.volleyTimer > 0) {
      s.volleyTimer -= dt;
      if (s.volleyTimer <= 0) s.volleySide = -1;
    }
    const rangeMul = this.rangeFactor(s);
    for (const raw of s.guns) {
      const g = raw as AimedGun;
      const battery = spec.batteries[g.battery]!;
      const gun = GUN_SPECS[battery.gun];
      const range = gun.range * rangeMul;
      if (g.stage < 4) {
        if (g.ammo <= 0) continue;
        g.t += dt * crewFactor * s.mods.reload;
        const need = gun.stages[g.stage]!;
        if (g.t >= need) {
          g.t -= need;
          g.stage += 1;
        }
        continue;
      }
      if (g.stage === 4) {
        const sideIndex = g.side === 2 ? 2 : g.side;
        if (volleying && (s.volleySide === sideIndex || (s.volleySide === 3 && sideIndex !== 2))) {
          if (volleyTargets[sideIndex] === null) volleyTargets[sideIndex] = g.side === 2 ? this.findBowTarget(s, range * 1.15) : this.findBroadsideTarget(s, g.side, range * 1.15);
          const vt = volleyTargets[sideIndex];
          g.stage = 5;
          g.t = 0;
          g.fireDelay = 0.04 + this.rand() * 0.5;
          g.target = vt ? vt.id : -1;
          volleyCount += 1;
          continue;
        }
        if (s.fireMode === 'hold') continue;
        if (targets[sideIndex] === null) targets[sideIndex] = g.side === 2 ? this.findBowTarget(s, range) : this.findBroadsideTarget(s, g.side, range);
        const target = targets[sideIndex];
        if (!target) continue;
        if (Math.hypot(target.x - s.x, target.z - s.z) > range) continue;
        g.stage = 5;
        g.t = 0;
        g.fireDelay = gun.stages[5]! * (0.6 + this.rand() * 0.9);
        g.target = target.id;
        continue;
      }
      g.t += dt;
      if (g.t >= g.fireDelay) {
        this.fireGun(s, g, g.target ?? 0);
        g.stage = 0;
        g.t = 0;
      }
    }
    if (volleyCount > 0) {
      this.events.push({ type: 'volley', ship: s.id, side: s.volleySide, count: volleyCount });
      if (s.volleySide !== 3) {
        s.volleySide = -1;
        s.volleyTimer = 0;
      }
    }
    if (spec.musketRange > 0) {
      s.musketReload = Math.max(0, s.musketReload - dt * crewFactor * s.mods.reload);
      if (s.musketReload <= 0) {
        let target: Ship | undefined;
        let best = spec.musketRange;
        this.grid.query(s.x, s.z, spec.musketRange, (o) => {
          if (o.team === s.team || !this.isActive(o)) return;
          const d = Math.hypot(o.x - s.x, o.z - s.z);
          if (!this.canSee(o, d)) return;
          if (d < best) {
            best = d;
            target = o;
          }
        });
        if (target) {
          const t = target as Ship;
          const accuracy = (1 - (best / spec.musketRange) * 0.6) * s.mods.accuracy;
          const loss = (spec.musketPower * (s.crew / spec.crew) * (2.5 + this.rand() * 4) * accuracy) / t.spec.deckDefense;
          const before = Math.floor(t.crew);
          t.crew = Math.max(0, t.crew - loss);
          const killed = before - Math.floor(t.crew);
          if (killed > 0) this.events.push({ type: 'casualty', ship: t.id, count: killed, melee: false });
          const dx = (t.x - s.x) / best;
          const dz = (t.z - s.z) / best;
          this.events.push({ type: 'musket', ship: s.id, x: s.x, y: spec.deck + 1, z: s.z, dx, dz, count: s.spec.kind === 'atakebune' ? 10 : s.spec.kind === 'sekibune' ? 5 : 3 });
          if (best < 95 && t.spec.boardable && this.rand() < 0.06) this.ignite(t, 0.18);
          s.musketReload = 3.2 + this.rand() * 1.5;
          if (t.crew < t.spec.crew * 0.04 && !t.struck) {
            t.struck = true;
            this.events.push({ type: 'struck', ship: t.id });
          }
        }
      }
    }
  }

  private findBroadsideTarget(s: Ship, side: Side, range: number) {
    const sx = side === 0 ? Math.sin(s.heading) : -Math.sin(s.heading);
    const sz = side === 0 ? -Math.cos(s.heading) : Math.cos(s.heading);
    let best: Ship | undefined;
    let bestScore = Infinity;
    const cosArc = Math.cos(0.75);
    this.grid.query(s.x, s.z, range, (o) => {
      if (o.team === s.team || !this.isActive(o)) return;
      const dx = o.x - s.x;
      const dz = o.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > range || d < 8) return;
      if (!this.canSee(o, d)) return;
      const c = (dx * sx + dz * sz) / d;
      if (c < cosArc) return;
      const score = d - (o.id === s.targetId ? 80 : 0) - c * 40;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    });
    return best;
  }

  private findBowTarget(s: Ship, range: number) {
    const fx = Math.cos(s.heading);
    const fz = Math.sin(s.heading);
    let best: Ship | undefined;
    let bestD = Infinity;
    this.grid.query(s.x, s.z, range, (o) => {
      if (o.team === s.team || !this.isActive(o)) return;
      const dx = o.x - s.x;
      const dz = o.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > range) return;
      if (!this.canSee(o, d)) return;
      if ((dx * fx + dz * fz) / d < Math.cos(0.35)) return;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    });
    return best;
  }

  muzzle(s: Ship, side: Side | 2, slot: number, count: number) {
    const spec = s.spec;
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    if (side === 2) {
      const f = spec.length * 0.5 + 0.5;
      return { x: s.x + c * f, y: spec.deck * 0.75, z: s.z + n * f, dx: c, dz: n };
    }
    const along = count <= 1 ? 0 : (slot / (count - 1) - 0.5) * spec.length * 0.66;
    const sx = side === 0 ? n : -n;
    const sz = side === 0 ? -c : c;
    const out = spec.beam * 0.5 + 0.4;
    return { x: s.x + c * along + sx * out, y: spec.deck * 0.6, z: s.z + n * along + sz * out, dx: sx, dz: sz };
  }

  private fireGun(s: Ship, g: GunState, targetId: number) {
    const target = targetId > 0 ? this.byId.get(targetId) : undefined;
    const blind = targetId < 0;
    if (!blind && !this.isActive(target)) return;
    const battery = s.spec.batteries[g.battery]!;
    const gun = GUN_SPECS[battery.gun];
    const sideGuns = s.guns.filter((x) => x.side === g.side);
    const slot = sideGuns.indexOf(g);
    const m = this.muzzle(s, g.side, slot, sideGuns.length);
    let tx: number;
    let tz: number;
    let aimHeight: number;
    if (target && this.isActive(target)) {
      const d0 = Math.hypot(target.x - m.x, target.z - m.z);
      const flight = d0 / gun.muzzle;
      tx = target.x + Math.cos(target.heading) * target.speed * flight;
      tz = target.z + Math.sin(target.heading) * target.speed * flight;
      aimHeight = target.spec.deck * 0.6 - m.y;
    } else {
      const reach = Math.min(gun.range * 0.7, 260);
      tx = m.x + m.dx * reach;
      tz = m.z + m.dz * reach;
      aimHeight = 2 - m.y;
    }
    const mode = s.ammo;
    let damage = gun.damage;
    let crewDamage = gun.crewDamage;
    let ammo = gun.ammo;
    let fireChance = s.team === 'joseon' ? (gun.ammo === 'arrow' ? 0.16 : 0.07) : 0.04;
    let spreadMul = gun.ammo === 'grape' ? 1.8 : 1;
    if (mode === 'hull') {
      damage *= 1.25;
      crewDamage *= 0.6;
      fireChance *= 0.6;
      if (ammo === 'grape') ammo = 'ball';
      spreadMul = 1;
    } else if (mode === 'crew') {
      damage *= 0.45;
      crewDamage *= 2.3;
      fireChance *= 0.5;
      ammo = 'grape';
      spreadMul = 1.7;
    } else if (mode === 'fire') {
      damage *= 0.7;
      crewDamage *= 0.8;
      fireChance = Math.min(0.72, fireChance * 3.2 + 0.14);
      ammo = 'fire';
      spreadMul = 1.15;
    }
    const dx = tx - m.x;
    const dz = tz - m.z;
    const d = Math.hypot(dx, dz);
    const morale = (0.6 + 0.4 * (s.crew / s.spec.crew)) * s.mods.accuracy;
    const spreadAz = ((0.01 + d * 0.00006) / morale) * spreadMul;
    const spreadEl = (0.0035 + d * 0.00001) / morale;
    fireChance = Math.min(0.85, fireChance * s.mods.fire);
    const gauss = () => (this.rand() + this.rand() + this.rand() - 1.5) * 1.15;
    const az = Math.atan2(dz, dx) + gauss() * spreadAz;
    const k = Math.min(1, (GRAVITY * d) / (gun.muzzle * gun.muzzle));
    const elev = 0.5 * Math.asin(k) + Math.atan2(aimHeight, d) + gauss() * spreadEl;
    const v = gun.muzzle * (0.97 + this.rand() * 0.06);
    const proj: Projectile = {
      id: this.nextProjectile++,
      x: m.x,
      y: m.y,
      z: m.z,
      vx: Math.cos(az) * Math.cos(elev) * v,
      vy: Math.sin(elev) * v,
      vz: Math.sin(az) * Math.cos(elev) * v,
      team: s.team,
      shooter: s.id,
      damage,
      crewDamage,
      ammo,
      gun: gun.type,
      fireChance,
      age: 0,
      alive: true,
    };
    this.projectiles.push(proj);
    s.revealed = 4;
    g.ammo = Math.max(0, g.ammo - 1);
    const len = Math.hypot(proj.vx, proj.vy, proj.vz);
    this.events.push({ type: 'gun', ship: s.id, gun: gun.type, x: m.x, y: m.y, z: m.z, dx: proj.vx / len, dy: proj.vy / len, dz: proj.vz / len, big: gun.big });
  }

  private updateProjectiles(dt: number) {
    const sub = 4;
    const h = dt / sub;
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      for (let i = 0; i < sub && p.alive; i += 1) {
        p.vy -= GRAVITY * h;
        p.x += p.vx * h;
        p.y += p.vy * h;
        p.z += p.vz * h;
        p.age += h;
        if (p.y < 60) {
          const ground = this.land(p.x, p.z);
          if (ground > 0 && p.y <= ground) {
            p.alive = false;
            this.events.push({ type: 'ground', x: p.x, y: ground, z: p.z });
            break;
          }
        }
        if (p.y < 1.5 && p.y <= waveField.heightAt(p.x, p.z, waveField.time, 8)) {
          p.alive = false;
          this.events.push({ type: 'splash', x: p.x, z: p.z, size: p.ammo === 'arrow' ? 1.2 : p.ammo === 'grape' ? 0.6 : 1 });
          break;
        }
        this.grid.query(p.x, p.z, 25, (s) => {
          if (!p.alive || !s.alive || s.team === p.team || s.sinking >= 0.6) return;
          const dx = p.x - s.x;
          const dz = p.z - s.z;
          const r = s.spec.length * 0.5 + 1;
          if (dx * dx + dz * dz > r * r) return;
          const c = Math.cos(s.heading);
          const n = Math.sin(s.heading);
          const lx = dx * c + dz * n;
          const lz = -dx * n + dz * c;
          const halfL = s.spec.length * 0.5;
          const halfB = s.spec.beam * 0.5 * (1 - Math.pow(Math.abs(lx) / halfL, 3) * 0.6);
          if (Math.abs(lx) > halfL || Math.abs(lz) > halfB + 0.3) return;
          const top = Math.abs(lx) < halfL * 0.5 ? s.spec.height * 0.7 : s.spec.deck + 1.5;
          if (p.y > top || p.y < -1.2) return;
          p.alive = false;
          const shooter = this.byId.get(p.shooter);
          const dmg = p.damage * (1 - s.spec.armor) * (0.7 + this.rand() * 0.6);
          this.damage(s, dmg, shooter);
          const before = Math.floor(s.crew);
          s.crew = Math.max(0, s.crew - (p.crewDamage * (0.5 + this.rand())) / Math.max(1, s.spec.deckDefense * 0.8));
          const killed = before - Math.floor(s.crew);
          if (killed > 0) this.events.push({ type: 'casualty', ship: s.id, count: killed, melee: false });
          if (this.rand() < p.fireChance) this.ignite(s, p.ammo === 'fire' ? 0.26 : 0.2);
          this.events.push({ type: 'hit', ship: s.id, x: p.x, y: p.y, z: p.z, damage: dmg, ammo: p.ammo });
        });
      }
      if (p.age > 14) p.alive = false;
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  private ignite(s: Ship, amount: number) {
    const before = s.fire;
    s.fire = Math.min(1, s.fire + amount);
    if (before < 0.05) this.events.push({ type: 'ignite', ship: s.id });
  }

  private damage(s: Ship, amount: number, source?: Ship) {
    if (s.sinking > 0 || !s.alive) return;
    s.hull -= amount;
    s.lastHit = this.time;
    if (s.hull <= 0) {
      s.hull = 0;
      s.sinking = 0.0001;
      s.grappledWith = 0;
      for (const o of this.ships) if (o.grappledWith === s.id) o.grappledWith = 0;
      if (source) source.kills += 1;
      this.events.push({ type: 'sinking', ship: s.id });
    }
  }

  private damageOverTime(s: Ship, dt: number) {
    if (s.fire > 0) {
      const crewRatio = s.crew / s.spec.crew;
      s.fire += dt * 0.018 * (1 + s.fire);
      if (!s.struck && s.sinking === 0) s.fire -= dt * 0.045 * crewRatio * (0.4 + this.rand() * 1.2);
      s.fire = clamp(s.fire, 0, 1);
      s.burn = Math.min(1, s.burn + dt * s.fire * 0.025);
      if (s.sinking === 0) this.damage(s, dt * s.fire * 1.6);
      s.crew = Math.max(0, s.crew - dt * s.fire * 0.4);
      if (s.fire > 0.75 && this.rand() < dt * 0.012 && s.sinking === 0) {
        this.events.push({ type: 'explode', ship: s.id, x: s.x, y: s.spec.deck, z: s.z });
        this.damage(s, 60);
        s.crew = Math.max(0, s.crew - 25);
      }
      if (s.fire < 0.015 && s.sinking === 0) s.fire = 0;
    }
    if (s.struck && s.sinking === 0) s.fire = Math.max(s.fire, 0.3);
  }
}
