import { BufferAttribute, BufferGeometry, Float32BufferAttribute, MeshBasicNodeMaterial, Uint8BufferAttribute, type Texture } from 'three/webgpu';
import { attribute, cameraPosition, float, instanceIndex, mix, normalGeometry, normalWorld, positionGeometry, positionLocal, positionWorld, sin, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { worldClock } from '../../select/terrain';
import { SKY_LIGHT, SUN_DIRECTION, SUN_LIGHT } from './groundPalette';

// The trees and rocks of the campaign world, the shapes every wood on the map is drawn with (worldTrees.ts round the
// camera, hero/trees.ts round the hero camps): a broadleaf tree, a fir of the high ground, the red pine of the Korean
// coasts and a granite boulder, each one unit tall (the boulder one across) and built twice, finely for the trees near
// the eye and lightly for the rest. A crown is one soft mass made of lumps of leaves, a sphere pushed out where each lump
// grows, shaded by its own smooth normals bent a little towards the whole crown's so it reads as one tree and not a
// heap of balls; trunks and branches show under and into it. The light is the land's (groundPalette.ts) worked per pixel,
// so a coarse shape still shades smooth, with the leaves' glow against the sun and the woodland texture as grain.

/** A colour written in sRGB as linear light. */
type RGB = readonly [number, number, number];
const lin = (r: number, g: number, b: number): RGB => [(r / 255) ** 2.2, (g / 255) ** 2.2, (b / 255) ** 2.2];
type V3 = [number, number, number];

/** How finely a shape is built: `near` for the trees close to the eye, `far` (about a quarter of the triangles) for the rest. */
export type TreeDetail = 'near' | 'far';

/** A cheap deterministic hash of a lattice point and a seed into 0..1. */
function hash3(x: number, y: number, z: number, seed: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1 over 3D space, one lattice cell a unit. */
function noise3(x: number, y: number, z: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const f = (t: number) => t * t * (3 - 2 * t);
  const fx = f(x - ix), fy = f(y - iy), fz = f(z - iz);
  const at = (a: number, b: number, c: number) => hash3(ix + a, iy + b, iz + c, seed);
  const x00 = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * fx, x10 = at(0, 1, 0) + (at(1, 1, 0) - at(0, 1, 0)) * fx;
  const x01 = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * fx, x11 = at(0, 1, 1) + (at(1, 1, 1) - at(0, 1, 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/** A geodesic sphere of unit radius: an icosahedron split `level` times, its points and triangles. Kept per level. */
const spheres = new Map<number, { p: V3[]; t: [number, number, number][] }>();
function geodesic(level: number) {
  let s = spheres.get(level);
  if (s) return s;
  const g = (1 + Math.sqrt(5)) / 2;
  const p: V3[] = [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]];
  let t: [number, number, number][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const unit = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  for (let i = 0; i < p.length; i += 1) p[i] = unit(p[i]!);
  for (let k = 0; k < level; k += 1) {
    const mid = new Map<string, number>();
    const half = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let m = mid.get(key);
      if (m === undefined) {
        const A = p[a]!, B = p[b]!;
        m = p.push(unit([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2])) - 1;
        mid.set(key, m);
      }
      return m;
    };
    t = t.flatMap(([a, b, c]) => {
      const ab = half(a, b), bc = half(b, c), ca = half(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] as [number, number, number][];
    });
  }
  s = { p, t };
  spheres.set(level, s);
  return s;
}

/**
 * A shape being built: positions, normals and colours, indexed. A colour is the surface's own (linear) with its
 * occlusion in, and in alpha how leafy it is (1 leaves, 0 wood or stone): the material softens the light on leaves,
 * lets the sun glow through them and sways them in the wind.
 */
class Shape {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly c: number[] = [];
  readonly i: number[] = [];

  vert(p: V3, n: V3, rgb: RGB, ao: number, leaf: number) {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0] / l, n[1] / l, n[2] / l);
    this.c.push(rgb[0] * ao, rgb[1] * ao, rgb[2] * ao, leaf);
    return this.p.length / 3 - 1;
  }

  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.n, 3));
    // Linear colours kept as square roots in a byte each, so the dark undersides keep their steps.
    g.setAttribute('color', new Uint8BufferAttribute(this.c.map((v, k) => Math.round(Math.min(1, k % 4 === 3 ? v : Math.sqrt(v)) * 255)), 4, true));
    g.setIndex(new BufferAttribute(Uint16Array.from(this.i), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** A lump of a crown: the direction it grows in from the crown's middle, its spread (radians) and how far it stands out. */
interface Lump { d: V3; spread: number; rise: number }

/** `n` lumps spread over the crown (a Fibonacci spiral), none underneath, each its own size: the same every build. */
function lumpsOf(n: number, seed: number, below = -0.55): Lump[] {
  const out: Lump[] = [];
  for (let k = 0; k < n; k += 1) {
    const y = 1 - ((k + 0.5) / n) * (1 - below);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = k * 2.39996 + hash3(k, 1, 2, seed) * 0.8;
    out.push({ d: [Math.cos(a) * r, y, Math.sin(a) * r], spread: 0.42 + hash3(k, 3, 4, seed) * 0.3, rise: 0.18 + hash3(k, 5, 6, seed) * 0.2 });
  }
  return out;
}

/**
 * A crown of leaves round `c` with radii `r`: a geodesic sphere of `level` pushed out in `lumps`, its underside flattened
 * by `flat`, a little noise on top so no lump is a perfect dome. Its normals are the surface's own, bent a fifth of the
 * way towards the ellipsoid's so the crown shades as one mass; it is darker underneath and in the hollows between lumps.
 */
function crown(s: Shape, c: V3, r: V3, level: number, lumps: Lump[], colour: RGB, seed: number, flat = 0.75) {
  const { p, t } = geodesic(level);
  const base = s.p.length / 3;
  const pos: V3[] = [], raise: number[] = [];
  for (const u of p) {
    let bump = 0;
    for (const l of lumps) {
      const cos = u[0] * l.d[0] + u[1] * l.d[1] + u[2] * l.d[2];
      const w = Math.max(0, (cos - Math.cos(l.spread)) / (1 - Math.cos(l.spread)));
      bump = Math.max(bump, l.rise * w * w * (3 - 2 * w));
    }
    const grain = (noise3(u[0] * 2.6 + 7, u[1] * 2.6, u[2] * 2.6, seed) - 0.5) * 0.12;
    const k = 0.8 + bump + grain;
    const y = u[1] < 0 ? u[1] * flat : u[1];
    pos.push([c[0] + u[0] * r[0] * k, c[1] + y * r[1] * k, c[2] + u[2] * r[2] * k]);
    raise.push(bump + grain);
  }
  // Smooth normals of the pushed-out surface, area weighted.
  const nrm = pos.map((): V3 => [0, 0, 0]);
  for (const [a, b, d] of t) {
    const A = pos[a]!, B = pos[b]!, D = pos[d]!;
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [D[0] - A[0], D[1] - A[1], D[2] - A[2]];
    const f: V3 = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    for (const v of [a, b, d]) for (let q = 0; q < 3; q += 1) nrm[v]![q]! += f[q]!;
  }
  pos.forEach((q, v) => {
    const u = p[v]!, g = nrm[v]!, gl = Math.hypot(g[0], g[1], g[2]) || 1;
    // The ellipsoid's own normal at this point of the sphere.
    const e: V3 = [u[0] / r[0], u[1] / r[1], u[2] / r[2]], el = Math.hypot(e[0], e[1], e[2]);
    const n: V3 = [g[0] / gl * 0.8 + e[0] / el * 0.2, g[1] / gl * 0.8 + e[1] / el * 0.2, g[2] / gl * 0.8 + e[2] / el * 0.2];
    const under = smooth(-0.9, 0.75, u[1]);
    const hollow = 0.58 + 0.42 * smooth(-0.03, 0.24, raise[v]!);
    const tint = 0.94 + noise3(u[0] * 1.7, u[1] * 1.7 + 3, u[2] * 1.7, seed + 9) * 0.12;
    s.vert(q, n, colour, (0.5 + 0.5 * under) * hollow * tint, 1);
  });
  for (const [a, b, d] of t) s.i.push(base + a, base + b, base + d);
}

function smooth(a: number, b: number, x: number) {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/**
 * A tube along `path` (trunk or branch): `sides` round, its radius at each point, rings turned along the path, the
 * colour of each ring; no caps (its ends are in the ground or the crown).
 */
function tube(s: Shape, path: V3[], radii: number[], sides: number, colours: RGB[], ao = 1) {
  const base = s.p.length / 3;
  for (let k = 0; k < path.length; k += 1) {
    const a = path[Math.max(0, k - 1)]!, b = path[Math.min(path.length - 1, k + 1)]!;
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const t: V3 = [d[0] / dl, d[1] / dl, d[2] / dl];
    // A side vector square to the path: from the world's x unless the path runs along it.
    const ref: V3 = Math.abs(t[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = norm(cross(ref, t)), v = cross(t, u);
    for (let j = 0; j < sides; j += 1) {
      const ang = (j / sides) * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
      const n: V3 = [u[0] * cs + v[0] * sn, u[1] * cs + v[1] * sn, u[2] * cs + v[2] * sn];
      const q = path[k]!, rr = radii[k]!;
      s.vert([q[0] + n[0] * rr, q[1] + n[1] * rr, q[2] + n[2] * rr], n, colours[k]!, ao, 0);
    }
  }
  for (let k = 0; k + 1 < path.length; k += 1) for (let j = 0; j < sides; j += 1) {
    const a = base + k * sides + j, b = base + k * sides + ((j + 1) % sides), c = a + sides, d = b + sides;
    s.i.push(a, c, b, b, c, d);
  }
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const BARK = lin(84, 66, 52);
const BARK_DARK = lin(58, 48, 40);
/** Summer leaves of the coast's oaks and zelkovas, a shade brighter than the land's woods, which the planted ones fade into. */
const LEAVES = lin(86, 128, 62);
const NEEDLES = lin(46, 86, 60);
const PINE_NEEDLES = lin(58, 98, 58);
const PINE_BARK_LOW = lin(92, 74, 62);
const PINE_BARK_HIGH = lin(138, 90, 68);

/**
 * A broadleaf tree: a stout trunk forking into the crown, the crown a broad mass of a dozen lumps (half as many, on a
 * coarser sphere, from afar).
 */
function broadleaf(detail: TreeDetail) {
  const s = new Shape(), near = detail === 'near';
  tube(s, [[0, -0.1, 0], [0.01, 0.22, 0], [0.02, 0.42, 0.01]], [0.055, 0.045, 0.034], near ? 6 : 4, [BARK_DARK, BARK, BARK]);
  if (near) for (const [x, z] of [[0.17, 0.05], [-0.13, 0.12], [-0.04, -0.17]] as const) tube(s, [[0.02, 0.38, 0.01], [x * 0.6, 0.52, z * 0.6], [x, 0.62, z]], [0.026, 0.018, 0.01], 4, [BARK, BARK, BARK]);
  crown(s, [0.01, 0.66, 0], [0.42, 0.32, 0.42], near ? 2 : 1, lumpsOf(near ? 9 : 6, 11), LEAVES, 11);
  return s.geometry();
}

/**
 * A fir of the high ground: a straight trunk under tiers of drooping boughs, each a ragged skirt whose tips hang down,
 * narrowing to a spire.
 */
function fir(detail: TreeDetail) {
  const s = new Shape(), near = detail === 'near';
  tube(s, [[0, -0.1, 0], [0, 0.35, 0]], [0.035, 0.026], near ? 5 : 3, [BARK_DARK, BARK]);
  const tiers = near ? [[0.1, 0.42, 0.34], [0.28, 0.6, 0.28], [0.45, 0.76, 0.22], [0.6, 0.9, 0.15], [0.74, 1.02, 0.09]] : [[0.12, 0.6, 0.33], [0.42, 0.85, 0.22], [0.66, 1.02, 0.12]];
  const seg = near ? 11 : 7;
  tiers.forEach(([y0, y1, r], tier) => {
    const base = s.p.length / 3;
    const apex = s.vert([0, y1!, 0], [0, 1, 0], NEEDLES, 1.05, 1);
    // A ring part way down where the bough is fullest, then the hanging tips.
    const rings = near ? [[0.5, 0.62], [1, 1]] : [[1, 1]];
    for (const [down, out] of rings) for (let j = 0; j < seg; j += 1) {
      const a = (j / seg) * Math.PI * 2 + tier * 0.7;
      const tip = out === 1 ? (j % 2 ? 0.82 : 1) : 1;
      const rr = r! * out! * tip;
      const y = y1! - (y1! - y0!) * Math.pow(down!, 1.15) - (out === 1 && tip === 1 ? 0.025 : 0);
      const slope = (r! * out!) / Math.max(0.05, y1! - y);
      const n: V3 = [Math.cos(a), slope * 0.9, Math.sin(a)];
      s.vert([Math.cos(a) * rr, y, Math.sin(a) * rr], n, NEEDLES, out === 1 ? 0.62 + 0.2 * (tier / tiers.length) : 0.86, 1);
    }
    for (let j = 0; j < seg; j += 1) s.i.push(apex, base + 1 + ((j + 1) % seg), base + 1 + j);
    if (near) for (let j = 0; j < seg; j += 1) {
      const a = base + 1 + j, b = base + 1 + ((j + 1) % seg), c = a + seg, d = b + seg;
      s.i.push(a, b, c, b, d, c);
    }
  });
  return s.geometry();
}

/**
 * The red pine of the Korean coasts: a slender trunk leaning and bending as it climbs, grey-brown at its foot and
 * flaking orange-red above, carrying a few broad flat pads of needles on its upper boughs, the highest the widest.
 */
function redPine(detail: TreeDetail) {
  const s = new Shape(), near = detail === 'near';
  const trunk: V3[] = [[0, -0.1, 0], [0.025, 0.2, 0.01], [0.075, 0.42, 0.02], [0.09, 0.6, 0.02], [0.07, 0.8, 0.01]];
  const shade = (k: number) => mixRGB(PINE_BARK_LOW, PINE_BARK_HIGH, smooth(0.15, 0.55, trunk[k]![1]));
  tube(s, near ? trunk : [trunk[0]!, trunk[2]!, trunk[4]!], near ? [0.04, 0.034, 0.028, 0.022, 0.016] : [0.04, 0.028, 0.016], near ? 5 : 3, (near ? [0, 1, 2, 3, 4] : [0, 2, 4]).map(shade));
  // Each pad a cluster of flat tufts: the crown's top, and two lower boughs reaching out either side.
  const pads: { at: V3; tufts: [V3, V3][] }[] = [
    { at: [0.06, 0.86, 0.01], tufts: [[[0.06, 0.88, 0.01], [0.17, 0.075, 0.15]], [[-0.07, 0.84, 0.09], [0.13, 0.065, 0.12]], [[0.17, 0.83, -0.08], [0.12, 0.06, 0.11]]] },
    { at: [-0.17, 0.7, 0.09], tufts: [[[-0.17, 0.71, 0.09], [0.12, 0.06, 0.11]], [[-0.27, 0.68, 0.02], [0.09, 0.05, 0.09]]] },
    { at: [0.27, 0.73, -0.07], tufts: [[[0.27, 0.74, -0.07], [0.11, 0.055, 0.1]], [[0.33, 0.71, 0.04], [0.08, 0.045, 0.08]]] },
  ];
  if (near) for (const { at: c } of pads.slice(1)) tube(s, [[0.085, 0.62, 0.02], [(0.085 + c[0]) / 2, (0.62 + c[1]) / 2 + 0.02, (0.02 + c[2]) / 2], c], [0.016, 0.011, 0.007], 4, [shade(3), shade(3), shade(3)]);
  pads.forEach(({ tufts }, k) => (near ? tufts : tufts.slice(0, k ? 1 : 2)).forEach(([c, r], j) => {
    crown(s, c, r, near && k === 0 ? 1 : 0, lumpsOf(near ? 5 : 3, 31 + k * 4 + j, -0.1), PINE_NEEDLES, 31 + k * 4 + j, 0.55);
  }));
  return s.geometry();
}

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const GRANITE = lin(160, 154, 142);

/**
 * A granite boulder one unit across and about half as high: a rounded block with a few flat faces where it split,
 * sunk into the ground at its foot, smooth normals so its faces turn softly into each other, darker in its hollows.
 */
function boulder(detail: TreeDetail) {
  const s = new Shape();
  const { p, t } = geodesic(detail === 'near' ? 2 : 1);
  const cuts: V3[] = [norm([0.8, 0.35, 0.3]), norm([-0.5, 0.45, 0.75]), norm([-0.35, 0.2, -0.9]), norm([0.1, 1, -0.15])];
  const pos = p.map((u): V3 => {
    const k = 1 + (noise3(u[0] * 1.6 + 3, u[1] * 1.6, u[2] * 1.6, 5) - 0.5) * 0.42 + (noise3(u[0] * 4.2, u[1] * 4.2 + 1, u[2] * 4.2, 6) - 0.5) * 0.1;
    let q: V3 = [u[0] * 0.5 * k, u[1] * 0.5 * k, u[2] * 0.5 * k];
    // Split faces: what stands out past a plane is pressed most of the way back onto it.
    for (const c of cuts) {
      const over = q[0] * c[0] + q[1] * c[1] + q[2] * c[2] - 0.36;
      if (over > 0) q = [q[0] - c[0] * over * 0.85, q[1] - c[1] * over * 0.85, q[2] - c[2] * over * 0.85];
    }
    // Squat, and its foot buried.
    const y = q[1] < -0.12 ? -0.12 + (q[1] + 0.12) * 0.3 : q[1];
    return [q[0], y * 0.95, q[2]];
  });
  const nrm = pos.map((): V3 => [0, 0, 0]);
  for (const [a, b, d] of t) {
    const A = pos[a]!, B = pos[b]!, D = pos[d]!;
    const f = cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [D[0] - A[0], D[1] - A[1], D[2] - A[2]]);
    for (const v of [a, b, d]) for (let q = 0; q < 3; q += 1) nrm[v]![q]! += f[q]!;
  }
  pos.forEach((q, v) => {
    const r = Math.hypot(q[0], q[1], q[2]);
    const ao = (0.62 + 0.38 * smooth(0.22, 0.48, r)) * (0.7 + 0.3 * smooth(-0.15, 0.2, q[1]));
    const tone = 0.9 + noise3(q[0] * 3 + 1, q[1] * 3, q[2] * 3, 8) * 0.2;
    s.vert(q, nrm[v]!, GRANITE, ao * tone, 0);
  });
  for (const [a, b, d] of t) s.i.push(a, b, d);
  return s.geometry();
}

/** The shapes by the kind a tree spot names: 0 broadleaf, 1 fir, 2 boulder, 3 red pine. */
export function treeShapes(detail: TreeDetail) {
  return [broadleaf(detail), fir(detail), boulder(detail), redPine(detail)];
}

/** The light from the south-west that keeps the shaded side of a crown from going flat, as the buildings have it. */
const FILL = (() => {
  const d = [-0.45, 0.3, 0.84], l = Math.hypot(d[0]!, d[1]!, d[2]!);
  return vec3(d[0]! / l, d[1]! / l, d[2]! / l);
})();

/** Each shape's own colour and leafiness (see Shape), the colour's square root undone. */
function surface() {
  const c: any = attribute('color', 'vec4');
  return { albedo: c.rgb.mul(c.rgb), leaf: c.a };
}

/**
 * A texture of the land as grain over a shape (triplanar in the shape's own space, so nothing stretches round a crown),
 * divided by its mean so it changes the shading and not the colour, `strength` deep.
 */
function grainOf(t: Texture, scale: number) {
  const p: any = positionGeometry, w0: any = normalGeometry.abs().pow(4);
  const w: any = w0.div(w0.x.add(w0.y).add(w0.z));
  const lum = (uv: any) => texture(t, uv).rgb.dot(vec3(0.3, 0.55, 0.15));
  const mean = texture(t, vec2(0.5, 0.5)).level(float(12)).rgb.dot(vec3(0.3, 0.55, 0.15)).max(0.02);
  return lum(p.zy.mul(scale)).mul(w.x).add(lum(p.xz.mul(scale).add(vec2(0.31, 0.57))).mul(w.y)).add(lum(p.xy.mul(scale).add(vec2(0.63, 0.17))).mul(w.z)).div(mean);
}

/**
 * The trees' material: their own colours under the land's sun and sky worked per pixel (leaves take the light softly
 * round their crown and glow when the eye looks towards the sun through them, wood and needles take it as it falls),
 * the woodland texture `leaves` as the grain of the leaves, each tree tinted by its instance colour; unlit like the land,
 * with its fog. The crowns sway in the wind by up to `sway` (in the units the trees stand in), each tree out of step
 * with the next; the trunks hardly at all.
 */
export function treeMaterial(leaves: Texture, sway: number) {
  const m = new MeshBasicNodeMaterial();
  const { albedo, leaf } = surface();
  const n: any = normalWorld, L = vec3(...SUN_DIRECTION);
  const ndl = n.dot(L);
  const sun = mix(ndl.max(0), ndl.add(0.45).div(1.45).clamp(0, 1).pow(1.35), leaf);
  const eye: any = cameraPosition.sub(positionWorld).normalize();
  // Light through the leaves at the crown's rim, towards an eye that looks into the sun.
  const rim = float(1).sub(n.dot(eye).abs()).pow(1.5);
  const through = eye.dot(L).negate().max(0).pow(3).mul(rim).mul(leaf).mul(0.55);
  const sky = n.y.mul(0.32).add(0.68).add(n.dot(FILL).max(0).mul(0.3));
  const light = vec3(...SUN_LIGHT).mul(sun.add(through)).add(vec3(...SKY_LIGHT).mul(sky));
  const grain = mix(float(1), grainOf(leaves, 3.4).pow(1.2).mul(0.7).add(0.3), leaf.mul(0.7));
  m.colorNode = albedo.mul(light).mul(grain);
  // Instancing has already placed the vertex (positionLocal); the bend grows up the shape's own height.
  const up: any = positionGeometry.y.max(0), clock: any = worldClock, phase = float(instanceIndex).mul(1.7);
  const bend = up.mul(up).mul(leaf.mul(0.8).add(0.2)).mul(sway);
  const sx: any = sin(clock.mul(1.1).add(phase)).mul(bend), sz: any = sin(clock.mul(0.8).add(phase.mul(1.3))).mul(bend.mul(0.6));
  m.positionNode = positionLocal.add(vec3(sx, 0, sz));
  return m;
}

/**
 * The rocks' material: granite in their own colour with the land's rock texture as grain, lichen and moss greening the
 * faces that look up, lit like the trees' wood; unlit like the land, with its fog.
 */
export function rockMaterial(rock: Texture) {
  const m = new MeshBasicNodeMaterial();
  const { albedo } = surface();
  const n: any = normalWorld, L = vec3(...SUN_DIRECTION);
  const sun = n.dot(L).max(0);
  const sky = n.y.mul(0.3).add(0.7).add(n.dot(FILL).max(0).mul(0.3));
  const light = vec3(...SUN_LIGHT).mul(sun).add(vec3(...SKY_LIGHT).mul(sky));
  const grain: any = grainOf(rock, 1.4);
  const moss = smoothstep(0.55, 0.9, n.y).mul(smoothstep(0.85, 1.15, grain)).mul(0.55);
  const colour = mix(albedo, albedo.mul(vec3(0.62, 0.72, 0.42)), moss);
  m.colorNode = colour.mul(light).mul(grain.pow(0.8).mul(0.7).add(0.3));
  return m;
}
