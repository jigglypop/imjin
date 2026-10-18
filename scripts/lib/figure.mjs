// The finish for the generals' figures (scripts/generals-3d.mjs): a Meshy rigged character becomes the web figure.
// The shared motions are moved onto its skeleton, a `grip` node is placed in its right fist for the sword, and two
// levels of detail are written: <name>.glb for close-ups on a desktop and <name>_lod1.glb for phones and tablets.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { Matrix4, Quaternion, Vector3 } from 'three';

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** The clips every figure gets, by the name it plays under (src/ui/generals/GeneralModel.tsx) and the clip it is cut from. */
export const CLIPS = { idle: 'Idle_11', shout: 'Sword_Shout', slash: 'Right_Hand_Sword_Slash' };

/**
 * The levels of detail. The raw model has over a million triangles; 160k keep the face, the rivets and the lacing
 * readable at a hand's width from the camera. The second level is for phones and tablets, where a 4k texture would not
 * fit: its textures are a quarter the size, and its triangles go no lower than the UV seams of the generated atlas allow
 * (collapsing across them tears the texture, most of all in the face).
 */
export const LODS = [
  { suffix: '', triangles: 160_000, base: 4096, other: 2048, error: 0.01, flags: ['Permissive'], uv: 1 },
  { suffix: '_lod1', triangles: 60_000, base: 2048, other: 1024, error: 0.02, flags: [], uv: 1 },
];

/** A skeleton's joints, each with its rest rotation alone and from the armature, and the rotation above it. */
function skeleton(doc) {
  const names = new Set(doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName()));
  const joints = new Map();
  const walk = (node, above, parent) => {
    const local = new Quaternion(...node.getRotation());
    const world = above.clone().multiply(local);
    const joint = names.has(node.getName());
    if (joint) joints.set(node.getName(), { node, local, world, above, parent, rest: new Vector3(...node.getTranslation()) });
    for (const child of node.listChildren()) walk(child, world, joint ? node.getName() : parent);
  };
  for (const node of doc.getRoot().listScenes()[0].listChildren()) walk(node, new Quaternion(), null);
  return joints;
}

/** A channel's track as a function of time, linear between its keys (spherical for rotations). */
function track(channel) {
  const sampler = channel.getSampler();
  const times = sampler.getInput().getArray();
  const out = sampler.getOutput();
  const size = out.getElementSize();
  const at = (i) => out.getElement(i, new Array(size).fill(0));
  return (t) => {
    let i = 0;
    while (i < times.length - 1 && times[i + 1] < t) i++;
    const j = Math.min(times.length - 1, i + 1);
    const f = times[j] > times[i] ? Math.min(1, Math.max(0, (t - times[i]) / (times[j] - times[i]))) : 0;
    if (size === 4) return new Quaternion(...at(i)).slerp(new Quaternion(...at(j)), f);
    return new Vector3(...at(i)).lerp(new Vector3(...at(j)), f);
  };
}

/**
 * The motions moved onto another figure. Every figure is rigged from a T-pose on the same joints, so each joint turns by
 * the same amount in armature space as it does in the source, from its own rest. The hips keep their changes of height,
 * scaled to the figure, and lose the travel, so he performs in place.
 */
