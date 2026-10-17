// The default fixture is the immutable, actually rendered new-body snapshot.
// node scripts/test-ground-general-motion.mjs [snapshot.glb] [reference-curve.json]
// Writes no files: even the corrected GLB round-trip stays in memory.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { io } from './lib/figure.mjs';
import { groundGeneralMotions, measureGeneralFootContact, generalGeometryBindDigest } from './lib/ground-general-motion.mjs';

const snapshot = process.argv[2] ?? 'F:/codex-work/imjin-motion-review/68ff1511e76b/body_yi.snapshot.glb';
const curvePath = process.argv[3] ?? 'F:/codex-work/imjin-motion-review/68ff1511e76b/ground-contact-curve.json';
const bytes = await readFile(snapshot), sourceHash = createHash('sha256').update(bytes).digest('hex');
const reference = JSON.parse(await readFile(curvePath, 'utf8'));
assert.equal(sourceHash, reference.sourceSha256, 'independent curve belongs to these exact GLB bytes');
const source = await io.readBinary(bytes);
const baseline = measureGeneralFootContact(source, 'slash', { times: reference.curve.map(p => p.time) });
let referenceError = 0;
for (let i = 0; i < baseline.samples.length; i++) for (const side of ['left', 'right']) {
  referenceError = Math.max(referenceError, Math.abs(baseline.samples[i][side + 'FootMinY'] - reference.curve[i][side + 'FootMinY']));
}
assert.ok(referenceError < 2e-5, `actual skin measurement differs from the Blender-validated 131-frame curve by ${referenceError}`);
assert.equal(baseline.footVertices.left, 3292); assert.equal(baseline.footVertices.right, 2867);
console.log('ok - actual 131-frame shoe minima reproduce the independently Blender-validated curve');

function untouchedTracksDigest(doc) {
  const h = createHash('sha256');
  for (const clip of doc.getRoot().listAnimations()) for (const c of clip.listChannels()) {
    if (c.getTargetNode().getName() === 'Hips' && c.getTargetPath() === 'translation') continue;
    h.update(clip.getName() + c.getTargetNode().getName() + c.getTargetPath());
    for (const a of [c.getSampler().getInput(), c.getSampler().getOutput()]) {
      const v = a.getArray(); h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    }
  }
  return h.digest('hex');
}
const geometryBefore = generalGeometryBindDigest(source), motionBefore = untouchedTracksDigest(source);
const report = groundGeneralMotions(source, { clips: ['idle', 'slash', 'parry', 'command'] });
assert.equal(report.geometryAndBindUnchanged, true);
assert.equal(generalGeometryBindDigest(source), geometryBefore);
assert.equal(untouchedTracksDigest(source), motionBefore, 'all rotations/scales and non-Hips translations are byte-identical');
assert.equal(source.getRoot().listAnimations().length, 4);
for (const clip of report.clips) {
  assert.ok(clip.maximumContactErrorMeters < 2e-5);
  assert.ok(clip.afterMinimumY > .00198 && clip.afterMaximumMinimumY < .00202);
  const actual = measureGeneralFootContact(source, clip.clip, { times: clip.curve.map(p => p.time) });
  for (const frame of actual.samples) assert.ok(Math.abs(frame.minY - .002) < 2e-5);
  assert.equal(source.getRoot().listAnimations().find(a => a.getName() === clip.clip).listChannels().length, 72);
}
console.log('ok - all 852 original/baked frames of four real clips contact 2mm without changing geometry, binds, other joints or clip count');

const roundtrip = await io.readBinary(await io.writeBinary(source));
assert.equal(generalGeometryBindDigest(roundtrip), geometryBefore);
for (const clip of report.clips) {
  const actual = measureGeneralFootContact(roundtrip, clip.clip, { times: clip.curve.map(p => p.time) });
  for (const frame of actual.samples) assert.ok(Math.abs(frame.minY - .002) < 2e-5, `${clip.clip}@${frame.time} survived actual GLB serialization`);
}
console.log('ok - corrected animation and actual shoe contact survive an in-memory GLB write/read round-trip');

const twice = groundGeneralMotions(source, { clips: ['idle', 'slash', 'parry', 'command'] });
assert.ok(Math.max(...twice.clips.flatMap(c => c.curve.map(p => Math.abs(p.correctionMeters)))) < 2e-6);
assert.deepEqual(twice.clips.map(c => c.samples), report.clips.map(c => c.samples));
console.log('ok - repeating the bake is idempotent and does not keep adding duplicate sample times');

