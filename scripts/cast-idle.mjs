// Replaces the 'idle' clip of packed live generals with another Meshy library idle made on the same rig
// (<key>/motion-candidates/<tag>.glb), channel for channel by joint name, unedited. Works on the pre-shoulder
// originals (<key>/preshoulder/, first kept as <key>/preidle/), so run cast-shoulders.mjs afterwards.
//   node scripts/cast-idle.mjs --keys=a,b --tag=idle6 --clip=Idle_6
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from './lib/figure.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const PKG = join(ROOT, 'assets-src', 'generals-cast-2026-10-17');
for (const key of args.keys.split(',')) {
  const src = await io.read(join(PKG, key, 'motion-candidates', `${args.tag}.glb`));
  const clip = src.getRoot().listAnimations().find((a) => a.getName() === args.clip || a.getName().split('|').includes(args.clip));
  if (!clip) throw new Error(`${key}: no ${args.clip}`);
  for (const s of ['', '_lod1', '_lod2']) {
    const file = join(PKG, key, 'preshoulder', `${key}${s}.glb`);
    const keep = join(PKG, key, 'preidle', `${key}${s}.glb`);
    mkdirSync(join(PKG, key, 'preidle'), { recursive: true });
    if (!existsSync(keep)) copyFileSync(file, keep);
    const doc = await io.read(keep);
    for (const a of doc.getRoot().listAnimations()) if (a.getName() === 'idle') a.dispose();
    const byName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
    const buffer = doc.getRoot().listBuffers()[0];
    const copy = doc.createAnimation('idle');
    for (const ch of clip.listChannels()) {
      const target = byName.get(ch.getTargetNode().getName());
      if (!target) continue;
      const sm = ch.getSampler();
      const acc = (x) => doc.createAccessor().setType(x.getType()).setArray(x.getArray().slice()).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(acc(sm.getInput())).setOutput(acc(sm.getOutput())).setInterpolation(sm.getInterpolation());
      copy.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
    }
    await io.write(file, doc);
    console.log(key + s, 'idle ←', args.clip);
  }
}
