// Local deformation of the NEW generated open hands. No donor mesh, topology replacement or provider calls.
// Input is a caller-owned NodeIO Document in its glTF Y-up bind pose; source files are never read or written here.
import { Matrix4, Vector3 } from 'three';

const smooth = (a,b,x) => { const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
const M = a => new Matrix4().fromArray(a);
const at = n => new Vector3().setFromMatrixPosition(M(n.getWorldMatrix()));
const empty = () => ({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
const grow = (b,p) => p.toArray().forEach((v,i)=>{b.min[i]=Math.min(b.min[i],v);b.max[i]=Math.max(b.max[i],v);});
const finish = b => ({...b,size:b.max.map((v,i)=>v-b.min[i])});

/** Mutates only POSITION/NORMAL for hand vertices plus two child sockets; preserves joints, skin weights, UVs and indices. */
export function closeGeneralHands(doc, options={}) {
  const {fistLength=.112,gripRadius=.014}=options;
  if(!(fistLength>=.09&&fistLength<=.14&&gripRadius>=.009&&gripRadius<=.022))throw new Error('Use a 9..14 cm fist and 9..22 mm grip radius.');
  const root=doc.getRoot(),skin=root.listSkins()[options.skinIndex??0];
  if(!skin)throw new Error('Closing hands requires the new skinned body.');
  const joints=skin.listJoints(),byName=new Map(joints.map((n,i)=>[n.getName(),{node:n,index:i}]));
  if(root.listNodes().some(n=>/^socket_grip_(right|left)$/.test(n.getName())))throw new Error('Grip sockets already exist; do not close the same document twice.');
  const report={version:'experimental-v7',method:'Curl new hand vertices, fold the thumb, round the palm around the forearm-axis grip; no old geometry.',fistLength,gripRadius,oldGeometryUsed:false,topologyChanged:false,hands:{},sockets:{},modifiedVertices:0,recommendedForRuntime:false,warnings:['Palm and thumb creases still need manual visual refinement at close range.'],verificationBoundary:'Local static hand reshaping only. Inspect front/profile/end-on and weapon contact before runtime acceptance.'};
  const hands=[];
  for(const side of ['right','left']){
    const prefix=side==='right'?'Right':'Left',short=side==='right'?'R':'L';
    const hand=byName.get(prefix+'Hand')??byName.get(short+'_Hand'),fore=byName.get(prefix+'ForeArm')??byName.get(short+'_Forearm');
    if(!hand||!fore)throw new Error(`Missing ${side} wrist/forearm.`);
    const wrist=at(hand.node),axis=wrist.clone().sub(at(fore.node)).normalize();
    const breadth=new Vector3(0,0,1).addScaledVector(axis,-axis.z).normalize();
    const up=new Vector3(0,1,0).addScaledVector(axis,-axis.y).addScaledVector(breadth,-breadth.y).normalize();
    const product=M(hand.node.getWorldMatrix()).multiply(M(skin.getInverseBindMatrices().getElement(hand.index,[])));
    hands.push({side,hand,fore,wrist,axis,breadth,up,product,inverse:product.clone().invert(),before:empty(),after:empty(),count:0});
  }
  for(const node of root.listNodes().filter(n=>n.getSkin()===skin&&n.getMesh()))for(const primitive of node.getMesh().listPrimitives()){
    const ps=primitive.getAttribute('POSITION'),js=primitive.getAttribute('JOINTS_0'),ws=primitive.getAttribute('WEIGHTS_0');
    if(!ps||!js||!ws)continue;
    const changed=new Set(), edited=new Map();
    for(let i=0;i<ps.getCount();i++){
      const indices=js.getElement(i,[]),weights=ws.getElement(i,[]);
      for(const h of hands){
        const influence=indices.reduce((sum,index,k)=>sum+(index===h.hand.index?weights[k]:0),0);
        if(influence<.15)continue;
        const raw=new Vector3(...ps.getElement(i,[])),world=raw.clone().applyMatrix4(h.product),delta=world.clone().sub(h.wrist);
        const s=delta.dot(h.axis),b=delta.dot(h.breadth),u=delta.dot(h.up);
        if(s<=.008||s>.30||Math.abs(b)>.17||Math.abs(u)>.12)continue;
        grow(h.before,world);
        const blend=smooth(.008,.038,s)*smooth(.15,.65,influence);
        const palm=.075,center=.061,radius=gripRadius+.011;
        let a=s,t=b,c=u;
        if(s>palm){
          const theta=Math.min(4.25,Math.max(0,(s-palm)/.145*4.25));
          const surface=.011*Math.tanh((u-.015)/.010);
          a=palm+(radius+surface)*Math.sin(theta);
          c=-radius+(radius+surface)*Math.cos(theta);
        }
        // The thumb is the front-side short digit, separated from the four long fingers in this NEW source.
        const thumb=smooth(.055,.090,b)*smooth(.065,.090,s);
        if(thumb>0){
          const q=Math.max(0,Math.min(1,(b-.028)/.076));
          const theta=.20+q*2.3,thumbRadius=gripRadius+.016+.010*Math.tanh((u-.005)/.014);
          // Retain all three source dimensions: s spans thumb width, b follows its curl, u retains flesh thickness.
          const thumbAxial=.080+(s-.105)*.45,thumbBreadth=-.014+thumbRadius*Math.sin(theta),thumbUp=-radius+thumbRadius*Math.cos(theta);
          const ta=center-thumbBreadth,tb=thumbAxial-center,tc=thumbUp;
          a=a*(1-thumb)+ta*thumb;t=t*(1-thumb)+tb*thumb;c=c*(1-thumb)+tc*thumb;
        }
        // A smooth palm turn puts the grip cylinder along the forearm instead of across the open palm.
        const turn=smooth(.014,.070,s)*Math.PI/2,cos=Math.cos(turn),sin=Math.sin(turn);
        let axial=(center+cos*(a-center)+sin*t)*(fistLength/.112);
        const cap=fistLength-.012;
        if(axial>cap)axial=cap+.012*Math.tanh((axial-cap)/.012);
        const lateral=-sin*(a-center)+cos*t;
        // Dorsal and palmar surfaces become the two radii of a rounded palm, rather than a flat sheet over the hilt.
        const palmBlend=smooth(.024,.060,s)*(1-smooth(.073,.100,s))*(1-thumb*.8);
        const surfaceRadius=gripRadius+.002+Math.max(0,Math.min(1,(u+.024)/.066))*.026;
        const rounded=-radius+Math.sqrt(Math.max(.00002,surfaceRadius*surfaceRadius-lateral*lateral));
        c=c*(1-palmBlend)+rounded*palmBlend;
        const target=h.wrist.clone().addScaledVector(h.axis,axial).addScaledVector(h.breadth,lateral).addScaledVector(h.up,c);
        world.lerp(target,blend);
        ps.setElement(i,world.applyMatrix4(h.inverse).toArray());changed.add(i);edited.set(i,{hand:h,blend});h.count++;
        break;
      }
    }
    const normals=primitive.getAttribute('NORMAL'),index=primitive.getIndices();
    for(const [i,e]of edited)grow(e.hand.after,new Vector3(...ps.getElement(i,[])).applyMatrix4(e.hand.product));
    // Update only normals touched by this deformation, preserving the rest of the body's authored shading.
    if(normals&&index&&changed.size){
      const sums=new Map([...changed].map(i=>[i,new Vector3()]));
      for(let t=0;t<index.getCount();t+=3){
        const ids=[index.getScalar(t),index.getScalar(t+1),index.getScalar(t+2)];if(!ids.some(i=>changed.has(i)))continue;
        const points=ids.map(i=>new Vector3(...ps.getElement(i,[]))),normal=points[1].sub(points[0]).cross(points[2].sub(points[0]));
        for(const i of ids)if(sums.has(i))sums.get(i).add(normal);
      }
      for(const [i,n]of sums)if(n.lengthSq()>1e-18)normals.setElement(i,n.normalize().toArray());
    }
    report.modifiedVertices+=changed.size;
  }
  for(const h of hands){
    if(h.count<100)throw new Error(`Only ${h.count} ${h.side} vertices found; source does not match the supported open-hand layout.`);
    const name='socket_grip_'+h.side;
    const worldOrigin=h.wrist.clone().addScaledVector(h.axis,.061*fistLength/.112).addScaledVector(h.breadth,-.014).addScaledVector(h.up,-(gripRadius+.011));
    const y=h.axis,z=h.breadth,x=y.clone().cross(z).normalize();
    const desired=new Matrix4().makeBasis(x,y,z).setPosition(worldOrigin);
    const local=M(h.hand.node.getWorldMatrix()).invert().multiply(desired);
    const socket=doc.createNode(name).setMatrix(local.toArray()).setExtras({purpose:'weapon grip',axis:'+Y forearm outward; +Z body front',units:'world metres in bind pose',side:h.side,gripRadius});
    h.hand.node.addChild(socket);
    report.hands[h.side]={joint:h.hand.node.getName(),wrist:h.wrist.toArray(),restForearmAxis:h.axis.toArray(),vertices:h.count,before:finish(h.before),after:finish(h.after)};
    report.sockets[h.side]={name,worldOrigin:worldOrigin.toArray(),worldMatrix:desired.toArray(),handLocalMatrix:local.toArray()};
  }
  return report;
}
