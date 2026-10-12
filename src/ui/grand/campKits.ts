import type { Ctx, Lod } from '../../ships/build/common';
import { MeshBuilder, Paint, box, cylinder, grid, paints, polygon, rotX, rotY, spike, sweep, xlate, type V3 } from '../../ships/build/parts';
import { gableRoof, irimoyaRoof, skirtRoof, type RoofPaints } from '../../ships/build/roofs';
import type { PieceKind } from './mapWorld';

// The buildings of every camp on the campaign map, built from the same parts and roof generators as the ships: mud and
// thatch, timber, stone and tiled roofs with curved eaves, colours in the vertices so a kind is one instanced draw with one
// material. Pure TS (no three.js), so the triangle budget and the shapes are tested in node.
//
// A kit is modelled in metres, then scaled so `span` metres become one unit: a piece stands on y = 0, its front looks
// along +z, and its footprint stays inside the unit square (a wall segment is one long on x and its outside is +z). The
// layer scales a unit to the piece's size in settlement radii. Each kind has two levels of detail: 0 for a close view,
// 1 the same silhouette with fewer segments for the strategic view.

export type KitLod = 0 | 1;

/** A kit's triangles: positions in units, normals and linear vertex colours, and the index. */
export interface KitMesh { position: Float32Array; normal: Float32Array; color: Float32Array; index: Uint32Array }

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** A flat vertex colour from an sRGB hex, `k` darkening or lightening it. */
function paint(hex: string, k = 1): Paint {
  const n = parseInt(hex.slice(1), 16);
  return new Paint(0, 1, 0, [linear(((n >> 16) & 255) / 255) * k, linear(((n >> 8) & 255) / 255) * k, linear((n & 255) / 255) * k]);
}

/** Box faces to leave out (parts' `box` mask): the bottom of anything standing on the ground, the top of a post under a roof. */
const BOTTOM = 4, TOP = 8;

/** Everything a builder needs: the mesh, the kit's level of detail and the roof generators' context at a given detail. */
class Kit {
  readonly b = new MeshBuilder();
  constructor(readonly lod: KitLod) {}
  get near() { return this.lod === 0; }
  /** The roofs' context: the ships' middle detail (fascia, soffit, ridges) close up, their far detail otherwise. */
  roof(lod: Lod = this.lod === 0 ? 1 : 2): Ctx {
    return { b: this.b, lod, faction: 'joseon', P: paints('joseon'), rnd: () => 0.5 };
  }
  block(p: Paint, min: V3, max: V3, skip = BOTTOM) { box(this.b, p, min, max, { skip }); }
  /** A square post from y0 to y1, its foot and head hidden in what it stands on and carries. */
  post(p: Paint, x: number, z: number, y0: number, y1: number, w: number) { this.block(p, [x - w / 2, y0, z - w / 2], [x + w / 2, y1, z + w / 2], BOTTOM | TOP); }
  /** A battered block: the foot `hxb` by `hzb` half sizes, the top `hxt` by `hzt`, sides sloping between (stone bases, ramparts). */
  batter(p: Paint, cx: number, cz: number, hxb: number, hzb: number, hxt: number, hzt: number, y0: number, y1: number) {
    const B = (sx: number, sz: number): V3 => [cx + sx * hxb, y0, cz + sz * hzb];
    const T = (sx: number, sz: number): V3 => [cx + sx * hxt, y1, cz + sz * hzt];
    const sides: [number, number, number, number, V3][] = [[-1, 1, 1, 1, [0, 0, 1]], [1, -1, -1, -1, [0, 0, -1]], [1, 1, 1, -1, [1, 0, 0]], [-1, -1, -1, 1, [-1, 0, 0]]];
    for (const [ax, az, bx, bz, out] of sides) this.b.quadF(p, [B(ax, az), B(bx, bz), T(bx, bz), T(ax, az)], out);
    this.b.quadF(p, [T(-1, -1), T(1, -1), T(1, 1), T(-1, 1)], [0, 1, 0]);
  }
  /** A flat panel facing `facing`: a door, a window, a loophole laid a few centimetres proud of its wall. */
  panel(p: Paint, pts: [V3, V3, V3, V3], facing: V3) { this.b.quadF(p, pts, facing); }
  /** A panel on the wall plane z = z (facing +z when `out` is 1, -z when -1), x0..x1 by y0..y1. */
  facade(p: Paint, z: number, out: 1 | -1, x0: number, x1: number, y0: number, y1: number) {
    this.panel(p, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, out]);
  }
  /** The same on a wall plane x = x. */
  side(p: Paint, x: number, out: 1 | -1, z0: number, z1: number, y0: number, y1: number) {
    this.panel(p, [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]], [out, 0, 0]);
  }
  /** Cloth seen from both sides: two panels back to back, so a single-sided material shows it from anywhere. */
  cloth(p: Paint, pts: [V3, V3, V3, V3], facing: V3) {
    this.panel(p, pts, facing);
    this.panel(p, pts, [-facing[0], -facing[1], -facing[2]]);
  }
  /** A round-headed opening on the plane z = z: a gate passage seen as a dark arch. */
  arch(p: Paint, z: number, out: 1 | -1, w: number, h: number) {
    const r = w / 2, n = this.near ? 6 : 3;
    const pts: V3[] = [[-r, -0.2, z], [r, -0.2, z]];
    for (let i = 0; i <= n; i += 1) {
      const a = (i / n) * Math.PI;
      pts.push([Math.cos(a) * r, h - r + Math.sin(a) * r, z]);
    }
    polygon(this.b, p, pts, [0, 0, out]);
  }
  /** A disc on a cloth or wall plane: a crest, a smoke vent. */
  disc(p: Paint, c: V3, r: number, facing: V3) {
    const n = this.near ? 8 : 5;
    const pts: V3[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const u = Math.cos(a) * r, v = Math.sin(a) * r;
      pts.push(Math.abs(facing[1]) > 0.5 ? [c[0] + u, c[1], c[2] + v] : Math.abs(facing[0]) > 0.5 ? [c[0], c[1] + v, c[2] + u] : [c[0] + u, c[1] + v, c[2]]);
    }
    polygon(this.b, p, pts, facing);
  }
  /** Run `fn` with everything it adds turned about the vertical axis by `angle` and moved to (x, y, z). */
  at(x: number, y: number, z: number, angle: number, fn: () => void) {
    this.b.with(xlate(x, y, z), () => this.b.with(rotY(angle), fn));
  }
}

