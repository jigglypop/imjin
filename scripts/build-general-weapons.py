"""Original authored wardrobe weapons. Blender 5.x, no provider or external meshes.

blender -b --python scripts/build-general-weapons.py -- --root C:/dev/imjin
Logical/export coordinates: X width, Y upright, Z forward. Grip is origin.
The blade section is authored in Blender coordinates through p() so exported
glTF uses the documented convention. Historical styles are game interpretations.
"""
import bpy, bmesh, math, json, os, sys, hashlib, argparse
from mathutils import Vector
from pathlib import Path

argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
ap=argparse.ArgumentParser(); ap.add_argument('--root',default='C:/dev/imjin'); ap.add_argument('--only',default=''); ap.add_argument('--no-render',action='store_true'); args=ap.parse_args(argv)
ROOT=Path(args.root); OUT=ROOT/'public/models/generals/parts'; SRC=ROOT/'assets-src/generals-weapons-2026-10-17'; WORK=Path('F:/codex-work/imjin/weapon-production'); THUMB=ROOT/'public/ui/weapons'
for d in [OUT,SRC,WORK,THUMB]: d.mkdir(parents=True,exist_ok=True)
PARTS=[]
def p(v): return (v[0],-v[2],v[1])
def mat(name,color,metal=0,rough=.4):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,1); bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    m.diffuse_color=(*color,1); return m
STEEL=mat('Forged steel - satin faces',(.44,.53,.59),.93,.28); EDGE=mat('Polished hardened edge',(.75,.81,.84),.98,.18); RIDGE=mat('Blued ridge',(.18,.25,.29),.93,.33); FULLER=mat('Recessed fuller',(.09,.13,.15),.95,.35)
GOLD=mat('Aged brass',(.57,.34,.11),.85,.29); GOLDBRIGHT=mat('Polished brass edge',(.80,.58,.23),.9,.22); IRON=mat('Blackened iron',(.048,.063,.071),.82,.3)
WOOD=mat('Oiled walnut',(.16,.068,.026),0,.39); BAMBOO=mat('Bamboo stave',(.40,.23,.075),0,.42); EBONY=mat('Ebony lacquer',(.026,.022,.021),.12,.22)
IVORY=mat('Bone and rayskin',(.74,.69,.54),0,.54); CORD=mat('Waxed natural cord',(.48,.36,.20),0,.72)
RED=mat('Crimson silk',(.30,.018,.021),0,.72); BLUE=mat('Indigo silk',(.022,.055,.095),0,.66); GREEN=mat('Deep olive silk',(.075,.11,.06),0,.68); BLACK=mat('Charcoal braid',(.025,.03,.035),0,.69)
HORN=mat('Polished buffalo horn',(.075,.042,.025),.02,.23)
def mesh(name,verts,faces,materials,indices=None):
    me=bpy.data.meshes.new(name); me.from_pydata([p(v) for v in verts],[],faces); me.update()
    bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free();me.update()
    ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob)
    for m in materials: me.materials.append(m)
    if indices:
        for poly,mi in zip(me.polygons,indices): poly.material_index=mi
    PARTS.append(ob); return ob
def tube(name,points,radius,material,sides=10,ellipse=1):
    # Ribbon/cord following a real 3D path; its cross section follows tangent.
    verts=[]
    for i,co in enumerate(points):
        tangent=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
        if tangent.length<1e-8: tangent=Vector((0,1,0))
        tangent.normalize(); normal=tangent.cross(Vector((1,0,0)))
        if normal.length<.01: normal=tangent.cross(Vector((0,0,1)))
        normal.normalize(); bi=tangent.cross(normal).normalized()
        rad=radius[i] if isinstance(radius,list) else radius
        for k in range(sides):
            a=k*math.tau/sides; v=Vector(co)+rad*(math.cos(a)*normal+math.sin(a)*ellipse*bi); verts.append(v)
    faces=[]
    for i in range(len(points)-1):
        for k in range(sides): faces.append((i*sides+k,i*sides+(k+1)%sides,(i+1)*sides+(k+1)%sides,(i+1)*sides+k))
    faces.extend([tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+k for k in range(sides))]); ob=mesh(name,verts,faces,[material])
    for f in ob.data.polygons: f.use_smooth=True
    return ob
