// Offline, provider-independent biped motion transfer for the wardrobe.
// glTF documents in, target animation out. Never changes geometry, weights,
// bind transforms, sockets, or the source document. No network operations.
import { Matrix4, Quaternion, Vector3 } from 'three';

const Q = () => new Quaternion();
const V = a => new Vector3(...a);
const unit = new Vector3(0, 1, 0);
const EPS = 1e-7;
const clean = s => s.split(/[:|]/).at(-1).replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const ALIASES = {
  hips: ['hips', 'hip', 'pelvis'], head: ['head'], neck: ['neck', 'necktwist02', 'necktwist01'],
  leftShoulder: ['leftshoulder', 'lclavicle', 'leftclavicle'], rightShoulder: ['rightshoulder', 'rclavicle', 'rightclavicle'],
  leftUpperArm: ['leftarm', 'lupperarm', 'leftupperarm'], rightUpperArm: ['rightarm', 'rupperarm', 'rightupperarm'],
  leftForeArm: ['leftforearm', 'lforearm', 'leftlowerarm'], rightForeArm: ['rightforearm', 'rforearm', 'rightlowerarm'],
  leftHand: ['lefthand', 'lhand'], rightHand: ['righthand', 'rhand'],
  leftThigh: ['leftupleg', 'lthigh', 'leftthigh'], rightThigh: ['rightupleg', 'rthigh', 'rightthigh'],
  leftCalf: ['leftleg', 'lcalf', 'leftlowerleg'], rightCalf: ['rightleg', 'rcalf', 'rightlowerleg'],
  leftFoot: ['leftfoot', 'lfoot'], rightFoot: ['rightfoot', 'rfoot'],
  leftToe: ['lefttoebase', 'ltoebase', 'lefttoe'], rightToe: ['righttoebase', 'rtoebase', 'righttoe'],
};
const REQUIRED = ['hips', 'head', 'leftUpperArm', 'leftForeArm', 'leftHand', 'rightUpperArm', 'rightForeArm', 'rightHand', 'leftThigh', 'leftCalf', 'leftFoot', 'rightThigh', 'rightCalf', 'rightFoot'];

