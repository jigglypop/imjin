import type { Battle, BattleRules } from './battle';
import { GUN_SPECS, SHIP_SPECS } from './catalog';
import { Strategist } from './strategy';
import { variantFor } from '../ships/anchors';
import type { ConquestState } from '../net/protocol';
import { otherTeam, TEAMS, type Faction, type GunType, type LandSampler, type Ship, type ShipKind, type Squadron, type Team } from './types';

export type BuildingKind = 'shipyard' | 'battery' | 'magazine' | 'dock' | 'beacon';

export type BuildingSpec = { kind: BuildingKind; label: string; cost: number; time: number; hp: number; desc: string };

export const BUILDINGS: Record<BuildingKind, BuildingSpec> = {
  shipyard: { kind: 'shipyard', label: '선소', cost: 450, time: 40, hp: 520, desc: '함선을 건조합니다' },
  battery: { kind: 'battery', label: '포대', cost: 500, time: 45, hp: 640, desc: '사거리 안의 적 함선을 포격합니다' },
  magazine: { kind: 'magazine', label: '창고', cost: 300, time: 30, hp: 360, desc: '거점의 함선에 탄약을 보급하고 수입이 30% 늘어납니다' },
  dock: { kind: 'dock', label: '수리소', cost: 350, time: 35, hp: 420, desc: '거점에 머문 함선의 선체와 병력을 회복합니다' },
  beacon: { kind: 'beacon', label: '봉수대', cost: 300, time: 25, hp: 300, desc: '거점 가치가 1.5배가 되고 밤에도 멀리까지 볼 수 있습니다' },
};
export const BUILDING_ORDER: BuildingKind[] = ['shipyard', 'battery', 'magazine', 'dock', 'beacon'];

/** Ships each navy can build. */
export const ROSTER: Record<Faction, ShipKind[]> = {
  joseon: ['panokseon', 'geobukseon', 'hyeopseon'],
  japan: ['atakebune', 'sekibune', 'kobaya'],
  ming: ['mingship', 'mingsmall'],
};

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
  atakebune: '아타케',
  sekibune: '세키부네',
  kobaya: '고바야',
  mingship: '명 복선',
  mingsmall: '명 사선',
};

/** Shore guns by navy: count, gun and seconds between rounds. */
const BATTERY_GUNS: Record<Faction, { gun: GunType; count: number; reload: number }> = {
  joseon: { gun: 'jija', count: 3, reload: 9 },
  japan: { gun: 'folangji', count: 4, reload: 8 },
  ming: { gun: 'folangji', count: 4, reload: 7.5 },
};

export type Building = { kind: BuildingKind; hp: number; progress: number; reload: number[] };
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

export type ConquestOptions = { tickets: number; timeLimit: number; startFunds: number; cap: number; maxShips: number };
export const DEFAULT_OPTIONS: ConquestOptions = { tickets: 1000, timeLimit: 30 * 60, startFunds: 1200, cap: 10000, maxShips: 36 };