def shaft(name,y0,y1,r,material,segments=16,taper=1): return tube(name,[(0,y0,0),(0,y1,0)],[r,r*taper],material,segments)
def lathe(name,y,profile,material,sides=32):
    vs=[]
    for yy,rx,rz in profile:
        vs.extend([(math.cos(k*math.tau/sides)*rx,y+yy,math.sin(k*math.tau/sides)*rz) for k in range(sides)])
    fs=[]
    for j in range(len(profile)-1):
        for k in range(sides): fs.append((j*sides+k,j*sides+(k+1)%sides,(j+1)*sides+(k+1)%sides,(j+1)*sides+k))
    fs += [tuple(range(sides-1,-1,-1)),tuple((len(profile)-1)*sides+k for k in range(sides))]
    ob=mesh(name,vs,fs,[material]);
    for f in ob.data.polygons: f.use_smooth=True
    return ob
def collar(name,y,r=.022,length=.012,material=GOLD,rz=None):
    rz=rz or r; return lathe(name,y,[(-length/2,r*.94,rz*.94),(-length*.35,r,rz),(length*.35,r,rz),(length/2,r*.94,rz*.94)],material)
def wrap(name,y0,y1,r=.017,rz=.022,material=BLACK,turns=4.5):
    # Interwoven flat strips reveal diamond-shaped rayskin windows.
    for sign in [-1,1]:
        vs=[]; n=int(turns*32)
        for i in range(n+1):
            t=i/n; a=t*turns*math.tau*sign; y=y0+t*(y1-y0)
            for off in [-.0034,.0034]: vs.append((r*math.cos(a),y+off,rz*math.sin(a)))
        mesh(name+str(sign),vs,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(n)],[material])
def blade(name,sections,double=False):
    # sections = (y, centreZ, widthZ, thicknessX); four distinct bevels.
    verts=[]
    for y,z,w,t in sections:
        if double: ring=[(0,z-w/2),(t*.48,z-w*.16),(t*.5,z),(t*.48,z+w*.16),(0,z+w/2),(-t*.48,z+w*.16),(-t*.5,z),(-t*.48,z-w*.16)]
        else: ring=[(0,z-w/2),(t*.5,z-w*.22),(t*.5,z+w*.36),(t*.32,z+w/2),(-t*.32,z+w/2),(-t*.5,z+w*.36),(-t*.5,z-w*.22)]
        verts.extend([(x,y,zz) for x,zz in ring])
    n=len(ring); faces=[]; inds=[]
    for i in range(len(sections)-1):
        for k in range(n): faces.append((i*n+k,i*n+(k+1)%n,(i+1)*n+(k+1)%n,(i+1)*n+k)); inds.append(1 if k in ([0,3,4,7] if double else [0,6]) else 0)
    faces.extend([tuple(range(n-1,-1,-1)),tuple((len(sections)-1)*n+k for k in range(n))]); inds.extend([2,1])
    return mesh(name,verts,faces,[STEEL,EDGE,RIDGE],inds)
def flatguard(name,y,r=.05,rz=.055,shape=0,material=GOLD):
    sides=48; vs=[]
    for yy in [-.004,.004]:
        for k in range(sides):
            a=k*math.tau/sides; lobes=(1+.09*math.cos(a*4)) if shape else 1; vs.append((math.cos(a)*r*lobes,y+yy,math.sin(a)*rz*lobes))
    fs=[tuple(range(sides-1,-1,-1)),tuple(sides+k for k in range(sides))]
    for k in range(sides): fs.append((k,(k+1)%sides,sides+(k+1)%sides,sides+k))
    ob=mesh(name,vs,fs,[material]); bev=ob.modifiers.new('Rounded forged guard edge','BEVEL'); bev.width=.002; bev.segments=2; return ob
