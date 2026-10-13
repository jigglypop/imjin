import { LinearMipmapLinearFilter, MeshStandardNodeMaterial, NoColorSpace, SRGBColorSpace, TextureLoader, type Texture } from 'three/webgpu';
import { attribute, dFdx, dFdy, float, fract, mix, mx_noise_float, normalMap, positionWorld, select, texture, uv, varying, vec2, vec3 } from 'three/tsl';
import { TINT_RANGE } from '../../ships/build/pack';
import { BUILDING_ATLAS, buildingAtlasFiles } from './buildingAtlas';
import type { FactionId } from './types';

/**
 * A navy's building material: its atlas read the way the battle reads the ships' (each vertex names its cell, the cell's
 * texture repeats by the metre, explicit gradients keep the mip level steady across the wrap), with the normal and
 * roughness maps derived from it, shaded by the occlusion the kit baked into its vertices (darker at the foot of a wall
 * and under the eaves) and lit by the map's sun and sky. The weathering is light, as on a well-kept town: one building a
 * shade lighter or warmer than its neighbour, and broad soft patches so a long wall or roof does not show its repeat.
 */
export async function campMaterial(navy: FactionId): Promise<{ material: MeshStandardNodeMaterial; textures: Texture[] }> {
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
  const [albedo, normal, rough] = await Promise.all([load(files.albedo, true), load(files.normal, false), load(files.rough, false)]);
  const m = new MeshStandardNodeMaterial({ metalness: 0 });
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
  // One building differs from the next by where it stands (its instance's place on the map), not by its geometry.
  const W: any = positionWorld;
  const tone = mx_noise_float(W.mul(120)).mul(0.5).add(0.5);
  const patch = mx_noise_float(W.mul(900)).mul(0.5).add(0.5);
  let colour: any = sample(albedo).rgb.mul(tint);
  colour = colour.mul(mix(vec3(0.94, 0.95, 0.97), vec3(1.05, 1.03, 0.99), tone)).mul(mix(float(0.93), float(1.04), patch));
  m.colorNode = colour;
  m.normalNode = normalMap(sample(normal).rgb, vec2(1, 1));
  const cloth = surf.equal(1).or(surf.equal(4));
  m.roughnessNode = select(cloth, float(0.95), sample(rough).g.max(0.35));
  m.metalnessNode = select(surf.equal(2), float(0.5), float(0));
  return { material: m, textures: [albedo, normal, rough] };
}
