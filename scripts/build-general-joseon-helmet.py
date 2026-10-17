"""Original locally authored Joseon-style dujeong helmet candidate.
No external helmet mesh is imported. Source references guide style only.
Export contract: glTF +Y up / +Z face; origin is brow-plane skull centre.
"""
import bpy, bmesh, math, json, sys, hashlib, argparse
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT=Path('C:/dev/imjin'); SRC=ROOT/'assets-src/generals-helmets-2026-10-17'; OUT=ROOT/'public/models/generals/parts/v2'; WORK=Path('F:/codex-work/imjin/helmet-production')
for d in [SRC,OUT,WORK,SRC/'textures']:d.mkdir(parents=True,exist_ok=True)
PARTS=[]; RX=.112;RZ=.132;DOME=.180
def p(v):return (v[0],-v[2],v[1])
def material(name,color,metal=0,rough=.5):
    m=bpy.data.materials.new(name);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Metallic'].default_value=metal;bs.inputs['Roughness'].default_value=rough;m.diffuse_color=(*color,1);return m
IRON=material('Wrought iron - charcoal hammered surface',(.10,.12,.13),.78,.41)
BRASS=material('Aged yellow brass rivets and trim',(.46,.29,.10),.79,.33)
EDGEBRASS=material('Rubbed brass edge',(.65,.44,.16),.82,.29)
LEATHER=material('Dark leather lining',(.043,.026,.016),0,.78)
CLOTH=material('Oxblood cotton brigandine curtain',(.19,.026,.023),0,.83)
SEAM=material('Faded red stitched seam',(.27,.074,.048),0,.9)
PLUME=material('Horsehair plume - deep crimson',(.16,.008,.015),0,.65)
PLUME2=material('Horsehair plume - red highlights',(.28,.02,.025),0,.68)

def texture(material,kind):
    n=512;yy,xx=np.mgrid[0:n,0:n];rng=np.random.default_rng(1592 if kind=='iron' else 1593)
    noise=rng.normal(0,1,(n,n));slow=np.sin(xx*.058)*np.sin(yy*.047)+.5*np.cos(xx*.031+yy*.022)
    if kind=='iron':
        base=np.array([.105,.120,.128]);height=noise*.003+slow*.007+np.sin(xx*.19+np.sin(yy*.07))*.004
        colors=np.clip(base[None,None,:]*(1+noise[:,:,None]*.06+slow[:,:,None]*.1),0,1);rough=np.clip(.43+noise*.035+slow*.04,0,1)
    else:
        base=np.array([.20,.028,.024]);weave=np.sin(xx*math.pi/2)*np.cos(yy*math.pi/2);height=weave*.018+noise*.002
        colors=np.clip(base[None,None,:]*(1+noise[:,:,None]*.04+weave[:,:,None]*.055+slow[:,:,None]*.09),0,1);rough=np.clip(.83+weave*.025+noise*.01,0,1)
    dy,dx=np.gradient(height);normal=np.dstack((-dx*4,-dy*4,np.ones_like(height)));normal/=np.linalg.norm(normal,axis=2)[:,:,None];normal=normal*.5+.5
    def image(name,rgb):
        a=np.ones((n,n,4),dtype=np.float32);a[:,:,:3]=rgb;im=bpy.data.images.new(name,width=n,height=n,alpha=False);im.pixels.foreach_set(a.ravel());im.filepath_raw=str(SRC/'textures'/f'{name}.png');im.file_format='PNG';im.save();im.pack();return im
    color=image(kind+'-authored-base',colors);ro=image(kind+'-authored-roughness',np.repeat(rough[:,:,None],3,axis=2));no=image(kind+'-authored-normal',normal)
    nodes=material.node_tree.nodes;links=material.node_tree.links;bs=nodes.get('Principled BSDF')
    for im,socket in [(color,'Base Color'),(ro,'Roughness')]:
        node=nodes.new('ShaderNodeTexImage');node.image=im
        if socket!='Base Color':im.colorspace_settings.name='Non-Color'
        links.new(node.outputs['Color'],bs.inputs[socket])
    node=nodes.new('ShaderNodeTexImage');node.image=no;no.colorspace_settings.name='Non-Color';norm=nodes.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.30 if kind=='iron' else .24;links.new(node.outputs['Color'],norm.inputs['Color']);links.new(norm.outputs['Normal'],bs.inputs['Normal'])