// Equivalent physical rig, but Hip local Y no longer points along world Y:
// a translated/rotated/scaled parent is inserted with inverse compensation.
const framed = await io.readBinary(bytes), hip = framed.getRoot().listNodes().find(n => n.getName() === 'Hips'), parent = hip.getParentNode();
const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), .61), inv = q.clone().invert();
const frameTransform = new Matrix4().compose(new Vector3(5, -3, 2), q, new Vector3(1.7, 1.7, 1.7));
const inverseFrame = frameTransform.clone().invert();
const frame = framed.createNode('GroundContactTestParent').setTranslation([5, -3, 2]).setRotation(q.toArray()).setScale([1.7, 1.7, 1.7]);
parent.addChild(frame); frame.addChild(hip);
hip.setTranslation(new Vector3(...hip.getTranslation()).applyMatrix4(inverseFrame).toArray());
hip.setRotation(inv.clone().multiply(new Quaternion(...hip.getRotation())).toArray());
hip.setScale(hip.getScale().map(v => v / 1.7));
const buffer = framed.getRoot().listBuffers()[0];
for (const animation of framed.getRoot().listAnimations()) for (const channel of animation.listChannels().filter(c => c.getTargetNode() === hip)) {
  const output = channel.getSampler().getOutput(), size = output.getElementSize(), array = new Float32Array(output.getArray().length);
  for (let i = 0; i < output.getCount(); i++) {
    const old = output.getElement(i, []); let value;
    if (channel.getTargetPath() === 'translation') value = new Vector3(...old).applyMatrix4(inverseFrame).toArray();
    else if (channel.getTargetPath() === 'rotation') value = inv.clone().multiply(new Quaternion(...old)).toArray();
    else value = old.map(v => v / 1.7);
    array.set(value, i * size);
  }
  channel.getSampler().setOutput(framed.createAccessor().setType(output.getType()).setArray(array).setBuffer(buffer));
}
const framedBefore = measureGeneralFootContact(framed, 'slash', { times: reference.curve.map(p => p.time) });
for (let i = 0; i < baseline.samples.length; i++) assert.ok(Math.abs(framedBefore.samples[i].minY - baseline.samples[i].minY) < 3e-6, 'inverse parent factoring preserves physical source positions');
const framedHipChannel = framed.getRoot().listAnimations().find(a => a.getName() === 'slash').listChannels().find(c => c.getTargetNode() === hip && c.getTargetPath() === 'translation');
const initialLocalX = framedHipChannel.getSampler().getOutput().getElement(0, [])[0];
const framedBind = generalGeometryBindDigest(framed);
const framedReport = groundGeneralMotions(framed, { clips: ['slash'] });
assert.equal(generalGeometryBindDigest(framed), framedBind);
assert.ok(Math.abs(framedHipChannel.getSampler().getOutput().getElement(0, [])[0] - initialLocalX) > .1, 'world-Y correction correctly uses local X as well as Y in the rotated parent frame');
assert.ok(framedReport.clips[0].maximumContactErrorMeters < 2e-5);
console.log('ok - world-floor contact converts correctly through a translated, rotated and scaled Hips parent frame');

// Animate that non-joint ancestor as well; the correction must use each frame,
// not a cached bind inverse or merely the armature's static scale.
const animatedParent = await io.readBinary(bytes), ah = animatedParent.getRoot().listNodes().find(n => n.getName() === 'Hips'), ap = ah.getParentNode();
const wrapper = animatedParent.createNode('AnimatedGroundContactParent'); ap.addChild(wrapper); wrapper.addChild(ah);
const slash = animatedParent.getRoot().listAnimations().find(a => a.getName() === 'slash'), ab = animatedParent.getRoot().listBuffers()[0];
const input = animatedParent.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 4.33333349])).setBuffer(ab);
const output = animatedParent.createAccessor().setType('VEC4').setArray(new Float32Array([0, 0, 0, 1, ...new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), .18).toArray()])).setBuffer(ab);
const sampler = animatedParent.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
slash.addSampler(sampler).addChannel(animatedParent.createAnimationChannel().setTargetNode(wrapper).setTargetPath('rotation').setSampler(sampler));
const animatedReport = groundGeneralMotions(animatedParent, { clips: ['slash'] });
assert.ok(animatedReport.clips[0].maximumContactErrorMeters < 2e-5);
console.log('ok - an animated non-joint ancestor uses its current frame transform for contact compensation');

const atomic = await io.readBinary(bytes), original = atomic.getRoot().listAnimations().map(a => a.listChannels().map(c => c.getSampler().getOutput().getArray()));
assert.throws(() => groundGeneralMotions(atomic, { clips: ['idle', 'absent'] }), /Missing animation absent/);
assert.deepEqual(atomic.getRoot().listAnimations().map(a => a.listChannels().map(c => c.getSampler().getOutput().getArray())), original);
console.log('ok - a missing requested clip fails before any animation is changed');
console.log(JSON.stringify({ clips: report.clips.map(c => ({ clip: c.clip, frames: c.samples, maxContactErrorMeters: c.maximumContactErrorMeters })), independentReferenceErrorMeters: referenceError, geometryAndBindUnchanged: true }));
