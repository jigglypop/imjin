import type { Faction } from '../sim/types';

/** Architectural styles the per-nation building models are made in (scripts/building-models.mjs). */
export type BuildingNation = 'joseon' | 'japan' | 'ming' | 'spain' | 'england' | 'ottoman' | 'venice' | 'france';
/** Every building kind with a model, a superset of the conquest works and the campaign's buildings. */
export type BuildingModelKind = 'fortress' | 'arsenal' | 'shipyard' | 'battery' | 'magazine' | 'dock' | 'beacon' | 'camp';

/** The navy of a battle builds in its nation's style; the 1805 navies share their country's. */
export const NATION_OF_FACTION: Record<Faction, BuildingNation> = {
  joseon: 'joseon',
  japan: 'japan',
  ming: 'ming',
  england: 'england',
  spain: 'spain',
  holyleague: 'venice',
  ottoman: 'ottoman',
  britain: 'england',
  france: 'france',
  spain1805: 'spain',
};

const ALL: readonly BuildingModelKind[] = ['fortress', 'arsenal', 'shipyard', 'battery', 'magazine', 'dock', 'beacon', 'camp'];

/** The models that exist under public/models/buildings/<nation>/<kind>.glb (and <kind>_lod1.glb). */
const MADE: Record<BuildingNation, readonly BuildingModelKind[]> = {
  joseon: ALL,
  // Off-style models are left out rather than patched (owner rule): japan magazine (stray planes), england camp (one
  // house), ottoman shipyard/dock (church spires) and camp (one dome).
  japan: ALL.filter((k) => k !== 'magazine'),
  // ming shipyard, france shipyard and venice camp came out as broken shells (review 2026-10-19): shared models.
  ming: ALL.filter((k) => k !== 'shipyard'),
  spain: ['shipyard', 'battery', 'dock', 'camp', 'magazine'],
  england: ['shipyard', 'battery', 'dock', 'magazine'],
  ottoman: ['battery'],
  venice: ['shipyard', 'battery', 'dock'],
  france: ['battery', 'dock', 'camp'],
};

/** The shared model of public/models/env/ a kind falls back to when its nation has none. */
const FALLBACK: Record<BuildingModelKind, string> = {
  fortress: 'fortgate',
  arsenal: 'magazine',
  shipyard: 'shipyard',
  battery: 'battery',
  magazine: 'magazine',
  dock: 'dock',
  beacon: 'bongsu',
  camp: 'giwa',
};

export const hasNationModel = (nation: BuildingNation, kind: BuildingModelKind) => MADE[nation].includes(kind);

/**
 * The .glb of a building: the nation's own model when one was made, else the shared one. `lod` 1 is the far model.
 * Without a nation (an unheld port) the shared model is used.
 */
export function buildingModelUrl(nation: BuildingNation | null | undefined, kind: BuildingModelKind, lod: 0 | 1 = 0): string {
  const suffix = lod ? '_lod1' : '';
  if (nation && hasNationModel(nation, kind)) return `/models/buildings/${nation}/${kind}${suffix}.glb`;
  return `/models/env/${FALLBACK[kind]}${suffix}.glb`;
}

export const buildingModelUrlFor = (faction: Faction | null | undefined, kind: BuildingModelKind, lod: 0 | 1 = 0) =>
  buildingModelUrl(faction ? NATION_OF_FACTION[faction] : null, kind, lod);