function rigOf(doc, skinIndex = 0, explicit = {}) {
  const skin = doc.getRoot().listSkins()[skinIndex];
  if (!skin) throw new Error(`No skin at index ${skinIndex}. A skinned biped is required.`);
  const joints = new Set(skin.listJoints());
  const records = [], byNode = new Map(), byName = new Map();
  function walk(node, parent) {
    if (byNode.has(node)) return;
    const local = new Matrix4().compose(V(node.getTranslation()), new Quaternion(...node.getRotation()), V(node.getScale()));
    const world = parent ? parent.world.clone().multiply(local) : local;
    const position = new Vector3(), rotation = Q(), scale = new Vector3(); world.decompose(position, rotation, scale);
    const record = { node, parent, world, position, rotation: rotation.normalize(), scale, depth: parent ? parent.depth + 1 : 0,
      localPosition: V(node.getTranslation()), localRotation: new Quaternion(...node.getRotation()).normalize(), localScale: V(node.getScale()), joint: joints.has(node) };
    records.push(record); byNode.set(node, record);
    if (record.joint) {
      if (byName.has(node.getName())) throw new Error(`Duplicate skeleton joint name: ${node.getName()}`);
      byName.set(node.getName(), record);
    }
    for (const child of node.listChildren()) walk(child, record);
  }
  for (const scene of doc.getRoot().listScenes()) for (const node of scene.listChildren()) walk(node, null);
  const canonical = new Map();
  for (const [key, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      const matches = [...byName.values()].filter(r => clean(r.node.getName()) === alias);
      if (matches.length > 1) throw new Error(`Ambiguous ${key}: ${matches.map(r => r.node.getName()).join(', ')}`);
      if (matches.length) { canonical.set(key, matches[0]); break; }
    }
  }
  // Meshy numbers its chain Spine02 -> Spine01 -> Spine; Tripo uses
  // Waist -> Spine01 -> Spine02. Names alone invert their torso motion.
  for (const [key, name] of Object.entries(explicit)) {
    if (key === 'spineOrder') continue;
    const bone = byName.get(name);
    if (!bone) throw new Error(`Explicit ${key} bone ${name} does not exist.`);
    canonical.set(key, bone);
  }
  const spines = explicit.spineOrder ? explicit.spineOrder.map(name => {
    const bone = byName.get(name); if (!bone) throw new Error(`Explicit spine bone ${name} does not exist.`); return bone;
  }) : [...byName.values()].filter(r => /^(spine\d*|waist|chest|upperchest)$/.test(clean(r.node.getName()))).sort((a, b) => a.depth - b.depth);
  if (!spines.length) throw new Error('No supported spine chain was found. Supply an explicit mapping for this rig.');
  for (let i = 1; i < spines.length; i++) {
    let p = spines[i].parent;
    while (p && p !== spines[i - 1]) p = p.parent;
    if (!p) throw new Error('Spine candidates do not form one ancestry chain.');
  }
  canonical.set('spine', spines[0]); canonical.set('chest', spines.at(-1));
  const missing = REQUIRED.filter(key => !canonical.has(key));
  if (missing.length) throw new Error(`Unsupported or incomplete biped skeleton; missing ${missing.join(', ')}.`);
  // Infer anatomical facing, rather than assuming the two provider rigs face
  // the same world axis. Current Meshy faces +Z; current Tripo faces +X.
  const across = canonical.get('leftUpperArm').position.clone().sub(canonical.get('rightUpperArm').position); across.y = 0;
  if (across.length() < EPS) throw new Error('Cannot infer facing from coincident shoulders.');
  across.normalize(); const forward = across.clone().cross(unit).normalize();
  const frame = Q().setFromRotationMatrix(new Matrix4().makeBasis(across, unit, forward));
  const hip = canonical.get('hips'); const feet = ['leftFoot', 'rightFoot'].map(k => canonical.get(k));
  const legHeight = hip.position.y - (feet[0].position.y + feet[1].position.y) / 2;
  if (!(legHeight > .01)) throw new Error('Skeleton is not in an upright glTF Y-up bind pose.');
  return { records, byNode, byName, canonical, spines, frame, forward, legHeight };
}

export function inspectGeneralRig(doc, options = {}) {
  const r = rigOf(doc, options.skinIndex, options.bones);
  return { joints: r.byName.size, bones: [...r.byName.keys()], canonical: Object.fromEntries([...r.canonical].map(([k, v]) => [k, v.node.getName()])),
    spineOrder: r.spines.map(n => n.node.getName()), facing: r.forward.toArray(), legHeightMeters: r.legHeight };
}

function boneMap(source, target, overrides = {}) {
  const result = new Map(), reasons = new Map();
  for (const [key, t] of target.canonical) {
    const s = source.canonical.get(key);
    if (s) { result.set(t, s); reasons.set(t, key); }
  }
  // Spread ordered torso matches across either provider's chain length.
  target.spines.forEach((t, i) => {
    const ix = target.spines.length < 2 ? source.spines.length - 1 : Math.round(i * (source.spines.length - 1) / (target.spines.length - 1));
    result.set(t, source.spines[ix]); reasons.set(t, 'ordered-spine');
  });
  for (const t of target.byName.values()) if (!result.has(t) && source.byName.has(t.node.getName())) {
    result.set(t, source.byName.get(t.node.getName())); reasons.set(t, 'same-name');
  }
  for (const [targetName, sourceName] of Object.entries(overrides)) {
    const t = target.byName.get(targetName), s = source.byName.get(sourceName);
    if (!t || !s) throw new Error(`Invalid explicit bone map: ${targetName} <- ${sourceName}`);
    result.set(t, s); reasons.set(t, 'explicit');
  }
  return { pairs: result, reasons };
}

