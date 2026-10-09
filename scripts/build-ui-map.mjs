// Bakes the static dark sea map used by the menu and by phones (no 3D select scene there).
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
const sea0 = [20, 52, 82];
const sea1 = [6, 14, 24];
const land0 = [16, 28, 42];
const land1 = [118, 146, 176];
const rim = [214, 232, 248];
const light = [-0.55, -0.55, 0.62];
const ll = Math.hypot(...light);
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
      const t = clamp(0.04 + lit * 0.72 + smooth(50, 1500, v) * 0.2 - (1 - n[2] / nl) * 0.55);
      c = land0.map((a, i) => mix(a, land1[i], t));
      const band = Math.abs(((v / 250) % 1) - 0.5);
      if (v > 80 && band > 0.485) c = c.map((a, i) => mix(a, rim[i], 0.12));
    } else {
      const d = smooth(0, 900, -v);
      c = sea0.map((a, i) => mix(a, sea1[i], d));
      const shallow = 1 - smooth(0, 60, -v);
      c = c.map((a) => a + shallow * 8);
    }
    const coast = (v > 0) !== (at(x + 1, y) > 0) || (v > 0) !== (at(x, y + 1) > 0);
    if (coast) c = c.map((a, i) => mix(a, rim[i], 0.5));
    out[k] = c[0];
    out[k + 1] = c[1];
    out[k + 2] = c[2];
  }
}
await sharp(out, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: 80 }).toFile(ROOT + 'public/ui/map_south.webp');
console.log('wrote public/ui/map_south.webp');
