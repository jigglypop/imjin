import { cloth, cylinder, polygon, spike, type Paint } from '../../../ships/build/parts';
import { bannerPaint } from '../buildingAtlas';
import { trafalgarFlag } from '../campTrafalgar';
import { arched, at, boardsBelow, cannon, coping, crenels, crown, hullFrame, japaneseRoof, koreanRoof, mingRoof, shadow, stake } from '../campBuildings';
import { batter, block, column, face, NY, PY, picture, pictureX, post, rect, roof, thatch, walls, type Kit, type RoofLook, type RoofOpts } from '../kitParts';
import type { FactionId } from '../types';
import type { BodyLook, Colour, Piece, RoofStyle, WallLook } from './plan';

// The pieces of the hero camps at the sizes the layouts give them, on the campaign map's kit (kitParts.ts and the shared
// parts of campBuildings.ts) and each navy's building atlas: tiled roofs with curled eaves, lime and plaster walls on
// granite, black boarding, red columns, brick, crenellated parapets, banners that move in the wind. Every piece is built
// in its own frame (its front towards +z, standing on y = 0, its footing reaching below), so identical pieces are built
// once and stamped where they stand (build.ts).

const PI = Math.PI;

/** The stone a navy builds its footings and retaining walls of. */
export const stoneOf = (k: Kit, navy: FactionId) => k.P(navy === 'japan' ? 'ishigaki' : navy === 'ming' ? 'stone' : 'granite');

/** A tiled roof over a w x d footprint (its ridge along the longer side) with its eaves at y and its ridge rise higher. */
function roofOver(k: Kit, look: RoofLook, w: number, d: number, y: number, rise: number, overhang: number, style: RoofStyle, o: { curl?: number; sag?: number } = {}) {
  const long = w >= d, L = Math.max(w, d), S = Math.min(w, d);
  const ez = S / 2 + overhang, ex = L / 2 + overhang;
  const opts: RoofOpts = {
    ex, ez, y, top: y + rise, form: style, gableAt: 0.55, lift: (o.curl ?? 0.12) * ez, sag: o.sag ?? 1.4, edge: Math.min(0.3, 0.12 + S * 0.02),
    overhang, verge: Math.min(0.5, overhang * 0.6), ridgeW: Math.min(0.6, 0.22 + S * 0.035), ridgeH: Math.min(0.5, 0.2 + S * 0.03),
    rows: 3, cols: Math.max(3, Math.min(8, Math.round(ex / 1.3))), trims: S > 3.5,
  };
  at(k, 0, 0, 0, long ? 0 : PI / 2, () => roof(k, look, opts));
}

/** Fired tiles as they weather: darker and greyer than the atlas's new ones, as the painted camps have them. */
function weathered(look: RoofLook, k = 0.66): RoofLook {
  return { ...look, tile: look.tile.tinted([look.tile.tint[0] * k, look.tile.tint[1] * k, look.tile.tint[2] * k * 0.96]), edge: look.edge.tinted([look.edge.tint[0] * k, look.edge.tint[1] * k, look.edge.tint[2] * k]) };
}

/** The roof a body look carries. */
function roofLook(k: Kit, look: BodyLook): RoofLook | null {
  switch (look) {
    case 'jo_red': return weathered(koreanRoof(k, true));
    case 'jo_lime': case 'jo_store': case 'jo_house': case 'jo_shed': case 'jo_granary': return weathered(koreanRoof(k));
    case 'wa_lime': case 'wa_shed': return weathered(japaneseRoof(k), 0.58);
    case 'wa_house': {
      const reed = k.P('thatch');
      return { tile: reed, edge: reed.tinted([0.7, 0.66, 0.6]), under: k.P('timber'), ridge: k.P('boards'), gable: k.P('timber') };
    }
    case 'wa_hut': {
      const planks = k.P('planks', { tint: [0.8, 0.75, 0.7] });
      return { tile: planks, edge: planks, under: k.P('timber'), ridge: k.P('timber'), gable: k.P('planks') };
    }
    case 'mg_red': return mingRoof(k, true);
    case 'mg_barracks': case 'mg_shed': case 'mg_store': return weathered(mingRoof(k), 0.8);
    default: return null;
  }
}

/** Bays of posts round a timber-framed body and a beam under its eaves; doors along the front, windows behind. */
function frame(k: Kit, w: number, d: number, y0: number, y1: number, pillar: Paint, beam: Paint, door: Paint | null, window: Paint | null) {
  const hx = w / 2, hz = d / 2, bays = Math.max(1, Math.round(w / 2.6)), step = w / bays;
  for (let i = 0; i <= bays; i += 1) for (const sz of [1, -1]) post(k, pillar, -hx + step * i, sz * hz, 0.26, y0, y1);
  for (const sx of [1, -1]) post(k, pillar, sx * hx, 0, 0.26, y0, y1);
  for (const sz of [1, -1]) block(k, beam, [-hx - 0.12, y1 - 0.3, sz * hz - 0.13], [hx + 0.12, y1, sz * hz + 0.13], PY);
  for (let i = 0; i < bays; i += 1) {
    const a = -hx + step * i + 0.22, b = -hx + step * (i + 1) - 0.22;
    if (door) picture(k, door, a, b, y0 + 0.1, y1 - 0.45, hz, 1);
    if (window && i % 2 === 0) picture(k, window, a + step * 0.2, b - step * 0.2, y0 + (y1 - y0) * 0.45, y1 - 0.5, -hz, -1);
  }
}

