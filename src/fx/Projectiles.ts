import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import { dot, float, normalView, positionViewDirection, pow, saturate, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Battle } from '../sim/battle';
import type { GunType, Projectile } from '../sim/types';
import type { ShipViews } from '../ships/ShipViews';
import { waveField } from '../ocean/waves';
import type { ParticleLayer, StreakLayer } from './ParticleLayer';

/**
 * How the things guns throw are modelled and drawn: the round iron shot (and grape, a spread of small balls), the
 * great general arrow (daejanggun-jeon) of the heavy Joseon guns, the Japanese fire arrow (hiya) and the Joseon
 * rocket arrow (singijeon), fired in salvos. Everything here is looks only: the sim decides every hit, and the extra
 * rockets of a salvo are cosmetic. One instanced mesh per model, flat arrays for the pools, nothing allocated per frame.
 */

/** How a shell in flight is drawn. */
export const Shell = { Ball: 0, Grape: 1, Heavy: 2, Hiya: 3, Rocket: 4, Lance: 5 } as const;
export type ShellKind = (typeof Shell)[keyof typeof Shell];

/** Which shell a gun's round is drawn as: fire ammo is a rocket from a Joseon or Ming gun and a flaming arrow from a Japanese one. */
export function shellKind(ammo: Projectile['ammo'], gun: GunType): ShellKind {
  if (ammo === 'grape') return Shell.Grape;
  if (ammo === 'arrow') return Shell.Heavy;
  if (ammo === 'fire') return gun === 'ozutsu' ? Shell.Hiya : gun === 'folangji' || gun === 'hudun' ? Shell.Lance : Shell.Rocket;
  return Shell.Ball;
}

/** A smoke trail's last laid point. */
export type Trail = { x: number; y: number; z: number };

const MAX_NEAR = 400;
const MAX_FAR = 900;
const MAX_HEAVY = 300;
const MAX_STUCK = 72;
const BALL_NEAR_PX = 4.5;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** A repeatable pseudo-random number from a seed, for the offsets of a grape load that must not jump between frames. */
const hash = (a: number) => {
  const x = Math.sin(a * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type Part = { geo: BufferGeometry; color: [number, number, number] };

/** Parts merged into one geometry with a colour per vertex, so a model with an iron head and a wooden shaft is one draw. */
function assemble(parts: Part[]): BufferGeometry {
  const geos = parts.map(({ geo, color }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      c[i * 3] = color[0];
      c[i * 3 + 1] = color[1];
      c[i * 3 + 2] = color[2];
    }
    g.setAttribute('color', new BufferAttribute(c, 3));
    return g;
  });
  return mergeGeometries(geos)!;
}

/** A cylinder lying along x from x0 to x1. */
const rod = (r0: number, r1: number, x0: number, x1: number, seg = 8) => {
  const g = new CylinderGeometry(r1, r0, x1 - x0, seg);
  g.rotateZ(Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, 0);
  return g;
};
/** A cone lying along x with its point at x1. */
const spike = (r: number, x0: number, x1: number, seg = 8) => {
  const g = new ConeGeometry(r, x1 - x0, seg);
  g.rotateZ(-Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, 0);
  return g;
};
/** `count` fins round the shaft, each a thin plate. */
const fins = (x: number, len: number, span: number, count: number): BufferGeometry[] => {
  const out: BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const f = new BoxGeometry(len, 0.008, span);
    f.translate(x, 0, 0);
    f.rotateX((i * Math.PI) / count);
    out.push(f);
  }
  return out;
};

const WOOD: [number, number, number] = [0.11, 0.07, 0.04];
const IRON: [number, number, number] = [0.07, 0.068, 0.07];
const FEATHER: [number, number, number] = [0.34, 0.3, 0.23];
const PAPER: [number, number, number] = [0.33, 0.26, 0.16];
const CORD: [number, number, number] = [0.16, 0.1, 0.06];

