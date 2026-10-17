// Lowers both shoulders by a constant angle in every clip of packed general GLBs (the Meshy rigs are bound in a
// T-pose, so the library idles read as shrugged). Clip data only: mesh, skin and weights are untouched.
// The offset is a rotation about the body's forward axis, taken in the shoulder's parent (chest) frame at bind, so it
// follows the torso through every motion. Originals are kept once as <file>.preshoulder.glb in the cast folder.
//
//   node scripts/cast-shoulders.mjs --keys=yi__yi_tongjesa,... --deg=14 [--from-backup]
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from './lib/figure.mjs';
import { MeshoptEncoder } from 'meshoptimizer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : 'true']; }));
const deg = Number(args.deg ?? 14);
const keys = (args.keys ?? '').split(',').filter(Boolean);
const out = args.out; // optional folder to write into instead of public (for side-by-side tuning)

const mul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const inv = (q) => [-q[0], -q[1], -q[2], q[3]];
const axisAngle = (ax, rad) => [ax[0] * Math.sin(rad / 2), ax[1] * Math.sin(rad / 2), ax[2] * Math.sin(rad / 2), Math.cos(rad / 2)];
const norm = (q) => { const l = Math.hypot(...q); return q.map((v) => v / l); };

for (const key of keys) {
  for (const suffix of ['', '_lod1', '_lod2']) {
    const file = join(ROOT, 'public', 'models', 'generals', `${key}${suffix}.glb`);
    const backup = join(ROOT, 'assets-src', 'generals-cast-2026-10-17', key, 'preshoulder', basename(file));
    mkdirSync(dirname(backup), { recursive: true });
    if (!existsSync(backup)) copyFileSync(file, backup);
    const doc = await io.read(backup); // always from the original, so re-tuning never stacks
    const nodes = doc.getRoot().listNodes();
    const parentOf = new Map();
    for (const n of nodes) for (const c of n.listChildren()) parentOf.set(c, n);
    const worldRot = (n) => { let q = [0, 0, 0, 1]; for (let p = n; p; p = parentOf.get(p)) q = mul(p.getRotation(), q); return q; };
    for (const [name, sign] of [['LeftShoulder', -1], ['RightShoulder', 1]]) {
      const joint = nodes.find((n) => n.getName() === name);
      if (!joint) throw new Error(`${key}${suffix}: no ${name}`);
      const P = worldRot(parentOf.get(joint));
      // World +Z is the figure's forward; left arm (+X) goes down with a negative turn about it, right arm positive.
      const Q = norm(mul(mul(inv(P), axisAngle([0, 0, 1], (sign * deg * Math.PI) / 180)), P));
      const touched = new Set();
      for (const a of doc.getRoot().listAnimations()) {
        for (const ch of a.listChannels()) {
          if (ch.getTargetNode() !== joint || ch.getTargetPath() !== 'rotation') continue;
          const acc = ch.getSampler().getOutput();
          if (touched.has(acc)) continue;
          touched.add(acc);
          const arr = acc.getArray().slice();
          for (let i = 0; i < arr.length; i += 4) arr.set(norm(mul(Q, [arr[i], arr[i + 1], arr[i + 2], arr[i + 3]])), i);
          acc.setArray(arr);
        }
      }
      if (!touched.size) throw new Error(`${key}${suffix}: ${name} has no rotation track`);
    }
    const dest = out ? join(out, basename(file)) : file;
    if (out) mkdirSync(out, { recursive: true });
    await io.write(dest, doc);
    console.log(key + suffix, `shoulders -${deg}°`, dest);
  }
}
void MeshoptEncoder;
