import type { Battle, BattleRules } from './battle';
import { GUN_SPECS } from './catalog';
import { COMPETITIVE_PROFILE, shipSpec, type BalanceProfile } from './competitive';
import type { DepthVersion } from './depth';
import { Strategist } from './strategy';
import { cardOf, variantFor } from '../ships/anchors';
import { fleetNo, numbered } from '../i18n/names';
import type { ConquestState } from '../net/protocol';
import { otherTeam, TEAMS, type Faction, type GunType, type LandSampler, type Ship, type ShipKind, type ShipSpec, type Squadron, type Team } from './types';

export type BuildingKind = 'shipyard' | 'battery' | 'magazine' | 'dock' | 'beacon' | 'camp';
export type BuildingLevel = 1 | 2 | 3;

export type BuildingSpec = { kind: BuildingKind; label: string; cost: number; time: number; hp: number; desc: string };

export const BUILDINGS: Record<BuildingKind, BuildingSpec> = {
  shipyard: { kind: 'shipyard', label: '선소', cost: 450, time: 40, hp: 520, desc: '함선을 건조합니다' },
  battery: { kind: 'battery', label: '포대', cost: 500, time: 45, hp: 640, desc: '사거리 안의 적 함선을 포격합니다' },
  magazine: { kind: 'magazine', label: '창고', cost: 300, time: 30, hp: 360, desc: '거점의 함선에 탄약을 보급하고, 수입이 30% 늘어납니다' },
  dock: { kind: 'dock', label: '수리소', cost: 350, time: 35, hp: 420, desc: '거점에 머문 함선의 선체와 병력을 회복합니다' },
  beacon: { kind: 'beacon', label: '봉수대', cost: 300, time: 25, hp: 300, desc: '거점 가치가 1.5배가 되고 밤에도 멀리까지 볼 수 있습니다' },
  camp: { kind: 'camp', label: '군영', cost: 500, time: 35, hp: 480, desc: '거점의 병력을 충원하고 함선 건조를 단계마다 10% 빠르게 합니다. 건조 속도 보너스는 최대 60%입니다' },
};
export const BUILDING_ORDER: BuildingKind[] = ['shipyard', 'battery', 'magazine', 'dock', 'beacon', 'camp'];

/** Cost and seconds for the next completed level; an already maxed work cannot be upgraded. */
export function upgradeCost(kind: BuildingKind, level: number) {
  return BUILDINGS[kind] && (level === 1 || level === 2) ? Math.ceil(BUILDINGS[kind].cost * (level === 1 ? 0.7 : 1.05)) : Infinity;
}
export function upgradeTime(kind: BuildingKind, level: number) {
  return BUILDINGS[kind] && (level === 1 || level === 2) ? BUILDINGS[kind].time * (0.75 + level * 0.25) : Infinity;
}
export function buildingHp(kind: BuildingKind, level: number) {
  return BUILDINGS[kind].hp * (1 + (level - 1) * 0.3);
}

/** Ships each navy can build in a ranked match: the kinds its competitive balance was settled on. */
export const RANKED_ROSTER: Record<Faction, ShipKind[]> = {
  joseon: ['panokseon', 'geobukseon', 'hyeopseon'],
  japan: ['atakebune', 'sekibune', 'kobaya'],
  ming: ['mingship', 'mingsmall'],
};

/** Ships each navy can build under the expanded rules (casual battles and the campaign): the size tiers and support craft as well. */
export const ROSTER: Record<Faction, ShipKind[]> = {
  joseon: ['panokseon', 'geobukseon', 'hyeopseon', 'pojakseon', 'sahuseon'],
  japan: ['daeantaek', 'atakebune', 'sogantaek', 'daegwanseon', 'sekibune', 'kobaya', 'byeongnyangseon'],
  ming: ['gwangseon', 'mingship', 'haechangseon', 'mingsmall', 'hoseon'],
};

export const rosterOf = (faction: Faction, expanded: boolean | undefined) => (expanded ? ROSTER : RANKED_ROSTER)[faction];

/** How much a ship counts in a capture circle: a small boat holds a point at a third of a warship's weight. */
export const captureWeight = (spec: ShipSpec) => spec.capture ?? (spec.length < 16 ? 0.35 : 1);

/** Captains' portraits for the squadrons a seat raises, in turn. */
const PORTRAITS: Record<Faction, string[]> = {
  joseon: ['portrait_admiral', 'portrait_eo', 'portrait_kwon', 'portrait_jeongun', 'portrait_anwi', 'portrait_eokgi'],
  japan: ['portrait_japan', 'portrait_kato', 'portrait_kuki', 'portrait_kurushima', 'portrait_konishi', 'portrait_wakisaka'],
  ming: ['portrait_deng', 'portrait_chenlin'],
};

/** Ship names in squadron and recruit labels. */
export const SHORT_NAME: Record<ShipKind, string> = {
  panokseon: '판옥선',
  geobukseon: '거북선',
  hyeopseon: '협선',
  atakebune: '아타케부네',
  sekibune: '세키부네',
  kobaya: '고바야',
  mingship: '명 전선',
  mingsmall: '명 사선',
  sahuseon: '사후선',
  pojakseon: '포작선',
  daeantaek: '대안택선',
  sogantaek: '소안택선',
  daegwanseon: '대관선',
  byeongnyangseon: '병량선',
  gwangseon: '명 광선',
  haechangseon: '명 해창선',
  hoseon: '명 호선',
};

/** Shore guns by navy: count, gun and seconds between rounds. */
const BATTERY_GUNS: Record<Faction, { gun: GunType; count: number; reload: number }> = {
  joseon: { gun: 'jija', count: 3, reload: 9 },
  japan: { gun: 'folangji', count: 4, reload: 8 },
  ming: { gun: 'folangji', count: 4, reload: 7.5 },
};

export type Building = { kind: BuildingKind; hp: number; progress: number; reload: number[]; level: BuildingLevel; upgradeLeft: number; upgradeTotal: number; constructionTotal?: number };
export type QueueItem = { kind: ShipKind; left: number; total: number };
export type Spot = { x: number; y: number; z: number; rot: number };

