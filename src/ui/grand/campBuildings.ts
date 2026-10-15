import { MeshBuilder, compose, cloth, cylinder, polygon, rectSection, rotX, rotY, spike, sweep, xlate, type MeshData, type Paint, type V3 } from '../../ships/build/parts';
import { bakeGrime } from '../../ships/build/bake';
import { bannerPaint, buildingPaints } from './buildingAtlas';
import { METRES_PER_RADIUS, navyOf, WALL_KINDS, WALL_METRES, WATER_KINDS, type PieceKind } from './campPieces';
import { batter, block, column, face, NY, PY, picture, pictureX, post, rect, roof, surface, thatch, walls, type Kit, type RoofLook } from './kitParts';

// Every building of the campaign map's settlements, made the way the battle's ships are (src/ships/build): modular
// procedural parts mapped onto the navy's building atlas (buildingAtlas.json), occlusion baked into the vertices on a
// voxel grid of the close model with the ground under it, two levels of detail. Joseon camps grow from a log stockade
// to a granite fortress with a gate pavilion and a commander's hall, Japanese ones from a curtained field camp to a
// walled castle with a white keep, Ming ones from a stockade to a brick fort with a red gate tower; the works stand
// round them, and every port has its Korean town of thatched and tiled houses inside stone garden walls.
//
// A kit is modelled in metres with its front towards +z and stands on y = 0 (a stone base or skirt reaches below, so it
// never floats on a slope); the result is in settlement radii, a wall's length in units of its whole run.

/** The close model (index 0) and the far one (1): the same outlines with fewer segments and no small parts. */
export type KitLod = 0 | 1;

// ---------- looks ----------

const koreanRoof = (k: Kit, official = false): RoofLook => ({
  tile: k.P('giwa'), edge: k.P('giwa', { tint: [0.72, 0.72, 0.75] }), under: official ? k.P('dancheong') : k.P('timber', { tint: [1.15, 1.1, 1.05] }),
  ridge: k.P('ridge'), gable: official ? k.P('dancheong', { tint: [0.9, 0.9, 0.9] }) : k.P('plaster', { tint: [0.95, 0.93, 0.9] }), ends: 'curl',
});
const japaneseRoof = (k: Kit): RoofLook => ({
  tile: k.P('kawara'), edge: k.P('kawara', { tint: [0.8, 0.8, 0.83] }), under: k.P('plaster', { tint: [0.9, 0.9, 0.9] }),
  ridge: k.P('ridge'), gable: k.P('plaster'), ends: 'fish', end: k.P('gold'),
});
const mingRoof = (k: Kit, glazed = false): RoofLook => ({
  tile: k.P(glazed ? 'glazed' : 'tiles'), edge: k.P(glazed ? 'glazed' : 'tiles', { tint: [0.74, 0.72, 0.7] }), under: k.P('beam'),
  ridge: k.P('ridge', glazed ? { tint: [1.08, 0.98, 0.78] } : {}), gable: k.P('lacquer'), ends: 'hook',
});
/** Openings read as shadow: the timber cell darkened almost to black. */
const shadow = (k: Kit) => k.P('timber', { tint: [0.13, 0.12, 0.11] });

/** Runs `fn` turned by `angle` about the vertical and moved to (x, y, z). */
const at = (k: Kit, x: number, y: number, z: number, angle: number, fn: () => void) => k.b.with(compose(xlate(x, y, z), rotY(angle)), fn);

// ---------- shared parts ----------

/** A gabled tile coping along x from x0 to x1 on a wall top at y, spanning z0..z1, `h` high. */
function coping(k: Kit, tile: Paint, end: Paint, x0: number, x1: number, y: number, z0: number, z1: number, h: number) {
  const zm = (z0 + z1) / 2, s = Math.hypot(h, (z1 - z0) / 2);
  face(k, tile, [[x0, y, z1], [x1, y, z1], [x1, y + h, zm], [x0, y + h, zm]], [0, 1, 1], [[x0, 0], [x1, 0], [x1, s], [x0, s]]);
  face(k, tile, [[x1, y, z0], [x0, y, z0], [x0, y + h, zm], [x1, y + h, zm]], [0, 1, -1], [[-x1, 0], [-x0, 0], [-x0, s], [-x1, s]]);
  if (k.near) for (const x of [x0, x1]) polygon(k.b, end, [[x, y, z0], [x, y, z1], [x, y + h, zm]], [x === x0 ? -1 : 1, 0, 0], (q) => end.map(q[2], q[1]));
}

/**
 * Battlements along x from x0 to x1 on a wall top at y, between z0 (inside) and z1 (outside): a low continuous parapet
 * with `n` merlons rising from it, each with a tile coping when `cap` is given and a loophole facing +z. Far away it is
 * one band.
 */
function crenels(k: Kit, body: Paint, cap: Paint | null, x0: number, x1: number, y: number, z0: number, z1: number, n: number, o: { base: number; top: number; gap: number; hole?: boolean }) {
  if (!k.near) {
    block(k, body, [x0, y - 0.05, z0], [x1, y + o.top, z1]);
    if (cap) coping(k, cap, body, x0, x1, y + o.top, z0 - 0.12, z1 + 0.12, 0.26);
    return;
  }
  block(k, body, [x0, y - 0.05, z0], [x1, y + o.base, z1]);
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i += 1) {
    const a = x0 + i * w + o.gap / 2, b = x0 + (i + 1) * w - o.gap / 2;
    block(k, body, [a, y + o.base, z0], [b, y + o.top, z1]);
    if (cap) coping(k, cap, body, a - 0.08, b + 0.08, y + o.top, z0 - 0.12, z1 + 0.12, 0.26);
    if (o.hole) picture(k, shadow(k), (a + b) / 2 - 0.17, (a + b) / 2 + 0.17, y + o.base + 0.18, y + o.base + 0.5, z1, 1);
  }
}

/** A wall segment WALL_METRES long along x: its outer face (+z) battered from `outFoot` to `outTop`, its inner face plumb. */
function rampart(k: Kit, p: Paint, top: Paint, y: number, outFoot: number, outTop: number, inner: number) {
  const L = WALL_METRES / 2, foot = -2.4, s = Math.hypot(y - foot, outFoot - outTop);
  face(k, p, [[-L, foot, outFoot], [L, foot, outFoot], [L, y, outTop], [-L, y, outTop]], [0, 0.2, 1], [[-L, 0], [L, 0], [L, s], [-L, s]]);
  face(k, p, [[L, foot, inner], [-L, foot, inner], [-L, y, inner], [L, y, inner]], [0, 0, -1], [[-L, 0], [L, 0], [L, y - foot], [-L, y - foot]]);
  face(k, top, [[-L, y, outTop], [L, y, outTop], [L, y, inner], [-L, y, inner]], [0, 1, 0], [[-L, outTop], [L, outTop], [L, inner], [-L, inner]]);
  // The ends show where the ring opens for a gate or stops at the shore.
  for (const sx of [-1, 1]) face(k, p, [[sx * L, foot, inner], [sx * L, foot, outFoot], [sx * L, y, outTop], [sx * L, y, inner]], [sx, 0, 0], [[inner, 0], [outFoot, 0], [outTop, y - foot], [inner, y - foot]]);
}

/** A cannon on its carriage at (x, y), its muzzle at z, firing along +z; far away just the barrel. */
function cannon(k: Kit, x: number, y: number, z: number, carriage: Paint, bronze: Paint) {
  if (!k.near) {
    cylinder(k.b, bronze, [x, y + 0.6, z - 2.6], [x, y + 0.6, z + 0.15], 0.34, 0.26, 3, false);
    return;
  }
  block(k, carriage, [x - 0.45, y, z - 2.5], [x + 0.45, y + 0.55, z - 0.9]);
  cylinder(k.b, bronze, [x, y + 0.82, z - 2.6], [x, y + 0.82, z + 0.15], 0.3, 0.22, 7, true);
}

/** A flagpole at x with a banner flying towards +x from its top, both faces of the cloth drawn. */
function banner(k: Kit, pole: Paint, cloth_: Paint, x: number, height: number, w: number, h: number) {
  column(k, pole, x, 0, 0.09, 0.07, -0.5, height, k.near ? 6 : 4, true);
  if (k.near) spike(k.b, pole, [x, height, 0], [0, 1, 0], 0.13, 0.42, 4);
  cloth(k.b, cloth_, [x + 0.07, height - 0.25, 0], [w, 0, 0], [0, -h, 0], { nu: k.near ? 3 : 1, nv: 1, wave: k.near ? 0.12 : 0 });
}

/** A tall Japanese nobori: a pole with an arm across its top and the long cloth hanging from both, `s` times its usual size. */
function nobori(k: Kit, pole: Paint, cloth_: Paint, x: number, s = 1) {
  column(k, pole, x, 0, 0.08 * s, 0.06 * s, -0.5, 7.6 * s, k.near ? 6 : 4, true);
  block(k, pole, [x, 7.2 * s, -0.05 * s], [x + 1.02 * s, 7.32 * s, 0.05 * s], 0);
  cloth(k.b, cloth_, [x + 0.08 * s, 7.2 * s, 0], [0.9 * s, 0, 0], [0, -4.6 * s, 0], { nu: 1, nv: k.near ? 3 : 1, wave: k.near ? 0.07 * s : 0 });
}

/**
 * The standard of the navy that holds a place: a tall pole on a stone foot flying a great flag of the navy's colour, a
 * size larger than a camp's own banners, so whose the place is reads from across a bay.
 */
