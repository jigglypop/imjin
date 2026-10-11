import { abs, cameraPosition, exp, float, length, max, min, positionWorld, select, sin, smoothstep } from 'three/tsl';
import { atmosphere } from './atmosphere';

/** A shallow sea layer shares the scene's weather haze; it never changes what a lookout can see. */
export function seaFogAmount(distance: ReturnType<typeof length>) {
  const eye = max(cameraPosition.y, 0);
  const surface = max(positionWorld.y, 0);
  const difference = abs(eye.sub(surface)).mul(0.045);
  // Integrating along the ray keeps an elevated camera clear, rather than laying a white plane over the fleet.
  const column = select(difference.lessThan(0.002), float(1), float(1).sub(exp(difference.negate())).div(max(difference, 0.002)));
  const lowLayer = exp(min(eye, surface).mul(-0.045)).mul(column);
  const bands = sin(positionWorld.x.mul(0.002).add(sin(positionWorld.z.mul(0.0017)).mul(1.3))).mul(0.22).add(0.78);
  const density = float(0.0002).add(atmosphere.night.mul(0.00008));
  const mist = distance.mul(density).mul(lowLayer).mul(bands).mul(smoothstep(120, 900, distance)).min(0.22);
  return float(1).sub(exp(distance.mul(atmosphere.fogDensity).add(mist).negate()));
}
