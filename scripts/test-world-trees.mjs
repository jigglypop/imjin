// The forest of the campaign world: where trees are planted and where they are not. Pure CPU; no GPU is created.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
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
  const planted = (layer) => layer.mesh.count;
  const positions = (layer) => Array.from({ length: layer.mesh.count }, (_, i) => ({ x: layer.mesh.instanceMatrix.array[i * 16 + 12], y: layer.mesh.instanceMatrix.array[i * 16 + 13], z: layer.mesh.instanceMatrix.array[i * 16 + 14] }));
  // update() works within a time budget a frame and says whether to draw again: call it as frames would until it rests.
  const settle = (layer, c) => {
    let changed = false;
    for (let frame = 0; frame < 500; frame += 1) {
      if (!layer.update(c)) return changed;
      changed = true;
    }
    throw new Error('the trees never came to rest');
  };

  check('a tree is a low-poly pine of at most 12 triangles, and at most 8000 are laid', () => {
    const layer = new TreeLayer(ground, perMetre);
    assert.ok(layer.mesh.geometry.getAttribute('position').count / 3 <= 12);
    assert.ok(layer.mesh.instanceMatrix.count <= 8000, String(layer.mesh.instanceMatrix.count));
    layer.dispose();
  });

  check('a close camera plants trees on the island and none in the sea, within the cap', () => {
    const layer = new TreeLayer(ground, perMetre);
    assert.equal(settle(layer, cam(0.04)), true);
    assert.ok(planted(layer) > 200 && planted(layer) <= 8000, String(planted(layer)));
    assert.equal(layer.mesh.visible, true);
    for (const p of positions(layer)) assert.ok(ground(frameU(p.x), frameV(p.z)) > 0, 'a tree stands on land');
    layer.dispose();
  });

  check('trees keep clear of a camp', () => {
    const layer = new TreeLayer(ground, perMetre);
    layer.setClearings([{ u: centre.u + 0.004, v: centre.v }]);
    settle(layer, cam(0.04));
    const camp = { x: worldX(centre.u + 0.004), z: worldZ(centre.v) };
    assert.ok(planted(layer) > 0);
    for (const p of positions(layer)) assert.ok(Math.hypot(p.x - camp.x, p.z - camp.z) >= 0.0175 - 1e-9, 'no tree inside the clearing');
    layer.dispose();
  });

  check('the same camera plants the same forest, and a far camera plants none', () => {
    const a = new TreeLayer(ground, perMetre), b = new TreeLayer(ground, perMetre);
    settle(a, cam(0.04)); settle(b, cam(0.04));
    assert.equal(planted(a), planted(b));
    assert.deepEqual(positions(a).slice(0, 20), positions(b).slice(0, 20));
    assert.equal(a.update(cam(0.6)), true, 'going far hides the trees');
    assert.equal(a.mesh.visible, false);
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
    assert.equal(settle(layer, cam(0.04, centre.u + 0.005)), true, 'the trees follow the camera');
    assert.ok(readings < first * 0.3, `${readings} readings of the ground after a short pan, ${first} for the first planting`);
    layer.dispose();
  });

  check('trees are bigger when planted for a farther camera, so the forest still reads', () => {
    const near = new TreeLayer(ground, perMetre), far = new TreeLayer(ground, perMetre);
    settle(near, cam(0.04)); settle(far, cam(0.2));
    const heights = (layer) => Array.from({ length: Math.min(50, layer.mesh.count) }, (_, i) => layer.mesh.instanceMatrix.array[i * 16 + 5]);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    assert.ok(mean(heights(far)) > mean(heights(near)) * 2);
    near.dispose(); far.dispose();
  });

  console.log(`${passed} world tree regressions passed`);
} finally {
  await server.close();
}
