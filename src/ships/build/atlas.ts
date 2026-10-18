import layout from './atlasLayout.json';
import { SURF } from './surf';
import aspects from './flagAspect.json';
import kindAtlas from './kindAtlas.json';

export type Faction = 'joseon' | 'japan' | 'ming' | 'england' | 'spain' | 'holyleague' | 'ottoman' | 'britain' | 'france' | 'spain1805';

type Slot = { name: string; size?: number; aspect?: number; sheet?: { cols: number; rows: number }; flags?: { name: string; aspect?: number }[] };
const slots = layout.factions as unknown as Record<Faction, Slot[]>;

export const ATLAS = { grid: layout.grid, cell: layout.cell, pad: layout.pad };

/** Surface class by material name: drives roughness/metalness and cloth lighting. */
function surfOf(name: string) {
  if (/flag|maku|nobori|pennant/.test(name)) return SURF.banner;
  if (/sail|matting/.test(name)) return SURF.cloth;
  if (/bronze|iron|gold/.test(name)) return SURF.metal;
  if (/lacquer|gilt|glazed|scale/.test(name)) return SURF.gloss;
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

/**
 * Where a flag's picture sits in its slot of a sheet (all in the same unit, the slot `sw` x `sh`): the largest centred
 * box of the flag's aspect (width / height), so the cloth can be cut to the picture and its lettering is never
 * stretched. scripts/ship-textures.mjs places the picture with the same rule.
 */
export function fitAspect(sw: number, sh: number, aspect: number) {
  const w = Math.min(sw, sh * aspect);
  const h = w / aspect;
  return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
}

export type FlagRect = { cell: number; rect: [number, number, number, number]; aspect: number };

/** Sheet slot of one flag: its picture's uv rect (tile space, v up) inside the sheet cell and the picture's aspect. */
export function sheetFlagRect(sheet: { cols: number; rows: number }, flags: { name: string; aspect?: number }[], flag: string): Omit<FlagRect, 'cell'> {
  const f = flags.findIndex((x) => x.name === flag);
  if (f < 0) throw new Error(`sheet has no flag ${flag}`);
  const { cols, rows } = sheet;
  const aspect = flags[f]!.aspect ?? 1;
  const box = fitAspect(1 / cols, 1 / rows, aspect);
  const u0 = (f % cols) / cols + box.x;
  const v1 = 1 - Math.floor(f / cols) / rows - box.y;
  // A little in from the picture's edge, so the mipmaps of a far flag do not take in its neighbour.
  const inset = 0.006;
  return { rect: [u0 + inset, v1 - box.h + inset, u0 + box.w - inset, v1 - inset], aspect };
}

/** Uv rect (tile space, v up) of one flag inside its sheet cell, and the width / height its cloth must have. */
export function flagRect(faction: Faction, sheet: string, flag: string): FlagRect {
  const index = slots[faction].findIndex((s) => s.name === sheet);
  const slot = slots[faction][index];
  if (!slot?.sheet || !slot.flags) throw new Error(`atlas ${faction} has no sheet ${sheet}`);
  return { cell: index, ...sheetFlagRect(slot.sheet, slot.flags, flag) };
}

/** Uv rect of a picture cell drawn at an aspect of its own (the maku curtain), and that aspect. */
export function pictureRect(faction: Faction, name: string): { rect: [number, number, number, number]; aspect: number } {
  const slot = slots[faction].find((s) => s.name === name);
  if (!slot) throw new Error(`atlas ${faction} has no cell ${name}`);
  const aspect = slot.aspect ?? 1;
  const box = fitAspect(1, 1, aspect);
  const inset = 0.01;
  return { rect: [box.x + inset, box.y + inset, box.x + box.w - inset, box.y + box.h - inset], aspect };
}

/**
 * Width and height of a flag of about the area `w` x `h` cut to its picture's aspect, so a flag sized by eye keeps its
 * size on the ship while its lettering keeps its proportions.
 */
export function clothSize(w: number, h: number, aspect: number): [number, number] {
  const area = w * h;
  return [Math.sqrt(area * aspect), Math.sqrt(area / aspect)];
}

/** Width over height of a vector-drawn flag (scripts/draw-flags.mjs), so its cloth is cut to the design; undefined for the 1592 sheets. */
export function flagAspect(faction: Faction, sheet: string, flag: string): number | undefined {
  return (aspects as Record<string, number>)[`${faction}/${sheet}/${flag}`];
}

/** Kinds with an atlas of their own (the navy's with their hull, upper works and stern swapped, kindAtlas.json). */
const KIND_ATLAS = new Set(Object.keys(kindAtlas.kinds));
export const hasKindAtlas = (kind: string) => KIND_ATLAS.has(kind);

/** The atlas files of a navy, or of one ship when `kind` has its own (`low`: the 1k set). */
export function atlasFiles(faction: Faction, low: boolean, kind?: string) {
  const sfx = low ? '_1k' : '';
  const base = kind && KIND_ATLAS.has(kind) ? `/textures/ships/kinds/${kind}` : `/textures/ships/${faction}`;
  return { albedo: `${base}_albedo${sfx}.webp`, normal: `${base}_normal${sfx}.webp`, rough: `${base}_rough${sfx}.webp` };
}
