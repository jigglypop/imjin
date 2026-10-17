import { SCENARIOS, type ScenarioId } from './scenarios';
import { CONQUEST_MAPS, type ConquestMapId } from './maps';
import type { TerrainSpec } from '../terrain/generate';
import type { SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';
import type { CurrentSpec } from './current';
import { environmentFor, type BattleEnvironment } from './environment';
import type { CoastalFormationKind } from './coastal-tactics';
import type { RegionBattle } from './grand/bridge';
import { grandInfo } from './grand/spawn';

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
  /** The historical battle whose scene the loading page shows. A campaign region's battle borrows the nearest one's (coast.ts regionArt). */
  art?: ScenarioId;
};

const FOLIAGE: Record<ScenarioId, number> = { okpo: 0.1, sacheon: 0.05, dangpo: 0, hansan: 0, angolpo: 0, busan: 0.6, chilcheon: 0, myeongnyang: 0.72, noryang: 1, plymouth: 0, portland: 0, wight: 0, calais: 0, gravelines: 0.1, preveza: 0.2, djerba: 0.1, 'lepanto-north': 0.2, 'lepanto-centre': 0, 'lepanto-south': 0 };

export function scenarioInfo(id: ScenarioId): BattleInfo {
  const s = SCENARIOS[id];
  return { mode: 'scenario', id, art: id, title: s.title, hanja: s.hanja, date: s.date, place: s.place, season: s.season, sky: s.sky, sea: s.sea, night: s.night, terrain: s.terrain, current: s.current, view: s.view, foliage: FOLIAGE[id] ?? 0 };
}

export function conquestInfo(id: ConquestMapId, seed = 1592, ranked = false): BattleInfo {
  const m = CONQUEST_MAPS[id];
  const environment = environmentFor(m, seed, ranked);
  return { mode: 'conquest', id, title: m.title, hanja: m.hanja, date: m.date, place: m.place, season: m.season, sky: environment.sky, sea: environment.sea, night: environment.night, current: environment.current, environment, terrain: m.terrain, view: m.view, foliage: m.foliage };
}

/** What the HUD calls a conquest battle: a campaign meeting is named for its region and month and fought on the region's own coast. */
export function conquestInfoOf(setup: { map?: ConquestMapId; grand?: RegionBattle; seed: number; ranked?: boolean }): BattleInfo {
  return setup.grand ? grandInfo(setup.grand) : conquestInfo(setup.map!, setup.seed, setup.ranked);
}