export type CapturePoint = {
  id: number;
  name: string;
  hanja: string;
  /** Centre of the capture circle, on the water. */
  x: number;
  z: number;
  r: number;
  /** Building plots on the nearest shore, facing the water. */
  slots: Spot[];
  /** Where new ships are launched. */
  spawn: { x: number; z: number; heading: number };
  value: number;
  /** The player whose home port this is, or -1. */
  home: number;
  /** Player slot holding the point, or -1. */
  owner: number;
  /** +1 held by the Joseon side, -1 by the Japanese side, between while it changes hands. */
  hold: number;
  contested: boolean;
  buildings: (Building | null)[];
  queue: QueueItem[];
  /** Orders for newly launched ships; captured ports discard the previous holder's rally point. */
  rally?: { x: number; z: number };
};

export type ConquestPlayer = {
  slot: number;
  name: string;
  faction: Faction;
  team: Team;
  human: boolean;
  funds: number;
  /** Funds per minute, worked out each second. */
  income: number;
  /** Most fleet value (the price of every ship afloat or on the slipway) the player may hold. */
  cap: number;
  sunk: number;
  lost: number;
};

export type MapPoint = { name: string; hanja: string; x: number; z: number; r: number; value: number; home?: number };

export type ConquestOptions = {
  profile: BalanceProfile;
  tickets: number;
  timeLimit: number;
  startFunds: number;
  cap: number;
  maxShips: number;
  /** Ordinary casual battles grow shore logistics through construction and upgrades. */
  expanded?: boolean;
  incomeScale?: number;
  musterBudget?: number;
  /** A campaign port holds for its defender on a tie. Ordinary skirmishes end in a draw. */
  tieWinner?: Team;
  /** The battle depth rules (depth.ts). Ranked and online rooms leave them out until a season adopts a version. */
  depth?: DepthVersion;
};
/** Ordinary conquest and campaign fleets are uncapped, like the written historical battles. */
export const DEFAULT_OPTIONS: ConquestOptions = { profile: COMPETITIVE_PROFILE, tickets: 3000, timeLimit: 30 * 60, startFunds: 3600, cap: Infinity, maxShips: Infinity, expanded: true, incomeScale: 3, musterBudget: 15600 };
/** The sole fixed fleet limit belongs to competitive ranked one-versus-one rooms. */
export const RANKED_OPTIONS: ConquestOptions = { profile: COMPETITIVE_PROFILE, tickets: 1000, timeLimit: 30 * 60, startFunds: 1200, cap: 10000, maxShips: 36, expanded: false, incomeScale: 1, musterBudget: 5200 };

const BASE_INCOME = 60;
const POINT_INCOME = 45;
const CAPTURE_RATE = 0.025;
const QUEUE_MAX = 5;
/** Casual logistics uses faster work orders (0.36 of the catalog time, was 0.6); ranked retains the catalog's original timings. */
const CASUAL_WORK_TIME = 0.36;
/**
 * Under the depth rules a fleet that has broken loses this share of the starting tickets each second, once the opening
 * has passed: a rout at sea ends the battle within a minute or two unless the fleet rallies at its ports.
 */
const COLLAPSE_RATE = 0.01;
const COLLAPSE_AFTER = 120;
/**
 * Under the depth rules a side whose fleet still fighting (running crews hardly counting) is under SWEPT_SHARE of the
 * other's, and has lost at least SWEPT_LOSS of the most it had, for SWEPT_TIME seconds has been swept from the sea and
 * loses, once the opening SWEPT_AFTER has passed. A port that was only ever held by a few ships and its works is not
 * swept: it has lost nothing.
 */
const SWEPT_SHARE = 0.35;
const SWEPT_LOSS = 0.5;
const SWEPT_TIME = 45;
const SWEPT_AFTER = 300;

const dist2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) ** 2 + (az - bz) ** 2;

/** A shore spot near a capture circle where buildings can stand: dry, low and not too steep. */
export function findSite(land: LandSampler, x: number, z: number, r: number) {
  for (const steep of [0.32, 0.55, 0.9]) {
    const site = searchSite(land, x, z, r, steep);
    if (site) return site;
  }
  return null;
}

function searchSite(land: LandSampler, x: number, z: number, r: number, steep: number) {
  let best: { x: number; z: number; d: number } | null = null;
  for (let ring = 0.1; ring <= 4; ring += 0.1) {
    const rad = r * ring;
    const steps = Math.max(16, Math.round(rad / 25));
    for (let k = 0; k < steps; k += 1) {
      const a = (k / steps) * Math.PI * 2;
      const px = x + Math.cos(a) * rad;
      const pz = z + Math.sin(a) * rad;
      const h = land(px, pz);
      if (h < 3 || h > 34) continue;
      const slope = Math.max(Math.abs(land(px + 12, pz) - land(px - 12, pz)), Math.abs(land(px, pz + 12) - land(px, pz - 12))) / 24;
      if (slope > steep) continue;
      const d = Math.hypot(px - x, pz - z);
      if (!best || d < best.d) best = { x: px, z: pz, d };
    }
    if (best) break;
  }
  return best;
}

export function placeSlots(land: LandSampler, sx: number, sz: number, face: number, count: number): Spot[] {
  const out: Spot[] = [];
  const fx = Math.cos(face);
  const fz = Math.sin(face);
  const px = -fz;
  const pz = fx;
  const offsets = [
    [0, 0],
    [-10, 34],
    [-10, -34],
    [-46, 0],
    [-44, 40],
    [-44, -40],
  ];
  for (const [along, across] of offsets) {
    if (out.length >= count) break;
    let x = sx + fx * along! + px * across!;
    let z = sz + fz * along! + pz * across!;
    for (let tries = 0; tries < 12 && land(x, z) < 2.5; tries += 1) {
      x -= fx * 8;
      z -= fz * 8;
    }
    if (land(x, z) < 2) continue;
    out.push({ x, y: land(x, z), z, rot: face });
  }
  return out;
}