function standard(k: Kit, flag: Paint, foot: Paint) {
  const timber = k.P('timber');
  batter(k, foot, foot, -1.9, 0, 0.65, 0.65, 0.5, 0.5, -1.4, 0.5);
  column(k, timber, -1.9, 0, 0.19, 0.13, 0.3, 16, k.near ? 6 : 4, true);
  if (k.near) spike(k.b, timber, [-1.9, 16, 0], [0, 1, 0], 0.22, 0.7, 4);
  cloth(k.b, flag, [-1.75, 15.6, 0], [4.4, 0, 0], [0, -3.3, 0], { nu: k.near ? 5 : 1, nv: 1, wave: k.near ? 0.3 : 0 });
}

/** A stake of a stockade from below the ground to `h`, `w` thick, sharpened to a point when `point`. */
function stake(k: Kit, p: Paint, x: number, w: number, h: number, point: boolean) {
  post(k, p, x, 0, w, -0.6, h);
  const r = w / 2;
  if (!point) { block(k, p, [x - r, h, -r], [x + r, h + 0.01, r], NY); return; }
  const tip: V3 = [x, h + w * 0.9, 0];
  const c: V3[] = [[x - r, h, r], [x + r, h, r], [x + r, h, -r], [x - r, h, -r]];
  for (let i = 0; i < 4; i += 1) {
    const a = c[i]!, b = c[(i + 1) % 4]!;
    polygon(k.b, p, [a, b, tip], [(a[0] + b[0]) / 2 - x, 0.5, (a[2] + b[2]) / 2], (q) => p.map(q[0] + q[2], q[1]));
  }
}

/**
 * A hull on the stocks: keel, ribs bent from it and a few strakes, `len` long and `beam` wide, its keel at y on a slip
 * that sinks `drop` metres from bow (+z) to stern. `flat` widens the floor (a junk's) and `square` the ends.
 */
function hullFrame(k: Kit, timber: Paint, plank: Paint, len: number, beam: number, depth: number, y: number, drop: number, o: { flat?: number; square?: number } = {}) {
  const yAt = (z: number) => y - (z / len) * drop;
  const half = (z: number) => (beam / 2) * Math.pow(Math.max(0.02, 1 - Math.pow(Math.abs(z) / (len / 2), 2 + (o.square ?? 0) * 4)), 0.5);
  block(k, timber, [-0.22, yAt(0) - 0.25, -len / 2], [0.22, yAt(0) + 0.15, len / 2], NY);
  const ribs = k.near ? 7 : 3;
  for (let i = 0; i < ribs; i += 1) {
    const z = -len * 0.4 + (len * 0.8 * i) / (ribs - 1), w = half(z), f = (o.flat ?? 0.15) * w, b = yAt(z);
    const path: V3[] = [[-w, b + depth, z], [-w * 0.92, b + depth * 0.45, z], [-f, b + 0.05, z], [f, b + 0.05, z], [w * 0.92, b + depth * 0.45, z], [w, b + depth, z]];
    sweep(k.b, timber, path, rectSection(0.22, 0.26), { caps: true });
  }
  if (!k.near) return;
  // The first strakes along the bilge, both sides.
  for (const sx of [-1, 1]) {
    const path: V3[] = [];
    for (let i = 0; i <= 6; i += 1) {
      const z = -len * 0.46 + (len * 0.92 * i) / 6;
      path.push([sx * half(z) * 0.86, yAt(z) + depth * 0.3, z]);
    }
    sweep(k.b, plank, path, rectSection(0.1, 0.7), { caps: true, up: [sx, 0.4, 0] });
  }
}

/**
 * A shipyard: a timber slipway running from the shore (-z) down into the water (+z) with a hull on the stocks, a shed
 * for the shipwrights on the shore beside it, timber stacked by the shed.
 */
function yard(k: Kit, look: RoofLook, shed: Paint, hull: { beam: number; depth: number; flat?: number; square?: number }) {
  const planks = k.P('planks'), timber = k.P('timber');
  // The slipway: its deck sinks from 0.7 m on the shore to under the water at its seaward end.
  const top = (z: number) => 0.7 - ((z + 10.5) / 21) * 2.2;
  face(k, planks, [[-1.8, top(10.5), 10.5], [2.6, top(10.5), 10.5], [2.6, top(-10.5), -10.5], [-1.8, top(-10.5), -10.5]], [0, 1, 0], [[-1.8, 10.5], [2.6, 10.5], [2.6, -10.5], [-1.8, -10.5]]);
  for (const sx of [-1.8, 2.6]) face(k, planks, [[sx, -2.6, -10.5], [sx, -2.6, 10.5], [sx, top(10.5), 10.5], [sx, top(-10.5), -10.5]], [sx < 0 ? -1 : 1, 0, 0], [[-10.5, -2.6], [10.5, -2.6], [10.5, top(10.5)], [-10.5, top(-10.5)]]);
  face(k, planks, [[2.6, -2.6, -10.5], [-1.8, -2.6, -10.5], [-1.8, top(-10.5), -10.5], [2.6, top(-10.5), -10.5]], [0, 0, -1]);
  at(k, 0.4, 0, -0.5, 0, () => hullFrame(k, timber, planks, 15, hull.beam, hull.depth, top(-0.5) + 0.3, 2.2 * (15 / 21), hull));
  // The shed on the shore: posts under a gabled roof whose ridge runs along the slip.
  const posts: [number, number][] = [[-5.6, -10], [-3.2, -10], [-5.6, -5.5], [-3.2, -5.5], [-5.6, -1], [-3.2, -1]];
  if (k.near) for (const [x, z] of posts) post(k, timber, x, z, 0.3, -1.2, 3.8);
  else block(k, shed, [-5.5, -1.2, -10], [-3.3, 3.8, -1], NY | PY);
  at(k, -4.4, 0, -5.5, Math.PI / 2, () => roof(k, look, { ex: 5.6, ez: 2.4, y: 3.85, top: 5.6, form: 'gable', lift: 0.25, sag: 1.2, edge: 0.25, overhang: 1.2, verge: 0.4, ridgeW: 0.42, ridgeH: 0.36, rows: 2, cols: 4, trims: false }));
  // Timber waiting by the shed.
  for (let i = 0; i < (k.near ? 3 : 1); i += 1) cylinder(k.b, timber, [-6.6 + i * 0.55, 0.25 + (i === 2 ? 0.45 : 0), -9.5], [-6.6 + i * 0.55, 0.25 + (i === 2 ? 0.45 : 0), -3.5], 0.28, 0.28, k.near ? 6 : 4, true);
}

/** A dock: a pier on posts out over the water from a stone landing, a boathouse on the shore end with the navy's roof. */
function dock(k: Kit, look: RoofLook, wall: Paint, stone: Paint, door: Paint) {
  const planks = k.P('planks'), timber = k.P('timber');
  // A stone landing on the shore, the pier running on from it.
  batter(k, stone, stone, 0, -1.5, 2.6, 2.6, 2.4, 2.4, -2.4, 1.15);
  block(k, planks, [-1.7, 0.85, 1.0], [1.7, 1.12, 9.0], 0);
  if (k.near) {
    for (let z = 2.4; z <= 8.6; z += 2.05) for (const sx of [-1, 1]) post(k, timber, sx * 1.5, z, 0.34, -2.4, 0.85);
    for (const sx of [-1, 1]) post(k, timber, sx * 1.25, 8.5, 0.3, 1.12, 1.8);
  } else block(k, timber, [-1.45, -2.4, 1.2], [1.45, 0.85, 8.8], NY | PY);
  // The boathouse, on the shore behind the landing.
  walls(k, wall, rect(-2.8, -8.6, 2.8, -4.4), -0.8, 2.9);
  if (k.near) picture(k, door, -1.3, 1.3, 0, 2.3, -4.4, 1);
  at(k, 0, 0, -6.5, 0, () => roof(k, look, { ex: 3.7, ez: 3.0, y: 2.95, top: 4.9, form: 'gable', lift: 0.25, sag: 1.2, edge: 0.25, overhang: 0.9, verge: 0.45, ridgeW: 0.4, ridgeH: 0.35, rows: 2, cols: 4, trims: false }));
}

// ---------- Joseon ----------

/**
 * A Korean timber-framed body on a granite base: walls between pillars, lintel beams under the eaves, doors along the
 * front and windows at the back, a step up to the front.
 */
function hanok(k: Kit, o: { hx: number; hz: number; base: number; top: number; bays: number; wall: Paint; pillar: Paint; beam: Paint; plinth: Paint }) {
  const { hx, hz, base, top } = o;
  batter(k, o.plinth, o.plinth, 0, 0, hx + 0.85, hz + 0.85, hx + 0.7, hz + 0.7, -1.8, base);
  walls(k, o.wall, rect(-hx, -hz, hx, hz), base, top);
  block(k, o.plinth, [-1.2, -0.4, hz + 0.7], [1.2, base * 0.55, hz + 1.25]);
  if (!k.near) return;
  const step = (2 * hx) / o.bays;
  for (let i = 0; i <= o.bays; i += 1) for (const sz of [1, -1]) post(k, o.pillar, -hx + step * i, sz * hz, 0.34, base, top);
  for (const sx of [1, -1]) post(k, o.pillar, sx * hx, 0, 0.34, base, top);
  for (const sz of [1, -1]) block(k, o.beam, [-hx - 0.2, top - 0.42, sz * hz - 0.2], [hx + 0.2, top, sz * hz + 0.2], PY);
  for (const sx of [1, -1]) block(k, o.beam, [sx * hx - 0.2, top - 0.42, -hz], [sx * hx + 0.2, top, hz], PY);
  const door = k.P('door');
  for (let i = 0; i < o.bays; i += 1) {
    const x0 = -hx + step * i + 0.28, x1 = -hx + step * (i + 1) - 0.28;
    picture(k, door, x0, x1, base + 0.2, top - 0.62, hz, 1);
    if (i % 2 === 0) picture(k, door, x0 + step * 0.18, x1 - step * 0.18, base + 1.0, top - 0.75, -hz, -1);
  }
}

