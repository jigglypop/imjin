// Bakes the static pale map used by phones (no 3D select scene there). Same palette as the 3D map in src/select/SelectScene.ts
// and the campaign map (scripts/build-grand-map.mjs): stone-white land with soft relief, pale blue-grey sea, hairline coast.
// The image covers the same lon/lat window as src/select/demMeta.json, so markers use the same projection math.
//   node scripts/build-ui-map.mjs
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const meta = JSON.parse(readFileSync(ROOT + 'src/select/demMeta.json', 'utf8'));
const { width: w, height: h, metersPerPixel } = meta;
const { data } = await sharp(ROOT + 'public/ui/korea_dem.webp').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const H = new Float32Array(w * h);
for (let i = 0; i < w * h; i += 1) H[i] = data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768;
const at = (x, y) => H[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

const out = Buffer.alloc(w * h * 3);
const SEA_SHALLOW = [204, 221, 236];
const SEA_DEEP = [172, 194, 214];
const LAND = [247, 245, 239];
const LAND_HIGH = [222, 226, 226];
const SHADOW = [140, 158, 176];
const LINE = [140, 160, 180];
const MIST = [233, 240, 246];
const light = [-0.55, -0.55, 0.62];
const ll = Math.hypot(...light);
const fade = Math.round(w * 0.05);
for (let y = 0; y < h; y += 1) {
  for (let x = 0; x < w; x += 1) {
    const v = at(x, y);
    const k = (y * w + x) * 3;
    const dx = (at(x + 1, y) - at(x - 1, y)) / (2 * metersPerPixel);
    const dy = (at(x, y + 1) - at(x, y - 1)) / (2 * metersPerPixel);
    const s = 4.2 * 0.9;
    const n = [-dx * s, -dy * s, 1];
    const nl = Math.hypot(...n);
    const lit = clamp((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / (nl * ll));
    let c;
    if (v > 0) {
      const hi = smooth(0, 900, v) * 0.6;
      const lum = clamp(0.86 + (lit - 0.62) * 1.5 - (1 - n[2] / nl) * 0.55, 0.35, 1.04);
      const stone = LAND.map((a, i) => mix(a, LAND_HIGH[i], hi));
      c = SHADOW.map((a, i) => mix(a, stone[i], clamp(lum)));
      c = c.map((a) => (lum > 1 ? Math.min(255, a * lum) : a));
      const band = Math.abs(((v / 250) % 1) - 0.5);
      if (v > 80 && band > 0.485) c = c.map((a, i) => mix(a, LINE[i], 0.1));
    } else {
      c = SEA_SHALLOW.map((a, i) => mix(a, SEA_DEEP[i], smooth(0, 80, -v)));
      const shadow = (1 - smooth(0, 14, -v)) * 0.1;
      c = c.map((a) => a * (1 - shadow));
    }
    const coast = (v > 0) !== (at(x + 1, y) > 0) || (v > 0) !== (at(x, y + 1) > 0);
    if (coast) c = c.map((a, i) => mix(a, LINE[i], 0.6));
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    const f = edge < fade ? 1 - (edge / fade) ** 1.4 : 0;
    c = c.map((a, i) => mix(a, MIST[i], f));
    out[k] = c[0];
    out[k + 1] = c[1];
    out[k + 2] = c[2];
  }
}
await sharp(out, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: 80 }).toFile(ROOT + 'public/ui/map_south.webp');
console.log('wrote public/ui/map_south.webp');
