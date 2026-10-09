// Renders the strategic map backdrop for the faction campaign: public/ui/grand_map.webp.
// Pale blue-grey sea with a soft shelf and shadow along the coast, white/stone land with subtle shaded relief and a
// hairline coast. Heights come from public/ui/korea_dem.webp where it reaches and from terrarium tiles around it (Jeju,
// Kyushu, the Yellow Sea side), so the off-map edge nodes sit on a believable sea. The frame is src/ui/grand/mapFrame.json,
// shared with src/ui/grand/projection.ts so node positions line up with the image.
//   node scripts/build-grand-map.mjs
import sharp from 'sharp';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = join(ROOT, 'public', 'ui', 'grand_map.webp');
const frame = JSON.parse(await readFile(join(ROOT, 'src/ui/grand/mapFrame.json'), 'utf8'));
const dem = JSON.parse(await readFile(join(ROOT, 'src/select/demMeta.json'), 'utf8'));
const Z = frame.zoom;

const lonToX = (lon) => ((lon + 180) / 360) * 2 ** Z;
const latToY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z;
};
const fx0 = lonToX(frame.west);
const fx1 = lonToX(frame.east);
const fy0 = latToY(frame.north);
const fy1 = latToY(frame.south);
const W = frame.imageWidth;
const H = Math.round((W * (fy1 - fy0)) / (fx1 - fx0));

// Terrarium tiles for the whole frame; korea_dem overrides them where it has data (it is despiked).
const tx0 = Math.floor(fx0);
const tx1 = Math.floor(fx1);
const ty0 = Math.floor(fy0);
const ty1 = Math.floor(fy1);
const bigW = (tx1 - tx0 + 1) * 256;
const bigH = (ty1 - ty0 + 1) * 256;
const big = new Float32Array(bigW * bigH).fill(-50);
let missing = 0;

async function tile(x, y) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      // retry below
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return null;
}

const jobs = [];
for (let ty = ty0; ty <= ty1; ty += 1) {
  for (let tx = tx0; tx <= tx1; tx += 1) {
    jobs.push(
      tile(tx, ty).then(async (buf) => {
        if (!buf) {
          missing += 1;
          return;
        }
        const { data } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        for (let j = 0; j < 256; j += 1) {
          for (let i = 0; i < 256; i += 1) {
            const k = (j * 256 + i) * 3;
            big[((ty - ty0) * 256 + j) * bigW + (tx - tx0) * 256 + i] = data[k] * 256 + data[k + 1] + data[k + 2] / 256 - 32768;
          }
        }
      }),
    );
  }
}
await Promise.all(jobs);
if (missing) console.warn(`${missing} terrarium tiles unavailable: those areas render as open sea`);

const demRaw = await sharp(join(ROOT, 'public/ui/korea_dem.webp')).removeAlpha().raw().toBuffer();
const demH = (ix, iy) => {
  const k = (iy * dem.width + ix) * 3;
  return demRaw[k] * 256 + demRaw[k + 1] + demRaw[k + 2] / 256 - 32768;
};

function bilinear(get, sx, sy, w, h) {
  const x0 = Math.max(0, Math.min(w - 2, Math.floor(sx)));
  const y0 = Math.max(0, Math.min(h - 2, Math.floor(sy)));
  const ax = Math.min(1, Math.max(0, sx - x0));
  const ay = Math.min(1, Math.max(0, sy - y0));
  return (get(x0, y0) * (1 - ax) + get(x0 + 1, y0) * ax) * (1 - ay) + (get(x0, y0 + 1) * (1 - ax) + get(x0 + 1, y0 + 1) * ax) * ay;
}

function heightAt(tx, ty) {
  if (tx >= dem.x0 && tx <= dem.x1 && ty >= dem.y0 && ty <= dem.y1) {
    return bilinear(demH, ((tx - dem.x0) / (dem.x1 - dem.x0)) * dem.width - 0.5, ((ty - dem.y0) / (dem.y1 - dem.y0)) * dem.height - 0.5, dem.width, dem.height);
  }
  return bilinear((x, y) => big[y * bigW + x], (tx - tx0) * 256 - 0.5, (ty - ty0) * 256 - 0.5, bigW, bigH);
}

const hm = new Float32Array(W * H);
for (let j = 0; j < H; j += 1) {
  const ty = fy0 + ((j + 0.5) / H) * (fy1 - fy0);
  for (let i = 0; i < W; i += 1) hm[j * W + i] = heightAt(fx0 + ((i + 0.5) / W) * (fx1 - fx0), ty);
}

