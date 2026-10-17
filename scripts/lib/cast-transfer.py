# Blender step of scripts/generals-cast.mjs: when Meshy's pose estimation refuses a figure, it is put on a rig that
# worked: a donor figure rigged by Meshy (same joints for every general). The figure is fitted to the donor's bounds
# (height, centre, feet on the ground), its skin weights taken from the donor's nearest surface, and it is exported
# alone on the donor's armature in the bind pose.
#   blender -b --python scripts/lib/cast-transfer.py -- <donor_rig.glb> <figure.glb> <out.glb>
import bpy, sys, mathutils
donor, figure, out = sys.argv[sys.argv.index('--') + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=donor)
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
src = max((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
if arm.animation_data: arm.animation_data.action = None
for b in arm.pose.bones: b.matrix_basis = mathutils.Matrix()
before = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=figure)
new = [o for o in bpy.context.scene.objects if o not in before]
meshes = [o for o in new if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1: bpy.ops.object.join()
tgt = bpy.context.view_layer.objects.active
for o in new:
    if o != tgt and o.name in bpy.data.objects: bpy.data.objects.remove(o)
def box(o):
    ps = [o.matrix_world @ v.co for v in o.data.vertices]
    return mathutils.Vector([min(p[i] for p in ps) for i in range(3)]), mathutils.Vector([max(p[i] for p in ps) for i in range(3)])
dl, dh = box(src); tl, th = box(tgt)
s = (dh.z - dl.z) / (th.z - tl.z)
m = mathutils.Matrix.Translation(((dl.x + dh.x) / 2, (dl.y + dh.y) / 2, dl.z)) @ mathutils.Matrix.Scale(s, 4) @ mathutils.Matrix.Translation((-(tl.x + th.x) / 2, -(tl.y + th.y) / 2, -tl.z))
tgt.data.transform(m)
for g in src.vertex_groups: tgt.vertex_groups.new(name=g.name)
dt = tgt.modifiers.new('w', 'DATA_TRANSFER')
dt.object = src; dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}
dt.vert_mapping = 'POLYINTERP_NEAREST'; dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
bpy.context.view_layer.objects.active = tgt
bpy.ops.object.modifier_apply(modifier='w')
tgt.parent = arm
tgt.matrix_parent_inverse = arm.matrix_world.inverted()
am = tgt.modifiers.new('Armature', 'ARMATURE'); am.object = arm
bpy.data.objects.remove(src)
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
print('FIT scale', s)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=92, export_animations=False)
