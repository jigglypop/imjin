import bpy
import sys

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, ratio = argv[0], argv[1], float(argv[2])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

for obj in list(bpy.context.scene.objects):
    if obj.type != 'MESH':
        continue
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0004)
    bpy.ops.object.mode_set(mode='OBJECT')
    before = len(obj.data.polygons)
    mod = obj.modifiers.new('decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='decimate')
    print('DECIMATE', obj.name, before, '->', len(obj.data.polygons))

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_apply=True)
