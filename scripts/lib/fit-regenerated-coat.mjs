// NEW pilot geometry only. Preserve the new body's original skin/rest/IBM frame.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { copyToDocument, prune } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4 } from 'three';

const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const work = resolve(args.find(a => !a.startsWith('--')) ?? 'F:/codex-work/imjin-regeneration-fit');
const source = join(root, 'assets-src/generals-regeneration-2026-10-17/raw');
const bodyPath = join(source, 'body-rig/rigged_character_glb_url.glb');
const coatPath = join(source, 'coat/glb.glb');
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const before = { body: hash(bodyPath), coat: hash(coatPath) };
mkdirSync(work, { recursive: true });
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(bodyPath), coat = await io.read(coatPath);
const node = doc.getRoot().listNodes().find(n => n.getMesh() && n.getSkin());
if (!node) throw new Error('NEW body has no skinned mesh');
const skin = node.getSkin(), oldMesh = node.getMesh();
const coatNode = coat.getRoot().listNodes().find(n => n.getMesh());
const coatMesh = coatNode.getMesh();
if (coatMesh.listPrimitives().length !== 1) throw new Error('Expected one NEW source coat primitive');
const prim = coatMesh.listPrimitives()[0];
const positions = prim.getAttribute('POSITION').getArray();
writeFileSync(join(work, 'coat-source-position.bin'), Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength));
const bodyPositions = oldMesh.listPrimitives()[0].getAttribute('POSITION').getArray();
writeFileSync(join(work, 'body-source-position.bin'), Buffer.from(bodyPositions.buffer, bodyPositions.byteOffset, bodyPositions.byteLength));
const bindBefore = [...skin.getInverseBindMatrices().getArray()];
const jointsBefore = skin.listJoints().map(j => ({ name: j.getName(), translation: j.getTranslation(), rotation: j.getRotation(), scale: j.getScale() }));
const matrixBefore = node.getMatrix();
const configPath = join(work, 'fit-config.json');
const config = { body: bodyPath, coat: coatPath, work, joints: skin.listJoints().map(n => n.getName()), bodyMatrix: node.getWorldMatrix(), coatMatrix: coatNode.getWorldMatrix() };
if (args.includes('--reuse-bins')) {
  const previous = JSON.parse(readFileSync(configPath, 'utf8'));
  if (JSON.stringify(previous) !== JSON.stringify(config)) throw new Error('Existing fit bins refer to different inputs or frames');
  for (const [kind, stride] of [['position', 12], ['normal', 12], ['joints', 8], ['weights', 16]]) {
    const file = join(work, 'coat-fitted-' + kind + '.bin');
    if (!existsSync(file) || readFileSync(file).length !== positions.length / 3 * stride) throw new Error('Missing/incomplete NEW fit buffer: ' + kind);
  }
} else {
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const log = execFileSync('C:/Program Files/Blender Foundation/Blender 5.2/blender.exe', ['--background', '--python', join(root, 'scripts/lib/fit-regenerated-coat.py'), '--', configPath], { encoding: 'utf8', maxBuffer: 8e6 });
  writeFileSync(join(work, 'fit-blender.log'), log);
  console.log(log.split('\n').filter(s => /NEW_COAT_FIT|Traceback|Error/.test(s)).join('\n'));
}
const array = (kind, Type) => { const b = readFileSync(join(work, 'coat-fitted-' + kind + '.bin')); return new Type(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const mapping = copyToDocument(doc, coat, [coatMesh]);
const newMesh = mapping.get(coatMesh), p = newMesh.listPrimitives()[0];
const buffer = doc.getRoot().listBuffers()[0];
p.getAttribute('POSITION').setArray(array('position', Float32Array));
p.getAttribute('NORMAL').setArray(array('normal', Float32Array));
p.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(array('joints', Uint16Array)).setBuffer(buffer));
p.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(array('weights', Float32Array)).setBuffer(buffer));
node.setMesh(newMesh).setName('armor_joseon_dujeong');
oldMesh.dispose();
for (const animation of doc.getRoot().listAnimations()) animation.dispose();
await doc.transform(prune({ keepLeaves: true, keepAttributes: true }));
for (const accessor of doc.getRoot().listAccessors()) accessor.setBuffer(buffer);
for (const extra of doc.getRoot().listBuffers()) if (extra !== buffer) extra.dispose();
if (JSON.stringify(bindBefore) !== JSON.stringify([...skin.getInverseBindMatrices().getArray()])) throw new Error('Inverse bind matrices changed');
const jointsAfter = skin.listJoints().map(j => ({ name: j.getName(), translation: j.getTranslation(), rotation: j.getRotation(), scale: j.getScale() }));
if (JSON.stringify(jointsBefore) !== JSON.stringify(jointsAfter) || JSON.stringify(matrixBefore) !== JSON.stringify(node.getMatrix())) throw new Error('Body rest or mesh frame changed');
const file = join(work, 'armor_joseon_dujeong.glb');
const restMatrices = skin.listJoints().map((j, i) => new Matrix4().fromArray(j.getWorldMatrix()).multiply(new Matrix4().fromArray(skin.getInverseBindMatrices().getArray(), i * 16)).elements);
const pos = p.getAttribute('POSITION').getArray(), ji = p.getAttribute('JOINTS_0').getArray(), we = p.getAttribute('WEIGHTS_0').getArray();
const actualRestBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let v = 0; v < pos.length / 3; v++) {
  const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], result = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const weight = we[v * 4 + k]; if (!weight) continue;
    const m = restMatrices[ji[v * 4 + k]];
    result[0] += weight * (m[0] * x + m[4] * y + m[8] * z + m[12]);
    result[1] += weight * (m[1] * x + m[5] * y + m[9] * z + m[13]);
    result[2] += weight * (m[2] * x + m[6] * y + m[10] * z + m[14]);
  }
  for (let axis = 0; axis < 3; axis++) { actualRestBounds.min[axis] = Math.min(actualRestBounds.min[axis], result[axis]); actualRestBounds.max[axis] = Math.max(actualRestBounds.max[axis], result[axis]); }
}
if (actualRestBounds.max[1] > 2.2 || actualRestBounds.min[1] < -.2 || actualRestBounds.max[0] - actualRestBounds.min[0] > 3) throw new Error('Actual rest-skinned coat bounds do not fit the metre-scale body: ' + JSON.stringify(actualRestBounds));
await io.write(file, doc);
if (hash(bodyPath) !== before.body || hash(coatPath) !== before.coat) throw new Error('NEW source bytes changed');
const fit = JSON.parse(readFileSync(join(work, 'coat-fit.json'), 'utf8'));
fit.sources = { body: { path: bodyPath, sha256: before.body }, coat: { path: coatPath, sha256: before.coat } };
fit.output = { path: file, sha256: hash(file), bytes: readFileSync(file).length, vertices: p.getAttribute('POSITION').getCount(), triangles: p.getIndices().getCount() / 3 };
fit.inverseBindMatricesExactlyPreserved = true; fit.jointRestExactlyPreserved = true; fit.meshNodeMatrixExactlyPreserved = true;
fit.actualRestBoundsGltf = actualRestBounds;
writeFileSync(join(work, 'coat-fit.json'), JSON.stringify(fit, null, 2) + '\n');
console.log('NEW_COAT_OUTPUT=' + JSON.stringify(fit.output));
