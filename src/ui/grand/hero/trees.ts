import { BufferGeometry, Color, Float32BufferAttribute, InstancedMesh, Matrix4, MeshBasicNodeMaterial, Quaternion, Sphere, Vector3, type Texture } from 'three/webgpu';
import { float, instanceIndex, positionLocal, sin, texture, vec2, vec3 } from 'three/tsl';
import { worldClock } from '../../../select/terrain';
import { SKY_LIGHT, SUN_DIRECTION, SUN_LIGHT } from '../groundPalette';
import { outside, seeded, type Plan } from './plan';

// The woods round a hero camp: broadleaf trees and pines at their own size (eight to thirteen metres, a barracks' length),
// dense on the wooded slopes, in groves on the open ground, off the pads, lanes, yards and shores, so the camp stands in
// country like the painted one instead of among the map's small cones (which keep off the patch). Each tree is a few
// lumpy masses with the land's light baked into its vertex colours, darker underneath; one instanced draw a camp.

/** A tree spot: x, ground y, z (site frame), height, kind (0 broadleaf, 1 pine), shade. */
export type TreeSpot = [number, number, number, number, number, number];

const lin = (hex: string) => new Color(hex);

/** The light a face with normal n gets from the land's sun and sky, the shaded side kept from going black. */
function lightOf(nx: number, ny: number, nz: number) {
  const sun = Math.max(0, nx * SUN_DIRECTION[0] + ny * SUN_DIRECTION[1] + nz * SUN_DIRECTION[2]);
  const sky = 0.62 + 0.38 * ny;
  return [0, 1, 2].map((k) => SUN_LIGHT[k]! * sun * 1.05 + SKY_LIGHT[k]! * sky);
}

/** A lumpy ball of leaves at (cx, cy, cz) of radius r, smooth normals, its vertices pushed in and out a little. */
function blob(pos: number[], col: number[], cx: number, cy: number, cz: number, r: number, leaf: Color, seed: number, near = true) {
  const rings = near ? 3 : 2, seg = 6, rnd = seeded(seed);
  const grid: number[][] = [];
  for (let i = 0; i <= rings; i += 1) {
    const a = -Math.PI / 2 + (i / rings) * Math.PI;
    const row: number[] = [];
    for (let j = 0; j < seg; j += 1) {
      const b = (j / seg) * Math.PI * 2 + (i % 2) * 0.45;
      const k = i === 0 || i === rings ? 1 : 0.85 + rnd.next() * 0.3;
      const nx = Math.cos(a) * Math.cos(b), ny = Math.sin(a), nz = Math.cos(a) * Math.sin(b);
      const L = lightOf(nx, ny, nz);
      // Deeper inside the crown and underneath, less light gets in.
      const ao = 0.55 + 0.45 * (ny * 0.5 + 0.5);
      pos.push(cx + nx * r * k, cy + ny * r * k * 0.85, cz + nz * r * k);
      col.push(leaf.r * L[0]! * ao, leaf.g * L[1]! * ao, leaf.b * L[2]! * ao);
      row.push(pos.length / 3 - 1);
    }
    grid.push(row);
  }
  const idx: number[] = [];
  for (let i = 0; i < rings; i += 1) for (let j = 0; j < seg; j += 1) {
    const a = grid[i]![j]!, b = grid[i]![(j + 1) % seg]!, c = grid[i + 1]![(j + 1) % seg]!, d = grid[i + 1]![j]!;
    idx.push(a, c, b, a, d, c);
  }
  return idx;
}

/** A trunk from y0 to y1, three-sided. */
function trunk(pos: number[], col: number[], r: number, y0: number, y1: number) {
  const bark = lin('#4a3a2a'), idx: number[] = [];
  const base = pos.length / 3;
  for (let k = 0; k < 3; k += 1) {
    const a = (k / 3) * Math.PI * 2;
    for (const y of [y0, y1]) {
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      const L = lightOf(Math.cos(a), 0, Math.sin(a));
      col.push(bark.r * L[0]!, bark.g * L[1]!, bark.b * L[2]!);
    }
  }
  for (let k = 0; k < 3; k += 1) {
    const a = base + k * 2, b = base + ((k + 1) % 3) * 2;
    idx.push(a, a + 1, b + 1, a, b + 1, b);
  }
  return idx;
}

/** How finely a tree is built: `near` for the close views, `far` (about a third of the triangles) for the farther ones. */
export type TreeDetail = 'near' | 'far';

