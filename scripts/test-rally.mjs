// The rally standard planted on the sea: its pose on the waves, its cloth, when it goes and what it allocates.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'imjin-rally-'));
const bundled = join(temporary, 'rally.mjs');
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}`, error); }
};
try {
  const built = await build({ stdin: { contents: "export * from './src/conquest/RallyStandards'; export {WaveField, SEA_STATES} from './src/ocean/waves'; export {Scene} from 'three/webgpu';", resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  await writeFile(bundled, built.outputFiles[0].contents);
  const { RallyStandards, MAST_HEIGHT, CLOTH_LENGTH, CLOTH_COLUMNS, CLOTH_ROWS, CLOTH_VERTS, STANDARD_VERTS, WaveField, SEA_STATES, Scene } = await import(pathToFileURL(bundled).href);
  const OWNER = 0;
  const setup = () => {
    const waves = new WaveField();
    waves.setState(SEA_STATES.rough);
    waves.time = 37;
    const standards = new RallyStandards();
    const scene = new Scene();
    scene.add(standards.group);
    const points = [
      { id: 0, owner: OWNER, rally: { x: 120, z: -340 } },
      { id: 1, owner: 1, rally: { x: 900, z: 900 } },
      { id: 2, owner: OWNER },
      { id: 3, owner: OWNER, rally: { x: -610, z: 45 } },
    ];
    // The camera close by, so the standards are drawn life size.
    const eye = { x: 100, y: 20, z: -300 };
    const step = (dt = 1 / 60, ended = false) => standards.update(points, OWNER, 'joseon', waves, 0.6, eye, ended, dt, 0);
    const [body, foam] = standards.group.children;
    return { waves, standards, scene, points, eye, step, body, foam };
  };
  // The cloth of standard k, in world space, as [column][row] points.
  const clothOf = (body, k) => {
    const p = body.geometry.attributes.position.array;
    const out = [];
    for (let i = 0; i < CLOTH_COLUMNS; i += 1) {
      const column = [];
      for (let j = 0; j < CLOTH_ROWS; j += 1) {
        const o = (k * STANDARD_VERTS + STANDARD_VERTS - CLOTH_VERTS + i * CLOTH_ROWS + j) * 3;
        column.push([p[o], p[o + 1], p[o + 2]]);
      }
      out.push(column);
    }
    return out;
  };

  check('one standard per own port with a rally point, its foot on the wave height at the rally point', () => {
    const { waves, standards, step, points } = setup();
    step();
    assert.equal(standards.count, 2);
    assert.deepEqual([...standards.ids.slice(0, 2)], [0, 3]);
    for (let k = 0; k < 2; k += 1) {
      const rally = points.find((p) => p.id === standards.ids[k]).rally;
      assert.equal(standards.feet[k * 3], Math.fround(rally.x));
      assert.equal(standards.feet[k * 3 + 2], Math.fround(rally.z));
      assert.ok(Math.abs(standards.feet[k * 3 + 1] - waves.heightAt(rally.x, rally.z, waves.time)) < 1e-4);
    }
    // The foot rides the swell: a later wave time moves it up or down with the water.
    const before = standards.feet[1];
    waves.time += 3.3;
    step();
    assert.notEqual(standards.feet[1], before);
    assert.ok(Math.abs(standards.feet[1] - waves.heightAt(120, -340, waves.time)) < 1e-4);
  });

  check('the mast stands up from the water at life size and the cloth flies from its top', () => {
    const { standards, step, body } = setup();
    step();
    const p = body.geometry.attributes.position.array;
    let top = -Infinity, bottom = Infinity;
    for (let i = 0; i < STANDARD_VERTS; i += 1) {
      top = Math.max(top, p[i * 3 + 1]);
      bottom = Math.min(bottom, p[i * 3 + 1]);
    }
    const foot = standards.feet[1];
    assert.ok(top - foot > MAST_HEIGHT - 1 && top - foot < MAST_HEIGHT + 2.5, `top ${top - foot}`);
    assert.ok(bottom < foot, 'the mast reaches into the water, so no trough shows its end');
  });

  check('the cloth moves over time and never reaches past its length', () => {
    const { step, body } = setup();
    step();
    const a = clothOf(body, 0);
    for (let n = 0; n < 40; n += 1) step(1 / 30);
    const b = clothOf(body, 0);
    let moved = 0;
    for (let i = 0; i < CLOTH_COLUMNS; i += 1) {
      for (let j = 0; j < CLOTH_ROWS; j += 1) {
        moved = Math.max(moved, Math.hypot(a[i][j][0] - b[i][j][0], a[i][j][1] - b[i][j][1], a[i][j][2] - b[i][j][2]));
        for (const cloth of [a, b]) {
          const hoist = cloth[0][j], at = cloth[i][j];
          const reach = Math.hypot(at[0] - hoist[0], at[1] - hoist[1], at[2] - hoist[2]);
          assert.ok(reach <= CLOTH_LENGTH + 1e-3, `reach ${reach}`);
        }
      }
    }
    assert.ok(moved > 0.3, `the fly moved ${moved} m`);
    // The hoist stays on the mast while the fly waves.
    let hoistMoved = 0;
    for (let j = 0; j < CLOTH_ROWS; j += 1) hoistMoved = Math.max(hoistMoved, Math.hypot(a[0][j][0] - b[0][j][0], a[0][j][2] - b[0][j][2]));
    assert.ok(hoistMoved < 0.5, `hoist moved ${hoistMoved} m`);
  });

  check('a cleared rally point takes its standard away, and so does the end of the battle', () => {
    const { standards, step, points, body, foam } = setup();
    step();
    assert.equal(standards.count, 2);
    points[0].rally = undefined;
    step();
    assert.equal(standards.count, 1);
    assert.equal(standards.ids[0], 3);
    points[3].rally = undefined;
    step();
    assert.equal(standards.count, 0);
    assert.equal(standards.group.visible, false);
    assert.equal(body.geometry.drawRange.count, 0);
    assert.equal(foam.geometry.drawRange.count, 0);
    points[0].rally = { x: 10, z: 10 };
    step();
    assert.equal(standards.count, 1);
    assert.equal(standards.group.visible, true);
    step(1 / 60, true);
    assert.equal(standards.count, 0);
    assert.equal(standards.group.visible, false);
  });

  check('a captured port loses its standard with the port', () => {
    const { standards, step, points } = setup();
    points[3].owner = 1;
    step();
    assert.equal(standards.count, 1);
    assert.equal(standards.ids[0], 0);
  });

  check('nothing is created per frame: the same meshes, attributes and arrays are rewritten in place', () => {
    const { standards, step, body, foam, waves } = setup();
    step();
    const children = [...standards.group.children];
    const attributes = [body, foam].flatMap((m) => Object.values(m.geometry.attributes).concat(m.geometry.index));
    const arrays = attributes.map((a) => a.array);
    const versions = new Map(attributes.map((a) => [a, a.version]));
    for (let n = 0; n < 120; n += 1) { waves.time += 1 / 60; step(); }
    assert.deepEqual(standards.group.children, children);
    const after = [body, foam].flatMap((m) => Object.values(m.geometry.attributes).concat(m.geometry.index));
    assert.deepEqual(after, attributes);
    assert.ok(after.every((a, i) => a.array === arrays[i]));
    // Positions and normals upload every frame; the colours, uvs and indices were written once.
    const changed = new Set(after.filter((a) => a.version !== versions.get(a)));
    const moving = [body.geometry.attributes.position, body.geometry.attributes.normal, foam.geometry.attributes.position];
    assert.equal(changed.size, moving.length);
    assert.ok(moving.every((a) => changed.has(a)));
  });

  check('dispose frees both geometries and materials and leaves the scene', () => {
    const { standards, step, body, foam, scene } = setup();
    step();
    let freed = 0;
    for (const m of [body, foam]) {
      m.geometry.addEventListener('dispose', () => { freed += 1; });
      m.material.addEventListener('dispose', () => { freed += 1; });
    }
    standards.dispose();
    assert.equal(freed, 4);
    assert.equal(standards.group.parent, null);
    assert.equal(scene.children.length, 0);
  });
} finally {
  await rm(bundled, { force: true }); await rmdir(temporary);
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exitCode = failures ? 1 : 0;