/** A thatched house: earth walls framed in timber on a field-stone footing, a narrow porch along the front, a rounded straw roof. */
function choga(k: Kit) {
  const stone = k.P('fieldstone'), timber = k.P('timber');
  batter(k, stone, stone, 0, 0, 4.0, 2.55, 3.85, 2.4, -1.6, 0.35);
  walls(k, k.P('mud', { tint: [0.92, 0.84, 0.74] }), rect(-3.5, -2.05, 3.5, 2.05), 0.35, 2.6);
  if (k.near) {
    for (const x of [-3.5, -1.2, 1.2, 3.5]) for (const sz of [1, -1]) post(k, timber, x, sz * 2.05, 0.3, 0.35, 2.6);
    for (const sz of [1, -1]) block(k, timber, [-3.65, 2.27, sz * 2.05 - 0.17], [3.65, 2.6, sz * 2.05 + 0.17], PY);
    picture(k, k.P('door'), -3.05, -1.55, 0.4, 2.1, 2.05, 1);
    picture(k, k.P('door'), 0.15, 1.05, 1.0, 1.95, 2.05, 1);
    picture(k, k.P('door'), 1.55, 2.95, 0.4, 2.1, 2.05, 1);
    picture(k, k.P('door'), -0.6, 0.6, 1.0, 1.9, -2.05, -1);
    block(k, k.P('planks'), [-3.3, 0.3, 2.05], [3.3, 0.62, 2.75]);
  }
  thatch(k, k.P('thatch', { tint: [0.8, 0.72, 0.58] }), timber, 4.3, 2.85, 2.62, 4.3, { ridge: 1.6, eave: 0.3 });
}

/** A tiled house: a three-bay hanok under a hip-and-gable roof. */
function giwa(k: Kit) {
  hanok(k, { hx: 4.8, hz: 2.5, base: 0.6, top: 3.4, bays: 3, wall: k.P('plaster'), pillar: k.P('timber'), beam: k.P('timber'), plinth: k.P('granite') });
  roof(k, koreanRoof(k), { ex: 6.3, ez: 4.0, y: 3.45, top: 6.7, form: 'hipgable', gableAt: 0.5, lift: 0.75, sag: 1.5, edge: 0.32, overhang: 1.5, ridgeW: 0.6, ridgeH: 0.5, rows: 3, cols: 6 });
}

/** The commander's hall (dongheon): a five-bay hall behind a row of red columns on a two-step granite terrace. */
function hall(k: Kit) {
  const granite = k.P('granite'), pillar = k.P('pillar', { tint: [0.82, 0.74, 0.7] });
  batter(k, granite, granite, 0, 0, 10.2, 6.6, 10.0, 6.4, -1.8, 0.55);
  block(k, granite, [-9.0, 0.5, -5.5], [9.0, 1.3, 5.5]);
  block(k, granite, [-1.8, -0.4, 6.4], [1.8, 0.35, 6.9]);
  block(k, granite, [-1.8, 0.4, 5.5], [1.8, 0.95, 6.1]);
  walls(k, k.P('plaster'), rect(-7.4, -3.8, 7.4, 3.8), 1.3, 5.6);
  const bays = 5, step = 14.8 / bays;
  for (let i = 0; i <= bays; i += 1) column(k, pillar, -7.4 + step * i, 4.75, 0.34, 0.3, 1.3, 5.6, k.near ? 8 : 4);
  if (k.near) {
    for (let i = 0; i <= bays; i += 1) post(k, pillar, -7.4 + step * i, -3.8, 0.38, 1.3, 5.6);
    for (const sx of [1, -1]) post(k, pillar, sx * 7.4, 0, 0.38, 1.3, 5.6);
    for (let i = 0; i < bays; i += 1) picture(k, k.P('door'), -7.4 + step * i + 0.25, -7.4 + step * (i + 1) - 0.25, 1.45, 4.85, 3.8, 1);
    for (let i = 1; i < bays; i += 2) picture(k, k.P('door'), -7.4 + step * i + 0.6, -7.4 + step * (i + 1) - 0.6, 2.4, 4.6, -3.8, -1);
  }
  block(k, k.P('dancheong'), [-7.75, 5.0, -4.15], [7.75, 5.65, 5.1], PY);
  roof(k, koreanRoof(k, true), { ex: 10.3, ez: 6.5, y: 5.7, top: 10.6, form: 'hipgable', gableAt: 0.5, lift: 1.15, sag: 1.55, edge: 0.42, overhang: 2.4, ridgeW: 0.85, ridgeH: 0.7, rows: 3, cols: 8 });
}

/** A gatehouse (mullu): a granite gate with an arched passage and studded doors, battlements, and a pavilion over it. */
function fortGate(k: Kit) {
  const granite = k.P('granite'), plaster = k.P('plaster'), pillar = k.P('pillar', { tint: [0.82, 0.74, 0.7] });
  const W = 7.0, D = 4.2, H = 6.2, a = 2.0, spring = 2.5;
  arched(k, granite, k.P('gate'), W, D, H, a, spring);
  for (const sz of [1, -1]) at(k, 0, 0, 0, sz > 0 ? 0 : Math.PI, () => crenels(k, plaster, k.P('giwa', { tint: [0.85, 0.85, 0.88] }), -W, W, H, D - 0.5, D, 4, { base: 0.5, top: 1.2, gap: 0.5, hole: true }));
  // The pavilion: a planked floor, red columns, a railing and painted beams under a hip-and-gable roof.
  block(k, k.P('planks'), [-5.6, H, -3.0], [5.6, H + 0.32, 3.0]);
  const cols = [-5.0, -1.7, 1.7, 5.0];
  for (const x of cols) for (const z of [-2.5, 2.5]) column(k, pillar, x, z, 0.3, 0.27, H + 0.32, H + 3.6, k.near ? 8 : 4);
  if (k.near) {
    for (const sz of [1, -1]) block(k, pillar, [-5.0, H + 0.32, sz * 2.5 - 0.06], [5.0, H + 1.15, sz * 2.5 + 0.06], 0);
    for (const sx of [1, -1]) block(k, pillar, [sx * 5.0 - 0.06, H + 0.32, -2.5], [sx * 5.0 + 0.06, H + 1.15, 2.5], 0);
  }
  block(k, k.P('dancheong'), [-5.3, H + 3.1, -2.8], [5.3, H + 3.65, 2.8], PY);
  roof(k, koreanRoof(k, true), { ex: 7.2, ez: 4.6, y: H + 3.7, top: H + 7.4, form: 'hipgable', gableAt: 0.5, lift: 1.0, sag: 1.5, edge: 0.38, overhang: 2.0, ridgeW: 0.75, ridgeH: 0.62, rows: 3, cols: 7 });
}

/**
 * A gate block 2W by 2D by H with an arched passage `a` either side of its axis, springing at `spring`: two piers, the
 * vault, the masonry over it and the closed doors inside. Far away one block with the arch drawn dark on both faces.
 */
function arched(k: Kit, stone: Paint, gate: Paint, W: number, D: number, H: number, a: number, spring: number) {
  const crown = spring + a;
  if (!k.near) {
    block(k, stone, [-W, -2.2, -D], [W, H, D]);
    const arch: V3[] = [[-a, 0, 0], [a, 0, 0]];
    for (let i = 0; i <= 4; i += 1) arch.push([Math.cos((i / 4) * Math.PI) * a, spring + Math.sin((i / 4) * Math.PI) * a, 0]);
    const dark = gate.tinted([0.3, 0.27, 0.25]);
    for (const sz of [1, -1]) polygon(k.b, dark, arch.map((q): V3 => [q[0], q[1], sz * (D + 0.03)]), [0, 0, sz], (q) => dark.map(0.5 + q[0] / (2 * a), q[1] / crown));
    return;
  }
  block(k, stone, [-W, -2.2, -D], [-a, H, D]);
  block(k, stone, [a, -2.2, -D], [W, H, D]);
  block(k, stone, [-a, crown, -D], [a, H, D], NY);
  const n = 6;
  const arc = Array.from({ length: n + 1 }, (_, i): [number, number] => [-Math.cos((i / n) * Math.PI) * a, spring + Math.sin((i / n) * Math.PI) * a]);
  const vault = stone.tinted([0.62, 0.6, 0.58]);
  surface(k, vault, arc.map(([x, y]): V3[] => [[x, y, -D], [x, y, D]]), [0, -1, 0], (i, j) => [i * ((Math.PI * a) / n), j * 2 * D]);
  // The masonry between the arch and the block over it, both faces; at the crown a piece closes to a triangle.
  for (const sz of [1, -1]) for (let i = 0; i < n; i += 1) {
    const [x0, y0] = arc[i]!, [x1, y1] = arc[i + 1]!;
    const pts: V3[] = [[x0, y0, sz * D], [x1, y1, sz * D], [x1, crown, sz * D], [x0, crown, sz * D]].filter((q, j, all) => j === 0 || Math.hypot(q[0] - all[j - 1]![0], q[1] - all[j - 1]![1]) > 1e-6) as V3[];
    polygon(k.b, stone, pts, [0, 0, sz], (q) => stone.map(q[0] * sz, q[1]));
  }
  for (const sz of [1, -1]) picture(k, gate, -a, a, 0, crown - 0.05, sz * 0.6, sz as 1 | -1);
}

