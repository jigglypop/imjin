// Brass studs for a generated colour map: Meshy bakes the round brass rivets of a red brigandine (dujeong-gap) as
// cream dots. This finds them (bright, low-saturation, warm pixels in small blobs inside red cloth) and tints them
// old gold by their own brightness, the rim a little darker; every other pixel is left as it was.
import sharp from 'sharp';

/** Sum of a 0/1 mask over a (2r+1)² box at every pixel, by an integral image. */
function boxSum(mask, w, h, r) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += mask[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    out[y * w + x] = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
  }
  return out;
}

export async function brassStuds(input) {
  const { data, info } = await sharp(Buffer.from(input)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;
  const cand = new Uint8Array(n), red = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const s = max ? (max - min) / max : 0;
    if (max > 150 && s < 0.45 && r >= g && g >= b - 8) cand[i] = 1;
    if (r > 70 && r > g * 1.7 && r > b * 1.5) red[i] = 1;
  }
  const s = Math.max(1, Math.round(w / 1024)); // pixel scale against a 1k map
  // Small blobs: a candidate whose neighbourhood is not filled with candidates (a big pale area is skin or trim).
  const near = boxSum(cand, w, h, 4 * s), redNear = boxSum(red, w, h, 6 * s);
  const area = (8 * s + 1) ** 2, redArea = (12 * s + 1) ** 2;
  const out = Buffer.from(data);
  let tinted = 0;
  for (let i = 0; i < n; i++) {
    if (!cand[i] || near[i] > area * 0.45 || redNear[i] < redArea * 0.3) continue;
    const l = (data[i * 3] * 0.3 + data[i * 3 + 1] * 0.59 + data[i * 3 + 2] * 0.11) / 255;
    const k = 0.55 + 0.6 * l;
    out[i * 3] = Math.min(255, 196 * k); out[i * 3 + 1] = Math.min(255, 142 * k); out[i * 3 + 2] = Math.min(255, 58 * k);
    tinted++;
  }
  const png = await sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  return { png: new Uint8Array(png), tinted, share: tinted / n };
}

/**
 * Weathered skin for a colour map whose skin came out chalk white: pale, warm-tinted pixels (skin) move toward a tan,
 * while near-neutral whites (a white beard, steel) stay as they are.
 */
export async function warmSkin(input) {
  const { data, info } = await sharp(Buffer.from(input)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  let n = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const warm = r - b;
    if (r < 150 || warm < 14 || warm > 90 || g > r || b > g) continue;
    const f = Math.min(1, (warm - 14) / 20); // fade in from near-neutral so beard edges stay clean
    out[i * 3] = r * (1 - 0.08 * f); out[i * 3 + 1] = g * (1 - 0.2 * f); out[i * 3 + 2] = b * (1 - 0.34 * f);
    n++;
  }
  return { png: new Uint8Array(await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()), tinted: n };
}

/** Blue-hued patches on dark iron (a Meshy colour cast): to the neutral dark iron around them, brightness kept. */
export async function deBlue(input) {
  const { data, info } = await sharp(Buffer.from(input)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  let n = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    if (b <= r + 6 || b <= g + 2) continue;
    const l = r * 0.3 + g * 0.59 + b * 0.11;
    out[i * 3] = l * 1.02; out[i * 3 + 1] = l; out[i * 3 + 2] = l * 0.96;
    n++;
  }
  return { png: new Uint8Array(await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()), tinted: n };
}

/**
 * Pale blotches on black lacquer: near-white, unsaturated pixels whose neighbourhood is mostly dark become lacquer
 * black (a soft sheen kept from their own brightness). Gold lacing is saturated and stays.
 */
