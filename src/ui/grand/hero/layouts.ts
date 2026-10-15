import type { FactionId } from '../types';
import { Plan, rect, seeded, type BodyLook, type Colour, type P2 } from './plan';

// The hero camps as laid out for the painted targets (assets-src/camps-hero-2026-10-16): Yeosu, the Jeolla Left Naval
// Command, a granite-walled compound on one levelled terrace behind its quay; Busan, the wajo, the coastal hill cut into
// three stepped baileys behind tall ishigaki with the keep on top and barrack rows on the flat; Gogeumdo, Chen Lin's
// brick fortress round its drill ground. Every size is the thing's own (a barracks 10 to 12 m, a house 6 to 9 m, a
// warship 22 m on the map), in the site's frame: model metres, x east, z south, the sea plane at y = 0.

const OBANG: Colour[] = ['blue', 'red', 'white', 'black', 'yellow'];
const NOBORI: Colour[] = ['white', 'black', 'white', 'red'];
const MING: Colour[] = ['red', 'yellow'];
const PI = Math.PI;

// ---------- Joseon ----------

function gatePavilion(m: Plan, x: number, z: number, rot: number, y: number, w: number, d: number, storeys = 1) {
  m.add({ kind: 'pavilion', x, z, rot, y, w, d, storeys, look: 'jo' });
}

function joBarracks(m: Plan, x: number, z: number, rot: number, y: number, w = 11, d = 5) {
  m.add({ kind: 'bldg', x, z, rot, y, w, d, wallH: 2.2, rise: 1.9, overhang: 0.55, style: 'hipgable', base: 0.35, look: 'jo_lime' });
}

function joStore(m: Plan, x: number, z: number, rot: number, y: number, w = 8, d = 5) {
  m.add({ kind: 'bldg', x, z, rot, y, w, d, wallH: 2.6, rise: 1.9, overhang: 0.6, style: 'hipgable', base: 0.4, look: 'jo_store' });
}

/** The gate in a wall: the stone passage filling the gap and the pavilion over it. */
function joGate(m: Plan, x: number, z: number, rot: number, y: number, h: number, gap: number, w: number, d: number, storeys = 1) {
  m.add({ kind: 'pass', x, z, rot, y, w: gap + 0.4, thick: d - 1.4, h, look: 'jo_granite' });
  gatePavilion(m, x, z, rot, y + h, w, d, storeys);
}

/** The level a pad over an outline stands at: the highest ground under it, a little above the sea at least. */
function fillLevel(m: Plan, poly: readonly P2[], least: number) {
  let hi = least;
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 3) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 3) hi = Math.max(hi, m.natural(x, z));
  return hi + 0.25;
}

/** The highest ground under a footprint and the lowest, for standing a building level on a slope. */
function footing(m: Plan, x: number, z: number, w: number, d: number, rot: number) {
  const c = Math.cos(rot), s = Math.sin(rot);
  let hi = -Infinity, lo = Infinity;
  for (const [a, b] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const px = x + (a * w * c) / 2 + (b * d * s) / 2, pz = z - (a * w * s) / 2 + (b * d * c) / 2;
    const g = m.at(px, pz);
    hi = Math.max(hi, g);
    lo = Math.min(lo, g);
  }
  return { hi, lo };
}

