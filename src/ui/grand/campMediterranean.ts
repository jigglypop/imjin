import { bannerPaint } from './buildingAtlas';
import type { PieceKind } from './campPieces';
import { at, banner, standard } from './campBuildings';
import { batter, block, column, picture, rect, roof, walls, type Kit, type RoofLook } from './kitParts';

// The towns and camps of the Lepanto theatre, on the European building atlas (buildingAtlas.json, 'england'), whose
// stone, rubble, lime plaster and red clay tiles serve the Mediterranean too. The forts are the European kit's stone
// curtains, keeps and round gun towers (Venice's and the Sultan's sea fortresses were masonry like them); what changes
// is the town round them: whitewashed houses of one or two storeys under low-pitched hipped roofs of curved clay tiles,
// a church with its square bell tower in the League's towns, a domed mosque with a minaret in the Ottoman ones, a
// tiled store in place of the thatched barn.
//
// The atlas's flag sheet has no Venetian lion or Ottoman crescent: the Holy League flies the red cross on white (the
// flag of Genoa, Doria's republic) and the Ottomans a plain crimson banner, both stand-ins until the atlas has their own.
//
// Modelled like campBuildings.ts: metres, the front towards +z, standing on y = 0.

/** A low Mediterranean roof: four shallow slopes of red clay tiles, a short ridge, a plain eave. */
const medRoof = (k: Kit, wall: ReturnType<Kit['P']>): RoofLook => ({
  tile: k.P('redtile'), edge: k.P('redtile', { tint: [0.8, 0.78, 0.78] }), under: k.P('timber'), ridge: k.P('ridge'), gable: wall,
});

/** A whitewashed house of two storeys on a rubble footing under a low hipped tile roof, small shuttered windows. */
function mdHouse(k: Kit) {
  const rubble = k.P('rubble'), lime = k.P('plaster');
  batter(k, rubble, rubble, 0, 0, 4.2, 2.9, 4.1, 2.8, -1.4, 0.3);
  walls(k, lime, rect(-3.8, -2.5, 3.8, 2.5), 0.3, 5.4);
  if (k.near) {
    picture(k, k.P('door'), -0.6, 0.6, 0.3, 2.4, 2.5, 1);
    for (const x of [-2.4, 2.4]) picture(k, k.P('window'), x - 0.45, x + 0.45, 1.3, 2.3, 2.5, 1);
    for (const x of [-2.4, 0, 2.4]) picture(k, k.P('window'), x - 0.45, x + 0.45, 3.4, 4.4, 2.5, 1);
  }
  roof(k, medRoof(k, lime), { ex: 4.3, ez: 3.0, y: 5.4, top: 6.9, form: 'hip', lift: 0, sag: 1, edge: 0.16, overhang: 0.5, ridgeW: 0.26, ridgeH: 0.22, rows: 2, cols: 4, trims: false });
}

/** A single-storey house or store: lime walls, a shallow tile roof. */
function mdCottage(k: Kit) {
  const rubble = k.P('rubble'), lime = k.P('plaster');
  batter(k, rubble, rubble, 0, 0, 3.6, 2.5, 3.5, 2.4, -1.4, 0.3);
  walls(k, lime, rect(-3.3, -2.2, 3.3, 2.2), 0.3, 3.0);
  if (k.near) {
    picture(k, k.P('door'), -2.2, -1.2, 0.3, 2.2, 2.2, 1);
    picture(k, k.P('window'), 0.6, 1.5, 1.2, 2.1, 2.2, 1);
  }
  roof(k, medRoof(k, lime), { ex: 3.8, ez: 2.7, y: 3.0, top: 4.2, form: 'hip', lift: 0, sag: 1, edge: 0.14, overhang: 0.45, ridgeW: 0.24, ridgeH: 0.2, rows: 1, cols: 3, trims: false });
}

/** A church of dressed stone under a tile roof, its square bell tower standing at one end with a pyramid cap. */
function mdChurch(k: Kit) {
  const stone = k.P('stone'), lime = k.P('plaster');
  batter(k, stone, stone, 0, 0, 6.1, 3.4, 6.0, 3.3, -1.4, 0.4);
  walls(k, lime, rect(-5.6, -3.0, 5.8, 3.0), 0.4, 6.4);
  if (k.near) for (const x of [-2.6, 0.6, 3.6]) for (const sz of [1, -1] as const) picture(k, k.P('window'), x - 0.5, x + 0.5, 3.0, 5.0, sz * 3.0, sz);
  roof(k, medRoof(k, lime), { ex: 6.2, ez: 3.5, y: 6.4, top: 8.6, form: 'gable', lift: 0, sag: 1, edge: 0.16, overhang: 0.5, verge: 0.3, ridgeW: 0.28, ridgeH: 0.24, rows: 2, cols: 4, trims: false });
  // The campanile: a slender square shaft, the belfry's openings near its top, a low pyramid roof.
  if (k.near) batter(k, stone, stone, -7.6, 0, 1.9, 1.9, 1.8, 1.8, -1.4, 0.4);
  walls(k, stone, rect(-9.2, -1.6, -6.0, 1.6), k.near ? 0.4 : -1.4, 15.5);
  if (k.near) for (const sz of [1, -1] as const) picture(k, k.P('window'), -8.1, -7.1, 12.6, 14.6, sz * 1.6, sz);
  if (k.near) at(k, -7.6, 0, 0, 0, () => roof(k, medRoof(k, stone), { ex: 2.0, ez: 2.0, y: 15.5, top: 18.0, form: 'pyramid', lift: 0, sag: 1, edge: 0.14, overhang: 0.3, ridgeW: 0.18, ridgeH: 0.16, rows: 1, cols: 2, trims: false }));
  else block(k, k.P('redtile'), [-9.3, 15.5, -1.7], [-5.9, 16.6, 1.7], 0);
  if (k.near) picture(k, k.P('door'), -0.8, 0.8, 0.4, 3.2, 3.0, 1);
}

