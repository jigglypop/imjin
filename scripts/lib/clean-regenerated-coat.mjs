import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';

const root = fileURLToPath(new URL('../..', import.meta.url));
const work = 'F:/codex-work/imjin-regeneration-fit';
const sourcePath = join(root, 'assets-src/generals-regeneration-2026-10-17/raw/coat/glb.glb');
const fittedPath = join(work, 'armor_joseon_dujeong.glb');
const io = new NodeIO(), source = await io.read(sourcePath), doc = await io.read(fittedPath);
const sourcePrim = source.getRoot().listMeshes()[0].listPrimitives()[0];
const node = doc.getRoot().listNodes().find(n => n.getMesh() && n.getSkin()), prim = node.getMesh().listPrimitives()[0];
const save = (name, array) => writeFileSync(join(work, name), Buffer.from(array.buffer, array.byteOffset, array.byteLength));
if (sourcePrim.getAttribute('POSITION').getCount() !== prim.getAttribute('POSITION').getCount()) throw new Error('NEW source/fit vertex correspondence changed');
save('clean-source-position.bin', sourcePrim.getAttribute('POSITION').getArray());
save('clean-source-indices.bin', Uint32Array.from(sourcePrim.getIndices().getArray()));
save('clean-fitted-position.bin', prim.getAttribute('POSITION').getArray());
save('clean-fitted-joints.bin', prim.getAttribute('JOINTS_0').getArray());
save('clean-fitted-weights.bin', prim.getAttribute('WEIGHTS_0').getArray());
const log = execFileSync('C:/Program Files/Blender Foundation/Blender 5.2/blender.exe', ['--background', '--python', join(root, 'scripts/lib/clean-regenerated-coat.py'), '--', work], { encoding: 'utf8', maxBuffer: 4e6 });
writeFileSync(join(work, 'clean-blender.log'), log); console.log(log.split('\n').filter(s => /NEW_COAT_FRONT_CLEAN|Traceback|Error/.test(s)).join('\n'));
const raw = readFileSync(join(work, 'clean-retained-indices.bin'));
prim.getIndices().setArray(new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
const binding = JSON.parse(readFileSync(join(work, 'clean-binding.json'), 'utf8')), buffer = doc.getRoot().listBuffers()[0];
const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const material = doc.createMaterial('NEW straight front edge binding').setBaseColorFactor([.035, .030, .028, 1]).setMetallicFactor(0).setRoughnessFactor(.78).setDoubleSided(true);
const strip = doc.createPrimitive().setAttribute('POSITION', accessor('VEC3', Float32Array.from(binding.positions))).setAttribute('NORMAL', accessor('VEC3', Float32Array.from(binding.normals)))
  .setAttribute('JOINTS_0', accessor('VEC4', Uint16Array.from(binding.joints))).setAttribute('WEIGHTS_0', accessor('VEC4', Float32Array.from(binding.weights)))
  .setIndices(accessor('SCALAR', Uint16Array.from(binding.indices))).setMaterial(material);
node.getMesh().addPrimitive(strip);
const file = join(work, 'armor_joseon_dujeong-clean.glb'); await io.write(file, doc);
const report = JSON.parse(readFileSync(join(work, 'clean-report.json'), 'utf8'));
report.output = { path: file, bytes: readFileSync(file).length, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') };
writeFileSync(join(work, 'clean-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log('NEW_COAT_CLEAN_OUTPUT=' + JSON.stringify(report.output));
