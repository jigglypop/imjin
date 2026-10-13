// The campaign map stands on the select screen's DEM: placement, projection and world-lifecycle regressions. No GPU is created.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import sharp from 'sharp';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'imjin-map-'));
const defer = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
let textureFrees = 0, demLoads = 0;
globalThis.window = { devicePixelRatio: 1 };
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
// The real DEM, decoded the way terrain.ts decodes it.
const { data, info } = await sharp(join(root, 'public/ui/korea_dem.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const heights = new Float32Array(info.width * info.height);
for (let i = 0; i < heights.length; i++) heights[i] = data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768;
// `lateAbort` stands for a DEM decoded in the moment the world was disposed: loadDem hands its texture over anyway.
let demGate = null, lateAbort = false;
globalThis.__loadDem = async (signal) => { demLoads++; await demGate?.promise; if (!lateAbort) signal.throwIfAborted(); return { heights: heights.slice(), tex: { dispose: () => { textureFrees++; } } }; };
// The land's asset (public/ui/grand_terrain.bin) is read from disk as the page would fetch it.
globalThis.fetch = async (url, { signal } = {}) => {
  signal?.throwIfAborted();
  const bytes = await readFile(join(root, 'public', String(url)));
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
// Every TSL name, each a node that accepts any use: the ground's materials are built but never compiled here. The names
// come from esbuild's view of the module, so three.js is not loaded a second time beside the bundle's own copy.
const tslExports = await build({ stdin: { contents: `export * from 'three/tsl';`, resolveDir: root }, bundle: true, write: false, metafile: true, format: 'esm', platform: 'node', outdir: temporary, logLevel: 'silent' });
const tslNames = Object.values(tslExports.metafile.outputs)[0].exports.filter((name) => { try { new Function(`const ${name} = 0;`); return true; } catch { return false; } });
let passed = 0;
async function check(name, test) { await test(); passed++; console.log(`ok - ${name}`); }
try {
  const bundled = await build({
    stdin: { contents: `export { CampaignWorld } from './src/ui/grand/campaignWorld.ts'; export * from './src/ui/grand/mapMath.ts'; export * from './src/ui/grand/worldCamera.ts'; export { MAP_ASPECT, project } from './src/ui/grand/projection.ts'; export { siteUV, SITES } from './src/ui/siteMap.ts'; export { V_SCALE } from './src/select/demFrame.ts'; export { Vector3, PerspectiveCamera, Scene, Mesh } from 'three';`, resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'no-gpu', setup(api) {
      api.onResolve({ filter: /^three\/webgpu$/ }, () => ({ path: 'map-three', namespace: 'map-fixture' }));
      api.onResolve({ filter: /^three\/tsl$/ }, () => ({ path: 'map-tsl', namespace: 'map-fixture' }));
      api.onLoad({ filter: /^map-three$/, namespace: 'map-fixture' }, () => ({ contents: `export * from 'three'; import { MeshBasicMaterial, MeshStandardMaterial } from 'three'; export const MeshBasicNodeMaterial = MeshBasicMaterial; export const MeshStandardNodeMaterial = MeshStandardMaterial;`, resolveDir: root }));
      api.onLoad({ filter: /^map-tsl$/, namespace: 'map-fixture' }, () => ({ contents: `const node = () => new Proxy(function () {}, { get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : node()), apply: () => node() }); export const ${tslNames.map((name) => `${name} = node()`).join(', ')};` }));
      api.onLoad({ filter: /[\\/]game[\\/]quality\.ts$/ }, () => ({ contents: 'export const equipment={select:{antialias:false,mapSegments:8},tier:"low"}; export const forceWebGL=true;', loader: 'ts' }));
      api.onLoad({ filter: /[\\/]game[\\/]device\.ts$/ }, () => ({ contents: 'export const isPhone=false; export const isTouchOnly=false;', loader: 'ts' }));
      api.onLoad({ filter: /[\\/]ui[\\/]launch\.ts$/ }, () => ({ contents: 'export const params=new URLSearchParams("");', loader: 'ts' }));
      // The DEM comes from the decoded file above, without a canvas.
      api.onLoad({ filter: /[\\/]select[\\/]terrain\.ts$/ }, () => ({ contents: `import { uniform } from 'three/tsl'; export const worldClock = uniform(0); export const loadDem = (signal) => globalThis.__loadDem(signal);`, loader: 'ts' }));
    } }],
  });
  const path = join(temporary, 'actual-map.mjs'); await writeFile(path, bundled.outputFiles[0].contents);
  const { CampaignWorld, DEM_RECT, MESH_SCALE, groundElevation, MAP_ASPECT, project, siteUV, SITES, V_SCALE, Vector3, PerspectiveCamera, Scene, Mesh, projectFrame, screenFrame, worldX, worldZ } = await import(pathToFileURL(path).href);
  /** A world on its own scene, as WorldCanvas makes one inside r3f's, with what it asked to redraw counted; `compile` stands for the renderer's compileAsync. */
  const open = (compile) => {
    const scene = new Scene(), world = new CampaignWorld(scene, () => { world.changes = (world.changes ?? 0) + 1; }, compile);
    return { scene, world };
  };
  /** Every mesh the world's ground and layers put in the scene. */
  const meshes = (scene) => { const found = []; scene.traverse((o) => { if (o instanceof Mesh) found.push(o); }); return found; };
  const shown = open();
  shown.heights = await shown.world.load();
  /** The camera the world places for a camera state and screen, as WorldCanvas draws with it: what the overlay's maths must agree with. */
  const placed = (cam, screen) => {
    const camera = new PerspectiveCamera();
    shown.world.frame(camera, cam, screen, 0);
    camera.updateMatrixWorld(); shown.scene.updateMatrixWorld();
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
  await check('DOM marker projection matches the camera the world places at arbitrary place, distance, pitch, yaw and panel insets', () => {
    for (const pitch of [0.25, 0.78, 1.4]) for (const yaw of [-2.4, 0, 0.5, 3]) for (const distance of [0.04, 0.5, 1.2]) {
      const cam = { u: 0.47, v: 0.42, distance, yaw, pitch };
      const screen = screenFrame(1920, 1080, { top: 70, right: 380, bottom: 0, left: 20 });
      const camera = placed(cam, screen);
      for (const [u, v, elevation] of [[0.47, 0.42, 0], [0.5, 0.45, 0.003], [0.44, 0.4, 0.001], [0.52, 0.38, 0]]) {
        const p = new Vector3(worldX(u), elevation, worldZ(v)).project(camera);
        const html = projectFrame(cam, screen, u, v, elevation);
        if (p.z > 1 || html.depth <= 0) continue;
        assert.ok(Math.abs((p.x + 1) * 1920 / 2 - html.x) < 1e-3, `x at pitch ${pitch} yaw ${yaw} distance ${distance}`);
        assert.ok(Math.abs((1 - p.y) * 1080 / 2 - html.y) < 1e-3, `y at pitch ${pitch} yaw ${yaw} distance ${distance}`);
      }
    }
  });
  await check('the drawn land stands where the markers do and projects where they are drawn', () => {
    const cam = { u: 0.55, v: 0.45, distance: 0.45, yaw: 0.3, pitch: 0.78 }, screen = screenFrame(1600, 900, { top: 0, right: 0, bottom: 0, left: 0 });
    const camera = placed(cam, screen);
    const land = meshes(shown.scene).find((o) => o.geometry?.attributes.color && o.geometry.attributes.position.count / 3 > 50000);
    assert.ok(land, 'the land has its facets');
    const position = land.geometry.attributes.position;
    let checked = 0;
    for (let i = 0; i < position.count; i += 97) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      if (y <= 0) continue;
      const u = x + 0.5, v = z * MAP_ASPECT + 0.5;
      // The vertex stands on the texel groundElevation reads for its frame point.
      assert.ok(Math.abs(y - groundElevation(shown.heights, u, v)) < 1e-9, `vertex ${i}`);
      const p = new Vector3(x, y, z).project(camera);
      const html = projectFrame(cam, screen, u, v, y);
      if (p.z > 1 || html.depth <= 0) continue;
      assert.ok(Math.abs((p.x + 1) * 1600 / 2 - html.x) < 0.5 && Math.abs((1 - p.y) * 900 / 2 - html.y) < 0.5, `vertex ${i} on screen`);
      checked++;
    }
    assert.ok(checked > 100);
  });
  await check('the world readies a frame only once its ground has loaded, and asks for one when it has', async () => {
    const { scene, world } = open(), camera = new PerspectiveCamera(), screen = screenFrame(1600, 900, { top: 0, right: 0, bottom: 0, left: 0 });
    const cam = { u: 0.5, v: 0.4, distance: 0.5, yaw: 0.4, pitch: 0.7 };
    world.frame(camera, cam, screen, 0);
    assert.equal(world.ready, false); assert.equal(camera.position.length(), 0, 'no camera is placed before the ground is there');
    await world.load();
    assert.equal(world.ready, true); assert.ok(world.changes >= 1, 'a loaded ground asks for a frame');
    world.frame(camera, cam, screen, 1.5);
    assert.ok(camera.position.length() > 0); assert.ok(scene.fog && scene.fog.far > scene.fog.near && scene.background);
    world.dispose();
  });
  await check('the ground and the trees are compiled before the first frame, all of it in view while the renderer gathers it', async () => {
    const calls = [];
    const { scene, world } = open(async () => {
      const objects = [];
      scene.traverse((o) => objects.push(o));
      calls.push({ hidden: objects.filter((o) => !o.visible).length, culled: objects.filter((o) => o.isMesh && o.frustumCulled).length, ready: world.ready, meshes: meshes(scene).length });
    });
    await world.load();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { hidden: 0, culled: 0, ready: false, meshes: calls[0].meshes });
    assert.ok(calls[0].meshes >= 5, 'land, sea, far land, sky and trees');
    const trees = meshes(scene).find((m) => m.isInstancedMesh);
    assert.equal(trees.visible, false, 'the trees are hidden again until the camera comes close');
    assert.ok(meshes(scene).some((m) => m.frustumCulled), 'culling is back');
    world.dispose();
  });
  await check('a new batch of camps or ships is held back until its pipeline is compiled; another of the same kind is not', async () => {
    let gate = null;
    const { scene, world } = open(() => gate?.promise ?? Promise.resolve());
    await world.load();
    gate = defer();
    const batch = new Mesh();
    world.layer.group.add(batch);
    world.layerChanged();
    assert.equal(batch.visible, false, 'held back while it compiles');
    const changes = world.changes;
    gate.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(batch.visible, true);
    assert.ok(world.changes > changes, 'a frame is asked for once it shows');
    const again = new Mesh(batch.geometry, batch.material);
    world.layer.group.add(again);
    world.layerChanged();
    assert.equal(again.visible, true, 'the same material and vertex layout need no compile');
    world.dispose();
    assert.equal(scene.children.length, 0);
  });
  await check('a world that changes nothing on the map is not built again', async () => {
    const { world } = open();
    await world.load();
    let builds = 0;
    world.layer.set = () => { builds++; };
    const settlement = { id: 'yeosu', u: 0.4, v: 0.5, owner: 'joseon', level: 2 };
    const make = (level) => ({ settlements: [{ ...settlement, level }], fleets: [], sails: [] });
    world.setWorld(make(2));
    world.setWorld(make(2));
    assert.equal(builds, 1);
    world.setWorld(make(3));
    assert.equal(builds, 2);
    world.dispose();
  });
  await check('dispose frees the ground and the layers once, leaves the scene empty and readies no frame after', async () => {
    const before = textureFrees, { scene, world } = open();
    await world.load();
    const parts = meshes(scene);
    assert.ok(parts.length >= 4, 'land, sea, far land and sky');
    let geometries = 0, materials = 0;
    for (const mesh of parts) {
      mesh.geometry.addEventListener('dispose', () => geometries++);
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.addEventListener('dispose', () => materials++));
    }
    world.dispose(); world.dispose();
    assert.equal(geometries, parts.length); assert.ok(materials >= parts.length); assert.equal(textureFrees, before + 1);
    assert.equal(scene.children.length, 0); assert.equal(scene.fog, null); assert.equal(scene.background, null);
    const camera = new PerspectiveCamera();
    world.frame(camera, { u: 0.5, v: 0.4, distance: 0.5, yaw: 0.4, pitch: 0.7 }, screenFrame(1600, 900, { top: 0, right: 0, bottom: 0, left: 0 }), 0);
    assert.equal(world.ready, false); assert.equal(camera.position.length(), 0, 'nothing is drawn after dispose');
  });
  for (const late of [false, true]) await check(late ? 'a DEM texture handed over after disposal is freed before the ground is built' : 'a DEM that arrives after disposal is discarded before the ground is built', async () => {
    demGate = defer(); lateAbort = late; const before = textureFrees, beforeLoads = demLoads;
    const { scene, world } = open(); const loading = world.load();
    await new Promise((resolve) => setImmediate(resolve)); world.dispose(); demGate.resolve(); demGate = null;
    await assert.rejects(loading, (error) => error.name === 'AbortError'); lateAbort = false;
    assert.equal(demLoads, beforeLoads + 1); assert.equal(textureFrees, before + (late ? 1 : 0));
    assert.equal(scene.children.length, 0); assert.equal(world.ready, false);
  });
  shown.world.dispose();
  console.log(`${passed} map regressions passed`);
} finally {
  // mkdtemp gives this test its own directory; no workspace files are removed.
  await rm(temporary, { recursive: true, force: true });
}
