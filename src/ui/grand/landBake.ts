// The light and the lie of the campaign world's land, baked once from the DEM into one RGBA texel per DEM texel, for the
// land's shader (landLook.ts) to read: the sun on the ground with the shadows the hills cast, the sky's light with the
// shade of the valleys (ambient occlusion), the slope and the height. The drawn facets stay coarse, but the light and the
// country they show come from this, so the hills read smooth and round. Pure arithmetic over arrays (no three.js, no
// DOM), so it runs in a worker (landBake.worker.ts) or, without one, on the page.

import demMeta from '../../select/demMeta.json';
import { V_SCALE } from '../../select/demFrame';
import { SHADE_SLOPE, SUN_DIRECTION } from './groundPalette';
import { DEM_RECT, MESH_SCALE } from './mapMath';
import { MAP_ASPECT } from './projection';

/** What the bake needs to know of the drawn world. */
export interface BakeFrame {
  /** The DEM's texels across and down. */
  width: number;
  height: number;
  /** World units between neighbouring texels east-west and north-south. */
  dx: number;
  dz: number;
  /** World units of height per metre as drawn (the relief is exaggerated). */
  lift: number;
  /** Towards the sun: x east, y up, z south. */
  sun: readonly [number, number, number];
  /** The share of the drawn slope the light reads (groundPalette's SHADE_SLOPE): drawn at full steepness every far side would go dark. */
  shadeSlope: number;
}

/** The campaign world's frame for the DEM's texels, as groundLand.ts lays its vertices. */
export function landFrame(): BakeFrame {
  return {
    width: demMeta.width,
    height: demMeta.height,
    dx: DEM_RECT.w / (demMeta.width - 1),
    dz: DEM_RECT.h / (demMeta.height - 1) / MAP_ASPECT,
    lift: V_SCALE * MESH_SCALE,
    sun: SUN_DIRECTION,
    shadeSlope: SHADE_SLOPE,
  };
}

/** The slope channel holds the drawn slope (rise over run) over this. */
export const SLOPE_RANGE = 3;
/** The height channel holds sqrt(metres / HEIGHT_RANGE), finer on the low ground where farms, beaches and woods part. */
export const HEIGHT_RANGE = 2000;

/** A binomial blur of five taps along both axes, twice: about the TIN builder's blur, so slopes agree with the facets. */
function blur(src: Float32Array, w: number, h: number) {
  const a = Float32Array.from(src), b = new Float32Array(w * h);
  const K = [1, 4, 6, 4, 1];
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      let s = 0;
      for (let k = -2; k <= 2; k += 1) s += a[y * w + Math.min(w - 1, Math.max(0, x + k))]! * K[k + 2]!;
      b[y * w + x] = s / 16;
    }
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      let s = 0;
      for (let k = -2; k <= 2; k += 1) s += b[Math.min(h - 1, Math.max(0, y + k)) * w + x]! * K[k + 2]!;
      a[y * w + x] = s / 16;
    }
  }
  return a;
}

/**
 * Bakes the land's texture from the DEM's metres (row-major, north row first, sea negative). Red: the sun's light on the
 * ground, its shadows softened at their edges; green: the sky's light, less in the folds of the land; blue: the slope
 * over SLOPE_RANGE; alpha: sqrt of the height over HEIGHT_RANGE.
 */
