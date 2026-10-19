import { generateHeightmap, type TerrainSpec } from './generate';
import { computeFeatures } from './features';
import { loadRegionDem, regionHeightmap } from './regionDem';

self.onmessage = async (e: MessageEvent<TerrainSpec>) => {
  try {
    const spec = e.data;
    // A campaign region is cut from its real elevation window; every other map is generated.
    const heights = spec.region ? regionHeightmap(spec, spec.region.dem ?? (await loadRegionDem(spec.region.id))) : generateHeightmap(spec);
    const { mask, structures } = computeFeatures(spec, heights);
    (self as unknown as Worker).postMessage({ heights, mask, structures }, [heights.buffer, mask.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