/** A stretch of granite wall with the white crenellated parapet (yeojang) along its outer edge. */
function stoneWall(k: Kit) {
  const granite = k.P('granite');
  rampart(k, granite, granite.tinted([1.06, 1.05, 1.02]), 4.4, 1.75, 1.1, -1.5);
  crenels(k, k.P('plaster'), k.P('giwa', { tint: [0.85, 0.85, 0.88] }), -WALL_METRES / 2, WALL_METRES / 2, 4.4, 0.6, 1.1, 3, { base: 0.55, top: 1.3, gap: 0.45, hole: true });
}

/** A stretch of log stockade on an earth bank, the stakes sharpened, a rail along the inside. */
function palisade(k: Kit) {
  const L = WALL_METRES / 2, logs = k.P('logs');
  const earth = k.P('mud', { tint: [0.58, 0.5, 0.42] });
  batter(k, earth, earth, 0, 0, L, 1.8, L, 0.85, -1.8, 0.55);
  if (k.near) {
    const n = 12, pitch = WALL_METRES / n;
    for (let i = 0; i < n; i += 1) stake(k, logs, -L + (i + 0.5) * pitch, 0.74, 3.5 + [0, 0.3, -0.15][i % 3]!, true);
    block(k, k.P('timber'), [-L, 2.2, -0.62], [L, 2.5, -0.37]);
    return;
  }
  block(k, logs, [-L, -0.4, -0.32], [L, 3.5, 0.32], NY | PY);
  for (let i = 0; i < 6; i += 1) {
    const x0 = -L + (i * WALL_METRES) / 6, x1 = x0 + WALL_METRES / 6;
    for (const sz of [1, -1]) polygon(k.b, logs, [[x0, 3.5, sz * 0.32], [x1, 3.5, sz * 0.32], [(x0 + x1) / 2, 4.1, 0]], [0, 0.4, sz], (q) => logs.map(q[0], q[1]));
  }
}

/** The stockade's gate: two great posts with a lintel and studded doors under a small gabled roof, on the bank. */
function joGate(k: Kit) {
  const logs = k.P('logs'), timber = k.P('timber');
  const earth = k.P('mud', { tint: [0.58, 0.5, 0.42] });
  batter(k, earth, earth, 0, 0, 3.4, 1.8, 3.4, 0.85, -1.8, 0.55);
  for (const sx of [1, -1]) post(k, logs, sx * 2.55, 0, 0.74, -0.6, 6.0);
  if (k.near) block(k, timber, [-3.05, 4.6, -0.42], [3.05, 5.15, 0.42]);
  block(k, timber, [-2.18, 0.5, -0.3], [2.18, 4.6, 0.3], NY | PY);
  if (k.near) for (const sz of [1, -1] as const) picture(k, k.P('gate'), -2.18, 2.18, 0.5, 4.6, sz * 0.3, sz);
  roof(k, koreanRoof(k), { ex: 3.35, ez: 1.45, y: 5.65, top: 6.85, form: 'gable', lift: 0.35, sag: 1.25, edge: 0.25, overhang: 1.0, verge: 0.35, ridgeW: 0.4, ridgeH: 0.36, rows: 2, cols: 4, trims: false });
}

/** The powder store: thick field-stone walls on a granite base, an iron-studded door, a hipped tile roof. */
function magazine(k: Kit) {
  const granite = k.P('granite');
  batter(k, granite, granite, 0, 0, 3.6, 3.0, 3.45, 2.85, -1.8, 0.35);
  walls(k, k.P('fieldstone'), rect(-3.0, -2.4, 3.0, 2.4), 0.35, 3.1);
  if (k.near) picture(k, k.P('gate'), -0.75, 0.75, 0.35, 2.4, 2.4, 1);
  roof(k, koreanRoof(k), { ex: 3.9, ez: 3.3, y: 3.15, top: 5.3, form: 'hip', lift: 0.45, sag: 1.4, edge: 0.3, overhang: 0.9, ridgeW: 0.5, ridgeH: 0.42, rows: 2, cols: 4 });
}

/** A watchtower (mangnu): four timber legs, a planked platform with a railing, a pyramid roof, a ladder. */
function joTower(k: Kit) {
  const timber = k.P('timber'), planks = k.P('planks');
  for (const sx of [1, -1]) for (const sz of [1, -1]) post(k, timber, sx * 1.9, sz * 1.9, 0.4, -0.8, 8.75);
  block(k, planks, [-2.5, 6.0, -2.5], [2.5, 6.35, 2.5], 0);
  if (k.near) {
    for (const s of [1, -1]) {
      block(k, timber, [-1.9, 3.3, s * 1.9 - 0.12], [1.9, 3.55, s * 1.9 + 0.12], 0);
      block(k, timber, [s * 1.9 - 0.12, 3.3, -1.9], [s * 1.9 + 0.12, 3.55, 1.9], 0);
      block(k, timber, [-2.5, 6.35, s * 2.45 - 0.05], [2.5, 7.2, s * 2.45 + 0.05], 0);
      block(k, timber, [s * 2.45 - 0.05, 6.35, -2.4], [s * 2.45 + 0.05, 7.2, 2.4], 0);
    }
    k.b.with(compose(xlate(0, 0, 3.3), rotX(-0.15)), () => block(k, planks, [-0.35, -0.3, -0.05], [0.35, 6.4, 0.05], 0));
  }
  roof(k, koreanRoof(k), { ex: 3.0, ez: 3.0, y: 8.8, top: 10.5, form: 'pyramid', lift: 0.55, sag: 1.3, edge: 0.26, overhang: 1.1, ridgeW: 0.45, ridgeH: 0.4, rows: 2, cols: 3 });
}

/** Two military banners, the navy's blue and the south's red, on tall poles. */
function joBanner(k: Kit) {
  const timber = k.P('timber');
  banner(k, timber, bannerPaint('joseon', 'blue'), -1.6, 7.2, 1.3, 1.5);
  banner(k, timber, bannerPaint('joseon', 'red'), 0.3, 6.6, 1.3, 1.5);
}

/** A landing pier on posts out over the water. */
function pier(k: Kit) {
  const planks = k.P('planks'), logs = k.P('logs');
  block(k, planks, [-1.6, 0.85, -7], [1.6, 1.1, 7], 0);
  if (k.near) {
    for (let z = -6; z <= 6.01; z += 3) for (const sx of [1, -1]) post(k, logs, sx * 1.45, z, 0.34, -2.2, 0.85);
    for (const sx of [1, -1]) post(k, logs, sx * 1.2, 6.6, 0.3, 1.1, 1.75);
  } else block(k, logs, [-1.45, -2.2, -6.2], [1.45, 0.85, 6.2], NY | PY);
}

// ---------- the works ----------

/** A gun platform: a stone-faced earth terrace, a parapet with three embrasures facing the sea (+z), three cannons. */
function battery(k: Kit, face_: Paint, top: Paint, parapet: Paint, carriage: Paint, bronze: Paint, merlonCap: Paint | null) {
  batter(k, face_, top, 0, 0, 6.9, 4.5, 6.5, 4.1, -1.8, 1.6);
  const xs = [-2.8, 0, 2.8], g = 0.62;
  if (k.near) {
    const edges = [-6.5, ...xs.flatMap((x) => [x - g, x + g]), 6.5];
    for (let i = 0; i < edges.length; i += 2) {
      block(k, parapet, [edges[i]!, 1.55, 3.1], [edges[i + 1]!, 2.6, 4.1]);
      if (merlonCap) coping(k, merlonCap, parapet, edges[i]! - 0.05, edges[i + 1]! + 0.05, 2.6, 3.0, 4.2, 0.24);
    }
    for (const sx of [1, -1]) block(k, parapet, [sx > 0 ? 5.9 : -6.5, 1.55, -1.5], [sx > 0 ? 6.5 : -5.9, 2.2, 3.1]);
    block(k, carriage, [-5.2, 1.6, -3.1], [-3.9, 2.35, -2.1]);
  } else block(k, parapet, [-6.5, 1.55, 3.1], [6.5, 2.3, 4.1]);
  for (const x of xs) cannon(k, x, 1.6, 4.25, carriage, bronze);
}

