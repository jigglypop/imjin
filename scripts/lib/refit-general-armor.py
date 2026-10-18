"""Fit an existing armor shell in Blender without regenerating its textures/topology.

Input/output buffers are supplied by scripts/refit-general-parts.mjs. Source GLBs
are read only. All measurements use the body's bind pose, in Blender world space.
"""
import bpy
import json
import sys
from pathlib import Path
import numpy as np
from mathutils import Vector

config_path = Path(sys.argv[sys.argv.index('--') + 1])
cfg = json.loads(config_path.read_text(encoding='utf-8'))
work = config_path.parent
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=cfg['body'], merge_vertices=False)
body = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
before = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=cfg['shell'], merge_vertices=False)
armor = next(o for o in bpy.context.scene.objects if o not in before and o.type == 'MESH')

# A strict correspondence check protects the original UVs and triangle indices.
source = np.fromfile(work / cfg['positions'], dtype='<f4').reshape((-1, 3))
if len(armor.data.vertices) != len(source):
    raise RuntimeError('Blender changed the shell vertex count')
original = np.array([tuple(armor.matrix_world @ v.co) for v in armor.data.vertices])
expected = source[:, [0, 2, 1]].copy()
expected[:, 1] *= -1
error = float(np.max(np.abs(original - expected)))
if error > 1e-5:
    raise RuntimeError('Shell vertex order/frame changed: ' + str(error))

def joint(name):
    return rig.matrix_world @ rig.data.bones[name].head_local

left, right = joint('L_Hand'), joint('R_Hand')
hip, head = joint('Hip'), joint('Head')
body_points = np.array([tuple(body.matrix_world @ v.co) for v in body.data.vertices])
lo, hi = original.min(axis=0), original.max(axis=0)
# Shells stop at the CUFF; the source body's maximum span includes its fists.
span = float(abs(left.y - right.y)) + .014
scale = span / float(hi[1] - lo[1])
arm_mask = np.abs(original[:, 1] - (lo[1] + hi[1]) / 2) > (hi[1] - lo[1]) * .35
shell_shoulder = float(np.mean(original[arm_mask, 2]))
shoulder = float((left.z + right.z) / 2)
lift = shoulder - shell_shoulder * scale
points = original * scale
points[:, 1] += float((left.y + right.y) / 2) - float((lo[1] + hi[1]) / 2) * scale
points[:, 0] += float((left.x + right.x) / 2) - float(np.mean(points[arm_mask, 0]))
points[:, 2] += lift

# Cuff alignment must not shorten the legs. Extend below the waist to place the
# boot soles at the body's floor; keep arms/head unchanged and retain boot shape.
sole = float(np.min(points[:, 2]))
floor = float(np.min(body_points[:, 2]))
waist = float(hip.z)
lower = points[:, 2] < waist
points[lower, 2] = floor + (points[lower, 2] - sole) * (waist - floor) / (waist - sole)
inverse = armor.matrix_world.inverted()
for v, p in zip(armor.data.vertices, points):
    v.co = inverse @ Vector(p)
armor.data.update()

# Blender's nearest polygon interpolation copies weights from the body's actual
# surface rather than averaging disconnected nearby vertices through cloth.
for group in body.vertex_groups:
    armor.vertex_groups.new(name=group.name)
bpy.context.view_layer.objects.active = armor
transfer = armor.modifiers.new('Body surface weights', 'DATA_TRANSFER')
transfer.object = body
transfer.use_vert_data = True
transfer.data_types_verts = {'VGROUP_WEIGHTS'}
transfer.vert_mapping = 'POLYINTERP_NEAREST'
transfer.layers_vgroup_select_src = 'ALL'
transfer.layers_vgroup_select_dst = 'NAME'
bpy.ops.object.modifier_apply(modifier=transfer.name)

names = cfg['joints']
indices = {n: i for i, n in enumerate(names)}
weights = np.zeros((len(points), 4), dtype='<f4')
joints = np.zeros((len(points), 4), dtype='<u2')
region_counts = {'helmet': 0, 'skirt': 0, 'boots': 0}
for v, p in zip(armor.data.vertices, points):
    x, lateral, height = p
    influence = {armor.vertex_groups[g.group].name: g.weight for g in v.groups if g.weight > 1e-7}
    # Helmet/neck curtain/plume remain rigid together, never dragged by shoulders.
    if height > float(head.z) + .015:
        influence = {'Head': 1.0}
        region_counts['helmet'] += 1
    # The skirt hangs from the hips. This range explicitly excludes footwear and
    # lower shins; the previous packer assigned Hip to toes below this range.
    elif .195 < height < waist and abs(lateral) < .20:
        influence = {'Hip': 1.0}
        region_counts['skirt'] += 1
    elif height < .17:
        side = 'L' if lateral > 0 else 'R'
        # These are rigid tall boots. Tripo's Foot pivot is at the sole and its
        # preset rotates it across the other foot; keep the entire boot on the
        # lower leg instead of folding the toe around that malformed pivot.
        influence = {side + '_Calf': 1.0}
        region_counts['boots'] += 1
    influence = {n: w for n, w in influence.items() if n in indices and w > 1e-7}
    top = sorted(influence.items(), key=lambda item: -item[1])[:4]
    total = sum(w for _, w in top)
    if total <= 0:
        raise RuntimeError('Unweighted vertex: ' + str(v.index))
    for k, (name, weight) in enumerate(top):
        joints[v.index, k] = indices[name]
        weights[v.index, k] = weight / total

# Back to glTF's Y-up frame. Keep original vertex order, UVs, material and indices.
positions = points[:, [0, 2, 1]].astype('<f4')
positions[:, 2] *= -1
normal_matrix = armor.matrix_world.to_3x3().inverted().transposed()
normals = np.array([tuple(normal_matrix @ v.normal) for v in armor.data.vertices])
normals = normals[:, [0, 2, 1]].astype('<f4')
normals[:, 2] *= -1
normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-10)
for name, data in [('position', positions), ('normal', normals), ('joints', joints), ('weights', weights)]:
    data.tofile(work / (cfg['name'] + '-' + name + '.bin'))
report = {'blender': bpy.app.version_string, 'scale': scale, 'lift': lift, 'vertices': len(points), 'correspondenceError': error,
          'soleBefore': sole, 'soleAfter': floor, 'regions': region_counts,
          'minWeightSum': float(weights.sum(axis=1).min()), 'maxWeightSum': float(weights.sum(axis=1).max())}
(work / (cfg['name'] + '-fit.json')).write_text(json.dumps(report, indent=2) + '\n')
print('ARMOR_FIT_RESULT=' + json.dumps(report))
