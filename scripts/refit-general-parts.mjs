// Refit existing Tripo shells locally in Blender. No provider calls or source overwrites.
// node scripts/refit-general-parts.mjs --work-dir=F:/codex-work/imjin-wardrobe-20261017/refit
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { io, simplify, LODS } from './lib/figure.mjs';
import { mergeDocuments, dedup, prune, textureCompress, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { repairHelmetBack } from './repair-general-helmets.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const work = resolve(args['work-dir'] ?? join(root, 'shots', 'generals-refit'));
const blender = args.blender ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const source = join(root, 'assets-src', 'generals-parts-2026-10-17');
const target = join(root, 'public/models/generals/parts');
mkdirSync(work, { recursive: true });
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const bodyPath = join(source, 'body_yi_tripo_rig.glb');
const receipt = join(target, 'refit-provenance.json');
const previous = existsSync(receipt) ? JSON.parse(readFileSync(receipt, 'utf8')) : {};
const provenance = { version: 3, method: 'Blender cuff/sole landmark fitting and nearest polygon surface weights; rigid helmet, hip-hung skirt, rigid boots on calf joints to exclude malformed sole pivots', body: { path: 'assets-src/generals-parts-2026-10-17/body_yi_tripo_rig.glb', sha256: hash(bodyPath) }, armors: { ...previous.armors } };
for (const id of (args.only ? [args.only] : ['joseon_dujeong', 'yi_tongjesa'])) {
  const name = `armor_${id}`;
  const shell = join(source, `${name}_shell_tripo.glb`);
  const raw = await io.read(shell);
  const body = await io.read(bodyPath);
  const prim = raw.getRoot().listMeshes()[0].listPrimitives()[0];
  const positions = prim.getAttribute('POSITION').getArray();
  writeFileSync(join(work, `${name}-source.bin`), Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength));
  const joints = body.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
  const config = join(work, `${name}.json`);
  writeFileSync(config, JSON.stringify({ name, body: bodyPath, shell, joints, positions: `${name}-source.bin` }));
  const output = execFileSync(blender, ['-b', '--python', join(root, 'scripts/lib/refit-general-armor.py'), '--', config], { encoding: 'utf8', maxBuffer: 4e6 });
  console.log(output.split('\n').filter((line) => /ARMOR_FIT_RESULT|Error|Traceback/.test(line)).join('\n'));
  const fit = JSON.parse(readFileSync(join(work, `${name}-fit.json`), 'utf8'));
  const arrays = (kind, Type) => { const b = readFileSync(join(work, `${name}-${kind}.bin`)); return new Type(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  prim.getAttribute('POSITION').setArray(arrays('position', Float32Array));
  prim.getAttribute('NORMAL').setArray(arrays('normal', Float32Array));
  const oldNodes = new Set(raw.getRoot().listNodes());
  mergeDocuments(raw, body);
  const bodyMeshNode = raw.getRoot().listNodes().find((n) => !oldNodes.has(n) && n.getMesh());
  const armorNode = raw.getRoot().listNodes().find((n) => oldNodes.has(n) && n.getMesh());
  const buffer = raw.getRoot().listBuffers()[0];
  for (const accessor of raw.getRoot().listAccessors()) accessor.setBuffer(buffer);
  for (const b of raw.getRoot().listBuffers().slice(1)) b.dispose();
  prim.setAttribute('JOINTS_0', raw.createAccessor().setType('VEC4').setArray(arrays('joints', Uint16Array)).setBuffer(buffer));
  prim.setAttribute('WEIGHTS_0', raw.createAccessor().setType('VEC4').setArray(arrays('weights', Float32Array)).setBuffer(buffer));
  bodyMeshNode.getParentNode().addChild(armorNode);
  armorNode.setSkin(bodyMeshNode.getSkin());
  const oldMesh = bodyMeshNode.getMesh();
  bodyMeshNode.dispose();
  oldMesh.dispose();
  const scene = raw.getRoot().listScenes().find((s) => s.listChildren().some((n) => !oldNodes.has(n)));
  for (const s of raw.getRoot().listScenes()) if (s !== scene) s.dispose();
  raw.getRoot().setDefaultScene(scene);
  const helmet = await repairHelmetBack(raw, id, { root });
  const fitted = join(work, `${name}-fitted.glb`);
  await io.write(fitted, raw);
  provenance.armors[id] = { source: { path: `assets-src/generals-parts-2026-10-17/${name}_shell_tripo.glb`, sha256: hash(shell), providerTask: JSON.parse(readFileSync(`${shell}.json`, 'utf8')).task }, fit, helmet, levels: {} };
  for (const lod of LODS) {
    const doc = await io.read(fitted);
    const triangles = simplify(doc, lod.triangles, lod.error, lod.flags, lod.uv);
    await doc.transform(dedup(), prune({ keepLeaves: true }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: [lod.base, lod.base], quality: 90 }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(normal|metallicRoughness)/, resize: [lod.other, lod.other], quality: 90 }),
      quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const file = join(target, `${name}${lod.suffix}.glb`);
    const backup = join(work, `${name}${lod.suffix}-before.glb`);
    if (existsSync(file) && !existsSync(backup)) copyFileSync(file, backup);
    await io.write(file, doc);
    const totalTriangles = doc.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((count, prim) => count + prim.getIndices().getCount() / 3, 0), 0);
    provenance.armors[id].levels[lod.suffix || 'high'] = { triangles: totalTriangles, coatTriangles: triangles, sha256: hash(file), bytes: readFileSync(file).length };
    console.log('REFIT', id, lod.suffix || 'high', Math.round(totalTriangles));
  }
}
writeFileSync(receipt, JSON.stringify(provenance, null, 2) + '\n');
