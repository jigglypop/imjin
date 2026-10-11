import type { SeaStateName } from '../ocean/waves';
import type { SkyPresetName } from '../render/sky';
import type { CurrentSpec } from './current';

export type CoastalClimate = 'sheltered' | 'exposed' | 'strait' | 'offshore';
export type EnvironmentBase = {
  sky: SkyPresetName;
  sea: SeaStateName;
  night: boolean;
  current?: CurrentSpec;
  climate?: CoastalClimate;
};
export type BattleEnvironment = {
  sky: SkyPresetName;
  sea: SeaStateName;
  night: boolean;
  /** Range multiplier, before the existing nighttime lookout rules. */
  visibility: number;
  /** Uniform wind leeway in metres per second, in the map's own coordinates. */
  wind: { x: number; z: number };
  current?: CurrentSpec;
};

function roll(seed: number, salt: number): number {
  let n = (seed ^ salt) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/**
 * Shared deterministic game conditions, chosen without consuming the battle or campaign RNG. These are gameplay
 * presets on adapted coastal terrain, not reconstructed historical weather or predicted real tides. Ranked battles
 * keep their original written map conditions and no added currents, wind leeway or reduced daytime visibility.
 */
export function environmentFor(base: EnvironmentBase, seed: number, fixed = false): BattleEnvironment {
  if (fixed) return { sky: base.sky, sea: base.sea, night: base.night, visibility: 1, wind: { x: 0, z: 0 } };
  const climate = base.climate ?? 'sheltered';
  const water = roll(seed, 0x51ad39b7), hour = roll(seed, 0x36aee109), haze = roll(seed, 0x7254ac13);
  const calm = climate === 'sheltered' ? 0.55 : climate === 'strait' ? 0.25 : climate === 'exposed' ? 0.15 : 0.05;
  const rough = climate === 'sheltered' ? 0.90 : climate === 'strait' ? 0.80 : climate === 'exposed' ? 0.60 : 0.40;
  const sea: SeaStateName = water < calm ? 'calm' : water < rough ? 'moderate' : 'rough';
  const night = hour < 0.22;
  let sky: SkyPresetName = night ? 'night' : hour < 0.37 ? 'sunset' : hour < 0.68 ? 'day' : 'afternoon';
  let visibility = night ? 0.85 : sky === 'sunset' ? 0.85 : 1;
  if (!night && (haze < 0.20 || sea === 'rough')) {
    sky = 'overcast';
    visibility = haze < 0.20 ? 0.48 : 0.72;
  }
  const angle = roll(seed, 0x149973d5) * Math.PI * 2;
  const drift = sea === 'calm' ? 0.08 : sea === 'moderate' ? 0.15 : 0.25;
  return { sky, sea, night, visibility, wind: { x: Math.cos(angle) * drift, z: Math.sin(angle) * drift }, current: base.current };
}

/** Rotate map-relative leeway exactly as the terrain and current field are rotated for the light. */
export function environmentWind(environment: BattleEnvironment, axis = 0): { angle: number; drift: number } {
  return { angle: Math.atan2(environment.wind.z, environment.wind.x) + axis, drift: Math.hypot(environment.wind.x, environment.wind.z) };
}
