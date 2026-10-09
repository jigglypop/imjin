import { DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, PlaneGeometry, type Camera } from 'three/webgpu';
import { attribute, float, length, mix, saturate, smoothstep, step, uv, vec2 } from 'three/tsl';
import { atmosphere } from '../render/atmosphere';
import { equipment } from '../game/quality';
import { puffNoise } from './particleNoise';

/** Soft round things the boarding scene throws about: gun flashes, gunsmoke, splashes, splinter dust and spark flicks. */
export const PUFF = { smoke: 0, spray: 1, flash: 2, dust: 3 } as const;
export type PuffKind = (typeof PUFF)[keyof typeof PUFF];

export const PUFF_BUDGET = { high: 288, medium: 168, low: 80 }[equipment.tier];

type Puff = { used: boolean; kind: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; s0: number; s1: number; r: number; g: number; b: number; a: number; grav: number; drag: number; seed: number };

/** Slow drift of the air over the sea, so gunsmoke leans one way. */
const WIND_X = 1.1;
const WIND_Z = 0.7;

/**
 * Billboards in one instanced draw. Smoke and spray are shaded from the shared noise texture and take their light
 * from the sky, so they dim with the evening; flashes glow on their own and fade within a few frames.
 */
export class PuffField {
  readonly group = new Group();
  private readonly pool: Puff[] = [];
  private readonly mesh: InstancedMesh;
  private readonly tint: InstancedBufferAttribute;
  /** Per puff: fade, age as a fraction, noise seed, kind. */
  private readonly misc: InstancedBufferAttribute;
  private cursor = 0;

  constructor() {
    for (let i = 0; i < PUFF_BUDGET; i += 1) this.pool.push({ used: false, kind: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: 1, s1: 1, r: 1, g: 1, b: 1, a: 1, grav: 0, drag: 0, seed: 0 });
    const quad = new PlaneGeometry(1, 1);
    this.tint = new InstancedBufferAttribute(new Float32Array(PUFF_BUDGET * 3), 3);
    this.misc = new InstancedBufferAttribute(new Float32Array(PUFF_BUDGET * 4), 4);
    this.tint.setUsage(DynamicDrawUsage);
    this.misc.setUsage(DynamicDrawUsage);
    quad.setAttribute('iTint', this.tint);
    quad.setAttribute('iMisc', this.misc);
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const M: any = attribute('iMisc', 'vec4');
    const c = uv().sub(0.5).mul(2);
    const r = length(c);
    const flash = step(1.5, M.w).mul(float(1).sub(step(2.5, M.w)));
    const n = puffNoise(c.mul(1.5).add(vec2(M.z.mul(53), M.z.mul(29))), M.y, 2.0);
    const soft = smoothstep(1.0, 0.15, r.add(n.mul(0.5)));
    // A flash is a hard bright core with a short halo.
    const core = smoothstep(1.0, 0.0, r);
    const shape = mix(soft.mul(smoothstep(1.0, 0.7, r)), core.mul(core), flash);
    const lit = atmosphere.skyAmbient.mul(1.15).add(atmosphere.sunIrradiance.mul(0.16));
    const tint = attribute('iTint', 'vec3');
    mat.colorNode = mix(tint.mul(lit), tint.mul(2.4), flash);
    // The puff erodes from the edge as it ages, so smoke and spray thin out instead of fading as a disc.
    mat.opacityNode = saturate(mix(shape.sub(M.y.mul(0.45)).mul(1.5), shape, flash)).mul(M.x);
    mat.fog = true;
    this.mesh = new InstancedMesh(quad, mat, PUFF_BUDGET);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.group.add(this.mesh);
  }

  /** Free slots left, for callers that would rather skip a flourish than evict a flash. */
  get room() {
    let n = 0;
    for (const p of this.pool) if (!p.used) n += 1;
    return n;
  }

  spawn(kind: PuffKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, s0: number, s1: number, life: number, r: number, g: number, b: number, a: number, grav = 0, drag = 0) {
    const n = this.pool.length;
    let p: Puff | null = null;
    for (let i = 0; i < n; i += 1) {
      const o = this.pool[(this.cursor + i) % n]!;
      if (!o.used) {
        p = o;
        this.cursor = (this.cursor + i + 1) % n;
        break;
      }
    }
    // A full pool drops the new smoke before it would cut off a flash or a splash.
    if (!p) return;
    p.used = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.age = 0;
    p.life = life;
    p.s0 = s0;
    p.s1 = s1;
    p.r = r;
    p.g = g;
    p.b = b;
    p.a = a;
    p.grav = grav;
    p.drag = drag;
    p.seed = Math.random();
  }

