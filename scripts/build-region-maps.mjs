// Finds the capture points of every campaign region's battle on the real terrain and writes
// src/sim/grand/regionPoints.json. Each region keeps the anchors of src/sim/grand/coast.ts (the port's waters, the sea
// bearing, the span between the home ports); this walks the heightmap from there:
//   the defender's port: the nearest open water that has a shore with room for four works;
//   the attacker's anchorage: about `span` metres out toward the sea, in open water, by a shore of its own;
//   the centre: open water at the middle of the line between the two, for the contested channel;
//   up to two flanks: coastal water off to the sides of that line, for the headlands.
// The centre and the flanks lie on the perpendicular bisector of the two ports, so each is the same distance from both.
// The search is a fixed spiral over the heightmap, so the output is the same on every run.
//   node scripts/build-region-maps.mjs [region ...] [--preview=<dir>] [--check]
// `--preview` writes a top-down png of each region's battle area with its points; `--check` only verifies the file.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const preview = args.find((a) => a.startsWith('--preview='))?.slice(10);
const check = args.includes('--check');
const only = args.filter((a) => !a.startsWith('--'));
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
const { generateHeightmap } = await load('/src/terrain/generate.ts');
const { findSite, placeSlots, findSpawn } = await load('/src/sim/conquest.ts');
const { REGION_SITES } = await load('/src/sim/grand/coast.ts');
const { REGION_ORDER } = await load('/src/sim/grand/regions.ts');