/** A raised storehouse: a board-walled store on short granite legs, a hipped tile roof, steps to its door. */
function joGranary(k: Kit) {
  const granite = k.P('granite'), planks = k.P('planks'), timber = k.P('timber');
  for (const x of [-4.0, -1.33, 1.33, 4.0]) for (const z of [-2.2, 2.2]) post(k, granite, x, z, 0.55, -1.2, 1.0);
  block(k, planks, [-4.4, 1.0, -2.6], [4.4, 1.3, 2.6], 0);
  walls(k, planks, rect(-4.2, -2.4, 4.2, 2.4), 1.3, 3.65);
  if (k.near) {
    for (const x of [-4.2, -1.4, 1.4, 4.2]) for (const sz of [1, -1]) post(k, timber, x, sz * 2.4, 0.3, 1.3, 3.65);
    picture(k, k.P('gate', { tint: [1.25, 1.15, 1.05] }), -0.8, 0.8, 1.35, 3.2, 2.4, 1);
    for (let i = 0; i < 3; i += 1) block(k, timber, [-0.8, 0.0 + i * 0.33, 2.6 + (2 - i) * 0.32], [0.8, 0.33 + i * 0.33, 2.92 + (2 - i) * 0.32]);
  }
  roof(k, koreanRoof(k), { ex: 5.4, ez: 3.6, y: 3.7, top: 6.0, form: 'hip', lift: 0.55, sag: 1.4, edge: 0.3, overhang: 1.2, ridgeW: 0.5, ridgeH: 0.45, rows: 2, cols: 5 });
}

/** A beacon (bongsudae): an eight-sided granite platform with its five smoke stacks in a row. */
function joBeacon(k: Kit) {
  const granite = k.P('granite');
  column(k, granite, 0, 0, 4.4, 4.05, -1.8, 1.9, k.near ? 8 : 6, true);
  const soot = k.P('timber', { tint: [0.16, 0.15, 0.14] });
  for (let i = -2; i <= 2; i += 1) {
    if (!k.near && Math.abs(i) === 1) continue;
    column(k, granite.tinted([0.9, 0.88, 0.85]), i * 1.5, 0, 0.62, 0.5, 1.85, 4.6, k.near ? 6 : 4, false);
    polygon(k.b, soot, Array.from({ length: 6 }, (_, j): V3 => [i * 1.5 + Math.cos((j / 6) * 6.283) * 0.5, 4.6, -Math.sin((j / 6) * 6.283) * 0.5]), [0, 1, 0], (q) => soot.map(q[0], q[2]));
  }
  if (k.near) banner(k, k.P('timber'), bannerPaint('joseon', 'yellow'), 2.6, 5.4, 0.9, 1.0);
}

// ---------- Japan ----------

/** A stretch of field camp curtain (jinmaku): two white panels with black bands and the crest, hung between posts. */
function waFence(k: Kit) {
  const timber = k.P('timber'), maku = k.P('maku');
  for (const x of [-4.9, 0, 4.9]) column(k, timber, x, 0, 0.1, 0.08, -0.5, 2.75, k.near ? 6 : 4, true);
  for (const x0 of [-4.9, 0]) cloth(k.b, maku, [x0, 2.5, 0], [4.9, 0, 0], [0, -2.15, 0], { nu: k.near ? 4 : 1, nv: 1, wave: k.near ? 0.12 : 0 });
}

/** A stretch of castle wall: a steep fitted-stone base (ishigaki) under a white plaster wall with a tiled coping. */
function waWall(k: Kit) {
  const L = WALL_METRES / 2, ishigaki = k.P('ishigaki');
  rampart(k, ishigaki, ishigaki.tinted([1.05, 1.05, 1.05]), 3.2, 2.5, 1.0, -1.0);
  walls(k, k.P('plaster'), rect(-L, 0.2, L, 0.9), 3.15, 5.3);
  face(k, k.P('boards'), [[-L, 3.15, 0.93], [L, 3.15, 0.93], [L, 4.05, 0.93], [-L, 4.05, 0.93]], [0, 0, 1], [[-L, 0], [L, 0], [L, 0.9], [-L, 0.9]]);
  if (k.near) for (const x of [-3.3, 0, 3.3]) picture(k, shadow(k), x - 0.2, x + 0.2, 4.45, 4.85, 0.9, 1);
  coping(k, k.P('kawara'), k.P('plaster'), -L, L, 5.3, 0.0, 1.1, 0.55);
}

/** A turret gate (yagura-mon): studded doors between two stone bases carrying a plastered gallery under one roof. */
function waGate(k: Kit) {
  const ishigaki = k.P('ishigaki'), plaster = k.P('plaster');
  for (const sx of [1, -1]) batter(k, ishigaki, ishigaki, sx * 4.9, 0, 2.6, 3.6, 2.1, 3.2, -2.2, 3.5);
  block(k, k.P('timber'), [-2.3, 0, -0.45], [2.3, 3.5, 0.45], NY);
  for (const sz of [1, -1] as const) picture(k, k.P('door'), -2.3, 2.3, 0, 3.45, sz * 0.45, sz);
  walls(k, plaster, rect(-7.6, -3.0, 7.6, 3.0), 3.4, 6.6);
  for (const sz of [1, -1]) face(k, k.P('boards'), sz > 0 ? [[-7.6, 3.4, 3.03], [7.6, 3.4, 3.03], [7.6, 4.4, 3.03], [-7.6, 4.4, 3.03]] : [[7.6, 3.4, -3.03], [-7.6, 3.4, -3.03], [-7.6, 4.4, -3.03], [7.6, 4.4, -3.03]], [0, 0, sz]);
  block(k, plaster, [-7.6, 3.4, -3.0], [7.6, 3.45, 3.0], 0);
  if (k.near) for (const sz of [1, -1] as const) for (const x of [-4.2, 0, 4.2]) picture(k, k.P('window'), x - 0.75, x + 0.75, 4.9, 5.9, sz * 3.0, sz);
  roof(k, japaneseRoof(k), { ex: 8.4, ez: 4.4, y: 6.65, top: 9.6, form: 'hipgable', gableAt: 0.55, lift: 0.5, sag: 1.3, edge: 0.38, overhang: 1.3, ridgeW: 0.6, ridgeH: 0.5, rows: 3, cols: 6 });
}

/** A corner turret (yagura): two white storeys on a steep stone base, a skirt roof between them, an irimoya on top. */
function waTower(k: Kit) {
  const ishigaki = k.P('ishigaki'), plaster = k.P('plaster');
  batter(k, ishigaki, ishigaki, 0, 0, 4.6, 4.6, 3.7, 3.7, -2.2, 3.4);
  walls(k, plaster, rect(-3.4, -3.4, 3.4, 3.4), 3.35, 6.4);
  boardsBelow(k, 3.4, 3.4, 3.35, 4.3);
  roof(k, japaneseRoof(k), { ex: 4.6, ez: 4.6, y: 6.45, top: 8.6, form: 'hip', lift: 0.4, sag: 1.35, edge: 0.32, overhang: 1.2, ridgeW: 0.45, ridgeH: 0.38, rows: 2, cols: 5, trims: false });
  walls(k, plaster, rect(-2.6, -2.6, 2.6, 2.6), 7.2, 9.9);
  if (k.near) for (const sz of [1, -1] as const) {
    for (const x of [-1.5, 1.5]) picture(k, k.P('window'), x - 0.6, x + 0.6, 4.6, 5.6, sz * 3.4, sz);
    picture(k, k.P('window'), -0.6, 0.6, 8.3, 9.2, sz * 2.6, sz);
    pictureX(k, k.P('window'), -0.6, 0.6, 8.3, 9.2, sz * 2.6, sz);
  }
  roof(k, japaneseRoof(k), { ex: 3.9, ez: 3.5, y: 9.95, top: 12.2, form: 'hipgable', gableAt: 0.5, lift: 0.4, sag: 1.3, edge: 0.32, overhang: 1.2, ridgeW: 0.48, ridgeH: 0.42, rows: 3, cols: 5 });
}

/** The black boarding (shitami-itabari) round the lower part of a castle storey `hx` by `hz`, from y0 to y1. */
function boardsBelow(k: Kit, hx: number, hz: number, y0: number, y1: number) {
  const boards = k.P('boards');
  walls(k, boards, rect(-hx - 0.03, -hz - 0.03, hx + 0.03, hz + 0.03), y0, y1);
}

/** A keep (tenshu): white tiers stepping in on a steep stone base, skirt roofs between them, a gable on the first, an irimoya crown with gilt fish. */
function waKeep(k: Kit, tiers: [number, number, number][]) {
  const ishigaki = k.P('ishigaki'), plaster = k.P('plaster');
  const [w0, d0] = tiers[0]!;
  batter(k, ishigaki, ishigaki, 0, 0, w0 / 2 + 1.6, d0 / 2 + 1.6, w0 / 2 + 0.5, d0 / 2 + 0.5, -2.2, 4.2);
  let y = 4.2;
  tiers.forEach(([w, d, h], i) => {
    const hx = w / 2, hz = d / 2, top = y + h;
    walls(k, plaster, rect(-hx, -hz, hx, hz), y - 0.4, top);
    if (i === 0) boardsBelow(k, hx, hz, y - 0.4, y + 1.2);
    if (k.near) for (const sz of [1, -1] as const) {
      for (const x of i < 2 ? [-hx * 0.45, hx * 0.45] : [0]) picture(k, k.P('window'), x - 0.6, x + 0.6, top - 1.7, top - 0.75, sz * hz, sz);
      pictureX(k, k.P('window'), -0.6, 0.6, top - 1.7, top - 0.75, sz * hx, sz);
    }
    const next = tiers[i + 1];
    if (next) {
      roof(k, japaneseRoof(k), { ex: hx + 0.9, ez: hz + 0.9, y: top, top: top + 1.6, form: 'hip', lift: 0.35, sag: 1.35, edge: 0.3, overhang: 0.9, ridgeW: 0.45, ridgeH: 0.38, rows: 2, cols: 5, trims: false });
      // A chidori gable on the first roof, front and back: the castle's silhouette.
      if (i === 0) for (const sz of [1, -1]) at(k, 0, top + 0.55, sz * (hz + 0.2), sz > 0 ? Math.PI / 2 : -Math.PI / 2, () => roof(k, japaneseRoof(k), {
        ex: 1.25, ez: 1.6, y: 0, top: 1.5, form: 'gable', lift: 0.15, sag: 1.2, edge: 0.25, overhang: 0.6, verge: 0.3, ridgeW: 0.3, ridgeH: 0.25, rows: 2, cols: 2, trims: false,
      }));
      y = top + 0.75;
      return;
    }
    roof(k, japaneseRoof(k), { ex: hx + 1.2, ez: hz + 1.1, y: top, top: top + 2.7, form: 'hipgable', gableAt: 0.5, lift: 0.45, sag: 1.3, edge: 0.32, overhang: 1.2, ridgeW: 0.5, ridgeH: 0.45, rows: 3, cols: 5 });
  });
}

