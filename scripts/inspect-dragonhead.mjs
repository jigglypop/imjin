import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, basename } from 'node:path';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

const packageDir = resolve('assets-src/dragonhead-2026-10-11');
const props = JSON.parse(await readFile(resolve(packageDir, 'props.json'), 'utf8'));
const asset = props.assets[0];
const attempt = asset.attempts.find(a => a.status === 'SUCCEEDED');
if (!attempt) throw new Error('An existing successful task is required; this script never submits work.');
const task = attempt.task;
const thumbnails = task.multi_view_thumbnails ?? task.thumbnail_urls ?? task.thumbnail_url;
const strings = [];
function collect(value, path = []) {
  if (typeof value === 'string' && value.startsWith('https:')) strings.push({ path, url: value });
  else if (Array.isArray(value)) value.forEach((v,i) => collect(v,[...path,String(i)]));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k,v]) => collect(v,[...path,k]));
}
collect(thumbnails);
console.log('Existing task', { id:task.id, model:attempt.request.ai_model, consumedCredits:attempt.consumedCredits, thumbnailFields:Object.keys(task).filter(k => /thumb/i.test(k)), thumbnailViews:strings.map(s => s.path.join('/')) });
await mkdir(resolve(packageDir, 'renders'), {recursive:true});
const downloaded = [];
// Accepted manifests omit expiring provider URLs; retain the local review hashes.
if (!strings.length) for (const label of ['front', 'right', 'back', 'left']) {
  const file=resolve(packageDir,'renders',`provider-${label}.png`);
  try {
    const bytes=await readFile(file);
    downloaded.push({view:label,path:`renders/${basename(file)}`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
for (let i=0;i<strings.length;i++) {
  const entry=strings[i], label=entry.path.join('-') || String(i), file=resolve(packageDir,'renders',`provider-${label}.png`);
  const response=await fetch(entry.url);
  if(!response.ok) throw new Error(`Thumbnail ${label}: HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer()); await writeFile(file,bytes);
  downloaded.push({view:label,path:`renders/${basename(file)}`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
async function inspect(file) {
  const bytes=await readFile(file);
  if(bytes.toString('utf8',0,4)!=='glTF') throw new Error(`${basename(file)} is not a GLB`);
  const json=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  const box=new Box3(), nodes=json.nodes??[], primitives=[];
  function node(index,parent=new Matrix4()) {
    const n=nodes[index], local=n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(new Vector3().fromArray(n.translation??[0,0,0]),new Quaternion().fromArray(n.rotation??[0,0,0,1]),new Vector3().fromArray(n.scale??[1,1,1]));
    const world=new Matrix4().multiplyMatrices(parent,local);
    if(n.mesh!==undefined) for(const p of json.meshes[n.mesh].primitives) {
      const position=json.accessors[p.attributes.POSITION], count=p.indices===undefined ? position.count : json.accessors[p.indices].count;
      const normalized = value => {
        if (!position.normalized || position.componentType === 5126) return value;
        const divisor = {5120:127,5121:255,5122:32767,5123:65535}[position.componentType];
        if (!divisor) throw new Error(`Unsupported normalized position type: ${position.componentType}`);
        return value.map(v => Math.max(-1, v / divisor));
      };
      if(position.min&&position.max) box.union(new Box3(new Vector3().fromArray(normalized(position.min)),new Vector3().fromArray(normalized(position.max))).applyMatrix4(world));
      primitives.push({node:n.name,mesh:json.meshes[n.mesh].name,vertices:position.count,triangles:count/3,attributes:Object.keys(p.attributes),material:p.material,mode:p.mode??4});
    }
    for(const child of n.children??[]) node(child,world);
  }
  for(const index of json.scenes?.[json.scene??0]?.nodes??[]) node(index);
  return {file:relative(resolve('.'),file).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),extensions:json.extensionsUsed??[],bounds:box.isEmpty()?null:{min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new Vector3()).toArray()},primitives,triangles:primitives.reduce((s,p)=>s+p.triangles,0),materials:json.materials,images:(json.images??[]).map(i=>({name:i.name,mimeType:i.mimeType,bytes:i.bufferView===undefined?null:json.bufferViews[i.bufferView].byteLength})),textures:json.textures};
}
const report={schema:'imjin.dragonhead-inspection.v1',task:{id:task.id,model:attempt.request.ai_model,consumedCredits:attempt.consumedCredits},providerPreviews:downloaded,assets:[]};
for(const file of [resolve(packageDir,attempt.downloadedMesh.path.replaceAll('\\','/')), ...['','_lod1','_lod2'].map(s=>resolve(`public/models/geobukseon_v2${s}.glb`))]) report.assets.push(await inspect(file));
await writeFile(resolve(packageDir,'inspection.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report.assets.map(a=>({file:basename(a.file),bytes:a.bytes,triangles:a.triangles,primitives:a.primitives.length,materials:a.materials?.length,images:a.images,bounds:a.bounds})),null,2));
