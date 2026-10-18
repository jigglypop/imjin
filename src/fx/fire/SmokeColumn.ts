import { InstancedBufferAttribute, NormalBlending, Sprite, SpriteNodeMaterial, type Camera } from 'three/webgpu';
import { cameraViewMatrix, float, instancedBufferAttribute, length, max, mix, normalize, positionWorld, pow, saturate, smoothstep, sqrt, texture, time, uv, vec2, vec3, vec4 } from 'three/tsl';
import { atmosphere } from '../../render/atmosphere';
import { particleNoise, puffNoise } from '../particleNoise';

export type PlumeOptions = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size0: number;
  size1: number;
  alpha: number;
  /** Albedo of the smoke: near black for a blaze, grey for a dying fire, white for steam. */
  shade: number;
  /** 0..1 how hard the fire under it burns: how bright its underside glows while it is low over the flames. */
  glow: number;
  /** Height of the fire it rose from: the glow fades with the height above it. */
  baseY: number;
  drag: number;
  lift: number;
  wind: number;
};

const N = 18;

/**
 * The smoke of burning ships: thick black-brown billows rising in a column and leaning off downwind. Shaded like the
 * battle's other smoke from the shared noise texture and the sky's light, and lit from below by the fire: the glow is
 * strongest on the underside of the puffs just over the flames and fades with the height above them, flickering
 * through the column in patches that move with it rather than puff by puff. Sorted far to near each frame (a packed
 * depth and index key, sorted natively) so the dense billows overlap the right way round.
 */
export class SmokeColumn {
  readonly sprite: Sprite;
  count = 0;
  private readonly cap: number;
  /** Per puff: x y z vx vy vz age life s0 s1 alpha shade glow baseY drag lift wind seed. */
  private readonly f: Float32Array;
  private readonly keys: Uint32Array;
  private readonly pos: InstancedBufferAttribute;
  private readonly params: InstancedBufferAttribute;
  private readonly tint: InstancedBufferAttribute;

  constructor(capacity: number) {
    this.cap = Math.min(capacity, 4095);
    this.f = new Float32Array(this.cap * N);
    this.keys = new Uint32Array(this.cap);
    this.pos = new InstancedBufferAttribute(new Float32Array(this.cap * 4), 4);
    this.params = new InstancedBufferAttribute(new Float32Array(this.cap * 4), 4);
    this.tint = new InstancedBufferAttribute(new Float32Array(this.cap * 4), 4);

    const material = new SpriteNodeMaterial();
    const P: any = instancedBufferAttribute(this.pos, 'vec4');
    const Q: any = instancedBufferAttribute(this.params, 'vec4');
    const T: any = instancedBufferAttribute(this.tint, 'vec4');
    material.positionNode = P.xyz;
    material.rotationNode = Q.y;
    material.scaleNode = Q.x;
    material.transparent = true;
    material.depthWrite = false;
    material.fog = true;
    material.blending = NormalBlending;
    const c: any = uv().sub(0.5).mul(2);
    const r = length(c);
    const life = P.w;
    const seed = Q.w;
    // A billow is denser and lumpier than gunsmoke: the noise cuts deep folds into its edge, the core stays opaque.
    const n: any = puffNoise(c.mul(1.25).add(vec2(seed.mul(53.0), seed.mul(29.0))), life, 1.6);
    const density = smoothstep(1.0, 0.25, r.add(n.mul(0.75)));
    const erosion = life.mul(life).mul(0.5);
    const mask = saturate(density.sub(erosion).mul(2.3)).mul(smoothstep(1.0, 0.7, r));
    const nz = sqrt(max(float(1).sub(r.mul(r)), 0.08));
    const normalView = normalize(vec3(c.x.add(n.mul(0.8)), c.y.add(n.mul(0.8)), nz));
    const lightView = normalize(cameraViewMatrix.mul(vec4(atmosphere.sunDir, 0)).xyz);
    const ndl = saturate(normalView.dot(lightView).mul(0.5).add(0.5));
    const thickness = smoothstep(0.0, 0.9, density);
    const sun = atmosphere.sunIrradiance.mul(pow(ndl, float(1.5))).mul(0.22).mul(float(1.1).sub(thickness.mul(0.6)));
    const ambient = atmosphere.skyAmbient.mul(float(0.7).add(c.y.mul(0.3)));
    // Firelight from below: patches of the column flare and dim together, as the flames under them do.
    const flick: any = texture(particleNoise(), positionWorld.xz.mul(0.012).add(vec2(time.mul(0.21), time.mul(-0.17))));
    const flare = flick.r.mul(1.6).sub(0.3).max(0.15);
    const under = smoothstep(0.1, -0.95, c.y.add(n.mul(0.4)));
    const fire: any = mix(vec3(0.75, 0.1, 0.015), vec3(1.0, 0.36, 0.06), T.w);
    // Against daylight the fire's light on the smoke is a faint warmth; at night it is most of what lights the column.
    const glow = fire.mul(T.w.mul(T.w).mul(atmosphere.night.mul(1.8).add(0.7))).mul(under.mul(0.85).add(0.15)).mul(thickness.mul(0.6).add(0.4)).mul(flare);
    material.colorNode = vec4(vec3(T.x, T.x.mul(0.93), T.x.mul(0.85)).mul(ambient.add(sun)).add(glow), 1);
    const waterFade = smoothstep(-0.5, 1.5, positionWorld.y);
    material.opacityNode = mask.mul(Q.z).mul(waterFade);

    const sprite = new Sprite(material);
    sprite.count = 0;
    sprite.frustumCulled = false;
    sprite.renderOrder = 2;
    this.sprite = sprite;
  }

