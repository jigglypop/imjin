import layout from './atlasLayout.json';
import { SURF } from './surf';

export type Faction = 'joseon' | 'japan' | 'ming';

type Slot = { name: string; size?: number; sheet?: { cols: number; rows: number }; flags?: { name: string }[] };
const slots = layout.factions as unknown as Record<Faction, Slot[]>;

export const ATLAS = { grid: layout.grid, cell: layout.cell, pad: layout.pad };

/** Surface class by material name: drives roughness/metalness and cloth lighting. */
function surfOf(name: string) {
  if (/flag|maku|nobori|pennant/.test(name)) return SURF.banner;
  if (/sail|matting/.test(name)) return SURF.cloth;
  if (/bronze|iron|gold/.test(name)) return SURF.metal;
  if (/lacquer|gilt|glazed|scale|dancheong/.test(name)) return SURF.gloss;
  return SURF.wood;
}

export type Cell = { index: number; size: number; surf: number };

const cache = new Map<string, Cell>();

/** Atlas cell of a named material for a faction: index, metres per tile repeat, surface class. */
export function cellOf(faction: Faction, name: string): Cell {
  const key = `${faction}/${name}`;
  let c = cache.get(key);
  if (!c) {
    const index = slots[faction].findIndex((s) => s.name === name);
    if (index < 0) throw new Error(`atlas ${faction} has no cell ${name}`);
    c = { index, size: slots[faction][index]!.size ?? 1, surf: surfOf(name) };
    cache.set(key, c);
  }
  return c;
}

/** Uv rect (tile space, v up) of one flag inside its sheet cell. */
export function flagRect(faction: Faction, sheet: string, flag: string): { cell: number; rect: [number, number, number, number] } {
  const index = slots[faction].findIndex((s) => s.name === sheet);
  const slot = slots[faction][index];
  if (!slot?.sheet || !slot.flags) throw new Error(`atlas ${faction} has no sheet ${sheet}`);
  const f = slot.flags.findIndex((x) => x.name === flag);
  if (f < 0) throw new Error(`sheet ${sheet} has no flag ${flag}`);
  const { cols, rows } = slot.sheet;
  const c = f % cols;
  const r = Math.floor(f / cols);
  const inset = 0.012;
  return { cell: index, rect: [c / cols + inset, 1 - (r + 1) / rows + inset, (c + 1) / cols - inset, 1 - r / rows - inset] };
}

export function atlasFiles(faction: Faction, low: boolean) {
  const sfx = low ? '_1k' : '';
  const base = `/textures/ships/${faction}`;
  return { albedo: `${base}_albedo${sfx}.webp`, normal: `${base}_normal${sfx}.webp`, rough: `${base}_rough${sfx}.webp` };
}
