import type { ShipKind } from '../sim/types';
import { anchorsFor } from './anchors';
import { useProcedural } from './build/mode';

/**
 * Deck heights above the waterline for each ship model, measured by casting down through the meshes. The main
 * deck is the fighting deck: the open deck inside the panokseon's shield walls, the floor of the atakebune's
 * fortress, the gun deck under the turtle ship's roof. Big ships row from an enclosed deck below it.
 */
export const MAIN_DECK: Record<string, number> = {
  'panokseon#0': 3.9,
  'panokseon#1': 4.0,
  'panokseon#2': 3.75,
  'atakebune#0': 3.75,
  'sekibune#0': 1.5,
  'hyeopseon#0': 1.0,
  'kobaya#0': 0.75,
  'mingship#0': 2.5,
  'mingsmall#0': 0.75,
  'geobukseon#0': 4.7,
};

export type DeckPlan = {
  /** Rowers' deck below the main deck, metres under it. 0: they row on the main deck. */
  oarDrop: number;
  /** The main deck lies under open sky, so its crew show without a cutaway. */
  open: boolean;
  /** Usable deck as fractions of length and beam. */
  length: number;
  beam: number;
  /** Command platform: along-ship position as a fraction of length, height above the main deck. */
  command: { x: number; up: number } | null;
  /** Figures drawn for a full crew, by station. */
  figures: { oar: number; gun: number; shot: number; melee: number };
  /** Oars per side, for rower stations and the oar ports. */
  oars: number;
};

export const DECKS: Record<ShipKind, DeckPlan> = {
  panokseon: { oarDrop: 1.9, open: true, length: 0.66, beam: 0.72, command: { x: -0.12, up: 3.2 }, figures: { oar: 24, gun: 14, shot: 12, melee: 8 }, oars: 8 },
  geobukseon: { oarDrop: 2.5, open: false, length: 0.62, beam: 0.62, command: null, figures: { oar: 20, gun: 12, shot: 2, melee: 4 }, oars: 8 },
  hyeopseon: { oarDrop: 0, open: true, length: 0.6, beam: 0.5, command: null, figures: { oar: 8, gun: 2, shot: 2, melee: 1 }, oars: 4 },
  atakebune: { oarDrop: 2.2, open: true, length: 0.6, beam: 0.68, command: { x: -0.05, up: 4 }, figures: { oar: 26, gun: 4, shot: 16, melee: 12 }, oars: 13 },
  sekibune: { oarDrop: 0, open: true, length: 0.66, beam: 0.55, command: null, figures: { oar: 14, gun: 0, shot: 8, melee: 6 }, oars: 7 },
  kobaya: { oarDrop: 0, open: true, length: 0.62, beam: 0.5, command: null, figures: { oar: 8, gun: 0, shot: 3, melee: 3 }, oars: 4 },
  mingship: { oarDrop: 1.4, open: true, length: 0.6, beam: 0.66, command: { x: -0.3, up: 3 }, figures: { oar: 16, gun: 12, shot: 12, melee: 8 }, oars: 8 },
  mingsmall: { oarDrop: 0, open: true, length: 0.6, beam: 0.55, command: null, figures: { oar: 10, gun: 2, shot: 4, melee: 3 }, oars: 5 },
};

export function mainDeck(key: string, kind: ShipKind, fallback: number) {
  const built = useProcedural(kind) ? anchorsFor(key)?.mainDeck : undefined;
  return built ?? MAIN_DECK[key] ?? MAIN_DECK[`${kind}#0`] ?? fallback;
}

/** Cutaway heights by level: 1 lifts off roofs and towers, 2 the deck walls, 3 the main deck itself to show the rowers. */
export function cutHeight(level: number, main: number, plan: DeckPlan) {
  if (level === 1) return main + 2.4;
  if (level === 2) return main + 0.9;
  return plan.oarDrop > 0 ? main - 0.35 : main + 0.9;
}
