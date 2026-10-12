// Rebuilds public/models/camps/* from the Meshy originals in assets-src/camps-meshy-2026-10-13/originals/ (git-ignored:
// provenance.json there keeps their hashes and Meshy task ids). Local only: it never submits a paid job.
//
// Each camp is turned so its waterfront faces -z, stands on y = 0, is centred on x/z and is one unit along its longer
// horizontal side. Meshy's UV atlas gives nearly every triangle its own island, so no level can keep those UVs: here the
// geometry is welded, the never-seen underside of the base dropped and each level simplified with meshoptimizer; Blender
// (scripts/blender/camp-lods.py) unwraps each level afresh and bakes the original's colour onto it; here again the texels
// no ray reached are filled from their neighbours, the bake is downscaled to WebP and the file meshopt-compressed.
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
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

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
 * The shipped levels: triangles by tier, the bake and shipped texture sizes, the UV island margin as a share of the
 * atlas, and how far the bake's rays start outside the level's surface and may travel (model units).
 */
const LEVELS = [
  { name: 'near', suffix: '', triangles: [3000, 3500, 3900], range: [2500, 4000], bake: 2048, size: 1024, quality: 86, margin: 0.003, cage: 0.01, ray: 0.04 },
  { name: 'far', suffix: '_far', triangles: [700, 800, 880], range: [600, 900], bake: 512, size: 256, quality: 90, margin: 0.008, cage: 0.025, ray: 0.08 },
];
/** Faces lower than this whose normal points down are the base's underside. */
const UNDERSIDE = 0.004;
const BAKE = { samples: 4, angleLimit: 70, smoothAngle: 40 };

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rel = (path) => path.slice(ROOT.length).replace(/\\/g, '/').replace(/^\//, '');
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
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
  return { prim, scale: k, size: [(hi[0] - lo[0]) * k, (hi[1] - lo[1]) * k, (hi[2] - lo[2]) * k] };
}

/** One vertex per position (Meshy splits every vertex along its UV seams), without the base's underside. */
function weld(prim) {
  const p = prim.getAttribute('POSITION').getArray(), index = prim.getIndices().getArray();
  const bits = new Uint32Array(p.buffer, p.byteOffset, p.length);
  const ids = new Map(), remap = new Uint32Array(p.length / 3), out = [];
  for (let i = 0; i < remap.length; i += 1) {
    const key = `${bits[i * 3]},${bits[i * 3 + 1]},${bits[i * 3 + 2]}`;
    let id = ids.get(key);
    if (id === undefined) { id = out.length / 3; ids.set(key, id); out.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); }
    remap[i] = id;
  }
  const positions = new Float32Array(out), kept = [];
  let underside = 0;
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [remap[index[t]], remap[index[t + 1]], remap[index[t + 2]]];
    if (a === b || b === c || a === c) continue;
    const P = (i, j) => positions[i * 3 + j];
    const e1 = [P(b, 0) - P(a, 0), P(b, 1) - P(a, 1), P(b, 2) - P(a, 2)], e2 = [P(c, 0) - P(a, 0), P(c, 1) - P(a, 1), P(c, 2) - P(a, 2)];
    const ny = e1[2] * e2[0] - e1[0] * e2[2], len = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], ny, e1[0] * e2[1] - e1[1] * e2[0]);
    if (P(a, 1) < UNDERSIDE && P(b, 1) < UNDERSIDE && P(c, 1) < UNDERSIDE && ny < -0.5 * len) { underside += 1; continue; }
    kept.push(a, b, c);
  }
  return { positions, indices: new Uint32Array(kept), underside };
}

/**
 * meshoptimizer's collapse simplification to about `target` triangles, the vertices it no longer uses dropped. The six
 * extreme vertices are locked, so every level keeps the original's frame and the levels swap without a jump. The
 * simplifier can stop well short of the count it is asked for, so the request is corrected until the result lands
 * within 3% of the target. Regularize trades a little accuracy for evenly shaped triangles: a sliver gets a sub-texel
 * strip of the atlas and shows as a dark line across a courtyard.
 */
