import { cylinder, polygon, type Paint } from '../../ships/build/parts';
import { bannerPaint } from './buildingAtlas';
import { WALL_METRES, type PieceKind } from './campPieces';
import { at, banner, battery, cannon, crenels, dock, stake, standard, yard } from './campBuildings';
import { batter, block, column, picture, PY, rect, roof, thatch, walls, type Kit, type RoofLook } from './kitParts';

// The camps, works and towns of the Armada theatre, on the European building atlas (buildingAtlas.json, 'england'): a
// Tudor or Habsburg coastal fort grows from an earth bank and timber pales round tents and a cottage, to a bastioned
// enclosure with a house and a round gun tower, to a stone curtain with a gatehouse round a square keep and a hall; the
// towns are half-timbered houses under red tiles and thatched cottages along their lanes, with a parish church. England
// and Spain build alike (the Spanish Netherlands' and Brittany's forts were raised on the same Italian principles) and
// are told apart by their flags: St George and the Tudor green and white, the cross of Burgundy and the red of Castile.
//
// Modelled like campBuildings.ts: metres, the front towards +z, standing on y = 0, a wall WALL_METRES long along x.

/** A European roof: straight steep slopes (no curl, no sag), plain eaves, the gable ends in the wall's own paint. */
const euroRoof = (k: Kit, tile: 'slate' | 'redtile' | 'thatch', gable: Paint): RoofLook => ({
  tile: k.P(tile), edge: k.P(tile, { tint: [0.78, 0.78, 0.8] }), under: k.P('timber'),
  ridge: tile === 'slate' ? k.P('slate', { tint: [0.8, 0.8, 0.85] }) : k.P('ridge'), gable,
});

/** A gabled roof over a body `hx` by `hz`, its eave at y and its ridge `pitch` metres higher. */
function gable(k: Kit, look: RoofLook, hx: number, hz: number, y: number, pitch: number) {
  roof(k, look, { ex: hx + 0.5, ez: hz + 0.7, y, top: y + pitch, form: 'gable', lift: 0, sag: 1, edge: 0.18, overhang: 0.6, verge: 0.35, ridgeW: 0.3, ridgeH: 0.26, rows: 2, cols: 4, trims: false });
}

/** A chimney stack of brick from the roof's foot to above its ridge. */
const chimney = (k: Kit, x: number, z: number, y0: number, y1: number) => block(k, k.P('brick'), [x - 0.5, y0, z - 0.5], [x + 0.5, y1, z + 0.5], 0);

/** A half-timbered town house: a rubble plinth, a ground floor and a jettied upper floor framed in oak, a red tile roof. */
function euHouse(k: Kit) {
  const rubble = k.P('rubble'), frame = k.P('halftimber');
  batter(k, rubble, rubble, 0, 0, 4.4, 2.8, 4.3, 2.7, -1.4, 0.35);
  walls(k, frame, rect(-4.0, -2.4, 4.0, 2.4), 0.35, 3.0);
  walls(k, frame, rect(-4.2, -2.75, 4.2, 2.75), 3.0, 5.2);
  if (k.near) {
    block(k, k.P('timber'), [-4.25, 2.85, -2.8], [4.25, 3.05, 2.8], PY);
    picture(k, k.P('door'), -0.6, 0.6, 0.35, 2.4, 2.4, 1);
    for (const x of [-2.6, 2.6]) picture(k, k.P('window'), x - 0.6, x + 0.6, 1.2, 2.3, 2.4, 1);
    for (const x of [-2.3, 0, 2.3]) picture(k, k.P('window'), x - 0.55, x + 0.55, 3.6, 4.6, 2.75, 1);
    picture(k, k.P('window'), -0.6, 0.6, 3.6, 4.6, -2.75, -1);
  }
  gable(k, euroRoof(k, 'redtile', frame), 4.2, 2.75, 5.2, 3.6);
  chimney(k, 2.9, -0.6, 4.6, 9.4);
}

/** A thatched cottage: low limewashed walls on a rubble footing under a thick rounded thatch. */
function euCottage(k: Kit) {
  const rubble = k.P('rubble');
  batter(k, rubble, rubble, 0, 0, 3.9, 2.5, 3.8, 2.4, -1.4, 0.3);
  walls(k, k.P('plaster'), rect(-3.6, -2.2, 3.6, 2.2), 0.3, 2.4);
  if (k.near) {
    picture(k, k.P('door'), -2.4, -1.4, 0.3, 2.1, 2.2, 1);
    picture(k, k.P('window'), 0.4, 1.6, 1.1, 1.9, 2.2, 1);
  }
  thatch(k, k.P('thatch'), k.P('timber'), 4.2, 2.9, 2.4, 5.4, { ridge: 1.4, eave: 0.25 });
  chimney(k, -3.0, 0, 3.2, 6.2);
}

