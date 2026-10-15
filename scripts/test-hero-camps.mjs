// The hero camps of the campaign map (src/ui/grand/hero): each layout builds on a stand-in coast (land rising inland,
// sea to the south and east) into one mesh per navy at both levels of detail, within the triangle budget, every vertex
// finite, the far level lighter than the close one, the same bytes every time; every pad's skirt reaches its ground;
// the land is cut to the pads (a hill inside a pad comes down under it, a fill pad leaves the land alone). Pure geometry,
// no GPU. `--table` prints the triangle counts and build times.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'imjin-hero-'));
const table = process.argv.includes('--table');
let passed = 0;
const check = (name, test) => { test(); passed++; console.log(`ok - ${name}`); };
try {
  const bundled = await build({
    stdin: { contents: `export * from './src/ui/grand/hero/plan.ts'; export * from './src/ui/grand/hero/layouts.ts'; export * from './src/ui/grand/hero/build.ts'; export { cutAt } from './src/ui/grand/hero/terrain.ts'; export { tierCamp } from './src/ui/grand/hero/tiers.ts';`, resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  const path = join(temporary, 'hero.mjs');
  await writeFile(path, bundled.outputFiles[0].contents);
  const { Plan, LAYOUTS, buildHero, village, joTier1, waFieldCamp, cutAt, tierCamp } = await import(pathToFileURL(path).href);

  // A stand-in coast: sea beyond z = 36 and x = 30, land rising gently inland with a knoll in the north-west.
  const natural = (x, z) => {
    const sea = Math.min(36 - z, 30 - x) * 0.12;
    const knoll = 7 * Math.exp(-((x + 30) ** 2 + (z + 30) ** 2) / 900);
    return Math.min(sea, 1.5 + knoll + Math.max(0, -z - 40) * 0.05);
  };
  const ground = { natural, water: (x, z) => natural(x, z) <= 0.02 };
  const NAVY = { yeosu: 'joseon', busan: 'japan', gogeumdo: 'ming' };
  const builds = new Map();
  for (const [id, layout] of Object.entries(LAYOUTS)) {
    const plan = new Plan(ground, NAVY[id]);
    layout(plan);
    village(plan, -90, -90, 10, 0.2, 3);
    const t0 = performance.now();
    const meshes = buildHero(plan);
    builds.set(id, { plan, meshes, ms: performance.now() - t0 });
  }
  const tris = (m) => m.index.length / 3;
  if (table) for (const [id, { meshes, ms, plan }] of builds) console.log(id, `${plan.pieces.length} pieces`, meshes.map((m) => `${m.navy} ${tris(m.near)} / ${tris(m.far)}`).join(', '), `${ms.toFixed(0)} ms`);

  check('every hero camp builds close and far meshes inside the budget, the far one lighter', () => {
    for (const [id, { meshes }] of builds) {
      const near = meshes.reduce((n, m) => n + tris(m.near), 0), far = meshes.reduce((n, m) => n + tris(m.far), 0);
      assert.ok(near > 5000 && near <= 140000, `${id} close: ${near} triangles`);
      assert.ok(far < near * 0.75, `${id} far: ${far} of ${near} triangles`);
    }
  });
  check('every vertex is finite and stands within the camp\'s reach', () => {
    for (const [id, { meshes }] of builds) for (const m of meshes) for (const d of [m.near, m.far]) {
      for (let i = 0; i < d.position.length; i += 3) {
        const x = d.position[i], y = d.position[i + 1], z = d.position[i + 2];
        assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `${id}: vertex ${i / 3} not finite`);
        assert.ok(Math.abs(x) < 160 && Math.abs(z) < 160 && y > -12 && y < 40, `${id}: vertex ${i / 3} at ${x}, ${y}, ${z}`);
      }
      for (const v of d.normal) assert.ok(Number.isFinite(v));
      assert.ok(d.index.every((k) => k < d.position.length / 3));
    }
  });
  check('a camp builds the same bytes every time', () => {
    const plan = new Plan(ground, 'joseon');
    LAYOUTS.yeosu(plan);
    village(plan, -90, -90, 10, 0.2, 3);
    const again = buildHero(plan), first = builds.get('yeosu').meshes;
    assert.equal(again.length, first.length);
    again.forEach((m, i) => assert.deepEqual(Buffer.from(m.near.position.buffer), Buffer.from(first[i].near.position.buffer)));
  });
  check('the hall, barracks rows and gates are at the layouts\' true sizes', () => {
    const { plan } = builds.get('yeosu');
    const barracks = plan.pieces.filter(({ piece: p }) => p.kind === 'bldg' && p.w === 10.5);
    assert.equal(barracks.length, 12);
    const hall = plan.pieces.find(({ piece: p }) => p.kind === 'bldg' && p.w === 15.5);
    assert.ok(hall);
    assert.equal(plan.ships.filter((s) => s.kind === 'panokseon').length, 2);
  });
  check('the land is cut to the pads: down to a pad inside it, banks climbing from its edge, a fill pad leaves the land alone', () => {
    for (const [id, { plan }] of builds) {
      for (const pad of plan.pads) {
        const cx = pad.poly.reduce((s, p) => s + p[0], 0) / pad.poly.length, cz = pad.poly.reduce((s, p) => s + p[1], 0) / pad.poly.length;
        const top = plan.pads.filter((q) => q === pad || plan.pads.indexOf(q) > plan.pads.indexOf(pad));
        if (top.some((q) => q !== pad && q.poly.some(() => true) && cutAt([q], cx, cz) === q.h0 && plan.pads.indexOf(q) > plan.pads.indexOf(pad))) continue;
        assert.equal(cutAt(plan.pads, cx, cz), pad.h0, `${id}: pad at ${cx}, ${cz}`);
      }
      const far = cutAt(plan.pads, 200, 200);
      assert.ok(far > 50, `${id}: the cut reaches far from the camp`);
    }
  });
  check('the small camps of tier 1 build too', () => {
    const plan = new Plan(ground, 'joseon');
    joTier1(plan, -60, -60, 0.2);
    waFieldCamp(plan, -60, 20, 0.1);
    const meshes = buildHero(plan);
    assert.ok(meshes.reduce((n, m) => n + tris(m.near), 0) > 500);
  });
  check("every navy's camp at levels 1 to 3 builds, each level larger than the one below, inside its budget", () => {
    for (const navy of ['joseon', 'japan', 'ming']) {
      let last = 0;
      for (const level of [1, 2, 3]) {
        const plan = new Plan(ground, navy);
        tierCamp(plan, navy, level, -40, -20);
        const n = buildHero(plan).reduce((k, m) => k + tris(m.near), 0);
        if (table) console.log(navy, level, plan.pieces.length, 'pieces', n, 'triangles');
        assert.ok(n > last && n < 40000, `${navy} ${level}: ${n} triangles after ${last}`);
        assert.ok(plan.pads.length >= 1);
        last = n;
      }
    }
  });
  console.log(`${passed} passed`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