// ---------- palettes ----------

const WOOD = paint('#6f5338'), WOOD_DARK = paint('#4a3726'), DOOR = paint('#3a2b20'), OPENING = paint('#221c18');
const EARTH = paint('#7a6648'), BRONZE = paint('#3d3a35');

/** A navy's look: walls, timber and the three paints of a tiled roof. */
interface Look { roof: RoofPaints; gable: Paint; post: Paint; wall: Paint; stone: Paint; base: Paint }
const JOSEON: Look = {
  // Grey clay tiles over green-painted rafter ends (dancheong), dark red-brown pillars, lime-washed walls.
  roof: { tile: paint('#42474d'), trim: paint('#3f6b5c'), cap: paint('#26292d') },
  gable: paint('#cfc4ac'), post: paint('#6a3b2b'), wall: paint('#e6dfcc'), stone: paint('#a49e91'), base: paint('#878276'),
};
const JAPAN: Look = {
  // Near-black tiles with white plastered eaves and gables over white plaster on a grey stone base.
  roof: { tile: paint('#34373d'), trim: paint('#e4ded0'), cap: paint('#25272b') },
  gable: paint('#f1ebde'), post: paint('#2e2a27'), wall: paint('#f1ebde'), stone: paint('#8e8a82'), base: paint('#77736b'),
};
const MING: Look = {
  // Grey-green glazed tiles with red-lacquered timber over grey brick.
  roof: { tile: paint('#5d7c6f'), trim: paint('#8f3529'), cap: paint('#455b52') },
  gable: paint('#9b3b2d'), post: paint('#9b3b2d'), wall: paint('#a63d2e'), stone: paint('#a29b8f'), base: paint('#7e786e'),
};

// ---------- shared pieces ----------

/** A small boat: a hull of U sections along z with a deck, `len` long and `beam` wide, its keel at y. */
function boat(k: Kit, hullP: Paint, deckP: Paint, x: number, y: number, z: number, len: number, beam: number, depth: number) {
  const n = 5;
  const hull: V3[][] = [], deck: V3[][] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const w = Math.max(0.08, (beam / 2) * Math.pow(Math.sin(Math.PI * t), 0.6));
    const zz = z - len / 2 + len * t, top = y + depth;
    hull.push([[x - w, top, zz], [x - w * 0.75, y + depth * 0.4, zz], [x, y, zz], [x + w * 0.75, y + depth * 0.4, zz], [x + w, top, zz]]);
    deck.push([[x - w, top, zz], [x + w, top, zz]]);
  }
  grid(k.b, hullP, hull, { flip: true });
  grid(k.b, deckP, deck);
}

/** A row of stakes along x with pointed heads, on an earth bank when `bank`: the palisade of the first camps. */
function stakes(k: Kit, bank: boolean, a: Paint, c: Paint) {
  const foot = bank ? 0.3 : -0.4;
  if (bank) k.batter(EARTH, 0, 0, 4, 1.5, 4, 0.75, -0.6, 0.5);
  if (!k.near) {
    k.block(a, [-4, foot, -0.26], [4, 2.5, 0.26]);
    return;
  }
  const n = 9;
  for (let i = 0; i < n; i += 1) {
    const x = -4 + (8 * (i + 0.5)) / n, h = 2.3 + ((i * 7) % 3) * 0.12, p = i % 2 ? a : c;
    k.block(p, [x - 0.3, foot, -0.26], [x + 0.3, h, 0.26]);
    spike(k.b, p, [x, h, 0], [0, 1, 0], 0.42, 0.45, 4);
  }
  // A rail along the inside binds the stakes.
  k.block(WOOD_DARK, [-4, 1.35, -0.46], [4, 1.6, -0.26], BOTTOM | 32);
}

/** Cannons on carriages at `xs`, muzzles out along +z through a rampart whose outer face is at z = face. */
function guns(k: Kit, xs: number[], deck: number, face: number) {
  for (const x of xs) {
    const y = deck + 1.1;
    if (k.near) {
      cylinder(k.b, BRONZE, [x, y, face - 2.6], [x, y, face + 0.35], 0.3, 0.25, 6, true);
      k.block(WOOD, [x - 0.45, deck, face - 2.7], [x + 0.45, y - 0.2, face - 1.2]);
    } else cylinder(k.b, BRONZE, [x, y, face - 2.2], [x, y, face + 0.35], 0.3, 0.25, 4, false);
  }
}

/** A gun platform: a battered stone or brick deck with a parapet cut by three embrasures facing +z. */
function battery(k: Kit, stone: Paint, top: Paint, w: number) {
  const deck = 1.0;
  k.batter(stone, 0, 0, w + 0.2, 4.2, w, 4.0, -0.8, deck);
  const xs = [-2.8, 0, 2.8];
  k.block(top, [-w, deck, 2.9], [w, deck + 0.75, 4.0]);
  if (k.near) {
    const edges = [-w, ...xs.flatMap((x) => [x - 0.65, x + 0.65]), w];
    for (let i = 0; i < edges.length; i += 2) k.block(top, [edges[i]!, deck + 0.75, 2.9], [edges[i + 1]!, deck + 1.6, 4.0]);
    for (const s of [-1, 1]) k.block(top, [s > 0 ? w - 0.8 : -w, deck, -2.0], [s > 0 ? w : -w + 0.8, deck + 1.1, 2.9]);
  }
  guns(k, xs, deck, 4.0);
}