/** A hall: a long two-storey house of dressed stone with mullioned windows and a slate roof between end chimneys. */
function euHall(k: Kit) {
  const stone = k.P('stone');
  batter(k, stone, stone, 0, 0, 8.6, 5.0, 8.4, 4.8, -1.8, 0.6);
  walls(k, stone, rect(-8.0, -4.5, 8.0, 4.5), 0.6, 6.4);
  if (k.near) {
    picture(k, k.P('door'), -1.0, 1.0, 0.6, 3.4, 4.5, 1);
    for (const x of [-5.4, -2.8, 2.8, 5.4]) picture(k, k.P('window'), x - 0.8, x + 0.8, 1.6, 3.2, 4.5, 1);
    for (const x of [-5.4, -2.8, 0, 2.8, 5.4]) picture(k, k.P('window'), x - 0.75, x + 0.75, 4.1, 5.6, 4.5, 1);
    for (const x of [-4, 0, 4]) picture(k, k.P('window'), x - 0.75, x + 0.75, 4.1, 5.6, -4.5, -1);
  }
  gable(k, euroRoof(k, 'slate', stone), 8.0, 4.5, 6.4, 4.6);
  if (k.near) for (const x of [-7.4, 7.4]) chimney(k, x, 0, 6.0, 12.2);
}

/** A square stone keep of three storeys with a battlemented roof and a stair turret at one corner. */
function euKeep(k: Kit) {
  const stone = k.P('stone'), rubble = k.P('rubble');
  batter(k, rubble, stone, 0, 0, 5.2, 5.2, 4.6, 4.6, -2.2, 1.4);
  walls(k, stone, rect(-4.4, -4.4, 4.4, 4.4), 1.4, 13);
  block(k, stone.tinted([0.92, 0.92, 0.92]), [-4.4, 12.95, -4.4], [4.4, 13.05, 4.4], 0);
  for (let s = 0; s < 4; s += 1) at(k, 0, 0, 0, (s * Math.PI) / 2, () => crenels(k, stone, null, -4.6, 4.6, 13, 3.9, 4.6, 4, { base: 0.5, top: 1.4, gap: 0.7, hole: false }));
  column(k, stone, 3.6, -3.6, 1.4, 1.3, 1.4, 15.6, k.near ? 8 : 5, true);
  if (k.near) {
    picture(k, k.P('door'), -1.0, 1.0, 1.4, 4.0, 4.4, 1);
    for (const y of [6.0, 9.4]) for (const sz of [1, -1] as const) picture(k, k.P('window'), -0.7, 0.7, y, y + 1.8, sz * 4.4, sz);
  }
}

/** A round artillery tower in the manner of Henry VIII's device forts: a squat drum, guns on its roof behind a parapet. */
function euBastion(k: Kit) {
  const stone = k.P('stone');
  const seg = k.near ? 14 : 8;
  column(k, stone, 0, 0, 4.8, 4.4, -2.0, 5.6, seg, true);
  // The parapet: a ring of merlons round the gun deck.
  const n = k.near ? 8 : 4;
  for (let i = 0; i < n; i += 1) at(k, 0, 0, 0, (i / n) * Math.PI * 2, () => block(k, stone, [-1.0, 5.55, 3.6], [1.0, 6.8, 4.4], 0));
  if (k.near) for (const a of [0, Math.PI / 2, Math.PI]) at(k, 0, 0, 0, a, () => cannon(k, 0, 5.6, 4.1, k.P('timber'), k.P('bronze')));
  block(k, k.P('timber', { tint: [0.6, 0.6, 0.6] }), [-1.6, 5.6, -1.6], [1.6, 7.6, 1.6], 0);
}

/** A stretch of curtain wall of dressed stone, battered outside, battlemented along its outer edge. */
function euWall(k: Kit) {
  const L = WALL_METRES / 2, stone = k.P('stone'), rubble = k.P('rubble');
  batter(k, rubble, stone, 0, 0, L, 1.9, L, 1.2, -2.4, 4.6);
  crenels(k, stone, null, -L, L, 4.6, 0.55, 1.2, 4, { base: 0.4, top: 1.3, gap: 0.6, hole: false });
}

