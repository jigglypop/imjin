// Pin the new, regenerated family inputs for deterministic local ornament work.
import { NodeIO } from '@gltf-transform/core';
import { Matrix4, Vector3 } from 'three';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const work = 'F:/codex-work/imjin/tongjesa-ornament-production';
await mkdir(work, { recursive: true });
const io = new NodeIO(), inputs = {};
for (const name of ['body_yi', 'armor_joseon_dujeong']) {
  const source = `F:/codex-work/imjin-regeneration-fit/${name}.glb`, dest = `${work}/${name}.snapshot.glb`;
  await copyFile(source, dest);
  const bytes = await readFile(dest), doc = await io.readBinary(bytes);
  const node = doc.getRoot().listNodes().find(n => n.getMesh() && n.getSkin());
  const skin = node.getSkin(), matrices = skin.listJoints().map((j,i)=>new Matrix4().fromArray(j.getWorldMatrix()).multiply(new Matrix4().fromArray(skin.getInverseBindMatrices().getArray(),i*16)));
  const bands = [{ name: 'shoulder', lo: 1.38, hi: 1.47 }, { name: 'waist', lo: .94, hi: 1.04 }, { name: 'shin', lo: .2, hi: .5 }];
  for (const band of bands) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const primitive of node.getMesh().listPrimitives()) {
      const p = primitive.getAttribute('POSITION'), v = new Vector3(), temp = new Vector3(), ja = primitive.getAttribute('JOINTS_0'), wa = primitive.getAttribute('WEIGHTS_0');
      for (let i = 0; i < p.getCount(); i++) {
        const js=ja.getElement(i,[]),ws=wa.getElement(i,[]); v.set(0,0,0);
        for(let k=0;k<4;k++) if(ws[k]) v.addScaledVector(temp.fromArray(p.getArray(),i*3).applyMatrix4(matrices[js[k]]),ws[k]);
        if (v.y < band.lo || v.y > band.hi) continue;
        if (band.name === 'shoulder' && (Math.abs(v.x) < .2 || Math.abs(v.x) > .38)) continue;
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v.getComponent(k)); max[k] = Math.max(max[k], v.getComponent(k)); }
      }
    }
    Object.assign(band, { min, max });
  }
  inputs[name] = { source, snapshot: dest, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, bands,
    joints: Object.fromEntries(doc.getRoot().listSkins()[0].listJoints().map(j => [j.getName(), j.getWorldTranslation()])),
    clips: doc.getRoot().listAnimations().map(a => a.getName()) };
}
await copyFile('F:/codex-work/imjin-regeneration-fit/body-preparation.json', `${work}/body-preparation.snapshot.json`);
await writeFile(`${work}/inputs.json`, JSON.stringify(inputs, null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(inputs).map(([name,input]) => [name,{sha256: input.sha256,bands:input.bands}])), null, 2));
