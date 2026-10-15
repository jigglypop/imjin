import demMeta from '../../../select/demMeta.json';
import { V_SCALE } from '../../../select/demFrame';
import { DEM_RECT, MESH_SCALE } from '../mapMath';
import { MAP_ASPECT } from '../projection';
import type { FactionId } from '../types';

// The hero camps of the campaign map: Yeosu (Joseon), Busan (the Japanese wajo) and Gogeumdo (Chen Lin's Ming fortress)
// built at their true sizes from the layouts the painted targets were made from (layouts.ts), each in its own frame:
// model metres, x east, z south, y up, the origin at the frame point (u, v) where the old layout centred the camp, the
// sea plane at y = 0. A model metre is MODEL_METRE frame units across and up, so a 22 m warship on the map is 22 model
// metres long. No three.js here: the land's builder (groundLand.ts) reads the pads from it before anything is drawn.

/** Frame units in one model metre (a settlement radius, 0.013, is 40 model metres). */
export const MODEL_METRE = 0.013 / 40;

export interface HeroSite {
  /** The region the camp stands in. */
  id: string;
  /** The navy whose camp the layout is. */
  navy: FactionId;
  /** The frame point of the camp's origin. */
  u: number;
  v: number;
  /** Half the side of the square round the origin whose ground is drawn smooth and textured (ground.ts), model metres. */
  reach: number;
}

export const HERO_SITES: readonly HeroSite[] = [
  { id: 'yeosu', navy: 'joseon', u: 0.5233295354416246, v: 0.34093292027037536, reach: 150 },
  { id: 'busan', navy: 'japan', u: 0.7565648604418527, v: 0.21528296076841147, reach: 140 },
  { id: 'gogeumdo', navy: 'ming', u: 0.36345745303444416, v: 0.4793648347820284, reach: 140 },
];

export const heroSite = (id: string) => HERO_SITES.find((s) => s.id === id) ?? null;

/** The frame point of a point of a site's frame. */
export const siteUV = (s: HeroSite, x: number, z: number) => ({ u: s.u + x * MODEL_METRE, v: s.v + z * MODEL_METRE * MAP_ASPECT });

/** A frame point in a site's frame (model metres). */
export const siteXZ = (s: HeroSite, u: number, v: number) => ({ x: (u - s.u) / MODEL_METRE, z: (v - s.v) / (MODEL_METRE * MAP_ASPECT) });

/** Model metres per metre of the DEM's elevation as drawn (the relief's exaggeration included). */
export const ELEVATION_MODEL = (V_SCALE * MESH_SCALE) / MODEL_METRE;

/**
 * The DEM's metres at a frame point, bilinear between its texels and not clamped at the sea plane: a shore dives under
 * the sea instead of stopping at its edge.
 */
export function rawMetres(heights: Float32Array, u: number, v: number) {
  const W = demMeta.width, H = demMeta.height;
  const x = Math.max(0, Math.min(W - 1.001, ((u - DEM_RECT.u) / DEM_RECT.w) * (W - 1)));
  const y = Math.max(0, Math.min(H - 1.001, ((v - DEM_RECT.v) / DEM_RECT.h) * (H - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const at = (i: number, j: number) => heights[j * W + i]!;
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx, bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return top + (bottom - top) * fy;
}

/** Whether the campaign map draws the hero camps: `?hero=1` while they are built, `?hero=0` shows the old kits. */
export function heroEnabled() {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('hero') === '1';
}