/** A field tent: cotton over a ridge pole, a dark band along the ridge, its poles showing at the ends. */
function waTent(k: Kit) {
  const canvas = k.P('canvas'), band = k.P('canvas', { tint: [0.32, 0.36, 0.48] });
  for (const sz of [1, -1]) face(k, canvas, sz > 0 ? [[-2.3, -0.3, 2.05], [2.3, -0.3, 2.05], [2.3, 2.6, 0], [-2.3, 2.6, 0]] : [[2.3, -0.3, -2.05], [-2.3, -0.3, -2.05], [-2.3, 2.6, 0], [2.3, 2.6, 0]], [0, 0.6, sz]);
  for (const sx of [1, -1]) polygon(k.b, canvas, [[sx * 2.3, -0.3, 2.05], [sx * 2.3, -0.3, -2.05], [sx * 2.3, 2.6, 0]], [sx, 0, 0], (q) => canvas.map(q[2], q[1]));
  block(k, band, [-2.36, 2.48, -0.2], [2.36, 2.7, 0.2], NY);
  if (k.near) {
    polygon(k.b, band, [[2.33, -0.3, 0.7], [2.33, -0.3, -0.7], [2.33, 1.5, 0]], [1, 0, 0], (q) => band.map(q[2], q[1]));
    for (const sx of [1, -1]) column(k, k.P('timber'), sx * 2.3, 0, 0.05, 0.05, -0.3, 3.0, 4, true);
  }
}

/** Two nobori, the clan's white and red. */
function waBanner(k: Kit) {
  const timber = k.P('timber');
  nobori(k, timber, bannerPaint('japan', 'white'), -1.25);
  nobori(k, timber, bannerPaint('japan', 'red'), 0.3);
}

/** A residence or barracks hall: white walls with black boarding on a low stone base under an irimoya. */
function waHall(k: Kit) {
  const ishigaki = k.P('ishigaki');
  batter(k, ishigaki, ishigaki, 0, 0, 7.6, 3.8, 7.4, 3.6, -2.0, 0.9);
  walls(k, k.P('plaster'), rect(-7.0, -3.2, 7.0, 3.2), 0.9, 4.0);
  boardsBelow(k, 7.0, 3.2, 0.9, 1.9);
  if (k.near) {
    for (const sz of [1, -1] as const) for (const x of [-4.4, 0, 4.4]) if (!(sz > 0 && x === 0)) picture(k, k.P('window'), x - 0.8, x + 0.8, 2.3, 3.3, sz * 3.2, sz);
    picture(k, k.P('door'), -1.1, 1.1, 0.9, 3.4, 3.2, 1);
  }
  roof(k, japaneseRoof(k), { ex: 8.4, ez: 4.6, y: 4.05, top: 7.4, form: 'hipgable', gableAt: 0.55, lift: 0.4, sag: 1.3, edge: 0.32, overhang: 1.4, ridgeW: 0.5, ridgeH: 0.42, rows: 3, cols: 6 });
}

/** A storehouse (kura): thick white walls with black boarding on a stone base, a heavy gabled tile roof. */
function waGranary(k: Kit) {
  const ishigaki = k.P('ishigaki');
  batter(k, ishigaki, ishigaki, 0, 0, 4.1, 3.0, 3.9, 2.8, -2.0, 0.8);
  walls(k, k.P('plaster'), rect(-3.5, -2.4, 3.5, 2.4), 0.8, 4.4);
  boardsBelow(k, 3.5, 2.4, 0.8, 2.1);
  if (k.near) {
    picture(k, k.P('door'), -0.85, 0.85, 0.8, 2.9, 2.4, 1);
    for (const sz of [1, -1] as const) pictureX(k, k.P('window'), -0.45, 0.45, 3.2, 3.9, sz * 3.5, sz);
  }
  roof(k, japaneseRoof(k), { ex: 4.6, ez: 3.5, y: 4.45, top: 6.6, form: 'gable', lift: 0.2, sag: 1.2, edge: 0.32, overhang: 1.1, verge: 0.6, ridgeW: 0.6, ridgeH: 0.5, rows: 2, cols: 4, trims: false });
}

/** A beacon (noroshi-dai): a stone platform, a fire basket on four posts and firewood stacked by it. */
function waBeacon(k: Kit) {
  const ishigaki = k.P('ishigaki'), timber = k.P('timber'), logs = k.P('bamboo', { tint: [0.8, 0.72, 0.6] });
  batter(k, ishigaki, ishigaki, 0, 0, 3.4, 3.4, 2.7, 2.7, -2.0, 2.2);
  for (const sx of [1, -1]) for (const sz of [1, -1]) post(k, timber, sx * 0.9, sz * 0.9, 0.24, 2.1, 5.0);
  block(k, k.P('boards'), [-1.1, 4.4, -1.1], [1.1, 5.2, 1.1]);
  for (let i = 0; i < (k.near ? 3 : 1); i += 1) cylinder(k.b, logs, [-2.2, 2.45 + i * 0.4, -1.8 + i * 0.1], [-2.2, 2.45 + i * 0.4, 1.8 - i * 0.1], 0.22, 0.22, k.near ? 6 : 4, true);
  if (k.near) nobori(k, timber, bannerPaint('japan', 'black'), 1.6);
}

// ---------- Ming ----------

/** A stretch of brick wall: battered grey brick, crenels along the outer edge, a low parapet inside. */
function mgBrick(k: Kit) {
  const brick = k.P('brick');
  rampart(k, brick, brick.tinted([1.05, 1.05, 1.05]), 5.2, 2.0, 1.35, -1.6);
  crenels(k, brick.tinted([1.1, 1.1, 1.1]), null, -WALL_METRES / 2, WALL_METRES / 2, 5.2, 0.75, 1.35, 4, { base: 0.5, top: 1.55, gap: 0.75, hole: true });
  block(k, brick.tinted([1.1, 1.1, 1.1]), [-WALL_METRES / 2, 5.15, -1.6], [WALL_METRES / 2, 5.85, -1.25]);
}

/** A stretch of stockade: square-topped logs sunk in the ground, two rails across the outside. */
function mgPalisade(k: Kit) {
  const L = WALL_METRES / 2, logs = k.P('logs', { tint: [0.85, 0.8, 0.72] }), timber = k.P('timber');
  if (k.near) {
    const n = 11, pitch = WALL_METRES / n;
    for (let i = 0; i < n; i += 1) stake(k, logs, -L + (i + 0.5) * pitch, 0.78, 3.7 + (i % 2) * 0.2, false);
  } else block(k, logs, [-L, -0.6, -0.39], [L, 3.8, 0.39], NY);
  for (const y of [1.0, 2.8]) block(k, timber, [-L, y, 0.39], [L, y + 0.3, 0.62]);
}

/** A gate tower: a brick gate with an arched passage and red studded doors, crenels, and a red pavilion under a glazed roof. */
function mgGate(k: Kit) {
  const brick = k.P('brick'), lacquer = k.P('lacquer', { tint: [0.85, 0.78, 0.74] });
  const W = 7.6, D = 5.0, H = 7.0;
  arched(k, brick, k.P('gate'), W, D, H, 2.2, 2.8);
  for (const sz of [1, -1]) at(k, 0, 0, 0, sz > 0 ? 0 : Math.PI, () => crenels(k, brick.tinted([1.1, 1.1, 1.1]), null, -W, W, H, D - 0.6, D, 6, { base: 0.5, top: 1.5, gap: 0.7, hole: true }));
  walls(k, lacquer, rect(-5.4, -2.6, 5.4, 2.6), H, H + 3.6);
  for (const x of [-5.4, -1.8, 1.8, 5.4]) column(k, lacquer, x, 3.3, 0.32, 0.29, H, H + 3.6, k.near ? 8 : 4);
  if (k.near) for (const sz of [1, -1] as const) for (const x of [-3.6, 0, 3.6]) picture(k, k.P('lattice'), x - 1.3, x + 1.3, H + 0.4, H + 3.0, sz * 2.6, sz);
  block(k, k.P('beam'), [-5.7, H + 3.1, -2.9], [5.7, H + 3.7, 3.6], PY);
  block(k, k.P('stone'), [-6.0, H - 0.05, -3.2], [6.0, H + 0.12, 3.9]);
  roof(k, mingRoof(k, true), { ex: 7.9, ez: 5.1, y: H + 3.75, top: H + 7.2, form: 'hipgable', gableAt: 0.5, lift: 0.7, sag: 1.45, edge: 0.38, overhang: 2.0, ridgeW: 0.7, ridgeH: 0.6, rows: 3, cols: 7 });
}

