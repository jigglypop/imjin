// The campaign map's camps and ships: every navy and camp tier has its camp model at both levels of detail in the frame
// the map places it in; the procedural kits a camp falls back to build at both levels inside their triangle budget, a
// whole camp stays inside its budget, each navy's map ship is one unit long, bow forward and afloat, inside its budget, the shapes are sound (finite, inside their footprint, faces wound the way their normals point),
// building is repeatable, and every navy's camp only gains parts as it grows. Pure geometry, no GPU.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'imjin-camps-'));
const table = process.argv.includes('--table');
let passed = 0;
const check = (name, test) => { test(); passed++; console.log(`ok - ${name}`); };
/** Hard limits: triangles of one kind close up and far away, and of a whole top-level camp (each kind counted once). */
const BUDGET = { near: 600, far: 200, camp: 4000 };
try {
  const bundled = await build({
    stdin: { contents: `export * from './src/ui/grand/campKits.ts'; export * from './src/ui/grand/mapWorld.ts'; export * from './src/ui/grand/shipKits.ts';`, resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  const path = join(temporary, 'camp-kits.mjs'); await writeFile(path, bundled.outputFiles[0].contents);
  const { buildCampKit, buildShipKit, KIT_KINDS, settlementPieces, WALL_KINDS } = await import(pathToFileURL(path).href);
  const NAVIES = ['joseon', 'japan', 'ming'];
  const kits = new Map(KIT_KINDS.map((kind) => [kind, [buildCampKit(kind, 0), buildCampKit(kind, 1)]]));
  const tris = (m) => m.index.length / 3;

  if (table) {
    console.log('kind          LOD0  LOD1');
    for (const [kind, [near, far]] of kits) console.log(`${kind.padEnd(13)} ${String(tris(near)).padStart(4)}  ${String(tris(far)).padStart(4)}`);
  }

  check('every kind a camp uses has a kit, and every kit is used', () => {
    const used = new Set();
    for (const f of NAVIES) for (let level = 1; level <= 4; level++) for (const p of settlementPieces(level, f)) used.add(p.kind);
    assert.deepEqual([...used].sort(), [...KIT_KINDS].sort());
  });
  check('each kind stays inside its triangle budget close up and far away', () => {
    for (const [kind, [near, far]] of kits) {
      assert.ok(tris(near) > 0 && tris(near) <= BUDGET.near, `${kind} near ${tris(near)}`);
      assert.ok(tris(far) > 0 && tris(far) <= BUDGET.far, `${kind} far ${tris(far)}`);
      assert.ok(tris(far) < tris(near), `${kind} is lighter far away`);
    }
  });
  check('a whole top-level camp stays inside its budget', () => {
    for (const f of NAVIES) {
      const kinds = new Set(settlementPieces(4, f).map((p) => p.kind));
      const total = [...kinds].reduce((n, k) => n + tris(kits.get(k)[0]), 0);
      if (table) console.log(`${f} level 4: ${total} triangles over ${kinds.size} kinds`);
      assert.ok(total <= BUDGET.camp, `${f} ${total}`);
    }
  });
  check('every vertex is finite and inside the unit footprint, standing on the ground', () => {
    for (const [kind, meshes] of kits) for (const m of meshes) {
      const n = m.position.length / 3;
      assert.equal(m.normal.length, n * 3);
      assert.equal(m.color.length, n * 3);
      for (let i = 0; i < n; i++) {
        const [x, y, z] = [m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]];
        assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `${kind} position ${i}`);
        assert.ok(Math.abs(x) <= 0.505 && Math.abs(z) <= 0.505, `${kind} vertex ${i} at ${x.toFixed(3)}, ${z.toFixed(3)} leaves its footprint`);
        assert.ok(y >= -0.2 && y <= 3, `${kind} vertex ${i} height ${y.toFixed(3)}`);
        const len = Math.hypot(m.normal[i * 3], m.normal[i * 3 + 1], m.normal[i * 3 + 2]);
        assert.ok(Math.abs(len - 1) < 1e-3, `${kind} normal ${i}`);
        for (let c = 0; c < 3; c++) assert.ok(m.color[i * 3 + c] >= 0 && m.color[i * 3 + c] <= 1, `${kind} colour ${i}`);
      }
      for (const v of m.index) assert.ok(v < n, `${kind} index`);
      let ground = Infinity;
      for (let i = 0; i < n; i++) ground = Math.min(ground, m.position[i * 3 + 1]);
      assert.ok(ground < 0, `${kind} reaches below the ground, so it never floats on a slope`);
    }
  });
  check('a wall segment runs the whole unit along x, so a ring of them closes', () => {
    for (const kind of WALL_KINDS) for (const m of kits.get(kind)) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < m.position.length; i += 3) { lo = Math.min(lo, m.position[i]); hi = Math.max(hi, m.position[i]); }
      assert.ok(lo <= -0.495 && hi >= 0.495, `${kind} ${lo} ${hi}`);
    }
  });
  check('every face is wound the way its normals point', () => {
    for (const [kind, meshes] of kits) for (const m of meshes) {
      const p = m.position, nn = m.normal;
      for (let t = 0; t < m.index.length; t += 3) {
        const [a, b, c] = [m.index[t] * 3, m.index[t + 1] * 3, m.index[t + 2] * 3];
        const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
        const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const area = Math.hypot(...f);
        if (area < 1e-9) continue;
        const mean = [0, 1, 2].map((k) => nn[a + k] + nn[b + k] + nn[c + k]);
        assert.ok(f[0] * mean[0] + f[1] * mean[1] + f[2] * mean[2] > 0, `${kind} triangle ${t / 3} faces against its normals`);
      }
    }
  });
  check('every navy and camp tier has a close and a far model in the map\'s frame: one mesh, longer side 1, standing on y = 0', () => {
    // The glTF JSON chunk of a .glb: its node, mesh, accessor bounds and the node's dequantising transform.
    const gltf = (file) => {
      const b = readFileSync(join(root, 'public/models/camps', file));
      assert.equal(b.toString('ascii', 0, 4), 'glTF', file);
      return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
    };
    for (const f of NAVIES) for (const tier of [1, 2, 3]) {
      const extents = [];
      for (const far of [false, true]) {
        const file = `camp_${f}_${tier}${far ? '_far' : ''}.glb`;
        const j = gltf(file);
        assert.equal(j.meshes.length, 1, `${file} has one mesh`);
        assert.equal(j.meshes[0].primitives.length, 1, `${file} has one primitive`);
        const node = j.nodes.find((n) => n.mesh === 0);
        const acc = j.accessors[j.meshes[0].primitives[0].attributes.POSITION];
        const scale = node.scale ?? [1, 1, 1], move = node.translation ?? [0, 0, 0];
        // Normalised integer positions read as -1..1 before the node scales and moves them.
        const unit = acc.normalized ? { 5120: 127, 5122: 32767 }[acc.componentType] : 1;
        const lo = acc.min.map((v, k) => (v / unit) * scale[k] + move[k]), hi = acc.max.map((v, k) => (v / unit) * scale[k] + move[k]);
        assert.ok(Math.abs(Math.max(hi[0] - lo[0], hi[2] - lo[2]) - 1) < 0.01, `${file}: longer side ${Math.max(hi[0] - lo[0], hi[2] - lo[2])}`);
        assert.ok(Math.abs(lo[1]) < 0.01, `${file}: lowest point ${lo[1]}`);
        assert.ok(Math.abs(lo[0] + hi[0]) < 0.02 && Math.abs(lo[2] + hi[2]) < 0.02, `${file}: centred`);
        const tris = (j.meshes[0].primitives[0].indices !== undefined ? j.accessors[j.meshes[0].primitives[0].indices].count : acc.count) / 3;
        assert.ok(far ? tris <= 1000 : tris <= 4500, `${file}: ${tris} triangles`);
        extents.push([...lo, ...hi].map((v) => v.toFixed(2)).join());
      }
      assert.equal(extents[0], extents[1], `${f} ${tier}: close and far share one frame, so they swap in place`);
    }
  });
  check('each navy\'s map ship is one unit long, bow towards +z, afloat with its masts up, inside its budget', () => {
    for (const f of NAVIES) {
      const m = buildShipKit(f);
      const n = m.position.length / 3;
      assert.ok(tris(m) > 0 && tris(m) <= 400, `${f} ${tris(m)} triangles`);
      let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity, x1 = 0;
      for (let i = 0; i < n; i++) {
        const [x, y, z] = [m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]];
        assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `${f} position ${i}`);
        z0 = Math.min(z0, z); z1 = Math.max(z1, z); y0 = Math.min(y0, y); y1 = Math.max(y1, y); x1 = Math.max(x1, Math.abs(x));
        for (let c = 0; c < 3; c++) assert.ok(m.color[i * 3 + c] >= 0 && m.color[i * 3 + c] <= 1, `${f} colour ${i}`);
      }
      assert.ok(Math.abs(z1 - z0 - 1) < 0.05, `${f} is ${(z1 - z0).toFixed(3)} long`);
      assert.ok(y0 < 0 && y0 > -0.1, `${f} keel at ${y0.toFixed(3)}`);
      // Masts a little taller than life, so the sails show from the strategic view.
      assert.ok(y1 > 0.6 && y1 < 0.95, `${f} masthead at ${y1.toFixed(3)}`);
      assert.ok(x1 < 0.3, `${f} is ${(2 * x1).toFixed(3)} wide`);
      for (const v of m.index) assert.ok(v < n, `${f} index`);
    }
    // The navies differ in their colours, not only in their outlines.
    const tint = (f) => { const m = buildShipKit(f); return m.color.reduce((a, v) => a + v, 0); };
    assert.equal(new Set(NAVIES.map((f) => tint(f).toFixed(3))).size, 3);
  });
  check('building a kit twice gives the same numbers', () => {
    for (const kind of KIT_KINDS) for (const lod of [0, 1]) {
      const [a, b] = [buildCampKit(kind, lod), buildCampKit(kind, lod)];
      for (const key of ['position', 'normal', 'color', 'index']) assert.deepEqual(a[key], b[key], `${kind} ${lod} ${key}`);
    }
  });
  // A piece's footprint on the ground in settlement radii: its kit's extent turned and scaled as the layer places it.
  const extent = new Map([...kits].map(([kind, [m]]) => {
    let x = 0, z = 0;
    for (let i = 0; i < m.position.length; i += 3) { x = Math.max(x, Math.abs(m.position[i])); z = Math.max(z, Math.abs(m.position[i + 2])); }
    return [kind, { x, z }];
  }));
  const corners = (p) => {
    const e = extent.get(p.kind), c = Math.cos(p.rot), s = Math.sin(p.rot);
    // The layer turns a piece by `rot` about +y: local x goes to (cos, -sin) and local z to (sin, cos) in (x, z).
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
      const lx = u * e.x * p.size, lz = v * e.z * p.size;
      return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
    });
  };
  // Separating axis test on two turned rectangles, each shrunk a little so touching eaves do not count.
  const overlap = (a, b) => {
    const shrink = (q) => { const cx = q.reduce((n, v) => n + v[0], 0) / 4, cz = q.reduce((n, v) => n + v[1], 0) / 4; return q.map(([x, z]) => [cx + (x - cx) * 0.9, cz + (z - cz) * 0.9]); };
    const [A, B] = [shrink(a), shrink(b)];
    for (const poly of [A, B]) for (let i = 0; i < 4; i++) {
      const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % 4], axis = [z0 - z1, x1 - x0];
      const proj = (q) => q.map(([x, z]) => x * axis[0] + z * axis[1]);
      const [pa, pb] = [proj(A), proj(B)];
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
    return true;
  };
  check('the buildings of a camp stand clear of each other and near their camp', () => {
    for (const f of NAVIES) for (let level = 1; level <= 4; level++) {
      const pieces = settlementPieces(level, f);
      for (const p of pieces) for (const [x, z] of corners(p)) assert.ok(Math.hypot(x, z) <= 2, `${f} ${level} ${p.kind} reaches ${Math.hypot(x, z).toFixed(2)}`);
      const buildings = pieces.filter((p) => !WALL_KINDS.has(p.kind));
      buildings.forEach((a, i) => buildings.slice(i + 1).forEach((b) => assert.ok(!overlap(corners(a), corners(b)), `${f} ${level}: ${a.kind} at ${a.x.toFixed(2)},${a.z.toFixed(2)} overlaps ${b.kind} at ${b.x.toFixed(2)},${b.z.toFixed(2)}`)));
    }
  });
  check('a camp never loses a building as it grows (a keep grows a tier)', () => {
    const UPGRADE = { wa_keep3: 'wa_keep4' };
    for (const f of NAVIES) for (let level = 1; level < 4; level++) {
      const count = (l) => {
        const n = new Map();
        for (const p of settlementPieces(l, f)) if (!WALL_KINDS.has(p.kind)) n.set(p.kind, (n.get(p.kind) ?? 0) + 1);
        return n;
      };
      const [lo, hi] = [count(level), count(level + 1)];
      for (const [kind, n] of lo) assert.ok((hi.get(kind) ?? 0) + (hi.get(UPGRADE[kind]) ?? 0) >= n, `${f} ${level + 1} keeps its ${kind}`);
    }
  });
  console.log(`${passed} camp kit regressions passed`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