/**
 * A boat shed or shipyard: a long gabled roof on two rows of posts over a slipway running down into the water at +z,
 * with a hull on the ways. `len` is the shed's length along z.
 */
function slipShed(k: Kit, look: Look, len: number, hull: boolean) {
  const half = len / 2;
  // The ways slope from the shore at -z into the water.
  k.b.with(rotX(0.09), () => k.block(WOOD_DARK, [-2.1, -0.2, -half - 1.2], [2.1, 0.15, half + 1.2], 0));
  if (hull && k.near) k.b.with(rotX(0.09), () => boat(k, WOOD, paint('#8d7150'), 0, 0.15, 0.6, len - 2.2, 3.4, 1.7));
  else if (hull) k.b.with(rotX(0.09), () => k.block(WOOD, [-1.4, 0.15, -half + 1.6], [1.4, 1.6, half - 0.6]));
  const rows = k.near ? Math.max(3, Math.round(len / 3.5)) : 0;
  for (let i = 0; i < rows; i += 1) {
    const z = -half + (len * i) / (rows - 1);
    for (const x of [-3.3, 3.3]) k.post(look.post, x, z, -0.8, 4.4, 0.36);
  }
  // The roof's ridge runs along the shed: the generator's x axis becomes -z here.
  k.at(0, 0, 0, Math.PI / 2, () => gableRoof(k.roof(), look.roof, look.gable, {
    cx: 0, wx: half, wz: 3.3, over: 0.7, y: 4.4, rise: 2.0, lift: 0.3, concave: 1.5, fascia: 0.3, seg: k.near ? [1, 6] : undefined,
  }));
}

/** A pier on posts running out to +z over the water. */
function pier(k: Kit, z0: number, z1: number) {
  // Far away the posts merge into one solid jetty.
  k.block(WOOD, [-1.25, k.near ? 0.9 : -0.6, z0], [1.25, 1.2, z1]);
  if (!k.near) return;
  const n = Math.max(2, Math.round((z1 - z0) / 3));
  for (let i = 0; i < n; i += 1) {
    const z = z0 + 0.8 + ((z1 - z0 - 1.6) * i) / (n - 1);
    for (const x of [-1.1, 1.1]) k.post(WOOD_DARK, x, z, -1.4, 0.9, 0.32);
  }
  for (const x of [-0.95, 0.95]) k.block(WOOD_DARK, [x - 0.2, 1.2, z1 - 0.7], [x + 0.2, 1.75, z1 - 0.3]);
}

/** A curved-eave hall on a stone base: pillars along the front, lattice doors, a hip-and-gable roof. */
function hall(k: Kit, look: Look, o: { hx: number; hz: number; bays: number; base: number; wallTop: number }) {
  const { hx, hz, base, wallTop } = o;
  k.batter(look.stone, 0, 0, hx + 1.0, hz + 1.0, hx + 0.8, hz + 0.8, -0.8, base);
  k.block(look.base, [-1.4, -0.8, hz + 0.8], [1.4, base - 0.35, hz + 1.6]);
  k.block(WOOD, [-hx - 0.3, base, -hz - 0.1], [hx + 0.3, base + 0.2, hz + 0.45]);
  k.block(look.wall, [-hx, base + 0.2, -hz], [hx, wallTop, hz - 0.3]);
  if (k.near) {
    const step = (2 * hx) / o.bays;
    for (let i = 0; i <= o.bays; i += 1) k.post(look.post, -hx + step * i, hz + 0.1, base + 0.2, wallTop + 0.2, 0.42);
    for (const x of [-hx, hx]) k.post(look.post, x, -hz - 0.05, base + 0.2, wallTop + 0.2, 0.42);
    for (let i = 0; i < o.bays; i += 1) {
      const x = -hx + step * (i + 0.5);
      k.facade(paint('#9a7a55'), hz - 0.26, 1, x - step * 0.36, x + step * 0.36, base + 0.45, wallTop - 0.45);
    }
    k.block(look.post, [-hx - 0.25, wallTop - 0.1, hz - 0.15], [hx + 0.25, wallTop + 0.3, hz + 0.35], 0);
  }
}

// ---------- Joseon ----------