export function yeosu(m: Plan) {
  const h0 = 3.0;
  const X0 = -42, X1 = 16, Z0 = -34, Z1 = 28;
  m.pad(rect(X0 - 3, X1 + 3, Z0 - 3, Z1 + 3, 7), h0, 'earth', 'granite');
  const ax = -13;
  // The quay on the channel: an apron a step above the sea, its face just inside the water line.
  m.pad([[X1 + 3, -36], [27.5, -36], [28.5, -20], [28.0, -4], [26.0, 10], [22.5, 18], [X1 + 3, 22]], 0.9, 'quay', 'granite');
  // Lanes and yards on the terrace.
  m.strip([[ax, Z1 + 3], [ax, -12]], 6, 'lane', h0);
  m.strip([[ax, -6], [X1 + 3, -6]], 4.5, 'lane', h0);
  m.strip([[X0, -2], [ax, -2]], 4, 'lane', h0);
  m.flat(rect(-27, 1, -14, 1), h0, 'yard');
  // Walls: granite with a white crenellated parapet; gates south (main), east (sea), west.
  const wall = rect(X0, X1, Z0, Z1, 5);
  const gates: [number, number, number][] = [[ax, Z1, 6], [X1, -6, 5], [X0, -2, 4.5]];
  m.wallLine(wall, h0, 3.8, 2.8, 'jo_granite', { crenel: 1.6, gaps: gates });
  joGate(m, ax, Z1, 0, h0, 3.8, 6, 10, 5.6, 2);
  for (const dx of [-5.2, 5.2]) m.add({ kind: 'box', x: ax + dx, z: Z1, rot: 0, y: h0, w: 3.6, d: 3.4, h: 3.8, look: 'gate_pier' });
  joGate(m, X1, -6, PI / 2, h0, 3.8, 5, 8, 5);
  for (const dz of [-4.2, 4.2]) m.add({ kind: 'box', x: X1, z: -6 + dz, rot: 0, y: h0, w: 3.4, d: 3.4, h: 3.8, look: 'gate_pier' });
  joGate(m, X0, -2, PI / 2, h0, 3.8, 4.5, 6.5, 4.4);
  // Steps from the sea gate down to the quay.
  m.add({ kind: 'box', x: X1 + 2.6, z: -6, rot: 0, y: 0.9, w: 2.4, d: 4.4, h: 1.0, look: 'step' });
  m.add({ kind: 'box', x: X1 + 1.6, z: -6, rot: 0, y: 0.9, w: 1.6, d: 4.4, h: 1.9, look: 'step' });
  // Corner bastions with watch pavilions.
  for (const [cx, cz] of [[X0 + 1.2, Z0 + 1.2], [X1 - 1.2, Z0 + 1.2], [X1 - 1.2, Z1 - 1.2], [X0 + 1.2, Z1 - 1.2]] as const) {
    m.add({ kind: 'box', x: cx, z: cz, rot: PI / 4, y: h0, w: 6.5, d: 6.5, h: 4.0, look: 'bastion' });
    m.add({ kind: 'turret', x: cx, z: cz, rot: 0, y: h0 + 4.0, s: 4.2, look: 'jo' });
  }
  // The command hall inside its own walled court, the inner gate on the axis.
  m.wallLine([[-27, -16], [-27, -31.2]], h0, 1.8, 0.7, 'jo_court', { closed: false });
  m.wallLine([[1, -31.2], [1, -16]], h0, 1.8, 0.7, 'jo_court', { closed: false });
  m.wallLine([[-27, -16], [1, -16]], h0, 1.8, 0.7, 'jo_court', { closed: false, gaps: [[ax, -16, 6]] });
  m.flat(rect(-26.5, 0.5, -30.8, -16.3), h0, 'yard');
  m.add({ kind: 'bldg', x: ax, z: -24.5, rot: 0, y: h0, w: 15.5, d: 8.5, wallH: 3.3, rise: 3.4, overhang: 1.3, style: 'hipgable', base: 1.1, look: 'jo_lime' });
  m.add({ kind: 'bldg', x: ax, z: -16, rot: 0, y: h0, w: 7, d: 2.6, wallH: 2.4, rise: 1.6, overhang: 0.6, style: 'hipgable', base: 0, look: 'jo_red' });
  m.add({ kind: 'bldg', x: -22.5, z: -20, rot: PI / 2, y: h0, w: 6.5, d: 4.4, wallH: 2.3, rise: 1.8, overhang: 0.7, style: 'hipgable', base: 0.3, look: 'jo_lime' });
  m.add({ kind: 'bldg', x: -3.5, z: -20, rot: -PI / 2, y: h0, w: 6.5, d: 4.4, wallH: 2.3, rise: 1.8, overhang: 0.7, style: 'hipgable', base: 0.3, look: 'jo_lime' });
  m.smoke.push([ax - 4, h0 + 7.5, -26]);
  // The drill ground: a reviewing platform, the commander's flag, ranks of soldiers.
  m.add({ kind: 'box', x: -24.5, z: -7, rot: PI / 2, y: h0, w: 5, d: 4, h: 1.2, look: 'platform' });
  m.add({ kind: 'bldg', x: -24.5, z: -7, rot: PI / 2, y: h0 + 1.2, w: 4.2, d: 3.4, wallH: 2.0, rise: 1.6, overhang: 0.6, style: 'hipgable', base: 0, look: 'jo_red' });
  m.banner(-13, -2.5, h0, 13, 'yellow', 2.4, 3.4);
  m.add({ kind: 'soldiers', x: -19, z: -11, y: h0, rows: 4, cols: 9, dx: 1.6, dz: 1.6, navy: 'joseon' });
  // Barracks: identical rows either side of the main street, their long sides north-south.
  for (const x of [-35.5, -29, -22.5, -3.5, 3, 9.5]) for (const z of [7, 19]) joBarracks(m, x, z, PI / 2, h0, 10.5, 4.2);
  m.strip([[-39, 13], [-18, 13]], 1.6, 'lane', h0);
  m.strip([[-8, 13], [13, 13]], 1.6, 'lane', h0);
  m.smoke.push([-29, h0 + 4.4, 19], [3, h0 + 4.4, 7]);
  // Stores, armoury and the magazine in the north-west quarter; naval stores by the sea gate.
  for (const z of [-26, -17, -8]) joStore(m, -34.5, z, PI / 2, h0, 7.6, 5);
  m.wallLine(rect(-40.5, -29.5, -31.5, -29.6), h0, 1.4, 0.5, 'jo_court');
  for (const z of [-27, -18.5]) joStore(m, 8.5, z, PI / 2, h0, 7.6, 5.4);
  joStore(m, 8.5, -11, 0, h0, 8, 4.4);
  m.add({ kind: 'bldg', x: -33.5, z: 0, rot: 0, y: h0, w: 6, d: 4.4, wallH: 2.2, rise: 1.7, overhang: 0.6, style: 'hipgable', base: 0.3, look: 'jo_lime' });
  m.smoke.push([-33.5, h0 + 4.3, 0]);
  m.add({ kind: 'box', x: -25, z: 0.8, rot: 0, y: h0, w: 2.6, d: 2.6, h: 0.8, look: 'well' });
  // Banners: the five directional colours along the wall walk, big ones at the gates.
  m.bannersOn(rect(X0 + 0.4, X1 - 0.4, Z0 + 0.4, Z1 - 0.4, 5), h0 + 3.8, 7.5, OBANG, { h: 6, skip: [[ax, Z1, 6], [X1, -6, 5], [X0, -2, 4]] });
  for (const dx of [-7.6, 7.6]) m.banner(ax + dx, Z1 + 1, h0 + 3.8, 9, 'red', 1.6, 3.0);
  // The quay: three short timber piers into the channel, warships moored alongside, small boats.
  for (const z of [-28, -6, 13]) {
    const x0 = z < 8 ? 27 : 24;
    m.add({ kind: 'box', x: x0 + 4, z, rot: 0, y: 0, w: 8, d: 2.6, h: 0.85, look: 'pier' });
  }
  m.ship('panokseon', 32, -17, PI);
  m.ship('panokseon', 31, 4.5, PI + 0.08);
  m.ship('sahuseon', 35.5, -28.5, PI / 2);
  m.ship('sahuseon', 35, -5, PI / 2 + 0.2);
  // Shipyard on the shore north-east: a slip running into the channel with a hull on the stocks, a shed, timber.
  m.flat([[20, -45], [34, -45], [34, -38], [20, -38]], 0.45, 'slip');
  m.add({ kind: 'stocks', x: 27.5, z: -41.5, rot: PI / 2, y: 0.6, len: 15, beam: 5, depth: 2.6 });
  for (let k = 0; k < 5; k += 1) m.add({ kind: 'box', x: 23 + k * 2.5, z: -44.2, rot: 0, y: 0.45, w: 0.3, d: 0.3, h: 4.5, look: 'timber' });
  houseOn(m, 12.5, -44, 9, 5, 0, 'jo_shed', 'gable', 2.6, 1.8);
  m.add({ kind: 'box', x: 16, z: -48, rot: 0, y: Math.max(0.3, m.natural(16, -48)), w: 7, d: 3, h: 0.9, look: 'plank_pile' });
  // Battery south-east on the channel mouth: an earth and stone bastion, guns, a magazine hut.
  {
    const bx = 14, bz = 46;
    const by = Math.max(m.natural(bx, bz), 0.6) + 0.4;
    m.pad(rect(bx - 7, bx + 7, bz - 5, bz + 5, 2), by, 'gravel', 'granite');
    m.wallLine([[bx + 7, bz - 5], [bx + 7, bz + 5]], by, 1.4, 1.6, 'parapet', { closed: false, crenel: 1.8 });
    for (let k = 0; k < 4; k += 1) m.add({ kind: 'box', x: bx + 4.6, z: bz - 3.6 + k * 2.4, rot: PI / 2, y: by, w: 0.9, d: 2.4, h: 0.9, look: 'gun' });
    m.add({ kind: 'bldg', x: bx - 3.5, z: bz, rot: PI / 2, y: by, w: 4.5, d: 3.6, wallH: 2.0, rise: 1.4, overhang: 0.5, style: 'hipgable', base: 0.2, look: 'jo_lime' });
    m.banner(bx - 6, bz - 4, by, 6, 'red');
  }
  // The dock on the south-west bay: a pier and a boathouse.
  m.add({ kind: 'box', x: -31, z: 50, rot: 0.4, y: 0, w: 3, d: 12, h: 0.85, look: 'pier' });
  houseOn(m, -23.5, 46.5, 8, 5, 0.4, 'jo_shed', 'gable', 2.4, 1.7);
  m.ship('sahuseon', -34.5, 50.5, 0.4);
  m.ship('sahuseon', -27.5, 53.5, 0.4);
  // Granary west of the camp: three raised stores in a fenced compound.
  {
    const gx = -58, gz = -14, gy = m.natural(gx, gz) + 0.4;
    m.pad(rect(gx - 9, gx + 9, gz - 6, gz + 6), gy, 'yard', 'rubble');
    for (let k = 0; k < 3; k += 1) m.add({ kind: 'bldg', x: gx - 6 + k * 6, z: gz, rot: 0, y: gy, w: 5, d: 4, wallH: 2.4, rise: 1.6, overhang: 0.6, style: 'hipgable', base: 0.6, look: 'jo_granary' });
    m.wallLine(rect(gx - 9, gx + 9, gz - 6, gz + 6), gy, 1.2, 0.3, 'jo_fence', { gaps: [[gx, gz + 6, 3]] });
  }
  // Roads out of the gates.
  m.strip([[ax, Z1 + 3], [ax, 38], [-20, 44], [-24, 47]], 3.4);
  m.strip([[X0 - 3, -2], [-62, -4], [-80, -6], [-100, -2]], 3.4);
  m.strip([[X1 + 3, -36], [16, -44]], 3.0);
  // The beacon on the summit across the channel: five stacks on a stone platform, the watch hut and its flag.
  {
    const bx = 70, bz = -30, by = m.natural(bx, bz);
    m.add({ kind: 'box', x: bx, z: bz, rot: 0.3, y: by, w: 13, d: 5, h: 0.8, look: 'beacon_base' });
    for (let k = 0; k < 5; k += 1) {
      const ox = (k - 2) * 2.4;
      m.add({ kind: 'box', x: bx + ox * Math.cos(0.3), z: bz - ox * Math.sin(0.3), rot: 0.3, y: by + 0.8, w: 1.6, d: 1.6, h: 2.0, look: 'stack' });
    }
    houseOn(m, bx - 2, bz + 5, 4, 3, 0.3, 'jo_lime', 'hipgable', 1.9, 1.4);
    m.banner(bx + 6, bz + 3, by, 7, 'blue');
    m.smoke.push([bx, by + 3.2, bz]);
    m.clear.push([bx, bz, 10]);
  }
  m.clear.push([-13, -3, 52], [24, -10, 26], [14, 46, 10], [-58, -14, 12], [27, -42, 10], [-26, 48, 9], [12, -44, 7]);
}

