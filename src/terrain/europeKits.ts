import { DoubleSide, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, Matrix4, MeshStandardNodeMaterial, Quaternion, Vector3, type Material } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EuropeanStructure } from './features';

// The buildings of the 1588 Channel coasts, built here from boxes and prisms with their colours in the vertices: no
// texture, no download, one material for all of them. Sizes are in metres with the ground at y = 0 and a footing below it
// for slopes. Each kit is a few hundred triangles, so the near and the far model are the same.

type Part = BufferGeometry;

function finish(g: BufferGeometry, color: string, m: Matrix4) {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  geo.applyMatrix4(m);
  const c = new Color(color);
  const n = geo.getAttribute('position').count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) cols.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new Float32BufferAttribute(cols, 3));
  return geo;
}

const at = (x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1) =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ry), new Vector3(sx, sy, sz));

/** A box of w (x) by h by d (z), its base at y. */
const box = (color: string, w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0) => finish(new BoxGeometry(w, h, d), color, at(x, y + h / 2, z, ry));

/** A pitched roof over w (x, the ridge) by d (z), eaves at y, ridge `rise` above them, overhanging by `over`. */
function roof(color: string, w: number, d: number, rise: number, y: number, x = 0, z = 0, over = 0.5) {
  const hw = w / 2 + over;
  const hd = d / 2 + over;
  const t = 0.35;
  // Two thick slabs meeting at the ridge, with the two gable triangles closing the ends.
  const p = [
    // slope +z
    [-hw, 0, hd], [hw, 0, hd], [hw, rise, 0], [-hw, 0, hd], [hw, rise, 0], [-hw, rise, 0],
    // slope -z
    [hw, 0, -hd], [-hw, 0, -hd], [-hw, rise, 0], [hw, 0, -hd], [-hw, rise, 0], [hw, rise, 0],
    // underside, a little lower
    [-hw, -t, hd], [hw, rise - t, 0], [hw, -t, hd], [-hw, -t, hd], [-hw, rise - t, 0], [hw, rise - t, 0],
    [hw, -t, -hd], [-hw, rise - t, 0], [-hw, -t, -hd], [hw, -t, -hd], [hw, rise - t, 0], [-hw, rise - t, 0],
    // eave edges
    [-hw, -t, hd], [hw, -t, hd], [hw, 0, hd], [-hw, -t, hd], [hw, 0, hd], [-hw, 0, hd],
    [hw, -t, -hd], [-hw, -t, -hd], [-hw, 0, -hd], [hw, -t, -hd], [-hw, 0, -hd], [hw, 0, -hd],
  ].flat();
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return finish(g, color, at(x, y, z));
}

/** The triangular wall under a roof's ends, `w` along x, from y up `rise`. */
function gableEnds(color: string, w: number, d: number, rise: number, y: number, x = 0, z = 0) {
  const hd = d / 2;
  const hw = w / 2;
  const p = [
    [hw, 0, -hd], [hw, 0, hd], [hw, rise, 0],
    [-hw, 0, hd], [-hw, 0, -hd], [-hw, rise, 0],
  ].flat();
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return finish(g, color, at(x, y, z));
}

const STONE = '#8f8a7f';
const STONE_DARK = '#6f6a60';
const SLATE = '#4a5058';
const THATCH = '#9c8350';
const PLASTER = '#ddd5c2';
const TIMBER = '#3b2a1c';
const BRICK = '#8a4a34';
const BRICK_DARK = '#6e3a2a';
const TILE = '#7a3a2a';
const DOOR = '#3a2a1e';
const WINDOW = '#2a2c30';
const HEDGE = '#36502a';
const HEDGE_DARK = '#2a4021';

/** A stone cottage under slate, a chimney at one end: the West Country and Dorset. 12 by 7 m. */
function cottage(): Part[] {
  return [
    box(STONE, 12, 4.6, 7, 0, -1.5),
    box(STONE_DARK, 12.2, 1.6, 7.2, 0, -1.5),
    gableEnds(STONE, 12, 7, 3.2, 3.1),
    roof(SLATE, 12, 7, 3.2, 3.1, 0, 0, 0.35),
    box(STONE, 1.2, 3.2, 1.2, 5.2, 4.8, 0),
    box(DOOR, 1.1, 2, 0.2, -1, 0, 3.55),
    box(WINDOW, 1, 0.9, 0.2, 2.6, 1.1, 3.55),
    box(WINDOW, 1, 0.9, 0.2, -3.8, 1.1, 3.55),
    box(WINDOW, 1, 0.9, 0.2, 2.6, 1.1, -3.55),
  ];
}

