import { Color, InstancedMesh, Matrix4, Quaternion, Sphere, Vector3, type Material } from 'three/webgpu';
import { FINE_SIZE, treeShapes } from '../treeModels';
import { outside, seeded, type Plan } from './plan';

// The woods round a hero camp: broadleaf trees and pines at their own size (eight to thirteen metres, a barracks' length),
// dense on the wooded slopes, in groves on the open ground, off the pads, lanes, yards and shores, so the camp stands in
// country like the painted one instead of among the map's small trees (which keep off the patch), and granite boulders
// along its shores. The shapes and their materials are the map's (treeModels.ts): one instanced draw a kind, finely
// built for a close camera and lightly for a farther one.

/** A tree spot: x, ground y, z (site frame), height, kind (0 broadleaf, 1 fir, 2 boulder, 3 red pine), shade. */
export type TreeSpot = [number, number, number, number, number, number];

/**
 * Granite boulders along the shore, in ones and twos and threes, where the land meets the water, off the quays, slips
 * and piers and clear of the ships (kind 2 spots).
 */
export function placeBoulders(plan: Plan, reach: number, groundAt: (x: number, z: number) => { h: number }, seed: number): TreeSpot[] {
  const rnd = seeded(seed + 17), out: TreeSpot[] = [];
  const step = 2.6;
  const ships = plan.ships.map((s): [number, number] => [s.x, s.z]);
  for (let z = -reach + 8; z <= reach - 8; z += step) for (let x = -reach + 8; x <= reach - 8; x += step) {
    const px = x + (rnd.next() - 0.5) * step, pz = z + (rnd.next() - 0.5) * step;
    const h = groundAt(px, pz).h;
    if (h < -0.25 || h > 0.7) continue;
    let wet = 0;
    for (let k = 0; k < 6; k += 1) if (groundAt(px + Math.cos(k * 1.05) * 4, pz + Math.sin(k * 1.05) * 4).h < -0.05) wet += 1;
    if (wet < 2 || wet > 4 || rnd.next() > 0.14) continue;
    if (plan.pads.some((pad) => outside(pad.poly, px, pz) < 3) || plan.flats.some((f) => outside(f.poly, px, pz) < 3)) continue;
    if (ships.some(([sx, sz]) => Math.hypot(px - sx, pz - sz) < 14)) continue;
    if (plan.pieces.some(({ piece: p }) => p.kind === 'box' && p.look === 'pier' && Math.hypot(px - p.x, pz - p.z) < Math.max(p.w, p.d) / 2 + 3)) continue;
    const n = 1 + Math.floor(rnd.next() * 3);
    for (let i = 0; i < n; i += 1) {
      const bx = px + (rnd.next() - 0.5) * 3, bz = pz + (rnd.next() - 0.5) * 3;
      out.push([bx, groundAt(bx, bz).h - 0.25, bz, 1.2 + rnd.next() * 2.4, 2, 0.8 + rnd.next() * 0.35]);
    }
  }
  return out;
}

/**
 * Where the trees stand: a jittered grid over the patch, kept where the ground is wooded (`wood` 0..1, dense) or open (in
 * groves by a slow noise), never on water, sand or rock, on a pad or within reach of one, a lane, a building or a clearing.
 */
export function plantTrees(plan: Plan, reach: number, groundAt: (x: number, z: number) => { h: number; wood: number; open: number }, seed: number, avoid: [number, number, number][] = []): TreeSpot[] {
  const rnd = seeded(seed), out: TreeSpot[] = [];
  const step = 2.8;
  const keepOff: [number, number, number][] = [...plan.clear, ...plan.ships.map((s): [number, number, number] => [s.x, s.z, 13]), ...avoid];
  for (const { piece: p } of plan.pieces) if ('x' in p && 'z' in p) keepOff.push([p.x, p.z, p.kind === 'bldg' ? Math.max(p.w, p.d) / 2 + 3 : 4]);
  const lanes = plan.strips.flatMap((s) => s.line.slice(1).map((b, i) => ({ a: s.line[i]!, b, r: s.width / 2 + 2.5 })));
  const nearLane = (x: number, z: number) => lanes.some(({ a, b, r }) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < r;
  });
  const grove = (x: number, z: number) => Math.sin(x * 0.045 + Math.sin(z * 0.03) * 2) * Math.sin(z * 0.05 + x * 0.02) ;
  for (let z = -reach; z <= reach; z += step) for (let x = -reach; x <= reach; x += step) {
    const px = x + (rnd.next() - 0.5) * step * 0.9, pz = z + (rnd.next() - 0.5) * step * 0.9;
    const edge = reach - Math.max(Math.abs(px), Math.abs(pz));
    if (edge < 6) continue;
    const g = groundAt(px, pz);
    if (g.h < 0.25 || plan.water(px, pz)) continue;
    const want = Math.min(1, g.wood * 1.3) + g.open * Math.max(0, grove(px, pz) - 0.2) * 1.6;
    if (rnd.next() > want * Math.min(1, edge / 30)) continue;
    if (plan.pads.some((pad) => outside(pad.poly, px, pz) < 4)) continue;
    if (keepOff.some(([cx, cz, r]) => Math.hypot(px - cx, pz - cz) < r)) continue;
    if (plan.flats.some((f) => outside(f.poly, px, pz) < 2) || nearLane(px, pz)) continue;
    const pineShare = Math.min(0.85, 0.25 + g.h * 0.06);
    const conifer = rnd.next() < pineShare, low = rnd.next() > g.h * 0.05;
    out.push([px, g.h - 0.2, pz, 5.5 + rnd.next() * 4.5, conifer ? (low ? 3 : 1) : 0, 0.78 + rnd.next() * 0.34]);
  }
  return out;
}