export function retarget(doc, source) {
  const from = skeleton(source);
  const to = skeleton(doc);
  for (const a of doc.getRoot().listAnimations()) a.dispose();
  const buffer = doc.getRoot().listBuffers()[0];
  const rest = from.get('Hips').rest;
  const own = to.get('Hips').rest;
  const scale = own.y / rest.y;
  for (const [name, clipName] of Object.entries(CLIPS)) {
    const clip = source.getRoot().listAnimations().find((a) => a.getName() === clipName);
    if (!clip) throw new Error(`the motions have no ${clipName}`);
    const turns = new Map();
    let hips = null;
    let end = 0;
    for (const c of clip.listChannels()) {
      const joint = c.getTargetNode().getName();
      end = Math.max(end, c.getSampler().getInput().getMax([])[0]);
      if (c.getTargetPath() === 'rotation') turns.set(joint, track(c));
      if (c.getTargetPath() === 'translation' && joint === 'Hips') hips = track(c);
    }
    const times = [];
    for (let t = 0; t < end; t += 1 / 30) times.push(t);
    times.push(end);
    const rotations = new Map([...to.keys()].map((n) => [n, new Float32Array(times.length * 4)]));
    const heights = new Float32Array(times.length * 3);
    times.forEach((t, k) => {
      const world = new Map();
      for (const [n, j] of from) world.set(n, (j.parent ? world.get(j.parent) : j.above).clone().multiply(turns.get(n)?.(t) ?? j.local));
      const placed = new Map();
      for (const [n, j] of to) {
        const s = from.get(n);
        const g = s ? world.get(n).clone().multiply(s.world.clone().invert()).multiply(j.world) : (j.parent ? placed.get(j.parent) : j.above).clone().multiply(j.local);
        placed.set(n, g);
        const local = (j.parent ? placed.get(j.parent) : j.above).clone().invert().multiply(g);
        const out = rotations.get(n);
        // Keep each joint on one side of the quaternion double cover, or the blend between keys swings the long way round.
        if (k > 0 && out[(k - 1) * 4] * local.x + out[(k - 1) * 4 + 1] * local.y + out[(k - 1) * 4 + 2] * local.z + out[(k - 1) * 4 + 3] * local.w < 0) local.set(-local.x, -local.y, -local.z, -local.w);
        out.set([local.x, local.y, local.z, local.w], k * 4);
      }
      const h = hips ? hips(t) : rest;
      heights.set([own.x, own.y + (h.y - rest.y) * scale, own.z], k * 3);
    });
    const animation = doc.createAnimation(name);
    const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer);
    const add = (node, path, type, array) => {
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)).setInterpolation('LINEAR');
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
    };
    for (const [n, j] of to) add(j.node, 'rotation', 'VEC4', rotations.get(n));
    add(to.get('Hips').node, 'translation', 'VEC3', heights);
  }
}

/**
 * A `grip` node in the right fist, where a sword's hilt goes: at the middle of the closed hand, its +Y along the
 * forearm and so out of the fist (the blade continues the arm, as the sword motions were made), its +Z forward. The
 * node is scaled so that its own units are metres, whatever the armature's scale.
 */
export function grip(doc) {
  const skin = doc.getRoot().listSkins()[0];
  const list = skin.listJoints();
  const ibm = skin.getInverseBindMatrices().getArray();
  const bind = (name) => new Matrix4().fromArray(ibm, list.findIndex((j) => j.getName() === name) * 16).invert();
  const hand = bind('RightHand');
  const wrist = new Vector3().setFromMatrixPosition(hand);
  const along = wrist.clone().sub(new Vector3().setFromMatrixPosition(bind('RightForeArm'))).normalize();
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute('POSITION');
  const joints = prim.getAttribute('JOINTS_0');
  const weights = prim.getAttribute('WEIGHTS_0');
  const h = list.findIndex((j) => j.getName() === 'RightHand');
  const centre = new Vector3();
  const p = new Vector3();
  const at = [0, 0, 0];
  const j = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  let n = 0;
  for (let v = 0; v < pos.getCount(); v++) {
    joints.getElement(v, j);
    weights.getElement(v, w);
    const share = j.reduce((sum, x, k) => sum + (x === h ? w[k] : 0), 0);
    if (share < 0.6) continue;
    p.fromArray(pos.getElement(v, at));
    // The fist, not the wrist: beyond the cuff of the arm guard.
    if (p.clone().sub(wrist).dot(along) < 0.03) continue;
    centre.add(p);
    n++;
  }
  if (!n) throw new Error('no right fist found');
  centre.divideScalar(n);
  const forward = new Vector3().crossVectors(along, new Vector3(0, -1, 0)).normalize();
  const x = new Vector3().crossVectors(forward, along);
  const world = new Matrix4().makeBasis(x, along, forward).setPosition(centre);
  const local = hand.clone().invert().multiply(world);
  const t = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  local.decompose(t, q, s);
  const node = doc.createNode('grip').setTranslation(t.toArray()).setRotation(q.toArray()).setScale(s.toArray());
  skeleton(doc).get('RightHand').node.addChild(node);
  return { vertices: n, at: centre.toArray().map((c) => +c.toFixed(4)), axis: along.toArray().map((c) => +c.toFixed(3)) };
}

