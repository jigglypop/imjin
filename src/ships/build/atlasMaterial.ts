import { LinearMipmapLinearFilter, MeshStandardMaterial, NoColorSpace, SRGBColorSpace, TextureLoader, type Texture } from 'three/webgpu';
import { equipment } from '../../game/quality';
import { ATLAS, atlasFiles, type Faction } from './atlas';

const loader = new TextureLoader();
const cache = new Map<string, Promise<MeshStandardMaterial>>();

function load(url: string, color: boolean) {
  return loader.loadAsync(url).then((t: Texture) => {
    t.colorSpace = color ? SRGBColorSpace : NoColorSpace;
    // The atlas is addressed with v pointing down the image, see the shader in ShipRenderer.
    t.flipY = false;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.anisotropy = equipment.anisotropy;
    return t;
  });
}

/**
 * Faction atlas as a plain material carrying albedo, normal and roughness maps. ShipRenderer.createMaterial reads the
 * maps and flags it with userData.atlas to switch on tiled cell sampling. Phones get the 1k set.
 */
export function atlasMaterial(faction: Faction): Promise<MeshStandardMaterial> {
  const low = equipment.tier === 'low';
  const key = `${faction}${low ? '_1k' : ''}`;
  let p = cache.get(key);
  if (!p) {
    const files = atlasFiles(faction, low);
    p = Promise.all([load(files.albedo, true), load(files.normal, false), load(files.rough, false)]).then(([map, normalMap, roughnessMap]) => {
      const m = new MeshStandardMaterial({ map, normalMap, roughnessMap });
      m.userData.atlas = { ...ATLAS };
      return m;
    });
    cache.set(key, p);
  }
  return p;
}
