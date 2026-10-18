import type { TerrainSpec } from './generate';
import { GREEK_BIOME, MAGHREB_BIOME } from './region';

// The coasts of the Lepanto chapter. Heights in round figures from the real relief: the hills of Preveza and Actium
// about 100-200 m, the Aetolian mountains above the Curzolari (Echinades) 600-900 m, Point Scrofa and the lagoons of
// Mesolongi low and marshy, the Peloponnese shore near Cape Papas 150-300 m, Djerba flat (under 55 m). The League sails
// east (+x) into the Gulf of Patras in the three Lepanto battles, the Aetolian shore to the north (-z).
// Each battle is fought on its real coast: a 20 km square of Terrarium elevation around the place named in
// src/terrain/battleWindows.json (node scripts/fetch-region-dem.mjs --windows=src/terrain/battleWindows.json), north up.

/** The mouth of the Gulf of Arta at Preveza, 28 September 1538: the strait narrow, Actium's point to the south. */
export const PREVEZA_TERRAIN: TerrainSpec = { size: 20000, res: 2048, seed: 1538, shapes: [], channels: [], region: { id: 'battle-preveza', biome: GREEK_BIOME } };

/** Off Djerba's north-west point, May 1560: the low island to the south, the shallow flats of the Gulf of Gabès. */
export const DJERBA_TERRAIN: TerrainSpec = { size: 20000, res: 2048, seed: 1560, shapes: [], channels: [], region: { id: 'battle-djerba', biome: MAGHREB_BIOME } };

/** The northern wing, 7 October 1571: the Aetolian shore and the Mesolongi shallows close to the north, the Curzolari to the west. */
export const NORTH_TERRAIN: TerrainSpec = { size: 20000, res: 2048, seed: 1571, shapes: [], channels: [], region: { id: 'battle-lepanto-north', biome: GREEK_BIOME } };

/** The centre, 7 October 1571: open water, the Aetolian mountains far to the north, the Peloponnese far to the south. */
export const CENTRE_TERRAIN: TerrainSpec = { size: 20000, res: 2048, seed: 1572, shapes: [], channels: [], region: { id: 'battle-lepanto-centre', biome: GREEK_BIOME } };

/** The southern wing, 7 October 1571: open sea towards Cape Papas and the Peloponnese to the south. */
export const SOUTH_TERRAIN: TerrainSpec = { size: 20000, res: 2048, seed: 1573, shapes: [], channels: [], region: { id: 'battle-lepanto-south', biome: GREEK_BIOME } };
