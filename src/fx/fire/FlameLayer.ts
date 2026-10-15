import { AdditiveBlending, DynamicDrawUsage, InstancedBufferAttribute, Sprite, SpriteNodeMaterial, Vector3 } from 'three/webgpu';
import { abs, atan, cameraViewMatrix, float, instancedDynamicBufferAttribute, length, max, mix, pow, saturate, smoothstep, texture, time, uv, vec2, vec3, vec4 } from 'three/tsl';
import { particleNoise } from '../particleNoise';

/** Where a flame's foot is this frame: false when the place it burns on is gone (sunk, or the ship removed). */
export type FlameAnchor = (ship: number, site: number, x: number, y: number, z: number, out: Vector3) => boolean;

export type FlameOptions = {
  /** The ship the flame burns on, 0 for one floating free (a burning wreck on the water). */
  ship: number;
  /** Index of the burn site on that ship, handed back to the anchor. */
  site: number;
  /** The foot of the flame: in ship space on a ship, world space when free. */
  x: number;
  y: number;
  z: number;
  /** World direction the tongue leans toward on top of straight up (a gun port's flames, the wind). */
  leanX: number;
  leanZ: number;
  height: number;
  width: number;
  life: number;
  /** 0..1 how hot it burns: a hot tongue is yellow-white at its root, a dying one red. */
  heat: number;
  alpha?: number;
  /** Metres a second the tongue rises off its foot as it dies. */
  rise?: number;
};

const N = 17;

/**
 * Tongues of flame standing on the burning places of a ship. Each is a quad stood up along world up (leaning with the
 * wind), whose foot moves with the hull it burns on, so the fire stays on the ship instead of trailing behind it. The
 * shape, the licking and the colour come from the shared particle noise scrolled up the tongue, through a
 * black-body ramp from deep red at the tips to yellow-white at the root.
 */
export class FlameLayer {
  readonly sprite: Sprite;
  count = 0;
  private readonly cap: number;
  /** Per flame: ship site x y z leanX leanZ height width age life heat alpha rise seed lift (one spare). */
  private readonly f: Float32Array;
  private readonly pos: InstancedBufferAttribute;
  private readonly dir: InstancedBufferAttribute;
  private readonly misc: InstancedBufferAttribute;
  private readonly foot = new Vector3();

  constructor(capacity: number) {
    this.cap = capacity;
    this.f = new Float32Array(capacity * N);
    this.pos = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.dir = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.misc = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (const a of [this.pos, this.dir, this.misc]) a.setUsage(DynamicDrawUsage);

    const material = new SpriteNodeMaterial();
    const P: any = instancedDynamicBufferAttribute(this.pos, 'vec4');
    const D: any = instancedDynamicBufferAttribute(this.dir, 'vec4');
    const M: any = instancedDynamicBufferAttribute(this.misc, 'vec4');
    const viewDir = cameraViewMatrix.mul(vec4(D.xyz, 0)).xyz;
    material.positionNode = P.xyz;
    // The quad's x axis is turned onto the tongue's direction on screen, so uv.x runs from the foot to the tip.
    material.rotationNode = atan(viewDir.y, viewDir.x);
    // Seen from above a standing flame foreshortens; it never shrinks below half so it still reads from the battle camera.
    material.scaleNode = vec2(P.w.mul(max(length(viewDir.xy), 0.55)), D.w);
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    material.blending = AdditiveBlending;

    const alpha = M.x;
    const heat = M.y;
    const seed = M.z;
    const age = M.w;
    const along: any = uv().x;
    const across: any = uv().y.sub(0.5).mul(2);
    const noise = particleNoise();
    const speed = seed.mul(0.6).add(0.9);
    // Two octaves of the noise scrolled up the tongue: a slow sway of the whole flame and fast licks at its edges.
    const slow: any = texture(noise, vec2(across.mul(0.22).add(seed.mul(7.3)), along.mul(0.42).sub(time.mul(0.75).mul(speed))));
    const fast: any = texture(noise, vec2(across.mul(0.55).add(seed.mul(3.1)), along.mul(1.1).sub(time.mul(2.3).mul(speed))));
    const turb = slow.r.sub(0.5).add(fast.g.sub(0.5).mul(0.7));
    // The sway grows toward the tip, where a real flame is free to lick about; the root stays put on the timber.
    const x = across.add(turb.mul(along).mul(1.5));
    const a = along.add(fast.b.sub(0.5).mul(along).mul(0.9)).add(slow.a.sub(0.5).mul(0.25));
    const width = pow(saturate(float(1).sub(a)), float(0.55)).mul(smoothstep(-0.04, 0.16, along).mul(0.45).add(0.55));
    const inside = float(1).sub(abs(x).div(max(width, 0.001)));
    const density = smoothstep(0.0, 0.5, inside).mul(smoothstep(0.0, 0.07, along)).mul(smoothstep(1.0, 0.82, along));
    // Hottest low in the middle of the tongue, cooling toward its edges and tip and as it dies.
    const temp = saturate(density.mul(pow(saturate(float(1).sub(a)), float(0.8))).mul(heat.mul(0.5).add(0.5)).mul(float(1).sub(age.mul(0.5))).mul(1.15));
    // Black-body colours of a wood fire: dull red, orange, yellow, a pale core.
    const red: any = vec3(0.42, 0.035, 0.0);
    const orange = vec3(1.0, 0.3, 0.035);
    const yellow = vec3(1.0, 0.62, 0.18);
    const core = vec3(1.0, 0.9, 0.62);
    const ramp: any = mix(mix(mix(red, orange, smoothstep(0.08, 0.35, temp)), yellow, smoothstep(0.35, 0.68, temp)), core, smoothstep(0.78, 1.0, temp));
    material.colorNode = vec4(ramp.mul(temp.mul(temp).mul(2.6).add(0.45)), 1);
    material.opacityNode = density.mul(smoothstep(0.02, 0.16, temp)).mul(alpha);

    const sprite = new Sprite(material);
    sprite.count = 0;
    sprite.frustumCulled = false;
    sprite.renderOrder = 3;
    this.sprite = sprite;
  }

