// Cuts a GLB down to a triangle budget. meshoptimizer may collapse across UV seams (Permissive), which the plain
// gltf-transform simplify will not do, so AI-generated meshes with fragmented texture atlases actually reach the
// target. Normals and UVs steer the collapses; the result is re-quantized and meshopt-compressed like the rest.
//   node scripts/lowpoly.mjs <in.glb> <out.glb> <triangles> [error=0.02] [texture=keep|1024|512|256]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, quantize, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [input, output, budget, errorArg, texArg] = process.argv.slice(2);
if (!input || !output || !budget) {
  console.log('usage: node scripts/lowpoly.mjs <in.glb> <out.glb> <triangles> [error] [texture size]');
  process.exit(1);
}
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
await doc.transform(weld());

const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
const total = prims.reduce((a, p) => a + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
const ratio = Math.min(1, Number(budget) / total);
let after = 0;
for (const prim of prims) {
  const pos = prim.getAttribute('POSITION');
  const nor = prim.getAttribute('NORMAL');
  const uv = prim.getAttribute('TEXCOORD_0');
  const n = pos.getCount();
  const index = prim.getIndices() ? Uint32Array.from(prim.getIndices().getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
  const positions = new Float32Array(n * 3);
  const attrs = new Float32Array(n * 5);
  const t3 = [0, 0, 0];
  const t2 = [0, 0];
  for (let i = 0; i < n; i += 1) {
    positions.set(pos.getElement(i, t3), i * 3);
    if (nor) attrs.set(nor.getElement(i, t3), i * 5);
    if (uv) attrs.set(uv.getElement(i, t2), i * 5 + 3);
  }
  const target = Math.max(12, Math.floor((index.length / 3) * ratio) * 3);
  const [kept] = ratio < 1 ? MeshoptSimplifier.simplifyWithAttributes(index, positions, 3, attrs, 5, [0.3, 0.3, 0.3, 1, 1], null, target, Number(errorArg ?? 0.02), ['Permissive']) : [index];
  // Compact to the vertices still used.
  const remap = new Int32Array(n).fill(-1);
  let used = 0;
  for (const v of kept) if (remap[v] < 0) remap[v] = used++;
  for (const semantic of prim.listSemantics()) {
    const attr = prim.getAttribute(semantic);
    const size = attr.getElementSize();
    const out = new Float32Array(used * size);
    const el = new Array(size).fill(0);
    for (let i = 0; i < n; i += 1) if (remap[i] >= 0) out.set(attr.getElement(i, el), remap[i] * size);
    const fresh = doc.createAccessor().setType(attr.getType()).setArray(out).setBuffer(doc.getRoot().listBuffers()[0]);
    prim.setAttribute(semantic, fresh);
  }
  const idx = used < 65536 ? new Uint16Array(kept.length) : new Uint32Array(kept.length);
  kept.forEach((v, i) => (idx[i] = remap[v]));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(doc.getRoot().listBuffers()[0]));
  after += kept.length / 3;
}
const steps = [prune()];
if (texArg && texArg !== 'keep') steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [Number(texArg), Number(texArg)] }));
steps.push(quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await doc.transform(...steps);
await io.write(output, doc);
console.log(`${input.split(/[\\/]/).pop()} ${Math.round(total)} -> ${Math.round(after)} triangles -> ${output.split(/[\\/]/).pop()}`);
