"""Fit only the NEW pilot coat to the NEW body rig; source bytes stay untouched.

Blender supplies world-space measurements and nearest-polygon skin transfer.
The JS companion preserves the body's original node transforms and inverse binds.
"""
import bpy
import json
import sys
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

cfg = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
work = Path(cfg['work'])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=cfg['body'], merge_vertices=False)
body = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render and not o.name.startswith('Icosphere'))
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
rig.animation_data_clear()
rig.data.pose_position = 'REST'
before = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=cfg['coat'], merge_vertices=False)
coat = next(o for o in bpy.context.scene.objects if o not in before and o.type == 'MESH')
bpy.context.view_layer.update()

def points(obj):
    return np.array([tuple(obj.matrix_world @ v.co) for v in obj.data.vertices], dtype=np.float64)

def joint(name):
    return np.array(tuple(rig.matrix_world @ rig.data.bones[name].head_local))

def smooth(a, b, x):
    t = np.clip((x - a) / max(b - a, 1e-10), 0, 1)
    return t * t * (3 - 2 * t)

bp, source = points(body), points(coat)
expected = np.fromfile(work / 'coat-source-position.bin', dtype='<f4').reshape((-1, 3))
coat_matrix = np.array(cfg['coatMatrix'], dtype=float).reshape((4, 4)).T
expected = (np.c_[expected, np.ones(len(expected))] @ coat_matrix.T)[:, :3]
expected = expected[:, [0, 2, 1]]
expected[:, 1] *= -1
if len(expected) != len(source) or np.max(np.abs(expected - source)) > 1e-5:
    raise RuntimeError('Source vertex order/frame correspondence failed')

lo, hi = source.min(axis=0), source.max(axis=0)
height = float(hi[2] - lo[2])
half_span = float((hi[0] - lo[0]) / 2)
center_x = float((hi[0] + lo[0]) / 2)
raw_x = source[:, 0] - center_x
arm_mask = np.abs(raw_x) > half_span * .70
source_arm_z = float(np.median(source[arm_mask, 2]))
source_waist_z = float(lo[2] + height * .592)
source_arm_root = half_span * .30
hip, neck = joint('Hips'), joint('neck')
left_arm, right_arm = joint('LeftArm'), joint('RightArm')
left_wrist, right_wrist = joint('LeftHand'), joint('RightHand')
waist = float(hip[2] + .020)
hem = float((joint('LeftLeg')[2] + joint('RightLeg')[2]) / 2 - .045)
arm_z = float((left_wrist[2] + right_wrist[2]) / 2)
collar = float(neck[2] + .100)
source_levels = [float(lo[2]), source_waist_z, source_arm_z, float(hi[2])]
target_levels = [hem, waist, arm_z + .055, collar]
if not np.all(np.diff(source_levels) > 0) or not np.all(np.diff(target_levels) > 0):
    raise RuntimeError('Non-monotonic garment landmark mapping')
mapped_z = np.interp(source[:, 2], source_levels, target_levels)

# Quantile profiles exclude the outstretched arms. The cross section is enlarged
# by 15 percent, with millimetre clearance, rather than shrink-wrapped to skin.
body_axis_x = float((left_arm[0] + right_arm[0]) / 2)
profile_z = np.linspace(waist, collar, 55)
source_profile_z = np.interp(profile_z, target_levels, source_levels)
body_cx, body_cy, body_rx, body_ry = [], [], [], []
source_cx, source_cy, source_rx, source_ry = [], [], [], []
for tz, sz in zip(profile_z, source_profile_z):
    b = bp[(np.abs(bp[:, 2] - tz) < .016) & (np.abs(bp[:, 0] - body_axis_x) < .265)]
    if len(b) < 15:
        b = bp[(np.abs(bp[:, 2] - tz) < .032) & (np.abs(bp[:, 0] - body_axis_x) < .265)]
    s = source[(np.abs(source[:, 2] - sz) < height * .015) & (np.abs(raw_x) < source_arm_root * 1.10)]
    if len(b) < 5 or len(s) < 5:
        raise RuntimeError('Insufficient torso cross section near ' + str(tz))
    blo, bhi = np.quantile(b[:, :2], [.015, .985], axis=0)
    slo, shi = np.quantile(s[:, :2], [.015, .985], axis=0)
    body_cx.append(float((blo[0] + bhi[0]) / 2)); body_cy.append(float((blo[1] + bhi[1]) / 2))
    body_rx.append(float((bhi[0] - blo[0]) / 2 * 1.15 + .003))
    body_ry.append(float((bhi[1] - blo[1]) / 2 * 1.15 + .003))
    source_cx.append(float((slo[0] + shi[0]) / 2)); source_cy.append(float((slo[1] + shi[1]) / 2))
    source_rx.append(max(float((shi[0] - slo[0]) / 2), .015))
    source_ry.append(max(float((shi[1] - slo[1]) / 2), .015))

