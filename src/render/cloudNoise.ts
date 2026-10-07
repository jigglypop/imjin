import { Data3DTexture, LinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three/webgpu';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function worley(size: number, cells: number, rand: () => number) {
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < pts.length; i += 1) pts[i] = rand();
  const out = new Float32Array(size * size * size);
  const inv = cells / size;
  for (let z = 0; z < size; z += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const px = (x + 0.5) * inv;
        const py = (y + 0.5) * inv;
        const pz = (z + 0.5) * inv;
        const cx = Math.floor(px);
        const cy = Math.floor(py);
        const cz = Math.floor(pz);
        let best = 9;
        for (let dz = -1; dz <= 1; dz += 1)
          for (let dy = -1; dy <= 1; dy += 1)
            for (let dx = -1; dx <= 1; dx += 1) {
              const ix = (cx + dx + cells) % cells;
              const iy = (cy + dy + cells) % cells;
              const iz = (cz + dz + cells) % cells;
              const o = ((iz * cells + iy) * cells + ix) * 3;
              const fx = cx + dx + pts[o]! - px;
              const fy = cy + dy + pts[o + 1]! - py;
              const fz = cz + dz + pts[o + 2]! - pz;
              const d = fx * fx + fy * fy + fz * fz;
              if (d < best) best = d;
            }
        out[(z * size + y) * size + x] = Math.min(1, Math.sqrt(best));
      }
    }
  }
  return out;
}

function perlin(size: number, period: number, rand: () => number) {
  const g = new Float32Array(period * period * period * 3);
  for (let i = 0; i < period * period * period; i += 1) {
    const a = rand() * Math.PI * 2;
    const z = rand() * 2 - 1;
    const r = Math.sqrt(1 - z * z);
    g[i * 3] = r * Math.cos(a);
    g[i * 3 + 1] = r * Math.sin(a);
    g[i * 3 + 2] = z;
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const out = new Float32Array(size * size * size);
  const s = period / size;
  for (let z = 0; z < size; z += 1)
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) {
        const px = x * s;
        const py = y * s;
        const pz = z * s;
        const x0 = Math.floor(px);
        const y0 = Math.floor(py);
        const z0 = Math.floor(pz);
        const fx = px - x0;
        const fy = py - y0;
        const fz = pz - z0;
        let v = 0;
        for (let c = 0; c < 8; c += 1) {
          const dx = c & 1;
          const dy = (c >> 1) & 1;
          const dz = (c >> 2) & 1;
          const i = ((((z0 + dz) % period) * period + ((y0 + dy) % period)) * period + ((x0 + dx) % period)) * 3;
          const dot = g[i]! * (fx - dx) + g[i + 1]! * (fy - dy) + g[i + 2]! * (fz - dz);
          const w = (dx ? fade(fx) : 1 - fade(fx)) * (dy ? fade(fy) : 1 - fade(fy)) * (dz ? fade(fz) : 1 - fade(fz));
          v += dot * w;
        }
        out[(z * size + y) * size + x] = v;
      }
  return out;
}

export function createCloudNoise(size = 64) {
  const rand = mulberry32(2024);
  const p1 = perlin(size, 4, rand);
  const p2 = perlin(size, 8, rand);
  const w1 = worley(size, 4, rand);
  const w2 = worley(size, 8, rand);
  const w3 = worley(size, 16, rand);
  const data = new Uint8Array(size * size * size * 4);
  for (let i = 0; i < size * size * size; i += 1) {
    const per = Math.max(0, Math.min(1, 0.5 + (p1[i]! * 0.7 + p2[i]! * 0.3) * 0.9));
    const wor = 1 - (w1[i]! * 0.625 + w2[i]! * 0.25 + w3[i]! * 0.125);
    const base = Math.max(0, Math.min(1, per * 0.55 + wor * 0.65 - 0.2));
    data[i * 4] = Math.round(base * 255);
    data[i * 4 + 1] = Math.round((1 - w2[i]!) * 255);
    data[i * 4 + 2] = Math.round((1 - w3[i]!) * 255);
    data[i * 4 + 3] = Math.round(wor * 255);
  }
  const tex = new Data3DTexture(data, size, size, size);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.wrapR = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
