# Blender step of scripts/generals-cast.mjs: a raw generated figure made ready for Meshy auto-rigging. Tripo models face
# +X; the rig wants the glTF front (+Z, Blender -Y), so a figure whose arms run front-to-back is turned a quarter round.
# It is cut to a triangle budget, its textures held to 2k (the upload must stay small), and its feet put on the ground at the origin.
#   blender -b --python scripts/lib/cast-prep.py -- <raw.glb> <out.glb> <triangles>
import bpy, sys, math, mathutils
src, out, budget = sys.argv[sys.argv.index('--') + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
lo = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
hi = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
turn = (hi.y - lo.y) > (hi.x - lo.x) * 1.3
for o in meshes:
    m = mathutils.Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    if turn:
        m = mathutils.Matrix.Rotation(-math.pi / 2, 4, 'Z') @ m
    o.data.transform(m)
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    d = o.modifiers.new('cut', 'DECIMATE')
    d.ratio = min(1.0, int(budget) / max(1, tris))
    d.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='cut')
    print('TRIS', tris, '->', sum(len(p.vertices) - 2 for p in o.data.polygons), 'TURNED', turn)
for o in [o for o in bpy.context.scene.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o)
for img in bpy.data.images:
    if img.size[0] > 2048:
        img.scale(2048, 2048)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=92)
