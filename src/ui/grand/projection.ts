import frame from './mapFrame.json';

// The campaign frame (mapFrame.json) is the select screen's Web Mercator DEM window widened to hold the off-map ports. It is
// the same projection as siteUV in src/select/SelectScene.ts (lon/lat to tile x/y), normalised to the wider frame; mapMath.ts
// places the DEM inside it.
const lonToX = (lon: number) => ((lon + 180) / 360) * 2 ** frame.zoom;
const latToY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** frame.zoom;
};

const x0 = lonToX(frame.west);
const x1 = lonToX(frame.east);
const y0 = latToY(frame.north);
const y1 = latToY(frame.south);

/** Width / height of the frame. */
export const MAP_ASPECT = (x1 - x0) / (y1 - y0);
export const MAP_IMAGE = '/ui/grand_map.webp';

/** Position in the map frame, both 0..1 (u to the east, v to the south). */
export function project(lon: number, lat: number) {
  return { u: (lonToX(lon) - x0) / (x1 - x0), v: (latToY(lat) - y0) / (y1 - y0) };
}