/** A building: a footing and base, its body and its roof (bldg pieces). */
function building(k: Kit, navy: FactionId, p: Extract<Piece, { kind: 'bldg' }>) {
  const { w, d, base, wallH, rise, overhang, style, look } = p;
  const hx = w / 2, hz = d / 2, top = base + wallH;
  const stone = stoneOf(k, navy);
  // The base: a battered stone plinth (a stepped one under a hall), its foot below the ground on the low side.
  if (look === 'jo_granary') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(k, k.P('timber'), sx * (hx - 0.3), sz * (hz - 0.3), 0.3, -0.8, base);
    block(k, k.P('planks'), [-hx - 0.2, base - 0.15, -hz - 0.2], [hx + 0.2, base, hz + 0.2]);
  } else if (look !== 'wa_tent') batter(k, stone, stone.tinted([1.06, 1.05, 1.02]), 0, 0, hx + 0.6, hz + 0.6, hx + 0.45, hz + 0.45, -1.2, Math.max(0.12, base));
  const y0 = Math.max(0.12, base);
  const outline = rect(-hx, -hz, hx, hz);
  switch (look) {
    case 'jo_lime': case 'jo_store': case 'jo_house': case 'jo_granary': {
      const wall = look === 'jo_house' ? k.P('plaster', { tint: [0.96, 0.92, 0.86] }) : k.P('plaster');
      walls(k, wall, outline, y0, top);
      if (look === 'jo_store' || look === 'jo_granary') walls(k, look === 'jo_store' ? k.P('fieldstone') : k.P('planks'), rect(-hx - 0.03, -hz - 0.03, hx + 0.03, hz + 0.03), y0, y0 + Math.min(1.1, wallH * 0.42));
      if (k.near) frame(k, w, d, y0, top, k.P('timber'), k.P('timber', { tint: [0.9, 0.85, 0.8] }), look === 'jo_store' ? null : k.P('door'), look === 'jo_store' ? k.P('door') : null);
      if (look === 'jo_store') picture(k, k.P('gate'), -0.8, 0.8, y0, top - 0.5, hz + 0.02, 1);
      break;
    }
    case 'jo_red': {
      const pillar = k.P('pillar', { tint: [0.85, 0.76, 0.72] });
      if (d < 3.2) {
        // An inner gate: red leaves between red posts.
        walls(k, pillar, outline, y0, top);
        for (const sz of [1, -1] as const) picture(k, k.P('gate'), -hx * 0.5, hx * 0.5, y0, top - 0.3, sz * hz, sz);
      } else {
        // An open pavilion: red columns, a low railing, the painted beams under the eaves.
        const n = Math.max(2, Math.round(w / 2.4));
        for (let i = 0; i <= n; i += 1) for (const sz of [1, -1]) column(k, pillar, -hx + (w * i) / n, sz * hz, 0.17, 0.15, y0, top, k.near ? 6 : 4);
        for (const sx of [1, -1]) column(k, pillar, sx * hx, 0, 0.17, 0.15, y0, top, k.near ? 6 : 4);
        block(k, k.P('planks'), [-hx, y0 - 0.1, -hz], [hx, y0, hz]);
        if (k.near) for (const sz of [1, -1]) block(k, pillar, [-hx, y0, sz * hz - 0.05], [hx, y0 + 0.6, sz * hz + 0.05], 0);
      }
      block(k, k.P('dancheong'), [-hx - 0.15, top - 0.45, -hz - 0.15], [hx + 0.15, top, hz + 0.15], PY);
      break;
    }
    case 'jo_thatch': {
      walls(k, k.P('mud', { tint: [0.92, 0.84, 0.74] }), outline, y0, top);
      if (k.near) frame(k, w, d, y0, top, k.P('timber'), k.P('timber'), k.P('door'), null);
      thatch(k, k.P('thatch'), k.P('timber'), hx + overhang, hz + overhang, top, top + rise, { eave: 0.25 });
      return;
    }
    case 'jo_shed': case 'mg_shed': case 'wa_shed': {
      const timber = k.P('timber'), planks = k.P('planks');
      walls(k, planks, rect(-hx, -hz, hx, hz), y0, top);
      if (k.near) for (let i = 0; i <= Math.round(w / 3); i += 1) for (const sz of [1, -1]) post(k, timber, -hx + (w * i) / Math.round(w / 3), sz * hz, 0.24, y0, top);
      picture(k, shadow(k), -hx * 0.6, hx * 0.6, y0, top - 0.4, hz, 1);
      break;
    }
    case 'wa_lime': case 'wa_house': {
      walls(k, k.P('plaster', look === 'wa_house' ? { tint: [0.95, 0.92, 0.86] } : {}), outline, y0, top);
      boardsBelow(k, hx, hz, y0, y0 + wallH * 0.42);
      if (k.near) {
        const n = Math.max(1, Math.round(w / 3.4));
        for (const sz of [1, -1] as const) for (let i = 0; i < n; i += 1) {
          const x = -hx + (w * (i + 0.5)) / n;
          picture(k, k.P('window'), x - 0.5, x + 0.5, top - 1.0, top - 0.35, sz * hz, sz);
        }
        picture(k, k.P('door'), -0.8, 0.8, y0, y0 + Math.min(2.2, wallH - 0.2), hz + 0.01, 1);
      }
      break;
    }
    case 'wa_hut': {
      walls(k, k.P('planks', { tint: [0.85, 0.8, 0.74] }), outline, y0, top);
      picture(k, shadow(k), -0.6, 0.6, y0, top - 0.3, hz, 1);
      break;
    }
    case 'wa_tent': {
      const canvas = k.P('canvas'), band = k.P('canvas', { tint: [0.32, 0.36, 0.48] });
      for (const sz of [1, -1]) face(k, canvas, sz > 0 ? [[-hx, 0, hz], [hx, 0, hz], [hx, top + rise, 0], [-hx, top + rise, 0]] : [[hx, 0, -hz], [-hx, 0, -hz], [-hx, top + rise, 0], [hx, top + rise, 0]], [0, 0.6, sz]);
      for (const sx of [1, -1]) polygon(k.b, canvas, [[sx * hx, 0, hz], [sx * hx, 0, -hz], [sx * hx, top + rise, 0]], [sx, 0, 0], (q) => canvas.map(q[2], q[1]));
      block(k, band, [-hx - 0.05, top + rise - 0.15, -0.2], [hx + 0.05, top + rise + 0.05, 0.2], NY);
      return;
    }
    case 'mg_red': case 'mg_barracks': case 'mg_store': {
      if (look === 'mg_store') walls(k, k.P('brick'), outline, y0, top);
      else if (look === 'mg_red') walls(k, k.P('lacquer', { tint: [0.85, 0.78, 0.74] }), outline, y0, top);
      else {
        walls(k, k.P('brick'), outline, y0, y0 + wallH * 0.4);
        walls(k, k.P('plaster'), outline, y0 + wallH * 0.4, top);
      }
      if (k.near) {
        const n = Math.max(1, Math.round(w / 2.8));
        for (const sz of [1, -1] as const) for (let i = 0; i < n; i += 1) {
          const x = -hx + (w * (i + 0.5)) / n;
          if (sz > 0 && i === Math.floor(n / 2)) continue;
          picture(k, k.P('lattice'), x - 0.6, x + 0.6, y0 + wallH * 0.45, top - 0.35, sz * hz, sz);
        }
      }
      picture(k, k.P('gate'), -0.75, 0.75, y0, top - 0.3, hz + 0.01, 1);
      block(k, k.P('beam'), [-hx - 0.1, top - 0.35, -hz - 0.1], [hx + 0.1, top, hz + 0.1], PY);
      break;
    }
  }
  const look_ = roofLook(k, look);
  if (look_) {
    const ja = look.startsWith('wa_'), mg = look.startsWith('mg_');
    roofOver(k, look_, w, d, top, rise, overhang, style, { curl: ja ? 0.07 : mg ? 0.1 : 0.14, sag: ja ? 1.25 : mg ? 1.3 : 1.45 });
  }
}