/** A building standing level on its own footing wherever it is, its base reaching down to the lowest ground under it. */
function houseOn(m: Plan, x: number, z: number, w: number, d: number, rot: number, look: BodyLook, style: 'hip' | 'gable' | 'hipgable', wallH: number, rise: number) {
  const { hi, lo } = footing(m, x, z, w, d, rot);
  const y = Math.max(0.3, Math.min(hi, lo + 1.2));
  m.add({ kind: 'bldg', x, z, rot, y, w, d, wallH, rise, overhang: 0.6, style, base: Math.max(0.3, y - lo + 0.2), look });
}

/**
 * Joseon tier 1, a jin: a log stockade on a low earth bank round a levelled packed-earth yard, a small gate tower, a tiled
 * office, a row of three tiled barracks, a watch platform, banners.
 */
export function joTier1(m: Plan, cx: number, cz: number, rot = 0) {
  const navy = m.navy;
  m.navy = 'joseon';
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (a: number, b: number): P2 => [cx + a * c + b * s, cz - a * s + b * c];
  const pad = rect(-17, 17, -13, 13, 5).map(([a, b]) => P(a, b));
  const h0 = fillLevel(m, pad, 0.8);
  m.pad(pad, h0, 'earth', 'earth');
  const line = rect(-15, 15, -11, 11, 4).map(([a, b]) => P(a, b));
  const gate = P(0, 11);
  m.wallLine(line, h0, 2.6, 0.5, 'jo_stockade', { gaps: [[gate[0], gate[1], 3.5]] });
  m.add({ kind: 'pavilion', x: gate[0], z: gate[1], rot, y: h0 + 2.6, w: 4.6, d: 2.8, storeys: 1, look: 'jo' });
  for (const sx of [-1.9, 1.9]) m.add({ kind: 'box', x: P(sx, 11)[0], z: P(sx, 11)[1], rot, y: h0, w: 0.5, d: 0.5, h: 2.6, look: 'timber' });
  const o = P(0, -6);
  m.add({ kind: 'bldg', x: o[0], z: o[1], rot, y: h0, w: 9, d: 5, wallH: 2.3, rise: 2.0, overhang: 0.7, style: 'hipgable', base: 0.4, look: 'jo_lime' });
  for (const a of [-9.5, -4, 9]) {
    const q = P(a, 4.5);
    m.add({ kind: 'bldg', x: q[0], z: q[1], rot: rot + PI / 2, y: h0, w: 8, d: 3.8, wallH: 2.0, rise: 1.6, overhang: 0.4, style: 'hipgable', base: 0.2, look: 'jo_house' });
  }
  const t = P(12, -8);
  m.add({ kind: 'bldg', x: t[0], z: t[1], rot, y: h0, w: 3, d: 3, wallH: 4.5, rise: 1.2, overhang: 0.4, style: 'pyramid', base: 0, look: 'jo_shed' });
  const f = P(2.5, 1);
  m.banner(f[0], f[1], h0, 8, 'yellow', 1.6, 2.4);
  m.bannersOn(line, h0 + 0.2, 8, OBANG, { h: 6, skip: [[gate[0], gate[1], 4]] });
  m.smoke.push([o[0], h0 + 5, o[1]]);
  m.clear.push([cx, cz, 22]);
  m.navy = navy;
}

