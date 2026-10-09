import { create } from 'zustand';
import type { SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';
import type { AmmoMode, CrewPlan, Faction, FireMode, ShipKind, SmallArms, Stance, Team } from '../sim/types';
import type { BuildingKind } from '../sim/conquest';
import type { ScenarioId } from '../sim/scenarios';
import type { Report } from '../campaign/campaign';

export type SquadronInfo = {
  id: number;
  team: Team;
  faction: Faction;
  name: string;
  commander: string;
  portrait: string;
  card: string;
  kind: ShipKind;
  total: number;
  alive: number;
  hull: number;
  crew: number;
  burning: number;
  boarding: number;
  selected: boolean;
};

export type GunInfo = { label: string; side: number; stage: number; stageName: string; progress: number };

export type PrimaryInfo = {
  id: number;
  name: string;
  kind: string;
  team: Team;
  hull: number;
  crew: number;
  maxCrew: number;
  fire: number;
  activity: string;
  guns: GunInfo[];
  fireMode: FireMode;
  ammo: AmmoMode;
  speedCap: number;
  stance: Stance;
  lights: boolean;
  repel: boolean;
  grappled: boolean;
  /** Crew per station and the station plan, in CREW_ROLES order. */
  roles: number[];
  plan: CrewPlan;
  defaultPlan: CrewPlan;
  arms: SmallArms;
  /** The player commands this ship. */
  owned: boolean;
};

export type PointSummary = { id: number; name: string; side: 'own' | 'foe' | 'none'; hold: number; contested: boolean };

export type PointDetail = {
  id: number;
  name: string;
  hanja: string;
  side: 'own' | 'foe' | 'none';
  holder: string;
  value: number;
  home: boolean;
  contested: boolean;
  hold: number;
  mine: boolean;
  buildings: ({ slot: number; kind: BuildingKind; label: string; hanja: string; progress: number; hp: number } | null)[];
  queue: { kind: ShipKind; label: string; left: number; total: number }[];
  build: { kind: BuildingKind; label: string; hanja: string; cost: number; desc: string; ok: boolean }[];
  recruit: { kind: ShipKind; label: string; cost: number; time: number; ok: boolean }[];
  shipyard: boolean;
};

export type ConquestSnapshot = {
  tickets: { own: number; foe: number; max: number };
  timeLeft: number;
  funds: number;
  income: number;
  fleetValue: number;
  cap: number;
  ships: number;
  maxShips: number;
  held: { own: number; foe: number };
  points: PointSummary[];
  selected: PointDetail | null;
};

export type GameSnapshot = {
  scenario: { id: string; title: string; hanja: string; date: string; place: string; season: string };
  mode: 'scenario' | 'conquest';
  /** Display names of the player's side and the enemy's. */
  sides: { own: string; enemy: string };
  /** The side the player leads, and its team. Counts below are by team: the player's against the enemy's. */
  faction: Faction;
  team: Team;
  time: number;
  own: number;
  enemy: number;
  ownTotal: number;
  enemyTotal: number;
  /** Enemy ships that fled the battle. */
  escaped: number;
  balance: number;
  winner: Team | null;
  paused: boolean;
  speed: number;
  /** Fast-forward the approach until first contact (off in multiplayer and after contact). */
  autoFast: boolean;
  /** The approach is being fast-forwarded now. */
  fastForward: boolean;
  sky: SkyPresetName;
  sea: SeaStateName;
  following: number;
  cinematic: boolean;
  fps: number;
  level: number;
  levelAuto: boolean;
  muted: boolean;
  selectedCount: number;
  night: boolean;
  tide: { label: string; knots: number; dir: number } | null;
  squadrons: SquadronInfo[];
  primary: PrimaryInfo | null;
  conquest: ConquestSnapshot | null;
};

export type Toast = { id: number; text: string; tone: 'info' | 'good' | 'bad'; at: number };
export type SelectionBox = { x0: number; y0: number; x1: number; y1: number } | null;
/** menu: mode cards. select: the nine historical battles. faction: the faction campaign. skirmish and online: setup screens. */
export type Screen = 'menu' | 'select' | 'faction' | 'skirmish' | 'online' | 'settings' | 'battle';
/** Screens a battle can be started from, so the HUD back button returns to where the player came from. */
export type BattleOrigin = 'select' | 'skirmish' | 'online' | 'faction';

type UiState = {
  snapshot: GameSnapshot | null;
  loading: string | null;
  progress: number;
  loadingScenario: ScenarioId | null;
  report: Report | null;
  toasts: Toast[];
  box: SelectionBox;
  screen: Screen;
  /** The screen the running battle was started from. */
  origin: BattleOrigin;
  /** A renderer or engine failure that stops the battle from starting. */
  fatal: string | null;
  touchBox: boolean;
};

export const useUi = create<UiState>(() => ({ snapshot: null, loading: '바다를 준비하는 중', progress: 0, loadingScenario: null, report: null, toasts: [], box: null, screen: 'menu', origin: 'select', fatal: null, touchBox: false }));

let lastJson = '';
export function publish(snapshot: GameSnapshot, force = false) {
  const json = JSON.stringify(snapshot);
  if (!force && json === lastJson) return;
  lastJson = json;
  useUi.setState({ snapshot });
}

let toastId = 1;
export function pushToast(text: string, tone: Toast['tone'] = 'info') {
  const toast = { id: toastId++, text, tone, at: performance.now() };
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-4), toast] }));
  setTimeout(() => useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== toast.id) })), 4200);
}

export function setSelectionBox(box: SelectionBox) {
  useUi.setState({ box });
}

export function setTouchBox(touchBox: boolean) {
  useUi.setState({ touchBox });
}

export function setLoading(text: string | null, progress?: number, scenario?: ScenarioId) {
  useUi.setState((s) => ({
    loading: text,
    progress: text === null ? 1 : progress ?? s.progress,
    loadingScenario: scenario ?? s.loadingScenario,
  }));
}

export function setProgress(progress: number) {
  useUi.setState((s) => ({ progress: Math.max(s.progress, progress) }));
}

export function setScreen(screen: Screen) {
  useUi.setState({ screen });
}

export function setOrigin(origin: BattleOrigin) {
  useUi.setState({ origin });
}

export function setFatal(fatal: string | null) {
  useUi.setState({ fatal });
}

export function setReport(report: Report | null) {
  useUi.setState({ report });
}
