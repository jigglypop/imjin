// CPU regression tests exercise the real lifecycle/frame methods with controlled asset I/O; no GPU is created.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'imjin-render-'));
const defer = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const events = () => {
  const handlers = new Map();
  return {
    addEventListener(type, handler) {
      const list = handlers.get(type) ?? new Set();
      list.add(handler);
      handlers.set(type, list);
    },
    removeEventListener(type, handler) { handlers.get(type)?.delete(handler); },
    count() { return [...handlers.values()].reduce((n, set) => n + set.size, 0); },
  };
};
const storage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { ...events(), localStorage: storage, sessionStorage: storage, devicePixelRatio: 1 };
globalThis.document = { ...events(), hidden: false, documentElement: { lang: 'ko' } };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'render-test', language: 'ko', platform: '', maxTouchPoints: 0 } });
globalThis.location = { search: '', pathname: '/' };
globalThis.localStorage = globalThis.sessionStorage = storage;
globalThis.matchMedia = () => ({ matches: false });
globalThis.screen = { width: 1920, height: 1080 };
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);

async function bundle(name, contents, fixtures = {}) {
  const result = await build({
    stdin: { contents, resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'node',
    define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
    plugins: [{ name: 'controlled-asset-io', setup(api) {
      api.onLoad({ filter: /\.(ts|js)$/ }, ({ path }) => {
        const match = Object.entries(fixtures).find(([suffix]) => path.replaceAll('\\', '/').endsWith(suffix));
        if (match) return { contents: match[1], loader: 'ts', resolveDir: root };
      });
    } }],
  });
  const path = join(temporary, `${name}.mjs`);
  await writeFile(path, result.outputFiles[0].contents);
  // Each isolated bundle has its own Three module; this is intentional and no renderer crosses bundles.
  delete window.__THREE__;
  return import(pathToFileURL(path).href);
}

const texture = () => ({ disposed: 0, dispose() { this.disposed += 1; } });
const sky = (name) => ({ name, view: texture(), environment: texture(), info: {} });
const aborted = (error) => error?.name === 'AbortError';
let passed = 0;
async function check(name, test) {
  await test();
  passed += 1;
  console.log(`ok - ${name}`);
}

try {
  const { Engine, RtsCamera, Input, Director, Munitions, WakeMap, pointVisible, Battle: SimBattle, PerspectiveCamera: BattleCamera } = await bundle('engine', `
    export { Engine } from './src/game/Engine.ts';
    export { RtsCamera } from './src/camera/RtsCamera.ts';
    export { Input } from './src/game/Input.ts';
    export { Battle } from './src/sim/battle.ts';
    export { Director } from './src/game/Director.ts';
    export { Munitions } from './src/fx/Projectiles.ts';
    export { WakeMap } from './src/ocean/WakeMap.ts';
    export { pointVisible } from './src/sim/visibility.ts';
    export { PerspectiveCamera } from 'three/webgpu';`, {
    'render/sky.ts': `export const SKY_PRESETS = Object.fromEntries(['afternoon','day','sunset','overcast','night'].map(name => [name,{name,night:0,clouds:{}}]));
      export const loadSky = (...args) => globalThis.__renderSky(...args);
      export const viewTexture = () => ({ dispose() {} });`,
    'terrain/Terrain.ts': 'export class Terrain { static load(...args) { return globalThis.__renderTerrain(...args); } }',
    'ocean/Ocean.ts': 'export class Ocean { mesh = {}; dispose() {} }',
    'fx/Crew.ts': 'export const crewAssets = () => Promise.resolve(new Map()); export class Crew { group = {}; dispose() {} }',
    'terrain/Structures.ts': 'export const preloadStructures = () => Promise.resolve(); export class Structures {}',
    'conquest/ConquestView.ts': 'export const preloadWorks = () => Promise.resolve(); export class ConquestView {}',
    'ships/ShipRenderer.ts': 'export const CUT_CAP = 1, LOD_COUNT = 3; export const modelKey = (kind) => kind; export const packFlash = (flash) => flash; export class ShipRenderer {} export const loadShipAssets = () => Promise.resolve({}); export const releaseShipAssets = () => Promise.resolve();',
  });
  const base = () => Object.assign(Object.create(Engine.prototype), {
    disposed: false, ready: true, loading: null, skyLoading: null, sky: null, eq: { skySize: 'small' },
    conquestSetup: null, faction: 'joseon', scene: { add() {} }, options: {}, minimap: {},
    rts: { detach() {} }, camera: { position: { x: 0, y: 0, z: 0 } }, renderer: { dispose: () => Promise.resolve() },
    wake: { dispose() {} }, publish() {},
    cinema: { speed: (s) => s, update: () => false, feed() {}, begin() {}, onCommand() {}, covering: false, grade: 0, depthOfField: { aperture: 0, focus: 100 } },
  });

  await check('F tilts only the camera; Shift+F changes cutaway once and clears held F', () => {
    let cutaways = 0;
    const rts = new RtsCamera(new BattleCamera());
    const input = new Input({ toggleCutaway() { cutaways += 1; } });
    const key = (code, shiftKey = false, repeat = false) => ({ code, shiftKey, repeat, target: null });
    const press = (event) => { input.onKey(event); rts.onKey(event); };
    const initial = rts.goal.pitch;
    press(key('KeyF'));
    rts.update(0.1, null);
    assert.ok(rts.goal.pitch < initial);
    assert.equal(cutaways, 0);
    rts.onKeyUp(key('KeyF'));
    const tilted = rts.goal.pitch;
    press(key('KeyF', true));
    rts.update(0.1, null);
    assert.equal(rts.goal.pitch, tilted);
    assert.equal(cutaways, 1);
    press(key('KeyF', true, true));
    assert.equal(cutaways, 1, 'holding Shift+F must not cycle through decks');
    rts.onKeyUp(key('KeyF', true));
    press(key('KeyF'));
    assert.equal(rts.keys.has('KeyF'), true);
    rts.onKey(key('ShiftLeft', true));
    assert.equal(rts.keys.has('KeyF'), false);
    rts.update(0.1, null);
    assert.equal(rts.goal.pitch, tilted, 'adding Shift while F is held stops camera tilt');
  });

  await check('latest sky wins; returning to the active sky cancels a pending choice', async () => {
    const downloads = [];
    globalThis.__renderSky = (preset, size, reuse, signal) => {
      const download = defer();
      downloads.push({ ...download, name: preset.name, signal });
      // Intentionally ignore cancellation here: setSky must also guard a late result itself.
      return download.promise;
    };
    const engine = Object.assign(base(), { sky: sky('afternoon'), skyName: 'afternoon', applied: [],
      applySky(value) { this.sky = value; this.applied.push(value.name); },
    });
    const first = engine.setSky('sunset');
    const second = engine.setSky('night');
    downloads[1].resolve(sky('night'));
    await second;
    const stale = sky('sunset');
    downloads[0].resolve(stale);
    await first;
    assert.deepEqual(engine.applied, ['night']);
    assert.equal(engine.skyName, 'night');
    assert.equal(stale.view.disposed, 1);
    const third = engine.setSky('overcast');
    await engine.setSky('night');
    assert.equal(downloads[2].signal.aborted, true);
    downloads[2].resolve(sky('overcast'));
    await third;
    assert.deepEqual(engine.applied, ['night']);
  });

  await check('effects use completed fixed steps, pause freezes them, remote effects keep frame time', () => {
    const received = {};
    let reports = 0;
    const engine = Object.assign(base(), {
      pageHidden: false, fpsFrames: 0, fpsTime: 0, speed: 128, paused: false, fastForward: false,
      accumulator: 0, lastTide: -1, publishTimer: 1, minimapTimer: 1, cutaway: 0,
      battle: { time: 0, tide: 0, events: [], ended: false },
      director: { timeFactor: () => 1, update() {} }, updateFastForward() {}, cutawayIds: () => [],
      stepSim(dt) { this.battle.time += dt; },
      views: { cutaway: new Map(), sync(b, dt) { received.views = dt; } }, stampWakes(e, dt) { received.wakes = dt; },
      rts: { followId: 0, update() {} }, ocean: { setTide() {}, update() {} },
      sound: { setRoar() {}, tick(b, c, dt) { received.sound = dt; } },
      fx: { update(b, dt) { received.fx = dt; } }, crew: { update(b, dt) { received.crew = dt; } },
      lanterns: { update() {} }, crewView: () => ({}), updateSun() {}, skyName: 'afternoon',
      renderer: { domElement: {} }, reported: true,
      finishCampaignBattle() { reports += 1; this.reported = true; },
    });
    engine.update(0.1);
    assert.ok(engine.battle.time > 0 && engine.battle.time < 12.8);
    for (const dt of Object.values(received)) assert.equal(dt, engine.battle.time);
    assert.equal(engine.lastScaled, engine.battle.time);
    const before = engine.battle.time;
    engine.accumulator = 0.05;
    engine.paused = true;
    engine.update(0.1);
    assert.equal(engine.battle.time, before);
    for (const dt of Object.values(received)) assert.equal(dt, 0);
    engine.remote = { advance(b) { b.time += 3.2; }, playbackPace: 32 };
    engine.update(0.1);
    for (const dt of Object.values(received)) assert.equal(dt, 0.1);
    engine.remote = null;
    engine.paused = false;
    engine.battle.ended = true;
    engine.reported = false;
    engine.update(0.1);
    assert.ok(received.fx > 0, 'residual effects must keep advancing after a result');
    assert.equal(reports, 1, 'a draw with no winner still produces the end report');
  });

  await check('hidden local events are consumed every frame and never replay after scouting', () => {
    const battle = new SimBattle(99, 'competitive-v1');
    battle.land = () => -100;
    battle.addShip('panokseon', 0, 0, 0, 'Own', null);
    const enemy = battle.addShip('atakebune', 3000, 0, 0, 'Hidden', null);
    let effects = 0;
    const seen = (events) => { effects += events.length; };
    const engine = Object.assign(base(), {
      battle, conquest: null, pageHidden: false, fpsFrames: 0, fpsTime: 0, speed: 1, paused: true,
      fastForward: false, accumulator: 0, publishTimer: 10, minimapTimer: 10,
      director: { timeFactor: () => 1, update() {}, feed: seen }, updateFastForward() {}, cutawayIds: () => [],
      views: { cutaway: new Map(), sync() {} }, stampWakes() {},
      rts: { followId: 0, update() {} }, ocean: { setTide() {}, update() {} },
      sound: { setRoar() {}, tick() {}, update: seen }, fx: { update() {}, handle: seen },
      crew: { update() {}, handle: seen }, input: { onEvents: seen }, lanterns: { update() {} },
      crewView: () => ({}), updateSun() {}, skyName: 'afternoon', renderer: { domElement: {} },
    });
    for (let frame = 0; frame < 3; frame++) {
      battle.events.push({ type: 'gun', ship: enemy.id });
      engine.update(0.1);
      assert.deepEqual(battle.events, [], 'discarded events cannot accumulate');
    }
    battle.addShip('hyeopseon', 2900, 0, 0, 'Scout', null);
    battle.time += 0.25;
    engine.update(0.1);
    assert.equal(effects, 0, 'revealing a hull cannot replay its previous hidden volleys');
    battle.events.push({ type: 'gun', ship: enemy.id });
    engine.update(0.1);
    assert.equal(effects, 5, 'new observed events reach the five consumers');
  });

  await check('motion wakes skip hidden hulls, forget unseen journeys and freeze while paused', () => {
    const battle = new SimBattle(24, 'competitive-v1');
    battle.land = () => -100;
    const own = battle.addShip('panokseon', 0, 0, 0, 'Own', null);
    const enemy = battle.addShip('atakebune', 3000, 0, 0, 'Hidden', null);
    own.speed = enemy.speed = 3;
    enemy.observed = false;
    const wake = new WakeMap(64);
    const engine = Object.assign(base(), { battle, wake });
    const stamps = [];
    const stamp = wake.stamp.bind(wake);
    wake.stamp = (...args) => { stamps.push(args); stamp(...args); };
    engine.stampWakes([], 1 / 60);
    assert.ok(stamps.length > 0, 'a moving observed ship leaves a wake');
    assert.ok(stamps.every(([x]) => Math.abs(x) < 100), 'unseen hulls contribute no stamp positions');
    assert.equal(wake.trails.has(enemy.id), false);
    enemy.x = 200; enemy.observed = true;
    engine.stampWakes([], 1 / 60);
    assert.equal(wake.trails.get(enemy.id).x, 200);
    enemy.x = 350; enemy.observed = false;
    stamps.length = 0;
    engine.stampWakes([], 1 / 60);
    assert.ok(stamps.every(([x]) => Math.abs(x) < 100));
    assert.equal(wake.trails.has(enemy.id), false, 'last known hull position cannot track a hidden journey');
    enemy.x = 700; enemy.observed = true;
    stamps.length = 0;
    engine.stampWakes([], 1 / 60);
    assert.ok(stamps.every(([x]) => Math.abs(x) < 100 || Math.abs(x - enemy.x) < 100), 're-observation never draws a connecting wake through unseen water');
    const previous = { ...wake.trails.get(enemy.id) };
    stamps.length = 0;
    enemy.x += 10;
    engine.stampWakes([], 0);
    assert.equal(stamps.length, 0, 'pause adds no moving foam');
    assert.deepEqual(wake.trails.get(enemy.id), previous);
    wake.setCenter(1000, 1000);
    assert.equal(wake.trails.size, 0, 'a new battle cannot reuse the previous fleet paths');
    wake.dispose();
  });

  await check('cinematic camera and approach detection do not follow unseen hulls', () => {
    const battle = new SimBattle(4, 'competitive-v1');
    battle.land = () => -100;
    const own = battle.addShip('panokseon', 0, 0, 0, 'Own', null);
    const enemy = battle.addShip('atakebune', 3000, 800, 0, 'Hidden', null);
    enemy.observed = false; enemy.lastHit = 999; own.targetId = enemy.id;
    const camera = new BattleCamera();
    const rts = new RtsCamera(camera); rts.cinematic = true;
    const host = { battle, team: 'joseon', rts, camera, remote: null, paused: false, fastForward: false, speed: 1, fx: { liftOf: () => 0 } };
    const director = new Director(host);
    director.update(0.1);
    assert.equal(director.shot.ship, own.id);
    assert.equal(rts.goal.tx, own.x); assert.equal(rts.goal.tz, own.z);
    enemy.observed = true; director.shot = null;
    director.update(0.1);
    assert.equal(director.shot.ship, enemy.id);
    enemy.observed = false; enemy.x = 3500; enemy.z = 1400;
    director.update(0.1);
    assert.equal(director.shot.ship, own.id, 'an active shot ends immediately when its subject is lost');
    assert.equal(rts.goal.tx, own.x); assert.equal(rts.goal.tz, own.z);
    const engine = Object.assign(base(), { battle });
    assert.equal(engine.inContact(), false);
    battle.projectiles.push({ team: 'japan', x: 3000, z: 800 });
    assert.equal(engine.inContact(), false, 'a hidden shot cannot end approach fast-forward');
    battle.projectiles[0].x = 100; battle.projectiles[0].z = 0;
    assert.equal(engine.inContact(), true);
  });

  await check('cosmetic rockets stop drawing and landing outside sight without a stale smoke bridge', () => {
    const battle = new SimBattle(4, 'competitive-v1');
    battle.land = () => -100;
    const scout = battle.addShip('hyeopseon', 600, 0, 0, 'Scout', null);
    battle.addShip('panokseon', 5000, 0, 0, 'Reserve', null);
    const layer = { emit() {} };
    const mun = new Munitions(layer, layer, layer, 1);
    let rockets = 0, landings = 0, trails = 0;
    mun.rocket = () => { rockets++; }; mun.launch = () => {};
    mun.onLand = () => { landings++; };
    const shot = { id: 1, x: 800, y: 4, z: 0, vx: -100, vy: 0, vz: 0, team: 'japan', shooter: 0, damage: 0, crewDamage: 0, ammo: 'fire', gun: 'cheonja', fireChance: 0, age: 0, alive: true };
    const visible = (x, z) => pointVisible(battle, 'joseon', x, z);
    const fly = (dt, lay = () => { trails++; }) => mun.fly(dt, 600, 20, 0, 450, lay, visible);
    assert.equal(visible(shot.x, shot.z), true);
    mun.salvo(shot, 2, 10, battle, 'joseon');
    assert.equal(mun.rocketsInFlight, 5);
    scout.alive = false; battle.time += 0.25;
    fly(1); fly(3);
    assert.deepEqual([rockets, trails, landings, mun.rocketsInFlight], [0, 0, 0, 0]);
    scout.alive = true; battle.time += 0.25;
    mun.salvo(shot, 2, 10, battle, 'joseon');
    scout.alive = false; battle.time += 0.25;
    fly(1);
    scout.alive = true; battle.time += 0.25;
    fly(0.01, (trail, x, y, z) => {
      trails++;
      assert.ok(Math.hypot(trail.x - x, trail.y - y, trail.z - z) < 5, 'hidden time updates the trail origin');
    });
    assert.equal(trails, 5);
    fly(3);
    assert.equal(landings, 5, 'observed landings retain their effects');
    const geometries = new Set(), materials = new Set();
    mun.group.traverse((node) => { if (node.geometry) geometries.add(node.geometry); if (node.material) materials.add(node.material); });
    for (const item of [...geometries, ...materials]) item.dispose();
  });

  await check('dispose during init frees partial resources and prevents installation', async () => {
    const warm = defer();
    const loaded = sky('afternoon');
    const terrain = { disposed: 0, dispose() { this.disposed += 1; } };
    const freed = { wake: 0, cloud: 0, renderer: 0 };
    const engine = Object.assign(base(), {
      ready: false, seaName: 'moderate', battleInfo: {}, camera: { updateProjectionMatrix() {} },
      renderer: { shadowMap: {}, dispose: async () => { freed.renderer += 1; } },
      wake: { dispose() { freed.wake += 1; } }, clouds: { dispose() { freed.cloud += 1; } },
      loadAssets(from, task) { task.sky = loaded; task.terrain = terrain; return Promise.resolve([loaded, terrain, {}]); },
      warmShared: () => warm.promise,
      dressTerrain() { assert.fail('disposed init installed terrain'); },
    });
    const loading = engine.init();
    const rejected = assert.rejects(loading, aborted);
    engine.dispose();
    engine.dispose();
    warm.resolve();
    await rejected;
    assert.deepEqual(freed, { wake: 1, cloud: 1, renderer: 1 });
    assert.equal(terrain.disposed, 1);
    assert.equal(loaded.view.disposed, 1);
    assert.equal(engine.ready, false);
  });

  await check('superseded stage cannot install its terrain or restore readiness', async () => {
    const loads = [];
    const installed = [];
    const engine = Object.assign(base(), {
      views: { reset() {} }, sound: { newBattle() {} }, fx: { newBattle() {} },
      rts: { setPose() {} }, oceanQuality: () => ({}), applyLevel() {}, defaultPose: () => ({}),
      disposeBattle() {}, dressTerrain() { installed.push(this.terrain.name); },
      placeScenario() {}, applySky(value) { this.sky = value; }, prewarm: async () => {},
      loadAssets(from, task) { const pending = defer(); loads.push({ ...pending, task }); return pending.promise; },
    });
    const first = engine.setScenario('okpo');
    const rejected = assert.rejects(first, aborted);
    const second = engine.setScenario('hansan');
    const fresh = { name: 'hansan', group: {} };
    loads[1].resolve([sky('afternoon'), fresh, {}]);
    await second;
    loads[0].resolve([sky('sunset'), { name: 'okpo', group: {} }, {}]);
    await rejected;
    assert.deepEqual(installed, ['hansan']);
    assert.equal(engine.scenarioId, 'hansan');
    assert.equal(engine.ready, true);
    assert.equal(loads[0].task.controller.signal.aborted, true);
  });

  await check('asset completion after cancellation releases unadopted terrain and sky', async () => {
    const hdr = defer();
    const terrainLoad = defer();
    globalThis.__renderSky = () => hdr.promise;
    globalThis.__renderTerrain = () => terrainLoad.promise;
    const engine = Object.assign(base(), { battleInfo: { terrain: {} }, skyName: 'afternoon',
      shipOptions: () => ({}), kindsInBattle: () => [], terrainQuality: () => ({}),
    });
    const task = engine.beginLoad();
    const loading = engine.loadAssets(0.04, task);
    const rejected = assert.rejects(loading, aborted);
    engine.cancelLoad(task);
    const late = sky('afternoon');
    const terrain = { disposed: 0, dispose() { this.disposed += 1; } };
    hdr.resolve(late);
    terrainLoad.resolve(terrain);
    await rejected;
    await Promise.resolve();
    assert.equal(late.view.disposed, 1);
    assert.equal(late.environment.disposed, 1);
    assert.equal(terrain.disposed, 1);
  });

  const { loadSky, SKY_PRESETS, lightDirection, Atmosphere, hazeForFog } = await bundle('sky', `
    export { loadSky, SKY_PRESETS, lightDirection } from './src/render/sky.ts';
    export { Atmosphere, hazeForFog } from './src/render/atmosphereModel.ts';`);
  await check('a cancelled sky cannot mutate the textures it would reuse', async () => {
    const controller = new AbortController();
    const viewData = new Uint16Array([123]);
    const environmentData = new Uint16Array([456]);
    const reuse = { view: { image: { data: viewData, width: 128, height: 96 } }, environment: { image: { data: environmentData, width: 256, height: 128 } } };
    const loading = loadSky(SKY_PRESETS.night, 'small', reuse, controller.signal);
    const rejected = assert.rejects(loading, aborted);
    controller.abort();
    await rejected;
    assert.equal(reuse.view.image.data, viewData);
    assert.equal(reuse.environment.image.data, environmentData);
  });

  await check('a new sky is written into the textures of the previous one', async () => {
    const first = await loadSky(SKY_PRESETS.afternoon, 'small');
    const filtered = first.environment.pmremVersion;
    const second = await loadSky(SKY_PRESETS.overcast, 'small', first);
    assert.equal(second.view, first.view);
    assert.equal(second.environment, first.environment);
    assert.ok(second.environment.pmremVersion > filtered, 'the reflections are filtered again');
    for (const name of Object.keys(SKY_PRESETS)) {
      const { info } = await loadSky(SKY_PRESETS[name], 'small', first);
      assert.ok(info.ambientLum > 0 && Number.isFinite(info.ambientLum), `${name} ambient`);
      assert.ok(info.sunIrradiance.x >= 0 && Number.isFinite(info.sunIrradiance.length()), `${name} sun`);
      // The light keeps the bearing the battles were laid out under, so a battle's map turns as it always did.
      assert.ok(info.sunDir.distanceTo(lightDirection(SKY_PRESETS[name])) < 1e-9, `${name} light`);
    }
  });

  await check('the clear sky is bluer overhead than at the horizon, and the low sun reddens', () => {
    const clear = new Atmosphere({ light: [0.6, 0.6, 0.53], haze: hazeForFog(SKY_PRESETS.day.fogDensity) });
    const zenith = clear.radiance(0, 1, 0, [0, 0, 0]);
    const horizon = clear.radiance(-0.75, 0.01, -0.66, [0, 0, 0]);
    assert.ok(zenith[2] / zenith[0] > horizon[2] / horizon[0], 'the haze whitens the horizon');
    const low = new Atmosphere({ light: [0.99, 0.08, 0], haze: hazeForFog(SKY_PRESETS.sunset.fogDensity) }).lightAtSea([0, 0, 0]);
    const high = clear.lightAtSea([0, 0, 0]);
    assert.ok(low[0] / low[2] > high[0] / high[2] * 2, 'a sun near the horizon reaches the sea red');
    const deck = new Atmosphere({ light: [0.6, 0.6, 0.53], haze: 30, direct: 0.1 });
    assert.ok(deck.deck > 0, 'an overcast lights the haze from its underside');
    const glare = (a) => a.radiance(0.6, 0.05, 0.53, [0, 0, 0])[1] / a.radiance(-0.6, 0.05, -0.53, [0, 0, 0])[1];
    assert.ok(glare(deck) - 1 < (glare(new Atmosphere({ light: [0.6, 0.6, 0.53], haze: 30 })) - 1) / 3, 'no sun glare through the deck');
  });

  const { SelectScene, TextureLoader, PerspectiveCamera } = await bundle('select', `
    export { SelectScene } from './src/select/SelectScene.ts';
    export { TextureLoader, PerspectiveCamera } from 'three/webgpu';`);
  await check('selection init cannot register listeners after disposal', async () => {
    const download = defer();
    TextureLoader.prototype.loadAsync = () => download.promise;
    const canvas = events();
    const before = window.count();
    const select = new SelectScene({ domElement: canvas }, new PerspectiveCamera(), 4);
    const loading = select.init('okpo');
    const rejected = assert.rejects(loading, aborted);
    select.dispose();
    const source = texture();
    download.resolve(source);
    await rejected;
    assert.equal(select.ready, false);
    assert.equal(canvas.count(), 0);
    assert.equal(window.count(), before);
    assert.equal(source.disposed, 1);
    select.dispose();
  });

  const terrainModule = await bundle('terrain', `export { Terrain } from './src/terrain/Terrain.ts'; export { TextureLoader } from 'three/webgpu';`);
  const workers = [];
  globalThis.Worker = class {
    constructor() { this.terminated = 0; workers.push(this); }
    postMessage() { queueMicrotask(() => globalThis.__workerFailure ? this.onerror(globalThis.__workerFailure) : this.onmessage({ data: globalThis.__workerMessage ?? { heights: new Float32Array(), mask: new Uint8Array(), structures: [] } })); }
    terminate() { this.terminated += 1; }
  };
  const quality = { texSize: 1024, anisotropy: 1 };
  await check('terrain worker terminates on ground failure and cancellation while ground is pending', async () => {
    const failure = new Error('ground missing');
    terrainModule.TextureLoader.prototype.loadAsync = () => Promise.reject(failure);
    await assert.rejects(terrainModule.Terrain.load({}, quality), (error) => error === failure);
    assert.equal(workers[0].terminated, 1);
    const pending = defer();
    terrainModule.TextureLoader.prototype.loadAsync = () => pending.promise;
    const controller = new AbortController();
    const loading = terrainModule.Terrain.load({}, quality, controller.signal);
    const rejected = assert.rejects(loading, aborted);
    await Promise.resolve();
    controller.abort();
    await rejected;
    assert.equal(workers[1].terminated, 1);
    pending.resolve(texture());
    const workerFailure = new Error('terrain worker failed');
    globalThis.__workerFailure = workerFailure;
    await assert.rejects(terrainModule.Terrain.load({}, quality), (error) => error === workerFailure);
    assert.equal(workers[2].terminated, 1);
    globalThis.__workerFailure = null;
    // A region whose elevation window cannot be fetched reports it by message, since an async worker has no onerror for it.
    globalThis.__workerMessage = { error: 'region ground yeosu: 404' };
    await assert.rejects(terrainModule.Terrain.load({}, quality), /region ground yeosu: 404/);
    assert.equal(workers[3].terminated, 1);
    globalThis.__workerMessage = null;
  });
  const ships = await bundle('ship-capacity', `
    export { ShipRenderer, modelKey } from './src/ships/ShipRenderer.ts';
    export { ShipViews } from './src/ships/ShipViews.ts';
    export { Battle } from './src/sim/battle.ts';
    export { BoxGeometry, Box3, MeshStandardMaterial, Texture, Matrix4, Vector3, PerspectiveCamera } from 'three/webgpu';`);
  const model = () => {
    const geometry = new ships.BoxGeometry(20, 6, 10);
    const source = new ships.MeshStandardMaterial({ map: new ships.Texture() });
    const key = ships.modelKey('kobaya', 0);
    return { key, geometry, source, assets: { [key]: { key, kind: 'kobaya', variant: 0, bounds: new ships.Box3(), lods: [{ geometry, source }, { geometry, source }] } } };
  };
  const gpu = () => {
    const deleted = [];
    return { deleted, _attributes: { get: () => ({}), delete(attribute) { deleted.push(attribute); } } };
  };
  await check('ship batches grow during a frame without losing submitted poses or shared models', () => {
    const { key, geometry, source, assets } = model();
    let geometryDisposals = 0, textureDisposals = 0, sourceDisposals = 0;
    geometry.addEventListener('dispose', () => geometryDisposals++);
    source.map.addEventListener('dispose', () => textureDisposals++);
    source.addEventListener('dispose', () => sourceDisposals++);
    const renderer = new ships.ShipRenderer(assets, new Map([[key, 2]]));
    const old = renderer.batches.get(key)[0];
    const owner = gpu();
    old.mesh.onAfterRender(owner);
    let materialDisposals = 0, meshDisposals = 0;
    old.mesh.material.addEventListener('dispose', () => materialDisposals++);
    old.mesh.addEventListener('dispose', () => meshDisposals++);
    const pose = (n) => new ships.Matrix4().makeTranslation(n * 10, n, -n);
    const submit = (n) => renderer.add(key, 0, pose(n), new ships.Vector3(n, n + 1, n + 2), new ships.Vector3(0, 1, 0), n / 10, n / 20);
    renderer.begin(); submit(1); submit(2); submit(3); renderer.end();
    const next = renderer.batches.get(key)[0];
    assert.notEqual(next.mesh, old.mesh);
    assert.equal(next.mesh.geometry, geometry);
    assert.equal(next.count, 3); assert.equal(next.mesh.count, 3);
    assert.ok(next.mesh.instanceMatrix.count >= 3);
    for (let n = 1; n <= 3; n++) {
      const actual = new ships.Matrix4(); next.mesh.getMatrixAt(n - 1, actual);
      assert.deepEqual(actual.elements, pose(n).elements);
      assert.deepEqual([...next.a.array.slice((n - 1) * 4, (n - 1) * 4 + 3)], [n, n + 1, n + 2]);
      assert.ok(Math.abs(next.a.array[(n - 1) * 4 + 3] - n / 10) < 1e-6);
      assert.ok(Math.abs(next.b.array[(n - 1) * 4 + 3] - n / 20) < 1e-6);
    }
    assert.deepEqual(owner.deleted, [old.mesh.instanceMatrix, old.a, old.b]);
    assert.equal(materialDisposals, 1); assert.equal(meshDisposals, 1);
    next.mesh.onAfterRender(owner);
    renderer.dispose(); renderer.dispose();
    assert.equal(owner.deleted.length, 6, 'each uploaded owned attribute is released once');
    assert.equal(materialDisposals, 1); assert.equal(meshDisposals, 1);
    assert.equal(geometryDisposals + textureDisposals + sourceDisposals, 0);
  });
  await check('selection rings grow past 256, preserve poses and release only the retired matrix', () => {
    const { assets } = model();
    const views = new ships.ShipViews(assets, new ships.Battle(1), { maxLod0: 1, near: 500, mid: 1900, skipLod0: false, baseColorOnly: true });
    const old = views.ringsOwn, owner = gpu();
    old.onAfterRender(owner);
    let meshDisposals = 0, materialDisposals = 0, geometryDisposals = 0;
    old.addEventListener('dispose', () => meshDisposals++);
    old.material.addEventListener('dispose', () => materialDisposals++);
    old.geometry.addEventListener('dispose', () => geometryDisposals++);
    const pose = new ships.Matrix4().makeTranslation(17, 3, 41);
    old.setMatrixAt(0, pose); old.count = 1;
    views.ensureRings(300, 0);
    const next = views.ringsOwn, actual = new ships.Matrix4(); next.getMatrixAt(0, actual);
    assert.notEqual(next, old); assert.ok(next.instanceMatrix.count >= 300);
    assert.deepEqual(actual.elements, pose.elements);
    assert.equal(next.count, 1); assert.equal(next.geometry, old.geometry); assert.equal(next.material, old.material);
    assert.equal(views.ringsEnemy.instanceMatrix.count, 256);
    assert.deepEqual(owner.deleted, [old.instanceMatrix]);
    assert.equal(meshDisposals, 1); assert.equal(materialDisposals + geometryDisposals, 0);
    next.onAfterRender(owner);
    next.material.dispose(); views.releaseRing(next);
    assert.deepEqual(owner.deleted, [old.instanceMatrix, next.instanceMatrix]);
    assert.equal(meshDisposals, 1); assert.equal(materialDisposals, 1); assert.equal(geometryDisposals, 0);
    views.renderer.dispose();
  });
  await check('real ship view sync draws 300 same-kind ships and all 300 selection rings', () => {
    const { key, assets } = model();
    const battle = new ships.Battle(1592, 'competitive-v1');
    const squadron = battle.addSquadron('joseon', 'Own', '', '', '', 0);
    const first = battle.addShip('kobaya', 0, 0, 0, 'Ship 0', squadron);
    const views = new ships.ShipViews(assets, battle, { maxLod0: 1, near: 500, mid: 1900, skipLod0: false, baseColorOnly: true });
    for (let i = 1; i < 300; i++) battle.addShip('kobaya', (i % 20 - 10) * 35, (Math.floor(i / 20) - 7) * 35, 0, `Ship ${i}`, squadron);
    views.selected = new Set(battle.ships.map((s) => s.id));
    views.selected.add(first.id);
    const camera = new ships.PerspectiveCamera(60, 16 / 9, 1, 10000);
    camera.position.set(0, 1500, 1500); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    views.sync(battle, 1 / 30, camera, assets);
    assert.equal(views.renderer.stats()[key].reduce((n, count) => n + count, 0), 300);
    assert.equal(views.ringsOwn.count, 300);
    assert.ok(views.ringsOwn.instanceMatrix.count >= 300);
    assert.equal(views.states.size, 300);
    views.renderer.dispose();
  });
  console.log(`render: ${passed} regressions passed (CPU lifecycle/frame fixtures; no GPU)`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
