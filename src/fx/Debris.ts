import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
} from 'three/webgpu';
import { attribute, instancedBufferAttribute, mix, texture, uv, vec2, vec3 } from 'three/tsl';
import { waveField } from '../ocean/waves';
import type { Faction } from '../sim/types';

/**
 * Hull paint of each navy for the painted face of a broken plank (the rest of the piece is bare, grained wood): Korean
 * natural timber, Japanese lacquer, Ming red, the 1588 Tudor green, the Mediterranean reds, the ochre of the British
 * 1805 ships and the black and red of the French and Spanish.
 */
const HULL_PAINT: Record<Faction, [number, number, number][]> = {
  joseon: [[0.25, 0.17, 0.1], [0.2, 0.14, 0.09]],
  japan: [[0.05, 0.045, 0.04], [0.3, 0.2, 0.12]],
  ming: [[0.42, 0.08, 0.05], [0.12, 0.16, 0.24]],
  england: [[0.16, 0.27, 0.16], [0.6, 0.55, 0.42]],
  spain: [[0.45, 0.11, 0.07], [0.06, 0.05, 0.045]],
  holyleague: [[0.42, 0.1, 0.07], [0.06, 0.05, 0.045]],
  ottoman: [[0.45, 0.1, 0.07], [0.12, 0.25, 0.14]],
  britain: [[0.62, 0.45, 0.17], [0.05, 0.045, 0.04]],
  france: [[0.06, 0.05, 0.045], [0.45, 0.14, 0.08]],
  spain1805: [[0.48, 0.12, 0.08], [0.06, 0.05, 0.045]],
};

/** Grey wood grain (rows along u, the piece's length) with knots and darker torn ends, shared by every timber piece. */
function grainTexture(): DataTexture {
  const W = 256;
  const H = 128;
  const d = new Uint8Array(W * H * 4);
  let seed = 7;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rows = Array.from({ length: H }, () => 0.62 + r() * 0.5);
  const knots = Array.from({ length: 5 }, () => [r() * W, r() * H, 3 + r() * 6] as const);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let wob = y + Math.sin(x * 0.045 + y * 0.2) * 2.5;
      let v = 1;
      for (const [kx, ky, kr] of knots) {
        const dd = Math.hypot((x - kx) * 0.5, y - ky);
        if (dd < kr * 3) wob += (kr * 3 - dd) * 0.6 * Math.sign(y - ky);
        if (dd < kr) v *= 0.55;
      }
      v *= rows[((Math.floor(wob) % H) + H) % H]! * (0.78 + 0.22 * Math.sin(wob * 2.6) + (r() - 0.5) * 0.1);
      // Torn ends: the last few per cent of the length darken in jagged fibres.
      const u = x / W;
      const end = Math.min(u, 1 - u);
      const tear = 0.035 + 0.04 * Math.abs(Math.sin(y * 1.7) * Math.sin(y * 0.43));
      if (end < tear) v *= 0.55 + 0.45 * (end / tear);
      const g = Math.max(0, Math.min(255, v * 200));
      const i = (y * W + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = g;
      d[i + 3] = 255;
    }
  }
  const t = new DataTexture(d, W, H);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

const withMask = (g: BufferGeometry, mask?: Float32Array) => g.setAttribute('mask', new Float32BufferAttribute(mask ?? new Float32Array(g.attributes.position!.count), 1));

/**
 * A board broken at both ends: the end vertices pushed back unevenly into points and slivers, tapered by `taper`, with
 * a paint mask on its top face (the outboard face of the hull plank it came from).
 */
