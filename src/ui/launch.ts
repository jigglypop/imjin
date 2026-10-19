import type { ConquestSetup, EngineOptions } from '../game/Engine';
import type { RegionBattle } from '../sim/grand/bridge';
import type { TheatreSetup } from '../game/theatre';
import { portInfo, type PortView } from '../port/harbourTerrain';
import { HANSAN_TERRAIN } from '../terrain/generate';
import { grandSeats, grandYou } from '../sim/grand/spawn';
import type { NetBattle } from '../net/NetBattle';
import { playableFactions } from '../sim/balance';
import { CONQUEST_MAPS, defaultSeats, type ConquestMapId } from '../sim/maps';
import { conquestInfoOf, scenarioInfo, type BattleInfo } from '../sim/info';
import { SCENARIOS, type ScenarioId } from '../sim/scenarios';
import type { Faction } from '../sim/types';

// Everything here is light (no three.js): the menu reads it before the battle chunk has been fetched.

export const params = new URLSearchParams(location.search);

/** What to load into the battle view. A new `seq` means a new battle. */
export type LaunchBody =
  | { kind: 'scenario'; id: ScenarioId; faction: Faction; campaign?: EngineOptions['campaign']; remote?: NetBattle }
  | { kind: 'conquest'; setup: ConquestSetup; remote?: NetBattle }
  /** A meeting of the faction campaign, played as a conquest battle with the campaign's own ships. */
  | { kind: 'grand'; battle: RegionBattle }
  /** The faction campaign's whole theatre in the battle's 3D (game/theatre.ts): nothing is fought. */
  | { kind: 'theatre'; setup: TheatreSetup }
  /** The account's home port (본진) in the battle's 3D (src/port): nothing is fought. */
  | { kind: 'port'; view: PortView };
export type Launch = LaunchBody & { seq: number };

/** The conquest battle a launch asks for, if it is one. */
export function conquestOf(launch: LaunchBody): ConquestSetup | undefined {
  if (launch.kind === 'conquest') return launch.setup;
  if (launch.kind === 'grand') {
    const rb = launch.battle;
    return { seats: grandSeats(rb), you: grandYou(rb), seed: rb.seed, grand: rb };
  }
  return undefined;
}

/** The battle a launch stages, as the engine will build it: the loading page shows it before the engine has started. */
export function launchInfo(launch: LaunchBody): BattleInfo {
  if (launch.kind === 'port') return portInfo();
  if (launch.kind === 'theatre') {
    // The loading page's stand-in until the engine stages the theatre (the terrain here is never built).
    const s = launch.setup;
    return { mode: 'conquest', id: 'theatre', art: 'hansan', title: s.title, hanja: '', date: '', place: s.title, season: '', sky: 'sunset', sea: 'calm', night: false, terrain: HANSAN_TERRAIN, view: { tx: 0, tz: 0, dir: 0, dist: 14000, pitch: 0.75 }, foliage: 0 };
  }
  return launch.kind === 'scenario' ? scenarioInfo(launch.id) : conquestInfoOf(conquestOf(launch)!);
}

const paramScenario = params.get('scenario') as ScenarioId | null;
const paramSide = params.get('side') as Faction | null;
const paramConquest = params.get('conquest') as ConquestMapId | null;

/** The scenario a canvas is first created for. Conquest battles reuse the canvas and swap the battle after init. */
export const startScenario: ScenarioId = paramScenario && paramScenario in SCENARIOS ? paramScenario : 'hansan';

export const hideHud = params.get('hud') === '0';

/** Test hooks (?scenario=, ?conquest=) skip the menu and start a battle straight away. */
export function urlLaunch(): Launch | null {
  if (paramConquest && paramConquest in CONQUEST_MAPS) {
    return {
      seq: 1,
      kind: 'conquest',
      setup: {
        map: paramConquest,
        seats: defaultSeats((params.get('me') as Faction | null) ?? 'joseon', (params.get('foe') as Faction | null) ?? 'japan', params.get('size') === '4' ? 4 : 2),
        you: 0,
        seed: Number(params.get('seed') ?? 1592),
      },
    };
  }
  if (paramScenario) {
    return { seq: 1, kind: 'scenario', id: startScenario, faction: paramSide && playableFactions(startScenario).includes(paramSide) ? paramSide : 'joseon' };
  }
  return null;
}
