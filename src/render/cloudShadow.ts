import { clamp, float, max, smoothstep, texture, texture3D, vec2, vec3 } from 'three/tsl';
import { atmosphere } from './atmosphere';
import { cloudNoise, weatherMap, WEATHER_SPAN } from './cloudNoise';

// Typed loosely: the TSL node types do not accept nodes built in Fn bodies as operands everywhere.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

/**
 * Share of the direct sunlight (moonlight at night) that reaches the world point `xz` past the clouds: where the light's
 * ray crosses the middle of the layer, the cloud body there as the cloud shader shapes it (its cover from the weather
 * map, its lumps from the same noise), at its densest height. The shadows drift with the wind as the clouds do, over the
 * sea and the land alike, and keep soft edges: some light always comes through and around a cloud.
 */
export function sunThroughClouds(xz: Node): Node {
  const L = atmosphere.sunDir;
  const height = atmosphere.cloudHeight;
  const drift = atmosphere.cloudDrift;
  const q = xz.add(vec2(L.x, L.z).mul(height.div(max(L.y, 0.08)))).sub(drift);
  const w = texture(weatherMap(), q.div(WEATHER_SPAN)).level(float(0)).r;
  // As coverAt in cloudNoise.ts and the shape in Clouds.ts.
  const deck = smoothstep(0.6, 0.9, atmosphere.cloudCover);
  const cover = clamp(atmosphere.cloudCover.add(w.sub(0.5).mul(float(1.1).sub(deck.mul(0.6)))), 0, 1);
  const lump = texture3D(cloudNoise(), vec3(q.x, height, q.y).div(8500)).r;
  const body = clamp(lump.sub(float(1).sub(cover)).div(max(cover, 0.08)), 0, 1);
  return float(1).sub(smoothstep(0.02, 0.3, body).mul(0.8).mul(smoothstep(0, 0.05, atmosphere.cloudCover)));
}
