import { abs, float, floor, fract, mix, mx_noise_float, positionGeometry, smoothstep, time, vec3 } from 'three/tsl';

/** Steps the fire level is kept in, in the whole part of the hull's burn attribute. */
const FIRE_STEPS = 63;

/**
 * The hull's burn attribute carries two things: how charred it is (0..1, the fraction) and how hard it burns now (the
 * whole part, in FIRE_STEPS steps). The char stays when the fire is out; the glow goes with the fire.
 */
export function packBurn(fire: number, char: number) {
  return Math.round(Math.min(1, Math.max(0, fire)) * FIRE_STEPS) + Math.min(0.999, Math.max(0, char));
}

/**
 * Charring and its ember glow on a hull, in ship space so the pattern stays on the timber as the ship moves. Burnt
 * patches spread from noise as the char grows; while the ship burns, cracks in them and the hottest patches glow
 * orange-red and pulse slowly, brighter the harder it burns, and the glow dies where the hull is under water. `detail`
 * off (phones) leaves out the cracks' own noise.
 */
export function charShading(packed: any, color: any, shipY: any, detail: boolean): { color: any; emissive: any } {
  const fire = floor(packed).div(FIRE_STEPS);
  const burn = fract(packed);
  const P: any = positionGeometry;
  const noise = mx_noise_float(P.mul(0.35)).mul(0.5).add(0.5);
  const charAmount = smoothstep(0.35, 0.75, noise.add(burn.mul(0.9)).sub(0.45)).mul(burn);
  const charred = mix(color, vec3(0.025, 0.02, 0.018), charAmount.mul(0.9));
  // Cracks: the ridges of a stretched noise, thin bright lines across the grain of the burnt planking.
  const ridge = detail ? float(1).sub(abs(mx_noise_float(P.mul(vec3(1.9, 0.7, 1.9))))) : noise;
  const crack = detail ? smoothstep(0.93, 0.985, ridge) : smoothstep(0.7, 0.9, noise).mul(0.5);
  const pulse = mx_noise_float(P.mul(0.45).add(vec3(time.mul(0.35), time.mul(-0.8), 0))).mul(0.5).add(0.5);
  const hot = crack.add(smoothstep(0.6, 0.9, pulse).mul(0.3));
  const live = fire.mul(fire.mul(0.6).add(0.4));
  const dry = smoothstep(-0.15, 0.35, shipY);
  // A fire glows through the timber it is eating before the char shows: the hot patches lead the black ones.
  const area = charAmount.max(fire.mul(0.25).mul(smoothstep(0.6, 0.85, noise)));
  const ember = vec3(1.0, 0.24, 0.035).mul(area.mul(hot).mul(live).mul(pulse.mul(1.4).add(0.4)).mul(dry).mul(4));
  return { color: charred, emissive: ember };
}
