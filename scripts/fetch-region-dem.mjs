// Cuts a 16 km square of real elevation around every campaign region and writes it to public/terrain/<id>.dem.
// The source is the same Terrarium tile set as scripts/fetch-dem.mjs, but at zoom 13 (about 15.6 m a pixel), the finest
// the data really has near the Korean coast. Each window is resampled onto a metric grid (east right, south down, 1024
// squared, 15.625 m a sample), despiked, the sea set to exactly 0 (the source has no depth; src/terrain/regionDem.ts
// builds the sea floor), and packed by encodeRegionDem. Windows are listed in src/sim/grand/regionWindows.json; the bearing
// out to open sea (`seaward`) is worked out here once and kept, so edit it by hand if a region needs another approach.
//   node scripts/fetch-region-dem.mjs [region ...]
// --windows=src/terrain/battleWindows.json cuts the historical battles of the later chapters instead: the same grid, but a
// window may name its own `size` (the battle maps are 20 km), and no seaward bearing is worked out for them.
// Tiles are cached under the system temp folder, so a second run does not touch the network.
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WINDOWS = join(root, process.argv.find((a) => a.startsWith('--windows='))?.slice(10) ?? 'src/sim/grand/regionWindows.json');
const BATTLES = WINDOWS.endsWith('battleWindows.json');
const OUT = join(root, 'public/terrain');
const CACHE = join(tmpdir(), 'imjin-terrarium');
const Z = 13;
const N = 1024;
let SIZE = 16000;
let CELL = SIZE / N;

const bundle = await build({ entryPoints: [join(root, 'src/terrain/regionDem.ts')], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { encodeRegionDem, decodeRegionDem } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const windows = JSON.parse(await readFile(WINDOWS, 'utf8'));
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ids = wanted.length ? wanted : Object.keys(windows);

const lonToPx = (lon) => ((lon + 180) / 360) * 2 ** Z * 256;
const latToPx = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z * 256;
};

async function tile(x, y) {
  const file = join(CACHE, String(Z), String(x), `${y}.png`);
  try {
    await stat(file);
    return await readFile(file);
  } catch {
    // Not cached yet.
  }
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(url);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, buf);
      return buf;
    }
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  throw new Error(`tile ${x},${y} failed`);
}

async function window(lon, lat) {
  const mx = 111320 * Math.cos((lat * Math.PI) / 180);
  const west = lon - SIZE / 2 / mx;
  const east = lon + SIZE / 2 / mx;
  const north = lat + SIZE / 2 / 111320;
  const south = lat - SIZE / 2 / 111320;
  const tx0 = Math.floor(lonToPx(west) / 256) - 1;
  const tx1 = Math.floor(lonToPx(east) / 256) + 1;
  const ty0 = Math.floor(latToPx(north) / 256) - 1;
  const ty1 = Math.floor(latToPx(south) / 256) + 1;
  const w = (tx1 - tx0 + 1) * 256;
  const h = (ty1 - ty0 + 1) * 256;
  const big = new Float32Array(w * h);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) {
      jobs.push(
        tile(tx, ty).then(async (buf) => {
          const { data } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          for (let j = 0; j < 256; j += 1) {
            for (let i = 0; i < 256; i += 1) {
              const k = (j * 256 + i) * 3;
              big[((ty - ty0) * 256 + j) * w + (tx - tx0) * 256 + i] = data[k] * 256 + data[k + 1] + data[k + 2] / 256 - 32768;
            }
          }
        }),
      );
    }
  }
  for (let k = 0; k < jobs.length; k += 8) await Promise.all(jobs.slice(k, k + 8));
  // Single pixels far off their neighbours are errors in the source, not hills.
  const fixed = Float32Array.from(big);
  const around = [];
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      around.length = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (dx || dy) around.push(big[(y + dy) * w + x + dx]);
      around.sort((a, b) => a - b);
      const med = (around[3] + around[4]) / 2;
      const v = big[y * w + x];
      if (Math.abs(v - med) > 120 && (v > around[7] + 60 || v < around[0] - 60)) fixed[y * w + x] = med;
    }
  }
  const heights = new Float32Array(N * N);
  const originX = lonToPx(west);
  const originY = latToPx(north);
  const spanX = lonToPx(east) - originX;
  const spanY = latToPx(south) - originY;
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const sx = originX + ((i + 0.5) / N) * spanX - 0.5 - tx0 * 256;
      const sy = originY + ((j + 0.5) / N) * spanY - 0.5 - ty0 * 256;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const ax = sx - x0;
      const ay = sy - y0;
      const v =
        (fixed[y0 * w + x0] * (1 - ax) + fixed[y0 * w + x0 + 1] * ax) * (1 - ay) + (fixed[(y0 + 1) * w + x0] * (1 - ax) + fixed[(y0 + 1) * w + x0 + 1] * ax) * ay;
      // The ocean is 0 in the data, and the first half metre above it is tide and noise rather than land.
      heights[j * N + i] = v < 0.5 ? 0 : v;
    }
  }
  return heights;
}

