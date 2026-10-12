"""Normalise one Meshy settlement model and write its two LODs. Local only; never contacts a provider.

blender -b --python world-export.py -- <source.glb> <out dir> <id> <yaw degrees> <ground band>

The result sits on the ground plane (glTF y = 0) with the footprint centred on the origin, the
gate or pier facing glTF +Z, the footprint inside a unit circle and the height at most 1.2.
"""
import bpy, bmesh, json, math, pathlib, sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
source, out_dir, asset_id = pathlib.Path(argv[0]), pathlib.Path(argv[1]), argv[2]
yaw, band = float(argv[3]), float(argv[4])
TARGETS = [8000, 2500]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for obj in meshes:
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj.parent = None
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
model = bpy.context.view_layer.objects.active
for obj in list(bpy.context.scene.objects):
    if obj != model:
        bpy.data.objects.remove(obj, do_unlink=True)
model.name = f'{asset_id}'

# Blender is Z up and its -Y becomes glTF +Z, so the front that Meshy put toward the camera stays in front.
model.data.transform(Matrix.Rotation(math.radians(yaw), 4, 'Z'))

bm = bmesh.new()
bm.from_mesh(model.data)
welded_before = len(bm.verts)
# glTF splits vertices along UV seams; weld them so decimation and the loose-part test see one surface.
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0001)
bm.faces.ensure_lookup_table()
# Loose fragments Meshy leaves floating around a building read as specks: drop the tiny islands.
seen, islands = set(), []
for face in bm.faces:
    if face.index in seen:
        continue
    stack, island = [face], []
    seen.add(face.index)
    while stack:
        f = stack.pop()
        island.append(f)
        for edge in f.edges:
            for g in edge.link_faces:
                if g.index not in seen:
                    seen.add(g.index)
                    stack.append(g)
    islands.append(island)
total = len(bm.faces)
islands.sort(key=len, reverse=True)
debris = [f for island in islands[1:] if len(island) < max(24, total * 0.002) for f in island]
bmesh.ops.delete(bm, geom=debris, context='FACES')
loose = [v for v in bm.verts if not v.link_faces]
bmesh.ops.delete(bm, geom=loose, context='VERTS')

# Flatten the underside so the model sits on terrain without rocking or a gap.
zs = [v.co.z for v in bm.verts]
low, high = min(zs), max(zs)
cut = low + band * (high - low)
flattened = 0
for v in bm.verts:
    if v.co.z < cut:
        v.co.z = low
        flattened += 1

xs = [v.co.x for v in bm.verts]
ys = [v.co.y for v in bm.verts]
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
radius = max(math.hypot(v.co.x - cx, v.co.y - cy) for v in bm.verts)
height = high - low
scale = min(0.995 / radius, 1.195 / height)
for v in bm.verts:
    v.co = Vector(((v.co.x - cx) * scale, (v.co.y - cy) * scale, (v.co.z - low) * scale))
bm.to_mesh(model.data)
bm.free()
model.data.update()

# Base colour only: the normal and roughness maps would triple the texture memory for little at map distance.
for mat in model.data.materials:
    if not mat or not mat.use_nodes:
        continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        continue
    for name in ('Normal', 'Metallic', 'Roughness'):
        for link in list(bsdf.inputs[name].links):
            mat.node_tree.links.remove(link)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.88
    for node in list(mat.node_tree.nodes):
        if node.type in ('NORMAL_MAP', 'SEPARATE_COLOR', 'SEPARATE_RGB') or (node.type == 'TEX_IMAGE' and not node.outputs['Color'].links and not node.outputs['Alpha'].links):
            mat.node_tree.nodes.remove(node)
    for node in list(mat.node_tree.nodes):
        if node.type == 'TEX_IMAGE' and not any(l.to_node == bsdf for l in node.outputs['Color'].links):
            mat.node_tree.nodes.remove(node)

out_dir.mkdir(parents=True, exist_ok=True)
outputs = []
for level, target in enumerate(TARGETS):
    obj = model.copy()
    obj.data = model.data.copy()
    bpy.context.collection.objects.link(obj)
    obj.name = f'{asset_id}_lod{level}'
    original = sum(len(f.vertices) - 2 for f in obj.data.polygons)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if original > target:
        mod = obj.modifiers.new('lod', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = target / original * 0.985
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = obj.modifiers.new('tri', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=mod.name)
    triangles = len(obj.data.polygons)
    path = out_dir / f'{asset_id}_lod{level}.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_materials='EXPORT', export_normals=True)
    outputs.append({'level': level, 'target': target, 'trianglesBefore': original, 'triangles': triangles, 'path': str(path)})
    bpy.data.objects.remove(obj, do_unlink=True)

report = {'id': asset_id, 'yawDegrees': yaw, 'groundBand': band, 'verticesBeforeWeld': welded_before,
          'islands': len(islands), 'debrisFacesRemoved': len(debris), 'flattenedVertices': flattened,
          'sourceRadius': radius, 'sourceHeight': height, 'unitScale': scale,
          'radius': radius * scale, 'height': height * scale, 'outputs': outputs}
(out_dir / f'{asset_id}.export.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('WORLD_EXPORT=' + json.dumps(report))
