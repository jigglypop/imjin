// Graft the intact rear helmet/neck curtain from the existing Meshy source.
// Sources remain read-only. By default all derived previews go to shots/.
// node scripts/repair-general-helmets.mjs --input-dir=... --output-dir=...
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Matrix3, Matrix4, Vector3 } from 'three';
import { mergeDocuments, prune, textureCompress, dedup } from '@gltf-transform/functions';
import sharp from 'sharp';
import { io } from './lib/figure.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const worldPoint = (matrix, array, index) => new Vector3(...array.slice(index * 3, index * 3 + 3)).applyMatrix4(matrix);
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

async function removePhantomFrontPlume(doc, node, head) {
  const primitive = node.getMesh().listPrimitives().find((candidate) => !candidate.getExtras().rearHelmetGraft);
  const texture = primitive.getMaterial()?.getBaseColorTexture();
  if (!texture?.getImage()) throw new Error('Front plume cleanup requires the existing armor base color');
  const { data, info } = await sharp(Buffer.from(texture.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const positions = primitive.getAttribute('POSITION'), uvs = primitive.getAttribute('TEXCOORD_0');
  const source = primitive.getIndices(), indices = source.getArray();
  const headIndex = node.getSkin().listJoints().findIndex((joint) => joint.getName() === 'Head');
  const headBind = new Matrix4().fromArray(node.getSkin().listJoints()[headIndex].getWorldMatrix()).multiply(new Matrix4().fromArray(node.getSkin().getInverseBindMatrices().getElement(headIndex, [])));
  const colorAt = (index) => {
    const uv = uvs.getElement(index, []);
    const x = Math.min(info.width - 1, Math.max(0, Math.floor(uv[0] * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.floor(uv[1] * info.height)));
    const start = (y * info.width + x) * info.channels;
    return [data[start], data[start + 1], data[start + 2]];
  };
  const kept = [];
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = [indices[index], indices[index + 1], indices[index + 2]];
    const centroid = triangle.reduce((sum, vertex) => sum.add(new Vector3(...positions.getElement(vertex, [])).applyMatrix4(headBind)), new Vector3()).divideScalar(3);
    const inPlume = centroid.x > head.x + .045 && centroid.y > head.y + .045 && Math.abs(centroid.z - head.z) < .035;
    const color = inPlume ? triangle.reduce((sum, vertex) => colorAt(vertex).map((value, channel) => sum[channel] + value / 3), [0, 0, 0]) : [0, 0, 0];
    const redHair = color[0] > 20 && color[0] > color[1] * 1.35 && color[0] > color[2] * 1.2;
    if (!(inPlume && redHair)) kept.push(...triangle);
  }
  const removed = (indices.length - kept.length) / 3;
  source.setArray(new indices.constructor(kept));
  return removed;
}

/** Mutates only the derived armor document. The caller owns final compression. */
export async function graftRearHelmet(doc, sourcePath, options = {}) {
  const scale = options.scale ?? 0.53;
  const donor = await io.read(sourcePath);
  const donorNode = donor.getRoot().listNodes().find((node) => node.getMesh() && node.getSkin());
  const targetNode = doc.getRoot().listNodes().find((node) => node.getMesh() && node.getSkin());
  if (!donorNode || !targetNode) throw new Error('A skinned donor and fitted armor are required');
  const donorSkin = donorNode.getSkin(), targetSkin = targetNode.getSkin();
  const donorJoints = donorSkin.listJoints(), targetJoints = targetSkin.listJoints();
  const donorHead = donorJoints.find((joint) => joint.getName() === 'Head');
  const targetHeadIndex = targetJoints.findIndex((joint) => joint.getName() === 'Head');
  if (!donorHead || targetHeadIndex < 0) throw new Error('Missing Head landmark');
  const donorOrigin = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(donorHead.getWorldMatrix()));
  const targetOrigin = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(targetJoints[targetHeadIndex].getWorldMatrix()));
  const removedFrontPlumeTris = await removePhantomFrontPlume(doc, targetNode, targetOrigin);
  // Skinned glTF world positions use jointWorld * inverseBind, independently of
  // the mesh node matrix. Meshy leaves a 0.01 scale on its node while its skin
  // cancels that scale; multiplying POSITION by that node would shrink 100x.
  const sourceMatrices = donorJoints.map((joint, index) => new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(donorSkin.getInverseBindMatrices().getElement(index, []))));
  const targetBind = new Matrix4().fromArray(targetJoints[targetHeadIndex].getWorldMatrix()).multiply(new Matrix4().fromArray(targetSkin.getInverseBindMatrices().getElement(targetHeadIndex, [])));
  const targetInverse = targetBind.clone().invert();
  const targetNormal = new Matrix3().getNormalMatrix(targetInverse);
  const original = donorNode.getMesh().listPrimitives()[0];
  const position = original.getAttribute('POSITION').getArray();
  const skinJoints = original.getAttribute('JOINTS_0').getArray();
  const skinWeights = original.getAttribute('WEIGHTS_0').getArray();
  const indices = original.getIndices().getArray();
  const headIndices = new Set(donorJoints.map((joint, index) => /^head/i.test(joint.getName()) ? index : -1).filter((index) => index >= 0));
  const points = Array.from({ length: position.length / 3 }, (_, index) => {
    const point = new Vector3(...position.slice(index * 3, index * 3 + 3)), world = new Vector3();
    for (let slot = 0; slot < 4; slot++) {
      const weight = skinWeights[index * 4 + slot];
      if (weight > 0) world.addScaledVector(point.clone().applyMatrix4(sourceMatrices[skinJoints[index * 4 + slot]]), weight);
    }
    return world;
  });
  const accepted = points.map((point, index) => {
    let headWeight = 0;
    for (let slot = 0; slot < 4; slot++) if (headIndices.has(skinJoints[index * 4 + slot])) headWeight += skinWeights[index * 4 + slot];
    // Meshy faces +Z. Keep only the posterior nape curtain below the metal dome;
    // the existing front/crown/plume stay intact and no face can enter this crop.
    const rear = point.z < donorOrigin.z + 0.012;
    const nape = point.y > donorOrigin.y - 0.10 && point.y < donorOrigin.y + 0.245;
    // The center plume hangs over the curtain. Reusing it would create a second
    // ponytail next to Tripo's existing one, so take the two riveted side panels.
    const curtainSide = Math.abs(point.x - donorOrigin.x) > 0.036;
    return headWeight > 0.5 && rear && nape && curtainSide;
  });
  const selected = [];
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index], b = indices[index + 1], c = indices[index + 2];
    if (accepted[a] && accepted[b] && accepted[c]) selected.push(a, b, c);
  }
  if (selected.length < 300) throw new Error('The donor helmet mask is unexpectedly empty');
  const unique = [...new Set(selected)], remap = new Map(unique.map((index, compact) => [index, compact]));
  const previousNodes = new Set(doc.getRoot().listNodes());
  const previousMeshes = new Set(doc.getRoot().listMeshes());
  const previousSkins = new Set(doc.getRoot().listSkins());
  const previousAnimations = new Set(doc.getRoot().listAnimations());
  const previousScenes = new Set(doc.getRoot().listScenes());
  mergeDocuments(doc, donor);
  const importedMesh = doc.getRoot().listMeshes().find((mesh) => !previousMeshes.has(mesh));
  const material = importedMesh.listPrimitives()[0].getMaterial();
  const mesh = targetNode.getMesh();
  for (const primitive of mesh.listPrimitives()) {
    if (primitive.getExtras().rearHelmetGraft) { mesh.removePrimitive(primitive); primitive.dispose(); }
  }
  const buffer = doc.getRoot().listBuffers()[0];
  const accessor = (type, data) => doc.createAccessor().setType(type).setArray(data).setBuffer(buffer);
  const primitive = doc.createPrimitive().setMaterial(material).setExtras({ rearHelmetGraft: true });
  const outputPosition = new Float32Array(unique.length * 3);
  const outputNormal = new Float32Array(unique.length * 3);
  const outputUV = new Float32Array(unique.length * 2);
  const outputJoints = new Uint16Array(unique.length * 4);
  const outputWeights = new Float32Array(unique.length * 4);
  const normals = original.getAttribute('NORMAL').getArray(), uvs = original.getAttribute('TEXCOORD_0').getArray();
  const rotate = (point) => new Vector3(point.z, point.y, -point.x);
  unique.forEach((sourceIndex, compact) => {
    const delta = points[sourceIndex].clone().sub(donorOrigin);
    // Bring the inner panel edges beneath the existing center plume. The source
    // UVs stay intact; only this hidden lateral overlap is adjusted.
    delta.x = Math.sign(delta.x) * Math.max(0, Math.abs(delta.x) - 0.036) * 1.5;
    const point = rotate(delta).multiplyScalar(scale).add(targetOrigin).applyMatrix4(targetInverse);
    const sourceNormal = new Vector3();
    for (let slot = 0; slot < 4; slot++) {
      const weight = skinWeights[sourceIndex * 4 + slot];
      if (weight > 0) sourceNormal.addScaledVector(new Vector3(...normals.slice(sourceIndex * 3, sourceIndex * 3 + 3)).applyMatrix3(new Matrix3().getNormalMatrix(sourceMatrices[skinJoints[sourceIndex * 4 + slot]])), weight);
    }
    const normal = rotate(sourceNormal).applyMatrix3(targetNormal).normalize();
    outputPosition.set(point.toArray(), compact * 3);
    outputNormal.set(normal.toArray(), compact * 3);
    outputUV.set(uvs.slice(sourceIndex * 2, sourceIndex * 2 + 2), compact * 2);
    outputJoints[compact * 4] = targetHeadIndex;
    outputWeights[compact * 4] = 1;
  });
  primitive.setIndices(accessor('SCALAR', new Uint32Array(selected.map((index) => remap.get(index)))));
  primitive.setAttribute('POSITION', accessor('VEC3', outputPosition));
  primitive.setAttribute('NORMAL', accessor('VEC3', outputNormal));
  primitive.setAttribute('TEXCOORD_0', accessor('VEC2', outputUV));
  primitive.setAttribute('JOINTS_0', accessor('VEC4', outputJoints));
  primitive.setAttribute('WEIGHTS_0', accessor('VEC4', outputWeights));
  mesh.addPrimitive(primitive);
  // Discard donor skeleton/body/clips, retaining only its referenced material.
  for (const node of doc.getRoot().listNodes()) if (!previousNodes.has(node)) node.dispose();
  for (const imported of doc.getRoot().listMeshes()) if (!previousMeshes.has(imported)) imported.dispose();
  for (const skin of doc.getRoot().listSkins()) if (!previousSkins.has(skin)) skin.dispose();
  for (const animation of doc.getRoot().listAnimations()) if (!previousAnimations.has(animation)) animation.dispose();
  for (const scene of doc.getRoot().listScenes()) if (!previousScenes.has(scene)) scene.dispose();
  await doc.transform(prune({ keepLeaves: true }));
  for (const attribute of doc.getRoot().listAccessors()) attribute.setBuffer(buffer);
  for (const other of doc.getRoot().listBuffers()) if (other !== buffer) other.dispose();
  return { method: 'Existing Meshy rear helmet and nape graft onto fitted Tripo shell', source: sourcePath, sourceSha256: sha256(sourcePath), scale, vertices: unique.length, triangles: selected.length / 3, removedFrontPlumeTris, headJoint: targetHeadIndex, donorHead: donorOrigin.toArray(), targetHead: targetOrigin.toArray(), mask: 'head weight > 0.5; posterior nape below crown; central plume and face excluded; side panels meet beneath original plume' };
}