export function planGeneralBoneMap(targetDoc, sourceDoc, options = {}) {
  const source = rigOf(sourceDoc, options.sourceSkinIndex, options.sourceBones), target = rigOf(targetDoc, options.targetSkinIndex, options.targetBones);
  const map = boneMap(source, target, options.boneMap);
  const alignment = target.frame.clone().multiply(source.frame.clone().invert()).normalize();
  return { scale: target.legHeight / source.legHeight, facingAlignmentQuaternion: alignment.toArray(),
    sourceSpineOrder: source.spines.map(n => n.node.getName()), targetSpineOrder: target.spines.map(n => n.node.getName()),
    mapped: [...map.pairs].map(([t, s]) => ({ target: t.node.getName(), source: s.node.getName(), reason: map.reasons.get(t) })),
    inheritedBindJoints: [...target.byName.values()].filter(t => !map.pairs.has(t)).map(t => t.node.getName()) };
}

/** glTF STEP, LINEAR and CUBICSPLINE tracks; quaternions always normalize. */
function samplerAt(channel) {
  const sampler = channel.getSampler(), input = sampler.getInput(), output = sampler.getOutput();
  const times = input.getArray(), size = output.getElementSize(), path = channel.getTargetPath();
  const interpolation = sampler.getInterpolation();
  const element = index => output.getElement(index, new Array(size).fill(0));
  return time => {
    let lo = 0, hi = times.length - 1;
    while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (times[m] <= time) lo = m; else hi = m - 1; }
    const i = lo, j = Math.min(i + 1, times.length - 1);
    const dt = times[j] - times[i], t = dt > 0 ? Math.max(0, Math.min(1, (time - times[i]) / dt)) : 0;
    let a;
    if (interpolation === 'CUBICSPLINE') {
      const x = element(i * 3 + 1), y = element(j * 3 + 1), v = element(i * 3 + 2), w = element(j * 3);
      const t2 = t * t, t3 = t2 * t;
      a = x.map((value, k) => (2 * t3 - 3 * t2 + 1) * value + (t3 - 2 * t2 + t) * dt * v[k] + (-2 * t3 + 3 * t2) * y[k] + (t3 - t2) * dt * w[k]);
    } else if (interpolation === 'STEP' || i === j) a = element(i);
    else if (path === 'rotation') return new Quaternion(...element(i)).normalize().slerp(new Quaternion(...element(j)).normalize(), t).toArray();
    else { const x = element(i), y = element(j); a = x.map((value, k) => value + (y[k] - value) * t); }
    return path === 'rotation' ? new Quaternion(...a).normalize().toArray() : a;
  };
}

function animationReader(rig, clip) {
  const channels = new Map();
  for (const channel of clip.listChannels()) {
    const node = channel.getTargetNode(), path = channel.getTargetPath();
    if (!['rotation', 'translation', 'scale'].includes(path)) continue;
    if (!channels.has(node)) channels.set(node, {});
    channels.get(node)[path] = samplerAt(channel);
  }
  return time => {
    const placed = new Map();
    for (const r of rig.records) {
      const tracks = channels.get(r.node);
      const position = tracks?.translation ? V(tracks.translation(time)) : r.localPosition;
      const rotation = tracks?.rotation ? new Quaternion(...tracks.rotation(time)) : r.localRotation;
      const scale = tracks?.scale ? V(tracks.scale(time)) : r.localScale;
      const matrix = new Matrix4().compose(position, rotation, scale);
      if (r.parent) matrix.premultiply(placed.get(r.parent).matrix);
      const wp = new Vector3(), wq = Q(), ws = new Vector3(); matrix.decompose(wp, wq, ws);
      placed.set(r, { matrix, position: wp, rotation: wq.normalize() });
    }
    return placed;
  };
}

/** Read-only pose sampler for audits, bone-stick previews and retarget checks. */
export function createGeneralMotionSampler(doc, clipName, options = {}) {
  const rig = rigOf(doc, options.skinIndex, options.bones);
  const clip = doc.getRoot().listAnimations().find(a => a.getName() === clipName);
  if (!clip) throw new Error(`Missing source animation: ${clipName}`);
  const read = animationReader(rig, clip);
  return time => {
    const pose = read(time);
    return { canonical: Object.fromEntries([...rig.canonical].map(([key, r]) => [key, { position: pose.get(r).position.toArray(), rotation: pose.get(r).rotation.toArray() }])),
      joints: [...rig.byName.values()].map(r => ({ name: r.node.getName(), parent: r.parent?.node.getName(), position: pose.get(r).position.toArray(), rotation: pose.get(r).rotation.toArray() })) };
  };
}

