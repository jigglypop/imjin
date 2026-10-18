"""Remove only the NEW source's extra stepped lower front overlap.

Source/fitted vertex order is unchanged. Keep original UVs, skin and every
retained triangle; output a filtered index list and a small new dark edge strip.
"""
import bpy
import json
import sys
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

work = Path(sys.argv[sys.argv.index('--') + 1])
source = np.fromfile(work / 'clean-source-position.bin', dtype='<f4').reshape((-1, 3))
fitted = np.fromfile(work / 'clean-fitted-position.bin', dtype='<f4').reshape((-1, 3))
triangles = np.fromfile(work / 'clean-source-indices.bin', dtype='<u4').reshape((-1, 3))
joint = np.fromfile(work / 'clean-fitted-joints.bin', dtype='<u2').reshape((-1, 4))
weight = np.fromfile(work / 'clean-fitted-weights.bin', dtype='<f4').reshape((-1, 4))
tree = BVHTree.FromPolygons([Vector(v) for v in source], triangles.tolist(), all_triangles=True)
retained, removed = [], []
for n, face in enumerate(triangles):
    center = source[face].mean(axis=0)
    x, height, depth = center
    # The approved design has a straight closure. The generated extra flap
    # steps from -0.075 to +0.05, then +0.20 across the lower front skirt.
    edge = .070 if height > -.465 else .210
    if height < -.305 and -.073 < x < edge + .012 and depth > .08:
        hit, _, _, _ = tree.ray_cast(Vector((float(x), float(height), 2.0)), Vector((0, 0, -1)), 4.0)
        if hit is not None and depth >= hit.z - .021:
            removed.append(n)
            continue
    retained.append(face)
if len(removed) < 100 or len(removed) > len(triangles) * .12:
    raise RuntimeError('Unsafe front overlap removal count: ' + str(len(removed)))
np.array(retained, dtype='<u4').tofile(work / 'clean-retained-indices.bin')

# A new, narrow binding covers the cut's tiny triangle stair-steps. It follows
# the existing NEW coat surface, not any older garment or replacement panel.
positions, normals, joints, weights, indices = [], [], [], [], []
sample_heights = np.linspace(float(source[:, 1].min()) + .012, -.298, 100)
for height in sample_heights:
    hit, _, face_index, _ = tree.ray_cast(Vector((-.085, float(height), 2.0)), Vector((0, 0, -1)), 4.0)
    if hit is None:
        continue
    face = triangles[face_index]
    a, b, c = [Vector(source[i]) for i in face]
    p = barycentric_transform(hit, a, b, c, *[Vector(fitted[i]) for i in face])
    bary = np.array(barycentric_transform(hit, a, b, c, Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))))
    influence = {}
    for v, share in zip(face, bary):
        for j, w in zip(joint[v], weight[v]):
            influence[int(j)] = influence.get(int(j), 0.0) + float(share * w)
    top = sorted(((j, w) for j, w in influence.items() if w > 1e-8), key=lambda item: -item[1])[:4]
    ids = [j for j, _ in top]; ws = [w for _, w in top]; total = sum(ws)
    ids += [0] * (4 - len(ids)); ws = [w / total for w in ws] + [0] * (4 - len(ws))
    for side in [-1, 1]:
        positions.extend([p.x + side * .0075, p.y, p.z + .003])
        normals.extend([0, 0, 1]); joints.extend(ids); weights.extend(ws)
    row = len(positions) // 6 - 1
    if row:
        a0, a1, b0, b1 = (row - 1) * 2, (row - 1) * 2 + 1, row * 2, row * 2 + 1
        indices.extend([a0, a1, b0, b0, a1, b1])
binding = {'positions': positions, 'normals': normals, 'joints': joints, 'weights': weights, 'indices': indices}
(work / 'clean-binding.json').write_text(json.dumps(binding), encoding='utf-8')
report = {'schema': 'imjin.new-coat-front-cleanup.v1', 'sourceTriangles': len(triangles), 'removedExtraOverlapTriangles': len(removed), 'retainedTriangles': len(retained),
          'originalRetainedVertexPositionsChanged': False, 'originalUVChanged': False, 'originalSkinChanged': False,
          'bindingVertices': len(positions) // 3, 'bindingTriangles': len(indices) // 3,
          'method': 'Remove visible frontmost extra stepped overlap only; retain underlying panels; add narrow straight dark cut-edge binding.',
          'requiresVisualReview': True, 'oldGeometryUsed': False}
(work / 'clean-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('NEW_COAT_FRONT_CLEAN=' + json.dumps(report), flush=True)