/** A gate pavilion over a wall or a turret on a bastion: a planked floor, columns, a painted frieze, one or two roofs. */
function pavilion(k: Kit, p: Extract<Piece, { kind: 'pavilion' }>) {
  const { w, d, storeys, look } = p;
  const ming = look !== 'jo';
  const pillar = ming ? k.P('lacquer', { tint: [0.85, 0.78, 0.74] }) : k.P('pillar', { tint: [0.85, 0.76, 0.72] });
  const frieze = ming ? k.P('beam') : k.P('dancheong');
  const tiles: RoofLook = ming ? (look === 'mg' ? mingRoof(k, true) : weathered(mingRoof(k), 0.8)) : weathered(koreanRoof(k, true));
  const hx = w / 2 - 0.4, hz = d / 2 - 0.4, h = 2.4;
  block(k, k.P('planks'), [-hx - 0.3, -0.05, -hz - 0.3], [hx + 0.3, 0.25, hz + 0.3]);
  const n = Math.max(2, Math.round(w / 2.6)), m = Math.max(1, Math.round(d / 2.6));
  const seg = k.near ? 6 : 4;
  for (let i = 0; i <= n; i += 1) for (const sz of [1, -1]) column(k, pillar, -hx + (2 * hx * i) / n, sz * hz, 0.18, 0.16, 0.25, h, seg);
  for (let j = 1; j < m; j += 1) for (const sx of [1, -1]) column(k, pillar, sx * hx, -hz + (2 * hz * j) / m, 0.18, 0.16, 0.25, h, seg);
  if (k.near) {
    for (const sz of [1, -1]) block(k, pillar, [-hx, 0.25, sz * hz - 0.05], [hx, 0.9, sz * hz + 0.05], 0);
    for (const sx of [1, -1]) block(k, pillar, [sx * hx - 0.05, 0.25, -hz], [sx * hx + 0.05, 0.9, hz], 0);
  }
  // A Ming gate tower's walls are lattice between the columns; the Korean pavilion stands open.
  if (ming) walls(k, k.P('lattice'), rect(-hx + 0.3, -hz + 0.3, hx - 0.3, hz - 0.3), 0.25, h);
  block(k, frieze, [-hx - 0.2, h - 0.45, -hz - 0.2], [hx + 0.2, h, hz + 0.2], PY);
  const curl = ming ? 0.11 : 0.16, sag = ming ? 1.35 : 1.5;
  if (storeys > 1) {
    roofOver(k, tiles, w - 0.8, d - 0.8, h, 1.3, 1.1, 'hip', { curl, sag });
    const ux = hx * 0.72, uz = hz * 0.72, y1 = h + 1.5, y2 = y1 + 2.0;
    walls(k, ming ? k.P('lattice') : pillar, rect(-ux, -uz, ux, uz), h + 0.6, y2);
    if (!ming && k.near) for (const sz of [1, -1] as const) picture(k, k.P('door'), -ux + 0.3, ux - 0.3, y1, y2 - 0.4, sz * uz, sz);
    block(k, frieze, [-ux - 0.15, y2 - 0.4, -uz - 0.15], [ux + 0.15, y2, uz + 0.15], PY);
    roofOver(k, tiles, 2 * ux, 2 * uz, y2, 2.1, 1.1, 'hipgable', { curl, sag });
  } else roofOver(k, tiles, w - 0.8, d - 0.8, h, Math.min(2.4, 0.9 + d * 0.28), 1.15, w > d * 1.2 ? 'hipgable' : 'pyramid', { curl, sag });
}

