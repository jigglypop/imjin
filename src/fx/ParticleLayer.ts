import {
  AdditiveBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  NormalBlending,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
  type Camera,
} from 'three/webgpu';
import {
  atan,
  cameraViewMatrix,
  vec2,
  float,
  instancedDynamicBufferAttribute,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  normalize,
  positionWorld,
  pow,
  saturate,
  smoothstep,
  sqrt,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { atmosphere } from '../render/atmosphere';
import type { ParticleQuality } from '../game/quality';

export type ParticleKind = 'smoke' | 'fire' | 'spray';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export type EmitOptions = {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size0: number;
  size1: number;
  alpha?: number;
  r?: number;
  g?: number;
  b?: number;
  heat?: number;
  drag?: number;
  lift?: number;
  spin?: number;
  wind?: number;
  rot?: number;
};

export class ParticleLayer {
  readonly sprite: Sprite;
  readonly capacity: number;
  count = 0;
  private readonly pos: InstancedBufferAttribute;
  private readonly params: InstancedBufferAttribute;
  private readonly tint: InstancedBufferAttribute;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly a0: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly drag: Float32Array;
  private readonly lift: Float32Array;
  private readonly windK: Float32Array;
  private readonly seed: Float32Array;
  private readonly col: Float32Array;
  private readonly heat: Float32Array;
  private readonly order: Uint32Array;
  private readonly depth: Float32Array;
  private readonly sorted: boolean;
  private keep: number;
  private readonly tmp = new Vector3();

  constructor(readonly kind: ParticleKind, capacity: number, quality: ParticleQuality) {
    this.capacity = capacity;
    this.keep = quality.keep;
    // Shader noise octaves scale with the tier. High keeps the original counts.
    const octaves = (base: number) => Math.max(1, Math.round(base * quality.noise));
    this.pos = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.params = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.tint = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (const a of [this.pos, this.params, this.tint]) a.setUsage(DynamicDrawUsage);
    const f = () => new Float32Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.s0 = f();
    this.s1 = f();
    this.a0 = f();
    this.rot = f();
    this.spin = f();
    this.drag = f();
    this.lift = f();
    this.windK = f();
    this.seed = f();
    this.heat = f();
    this.col = new Float32Array(capacity * 3);
    this.order = new Uint32Array(capacity);
    this.depth = new Float32Array(capacity);
    this.sorted = kind !== 'fire' && quality.sort;

    const material = new SpriteNodeMaterial();
    const P: any = instancedDynamicBufferAttribute(this.pos, 'vec4');
    const Q: any = instancedDynamicBufferAttribute(this.params, 'vec4');
    const T: any = instancedDynamicBufferAttribute(this.tint, 'vec4');
    material.positionNode = P.xyz;
    material.rotationNode = Q.y;
    material.transparent = true;
    material.depthWrite = false;
    material.fog = true;
    const c = uv().sub(0.5).mul(2);
    const r = length(c);
    const seed = Q.w;
    const life = P.w;
    if (kind === 'fire') {
      material.scaleNode = vec2(Q.x.mul(0.72), Q.x.mul(1.2));
      material.blending = AdditiveBlending;
      material.fog = false;
      const flow = vec3(c.x.mul(1.6).add(seed.mul(41.0)), c.y.mul(1.1).sub(life.mul(2.6)).add(seed.mul(17.0)), seed.mul(5.0));
      const n = mx_fractal_noise_float(flow, octaves(4), 2.0, 0.5, 1.0);
      const body = length(vec2(c.x.mul(1.35), c.y.mul(0.85).add(0.22)));
      const shape = saturate(float(1).sub(body.add(n.mul(0.55)).add(uv().y.mul(0.3))).mul(2.2));
      const temp = shape.mul(float(1).sub(life.mul(0.75))).mul(T.w.mul(0.5).add(0.5));
      const ember = vec3(0.55, 0.06, 0.0);
      const flame = vec3(1.0, 0.42, 0.06);
      const core = vec3(1.0, 0.86, 0.55);
      const ramp = mix(mix(ember, flame, smoothstep(0.08, 0.38, temp)), core, smoothstep(0.42, 0.85, temp));
      material.colorNode = vec4(ramp.mul(T.rgb).mul(temp.mul(5.5).add(0.4)), 1);
      material.opacityNode = smoothstep(0.02, 0.2, temp).mul(Q.z).mul(smoothstep(1.0, 0.75, r));
    } else if (kind === 'smoke') {
      material.scaleNode = Q.x;
      material.blending = NormalBlending;
      const p3 = vec3(c.mul(1.15).add(vec2(seed.mul(53.0), seed.mul(29.0))), life.mul(1.3).add(seed.mul(11.0)));
      const n = mx_fractal_noise_float(p3, octaves(5), 2.1, 0.55, 1.0);
      const density = smoothstep(1.0, 0.2, r.add(n.mul(0.62)));
      const erosion = life.mul(life).mul(0.55);
      const mask = saturate(density.sub(erosion).mul(1.9)).mul(smoothstep(1.0, 0.72, r));
      const nz = sqrt(max(float(1).sub(r.mul(r)), 0.08));
      const normalView = normalize(vec3(c.x.add(n.mul(0.9)), c.y.add(n.mul(0.9)), nz));
      const lightView = normalize(cameraViewMatrix.mul(vec4(atmosphere.sunDir, 0)).xyz);
      const ndl = saturate(normalView.dot(lightView).mul(0.5).add(0.5));
      const thickness = smoothstep(0.0, 0.9, density);
      const sunLight = atmosphere.sunIrradiance.mul(pow(ndl, float(1.4))).mul(0.28).mul(float(1.15).sub(thickness.mul(0.5)));
      const ambient = atmosphere.skyAmbient.mul(float(0.75).add(c.y.mul(0.25)));
      const glow = vec3(1.0, 0.36, 0.07).mul(T.w).mul(smoothstep(0.2, -0.9, c.y)).mul(thickness).mul(0.6);
      material.colorNode = vec4(T.rgb.mul(ambient.add(sunLight)).add(glow), 1);
      const waterFade = smoothstep(-0.5, 2.0, positionWorld.y);
      material.opacityNode = mask.mul(Q.z).mul(waterFade);
    } else {
      material.scaleNode = Q.x;
      material.blending = NormalBlending;
      const n = mx_fractal_noise_float(vec3(c.mul(2.2), seed.mul(9.7).add(life.mul(2.0))), octaves(3), 2.0, 0.5, 1.0);
      const mask = smoothstep(1.0, 0.1, r.add(n.mul(0.7))).mul(smoothstep(1.0, 0.7, r));
      const lit = atmosphere.skyAmbient.mul(1.15).add(atmosphere.sunIrradiance.mul(0.14));
      material.colorNode = vec4(T.rgb.mul(lit), 1);
      material.opacityNode = mask.mul(Q.z);
    }
    const sprite = new Sprite(material);
    sprite.count = 0;
    sprite.frustumCulled = false;
    sprite.renderOrder = kind === 'fire' ? 3 : kind === 'smoke' ? 2 : 1;
    this.sprite = sprite;
  }

  /** Emission rate in run time. Below 1, some emitters are dropped at random. Above 1, some are doubled with a small offset. */
  setKeep(keep: number) {
    this.keep = keep;
  }

  emit(o: EmitOptions) {
    const k = this.keep;
    const whole = Math.floor(k);
    const copies = whole + (Math.random() < k - whole ? 1 : 0);
    for (let c = 0; c < copies; c += 1) {
      if (c === 0) this.spawn(o);
      else this.spawn({ ...o, x: o.x + rnd(-0.3, 0.3), z: o.z + rnd(-0.3, 0.3) });
    }
  }

  private spawn(o: EmitOptions) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.px[i] = o.x;
    this.py[i] = o.y;
    this.pz[i] = o.z;
    this.vx[i] = o.vx ?? 0;
    this.vy[i] = o.vy ?? 0;
    this.vz[i] = o.vz ?? 0;
    this.age[i] = 0;
    this.life[i] = o.life;
    this.s0[i] = o.size0;
    this.s1[i] = o.size1;
    this.a0[i] = o.alpha ?? 1;
    this.rot[i] = o.rot ?? Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() - 0.5) * (o.spin ?? 0.4);
    this.drag[i] = o.drag ?? 0.5;
    this.lift[i] = o.lift ?? 0;
    this.windK[i] = o.wind ?? 1;
    this.seed[i] = Math.random();
    this.heat[i] = o.heat ?? 0;
    this.col[i * 3] = o.r ?? 1;
    this.col[i * 3 + 1] = o.g ?? 1;
    this.col[i * 3 + 2] = o.b ?? 1;
  }

  private kill(i: number) {
    const last = --this.count;
    if (i === last) return;
    this.px[i] = this.px[last]!;
    this.py[i] = this.py[last]!;
    this.pz[i] = this.pz[last]!;
    this.vx[i] = this.vx[last]!;
    this.vy[i] = this.vy[last]!;
    this.vz[i] = this.vz[last]!;
    this.age[i] = this.age[last]!;
    this.life[i] = this.life[last]!;
    this.s0[i] = this.s0[last]!;
    this.s1[i] = this.s1[last]!;
    this.a0[i] = this.a0[last]!;
    this.rot[i] = this.rot[last]!;
    this.spin[i] = this.spin[last]!;
    this.drag[i] = this.drag[last]!;
    this.lift[i] = this.lift[last]!;
    this.windK[i] = this.windK[last]!;
    this.seed[i] = this.seed[last]!;
    this.heat[i] = this.heat[last]!;
    this.col[i * 3] = this.col[last * 3]!;
    this.col[i * 3 + 1] = this.col[last * 3 + 1]!;
    this.col[i * 3 + 2] = this.col[last * 3 + 2]!;
  }

  update(dt: number, windX: number, windZ: number, camera: Camera) {
    for (let i = this.count - 1; i >= 0; i -= 1) {
      const age = (this.age[i] = this.age[i]! + dt);
      if (age >= this.life[i]!) {
        this.kill(i);
        continue;
      }
      const damp = Math.exp(-this.drag[i]! * dt);
      const wk = this.windK[i]!;
      this.vx[i] = this.vx[i]! * damp + windX * wk * (1 - damp);
      this.vz[i] = this.vz[i]! * damp + windZ * wk * (1 - damp);
      this.vy[i] = this.vy[i]! * damp + this.lift[i]! * dt;
      this.px[i] = this.px[i]! + this.vx[i]! * dt;
      this.py[i] = this.py[i]! + this.vy[i]! * dt;
      this.pz[i] = this.pz[i]! + this.vz[i]! * dt;
      this.rot[i] = this.rot[i]! + this.spin[i]! * dt;
    }
    const n = this.count;
    for (let i = 0; i < n; i += 1) this.order[i] = i;
    if (this.sorted && n > 1) {
      const e = camera.matrixWorldInverse.elements;
      for (let i = 0; i < n; i += 1) this.depth[i] = e[2]! * this.px[i]! + e[6]! * this.py[i]! + e[10]! * this.pz[i]! + e[14]!;
      const depth = this.depth;
      const view = this.order.subarray(0, n);
      view.sort((a, b) => depth[a]! - depth[b]!);
    }
    const P = this.pos.array as Float32Array;
    const Q = this.params.array as Float32Array;
    const T = this.tint.array as Float32Array;
    for (let k = 0; k < n; k += 1) {
      const i = this.order[k]!;
      const t = this.age[i]! / this.life[i]!;
      const grow = 1 - Math.pow(1 - t, 2.2);
      const size = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * grow;
      const fadeIn = Math.min(1, this.age[i]! / Math.min(0.15, this.life[i]! * 0.2));
      const fadeOut = this.kind === 'fire' ? Math.pow(1 - t, 1.3) : 1 - t * t;
      const o = k * 4;
      P[o] = this.px[i]!;
      P[o + 1] = this.py[i]!;
      P[o + 2] = this.pz[i]!;
      P[o + 3] = t;
      Q[o] = size;
      Q[o + 1] = this.rot[i]!;
      Q[o + 2] = this.a0[i]! * fadeIn * fadeOut;
      Q[o + 3] = this.seed[i]!;
      T[o] = this.col[i * 3]!;
      T[o + 1] = this.col[i * 3 + 1]!;
      T[o + 2] = this.col[i * 3 + 2]!;
      T[o + 3] = this.kind === 'fire' ? this.heat[i]! * (1 - t * 0.7) : this.heat[i]! * Math.max(0, 1 - t * 4);
    }
    for (const a of [this.pos, this.params, this.tint]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(4, n * 4));
      a.needsUpdate = true;
    }
    this.sprite.count = n;
    this.tmp.set(0, 0, 0);
  }
}

