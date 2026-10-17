// Actual coordinate invariants across different provider names, spine order,
// centimeter/meter units, parent rotations, and non-animated helper joints.
import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import { Quaternion, Vector3 } from 'three';
import { io } from './lib/figure.mjs';
import { inspectGeneralRig, planGeneralBoneMap, retargetGeneralMotion, createGeneralMotionSampler, composeGeneralMotion } from './lib/new-general-motion.mjs';

const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const pointsNear = (a, b, tolerance = 1e-5) => a.forEach((x, i) => near(x, b[i], tolerance));
function fixture(tripo = false) {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene();
  const armature = doc.createNode('Armature'); scene.addChild(armature);
  if (tripo) armature.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).toArray()).setScale([1.8, 1.8, 1.8]).setTranslation([2, 0, -1]);
  const names = tripo ? ['Hip', 'Waist', 'Spine01', 'Spine02', 'NeckTwist02', 'Head'] : ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head'];
  const skin = doc.createSkin('Biped'), nodes = new Map();
  function add(name, pos, parent) { const n = doc.createNode(name).setTranslation(pos); parent.addChild(n); skin.addJoint(n); nodes.set(name, n); return n; }
  const hip = add(names[0], [0, 1, 0], armature); let spine = hip;
  for (let i = 1; i < names.length; i++) spine = add(names[i], [0, i === 5 ? .15 : .1, 0], spine);
  const chest = nodes.get(names[3]);
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const s = side[0];
    const shoulder = add(tripo ? s + '_Clavicle' : side + 'Shoulder', [sign * .08, .08, 0], chest);
    const upper = add(tripo ? s + '_Upperarm' : side + 'Arm', [sign * .12, 0, 0], shoulder);
    const fore = add(tripo ? s + '_Forearm' : side + 'ForeArm', [sign * .3, 0, 0], upper);
    add(tripo ? s + '_Hand' : side + 'Hand', [sign * .3, 0, 0], fore);
    if (tripo) add(s + '_ForearmTwist01', [0, 0, 0], fore);
    const thigh = add(tripo ? s + '_Thigh' : side + 'UpLeg', [sign * .1, -.1, 0], hip);
    const calf = add(tripo ? s + '_Calf' : side + 'Leg', [0, -.4, 0], thigh);
    const foot = add(tripo ? s + '_Foot' : side + 'Foot', [0, -.4, 0], calf);
    add(tripo ? s + '_ToeBase' : side + 'ToeBase', [0, 0, .12], foot);
  }
  skin.setSkeleton(hip);
  return { doc, nodes, buffer };
}
function addMotion(f, name = 'cut', interpolation = 'LINEAR') {
  const a = f.doc.createAnimation(name), time = f.doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(f.buffer);
  function channel(joint, path, values) {
    const output = f.doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(new Float32Array(values)).setBuffer(f.buffer);
    const s = f.doc.createAnimationSampler().setInput(time).setOutput(output).setInterpolation(interpolation);
    a.addSampler(s).addChannel(f.doc.createAnimationChannel().setTargetNode(f.nodes.get(joint)).setTargetPath(path).setSampler(s));
  }
  channel('Hips', 'translation', [0, 1, 0, .4, .8, .2]);
  channel('RightArm', 'rotation', [0, 0, 0, 1, ...new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), .65).toArray()]);
  channel('RightForeArm', 'rotation', [0, 0, 0, 1, ...new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1).toArray()]);
}

const source = fixture(); addMotion(source);
const target = fixture(true);
const before = JSON.stringify(inspectGeneralRig(target.doc));
const socket = target.doc.createNode('socket_grip').setTranslation([.03, 0, 0]); target.nodes.get('R_Hand').addChild(socket);
const plan = planGeneralBoneMap(target.doc, source.doc);
assert.deepEqual(plan.sourceSpineOrder, ['Spine02', 'Spine01', 'Spine']);
assert.deepEqual(plan.targetSpineOrder, ['Waist', 'Spine01', 'Spine02']);
assert.equal(plan.mapped.find(x => x.target === 'Waist').source, 'Spine02');
assert.equal(plan.mapped.find(x => x.target === 'Spine02').source, 'Spine');
near(plan.scale, 1.8);
const report = retargetGeneralMotion(target.doc, source.doc, { clip: 'cut', name: 'sword', rootMotion: 'preserve' }).report;
near(report.maximumHorizontalTravelMeters, Math.hypot(.4, .2) * 1.8);
assert.equal(JSON.stringify(inspectGeneralRig(target.doc)), before, 'bind transforms unchanged');
assert.deepEqual(socket.getTranslation(), [.03, 0, 0], 'weapon socket unchanged');
assert.equal(source.doc.getRoot().listAnimations().length, 1, 'source remains unchanged');