torso = source.copy()
for axis, bc, br, sc, sr in [(0, body_cx, body_rx, source_cx, source_rx), (1, body_cy, body_ry, source_cy, source_ry)]:
    target_center = np.interp(mapped_z, profile_z, bc)
    target_radius = np.interp(mapped_z, profile_z, br)
    source_center = np.interp(mapped_z, profile_z, sc)
    source_radius = np.interp(mapped_z, profile_z, sr)
    torso[:, axis] = target_center + (source[:, axis] - source_center) * target_radius / source_radius
torso[:, 2] = mapped_z
# Preserve the generated garment's smooth chest instead of imprinting the
# under-shirt's wrinkled per-row width profile into armour plates and rivets.
# The uniform waist-derived section keeps the shoulders broad and collar round.
torso_x_scale = max(body_rx[0] / source_rx[0], 1.0)
torso_y_scale = max(body_ry[0] / source_ry[0], .72)
torso[:, 0] = body_axis_x + (source[:, 0] - source_cx[0]) * torso_x_scale
torso[:, 1] = body_cy[0] + (source[:, 1] - source_cy[0]) * torso_y_scale

# Sleeve cross sections are aligned to each actual arm/wrist line. The cuff ends
# before the wrist, and the coat does not inherit the source model's 1.90 m span.
arms = torso.copy()
for side, arm, wrist, elbow in [('Left', left_arm, left_wrist, joint('LeftForeArm')), ('Right', right_arm, right_wrist, joint('RightForeArm'))]:
    sign = 1 if side == 'Left' else -1
    side_mask = raw_x * sign > source_arm_root * .75
    sx = raw_x * sign
    cuff = float(abs(wrist[0] - body_axis_x) - .014)
    shoulder = float(abs(arm[0] - body_axis_x) * 1.15)
    tx = shoulder + (sx - source_arm_root) / (half_span - source_arm_root) * (cuff - shoulder)
    original_center_y = np.zeros(len(source)); original_center_z = np.zeros(len(source))
    original_radius_y = np.zeros(len(source)); original_radius_z = np.zeros(len(source))
    target_center_y = np.zeros(len(source)); target_center_z = np.zeros(len(source))
    target_radius_y = np.zeros(len(source)); target_radius_z = np.zeros(len(source))
    bins = np.linspace(source_arm_root * .75, half_span, 38)
    sy, sz, ry, rz, ty, tz, try_, trz = [], [], [], [], [], [], [], []
    bone_x = [float(abs(arm[0] - body_axis_x)), float(abs(elbow[0] - body_axis_x)), float(abs(wrist[0] - body_axis_x))]
    for x in bins:
        s = source[(np.abs(sx - x) < half_span * .026) & (source[:, 2] > source_arm_z - height * .18)]
        target_x = float(shoulder + (x - source_arm_root) / (half_span - source_arm_root) * (cuff - shoulder))
        b = bp[(np.abs((bp[:, 0] - body_axis_x) * sign - target_x) < .020) & (bp[:, 2] > arm_z - .17)]
        if len(s) < 5 or len(b) < 5:
            raise RuntimeError('Missing sleeve cross section')
        slo, shi = np.quantile(s[:, 1:3], [.015, .985], axis=0)
        blo, bhi = np.quantile(b[:, 1:3], [.015, .985], axis=0)
        sy.append(float((slo[0] + shi[0]) / 2)); sz.append(float((slo[1] + shi[1]) / 2))
        ry.append(max(float((shi[0] - slo[0]) / 2), .012)); rz.append(max(float((shi[1] - slo[1]) / 2), .012))
        ty.append(float(np.interp(target_x, bone_x, [arm[1], elbow[1], wrist[1]])))
        tz.append(float(np.interp(target_x, bone_x, [arm[2], elbow[2], wrist[2]])))
        try_.append(max(float((bhi[0] - blo[0]) / 2) * 1.15 + .004, .025))
        trz.append(max(float((bhi[1] - blo[1]) / 2) * 1.15 + .004, .025))
    arms[side_mask, 0] = body_axis_x + sign * tx[side_mask]
    arms[side_mask, 1] = np.interp(sx[side_mask], bins, ty) + (source[side_mask, 1] - np.interp(sx[side_mask], bins, sy)) * np.interp(sx[side_mask], bins, try_) / np.interp(sx[side_mask], bins, ry)
    arms[side_mask, 2] = np.interp(sx[side_mask], bins, tz) + (source[side_mask, 2] - np.interp(sx[side_mask], bins, sz)) * np.interp(sx[side_mask], bins, trz) / np.interp(sx[side_mask], bins, rz)

