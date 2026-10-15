// The hit test of the campaign map's drag-select box: pure geometry on the markers' own pixels, checked on an overview,
// a close, a rotated and a half-turned view of the world camera, with real ports.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name, e); } };
try {
  const { boxBetween, markersInBox } = await vite.ssrLoadModule('/src/ui/grand/boxSelect.ts');
  const { projectFrame, screenFrame } = await vite.ssrLoadModule('/src/ui/grand/worldCamera.ts');
  const { project } = await vite.ssrLoadModule('/src/ui/grand/projection.ts');
  const { REGIONS } = await vite.ssrLoadModule('/src/sim/grand/regions.ts');
  const ports = ['yeosu', 'hansan', 'noryang', 'busan', 'sacheon'].map((id) => ({ id, ...project(REGIONS[id].lon, REGIONS[id].lat) }));
  // The same projection GrandMap places its markers with.
  const screen = screenFrame(1600, 900, { top: 0, right: 0, bottom: 0, left: 0 });
  const place = (cam) => ports.map((p) => { const q = projectFrame(cam, screen, p.u, p.v, 0); return { id: p.id, x: q.x, y: q.y }; });
  const around = (ms, ids, pad = 6) => {
    const mine = ms.filter((m) => ids.includes(m.id));
    return boxBetween(Math.min(...mine.map((m) => m.x)) - pad, Math.min(...mine.map((m) => m.y)) - pad, Math.max(...mine.map((m) => m.x)) + pad, Math.max(...mine.map((m) => m.y)) + pad);
  };

  check('boxBetween orders the corners whichever way the drag went', () => {
    assert.deepEqual(boxBetween(10, 80, 4, 20), { x0: 4, y0: 20, x1: 10, y1: 80 });
    assert.deepEqual(boxBetween(4, 20, 10, 80), { x0: 4, y0: 20, x1: 10, y1: 80 });
  });
  check('a box takes the markers whose centre is inside, edges included, in the order given', () => {
    const ms = [{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 50, y: 50 }, { id: 'c', x: 100, y: 10 }, { id: 'd', x: 50.5, y: 50 }];
    assert.deepEqual(markersInBox({ x0: 0, y0: 0, x1: 50, y1: 50 }, ms), ['a', 'b']);
    assert.deepEqual(markersInBox({ x0: 0, y0: 0, x1: 120, y1: 60 }, ms), ['a', 'b', 'c', 'd']);
    assert.deepEqual(markersInBox({ x0: 200, y0: 200, x1: 300, y1: 300 }, ms), []);
    assert.deepEqual(markersInBox({ x0: 10, y0: 10, x1: 10, y1: 10 }, ms), ['a']);
    assert.deepEqual(markersInBox({ x0: 0, y0: 0, x1: 50, y1: 50 }, []), []);
  });
  for (const [label, cam] of [
    ['an overview', { u: 0.58, v: 0.5, distance: 0.9, yaw: 0, pitch: 0.9 }],
    ['a close view', { u: 0.6, v: 0.52, distance: 0.12, yaw: 0, pitch: 0.7 }],
    ['a rotated view', { u: 0.6, v: 0.5, distance: 0.4, yaw: 1.1, pitch: 0.8 }],
    ['a view turned half way round', { u: 0.6, v: 0.5, distance: 0.5, yaw: Math.PI, pitch: 0.5 }],
  ]) {
    check(`the box selects exactly the ports drawn inside it on ${label}`, () => {
      const ms = place(cam);
      for (const ids of [['yeosu'], ['yeosu', 'hansan'], ['yeosu', 'hansan', 'noryang'], ['busan']]) {
        const box = around(ms, ids);
        const expected = ms.filter((m) => m.x >= box.x0 && m.x <= box.x1 && m.y >= box.y0 && m.y <= box.y1).map((m) => m.id);
        assert.ok(ids.every((id) => expected.includes(id)));
        assert.deepEqual(markersInBox(box, ms), expected);
      }
      assert.ok(!markersInBox(around(ms, ['yeosu'], 1), ms).includes('busan'));
    });
  }
  check('rotating the view changes which ports a fixed screen box catches', () => {
    const cam = { u: 0.6, v: 0.5, distance: 0.4, yaw: 0, pitch: 0.8 };
    const flat = place(cam);
    const turned = place({ ...cam, yaw: 1.4 });
    const box = around(flat, ['yeosu', 'hansan']);
    assert.ok(markersInBox(box, flat).includes('yeosu'));
    assert.notDeepEqual(markersInBox(box, turned), markersInBox(box, flat));
  });
} finally {
  await vite.close();
}
if (failed) { console.error(failed + ' failed'); process.exit(1); }
