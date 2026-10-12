// Review renders of the Meshy camp models from the campaign map's point of view: the map's warm sun, sky fill and haze
// over green-brown ground with the sea on the waterfront side (-z), each model close up from four sides and from above,
// and at the 150, 80 and 40 pixel sizes it has on the map. Starts its own Vite server and drives Edge; sheets go to
// shots/s1013/camps-meshy/ (the page it serves is written there too).
//
//   node scripts/review-camp-models.mjs                       every shipped model in public/models/camps, near and far
//   node scripts/review-camp-models.mjs --originals           the raw Meshy files, normalised in the page with the
//        [--attempt=2] [--turn=90]                            attempt and turn of the last build (provenance.json),
//                                                             or attempt 1 unturned before the first
//   node scripts/review-camp-models.mjs --only=joseon-1,ming-3 --port=5304 --out=shots/s1013/camps-meshy/try
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { createServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
const OUT = join(ROOT, args.out ?? 'shots/s1013/camps-meshy');
const PAGE = join(ROOT, 'shots/s1013/camps-meshy/page');
const PORT = Number(args.port ?? 5303);
const IDS = ['joseon-1', 'joseon-2', 'joseon-3', 'japan-1', 'japan-2', 'japan-3', 'ming-1', 'ming-2', 'ming-3'].filter((id) => !args.only || args.only.split(',').includes(id));

const PAGE_JS = `
import { AmbientLight, Box3, CanvasTexture, Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry,
  RepeatWrapping, Scene, SRGBColorSpace, Vector3, WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const canvas = document.querySelector('canvas');
const renderer = new WebGPURenderer({ canvas, antialias: true });
await renderer.init();
renderer.setPixelRatio(1);
const HAZE = '#b7cadb';
const scene = new Scene();
scene.background = new Color(HAZE);
scene.fog = new Fog(HAZE, 10, 40);
// The campaign map's camp lights (src/ui/grand/mapLayer.ts).
const sun = new DirectionalLight('#ffe9cf', 2.1);
sun.position.set(-0.55, 0.9, 0.5);
scene.add(sun, new HemisphereLight('#cfdcec', '#2b3036', 1.5), new AmbientLight('#ffffff', 0.35));

// Green-brown ground with a little noise, so a camp's base is judged against something like the map's land.
function noiseTexture(a, b, c) {
  const n = 256, el = document.createElement('canvas');
  el.width = el.height = n;
  const g = el.getContext('2d'), img = g.createImageData(n, n);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const cells = Array.from({ length: 17 * 17 }, rnd);
  const at = (x, y) => cells[(y % 16) * 17 + (x % 16)];
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
    const u = (x / n) * 16, v = (y / n) * 16, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const k = (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
    const t = Math.min(1, Math.max(0, k * 0.8 + rnd() * 0.2));
    const col = t < 0.6 ? a.map((q, m) => q + (b[m] - q) * (t / 0.6)) : b.map((q, m) => q + (c[m] - q) * ((t - 0.6) / 0.4));
    img.data.set([col[0], col[1], col[2], 255], (y * n + x) * 4);
  }
  g.putImageData(img, 0, 0);
  const tex = new CanvasTexture(el);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
const groundTex = noiseTexture([92, 116, 62], [112, 128, 70], [128, 110, 78]);
groundTex.repeat.set(100, 50);
const ground = new Mesh(new PlaneGeometry(400, 200), new MeshStandardMaterial({ map: groundTex, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
const sea = new Mesh(new PlaneGeometry(400, 200), new MeshStandardMaterial({ color: '#3f739b', roughness: 0.75 }));
sea.rotation.x = -Math.PI / 2;
scene.add(ground, sea);

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const holder = new Group();
scene.add(holder);
const cache = new Map();

async function load(url, normalize, turn) {
  const key = url + '|' + normalize + '|' + turn;
  if (cache.has(key)) return cache.get(key);
  const gltf = await loader.loadAsync(url);
  const root = new Group();
  const inner = gltf.scene;
  root.add(inner);
  let triangles = 0, meshes = 0;
  const materials = new Set(), textures = [];
  inner.traverse((o) => {
    if (!o.isMesh) return;
    meshes += 1;
    triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    materials.add(o.material);
    const map = o.material.map;
    if (map?.image) textures.push(map.image.width + 'x' + map.image.height);
  });
  if (normalize) {
    inner.rotation.y = (turn * Math.PI) / 180;
    inner.updateMatrixWorld(true);
    const box = new Box3().setFromObject(inner), size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3());
    const k = 1 / Math.max(size.x, size.z);
    inner.position.set(-centre.x * k, -box.min.y * k, -centre.z * k);
    inner.scale.setScalar(k);
  }
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const entry = { root, info: { triangles, meshes, materials: materials.size, textures, min: box.min.toArray(), max: box.max.toArray() } };
  cache.set(key, entry);
  return entry;
}

window.view = async (o) => {
  const { root, info } = await load(o.url, o.normalize, o.turn ?? 0);
  holder.clear();
  holder.add(root);
  const box = new Box3().setFromObject(root), size = box.getSize(new Vector3());
  // The coast runs along the waterfront edge, a little inside the -z bound so the jetty stands over the water.
  const coast = box.min.z + size.z * (o.coastAt ?? 0.12);
  ground.position.set(0, -0.002, coast + 100);
  sea.position.set(0, -0.02, coast - 100);
  renderer.setSize(o.w, o.h);
  const fov = 32, span = Math.max(size.x, size.z);
  const d = (span * o.h) / (2 * Math.tan((fov * Math.PI) / 360) * o.px);
  const camera = new PerspectiveCamera(fov, o.w / o.h, d * 0.02, d * 20);
  const pitch = (o.pitch * Math.PI) / 180, yaw = (o.yaw * Math.PI) / 180;
  const target = new Vector3(0, size.y * 0.3, 0);
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * d, target.y + Math.sin(pitch) * d, target.z + Math.cos(yaw) * Math.cos(pitch) * d);
  camera.lookAt(target);
  scene.fog.near = d * 1.6;
  scene.fog.far = d * 7;
  renderer.render(scene, camera);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  renderer.render(scene, camera);
  await new Promise((r) => requestAnimationFrame(r));
  return { ...info, backend: renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2' };
};
window.ready = true;
`;

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#222}canvas{display:block}</style></head>
<body><canvas></canvas><script type="module" src="./review.js"></script></body></html>`;

/** Which Meshy attempt each camp ships and its turn, as the last build recorded them. */
async function shippedSources() {
  const file = join(ROOT, 'assets-src/camps-meshy-2026-10-13/provenance.json');
  const models = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')).shipped?.models ?? {} : {};
  return Object.fromEntries(Object.entries(models).map(([id, m]) => [id, { attempt: Number(m.original.file.match(/-a(\d+)\.glb$/)[1]), turn: m.turnDegrees }]));
}

const VIEWS = [
  { name: 'from +z', yaw: 0, pitch: 50, px: 380, w: 520, h: 390 },
  { name: 'from +x', yaw: 90, pitch: 50, px: 380, w: 520, h: 390 },
  { name: 'from -z (waterfront)', yaw: 180, pitch: 50, px: 380, w: 520, h: 390 },
  { name: 'from -x', yaw: 270, pitch: 50, px: 380, w: 520, h: 390 },
  { name: 'top (-z up)', yaw: 0, pitch: 89.5, px: 340, w: 390, h: 390 },
  { name: '150 px', yaw: 35, pitch: 50, px: 150, w: 260, h: 190 },
  { name: '80 px', yaw: 35, pitch: 45, px: 80, w: 140, h: 104 },
  { name: '40 px', yaw: 35, pitch: 55, px: 40, w: 72, h: 54 },
];

const label = (text, w, h = 22) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#1d2024"/>` +
  `<text x="6" y="${h - 6}" font-family="Segoe UI, Arial" font-size="14" fill="#e8e4da">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);

/** One row of cells: each image with its label above, small renders also shown enlarged with nearest-neighbour pixels. */
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
  channel: args.channel ?? (process.platform === 'win32' ? 'msedge' : 'chrome'), headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal'],
});
const report = {};
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${PORT}/shots/s1013/camps-meshy/page/index.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  const shipped = args.originals ? await shippedSources() : {};
  const sets = args.originals
    ? [['original', (id) => ({
      url: `/assets-src/camps-meshy-2026-10-13/originals/${id}-a${args.attempt ?? shipped[id]?.attempt ?? 1}.glb`, normalize: true, turn: Number(args.turn ?? shipped[id]?.turn ?? 0),
    })]]
    : [['near', (id) => ({ url: `/models/camps/camp_${id.replace("-", "_")}.glb`, normalize: false })], ['far', (id) => ({ url: `/models/camps/camp_${id.replace("-", "_")}_far.glb`, normalize: false })]];
  const small = {};
  for (const id of IDS) {
    const rows = [];
    for (const [kind, source] of sets) {
      const src = source(id);
      const cells = [];
      let info;
      for (const v of VIEWS) {
        info = await page.evaluate((o) => window.view(o), { ...src, ...v });
        const png = await page.locator('canvas').screenshot();
        cells.push({ png, text: `${id} ${kind} · ${v.name}`, view: v });
        if (v.px <= 150) (small[`${kind}|${v.name}`] ??= []).push({ png, text: `${id} ${kind}` });
      }
      report[`${id} ${kind}`] = info;
      const head = `${id} ${kind}: ${info.triangles} tris, ${info.meshes} mesh, ${info.materials} mat, tex ${info.textures.join(' ') || '-'}, ` +
        `bounds ${info.min.map((n) => n.toFixed(3)).join(',')} .. ${info.max.map((n) => n.toFixed(3)).join(',')}, ${info.backend}`;
      rows.push(await row([{ png: (await sharp({ create: { width: 2100, height: 1, channels: 3, background: '#2a2d31' } }).png().toBuffer()), text: head }]));
      rows.push(await row(cells.slice(0, 4)));
      rows.push(await row([cells[4], cells[5], { ...cells[5], zoom: 2, text: '150 px ×2' }, cells[6], { ...cells[6], zoom: 3, text: '80 px ×3' }, cells[7], { ...cells[7], zoom: 4, text: '40 px ×4' }]));
    }
    const file = join(OUT, `${args.originals ? 'original-' : ''}${id}.png`);
    await stack(rows, file);
    console.log('sheet', file.slice(ROOT.length));
  }
  // Every model side by side at each small size, the way neighbouring camps are compared on the map.
  for (const [key, cells] of Object.entries(small)) {
    const [kind, view] = key.split('|');
    const zoom = view.startsWith('40') ? 3 : view.startsWith('80') ? 2 : 1;
    const rows = [];
    for (let i = 0; i < cells.length; i += 3) rows.push(await row(cells.slice(i, i + 3).map((c) => ({ ...c, zoom, text: `${c.text} · ${view}${zoom > 1 ? ` ×${zoom}` : ''}` }))));
    const file = join(OUT, `${args.originals ? 'original-' : ''}overview-${kind}-${view.replace(/ /g, '')}.png`);
    await stack(rows, file);
    console.log('sheet', file.slice(ROOT.length));
  }
  await writeFile(join(OUT, `${args.originals ? 'original-' : ''}review.json`), JSON.stringify(report, null, 2) + '\n');
  if (logs.length) console.log(logs.slice(-20).join('\n'));
} finally {
  await browser.close();
  await server.close();
}