// Land coverage with a soft edge, then blurred copies for the hairline, the coast shadow and the shelf.
const land = new Float32Array(W * H);
for (let i = 0; i < land.length; i += 1) land[i] = Math.min(1, Math.max(0, (hm[i] - 1.5) / 3));
const landGrey = Buffer.from(land.map((v) => Math.round(v * 255)));
async function blurred(sigma) {
  const { data } = await sharp(landGrey, { raw: { width: W, height: H, channels: 1 } }).blur(sigma).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
  return data;
}
const [bLine, bShadow, bShelf] = await Promise.all([blurred(1.1), blurred(5), blurred(22)]);

// Hillshade, light from the north-west.
const metersPerTile = (40075016 * Math.cos((34.5 * Math.PI) / 180)) / 2 ** Z;
const mpp = ((fx1 - fx0) / W) * metersPerTile;
const L = [-0.5, -0.62, 0.62];
const ln = Math.hypot(...L);
const lx = L[0] / ln;
const ly = L[1] / ln;
const lz = L[2] / ln;
const EXAG = 2.4;
const smooth = new Float32Array(W * H);
for (let j = 1; j < H - 1; j += 1) {
  for (let i = 1; i < W - 1; i += 1) {
    const k = j * W + i;
    smooth[k] = (hm[k] * 4 + hm[k - 1] + hm[k + 1] + hm[k - W] + hm[k + W]) / 8;
  }
}

const mix = (a, b, t) => a + (b - a) * t;
const SEA_DEEP = [193, 208, 222];
const SEA_SHALLOW = [222, 233, 242];
const LAND = [247, 245, 239];
const LAND_HIGH = [222, 226, 226];
const LINE = [170, 186, 201];
const FOG = [236, 242, 247];
const rgb = Buffer.alloc(W * H * 3);
const fade = W * 0.035;
// Per-pixel hash noise (a sequential generator would stripe along rows) to keep the soft gradients from banding.
const rand = (x, y) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return v - Math.floor(v) - 0.5;
};
for (let j = 0; j < H; j += 1) {
  for (let i = 0; i < W; i += 1) {
    const k = j * W + i;
    const a = land[k];
    const gx = i > 0 && i < W - 1 ? (smooth[k + 1] - smooth[k - 1]) / (2 * mpp) : 0;
    const gy = j > 0 && j < H - 1 ? (smooth[k + W] - smooth[k - W]) / (2 * mpp) : 0;
    const nl = Math.hypot(gx * EXAG, gy * EXAG, 1);
    const shade = ((-gx * EXAG) * lx + (-gy * EXAG) * ly + lz) / nl / lz;
    const k01 = Math.min(1, Math.max(0, 1 + (shade - 1) * 0.5));
    const hi = Math.min(1, Math.max(0, hm[k] / 900));
    const lit = 0.7 + 0.33 * k01;
    // Sea: lighter on the shelf near the coast, a faint shadow just off it.
    const shelf = Math.min(1, (bShelf[k] / 255) * 2.2);
    const si = Math.max(0, i - 2);
    const sj = Math.max(0, j - 2);
    const shadow = (bShadow[sj * W + si] / 255) * (1 - a) * 0.075;
    const shelfMix = Math.min(1, shelf * 0.9);
    const line = Math.max(0, 1 - Math.abs(bLine[k] / 255 - 0.5) * 3.2) * 0.55;
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c += 1) {
      const sea = mix(SEA_DEEP[c], SEA_SHALLOW[c], shelfMix) * (1 - shadow);
      const ground = mix(LAND[c], LAND_HIGH[c], hi * 0.6) * lit;
      let v = mix(sea, ground, a);
      v = mix(v, LINE[c], line);
      out[c] = v;
    }
    const edge = Math.min(i, j, W - 1 - i, H - 1 - j);
    const f = edge < fade ? 1 - (edge / fade) ** 1.4 : 0;
    const n = rand(i, j) * 1.8;
    for (let c = 0; c < 3; c += 1) rgb[k * 3 + c] = Math.max(0, Math.min(255, Math.round(mix(out[c], FOG[c], f) + n)));
  }
}

await mkdir(join(ROOT, 'public', 'ui'), { recursive: true });
const info = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 80, effort: 5 }).toFile(OUT);
console.log('grand_map', info.width, info.height, `${Math.round(info.size / 1024)} KB`);