/** The great general arrow: an oak shaft as thick as a wrist, an iron collar and head, three fins. About 1.4 units long. */
function heavyGeometry() {
  const parts: Part[] = [
    { geo: rod(0.04, 0.045, -0.62, 0.5), color: WOOD },
    { geo: rod(0.062, 0.062, 0.44, 0.54), color: IRON },
    { geo: spike(0.082, 0.52, 0.78), color: IRON },
    ...fins(-0.48, 0.3, 0.2, 3).map((geo) => ({ geo, color: FEATHER })),
    { geo: rod(0.05, 0.05, -0.36, -0.31), color: CORD },
  ];
  return assemble(parts);
}

/** A Japanese fire arrow: a thin shaft, a small head and a charred bundle of tow bound behind it. About 1 unit long. */
function hiyaGeometry() {
  const parts: Part[] = [
    { geo: rod(0.011, 0.011, -0.5, 0.42, 6), color: WOOD },
    { geo: spike(0.022, 0.4, 0.52, 6), color: IRON },
    { geo: rod(0.034, 0.03, 0.2, 0.4, 6), color: [0.05, 0.03, 0.02] },
    ...fins(-0.44, 0.18, 0.07, 2).map((geo) => ({ geo, color: FEATHER })),
  ];
  return assemble(parts);
}

/** A rocket arrow: a paper tube of black powder tied to the front of the shaft, an iron head, feathers behind. About 1.2 units long. */
function rocketGeometry() {
  const parts: Part[] = [
    { geo: rod(0.012, 0.012, -0.5, 0.56, 6), color: WOOD },
    { geo: rod(0.05, 0.05, 0.05, 0.4, 10), color: PAPER },
    { geo: rod(0.054, 0.054, 0.09, 0.115, 10), color: CORD },
    { geo: rod(0.054, 0.054, 0.3, 0.325, 10), color: CORD },
    { geo: spike(0.052, 0.4, 0.5, 10), color: PAPER },
    { geo: spike(0.026, 0.54, 0.72, 6), color: IRON },
    ...fins(-0.44, 0.2, 0.09, 2).map((geo) => ({ geo, color: FEATHER })),
  ];
  return assemble(parts);
}

/** Visual size of each heavy gun's arrow (metres per model unit). */
const heavyScale = (gun: GunType) => (gun === 'cheonja' ? 2.3 : gun === 'jija' ? 1.9 : 1.5);

/** Where a rocket's flame leaves it, in model units from its origin. */
const NOZZLE = 0.05;

type SalvoHook = (x: number, y: number, z: number, hull: boolean) => void;

export class Munitions {
  readonly group = new Group();
  private readonly near: InstancedMesh;
  private readonly far: InstancedMesh;
  private readonly heavy: InstancedMesh;
  private readonly hiya: InstancedMesh;
  private readonly rockets: InstancedMesh;
  private nNear = 0;
  private nFar = 0;
  private nHeavy = 0;
  private nHiya = 0;
  private nRocket = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly p = new Vector3();
  private readonly xAxis = new Vector3(1, 0, 0);
  /** Cosmetic rockets of a salvo: where each starts and lands, its clock and its smoke trail. */
  private readonly cap: number;
  private count = 0;
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;
  private readonly sz: Float32Array;
  private readonly ex: Float32Array;
  private readonly ey: Float32Array;
  private readonly ez: Float32Array;
  private readonly dur: Float32Array;
  /** Seconds flown; negative while the rocket waits its turn in the volley. */
  private readonly t: Float32Array;
  private readonly peak: Float32Array;
  private readonly seed: Float32Array;
  private readonly size: Float32Array;
  private readonly hull: Uint8Array;
  private readonly trails: Trail[];
  /** Arrows sticking in hulls: the ship, the hit in that ship's frame, the direction, and how long they stay. */
  private nStuck = 0;
  private readonly kShip = new Int32Array(MAX_STUCK);
  private readonly kLx = new Float32Array(MAX_STUCK);
  private readonly kLy = new Float32Array(MAX_STUCK);
  private readonly kLz = new Float32Array(MAX_STUCK);
  private readonly kYaw = new Float32Array(MAX_STUCK);
  private readonly kHeading = new Float32Array(MAX_STUCK);
  private readonly kPitch = new Float32Array(MAX_STUCK);
  private readonly kScale = new Float32Array(MAX_STUCK);
  private readonly kAge = new Float32Array(MAX_STUCK);
  private readonly kLife = new Float32Array(MAX_STUCK);
  private readonly kKind = new Uint8Array(MAX_STUCK);
  private k = 1;
  /** Rockets per sim fire shot, by equipment class. */
  private readonly perShot: number;
  onLand: SalvoHook | null = null;

