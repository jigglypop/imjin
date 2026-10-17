import koreaMeta from '../../select/demMeta.json';
import britainMeta from '../../select/britainMeta.json';
import mediterraneanMeta from '../../select/mediterraneanMeta.json';
import atlanticMeta from '../../select/atlanticMeta.json';
import { EXAGGERATION as KOREA_EXAGGERATION } from '../../select/demFrame';
import koreaFrame from './mapFrame.json';
import armadaFrame from './mapFrameArmada.json';
import lepantoFrame from './mapFrameLepanto.json';
import trafalgarFrame from './mapFrameTrafalgar.json';
import { mapTheatreId } from './theatreChoice';
import type { TheatreId } from '../../sim/grand/types';

// The world each campaign theatre's map draws: its DEM (heights, size, metres per texel), the frame its projection spans,
// the baked land facets, the flat map picture behind the menus, and whether a far land continues the DEM past its north
// edge (Korea's mainland does; Britain's frame holds the whole theatre). The map's modules read MAP when they are first
// evaluated, so the page draws the theatre theatreChoice.ts fixed. The 1592 entry is exactly the values the modules read
// before theatres existed (the select screen's DEM and demFrame.ts), so its map is unchanged.

type DemMeta = typeof koreaMeta;
type Frame = typeof koreaFrame;

export type MapTheatre = {
  id: TheatreId;
  meta: DemMeta;
  frame: Frame;
  /** The DEM picture (Terrarium-coded heights) and the land's facets (scripts/build-grand-terrain.mjs). */
  dem: string;
  land: string;
  /** The flat map behind the faction pick and the hub. */
  image: string;
  /** Vertical exaggeration of the relief: Britain's DEM is coarser, so its hills are raised more to read. */
  exaggeration: number;
  /** Whether the land goes on north of the DEM (farLand.ts). */
  farLand: boolean;
  /** When set, the map opens on this many of the player's ports nearest its seat rather than on all of them. */
  openOnSeat?: number;
};

const THEATRE_MAPS: Record<TheatreId, MapTheatre> = {
  imjin: { id: 'imjin', meta: koreaMeta, frame: koreaFrame, dem: '/ui/korea_dem.webp', land: '/ui/grand_terrain.bin', image: '/ui/grand_map.webp', exaggeration: KOREA_EXAGGERATION, farLand: true },
  armada: { id: 'armada', meta: britainMeta, frame: armadaFrame, dem: '/ui/britain_dem.webp', land: '/ui/grand_terrain_armada.bin', image: '/ui/map_channel.webp', exaggeration: 9, farLand: false, openOnSeat: 6 },
  // The Mediterranean's DEM is coarser still, but its mountains are high (the Pindus, the Apennines, the Alps in the north).
  lepanto: { id: 'lepanto', meta: mediterraneanMeta, frame: lepantoFrame, dem: '/ui/mediterranean_dem.webp', land: '/ui/grand_terrain_lepanto.bin', image: '/ui/map_mediterranean.webp', exaggeration: 7, farLand: false, openOnSeat: 6 },
  // The Atlantic world's DEM is the coarsest (1.5 km a texel); the Pyrenees, the Alps and the Sierra Nevada carry its relief.
  trafalgar: { id: 'trafalgar', meta: atlanticMeta, frame: trafalgarFrame, dem: '/ui/atlantic_dem.webp', land: '/ui/grand_terrain_trafalgar.bin', image: '/ui/map_atlantic.webp', exaggeration: 7, farLand: false, openOnSeat: 6 },
};

export const MAP: MapTheatre = THEATRE_MAPS[mapTheatreId()];
export const demMeta: DemMeta = MAP.meta;

/** Width of the terrain in map units, as the select screen's (demFrame.ts); the height follows from the DEM's aspect. */
export const MAP_W = 100;
export const MAP_H = (MAP_W * demMeta.height) / demMeta.width;
/** Map units of height per metre of elevation (demFrame.ts's formula with the theatre's DEM). */
export const V_SCALE = (MAP.exaggeration * MAP_W) / (demMeta.width * demMeta.metersPerPixel);

/** Metres at a point of the DEM, u to the east and v to the south, both 0..1. */
export function demHeightAtUV(heights: Float32Array, u: number, v: number) {
  const x = Math.max(0, Math.min(demMeta.width - 1, Math.round(u * (demMeta.width - 1))));
  const y = Math.max(0, Math.min(demMeta.height - 1, Math.round(v * (demMeta.height - 1))));
  return heights[y * demMeta.width + x]!;
}
