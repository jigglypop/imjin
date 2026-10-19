// The buildings of the account's home port (본진), with no imports so the profile rules (rules.ts) can clean the stored
// levels without a cycle. The rules that use them are src/meta/port.ts; the 3D harbour is src/port/PortScene.ts.

export type BuildingId = 'shipyard' | 'arsenal' | 'fortress';
export const BUILDING_IDS: readonly BuildingId[] = ['shipyard', 'arsenal', 'fortress'];

export type BuildingDef = {
  id: BuildingId;
  name: string;
  hanja: string;
  /** What one level gives, one line for the card (Korean source text). */
  line: string;
  /** The level every port starts at, and the highest. */
  start: number;
  max: number;
  /** Coins to raise the building to a level, by that level. */
  cost: Record<number, number>;
  /** Another building the next level needs, at `level - offset` (at least 1). */
  needs?: { id: BuildingId; offset: number };
};

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  shipyard: { id: 'shipyard', name: '조선소', hanja: '造船所', line: '레벨마다 더 큰 함선을 지을 수 있습니다', start: 1, max: 3, cost: { 2: 2500, 3: 6000 }, needs: { id: 'arsenal', offset: 1 } },
  arsenal: { id: 'arsenal', name: '병기창', hanja: '兵器廠', line: '레벨마다 함선 건조 값이 5% 내려갑니다', start: 0, max: 3, cost: { 1: 1500, 2: 3500, 3: 7000 } },
  fortress: { id: 'fortress', name: '요새', hanja: '要塞', line: '레벨마다 전투 보상 엽전이 10% 늘어납니다', start: 0, max: 3, cost: { 1: 2000, 2: 4500, 3: 9000 }, needs: { id: 'shipyard', offset: 0 } },
};

/** Share of a hull's price the arsenal takes off per level. */
export const ARSENAL_DISCOUNT = 0.05;
/** Share the fortress adds to a battle's coins (not the one-time bonuses) per level. */
export const FORTRESS_BONUS = 0.1;

export type PortLevels = Partial<Record<BuildingId, number>>;

export const buildingLevel = (port: PortLevels | undefined, id: BuildingId): number => port?.[id] ?? BUILDINGS[id].start;

/** Stored levels, clamped; a level at the start value is not stored. */
export function cleanPort(raw: unknown): PortLevels {
  const out: PortLevels = {};
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const id of BUILDING_IDS) {
    const b = BUILDINGS[id];
    const n = r[id];
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    const level = Math.max(b.start, Math.min(b.max, Math.floor(n)));
    if (level !== b.start) out[id] = level;
  }
  return out;
}
