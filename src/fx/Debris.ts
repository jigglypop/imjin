import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  StaticDrawUsage,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three/webgpu';
import { float, fract, mix, mx_noise_float, positionGeometry, smoothstep, vec3 } from 'three/tsl';
import { waveField } from '../ocean/waves';

/**
 * Wood grain drawn in the shader from the piece's own model position, so no texture is loaded: long streaks along the
 * piece's length (local x) with warped growth rings across it, and a fine fibre noise. Returns a colour node.
 */
function woodGrain(r: number, g: number, b: number, rings: number) {
  const p = positionGeometry;
  const warp = mx_noise_float(p.mul(vec3(0.8, 4, 4))).mul(1.4);
  const ring = fract(p.y.mul(rings).add(p.z.mul(rings * 0.45)).add(warp));
  const band = smoothstep(0.0, 0.25, ring).mul(smoothstep(1.0, 0.55, ring));
  const fibre = mx_noise_float(p.mul(vec3(1.5, 70, 70))).mul(0.5).add(0.5);
  const shade = mix(float(0.55), float(1.2), band).mul(mix(float(0.85), float(1.08), fibre));
  return vec3(r, g, b).mul(shade);
}

/** Pieces of broken ship. Long pieces are modelled along their local x axis. */
export const Piece = { Plank: 0, Splinter: 1, Chunk: 2, Mast: 3, Spar: 4, Sail: 5, Beam: 6, Barrel: 7 } as const;
export type PieceKind = (typeof Piece)[keyof typeof Piece];
const KINDS = 8;

/** How deep each kind sits in the water per unit of its y scale, in metres. */
const DRAFT = [0.05, 0.025, 0.12, 0.45, 0.45, 0.02, 0.12, 0.4];
const FIXED_STEP = 1 / 20;
const MAX_STEPS = 6;

type SplashHook = (x: number, y: number, z: number, size: number) => void;
type EmberHook = (x: number, y: number, z: number) => void;

/**
 * Everything the battle breaks off a ship and tosses around: splinters, planks, charred lumps, masts, spars, sail
 * cloth, deck beams, barrels. One pool in flat arrays, one instanced mesh per kind, nothing allocated while it runs.
 * Pieces fly under gravity, land on the sea and float with a spring on the wave surface, then sink out of sight.
 */
export class DebrisField {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[] = [];
  private readonly counts = new Int32Array(KINDS);
  private readonly cap: number;
  count = 0;
  private evict = 0;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  /** Euler angles in YZX order: roll about the piece's own length (rx), yaw (ry), pitch (rz). */
  private readonly rx: Float32Array;
  private readonly ry: Float32Array;
  private readonly rz: Float32Array;
  private readonly wx: Float32Array;
  private readonly wy: Float32Array;
  private readonly wz: Float32Array;
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;
  private readonly sz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly ember: Float32Array;
  /** The sea surface under a floating piece, refreshed every few updates: it moves slowly next to a piece's spring. */
  private readonly surf: Float32Array;
  private readonly kind: Uint8Array;
  private readonly floating: Uint8Array;
  /** Every per-piece float array, so removing a piece is one loop over a list that exists once. */
  private readonly pool: Float32Array[];
  private tick = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();
  private readonly euler = new Euler(0, 0, 0, 'YZX');

