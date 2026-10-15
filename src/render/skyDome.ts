import type { Texture } from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  asin,
  atan,
  clamp,
  cross,
  dot,
  float,
  floor,
  hash,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  normalWorldGeometry,
  normalize,
  pow,
  sign,
  sin,
  smoothstep,
  sqrt,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { atmosphere } from './atmosphere';

// Typed loosely: the TSL node types do not accept nodes built in Fn bodies as operands everywhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

/** Angular radius of the sun's disc and of the moon's, in radians. */
const SUN_RADIUS = 0.0047;
const MOON_RADIUS = 0.0046;

/** Where a unit direction falls in a sky view (see buildSkyView): azimuth across, sqrt-spaced elevation up. */
function skyViewUV(dir: Node) {
  const u = atan(dir.z, dir.x).mul(1 / (2 * Math.PI)).add(0.5);
  const el = asin(clamp(dir.y, -1, 1));
  const s = sqrt(min(abs(el).mul(2 / Math.PI), 1));
  return vec2(u, sign(el).mul(s).mul(0.5).add(0.5));
}

/**
 * The texture nodes that read a sky view. The first sky is swapped into every one of them in place of the stand-in the
 * clouds were built with; later skies are written into that same texture and nothing changes here.
 */
export class SkyView {
  private readonly nodes: Node[] = [];
  /** Seconds, for the stars' twinkle. */
  readonly time = uniform(0);

  constructor(private view: Texture) {}

  /** Radiance of the sky toward `dir`, in the sky's own units (multiply by atmosphere.envIntensity for the scene's). */
  at(dir: Node): Node {
    const node = texture(this.view, skyViewUV(dir));
    this.nodes.push(node);
    return node.rgb;
  }

  /**
   * The haze at the horizon below `dir`: what a far object fades into and what lies past the edge of the sea. A little
   * above the true horizon, where the sky view is integrated rather than repeated.
   */
  horizon(dir: Node): Node {
    const flat = normalize(vec3(dir.x, 0, dir.z).add(vec3(1e-5, 0, 0)));
    return this.at(vec3(flat.x, 0.006, flat.z));
  }

  set(view: Texture) {
    if (view === this.view) return;
    this.view = view;
    for (const node of this.nodes) node.value = view;
  }

  /** The scene's background: the sky, the sun's disc and glare, and at night the moon and the stars. */
  background(): Node {
    return Fn(() => {
      const dir = normalize(normalWorldGeometry).toVar();
      const color = vec3(this.at(dir)).toVar();
      const L = atmosphere.sunDir;
      const cosA = dot(dir, L);
      // The angle to the light from the sine, which keeps its precision at the scale of the disc.
      const angle = asin(min(length(cross(dir, L)), 1));
      const toward = smoothstep(0, 0.01, cosA);
      // The light as it reaches the sea, in the sky's units: what the disc and the glare are drawn with.
      const light = atmosphere.sunIrradiance.div(max(atmosphere.envIntensity, 1e-6)).toVar();
      const day = float(1).sub(atmosphere.night);
      If(day.greaterThan(0.001), () => {
        const r = angle.div(SUN_RADIUS);
        const limb = sqrt(max(float(1).sub(r.mul(r)), 0));
        const disc = smoothstep(1.05, 0.95, r).mul(limb.mul(0.55).add(0.45));
        // Glare of the forward-scattering haze, tighter than the sky view can hold.
        const c = max(cosA, 0);
        const glare = pow(c, 9000).mul(1.2).add(pow(c, 600).mul(0.08)).add(pow(c, 60).mul(0.012));
        color.addAssign(light.mul(disc.mul(55).add(glare)).mul(toward).mul(day));
      });
      If(atmosphere.night.greaterThan(0.001), () => {
        const night = atmosphere.night;
        // Moon: a lit sphere past full, its seas darker than its highlands, ringed by the haze's halo.
        If(angle.lessThan(MOON_RADIUS * 1.5), () => {
          const side = normalize(cross(L, vec3(0, 1, 0)));
          const upv = cross(side, L);
          const off = dir.sub(L.mul(cosA)).div(MOON_RADIUS);
          const x = dot(off, side);
          const y = dot(off, upv);
          const rr = x.mul(x).add(y.mul(y));
          const z = sqrt(max(float(1).sub(rr), 0));
          const lit = smoothstep(-0.08, 0.18, x.mul(-0.55).add(y.mul(-0.25)).add(z.mul(0.8)));
          const seas = mx_noise_float(vec3(x.mul(2.3).add(1.7), y.mul(2.3).sub(0.4), 0.5)).mul(0.5).add(0.5);
          const albedo = mix(float(1), float(0.62), smoothstep(0.45, 0.7, seas));
          const edge = smoothstep(1.03, 0.97, sqrt(rr));
          color.addAssign(light.mul(edge.mul(lit).mul(albedo).mul(z.mul(0.25).add(0.75)).mul(26)).mul(toward).mul(night));
        });
        color.addAssign(light.mul(pow(max(cosA, 0), 4000).mul(0.6).add(pow(max(cosA, 0), 300).mul(0.05))).mul(night));
        // Stars: one at most per cell of a grid around the eye, faint ones many and bright ones few, dimmed by the
        // thicker air toward the horizon and drowned near the moon.
        const p = dir.mul(260);
        const cell = floor(p);
        const seed = cell.x.add(4096).toUint().mul(73856093).bitXor(cell.y.add(4096).toUint().mul(19349663)).bitXor(cell.z.add(4096).toUint().mul(83492791));
        const h1 = hash(seed);
        const h2 = hash(seed.add(1));
        const h3 = hash(seed.add(2));
        const h4 = hash(seed.add(3));
        const star = normalize(cell.add(vec3(h1, h2, h3).mul(0.6).add(0.2)));
        const d = length(cross(dir, star)).mul(1700);
        const present = smoothstep(0.984, 0.986, h4);
        const magnitude = pow(h1.mul(h2), 3).mul(10).add(0.25);
        const twinkle = sin(this.time.mul(h3.mul(4).add(2)).add(h4.mul(40))).mul(0.25).add(0.85);
        const air = smoothstep(0.0, 0.35, dir.y);
        const moonGlow = smoothstep(0.995, 0.93, cosA);
        const scale = float(1).div(max(atmosphere.envIntensity, 1e-6));
        color.addAssign(vec3(0.8, 0.88, 1).mul(present.mul(magnitude).mul(twinkle).mul(air).mul(moonGlow).mul(max(float(1).sub(d.mul(d)), 0)).mul(scale).mul(0.6).mul(night)));
      });
      return color;
    })();
  }
}