/** A thatched hut: mud walls on a low stone footing under a rounded straw roof. */
function choga(k: Kit) {
  k.block(paint('#8d887c'), [-3.3, -0.6, -2.0], [3.3, 0.35, 2.0]);
  k.block(paint('#c8b38c'), [-3.0, 0.35, -1.7], [3.0, 2.3, 1.7], BOTTOM | TOP);
  if (k.near) {
    for (const x of [-3, 3]) for (const z of [-1.7, 1.7]) k.post(WOOD_DARK, x, z, 0.35, 2.3, 0.34);
    k.facade(DOOR, 1.74, 1, -1.7, -0.75, 0.4, 1.95);
    k.facade(paint('#e2d7bd'), 1.74, 1, 0.5, 1.55, 1.0, 1.75);
    k.facade(paint('#e2d7bd'), -1.74, -1, -0.6, 0.4, 1.0, 1.6);
    k.block(WOOD_DARK, [-3.1, 1.95, 1.7], [3.1, 2.15, 1.86], 16);
  }
  // The roof: a rounded mound of straw over a superellipse plan, thick at the eave, with a short ridge on top.
  const hx = 3.85, hz = 2.6, ridge = 1.6, n = 2.6, seg = k.near ? 16 : 8;
  const rows: [number, number, number][] = [[1.0, 1.95, 0.6], [1.03, 2.3, 0.8]];
  for (const t of k.near ? [0.38, 0.78, 1.14, 1.5] : [0.8, 1.5]) rows.push([Math.pow(Math.cos(t), 0.8), 2.3 + 1.6 * Math.sin(t), 0.9 + 0.1 * Math.sin(t)]);
  const ringAt = (r: number, y: number) => {
    const pts: V3[] = [];
    for (let j = 0; j <= seg; j += 1) {
      const a = (j / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const dx = Math.sign(c) * Math.pow(Math.abs(c), 2 / n), dz = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      pts.push([dx * (ridge + (hx - ridge) * r), y, dz * hz * r]);
    }
    return pts;
  };
  const straw = paint('#b39a63');
  const P = rows.map(([r, y]) => ringAt(r, y));
  grid(k.b, straw, P, { closedJ: true, shade: (i) => rows[i]![2] });
  const top = rows[rows.length - 1]!;
  polygon(k.b, straw, ringAt(top[0], top[1]).slice(0, seg), [0, 1, 0]);
  polygon(k.b, paint('#6b5a3b'), ringAt(1.0, 1.95).slice(0, seg), [0, -1, 0]);
}

/** A tiled house on a raised stone base: a gabled roof (matbae) over a pillared front. */
function giwa(k: Kit) {
  hall(k, JOSEON, { hx: 4.2, hz: 2.3, bays: 3, base: 0.8, wallTop: 3.3 });
  gableRoof(k.roof(), JOSEON.roof, JOSEON.gable, { cx: 0, wx: 4.7, wz: 2.6, over: 1.0, y: 3.5, rise: 2.0, lift: 0.5, concave: 1.7, fascia: 0.32, seg: k.near ? [2, 6] : undefined });
}

/** The commander's hall of a grown camp: a wider hall on a double base under a hip-and-gable roof (paljak). */
function greatHall(k: Kit) {
  k.batter(JOSEON.base, 0, 0, 7.6, 4.8, 7.4, 4.6, -0.8, 0.3);
  hall(k, JOSEON, { hx: 5.8, hz: 3.0, bays: 5, base: 1.2, wallTop: 4.4 });
  irimoyaRoof(k.roof(), JOSEON.roof, JOSEON.gable, {
    cx: 0, hx: 7.5, hz: 4.6, wx: 4.0, wz: 1.6, y: 4.6, skirt: 1.9, hafu: 0.6, gable: 1.5, lift: 0.65,
    seg: k.near ? { skirt: [2, 6], gable: [1, 4] } : undefined,
  });
}

/** A gatehouse: a stone gate storey with an arched passage and parapets, an open pavilion over it under a paljak roof. */
function fortGate(k: Kit) {
  const S = JOSEON.stone;
  k.block(S, [-7, -0.8, -3.2], [7, 4.2, 3.2]);
  for (const s of [1, -1] as const) k.arch(OPENING, s * 3.25, s, 3.2, 3.6);
  k.block(paint('#b7b0a2'), [-7, 4.2, 2.6], [7, 5.0, 3.2]);
  k.block(paint('#b7b0a2'), [-7, 4.2, -3.2], [7, 5.0, -2.6]);
  if (k.near) {
    for (const x of [-4.5, 0, 4.5]) k.facade(OPENING, 3.24, 1, x - 0.3, x + 0.3, 4.45, 4.8);
    k.block(WOOD, [-5, 4.2, -2.4], [5, 4.45, 2.4]);
    for (const z of [-2.0, 2.0]) for (const x of [-4.6, -1.55, 1.55, 4.6]) k.post(JOSEON.post, x, z, 4.45, 6.9, 0.4);
    for (const z of [-2.0, 2.0]) k.block(JOSEON.post, [-4.85, 6.6, z - 0.22], [4.85, 6.95, z + 0.22], 0);
  } else k.block(JOSEON.post, [-4.6, 4.2, -2.0], [4.6, 6.9, 2.0]);
  irimoyaRoof(k.roof(), JOSEON.roof, JOSEON.gable, {
    cx: 0, hx: 6.4, hz: 3.8, wx: 3.1, wz: 1.3, y: 6.95, skirt: 1.6, hafu: 0.5, gable: 1.3, lift: 0.6,
    seg: k.near ? { skirt: [2, 6], gable: [1, 4] } : undefined,
  });
}

/** A beacon mound: a round stone platform with five smoke chimneys in a row and a small flag. */
function bongsu(k: Kit) {
  const S = JOSEON.stone;
  cylinder(k.b, S, [0, -0.8, 0], [0, 2.6, 0], 3.1, 2.8, k.near ? 10 : 6, true);
  const vents = k.near ? [-1.8, -0.9, 0, 0.9, 1.8] : [0];
  for (const x of vents) {
    if (k.near) {
      k.block(paint('#b4ad9f'), [x - 0.34, 2.6, -0.34], [x + 0.34, 3.9, 0.34]);
      k.panel(paint('#2b2622'), [[x - 0.24, 3.91, -0.24], [x + 0.24, 3.91, -0.24], [x + 0.24, 3.91, 0.24], [x - 0.24, 3.91, 0.24]], [0, 1, 0]);
    } else k.block(paint('#b4ad9f'), [-2.15, 2.6, -0.34], [2.15, 3.9, 0.34]);
  }
  k.post(WOOD_DARK, 2.0, -1.6, 2.6, 6.0, 0.16);
  k.cloth(paint('#b8412f'), [[2.08, 4.9, -1.6], [3.3, 4.9, -1.6], [3.3, 5.9, -1.6], [2.08, 5.9, -1.6]], [0, 0, 1]);
}

/** A storehouse for powder and shot: thick stone walls under a hipped tiled roof. */
function magazine(k: Kit) {
  k.block(paint('#9d978a'), [-2.8, -0.6, -1.9], [2.8, 2.4, 1.9]);
  if (k.near) k.facade(DOOR, 1.94, 1, -0.6, 0.6, 0.2, 1.9);
  skirtRoof(k.roof(), JOSEON.roof, { cx: 0, hx: 3.6, hz: 2.7, ihx: 1.4, ihz: 0.06, y: 2.4, rise: 1.5, lift: 0.35, concave: 1.5, fascia: 0.3, seg: k.near ? [1, 4] : undefined });
  if (k.near) sweep(k.b, JOSEON.roof.cap, [[-1.7, 3.95, 0], [1.7, 3.95, 0]], [[-0.24, -0.12], [0.24, -0.12], [0.18, 0.2], [-0.18, 0.2]]);
}

/** The pier with a boat shed at its landward end: a hull under a small gabled roof. */
function dock(k: Kit) {
  pier(k, -1.4, 6.4);
  k.at(0, 0, -4.2, 0, () => {
    if (k.near) {
      for (const x of [-2.6, 2.6]) for (const z of [-2.0, 2.0]) k.post(WOOD_DARK, x, z, -1.0, 3.0, 0.32);
      boat(k, WOOD, paint('#8d7150'), 0, 0.1, 0, 4.4, 1.6, 0.8);
    }
    k.at(0, 0, 0, Math.PI / 2, () => gableRoof(k.roof(), JOSEON.roof, JOSEON.gable, { cx: 0, wx: 2.0, wz: 2.6, over: 0.5, y: 3.0, rise: 1.5, lift: 0.3, concave: 1.5, fascia: 0.25, seg: k.near ? [1, 4] : undefined }));
  });
}

// ---------- Japan ----------

/** A curtain camp's fence: white cloth between posts with dark bands and two crests, swaying a little. */
function waFence(k: Kit) {
  for (const x of k.near ? [-3.9, 0, 3.9] : [-3.9, 3.9]) k.post(paint('#2e2a27'), x, 0, -0.4, 2.55, 0.22);
  if (!k.near) {
    k.block(paint('#ebe4d2'), [-3.95, 0.5, -0.07], [3.95, 2.25, 0.07]);
    return;
  }
  const sway = (x: number) => 0.15 * Math.sin((2 * Math.PI * x) / 7.9);
  const cols = 8;
  const band = (p: Paint, y0: number, y1: number) => {
    const P: V3[][] = [[], []];
    for (let j = 0; j <= cols; j += 1) {
      const x = -3.95 + (7.9 * j) / cols;
      P[0]!.push([x, y0, sway(x)]);
      P[1]!.push([x, y1, sway(x)]);
    }
    grid(k.b, p, P, { flip: true });
    grid(k.b, p, P);
  };
  const navy = paint('#2c3650');
  band(navy, 0.5, 0.9);
  band(paint('#ebe4d2'), 0.9, 1.9);
  band(navy, 1.9, 2.25);
  for (const x of [-1.975, 1.975]) for (const s of [1, -1]) k.disc(navy, [x, 1.4, sway(x) + s * 0.03], 0.32, [0, 0, s]);
}

/** A cloth tent: two slopes on a ridge pole with a dark band along it and a doorway at the front end. */
function waTent(k: Kit) {
  const cloth = paint('#e8e0ca'), half = 2.4;
  const ridge = (x: number): V3 => [x, 2.5, 0];
  for (const s of [1, -1]) k.panel(cloth, [[-half, -0.3, s * 2.1], [half, -0.3, s * 2.1], ridge(half), ridge(-half)], [0, 0.6, s]);
  for (const s of [1, -1]) polygon(k.b, cloth, [[s * half, -0.3, -2.1], [s * half, -0.3, 2.1], ridge(s * half)], [s, 0, 0]);
  if (k.near) {
    polygon(k.b, paint('#3a4458'), [[half + 0.03, -0.3, -0.6], [half + 0.03, -0.3, 0.6], [half + 0.03, 1.4, 0]], [1, 0, 0]);
    sweep(k.b, paint('#2c3650'), [[-half - 0.15, 2.5, 0], [half + 0.15, 2.5, 0]], [[-0.18, -0.12], [0.18, -0.12], [0.18, 0.1], [-0.18, 0.1]]);
  }
}

/** A tall banner (nobori): a pole with a crossbar and a long red cloth with a white crest. */
function waBanner(k: Kit) {
  const x0 = -0.6;
  k.post(paint('#2b2118'), x0, 0, -0.3, 7.4, 0.14);
  k.block(paint('#2b2118'), [x0, 6.95, -0.06], [x0 + 1.3, 7.08, 0.06], 0);
  k.cloth(paint('#c0402d'), [[x0 + 0.1, 2.4, 0], [x0 + 1.25, 2.4, 0], [x0 + 1.25, 6.4, 0], [x0 + 0.1, 6.4, 0]], [0, 0, 1]);
  k.cloth(paint('#f0e9da'), [[x0 + 0.1, 6.4, 0], [x0 + 1.25, 6.4, 0], [x0 + 1.25, 6.95, 0], [x0 + 0.1, 6.95, 0]], [0, 0, 1]);
  if (k.near) for (const s of [1, -1]) k.disc(paint('#f0e9da'), [x0 + 0.68, 5.3, s * 0.03], 0.36, [0, 0, s]);
}

/** A stone-based plaster wall with a small tiled coping and loopholes on the outside. */
function waWall(k: Kit) {
  k.batter(JAPAN.stone, 0, 0, 4, 2.0, 4, 1.2, -0.8, 2.0);
  k.block(JAPAN.wall, [-4, 2.0, -0.5], [4, 3.5, 0.5]);
  if (k.near) for (const x of [-2.6, 0, 2.6]) k.facade(OPENING, 0.54, 1, x - 0.22, x + 0.22, 2.7, 3.1);
  // The coping is the far detail of the generator at either distance: a gable end at every segment would break the run.
  gableRoof(k.roof(2), JAPAN.roof, JAPAN.wall, { cx: 0, wx: 3.75, wz: 0.5, over: 0.25, y: 3.45, rise: 0.55, lift: 0, concave: 1.2, fascia: 0.1, seg: [1, k.near ? 2 : 1] });
}

/** A turret (yagura): a plaster box with a black-boarded foot on a battered stone base, under a hip-and-gable roof. */
function waTower(k: Kit) {
  k.batter(JAPAN.stone, 0, 0, 4.0, 4.0, 3.2, 3.2, -0.8, 2.4);
  k.block(JAPAN.wall, [-2.9, 2.4, -2.9], [2.9, 5.8, 2.9], BOTTOM | TOP);
  k.block(paint('#2b2a2a'), [-2.95, 2.4, -2.95], [2.95, 3.4, 2.95]);
  if (k.near) {
    for (const s of [1, -1] as const) {
      k.facade(OPENING, s * 2.94, s, -0.7, 0.7, 4.2, 5.0);
      k.side(OPENING, s * 2.94, s, -0.7, 0.7, 4.2, 5.0);
    }
  }
  irimoyaRoof(k.roof(), JAPAN.roof, JAPAN.gable, {
    cx: 0, hx: 4.2, hz: 4.2, wx: 2.0, wz: 1.5, y: 5.8, skirt: 1.3, hafu: 0.5, gable: 1.2, lift: 0.35,
    seg: k.near ? { skirt: [2, 6], gable: [1, 4] } : undefined,
  });
}

/** A turret gate (yagura-mon): dark gates between two stone bases carrying a plaster gallery under one roof. */
function waGate(k: Kit) {
  for (const s of [-1, 1]) k.batter(JAPAN.stone, s * 4.3, 0, 2.2, 3.2, 1.8, 2.8, -0.8, 2.8);
  k.block(DOOR, [-2.2, -0.4, -0.6], [2.2, 2.8, 0.6]);
  k.block(JAPAN.wall, [-6.0, 2.8, -2.7], [6.0, 5.4, 2.7], TOP);
  k.block(paint('#2b2a2a'), [-6.05, 2.8, -2.75], [6.05, 3.6, 2.75]);
  if (k.near) for (const s of [1, -1] as const) for (const x of [-3.4, 0, 3.4]) k.facade(OPENING, s * 2.74, s, x - 0.55, x + 0.55, 4.1, 4.8);
  irimoyaRoof(k.roof(), JAPAN.roof, JAPAN.gable, {
    cx: 0, hx: 7.0, hz: 3.9, wx: 4.6, wz: 1.4, y: 5.4, skirt: 1.2, hafu: 0.45, gable: 1.1, lift: 0.3,
    seg: k.near ? { skirt: [2, 6], gable: [1, 4] } : undefined,
  });
}

/** A keep (tenshu): white tiers stepping in on a battered stone base, a skirt roof between tiers, a hip-and-gable crown. */
function waKeep(k: Kit, tiers: [number, number, number][]) {
  k.batter(JAPAN.stone, 0, 0, tiers[0]![0] / 2 + 1.3, tiers[0]![1] / 2 + 1.3, tiers[0]![0] / 2 + 0.35, tiers[0]![1] / 2 + 0.35, -0.8, 3.2);
  let y = 3.2;
  tiers.forEach(([w, d, h], i) => {
    const hx = w / 2, hz = d / 2, top = y + h;
    k.block(JAPAN.wall, [-hx, y - 0.3, -hz], [hx, top, hz], BOTTOM | TOP);
    if (k.near) for (const s of [1, -1] as const) k.facade(OPENING, s * (hz + 0.04), s, -w * 0.18, w * 0.18, top - 1.35, top - 0.65);
    const eave = { cx: 0, hx: hx + 1.0, hz: hz + 1.0, y: top - 0.05, lift: 0.3 };
    const next = tiers[i + 1];
    if (next) {
      skirtRoof(k.roof(), JAPAN.roof, { ...eave, ihx: next[0] / 2, ihz: next[1] / 2, rise: 1.0, concave: 1.5, fascia: 0.3, seg: [1, 3], hips: false });
      y = eave.y + 1.0;
      return;
    }
    const crown = irimoyaRoof(k.roof(), JAPAN.roof, JAPAN.gable, {
      ...eave, wx: hx * 0.62, wz: hz * 0.42, skirt: 1.0, hafu: 0.4, gable: 1.1,
      seg: { skirt: [1, 3], gable: [1, 2] },
    });
    if (k.near) for (const s of [-1, 1]) k.block(paint('#c9a23a'), [s * crown.ridgeX - 0.18, crown.ridgeY, -0.12], [s * crown.ridgeX + 0.18, crown.ridgeY + 0.55, 0.12]);
  });
}

// ---------- Ming ----------

/** A grey brick wall segment on a stone plinth, merlons along its outer edge. */
function mgBrick(k: Kit) {
  k.batter(MING.base, 0, 0, 4.02, 1.75, 4.02, 1.62, -0.8, 0.5);
  k.batter(MING.stone, 0, 0, 3.98, 1.52, 3.98, 1.32, 0.5, 3.2);
  if (k.near) {
    for (let i = 0; i < 4; i += 1) {
      const x = -4 + 1 + i * 2;
      k.block(paint('#b0a99c'), [x - 0.65, 3.2, 0.82], [x + 0.65, 4.2, 1.32]);
    }
    k.block(paint('#b0a99c'), [-3.98, 3.2, -1.32], [3.98, 3.6, -1.08]);
  } else k.block(paint('#b0a99c'), [-3.98, 3.2, 0.82], [3.98, 4.0, 1.32]);
}

/** A wooden watch tower on four legs: a railed platform under a small pyramid roof, a red and a yellow flag. */
function mgWatch(k: Kit) {
  const wood = paint('#86663f');
  for (const x of [-2, 2]) for (const z of [-2, 2]) k.post(WOOD, x, z, -0.4, 5.6, 0.36);
  k.block(wood, [-2.6, 5.6, -2.6], [2.6, 5.9, 2.6], 0);
  if (k.near) {
    k.block(WOOD_DARK, [-2.1, 2.6, -2.1], [2.1, 2.85, 2.1], 0);
    for (const s of [-1, 1]) {
      k.block(wood, [-2.5, 5.9, s * 2.5 - 0.06], [2.5, 6.7, s * 2.5 + 0.06]);
      k.block(wood, [s * 2.5 - 0.06, 5.9, -2.44], [s * 2.5 + 0.06, 6.7, 2.44]);
    }
    for (const x of [-2.3, 2.3]) for (const z of [-2.3, 2.3]) k.post(MING.post, x, z, 5.9, 8.0, 0.24);
    k.post(WOOD_DARK, 2.45, 2.45, 6.7, 9.6, 0.12);
    k.cloth(paint('#c8372d'), [[2.5, 8.6, 2.45], [3.4, 8.6, 2.45], [3.4, 9.5, 2.45], [2.5, 9.5, 2.45]], [0, 0, 1]);
    k.post(WOOD_DARK, -2.45, 2.45, 6.7, 9.6, 0.12);
    k.cloth(paint('#e2b23a'), [[-2.4, 8.6, 2.45], [-1.5, 8.6, 2.45], [-1.5, 9.5, 2.45], [-2.4, 9.5, 2.45]], [0, 0, 1]);
  } else k.block(MING.post, [-2.3, 5.9, -2.3], [2.3, 8.0, 2.3]);
  skirtRoof(k.roof(), MING.roof, { cx: 0, hx: 3.3, hz: 3.3, ihx: 0.25, ihz: 0.25, y: 8.0, rise: 1.6, lift: 0.3, concave: 1.4, fascia: 0.25, seg: k.near ? [1, 4] : undefined });
  k.block(MING.roof.cap, [-0.32, 9.5, -0.32], [0.32, 10.1, 0.32]);
}

/** A square flag on a tall pole: yellow with a red border. */
function mgFlag(k: Kit) {
  const x0 = -0.9;
  k.post(paint('#3a2a20'), x0, 0, -0.3, 7.0, 0.16);
  if (!k.near) {
    k.cloth(paint('#e3b43a'), [[x0 + 0.08, 4.4, 0], [x0 + 1.9, 4.4, 0], [x0 + 1.9, 6.6, 0], [x0 + 0.08, 6.6, 0]], [0, 0, 1]);
    return;
  }
  k.cloth(paint('#c8372d'), [[x0 + 0.08, 4.4, 0], [x0 + 1.9, 4.4, 0], [x0 + 1.9, 6.6, 0], [x0 + 0.08, 6.6, 0]], [0, 0, 1]);
  for (const s of [1, -1]) k.panel(paint('#e3b43a'), [[x0 + 0.35, 4.65, s * 0.04], [x0 + 1.65, 4.65, s * 0.04], [x0 + 1.65, 6.35, s * 0.04], [x0 + 0.35, 6.35, s * 0.04]], [0, 0, s]);
}

/** Merlons round the top of a brick block `h` half wide, `n` a side. */
function merlons(k: Kit, h: number, y: number, n: number, sides: number[]) {
  if (!k.near) return;
  const p = paint('#b0a99c');
  for (const side of sides) {
    for (let i = 0; i < n; i += 1) {
      const t = -h + ((2 * h) * (i + 0.5)) / n, w = Math.min(0.75, h / n);
      const a: V3 = [t - w, y, h - 0.5], b: V3 = [t + w, y + 0.9, h];
      k.at(0, 0, 0, (side * Math.PI) / 2, () => k.block(p, a, b));
    }
  }
}

/** A gate tower: a brick gate block with an arched passage, merlons, and a red pavilion under a hip-and-gable roof. */
function mgGate(k: Kit) {
  k.block(MING.base, [-6.55, -0.8, -3.65], [6.55, 0.6, 3.65]);
  k.block(MING.stone, [-6.5, 0.6, -3.6], [6.5, 4.6, 3.6], BOTTOM);
  for (const s of [1, -1] as const) k.arch(OPENING, s * 3.7, s, 3.0, 3.6);
  if (k.near) for (const s of [1, -1]) for (let i = 0; i < 3; i += 1) {
    const x = -4.6 + i * 4.6;
    k.block(paint('#b0a99c'), [x - 0.8, 4.6, s > 0 ? 3.1 : -3.6], [x + 0.8, 5.4, s > 0 ? 3.6 : -3.1]);
  }
  k.block(MING.wall, [-4.3, 4.6, -2.3], [4.3, 7.0, 2.3], BOTTOM | TOP);
  if (k.near) for (const s of [1, -1] as const) for (const x of [-2.4, 0, 2.4]) k.facade(paint('#5a2a20'), s * 2.34, s, x - 0.7, x + 0.7, 5.0, 6.5);
  irimoyaRoof(k.roof(), MING.roof, MING.gable, {
    cx: 0, hx: 5.8, hz: 3.7, wx: 3.2, wz: 1.3, y: 7.0, skirt: 1.5, hafu: 0.5, gable: 1.3, lift: 0.45,
    seg: k.near ? { skirt: [2, 6], gable: [1, 4] } : undefined,
  });
}

/** A corner tower: a brick bastion with merlons and a small red pavilion under a pyramid roof. */
function mgCorner(k: Kit) {
  k.block(MING.base, [-3.75, -0.8, -3.75], [3.75, 0.6, 3.75]);
  k.block(MING.stone, [-3.65, 0.6, -3.65], [3.65, 4.6, 3.65], BOTTOM);
  merlons(k, 3.65, 4.6, 2, [0, 1, 2, 3]);
  k.block(MING.wall, [-1.8, 4.6, -1.8], [1.8, 6.4, 1.8], BOTTOM | TOP);
  skirtRoof(k.roof(), MING.roof, { cx: 0, hx: 2.9, hz: 2.9, ihx: 0.25, ihz: 0.25, y: 6.4, rise: 1.5, lift: 0.35, concave: 1.4, fascia: 0.25, seg: k.near ? [1, 4] : undefined });
  k.block(MING.roof.cap, [-0.32, 7.85, -0.32], [0.32, 8.4, 0.32]);
}

/** A brick beacon tower with merlons at its corners and a fire burning on top. */
function mgBeacon(k: Kit) {
  k.batter(MING.stone, 0, 0, 2.4, 2.4, 1.85, 1.85, -0.8, 6.6);
  if (k.near) for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.block(paint('#b0a99c'), [sx * 1.85 - (sx > 0 ? 0.6 : 0), 6.6, sz * 1.85 - (sz > 0 ? 0.6 : 0)], [sx * 1.85 + (sx < 0 ? 0.6 : 0), 7.4, sz * 1.85 + (sz < 0 ? 0.6 : 0)]);
  k.block(paint('#3a3430'), [-0.6, 6.6, -0.6], [0.6, 7.2, 0.6], BOTTOM);
  // A low orange flame with a taller yellow tongue standing out of it.
  spike(k.b, paint('#f07a26'), [0, 7.2, 0], [0, 1, 0], 0.55, 0.9, k.near ? 5 : 4);
  if (k.near) spike(k.b, paint('#ffd04a'), [0, 7.2, 0], [0, 1, 0], 0.28, 1.3, 4);
}

// ---------- the catalogue ----------

/** Each kind's builder and the metres one unit stands for. */
const KITS: Record<PieceKind, { span: number; build: (k: Kit) => void }> = {
  palisade: { span: 8, build: (k) => stakes(k, true, paint('#7a5c3e'), paint('#6a4f35')) },
  stone: {
    span: 8,
    build: (k) => {
      k.batter(JOSEON.base, 0, 0, 4.02, 1.62, 4.02, 1.5, -0.8, 0.6);
      k.batter(JOSEON.stone, 0, 0, 4.0, 1.45, 4.0, 1.15, 0.6, 3.4);
      if (!k.near) {
        k.block(paint('#bab3a4'), [-4, 3.4, 0.6], [4, 4.3, 1.15]);
        return;
      }
      for (const x of [-2.67, 0, 2.67]) {
        k.block(paint('#bab3a4'), [x - 1.2, 3.4, 0.6], [x + 1.2, 4.4, 1.15]);
        k.facade(OPENING, 1.19, 1, x - 0.2, x + 0.2, 3.7, 4.05);
      }
    },
  },
  choga: { span: 8.6, build: choga },
  giwa: { span: 12.6, build: giwa },
  hall: { span: 16, build: greatHall },
  fortgate: { span: 14.4, build: fortGate },
  bongsu: { span: 7, build: bongsu },
  battery: { span: 12.4, build: (k) => battery(k, JOSEON.stone, paint('#b4ad9f'), 5.8) },
  magazine: { span: 8, build: magazine },
  dock: { span: 14, build: dock },
  shipyard: { span: 19, build: (k) => slipShed(k, JOSEON, 13, true) },
  pier: { span: 13, build: (k) => pier(k, -6, 6) },
  wa_fence: { span: 8, build: waFence },
  wa_tent: { span: 5.6, build: waTent },
  wa_banner: { span: 2.8, build: waBanner },
  wa_wall: { span: 8, build: waWall },
  wa_gate: { span: 14.2, build: waGate },
  wa_tower: { span: 8.6, build: waTower },
  wa_keep3: { span: 12.8, build: (k) => waKeep(k, [[9.2, 7.2, 3.0], [6.8, 5.2, 2.6], [4.8, 3.6, 2.6]]) },
  wa_keep4: { span: 13.2, build: (k) => waKeep(k, [[9.6, 7.6, 3.0], [7.6, 5.8, 2.6], [5.8, 4.4, 2.4], [4.2, 3.2, 2.4]]) },
  wa_yard: { span: 19, build: (k) => slipShed(k, JAPAN, 13, true) },
  mg_palisade: { span: 8, build: (k) => stakes(k, false, paint('#7a5a3a'), paint('#8c6b45')) },
  mg_watch: { span: 7.4, build: mgWatch },
  mg_flag: { span: 3.8, build: mgFlag },
  mg_brick: { span: 8, build: mgBrick },
  mg_gate: { span: 13.6, build: mgGate },
  mg_corner: { span: 7.6, build: mgCorner },
  mg_platform: { span: 12.4, build: (k) => battery(k, MING.stone, paint('#b0a99c'), 5.8) },
  mg_beacon: { span: 5, build: mgBeacon },
  mg_yard: { span: 19, build: (k) => slipShed(k, MING, 13, true) },
};

/** Every kind a camp is built from. */
export const KIT_KINDS = Object.keys(KITS) as PieceKind[];

/** The triangles of one kind at one level of detail, scaled so the kit's span is one unit. */
export function buildCampKit(kind: PieceKind, lod: KitLod): KitMesh {
  const { span, build } = KITS[kind];
  const kit = new Kit(lod);
  build(kit);
  const data = kit.b.data();
  const position = data.position;
  for (let i = 0; i < position.length; i += 1) position[i] = position[i]! / span;
  return { position, normal: data.normal, color: data.color, index: data.index };
}