// ---------- Japan ----------

function dobei(m: Plan, pts: P2[], y: number, closed = true, gaps?: [number, number, number][], h = 1.7) {
  m.wallLine(pts, y, h, 0.7, 'wa_dobei', { closed, gaps });
}

function yagura(m: Plan, x: number, z: number, rot: number, y: number, w = 5, d = 5, storeys = 2) {
  m.add({ kind: 'yagura', x, z, rot, y, w, d, storeys });
}

function nagaya(m: Plan, x: number, z: number, rot: number, y: number, w = 11.5, d = 4.4) {
  m.add({ kind: 'bldg', x, z, rot, y, w, d, wallH: 2.2, rise: 1.7, overhang: 0.5, style: 'gable', base: 0.3, look: 'wa_lime' });
}

function kura(m: Plan, x: number, z: number, rot: number, y: number, w = 7, d = 4.6) {
  m.add({ kind: 'bldg', x, z, rot, y, w, d, wallH: 3.2, rise: 1.6, overhang: 0.4, style: 'gable', base: 0.3, look: 'wa_lime' });
}

export function busan(m: Plan) {
  const H3 = 3, H2 = 7, H1 = 11, HO = 1, HL = 1.6;
  const san: P2[] = [[-16, -32], [30, -32], [32, -8], [26, 8], [20, 18], [-8, 18], [-16, 8]];
  const nino: P2[] = [[-8, -28], [26, -28], [26, 0], [-8, 0]];
  const hon: P2[] = [[0, -26], [20, -26], [20, -8], [0, -8]];
  const soto: P2[] = [[-52, -34], [-17, -34], [-17, 14], [-52, 14]];
  const land: P2[] = [[-12, 18], [20, 18], [17, 34], [-12, 34]];
  m.pad(soto, HO, 'earth', 'ishigaki');
  m.pad(land, HL, 'earth', 'ishigaki');
  m.pad(san, H3, 'earth', 'ishigaki');
  m.pad(nino, H2, 'earth', 'ishigaki', H3);
  m.pad(hon, H1, 'yard', 'ishigaki', H2);
  // Paths up through the baileys.
  m.strip([[4, 34], [4, 18]], 3, 'lane', HL);
  m.strip([[4, 18], [8, 0]], 3, 'lane', H3);
  m.strip([[8, 0], [13, -8]], 3, 'lane', H2);
  m.strip([[-17, -4], [-52, -4]], 4, 'lane', HO);
  m.flat(rect(-50, -36, -32, -20), HO, 'yard');
  // Steps where the path climbs from one bailey to the next.
  m.add({ kind: 'box', x: 4, z: 19.6, rot: 0, y: HL, w: 3.2, d: 2.4, h: H3 - HL, look: 'step' });
  m.add({ kind: 'box', x: 8, z: 1.4, rot: 0, y: H3, w: 3.2, d: 2.6, h: H2 - H3, look: 'step' });
  m.add({ kind: 'box', x: 13, z: -6.6, rot: 0, y: H2, w: 3.2, d: 2.6, h: H1 - H2, look: 'step' });
  // Walls: dobei along every bailey's edge, gates on the climbing path.
  dobei(m, hon, H1, true, [[13, -8, 4]]);
  dobei(m, nino, H2, true, [[8, 0, 4]]);
  dobei(m, san, H3, true, [[4, 18, 5], [-16, -4, 4]]);
  m.wallLine(soto, HO, 1.8, 0.8, 'wa_outer', { gaps: [[-17, -4, 4], [-34.5, 14, 5]] });
  dobei(m, [[-8, 18], [-12, 34]], HL, false);
  dobei(m, [[20, 18], [17, 34]], HL, false);
  // Gates and turrets.
  yagura(m, 4, 18.6, 0, H3, 9, 4.8, 1);
  yagura(m, 8, 0.4, 0, H2, 7, 4.2, 1);
  yagura(m, 13, -8, 0, H1, 5.5, 3.6, 1);
  for (const [cx, cz, y] of [[-14, 6, H3], [18, 16, H3], [28, -30, H3], [-14, -30, H3], [-6, -2, H2], [24, -2, H2], [18, -10, H1]] as const) yagura(m, cx, cz, 0, y);
  yagura(m, -50, 12, 0, HO, 4.4, 4.4, 1);
  yagura(m, -50, -32, 0, HO, 4.4, 4.4, 1);
  m.add({ kind: 'tenshu', x: 6, z: -14.5, y: H1 });
  m.add({ kind: 'bldg', x: 13.5, z: -21.5, rot: 0, y: H1, w: 9, d: 5.5, wallH: 2.4, rise: 1.8, overhang: 0.6, style: 'hipgable', base: 0.3, look: 'wa_lime' });
  // Ninomaru: storehouses and a hall.
  for (const z of [-24, -15, -6]) kura(m, -4, z, PI / 2, H2);
  m.add({ kind: 'bldg', x: 22, z: -22, rot: 0, y: H2, w: 6.5, d: 9, wallH: 2.4, rise: 1.8, overhang: 0.6, style: 'hipgable', base: 0.3, look: 'wa_lime' });
  kura(m, 22, -11, PI / 2, H2);
  // Sannomaru: barrack rows either side of the climbing path, storehouses along the west.
  for (const x of [-10.5, -4.5, 13.5, 19.5]) nagaya(m, x, 9, PI / 2, H3, 11, 4.2);
  for (const z of [-26, -17, -8]) kura(m, -12, z, PI / 2, H3, 6.5, 4.4);
  kura(m, 29, -20, PI / 2, H3, 6.5, 4.2);
  // The outer enclosure: rows of long barracks on the flat.
  for (const x of [-46.5, -40.5, -34.5, -28.5, -22.5]) for (const z of [-12, 4]) nagaya(m, x, z, PI / 2, HO, 12, 4.2);
  m.smoke.push([-34.5, HO + 4, 4], [-10.5, H3 + 4, 9], [22, H2 + 4.5, -22]);
  // Nobori along the walls and at the gates.
  m.bannersOn(san, H3, 6, NOBORI, { flag: 'nobori', h: 6, skip: [[4, 18, 5]] });
  m.bannersOn(soto, HO, 7, NOBORI, { flag: 'nobori', h: 6 });
  m.bannersOn(nino, H2, 8, NOBORI, { flag: 'nobori', h: 5.5 });
  for (const dx of [-6, 14]) m.banner(dx, 21, HL, 8, 'red', 0.9, 4.6, 0, 'nobori');
  // The landing on the point: warehouses inside the climbing walls, a stone quay and jetties, the fleet.
  kura(m, -6, 27, 0, HL, 8, 4.6);
  kura(m, 11, 27, 0, HL, 8, 4.6);
  m.pad([[-14, 34], [18, 34], [19, 39.5], [-15, 39.5]], 0.9, 'quay', 'ishigaki');
  m.ship('atakebune', 2, 43.8, PI / 2);
  m.ship('sekibune', -23, 45.5, PI / 2 + 0.12);
  m.ship('sekibune', 26.5, 46, PI / 2 - 0.1);
  m.ship('atakebune', -42, 32, PI / 2 + 0.3);
  m.ship('kobaya', -10.5, 42.5, PI / 2);
  m.ship('kobaya', 15, 42.5, PI / 2 + 0.2);
  // Shipyard on the plain's shore: a slip into the bay with a hull on the stocks, a shed.
  m.flat([[-48, 9], [-38, 9], [-38, 22], [-48, 22]], 0.45, 'slip');
  m.add({ kind: 'stocks', x: -43, z: 15, rot: 0, y: 0.5, len: 13, beam: 4.4, depth: 2.4 }, 'japan');
  houseOn(m, -60, 8, 9, 5, 0, 'wa_shed', 'gable', 2.6, 1.6);
  // Battery on the shore to the west, granary east, beacon on the hill to the north-east.
  {
    const bx = -74, bz = 8;
    m.pad(rect(bx - 8, bx + 8, bz - 5, bz + 5, 2), 1.2, 'gravel', 'ishigaki');
    m.wallLine([[bx - 8, bz + 5], [bx + 8, bz + 5]], 1.2, 1.3, 1.6, 'parapet', { closed: false, crenel: 1.8 });
    for (let k = 0; k < 4; k += 1) m.add({ kind: 'box', x: bx - 5.4 + k * 3.6, z: bz + 2.8, rot: 0, y: 1.2, w: 0.9, d: 2.4, h: 0.9, look: 'gun' });
    kura(m, bx, bz - 2, 0, 1.2, 5, 3.4);
  }
  {
    const gx = 46, gz = -22, gy = m.natural(gx, gz) + 0.3;
    m.pad(rect(gx - 9, gx + 9, gz - 6, gz + 6), gy, 'yard', 'ishigaki');
    for (let k = 0; k < 3; k += 1) kura(m, gx - 6 + k * 6, gz, 0, gy, 4.8, 4);
  }
  {
    const bx = 22, bz = -62, by = m.natural(bx, bz);
    m.add({ kind: 'box', x: bx, z: bz, rot: 0, y: by, w: 4, d: 4, h: 3, look: 'stack' });
    m.banner(bx + 3, bz, by, 6, 'white', 0.8, 3.6, 0, 'nobori');
    m.smoke.push([bx, by + 4, bz]);
    m.clear.push([bx, bz, 6]);
  }
  m.strip([[-52, -4], [-80, -10], [-110, -14]], 3.4);
  m.strip([[4, -32], [8, -50], [24, -80]], 3.4);
  m.clear.push([0, -6, 46], [-34, -10, 30], [2, 30, 18], [-74, 8, 11], [46, -22, 12], [-50, 14, 14], [-60, 8, 7]);
}

