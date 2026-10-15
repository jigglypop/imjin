// The campaign map for phones (and for the moment before the 3D world is ready on a desktop): the 3D world's land and
// sea painted from above into one image, public/ui/grand_flat.webp, over the DEM's window like map_south.webp, so the
// markers use the same projection. Painted by the 3D map's own rules: its light baked from the DEM (src/ui/grand/
// landBake.ts), its country and colours (landCover.ts: woods, farmland, rock, beaches, as the shader draws them from
// afar), the sea's depth colours with pale shoals at the shores and a thin line of surf (groundSea.ts). Two pixels to a
// DEM texel, so a phone zoomed in still sees the woods' edges.
//
//   node scripts/build-grand-flat.mjs [--scale=2] [--quality=80] [--out=public/ui/grand_flat.webp]
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createServer } from 'vite';
import { readDem } from './build-grand-terrain.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
const SCALE = Number(args.scale ?? 2);
const QUALITY = Number(args.quality ?? 80);
const OUT = args.out ?? 'public/ui/grand_flat.webp';

const vite = await createServer({ root: ROOT, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
const { bakeLand, landFrame, SLOPE_RANGE, HEIGHT_RANGE } = await vite.ssrLoadModule('/src/ui/grand/landBake.ts');
const { landNoiseData, coverOf, farColor, noiseAt, NOISE_SCALE, smooth } = await vite.ssrLoadModule('/src/ui/grand/landCover.ts');
const { SUN_LIGHT, SKY_LIGHT } = await vite.ssrLoadModule('/src/ui/grand/groundPalette.ts');
const { MODEL_METRE } = await vite.ssrLoadModule('/src/ui/grand/hero/site.ts');
const { DEM_RECT } = await vite.ssrLoadModule('/src/ui/grand/mapMath.ts');
const { MAP_ASPECT } = await vite.ssrLoadModule('/src/ui/grand/projection.ts');
await vite.close();

const dem = await readDem();
const W = dem.width, H = dem.height;
const baked = bakeLand(dem.heights, landFrame());
const noise = landNoiseData();

// Open water's distance to the coast in DEM texels, by two chamfer sweeps from the land.
const coast = new Float32Array(W * H).fill(1e9);
for (let i = 0; i < W * H; i += 1) if (dem.heights[i] > 0) coast[i] = 0;
const D = Math.SQRT2;
for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
  const i = y * W + x;
  if (x > 0) coast[i] = Math.min(coast[i], coast[i - 1] + 1);
  if (y > 0) coast[i] = Math.min(coast[i], coast[i - W] + 1, x > 0 ? coast[i - W - 1] + D : 1e9, x < W - 1 ? coast[i - W + 1] + D : 1e9);
}
for (let y = H - 1; y >= 0; y -= 1) for (let x = W - 1; x >= 0; x -= 1) {
  const i = y * W + x;
  if (x < W - 1) coast[i] = Math.min(coast[i], coast[i + 1] + 1);
  if (y < H - 1) coast[i] = Math.min(coast[i], coast[i + W] + 1, x < W - 1 ? coast[i + W + 1] + D : 1e9, x > 0 ? coast[i + W - 1] + D : 1e9);
}

/** Bilinear over a DEM-sized grid at DEM texel coordinates (x, y). */
const bilinear = (read, x, y) => {
  const cx = Math.min(W - 1.001, Math.max(0, x)), cy = Math.min(H - 1.001, Math.max(0, y));
  const x0 = cx | 0, y0 = cy | 0, fx = cx - x0, fy = cy - y0;
  const top = read(y0 * W + x0) + (read(y0 * W + x0 + 1) - read(y0 * W + x0)) * fx;
  const bottom = read((y0 + 1) * W + x0) + (read((y0 + 1) * W + x0 + 1) - read((y0 + 1) * W + x0)) * fx;
  return top + (bottom - top) * fy;
};
const lin = (r, g, b) => [r, g, b].map((c) => (c / 255) ** 2.2);
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
const SHALLOW = lin(40, 134, 146), SHOAL = lin(104, 180, 172), SHELF = lin(24, 96, 128), DEEP = lin(12, 50, 80), SURF = lin(236, 244, 242);

const w = Math.round(W * SCALE), h = Math.round(H * SCALE);
const out = Buffer.alloc(w * h * 3);
for (let py = 0; py < h; py += 1) {
  for (let px = 0; px < w; px += 1) {
    // The DEM texel under the pixel's centre, as the 3D land lays its vertices (x / (W - 1) of the way across).
    const x = ((px + 0.5) / w) * (W - 1), y = ((py + 0.5) / h) * (H - 1);
    const metres = bilinear((i) => dem.heights[i], x, y);
    let rgb;
    if (metres > 0) {
      const channel = (c) => bilinear((i) => baked[i * 4 + c] / 255, x, y);
      const sun = channel(0), sky = channel(1), slope = channel(2) * SLOPE_RANGE, a = channel(3);
      const u = DEM_RECT.u + (x / (W - 1)) * DEM_RECT.w, v = DEM_RECT.v + (y / (H - 1)) * DEM_RECT.h;
      const mx = (u - 0.5) / MODEL_METRE, mz = (v - 0.5) / MAP_ASPECT / MODEL_METRE;
      const cover = coverOf(noise, slope, a * a * HEIGHT_RANGE, mx, mz);
      const albedo = farColor(cover, noiseAt(noise, mx, mz, NOISE_SCALE.crown, 3));
      rgb = albedo.map((c, k) => c * (SUN_LIGHT[k] * sun + SKY_LIGHT[k] * sky));
    } else {
      const deep = Math.min(1, -metres / 160);
      const shore = bilinear((i) => coast[i], x, y);
      const shoal = (1 - smooth(0, 0.03, deep)) * (1 - smooth(1, 6, shore));
      rgb = mix(mix(mix(SHALLOW, SHOAL, shoal), SHELF, smooth(0.02, 0.16, deep)), DEEP, smooth(0.16, 0.9, deep));
      rgb = mix(rgb, SURF, (1 - smooth(0.2, 0.9 / SCALE + 0.2, shore)) * 0.8);
    }
    const o = (py * w + px) * 3;
    for (let k = 0; k < 3; k += 1) out[o + k] = Math.round(Math.min(1, Math.max(0, rgb[k])) ** (1 / 2.2) * 255);
  }
}
await sharp(out, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: QUALITY, effort: 6 }).toFile(fileURLToPath(new URL(`../${OUT}`, import.meta.url)));
console.log(`${OUT}: ${w} x ${h}`);
