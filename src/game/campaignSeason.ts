// The campaign's season in the battle's 3D view: a turn is a season (three months, economy.ts `dateOf`), so the land
// and the woods follow the turn. Foliage is Terrain.season's scale (0 summer, about 0.5 autumn, 1 winter).

export type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter';

export function seasonOfMonth(month: number): SeasonName {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

/** `?season=winter` (spring, summer, autumn) shows that season whatever the turn: for review shots. */
export function viewSeason(month: number): SeasonName {
  const forced = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('season');
  return forced === 'spring' || forced === 'summer' || forced === 'autumn' || forced === 'winter' ? forced : seasonOfMonth(month);
}

export const SEASON_FOLIAGE: Record<SeasonName, number> = { spring: 0.08, summer: 0, autumn: 0.55, winter: 1 };
