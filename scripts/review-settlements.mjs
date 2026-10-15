// The campaign map's settlements, every on-map port the same way every run: for each navy a war in which it holds every
// port with camps at level 1, 2 or 3 and the works its plots allow, and one with no camps at all for the towns by the
// region's value. Each port is pictured from fixed camera poses and put on contact sheets, and the numbers a settlement
// path is held to are printed: places missing from the layout, lanes over water, the ground's rise under each building
// against its footing, the settlement layer's triangles, and the draw calls and triangles the GPU was given. Two runs
// with different labels give before and after sheets from the same poses. Edge + D3D11 (Chrome + Metal on macOS),
// WebGPU, on a running dev server.
//
//   node scripts/review-settlements.mjs --url=http://127.0.0.1:5291/ [--out=shots/review-settlements] [--label=before]
//     [--settle] [--navies=joseon,japan,ming] [--levels=1,2,3] [--towns=0] [--regions=yeosu,busan] [--poses=region,close]
//     [--overlay] [--keep] [--query=webgl=1]
//
// --keep also writes every picture at full size, <out>/<label>/<war>-<pose>-<port>.jpg, to compare one port closely;
// --query adds parameters to the page's address (webgl=1 draws through the WebGL2 backend).
//
// --settle opens the map with ?settle=1, for the settlement path that is to replace mapWorld's layout. Whichever path
// draws them, the page answers window.__map (GrandMap.tsx): layout() lists the places as SettlementSpec (mapWorld.ts):
// pieces of a kind at (x, z) radii from (u, v), turned by rot, a wall's length in `len`, optionally their half sizes in
// radii as `hx` and `hz` where FOOTPRINT does not know the kind, and lanes in grounds.lanes. The layout numbers read
// that; the GPU numbers read whatever is drawn.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { createServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
const url = new URL(args.url ?? 'http://127.0.0.1:5291/');
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Runs against a local dev server only');
const out = args.out ?? join(ROOT, 'shots/review-settlements');
const label = args.label ?? 'review';
const settle = args.settle === 'true';
const NAVIES = (args.navies ?? 'joseon,japan,ming').split(',');
const LEVELS = (args.levels ?? '1,2,3').split(',').map(Number);
const towns = args.towns !== '0';
const only = args.regions ? new Set(args.regions.split(',')) : null;
const overlay = args.overlay === 'true';
const keep = args.keep === 'true';
const VIEW = { width: 1600, height: 900 };
const SEED = 551;
/**
 * The camera poses, the same every run: distance from the place in frame units, pitch above the horizon, yaw, and the
 * screen crop round the place. At `region` a level-3 camp is about 290 px across and its town and works fit beside it;
 * `close` is a low view near enough to read single buildings.
 */
const POSES = {
  region: { distance: 0.14, pitch: 0.62, yaw: 0, crop: [800, 500] },
  close: { distance: 0.06, pitch: 0.42, yaw: 0, crop: [1000, 625] },
};
const poses = (args.poses ?? 'region').split(',').map((name) => {
  if (!POSES[name]) throw new Error(`no pose ${name}`);
  return [name, POSES[name]];
});
const THUMB = [400, 250];
const COLUMNS = 7;
/** A port's works in the review wars, one after another round the coast so every kind is built somewhere. */
const WORKS = ['shipyard', 'battery', 'dock', 'granary', 'beacon'];

await mkdir(keep ? join(out, label) : out, { recursive: true });