arm_weight = smooth(source_arm_root * .82, source_arm_root * 1.24, np.abs(raw_x))
arm_weight *= smooth(source_arm_z - height * .18, source_arm_z - height * .10, source[:, 2])
fitted = torso * (1 - arm_weight[:, None]) + arms * arm_weight[:, None]
# Explicit signed surface clearance catches upper-chest/shoulder intersections;
# cuffs keep their measured wrist alignment. This changes only NEW coat points.
surface = BVHTree.FromPolygons([Vector(p) for p in bp], [list(p.vertices) for p in body.data.polygons], all_triangles=True)
clearance_moves = 0
for i, p in enumerate(fitted):
    if p[2] < waist - .015 or abs(p[0] - body_axis_x) > .43:
        continue
    for _ in range(2):
        hit, normal, _, distance = surface.find_nearest(Vector(p))
        if hit is None:
            break
        nearest, outward = np.array(tuple(hit)), np.array(tuple(normal))
        signed = float(np.dot(p - nearest, outward))
        if signed >= .012:
            break
        p = nearest + outward * .012
        clearance_moves += 1
    fitted[i] = p
inv = coat.matrix_world.inverted()
for v, p in zip(coat.data.vertices, fitted):
    v.co = inv @ Vector(p)
coat.data.update()

for g in list(coat.vertex_groups):
    coat.vertex_groups.remove(g)
for g in body.vertex_groups:
    coat.vertex_groups.new(name=g.name)
bpy.ops.object.select_all(action='DESELECT')
coat.select_set(True); bpy.context.view_layer.objects.active = coat
transfer = coat.modifiers.new('NEW body surface weights', 'DATA_TRANSFER')
transfer.object = body; transfer.use_vert_data = True; transfer.data_types_verts = {'VGROUP_WEIGHTS'}
transfer.vert_mapping = 'POLYINTERP_NEAREST'; transfer.layers_vgroup_select_src = 'ALL'; transfer.layers_vgroup_select_dst = 'NAME'
bpy.ops.object.modifier_apply(modifier=transfer.name)