/** A corner turret on a bastion: a small pavilion with a pyramid roof (Joseon), or a red one under grey tiles (Ming). */
function turret(k: Kit, p: Extract<Piece, { kind: 'turret' }>) {
  pavilion(k, { kind: 'pavilion', x: 0, z: 0, rot: 0, y: 0, w: p.s, d: p.s, storeys: 1, look: p.look === 'jo' ? 'jo' : 'mg_plain' });
}

/** A Japanese turret (yagura): plaster over black boarding, a gabled roof; two storeys with a skirt roof between. */
function yagura(k: Kit, p: Extract<Piece, { kind: 'yagura' }>) {
  const { w, d, storeys } = p;
  const hx = w / 2, hz = d / 2, plaster = k.P('plaster');
  batter(k, k.P('ishigaki'), k.P('ishigaki'), 0, 0, hx + 0.4, hz + 0.4, hx + 0.2, hz + 0.2, -1.5, 0.3);
  walls(k, plaster, rect(-hx, -hz, hx, hz), 0.3, 2.6);
  boardsBelow(k, hx, hz, 0.3, 1.2);
  if (storeys === 1) for (const sz of [1, -1] as const) picture(k, k.P('door'), -Math.min(1.4, hx * 0.5), Math.min(1.4, hx * 0.5), 0.3, 2.3, sz * hz, sz);
  if (k.near) for (const sz of [1, -1] as const) for (const x of [-hx * 0.55, hx * 0.55]) picture(k, k.P('window'), x - 0.45, x + 0.45, 1.6, 2.3, sz * hz, sz);
  const look = weathered(japaneseRoof(k), 0.58);
  if (storeys > 1) {
    roofOver(k, look, w, d, 2.6, 1.0, 0.7, 'hip', { curl: 0.06, sag: 1.25 });
    const ux = hx * 0.72, uz = hz * 0.72;
    walls(k, plaster, rect(-ux, -uz, ux, uz), 3.0, 5.6);
    if (k.near) for (const sz of [1, -1] as const) picture(k, k.P('window'), -0.5, 0.5, 4.3, 5.1, sz * uz, sz);
    roofOver(k, look, 2 * ux, 2 * uz, 5.6, 1.8, 0.8, 'hipgable', { curl: 0.07, sag: 1.3 });
  } else roofOver(k, look, w, d, 2.6, 1.4, 0.8, 'hipgable', { curl: 0.07, sag: 1.3 });
}

/** The keep: a stone base, three white tiers stepping in under skirt roofs, an irimoya crown with gilt fish. */
function tenshu(k: Kit) {
  const ishigaki = k.P('ishigaki'), plaster = k.P('plaster');
  batter(k, ishigaki, ishigaki.tinted([1.05, 1.05, 1.05]), 0, 0, 6.2, 5.2, 5.5, 4.5, -1.5, 2.2);
  let y = 2.2;
  const tiers: [number, number, number, number][] = [[9.6, 7.8, 3.4, 1.3], [7.4, 6.0, 3.0, 1.2], [5.4, 4.4, 2.8, 2.4]];
  tiers.forEach(([w, d, h, rise], i) => {
    const hx = w / 2, hz = d / 2, top = y + h;
    walls(k, plaster, rect(-hx, -hz, hx, hz), y - 0.3, top);
    boardsBelow(k, hx, hz, y - 0.3, y + h * 0.45);
    if (k.near) for (const sz of [1, -1] as const) {
      for (const x of i < 2 ? [-hx * 0.45, hx * 0.45] : [0]) picture(k, k.P('window'), x - 0.55, x + 0.55, top - 1.5, top - 0.6, sz * hz, sz);
      pictureX(k, k.P('window'), -0.55, 0.55, top - 1.5, top - 0.6, sz * hx, sz);
    }
    const last = i === tiers.length - 1;
    const look = weathered(japaneseRoof(k), 0.58);
    roofOver(k, last ? look : { ...look, ends: undefined }, w, d, top, rise, 1.1, last ? 'hipgable' : 'hip', { curl: 0.08, sag: 1.3 });
    if (i === 0) for (const sz of [1, -1]) at(k, 0, top + 0.45, sz * (hz + 0.3), sz > 0 ? PI / 2 : -PI / 2, () => roof(k, { ...look, ends: undefined }, {
      ex: 1.1, ez: 1.4, y: 0, top: 1.3, form: 'gable', lift: 0.12, sag: 1.2, edge: 0.22, overhang: 0.5, verge: 0.25, ridgeW: 0.28, ridgeH: 0.22, rows: 2, cols: 2, trims: false,
    }));
    y = top + rise * 0.65;
  });
}

