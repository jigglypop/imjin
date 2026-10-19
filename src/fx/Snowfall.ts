import { NormalBlending, Sprite, SpriteNodeMaterial, Vector3 } from 'three/webgpu';
import { float, fract, hash, instanceIndex, smoothstep, time, uniform, uv, vec3, vec4 } from 'three/tsl';

/**
 * Falling snow round the camera: sprites in a box that follows the eye, their places from their index and the clock, so
 * nothing is written per frame. The box grows with the camera's height so snow reads at every zoom. `count` is the
 * device tier's (fewer on phones).
 */
export class Snowfall {
  readonly sprite: Sprite;
  private readonly center = uniform(new Vector3());
  private readonly extent = uniform(200);
  private readonly material: SpriteNodeMaterial;

  constructor(count: number) {
    const m = new SpriteNodeMaterial();
    const i: any = float(instanceIndex);
    const hx: any = hash(i.mul(1.13)), hy: any = hash(i.mul(2.71).add(7)), hz: any = hash(i.mul(3.37).add(13)), hs: any = hash(i.mul(5.11).add(29));
    const e: any = this.extent, c: any = this.center, t: any = time;
    // Each flake falls through the box in 7 to 12 seconds, drifting with the wind; the box wraps round the eye.
    const fall: any = fract(hy.sub(t.div(hs.mul(5).add(7))));
    const drift: any = t.mul(0.01).add(hs.mul(6.28).add(t.mul(0.7)).sin().mul(0.006));
    const wrap = (h: any, centre: any, shift: any) => fract(h.add(shift).sub(centre.div(e.mul(2)))).sub(0.5).mul(e.mul(2)).add(centre);
    m.positionNode = (vec3 as any)(wrap(hx, c.x, drift), c.y.add(fall.oneMinus().sub(0.5).mul(e)), wrap(hz, c.z, drift.mul(0.6)));
    m.scaleNode = e.mul(0.0025).mul(hs.mul(0.6).add(0.7));
    const d: any = uv().sub(0.5).length();
    m.colorNode = vec4(0.93, 0.95, 1, 1);
    m.opacityNode = smoothstep(0.5, 0.12, d).mul(0.8).mul(smoothstep(0, 0.1, fall)).mul(smoothstep(1, 0.85, fall));
    m.transparent = true;
    m.depthWrite = false;
    m.blending = NormalBlending;
    this.material = m;
    this.sprite = new Sprite(m);
    this.sprite.count = count;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 5;
  }

  /** Follows the eye at `eye`, the box sized for its height over the sea. */
  update(eye: { x: number; y: number; z: number }) {
    const size = Math.min(1500, Math.max(80, eye.y * 1.2));
    this.extent.value = size;
    this.center.value.set(eye.x, Math.max(size * 0.5, eye.y - size * 0.3), eye.z);
  }

  /** Frees the material; the sprite's quad is three's own, shared by every sprite. */
  dispose() {
    this.material.dispose();
    this.sprite.removeFromParent();
  }
}
