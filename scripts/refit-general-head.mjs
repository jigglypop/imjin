// Reuse the coherent Meshy head on the existing Tripo motion skeleton. No provider calls.
import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io, simplify } from './lib/figure.mjs';
import { compactPrimitive, mergeDocuments, cloneDocument, dedup, prune, textureCompress, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { setWardrobeIdle } from './lib/general-stance.mjs';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const PKG=join(ROOT,'assets-src/generals-parts-2026-10-17');
const OUT=join(ROOT,'public/models/generals/parts');
const options=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const BACKUP=resolve(options['work-dir']??join(ROOT,'shots','generals-refit-head'));
const sourcePath=p=>relative(ROOT,p).replaceAll('\\','/');
const shiftX=Number(options.forward??0),shiftY=Number(options.up??0);
const files={skeleton:join(PKG,'body_yi_tripo_rig.glb'),head:join(PKG,'body_yi_rig.glb'),idle:join(PKG,'body_yi_tripo_idle.glb'),slash:join(PKG,'body_yi_tripo_slash.glb')};
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const primitive=doc=>doc.getRoot().listMeshes()[0].listPrimitives()[0];
const headNames=new Set(['Head','neck','head_end','headfront','NeckTwist01','NeckTwist02']);
const share=(doc,p,pattern)=>{
 const names=doc.getRoot().listSkins()[0].listJoints().map(n=>n.getName());
 const j=p.getAttribute('JOINTS_0'),w=p.getAttribute('WEIGHTS_0'),a=[],b=[];
 return v=>{j.getElement(v,a);w.getElement(v,b);return a.reduce((s,n,k)=>s+(pattern(names[n])?b[k]:0),0);};
};
const cut=(doc,p,predicate)=>{
 const kept=[],index=p.getIndices().getArray();
 for(let i=0;i<index.length;i+=3)if(predicate(index[i])&&predicate(index[i+1])&&predicate(index[i+2]))kept.push(index[i],index[i+1],index[i+2]);
 p.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(kept)).setBuffer(doc.getRoot().listBuffers()[0]));
 compactPrimitive(p);
 return kept.length/3;
};
const bounds=(p,predicate=()=>true)=>{
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],v=[],pos=p.getAttribute('POSITION');
 for(let i=0;i<pos.getCount();i++)if(predicate(i)){pos.getElement(i,v);for(let c=0;c<3;c++){min[c]=Math.min(min[c],v[c]);max[c]=Math.max(max[c],v[c]);}}
 return {min,max};
};

mkdirSync(BACKUP,{recursive:true});mkdirSync(OUT,{recursive:true});
for(const name of ['body_yi.glb','body_yi_lod1.glb'])if(existsSync(join(OUT,name))&&!existsSync(join(BACKUP,name)))copyFileSync(join(OUT,name),join(BACKUP,name));
const doc=await io.read(files.skeleton),root=doc.getRoot(),handPrim=primitive(doc);
const oldHeadShare=share(doc,handPrim,n=>headNames.has(n));
const target=bounds(handPrim,v=>oldHeadShare(v)>.5);
const handShare=share(doc,handPrim,n=>/^[LR]_Hand$/.test(n));
const position=handPrim.getAttribute('POSITION'),xyz=[];
const handsTriangles=cut(doc,handPrim,v=>{
 position.getElement(v,xyz);
 // Closed hands plus a 3 cm overlap into each sleeve, to avoid a floating wrist seam.
 return handShare(v)>.25 || (xyz[1]>.685&&xyz[1]<.80&&(xyz[2]<-.3932||xyz[2]>.3803));
});
root.listMeshes()[0].setName('yi-hands-with-wrist-overlap');
for(const a of root.listAnimations())a.dispose();
const byName=new Map(root.listNodes().map(n=>[n.getName(),n]));
const buffer=root.listBuffers()[0];
for(const clip of ['idle','slash']){
 const motion=await io.read(files[clip]);
 for(const original of motion.getRoot().listAnimations()){
  const animation=doc.createAnimation(clip);
  for(const channel of original.listChannels()){
   const node=byName.get(channel.getTargetNode().getName());if(!node)continue;
   const s=channel.getSampler();
   const copyAccessor=a=>doc.createAccessor().setType(a.getType()).setArray(a.getArray().slice()).setNormalized(a.getNormalized()).setBuffer(buffer);
   const sampler=doc.createAnimationSampler().setInput(copyAccessor(s.getInput())).setOutput(copyAccessor(s.getOutput())).setInterpolation(s.getInterpolation());
   animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setSampler(sampler).setTargetNode(node).setTargetPath(channel.getTargetPath()));
  }
 }
}