const from = createGeneralMotionSampler(source.doc, 'cut'), to = createGeneralMotionSampler(target.doc, 'sword');
const align = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), offset = new Vector3(2, 0, -1);
for (const time of [0, .25, .5, .75, 1]) {
  const s = from(time).canonical, t = to(time).canonical;
  for (const bone of ['hips', 'rightUpperArm', 'rightForeArm', 'rightHand', 'leftFoot', 'rightFoot', 'head']) {
    const expected = new Vector3(...s[bone].position).multiplyScalar(1.8).applyQuaternion(align).add(offset);
    pointsNear(t[bone].position, expected.toArray(), 2e-4);
    near(new Quaternion(...t[bone].rotation).length(), 1);
  }
}
console.log('ok - provider names, reversed spine numbers, rotated frame and unit scale preserve physical hand/foot/head trajectories');

const inPlace = fixture(true);
const ip = retargetGeneralMotion(inPlace.doc, source.doc, { clip: 'cut', name: 'cut', rootMotion: 'in-place' }).report;
near(ip.maximumHorizontalTravelMeters, 0);
const ipPose = createGeneralMotionSampler(inPlace.doc, 'cut');
near(ipPose(1).canonical.hips.position[1], 1.8 * .8);
console.log('ok - in-place removes travel while preserving the crouch');

const bounded = fixture(true);
const boundedReport = retargetGeneralMotion(bounded.doc, source.doc, { clip: 'cut', name: 'cut', rootMotion: 'bounded', maxTravel: .15, start: .25, end: 1, speed: 1.5 }).report;
near(boundedReport.durationSeconds, .5); near(boundedReport.horizontalEndDeltaMeters, 0);
assert.ok(boundedReport.maximumHorizontalTravelMeters <= .15 + 1e-6);
console.log('ok - trimmed/sped clip retains zero horizontal end drift');

const step = fixture(); addMotion(step, 'step', 'STEP');
const stepTarget = fixture(true); retargetGeneralMotion(stepTarget.doc, step.doc, { clip: 'step', rootMotion: 'preserve' });
const stepped = createGeneralMotionSampler(stepTarget.doc, 'step');
pointsNear(stepped(.5).canonical.rightHand.position, stepped(0).canonical.rightHand.position);
assert.ok(new Vector3(...stepped(1).canonical.rightHand.position).distanceTo(new Vector3(...stepped(0).canonical.rightHand.position)) > .2);
console.log('ok - STEP interpolation does not invent movement between source keys');

const cubic = fixture(), cubicAnim = cubic.doc.createAnimation('cubic');
const ct = cubic.doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(cubic.buffer);
const co = cubic.doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, .4, 1, 0, 0, 0, 0])).setBuffer(cubic.buffer);
const cs = cubic.doc.createAnimationSampler().setInput(ct).setOutput(co).setInterpolation('CUBICSPLINE');
cubicAnim.addSampler(cs).addChannel(cubic.doc.createAnimationChannel().setTargetNode(cubic.nodes.get('Hips')).setTargetPath('translation').setSampler(cs));
near(createGeneralMotionSampler(cubic.doc, 'cubic')(.25).canonical.hips.position[0], .0625);
console.log('ok - cubic spline tangents follow the glTF Hermite curve');

const sequence = composeGeneralMotion(target.doc, ['sword', 'sword'], { name: 'two_cuts', overlap: .2, fps: 60 }).report;
near(sequence.durationSeconds, 1.8);
const sequencePose = createGeneralMotionSampler(target.doc, 'two_cuts');
pointsNear(sequencePose(0).canonical.rightHand.position, to(0).canonical.rightHand.position);
pointsNear(sequencePose(1.8).canonical.rightHand.position, to(1).canonical.rightHand.position);
for (const boundary of [.8, 1]) {
  const a = new Vector3(...sequencePose(boundary - .001).canonical.rightHand.position), b = new Vector3(...sequencePose(boundary + .001).canonical.rightHand.position);
  assert.ok(a.distanceTo(b) < .02, 'sequence overlap has no hand teleport at the boundary');
}
console.log('ok - composed cuts preserve endpoints and crossfade without a boundary hand teleport');

assert.throws(() => retargetGeneralMotion(target.doc, source.doc, { clip: 'missing' }), /Missing source/);
assert.throws(() => retargetGeneralMotion(target.doc, source.doc, { clip: 'cut', name: 'sword' }), /already exists/);
const broken = fixture(true); broken.nodes.get('R_Hand').setName('UnknownRightHand');
assert.throws(() => planGeneralBoneMap(broken.doc, source.doc), /missing rightHand/);
const explicit = planGeneralBoneMap(broken.doc, source.doc, { targetBones: { rightHand: 'UnknownRightHand' } });
assert.equal(explicit.mapped.find(x => x.target === 'UnknownRightHand').source, 'RightHand');
console.log('ok - missing critical bones/clips and duplicate targets fail explicitly');