/** Exact world matrices, including animated ancestor scale, for offline skin
 * evaluation. Keys are the document's own Node objects; nothing is mutated. */
export function createGeneralWorldMatrixSampler(doc, clipName, options = {}) {
  const rig = rigOf(doc, options.skinIndex, options.bones);
  const clip = doc.getRoot().listAnimations().find(a => a.getName() === clipName);
  if (!clip) throw new Error(`Missing source animation: ${clipName}`);
  const read = animationReader(rig, clip);
  return time => new Map([...read(time)].map(([record, pose]) => [record.node, pose.matrix]));
}

/**
 * Retarget one clip. rootMotion: 'bounded' preserves small steps and removes
 * end-to-end horizontal drift; 'in-place' removes horizontal travel entirely;
 * 'preserve' retains scaled travel. Vertical crouches and all body turns remain.
 * Returned report names every actual source/target joint and measurable limit.
 */
export function retargetGeneralMotion(targetDoc, sourceDoc, options = {}) {
  const { clip: clipName, name = clipName, fps = 30, speed = 1, start = 0, rootMotion = 'bounded', maxTravel = .35, replace = false } = options;
  if (!(fps >= 1 && fps <= 120 && speed > 0)) throw new Error('fps must be 1..120 and speed must be positive.');
  if (!['bounded', 'in-place', 'preserve'].includes(rootMotion)) throw new Error('Unsupported rootMotion policy.');
  const clip = sourceDoc.getRoot().listAnimations().find(a => a.getName() === clipName);
  if (!clip) throw new Error(`Missing source animation: ${clipName}`);
  const duration = Math.max(...clip.listSamplers().map(s => s.getInput().getMax([])[0]));
  const end = options.end ?? duration;
  if (!(start >= 0 && end > start && end <= duration + EPS)) throw new Error(`Invalid source range ${start}..${end} for ${duration}s clip.`);
  const existing = targetDoc.getRoot().listAnimations().find(a => a.getName() === name);
  if (existing && !replace) throw new Error(`Target animation ${name} already exists; pass replace:true to replace only that clip.`);
  const source = rigOf(sourceDoc, options.sourceSkinIndex, options.sourceBones), target = rigOf(targetDoc, options.targetSkinIndex, options.targetBones), map = boneMap(source, target, options.boneMap);
  const alignment = target.frame.clone().multiply(source.frame.clone().invert()).normalize(), invAlignment = alignment.clone().invert();
  const scale = options.scale ?? target.legHeight / source.legHeight;
  if (!(scale > 0 && Number.isFinite(scale))) throw new Error('Invalid source/target skeleton scale.');
  const read = animationReader(source, clip), sHip = source.canonical.get('hips'), tHip = target.canonical.get('hips');
  const firstHip = read(start).get(sHip).position, lastHip = read(end).get(sHip).position;
  const seconds = (end - start) / speed; const times = [];
  for (let i = 0; i / fps < seconds - EPS; i++) times.push(i / fps);
  times.push(seconds);
  const arrays = new Map([...target.byName.values()].map(r => [r, { rotation: new Float32Array(times.length * 4), translation: new Float32Array(times.length * 3), scale: new Float32Array(times.length * 3) }]));
  let largestTravel = 0; const hipsDisplacements = [];
  for (let k = 0; k < times.length; k++) {
    const sourceTime = start + times[k] * speed, pose = read(sourceTime), placed = new Map();
    const hipNow = pose.get(sHip).position;
    const delta = hipNow.clone().sub(firstHip);
    if (rootMotion === 'in-place') { delta.x = 0; delta.z = 0; }
    else if (rootMotion === 'bounded') { const alpha = times[k] / seconds; delta.x -= (lastHip.x - firstHip.x) * alpha; delta.z -= (lastHip.z - firstHip.z) * alpha; }
    delta.y = hipNow.y - sHip.position.y;
    delta.applyQuaternion(alignment).multiplyScalar(scale);
    if (rootMotion === 'bounded') {
      const horizontal = Math.hypot(delta.x, delta.z);
      if (horizontal > maxTravel) { delta.x *= maxTravel / horizontal; delta.z *= maxTravel / horizontal; }
    }
    largestTravel = Math.max(largestTravel, Math.hypot(delta.x, delta.z)); hipsDisplacements.push(delta.toArray());
    for (const t of target.records) {
      const parentWorld = t.parent ? placed.get(t.parent) : { rotation: Q(), matrix: new Matrix4() };
      let local = t.localRotation.clone();
      const s = map.pairs.get(t);
      if (s) {
        const worldDelta = pose.get(s).rotation.clone().multiply(s.rotation.clone().invert());
        const desiredWorld = alignment.clone().multiply(worldDelta).multiply(invAlignment).multiply(t.rotation).normalize();
        local = parentWorld.rotation.clone().invert().multiply(desiredWorld).normalize();
      }
      let position = t.localPosition.clone();
      if (t === tHip) position = tHip.position.clone().add(delta).applyMatrix4(parentWorld.matrix.clone().invert());
      const matrix = new Matrix4().compose(position, local, t.localScale); matrix.premultiply(parentWorld.matrix);
      const worldRotation = parentWorld.rotation.clone().multiply(local).normalize(); placed.set(t, { matrix, rotation: worldRotation });
      if (!t.joint) continue;
      const a = arrays.get(t);
      if (k && a.rotation[(k - 1) * 4] * local.x + a.rotation[(k - 1) * 4 + 1] * local.y + a.rotation[(k - 1) * 4 + 2] * local.z + a.rotation[(k - 1) * 4 + 3] * local.w < 0) local.set(-local.x, -local.y, -local.z, -local.w);
      a.rotation.set(local.toArray(), k * 4); a.translation.set(position.toArray(), k * 3); a.scale.set(t.localScale.toArray(), k * 3);
    }
  }
  if (existing) existing.dispose();
  const buffer = targetDoc.getRoot().listBuffers()[0] ?? targetDoc.createBuffer();
  const animation = targetDoc.createAnimation(name); const input = targetDoc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer);
  for (const [t, a] of arrays) for (const path of ['rotation', 'translation', 'scale']) {
    const output = targetDoc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(a[path]).setBuffer(buffer);
    const sampler = targetDoc.createAnimationSampler().setInterpolation('LINEAR').setInput(input).setOutput(output);
    animation.addSampler(sampler).addChannel(targetDoc.createAnimationChannel().setTargetNode(t.node).setTargetPath(path).setSampler(sampler));
  }
  const report = { sourceClip: clipName, targetClip: name, sourceRange: [start, end], durationSeconds: seconds, samples: times.length, fps,
    sourceJoints: source.byName.size, targetJoints: target.byName.size, mappedJoints: map.pairs.size, scale, rootMotion, maximumHorizontalTravelMeters: largestTravel,
    horizontalEndDeltaMeters: Math.hypot(hipsDisplacements.at(-1)[0] - hipsDisplacements[0][0], hipsDisplacements.at(-1)[2] - hipsDisplacements[0][2]),
    facingAlignmentQuaternion: alignment.toArray(), mappedBones: [...map.pairs].map(([t, s]) => ({ target: t.node.getName(), source: s.node.getName() })),
    retainedLocalBindJoints: [...target.byName.values()].filter(t => !map.pairs.has(t)).map(t => t.node.getName()),
    verificationBoundary: 'Kinematic transfer only. Foot contact, skin deformation, garment clearance and hand/socket contact require multi-view runtime review.' };
  animation.setExtras({ retarget: report });
  return { animation, report };
}

