import type { ShipKind } from '../types';
import { BONUS_CAP, BONUS_KEYS, FIGURE_BY_ID, OFFICERS, SKILL_BY_ID, TRAIT_BY_ID, type Bonus, type BonusKey } from './officerData';
import type { Commander, Fleet, Grand, GrandFaction, RegionId } from './types';

/**
 * What the officers add to the rules: a fleet's bonus from its commander and lieutenants, the seats he has for
 * lieutenants, a port's income from the officers lying there. Read by the settled fight, the 3D battle hand-off, the
 * march rules and the economy; it changes nothing.
 */

export type FleetBonus = Record<BonusKey, number>;

const ZERO = (): FleetBonus => Object.fromEntries(BONUS_KEYS.map((k) => [k, 0])) as FleetBonus;

const add = (into: FleetBonus, b: Bonus, share = 1) => {
  for (const [k, v] of Object.entries(b) as [BonusKey, number][]) into[k] += v * share;
};

/** Able to take a command: alive, not wounded, not held by the enemy. */
export const officerReady = (c: Commander) => c.alive && !(c.officer && (c.officer.wounded > 0 || c.officer.captive > 0));

export const officerById = (g: Grand, f: GrandFaction, id: string | null | undefined) => (id ? g.factions[f].commanders.find((c) => c.id === id) : undefined);

/** Each officer's own bonus, remembered while his traits and skills stay the same (the map, the march and the economy ask often). */
const ownCache = new WeakMap<Commander, { sig: string; bonus: FleetBonus }>();

/** Everything one officer brings: his traits, his skills and, for a named figure, his own ability. Do not change the result. */
export function ownBonus(c: Commander): FleetBonus {
  const sig = `${c.officer?.origin}|${c.officer?.traits.join(',')}|${c.officer?.skills.join(',')}`;
  const hit = ownCache.get(c);
  if (hit && hit.sig === sig) return hit.bonus;
  const b = ZERO();
  for (const id of c.officer?.traits ?? []) {
    const t = TRAIT_BY_ID.get(id);
    if (t) add(b, t.bonus);
  }
  for (const id of c.officer?.skills ?? []) {
    const s = SKILL_BY_ID.get(id);
    if (s) add(b, s.bonus);
  }
  const fig = FIGURE_BY_ID.get(c.id);
  if (fig && c.officer?.origin === 'history') add(b, fig.ability.bonus);
  ownCache.set(c, { sig, bonus: b });
  return b;
}

const clampBonus = (b: FleetBonus): FleetBonus => {
  for (const k of BONUS_KEYS) b[k] = Math.max(BONUS_CAP[k][0], Math.min(BONUS_CAP[k][1], b[k]));
  return b;
};

/** Lieutenant seats under an officer: one, one more per two levels, and the seats his skills add, at most three. */
export function lieutenantSlots(c: Commander): number {
  const fromSkills = (c.officer?.skills ?? []).reduce((n, id) => n + (SKILL_BY_ID.get(id)?.bonus.slots ?? 0), 0);
  return Math.min(OFFICERS.slotsMax, OFFICERS.slotsBase + Math.floor((c.level - 1) / OFFICERS.slotsPerLevels) + fromSkills);
}

/** The fleet's lieutenants who can serve now. */
export function lieutenantsOf(g: Grand, fl: Fleet): Commander[] {
  return (fl.lieutenants ?? []).flatMap((id) => {
    const c = officerById(g, fl.faction, id);
    return c && officerReady(c) ? [c] : [];
  });
}

/** The fleet's bonus: its commander's in full and a share of each lieutenant's, within the caps. Zero for a fleet without officers. */
export function fleetBonus(g: Grand, fl: Fleet): FleetBonus {
  const b = ZERO();
  if (((globalThis as any).process?.env?.OFFX ?? '').includes('all')) return b; // TEMPX
  const cmd = officerById(g, fl.faction, fl.commanderId);
  if (cmd && officerReady(cmd)) add(b, ownBonus(cmd));
  for (const lt of lieutenantsOf(g, fl)) add(b, ownBonus(lt), OFFICERS.lieutenantShare);
  b.slots = 0;
  return clampBonus(b);
}

/** The fleet an officer commands or serves in, if any. */
export function postOf(g: Grand, c: Commander): { fleet: Fleet; role: 'commander' | 'lieutenant' } | null {
  for (const fl of g.fleets) {
    if (fl.faction !== c.faction) continue;
    if (fl.commanderId === c.id) return { fleet: fl, role: 'commander' };
    if (fl.lieutenants?.includes(c.id)) return { fleet: fl, role: 'lieutenant' };
  }
  return null;
}

/** The port an officer is in: his fleet's when it lies in port, else where he waits. Null at sea. */
export function placeOf(g: Grand, c: Commander): RegionId | null {
  const post = postOf(g, c);
  if (post) return post.fleet.at;
  return c.officer?.at ?? null;
}

/** Officers of the port's owner lying there, ready to serve, of those `wanted` picks (checked first, as it is cheap). */
function officersAt(g: Grand, id: RegionId, wanted: (c: Commander) => boolean): Commander[] {
  const owner = g.regions[id]?.owner;
  if (!owner) return [];
  return g.factions[owner].commanders.filter((c) => c.officer && wanted(c) && officerReady(c) && placeOf(g, c) === id);
}

/** Extra share of a port's income from the best steward lying there (둔전, 축성 ...). */
export function portIncomeBonus(g: Grand, id: RegionId): number {
  if (!g.officers) return 0;
  let best = 0;
  for (const c of officersAt(g, id, (x) => ownBonus(x).income > 0)) best = Math.max(best, ownBonus(c).income);
  return Math.min(BONUS_CAP.income[1], best);
}

const shipsOf = (c: Commander) => (c.officer?.origin === 'history' ? FIGURE_BY_ID.get(c.id)?.ability.ships : undefined);

/** Share off the price of a ship of `kind` built at the port, from a named shipbuilder lying there (나대용, 구키). */
export function shipPriceCut(g: Grand, id: RegionId, kind: ShipKind): number {
  if (!g.officers) return 0;
  let best = 0;
  for (const c of officersAt(g, id, (x) => !!shipsOf(x)?.kinds.includes(kind))) best = Math.max(best, shipsOf(c)!.cut);
  return best;
}

/** Share off what the navy pays for officers, from its best recruiter. */
export function hireCut(g: Grand, f: GrandFaction): number {
  let best = 0;
  for (const c of g.factions[f].commanders) if (c.officer && officerReady(c)) best = Math.max(best, ownBonus(c).hire);
  return Math.min(BONUS_CAP.hire[1], best);
}