const FILE = join(root, 'src/sim/grand/regionPoints.json');
const heightmaps = new Map();
function landOf(spec) {
  let h = heightmaps.get(spec.seed + ':' + spec.size);
  if (!h) {
    h = generateHeightmap(spec);
    heightmaps.set(spec.seed + ':' + spec.size, h);
  }
  const { size, res } = spec;
  return (sx, sz) => {
    const fx = ((sx + size / 2) / size) * res - 0.5;
    const fz = ((sz + size / 2) / size) * res - 0.5;
    const x0 = Math.max(0, Math.min(res - 2, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(res - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const tz = Math.max(0, Math.min(1, fz - z0));
    const a = h[z0 * res + x0];
    const b = h[z0 * res + x0 + 1];
    const c = h[(z0 + 1) * res + x0];
    const d = h[(z0 + 1) * res + x0 + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };
}

const R_HOME = 260;
const R_CENTRE = 340;
const R_FLANK = 220;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Water all round: the point and a ring of eight around it at `r` metres are at least 6 m deep. */
const clear = (L, x, z, r) => L(x, z) < -8 && Array.from({ length: 8 }, (_, k) => (k / 8) * Math.PI * 2).every((a) => L(x + Math.cos(a) * r, z + Math.sin(a) * r) < -6);

/** Shore within `reach` metres: a dry sample in any of sixteen directions. */
function shoreNear(L, x, z, reach) {
  for (let d = 40; d <= reach; d += 40) {
    for (let k = 0; k < 16; k += 1) {
      const a = (k / 16) * Math.PI * 2;
      if (L(x + Math.cos(a) * d, z + Math.sin(a) * d) > 3) return d;
    }
  }
  return null;
}

/** Candidates around a point in a fixed spiral, nearest first. */
function* spiral(x, z, reach, step) {
  yield { x, z };
  for (let ring = 1; ring * step <= reach; ring += 1) {
    const n = Math.max(8, Math.round((ring * 2 * Math.PI) / 1));
    const count = Math.min(n, 6 * ring);
    for (let k = 0; k < count; k += 1) {
      const a = (k / count) * Math.PI * 2 + ring * 0.7;
      yield { x: x + Math.cos(a) * ring * step, z: z + Math.sin(a) * ring * step };
    }
  }
}

/** Room for four works on the shore by (x, z), however the engine turns the map to the light: the search runs on the turned heightmap. */
function roomFor4(L, x, z, maxShore) {
  for (let k = 0; k < 24; k += 1) {
    const axis = (k / 24) * Math.PI * 2 + 0.3;
    const ca = Math.cos(axis);
    const sa = Math.sin(axis);
    const turned = (wx, wz) => L(wx * ca + wz * sa, -wx * sa + wz * ca);
    const wx = x * ca - z * sa;
    const wz = x * sa + z * ca;
    const site = findSite(turned, wx, wz, R_HOME);
    if (!site || Math.hypot(site.x - wx, site.z - wz) > maxShore) return false;
    if (placeSlots(turned, site.x, site.z, Math.atan2(wz - site.z, wx - site.x), 4).length < 4) return false;
  }
  return true;
}

/** A home port: open water with a shore close by that has room for four works. Returns null if there is none. */
function homeSpot(L, x, z, reach, maxShore) {
  let best = null;
  for (const c of spiral(x, z, reach, 30)) {
    if (!clear(L, c.x, c.z, 90)) continue;
    const site = findSite(L, c.x, c.z, R_HOME);
    if (!site || Math.hypot(site.x - c.x, site.z - c.z) > maxShore) continue;
    if (!roomFor4(L, c.x, c.z, maxShore)) continue;
    const d = Math.hypot(c.x - x, c.z - z) + 0.5 * Math.hypot(site.x - c.x, site.z - c.z);
    if (!best || d < best.d) best = { x: c.x, z: c.z, d };
    if (d < 40) break;
  }
  return best;
}

/** How much of the straight line between two points is open water: the fleets sail it, so a point behind a headland would not be a fair prize. */
function wetShare(L, a, b) {
  let wet = 0;
  const n = 40;
  for (let i = 0; i <= n; i += 1) if (L(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n) < -6) wet += 1;
  return wet / (n + 1);
}

function layout(id, L) {
  const site = REGION_SITES[id];
  const defender = homeSpot(L, site.port.x, site.port.z, 1500, 300);
  if (!defender) throw new Error(`${id}: no port with room for works near ${site.port.x},${site.port.z}`);
  // The attacker's anchorage: out toward the sea, as near the span as the shore allows, by a shore of its own.
  let attacker = null;
  // A shore of its own close by if there is one; failing that, the nearest shore the works can be built on.
  for (const maxShore of [420, 1000]) {
    for (const turn of [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6, 0.8, -0.8, 1, -1, 1.25, -1.25]) {
      for (const span of [0, 60, -60, 120, -120, 180, -180]) {
        const a = site.seaward + turn;
        const sp = site.span + span;
        const spot = homeSpot(L, defender.x + Math.cos(a) * sp, defender.z + Math.sin(a) * sp, 220, maxShore);
        if (!spot || wetShare(L, defender, spot) < 0.97) continue;
        const gap = dist(defender, spot);
        if (gap < site.span * 0.85 || gap > site.span * 1.2) continue;
        attacker = spot;
        break;
      }
      if (attacker) break;
    }
    if (attacker) break;
  }
  if (!attacker) throw Object.assign(new Error(`${id}: no anchorage for the attacker toward ${site.seaward} from ${defender.x.toFixed(0)},${defender.z.toFixed(0)}`), { partial: [{ role: 'defender', ...defender, r: R_HOME, value: 2 }] });
  const round = (v) => Math.round(v / 10) * 10;
  for (const home of [attacker, defender]) {
    home.x = round(home.x);
    home.z = round(home.z);
  }
  const points = [
    { role: 'attacker', ...attacker, r: R_HOME, value: 2 },
    { role: 'defender', ...defender, r: R_HOME, value: 2 },
  ];
  // The computer fights by distance and sails for whichever prize is nearest, so a point a few tens of metres nearer to one
  // port hands that side the battle. The middle and the flanks therefore lie exactly on the line that cuts the two home
  // ports in half: every contested water is the same distance from both.
  const gap = dist(attacker, defender);
  const mid = { x: (attacker.x + defender.x) / 2, z: (attacker.z + defender.z) / 2 };
  const normal = { x: -(defender.z - attacker.z) / gap, z: (defender.x - attacker.x) / gap };
  const onBisector = (t) => ({ x: Math.round(mid.x + normal.x * t), z: Math.round(mid.z + normal.z * t) });
  const apart = (c, r) => points.every((p) => dist(c, p) >= p.r + r - 120);
  // Both fleets must be able to sail straight to a point for it to be worth fighting over.
  const reachable = (c) => wetShare(L, attacker, c) >= 0.95 && wetShare(L, defender, c) >= 0.95;
  let centre = null;
  for (const t of [0, 30, -30, 60, -60, 90, -90, 120, -120, 160, -160, 200, -200, 250, -250, 300, -300]) {
    const c = onBisector(t);
    if (clear(L, c.x, c.z, 110) && apart(c, R_CENTRE) && reachable(c)) {
      centre = c;
      break;
    }
  }
  if (!centre) throw new Error(`${id}: no open water for the middle`);
  points.push({ role: 'centre', ...centre, r: R_CENTRE, value: 2 });
  // Flanks to either side of the middle: coastal water first (a headland to hold), then open water to fight over.
  for (const side of [-1, 1]) {
    let best = null;
    for (const coastal of [true, false]) {
      for (const lateral of [560, 500, 620, 440, 680, 380, 740, 320, 800]) {
        const c = onBisector(side * lateral);
        if (!clear(L, c.x, c.z, 60) || !apart(c, R_FLANK) || !reachable(c)) continue;
        if (coastal && (shoreNear(L, c.x, c.z, 260) === null || !findSite(L, c.x, c.z, R_FLANK))) continue;
        best = c;
        break;
      }
      if (best) break;
    }
    if (best) points.push({ role: 'flank', ...best, r: R_FLANK, value: 1 });
  }
  // `site` is the shore where the point's works will stand, which the terrain keeps clear of villages and woods.
  return points.map((p) => {
    const out = { role: p.role, x: p.x, z: p.z, r: p.r, value: p.value };
    const site = findSite(L, out.x, out.z, out.r);
    return site ? { ...out, site: { x: round(site.x), z: round(site.z) } } : out;
  });
}

async function render(id, L, spec, points, dir, centre) {
  const W = 1000;
  const view = 5200;
  const cx = centre ? centre.x : (points[0].x + points[1].x) / 2;
  const cz = centre ? centre.z : (points[0].z + points[1].z) / 2;
  const buf = Buffer.alloc(W * W * 3);
  const colour = { attacker: [40, 90, 255], defender: [255, 40, 40], centre: [255, 200, 0], flank: [255, 140, 0] };
  for (let j = 0; j < W; j += 1) {
    for (let i = 0; i < W; i += 1) {
      const x = cx + (i / W - 0.5) * view;
      const z = cz + (j / W - 0.5) * view;
      const h = L(x, z);
      const k = (j * W + i) * 3;
      if (h < 0) {
        buf[k] = 30;
        buf[k + 1] = 80 + Math.max(-50, h);
        buf[k + 2] = 150;
      } else {
        const t = Math.min(1, h / 250);
        buf[k] = 100 + t * 110;
        buf[k + 1] = 150 + t * 40;
        buf[k + 2] = 80 + t * 80;
      }
      const gx = Math.abs((((x % 500) + 500) % 500));
      if (gx < view / W || 500 - gx < view / W || Math.abs((((z % 500) + 500) % 500)) < view / W || 500 - Math.abs((((z % 500) + 500) % 500)) < view / W) {
        buf[k] = buf[k] * 0.8 + 40;
        buf[k + 1] = buf[k + 1] * 0.8 + 40;
        buf[k + 2] = buf[k + 2] * 0.8 + 40;
      }
      for (const p of points) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (Math.abs(d - p.r) < view / W * 1.2 || d < view / W * 4) {
          const c = colour[p.role];
          buf[k] = c[0];
          buf[k + 1] = c[1];
          buf[k + 2] = c[2];
        }
      }
    }
  }
  await sharp(buf, { raw: { width: W, height: W, channels: 3 } }).png().toFile(join(dir, `region_${id}.png`));
}

const result = {};
const wanted = only.length ? only : REGION_ORDER;
let existing = {};
try {
  existing = JSON.parse(await readFile(FILE, 'utf8'));
} catch {
  existing = {};
}
let failed = 0;
for (const id of wanted) {
  const site = REGION_SITES[id];
  const L = landOf(site.terrain);
  try {
    const points = layout(id, L);
    result[id] = points;
    const d = dist(points[0], points[1]);
    console.log(`${id.padEnd(12)} ${points.length} points · homes ${d.toFixed(0)} m apart · ${points.map((p) => `${p.role[0]}${p.x},${p.z}`).join('  ')}`);
    if (preview) await render(id, L, site.terrain, points, preview);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${e.message}`);
    if (preview && e.partial) await render(id, L, site.terrain, e.partial, preview, site.port);
  }
}
if (check) {
  const same = wanted.every((id) => JSON.stringify(existing[id]) === JSON.stringify(result[id]));
  console.log(same && !failed ? 'regionPoints.json is current' : 'regionPoints.json is out of date: run node scripts/build-region-maps.mjs');
  await server.close();
  process.exit(same && !failed ? 0 : 1);
}
if (!failed) {
  const merged = Object.fromEntries(REGION_ORDER.map((id) => [id, result[id] ?? existing[id]]).filter(([, v]) => v));
  const rows = Object.entries(merged).map(([id, pts]) => `  "${id}": [\n${pts.map((p) => `    ${JSON.stringify(p)}`).join(',\n')}\n  ]`);
  await writeFile(FILE, `{\n${rows.join(',\n')}\n}\n`);
}
await server.close();
process.exit(failed ? 1 : 0);
