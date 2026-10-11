"""Prepare an unexported Form review of an existing Meshy head; no provider requests."""
import bpy, json, math, pathlib, sys
from mathutils import Vector, Matrix

root = pathlib.Path(__file__).resolve().parents[2]
package = root / 'assets-src/dragonhead-2026-10-11'
source = package / 'meshes/dragonhead-attempt-1.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
head = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
head.name = 'Meshy71_Dragonhead_DRAFT'
# glTF import uses Blender Z-up. Measure the flat rear plate along its long Y axis.
head.data.transform(head.matrix_world)
head.matrix_world = Matrix.Identity(4)
vertices = [v.co.copy() for v in head.data.vertices]
low, high = min(v.y for v in vertices), max(v.y for v in vertices)
areas = [0.0, 0.0]
for p in head.data.polygons:
    ys = [vertices[i].y for i in p.vertices]
    if max(ys)-min(ys) < .018 and abs(p.normal.y) > .85:
        mean = sum(ys)/len(ys)
        if mean < low+.08: areas[0] += p.area
        if mean > high-.08: areas[1] += p.area
rear_is_high = areas[1] > areas[0]
rotation = Matrix.Rotation(math.pi/2 if rear_is_high else -math.pi/2, 4, 'Z')
head.data.transform(rotation)
vertices = [v.co.copy() for v in head.data.vertices]
mins = Vector(tuple(min(v[i] for v in vertices) for i in range(3)))
maxs = Vector(tuple(max(v[i] for v in vertices) for i in range(3)))
size = maxs-mins
scale = Vector((5.6/size.x, 1.8/size.y, 2.7/size.z))
center = (mins+maxs)*.5
# rear plate embedded in the original neck seat; centreline and weapon anchors stay unchanged.
fit = Matrix.Translation(Vector((18.4-mins.x*scale.x, -center.y*scale.y, 5.35-center.z*scale.z))) @ Matrix.Diagonal((*scale,1.0))
head.data.transform(fit)
head.data.update()
vertices = [v.co.copy() for v in head.data.vertices]
fitted_min = [min(v[i] for v in vertices) for i in range(3)]
fitted_max = [max(v[i] for v in vertices) for i in range(3)]

# The actual procedural hull, built with the original dragonHead call disabled.
data = json.loads((package/'draft-hull.json').read_text())
positions = data['position']; indices = data['index']
verts = [(positions[i],-positions[i+2],positions[i+1]) for i in range(0,len(positions),3)]
faces = [indices[i:i+3] for i in range(0,len(indices),3)]
mesh = bpy.data.meshes.new('Actual_Geobukseon_Lod1_No_Old_Head')
mesh.from_pydata(verts,[],faces); mesh.update()
body = bpy.data.objects.new(mesh.name,mesh); bpy.context.collection.objects.link(body)
uv = mesh.uv_layers.new(name='AtlasUV')
color = mesh.color_attributes.new(name='TintAO',type='FLOAT_COLOR',domain='POINT')
for i in range(len(verts)):
    color.data[i].color = (*[min(4,max(0,v)) for v in data['color'][i*3:i*3+3]],1)
for loop in mesh.loops:
    i=loop.vertex_index; cell=round(data['mat'][i*2]); u,v=data['uv'][i*2:i*2+2]
    # Blender samples textures bottom-up; the runtime atlas shader addresses the image top-down.
    uv.data[loop.index].uv = ((cell%4+((u%1)*.96875+.015625))/4, 1-(cell//4+((1-v%1)*.96875+.015625))/4)
material = bpy.data.materials.new('Actual_Joseon_Atlas_Preview'); material.use_nodes=True
nodes=material.node_tree.nodes; links=material.node_tree.links; bsdf=nodes.get('Principled BSDF')
image=nodes.new('ShaderNodeTexImage'); image.image=bpy.data.images.load(str(root/'public/textures/ships/joseon_albedo.webp'))
tint=nodes.new('ShaderNodeVertexColor'); tint.layer_name='TintAO'
multiply=nodes.new('ShaderNodeMixRGB'); multiply.blend_type='MULTIPLY'; multiply.inputs[0].default_value=1
links.new(image.outputs['Color'],multiply.inputs[1]); links.new(tint.outputs['Color'],multiply.inputs[2]); links.new(multiply.outputs[0],bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value=.8; mesh.materials.append(material)

scene=bpy.context.scene; scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=1200;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
scene.world=bpy.data.worlds.new('ReviewWorld');scene.world.color=(.18,.18,.18)
scene.view_settings.view_transform='AgX'
world=scene.world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.13,.15,.18,1);world.node_tree.nodes['Background'].inputs[1].default_value=.6
def xyz(point): return Vector((point[0],-point[2],point[1]))
for name,point,power,size_light in [('Key',(25,15,10),1600,10),('Fill',(20,10,-12),1100,9),('Back',(12,12,5),1200,8),('HullFill',(-8,22,12),5200,24)]:
    light=bpy.data.lights.new(name,'AREA');light.energy=power;light.shape='DISK';light.size=size_light
    obj=bpy.data.objects.new(name,light);bpy.context.collection.objects.link(obj);obj.location=xyz(point);obj.rotation_euler=(xyz((21,5,0))-obj.location).to_track_quat('-Z','Y').to_euler()
camera_data=bpy.data.cameras.new('ReviewCamera');camera=bpy.data.objects.new('ReviewCamera',camera_data);bpy.context.collection.objects.link(camera);scene.camera=camera
camera_data.type='ORTHO';camera_data.lens=50
render_dir=package/'renders';render_dir.mkdir(exist_ok=True)
def render(name,eye,target,span,body_visible):
    body.hide_render=not body_visible;camera.location=xyz(eye);camera.rotation_euler=(xyz(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.ortho_scale=span
    scene.render.filepath=str(render_dir/f'{name}.png');bpy.ops.render.render(write_still=True)
for name,eye in [('front',(34,5.35,0)),('right',(21.2,5.35,14)),('back',(8,5.35,0)),('left',(21.2,5.35,-14))]: render(f'head-{name}',eye,(21.2,5.35,0),7.8,False)
render('mounted-bow',(34,11,12),(19.5,5,0),15,True)
render('mounted-side',(15,10,36),(11,4.5,0),28,True)
render('mounted-full',(53,31,40),(0,3,0),58,True)
body.hide_render=False
bpy.ops.wm.save_as_mainfile(filepath=str(package/'dragonhead-form-review.blend'))
report={'schema':'imjin.dragonhead-form-draft.v1','source':'meshes/dragonhead-attempt-1.glb','headObject':head.name,'oldHeadRemoved':True,'sourceRearPlaneArea':areas,'sourceRearBlenderY':'max' if rear_is_high else 'min','fitBoundsShipSpace':{'min':[fitted_min[0],fitted_min[2],-fitted_max[1]],'max':[fitted_max[0],fitted_max[2],-fitted_min[1]]},'scaleBlenderXYZ':list(scale),'anchorsUnchanged':True,'formApproval':'pending','exported':False,'views':['head-front.png','head-right.png','head-back.png','head-left.png','mounted-bow.png','mounted-side.png','mounted-full.png']}
(package/'form-review.json').write_text(json.dumps(report,indent=2))
print('DRAGONHEAD_REVIEW='+json.dumps(report))
