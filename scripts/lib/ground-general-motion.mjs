// Offline contact bake from actual glTF skinned shoe vertices. No provider,
// renderer, geometry edits, bind edits, or public-asset writes. This corrects
// world-floor penetration by translating the hips; it is not foot IK.
import { Matrix4, Vector3 } from 'three';
import { createHash } from 'node:crypto';
import { createGeneralWorldMatrixSampler, inspectGeneralRig } from './new-general-motion.mjs';

const normalize = s => s.split(/[:|]/).at(-1).replace(/^mixamorig\d*/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const SIDE = {
  left: new Set(['leftfoot', 'lfoot', 'lefttoebase', 'ltoebase', 'lefttoe', 'ltoe']),
  right: new Set(['rightfoot', 'rfoot', 'righttoebase', 'rtoebase', 'righttoe', 'rtoe']),
};
const isDescendant = (node, ancestor) => { for (let n = node; n; n = n.getParentNode()) if (n === ancestor) return true; return false; };
const typedBytes = array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

/** Hash every actual mesh attribute/index, inverse bind and node bind transform.
 * Animation additions/replacements intentionally do not affect this digest. */
export function generalGeometryBindDigest(doc) {
  const hash = createHash('sha256');
  for (const node of doc.getRoot().listNodes()) hash.update(JSON.stringify({ name: node.getName(), t: node.getTranslation(), r: node.getRotation(), s: node.getScale(), parent: node.getParentNode()?.getName() }));
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    for (const semantic of primitive.listSemantics().sort()) { hash.update(semantic); hash.update(typedBytes(primitive.getAttribute(semantic).getArray())); }
    if (primitive.getIndices()) hash.update(typedBytes(primitive.getIndices().getArray()));
  }
  for (const skin of doc.getRoot().listSkins()) {
    hash.update(JSON.stringify(skin.listJoints().map(n => n.getName())));
    if (skin.getInverseBindMatrices()) hash.update(typedBytes(skin.getInverseBindMatrices().getArray()));
  }
  return hash.digest('hex');
}

function footEvaluator(doc, hip, options = {}) {
  const threshold = options.footWeightThreshold ?? .5;
  if (!(threshold >= 0 && threshold < 1)) throw new Error('footWeightThreshold must be in [0,1).');
  const batches = [], counts = { left: 0, right: 0 };
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(), skin = node.getSkin(); if (!mesh || !skin) continue;
    const joints = skin.listJoints(), ibm = skin.getInverseBindMatrices();
    if (!ibm) throw new Error(`Skinned mesh ${node.getName()} has no inverse-bind matrices.`);
    const inverses = joints.map((_, i) => new Matrix4().fromArray(ibm.getElement(i, new Array(16))));
    const affected = joints.map(j => hip ? isDescendant(j, hip) : true);
    const sideIndices = Object.fromEntries(Object.entries(SIDE).map(([side, names]) => [side, new Set(joints.flatMap((j, i) => names.has(normalize(j.getName())) ? [i] : []))]));
    if (!sideIndices.left.size && !sideIndices.right.size) continue;
    const points = [];
    for (const primitive of mesh.listPrimitives()) {
      const pos = primitive.getAttribute('POSITION'), ja = primitive.getAttribute('JOINTS_0'), wa = primitive.getAttribute('WEIGHTS_0');
      if (!pos || !ja || !wa) continue;
      const sets = [{ ja, wa }];
      if (primitive.getAttribute('JOINTS_1') && primitive.getAttribute('WEIGHTS_1')) sets.push({ ja: primitive.getAttribute('JOINTS_1'), wa: primitive.getAttribute('WEIGHTS_1') });
      const used = primitive.getIndices() ? new Set(primitive.getIndices().getArray()) : Array.from({ length: pos.getCount() }, (_, i) => i);
      for (const vi of used) {
        const js = [], ws = [];
        for (const set of sets) { js.push(...set.ja.getElement(vi, [])); ws.push(...set.wa.getElement(vi, [])); }
        const selected = Object.keys(SIDE).filter(side => js.reduce((s, j, i) => s + (sideIndices[side].has(j) ? ws[i] : 0), 0) > threshold);
        if (!selected.length) continue;
        const position = pos.getElement(vi, []), coverage = js.reduce((s, j, i) => s + (affected[j] ? ws[i] : 0), 0);
        if (hip && coverage < 1e-5) throw new Error(`Foot vertex cannot be moved by hips ${hip.getName()}.`);
        for (const side of selected) counts[side]++;
        points.push({ position, js, ws, coverage, sides: selected });
      }
    }
    if (points.length) batches.push({ joints, inverses, points });
  }
  if (!counts.left || !counts.right) throw new Error(`Cannot find both actual skinned shoes (left=${counts.left}, right=${counts.right}).`);
  return {
    counts,
    evaluate(world, clearance = 0) {
      const minima = { left: Infinity, right: Infinity }; let correction = -Infinity;
      for (const batch of batches) {
        const matrices = batch.joints.map((node, i) => {
          const matrix = world.get(node); if (!matrix) throw new Error(`Joint ${node.getName()} is outside the animated scene.`);
          return matrix.clone().multiply(batch.inverses[i]).elements;
        });
        for (const point of batch.points) {
          const p = point.position; let y = 0;
          for (let k = 0; k < point.js.length; k++) {
            if (!point.ws[k]) continue;
            const m = matrices[point.js[k]];
            y += point.ws[k] * (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]);
          }
          if (!Number.isFinite(y)) throw new Error('A skinned foot vertex has a non-finite world position.');
          for (const side of point.sides) minima[side] = Math.min(minima[side], y);
          // Translation propagates to all descendant-joint matrices. Account
          // for any partially ancestor-weighted vertex rather than assuming
          // its weights sum to exactly one or all point to descendants.
          correction = Math.max(correction, (clearance - y) / point.coverage);
        }
      }
      return { minima, minY: Math.min(minima.left, minima.right), correction };
    },
  };
}

