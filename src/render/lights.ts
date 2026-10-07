import { Vector4 } from 'three/webgpu';
import { uniformArray } from 'three/tsl';

export const LIGHT_COUNT = 8;

const pos = Array.from({ length: LIGHT_COUNT }, () => new Vector4());
const col = Array.from({ length: LIGHT_COUNT }, () => new Vector4());

export const pointLights = {
  pos,
  col,
  posNode: uniformArray(pos, 'vec4'),
  colNode: uniformArray(col, 'vec4'),
};
