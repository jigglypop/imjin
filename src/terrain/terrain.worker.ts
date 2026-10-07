import { generateHeightmap, type TerrainSpec } from './generate';

self.onmessage = (e: MessageEvent<TerrainSpec>) => {
  const heights = generateHeightmap(e.data);
  (self as unknown as Worker).postMessage(heights, [heights.buffer]);
};