function brokenBoard(h: number, w: number, taper: number): BufferGeometry {
  const g = new BoxGeometry(1, h, w, 6, 1, 2);
  const pos = g.attributes.position!;
  let seed = Math.round(h * 1000 + w * 77) + 1;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cut = new Map<string, number>();
  const mask = new Float32Array(pos.count);
  const nrm = g.attributes.normal!;
  for (let i = 0; i < pos.count; i += 1) {
    mask[i] = nrm.getY(i) > 0.5 ? 1 : 0;
    const x = pos.getX(i);
    const t = Math.abs(x) * 2;
    if (t > 0.99) {
      const key = `${Math.sign(x)}:${pos.getY(i).toFixed(3)}:${pos.getZ(i).toFixed(3)}`;
      let c = cut.get(key);
      if (c === undefined) cut.set(key, (c = r() * 0.32));
      pos.setX(i, x - Math.sign(x) * c);
    }
    const k = 1 - taper * Math.min(1, t) ** 2;
    pos.setY(i, pos.getY(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return withMask(g, mask);
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
  /** Per kind, per drawn instance: hull paint (rgb) and wood tone (w), written with the matrices. */
  private readonly paints: InstancedBufferAttribute[] = [];
  private readonly pr: Float32Array;
  private readonly pg: Float32Array;
  private readonly pb: Float32Array;
  private readonly tone: Float32Array;
  /** The navy whose hull the next pieces come from: Effects sets it from the ship nearest a hit. */
  navy: Faction = 'joseon';
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
    this.pr = f();
    this.pg = f();
    this.pb = f();
    this.tone = f();
    this.pool = [this.pr, this.pg, this.pb, this.tone, this.x, this.y, this.z, this.vx, this.vy, this.vz, this.rx, this.ry, this.rz, this.wx, this.wy, this.wz, this.sx, this.sy, this.sz, this.age, this.life, this.ember, this.surf];
    this.kind = new Uint8Array(cap);
    this.floating = new Uint8Array(cap);

    const mast = new CylinderGeometry(0.36, 0.5, 1, 8);
    mast.rotateZ(Math.PI / 2);
    const spar = new CylinderGeometry(0.5, 0.5, 1, 6);
    spar.rotateZ(Math.PI / 2);
    const sail = new PlaneGeometry(1, 1);
    sail.rotateX(-Math.PI / 2);
    // grain: u, v repeats of the shared wood grain (u runs along the piece); without it a piece keeps its flat colour.
    const specs: { geo: BufferGeometry; color: [number, number, number]; rough: number; side?: boolean; grain?: [number, number] }[] = [
      { geo: brokenBoard(0.12, 0.26, 0.15), color: [0.2, 0.13, 0.075], rough: 0.9, grain: [1, 0.5] },
      { geo: brokenBoard(0.05, 0.09, 0.75), color: [0.42, 0.3, 0.17], rough: 0.85, grain: [1, 0.25] },
      { geo: withMask(new BoxGeometry(0.5, 0.3, 0.4)), color: [0.045, 0.036, 0.03], rough: 1 },
      { geo: withMask(mast), color: [0.24, 0.155, 0.09], rough: 0.85, grain: [1, 1] },
      { geo: withMask(spar), color: [0.3, 0.2, 0.12], rough: 0.85, grain: [1, 1] },
      { geo: withMask(sail), color: [0.7, 0.62, 0.46], rough: 1, side: true },
      { geo: brokenBoard(0.3, 0.45, 0.06), color: [0.17, 0.11, 0.065], rough: 0.9, grain: [1, 0.6] },
      { geo: withMask(new CylinderGeometry(0.35, 0.32, 0.8, 8)), color: [0.2, 0.13, 0.08], rough: 0.8, grain: [0.6, 0.8] },
    ];
    const grain = grainTexture();
    for (const s of specs) {
      const mat = new MeshStandardNodeMaterial({ color: new Color(s.color[0], s.color[1], s.color[2]), roughness: s.rough, metalness: 0 });
      if (s.side) mat.side = DoubleSide;
      const paint = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      paint.setUsage(DynamicDrawUsage);
      this.paints.push(paint);
      if (s.grain) {
        // rgb: the navy's hull paint on the board's painted face; w: the piece's wood tone.
        const P = instancedBufferAttribute(paint, 'vec4') as any;
        const g = texture(grain, uv().mul(vec2(s.grain[0], s.grain[1]))).r.mul(1.6);
        const wood = vec3(s.color[0], s.color[1], s.color[2]).mul(g).mul(P.w);
        // Paint keeps some of the grain under it.
        mat.colorNode = mix(wood, P.xyz.mul(g.mul(0.35).add(0.6)), attribute('mask', 'float'));
      }
      const mesh = new InstancedMesh(s.geo, mat, cap);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
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
    // Most boards come off with the hull's paint on their outer face (the navy's main colour or its second); the rest
    // are bare inner planking or deck.
    const pal = HULL_PAINT[this.navy];
    const p = Math.random() < 0.7 ? pal[Math.random() < 0.7 ? 0 : 1]! : null;
    const tone = 0.8 + Math.random() * 0.45;
    this.tone[i] = tone;
    this.pr[i] = p ? p[0] : 0.3 * tone;
    this.pg[i] = p ? p[1] : 0.2 * tone;
    this.pb[i] = p ? p[2] : 0.12 * tone;
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
      this.paints[mesh]!.setXYZW(n, this.pr[i]!, this.pg[i]!, this.pb[i]!, this.tone[i]!);
    }
    for (let k = 0; k < KINDS; k += 1) {
      const mesh = this.meshes[k]!;
      mesh.count = this.counts[k]!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.count) this.paints[k]!.needsUpdate = true;
    }
  }
}