/** A broadleaf tree one unit tall: a trunk under three masses of leaves, or two from afar. */
function broadleaf(detail: TreeDetail) {
  const pos: number[] = [], col: number[] = [], leaf = lin('#3d6127');
  const near = detail === 'near';
  const idx = [
    ...(near ? trunk(pos, col, 0.05, -0.1, 0.45) : []),
    ...blob(pos, col, 0.02, 0.62, 0.02, 0.31, leaf, 1, near),
    ...blob(pos, col, -0.13, 0.48, -0.06, 0.24, leaf.clone().multiplyScalar(0.9), 3, near),
    ...(near ? blob(pos, col, 0.14, 0.5, 0.08, 0.2, leaf.clone().multiplyScalar(1.06), 5, near) : []),
  ];
  return geometry(pos, col, idx);
}

/** A fir of the high ground one unit tall: a trunk and stacked skirts of needles narrowing to the top, drooping at their rims. */
function pine(detail: TreeDetail) {
  const near = detail === 'near';
  const pos: number[] = [], col: number[] = [], needles = lin('#24462a'), idx = near ? [...trunk(pos, col, 0.04, -0.1, 0.3)] : [];
  const seg = near ? 7 : 6;
  const skirts = near ? [[0.16, 0.5, 0.31], [0.36, 0.7, 0.25], [0.56, 0.88, 0.18], [0.74, 1.0, 0.11]] as const : [[0.16, 0.62, 0.3], [0.48, 1.0, 0.19]] as const;
  for (const [y0, y1, r] of skirts) {
    const base = pos.length / 3;
    for (let j = 0; j < seg; j += 1) {
      const a = (j / seg) * Math.PI * 2 + y0 * 3;
      const nx = Math.cos(a) * 0.8, ny = 0.6, nz = Math.sin(a) * 0.8;
      const L = lightOf(nx, ny, nz);
      pos.push(Math.cos(a) * r, y0 - 0.03, Math.sin(a) * r);
      col.push(needles.r * L[0]! * 0.7, needles.g * L[1]! * 0.7, needles.b * L[2]! * 0.7);
    }
    pos.push(0, y1, 0);
    const L = lightOf(0, 1, 0);
    col.push(needles.r * L[0]!, needles.g * L[1]!, needles.b * L[2]!);
    for (let j = 0; j < seg; j += 1) idx.push(base + j, base + seg, base + ((j + 1) % seg));
  }
  return geometry(pos, col, idx);
}

/**
 * The red pine of the Korean coasts one unit tall: a bare trunk leaning a little, under flat, broad tufts of needles, the
 * crown wider than it is deep.
 */
function redPine(detail: TreeDetail) {
  const near = detail === 'near';
  const pos: number[] = [], col: number[] = [], needles = lin('#2d4f2c');
  const idx = near ? [...trunk(pos, col, 0.035, -0.1, 0.72)] : [];
  const tuft = (cx: number, cy: number, cz: number, r: number, shade: number, seed: number) => {
    const start = pos.length / 3;
    const made = blob(pos, col, cx, cy, cz, r, needles.clone().multiplyScalar(shade), seed, near);
    // Flattened to a tuft: half as deep as it is wide.
    for (let v = start; v < pos.length / 3; v += 1) pos[v * 3 + 1] = cy + (pos[v * 3 + 1]! - cy) * 0.5;
    return made;
  };
  idx.push(...tuft(0.03, 0.84, 0, 0.3, 1, 11), ...tuft(-0.16, 0.74, 0.08, 0.2, 0.92, 13));
  if (near) idx.push(...tuft(0.17, 0.72, -0.1, 0.18, 1.05, 17));
  return geometry(pos, col, idx);
}

