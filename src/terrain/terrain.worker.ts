import { generateHeightmap, type TerrainSpec } from './generate';
import { computeFeatures } from './features';

self.onmessage = (e: MessageEvent<TerrainSpec>) => {
  const heights = generateHeightmap(e.data);
  const { mask, structures } = computeFeatures(e.data, heights);
  (self as unknown as Worker).postMessage({ heights, mask, structures }, [heights.buffer, mask.buffer]);
};
