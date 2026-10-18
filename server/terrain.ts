// Heightmaps for the server's battles. Generating one takes a couple of seconds, so it runs in a worker thread
// (this same bundle started again) and the main loop keeps ticking the battles already running.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker, parentPort, workerData } from 'node:worker_threads';
import { generateHeightmap, type TerrainSpec } from '../src/terrain/generate';
import { decodeRegionDem, regionHeightmap } from '../src/terrain/regionDem';
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

/**
 * The elevation window of a terrain cut from real ground (the later chapters' battles, src/terrain/battleWindows.json): read
 * from public/terrain beside a checkout (or IMJIN_TERRAIN_DIR), else from the site that serves the same files to browsers.
 */
async function demBytes(id: string): Promise<Uint8Array> {
  const dir = process.env.IMJIN_TERRAIN_DIR ?? join(process.cwd(), 'public', 'terrain');
  try {
    return new Uint8Array(await readFile(join(dir, `${id}.dem`)));
  } catch {
    const res = await fetch(`${process.env.IMJIN_SITE_ORIGIN ?? 'https://imjin1592.com'}/terrain/${id}.dem`);
    if (!res.ok) throw new Error(`region ground ${id}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

async function generate(spec: TerrainSpec) {
  const dem = spec.region ? await demBytes(spec.region.id) : null;
  return new Promise<Float32Array>((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { terrain: spec, dem } });
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
export async function terrainWorker() {
  const { terrain, dem } = workerData as { terrain: TerrainSpec; dem: Uint8Array | null };
  const heights = dem ? regionHeightmap(terrain, await decodeRegionDem(dem)) : generateHeightmap(terrain);
  parentPort!.postMessage(heights, [heights.buffer as ArrayBuffer]);
}
