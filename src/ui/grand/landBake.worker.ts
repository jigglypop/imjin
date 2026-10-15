import { bakeLand, type BakeFrame } from './landBake';

// Bakes a band of the land's light off the page (landBake.ts); the page splits the DEM among a few of these.
self.onmessage = (e: MessageEvent<{ metres: Float32Array; frame: BakeFrame; rows: [number, number] }>) => {
  try {
    const out = bakeLand(e.data.metres, e.data.frame, e.data.rows);
    (self as unknown as Worker).postMessage({ out }, [out.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