def torus(name,centre,major,minor,material,plane='xz',scale=(1,1)):
    vs=[]; fs=[]; aN=40;bN=8
    for a in range(aN):
        aa=a*math.tau/aN
        for b in range(bN):
            bb=b*math.tau/bN; r=major+minor*math.cos(bb); xx=r*math.cos(aa)*scale[0]; zz=r*math.sin(aa)*scale[1]; yy=minor*math.sin(bb)
            v=(xx,yy,zz) if plane=='xz' else (yy,xx,zz)
            vs.append(tuple(v[k]+centre[k] for k in range(3)))
    for a in range(aN):
        for b in range(bN): fs.append((a*bN+b,a*bN+(b+1)%bN,((a+1)%aN)*bN+(b+1)%bN,((a+1)%aN)*bN+b))
    return mesh(name,vs,fs,[material])
def studs(y,count=8,r=.042,material=GOLDBRIGHT):
    for k in range(count):
        a=k*math.tau/count; x=r*math.cos(a);z=r*math.sin(a)
        tube('Peened guard rivet',[(x,y-.006,z),(x,y+.006,z)],.0025,material,8)
def ornament(y,length=.08,z=0):
    # Engraved curling brass inlay on both blade faces, all original linework.
    for x in [-.0046,.0046]:
        for sign in [-1,1]:
            pts=[]
            for k in range(24):
                t=k/23; pts.append((x,y+t*length,z+sign*.009*math.sin(t*math.pi*2)*math.sin(t*math.pi)))
            tube('Hand engraved vine inlay',pts,.0008,GOLD,5)
def tassel(y,z=0,material=RED,n=15,length=.16,spread=.045):
    for k in range(n):
        a=k*2.399963; r=spread*(.3+.7*((k*7%19)/19)); dx=math.cos(a)*r; dz=math.sin(a)*r
        pts=[(0,y,z),(.25*dx,y-length*.35,z+.25*dz),(dx,y-length*.82,z+dz),(dx*1.13,y-length,z+dz*1.13)]
        tube('Tied silk horsehair strand',pts,[.0028,.0024,.0016,.00035],material,6)
    collar('Tassel braid knot',y,.017,.022,CORD)