  /** Room left, as a share of the pool: the fires thin their smoke as it fills. */
  get room() {
    return 1 - this.count / this.cap;
  }

  emit(o: PlumeOptions) {
    if (this.count >= this.cap) return;
    const f = this.f;
    const i = this.count++ * N;
    f[i] = o.x;
    f[i + 1] = o.y;
    f[i + 2] = o.z;
    f[i + 3] = o.vx;
    f[i + 4] = o.vy;
    f[i + 5] = o.vz;
    f[i + 6] = 0;
    f[i + 7] = o.life;
    f[i + 8] = o.size0;
    f[i + 9] = o.size1;
    f[i + 10] = o.alpha;
    f[i + 11] = o.shade;
    f[i + 12] = o.glow;
    f[i + 13] = o.baseY;
    f[i + 14] = o.drag;
    f[i + 15] = o.lift;
    f[i + 16] = o.wind;
    f[i + 17] = Math.random();
  }

  clear() {
    this.count = 0;
  }

  update(dt: number, windX: number, windZ: number, camera: Camera) {
    const f = this.f;
    let w = 0;
    for (let n = 0; n < this.count; n += 1) {
      let i = n * N;
      const age = (f[i + 6] = f[i + 6]! + dt);
      if (age >= f[i + 7]!) continue;
      if (w !== n) {
        f.copyWithin(w * N, i, i + N);
        i = w * N;
      }
      const damp = Math.exp(-f[i + 14]! * dt);
      const wk = f[i + 16]!;
      // Wind takes the smoke more the higher it has risen over the sheltered water.
      const aloft = Math.min(1.6, 0.6 + Math.max(0, f[i + 1]! - f[i + 13]!) / 40);
      f[i + 3] = f[i + 3]! * damp + windX * wk * aloft * (1 - damp);
      f[i + 5] = f[i + 5]! * damp + windZ * wk * aloft * (1 - damp);
      f[i + 4] = f[i + 4]! * damp + f[i + 15]! * dt;
      f[i] = f[i]! + f[i + 3]! * dt;
      f[i + 1] = f[i + 1]! + f[i + 4]! * dt;
      f[i + 2] = f[i + 2]! + f[i + 5]! * dt;
      w += 1;
    }
    this.count = w;
    const n = w;
    // Far to near: the view-space depth quantised to 20 bits above a 12-bit index, sorted as plain integers.
    const e = camera.matrixWorldInverse.elements;
    const keys = this.keys;
    for (let k = 0; k < n; k += 1) {
      const i = k * N;
      const depth = -(e[2]! * f[i]! + e[6]! * f[i + 1]! + e[10]! * f[i + 2]! + e[14]!);
      const q = Math.max(0, Math.min(0xfffff, Math.round(0xfffff - depth * 64)));
      keys[k] = ((q << 12) | k) >>> 0;
    }
    const sorted = keys.subarray(0, n).sort();
    const P = this.pos.array as Float32Array;
    const Q = this.params.array as Float32Array;
    const T = this.tint.array as Float32Array;
    for (let k = 0; k < n; k += 1) {
      const i = (sorted[k]! & 0xfff) * N;
      const t = f[i + 6]! / f[i + 7]!;
      const grow = 1 - Math.pow(1 - t, 2);
      const fadeIn = Math.min(1, f[i + 6]! / 0.6);
      const o = k * 4;
      P[o] = f[i]!;
      P[o + 1] = f[i + 1]!;
      P[o + 2] = f[i + 2]!;
      P[o + 3] = t;
      Q[o] = f[i + 8]! + (f[i + 9]! - f[i + 8]!) * grow;
      Q[o + 1] = f[i + 17]! * 6.283 + t * 0.6 * (f[i + 17]! - 0.5);
      Q[o + 2] = f[i + 10]! * fadeIn * (1 - t * t);
      Q[o + 3] = f[i + 17]!;
      T[o] = f[i + 11]!;
      T[o + 1] = 0;
      T[o + 2] = 0;
      // The fire's light on the puff: full just over the flames, gone some thirty metres up.
      T[o + 3] = f[i + 12]! * Math.exp(-Math.max(0, f[i + 1]! - f[i + 13]!) / 16);
    }
    for (const a of [this.pos, this.params, this.tint]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(4, n * 4));
      a.needsUpdate = true;
    }
    this.sprite.count = n;
  }
}