/** A boulder one unit across: a squat, knobbly granite lump, lit like the land. */
function boulder() {
  const pos: number[] = [], col: number[] = [], idx: number[] = [], stone = lin('#9a958c'), rnd = seeded(7);
  const rings = 3, seg = 7, grid: number[][] = [];
  for (let i = 0; i <= rings; i += 1) {
    const a = -0.35 + (i / rings) * (Math.PI / 2 + 0.35);
    const row: number[] = [];
    for (let j = 0; j < seg; j += 1) {
      const b = (j / seg) * Math.PI * 2;
      const k = i === rings ? 0.3 : 0.75 + rnd.next() * 0.5;
      const nx = Math.cos(a) * Math.cos(b), ny = Math.sin(a), nz = Math.cos(a) * Math.sin(b);
      const L = lightOf(nx, ny, nz), ao = 0.6 + 0.4 * Math.max(0, ny);
      pos.push(nx * 0.5 * k, Math.max(-0.2, ny) * 0.55 * (i === rings ? 1 : k), nz * 0.5 * k);
      col.push(stone.r * L[0]! * ao, stone.g * L[1]! * ao, stone.b * L[2]! * ao);
      row.push(pos.length / 3 - 1);
    }
    grid.push(row);
  }
  for (let i = 0; i < rings; i += 1) for (let j = 0; j < seg; j += 1) {
    const a = grid[i]![j]!, b = grid[i]![(j + 1) % seg]!, c = grid[i + 1]![(j + 1) % seg]!, d = grid[i + 1]![j]!;
    idx.push(a, c, b, a, d, c);
  }
  return geometry(pos, col, idx);
}

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

function geometry(pos: number[], col: number[], idx: number[]) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
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

/**
 * The shapes, one unit tall, by the kind a spot names: 0 broadleaf, 1 fir, 2 boulder, 3 red pine. The boulder is the
 * same at either detail.
 */
export function treeShapes(detail: TreeDetail) {
  return [broadleaf(detail), pine(detail), boulder(), redPine(detail)];
}

/** The trees as instanced meshes, one a kind, in the site's frame. */
export function treeMeshes(spots: TreeSpot[], material: MeshBasicNodeMaterial) {
  const shapes = treeShapes('near');
  return shapes.map((shape, kind) => {
    const list = spots.filter((s) => s[4] === kind);
    if (!list.length) { shape.dispose(); return null; }
    const mesh = new InstancedMesh(shape, material, list.length);
    const m = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), c = new Color();
    let maxR = 0;
    list.forEach(([x, y, z, h, , shade], i) => {
      q.setFromAxisAngle(up, (x * 12.9898 + z * 78.233) % (Math.PI * 2));
      const w = kind === 2 ? h : h * (kind === 1 ? 0.85 : kind === 3 ? 1.05 : 1.15) * (0.85 + ((x * 3.7 + z * 1.3) % 0.3));
      m.compose(new Vector3(x, y, z), q, new Vector3(w, kind === 2 ? h * (0.6 + ((z * 2.3) % 0.5)) : h, w));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setRGB(shade, shade * (0.97 + ((x * 7.1) % 0.06)), shade * 0.95));
      maxR = Math.max(maxR, Math.hypot(x, z) + h);
    });
    // One bounding sphere over the whole wood, so the camera culls it whole.
    mesh.geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), maxR + 20);
    mesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), maxR + 20);
    return mesh;
  }).filter((m) => m !== null);
}

/**
 * The trees' material: their baked colours tinted per tree, broken by the woodland texture `leaves` (the land's, which
 * frees it) into clumps of leaves (read across each tree's own shape, so every crown is leafy and none is a smooth ball),
 * unlit like the land, with its fog. The crowns sway a little in the wind, each tree out of step with the next, and the
 * trunks and the rocks not at all.
 */
export function treeMaterial(leaves: Texture) {
  const m = new MeshBasicNodeMaterial({ vertexColors: true });
  const p: any = positionLocal;
  const mean = texture(leaves, vec2(0.5, 0.5)).level(float(12)).rgb.dot(vec3(0.3, 0.55, 0.15)).max(0.02);
  const a = texture(leaves, p.xy.mul(6.1)).rgb.dot(vec3(0.3, 0.55, 0.15)), b = texture(leaves, p.zy.mul(5.3).add(vec2(0.31, 0.57))).rgb.dot(vec3(0.3, 0.55, 0.15));
  const shade = a.mul(b).sqrt().div(mean);
  // The vertex colours and each tree's tint multiply in after this (vertexColors, instanceColor).
  m.colorNode = vec3(shade.pow(1.3).mul(0.85).add(0.15));
  const clock: any = worldClock, phase = float(instanceIndex).mul(1.7);
  const bend = p.y.max(0).mul(p.y.max(0)).mul(0.035);
  const sx: any = sin(clock.mul(1.1).add(phase)).mul(bend), sz: any = sin(clock.mul(0.8).add(phase.mul(1.3))).mul(bend.mul(0.6));
  m.positionNode = p.add(vec3(sx, 0, sz));
  return m;
}
