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
  // An island 0.03 across with a hill in the middle, in a sea; heights in frame units.
  const centre = { u: 0.5, v: 0.5 };
  const ground = (u, v) => {
    const d = Math.hypot(u - centre.u, (v - centre.v) * 0.5);
    return d > 0.03 ? -0.00005 : (0.03 - d) / 0.03 * 600 * perMetre + 12 * perMetre;
  };
  const cam = (distance, u = centre.u, v = centre.v) => ({ u, v, distance, yaw: 0, pitch: 0.7 });
  const planted = (layer) => layer.mesh.count;
  const positions = (layer) => Array.from({ length: layer.mesh.count }, (_, i) => ({ x: layer.mesh.instanceMatrix.array[i * 16 + 12], y: layer.mesh.instanceMatrix.array[i * 16 + 13], z: layer.mesh.instanceMatrix.array[i * 16 + 14] }));

  check('a close camera plants trees on the island and none in the sea, within the cap', () => {
    const layer = new TreeLayer(ground, perMetre);
    assert.equal(layer.update(cam(0.04)), true);
    assert.ok(planted(layer) > 200 && planted(layer) <= 30000, String(planted(layer)));
    assert.equal(layer.mesh.visible, true);
    for (const p of positions(layer)) assert.ok(ground(frameU(p.x), frameV(p.z)) > 0, 'a tree stands on land');
    layer.dispose();
  });

  check('trees keep clear of a camp', () => {
    const layer = new TreeLayer(ground, perMetre);
    layer.setClearings([{ u: centre.u + 0.004, v: centre.v }]);
    layer.update(cam(0.04));
    const camp = { x: worldX(centre.u + 0.004), z: worldZ(centre.v) };
    for (const p of positions(layer)) assert.ok(Math.hypot(p.x - camp.x, p.z - camp.z) >= 0.0175 - 1e-9, 'no tree inside the clearing');
    layer.dispose();
  });

  check('the same camera plants the same forest, and a far camera plants none', () => {
    const a = new TreeLayer(ground, perMetre), b = new TreeLayer(ground, perMetre);
    a.update(cam(0.04)); b.update(cam(0.04));
    assert.equal(planted(a), planted(b));
    assert.deepEqual(positions(a).slice(0, 20), positions(b).slice(0, 20));
    assert.equal(a.update(cam(0.6)), true, 'going far hides the trees');
    assert.equal(a.mesh.visible, false);
    a.dispose(); b.dispose();
  });

  check('a camera resting on a level boundary does not flip between levels, and small moves do not replant', () => {
    const layer = new TreeLayer(ground, perMetre);
    layer.update(cam(0.05));
    const level = layer.level;
    layer.update(cam(0.056));
    assert.equal(layer.level, level, 'the first level holds a little past its limit');
    layer.builtAt = -1e9;
    assert.equal(layer.update(cam(0.056, centre.u + 0.0001)), false, 'a tiny move plants nothing new');
    layer.dispose();
  });

  check('trees are bigger when planted for a farther camera, so the forest still reads', () => {
    const near = new TreeLayer(ground, perMetre), far = new TreeLayer(ground, perMetre);
    near.update(cam(0.04)); far.update(cam(0.2));
    const heights = (layer) => Array.from({ length: Math.min(50, layer.mesh.count) }, (_, i) => layer.mesh.instanceMatrix.array[i * 16 + 5]);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    assert.ok(mean(heights(far)) > mean(heights(near)) * 2);
    near.dispose(); far.dispose();
  });

  console.log(`${passed} world tree regressions passed`);
} finally {
  await server.close();
}