/** The bearing (radians, terrain x east / z south) to the broadest open water, judged on what lies 0.5 to 3 km out from the centre. */
function seawardOf(heights) {
  const sea = (x, z) => {
    const i = Math.round(N / 2 + x / CELL);
    const j = Math.round(N / 2 + z / CELL);
    return i >= 0 && j >= 0 && i < N && j < N && heights[j * N + i] === 0;
  };
  const open = (x, z) => sea(x, z) && [0, 1, 2, 3, 4, 5, 6, 7].every((k) => sea(x + Math.cos((k * Math.PI) / 4) * 120, z + Math.sin((k * Math.PI) / 4) * 120));
  const score = [];
  for (let k = 0; k < 72; k += 1) {
    const a = (k / 72) * Math.PI * 2;
    let s = 0;
    for (let d = 500; d <= 3000; d += 100) if (open(Math.cos(a) * d, Math.sin(a) * d)) s += 1;
    score.push(s);
  }
  let best = 0;
  let bestScore = -1;
  for (let k = 0; k < 72; k += 1) {
    let s = 0;
    for (let o = -4; o <= 4; o += 1) s += score[(k + o + 72) % 72] * (5 - Math.abs(o));
    if (s > bestScore) {
      bestScore = s;
      best = k;
    }
  }
  return Math.round(((best / 72) * Math.PI * 2) * 100) / 100;
}

/**
 * Water that no boat could reach from the open sea (polders below the tide line, salt pans, the noise of a flat delta) reads
 * as land 1 m up, so a battle map does not grow ponds behind its shore. Water joined to the battle at the window's middle
 * by a channel wider than a few samples stays sea.
 */
function fillInland(heights) {
  const wet = (k) => heights[k] === 0;
  // Open water: water for two samples all round, so the sea reaches inland only through channels about 100 m wide or more.
  const core = new Uint8Array(N * N);
  for (let j = 2; j < N - 2; j += 1) {
    for (let i = 2; i < N - 2; i += 1) {
      const k = j * N + i;
      let all = true;
      for (let dj = -2; dj <= 2 && all; dj += 1) for (let di = -2; di <= 2 && all; di += 1) all = wet(k + dj * N + di);
      core[k] = all ? 1 : 0;
    }
  }
  const seen = new Uint8Array(N * N);
  const stack = [];
  // The battle is fought at the window's middle, so the sea is what joins it: a lake that reaches the window's edge is not.
  for (let j = N / 2 - 64; j < N / 2 + 64; j += 1) for (let i = N / 2 - 64; i < N / 2 + 64; i += 1) stack.push(j * N + i);
  while (stack.length) {
    const k = stack.pop();
    if (seen[k] || !core[k]) continue;
    seen[k] = 1;
    stack.push(k - 1, k + 1, k - N, k + N);
  }
  const keep = new Uint8Array(N * N);
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const k = j * N + i;
      if (!wet(k)) continue;
      let near = false;
      for (let dj = -2; dj <= 2 && !near; dj += 1) for (let di = -2; di <= 2 && !near; di += 1) {
        const x = i + di;
        const y = j + dj;
        near = x >= 0 && y >= 0 && x < N && y < N && seen[y * N + x] === 1;
      }
      keep[k] = near ? 1 : 0;
    }
  }
  for (let k = 0; k < heights.length; k += 1) if (wet(k) && !keep[k]) heights[k] = 1;
}

await mkdir(OUT, { recursive: true });
let total = 0;
for (const id of ids) {
  const win = windows[id];
  if (!win) throw new Error(`no window for ${id}`);
  const started = Date.now();
  SIZE = win.size ?? 16000;
  CELL = SIZE / N;
  const heights = await window(win.lon, win.lat);
  if (BATTLES) fillInland(heights);
  const bytes = await encodeRegionDem({ n: N, cell: CELL, heights });
  const back = await decodeRegionDem(bytes);
  let worst = 0;
  for (let k = 0; k < heights.length; k += 1) worst = Math.max(worst, Math.abs(back.heights[k] - heights[k]));
  if (worst > 0.26) throw new Error(`${id}: the packed window drifts ${worst} m from the source`);
  await writeFile(join(OUT, `${id}.dem`), bytes);
  total += bytes.length;
  let land = 0;
  let peak = 0;
  for (let k = 0; k < heights.length; k += 1) {
    if (heights[k] > 0) land += 1;
    if (heights[k] > peak) peak = heights[k];
  }
  if (!BATTLES) win.seaward ??= seawardOf(heights);
  console.log(`${id.padEnd(13)} ${(bytes.length / 1024).toFixed(0).padStart(4)} KB  land ${((land / heights.length) * 100).toFixed(0).padStart(2)}%  peak ${peak.toFixed(0).padStart(4)} m  seaward ${win.seaward ?? '-'}  ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
const rows = Object.entries(windows).map(([id, w]) => `  ${JSON.stringify(id)}: ${JSON.stringify(w)}`);
await writeFile(WINDOWS, `{\n${rows.join(',\n')}\n}\n`);
console.log(`${ids.length} windows, ${(total / 1024 / 1024).toFixed(2)} MB`);
