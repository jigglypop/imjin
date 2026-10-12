// The campaign map reuses the select screen's terrain: placement, projection and scene-lifecycle regressions. No GPU is created.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import sharp from 'sharp';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'imjin-map-'));
const defer = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
let initGate = null, renders = 0, releases = 0, rafId = 0, textureFrees = 0, demLoads = 0;
const frames = new Map();
globalThis.window = { devicePixelRatio: 1 };
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
globalThis.requestAnimationFrame = (fn) => { frames.set(++rafId, fn); return rafId; };
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
const draw = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(0)); };
// The scene draws on a steady timer (about thirty frames a second): wait past one frame for it to show a change.
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 60));
globalThis.__MapRenderer = class {
  init() { return initGate?.promise ?? Promise.resolve(); }
  setPixelRatio() {}
  setSize() {}
  render(scene, camera) { camera.updateMatrixWorld(); scene.updateMatrixWorld(); renders++; }
  dispose() { releases++; return Promise.resolve(); }
};
// The real DEM, decoded the way terrain.ts decodes it.
const { data, info } = await sharp(join(root, 'public/ui/korea_dem.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const heights = new Float32Array(info.width * info.height);
for (let i = 0; i < heights.length; i++) heights[i] = data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768;
let demGate = null;
globalThis.__loadDem = async (signal) => { demLoads++; await demGate?.promise; signal.throwIfAborted(); return { heights, tex: { dispose: () => { textureFrees++; } } }; };
let passed = 0;
async function check(name, test) { await test(); passed++; console.log(`ok - ${name}`); }
try {
  const bundled = await build({
    stdin: { contents: `export { MapScene } from './src/ui/grand/MapScene.ts'; export * from './src/ui/grand/mapMath.ts'; export * from './src/ui/grand/worldCamera.ts'; export { MAP_ASPECT, project } from './src/ui/grand/projection.ts'; export { siteUV, SITES } from './src/ui/siteMap.ts'; export { MAP_W, MAP_H, V_SCALE } from './src/select/demFrame.ts'; export { Vector3, PerspectiveCamera } from 'three';`, resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'no-gpu', setup(api) {
      api.onResolve({ filter: /^three\/webgpu$/ }, () => ({ path: 'map-three', namespace: 'map-fixture' }));
      api.onResolve({ filter: /^three\/tsl$/ }, () => ({ path: 'map-tsl', namespace: 'map-fixture' }));
      api.onLoad({ filter: /^map-three$/, namespace: 'map-fixture' }, () => ({ contents: `export * from 'three'; import { MeshBasicMaterial } from 'three'; export const MeshBasicNodeMaterial = MeshBasicMaterial; export const WebGPURenderer = globalThis.__MapRenderer;`, resolveDir: root }));
      api.onLoad({ filter: /^map-tsl$/, namespace: 'map-fixture' }, () => ({ contents: `const any = () => new Proxy(function () {}, { get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : any()), apply: () => any() }); export const abs = any(), attribute = any(), float = any(), mix = any(), mx_noise_float = any(), positionLocal = any(), positionWorld = any(), smoothstep = any(), uniform = any(), uv = any(), vec3 = any();` }));
      api.onLoad({ filter: /[\\/]game[\\/]quality\.ts$/ }, () => ({ contents: 'export const equipment={select:{antialias:false,mapSegments:8},tier:"low"}; export const forceWebGL=true;', loader: 'ts' }));
      api.onLoad({ filter: /[\\/]game[\\/]device\.ts$/ }, () => ({ contents: 'export const isPhone=false; export const isTouchOnly=false;', loader: 'ts' }));
      api.onLoad({ filter: /[\\/]ui[\\/]launch\.ts$/ }, () => ({ contents: 'export const params=new URLSearchParams("");', loader: 'ts' }));
      api.onLoad({ filter: /[\\/]render[\\/]webglBackend\.ts$/ }, () => ({ contents: 'export const tuneWebGLBackend=()=>{};', loader: 'ts' }));
      // The terrain material is TSL; the lifecycle is what is tested here, with a plain mesh standing in.
      api.onLoad({ filter: /[\\/]select[\\/]terrain\.ts$/ }, () => ({ contents: `import { Mesh, PlaneGeometry, MeshBasicMaterial } from 'three'; export const loadDem = (signal) => globalThis.__loadDem(signal); export const buildTerrain = () => new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial()); export const buildSea = () => new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial()); export const worldClock = { value: 0 }; export const buildFarLandMaterial = () => new MeshBasicMaterial();`, loader: 'ts' }));
    } }],
  });
  const path = join(temporary, 'actual-map.mjs'); await writeFile(path, bundled.outputFiles[0].contents);
  const { MapScene, DEM_RECT, MESH_SCALE, groundElevation, MAP_ASPECT, project, siteUV, SITES, MAP_W, MAP_H, V_SCALE, Vector3, PerspectiveCamera, eyeOf, projectFrame, screenFrame, worldX, worldZ, FOV, NEAR, FAR } = await import(pathToFileURL(path).href);
  /** The perspective camera MapScene draws with, for a camera state and screen: what the overlay's maths must agree with. */
  const sceneCamera = (cam, screen) => {
    const camera = new PerspectiveCamera((FOV * 180) / Math.PI, screen.w / screen.h, NEAR, FAR);
    const eye = eyeOf(cam);
    camera.position.set(eye[0], eye[1], eye[2]); camera.lookAt(worldX(cam.u), 0, worldZ(cam.v));
    camera.setViewOffset(screen.w, screen.h, screen.w / 2 - screen.cx, screen.h / 2 - screen.cy, screen.w, screen.h);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    return camera;
  };
  await check('every historical site lands on the same spot of the DEM as on the select screen', () => {
    assert.ok(DEM_RECT.u >= 0 && DEM_RECT.v >= 0 && DEM_RECT.u + DEM_RECT.w <= 1 && DEM_RECT.v + DEM_RECT.h <= 1);
    for (const [id, site] of Object.entries(SITES)) {
      const local = siteUV(id), frame = project(site.lon, site.lat);
      assert.ok(Math.abs(DEM_RECT.u + local.u * DEM_RECT.w - frame.u) < 1e-9, id);
      assert.ok(Math.abs(DEM_RECT.v + local.v * DEM_RECT.h - frame.v) < 1e-9, id);
    }
  });
  await check('ground elevation reads the real DEM and is flat outside it', () => {
    assert.equal(groundElevation(heights, DEM_RECT.u - 0.01, DEM_RECT.v + 0.1), 0);
    let best = 0;
    for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) best = Math.max(best, groundElevation(heights, DEM_RECT.u + DEM_RECT.w * i / 39, DEM_RECT.v + DEM_RECT.h * j / 39));
    assert.ok(best > 100 * V_SCALE * MESH_SCALE);
  });
  await check('DOM marker projection matches the actual perspective camera at arbitrary place, distance, pitch, yaw and panel insets', () => {
    for (const pitch of [0.25, 0.78, 1.4]) for (const yaw of [-2.4, 0, 0.5, 3]) for (const distance of [0.04, 0.5, 1.2]) {
      const cam = { u: 0.47, v: 0.42, distance, yaw, pitch };
      const screen = screenFrame(1920, 1080, { top: 70, right: 380, bottom: 0, left: 20 });
      const camera = sceneCamera(cam, screen);
      for (const [u, v, elevation] of [[0.47, 0.42, 0], [0.5, 0.45, 0.003], [0.44, 0.4, 0.001], [0.52, 0.38, 0]]) {
        const p = new Vector3(worldX(u), elevation, worldZ(v)).project(camera);
        const html = projectFrame(cam, screen, u, v, elevation);
        if (p.z > 1 || html.depth <= 0) continue;
        assert.ok(Math.abs((p.x + 1) * 1920 / 2 - html.x) < 1e-3, `x at pitch ${pitch} yaw ${yaw} distance ${distance}`);
        assert.ok(Math.abs((1 - p.y) * 1080 / 2 - html.y) < 1e-3, `y at pitch ${pitch} yaw ${yaw} distance ${distance}`);
      }
    }
  });
  await check('a terrain point of the real scene projects where its marker is drawn', async () => {
    const scene = new MapScene({}); const grid = await scene.init();
    const cam = { u: 0.55, v: 0.45, distance: 0.45, yaw: 0.3, pitch: 0.78 }, screen = screenFrame(1600, 900, { top: 0, right: 0, bottom: 0, left: 0 });
    scene.update(cam, screen); await nextFrame();
    for (const id of ['hansan', 'myeongnyang', 'busan']) {
      const local = siteUV(id), frame = project(SITES[id].lon, SITES[id].lat);
      const ground = Math.max(0, grid[Math.round(local.v * 1038) * 2048 + Math.round(local.u * 2047)]);
      // The point in the mesh's own units, then through the group's and scene's transforms and the real camera.
      const world = new Vector3((local.u - 0.5) * MAP_W, ground * V_SCALE, (local.v - 0.5) * MAP_H);
      const p = scene.scene.children[0].localToWorld(world).project(scene.camera);
      const html = projectFrame(cam, screen, frame.u, frame.v, groundElevation(grid, frame.u, frame.v));
      assert.ok(Math.abs((p.x + 1) * 1600 / 2 - html.x) < 0.5, id);
      assert.ok(Math.abs((1 - p.y) * 900 / 2 - html.y) < 0.5, id);
    }
    scene.dispose();
  });
  await check('dispose while renderer initializes never adopts terrain and releases renderer once after init', async () => {
    initGate = defer(); const before = releases, beforeLoads = demLoads;
    const scene = new MapScene({}); const initializing = scene.init(); scene.dispose(); scene.dispose();
    assert.equal(releases, before); initGate.resolve();
    await assert.rejects(initializing, (error) => error.name === 'AbortError'); initGate = null;
    assert.equal(releases, before + 1); assert.equal(demLoads, beforeLoads); assert.equal(scene.scene.children.length, 0);
  });
  await check('terrain keeps drawing while visible and frees owned geometry, material, texture and renderer once on dispose', async () => {
    const before = releases, texBefore = textureFrees, scene = new MapScene({}); await scene.init();
    const mesh = scene.scene.children[0].children[0];
    let geometries = 0, materials = 0;
    mesh.geometry.addEventListener('dispose', () => geometries++); mesh.material.addEventListener('dispose', () => materials++);
    const screen = screenFrame(1920, 1080, { top: 0, right: 0, bottom: 0, left: 0 });
    const beforeDraws = renders;
    scene.update({ u: 0.5, v: 0.4, distance: 0.5, yaw: 0.4, pitch: 0.7 }, screen);
    await nextFrame();
    assert.ok(renders > beforeDraws, 'the world draws while it is on screen');
    scene.update({ u: 0.51, v: 0.4, distance: 0.5, yaw: 0.4, pitch: 0.7 }, screen);
    await nextFrame();
    const beforeDispose = renders;
    scene.dispose(); scene.dispose();
    await nextFrame();
    assert.equal(renders, beforeDispose, 'nothing draws after dispose');
    assert.ok(geometries >= 1 && materials >= 1); assert.equal(textureFrees, texBefore + 1); assert.equal(releases, before + 1);
  });
  await check('a DEM that arrives after disposal is discarded before the terrain is built', async () => {
    demGate = defer(); const before = releases;
    const scene = new MapScene({}); const initializing = scene.init();
    await new Promise((resolve) => setImmediate(resolve)); scene.dispose(); demGate.resolve(); demGate = null;
    await assert.rejects(initializing, (error) => error.name === 'AbortError');
    assert.equal(scene.scene.children.length, 0); assert.equal(releases, before + 1);
  });
  console.log(`${passed} map regressions passed`);
} finally {
  // mkdtemp gives this test its own directory; no workspace files are removed.
  await rm(temporary, { recursive: true, force: true });
}