SWORDS={
 'joseon_hwando':dict(length=.76,curve=.057,width=.036,grip=.18,guard='oval',wrap=BLACK),
 'joseon_ungeom':dict(length=.86,curve=0,width=.043,grip=.21,guard='royal',wrap=RED,double=True),
 'japan_katana':dict(length=.83,curve=.068,width=.033,grip=.25,guard='tsuba',wrap=BLACK),
 'japan_tachi':dict(length=.94,curve=.102,width=.031,grip=.27,guard='tachi',wrap=GREEN),
 'ming_dao':dict(length=.80,curve=.072,width=.047,grip=.20,guard='disc',wrap=BLUE),
 'ming_jian':dict(length=.87,curve=0,width=.040,grip=.20,guard='jian',wrap=BLACK,double=True),
}
def sword(id):
    d=SWORDS[id]; L=d['length'];g=d['grip']; y0=-g*.48;guard=g*.52;W=d['width'];C=d['curve']; double=d.get('double',False)
    lathe('Shaped hardwood tang grip',y0,[(0,.011,.016),(.018,.014,.019),(g*.48,.015,.021),(g-.018,.013,.018),(g,.012,.017)],IVORY)
    wrap('Braided silk grip',y0+.013,guard-.011,.0158,.0218,d['wrap'],4.8 if g<.23 else 6.3)
    collar('Pommel ferrule',y0+.004,.017,.018,GOLD,rz=.023); collar('Blade habaki',guard+.013,.015,.024,GOLD,rz=W*.53)
    if d['guard']=='royal':
        flatguard('Four lobed royal guard',guard,.047,.063,1,GOLD); studs(guard,8,.041); ornament(guard+.05,.17)
        torus('Royal ring pommel',(0,y0-.017,0),.018,.0035,GOLD,'yz',(1,1)); tassel(y0-.03,material=RED,n=9,length=.17,spread=.018)
    elif d['guard']=='jian':
        # Gently downturned batwing guard, cast as a real solid contour.
        for sign in [-1,1]:
            pts=[(0,guard,0),(0,guard-.005,sign*.029),(0,guard-.026,sign*.051)]
            tube('Downturned jian quillon',pts,[.012,.011,.006],GOLD,10)
        torus('Pierced jian ring pommel',(0,y0-.022,0),.021,.004,GOLD,'yz',(1,.8)); ornament(guard+.08,.14); tassel(y0-.044,material=BLUE,n=10,length=.15,spread=.017)
    else:
        gm=IRON if d['guard']=='tsuba' else GOLD
        flatguard('Pierced style oval guard' if d['guard']=='oval' else 'Forged disk guard',guard,.041 if d['guard']=='disc' else .045,.054 if d['guard']!='tachi' else .061,d['guard']=='tachi',gm)
        if d['guard']=='tachi': studs(guard,8,.041); ornament(guard+.05,.12)
        if d['guard']=='oval': studs(guard,6,.036)
        if d['guard']=='disc': torus('Dao ring pommel',(0,y0-.018,0),.019,.004,GOLD,'yz',(1,.83)); tassel(y0-.033,material=RED,n=8,length=.13,spread=.018)
    sections=[]
    for i in range(18):
        t=i/17; y=guard+.025+t*L; z=C*t*t
        if double: w=W*(1-.57*t) if t<.9 else W*.47*(1-t)/.1
        elif id=='ming_dao': w=W*(1+.32*math.sin(t*math.pi*.8))*(min(1,(1-t)/.09))
        else: w=W*(1-.24*t)*(min(1,(1-t)/.075))
        sections.append((y,z,max(.0006,w),.007*(1-.63*t)))
    blade('Tempered blade with cutting bevel',sections,double)
    if not double:
        for sign in [-1,1]:
            pts=[]
            for i in range(22):
                t=.08+i/21*.73; pts.append((sign*.0036*(1-.63*t),guard+.025+t*L,C*t*t+W*.12))
            tube('Recessed longitudinal fuller',pts,.0008,FULLER,5)
    return dict(kind='sword',hand='right',length=L+g,notes='Curved single edge, separate polished bevels, wrapped rayskin grip' if not double else 'Straight double edge with ridge, cast guard and brass inlay')

