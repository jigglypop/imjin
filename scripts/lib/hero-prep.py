# Blender step of scripts/generals-hero.mjs: a raw Meshy model cut down to a triangle budget Meshy can rig, its
# textures halved to 4k so the upload fits, written as GLB.
#   blender -b --python scripts/lib/hero-prep.py -- <raw.glb> <out.glb> <triangles>
import bpy, sys
src, out, budget = sys.argv[sys.argv.index('--') + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    m = o.modifiers.new('cut', 'DECIMATE')
    m.ratio = min(1.0, int(budget) / tris)
    m.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='cut')
    print('TRIS', tris, '->', sum(len(p.vertices) - 2 for p in o.data.polygons))
for img in bpy.data.images:
    if img.size[0] > 4096:
        img.scale(4096, 4096)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=92)