texture(IRON,'iron');texture(CLOTH,'cloth')

def mesh(name,verts,faces,mat,uv=None,smooth=False):
    me=bpy.data.meshes.new(name);me.from_pydata([p(v) for v in verts],[],faces);me.update()
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);me.materials.append(mat)
    layer=me.uv_layers.new(name='Authored surface coordinates')
    for face in me.polygons:
        face.use_smooth=smooth
        for li in face.loop_indices:
            vi=me.loops[li].vertex_index
            if uv:layer.data[li].uv=uv[vi]
            else:
                co=verts[vi];layer.data[li].uv=(co[0]*7,co[1]*7)
    # Weld the mathematical pole of each dome/rivet into one actual vertex,
    # retaining per-loop UVs. No coincident zero-area fan faces are exported.
    bm=bmesh.new();bm.from_mesh(me);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7);bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-9);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free();me.validate(clean_customdata=False);me.update()
    PARTS.append(ob);return ob
def tube(name,points,radii,mat,sides=10):
    vs=[]
    for i,co in enumerate(points):
        tangent=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)]);tangent.normalize();n=tangent.cross(Vector((1,0,0)))
        if n.length<.01:n=tangent.cross(Vector((0,0,1)))
        n.normalize();bi=tangent.cross(n).normalized();r=radii[i] if isinstance(radii,list) else radii
        for k in range(sides):a=k*math.tau/sides;vs.append(Vector(co)+r*(math.cos(a)*n+math.sin(a)*bi))
    fs=[]
    for i in range(len(points)-1):
        for k in range(sides):fs.append((i*sides+k,i*sides+(k+1)%sides,(i+1)*sides+(k+1)%sides,(i+1)*sides+k))
    fs += [tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+k for k in range(sides))]
    return mesh(name,vs,fs,mat,smooth=True)
def ring(name,y,rx,rz,h,mat,sides=64):
    vs=[];uv=[]
    for dy,offset in [(-h/2,-.0015),(-h*.35,.001),(h*.35,.001),(h/2,-.0015)]:
        for k in range(sides+1):
            a=k*math.tau/sides;vs.append(((rx+offset)*math.sin(a),y+dy,(rz+offset)*math.cos(a)));uv.append((k/sides,dy/h+.5))
    fs=[]
    for j in range(3):
        for k in range(sides):i=j*(sides+1)+k;fs.append((i,i+1,i+sides+2,i+sides+1))
    return mesh(name,vs,fs,mat,uv,True)
def rivet(name,center,normal,radius=.0042,mat=BRASS,sides=12):
    # Convex peened head with a raised shoulder and visible washer.
    n=Vector(normal).normalized();a=n.cross(Vector((0,1,0)))
    if a.length<.01:a=n.cross(Vector((1,0,0)))
    a.normalize();b=n.cross(a).normalized();c=Vector(center);vs=[]
    for depth,rad in [(0,radius*1.12),(.0006,radius*1.1),(.0019,radius*.82),(.0032,radius*.33),(.0034,0)]:
        for k in range(sides):t=k*math.tau/sides;vs.append(c+n*depth+rad*(math.cos(t)*a+math.sin(t)*b))
    fs=[]
    for j in range(4):
        for k in range(sides):fs.append((j*sides+k,j*sides+(k+1)%sides,(j+1)*sides+(k+1)%sides,(j+1)*sides+k))
    return mesh(name,vs,fs,mat,smooth=True)
