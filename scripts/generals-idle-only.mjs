// Owner 2026-10-17: the generals screen shows the standing figure only. Each packed figure (LOD0/1/2) keeps one clip,
// idle_sword = Meshy 251 Idle 11 played on the SAME Meshy rig task, unedited (channels copied by joint name); every
// other clip is removed. The fetched clip's rig must match the figure's bind (inverse bind matrices rest rotations and relative offsets compared by joint).
//   node scripts/generals-idle-only.mjs --key=<general>__<armor> --from=<meshy anim glb with Idle_11>   (or --keep: strip only)
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from './lib/figure.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const dir = join(ROOT, 'public', 'models', 'generals');
// joint rest pose by name: rotations, and translations relative to the spine length (packing quantizes and rescales)
const rest = (doc) => { const s = doc.getRoot().listSkins()[0]; const m = new Map(); for (const j of s.listJoints()) m.set(j.getName(), { r: j.getRotation(), t: j.getTranslation() });
  const len = Math.hypot(...m.get('Spine').t) + Math.hypot(...m.get('Spine01').t) + Math.hypot(...m.get('neck').t); for (const v of m.values()) v.t = v.t.map((x) => x / len); return m; };
let clip = null;
if (!args.keep) {
  const src = await io.read(args.from);
  clip = src.getRoot().listAnimations().find((a) => /Idle_11/.test(a.getName()));
  if (!clip) throw new Error(`no Idle_11 in ${args.from}`);
  const live = rest(await io.read(join(dir, `${args.key}.glb`))), got = rest(src);
  let worst = 0; for (const [n, m] of live) { const o = got.get(n); if (!o) throw new Error(`joint ${n} missing in ${args.from}`); for (let i = 0; i < 4; i++) worst = Math.max(worst, Math.abs(Math.abs(m.r[i]) - Math.abs(o.r[i]))); for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(m.t[i] - o.t[i])); }
  if (worst > 0.01) throw new Error(`${args.key}: rig mismatch (rest pose differs by ${worst.toFixed(4)})`);
}
for (const suffix of ['', '_lod1', '_lod2']) {
  const file = join(dir, `${args.key}${suffix}.glb`);
  const doc = await io.read(file); const root = doc.getRoot();
  for (const a of root.listAnimations()) {
    if (args.keep && a.getName() === 'idle_sword') continue;
    a.listSamplers().forEach((s) => s.dispose()); a.listChannels().forEach((c) => c.dispose()); a.dispose();
  }
  if (clip) {
    const byName = new Map(root.listNodes().map((n) => [n.getName(), n])); const buffer = root.listBuffers()[0];
    const anim = doc.createAnimation('idle_sword');
    for (const ch of clip.listChannels()) {
      const node = byName.get(ch.getTargetNode()?.getName()); if (!node) continue; const s = ch.getSampler();
      const acc = (x) => doc.createAccessor().setType(x.getType()).setArray(x.getArray().slice()).setNormalized(x.getNormalized()).setBuffer(buffer);
      const sm = doc.createAnimationSampler().setInput(acc(s.getInput())).setOutput(acc(s.getOutput())).setInterpolation(s.getInterpolation());
      anim.addSampler(sm).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(ch.getTargetPath()).setSampler(sm));
    }
  }
  if (root.listAnimations().length !== 1) throw new Error(`${file}: ${root.listAnimations().length} clips`);
  await io.write(file, doc);
  console.log(`${args.key}${suffix}: idle_sword only`);
}