function timesFor(clip, fps) {
  const original = clip.listSamplers().flatMap(s => Array.from(s.getInput().getArray()));
  const end = Math.max(...original), start = Math.min(...original);
  if (!(Number.isFinite(end) && Number.isFinite(start) && end > start)) throw new Error(`Animation ${clip.getName()} has no positive duration.`);
  const all = [...original];
  for (let i = 0; start + i / fps < end; i++) all.push(start + i / fps);
  all.push(end); all.sort((a, b) => a - b);
  const unique = [];
  for (const t of all) if (!unique.length || t - unique.at(-1) > 1e-6) unique.push(t);
  unique[0] = start; unique[unique.length - 1] = end;
  return unique;
}

/** Read-only actual skin minima at supplied times, or all original+fps keys. */
export function measureGeneralFootContact(doc, clipName, options = {}) {
  const clip = doc.getRoot().listAnimations().find(a => a.getName() === clipName);
  if (!clip) throw new Error(`Missing animation ${clipName}.`);
  const hipName = options.hipName ?? inspectGeneralRig(doc, { skinIndex: options.skinIndex, bones: options.bones }).canonical.hips;
  const hip = doc.getRoot().listNodes().find(n => n.getName() === hipName);
  const evaluate = footEvaluator(doc, hip, options), read = createGeneralWorldMatrixSampler(doc, clipName, options);
  const times = options.times ?? timesFor(clip, options.fps ?? 60);
  return { footVertices: evaluate.counts, samples: times.map(time => { const value = evaluate.evaluate(read(time)); return { time, leftFootMinY: value.minima.left, rightFootMinY: value.minima.right, minY: value.minY }; }) };
}

/**
 * Bake world-Y contact to Hips translation for every requested clip frame.
 * All correction plans are computed before any channels are changed. The
 * original geometry, inverse binds, node transforms and non-Hips tracks stay
 * byte-identical. Read the returned validation boundary before claiming IK.
 */
