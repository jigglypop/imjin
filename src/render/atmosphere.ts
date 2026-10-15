import { Vector2, Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';

export const atmosphere = {
  sunDir: uniform(new Vector3(0.4, 0.45, 0.3).normalize()),
  sunIrradiance: uniform(new Vector3(3, 2.8, 2.5)),
  skyAmbient: uniform(new Vector3(0.35, 0.45, 0.6)),
  horizon: uniform(new Vector3(0.6, 0.65, 0.7)),
  fogDensity: uniform(0.00009),
  fogHeightFalloff: uniform(0.0025),
  envIntensity: uniform(1),
  /** Coastal water of the south coast: plankton and silt make it a dark blue-green, not the blue of the open ocean. */
  waterDeep: uniform(new Vector3(0.0045, 0.024, 0.033)),
  waterScatter: uniform(new Vector3(0.017, 0.09, 0.074)),
  night: uniform(0),
  /** Cover of the cloud layer (0 when no clouds are drawn), its middle height, and how far the wind has carried it. */
  cloudCover: uniform(0),
  cloudHeight: uniform(2400),
  cloudDrift: uniform(new Vector2()),
};

export type SkyInfo = {
  sunDir: Vector3;
  sunIrradiance: Vector3;
  skyAmbient: Vector3;
  horizon: Vector3;
  ambientLum: number;
};
