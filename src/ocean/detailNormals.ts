import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three/webgpu';

const SIZE = 256;
const WAVES = 110;

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

export function createDetailNormalTexture(windAngle: number, seed = 7) {
  const rand = mulberry32(seed);
  const fx = new Float32Array(WAVES);
  const fz = new Float32Array(WAVES);
  const amp = new Float32Array(WAVES);
  const phase = new Float32Array(WAVES);
  const wx = Math.cos(windAngle);
  const wz = Math.sin(windAngle);
  for (let i = 0; i < WAVES; i += 1) {
    let x = 0;
    let z = 0;
    while (x === 0 && z === 0) {
      const r = 1 + Math.floor(Math.pow(rand(), 1.6) * 22);
      const a = rand() * Math.PI * 2;
      x = Math.round(Math.cos(a) * r);
      z = Math.round(Math.sin(a) * r);
    }
    const len = Math.hypot(x, z);
    const align = Math.abs((x * wx + z * wz) / len);
    fx[i] = x;
    fz[i] = z;
    amp[i] = (0.35 + 0.65 * align * align) / Math.pow(len, 1.7);
    phase[i] = rand() * Math.PI * 2;
  }
  const sx = new Float32Array(SIZE * SIZE);
  const sz = new Float32Array(SIZE * SIZE);
  const h = new Float32Array(SIZE * SIZE);
  let maxSlope = 1e-6;
  let maxH = 1e-6;
  const twoPi = Math.PI * 2;
  for (let y = 0; y < SIZE; y += 1) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x += 1) {
      const u = x / SIZE;
      let hh = 0;
      let dx = 0;
      let dz = 0;
      for (let i = 0; i < WAVES; i += 1) {
        const th = twoPi * (fx[i]! * u + fz[i]! * v) + phase[i]!;
        const a = amp[i]!;
        hh += a * Math.sin(th);
        const c = a * twoPi * Math.cos(th);
        dx += c * fx[i]!;
        dz += c * fz[i]!;
      }
      const idx = y * SIZE + x;
      sx[idx] = dx;
      sz[idx] = dz;
      h[idx] = hh;
      maxSlope = Math.max(maxSlope, Math.abs(dx), Math.abs(dz));
      maxH = Math.max(maxH, Math.abs(hh));
    }
  }
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    data[i * 4] = Math.round((sx[i]! / maxSlope) * 127.5 + 127.5);
    data[i * 4 + 1] = Math.round((sz[i]! / maxSlope) * 127.5 + 127.5);
    data[i * 4 + 2] = Math.round((h[i]! / maxH) * 127.5 + 127.5);
    data[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function worleyBorder(size: number, cells: number, rand: () => number) {
  const points = new Float32Array(cells * cells * 2);
  for (let i = 0; i < points.length; i += 1) points[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * cells;
      const v = (y / size) * cells;
      const cu = Math.floor(u);
      const cv = Math.floor(v);
      let d1 = 9;
      let d2 = 9;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const gx = (cu + ox + cells) % cells;
          const gy = (cv + oy + cells) % cells;
          const p = (gy * cells + gx) * 2;
          const d = Math.hypot(u - (cu + ox + points[p]!), v - (cv + oy + points[p + 1]!));
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
      }
      const e = Math.min(1, (d2 - d1) / 0.42);
      out[y * size + x] = 1 - e * e * (3 - 2 * e);
    }
  }
  return out;
}

function valueNoise(size: number, cells: number, rand: () => number) {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * cells;
      const v = (y / size) * cells;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const fx = u - x0;
      const fy = v - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const g = (gx: number, gy: number) => grid[((gy + cells) % cells) * cells + ((gx + cells) % cells)]!;
      const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
      const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

export function createFoamTexture(seed = 11) {
  const rand = mulberry32(seed);
  const size = 512;
  const big = worleyBorder(size, 9, rand);
  const mid = worleyBorder(size, 23, rand);
  const fine = worleyBorder(size, 57, rand);
  const n1 = valueNoise(size, 8, rand);
  const n2 = valueNoise(size, 32, rand);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const breakup = n1[i]! * 0.6 + n2[i]! * 0.4;
    let v = big[i]! * 0.42 + mid[i]! * 0.36 + fine[i]! * 0.22;
    v = v * (0.55 + breakup * 0.7) + (breakup - 0.5) * 0.25;
    v = Math.min(1, Math.max(0, v));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.round(v * 255);
    data[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
