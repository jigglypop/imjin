// Regression checks for the fleets' drums and signals (src/audio/orders.ts) and the sample bank they play
// (src/audio/samples.ts, public/audio): tempo rises with pace, the two navies drum differently, a running crew is
// silent, only a few leaders are voiced, and every file the bank names exists and is credited.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack); } };
try {
  const { beatSeconds, stroke, patternLength, modeOf, pickDrummers, MARCH_PACE } = await server.ssrLoadModule('/src/audio/orders.ts');
  const { BANK } = await server.ssrLoadModule('/src/audio/samples.ts');

  check('the advance beat quickens as the ships speed up', () => {
    const slow = beatSeconds('advance', 0.15);
    const brisk = beatSeconds('advance', 0.6);
    const full = beatSeconds('advance', 1);
    assert.ok(slow > brisk && brisk > full, `${slow} ${brisk} ${full}`);
    assert.ok(full < slow * 0.6, 'a full-speed march is well over a crawl');
  });

  check('a charge beats faster than any advance', () => {
    // The charge's beat is longer than a march's but its patterns subdivide it, so compare the mean gap between strokes.
    for (const team of ['joseon', 'japan']) {
      const gap = (mode) => { let t = 0; const n = patternLength(team, mode); for (let i = 0; i < n; i += 1) t += stroke(team, mode, i, 1).wait; return t / n; };
      assert.ok(gap('charge') < gap('advance') * 0.6, `${team} ${gap('charge')} vs ${gap('advance')}`);
    }
  });

  check('every pattern opens on its hardest stroke and never waits forever', () => {
    for (const team of ['joseon', 'japan']) {
      for (const mode of ['advance', 'charge', 'engage', 'order']) {
        const n = patternLength(team, mode);
        const gains = Array.from({ length: n }, (_, i) => stroke(team, mode, i, 0.5).gain);
        assert.equal(gains[0], Math.max(...gains), `${team} ${mode}`);
        for (let i = 0; i < n; i += 1) {
          const w = stroke(team, mode, i, 0.5).wait;
          assert.ok(w >= 0.2 && w <= 3, `${team} ${mode} step ${i}: ${w}`);
        }
        assert.deepEqual(stroke(team, mode, n, 0.5), stroke(team, mode, 0, 0.5), 'the pattern repeats');
      }
    }
  });

  check('the two navies drum differently on the march, the same on the order', () => {
    const seq = (team, mode) => Array.from({ length: 4 }, (_, i) => stroke(team, mode, i, 0.5).wait.toFixed(2)).join(',');
    assert.notEqual(seq('joseon', 'advance'), seq('japan', 'advance'));
    assert.notEqual(seq('joseon', 'charge'), seq('japan', 'charge'));
    assert.equal(seq('joseon', 'order'), seq('japan', 'order'));
  });

  check('a running crew does not drum, a ship lying to does not march', () => {
    assert.equal(modeOf('moving', 1, 'routing'), null);
    assert.equal(modeOf('charging', 1, 'routing'), null);
    assert.equal(modeOf('moving', MARCH_PACE / 2, 'steady'), null);
    assert.equal(modeOf('anchored', 1, 'steady'), null);
    assert.equal(modeOf('fleeing', 1, 'steady'), null);
    assert.equal(modeOf('moving', 0.5, 'steady'), 'advance');
    assert.equal(modeOf('charging', 0.9, 'wavering'), 'charge');
    assert.equal(modeOf('boarding', 0, 'steady'), 'charge');
    assert.equal(modeOf('engaging', 0.1, 'rallying'), 'engage');
    assert.equal(modeOf('idle', 0.6, 'steady'), 'advance', 'a client without activity infers it from speed');
    assert.equal(modeOf('idle', 0.05, 'steady'), null);
  });

  check('only the loudest few leaders are voiced, one cluster once', () => {
    const d = (id, team, x, gain) => ({ id, team, x, z: 0, gain });
    const picked = pickDrummers([d(1, 'joseon', 0, 0.9), d(2, 'joseon', 100, 0.8), d(3, 'joseon', 900, 0.5), d(4, 'joseon', 1800, 0.4), d(5, 'japan', 0, 0.3), d(6, 'japan', 2000, 0.2)], 3, 2, 250);
    assert.deepEqual(picked.map((p) => p.id), [1, 3, 5], 'ship 2 is beside ship 1; ship 4 would be a third Joseon drum');
    assert.equal(pickDrummers([d(1, 'joseon', 0, 0.9)], 0, 2, 250).length, 0);
  });

  check('every file the bank names exists and is credited', () => {
    const credits = readFileSync(join(root, 'public/audio/CREDITS.md'), 'utf8');
    for (const [kind, { count }] of Object.entries(BANK)) {
      for (let i = 1; i <= count; i += 1) {
        assert.ok(existsSync(join(root, 'public/audio', `${kind}_${i}.mp3`)), `${kind}_${i}.mp3 is missing`);
        assert.ok(credits.includes(`${kind}_${i}.mp3`), `${kind}_${i}.mp3 has no credits entry`);
      }
    }
  });
} finally {
  await server.close();
}
if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('audio orders ok');
