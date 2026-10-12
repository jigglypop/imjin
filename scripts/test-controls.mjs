// Actual input and authoritative command methods, without a renderer or browser.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'imjin-controls-'));
const bundled = join(temporary, 'controls.mjs');
const storage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = globalThis.sessionStorage = storage;
globalThis.window = { localStorage: storage, sessionStorage: storage, matchMedia: () => ({ matches: false }) };
globalThis.document = { documentElement: { lang: 'ko' } };
globalThis.location = { search: '', pathname: '/' };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'controls-test', language: 'ko', maxTouchPoints: 0 } });
globalThis.matchMedia = () => ({ matches: false });
let failures = 0;
const timers = [];
const realTimeout = globalThis.setTimeout;
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}`, error); }
};
try {
  const built = await build({ stdin: { contents: "export {Input} from './src/game/Input'; export {Battle} from './src/sim/battle'; export {applyCommand} from './src/sim/commands'; export {RtsCamera} from './src/camera/RtsCamera'; export {Director, AMBIENT_SHAKE} from './src/game/Director'; export {cameraFeel} from './src/camera/feel'; export {PerspectiveCamera} from 'three/webgpu'; export {tName as battleName} from './src/ui/battleNames'; export {tName as grandName} from './src/ui/grand/text'; export {numbered,fleetNo} from './src/i18n/names'; export {setLang} from './src/i18n';", resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  await writeFile(bundled, built.outputFiles[0].contents);
  const { Input, Battle, applyCommand, RtsCamera, Director, AMBIENT_SHAKE, cameraFeel, PerspectiveCamera, battleName, grandName, numbered, fleetNo, setLang } = await import(pathToFileURL(bundled).href);
  globalThis.setTimeout = (fn, delay, ...args) => { const timer = realTimeout(fn, delay, ...args); timers.push(timer); return timer; };
  const setup = () => {
    const battle = new Battle(1592, 'competitive-v1');
    battle.humans = new Set([0]); battle.land = () => -100;
    const own = battle.addSquadron('joseon', 'Own', '', '', '', 0);
    const ally = battle.addSquadron('joseon', 'Ally', '', '', '', 2);
    const enemy = battle.addSquadron('japan', 'Enemy', '', '', '', 1);
    const a = battle.addShip('panokseon', 100, 100, 0, 'A', own);
    const b = battle.addShip('hyeopseon', 200, 100, 0, 'B', own);
    const c = battle.addShip('panokseon', 250, 100, 0, 'Ally', ally);
    const d = battle.addShip('kobaya', 900, 100, 0, 'Enemy', enemy);
    const engine = { battle, owner: 0, remote: null, team: 'joseon', enemyTeam: 'japan', views: { selected: new Set() }, rts: { followId: 0, cinematic: false, goal: { tx: 0, tz: 0, distance: 1200 } }, fx: { spray: { emit() {} } }, sound: { drums() {} }, published: 0, publish() { this.published += 1; } };
    engine.isOwn = (s) => engine.battle.isActive(s) && s.owner === engine.owner;
    engine.issue = (cmd) => applyCommand(engine.battle, engine.owner, cmd);
    const input = new Input(engine);
    const key = (code, modifiers = {}, target = { tagName: 'DIV' }) => input.onKey({ code, repeat: false, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target, preventDefault() {}, ...modifiers });
    return { engine, battle, input, key, a, b, c, d };
  };
  check('groups assign, add, select, focus, name, and exclude allied or dead ships', () => {
    const { engine, input, key, a, b, c, d } = setup();
    engine.views.selected = new Set([a.id, c.id, d.id]); key('Digit1', { ctrlKey: true });
    assert.equal(input.getGroups()[0].count, 1);
    engine.views.selected = new Set([b.id]); key('Digit1', { shiftKey: true });
    assert.equal(input.getGroups()[0].count, 2);
    key('Digit1'); assert.deepEqual([...engine.views.selected], [a.id, b.id]);
    key('Digit1'); assert.equal(engine.rts.goal.tx, 150); assert.equal(engine.rts.goal.tz, 100);
    input.renameGroup(0, '  Main   fleet  '); assert.equal(input.getGroups()[0].name, 'Main fleet');
    b.alive = false; key('Digit1'); assert.deepEqual([...engine.views.selected], [a.id]);
    engine.battle = new Battle(2); assert.equal(input.getGroups()[0].count, 0); assert.notEqual(input.getGroups()[0].name, 'Main fleet');
  });
  check('Ctrl+A owns only active ships; editing and repeated keys do not trigger commands', () => {
    const { engine, input, key, a, b } = setup();
    b.struck = true; key('KeyA', { ctrlKey: true }); assert.deepEqual([...engine.views.selected], [a.id]);
    key('Digit1', { ctrlKey: true, repeat: true }); assert.equal(input.getGroups()[0].count, 0);
    key('Digit1', { ctrlKey: true }, { tagName: 'TEXTAREA' }); assert.equal(input.getGroups()[0].count, 0);
    key('Digit1', { ctrlKey: true }, { tagName: 'DIV', isContentEditable: true }); assert.equal(input.getGroups()[0].count, 0);
  });
  check('plain digits choose groups; Alt digits still issue formation and speed commands', () => {
    const { engine, input, key, a } = setup(); engine.views.selected.add(a.id);
    const before = JSON.stringify(a.order); key('Digit1'); assert.equal(JSON.stringify(a.order), before);
    key('Digit1', { altKey: true }); assert.equal(a.order.type, 'slot');
    key('Digit6', { altKey: true }); assert.equal(a.speedCap, 0.6);
    key('Digit7', { ctrlKey: true }); assert.equal(input.getGroups()[6].count, 1);
  });
  check('Shift right-click and touch queue mode send real queued formation destinations', () => {
    const { engine, input, a, b } = setup(); engine.views.selected = new Set([a.id, b.id]);
    input.pickShip = () => undefined; input.pickWorks = () => null; input.waterPoint = () => ({ x: 800, z: 400 });
    input.onDown({ pointerType: 'mouse', button: 2, clientX: 20, clientY: 20, shiftKey: false });
    input.onDown({ pointerType: 'mouse', button: 2, clientX: 30, clientY: 30, shiftKey: true });
    assert.equal(a.orderQueue.length, 1); assert.equal(b.orderQueue.length, 1); assert.notEqual(a.orderQueue[0].x, b.orderQueue[0].x);
    input.toggleQueueMode(); input.tap(30, 30); assert.equal(input.queuedWaypoints(), 2);
    engine.remote = {}; a.remoteQueueCount = 7; b.remoteQueueCount = 3; assert.equal(input.queuedWaypoints(), 7);
  });
  check('authoritative waypoint queues are bounded, cloned, validated and owner restricted', () => {
    const { battle, a, c } = setup();
    const move = { type: 'move', x: 500, z: 500 };
    assert.equal(applyCommand(battle, 0, { type: 'order', ids: [a.id, c.id], order: move }), 1);
    assert.equal(c.order.type, 'auto');
    for (let i = 0; i < 30; i++) applyCommand(battle, 0, { type: 'order', ids: [a.id, c.id], order: { type: 'move', x: i * 100, z: 600 }, queue: true });
    assert.equal(a.orderQueue.length, 16); assert.equal(c.orderQueue, undefined);
    assert.equal(applyCommand(battle, 0, { type: 'order', ids: [a.id], order: move, queue: true }), 0);
    assert.equal(applyCommand(battle, 0, { type: 'orders', list: [{ id: a.id, order: { type: 'move', x: NaN, z: 0 } }], queue: true }), 0);
    assert.equal(applyCommand(battle, 0, { type: 'order', ids: [a.id], order: { type: 'attack', targetId: c.id }, queue: true }), 0);
    assert.equal(applyCommand(battle, 0, { type: 'order', ids: [a.id], order: move, queue: 'true' }), 0);
    move.x = 9999; assert.equal(a.order.x, 500);
    assert.equal(applyCommand(battle, 0, { type: 'order', ids: [a.id], order: { type: 'hold' } }), 1);
    assert.equal(a.orderQueue, undefined); assert.equal(a.order.type, 'hold');
  });
  check('480-ship formation orders and queued moves reach every owner ship beyond index 400', () => {
    const { battle, engine, input, d } = setup();
    battle.removeShips((s) => s.owner === 0 || s.owner === 2);
    const own = battle.addSquadron('joseon', 'Large fleet', '', '', '', 0);
    const fleet = Array.from({ length: 480 }, (_, i) => battle.addShip('kobaya', i * 35, 0, 0, `Ship ${i}`, own));
    engine.views.selected = new Set(fleet.map((s) => s.id));
    input.moveSelected(4000, 5000, false);
    assert.equal(fleet.filter((s) => s.order.type === 'move').length, 480);
    const firstDestinations = fleet.map((s) => ({ ...s.order }));
    input.moveSelected(6000, 7000, true);
    assert.equal(fleet.filter((s) => s.orderQueue?.length === 1).length, 480);
    for (let i = 0; i < fleet.length; i++) assert.deepEqual(fleet[i].order, firstDestinations[i]);
    const foreignOrder = { ...d.order };
    const list = [...fleet.map((s, i) => ({ id: s.id, order: { type: 'move', x: 8000 + i, z: 9000 } })), { id: d.id, order: { type: 'move', x: 0, z: 0 } }];
    assert.equal(applyCommand(battle, 0, { type: 'orders', list, queue: true }), 480);
    assert.deepEqual(d.order, foreignOrder); assert.equal(d.orderQueue, undefined);
    for (const s of fleet) {
      assert.equal(s.orderQueue.length, 2);
      assert.deepEqual(s.orderQueue[1], list.find((item) => item.id === s.id).order);
    }
    assert.equal(applyCommand(battle, 0, { type: 'orders', list: list.map((item) => ({ id: item.id, order: { type: 'hold' } })) }), 480);
    assert.equal(fleet.filter((s) => s.order.type === 'hold' && s.orderQueue === undefined).length, 480);
  });
  check('arrival starts the next waypoint; explicit orders, tactics and formations clear routes', () => {
    const { battle, a } = setup();
    battle.setOrder([a.id], { type: 'move', x: a.x, z: a.z });
    battle.setOrder([a.id], { type: 'move', x: 600, z: 800 }, true);
    battle.think(a); assert.deepEqual(a.order, { type: 'move', x: 600, z: 800 }); assert.equal(a.orderQueue, undefined);
    a.x = 600; a.z = 800; battle.think(a); assert.equal(a.order.type, 'hold');
    battle.setOrder([a.id], { type: 'move', x: 1200, z: 800 }); battle.setOrder([a.id], { type: 'move', x: 1200, z: 1200 }, true);
    applyCommand(battle, 0, { type: 'configure', ids: [a.id], patch: { stance: 'standoff' } }); assert.equal(a.orderQueue, undefined);
    battle.setOrder([a.id], { type: 'move', x: 1200, z: 800 }); battle.setOrder([a.id], { type: 'move', x: 1200, z: 1200 }, true);
    applyCommand(battle, 0, { type: 'formation', ids: [a.id], kind: 'line', cx: 2000, cz: 800 }); assert.equal(a.orderQueue, undefined);
  });
  check('rally selection works with no selected ships, touch, invalid ownership and cancellation', () => {
    const { engine, input, key, battle } = setup();
    engine.conquest = { points: [{ owner: 0 }, { owner: 1 }] };
    const commands = []; engine.issue = (cmd) => { commands.push(cmd); return 1; };
    input.waterPoint = () => ({ x: 700, z: 300 });
    assert.equal(input.beginRally(1), false); assert.equal(commands.length, 0);
    assert.equal(input.beginRally(0), true); input.onDown({ pointerType: 'mouse', button: 2, clientX: 30, clientY: 30, shiftKey: false });
    assert.deepEqual(commands[0], { type: 'rally', point: 0, x: 700, z: 300 });
    input.beginRally(0); input.tap(30, 30); assert.equal(commands.length, 2);
    input.beginRally(0); key('Escape'); input.onDown({ pointerType: 'mouse', button: 2, clientX: 30, clientY: 30, shiftKey: false }); assert.equal(commands.length, 2);
    input.beginRally(0); battle.land = () => 10; input.tap(30, 30); assert.equal(commands.length, 2);
    engine.conquest.points[0].owner = 1; input.tap(30, 30); assert.equal(commands.length, 2);
  });
  check('a left-click on an enemy ship attacks with the selection and only inspects it with none', () => {
    const { engine, input, a, b, c, d } = setup();
    const commands = []; engine.issue = (cmd) => { commands.push(cmd); return 1; };
    let hit = d; input.pickShip = () => hit; input.pickWorks = () => null;
    const click = (modifiers = {}) => { input.onDown({ pointerType: 'mouse', button: 0, clientX: 5, clientY: 5, altKey: false }); input.onUp({ pointerType: 'mouse', button: 0, clientX: 5, clientY: 5, shiftKey: false, ctrlKey: false, metaKey: false, ...modifiers }); };
    click(); assert.equal(commands.length, 0); assert.deepEqual([...engine.views.selected], [d.id]);
    engine.views.selected = new Set([a.id, b.id]); click();
    assert.deepEqual(commands, [{ type: 'order', ids: [a.id, b.id], order: { type: 'attack', targetId: d.id } }]); assert.deepEqual([...engine.views.selected], [a.id, b.id]);
    click({ shiftKey: true }); click({ ctrlKey: true }); assert.equal(commands.length, 1);
    engine.views.selected = new Set([a.id]); hit = c; click(); assert.equal(commands.length, 1); assert.deepEqual([...engine.views.selected], [c.id]);
    engine.views.selected = new Set([a.id]); hit = undefined; input.pickWorks = () => ({ x: 1, y: 2, z: 3, name: 'Fort' }); click();
    assert.deepEqual(commands[1], { type: 'order', ids: [a.id], order: { type: 'bombard', x: 1, y: 2, z: 3 } });
    input.pickWorks = () => null; click(); assert.equal(commands.length, 2); assert.equal(engine.views.selected.size, 0);
  });
  check('gunfire cannot shake the camera past its cap, and an explosion still can', () => {
    const camera = new RtsCamera(new PerspectiveCamera());
    for (let i = 0; i < 200; i++) camera.shake(0.3, AMBIENT_SHAKE);
    assert.ok(camera.shakeAmount <= AMBIENT_SHAKE + 1e-9, String(camera.shakeAmount));
    camera.shake(1.1);
    assert.ok(camera.shakeAmount > AMBIENT_SHAKE + 0.5, 'a big event goes past the cap');
    const thrown = camera.shakeAmount;
    camera.shake(0.2, AMBIENT_SHAKE);
    assert.equal(camera.shakeAmount, thrown, 'a capped call never lowers what a big event left');
  });
  check('the shake setting scales the offsets and Off leaves the camera still', () => {
    const pose = (feel) => {
      cameraFeel.set(feel);
      const camera = new PerspectiveCamera(), rts = new RtsCamera(camera);
      rts.setPose({ tx: 0, tz: 0, yaw: 0.4, pitch: 0.5, distance: 80 });
      rts.update(1 / 60, null); const rest = camera.position.clone(), restQuat = camera.quaternion.clone();
      rts.shake(1); rts.update(1 / 60, null);
      return { move: camera.position.distanceTo(rest), turn: camera.quaternion.angleTo(restQuat) };
    };
    try {
      const off = pose('off'), low = pose('low'), full = pose('full');
      assert.ok(off.move < 1e-9 && off.turn < 1e-9, 'off does not shake');
      assert.ok(low.turn > 0 && low.turn < full.turn, `light ${low.turn} is gentler than full ${full.turn}`);
    } finally { cameraFeel.set('low'); }
  });
  check('the field-of-view punch comes once per near big gun, not once per gun', () => {
    const camera = new PerspectiveCamera(); camera.position.set(0, 20, 0);
    const host = { battle: { get: () => undefined, ships: [], time: 0 }, team: 'joseon', rts: new RtsCamera(camera), camera, remote: null, paused: false, fastForward: false, speed: 1, fx: { liftOf: () => 0 } };
    const director = new Director(host);
    const volley = (n) => Array.from({ length: n }, (_, i) => ({ type: 'gun', ship: 100 + i, x: 15, y: 5, z: 10, dx: 1, dz: 0, big: true, gun: 'cheonja' }));
    director.feed(volley(60));
    assert.ok(director.fovKick > 0 && director.fovKick <= 1.0 + 1e-9, `a whole volley kicks ${director.fovKick} degrees at most`);
    const first = director.fovKick;
    director.feed(volley(60));
    assert.equal(director.fovKick, first, 'more guns in the same moment add nothing');
    director.clock = 0.5; director.fovKick = 0; director.feed(volley(5));
    assert.equal(director.fovKick, 0, 'a second punch waits for the quiet time');
    director.clock = 2; director.feed(volley(5));
    assert.ok(director.fovKick > 0, 'and comes after it');
    const farCamera = new PerspectiveCamera(); farCamera.position.set(900, 20, 0);
    const far = new Director({ ...host, camera: farCamera });
    far.feed(volley(10));
    assert.equal(far.fovKick, 0, 'a gun far from the camera does not punch it');
  });
  check('camera ignores Ctrl+A and editable targets while ordinary A still pans', () => {
    const camera = new RtsCamera(new PerspectiveCamera());
    camera.onKey({ code: 'KeyA', ctrlKey: true, target: { tagName: 'DIV' } }); assert.equal(camera.keys.has('KeyA'), false);
    camera.onKey({ code: 'KeyA', target: { tagName: 'TEXTAREA' } }); assert.equal(camera.keys.has('KeyA'), false);
    camera.onKey({ code: 'KeyA', target: { tagName: 'DIV' } }); assert.equal(camera.keys.has('KeyA'), true);
    camera.onKey({ code: 'KeyA', metaKey: true, target: { tagName: 'DIV' } }); assert.equal(camera.keys.has('KeyA'), false);
  });
  check('generated fleet and ship names stay translated beyond 12 fleets and 99 ships', () => {
    setLang('en');
    for (const translate of [battleName, grandName]) {
      assert.equal(translate(fleetNo('고바야', 13)), 'Kobaya Fleet 13');
      assert.equal(translate(fleetNo('명 사선', 50)), 'Ming small junk Fleet 50');
      assert.equal(translate(numbered('고바야', 314)), 'Kobaya #314');
      assert.equal(translate(numbered('판옥선', 100)), 'Panokseon #100');
    }
    setLang('ko');
    for (const translate of [battleName, grandName]) assert.equal(translate(fleetNo('고바야', 13)), fleetNo('고바야', 13));
  });
} finally {
  globalThis.setTimeout = realTimeout;
  for (const timer of timers) clearTimeout(timer);
  await rm(bundled, { force: true }); await rmdir(temporary);
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exitCode = failures ? 1 : 0;