/** An earth bank faced with turf and crowned with oak pales: the first works of a camp. */
function euPalisade(k: Kit) {
  const L = WALL_METRES / 2, timber = k.P('timber');
  const earth = k.P('rubble', { tint: [0.62, 0.55, 0.44] });
  batter(k, earth, earth, 0, 0, L, 1.8, L, 0.85, -1.8, 0.7);
  if (k.near) {
    const n = 14, pitch = WALL_METRES / n;
    for (let i = 0; i < n; i += 1) stake(k, timber, -L + (i + 0.5) * pitch, 0.4, 2.9 + [0, 0.15, -0.1][i % 3]!, false);
    block(k, timber, [-L, 2.1, -0.4], [L, 2.35, -0.2]);
    return;
  }
  block(k, timber, [-L, 0.3, -0.25], [L, 2.9, 0.25], 0);
}

/** A timber gate between two posts under a small tiled hood, the way into a first camp. */
function euGate(k: Kit) {
  const timber = k.P('timber');
  for (const sx of [-1, 1]) block(k, timber, [sx * 2.1 - 0.3, -0.5, -0.3], [sx * 2.1 + 0.3, 4.2, 0.3], 0);
  block(k, timber, [-2.6, 3.6, -0.35], [2.6, 4.0, 0.35], 0);
  if (k.near) picture(k, k.P('planks'), -1.8, 1.8, 0, 3.4, 0.05, 1);
  roof(k, euroRoof(k, 'redtile', timber), { ex: 3.0, ez: 1.1, y: 4.0, top: 5.0, form: 'gable', lift: 0, sag: 1, edge: 0.12, overhang: 0.4, verge: 0.2, ridgeW: 0.2, ridgeH: 0.18, rows: 1, cols: 3, trims: false });
}

/** A gatehouse of dressed stone: an arched way through, two drum towers either side, battlements over all. */
function euGatehouse(k: Kit) {
  const stone = k.P('stone');
  batter(k, stone, stone, 0, 0, 4.0, 3.4, 3.8, 3.2, -2.2, 0.4);
  walls(k, stone, rect(-3.6, -3.0, 3.6, 3.0), 0.4, 8.0);
  for (let s = 0; s < 2; s += 1) at(k, 0, 0, 0, s * Math.PI, () => crenels(k, stone, null, -3.8, 3.8, 8.0, 2.4, 3.0, 3, { base: 0.4, top: 1.3, gap: 0.6, hole: false }));
  for (const sx of [-1, 1]) {
    column(k, stone, sx * 5.0, 0.8, 2.4, 2.2, -2.0, 9.4, k.near ? 10 : 6, true);
    if (k.near) for (let i = 0; i < 5; i += 1) at(k, sx * 5.0, 0, 0.8, (i / 5) * Math.PI * 2, () => block(k, stone, [-0.5, 9.35, 1.7], [0.5, 10.4, 2.3], 0));
  }
  picture(k, k.P('door'), -1.6, 1.6, 0.4, 4.4, 3.0, 1);
  if (k.near) picture(k, k.P('window'), -0.7, 0.7, 5.6, 7.0, 3.0, 1);
}

/** A soldiers' tent of canvas on a ridge pole. */
function euTent(k: Kit) {
  const canvas = k.P('canvas');
  const look: RoofLook = { tile: canvas, edge: canvas, under: canvas, ridge: canvas, gable: canvas };
  roof(k, look, { ex: 2.2, ez: 1.9, y: -0.2, top: 2.5, form: 'gable', lift: 0, sag: 1.05, edge: 0.04, overhang: 0.05, verge: 0.05, ridgeW: 0.1, ridgeH: 0.08, rows: 1, cols: 2, trims: false });
  for (const sx of [-1, 1]) polygon(k.b, canvas, [[sx * 2.0, -0.2, 1.8], [sx * 2.0, -0.2, -1.8], [sx * 2.0, 2.45, 0]], [sx, 0, 0], (q) => canvas.map(q[2], q[1]));
}