  update(dt: number, camera: Camera) {
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const tint = this.tint.array as Float32Array;
    const misc = this.misc.array as Float32Array;
    const cq = camera.quaternion;
    const x2 = cq.x * 2;
    const y2 = cq.y * 2;
    const z2 = cq.z * 2;
    const xx = cq.x * x2;
    const xy = cq.x * y2;
    const xz = cq.x * z2;
    const yy = cq.y * y2;
    const yz = cq.y * z2;
    const zz = cq.z * z2;
    const wx = cq.w * x2;
    const wy = cq.w * y2;
    const wz = cq.w * z2;
    let n = 0;
    for (const p of this.pool) {
      if (!p.used) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.used = false;
        continue;
      }
      const k = p.age / p.life;
      if (p.drag > 0) {
        const d = Math.max(0, 1 - p.drag * dt);
        p.vx *= d;
        p.vy *= d;
        p.vz *= d;
      }
      p.vy -= p.grav * dt;
      // Smoke leans with the wind as it thins.
      const wind = p.kind === PUFF.smoke ? k * 1.2 : 0;
      p.x += (p.vx + WIND_X * wind) * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + WIND_Z * wind) * dt;
      const size = p.s0 + (p.s1 - p.s0) * (p.kind === PUFF.flash ? k : 1 - (1 - k) * (1 - k));
      const o = n * 16;
      m[o] = (1 - (yy + zz)) * size;
      m[o + 1] = (xy + wz) * size;
      m[o + 2] = (xz - wy) * size;
      m[o + 3] = 0;
      m[o + 4] = (xy - wz) * size;
      m[o + 5] = (1 - (xx + zz)) * size;
      m[o + 6] = (yz + wx) * size;
      m[o + 7] = 0;
      m[o + 8] = (xz + wy) * size;
      m[o + 9] = (yz - wx) * size;
      m[o + 10] = (1 - (xx + yy)) * size;
      m[o + 11] = 0;
      m[o + 12] = p.x;
      m[o + 13] = p.y;
      m[o + 14] = p.z;
      m[o + 15] = 1;
      tint[n * 3] = p.r;
      tint[n * 3 + 1] = p.g;
      tint[n * 3 + 2] = p.b;
      // Quick in, long out; a flash is gone before it is half over.
      const fade = p.kind === PUFF.flash ? (1 - k) * (1 - k) : Math.min(1, k * 12) * (1 - k) * (1 - k * 0.3);
      misc[n * 4] = p.a * fade;
      misc[n * 4 + 1] = k;
      misc[n * 4 + 2] = p.seed;
      misc[n * 4 + 3] = p.kind;
      n += 1;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tint.needsUpdate = true;
    this.misc.needsUpdate = true;
  }

  /** White water thrown up where something hits the sea: a few droplets that rise and fall, and a low patch of foam. */
  splash(x: number, y: number, z: number, size: number) {
    for (let i = 0; i < 4; i += 1) {
      this.spawn(PUFF.spray, x + (Math.random() - 0.5) * 0.5 * size, y + 0.1, z + (Math.random() - 0.5) * 0.5 * size, (Math.random() - 0.5) * 1.6 * size, (3 + Math.random() * 2.4) * size, (Math.random() - 0.5) * 1.6 * size, 0.16 * size, 0.55 * size, 0.45 + Math.random() * 0.3, 0.92, 0.95, 0.97, 0.6, 9);
    }
    this.spawn(PUFF.spray, x, y + 0.05, z, 0, 0.5 * size, 0, 0.3 * size, 1.5 * size, 0.7, 0.88, 0.92, 0.94, 0.22, 0, 1.5);
  }

  /** The flash of a matchlock and the white smoke that hangs at the muzzle and is blown away. */
  gunshot(x: number, y: number, z: number, dx: number, dz: number, scale: number) {
    this.spawn(PUFF.flash, x + dx * 0.9, y, z + dz * 0.9, dx * 2, 0.2, dz * 2, 0.5 * scale, 1.4 * scale, 0.14, 1, 0.74, 0.34, 1);
    this.spawn(PUFF.flash, x + dx * 0.7, y, z + dz * 0.7, dx, 0.1, dz, 0.3 * scale, 0.8 * scale, 0.09, 1, 0.96, 0.82, 1);
    for (let i = 0; i < 3; i += 1) {
      const f = i / 2;
      this.spawn(PUFF.smoke, x + dx * (0.9 + f * 1.1), y + f * 0.1, z + dz * (0.9 + f * 1.1), dx * (4.5 - f * 2.5) + (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.5, dz * (4.5 - f * 2.5) + (Math.random() - 0.5) * 0.8, (0.5 + f * 0.3) * scale, (1.9 + f * 1.1) * scale, 2.2 + Math.random() * 1.8 + f, 0.94, 0.94, 0.92, 0.85 - f * 0.2, -0.05, 1.8);
    }
  }

  /** A glint where two weapons meet. */
  spark(x: number, y: number, z: number, scale: number) {
    this.spawn(PUFF.flash, x, y, z, 0, 0, 0, 0.14 * scale, 0.5 * scale, 0.1, 1, 0.9, 0.7, 0.8);
  }
}