// The saves, made by the game's own code.
const vite = await createServer({ root: ROOT, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const { newGrand } = await vite.ssrLoadModule('/src/sim/grand/turn.ts');
const { REGIONS, REGION_ORDER, slotsOf } = await vite.ssrLoadModule('/src/sim/grand/regions.ts');
await vite.close();
const ON_MAP = REGION_ORDER.filter((id) => !REGIONS[id].edge).sort((a, b) => REGIONS[a].lon - REGIONS[b].lon);
const fresh = (player) => {
  const g = newGrand(player, SEED);
  g.phase = 'orders';
  g.events.pending = null;
  return g;
};
/** Every port the navy's, with a camp of `level` and as many works of that level as its plots allow; no fleets in the way. */
const held = (navy, level) => {
  const g = fresh(navy);
  ON_MAP.forEach((id, i) => {
    const r = g.regions[id];
    r.owner = navy;
    r.queue = [];
    const works = Array.from({ length: slotsOf(id) - 1 }, (_, k) => WORKS[(i + k) % WORKS.length]);
    r.buildings = ['camp', ...works].map((kind) => ({ kind, level, upgradeLeft: 0, hp: 1 }));
  });
  g.fleets = [];
  return g;
};
/** The opening war with every camp and work taken down: each port's town alone. */
const bare = () => {
  const g = fresh('joseon');
  for (const id of ON_MAP) {
    g.regions[id].buildings = [];
    g.regions[id].queue = [];
  }
  return g;
};
const saves = [
  ...NAVIES.flatMap((navy) => LEVELS.map((level) => ({ name: `${navy}-L${level}`, title: `${navy} camps at level ${level}`, save: held(navy, level) }))),
  ...(towns ? [{ name: 'towns', title: 'towns alone, by value', save: bare(), towns: true }] : []),
];

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const errors = [];

/** Opens the campaign on `save` with counters on the GPU calls: draws and triangles per presented frame. */
async function open(save) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((data) => {
    localStorage.setItem('imjin.grand.v1', JSON.stringify(data));
    localStorage.setItem('imjin.grand.guide.v1', '1');
    // Under WebGPU a frame starts when the canvas hands out its texture and the draws after it are that frame's; WebGL2
    // has no such moment, so there the display's frames tell its frames apart.
    const gpu = { frames: [], count: 0, ticks: 0, draws: 0, tris: 0, drawn: () => (gpu.count > 0 ? gpu.count : gpu.ticks) };
    window.__gpu = gpu;
    const close = () => {
      if (gpu.draws > 0) gpu.frames.push({ draws: gpu.draws, tris: Math.round(gpu.tris) });
      if (gpu.frames.length > 60) gpu.frames.shift();
      gpu.draws = 0;
      gpu.tris = 0;
    };
    const tick = () => {
      gpu.ticks += 1;
      if (!gpu.count) close();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const wrap = (proto, name, fn) => {
      const original = proto[name];
      proto[name] = function (...a) { fn(a); return original.apply(this, a); };
    };
    const count = (n, instances = 1) => { gpu.draws += 1; gpu.tris += ((n ?? 0) / 3) * (instances ?? 1); };
    if (window.GPUCanvasContext) wrap(GPUCanvasContext.prototype, 'getCurrentTexture', () => { close(); gpu.count += 1; });
    if (window.GPURenderPassEncoder) {
      const P = GPURenderPassEncoder.prototype;
      wrap(P, 'draw', (a) => count(a[0], a[1]));
      wrap(P, 'drawIndexed', (a) => count(a[0], a[1]));
      wrap(P, 'drawIndirect', () => count(0));
      wrap(P, 'drawIndexedIndirect', () => count(0));
    }
    if (window.WebGL2RenderingContext) {
      const P = WebGL2RenderingContext.prototype;
      wrap(P, 'drawElements', (a) => count(a[1]));
      wrap(P, 'drawArrays', (a) => count(a[2]));
      wrap(P, 'drawElementsInstanced', (a) => count(a[1], a[4]));
      wrap(P, 'drawArraysInstanced', (a) => count(a[2], a[3]));
    }
  }, save);
  const page_ = new URL('campaign', url);
  page_.searchParams.set('lang', 'en');
  if (settle) page_.searchParams.set('settle', '1');
  for (const [k, v] of new URLSearchParams(args.query ?? '')) page_.searchParams.set(k, v);
  await page.goto(page_.href, { waitUntil: 'domcontentloaded' });
  await page.locator('.g-hub__actions .g-btn--primary').click({ timeout: 90000 });
  await page.waitForFunction(() => !!window.__map, null, { timeout: 120000 });
  if (!overlay) await page.addStyleTag({ content: 'body * { visibility: hidden !important; } .gm__relief, .gm__relief * { visibility: visible !important; }' });
  await ready(page);
  return page;
}

/** Waits until the world has drawn a couple of frames with nothing left to ready: models, compiles and trees. */
async function ready(page) {
  for (let pass = 0; pass < 2; pass += 1) {
    const start = await page.evaluate(() => window.__gpu.drawn());
    await page.waitForFunction((n) => window.__gpu.drawn() >= n + 2, start, { timeout: 60000, polling: 30 });
    await page.waitForFunction(() => !window.__map.busy(), null, { timeout: 120000, polling: 50 });
  }
  await page.waitForTimeout(150);
}

/** The median draws and triangles of the last frames. */
async function gpuNow(page) {
  const frames = await page.evaluate(() => window.__gpu.frames.slice(-8));
  const median = (key) => { const v = frames.map((f) => f[key]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? 0; };
  return { draws: median('draws'), tris: median('tris') };
}

/** Where to look for a port, as a frame point: its camp, else its town, else the port itself. */
async function targetOf(page, id) {
  return page.evaluate(async (region) => {
    const layout = window.__map.layout();
    const place = layout.find((s) => s.id === region) ?? layout.find((s) => s.id === `${region}/town`);
    if (place) return { u: place.u, v: place.v };
    const r = window.__map.regions().find((x) => x.id === region);
    if (!r) return null;
    const { project } = await import('/src/ui/grand/projection.ts');
    return project(r.lon, r.lat);
  }, id);
}

/** The layout numbers, worked out in the page from what it laid out and the ground it drew. */
async function layoutNumbers(page) {
  return page.evaluate(async () => {
    const pieces = await import('/src/ui/grand/campPieces.ts');
    const world = await import('/src/ui/grand/mapWorld.ts');
    const { DEM_RECT, MESH_SCALE } = await import('/src/ui/grand/mapMath.ts');
    const { MAP_ASPECT } = await import('/src/ui/grand/projection.ts');
    const { V_SCALE } = await import('/src/select/demFrame.ts');
    const { buildCampBuilding } = await import('/src/ui/grand/campBuildings.ts');
    const { default: dem } = await import('/src/select/demMeta.json');
    const R = world.SETTLEMENT_RADIUS, metre = R / pieces.METRES_PER_RADIUS;
    const heights = window.__map.heights(), layout = window.__map.layout(), regions = window.__map.regions();
    const W = dem.width, H = dem.height, lift = V_SCALE * MESH_SCALE;
    // The ground as the buildings stand on it (MapLayer.surface): bilinear between the drawn texels.
    const at = (i, j) => Math.max(0, heights[j * W + i]) * lift;
    const surface = (u, v) => {
      const x = ((u - DEM_RECT.u) / DEM_RECT.w) * (W - 1), y = ((v - DEM_RECT.v) / DEM_RECT.h) * (H - 1);
      if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return 0;
      const x0 = Math.min(W - 2, Math.floor(x)), y0 = Math.min(H - 2, Math.floor(y)), fx = x - x0, fy = y - y0;
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx, bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
      return top + (bottom - top) * fy;
    };
    // The layout's own sea test (GrandMap's isSea).
    const sea = (u, v) => {
      const x = Math.round(((u - DEM_RECT.u) / DEM_RECT.w) * (W - 1)), y = Math.round(((v - DEM_RECT.v) / DEM_RECT.h) * (H - 1));
      if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return true;
      return heights[y * W + x] <= 0;
    };
    const frame = (s, q) => ({ u: s.u + q.x * R, v: s.v + q.z * R * MAP_ASPECT });
    // The kits: triangles at both levels of detail and how deep each footing reaches (model metres).
    const kits = new Map();
    const kit = (kind) => {
      let k = kits.get(kind);
      if (!k && pieces.FOOTPRINT[kind]) {
        const [near, far] = buildCampBuilding(kind);
        let low = 0;
        for (let i = 1; i < near.position.length; i += 3) low = Math.min(low, near.position[i]);
        k = { near: near.index.length / 3, far: far.index.length / 3, footing: -low * pieces.METRES_PER_RADIUS };
        kits.set(kind, k);
      }
      return k ?? null;
    };
    const rises = [];
    let near = 0, far = 0, instances = 0;
    for (const s of layout) for (const p of s.pieces) {
      const k = kit(p.kind);
      instances += 1;
      if (k) { near += k.near; far += k.far; }
      if (pieces.WALL_KINDS.has(p.kind) || pieces.WATER_KINDS.has(p.kind)) continue;
      const size = pieces.FOOTPRINT[p.kind];
      const hx = p.hx ?? size[0] / pieces.METRES_PER_RADIUS, hz = p.hz ?? size[1] / pieces.METRES_PER_RADIUS;
      const c = Math.cos(p.rot), sn = Math.sin(p.rot);
      let lo = Infinity, hi = -Infinity;
      for (let a = -2; a <= 2; a += 1) for (let b = -2; b <= 2; b += 1) {
        const ux = (a / 2) * hx * 0.8, wz = (b / 2) * hz * 0.8;
        const q = frame(s, { x: p.x + ux * c + wz * sn, z: p.z - ux * sn + wz * c });
        const h = surface(q.u, q.v);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      rises.push({ id: s.id, kind: p.kind, rise: (hi - lo) / metre, footing: k?.footing ?? 0 });
    }
    rises.sort((a, b) => a.rise - b.rise);
    const pct = (q) => (rises.length ? rises[Math.min(rises.length - 1, Math.floor(q * rises.length))].rise : 0);
    // Lanes: the share of each one's length over water, sampled every twentieth of a radius.
    const lanes = [];
    for (const s of layout) for (const lane of s.grounds?.lanes ?? []) {
      let length = 0, wet = 0;
      for (let i = 1; i < lane.length; i += 1) {
        const a = lane[i - 1], b = lane[i], d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 0.05));
        for (let k = 0; k < n; k += 1) {
          const t = (k + 0.5) / n, q = frame(s, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
          if (sea(q.u, q.v)) wet += d / n;
        }
        length += d;
      }
      lanes.push({ id: s.id, length, wet: length > 0 ? wet / length : 0 });
    }
    // What should stand: a town at every port on the map, a camp where one is built, every work built.
    const missing = [];
    const has = (id) => layout.some((s) => s.id === id);
    const kindsAt = (region) => new Set(layout.filter((s) => s.region === region).flatMap((s) => s.pieces.map((p) => p.kind)));
    for (const r of regions) {
      if (r.offMap) continue;
      if (!has(`${r.id}/town`)) missing.push(`${r.id}/town`);
      const camp = r.buildings.find((b) => b.kind === 'camp');
      if (camp && Math.min(camp.level, camp.maxLevel) > 0 && !has(r.id)) missing.push(`${r.id}/camp`);
      const there = kindsAt(r.id);
      for (const b of r.buildings) {
        if (b.kind === 'camp' || b.level < 1) continue;
        const kind = world.workKind(b.kind, r.owner);
        if (kind && !there.has(kind)) missing.push(`${r.id}/${b.kind}`);
      }
    }
    const kinds = new Set(layout.flatMap((s) => s.pieces.map((p) => p.kind)));
    return {
      places: { camps: layout.filter((s) => s.kind === 'camp').length, towns: layout.filter((s) => s.kind === 'town').length, beacons: layout.filter((s) => s.kind === 'beacon').length },
      missing,
      instances,
      kinds: kinds.size,
      triangles: { near, far },
      rise: {
        buildings: rises.length,
        p50: +pct(0.5).toFixed(2),
        p90: +pct(0.9).toFixed(2),
        max: +(rises.at(-1)?.rise ?? 0).toFixed(2),
        overFooting: rises.filter((r) => r.rise > r.footing).length,
        worst: rises.slice(-3).reverse().map((r) => `${r.id} ${r.kind} ${r.rise.toFixed(1)} m`),
      },
      lanes: { count: lanes.length, wet: lanes.filter((l) => l.wet > 0.1).length, worst: +Math.max(0, ...lanes.map((l) => l.wet)).toFixed(2) },
    };
  });
}

/** A label strip under a picture. */
const strip = (text, width, height = 22, size = 14) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#14181c"/><text x="6" y="${height - 6}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" fill="#e8ecef">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);

/** A contact sheet: a title and the pictures in rows under it, each with its label. */
async function sheet(file, title, items, [w, h] = THUMB) {
  const columns = Math.min(COLUMNS, Math.max(1, items.length)), rows = Math.ceil(items.length / columns);
  const cell = h + 22, top = 34;
  const parts = [{ input: strip(title, columns * w, top, 18), left: 0, top: 0 }];
  for (const [i, item] of items.entries()) {
    const x = (i % columns) * w, y = top + Math.floor(i / columns) * cell;
    parts.push({ input: await sharp(item.picture).resize(w, h, { fit: 'cover' }).toBuffer(), left: x, top: y });
    parts.push({ input: strip(item.label, w), left: x, top: y + h });
  }
  await sharp({ create: { width: columns * w, height: top + rows * cell, channels: 3, background: '#0b0d0f' } }).composite(parts).jpeg({ quality: 82 }).toFile(file);
}

const report = {};
const openings = [];
try {
  for (const { name, title, save, towns: alone } of saves) {
    const started = Date.now();
    const page = await open(save);
    const regions = await page.evaluate(() => window.__map.regions().map((r) => ({ id: r.id, value: r.value, seat: !!r.seat, offMap: !!r.offMap })));
    const values = new Map(regions.map((r) => [r.id, r]));
    openings.push({ label: `${name}: opening view`, picture: await page.screenshot({ type: 'jpeg', quality: 90 }) });
    const opening = await gpuNow(page);
    const numbers = await layoutNumbers(page);
    const pictures = new Map(poses.map(([pose]) => [pose, []]));
    const posed = [];
    let ids = ON_MAP.filter((id) => !only || only.has(id));
    // The towns' sheet runs from the richest port to the poorest.
    if (alone) ids = [...ids].sort((a, b) => values.get(b).value - values.get(a).value || REGIONS[a].lon - REGIONS[b].lon);
    for (const id of ids) {
      const target = await targetOf(page, id);
      if (!target) continue;
      for (const [pose, { distance, pitch, yaw, crop }] of poses) {
        await page.evaluate((c) => window.__map.setCamera(c), { u: target.u, v: target.v, distance, pitch, yaw });
        await ready(page);
        const centre = await page.evaluate((t) => window.__map.place(t.u, t.v), target);
        const x = Math.round(Math.min(VIEW.width - crop[0], Math.max(0, centre.x - crop[0] / 2)));
        const y = Math.round(Math.min(VIEW.height - crop[1], Math.max(0, centre.y - crop[1] / 2)));
        const picture = await page.screenshot({ type: 'jpeg', quality: 90, clip: { x, y, width: crop[0], height: crop[1] } });
        if (keep) await writeFile(join(out, label, `${name}-${pose}-${id}.jpg`), picture);
        const r = values.get(id);
        pictures.get(pose).push({ label: `${id} · value ${r.value}${r.seat ? ' · seat' : ''}`, picture });
        if (pose === poses[0][0]) posed.push(await gpuNow(page));
      }
    }
    for (const [pose, items] of pictures) await sheet(join(out, `${label}-${name}-${pose}.jpg`), `${label} · ${title} · ${pose} pose (distance ${POSES[pose].distance}, pitch ${POSES[pose].pitch})`, items);
    const most = (key) => Math.max(0, ...posed.map((g) => g[key]));
    report[name] = { ...numbers, gpu: { opening, regionMost: { draws: most('draws'), tris: most('tris') } } };
    const n = report[name];
    console.log(`${name}: ${n.places.camps} camps, ${n.places.towns} towns, ${n.places.beacons} beacons; missing ${n.missing.length}${n.missing.length ? ` (${n.missing.slice(0, 8).join(', ')}${n.missing.length > 8 ? ', ...' : ''})` : ''}`);
    console.log(`  settlement layer: ${n.instances} instances of ${n.kinds} kinds, ${n.triangles.near} near / ${n.triangles.far} far triangles`);
    console.log(`  ground rise under ${n.rise.buildings} buildings: p50 ${n.rise.p50} m, p90 ${n.rise.p90} m, max ${n.rise.max} m, ${n.rise.overFooting} beyond their footing (worst ${n.rise.worst.join('; ')})`);
    console.log(`  lanes: ${n.lanes.count}, ${n.lanes.wet} with over a tenth of their length on water, worst ${Math.round(n.lanes.worst * 100)}%`);
    console.log(`  GPU per frame: opening ${opening.draws} draws / ${opening.tris} triangles; region pose at most ${n.gpu.regionMost.draws} draws / ${n.gpu.regionMost.tris} triangles (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    await page.context().close();
  }
  await sheet(join(out, `${label}-openings.jpg`), `${label} · opening views`, openings, [800, 450]);
  await writeFile(join(out, `${label}-numbers.json`), JSON.stringify(report, null, 2));
  if (errors.length) {
    console.log(`page errors:\n${[...new Set(errors)].slice(0, 20).join('\n')}`);
    process.exitCode = 1;
  }
  console.log(`sheets and numbers in ${out}`);
} finally {
  await browser.close();
}