/** Japan tier 1: a rectangle of plank fence and white curtains, nobori, plank huts and a command tent. */
export function waFieldCamp(m: Plan, cx: number, cz: number, rot = 0) {
  const navy = m.navy;
  m.navy = 'japan';
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (a: number, b: number): P2 => [cx + a * c + b * s, cz - a * s + b * c];
  const pad = rect(-18, 18, -13, 13).map(([a, b]) => P(a, b));
  const g = fillLevel(m, pad, 0.5);
  m.pad(pad, g, 'earth', 'earth');
  const line = rect(-16, 16, -11, 11).map(([a, b]) => P(a, b));
  const gate = P(0, 11);
  m.wallLine(line, g, 1.8, 0.25, 'wa_curtain', { gaps: [[gate[0], gate[1], 4]] });
  for (const a of [-9, -2.5, 4]) {
    const q = P(a, -5);
    m.add({ kind: 'bldg', x: q[0], z: q[1], rot, y: g, w: 5, d: 3.6, wallH: 1.9, rise: 1.2, overhang: 0.3, style: 'gable', base: 0.15, look: 'wa_hut' }, 'japan');
  }
  const t = P(8, 4);
  m.add({ kind: 'bldg', x: t[0], z: t[1], rot, y: g, w: 5.5, d: 4, wallH: 1.6, rise: 1.4, overhang: 0.2, style: 'hip', base: 0, look: 'wa_tent' }, 'japan');
  m.bannersOn(line, g, 6, NOBORI, { flag: 'nobori', h: 5.5, skip: [[gate[0], gate[1], 3]] });
  const f = P(-4, 4);
  m.smoke.push([f[0], g + 1, f[1]]);
  m.clear.push([cx, cz, 21]);
  m.navy = navy;
}

