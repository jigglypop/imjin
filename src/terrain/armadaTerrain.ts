import type { TerrainSpec } from './generate';
import { ENGLISH_BIOME, FLEMISH_BIOME } from './region';

// The coasts of the Armada's running fight up the Channel, July–August 1588. Each battle's shore is to the north of
// its map (negative z) except Calais and Gravelines, where the Flemish and French coast lies to the south of the
// anchorage and the battle; heights are the real ones in round figures (the Devon cliffs about 100 m, Portland 150 m,
// the Isle of Wight's downs 240 m, Cap Blanc-Nez 130 m, the Flemish dunes about 15 m).

/** Off Plymouth, 31 July: Rame Head and the Sound to the north, the Eddystone reef offshore. */
export const PLYMOUTH_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1588,
  shapes: [
    { x: 0, z: -9400, rx: 12500, rz: 4600, rot: 0.02, peak: 150, rough: 0.9 },
    { x: -2600, z: -4900, rx: 1100, rz: 1500, rot: 0.3, peak: 110, rough: 0.8 },
    { x: 3600, z: -5200, rx: 1700, rz: 1200, rot: -0.2, peak: 95, rough: 0.8 },
    { x: -7400, z: -5600, rx: 2400, rz: 1500, rot: 0.15, peak: 120, rough: 0.9 },
    { x: 1200, z: 3400, rx: 70, rz: 40, rot: 0.5, peak: 5, rough: 0.4 },
  ],
  channels: [],
  biome: ENGLISH_BIOME,
  bays: [{ x: 500, z: -5100, rx: 2000, rz: 1100, rot: 0 }],
};

/** Off Portland Bill, 2 August: the long limestone tongue running south, the Shambles bank east of it. */
export const PORTLAND_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1589,
  shapes: [
    { x: 0, z: -9800, rx: 12500, rz: 4200, rot: 0, peak: 160, rough: 0.9 },
    { x: -1400, z: -4300, rx: 1100, rz: 3300, rot: 0.05, peak: 150, rough: 0.75 },
    { x: -1500, z: -1300, rx: 520, rz: 700, rot: 0, peak: 40, rough: 0.6 },
    { x: -6800, z: -6400, rx: 3600, rz: 900, rot: -0.1, peak: 18, rough: 0.5 },
  ],
  channels: [],
  biome: ENGLISH_BIOME,
};

/** Off the Isle of Wight, 4 August: the island's south coast and St Catherine's to the north, the Owers to the east. */
export const WIGHT_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1590,
  shapes: [
    { x: -500, z: -7200, rx: 9500, rz: 3600, rot: 0.06, peak: 240, rough: 1 },
    { x: -2600, z: -3800, rx: 1500, rz: 900, rot: 0.2, peak: 160, rough: 0.85 },
    { x: 7800, z: -6800, rx: 2600, rz: 2600, rot: 0, peak: 30, rough: 0.6 },
    { x: 6200, z: -1600, rx: 420, rz: 160, rot: -0.3, peak: 2, rough: 0.3 },
  ],
  channels: [],
  biome: ENGLISH_BIOME,
};

/** The Calais roads, night of 7–8 August: the French coast south of the anchorage, Cap Blanc-Nez to the west. */
export const CALAIS_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1591,
  shapes: [
    { x: 1500, z: 8600, rx: 12000, rz: 4200, rot: -0.04, peak: 35, rough: 0.6 },
    { x: -6200, z: 5200, rx: 2200, rz: 1600, rot: 0.2, peak: 130, rough: 0.9 },
    { x: 2200, z: 4600, rx: 1300, rz: 600, rot: 0, peak: 14, rough: 0.5 },
  ],
  channels: [],
  biome: FLEMISH_BIOME,
};

/** Off Gravelines, 8 August: the low Flemish coast and its banks to the south-east, the North Sea open to the north. */
export const GRAVELINES_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1592,
  shapes: [
    { x: 2500, z: 8800, rx: 13000, rz: 4400, rot: -0.1, peak: 16, rough: 0.5 },
    { x: 6400, z: 3900, rx: 2600, rz: 260, rot: -0.15, peak: 1.5, rough: 0.3 },
    { x: -1800, z: 4400, rx: 2000, rz: 220, rot: -0.1, peak: 1.2, rough: 0.3 },
  ],
  channels: [],
  biome: FLEMISH_BIOME,
};
