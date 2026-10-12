// The campaign map's 3D layer: what each camp level is made of for each navy, how a camp turns to the sea, where fleets stand
// and sail, and which city cards fit on screen. Pure layout, no GPU.
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
    stdin: { contents: `export * from './src/ui/grand/mapWorld.ts'; export * from './src/ui/grand/cardLayout.ts'; export { project, MAP_ASPECT } from './src/ui/grand/projection.ts';`, resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  const path = join(temporary, 'map-world.mjs'); await writeFile(path, bundled.outputFiles[0].contents);
  const { settlementPieces, faceSea, buildWorld, anchorage, hullsFor, hash, SETTLEMENT_RADIUS, SEA_SIDE, project, MAP_ASPECT, WALL_KINDS, WATER_KINDS, SHIP_CAP, flagSpot, formation, transitShare, transitSpot, pointAlong, buildSails, cardRect, overlaps, pickCards } = await import(pathToFileURL(path).href);
  const kinds = (level) => new Set(settlementPieces(level).map((p) => p.kind));
  const buildings = (level) => settlementPieces(level).filter((p) => !WALL_KINDS.has(p.kind)).length;

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
  const NAVIES = ['joseon', 'japan', 'ming'];
  const names = (faction, level) => new Set(settlementPieces(level, faction).map((p) => p.kind));
  check('every navy has four levels and a higher level never has fewer parts', () => {
    for (const faction of NAVIES) {
      assert.deepEqual(settlementPieces(0, faction), []);
      let built = 0, total = 0;
      for (let level = 1; level <= 4; level++) {
        const pieces = settlementPieces(level, faction);
        const bldg = pieces.filter((p) => !WALL_KINDS.has(p.kind)).length;
        assert.ok(bldg > built, `${faction} ${level} has more buildings than the level below`);
        assert.ok(pieces.length >= total, `${faction} ${level} has no fewer parts than the level below`);
        for (const p of pieces) assert.ok(Math.hypot(p.x, p.z) <= 1.6, `${faction} ${level} ${p.kind} stays near its camp`);
        [built, total] = [bldg, pieces.length];
      }
    }
  });
  check('Japanese camps grow from a curtain camp to a four-tier keep', () => {
    assert.deepEqual([...names('japan', 1)].sort(), ['wa_banner', 'wa_fence', 'wa_tent']);
    for (const k of ['wa_tower', 'pier']) assert.ok(names('japan', 2).has(k) && !names('japan', 1).has(k), k);
    for (const k of ['wa_wall', 'wa_gate', 'wa_keep3']) assert.ok(names('japan', 3).has(k), k);
    assert.ok(!names('japan', 3).has('wa_fence') && !names('japan', 3).has('wa_keep4'));
    assert.ok(names('japan', 4).has('wa_keep4') && names('japan', 4).has('wa_yard') && !names('japan', 4).has('wa_keep3'));
    assert.equal(settlementPieces(4, 'japan').filter((p) => p.kind === 'wa_keep4').length, 1);
    const gate = settlementPieces(3, 'japan').find((p) => p.kind === 'wa_gate');
    assert.ok(settlementPieces(3, 'japan').filter((p) => p.kind === 'wa_wall').every((p) => Math.hypot(p.x - gate.x, p.z - gate.z) > 0.3), 'no wall in the gateway');
    assert.ok(Math.hypot(...flagSpot(3, 'japan')) > 0.4 && flagSpot(3, 'joseon').every((v) => v === 0), 'the flag stands clear of the keep');
  });
  check('Ming camps grow from a palisade to a walled yard', () => {
    assert.deepEqual([...names('ming', 1)].sort(), ['mg_flag', 'mg_palisade', 'mg_watch']);
    for (const k of ['mg_brick', 'mg_gate', 'pier']) assert.ok(names('ming', 2).has(k), k);
    assert.ok(!names('ming', 2).has('mg_palisade') && !names('ming', 2).has('mg_corner'));
    for (const k of ['mg_corner', 'mg_platform', 'mg_beacon']) assert.ok(names('ming', 3).has(k), k);
    assert.equal(settlementPieces(3, 'ming').filter((p) => p.kind === 'mg_corner').length, 4);
    assert.ok(names('ming', 4).has('mg_yard'));
    const reach = (level) => Math.max(...settlementPieces(level, 'ming').filter((p) => p.kind === 'mg_brick').map((p) => Math.max(Math.abs(p.x), Math.abs(p.z))));
    assert.ok(reach(4) > reach(3) + 0.15, 'the level-4 yard is larger');
    const gate = settlementPieces(2, 'ming').find((p) => p.kind === 'mg_gate');
    assert.ok(settlementPieces(2, 'ming').filter((p) => p.kind === 'mg_brick').every((p) => Math.hypot(p.x - gate.x, p.z - gate.z) > 0.25), 'no wall in the gateway');
  });
  check('Joseon camps add a great hall at the top and share no building with the other navies but the pier', () => {
    assert.deepEqual(settlementPieces(3), settlementPieces(3, 'joseon'));
    assert.ok(names('joseon', 4).has('hall') && !names('joseon', 3).has('hall'));
    assert.equal(settlementPieces(4).filter((p) => p.kind === 'battery').length, 2, 'a second battery at the top');
    assert.ok(Math.hypot(...flagSpot(4, 'joseon')) > 0.2, 'the flag stands in the yard before the hall');
    for (let level = 1; level <= 4; level++) {
      for (const f of ['japan', 'ming']) for (const k of names(f, level)) assert.ok(k === 'pier' || !names('joseon', 4).has(k), `${f} ${k} is not a Joseon building`);
    }
    for (const k of ['dock', 'shipyard', 'pier', 'wa_yard', 'mg_yard']) assert.ok(WATER_KINDS.has(k), k);
  });
  const rect = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
  const cand = (id, x, y, extra = {}) => ({ id, own: false, level: 2, distance: 0, rect: rect(x, y, x + 100, y + 90), ...extra });
  check('a card is shown only if it does not overlap one already shown, in priority order', () => {
    assert.ok(overlaps(rect(0, 0, 10, 10), rect(5, 5, 20, 20)) && !overlaps(rect(0, 0, 10, 10), rect(30, 0, 40, 10)));
    assert.ok(overlaps(rect(0, 0, 10, 10), rect(12, 0, 20, 10)), 'a hair apart is still too close');
    // Three cards in a row, each over its neighbour: the first and third fit, the middle does not.
    const row = [cand('a', 0, 0, { level: 3 }), cand('b', 60, 0, { level: 2 }), cand('c', 120, 0, { level: 1 })];
    assert.deepEqual(pickCards(row, null, null, 8), ['a', 'c']);
    // The selected port wins over everything, then the hovered one, then own ports, then the level.
    assert.deepEqual(pickCards(row, 'b', null, 8), ['b']);
    assert.deepEqual(pickCards(row, null, 'c', 8), ['c', 'a']);
    assert.deepEqual(pickCards([cand('x', 0, 0, { level: 4 }), cand('y', 50, 0, { own: true, level: 1 })], null, null, 8), ['y']);
    assert.deepEqual(pickCards([cand('x', 0, 0, { distance: 90 }), cand('y', 50, 0, { distance: 10 })], null, null, 8), ['y'], 'the nearer to the centre wins a tie');
    assert.deepEqual(pickCards(row, null, null, 1), ['a'], 'the limit holds');
    assert.deepEqual(pickCards([], 'a', 'b', 4), []);
    // Nothing shown overlaps anything else, whatever the cards.
    const crowd = Array.from({ length: 40 }, (_, i) => cand(`r${i}`, (i * 37) % 400, (i * 53) % 300, { level: 1 + (i % 4), own: i % 5 === 0, distance: i }));
    const shown = pickCards(crowd, 'r7', 'r9', 40).map((id) => crowd.find((c) => c.id === id));
    shown.forEach((a, i) => shown.slice(i + 1).forEach((b) => assert.ok(!overlaps(a.rect, b.rect), `${a.id} / ${b.id}`)));
    assert.ok(shown.length >= 3);
  });
  check('a card never hides another port\'s disc, unless its own port is the selected one', () => {
    const disc = (id, x, y) => ({ id, rect: rect(x - 14, y - 14, x + 14, y + 14) });
    const a = cand('a', 0, 0, { level: 4 }), b = cand('b', 300, 0, { level: 1 });
    const discs = [disc('a', 50, -20), disc('b', 350, -20), disc('c', 40, 60)];
    assert.deepEqual(pickCards([a, b], null, null, 8, discs), ['b'], 'the card of a would cover the disc of c');
    assert.deepEqual(pickCards([a, b], 'a', null, 8, discs), ['a', 'b'], 'the selected one is shown anyway');
    assert.deepEqual(pickCards([a, b], null, null, 8, [disc('a', 50, 40)]), ['a', 'b'], 'its own disc does not count');
  });
  check('a card sits on the side its label takes, and cards of far apart ports all show', () => {
    const [x, y, rad] = [500, 300, 14];
    const b = cardRect(x, y, rad, 'b', 116, 98), t = cardRect(x, y, rad, 't', 116, 98), l = cardRect(x, y, rad, 'l', 116, 98), r = cardRect(x, y, rad, 'r', 116, 98);
    assert.ok(b.y0 > y + rad && t.y1 < y - rad && l.x1 < x - rad && r.x0 > x + rad);
    assert.ok([b, t, l, r].every((c) => c.x1 - c.x0 === 116 && c.y1 - c.y0 === 98));
    const far = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, own: false, level: 1, distance: i, rect: cardRect(i * 300, 100, 14, 'b', 116, 98) }));
    assert.equal(pickCards(far, null, null, 8).length, 4);
  });
  check('a fleet on a lane stands where its turns put it, off both ports', () => {
    assert.equal(transitShare(1, undefined), 0.5);
    assert.equal(transitShare(3, 3), 0.25, 'just left: clamped clear of the port');
    assert.equal(transitShare(0, 2), 0.75);
    assert.equal(transitShare(1, 2), 0.5);
    const regions = [region('a', 127.7, 34.7, { laneTurns: { b: 4 } }), region('b', 128.4, 35.0)];
    const [pa, pb] = [project(127.7, 34.7), project(128.4, 35.0)];
    const at = (left) => buildWorld(regions, [fleet('f', null, 2, 'joseon', { transit: { from: 'a', to: 'b', left } })]).fleets[0];
    assert.ok(Math.abs(at(1).u - (pa.u + (pb.u - pa.u) * 0.75)) < 1e-12);
    assert.ok(Math.abs(at(2).u - (pa.u + (pb.u - pa.u) * 0.5)) < 1e-12);
    assert.ok(at(1).u > at(2).u && at(2).u > at(3).u, 'it advances turn by turn');
    // An island across the middle of the lane: the squadron moves to the nearest water, never next to a port.
    const [a, b] = regions;
    const mid = (pa.u + pb.u) / 2, half = (pb.u - pa.u) / 2;
    const island = (u) => Math.abs(u - mid) > half * 0.3;
    const off = transitSpot(a, b, 2, (u) => island(u));
    assert.ok(island(off.u) && off.share >= 0.15 && off.share <= 0.85 && Math.abs(off.share - 0.5) < 0.3, 'just past the island');
    // Land everywhere on the lane but open water just south of it: it steps aside rather than along.
    const south = (u, v) => v > pa.v + (pb.v - pa.v) * ((u - pa.u) / (pb.u - pa.u)) + 0.004;
    const aside = transitSpot(a, b, 2, south);
    assert.ok(south(aside.u, aside.v) && aside.share === 0.5, 'beside its place on the lane');
    assert.equal(buildWorld(regions, [fleet('f', null, 2, 'joseon', { transit: { from: 'a', to: 'b', left: 2 } })], null, (u) => island(u)).fleets[0].u, off.u, 'the world takes the same spot');
    const allLand = transitSpot(a, b, 2, () => false);
    assert.ok(Math.abs(allLand.u - mid) < 1e-12 && allLand.share === 0.5, 'no water anywhere: it keeps its place');
  });
  check('a squadron rides in a wedge behind its leader, hulls clear of each other and at most two hulls deep', () => {
    assert.deepEqual(formation(0), []);
    assert.deepEqual(formation(1), [{ along: 0, across: 0 }]);
    for (let n = 1; n <= 5; n++) {
      const f = formation(n);
      assert.equal(f.length, n);
      assert.ok(f.every((o) => o.along <= 0 && o.along >= -2));
      // A hull is about 0.3 of its length wide: abreast they need that much room, in line a little over a length.
      f.forEach((a, i) => f.slice(i + 1).forEach((b) => assert.ok(Math.abs(a.across - b.across) >= 0.4 || Math.abs(a.along - b.along) >= 1.05, `${n}: ${i}`)));
    }
  });
  check('the ships of a replay follow the lane polyline and stop at its end', () => {
    const line = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }];
    assert.deepEqual(pointAlong(line, 0), { x: 0, z: 0, angle: Math.PI / 2 });
    const mid = pointAlong(line, 0.5);
    assert.ok(Math.abs(mid.x - 1) < 1e-12 && Math.abs(mid.z) < 1e-12, 'half way is the corner');
    const late = pointAlong(line, 0.75);
    assert.ok(Math.abs(late.x - 1) < 1e-12 && Math.abs(late.z - 0.5) < 1e-12 && Math.abs(late.angle) < 1e-12, 'then it turns south');
    assert.deepEqual(pointAlong(line, 2), { x: 1, z: 1, angle: 0 }, 'beyond the end it stays at the end');
    assert.deepEqual(pointAlong([{ x: 2, z: 3 }, { x: 2, z: 3 }], 0.5), { x: 2, z: 3, angle: 0 }, 'a path of one spot does not divide by zero');
    const byId = new Map([region('a', 127.7, 34.7), region('b', 128.4, 35.0)].map((r) => [r.id, r]));
    const sails = buildSails({ clashes: [], changes: [], moves: [
      { id: 'm1', faction: 'joseon', name: 'x', ships: 7, lost: false, path: [{ at: 'a' }, { at: 'a', to: 'b', t: 0.5 }, { at: 'b' }] },
      { id: 'm2', faction: 'japan', name: 'y', ships: 0, lost: true, path: [{ at: 'a' }, { at: 'b' }] },
      { id: 'm3', faction: 'ming', name: 'z', ships: 3, lost: true, path: [{ at: 'a' }, { at: 'nowhere' }] },
    ] }, byId);
    assert.deepEqual(sails.map((m) => m.key), ['m1'], 'no ships, or no way on the map, no sail');
    assert.equal(sails[0].count, hullsFor(7));
    const [pa, pb] = [project(127.7, 34.7), project(128.4, 35.0)];
    assert.ok(Math.abs(sails[0].points[1].x - ((pa.u + pb.u) / 2 - 0.5)) < 1e-12, 'a spot half way along a lane is half way');
    assert.ok(Math.abs(sails[0].points[2].z - ((pb.v - 0.5) / MAP_ASPECT)) < 1e-12);
  });
  check('no fleet is drawn with more than five hulls and the layer caps the map at 140', () => {
    assert.equal(SHIP_CAP, 140);
    const regions = [region('a', 127.7, 34.7), region('b', 128.4, 35.0)];
    const many = Array.from({ length: 300 }, (_, i) => fleet(`f${i}`, null, 90, NAVIES[i % 3], { transit: { from: 'a', to: 'b', left: 1 } }));
    const { fleets } = buildWorld(regions, many);
    assert.ok(fleets.length === 300 && fleets.every((f) => f.count <= 5));
    assert.ok(fleets.reduce((n, f) => n + f.count, 0) > SHIP_CAP, 'the world asks for more than the layer may draw');
  });
  console.log(`${passed} map world regressions passed`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