def lathe(name,profile,mat,sides=32):
    vs=[]
    for y,r in profile:vs.extend([(r*math.sin(k*math.tau/sides),y,r*math.cos(k*math.tau/sides)) for k in range(sides)])
    fs=[]
    for j in range(len(profile)-1):
        for k in range(sides):fs.append((j*sides+k,j*sides+(k+1)%sides,(j+1)*sides+(k+1)%sides,(j+1)*sides+k))
    return mesh(name,vs,fs,mat,smooth=True)

def dome():
    sides=64;rings=21;vs=[];uv=[]
    # Rounded tall hemisphere with subtle hand-forged gores. The shell has a
    # genuine 3mm interior wall and an open head cavity at the brow plane.
    for inner in [False,True]:
        for j in range(rings+1):
            t=j/rings;phi=t*math.pi/2;r=math.cos(phi);height=.012+DOME*math.sin(phi)
            for k in range(sides+1):
                theta=k*math.tau/sides;forged=1+.006*math.cos(theta*8)*math.sin(phi*2)
                x=(RX-(.003 if inner else 0))*r*math.sin(theta)*forged;z=(RZ-(.003 if inner else 0))*r*math.cos(theta)*forged;y=height-(.003 if inner else 0)
                vs.append((x,y,z));uv.append((k/sides,t))
    fs=[];row=sides+1;half=(rings+1)*row
    for offset in [0,half]:
        for j in range(rings):
            for k in range(sides):i=offset+j*row+k;fs.append((i,i+1,i+row+1,i+row))
    for k in range(sides):fs.append((k,k+1,half+k+1,half+k))
    mesh('Forged iron dome - hollow 3mm shell',vs,fs,IRON,uv,True)
    # Raised seam straps follow the spherical curvature rather than float.
    for s in range(8):
        theta=s*math.tau/8;pts=[]
        for j in range(24):
            phi=.03+j/23*1.44;r=math.cos(phi);pts.append(((RX+.0015)*r*math.sin(theta),.012+DOME*math.sin(phi),(RZ+.0015)*r*math.cos(theta)))
        tube('Forged gore seam strap',pts,.0018,IRON,6)
        for phi in [.20,.48,.76]:
            r=math.cos(phi);co=((RX+.002)*r*math.sin(theta),.012+DOME*math.sin(phi),(RZ+.002)*r*math.cos(theta));normal=(math.sin(theta)*r,math.sin(phi),math.cos(theta)*r)
            rivet('Small dome strap peen',co,normal,.0025,BRASS,8)
    ring('Wide iron brow band',.006,RX+.001,RZ+.001,.026,IRON)
    ring('Lower rolled brass rim',-.006,RX+.003,RZ+.003,.005,EDGEBRASS)
    ring('Upper brass band edge',.020,RX+.002,RZ+.002,.003,BRASS)
    ring('Padded leather inner brow',-.004,RX-.004,RZ-.004,.021,LEATHER)
    for k in range(32):
        a=k*math.tau/32;rivet('Brow band brass rivet',((RX+.003)*math.sin(a),.007,(RZ+.003)*math.cos(a)),(math.sin(a),0,math.cos(a)),.0041)
    # Short flared front brim shades the brow, never extends down the face.
    vs=[];uv=[];n=36
    for row in range(3):
        for k in range(n+1):
            a=(-72+144*k/n)*math.pi/180;extension=.017*math.cos(a*.8)**2*row/2
            vs.append(((RX+extension)*math.sin(a),-.009-.003*row/2,(RZ+extension)*math.cos(a)));uv.append((k/n,row/2))
    fs=[]
    for row in range(2):
        for k in range(n):i=row*(n+1)+k;fs.append((i,i+1,i+n+2,i+n+1))
    brim=mesh('Rolled short front brim',vs,fs,IRON,uv);sol=brim.modifiers.new('Brim edge thickness','SOLIDIFY');sol.thickness=.0022;bev=brim.modifiers.new('Soft worked brim lip','BEVEL');bev.width=.0012;bev.segments=2
    # Spike/collar echo the reference without ornamental fantasy additions.
    lathe('Stepped brass spike socket',[(.185,.020),(.190,.022),(.194,.022),(.198,.015),(.204,.013),(.208,.016),(.211,.016)],BRASS)
    lathe('Faceted finial',[(.209,.011),(.218,.013),(.248,.0006)],EDGEBRASS,8)

