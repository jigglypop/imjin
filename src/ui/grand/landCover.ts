// The kinds of country on the campaign world's land and their colours, without three.js: the land's shader
// (landLook.ts) works the same rules out per pixel in TSL, the trees (worldTrees.ts) read them to stand where it draws
// woods and crags, and the flat map for phones (scripts/build-grand-flat.mjs) is painted with them.

/** The land's noise texture's side; each channel tiles on it. */
export const NOISE = 256;
/**
 * The scales the noise is read at, model metres a repeat (a model metre, the scale the camps are built at, is about
 * 160 m of the real coast): broad districts at two scales, stands and valleys, the fine breakup of edges, tree crowns.
 */
export const NOISE_SCALE = { broad: 800, broad2: 1330, stand: 400, fine: 128, crown: 128 } as const;

/** A cheap hash of a lattice point to 0..1. */
function hash(ix: number, iz: number, seed: number) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tileable value noise of `period` cells over the texture, at texel (x, y). */
function value(x: number, y: number, period: number, seed: number) {
  const fx = (x / NOISE) * period, fy = (y / NOISE) * period;
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const at = (i: number, j: number) => hash(((i % period) + period) % period, ((j % period) + period) % period, seed);
  const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Tileable cellular noise: 1 at a jittered point of each of `period` cells, falling to 0 between them (tree crowns). */
function crowns(x: number, y: number, period: number) {
  const fx = (x / NOISE) * period, fy = (y / NOISE) * period;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  let best = 9;
  for (let j = -1; j <= 1; j += 1) for (let i = -1; i <= 1; i += 1) {
    const ci = ix + i, cj = iy + j;
    const wi = ((ci % period) + period) % period, wj = ((cj % period) + period) % period;
    const px = ci + 0.15 + 0.7 * hash(wi, wj, 91), py = cj + 0.15 + 0.7 * hash(wi, wj, 92);
    best = Math.min(best, Math.hypot(fx - px, fy - py));
  }
  return Math.max(0, 1 - best / 0.72);
}

/**
 * The land's noise, NOISE square, four tileable channels (RGBA bytes): red broad districts, green valleys and stands,
 * blue fine breakup for ragged edges, alpha the crowns of trees.
 */
export function landNoiseData() {
  const data = new Uint8Array(NOISE * NOISE * 4);
  for (let y = 0; y < NOISE; y += 1) for (let x = 0; x < NOISE; x += 1) {
    const o = (y * NOISE + x) * 4;
    data[o] = Math.round((value(x, y, 4, 1) * 0.6 + value(x, y, 8, 2) * 0.4) * 255);
    data[o + 1] = Math.round((value(x, y, 16, 3) * 0.6 + value(x, y, 32, 4) * 0.4) * 255);
    data[o + 2] = Math.round((value(x, y, 32, 5) * 0.5 + value(x, y, 64, 6) * 0.3 + value(x, y, 128, 7) * 0.2) * 255);
    data[o + 3] = Math.round(crowns(x, y, 32) * 255);
  }
  return data;
}

/** The noise as the shader samples it (bilinear, wrapping), one channel at model metres (mx, mz), `scale` a repeat. */
export function noiseAt(data: Uint8Array, mx: number, mz: number, scale: number, channel: number) {
  const fx = (mx / scale) * NOISE - 0.5, fz = (mz / scale) * NOISE - 0.5;
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const at = (i: number, j: number) => data[((((j % NOISE) + NOISE) % NOISE) * NOISE + (((i % NOISE) + NOISE) % NOISE)) * 4 + channel]! / 255;
  const top = at(ix, iz) + (at(ix + 1, iz) - at(ix, iz)) * tx, bottom = at(ix, iz + 1) + (at(ix + 1, iz + 1) - at(ix, iz + 1)) * tx;
  return top + (bottom - top) * tz;
}

/** The colours of the country, sRGB bytes. */
export const PALETTE = {
  grass: [120, 146, 70], scrub: [156, 150, 90],
  fields: [138, 156, 76], rice: [104, 140, 58], young: [140, 166, 78], ripe: [182, 168, 96], tilled: [146, 120, 84], bund: [70, 92, 48],
  broadleaf: [58, 96, 46], pine: [36, 66, 42],
  rock: [132, 126, 114], rockHigh: [176, 170, 158],
  sand: [222, 206, 160], mud: [146, 136, 112],
} as const;

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The country at a point: 0..1 shares, the slope and the height. */
export interface Cover {
  wood: number;
  rock: number;
  /** Rock that is a crag or a ridge, not a shore. */
  crag: number;
  sand: number;
  farm: number;
  slope: number;
  metres: number;
  /** The broad districts' wander, -0.5..0.5, for what stands on the land to vary by it as the land does. */
  wander: number;
  /** The noise there: the districts and the stands, 0..1. */
  broad: number;
  stand: number;
}

/**
 * The country at model metres (mx, mz) of ground of drawn slope `slope` (rise over run) standing `metres` high, by the
 * land shader's rules (landLook.ts `color`), step for step: woods on the slopes and the hills, rock on the crags, the high
 * ridges and where the land drops to the sea, sand on the low flat shores, farmland on the low flat ground.
 */
export function coverOf(data: Uint8Array, slope: number, metres: number, mx: number, mz: number): Cover {
  const broad = noiseAt(data, mx, mz, NOISE_SCALE.broad, 0) * 0.6 + noiseAt(data, mx, mz, NOISE_SCALE.broad2, 0) * 0.4;
  const stand = noiseAt(data, mx, mz, NOISE_SCALE.stand, 1), fine = noiseAt(data, mx, mz, NOISE_SCALE.fine, 2);
  const wander = broad * 0.65 + stand * 0.35 - 0.5, rag = fine - 0.5 + (stand - 0.5) * 0.6;
  const woodsAt = Math.max(smooth(0.26, 0.55, slope + wander * 0.22), smooth(70, 190, metres + wander * 90));
  let wood = smooth(0.38, 0.62, woodsAt + rag * 0.45);
  const shoreRock = (1 - smooth(3, 12, metres + rag * 5)) * smooth(0.22, 0.45, slope + rag * 0.2);
  const crag = Math.max(smooth(1.5, 2.3, slope + rag * 0.5), smooth(1050, 1500, metres + wander * 150 + rag * 80));
  let rock = Math.max(crag, shoreRock);
  const sand = (1 - smooth(1.5, 5.5, metres + rag * 4)) * (1 - smooth(0.12, 0.35, slope));
  const farm = (1 - smooth(18, 60, metres + wander * 40)) * (1 - smooth(0.1, 0.26, slope + rag * 0.06));
  rock *= 1 - sand;
  wood *= (1 - rock) * (1 - sand);
  return { wood, rock, crag: crag * (1 - sand), sand, farm, slope, metres, wander, broad, stand };
}

/** The palette in linear light. */
const LINEAR = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, v.map((c) => (c / 255) ** 2.2)])) as Record<keyof typeof PALETTE, number[]>;
const mixInto = (a: readonly number[], b: readonly number[], t: number) => [0, 1, 2].map((k) => a[k]! + (b[k]! - a[k]!) * t);

/**
 * The colour of the country as the shader draws it from afar (linear light, before the light): the farm plots and the
 * crowns at their mean, no grain. `crown` is the crown noise there (its mean, 0.27, for a whole stand).
 */
export function farColor(c: Cover, crown = 0.27): number[] {
  const P = LINEAR;
  const open = mixInto(P.grass, P.scrub, smooth(0.6, 0.9, c.broad) * 0.7);
  let ground = mixInto(open, P.fields, c.farm);
  const canopy = mixInto(P.broadleaf, P.pine, smooth(120, 600, c.metres + c.wander * 200));
  const shade = (crown * 0.75 + 0.55) * ((c.stand - 0.5) * 0.35 + 1);
  ground = mixInto(ground, canopy.map((v) => v * shade), c.wood);
  ground = mixInto(ground, mixInto(P.rock, P.rockHigh, smooth(900, 1700, c.metres)), c.rock);
  const mud = smooth(0.55, 0.75, c.broad + c.stand * 0.3) * (1 - smooth(0.5, 2.5, c.metres));
  return mixInto(ground, mixInto(P.sand, P.mud, mud), c.sand);
}
