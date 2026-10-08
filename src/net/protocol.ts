import type { Command } from '../sim/commands';
import type { BuildingKind } from '../sim/conquest';
import type { ConquestMapId, Seat } from '../sim/maps';
import type { BattleEvent, CrewPlan, Faction, Ship, ShipKind, Squadron, Team } from '../sim/types';

/** Bumped whenever client and server stop understanding each other. */
export const PROTOCOL = 1;
export const SNAPSHOT_HZ = 10;

export type RoomSeat = { name: string; faction: Faction; team: Team; human: boolean; client: string | null; ready: boolean };
export type RoomInfo = { id: string; name: string; map: ConquestMapId; size: 2 | 4; host: string; state: 'lobby' | 'battle' | 'ended'; seats: RoomSeat[] };
export type RoomSummary = { id: string; name: string; map: ConquestMapId; size: number; humans: number; open: number; state: RoomInfo['state'] };

export type ShipMeta = { id: number; kind: ShipKind; name: string; squadron: number; flagship: boolean; variant: number; owner: number; team: Team };
export type PointState = {
  owner: number;
  hold: number;
  contested: boolean;
  buildings: ({ kind: BuildingKind; hp: number; progress: number } | null)[];
  queue: { kind: ShipKind; left: number; total: number }[];
};
export type ConquestState = {
  tickets: Record<Team, number>;
  points: PointState[];
  players: { funds: number; income: number; sunk: number; lost: number; human: boolean }[];
};

export type ClientMsg =
  | { t: 'hello'; name: string; v: number }
  | { t: 'list' }
  | { t: 'create'; name: string; map: ConquestMapId; size: 2 | 4 }
  | { t: 'join'; room: string }
  | { t: 'leave' }
  | { t: 'take'; index: number }
  | { t: 'seat'; index: number; faction?: Faction; human?: boolean }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'cmd'; cmd: Command }
  | { t: 'chat'; text: string }
  | { t: 'ping'; at: number };

export type ServerMsg =
  | { t: 'welcome'; id: string; v: number }
  | { t: 'rooms'; rooms: RoomSummary[] }
  | { t: 'room'; room: RoomInfo | null }
  | { t: 'error'; text: string }
  | { t: 'chat'; from: string; text: string }
  | { t: 'start'; map: ConquestMapId; seats: Seat[]; you: number; seed: number }
  | { t: 'meta'; ships: ShipMeta[]; squadrons: Squadron[] }
  | { t: 'state'; conquest: ConquestState }
  | { t: 'events'; events: BattleEvent[] }
  | { t: 'end'; winner: Team }
  | { t: 'pong'; at: number };

export const KINDS: ShipKind[] = ['panokseon', 'geobukseon', 'hyeopseon', 'atakebune', 'sekibune', 'kobaya', 'mingship', 'mingsmall'];
const ORDERS = ['auto', 'move', 'attack', 'hold', 'anchor', 'slot', 'follow', 'broadside', 'bombard'] as const;
const STANCES = ['auto', 'standoff', 'close', 'ram', 'board'] as const;
const AMMOS = ['auto', 'hull', 'crew', 'fire'] as const;

/** Events the client needs to draw and sound the battle. The rest stay on the server. */
export const SENT_EVENTS = new Set<BattleEvent['type']>([
  'gun',
  'shot',
  'musket',
  'hit',
  'splash',
  'ground',
  'ignite',
  'explode',
  'ram',
  'board',
  'casualty',
  'volley',
  'repelled',
  'sinking',
  'struck',
  'removed',
  'spawned',
  'captured',
  'built',
  'razed',
  'battery',
]);

export type ShipFrame = {
  id: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  turn: number;
  hull: number;
  crew: number;
  roles: [number, number, number, number];
  plan: CrewPlan;
  fire: number;
  burn: number;
  sinking: number;
  struck: boolean;
  lights: boolean;
  repel: boolean;
  grappledWith: number;
  targetId: number;
  order: number;
  stance: number;
  ammo: number;
  hold: boolean;
  speedCap: number;
  supply: number;
  /** Gun reload stages, only for the receiving player's own ships. */
  guns: { stage: number; t: number; ammo: number }[] | null;
};

const HEADER = 12;
const SHIP = 64;

/**
 * Binary snapshot of every live ship, about 64 bytes each, plus gun states for the receiver's own ships. Floats are
 * full precision where an error would show as a jump (position, heading), quantized where it would not.
 */
