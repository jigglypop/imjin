import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import { dot, float, normalView, positionViewDirection, pow, saturate, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Battle } from '../sim/battle';
import type { GunType, Projectile, Team } from '../sim/types';
import { shipObserved } from '../sim/observation';
import { waveField } from '../ocean/waves';
import { equipment } from '../game/quality';
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
/**
 * Arrows and balls left standing in the ships (src/fx/Scars.ts), in all and per ship, by device class: they stay until
 * the ship sinks, so the oldest on a ship gives way when it is full.
 */
export const EMBEDDED = { high: { all: 200, ship: 14 }, medium: { all: 120, ship: 10 }, low: { all: 48, ship: 6 } }[equipment.tier];
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

/** A cylinder lying along x from x0 (radius r0) to x1 (radius r1). */
const rod = (r0: number, r1: number, x0: number, x1: number, seg = 8) => {
  // Turned a quarter about z, the cylinder's top (+y) points to -x: its top radius is the one at x0.
  const g = new CylinderGeometry(r0, r1, x1 - x0, seg);
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

/**
 * Three iron vanes 120 degrees apart, each a forged plate `thick` thick set into the shaft at radius r0 and standing
 * out to r1, its leading edge swept back by `sweep` at the tip. `edge` is the bright strip of its leading edge.
 */
const vanes = (x0: number, x1: number, r0: number, r1: number, sweep: number, thick: number, body: [number, number, number], edge: [number, number, number]): Part[] => {
  const out: Part[] = [];
  const plate = (a: number, b: number, c: number, d: number) => {
    // The plate's outline in (along the shaft, out from it): root from a to b, tip from c to d.
    const s = new Shape();
    s.moveTo(a, r0);
    s.lineTo(b, r0);
    s.lineTo(d, r1);
    s.lineTo(c, r1);
    s.closePath();
    const g = new ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
    g.translate(0, 0, -thick / 2);
    return g;
  };
  for (let i = 0; i < 3; i += 1) {
    const turn = (i * 2 * Math.PI) / 3;
    const f = plate(x0, x1, x0, x1 - sweep);
    f.rotateX(turn);
    out.push({ geo: f, color: body });
    // The leading edge, filed bright, a little proud of the plate on both faces so it reads on the dark iron.
    const e = new BoxGeometry(0.012, Math.hypot(r1 - r0, sweep), thick * 1.6);
    e.rotateZ(Math.atan2(sweep, r1 - r0));
    e.translate(x1 - sweep / 2 - 0.006, (r0 + r1) / 2, 0);
    e.rotateX(turn);
    out.push({ geo: e, color: edge });
  }
  return out;
};

/** Thorn wood, pale reddish brown, of the shaft of a gun arrow. */
const THORN: [number, number, number] = [0.26, 0.14, 0.08];
/** Blackened forged iron of its sleeve, bands and head, darker than the wood by enough to read in the sun. */
const FORGED: [number, number, number] = [0.03, 0.03, 0.033];
/** The vanes: forged plate worn grey by loading through the bore, and their filed leading edges. */
const VANE: [number, number, number] = [0.12, 0.115, 0.11];
const VANE_EDGE: [number, number, number] = [0.3, 0.29, 0.27];

/**
 * A gun arrow at the measures of the jija's janggun-jeon in the Yungwon pilbi (1813), which match the arrow kept by the
 * Kuki family: 1.92 m, 9.4 cm thick, a forged iron sleeve over its front 0.51 m, a socketed four-sided iron head of
 * 10.4 cm, three iron vanes of 35 cm held by four iron bands at the tail. The vanes may stand no wider than the bore
 * (10.5 cm for the jija), since the arrow is loaded down the muzzle: the shaft tapers to about 5.6 cm under them, so
 * they stand out 2.5 cm, 5 mm plates with a swept, filed leading edge. The origin is the middle of the shaft; the other
 * guns' arrows are this one stretched (ARROW_FORM).
 */
export function heavyGeometry() {
  const parts: Part[] = [
    { geo: rod(0.028, 0.034, -0.96, -0.55, 10), color: THORN },
    { geo: rod(0.034, 0.045, -0.55, 0.32, 10), color: THORN },
    { geo: rod(0.047, 0.047, 0.3, 0.83, 10), color: FORGED },
    ...[0.34, 0.56, 0.79].map((x) => ({ geo: rod(0.051, 0.051, x, x + 0.025, 10), color: FORGED })),
    { geo: rod(0.03, 0.03, 0.82, 0.86, 8), color: FORGED },
    { geo: spike(0.045, 0.856, 0.96, 4), color: FORGED },
    ...vanes(-0.95, -0.6, 0.027, 0.0525, 0.07, 0.005, VANE, VANE_EDGE),
    ...[-0.94, -0.83, -0.72, -0.62].map((x) => ({ geo: rod(0.032, 0.032, x, x + 0.018, 8), color: FORGED })),
  ];
  return assemble(parts);
}

/** The model's length and the janggun-jeon's thickness it is built at, in metres. */
export const ARROW_LEN = 1.92;
export const ARROW_GIRTH = 0.094;

/**
 * Each gun's arrow (weapons table): length and thickness in metres. Cheonja: the daejanggun-jeon, 2.1 m by 10.5 cm (its
 * proportions estimated from the bore); jija: the janggun-jeon; hyeonja: the chadae-jeon, 1.32 m by 4.6 cm; hwangja: the
 * leather-vaned piryeong chajung-jeon, 1.31 m by 3.5 cm; the small guns' wooden arrows about 1.2 m.
 */
const ARROW_FORM: Partial<Record<GunType, [number, number]>> = { cheonja: [2.1, 0.105], jija: [1.92, 0.094], hyeonja: [1.32, 0.046], hwangja: [1.31, 0.035] };
export const arrowForm = (gun: GunType): [number, number] => ARROW_FORM[gun] ?? [1.2, 0.035];

/**
 * The great general arrow as it is drawn in flight and standing in a hull: an oak shaft as thick as a wrist, an iron
 * collar and head, three fins. About 1.4 units long, its head at FLIGHT_HEAD.
 */
function flightArrowGeometry() {
  const parts: Part[] = [
    { geo: rod(0.045, 0.04, -0.62, 0.5), color: WOOD },
    { geo: rod(0.062, 0.062, 0.44, 0.54), color: IRON },
    { geo: spike(0.082, 0.52, 0.78), color: IRON },
    ...fins(-0.48, 0.3, 0.2, 3).map((geo) => ({ geo, color: FEATHER })),
    { geo: rod(0.05, 0.05, -0.36, -0.31), color: CORD },
  ];
  return assemble(parts);
}
/** The drawn great arrow's length and where its head is, in model units from its origin. */
const FLIGHT_LEN = 1.4;
const FLIGHT_HEAD = 0.78;

/**
 * How much a gun arrow in flight may grow beyond its true measures as the camera draws back: its length up to twice,
 * so it stays a dozen pixels long from the RTS camera, and its girth up to three times, so it is a line a pixel wide
 * and not a thread that flickers out. Never more: a far arrow is a thin fast line, not a pole.
 */
const ARROW_GROW = 2;
const GIRTH_GROW = 3;

/** A Japanese fire arrow: a thin shaft, a small head and a charred bundle of tow bound behind it. About 1 unit long. */
export function hiyaGeometry() {
  const parts: Part[] = [
    { geo: rod(0.011, 0.011, -0.5, 0.42, 6), color: WOOD },
    { geo: spike(0.022, 0.4, 0.52, 6), color: IRON },
    { geo: rod(0.034, 0.03, 0.2, 0.4, 6), color: [0.05, 0.03, 0.02] },
    ...fins(-0.44, 0.18, 0.07, 2).map((geo) => ({ geo, color: FEATHER })),
  ];
  return assemble(parts);
}

/**
 * A rocket arrow at the proportions of the middle singijeon (중신기전) of the Gukjo orye seorye: a bamboo shaft 1.38 m
 * long, a paper motor 19.6 cm long and 2.7 cm thick bound to its front, a small paper charge (so-balhwa) ahead of the
 * motor, a small iron head, feathers behind. The Ming fire arrow is the same build, a little longer. 1.22 units long:
 * drawn at 1.13 it is the singijeon's true size.
 */
export function rocketGeometry() {
  const parts: Part[] = [
    { geo: rod(0.0058, 0.0058, -0.5, 0.6, 6), color: WOOD },
    { geo: rod(0.012, 0.012, 0.2, 0.373, 10), color: PAPER },
    { geo: rod(0.0135, 0.0135, 0.212, 0.224, 10), color: CORD },
    { geo: rod(0.0135, 0.0135, 0.35, 0.362, 10), color: CORD },
    { geo: rod(0.014, 0.014, 0.373, 0.425, 10), color: PAPER },
    { geo: spike(0.014, 0.425, 0.455, 10), color: PAPER },
    { geo: spike(0.008, 0.6, 0.72, 4), color: IRON },
    ...fins(-0.46, 0.16, 0.035, 2).map((geo) => ({ geo, color: FEATHER })),
  ];
  return assemble(parts);
}

/**
 * A rocket arrow as it is drawn in flight and standing in a hull: a paper tube of black powder tied to the front of the
 * shaft, an iron head, feathers behind. About 1.2 units long, its head at +0.72 like the singijeon's model.
 */
function flightRocketGeometry() {
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

/** A salvo rocket comes down at (x, y, z) travelling along (ux, uy, uz): on the deck of `ship`, or in the sea for 0. */
type SalvoHook = (x: number, y: number, z: number, ship: number, ux: number, uy: number, uz: number) => void;

export class Munitions {
  readonly group = new Group();
  private readonly near: InstancedMesh;
  private readonly far: InstancedMesh;
  private readonly heavy: InstancedMesh;
  /** Gun arrows left standing in the ships, at the measures they had before the arrows in flight were drawn true. */
  private readonly lodged: InstancedMesh;
  private readonly hiya: InstancedMesh;
  private readonly rockets: InstancedMesh;
  private nNear = 0;
  private nFar = 0;
  private nHeavy = 0;
  private nLodged = 0;
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
  /** The ship a rocket comes down on, 0 for the sea. */
  private readonly hull: Int32Array;
  private readonly trails: Trail[];
  private k = 1;
  /** Rockets per sim fire shot, by equipment class. */
  private readonly perShot: number;
  onLand: SalvoHook | null = null;

  constructor(
    private readonly smoke: ParticleLayer,
    private readonly fire: ParticleLayer,
    private readonly streaks: StreakLayer,
    tier: number,
  ) {
    // Cast iron, blackened: a hard sheen of sun and sky that ends at a crisp edge. A thin cold line right on the edge, too
    // narrow to read as a glow, keeps the outline of the black sphere on black water at night.
    const iron = () => {
      const m = new MeshStandardNodeMaterial({ color: new Color(0.05, 0.048, 0.046), roughness: 0.3, metalness: 0.95 });
      const facing = saturate(dot(normalView, positionViewDirection));
      m.emissiveNode = vec3(0.2, 0.21, 0.23).mul(pow(float(1).sub(facing), 7)).mul(0.35);
      return m;
    };
    const ironMat = iron();
    // Each mesh has room for what is in flight and for what is left standing in the ships.
    const stay = EMBEDDED.all;
    this.near = new InstancedMesh(new SphereGeometry(1, 22, 15), ironMat, MAX_NEAR + stay);
    this.far = new InstancedMesh(new SphereGeometry(1, 8, 6), ironMat, MAX_FAR);
    const wood = () => new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05, emissive: new Color(0.025, 0.016, 0.008) });
    this.heavy = new InstancedMesh(heavyGeometry(), wood(), MAX_HEAVY);
    this.lodged = new InstancedMesh(flightArrowGeometry(), wood(), stay);
    this.hiya = new InstancedMesh(hiyaGeometry(), wood(), MAX_HEAVY + stay);
    this.rockets = new InstancedMesh(flightRocketGeometry(), wood(), Math.round(240 * tier) + 60 + stay);
    for (const mesh of [this.near, this.far, this.heavy, this.lodged, this.hiya, this.rockets]) {
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
    this.hull = new Int32Array(this.cap);
    this.trails = Array.from({ length: this.cap }, () => ({ x: 0, y: 0, z: 0 }));
    this.perShot = tier >= 1 ? 5 : tier >= 0.7 ? 3 : 2;
  }

  setKeep(k: number) {
    this.k = k;
  }

  /** A new battle: shell ids restart. */
  clear() {
    this.count = 0;
  }

  /** Cosmetic rockets in the air or waiting their turn (the probes read it). */
  get rocketsInFlight() {
    return this.count;
  }

  // ---- Per frame -------------------------------------------------------------------------------------------------

  begin() {
    this.nNear = this.nFar = this.nHeavy = this.nLodged = this.nHiya = this.nRocket = 0;
  }

  end() {
    this.near.count = this.nNear;
    this.far.count = this.nFar;
    this.heavy.count = this.nHeavy;
    this.lodged.count = this.nLodged;
    this.hiya.count = this.nHiya;
    this.rockets.count = this.nRocket;
    // An empty mesh is not drawn at all, and a full one sends only the instances in use.
    for (const mesh of [this.near, this.far, this.heavy, this.lodged, this.hiya, this.rockets]) {
      mesh.visible = mesh.count > 0;
      if (!mesh.visible) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---- Left in the ships (Scars hands them over each frame) -------------------------------------------------------

  private aim(x: number, y: number, z: number, ux: number, uy: number, uz: number, sc: number) {
    this.q.setFromUnitVectors(this.xAxis, this.v.set(ux, uy, uz));
    return this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sc, sc, sc));
  }

  /** A gun arrow standing in a hull: the point of its head, the line it points along and its drawn length in metres. */
  putHeavy(x: number, y: number, z: number, ux: number, uy: number, uz: number, length: number) {
    if (this.nLodged >= this.lodged.instanceMatrix.count) return;
    const sc = length / FLIGHT_LEN;
    const back = FLIGHT_HEAD * sc;
    this.lodged.setMatrixAt(this.nLodged++, this.aim(x - ux * back, y - uy * back, z - uz * back, ux, uy, uz, sc));
  }

  putHiya(x: number, y: number, z: number, ux: number, uy: number, uz: number, sc: number) {
    if (this.nHiya < this.hiya.instanceMatrix.count) this.hiya.setMatrixAt(this.nHiya++, this.aim(x, y, z, ux, uy, uz, sc));
  }

  putRocket(x: number, y: number, z: number, ux: number, uy: number, uz: number, sc: number) {
    if (this.nRocket < this.rockets.instanceMatrix.count) this.rockets.setMatrixAt(this.nRocket++, this.aim(x, y, z, ux, uy, uz, sc));
  }

  /** An iron ball lodged in the planks, at its true size. */
  putLodged(x: number, y: number, z: number, r: number) {
    if (this.nNear >= this.near.instanceMatrix.count) return;
    this.m.makeScale(r, r, r).setPosition(x, y, z);
    this.near.setMatrixAt(this.nNear++, this.m);
  }

  // ---- Round shot -------------------------------------------------------------------------------------------------

  private putBall(x: number, y: number, z: number, r: number, ppm: number) {
    this.m.makeScale(r, r, r).setPosition(x, y, z);
    if (r * ppm > BALL_NEAR_PX) {
      if (this.nNear < MAX_NEAR) this.near.setMatrixAt(this.nNear++, this.m);
    } else if (this.nFar < MAX_FAR) this.far.setMatrixAt(this.nFar++, this.m);
  }

  /**
   * A round shot: a lit iron sphere that grows with distance so it keeps at least 3.3 px of radius, never more than
   * a metre or so while the camera is close. Nothing glows round it: a pale smear or halo turns the dark ball into a
   * puff of air, and the iron reads by its sheen against the sea and the thin smoke it leaves. Grape is a spray of small
   * balls fanning out of the muzzle.
   */
  ball(x: number, y: number, z: number, ppm: number, weight: number) {
    this.putBall(x, y, z, Math.min(16, Math.max(0.14, 3.3 / ppm)) * (0.85 + 0.35 * weight), ppm);
  }

  grape(x: number, y: number, z: number, ux: number, uy: number, uz: number, speed: number, ppm: number, id: number, age: number) {
    // Joran-hwan, bird's-egg shot: a spray of a dozen small iron balls on the high tier, fewer on the small ones.
    const n = this.perShot * 2 + 2;
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
  }

  // ---- Arrows -----------------------------------------------------------------------------------------------------

  /**
   * A gun arrow at its gun's true measures (ARROW_FORM), head first along the tangent of its arc. Its straight iron vanes
   * steady it: it leaves the muzzle with a small yaw that dies away within the first second, and it does not spin.
   * Nothing glows round it; from afar it grows only within ARROW_GROW and GIRTH_GROW.
   */
  heavyArrow(x: number, y: number, z: number, ux: number, uy: number, uz: number, ppm: number, gun: GunType, age: number, seed: number) {
    if (this.nHeavy >= MAX_HEAVY) return;
    const [len, girth] = arrowForm(gun);
    const grow = Math.min(ARROW_GROW, Math.max(1, 12 / (len * ppm)));
    const thick = Math.min(GIRTH_GROW, Math.max(grow, 1 / (girth * ppm)));
    // The yaw out of the bore: a degree or two, swinging a few times a second and gone by the end of the first second.
    const fade = 0.035 * Math.exp(-4 * age);
    const yaw = fade * Math.sin(age * 22 + seed);
    const pitch = 0.7 * fade * Math.cos(age * 19 + seed * 1.7);
    let sx = uz;
    let sz = -ux;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    const bx = uy * sz;
    const by = uz * sx - ux * sz;
    const bz = -uy * sx;
    let dx = ux + sx * yaw + bx * pitch;
    let dy = uy + by * pitch;
    let dz = uz + sz * yaw + bz * pitch;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    // The model is the jija's arrow with its origin mid-shaft; the drawn position is the shell's, which is its head.
    const lx = (len / ARROW_LEN) * grow;
    const g = (girth / ARROW_GIRTH) * thick;
    const back = (ARROW_LEN / 2) * lx;
    this.q.setFromUnitVectors(this.xAxis, this.v.set(dx, dy, dz));
    this.m.compose(this.p.set(x - dx * back, y - dy * back, z - dz * back), this.q, this.s.set(lx, g, g));
    this.heavy.setMatrixAt(this.nHeavy++, this.m);
  }

  /**
   * A Japanese fire arrow: a thin arrow about a metre long with a bundle of tow burning at its head, a small flame and
   * the dark smoke it trails (Effects lays the smoke). From afar it grows at most to 1.6 times its size; no glow line.
   */
  fireArrow(x: number, y: number, z: number, ux: number, uy: number, uz: number, ppm: number) {
    if (this.nHiya >= MAX_HEAVY) return;
    const sc = Math.min(1.6, Math.max(1, 10 / ppm));
    this.q.setFromUnitVectors(this.xAxis, this.v.set(ux, uy, uz));
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sc, sc, sc));
    this.hiya.setMatrixAt(this.nHiya++, this.m);
    // The tow bound behind the head, burning: a short-lived tongue of flame that the flight leaves streaming back.
    const t = 0.3 * sc;
    this.fire.emit({ x: x + ux * t, y: y + uy * t, z: z + uz * t, vx: -ux * 4, vy: -uy * 4 + 0.6, vz: -uz * 4, life: 0.12, size0: 0.32 * sc, size1: 0.16 * sc, alpha: 0.85, heat: 0.9, drag: 3, wind: 0.3 });
  }

  /**
   * A rocket arrow and its motor's flame: the sim knows it as a shell, and Effects lays its white smoke trail. The flame
   * is a small tongue of fire at the nozzle, not a glowing line, and from afar the rocket grows at most to 1.6 times.
   */
  rocket(x: number, y: number, z: number, ux: number, uy: number, uz: number, sc0: number, ppm: number) {
    const sc = Math.min(1.6 * sc0, Math.max(sc0, 7 / (1.2 * ppm)));
    this.q.setFromUnitVectors(this.xAxis, this.v.set(ux, uy, uz));
    if (this.nRocket < this.rockets.instanceMatrix.count) {
      this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sc, sc, sc));
      this.rockets.setMatrixAt(this.nRocket++, this.m);
    }
    const nx = x + ux * NOZZLE * sc;
    const ny = y + uy * NOZZLE * sc;
    const nz = z + uz * NOZZLE * sc;
    this.fire.emit({ x: nx - ux * 0.15 * sc, y: ny - uy * 0.15 * sc, z: nz - uz * 0.15 * sc, life: 0.08, size0: 0.2 * sc, size1: 0.38 * sc, alpha: 0.6, heat: 0.75, drag: 4, wind: 0 });
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
          hull = s.id;
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
        if (!visible || visible(this.ex[i]!, this.ez[i]!)) {
          // Coming down along the end of its arc.
          const vx = (this.ex[i]! - this.sx[i]!) / dur;
          const vz = (this.ez[i]! - this.sz[i]!) / dur;
          const vy = (this.ey[i]! - this.sy[i]!) / dur - (4 * this.peak[i]!) / dur;
          const sp = Math.hypot(vx, vy, vz) || 1;
          this.onLand?.(this.ex[i]!, this.ey[i]!, this.ez[i]!, this.hull[i]!, vx / sp, vy / sp, vz / sp);
        }
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
        this.rocket(px, py, pz, ux, uy, uz, 1.6 * this.size[i]!, ppm);
        lay(this.trails[i]!, px, py, pz, ppm);
      }
    }
  }
}
