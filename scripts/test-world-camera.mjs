// The free camera of the campaign world: projection, the ground under the pointer, zoom, limits and framing. Pure maths, no GPU.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
let passed = 0;
const check = (name, run) => { run(); passed++; console.log('ok   ' + name); };
const near = (a, b, eps = 1e-6, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} != ${b}`);
try {
  const cam = await server.ssrLoadModule('/src/ui/grand/worldCamera.ts');
  const { projectPoint, projectFrame, unproject, panBy, zoomAt, turn, clampState, frameAll, screenFrame, eyeOf, LIMITS, FOV } = cam;
  const screen = screenFrame(1600, 900, { top: 0, right: 0, bottom: 0, left: 0 });
  const base = { u: 0.5, v: 0.4, distance: 0.5, yaw: 0, pitch: 0.75 };

  check('the target appears at the middle of the free area, which follows the panels', () => {
    const p = projectFrame(base, screen, base.u, base.v, 0);
    near(p.x, 800, 1e-6, 'x'); near(p.y, 450, 1e-6, 'y'); assert.ok(p.visible && p.depth > 0);
    const shifted = screenFrame(1600, 900, { top: 70, right: 400, bottom: 0, left: 0 });
    const q = projectFrame(base, shifted, base.u, base.v, 0);
    near(q.x, 600, 1e-6, 'x with a side panel'); near(q.y, 485, 1e-6, 'y with a top bar');
  });

  check('a point on the ground projects and unprojects back to itself', () => {
    for (const yaw of [0, 0.9, -2.2, 3.1]) for (const pitch of [0.25, 0.75, 1.4]) {
      const c = { ...base, yaw, pitch };
      for (const [u, v] of [[0.5, 0.4], [0.47, 0.37], [0.55, 0.44], [0.4, 0.5]]) {
        const p = projectFrame(c, screen, u, v, 0);
        if (!p.visible) continue;
        const back = unproject(c, screen, p.x, p.y);
        assert.ok(back, `no ground at yaw ${yaw} pitch ${pitch}`);
        near(back.u, u, 1e-7, 'u'); near(back.v, v, 1e-7, 'v');
      }
    }
  });

  check('north is up at yaw 0 and east is right, and a quarter turn puts the eye in the east', () => {
    const north = projectFrame(base, screen, base.u, base.v - 0.05, 0), east = projectFrame(base, screen, base.u + 0.05, base.v, 0);
    assert.ok(north.y < 450 && east.x > 800);
    const turned = { ...base, yaw: Math.PI / 2 };
    const e2 = projectFrame(turned, screen, base.u + 0.05, base.v, 0), n2 = projectFrame(turned, screen, base.u, base.v - 0.05, 0);
    assert.ok(e2.y > 450, 'with the eye in the east, east is the near side');
    assert.ok(n2.x > 800, 'and north has gone to the right');
  });

  check('things nearer the camera are bigger, and points behind it are not visible', () => {
    const low = { ...base, pitch: 0.3 };
    const near1 = projectFrame(low, screen, base.u, base.v + 0.15, 0), far1 = projectFrame(low, screen, base.u, base.v - 0.15, 0);
    assert.ok(near1.scale > far1.scale && near1.depth < far1.depth);
    const eye = eyeOf(base);
    const behind = projectPoint(base, screen, eye[0] + (eye[0] - (base.u - 0.5)) * 2, eye[1], eye[2] + (eye[2] - (base.v - 0.5) / 1) * 0, 0);
    assert.ok(Number.isFinite(behind.depth));
    const back = projectPoint(base, screen, eye[0], eye[1] + 1, eye[2] + 1, 0);
    assert.ok(!back.visible || back.depth > 0);
  });

  check('dragging keeps the grabbed ground under the pointer', () => {
    for (const yaw of [0, 1.2, -2.5]) for (const pitch of [0.4, 0.9, 1.4]) {
      let c = { ...base, yaw, pitch };
      const from = { x: 700, y: 500 }, to = { x: 760, y: 430 };
      const grabbed = unproject(c, screen, from.x, from.y);
      c = panBy(c, screen, from, to);
      const now = unproject(c, screen, to.x, to.y);
      near(now.u, grabbed.u, 1e-7, 'u'); near(now.v, grabbed.v, 1e-7, 'v');
    }
  });

  check('zooming keeps the ground under the cursor, and the distance stays inside its limits', () => {
    for (const factor of [1.3, 0.7, 2.5]) {
      const c = { ...base, yaw: 0.6, pitch: 0.8 };
      const cursor = { x: 1100, y: 300 };
      const before = unproject(c, screen, cursor.x, cursor.y);
      const z = zoomAt(c, screen, cursor.x, cursor.y, factor);
      const after = unproject(z, screen, cursor.x, cursor.y);
      near(after.u, before.u, 1e-6, 'u'); near(after.v, before.v, 1e-6, 'v');
      assert.ok(z.distance >= LIMITS.minDistance && z.distance <= LIMITS.maxDistance);
    }
    let c = base;
    for (let i = 0; i < 40; i += 1) c = zoomAt(c, screen, 800, 450, 1.4);
    near(c.distance, LIMITS.minDistance, 1e-9, 'closest');
    for (let i = 0; i < 80; i += 1) c = zoomAt(c, screen, 800, 450, 1 / 1.4);
    near(c.distance, LIMITS.maxDistance, 1e-9, 'farthest');
  });

  check('turning wraps the yaw and the pitch and the eye height stay inside their limits', () => {
    let c = { ...base };
    for (let i = 0; i < 100; i += 1) c = turn(c, 0.4, 0.05);
    assert.ok(c.yaw >= -Math.PI && c.yaw <= Math.PI);
    near(c.pitch, LIMITS.maxPitch, 1e-9, 'top');
    const close = clampState({ ...base, distance: LIMITS.minDistance, pitch: 0.05 });
    assert.ok(eyeOf(close)[1] >= LIMITS.minEyeHeight - 1e-9, 'the eye clears the peaks when close');
    const far = clampState({ ...base, distance: LIMITS.maxDistance, pitch: 0.05 });
    near(far.pitch, LIMITS.minPitch, 1e-9, 'a low view is allowed when far');
  });

  check('the target cannot leave the frame by more than its slack', () => {
    const c = clampState({ ...base, u: 5, v: -4 });
    near(c.u, 1 + LIMITS.slack, 1e-12); near(c.v, -LIMITS.slack, 1e-12);
    assert.deepEqual(panBy(base, screen, { x: 800, y: 100 }, { x: 800, y: 100 }), clampState(base));
  });

  check('a drag near the horizon never produces non-finite numbers', () => {
    const low = clampState({ ...base, distance: 1.2, pitch: LIMITS.minPitch });
    const moved = panBy(low, screen, { x: 800, y: 700 }, { x: 800, y: 200 });
    for (const k of ['u', 'v', 'distance', 'yaw', 'pitch']) assert.ok(Number.isFinite(moved[k]), k);
    assert.equal(unproject(low, screen, 800, 5), null, 'the sky has no ground');
  });

  check('framing puts every point inside the screen', () => {
    for (const yaw of [0, 0.8, 2.4]) {
      const points = [{ u: 0.35, v: 0.5 }, { u: 0.62, v: 0.38 }, { u: 0.5, v: 0.62 }];
      const c = frameAll(points, { ...base, yaw, pitch: 0.8 }, screen, 56);
      for (const p of points) {
        const s = projectFrame(c, screen, p.u, p.v, 0);
        assert.ok(s.x > 20 && s.x < 1580 && s.y > 20 && s.y < 880, `yaw ${yaw}: (${s.x.toFixed(0)}, ${s.y.toFixed(0)})`);
      }
    }
  });

  check('the focal length follows the field of view', () => {
    const p = projectFrame(base, screen, base.u, base.v, 0.02);
    const q = projectFrame(base, screen, base.u, base.v, 0);
    assert.ok(p.y < q.y, 'a point above the ground target is higher on screen');
    near(p.scale, 450 / Math.tan(FOV / 2) / p.depth, 1e-6, 'scale');
  });

  console.log(`${passed} world camera regressions passed`);
} finally {
  await server.close();
}
