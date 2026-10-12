// Rebuilds public/models/camps/* from the Meshy originals in assets-src/camps-meshy-2026-10-13/originals/ (git-ignored:
// provenance.json there keeps their hashes and Meshy task ids). Local only: it never submits a paid job.
//
// Each camp is turned so its waterfront faces -z, stands on y = 0, is centred on x/z and is one unit along its longer
// horizontal side. Its levels are not decimated scans but low-poly architecture rebuilt from the original's top-down
// heightmap (scripts/camp-shape.mjs): planar facets, straight edges, vertical walls, banners as flat cards. Blender
// (scripts/blender/camp-lods.py) unwraps each level and bakes the original's colour onto it; here again the texels no ray
// reached are filled from their neighbours, the bake is downscaled to WebP and the file meshopt-compressed.
//
//   node scripts/build-camp-models.mjs [--only=joseon-1,ming-3] [--keep]     --keep leaves the intermediates in a temp dir
// Needs Blender 5.x: set CAMPS_BLENDER when it is not at the default path.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { meshopt, prune, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { campCards, campShape } from './camp-shape.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PKG = join(ROOT, 'assets-src/camps-meshy-2026-10-13');
const OUT = join(ROOT, 'public/models/camps');
const BLENDER = process.env.CAMPS_BLENDER ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));

/** Per camp: the accepted Meshy attempt and the turn about +y in degrees that brings its waterfront to -z. */
const RECIPE = {
  'joseon-1': { attempt: 1, turn: 180 },
  'joseon-2': { attempt: 1, turn: 180 },
  'joseon-3': { attempt: 1, turn: 0 },
  'japan-1': { attempt: 1, turn: 180 },
  'japan-2': { attempt: 1, turn: 180 },
  'japan-3': { attempt: 2, turn: 180 },
  'ming-1': { attempt: 1, turn: 180 },
  'ming-2': { attempt: 1, turn: 180 },
  'ming-3': { attempt: 1, turn: 0 },
};

/**
 * The shipped levels. `shape` is how scripts/camp-shape.mjs cuts the level: heightmap sizes tried in turn until the
 * budget fits, the largest edge tolerance in pixels, how much a step may be and still count as a crease, the highest a
 * compact bump may stand and still be flattened, the smallest region, and whether banner poles stay (far away only
 * the cloth reads). Then the bake and shipped texture sizes, the UV island margin as a share of the atlas, and how far
 * the bake's rays start outside the level's surface and may travel (model units): far enough to reach a wall under its
 * eaves and the tops of flattened merlons.
 */
const LEVELS = [
  { name: 'near', suffix: '', budget: 1200, shape: { grids: [256, 192, 160], maxTol: 3, creaseTol: 0.02, maxBump: 0.04, minArea: 12, poles: true },
    bake: 1024, size: 512, quality: 88, margin: 0.004, cage: 0.04, ray: 0.1 },
  { name: 'far', suffix: '_far', budget: 350, shape: { grids: [128, 96, 80, 64], maxTol: 5, creaseTol: 0.03, maxBump: 0.04, minArea: 16, poles: false },
    bake: 512, size: 256, quality: 90, margin: 0.008, cage: 0.04, ray: 0.1 },
];

/** A level's shape: the finest heightmap of its list that fits the budget. */
function levelShape(P, I, level, cards) {
  const { grids, poles, ...rest } = level.shape;
  let last;
  for (const grid of grids) {
    try {
      return { ...campShape(P, I, { budget: level.budget, grid, cards: poles ? cards : cards.filter((c) => c.kind === 'cloth'), ...rest }), grid };
    } catch (error) { last = error; }
  }
  throw last;
}
const BAKE = { samples: 4, angleLimit: 66 };

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rel = (path) => path.slice(ROOT.length).replace(/\\/g, '/').replace(/^\//, '');
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// ---------- geometry ----------
/** The original's only primitive with its node transform applied, turned by `turn` degrees about +y and normalised. */
function normalise(doc, turn) {
  const nodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
  const meshes = doc.getRoot().listMeshes();
  if (nodes.length !== 1 || meshes.length !== 1 || meshes[0].listPrimitives().length !== 1) throw new Error('expected one node with one mesh of one primitive');
  const node = nodes[0], prim = meshes[0].listPrimitives()[0];
  const m = node.getWorldMatrix();
  const a = (turn * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const position = prim.getAttribute('POSITION'), normal = prim.getAttribute('NORMAL');
  const n = position.getCount(), p = new Float32Array(n * 3), q = normal ? new Float32Array(n * 3) : null;
  const v = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    position.getElement(i, v);
    const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
    p.set([x * c + z * s, y, -x * s + z * c], i * 3);
    if (q) {
      normal.getElement(i, v);
      const nx = m[0] * v[0] + m[4] * v[1] + m[8] * v[2], ny = m[1] * v[0] + m[5] * v[1] + m[9] * v[2], nz = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
      const k = 1 / Math.hypot(nx, ny, nz);
      q.set([(nx * c + nz * s) * k, ny * k, (-nx * s + nz * c) * k], i * 3);
    }
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 1) { lo[i % 3] = Math.min(lo[i % 3], p[i]); hi[i % 3] = Math.max(hi[i % 3], p[i]); }
  const k = 1 / Math.max(hi[0] - lo[0], hi[2] - lo[2]), shift = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2];
  for (let i = 0; i < p.length; i += 1) p[i] = (p[i] + shift[i % 3]) * k;
  // The bake source keeps Meshy's UVs and texture; only where it stands changes.
  position.setArray(p);
  if (q) normal.setArray(q);
  node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  for (const other of doc.getRoot().listNodes()) if (other !== node) other.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return prim;
}

