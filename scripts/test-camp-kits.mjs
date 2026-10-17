// The campaign map's buildings and ships: every settlement kind is built like the battle's ships, on its navy's atlas, at
// both levels of detail inside its triangle budget, sound (finite, inside its footprint, below the ground, faces wound the
// way their normals point, pictures never wrapping) and repeatable; every navy's camp at every level fits inside its
// reach with no two buildings on one spot and none in its wall, and keeps what it had as it grows; each navy's kit ship
// is one unit long, bow forward and afloat; every ship kind is drawn as the battle's own procedural ship. Pure geometry,
// no GPU.
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
try {
  const bundled = await build({
    stdin: { contents: `export * from './src/ui/grand/mapWorld.ts'; export * from './src/ui/grand/shipKits.ts'; export { buildShip } from './src/ships/build/ShipBuilder.ts'; export { modelKind, PROCEDURAL_KINDS } from './src/ships/anchors.ts'; export { SHIP_SPECS } from './src/sim/catalog.ts'; export * as buildings from './src/ui/grand/campBuildings.ts'; export * as pieces from './src/ui/grand/campPieces.ts';`, resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  const path = join(temporary, 'camp-kits.mjs'); await writeFile(path, bundled.outputFiles[0].contents);
  const { buildShipKit, campPlan, settlementPieces, buildShip, modelKind, PROCEDURAL_KINDS, SHIP_SPECS, buildings, pieces } = await import(pathToFileURL(path).href);
  const NAVIES = ['joseon', 'japan', 'ming', 'england', 'spain', 'holyleague', 'ottoman'];
  const tris = (m) => m.index.length / 3;

  // The settlements' buildings, made like the battle's ships: procedural parts on each navy's texture atlas.
  const atlas = JSON.parse(readFileSync(join(root, 'src/ui/grand/buildingAtlas.json'), 'utf8'));
  const built = new Map(buildings.KIT_KINDS.map((kind) => [kind, buildings.buildCampBuilding(kind)]));
  check('every settlement kind has a building close up and far away, inside its triangle budget', () => {
    assert.deepEqual([...built.keys()].sort(), Object.keys(pieces.FOOTPRINT).sort());
    for (const [kind, [near, far]] of built) {
      assert.ok(tris(near) > 0 && tris(near) <= 1500, `${kind} close: ${tris(near)} triangles`);
      assert.ok(tris(far) > 0 && tris(far) <= Math.max(0.45 * tris(near), 80), `${kind} far: ${tris(far)} of ${tris(near)} triangles`);
    }
  });
  check("every vertex of a building is finite, inside its footprint, reaches below the ground and names a cell of its navy's atlas", () => {
    for (const [kind, meshes] of built) {
      const slots = atlas.factions[pieces.navyOf(kind)];
      const [fx, fz] = pieces.FOOTPRINT[kind];
      const hx = pieces.WALL_KINDS.has(kind) ? 0.5 : fx / pieces.METRES_PER_RADIUS, hz = fz / pieces.METRES_PER_RADIUS;
      for (const m of meshes) {
        const n = m.position.length / 3;
        for (const [key, size] of [['normal', 3], ['uv', 2], ['color', 3], ['mat', 2], ['sway', 2]]) assert.equal(m[key].length, n * size, `${kind} ${key}`);
        let ground = Infinity;
        for (let i = 0; i < n; i++) {
          const [x, y, z] = [m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]];
          assert.ok([x, y, z, m.uv[i * 2], m.uv[i * 2 + 1]].every(Number.isFinite), `${kind} vertex ${i}`);
          assert.ok(Math.abs(x) <= hx + 1e-6 && Math.abs(z) <= hz + 1e-6, `${kind} vertex ${i} at ${x.toFixed(3)}, ${z.toFixed(3)} leaves its footprint`);
          assert.ok(Math.abs(Math.hypot(m.normal[i * 3], m.normal[i * 3 + 1], m.normal[i * 3 + 2]) - 1) < 1e-3, `${kind} normal ${i}`);
          const cell = Math.round(m.mat[i * 2]), slot = slots[cell];
          assert.ok(slot, `${kind} vertex ${i} names cell ${cell}`);
          // A picture (a door, a gate, a banner) is laid once over its face: its uv never wraps into the next repeat.
          if (!slot.tile) assert.ok(m.uv[i * 2] >= 0 && m.uv[i * 2] <= 1 && m.uv[i * 2 + 1] >= 0 && m.uv[i * 2 + 1] <= 1, `${kind} picture ${slot.name} uv`);
          for (let c = 0; c < 3; c++) assert.ok(m.color[i * 3 + c] > 0 && m.color[i * 3 + c] <= 4, `${kind} tint ${i}`);
          ground = Math.min(ground, y);
        }
        assert.ok(ground < 0, `${kind} reaches below the ground, so it never floats on a slope`);
        for (const v of m.index) assert.ok(v < n, `${kind} index`);
      }
    }
  });
  check("a building's faces are wound the way its normals point", () => {
    for (const [kind, meshes] of built) for (const m of meshes) {
      const p = m.position, nn = m.normal;
      let against = 0;
      for (let t = 0; t < m.index.length; t += 3) {
        const [a, b, c] = [m.index[t] * 3, m.index[t + 1] * 3, m.index[t + 2] * 3];
        const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
        const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (Math.hypot(...f) < 1e-12) continue;
        const mean = [0, 1, 2].map((k) => nn[a + k] + nn[b + k] + nn[c + k]);
        if (f[0] * mean[0] + f[1] * mean[1] + f[2] * mean[2] <= 0) against++;
      }
      assert.equal(against, 0, `${kind}: ${against} triangles face against their normals`);
    }
  });
  check('a stretch of wall runs the whole unit along x, so a ring of them closes', () => {
    for (const kind of pieces.WALL_KINDS) for (const m of built.get(kind)) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < m.position.length; i += 3) { lo = Math.min(lo, m.position[i]); hi = Math.max(hi, m.position[i]); }
      assert.ok(lo <= -0.495 && hi >= 0.495, `${kind} ${lo} ${hi}`);
    }
  });
  check('building a kind twice gives the same numbers', () => {
    for (const kind of ['hall', 'wa_keep3', 'mg_gate', 'choga']) {
      const [a, b] = [buildings.buildCampBuilding(kind), buildings.buildCampBuilding(kind)];
      for (const lod of [0, 1]) for (const key of ['position', 'normal', 'uv', 'color', 'mat', 'index']) assert.deepEqual(a[lod][key], b[lod][key], `${kind} ${lod} ${key}`);
    }
  });
  if (table) {
    console.log('kind          close   far');
    for (const [kind, [near, far]] of built) console.log(`${kind.padEnd(13)} ${String(tris(near)).padStart(5)} ${String(tris(far)).padStart(5)}`);
  }
  check('every kind a camp uses is a building', () => {
    for (const f of NAVIES) for (let level = 1; level <= 3; level++) for (const p of settlementPieces(level, f)) assert.ok(built.has(p.kind), `${f} ${level} ${p.kind}`);
  });
  // A piece's footprint on the ground in radii, turned as the layer turns it: local x goes to (cos rot, -sin rot).
  const corners = (p) => {
    const [fx, fz] = pieces.FOOTPRINT[p.kind];
    const hx = p.len !== undefined ? p.len / 2 : fx / pieces.METRES_PER_RADIUS, hz = fz / pieces.METRES_PER_RADIUS;
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, w]) => [p.x + u * hx * c + w * hz * s, p.z - u * hx * s + w * hz * c]);
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
  check("a camp's buildings stand clear of each other and of its wall, inside its reach", () => {
    for (const f of NAVIES) for (let level = 1; level <= 3; level++) {
      const plan = campPlan(level, f);
      const all = plan.pieces.filter((p) => p.kind !== 'pier');
      for (const p of all) for (const [x, z] of corners(p)) assert.ok(Math.hypot(x, z) <= plan.radius + 0.02, `${f} ${level} ${p.kind} reaches ${Math.hypot(x, z).toFixed(2)} of ${plan.radius}`);
      const houses = all.filter((p) => !pieces.WALL_KINDS.has(p.kind));
      const walls = all.filter((p) => pieces.WALL_KINDS.has(p.kind));
      houses.forEach((a, i) => houses.slice(i + 1).forEach((b) => assert.ok(!overlap(corners(a), corners(b)), `${f} ${level}: ${a.kind} at ${a.x.toFixed(2)},${a.z.toFixed(2)} overlaps ${b.kind} at ${b.x.toFixed(2)},${b.z.toFixed(2)}`)));
      // Gates and corner towers stand in the wall's line; nothing else touches it.
      for (const h of houses) if (!/gate|corner/.test(h.kind)) for (const w of walls) assert.ok(!overlap(corners(h), corners(w)), `${f} ${level}: ${h.kind} at ${h.x.toFixed(2)},${h.z.toFixed(2)} is in the wall`);
    }
  });
  check('a camp never loses a building as it grows (a stockade gate becomes a gatehouse)', () => {
    const UPGRADE = { jo_gate: 'fortgate', eu_gate: 'eu_gatehouse' };
    for (const f of NAVIES) for (let level = 1; level < 3; level++) {
      const count = (l) => {
        const n = new Map();
        for (const p of settlementPieces(l, f)) if (!pieces.WALL_KINDS.has(p.kind)) n.set(p.kind, (n.get(p.kind) ?? 0) + 1);
        return n;
      };
      const [lo, hi] = [count(level), count(level + 1)];
      for (const [kind, n] of lo) assert.ok((hi.get(kind) ?? 0) + (hi.get(UPGRADE[kind]) ?? 0) >= n, `${f} ${level + 1} keeps its ${kind}`);
      assert.ok([...hi.values()].reduce((a, b) => a + b, 0) > [...lo.values()].reduce((a, b) => a + b, 0), `${f} ${level + 1} has more buildings`);
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
    assert.equal(new Set(NAVIES.map((f) => tint(f).toFixed(3))).size, NAVIES.length);
  });
  check('every ship kind is the battle\'s procedural ship on the map, its far level light and in ship space', () => {
    for (const kind of Object.keys(SHIP_SPECS)) assert.ok(PROCEDURAL_KINDS.includes(modelKind(kind)), `${kind} is drawn by the battle's builder`);
    for (const kind of PROCEDURAL_KINDS) {
      const far = buildShip(kind, 0).lods[2];
      const tris = far.index.length / 3;
      assert.ok(tris > 0 && tris <= 900, `${kind} far level: ${tris} triangles`);
      // Ship space, which the map turns into its own frame: the length along x, the keel under the waterline at y = 0.
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < far.position.length; i++) { lo[i % 3] = Math.min(lo[i % 3], far.position[i]); hi[i % 3] = Math.max(hi[i % 3], far.position[i]); }
      assert.ok(hi[0] - lo[0] > 2 * (hi[2] - lo[2]), `${kind} lies along x`);
      assert.ok(lo[1] < 0 && hi[1] > 0, `${kind} floats on y = 0`);
    }
  });
  console.log(`${passed} camp kit regressions passed`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