// ---------- Ming ----------

function mingTower(m: Plan, x: number, z: number, rot: number, y: number, w: number, d: number, glaze: boolean, storeys: number) {
  m.add({ kind: 'pavilion', x, z, rot, y, w, d, storeys, look: glaze ? 'mg' : 'mg_plain' });
}

function mgBarracks(m: Plan, x: number, z: number, rot: number, y: number, w = 11.5, d = 4.4) {
  m.add({ kind: 'bldg', x, z, rot, y, w, d, wallH: 2.4, rise: 1.8, overhang: 0.5, style: 'gable', base: 0.35, look: 'mg_barracks' });
}

export function gogeumdo(m: Plan) {
  const h0 = 2.0;
  const X0 = -32, X1 = 38, Z0 = -28, Z1 = 6;
  m.pad(rect(X0 - 3, X1 + 3, Z0 - 3, Z1 + 2.5, 4), h0, 'earth', 'rubble');
  const ax = 3;
  m.strip([[ax, Z1 + 2], [ax, -13]], 6, 'lane', h0);
  m.strip([[X0, -11], [X1, -11]], 4, 'lane', h0);
  m.flat(rect(ax - 14, ax + 14, -14, 2), h0, 'yard');
  const gates: [number, number, number][] = [[ax, Z1, 6], [X1, -11, 5], [X0, -11, 5]];
  m.wallLine(rect(X0, X1, Z0, Z1), h0, 4, 3.6, 'mg_brick', { crenel: 1.5, gaps: gates });
  for (const [gx, gz, r, w, d, st] of [[ax, Z1, 0, 12, 7, 2], [X1, -11, PI / 2, 9, 6, 1], [X0, -11, PI / 2, 9, 6, 1]] as const) {
    const ox = (w / 2 + 1.5) * Math.cos(r), oz = -(w / 2 + 1.5) * Math.sin(r);
    m.add({ kind: 'pass', x: gx, z: gz, rot: r, y: h0, w: 6.4, thick: 4.4, h: 4, look: 'mg_brick' });
    m.add({ kind: 'box', x: gx - ox, z: gz - oz, rot: r, y: h0, w: 3.4, d: 3.8, h: 4, look: 'mg_pier' });
    m.add({ kind: 'box', x: gx + ox, z: gz + oz, rot: r, y: h0, w: 3.4, d: 3.8, h: 4, look: 'mg_pier' });
    mingTower(m, gx, gz, r, h0 + 4, w, d, true, st);
  }
  for (const [cx, cz] of [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]] as const) {
    m.add({ kind: 'box', x: cx, z: cz, rot: 0, y: h0, w: 7.5, d: 7.5, h: 4.4, look: 'mg_bastion' });
    mingTower(m, cx, cz, 0, h0 + 4.4, 5, 5, false, 1);
  }
  // The yamen: its court, ceremonial gate and the double-eaved hall on its terrace.
  m.wallLine(rect(ax - 14, ax + 14, -25.5, -16), h0, 2, 0.7, 'mg_court', { gaps: [[ax, -16, 5]] });
  m.flat(rect(ax - 13.5, ax + 13.5, -25, -16.5), h0, 'yard');
  m.add({ kind: 'yamen', x: ax, z: -21.5, y: h0 });
  mingTower(m, ax, -16, 0, h0, 6.5, 3, false, 1);
  m.smoke.push([ax + 7, h0 + 8, -22]);
  // The drill ground: reviewing stand, flagpoles, ranks of soldiers.
  m.add({ kind: 'box', x: ax, z: -12, rot: 0, y: h0, w: 7, d: 3.6, h: 1.4, look: 'platform' });
  m.banner(ax - 4.5, -12, h0, 12, 'yellow', 2.2, 3);
  m.banner(ax + 4.5, -12, h0, 12, 'red', 2.2, 3);
  m.add({ kind: 'soldiers', x: ax - 10, z: -7, y: h0, rows: 3, cols: 12, dx: 1.6, dz: 1.8, navy: 'ming' });
  // Barrack rows either side.
  for (const x of [-27.5, -21.5, -15.5, 21.5, 27.5, 33.5]) for (const z of [-19, -3.5]) mgBarracks(m, x, z, PI / 2, h0);
  m.smoke.push([-21.5, h0 + 4.4, -3.5], [27.5, h0 + 4.4, -19]);
  m.bannersOn(rect(X0 + 0.5, X1 - 0.5, Z0 + 0.5, Z1 - 0.5), h0 + 4, 6.5, MING, { h: 6, skip: [[ax, Z1, 7], [X1, -11, 5], [X0, -11, 5]] });
  // The east quay on the bay, a T-headed pier, junks moored.
  m.pad([[56, -32], [64.5, -32], [65.5, -10], [64.5, 8], [56, 8]], 0.9, 'quay', 'rubble');
  m.strip([[X1 + 3, -11], [56, -11]], 4);
  m.strip([[56, -11], [64, -11]], 4, 'lane', 0.9);
  m.add({ kind: 'box', x: 74.5, z: -11, rot: 0, y: 0, w: 18, d: 3.4, h: 0.85, look: 'pier' });
  m.add({ kind: 'box', x: 84, z: -11, rot: 0, y: 0, w: 3.4, d: 18, h: 0.85, look: 'pier' });
  m.ship('mingship', 75, -22.5, -PI / 2);
  m.ship('mingship', 75, 0.5, -PI / 2 + 0.05);
  m.ship('mingship', 91.5, -9, PI);
  m.ship('hoseon', 68.5, -27, 0);
  m.ship('hoseon', 68, 5.5, 0.1);
  // The inlet below the main gate: a slip with a junk on the stocks, a shed.
  m.flat([[14, 8.5], [28, 8.5], [28, 16], [14, 16]], 0.5, 'slip');
  m.add({ kind: 'stocks', x: 21, z: 13.5, rot: PI / 2, y: 0.6, len: 14, beam: 4.8, depth: 2.6 });
  houseOn(m, 6, 12, 9, 5, 0, 'mg_shed', 'gable', 2.6, 1.6);
  // The dock on the west bay: a pier and a warehouse.
  m.add({ kind: 'box', x: -60, z: 30, rot: 0.5, y: 0, w: 3, d: 12, h: 0.85, look: 'pier' });
  houseOn(m, -50, 28, 9, 5.5, 0.5, 'mg_store', 'gable', 2.6, 1.7);
  m.ship('mingsmall', -64, 36, 0.5);
  m.strip([[ax, Z1 + 2.5], [ax, 9]], 4);
  m.strip([[X0 - 3, -11], [-40, -14], [-60, -24], [-80, -34]], 3.4);
  m.clear.push([3, -11, 44], [60, -12, 22], [21, 12, 9], [-52, 28, 9], [6, 12, 7]);
}

