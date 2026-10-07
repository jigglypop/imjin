import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = join(ROOT, 'public', 'ui', 'korea_dem.webp');
const META = join(ROOT, 'src', 'select', 'demMeta.json');

const Z = 10;
const BOUNDS = { west: 125.85, east: 129.5, south: 34.1, north: 35.62 };
const WIDTH = 2048;

const lonToX = (lon) => ((lon + 180) / 360) * 2 ** Z;
const latToY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z;
};

const fx0 = lonToX(BOUNDS.west);
const fx1 = lonToX(BOUNDS.east);
const fy0 = latToY(BOUNDS.north);
const fy1 = latToY(BOUNDS.south);
const tx0 = Math.floor(fx0);
const tx1 = Math.floor(fx1);
const ty0 = Math.floor(fy0);
const ty1 = Math.floor(fy1);
const tilesX = tx1 - tx0 + 1;
const tilesY = ty1 - ty0 + 1;
const big = new Float32Array(tilesX * 256 * tilesY * 256);
const bigW = tilesX * 256;

async function tile(x, y) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error(`tile ${x},${y} failed`);
}

const jobs = [];
for (let ty = ty0; ty <= ty1; ty += 1) {
  for (let tx = tx0; tx <= tx1; tx += 1) {
    jobs.push(
      tile(tx, ty).then(async (buf) => {
        const { data } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const ox = (tx - tx0) * 256;
        const oy = (ty - ty0) * 256;
        for (let j = 0; j < 256; j += 1) {
          for (let i = 0; i < 256; i += 1) {
            const k = (j * 256 + i) * 3;
            big[(oy + j) * bigW + ox + i] = data[k] * 256 + data[k + 1] + data[k + 2] / 256 - 32768;
          }
        }
      }),
    );
  }
}
await Promise.all(jobs);

const bigH = tilesY * 256;
const fixed = Float32Array.from(big);
const win = [];
for (let y = 1; y < bigH - 1; y += 1) {
  for (let x = 1; x < bigW - 1; x += 1) {
    win.length = 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (dx || dy) win.push(big[(y + dy) * bigW + x + dx]);
    win.sort((a, b) => a - b);
    const med = (win[3] + win[4]) / 2;
    const v = big[y * bigW + x];
    if (Math.abs(v - med) > 120 && (v > win[7] + 60 || v < win[0] - 60)) fixed[y * bigW + x] = med;
  }
}
big.set(fixed);

const px0 = (fx0 - tx0) * 256;
const px1 = (fx1 - tx0) * 256;
const py0 = (fy0 - ty0) * 256;
const py1 = (fy1 - ty0) * 256;
const HEIGHT = Math.round((WIDTH * (py1 - py0)) / (px1 - px0));
const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
let minH = Infinity;
let maxH = -Infinity;
for (let j = 0; j < HEIGHT; j += 1) {
  for (let i = 0; i < WIDTH; i += 1) {
    const sx = px0 + ((i + 0.5) / WIDTH) * (px1 - px0) - 0.5;
    const sy = py0 + ((j + 0.5) / HEIGHT) * (py1 - py0) - 0.5;
    const x0 = Math.max(0, Math.floor(sx));
    const y0 = Math.max(0, Math.floor(sy));
    const x1 = Math.min(bigW - 1, x0 + 1);
    const y1 = Math.min(tilesY * 256 - 1, y0 + 1);
    const ax = sx - x0;
    const ay = sy - y0;
    const h =
      (big[y0 * bigW + x0] * (1 - ax) + big[y0 * bigW + x1] * ax) * (1 - ay) + (big[y1 * bigW + x0] * (1 - ax) + big[y1 * bigW + x1] * ax) * ay;
    minH = Math.min(minH, h);
    maxH = Math.max(maxH, h);
    const v = Math.max(0, Math.min(65535.99, h + 32768));
    const k = (j * WIDTH + i) * 3;
    rgb[k] = Math.floor(v / 256);
    rgb[k + 1] = Math.floor(v) % 256;
    rgb[k + 2] = Math.floor((v - Math.floor(v)) * 256);
  }
}
await mkdir(join(ROOT, 'src', 'select'), { recursive: true });
await sharp(rgb, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).webp({ lossless: true, effort: 6 }).toFile(OUT);
const mercY = (lat) => latToY(lat);
await writeFile(
  META,
  JSON.stringify(
    {
      width: WIDTH,
      height: HEIGHT,
      bounds: BOUNDS,
      zoom: Z,
      x0: fx0,
      x1: fx1,
      y0: mercY(BOUNDS.north),
      y1: mercY(BOUNDS.south),
      minH: Math.round(minH),
      maxH: Math.round(maxH),
      metersPerPixel: (40075016 * Math.cos((35 * Math.PI) / 180) * (BOUNDS.east - BOUNDS.west)) / 360 / WIDTH,
    },
    null,
    2,
  ),
);
console.log('dem', WIDTH, HEIGHT, 'tiles', tilesX * tilesY, 'range', Math.round(minH), Math.round(maxH));
