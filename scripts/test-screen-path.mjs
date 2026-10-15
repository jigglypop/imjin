// The campaign map's lanes and fleet ways cut to the screen (src/ui/grand/screenPath.ts). Pure maths; no browser.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
let passed = 0;
const check = (name, run) => { run(); passed++; console.log('ok   ' + name); };
try {
  const { cutCurve } = await server.ssrLoadModule('/src/ui/grand/screenPath.ts');
  const screen = { x0: -48, y0: -48, x1: 1968, y1: 1128 };
  const at = (a, c, b, t) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
  const numbers = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);
  /** The curve's length from its start to `t`, by summing a fine polyline. */
  const length = (a, c, b, t, steps = 100000) => {
    let sum = 0, p = a;
    for (let i = 1; i <= steps; i++) { const q = at(a, c, b, (t * i) / steps); sum += Math.hypot(q.x - p.x, q.y - p.y); p = q; }
    return sum;
  };
  /** Where along the uncut curve the point nearest `p` lies, and how far `p` is from it: the nearest of a fine sampling, refined. */
  const tOf = (a, c, b, p) => {
    const away = (t) => { const q = at(a, c, b, t); return Math.hypot(q.x - p.x, q.y - p.y); };
    let bt = 0;
    for (let i = 0; i <= 20000; i++) if (away(i / 20000) < away(bt)) bt = i / 20000;
    let lo = Math.max(0, bt - 1 / 20000), hi = Math.min(1, bt + 1 / 20000);
    for (let i = 0; i < 80; i++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (away(m1) < away(m2)) hi = m2; else lo = m1;
    }
    return { t: (lo + hi) / 2, off: away((lo + hi) / 2) };
  };
  // A close view: a lane between two ports tens of thousands of pixels off either side of the screen.
  const a = { x: -40000, y: 500 }, c = { x: 960, y: 300 }, b = { x: 42000, y: 700 };

  check('a curve on the screen is drawn whole, one off it not at all', () => {
    const inside = cutCurve({ x: 100, y: 100 }, { x: 500, y: 300 }, { x: 900, y: 200 }, screen);
    assert.deepEqual(numbers(inside.d), [100, 100, 500, 300, 900, 200]);
    assert.equal(inside.skipped, 0);
    assert.equal(inside.end, true);
    assert.equal(cutCurve({ x: 3000, y: 3000 }, { x: 4000, y: 3000 }, { x: 5000, y: 3500 }, screen), null);
    // Its control triangle crosses the screen but the curve itself passes below it.
    assert.equal(cutCurve({ x: -5000, y: -5000 }, { x: -3000, y: 6000 }, { x: 8000, y: 9000 }, screen), null);
  });

  check('a curve far past the screen is cut to the screen, and the cut lies on the curve', () => {
    const cut = cutCurve(a, c, b, screen);
    const [x0, y0, cx, cy, x1, y1] = numbers(cut.d);
    assert.ok(x0 >= screen.x0 - 1 && x1 <= screen.x1 + 1, `${x0}..${x1}`);
    assert.equal(cut.end, false);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = at({ x: x0, y: y0 }, { x: cx, y: cy }, { x: x1, y: y1 }, t);
      assert.ok(tOf(a, c, b, p).off < 0.3, `the cut curve at ${t} strays from the lane`);
    }
  });

  check('the length cut off is what lines the dashes up (stroke-dashoffset)', () => {
    const cut = cutCurve(a, c, b, screen);
    const [x0, y0] = numbers(cut.d);
    const start = tOf(a, c, b, { x: x0, y: y0 }).t;
    assert.ok(Math.abs(cut.skipped - length(a, c, b, start)) < 1, `${cut.skipped} against ${length(a, c, b, start)}`);
  });

  check('with a dash period the cut starts on a whole period of the uncut curve, so animated dashes line up', () => {
    const cut = cutCurve(a, c, b, screen, 14);
    assert.equal(cut.skipped, 0);
    const [x0, y0] = numbers(cut.d);
    const along = length(a, c, b, tOf(a, c, b, { x: x0, y: y0 }).t);
    const off = along % 14;
    assert.ok(Math.min(off, 14 - off) < 0.5, `starts ${off.toFixed(2)} px into a period`);
    assert.ok(x0 < screen.x0 && x0 > screen.x0 - 20, 'no more than a period before the screen');
  });

  check('a curve whose end is on the screen keeps its end, for the arrowhead', () => {
    const cut = cutCurve({ x: -30000, y: 400 }, { x: -14000, y: 200 }, { x: 900, y: 500 }, screen);
    assert.equal(cut.end, true);
    const n = numbers(cut.d);
    assert.deepEqual(n.slice(4), [900, 500]);
  });

  console.log(`${passed} screen path regressions passed`);
} finally {
  await server.close();
}