// ---------- villages ----------

/** Strips of paddy or dry field following the ground. */
export function fields(m: Plan, cx: number, cz: number, w: number, d: number, rot: number, n = 4, paddy = true) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i += 1) {
    const off = (i - (n - 1) / 2) * (d / n);
    const ox = off * s, oz = off * c, hw = w / 2, hd = d / n / 2 - 0.4;
    const pts = ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as const).map(([px, pz]): P2 => [cx + ox + px * c + pz * s, cz + oz - px * s + pz * c]);
    if (pts.every(([px, pz]) => !m.water(px, pz) && m.natural(px, pz) < 12)) m.flat(pts, null, paddy && i % 2 === 0 ? 'paddy' : 'field');
  }
}

/**
 * A village: houses on two sides of a street, each with a low stone yard wall in front, the village tree, `culture` the
 * style of its houses. Houses stand level on their own stone footing; none stands on water or high on a hill.
 */
export function village(m: Plan, cx: number, cz: number, n: number, rot: number, seed: number, culture: FactionId = 'joseon', tiledShare = 0.25, spread = 1) {
  const rnd = seeded(seed);
  const c = Math.cos(rot), s = Math.sin(rot);
  const placed: P2[] = [];
  // Twice as many lots as houses wanted: those on water, too steep or too high are passed over.
  for (let i = 0; i < n * 2 && placed.length < n; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const al = (Math.floor(i / 2) - n / 4) * 11 * spread + rnd.uniform(-1.5, 1.5);
    const across = side * (6.5 + rnd.uniform(0, 3.5)) * spread;
    const x = cx + al * c + across * s, z = cz - al * s + across * c;
    const tiled = rnd.next() < tiledShare;
    const hr = rot + (side > 0 ? 0 : PI) + rnd.uniform(-0.12, 0.12);
    const w = tiled ? rnd.uniform(8, 9.5) : rnd.uniform(6, 7.5), d = tiled ? rnd.uniform(4.6, 5.2) : rnd.uniform(3.8, 4.4);
    if (m.water(x, z) || placed.some(([px, pz]) => Math.hypot(x - px, z - pz) < 8)) continue;
    const { hi, lo } = footing(m, x, z, w + 1, d + 1, hr);
    if (hi > 9 || lo <= 0.05 || hi - lo > 2.2) continue;
    placed.push([x, z]);
    const y = Math.min(hi, lo + 0.9);
    if (culture === 'japan') m.add({ kind: 'bldg', x, z, rot: hr, y, w: rnd.uniform(6.5, 8.5), d: rnd.uniform(4.2, 5), wallH: 2.1, rise: 1.9, overhang: 0.5, style: 'hipgable', base: y - lo + 0.25, look: 'wa_house' }, 'japan');
    else if (tiled) m.add({ kind: 'bldg', x, z, rot: hr, y, w, d, wallH: 2.2, rise: 2.0, overhang: 0.6, style: 'hipgable', base: y - lo + 0.3, look: 'jo_house' }, 'joseon');
    else m.add({ kind: 'bldg', x, z, rot: hr, y, w, d, wallH: 2.0, rise: 1.8, overhang: 0.5, style: 'hip', base: y - lo + 0.25, look: 'jo_thatch' }, 'joseon');
    // A stone yard wall in front of the house.
    const fx = x - side * 4.5 * s, fz = z - side * 4.5 * c;
    if (!m.water(fx, fz)) m.add({ kind: 'wall', a: [fx - 4.25 * c, fz + 4.25 * s], b: [fx + 4.25 * c, fz - 4.25 * s], y: m.natural(fx, fz), h: 1.0, thick: 0.6, look: 'doldam' }, 'joseon');
    if (i % 5 === 1) m.smoke.push([x, y + 4, z]);
  }
  if (placed.length) {
    const span = (n / 4 + 0.5) * 11 * spread;
    m.strip([[cx - span * c, cz + span * s], [cx + span * c, cz - span * s]], 2.6);
    const tx = cx + 4 * s, tz = cz + 4 * c;
    if (!m.water(tx, tz)) m.add({ kind: 'tree', x: tx, z: tz, y: m.natural(tx, tz), r: 3.3 }, 'joseon');
    m.clear.push([cx, cz, Math.max(14, span + 4)]);
  }
  return placed;
}

/** The layout of a hero camp by its region. */
export const LAYOUTS: Record<string, (m: Plan) => void> = { yeosu, busan, gogeumdo };

/** A village of `houses` at (x, z), its street turned by a seed, with fields beside it. */
export function town(m: Plan, x: number, z: number, houses: number, seed: number, culture: FactionId) {
  const rot = ((seed % 7) - 3) * 0.12;
  village(m, x, z, Math.max(6, Math.round(houses * 1.6)), rot, seed, culture);
  fields(m, x + 14 * Math.cos(rot + 0.5), z + 16, 22, 14, rot, 4);
}
