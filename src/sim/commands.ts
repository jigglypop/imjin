import type { Battle } from './battle';
import type { BuildingKind, Conquest } from './conquest';
import type { CrewPlan, Order, Ship, ShipKind, Stance, AmmoMode, FireMode } from './types';

export type ShipPatch = Partial<{ fireMode: FireMode; ammo: AmmoMode; speedCap: number; stance: Stance; lights: boolean; repel: boolean }>;
export type FormationKind = 'crane' | 'line' | 'column' | 'wedge';

/**
 * Everything a commander can tell the battle, in a form that can be sent over the network. A local battle applies
 * commands as they are issued; a multiplayer server applies them for the player who sent them.
 */
export type Command =
  | { type: 'orders'; list: { id: number; order: Order }[] }
  | { type: 'order'; ids: number[]; order: Order }
  | { type: 'configure'; ids: number[]; patch: ShipPatch }
  | { type: 'volley'; ids: number[]; side: number }
  | { type: 'formation'; ids: number[]; kind: FormationKind; cx: number; cz: number }
  | { type: 'cut'; ids: number[] }
  | { type: 'plan'; ids: number[]; plan: CrewPlan }
  | { type: 'build'; point: number; building: BuildingKind }
  | { type: 'recruit'; point: number; kind: ShipKind }
  | { type: 'cancel'; point: number; index: number }
  | { type: 'demolish'; point: number; slot: number };

const ORDER_TYPES = new Set(['auto', 'move', 'attack', 'hold', 'anchor', 'slot', 'follow', 'broadside', 'bombard']);
const finite = (...v: unknown[]) => v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** Rejects malformed orders from the wire. */
function validOrder(o: Order | undefined): o is Order {
  if (!o || !ORDER_TYPES.has(o.type)) return false;
  switch (o.type) {
    case 'move':
      return finite(o.x, o.z);
    case 'slot':
      return finite(o.x, o.z, o.face);
    case 'attack':
      return finite(o.targetId);
    case 'follow':
      return finite(o.leaderId, o.dx, o.dz);
    case 'broadside':
      return finite(o.targetId) && (o.side === 0 || o.side === 1);
    case 'bombard':
      return finite(o.x, o.y, o.z);
    default:
      return true;
  }
}

/**
 * Applies a command for an owner. Ships the owner does not command are skipped, so a client cannot order someone
 * else's fleet. Returns how many ships or items it touched, for the order toasts.
 */
export function applyCommand(b: Battle, owner: number, cmd: Command, conquest: Conquest | null = null): number {
  const mine = (ids: unknown) => (Array.isArray(ids) ? ids : []).filter((id): id is number => typeof id === 'number').filter((id) => isMine(b.get(id), owner, b));
  switch (cmd.type) {
    case 'orders': {
      let n = 0;
      for (const item of Array.isArray(cmd.list) ? cmd.list.slice(0, 400) : []) {
        if (!validOrder(item?.order) || !mine([item.id]).length) continue;
        b.setOrder([item.id], item.order);
        n += 1;
      }
      return n;
    }
    case 'order': {
      if (!validOrder(cmd.order)) return 0;
      const ids = mine(cmd.ids);
      b.setOrder(ids, cmd.order);
      return ids.length;
    }
    case 'configure': {
      const ids = mine(cmd.ids);
      const p = cmd.patch ?? {};
      const patch: ShipPatch = {};
      if (p.fireMode === 'free' || p.fireMode === 'hold') patch.fireMode = p.fireMode;
      if (p.ammo === 'auto' || p.ammo === 'hull' || p.ammo === 'crew' || p.ammo === 'fire') patch.ammo = p.ammo;
      if (finite(p.speedCap)) patch.speedCap = Math.max(0, Math.min(1, p.speedCap!));
      if (p.stance && ['auto', 'standoff', 'close', 'ram', 'board'].includes(p.stance)) patch.stance = p.stance;
      if (typeof p.lights === 'boolean') patch.lights = p.lights;
      if (typeof p.repel === 'boolean') patch.repel = p.repel;
      b.configure(ids, patch);
      if (patch.stance) {
        for (const id of ids) {
          const s = b.get(id)!;
          const t = s.order.type;
          if (t === 'hold' || t === 'slot' || t === 'move' || t === 'follow' || t === 'broadside' || t === 'bombard') s.order = { type: 'auto' };
        }
      }
      return ids.length;
    }
    case 'volley':
      return [0, 1, 2, 3].includes(cmd.side) ? b.volley(mine(cmd.ids), cmd.side) : 0;
    case 'formation': {
      if (!['crane', 'line', 'column', 'wedge'].includes(cmd.kind) || !finite(cmd.cx, cmd.cz)) return 0;
      const ids = mine(cmd.ids);
      b.formation(ids, cmd.kind, cmd.cx, cmd.cz);
      return ids.length;
    }
    case 'cut':
      return b.cutGrapples(mine(cmd.ids));
    case 'plan': {
      const plan = cmd.plan;
      if (!Array.isArray(plan) || plan.length !== 4 || !finite(...plan)) return 0;
      const ids = mine(cmd.ids);
      b.setPlan(ids, plan);
      return ids.length;
    }
    case 'build':
      return conquest?.build(b, owner, cmd.point, cmd.building) ? 1 : 0;
    case 'recruit':
      return conquest?.recruitIn(b, owner, cmd.point, cmd.kind) ? 1 : 0;
    case 'cancel':
      return conquest?.cancel(owner, cmd.point, cmd.index) ? 1 : 0;
    case 'demolish':
      return conquest?.demolish(b, owner, cmd.point, cmd.slot) ? 1 : 0;
    default:
      return 0;
  }
}

export function isMine(s: Ship | undefined, owner: number, b: Battle): s is Ship {
  return b.isActive(s) && s.owner === owner;
}
