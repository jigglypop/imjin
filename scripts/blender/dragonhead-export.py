"""Local progressive export of the human-approved Meshy Form. Never contacts a provider."""
import bpy, bmesh, hashlib, json, pathlib
from mathutils import Matrix, Vector

root = pathlib.Path(__file__).resolve().parents[2]
package = root / 'assets-src/dragonhead-2026-10-11'
review = json.loads((package/'milestone-reviews.json').read_text(encoding='utf-8'))
props = json.loads((package/'props.json').read_text(encoding='utf-8'))
form = review.get('form', {})
if form.get('status') != 'approved' or form.get('approvedBy') != 'user':
    raise RuntimeError('Explicit human Form approval is required before export')
recipe_file = package/'form-fit-recipe.json'
if hashlib.sha256(recipe_file.read_bytes()).hexdigest() != form['fitRecipeSha256']:
    raise RuntimeError('The approved fitting recipe changed')
recipe = json.loads(recipe_file.read_text(encoding='utf-8'))
accepted = props['assets'][0]['acceptedMesh']
if hashlib.sha256((package/accepted['path']).read_bytes()).hexdigest() != accepted['sha256']:
    raise RuntimeError('Accepted source mesh changed')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(package/accepted['path']))
head = next(obj for obj in bpy.context.scene.objects if obj.type == 'MESH')
head.data.transform(head.matrix_world); head.matrix_world = Matrix.Identity(4)
head.data.transform(Matrix.Rotation(recipe['rearToBowRotationRadians'], 4, 'Z'))
vertices = [v.co.copy() for v in head.data.vertices]
mins = Vector(tuple(min(v[i] for v in vertices) for i in range(3)))
maxs = Vector(tuple(max(v[i] for v in vertices) for i in range(3)))
center = (mins+maxs)*.5; scale = Vector(recipe['scaleBlenderXYZ'])
fit = Matrix.Translation(Vector((recipe['rearMountX']-mins.x*scale.x,
                                -center.y*scale.y,recipe['heightCenter']-center.z*scale.z))) @ Matrix.Diagonal((*scale,1.0))
head.data.transform(fit); head.data.update()
head.name = 'Meshy71_Dragonhead'
head.hide_render = False
head.select_set(False)
outputs = []
for level, target in enumerate(props['assets'][0]['lodTriangleTargets']):
    obj = head.copy(); obj.data = head.data.copy()
    bpy.context.collection.objects.link(obj)
    obj.name = f'Meshy71_Dragonhead_LOD{level}'
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    # Meshy/glTF splits vertices at UV and normal seams. Collapse shared topology, preserving corner UVs,
    # before decimation; simplifying isolated face vertices would punch holes throughout the lower LODs.
    topology = bmesh.new(); topology.from_mesh(obj.data)
    before_vertices = len(topology.verts)
    bmesh.ops.remove_doubles(topology, verts=list(topology.verts), dist=.0001)
    topology.to_mesh(obj.data); topology.free(); obj.data.update()
    original = sum(len(face.vertices)-2 for face in obj.data.polygons)
    if original > target:
        modifier = obj.modifiers.new('BoundedLOD', 'DECIMATE')
        modifier.ratio = target/original
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    triangles = sum(len(face.vertices)-2 for face in obj.data.polygons)
    # User subsequently requested the representative turtle ship to be 1.2x larger, including its head.
    obj.data.transform(Matrix.Scale(recipe['uniformShipScale'], 4))
    topology = bmesh.new(); topology.from_mesh(obj.data)
    boundary_edges = sum(edge.is_boundary for edge in topology.edges)
    loose_edges = sum(not edge.link_faces for edge in topology.edges)
    topology.free()
    # These coordinates were normalized in Blender before the approved renders, not fitted again at runtime.
    output = package/'meshes'/f'dragonhead-fitted-lod{level}.glb'
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
                             export_apply=True, export_yup=True, export_materials='EXPORT')
    outputs.append({'level':level, 'target':target, 'triangles':triangles,
                    'verticesBeforeWeld':before_vertices, 'verticesAfterLOD':len(obj.data.vertices),
                    'boundaryEdges':boundary_edges, 'looseEdges':loose_edges, 'uniformShipScale':1.2,
                    'path':output.relative_to(package).as_posix(),
                    'sha256':hashlib.sha256(output.read_bytes()).hexdigest()})
    bpy.data.objects.remove(obj, do_unlink=True)
(package/'local-export.json').write_text(json.dumps({'source':accepted,'outputs':outputs},indent=2),encoding='utf-8')
print('LOCAL_DRAGONHEAD_EXPORT='+json.dumps(outputs))
