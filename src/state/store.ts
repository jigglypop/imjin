import type { ChapterId } from '../routes';
import { create } from 'zustand';
import type { SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';
import type { AmmoMode, CrewPlan, Faction, FireMode, MoraleState, ShipKind, SmallArms, Stance, Team } from '../sim/types';
import type { BuildingKind } from '../sim/conquest';
import type { BattleInfo } from '../sim/info';
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
  /** The battle depth rules: mean morale of the ships still fighting, how many waver and how many run. */
  morale: number;
  wavering: number;
  routing: number;
  /** Seconds until the squadron's drum can beat again (0 ready), and whether it is beating now. Null without a leader to beat it. */
  drum: { wait: number; beating: boolean } | null;
};

export type GunInfo = { label: string; side: number; stage: number; stageName: string; progress: number; empty: boolean };

export type PrimaryInfo = {
  id: number;
  name: string;
  kind: string;
  /** The ship's kind id, for opening it in the ship codex. */
  shipKind: ShipKind;
  team: Team;
  hull: number;
  crew: number;
  maxCrew: number;
  fire: number;
  damageState?: { flooding: number; propulsion: number; steering: number };
  activity: string;
  guns: GunInfo[];
  fireMode: FireMode;
  ammo: AmmoMode;
  speedCap: number;
  stance: Stance;
  lights: boolean;
  repel: boolean;
  grappled: boolean;
  morale: number;
  moraleState: MoraleState;
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
  side: 'own' | 'foe' | 'none';
  holder: string;
  value: number;
  home: boolean;
  contested: boolean;
  hold: number;
  mine: boolean;
  observed?: boolean;
  expanded: boolean;
  buildings: ({ slot: number; kind: BuildingKind; label: string; progress: number; hp: number; level: number; upgradeLeft: number; upgradeTotal: number; upgradeCost: number; upgradeTime: number; canUpgrade: boolean } | null)[];
  queue: { kind: ShipKind; label: string; left: number; total: number; working: boolean }[];
  build: { kind: BuildingKind; label: string; cost: number; time: number; desc: string; ok: boolean }[];
  recruit: { kind: ShipKind; label: string; cost: number; time: number; ok: boolean }[];
  shipyard: boolean;
  yardSlots: number;
  rally: { x: number; z: number } | null;
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
  observedEnemy?: boolean;
  ownTotal: number;
  enemyTotal: number;
  /** Enemy ships that fled the battle. */
  escaped: number;
  balance: number;
  winner: Team | null;
  draw: boolean;
  paused: boolean;
  speed: number;
  /** Fast-forward the approach until first contact (off in multiplayer and after contact). */
  autoFast: boolean;
  /** The approach is being fast-forwarded now. */
  fastForward: boolean;
  /** No contact yet, so the approach can still be fast-forwarded (the ⏩ button shows). */
  approach: boolean;
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
  /**
   * Each fleet's nerve under the battle depth rules: mean morale of its ships still fighting and the share of them that
   * waver or run. Null when the battle runs without them.
   */
  morale: { own: FleetMorale; foe: FleetMorale } | null;
  squadrons: SquadronInfo[];
  primary: PrimaryInfo | null;
  conquest: ConquestSnapshot | null;
};

export type FleetMorale = { level: number; shaken: number; running: number; state: 'steady' | 'shaken' | 'broken' };

export type Toast = { id: number; text: string; tone: 'info' | 'good' | 'bad'; at: number };
export type SelectionBox = { x0: number; y0: number; x1: number; y1: number } | null;
/**
 * menu: mode cards. select: the nine historical battles. faction: the faction campaign. skirmish and online: setup
 * screens. codex: the ship codex. Every screen but the battle has an address (src/routes.ts), which src/router.ts keeps
 * in step with this.
 */
export type Screen = 'menu' | 'select' | 'faction' | 'skirmish' | 'online' | 'settings' | 'codex' | 'generals' | 'battle';
/** Screens a battle can be started from, so the HUD back button returns to where the player came from. */
export type BattleOrigin = 'select' | 'skirmish' | 'online' | 'faction';

type UiState = {
  /** The battle as the HUD shows it; its time, fps, timeLeft and gun progress are stale, read `live` for those. */
  snapshot: GameSnapshot | null;
  live: LiveState;
  loading: string | null;
  progress: number;
  /** The battle being built, for the loading page: its picture, title, date and place. */
  loadingBattle: BattleInfo | null;
  report: Report | null;
  toasts: Toast[];
  box: SelectionBox;
  screen: Screen;
  /** The historical battle the history screen shows once one is picked; the address names it (/battles/hansan). */
  battle: ScenarioId | null;
  /** The screen the running battle was started from. */
  origin: BattleOrigin;
  /** The chapter of the series on show: the menu's poster, the history screen's battles (/armada names the Armada). */
  chapter: ChapterId;
  /** A renderer or engine failure that stops the battle from starting. */
  fatal: string | null;
  touchBox: boolean;
  /** "자동 건설": the conquest panel switch that has the player's works ordered automatically. Off at the start of every battle. */
  autoBuild: boolean;
};

