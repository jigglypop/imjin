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
const sky = (name) => ({ name, background: texture(), environment: texture(), info: {} });
const aborted = (error) => error?.name === 'AbortError';
let passed = 0;
async function check(name, test) {
  await test();
  passed += 1;
  console.log(`ok - ${name}`);
}

try {
  const { Engine, RtsCamera, Input, PerspectiveCamera: BattleCamera } = await bundle('engine', `
    export { Engine } from './src/game/Engine.ts';
    export { RtsCamera } from './src/camera/RtsCamera.ts';
    export { Input } from './src/game/Input.ts';
    export { PerspectiveCamera } from 'three/webgpu';`, {
    'render/sky.ts': `export const SKY_PRESETS = Object.fromEntries(['afternoon','day','sunset','overcast','night'].map(name => [name,{name,night:0}]));
      export const loadSky = (...args) => globalThis.__renderSky(...args);`,
    'terrain/Terrain.ts': 'export class Terrain { static load(...args) { return globalThis.__renderTerrain(...args); } }',
    'ocean/Ocean.ts': 'export class Ocean { mesh = {}; dispose() {} }',
    'fx/Crew.ts': 'export const crewAssets = () => Promise.resolve(new Map()); export class Crew { group = {}; dispose() {} }',
    'terrain/Structures.ts': 'export const preloadStructures = () => Promise.resolve(); export class Structures {}',
    'conquest/ConquestView.ts': 'export const preloadWorks = () => Promise.resolve(); export class ConquestView {}',
    'ships/ShipRenderer.ts': 'export const CUT_CAP = 1, LOD_COUNT = 3; export const modelKey = (kind) => kind; export class ShipRenderer {} export const loadShipAssets = () => Promise.resolve({}); export const releaseShipAssets = () => Promise.resolve();',
  });
  const base = () => Object.assign(Object.create(Engine.prototype), {
    disposed: false, ready: true, loading: null, skyLoading: null, sky: null, eq: { hdriSize: '2k' },
    conquestSetup: null, faction: 'joseon', scene: { add() {} }, options: {}, minimap: {},
    rts: { detach() {} }, camera: { position: { x: 0, y: 0, z: 0 } }, renderer: { dispose: () => Promise.resolve() },
    wake: { dispose() {} }, publish() {},
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
    assert.equal(stale.background.disposed, 1);
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
    assert.equal(loaded.background.disposed, 1);
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
    assert.equal(late.background.disposed, 1);
    assert.equal(late.environment.disposed, 1);
    assert.equal(terrain.disposed, 1);
  });

  const { loadSky, SKY_PRESETS } = await bundle('sky', "export { loadSky, SKY_PRESETS } from './src/render/sky.ts';", {
    'HDRLoader.js': 'export class HDRLoader { setDataType() {} loadAsync() { return globalThis.__hdrDownload; } }',
  });
  await check('cancelled HDR cannot mutate reused textures and releases its source', async () => {
    const download = defer();
    globalThis.__hdrDownload = download.promise;
    const controller = new AbortController();
    const backgroundImage = { width: 4, height: 2 };
    const environmentData = new Uint16Array([123]);
    const reuse = { background: { image: backgroundImage }, environment: { image: { data: environmentData } } };
    const loading = loadSky(SKY_PRESETS.night, '2k', reuse, controller.signal);
    const rejected = assert.rejects(loading, aborted);
    controller.abort();
    const source = texture();
    source.image = { width: 4, height: 2, data: new Uint16Array(32) };
    download.resolve(source);
    await rejected;
    assert.equal(reuse.background.image, backgroundImage);
    assert.equal(reuse.environment.image.data, environmentData);
    assert.equal(source.disposed, 1);
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
    postMessage() { queueMicrotask(() => globalThis.__workerFailure ? this.onerror(globalThis.__workerFailure) : this.onmessage({ data: { heights: new Float32Array(), mask: new Uint8Array(), structures: [] } })); }
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
  });
  console.log(`render: ${passed} regressions passed (CPU lifecycle/frame fixtures; no GPU)`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