SPEARS={
 'joseon_jangchang':dict(bottom=-1.0,neck=1.0,head=.38,style='leaf',wood=WOOD),
 'joseon_dangpa':dict(bottom=-.90,neck=.93,head=.34,style='fork',wood=WOOD),
 'japan_yari':dict(bottom=-.99,neck=1.01,head=.38,style='yari',wood=EBONY),
 'japan_jumonjiyari':dict(bottom=-.92,neck=.98,head=.39,style='cross',wood=EBONY),
 'ming_qiang':dict(bottom=-1.04,neck=1.04,head=.35,style='leaf',wood=BAMBOO),
 'ming_guandao':dict(bottom=-.94,neck=.91,head=.55,style='glaive',wood=WOOD),
}
def spear(id):
    d=SPEARS[id]; a=d['bottom'];b=d['neck'];h=d['head'];style=d['style']
    lathe('Tapered hardwood pole',0,[(a,.014,.014),(-.7,.016,.016),(0,.0175,.0175),(.55,.016,.016),(b,.012,.012)],d['wood'],16)
    # Four subtle wood grain seams are geometry and remain visible in glTF.
    for k in range(4):
        angle=k*math.pi/2+.3
        pts=[((.016+math.sin(t*6+k)*.0004)*math.cos(angle),a+.1+t*(b-a-.2),(.016+math.sin(t*6+k)*.0004)*math.sin(angle)) for t in [i/15 for i in range(16)]]
        tube('Oiled longitudinal grain',pts,.00045,EBONY,4)
    lathe('Forged socket',0,[(b-.17,.016,.016),(b-.15,.019,.019),(b-.025,.017,.017),(b+.012,.014,.014)],IRON)
    collar('Socket lip',b-.15,.021,.012,GOLD); collar('Socket base ring',b-.03,.019,.012,GOLD)
    lathe('Iron butt spike',0,[(a-.105,.001,.001),(a-.025,.016,.016),(a+.035,.017,.017)],IRON)
    collar('Butt ring',a+.018,.018,.012,GOLD)
    # Main handgrip bindings have physical helical ridges, no texture dependence.
    for y in [-.19,.19]:
        collar('Handgrip binding stop',y,.019,.012,GOLD)
    wrap('Crisscross pole hand binding',-.18,.18,.018,.018,CORD,8.5)
    if style=='glaive':
        sec=[(b,0,.043,.01),(b+.12,.011,.095,.012),(b+.29,.051,.135,.012),(b+.43,.093,.112,.009),(b+h,.153,.001,.003)]
        blade('Swept guandao crescent blade',sec); ornament(b+.13,.20,.038)
        # Small hooked rear tooth and a pierced ring near the blade's base.
        blade('Guandao rear hook',[(b+.09,.065,.025,.009),(b+.145,.105,.022,.007),(b+.20,.105,.001,.002)],True)
        torus('Guandao blade ring',(0,b+.065,-.055),.025,.004,GOLD,'yz')
    else:
        maxw=.058 if style=='leaf' else .042
        sections=[(b,0,.017,.012),(b+.07,0,maxw*.82,.014),(b+h*.42,0,maxw,.012),(b+h*.78,0,maxw*.50,.008),(b+h,0,.0005,.002)]
        blade('Leaf shaped ridged spear head' if style=='leaf' else 'Triangular yari head',sections,True)
        if style in ['fork','cross']:
            for sign in [-1,1]:
                # Side tines curve outward then upward, with genuine cutting bevels.
                base=b+.025; span=.145 if style=='cross' else .12; tip=base+(.17 if style=='cross' else .27)
                pts=[(base,sign*.015,.026,.009),(base+.008,sign*span*.60,.035,.009),(base+.055,sign*span,.040,.008),(tip-.04,sign*(span+.014),.023,.006),(tip,sign*(span+.009),.001,.002)]
                blade('Jumonji crescent cross blade' if style=='cross' else 'Dangpa side prong',pts,True)
    if id.startswith('ming_'): tassel(b-.16,material=RED,n=22,length=.20,spread=.058)
    elif id=='joseon_dangpa': tassel(b-.16,material=RED,n=13,length=.14,spread=.037)
    elif id=='japan_yari': wrap('Upper rattan reinforcement',b-.34,b-.18,.017,.017,CORD,5)
    elif id=='japan_jumonjiyari': wrap('Upper red reinforcement',b-.34,b-.18,.017,.017,RED,5)
    return dict(kind='spear',hand='right',length=b+h-a+.105,notes='Solid tapered hardwood pole, ridged bevel head, separate socket, hand binding, butt spike; '+style)

BOWS={
 'joseon_gakgung':dict(lower=.57,upper=.57,curve=.09,tip=-.14,width=.034,wood=HORN,style='korean'),
 'joseon_janggunbow':dict(lower=.73,upper=.73,curve=.125,tip=-.19,width=.042,wood=RED,style='korean'),
 'japan_yumi':dict(lower=.64,upper=1.28,curve=.115,tip=-.13,width=.030,wood=BAMBOO,style='japanese'),
 'japan_shigeto':dict(lower=.60,upper=1.20,curve=.10,tip=-.15,width=.032,wood=EBONY,style='japanese'),
 'ming_gong':dict(lower=.72,upper=.72,curve=.14,tip=-.20,width=.040,wood=RED,style='chinese'),
 'ming_shaogong':dict(lower=.51,upper=.51,curve=.105,tip=-.16,width=.036,wood=HORN,style='chinese'),
}
def interpolate(a,b,t): return tuple(a[i]+(b[i]-a[i])*t for i in range(len(a)))
def catmull(points,segment,t):
    a=points[max(0,segment-1)];b=points[segment];c=points[segment+1];d=points[min(len(points)-1,segment+2)]
    return tuple(.5*((2*b[k])+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t*t+(-a[k]+3*b[k]-3*c[k]+d[k])*t*t*t) for k in range(2))