/** Cuts the mesh down to a triangle budget, steered by normals and UVs, across UV seams too (Permissive). Vertices keep their skin. */
export function simplify(doc, triangles, error, flags = ['Permissive'], uvWeight = 1, mesh = doc.getRoot().listMeshes()[0]) {
  const prim = mesh.listPrimitives()[0];
  const pos = prim.getAttribute('POSITION');
  const normal = prim.getAttribute('NORMAL');
  const uv = prim.getAttribute('TEXCOORD_0');
  const n = pos.getCount();
  const index = Uint32Array.from(prim.getIndices().getArray());
  const positions = new Float32Array(n * 3);
  const attributes = new Float32Array(n * 5);
  const v3 = [0, 0, 0];
  const v2 = [0, 0];
  for (let i = 0; i < n; i++) {
    positions.set(pos.getElement(i, v3), i * 3);
    attributes.set(normal.getElement(i, v3), i * 5);
    attributes.set(uv.getElement(i, v2), i * 5 + 3);
  }
  const [kept] = MeshoptSimplifier.simplifyWithAttributes(index, positions, 3, attributes, 5, [0.3, 0.3, 0.3, uvWeight, uvWeight], null, triangles * 3, error, flags);
  const remap = new Int32Array(n).fill(-1);
  let used = 0;
  for (const v of kept) if (remap[v] < 0) remap[v] = used++;
  const buffer = doc.getRoot().listBuffers()[0];
  for (const semantic of prim.listSemantics()) {
    const attr = prim.getAttribute(semantic);
    const size = attr.getElementSize();
    const array = attr.getArray();
    const out = new array.constructor(used * size);
    const el = new Array(size).fill(0);
    for (let i = 0; i < n; i++) if (remap[i] >= 0) out.set(attr.getElement(i, el), remap[i] * size);
    prim.setAttribute(semantic, doc.createAccessor().setType(attr.getType()).setArray(out).setNormalized(attr.getNormalized()).setBuffer(buffer));
  }
  const indices = used < 65536 ? new Uint16Array(kept.length) : new Uint32Array(kept.length);
  kept.forEach((v, i) => (indices[i] = remap[v]));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
  return kept.length / 3;
}

/**
 * The levels of detail of one rigged figure written into `dir` as <name>.glb and <name>_lod1.glb, each with the motions,
 * the grip, textures sized to its level and meshopt-compressed geometry.
 * @returns what was written: triangles and bytes per level, and where the grip went
 */
export async function buildFigure({ rig, motions, dir, name, lods = LODS }) {
  const out = { levels: {} };
  for (const lod of lods) {
    const doc = await io.read(rig);
    retarget(doc, await io.read(motions));
    out.grip = grip(doc);
    const triangles = simplify(doc, lod.triangles, lod.error, lod.flags, lod.uv);
    await doc.transform(
      dedup(),
      prune({ keepLeaves: true }),
      resample(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: [lod.base, lod.base], quality: 88 }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(normal|metallicRoughness)/, resize: [lod.other, lod.other], quality: 90 }),
      quantize(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const file = join(dir, `${name}${lod.suffix}.glb`);
    await io.write(file, doc);
    out.levels[lod.suffix || '_lod0'] = { triangles: Math.round(triangles), bytes: statSync(file).size };
  }
  return out;
}