export async function lacquer(input) {
  const { data, info } = await sharp(Buffer.from(input)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const pale = new Uint8Array(w * h), dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max > 120 && (max - min) / max < 0.22) pale[i] = 1;
    if (max < 60) dark[i] = 1;
  }
  const s = Math.max(1, Math.round(w / 1024));
  const darkNear = boxSum(dark, w, h, 24 * s), area = (48 * s + 1) ** 2;
  const out = Buffer.from(data);
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!pale[i] || darkNear[i] < area * 0.2) continue;
    const l = Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) / 255;
    const v = 22 + 18 * l;
    out[i * 3] = v; out[i * 3 + 1] = v; out[i * 3 + 2] = v * 1.08;
    n++;
  }
  return { png: new Uint8Array(await sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()), tinted: n };
}

/**
 * A texture-space mask of the triangles whose bind-pose centre lies in a box given as fractions of the figure's
 * height (x across, y up from the feet, z toward the front): e.g. the chest plate. Rasterised over the UVs.
 */
export function regionMask(prim, size, box) {
  const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices().getArray();
  const lo = pos.getMin([]), hi = pos.getMax([]);
  const H = hi[1] - lo[1], cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
  const mask = new Uint8Array(size * size);
  const p = [0, 0, 0], t = [0, 0];
  for (let k = 0; k < idx.length; k += 3) {
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < 3; j++) { pos.getElement(idx[k + j], p); x += p[0] / 3; y += p[1] / 3; z += p[2] / 3; }
    const fx = (x - cx) / H, fy = (y - lo[1]) / H, fz = (z - cz) / H;
    if (Math.abs(fx) > box.x || fy < box.y0 || fy > box.y1 || fz < box.z) continue;
    const q = [0, 1, 2].map((j) => { uv.getElement(idx[k + j], t); return [t[0] * size, t[1] * size]; });
    const minY = Math.max(0, Math.floor(Math.min(...q.map((v) => v[1])))), maxY = Math.min(size - 1, Math.ceil(Math.max(...q.map((v) => v[1]))));
    const minX = Math.max(0, Math.floor(Math.min(...q.map((v) => v[0])))), maxX = Math.min(size - 1, Math.ceil(Math.max(...q.map((v) => v[0]))));
    const [a, b, c] = q;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (!area) continue;
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const w0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
      const w1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
      if (w0 >= -0.02 && w1 >= -0.02 && 1 - w0 - w1 >= -0.02) mask[py * size + px] = 1;
    }
  }
  return mask;
}

/** Inside a mask: pale, unsaturated colour → lacquer black; metal/roughness → glossy non-metal lacquer. */
export async function lacquerRegion(color, mr, mask, size, normal) {
  const nm = normal ? await sharp(Buffer.from(normal)).resize(size, size).removeAlpha().raw().toBuffer() : null;
  const c = await sharp(Buffer.from(color)).resize(size, size).removeAlpha().raw().toBuffer();
  const m = await sharp(Buffer.from(mr)).resize(size, size).removeAlpha().raw().toBuffer();
  let n = 0;
  for (let i = 0; i < size * size; i++) {
    if (!mask[i]) continue;
    const r = c[i * 3], g = c[i * 3 + 1], b = c[i * 3 + 2], max = Math.max(r, g, b), min = Math.min(r, g, b);
    // Gold lacing is saturated and warm; the pale teeth are not.
    if (max > 40 && (max - min) / max < 0.3) { const v = 14 + 0.05 * max; c[i * 3] = v; c[i * 3 + 1] = v; c[i * 3 + 2] = v * 1.08; n++; }
    m[i * 3 + 1] = 107; m[i * 3 + 2] = 0; // G roughness 0.42, B metalness 0
    if (nm) { nm[i * 3] = 128; nm[i * 3 + 1] = 128; nm[i * 3 + 2] = 255; } // a smooth lacquered plate
  }
  const enc = (buf) => sharp(buf, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  return { color: new Uint8Array(await enc(c)), mr: new Uint8Array(await enc(m)), normal: nm ? new Uint8Array(await enc(nm)) : null, tinted: n };
}