/** Where new ships are launched: out from the slipways toward the capture circle, inside its edge if the water allows. */
export function findSpawn(land: LandSampler, sx: number, sz: number, cx: number, cz: number, r: number) {
  const a = Math.atan2(cz - sz, cx - sx);
  let d = 10;
  while (d < 1200 && land(sx + Math.cos(a) * d, sz + Math.sin(a) * d) > -7) d += 10;
  d = Math.max(d + 45, Math.hypot(cx - sx, cz - sz) - r * 0.6);
  return { x: sx + Math.cos(a) * d, z: sz + Math.sin(a) * d, heading: a };
}

export class Conquest implements BattleRules {
  readonly points: CapturePoint[];
  readonly players: ConquestPlayer[];
  readonly tickets: Record<Team, number>;
  readonly options: ConquestOptions;
  private readonly brains = new Map<number, Strategist>();
  private incomeTimer = 0;
  private ticketTimer = 0;
  /** Since when each side has been swept from the sea (the depth rules). */
  private sweptSince: Record<Team, number | null> = { joseon: null, japan: null };
  /** The side swept from the sea, as of the last look, once a second. */
  private sweptTeam: Team | null = null;
  private peak: Record<Team, number> = { joseon: 0, japan: 0 };
  private recruitSeq = new Map<string, number>();
  private readonly land: LandSampler;
  /** Balance runs let the computer play the human seats too. */
  autopilot = false;

  shipSpec(kind: ShipKind) {
    return shipSpec(kind, this.options.profile);
  }

  constructor(map: MapPoint[], players: Omit<ConquestPlayer, 'funds' | 'income' | 'cap' | 'sunk' | 'lost'>[], land: LandSampler, options: Partial<ConquestOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.land = land;
    this.tickets = { joseon: this.options.tickets, japan: this.options.tickets };
    this.players = players.map((p) => ({ ...p, funds: this.options.startFunds, income: 0, cap: this.options.cap, sunk: 0, lost: 0 }));
    const built: CapturePoint[] = [];
    map.forEach((m, id) => {
      const home = m.home !== undefined && m.home < this.players.length ? m.home : -1;
      const team = home >= 0 ? this.players[home]!.team : null;
      const base = { id, name: m.name, hanja: m.hanja, x: m.x, z: m.z, r: m.r, value: m.value, home, owner: home, hold: team === 'joseon' ? 1 : team === 'japan' ? -1 : 0, contested: false, queue: [] as QueueItem[] };
      // The mirror image of an earlier point gets that point's shore works mirrored, so the two sides match exactly.
      const twin = built.find((q) => Math.abs(q.x + m.x) < 1 && Math.abs(q.z + m.z) < 1 && (q.x !== 0 || q.z !== 0));
      if (twin) {
        const slots = twin.slots.map((s) => ({ x: -s.x, y: s.y, z: -s.z, rot: s.rot + Math.PI }));
        built.push({ ...base, slots, spawn: { x: -twin.spawn.x, z: -twin.spawn.z, heading: twin.spawn.heading + Math.PI }, buildings: slots.map(() => null) });
        return;
      }
      const site = findSite(land, m.x, m.z, m.r) ?? { x: m.x + m.r, z: m.z };
      const face = Math.atan2(m.z - site.z, m.x - site.x);
      const slots = placeSlots(land, site.x, site.z, face, this.options.expanded ? (m.home !== undefined ? 6 : 5) : m.home !== undefined ? 4 : 3);
      built.push({ ...base, slots, spawn: findSpawn(land, site.x, site.z, m.x, m.z, m.r), buildings: slots.map(() => null) });
    });
    this.points = built;
    for (const p of this.points) {
      if (p.home < 0) continue;
      // Every home port starts with a slipway and a shore battery.
      p.buildings[0] = this.newBuilding('shipyard', true);
      if (p.buildings.length > 1) p.buildings[1] = this.newBuilding('battery', true);
    }
    for (const p of this.players) if (!p.human) this.brains.set(p.slot, new Strategist(p.slot));
  }

  /** A seat changes hands between a person and the computer, as when a player drops out of a multiplayer battle. */
  setHuman(slot: number, human: boolean) {
    const p = this.players[slot];
    if (!p) return;
    p.human = human;
    if (human) this.brains.delete(slot);
    else if (!this.brains.has(slot)) this.brains.set(slot, new Strategist(slot));
  }

  /** What changes during the battle, for a multiplayer server to send. */
  state(): ConquestState {
    return {
      tickets: { joseon: Math.round(this.tickets.joseon), japan: Math.round(this.tickets.japan) },
      held: { joseon: this.held('joseon'), japan: this.held('japan') },
      points: this.points.map((p) => ({
        owner: p.owner,
        hold: Math.round(p.hold * 1000) / 1000,
        contested: p.contested,
        buildings: p.buildings.map((b) => (b ? { kind: b.kind, hp: Math.round(b.hp), progress: Math.round(b.progress * 1000) / 1000, level: b.level, upgradeLeft: Math.round(b.upgradeLeft * 10) / 10, upgradeTotal: b.upgradeTotal, constructionTotal: b.constructionTotal } : null)),
        queue: p.queue.map((q) => ({ kind: q.kind, left: Math.round(q.left * 10) / 10, total: q.total })),
        rally: p.rally ? { ...p.rally } : undefined,
      })),
      players: this.players.map((pl) => ({ funds: Math.floor(pl.funds), income: pl.income, sunk: pl.sunk, lost: pl.lost, human: pl.human })),
    };
  }