/** The Ming commander's yamen: a stone terrace, a red-columned hall under a glazed skirt roof, a glazed hip-and-gable crown. */
function yamen(k: Kit) {
  const stone = k.P('stone'), lacquer = k.P('lacquer', { tint: [0.85, 0.78, 0.74] }), glazed = mingRoof(k, true);
  batter(k, stone, stone.tinted([1.06, 1.05, 1.02]), 0, 0, 8.8, 4.8, 8.5, 4.5, -1.5, 1.2);
  block(k, stone, [-1.6, -0.3, 4.5], [1.6, 0.7, 5.6]);
  walls(k, lacquer, rect(-7, -3.3, 7, 3.3), 1.2, 4.4);
  for (let i = 0; i <= 5; i += 1) column(k, lacquer, -7 + i * 2.8, 3.9, 0.22, 0.2, 1.2, 4.4, k.near ? 8 : 4);
  if (k.near) for (let i = 0; i < 5; i += 1) picture(k, k.P('lattice'), -7 + i * 2.8 + 0.25, -7 + (i + 1) * 2.8 - 0.25, 1.35, 3.9, 3.3, 1);
  block(k, k.P('beam'), [-7.3, 4.0, -3.6], [7.3, 4.4, 4.2], PY);
  roofOver(k, glazed, 14, 7.8, 4.4, 1.0, 1.4, 'hip', { curl: 0.1, sag: 1.35 });
  walls(k, lacquer, rect(-5.25, -2.5, 5.25, 2.5), 4.9, 6.8);
  if (k.near) for (const sz of [1, -1] as const) for (const x of [-3, 0, 3]) picture(k, k.P('lattice'), x - 1.1, x + 1.1, 5.2, 6.5, sz * 2.5, sz);
  block(k, k.P('beam'), [-5.4, 6.45, -2.65], [5.4, 6.8, 2.65], PY);
  roofOver(k, glazed, 10.5, 5, 6.8, 2.4, 1.2, 'hipgable', { curl: 0.12, sag: 1.4 });
}

