/**
 * What a campaign region's battle ground is made of, beyond its heights: the real elevation window it is cut from and
 * the character of the land on it (how much forest, how many villages, which roofs, how dry). Every field has a neutral
 * value in DEFAULT_BIOME, which is what the historical battles and conquest maps get, so their ground is unchanged.
 */
export type RegionBiome = {
  /** Tree cover, 1 as the old maps have it. */
  forest: number;
  /** Altitude (m) where trees start to thin out; they are gone 120 m above it. */
  canopyLine: number;
  /** How much of the shore and the steep ground is bare rock, 1 as the old maps have it. */
  rocky: number;
  /** Colours the bare-rock mask in the ground shader (0 leaves the old look), so a rocky island reads as stone and not as forest. */
  rockLook: number;
  /** Reach of the paddies around a village, 1 as the old maps have it. */
  fields: number;
  /** Fields that spread over flat low ground beyond the villages (0 to 1), for plains and tidal land. */
  plain: number;
  /** Most villages the land holds. */
  villages: number;
  /** Houses per village, 1 as the old maps have it. */
  houses: number;
  /** Share of tiled-roof houses (giwa); the rest are thatched (choga). */
  tiled: number;
  /** How a village is laid out: scattered, in a row along the shore, or on a square grid. */
  layout: 'scatter' | 'row' | 'grid';
  /** Most beacon towers on the high ground. */
  beacons: number;
  /** Share of crowns that are broad-leaved (wide and low) rather than pine. */
  broadleaf: number;
  /** Multiplies the ground and crown colours. */
  tint: [number, number, number];
  /** Dry land: wheat-coloured fields, khaki grass (0 is the green of the old maps). */
  dry: number;
  /** Width of the beach band, 1 as the old maps have it; mud-coloured where `shoreTint` says so. */
  shore: number;
  shoreTint: [number, number, number];
  /**
   * Whose land it is, for the houses, the church and the hedges: Korea (absent, the old maps) has thatch and tile houses,
   * a beacon and a fort gate; 'english' (1588 Channel coast) stone and timber-framed cottages, a church tower and
   * hedgerows; 'flemish' (Calais, Gravelines) brick stepped-gable houses, a spired church and hedgerows.
   */
  style?: 'english' | 'flemish';
  /** Share of crowns that are tall and narrow, like the poplars of Flanders (absent or 0 leaves none). */
  poplar?: number;
};

export const DEFAULT_BIOME: RegionBiome = {
  forest: 1,
  canopyLine: 400,
  rocky: 1,
  rockLook: 0,
  fields: 1,
  plain: 0,
  villages: 7,
  houses: 1,
  tiled: 0.2,
  layout: 'scatter',
  beacons: 3,
  broadleaf: 0,
  tint: [1, 1, 1],
  dry: 0,
  shore: 1,
  shoreTint: [1, 1, 1],
};

/** The 1588 English Channel coast: broad-leaved woods (oak, beech, ash), green fields, stone and timber villages. */
export const ENGLISH_BIOME: RegionBiome = {
  ...DEFAULT_BIOME,
  forest: 0.7,
  canopyLine: 260,
  fields: 2,
  plain: 0.45,
  villages: 6,
  houses: 0.9,
  tiled: 0.45,
  beacons: 0,
  broadleaf: 0.9,
  tint: [1.08, 1.06, 0.92],
  style: 'english',
};

/** The French and Flemish coast of Calais and Gravelines: flat fields, poplar and willow rows, brick towns. */
export const FLEMISH_BIOME: RegionBiome = {
  ...DEFAULT_BIOME,
  forest: 0.45,
  canopyLine: 220,
  fields: 2.4,
  plain: 0.8,
  villages: 6,
  houses: 1.2,
  layout: 'row',
  beacons: 0,
  broadleaf: 0.8,
  poplar: 0.45,
  tint: [1.08, 1.05, 0.9],
  shore: 1.4,
  shoreTint: [0.95, 0.9, 0.78],
  style: 'flemish',
};

/** A real elevation window (public/terrain/<id>.dem) with the biome that dresses it. */
export type RegionGround = {
  id: string;
  biome: RegionBiome;
};