/** A timber-framed cottage, plaster between dark posts, under a deep thatch: Tudor. 11 by 6.5 m. */
function tudor(): Part[] {
  const parts: Part[] = [
    box(STONE_DARK, 11.2, 2.2, 6.7, 0, -1.5),
    box(PLASTER, 11, 4.2, 6.5, 0, 0.6),
    gableEnds(PLASTER, 11, 6.5, 3.6, 4.8),
    roof(THATCH, 11, 6.5, 3.8, 4.6, 0, 0, 0.8),
    box(BRICK, 1.1, 3.4, 1.1, -5, 6.2, 0),
    box(DOOR, 1.1, 2.1, 0.2, 1.2, 0.6, 3.3),
  ];
  // The frame: corner and middle posts, a sill and a rail on the long sides, a brace on each bay.
  for (const side of [-1, 1]) {
    for (const px of [-5.4, -2.7, 0, 2.7, 5.4]) parts.push(box(TIMBER, 0.3, 4.2, 0.12, px, 0.6, side * 3.3));
    parts.push(box(TIMBER, 11, 0.3, 0.12, 0, 0.6, side * 3.3), box(TIMBER, 11, 0.25, 0.12, 0, 2.6, side * 3.3), box(TIMBER, 11, 0.3, 0.12, 0, 4.5, side * 3.3));
    for (const px of [-4.05, 4.05]) {
      const brace = box(TIMBER, 0.22, 2.6, 0.12, 0, 0, 0);
      brace.applyMatrix4(new Matrix4().makeRotationZ(side * 0.6)).applyMatrix4(new Matrix4().makeTranslation(px, 2.1, side * 3.32));
      parts.push(brace);
    }
    for (const pz of [-3, 0, 3]) parts.push(box(TIMBER, 0.12, 4.2, 0.3, side * 5.55, 0.6, pz));
  }
  parts.push(box(WINDOW, 1.2, 0.8, 0.2, -2.7 + 1.35, 3.2, 3.35), box(WINDOW, 1.2, 0.8, 0.2, 2.7 + 1.35, 1.4, 3.35));
  return parts;
}

/** A parish church: a stone nave under slate, a lower chancel, a square west tower with battlements. 30 m long. */
function church(): Part[] {
  const parts: Part[] = [
    box(STONE_DARK, 31, 2, 10.4, 1, -1.8),
    box(STONE, 18, 8, 9, 1, 0),
    gableEnds(STONE, 18, 9, 4.6, 8, 1),
    roof(SLATE, 18, 9, 4.6, 8, 1, 0, 0.4),
    box(STONE, 8, 6, 7, 14, 0),
    gableEnds(STONE, 8, 7, 3.6, 6, 14),
    roof(SLATE, 8, 7, 3.6, 6, 14, 0, 0.3),
    box(STONE, 7.2, 20, 7.2, -11.6, -1),
    box(STONE_DARK, 7.8, 0.8, 7.8, -11.6, 19),
    box(DOOR, 0.3, 3.4, 2, -15.3, 0, 0),
    box(WINDOW, 0.3, 3, 1.4, -15.3, 13, 0),
    box(WINDOW, 1.4, 3, 0.3, -11.6, 13, 3.65),
    box(WINDOW, 1.4, 3, 0.3, -11.6, 13, -3.65),
  ];
  // Battlements and corner pinnacles.
  for (const [dx, dz] of [[-3.3, -3.3], [3.3, -3.3], [-3.3, 3.3], [3.3, 3.3]] as const) parts.push(box(STONE, 0.9, 2.6, 0.9, -11.6 + dx, 19.6, dz));
  for (const k of [-1.7, 0, 1.7]) {
    parts.push(box(STONE, 0.9, 1.1, 0.5, -11.6 + k, 19.6, 3.6), box(STONE, 0.9, 1.1, 0.5, -11.6 + k, 19.6, -3.6));
    parts.push(box(STONE, 0.5, 1.1, 0.9, -11.6 + 3.6, 19.6, k), box(STONE, 0.5, 1.1, 0.9, -11.6 - 3.6, 19.6, k));
  }
  for (const k of [-5, 0, 5]) parts.push(box(WINDOW, 1.4, 3.2, 0.3, 1 + k, 3, 4.55), box(WINDOW, 1.4, 3.2, 0.3, 1 + k, 3, -4.55));
  return parts;
}

/** The stepped gable of a Flemish house, its face in the yz plane at x, w wide (z), from y up `rise`. */
function steppedGable(color: string, w: number, rise: number, y: number, x: number, steps = 4) {
  const parts: Part[] = [];
  for (let k = 0; k < steps; k += 1) {
    const f0 = k / steps;
    const width = w * (1 - f0) + 0.2;
    parts.push(box(color, 0.5, rise / steps, width, x, y + (rise * k) / steps, 0));
  }
  parts.push(box(color, 0.5, 0.9, 0.9, x, y + rise, 0));
  return parts;
}