/** A mosque: a square prayer hall of dressed stone under a lead-grey dome on a drum, a slender minaret with a conical cap. */
function otMosque(k: Kit) {
  const stone = k.P('stone'), lead = k.P('slate', { tint: [0.72, 0.74, 0.78] });
  const seg = k.near ? 14 : 6, mseg = k.near ? 8 : 4;
  batter(k, stone, stone, 0, 0, 5.0, 5.0, 4.9, 4.9, -1.4, 0.4);
  walls(k, stone, rect(-4.6, -4.6, 4.6, 4.6), 0.4, 6.6);
  block(k, stone.tinted([0.95, 0.95, 0.95]), [-4.7, 6.55, -4.7], [4.7, 6.8, 4.7], 0);
  // The drum, then the dome in rings narrowing to its crown (two far away).
  column(k, stone, 0, 0, 3.6, 3.6, 6.8, 7.8, seg, false);
  const rings = k.near
    ? ([[3.6, 3.35, 7.8, 8.9], [3.35, 2.6, 8.9, 9.9], [2.6, 1.45, 9.9, 10.7], [1.45, 0.1, 10.7, 11.1]] as const)
    : ([[3.6, 2.6, 7.8, 9.9], [2.6, 0.1, 9.9, 11.1]] as const);
  for (const [r0, r1, y0, y1] of rings) column(k, lead, 0, 0, r0, r1, y0, y1, seg, y1 === 11.1);
  // The minaret at a front corner: a shaft, its balcony, a pencil cap.
  const mx = 5.6, mz = 3.8;
  column(k, stone, mx, mz, 0.62, 0.55, -1.0, 15.2, mseg, false);
  if (k.near) {
    column(k, stone, mx, mz, 0.85, 0.85, -1.0, 1.0, mseg, false);
    column(k, stone, mx, mz, 0.95, 0.95, 12.4, 12.8, mseg, true);
  }
  column(k, lead, mx, mz, 0.6, 0.02, 15.2, 18.6, mseg, true);
  if (k.near) {
    picture(k, k.P('door'), -1.0, 1.0, 0.4, 3.6, 4.6, 1);
    for (const x of [-2.8, 2.8]) picture(k, k.P('window'), x - 0.55, x + 0.55, 2.4, 4.6, 4.6, 1);
  }
}

/** A tiled store of rubble walls, a wide door in its side: the granary of the Mediterranean ports. */
function mdGranary(k: Kit) {
  const rubble = k.P('rubble');
  batter(k, rubble, rubble, 0, 0, 5.4, 3.4, 5.3, 3.3, -1.6, 0.3);
  walls(k, rubble, rect(-5.0, -3.0, 5.0, 3.0), 0.3, 4.0);
  picture(k, k.P('planks'), -1.3, 1.3, 0.3, 3.2, 3.0, 1);
  roof(k, medRoof(k, rubble), { ex: 5.5, ez: 3.5, y: 4.0, top: 5.8, form: 'hip', lift: 0, sag: 1, edge: 0.16, overhang: 0.5, ridgeW: 0.26, ridgeH: 0.22, rows: 2, cols: 4, trims: false });
}

/** The banners of the two navies in the European atlas's sheet (see the note above). */
const leagueFlag = () => bannerPaint('england', 'england');
const ottomanFlag = () => bannerPaint('england', 'castile', [0.86, 0.8, 0.8]);

/** The kits of the Lepanto theatre's own pieces, merged into campBuildings.ts's catalogue. */
export const MEDITERRANEAN_KITS: Partial<Record<PieceKind, (k: Kit) => void>> = {
  md_house: mdHouse, md_cottage: mdCottage, md_church: mdChurch, ot_mosque: otMosque, md_granary: mdGranary,
  hl_banner: (k) => banner(k, k.P('timber'), leagueFlag(), 0, 6.4, 1.6, 1.1),
  ot_banner: (k) => banner(k, k.P('timber'), ottomanFlag(), 0, 6.4, 1.6, 1.1),
  hl_standard: (k) => standard(k, leagueFlag(), k.P('stone')),
  ot_standard: (k) => standard(k, ottomanFlag(), k.P('stone')),
};
