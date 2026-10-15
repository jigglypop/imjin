import { Data3DTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three/webgpu';

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

/** Side of the weather map in texels, and the ground it covers before it repeats, in metres. */
export const WEATHER_SIZE = 256;
export const WEATHER_SPAN = 72000;
/** Drift of the cloud layer in metres per second of battle time: the clouds and their shadows on the sea move together. */
export const CLOUD_WIND = { x: 9, y: 4 };

function perlin2(size: number, period: number, rand: () => number) {
  const g = new Float32Array(period * period * 2);
  for (let i = 0; i < period * period; i += 1) {
    const a = rand() * Math.PI * 2;
    g[i * 2] = Math.cos(a);
    g[i * 2 + 1] = Math.sin(a);
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const out = new Float32Array(size * size);
  const s = period / size;
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const px = x * s;
      const py = y * s;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const fx = px - x0;
      const fy = py - y0;
      let v = 0;
      for (let c = 0; c < 4; c += 1) {
        const dx = c & 1;
        const dy = c >> 1;
        const i = (((y0 + dy) % period) * period + ((x0 + dx) % period)) * 2;
        const dot = g[i]! * (fx - dx) + g[i + 1]! * (fy - dy);
        v += dot * (dx ? fade(fx) : 1 - fade(fx)) * (dy ? fade(fy) : 1 - fade(fy));
      }
      out[y * size + x] = v;
    }
  return out;
}

function worley2(size: number, cells: number, rand: () => number) {
  const pts = new Float32Array(cells * cells * 2);
  for (let i = 0; i < pts.length; i += 1) pts[i] = rand();
  const out = new Float32Array(size * size);
  const inv = cells / size;
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const px = (x + 0.5) * inv;
      const py = (y + 0.5) * inv;
      const cx = Math.floor(px);
      const cy = Math.floor(py);
      let best = 9;
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const o = ((((cy + dy + cells) % cells) * cells) + ((cx + dx + cells) % cells)) * 2;
          const fx = cx + dx + pts[o]! - px;
          const fy = cy + dy + pts[o + 1]! - py;
          best = Math.min(best, fx * fx + fy * fy);
        }
      out[y * size + x] = Math.min(1, Math.sqrt(best));
    }
  return out;
}

let weather: Uint8Array | null = null;

/**
 * Where the clouds are, over WEATHER_SPAN metres: red is the coverage field (billowing masses with gaps between,
 * from Perlin and Worley octaves), green a slower field that lifts or lowers the tops so the layer is not one height.
 * The sky's reflections and ambient light read the same numbers as the cloud shader. Made once and kept.
 */
export function weatherData() {
  if (weather) return weather;
  const size = WEATHER_SIZE;
  const rand = mulberry32(1592);
  const p4 = perlin2(size, 4, rand);
  const p8 = perlin2(size, 8, rand);
  const p16 = perlin2(size, 16, rand);
  const p32 = perlin2(size, 32, rand);
  const w6 = worley2(size, 6, rand);
  const w14 = worley2(size, 14, rand);
  const h3 = perlin2(size, 3, rand);
  const h7 = perlin2(size, 7, rand);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const fbm = p4[i]! * 0.5 + p8[i]! * 0.28 + p16[i]! * 0.14 + p32[i]! * 0.08;
    const cells = 1 - (w6[i]! * 0.65 + w14[i]! * 0.35);
    const cover = Math.max(0, Math.min(1, 0.5 + fbm * 1.25 + (cells - 0.5) * 0.55));
    const height = Math.max(0, Math.min(1, 0.5 + (h3[i]! * 0.7 + h7[i]! * 0.3) * 1.4));
    data[i * 4] = Math.round(cover * 255);
    data[i * 4 + 1] = Math.round(height * 255);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  weather = data;
  return data;
}

/**
 * Cover of the layer where the weather map reads `weather`: scattered clouds swing between gaps and masses, a deck only
 * thins. The cloud shader computes the same.
 */
export function coverAt(coverage: number, weather: number) {
  const deck = Math.min(1, Math.max(0, (coverage - 0.6) / 0.3));
  const spread = 1.1 - 0.6 * deck * deck * (3 - 2 * deck);
  return Math.min(1, Math.max(0, coverage + (weather - 0.5) * spread));
}

/** Bilinear lookup of one channel of the weather map at world (x, z), wrapping like the texture does. */
export function sampleWeather(x: number, z: number, channel: 0 | 1) {
  const data = weatherData();
  const size = WEATHER_SIZE;
  const u = (x / WEATHER_SPAN) * size - 0.5;
  const v = (z / WEATHER_SPAN) * size - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const at = (xx: number, yy: number) => data[((((yy % size) + size) % size) * size + (((xx % size) + size) % size)) * 4 + channel]! / 255;
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return top + (bottom - top) * fy;
}

let weatherTexture: DataTexture | null = null;

/**
 * The weather map as a texture, made once and shared: the clouds read where they are from it, and the sea the gusts,
 * wave groups and cloud shadows that keep it from repeating. Like the sea's detail textures, it is kept for the next battle.
 */
export function weatherMap() {
  if (weatherTexture) return weatherTexture;
  const tex = new DataTexture(weatherData(), WEATHER_SIZE, WEATHER_SIZE, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  // The sea reads the fields toward the horizon at a few metres a texel: mip levels keep them from shimmering there.
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  weatherTexture = tex;
  return tex;
}

let noiseTexture: Data3DTexture | null = null;

/**
 * The clouds' 3D noise (Perlin-Worley body in red, Worley detail octaves in green and blue), made once and shared like
 * the weather map: the cloud shader shapes the clouds from it and the cloud shadows on land and sea follow the same bodies.
 */
export function cloudNoise() {
  noiseTexture ??= createCloudNoise(64);
  return noiseTexture;
}

function createCloudNoise(size: number) {
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