  /** A multiplayer client's copy takes the server's state; it never steps on its own. */
  applyState(st: ConquestState) {
    this.remoteHeld = st.held ? { ...st.held } : undefined;
    this.tickets.joseon = st.tickets.joseon;
    this.tickets.japan = st.tickets.japan;
    st.points.forEach((ps, i) => {
      const p = this.points[i];
      if (!p) return;
      p.owner = ps.owner;
      p.hold = ps.hold;
      p.contested = ps.contested;
      p.buildings = p.slots.map((_, k) => {
        const b = ps.buildings[k];
        return b ? { kind: b.kind, hp: b.hp, progress: b.progress, reload: [], level: b.level ?? 1, upgradeLeft: b.upgradeLeft ?? 0, upgradeTotal: b.upgradeTotal ?? 0, constructionTotal: b.constructionTotal } : null;
      });
      p.queue = ps.queue.map((q) => ({ ...q }));
      p.rally = ps.rally ? { ...ps.rally } : undefined;
    });
    st.players.forEach((ps, i) => {
      const pl = this.players[i];
      if (!pl) return;
      pl.funds = ps.funds;
      pl.income = ps.income;
      pl.sunk = ps.sunk;
      pl.lost = ps.lost;
      pl.human = ps.human;
    });
  }

  player(slot: number) {
    return this.players[slot];
  }

  homeOf(slot: number) {
    return this.points.find((p) => p.home === slot);
  }

  teamOfPoint(p: CapturePoint): Team | null {
    return p.owner >= 0 ? this.players[p.owner]!.team : null;
  }

  private newBuilding(kind: BuildingKind, done = false): Building {
    const spec = BUILDINGS[kind];
    const guns = kind === 'battery' ? (this.options.expanded ? 8 : 5) : 0;
    return { kind, hp: spec.hp, progress: done ? 1 : 0, reload: Array.from({ length: guns }, (_, i) => 2 + i * 1.7), level: 1, upgradeLeft: 0, upgradeTotal: 0, constructionTotal: this.buildTime(kind) };
  }

  /** Value and count of the ships the player commands, afloat and on the slipways. */
  fleet(b: Battle, slot: number) {
    let value = 0;
    let count = 0;
    for (const s of b.ships) {
      if (s.owner !== slot || !b.isActive(s)) continue;
      value += s.spec.cost;
      count += 1;
    }
    for (const p of this.points) {
      if (p.owner !== slot) continue;
      for (const q of p.queue) {
        value += this.shipSpec(q.kind).cost;
        count += 1;
      }
    }
    return { value, count };
  }

  /** How many of a player's ships are afloat and fighting: counted, not listed, as a finished hull waiting on its slipway asks every step. */
  private afloat(b: Battle, slot: number) {
    let n = 0;
    for (const s of b.ships) if (s.owner === slot && b.isActive(s)) n += 1;
    return n;
  }

  /** The built and finished buildings of a kind at a point. */
  count(p: CapturePoint, kind: BuildingKind) {
    let n = 0;
    for (const bd of p.buildings) if (bd && bd.kind === kind && bd.progress >= 1) n += 1;
    return n;
  }

  /** Completed levels only: building and upgrade work never gives an early benefit. */
  levels(p: CapturePoint, kind: BuildingKind) {
    return p.buildings.reduce((n, bd) => n + (bd?.kind === kind && bd.progress >= 1 ? bd.level : 0), 0);
  }

  shipLimit(_owner: number) { return this.options.maxShips; }

  yardSlots(p: CapturePoint) { return this.levels(p, 'shipyard') + (this.options.expanded ? this.count(p, 'shipyard') : 0); }
  queueWorkers(p: CapturePoint) { return Math.min(p.queue.length, this.yardSlots(p)); }
  /** Work is recorded when ordered, so imported queues retain their original total and refund progress. */
  recruitTime(kind: ShipKind) { return Math.round(this.shipSpec(kind).build * (this.options.expanded ? CASUAL_WORK_TIME : 1) * 10) / 10; }
  buildTime(kind: BuildingKind) { return BUILDINGS[kind].time * (this.options.expanded ? CASUAL_WORK_TIME : 1); }
  upgradeDuration(kind: BuildingKind, level: number) { return upgradeTime(kind, level) * (this.options.expanded ? CASUAL_WORK_TIME : 1); }
  buildingDesc(kind: BuildingKind) {
    if (!this.options.expanded) return BUILDINGS[kind].desc;
    if (kind === 'shipyard') return '1·2·3단계에서 동시에 2·3·4척을 건조합니다. 대기열은 동시 건조 칸마다 5척입니다';
    if (kind === 'battery') return '증축마다 화포 1문, 화포 기본 사거리의 8%, 재장전 속도와 피해 15%가 늘어납니다. 손상되면 재장전이 느려집니다';
    if (kind === 'dock') return '피격 후 8초가 지나면 단계마다 선체를 초당 1%, 승조원을 초당 0.2% 회복합니다';
    if (kind === 'camp') return '피격 후 8초가 지나면 단계마다 승조원을 초당 0.8% 충원합니다. 모든 선소의 건조 속도는 단계마다 10%, 최대 60% 빨라집니다';
    return BUILDINGS[kind].desc;
  }
  constructionRate(owner: number) {
    const camps = this.points.reduce((n, p) => n + (p.owner === owner ? this.levels(p, 'camp') : 0), 0);
    return 1 + Math.min(0.6, camps * 0.1);
  }

  canUpgrade(owner: number, pointId: number, slot: number) {
    if (!this.options.expanded || !Number.isInteger(owner) || owner < 0 || !Number.isInteger(pointId) || pointId < 0 || !Number.isInteger(slot) || slot < 0) return false;
    const p = this.points[pointId], pl = this.players[owner], bd = p?.buildings[slot];
    return !!(p && pl && p.owner === owner && bd && bd.progress >= 1 && bd.level < 3 && bd.upgradeLeft <= 0 && pl.funds >= upgradeCost(bd.kind, bd.level));
  }

  upgrade(_b: Battle, owner: number, pointId: number, slot: number) {
    if (!this.canUpgrade(owner, pointId, slot)) return false;
    const bd = this.points[pointId]!.buildings[slot]!;
    this.players[owner]!.funds -= upgradeCost(bd.kind, bd.level);
    bd.upgradeTotal = bd.upgradeLeft = this.upgradeDuration(bd.kind, bd.level);
    return true;
  }

