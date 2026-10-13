import { LinearMipmapLinearFilter, MeshLambertNodeMaterial, NoColorSpace, SRGBColorSpace, TextureLoader, type Texture } from 'three/webgpu';
import { attribute, dFdx, dFdy, float, fract, mix, mx_noise_float, normalMap, positionWorld, texture, uv, varying, vec2, vec3 } from 'three/tsl';
import { TINT_RANGE } from '../../ships/build/pack';
import { BUILDING_ATLAS, buildingAtlasFiles } from './buildingAtlas';
import type { FactionId } from './types';

/**
 * A navy's building material: its atlas read the way the battle reads the ships' (each vertex names its cell, the cell's
 * texture repeats by the metre, explicit gradients keep the mip level steady across the wrap) with the normal map
 * derived from it, shaded by the occlusion the kit baked into its vertices (darker at the foot of a wall and under the
 * eaves) and lit by the map's sun and sky. Lambert shading, no specular: a town fills much of the screen close up, and
 * its pixels must cost about what the map's own ground does. One building differs from its neighbour by a shade of
 * colour, worked out per vertex from where it stands.
 */
export async function campMaterial(navy: FactionId): Promise<{ material: MeshLambertNodeMaterial; textures: Texture[] }> {
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
  const [albedo, normal] = await Promise.all([load(files.albedo, true), load(files.normal, false)]);
  const m = new MeshLambertNodeMaterial();
  // Packed bytes, see pack.ts: mat = (atlas cell * 16 + surface class, sway phase, soot), color.xyz = the sqrt-coded tint.
  const U: any = uv();
  const mat: any = attribute('mat', 'vec4');
  const shade: any = attribute('color', 'vec4');
  const { grid, cell: size, pad } = BUILDING_ATLAS;
  const cell = mat.x.mul(255).add(0.5).floor().div(16).floor();
  const usable = (size - pad * 2) / size;
  const local = vec2(fract(U.x), float(1).sub(fract(U.y))).mul(usable).add(pad / size);
  const at = vec2(cell.mod(grid), cell.div(grid).floor()).add(local).div(grid);
  const k = usable / grid;
  const gx = dFdx(U).mul(k), gy = dFdy(U).mul(k);
  const sample = (t: Texture) => texture(t, at).grad(gx, gy);
  const tint: any = varying(shade.xyz.mul(shade.xyz).mul(TINT_RANGE));
  const tone: any = varying(mx_noise_float(positionWorld.mul(120)).mul(0.5).add(0.5));
  m.colorNode = sample(albedo).rgb.mul(tint).mul(mix(vec3(0.93, 0.94, 0.96), vec3(1.06, 1.04, 1.0), tone));
  m.normalNode = normalMap(sample(normal).rgb, vec2(1, 1));
  return { material: m, textures: [albedo, normal] };
}
