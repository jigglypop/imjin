import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three/webgpu';
import { dot, float, max, sqrt, texture, vec4 } from 'three/tsl';

/** Cells along the tile's edge for the first octave; each following octave doubles it, so the tile repeats seamlessly. */
const TILE = 128;
const BASE_CELLS = 4;
const OCTAVES = 5;

function hash(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const quintic = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Four unrelated tileable fractal-noise fields, one per channel, each with mean 0.5 and a spread like Perlin fractal noise. */
function build() {
  const data = new Uint8Array(TILE * TILE * 4);
  const field = new Float32Array(TILE * TILE);
  for (let channel = 0; channel < 4; channel += 1) {
    field.fill(0);
    for (let octave = 0; octave < OCTAVES; octave += 1) {
      const cells = BASE_CELLS << octave;
      const gain = 0.55 ** octave;
      for (let y = 0; y < TILE; y += 1) {
        for (let x = 0; x < TILE; x += 1) {
          const fx = (x / TILE) * cells;
          const fy = (y / TILE) * cells;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const tx = quintic(fx - x0);
          const ty = quintic(fy - y0);
          const seed = channel * 31 + octave;
          const a = hash(x0 % cells, y0 % cells, seed);
          const b = hash((x0 + 1) % cells, y0 % cells, seed);
          const c = hash(x0 % cells, (y0 + 1) % cells, seed);
          const d = hash((x0 + 1) % cells, (y0 + 1) % cells, seed);
          const v = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
          field[y * TILE + x]! += (v - 0.5) * gain;
        }
      }
    }
    let sum = 0;
    for (const v of field) sum += v;
    const mean = sum / field.length;
    let variance = 0;
    for (const v of field) variance += (v - mean) ** 2;
    // Perlin fractal noise of this kind has a standard deviation near 0.32 on a -1..1 scale, 0.16 on 0..1.
    const k = 0.16 / Math.sqrt(variance / field.length);
    for (let i = 0; i < field.length; i += 1) data[i * 4 + channel] = Math.max(0, Math.min(255, Math.round((0.5 + (field[i]! - mean) * k) * 255)));
  }
  const tex = new DataTexture(data, TILE, TILE, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

let shared: DataTexture | null = null;

/**
 * Smoke and spray shade a soft puff from noise. Computing several octaves of 3D noise for every pixel of thousands of
 * overlapping sprites was most of the frame in a big fight; one texture read gives the same look for a fraction of it.
 */
export function particleNoise() {
  shared ??= build();
  return shared;
}

/** Noise in about -1..1 at `coord` (in noise units, four per tile), evolving as `age` goes from 0 to 1 by fading between its four fields. */
export function puffNoise(coord: any, age: any, evolve: number): any {
  const phase = age.mul(evolve);
  const weights = vec4(max(float(1).sub(phase.abs()), 0), max(float(1).sub(phase.sub(1).abs()), 0), max(float(1).sub(phase.sub(2).abs()), 0), max(float(1).sub(phase.sub(3).abs()), 0));
  const sample = texture(particleNoise(), coord.div(BASE_CELLS));
  // Fading between two independent fields lowers the contrast halfway; dividing by the weights' length keeps it.
  return dot(sample, weights).sub(0.5).div(sqrt(dot(weights, weights))).mul(2);
}
