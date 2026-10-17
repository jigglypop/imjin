import type { TerrainSpec } from './generate';
import { GREEK_BIOME, MAGHREB_BIOME } from './region';

// The coasts of the Lepanto chapter. Heights in round figures from the real relief: the hills of Preveza and Actium
// about 100-200 m, the Aetolian mountains above the Curzolari (Echinades) 600-900 m, Point Scrofa and the lagoons of
// Mesolongi low and marshy, the Peloponnese shore near Cape Papas 150-300 m, Djerba flat (under 55 m). The League sails
// east (+x) into the Gulf of Patras in the three Lepanto battles, the Aetolian shore to the north (-z).

/** The mouth of the Gulf of Arta at Preveza, 28 September 1538: the strait narrow, Actium's point to the south. */
export const PREVEZA_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1538,
  shapes: [
    { x: 4000, z: -6800, rx: 9000, rz: 3600, rot: 0.1, peak: 180, rough: 1 },
    { x: 5200, z: 3800, rx: 7000, rz: 2600, rot: -0.1, peak: 120, rough: 0.9 },
    { x: -2600, z: -3200, rx: 900, rz: 600, rot: 0.3, peak: 25, rough: 0.6 },
  ],
  channels: [],
  biome: GREEK_BIOME,
};

/** Off Djerba's north-west point, May 1560: the low island to the south, the shallow flats of the Gulf of Gabès. */
export const DJERBA_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1560,
  shapes: [
    { x: -1000, z: 7600, rx: 11000, rz: 4800, rot: 0.05, peak: 40, rough: 0.4 },
    { x: -5200, z: 3900, rx: 1800, rz: 700, rot: 0.2, peak: 12, rough: 0.3 },
  ],
  channels: [],
  biome: MAGHREB_BIOME,
  bays: [{ x: -3000, z: 4600, rx: 1600, rz: 900, rot: 0 }],
};

/** The northern wing, 7 October 1571: the Aetolian shore and the Mesolongi shallows close to the north, the Curzolari to the west. */
export const NORTH_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1571,
  shapes: [
    { x: 0, z: -7800, rx: 13000, rz: 4400, rot: 0.03, peak: 700, rough: 1 },
    { x: 2600, z: -3400, rx: 3600, rz: 700, rot: 0.05, peak: 4, rough: 0.3 },
    { x: -6000, z: -2600, rx: 900, rz: 700, rot: 0.4, peak: 120, rough: 0.9 },
    { x: -7600, z: -1000, rx: 600, rz: 500, rot: -0.2, peak: 90, rough: 0.9 },
  ],
  channels: [],
  biome: GREEK_BIOME,
};

/** The centre, 7 October 1571: open water, the Aetolian mountains far to the north, the Peloponnese far to the south. */
export const CENTRE_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1572,
  shapes: [
    { x: 0, z: -9600, rx: 13000, rz: 3600, rot: 0.03, peak: 800, rough: 1 },
    { x: 0, z: 10200, rx: 13000, rz: 3200, rot: -0.05, peak: 500, rough: 1 },
  ],
  channels: [],
  biome: GREEK_BIOME,
};

/** The southern wing, 7 October 1571: open sea towards Cape Papas and the Peloponnese to the south. */
export const SOUTH_TERRAIN: TerrainSpec = {
  size: 20000,
  res: 2048,
  seed: 1573,
  shapes: [
    { x: 1000, z: 8800, rx: 13000, rz: 3600, rot: -0.04, peak: 300, rough: 1 },
    { x: 5600, z: 5200, rx: 1600, rz: 900, rot: 0.3, peak: 150, rough: 0.9 },
  ],
  channels: [],
  biome: GREEK_BIOME,
};
