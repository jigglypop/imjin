// Actual NEW body checks; numerical invariants do not establish visual hand quality.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Matrix4, Vector3 } from 'three';
import { io } from './lib/figure.mjs';
import { closeGeneralHands } from './lib/close-general-hands.mjs';

const file='assets-src/generals-regeneration-2026-10-17/raw/body-rig/rigged_character_glb_url.glb';
const hash=data=>createHash('sha256').update(data).digest('hex');
const sourceHash=hash(readFileSync(file)),doc=await io.read(file),root=doc.getRoot(),skin=root.listSkins()[0],joints=skin.listJoints();
const bind=()=>JSON.stringify([joints.map(n=>[n.getName(),n.getTranslation(),n.getRotation(),n.getScale()]),skin.getInverseBindMatrices().getArray()]);
const beforeBind=bind(),primitive=root.listMeshes()[0].listPrimitives()[0],ps=primitive.getAttribute('POSITION'),before=ps.getArray().slice();
const otherAttributes=new Map(primitive.listSemantics().filter(s=>!['POSITION','NORMAL'].includes(s)).map(s=>[s,hash(primitive.getAttribute(s).getArray())]));
const indexHash=hash(primitive.getIndices().getArray()),seams=new Map();
for(let i=0;i<ps.getCount();i++){const key=ps.getElement(i,[]).map(v=>v.toFixed(6)).join(',');if(!seams.has(key))seams.set(key,[]);seams.get(key).push(i);}
const result=closeGeneralHands(doc);
assert.equal(result.oldGeometryUsed,false);assert.equal(result.topologyChanged,false);assert.ok(result.modifiedVertices>9000);
assert.equal(bind(),beforeBind,'all bind transforms remain unchanged');
for(const [semantic,digest]of otherAttributes)assert.equal(hash(primitive.getAttribute(semantic).getArray()),digest,semantic);
assert.equal(hash(primitive.getIndices().getArray()),indexHash);
assert.ok([...ps.getArray(),...primitive.getAttribute('NORMAL').getArray()].every(Number.isFinite));
const handIds=new Set(joints.map((n,i)=>/^(LeftHand|RightHand)$/.test(n.getName())?i:-1).filter(i=>i>=0));
const js=primitive.getAttribute('JOINTS_0'),ws=primitive.getAttribute('WEIGHTS_0');let moved=0,maxSeamGap=0;
for(let i=0;i<ps.getCount();i++)if(ps.getElement(i,[]).some((v,k)=>Math.abs(v-before[i*3+k])>1e-9)){
  const indices=js.getElement(i,[]),weights=ws.getElement(i,[]);assert.ok(indices.some((id,k)=>handIds.has(id)&&weights[k]>=.15),'only hand-weighted vertices move');moved++;
}
for(const group of seams.values())if(group.length>1){const first=ps.getElement(group[0],[]);for(const i of group)maxSeamGap=Math.max(maxSeamGap,Math.hypot(...ps.getElement(i,[]).map((v,k)=>v-first[k])));}
assert.ok(maxSeamGap<1e-6,'deformation does not split UV seams');
for(const side of ['right','left']){
  const socket=root.listNodes().find(n=>n.getName()==='socket_grip_'+side);assert.ok(socket);
  const world=new Matrix4().fromArray(socket.getWorldMatrix());assert.ok(Math.abs(world.determinant()-1)<1e-5,'socket uses world metres');
  assert.ok(new Vector3().setFromMatrixPosition(world).distanceTo(new Vector3(...result.sockets[side].worldOrigin))<1e-5);
  assert.ok(result.hands[side].after.size[0]>.09&&result.hands[side].after.size[0]<.125,'closed hand is 9..12.5 cm along forearm');
}
const closedHash=hash(ps.getArray());assert.throws(()=>closeGeneralHands(doc),/already exist/);assert.equal(hash(ps.getArray()),closedHash,'repeated call refuses before mutation');
assert.equal(hash(readFileSync(file)),sourceHash,'raw GLB remains unchanged');
console.log(JSON.stringify({status:'PASS',movedVertices:moved,maxSeamGap,sourceHashUnchanged:sourceHash,bindWeightsUVIndicesUnchanged:true,socketWorldScaleOneMetre:true,visualAcceptance:false},null,2));
