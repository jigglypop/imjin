// Actual relief geometry/projection and asynchronous ownership regressions. No GPU is created.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'imjin-map-'));
const binary = await readFile(join(root, 'public/ui/grand_relief.bin'));
const arrayBuffer = () => binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
const defer = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
let initGate = null, renders = 0, releases = 0, fetches = 0, rafId = 0;
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
globalThis.fetch = async () => { fetches++; return { ok: true, arrayBuffer: async () => arrayBuffer() }; };
let passed = 0;
async function check(name, test) { await test(); passed++; console.log(`ok - ${name}`); }
try {
  const bundled = await build({
    stdin: { contents: `export { ReliefScene } from './src/ui/grand/ReliefScene.ts'; export * from './src/ui/grand/reliefMath.ts'; export { MAP_ASPECT } from './src/ui/grand/projection.ts'; export { Vector3, OrthographicCamera } from 'three';`, resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'no-gpu', setup(api) {
      api.onResolve({ filter: /^three\/webgpu$/ }, () => ({ path: 'map-three', namespace: 'map-fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'map-fixture' }, () => ({ contents: `export * from 'three'; export { MeshStandardMaterial as MeshStandardNodeMaterial } from 'three'; export const WebGPURenderer = globalThis.__MapRenderer;`, resolveDir: root }));
      api.onLoad({ filter: /[\\/]game[\\/]quality\.ts$/ }, () => ({ contents: 'export const equipment={select:{antialias:false},tier:"low"}; export const forceWebGL=true;', loader: 'ts' }));
      api.onLoad({ filter: /[\\/]render[\\/]webglBackend\.ts$/ }, () => ({ contents: 'export const tuneWebGLBackend=()=>{};', loader: 'ts' }));
    } }],
  });
  const path = join(temporary, 'actual-map.mjs'); await writeFile(path, bundled.outputFiles[0].contents);
  const { ReliefScene, decodeRelief, reliefHeight, reliefProject, reliefFrustum, RELIEF_META, RELIEF_EXAGGERATION, MAP_ASPECT, Vector3, OrthographicCamera } = await import(pathToFileURL(path).href);
  await check('committed real DEM decodes at the recorded resolution and peak', () => {
    const heights = decodeRelief(arrayBuffer());
    assert.equal(heights.length, RELIEF_META.width * RELIEF_META.height);
    assert.equal(Math.max(...heights), RELIEF_META.maxHeight);
    assert.equal(heights.filter((h) => h > 2).length, RELIEF_META.landVertices);
    assert.throws(() => decodeRelief(new ArrayBuffer(6)), /Invalid relief/);
    assert.equal(reliefHeight(heights, -0.1, 0.5), 0);
  });
  await check('DOM marker projection matches actual orthographic camera at arbitrary pan, zoom, tilt and yaw', () => {
    for (const tilt of [0, Math.PI / 4, 1.1]) for (const yaw of [-0.7, 0, 0.5]) {
      const pose = { tilt, yaw }, view = { s: 2380, x: -950, y: -135 }, width = 1920, height = 1080;
      const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 8);
      Object.assign(camera, reliefFrustum(view, width, height));
      camera.up.set(0, 0, -1); camera.position.set(0, Math.cos(tilt) * 2, Math.sin(tilt) * 2); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      for (const [u, v, elevation] of [[0.2, 0.3, 0], [0.8, 0.1, 0.07], [0.5, 0.7, 0.02]]) {
        const p = new Vector3(u - 0.5, elevation, (v - 0.5) / MAP_ASPECT).applyAxisAngle(new Vector3(0, 1, 0), yaw).project(camera);
        const html = reliefProject(u, v, elevation, pose);
        assert.ok(Math.abs((p.x + 1) * width / 2 - (view.x + html.u * view.s)) < 1e-6);
        assert.ok(Math.abs((1 - p.y) * height / 2 - (view.y + html.v * view.s / MAP_ASPECT)) < 1e-6);
      }
    }
  });
  await check('dispose while renderer initializes never adopts terrain and releases renderer once after init', async () => {
    initGate = defer(); const before = releases, beforeFetches = fetches;
    const scene = new ReliefScene({}); const initializing = scene.init(); scene.dispose(); scene.dispose();
    assert.equal(releases, before); initGate.resolve();
    await assert.rejects(initializing, (error) => error.name === 'AbortError'); initGate = null;
    assert.equal(releases, before + 1); assert.equal(fetches, beforeFetches); assert.equal(scene.heights, null);
  });
  await check('real elevated mesh renders only on change and frees owned geometry/material/renderer once', async () => {
    const before = releases, scene = new ReliefScene({}); const heights = await scene.init();
    const mesh = scene.scene.children.find((child) => child.isMesh);
    assert.equal(mesh.geometry.getAttribute('position').count, heights.length);
    assert.equal(mesh.geometry.index.count, (RELIEF_META.width - 1) * (RELIEF_META.height - 1) * 6);
    const vertices = mesh.geometry.getAttribute('position'); const peakIndex = heights.indexOf(RELIEF_META.maxHeight);
    assert.ok(Math.abs(vertices.getY(peakIndex) - RELIEF_META.maxHeight * RELIEF_EXAGGERATION / RELIEF_META.metersAcross) < 1e-8);
    let geometries = 0, materials = 0;
    mesh.geometry.addEventListener('dispose', () => geometries++); mesh.material.addEventListener('dispose', () => materials++);
    const beforeDraws = renders; scene.update({ s: 2200, x: -600, y: -200 }, { tilt: 0.7, yaw: 0.4 }, 1920, 1080);
    scene.update({ s: 2200, x: -500, y: -200 }, { tilt: 0.7, yaw: 0.4 }, 1920, 1080);
    assert.equal(frames.size, 1); draw(); assert.equal(renders, beforeDraws + 1); draw(); assert.equal(renders, beforeDraws + 1);
    scene.update({ s: 2200, x: -550, y: -200 }, { tilt: 0.7, yaw: 0.4 }, 1920, 1080);
    scene.dispose(); scene.dispose(); draw();
    assert.equal(geometries, 1); assert.equal(materials, 1); assert.equal(releases, before + 1); assert.equal(frames.size, 0);
  });
  await check('late height body after disposal is discarded before mesh construction', async () => {
    const body = defer(); const before = releases;
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: () => body.promise });
    const scene = new ReliefScene({}); const initializing = scene.init();
    await Promise.resolve(); await Promise.resolve(); scene.dispose(); body.resolve(arrayBuffer());
    await assert.rejects(initializing, (error) => error.name === 'AbortError');
    assert.equal(scene.heights, null); assert.equal(scene.scene.children.filter((child) => child.isMesh).length, 0); assert.equal(releases, before + 1);
  });
  console.log(`${passed} map regressions passed`);
} finally {
  // mkdtemp gives this test its own directory; no workspace files are removed.
  await rm(temporary, { recursive: true, force: true });
}
