// Review renders of the campaign map's buildings (src/ui/grand/campBuildings.ts) with their atlas material, under the map's
// sun, sky and haze on green ground with the sea beyond a work's waterfront (+z). Each kind close up from the map's usual
// angle at its close level of detail, and at its far level at the size the opening view gives it. Starts its own Vite
// server and drives Edge (Chrome on macOS) with WebGPU; contact sheets go to shots/s1014/camp-kits/.
//
//   node scripts/review-camp-kits.mjs [--only=giwa,hall] [--navy=joseon] [--port=5327] [--out=<dir>]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { createServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
const OUT = args.out ?? join(ROOT, 'shots/s1014/camp-kits');
const PAGE = join(ROOT, 'shots/s1014/camp-kits/page');
const PORT = Number(args.port ?? 5327);

const PAGE_JS = `
import { AmbientLight, Color, DirectionalLight, Fog, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGPURenderer } from 'three/webgpu';
import { buildCampBuilding, KIT_KINDS } from '/src/ui/grand/campBuildings.ts';
import { navyOf, WALL_KINDS, WATER_KINDS, METRES_PER_RADIUS } from '/src/ui/grand/campPieces.ts';
import { campMaterial } from '/src/ui/grand/campMaterial.ts';
import { toGeometry } from '/src/ships/build/pack.ts';

const canvas = document.querySelector('canvas');
const renderer = new WebGPURenderer({ canvas, antialias: true });
await renderer.init();
renderer.setPixelRatio(1);
const HAZE = '#b7cadb';
const scene = new Scene();
scene.background = new Color(HAZE);
scene.fog = new Fog(HAZE, 10, 40);
// The campaign map's lights (src/ui/grand/mapLayer.ts).
const sun = new DirectionalLight('#ffe9cf', 2.1);
sun.position.set(-0.55, 0.9, 0.5);
scene.add(sun, new HemisphereLight('#cfdcec', '#2b3036', 1.5), new AmbientLight('#ffffff', 0.35));
const ground = new Mesh(new PlaneGeometry(400, 400), new MeshStandardMaterial({ color: '#6f8a4c', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
const sea = new Mesh(new PlaneGeometry(400, 400), new MeshStandardMaterial({ color: '#3f739b', roughness: 0.6 }));
sea.rotation.x = -Math.PI / 2;
scene.add(ground, sea);
const materials = {};
const material = async (navy) => (materials[navy] ??= campMaterial(navy).then((m) => m.material));
const built = {};
let shown = null;
window.kinds = KIT_KINDS.map((kind) => ({ kind, navy: navyOf(kind), wall: WALL_KINDS.has(kind), water: WATER_KINDS.has(kind) }));
window.view = async (o) => {
  const lods = (built[o.kind] ??= buildCampBuilding(o.kind));
  const geometry = toGeometry(lods[o.lod]);
  if (shown) { scene.remove(shown); shown.geometry.dispose(); }
  shown = new Mesh(geometry, await material(navyOf(o.kind)));
  // A wall is one unit long: shown at its modelled length.
  const wall = WALL_KINDS.has(o.kind);
  shown.scale.set(wall ? 10 / METRES_PER_RADIUS : 1, 1, 1);
  scene.add(shown);
  // Works in the water: the sea starts at the kit's middle (its landward end is on the shore).
  const water = WATER_KINDS.has(o.kind);
  ground.position.set(0, -0.0005, water ? -200 : 0);
  sea.position.set(0, -0.004, water ? 200 : 260);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  renderer.setSize(o.w, o.h);
  // Framed on what shows above the ground: its width, depth and height.
  const span = Math.max((box.max.x - box.min.x) * shown.scale.x, box.max.z - box.min.z, box.max.y * 1.3), fov = 32;
  const d = (span * o.h) / (2 * Math.tan((fov * Math.PI) / 360) * o.px);
  const camera = new PerspectiveCamera(fov, o.w / o.h, d * 0.02, d * 20);
  const pitch = (o.pitch * Math.PI) / 180, yaw = (o.yaw * Math.PI) / 180;
  const ty = box.max.y * 0.35;
  camera.position.set(Math.sin(yaw) * Math.cos(pitch) * d, ty + Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d);
  camera.lookAt(0, ty, 0);
  scene.fog.near = d * 3;
  scene.fog.far = d * 12;
  renderer.render(scene, camera);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  renderer.render(scene, camera);
  await new Promise((r) => requestAnimationFrame(r));
  return { triangles: lods[o.lod].index.length / 3 };
};
window.ready = true;
`;

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#222}canvas{display:block}</style></head>
<body><canvas></canvas><script type="module" src="./review.js"></script></body></html>`;

const VIEWS = [
  { name: 'close', lod: 0, yaw: 30, pitch: 38, px: 330, w: 420, h: 330 },
  { name: 'from the back', lod: 0, yaw: 210, pitch: 38, px: 330, w: 420, h: 330 },
  { name: 'far level, 60 px', lod: 1, yaw: 0, pitch: 43, px: 60, w: 100, h: 80, zoom: 3 },
];

const label = (text, w, h = 22) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#1d2024"/>` +
  `<text x="6" y="${h - 6}" font-family="Segoe UI, Arial" font-size="14" fill="#e8e4da">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);

async function row(cells) {
  const parts = [];
  for (const c of cells) {
    const meta = await sharp(c.png).metadata();
    let img = c.png, w = meta.width, h = meta.height;
    if (c.zoom > 1) { w *= c.zoom; h *= c.zoom; img = await sharp(c.png).resize(w, h, { kernel: 'nearest' }).png().toBuffer(); }
    parts.push({ img, w, h, text: c.text });
  }
  const height = Math.max(...parts.map((p) => p.h)) + 22, width = parts.reduce((n, p) => n + p.w + 6, 0);
  const composite = [];
  let x = 0;
  for (const p of parts) {
    composite.push({ input: label(p.text, p.w), left: x, top: 0 }, { input: p.img, left: x, top: 22 });
    x += p.w + 6;
  }
  return { width, height, buffer: await sharp({ create: { width, height, channels: 3, background: '#2a2d31' } }).composite(composite).png().toBuffer() };
}

async function stack(rows, file) {
  const width = Math.max(...rows.map((r) => r.width)), height = rows.reduce((n, r) => n + r.height + 8, 0);
  let y = 0;
  const composite = rows.map((r) => { const c = { input: r.buffer, left: 0, top: y }; y += r.height + 8; return c; });
  await sharp({ create: { width, height, channels: 3, background: '#2a2d31' } }).composite(composite).png().toFile(file);
}

await mkdir(PAGE, { recursive: true });
await mkdir(OUT, { recursive: true });
await writeFile(join(PAGE, 'review.js'), PAGE_JS);
await writeFile(join(PAGE, 'index.html'), PAGE_HTML);
const server = await createServer({ configFile: false, root: ROOT, logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${PORT}/shots/s1014/camp-kits/page/index.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 90000 });
  const kinds = (await page.evaluate(() => window.kinds))
    .filter((k) => (!args.only || args.only.split(',').includes(k.kind)) && (!args.navy || k.navy === args.navy));
  const byNavy = new Map();
  for (const { kind, navy } of kinds) {
    const cells = [];
    for (const v of VIEWS) {
      const info = await page.evaluate((o) => window.view(o), { kind, ...v });
      cells.push({ png: await page.locator('canvas').screenshot(), zoom: v.zoom ?? 1, text: `${kind} · ${v.name} · ${info.triangles} tris` });
    }
    if (!byNavy.has(navy)) byNavy.set(navy, []);
    byNavy.get(navy).push(await row(cells));
    console.log(kind);
  }
  for (const [navy, rows] of byNavy) {
    for (let i = 0; i < rows.length; i += 6) {
      const file = join(OUT, `${navy}-${i / 6 + 1}.png`);
      await stack(rows.slice(i, i + 6), file);
      console.log('sheet', file);
    }
  }
  if (logs.length) console.log(logs.slice(-20).join('\n'));
} finally {
  await browser.close();
  await server.close();
}