  /** Room left, as a share of the pool: the fires thin their emission as it fills. */
  get room() {
    return 1 - this.count / this.cap;
  }

  emit(o: FlameOptions) {
    if (this.count >= this.cap) return;
    const f = this.f;
    const i = this.count++ * N;
    f[i] = o.ship;
    f[i + 1] = o.site;
    f[i + 2] = o.x;
    f[i + 3] = o.y;
    f[i + 4] = o.z;
    f[i + 5] = o.leanX;
    f[i + 6] = o.leanZ;
    f[i + 7] = o.height;
    f[i + 8] = o.width;
    f[i + 9] = 0;
    f[i + 10] = o.life;
    f[i + 11] = o.heat;
    f[i + 12] = o.alpha ?? 1;
    f[i + 13] = o.rise ?? 1;
    f[i + 14] = Math.random();
    f[i + 15] = 0;
    f[i + 16] = 0;
  }

  /** Drops every flame on a ship at once (it went under, or the battle was cleared). */
  clear(ship?: number) {
    if (ship === undefined) {
      this.count = 0;
      return;
    }
    for (let n = this.count - 1; n >= 0; n -= 1) if (this.f[n * N] === ship) this.remove(n);
  }

  private remove(n: number) {
    const last = --this.count;
    if (n === last) return;
    const f = this.f;
    for (let k = 0; k < N; k += 1) f[n * N + k] = f[last * N + k]!;
  }

  update(dt: number, windX: number, windZ: number, anchor: FlameAnchor) {
    const f = this.f;
    const P = this.pos.array as Float32Array;
    const D = this.dir.array as Float32Array;
    const M = this.misc.array as Float32Array;
    const foot = this.foot;
    // Compacted in place as it goes, so what is drawn at slot w is the flame that now lives there.
    let w = 0;
    for (let n = 0; n < this.count; n += 1) {
      let i = n * N;
      const age = (f[i + 9] = f[i + 9]! + dt);
      const life = f[i + 10]!;
      if (age >= life) continue;
      const ship = f[i]!;
      if (ship > 0) {
        if (!anchor(ship, f[i + 1]!, f[i + 2]!, f[i + 3]!, f[i + 4]!, foot)) continue;
      } else foot.set(f[i + 2]!, f[i + 3]!, f[i + 4]!);
      if (w !== n) {
        f.copyWithin(w * N, i, i + N);
        i = w * N;
      }
      const t = age / life;
      // A tongue leaps up, holds, then lifts off its foot and burns out.
      if (t > 0.45) f[i + 15] = f[i + 15]! + f[i + 13]! * dt;
      const grow = Math.min(1, t / 0.18);
      const h = f[i + 7]! * (0.55 + 0.45 * grow) * (1 - 0.25 * t);
      // Leaning with the wind and away from the hull; a flame never leans more than about 40 degrees.
      let dx = f[i + 5]! + windX * 0.05;
      let dz = f[i + 6]! + windZ * 0.05;
      const lean = Math.hypot(dx, dz);
      if (lean > 0.85) {
        dx *= 0.85 / lean;
        dz *= 0.85 / lean;
      }
      const inv = 1 / Math.sqrt(1 + dx * dx + dz * dz);
      const ux = dx * inv;
      const uy = inv;
      const uz = dz * inv;
      const lift = f[i + 15]!;
      const o = w * 4;
      P[o] = foot.x + ux * (h * 0.5 + lift);
      P[o + 1] = foot.y + uy * (h * 0.5 + lift);
      P[o + 2] = foot.z + uz * (h * 0.5 + lift);
      P[o + 3] = h;
      D[o] = ux;
      D[o + 1] = uy;
      D[o + 2] = uz;
      D[o + 3] = f[i + 8]! * (0.7 + 0.3 * grow);
      M[o] = f[i + 12]! * Math.min(1, t * 10) * (t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1);
      M[o + 1] = f[i + 11]!;
      M[o + 2] = f[i + 14]!;
      M[o + 3] = t;
      w += 1;
    }
    this.count = w;
    for (const a of [this.pos, this.dir, this.misc]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(4, this.count * 4));
      a.needsUpdate = true;
    }
    this.sprite.count = this.count;
  }
}
