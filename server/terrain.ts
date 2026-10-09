// Heightmaps for the server's battles. Generating one takes a couple of seconds, so it runs in a worker thread
// (this same bundle started again) and the main loop keeps ticking the battles already running.
import { Worker, parentPort, workerData } from 'node:worker_threads';
import { generateHeightmap, type TerrainSpec } from '../src/terrain/generate';
import type { LandSampler } from '../src/sim/types';

const ready = new Map<TerrainSpec, LandSampler>();
const pending = new Map<TerrainSpec, Promise<LandSampler>>();
let chain: Promise<unknown> = Promise.resolve();

/** Bilinear height lookup, the same one the client terrain uses (Terrain.heightAtScenario). */
function sampler(spec: TerrainSpec, h: Float32Array): LandSampler {
  const { size, res } = spec;
  return (sx, sz) => {
    const fx = ((sx + size / 2) / size) * res - 0.5;
    const fz = ((sz + size / 2) / size) * res - 0.5;
    const x0 = Math.max(0, Math.min(res - 2, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(res - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const tz = Math.max(0, Math.min(1, fz - z0));
    const a = h[z0 * res + x0]!;
    const b = h[z0 * res + x0 + 1]!;
    const c = h[(z0 + 1) * res + x0]!;
    const d = h[(z0 + 1) * res + x0 + 1]!;
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };
}

function generate(spec: TerrainSpec) {
  return new Promise<Float32Array>((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { terrain: spec } });
    worker.once('message', (h: Float32Array) => resolve(h));
    worker.once('error', reject);
    worker.once('exit', (code) => code && reject(new Error(`terrain worker exited with ${code}`)));
  });
}

/** The land sampler of a terrain, generated once and kept. Generations queue one behind the other. */
export function loadLand(spec: TerrainSpec): Promise<LandSampler> {
  const done = ready.get(spec);
  if (done) return Promise.resolve(done);
  let p = pending.get(spec);
  if (!p) {
    p = chain
      .then(() => generate(spec))
      .then((h) => {
        const land = sampler(spec, h);
        ready.set(spec, land);
        pending.delete(spec);
        return land;
      })
      .catch((e) => {
        pending.delete(spec);
        throw e;
      });
    chain = p.catch(() => undefined);
    pending.set(spec, p);
  }
  return p;
}

/** Entry of the worker thread: generate the terrain it was started with and hand the heights back. */
export function terrainWorker() {
  const heights = generateHeightmap((workerData as { terrain: TerrainSpec }).terrain);
  parentPort!.postMessage(heights, [heights.buffer]);
}
