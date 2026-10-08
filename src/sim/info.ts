import { SCENARIOS, type ScenarioId } from './scenarios';
import { CONQUEST_MAPS, type ConquestMapId } from './maps';
import type { TerrainSpec } from '../terrain/generate';
import type { SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';
import type { CurrentSpec } from './current';

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
  view: { tx: number; tz: number; dir: number; dist: number; pitch: number };
  /** 0 summer green to 1 winter, for the forests. */
  foliage: number;
};

const FOLIAGE: Record<ScenarioId, number> = { okpo: 0.1, sacheon: 0.05, dangpo: 0, hansan: 0, angolpo: 0, busan: 0.6, chilcheon: 0, myeongnyang: 0.72, noryang: 1 };

export function scenarioInfo(id: ScenarioId): BattleInfo {
  const s = SCENARIOS[id];
  return { mode: 'scenario', id, title: s.title, hanja: s.hanja, date: s.date, place: s.place, season: s.season, sky: s.sky, sea: s.sea, night: s.night, terrain: s.terrain, current: s.current, view: s.view, foliage: FOLIAGE[id] ?? 0 };
}

export function conquestInfo(id: ConquestMapId): BattleInfo {
  const m = CONQUEST_MAPS[id];
  return { mode: 'conquest', id, title: m.title, hanja: m.hanja, date: m.date, place: m.place, season: m.season, sky: m.sky, sea: m.sea, night: m.night, terrain: m.terrain, view: m.view, foliage: m.foliage };
}