export type StreakOptions = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  /** Streak length is the larger of `minLen` and speed * `stretch`, in metres. */
  minLen: number;
  stretch: number;
  width: number;
  r: number;
  g: number;
  b: number;
  alpha?: number;
  gravity?: number;
  drag?: number;
};

/**
 * Velocity-aligned additive streaks: sparks, tracers, glowing embers. A streak is a sprite stretched along its
 * direction on screen, brightest at the head and fading to nothing at the tail, so it reads as motion at any zoom.
 * Persistent streaks fly under gravity and drag; `put` draws a streak for the current frame only (projectile tracers).
 */
export class StreakLayer {
  readonly sprite: Sprite;
  count = 0;
  private imm = 0;
  private keep: number;
  private readonly cap: number;
  private readonly immCap: number;
  private readonly pos: InstancedBufferAttribute;
  private readonly dir: InstancedBufferAttribute;
  private readonly tint: InstancedBufferAttribute;
  /** Per streak: x y z vx vy vz age life minLen stretch width r g b a0 gravity drag. */
  private readonly s: Float32Array;
  private readonly frame: Float32Array;
  private static readonly N = 17;

  constructor(capacity: number, immediate: number, quality: ParticleQuality) {
    this.cap = capacity;
    this.immCap = immediate;
    this.keep = quality.keep;
    this.s = new Float32Array(capacity * StreakLayer.N);
    this.frame = new Float32Array(immediate * 12);
    const total = capacity + immediate;
    this.pos = new InstancedBufferAttribute(new Float32Array(total * 4), 4);
    this.dir = new InstancedBufferAttribute(new Float32Array(total * 4), 4);
    this.tint = new InstancedBufferAttribute(new Float32Array(total * 4), 4);
    for (const a of [this.pos, this.dir, this.tint]) a.setUsage(DynamicDrawUsage);
    const material = new SpriteNodeMaterial();
    const P: any = instancedDynamicBufferAttribute(this.pos, 'vec4');
    const D: any = instancedDynamicBufferAttribute(this.dir, 'vec4');
    const T: any = instancedDynamicBufferAttribute(this.tint, 'vec4');
    const viewDir = cameraViewMatrix.mul(vec4(D.xyz, 0)).xyz;
    material.positionNode = P.xyz;
    material.rotationNode = atan(viewDir.y, viewDir.x);
    // The foreshortened length plus the width, so a streak seen end-on shrinks to a round dot.
    material.scaleNode = vec2(P.w.mul(length(viewDir.xy)).add(D.w), D.w);
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    material.blending = AdditiveBlending;
    const along = uv().x;
    const across = uv().y.sub(0.5).mul(2).abs();
    const head = pow(along, float(1.7));
    const shape = head.mul(smoothstep(1.0, 0.15, across)).mul(smoothstep(1.0, 0.82, along));
    const core = mix(T.rgb, vec3(1.0, 0.95, 0.8), pow(along, float(5)).mul(0.8));
    material.colorNode = vec4(core.mul(head.mul(2.4).add(0.5)), 1);
    material.opacityNode = shape.mul(T.w);
    const sprite = new Sprite(material);
    sprite.count = 0;
    sprite.frustumCulled = false;
    sprite.renderOrder = 3;
    this.sprite = sprite;
  }