def curtain(name,start,end,back=False):
    cols=16 if back else 12;rows=14;vs=[];uv=[]
    def point(u,v):
        angle=math.radians(start+(end-start)*u);sin=math.sin(angle);cos=math.cos(angle)
        flare=1+.24*v*v;radiusx=(RX-.001)*flare;radiusz=(RZ-.001)*flare
        # Quiet, structural quilt relief. Cloth is supported by real panel
        # thickness; the rear is fully closed, never a painted-on face.
        quilt=.0013*math.cos(u*math.pi*8)*math.cos(v*math.pi*10)
        y=-.017-v*(.235 if back else .222)+.012*(2*u-1)**2*v
        return ((radiusx+quilt)*sin,y,(radiusz+quilt)*cos)
    for j in range(rows+1):
        for k in range(cols+1):u=k/cols;v=j/rows;vs.append(point(u,v));uv.append((u*1.3,v*2))
    fs=[]
    for j in range(rows):
        for k in range(cols):i=j*(cols+1)+k;fs.append((i,i+1,i+cols+2,i+cols+1))
    ob=mesh(name+' cotton panel',vs,fs,CLOTH,uv,True);sol=ob.modifiers.new('Layered brigandine curtain thickness','SOLIDIFY');sol.thickness=.0038;sol.offset=-.2
    # Continuous leather piping and separate red stitches follow all hems.
    boundary=[point(0,j/rows) for j in range(rows+1)]+[point(k/cols,1) for k in range(1,cols+1)]+[point(1,1-j/rows) for j in range(1,rows+1)]
    tube(name+' leather bound hem',boundary,.003,LEATHER,8)
    for u in [.025,.975]:
        for j in range(20):
            v=.015+j*.048;co=point(u,v);angle=math.radians(start+(end-start)*u);normal=Vector((math.sin(angle),0,math.cos(angle)))
            pts=[tuple(Vector(point(u,v+off))+normal*.004) for off in [0,.018]];tube(name+' cotton hem stitch',pts,.00055,SEAM,4)
    # Five rivet rows with staggered columns, as on the coat reference.
    ncol=7 if back else 5
    for row in range(5):
        v=.13+row*.175
        for col in range(ncol):
            u=.11+col*(.78/(ncol-1))+(0.025 if row%2 else 0);co=point(u,v);angle=math.radians(start+(end-start)*u)
            rivet(name+' brass plate rivet',co,(math.sin(angle),-.06,math.cos(angle)),.0034,sides=10)
    # Visible top attachment loops, no straps across the open face.
    for u in [.17,.5,.83]:
        angle=math.radians(start+(end-start)*u);co=point(u,0);pts=[(co[0],.007,co[2]),(co[0]*1.018,-.015,co[2]*1.018),(co[0]*1.02,-.026,co[2]*1.02)];tube(name+' leather suspension loop',pts,.003,LEATHER,8)

