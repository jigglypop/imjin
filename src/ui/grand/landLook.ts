import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, Texture, UnsignedByteType } from 'three/webgpu';
import { float, floor, fract, fwidth, max, min, mix, positionWorld, sin, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { demMeta } from './mapTheatre';
import { SKY_LIGHT, SUN_LIGHT } from './groundPalette';
import { BAND_MARGIN, bakeLand, HEIGHT_RANGE, landFrame, SLOPE_RANGE } from './landBake';
import { DEM_RECT } from './mapMath';
import { MAP_ASPECT } from './projection';
import { MODEL_METRE } from './hero/site';
import { coverOf, landNoiseData, NOISE, NOISE_SCALE, PALETTE, type Cover } from './landCover';
import { versioned } from '../../render/assetUrl';

// The look of the campaign world's land: one shader for the whole DEM (and for the hero camps' smooth patches, which fade
// into it), so the ground reads as country instead of paper facets. The light comes from a bake of the DEM (landBake.ts:
// the sun with the hills' soft shadows, the sky with the shade of the valleys), so the coarse facets shade smooth. The kind
// of country is worked out per pixel from the bake's slope and height, broken by noise, so woods, fields, rock and beaches
// have ragged natural edges at every zoom: woods on the slopes with their crowns in clumps, farmland on the low flat
// ground in a patchwork of paddies and dry fields with bunds between, bare rock on the steepest faces and the high
// ridges, sand and tidal mud along the low shores. Close up, the battle's ground textures add grain; from afar the noise's
// mipmaps and the footprint fades leave the calm map colours. Unlit like the rest of the map, with its fog.

/** A colour of the palette (landCover.ts), written in sRGB, as linear light. */
const srgb = (key: keyof typeof PALETTE) => vec3(...(PALETTE[key].map((c) => (c / 255) ** 2.2) as [number, number, number]));

/** The ground textures worked in close up: grass, rock, sand, woodland floor (the battle's own, 1k). */
const DETAIL = ['aerial_grass_rock', 'aerial_rocks_02', 'coast_sand_01', 'forest_leaves_02'] as const;
/**
 * The size they are drawn at: they only add grain, a few metres a repeat, so a quarter of the pixels shows the same and
 * the four take 6 MB of the GPU instead of 22.
 */
const DETAIL_SIZE = 512;

/** A ground texture, scaled down to DETAIL_SIZE as it is decoded. */
async function detailTexture(name: string, signal: AbortSignal) {
  const response = await fetch(versioned(`/textures/${name}/diff_1k.jpg`), { signal });
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { resizeWidth: DETAIL_SIZE, resizeHeight: DETAIL_SIZE, resizeQuality: 'high' });
  const t = new Texture(bitmap);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/**
 * The land's noise, four tileable channels: red broad districts, green valleys and stands, blue fine breakup for ragged
 * edges, alpha the crowns of trees. The sea's foam and glint read it too; whoever makes it frees it.
 */
export function landNoise() {
  const tex = new DataTexture(landNoiseData(), NOISE, NOISE, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Bakes the land's light in workers where there are any, the DEM split into bands of rows among up to six of them (two
 * seconds of arithmetic on one core); on the page otherwise. `metres` is the DEM as loaded; each worker is sent a copy of
 * its band before this returns, so the caller may change the DEM afterwards.
 */
function bake(metres: Float32Array, signal: AbortSignal): Promise<Uint8Array> {
  const frame = landFrame();
  const W = frame.width, H = frame.height;
  if (typeof Worker === 'undefined') return Promise.resolve(bakeLand(metres, frame));
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  const bands = Math.max(1, Math.min(6, cores - 1));
  // Only land costs anything to bake, so the bands share out the land, not the rows: the north is nearly all land.
  const land = new Float64Array(H + 1);
  for (let r = 0; r < H; r += 1) {
    let n = 0;
    for (let i = r * W; i < (r + 1) * W; i += 1) if (metres[i]! > 0) n += 1;
    land[r + 1] = land[r]! + n + W * 0.02;
  }
  const cut = (b: number) => {
    let r = 0;
    while (r < H && land[r]! < (land[H]! * b) / bands) r += 1;
    return r;
  };
  const out = new Uint8Array(W * H * 4);
  const workers: Worker[] = [];
  const jobs = Array.from({ length: bands }, (_, b) => {
    const r0 = cut(b), r1 = b === bands - 1 ? H : cut(b + 1);
    const top = Math.max(0, r0 - BAND_MARGIN), bottom = Math.min(H, r1 + BAND_MARGIN);
    const worker = new Worker(new URL('./landBake.worker.ts', import.meta.url), { type: 'module' });
    workers.push(worker);
    const done = new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ out?: Uint8Array; error?: string }>) => {
        if (!e.data.out) return reject(new Error(e.data.error));
        out.set(e.data.out, r0 * W * 4);
        resolve();
      };
      worker.onerror = (e) => reject(new Error(e.message));
    });
    worker.postMessage({ metres: metres.slice(top * W, bottom * W), frame: { ...frame, height: bottom - top }, rows: [r0 - top, r1 - top] });
    return done;
  });
  const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  return Promise.race([Promise.all(jobs), aborted]).then(() => out).finally(() => { for (const w of workers) w.terminate(); });
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

