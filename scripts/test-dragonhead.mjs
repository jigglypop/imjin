// Real exported head geometry and real ship/batch methods; controlled texture I/O, no CPU test is a GPU proof.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Matrix3, Vector3 } from 'three';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(),'imjin-dragonhead-'));
const storage = {getItem:()=>null,setItem(){},removeItem(){}};
globalThis.window={localStorage:storage,sessionStorage:storage,devicePixelRatio:1,addEventListener(){},removeEventListener(){}};
globalThis.localStorage=globalThis.sessionStorage=storage;
globalThis.document={documentElement:{lang:'ko'}};
globalThis.matchMedia=()=>({matches:false});
globalThis.location={search:'',pathname:'/'};
globalThis.screen={width:1920,height:1080};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'test',platform:'',language:'ko',maxTouchPoints:0}});
let passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log('ok - '+name);};
try {
  await MeshoptDecoder.ready;
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
  const report=JSON.parse(await readFile(join(root,'assets-src/dragonhead-2026-10-11/runtime-assets.json')));
  const raw=[];
  const boundaryCount=(p)=>{
    const positions=p.getAttribute('POSITION').getArray(),index=p.getIndices().getArray(),edges=new Map();
    const key=i=>[positions[i*3],positions[i*3+1],positions[i*3+2]].map(n=>n.toFixed(4)).join(',');
    for(let i=0;i<index.length;i+=3)for(const[a,b]of[[0,1],[1,2],[2,0]]){const ids=[key(index[i+a]),key(index[i+b])].sort(),edge=ids.join('|');edges.set(edge,(edges.get(edge)??0)+1);}
    return[...edges.values()].filter(n=>n===1).length;
  };
  await check('published GLBs preserve PBR/UVs, one mesh, and the declared three LOD budgets',async()=>{
    for(const entry of report.lods) {
      const doc=await io.read(join(root,entry.path)),mesh=doc.getRoot().listMeshes();
      assert.equal(mesh.length,1);assert.equal(mesh[0].listPrimitives().length,1);
      const p=mesh[0].listPrimitives()[0];assert(p.getAttribute('NORMAL'));assert(p.getAttribute('TEXCOORD_0'));
      const mat=p.getMaterial();assert(mat.getBaseColorTexture());assert(mat.getNormalTexture());assert(mat.getMetallicRoughnessTexture());
      assert.equal(p.getIndices().getCount()/3,entry.triangles);assert(entry.triangles<=[1500,500,180][entry.level]);
      const primitive=p;
      assert.equal(boundaryCount(primitive),8,'LOD must keep the source mouth/mount boundaries, without new holes');
      await doc.transform(dequantize());
      const matrix=new Matrix4().fromArray(doc.getRoot().listNodes().find(n=>n.getMesh()).getWorldMatrix()),normalMatrix=new Matrix3().getNormalMatrix(matrix),vector=new Vector3();
      const position=[...primitive.getAttribute('POSITION').getArray()],normal=[...primitive.getAttribute('NORMAL').getArray()];
      for(let i=0;i<position.length;i+=3){vector.fromArray(position,i).applyMatrix4(matrix).toArray(position,i);vector.fromArray(normal,i).applyMatrix3(normalMatrix).normalize().toArray(normal,i);}
      raw.push({position,normal,uv:[...primitive.getAttribute('TEXCOORD_0').getArray()],index:[...primitive.getIndices().getArray()]});
    }
  });
  const result=await build({stdin:{contents:`export { ShipRenderer,loadShipAssets,releaseShipAssets,loadSceneShipAssets,disposeSceneShipAssets } from './src/ships/ShipRenderer.ts'; export { buildShip } from './src/ships/build/ShipBuilder.ts'; export { buildGeobukseon } from './src/ships/build/geobukseon.ts'; export { anchorsFor,buildAnchorsFor,GEOBUK_SCALE } from './src/ships/anchors.ts'; export { SHIP_SPECS } from './src/sim/catalog.ts'; export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; export { BufferGeometry,Float32BufferAttribute,Mesh,MeshStandardMaterial,Texture,Group,Matrix4,Vector3 } from 'three/webgpu';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'atlas-io',setup(api){api.onLoad({filter:/atlasMaterial\.ts$/},()=>({contents:`import {MeshStandardMaterial,Texture} from 'three/webgpu'; export async function atlasMaterial(){const m=new MeshStandardMaterial({map:new Texture(),normalMap:new Texture(),roughnessMap:new Texture()});m.userData.atlas={grid:4,cell:512,pad:8};return m;}`,loader:'ts',resolveDir:root}));}}]});
  const bundle=join(temporary,'test.mjs');await writeFile(bundle,result.outputFiles[0].contents);delete window.__THREE__;
  const m=await import(pathToFileURL(bundle).href);const urls=[];let fail=false;
  m.GLTFLoader.prototype.loadAsync=async(url)=>{
    urls.push(url);if(fail&&url.endsWith('_lod1.glb'))throw new Error('controlled missing head LOD');
    const level=url.includes('_lod2')?2:url.includes('_lod1')?1:0,data=raw[level],g=new m.BufferGeometry();
    for(const [name,field,size]of[['position','position',3],['normal','normal',3],['uv','uv',2]])g.setAttribute(name,new m.Float32BufferAttribute(data[field],size));
    g.setIndex(data.index);
    const material=new m.MeshStandardMaterial({map:new m.Texture(),normalMap:new m.Texture(),roughnessMap:new m.Texture(),metalnessMap:new m.Texture()});
    const group=new m.Group();group.add(new m.Mesh(g,material));return{scene:group};
  };
  let assets;
  await check('real default hull removes only the old head and keeps every combat/FX anchor',async()=>{
    assets=await m.loadShipAssets(['geobukseon'],{skipLod0:false,baseColorOnly:false,anisotropy:1});
    const a=assets['geobukseon#0'],old=m.buildShip('geobukseon',0),bare=m.buildShip('geobukseon',0,true);
    assert.deepEqual(a.anchors,old.anchors);assert.deepEqual(bare.anchors,old.anchors);
    for(let level=0;level<3;level++) {
      const lod=a.lods[level];assert.equal(lod.geometry.index.count,bare.lods[level].index.length);
      assert(old.lods[level].index.length>lod.geometry.index.count);assert.equal(lod.parts.length,1);
      const box=lod.parts[0].geometry.boundingBox;assert(box.max.x>23.8*m.GEOBUK_SCALE&&box.min.x>18*m.GEOBUK_SCALE&&box.max.y<6.9*m.GEOBUK_SCALE&&box.min.y>3.8*m.GEOBUK_SCALE);
    }
  });
  await check('turtle hull/head/anchors scale once to 50.4m while direction vectors and weapon stats remain stable',()=>{
    const spec=m.SHIP_SPECS.geobukseon,a=m.anchorsFor('geobukseon#0'),base=m.buildAnchorsFor('geobukseon#0'),built=m.buildShip('geobukseon',0,true),rawHull=m.buildGeobukseon(1,true);
    assert.equal(spec.length,50.4);assert.equal(spec.beam,14.4);assert.equal(a.length,42*1.2);assert.equal(a.beam,12*1.2);
    assert.equal(spec.crew,140);assert.equal(spec.hull,170);assert.equal(spec.maxSpeed,5.8);assert.equal(spec.turnRate,.21);assert.equal(spec.cost,1100);
    for(let i=0;i<rawHull.position.length;i++)assert(Math.abs(built.lods[1].position[i]-rawHull.position[i]*1.2)<.00001);
    for(const field of['smokeStack','stern','bow','ramTip'])assert.deepEqual(a[field],base[field].map(n=>n*1.2));
    for(let i=0;i<a.gunPorts.length;i++){assert.deepEqual(a.gunPorts[i].pos,base.gunPorts[i].pos.map(n=>n*1.2));assert.deepEqual(a.gunPorts[i].dir,base.gunPorts[i].dir);}
    assert.equal(a.deckBounds.halfBeam(6),base.deckBounds.halfBeam(5)*1.2);assert.equal(a.oarDeck,base.oarDeck*1.2);
    assert.equal(built.anchors,a);
  });
  await check('40 real heads follow hull poses through in-frame growth, every LOD and burn/flash updates',()=>{
    const key='geobukseon#0',r=new m.ShipRenderer(assets,new Map([[key,1]])),retired=r.batches.get(key)[0],deleted=[];
    const gpu={_attributes:{get:()=>({}),delete:a=>deleted.push(a)}};
    for(const part of [retired,...retired.parts])part.mesh.onAfterRender(gpu);
    r.begin();
    for(let i=0;i<40;i++)r.add(key,i%3,new m.Matrix4().makeTranslation(i*60,i,-i),new m.Vector3(i,i+1,i+2),new m.Vector3(0,1,0),.2,.3);
    r.end();assert.equal(r.group.children.length,6);assert.equal(deleted.length,6);
    for(const batch of r.batches.get(key)) {
      const head=batch.parts[0];assert.equal(head.count,batch.count);assert.equal(head.mesh.count,batch.mesh.count);
      assert.deepEqual([...head.mesh.instanceMatrix.array],[...batch.mesh.instanceMatrix.array]);assert.deepEqual([...head.a.array],[...batch.a.array]);assert.deepEqual([...head.b.array],[...batch.b.array]);
    }
    assert.equal(r.stats()[key].reduce((a,b)=>a+b),40);
    r.begin();r.end();assert(r.group.children.every(mesh=>mesh.count===0));
    r.dispose();r.dispose();assert.equal(r.group.children.length,0);
  });
  await check('cutaway heads share the same height and capacity, and clear when leaving cutaway',()=>{
    const key='geobukseon#0',r=new m.ShipRenderer(assets,new Map([[key,1]]));r.begin();
    r.add(key,0,new m.Matrix4(),new m.Vector3(),new m.Vector3(0,1,0),0,0,4.5);r.end();
    const cut=r.cuts.get(key);assert.equal(cut.mesh.count,1);assert.equal(cut.parts[0].mesh.count,1);
    assert.equal(cut.c.array[0],4.5);assert.equal(cut.parts[0].c.array[0],4.5);assert.equal(cut.parts[0].mesh.instanceMatrix.count,12);
    r.begin();r.add(key,0,new m.Matrix4(),new m.Vector3(),new m.Vector3(0,1,0),0,0);r.end();assert.equal(cut.parts[0].mesh.count,0);r.dispose();
  });
  await check('separate scene upload and disposal preserve cached battle geometry and shared atlas textures',async()=>{
    const key='geobukseon#0',scene=await m.loadSceneShipAssets(['geobukseon'],{skipLod0:false,baseColorOnly:false,anisotropy:2});
    const cached=assets[key],privateAsset=scene[key],bytes=cached.lods[0].geometry.getAttribute('position').data.array.byteLength;
    assert.notEqual(privateAsset,cached);assert.notEqual(privateAsset.lods[0].geometry,cached.lods[0].geometry);
    let atlasDisposed=0,headDisposed=0;
    privateAsset.lods[0].source.map.addEventListener('dispose',()=>atlasDisposed++);
    privateAsset.lods[0].parts[0].source.map.addEventListener('dispose',()=>headDisposed++);
    const renderer=new m.ShipRenderer(scene,new Map([[key,1]]));
    const gpu={_attributes:{get:()=>({version:0}),delete(){}}};
    for(const mesh of renderer.group.children)mesh.onAfterRender(gpu);
    assert.equal(privateAsset.lods[0].geometry.getAttribute('position').data.array.byteLength,0,'real upload cleanup detaches the scene copy');
    assert.equal(cached.lods[0].geometry.getAttribute('position').data.array.byteLength,bytes,'a new game renderer can still upload cached battle vertices');
    renderer.dispose();m.disposeSceneShipAssets(scene);
    assert.equal(atlasDisposed,0);assert.equal(headDisposed,1);
    assert.equal((await m.loadShipAssets(['geobukseon'],{skipLod0:false,baseColorOnly:false,anisotropy:1}))[key],cached);
  });
  await check('simultaneous private PC and mobile loads keep their own required head tiers and textures',async()=>{
    const [pc,phone]=await Promise.all([
      m.loadSceneShipAssets(['geobukseon'],{skipLod0:false,baseColorOnly:false,anisotropy:8}),
      m.loadSceneShipAssets(['geobukseon'],{skipLod0:true,baseColorOnly:true,anisotropy:1}),
    ]);
    const a=pc['geobukseon#0'],b=phone['geobukseon#0'];
    assert.deepEqual(a.lods.map(l=>l.parts[0].geometry.index.count/3),report.lods.map(l=>l.triangles));
    assert.deepEqual(b.lods.map(l=>l.parts[0].geometry.index.count/3),[499,499,179]);
    assert(a.lods[0].parts[0].source.normalMap);assert.equal(b.lods[0].parts[0].source.normalMap,null);
    assert.equal(a.lods[0].parts[0].source.userData.shipAnisotropy,8);assert.equal(b.lods[0].parts[0].source.userData.shipAnisotropy,1);
    m.disposeSceneShipAssets(pc);m.disposeSceneShipAssets(phone);
  });
  await m.releaseShipAssets(new Set());
  await check('mobile skips the near head texture and uses the real mid/far meshes with base colour only',async()=>{
    urls.length=0;const a=(await m.loadShipAssets(['geobukseon'],{skipLod0:true,baseColorOnly:true,anisotropy:1}))['geobukseon#0'];
    assert.equal(urls.length,2);assert(urls.every(url=>url.includes('_lod')));
    assert.deepEqual(a.lods.map(lod=>lod.parts[0].geometry.index.count/3),[report.lods[1].triangles,report.lods[1].triangles,report.lods[2].triangles]);
    for(const lod of a.lods){const s=lod.parts[0].source;assert(s.map);assert.equal(s.normalMap,null);assert.equal(s.roughnessMap,null);assert.equal(s.metalnessMap,null);}
    await m.releaseShipAssets(new Set());
  });
  await check('missing head LOD keeps the complete original procedural head instead of overlap or a hole',async()=>{
    fail=true;const warn=console.warn;console.warn=()=>{};let a;
    try{a=(await m.loadShipAssets(['geobukseon'],{skipLod0:false,baseColorOnly:false,anisotropy:1}))['geobukseon#0'];}finally{console.warn=warn;}
    const old=m.buildShip('geobukseon',0);for(let level=0;level<3;level++){assert.equal(a.lods[level].parts,undefined);assert.equal(a.lods[level].geometry.index.count,old.lods[level].index.length);}
    await m.releaseShipAssets(new Set());
  });
  console.log(`dragonhead: ${passed} focused regressions passed (CPU; GPU acceptance is separate)`);
}finally{await rm(temporary,{recursive:true,force:true});}