export function groundGeneralMotions(doc, options = {}) {
  const { clips = ['idle', 'slash', 'parry', 'command'], fps = 60, clearance = .002, tolerance = 2e-5 } = options;
  if (!(fps >= 1 && fps <= 120 && Number.isFinite(clearance) && tolerance > 0)) throw new Error('Use fps 1..120, finite clearance and positive tolerance.');
  if (!clips.length || new Set(clips).size !== clips.length) throw new Error('Provide unique animation clip names.');
  const all = doc.getRoot().listAnimations();
  const selected = clips.map(name => { const clip = all.find(a => a.getName() === name); if (!clip) throw new Error(`Missing animation ${name}.`); return clip; });
  const hipName = options.hipName ?? inspectGeneralRig(doc, { skinIndex: options.skinIndex, bones: options.bones }).canonical.hips;
  const hip = doc.getRoot().listNodes().find(n => n.getName() === hipName);
  if (!hip) throw new Error(`Hips node ${hipName} was not found.`);
  const digestBefore = generalGeometryBindDigest(doc), evaluate = footEvaluator(doc, hip, options), plans = [];
  for (const clip of selected) {
    const old = clip.listChannels().filter(c => c.getTargetNode() === hip && c.getTargetPath() === 'translation');
    if (old.length > 1) throw new Error(`Animation ${clip.getName()} contains duplicate Hips translations.`);
    const read = createGeneralWorldMatrixSampler(doc, clip.getName(), options), times = timesFor(clip, fps);
    const values = new Float32Array(times.length * 3), rows = [];
    for (let k = 0; k < times.length; k++) {
      const world = read(times[k]), before = evaluate.evaluate(world, clearance), hipWorld = world.get(hip);
      const parentWorld = hip.getParentNode() ? world.get(hip.getParentNode()) : new Matrix4();
      if (!hipWorld || !parentWorld || Math.abs(parentWorld.determinant()) < 1e-15) throw new Error('Hips parent world frame is missing or singular.');
      const correctedWorld = new Vector3().setFromMatrixPosition(hipWorld); correctedWorld.y += before.correction;
      const local = correctedWorld.applyMatrix4(parentWorld.clone().invert()); values.set(local.toArray(), k * 3);
      rows.push({ time: times[k], beforeMinY: before.minY, correctionMeters: before.correction });
    }
    plans.push({ clip, times, values, rows, oldChannel: old[0] ?? null, oldSampler: old[0]?.getSampler(), oldExtras: clip.getExtras() });
  }
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer(), changed = [];
  try {
    for (const plan of plans) {
      const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(plan.times)).setBuffer(buffer);
      const output = doc.createAccessor().setType('VEC3').setArray(plan.values).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR'); plan.newSampler = sampler; plan.clip.addSampler(sampler);
      if (plan.oldChannel) plan.oldChannel.setSampler(sampler);
      else { plan.newChannel = doc.createAnimationChannel().setTargetNode(hip).setTargetPath('translation').setSampler(sampler); plan.clip.addChannel(plan.newChannel); }
      if (plan.oldSampler && !plan.clip.listChannels().some(c => c.getSampler() === plan.oldSampler)) plan.clip.removeSampler(plan.oldSampler);
      changed.push(plan);
    }
    const results = [];
    for (const plan of plans) {
      const read = createGeneralWorldMatrixSampler(doc, plan.clip.getName(), options);
      let minAfter = Infinity, maxAfter = -Infinity, maxError = 0;
      for (let i = 0; i < plan.times.length; i++) {
        const value = evaluate.evaluate(read(plan.times[i])); const error = Math.abs(value.minY - clearance);
        maxError = Math.max(maxError, error); minAfter = Math.min(minAfter, value.minY); maxAfter = Math.max(maxAfter, value.minY);
        plan.rows[i].afterMinY = value.minY;
      }
      if (maxError > tolerance) throw new Error(`Ground contact for ${plan.clip.getName()} missed ${clearance}m by ${maxError}m.`);
      const report = { clip: plan.clip.getName(), samples: plan.times.length, durationSeconds: plan.times.at(-1) - plan.times[0], fps, clearanceMeters: clearance,
        beforeMinimumY: Math.min(...plan.rows.map(r => r.beforeMinY)), beforeMaximumMinimumY: Math.max(...plan.rows.map(r => r.beforeMinY)),
        correctionMinMeters: Math.min(...plan.rows.map(r => r.correctionMeters)), correctionMaxMeters: Math.max(...plan.rows.map(r => r.correctionMeters)),
        afterMinimumY: minAfter, afterMaximumMinimumY: maxAfter, maximumContactErrorMeters: maxError, curve: plan.rows };
      plan.clip.setExtras({ ...plan.oldExtras, groundContact: { ...report, curve: undefined, method: 'actual weighted glTF skin -> Hips parent-frame translation' } }); results.push(report);
    }
    const digestAfter = generalGeometryBindDigest(doc);
    if (digestAfter !== digestBefore) throw new Error('Ground bake changed geometry or bind transforms.');
    return { hipsNode: hipName, fps, clearanceMeters: clearance, footVertices: evaluate.counts, geometryBindDigestBefore: digestBefore, geometryBindDigestAfter: digestAfter, geometryAndBindUnchanged: true, clips: results,
      validationBoundary: 'Actual dominant Foot/Toe skinned vertices contact Y=clearance at every original and baked frame. Hips world-Y translation only; no foot IK or foot-slide correction, no continuous-time guarantee between baked samples, and no armor/weapon clearance proof.' };
  } catch (error) {
    // Restore caller-visible animation channels if a late validation fails.
    for (const plan of changed) {
      if (plan.oldChannel) { plan.oldChannel.setSampler(plan.oldSampler); plan.clip.addSampler(plan.oldSampler); }
      if (plan.newChannel) plan.clip.removeChannel(plan.newChannel);
      plan.clip.removeSampler(plan.newSampler); plan.clip.setExtras(plan.oldExtras);
    }
    throw error;
  }
}
