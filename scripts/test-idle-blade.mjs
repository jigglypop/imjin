// Standing figures hold their sword with the fist just under the guard and the blade hung by idleBlade
// (src/ui/generals/idleBlade.ts). Every idle frame (15 fps): the blade, guard to tip sampled every 2 cm, keeps >= 5 cm
// from every skinned body vertex except the sword hand's own (owner 2026-10-17: the whole blade outside the body).
//   node scripts/test-idle-blade.mjs [key:weapon ...]   (default: every indexed figure with its faction's swords)
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3 } from 'three';
import { io } from './lib/figure.mjs';
import { loadFigure, pose } from './lib/deform.mjs';
import { idleBlade } from '../src/ui/generals/idleBlade.ts';
import { runtimePath } from './lib/remote-assets.mjs';
const MIN = 0.05, FIST = 0.055;
const DIR = 'public/models/generals';
const SWORDS = { joseon: ['joseon_hwando', 'joseon_ungeom'], japan: ['japan_katana', 'japan_tachi'], ming: ['ming_dao', 'ming_jian'] };
const FACTION = Object.fromEntries([...readFileSync('src/meta/catalog.ts', 'utf8').matchAll(/armor\('([a-z_]+)', '(joseon|japan|ming)'/g)].map((m) => [m[1], m[2]]));
const list = process.argv.slice(2).length ? process.argv.slice(2)
  : JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8')).filter((k) => !k.startsWith('parts/')).flatMap((k) => (SWORDS[FACTION[k.split('__')[1]]] ?? SWORDS.joseon).map((w) => `${k}:weapon_${w}`));
async function sword(name) {
  const d = await io.read(await runtimePath(`${DIR}/parts/${name}.glb`)); const pts = [];
  for (const n of d.getRoot().listNodes()) { const m = n.getMesh(); if (!m) continue; const W = new Matrix4().fromArray(n.getWorldMatrix());
    for (const p of m.listPrimitives()) { const P = p.getAttribute('POSITION'); for (let i = 0; i < P.getCount(); i++) pts.push(new Vector3(...P.getElement(i, [])).applyMatrix4(W)); } }
  let lo = Infinity, hi = -Infinity; for (const p of pts) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
  const B = 60, step = (hi - lo) / B, wide = new Array(B).fill(0);
  for (const p of pts) { const b = Math.min(B - 1, Math.floor((p.y - lo) / step)); wide[b] = Math.max(wide[b], Math.hypot(p.x, p.z)); }
  let g = 0; for (let b = 0; b < B / 2; b++) if (wide[b] > wide[g]) g = b;
  const guard = lo + (g + 0.5) * step, shift = Math.max(0, guard - FIST);
  return { from: guard - shift, to: hi - shift };
}
const figures = new Map(); let failed = 0;
for (const spec of list) {
  const [key, weapon] = spec.split(':'); const blade = await sword(weapon);
  if (!figures.has(key)) {
    const F = await loadFigure(await runtimePath(`${DIR}/${key}.glb`));
    // A `left_handed` figure (Nelson) holds the sword in his left fist.
    const L = F.nodes.some((n) => n.getName() === 'left_handed'), S = L ? 'Left' : 'Right';
    const sockLocal = new Matrix4().fromArray(F.nodes.find((n) => n.getName() === `socket_grip_${S.toLowerCase()}`).getMatrix());
    const handJ = F.jointNames.indexOf(`${S}Hand`), hipsJ = F.jointNames.indexOf('Hips');
    const skip = new Set([`${S}Hand`, `${S}ForeArm`].map((n) => F.jointNames.indexOf(n)));
    const keep = F.prims.map((p) => { const k = new Uint8Array(p.pos.length / 3); for (let v = 0; v < k.length; v++) { let b = 0; for (let q = 1; q < 4; q++) if (p.w[v * 4 + q] > p.w[v * 4 + b]) b = q; k[v] = skip.has(p.j[v * 4 + b]) ? 0 : 1; } return k; });
    const dur = Math.max(...F.clips.idle_sword.map((c) => c.t[c.t.length - 1])); const frames = [];
    for (let t = 0; t <= dur + 1e-6; t += 1 / 15) { const P = pose(F, 'idle_sword', t);
      frames.push({ t, verts: P.verts, hand: new Vector3().setFromMatrixPosition(P.jointWorld[handJ].clone().multiply(sockLocal)), hips: new Vector3().setFromMatrixPosition(P.jointWorld[hipsJ]) }); }
    figures.set(key, { frames, keep }); if (process.env.DEBUG) console.log(key, frames.length, "frames");
  }
  const { frames, keep } = figures.get(key); let worst = { d: Infinity, t: 0 };
  for (const f of frames) {
    const dir = new Vector3(...idleBlade(f.hand.toArray(), f.hips.toArray()).dir);
    const a = f.hand.clone().addScaledVector(dir, blade.from), b = f.hand.clone().addScaledVector(dir, blade.to), ab = b.clone().sub(a), L2 = ab.lengthSq();
    const mn = a.clone().min(b).subScalar(MIN * 4), mx = a.clone().max(b).addScalar(MIN * 4); let d2 = Infinity;
    f.verts.forEach((V, pi) => { for (let v = 0; v < V.length / 3; v++) { if (!keep[pi][v]) continue; const x = V[v * 3], y = V[v * 3 + 1], z = V[v * 3 + 2];
      if (x < mn.x || y < mn.y || z < mn.z || x > mx.x || y > mx.y || z > mx.z) continue;
      const px = x - a.x, py = y - a.y, pz = z - a.z; const t = Math.max(0, Math.min(1, (px * ab.x + py * ab.y + pz * ab.z) / L2));
      const dx = px - t * ab.x, dy = py - t * ab.y, dz = pz - t * ab.z; const q = dx * dx + dy * dy + dz * dz; if (q < d2) d2 = q; } });
    const d = Math.min(Math.sqrt(d2), MIN * 4); if (d < worst.d) worst = { d, t: f.t };
  }
  const ok = worst.d >= MIN; if (!ok) failed++;
  console.log(`${ok ? 'ok' : 'FAIL'} - ${key} ${weapon}: blade ${(blade.to - blade.from).toFixed(2)} m, min clearance ${worst.d >= MIN * 4 ? '>20' : (worst.d * 100).toFixed(1)} cm at t${worst.t.toFixed(2)}`);
}
console.log(failed ? `${failed} FAILED` : 'all clear');
process.exitCode = failed ? 1 : 0;
