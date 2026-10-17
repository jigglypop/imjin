import type { Battle } from '../sim/battle';
import type { Team } from '../sim/types';
import { generalById } from './catalog';
import { generalMods, type BattleReport, type Profile } from './rules';

/** The account general a squadron's portrait shows ('portrait_yi' is Yi Sun-sin), if he is one an account raises. */
export function generalOfPortrait(portrait: string): string | undefined {
  const id = portrait.replace(/^portrait_/, '').replace(/_sm$/, '');
  return generalById(id) ? id : undefined;
}

/** The account's generals who lead squadrons of a team, in squadron order, each once. */
export function teamGenerals(b: Battle, team: Team): string[] {
  const out: string[] = [];
  for (const sq of b.squadrons) {
    if (sq.team !== team) continue;
    const id = generalOfPortrait(sq.portrait);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Gives every ship of a squadron of `team` led by one of the account's generals what that general brings (rules.ts
 * generalMods), and returns the generals it applied. Called once on a freshly built single-player battle, before its
 * first step, so the battle stays deterministic from there; online and ranked battles are built by the server and never
 * pass through here.
 */
export function applyGenerals(b: Battle, team: Team, p: Profile): string[] {
  const applied: string[] = [];
  for (const sq of b.squadrons) {
    if (sq.team !== team) continue;
    const id = generalOfPortrait(sq.portrait);
    if (!id) continue;
    const m = generalMods(p, id);
    for (const shipId of sq.shipIds) {
      const s = b.get(shipId);
      if (!s) continue;
      for (const k of Object.keys(m) as (keyof typeof m)[]) s.mods[k] *= m[k];
    }
    if (!applied.includes(id)) applied.push(id);
  }
  return applied;
}

/**
 * The report of a finished battle for one side (rules.ts rewardFor): the result, enemy ships sunk and own ships lost,
 * and each account general who led there with the ships his squadron sank. `owner` narrows a team to one seat's
 * squadrons (a conquest seat); squadrons without an owner count for every seat of their team. Stars: a victory earns
 * one, a second for losing at most a third of the fleet, a third for losing none.
 */
export function battleReport(b: Battle, team: Team, owner: number | null, mode: BattleReport['mode'], scenario: string, side: string): BattleReport {
  const own = b.ships.filter((s) => s.team === team);
  const enemy = b.ships.filter((s) => s.team !== team);
  const gone = (s: Battle['ships'][number]) => !s.alive || s.sinking > 0;
  const sunk = enemy.filter(gone).length;
  const lost = own.filter(gone).length;
  const result: BattleReport['result'] = b.draw || !b.winner ? 'draw' : b.winner === team ? 'win' : 'loss';
  const stars = result !== 'win' ? 0 : lost === 0 ? 3 : lost * 3 <= own.length ? 2 : 1;
  const generals: BattleReport['generals'] = [];
  for (const sq of b.squadrons) {
    if (sq.team !== team || (owner !== null && sq.owner >= 0 && sq.owner !== owner)) continue;
    const id = generalOfPortrait(sq.portrait);
    if (!id) continue;
    let kills = 0;
    for (const shipId of sq.shipIds) kills += b.get(shipId)?.kills ?? 0;
    const known = generals.find((g) => g.id === id);
    if (known) known.sunk = Math.min(sunk, known.sunk + kills);
    else generals.push({ id, sunk: Math.min(sunk, kills) });
  }
  return { mode, scenario, side, result, stars, sunk, lost, simSeconds: Math.floor(b.time), generals };
}
