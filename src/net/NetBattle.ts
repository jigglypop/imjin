import type { Battle } from '../sim/battle';
import type { Command } from '../sim/commands';
import type { Conquest } from '../sim/conquest';
import { GUN_SPECS } from '../sim/catalog';
import type { AmmoMode, BattleEvent, Order, Projectile, Stance, Team } from '../sim/types';
import { AMMO_NAMES, decodeSnapshot, ORDER_NAMES, STANCE_NAMES, type ConquestState, type ServerMsg, type ShipFrame } from './protocol';
import { net, type BattleListener } from './NetClient';

const DELAY = 0.12;
const GRAVITY = 9.81;
type Frame = { time: number; ships: Map<number, ShipFrame> };

const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/**
 * A battle run by the multiplayer server. The engine's Battle becomes a puppet: ships take their state from the
 * server's snapshots, drawn a little in the past and blended between the two around that moment, and the server's
 * events drive the effects. Orders go to the server as commands.
 */
export class NetBattle implements BattleListener {
  private frames: Frame[] = [];
  private events: BattleEvent[] = [];
  private metas: Extract<ServerMsg, { t: 'meta' }>[] = [];
  private state: ConquestState | null = null;
  private clock = -1;
  /** Simulated seconds per real second at the server (it skips the approach fast). The playback clock runs at this pace. */
  private pace = 1;
  private announced = false;
  private readonly shots = new Map<number, Projectile>();
  winner: Team | null = null;

  /** `seed` and `you` are what the server built the battle from; a historical duel is rebuilt locally from them. */
  constructor(readonly seed = 0, readonly you = 0) {
    net.listener = this;
  }

  dispose() {
    if (net.listener === this) net.listener = null;
  }

  send(cmd: Command) {
    net.send({ t: 'cmd', cmd });
  }

  snapshot(buf: ArrayBuffer) {
    const f = decodeSnapshot(buf);
    if (!f) return;
    this.frames.push({ time: f.time, ships: new Map(f.ships.map((s) => [s.id, s])) });
    if (this.frames.length > 5) this.frames.shift();
  }

  message(msg: ServerMsg) {
    if (msg.t === 'meta') this.metas.push(msg);
    else if (msg.t === 'events') for (const e of msg.events) this.events.push(e);
    else if (msg.t === 'state') this.state = msg.conquest;
    else if (msg.t === 'end') this.winner = msg.winner;
    else if (msg.t === 'speed' && msg.speed !== this.pace) {
      this.pace = Math.max(1, msg.speed);
      this.clock = -1;
    }
  }

  private applyMeta(b: Battle, msg: Extract<ServerMsg, { t: 'meta' }>) {
    if (msg.squadrons.length) b.squadrons = msg.squadrons.map((q) => ({ ...q, shipIds: [...q.shipIds] }));
    for (const m of msg.ships) {
      let s = b.get(m.id);
      if (!s) {
        const f = this.frames[this.frames.length - 1]?.ships.get(m.id);
        s = b.addShip(m.kind, f?.x ?? 0, f?.z ?? 0, f?.heading ?? 0, m.name, null, m.flagship, m.variant, m.id);
      }
      s.name = m.name;
      s.owner = m.owner;
      s.team = m.team;
      s.squadronId = m.squadron;
      s.flagship = m.flagship;
    }
  }

  advance(b: Battle, conquest: Conquest | null, dt: number) {
    // The engine calls this once it has staged the battle: the server may start its clock.
    if (!this.announced) {
      this.announced = true;
      net.send({ t: 'loaded' });
    }
    for (const m of this.metas) this.applyMeta(b, m);
    this.metas.length = 0;
    if (this.state && conquest) {
      conquest.applyState(this.state);
      this.state = null;
    }
    const latest = this.frames[this.frames.length - 1];
    if (latest) {
      const delay = DELAY * this.pace;
      const behind = latest.time - this.clock;
      if (this.clock < 0 || behind < 0 || behind > 0.6 * this.pace) this.clock = latest.time - delay;
      else this.clock += dt * this.pace * (behind > delay * 1.5 ? 1.08 : behind < delay * 0.5 ? 0.92 : 1);
      let a = this.frames[0]!;
      let c = latest;
      for (let i = 0; i < this.frames.length - 1; i += 1) {
        if (this.frames[i]!.time <= this.clock && this.frames[i + 1]!.time >= this.clock) {
          a = this.frames[i]!;
          c = this.frames[i + 1]!;
        }
      }
      const t = c.time > a.time ? Math.max(0, Math.min(1, (this.clock - a.time) / (c.time - a.time))) : 1;
      this.applyFrames(b, a, c, t);
      b.time = Math.max(b.time, this.clock);
    }
    for (const e of this.events) {
      if (e.type === 'shot') {
        this.shots.set(e.id, { id: e.id, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, team: e.team, shooter: 0, damage: 0, crewDamage: 0, ammo: e.ammo, gun: e.gun, fireChance: 0, age: 0, alive: true });
      } else if (e.type === 'hit' || e.type === 'splash' || e.type === 'ground') this.shots.delete(e.proj);
      else if (e.type === 'removed') {
        const s = b.get(e.ship);
        if (s) s.alive = false;
      }
    }
    for (const p of this.shots.values()) {
      p.vy -= GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.age += dt;
      if (p.age > 14 || p.y < -6) this.shots.delete(p.id);
    }
    b.projectiles = [...this.shots.values()];
    b.events = this.events;
    this.events = [];
    if (this.winner) b.winner = this.winner;
  }

  private applyFrames(b: Battle, a: Frame, c: Frame, t: number) {
    for (const s of b.ships) {
      const f = c.ships.get(s.id);
      if (!f) {
        if (s.alive && this.frames.length > 1) s.alive = false;
        continue;
      }
      const p = a.ships.get(s.id) ?? f;
      s.alive = true;
      s.x = p.x + (f.x - p.x) * t;
      s.z = p.z + (f.z - p.z) * t;
      s.heading = lerpAngle(p.heading, f.heading, t);
      s.speed = p.speed + (f.speed - p.speed) * t;
      s.turn = p.turn + (f.turn - p.turn) * t;
      s.hull = f.hull;
      s.roles = [...f.roles];
      s.crew = f.crew;
      s.plan = [...f.plan];
      s.fire = f.fire;
      s.burn = f.burn;
      s.sinking = f.sinking;
      s.struck = f.struck;
      s.lights = f.lights;
      s.repel = f.repel;
      s.fireMode = f.hold ? 'hold' : 'free';
      s.grappledWith = f.grappledWith;
      s.targetId = f.targetId;
      s.stance = (STANCE_NAMES[f.stance] ?? 'auto') as Stance;
      s.ammo = (AMMO_NAMES[f.ammo] ?? 'auto') as AmmoMode;
      s.speedCap = f.speedCap;
      s.supply = f.supply;
      const type = ORDER_NAMES[f.order] ?? 'auto';
      if (s.order.type !== type) s.order = { type, x: s.x, y: 0, z: s.z, targetId: f.targetId, leaderId: 0, dx: 0, dz: 0, face: s.heading, side: 0 } as unknown as Order;
      if (f.guns) {
        f.guns.forEach((g, i) => {
          const gun = s.guns[i];
          if (!gun) return;
          gun.stage = g.stage;
          gun.t = Math.min(g.t, GUN_SPECS[s.spec.batteries[gun.battery]!.gun].stages[g.stage] ?? 1);
          gun.ammo = g.ammo;
        });
      }
    }
  }
}
