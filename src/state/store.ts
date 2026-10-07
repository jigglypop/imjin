import { create } from 'zustand';
import type { SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';
import type { Team } from '../sim/types';
import type { ScenarioId } from '../sim/scenarios';

export type SquadronInfo = {
  id: number;
  team: Team;
  name: string;
  commander: string;
  portrait: string;
  card: string;
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
};

export type GameSnapshot = {
  scenario: { id: ScenarioId; title: string; hanja: string; date: string; place: string; season: string };
  time: number;
  joseon: number;
  japan: number;
  joseonTotal: number;
  japanTotal: number;
  escaped: number;
  balance: number;
  winner: Team | null;
  paused: boolean;
  speed: number;
  sky: SkyPresetName;
  sea: SeaStateName;
  following: number;
  cinematic: boolean;
  fps: number;
  muted: boolean;
  selectedCount: number;
  squadrons: SquadronInfo[];
  primary: PrimaryInfo | null;
};

export type Toast = { id: number; text: string; tone: 'info' | 'good' | 'bad'; at: number };
export type SelectionBox = { x0: number; y0: number; x1: number; y1: number } | null;
export type Screen = 'select' | 'battle';

type UiState = {
  snapshot: GameSnapshot | null;
  loading: string | null;
  toasts: Toast[];
  box: SelectionBox;
  screen: Screen;
};

export const useUi = create<UiState>(() => ({ snapshot: null, loading: '바다를 준비하는 중', toasts: [], box: null, screen: 'battle' }));

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

export function setLoading(text: string | null) {
  useUi.setState({ loading: text });
}

export function setScreen(screen: Screen) {
  useUi.setState({ screen });
}