/** The bounds of triangles [a, b, c, normal]. */
function bounds(tris) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let k = 0; k < 3; k += 1) for (let a = 0; a < 3; a += 1) { lo[a] = Math.min(lo[a], t[k][a]); hi[a] = Math.max(hi[a], t[k][a]); }
  return { lo, hi };
}

/**
 * Maps triangles from the box `from` onto the box `to` axis by axis, then moves them by `shift` and scales by `scale`.
 * A level's outline sits a little inside the original's, so the near level's own box sets the frame, and the far level
 * is stretched onto it (by under a percent) so the two swap in place.
 */
function place(tris, from, to, shift, scale) {
  const map = (p) => p.map((v, a) => (to.lo[a] + ((v - from.lo[a]) * (to.hi[a] - to.lo[a])) / (from.hi[a] - from.lo[a] || 1) + shift[a]) * scale);
  return tris.map(([a, b, c, n]) => [map(a), map(b), map(c), n]);
}

/**
 * A level's triangles as a GLB for Blender to unwrap and bake. Corners with the same position and normal share a vertex,
 * so each flat facet is one connected surface (one UV island) while the edges between facets stay hard.
 */
async function writeLevel(file, tris) {
  const ids = new Map(), pos = [], nor = [], index = [];
  for (const [a, b, c, n] of tris) for (const p of [a, b, c]) {
    const key = `${p.map((v) => v.toFixed(6))}|${n.map((v) => v.toFixed(4))}`;
    let id = ids.get(key);
    if (id === undefined) { id = pos.length / 3; ids.set(key, id); pos.push(...p); nor.push(...n); }
    index.push(id);
  }
  const doc = new Document();
  const buffer = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(index)).setBuffer(buffer));
  doc.createScene().addChild(doc.createNode('camp').setMesh(doc.createMesh('camp').addPrimitive(prim)));
  await io.write(file, doc);
}

// ---------- texture ----------
/**
 * The baked texels as RGB with every texel no ray reached (the bake's sentinel, alpha 0) filled from the nearest baked
 * ones through a push-pull pyramid, so neither filtering nor mipmaps ever pull in the empty atlas.
 */
async function filledBake(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const levels = [];
  let w = info.width, h = info.height, col = new Float32Array(w * h * 3), wt = new Float32Array(w * h), baked = 0;
  for (let i = 0; i < w * h; i += 1) {
    if (data[i * 4 + 3] < 255) continue;
    col[i * 3] = data[i * 4]; col[i * 3 + 1] = data[i * 4 + 1]; col[i * 3 + 2] = data[i * 4 + 2];
    wt[i] = 1;
    baked += 1;
  }
  levels.push({ w, h, col, wt });
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), ncol = new Float32Array(nw * nh * 3), nwt = new Float32Array(nw * nh);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const i = y * w + x, j = Math.min(nh - 1, y >> 1) * nw + Math.min(nw - 1, x >> 1);
      nwt[j] += wt[i]; ncol[j * 3] += col[i * 3]; ncol[j * 3 + 1] += col[i * 3 + 1]; ncol[j * 3 + 2] += col[i * 3 + 2];
    }
    levels.push({ w: nw, h: nh, col: ncol, wt: nwt });
    w = nw; h = nh; col = ncol; wt = nwt;
  }
  for (let k = levels.length - 2; k >= 0; k -= 1) {
    const L = levels[k], P = levels[k + 1];
    for (let y = 0; y < L.h; y += 1) for (let x = 0; x < L.w; x += 1) {
      const i = y * L.w + x;
      if (L.wt[i] > 0) continue;
      const j = Math.min(P.h - 1, y >> 1) * P.w + Math.min(P.w - 1, x >> 1);
      for (let c = 0; c < 3; c += 1) L.col[i * 3 + c] = P.col[j * 3 + c] / P.wt[j];
      L.wt[i] = 1;
    }
  }
  const L = levels[0], rgb = Buffer.alloc(L.w * L.h * 3);
  for (let i = 0; i < L.w * L.h; i += 1) for (let c = 0; c < 3; c += 1) rgb[i * 3 + c] = Math.round(L.col[i * 3 + c] / L.wt[i]);
  return { rgb, width: info.width, height: info.height, coverage: baked / (info.width * info.height) };
}

