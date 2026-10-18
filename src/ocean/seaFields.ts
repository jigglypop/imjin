import type { Texture } from 'three/webgpu';
import { smoothstep, texture, vec2 } from 'three/tsl';

// Typed loosely: the TSL node types do not accept nodes built in Fn bodies as operands everywhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

/**
 * Smooth fields over the sea, read from the weather map at scales and angles unrelated to each other and to the wave
 * tiles, so nothing they shape repeats within a battle: gusts that roughen the short waves and set off whitecaps as they
 * run downwind, wave groups that swell and ebb, and patches of greener or darker water. `level` is the mip level to
 * read at (0 in the vertex stage), or nothing to let the sampler choose.
 */
export class SeaFields {
  private readonly wind: [number, number];

  constructor(private readonly weather: Texture, private readonly time: Node, windAngle: number) {
    this.wind = [Math.cos(windAngle), Math.sin(windAngle)];
  }

  private read(xz: Node, angle: number, span: number, level?: Node) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const uv = vec2(xz.x.mul(c).sub(xz.y.mul(s)), xz.x.mul(s).add(xz.y.mul(c))).div(span);
    const node = texture(this.weather, uv);
    return level === undefined ? node : node.level(level);
  }

  /** 0 in a lull, 1 in a gust. The patches travel downwind at about half the wind's speed. */
  gust(xz: Node, level?: Node): Node {
    const p = xz.sub(vec2(this.wind[0], this.wind[1]).mul(this.time.mul(6)));
    const broad = this.read(p, 0.61, 2900, level).g;
    const fine = this.read(p, -1.13, 1150, level).g;
    return smoothstep(0.22, 0.78, broad.mul(0.62).add(fine.mul(0.38)));
  }

  /** 0 between wave groups, 1 in the middle of one; slow, and drifting with the swell. */
  groups(xz: Node, level?: Node): Node {
    const p = xz.sub(vec2(this.wind[0], this.wind[1]).mul(this.time.mul(3.5)));
    const broad = this.read(p, 2.2, 6100, level).g;
    const fine = this.read(p, 0.95, 2300, level).r;
    return smoothstep(0.2, 0.8, broad.mul(0.55).add(fine.mul(0.45)));
  }

  /** 0 to 1 over patches about `span` metres across, at an angle of its own: picks between two copies of a wave tile. */
  patch(xz: Node, angle: number, span: number): Node {
    return smoothstep(0.3, 0.7, this.read(xz, angle, span).r);
  }

  /** 0 to 1 over patches kilometres across, where plankton, silt or depth turn the water a shade greener or darker. */
  tint(xz: Node): Node {
    const broad = this.read(xz, 1.7, 9500).r;
    const fine = this.read(xz, -0.4, 3700).g;
    return smoothstep(0.25, 0.75, broad.mul(0.6).add(fine.mul(0.4)));
  }
}