/** A tall brick house of Calais or Gravelines: steep tile roof, stepped gables at both ends, white-framed windows. 9 by 7 m. */
function gable(): Part[] {
  const parts: Part[] = [
    box(BRICK_DARK, 9.2, 2, 7.2, 0, -1.6),
    box(BRICK, 9, 7.2, 7, 0, 0.4),
    gableEnds(BRICK, 9, 7, 5.6, 7.6),
    roof(TILE, 9, 7, 5.6, 7.6, 0, 0, 0.15),
    ...steppedGable(BRICK, 7.3, 5.8, 7.6, 4.55),
    ...steppedGable(BRICK, 7.3, 5.8, 7.6, -4.55),
    box('#e8e2d4', 9.05, 0.35, 7.05, 0, 3.9),
    box(DOOR, 0.2, 2.2, 1.2, 4.55, 0.4, 1.4),
  ];
  for (const fy of [1.6, 5]) for (const fz of [-1.8, 1.8]) {
    if (fy < 2 && fz > 0) continue;
    parts.push(box('#e8e2d4', 0.18, 1.6, 1.2, 4.56, fy, fz), box(WINDOW, 0.2, 1.3, 0.9, 4.6, fy + 0.15, fz));
  }
  for (const fx of [-2.5, 0, 2.5]) parts.push(box(WINDOW, 1, 1.3, 0.2, fx, 5.1, 3.55), box(WINDOW, 1, 1.3, 0.2, fx, 5.1, -3.55));
  return parts;
}

/** A Flemish brick church: a long nave under dark tile, a west tower with a tall slate spire. 32 m long, 44 m to the cross. */
function spire(): Part[] {
  const parts: Part[] = [
    box(BRICK_DARK, 33, 2, 12.4, 1, -1.8),
    box(BRICK, 22, 10, 11, 2, 0),
    gableEnds(BRICK, 22, 11, 7, 10, 2),
    roof(SLATE, 22, 11, 7, 10, 2, 0, 0.3),
    box(BRICK, 8, 22, 8, -13, -1),
    box(BRICK_DARK, 8.6, 0.8, 8.6, -13, 20.4),
    finish(new ConeGeometry(5.4, 18, 8), SLATE, at(-13, 21 + 9, 0, Math.PI / 8)),
    box(TIMBER, 0.25, 2.4, 0.25, -13, 39, 0),
    box(TIMBER, 0.25, 0.25, 1.4, -13, 40.2, 0),
    box(DOOR, 0.3, 3.8, 2.2, -17.05, 0, 0),
  ];
  for (const k of [-6, -2, 2, 6]) parts.push(box(WINDOW, 1.6, 4.4, 0.3, 2 + k, 3.4, 5.55), box(WINDOW, 1.6, 4.4, 0.3, 2 + k, 3.4, -5.55));
  for (const [dx, dz] of [[-4.2, 0], [4.2, 0], [0, -4.2], [0, 4.2]] as const) parts.push(box(WINDOW, Math.abs(dz) ? 1.6 : 0.3, 4, Math.abs(dx) ? 1.6 : 0.3, -13 + dx, 14, dz));
  return parts;
}

/** A hedgerow: about 34 m of hawthorn and blackthorn scrub on a low bank, lumpy along its length, with a tree or two in it. */
function hedge(): Part[] {
  const parts: Part[] = [box('#5b5235', 34, 1.2, 3.2, 0, -0.6)];
  for (let k = 0; k < 7; k += 1) {
    const x = -15 + k * 5;
    const g = new IcosahedronGeometry(1, 1);
    parts.push(finish(g, k % 2 ? HEDGE : HEDGE_DARK, at(x, 1.7 + (k % 3) * 0.2, (k % 2 ? 0.2 : -0.2), k, 3.4, 1.6 + (k % 3) * 0.25, 1.5)));
  }
  // A standard oak left growing in the hedge.
  parts.push(finish(new CylinderGeometry(0.25, 0.4, 6, 5, 1, true), TIMBER, at(6, 3, 0)));
  parts.push(finish(new IcosahedronGeometry(1, 1), HEDGE, at(6, 8.5, 0, 0.4, 4.4, 3.4, 4.2)));
  return parts;
}

const BUILDERS: Record<EuropeanStructure, () => Part[]> = { cottage, tudor, church, gable, spire, hedge };

/** Footprint (m) of each kit along its longer side, as Structures' SIZE gives the Korean models'. */
export const EUROPE_SIZE: Record<EuropeanStructure, number> = { cottage: 13, tudor: 12.5, church: 31, gable: 9.4, spire: 33, hedge: 34 };

export const isEuropean = (type: string): type is EuropeanStructure => type in BUILDERS;

let material: Material | null = null;
const geometries = new Map<EuropeanStructure, BufferGeometry>();

/** The kit's merged geometry; built once a page and shared by every battle, like the Korean models' cache. */
export function europeKit(type: EuropeanStructure) {
  let geo = geometries.get(type);
  if (!geo) {
    geo = mergeGeometries(BUILDERS[type]())!;
    geo.computeBoundingBox();
    geometries.set(type, geo);
  }
  if (!material) {
    const m = new MeshStandardNodeMaterial();
    m.vertexColors = true;
    m.roughness = 0.9;
    m.metalness = 0;
    // The roofs and gables are single sheets.
    m.side = DoubleSide;
    material = m;
  }
  return { geometry: geo, material };
}

/** Triangles in a kit, for the budget test. */
export const kitTriangles = (type: EuropeanStructure) => europeKit(type).geometry.getAttribute('position').count / 3;
