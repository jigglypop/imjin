// The heightmap of a terrain spec for Node tools, region windows included. `load` is a vite ssrLoadModule.
// The windows are read from public/terrain, the files the browser fetches, so a tool and the game see the same ground.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const terrainDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'terrain');

export async function groundHeights(load, spec) {
  const { generateHeightmap } = await load('/src/terrain/generate.ts');
  if (!spec.region) return generateHeightmap(spec);
  const dem = await load('/src/terrain/regionDem.ts');
  dem.setRegionDemSource(async (id) => new Uint8Array(await readFile(join(terrainDir, `${id}.dem`))));
  return dem.regionHeightmap(spec, await dem.loadRegionDem(spec.region.id));
}
