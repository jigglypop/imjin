import { clamp, dot, float, fract, mix, sin, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

/**
 * The film look of a cutscene, laid over the battle's own grade by `amount`: a little less saturation, cool shadows and
 * warm highlights (moonlight against fire, as the films grade their night battles), a gentle S-curve, crushed blacks
 * and a fine moving grain. The depth of field is a separate pass the engine switches on for the length of a cutscene.
 */
export const film = {
  amount: uniform(0),
  time: uniform(0),
  /** Depth of field: distance in focus (m), how deep the sharp zone is (m), and the size of the blur (0 = none). */
  focus: uniform(100),
  depth: uniform(60),
  bokeh: uniform(0),
};

type Vec3Node = Node<'vec3'>;

export function filmGrade(color: Vec3Node): Vec3Node {
  const luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  const desat = mix(vec3(luma, luma, luma), color, 0.8);
  const split = mix(vec3(0.86, 0.97, 1.08), vec3(1.04, 1.0, 0.94), smoothstep(0.1, 0.7, luma));
  const toned = desat.mul(split);
  const curved = clamp(toned.sub(0.42).mul(1.14).add(0.42), 0, 1);
  const crushed = clamp(curved.sub(0.012).div(0.988), 0, 1);
  const p = uv().mul(vec2(1531.7, 997.3));
  const noise = fract(sin(dot(p, vec2(12.9898, 78.233)).add(film.time.mul(37.1))).mul(43758.5453)).sub(0.5);
  const grained = crushed.add(noise.mul(float(0.028)).mul(float(1).sub(luma.mul(0.6))));
  return mix(color, grained, film.amount) as Vec3Node;
}
