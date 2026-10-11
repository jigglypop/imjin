import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const dir=resolve('assets-src/dragonhead-2026-10-11');
const module=resolve(dir,'ship-builder.mjs');
await build({entryPoints:['src/ships/build/ShipBuilder.ts'],outfile:module,bundle:true,platform:'node',format:'esm'});
const {buildShip}=await import(pathToFileURL(module));
const old=buildShip('geobukseon',0),ship=buildShip('geobukseon',0,true);
const d=ship.lods[1];
const fields=['position','normal','uv','color','mat','index'];
await writeFile(resolve(dir,'draft-hull.json'),JSON.stringify({headRemoved:true,lod:1,anchors:ship.anchors,...Object.fromEntries(fields.map(k=>[k,Array.from(d[k])]))}));
const counts=old.lods.map((d,i)=>({lod:i,beforeTriangles:d.index.length/3,withoutHeadTriangles:ship.lods[i].index.length/3,removedTriangles:(d.index.length-ship.lods[i].index.length)/3}));
await writeFile(resolve(dir,'old-head-removal.json'),JSON.stringify({source:'src/ships/build/geobukseon.ts dragonHead call omitted, no spatial clipping',anchorsIdentical:JSON.stringify(old.anchors)===JSON.stringify(ship.anchors),lods:counts},null,2));
console.log(JSON.stringify(counts));