export function bakeLand(metres: Float32Array, f: BakeFrame): Uint8Array {
  const { width: w, height: h, dx, dz, lift, shadeSlope } = f;
  const out = new Uint8Array(w * h * 4);
  // Land only: the sea floor neither casts shade on the land nor shows.
  const dry = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) dry[i] = Math.max(0, metres[i]!);
  const ground = blur(dry, w, h);
  // Heights as the light reads them, in world units: the drawn relief flattened like the light's normal.
  const y = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) y[i] = ground[i]! * lift * shadeSlope;
  const at = (x: number, z: number) => y[Math.min(h - 1, Math.max(0, z)) * w + Math.min(w - 1, Math.max(0, x))]!;
  // Bilinear, for the rays, which step between texels.
  const sample = (x: number, z: number) => {
    const cx = Math.min(w - 1.001, Math.max(0, x)), cz = Math.min(h - 1.001, Math.max(0, z));
    const x0 = cx | 0, z0 = cz | 0, fx = cx - x0, fz = cz - z0, k = z0 * w + x0;
    const top = y[k]! + (y[k + 1]! - y[k]!) * fx, bottom = y[k + w]! + (y[k + w + 1]! - y[k + w]!) * fx;
    return top + (bottom - top) * fz;
  };
  const [sx, sy, sz] = f.sun;
  const across = Math.hypot(sx, sz);
  // The sun's way across the texel grid, one texel's length a step, and how much a ray climbs each step.
  const stepX = sx / across / dx * Math.min(dx, dz), stepZ = sz / across / dz * Math.min(dx, dz);
  const climb = (sy / across) * Math.min(dx, dz);
  // The horizon is looked for along eight ways, a texel and then farther and farther out, up to about 5 km: whole texel
  // offsets and their distances, worked out once.
  const unit = Math.min(dx, dz);
  const ways: { di: number; dist: number; ox: number; oz: number }[][] = [];
  for (let k = 0; k < 8; k += 1) {
    const ex = Math.cos((k / 8) * Math.PI * 2), ez = Math.sin((k / 8) * Math.PI * 2);
    ways.push([1, 2, 4, 7, 12, 20, 32].map((r) => {
      const ox = Math.round((ex * r * unit) / dx), oz = Math.round((ez * r * unit) / dz);
      return { di: oz * w + ox, dist: Math.hypot(ox * dx, oz * dz), ox, oz };
    }));
  }
  const MARGIN = 34;
  for (let z = 0; z < h; z += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = z * w + x, o = i * 4;
      const ht = y[i]!;
      // The drawn slope (unflattened) and the normal the light reads.
      const gx = (at(x + 1, z) - at(x - 1, z)) / (2 * dx), gz = (at(x, z + 1) - at(x, z - 1)) / (2 * dz);
      const slope = Math.hypot(gx, gz) / shadeSlope;
      const len = Math.hypot(gx, 1, gz);
      const nx = -gx / len, ny = 1 / len, nz = -gz / len;
      let sun = Math.max(0, nx * sx + ny * sy + nz * sz);
      let sky = 0.75 + 0.25 * ny;
      // Only land and the texels next to it are ever seen; open water keeps the light of flat ground.
      if (ground[i]! > 0.5) {
        // Shadow: march towards the sun; the nearest a hill comes to blocking the ray, against how far off it is, softens
        // the shadow's edge (a penumbra that widens with distance).
        if (sun > 0) {
          let lit = 1;
          for (let s = 1, t = 1; s <= 24 && lit > 0; s += 1) {
            const clearance = ht + climb * t - sample(x + stepX * t, z + stepZ * t);
            lit = Math.min(lit, Math.max(0, Math.min(1, 0.5 + clearance / (climb * t * 0.35))));
            t += s < 8 ? 1 : s < 16 ? 2 : 4;
          }
          sun *= lit;
        }
        // Sky light: how much of the sky the ground sees, from the steepest horizon along each way.
        const inside = x >= MARGIN && z >= MARGIN && x < w - MARGIN && z < h - MARGIN;
        let open = 0;
        for (const way of ways) {
          let horizon = 0;
          for (const step of way) {
            const above = (inside ? y[i + step.di]! : at(x + step.ox, z + step.oz)) - ht;
            if (above > 0) {
              const sine = above / Math.sqrt(above * above + step.dist * step.dist);
              if (sine > horizon) horizon = sine;
            }
          }
          open += 1 - horizon;
        }
        sky *= 0.35 + 0.65 * (open / 8);
      }
      out[o] = Math.round(Math.min(1, sun) * 255);
      out[o + 1] = Math.round(Math.min(1, sky) * 255);
      out[o + 2] = Math.round(Math.min(1, slope / SLOPE_RANGE) * 255);
      out[o + 3] = Math.round(Math.sqrt(Math.min(1, ground[i]! / HEIGHT_RANGE)) * 255);
    }
  }
  return out;
}