/**
 * The fields that change on nearly every publish: the clock, the frame rate, the conquest countdown and the guns'
 * loading. They live in their own small slice so only the few components that show them re-render each time; the
 * snapshot itself is replaced only when something else changed.
 */
export type LiveState = { time: number; fps: number; timeLeft: number; guns: number[] };

const EMPTY_GUNS: number[] = [];

export const useUi = create<UiState>(() => ({ snapshot: null, live: { time: 0, fps: 0, timeLeft: 0, guns: EMPTY_GUNS }, loading: '바다를 준비하는 중', progress: 0, loadingBattle: null, report: null, toasts: [], box: null, screen: 'menu', battle: null, origin: 'select', chapter: 'imjin', fatal: null, touchBox: false, autoBuild: false }));

/**
 * `next` with every part that equals the matching part of `prev` replaced by that part, so unchanged squadrons, points
 * and panels keep their identity and memoized components skip them. Returns `prev` itself when nothing differs.
 */
function share<T>(prev: T, next: T): T {
  if (prev === next) return prev;
  if (typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null) return next;
  if (Array.isArray(prev) !== Array.isArray(next)) return next;
  if (Array.isArray(next)) {
    const a = prev as unknown as unknown[];
    let same = a.length === next.length;
    const out = next.map((v, i) => {
      const r = i < a.length ? share(a[i], v) : v;
      if (r !== a[i]) same = false;
      return r;
    });
    return same ? prev : (out as unknown as T);
  }
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let same = true;
  for (const k in b) {
    const r = share(a[k], b[k]);
    // JSON drops undefined fields, and so did the comparison this replaces.
    if (r !== a[k] || (r === undefined && !(k in a))) same = false;
    out[k] = r;
  }
  if (same) for (const k in a) if (!(k in b)) { same = false; break; }
  return same ? prev : (out as T);
}

function sameNumbers(a: number[], b: number[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function publish(snapshot: GameSnapshot, force = false) {
  const state = useUi.getState();
  const guns = snapshot.primary ? snapshot.primary.guns.map((g) => g.progress) : EMPTY_GUNS;
  const was = state.live;
  const live: LiveState = { time: snapshot.time, fps: snapshot.fps, timeLeft: snapshot.conquest?.timeLeft ?? 0, guns: sameNumbers(was.guns, guns) ? was.guns : guns };
  const liveChanged = live.time !== was.time || live.fps !== was.fps || live.timeLeft !== was.timeLeft || live.guns !== was.guns;
  // The fast fields are carried over from the previous snapshot, so they alone never count as a change.
  const prev = state.snapshot;
  let next = snapshot;
  if (prev) {
    const primary = snapshot.primary && prev.primary
      ? { ...snapshot.primary, guns: snapshot.primary.guns.map((g, i) => ({ ...g, progress: prev.primary!.guns[i]?.progress ?? g.progress })) }
      : snapshot.primary;
    const conquest = snapshot.conquest && prev.conquest ? { ...snapshot.conquest, timeLeft: prev.conquest.timeLeft } : snapshot.conquest;
    next = share(prev, { ...snapshot, time: prev.time, fps: prev.fps, primary, conquest });
  }
  if (next === prev && force) next = { ...prev! };
  if (next !== prev && liveChanged) useUi.setState({ snapshot: next, live });
  else if (next !== prev) useUi.setState({ snapshot: next });
  else if (liveChanged) useUi.setState({ live });
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

export function setAutoBuild(autoBuild: boolean) {
  useUi.setState({ autoBuild });
}

/** `battle` null clears the loading page's battle; undefined keeps the one shown. */
export function setLoading(text: string | null, progress?: number, battle?: BattleInfo | null) {
  useUi.setState((s) => ({
    loading: text,
    progress: text === null ? 1 : progress ?? s.progress,
    loadingBattle: battle !== undefined ? battle : s.loadingBattle,
  }));
}

export function setProgress(progress: number) {
  useUi.setState((s) => ({ progress: Math.max(s.progress, progress) }));
}

/**
 * Opens a screen. The router pushes its address as a history entry (a battle keeps the address it started from).
 * Leaving the history screen for anything but a battle forgets the battle it showed, so it opens on /battles next time.
 */
export function setScreen(screen: Screen) {
  useUi.setState((s) => ({ screen, battle: screen === 'select' || screen === 'battle' ? s.battle : null }));
}

/** Shows another chapter of the series; the router moves the address under its id. */
export function setChapter(chapter: ChapterId) {
  useUi.setState((s) => (s.chapter === chapter ? s : { chapter, battle: null }));
}

/** Picks a historical battle on the history screen. The router renames the address to match, in place. */
export function setBattle(battle: ScenarioId | null) {
  useUi.setState({ battle });
}

export function setOrigin(origin: BattleOrigin) {
  useUi.setState({ origin });
}

/** A battle that could not be built: the loading card goes, the fatal notice offers the way out. */
export function failBattle(err: unknown) {
  console.error(err);
  useUi.setState({ loading: null, fatal: String(err) });
}

export function setFatal(fatal: string | null) {
  useUi.setState({ fatal });
}

export function setReport(report: Report | null) {
  useUi.setState({ report });
}