  setKeep(keep: number) {
    this.keep = keep;
  }

  emit(o: StreakOptions) {
    if (this.count >= this.cap || (this.keep < 1 && Math.random() > this.keep)) return;
    const a = this.s;
    const i = this.count++ * StreakLayer.N;
    a[i] = o.x;
    a[i + 1] = o.y;
    a[i + 2] = o.z;
    a[i + 3] = o.vx;
    a[i + 4] = o.vy;
    a[i + 5] = o.vz;
    a[i + 6] = 0;
    a[i + 7] = o.life;
    a[i + 8] = o.minLen;
    a[i + 9] = o.stretch;
    a[i + 10] = o.width;
    a[i + 11] = o.r;
    a[i + 12] = o.g;
    a[i + 13] = o.b;
    a[i + 14] = o.alpha ?? 1;
    a[i + 15] = o.gravity ?? 0;
    a[i + 16] = o.drag ?? 0;
  }

  /** A streak for this frame only: head position, unit direction, length and width in metres. */
  put(hx: number, hy: number, hz: number, dx: number, dy: number, dz: number, len: number, width: number, r: number, g: number, b: number, alpha: number) {
    if (this.imm >= this.immCap) return;
    const f = this.frame;
    const i = this.imm++ * 12;
    f[i] = hx - dx * len * 0.5;
    f[i + 1] = hy - dy * len * 0.5;
    f[i + 2] = hz - dz * len * 0.5;
    f[i + 3] = len;
    f[i + 4] = dx;
    f[i + 5] = dy;
    f[i + 6] = dz;
    f[i + 7] = width;
    f[i + 8] = r;
    f[i + 9] = g;
    f[i + 10] = b;
    f[i + 11] = alpha;
  }