/** A run of wall from x = -L to L, its outer face towards +z, its foot at y = 0 (its footing reaching below). */
function wall(k: Kit, navy: FactionId, look: WallLook, L: number, h: number, t: number, crenel = 1.6) {
  const n = Math.max(1, Math.round((2 * L) / crenel));
  switch (look) {
    case 'jo_granite': case 'mg_brick': case 'parapet': {
      const stone = look === 'mg_brick' ? k.P('brick') : stoneOf(k, navy);
      const out = t / 2, foot = -1.6, batterOut = look === 'parapet' ? 0.15 : 0.35;
      const s = Math.hypot(h - foot, batterOut);
      face(k, stone, [[-L, foot, out + batterOut], [L, foot, out + batterOut], [L, h, out], [-L, h, out]], [0, 0.15, 1], [[-L, 0], [L, 0], [L, s], [-L, s]]);
      face(k, stone, [[L, foot, -out], [-L, foot, -out], [-L, h, -out], [L, h, -out]], [0, 0, -1], [[-L, 0], [L, 0], [L, h - foot], [-L, h - foot]]);
      for (const sx of [-1, 1]) face(k, stone, [[sx * L, foot, -out], [sx * L, foot, out + batterOut], [sx * L, h, out], [sx * L, h, -out]], [sx, 0, 0], [[-out, 0], [out, 0], [out, h - foot], [-out, h - foot]]);
      if (look === 'parapet') {
        face(k, stone.tinted([1.08, 1.06, 1.02]), [[-L, h, out], [L, h, out], [L, h, -out], [-L, h, -out]], [0, 1, 0], [[-L, out], [L, out], [L, -out], [-L, -out]]);
        crenels(k, stone.tinted([1.04, 1.03, 1.0]), null, -L, L, h, -out, out, n, { base: 0.25, top: 0.95, gap: 0.8, hole: false });
        break;
      }
      // The wall walk, then the parapet along its outer edge: lime with tile copings (Joseon), brick (Ming).
      const walk = look === 'mg_brick' ? k.P('stone', { tint: [0.95, 0.94, 0.92] }) : stone.tinted([1.1, 1.08, 1.04]);
      face(k, walk, [[-L, h, out], [L, h, out], [L, h, -out], [-L, h, -out]], [0, 1, 0], [[-L, out], [L, out], [L, -out], [-L, -out]]);
      if (look === 'mg_brick') {
        crenels(k, k.P('brick', { tint: [1.08, 1.08, 1.08] }), null, -L, L, h, out - 0.5, out, n, { base: 0.5, top: 1.4, gap: 0.6, hole: true });
        block(k, k.P('brick', { tint: [1.08, 1.08, 1.08] }), [-L, h, -out], [L, h + 0.6, -out + 0.35]);
      } else crenels(k, k.P('plaster'), k.P('giwa', { tint: [0.85, 0.85, 0.88] }), -L, L, h, out - 0.5, out, n, { base: 0.45, top: 1.15, gap: 0.42, hole: true });
      break;
    }
    case 'jo_court': case 'mg_court': case 'wa_dobei': case 'wa_outer': {
      const stone = stoneOf(k, navy), hz = t / 2;
      block(k, stone, [-L, -0.8, -hz - 0.1], [L, 0.35, hz + 0.1]);
      const body = look === 'mg_court' ? k.P('lacquer', { tint: [0.85, 0.78, 0.74] }) : look === 'wa_outer' ? k.P('plaster', { tint: [0.8, 0.7, 0.58] }) : k.P('plaster');
      block(k, body, [-L, 0.35, -hz], [L, h, hz], NY);
      if (look === 'wa_dobei' || look === 'wa_outer') {
        face(k, k.P('boards'), [[-L, 0.35, hz + 0.02], [L, 0.35, hz + 0.02], [L, 0.35 + h * 0.3, hz + 0.02], [-L, 0.35 + h * 0.3, hz + 0.02]], [0, 0, 1]);
        if (k.near) for (let x = -L + 1.5; x < L - 0.5; x += 3) picture(k, shadow(k), x - 0.15, x + 0.15, h - 0.75, h - 0.45, hz, 1);
      }
      const tile = look === 'mg_court' ? k.P('glazed') : look.startsWith('wa_') ? k.P('kawara') : k.P('giwa', { tint: [0.85, 0.85, 0.88] });
      coping(k, tile, body, -L - 0.02, L + 0.02, h, -hz - 0.25, hz + 0.25, 0.35);
      break;
    }
    case 'jo_stockade': {
      const logs = k.P('logs'), earth = navy === 'joseon' ? k.P('mud', { tint: [0.58, 0.5, 0.42] }) : stoneOf(k, navy).tinted([0.62, 0.52, 0.42]);
      batter(k, earth, earth, 0, 0, L, 1.4, L, 0.7, -1.4, 0.45);
      if (k.near) {
        const m = Math.max(2, Math.round((2 * L) / 0.42));
        for (let i = 0; i < m; i += 1) stake(k, logs, -L + ((i + 0.5) * 2 * L) / m, 0.38, h + [0, 0.25, -0.12][i % 3]!, true);
        block(k, k.P('timber'), [-L, h * 0.6, -0.35], [L, h * 0.6 + 0.22, -0.2]);
      } else block(k, logs, [-L, -0.3, -0.2], [L, h + 0.2, 0.2], NY);
      break;
    }
    case 'jo_fence': {
      const timber = k.P('timber');
      for (let x = -L; x <= L + 0.01; x += Math.max(1, (2 * L) / Math.max(1, Math.round(L)))) post(k, timber, x, 0, 0.16, -0.5, h);
      for (const y of [h * 0.35, h * 0.85]) block(k, timber, [-L, y, -0.05], [L, y + 0.12, 0.05], 0);
      break;
    }
    case 'doldam': {
      const stone = k.P('fieldstone');
      batter(k, stone, stone, 0, 0, L, t / 2 + 0.05, L, t / 2 - 0.08, -0.8, h);
      if (k.near) block(k, stone.tinted([0.78, 0.76, 0.74]), [-L, h, -t / 2], [L, h + 0.15, t / 2]);
      break;
    }
    case 'wa_curtain': {
      const timber = k.P('timber'), maku = k.P('maku');
      const m = Math.max(1, Math.round((2 * L) / 4.5));
      for (let i = 0; i <= m; i += 1) column(k, timber, -L + (2 * L * i) / m, 0, 0.08, 0.07, -0.5, h + 0.3, k.near ? 5 : 3, true);
      for (let i = 0; i < m; i += 1) cloth(k.b, maku, [-L + (2 * L * i) / m, h, 0], [(2 * L) / m, 0, 0], [0, -h + 0.25, 0], { nu: k.near ? 3 : 1, nv: 1, wave: k.near ? 0.1 : 0, flutter: 0.15 });
      break;
    }
  }
}

/** A gate's passage filling the gap in a wall: piers and a vault with the leaves shut inside. */
function pass(k: Kit, navy: FactionId, p: Extract<Piece, { kind: 'pass' }>) {
  const stone = p.look === 'mg_brick' ? k.P('brick') : stoneOf(k, navy);
  const W = p.w / 2, D = p.thick / 2, a = Math.min(1.6, W * 0.45);
  arched(k, stone, k.P('gate'), W, D, p.h, a, Math.min(2.2, p.h - a - 0.5));
  face(k, stone.tinted([1.08, 1.06, 1.02]), [[-W, p.h, D], [W, p.h, D], [W, p.h, -D], [-W, p.h, -D]], [0, 1, 0]);
}

