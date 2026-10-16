import type { Battle } from '../sim/battle';
import type { Team } from '../sim/types';
import { generalById } from './catalog';
import { generalMods, type Profile } from './rules';

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