export async function repairHelmetBack(doc, id, options = {}) {
  const base = options.root ?? root;
  const source = join(base, `assets-src/generals-parts-2026-10-17/armor_${id}_rig.glb`);
  const result = await graftRearHelmet(doc, source, options);
  return { source: source.replaceAll('\\', '/').replace(base.replaceAll('\\', '/') + '/', ''), sha256: result.sourceSha256, crop: result.mask, fit: { scale: result.scale, donorHead: result.donorHead, targetHead: result.targetHead, headJoint: result.headJoint }, vertices: result.vertices, tris: result.triangles, removedFrontPlumeTris: result.removedFrontPlumeTris };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=')]; }));
  const input = resolve(args['input-dir'] ?? join(root, 'public/models/generals/parts'));
  const output = resolve(args['output-dir'] ?? join(root, 'shots/generals-helmet-repair'));
  if (input === output) throw new Error('Use a distinct output directory; review graft previews before integration');
  mkdirSync(output, { recursive: true });
  const reports = {};
  for (const id of (args.only ? [args.only] : ['joseon_dujeong', 'yi_tongjesa'])) {
    const name = `armor_${id}`;
    for (const suffix of (args['input-pattern'] ? [''] : ['', '_lod1'])) {
      const inputName = args['input-pattern'] ? args['input-pattern'].replace('{name}', name) : `${name}${suffix}.glb`;
      const doc = await io.read(join(input, inputName));
      const report = await graftRearHelmet(doc, join(root, `assets-src/generals-parts-2026-10-17/${name}_rig.glb`), { scale: Number(args.scale ?? 0.53) });
      await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: [suffix ? 2048 : 4096, suffix ? 2048 : 4096], quality: 90 }), textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(normal|metallicRoughness)/, resize: [suffix ? 1024 : 2048, suffix ? 1024 : 2048], quality: 90 }));
      const file = join(output, `${name}${suffix}.glb`);
      await io.write(file, doc);
      reports[`${id}${suffix}`] = { ...report, output: file, sha256: sha256(file) };
      console.log('HELMET_GRAFT', id, suffix || 'high', report.vertices, report.triangles, file);
    }
  }
  writeFileSync(join(output, 'helmet-repair-provenance.json'), JSON.stringify(reports, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