def bowlimb(name,points,halfwidth,material,layerOffset=0,thick=.010):
    # Rectangular laminated stave with tapered thickness, softened perimeter.
    vs=[]; N=len(points)
    for i,(y,z) in enumerate(points):
        t=i/(N-1); w=halfwidth*(1-.67*t); th=thick*(1-.45*t)
        for x,zz in [(-w,-th/2),(w,-th/2),(w,th/2),(-w,th/2)]: vs.append((x,y,z+zz+layerOffset))
    fs=[]
    for i in range(N-1):
        for k in range(4): fs.append((i*4+k,i*4+(k+1)%4,(i+1)*4+(k+1)%4,(i+1)*4+k))
    fs += [(3,2,1,0),tuple((N-1)*4+k for k in range(4))]
    ob=mesh(name,vs,fs,[material]);be=ob.modifiers.new('Rounded stave edges','BEVEL');be.width=.0015;be.segments=2
    for f in ob.data.polygons: f.use_smooth=True
    return ob
def bow(id):
    d=BOWS[id]; lower=d['lower']; upper=d['upper']; style=d['style']; tip=d['tip']; w=d['width']/2
    # Individual limb profiles are asymmetric for Japanese longbows.
    for sign,L in [(-1,lower),(1,upper)]:
        if style=='japanese': knots=[(.075,0),(.20,.026),(.43,d['curve']),(.70,d['curve']*.6),(.91,tip*.55),(1,tip)]
        elif style=='chinese': knots=[(.075,0),(.22,d['curve']*.7),(.48,d['curve']),(.66,d['curve']*.75),(.84,tip*.45),(.96,tip),(1,tip+.037)]
        else: knots=[(.075,0),(.21,d['curve']*.7),(.43,d['curve']),(.64,d['curve']*.68),(.83,tip*.50),(.96,tip),(1,tip+.028)]
        pts=[]
        for j in range(len(knots)-1):
            for k in range(5):
                t=k/5; yy,zz=catmull(knots,j,t); pts.append((sign*yy*L,zz))
        pts.append((sign*L,knots[-1][1]))
        bowlimb('Horn composite stave' if style!='japanese' else 'Bamboo laminated asymmetric limb',pts,w,d['wood'])
        bowlimb('Bone belly lamination',pts,w*.91,IVORY,-.006,.0022)
        bowlimb('Dark horn back lamination',pts,w*.94,HORN,.006,.0025)
        # Siyah reinforcement and distinct rattan/fabric binding along curved limb.
        for frac in ([.25,.5,.72,.85,.94] if style=='japanese' else [.20,.49,.72,.9]):
            ix=min(len(pts)-2,int(frac*(len(pts)-1))); yy,zz=pts[ix]
            rr=w*(1-.67*frac)+.002
            # ring is oblong and follows stave cross section at this point.
            for shift in [-.005,0,.005]:
                lathe('Rattan limb binding',yy+shift,[(-.0018,rr,.009),(.0018,rr,.009)],CORD if id!='japan_shigeto' else RED,16).location=p((0,0,zz))
        # Raised horn nock tips.
        ytip=sign*L; ztip=knots[-1][1]
        tube('Horn string nock',[(0,ytip-sign*.018,ztip+.002),(0,ytip,ztip),(0,ytip+sign*.011,ztip+.002)],[.009,.008,.005],HORN,10)
        collar('Bone nock binding',ytip-sign*.016,.010,.015,IVORY,rz=.008).location=p((0,0,ztip))
    lathe('Shaped bow handgrip',0,[(-.084,.016,.019),(-.055,.018,.021),(.055,.018,.021),(.084,.016,.019)],EBONY)
    wrap('Central wrapped leather grip',-.073,.073,.019,.022,BLUE if id.startswith('joseon') else BLACK,4)
    for yy in [-.077,.077]: collar('Grip end binding',yy,.019,.008,GOLD,rz=.022)
    upperz=tip+(.028 if style=='korean' else .037 if style=='chinese' else 0)
    # A taut, continuous resting string lies behind the grip; separate serving.
    tube('Twisted bowstring',[(0,-lower,upperz),(0,upper,upperz)],.0013,CORD,8)
    tube('Central string serving',[(0,-.055,upperz),(0,.055,upperz)],.0019,BLACK,8)
    for yy in [-.011,.011]: tube('Nocking point serving',[(0,yy-.002,upperz),(0,yy+.002,upperz)],.0025,RED,8)
    return dict(kind='bow',hand='left',length=lower+upper,notes='Laminated '+style+' bow, shaped recurve, horn nocks, central handgrip, taut separate string',nock=[0,0,upperz])