  constructor(cap: number) {
    this.cap = cap;
    const f = () => new Float32Array(cap);
    this.x = f();
    this.y = f();
    this.z = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.rx = f();
    this.ry = f();
    this.rz = f();
    this.wx = f();
    this.wy = f();
    this.wz = f();
    this.sx = f();
    this.sy = f();
    this.sz = f();
    this.age = f();
    this.life = f();
    this.ember = f();
    this.surf = f();
    this.pool = [this.x, this.y, this.z, this.vx, this.vy, this.vz, this.rx, this.ry, this.rz, this.wx, this.wy, this.wz, this.sx, this.sy, this.sz, this.age, this.life, this.ember, this.surf];
    this.kind = new Uint8Array(cap);
    this.floating = new Uint8Array(cap);

    const lay = (g: BufferGeometry) => g;
    const mast = new CylinderGeometry(0.36, 0.5, 1, 8);
    mast.rotateZ(Math.PI / 2);
    const spar = new CylinderGeometry(0.5, 0.5, 1, 6);
    spar.rotateZ(Math.PI / 2);
    const sail = new PlaneGeometry(1, 1);
    sail.rotateX(-Math.PI / 2);
    // `rings`: growth rings per metre of the unit geometry across the grain (0 = no grain: cloth, charred lumps).
    const specs: { geo: BufferGeometry; color: [number, number, number]; rough: number; rings: number; side?: boolean }[] = [
      { geo: lay(new BoxGeometry(1, 0.12, 0.26)), color: [0.25, 0.165, 0.095], rough: 0.9, rings: 18 },
      { geo: lay(new BoxGeometry(1, 0.05, 0.09)), color: [0.42, 0.3, 0.17], rough: 0.85, rings: 40 },
      { geo: lay(new BoxGeometry(0.5, 0.3, 0.4)), color: [0.045, 0.036, 0.03], rough: 1, rings: 0 },
      { geo: mast, color: [0.26, 0.17, 0.1], rough: 0.85, rings: 14 },
      { geo: spar, color: [0.32, 0.21, 0.125], rough: 0.85, rings: 18 },
      { geo: sail, color: [0.7, 0.62, 0.46], rough: 1, rings: 0, side: true },
      { geo: lay(new BoxGeometry(1, 0.3, 0.45)), color: [0.22, 0.145, 0.085], rough: 0.9, rings: 16 },
      { geo: new CylinderGeometry(0.35, 0.32, 0.8, 8), color: [0.2, 0.13, 0.08], rough: 0.8, rings: 0 },
    ];
    for (const s of specs) {
      const mat = new MeshStandardNodeMaterial({ color: new Color(s.color[0], s.color[1], s.color[2]), roughness: s.rough, metalness: 0 });
      if (s.rings > 0) mat.colorNode = woodGrain(s.color[0], s.color[1], s.color[2], s.rings);
      if (s.side) mat.side = DoubleSide;
      const mesh = new InstancedMesh(s.geo, mat, cap);
      // Written by range each frame (only the pieces alive), so the buffer is not reallocated as dynamic.
      mesh.instanceMatrix.setUsage(StaticDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  /** Adds a piece. Sizes are metres along the piece's length, thickness and width. A full pool recycles its oldest slots. */
  spawn(kind: PieceKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, sx: number, sy: number, sz: number, life: number, spin = 1, ember = 0) {
    let i: number;
    if (this.count < this.cap) i = this.count++;
    else {
      i = this.evict;
      this.evict = (this.evict + 1) % this.cap;
    }
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.rx[i] = Math.random() * 6.28;
    this.ry[i] = Math.random() * 6.28;
    this.rz[i] = (Math.random() - 0.5) * 2;
    this.wx[i] = (Math.random() - 0.5) * 16 * spin;
    this.wy[i] = (Math.random() - 0.5) * 6 * spin;
    this.wz[i] = (Math.random() - 0.5) * 12 * spin;
    this.sx[i] = sx;
    this.sy[i] = sy;
    this.sz[i] = sz;
    this.age[i] = 0;
    this.life[i] = life;
    this.ember[i] = ember;
    this.kind[i] = kind;
    this.floating[i] = 0;
  }

  private remove(i: number) {
    const last = --this.count;
    if (i === last) return;
    for (const a of this.pool) a[i] = a[last]!;
    this.kind[i] = this.kind[last]!;
    this.floating[i] = this.floating[last]!;
    if (this.evict > this.count) this.evict = 0;
  }

  update(dt: number, windX: number, windZ: number, onSplash: SplashHook, onEmber: EmberHook) {
    const t = waveField.time;
    this.counts.fill(0);
    const h = Math.min(dt, FIXED_STEP * MAX_STEPS);
    const steps = h > 0 ? Math.min(MAX_STEPS, Math.ceil(h / FIXED_STEP)) : 0;
    const step = steps > 0 ? h / steps : 0;
    // Nothing above the highest crest can be touching the water, so a flying piece only samples the waves when low.
    const crest = waveField.crest;
    const turn = this.tick++ % 3;
    for (let i = this.count - 1; i >= 0; i -= 1) {
      const age = (this.age[i] = this.age[i]! + dt);
      if (age > this.life[i]!) {
        this.remove(i);
        continue;
      }
      const kind = this.kind[i]!;
      if (this.floating[i] === 1 && (i + turn) % 3 === 0) this.surf[i] = waveField.heightAt(this.x[i]!, this.z[i]!, t, 6);
      for (let s = 0; s < steps; s += 1) {
        if (this.floating[i] === 0) {
          this.vy[i] = this.vy[i]! - 9.81 * step;
          this.x[i] = this.x[i]! + this.vx[i]! * step;
          this.y[i] = this.y[i]! + this.vy[i]! * step;
          this.z[i] = this.z[i]! + this.vz[i]! * step;
          this.rx[i] = this.rx[i]! + this.wx[i]! * step;
          this.ry[i] = this.ry[i]! + this.wy[i]! * step;
          this.rz[i] = this.rz[i]! + this.wz[i]! * step;
          if (this.y[i]! < crest && this.y[i]! < (this.surf[i] = waveField.heightAt(this.x[i]!, this.z[i]!, t, 6))) {
            this.floating[i] = 1;
            const size = this.sx[i]!;
            if (size > 1 || kind === Piece.Sail) onSplash(this.x[i]!, this.y[i]!, this.z[i]!, Math.min(1.6, size * 0.4));
            // Water takes most of the speed at once.
            this.vx[i] = this.vx[i]! * 0.25;
            this.vz[i] = this.vz[i]! * 0.25;
            this.vy[i] = this.vy[i]! * 0.15;
            this.wx[i] = this.wx[i]! * 0.3;
            this.wy[i] = this.wy[i]! * 0.3;
          }
        } else {
          const surface = this.surf[i]!;
          const sinkStart = this.life[i]! * 0.6;
          const sunk = Math.max(0, age - sinkStart) * 0.18;
          const target = surface - this.sy[i]! * DRAFT[kind]! - sunk;
          this.vy[i] = this.vy[i]! + ((target - this.y[i]!) * 16 - this.vy[i]! * 6) * step;
          this.y[i] = this.y[i]! + this.vy[i]! * step;
          const drift = Math.exp(-1.5 * step);
          this.vx[i] = this.vx[i]! * drift;
          this.vz[i] = this.vz[i]! * drift;
          this.x[i] = this.x[i]! + (this.vx[i]! + windX * 0.05) * step;
          this.z[i] = this.z[i]! + (this.vz[i]! + windZ * 0.05) * step;
          // Long pieces lie down flat; a sail spreads out; chunks and barrels keep rolling a little.
          const settle = Math.exp(-2.2 * step);
          this.rz[i] = this.rz[i]! * settle;
          this.wx[i] = this.wx[i]! * settle;
          this.wy[i] = this.wy[i]! * Math.exp(-1.2 * step);
          this.wz[i] = 0;
          this.rx[i] = this.rx[i]! + this.wx[i]! * step;
          this.ry[i] = this.ry[i]! + this.wy[i]! * step;
          if (kind === Piece.Plank || kind === Piece.Splinter || kind === Piece.Beam || kind === Piece.Mast || kind === Piece.Spar || kind === Piece.Sail) this.rx[i] = this.rx[i]! * settle;
        }
      }
      const em = this.ember[i]!;
      if (em > 0 && this.floating[i] === 1 && age < this.life[i]! * 0.55 && Math.random() < dt * em * 3) onEmber(this.x[i]!, this.y[i]! + 0.3, this.z[i]!);
      const mesh = kind;
      const n = this.counts[mesh]!;
      if (n >= this.cap) continue;
      this.counts[mesh] = n + 1;
      this.q.setFromEuler(this.euler.set(this.rx[i]!, this.ry[i]!, this.rz[i]!));
      this.scale.set(this.sx[i]!, this.sy[i]!, this.sz[i]!);
      this.pos.set(this.x[i]!, this.y[i]!, this.z[i]!);
      this.m.compose(this.pos, this.q, this.scale);
      this.meshes[mesh]!.setMatrixAt(n, this.m);
    }
    for (let k = 0; k < KINDS; k += 1) {
      const mesh = this.meshes[k]!;
      const n = this.counts[k]!;
      const was = mesh.count;
      mesh.count = n;
      mesh.visible = n > 0;
      if (n === 0 && was === 0) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, Math.max(16, n * 16));
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
