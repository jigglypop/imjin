import type { TerrainSpec } from './generate';
import { GREEK_BIOME, MAGHREB_BIOME } from './region';

// The coasts of the Trafalgar chapter. Heights in round figures from the real relief: the cliffs of Cape St Vincent
// about 60-75 m with the Algarve hills behind, the Abu Qir peninsula and the Nile delta under 15 m, the low sandstone
// point of Cape Trafalgar about 20 m with the Andalusian hills of La Breña and the Sierra de la Plata (300-450 m) behind.
// North is -z, east +x. The Andalusian and Algarve shores take the Mediterranean dressing (rubble and whitewash under
// red tile, olive and pine scrub); Abu Qir the North African one.
// Each battle is fought on its real coast: a 20 km square of Terrarium elevation around the place named in
// src/terrain/battleWindows.json (node scripts/fetch-region-dem.mjs --windows=src/terrain/battleWindows.json), north up.

/** Off Cape St Vincent, 14 February 1797: open Atlantic, the cape and the Algarve hills far off to the north-east. */
export const ST_VINCENT_TERRAIN: TerrainSpec = { size: 20000, res: 2048, seed: 1797, shapes: [], channels: [], region: { id: 'battle-st-vincent', biome: GREEK_BIOME } };

/**
 * Abu Qir Bay, 1 August 1798: the French line at anchor across the bay, Abu Qir point and its castle to the north-west
 * with the island beyond, the shoals inshore, the flat delta shore around the bay to the south and west.
 */
export const NILE_TERRAIN: TerrainSpec = { size: 20000, res: 2048, seed: 1798, shapes: [], channels: [], region: { id: 'battle-nile', biome: MAGHREB_BIOME } };

/** The fog bank off Cape Finisterre, 22 July 1805: about a hundred miles out in the Atlantic, no land in sight. */
export const FINISTERRE_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1805,
  shapes: [],
  channels: [],
  biome: GREEK_BIOME,
};

/** Off Cape Trafalgar, 21 October 1805: the low cape some 10 km east, the hills of La Breña behind it. */
export const TRAFALGAR_TERRAIN: TerrainSpec = { size: 20000, res: 2048, seed: 1806, shapes: [], channels: [], region: { id: 'battle-trafalgar-weather', biome: GREEK_BIOME } };

/** The same sea further south for Collingwood's lee column: the cape a little nearer, to the east. */
export const TRAFALGAR_LEE_TERRAIN: TerrainSpec = { ...TRAFALGAR_TERRAIN, seed: 1807, region: { id: 'battle-trafalgar-lee', biome: GREEK_BIOME } };
