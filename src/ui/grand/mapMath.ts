import demMeta from '../../select/demMeta.json';
import { demHeightAtUV, MAP_W, V_SCALE } from '../../select/demFrame';
import { MAP_ASPECT, project } from './projection';

// The campaign map is the select screen's terrain placed inside the campaign frame (mapFrame.json), which reaches
// further than the DEM so the off-map ports stand in the mist beyond its edge. No three.js here: phones read this too.

export type MapPose = { tilt: number; yaw: number };
export type MapView = { s: number; x: number; y: number };

/** The select screen looks at the map from 0.86 rad above the horizon; the tilt here is measured from straight down. */
export const MAP_TILT = Math.PI / 2 - 0.86;

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

/** The mesh and the DOM markers share this orthographic projection, including the actual elevation. */
export function mapProject(u: number, v: number, elevation: number, { tilt, yaw }: MapPose) {
  const x = u - 0.5, z = (v - 0.5) / MAP_ASPECT;
  const rx = Math.cos(yaw) * x + Math.sin(yaw) * z;
  const rz = -Math.sin(yaw) * x + Math.cos(yaw) * z;
  return { u: rx + 0.5, v: (Math.cos(tilt) * rz - Math.sin(tilt) * elevation) * MAP_ASPECT + 0.5 };
}

/** Off-centre camera bounds put the map at the same pan/zoom offset used by the HTML and SVG layers. */
export function mapFrustum(view: MapView, width: number, height: number) {
  const cx = view.x + view.s / 2, cy = view.y + view.s / MAP_ASPECT / 2;
  return { left: -cx / view.s, right: (width - cx) / view.s, top: cy / view.s, bottom: -(height - cy) / view.s };
}
