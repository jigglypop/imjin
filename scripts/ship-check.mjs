// Builds every procedural ship in Node and prints per-LOD triangle counts, bounds against SHIP_SPECS, winding sanity
// and anchor/battery consistency.   node scripts/ship-check.mjs [kind#variant ...]
import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const dir = await mkdtemp(join(tmpdir(), 'ship-check-'));
const outfile = join(dir, 'check.mjs');
await build({
  stdin: {
    contents: `export * from './src/ships/build/ShipBuilder'; export { SHIP_SPECS } from './src/sim/catalog'; export * from './src/ships/anchors';`,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
});
const m = await import(pathToFileURL(outfile).href);

const only = process.argv.slice(2);
const keys = [];
for (const kind of m.PROCEDURAL_KINDS) {
  const variants = m.variantCount(kind);
  for (let v = 0; v < variants; v += 1) keys.push([kind, v]);
}
const BUDGET = {
  big: [[17000, 25000], [3000, 6000], [0, 1000]],
  mid: [[8000, 16000], [2500, 5500], [0, 1000]],
  small: [[4000, 8000], [1200, 2200], [0, 500]],
};
let bad = 0;
for (const [kind, variant] of keys) {
  const key = `${kind}#${variant}`;
  if (only.length && !only.includes(key) && !only.includes(kind)) continue;
  const spec = m.SHIP_SPECS[kind];
  const t0 = performance.now();
  const ship = m.buildShip(kind, variant);
  const ms = Math.round(performance.now() - t0);
  const klass = spec.length > 30 ? 'big' : spec.length > 15 ? 'mid' : 'small';
  const lines = [];
  ship.lods.forEach((d, i) => {
    const tris = d.index.length / 3;
    let lo = [1e9, 1e9, 1e9];
    let hi = [-1e9, -1e9, -1e9];
    for (let k = 0; k < d.position.length; k += 3) for (let a = 0; a < 3; a += 1) {
      lo[a] = Math.min(lo[a], d.position[k + a]);
      hi[a] = Math.max(hi[a], d.position[k + a]);
    }
    // winding: geometric normal vs vertex normal
    let wrong = 0;
    for (let t = 0; t < d.index.length; t += 3) {
      const [a, b, c] = [d.index[t], d.index[t + 1], d.index[t + 2]];
      const p = (i) => [d.position[i * 3], d.position[i * 3 + 1], d.position[i * 3 + 2]];
      const [pa, pb, pc] = [p(a), p(b), p(c)];
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const vn = [0, 1, 2].map((q) => d.normal[a * 3 + q] + d.normal[b * 3 + q] + d.normal[c * 3 + q]);
      if (n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] < -1e-9) wrong += 1;
    }
    const [min, max] = BUDGET[klass][i];
    const flag = tris < min || tris > max ? ' !budget' : '';
    if (flag) bad += 1;
    lines.push(
      `  LOD${i}: ${String(tris).padStart(6)} tris ${String(d.position.length / 3).padStart(6)} verts  x ${lo[0].toFixed(1)}..${hi[0].toFixed(1)}  y ${lo[1].toFixed(1)}..${hi[1].toFixed(1)}  z ${lo[2].toFixed(1)}..${hi[2].toFixed(1)}  inverted ${(100 * wrong / tris).toFixed(1)}%${flag}`,
    );
  });
  const a = ship.anchors;
  const perSide = [0, 1, 2].map((s) => a.gunPorts.filter((g) => g.side === s).length);
  const want = [0, 1, 2].map((s) => spec.batteries.filter((b) => b.side === s).reduce((n, b) => n + b.count, 0));
  const okGuns = perSide.every((n, i) => n === want[i]);
  if (!okGuns) bad += 1;
  console.log(`${key} (${ms} ms) length ${spec.length} beam ${spec.beam} deck ${spec.deck} height ${spec.height}`);
  console.log(lines.join('\n'));
  console.log(`  guns per side ${perSide.join('/')} wanted ${want.join('/')} ${okGuns ? 'ok' : 'MISMATCH'}; main deck ${a.mainDeck}, oar deck ${a.oarDeck}, oar ports ${a.oarPorts.length}, flags ${a.flagMounts.length}`);
}
if (bad) {
  console.log(`${bad} problem(s)`);
  process.exitCode = 1;
}
