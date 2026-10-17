// Replaces one clip of a packed commander figure (LOD0/1/2) with a Meshy library clip played on the SAME Meshy rig
// task (same skeleton, same bind): channels are copied by joint name, unedited. No retargeting, no weight changes.
//   node scripts/generals-swap-clip.mjs --key=<general>__<armor> --from=<meshy anim glb> --clip=<source clip> --as=attack_sword
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from './lib/figure.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const src = await io.read(args.from);
const clip = src.getRoot().listAnimations().find((a) => a.getName() === args.clip);
if (!clip) throw new Error(`no clip ${args.clip} in ${args.from}`);
const dir = args.dir ?? join(ROOT, 'public', 'models', 'generals');
for (const suffix of ['', '_lod1', '_lod2']) {
  const file = join(dir, `${args.key}${suffix}.glb`);
  const doc = await io.read(file);
  const root = doc.getRoot();
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  root.listAnimations().filter((a) => a.getName() === args.as).forEach((a) => { a.listSamplers().forEach((s) => s.dispose()); a.listChannels().forEach((c) => c.dispose()); a.dispose(); });
  const anim = doc.createAnimation(args.as);
  const buffer = root.listBuffers()[0];
  let copied = 0;
  for (const ch of clip.listChannels()) {
    const node = byName.get(ch.getTargetNode()?.getName());
    if (!node) continue;
    const s = ch.getSampler();
    const acc = (a) => doc.createAccessor().setType(a.getType()).setArray(a.getArray().slice()).setNormalized(a.getNormalized()).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(acc(s.getInput())).setOutput(acc(s.getOutput())).setInterpolation(s.getInterpolation());
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(ch.getTargetPath()).setSampler(sampler));
    copied++;
  }
  await io.write(file, doc);
  console.log(`${args.key}${suffix}: ${args.as} <- ${args.clip} (${copied} channels)`);
}