/** Blocks: bastions, piers, platforms, guns, stacks, wells, timber. */
function box(k: Kit, navy: FactionId, p: Extract<Piece, { kind: 'box' }>) {
  const hx = p.w / 2, hz = p.d / 2, h = p.h;
  const stone = stoneOf(k, navy);
  switch (p.look) {
    case 'bastion': case 'mg_bastion': case 'wa_bastion': {
      const body = p.look === 'mg_bastion' ? k.P('brick') : stone;
      batter(k, body, body.tinted([1.08, 1.06, 1.02]), 0, 0, hx + 0.3, hz + 0.3, hx, hz, -1.6, h);
      const par = p.look === 'mg_bastion' ? k.P('brick', { tint: [1.08, 1.08, 1.08] }) : k.P('plaster');
      const cap = p.look === 'mg_bastion' ? null : k.P('giwa', { tint: [0.85, 0.85, 0.88] });
      for (let s = 0; s < 4; s += 1) at(k, 0, 0, 0, (s * PI) / 2, () => {
        const ex = s % 2 ? hz : hx, ez = s % 2 ? hx : hz;
        crenels(k, par, cap, -ex, ex, h, ez - 0.45, ez, Math.max(2, Math.round((2 * ex) / 1.6)), { base: 0.45, top: 1.15, gap: 0.45, hole: true });
      });
      break;
    }
    case 'gate_pier': case 'mg_pier': case 'platform': case 'step': case 'beacon_base': case 'brick_beam': {
      const body = p.look === 'mg_pier' || p.look === 'brick_beam' ? k.P('brick') : stone;
      batter(k, body, body.tinted([1.08, 1.06, 1.02]), 0, 0, hx + 0.12, hz + 0.12, hx, hz, -1.4, h);
      if (p.look === 'gate_pier') block(k, k.P('plaster'), [-hx, h, -hz], [hx, h + 0.5, hz]);
      if (p.look === 'platform') block(k, body, [-1.2, -0.2, hz], [1.2, h * 0.5, hz + 0.7]);
      break;
    }
    case 'pier': case 'timber': case 'plank_pile': {
      const planks = k.P('planks'), logs = k.P('logs');
      if (p.look === 'timber') { post(k, logs, 0, 0, Math.max(p.w, 0.2), -0.4, h); break; }
      if (p.look === 'plank_pile') {
        for (let i = 0; i < (k.near ? 5 : 2); i += 1) {
          const z = -hz + 0.35 + (i % 3) * 0.75, y = 0.3 + Math.floor(i / 3) * 0.55;
          cylinder(k.b, logs, [-hx, y, z], [hx, y, z], 0.3, 0.3, k.near ? 6 : 4, true);
        }
        break;
      }
      block(k, planks, [-hx, h - 0.25, -hz], [hx, h, hz]);
      if (k.near) {
        const along = hx >= hz, Lh = along ? hx : hz, n = Math.max(1, Math.round((2 * Lh) / 2.4));
        for (let i = 0; i <= n; i += 1) for (const s of [-1, 1]) {
          const t = -Lh + (2 * Lh * i) / n;
          post(k, logs, along ? t : s * (hx - 0.2), along ? s * (hz - 0.2) : t, 0.3, -2.4, h - 0.25);
        }
      } else block(k, logs, [-hx + 0.2, -2.4, -hz + 0.2], [hx - 0.2, h - 0.25, hz - 0.2], NY | PY);
      break;
    }
    case 'gun': cannon(k, 0, 0, hz, k.P('timber'), k.P('bronze')); break;
    case 'stack': {
      const body = navy === 'ming' ? k.P('brick') : stone;
      batter(k, body, body, 0, 0, hx, hz, hx * 0.75, hz * 0.75, -1.2, h);
      block(k, k.P('timber', { tint: [0.15, 0.13, 0.12] }), [-hx * 0.6, h - 0.05, -hz * 0.6], [hx * 0.6, h + 0.25, hz * 0.6]);
      break;
    }
    case 'well': {
      batter(k, stone, stone, 0, 0, hx, hz, hx - 0.1, hz - 0.1, -0.8, h);
      block(k, shadow(k), [-hx + 0.4, h - 0.05, -hz + 0.4], [hx - 0.4, h + 0.01, hz - 0.4]);
      for (const sx of [-1, 1]) post(k, k.P('timber'), sx * (hx - 0.2), 0, 0.16, h, h + 1.6);
      block(k, k.P('timber'), [-hx, h + 1.5, -0.1], [hx, h + 1.65, 0.1]);
      break;
    }
  }
}

/** A banner's paint: the navy's banner sheet, black where a sheet has none. */
function flagPaint(navy: FactionId, colour: Colour): Paint {
  // The Armada theatre has no hero camps; its navies fly their own flags from the European atlas.
  if (navy === 'england' || navy === 'spain') return bannerPaint('england', navy);
  // The Lepanto theatre's navies fly the stand-in flags of campMediterranean.ts.
  if (navy === 'holyleague') return bannerPaint('england', 'england');
  if (navy === 'ottoman') return bannerPaint('england', 'castile', [0.86, 0.8, 0.8]);
  // The Trafalgar theatre's navies fly the stand-in flags of campTrafalgar.ts.
  if (navy === 'britain' || navy === 'france' || navy === 'spain1805') return trafalgarFlag(navy);
  const have: Record<'joseon' | 'japan' | 'ming', Colour[]> = { joseon: ['blue', 'red', 'yellow', 'white'], japan: ['white', 'red', 'black', 'blue'], ming: ['yellow', 'red', 'blue', 'black'] };
  if (have[navy].includes(colour)) return bannerPaint(navy, colour);
  if (colour === 'black') return bannerPaint(navy, have[navy][0]!, [0.16, 0.16, 0.18]);
  return bannerPaint(navy, have[navy][0]!);
}

