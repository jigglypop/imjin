// The review-gate sheet of a standing (idle-only) figure, rendered in Edge from the dev server (http://127.0.0.1:5291):
// front / side / back / face; the idle at 3 frames from front, side and 3/4 at eye height; the idle with the sword held
// as /generals holds it (socket, EDGE_TO_FINGERS, swordGripShift, idleBlade hang); hand close-ups of the grip.
// The holding code mirrors src/ui/generals/GeneralModel.tsx holdWeapon + hangSword (the module needs React to import).
//   node scripts/generals-gate-sheet.mjs <key> <weapon id> <out.jpg> [left]
import { chromium } from 'playwright-core';

const [key, weapon, out, side = 'right'] = process.argv.slice(2);
const B = 'http://127.0.0.1:5291';
const url = `/models/generals/${key}.glb`, wurl = `/models/generals/parts/weapon_${weapon}.glb`;
const cells = [];
const cell = (label, frac, view, held = true) => cells.push({ label, frac, view, held });
for (const v of ['front', 'side', 'back', 'face']) cell(v, 0, v, v !== 'face');
for (const f of [0.1, 0.45, 0.8]) for (const v of ['efront', 'eside', 'eq']) cell(`idle ${f} ${v}`, f, v, false);
for (const f of [0.1, 0.45, 0.8]) for (const v of ['front', 'q']) cell(`idle+sword ${f} ${v}`, f, v);
for (const v of ['hand', 'hand2', 'hand3']) cell(`grip ${v}`, 0.45, v);

