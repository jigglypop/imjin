import { mix, mx_noise_float, positionGeometry, smoothstep, vec3 } from 'three/tsl';

/**
 * Charring on a hull, in ship space so the pattern stays on the timber as the ship moves: burnt patches spread from
 * noise as the char (0..1) grows. It is plain blackened wood; the fire itself is drawn by the flames and its light.
 */
export function charShading(char: any, color: any): any {
  const noise = mx_noise_float(positionGeometry.mul(0.35)).mul(0.5).add(0.5);
  const amount = smoothstep(0.35, 0.75, noise.add(char.mul(0.9)).sub(0.45)).mul(char);
  return mix(color, vec3(0.025, 0.02, 0.018), amount.mul(0.9));
}
