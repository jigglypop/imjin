import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat } from 'three/webgpu';
import type { CurrentField } from '../sim/current';

/** Texels along each side of the baked current. */
const SIZE = 192;

/**
 * The current as the sea draws it: the square `field.extent` wide around `field.centerWorld`, holding the world velocity
 * (m/s) for a tide of -1 in RG and for a tide of +1 in BA. The sea picks one by the tide's sign and scales it by its size.
 * Only the client bakes it; the simulation and the server need the field alone.
 */
export function bakeCurrent(field: CurrentField): DataTexture {
  const data = new Uint16Array(SIZE * SIZE * 4);
  for (let j = 0; j < SIZE; j += 1) {
    for (let i = 0; i < SIZE; i += 1) {
      const wx = field.centerWorld.x + ((i + 0.5) / SIZE - 0.5) * field.extent;
      const wz = field.centerWorld.z + ((j + 0.5) / SIZE - 0.5) * field.extent;
      const a = field.velocity(wx, wz, -1);
      const b = field.velocity(wx, wz, 1);
      const o = (j * SIZE + i) * 4;
      data[o] = DataUtils.toHalfFloat(a.x);
      data[o + 1] = DataUtils.toHalfFloat(a.z);
      data[o + 2] = DataUtils.toHalfFloat(b.x);
      data[o + 3] = DataUtils.toHalfFloat(b.z);
    }
  }
  const texture = new DataTexture(data, SIZE, SIZE, RGBAFormat, HalfFloatType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
