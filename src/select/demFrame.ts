import meta from './demMeta.json';

// What the select screen and the campaign map both know about the DEM without loading three.js: its size in map units,
// the vertical scale and the fog colour. The mesh and its material are in terrain.ts.

/** Width of the terrain in map units (one unit is about 3.3 km); the height follows from the DEM's aspect. */
export const MAP_W = 100;
export const MAP_H = (MAP_W * meta.height) / meta.width;
/** The fog the map fades into at its edge; the screen's CSS veil (.hs-vignette) uses the same colour. */
export const MIST_HEX = '#0d1217';
/** Vertical exaggeration that makes the coast's ridges read at map scale. */
export const EXAGGERATION = 4.2;
/** Map units of height per metre of elevation. */
export const V_SCALE = (EXAGGERATION * MAP_W) / (meta.width * meta.metersPerPixel);

/** Metres at a point of the DEM, u to the east and v to the south, both 0..1. */
export function demHeightAtUV(heights: Float32Array, u: number, v: number) {
  const x = Math.max(0, Math.min(meta.width - 1, Math.round(u * (meta.width - 1))));
  const y = Math.max(0, Math.min(meta.height - 1, Math.round(v * (meta.height - 1))));
  return heights[y * meta.width + x]!;
}
