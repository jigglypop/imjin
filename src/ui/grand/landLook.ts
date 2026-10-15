import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, TextureLoader, UnsignedByteType, type Texture } from 'three/webgpu';
import { float, floor, fract, fwidth, max, min, mix, positionWorld, sin, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import demMeta from '../../select/demMeta.json';
import { SKY_LIGHT, SUN_LIGHT } from './groundPalette';
import { bakeLand, HEIGHT_RANGE, landFrame, SLOPE_RANGE } from './landBake';
import { DEM_RECT } from './mapMath';
import { MAP_ASPECT } from './projection';
import { MODEL_METRE } from './hero/site';

// The look of the campaign world's land: one shader for the whole DEM (and for the hero camps' smooth patches, which fade
// into it), so the ground reads as country instead of paper facets. The light comes from a bake of the DEM (landBake.ts:
// the sun with the hills' soft shadows, the sky with the shade of the valleys), so the coarse facets shade smooth. The kind
// of country is worked out per pixel from the bake's slope and height, broken by noise, so woods, fields, rock and beaches
// have ragged natural edges at every zoom: woods on the slopes with their crowns in clumps, farmland on the low flat
// ground in a patchwork of paddies and dry fields with bunds between, bare rock on the steepest faces and the high
// ridges, sand and tidal mud along the low shores. Close up, the battle's ground textures add grain; from afar the noise's
// mipmaps and the footprint fades leave the calm map colours. Unlit like the rest of the map, with its fog.

/** A colour written in sRGB as linear light. */
const srgb = (r: number, g: number, b: number) => vec3((r / 255) ** 2.2, (g / 255) ** 2.2, (b / 255) ** 2.2);

/** The ground textures worked in close up: grass, rock, sand, woodland floor (the battle's own, 1k). */
const DETAIL = ['aerial_grass_rock', 'aerial_rocks_02', 'coast_sand_01', 'forest_leaves_02'] as const;

/** The noise texture's side; each channel tiles on it. */
const NOISE = 256;

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
 * The land's noise, four tileable channels: red broad districts, green valleys and stands, blue fine breakup for ragged
 * edges, alpha the crowns of trees.
 */
function noiseTexture() {
  const data = new Uint8Array(NOISE * NOISE * 4);
  for (let y = 0; y < NOISE; y += 1) for (let x = 0; x < NOISE; x += 1) {
    const o = (y * NOISE + x) * 4;
    data[o] = Math.round((value(x, y, 4, 1) * 0.6 + value(x, y, 8, 2) * 0.4) * 255);
    data[o + 1] = Math.round((value(x, y, 16, 3) * 0.6 + value(x, y, 32, 4) * 0.4) * 255);
    data[o + 2] = Math.round((value(x, y, 32, 5) * 0.5 + value(x, y, 64, 6) * 0.3 + value(x, y, 128, 7) * 0.2) * 255);
    data[o + 3] = Math.round(crowns(x, y, 32) * 255);
  }
  const tex = new DataTexture(data, NOISE, NOISE, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Bakes the land's light in a worker where there is one; on the page otherwise. `metres` is the DEM as loaded. */
async function bake(metres: Float32Array, signal: AbortSignal): Promise<Uint8Array> {
  const frame = landFrame();
  if (typeof Worker === 'undefined') return bakeLand(metres, frame);
  const worker = new Worker(new URL('./landBake.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      worker.onmessage = (e: MessageEvent<{ out?: Uint8Array; error?: string }>) => (e.data.out ? resolve(e.data.out) : reject(new Error(e.data.error)));
      worker.onerror = (e) => reject(new Error(e.message));
      // A copy goes over: the page keeps the DEM.
      worker.postMessage({ metres: metres.slice(), frame });
    });
  } finally {
    worker.terminate();
  }
}

/** What a hero camp's patch knows better than the bake, given for each of its vertices and faded in by `inner`. */
export interface LocalGround {
  /** 0 at the patch's fading edge, where the land's own look takes over, to 1 well inside. */
  inner: any;
  sun: any;
  sky: any;
  slope: any;
  metres: any;
  /** The patch's own weights of grass, rock, sand and woodland floor; without them the look works them out as it does for the DEM. */
  w?: any;
}

/** The country at a point as the land's look draws it (`LandLook.coverAt`): 0..1 shares, the slope and the height. */
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
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface LandLook {
  /** The bake (landBake.ts) over the DEM, the noise and the close-up ground textures. */
  readonly textures: Texture[];
  /** The ground textures alone, for what is laid on the hero camps' ground (hero/ground.ts). */
  readonly details: Texture[];
  /**
   * The country at frame point (u, v) as the shader works it out from the bake and the noise (the same rules, on the CPU),
   * for the trees and rocks standing on it. Over the DEM only; elsewhere open sea.
   */
  coverAt(u: number, v: number): Cover;
  /** The land's colour, lit, at the drawn point: the DEM's from the bake, or a hero patch's faded in over it. */
  color(local?: LocalGround): any;
  dispose(): void;
}

/** Bakes the light and loads the textures of the land's look. `metres` is the DEM's heights as loaded. */
export async function loadLandLook(metres: Float32Array, signal: AbortSignal): Promise<LandLook> {
  const loader = new TextureLoader();
  const [baked, ...details] = await Promise.all([
    bake(metres, signal),
    ...DETAIL.map(async (name) => {
      const t = await loader.loadAsync(`/textures/${name}/diff_1k.jpg`);
      t.colorSpace = SRGBColorSpace;
      t.wrapS = t.wrapT = RepeatWrapping;
      t.minFilter = LinearMipmapLinearFilter;
      t.anisotropy = 4;
      return t;
    }),
  ]);
  const W = demMeta.width, H = demMeta.height;
  const bakeTex = new DataTexture(baked, W, H, RGBAFormat, UnsignedByteType);
  bakeTex.magFilter = LinearFilter;
  bakeTex.minFilter = LinearMipmapLinearFilter;
  bakeTex.generateMipmaps = true;
  bakeTex.needsUpdate = true;
  const noise = noiseTexture();
  const noiseData = noise.image.data as Uint8Array;
  const textures = [bakeTex, noise, ...details];
  if (signal.aborted) {
    for (const t of textures) t.dispose();
    signal.throwIfAborted();
  }

  const color = (local?: LocalGround) => {
    const p: any = positionWorld.xz;
    // The DEM's texel (x / (W - 1) of the way across, as the land's vertices stand) to the bake's texture coordinate.
    const lu = p.x.add(0.5 - DEM_RECT.u).div(DEM_RECT.w), lv = p.y.mul(MAP_ASPECT).add(0.5 - DEM_RECT.v).div(DEM_RECT.h);
    const s: any = texture(bakeTex, vec2(lu.mul((W - 1) / W).add(0.5 / W), lv.mul((H - 1) / H).add(0.5 / H)));
    let sun: any = s.r, sky: any = s.g, slope: any = s.b.mul(SLOPE_RANGE), metres: any = s.a.mul(s.a).mul(HEIGHT_RANGE);
    if (local) {
      sun = mix(sun, local.sun, local.inner);
      sky = mix(sky, local.sky, local.inner);
      slope = mix(slope, local.slope, local.inner);
      metres = mix(metres, local.metres, local.inner);
    }
    // Model metres (the scale the camps are built at, about 160 m of the real coast each) and how many a pixel covers.
    const m: any = p.div(MODEL_METRE);
    const footprint: any = fwidth(m).length();
    const n = (scale: number) => texture(noise, m.div(scale));
    const broad: any = n(800).r.mul(0.6).add(n(1330).r.mul(0.4));
    const stand: any = n(400).g;
    const fine: any = n(128).b;
    const wander: any = broad.mul(0.65).add(stand.mul(0.35)).sub(0.5);
    const rag: any = fine.sub(0.5).add(stand.sub(0.5).mul(0.6));

    // Woods on the slopes and the hills, their edges ragged (coverAt above follows the same rules for the trees); bare rock on the steepest faces and the high ridges; sand
    // and mud on the low flat shores; farmland on the low flat ground; grass and scrub elsewhere.
    const woodsAt = max(smoothstep(0.26, 0.55, slope.add(wander.mul(0.22))), smoothstep(70, 190, metres.add(wander.mul(90))));
    let wood: any = smoothstep(0.38, 0.62, woodsAt.add(rag.mul(0.45)));
    // Granite where the land drops to the sea, as along the whole south coast, besides the crags and the ridges.
    const shoreRock: any = float(1).sub(smoothstep(3, 12, metres.add(rag.mul(5)))).mul(smoothstep(0.22, 0.45, slope.add(rag.mul(0.2))));
    let rock: any = max(max(smoothstep(1.5, 2.3, slope.add(rag.mul(0.5))), smoothstep(1050, 1500, metres.add(wander.mul(150)).add(rag.mul(80)))), shoreRock);
    let sand: any = float(1).sub(smoothstep(1.5, 5.5, metres.add(rag.mul(4)))).mul(float(1).sub(smoothstep(0.12, 0.35, slope)));
    const farm: any = float(1).sub(smoothstep(18, 60, metres.add(wander.mul(40)))).mul(float(1).sub(smoothstep(0.1, 0.26, slope.add(rag.mul(0.06)))));
    if (local?.w) {
      // Inside a patch its own finer ground decides rock, sand and wood (its cut banks, its shore).
      wood = mix(wood, local.w.w, local.inner);
      rock = mix(rock, local.w.y, local.inner);
      sand = mix(sand, local.w.z, local.inner);
    }
    rock = rock.mul(float(1).sub(sand));
    wood = wood.mul(float(1).sub(rock)).mul(float(1).sub(sand));

    // Open ground: grass and scrub, drier in some districts.
    const open: any = mix(srgb(120, 146, 70), srgb(156, 150, 90), smoothstep(0.6, 0.9, broad).mul(0.7));
    // Farmland: a patchwork of plots in rows turned with the district, each its own crop, with darker bunds between; the
    // plots give way to their mean colour once a pixel covers a fair share of one.
    const turn: any = broad.mul(6.3);
    const c: any = sin(turn.add(1.57)), sn: any = sin(turn);
    // The rows bend with the lie of the land, so on a valley's sides the plots step up it in terraces.
    const q0: any = vec2(m.x.mul(c).sub(m.y.mul(sn)), m.x.mul(sn).add(m.y.mul(c))).add(vec2(stand.sub(0.5).mul(12), fine.sub(0.5).mul(4).add(metres.mul(0.5))));
    const plot = vec2(9.5, 5.5);
    const row: any = floor(q0.y.div(plot.y));
    const q: any = vec2(q0.x.div(plot.x).add(row.mul(0.37)), q0.y.div(plot.y));
    const cell: any = floor(q);
    const pick: any = fract(sin(cell.x.mul(127.1).add(cell.y.mul(311.7))).mul(43758.55));
    // Rice green, young green, ripening gold and bare tilled earth, gold more often in the drier districts.
    const ripe: any = pick.add(broad.sub(0.5).mul(0.5));
    const crop: any = mix(mix(srgb(104, 140, 58), srgb(140, 166, 78), smoothstep(0.25, 0.35, ripe)),
      mix(srgb(182, 168, 96), srgb(146, 120, 84), smoothstep(0.85, 0.95, ripe)), smoothstep(0.55, 0.65, ripe));
    const f: any = fract(q);
    const edge: any = min(min(f.x, float(1).sub(f.x)).mul(plot.x), min(f.y, float(1).sub(f.y)).mul(plot.y));
    const plots: any = float(1).sub(smoothstep(1.2, 5, footprint));
    const bund: any = float(1).sub(smoothstep(0.25, 0.85, edge.div(max(footprint, 0.25)).mul(0.5))).mul(plots);
    const field: any = mix(mix(srgb(138, 156, 76), crop, plots), srgb(70, 92, 48), bund.mul(0.75));
    let ground: any = mix(open, field, farm);

    // Woods: broadleaf low down, pine higher up, the canopy in crowns with shade between them, and stands of a little
    // different green.
    const crown: any = n(128).a;
    const canopy: any = mix(srgb(58, 96, 46), srgb(36, 66, 42), smoothstep(120, 600, metres.add(wander.mul(200))));
    const woodColor: any = canopy.mul(crown.mul(0.75).add(0.55)).mul(stand.sub(0.5).mul(0.35).add(1));
    ground = mix(ground, woodColor, wood);
    // Rock, paler the higher it stands; sand, and mud on the flattest and lowest of it in some reaches.
    ground = mix(ground, mix(srgb(132, 126, 114), srgb(176, 170, 158), smoothstep(900, 1700, metres)), rock);
    const mud: any = smoothstep(0.55, 0.75, broad.add(stand.mul(0.3))).mul(float(1).sub(smoothstep(0.5, 2.5, metres)));
    ground = mix(ground, mix(srgb(222, 206, 160), srgb(146, 136, 112), mud), sand);

    // Close up, the ground textures' grain, each divided by its own mean so it changes the grain and not the colour, at
    // two scales so no tiling shows; gone before a pixel covers so much ground that their repeats would quilt.
    const detail = (t: Texture, size: number) => {
      const mean = texture(t, vec2(0.5, 0.5)).level(float(12)).rgb.max(vec3(0.02));
      const a = texture(t, m.div(size)).rgb.div(mean), b = texture(t, m.div(size * 3.7).add(vec2(0.37, 0.71))).rgb.div(mean);
      const g = a.mul(b.pow(vec3(0.35)));
      return mix(vec3(g.dot(vec3(0.3, 0.55, 0.15))), g, 0.3);
    };
    const grassW: any = float(1).sub(wood).sub(rock).sub(sand).max(0);
    const mixed: any = detail(details[0]!, 7).mul(grassW).add(detail(details[1]!, 6).mul(rock)).add(detail(details[2]!, 4.5).mul(sand)).add(detail(details[3]!, 5).mul(wood));
    const near: any = float(1).sub(smoothstep(0.17, 0.38, footprint));
    const grain: any = mix(vec3(1), mixed.div(grassW.add(rock).add(sand).add(wood).max(0.001)), near.mul(0.55));

    const light: any = vec3(...SUN_LIGHT).mul(sun).add(vec3(...SKY_LIGHT).mul(sky));
    return ground.mul(grain).mul(light);
  };

  // The noise as the shader samples it: bilinear, wrapping, one channel.
  const noiseAt = (mx: number, mz: number, scale: number, channel: number) => {
    const fx = (mx / scale) * NOISE - 0.5, fz = (mz / scale) * NOISE - 0.5;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const at = (i: number, j: number) => noiseData[(((j % NOISE) + NOISE) % NOISE * NOISE + (((i % NOISE) + NOISE) % NOISE)) * 4 + channel]! / 255;
    const top = at(ix, iz) + (at(ix + 1, iz) - at(ix, iz)) * tx, bottom = at(ix, iz + 1) + (at(ix + 1, iz + 1) - at(ix, iz + 1)) * tx;
    return top + (bottom - top) * tz;
  };
  const NONE: Cover = { wood: 0, rock: 0, crag: 0, sand: 0, farm: 0, slope: 0, metres: 0, wander: 0 };
  const coverAt = (u: number, v: number): Cover => {
    const tx = ((u - DEM_RECT.u) / DEM_RECT.w) * (W - 1), ty = ((v - DEM_RECT.v) / DEM_RECT.h) * (H - 1);
    if (!(tx >= 0 && ty >= 0 && tx <= W - 1 && ty <= H - 1)) return NONE;
    const x0 = Math.min(W - 2, Math.floor(tx)), y0 = Math.min(H - 2, Math.floor(ty)), fx = tx - x0, fy = ty - y0;
    const read = (c: number) => {
      const k = (y0 * W + x0) * 4 + c, r = W * 4;
      const top = baked[k]! + (baked[k + 4]! - baked[k]!) * fx, bottom = baked[k + r]! + (baked[k + r + 4]! - baked[k + r]!) * fx;
      return (top + (bottom - top) * fy) / 255;
    };
    const slope = read(2) * SLOPE_RANGE, a = read(3), metres = a * a * HEIGHT_RANGE;
    const mx = (u - 0.5) / MODEL_METRE, mz = (v - 0.5) / MAP_ASPECT / MODEL_METRE;
    const broad = noiseAt(mx, mz, 800, 0) * 0.6 + noiseAt(mx, mz, 1330, 0) * 0.4;
    const stand = noiseAt(mx, mz, 400, 1), fine = noiseAt(mx, mz, 128, 2);
    const wander = broad * 0.65 + stand * 0.35 - 0.5, rag = fine - 0.5 + (stand - 0.5) * 0.6;
    // The shader's rules (`color` below), step for step.
    const woodsAt = Math.max(smooth(0.26, 0.55, slope + wander * 0.22), smooth(70, 190, metres + wander * 90));
    let wood = smooth(0.38, 0.62, woodsAt + rag * 0.45);
    const shoreRock = (1 - smooth(3, 12, metres + rag * 5)) * smooth(0.22, 0.45, slope + rag * 0.2);
    const crag = Math.max(smooth(1.5, 2.3, slope + rag * 0.5), smooth(1050, 1500, metres + wander * 150 + rag * 80));
    let rock = Math.max(crag, shoreRock);
    const sand = (1 - smooth(1.5, 5.5, metres + rag * 4)) * (1 - smooth(0.12, 0.35, slope));
    const farm = (1 - smooth(18, 60, metres + wander * 40)) * (1 - smooth(0.1, 0.26, slope + rag * 0.06));
    rock *= 1 - sand;
    wood *= (1 - rock) * (1 - sand);
    return { wood, rock, crag: crag * (1 - sand), sand, farm, slope, metres, wander };
  };

  return {
    textures,
    details,
    coverAt,
    color,
    dispose() {
      for (const t of textures) t.dispose();
    },
  };
}