  update(dt: number) {
    const a = this.s;
    const N = StreakLayer.N;
    const P = this.pos.array as Float32Array;
    const D = this.dir.array as Float32Array;
    const T = this.tint.array as Float32Array;
    for (let n = this.count - 1; n >= 0; n -= 1) {
      const i = n * N;
      const age = (a[i + 6] = a[i + 6]! + dt);
      if (age >= a[i + 7]!) {
        const last = --this.count * N;
        if (last !== i) for (let k = 0; k < N; k += 1) a[i + k] = a[last + k]!;
        continue;
      }
      const damp = Math.exp(-a[i + 16]! * dt);
      a[i + 3] = a[i + 3]! * damp;
      a[i + 4] = a[i + 4]! * damp - a[i + 15]! * dt;
      a[i + 5] = a[i + 5]! * damp;
      a[i] = a[i]! + a[i + 3]! * dt;
      a[i + 1] = a[i + 1]! + a[i + 4]! * dt;
      a[i + 2] = a[i + 2]! + a[i + 5]! * dt;
    }
    for (let n = 0; n < this.count; n += 1) {
      const i = n * N;
      const vx = a[i + 3]!;
      const vy = a[i + 4]!;
      const vz = a[i + 5]!;
      const speed = Math.hypot(vx, vy, vz);
      const inv = speed > 1e-3 ? 1 / speed : 0;
      const len = Math.max(a[i + 8]!, speed * a[i + 9]!);
      const t = a[i + 6]! / a[i + 7]!;
      const dx = speed > 1e-3 ? vx * inv : 0;
      const dy = speed > 1e-3 ? vy * inv : 1;
      const dz = speed > 1e-3 ? vz * inv : 0;
      const o = n * 4;
      P[o] = a[i]! - dx * len * 0.5;
      P[o + 1] = a[i + 1]! - dy * len * 0.5;
      P[o + 2] = a[i + 2]! - dz * len * 0.5;
      P[o + 3] = len;
      D[o] = dx;
      D[o + 1] = dy;
      D[o + 2] = dz;
      D[o + 3] = a[i + 10]! * (1 - t * 0.5);
      T[o] = a[i + 11]!;
      T[o + 1] = a[i + 12]!;
      T[o + 2] = a[i + 13]!;
      T[o + 3] = a[i + 14]! * (1 - t) * Math.min(1, a[i + 6]! * 60);
    }
    const f = this.frame;
    for (let n = 0; n < this.imm; n += 1) {
      const i = n * 12;
      const o = (this.count + n) * 4;
      P[o] = f[i]!;
      P[o + 1] = f[i + 1]!;
      P[o + 2] = f[i + 2]!;
      P[o + 3] = f[i + 3]!;
      D[o] = f[i + 4]!;
      D[o + 1] = f[i + 5]!;
      D[o + 2] = f[i + 6]!;
      D[o + 3] = f[i + 7]!;
      T[o] = f[i + 8]!;
      T[o + 1] = f[i + 9]!;
      T[o + 2] = f[i + 10]!;
      T[o + 3] = f[i + 11]!;
    }
    const total = this.count + this.imm;
    this.imm = 0;
    for (const attr of [this.pos, this.dir, this.tint]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(4, total * 4));
      attr.needsUpdate = true;
    }
    this.sprite.count = total;
  }
}
