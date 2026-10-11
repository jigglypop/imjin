// Local-only packaging of the existing approved Meshy model. No provider requests or paid jobs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'assets-src/dragonhead-2026-10-11');
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const reviews = JSON.parse(readFileSync(join(dir, 'milestone-reviews.json')));
if (reviews.form?.status !== 'approved' || reviews.form.approvedBy !== 'user') throw new Error('Human Form approval required');
const blender = process.env.DRAGONHEAD_BLENDER ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
if (!existsSync(blender)) throw new Error('Set DRAGONHEAD_BLENDER to the local Blender executable');
execFileSync(blender, ['-b', '--python', join(root, 'scripts/blender/dragonhead-export.py')], { stdio: 'pipe' });
const source = JSON.parse(readFileSync(join(dir, 'local-export.json')));
const outDir = join(root, 'public/models');
mkdirSync(outDir, { recursive: true });
const cli = join(root, 'node_modules/@gltf-transform/cli/bin/cli.js');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const result = [];
for (const [level, tex] of [1024, 512, 256].entries()) {
  const suffix = level === 0 ? '' : `_lod${level}`;
  const input = join(dir, source.outputs[level].path);
  const output = join(outDir, `geobukseon_dragonhead_71${suffix}.glb`);
  execFileSync(process.execPath, [cli, 'optimize', input, output, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(tex), '--simplify', 'false'], { stdio: 'pipe' });
  const doc = await io.read(output);
  const mesh = doc.getRoot().listMeshes();
  const primitives = mesh.flatMap((m) => m.listPrimitives());
  const triangles = primitives.reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount())/3, 0);
  const textureBytes = doc.getRoot().listTextures().reduce((n, t) => n + (t.getImage()?.byteLength ?? 0), 0);
  if (triangles > source.outputs[level].target || (level === 2 && statSync(output).size > 350000) || textureBytes > 2000000) throw new Error(`LOD${level} exceeds the declared budget`);
  result.push({ level, path: `public/models/${output.split(/[\\/]/).at(-1)}`, bytes:statSync(output).size, sha256:sha(output), triangles, textureSize:tex, textureBytes,
    meshCount:mesh.length, primitiveCount:primitives.length, materials:doc.getRoot().listMaterials().length });
}
const report = { schema:'imjin.dragonhead-runtime-assets.v1', provider:'Meshy', model:'meshy-7.1', taskId:source.source.taskId,
  consumedCredits:30, extraGenerationCredits:0, sourceSha256:source.source.sha256, approvedDraftBlendSha256:reviews.form.draftBlendSha256,
  originalApprovedFitBounds:JSON.parse(readFileSync(join(dir,'form-review.json'))).fitBoundsShipSpace,
  uniformShipScale:1.2, scaleApproval:'User requested a larger representative turtle ship after approving its Form.', oldProceduralHeadRemoved:true, anchorsScaledOnce:true, lods:result };
writeFileSync(join(dir, 'runtime-assets.json'), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
