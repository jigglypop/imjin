import {
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  type Node,
  PlaneGeometry,
  RedFormat,
  TextureLoader,
} from 'three/webgpu';
import { abs, clamp, dot, float, fract, fwidth, max, mix, normalize, positionLocal, sin, smoothstep, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
import meta from './demMeta.json';
import { EXAGGERATION, MAP_H, MAP_W, MIST_HEX, V_SCALE } from './demFrame';

// The ink-style relief of the south coast on the historical-battle select screen (SelectScene). The faction campaign's
// world reads the same DEM (loadDem) and draws it as its own low-poly land (src/ui/grand/worldGround.ts), so the two
// screens show the same Korea.

/** A colour written in sRGB, as the node graph works in linear light. */
const srgb = (r: number, g: number, b: number) => vec3(...[r, g, b].map((v) => (v / 255) ** 2.2) as [number, number, number]);
// The mist the relief fades into is exactly the scene's background colour, so the terrain's edge does not show as a box.
const mistColor = new Color(MIST_HEX);
const MIST = vec3(mistColor.r, mistColor.g, mistColor.b);

/**
 * Decodes /ui/korea_dem.webp into metre heights (for picking the ground) and the half-float texture the mesh reads. The
 * campaign world draws its own facets from the heights alone and passes `{ texture: false }`, so no texture is made.
 */
export function loadDem(signal: AbortSignal): Promise<{ heights: Float32Array; tex: DataTexture }>;
export function loadDem(signal: AbortSignal, options: { texture: false; url?: string; size?: { width: number; height: number } }): Promise<{ heights: Float32Array; tex: null }>;
export async function loadDem(signal: AbortSignal, { texture = true, url = '/ui/korea_dem.webp', size = meta }: { texture?: boolean; url?: string; size?: { width: number; height: number } } = {}): Promise<{ heights: Float32Array; tex: DataTexture | null }> {
  signal.throwIfAborted();
  // Another theatre's campaign world (src/ui/grand/mapTheatre.ts) passes its own DEM and size.
  const img = await new TextureLoader().loadAsync(url);
  try {
    signal.throwIfAborted();
    const source = img.image as HTMLImageElement | ImageBitmap;
    const w = size.width;
    const h = size.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(source as CanvasImageSource, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    const heights = new Float32Array(w * h);
    for (let i = 0; i < w * h; i += 1) heights[i] = px[i * 4]! * 256 + px[i * 4 + 1]! + px[i * 4 + 2]! / 256 - 32768;
    if (!texture) return { heights, tex: null };
    const half = new Uint16Array(w * h);
    for (let i = 0; i < w * h; i += 1) half[i] = DataUtils.toHalfFloat(heights[i]!);
    const tex = new DataTexture(half, w, h, RedFormat, HalfFloatType);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.flipY = false;
    tex.needsUpdate = true;
    return { heights, tex };
  } finally {
    img.dispose();
  }
}

/**
 * The campaign world's ambient clock in seconds: what moves on its own (the sea's sheen, camp smoke) moves with it. The
 * map's scene sets it every frame and holds it still for a player who asks for reduced motion.
 */
export const worldClock = uniform(0);

const texel = vec2(1 / meta.width, 1 / meta.height);
/** Metres of the DEM at `fUV` (u east, v south). */
const demHeight = (demTex: DataTexture, fUV: Node<'vec2'>) => texture(demTex, fUV).r;
/** The DEM's shading normal at `fUV`: its slopes in metres per metre, steepened so the relief reads at map scale. */
function demNormal(demTex: DataTexture, fUV: Node<'vec2'>) {
  const hx = texture(demTex, fUV.add(vec2(texel.x, 0))).r.sub(texture(demTex, fUV.sub(vec2(texel.x, 0))).r);
  const hz = texture(demTex, fUV.add(vec2(0, texel.y))).r.sub(texture(demTex, fUV.sub(vec2(0, texel.y))).r);
  const shadeK = float(EXAGGERATION * 0.55);
  return normalize(vec3(hx.mul(shadeK).negate().div(meta.metersPerPixel * 2), 1, hz.mul(shadeK).negate().div(meta.metersPerPixel * 2)));
}

/** The terrain mesh, MAP_W x MAP_H units centred on the origin; land stands up, the sea is flat. */
export function buildTerrain(demTex: DataTexture, segments: number) {
  const geo = new PlaneGeometry(MAP_W, MAP_H, segments, Math.round((segments * meta.height) / meta.width));
  geo.rotateX(-Math.PI / 2);
  const m = new MeshBasicNodeMaterial();
  const fUV = vec2(uv().x, float(1).sub(uv().y));
  const hV = texture(demTex, fUV).level(float(0)).r;
  // The relief settles to flat sea at the map's border, so no land stands cut off against the mist there.
  const rim = smoothstep(0, 0.07, uv().x).mul(smoothstep(1, 0.93, uv().x)).mul(smoothstep(0, 0.09, uv().y)).mul(smoothstep(1, 0.91, uv().y));
  m.positionNode = positionLocal.add(vec3(0, max(hV, 0).mul(V_SCALE).mul(rim), 0));
  const h = demHeight(demTex, fUV);
  const n = demNormal(demTex, fUV);
  const L = normalize(vec3(-0.55, 0.62, -0.55));
  const lit = clamp(dot(n, L), 0, 1);
  const slope = float(1).sub(n.y);
  // A dark chart under the black glass, in the same palette as the phone map (scripts/build-ui-map.mjs): slate land with
  // soft relief, a near-black sea lighter on the shelf, a pale hairline coast.
  const land = h.greaterThan(0);
  const hi = smoothstep(0, 900, h).mul(0.6);
  const lum = clamp(float(0.86).add(lit.sub(0.62).mul(1.5)).sub(slope.mul(0.55)), 0.35, 1.04);
  const stone = mix(srgb(70, 77, 84), srgb(96, 103, 109), hi);
  const shadowTint = srgb(28, 33, 38);
  const band = abs(fract(h.div(250)).sub(0.5));
  const contour = smoothstep(0.47, 0.5, band.add(fwidth(h.div(250)).mul(0.6))).mul(smoothstep(80, 200, h)).mul(0.1);
  const landColor = mix(mix(shadowTint, stone, lum), srgb(118, 132, 146), contour);
  const depth = h.negate().max(0);
  const seaShelf = mix(srgb(28, 40, 51), srgb(15, 22, 29), smoothstep(0, 80, depth));
  const seaShadow = float(1).sub(smoothstep(0, 14, depth)).mul(0.1);
  // The swell lines run in the mesh's own units, so their spacing does not depend on where the mesh is placed.
  const waves = sin(positionLocal.z.mul(5.2).add(sin(positionLocal.x.mul(0.9)).mul(1.4))).mul(0.5).add(0.5);
  const waveLines = smoothstep(0.94, 1, waves).mul(0.03).mul(smoothstep(30, 400, depth));
  const seaColor = seaShelf.mul(float(1).sub(seaShadow).sub(waveLines));
  const coastW = fwidth(h).mul(1.3).add(2);
  const coast = float(1).sub(smoothstep(0, coastW, abs(h)));
  const base = land.select(landColor, seaColor);
  const withCoast = mix(base, srgb(118, 132, 146), coast.mul(0.6));
  const edge = smoothstep(0, 0.08, uv().x).mul(smoothstep(1, 0.92, uv().x)).mul(smoothstep(0, 0.1, uv().y)).mul(smoothstep(1, 0.9, uv().y));
  m.colorNode = mix(MIST, withCoast, edge);
  const mesh = new Mesh(geo, m);
  mesh.frustumCulled = false;
  return mesh;
}
