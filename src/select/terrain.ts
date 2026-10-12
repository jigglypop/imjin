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
import { abs, attribute, cameraPosition, mx_noise_vec3, clamp, dot, float, fract, fwidth, max, mix, mx_noise_float, normalize, positionLocal, positionWorld, pow, sin, smoothstep, texture, time, uniform, uv, vec2, vec3 } from 'three/tsl';
import meta from './demMeta.json';
import { EXAGGERATION, MAP_H, MAP_W, MIST_HEX, V_SCALE } from './demFrame';

// The ink-style relief of the south coast, shared by the historical-battle select screen (SelectScene) and the faction
// campaign map (src/ui/grand/MapScene.ts): one DEM, one material, so the two screens draw the same land.

/** A colour written in sRGB, as the node graph works in linear light. */
const srgb = (r: number, g: number, b: number) => vec3(...[r, g, b].map((v) => (v / 255) ** 2.2) as [number, number, number]);
// The mist the relief fades into is exactly the scene's background colour, so the terrain's edge does not show as a box.
const mistColor = new Color(MIST_HEX);
const MIST = vec3(mistColor.r, mistColor.g, mistColor.b);

/** Decodes /ui/korea_dem.webp into metre heights (for picking the ground) and the half-float texture the mesh reads. */
export async function loadDem(signal: AbortSignal) {
  signal.throwIfAborted();
  const img = await new TextureLoader().loadAsync('/ui/korea_dem.webp');
  try {
    signal.throwIfAborted();
    const source = img.image as HTMLImageElement | ImageBitmap;
    const w = meta.width;
    const h = meta.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(source as CanvasImageSource, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    const heights = new Float32Array(w * h);
    const half = new Uint16Array(w * h);
    for (let i = 0; i < w * h; i += 1) {
      const v = px[i * 4]! * 256 + px[i * 4 + 1]! + px[i * 4 + 2]! / 256 - 32768;
      heights[i] = v;
      half[i] = DataUtils.toHalfFloat(v);
    }
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
 * The campaign world's ambient clock in seconds: what drifts on its own (cloud shadows, camp smoke) moves with it. The
 * map's scene sets it every frame and holds it still for a player who asks for reduced motion.
 */
export const worldClock = uniform(0);

/**
 * How much light reaches the ground under the drifting clouds at a world position: 1 in the sun, down to `depth` under
 * a cloud. Two scales of noise, a few camps across, sliding slowly east and a little south.
 */
export function cloudShade(depth: number) {
  const drift = worldClock.mul(0.012);
  const x = positionWorld.x, z = positionWorld.z;
  const cover = mx_noise_float(vec3(x.mul(6).sub(drift), 0.7, z.mul(6).sub(drift.mul(0.35)))).mul(0.7)
    .add(mx_noise_float(vec3(x.mul(17).sub(drift.mul(1.6)), 2.1, z.mul(17))).mul(0.3));
  return float(1).sub(smoothstep(0.16, 0.34, cover).mul(depth));
}

/**
 * The water of the campaign world as one colour node: turquoise shallows to deep blue by `depth` (metres), a swell that
 * moves, a sky reflection at grazing angles and sun glints. It reads world positions, so the terrain's own sea and the plane
 * of sea round it match exactly where they meet.
 */
function worldSea(depth: Node<'float'>) {
  const wx = positionWorld.x, wz = positionWorld.z;
  const toDeep = smoothstep(0, 160, depth);
  const water = mix(mix(srgb(78, 172, 172), srgb(32, 112, 152), smoothstep(0, 28, depth)), srgb(14, 56, 98), toDeep);
  const view = normalize(cameraPosition.sub(positionWorld));
  // The swell is a few waves across a screen at close range and fades out with distance, where it would only be grain.
  const near = float(1).sub(smoothstep(0.15, 0.9, cameraPosition.sub(positionWorld).length()));
  const swell = mx_noise_float(vec3(wx.mul(60), time.mul(0.3), wz.mul(60))).mul(0.5)
    .add(mx_noise_float(vec3(wx.mul(190), time.mul(-0.45), wz.mul(190))).mul(0.25))
    .mul(near);
  const sunWorld = normalize(vec3(-0.55, 0.62, -0.55));
  const glint = pow(clamp(dot(normalize(view.add(sunWorld)), vec3(0, 1, 0)), 0, 1), 220).mul(smoothstep(0.1, 0.5, swell)).mul(2.6);
  const sky = pow(float(1).sub(clamp(view.y, 0, 1)), 3).mul(0.45);
  return mix(water.mul(float(0.9).add(swell.mul(0.22))).mul(cloudShade(0.26)), srgb(150, 188, 214), sky).add(vec3(1, 0.93, 0.78).mul(glint));
}

/**
 * The sea round the DEM: a plane at sea level with the same water, so the map has an ocean on every side out to the
 * horizon, where the fog has made it the haze of the sky. `size` is its side in world units, wider than the camera sees.
 */
export function buildSea(size: number) {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = worldSea(float(400));
  const mesh = new Mesh(new PlaneGeometry(size, size).rotateX(-Math.PI / 2), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  return mesh;
}

const texel = vec2(1 / meta.width, 1 / meta.height);
/** Metres of the DEM at `fUV` (u east, v south). */
const demHeight = (demTex: DataTexture, fUV: Node<'vec2'>) => texture(demTex, fUV).r;
/**
 * The DEM's shading normal at `fUV`: its slopes in metres per metre, steepened so the relief reads at map scale. With
 * `southward` -1 the DEM is read mirrored north to south (farLand.ts carries it on past its north edge that way).
 */
function demNormal(demTex: DataTexture, fUV: Node<'vec2'>, southward: Node<'float'> | number = 1) {
  const hx = texture(demTex, fUV.add(vec2(texel.x, 0))).r.sub(texture(demTex, fUV.sub(vec2(texel.x, 0))).r);
  const hz = texture(demTex, fUV.add(vec2(0, texel.y))).r.sub(texture(demTex, fUV.sub(vec2(0, texel.y))).r).mul(southward);
  const shadeK = float(EXAGGERATION * 0.55);
  return normalize(vec3(hx.mul(shadeK).negate().div(meta.metersPerPixel * 2), 1, hz.mul(shadeK).negate().div(meta.metersPerPixel * 2)));
}

/**
 * The campaign world's land at `h` metres with shading normal `n`: sunlit fields, woods, rock and beaches under the
 * drifting cloud shadows. `local` is the position in the terrain mesh's own frame (map units), where the noise that
 * breaks the colours up into woods and fields runs, so the far land coloured with it matches the DEM exactly.
 */
function worldLand(h: Node<'float'>, n: Node<'vec3'>, local: Node<'vec3'>) {
  const slope = float(1).sub(n.y);
  const sunLocal = normalize(vec3(-0.55, 0.62, -0.55));
  // Light on the ground: the sun's share plus a sky ambient, so the shaded sides keep their colour.
  const sunShare = clamp(dot(n, sunLocal), 0, 1);
  const lightOn = mix(float(0.5), float(1.15), sunShare);
  // Noise at three scales breaks the colours up into woods, fields and bare ground.
  const broad = mx_noise_float(vec3(local.x.mul(0.7), 0, local.z.mul(0.7))).mul(0.5).add(0.5);
  const medium = mx_noise_float(vec3(local.x.mul(3.1), 1.7, local.z.mul(3.1))).mul(0.5).add(0.5);
  const fine = mx_noise_float(vec3(local.x.mul(13), 3.3, local.z.mul(13))).mul(0.5).add(0.5);
  const grass = mix(srgb(124, 152, 84), srgb(168, 172, 100), medium);
  const forest = mix(srgb(40, 76, 48), srgb(62, 98, 58), fine.mul(0.6).add(medium.mul(0.4)));
  const woody = smoothstep(0.32, 0.62, broad.mul(0.7).add(medium.mul(0.3))).max(smoothstep(60, 220, h));
  const ground = mix(grass, forest, woody);
  const bare = smoothstep(0.16, 0.4, slope).max(smoothstep(650, 1500, h).mul(0.8));
  const rock = mix(srgb(112, 102, 90), srgb(158, 150, 138), smoothstep(600, 1700, h).add(fine.mul(0.3)));
  const beach = float(1).sub(smoothstep(0.6, 3.2, h));
  return mix(mix(ground, rock, bare), srgb(196, 178, 138), beach).mul(lightOn).mul(cloudShade(0.32));
}

/**
 * The far land's material (farLand.ts): the world's land colour, as the terrain's. Near the DEM it reads the DEM itself,
 * mirrored past the north edge just as the far land's heights are, so colour and relief run on across the join pixel for
 * pixel; farther north it blends into the hills' own heights and normals by the vertices' `blend`.
 */
export function buildFarLandMaterial(demTex: DataTexture, shear: number) {
  const m = new MeshBasicNodeMaterial();
  const local = attribute('local', 'vec2');
  const ahead = local.y.div(MAP_H).add(0.5);
  const north = ahead.negate().max(0);
  const fUV = vec2(local.x.div(MAP_W).add(0.5).sub(north.mul(shear)), abs(ahead));
  const southward = ahead.lessThan(0).select(float(-1), float(1));
  const blend = attribute('blend', 'float');
  const h = mix(demHeight(demTex, fUV), attribute('hills', 'float'), blend);
  // The hills' mesh is coarser than the DEM's 160 m texels: a little noise in their normal gives them the same grain.
  const grain = mx_noise_vec3(vec3(local.x.mul(9), 0.4, local.y.mul(9))).mul(0.5)
    .add(mx_noise_vec3(vec3(local.x.mul(27), 1.9, local.y.mul(27))).mul(0.32))
    .add(mx_noise_vec3(vec3(local.x.mul(81), 3.7, local.y.mul(81))).mul(0.2));
  const hillNormal = attribute('hillNormal', 'vec3').add(vec3(grain.x, 0, grain.z));
  const n = normalize(mix(demNormal(demTex, fUV, southward), hillNormal, blend));
  m.colorNode = worldLand(h, n, vec3(local.x, 0, local.y));
  return m;
}

/**
 * The terrain mesh, MAP_W x MAP_H units centred on the origin; land stands up, the sea is flat. As the `world` it is the
 * campaign's 3D world instead of the select screen's ink chart: sunlit green land with forest, fields, rock and beaches,
 * and a sea that goes from turquoise shallows to deep blue, with a moving sheen, sun glints and foam along the coast.
 */
export function buildTerrain(demTex: DataTexture, segments: number, world = false) {
  const geo = new PlaneGeometry(MAP_W, MAP_H, segments, Math.round((segments * meta.height) / meta.width));
  geo.rotateX(-Math.PI / 2);
  const m = new MeshBasicNodeMaterial();
  const fUV = vec2(uv().x, float(1).sub(uv().y));
  const hV = texture(demTex, fUV).level(float(0)).r;
  // The relief settles to flat sea at the map's border, so no land stands cut off against the mist there. The campaign's
  // world carries the mainland on north of the DEM (farLand.ts), so there the north edge keeps its relief, and its west and
  // east edges only ease the land down in the last few texels: wide rims would flatten Haenam and Ulsan into the sea.
  const northRim = world ? float(1) : smoothstep(1, 0.91, uv().y);
  const side = world ? 0.006 : 0.07;
  const rim = smoothstep(0, side, uv().x).mul(smoothstep(1, 1 - side, uv().x)).mul(smoothstep(0, 0.09, uv().y)).mul(northRim);
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
  // Local, not world, position: the campaign map scales the mesh to its frame and the swell lines must stay the same.
  const waves = sin(positionLocal.z.mul(5.2).add(sin(positionLocal.x.mul(0.9)).mul(1.4))).mul(0.5).add(0.5);
  const waveLines = smoothstep(0.94, 1, waves).mul(0.03).mul(smoothstep(30, 400, depth));
  const seaColor = seaShelf.mul(float(1).sub(seaShadow).sub(waveLines));
  const coastW = fwidth(h).mul(1.3).add(2);
  const coast = float(1).sub(smoothstep(0, coastW, abs(h)));
  const base = land.select(landColor, seaColor);
  const withCoast = mix(base, srgb(118, 132, 146), coast.mul(0.6));
  const edge = smoothstep(0, 0.08, uv().x).mul(smoothstep(1, 0.92, uv().x)).mul(smoothstep(0, 0.1, uv().y)).mul(smoothstep(1, 0.9, uv().y));
  if (world) {
    const landWorld = worldLand(h, n, positionLocal);
    // The sea: the DEM's seabed gives the depth; its west, east and south edges melt into the deep sea of the plane round it.
    const sea = worldSea(depth);
    const surf = coast.mul(float(0.75).add(sin(time.mul(1.3).add(positionLocal.x.mul(11)).add(positionLocal.z.mul(7))).mul(0.2))).mul(0.5);
    const worldColor = mix(land.select(landWorld, sea), srgb(236, 244, 244), surf);
    // Only the water melts into the open sea at the DEM's sides and north edge (the land there runs on into farLand.ts or
    // reaches the edge as it does), so no shelf ends in a straight line and no coast is washed out.
    const waterEdge = smoothstep(0, 0.1, uv().x).mul(smoothstep(1, 0.9, uv().x)).mul(smoothstep(1, 0.95, uv().y));
    const seaEdge = smoothstep(0, 0.12, uv().y).mul(land.select(float(1), waterEdge));
    m.colorNode = mix(worldSea(float(400)), worldColor, seaEdge);
  } else {
    m.colorNode = mix(MIST, withCoast, edge);
  }
  const mesh = new Mesh(geo, m);
  mesh.frustumCulled = false;
  return mesh;
}
