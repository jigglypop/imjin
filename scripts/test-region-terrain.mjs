// The real ground of the campaign regions: the elevation windows decode and are the same every time, every region's capture
// points lie on water by a shore, the regions differ in what grows and stands on them, and the old generated maps are untouched.
// Building and stepping a battle on each region is in test-grand.mjs (section 7), which reads these same windows.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { groundHeights } from './region-ground.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`PASS ${name}`); } catch (error) { failures += 1; console.error(`FAIL ${name}`, error); }
};

try {
  const [{ generateHeightmap, SACHEON_TERRAIN }, dem, { computeFeatures }, { REGION_ORDER }, { REGION_SITES, REGION_MAPS }, { DEFAULT_BIOME }] = await Promise.all([
    load('/src/terrain/generate.ts'), load('/src/terrain/regionDem.ts'), load('/src/terrain/features.ts'), load('/src/sim/grand/regions.ts'), load('/src/sim/grand/coast.ts'), load('/src/terrain/region.ts'),
  ]);
  dem.setRegionDemSource(async (id) => new Uint8Array(await readFile(join(root, 'public', 'terrain', `${id}.dem`))));
  const land = new Map();
  const heights = new Map();
  for (const id of REGION_ORDER) {
    const window = await dem.loadRegionDem(id);
    land.set(id, window);
    heights.set(id, dem.regionHeightmap(REGION_SITES[id].terrain, window));
  }

  await check('every region has a window that decodes to a 16 km square with land and sea in it', () => {
    for (const id of REGION_ORDER) {
      const w = land.get(id);
      assert.equal(w.n, 1024, id);
      assert.equal(w.n * w.cell, REGION_SITES[id].terrain.size, id);
      const landShare = w.heights.reduce((n, h) => n + (h > 0 ? 1 : 0), 0) / w.heights.length;
      assert.ok(landShare > 0.1 && landShare < 0.95, `${id}: ${landShare.toFixed(2)} land`);
      assert.ok(w.heights.every((h) => Number.isFinite(h) && h >= 0 && h < 2000), `${id}: heights out of range`);
    }
  });

  await check('a window packs and unpacks to the same samples, and a damaged file is refused', async () => {
    const w = land.get('yeosu');
    const again = await dem.decodeRegionDem(await dem.encodeRegionDem(w));
    assert.deepEqual(again.heights, w.heights);
    const bytes = await dem.encodeRegionDem(w);
    await assert.rejects(dem.decodeRegionDem(bytes.slice(0, bytes.length >> 1)));
    await assert.rejects(dem.decodeRegionDem(new Uint8Array([1, 2, 3])));
  });

  await check('the heightmap of a region is the same on every build, with land above the sea and a floor below it', () => {
    for (const id of ['yeosu', 'liaodong']) {
      const spec = REGION_SITES[id].terrain;
      const a = heights.get(id);
      const b = dem.regionHeightmap(spec, land.get(id));
      assert.equal(createHash('sha1').update(Buffer.from(a.buffer)).digest('hex'), createHash('sha1').update(Buffer.from(b.buffer)).digest('hex'), id);
      assert.equal(a.length, spec.res * spec.res);
      assert.ok(a.some((h) => h > 100) && a.some((h) => h < -40), `${id}: no relief or no deep water`);
      assert.ok(a.every(Number.isFinite), id);
    }
  });

  await check('a region ground that cannot load is an error, not an empty map', async () => {
    await assert.rejects(dem.loadRegionDem('atlantis'));
  });

  // The turned map is what ships sail on, so the points are tested on the unturned heightmap the points were found on.
  const at = (id, x, z) => {
    const { size, res } = REGION_SITES[id].terrain;
    const h = heights.get(id);
    const i = Math.max(0, Math.min(res - 1, Math.round(((x + size / 2) / size) * res - 0.5)));
    const j = Math.max(0, Math.min(res - 1, Math.round(((z + size / 2) / size) * res - 0.5)));
    return h[j * res + i];
  };
  await check('every region has capture points on deep water, home ports about 1.2 km apart and the contested water equidistant', () => {
    for (const id of REGION_ORDER) {
      const pts = REGION_MAPS[id].points;
      assert.ok(pts.length >= 3 && pts.length <= 5, `${id}: ${pts.length} points`);
      for (const p of pts) assert.ok(at(id, p.x, p.z) < -6, `${id}: ${p.name} on land or shoal`);
      const homes = pts.filter((p) => p.home !== undefined);
      assert.equal(homes.length, 2, id);
      const gap = Math.hypot(homes[0].x - homes[1].x, homes[0].z - homes[1].z);
      assert.ok(gap > 1000 && gap < 1400, `${id}: ports ${gap.toFixed(0)} m apart`);
      for (const p of pts.filter((q) => q.home === undefined)) {
        const a = Math.hypot(p.x - homes[0].x, p.z - homes[0].z);
        const d = Math.hypot(p.x - homes[1].x, p.z - homes[1].z);
        assert.ok(Math.abs(a - d) < 12, `${id}: ${p.name} is ${a.toFixed(0)} m from one port and ${d.toFixed(0)} m from the other`);
      }
    }
  });

  await check('the regions are dressed differently: forest, farmland, roofs and beacons follow the biome', () => {
    const stats = (id) => {
      const spec = REGION_SITES[id].terrain;
      const f = computeFeatures(spec, heights.get(id));
      const cover = (channel) => { let n = 0; for (let k = channel; k < f.mask.length; k += 4) n += f.mask[k] > 100 ? 1 : 0; return n / (f.mask.length / 4); };
      const houses = f.structures.filter((s) => s.type === 'choga' || s.type === 'giwa');
      return { forest: cover(0), field: cover(2), houses: houses.length, tiled: houses.filter((s) => s.type === 'giwa').length / Math.max(1, houses.length), beacons: f.structures.filter((s) => s.type === 'bongsu').length };
    };
    const yeosu = stats('yeosu');
    const mokpo = stats('mokpo');
    const liaodong = stats('liaodong');
    const nagoya = stats('nagoya');
    const hansan = stats('hansan');
    assert.ok(liaodong.forest < yeosu.forest * 0.5, `liaodong ${liaodong.forest.toFixed(3)} against yeosu ${yeosu.forest.toFixed(3)} forest`);
    assert.ok(mokpo.field > yeosu.field * 1.5, `mokpo ${mokpo.field.toFixed(3)} against yeosu ${yeosu.field.toFixed(3)} fields`);
    assert.ok(nagoya.tiled > 0.6 && yeosu.tiled < 0.45, `roofs: nagoya ${nagoya.tiled.toFixed(2)}, yeosu ${yeosu.tiled.toFixed(2)}`);
    assert.ok(hansan.houses < yeosu.houses, `hansan ${hansan.houses} houses against yeosu ${yeosu.houses}`);
    assert.ok(liaodong.beacons >= 3 && nagoya.beacons <= 1, `beacons: liaodong ${liaodong.beacons}, nagoya ${nagoya.beacons}`);
  });

  await check('the historical battles and conquest maps are untouched: the old generator and the default biome give byte-identical heights, woods and villages', () => {
    const h = generateHeightmap(SACHEON_TERRAIN);
    // Both hashes were recorded from the code before region windows existed.
    assert.equal(createHash('sha1').update(Buffer.from(h.buffer)).digest('hex'), '11dd7658f19f5869f3320d11adc426618fe4baee');
    const f = computeFeatures(SACHEON_TERRAIN, h);
    assert.equal(createHash('sha1').update(Buffer.from(f.mask.buffer)).update(JSON.stringify(f.structures)).digest('hex'), 'a58f60bf0f98e19e81689dcb86624d014fae01b9');
    assert.equal(DEFAULT_BIOME.villages, 7);
  });
  await check('the 1588 Channel coasts are dressed as England and Flanders: their own houses, a church, hedgerows, no Korean house, beacon or gate', async () => {
    const armada = await load('/src/terrain/armadaTerrain.ts');
    const kits = await load('/src/terrain/europeKits.ts');
    const KOREAN = new Set(['choga', 'giwa', 'fortgate', 'bongsu']);
    for (const [name, style] of [['PLYMOUTH_TERRAIN', 'english'], ['PORTLAND_TERRAIN', 'english'], ['WIGHT_TERRAIN', 'english'], ['CALAIS_TERRAIN', 'flemish'], ['GRAVELINES_TERRAIN', 'flemish']]) {
      const spec = armada[name];
      // The battles are fought on their real coasts (src/terrain/battleWindows.json).
      assert.equal(spec.region.biome.style, style, name);
      const f = computeFeatures(spec, await groundHeights(load, spec));
      const count = (type) => f.structures.filter((s) => s.type === type).length;
      assert.ok(!f.structures.some((s) => KOREAN.has(s.type)), `${name}: ${[...new Set(f.structures.map((s) => s.type))]}`);
      const houses = style === 'english' ? count('cottage') + count('tudor') : count('gable');
      const churches = count(style === 'english' ? 'church' : 'spire');
      assert.ok(houses >= 10 && churches >= 1 && count('hedge') >= 10, `${name}: ${houses} houses, ${churches} churches, ${count('hedge')} hedges`);
      if (style === 'english') assert.ok(count('cottage') > 0 && count('tudor') > 0, `${name}: stone ${count('cottage')}, timber ${count('tudor')}`);
      // Every structure stands on land.
      for (const s of f.structures) assert.ok(s.y > 1.5, `${name}: ${s.type} at ${s.y.toFixed(1)} m`);
    }
    // Phone budget: every kit is one draw of a few hundred triangles, no texture.
    for (const type of ['cottage', 'tudor', 'church', 'gable', 'spire', 'hedge']) assert.ok(kits.kitTriangles(type) <= 900, `${type}: ${kits.kitTriangles(type)} triangles`);
  });
} catch (error) {
  failures += 1;
  console.error(error);
}
await server.close();
console.log(failures ? `region terrain: ${failures} failed` : 'region terrain: all passed');
process.exit(failures ? 1 : 0);
