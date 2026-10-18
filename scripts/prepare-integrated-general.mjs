// NEW complete armored model only. No wardrobe meshes, old heads, or embedded weapons.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { io, simplify, LODS } from './lib/figure.mjs';
import { retargetGeneralMotion } from './lib/new-general-motion.mjs';
import { groundGeneralMotions } from './lib/ground-general-motion.mjs';
import { dedup, prune, textureCompress, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const BASE='assets-src/generals-integrated-2026-10-17';
const input=join(BASE,'raw/rig/rigged_character_glb_url.glb');
const WORK='F:/codex-work/imjin-integrated-general';
const DEST='public/models/generals/representative';
mkdirSync(WORK,{recursive:true});mkdirSync(DEST,{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const doc=await io.read(input);
const skin=doc.getRoot().listSkins()[0];if(!skin)throw new Error('NEW integrated model has no skeleton');
const joints=skin.listJoints(),byName=new Map(joints.map((n,i)=>[n.getName(),{node:n,index:i}]));
const v=n=>new Vector3(...n.getWorldTranslation());
const M=a=>new Matrix4().fromArray(a);
const bind=joints.map((n,i)=>M(n.getWorldMatrix()).multiply(M(skin.getInverseBindMatrices().getElement(i,[]))));
const sockets=[];
for(const side of ['Right','Left']){
  const hand=byName.get(`${side}Hand`),fore=byName.get(`${side}ForeArm`);
  if(!hand||!fore)throw new Error(`Missing ${side} hand/forearm`);
  const wrist=v(hand.node),axis=wrist.clone().sub(v(fore.node)).normalize();
  const centre=new Vector3();let count=0;
  for(const node of doc.getRoot().listNodes().filter(n=>n.getSkin()===skin&&n.getMesh()))for(const p of node.getMesh().listPrimitives()){
    const ps=p.getAttribute('POSITION'),js=p.getAttribute('JOINTS_0'),ws=p.getAttribute('WEIGHTS_0');
    for(let i=0;i<ps.getCount();i++){
      const indices=js.getElement(i,[]),weights=ws.getElement(i,[]);
      const influence=indices.reduce((n,j,k)=>n+(j===hand.index?weights[k]:0),0);if(influence<.6)continue;
      const point=new Vector3(),raw=new Vector3(...ps.getElement(i,[]));
      for(let k=0;k<4;k++)if(weights[k])point.addScaledVector(raw.clone().applyMatrix4(bind[indices[k]]),weights[k]);
      const along=point.clone().sub(wrist).dot(axis);if(along<.02||along>.18)continue;
      centre.add(point);count++;
    }
  }
  if(count<50)throw new Error(`No distinct ${side} closed fist`);
  centre.divideScalar(count);
  const forward=new Vector3(0,0,1).addScaledVector(axis,-axis.z).normalize();
  const x=axis.clone().cross(forward).normalize();
  const world=new Matrix4().makeBasis(x,axis,forward).setPosition(centre);
  const local=M(hand.node.getWorldMatrix()).invert().multiply(world),t=new Vector3(),q=new Quaternion(),s=new Vector3();local.decompose(t,q,s);
  const name=`socket_grip_${side.toLowerCase()}`;
  hand.node.addChild(doc.createNode(name).setTranslation(t.toArray()).setRotation(q.toArray()).setScale(s.toArray()));
  sockets.push({name,vertices:count,worldOrigin:centre.toArray(),worldAxis:axis.toArray(),worldUnit:'metres'});
}
for(const a of doc.getRoot().listAnimations())a.dispose();
const motionsPath='assets-src/generals-3d-2026-10-16/motions.glb';
const comboPath='assets-src/generals-3d-2026-10-16/anim-v2/yi_joseon_dujeong.glb';
const motions=await io.read(motionsPath),combo=await io.read(comboPath),retarget=[];
for(const[source,clip,name]of[[motions,'Idle_11','idle'],[motions,'Sword_Shout','command'],[combo,'Triple_Combo_Attack','slash']]){
  retarget.push(retargetGeneralMotion(doc,source,{clip,name,rootMotion:name==='idle'?'in-place':'bounded',maxTravel:.25,replace:true}).report);
}
const grounding=groundGeneralMotions(doc,{clips:['idle','command','slash']});
for(const scene of doc.getRoot().listScenes())scene.setExtras({...scene.getExtras(),frontAxis:'+Z',integratedArmor:true,embeddedWeaponCount:0,generation:'meshy-7.1-integrated-general'});
const prepared=join(WORK,'general-prepared.glb');await io.write(prepared,doc);
const receipt={schema:'imjin.integrated-general-runtime.v1',source:{path:input,sha256:hash(input)},geometry:'NEW Meshy integrated generation only',embeddedWeapons:0,sockets,retarget,grounding,
  motionsGeometryReused:false,motionSources:[motionsPath,comboPath].map(path=>({path,sha256:hash(path)})),providerCredits:40,levels:{},visuallyAccepted:false};
for(const lod of LODS){
  const output=await io.read(prepared);simplify(output,lod.triangles,lod.error,lod.flags,lod.uv);
  await output.transform(dedup(),prune({keepLeaves:true}),
    textureCompress({encoder:sharp,targetFormat:'webp',slots:/^baseColor/,resize:[lod.base,lod.base],quality:92}),
    textureCompress({encoder:sharp,targetFormat:'webp',slots:/^(normal|metallicRoughness)/,resize:[lod.other,lod.other],quality:90}),
    quantize(),meshopt({encoder:MeshoptEncoder,level:'medium'}));
  const path=join(DEST,`general${lod.suffix}.glb`);await io.write(path,output);
  receipt.levels[lod.suffix||'high']={path,bytes:readFileSync(path).length,sha256:hash(path),triangles:output.getRoot().listMeshes().reduce((s,m)=>s+m.listPrimitives().reduce((n,p)=>n+p.getIndices().getCount()/3,0),0)};
}
writeFileSync(join(DEST,'provenance.json'),JSON.stringify(receipt,null,2)+'\n');
// Old source models remain preserved. Only the representative and interchangeable weapons are admitted to this screen.
const weaponCatalog=JSON.parse(readFileSync('assets-src/generals-weapons-2026-10-17/manifest.json','utf8'));
writeFileSync('public/models/generals/index.json',JSON.stringify(['representative/general',...weaponCatalog.weapons.map(w=>`parts/weapon_${w.id}`)].sort())+'\n');
writeFileSync(join(WORK,'preparation.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({prepared,levels:receipt.levels,animations:doc.getRoot().listAnimations().map(a=>a.getName()),embeddedWeapons:0}));
