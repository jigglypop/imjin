import { Frustum, Group, Matrix4, PointLight, Sphere, Vector3, type Camera } from 'three/webgpu';
import type { Battle } from '../sim/battle';
import type { AmmoType, BattleEvent, GunType, Projectile, Ship } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { waveField } from '../ocean/waves';
import { ParticleLayer, StreakLayer } from './ParticleLayer';
import { DebrisField, Piece } from './Debris';
import { gunClass } from './gunClass';
import { arcPeak, timeToImpact } from './flight';
import { Munitions, Shell, shellKind, type ShellKind, type Trail } from './Projectiles';
import { anchorsFor } from '../ships/anchors';
import { DECKS, mainDeck } from '../ships/decks';
import { planSinking, type CueKind, type SinkCue } from './sinkPlan';
import { CREW_RANGE } from './crewTypes';
import type { WakeMap } from '../ocean/WakeMap';
import { LIGHT_COUNT, pointLights } from '../render/lights';
import type { ParticleQuality } from '../game/quality';

const OARS: Record<string, number> = { panokseon: 8, geobukseon: 8, atakebune: 13, sekibune: 11 };
const MASTS: Record<string, number> = { panokseon: 2, geobukseon: 1, hyeopseon: 1, atakebune: 2, sekibune: 1, kobaya: 1, mingship: 3, mingsmall: 1 };
/** Where the masts stand along the hull, as fractions of the length. */
const MAST_AT = [-0.22, 0.14, 0.34];

export type EffectsQuality = { lights: number; particles: ParticleQuality };

type LightSource = {
  x: number;
  y: number;
  z: number;
  intensity: number;
  decay: number;
  r: number;
  g: number;
  b: number;
  age: number;
  life: number;
  dist: number;
  /** Lives for one lighting pass whatever the sim clock does (it stands still while paused). */
  once?: boolean;
  score?: number;
};
/**
 * A shell in flight as drawn: where its smoke trail was last laid (on the drawn arc), the flight time the sim will
 * give it before a hull, the shore or the sea ends it, and the peak of the arc it is lifted onto.
 */