/** The parish church: a nave of rubble under slate, a square west tower with battlements. */
function euChurch(k: Kit) {
  const rubble = k.P('rubble'), stone = k.P('stone');
  batter(k, rubble, rubble, 0, 0, 6.3, 3.4, 6.2, 3.3, -1.4, 0.4);
  walls(k, rubble, rect(-5.8, -3.0, 6.0, 3.0), 0.4, 5.6);
  if (k.near) for (const x of [-2.6, 0.6, 3.6]) for (const sz of [1, -1] as const) picture(k, k.P('window'), x - 0.6, x + 0.6, 2.0, 4.2, sz * 3.0, sz);
  at(k, 0.2, 0, 0, 0, () => gable(k, euroRoof(k, 'slate', rubble), 5.8, 3.0, 5.6, 3.8));
  batter(k, stone, stone, -7.8, 0, 2.2, 2.2, 2.0, 2.0, -1.4, 0.4);
  walls(k, stone, rect(-9.6, -1.9, -6.0, 1.9), 0.4, 12.2);
  for (let s = 0; s < 4; s += 1) at(k, -7.8, 0, 0, (s * Math.PI) / 2, () => crenels(k, stone, null, -2.0, 2.0, 12.2, 1.5, 2.0, 2, { base: 0.4, top: 1.1, gap: 0.6, hole: false }));
  if (k.near) picture(k, k.P('door'), -8.5, -7.1, 0.4, 3.0, 1.9, 1);
}

/** A low dry-stone field wall along a lane, the European town's garden wall. */
function euHedge(k: Kit) {
  const L = WALL_METRES / 2, rubble = k.P('rubble');
  batter(k, rubble, rubble, 0, 0, L, 0.5, L, 0.34, -1.2, 1.25);
}

/** A tithe barn of rubble under a deep thatch, a cart door in its side. */
function euGranary(k: Kit) {
  const rubble = k.P('rubble');
  batter(k, rubble, rubble, 0, 0, 5.4, 3.4, 5.3, 3.3, -1.6, 0.3);
  walls(k, rubble, rect(-5.0, -3.0, 5.0, 3.0), 0.3, 3.6);
  picture(k, k.P('planks'), -1.3, 1.3, 0.3, 3.2, 3.0, 1);
  thatch(k, k.P('thatch'), k.P('timber'), 5.6, 3.6, 3.6, 7.6, { ridge: 2.6, eave: 0.3 });
}

/** A coast beacon: a stone foot, a tall post and the iron fire basket on its top, ready to be lit when the fleet is sighted. */
function euBeacon(k: Kit) {
  const stone = k.P('rubble'), timber = k.P('timber');
  batter(k, stone, stone, 0, 0, 2.6, 2.6, 2.0, 2.0, -1.6, 1.6);
  column(k, timber, 0, 0, 0.35, 0.28, 1.6, 8.6, k.near ? 6 : 4, true);
  cylinder(k.b, k.P('timber', { tint: [0.2, 0.19, 0.18] }), [0, 8.4, 0], [0, 9.6, 0], 0.6, 0.95, k.near ? 8 : 5, true);
  if (k.near) for (const sx of [-1, 1]) block(k, timber, [sx * 0.2 - 0.1, 2.6, -1.4], [sx * 0.2 + 0.1, 2.9, 1.4], 0);
}

/** A navy's flags by name in the European atlas's sheet. */
const flag = (name: 'england' | 'tudor' | 'spain' | 'castile') => bannerPaint('england', name);

/** The kits of the Armada theatre's pieces, merged into campBuildings.ts's catalogue. */
export const EUROPE_KITS: Partial<Record<PieceKind, (k: Kit) => void>> = {
  eu_palisade: euPalisade, eu_wall: euWall, eu_gate: euGate, eu_gatehouse: euGatehouse, eu_keep: euKeep, eu_bastion: euBastion,
  eu_hall: euHall, eu_house: euHouse, eu_cottage: euCottage, eu_tent: euTent, eu_church: euChurch, eu_hedge: euHedge,
  en_banner: (k) => banner(k, k.P('timber'), flag('tudor'), 0, 6.4, 1.6, 1.1),
  sp_banner: (k) => banner(k, k.P('timber'), flag('castile'), 0, 6.4, 1.6, 1.1),
  eu_battery: (k) => battery(k, k.P('stone'), k.P('rubble'), k.P('stone', { tint: [1.05, 1.05, 1.05] }), k.P('timber'), k.P('bronze'), null),
  eu_yard: (k) => yard(k, euroRoof(k, 'redtile', k.P('timber')), k.P('timber'), { beam: 5.6, depth: 2.8, square: 0.3 }),
  eu_dock: (k) => dock(k, euroRoof(k, 'slate', k.P('brick')), k.P('brick'), k.P('stone'), k.P('door')),
  eu_granary: euGranary, eu_beacon: euBeacon,
  en_standard: (k) => standard(k, flag('england'), k.P('stone')),
  sp_standard: (k) => standard(k, flag('spain'), k.P('stone')),
};