/** Join already-retargeted clips with shortest-arc quaternion crossfades.
 * This authors a local showcase from existing licensed motions; it does not
 * invent foot contact or turn one slash into independently choreographed hits.
 */
export function composeGeneralMotion(doc, steps, options = {}) {
  const { name = 'sword_showcase', overlap = .18, fps = 30, replace = false } = options;
  if (!steps.length || !(fps >= 1 && fps <= 120 && overlap >= 0)) throw new Error('Provide steps, fps 1..120, and nonnegative overlap.');
  const rig = rigOf(doc, options.skinIndex, options.bones), segments = []; let cursor = 0;
  for (const item of steps) {
    const step = typeof item === 'string' ? { clip: item } : item;
    const clip = doc.getRoot().listAnimations().find(a => a.getName() === step.clip);
    if (!clip) throw new Error(`Missing sequence animation ${step.clip}.`);
    const duration = Math.max(...clip.listSamplers().map(s => s.getInput().getMax([])[0]));
    const start = step.start ?? 0, end = step.end ?? duration, speed = step.speed ?? 1;
    if (!(start >= 0 && end > start && end <= duration + EPS && speed > 0)) throw new Error(`Invalid sequence range/speed for ${step.clip}.`);
    const seconds = (end - start) / speed;
    if (overlap > seconds / 2) throw new Error(`Overlap is too long for ${step.clip}; at most half a segment is allowed.`);
    const channels = new Map();
    for (const c of clip.listChannels()) {
      if (!['rotation', 'translation', 'scale'].includes(c.getTargetPath())) continue;
      if (!channels.has(c.getTargetNode())) channels.set(c.getTargetNode(), {});
      channels.get(c.getTargetNode())[c.getTargetPath()] = samplerAt(c);
    }
    if (segments.length) cursor -= overlap;
    segments.push({ clip: step.clip, start, end, speed, seconds, offset: cursor, channels }); cursor += seconds;
  }
  const old = doc.getRoot().listAnimations().find(a => a.getName() === name);
  if (old && !replace) throw new Error(`Target animation ${name} already exists.`);
  const times = []; for (let k = 0; k / fps < cursor - EPS; k++) times.push(k / fps); times.push(cursor);
  const arrays = new Map([...rig.byName.values()].map(r => [r, { rotation: new Float32Array(times.length * 4), translation: new Float32Array(times.length * 3), scale: new Float32Array(times.length * 3) }]));
  for (let k = 0; k < times.length; k++) {
    const time = times[k];
    const active = segments.filter(s => time >= s.offset - EPS && time <= s.offset + s.seconds + EPS);
    const a = active[0] ?? segments.at(-1), b = active[1];
    const alpha = b && overlap > 0 ? Math.max(0, Math.min(1, (time - b.offset) / overlap)) : 0;
    const blend = alpha * alpha * (3 - 2 * alpha);
    for (const [r, arraysForJoint] of arrays) for (const path of ['rotation', 'translation', 'scale']) {
      const rest = path === 'rotation' ? r.localRotation.toArray() : path === 'translation' ? r.localPosition.toArray() : r.localScale.toArray();
      const read = s => s.channels.get(r.node)?.[path]?.(s.start + Math.max(0, Math.min(s.seconds, time - s.offset)) * s.speed) ?? rest;
      const first = read(a); let value = first;
      if (b) {
        const second = read(b);
        value = path === 'rotation' ? new Quaternion(...first).slerp(new Quaternion(...second), blend).normalize().toArray() : first.map((v, i) => v + (second[i] - v) * blend);
      }
      const size = path === 'rotation' ? 4 : 3;
      if (path === 'rotation' && k && value.reduce((s, v, i) => s + v * arraysForJoint.rotation[(k - 1) * 4 + i], 0) < 0) value = value.map(v => -v);
      arraysForJoint[path].set(value, k * size);
    }
  }
  if (old) old.dispose();
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer), animation = doc.createAnimation(name);
  for (const [r, a] of arrays) for (const path of ['rotation', 'translation', 'scale']) {
    const output = doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(a[path]).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(r.node).setTargetPath(path).setSampler(sampler));
  }
  const report = { targetClip: name, durationSeconds: cursor, overlapSeconds: overlap, fps, steps: segments.map(({ clip, start, end, speed, offset, seconds }) => ({ clip, start, end, speed, offset, seconds })),
    verificationBoundary: 'Crossfaded reuse of existing motions. Contact/garment review still required; this is not a newly captured multi-hit choreography.' };
  animation.setExtras({ sequence: report }); return { animation, report };
}