  constructor(
    private readonly views: ShipViews,
    private readonly smoke: ParticleLayer,
    private readonly fire: ParticleLayer,
    private readonly streaks: StreakLayer,
    tier: number,
  ) {
    // Dark forged iron: a soft sheen from the sun and sky, and a faint cold rim so the black sphere keeps its outline on dark water.
    const iron = () => {
      const m = new MeshStandardNodeMaterial({ color: new Color(0.075, 0.072, 0.07), roughness: 0.5, metalness: 0.85 });
      const facing = saturate(dot(normalView, positionViewDirection));
      m.emissiveNode = vec3(0.2, 0.21, 0.23).mul(pow(float(1).sub(facing), 3.2)).mul(0.5);
      return m;
    };
    const ironMat = iron();
    this.near = new InstancedMesh(new SphereGeometry(1, 22, 15), ironMat, MAX_NEAR);
    this.far = new InstancedMesh(new SphereGeometry(1, 8, 6), ironMat, MAX_FAR);
    const wood = () => new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05, emissive: new Color(0.025, 0.016, 0.008) });
    this.heavy = new InstancedMesh(heavyGeometry(), wood(), MAX_HEAVY + MAX_STUCK);
    this.hiya = new InstancedMesh(hiyaGeometry(), wood(), MAX_HEAVY + MAX_STUCK);
    this.rockets = new InstancedMesh(rocketGeometry(), wood(), Math.round(240 * tier) + 60);
    for (const mesh of [this.near, this.far, this.heavy, this.hiya, this.rockets]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      this.group.add(mesh);
    }
    this.cap = Math.round(170 * tier);
    const f = () => new Float32Array(this.cap);
    this.sx = f();
    this.sy = f();
    this.sz = f();
    this.ex = f();
    this.ey = f();
    this.ez = f();
    this.dur = f();
    this.t = f();
    this.peak = f();
    this.seed = f();
    this.size = f();
    this.hull = new Uint8Array(this.cap);
    this.trails = Array.from({ length: this.cap }, () => ({ x: 0, y: 0, z: 0 }));
    this.perShot = tier >= 1 ? 5 : tier >= 0.7 ? 3 : 2;
  }

  setKeep(k: number) {
    this.k = k;
  }

  /** A new battle: shell ids restart, and the arrows of the last one are gone with its ships. */
  clear() {
    this.count = 0;
    this.nStuck = 0;
  }

  /** Cosmetic rockets in the air or waiting their turn (the probes read it). */
  get rocketsInFlight() {
    return this.count;
  }

  /** Arrows sticking in hulls now (the probes read it). */
  get stuckArrows() {
    return this.nStuck;
  }

  // ---- Per frame -------------------------------------------------------------------------------------------------

  begin() {
    this.nNear = this.nFar = this.nHeavy = this.nHiya = this.nRocket = 0;
  }

  end() {
    this.near.count = this.nNear;
    this.far.count = this.nFar;
    this.heavy.count = this.nHeavy;
    this.hiya.count = this.nHiya;
    this.rockets.count = this.nRocket;
    for (const mesh of [this.near, this.far, this.heavy, this.hiya, this.rockets]) mesh.instanceMatrix.needsUpdate = true;
  }

  // ---- Round shot -------------------------------------------------------------------------------------------------

  private putBall(x: number, y: number, z: number, r: number, ppm: number) {
    this.m.makeScale(r, r, r).setPosition(x, y, z);
    if (r * ppm > BALL_NEAR_PX) {
      if (this.nNear < MAX_NEAR) this.near.setMatrixAt(this.nNear++, this.m);
    } else if (this.nFar < MAX_FAR) this.far.setMatrixAt(this.nFar++, this.m);
  }

  /** A soft smear of the motion, only when the shell crosses enough of the screen in a frame for the eye to blur it. */
  private smear(x: number, y: number, z: number, ux: number, uy: number, uz: number, speed: number, ppm: number, width: number, strength: number) {
    const a = smooth(10, 55, (speed * ppm) / 60) * strength;
    if (a < 0.02) return;
    this.streaks.put(x, y, z, ux, uy, uz, Math.min(14, speed / 60), width, 0.82, 0.78, 0.72, a);
  }

  /**
   * A round shot: a lit iron sphere that grows with distance so it keeps at least 3.3 px of radius, never more than
   * a metre or so while the camera is close. Grape is a handful of small balls fanning out of the muzzle.
   */
  ball(x: number, y: number, z: number, ux: number, uy: number, uz: number, speed: number, ppm: number, weight: number) {
    const r = Math.min(16, Math.max(0.14, 3.3 / ppm)) * (0.85 + 0.35 * weight);
    this.putBall(x, y, z, r, ppm);
    this.smear(x, y, z, ux, uy, uz, speed, ppm, r * 2.2, 0.3);
    // A dark ball on dark water is hard to find from afar: a faint pale halo lifts it while it is only a few pixels across.
    const halo = 0.16 * (1 - smooth(3, 8, r * ppm));
    if (halo > 0.01) this.streaks.put(x, y, z, ux, uy, uz, r * 3, r * 3, 0.8, 0.8, 0.78, halo);
  }

  grape(x: number, y: number, z: number, ux: number, uy: number, uz: number, speed: number, ppm: number, id: number, age: number) {
    const n = this.perShot + 2;
    const spread = Math.min(7, 0.035 * speed * age);
    const r = Math.min(9, Math.max(0.09, 2.2 / ppm));
    let sx = uz;
    let sz = -ux;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    // The second axis across the flight: u x s.
    const bx = uy * sz;
    const by = uz * sx - ux * sz;
    const bz = -uy * sx;
    for (let i = 0; i < n; i += 1) {
      const a = hash(id * 7.13 + i * 2.7) * Math.PI * 2;
      const rho = (0.3 + 0.7 * hash(id * 3.71 + i * 1.93)) * spread;
      const c = Math.cos(a) * rho;
      const s = Math.sin(a) * rho;
      const lag = hash(id * 1.37 + i * 5.1) * 0.012 * speed * Math.min(1, age * 3);
      this.putBall(x + sx * c + bx * s - ux * lag, y + by * s - uy * lag, z + sz * c + bz * s - uz * lag, r, ppm);
    }
    this.smear(x, y, z, ux, uy, uz, speed, ppm, r * 2.5, 0.16);
  }

  // ---- Arrows -----------------------------------------------------------------------------------------------------

  /** The great general arrow, pitched along the arc. Big when far, so it still reads. */
  heavyArrow(x: number, y: number, z: number, ux: number, uy: number, uz: number, speed: number, ppm: number, gun: GunType) {
    if (this.nHeavy >= MAX_HEAVY) return;
    const sc = Math.min(12, Math.max(heavyScale(gun), 9 / (1.4 * ppm)));
    this.q.setFromUnitVectors(this.xAxis, this.v.set(ux, uy, uz));
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sc, sc, sc));
    this.heavy.setMatrixAt(this.nHeavy++, this.m);
    this.smear(x, y, z, ux, uy, uz, speed, ppm, sc * 0.12, 0.18);
  }

  /** A Japanese fire arrow: a thin arrow with a burning bundle at its head. */
  fireArrow(x: number, y: number, z: number, ux: number, uy: number, uz: number, ppm: number) {
    if (this.nHiya >= MAX_HEAVY) return;
    const sc = Math.min(8, Math.max(1.2, 6 / ppm));
    this.q.setFromUnitVectors(this.xAxis, this.v.set(ux, uy, uz));
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sc, sc, sc));
    this.hiya.setMatrixAt(this.nHiya++, this.m);
    // The burning head: a warm glow and a short tongue of flame trailing from it.
    const head = x + ux * 0.4 * sc;
    const hy = y + uy * 0.4 * sc;
    const hz = z + uz * 0.4 * sc;
    const glow = Math.max(1.2, 6 / ppm);
    this.streaks.put(head, hy, hz, ux, uy, uz, glow * 1.6, glow * 0.8, 1, 0.5, 0.16, 0.5);
    this.streaks.put(head, hy, hz, ux, uy, uz, glow * 0.7, glow * 0.35, 1, 0.82, 0.55, 0.8);
  }

  /** A rocket arrow with its exhaust: a white-hot core and a longer warm flame, and sparks shed behind it. */
  rocket(x: number, y: number, z: number, ux: number, uy: number, uz: number, sc0: number, ppm: number, dt: number) {
    const sc = Math.min(16, Math.max(sc0, 7 / (1.2 * ppm)));
    this.q.setFromUnitVectors(this.xAxis, this.v.set(ux, uy, uz));
    if (this.nRocket < this.rockets.instanceMatrix.count) {
      this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sc, sc, sc));
      this.rockets.setMatrixAt(this.nRocket++, this.m);
    }
    const nx = x + ux * NOZZLE * sc;
    const ny = y + uy * NOZZLE * sc;
    const nz = z + uz * NOZZLE * sc;
    const flick = 0.8 + Math.random() * 0.4;
    const len = Math.max(1.3 * sc * flick, 7 / ppm);
    const w = Math.max(0.2 * sc, 1.8 / ppm);
    // put() draws from its head back along the direction: the head is the nozzle, bright, and the flame fades behind it.
    this.streaks.put(nx, ny, nz, ux, uy, uz, len, w, 1, 0.5, 0.14, 0.85);
    this.streaks.put(nx, ny, nz, ux, uy, uz, len * 0.42, w * 0.45, 1, 0.9, 0.66, 0.95);
    this.fire.emit({ x: nx - ux * 0.3 * sc, y: ny - uy * 0.3 * sc, z: nz - uz * 0.3 * sc, life: 0.08, size0: 0.22 * sc, size1: 0.5 * sc, alpha: 0.55, heat: 1, drag: 4, wind: 0 });
    if (Math.random() < Math.min(1, 8 * dt * this.k)) {
      const sp = rnd(14, 34);
      this.streaks.emit({
        x: nx - ux * len * 0.4,
        y: ny - uy * len * 0.4,
        z: nz - uz * len * 0.4,
        vx: -ux * sp + rnd(-5, 5),
        vy: -uy * sp + rnd(-3, 5),
        vz: -uz * sp + rnd(-5, 5),
        life: rnd(0.2, 0.45),
        minLen: 0.25,
        stretch: 0.03,
        width: Math.max(0.05, 0.8 / ppm),
        r: 1,
        g: rnd(0.55, 0.8),
        b: rnd(0.2, 0.35),
        gravity: 8,
        drag: 0.6,
      });
    }
  }

  /** The kick at the start of a rocket's flight: a white blast of smoke behind it, a flash and a spray of sparks. */
  launch(x: number, y: number, z: number, ux: number, uy: number, uz: number, big: number) {
    for (let i = 0; i < 3; i += 1) {
      this.smoke.emit({ x: x - ux * i, y: y - uy * i + 0.2, z: z - uz * i, vx: -ux * rnd(2, 7) + rnd(-1.5, 1.5), vy: rnd(0.3, 1.8), vz: -uz * rnd(2, 7) + rnd(-1.5, 1.5), life: rnd(2.5, 4), size0: 0.8 * big, size1: rnd(4, 6.5) * big, alpha: 0.5, r: 0.94, g: 0.93, b: 0.9, drag: 1.5, lift: 0.15, wind: 0.8 });
    }
    this.fire.emit({ x: x - ux * 0.6, y: y - uy * 0.6, z: z - uz * 0.6, life: 0.1, size0: 1.2 * big, size1: 2.4 * big, alpha: 0.9, heat: 1, drag: 5, wind: 0 });
    for (let i = 0; i < 3; i += 1) {
      this.streaks.emit({ x, y, z, vx: -ux * rnd(10, 30) + rnd(-7, 7), vy: -uy * rnd(10, 30) + rnd(0, 6), vz: -uz * rnd(10, 30) + rnd(-7, 7), life: rnd(0.3, 0.7), minLen: 0.3, stretch: 0.03, width: 0.1 * big, r: 1, g: rnd(0.55, 0.8), b: 0.25, gravity: 8, drag: 0.5 });
    }
  }

  /** How a rocket's smoke trail wobbles: a small spiral round the line of flight, widening as the motor burns. */
  corkscrew(ux: number, uy: number, uz: number, time: number, seed: number, amp: number, out: Vector3) {
    let sx = uz;
    let sz = -ux;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    const bx = uy * sz;
    const by = uz * sx - ux * sz;
    const bz = -uy * sx;
    const a = time * 15 + seed;
    const c = Math.cos(a) * amp;
    const s = Math.sin(a) * amp;
    return out.set(sx * c + bx * s, by * s, sz * c + bz * s);
  }

  // ---- The salvo --------------------------------------------------------------------------------------------------

  /**
   * A Joseon fire shot is one rocket the sim tracks and several the sim knows nothing of: they leave the same
   * muzzle a beat apart, fan out round its line and come down near where it ends: on the target's deck as a burst of
   * fire, or in the sea as a splash.
   */
  salvo(p: Projectile, remaining: number, peak: number, battle: Battle) {
    const n = Math.min(this.cap - this.count, Math.max(1, Math.round(this.perShot * this.k)));
    if (n <= 0 || remaining < 0.3) return;
    const ex = p.x + p.vx * remaining;
    const ez = p.z + p.vz * remaining;
    const range = Math.hypot(ex - p.x, ez - p.z);
    if (range < 30) return;
    const fx = (ex - p.x) / range;
    const fz = (ez - p.z) / range;
    const spread = Math.min(46, Math.max(9, 0.075 * range));
    for (let j = 0; j < n; j += 1) {
      const i = this.count++;
      const side = rnd(-1, 1) * spread;
      const lon = rnd(-0.5, 0.7) * spread;
      const lx = ex + fx * lon - fz * side;
      const lz = ez + fz * lon + fx * side;
      const dur = remaining * rnd(0.94, 1.06) * (1 + lon / range);
      let hull = 0;
      let ly = waveField.heightAt(lx, lz);
      // Does the rocket come down on an enemy deck? Ships are placed where they will be at that moment.
      for (const s of battle.ships) {
        if (!s.alive || s.team === p.team || s.sinking > 0.5) continue;
        const c = Math.cos(s.heading);
        const sn = Math.sin(s.heading);
        const dx = lx - (s.x + c * s.speed * dur);
        const dz = lz - (s.z + sn * s.speed * dur);
        const along = dx * c + dz * sn;
        const across = -dx * sn + dz * c;
        if (Math.abs(along) < s.spec.length * 0.45 && Math.abs(across) < s.spec.beam * 0.42) {
          hull = 1;
          ly = s.spec.deck + 0.6;
          break;
        }
      }
      this.sx[i] = p.x + rnd(-0.5, 0.5);
      this.sy[i] = p.y + rnd(-0.2, 0.4);
      this.sz[i] = p.z + rnd(-0.5, 0.5);
      this.ex[i] = lx;
      this.ey[i] = ly;
      this.ez[i] = lz;
      this.dur[i] = dur;
      this.t[i] = -rnd(0.04, 0.4);
      this.peak[i] = peak * rnd(0.75, 1.55);
      this.seed[i] = rnd(0, 6.28);
      this.size[i] = rnd(0.85, 1.1);
      this.hull[i] = hull;
      const tr = this.trails[i]!;
      tr.x = this.sx[i]!;
      tr.y = this.sy[i]!;
      tr.z = this.sz[i]!;
    }
  }

  private drop(i: number) {
    const last = --this.count;
    if (i === last) return;
    this.sx[i] = this.sx[last]!;
    this.sy[i] = this.sy[last]!;
    this.sz[i] = this.sz[last]!;
    this.ex[i] = this.ex[last]!;
    this.ey[i] = this.ey[last]!;
    this.ez[i] = this.ez[last]!;
    this.dur[i] = this.dur[last]!;
    this.t[i] = this.t[last]!;
    this.peak[i] = this.peak[last]!;
    this.seed[i] = this.seed[last]!;
    this.size[i] = this.size[last]!;
    this.hull[i] = this.hull[last]!;
    // The trail objects are pooled: swap them, so each keeps its own point.
    const a = this.trails[i]!;
    this.trails[i] = this.trails[last]!;
    this.trails[last] = a;
  }

  /**
   * Flies the cosmetic rockets. `lay` is Effects' trail routine (the same smoke ribbon the sim's shells leave), called
   * with each rocket's trail and its screen scale.
   */
  fly(dt: number, camX: number, camY: number, camZ: number, focal: number, lay: (t: Trail, x: number, y: number, z: number, ppm: number) => void) {
    for (let i = this.count - 1; i >= 0; i -= 1) {
      const t0 = this.t[i]!;
      const t = t0 + dt;
      this.t[i] = t;
      if (t < 0) continue;
      const dur = this.dur[i]!;
      const s = t / dur;
      if (s >= 1) {
        this.onLand?.(this.ex[i]!, this.ey[i]!, this.ez[i]!, this.hull[i] === 1);
        this.drop(i);
        continue;
      }
      const sx = this.sx[i]!;
      const sy = this.sy[i]!;
      const sz = this.sz[i]!;
      const peak = this.peak[i]!;
      const e = s;
      const bx = sx + (this.ex[i]! - sx) * e;
      const bz = sz + (this.ez[i]! - sz) * e;
      const by = sy + (this.ey[i]! - sy) * e + 4 * peak * s * (1 - s);
      const vx = (this.ex[i]! - sx) / dur;
      const vz = (this.ez[i]! - sz) / dur;
      const vy = (this.ey[i]! - sy) / dur + (4 * peak * (1 - 2 * s)) / dur;
      const sp = Math.hypot(vx, vy, vz) || 1;
      const ux = vx / sp;
      const uy = vy / sp;
      const uz = vz / sp;
      const first = t0 < 0;
      const d = Math.max(1, Math.hypot(bx - camX, by - camY, bz - camZ));
      const ppm = focal / d;
      const amp = 0.22 * smooth(0, 0.5, t) * (1 - s * s * s);
      this.corkscrew(ux, uy, uz, t, this.seed[i]!, amp, this.v);
      const px = bx + this.v.x;
      const py = by + this.v.y;
      const pz = bz + this.v.z;
      if (first) this.launch(sx, sy, sz, ux, uy, uz, 1);
      if (d < 3200) {
        this.rocket(px, py, pz, ux, uy, uz, 1.6 * this.size[i]!, ppm, dt);
        lay(this.trails[i]!, px, py, pz, ppm);
      }
    }
  }

  // ---- Arrows stuck in a hull -------------------------------------------------------------------------------------

  /** An arrow that struck a ship stays in the planks for a while, riding with the hull. */
  stick(shipId: number, x: number, y: number, z: number, ux: number, uy: number, uz: number, gun: GunType, kind: 0 | 1, battle: Battle) {
    const ship = battle.get(shipId);
    const at = this.views.worldOf(shipId);
    if (!ship || !at) return;
    let i = this.nStuck;
    if (i >= MAX_STUCK) {
      // The oldest goes first: shift nothing, just overwrite the one closest to leaving.
      let best = 0;
      for (let j = 1; j < MAX_STUCK; j += 1) if (this.kLife[j]! - this.kAge[j]! < this.kLife[best]! - this.kAge[best]!) best = j;
      i = best;
    } else this.nStuck += 1;
    const c = Math.cos(ship.heading);
    const n = Math.sin(ship.heading);
    const dx = x - at.x;
    const dz = z - at.z;
    this.kShip[i] = shipId;
    this.kLx[i] = dx * c + dz * n;
    this.kLz[i] = -dx * n + dz * c;
    this.kLy[i] = y - at.y;
    this.kYaw[i] = Math.atan2(uz, ux);
    this.kHeading[i] = ship.heading;
    this.kPitch[i] = Math.asin(Math.max(-1, Math.min(1, uy)));
    this.kScale[i] = kind === 0 ? heavyScale(gun) * rnd(1.15, 1.3) : 1.6;
    this.kAge[i] = 0;
    this.kLife[i] = kind === 0 ? rnd(14, 22) : rnd(5, 8);
    this.kKind[i] = kind;
  }

  /** Draws the stuck arrows and retires old ones and those of ships that are gone. */
  stuck(dt: number, battle: Battle, camX: number, camY: number, camZ: number, focal: number) {
    for (let i = this.nStuck - 1; i >= 0; i -= 1) {
      const age = (this.kAge[i] = this.kAge[i]! + dt);
      const ship = battle.get(this.kShip[i]!);
      const left = this.kLife[i]! - age;
      if (!ship || !ship.alive || ship.sinking > 0.6 || left <= 0) {
        const last = --this.nStuck;
        if (i !== last) {
          this.kShip[i] = this.kShip[last]!;
          this.kLx[i] = this.kLx[last]!;
          this.kLy[i] = this.kLy[last]!;
          this.kLz[i] = this.kLz[last]!;
          this.kYaw[i] = this.kYaw[last]!;
          this.kHeading[i] = this.kHeading[last]!;
          this.kPitch[i] = this.kPitch[last]!;
          this.kScale[i] = this.kScale[last]!;
          this.kAge[i] = this.kAge[last]!;
          this.kLife[i] = this.kLife[last]!;
          this.kKind[i] = this.kKind[last]!;
        }
        continue;
      }
      const heavy = this.kKind[i] === 0;
      if (heavy ? this.nHeavy >= MAX_HEAVY + MAX_STUCK : this.nHiya >= MAX_HEAVY + MAX_STUCK) continue;
      this.views.localToWorld(this.kShip[i]!, this.kLx[i]!, this.kLy[i]!, this.kLz[i]!, this.p);
      const d = Math.max(1, Math.hypot(this.p.x - camX, this.p.y - camY, this.p.z - camZ));
      const yaw = this.kYaw[i]! + (ship.heading - this.kHeading[i]!);
      const pit = this.kPitch[i]!;
      const cp = Math.cos(pit);
      const ux = Math.cos(yaw) * cp;
      const uy = Math.sin(pit);
      const uz = Math.sin(yaw) * cp;
      // Stays a readable size from afar; leaves by shrinking into the planks.
      const sc = Math.max(this.kScale[i]!, (heavy ? 5 : 4) / ((focal / d) * 1.2)) * smooth(0, 0.8, left);
      // The origin sits back from the hit so that the head is buried: about a third of a heavy arrow's length shows.
      const back = (heavy ? 0.3 : 0.24) * sc;
      const ox = this.p.x - ux * back;
      const oy = this.p.y - uy * back;
      const oz = this.p.z - uz * back;
      this.q.setFromUnitVectors(this.xAxis, this.v.set(ux, uy, uz));
      this.m.compose(this.p.set(ox, oy, oz), this.q, this.s.set(sc, sc, sc));
      if (heavy) this.heavy.setMatrixAt(this.nHeavy++, this.m);
      else {
        this.hiya.setMatrixAt(this.nHiya++, this.m);
        if (Math.random() < Math.min(1, 6 * dt)) {
          this.fire.emit({ x: ox, y: oy + 0.2, z: oz, vy: 1.2, life: rnd(0.3, 0.6), size0: 0.5, size1: 0.2, heat: 1, drag: 1, lift: 1.5 });
        }
      }
    }
  }
}
