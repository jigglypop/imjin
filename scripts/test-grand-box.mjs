// The hit test of the campaign map's drag-select box: pure geometry on the markers' own pixels, checked on a flat,
// a zoomed and a rotated view of real ports.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name, e); } };
try {
  const { boxBetween, markersInBox } = await vite.ssrLoadModule('/src/ui/grand/boxSelect.ts');
  const { mapProject, MAP_TILT } = await vite.ssrLoadModule('/src/ui/grand/mapMath.ts');
  const { MAP_ASPECT, project } = await vite.ssrLoadModule('/src/ui/grand/projection.ts');
  const { REGIONS } = await vite.ssrLoadModule('/src/sim/grand/regions.ts');
  const ports = ['yeosu', 'hansan', 'noryang', 'busan', 'sacheon'].map((id) => ({ id, ...project(REGIONS[id].lon, REGIONS[id].lat) }));
  // The same arithmetic GrandMap uses for px() and py().
  const place = (view, pose) => ports.map((p) => { const q = mapProject(p.u, p.v, 0, pose); return { id: p.id, x: view.x + q.u * view.s, y: view.y + q.v * (view.s / MAP_ASPECT) }; });
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
  for (const [label, view, pose] of [
    ['an overview', { s: 1200, x: -120, y: -60 }, { tilt: MAP_TILT, yaw: 0 }],
    ['a zoomed view', { s: 4800, x: -2600, y: -900 }, { tilt: MAP_TILT, yaw: 0 }],
    ['a rotated view', { s: 3000, x: -1200, y: -700 }, { tilt: 0.8, yaw: 1.1 }],
    ['a view turned half way round', { s: 2000, x: -500, y: -300 }, { tilt: 0.5, yaw: Math.PI }],
  ]) {
    check(`the box selects exactly the ports drawn inside it on ${label}`, () => {
      const ms = place(view, pose);
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
    const view = { s: 3000, x: -1200, y: -700 };
    const flat = place(view, { tilt: MAP_TILT, yaw: 0 });
    const turned = place(view, { tilt: MAP_TILT, yaw: 1.4 });
    const box = around(flat, ['yeosu', 'hansan']);
    assert.ok(markersInBox(box, flat).includes('yeosu'));
    assert.notDeepEqual(markersInBox(box, turned), markersInBox(box, flat));
  });
} finally {
  await vite.close();
}
if (failed) { console.error(failed + ' failed'); process.exit(1); }