names = cfg['joints']; index = {n: i for i, n in enumerate(names)}
joints = np.zeros((len(fitted), 4), dtype='<u2'); weights = np.zeros((len(fitted), 4), dtype='<f4')
skirt_vertices = 0
for v, p in zip(coat.data.vertices, fitted):
    influence = {coat.vertex_groups[g.group].name: g.weight for g in v.groups if g.weight > 1e-8}
    if p[2] < waist - .018:
        fall = float(smooth(0, 1, (waist - p[2]) / (waist - hem)))
        thighs = .20 + .55 * fall
        left = float(smooth(-.060, .060, p[0] - body_axis_x))
        influence = {'Hips': 1 - thighs, 'LeftUpLeg': thighs * left, 'RightUpLeg': thighs * (1 - left)}
        skirt_vertices += 1
    top = sorted(((n, w) for n, w in influence.items() if n in index and w > 1e-8), key=lambda x: -x[1])[:4]
    total = sum(w for _, w in top)
    if total <= 0:
        raise RuntimeError('Unweighted vertex ' + str(v.index))
    for k, (n, w) in enumerate(top):
        joints[v.index, k] = index[n]; weights[v.index, k] = w / total

# Calibrate the source POSITION contract against the imported bind-pose surface.
# Meshy's skinned GLB stores metre positions while Blender imports centimetre
# mesh vertices under a .01 node. Inverting that node alone would enlarge the
# fitted garment by 100x. The original body positions are authoritative here.
gltf_world = fitted[:, [0, 2, 1]].copy(); gltf_world[:, 2] *= -1
body_source = np.fromfile(work / 'body-source-position.bin', dtype='<f4').reshape((-1, 3))
if len(body_source) != len(bp):
    raise RuntimeError('Body source POSITION correspondence failed')
body_observed = bp[:, [0, 2, 1]].copy(); body_observed[:, 2] *= -1
calibration, _, _, _ = np.linalg.lstsq(np.c_[body_source, np.ones(len(body_source))], body_observed, rcond=None)
calibration_error = float(np.max(np.abs(np.c_[body_source, np.ones(len(body_source))] @ calibration - body_observed)))
if calibration_error > 1e-5:
    raise RuntimeError('Body POSITION frame is not affine in bind pose: ' + str(calibration_error))
position_frame = np.eye(4); position_frame[:3, :] = calibration.T
local = (np.c_[gltf_world, np.ones(len(gltf_world))] @ np.linalg.inv(position_frame).T)[:, :3].astype('<f4')
normal_matrix = coat.matrix_world.to_3x3().inverted().transposed()
normal = np.array([tuple(normal_matrix @ v.normal) for v in coat.data.vertices])
normal = normal[:, [0, 2, 1]]; normal[:, 2] *= -1
normal = normal @ position_frame[:3, :3]
normal /= np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-10)
for name, array in [('position', local), ('normal', normal.astype('<f4')), ('joints', joints), ('weights', weights)]:
    array.tofile(work / ('coat-fitted-' + name + '.bin'))
report = {'schema': 'imjin.new-coat-fit.v1', 'blender': bpy.app.version_string, 'sourceVertices': len(source), 'fittedVertices': len(fitted), 'oldGeometryUsed': False,
          'bodyFramePreservedByCompanion': True, 'clearanceScale': 1.15, 'sourceLevels': source_levels, 'targetLevels': target_levels,
          'hemWorld': hem, 'waistWorld': waist, 'collarWorld': collar, 'skirtVertices': skirt_vertices, 'skirtThighWeightAtHem': .75,
          'torsoUniformScaleX': torso_x_scale, 'torsoUniformScaleY': torso_y_scale, 'upperSurfaceClearanceMetres': .012, 'clearanceProjectionMoves': clearance_moves,
          'minWeightSum': float(weights.sum(axis=1).min()), 'maxWeightSum': float(weights.sum(axis=1).max()),
          'boundsWorld': {'min': fitted.min(axis=0).tolist(), 'max': fitted.max(axis=0).tolist()},
          'positionFrameCalibration': position_frame.tolist(), 'positionFrameCalibrationError': calibration_error,
          'frontOpening': {'status': 'source-step-overlap-not-yet-cleaned', 'required': 'Straighten NEW lower central lapel or cut overhanging narrow flap; source file remains unchanged.'}}
(work / 'coat-fit.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('NEW_COAT_FIT=' + json.dumps(report), flush=True)