  cancelUpgrade(_b: Battle, owner: number, pointId: number, slot: number) {
    if (!Number.isInteger(owner) || owner < 0 || !Number.isInteger(pointId) || pointId < 0 || !Number.isInteger(slot) || slot < 0) return false;
    const p = this.points[pointId], pl = this.players[owner], bd = p?.buildings[slot];
    if (!this.options.expanded || !p || !pl || p.owner !== owner || !bd || bd.upgradeLeft <= 0) return false;
    pl.funds += Math.round(upgradeCost(bd.kind, bd.level) * 0.7 * Math.min(1, bd.upgradeLeft / bd.upgradeTotal));
    bd.upgradeLeft = bd.upgradeTotal = 0;
    return true;
  }

  setRally(owner: number, pointId: number, x: number, z: number) {
    if (!this.options.expanded || !Number.isInteger(owner) || owner < 0 || !Number.isInteger(pointId) || pointId < 0 || !Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 30000 || Math.abs(z) > 30000 || this.land(x, z) > -2) return false;
    const p = this.points[pointId];
    if (!p || p.owner !== owner || !this.players[owner]) return false;
    p.rally = { x, z };
    return true;
  }

  canBuild(owner: number, pointId: number, kind: BuildingKind) {
    if (!Number.isInteger(owner) || owner < 0 || !Number.isInteger(pointId) || pointId < 0) return false;
    const p = this.points[pointId];
    const pl = this.players[owner];
    if (!p || !pl || p.owner !== owner || !BUILDINGS[kind]) return false;
    if (kind === 'camp' && !this.options.expanded) return false;
    if (!p.buildings.some((bd) => !bd)) return false;
    if (kind === 'shipyard' && p.buildings.some((bd) => bd?.kind === 'shipyard')) return false;
    if (kind === 'beacon' && p.buildings.some((bd) => bd?.kind === 'beacon')) return false;
    if (kind === 'camp' && p.buildings.some((bd) => bd?.kind === 'camp')) return false;
    return pl.funds >= BUILDINGS[kind].cost;
  }

  build(b: Battle, owner: number, pointId: number, kind: BuildingKind) {
    if (!this.canBuild(owner, pointId, kind)) return false;
    const p = this.points[pointId]!;
    const slot = p.buildings.findIndex((bd) => !bd);
    this.players[owner]!.funds -= BUILDINGS[kind].cost;
    p.buildings[slot] = this.newBuilding(kind);
    void b;
    return true;
  }

  demolish(b: Battle, owner: number, pointId: number, slot: number) {
    if (!Number.isInteger(owner) || owner < 0 || !Number.isInteger(pointId) || pointId < 0 || !Number.isInteger(slot) || slot < 0) return false;
    const p = this.points[pointId];
    const bd = p?.buildings[slot];
    if (!p || !bd || p.owner !== owner) return false;
    this.players[owner]!.funds += Math.round(BUILDINGS[bd.kind].cost * 0.25 * bd.progress);
    p.buildings[slot] = null;
    b.events.push({ type: 'razed', point: p.id, building: bd.kind });
    return true;
  }

  canRecruit(b: Battle, owner: number, pointId: number, kind: ShipKind) {
    if (!Number.isInteger(owner) || owner < 0 || !Number.isInteger(pointId) || pointId < 0) return false;
    const p = this.points[pointId];
    const pl = this.players[owner];
    if (!p || !pl || p.owner !== owner || !rosterOf(pl.faction, this.options.expanded).includes(kind)) return false;
    if (!this.count(p, 'shipyard') || p.queue.length >= QUEUE_MAX * this.yardSlots(p)) return false;
    const f = this.fleet(b, owner);
    if (f.value + this.shipSpec(kind).cost > pl.cap || f.count >= this.shipLimit(owner)) return false;
    return pl.funds >= this.shipSpec(kind).cost;
  }

  recruitIn(b: Battle, owner: number, pointId: number, kind: ShipKind) {
    if (!this.canRecruit(b, owner, pointId, kind)) return false;
    const spec = this.shipSpec(kind);
    this.players[owner]!.funds -= spec.cost;
    const time = this.recruitTime(kind);
    this.points[pointId]!.queue.push({ kind, left: time, total: time });
    return true;
  }

  cancel(owner: number, pointId: number, index: number) {
    if (!Number.isInteger(owner) || owner < 0 || !Number.isInteger(pointId) || pointId < 0 || !Number.isInteger(index) || index < 0) return false;
    const p = this.points[pointId];
    const item = p?.queue[index];
    if (!p || !item || p.owner !== owner) return false;
    const spec = this.shipSpec(item.kind);
    this.players[owner]!.funds += this.options.expanded
      ? Math.round(spec.cost * (0.5 + 0.5 * Math.max(0, Math.min(1, item.left / item.total))))
      : index === 0 ? Math.round(spec.cost * (0.5 + 0.5 * (item.left / item.total))) : spec.cost;
    p.queue.splice(index, 1);
    return true;
  }

  step(b: Battle, dt: number) {
    this.capture(b, dt);
    this.construct(b, dt);
    this.shipyards(b, dt);
    this.services(b, dt);
    this.incomeTimer += dt;
    if (this.incomeTimer >= 1) {
      this.incomeTimer -= 1;
      this.economy();
    }
    this.ticketTimer += dt;
    if (this.ticketTimer >= 1) {
      this.ticketTimer -= 1;
      this.drain();
      this.collapse(b);
      this.sweptTeam = this.swept(b);
    }
    for (const [slot, brain] of this.brains) brain.step(b, this, dt, slot);
    if (this.autopilot) {
      for (const p of this.players) {
        if (!p.human || this.brains.has(p.slot)) continue;
        this.brains.set(p.slot, new Strategist(p.slot));
      }
    }
  }

