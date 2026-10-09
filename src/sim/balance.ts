import type { Battle } from './battle';
import { SCENARIOS, type ScenarioId } from './scenarios';
import { OWNER_OF, teamOf, type Faction, type ShipMods } from './types';

export const FACTION_NAME: Record<Faction, string> = { joseon: '조선 수군', japan: '일본 수군', ming: '명 수군' };
export const FACTION_SHORT: Record<Faction, string> = { joseon: '조선', japan: '일본', ming: '명' };
export const FACTION_MARK: Record<Faction, string> = { joseon: '朝', japan: '倭', ming: '明' };

/** Factions the player can lead in a battle. The Ming fleet only sailed at Noryang. */
export function playableFactions(id: ScenarioId): Faction[] {
  return SCENARIOS[id].ming ? ['joseon', 'ming', 'japan'] : ['joseon', 'japan'];
}

export function commanderOf(id: ScenarioId, faction: Faction) {
  const s = SCENARIOS[id];
  return faction === 'ming' ? s.ming ?? s.joseon : s[faction];
}

export function forcesOf(id: ScenarioId, faction: Faction) {
  const f = SCENARIOS[id].forces;
  return faction === 'ming' ? f.ming ?? f.joseon : f[faction];
}

type Mods = Partial<ShipMods>;

/**
 * Corrections for leading a side the scenario was not written for. The battles are history: the Joseon fleet
 * won almost all of them, so a Japanese player facing the same odds would have no game. The numbers come from
 * computer-against-computer runs of each battle (scripts/balance.mjs).
 */
export type Handicap = {
  /** Multipliers for the ships on the player's side, allies included. */
  own?: Mods;
  /** Multipliers for the opposing side. */
  enemy?: Mods;
  /** Share of the opposing fleet still fighting when it flees. Left out keeps the scenario's value. */
  enemyRetreat?: number;
  /** Share of the opposing ships that sail, every squadron shrinking alike. The rest never reach the battle. */
  enemyFleet?: number;
  difficulty: string;
};

/** What a Japanese player gets over the computer's crews wherever the battle is not already theirs. */
const JAPAN_EDGE: Mods = { reload: 1.2, accuracy: 1.15, speed: 1.1, melee: 1.3, defense: 1.3, fire: 1.5 };
const JOSEON_SLACK: Mods = { reload: 0.65, accuracy: 0.65 };

const HANDICAPS: Partial<Record<ScenarioId, Partial<Record<Faction, Handicap>>>> = {
  okpo: { japan: { own: JAPAN_EDGE, enemy: JOSEON_SLACK, enemyFleet: 0.5, difficulty: '보통' } },
  sacheon: { japan: { own: JAPAN_EDGE, enemy: JOSEON_SLACK, enemyFleet: 0.17, difficulty: '보통' } },
  dangpo: { japan: { own: JAPAN_EDGE, enemy: JOSEON_SLACK, enemyFleet: 0.39, difficulty: '보통' } },
  hansan: { japan: { own: JAPAN_EDGE, enemy: JOSEON_SLACK, enemyFleet: 0.5, difficulty: '어려움' } },
  angolpo: { japan: { own: JAPAN_EDGE, enemy: JOSEON_SLACK, enemyFleet: 0.25, difficulty: '보통' } },
  busan: { japan: { difficulty: '쉬움' } },
  chilcheon: { japan: { difficulty: '쉬움' } },
  myeongnyang: { japan: { difficulty: '쉬움' } },
  noryang: { japan: { own: JAPAN_EDGE, enemy: JOSEON_SLACK, enemyFleet: 0.6, difficulty: '어려움' } },
};

export function handicap(id: ScenarioId, faction: Faction): Handicap {
  return HANDICAPS[id]?.[faction] ?? { difficulty: SCENARIOS[id].difficulty };
}

/** Hands the battle to the chosen faction and applies its corrections. Call once, right after the scenario is built. */
export function applyBalance(b: Battle, id: ScenarioId, faction: Faction) {
  b.humans = new Set([OWNER_OF[faction]]);
  const h = handicap(id, faction);
  const own = teamOf(faction);
  const enemy = own === 'joseon' ? 'japan' : 'joseon';
  if (h.enemyFleet !== undefined) {
    const stay = new Set<number>();
    for (const sq of b.squadrons) {
      if (sq.team !== enemy) continue;
      const keep = Math.round(sq.shipIds.length * h.enemyFleet);
      sq.shipIds.forEach((sid, i) => {
        if (i < keep) stay.add(sid);
      });
    }
    if (!stay.size) stay.add(b.ships.find((s) => s.team === enemy)!.id);
    b.removeShips((s) => s.team === enemy && !stay.has(s.id));
  }
  for (const s of b.ships) {
    const m = s.team === own ? h.own : h.enemy;
    if (!m) continue;
    for (const key of Object.keys(m) as (keyof ShipMods)[]) s.mods[key] *= m[key]!;
  }
  if (h.enemyRetreat !== undefined) b.retreatBelow[enemy] = h.enemyRetreat;
}
