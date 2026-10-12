// The campaign map's 3D layer: what each camp level is made of, how a camp turns to the sea, and where fleets stand. Pure layout, no GPU.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'imjin-world-'));
let passed = 0;
const check = (name, test) => { test(); passed++; console.log(`ok - ${name}`); };
try {
  const bundled = await build({
    stdin: { contents: `export * from './src/ui/grand/mapWorld.ts'; export { project, MAP_ASPECT } from './src/ui/grand/projection.ts';`, resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  const path = join(temporary, 'map-world.mjs'); await writeFile(path, bundled.outputFiles[0].contents);
  const { settlementPieces, faceSea, buildWorld, anchorage, hullsFor, hash, SETTLEMENT_RADIUS, SEA_SIDE, project, MAP_ASPECT } = await import(pathToFileURL(path).href);
  const kinds = (level) => new Set(settlementPieces(level).map((p) => p.kind));
  const buildings = (level) => settlementPieces(level).filter((p) => p.kind !== 'palisade' && p.kind !== 'stone').length;

  check('a camp grows with its level and keeps what it had', () => {
    assert.deepEqual(settlementPieces(0), []);
    assert.deepEqual([...kinds(1)].sort(), ['choga', 'palisade']);
    assert.ok(kinds(2).has('giwa') && kinds(2).has('dock') && kinds(2).has('palisade') && !kinds(2).has('stone'));
    for (const k of ['stone', 'fortgate', 'bongsu', 'battery', 'magazine', 'dock']) assert.ok(kinds(3).has(k), k);
    assert.ok(!kinds(3).has('palisade') && !kinds(3).has('shipyard') && kinds(4).has('shipyard'));
    for (let level = 1; level < 4; level++) assert.ok(buildings(level + 1) > buildings(level), `level ${level + 1} has more buildings`);
    assert.equal(buildings(1), 3);
  });
  check('a gate stays open in the stone wall and the pieces stay near their camp', () => {
    const gate = settlementPieces(3).find((p) => p.kind === 'fortgate');
    const wall = settlementPieces(3).filter((p) => p.kind === 'stone');
    assert.ok(wall.every((p) => Math.hypot(p.x - gate.x, p.z - gate.z) > 0.3), 'no wall in the gateway');
    for (let level = 1; level <= 4; level++) for (const p of settlementPieces(level)) assert.ok(Math.hypot(p.x, p.z) <= 1.6, `${level} ${p.kind}`);
  });
  check('a camp turns its dock to open water and the turn keeps every distance', () => {
    const pieces = settlementPieces(3);
    // Sea only to the north-east of the camp (negative z, positive x).
    const sea = (x, z) => z < -0.9 && x > 0.3;
    const turned = faceSea(pieces, 3, sea);
    const dock = turned.pieces.find((p) => p.kind === 'dock');
    assert.ok(sea(dock.x, dock.z) || sea(dock.x * 1.5, dock.z * 1.5), 'the dock faces the water');
    pieces.forEach((p, i) => assert.ok(Math.abs(Math.hypot(p.x, p.z) - Math.hypot(turned.pieces[i].x, turned.pieces[i].z)) < 1e-9));
    assert.deepEqual(faceSea(pieces, 3, sea), turned, 'the same seed turns the same way');
    // With no sea at all, neighbouring camps still differ by their hash.
    const none = () => false;
    assert.notEqual(faceSea(pieces, 1, none).turn, faceSea(pieces, 2, none).turn);
    assert.equal(SEA_SIDE, Math.PI);
  });
  const region = (id, lon, lat, extra = {}) => ({ id, lon, lat, owner: 'joseon', offMap: false, labelSide: 'b', buildings: [{ kind: 'camp', level: 2, maxLevel: 4 }], ...extra });
  const fleet = (id, at, ships, faction = 'joseon', extra = {}) => ({ id, faction, at, route: [], ships: Array.from({ length: ships }, () => ({})), ...extra });
  check('settlements are made for built, owned, on-map camps only, and stand away from the label', () => {
    const regions = [
      region('a', 127.7, 34.7), region('b', 127.8, 34.75, { labelSide: 'l' }),
      region('c', 127.9, 34.8, { buildings: [] }), region('d', 128, 34.8, { owner: null }), region('e', 128.1, 34.8, { offMap: true }),
      region('f', 128.2, 34.8, { buildings: [{ kind: 'camp', level: 9, maxLevel: 3 }] }),
    ];
    const { settlements } = buildWorld(regions, []);
    assert.deepEqual(settlements.map((s) => s.id), ['a', 'b', 'f']);
    assert.equal(settlements[2].level, 3, 'the level is clamped to what the camp can reach');
    const a = project(127.7, 34.7), b = project(127.8, 34.75);
    assert.ok(Math.abs(settlements[0].u - a.u) < 1e-12 && settlements[0].v < a.v, 'label below: the camp is north of the marker');
    assert.ok(settlements[1].u > b.u && Math.abs(settlements[1].v - b.v) < 1e-12, 'label left: the camp is east of the marker');
    assert.ok(Math.abs((a.v - settlements[0].v) / MAP_ASPECT - SETTLEMENT_RADIUS * 1.1) < 1e-12);
  });
  check('fleets in a port are one group per navy, sailing ones sit mid-lane with a heading', () => {
    const regions = [region('a', 127.7, 34.7), region('b', 128.4, 35.0)];
    const world = buildWorld(regions, [
      fleet('f1', 'a', 3), fleet('f2', 'a', 4), fleet('f3', 'a', 5, 'japan'), fleet('f4', null, 2, 'joseon', { transit: { from: 'a', to: 'b', left: 1 } }),
      fleet('f5', 'zz', 3), fleet('f6', 'a', 0),
    ]);
    assert.deepEqual(world.fleets.map((f) => f.key), ['a/joseon', 'a/japan', 'f4']);
    assert.equal(world.fleets[0].count, hullsFor(7));
    assert.equal(world.fleets[2].count, hullsFor(2));
    assert.ok(world.fleets[0].heading === null && world.fleets[2].heading.du > 0);
    const [pa, pb] = [project(127.7, 34.7), project(128.4, 35.0)];
    assert.ok(Math.abs(world.fleets[2].u - (pa.u + pb.u) / 2) < 1e-12 && Math.abs(world.fleets[2].v - (pa.v + pb.v) / 2) < 1e-12);
  });
  check('a squadron is drawn with a few hulls, never more than five', () => {
    assert.deepEqual([0, 1, 2, 3, 10, 30, 400].map(hullsFor), [0, 1, 2, 2, 3, 5, 5]);
    for (let n = 1; n < 60; n++) assert.ok(hullsFor(n + 1) >= hullsFor(n));
  });
  check('ships anchor on water when there is some and still get a berth when there is none', () => {
    const east = (x) => x > 1;
    for (const seed of [1, 7, 99]) {
      const spots = anchorage(4, seed, (x) => east(x));
      assert.equal(spots.length, 4);
      assert.ok(spots.every((s) => east(s.x)), 'all on the water');
      assert.equal(new Set(spots.map((s) => `${s.x.toFixed(3)},${s.z.toFixed(3)}`)).size, 4, 'no two share a berth');
    }
    assert.equal(anchorage(3, 5, () => false).length, 3);
    assert.deepEqual(anchorage(3, 5, east), anchorage(3, 5, east), 'deterministic');
    assert.notEqual(hash('yeosu'), hash('busan'));
  });
  console.log(`${passed} map world regressions passed`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