def setup_render():
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
    scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
    scene.world.color=(.12,.12,.12); scene.world.use_nodes=True; bg=scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.028,.041,.054,1);bg.inputs[1].default_value=.5
    scene.view_settings.view_transform='AgX'
    for name,loc,power,size in [('Key',(3,1,4),450,4),('Rim',(-2,-3,2),600,3),('Fill',(-2,3,0),280,4)]:
        ld=bpy.data.lights.new(name,'AREA');ob=bpy.data.objects.new(name,ld);bpy.context.collection.objects.link(ob);ob.location=loc;ld.energy=power;ld.shape='DISK';ld.size=size;ob.rotation_euler=(Vector((0,0,1))-ob.location).to_track_quat('-Z','Y').to_euler()
    ca=bpy.data.cameras.new('Weapon presentation');ob=bpy.data.objects.new('Weapon presentation',ca);bpy.context.collection.objects.link(ob);scene.camera=ob;ca.type='ORTHO';ca.lens=65
    return ob
def render(ob,camera,id,out,view='beauty'):
    bpy.context.view_layer.update();bb=[ob.matrix_world@Vector(c) for c in ob.bound_box];lo=Vector(tuple(min(v[k] for v in bb) for k in range(3)));hi=Vector(tuple(max(v[k] for v in bb) for k in range(3)));mid=(lo+hi)/2;size=hi-lo
    # Blade widths and bow recurve are in the logical YZ plane: camera mostly X.
    direction=Vector((1,-.70,.16)) if view=='beauty' else Vector((1,0,0)) if view=='front' else Vector((0,-1,0))
    camera.location=mid+direction.normalized()*4;camera.rotation_euler=(mid-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=max(size.z,size.y,size.x)*1.16
    bpy.context.scene.render.filepath=str(out);bpy.ops.render.render(write_still=True)
def export(ob,id,meta,path,lod=False):
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
    if lod:
        # Geometry retains every authored part; decimate only if necessary.
        tri=sum(len(f.vertices)-2 for f in ob.data.polygons)
        if tri>7700:
            mod=ob.modifiers.new('LOD surface simplification','DECIMATE');mod.ratio=7700/tri;bpy.ops.object.modifier_apply(modifier=mod.name)
    root=bpy.data.objects.new('weapon_'+id,None);bpy.context.collection.objects.link(root);root['weaponId']=id;root['kind']=meta['kind'];root['faction']=id.split('_')[0];root['gripHand']=meta['hand'];root['gripPosition']='0,0,0';root['units']='meters';root['forwardAxis']='+Z';root['longAxis']='+Y';root['source']='Original authored geometry; scripts/build-general-weapons.py';ob.parent=root;root.select_set(True)
    sockets=[]
    for name,pos in [('socket_grip',[0,0,0])]+([('socket_nock',meta['nock'])] if 'nock' in meta else []):
        so=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(so);so.parent=root;so.location=p(pos);so.select_set(True);sockets.append(so)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False,export_materials='EXPORT',export_apply=True)
    ob.parent=None
    for so in sockets: bpy.data.objects.remove(so,do_unlink=True)
    bpy.data.objects.remove(root,do_unlink=True)