/** A corner bastion: a brick tower with crenels all round and a small red pavilion with a pyramid roof. */
function mgCorner(k: Kit) {
  const brick = k.P('brick');
  batter(k, brick, brick.tinted([1.05, 1.05, 1.05]), 0, 0, 4.5, 4.5, 4.1, 4.1, -2.2, 6.6);
  for (let s = 0; s < 4; s += 1) at(k, 0, 0, 0, (s * Math.PI) / 2, () => crenels(k, brick.tinted([1.1, 1.1, 1.1]), null, -4.1, 4.1, 6.6, 3.5, 4.1, 3, { base: 0.5, top: 1.45, gap: 0.7, hole: true }));
  const lacquer = k.P('lacquer', { tint: [0.85, 0.78, 0.74] });
  walls(k, lacquer, rect(-1.9, -1.9, 1.9, 1.9), 6.55, 9.0);
  if (k.near) for (const sz of [1, -1] as const) picture(k, k.P('lattice'), -1.1, 1.1, 7.0, 8.6, sz * 1.9, sz);
  roof(k, mingRoof(k), { ex: 3.0, ez: 3.0, y: 9.05, top: 10.9, form: 'pyramid', lift: 0.5, sag: 1.35, edge: 0.3, overhang: 1.1, ridgeW: 0.45, ridgeH: 0.4, rows: 2, cols: 3 });
}

/** A wooden watchtower: four tall braced legs, a railed platform, a pyramid roof and the army's yellow flag above it. */
function mgWatch(k: Kit) {
  const timber = k.P('timber'), planks = k.P('planks');
  for (const sx of [1, -1]) for (const sz of [1, -1]) post(k, timber, sx * 1.9, sz * 1.9, 0.38, -0.8, 9.6);
  block(k, planks, [-2.4, 6.8, -2.4], [2.4, 7.1, 2.4], 0);
  if (k.near) {
    for (const s of [1, -1]) {
      // Cross braces on two faces, a ring of beams and the railing.
      sweep(k.b, timber, [[-1.9, 0.6, s * 1.92], [1.9, 6.6, s * 1.92]], rectSection(0.16, 0.16), { caps: true, up: [0, 0, 1] });
      sweep(k.b, timber, [[1.9, 0.6, s * 1.92], [-1.9, 6.6, s * 1.92]], rectSection(0.16, 0.16), { caps: true, up: [0, 0, 1] });
      block(k, timber, [-2.4, 7.1, s * 2.35 - 0.05], [2.4, 7.95, s * 2.35 + 0.05], 0);
      block(k, timber, [s * 2.35 - 0.05, 7.1, -2.3], [s * 2.35 + 0.05, 7.95, 2.3], 0);
    }
  }
  roof(k, mingRoof(k), { ex: 2.9, ez: 2.9, y: 9.65, top: 11.3, form: 'pyramid', lift: 0.45, sag: 1.3, edge: 0.26, overhang: 1.0, ridgeW: 0.42, ridgeH: 0.4, rows: 2, cols: 3 });
  if (k.near) at(k, 0, 11.0, 0, 0, () => banner(k, timber, bannerPaint('ming', 'yellow'), 0, 3.0, 1.1, 1.1));
}

/** A barracks: grey brick below and whitewash above, red lattice windows, a gabled grey tile roof with hooked ridge ends. */
function mgBarracks(k: Kit) {
  const stone = k.P('stone');
  batter(k, stone, stone, 0, 0, 7.3, 3.5, 7.1, 3.3, -1.8, 0.6);
  walls(k, k.P('brick'), rect(-6.8, -3.0, 6.8, 3.0), 0.6, 1.9);
  walls(k, k.P('plaster'), rect(-6.8, -3.0, 6.8, 3.0), 1.9, 3.7);
  if (k.near) {
    for (const sz of [1, -1] as const) for (const x of [-4.3, -1.4, 1.4, 4.3]) if (!(sz > 0 && Math.abs(x) < 2)) picture(k, k.P('lattice'), x - 0.85, x + 0.85, 2.0, 3.25, sz * 3.0, sz);
    picture(k, k.P('gate'), -1.0, 1.0, 0.6, 3.0, 3.0, 1);
  }
  roof(k, mingRoof(k), { ex: 7.6, ez: 4.1, y: 3.75, top: 6.6, form: 'gable', lift: 0.3, sag: 1.3, edge: 0.32, overhang: 1.1, verge: 0.5, ridgeW: 0.55, ridgeH: 0.48, rows: 3, cols: 6 });
}

/** The commander's yamen hall: a red-columned hall with lattice doors on a two-step stone terrace, a grey hip-and-gable roof. */
function mgHall(k: Kit) {
  const stone = k.P('stone'), lacquer = k.P('lacquer', { tint: [0.85, 0.78, 0.74] });
  batter(k, stone, stone, 0, 0, 9.4, 6.0, 9.2, 5.8, -1.8, 0.6);
  block(k, stone, [-8.3, 0.55, -4.9], [8.3, 1.3, 4.9]);
  block(k, stone, [-1.8, -0.4, 5.8], [1.8, 0.4, 6.4]);
  walls(k, lacquer, rect(-7.0, -3.5, 7.0, 3.5), 1.3, 5.3);
  for (let i = 0; i <= 4; i += 1) column(k, lacquer, -7.0 + i * 3.5, 4.4, 0.34, 0.3, 1.3, 5.3, k.near ? 8 : 4);
  if (k.near) for (let i = 0; i < 4; i += 1) picture(k, k.P('lattice'), -7.0 + i * 3.5 + 0.3, -7.0 + (i + 1) * 3.5 - 0.3, 1.45, 4.6, 3.5, 1);
  block(k, k.P('beam'), [-7.3, 4.75, -3.8], [7.3, 5.35, 4.75], PY);
  roof(k, mingRoof(k), { ex: 9.6, ez: 6.3, y: 5.4, top: 9.9, form: 'hipgable', gableAt: 0.5, lift: 0.75, sag: 1.45, edge: 0.4, overhang: 2.3, ridgeW: 0.8, ridgeH: 0.66, rows: 3, cols: 8 });
}

/** Two army flags on tall poles, Ming yellow and red. */
function mgFlag(k: Kit) {
  const timber = k.P('timber');
  banner(k, timber, bannerPaint('ming', 'yellow'), -1.6, 7.4, 1.35, 1.35);
  banner(k, timber, bannerPaint('ming', 'red'), 0.3, 6.8, 1.35, 1.35);
}

/** A six-sided army tent with a pointed roof. */
function mgTent(k: Kit) {
  const canvas = k.P('canvas'), trim = k.P('canvas', { tint: [0.35, 0.42, 0.62] });
  const seg = k.near ? 6 : 4, r = 2.2;
  column(k, canvas, 0, 0, r, r, -0.3, 1.7, seg, false);
  cylinder(k.b, trim, [0, 1.7, 0], [0, 3.4, 0], r + 0.15, 0.08, seg, false);
  if (k.near) picture(k, trim.tinted([0.45, 0.45, 0.45]), -0.5, 0.5, -0.3, 1.3, r * Math.cos(Math.PI / seg) + 0.01, 1);
}

// ---------- the town ----------

/** A stretch of dry-stone garden wall (doldam) with a cap of flatter stones. */
function doldam(k: Kit) {
  const stone = k.P('fieldstone'), L = WALL_METRES / 2;
  batter(k, stone, stone, 0, 0, L, 0.5, L, 0.36, -1.2, 1.45);
  if (k.near) block(k, stone.tinted([0.78, 0.76, 0.74]), [-L, 1.45, -0.44], [L, 1.62, 0.44]);
}

/** The village's old tree (dangsan namu): a stout trunk and a broad round crown of three clumps. */
function tree(k: Kit) {
  const bark = k.P('logs', { tint: [0.8, 0.74, 0.66] });
  const leaves = k.P('plaster', { tint: [0.28, 0.46, 0.18] });
  column(k, bark, 0, 0, 0.5, 0.34, -0.6, 3.8, k.near ? 7 : 5, false);
  const clumps: [number, number, number, number][] = k.near ? [[0, 5.4, 0, 2.6], [1.4, 4.7, 0.6, 1.9], [-1.3, 4.8, -0.7, 2.0]] : [[0, 5.0, 0, 3.0]];
  for (const [x, y, z, r] of clumps) crown(k, leaves, x, y, z, r);
}

/** A low-poly round clump of leaves, flattened a little, darker underneath. */
function crown(k: Kit, p: Paint, cx: number, cy: number, cz: number, r: number) {
  const rows = k.near ? 4 : 3, seg = k.near ? 7 : 5;
  const P: V3[][] = [];
  for (let i = 0; i <= rows; i += 1) {
    const a = -Math.PI / 2 + (i / rows) * Math.PI;
    P.push(Array.from({ length: seg + 1 }, (_, j): V3 => {
      const b = (j / seg) * Math.PI * 2;
      return [cx + Math.cos(a) * Math.cos(b) * r, cy + Math.sin(a) * r * 0.78, cz - Math.cos(a) * Math.sin(b) * r];
    }));
  }
  surface(k, p, P, [0, 1, 0], (i, j) => [(j / seg) * 6.28 * r, (i / rows) * 3.14 * r]);
}

