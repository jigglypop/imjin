// The forest of the campaign world: where trees are planted and where they are not. Pure CPU; no GPU is created.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
let passed = 0;
const check = (name, run) => { run(); passed++; console.log('ok   ' + name); };
try {
  const { TreeLayer } = await server.ssrLoadModule('/src/ui/grand/worldTrees.ts');
  const { worldX, worldZ, frameU, frameV } = await server.ssrLoadModule('/src/ui/grand/worldCamera.ts');
  const perMetre = 4e-6;
  // An island 0.03 across with a hill in the middle, in a sea; heights in frame units. Every reading is counted.
  const centre = { u: 0.5, v: 0.5 };
  let readings = 0;
  const ground = (u, v) => {
    readings += 1;
    const d = Math.hypot(u - centre.u, (v - centre.v) * 0.5);
    return d > 0.03 ? -0.00005 : (0.03 - d) / 0.03 * 600 * perMetre + 12 * perMetre;
  };
  const cam = (distance, u = centre.u, v = centre.v) => ({ u, v, distance, yaw: 0, pitch: 0.7 });
  const planted = (layer) => layer.count;
  const positions = (layer) => layer.meshes.flatMap((mesh) => Array.from({ length: mesh.count }, (_, i) => ({ x: mesh.instanceMatrix.array[i * 16 + 12], y: mesh.instanceMatrix.array[i * 16 + 13], z: mesh.instanceMatrix.array[i * 16 + 14], h: mesh.instanceMatrix.array[i * 16 + 5] })));
  // update() works within a time budget a frame and says whether to draw again: call it as frames would until it rests.
  const settle = (layer, c) => {
    let changed = false;
    for (let frame = 0; frame < 500; frame += 1) {
      if (!layer.update(c)) return changed;
      changed = true;
    }
    throw new Error('the trees never came to rest');
  };

  check('four kinds (broadleaf, fir, rock, red pine), each under 120 triangles, at most 18500 laid in all', () => {
    const layer = new TreeLayer(ground, perMetre);
    assert.equal(layer.meshes.length, 4);
    for (const mesh of layer.meshes) assert.ok(mesh.geometry.index.count / 3 <= 120, String(mesh.geometry.index.count / 3));
    const capacity = layer.meshes.reduce((n, m) => n + m.instanceMatrix.count, 0);
    assert.ok(capacity <= 18500, String(capacity));
    layer.dispose();
  });

  check('the land\'s cover decides: woods where it is wooded, rocks on its crags, nothing on open fields', () => {
    // West of the hill's top all wood, east of it all crag, south of it all farmland.
    const cover = (u, v) => {
      const base = { wood: 0, rock: 0, crag: 0, sand: 0, farm: 0, slope: 0.3, metres: 300, wander: 0 };
      if (v > centre.v + 0.004) return { ...base, farm: 1 };
      return u < centre.u ? { ...base, wood: 1 } : { ...base, rock: 1, crag: 1 };
    };
    const layer = new TreeLayer(ground, perMetre, cover);
    settle(layer, cam(0.04));
    const [broad, fir, rock, red] = layer.meshes.map((m) => m.count);
    assert.ok(broad + fir + red > 200, `${broad + fir + red} trees`);
    assert.ok(rock > 20, `${rock} rocks`);
    const at = (mesh, i) => ({ u: frameU(mesh.instanceMatrix.array[i * 16 + 12]), v: frameV(mesh.instanceMatrix.array[i * 16 + 14]) });
    for (const kind of [0, 1, 3]) for (let i = 0; i < layer.meshes[kind].count; i += 1) {
      const p = at(layer.meshes[kind], i);
      assert.ok(p.u < centre.u + 1e-9 && p.v <= centre.v + 0.004 + 1e-9, 'a tree stands in the wood');
    }
    for (let i = 0; i < rock; i += 1) assert.ok(at(layer.meshes[2], i).u >= centre.u - 1e-9, 'a rock stands on the crag');
    layer.dispose();
  });

  check('a close camera plants trees on the island and none in the sea, within the cap', () => {
    const layer = new TreeLayer(ground, perMetre);
    assert.equal(settle(layer, cam(0.04)), true);
    assert.ok(planted(layer) > 200 && planted(layer) <= 8000, String(planted(layer)));
    assert.ok(layer.meshes.some((m) => m.visible));
    for (const p of positions(layer)) assert.ok(ground(frameU(p.x), frameV(p.z)) > 0, 'a tree stands on land');
    layer.dispose();
  });

  check('trees keep clear of each settlement as far as it reaches, and no farther', () => {
    // A wide camp east of the hill and a small hamlet west of it.
    const spots = [{ u: centre.u + 0.006, v: centre.v, r: 0.012 }, { u: centre.u - 0.008, v: centre.v, r: 0.003 }];
    const layer = new TreeLayer(ground, perMetre);
    layer.setClearings(spots);
    settle(layer, cam(0.04));
    const trees = positions(layer);
    assert.ok(trees.length > 0);
    for (const s of spots) {
      const at = { x: worldX(s.u), z: worldZ(s.v) };
      for (const p of trees) assert.ok(Math.hypot(p.x - at.x, p.z - at.z) >= s.r - 1e-9, 'no tree inside a clearing');
    }
    const hamlet = { x: worldX(spots[1].u), z: worldZ(spots[1].v) };
    assert.ok(trees.some((p) => Math.hypot(p.x - hamlet.x, p.z - hamlet.z) < 0.008), 'a small place is not left in a wide clearing');
    layer.dispose();
  });

  check('the same camera plants the same forest, and a far camera plants none', () => {
    const a = new TreeLayer(ground, perMetre), b = new TreeLayer(ground, perMetre);
    settle(a, cam(0.04)); settle(b, cam(0.04));
    assert.equal(planted(a), planted(b));
    assert.deepEqual(positions(a).slice(0, 20), positions(b).slice(0, 20));
    assert.equal(a.update(cam(0.6)), true, 'going far hides the trees');
    assert.ok(a.meshes.every((m) => !m.visible));
    a.dispose(); b.dispose();
  });

  check('a camera resting on a level boundary does not flip between levels, and small moves do not replant', () => {
    const layer = new TreeLayer(ground, perMetre);
    settle(layer, cam(0.05));
    const level = layer.level;
    settle(layer, cam(0.056));
    assert.equal(layer.level, level, 'the first level holds a little past its limit');
    assert.equal(layer.update(cam(0.056, centre.u + 0.0001)), false, 'a tiny move plants nothing new');
    layer.dispose();
  });

  check('panning works out only the ground that comes into reach', () => {
    const layer = new TreeLayer(ground, perMetre);
    readings = 0;
    settle(layer, cam(0.04));
    const first = readings;
    readings = 0;
    assert.equal(settle(layer, cam(0.04, centre.u + 0.008)), true, 'the trees follow the camera');
    assert.ok(readings < first * 0.3, `${readings} readings of the ground after a short pan, ${first} for the first planting`);
    layer.dispose();
  });

  check('trees are bigger when planted for a farther camera, so the forest still reads', () => {
    const near = new TreeLayer(ground, perMetre), far = new TreeLayer(ground, perMetre);
    settle(near, cam(0.04)); settle(far, cam(0.2));
    const heights = (layer) => positions(layer).slice(0, 50).map((p) => p.h);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    assert.ok(mean(heights(far)) > mean(heights(near)) * 2);
    near.dispose(); far.dispose();
  });

  console.log(`${passed} world tree regressions passed`);
} finally {
  await server.close();
}