const source=await io.read(files.head),sourceRoot=source.getRoot(),headPrim=primitive(source);
const headShare=share(source,headPrim,n=>headNames.has(n));
let headTriangles=cut(source,headPrim,v=>headShare(v)>.5);
const sourceHeadTriangles=headTriangles;
const original=bounds(headPrim);
// Match the visible head envelope, rather than inconsistent auto-rigger pivot locations.
// Meshy faces +Z; a +90 degree turn around +Y makes it face Tripo's +X.
const scale=(target.max[1]-target.min[1])/(original.max[1]-original.min[1]);
const sourceCentre=original.min.map((n,k)=>(n+original.max[k])/2);
const targetCentre=target.min.map((n,k)=>(n+target.max[k])/2);
const p=headPrim.getAttribute('POSITION'),arr=p.getArray();
for(let v=0;v<arr.length;v+=3){
 const x=arr[v]-sourceCentre[0],y=arr[v+1]-sourceCentre[1],z=arr[v+2]-sourceCentre[2];
 arr[v]=targetCentre[0]+z*scale+shiftX;arr[v+1]=targetCentre[1]+y*scale+shiftY;arr[v+2]=targetCentre[2]-x*scale;
}
p.setArray(arr);
for(const semantic of ['NORMAL','TANGENT']){
 const a=headPrim.getAttribute(semantic);if(!a)continue;const values=a.getArray(),stride=a.getElementSize();
 for(let i=0;i<values.length;i+=stride){const x=values[i],z=values[i+2];values[i]=z;values[i+2]=-x;}
 a.setArray(values);
}
// Only the wearer's face and beard show through the helmet. The fitted armor brim
// occupies Y=.88-.90; leave 1 cm of overlap above it and remove the scalp/crown.
// Cutting at the head envelope's forward half also hides the ear/nape cut inside
// both neck curtains, rather than exposing a jagged neck edge behind the collar.
const facialPatch={minForward:targetCentre[0]-.003,maxHeight:.910,frame:'glTF +X forward, +Y up; metres',reason:'Both fitted shell helmet brims occupy Y .88-.90; retain a frontal patch with hidden overlap beneath helmet and neck curtain.'};
headTriangles=cut(source,headPrim,v=>{
 p.getElement(v,xyz);
 return xyz[0]>facialPatch.minForward&&xyz[1]<facialPatch.maxHeight;
});
const transformed=bounds(headPrim);
const sourceNode=sourceRoot.listNodes().find(n=>n.getMesh());
sourceNode.setSkin(null).setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]).setName('yi-coherent-meshy-head');
for(const node of sourceRoot.listNodes())if(node!==sourceNode)node.dispose();
for(const skin of sourceRoot.listSkins())skin.dispose();
for(const a of sourceRoot.listAnimations())a.dispose();
const headScene=source.createScene('head-transplant');headScene.addChild(sourceNode);sourceRoot.setDefaultScene(headScene);
for(const scene of sourceRoot.listScenes())if(scene!==headScene)scene.dispose();
await source.transform(prune());
const originalScene=root.getDefaultScene(),bodySkin=root.listSkins()[0];
const armature=root.listNodes().find(n=>n.getName()==='Armature');
const mapping=mergeDocuments(doc,source),node=mapping.get(sourceNode),prim=mapping.get(headPrim);
armature.addChild(node);node.setSkin(bodySkin);
for(const scene of root.listScenes())if(scene!==originalScene)scene.dispose();
root.setDefaultScene(originalScene);
const count=prim.getAttribute('POSITION').getCount(),J=new Uint16Array(count*4),W=new Float32Array(count*4);
const names=bodySkin.listJoints().map(n=>n.getName()),head=names.indexOf('Head'),neck=names.indexOf('NeckTwist02');
if(head<0||neck<0)throw new Error('Tripo skeleton does not have expected head and neck joints');
for(let v=0;v<count;v++){
 const y=prim.getAttribute('POSITION').getElement(v,xyz)[1];
 const f=Math.max(0,Math.min(1,(y-(target.min[1]+.005))/.030));
 J[v*4]=head;W[v*4]=f;J[v*4+1]=neck;W[v*4+1]=1-f;
}
prim.setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(J).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0',doc.createAccessor().setType('VEC4').setArray(W).setBuffer(buffer));
for(const a of root.listAccessors())a.setBuffer(buffer);
for(const b of root.listBuffers().slice(1))b.dispose();
await doc.transform(prune({keepLeaves:true}));
const wardrobeStance=setWardrobeIdle(doc);
const provenance={at:new Date().toISOString(),sources:Object.fromEntries(Object.entries(files).map(([k,file])=>[k,{file:sourcePath(file),sha256:digest(file)}])),backup:BACKUP,method:'Retain Tripo hands with 3cm wrist overlap, skeleton and slash clip. Replace the Janus Tripo head with the coherent Meshy face and beard; +90deg Y rotation, head-envelope fit, crop the scalp/nape inside fitted helmets, skin to Tripo Head/NeckTwist02. Preserve retained source triangles and UVs for desktop; simplify the mobile facial patch conservatively with UV weight 2. Author the idle stance from bind transforms.',wardrobeStance,scale,shiftX,shiftY,facialPatch,sourceHeadBounds:original,oldTripoHeadBounds:target,newHeadBounds:transformed,handsTriangles,sourceHeadTriangles,headTriangles,outputs:[]};
for(const lod of [{suffix:'',base:4096,other:2048},{suffix:'_lod1',base:2048,other:1024}]){
 const outDoc=cloneDocument(doc);
 let outputHeadTriangles=headTriangles;
 if(lod.suffix&&headTriangles>45000)outputHeadTriangles=simplify(outDoc,45000,.005,['Permissive'],2,outDoc.getRoot().listMeshes().find(m=>m.getName()!=='yi-hands-with-wrist-overlap'));
 await outDoc.transform(dedup(),prune({keepLeaves:true}),textureCompress({encoder:sharp,targetFormat:'webp',slots:/^baseColor/,resize:[lod.base,lod.base],quality:92}),textureCompress({encoder:sharp,targetFormat:'webp',slots:/^(normal|metallicRoughness)/,resize:[lod.other,lod.other],quality:90}),quantize(),meshopt({encoder:MeshoptEncoder,level:'medium'}));
 const file=join(OUT,`body_yi${lod.suffix}.glb`);await io.write(file,outDoc);
 provenance.outputs.push({file:sourcePath(file),bytes:statSync(file).size,sha256:digest(file),triangles:outputHeadTriangles+handsTriangles,headTriangles:outputHeadTriangles,handsTriangles});
}
writeFileSync(join(OUT,'head-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({headScale:scale,backup:BACKUP,outputs:provenance.outputs},null,2));
