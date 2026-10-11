import meta from './reliefMeta.json';
import { MAP_ASPECT } from './projection';

/** Cartographic vertical exaggeration makes the real south-coast ridges legible at campaign-map scale. */
export const RELIEF_EXAGGERATION = 20;
export const RELIEF_TILT = Math.PI / 4;
export const RELIEF_META = meta;

export type ReliefPose = { tilt: number; yaw: number };
export type ReliefView = { s: number; x: number; y: number };

export function decodeRelief(buffer: ArrayBuffer) {
  if (buffer.byteLength !== meta.width * meta.height * 2) throw new Error('Invalid relief elevation data');
  const view = new DataView(buffer);
  const heights = new Float32Array(meta.width * meta.height);
  for (let i = 0; i < heights.length; i++) heights[i] = view.getUint16(i * 2, true);
  return heights;
}

export function reliefHeight(heights: Float32Array, u: number, v: number) {
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const x = u * (meta.width - 1), y = v * (meta.height - 1);
  const ix = Math.min(meta.width - 2, Math.floor(x)), iy = Math.min(meta.height - 2, Math.floor(y));
  const ax = x - ix, ay = y - iy, k = iy * meta.width + ix;
  return ((heights[k]! * (1 - ax) + heights[k + 1]! * ax) * (1 - ay) + (heights[k + meta.width]! * (1 - ax) + heights[k + meta.width + 1]! * ax) * ay) * RELIEF_EXAGGERATION / meta.metersAcross;
}

/** The mesh and the DOM markers share this orthographic projection, including the actual elevation. */
export function reliefProject(u: number, v: number, elevation: number, { tilt, yaw }: ReliefPose) {
  const x = u - 0.5, z = (v - 0.5) / MAP_ASPECT;
  const rx = Math.cos(yaw) * x + Math.sin(yaw) * z;
  const rz = -Math.sin(yaw) * x + Math.cos(yaw) * z;
  return { u: rx + 0.5, v: (Math.cos(tilt) * rz - Math.sin(tilt) * elevation) * MAP_ASPECT + 0.5 };
}

/** Off-centre camera bounds put the map at the same pan/zoom offset used by the HTML and SVG layers. */
export function reliefFrustum(view: ReliefView, width: number, height: number) {
  const cx = view.x + view.s / 2, cy = view.y + view.s / MAP_ASPECT / 2;
  return { left: -cx / view.s, right: (width - cx) / view.s, top: cy / view.s, bottom: -(height - cy) / view.s };
}