/** A village pavilion (jeongja): an open timber floor on a stone base under a hip-and-gable roof. */
function jeongja(k: Kit) {
  const granite = k.P('granite'), timber = k.P('timber');
  batter(k, granite, granite, 0, 0, 3.4, 3.4, 3.25, 3.25, -1.6, 0.8);
  block(k, k.P('planks'), [-2.8, 0.8, -2.8], [2.8, 1.25, 2.8]);
  for (const sx of [1, -1]) for (const sz of [1, -1]) column(k, timber, sx * 2.4, sz * 2.4, 0.2, 0.18, 1.25, 4.0, k.near ? 8 : 4);
  if (k.near) for (const s of [1, -1]) {
    block(k, timber, [-2.4, 1.25, s * 2.4 - 0.05], [2.4, 1.85, s * 2.4 + 0.05], 0);
    block(k, timber, [s * 2.4 - 0.05, 1.25, -2.4], [s * 2.4 + 0.05, 1.85, s < 0 ? 2.4 : 0.6], 0);
  }
  roof(k, koreanRoof(k, true), { ex: 3.6, ez: 3.3, y: 4.05, top: 6.6, form: 'hipgable', gableAt: 0.55, lift: 0.6, sag: 1.5, edge: 0.3, overhang: 1.1, ridgeW: 0.45, ridgeH: 0.4, rows: 3, cols: 5 });
}

/** A Tsushima village house: plastered walls over black boards, a steep reed-thatched hip-and-gable roof. */
function waHouse(k: Kit) {
  const ishigaki = k.P('ishigaki');
  batter(k, ishigaki, ishigaki, 0, 0, 4.9, 3.1, 4.75, 2.95, -1.6, 0.45);
  walls(k, k.P('plaster', { tint: [0.95, 0.92, 0.86] }), rect(-4.4, -2.6, 4.4, 2.6), 0.45, 3.0);
  boardsBelow(k, 4.4, 2.6, 0.45, 1.6);
  if (k.near) {
    picture(k, k.P('door'), -2.8, -1.2, 0.45, 2.6, 2.6, 1);
    picture(k, k.P('window'), 0.6, 2.2, 1.7, 2.6, 2.6, 1);
  }
  const reed = k.P('thatch');
  roof(k, { tile: reed, edge: reed.tinted([0.7, 0.66, 0.6]), under: k.P('timber'), ridge: k.P('boards'), gable: k.P('timber'), ends: undefined }, {
    ex: 5.8, ez: 4.0, y: 3.0, top: 7.0, form: 'hipgable', gableAt: 0.6, lift: 0.1, sag: 1.05, edge: 0.55, overhang: 1.4, ridgeW: 0.6, ridgeH: 0.5, rows: 2, cols: 4, trims: false,
  });
}

// ---------- the catalogue ----------

const KITS: Record<PieceKind, (k: Kit) => void> = {
  palisade, stone: stoneWall, jo_gate: joGate, fortgate: fortGate, hall, giwa, choga, magazine, jo_tower: joTower, jo_banner: joBanner,
  wa_fence: waFence, wa_wall: waWall, wa_gate: waGate, wa_tower: waTower,
  wa_keep3: (k) => waKeep(k, [[10.4, 8.4, 4.6], [8.0, 6.4, 4.0], [5.8, 4.6, 3.6]]),
  wa_tent: waTent, wa_banner: waBanner, wa_hall: waHall,
  mg_palisade: mgPalisade, mg_brick: mgBrick, mg_gate: mgGate, mg_corner: mgCorner, mg_watch: mgWatch, mg_barracks: mgBarracks, mg_hall: mgHall,
  mg_flag: mgFlag, mg_tent: mgTent,
  pier,
  jo_battery: (k) => battery(k, k.P('granite'), k.P('fieldstone', { tint: [0.95, 0.92, 0.88] }), k.P('granite'), k.P('timber'), k.P('bronze'), k.P('giwa', { tint: [0.85, 0.85, 0.88] })),
  wa_battery: (k) => battery(k, k.P('ishigaki'), k.P('ishigaki', { tint: [1.1, 1.08, 1.05] }), k.P('plaster'), k.P('timber'), k.P('bronze'), k.P('kawara')),
  mg_battery: (k) => battery(k, k.P('brick'), k.P('stone'), k.P('brick', { tint: [1.1, 1.1, 1.1] }), k.P('timber'), k.P('bronze'), null),
  jo_yard: (k) => yard(k, koreanRoof(k), k.P('timber'), { beam: 5.2, depth: 2.3 }),
  wa_yard: (k) => yard(k, japaneseRoof(k), k.P('timber'), { beam: 4.8, depth: 2.6, square: 0.35 }),
  mg_yard: (k) => yard(k, mingRoof(k), k.P('timber'), { beam: 5.8, depth: 2.4, flat: 0.45, square: 0.6 }),
  jo_dock: (k) => dock(k, koreanRoof(k), k.P('plaster'), k.P('granite'), k.P('gate')),
  wa_dock: (k) => dock(k, japaneseRoof(k), k.P('boards'), k.P('ishigaki'), k.P('door')),
  mg_dock: (k) => dock(k, mingRoof(k), k.P('brick'), k.P('stone'), k.P('gate')),
  jo_granary: joGranary, wa_granary: waGranary,
  mg_granary: (k) => {
    const stone = k.P('stone');
    batter(k, stone, stone, 0, 0, 4.9, 3.4, 4.7, 3.2, -1.8, 0.7);
    walls(k, k.P('brick'), rect(-4.3, -2.8, 4.3, 2.8), 0.7, 4.0);
    if (k.near) {
      picture(k, k.P('gate'), -0.9, 0.9, 0.7, 3.0, 2.8, 1);
      for (const sz of [1, -1] as const) for (const x of [-2.8, 2.8]) picture(k, k.P('lattice'), x - 0.5, x + 0.5, 2.6, 3.4, sz * 2.8, sz);
    }
    roof(k, mingRoof(k), { ex: 5.4, ez: 3.9, y: 4.05, top: 6.6, form: 'hip', lift: 0.45, sag: 1.35, edge: 0.32, overhang: 1.1, ridgeW: 0.55, ridgeH: 0.46, rows: 2, cols: 5 });
  },
  jo_beacon: joBeacon, wa_beacon: waBeacon,
  jo_standard: (k) => standard(k, bannerPaint('joseon', 'blue'), k.P('granite')),
  // Japan's is a great nobori, red with the white crest.
  wa_standard: (k) => {
    const ishigaki = k.P('ishigaki');
    batter(k, ishigaki, ishigaki, -0.6, 0, 0.65, 0.65, 0.5, 0.5, -1.4, 0.5);
    nobori(k, k.P('timber'), bannerPaint('japan', 'red'), -0.6, 2);
  },
  mg_standard: (k) => standard(k, bannerPaint('ming', 'yellow'), k.P('stone')),
  mg_beacon: (k) => {
    const brick = k.P('brick');
    batter(k, brick, brick.tinted([1.05, 1.05, 1.05]), 0, 0, 3.4, 3.4, 2.7, 2.7, -2.0, 7.0);
    for (let s = 0; s < 4; s += 1) at(k, 0, 0, 0, (s * Math.PI) / 2, () => crenels(k, brick.tinted([1.1, 1.1, 1.1]), null, -2.7, 2.7, 7.0, 2.25, 2.7, 2, { base: 0.4, top: 1.2, gap: 0.6, hole: false }));
    block(k, k.P('timber', { tint: [0.2, 0.18, 0.16] }), [-0.9, 6.95, -0.9], [0.9, 7.6, 0.9]);
    if (k.near) at(k, 1.6, 7.0, -1.6, 0, () => banner(k, k.P('timber'), bannerPaint('ming', 'red'), 0, 3.2, 1.0, 1.0));
  },
  doldam, tree, jeongja, wa_house: waHouse,
};

/** Every kind a settlement is built from. */
export const KIT_KINDS = Object.keys(KITS) as PieceKind[];

/**
 * Both levels of detail of a kind, in settlement radii: occlusion baked in metres on the close model with the ground at
 * y = 0 (a work standing in the water has none under it), then the metres scaled down, a wall's length to one unit.
 */
export function buildCampBuilding(kind: PieceKind): [MeshData, MeshData] {
  const P = buildingPaints(navyOf(kind));
  const lods = [true, false].map((near) => {
    const k: Kit = { b: new MeshBuilder(), near, P };
    KITS[kind](k);
    return k.b.data();
  }) as [MeshData, MeshData];
  bakeGrime(lods, null, { ground: WATER_KINDS.has(kind) ? -Infinity : 0, light: 0.35 });
  const sx = WALL_KINDS.has(kind) ? 1 / WALL_METRES : 1 / METRES_PER_RADIUS, s = 1 / METRES_PER_RADIUS;
  for (const d of lods) for (let i = 0; i < d.position.length; i += 3) {
    d.position[i]! *= sx;
    d.position[i + 1]! *= s;
    d.position[i + 2]! *= s;
  }
  // A wall stretched along its run keeps its normals by rescaling them the other way.
  if (sx !== s) for (const d of lods) for (let i = 0; i < d.normal.length; i += 3) {
    const nx = d.normal[i]! / (sx / s), ny = d.normal[i + 1]!, nz = d.normal[i + 2]!, l = Math.hypot(nx, ny, nz) || 1;
    d.normal[i] = nx / l;
    d.normal[i + 1] = ny / l;
    d.normal[i + 2] = nz / l;
  }
  return lods;
}
