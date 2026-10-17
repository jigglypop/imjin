import type { TerrainSpec } from './generate';
import { GREEK_BIOME, MAGHREB_BIOME } from './region';

// The coasts of the Trafalgar chapter. Heights in round figures from the real relief: the cliffs of Cape St Vincent
// about 60-75 m with the Algarve hills behind, the Abu Qir peninsula and the Nile delta under 15 m, the low sandstone
// point of Cape Trafalgar about 20 m with the Andalusian hills of La Breña and the Sierra de la Plata (300-450 m) behind.
// North is -z, east +x. The Andalusian and Algarve shores take the Mediterranean dressing (rubble and whitewash under
// red tile, olive and pine scrub); Abu Qir the North African one.

/** Off Cape St Vincent, 14 February 1797: open Atlantic, the cape and the Algarve hills far off to the north-east. */
export const ST_VINCENT_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1797,
  shapes: [
    { x: 9200, z: -8200, rx: 6000, rz: 3200, rot: 0.25, peak: 180, rough: 1 },
    { x: 5600, z: -7400, rx: 1400, rz: 900, rot: 0.1, peak: 70, rough: 0.8 },
  ],
  channels: [],
  biome: GREEK_BIOME,
};

/**
 * Abu Qir Bay, 1 August 1798: the French line at anchor across the bay, Abu Qir point and its castle to the north-west
 * with the island beyond, the shoals inshore, the flat delta shore around the bay to the south and west.
 */
export const NILE_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1798,
  shapes: [
    { x: -5200, z: -2200, rx: 3200, rz: 900, rot: 0.5, peak: 14, rough: 0.4 },
    { x: -3000, z: -3600, rx: 380, rz: 240, rot: 0.3, peak: 7, rough: 0.4 },
    { x: -4200, z: 7800, rx: 11000, rz: 4400, rot: -0.35, peak: 9, rough: 0.35 },
    { x: -1700, z: 1900, rx: 1600, rz: 500, rot: 0.75, peak: 1, rough: 0.3 },
  ],
  channels: [],
  biome: MAGHREB_BIOME,
};

/** The fog bank off Cape Finisterre, 22 July 1805: about a hundred miles out in the Atlantic, no land in sight. */
export const FINISTERRE_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1805,
  shapes: [],
  channels: [],
  biome: GREEK_BIOME,
};

/** Off Cape Trafalgar, 21 October 1805: the low cape some 20 km east-south-east, the hills of La Breña behind it. */
export const TRAFALGAR_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1806,
  shapes: [
    { x: 12600, z: 1200, rx: 4200, rz: 7600, rot: 0.1, peak: 380, rough: 1 },
    { x: 9300, z: 3400, rx: 1000, rz: 600, rot: 0.2, peak: 22, rough: 0.6 },
  ],
  channels: [],
  biome: GREEK_BIOME,
};

/** The same sea further south for Collingwood's lee column: the cape a little nearer, to the east. */
export const TRAFALGAR_LEE_TERRAIN: TerrainSpec = {
  ...TRAFALGAR_TERRAIN,
  seed: 1807,
  shapes: [
    { x: 12000, z: -800, rx: 4200, rz: 7600, rot: 0.1, peak: 380, rough: 1 },
    { x: 8800, z: 1300, rx: 1000, rz: 600, rot: 0.2, peak: 22, rough: 0.6 },
  ],
};
