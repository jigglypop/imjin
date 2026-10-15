// The campaign map's 3D layer: what each camp level is made of for each navy, how a camp turns to the sea, how a port's
// camp, town and works are laid out on its coast, where fleets stand and sail, and which city cards fit on screen. Pure
// layout, no GPU.
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
    stdin: { contents: `export * from './src/ui/grand/mapWorld.ts'; export * from './src/ui/grand/labelLayout.ts'; export { project, MAP_ASPECT } from './src/ui/grand/projection.ts'; export { WALL_KINDS, WATER_KINDS, FOOTPRINT, METRES_PER_RADIUS } from './src/ui/grand/campPieces.ts';`, resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  const path = join(temporary, 'map-world.mjs'); await writeFile(path, bundled.outputFiles[0].contents);
  const { settlementPieces, faceSea, buildWorld, layoutSettlements, dryStretches, clearingRadius, townPlan, townSize, workKind, anchorage, hullsFor, drawnKinds, hash, HULL_LENGTH, SETTLEMENT_RADIUS, SEA_SIDE, project, MAP_ASPECT, SHIP_CAP, formation, transitShare, transitSpot, pointAlong, buildSails, labelRect, overlaps, placeLabels, minorDiscs, nameWidth, WALL_KINDS, WATER_KINDS, FOOTPRINT, METRES_PER_RADIUS } = await import(pathToFileURL(path).href);
  const kinds = (level) => new Set(settlementPieces(level).map((p) => p.kind));
  const buildings = (level) => settlementPieces(level).filter((p) => !WALL_KINDS.has(p.kind)).length;

  check('a Joseon camp grows from a stockade to a walled base and keeps what it had', () => {
    assert.deepEqual(settlementPieces(0), []);
    assert.deepEqual([...kinds(1)].sort(), ['choga', 'giwa', 'jo_banner', 'jo_gate', 'jo_standard', 'palisade']);
    assert.ok(kinds(2).has('jo_tower') && kinds(2).has('pier') && kinds(2).has('palisade') && !kinds(2).has('stone'));
    for (const k of ['stone', 'fortgate', 'hall', 'magazine', 'pier']) assert.ok(kinds(3).has(k), k);
    assert.ok(!kinds(3).has('palisade') && !kinds(3).has('jo_gate'));
    for (let level = 1; level < 3; level++) assert.ok(buildings(level + 1) > buildings(level), `level ${level + 1} has more buildings`);
  });
  check('a gate stays open in the wall and every piece stays near its camp', () => {
    const gate = settlementPieces(3).find((p) => p.kind === 'fortgate');
    const wall = settlementPieces(3).filter((p) => p.kind === 'stone');
    assert.ok(wall.every((p) => Math.hypot(p.x - gate.x, p.z - gate.z) > 0.25), 'no wall in the gateway');
    for (let level = 1; level <= 3; level++) for (const p of settlementPieces(level)) assert.ok(Math.hypot(p.x, p.z) <= 1.3, `${level} ${p.kind}`);
  });
  check('a camp turns its landing to open water and the turn keeps every distance', () => {
    const pieces = settlementPieces(3);
    // Sea only to the north-east of the camp (negative z, positive x).
    const sea = (x, z) => z < -0.9 && x > 0.3;
    const turned = faceSea(pieces, 3, sea);
    const pier = turned.pieces.find((p) => p.kind === 'pier');
    assert.ok(sea(pier.x, pier.z) || sea(pier.x * 1.5, pier.z * 1.5), 'the landing faces the water');
    pieces.forEach((p, i) => assert.ok(Math.abs(Math.hypot(p.x, p.z) - Math.hypot(turned.pieces[i].x, turned.pieces[i].z)) < 1e-9));
    assert.deepEqual(faceSea(pieces, 3, sea), turned, 'the same seed turns the same way');
    const none = () => false;
    assert.notEqual(faceSea(pieces, 1, none).turn, faceSea(pieces, 2, none).turn, 'with no sea, neighbouring camps still differ');
    assert.equal(SEA_SIDE, Math.PI);
  });
  check('a town has its houses, garden walls, tree and fields, larger for a richer port or a seat', () => {
    const sizes = [1, 2, 3].map((v) => townSize(v, false));
    assert.ok(sizes[0].houses < sizes[1].houses && sizes[1].houses < sizes[2].houses && townSize(2, true).houses > sizes[1].houses);
    for (const { houses, tiled, pavilion } of [...sizes, townSize(2, true)]) {
      const plan = townPlan(houses, tiled, 7, false, pavilion);
      const homes = plan.pieces.filter((p) => p.kind === 'choga' || p.kind === 'giwa');
      assert.equal(homes.length, houses);
      assert.equal(homes.filter((p) => p.kind === 'giwa').length, tiled);
      assert.ok(plan.pieces.filter((p) => p.kind === 'doldam').length >= houses, 'every house has its garden walls');
      assert.equal(plan.pieces.filter((p) => p.kind === 'tree').length, 1);
      assert.equal(plan.pieces.some((p) => p.kind === 'jeongja'), pavilion);
      assert.ok(plan.grounds.fields.length >= 2 && plan.grounds.lanes.length >= 1);
      assert.ok(plan.radius > 0.5 && plan.radius < 1.4, `a town reaches ${plan.radius}`);
    }
    assert.deepEqual(townPlan(5, 1, 7), townPlan(5, 1, 7), 'the same seed builds the same town');
    assert.ok(townPlan(5, 1, 7, true).pieces.every((p) => p.kind !== 'choga' && p.kind !== 'giwa'), 'a Japanese village has its own houses');
    assert.equal(workKind('battery', 'japan'), 'wa_battery');
    assert.equal(workKind('beacon', null), 'jo_beacon', "a port nobody holds keeps Korea's own");
  });
  const region = (id, lon, lat, extra = {}) => ({ id, lon, lat, owner: 'joseon', value: 1, offMap: false, labelSide: 'b', buildings: [{ kind: 'camp', level: 2, maxLevel: 3 }], ...extra });
  const fleet = (id, at, ships, faction = 'joseon', extra = {}) => ({ id, faction, at, route: [], ships: Array.from({ length: ships }, () => ({})), ...extra });
  check('every on-map port has its town; a camp only where an owner built one', () => {
    const regions = [
      region('a', 127.7, 34.7), region('b', 127.8, 34.75, { labelSide: 'l' }),
      region('c', 127.9, 34.8, { buildings: [] }), region('d', 128, 34.8, { owner: null }), region('e', 128.1, 34.8, { offMap: true }),
      region('f', 128.2, 34.8, { buildings: [{ kind: 'camp', level: 9, maxLevel: 3 }] }),
    ];
    const { settlements } = buildWorld(regions, []);
    assert.deepEqual(settlements.filter((s) => s.kind === 'camp').map((s) => s.id).sort(), ['a', 'b', 'f']);
    assert.deepEqual(settlements.filter((s) => s.kind === 'town').map((s) => s.region).sort(), ['a', 'b', 'c', 'd', 'f']);
    assert.equal(settlements.find((s) => s.id === 'f').level, 3, 'the level is clamped to what the camp can reach');
    const a = project(127.7, 34.7), camp = settlements.find((s) => s.id === 'a');
    assert.ok(camp.v < a.v, 'with no sea known, a camp stands on the side away from its label');
  });
  // A coast: land north of a gently wavy shore a radius or so south of the ports, sea south of it with an island in it.
  const P0 = project(127.7, 34.72);
  const coastSea = (u, v) => {
    const shore = P0.v + SETTLEMENT_RADIUS * MAP_ASPECT * (1.3 + 0.35 * Math.sin(((u - P0.u) / SETTLEMENT_RADIUS) * 0.9));
    const island = Math.hypot(u - P0.u - 6 * SETTLEMENT_RADIUS, (v - P0.v) / MAP_ASPECT - 3.2 * SETTLEMENT_RADIUS) < 0.9 * SETTLEMENT_RADIUS;
    return v > shore && !island;
  };
  const coastal = [
    region('p1', 127.7, 34.72, { value: 2, seat: true, buildings: [{ kind: 'camp', level: 3, maxLevel: 3 }, { kind: 'battery', level: 1, maxLevel: 3 }, { kind: 'shipyard', level: 2, maxLevel: 3 }, { kind: 'beacon', level: 1, maxLevel: 3 }] }),
    region('p2', 127.81, 34.73, { owner: 'japan', buildings: [{ kind: 'camp', level: 2, maxLevel: 3 }, { kind: 'dock', level: 1, maxLevel: 3 }, { kind: 'granary', level: 1, maxLevel: 3 }] }),
    region('p3', 127.93, 34.72, { owner: 'ming', value: 3, buildings: [{ kind: 'camp', level: 3, maxLevel: 3 }] }),
    region('p4', 128.03, 34.73, { buildings: [] }),
  ];
  const R = SETTLEMENT_RADIUS;
  const onLand = (s, p) => {
    const [fx, fz] = FOOTPRINT[p.kind];
    const hx = p.len !== undefined ? p.len / 2 : fx / METRES_PER_RADIUS, hz = fz / METRES_PER_RADIUS, c = Math.cos(p.rot), sn = Math.sin(p.rot);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].every(([u, w]) => !coastSea(s.u + (p.x + u * hx * c + w * hz * sn) * R, s.v + (p.z - u * hx * sn + w * hz * c) * R * MAP_ASPECT));
  };
  check('on a coast every building stands on land, every landing and slip across the shore, every work by its owner', () => {
    const places = layoutSettlements(coastal, coastSea);
    for (const s of places) for (const p of s.pieces) {
      if (!WATER_KINDS.has(p.kind)) { assert.ok(onLand(s, p), `${s.id} ${p.kind} at ${p.x.toFixed(2)},${p.z.toFixed(2)} stands in the water`); continue; }
      const dx = Math.sin(p.rot), dz = Math.cos(p.rot), half = FOOTPRINT[p.kind][1] / METRES_PER_RADIUS;
      const at = (k) => coastSea(s.u + (p.x + dx * half * k) * R, s.v + (p.z + dz * half * k) * R * MAP_ASPECT);
      assert.ok(!at(-0.85) && at(0.95), `${s.id} ${p.kind} runs from the shore out over the water`);
    }
    const kindsAt = (id) => new Set(places.filter((s) => s.region === id).flatMap((s) => s.pieces.map((p) => p.kind)));
    for (const k of ['jo_battery', 'jo_yard', 'jo_beacon']) assert.ok(kindsAt('p1').has(k), `p1 has its ${k}`);
    for (const k of ['wa_dock', 'wa_granary']) assert.ok(kindsAt('p2').has(k), `p2 has its ${k}`);
    assert.ok(places.some((s) => s.id === 'p1/beacon'), 'the beacon stands apart on its hill');
    for (const s of places) for (const lane of s.grounds.lanes) for (let i = 1; i < lane.length; i++) for (let t = 0; t <= 1; t += 0.05) {
      const x = lane[i - 1].x + (lane[i].x - lane[i - 1].x) * t, z = lane[i - 1].z + (lane[i].z - lane[i - 1].z) * t;
      assert.ok(!coastSea(s.u + x * R, s.v + z * R * MAP_ASPECT), `${s.id}: a lane runs over the water at ${x.toFixed(2)},${z.toFixed(2)}`);
    }
    assert.deepEqual(layoutSettlements(coastal, coastSea), places, 'the same ports lay out the same way');
  });
  check("whoever holds a port flies its standard in its camp and at its town's harbour end, on land, all flying one way", () => {
    const STANDARDS = { joseon: 'jo_standard', japan: 'wa_standard', ming: 'mg_standard' };
    const places = layoutSettlements(coastal, coastSea);
    for (const s of places.filter((p) => p.kind !== 'beacon')) {
      const flags = s.pieces.filter((p) => Object.values(STANDARDS).includes(p.kind));
      assert.deepEqual(flags.map((p) => p.kind), [STANDARDS[s.owner]], `${s.id} flies its owner's standard`);
      assert.equal(flags[0].rot, 0, `${s.id}: the wind blows one way`);
      assert.ok(onLand(s, flags[0]), `${s.id}: the standard stands on land`);
    }
    // The coast lies south of the ports: a town's harbour end is its south side.
    for (const town of places.filter((s) => s.kind === 'town')) assert.ok(town.pieces.find((p) => p.kind.endsWith('_standard')).z > 0, `${town.id} flies it on its harbour side`);
    const neutral = layoutSettlements([region('n', 127.7, 34.72, { owner: null, buildings: [] })], coastSea);
    assert.ok(neutral.every((s) => s.pieces.every((p) => !p.kind.endsWith('_standard'))), 'a port nobody holds flies none');
  });
  check("a place keeps the trees off its buildings and fields, and a larger place keeps them farther off", () => {
    for (const s of layoutSettlements(coastal, coastSea)) {
      const r = clearingRadius(s) / R;
      assert.ok(r > s.radius, `${s.id}: its buildings`);
      for (const f of s.grounds.fields) assert.ok(Math.hypot(f.x, f.z) + Math.hypot(f.hx, f.hz) < r, `${s.id}: its fields`);
    }
    const camp = (level) => layoutSettlements([region('a', 127.7, 34.7, { buildings: [{ kind: 'camp', level, maxLevel: 3 }] })]).find((s) => s.kind === 'camp');
    assert.ok(clearingRadius(camp(1)) < clearingRadius(camp(3)) * 0.8, 'a stockade clears less ground than a walled fort');
  });
  check('a lane stops at the water and goes on where the land comes back', () => {
    // A channel across the lane between x = 1 and x = 1.6.
    const land = (x) => x < 1 || x > 1.6;
    const runs = dryStretches([{ x: 0, z: 0 }, { x: 3, z: 0 }], 0, 0, land);
    assert.equal(runs.length, 2);
    assert.deepEqual(runs.map((r) => r.length), [2, 2], 'a straight stretch is its two ends');
    assert.ok(runs.every((r) => r.every((p) => land(p.x))));
    assert.ok(runs[0][0].x === 0 && runs[0][1].x > 0.94 && runs[1][0].x < 1.66 && runs[1][1].x === 3, 'cut where the water starts and ends');
    assert.deepEqual(dryStretches([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }], 0, 0, () => true), [[{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }]], 'its corners are kept');
    assert.deepEqual(dryStretches([{ x: 0, z: 0 }, { x: 3, z: 0 }], 0, 0, (x) => x > 1.5 && x < 1.6), [], 'a sliver of land draws no lane');
    assert.deepEqual(dryStretches([{ x: 2, z: 0 }, { x: 3, z: 0 }], -2, 0, (x) => x < 0.5), [[{ x: 2, z: 0 }, { x: 2.45, z: 0 }]], 'tested where the place stands');
  });
  check("no place of one port stands on another's", () => {
    const places = layoutSettlements(coastal, coastSea);
    for (const a of places) for (const b of places) {
      if (a === b) continue;
      const d = Math.hypot(a.u - b.u, (a.v - b.v) / MAP_ASPECT) / R;
      // Places keep apart by their reach when they were laid out; a work added to a place afterwards may lean over its edge.
      assert.ok(d > Math.min(a.radius, b.radius), `${a.id} and ${b.id} are ${d.toFixed(2)} apart`);
    }
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
  check('a squadron is drawn as its own kinds, the largest first, each about as often as it sails', () => {
    const many = (n, kind) => Array.from({ length: n }, () => kind);
    assert.deepEqual(drawnKinds([...many(7, 'panokseon'), ...many(3, 'geobukseon')], 3), ['geobukseon', 'panokseon', 'panokseon']);
    assert.deepEqual(drawnKinds(['kobaya', 'atakebune', 'sekibune'], 3), ['atakebune', 'sekibune', 'kobaya']);
    assert.deepEqual(drawnKinds([], 2), []);
    assert.deepEqual(drawnKinds([undefined], 1), [], 'ships of unknown kind draw nothing: the layer takes the navy\'s usual ship');
    const port = buildWorld([region('a', 127.7, 34.7)], [fleet('f1', 'a', 0, 'japan', { ships: [{ kind: 'kobaya' }, { kind: 'atakebune' }] }), fleet('f2', 'a', 0, 'japan', { ships: [{ kind: 'sekibune' }] })]);
    assert.deepEqual(port.fleets[0].kinds, ['atakebune', 'kobaya'], 'the fleets of a navy in one port are drawn together, picked across their sizes');
    assert.equal(port.fleets[0].kinds.length, port.fleets[0].count);
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
    assert.deepEqual(anchorage(0, 5, east), []);
    assert.notEqual(hash('yeosu'), hash('busan'));
  });
  check('a squadron at anchor lies in tidy rows off the port, all one heading, every hull afloat bow to stern', () => {
    // Open sea to the south (positive z) beyond a coast one radius off the port.
    const south = (x, z) => z > 1;
    for (const count of [1, 3, 5]) {
      const spots = anchorage(count, 11, south);
      assert.equal(new Set(spots.map((s) => s.rot.toFixed(6))).size, 1, `${count}: one heading`);
      for (const s of spots) for (const k of [-0.5, 0, 0.5]) {
        assert.ok(south(s.x + Math.sin(s.rot) * k * HULL_LENGTH, s.z + Math.cos(s.rot) * k * HULL_LENGTH), `${count}: hull afloat`);
      }
      // Bows out to sea, and hulls a beam or more apart.
      assert.ok(Math.cos(spots[0].rot) > 0.7, `${count}: bows face the open sea`);
      spots.forEach((a, i) => spots.slice(i + 1).forEach((b) => assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= HULL_LENGTH * 0.45, `${count}: ${i} crowds another`)));
      assert.ok(Math.max(...spots.map((s) => Math.hypot(s.x, s.z))) < 5, `${count}: close to its port`);
    }
    // A camp's docks and ships already at anchor are kept clear of.
    const camp = { x: 0, z: 2.5, r: 1.9 };
    const clear = anchorage(5, 11, south, [camp]);
    assert.ok(clear.every((s) => Math.hypot(s.x - camp.x, s.z - camp.z) >= camp.r), 'clear of the camp');
  });
  check('every navy at a port gets its own berths, the owner\'s first, clear of the camp', () => {
    const regions = [region('a', 127.7, 34.7)];
    const p = project(127.7, 34.7);
    // Water everywhere south of the port.
    const isSea = (u, v) => v > p.v + SETTLEMENT_RADIUS * MAP_ASPECT * 0.5;
    const world = buildWorld(regions, [fleet('f1', 'a', 20, 'japan'), fleet('f2', 'a', 9)], null, isSea);
    const first = world.fleets.find((f) => f.faction === 'joseon'), second = world.fleets.find((f) => f.faction === 'japan');
    const nearest = (f) => Math.min(...f.berths.map((b) => Math.hypot(b.x, b.z)));
    assert.ok(nearest(first) <= nearest(second), 'the owner berths first, nearest its port');
    assert.equal(first.berths.length, first.count);
    assert.equal(second.berths.length, second.count);
    for (const f of world.fleets) for (const b of f.berths) {
      assert.ok(isSea(p.u + b.x * SETTLEMENT_RADIUS, p.v + b.z * SETTLEMENT_RADIUS * MAP_ASPECT), 'on the water');
      for (const place of world.settlements) {
        const cx = (place.u - p.u) / SETTLEMENT_RADIUS, cz = (place.v - p.v) / MAP_ASPECT / SETTLEMENT_RADIUS;
        assert.ok(Math.hypot(b.x - cx, b.z - cz) >= place.radius, `clear of ${place.id}`);
      }
    }
    for (const a of first.berths) for (const b of second.berths) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= HULL_LENGTH * 0.8, 'the two squadrons do not share water');
    assert.deepEqual(buildWorld(regions, [fleet('f1', 'a', 3)]).fleets[0].berths, [], 'no berths without the sea');
  });
  const NAVIES = ['joseon', 'japan', 'ming'];
  const names = (faction, level) => new Set(settlementPieces(level, faction).map((p) => p.kind));
  check('every navy has three levels, the campaign\'s, and a higher level never has fewer parts', () => {
    for (const faction of NAVIES) {
      assert.deepEqual(settlementPieces(0, faction), []);
      assert.deepEqual(settlementPieces(4, faction), settlementPieces(3, faction), `${faction}: no level past the third`);
      let built = 0, total = 0;
      for (let level = 1; level <= 3; level++) {
        const pieces = settlementPieces(level, faction);
        const bldg = pieces.filter((p) => !WALL_KINDS.has(p.kind)).length;
        assert.ok(bldg > built, `${faction} ${level} has more buildings than the level below`);
        assert.ok(pieces.length >= total, `${faction} ${level} has no fewer parts than the level below`);
        for (const p of pieces) assert.ok(Math.hypot(p.x, p.z) <= 1.6, `${faction} ${level} ${p.kind} stays near its camp`);
        [built, total] = [bldg, pieces.length];
      }
    }
  });
  check('Japanese camps grow from a curtain camp to a castle with a three-tier keep', () => {
    assert.deepEqual([...names('japan', 1)].sort(), ['wa_banner', 'wa_fence', 'wa_standard', 'wa_tent']);
    for (const k of ['wa_tower', 'wa_hall', 'pier']) assert.ok(names('japan', 2).has(k) && !names('japan', 1).has(k), k);
    for (const k of ['wa_wall', 'wa_gate', 'wa_keep3']) assert.ok(names('japan', 3).has(k), k);
    assert.ok(!names('japan', 3).has('wa_fence'));
    assert.equal(settlementPieces(3, 'japan').filter((p) => p.kind === 'wa_keep3').length, 1);
    const gate = settlementPieces(3, 'japan').find((p) => p.kind === 'wa_gate');
    assert.ok(settlementPieces(3, 'japan').filter((p) => p.kind === 'wa_wall').every((p) => Math.hypot(p.x - gate.x, p.z - gate.z) > 0.25), 'no wall in the gateway');
  });
  check('Ming camps grow from a stockade to a walled yard with bastions', () => {
    assert.deepEqual([...names('ming', 1)].sort(), ['mg_flag', 'mg_palisade', 'mg_standard', 'mg_tent', 'mg_watch']);
    for (const k of ['mg_brick', 'mg_gate', 'mg_barracks', 'pier']) assert.ok(names('ming', 2).has(k), k);
    assert.ok(!names('ming', 2).has('mg_palisade') && !names('ming', 2).has('mg_corner'));
    for (const k of ['mg_corner', 'mg_hall']) assert.ok(names('ming', 3).has(k), k);
    assert.equal(settlementPieces(3, 'ming').filter((p) => p.kind === 'mg_corner').length, 4);
    const reach = (level) => Math.max(...settlementPieces(level, 'ming').filter((p) => p.kind === 'mg_brick').map((p) => Math.max(Math.abs(p.x), Math.abs(p.z))));
    assert.ok(reach(3) > reach(2) + 0.1, 'the level-3 yard is larger');
    const gate = settlementPieces(2, 'ming').find((p) => p.kind === 'mg_gate');
    assert.ok(settlementPieces(2, 'ming').filter((p) => p.kind === 'mg_brick').every((p) => Math.hypot(p.x - gate.x, p.z - gate.z) > 0.2), 'no wall in the gateway');
  });
  check('the navies share no camp building but the landing, and the water kinds are the landings and slips', () => {
    const joseon = new Set([1, 2, 3].flatMap((level) => [...names('joseon', level)]));
    for (let level = 1; level <= 3; level++) for (const f of ['japan', 'ming']) for (const k of names(f, level)) assert.ok(k === 'pier' || !joseon.has(k), `${f} ${k} is not a Joseon building`);
    for (const k of ['pier', 'jo_dock', 'wa_yard', 'mg_yard']) assert.ok(WATER_KINDS.has(k), k);
  });
  const rect = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
  const screen = rect(0, 0, 1600, 900);
  const named = (id, x, y, extra = {}) => ({ id, x, y, rad: 14, priority: 0, w: 80, h: 20, side: 'b', ...extra });
  check('names never cover one another nor another port\'s disc, and the more important one wins', () => {
    assert.ok(overlaps(rect(0, 0, 10, 10), rect(5, 5, 20, 20)) && !overlaps(rect(0, 0, 10, 10), rect(30, 0, 40, 10)));
    assert.ok(overlaps(rect(0, 0, 10, 10), rect(12, 0, 20, 10)), 'a hair apart is still too close');
    // Two ports side by side: the second's name takes another side, or none, never the first's place.
    const a = named('a', 500, 400, { priority: 2 }), b = named('b', 540, 400, { priority: 1 });
    const placed = placeLabels([a, b], [a, b], screen);
    assert.equal(placed.get('a').side, 'b', 'the more important name keeps the side it prefers');
    if (placed.has('b')) assert.ok(!overlaps(placed.get('a').rect, placed.get('b').rect));
    // A crowd at an oblique view: whatever is shown overlaps nothing, and a fair share is shown.
    const crowd = Array.from({ length: 40 }, (_, i) => named(`r${i}`, 200 + ((i * 97) % 1200), 300 + ((i * 53) % 260), { priority: i % 7, w: 50 + (i % 5) * 20 }));
    const shown = [...placeLabels(crowd, crowd, screen)];
    for (const [i, [id, l]] of shown.entries()) {
      for (const [, m] of shown.slice(i + 1)) assert.ok(!overlaps(l.rect, m.rect), id);
      for (const d of crowd) if (d.id !== id) assert.ok(!overlaps(l.rect, rect(d.x - d.rad, d.y - d.rad, d.x + d.rad, d.y + d.rad), 0), `${id} over the disc of ${d.id}`);
      assert.ok(l.rect.x0 >= 0 && l.rect.x1 <= 1600 && l.rect.y0 >= 0 && l.rect.y1 <= 900);
    }
    assert.ok(shown.length >= 15, String(shown.length));
  });
  check('a name keeps the side it held, and the sides lie round the disc', () => {
    const a = named('a', 500, 400);
    assert.equal(placeLabels([a], [a], screen, new Map([['a', 'r']])).get('a').side, 'r');
    const [x, y, rad] = [500, 300, 14];
    const b = labelRect(x, y, rad, 'b', 80, 20), t = labelRect(x, y, rad, 't', 80, 20), l = labelRect(x, y, rad, 'l', 80, 20), r = labelRect(x, y, rad, 'r', 80, 20);
    assert.ok(b.y0 > y + rad && t.y1 < y - rad && l.x1 < x - rad && r.x0 > x + rad);
    // At the screen's edge a name turns inward rather than leave the screen.
    const edge = named('e', 1590, 400, { side: 'r' });
    assert.equal(placeLabels([edge], [edge], screen).get('e').side, 'l');
    assert.ok(nameWidth('여수') > nameWidth('ab') && nameWidth('Yeosu') > 30);
  });
  check('a disc over a more important one steps back to a dot; apart, every disc stays', () => {
    const big = { id: 'big', x: 100, y: 100, rad: 20, priority: 5 }, near = { id: 'near', x: 110, y: 104, rad: 14, priority: 1 }, far = { id: 'far', x: 400, y: 100, rad: 14, priority: 0 };
    assert.deepEqual([...minorDiscs([near, big, far])], ['near']);
    assert.deepEqual([...minorDiscs([{ ...near, priority: 9 }, big, far])], ['big']);
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
    // The campaign may say how far along the lane a fleet got: anywhere on it, a little off both ports.
    assert.equal(transitSpot(a, b, 2, undefined, 0.3).share, 0.3);
    assert.equal(transitSpot(a, b, 2, undefined, 0).share, 0.08);
    assert.equal(transitSpot(a, b, 2, undefined, 1).share, 0.92);
    const sailed = buildWorld(regions, [fleet('f', null, 2, 'joseon', { transit: { from: 'a', to: 'b', left: 2, progress: 0.2 } })]).fleets[0];
    assert.ok(Math.abs(sailed.u - (pa.u + (pb.u - pa.u) * 0.2)) < 1e-12, 'the world takes the progress');
    // Two navies meeting half way, one from each end: drawn apart, not on top of each other.
    const met = buildWorld(regions, [
      fleet('f', null, 4, 'joseon', { transit: { from: 'a', to: 'b', left: 1, progress: 0.5 } }),
      fleet('g', null, 4, 'japan', { transit: { from: 'b', to: 'a', left: 1, progress: 0.5 } }),
    ]).fleets;
    const apart = Math.hypot(met[0].u - met[1].u, (met[0].v - met[1].v) / MAP_ASPECT);
    assert.ok(apart >= SETTLEMENT_RADIUS * HULL_LENGTH * 3 - 1e-12, `meeting squadrons ${apart} apart`);
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
