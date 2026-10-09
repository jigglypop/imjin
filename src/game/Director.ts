import type { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { atmosphere } from '../render/atmosphere';
import type { RtsCamera } from '../camera/RtsCamera';
import type { Battle } from '../sim/battle';
import { t } from '../i18n';
import type { BattleEvent, GunType, Projectile, Ship } from '../sim/types';

/**
 * Battle director. It watches the sim's events and does three things:
 *  - cinematic camera: cuts between broadsides, shell flights, impacts, sinkings and boarding fights;
 *  - kill-cam slow motion on a heavy hit, a magazine explosion or a ship going down (single player only);
 *  - camera feel: shake by distance and gun size, and a small FOV punch on near broadsides.
 * Camera cuts are instant on purpose (no sweeping fly-overs), each shot holds for a minimum time, and a new event can
 * only interrupt a shot that has run long enough or that it clearly outranks.
 */

/** The slice of the engine the director reads. */
export interface DirectorHost {
  readonly battle: Battle;
  readonly rts: RtsCamera;
  readonly camera: PerspectiveCamera;
  readonly remote: unknown;
  readonly paused: boolean;
  readonly fastForward: boolean;
  readonly speed: number;
  readonly fx: { liftOf(p: Projectile): number };
}

export type ShotKind = 'broadside' | 'shell' | 'impact' | 'sinking' | 'explosion' | 'boarding' | 'wide';

export const SHOT_LABEL: Record<ShotKind, string> = {
  broadside: '일제 사격',
  shell: '포탄 추적',
  impact: '명중',
  sinking: '침몰',
  explosion: '폭발',
  boarding: '백병전',
  wide: '전장 전경',
};

const BASE_FOV = 42;
/** Slow motion plays at this absolute battle speed whatever the speed setting is. */
const SLOW_SPEED = 0.25;
const SLOW_IN = 0.12;
const SLOW_HOLD = 0.8;
const SLOW_OUT = 0.5;
const SLOW_KEY = 'imjin.slowmo';
const HEAVY: ReadonlySet<GunType> = new Set<GunType>(['cheonja', 'jija']);

type Candidate = {
  kind: ShotKind;
  priority: number;
  ship: number;
  other?: number;
  proj?: number;
  x: number;
  z: number;
  /** Unit direction the shot came from (fire direction), or 0,0 when unknown. */
  dx: number;
  dz: number;
  ttl: number;
};

type Shot = {
  kind: ShotKind;
  priority: number;
  age: number;
  min: number;
  max: number;
  ship: number;
  other: number;
  proj: number;
  yaw: number;
  pitch: number;
  distance: number;
  spin: number;
  lift: number;
  rate: number;
  /** Where a shell landed; the camera holds there briefly. */
  landed: { x: number; z: number; at: number } | null;
  /** Fixed world point for impact shots. */
  x: number;
  z: number;
};

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

function readSlowMo() {
  try {
    return localStorage.getItem(SLOW_KEY) !== '0';
  } catch {
    return true;
  }
}

export class Director {
  /** Kill-cam slow motion setting (연출 슬로모션). */
  private slowEnabled = readSlowMo();

  private slowClock = -1;
  private slowReadyAt = 0;
  private clock = 0;
  private fovKick = 0;
  private fovApplied = BASE_FOV;

  private shot: Shot | null = null;
  private pending: Candidate | null = null;
  /** Guns fired recently per ship, decaying; a burst of them is a broadside. */
  private load = new Map<number, { v: number; dx: number; dz: number; heavy: boolean }>();
  private lastCover = new Map<string, number>();
  /** Heavy shells in the air: id to the shot's launch velocity. */
  private heavy = new Map<number, { gun: GunType; vx: number; vz: number }>();
  private shellReadyAt = 0;
  private kill: { x: number; z: number; level: 'hit' | 'ship' } | null = null;

  constructor(private readonly host: DirectorHost) {}

  get slowMo() {
    return this.slowEnabled;
  }

  setSlowMo(on: boolean) {
    if (on === this.slowEnabled) return;
    this.slowEnabled = on;
    if (!on) this.slowClock = -1;
    try {
      localStorage.setItem(SLOW_KEY, on ? '1' : '0');
    } catch {
      // Private mode: the setting lasts for this session only.
    }
  }

  toggleSlowMo() {
    this.setSlowMo(!this.slowEnabled);
  }

  toggleCinematic() {
    this.host.rts.cinematic = !this.host.rts.cinematic;
  }

  /** Name of the shot on screen while the cinematic camera runs, for the HUD. */
  get shotName() {
    return this.host.rts.cinematic && this.shot ? t(SHOT_LABEL[this.shot.kind]) : '';
  }

  get slowing() {
    return this.slowClock >= 0;
  }

  /** Extra factor on battle time: 1 normally, dipping toward SLOW_SPEED during a kill-cam. */
  timeFactor(baseSpeed: number) {
    if (this.slowClock < 0) return 1;
    const t = this.slowClock;
    const depth = t < SLOW_IN ? smooth(t / SLOW_IN) : t < SLOW_HOLD ? 1 : 1 - smooth((t - SLOW_HOLD) / SLOW_OUT);
    const target = Math.min(1, SLOW_SPEED / Math.max(0.01, baseSpeed));
    return 1 + (target - 1) * depth;
  }

  /** Called with each frame's sim events, before they are cleared. */
  feed(events: BattleEvent[]) {
    const { battle, rts, camera } = this.host;
    const cam = camera.position;
    const fast = this.host.speed > 4;
    for (const e of events) {
      switch (e.type) {
        case 'gun': {
          const d = Math.hypot(e.x - cam.x, e.z - cam.z);
          if (e.big && !fast) this.fovKick = Math.min(3.2, this.fovKick + 1.1 / (1 + (d / 120) ** 2));
          // Extra thump for the big guns, on top of what the effects layer already adds.
          if (e.big) rts.shake(0.4 / (1 + (d / 70) ** 2));
          const l = this.load.get(e.ship) ?? { v: 0, dx: 0, dz: 0, heavy: false };
          l.v += e.big ? 1.2 : 0.7;
          l.dx = e.dx;
          l.dz = e.dz;
          l.heavy = l.heavy || HEAVY.has(e.gun);
          this.load.set(e.ship, l);
          if (l.v >= 2.4 && this.cooled('broadside', e.ship, 7)) {
            const s = battle.get(e.ship);
            if (s) {
              const n = Math.hypot(l.dx, l.dz) || 1;
              this.offer({ kind: 'broadside', priority: 3.5 + Math.min(1.5, l.v * 0.2) + (l.heavy ? 0.5 : 0), ship: s.id, x: s.x, z: s.z, dx: l.dx / n, dz: l.dz / n, ttl: 2 });
              this.load.delete(e.ship);
            }
          }
          break;
        }
        case 'shot':
          if (HEAVY.has(e.gun)) {
            if (this.heavy.size > 64) this.heavy.clear();
            this.heavy.set(e.id, { gun: e.gun, vx: e.vx, vz: e.vz });
            if (this.clock >= this.shellReadyAt) {
              this.offer({ kind: 'shell', priority: 4.2, ship: 0, proj: e.id, x: e.x, z: e.z, dx: e.vx, dz: e.vz, ttl: 0.4 });
              this.shellReadyAt = this.clock + 7;
            }
          }
          break;
        case 'hit': {
          const h = this.heavy.get(e.proj);
          this.heavy.delete(e.proj);
          if (h) {
            const n = Math.hypot(h.vx, h.vz) || 1;
            // A shell the camera has been following needs no second cut: its own shot holds on the impact.
            if (this.shot?.kind === 'shell' && this.shot.proj === e.proj) this.land(e.proj, e.x, e.z);
            else this.offer({ kind: 'impact', priority: 6, ship: e.ship, x: e.x, z: e.z, dx: h.vx / n, dz: h.vz / n, ttl: 1.5 });
            this.wantKill(e.x, e.z, 'hit');
          } else this.offer({ kind: 'impact', priority: 1.5, ship: e.ship, x: e.x, z: e.z, dx: 0, dz: 0, ttl: 1.5 });
          break;
        }
        case 'splash':
          this.heavy.delete(e.proj);
          this.land(e.proj, e.x, e.z);
          break;
        case 'ground':
          this.heavy.delete(e.proj);
          this.land(e.proj, e.x, e.z);
          break;
        case 'explode': {
          const d = Math.hypot(e.x - cam.x, e.z - cam.z);
          rts.shake(1.1 / (1 + (d / 160) ** 2));
          this.offer({ kind: 'explosion', priority: 9, ship: e.ship, x: e.x, z: e.z, dx: 0, dz: 0, ttl: 3 });
          this.wantKill(e.x, e.z, 'ship');
          break;
        }
        case 'sinking': {
          const s = battle.get(e.ship);
          if (!s) break;
          this.offer({ kind: 'sinking', priority: 8, ship: s.id, x: s.x, z: s.z, dx: 0, dz: 0, ttl: 3 });
          this.wantKill(s.x, s.z, 'ship');
          break;
        }
        case 'struck': {
          const s = battle.get(e.ship);
          if (s) this.offer({ kind: 'impact', priority: 5, ship: s.id, x: s.x, z: s.z, dx: 0, dz: 0, ttl: 2 });
          break;
        }
        case 'ram': {
          const d = Math.hypot(e.x - cam.x, e.z - cam.z);
          rts.shake((0.5 + e.power * 0.05) / (1 + (d / 120) ** 2));
          this.offer({ kind: 'impact', priority: 5, ship: e.b, x: e.x, z: e.z, dx: 0, dz: 0, ttl: 2 });
          break;
        }
        case 'board':
          if (this.cooled('boarding', e.a, 10)) {
            const s = battle.get(e.b);
            if (s) this.offer({ kind: 'boarding', priority: 6, ship: e.a, other: e.b, x: s.x, z: s.z, dx: 0, dz: 0, ttl: 3 });
          }
          break;
        default:
          break;
      }
    }
  }

  /** Per-frame work with real time (not battle time), so cuts and the kill-cam keep their pace at any speed. */
  update(dt: number) {
    this.clock += dt;
    const { rts, camera } = this.host;
    if (this.slowClock >= 0) {
      this.slowClock += dt;
      const over = this.slowClock >= SLOW_HOLD + SLOW_OUT;
      if (over || !this.slowEnabled || this.host.remote) {
        this.slowClock = -1;
        this.slowReadyAt = Math.max(this.slowReadyAt, this.clock + (over ? 1 : 0));
      }
    }
    for (const [id, l] of this.load) {
      l.v *= Math.exp(-dt * 0.8);
      if (l.v < 0.05) this.load.delete(id);
    }
    if (this.pending && (this.pending.ttl -= dt) <= 0) this.pending = null;

    this.fovKick *= Math.exp(-dt * 5);
    const fov = BASE_FOV + this.fovKick;
    if (Math.abs(fov - this.fovApplied) > 0.01 || (this.fovKick < 0.01 && this.fovApplied !== BASE_FOV)) {
      this.fovApplied = this.fovKick < 0.01 ? BASE_FOV : fov;
      camera.fov = this.fovApplied;
      camera.updateProjectionMatrix();
    }

    if (!rts.cinematic) {
      this.killCam();
      if (this.shot) {
        this.shot = null;
        rts.rate = 1;
          }
      this.pending = null;
      rts.lookLift *= Math.exp(-dt * 4);
      return;
    }
    rts.followId = 0;
    if (this.shot) this.shot.age += dt;
    const p = this.pending;
    const s = this.shot;
    if (p) {
      const over = !s || this.isOver(s);
      if (over || (s.age >= s.min && p.priority >= 2) || (s.age >= 1 && p.priority >= s.priority + 3)) {
        this.pending = null;
        this.cut(p);
      }
    }
    if (!this.shot || this.isOver(this.shot)) this.cut(this.ambient());
    if (this.shot) this.drive(this.shot, dt);
    this.killCam();
  }

  private offer(c: Candidate) {
    if (!this.host.rts.cinematic) return;
    if (!this.pending || c.priority > this.pending.priority) this.pending = c;
  }

  /** True when this kind of shot on this ship has not been shown for `seconds`. */
  private cooled(kind: ShotKind, ship: number, seconds: number) {
    return this.clock - (this.lastCover.get(`${kind}${ship}`) ?? -99) >= seconds;
  }

  private touch(kind: ShotKind, ship: number) {
    this.lastCover.set(`${kind}${ship}`, this.clock);
    if (this.lastCover.size > 200) this.lastCover.clear();
  }

  /** A shell has ended: the shot that follows it holds on the spot for a moment. */
  private land(proj: number, x: number, z: number) {
    const s = this.shot;
    if (s && s.kind === 'shell' && s.proj === proj && !s.landed) s.landed = { x, z, at: s.age };
  }

  private wantKill(x: number, z: number, level: 'hit' | 'ship') {
    if (!this.kill || level === 'ship') this.kill = { x, z, level };
  }

  /** Slow motion for a heavy hit, an explosion or a sinking that the camera is looking at (after any cut to it). */
  private killCam() {
    const k = this.kill;
    this.kill = null;
    if (!k) return;
    const { x, z, level } = k;
    const { rts, battle } = this.host;
    if (!this.slowEnabled || this.host.remote || this.host.paused || this.host.fastForward || battle.winner) return;
    if (this.slowClock >= 0 || this.clock < this.slowReadyAt) return;
    const g = rts.goal;
    if (Math.hypot(x - g.tx, z - g.tz) > Math.max(240, g.distance * 1.3)) return;
    this.slowClock = 0;
    this.slowReadyAt = this.clock + (level === 'hit' ? 6 : 3);
  }

  private isOver(s: Shot) {
    if (s.age >= s.max) return true;
    const b = this.host.battle;
    switch (s.kind) {
      case 'shell':
        return !!s.landed && s.age - s.landed.at > 1.3;
      case 'sinking': {
        const ship = b.get(s.ship);
        return !ship || !ship.alive;
      }
      case 'boarding': {
        const a = b.get(s.ship);
        const o = b.get(s.other);
        const grappled = !!a && (a.grappledWith === s.other || (!!o && o.grappledWith === s.ship));
        return !a || !a.alive || (!grappled && s.age > s.min);
      }
      case 'broadside':
        return !b.isActive(b.get(s.ship));
      default:
        return false;
    }
  }

  /** Starts a shot with an instant cut. */
  private cut(c: Candidate | null) {
    if (!c) return;
    const { rts, battle } = this.host;
    const ship = battle.get(c.ship);
    const L = ship?.spec.length ?? 30;
    const shot: Shot = { kind: c.kind, priority: c.priority, age: 0, min: 3, max: 6, ship: c.ship, other: c.other ?? 0, proj: c.proj ?? 0, yaw: rts.yaw, pitch: 0.12, distance: 100, spin: 0, lift: 0, rate: 1, landed: null, x: c.x, z: c.z };
    const side = Math.random() < 0.5 ? -1 : 1;
    switch (c.kind) {
      case 'broadside': {
        const f = Math.atan2(c.dz, c.dx);
        // On the firing side, a little toward the bow, low: the flank, the flash and the plumes in one frame.
        const toBow = wrap((ship?.heading ?? f) - f);
        shot.yaw = f + (toBow >= 0 ? 0.85 : -0.85);
        shot.pitch = 0.07 + Math.random() * 0.05;
        shot.distance = Math.min(150, Math.max(60, L * 1.8));
        shot.lift = 3;
        shot.spin = (toBow >= 0 ? -1 : 1) * 0.035;
        shot.min = 3.5;
        shot.max = 6.5;
        break;
      }
      case 'shell': {
        shot.yaw = Math.atan2(-c.dz, -c.dx) + side * 0.55;
        shot.pitch = 0.1;
        shot.distance = 34;
        shot.rate = 3;
        shot.min = 2.2;
        shot.max = 4.2;
        break;
      }
      case 'impact': {
        const toward = c.dx || c.dz ? Math.atan2(-c.dz, -c.dx) + side * 0.8 : (ship?.heading ?? 0) + Math.PI / 2 * side;
        shot.yaw = toward;
        shot.pitch = 0.11;
        shot.distance = Math.min(120, Math.max(48, L * 1.2));
        shot.lift = 3;
        shot.spin = side * 0.05;
        shot.min = 2.2;
        shot.max = 3.2;
        break;
      }
      case 'explosion':
      case 'sinking': {
        shot.yaw = this.sunSide();
        shot.pitch = 0.1;
        shot.distance = Math.min(240, Math.max(90, L * (c.kind === 'explosion' ? 2.2 : 2.6)));
        shot.lift = 4;
        shot.spin = side * 0.06;
        shot.min = c.kind === 'explosion' ? 3.2 : 4.5;
        shot.max = c.kind === 'explosion' ? 4.5 : 8;
        break;
      }
      case 'boarding': {
        shot.yaw = (ship?.heading ?? 0) + (Math.PI / 2) * side;
        shot.pitch = 0.32;
        const other = battle.get(c.other ?? 0);
        const gap = ship && other ? Math.hypot(ship.x - other.x, ship.z - other.z) : 0;
        shot.distance = Math.min(150, Math.max(60, L * 1.7, gap * 1.2 + 30));
        shot.lift = 3;
        shot.spin = side * 0.12;
        shot.min = 6;
        shot.max = 14;
        break;
      }
      case 'wide':
        this.composeWide(shot);
        break;
    }
    this.shot = shot;
    this.touch(c.kind, c.ship);
    rts.rate = shot.rate;
    this.aim(shot);
    if (c.kind !== 'shell') shot.yaw = this.clearest(rts.goal.tx, rts.goal.tz, shot.distance * Math.cos(shot.pitch), shot.yaw, [c.ship, c.other ?? 0]);
    rts.setPose({ tx: rts.goal.tx, tz: rts.goal.tz, yaw: shot.yaw, pitch: shot.pitch, distance: shot.distance }, true);
    rts.lookLift = shot.lift;
  }

  /** What to show when nothing is queued: the busiest gun line, else the two ships at the front of the fight. */
  private ambient(): Candidate | null {
    const b = this.host.battle;
    let best: { id: number; v: number; dx: number; dz: number } | null = null;
    for (const [id, l] of this.load) if (l.v > 0.9 && b.isActive(b.get(id)) && (!best || l.v > best.v)) best = { id, v: l.v, dx: l.dx, dz: l.dz };
    if (best && this.cooled('broadside', best.id, 8)) {
      const s = b.get(best.id)!;
      const n = Math.hypot(best.dx, best.dz) || 1;
      return { kind: 'broadside', priority: 3, ship: s.id, x: s.x, z: s.z, dx: best.dx / n, dz: best.dz / n, ttl: 1 };
    }
    const active = b.ships.filter((s) => b.isActive(s));
    const subject = active.sort((p, q) => q.lastHit - p.lastHit)[0];
    if (!subject) return null;
    return { kind: 'wide', priority: 1, ship: subject.id, x: subject.x, z: subject.z, dx: 0, dz: 0, ttl: 1 };
  }

  /**
   * Of a few angles around `yaw`, the one whose camera spot and line of sight to the target have the most room, so a
   * crowded fleet does not put the lens inside another hull. Angles near the wanted one are preferred.
   */
  private clearest(cx: number, cz: number, reach: number, yaw: number, ignore: number[]) {
    const ships = this.host.battle.ships.filter((s) => s.alive && !ignore.includes(s.id) && Math.hypot(s.x - cx, s.z - cz) < reach + 60);
    let best = yaw;
    let bestScore = -Infinity;
    for (const off of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.3, -1.3]) {
      const a = yaw + off;
      const dx = Math.cos(a) * reach;
      const dz = Math.sin(a) * reach;
      let room = 40;
      for (const s of ships) {
        // Distance from the ship to the camera's line of sight, less a rough hull radius.
        const t = Math.min(1, Math.max(0, ((s.x - cx) * dx + (s.z - cz) * dz) / (reach * reach)));
        room = Math.min(room, Math.hypot(s.x - cx - dx * t, s.z - cz - dz * t) - Math.max(s.spec.beam, s.spec.length * 0.3));
      }
      const score = Math.min(room, 40) - Math.abs(off) * 8;
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  /** A camera yaw that puts the sun behind the camera, so the subject is lit. */
  private sunSide() {
    const sun = atmosphere.sunDir.value as Vector3;
    return Math.atan2(sun.z, sun.x) + (Math.random() - 0.5) * 0.9;
  }

  /** Sets the goal point the shot looks at this frame. */
  private aim(s: Shot) {
    const { rts, battle } = this.host;
    const g = rts.goal;
    const ship = battle.get(s.ship);
    switch (s.kind) {
      case 'broadside': {
        if (!ship) return;
        g.tx = ship.x;
        g.tz = ship.z;
        break;
      }
      case 'shell': {
        const p = s.landed ? null : battle.projectiles.find((q) => q.id === s.proj);
        if (p) {
          const n = Math.hypot(p.vx, p.vz) || 1;
          g.tx = p.x + (p.vx / n) * 8;
          g.tz = p.z + (p.vz / n) * 8;
          s.lift = Math.max(0, p.y + this.host.fx.liftOf(p) - 2);
        } else if (s.landed) {
          g.tx = s.landed.x;
          g.tz = s.landed.z;
          s.lift = 3;
          s.rate = 1.5;
          s.distance = 60;
          rts.rate = s.rate;
        } else if (s.age > 0.5) s.max = Math.min(s.max, s.age + 0.6);
        break;
      }
      case 'impact': {
        g.tx = s.x;
        g.tz = s.z;
        break;
      }
      case 'explosion':
      case 'sinking': {
        if (ship) {
          s.x = ship.x;
          s.z = ship.z;
        }
        g.tx = s.x;
        g.tz = s.z;
        break;
      }
      case 'boarding': {
        const a = battle.get(s.ship);
        const o = battle.get(s.other);
        if (a && o) {
          g.tx = (a.x + o.x) / 2;
          g.tz = (a.z + o.z) / 2;
        } else if (a) {
          g.tx = a.x;
          g.tz = a.z;
        }
        break;
      }
      case 'wide': {
        const subject = ship;
        if (!subject) return;
        let other = battle.get(subject.targetId);
        if (!other || !other.alive) other = this.nearestFoe(subject);
        if (other) {
          const dx = other.x - subject.x;
          const dz = other.z - subject.z;
          const d = Math.hypot(dx, dz);
          const k = Math.min(0.32, 60 / Math.max(1, d));
          g.tx = subject.x + dx * k;
          g.tz = subject.z + dz * k;
        } else {
          g.tx = subject.x;
          g.tz = subject.z;
        }
        break;
      }
    }
  }

  private nearestFoe(from: Ship) {
    let best = Infinity;
    let found: Ship | undefined;
    for (const s of this.host.battle.ships) {
      if (!s.alive || s.team === from.team) continue;
      const d = Math.hypot(s.x - from.x, s.z - from.z);
      if (d < best) {
        best = d;
        found = s;
      }
    }
    return found;
  }

  private drive(s: Shot, dt: number) {
    const { rts } = this.host;
    this.aim(s);
    s.yaw += s.spin * dt;
    const g = rts.goal;
    g.yaw = s.yaw;
    g.pitch = s.kind === 'sinking' || s.kind === 'explosion' ? Math.min(0.22, s.pitch + s.age * 0.01) : s.pitch;
    g.distance = s.kind === 'broadside' || s.kind === 'impact' ? s.distance * (1 + Math.min(1, s.age / s.max) * 0.1) : s.distance;
    rts.lookLift += (s.lift - rts.lookLift) * (1 - Math.exp(-dt * 4));
  }

  /** Frames two ships broadside-on with the light behind the camera, as the old auto camera did. */
  private composeWide(s: Shot) {
    const { battle } = this.host;
    const subject = battle.get(s.ship);
    if (!subject) return;
    let other = battle.get(subject.targetId);
    if (!other || !other.alive) other = this.nearestFoe(subject);
    const sun = atmosphere.sunDir.value as Vector3;
    s.min = 5;
    s.max = 8 + Math.random() * 3;
    s.pitch = 0.05 + Math.random() * 0.09;
    s.spin = (Math.random() < 0.5 ? -1 : 1) * 0.03;
    if (!other) {
      s.distance = 160;
      return;
    }
    const dx = other.x - subject.x;
    const dz = other.z - subject.z;
    const d = Math.hypot(dx, dz);
    const line = Math.atan2(dz, dx);
    s.distance = Math.min(260, Math.max(90, d * 0.45));
    const y1 = line + Math.PI / 2 + (Math.random() - 0.5) * 0.7;
    const y2 = line - Math.PI / 2 + (Math.random() - 0.5) * 0.7;
    const s1 = Math.cos(y1) * sun.x + Math.sin(y1) * sun.z;
    const s2 = Math.cos(y2) * sun.x + Math.sin(y2) * sun.z;
    s.yaw = (s1 > s2) === Math.random() < 0.8 ? y1 : y2;
  }
}
