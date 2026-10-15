import { Vector2, Vector3 } from 'three/webgpu';
import { renderGroup, uniform } from 'three/tsl';

/**
 * The air, light and water every material reads. They are shared per render call, like three's own light colours: the
 * fog alone puts several of them into every material, and in the per-object group each draw would update its own copy.
 */
export const atmosphere = {
  sunDir: uniform(new Vector3(0.4, 0.45, 0.3).normalize()).setGroup(renderGroup),
  sunIrradiance: uniform(new Vector3(3, 2.8, 2.5)).setGroup(renderGroup),
  skyAmbient: uniform(new Vector3(0.35, 0.45, 0.6)).setGroup(renderGroup),
  horizon: uniform(new Vector3(0.6, 0.65, 0.7)).setGroup(renderGroup),
  fogDensity: uniform(0.00009).setGroup(renderGroup),
  fogHeightFalloff: uniform(0.0025).setGroup(renderGroup),
  envIntensity: uniform(1).setGroup(renderGroup),
  /** Coastal water of the south coast: plankton and silt make it a dark blue-green, not the blue of the open ocean. */
  waterDeep: uniform(new Vector3(0.0045, 0.024, 0.033)).setGroup(renderGroup),
  waterScatter: uniform(new Vector3(0.017, 0.09, 0.074)).setGroup(renderGroup),
  night: uniform(0).setGroup(renderGroup),
  /** Cover of the cloud layer (0 when no clouds are drawn), its middle height, and how far the wind has carried it. */
  cloudCover: uniform(0).setGroup(renderGroup),
  cloudHeight: uniform(2400).setGroup(renderGroup),
  cloudDrift: uniform(new Vector2()).setGroup(renderGroup),
};

export type SkyInfo = {
  sunDir: Vector3;
  sunIrradiance: Vector3;
  skyAmbient: Vector3;
  horizon: Vector3;
  ambientLum: number;
};
