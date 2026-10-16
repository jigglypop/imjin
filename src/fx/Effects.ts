import { Frustum, Group, Matrix4, PointLight, Sphere, Vector3, type Camera } from 'three/webgpu';
import type { Battle } from '../sim/battle';
import type { AmmoType, BattleEvent, GunType, Projectile, Ship } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { waveField } from '../ocean/waves';
import { ParticleLayer, StreakLayer, particleDepth } from './ParticleLayer';
import { DebrisField, Piece } from './Debris';
import { gunClass } from './gunClass';
import { arcPeak, timeToImpact } from './flight';
import { Munitions, Shell, shellKind, type ShellKind, type Trail } from './Projectiles';
import { anchorsFor, byModel, modelKind } from '../ships/anchors';
import { DECKS, mainDeck } from '../ships/decks';
import { planSinking, type CueKind, type SinkCue } from './sinkPlan';
import { CREW_RANGE } from './crewTypes';
import type { WakeMap } from '../ocean/WakeMap';
import { LIGHT_COUNT, pointLights } from '../render/lights';
import type { ParticleQuality } from '../game/quality';
import { shipObserved } from '../sim/observation';
import { pointVisible } from '../sim/visibility';
import { disposeTree } from '../render/dispose';
import { ShipFires } from './fire/ShipFires';
import { Scars, type HitLook } from './Scars';

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
  /**
   * Weight in the race for the few light slots. A gun's flash is dim next to a burning hull but lasts a few frames,
   * and the eye looks for it: without a head start the lanterns and fires of a night battle would leave it dark.
   */
  rank?: number;
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
/** A shot hole left burning: the ship, the point in its frame, seconds left, how big, and its emission carry-over. */
type Smoulder = { ship: number; lx: number; ly: number; lz: number; left: number; size: number; acc: number };

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
  /** The scene depth the particles fade against, where the device can afford the copy. */
  private readonly depth: ReturnType<typeof particleDepth> | null;
  private readonly debris: DebrisField;
  private readonly mun: Munitions;
  /** What the fight leaves on the ships until they sink: holes, embedded arrows, broken boards, torn sails. */
  readonly scars: Scars;
  /** Burning ships: flames on the hull, the smoke column, embers, steam, the wreck burning on after (src/fx/fire). */
  readonly blaze: ShipFires;
  private readonly camPos = new Vector3();
  onShake: ((amount: number) => void) | null = null;
  /**
   * A shot struck a hull with `impact` (about 0.1 for a light ball glancing off to 1.6 for a great arrow's breach), from
   * outside the face (bx, bz): the camera's kick and the hit-stop of a heavy blow beside the camera.
   */
  onImpact: ((x: number, y: number, z: number, impact: number, ship: number, bx: number, bz: number) => void) | null = null;
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
  private readonly smoulders: Smoulder[] = [];
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
    this.lightCount = quality.lights;
    // Soft contact with the sea and the hulls costs a depth copy each frame: PCs only (the class with eight lights).
    this.depth = quality.lights >= 8 ? particleDepth() : null;
    const lighting = { lights: this.lightCount, depth: this.depth };
    // Capacities leave headroom above the level 4 emission rate, so the layers do not saturate in a big battle.
    this.smoke = new ParticleLayer('smoke', 12000, quality.particles, lighting);
    this.fire = new ParticleLayer('fire', 8000, quality.particles, lighting);
    this.spray = new ParticleLayer('spray', 6000, quality.particles, lighting);
    this.tier = quality.lights >= 8 ? 1 : quality.lights >= 6 ? 0.7 : 0.45;
    this.k = Math.min(1.25, Math.max(0.4, quality.particles.keep));
    this.streaks = new StreakLayer(Math.round(1200 * this.tier), Math.round(1700 * this.tier), quality.particles);
    this.debris = new DebrisField(Math.round(900 * this.tier));
    // Lights past the active count stay dark so the surface shader's light loop adds nothing for them.
    for (let i = this.lightCount; i < LIGHT_COUNT; i += 1) this.lightPos[i]!.w = 0;
    this.mun = new Munitions(this.smoke, this.fire, this.streaks, this.tier);
    this.mun.setKeep(this.k);
    this.mun.onLand = this.onRocketLand;
    this.scars = new Scars(views, this.mun, this.smoke, this.fire);
    this.scars.setKeep(this.k);
    this.blaze = new ShipFires({
      views,
      spray: this.spray,
      streaks: this.streaks,
      debris: this.debris,
      tier: this.tier,
      // By day the sky already lights the hull: the fire only warms it, so the light is weaker and shorter than at night.
      light: (x, y, z, intensity, dist, r, g, b) => {
        const day = 1 - Math.min(1, this.night);
        this.sources.push({ x, y, z, intensity: intensity * (1 - 0.7 * day), decay: 1, r, g, b, age: 0, life: 1, dist: dist * (1 - 0.35 * day), once: true });
      },
      steam: (x, y, z, size) => this.cue('steam', x, y, z, size),
    });
    this.blaze.setKeep(this.k);
    for (let i = 0; i < this.lightCount; i += 1) {
      const l = new PointLight(0xffaa55, 0, 160, 1.6);
      l.castShadow = false;
      this.lights.push(l);
      this.group.add(l);
    }
    this.group.add(this.smoke.sprite, this.fire.sprite, this.spray.sprite, this.streaks.sprite, this.debris.group, this.mun.group, this.scars.group, this.blaze.group);
  }

  /** Frees the meshes, the sprites and the depth copy, whose texture is the clone made for the scene pass on its first frame. */
  dispose() {
    this.depth?.value.dispose();
    disposeTree(this.group);
  }

  /** Run-time emission rate for all particle layers. See ParticleLayer.setKeep. */
  setParticleKeep(keep: number) {
    this.k = Math.min(1.25, Math.max(0.4, keep));
    this.smoke.setKeep(keep);
    this.fire.setKeep(keep);
    this.spray.setKeep(keep);
    this.streaks.setKeep(keep);
    this.mun.setKeep(this.k);
    this.scars.setKeep(this.k);
    this.blaze.setKeep(this.k);
  }

  /** A count scaled to the quality level (at least 1). */
  private n(count: number) {
    return Math.max(1, Math.round(count * this.k));
  }

  lantern(x: number, y: number, z: number, intensity: number) {
    this.sources.push({ x, y, z, intensity, decay: 1, r: 1, g: 0.6, b: 0.27, age: 0, life: 1, dist: 70, once: true });
  }

  private light(x: number, y: number, z: number, intensity: number, life: number, r = 1, g = 0.62, b = 0.3, dist = 140, rank = 1) {
    this.sources.push({ x, y, z, intensity, decay: 1, r, g, b, age: 0, life, dist, rank });
  }

  /** A new battle starts on this engine: ship and shell ids restart, so the old battle's per-id state must not carry over. */
  newBattle() {
    this.emitAccum.clear();
    this.dragon.clear();
    this.strokes.clear();
    this.sinks.clear();
    this.smoulders.length = 0;
    for (const f of this.flights.values()) this.flightPool.push(f);
    this.flights.clear();
    this.ghosts.length = 0;
    this.mun.clear();
    this.scars.clear();
    this.blaze.clear();
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
          const shell = this.flights.get(e.proj)?.ref ?? null;
          const ship = battle.get(e.ship);
          const look = ship ? this.scarHit(ship, e.x, e.y, e.z, e.ammo, shell) : null;
          this.hit(e.x, e.y, e.z, e.damage, e.ammo, shell ? shellKind(shell.ammo, shell.gun) : e.ammo === 'fire' ? Shell.Hiya : Shell.Ball, e.ship, shell, battle, look);
          this.blaze.hit(e.ship, e.x, e.y, e.z, e.ammo, battle);
          // A brief lift of the struck hull, enough to find it from afar; the splinters and smoke tell the rest.
          this.views.flash(e.ship, Math.min(0.45, 0.14 + e.damage * 0.018));
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
          if (e.from) this.embers(e.from, e.ship, battle);
          this.blaze.ignite(e.ship, e.from, battle);
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
          this.scars.removed(e.ship);
          this.blaze.removed(e.ship, battle);
          this.finishSink(e.ship, battle);
          break;
        default:
          break;
      }
    }
  }

  /** Shakes the camera by `strength` at the source, falling off over `reach` metres: gunfire only rocks a camera right beside it. */
  private shakeAt(x: number, y: number, z: number, strength: number, reach = 90) {
    const d = this.camPos.distanceTo(this.v.set(x, y, z));
    const k = strength / (1 + (d / reach) ** 2);
    if (k > 0.02) this.onShake?.(k);
  }

  /** Streaks and glow shrink to nothing when the camera is far; widen them with distance so they still read. */
  private zoomBoost(x: number, y: number, z: number) {
    return Math.min(5, Math.max(1, this.camPos.distanceTo(this.v.set(x, y, z)) / 160));
  }

  /**
   * A gun going off. Black powder burns in a flash lasting a few frames: a white-hot tongue out of the bore, a ball of
   * burning gas, grains of powder still alight. What stays is the smoke: a dense jet that the air stops within a few
   * metres, rolling over into a thick, lit cloud that hangs at the gun's height and drifts off with the wind, so a
   * broadside builds a bank along the ship's side. The blast also slaps the water below into a ring of spray.
   */
  gun(x: number, y: number, z: number, dx: number, dy: number, dz: number, big: boolean, type?: GunType) {
    const w = gunClass(type, big).weight;
    const scale = 0.55 + 0.6 * w;
    // The flash: a tongue of white-hot gas along the bore, whatever the view. A streak is brightest at its head, so it
    // is put with its head at the muzzle, pointing back, and its tail reaching out along the line of fire.
    for (let i = 0; i < 2; i += 1) {
      const len = (2.4 + 3 * w) * (1 - i * 0.3) * rnd(0.85, 1.15);
      this.streaks.emit({ x: x + dx * 0.2, y: y + dy * 0.2, z: z + dz * 0.2, vx: -dx, vy: -dy, vz: -dz, life: rnd(0.04, 0.07), minLen: len, stretch: 0, width: (0.3 + 0.4 * w) * (1 - i * 0.3), r: 1, g: 0.85, b: 0.6, alpha: 1 });
    }
    // The ball of burning gas: a white-hot core at the bore, the body of the flame and its ragged front, each larger
    // and briefer than the last; a heavy charge throws a last bloom further out. From the RTS camera the ball is
    // widened so a broadside still flashes along the side.
    const boost = Math.min(2.5, this.zoomBoost(x, y, z));
    const ball = scale * Math.sqrt(boost);
    for (let i = 0; i < 4; i += 1) {
      const at = 0.6 + i * 1.2 * scale;
      this.fire.emit({ x: x + dx * at, y: y + dy * at, z: z + dz * at, vx: dx * 26, vy: dy * 26, vz: dz * 26, life: rnd(0.05, 0.08) + i * 0.018, size0: (1.6 + i * 1.1) * ball, size1: (3.8 + i * 2.4) * ball, alpha: 1, heat: 1 - i * 0.08, drag: 9, wind: 0 });
    }
    // The blast's bloom round the muzzle, sideways as much as forward: what makes the shot a blow and not a spark.
    this.fire.emit({ x: x + dx * 2 * scale, y: y + dy * 2 * scale + 0.2, z: z + dz * 2 * scale, life: 0.06 + 0.04 * w, size0: 2.5 * ball, size1: (6 + 6 * w) * ball, alpha: 0.65, heat: 0.95, drag: 6, wind: 0 });
    if (w > 0.6) this.fire.emit({ x: x + dx * 5, y: y + dy * 5 + 0.3, z: z + dz * 5, vx: dx * 18, vy: dy * 18 + 1, vz: dz * 18, life: rnd(0.1, 0.15), size0: 4 * scale, size1: 8.5 * scale, alpha: 0.6, heat: 0.85, drag: 6, wind: 0 });
    // Grains of powder still burning, flung out in a narrow fan; a few fall smouldering to the water.
    for (let i = 0; i < this.n(4 + 6 * w); i += 1) {
      const sp = rnd(40, 110);
      const fan = 0.2;
      this.streaks.emit({ x: x + dx * 0.8, y: y + dy * 0.8, z: z + dz * 0.8, vx: dx * sp + rnd(-fan, fan) * sp * 0.5, vy: dy * sp + rnd(-fan, fan) * sp * 0.5, vz: dz * sp + rnd(-fan, fan) * sp * 0.5, life: rnd(0.08, 0.22), minLen: 0.3, stretch: 0.012, width: (0.05 + 0.06 * w) * boost, r: 1, g: rnd(0.45, 0.65), b: rnd(0.12, 0.25), gravity: 6, drag: 1.5 });
    }
    for (let i = 0; i < this.n(3 + 4 * w); i += 1) {
      const sp = rnd(15, 40);
      this.fire.emit({ x, y, z, vx: dx * sp + rnd(-4, 4), vy: dy * sp + rnd(0, 5), vz: dz * sp + rnd(-4, 4), life: rnd(0.4, 1), size0: 0.25, size1: 0.08, heat: 1, drag: 1, lift: -6, wind: 0.2 });
    }
    // The jet: dense, yellowish-grey powder smoke shot out of the bore and stopped by the air within ten metres or so.
    for (let i = 0; i < Math.round(3 + 3 * w); i += 1) {
      const sp = rnd(22, 48) * (0.8 + 0.4 * w);
      const tone = rnd(0.56, 0.66);
      this.smoke.emit({ x: x + dx * 0.9, y: y + dy * 0.9, z: z + dz * 0.9, vx: dx * sp + rnd(-1.5, 1.5), vy: dy * sp + rnd(-0.5, 1.5), vz: dz * sp + rnd(-1.5, 1.5), life: rnd(9, 15), size0: rnd(1.4, 2) * scale, size1: rnd(8, 12) * scale, alpha: rnd(0.62, 0.78), r: tone, g: tone * 0.97, b: tone * 0.9, drag: 3.4, lift: 0.14, wind: 1, spin: 0.25, growth: 5 });
    }
    // The billow: the hot gas of the charge swelling to several metres within the first second, a short life so that it
    // grows fast; by the time it thins out the slower cloud has taken its place.
    for (let i = 0; i < Math.round(3 + 3 * w); i += 1) {
      const along = rnd(1, 4.5) * scale;
      const sp = rnd(4, 12) * scale;
      const tone = rnd(0.66, 0.78);
      this.smoke.emit({ x: x + dx * along + rnd(-0.5, 0.5), y: y + dy * along + rnd(-0.3, 0.6), z: z + dz * along + rnd(-0.5, 0.5), vx: dx * sp + rnd(-2.5, 2.5), vy: dy * sp + rnd(0, 2), vz: dz * sp + rnd(-2.5, 2.5), life: rnd(1.8, 2.8), size0: rnd(0.8, 1.2) * scale, size1: rnd(5, 7.5) * scale, alpha: rnd(0.5, 0.65), r: tone, g: tone * 0.98, b: tone * 0.94, drag: 2.6, lift: 0.2, wind: 1, spin: 0.35, heat: i < 2 ? 0.6 : 0 });
    }
    // The cloud the jet rolls over into: puffs of every size round its first metres, swelling as much up and sideways
    // as along the bore, rising slowly and rolling as they grow, lasting long enough that the next guns of a broadside
    // fire into the smoke of the first.
    const puffs = Math.round(5 + 6 * w);
    for (let i = 0; i < puffs; i += 1) {
      const along = rnd(0.5, 8) * scale;
      const sp = rnd(2, 14) * scale;
      const tone = rnd(0.62, 0.76);
      this.smoke.emit({
        x: x + dx * along + rnd(-1, 1),
        y: y + dy * along + rnd(-0.5, 1.2),
        z: z + dz * along + rnd(-1, 1),
        vx: dx * sp + rnd(-3.5, 3.5),
        vy: dy * sp + rnd(-0.5, 3),
        vz: dz * sp + rnd(-3.5, 3.5),
        life: rnd(16, 28),
        size0: rnd(1.2, 2.6) * scale,
        size1: rnd(10, 19) * scale,
        alpha: rnd(0.4, 0.62),
        r: tone,
        g: tone * 0.985,
        b: tone * 0.96,
        drag: 1.4,
        lift: rnd(0.08, 0.24),
        wind: 1,
        spin: 0.18,
        growth: 7,
      });
    }
    // The blast ring: the pressure wave throwing smoke out sideways round the bore, fast, then stopped by the air.
    const px = -dz;
    const pz = dx;
    const ring = Math.round(5 + 5 * w);
    for (let i = 0; i < ring; i += 1) {
      const a = ((i + Math.random() * 0.6) / ring) * Math.PI * 2;
      const sp = rnd(13, 22) * scale;
      this.smoke.emit({ x: x + dx * 1.6, y: y + dy * 1.6, z: z + dz * 1.6, vx: px * Math.cos(a) * sp + dx * 6, vy: Math.sin(a) * sp * 0.7 + 0.4, vz: pz * Math.cos(a) * sp + dz * 6, life: rnd(2.5, 4.5), size0: 0.9 * scale, size1: rnd(5, 8) * scale, alpha: 0.45, r: 0.76, g: 0.75, b: 0.72, drag: 4.5, lift: 0.12, wind: 1, growth: 6 });
    }
    // The blast slaps the sea under the muzzle: a ring of spray running outward and a flattened, frothy patch.
    const h = waveField.heightAt(x, z, waveField.time, 6);
    const reach = Math.max(2, y - h);
    const cx = x + dx * (2 + reach * 0.8);
    const cz = z + dz * (2 + reach * 0.8);
    const drops = Math.round(10 + 14 * w);
    for (let i = 0; i < drops; i += 1) {
      const a = (i / drops) * Math.PI * 2 + Math.random() * 0.4;
      const out = rnd(8, 16) * (0.6 + 0.6 * w);
      this.spray.emit({ x: cx + Math.cos(a) * 1.2, y: h + 0.2, z: cz + Math.sin(a) * 1.2, vx: Math.cos(a) * out + dx * 4, vy: rnd(0.6, 2.2), vz: Math.sin(a) * out + dz * 4, life: rnd(0.6, 1), size0: 0.5, size1: rnd(1.8, 3) * (0.7 + 0.5 * w), alpha: 0.45, r: 0.92, g: 0.95, b: 0.97, drag: 2.2, lift: -9.8, wind: 0.3 });
    }
    this.wake?.stamp(cx, cz, Math.atan2(dz, dx), 6 + 6 * w, 0.35 + 0.35 * w, 1, 1.2);
    this.shakeAt(x, y, z, 0.18 + 0.35 * w, 30);
    // The flash lights the hull, the water and the smoke for a few frames: warm, close and gone. By day it has to stand
    // against the sun; at night the eye has opened up for it and a third of it is the brightest thing on the water.
    const day = 1 - Math.min(1, this.night);
    this.light(x + dx * 2.5, y + 0.8, z + dz * 2.5, (700 + 1600 * w) * (1 + 1.6 * day), 0.1, 1, 0.66, 0.36, 35 + 35 * w, 30);
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

  /**
   * Leaves the marks of a hit (Scars) and tells how it looked: the shell's line comes from its flight when it was seen,
   * else straight in toward the ship's middle at a round shot's speed.
   */
  private scarHit(ship: Ship, x: number, y: number, z: number, ammo: AmmoType, shell: Projectile | null): HitLook {
    let dx: number;
    let dy = 0;
    let dz: number;
    let speed: number;
    if (shell) {
      speed = Math.hypot(shell.vx, shell.vy, shell.vz) || 1;
      dx = shell.vx / speed;
      dy = shell.vy / speed;
      dz = shell.vz / speed;
    } else {
      const l = Math.hypot(ship.x - x, ship.z - z) || 1;
      dx = (ship.x - x) / l;
      dz = (ship.z - z) / l;
      speed = 120;
    }
    const gun: GunType = shell ? shell.gun : ammo === 'arrow' ? 'jija' : ammo === 'grape' ? 'hwangja' : ammo === 'fire' ? (ship.spec.faction === 'japan' ? 'hyeonja' : 'ozutsu') : 'hyeonja';
    return this.scars.hit(ship, x, y, z, dx, dy, dz, speed, ammo, gun, shell ? shell.age * speed : 150);
  }

  /** A matchlock ball into the wall of a ship within the crew's range (Boarding draws the shot). */
  musketMark(target: Ship, sx: number, sz: number) {
    this.scars.musket(target, sx, sz);
  }

  /** The persistent marks, for the probes. */
  scarStats() {
    return this.scars.stats();
  }

  /**
   * A rocket of a salvo came down on a deck, or into the sea beside the ship: the rockets the sim does not count. One
   * that came down on a ship stays in it, burning, often in a sail.
   */
  private readonly onRocketLand = (x: number, y: number, z: number, ship: number, ux: number, uy: number, uz: number) => {
    if (!ship) {
      this.splash(x, z, 0.4);
      return;
    }
    this.rocketBurst(x, y, z, 0.7);
    const target = this.battleRef?.get(ship);
    if (target && target.alive) this.scars.rocket(target, x, y, z, ux, uy, uz);
  };
  /** The battle of the last frame, for the salvo's landing hook. */
  private battleRef: Battle | null = null;

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
    this.light(x, y + 1, z, 20 * scale, 0.14, 1, 0.6, 0.25, 22);
  }

  /**
   * A shot striking a hull. The planking bursts: splinters of tarred wood with the pale grain torn open, thrown back out
   * of the face that was struck and some through the far side; a puff of wood dust and dark powder smoke; a brief flash
   * and a few sparks off the iron. A heavy hit (a great arrow, a big ball, a fire shot) leaves the hole smouldering.
   */
  hit(x: number, y: number, z: number, damage: number, ammo: AmmoType = 'ball', kind: ShellKind = Shell.Ball, ship = 0, shell: Projectile | null = null, battle?: Battle, look: HitLook | null = null) {
    // A rocket arrow bursts in small puffs of fire, a fire arrow (hiya) leaves a bit of flame: neither tears the planking like a shot.
    if (kind === Shell.Rocket || kind === Shell.Lance) {
      this.shatter(x, y, z, this.n(3 + damage * 0.5), 0.55, 6);
      this.rocketBurst(x, y, z, kind === Shell.Rocket ? 1 : 0.7);
      this.shakeAt(x, y, z, 0.12 + damage * 0.01, 60);
      return;
    }
    // Where the shell met the planks and the way back out of the struck face: the surface's normal where the model was
    // found, else back toward where the shot came from.
    const sh = shell ? Math.hypot(shell.vx, shell.vz) || 1 : 1;
    let bx = shell ? -shell.vx / sh : 0;
    let bz = shell ? -shell.vz / sh : 0;
    if (look?.ok) {
      x = look.x;
      y = look.y;
      z = look.z;
      const nl = Math.hypot(look.nx, look.nz);
      if (nl > 0.3) {
        bx = look.nx / nl;
        bz = look.nz / nl;
      }
    }
    const result = look?.ok ? look.result : ammo === 'arrow' ? 'pierce' : ammo === 'grape' ? 'embed' : 'pierce';
    if (ammo === 'grape') {
      this.pellets(x, y, z, bx, bz, damage, result === 'pierce');
      this.shakeAt(x, y, z, 0.12 + damage * 0.01, 50);
      return;
    }
    // A great arrow is a log of thorn wood sheathed in iron: what it smashes it throws out as whole boards. A ball goes
    // through and drives its splinters inboard, where they did the killing; a shot that only lodges throws little.
    const arrow = ammo === 'arrow';
    const through = result === 'smash' || result === 'pierce';
    const power = result === 'smash' ? 1.5 : arrow ? 1.15 : through ? 1 : result === 'spall' ? 0.75 : 0.45;
    const out = result === 'smash' ? 0.72 : arrow ? 0.5 : through ? 0.4 : result === 'spall' ? 0.3 : 0.85;
    const count = result === 'glance' ? 4 : result === 'embed' || result === 'stick' ? 3 + damage * 0.15 : (6 + damage * 0.8) * power;
    this.splinters(x, y, z, this.n(count), Math.min(1.3, power), bx, bz, out);
    // How hard the blow lands, 0.1 for a light ball glancing off to 1.6 for a great arrow smashing a breach: the weight
    // of the gun (or of the damage, for a shell nobody saw fly) times what the wood let it do.
    const blow = shell ? gunClass(shell.gun, true).weight : Math.min(1, damage / 15);
    const bite = result === 'smash' ? 1.25 : result === 'pierce' ? 1 : result === 'spall' ? 0.7 : result === 'glance' ? 0.25 : 0.45;
    const impact = bite * (0.45 + 0.8 * blow);
    // Seen from the RTS camera the flash, the smoke and the flying sparks are widened so a hit still reads as a hit.
    const zoom = this.zoomBoost(x, y, z);
    const boost = Math.min(2.5, zoom);
    // The blow itself: a white-hot flash at the hole and a ball of burning powder and wood thrown back out of it,
    // there and gone in a few frames.
    this.fire.emit({ x: x + bx * 0.5, y, z: z + bz * 0.5, life: 0.08 + 0.04 * impact, size0: 1.2 * impact * zoom, size1: (3.5 + 3.5 * impact) * zoom, alpha: 1, heat: 1, drag: 4, wind: 0 });
    for (let i = 0; i < this.n(3 + 6 * impact); i += 1) {
      const sp = rnd(5, 15) * impact;
      this.fire.emit({ x: x + bx * 0.8, y: y + rnd(-0.3, 0.5), z: z + bz * 0.8, vx: bx * sp + rnd(-4, 4) * impact, vy: rnd(-1, 5) * impact, vz: bz * sp + rnd(-4, 4) * impact, life: rnd(0.14, 0.32), size0: rnd(0.9, 1.6) * impact, size1: rnd(2.6, 4.6) * impact * Math.sqrt(boost), alpha: 0.9, heat: rnd(0.7, 1), drag: 5, wind: 0.1 });
    }
    // Timber flung far and high: boards, splinters and lumps out of the struck face, over the deck and into the sea.
    this.fling(x, y, z, this.n((3 + damage * 1.1) * bite * (0.6 + 0.6 * blow)), Math.min(1.5, 0.7 + 0.5 * impact), bx, bz);
    // Burning splinters and grains of powder streaking out of the hole, the trace the eye follows.
    for (let i = 0; i < this.n(4 + 14 * impact); i += 1) {
      const sp = rnd(12, 34) * (0.6 + 0.4 * impact);
      this.streaks.emit({ x, y, z, vx: bx * sp * rnd(0.4, 1) + rnd(-0.6, 0.6) * sp, vy: rnd(0.1, 0.8) * sp, vz: bz * sp * rnd(0.4, 1) + rnd(-0.6, 0.6) * sp, life: rnd(0.25, 0.7), minLen: 0.4, stretch: 0.035, width: 0.11 * boost, r: 1, g: rnd(0.5, 0.75), b: rnd(0.15, 0.3), gravity: 14, drag: 0.6 });
    }
    // Whole planks out of a breach, half a metre to a metre and a half long, a strake's width and thickness.
    if (result === 'smash') {
      for (let i = 0; i < this.n(3 + Math.min(3, damage * 0.15)); i += 1) {
        this.debris.spawn(Piece.Plank, x + rnd(-0.3, 0.3), y + rnd(-0.3, 0.3), z + rnd(-0.3, 0.3), bx * rnd(3, 10) + rnd(-3, 3), rnd(4, 11), bz * rnd(3, 10) + rnd(-3, 3), rnd(0.6, 1.5), rnd(0.5, 0.65), rnd(0.9, 1.15), rnd(16, 26), 1.2);
      }
    }
    // Wood does not spark: the few there are come off the nails and iron fittings the shot tears through.
    if (through) this.sparks(x, y, z, arrow ? 3 + damage * 0.2 : 4 + damage * 0.3, 18, 16);
    // Pale dust off the torn planks and a darker puff of powder and wood smoke, both blown out of the hole: a quick
    // dark burst first, then the cloud. A heavier blow throws a bigger cloud: a cheonja's arrow or ball against a light gun's.
    const burst = power * (0.8 + Math.min(0.6, damage / 30)) * (0.8 + 0.4 * blow);
    const dust = through ? 6 : 3;
    for (let i = 0; i < dust; i += 1) {
      this.smoke.emit({ x: x + bx * 0.8, y, z: z + bz * 0.8, vx: bx * rnd(4, 11) + rnd(-4, 4), vy: rnd(0.8, 5), vz: bz * rnd(4, 11) + rnd(-4, 4), life: rnd(2.5, 4.5), size0: 1.2, size1: rnd(6, 10) * burst, alpha: 0.55, r: 0.6, g: 0.55, b: 0.5, drag: 2, lift: 0.18, wind: 0.8, growth: 4 });
    }
    for (let i = 0; i < (through ? 4 : 2); i += 1) {
      this.smoke.emit({ x: x + bx * 0.4, y: y + 0.3, z: z + bz * 0.4, vx: bx * rnd(2, 7) + rnd(-2.5, 2.5), vy: rnd(1, 4.5), vz: bz * rnd(2, 7) + rnd(-2.5, 2.5), life: rnd(4, 7), size0: 1.4, size1: rnd(7, 12) * burst * Math.sqrt(boost), alpha: 0.75, r: 0.14, g: 0.13, b: 0.12, growth: 6, drag: 1.8, lift: 0.35, wind: 1, heat: i === 0 ? 0.5 : 0 });
    }
    if (ammo === 'fire') {
      for (let i = 0; i < 10; i += 1) this.fire.emit({ x: x + rnd(-1, 1), y: y + rnd(0, 1.5), z: z + rnd(-1, 1), vx: rnd(-2, 2), vy: rnd(2, 6), vz: rnd(-2, 2), life: rnd(0.5, 1.2), size0: rnd(1.2, 2.4), size1: rnd(2.6, 4.2), heat: rnd(0.6, 1), drag: 1.5, lift: 2.5, wind: 0.5 });
    }
    // The flash lights the struck side and the water under it. By day it has to stand against the sun; at night the
    // same light would turn the whole hull white, so it is far smaller.
    const day = 1 - Math.min(1, this.night);
    this.light(x + bx * 1.5, y + 0.8, z + bz * 1.5, (ammo === 'fire' ? 1.3 : 1) * impact * (300 + 3600 * day), 0.12, 1, 0.62, 0.32, 25 + 35 * impact, 30);
    this.shakeAt(x, y, z, (through ? 0.3 : 0.12) + damage * 0.02, 60);
    const struck = battle?.get(ship);
    if (struck) this.views.jolt(struck, -bx, -bz, impact);
    this.onImpact?.(x, y, z, impact, ship, bx, bz);
    // The wad that followed the shot in burns on in the splintered wood of a breach or a hole.
    if (battle && ((through && (damage >= 8 || arrow)) || ammo === 'fire')) this.smoulder(ship, x, y, z, ammo === 'fire' ? 1.3 : Math.min(1.2, damage / 10), battle);
  }

  /**
   * A load of small shot (the joran-hwan, iron shot, a hudun's lead) arriving as a pattern a few metres across: dust and
   * chips jump from a dozen points of the wall at once, few pieces bigger than a hand; through thin Japanese boards some
   * pass on inboard. It does not open the hull: what it kills is the men behind the wall.
   */
  private pellets(x: number, y: number, z: number, bx: number, bz: number, damage: number, through: boolean) {
    const sx = -bz;
    const sz = bx;
    const points = this.n(5 + damage * 0.3);
    const boost = Math.min(2, this.zoomBoost(x, y, z));
    for (let i = 0; i < points; i += 1) {
      const a = rnd(-1.3, 1.3);
      const h = rnd(-0.5, 0.6);
      const px = x + sx * a + bx * 0.05;
      const py = y + h;
      const pz = z + sz * a + bz * 0.05;
      // A puff of dust at every other point: the pattern reads as a spray of chips, not a cloud.
      if (i % 2 === 0) this.smoke.emit({ x: px, y: py, z: pz, vx: bx * rnd(1.5, 4) + rnd(-0.6, 0.6), vy: rnd(0.2, 1.2), vz: bz * rnd(1.5, 4) + rnd(-0.6, 0.6), life: rnd(1.2, 2.4), size0: 0.25, size1: rnd(1.1, 1.9), alpha: 0.45, r: 0.62, g: 0.56, b: 0.48, drag: 2, lift: 0.1, wind: 0.6 });
      if (Math.random() < 0.6) this.debris.spawn(Piece.Splinter, px, py, pz, bx * rnd(2, 6) + rnd(-1.5, 1.5), rnd(1, 4), bz * rnd(2, 6) + rnd(-1.5, 1.5), rnd(0.12, 0.3), rnd(0.5, 1), rnd(0.5, 1), rnd(6, 10), 1.6);
      if (through && Math.random() < 0.5) this.debris.spawn(Piece.Splinter, px, py, pz, -bx * rnd(2, 5), rnd(0.5, 2.5), -bz * rnd(2, 5), rnd(0.1, 0.25), rnd(0.5, 1), rnd(0.5, 1), rnd(6, 10), 1.6);
    }
    // A few sparks where iron meets the iron of the guns' port frames and the wall's nails.
    for (let i = 0; i < this.n(3); i += 1) {
      this.streaks.emit({ x: x + sx * rnd(-1, 1), y: y + rnd(-0.4, 0.5), z: z + sz * rnd(-1, 1), vx: bx * rnd(2, 8) + rnd(-3, 3), vy: rnd(1, 5), vz: bz * rnd(2, 8) + rnd(-3, 3), life: rnd(0.12, 0.3), minLen: 0.2, stretch: 0.03, width: 0.06 * boost, r: 1, g: rnd(0.55, 0.75), b: 0.25, gravity: 14, drag: 0.5 });
    }
  }

  /**
   * Splinters of a shot hole: mostly small, dark tarred pieces, some pale torn grain, a board now and then. `out` of
   * them fly back out of the struck face (bx, bz), the rest on through the hull: a ball drives most of its splinters
   * inboard, where they did the killing; a great arrow smashes more of the face it strikes. None goes higher than a mast.
   */
  private splinters(x: number, y: number, z: number, count: number, power: number, bx: number, bz: number, out: number) {
    for (let i = 0; i < count; i += 1) {
      const back = bx === 0 && bz === 0 ? 0 : Math.random() < out ? 1 : -0.6;
      const sp = rnd(3, 10) * power;
      const vx = bx * back * sp + rnd(-3, 3);
      const vz = bz * back * sp + rnd(-3, 3);
      const vy = rnd(1.5, 7.5) * power;
      const r = Math.random();
      if (r < 0.5) this.debris.spawn(Piece.Plank, x, y, z, vx, vy, vz, rnd(0.25, 0.7) * power, rnd(0.3, 0.6), rnd(0.25, 0.55), rnd(8, 15), 1.4);
      else if (r < 0.78) this.debris.spawn(Piece.Splinter, x, y, z, vx * 1.2, vy, vz * 1.2, rnd(0.25, 0.8) * power, rnd(0.8, 1.6), rnd(0.8, 1.6), rnd(8, 14), 1.6);
      else if (r < 0.94) {
        const s = rnd(0.12, 0.32) * power;
        this.debris.spawn(Piece.Chunk, x, y, z, vx * 0.8, vy, vz * 0.8, s, s, s, rnd(8, 14));
      } else {
        const s = rnd(0.6, 1.1) * power;
        this.debris.spawn(Piece.Plank, x, y, z, vx * 0.6, vy * 0.8, vz * 0.6, s * 1.4, s * 0.8, s * 0.8, rnd(12, 20));
      }
    }
  }

  /**
   * The timber a hard blow throws far: boards, splinters and charred lumps leaving the struck face (bx, bz) in a wide
   * cone, some higher than the deckhouse, landing in the sea a ship's beam away. `power` 1 is a medium ball's hit.
   */
  private fling(x: number, y: number, z: number, count: number, power: number, bx: number, bz: number) {
    for (let i = 0; i < count; i += 1) {
      const sp = rnd(4, 13) * power;
      const vx = bx * sp + rnd(-5, 5) * power;
      const vz = bz * sp + rnd(-5, 5) * power;
      const vy = rnd(4, 15) * power;
      const r = Math.random();
      if (i < 2) {
        const s = rnd(0.9, 1.8) * power;
        this.debris.spawn(Piece.Plank, x, y, z, vx * 0.8, vy, vz * 0.8, s, s * 0.7, s * 0.7, rnd(14, 26));
      } else if (r < 0.5) this.debris.spawn(Piece.Splinter, x, y, z, vx * 1.2, vy * 1.1, vz * 1.2, rnd(0.6, 2) * power, rnd(1.2, 2.2), rnd(1.2, 2.2), rnd(10, 20), 1.6);
      else if (r < 0.82) {
        const s = rnd(0.35, 0.9) * power;
        this.debris.spawn(Piece.Plank, x, y, z, vx, vy, vz, s, s, s, rnd(12, 22));
      } else {
        const s = rnd(0.25, 0.7) * power;
        this.debris.spawn(Piece.Chunk, x, y, z, vx * 0.8, vy * 0.9, vz * 0.8, s, s, s, rnd(10, 18));
      }
    }
  }

  /** The hole a heavy hit leaves keeps burning a little: a few flames and a thread of dark smoke, riding with the hull. */
  private smoulder(ship: number, x: number, y: number, z: number, size: number, battle: Battle) {
    const s = battle.get(ship);
    const at = this.views.worldOf(ship);
    if (!s || !at || this.smoulders.length >= Math.round(16 * this.tier)) return;
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    const dx = x - at.x;
    const dz = z - at.z;
    this.smoulders.push({ ship, lx: dx * c + dz * n, ly: y - at.y, lz: -dx * n + dz * c, left: rnd(4, 8) * (0.7 + 0.3 * size), size, acc: 0 });
  }

  private smouldering(battle: Battle, dt: number) {
    for (let i = this.smoulders.length - 1; i >= 0; i -= 1) {
      const m = this.smoulders[i]!;
      const ship = battle.get(m.ship);
      m.left -= dt;
      if (!ship || !ship.alive || ship.sinking > 0.3 || m.left <= 0) {
        this.smoulders.splice(i, 1);
        continue;
      }
      this.views.localToWorld(m.ship, m.lx, m.ly, m.lz, this.p);
      const dying = Math.min(1, m.left / 2);
      m.acc = Math.min(m.acc + (5 + 7 * m.size) * dying * this.k * dt, 6);
      while (m.acc >= 1) {
        m.acc -= 1;
        this.fire.emit({ x: this.p.x + rnd(-0.3, 0.3), y: this.p.y + rnd(-0.2, 0.2), z: this.p.z + rnd(-0.3, 0.3), vx: rnd(-0.4, 0.4), vy: rnd(1, 2.5), vz: rnd(-0.4, 0.4), life: rnd(0.35, 0.7), size0: 0.7 * m.size, size1: rnd(1.2, 1.9) * m.size, heat: rnd(0.6, 1), drag: 1.5, lift: 2, wind: 0.5, alpha: 0.85, rot: rnd(-0.15, 0.15), spin: 0.05 });
        if (Math.random() < 0.45) this.smoke.emit({ x: this.p.x, y: this.p.y + 0.8, z: this.p.z, vx: rnd(-0.4, 0.4), vy: rnd(1.2, 2.4), vz: rnd(-0.4, 0.4), life: rnd(5, 9), size0: 0.8, size1: rnd(4, 7) * m.size, alpha: 0.4 * dying, r: 0.22, g: 0.2, b: 0.19, drag: 0.8, lift: 0.5, wind: 1, heat: 0.3 });
      }
      this.sources.push({ x: this.p.x, y: this.p.y + 1, z: this.p.z, intensity: 8 * m.size * dying * (0.8 + Math.random() * 0.4), decay: 1, r: 1, g: 0.5, b: 0.2, age: 0, life: 1, dist: 14, once: true });
    }
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
    this.light(x, y + 1, z, 20, 0.1, 1, 0.62, 0.3, 22);
  }

  /**
   * A shot falling into the sea: a tall, narrow column of white water thrown up in a fraction of a second, a crown of
   * water round its foot, drops catching the light, and spray that hangs and drifts after the column has fallen back on
   * itself, then a ring of foam. `size` 1 is a round shot; a great arrow throws more, grape and rocket arrows less.
   */
  splash(x: number, z: number, size: number) {
    const h = waveField.heightAt(x, z);
    const k = Math.sqrt(size);
    // The column: water stood up in tall sprites, flung straight up and falling back on itself, rounding as it falls.
    // A heavy shot throws it taller than a light one by more than its size: a great arrow's column stands over the masts.
    const lift = Math.min(1.5, k * (0.85 + 0.35 * size));
    const jets = Math.round(5 + 8 * size);
    const wide = 0.8 + 0.45 * size;
    for (let i = 0; i < jets; i += 1) {
      const up = rnd(12, 20) * lift * (1 - (i / jets) * 0.4);
      this.spray.emit({ x: x + rnd(-0.35, 0.35) * k, y: h + 0.3, z: z + rnd(-0.35, 0.35) * k, vx: rnd(-0.6, 0.6), vy: up, vz: rnd(-0.6, 0.6), life: rnd(1.6, 2.4), size0: rnd(0.6, 0.9) * k * wide, size1: rnd(1.8, 2.8) * k * wide, alpha: rnd(0.75, 0.92), r: 0.92, g: 0.95, b: 0.97, stretch: rnd(1.8, 3), rot: rnd(-0.08, 0.08), spin: 0.02, drag: 0.3, lift: -9.8, wind: 0.2 });
    }
    // The crown: water thrown out and up round the foot of the column.
    const crown = Math.round(8 + 10 * size);
    for (let i = 0; i < crown; i += 1) {
      const a = (i / crown) * Math.PI * 2 + Math.random() * 0.5;
      const out = rnd(1.5, 4) * k;
      this.spray.emit({ x: x + Math.cos(a) * 0.6 * k, y: h + 0.2, z: z + Math.sin(a) * 0.6 * k, vx: Math.cos(a) * out, vy: rnd(3.5, 7.5) * lift, vz: Math.sin(a) * out, life: rnd(0.8, 1.3), size0: 0.4 * k, size1: rnd(1, 1.7) * k, alpha: rnd(0.6, 0.8), r: 0.93, g: 0.96, b: 0.98, stretch: 0.6, drag: 0.5, lift: -9.8, wind: 0.25 });
    }
    // Drops flung high catch the light as short streaks.
    const boost = Math.min(2.5, this.zoomBoost(x, h, z));
    for (let i = 0; i < this.n(5 * size); i += 1) {
      const a = Math.random() * Math.PI * 2;
      const out = rnd(0.5, 3) * k;
      this.streaks.emit({ x, y: h + 0.8, z, vx: Math.cos(a) * out, vy: rnd(9, 16) * lift, vz: Math.sin(a) * out, life: rnd(0.9, 1.5), minLen: 0.3, stretch: 0.03, width: 0.08 * boost * k, r: 0.78, g: 0.86, b: 0.95, alpha: 0.4, gravity: 9.8, drag: 0.1 });
    }
    // The mist the falling column leaves: it comes up from the foot as the water comes down, hangs low over the sea
    // and drifts off thinning.
    for (let i = 0; i < Math.round(3 + 3 * size); i += 1) {
      this.spray.emit({ x: x + rnd(-1.5, 1.5) * k, y: h + rnd(0.5, 3) * lift, z: z + rnd(-1.5, 1.5) * k, vx: rnd(-0.8, 0.8), vy: rnd(0.2, 1), vz: rnd(-0.8, 0.8), life: rnd(3, 5), size0: 2 * k, size1: rnd(6, 9) * k, alpha: rnd(0.14, 0.22), r: 0.88, g: 0.92, b: 0.95, drag: 0.9, lift: 0.04, wind: 1 });
    }
    this.wake?.stamp(x, z, 0, 3 + 3 * size, 0.45 * Math.min(1.5, size), 1, 1.3);
  }

  ram(x: number, z: number, power: number) {
    this.shatter(x, 3, z, this.n(26), 1.2, 8);
    this.splash(x, z, 0.9 + Math.min(1, power * 0.15));
  }

  /** Fire carried from a burning ship to its neighbour (the battle depth rules): embers arcing across the gap. */
  private embers(fromId: number, toId: number, battle: Battle) {
    const from = battle.get(fromId);
    const to = battle.get(toId);
    if (!from || !to) return;
    this.views.localToWorld(fromId, 0, this.deckOf(from) + 2, 0, this.p);
    const sx = this.p.x;
    const sy = this.p.y;
    const sz = this.p.z;
    this.views.localToWorld(toId, 0, this.deckOf(to), 0, this.p);
    const boost = this.zoomBoost(sx, sy, sz);
    const gravity = 6;
    for (let i = 0; i < this.n(18); i += 1) {
      const t = rnd(0.9, 1.3);
      const x = sx + rnd(-2, 2);
      const z = sz + rnd(-2, 2);
      this.streaks.emit({ x, y: sy, z, vx: (this.p.x - x) / t + rnd(-1.5, 1.5), vy: (this.p.y - sy) / t + (gravity * t) / 2 + rnd(-1, 1), vz: (this.p.z - z) / t + rnd(-1.5, 1.5), life: t, minLen: 0.2, stretch: 0.04, width: 0.16 * boost, r: 1, g: rnd(0.45, 0.7), b: 0.15, gravity, drag: 0 });
    }
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
      st = { plan: planSinking(ship.id, MASTS[modelKind(ship.spec.kind)] ?? 1, ship.spec.length), next: 0, bubbles: 0, slick: 0, bubbleUntil: 0 };
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
      // Churn more than foam: the stamps add up over the seconds of a sinking, and foam that saturates draws a white disc.
      this.wake?.stamp(ship.x, ship.z, ship.heading, L * 0.55, 0.05 + 0.06 * p, 1.6, 9);
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
        const i = Math.floor(rnd(0, Math.min(MAST_AT.length, MASTS[modelKind(ship.spec.kind)] ?? 1)));
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
    this.wake?.stamp(ship.x, ship.z, ship.heading, L * 0.9, 0.4, 1.2, 4.5);
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
    this.wake?.stamp(ship.x, ship.z, ship.heading, L * 1.1, 0.45, 1, 4.5);
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
      if (!ship.alive || ship.sinking > 0 || ship.struck || !shipObserved(battle, this.views.team, ship)) continue;
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
      const oars = OARS[modelKind(ship.spec.kind)] ?? 8;
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
    return byModel(DECKS, kind).open ? mainDeck(`${kind}#${ship.variant}`, kind, ship.spec.deck) : ship.spec.deck;
  }

  /**
   * The turtle ship's dragon keeps breathing a thin dark smoke through the battle, a great belch when the bow gun fires.
   * Neutral grey: a yellow tint read as a sickly green cloud in sunlight.
   */
  private dragonSmoke(ship: Ship, dt: number) {
    const mouth = anchorsFor('geobukseon#0')?.smokeStack;
    if (!mouth || dt <= 0) return;
    let d = this.dragon.get(ship.id);
    if (!d) this.dragon.set(ship.id, (d = { blast: 0, acc: 0 }));
    d.blast = Math.max(0, d.blast - dt * 0.6);
    d.acc = Math.min(d.acc + (4 + 90 * d.blast) * dt, 10);
    const c = Math.cos(ship.heading);
    const n = Math.sin(ship.heading);
    while (d.acc >= 1) {
      d.acc -= 1;
      this.views.localToWorld(ship.id, mouth[0] + 0.4, mouth[1] + rnd(-0.2, 0.5), rnd(-0.4, 0.4), this.p);
      const sp = rnd(2, 5) + 9 * d.blast;
      this.smoke.emit({ x: this.p.x, y: this.p.y, z: this.p.z, vx: c * sp + rnd(-0.8, 0.8), vy: rnd(0.8, 2.2), vz: n * sp + rnd(-0.8, 0.8), life: rnd(5, 9), size0: rnd(0.8, 1.4), size1: rnd(5, 8) * (1 + d.blast * 0.8), alpha: 0.38 + 0.3 * d.blast, r: 0.16, g: 0.16, b: 0.17, drag: 1.3, lift: 0.3, wind: 1, heat: 0.15 });
    }
  }

  private continuous(battle: Battle, dt: number) {
    if (dt > 0) this.rowing(battle, dt);
    for (const ship of battle.ships) {
      if (!ship.alive || !shipObserved(battle, this.views.team, ship)) continue;
      if (ship.spec.kind === 'geobukseon' && ship.sinking === 0) this.dragonSmoke(ship, dt);
      if (ship.sinking > 0) this.sinking(ship, dt);
      // A hull going down burns on if it was burning; one shot to pieces still shows a few small fires among the wreck.
      const level = ship.fire > 0.02 ? ship.fire : ship.sinking > 0 && ship.sinking < 0.85 ? 0.12 : 0;
      if (level > 0 || this.blaze.has(ship.id)) this.blaze.burn(ship, level, dt);
      else {
        const wreck = 1 - ship.hull / ship.spec.hull;
        if (wreck > 0.45 && ship.sinking === 0 && Math.random() < dt * wreck * 5) {
          this.views.localToWorld(ship.id, rnd(-0.3, 0.3) * ship.spec.length, this.deckOf(ship), rnd(-0.3, 0.3) * ship.spec.beam, this.p);
          this.smoke.emit({ x: this.p.x, y: this.p.y, z: this.p.z, vx: rnd(-0.5, 0.5), vy: rnd(1.5, 3), vz: rnd(-0.5, 0.5), life: rnd(8, 14), size0: 2, size1: rnd(10, 16), alpha: 0.45, r: 0.35, g: 0.33, b: 0.31, drag: 0.8, lift: 0.4, wind: 1 });
        }
      }
      if (ship.sinking > 0 && ship.sinking < 0.85 && Math.random() < dt * 6) {
        this.views.localToWorld(ship.id, rnd(-0.45, 0.45) * ship.spec.length, 0, rnd(-0.5, 0.5) * ship.spec.beam, this.p);
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
    if (kind === Shell.Hiya) {
      // A fire arrow trails the dark smoke of its burning tow and a few sparks of flame.
      this.smoke.emit({ x, y, z, vx: rnd(-0.3, 0.3), vy: rnd(0, 0.5), vz: rnd(-0.3, 0.3), life: rnd(1.2, 2.2), size0: 1.2 * k, size1: rnd(2.8, 3.6) * k, alpha: 0.26, r: 0.34, g: 0.32, b: 0.3, drag: 1.4, lift: 0.1, wind: 0.6, heat: 0.5 });
      this.fire.emit({ x, y, z, life: rnd(0.15, 0.3), size0: 0.55 * k, size1: 0.15, alpha: 0.7, heat: 0.9, drag: 2, wind: 0.2 });
      return;
    }
    // Shot leaves only a faint wisp of its burning wad: a thin grey thread along the arc, gone in a second or so. Each
    // puff starts wider than the gap to the next, so the thread never breaks up into beads.
    this.smoke.emit({ x, y, z, vx: rnd(-0.2, 0.2), vy: rnd(0, 0.3), vz: rnd(-0.2, 0.2), life: rnd(0.6, 1.1), size0: 1.3 * k, size1: (rnd(1.8, 2.1) + 0.4 * weight) * k, alpha: 0.035 + 0.03 * weight, r: 0.84, g: 0.84, b: 0.83, drag: 1.4, lift: 0.08, wind: 0.6 });
  }

  /**
   * Lays the smoke ribbon of a shell along its drawn arc up to (px, py, pz): a puff every few pixels of screen, so the
   * arc reads as a ribbon and not as beads. `trail` remembers where the last puff went.
   */
  private layTrail(trail: Trail, px: number, py: number, pz: number, ppm: number, crowd: number, kind: ShellKind, weight: number) {
    const rocket = kind === Shell.Rocket || kind === Shell.Lance;
    // The closest spacing keeps a shot's thin puffs touching, so a near trail is a thread and not a string of beads.
    const base = rocket ? 2 : kind === Shell.Hiya ? 1.8 : 1.2;
    const spacing = Math.min(10, Math.max(base, 4.5 / ppm) * crowd);
    const run = Math.hypot(px - trail.x, py - trail.y, pz - trail.z);
    if (run < spacing) return;
    const puffs = Math.min(rocket ? 8 : 16, Math.floor(run / spacing));
    const k = Math.max(1, spacing / base);
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
    const end = p.age + timeToImpact(p, battle, this.seaAt, this.shipRate, this.views.team);
    const peak = arcPeak(p.ammo, Math.hypot(p.vx, p.vz) * end);
    // Ships turn, drift and are steered after the plan was made: plan again as the shell flies and ease toward the new answer.
    f.end += (end - f.end) * blend;
    f.peak += (peak - f.peak) * blend;
    f.next = p.age + (end - p.age < 0.5 ? 0.08 : 0.25);
  }

  update(battle: Battle, dt: number, camera: Camera) {
    this.rowCam = camera;
    this.battleRef = battle;
    this.continuous(battle, dt);
    this.smouldering(battle, dt);
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
      if (p.team !== this.views.team && !pointVisible(battle, this.views.team, p.x, p.z)) continue;
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
          if (f.ghost < 0) this.mun.salvo(p, f.end - p.age, f.peak, battle, this.views.team);
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
          this.mun.heavyArrow(px, py, pz, ux, uy, uz, sp, ppm, p.gun, p.age, p.id);
          break;
        case Shell.Hiya:
          this.mun.fireArrow(px, py, pz, ux, uy, uz, ppm);
          break;
        case Shell.Rocket:
          this.mun.rocket(px, py, pz, ux, uy, uz, 1.13, ppm, dt);
          break;
        case Shell.Lance:
          this.mun.rocket(px, py, pz, ux, uy, uz, 1.31, ppm, dt);
          break;
        case Shell.Grape:
          this.mun.grape(px, py, pz, ux, uy, uz, sp, ppm, p.id, p.age, p.gun);
          break;
        default:
          this.mun.ball(px, py, pz, ux, uy, uz, sp, ppm, p.gun, p.age);
      }
    }
    this.mun.fly(dt, this.camPos.x, this.camPos.y, this.camPos.z, focal, this.layRocket, (x, z) => pointVisible(battle, this.views.team, x, z));
    this.scars.update(dt, battle, this.camPos.x, this.camPos.y, this.camPos.z, focal);
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
    this.blaze.update(dt, this.windX, this.windZ, camera);
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
      s.score = (s.intensity * fade * (s.rank ?? 1)) / (1 + (cam.distanceTo(this.v.set(s.x, s.y, s.z)) / 300) ** 2);
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
