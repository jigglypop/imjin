import { createNoise2D } from './noise';
import type { TerrainSpec } from './generate';

/**
 * Real ground for the campaign regions. A region's elevation window is a square of Terrarium samples (scripts/fetch-region-dem.mjs)
 * on a metric grid, east to the right and south down, so that terrain x is east and terrain z is south. It is stored as 16-bit
 * half-metres predicted from their neighbours and deflated; the sea is exactly 0 because the source has no depth.
 * `regionHeightmap` turns a window into the 2048 squared heightmap the rest of the terrain code expects, and gives the
 * sea a floor that falls away from the shore, since there is nothing to read it from.
 */

export type RegionDem = {
  /** Samples per side. */
  n: number;
  /** Metres between samples. */
  cell: number;
  /** Metres above the sea, 0 for water. */
  heights: Float32Array;
};

const MAGIC = 0x314d4449; // "IDM1"
const HEADER = 12;
/** Half-metre steps: the source's own precision is about a metre. */
const UNIT = 2;

async function deflate(bytes: Uint8Array, format: 'compress' | 'decompress') {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(format === 'compress' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The median edge detector of LOCO-I: exact on flat ground and on a plane, a good guess at a coast. */
function predict(q: Int16Array, n: number, i: number, j: number) {
  const a = i > 0 ? q[j * n + i - 1]! : j > 0 ? q[(j - 1) * n + i]! : 0;
  const b = j > 0 ? q[(j - 1) * n + i]! : a;
  const c = i > 0 && j > 0 ? q[(j - 1) * n + i - 1]! : b;
  if (c >= Math.max(a, b)) return Math.min(a, b);
  if (c <= Math.min(a, b)) return Math.max(a, b);
  return a + b - c;
}

export async function encodeRegionDem(dem: RegionDem) {
  const { n, cell, heights } = dem;
  const q = new Int16Array(n * n);
  for (let k = 0; k < q.length; k += 1) q[k] = Math.max(0, Math.min(32767, Math.round(heights[k]! * UNIT)));
  const out = new Uint8Array(HEADER + n * n * 2);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, n, true);
  view.setFloat32(6, cell, true);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const r = q[j * n + i]! - predict(q, n, i, j);
      const z = r >= 0 ? r * 2 : -r * 2 - 1;
      out[HEADER + j * n + i] = z & 255;
      out[HEADER + n * n + j * n + i] = z >> 8;
    }
  }
  return deflate(out, 'compress');
}

export async function decodeRegionDem(bytes: Uint8Array): Promise<RegionDem> {
  const raw = await deflate(bytes, 'decompress');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw.byteLength < HEADER || view.getUint32(0, true) !== MAGIC) throw new Error('not a region elevation file');
  const n = view.getUint16(4, true);
  const cell = view.getFloat32(6, true);
  if (raw.byteLength !== HEADER + n * n * 2) throw new Error('region elevation file is cut short');
  const q = new Int16Array(n * n);
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const z = raw[HEADER + j * n + i]! | (raw[HEADER + n * n + j * n + i]! << 8);
      const r = z & 1 ? -((z + 1) >> 1) : z >> 1;
      const v = predict(q, n, i, j) + r;
      q[j * n + i] = v;
      heights[j * n + i] = v / UNIT;
    }
  }
  return { n, cell, heights };
}