export function encodeSnapshot(time: number, ships: readonly Ship[], owner: number, isActive: (s: Ship) => boolean): ArrayBuffer {
  const live = ships.filter((s) => s.alive);
  let gunBytes = 0;
  for (const s of live) if (s.owner === owner && isActive(s)) gunBytes += 1 + s.guns.length * 4;
  const buf = new ArrayBuffer(HEADER + live.length * SHIP + gunBytes);
  const d = new DataView(buf);
  d.setUint8(0, 1);
  d.setUint8(1, PROTOCOL);
  d.setUint16(2, live.length, true);
  d.setFloat64(4, time, true);
  let o = HEADER;
  for (const s of live) {
    d.setUint16(o, s.id, true);
    d.setFloat32(o + 2, s.x, true);
    d.setFloat32(o + 6, s.z, true);
    d.setFloat32(o + 10, s.heading, true);
    d.setInt16(o + 14, Math.round(s.speed * 1000), true);
    d.setInt16(o + 16, Math.round(s.turn * 10000), true);
    d.setFloat32(o + 18, s.hull, true);
    for (let k = 0; k < 4; k += 1) d.setUint16(o + 22 + k * 2, Math.min(65535, Math.round(s.roles[k]! * 10)), true);
    for (let k = 0; k < 4; k += 1) d.setUint8(o + 30 + k, Math.round(s.plan[k]! * 255));
    d.setUint8(o + 34, Math.round(s.fire * 255));
    d.setUint8(o + 35, Math.round(s.burn * 255));
    d.setUint16(o + 36, Math.round(s.sinking * 65535), true);
    d.setUint8(o + 38, (s.struck ? 1 : 0) | (s.lights ? 2 : 0) | (s.repel ? 4 : 0) | (s.fireMode === 'hold' ? 8 : 0));
    d.setUint16(o + 39, s.grappledWith, true);
    d.setUint16(o + 41, s.targetId, true);
    d.setUint8(o + 43, ORDERS.indexOf(s.order.type));
    d.setUint8(o + 44, STANCES.indexOf(s.stance));
    d.setUint8(o + 45, AMMOS.indexOf(s.ammo));
    d.setUint8(o + 46, Math.round(s.speedCap * 255));
    d.setUint8(o + 47, Math.round(s.supply * 255));
    const own = s.owner === owner && isActive(s);
    d.setUint8(o + 48, own ? Math.min(255, s.guns.length) : 0);
    o += SHIP;
  }
  for (const s of live) {
    if (!(s.owner === owner && isActive(s))) continue;
    d.setUint8(o, s.guns.length);
    o += 1;
    for (const g of s.guns) {
      d.setUint8(o, g.stage);
      d.setUint8(o + 1, Math.min(255, Math.round(g.t * 10)));
      d.setUint16(o + 2, g.ammo, true);
      o += 4;
    }
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): { time: number; ships: ShipFrame[] } | null {
  const d = new DataView(buf);
  if (d.getUint8(0) !== 1 || d.getUint8(1) !== PROTOCOL) return null;
  const n = d.getUint16(2, true);
  const time = d.getFloat64(4, true);
  const ships: ShipFrame[] = [];
  let o = HEADER;
  const gunCounts: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const flags = d.getUint8(o + 38);
    ships.push({
      id: d.getUint16(o, true),
      x: d.getFloat32(o + 2, true),
      z: d.getFloat32(o + 6, true),
      heading: d.getFloat32(o + 10, true),
      speed: d.getInt16(o + 14, true) / 1000,
      turn: d.getInt16(o + 16, true) / 10000,
      hull: d.getFloat32(o + 18, true),
      roles: [0, 1, 2, 3].map((k) => d.getUint16(o + 22 + k * 2, true) / 10) as [number, number, number, number],
      plan: [0, 1, 2, 3].map((k) => d.getUint8(o + 30 + k) / 255) as CrewPlan,
      crew: 0,
      fire: d.getUint8(o + 34) / 255,
      burn: d.getUint8(o + 35) / 255,
      sinking: d.getUint16(o + 36, true) / 65535,
      struck: !!(flags & 1),
      lights: !!(flags & 2),
      repel: !!(flags & 4),
      hold: !!(flags & 8),
      grappledWith: d.getUint16(o + 39, true),
      targetId: d.getUint16(o + 41, true),
      order: d.getUint8(o + 43),
      stance: d.getUint8(o + 44),
      ammo: d.getUint8(o + 45),
      speedCap: d.getUint8(o + 46) / 255,
      supply: d.getUint8(o + 47) / 255,
      guns: null,
    });
    gunCounts.push(d.getUint8(o + 48));
    o += SHIP;
  }
  for (let i = 0; i < n; i += 1) {
    if (!gunCounts[i]) continue;
    const count = d.getUint8(o);
    o += 1;
    const guns = [];
    for (let k = 0; k < count; k += 1) {
      guns.push({ stage: d.getUint8(o), t: d.getUint8(o + 1) / 10, ammo: d.getUint16(o + 2, true) });
      o += 4;
    }
    ships[i]!.guns = guns;
  }
  for (const s of ships) s.crew = s.roles[0] + s.roles[1] + s.roles[2] + s.roles[3];
  return { time, ships };
}

export const ORDER_NAMES = ORDERS;
export const STANCE_NAMES = STANCES;
export const AMMO_NAMES = AMMOS;
