// The settlements' sites of the campaign map (캠페인): one SiteRecord per on-map region, solved over the drawn terrain by
// src/ui/grand/settle/solver.ts and written to public/ui/grand_sites.json, with their pads levelled into
// public/ui/grand_terrain.bin (scripts/build-grand-terrain.mjs). See src/ui/grand/settle/README.md.
//
//   node scripts/build-grand-sites.mjs                   solves the sites, rebuilds the terrain with their pads, writes both
//   node scripts/build-grand-sites.mjs --check           solves them again in memory and fails unless both files match and
//                                                        every site passes the gates
//   node scripts/build-grand-sites.mjs --preview=<dir>   also writes a top-down plan of every site
//
// How: the first pass of the solver chooses the pads over the land as the terrain build fits it; the terrain is built with
// them; the second pass lays everything else out on the ground as the map will draw it; then the gates are checked on
// that same ground, the ground works included. The sites file records the SHA-256 of the terrain it was solved against.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildGrandTerrain, drawnHeights, importTs, PAD, prepareTerrain, readDem, seaGuard } from './build-grand-terrain.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITES = 'public/ui/grand_sites.json';
const TERRAIN = 'public/ui/grand_terrain.bin';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));

const S = await importTs([
  `export * from './src/ui/grand/settle/solver.ts';`,
  `export * from './src/ui/grand/settle/lots.ts';`,
  `export * from './src/ui/grand/settle/types.ts';`,
].join('\n'));

const t0 = performance.now();
const seconds = () => ((performance.now() - t0) / 1000).toFixed(1);
const dem = await readDem();
const { width: W, height: H } = dem;
const { land, target } = prepareTerrain(dem);
const fitted = { W, H, land, target, guard: seaGuard(W, H, land), pad: PAD };
const { plans, failures } = S.planPads(fitted);
console.log(`pads of ${plans.length} sites planned; ${seconds()} s`);
for (const failure of failures) console.error(`FAIL ${failure}`);
if (args.verbose) {
  const frame = new S.Frame(W, H);
  for (const plan of plans) {
    const core = plan.pads[0];
    const cut = [];
    for (let z = -45; z <= 45; z += 1.5) for (let x = -45; x <= 45; x += 1.5) {
      if (S.inside(core.poly, x, z)) cut.push(frame.bilinear(target, plan.X + x, plan.Z + z) * S.ELEVATION_METRE - core.h0);
    }
    const mean = cut.reduce((n, d) => n + Math.abs(d), 0) / cut.length;
    console.log(`${plan.port.id.padEnd(14)} v${plan.port.value} ${Math.hypot(plan.X - plan.port.X, plan.Z - plan.port.Z).toFixed(0).padStart(4)} m off, area ${(cut.length * 2.25).toFixed(0).padStart(5)} m2, h0 ${core.h0.toFixed(2)}, earth ${mean.toFixed(2)} (cut ${Math.max(...cut).toFixed(1)}, fill ${(-Math.min(...cut)).toFixed(1)}), works h0 ${plan.pads.slice(1).map((p) => `${p.id} ${p.h0}`).join(', ')}`);
  }
}

if (args.preview) await preview(args.preview);
if (failures.length) process.exit(1);