  private capture(b: Battle, dt: number) {
    for (const p of this.points) {
      const counts: Record<Team, number> = { joseon: 0, japan: 0 };
      const bySlot = new Map<number, number>();
      b.near(p.x, p.z, p.r, (s) => {
        // A crew running for safety holds no water.
        if (!b.isActive(s) || s.moraleState === 'routing') return;
        const w = captureWeight(s.spec);
        counts[s.team] += w;
        bySlot.set(s.owner, (bySlot.get(s.owner) ?? 0) + w);
      });
      const ownerTeam = this.teamOfPoint(p);
      p.contested = counts.joseon > 0 && counts.japan > 0;
      if (p.contested) continue;
      const present: Team | null = counts.joseon > 0 ? 'joseon' : counts.japan > 0 ? 'japan' : null;
      const dir = (t: Team) => (t === 'joseon' ? 1 : -1);
      if (!present) {
        const goal = ownerTeam ? dir(ownerTeam) : 0;
        p.hold += Math.sign(goal - p.hold) * Math.min(Math.abs(goal - p.hold), dt * 0.01);
        continue;
      }
      if (ownerTeam === present && Math.abs(p.hold) >= 1) continue;
      const n = counts[present];
      const rate = CAPTURE_RATE * Math.min(3, 0.6 + 0.4 * n) * (p.home >= 0 ? 0.6 : 1);
      const before = p.hold;
      p.hold = Math.max(-1, Math.min(1, p.hold + dir(present) * rate * dt));
      if (ownerTeam && ownerTeam !== present && (p.hold === 0 || Math.sign(p.hold) !== Math.sign(before))) this.release(b, p);
      if (Math.abs(p.hold) >= 1 && this.teamOfPoint(p) !== present) {
        let slot = -1;
        let most = -1;
        for (const [owner, w] of bySlot) {
          if (this.players[owner]?.team !== present || w <= most) continue;
          most = w;
          slot = owner;
        }
        if (slot >= 0) this.take(b, p, slot);
      }
    }
  }

  /** The holder's grip is broken: the point goes neutral and its slipways stop. */
  private release(b: Battle, p: CapturePoint) {
    if (p.owner < 0) return;
    const from = p.owner;
    p.owner = -1;
    p.queue.length = 0;
    p.rally = undefined;
    b.events.push({ type: 'captured', point: p.id, owner: -1, from });
  }

  private take(b: Battle, p: CapturePoint, slot: number) {
    const from = p.owner;
    p.owner = slot;
    p.queue.length = 0;
    p.rally = undefined;
    b.events.push({ type: 'captured', point: p.id, owner: slot, from });
  }

  private construct(b: Battle, dt: number) {
    for (const p of this.points) {
      if (p.owner < 0) continue;
      p.buildings.forEach((bd) => {
        if (!bd) return;
        if (bd.progress < 1) {
          // Older state has no recorded duration and finishes at its original pace.
          bd.progress = Math.min(1, bd.progress + dt / (bd.constructionTotal ?? BUILDINGS[bd.kind].time));
          if (bd.progress >= 1) b.events.push({ type: 'built', point: p.id, building: bd.kind, owner: p.owner });
        } else if (bd.upgradeLeft > 0) {
          bd.upgradeLeft = Math.max(0, bd.upgradeLeft - dt);
          if (bd.upgradeLeft <= 0) {
            const previousHp = buildingHp(bd.kind, bd.level);
            bd.level = Math.min(3, bd.level + 1) as BuildingLevel;
            bd.hp += buildingHp(bd.kind, bd.level) - previousHp;
            bd.upgradeTotal = 0;
            b.events.push({ type: 'built', point: p.id, building: bd.kind, owner: p.owner });
          }
        }
      });
    }
  }

  private shipyards(b: Battle, dt: number) {
    // Battle rebuilds its spatial index before shore construction runs. New launches enter that index next tick.
    const launched: { x: number; z: number }[] = [];
    for (const p of this.points) {
      if (p.owner < 0) continue;
      const workers = p.queue.slice(0, this.queueWorkers(p));
      workers.forEach((item, worker) => {
        item.left -= dt * this.constructionRate(p.owner);
        if (item.left > 0 || this.afloat(b, p.owner) >= this.shipLimit(p.owner)) return;
        // Extra slipways launch side by side when the adjacent water is navigable.
        const offset = worker === 0 ? 0 : Math.ceil(worker / 2) * (worker % 2 ? -42 : 42);
        let x = p.spawn.x - Math.sin(p.spawn.heading) * offset;
        let z = p.spawn.z + Math.cos(p.spawn.heading) * offset;
        if (this.land(x, z) > -7) { x = p.spawn.x; z = p.spawn.z; }
        if (this.options.expanded && launched.some((s) => dist2(s.x, s.z, x, z) < 24 * 24)) return;
        let blocked = false;
        b.near(x, z, 24, () => { blocked = true; });
        if (blocked && item.left > -20) return;
        p.queue.splice(p.queue.indexOf(item), 1);
        this.launch(b, p, item.kind, x, z);
        launched.push({ x, z });
      });
    }
  }

  /** Puts a finished ship in the water and in a squadron of its kind. */
  launch(b: Battle, p: CapturePoint, kind: ShipKind, x = p.spawn.x, z = p.spawn.z, heading = p.spawn.heading) {
    const pl = this.players[p.owner]!;
    const sq = this.squadronFor(b, pl, kind);
    const key = `${pl.slot}:${kind}`;
    const n = (this.recruitSeq.get(key) ?? 0) + 1;
    this.recruitSeq.set(key, n);
    const ship = b.addShip(kind, x, z, heading, numbered(SHORT_NAME[kind], n), sq, false, variantFor(kind, n));
    ship.speed = 0;
    ship.order = p.rally ? { type: 'move', x: p.rally.x, z: p.rally.z } : { type: 'move', x: p.x + Math.cos(heading) * 30, z: p.z + Math.sin(heading) * 30 };
    b.events.push({ type: 'spawned', ship: ship.id, point: p.id });
    return ship;
  }

