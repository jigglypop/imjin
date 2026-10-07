import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PUBLIC = join(ROOT, 'public');

const HDRIS = [
  ['kloofendal_48d_partly_cloudy_puresky', '4k'],
  ['table_mountain_1_puresky', '4k'],
  ['kloppenheim_06_puresky', '4k'],
  ['kloofendal_overcast_puresky', '4k'],
  ['qwantani_moonrise_puresky', '4k'],
];

const TEXTURES = [
  ['brown_planks_07', '2k'],
  ['brown_planks_04', '2k'],
  ['brown_planks_03', '2k'],
  ['planks_brown_10', '2k'],
  ['black_painted_planks', '2k'],
  ['japanese_cedar_planks', '1k'],
  ['grey_roof_tiles', '2k'],
  ['rough_linen', '1k'],
  ['rusty_metal_02', '1k'],
  ['aerial_rocks_02', '2k'],
  ['cliff_side', '2k'],
  ['coast_land_rocks_01', '2k'],
  ['aerial_grass_rock', '2k'],
  ['coast_sand_01', '2k'],
  ['forest_leaves_02', '1k'],
];

const MAPS = { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' };

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, out) {
  if (await exists(out)) return 'cached';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  return 'ok';
}

async function files(id) {
  const res = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!res.ok) throw new Error(`files ${id}: ${res.status}`);
  return res.json();
}

async function fetchHdri(id, res) {
  const info = await files(id);
  const url = info.hdri?.[res]?.hdr?.url;
  if (!url) throw new Error(`no hdr ${res} for ${id}`);
  const out = join(PUBLIC, 'hdri', `${id}_${res}.hdr`);
  console.log('hdri', id, await download(url, out));
}

async function fetchTexture(id, res) {
  const info = await files(id);
  for (const [short, key] of Object.entries(MAPS)) {
    const entry = info[key]?.[res]?.jpg ?? info[key]?.[res]?.png;
    if (!entry) {
      console.warn('missing', id, key, res);
      continue;
    }
    const ext = entry.url.split('.').pop();
    const out = join(PUBLIC, 'textures', id, `${short}.${ext}`);
    console.log('tex', id, short, await download(entry.url, out));
  }
}

for (const [id, res] of TEXTURES) await fetchTexture(id, res);
for (const [id, res] of HDRIS) await fetchHdri(id, res);
console.log('done');
