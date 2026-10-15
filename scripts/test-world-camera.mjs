// The free camera of the campaign world: projection, the ground under the pointer, zoom, limits, framing and the motion between inputs (glides, the coast after a drag, held keys, the eased wheel). Pure maths, no GPU.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
let passed = 0;
const check = (name, run) => { run(); passed++; console.log('ok   ' + name); };
const near = (a, b, eps = 1e-6, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} != ${b}`);
try {
  const cam = await server.ssrLoadModule('/src/ui/grand/worldCamera.ts');
  const { projectPoint, projectFrame, unproject, panBy, zoomAt, zoomPitch, turn, clampState, frameAll, screenFrame, eyeOf, LIMITS, FOV, OPEN_PITCH } = cam;
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

  check('zooming in tilts the view down towards a camp and zooming out tilts it back, a tilt set by hand kept', () => {
    near(zoomPitch(LIMITS.maxDistance), OPEN_PITCH, 1e-12, 'far away, the opening pitch');
    assert.ok(zoomPitch(LIMITS.minDistance) < zoomPitch(0.06) && zoomPitch(0.06) < zoomPitch(0.14) && zoomPitch(0.14) < zoomPitch(0.3) && zoomPitch(0.3) <= OPEN_PITCH);
    assert.ok(zoomPitch(LIMITS.minDistance) < 0.45, 'low over a single camp');
    // The player had tipped the view up by 0.2 from where the curve has it.
    const tipped = { ...base, distance: 0.5, pitch: zoomPitch(0.5) + 0.2 };
    let c = tipped;
    for (let i = 0; i < 12; i += 1) c = zoomAt(c, screen, 1100, 300, 1.25);
    assert.ok(c.pitch < tipped.pitch - 0.15, 'tilted down on the way in');
    near(c.pitch - zoomPitch(c.distance), 0.2, 1e-9, 'the player\'s tilt kept');
    for (let i = 0; i < 12; i += 1) c = zoomAt(c, screen, 1100, 300, 1 / 1.25);
    near(c.pitch, tipped.pitch, 1e-9, 'back up on the way out');
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

  // The camera's own motion between inputs (cameraMotion.ts): glides, the coast after a drag, held keys and the wheel.
  const { CameraMotion, glideAt, GLIDE_MS, KEY_ACTIONS } = await server.ssrLoadModule('/src/ui/grand/cameraMotion.ts');
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  /** Steps `motion` every `hz`-th of a second from `t0` (ms) for `seconds`, returning the camera and the time it stopped moving. */
  const run = (motion, c, t0, seconds, hz = 60) => {
    let stopped = null;
    for (let i = 1; i <= Math.round(seconds * hz); i += 1) {
      const now = t0 + (i * 1000) / hz;
      c = motion.step(c, screen, now);
      if (stopped === null && !motion.moving) stopped = now;
    }
    return { c, stopped };
  };

  check('a glide eases out from where it starts to its target, turning the short way round', () => {
    const from = { ...base, yaw: 3 }, to = clampState({ ...base, u: 0.56, distance: 0.25, yaw: -3, pitch: 1 });
    const g = { from, to, start: 1000, duration: GLIDE_MS };
    const first = glideAt(g, 1000);
    for (const k of ['u', 'v', 'distance', 'yaw', 'pitch']) near(first[k], clampState(from)[k], 1e-9, k);
    assert.deepEqual(glideAt(g, 1000 + GLIDE_MS), to);
    let last = first.distance;
    for (let t = 0; t <= GLIDE_MS; t += 23) {
      const c = glideAt(g, 1000 + t);
      assert.ok(Math.abs(wrap(c.yaw - from.yaw)) <= wrap(to.yaw - from.yaw) + 1e-9, 'through the back, not the long way round');
      assert.ok(c.distance <= last + 1e-12, 'the distance only closes in'); last = c.distance;
    }
    assert.ok((glideAt(g, 1000 + GLIDE_MS / 4).u - from.u) / (to.u - from.u) > 0.5, 'most of the way is done early');
  });

  check('a glide runs its course frame by frame, a press stops it at once, and a second press adds to the first', () => {
    const m = new CameraMotion(), target = { ...base, u: 0.53, yaw: 0.6, pitch: 1 };
    m.glideTo(base, target, 1000);
    const { c, stopped } = run(m, base, 1000, GLIDE_MS / 1000 + 0.05);
    assert.deepEqual(c, clampState(target)); assert.ok(stopped !== null && stopped <= 1000 + GLIDE_MS + 17 && !m.moving);
    m.glideTo(base, target, 0);
    const midway = m.step(base, screen, 100);
    assert.ok(m.moving && midway.yaw > 0 && midway.yaw < 0.6);
    m.stop();
    assert.equal(m.moving, false); assert.deepEqual(m.step(midway, screen, 200), midway, 'a press holds the camera where it is');
    m.glideTo(base, { ...base, yaw: Math.PI / 4 }, 0);
    near(m.destination(base).yaw, Math.PI / 4, 1e-12, 'the first glide aims at 45 degrees');
    m.glideTo(m.step(base, screen, 50), { ...m.destination(base), yaw: m.destination(base).yaw + Math.PI / 4 }, 50);
    near(run(m, base, 50, 1).c.yaw, Math.PI / 2, 1e-9, 'a second press goes on to 90');
  });

  check('a drag coasts on in its own direction after release, settles within 0.4 s and is the same at any frame rate', () => {
    // A pan to the east and a turn, 0.002 of the frame and 0.01 radians every 16 ms, let go 5 ms after the last move.
    const drag = (m) => {
      let c = base;
      for (let t = 0; t <= 160; t += 16) { c = { ...base, u: base.u + 0.002 * (t / 16), yaw: 0.01 * (t / 16) }; m.track(c, t); }
      m.release(c, 165);
      return c;
    };
    const ends = [30, 60, 144].map((hz) => {
      const m = new CameraMotion(), c = drag(m);
      assert.ok(m.moving, 'it coasts');
      // A sixth of a second is a whole number of frames at each rate.
      const early = run(m, c, 165, 1 / 6, hz).c;
      const { c: end, stopped } = run(m, early, 165 + 1000 / 6, 0.5, hz);
      return { c, early, end, stopped };
    });
    for (const { c, early, end, stopped } of ends) {
      assert.ok(early.u > c.u && end.u > early.u && early.yaw > c.yaw, 'on in the same direction');
      // An exponential slowdown from 0.125 of the frame a second with a 0.1 s time constant covers at most 0.0125.
      assert.ok(end.u - c.u > 0.008 && end.u - c.u < 0.0125, `coasted ${end.u - c.u}`);
      assert.ok(stopped !== null && stopped - 165 < 400, `settled after ${stopped - 165} ms`);
    }
    near(ends[0].early.u, ends[2].early.u, 1e-9, 'u at 30 and 144 Hz'); near(ends[0].early.yaw, ends[2].early.yaw, 1e-9, 'yaw at 30 and 144 Hz');
    const rested = new CameraMotion(), c = drag(rested);
    rested.stop();
    for (let t = 0; t <= 160; t += 16) rested.track({ ...base, u: base.u + 0.002 * (t / 16) }, t);
    rested.release(c, 260);
    assert.equal(rested.moving, false, 'a pointer that came to rest before it let go does not coast');
    const reduced = new CameraMotion();
    for (let t = 0; t <= 160; t += 16) reduced.track({ ...base, u: base.u + 0.002 * (t / 16) }, t);
    reduced.release(c, 165, false);
    assert.equal(reduced.moving, false, 'no coast for a player who asks for reduced motion');
  });

  check('held keys turn, tip and move at their rates at any frame rate, ease out when let go and stop on blur', () => {
    assert.equal(KEY_ACTIONS.KeyQ, 'turnLeft'); assert.equal(KEY_ACTIONS.KeyE, 'turnRight'); assert.equal(KEY_ACTIONS.KeyR, 'tiltUp'); assert.equal(KEY_ACTIONS.ArrowUp, 'forward');
    const hold = (action, seconds, hz, c = base) => {
      const m = new CameraMotion();
      m.key(action, true, 0);
      const held = run(m, c, 0, seconds, hz).c;
      m.key(action, false, seconds * 1000);
      const { c: after, stopped } = run(m, held, seconds * 1000, 1, hz);
      return { held, after, stopped: stopped - seconds * 1000 };
    };
    const q60 = hold('turnLeft', 1, 60), q144 = hold('turnLeft', 1, 144);
    const degrees = (-q60.held.yaw * 180) / Math.PI;
    assert.ok(degrees > 88 && degrees < 100, `Q for a second turns ${degrees.toFixed(1)} degrees`);
    assert.ok(Math.abs(q60.held.yaw - q144.held.yaw) < (1.5 * Math.PI) / 180, 'the same at 60 and 144 Hz');
    const coast = ((q60.held.yaw - q60.after.yaw) * 180) / Math.PI;
    assert.ok(coast > 2 && coast < 10 && q60.stopped < 500, `let go, it eases out over ${coast.toFixed(1)} degrees in ${q60.stopped} ms`);
    const r = hold('tiltUp', 0.5, 60, { ...base, pitch: 0.5 });
    near(r.held.pitch - 0.5, (45 * Math.PI) / 180 * 0.5, 0.05, 'R tips about 45 degrees a second');
    assert.equal(hold('tiltUp', 3, 60).held.pitch, LIMITS.maxPitch, 'within the limits');
    // Forward is the way the view faces: north at yaw 0, west with the eye in the east; half as far from half as high.
    const north = hold('forward', 0.5, 60), west = hold('forward', 0.5, 60, { ...base, yaw: Math.PI / 2 }), low = hold('forward', 0.5, 60, { ...base, distance: 0.25 });
    assert.ok(north.held.v < base.v && Math.abs(north.held.u - base.u) < 1e-9);
    assert.ok(west.held.u < base.u && Math.abs(west.held.v - base.v) < 1e-9);
    near((base.v - north.held.v) / (base.v - low.held.v), 2, 1e-6, 'speed in proportion to the distance');
    const m = new CameraMotion();
    m.key('turnRight', true, 0); m.key('forward', true, 0);
    const moving = run(m, base, 0, 0.3).c;
    m.halt();
    assert.equal(m.moving, false); assert.deepEqual(m.step(moving, screen, 400), moving, 'a blur stops everything at once');
  });

  check('the wheel eases the distance to its aim, keeps the ground under the cursor and adds up quick turns', () => {
    const c = { ...base, yaw: 0.6, pitch: 0.8 }, cursor = { x: 1100, y: 300 };
    const ground = unproject(c, screen, cursor.x, cursor.y);
    const m = new CameraMotion();
    m.zoomBy(c, 1.5, cursor.x, cursor.y, 0);
    let z = c, at50 = null, done = null;
    for (let t = 16; t <= 400; t += 16) {
      z = m.step(z, screen, t);
      const under = unproject(z, screen, cursor.x, cursor.y);
      near(under.u, ground.u, 1e-6, 'u under the cursor'); near(under.v, ground.v, 1e-6, 'v under the cursor');
      if (t === 48) at50 = z.distance;
      if (done === null && !m.moving) done = t;
    }
    assert.ok(at50 < c.distance && at50 > c.distance / 1.5, 'part of the way after 50 ms');
    near(z.distance, c.distance / 1.5, 1e-12, 'there at the end'); assert.ok(done >= 100 && done <= 260, `settled after ${done} ms`);
    const twice = new CameraMotion();
    twice.zoomBy(c, 1.2, 800, 450, 0); const between = twice.step(c, screen, 8); twice.zoomBy(between, 1.2, 800, 450, 10);
    near(run(twice, between, 10, 0.5).c.distance, c.distance / 1.44, 1e-12, 'two quick turns of the wheel add up');
    const far = new CameraMotion();
    far.zoomBy(c, 100, 800, 450, 0);
    const { c: closest, stopped } = run(far, c, 0, 1);
    near(closest.distance, LIMITS.minDistance, 1e-12, 'held at the closest'); assert.ok(stopped !== null, 'and done');
  });

  console.log(`${passed} world camera regressions passed`);
} finally {
  await server.close();
}
