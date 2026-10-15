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
import type { GunType, Projectile, Team } from '../sim/types';
import { shipObserved } from '../sim/observation';
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
/** Below this radius in pixels an iron ball is not drawn at all: its tracer carries it. */
const BALL_MIN_PX = 0.35;
/** The shortest a tracer gets on screen, in pixels, so a shot stays readable from RTS height. */
const TRACER_PX = 18;
/** The narrowest, in pixels: thinner than this a streak flickers as it crosses pixel rows. */
const TRACER_WIDTH_PX = 2.2;

/**
 * The ball each gun fires, in metres across: half a centimetre under the bore of the surviving pieces (cheonja 13 cm,
 * jija 10.5, hyeonja 7.5, hwangja and seungja 4), a 100-monme lead ball for the Japanese o-zutsu, a folangji ball, and
 * the large stone or lead ball a hudun puts over its small shot (bore about two Ming inches).
 */
const CALIBRE: Record<GunType, number> = { cheonja: 0.125, jija: 0.1, hyeonja: 0.07, hwangja: 0.035, seungja: 0.035, ozutsu: 0.04, folangji: 0.044, hudun: 0.06 };
/** Grape: the "bird's egg" iron shot of the cheonja and jija, the small iron shot of the lighter guns, the hudun's lead. */
const pellet = (gun: GunType) => (gun === 'cheonja' || gun === 'jija' ? 0.022 : gun === 'hudun' ? 0.0145 : 0.016);

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

/** Three iron vanes 120 degrees apart, each a thin plate standing out from the shaft between radius r0 and r1. */
const vanes = (x0: number, x1: number, r0: number, r1: number): BufferGeometry[] => {
  const out: BufferGeometry[] = [];
  for (let i = 0; i < 3; i += 1) {
    const f = new BoxGeometry(x1 - x0, r1 - r0, 0.004);
    f.translate((x0 + x1) / 2, (r0 + r1) / 2, 0);
    f.rotateX((i * 2 * Math.PI) / 3);
    out.push(f);
  }
  return out;
};

/** Thorn wood, pale reddish brown, of the shaft of a gun arrow. */
const THORN: [number, number, number] = [0.26, 0.14, 0.08];
/** Blackened forged iron of its sleeve, bands, head and vanes, darker than the wood by enough to read in the sun. */
const FORGED: [number, number, number] = [0.03, 0.03, 0.033];

/**
 * A gun arrow at the measures of the jija's janggun-jeon in the Yungwon pilbi (1813), which match the arrow kept by the
 * Kuki family: 1.92 m, 9.4 cm thick, a forged iron sleeve over its front 0.51 m, a socketed four-sided iron head of
 * 10.4 cm, three iron vanes of 35 cm held by four iron bands at the tail. The vanes may stand no wider than the bore,
 * since the arrow is loaded down the muzzle. The origin is the middle of the shaft; the other guns' arrows are this
 * one stretched (ARROW_FORM).
 */
function heavyGeometry() {
  const parts: Part[] = [
    { geo: rod(0.033, 0.045, -0.96, 0.32, 10), color: THORN },
    { geo: rod(0.047, 0.047, 0.3, 0.83, 10), color: FORGED },
    ...[0.34, 0.56, 0.79].map((x) => ({ geo: rod(0.051, 0.051, x, x + 0.025, 10), color: FORGED })),
    { geo: rod(0.03, 0.03, 0.82, 0.86, 8), color: FORGED },
    { geo: spike(0.045, 0.856, 0.96, 4), color: FORGED },
    ...vanes(-0.95, -0.6, 0.03, 0.052).map((geo) => ({ geo, color: FORGED })),
    ...[-0.94, -0.83, -0.72, -0.62].map((x) => ({ geo: rod(0.037, 0.037, x, x + 0.018, 8), color: FORGED })),
  ];
  return assemble(parts);
}

/** The model's length and the janggun-jeon's thickness it is built at, in metres. */
const ARROW_LEN = 1.92;
const ARROW_GIRTH = 0.094;