def main():
    global PARTS
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);camera=setup_render();receipt=[]
    ids=list(SWORDS)+list(SPEARS)+list(BOWS)
    if args.only: ids=[i for i in ids if i in args.only.split(',')]
    for id in ids:
        PARTS=[];meta=sword(id) if id in SWORDS else spear(id) if id in SPEARS else bow(id)
        # Apply tiny formed-edge bevels before consolidating mesh and exporting.
        for ob in PARTS:
            bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
            for mod in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=mod.name)
            bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        bpy.ops.object.select_all(action='DESELECT')
        for ob in PARTS:ob.select_set(True)
        bpy.context.view_layer.objects.active=PARTS[0];bpy.ops.object.join();ob=bpy.context.object;ob.name='Authored_'+id
        bpy.context.view_layer.update(); vs=[ob.matrix_world@v.co for v in ob.data.vertices];bounds=[[min(v[k] for v in vs),max(v[k] for v in vs)] for k in range(3)]
        meta.update(id=id,faction=id.split('_')[0],grip=[0,0,0],up='+Y',forward='+Z',triangles=sum(len(f.vertices)-2 for f in ob.data.polygons),author='OpenAI Codex - original procedural mesh authored for imjin',license='Project-owned original geometry; no third-party meshes or textures',blenderVersion=bpy.app.version_string)
        meta['dimensionsMeters']=[bounds[0][1]-bounds[0][0],bounds[2][1]-bounds[2][0],bounds[1][1]-bounds[1][0]]
        export(ob,id,meta,OUT/f'weapon_{id}.glb')
        # Save editable source before LOD simplification and keep every source object.
        bpy.ops.wm.save_as_mainfile(filepath=str(WORK/f'{id}.blend'))
        if not args.no_render:
            render(ob,camera,id,WORK/f'{id}.png')
            if id in ['joseon_ungeom','japan_jumonjiyari','joseon_gakgung','ming_guandao','japan_yumi']:
                for view in ['front','side']:render(ob,camera,id,WORK/f'{id}_{view}.png',view)
        # Duplicate mesh data so canonical source remains untouched.
        low=ob.copy();low.data=ob.data.copy();bpy.context.collection.objects.link(low);export(low,id,meta,OUT/f'weapon_{id}_lod1.glb',True);meta['lodTriangles']=sum(len(f.vertices)-2 for f in low.data.polygons);bpy.data.objects.remove(low,do_unlink=True)
        for path in [OUT/f'weapon_{id}.glb',OUT/f'weapon_{id}_lod1.glb',WORK/f'{id}.blend']:
            meta.setdefault('files',[]).append(dict(path=str(path),bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        (SRC/f'{id}.json').write_text(json.dumps(meta,indent=2)+'\n',encoding='utf8');receipt.append(meta)
        bpy.data.objects.remove(ob,do_unlink=True);print('WEAPON_DONE '+id+' '+str(meta['triangles'])+' tris',flush=True)
    manifest=dict(created='2026-10-17',originalScript='scripts/build-general-weapons.py',scriptSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),sourceWorkspace=str(WORK),coordinateContract='glTF meters, +Y length/upright, +Z bow/front curvature, origin middle of handgrip; swords/spears RIGHT, bows LEFT',historicalAccuracy='Original game interpretations of named East Asian weapon families; not museum scans or exact artifact reproductions',provider='None; no paid generation; no external source copied',weapons=receipt)
    (SRC/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
if __name__=='__main__': main()