function simplify({ positions, indices }, target) {
  const extreme = new Uint8Array(positions.length / 3), lock = new Uint8Array(extreme.length);
  for (let axis = 0; axis < 3; axis += 1) {
    let lo = 0, hi = 0;
    for (let i = 0; i < extreme.length; i += 1) {
      if (positions[i * 3 + axis] < positions[lo * 3 + axis]) lo = i;
      if (positions[i * 3 + axis] > positions[hi * 3 + axis]) hi = i;
    }
    extreme[lo] = extreme[hi] = 1;
  }
  // A locked vertex alone can still be orphaned when its neighbours collapse together; locking its whole fan keeps it.
  for (let t = 0; t < indices.length; t += 3) {
    if (extreme[indices[t]] || extreme[indices[t + 1]] || extreme[indices[t + 2]]) lock[indices[t]] = lock[indices[t + 1]] = lock[indices[t + 2]] = 1;
  }
  const none = new Float32Array(lock.length);
  // Thin double-sided cloth collapses into pairs of triangles on the same three vertices; the material is double-sided,
  // so one of each pair is enough (Blender's import would drop it anyway).
  const single = (out) => {
    const seen = new Set(), kept = [];
    for (let t = 0; t < out.length; t += 3) {
      const key = [out[t], out[t + 1], out[t + 2]].sort((a, b) => a - b).join(',');
      if (!seen.has(key)) { seen.add(key); kept.push(out[t], out[t + 1], out[t + 2]); }
    }
    return kept;
  };
  let ask = target, best = null;
  for (let tries = 0; tries < 8; tries += 1) {
    const [raw, error] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, none, 1, [0], lock, Math.round(ask) * 3, 1, ['Regularize']);
    const result = [single(raw), error], got = result[0].length / 3;
    if (!best || Math.abs(got - target) < Math.abs(best[0].length / 3 - target)) best = result;
    if (Math.abs(got - target) <= target * 0.03) break;
    ask *= target / got;
  }
  const [out, error] = best;
  const remap = new Map(), p = [];
  const index = Uint32Array.from(out, (i) => {
    if (!remap.has(i)) { remap.set(i, p.length / 3); p.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]); }
    return remap.get(i);
  });
  return { positions: new Float32Array(p), indices: index, error: error * MeshoptSimplifier.getScale(positions, 3) };
}

async function writeMesh(file, { positions, indices }) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
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
    const tier = Number(id.split('-')[1]);
    const attempt = provenance.models[id]?.attempts.find((a) => a.number === recipe.attempt);
    if (!attempt?.original) throw new Error(`${id}: attempt ${recipe.attempt} has no downloaded original in provenance.json`);
    const source = join(ROOT, attempt.original.file);
    if (!existsSync(source)) throw new Error(`${id}: ${attempt.original.file} is missing (the originals are git-ignored; restore them first)`);
    if (sha256(readFileSync(source)) !== attempt.original.sha256) throw new Error(`${id}: ${attempt.original.file} does not match its recorded hash`);

    const doc = await io.read(source);
    const { prim, scale, size } = normalise(doc, recipe.turn);
    const high = join(temp, `${id}-high.glb`);
    await io.write(high, doc);
    const welded = weld(prim);
    const name = `camp_${id.replace('-', '_')}`;
    const job = { high, samples: BAKE.samples, angleLimit: BAKE.angleLimit, smoothAngle: BAKE.smoothAngle, report: join(temp, `${id}-blender.json`), levels: [] };
    const simplified = {};
    for (const level of LEVELS) {
      const target = level.triangles[tier - 1];
      const low = simplify(welded, target);
      simplified[level.name] = { triangles: low.indices.length / 3, error: low.error };
      const mesh = join(temp, `${id}-${level.name}-mesh.glb`);
      await writeMesh(mesh, low);
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
      levels.push({ ...(await inspect(file, level)), simplifiedFrom: welded.indices.length / 3, simplifiedTo: simplified[level.name].triangles, simplificationError: simplified[level.name].error, bakedCoverage: fill.coverage });
    }
    shipped[id] = {
      original: { file: attempt.original.file, sha256: attempt.original.sha256, taskId: attempt.taskId, triangles: prim.getIndices().getCount() / 3 },
      turnDegrees: recipe.turn, scaleFromOriginal: scale, normalisedSize: size, undersideTrianglesDropped: welded.underside, blender: blender.blender, levels,
    };
    console.log(`${id}: ${levels.map((l) => `${l.path.split('/').pop()} ${l.triangles} tris ${l.texture.size}px ${(l.bytes / 1024).toFixed(0)} KB`).join(', ')}`);
  }
} finally {
  if (args.keep) console.log(`intermediates kept in ${temp}`);
  else rmSync(temp, { recursive: true, force: true });
}

/** What a shipped file holds, checked against the conventions: one mesh, one material, the triangle range, the frame. */
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
  if (triangles < level.range[0] || triangles > level.range[1]) problems.push(`${triangles} triangles outside ${level.range.join('-')}`);
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
  levels: LEVELS.map(({ name, suffix, triangles, range, bake, size, quality, margin, cage, ray }) => ({ name, suffix, trianglesByTier: triangles, range, bake, size, quality, uvMargin: margin, cageExtrusion: cage, maxRayDistance: ray })),
  bake: BAKE, undersideBelow: UNDERSIDE,
  totalBytes: files.reduce((n, f) => n + f.bytes, 0), files: files.length,
  models: Object.fromEntries(Object.keys(RECIPE).filter((id) => shipped[id]).map((id) => [id, shipped[id]])),
};
const tempManifest = `${provenancePath}.tmp`;
writeFileSync(tempManifest, JSON.stringify(provenance, null, 2) + '\n');
renameSync(tempManifest, provenancePath);
console.log(`${files.length} files, ${(provenance.shipped.totalBytes / 1024 / 1024).toFixed(2)} MB in ${rel(OUT)}`);