  private squadronFor(b: Battle, pl: ConquestPlayer, kind: ShipKind): Squadron {
    const label = SHORT_NAME[kind];
    const open = b.squadrons.find((sq) => sq.owner === pl.slot && sq.name.startsWith(label) && sq.shipIds.filter((id) => b.isActive(b.get(id))).length < 6);
    if (open) return open;
    const index = b.squadrons.filter((sq) => sq.owner === pl.slot && sq.name.startsWith(label)).length + 1;
    const all = b.squadrons.filter((sq) => sq.owner === pl.slot).length;
    const portraits = PORTRAITS[pl.faction];
    const portrait = portraits[all % portraits.length]!;
    return b.addSquadron(pl.team, fleetNo(label, index), pl.name, portrait, cardOf(kind), pl.slot);
  }

  get tenders() {
    return !!this.options.expanded;
  }

  /** Scratch for tend(): ships served this step and one tender's candidates. */
  private readonly tendServed = new Set<number>();
  private readonly tendWanted: { s: Ship; need: number; d: number }[] = [];

  /** Tenders top up the friends beside them. A ship takes from one tender only, so a crowd of tenders cannot make it immortal. */
  private tend(b: Battle, dt: number) {
    const served = this.tendServed;
    served.clear();
    const wanted = this.tendWanted;
    for (const t of b.ships) {
      const spec = t.spec.tender;
      if (!spec || !b.isActive(t)) continue;
      wanted.length = 0;
      b.near(t.x, t.z, spec.range, (s) => {
        if (s === t || s.team !== t.team || !b.isActive(s) || served.has(s.id) || b.time - s.lastHit <= 8) return;
        const need = b.tenderNeed(s);
        if (need > 0) wanted.push({ s, need, d: Math.hypot(s.x - t.x, s.z - t.z) });
      });
      wanted.sort((p, q) => q.need - p.need || p.d - q.d || p.s.id - q.s.id);
      const n = Math.min(wanted.length, Math.max(0, spec.capacity));
      for (let i = 0; i < n; i++) {
        const s = wanted[i]!.s;
        served.add(s.id);
        b.mend(s, dt * spec.hull, dt * spec.crew);
        b.resupply(s, dt * spec.ammo);
      }
    }
  }

  /** Shore batteries, docks, magazines and beacons. */
  private services(b: Battle, dt: number) {
    if (this.tenders) this.tend(b, dt);
    for (const p of this.points) {
      if (p.owner < 0) continue;
      const pl = this.players[p.owner]!;
      p.buildings.forEach((bd, i) => {
        if (!bd || bd.progress < 1) return;
        const spot = p.slots[i]!;
        if (bd.kind === 'battery') this.battery(b, p, bd, spot, pl, dt);
      });
      const docks = this.levels(p, 'dock');
      const mags = this.levels(p, 'magazine');
      const beacon = this.levels(p, 'beacon');
      const camps = this.levels(p, 'camp');
      if (!docks && !mags && !beacon && !camps) continue;
      b.near(p.x, p.z, p.r * 1.2, (s) => {
        if (s.team !== pl.team || !b.isActive(s)) return;
        if (docks && b.time - s.lastHit > 8) b.mend(s, dt * (this.options.expanded ? 0.01 : 0.006) * docks, dt * (this.options.expanded ? 0.002 : 0.004) * docks);
        if (camps && b.time - s.lastHit > 8) b.mend(s, 0, dt * (this.options.expanded ? 0.008 : 0.004) * camps);
        if (mags) b.resupply(s, dt * 0.01 * mags);
      });
      if (beacon && b.night) {
        b.near(p.x, p.z, 1800 + (beacon - 1) * 450, (s) => {
          if (s.team !== pl.team) s.revealed = Math.max(s.revealed, 1.5);
        });
      }
    }
  }

  private battery(b: Battle, p: CapturePoint, bd: Building, spot: Spot, pl: ConquestPlayer, dt: number) {
    const kit = BATTERY_GUNS[pl.faction];
    const gun = GUN_SPECS[kit.gun];
    const count = kit.count + (bd.level - 1);
    const range = gun.range * (1.1 + (bd.level - 1) * 0.08);
    for (let g = 0; g < count && g < bd.reload.length; g += 1) {
      bd.reload[g] = bd.reload[g]! - dt * (0.5 + 0.5 * (bd.hp / buildingHp('battery', bd.level))) * (1 + (bd.level - 1) * 0.15);
      if (bd.reload[g]! > 0) continue;
      let target: Ship | undefined;
      let best = range;
      b.near(spot.x, spot.z, range, (s) => {
        if (s.team === pl.team || !b.isActive(s)) return;
        const d = Math.hypot(s.x - spot.x, s.z - spot.z);
        if (d < best && b.canSee(s, d, pl.team)) {
          best = d;
          target = s;
        }
      });
      if (!target) {
        bd.reload[g] = 1.5;
        continue;
      }
      const t = target as Ship;
      const ox = spot.x + Math.cos(spot.rot) * 6 + Math.cos(spot.rot + Math.PI / 2) * (g - count / 2) * 3;
      const oz = spot.z + Math.sin(spot.rot) * 6 + Math.sin(spot.rot + Math.PI / 2) * (g - count / 2) * 3;
      const oy = spot.y + 4;
      const dx = t.x - ox;
      const dz = t.z - oz;
      const d = Math.hypot(dx, dz) || 1;
      b.launch(
        { x: ox, y: oy, z: oz, dx: dx / d, dz: dz / d },
        { x: t.x, y: t.spec.deck * 0.6, z: t.z, vx: Math.cos(t.heading) * t.speed, vz: Math.sin(t.heading) * t.speed },
        kit.gun,
        pl.team,
        0,
        { damage: gun.damage * (1 + (bd.level - 1) * 0.15), crewDamage: gun.crewDamage * (1 + (bd.level - 1) * 0.15), ammo: gun.ammo, spreadMul: 0.9, skill: 1, fireChance: 0.1 },
      );
      b.events.push({ type: 'battery', point: p.id, x: ox, y: oy, z: oz, dx: dx / d, dy: 0.05, dz: dz / d });
      bd.reload[g] = kit.reload * (0.85 + b.random() * 0.3);
    }
  }

