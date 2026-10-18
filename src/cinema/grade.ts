import { clamp, dot, exp, float, fract, length, max, mix, select, sin, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl';
import { Vector3 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import type { CastLight } from './types';

/**
 * The film look of a battle opening (owner 2026-10-18: presentation only, off in play), laid over the battle's own
 * grade by `amount`: teal shadows and warm highlights, a gentle S-curve, a soft shoulder on the highlights, a light
 * vignette and a fine moving grain. Each opening picks a look for its light (`LOOKS`: day, overcast, dusk/dawn, night).
 * The depth of field is a separate pass the engine switches on for the length of a cutscene.
 */
export const film = {
  amount: uniform(0),
  time: uniform(0),
  /** Tints multiplied into the shadows and the highlights. */
  shadows: uniform(new Vector3(0.9, 1.0, 1.06)),
  highlights: uniform(new Vector3(1.06, 1.0, 0.9)),
  /** Saturation (1 = the battle's own), S-curve strength (0..1), vignette depth (0..1). */
  saturation: uniform(0.85),
  contrast: uniform(0.35),
  vignette: uniform(0.28),
  /** Depth of field: distance in focus (m), how deep the sharp zone is (m), and the size of the blur (0 = none). */
  focus: uniform(100),
  depth: uniform(60),
  bokeh: uniform(0),
};

type Look = { shadows: [number, number, number]; highlights: [number, number, number]; saturation: number; contrast: number; vignette: number };

/** The grade per light: day is the gentlest; overcast cooler and flatter in colour; dawn/dusk warmer; night moonlit. */
export const LOOKS: Record<CastLight, Look> = {
  day: { shadows: [0.88, 0.99, 1.05], highlights: [1.06, 1.0, 0.9], saturation: 0.9, contrast: 0.32, vignette: 0.26 },
  overcast: { shadows: [0.86, 0.98, 1.05], highlights: [1.05, 1.0, 0.92], saturation: 0.82, contrast: 0.38, vignette: 0.3 },
  dusk: { shadows: [0.84, 0.95, 1.06], highlights: [1.1, 0.99, 0.84], saturation: 0.92, contrast: 0.36, vignette: 0.32 },
  night: { shadows: [0.82, 0.96, 1.12], highlights: [1.1, 0.98, 0.84], saturation: 0.85, contrast: 0.3, vignette: 0.34 },
};

export function setLook(light: CastLight) {
  const l = LOOKS[light];
  film.shadows.value.set(...l.shadows);
  film.highlights.value.set(...l.highlights);
  film.saturation.value = l.saturation;
  film.contrast.value = l.contrast;
  film.vignette.value = l.vignette;
}

type Vec3Node = Node<'vec3'>;

/** `grain`: false on phones (the rest is a handful of ALU ops on the final colour). */
export function filmGrade(color: Vec3Node, grain = true): Vec3Node {
  const w = vec3(0.2126, 0.7152, 0.0722);
  const luma = dot(color, w);
  const sat = mix(vec3(luma, luma, luma), color, film.saturation);
  const split = sat.mul(mix(film.shadows, film.highlights, smoothstep(0.08, 0.62, luma)));
  // Close on a fire the highlights run far past white and the bloom spreads them: roll them off above 0.7 so the
  // flame stays bright and orange instead of a blank sheet.
  const tl = max(dot(split, w), 0.001);
  const shoulder = float(0.7).add(float(0.3).mul(float(1).sub(exp(max(tl.sub(0.7), 0).negate().div(0.3)))));
  const toned = clamp(split.mul(select(tl.greaterThan(0.7), shoulder.div(tl), float(1))), 0, 1);
  // A gentle S: smoothstep's curve blended in, pivoting at mid grey, the blacks kept just off zero.
  const s = toned.mul(toned).mul(toned.mul(-2).add(3));
  const curved = mix(toned, s, film.contrast).mul(0.985).add(0.008);
  const d = length(uv().sub(0.5).mul(vec2(1.2, 1)));
  let out = curved.mul(float(1).sub(film.vignette.mul(smoothstep(0.3, 0.85, d))));
  if (grain) {
    const p = uv().mul(vec2(1531.7, 997.3));
    const noise = fract(sin(dot(p, vec2(12.9898, 78.233)).add(film.time.mul(37.1))).mul(43758.5453)).sub(0.5);
    out = out.add(noise.mul(0.022).mul(float(1).sub(luma.mul(0.6))));
  }
  return mix(color, out, film.amount) as Vec3Node;
}
