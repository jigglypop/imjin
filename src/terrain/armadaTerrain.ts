import type { TerrainSpec } from './generate';
import { ENGLISH_BIOME, FLEMISH_BIOME } from './region';

// The coasts of the Armada's running fight up the Channel, July–August 1588. Each battle's shore is to the north of
// its map (negative z) except Calais and Gravelines, where the Flemish and French coast lies to the south of the
// anchorage and the battle; heights are the real ones in round figures (the Devon cliffs about 100 m, Portland 150 m,
// the Isle of Wight's downs 240 m, Cap Blanc-Nez 130 m, the Flemish dunes about 15 m).
// Each battle is fought on its real coast: a 20 km square of Terrarium elevation around the place named in
// src/terrain/battleWindows.json (node scripts/fetch-region-dem.mjs --windows=src/terrain/battleWindows.json), north up.

/** Off Plymouth, 31 July: Rame Head and the Sound to the north, the Eddystone reef offshore. */
export const PLYMOUTH_TERRAIN: TerrainSpec = { size: 20000, res: 2048, seed: 1588, shapes: [], channels: [], region: { id: 'battle-plymouth', biome: ENGLISH_BIOME } };

/** Off Portland Bill, 2 August: the long limestone tongue running south, the Shambles bank east of it. */
export const PORTLAND_TERRAIN: TerrainSpec = { size: 20000, res: 2048, seed: 1589, shapes: [], channels: [], region: { id: 'battle-portland', biome: ENGLISH_BIOME } };

/** Off the Isle of Wight, 4 August: the island's south coast and St Catherine's to the north, the Owers to the east. */
export const WIGHT_TERRAIN: TerrainSpec = { size: 20000, res: 2048, seed: 1590, shapes: [], channels: [], region: { id: 'battle-wight', biome: ENGLISH_BIOME } };

/** The Calais roads, night of 7–8 August: the French coast south of the anchorage, Cap Blanc-Nez to the west. */
export const CALAIS_TERRAIN: TerrainSpec = { size: 20000, res: 2048, seed: 1591, shapes: [], channels: [], region: { id: 'battle-calais', biome: FLEMISH_BIOME } };

/** Off Gravelines, 8 August: the low Flemish coast and its banks to the south-east, the North Sea open to the north. */
export const GRAVELINES_TERRAIN: TerrainSpec = { size: 20000, res: 2048, seed: 1592, shapes: [], channels: [], region: { id: 'battle-gravelines', biome: FLEMISH_BIOME } };
