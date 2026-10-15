import { SCENARIO_ORDER, SCENARIOS, type ScenarioId } from './scenarios';
import { CONQUEST_MAPS, type ConquestMapId } from './maps';
import type { TerrainSpec } from '../terrain/generate';
import type { SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';
import type { CurrentSpec } from './current';
import { environmentFor, type BattleEnvironment } from './environment';
import type { CoastalFormationKind } from './coastal-tactics';

/** What the engine needs to stage a battle, whether one of the nine historical ones or a conquest map. */
export type BattleInfo = {
  mode: 'scenario' | 'conquest';
  id: string;
  title: string;
  hanja: string;
  date: string;
  place: string;
  season: string;
  sky: SkyPresetName;
  sea: SeaStateName;
  night: boolean;
  terrain: TerrainSpec;
  current?: CurrentSpec;
  environment?: BattleEnvironment;
  coastalTactic?: CoastalFormationKind;
  view: { tx: number; tz: number; dir: number; dist: number; pitch: number };
  /** 0 summer green to 1 winter, for the forests. */
  foliage: number;
  /** The historical battle whose picture the loading screen shows. A campaign region's battle borrows the picture of the coast it is fought on. */
  art?: ScenarioId;
};

/** What the loading screen shows of a battle: its picture, name, date and place; a historical one also lists its two navies. */
export type BattleCard = Pick<BattleInfo, 'title' | 'hanja' | 'date' | 'place' | 'night'> & { art: ScenarioId; scenario?: ScenarioId };

export function battleCard(info: BattleInfo): BattleCard {
  return { art: info.art ?? 'hansan', title: info.title, hanja: info.hanja, date: info.date, place: info.place, night: info.night, scenario: info.mode === 'scenario' ? (info.id as ScenarioId) : undefined };
}

/** The historical battle fought nearest each conquest map, whose picture its loading screen shows. */
const CONQUEST_ART: Record<ConquestMapId, ScenarioId> = { hallyeo: 'hansan', gyeonnaeryang: 'dangpo' };

/**
 * The picture for a battle fought on other ground than a historical one: the battle named for that coast, else the one
 * whose terrain it borrows, else the fallback. A night fight shows the nearest night battle (and a day fight the nearest
 * day one) so the picture keeps the light the battle loads into.
 */
export function artFor(terrain: TerrainSpec, night: boolean, named?: ScenarioId | null, fallback: ScenarioId = 'hansan'): ScenarioId {
  const base = named ?? SCENARIO_ORDER.find((id) => SCENARIOS[id].terrain.seed === terrain.seed) ?? fallback;
  if (SCENARIOS[base].night === night) return base;
  const at = SCENARIOS[base].map;
  let best = base;
  let bestD = Infinity;
  for (const id of SCENARIO_ORDER) {
    if (SCENARIOS[id].night !== night) continue;
    const d = (SCENARIOS[id].map.x - at.x) ** 2 + (SCENARIOS[id].map.y - at.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

const FOLIAGE: Record<ScenarioId, number> = { okpo: 0.1, sacheon: 0.05, dangpo: 0, hansan: 0, angolpo: 0, busan: 0.6, chilcheon: 0, myeongnyang: 0.72, noryang: 1 };

export function scenarioInfo(id: ScenarioId): BattleInfo {
  const s = SCENARIOS[id];
  return { mode: 'scenario', id, art: id, title: s.title, hanja: s.hanja, date: s.date, place: s.place, season: s.season, sky: s.sky, sea: s.sea, night: s.night, terrain: s.terrain, current: s.current, view: s.view, foliage: FOLIAGE[id] ?? 0 };
}

export function conquestInfo(id: ConquestMapId, seed = 1592, ranked = false): BattleInfo {
  const m = CONQUEST_MAPS[id];
  const environment = environmentFor(m, seed, ranked);
  return { mode: 'conquest', id, title: m.title, hanja: m.hanja, date: m.date, place: m.place, season: m.season, sky: environment.sky, sea: environment.sea, night: environment.night, current: environment.current, environment, terrain: m.terrain, view: m.view, foliage: m.foliage, art: artFor(m.terrain, environment.night, CONQUEST_ART[id]) };
}
