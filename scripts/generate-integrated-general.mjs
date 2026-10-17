// Approved replacement scope: one UNARMED integrated armored humanoid + one rig, 40 Meshy credits.
// Weapons are separate interchangeable assets. Existing motion curves add no provider cost.
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const BASE=join(ROOT,'assets-src/generals-integrated-2026-10-17');
const JOBS=join(BASE,'jobs'); mkdirSync(JOBS,{recursive:true});
if(existsSync(join(ROOT,'.env')))process.loadEnvFile(join(ROOT,'.env'));
const [command='status',id]=process.argv.slice(2);
const hash=b=>createHash('sha256').update(b).digest('hex');
const now=()=>new Date().toISOString();
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const pathFor=op=>join(JOBS,`${op}.json`);
function save(path,value){const tmp=`${path}.${process.pid}.tmp`;const fd=openSync(tmp,'wx');try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}renameSync(tmp,path);}
const operations={generation:{credits:35,endpoint:'multi-image-to-3d',template:'generation.template.json'},rig:{credits:5,endpoint:'rigging',template:'rig.template.json'}};
const approvalPath=join(JOBS,'approval.json');
if(!existsSync(approvalPath))save(approvalPath,{
  schema:'imjin.integrated-general-approval.v1',recordedAt:now(),provider:'Meshy',maximumCredits:40,
  userAuthorization:'40크레딧 추가 실행',
  subsequentAmendment:'무기 없는 T자 앞/옆/뒤. 갑옷과 투구는 일체형 하나. 무기 교체 및 서있기/지휘/검술 유지. 다음.',
  operations:{generation:35,rig:5},model:'meshy-7.1',automaticRetries:false,
  paidAnimation:false,priceSource:'https://docs.meshy.ai/en/api/pricing',
  enforcement:'Local exact operation reservation only; no provider-enforced per-task ceiling documented.',
});
function headers(){if(!process.env.MESHY_API_KEY)throw new Error('MESHY_API_KEY is not configured');return{Authorization:`Bearer ${process.env.MESHY_API_KEY}`,'Content-Type':'application/json'};}
async function get(endpoint){const r=await fetch(`https://api.meshy.ai/openapi/v1/${endpoint}`,{headers:headers(),signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(`Meshy GET HTTP ${r.status}`);return r.json();}
const ledger=()=>Object.keys(operations).flatMap(op=>existsSync(pathFor(op))?[read(pathFor(op))]:[]);
const reserved=jobs=>jobs.reduce((n,j)=>n+(j.consumedCredits??j.reservedCredits),0);
async function prepare(op){
  const spec=operations[op];if(!spec)throw new Error('Expected generation or rig');
  const request=read(join(BASE,'requests',spec.template)),references=[];
  if(op==='generation'){
    request.image_urls=[];
    for(const name of ['general-unarmed-front-v2.png','general-unarmed-back-v2.png','general-unarmed-left-v2.png']){
      const path=join(BASE,'references',name),bytes=readFileSync(path),meta=await sharp(bytes).metadata();
      if(meta.width!==1254||meta.height!==1254)throw new Error('Reference dimensions changed');
      const provenance=read(path.replace(/\.png$/,'.provenance.json'));
      if(provenance.weaponCount!==0&&provenance.visualReview?.weaponCount!==0)throw new Error(`Unarmed visual review missing: ${name}`);
      references.push({path:relative(ROOT,path).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes),width:meta.width,height:meta.height,weaponCount:0});
      request.image_urls.push(`data:image/png;base64,${bytes.toString('base64')}`);
    }
    if(request.ai_model!=='meshy-7.1'||request.geometry_resolution!=='2k'||request.texture_resolution!=='4k')throw new Error('Unapproved generation parameters');
  }else{
    const generation=read(pathFor('generation')),gate=read(join(BASE,'review/generation-raw.json'));
    if(generation.status!=='SUCCEEDED'||gate.taskId!==generation.taskId||gate.acceptedForRigging!==true||!(gate.triangles>0&&gate.triangles<=300000))throw new Error('Raw integrated model has not passed inspection');
    request.input_task_id=generation.taskId;
  }
  return{request,references,requestSha256:hash(JSON.stringify(request))};
}
async function submit(op){
  const lock=join(JOBS,'create.lock'),fd=openSync(lock,'wx');
  try{
    if(existsSync(pathFor(op)))throw new Error('Durable intent already exists; never resubmit this operation');
    const spec=operations[op],approval=read(approvalPath),jobs=ledger();
    if(!spec||approval.maximumCredits!==40||approval.operations[op]!==spec.credits)throw new Error('Approval scope mismatch');
    if(jobs.some(j=>['submitting','submission-uncertain'].includes(j.status)))throw new Error('Unresolved create blocks further spending');
    if(jobs.some(j=>j.consumedCredits>j.reservedCredits)||reserved(jobs)+spec.credits>40)throw new Error('Credit reservation ceiling reached');
    const prepared=await prepare(op),balance=await get('balance');
    if(balance.balance<spec.credits)throw new Error('Insufficient available credits');
    const job={schema:'imjin.integrated-general-job.v1',operation:op,endpoint:spec.endpoint,status:'submitting',createdAt:now(),reservedCredits:spec.credits,createAttempts:1,
      references:prepared.references,requestSha256:prepared.requestSha256,
      request:{...prepared.request,...(op==='generation'?{image_urls:prepared.references.map(r=>`sha256:${r.sha256}`)}:{})},balanceBefore:balance};
    save(pathFor(op),job);
    let response;
    try{
      const r=await fetch(`https://api.meshy.ai/openapi/v1/${spec.endpoint}`,{method:'POST',headers:headers(),body:JSON.stringify(prepared.request),signal:AbortSignal.timeout(180000)});
      const body=await r.text();
      if(!r.ok){job.status='create-rejected';job.httpStatus=r.status;job.errorBodySha256=hash(body);save(pathFor(op),job);throw new Error(`Meshy create HTTP ${r.status}; no automatic retry`);}
      response=JSON.parse(body);if(typeof response.result!=='string'||!response.result)throw new Error('Create response had no task ID');
    }catch(error){if(job.status==='submitting'){job.status='submission-uncertain';save(pathFor(op),job);}throw error;}
    job.taskId=response.result;job.status='PENDING';job.submittedAt=now();save(pathFor(op),job);
    console.log(JSON.stringify({operation:op,taskId:job.taskId,status:job.status,reservedCredits:spec.credits,committedCredits:reserved(ledger())}));
  }finally{closeSync(fd);unlinkSync(lock);}
}
async function download(url,path){
  if(!existsSync(path)){
    const r=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!r.ok)throw new Error(`Download HTTP ${r.status}`);
    const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length<100)throw new Error('Empty provider result');
    if(path.endsWith('.glb')&&(bytes.toString('utf8',0,4)!=='glTF'||bytes.readUInt32LE(8)!==bytes.length))throw new Error('Invalid GLB bytes');
    mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,bytes,{flag:'wx'});
  }
  const bytes=readFileSync(path);return{path:relative(ROOT,path).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)};
}
async function observe(op){
  if(!existsSync(pathFor(op)))return;const job=read(pathFor(op));if(!job.taskId){console.log(JSON.stringify({operation:op,status:job.status}));return;}
  const task=await get(`${job.endpoint}/${job.taskId}`);job.status=task.status;job.progress=task.progress;job.lastObservedAt=now();
  if(typeof task.consumed_credits==='number')job.consumedCredits=task.consumed_credits;
  job.balanceAfter=await get('balance');save(pathFor(op),job);
  if(task.status==='SUCCEEDED'){
    const dest=join(BASE,'raw',op);job.downloads??={};
    for(const[key,url]of Object.entries(task.model_urls??{}))if(typeof url==='string'&&key.includes('glb'))job.downloads[key]=await download(url,join(dest,`${key}.glb`));
    for(const[key,url]of Object.entries(task.thumbnail_urls??{}))if(typeof url==='string')job.downloads[`thumbnail_${key}`]=await download(url,join(dest,`thumbnail_${key}.png`));
    if(task.thumbnail_url)job.downloads.thumbnail=await download(task.thumbnail_url,join(dest,'thumbnail.png'));
    const walk=async(value,prefix='')=>{for(const[key,item]of Object.entries(value??{})){const name=prefix?`${prefix}_${key}`:key;if(typeof item==='string'&&/^https:\/\//.test(item)&&/glb/i.test(key))job.downloads[name]=await download(item,join(dest,`${name}.glb`));else if(item&&typeof item==='object'&&!Array.isArray(item))await walk(item,name);}};
    if(op==='rig')await walk(task.result);save(pathFor(op),job);
  }
  console.log(JSON.stringify({operation:op,taskId:job.taskId,status:job.status,progress:job.progress,consumedCredits:job.consumedCredits,balance:job.balanceAfter.balance,downloads:Object.keys(job.downloads??{})}));
}
try{
  if(command==='submit')await submit(id);
  else if(command==='prepare'){const p=await prepare(id);console.log(JSON.stringify({operation:id,requestSha256:p.requestSha256,references:p.references,settings:{...p.request,image_urls:p.references.map(r=>r.path)}},null,2));}
  else if(command==='status')for(const op of id?[id]:Object.keys(operations))await observe(op);
  else throw new Error('Usage: generate-integrated-general.mjs prepare|submit|status [generation|rig]');
}catch(error){console.error(error.message);process.exitCode=1;}
