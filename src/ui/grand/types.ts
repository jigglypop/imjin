// View-model types of the faction campaign screens. They are deliberately plain data so the UI kit does not depend on
// the campaign logic (src/sim/grand, src/campaign/grand.ts): an adapter maps the store state onto these shapes.

export type FactionId = 'joseon' | 'japan' | 'ming';
export type Owner = FactionId | null;

export type ResourceKind = 'gold' | 'wood' | 'powder' | 'food';
export type Resources = Record<ResourceKind, number>;

export type BuildingKind = 'barracks' | 'shipyard' | 'battery' | 'repair' | 'storehouse' | 'beacon';

export interface BuildingView {
  kind: BuildingKind;
  /** 0 = not built. */
  level: number;
  maxLevel: number;
  /** Cost and turns of the next level. */
  cost: Partial<Resources>;
  turns: number;
  /** False when something blocks the build (not owned, queue busy, treasury short): `blocked` says why. */
  buildable: boolean;
  blocked?: string;
}

export interface QueueItemView {
  id: string;
  kind: BuildingKind;
  toLevel: number;
  turnsLeft: number;
}

export interface RegionView {
  id: string;
  name: string;
  hanja: string;
  lon: number;
  lat: number;
  owner: Owner;
  /** Strategic value 1..5: sets the node size. */
  value: number;
  income: Partial<Resources>;
  buildings: BuildingView[];
  queue: QueueItemView[];
  garrison: number;
  garrisonMax: number;
  /** Adjacent region ids: the sea lanes. */
  adj: string[];
  /** Node of the map edge that stands for a faraway land (Kyushu, Shandong): drawn as a portal, not a place. */
  offMap?: boolean;
  /** Where the label sits relative to the node. */
  labelSide?: 'b' | 't' | 'l' | 'r';
  note?: string;
}

export type ShipClass = 'panokseon' | 'geobukseon' | 'hyeopseon' | 'atakebune' | 'sekibune' | 'kobaya' | 'mingship' | 'mingsmall';

export interface ShipView {
  id: string;
  kind: ShipClass;
  /** Hull integrity 0..1. */
  hull: number;
  /** Crew strength 0..1. */
  crew: number;
  name?: string;
}

export interface FleetView {
  id: string;
  faction: FactionId;
  name: string;
  /** Region the fleet is in. */
  at: string;
  /** Region it is ordered to, drawn as an arrow. */
  moveTo?: string;
  ships: ShipView[];
  /** Movement left this turn, 0..1. */
  moves?: number;
}

export interface TreasuryView {
  stock: Resources;
  /** Net change per turn. */
  income: Resources;
}

export interface TurnView {
  turn: number;
  /** Display date, e.g. "1592년 5월 상순". */
  date: string;
  faction: FactionId;
}

export interface BattleSideView {
  faction: FactionId;
  name: string;
  ships: number;
  crew: number;
  /** Combined fighting power, any unit: only the ratio is shown. */
  power: number;
  /** Bonus lines such as "포대 +12%". */
  bonuses?: string[];
}

export interface BattlePreviewView {
  regionId: string;
  regionName: string;
  attacker: BattleSideView;
  defender: BattleSideView;
  /** Attacker victory chance 0..1 by the auto-resolve model. */
  winChance: number;
  notes?: string[];
}

export interface FactionOption {
  id: FactionId;
  name: string;
  hanja: string;
  leader: string;
  blurb: string;
  strengths: string[];
  weakness: string;
  difficulty: 1 | 2 | 3;
  startRegions: string[];
  fleets: number;
}