def plume():
    # Dense tapered curved fibres, swept only to the rear; not an opaque red
    # cone. Each strand has a real volume and a controlled, irregular end.
    rng=np.random.default_rng(1771)
    for k in range(68):
        sx=rng.normal(0,.005);sz=rng.normal(0,.004);length=.19+rng.uniform(-.025,.03);spreadx=rng.normal(0,.016);spreadz=rng.uniform(-.012,.024)
        pts=[]
        for i in range(10):
            t=i/9;pts.append((sx+spreadx*t*t,.211+.045*math.sin(t*math.pi*.9)-length*t*t,-.006-.118*t+sz+spreadz*t*t))
        radius=.0011+rng.random()*.0007;radii=[radius*(1-i/10)**.7 for i in range(10)];radii[-1]=.00015
        tube('Individual swept red horsehair fibre',pts,radii,PLUME2 if k%4==0 else PLUME,6)
    lathe('Horsehair tie ferrule',[(.208,.008),(.218,.009),(.222,.007)],IRON,20)

def setup():
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True
    scene.render.resolution_x=768;scene.render.resolution_y=768;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.world.use_nodes=True
    bg=scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.21,.235,.27,1);bg.inputs[1].default_value=.6;scene.view_settings.view_transform='AgX'
    for name,loc,power,size in [('Key',(1,-2,2),220,3),('Rim',(-1,1,1),280,2),('Fill',(-2,-1,.5),130,3)]:
        d=bpy.data.lights.new(name,'AREA');ob=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(ob);ob.location=loc;d.energy=power;d.shape='DISK';d.size=size;ob.rotation_euler=(Vector((0,0,0))-ob.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('Helmet QA');cam=bpy.data.objects.new('Helmet QA',data);bpy.context.collection.objects.link(cam);data.type='ORTHO';data.lens=65;scene.camera=cam;return cam
def render(cam,name,eye,target,scale):
    cam.location=p(eye);cam.rotation_euler=(Vector(p(target))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=scale;bpy.context.scene.render.filepath=str(WORK/(name+'.png'));bpy.ops.render.render(write_still=True)
def count(obs):return sum(sum(len(f.vertices)-2 for f in ob.data.polygons) for ob in obs if ob.type=='MESH')
def export(obs,path,lod=False):
    bpy.ops.object.select_all(action='DESELECT')
    copies=[]
    for ob in obs:
        dup=ob.copy();dup.data=ob.data.copy();bpy.context.collection.objects.link(dup);dup.select_set(True);copies.append(dup)
    bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();proxy=bpy.context.object;proxy.name='Helmet shell, three separate cloth panels, rivets and horsehair';proxy.data.validate(clean_customdata=False);proxy.data.update()
    root=bpy.data.objects.new('helmet_joseon_dujeong',None);bpy.context.collection.objects.link(root);root['provenance']='Locally authored original helmet candidate; no provider-generated helmet geometry reused';root['attachment']='brow-plane skull centre';root['up']='+Y';root['front']='+Z';root.select_set(True)
    socket=bpy.data.objects.new('socket_helmet_brow',None);bpy.context.collection.objects.link(socket);socket.parent=root;socket.select_set(True)
    proxy.parent=root
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False,export_apply=True)
    bpy.data.objects.remove(proxy,do_unlink=True)
    bpy.data.objects.remove(socket,do_unlink=True);bpy.data.objects.remove(root,do_unlink=True)

def main():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);cam=setup()
    dome();curtain('Left cheek and neck guard',52,124);curtain('Rear closed neck guard',128,232,True);curtain('Right cheek and neck guard',236,308);plume()
    # Evaluate modifiers now so source/export/QA all show identical geometry.
    for ob in PARTS:
        bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
        for mod in list(ob.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
    high=count(PARTS);export(PARTS,OUT/'helmet_joseon_dujeong.glb')
    bpy.ops.wm.save_as_mainfile(filepath=str(SRC/'helmet_joseon_dujeong.blend'))
    if '--export-only' not in sys.argv:
        for name,eye in [('front',(0,.05,1)),('left',(1,.05,0)),('back',(0,.05,-1)),('right',(-1,.05,0))]:render(cam,'helmet-'+name,eye,(0,-.008,0),.56)
        render(cam,'helmet-three-quarter',(.8,.30,1),(0,-.005,0),.56)
    # Combined preview is a disposable in-memory copy of the untouched body.
    # Its head is uniformly reduced 10% around the neck base solely to match
    # the user's requested direction while the parent's final rig is pending.
    if '--export-only' not in sys.argv:
        for ob in PARTS:ob.location=Vector(p((0,.758,-.010)))
        bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets-src/generals-regeneration-2026-10-17/raw/body/glb.glb'))
        body=[o for o in bpy.context.selected_objects if o.type=='MESH']
        pivot=Vector(p((0,.648,-.010)))
        for ob in body:
            inverse=ob.matrix_world.inverted()
            for v in ob.data.vertices:
                world=ob.matrix_world@v.co
                if world.z>.640:
                    weight=min(1,max(0,(world.z-.640)/.025));adjusted=pivot+(world-pivot)*(1-.10*weight);v.co=inverse@adjusted
            ob.data.update()
        for name,eye in [('front',(0,.77,1.6)),('left',(1.6,.77,0)),('back',(0,.77,-1.6)),('right',(-1.6,.77,0))]:render(cam,'fit-'+name,eye,(0,.775,0),.72)
        render(cam,'fit-upper-body',(.75,.73,2),(0,.52,0),1.04)
        for ob in body:bpy.data.objects.remove(ob,do_unlink=True)
        for ob in PARTS:ob.location=(0,0,0)
    # LOD is a separate duplicate: original editable high mesh is preserved.
    low=[]
    for ob in PARTS:
        dup=ob.copy();dup.data=ob.data.copy();bpy.context.collection.objects.link(dup);low.append(dup)
        bpy.ops.object.select_all(action='DESELECT');dup.select_set(True);bpy.context.view_layer.objects.active=dup
        mod=dup.modifiers.new('LOD simplify original surface','DECIMATE');mod.ratio=min(1,9000/high);bpy.ops.object.modifier_apply(modifier=mod.name)
    export(low,OUT/'helmet_joseon_dujeong_lod1.glb',True)
    source=ROOT/'assets-src/generals-regeneration-2026-10-17/raw/body/glb.glb'
    receipt={'schema':'imjin.locally-authored-helmet-candidate.v1','candidate':True,'acceptedByUser':False,'created':'2026-10-17','provider':'None; no paid calls','authoring':'Original Blender hard-surface shell, separate three-panel cloth neck guards, formed rivets, curved individual horsehair fibres; deterministic authored 512px PBR textures','styleReference':'assets-src/generals-parts-2026-10-17/armor_joseon_dujeong_front.png (style only, zero mesh extraction)','historicalScope':'Joseon-style game interpretation matching the supplied costume concept, not an exact museum artifact replica','coordinates':{'up':'+Y','front':'+Z','origin':'brow-plane skull centre','socket':'socket_helmet_brow at exact origin','meters':True},'designDimensionsMeters':{'domeWidth':RX*2,'domeDepth':RZ*2,'domeHeight':DOME,'clothDrop':.235,'frontOpeningAngleDegrees':104},'triangles':{'high':high,'low':count(low)},'fitPreview':{'sourceBody':str(source),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'originalBodyUnchanged':True,'previewOnlyHeadScale':.90,'previewHeadPivotInRawBody':[0,.648,-.010],'previewBrowAnchorInRawBody':[0,.758,-.010],'warning':'Final bind/head attachment and cloth shoulder clearance require parent runtime review; preview body changes were in memory only, never exported.'},'files':[]}
    for file in [OUT/'helmet_joseon_dujeong.glb',OUT/'helmet_joseon_dujeong_lod1.glb',SRC/'helmet_joseon_dujeong.blend',Path(__file__)]:receipt['files'].append({'path':str(file),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
    (SRC/'provenance.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf8')
    print('HELMET_DONE '+json.dumps(receipt['triangles']),flush=True)
if __name__=='__main__':main()
