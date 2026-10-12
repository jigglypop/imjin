"""Unwraps and bakes the levels of one Meshy camp (scripts/build-camp-models.mjs runs this). Never contacts a provider.

The build hands over the original already turned and normalised (the bake source, with Meshy's own UVs and texture) and
each level as rebuilt low-poly geometry with its flat normals, which are kept as they are. Each level is unwrapped and
the original's colour is baked onto it (Cycles, selected to active). The bake target starts as a magenta sentinel with
zero alpha, so the build can tell texels no ray reached.
"""
import bpy, json, math, sys
import numpy as np
from mathutils import Matrix

job = json.loads(open(sys.argv[sys.argv.index('--') + 1], encoding='utf-8').read())
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = job['samples']


def import_mesh(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    if len(meshes) != 1:
        raise RuntimeError(f'{path}: expected one mesh, found {len(meshes)}')
    obj = meshes[0]
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    for o in new:
        if o is not obj:
            bpy.data.objects.remove(o, do_unlink=True)
    return obj


def only(obj, *others):
    bpy.ops.object.select_all(action='DESELECT')
    for o in (obj, *others):
        o.select_set(True)
    bpy.context.view_layer.objects.active = obj


high = import_mesh(job['high'])
report = []
for level in job['levels']:
    low = import_mesh(level['mesh'])
    low.name = low.data.name = level['name']
    only(low)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    while low.data.uv_layers:
        low.data.uv_layers.remove(low.data.uv_layers[0])
    low.data.uv_layers.new(name='UVMap')
    bpy.ops.uv.smart_project(angle_limit=math.radians(job['angleLimit']), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=level['margin'], shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')

    size = level['bake']
    image = bpy.data.images.new(level['name'] + '_bake', size, size, alpha=True)
    image.pixels.foreach_set(np.tile(np.array([1.0, 0.0, 1.0, 0.0], dtype=np.float32), size * size))
    mat = bpy.data.materials.new(level['name'])
    if mat.node_tree is None:
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image
    bsdf = nodes.get('Principled BSDF')
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.9
    nodes.active = tex
    low.data.materials.clear()
    low.data.materials.append(mat)

    only(low, high)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_selected_to_active=True, use_clear=False, margin=0,
                        cage_extrusion=level['cageExtrusion'], max_ray_distance=level['maxRayDistance'])
    image.filepath_raw = level['png']
    image.file_format = 'PNG'
    image.save()

    only(low)
    bpy.ops.export_scene.gltf(filepath=level['glb'], export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
                              export_image_format='AUTO', export_animations=False, export_skins=False, export_morph=False)
    report.append({'name': level['name'], 'triangles': sum(len(p.vertices) - 2 for p in low.data.polygons)})
    bpy.data.objects.remove(low, do_unlink=True)

open(job['report'], 'w', encoding='utf-8').write(json.dumps({'blender': bpy.app.version_string, 'levels': report}, indent=2))
print('CAMP_LODS_DONE')