let source: (id: string) => Promise<Uint8Array> = async (id) => {
  const res = await fetch(`/terrain/${id}.dem`);
  if (!res.ok) throw new Error(`region ground ${id}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

/** Node tools and tests read the same files from disk instead of the web server. */
export function setRegionDemSource(read: (id: string) => Promise<Uint8Array>) {
  source = read;
}

export async function loadRegionDem(id: string) {
  return decodeRegionDem(await source(id));
}

/** Metres from every sea sample to the nearest land sample (a two-pass chamfer; the window's edge is not land). */
function distanceToLand(dem: RegionDem) {
  const { n, cell, heights } = dem;
  const d = new Float32Array(n * n);
  for (let k = 0; k < d.length; k += 1) d[k] = heights[k]! > 0 ? 0 : 1e9;
  const diag = cell * Math.SQRT2;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let v = d[j * n + i]!;
      if (i > 0) v = Math.min(v, d[j * n + i - 1]! + cell);
      if (j > 0) {
        v = Math.min(v, d[(j - 1) * n + i]! + cell);
        if (i > 0) v = Math.min(v, d[(j - 1) * n + i - 1]! + diag);
        if (i < n - 1) v = Math.min(v, d[(j - 1) * n + i + 1]! + diag);
      }
      d[j * n + i] = v;
    }
  }
  for (let j = n - 1; j >= 0; j -= 1) {
    for (let i = n - 1; i >= 0; i -= 1) {
      let v = d[j * n + i]!;
      if (i < n - 1) v = Math.min(v, d[j * n + i + 1]! + cell);
      if (j < n - 1) {
        v = Math.min(v, d[(j + 1) * n + i]! + cell);
        if (i < n - 1) v = Math.min(v, d[(j + 1) * n + i + 1]! + diag);
        if (i > 0) v = Math.min(v, d[(j + 1) * n + i - 1]! + diag);
      }
      d[j * n + i] = v;
    }
  }
  return d;
}

/** Depth (m, positive) of open water `d` metres from the nearest shore: a shelf that reaches 50 m a kilometre out. */
const shelf = (d: number) => 0.3 + 54 * (1 - Math.exp(-d / 250));

/** Where the window's rim is pulled under the sea, so the land does not end in a bare wall. */
const RIM = 700;

export function regionHeightmap(spec: TerrainSpec, dem: RegionDem): Float32Array {
  const { size, res } = spec;
  const { n } = dem;
  const noise = createNoise2D(spec.seed);
  const noiseB = createNoise2D(spec.seed + 101);
  const near = distanceToLand(dem);
  // Land keeps its measured height; the sea gets a floor, so the one field can be upsampled without a seam at the shore.
  const base = new Float32Array(n * n);
  for (let k = 0; k < base.length; k += 1) {
    const h = dem.heights[k]!;
    base[k] = h > 0 ? Math.max(0.5, h) : -shelf(near[k]!);
  }
  const heights = new Float32Array(res * res);
  const half = size / 2;
  for (let j = 0; j < res; j += 1) {
    const z = -half + ((j + 0.5) / res) * size;
    const fz = Math.max(0, Math.min(n - 1.001, ((j + 0.5) / res) * n - 0.5));
    const z0 = Math.floor(fz);
    const tz = fz - z0;
    for (let i = 0; i < res; i += 1) {
      const x = -half + ((i + 0.5) / res) * size;
      const fx = Math.max(0, Math.min(n - 1.001, ((i + 0.5) / res) * n - 0.5));
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const a = base[z0 * n + x0]!;
      const b = base[z0 * n + x0 + 1]!;
      const c = base[(z0 + 1) * n + x0]!;
      const d = base[(z0 + 1) * n + x0 + 1]!;
      let h = (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
      if (h > 0) {
        // The samples are 15 m apart and smooth; hillsides get the small folds they would have between them, none on the shore.
        const grow = Math.min(1, h / 12);
        h += grow * (noise(x / 130, z / 130) * (1.6 + 0.012 * Math.min(h, 300)) + noiseB(x / 47, z / 47) * (0.7 + 0.004 * Math.min(h, 300)));
      } else {
        const deep = Math.min(1, -h / 20);
        h += deep * noise(x / 520, z / 520) * 5;
      }
      const edge = Math.min(x + half, half - x, z + half, half - z);
      if (edge < RIM && h > 0) {
        const t = 1 - edge / RIM;
        h = h * (1 - t * t * (3 - 2 * t)) - 12 * t * t * (3 - 2 * t);
      }
      heights[j * res + i] = h;
    }
  }
  return heights;
}
