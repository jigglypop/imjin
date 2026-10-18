import { LinearMipmapLinearFilter, MeshStandardMaterial, NoColorSpace, SRGBColorSpace, TextureLoader, type Texture } from 'three/webgpu';
import { equipment } from '../../game/quality';
import { ATLAS, atlasFiles, hasKindAtlas, type Faction } from './atlas';

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
 * Navy (or ship, see atlasFiles) atlas as a plain material carrying albedo, normal and roughness maps. ShipRenderer.createMaterial reads the
 * maps and flags it with userData.atlas to switch on tiled cell sampling. Phones get the 1k set.
 */
export function atlasMaterial(faction: Faction, kind?: string): Promise<MeshStandardMaterial> {
  // A ship's own atlas comes in 2048 for the high tier and 1k for tablets and phones; a navy's 1k set is for phones only.
  const own = !!kind && hasKindAtlas(kind);
  const low = own ? equipment.tier !== 'high' : equipment.tier === 'low';
  const key = `${own ? kind : faction}${low ? '_1k' : ''}`;
  let p = cache.get(key);
  if (!p) {
    const files = atlasFiles(faction, low, own ? kind : undefined);
    p = Promise.all([load(files.albedo, true), load(files.normal, false), load(files.rough, false)]).then(([map, normalMap, roughnessMap]) => {
      const m = new MeshStandardMaterial({ map, normalMap, roughnessMap });
      m.userData.atlas = { ...ATLAS };
      return m;
    });
    cache.set(key, p);
  }
  return p;
}