type Flight = { x: number; y: number; z: number; seen: number; end: number; peak: number; next: number; ghost: number; ref: Projectile | null; kind: ShellKind; seed: number };
/** Seconds a shell the sim ended early takes to settle from its lifted arc onto the sim's point. */
const SETTLE = 0.12;
/** A ship going down: its script and the running parts of the sinking effects. */
type SinkState = { plan: SinkCue[]; next: number; bubbles: number; slick: number; bubbleUntil: number };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Effects {
  readonly group = new Group();
  readonly smoke: ParticleLayer;
  readonly fire: ParticleLayer;
  readonly spray: ParticleLayer;
  /** Sparks and glowing embers: velocity-aligned additive streaks, plus the soft smear of a flying ball. */
  readonly streaks: StreakLayer;
  private readonly lightCount: number;
  private readonly debris: DebrisField;
  private readonly mun: Munitions;
  private readonly camPos = new Vector3();
  onShake: ((amount: number) => void) | null = null;
  /** Sinking cues (see sinkPlan.ts) for the sound: kind, world position, 0..1 size. */
  onCue: ((kind: CueKind, x: number, y: number, z: number, size: number) => void) | null = null;
  private readonly lights: PointLight[] = [];
  private readonly sources: LightSource[] = [];
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly p = new Vector3();
  private emitAccum = new Map<number, number>();
  /** Turtle ships: how hard the dragon's mouth is smoking (1 right after the bow gun fired) and its emission carry-over. */
  private readonly dragon = new Map<number, { blast: number; acc: number }>();
  private strokes = new Map<number, number>();
  /** The camera of the last frame, the frustum and the scratch sphere the oar splashes are culled with. */
  private rowCam: Camera | null = null;
  private readonly rowFrustum = new Frustum();
  private readonly rowClip = new Matrix4();
  private readonly rowBall = new Sphere();
  private readonly flights = new Map<number, Flight>();
  private readonly flightPool: Flight[] = [];
  /** Shells that ended while still lifted above their sim path (a hit earlier than predicted, a server event): they settle down. */
  private readonly ghosts: Projectile[] = [];
  /** Ship seconds per shell second: above 1 in a multiplayer battle while the server skips the approach. */
  shipRate = 1;
  private readonly seaAt = (x: number, z: number) => waveField.heightAt(x, z, waveField.time, 8);
  private readonly sinks = new Map<number, SinkState>();
  private frame = 0;
  /** Equipment class: how big the pools are (1 PC, less on tablets and phones). */
  private readonly tier: number;
  /** Run-time emission scale from the quality level. */
  private k: number;
  wake: WakeMap | null = null;
  readonly lightPos = pointLights.pos;
  readonly lightCol = pointLights.col;
  windX = 2.4;
  windZ = 1.6;
  night = 0;

  constructor(private readonly views: ShipViews, quality: EffectsQuality) {
    // Capacities leave headroom above the level 4 emission rate, so the layers do not saturate in a big battle.
    this.smoke = new ParticleLayer('smoke', 12000, quality.particles);
    this.fire = new ParticleLayer('fire', 8000, quality.particles);
    this.spray = new ParticleLayer('spray', 6000, quality.particles);
    this.lightCount = quality.lights;
    this.tier = quality.lights >= 8 ? 1 : quality.lights >= 6 ? 0.7 : 0.45;
    this.k = Math.min(1.25, Math.max(0.4, quality.particles.keep));
    this.streaks = new StreakLayer(Math.round(1200 * this.tier), Math.round(1700 * this.tier), quality.particles);
    this.debris = new DebrisField(Math.round(900 * this.tier));
    // Lights past the active count stay dark so the surface shader's light loop adds nothing for them.
    for (let i = this.lightCount; i < LIGHT_COUNT; i += 1) this.lightPos[i]!.w = 0;
    this.mun = new Munitions(views, this.smoke, this.fire, this.streaks, this.tier);
    this.mun.setKeep(this.k);
    this.mun.onLand = this.onRocketLand;
    for (let i = 0; i < this.lightCount; i += 1) {
      const l = new PointLight(0xffaa55, 0, 160, 1.6);
      l.castShadow = false;
      this.lights.push(l);
      this.group.add(l);
    }
    this.group.add(this.smoke.sprite, this.fire.sprite, this.spray.sprite, this.streaks.sprite, this.debris.group, this.mun.group);
  }

  /** Run-time emission rate for all particle layers. See ParticleLayer.setKeep. */
  setParticleKeep(keep: number) {
    this.k = Math.min(1.25, Math.max(0.4, keep));
    this.smoke.setKeep(keep);
    this.fire.setKeep(keep);
    this.spray.setKeep(keep);
    this.streaks.setKeep(keep);
    this.mun.setKeep(this.k);
  }

  /** A count scaled to the quality level (at least 1). */
  private n(count: number) {
    return Math.max(1, Math.round(count * this.k));
  }

  lantern(x: number, y: number, z: number, intensity: number) {
    this.sources.push({ x, y, z, intensity, decay: 1, r: 1, g: 0.6, b: 0.27, age: 0, life: 1, dist: 70, once: true });
  }

  private light(x: number, y: number, z: number, intensity: number, life: number, r = 1, g = 0.62, b = 0.3, dist = 140) {
    this.sources.push({ x, y, z, intensity, decay: 1, r, g, b, age: 0, life, dist });
  }

  /** A new battle starts on this engine: ship and shell ids restart, so the old battle's per-id state must not carry over. */
  newBattle() {
    this.emitAccum.clear();
    this.dragon.clear();
    this.strokes.clear();
    this.sinks.clear();
    for (const f of this.flights.values()) this.flightPool.push(f);
    this.flights.clear();
    this.ghosts.length = 0;
    this.mun.clear();
  }

  handle(events: BattleEvent[], battle: Battle) {
    for (const e of events) {
      switch (e.type) {
        case 'gun': {
          this.gun(e.x, e.y, e.z, e.dx, e.dy, e.dz, e.big, e.gun);
          const ship = battle.get(e.ship);
          const mouth = ship?.spec.kind === 'geobukseon' ? this.dragon.get(ship.id) : undefined;
          if (ship && mouth && e.dx * Math.cos(ship.heading) + e.dz * Math.sin(ship.heading) > 0.9) mouth.blast = 1;
          break;
        }
        case 'musket':
          this.musket(e.ship, e.dx, e.dz, e.count, e.arms === 'bow', battle);
          break;
        case 'hit': {
          const shell = this.flights.get(e.proj)?.ref;
          this.hit(e.x, e.y, e.z, e.damage, e.ammo, shell ? shellKind(shell.ammo, shell.gun) : e.ammo === 'fire' ? Shell.Hiya : Shell.Ball);
          if (shell && (e.ammo === 'arrow' || e.ammo === 'fire')) this.stickArrow(e.ship, e.x, e.y, e.z, shell, battle);
          this.views.flash(e.ship);
          break;
        }
        case 'ground':
          this.ground(e.x, e.y, e.z);
          break;
        case 'splash': {
          // A rocket arrow is a thin thing: it throws up a small plume.
          const kind = this.flights.get(e.proj)?.kind;
          this.splash(e.x, e.z, kind === Shell.Rocket || kind === Shell.Lance ? e.size * 0.55 : e.size);
          break;
        }
        case 'explode':
          this.explode(e.ship, battle);
          break;
        case 'ignite':
          this.ignite(e.ship, battle);
          break;
        case 'ram':
          this.ram(e.x, e.z, e.power);
          break;
        case 'sinking': {
          const ship = battle.get(e.ship);
          if (ship) this.beginSink(ship);
          break;
        }
        case 'removed':
          this.dragon.delete(e.ship);
          this.finishSink(e.ship, battle);
          break;
        default:
          break;
      }
    }
  }

  private shakeAt(x: number, y: number, z: number, strength: number) {
    const d = this.camPos.distanceTo(this.v.set(x, y, z));
    const k = strength / (1 + (d / 90) ** 2);
    if (k > 0.02) this.onShake?.(k);
  }

  /** Streaks and glow shrink to nothing when the camera is far; widen them with distance so they still read. */
  private zoomBoost(x: number, y: number, z: number) {
    return Math.min(5, Math.max(1, this.camPos.distanceTo(this.v.set(x, y, z)) / 160));
  }

  gun(x: number, y: number, z: number, dx: number, dy: number, dz: number, big: boolean, type?: GunType) {
    const w = gunClass(type, big).weight;
    const scale = 0.55 + 0.6 * w;
    const flames = Math.round(8 + 10 * w);
    for (let i = 0; i < flames; i += 1) {
      const f = i / flames;
      const sp = 18 + f * 70;
      const spread = 2 + f * 5;
      this.fire.emit({ x: x + dx * (0.6 + f * 1.2), y: y + dy * (0.6 + f), z: z + dz * (0.6 + f * 1.2), vx: dx * sp + rnd(-spread, spread), vy: dy * sp + rnd(-spread, spread) * 0.6, vz: dz * sp + rnd(-spread, spread), life: rnd(0.07, 0.2) * (1 - f * 0.4), size0: (4.5 - f * 2.2) * scale, size1: (7.5 - f * 3) * scale, alpha: 1, heat: 1 - f * 0.3, drag: 7, wind: 0 });
    }
    this.fire.emit({ x: x + dx * 1.5, y: y + dy * 1.5, z: z + dz * 1.5, life: 0.06, size0: 7 * scale, size1: 10 * scale, alpha: 1, heat: 1, drag: 8, wind: 0 });
    if (w > 0.6) {
      // The fireball of a heavy gun: a few large, brief blooms a little way off the muzzle.
      for (let i = 0; i < 3; i += 1) this.fire.emit({ x: x + dx * (3 + i * 2.4), y: y + dy * (3 + i * 2.4) + 0.3, z: z + dz * (3 + i * 2.4), vx: dx * 30, vy: dy * 30 + 1, vz: dz * 30, life: rnd(0.1, 0.16), size0: 4 * scale, size1: 8 * scale, alpha: 0.55, heat: 0.9, drag: 5, wind: 0 });
    }
    for (let i = 0; i < this.n(8 + 8 * w); i += 1) {
      const sp = rnd(25, 70);
      this.fire.emit({ x, y, z, vx: dx * sp + rnd(-6, 6), vy: dy * sp + rnd(0, 8), vz: dz * sp + rnd(-6, 6), life: rnd(0.5, 1.4), size0: 0.28, size1: 0.1, heat: 1, drag: 0.8, lift: -6, wind: 0.2 });
    }
    // Burning powder streaking out of the bore in a narrow fan.
    const boost = this.zoomBoost(x, y, z);
    for (let i = 0; i < this.n(12 + 24 * w); i += 1) {
      const sp = rnd(45, 150);
      const fan = 0.22;
      this.streaks.emit({
        x: x + dx * 0.8,
        y: y + dy * 0.8,
        z: z + dz * 0.8,
        vx: dx * sp + rnd(-fan, fan) * sp * 0.5,
        vy: dy * sp + rnd(-fan, fan) * sp * 0.5,
        vz: dz * sp + rnd(-fan, fan) * sp * 0.5,
        life: rnd(0.12, 0.4),
        minLen: 0.6,
        stretch: 0.03,
        width: (0.1 + 0.14 * w) * boost,
        r: 1,
        g: rnd(0.55, 0.8),
        b: rnd(0.2, 0.4),
        gravity: 6,
        drag: 0.9,
      });
    }
    const px = -dz;
    const pz = dx;
    const ring = Math.round(10 + 8 * w);
    for (let i = 0; i < ring; i += 1) {
      const a = (i / ring) * Math.PI * 2;
      const ux = px * Math.cos(a);
      const uy = Math.sin(a);
      const uz = pz * Math.cos(a);
      const sp = rnd(9, 16) * scale;
      this.smoke.emit({ x: x + dx * 2.2, y: y + dy * 2, z: z + dz * 2.2, vx: ux * sp + dx * 7, vy: uy * sp * 0.7 + 0.5, vz: uz * sp + dz * 7, life: rnd(5, 9), size0: 1.6 * scale, size1: rnd(8, 12) * scale, alpha: 0.7, r: 0.93, g: 0.92, b: 0.9, drag: 2.6, lift: 0.18, wind: 1 });
    }
    // A fast jet of dark powder smoke straight out of the muzzle.
    for (let i = 0; i < Math.round(3 + 4 * w); i += 1) {
      const sp = rnd(30, 60);
      this.smoke.emit({ x: x + dx * 1.2, y: y + dy * 1.2, z: z + dz * 1.2, vx: dx * sp, vy: dy * sp + 0.3, vz: dz * sp, life: rnd(3, 6), size0: 1.2 * scale, size1: rnd(6, 10) * scale, alpha: 0.6, r: 0.3, g: 0.29, b: 0.28, drag: 3.2, lift: 0.15, wind: 1, heat: 0.3 });
    }
    if (w > 0.45) {
      const h = waveField.heightAt(x, z, waveField.time, 6);
      for (let i = 0; i < 14; i += 1) {
        const a = Math.random() * Math.PI * 2;
        this.spray.emit({ x: x + dx * 5 + Math.cos(a) * 2, y: h + 0.2, z: z + dz * 5 + Math.sin(a) * 2, vx: Math.cos(a) * rnd(2, 6) + dx * 6, vy: rnd(1.5, 4), vz: Math.sin(a) * rnd(2, 6) + dz * 6, life: rnd(0.8, 1.4), size0: 0.8, size1: rnd(2.5, 4), alpha: 0.55, r: 0.95, g: 0.97, b: 1, drag: 0.8, lift: -9.8, wind: 0.2 });
      }
      // The blast's pressure flattens the sea in front of the muzzle.
      this.wake?.stamp(x + dx * 6, z + dz * 6, Math.atan2(dz, dx), 9 + 5 * w, 0.5 + 0.3 * w, 1, 1.2);
    }
    this.shakeAt(x, y, z, 0.2 + 0.4 * w);
    const puffs = Math.round(11 + 11 * w);
    for (let i = 0; i < puffs; i += 1) {
      const sp = rnd(4, 26) * scale;
      const gray = rnd(0.78, 0.92);
      this.smoke.emit({
        x: x + dx * rnd(0.5, 3),
        y: y + rnd(-0.3, 0.6),
        z: z + dz * rnd(0.5, 3),
        vx: dx * sp + rnd(-1.5, 1.5),
        vy: dy * sp + rnd(0, 1.5),
        vz: dz * sp + rnd(-1.5, 1.5),
        life: rnd(12, 24),
        size0: rnd(2, 3.5) * scale,
        size1: rnd(14, 26) * scale,
        alpha: rnd(0.55, 0.8),
        r: gray,
        g: gray,
        b: gray * 0.98,
        drag: 1.1,
        lift: 0.22,
        wind: 1,
        heat: i < 3 ? 0.6 : 0,
      });
    }
    this.light(x + dx * 3, y + 1, z + dz * 3, 6500 + 9500 * w, 0.2, 1, 0.68, 0.36, 120 + 60 * w);
  }

  /** Far volleys only: where the crew is drawn its shooters make their own flashes and smoke, and a bow makes none. */
  musket(id: number, dx: number, dz: number, count: number, bow: boolean, battle: Battle) {
    const ship = battle.get(id);
    if (!ship || bow || Math.hypot(ship.x - this.camPos.x, this.camPos.y, ship.z - this.camPos.z) < CREW_RANGE) return;
    const L = ship.spec.length;
    const side = (-dx * Math.sin(ship.heading) + dz * Math.cos(ship.heading)) > 0 ? 1 : -1;
    for (let i = 0; i < count; i += 1) {
      const along = rnd(-0.4, 0.4) * L;
      this.views.localToWorld(id, along, this.deckOf(ship) + rnd(0.6, 1.6), side * ship.spec.beam * 0.5, this.p);
      const delay = rnd(0, 0.5);
      this.fire.emit({ x: this.p.x, y: this.p.y, z: this.p.z, vx: dx * 12, vy: 0, vz: dz * 12, life: 0.05 + delay * 0.1, size0: 0.9, size1: 1.4, heat: 1, drag: 10, wind: 0 });
      this.smoke.emit({ x: this.p.x, y: this.p.y, z: this.p.z, vx: dx * rnd(3, 9), vy: rnd(0, 1), vz: dz * rnd(3, 9), life: rnd(4, 8), size0: 0.5, size1: rnd(3.5, 6), alpha: 0.55, r: 0.86, g: 0.86, b: 0.84, drag: 1.4, lift: 0.18 });
    }
  }

  /** Planking, splinters and charred lumps thrown out from a point, `power` 1 being a round shot's hit. */
  private shatter(x: number, y: number, z: number, count: number, power: number, spread: number) {
    for (let i = 0; i < count; i += 1) {
      const r = Math.random();
      const vx = rnd(-spread, spread);
      const vz = rnd(-spread, spread);
      if (i < 2) {
        const s = rnd(1.3, 2.4) * power;
        this.debris.spawn(Piece.Plank, x, y, z, vx * 0.7, rnd(4, 15), vz * 0.7, s, s * 1.3, s * 1.3, rnd(14, 26));
      } else if (r < 0.5) {
        this.debris.spawn(Piece.Splinter, x, y, z, vx * 1.3, rnd(5, 19), vz * 1.3, rnd(0.9, 2.8) * power, rnd(1.4, 2.4), rnd(1.4, 2.4), rnd(10, 20), 1.6);
      } else if (r < 0.82) {
        const s = rnd(0.45, 1.2) * power;
        this.debris.spawn(Piece.Plank, x, y, z, vx, rnd(4, 17), vz, s, s, s, rnd(14, 26));
      } else {
        const s = rnd(0.4, 1.1) * power;
        this.debris.spawn(Piece.Chunk, x, y, z, vx * 0.8, rnd(3, 13), vz * 0.8, s, s, s, rnd(10, 18));
      }
    }
  }

  private sparks(x: number, y: number, z: number, count: number, speed: number, up: number) {
    const boost = this.zoomBoost(x, y, z);
    for (let i = 0; i < this.n(count); i += 1) {
      this.streaks.emit({ x, y, z, vx: rnd(-1, 1) * speed, vy: rnd(0.1, 1) * up + 2, vz: rnd(-1, 1) * speed, life: rnd(0.25, 0.7), minLen: 0.3, stretch: 0.035, width: 0.13 * boost, r: 1, g: rnd(0.5, 0.75), b: rnd(0.15, 0.3), gravity: 20, drag: 0.4 });
    }
  }

  /** An arrow that struck a hull stays in it for a while. */
  private stickArrow(ship: number, x: number, y: number, z: number, shell: Projectile, battle: Battle) {
    const kind = shellKind(shell.ammo, shell.gun);
    if (kind !== Shell.Heavy && kind !== Shell.Hiya) return;
    const sp = Math.hypot(shell.vx, shell.vy, shell.vz) || 1;
    this.mun.stick(ship, x, y, z, shell.vx / sp, shell.vy / sp, shell.vz / sp, shell.gun, kind === Shell.Heavy ? 0 : 1, battle);
  }

  /** A rocket came down on a deck, or into the sea beside the ship: the rockets of a salvo that the sim does not count. */
  private readonly onRocketLand = (x: number, y: number, z: number, hull: boolean) => {
    if (!hull) {
      this.splash(x, z, 0.4);
      return;
    }
    this.rocketBurst(x, y, z, 0.7);
  };

  /** A rocket's charge going off on a hit: small puffs of fire, sparks and a bit of dark smoke, no splinters to speak of. */
  private rocketBurst(x: number, y: number, z: number, scale: number) {
    for (let i = 0; i < this.n(7); i += 1) {
      this.fire.emit({ x: x + rnd(-0.6, 0.6), y: y + rnd(0, 0.8), z: z + rnd(-0.6, 0.6), vx: rnd(-3, 3), vy: rnd(1.5, 5), vz: rnd(-3, 3), life: rnd(0.25, 0.7), size0: rnd(1, 1.9) * scale, size1: rnd(2.2, 3.6) * scale, heat: rnd(0.7, 1), drag: 2, lift: 2, wind: 0.4, alpha: 0.9 });
    }
    this.fire.emit({ x, y: y + 0.4, z, life: 0.1, size0: 2.2 * scale, size1: 4 * scale, heat: 1, drag: 4, wind: 0 });
    for (let i = 0; i < 3; i += 1) {
      this.smoke.emit({ x, y: y + 0.5, z, vx: rnd(-2, 2), vy: rnd(1, 3.5), vz: rnd(-2, 2), life: rnd(3, 6), size0: 0.9, size1: rnd(3.5, 6) * scale, alpha: 0.4, r: 0.4, g: 0.38, b: 0.35, drag: 1.4, lift: 0.3, wind: 0.8 });
    }
    this.sparks(x, y + 0.3, z, 12 * scale, 14, 14);
    this.light(x, y + 1, z, 1800 * scale, 0.14, 1, 0.6, 0.25, 90);
  }

  hit(x: number, y: number, z: number, damage: number, ammo: AmmoType = 'ball', kind: ShellKind = Shell.Ball) {
    // A rocket arrow bursts in small puffs of fire, a fire arrow (hiya) leaves a bit of flame: neither tears the planking like a shot.
    if (kind === Shell.Rocket || kind === Shell.Lance) {
      this.shatter(x, y, z, this.n(3 + damage * 0.5), 0.55, 6);
      this.rocketBurst(x, y, z, kind === Shell.Rocket ? 1 : 0.7);
      this.shakeAt(x, y, z, 0.12 + damage * 0.01);
      return;
    }
    // A heavy arrow (daejanggun-jeon) is a log of oak with an iron head: more timber, bigger pieces.
    const power = ammo === 'arrow' ? 1.35 : 1;
    this.shatter(x, y, z, this.n((10 + damage * 1.8) * power), power, 12);
    for (let i = 0; i < 9; i += 1) {
      this.smoke.emit({ x, y, z, vx: rnd(-6, 6), vy: rnd(1, 7), vz: rnd(-6, 6), life: rnd(3, 7), size0: 1.2, size1: rnd(6, 11), alpha: 0.55, r: 0.5, g: 0.42, b: 0.32, drag: 1.8, lift: 0.3 });
    }
    this.sparks(x, y, z, 14 + damage * 0.9, 24, 26);
    // Pale wood dust billowing off the struck planks.
    for (let i = 0; i < 5; i += 1) {
      this.smoke.emit({ x, y, z, vx: rnd(-5, 5), vy: rnd(0.5, 4), vz: rnd(-5, 5), life: rnd(2, 4), size0: 1.5, size1: rnd(8, 14) * power, alpha: 0.5, r: 0.7, g: 0.6, b: 0.46, drag: 1.6, lift: 0.2, wind: 0.8 });
    }
    for (let i = 0; i < 6; i += 1) {
      this.fire.emit({ x, y, z, vx: rnd(-14, 14), vy: rnd(2, 12), vz: rnd(-14, 14), life: rnd(0.2, 0.6), size0: 0.22, size1: 0.08, heat: 1, drag: 1.5, lift: -8 });
    }
    this.fire.emit({ x, y, z, life: 0.12, size0: 3.5 * power, size1: 6 * power, heat: 1, drag: 4, wind: 0 });
    if (ammo === 'fire') {
      for (let i = 0; i < 12; i += 1) this.fire.emit({ x: x + rnd(-1, 1), y: y + rnd(0, 1.5), z: z + rnd(-1, 1), vx: rnd(-2, 2), vy: rnd(2, 6), vz: rnd(-2, 2), life: rnd(0.5, 1.2), size0: rnd(1.5, 3), size1: rnd(3, 5), heat: rnd(0.6, 1), drag: 1.5, lift: 2.5, wind: 0.5 });
    }
    this.light(x, y + 1, z, ammo === 'fire' ? 6000 : 3500, 0.16);
    this.shakeAt(x, y, z, 0.3 + damage * 0.02);
  }

  ground(x: number, y: number, z: number) {
    for (let i = 0; i < 18; i += 1) {
      this.smoke.emit({ x, y, z, vx: rnd(-5, 5), vy: rnd(3, 12), vz: rnd(-5, 5), life: rnd(3, 6), size0: 1.2, size1: rnd(5, 9), alpha: 0.6, r: 0.42, g: 0.36, b: 0.28, drag: 1.4, lift: -1.5, wind: 0.6 });
    }
    for (let i = 0; i < this.n(10); i += 1) {
      const s = rnd(0.35, 1);
      this.debris.spawn(Piece.Chunk, x, y + 0.5, z, rnd(-6, 6), rnd(5, 13), rnd(-6, 6), s, s, s, rnd(6, 12));
    }
    this.sparks(x, y + 0.3, z, 8, 12, 14);
    this.light(x, y + 1, z, 1800, 0.1);
  }

  splash(x: number, z: number, size: number) {
    const h = waveField.heightAt(x, z);
    for (let i = 0; i < Math.round(14 * size); i += 1) {
      this.spray.emit({ x: x + rnd(-0.6, 0.6), y: h + 0.3, z: z + rnd(-0.6, 0.6), vx: rnd(-0.8, 0.8), vy: rnd(14, 26) * size, vz: rnd(-0.8, 0.8), life: rnd(1.6, 2.6), size0: rnd(1, 1.8) * size, size1: rnd(3.5, 6) * size, alpha: rnd(0.6, 0.9), r: 0.95, g: 0.97, b: 1, drag: 0.25, lift: -9.8, wind: 0.25 });
    }
    const n = Math.round(26 * size);
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      this.spray.emit({
        x: x + Math.cos(a) * r * 1.2,
        y: h + 0.2,
        z: z + Math.sin(a) * r * 1.2,
        vx: Math.cos(a) * rnd(0.5, 4) * size,
        vy: rnd(7, 19) * size * (1 - r * 0.5),
        vz: Math.sin(a) * rnd(0.5, 4) * size,
        life: rnd(1.1, 2.4),
        size0: rnd(0.8, 1.6) * size,
        size1: rnd(2.5, 5) * size,
        alpha: rnd(0.55, 0.85),
        r: 0.94,
        g: 0.97,
        b: 1,
        drag: 0.35,
        lift: -9.8,
        wind: 0.3,
      });
    }
    for (let i = 0; i < 6; i += 1) {
      this.spray.emit({ x: x + rnd(-1, 1), y: h + 0.3, z: z + rnd(-1, 1), vx: rnd(-1, 1), vy: rnd(0.2, 1.2), vz: rnd(-1, 1), life: rnd(2, 3.5), size0: 2, size1: rnd(5, 8) * size, alpha: 0.4, r: 0.9, g: 0.95, b: 0.97, drag: 1.2, lift: 0, wind: 0.4 });
    }
    // Flung drops catch the light as short streaks, and a heavy shot leaves a ring on the sea.
    const boost = this.zoomBoost(x, h, z);
    for (let i = 0; i < this.n(8 * size); i += 1) {
      const a = Math.random() * Math.PI * 2;
      const out = rnd(1, 6) * size;
      this.streaks.emit({ x, y: h + 0.5, z, vx: Math.cos(a) * out, vy: rnd(8, 20) * size, vz: Math.sin(a) * out, life: rnd(0.8, 1.5), minLen: 0.3, stretch: 0.03, width: 0.11 * boost * size, r: 0.82, g: 0.9, b: 1, alpha: 0.55, gravity: 9.8, drag: 0.1 });
    }
    if (size > 0.9) this.wake?.stamp(x, z, 0, 5 * size, 0.6 * Math.min(1.5, size), 1, 1.3);
  }

  ram(x: number, z: number, power: number) {
    this.shatter(x, 3, z, this.n(26), 1.2, 8);
    this.splash(x, z, 0.9 + Math.min(1, power * 0.15));
  }

  /** Flames taking hold: a short flare-up over the deck. */
  ignite(id: number, battle: Battle) {
    const ship = battle.get(id);
    if (!ship) return;
    this.views.localToWorld(id, rnd(-0.2, 0.2) * ship.spec.length, this.deckOf(ship), 0, this.p);
    for (let i = 0; i < 10; i += 1) this.fire.emit({ x: this.p.x + rnd(-2, 2), y: this.p.y, z: this.p.z + rnd(-2, 2), vx: rnd(-1, 1), vy: rnd(3, 8), vz: rnd(-1, 1), life: rnd(0.5, 1.1), size0: 2, size1: rnd(4, 7), heat: rnd(0.6, 1), drag: 1.2, lift: 3, wind: 0.5 });
    this.light(this.p.x, this.p.y + 3, this.p.z, 12000, 0.5, 1, 0.5, 0.2, 200);
  }

  /** A blast: scale 1 is a magazine going up, 0.3 a cooking-off powder keg. */
  private blast(x: number, y: number, z: number, scale: number) {
    const nf = Math.max(6, Math.round(90 * scale * this.k));
    for (let i = 0; i < nf; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 1.2;
      const sp = rnd(6, 30) * (0.5 + scale * 0.5);
      this.fire.emit({ x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 4, vz: Math.sin(a) * Math.cos(e) * sp, life: rnd(0.5, 1.4), size0: rnd(4, 8) * (0.5 + scale * 0.5), size1: rnd(9, 16) * (0.5 + scale * 0.5), heat: rnd(0.6, 1), drag: 2.5, lift: 3, wind: 0.2 });
    }
    const ns = Math.max(4, Math.round(50 * scale * this.k));
    for (let i = 0; i < ns; i += 1) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit({ x, y: y + rnd(0, 6), z, vx: Math.cos(a) * rnd(3, 14), vy: rnd(3, 16), vz: Math.sin(a) * rnd(3, 14), life: rnd(14, 28), size0: rnd(5, 9) * (0.5 + scale * 0.5), size1: rnd(22, 38) * (0.4 + scale * 0.6), alpha: 0.85, r: 0.16, g: 0.14, b: 0.13, drag: 0.9, lift: 0.5, heat: 0.8 });
    }
    this.shatter(x, y + 2, z, this.n(70 * scale), 1.5 * (0.6 + scale * 0.4), 22 * (0.5 + scale * 0.5));
    this.sparks(x, y + 1, z, 60 * scale, 36, 40);
    this.light(x, y + 6, z, 220000 * scale ** 1.5, 0.5 + 0.9 * scale, 1, 0.55, 0.25, 250 + 350 * scale);
    this.shakeAt(x, y, z, 0.35 + 0.7 * scale);
  }

  explode(id: number, battle: Battle) {
    const ship = battle.get(id);
    if (!ship) return;
    this.views.localToWorld(id, rnd(-0.2, 0.2) * ship.spec.length, this.deckOf(ship), 0, this.p);
    const { x, y, z } = this.p;
    this.blast(x, y, z, 1);
    this.splash(x + rnd(-10, 10), z + rnd(-10, 10), 1.6);
  }

  // ---- A ship going down ----------------------------------------------------------------------------------------

  private beginSink(ship: Ship) {
    let st = this.sinks.get(ship.id);
    if (!st) {
      st = { plan: planSinking(ship.id, MASTS[ship.spec.kind] ?? 1, ship.spec.length), next: 0, bubbles: 0, slick: 0, bubbleUntil: 0 };
      this.sinks.set(ship.id, st);
    }
    return st;
  }

  private cue(kind: CueKind, x: number, y: number, z: number, size: number) {
    this.onCue?.(kind, x, y, z, size);
  }

  /** Runs one step of the sinking script and the always-on parts (bubbling and the oil slick). */
  private sinking(ship: Ship, dt: number) {
    const st = this.beginSink(ship);
    const p = ship.sinking;
    const L = ship.spec.length;
    while (st.next < st.plan.length && st.plan[st.next]!.at <= p) this.runCue(ship, st, st.plan[st.next++]!);
    if (dt <= 0) return;
    const hullBubbles = p > 0.5 || p < st.bubbleUntil;
    if (hullBubbles) {
      st.bubbles += (6 + 60 * smooth(0.5, 1, p)) * (L / 40) * this.k * dt;
      let guard = 24;
      while (st.bubbles >= 1 && guard-- > 0) {
        st.bubbles -= 1;
        const lx = rnd(-0.45, 0.45) * L;
        const lz = rnd(-0.5, 0.5) * ship.spec.beam;
        this.views.localToWorld(ship.id, lx, 0, lz, this.p);
        const h = waveField.heightAt(this.p.x, this.p.z);
        this.spray.emit({ x: this.p.x, y: h + 0.15, z: this.p.z, vx: rnd(-0.6, 0.6), vy: rnd(0.8, 2.6), vz: rnd(-0.6, 0.6), life: rnd(0.9, 1.8), size0: 0.5, size1: rnd(1.3, 2.4), alpha: 0.7, r: 0.95, g: 0.98, b: 1, drag: 1.2, lift: -3, wind: 0.2 });
      }
      if (st.bubbles > 8) st.bubbles = 0;
    }
    st.slick -= dt;
    if (st.slick <= 0) {
      st.slick = 0.45;
      this.wake?.stamp(ship.x, ship.z, ship.heading, L * 0.55, 0.35 + 0.35 * p, 1.6, 1.5);
    }
  }

  private runCue(ship: Ship, st: SinkState, c: SinkCue) {
    const L = ship.spec.length;
    const B = ship.spec.beam;
    const id = ship.id;
    const down = Math.sign(ship.sinkRoll) || 1;
    // The low side of the heeling hull: local +z, mirrored by the sign of the roll.
    const sideX = -Math.sin(ship.heading) * down;
    const sideZ = Math.cos(ship.heading) * down;
    this.views.localToWorld(id, 0, this.deckOf(ship), 0, this.p);
    const cx = this.p.x;
    const cy = this.p.y;
    const cz = this.p.z;
    switch (c.kind) {
      case 'groan':
      case 'crack': {
        if (c.kind === 'crack') {
          this.views.localToWorld(id, rnd(-0.4, 0.4) * L, this.deckOf(ship) + rnd(0, 1.5), rnd(-0.4, 0.4) * B, this.p);
          this.shatter(this.p.x, this.p.y, this.p.z, this.n(5 + 4 * c.size), 0.7, 5);
          this.sparks(this.p.x, this.p.y, this.p.z, 6, 8, 9);
          this.shakeAt(this.p.x, this.p.y, this.p.z, 0.1);
        }
        this.cue(c.kind, cx, cy, cz, c.size);
        break;
      }
      case 'wreck': {
        const count = this.n(Math.round((6 + 10 * c.size) * (0.45 + L / 60)) * this.tier);
        for (let i = 0; i < count; i += 1) {
          this.views.localToWorld(id, rnd(-0.42, 0.42) * L, this.deckOf(ship) + rnd(0, 1.2), rnd(-0.45, 0.45) * B, this.p);
          const out = rnd(1, 5);
          const vx = sideX * out + rnd(-2, 2);
          const vz = sideZ * out + rnd(-2, 2);
          const vy = rnd(1, 6);
          const life = rnd(26, 44);
          const ember = ship.fire > 0.2 && Math.random() < 0.4 ? 1 : 0;
          const r = Math.random();
          if (r < 0.34) {
            const s = rnd(0.8, 1.9);
            this.debris.spawn(Piece.Plank, this.p.x, this.p.y, this.p.z, vx, vy, vz, s * 1.6, s, s, life, 0.8, ember);
          } else if (r < 0.5) this.debris.spawn(Piece.Spar, this.p.x, this.p.y, this.p.z, vx, vy, vz, rnd(3, 7), 0.22, 0.22, life, 0.5, ember);
          else if (r < 0.7) this.debris.spawn(Piece.Sail, this.p.x, this.p.y, this.p.z, vx * 0.6, vy, vz * 0.6, rnd(3, 7), 1, rnd(2, 5), life, 0.4, ember);
          else if (r < 0.82) this.debris.spawn(Piece.Beam, this.p.x, this.p.y, this.p.z, vx, vy, vz, rnd(2, 4.5), 1, 1, life, 0.7, ember);
          else if (r < 0.92) this.debris.spawn(Piece.Barrel, this.p.x, this.p.y, this.p.z, vx, vy, vz, 1, 1, 1, life, 1, ember);
          else this.debris.spawn(Piece.Splinter, this.p.x, this.p.y, this.p.z, vx, vy, vz, rnd(1, 2.4), 1.6, 1.6, life, 1);
        }
        this.cue('wreck', cx, cy, cz, c.size);
        break;
      }
      case 'mast': {
        const i = Math.floor(rnd(0, Math.min(MAST_AT.length, MASTS[ship.spec.kind] ?? 1)));
        this.views.localToWorld(id, MAST_AT[i]! * L, this.deckOf(ship) + ship.spec.height * 0.45, 0, this.p);
        const len = ship.spec.height * rnd(0.7, 1.1);
        // The snapped mast topples toward the low side and takes a spar or two with it.
        this.debris.spawn(Piece.Mast, this.p.x, this.p.y, this.p.z, sideX * rnd(3, 7), rnd(2, 5), sideZ * rnd(3, 7), len, 0.7, 0.7, rnd(34, 52), 0.35);
        this.debris.spawn(Piece.Spar, this.p.x, this.p.y, this.p.z, sideX * rnd(3, 8), rnd(2, 6), sideZ * rnd(3, 8), len * 0.6, 0.3, 0.3, rnd(30, 46), 0.5);
        for (let k = 0; k < 4; k += 1) this.smoke.emit({ x: this.p.x, y: this.p.y, z: this.p.z, vx: rnd(-3, 3), vy: rnd(1, 5), vz: rnd(-3, 3), life: rnd(3, 6), size0: 1.5, size1: rnd(5, 8), alpha: 0.5, r: 0.5, g: 0.45, b: 0.4, drag: 1.5, lift: 0.3 });
        this.shatter(this.p.x, this.p.y, this.p.z, this.n(8), 0.9, 6);
        this.shakeAt(this.p.x, this.p.y, this.p.z, 0.3);
        this.cue('mast', this.p.x, this.p.y, this.p.z, c.size);
        break;
      }
      case 'blast': {
        if (ship.fire < 0.08) break;
        this.views.localToWorld(id, rnd(-0.3, 0.3) * L, this.deckOf(ship) + 1, rnd(-0.3, 0.3) * B, this.p);
        this.blast(this.p.x, this.p.y, this.p.z, 0.22 + 0.3 * c.size);
        this.cue('blast', this.p.x, this.p.y, this.p.z, c.size);
        break;
      }
      case 'bubbles':
        st.bubbleUntil = Math.max(st.bubbleUntil, c.at + 0.18);
        this.cue('bubbles', cx, 0, cz, c.size);
        break;
      case 'plunge':
        this.plunge(ship);
        this.cue('plunge', ship.x, 0, ship.z, 1);
        break;
    }
  }

  /** The hull going under: air escapes in a boiling burst and pieces that were trapped inside pop up. */
  private plunge(ship: Ship) {
    const L = ship.spec.length;
    const h = waveField.heightAt(ship.x, ship.z);
    for (let i = 0; i < this.n(36); i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * L * 0.3;
      this.spray.emit({ x: ship.x + Math.cos(a) * r, y: h + 0.2, z: ship.z + Math.sin(a) * r, vx: Math.cos(a) * rnd(0.5, 3), vy: rnd(6, 15), vz: Math.sin(a) * rnd(0.5, 3), life: rnd(1.2, 2.4), size0: 1.5, size1: rnd(4, 8), alpha: 0.75, r: 0.95, g: 0.98, b: 1, drag: 0.5, lift: -9.8, wind: 0.3 });
    }
    for (let i = 0; i < 3; i += 1) this.splash(ship.x + rnd(-0.3, 0.3) * L * Math.cos(ship.heading), ship.z + rnd(-0.3, 0.3) * L * Math.sin(ship.heading), 1.1);
    this.wake?.stamp(ship.x, ship.z, ship.heading, L * 0.9, 0.9, 1.2, 1.8);
    this.shakeAt(ship.x, 2, ship.z, 0.35);
  }

  /** The hull is gone: a last splash and the wreck it leaves on the water. */
  private finishSink(id: number, battle: Battle) {
    const st = this.sinks.get(id);
    if (!st) return;
    this.sinks.delete(id);
    const ship = battle.get(id);
    if (!ship) return;
    const L = ship.spec.length;
    const h = waveField.heightAt(ship.x, ship.z);
    // A frame can skip past the plan at high speed; the late cues still play.
    for (; st.next < st.plan.length; st.next += 1) {
      const c = st.plan[st.next]!;
      if (c.kind === 'plunge') {
        this.plunge(ship);
        this.cue('plunge', ship.x, 0, ship.z, 1);
      }
    }
    const size = Math.min(1.2, Math.max(0.4, L / 40));
    this.splash(ship.x, ship.z, 1.7 * size + 0.4);
    for (let i = 0; i < 3; i += 1) this.splash(ship.x + rnd(-0.35, 0.35) * L * Math.cos(ship.heading), ship.z + rnd(-0.35, 0.35) * L * Math.sin(ship.heading), 1.1);
    const count = this.n(Math.round(30 * size) * this.tier);
    const c = Math.cos(ship.heading);
    const n = Math.sin(ship.heading);
    for (let i = 0; i < count; i += 1) {
      const along = rnd(-0.45, 0.45) * L;
      const across = rnd(-0.5, 0.5) * ship.spec.beam;
      const x = ship.x + c * along - n * across;
      const z = ship.z + n * along + c * across;
      const life = rnd(24, 42);
      const vx = rnd(-3, 3);
      const vz = rnd(-3, 3);
      const vy = rnd(5, 12);
      const r = Math.random();
      const y = h - 0.5;
      if (r < 0.4) {
        const s = rnd(0.7, 1.7);
        this.debris.spawn(Piece.Plank, x, y, z, vx, vy, vz, s * 1.6, s, s, life, 0.8);
      } else if (r < 0.55) this.debris.spawn(Piece.Beam, x, y, z, vx, vy, vz, rnd(2, 5), 1, 1, life, 0.7);
      else if (r < 0.7) this.debris.spawn(Piece.Sail, x, y, z, vx * 0.6, vy, vz * 0.6, rnd(3, 6), 1, rnd(2, 4), life, 0.4);
      else if (r < 0.82) this.debris.spawn(Piece.Barrel, x, y, z, vx, vy, vz, 1, 1, 1, life, 1);
      else if (r < 0.92) this.debris.spawn(Piece.Spar, x, y, z, vx, vy, vz, rnd(3, 6), 0.22, 0.22, life, 0.5);
      else this.debris.spawn(Piece.Chunk, x, y, z, vx, vy, vz, 0.7, 0.7, 0.7, life, 1);
    }
    this.wake?.stamp(ship.x, ship.z, ship.heading, L * 1.1, 1, 1, 2);
    this.shakeAt(ship.x, 2, ship.z, 0.3);
    this.cue('gone', ship.x, 0, ship.z, size);
  }

  /**
   * Oar strokes and the bow wave. Only ships the camera can see are worked on, near ones in full and far ones sparsely,
   * and each stroke samples the sea once for the whole ship instead of once per oar. At high speeds a frame spans
   * seconds of battle, so the splashes (a second long) would be gone before they were drawn: those frames keep the
   * stroke clock running and skip the spray.
   */
  private rowing(battle: Battle, dt: number) {
    const camera = this.rowCam;
    if (camera) {
      this.rowClip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.rowFrustum.setFromProjectionMatrix(this.rowClip);
    }
    const detail = dt < 0.25;
    for (const ship of battle.ships) {
      if (!ship.alive || ship.sinking > 0 || ship.struck) continue;
      const speed = Math.abs(ship.speed);
      const L = ship.spec.length;
      let phase = this.strokes.get(ship.id) ?? Math.random();
      const rowers = speed >= 0.6 && ship.crew >= ship.spec.crew * 0.2;
      if (rowers) phase += dt / (L > 30 ? 2.8 : 2.2);
      const f = speed / ship.spec.maxSpeed;
      const stroke = rowers && phase >= 1;
      if (stroke) phase -= 1;
      if (rowers) this.strokes.set(ship.id, phase % 1);
      if (!detail || (!stroke && f <= 0.55)) continue;
      // Spray reaches a few metres past the hull; beyond 700 m a splash is under a pixel.
      const dist = this.camPos.distanceTo(this.v.set(ship.x, 0, ship.z));
      if (dist > 700) continue;
      if (camera) {
        this.rowBall.set(this.v, L * 0.6 + 12);
        if (!this.rowFrustum.intersectsSphere(this.rowBall)) continue;
      }
      const c = Math.cos(ship.heading);
      const n = Math.sin(ship.heading);
      const B = ship.spec.beam;
      const h = waveField.heightAt(ship.x, ship.z, waveField.time, 6);
      if (f > 0.55 && Math.random() < dt * 5 * f) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const bx = ship.x + c * L * 0.47 + n * B * 0.3 * side;
        const bz = ship.z + n * L * 0.47 - c * B * 0.3 * side;
        for (let i = 0; i < 5; i += 1) this.spray.emit({ x: bx, y: h + 0.3, z: bz, vx: c * speed * 0.6 + n * side * rnd(1.5, 4), vy: rnd(1.5, 4.5) * f, vz: n * speed * 0.6 - c * side * rnd(1.5, 4), life: rnd(0.6, 1.2), size0: 0.6, size1: rnd(1.6, 2.6), alpha: 0.6, r: 0.95, g: 0.97, b: 1, drag: 0.6, lift: -9.8, wind: 0.2 });
      }
      if (!stroke) continue;
      const oars = OARS[ship.spec.kind] ?? 8;
      // Past 250 m the oars read as one blur: every other one is enough, and no wake is stamped for them.
      const near = dist < 250;
      const skip = near ? 1 : 2;
      for (let i = 0; i < oars; i += skip) {
        const along = (-0.36 + (0.58 * i) / Math.max(1, oars - 1)) * L;
        for (const side of [1, -1]) {
          const out = B * 0.5 + 3.2;
          const ox = ship.x + c * along + n * out * side;
          const oz = ship.z + n * along - c * out * side;
          this.spray.emit({ x: ox, y: h + 0.15, z: oz, vx: -c * rnd(0.5, 1.5), vy: rnd(1, 2.6), vz: -n * rnd(0.5, 1.5), life: rnd(0.45, 0.8), size0: 0.35, size1: rnd(0.9, 1.4), alpha: 0.55, r: 0.95, g: 0.97, b: 1, drag: 1, lift: -9.8, wind: 0.1 });
          if (near) this.wake?.stamp(ox, oz, ship.heading, 2.2, 0.35, 1.4, 0.4);
        }
      }
    }
  }

  /** Height of the deck flames and smoke rise from: the fighting deck of an open ship, the hull's rim under the turtle's roof. */
  private deckOf(ship: Ship) {
    const kind = ship.spec.kind;
    return DECKS[kind].open ? mainDeck(`${kind}#${ship.variant}`, kind, ship.spec.deck) : ship.spec.deck;
  }

  /** The turtle ship's dragon keeps breathing dark sulphur smoke through the battle, a great belch when the bow gun fires. */
  private dragonSmoke(ship: Ship, dt: number) {
    const mouth = anchorsFor('geobukseon#0')?.smokeStack;
    if (!mouth || dt <= 0) return;
    let d = this.dragon.get(ship.id);
    if (!d) this.dragon.set(ship.id, (d = { blast: 0, acc: 0 }));
    d.blast = Math.max(0, d.blast - dt * 0.6);
    d.acc = Math.min(d.acc + (7 + 90 * d.blast) * dt, 10);
    const c = Math.cos(ship.heading);
    const n = Math.sin(ship.heading);
    while (d.acc >= 1) {
      d.acc -= 1;
      this.views.localToWorld(ship.id, mouth[0] + 0.4, mouth[1] + rnd(-0.2, 0.5), rnd(-0.4, 0.4), this.p);
      const sp = rnd(2, 5) + 9 * d.blast;
      this.smoke.emit({ x: this.p.x, y: this.p.y, z: this.p.z, vx: c * sp + rnd(-0.8, 0.8), vy: rnd(0.8, 2.2), vz: n * sp + rnd(-0.8, 0.8), life: rnd(5, 9), size0: rnd(0.8, 1.4), size1: rnd(5, 8) * (1 + d.blast * 0.8), alpha: 0.5 + 0.25 * d.blast, r: 0.22, g: 0.2, b: 0.1, drag: 1.3, lift: 0.3, wind: 1, heat: 0.15 });
    }
  }

  private continuous(battle: Battle, dt: number) {
    if (dt > 0) this.rowing(battle, dt);
    for (const ship of battle.ships) {
      if (!ship.alive) continue;
      if (ship.spec.kind === 'geobukseon' && ship.sinking === 0) this.dragonSmoke(ship, dt);
      if (ship.sinking > 0) this.sinking(ship, dt);
      const burning = ship.fire > 0.02 || (ship.sinking > 0 && ship.sinking < 0.85);
      if (!burning) {
        const wreck = 1 - ship.hull / ship.spec.hull;
        if (wreck > 0.45 && ship.sinking === 0 && Math.random() < dt * wreck * 5) {
          this.views.localToWorld(ship.id, rnd(-0.3, 0.3) * ship.spec.length, this.deckOf(ship), rnd(-0.3, 0.3) * ship.spec.beam, this.p);
          this.smoke.emit({ x: this.p.x, y: this.p.y, z: this.p.z, vx: rnd(-0.5, 0.5), vy: rnd(1.5, 3), vz: rnd(-0.5, 0.5), life: rnd(8, 14), size0: 2, size1: rnd(10, 16), alpha: 0.45, r: 0.35, g: 0.33, b: 0.31, drag: 0.8, lift: 0.4, wind: 1 });
        }
        continue;
      }
      const level = Math.max(ship.fire, ship.sinking > 0 ? 0.35 : 0);
      const rate = 40 * level + 6;
      let acc = (this.emitAccum.get(ship.id) ?? 0) + rate * dt;
      const L = ship.spec.length;
      const sea = ship.sinking > 0 ? waveField.heightAt(ship.x, ship.z) : -100;
      // At 128x one frame spans seconds of sim time: cap the burst so it cannot snowball.
      acc = Math.min(acc, 24);
      while (acc >= 1) {
        acc -= 1;
        const lx = rnd(-0.38, 0.38) * L;
        const lz = rnd(-0.4, 0.4) * ship.spec.beam;
        this.views.localToWorld(ship.id, lx, this.deckOf(ship) * rnd(0.85, 1.15), lz, this.p);
        // Flames that would sit under the waterline of a heeled, sinking hull are out.
        if (this.p.y < sea + 0.4) continue;
        const big = rnd(0.6, 1.4) * (0.6 + level);
        this.fire.emit({ x: this.p.x, y: this.p.y, z: this.p.z, vx: rnd(-0.6, 0.6), vy: rnd(1.5, 4), vz: rnd(-0.6, 0.6), life: rnd(0.7, 1.4), size0: 2.6 * big, size1: 4.2 * big, heat: rnd(0.5, 1), drag: 1.5, lift: 2.5, wind: 0.5, alpha: 0.8, rot: rnd(-0.15, 0.15), spin: 0.05 });
        if (Math.random() < 0.55) {
          this.smoke.emit({ x: this.p.x, y: this.p.y + 2, z: this.p.z, vx: rnd(-1, 1), vy: rnd(3, 6), vz: rnd(-1, 1), life: rnd(14, 26), size0: rnd(3, 5), size1: rnd(18, 30) * (0.6 + level * 0.6), alpha: 0.75, r: 0.12, g: 0.11, b: 0.1, drag: 0.6, lift: 0.6, wind: 1, heat: 0.35 });
        }
        if (Math.random() < 0.3) {
          this.streaks.emit({ x: this.p.x, y: this.p.y + 1, z: this.p.z, vx: rnd(-2, 2), vy: rnd(5, 12), vz: rnd(-2, 2), life: rnd(1.2, 2.6), minLen: 0.3, stretch: 0.03, width: 0.09, r: 1, g: 0.55, b: 0.2, alpha: 0.9, gravity: 1.5, drag: 0.5 });
        }
      }
      this.emitAccum.set(ship.id, acc);
      if (level > 0.15) {
        this.views.localToWorld(ship.id, 0, this.deckOf(ship) + 3, 0, this.p);
        this.sources.push({ x: this.p.x, y: this.p.y, z: this.p.z, intensity: 5000 * level * (0.85 + Math.random() * 0.3), decay: 1, r: 1, g: 0.5, b: 0.2, age: 0, life: 1, dist: 180, once: true });
      }
      if (ship.sinking > 0 && Math.random() < dt * 6) {
        this.views.localToWorld(ship.id, rnd(-0.45, 0.45) * L, 0, rnd(-0.5, 0.5) * ship.spec.beam, this.p);
        const h = waveField.heightAt(this.p.x, this.p.z);
        for (let i = 0; i < 4; i += 1) this.spray.emit({ x: this.p.x + rnd(-1, 1), y: h + 0.2, z: this.p.z + rnd(-1, 1), vx: rnd(-0.6, 0.6), vy: rnd(0.5, 2.5), vz: rnd(-0.6, 0.6), life: rnd(1.5, 3), size0: 1.2, size1: 3.5, alpha: 0.45, r: 0.92, g: 0.96, b: 0.98, drag: 1, lift: -2 });
      }
    }
  }

  /** One puff of trail smoke for a shell at the given point; `k` grows the puff so that wide-spaced puffs still run together. */
  private trailPuff(x: number, y: number, z: number, kind: ShellKind, weight: number, k: number) {
    if (kind === Shell.Rocket || kind === Shell.Lance) {
      // The white smoke of a rocket motor: thin and long-lived, with a spark of flame at the nozzle.
      this.smoke.emit({ x, y, z, vx: rnd(-0.4, 0.4), vy: rnd(0, 0.5), vz: rnd(-0.4, 0.4), life: rnd(1.6, 2.6), size0: 2.3 * k, size1: rnd(4, 5) * k, alpha: 0.16, r: 0.95, g: 0.95, b: 0.92, drag: 1.2, lift: 0.12, wind: 0.8 });
      return;
    }
    const fiery = kind === Shell.Hiya;
    this.smoke.emit({ x, y, z, vx: rnd(-0.3, 0.3), vy: rnd(0, 0.5), vz: rnd(-0.3, 0.3), life: rnd(1.2, 2.2), size0: (1.7 + 0.8 * weight) * k, size1: (rnd(3.4, 4.4) + 1.2 * weight) * k, alpha: fiery ? 0.3 : 0.22, r: fiery ? 0.34 : 0.88, g: fiery ? 0.32 : 0.88, b: fiery ? 0.3 : 0.88, drag: 1.4, lift: 0.1, wind: 0.6, heat: fiery ? 0.5 : 0 });
    if (fiery) this.fire.emit({ x, y, z, life: rnd(0.15, 0.3), size0: 0.55 * k, size1: 0.15, alpha: 0.7, heat: 0.9, drag: 2, wind: 0.2 });
  }

  /**
   * Lays the smoke ribbon of a shell along its drawn arc up to (px, py, pz): a puff every few pixels of screen, so the
   * arc reads as a ribbon and not as beads. `trail` remembers where the last puff went.
   */
  private layTrail(trail: Trail, px: number, py: number, pz: number, ppm: number, crowd: number, kind: ShellKind, weight: number) {
    const rocket = kind === Shell.Rocket || kind === Shell.Lance;
    const spacing = Math.min(10, Math.max(rocket ? 2 : 1.8, 4.5 / ppm) * crowd);
    const run = Math.hypot(px - trail.x, py - trail.y, pz - trail.z);
    if (run < spacing) return;
    const puffs = Math.min(rocket ? 8 : 16, Math.floor(run / spacing));
    const k = Math.max(1, spacing / (rocket ? 2 : 1.8));
    for (let i = 1; i <= puffs; i += 1) {
      const at = (i * spacing) / run;
      this.trailPuff(trail.x + (px - trail.x) * at, trail.y + (py - trail.y) * at, trail.z + (pz - trail.z) * at, kind, weight, k);
    }
    const adv = Math.min(1, (puffs * spacing) / run);
    trail.x += (px - trail.x) * adv;
    trail.y += (py - trail.y) * adv;
    trail.z += (pz - trail.z) * adv;
  }

  /** How far above the sim's path a shell is drawn now, for a camera that follows it. */
  liftOf(p: Projectile) {
    const f = this.flights.get(p.id);
    if (!f || f.end <= 0) return 0;
    const s = Math.min(1, p.age / f.end);
    return 4 * f.peak * s * (1 - s) * (f.ghost >= 0 ? Math.max(0, 1 - f.ghost / SETTLE) : 1);
  }

  /** Learns what the sim will do with a shell the first time it is seen: when it ends, and so how high its drawn arc peaks. */
  private planFlight(p: Projectile, battle: Battle, f: Flight, blend: number) {
    const end = p.age + timeToImpact(p, battle, this.seaAt, this.shipRate);
    const peak = arcPeak(p.ammo, Math.hypot(p.vx, p.vz) * end);
    // Ships turn, drift and are steered after the plan was made: plan again as the shell flies and ease toward the new answer.
    f.end += (end - f.end) * blend;
    f.peak += (peak - f.peak) * blend;
    f.next = p.age + (end - p.age < 0.5 ? 0.08 : 0.25);
  }

  update(battle: Battle, dt: number, camera: Camera) {
    this.rowCam = camera;
    this.continuous(battle, dt);
    this.camPos.copy(camera.position);
    this.frame += 1;
    for (let i = this.ghosts.length - 1; i >= 0; i -= 1) {
      const g = this.ghosts[i]!;
      const gf = this.flights.get(g.id);
      if (gf) gf.ghost += dt;
      if (!gf || gf.ghost >= SETTLE) {
        this.ghosts.splice(i, 1);
        if (gf) {
          this.flights.delete(g.id);
          this.flightPool.push(gf);
        }
      }
    }
    const shells = this.ghosts.length ? battle.projectiles.concat(this.ghosts) : battle.projectiles;
    // Pixels per metre at one metre from the camera, for a 900 px tall view: the size a shell must grow to stay seen.
    const focal = (camera.projectionMatrix.elements[5] ?? 1.7) * 450;
    // With many shells in flight each leaves fewer puffs, so the smoke layer never fills up.
    const crowd = Math.max(1, Math.sqrt((shells.length + this.mun.rocketsInFlight) / 20));
    this.crowd = crowd;
    this.mun.begin();
    for (const p of shells) {
      let f = this.flights.get(p.id);
      let fresh = false;
      if (!f) {
        f = this.flightPool.pop() ?? { x: 0, y: 0, z: 0, seen: 0, end: 0, peak: 0, next: 0, ghost: -1, ref: null, kind: Shell.Ball, seed: 0 };
        f.ghost = -1;
        f.kind = shellKind(p.ammo, p.gun);
        f.seed = rnd(0, 6.28);
        this.planFlight(p, battle, f, 1);
        this.flights.set(p.id, f);
        fresh = true;
      }
      f.seen = this.frame;
      f.ref = p;
      if (f.ghost < 0 && !fresh && p.age >= f.next) this.planFlight(p, battle, f, 0.5);
      const settle = f.ghost >= 0 ? Math.max(0, 1 - f.ghost / SETTLE) : 1;
      // The drawn shell rides above the sim's path on an arc that is flat at both ends: the hit stays where the sim put it.
      const s = f.end > 0 ? Math.min(1, p.age / f.end) : 1;
      let px = p.x;
      let py = p.y + 4 * f.peak * s * (1 - s) * settle;
      let pz = p.z;
      // The tangent of the drawn arc, for the arrow's pitch and the ball's smear.
      const climb = f.end > p.age && f.ghost < 0 ? (4 * f.peak * (1 - 2 * s)) / f.end : 0;
      const vy = p.vy + climb;
      const sp = Math.hypot(p.vx, vy, p.vz) || 1;
      const ux = p.vx / sp;
      const uy = vy / sp;
      const uz = p.vz / sp;
      const kind = f.kind;
      const rocket = kind === Shell.Rocket || kind === Shell.Lance;
      // A rocket corkscrews a little round its line.
      if (rocket) {
        this.mun.corkscrew(ux, uy, uz, p.age, f.seed, 0.2 * smooth(0, 0.5, p.age) * (1 - s * s * s), this.s);
        px += this.s.x;
        py += this.s.y;
        pz += this.s.z;
      }
      if (fresh) {
        f.x = px;
        f.y = py;
        f.z = pz;
        if (kind === Shell.Rocket) {
          this.mun.launch(px, py, pz, ux, uy, uz, 1.3);
          if (f.ghost < 0) this.mun.salvo(p, f.end - p.age, f.peak, battle);
        } else if (kind === Shell.Lance) this.mun.launch(px, py, pz, ux, uy, uz, 0.7);
      }
      const d = Math.max(1, this.camPos.distanceTo(this.p.set(px, py, pz)));
      const ppm = focal / d;
      const weight = gunClass(p.gun, true).weight;
      if (d < 2600) this.layTrail(f, px, py, pz, ppm, crowd, kind, weight);
      else {
        f.x = px;
        f.y = py;
        f.z = pz;
      }
      switch (kind) {
        case Shell.Heavy:
          this.mun.heavyArrow(px, py, pz, ux, uy, uz, sp, ppm, p.gun);
          break;
        case Shell.Hiya:
          this.mun.fireArrow(px, py, pz, ux, uy, uz, ppm);
          break;
        case Shell.Rocket:
          this.mun.rocket(px, py, pz, ux, uy, uz, 1.6, ppm, dt);
          break;
        case Shell.Lance:
          this.mun.rocket(px, py, pz, ux, uy, uz, 0.95, ppm, dt);
          break;
        case Shell.Grape:
          this.mun.grape(px, py, pz, ux, uy, uz, sp, ppm, p.id, p.age);
          break;
        default:
          this.mun.ball(px, py, pz, ux, uy, uz, sp, ppm, weight);
      }
    }
    this.mun.fly(dt, this.camPos.x, this.camPos.y, this.camPos.z, focal, this.layRocket);
    this.mun.stuck(dt, battle, this.camPos.x, this.camPos.y, this.camPos.z, focal);
    this.mun.end();
    if (this.flights.size > shells.length) {
      for (const [id, f] of this.flights) {
        if (f.seen === this.frame) continue;
        // A shell that vanished high above its sim path does not pop out of the air: it settles onto the point where it ended.
        const ref = f.ref;
        if (ref && f.ghost < 0 && f.end > 0) {
          const q = Math.min(1, ref.age / f.end);
          if (4 * f.peak * q * (1 - q) > 0.4) {
            f.ghost = 0;
            f.seen = this.frame;
            this.ghosts.push(ref);
            continue;
          }
        }
        f.ref = null;
        this.flights.delete(id);
        this.flightPool.push(f);
      }
    }
    this.smoke.update(dt, this.windX, this.windZ, camera);
    this.fire.update(dt, this.windX, this.windZ, camera);
    this.spray.update(dt, this.windX * 0.3, this.windZ * 0.3, camera);
    this.streaks.update(dt);
    this.debris.update(dt, this.windX, this.windZ, this.onDebrisSplash, this.onDebrisEmber);
    this.updateLights(dt, camera);
  }

  private readonly onDebrisSplash = (x: number, y: number, z: number, size: number) => {
    this.spray.emit({ x, y, z, vy: 3 + 3 * size, life: 0.9, size0: 0.6 * size, size1: 1.8 * size, alpha: 0.55, r: 0.95, g: 0.97, b: 1, lift: -9.8 });
  };

  private readonly onDebrisEmber = (x: number, y: number, z: number) => {
    this.fire.emit({ x, y, z, vy: 1.5, life: rnd(0.4, 0.8), size0: 0.9, size1: 0.3, heat: 1, drag: 1, lift: 2 });
    this.smoke.emit({ x, y: y + 0.5, z, vy: 1.5, life: rnd(3, 6), size0: 0.8, size1: rnd(3, 5), alpha: 0.35, r: 0.3, g: 0.29, b: 0.28, drag: 0.8, lift: 0.4 });
  };

  /** Crowding of the shells of this frame, for the trails of the salvo's rockets. */
  private crowd = 1;
  private readonly layRocket = (t: Trail, x: number, y: number, z: number, ppm: number) => this.layTrail(t, x, y, z, ppm, this.crowd, Shell.Rocket, 0);

  private updateLights(dt: number, camera: Camera) {
    const cam = camera.position;
    for (let i = this.sources.length - 1; i >= 0; i -= 1) {
      const s = this.sources[i]!;
      if (s.once) continue;
      s.age += dt;
      if (s.age > s.life) this.sources.splice(i, 1);
    }
    for (const s of this.sources) {
      const fade = s.life > 0 ? 1 - s.age / s.life : 1;
      s.score = (s.intensity * fade) / (1 + (cam.distanceTo(this.v.set(s.x, s.y, s.z)) / 300) ** 2);
    }
    this.sources.sort((a, b) => b.score! - a.score!);
    for (let i = 0; i < this.lightCount; i += 1) {
      const l = this.lights[i]!;
      const s = this.sources[i];
      if (!s) {
        l.intensity = 0;
        this.lightPos[i]!.w = 0;
        continue;
      }
      const fade = s.life > 0 ? 1 - s.age / s.life : 1;
      l.position.set(s.x, s.y, s.z);
      l.color.setRGB(s.r, s.g, s.b);
      l.intensity = s.intensity * fade * (1 + this.night * 0.5);
      l.distance = s.dist;
      this.lightPos[i]!.set(s.x, s.y, s.z, l.intensity);
      this.lightCol[i]!.set(s.r, s.g, s.b, s.dist);
    }
    for (let i = this.sources.length - 1; i >= 0; i -= 1) if (this.sources[i]!.once) this.sources.splice(i, 1);
  }
}