export interface LandLook {
  /** The bake (landBake.ts) over the DEM and the close-up ground textures, which it frees. */
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

/**
 * Bakes the light and loads the textures of the land's look. `metres` is the DEM's heights as loaded (read before this
 * returns its promise), `noise` the land's noise (`landNoise`), which stays the caller's.
 */
export async function loadLandLook(metres: Float32Array, noise: DataTexture, signal: AbortSignal): Promise<LandLook> {
  const [baked, ...details] = await Promise.all([bake(metres, signal), ...DETAIL.map((name) => detailTexture(name, signal))]);
  const W = demMeta.width, H = demMeta.height;
  const bakeTex = new DataTexture(baked, W, H, RGBAFormat, UnsignedByteType);
  bakeTex.magFilter = LinearFilter;
  bakeTex.minFilter = LinearMipmapLinearFilter;
  bakeTex.generateMipmaps = true;
  bakeTex.needsUpdate = true;
  const noiseData = noise.image.data as Uint8Array;
  const textures = [bakeTex, ...details];
  const free = () => {
    for (const t of textures) t.dispose();
    for (const t of details) (t.image as ImageBitmap).close();
  };
  if (signal.aborted) {
    free();
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
    const broad: any = n(NOISE_SCALE.broad).r.mul(0.6).add(n(NOISE_SCALE.broad2).r.mul(0.4));
    const stand: any = n(NOISE_SCALE.stand).g;
    const fine: any = n(NOISE_SCALE.fine).b;
    const wander: any = broad.mul(0.65).add(stand.mul(0.35)).sub(0.5);
    const rag: any = fine.sub(0.5).add(stand.sub(0.5).mul(0.6));

    // Woods on the slopes and the hills, their edges ragged; bare rock on the steepest faces and the high ridges; sand and
    // mud on the low flat shores; farmland on the low flat ground; grass and scrub elsewhere (landCover.ts `coverOf` follows
    // the same rules on the CPU).
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
    const open: any = mix(srgb('grass'), srgb('scrub'), smoothstep(0.6, 0.9, broad).mul(0.7));
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
    const crop: any = mix(mix(srgb('rice'), srgb('young'), smoothstep(0.25, 0.35, ripe)),
      mix(srgb('ripe'), srgb('tilled'), smoothstep(0.85, 0.95, ripe)), smoothstep(0.55, 0.65, ripe));
    const f: any = fract(q);
    const edge: any = min(min(f.x, float(1).sub(f.x)).mul(plot.x), min(f.y, float(1).sub(f.y)).mul(plot.y));
    const plots: any = float(1).sub(smoothstep(1.2, 5, footprint));
    const bund: any = float(1).sub(smoothstep(0.25, 0.85, edge.div(max(footprint, 0.25)).mul(0.5))).mul(plots);
    const field: any = mix(mix(srgb('fields'), crop, plots), srgb('bund'), bund.mul(0.75));
    let ground: any = mix(open, field, farm);

    // Woods: broadleaf low down, pine higher up, the canopy in crowns with shade between them, and stands of a little
    // different green.
    const crown: any = n(NOISE_SCALE.crown).a;
    const canopy: any = mix(srgb('broadleaf'), srgb('pine'), smoothstep(120, 600, metres.add(wander.mul(200))));
    const woodColor: any = canopy.mul(crown.mul(0.75).add(0.55)).mul(stand.sub(0.5).mul(0.35).add(1));
    ground = mix(ground, woodColor, wood);
    // Rock, paler the higher it stands; sand, and mud on the flattest and lowest of it in some reaches.
    ground = mix(ground, mix(srgb('rock'), srgb('rockHigh'), smoothstep(900, 1700, metres)), rock);
    const mud: any = smoothstep(0.55, 0.75, broad.add(stand.mul(0.3))).mul(float(1).sub(smoothstep(0.5, 2.5, metres)));
    ground = mix(ground, mix(srgb('sand'), srgb('mud'), mud), sand);

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

  const NONE: Cover = { wood: 0, rock: 0, crag: 0, sand: 0, farm: 0, slope: 0, metres: 0, wander: 0, broad: 0.5, stand: 0.5 };
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
    return coverOf(noiseData, slope, metres, (u - 0.5) / MODEL_METRE, (v - 0.5) / MAP_ASPECT / MODEL_METRE);
  };

  return {
    textures,
    details,
    coverAt,
    color,
    dispose: free,
  };
}
