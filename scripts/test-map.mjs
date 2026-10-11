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
globalThis.requestAnimationFrame = (fn) => { frames.set(++rafId, fn); return rafId; };
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
const draw = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(0)); };
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
    stdin: { contents: `export { MapScene } from './src/ui/grand/MapScene.ts'; export * from './src/ui/grand/mapMath.ts'; export { MAP_ASPECT, project } from './src/ui/grand/projection.ts'; export { siteUV, SITES } from './src/ui/siteMap.ts'; export { MAP_W, MAP_H, V_SCALE } from './src/select/demFrame.ts'; export { Vector3, OrthographicCamera } from 'three';`, resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'no-gpu', setup(api) {
      api.onResolve({ filter: /^three\/webgpu$/ }, () => ({ path: 'map-three', namespace: 'map-fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'map-fixture' }, () => ({ contents: `export * from 'three'; export const WebGPURenderer = globalThis.__MapRenderer;`, resolveDir: root }));
      api.onLoad({ filter: /[\\/]game[\\/]quality\.ts$/ }, () => ({ contents: 'export const equipment={select:{antialias:false,mapSegments:8},tier:"low"}; export const forceWebGL=true;', loader: 'ts' }));
      api.onLoad({ filter: /[\\/]game[\\/]device\.ts$/ }, () => ({ contents: 'export const isPhone=false; export const isTouchOnly=false;', loader: 'ts' }));
      api.onLoad({ filter: /[\\/]ui[\\/]launch\.ts$/ }, () => ({ contents: 'export const params=new URLSearchParams("");', loader: 'ts' }));
      api.onLoad({ filter: /[\\/]render[\\/]webglBackend\.ts$/ }, () => ({ contents: 'export const tuneWebGLBackend=()=>{};', loader: 'ts' }));
      // The terrain material is TSL; the lifecycle is what is tested here, with a plain mesh standing in.
      api.onLoad({ filter: /[\\/]select[\\/]terrain\.ts$/ }, () => ({ contents: `import { Mesh, PlaneGeometry, MeshBasicMaterial } from 'three'; export const loadDem = (signal) => globalThis.__loadDem(signal); export const buildTerrain = () => new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());`, loader: 'ts' }));
    } }],
  });
  const path = join(temporary, 'actual-map.mjs'); await writeFile(path, bundled.outputFiles[0].contents);
  const { MapScene, DEM_RECT, MESH_SCALE, MAP_TILT, groundElevation, mapProject, mapFrustum, MAP_ASPECT, project, siteUV, SITES, MAP_W, MAP_H, V_SCALE, Vector3, OrthographicCamera } = await import(pathToFileURL(path).href);
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
  await check('DOM marker projection matches actual orthographic camera at arbitrary pan, zoom, tilt and yaw', () => {
    for (const tilt of [0, MAP_TILT, 1.1]) for (const yaw of [-0.7, 0, 0.5]) {
      const pose = { tilt, yaw }, view = { s: 2380, x: -950, y: -135 }, width = 1920, height = 1080;
      const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 8);
      Object.assign(camera, mapFrustum(view, width, height));
      camera.up.set(0, 0, -1); camera.position.set(0, Math.cos(tilt) * 2, Math.sin(tilt) * 2); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      for (const [u, v, elevation] of [[0.2, 0.3, 0], [0.8, 0.1, 0.07], [0.5, 0.7, 0.02]]) {
        const p = new Vector3(u - 0.5, elevation, (v - 0.5) / MAP_ASPECT).applyAxisAngle(new Vector3(0, 1, 0), yaw).project(camera);
        const html = mapProject(u, v, elevation, pose);
        assert.ok(Math.abs((p.x + 1) * width / 2 - (view.x + html.u * view.s)) < 1e-6);
        assert.ok(Math.abs((1 - p.y) * height / 2 - (view.y + html.v * view.s / MAP_ASPECT)) < 1e-6);
      }
    }
  });
  await check('a terrain point of the real scene projects where its marker is drawn', async () => {
    const scene = new MapScene({}); const grid = await scene.init();
    const pose = { tilt: MAP_TILT, yaw: 0.3 }, view = { s: 2600, x: -700, y: -150 }, width = 1600, height = 900;
    scene.update(view, pose, width, height); draw();
    for (const id of ['hansan', 'myeongnyang', 'busan']) {
      const local = siteUV(id), frame = project(SITES[id].lon, SITES[id].lat);
      const ground = Math.max(0, grid[Math.round(local.v * 1038) * 2048 + Math.round(local.u * 2047)]);
      // The point in the mesh's own units, then through the group's and scene's transforms and the real camera.
      const world = new Vector3((local.u - 0.5) * MAP_W, ground * V_SCALE, (local.v - 0.5) * MAP_H);
      const p = scene.scene.children[0].localToWorld(world).project(scene.camera);
      const html = mapProject(frame.u, frame.v, groundElevation(grid, frame.u, frame.v), pose);
      assert.ok(Math.abs((p.x + 1) * width / 2 - (view.x + html.u * view.s)) < 0.5, id);
      assert.ok(Math.abs((1 - p.y) * height / 2 - (view.y + html.v * view.s / MAP_ASPECT)) < 0.5, id);
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
  await check('terrain renders only on change and frees owned geometry, material, texture and renderer once', async () => {
    const before = releases, texBefore = textureFrees, scene = new MapScene({}); await scene.init();
    const mesh = scene.scene.children[0].children[0];
    let geometries = 0, materials = 0;
    mesh.geometry.addEventListener('dispose', () => geometries++); mesh.material.addEventListener('dispose', () => materials++);
    const beforeDraws = renders; scene.update({ s: 2200, x: -600, y: -200 }, { tilt: 0.7, yaw: 0.4 }, 1920, 1080);
    scene.update({ s: 2200, x: -500, y: -200 }, { tilt: 0.7, yaw: 0.4 }, 1920, 1080);
    assert.equal(frames.size, 1); draw(); assert.equal(renders, beforeDraws + 1); draw(); assert.equal(renders, beforeDraws + 1);
    scene.update({ s: 2200, x: -550, y: -200 }, { tilt: 0.7, yaw: 0.4 }, 1920, 1080);
    scene.dispose(); scene.dispose(); draw();
    assert.equal(geometries, 1); assert.equal(materials, 1); assert.equal(textureFrees, texBefore + 1); assert.equal(releases, before + 1); assert.equal(frames.size, 0);
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
