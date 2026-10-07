import { Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';

export const atmosphere = {
  sunDir: uniform(new Vector3(0.4, 0.45, 0.3).normalize()),
  sunIrradiance: uniform(new Vector3(3, 2.8, 2.5)),
  skyAmbient: uniform(new Vector3(0.35, 0.45, 0.6)),
  horizon: uniform(new Vector3(0.6, 0.65, 0.7)),
  fogDensity: uniform(0.00009),
  fogHeightFalloff: uniform(0.0025),
  envIntensity: uniform(1),
  waterDeep: uniform(new Vector3(0.006, 0.03, 0.05)),
  waterScatter: uniform(new Vector3(0.02, 0.11, 0.1)),
  night: uniform(0),
};

export type SkyInfo = {
  sunDir: Vector3;
  sunIrradiance: Vector3;
  skyAmbient: Vector3;
  horizon: Vector3;
  ambientLum: number;
};
