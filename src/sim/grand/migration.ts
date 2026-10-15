import { GARRISON_KIND, garrisonCap } from './economy';
import { ADDED_PORTS, LEGACY_REGION_ORDER, PORT_EXPANSION_PARENT, REGIONS, START } from './regions';
import { ensureOfficers } from './officers';
import { spawnShip } from './roster';
import type { BuildingKind, Grand, RegionState } from './types';
import { GRAND_FACTIONS } from './types';

const regionState = (value: unknown): value is RegionState => {
  if (!value || typeof value !== 'object') return false;
  const r = value as RegionState;
  return (r.owner === null || GRAND_FACTIONS.includes(r.owner)) && Array.isArray(r.buildings) && Array.isArray(r.garrison) && Array.isArray(r.queue);
};

/**
 * Expand an otherwise complete v1 save before its full REGION_ORDER validation. Existing holdings, ships, routes,
 * queues, treasury, battle outcomes and RNG are untouched. New ports follow current surrounding control, not a
 * reset to the opening front; unowned surroundings stay unowned. A save with growth rules counts each new port into its
 * owner's starting holding, so only later conquests advance the objective. Returns the number of ports actually added.
 */
export function migrateGrandRegions(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0;
  const g = raw as Grand;
  if (g.version !== 1 || !g.regions || !g.rng || !Array.isArray(g.fleets) || !Array.isArray(g.pending) || !Number.isSafeInteger(g.nextId) || g.nextId < 0 || !GRAND_FACTIONS.every((f) => g.factions?.[f])) return 0;
  // An incomplete/corrupt original map is not an older twelve-region campaign and must still fail validation.
  if (!LEGACY_REGION_ORDER.every((id) => regionState(g.regions[id]))) return 0;
  const missing = ADDED_PORTS.filter((id) => g.regions[id] === undefined);
  if (!missing.length) return 0;

  // Retain uniqueness even if an old save's nextId counter lagged behind an extant ship or construction job.
  let counter = g.nextId;
  const remember = (id: unknown) => {
    if (typeof id !== 'string' || !/^[sfq]\d+$/.test(id)) return;
    const n = Number(id.slice(1));
    if (Number.isSafeInteger(n)) counter = Math.max(counter, n);
  };
  for (const r of Object.values(g.regions)) if (regionState(r)) {
    for (const unit of r.garrison) remember(unit?.id);
    for (const job of r.queue) remember(job?.id);
  }
  for (const fleet of g.fleets) {
    remember(fleet?.id);
    for (const unit of Array.isArray(fleet?.ships) ? fleet.ships : []) remember(unit?.id);
  }
  g.nextId = counter;
  for (const id of missing) {
    const owner = g.regions[PORT_EXPANSION_PARENT[id]].owner;
    const r: RegionState = { owner, buildings: [], garrison: [], queue: [], unrest: 0 };
    for (const [kind, level] of Object.entries(START.buildings[id] ?? {}) as [BuildingKind, number][]) r.buildings.push({ kind, level, upgradeLeft: 0, hp: 1 });
    g.regions[id] = r;
    if (owner) for (let i = 0; i < garrisonCap(id, r); i += 1) r.garrison.push(spawnShip(g, GARRISON_KIND[owner]));
    // A port that comes with the save is part of what its owner already held, not growth toward the objective.
    if (owner && g.victoryRules?.initialControl) g.victoryRules.initialControl[owner] += REGIONS[id].value;
  }
  return missing.length;
}

/**
 * Gives a save made before the officers (officers.ts) its roster: officer records for its commanders, the named figures
 * present at the start, an empty board of recruits and cards. The figures whose dates have passed arrive at the next
 * turn. Nothing else in the save changes. Returns whether anything was added.
 */
export function migrateGrandOfficers(raw: unknown): boolean {
  const g = raw as Grand;
  if (!g || typeof g !== 'object' || g.officers || !GRAND_FACTIONS.every((f) => Array.isArray(g.factions?.[f]?.commanders))) return false;
  ensureOfficers(g);
  return true;
}
