import { Paint, type PaintOpts } from '../../ships/build/parts';
import { SURF } from '../../ships/build/surf';
import layout from './buildingAtlas.json';
import type { FactionId } from './types';

// The campaign map's building atlases (buildingAtlas.json, made by scripts/ship-textures.mjs --set=buildings): one per navy,
// laid out like the ships' (src/ships/build/atlas.ts), so a building's vertices name their cell the same way and its
// material reads the cell's tile the way the battle's does. Pure TS: the kits and their tests use it in node.

type Slot = { name: string; size?: number; tile?: boolean; sheet?: { cols: number; rows: number }; flags?: { name: string }[] };
const slots = layout.factions as unknown as Record<FactionId, Slot[]>;

export const BUILDING_ATLAS = { grid: layout.grid, cell: layout.cell, pad: layout.pad };

/** Surface class by cell: cloth hangs matte, metal and gilt shine, lacquer and glaze are glossy, the rest is matte. */
function surfOf(name: string) {
  if (/banners|nobori|flags|maku/.test(name)) return SURF.banner;
  if (/canvas/.test(name)) return SURF.cloth;
  if (/bronze|gold/.test(name)) return SURF.metal;
  if (/pillar|lacquer|glazed|kawara/.test(name)) return SURF.gloss;
  return SURF.wood;
}

/** A navy's building paints by cell name: tiled cells repeat every `size` metres, a picture cell maps 0..1 over a face. */
export function buildingPaints(navy: FactionId) {
  const list = slots[navy];
  return (name: string, o: PaintOpts = {}) => {
    const index = list.findIndex((s) => s.name === name);
    if (index < 0) throw new Error(`building atlas ${navy} has no cell ${name}`);
    const slot = list[index]!;
    // A picture cell is inset a little so the shader's wrap never reaches the gutter.
    const rect = o.rect ?? (slot.tile ? undefined : ([0.01, 0.01, 0.99, 0.99] as [number, number, number, number]));
    return new Paint(index, o.size ?? slot.size ?? 1, o.surf ?? surfOf(name), o.tint ?? [1, 1, 1], rect);
  };
}

/** The paint of one banner of a navy's banner sheet: its cell with the banner's rect inside it. */
export function bannerPaint(navy: FactionId, flag: string, tint: [number, number, number] = [1, 1, 1]) {
  const index = slots[navy].findIndex((s) => s.sheet);
  const slot = slots[navy][index]!;
  const f = slot.flags!.findIndex((x) => x.name === flag);
  if (f < 0) throw new Error(`building atlas ${navy} has no banner ${flag}`);
  const { cols, rows } = slot.sheet!;
  const c = f % cols, r = Math.floor(f / cols), inset = 0.012;
  return new Paint(index, 1, SURF.banner, tint, [c / cols + inset, 1 - (r + 1) / rows + inset, (c + 1) / cols - inset, 1 - r / rows - inset]);
}

/** The atlas files of a navy's buildings. */
export const buildingAtlasFiles = (navy: FactionId) => {
  const base = `/textures/buildings/${navy}`;
  return { albedo: `${base}_albedo.webp`, normal: `${base}_normal.webp`, rough: `${base}_rough.webp` };
};