/**
 * Each gun's arrow (weapons table): length and thickness in metres. Cheonja: the daejanggun-jeon, 2.1 m by 10.5 cm (its
 * proportions estimated from the bore); jija: the janggun-jeon; hyeonja: the chadae-jeon, 1.32 m by 4.6 cm; hwangja: the
 * leather-vaned piryeong chajung-jeon, 1.31 m by 3.5 cm; the small guns' wooden arrows about 1.2 m.
 */
const ARROW_FORM: Partial<Record<GunType, [number, number]>> = { cheonja: [2.1, 0.105], jija: [1.92, 0.094], hyeonja: [1.32, 0.046], hwangja: [1.31, 0.035] };
const arrowForm = (gun: GunType): [number, number] => ARROW_FORM[gun] ?? [1.2, 0.035];

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
  /** A gun arrow's thickness scale against its length scale (kScale); 1 for a fire arrow. */
  private readonly kGirth = new Float32Array(MAX_STUCK);
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

  /** An iron ball at its true size, or nothing while it would be under a pixel. */
  private putBall(x: number, y: number, z: number, r: number, ppm: number) {
    const px = r * ppm;
    if (px < BALL_MIN_PX) return;
    this.m.makeScale(r, r, r).setPosition(x, y, z);
    if (px > BALL_NEAR_PX) {
      if (this.nNear < MAX_NEAR) this.near.setMatrixAt(this.nNear++, this.m);
    } else if (this.nFar < MAX_FAR) this.far.setMatrixAt(this.nFar++, this.m);
  }

  /**
   * The tracer: what a film frame makes of a shot crossing it, a streak as long as a 1/40 s exposure's blur, kept to at
   * least TRACER_PX pixels so the shot reads from RTS height. Hot near the gun, where grains of powder still burn on the
   * shot and its wad, then cooling to a dull glint. `strength` scales it for the things that are not hot iron.
   */
  private tracer(x: number, y: number, z: number, ux: number, uy: number, uz: number, speed: number, ppm: number, r: number, age: number, strength: number) {
    const len = Math.max(speed / 40, TRACER_PX / ppm);
    const width = Math.max(2 * r, TRACER_WIDTH_PX / ppm);
    const heat = 1 - 0.5 * smooth(0.1, 1.2, age);
    // Close by the blur is long and the eye sees the dark ball in it: the glow is kept for the shot seen from afar.
    const near = 1 - 0.5 * smooth(40, 200, (speed / 40) * ppm);
    this.streaks.put(x, y, z, ux, uy, uz, len, width, 1, 0.3 + 0.22 * heat, 0.08 + 0.1 * heat, (0.5 + 0.4 * heat) * strength * near);
  }

  /** A round shot: the iron ball at its gun's calibre and its tracer. */
  ball(x: number, y: number, z: number, ux: number, uy: number, uz: number, speed: number, ppm: number, gun: GunType, age: number) {
    const r = CALIBRE[gun] * 0.5;
    this.putBall(x, y, z, r, ppm);
    this.tracer(x, y, z, ux, uy, uz, speed, ppm, r, age, 1);
  }

  /** Grape: a handful of small balls fanning out of the muzzle, each a thin, dimmer tracer of its own. */
  grape(x: number, y: number, z: number, ux: number, uy: number, uz: number, speed: number, ppm: number, id: number, age: number, gun: GunType) {
    const n = this.perShot + 2;
    const spread = Math.min(7, 0.035 * speed * age);
    const r = pellet(gun) * 0.5;
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
      const px = x + sx * c + bx * s - ux * lag;
      const py = y + by * s - uy * lag;
      const pz = z + sz * c + bz * s - uz * lag;
      this.putBall(px, py, pz, r, ppm);
      this.tracer(px, py, pz, ux, uy, uz, speed, ppm, r, age, 0.4);
    }
  }

  // ---- Arrows -----------------------------------------------------------------------------------------------------

  /**
   * A gun arrow, pitched along the arc, at its true length and thickness while it is 8 pixels long or more; from
   * further off it may grow to 1.6 times that, and the tracer of the wad burning behind it does the rest. Its straight
   * iron vanes do not spin it: it leaves the muzzle with a small yaw that dies out within a second or so.
   */
  heavyArrow(x: number, y: number, z: number, ux: number, uy: number, uz: number, speed: number, ppm: number, gun: GunType, age: number, id: number) {
    if (this.nHeavy >= MAX_HEAVY) return;
    const [len, girth] = arrowForm(gun);
    const grow = Math.min(1.6, Math.max(1, 8 / (len * ppm)));
    const sl = (len / ARROW_LEN) * grow;
    const sg = (girth / ARROW_GIRTH) * grow;
    const wob = 0.06 * Math.exp(-age / 0.4) * Math.sin(age * (14 + 8 * hash(id)) + hash(id * 3.1) * 6.28);
    this.v.set(ux + uz * wob, uy + wob * 0.6, uz - ux * wob).normalize();
    this.q.setFromUnitVectors(this.xAxis, this.v);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sl, sg, sg));
    this.heavy.setMatrixAt(this.nHeavy++, this.m);
    const tail = 0.96 * sl;
    this.tracer(x - ux * tail, y - uy * tail, z - uz * tail, ux, uy, uz, speed, ppm, girth * 0.5 * grow, age, 0.45);
  }

  /** A Japanese fire arrow: a thin arrow with a burning bundle at its head. */
  fireArrow(x: number, y: number, z: number, ux: number, uy: number, uz: number, ppm: number) {
    if (this.nHiya >= MAX_HEAVY) return;
    const sc = Math.max(1.2, Math.min(2, 4 / ppm));
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
    const sc = Math.max(sc0, Math.min(sc0 * 1.6, 7 / (1.2 * ppm)));
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
  salvo(p: Projectile, remaining: number, peak: number, battle: Battle, observer: Team = p.team) {
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
        if (!s.alive || s.team === p.team || s.sinking > 0.5 || !shipObserved(battle, observer, s)) continue;
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
  fly(dt: number, camX: number, camY: number, camZ: number, focal: number, lay: (t: Trail, x: number, y: number, z: number, ppm: number) => void, visible?: (x: number, z: number) => boolean) {
    for (let i = this.count - 1; i >= 0; i -= 1) {
      const t0 = this.t[i]!;
      const t = t0 + dt;
      this.t[i] = t;
      if (t < 0) continue;
      const dur = this.dur[i]!;
      const s = t / dur;
      if (s >= 1) {
        if (!visible || visible(this.ex[i]!, this.ez[i]!)) this.onLand?.(this.ex[i]!, this.ey[i]!, this.ez[i]!, this.hull[i] === 1);
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
      if (visible && !visible(px, pz)) {
        const trail = this.trails[i]!; trail.x = px; trail.y = py; trail.z = pz;
        continue;
      }
      if (first && (!visible || visible(sx, sz))) this.launch(sx, sy, sz, ux, uy, uz, 1);
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
    const [len, girth] = arrowForm(gun);
    this.kScale[i] = kind === 0 ? len / ARROW_LEN : 1.6;
    this.kGirth[i] = kind === 0 ? girth / ARROW_GIRTH / (len / ARROW_LEN) : 1;
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
          this.kGirth[i] = this.kGirth[last]!;
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
      // Grows a little from afar, as in flight; leaves by shrinking into the planks.
      const k = this.kScale[i]!;
      const sc = (heavy ? k * Math.min(1.6, Math.max(1, 8 / (ARROW_LEN * k * (focal / d)))) : Math.max(k, Math.min(k * 1.6, 4 / ((focal / d) * 1.2)))) * smooth(0, 0.8, left);
      // The origin sits back from the hit so that the head is buried: a gun arrow goes in to a little under half its
      // length, the rest and its vanes standing out of the planks.
      const back = (heavy ? 0.1 : 0.24) * sc;
      const ox = this.p.x - ux * back;
      const oy = this.p.y - uy * back;
      const oz = this.p.z - uz * back;
      this.q.setFromUnitVectors(this.xAxis, this.v.set(ux, uy, uz));
      const sg = sc * this.kGirth[i]!;
      this.m.compose(this.p.set(ox, oy, oz), this.q, this.s.set(sc, sg, sg));
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