// ---------- build ----------

const provenancePath = join(PKG, 'provenance.json');
const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
if (!existsSync(BLENDER)) throw new Error(`Blender not found at ${BLENDER}; set CAMPS_BLENDER`);
mkdirSync(OUT, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'imjin-camps-'));
const only = args.only ? args.only.split(',') : null;
const shipped = { ...(provenance.shipped?.models ?? {}) };
try {
  for (const [id, recipe] of Object.entries(RECIPE)) {
    if (only && !only.includes(id)) continue;
    const attempt = provenance.models[id]?.attempts.find((a) => a.number === recipe.attempt);
    if (!attempt?.original) throw new Error(`${id}: attempt ${recipe.attempt} has no downloaded original in provenance.json`);
    const source = join(ROOT, attempt.original.file);
    if (!existsSync(source)) throw new Error(`${id}: ${attempt.original.file} is missing (the originals are git-ignored; restore them first)`);
    if (sha256(readFileSync(source)) !== attempt.original.sha256) throw new Error(`${id}: ${attempt.original.file} does not match its recorded hash`);

    const doc = await io.read(source);
    const prim = normalise(doc, recipe.turn);
    const P = prim.getAttribute('POSITION').getArray(), I = prim.getIndices().getArray();
    const cards = campCards(P, I);
    const shapes = LEVELS.map((level) => levelShape(P, I, level, cards));
    // The near level's box sets the frame; the original (the bake source) moves with it.
    const box = bounds(shapes[0].tris);
    const scale = 1 / Math.max(box.hi[0] - box.lo[0], box.hi[2] - box.lo[2]);
    const shift = [-(box.lo[0] + box.hi[0]) / 2, -box.lo[1], -(box.lo[2] + box.hi[2]) / 2];
    const moved = Float32Array.from(P, (v, i) => (v + shift[i % 3]) * scale);
    prim.getAttribute('POSITION').setArray(moved);
    const high = join(temp, `${id}-high.glb`);
    await io.write(high, doc);

    const name = `camp_${id.replace('-', '_')}`;
    const job = { high, samples: BAKE.samples, angleLimit: BAKE.angleLimit, report: join(temp, `${id}-blender.json`), levels: [] };
    for (const [i, level] of LEVELS.entries()) {
      const mesh = join(temp, `${id}-${level.name}-mesh.glb`);
      await writeLevel(mesh, place(shapes[i].tris, bounds(shapes[i].tris), box, shift, scale));
      job.levels.push({ name: name + level.suffix, mesh, bake: level.bake, margin: level.margin, cageExtrusion: level.cage, maxRayDistance: level.ray,
        png: join(temp, `${id}-${level.name}-bake.png`), glb: join(temp, `${id}-${level.name}-baked.glb`) });
    }
    const jobFile = join(temp, `${id}-job.json`);
    writeFileSync(jobFile, JSON.stringify(job, null, 2));
    execFileSync(BLENDER, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', join(ROOT, 'scripts/blender/camp-lods.py'), '--', jobFile], { stdio: 'pipe' });
    const blender = JSON.parse(readFileSync(job.report, 'utf8'));

    const levels = [];
    for (const [i, level] of LEVELS.entries()) {
      const spec = job.levels[i];
      const fill = await filledBake(spec.png);
      const webp = await sharp(fill.rgb, { raw: { width: fill.width, height: fill.height, channels: 3 } })
        .resize(level.size, level.size, { kernel: 'lanczos3' }).webp({ quality: level.quality, effort: 6 }).toBuffer();
      const out = await io.read(spec.glb);
      const root = out.getRoot();
      const [mesh] = root.listMeshes(), [part] = mesh.listPrimitives();
      for (const semantic of part.listSemantics()) if (!['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(semantic)) part.setAttribute(semantic, null);
      const material = part.getMaterial();
      material.getBaseColorTexture().setImage(webp).setMimeType('image/webp').setURI('').setName(spec.name);
      out.createExtension(EXTTextureWebP).setRequired(true);
      material.setName(spec.name).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.9).setDoubleSided(true).setAlphaMode('OPAQUE');
      mesh.setName(spec.name);
      for (const node of root.listNodes()) node.setName(spec.name);
      await out.transform(prune(), reorder({ encoder: MeshoptEncoder, level: 'high' }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
      const file = join(OUT, `${spec.name}.glb`);
      await io.write(file, out);
      levels.push({ ...(await inspect(file, level)), shape: { grid: shapes[i].grid, regions: shapes[i].regions, settings: shapes[i].settings }, bakedCoverage: fill.coverage });
    }
    shipped[id] = {
      original: { file: attempt.original.file, sha256: attempt.original.sha256, taskId: attempt.taskId, triangles: I.length / 3 },
      turnDegrees: recipe.turn, cards: { cloth: cards.filter((c) => c.kind === 'cloth').length, pole: cards.filter((c) => c.kind === 'pole').length },
      blender: blender.blender, levels,
    };
    console.log(`${id}: ${levels.map((l) => `${l.path.split('/').pop()} ${l.triangles} tris ${l.texture.size}px ${(l.bytes / 1024).toFixed(0)} KB`).join(', ')}`);
  }
} finally {
  if (args.keep) console.log(`intermediates kept in ${temp}`);
  else rmSync(temp, { recursive: true, force: true });
}

/** What a shipped file holds, checked against the conventions: one mesh, one material, the budget, the frame. */
async function inspect(file, level) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const meshes = root.listMeshes(), prims = meshes.flatMap((m) => m.listPrimitives()), textures = root.listTextures();
  const triangles = prims.reduce((n, p) => n + p.getIndices().getCount() / 3, 0);
  const node = root.listNodes().find((n) => n.getMesh());
  const m = node.getWorldMatrix(), position = prims[0].getAttribute('POSITION'), v = [0, 0, 0];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.getCount(); i += 1) {
    position.getElement(i, v);
    const w = [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
    for (let r = 0; r < 3; r += 1) { lo[r] = Math.min(lo[r], w[r]); hi[r] = Math.max(hi[r], w[r]); }
  }
  const image = textures[0].getImage(), meta = await sharp(image).metadata();
  const problems = [];
  if (meshes.length !== 1 || prims.length !== 1 || root.listMaterials().length !== 1 || textures.length !== 1) problems.push('not one mesh, primitive, material and texture');
  if (triangles > level.budget) problems.push(`${triangles} triangles over ${level.budget}`);
  if (meta.width !== level.size || meta.height !== level.size) problems.push(`texture ${meta.width}x${meta.height}`);
  if (Math.abs(lo[1]) > 0.002 || Math.abs(Math.max(hi[0] - lo[0], hi[2] - lo[2]) - 1) > 0.004 || Math.abs(lo[0] + hi[0]) > 0.004 || Math.abs(lo[2] + hi[2]) > 0.004) problems.push(`frame ${lo.map((n) => n.toFixed(3))} .. ${hi.map((n) => n.toFixed(3))}`);
  if (problems.length) throw new Error(`${rel(file)}: ${problems.join('; ')}`);
  const bytes = readFileSync(file);
  return { level: level.name, path: rel(file), bytes: bytes.length, sha256: sha256(bytes), triangles, vertices: position.getCount(), meshes: meshes.length, materials: root.listMaterials().length,
    texture: { size: meta.width, format: 'webp', bytes: image.byteLength, quality: level.quality, bakedAt: level.bake }, bounds: { min: lo.map((n) => +n.toFixed(4)), max: hi.map((n) => +n.toFixed(4)) } };
}

const files = Object.values(shipped).flatMap((s) => s.levels);
provenance.shipped = {
  builtBy: 'node scripts/build-camp-models.mjs', builtAt: new Date().toISOString(),
  convention: 'glTF y up; waterfront (pier or quay) faces -z; base on y = 0; centred on x and z; the longer horizontal side is 1 unit',
  method: 'low-poly rebuild from the top-down heightmap (scripts/camp-shape.mjs): planar facets, vertical walls, banner cards; the original colour baked on in Blender',
  levels: LEVELS.map(({ name, suffix, budget, shape, bake, size, quality, margin, cage, ray }) => ({ name, suffix, budget, shape, bake, size, quality, uvMargin: margin, cageExtrusion: cage, maxRayDistance: ray })),
  bake: BAKE,
  totalBytes: files.reduce((n, f) => n + f.bytes, 0), files: files.length,
  models: Object.fromEntries(Object.keys(RECIPE).filter((id) => shipped[id]).map((id) => [id, shipped[id]])),
};
const tempManifest = `${provenancePath}.tmp`;
writeFileSync(tempManifest, JSON.stringify(provenance, null, 2) + '\n');
renameSync(tempManifest, provenancePath);
console.log(`${files.length} files, ${(provenance.shipped.totalBytes / 1024 / 1024).toFixed(2)} MB in ${rel(OUT)}`);
