import { demMeta } from './mapTheatre';
import { demHeightAtUV, MAP_W, V_SCALE } from './mapTheatre';
import { project } from './projection';

// The campaign map is the select screen's terrain placed inside the campaign frame (mapFrame.json), which reaches
// further than the DEM so the off-map ports stand in the haze beyond its edge. No three.js here: phones read this too.
// The camera that looks at it is worldCamera.ts.

const nw = project(demMeta.bounds.west, demMeta.bounds.north);
const se = project(demMeta.bounds.east, demMeta.bounds.south);
/** The DEM's rectangle in frame coordinates (u east, v south, both 0..1 over the whole frame). */
export const DEM_RECT = { u: nw.u, v: nw.v, w: se.u - nw.u, h: se.v - nw.v };
/** Frame units per map unit of the terrain mesh, east-west. */
export const MESH_SCALE = DEM_RECT.w / MAP_W;

/** Height of the ground at a frame point, in frame units (the unit the projection and the camera use). */
export function groundElevation(heights: Float32Array, u: number, v: number) {
  const lu = (u - DEM_RECT.u) / DEM_RECT.w;
  const lv = (v - DEM_RECT.v) / DEM_RECT.h;
  if (lu < 0 || lu > 1 || lv < 0 || lv > 1) return 0;
  return Math.max(0, demHeightAtUV(heights, lu, lv)) * V_SCALE * MESH_SCALE;
}