const html = `<html><head><script type="importmap">{"imports":{"three":"${B}/node_modules/three/build/three.module.js","three/addons/":"${B}/node_modules/three/examples/jsm/"}}</script></head><body style="margin:0;background:#222"><canvas id=c></canvas><script type="module">
import * as T from 'three'; import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'; import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import { idleBlade } from '${B}/src/ui/generals/idleBlade.ts';
const SIDE='${side}', SOCK=SIDE==='left'?'socket_grip_left':'socket_grip_right', HAND=SIDE==='left'?'LeftHand':'RightHand';
function gripShift(w){w.updateMatrixWorld(true);const inv=w.matrixWorld.clone().invert(),pts=[];w.traverse(o=>{const p=o.geometry?.getAttribute('position');if(!o.isMesh||!p)return;const m=new T.Matrix4().multiplyMatrices(inv,o.matrixWorld);for(let i=0;i<p.count;i++)pts.push(new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(m));});let lo=1e9,hi=-1e9;for(const p of pts){lo=Math.min(lo,p.y);hi=Math.max(hi,p.y);}const B=60,wd=new Array(B).fill(0),st=(hi-lo)/B;for(const p of pts){const b=Math.min(B-1,Math.floor((p.y-lo)/st));wd[b]=Math.max(wd[b],Math.hypot(p.x,p.z));}let g=0;for(let b=0;b<B/2;b++)if(wd[b]>wd[g])g=b;return Math.max(0,lo+(g+.5)*st-.055);}
function hold(root,w){root.updateMatrixWorld(true);const s=root.getObjectByName(SOCK);const h=new T.Group();h.add(w);h.position.copy(s.getWorldPosition(new T.Vector3()));h.quaternion.copy(s.getWorldQuaternion(new T.Quaternion())).multiply(new T.Quaternion(0,1,0,0));s.attach(h);w.position.y-=gripShift(w);return h;}
function hang(root,h){const s=h.parent,hips=root.getObjectByName('Hips');root.updateMatrixWorld(true);const hand=root.worldToLocal(s.getWorldPosition(new T.Vector3())).toArray(),hip=root.worldToLocal(hips.getWorldPosition(new T.Vector3())).toArray();const {dir,edge}=idleBlade(hand,hip);const x=new T.Vector3(...edge),y=new T.Vector3(...dir),z=new T.Vector3().crossVectors(x,y);const q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,z)).premultiply(root.getWorldQuaternion(new T.Quaternion()));q.premultiply(s.getWorldQuaternion(new T.Quaternion()).invert());h.quaternion.copy(q);}
const cells=${JSON.stringify(cells)};const W=360,H=480,C=4,rows=Math.ceil(cells.length/C);
const out=document.getElementById('c');out.width=W*C;out.height=H*rows;const g=out.getContext('2d');g.fillStyle='#2a2a2e';g.fillRect(0,0,out.width,out.height);
const r=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(W,H);r.outputColorSpace=T.SRGBColorSpace;r.toneMapping=T.ACESFilmicToneMapping;
const L=new GLTFLoader();L.setMeshoptDecoder(MeshoptDecoder);
for(let i=0;i<cells.length;i++){const c=cells[i];const gl=await L.loadAsync('${B}${url}');
 const s=new T.Scene();s.background=new T.Color(0x3a3d44);s.add(new T.HemisphereLight(0xffffff,0x444444,2));const d=new T.DirectionalLight(0xffffff,2.5);d.position.set(2,4,3);s.add(d);
 const root=gl.scene;s.add(root);let held=null;if(c.held){held=hold(root,(await L.loadAsync('${B}${wurl}')).scene);}
 const m=new T.AnimationMixer(root);const clip=gl.animations.find(a=>a.name==='idle_sword');m.clipAction(clip).play();m.setTime(clip.duration*c.frac);root.updateMatrixWorld(true);if(held)hang(root,held);root.updateMatrixWorld(true);
 root.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();}});const box=new T.Box3().setFromObject(root,true);if(held)box.expandByObject(held);const ctr=box.getCenter(new T.Vector3()),h=box.max.y-box.min.y;
 const cam=new T.PerspectiveCamera(30,W/H,.01,100);const ang={front:0,side:Math.PI/2,back:Math.PI,q:Math.PI/4,face:0,efront:0,eside:Math.PI/2,eq:Math.PI/4}[c.view]??0;
 if(c.view==='face'){const hd=root.getObjectByName('Head').getWorldPosition(new T.Vector3());cam.fov=14;cam.updateProjectionMatrix();cam.position.set(hd.x,hd.y+.03,hd.z+1.3);cam.lookAt(hd.x,hd.y+.03,hd.z);}
 else if(c.view.startsWith('hand')){const hp=root.getObjectByName(HAND).getWorldPosition(new T.Vector3());const a2={hand:.6,hand2:.6+Math.PI/2,hand3:-.6}[c.view];cam.fov=35;cam.updateProjectionMatrix();cam.position.set(hp.x+Math.sin(a2)*.55,hp.y+.12,hp.z+Math.cos(a2)*.55);cam.lookAt(hp);}
 else if(c.view.startsWith('e')){const ey=box.max.y-h*.075;cam.position.set(ctr.x+Math.sin(ang)*h*2.3,ey,ctr.z+Math.cos(ang)*h*2.3);cam.lookAt(ctr.x,ctr.y,ctr.z);}
 else{cam.position.set(ctr.x+Math.sin(ang)*h*2,ctr.y,ctr.z+Math.cos(ang)*h*2);cam.lookAt(ctr);}
 r.render(s,cam);g.drawImage(r.domElement,(i%C)*W,Math.floor(i/C)*H);g.fillStyle='#fff';g.font='16px sans-serif';g.fillText(c.label,(i%C)*W+8,Math.floor(i/C)*H+20);}
window.done=true;</script></body></html>`;
const b = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
p.on('console', (m) => m.type() === 'error' && console.log(m.text()));
p.on('pageerror', (e) => console.log(String(e)));
await p.goto(B + '/');
// Never render a sheet while the dev server shows a Vite error (a broken module elsewhere can blank or skew the page).
await p.waitForTimeout(3000);
if (await p.locator('vite-error-overlay').count()) { console.error('Vite error overlay on the dev server: fix it first'); await b.close(); process.exit(1); }
await p.setContent(html);
await p.waitForFunction(() => window.done === true, null, { timeout: 900000 });
await p.locator('#c').screenshot({ path: out, type: 'jpeg', quality: 85 });
await b.close(); console.log(out);