const BASE_INCOME = 60;
const POINT_INCOME = 45;
const CAPTURE_RATE = 0.025;
const QUEUE_MAX = 5;

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
  private recruitSeq = new Map<string, number>();
  /** Balance runs let the computer play the human seats too. */
  autopilot = false;

  constructor(map: MapPoint[], players: Omit<ConquestPlayer, 'funds' | 'income' | 'cap' | 'sunk' | 'lost'>[], land: LandSampler, options: Partial<ConquestOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
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
      const slots = placeSlots(land, site.x, site.z, face, m.home !== undefined ? 4 : 3);
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
      points: this.points.map((p) => ({
        owner: p.owner,
        hold: Math.round(p.hold * 1000) / 1000,
        contested: p.contested,
        buildings: p.buildings.map((b) => (b ? { kind: b.kind, hp: Math.round(b.hp), progress: Math.round(b.progress * 1000) / 1000 } : null)),
        queue: p.queue.map((q) => ({ kind: q.kind, left: Math.round(q.left * 10) / 10, total: q.total })),
      })),
      players: this.players.map((pl) => ({ funds: Math.floor(pl.funds), income: pl.income, sunk: pl.sunk, lost: pl.lost, human: pl.human })),
    };
  }

  /** A multiplayer client's copy takes the server's state; it never steps on its own. */
  applyState(st: ConquestState) {
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
        return b ? { kind: b.kind, hp: b.hp, progress: b.progress, reload: [] } : null;
      });
      p.queue = ps.queue.map((q) => ({ ...q }));
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
    const guns = kind === 'battery' ? 5 : 0;
    return { kind, hp: spec.hp, progress: done ? 1 : 0, reload: Array.from({ length: guns }, (_, i) => 2 + i * 1.7) };
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
        value += SHIP_SPECS[q.kind].cost;
        count += 1;
      }
    }
    return { value, count };
  }

  /** The built and finished buildings of a kind at a point. */
  count(p: CapturePoint, kind: BuildingKind) {
    let n = 0;
    for (const bd of p.buildings) if (bd && bd.kind === kind && bd.progress >= 1) n += 1;
    return n;
  }

  canBuild(owner: number, pointId: number, kind: BuildingKind) {
    const p = this.points[pointId];
    const pl = this.players[owner];
    if (!p || !pl || p.owner !== owner || !BUILDINGS[kind]) return false;
    if (!p.buildings.some((bd) => !bd)) return false;
    if (kind === 'shipyard' && p.buildings.some((bd) => bd?.kind === 'shipyard')) return false;
    if (kind === 'beacon' && p.buildings.some((bd) => bd?.kind === 'beacon')) return false;
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
    const p = this.points[pointId];
    const bd = p?.buildings[slot];
    if (!p || !bd || p.owner !== owner) return false;
    this.players[owner]!.funds += Math.round(BUILDINGS[bd.kind].cost * 0.25 * bd.progress);
    p.buildings[slot] = null;
    b.events.push({ type: 'razed', point: p.id, building: bd.kind });
    return true;
  }

  canRecruit(b: Battle, owner: number, pointId: number, kind: ShipKind) {
    const p = this.points[pointId];
    const pl = this.players[owner];
    if (!p || !pl || p.owner !== owner || !ROSTER[pl.faction].includes(kind)) return false;
    if (!this.count(p, 'shipyard') || p.queue.length >= QUEUE_MAX) return false;
    const f = this.fleet(b, owner);
    if (f.value + SHIP_SPECS[kind].cost > pl.cap || f.count >= this.options.maxShips) return false;
    return pl.funds >= SHIP_SPECS[kind].cost;
  }

  recruitIn(b: Battle, owner: number, pointId: number, kind: ShipKind) {
    if (!this.canRecruit(b, owner, pointId, kind)) return false;
    const spec = SHIP_SPECS[kind];
    this.players[owner]!.funds -= spec.cost;
    this.points[pointId]!.queue.push({ kind, left: spec.build, total: spec.build });
    return true;
  }

  cancel(owner: number, pointId: number, index: number) {
    const p = this.points[pointId];
    const item = p?.queue[index];
    if (!p || !item || p.owner !== owner) return false;
    const spec = SHIP_SPECS[item.kind];
    this.players[owner]!.funds += index === 0 ? Math.round(spec.cost * (0.5 + 0.5 * (item.left / item.total))) : spec.cost;
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
        if (!b.isActive(s)) return;
        const w = s.spec.length < 16 ? 0.35 : 1;
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
    b.events.push({ type: 'captured', point: p.id, owner: -1, from });
  }

  private take(b: Battle, p: CapturePoint, slot: number) {
    const from = p.owner;
    p.owner = slot;
    p.queue.length = 0;
    b.events.push({ type: 'captured', point: p.id, owner: slot, from });
  }

  private construct(b: Battle, dt: number) {
    for (const p of this.points) {
      if (p.owner < 0) continue;
      p.buildings.forEach((bd) => {
        if (!bd || bd.progress >= 1) return;
        bd.progress = Math.min(1, bd.progress + dt / BUILDINGS[bd.kind].time);
        if (bd.progress >= 1) b.events.push({ type: 'built', point: p.id, building: bd.kind, owner: p.owner });
      });
    }
  }

  private shipyards(b: Battle, dt: number) {
    for (const p of this.points) {
      const item = p.queue[0];
      if (!item || p.owner < 0 || !this.count(p, 'shipyard')) continue;
      item.left -= dt;
      if (item.left > 0) continue;
      let blocked = false;
      b.near(p.spawn.x, p.spawn.z, 24, () => {
        blocked = true;
      });
      if (blocked && item.left > -20) continue;
      p.queue.shift();
      this.launch(b, p, item.kind);
    }
  }

  /** Puts a finished ship in the water and in a squadron of its kind. */
  launch(b: Battle, p: CapturePoint, kind: ShipKind, x = p.spawn.x, z = p.spawn.z, heading = p.spawn.heading) {
    const pl = this.players[p.owner]!;
    const sq = this.squadronFor(b, pl, kind);
    const key = `${pl.slot}:${kind}`;
    const n = (this.recruitSeq.get(key) ?? 0) + 1;
    this.recruitSeq.set(key, n);
    const ship = b.addShip(kind, x, z, heading, `${SHORT_NAME[kind]} ${n}호`, sq, false, variantFor(kind, n));
    ship.speed = 0;
    ship.order = { type: 'move', x: p.x + Math.cos(heading) * 30, z: p.z + Math.sin(heading) * 30 };
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
    const card = `card_${kind === 'hyeopseon' || kind.startsWith('ming') ? 'panokseon' : kind === 'kobaya' ? 'sekibune' : kind}`;
    return b.addSquadron(pl.team, `${label} ${index}대`, `${pl.name} 휘하`, portrait, card, pl.slot);
  }

  /** Shore batteries, docks, magazines and beacons. */
  private services(b: Battle, dt: number) {
    for (const p of this.points) {
      if (p.owner < 0) continue;
      const pl = this.players[p.owner]!;
      p.buildings.forEach((bd, i) => {
        if (!bd || bd.progress < 1) return;
        const spot = p.slots[i]!;
        if (bd.kind === 'battery') this.battery(b, p, bd, spot, pl, dt);
      });
      const docks = this.count(p, 'dock');
      const mags = this.count(p, 'magazine');
      const beacon = this.count(p, 'beacon');
      if (!docks && !mags && !beacon) continue;
      b.near(p.x, p.z, p.r * 1.2, (s) => {
        if (s.team !== pl.team || !b.isActive(s)) return;
        if (docks && b.time - s.lastHit > 8) b.mend(s, dt * 0.006 * docks, dt * 0.004 * docks);
        if (mags) b.resupply(s, dt * 0.01 * mags);
      });
      if (beacon && b.night) {
        b.near(p.x, p.z, 1800, (s) => {
          if (s.team !== pl.team) s.revealed = Math.max(s.revealed, 1.5);
        });
      }
    }
  }

  private battery(b: Battle, p: CapturePoint, bd: Building, spot: Spot, pl: ConquestPlayer, dt: number) {
    const kit = BATTERY_GUNS[pl.faction];
    const gun = GUN_SPECS[kit.gun];
    const range = gun.range * 1.1;
    for (let g = 0; g < kit.count && g < bd.reload.length; g += 1) {
      bd.reload[g] = bd.reload[g]! - dt * (0.5 + 0.5 * (bd.hp / BUILDINGS.battery.hp));
      if (bd.reload[g]! > 0) continue;
      let target: Ship | undefined;
      let best = range;
      b.near(spot.x, spot.z, range, (s) => {
        if (s.team === pl.team || !b.isActive(s)) return;
        const d = Math.hypot(s.x - spot.x, s.z - spot.z);
        if (d < best && b.canSee(s, d)) {
          best = d;
          target = s;
        }
      });
      if (!target) {
        bd.reload[g] = 1.5;
        continue;
      }
      const t = target as Ship;
      const ox = spot.x + Math.cos(spot.rot) * 6 + Math.cos(spot.rot + Math.PI / 2) * (g - kit.count / 2) * 3;
      const oz = spot.z + Math.sin(spot.rot) * 6 + Math.sin(spot.rot + Math.PI / 2) * (g - kit.count / 2) * 3;
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
        { damage: gun.damage, crewDamage: gun.crewDamage, ammo: gun.ammo, spreadMul: 0.9, morale: 1, fireChance: 0.1 },
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
        income += POINT_INCOME * p.value * (1 + 0.3 * this.count(p, 'magazine'));
      }
      pl.income = Math.round(income);
      pl.funds += income / 60;
    }
  }

  /** Weighted points held by a team. A beacon adds half again. */
  held(team: Team) {
    let v = 0;
    for (const p of this.points) if (this.teamOfPoint(p) === team) v += p.value * (this.count(p, 'beacon') ? 1.5 : 1);
    return v;
  }

  private drain() {
    const a = this.held('joseon');
    const c = this.held('japan');
    if (a > c) this.tickets.japan -= (a - c) * 0.35;
    else if (c > a) this.tickets.joseon -= (c - a) * 0.35;
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

  decide(b: Battle): Team | null {
    for (const t of TEAMS) if (this.tickets[t] <= 0) return otherTeam(t);
    for (const t of TEAMS) {
      if (b.activeOf(t).length > 0) continue;
      const seats = this.players.filter((p) => p.team === t);
      const rebuilding = seats.some((pl) => this.points.some((p) => p.owner === pl.slot && (p.queue.length > 0 || (this.count(p, 'shipyard') > 0 && pl.funds >= Math.min(...ROSTER[pl.faction].map((k) => SHIP_SPECS[k].cost))))));
      if (!rebuilding && b.time > 5) return otherTeam(t);
    }
    if (b.time >= this.options.timeLimit) return this.tickets.joseon >= this.tickets.japan ? 'joseon' : 'japan';
    return null;
  }
}