/** A pole with its cloth: a flag flying east from its top, or a nobori hanging from an arm; both move in the wind. */
function flag(k: Kit, navy: FactionId, p: Extract<Piece, { kind: 'banner' }>) {
  const pole = k.P('timber');
  const r = Math.min(0.12, 0.05 + p.h * 0.006);
  column(k, pole, 0, 0, r, r * 0.75, -0.4, p.h, k.near ? 5 : 3, true);
  if (k.near) spike(k.b, pole, [0, p.h, 0], [0, 1, 0], r * 1.4, 0.35, 4);
  const paint = flagPaint(navy, p.colour);
  if (p.flag === 'nobori') {
    block(k, pole, [0, p.h - 0.35, -0.04], [p.w + 0.12, p.h - 0.25, 0.04], 0);
    cloth(k.b, paint, [0.06, p.h - 0.3, 0], [p.w, 0, 0], [0, -p.fh, 0], { nu: k.near ? 2 : 1, nv: k.near ? 4 : 1, flutter: 0.35, hang: true, wave: k.near ? 0.05 : 0 });
  } else cloth(k.b, paint, [r, p.h - 0.15, 0], [p.w, 0, 0], [0, -p.fh * 0.7, 0], { nu: k.near ? 4 : 1, nv: k.near ? 2 : 1, flutter: 0.9, wave: k.near ? 0.12 : 0 });
}

/** Ranks of soldiers on the drill ground, each a figure with a spear; far away one block a rank. */
function soldiers(k: Kit, p: Extract<Piece, { kind: 'soldiers' }>) {
  const coat = p.navy === 'ming' ? k.P('lacquer', { tint: [0.9, 0.8, 0.75] }) : k.P('plaster', { tint: [0.22, 0.25, 0.36] });
  const hat = k.P('timber', { tint: [0.2, 0.18, 0.16] }), spear = k.P('timber');
  for (let r = 0; r < p.rows; r += 1) {
    const z = r * p.dz;
    if (!k.near) { block(k, coat, [-0.25, 0, z - 0.2], [(p.cols - 1) * p.dx + 0.25, 1.4, z + 0.2]); continue; }
    for (let c = 0; c < p.cols; c += 1) {
      const x = c * p.dx;
      block(k, coat, [x - 0.24, 0, z - 0.15], [x + 0.24, 1.15, z + 0.15]);
      block(k, hat, [x - 0.15, 1.15, z - 0.14], [x + 0.15, 1.5, z + 0.14]);
      post(k, spear, x + 0.32, z, 0.05, 0, 2.3);
    }
  }
}

/** A hull on the stocks of a slip, its cradle under it. */
function stocks(k: Kit, p: Extract<Piece, { kind: 'stocks' }>) {
  const timber = k.P('timber'), planks = k.P('planks');
  for (let i = -2; i <= 2; i += 1) block(k, timber, [-p.beam * 0.4, -0.3, i * p.len * 0.18 - 0.2], [p.beam * 0.4, 0.35, i * p.len * 0.18 + 0.2]);
  hullFrame(k, timber, planks, p.len, p.beam, p.depth, 0.35, 0);
}

/** The village's old tree: a stout trunk and a broad crown of clumps. */
function tree(k: Kit, r: number) {
  const bark = k.P('logs', { tint: [0.8, 0.74, 0.66] }), leaves = k.P('plaster', { tint: [0.24, 0.4, 0.17] });
  column(k, bark, 0, 0, r * 0.15, r * 0.1, -0.6, r * 1.1, k.near ? 7 : 5, false);
  const clumps: [number, number, number, number][] = k.near ? [[0, r * 1.65, 0, r * 0.8], [r * 0.45, r * 1.4, r * 0.2, r * 0.6], [-r * 0.4, r * 1.45, -r * 0.2, r * 0.62]] : [[0, r * 1.5, 0, r * 0.9]];
  for (const [x, y, z, s] of clumps) crown(k, leaves, x, y, z, s);
}

/** Builds a piece in its own frame. Walls run along x from -L to L with their outer face towards +z. */
export function buildPiece(k: Kit, navy: FactionId, p: Piece, L = 0) {
  switch (p.kind) {
    case 'bldg': return building(k, navy, p);
    case 'wall': return wall(k, navy, p.look, L, p.h, p.thick, p.crenel);
    case 'pass': return pass(k, navy, p);
    case 'pavilion': return pavilion(k, p);
    case 'turret': return turret(k, p);
    case 'yagura': return yagura(k, p);
    case 'tenshu': return tenshu(k);
    case 'yamen': return yamen(k);
    case 'box': return box(k, navy, p);
    case 'banner': return flag(k, navy, p);
    case 'soldiers': return soldiers(k, p);
    case 'stocks': return stocks(k, p);
    case 'tree': return tree(k, p.r);
  }
}
