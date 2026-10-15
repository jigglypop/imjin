// Designed regional tactics: all selected hulls receive real orders, in mirrored layouts with no size gate.
import assert from 'node:assert/strict';
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
const near = (a, b, epsilon = 1e-7) => assert(Math.abs(a - b) < epsilon, `${a} != ${b}`);
try {
  const [tactics, battleModule, commands, maps, options, coast] = await Promise.all([
    load('/src/sim/coastal-tactics.ts'), load('/src/sim/battle.ts'), load('/src/sim/commands.ts'),
    load('/src/sim/maps.ts'), load('/src/sim/conquest.ts'), load('/src/sim/grand/coast.ts'),
  ]);
  const { COASTAL_TACTICS, coastalTacticFor, coastalFormationSlots } = tactics;
  const { Battle } = battleModule;
  const { applyCommand } = commands;

  check('regional game tactics are available only at their own ports', () => {
    assert.equal(coastalTacticFor('yeosu'), 'yeosu-wings'); assert.equal(coastalTacticFor('mokpo'), 'mokpo-depth');
    for (const id of ['hallyeo', 'gyeonnaeryang', 'busan', 'myeongnyang', '', 'unknown']) assert.equal(coastalTacticFor(id), undefined);
    assert.equal(COASTAL_TACTICS['yeosu-wings'].facing, 'broadside'); assert.equal(COASTAL_TACTICS['mokpo-depth'].facing, 'forward');
  });

  check('both tactics produce every requested finite unique slot through 600 hulls, without overlap', () => {
    for (const kind of Object.keys(COASTAL_TACTICS)) for (const count of [1, 2, 3, 13, 36, 120, 150, 300, 600]) {
      const slots = coastalFormationSlots(kind, count, { x: 0, z: 0 }, 0);
      assert.equal(slots.length, count); assert(slots.every((s) => Object.values(s).every(Number.isFinite)));
      assert.equal(new Set(slots.map((s) => `${s.x},${s.z}`)).size, count);
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) assert(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z) >= 55, `${kind}/${count}: overlap ${i}/${j}`);
    }
  });

  check('opposing seats get exactly mirrored positions and orientations under a pi turn', () => {
    for (const kind of Object.keys(COASTAL_TACTICS)) {
      const a = coastalFormationSlots(kind, 151, { x: 300, z: -220 }, 0.71);
      const b = coastalFormationSlots(kind, 151, { x: -300, z: 220 }, 0.71 + Math.PI);
      a.forEach((s, i) => { near(s.x, -b[i].x); near(s.z, -b[i].z); near(b[i].face - s.face, Math.PI); });
    }
  });

  check('Yeosu separates three wings and Mokpo keeps a much narrower, deeper shape', () => {
    const wings = coastalFormationSlots('yeosu-wings', 120, { x: 0, z: 0 }, 0), depth = coastalFormationSlots('mokpo-depth', 120, { x: 0, z: 0 }, 0);
    const width = (slots) => Math.max(...slots.map((s) => s.z)) - Math.min(...slots.map((s) => s.z));
    const length = (slots) => Math.max(...slots.map((s) => s.x)) - Math.min(...slots.map((s) => s.x));
    assert(width(wings) > width(depth) * 5); assert(length(depth) > length(wings) * 3);
    const wingCentres = [-1, 0, 1].map((_, w) => wings.filter((s, i) => i % 3 === w).reduce((sum, s, _, arr) => sum + s.z / arr.length, 0));
    assert(wingCentres[0] < -300 && Math.abs(wingCentres[1]) < 50 && wingCentres[2] > 300);
    assert(wings.every((s) => s.face === Math.PI / 2)); assert(depth.every((s) => s.face === 0));
  });

  check('invalid geometry requests return no slots and a single hull remains at its chosen origin', () => {
    for (const count of [0, -1, Infinity, NaN, 1.5]) assert.deepEqual(coastalFormationSlots('yeosu-wings', count, { x: 0, z: 0 }, 0), []);
    assert.deepEqual(coastalFormationSlots('unknown', 3, { x: 0, z: 0 }, 0), []);
    assert.deepEqual(coastalFormationSlots('mokpo-depth', 3, { x: NaN, z: 0 }, 0), []);
    assert.deepEqual(coastalFormationSlots('mokpo-depth', 1, { x: 300, z: -70 }, 0), [{ x: 300, z: -70, face: 0 }]);
  });

  const fixture = (kind, count = 150, land = () => -100) => {
    const battle = new Battle(379, 'competitive-v1');
    battle.land = land; battle.coastalTactic = kind; battle.humans = new Set([0, 1, 2]); battle.windDrift = 0;
    const squad = battle.addSquadron('joseon', 'Main', '', '', '', 0), ally = battle.addSquadron('joseon', 'Ally', '', '', '', 2), enemy = battle.addSquadron('japan', 'Enemy', '', '', '', 1);
    const own = Array.from({ length: count }, (_, i) => battle.addShip('hyeopseon', (i % 15 - 7) * 60, Math.floor(i / 15) * 60, Math.PI / 2, `Hull ${i}`, squad));
    const other = [battle.addShip('hyeopseon', 2400, 2400, 0, 'Ally', ally), battle.addShip('kobaya', 6000, 6000, 0, 'Enemy', enemy)];
    for (const s of [...own, ...other]) { s.order = { type: 'hold' }; s.fireMode = 'hold'; }
    return { battle, own, other };
  };

  check('real authoritative commands assign 150 owned hulls, exclude allies and enemies, and move the fleet', () => {
    for (const kind of Object.keys(COASTAL_TACTICS)) {
      const { battle, own, other } = fixture(kind);
      assert.equal(applyCommand(battle, 0, { type: 'formation', ids: [...own, ...other].map((s) => s.id), kind, cx: 0, cz: 2000 }), 150);
      assert(own.every((s) => s.order.type === 'slot' && Number.isFinite(s.order.x) && Number.isFinite(s.order.z)));
      assert(other.every((s) => s.order.type === 'hold'));
      const before = own.map((s) => ({ x: s.x, z: s.z }));
      for (let step = 0; step < 120; step++) battle.step(1 / 30);
      assert(own.some((s, i) => Math.hypot(s.x - before[i].x, s.z - before[i].z) > 1));
    }
  });

  check('regional wire commands fail without the matching authoritative region and reject nonfinite targets', () => {
    const { battle, own } = fixture('mokpo-depth', 3);
    const before = own.map((s) => structuredClone(s.order));
    assert.equal(applyCommand(battle, 0, { type: 'formation', ids: own.map((s) => s.id), kind: 'yeosu-wings', cx: 0, cz: 500 }), 0);
    assert.deepEqual(own.map((s) => s.order), before);
    assert.equal(applyCommand(battle, 0, { type: 'formation', ids: own.map((s) => s.id), kind: 'mokpo-depth', cx: NaN, cz: 500 }), 0);
    battle.coastalTactic = undefined;
    assert.equal(applyCommand(battle, 0, { type: 'formation', ids: own.map((s) => s.id), kind: 'mokpo-depth', cx: 0, cz: 500 }), 0);
  });

  check('ranked builders expose no regional tactics, while an adapted Yeosu map carries its designed command', () => {
    const seats = [{ name: 'A', faction: 'joseon', team: 'joseon', human: true, fleet: [] }, { name: 'B', faction: 'japan', team: 'japan', human: true, fleet: [] }];
    const ranked = maps.buildConquest('hallyeo', seats, () => -100, 1, options.RANKED_OPTIONS).battle;
    assert.equal(ranked.coastalTactic, undefined);
    const map = { ...coast.REGION_MAPS.yeosu, coastalTactic: coastalTacticFor('yeosu') };
    const local = maps.buildConquestOn(map, seats, () => -100, 1).battle;
    try { assert.equal(local.coastalTactic, 'yeosu-wings'); }
    finally { local.flow?.texture.dispose(); }
  });

  check('terrain adjustment keeps 300 commanded hulls in water and reserves separate berths', () => {
    const land = (x, z) => Math.abs(x) < 250 && z > -1200 && z < 1200 ? 30 : -100;
    const { battle, own } = fixture('mokpo-depth', 300, land);
    assert.equal(applyCommand(battle, 0, { type: 'formation', ids: own.map((s) => s.id), kind: 'mokpo-depth', cx: 0, cz: 3000 }), 300);
    assert(own.every((s) => s.order.type === 'slot' && land(s.order.x, s.order.z) < -4));
    const positions = own.map((s) => s.order);
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) assert(Math.hypot(positions[i].x - positions[j].x, positions[i].z - positions[j].z) >= 10, `overlap ${i}/${j}`);
  });

  console.log(`${failures ? 'FAIL' : 'PASS'} coastal tactics (${failures} failed)`);
} finally { await server.close(); }
process.exitCode = failures ? 1 : 0;