// Probe the actual files, not just the naming fixtures.
const actualSource = await io.read('assets-src/generals-3d-2026-10-16/motions.glb');
const actualTarget = await io.read('assets-src/generals-parts-2026-10-17/body_yi_tripo_rig.glb');
const realPlan = planGeneralBoneMap(actualTarget, actualSource);
assert.equal(realPlan.mapped.find(x => x.target === 'Hip').source, 'Hips');
assert.equal(realPlan.mapped.find(x => x.target === 'R_Hand').source, 'RightHand');
assert.equal(realPlan.mapped.find(x => x.target === 'Waist').source, 'Spine02');
assert.equal(realPlan.mapped.find(x => x.target === 'Spine02').source, 'Spine');
assert.ok(realPlan.inheritedBindJoints.includes('Pelvis') && realPlan.inheritedBindJoints.includes('R_ForearmTwist01'));
const real = retargetGeneralMotion(actualTarget, actualSource, { clip: 'Right_Hand_Sword_Slash', name: 'offline_slash', rootMotion: 'bounded', maxTravel: .25 }).report;
assert.equal(real.sourceJoints, 24); assert.equal(real.targetJoints, 41); near(real.durationSeconds, 1.5);
assert.ok(real.maximumHorizontalTravelMeters <= .25 + 1e-7);
const poseAt = createGeneralMotionSampler(actualTarget, 'offline_slash');
const rightHand = [];
for (let i = 0; i <= 30; i++) {
  const p = poseAt(i / 20);
  for (const joint of p.joints) { assert.ok(joint.position.every(Number.isFinite)); near(new Quaternion(...joint.rotation).length(), 1, 1e-5); }
  rightHand.push(new Vector3(...p.canonical.rightHand.position));
}
assert.ok(Math.max(...rightHand.map(p => p.distanceTo(rightHand[0]))) > .1, 'actual right hand moves through a visible cut');
console.log('ok - actual Meshy 24-joint sword motion maps to Tripo 41-joint rig with finite normalized motion');
const roundtrip = await io.readBinary(await io.writeBinary(actualTarget));
const exported = roundtrip.getRoot().listAnimations().find(a => a.getName() === 'offline_slash');
assert.equal(exported.listChannels().length, 123);
near(createGeneralMotionSampler(roundtrip, 'offline_slash')(1).canonical.rightHand.position[1], poseAt(1).canonical.rightHand.position[1], 1e-6);
const meshyBody = await io.read('assets-src/generals-parts-2026-10-17/body_yi_rig.glb');
const meshyReport = retargetGeneralMotion(meshyBody, actualSource, { clip: 'Right_Hand_Sword_Slash', name: 'mesh_body_slash' }).report;
assert.equal(meshyReport.mappedJoints, 24);
console.log('ok - real GLB round-trip preserves the animation, and the current Meshy body family maps all 24 joints');
const existingCombo = await io.read('assets-src/generals-3d-2026-10-16/anim-v2/yi_joseon_dujeong.glb');
const comboReport = retargetGeneralMotion(meshyBody, existingCombo, { clip: 'Triple_Combo_Attack', name: 'existing_three_hit_combo', rootMotion: 'bounded', maxTravel: .25 }).report;
near(comboReport.durationSeconds, 4.33333349, 1e-6); assert.equal(comboReport.mappedJoints, 24);
near(comboReport.horizontalEndDeltaMeters, 0, 1e-6); assert.ok(comboReport.maximumHorizontalTravelMeters <= .250001);
const sampleCombo = createGeneralMotionSampler(meshyBody, 'existing_three_hit_combo');
const armLengths = [];
for (let i = 0; i <= 90; i++) {
  const pose = sampleCombo(comboReport.durationSeconds * i / 90).canonical;
  assert.ok(Object.values(pose).every(p => p.position.every(Number.isFinite) && p.rotation.every(Number.isFinite)));
  armLengths.push(new Vector3(...pose.rightHand.position).distanceTo(new Vector3(...pose.rightForeArm.position)));
}
assert.ok(Math.max(...armLengths) - Math.min(...armLengths) < 1e-5, 'retargeted combo never stretches the new sword forearm');
console.log('ok - previously purchased real three-hit action 105 retargets all 24 joints without forearm stretching or end drift');
console.log(JSON.stringify(process.argv.includes('--verbose') ? { actualMapping: realPlan, actualMotion: real } : {
  actualSourceJoints: real.sourceJoints, actualTargetJoints: real.targetJoints,
  mappedJoints: real.mappedJoints, unchangedHelperJoints: real.retainedLocalBindJoints.length,
  durationSeconds: real.durationSeconds, boundedTravelMeters: real.maximumHorizontalTravelMeters,
  endDriftMeters: real.horizontalEndDeltaMeters, scale: real.scale,
}));
