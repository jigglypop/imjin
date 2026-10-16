import { LinearMipmapLinearFilter, MeshBasicNodeMaterial, NoColorSpace, SRGBColorSpace, TextureLoader, type Texture } from 'three/webgpu';
import { attribute, cameraWorldMatrix, dFdx, dFdy, float, fract, mix, mx_noise_float, normalMap, positionWorld, step, texture, transformDirection, uv, varying, vec2, vec3 } from 'three/tsl';
import { TINT_RANGE } from '../../ships/build/pack';
import { SURF } from '../../ships/build/surf';
import { BUILDING_ATLAS, buildingAtlasFiles } from './buildingAtlas';
import { SKY_LIGHT, SUN_DIRECTION, SUN_LIGHT } from './groundPalette';
import type { FactionId } from './types';

/**
 * The sky a building takes, as shares of the land's sky light: on a wall, and how much more a face pointing up gets (or
 * less, one pointing down). The land's own sky is 0.75 on its steepest slopes; but no hillside is a wall, and the
 * opening view looks north at the walls the north-west sun leaves in shade, where white plaster would read grey.
 */
const SKY_WALL = 1;
const SKY_UP = 0.25;
/**
 * A soft fill of the sky's colour from the south-west, behind the camera's left as the map opens: the faces the sun
 * misses are told apart, those towards the viewer brighter than those turned east, and a building keeps its form.
 */
const FILL = 0.35;
const FILL_DIRECTION = (() => {
  const d = [-0.45, 0.3, 0.84], l = Math.hypot(d[0]!, d[1]!, d[2]!);
  return d.map((c) => c / l) as [number, number, number];
})();
/** How much of the sun a banner's cloth lets through to its shaded side. */
const BANNER_THROUGH = 0.8;

/**
 * A navy's building atlas, its colour and its normal map: loaded once for every material that reads it (the map's kits
 * and the hero camps share one pair a navy).
 */
export async function loadBuildingAtlas(navy: FactionId): Promise<Texture[]> {
  const loader = new TextureLoader();
  const files = buildingAtlasFiles(navy);
  const load = async (url: string, colour: boolean) => {
    const t = await loader.loadAsync(url);
    t.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
    // The atlas is addressed with v pointing down the image, as in the battle.
    t.flipY = false;
    t.minFilter = LinearMipmapLinearFilter;
    return t;
  };
  return Promise.all([load(files.albedo, true), load(files.normal, false)]);
}

/**
 * A navy's building material: its atlas (`atlas`, loaded here when not given) read the way the battle reads the ships' (each vertex names its cell, the cell's
 * texture repeats by the metre, explicit gradients keep the mip level steady across the wrap) with the normal map
 * derived from it, shaded by the occlusion the kit baked into its vertices (darker at the foot of a wall and under the
 * eaves) and lit as the land is lit (groundPalette.ts): the same sun from the north-west and the same sky, worked out
 * here rather than by the scene's lights, so a building's sunny side is the hills' sunny side. No other light: a town
 * fills much of the screen close up, and its pixels must cost about what the map's own ground does. One building differs
 * from its neighbour by a shade of colour, worked out per vertex from where it stands.
 */
export async function campMaterial(navy: FactionId, atlas: Promise<Texture[]> = loadBuildingAtlas(navy)): Promise<{ material: MeshBasicNodeMaterial; textures: Texture[] }> {
  const [albedo, normal] = await atlas;
  const m = new MeshBasicNodeMaterial();
  // Packed bytes, see pack.ts: mat = (atlas cell * 16 + surface class, sway phase, soot), color.xyz = the sqrt-coded tint.
  const U: any = uv();
  const mat: any = attribute('mat', 'vec4');
  const shade: any = attribute('color', 'vec4');
  const { grid, cell: size, pad } = BUILDING_ATLAS;
  const cellSurf = mat.x.mul(255).add(0.5).floor();
  const cell = cellSurf.div(16).floor();
  const surf = cellSurf.sub(cell.mul(16));
  const usable = (size - pad * 2) / size;
  const local = vec2(fract(U.x), float(1).sub(fract(U.y))).mul(usable).add(pad / size);
  const at = vec2(cell.mod(grid), cell.div(grid).floor()).add(local).div(grid);
  const k = usable / grid;
  const gx = dFdx(U).mul(k), gy = dFdy(U).mul(k);
  const sample = (t: Texture) => texture(t, at).grad(gx, gy);
  const tint: any = varying(shade.xyz.mul(shade.xyz).mul(TINT_RANGE));
  const tone: any = varying(mx_noise_float(positionWorld.mul(120)).mul(0.5).add(0.5));
  // The surface's normal in the world, the atlas's relief included.
  const bumped: any = normalMap(sample(normal).rgb, vec2(1, 1));
  const n: any = transformDirection(bumped, cameraWorldMatrix);
  // A banner's thin cloth lets the sun through: seen from the shaded side it glows in its own colour. Picked by
  // arithmetic, not a branch: the normal is worked out once for both.
  const toSun = n.dot(vec3(...SUN_DIRECTION));
  const banner = step(SURF.banner - 0.5, surf).mul(step(surf, SURF.banner + 0.5));
  const sun = mix(toSun.max(0), toSun.abs().mul(BANNER_THROUGH), banner);
  const sky = n.y.mul(SKY_UP).add(SKY_WALL).add(n.dot(vec3(...FILL_DIRECTION)).max(0).mul(FILL));
  const light = vec3(...SUN_LIGHT).mul(sun).add(vec3(...SKY_LIGHT).mul(sky));
  m.colorNode = sample(albedo).rgb.mul(tint).mul(mix(vec3(0.93, 0.94, 0.96), vec3(1.06, 1.04, 1.0), tone)).mul(light);
  return { material: m, textures: [albedo, normal] };
}
