// Actual source and exported skin geometry: catches centimetre/metre mistakes before browser assembly.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3, Box3 } from 'three';
import { io } from './lib/figure.mjs';
import { createGeneralWorldMatrixSampler } from './lib/new-general-motion.mjs';

function points(doc, pose) {
  const result = [];
  for (const node of doc.getRoot().listNodes().filter(n => n.getMesh() && n.getSkin())) {
    const skin = node.getSkin();
    const joints = skin.listJoints();
    const transforms = joints.map((j,i) => new Matrix4().fromArray(pose?.get(j) ?? j.getWorldMatrix()).multiply(new Matrix4().fromArray(skin.getInverseBindMatrices().getElement(i, []))));
    for (const p of node.getMesh().listPrimitives()) {
      const pos = p.getAttribute('POSITION'), js = p.getAttribute('JOINTS_0'), ws = p.getAttribute('WEIGHTS_0');
      for (let i=0;i<pos.getCount();i++) {
        const v = new Vector3(...pos.getElement(i, [])), out = new Vector3(), ids = js.getElement(i, []), weights=ws.getElement(i, []);
        for (let k=0;k<4;k++) if(weights[k]) out.addScaledVector(v.clone().applyMatrix4(transforms[ids[k]]),weights[k]);
        result.push(out);
      }
    }
  }
  return result;
}
const body = await io.read('public/models/generals/parts/v2/body_yi.glb');
const coat = await io.read('public/models/generals/parts/v2/armor_joseon_dujeong.glb');
for (const [name,doc] of [['body',body],['coat',coat]]) {
  const box = new Box3().setFromPoints(points(doc)); const size=box.getSize(new Vector3());
  assert.ok(size.x>.3 && size.x<2 && size.y>.5 && size.y<2.1 && size.z<.8, `${name} skin bounds are not metres: ${size.toArray()}`);
  assert.ok(box.min.y>-.02 && box.max.y<2.1, `${name} skin elevation is wrong`);
  console.log(`ok - ${name} actual bind skin is in metres`, size.toArray().map(x=>x.toFixed(3)).join('x'));
}
const raw=await io.read('assets-src/generals-regeneration-2026-10-17/raw/body-rig/rigged_character_glb_url.glb');
const prepared=await io.read('F:/codex-work/imjin-regeneration-fit/body_yi.glb');
const report=JSON.parse(readFileSync('F:/codex-work/imjin-regeneration-fit/body-preparation.json','utf8'));
assert.ok(report.changed[0].vertices>1000,'head deformation changed no vertices');
const pivot=new Vector3(...report.headPivot), a=points(raw),b=points(prepared);
assert.equal(a.length,b.length,'new source topology changed');
let headCount=0;
for(let i=0;i<a.length;i++) if(a[i].y>pivot.y+.025) {
  const expected=a[i].clone().sub(pivot).multiplyScalar(.9).add(pivot);
  assert.ok(expected.distanceTo(b[i])<1e-5,'head is not actually 90 percent of source'); headCount++;
}
assert.ok(headCount>1000);
console.log('ok - actual new head geometry is reduced to 90 percent',headCount,'vertices');
for(const name of ['socket_grip_right','socket_grip_left','socket_helmet_brow']) assert.ok(body.getRoot().listNodes().some(n=>n.getName()===name),`${name} removed by compression`);
const sourceJoints=body.getRoot().listSkins()[0].listJoints();
const coatJoints=coat.getRoot().listSkins()[0].listJoints();
for(const j of sourceJoints) {
  const other=coatJoints.find(n=>n.getName()===j.getName()); assert.ok(other);
  const a=j.getWorldMatrix(),b=other.getWorldMatrix();
  assert.ok(a.every((x,i)=>Math.abs(x-b[i])<1e-5),'armor skeleton rest differs');
}
console.log('ok - compressed sockets and body/coat rest frames agree');
const sampler=createGeneralWorldMatrixSampler(prepared,'slash');
assert.ok(sampler);
assert.equal(body.getRoot().listAnimations().find(a=>a.getName()==='slash').getExtras().retarget.sourceClip,'Triple_Combo_Attack');
console.log('ok - actual 3-hit animation provenance retained');
console.log('pilot geometry checks passed; artistic fit and motion remain browser review requirements');
