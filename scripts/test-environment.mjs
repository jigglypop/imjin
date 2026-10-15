// Deterministic game weather and designed tidal eddies; these checks make no real-world ocean prediction claims.
import assert from 'node:assert/strict';
import { DataUtils } from 'three/webgpu';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
const load = (path) => server.ssrLoadModule(path);
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}`, error); }
};
const near = (a, b, epsilon = 1e-8) => assert(Math.abs(a - b) < epsilon, `${a} != ${b}`);
try {
  const [environment, current, coast, scenarios, maps, options, battleModule, serverBattles] = await Promise.all([
    load('/src/sim/environment.ts'), load('/src/sim/current.ts'), load('/src/sim/grand/coast.ts'), load('/src/sim/scenarios.ts'),
    load('/src/sim/maps.ts'), load('/src/sim/conquest.ts'), load('/src/sim/battle.ts'), load('/server/battles.ts'),
  ]);
  const { environmentFor, environmentWind } = environment;
  const { CurrentField } = current;
  const { bakeCurrent } = await load('/src/ocean/currentTexture.ts');
  const spec = { cx: 0, cz: 0, angle: 0, peak: 1.8, reach: 2000, narrows: 280, turnAt: 300, slack: 80, floodFirst: true };
  const channel = (x, z) => Math.abs(z) < 350 ? -100 : 40;
  const base = { sky: 'afternoon', sea: 'moderate', night: false, climate: 'sheltered', current: spec };

  check('weather is reproducible without advancing any battle RNG and includes calm, rough, haze, sunset and nighttime', () => {
    const skies = new Set(), seas = new Set(), visibility = new Set();
    for (let seed = 0; seed < 200; seed++) {
      const a = environmentFor(base, seed), b = environmentFor(JSON.parse(JSON.stringify(base)), seed);
      assert.deepEqual(a, b);
      skies.add(a.sky); seas.add(a.sea); visibility.add(a.visibility);
      assert.equal(a.night, a.sky === 'night'); assert(a.visibility >= 0.1 && a.visibility <= 1);
      assert(Number.isFinite(a.wind.x) && Number.isFinite(a.wind.z));
    }
    assert.deepEqual([...skies].sort(), ['afternoon', 'day', 'night', 'overcast', 'sunset']);
    assert.deepEqual([...seas].sort(), ['calm', 'moderate', 'rough']); assert(visibility.has(0.48));
  });

  check('ranked conditions keep the written map, visibility one, and zero added leeway or tidal hazards for every seed', () => {
    const expected = { sky: 'afternoon', sea: 'moderate', night: false, visibility: 1, wind: { x: 0, z: 0 } };
    for (const seed of [0, 1, 1592, 89274, 0xffffffff]) assert.deepEqual(environmentFor(base, seed, true), expected);
    const night = environmentFor({ ...base, sky: 'night', night: true }, 6, true);
    assert.equal(night.night, true); assert.equal(night.sky, 'night'); assert.equal(night.visibility, 1);
  });

  check('exposed and offshore waters have more rough-sea games than sheltered harbours under the same seed sample', () => {
    const count = (climate) => Array.from({ length: 500 }, (_, seed) => environmentFor({ ...base, climate }, seed).sea === 'rough').filter(Boolean).length;
    assert(count('sheltered') < count('strait')); assert(count('strait') < count('exposed')); assert(count('exposed') < count('offshore'));
  });

  check('designed eddies reverse circulation across slack tide and use correct flood/ebb texture slots', () => {
    const field = new CurrentField({ ...spec, vortices: [{ x: 0, z: 0, r: 120, spin: 1, strength: 0.9 }] }, channel, 0), baked = bakeCurrent(field);
    try {
      const flood = field.velocity(100, 0, -1), ebb = field.velocity(100, 0, 1);
      assert(Math.abs(ebb.z) > 1); near(flood.x, -ebb.x); near(flood.z, -ebb.z);
      assert.deepEqual(field.velocity(100, 0, 0), { x: 0, z: 0 });
      assert(field.tideAt(0) < 0); assert.equal(field.tideAt(300), 0); assert(field.tideAt(600) > 0);
      const data = field.vortexData(); assert.equal(data.length, 32);
      assert.deepEqual(data.slice(4, 16), [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]);
      near(data[3], -0.9); near(data[19], 0.9);
      // The sea samples texel centres across `extent` around `centerWorld` and reads RG while the tide is below zero
      // (flood) and BA while it is above (ebb). The centre texel and one beside it lie in the eddy and a third along the
      // strait off the diagonal, so a bake that swapped the tides, flipped or transposed the rows or misplaced the square
      // would no longer hold the simulation's flow there.
      const size = baked.image.width;
      for (const [i, j] of [[96, 96], [150, 100], [90, 101]]) {
        const wx = field.centerWorld.x + ((i + 0.5) / size - 0.5) * field.extent;
        const wz = field.centerWorld.z + ((j + 0.5) / size - 0.5) * field.extent;
        const f = field.velocity(wx, wz, -1), e = field.velocity(wx, wz, 1);
        assert(Math.hypot(f.x, f.z) > 0.1 && Math.hypot(f.x - e.x, f.z - e.z) > 0.1);
        const o = (j * size + i) * 4;
        assert.deepEqual([...baked.image.data.slice(o, o + 4)], [f.x, f.z, e.x, e.z].map((v) => DataUtils.toHalfFloat(v)));
      }
    } finally { baked.dispose(); }
  });

  check('current velocity, eddy positions and wind rotate together with the map', () => {
    const vortices = [{ x: 200, z: 100, r: 100, spin: -1, strength: 0.6 }];
    const a = new CurrentField({ ...spec, vortices }, channel, 0), b = new CurrentField({ ...spec, vortices }, channel, Math.PI / 2);
    const straight = a.velocity(300, 100, 1), turned = b.velocity(-100, 300, 1);
    near(turned.x, -straight.z); near(turned.z, straight.x);
    const data = b.vortexData(); near(data[0], -100); near(data[1], 200);
    const e = environmentFor(base, 17), wind = environmentWind(e, Math.PI / 2);
    near(Math.cos(wind.angle) * wind.drift, -e.wind.z); near(Math.sin(wind.angle) * wind.drift, e.wind.x);
  });

  check('invalid, zero-spin, dry and missing eddies produce finite harmless padding', () => {
    const field = new CurrentField({ ...spec, vortices: [{ x: 0, z: 0, r: -1, spin: 1, strength: 1 }, { x: 0, z: 0, r: 50, spin: 0, strength: 1 }, { x: NaN, z: 0, r: 50, spin: 1, strength: 1 }, { x: 0, z: 400, r: 50, spin: 1, strength: 1 }] }, channel, 0);
    assert.deepEqual(field.vortexData(), Array.from({ length: 8 }, () => [0, 0, 1, 0]).flat());
    assert(Object.values(field.velocity(0, 0, 1)).every(Number.isFinite));
  });

  check('historical strait current presets stay intact; Yeosu and Mokpo have distinct designed eddies', () => {
    assert.equal(coast.REGION_MAPS.myeongnyang.current, scenarios.SCENARIOS.myeongnyang.current);
    assert.equal(coast.REGION_MAPS.noryang.current, scenarios.SCENARIOS.noryang.current);
    for (const [id, radius] of [['yeosu', 140], ['mokpo', 170]]) {
      const map = coast.REGION_MAPS[id]; assert.equal(map.current.vortices[0].r, radius);
      assert(map.points.some((p) => p.home === undefined && p.x === map.current.vortices[0].x && p.z === map.current.vortices[0].z));
      assert.deepEqual(coast.regionEnvironment(id, 81), coast.regionEnvironment(id, 81));
    }
    assert(coast.REGION_MAPS.mokpo.current.peak > coast.REGION_MAPS.yeosu.current.peak);
    assert(scenarios.SCENARIOS.myeongnyang.current.vortices === undefined);
  });

  check('the real casual conquest builder applies selected weather and current while ranked fleets keep fixed environments', () => {
    const seats = [{ name: 'A', faction: 'joseon', team: 'joseon', human: true, fleet: [] }, { name: 'B', faction: 'japan', team: 'japan', human: true, fleet: [] }];
    for (const map of Object.keys(maps.CONQUEST_MAPS)) {
      const seed = 1592, layout = maps.CONQUEST_MAPS[map];
      const e = environmentFor(layout, seed);
      const casual = maps.buildConquest(map, seats, () => -100, seed).battle;
      assert.equal(casual.night, e.night); near(casual.visibilityScale, e.visibility);
      near(casual.windDrift, Math.hypot(e.wind.x, e.wind.z));
      assert.equal(casual.waves.state.wind, ({ calm: 6.5, moderate: 10.5, rough: 13.5 })[e.sea]);
      assert.equal(!!casual.flow, !!e.current);
      const ranked = maps.buildConquest(map, seats, () => -100, seed, options.RANKED_OPTIONS).battle;
      assert.equal(ranked.night, layout.night); assert.equal(ranked.visibilityScale, 1); assert.equal(ranked.windDrift, 0); assert.equal(ranked.flow, null);
      assert.equal(ranked.waves.state.wind, ({ calm: 6.5, moderate: 10.5, rough: 13.5 })[layout.sea]);
    }
    const battle = new battleModule.Battle(33); const rngBefore = battle.random();
    environmentFor(base, 47); const next = battle.random();
    const control = new battleModule.Battle(33); assert.equal(control.random(), rngBefore); assert.equal(control.random(), next);
  });

  check('server and local conquest factories use identical weather, currents, visibility and seeded wave surfaces', () => {
    const seats = [{ name: 'A', faction: 'joseon', team: 'joseon', human: true, fleet: [] }, { name: 'B', faction: 'japan', team: 'japan', human: true, fleet: [] }];
    for (const map of Object.keys(maps.CONQUEST_MAPS)) for (const ranked of [false, true]) for (const seed of [2, 7, 1592]) {
      const local = maps.buildConquest(map, seats, () => -100, seed, ranked ? options.RANKED_OPTIONS : {}).battle;
      const remote = serverBattles.buildBattle({ kind: 'conquest', map, size: 2 }, () => -100, seats, ['A', 'B'], [true, true], seed, ranked).battle;
      assert.equal(remote.night, local.night); near(remote.visibilityScale, local.visibilityScale);
      near(remote.windAngle, local.windAngle); near(remote.windDrift, local.windDrift);
      assert.equal(!!remote.flow, !!local.flow);
      assert.deepEqual(Array.from(remote.waves.dirK), Array.from(local.waves.dirK));
      assert.deepEqual(Array.from(remote.waves.ampQ), Array.from(local.waves.ampQ));
      if (local.flow) assert.deepEqual(remote.flow.velocity(150, 30, -1), local.flow.velocity(150, 30, -1));
    }
  });

  console.log(`${failures ? 'FAIL' : 'PASS'} coastal environments (${failures} failed)`);
} finally { await server.close(); }
process.exitCode = failures ? 1 : 0;
