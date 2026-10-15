import { bakeLand, type BakeFrame } from './landBake';

// Bakes the land's light off the page: about a second and a half of arithmetic over the DEM (landBake.ts).
self.onmessage = (e: MessageEvent<{ metres: Float32Array; frame: BakeFrame }>) => {
  try {
    const out = bakeLand(e.data.metres, e.data.frame);
    (self as unknown as Worker).postMessage({ out }, [out.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