/** A plan of every site over its ground, north up, for a person to look at, and the whole map with every pad. */
async function preview(dir) {
  await mkdir(dir, { recursive: true });
  const frame = new S.Frame(W, H);
  {
    const img = Buffer.alloc(W * H * 3);
    for (let i = 0; i < W * H; i += 1) {
      const sea = land[i] === 0, t = Math.min(1, Math.max(0, target[i]) / 400);
      img[i * 3] = sea ? 40 : 110 + 100 * t; img[i * 3 + 1] = sea ? 70 : 140 + 80 * t; img[i * 3 + 2] = sea ? 120 : 90 + 100 * t;
    }
    const svg = [];
    const tx = (X) => (X * frame.kx).toFixed(1), ty = (Z) => (Z * frame.kz).toFixed(1);
    for (const port of S.solveOrder(frame)) {
      const plan = plans.find((p) => p.port.id === port.id);
      if (plan) {
        for (const pad of plan.pads) svg.push(`<polygon points="${pad.poly.map(([x, z]) => `${tx(x + plan.X)},${ty(z + plan.Z)}`).join(' ')}" fill="#fff" fill-opacity="0.6" stroke="#000" stroke-width="0.8"/>`);
        svg.push(`<line x1="${tx(port.X)}" y1="${ty(port.Z)}" x2="${tx(plan.X)}" y2="${ty(plan.Z)}" stroke="#ff0" stroke-width="1.5"/>`);
      }
      svg.push(`<circle cx="${tx(port.X)}" cy="${ty(port.Z)}" r="4" fill="${plan ? '#fff' : '#f00'}" stroke="#c00" stroke-width="1.5"/><text x="${tx(port.X + 5)}" y="${ty(port.Z - 5)}" font-size="11" font-family="sans-serif" fill="#fff" stroke="#000" stroke-width="0.4">${port.id}</text>`);
    }
    const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg.join('')}</svg>`);
    await sharp(img, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: overlay }]).jpeg({ quality: 82 }).toFile(join(dir, `_map.jpg`));
  }
  const PX = 2.5;
  for (const plan of plans) {
    const half = 150;
    const N = Math.round(2 * half * PX);
    const at = (x, z) => frame.bilinear(target, plan.X + x, plan.Z + z) * S.ELEVATION_METRE;
    const sea = (x, z) => land[frame.texel(plan.X + x, plan.Z + z)] === 0;
    const img = Buffer.alloc(N * N * 3);
    for (let j = 0; j < N; j += 1) for (let i = 0; i < N; i += 1) {
      const x = i / PX - half, z = j / PX - half, o = (j * N + i) * 3;
      if (sea(x, z)) { img[o] = 52; img[o + 1] = 92; img[o + 2] = 150; continue; }
      const h = at(x, z), hx = at(x + 1, z) - at(x - 1, z), hz = at(x, z + 1) - at(x, z - 1);
      const shade = 0.82 + Math.max(-0.3, Math.min(0.3, (-hx - hz) * 0.6));
      const t = Math.min(1, h / 8);
      let r = (120 + 70 * t) * shade, g = (150 + 40 * t) * shade, b = (95 + 60 * t) * shade;
      if (Math.floor(h / 0.5) !== Math.floor(at(x + 0.4, z) / 0.5) || Math.floor(h / 0.5) !== Math.floor(at(x, z + 0.4) / 0.5)) { r *= 0.7; g *= 0.7; b *= 0.7; }
      img[o] = r; img[o + 1] = g; img[o + 2] = b;
    }
    const X = (x) => ((x + half) * PX).toFixed(1), Z = (z) => ((z + half) * PX).toFixed(1);
    const svg = [];
    const poly = (pts, attrs, closed = true) => svg.push(`<${closed ? 'polygon' : 'polyline'} points="${pts.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" ${attrs}/>`);
    for (const other of plans) {
      const ox = other.X - plan.X, oz = other.Z - plan.Z;
      if (Math.hypot(ox, oz) > half * 2) continue;
      for (const p of other.pads) poly(p.poly.map(([x, z]) => [x + ox, z + oz]), `fill="#e8dcc0" fill-opacity="${p.id === 'core' ? 0.45 : 0.7}" stroke="${other === plan ? '#fff' : '#f0a'}" stroke-width="2" stroke-dasharray="5 3"`);
      const m = [other.port.X - plan.X, other.port.Z - plan.Z];
      svg.push(`<circle cx="${X(m[0])}" cy="${Z(m[1])}" r="7" fill="#fff" stroke="#c00" stroke-width="3"/><text x="${X(m[0] + 4)}" y="${Z(m[1] - 4)}" font-size="18" font-family="sans-serif" fill="#fff" stroke="#000" stroke-width="0.6">${other.port.id}</text>`);
    }
    const s = [Math.sin(plan.rot), Math.cos(plan.rot)];
    svg.push(`<line x1="${X(0)}" y1="${Z(0)}" x2="${X(s[0] * 50)}" y2="${Z(s[1] * 50)}" stroke="#ff0" stroke-width="3"/>`);
    for (const [kind, w] of Object.entries(plan.works)) {
      const c = S.boxCorners(w);
      poly(c, `fill="#30c0c0" fill-opacity="0.4" stroke="#007a7a" stroke-width="2"`);
      svg.push(`<text x="${X(w.x)}" y="${Z(w.z)}" font-size="16" font-family="sans-serif" fill="#003" text-anchor="middle">${kind}</text>`);
    }
    svg.push(`<text x="12" y="26" font-size="20" font-family="sans-serif" fill="#fff" stroke="#000" stroke-width="0.6">${plan.port.id}: value ${plan.port.value}${plan.port.seat ? ', seat' : ''}, pad h0 ${plan.pads[0].h0}</text>`);
    const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}">${svg.join('')}</svg>`);
    await sharp(img, { raw: { width: N, height: N, channels: 3 } }).composite([{ input: overlay }]).resize(Math.min(N, 750)).jpeg({ quality: 80 }).toFile(join(dir, `${plan.port.id}.jpg`));
  }
  console.log(`plans in ${dir}; ${seconds()} s`);
}
