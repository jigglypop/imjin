import type { Texture } from 'three/webgpu';
import { clamp, float, max, smoothstep, texture, vec2 } from 'three/tsl';
import { atmosphere } from '../render/atmosphere';
import { WEATHER_SPAN } from '../render/cloudNoise';

// Typed loosely: the TSL node types do not accept nodes built in Fn bodies as operands everywhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

/**
 * Smooth fields over the sea, read from the weather map at scales and angles unrelated to each other and to the wave
 * tiles, so nothing they shape repeats within a battle: gusts that roughen the short waves and set off whitecaps as they
 * run downwind, wave groups that swell and ebb, and the shadows of the clouds overhead. `level` is the mip level to read
 * at (0 in the vertex stage), or nothing to let the sampler choose.
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

  /**
   * Share of the direct sunlight that reaches this point of the sea past the cloud layer: where the sun's ray crosses
   * the layer, the cover the clouds are drawn with there. The cloud bodies are not followed, so the edges stay soft.
   */
  sunThrough(xz: Node): Node {
    const L = atmosphere.sunDir;
    const q = xz.add(vec2(L.x, L.z).mul(atmosphere.cloudHeight.div(max(L.y, 0.08))));
    const w = texture(this.weather, q.sub(atmosphere.cloudDrift).div(WEATHER_SPAN)).r;
    // As coverAt in cloudNoise.ts.
    const deck = smoothstep(0.6, 0.9, atmosphere.cloudCover);
    const cover = clamp(atmosphere.cloudCover.add(w.sub(0.5).mul(float(1.1).sub(deck.mul(0.6)))), 0, 1);
    return float(1).sub(smoothstep(0.42, 0.8, cover).mul(0.82).mul(smoothstep(0, 0.05, atmosphere.cloudCover)));
  }
}