/** A hero camp's woods: the trees of each kind at both details, `deal` sorting them to the detail the eye wants. */
export interface Woods {
  /** Every mesh, the fine ones and the light ones. */
  meshes: InstancedMesh[];
  /** Deals each tree to the fine shapes when it stands large to `eye` (a point of the site's frame), else to the light ones. */
  deal(eye: readonly [number, number, number]): void;
}

/**
 * The trees as instanced meshes in the site's frame, one a kind (0 broadleaf, 1 fir, 2 boulder, 3 red pine) at each
 * detail. The trees take `trees`, the boulders `rocks`.
 */
export function treeMeshes(spots: TreeSpot[], trees: Material, rocks: Material): Woods {
  const turn = new Quaternion(), up = new Vector3(0, 1, 0), m = new Matrix4(), c = new Color();
  const kinds = [0, 1, 2, 3].map((kind) => {
    const list = spots.filter((s) => s[4] === kind);
    const n = list.length;
    const at = new Float32Array(n * 3), tall = new Float32Array(n), matrix = new Float32Array(n * 16), tint = new Float32Array(n * 3);
    let reach = 0;
    list.forEach(([x, y, z, h, , shade], i) => {
      turn.setFromAxisAngle(up, (x * 12.9898 + z * 78.233) % (Math.PI * 2));
      const w = kind === 2 ? h : h * (kind === 1 ? 0.85 : kind === 3 ? 1.05 : 1.15) * (0.85 + ((x * 3.7 + z * 1.3) % 0.3));
      m.compose(new Vector3(x, y, z), turn, new Vector3(w, kind === 2 ? h * (0.6 + ((z * 2.3) % 0.5)) : h, w));
      m.toArray(matrix, i * 16);
      c.setRGB(shade, shade * (0.97 + ((x * 7.1) % 0.06)), shade * 0.95).toArray(tint, i * 3);
      at.set([x, y, z], i * 3);
      tall[i] = h;
      reach = Math.max(reach, Math.hypot(x, z) + h);
    });
    return { n, at, tall, matrix, tint, reach };
  });
  const pair = (detail: 'near' | 'far') => treeShapes(detail).map((shape, kind) => {
    const { n, reach } = kinds[kind]!;
    if (!n) { shape.dispose(); return null; }
    const mesh = new InstancedMesh(shape, kind === 2 ? rocks : trees, n);
    mesh.count = 0;
    mesh.setColorAt(0, c.setRGB(1, 1, 1));
    // One bounding sphere over the whole wood, so the camera culls it whole.
    mesh.geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), reach + 20);
    mesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), reach + 20);
    return mesh;
  });
  const near = pair('near'), far = pair('far');
  return {
    meshes: [...near, ...far].flatMap((mesh) => (mesh ? [mesh] : [])),
    deal(eye) {
      kinds.forEach(({ n, at, tall, matrix, tint }, kind) => {
        const a = near[kind], b = far[kind];
        if (!a || !b) return;
        let na = 0, nb = 0;
        for (let i = 0; i < n; i += 1) {
          const fine = tall[i]! > FINE_SIZE * Math.hypot(at[i * 3]! - eye[0], at[i * 3 + 1]! - eye[1], at[i * 3 + 2]! - eye[2]);
          const to = fine ? a : b, k = fine ? na++ : nb++;
          (to.instanceMatrix.array as Float32Array).set(matrix.subarray(i * 16, i * 16 + 16), k * 16);
          (to.instanceColor!.array as Float32Array).set(tint.subarray(i * 3, i * 3 + 3), k * 3);
        }
        for (const [mesh, count] of [[a, na], [b, nb]] as const) {
          mesh.count = count;
          mesh.visible = count > 0;
          mesh.instanceMatrix.needsUpdate = true;
          mesh.instanceColor!.needsUpdate = true;
        }
      });
    },
  };
}