  private economy() {
    for (const pl of this.players) {
      let income = BASE_INCOME;
      for (const p of this.points) {
        if (p.owner !== pl.slot) continue;
        income += POINT_INCOME * p.value * (1 + 0.3 * this.levels(p, 'magazine'));
      }
      income *= this.options.incomeScale ?? 1;
      pl.income = Math.round(income);
      pl.funds += income / 60;
    }
  }

  /** Weighted points held by a team. A beacon adds half again. */
  remoteHeld?: Record<Team, number>;
  held(team: Team) {
    if (this.remoteHeld) return this.remoteHeld[team];
    let v = 0;
    for (const p of this.points) if (this.teamOfPoint(p) === team) v += p.value * (1 + 0.5 * this.levels(p, 'beacon'));
    return v;
  }

  private drain() {
    const a = this.held('joseon');
    const c = this.held('japan');
    if (a > c) this.tickets.japan -= (a - c) * 0.35;
    else if (c > a) this.tickets.joseon -= (c - a) * 0.35;
  }

  /** The side swept from the sea for SWEPT_TIME seconds, if one has been (the depth rules). */
  private swept(b: Battle): Team | null {
    if (!b.morale) return null;
    const value = { joseon: b.strength('joseon'), japan: b.strength('japan') };
    for (const t of TEAMS) this.peak[t] = Math.max(this.peak[t], value[t]);
    if (b.time < SWEPT_AFTER) return null;
    for (const t of TEAMS) {
      if (value[t] >= value[otherTeam(t)] * SWEPT_SHARE || value[t] > this.peak[t] * (1 - SWEPT_LOSS)) {
        this.sweptSince[t] = null;
        continue;
      }
      this.sweptSince[t] ??= b.time;
      if (b.time - this.sweptSince[t]! >= SWEPT_TIME) return t;
    }
    return null;
  }

  /** A broken fleet bleeds its tickets (the depth rules). */
  private collapse(b: Battle) {
    const morale = b.morale;
    if (!morale || b.time < COLLAPSE_AFTER) return;
    for (const t of TEAMS) if (morale.broken(t)) this.tickets[t] -= this.options.tickets * COLLAPSE_RATE;
  }

  /** A routing ship runs for the nearest port its side holds, a dock first, where it can rally and mend. */
  refuge(_b: Battle, s: Ship) {
    let best: CapturePoint | null = null;
    let bestD = Infinity;
    for (const p of this.points) {
      if (this.teamOfPoint(p) !== s.team) continue;
      const d = dist2(p.x, p.z, s.x, s.z) * (this.levels(p, 'dock') ? 0.5 : 1);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ? { x: best.x, z: best.z } : null;
  }

  lost(b: Battle, s: Ship) {
    this.tickets[s.team] -= s.spec.cost / 12;
    const owner = this.players[s.owner];
    if (owner) owner.lost += 1;
    for (const pl of this.players) if (pl.team !== s.team) pl.sunk += 1 / Math.max(1, this.players.filter((q) => q.team !== s.team).length);
    void b;
  }

  impact(b: Battle, x: number, _y: number, z: number, damage: number, team: Team) {
    for (const p of this.points) {
      if (dist2(p.x, p.z, x, z) > (p.r + 700) ** 2) continue;
      if (this.teamOfPoint(p) === team) continue;
      p.buildings.forEach((bd, i) => {
        if (!bd) return;
        const spot = p.slots[i]!;
        if (dist2(spot.x, spot.z, x, z) > 26 * 26) return;
        bd.hp -= damage * 1.3;
        if (bd.hp <= 0) {
          p.buildings[i] = null;
          b.events.push({ type: 'razed', point: p.id, building: bd.kind });
        }
      });
    }
  }

  /** Weakest building in range of a ship, for bombardment orders. */
  targetNear(team: Team, x: number, z: number, range: number) {
    let best: { point: number; slot: number; x: number; y: number; z: number } | null = null;
    let bestD = range * range;
    for (const p of this.points) {
      const t = this.teamOfPoint(p);
      if (!t || t === team) continue;
      p.buildings.forEach((bd, i) => {
        if (!bd) return;
        const s = p.slots[i]!;
        const d = dist2(s.x, s.z, x, z);
        if (d < bestD) {
          bestD = d;
          best = { point: p.id, slot: i, x: s.x, y: s.y, z: s.z };
        }
      });
    }
    return best as { point: number; slot: number; x: number; y: number; z: number } | null;
  }

  decide(b: Battle): Team | 'draw' | null {
    const tie = () => this.options.tieWinner ?? 'draw';
    if (this.tickets.joseon <= 0 && this.tickets.japan <= 0) return tie();
    for (const t of TEAMS) if (this.tickets[t] <= 0) return otherTeam(t);
    const defeated: Team[] = [];
    for (const t of TEAMS) {
      if (b.activeOf(t).length > 0) continue;
      const seats = this.players.filter((p) => p.team === t);
      const rebuilding = seats.some((pl) => this.points.some((p) => p.owner === pl.slot && (p.queue.length > 0 || (this.count(p, 'shipyard') > 0 && pl.funds >= Math.min(...rosterOf(pl.faction, this.options.expanded).map((k) => this.shipSpec(k).cost))))));
      if (!rebuilding && b.time > 5) defeated.push(t);
    }
    if (defeated.length === 2) return tie();
    if (defeated.length === 1) return otherTeam(defeated[0]!);
    const swept = this.sweptTeam;
    if (swept) return otherTeam(swept);
    if (b.time >= this.options.timeLimit) {
      if (this.tickets.joseon === this.tickets.japan) return tie();
      return this.tickets.joseon > this.tickets.japan ? 'joseon' : 'japan';
    }
    return null;
  }
}
