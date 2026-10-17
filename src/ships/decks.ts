import type { ShipKind } from '../sim/types';
import { ATAKE_PLANS, ATAKE_TURRET, HYEOP_PLAN, KOBAYA_PLAN, MING_PLAN, MINGSMALL_PLAN, PANOK_OAR_DROP, PANOK_PLANS, SEKI_PLANS, anchorsFor, byModel, modelKind, modelScale, sailPlanOf, type ModelKind } from './anchors';
import { oaredPlanOf } from './anchors';
import { useProcedural } from './build/mode';

/**
 * Deck heights above the waterline for each ship model, measured by casting down through the meshes. The main
 * deck is the fighting deck: the open deck inside the panokseon's shield walls, the floor of the atakebune's
 * fortress, the gun deck under the turtle ship's roof. Big ships row from an enclosed deck below it.
 */
export const MAIN_DECK: Record<string, number> = {
  'panokseon#0': 3.9,
  'panokseon#1': 4.0,
  'panokseon#2': 3.75,
  'atakebune#0': 3.75,
  'sekibune#0': 1.5,
  'hyeopseon#0': 1.0,
  'kobaya#0': 0.75,
  'mingship#0': 2.5,
  'mingsmall#0': 0.75,
  'geobukseon#0': 4.7,
};

export type DeckPlan = {
  /** Rowers' deck below the main deck, metres under it. 0: they row on the main deck. */
  oarDrop: number;
  /** The main deck lies under open sky, so its crew show without a cutaway. */
  open: boolean;
  /** Usable deck as fractions of length and beam. */
  length: number;
  beam: number;
  /** Command platform: along-ship position as a fraction of length, height above the main deck. */
  command: { x: number; up: number } | null;
  /** Figures drawn for a full crew, by station. */
  figures: { oar: number; gun: number; shot: number; melee: number };
  /** Oars per side, for rower stations and the oar ports. */
  oars: number;
  /** A war drum is beaten on board: on the command platform, or aft on the main deck without one. */
  drum: boolean;
};

/** Per model; read it for a ship with byModel, as a kind drawn with another's model shares its deck plan. */
export const DECKS: Record<ModelKind, DeckPlan> = {
  panokseon: { oarDrop: PANOK_OAR_DROP, open: true, length: 0.66, beam: 0.72, command: { x: -0.18, up: 4 }, figures: { oar: 24, gun: 14, shot: 12, melee: 8 }, oars: 8, drum: true },
  geobukseon: { oarDrop: 2.5, open: false, length: 0.62, beam: 0.62, command: null, figures: { oar: 20, gun: 12, shot: 2, melee: 4 }, oars: 8, drum: false },
  hyeopseon: { oarDrop: 0, open: true, length: 0.6, beam: 0.5, command: null, figures: { oar: 8, gun: 2, shot: 2, melee: 1 }, oars: 4, drum: false },
  atakebune: { oarDrop: 2.2, open: true, length: 0.6, beam: 0.68, command: { x: -0.05, up: 4 }, figures: { oar: 26, gun: 4, shot: 16, melee: 12 }, oars: 13, drum: true },
  sekibune: { oarDrop: 0, open: true, length: 0.66, beam: 0.55, command: null, figures: { oar: 14, gun: 0, shot: 8, melee: 6 }, oars: 7, drum: true },
  kobaya: { oarDrop: 0, open: true, length: 0.62, beam: 0.5, command: null, figures: { oar: 8, gun: 0, shot: 3, melee: 3 }, oars: 4, drum: false },
  mingship: { oarDrop: 1.4, open: true, length: 0.6, beam: 0.66, command: { x: -0.3, up: 3 }, figures: { oar: 16, gun: 12, shot: 12, melee: 8 }, oars: 8, drum: true },
  mingsmall: { oarDrop: 0, open: true, length: 0.6, beam: 0.55, command: null, figures: { oar: 10, gun: 2, shot: 4, melee: 3 }, oars: 5, drum: false },
  racegalleon: { oarDrop: 0, open: true, length: 0.6, beam: 0.6, command: { x: -0.36, up: 4.4 }, figures: { oar: 0, gun: 14, shot: 10, melee: 8 }, oars: 0, drum: true },
  pinnace: { oarDrop: 0, open: true, length: 0.6, beam: 0.55, command: null, figures: { oar: 0, gun: 4, shot: 4, melee: 3 }, oars: 0, drum: false },
  fireship: { oarDrop: 0, open: true, length: 0.5, beam: 0.5, command: null, figures: { oar: 0, gun: 0, shot: 0, melee: 2 }, oars: 0, drum: false },
  spgalleon: { oarDrop: 0, open: true, length: 0.6, beam: 0.6, command: { x: -0.38, up: 7.5 }, figures: { oar: 0, gun: 14, shot: 18, melee: 14 }, oars: 0, drum: true },
  galleass: { oarDrop: 0, open: true, length: 0.66, beam: 0.8, command: { x: -0.43, up: 2.2 }, figures: { oar: 30, gun: 8, shot: 12, melee: 10 }, oars: 30, drum: true },
  urca: { oarDrop: 0, open: true, length: 0.55, beam: 0.6, command: null, figures: { oar: 0, gun: 4, shot: 6, melee: 4 }, oars: 0, drum: false },
  // The Lepanto galleys: oarsmen on open benches, the fighting men on the bow platform, the gangway and the poop.
  reale: { oarDrop: 0, open: true, length: 0.7, beam: 0.8, command: { x: -0.44, up: 2.4 }, figures: { oar: 40, gun: 6, shot: 16, melee: 16 }, oars: 30, drum: true },
  galea: { oarDrop: 0, open: true, length: 0.7, beam: 0.8, command: { x: -0.44, up: 1.7 }, figures: { oar: 30, gun: 4, shot: 10, melee: 8 }, oars: 25, drum: true },
  vgalleass: { oarDrop: 0, open: true, length: 0.66, beam: 0.8, command: { x: -0.43, up: 2.2 }, figures: { oar: 30, gun: 10, shot: 12, melee: 10 }, oars: 30, drum: true },
  sultana: { oarDrop: 0, open: true, length: 0.7, beam: 0.8, command: { x: -0.44, up: 2.3 }, figures: { oar: 40, gun: 4, shot: 18, melee: 16 }, oars: 31, drum: true },
  kadirga: { oarDrop: 0, open: true, length: 0.7, beam: 0.8, command: { x: -0.44, up: 1.7 }, figures: { oar: 30, gun: 3, shot: 12, melee: 8 }, oars: 25, drum: true },
  kalyata: { oarDrop: 0, open: true, length: 0.7, beam: 0.8, command: null, figures: { oar: 20, gun: 2, shot: 6, melee: 4 }, oars: 19, drum: false },
};

export function mainDeck(key: string, kind: ShipKind, fallback: number) {
  const built = useProcedural(kind) ? anchorsFor(key)?.mainDeck : undefined;
  return built ?? MAIN_DECK[key] ?? MAIN_DECK[`${kind}#0`] ?? fallback;
}

/** Cutaway heights by level: 1 lifts off roofs and towers, 2 the deck walls, 3 the main deck itself to show the rowers. */
export function cutHeight(level: number, main: number, plan: DeckPlan) {
  if (level === 1) return main + 2.4;
  if (level === 2) return main + 0.9;
  return plan.oarDrop > 0 ? main - 0.35 : main + 0.9;
}

/** A box on the main deck that men cannot stand in: a cabin, a fortress tier, a castle. Centre and half sizes, metres. */
export type Obstacle = { x: number; z: number; hx: number; hz: number };

/**
 * Where on a ship's deck men can stand and where they cross, read from the ship's anchors and plan when the model is
 * procedural and guessed from the ship's size otherwise.
 */
export type DeckLayout = {
  /** Along-ship extent men may stand in. */
  x0: number;
  x1: number;
  /** Half width of the standable deck at station x: up to the foot of the rail. */
  edge: (x: number) => number;
  /** Height of the top of the rail (shield wall, bulwark) above the main deck. */
  railUp: number;
  obstacles: Obstacle[];
  /** Height of the rowers' floor under the main deck, 0 when they row on it. */
  oarDrop: number;
  /** Along-ship places of the guns of each side (side 0 lies on -z), when the plan has them. */
  guns: [number[], number[]] | null;
  /** The command platform: along-ship position and height above the main deck. */
  command: { x: number; up: number } | null;
  /** Along-ship places of the oars of each side. */
  oars: number[];
  /** Along-ship places where grapples bite. */
  boarding: number[];
};

const layouts = new Map<string, DeckLayout>();

function obstaclesFor(kind: ModelKind, variant: number): Obstacle[] {
  if (kind === 'atakebune') {
    const p = ATAKE_PLANS[variant] ?? ATAKE_PLANS[0]!;
    const out: Obstacle[] = [{ x: p.cx, z: 0, hx: p.tiers[0]!.hx, hz: p.tiers[0]!.hz }];
    if (variant === 1) out.push({ x: ATAKE_TURRET.x, z: 0, hx: ATAKE_TURRET.hx, hz: ATAKE_TURRET.hz });
    return out;
  }
  if (kind === 'sekibune') {
    const c = (SEKI_PLANS[variant] ?? SEKI_PLANS[0]!).cabin;
    return [{ x: c.x, z: 0, hx: c.hx, hz: c.hz }];
  }
  if (kind === 'mingship') return [{ x: MING_PLAN.castle.x, z: 0, hx: MING_PLAN.castle.hx, hz: MING_PLAN.castle.hz }];
  if (kind === 'mingsmall') return [{ x: MINGSMALL_PLAN.cabin.x, z: 0, hx: MINGSMALL_PLAN.cabin.hx, hz: MINGSMALL_PLAN.cabin.hz }];
  if (oaredPlanOf(kind)) {
    const p = oaredPlanOf(kind)!;
    return [p.bow, p.stern].map((c) => ({ x: (c.x0 + c.x1) / 2, z: 0, hx: (c.x1 - c.x0) / 2, hz: p.outrigger.z }));
  }
  const sail = sailPlanOf(kind, variant);
  // The castles stand on the weather deck at both ends: men stand in the waist between them.
  if (sail) return [...sail.fore.slice(0, 1), ...sail.aft.slice(0, 1)].map((c) => ({ x: (c.x0 + c.x1) / 2, z: 0, hx: (c.x1 - c.x0) / 2, hz: sail.hull.beam / 2 }));
  return [];
}

function railUpFor(kind: ModelKind, variant: number, main: number) {
  if (kind === 'panokseon') return (PANOK_PLANS[variant] ?? PANOK_PLANS[0]!).parapet;
  if (kind === 'atakebune') return (ATAKE_PLANS[variant] ?? ATAKE_PLANS[0]!).parapet;
  if (kind === 'sekibune') return (SEKI_PLANS[variant] ?? SEKI_PLANS[0]!).parapet;
  if (kind === 'mingship') return MING_PLAN.parapet;
  if (kind === 'mingsmall') return MINGSMALL_PLAN.parapet;
  if (kind === 'kobaya') return Math.max(0.6, KOBAYA_PLAN.hull.deck - main);
  if (kind === 'hyeopseon') return Math.max(0.6, HYEOP_PLAN.hull.deck - main);
  const sail = sailPlanOf(kind, variant);
  if (sail) return sail.rail;
  if (oaredPlanOf(kind)) return oaredPlanOf(kind)!.outrigger.up + 0.6;
  return 1;
}

/** The deck layout of one ship model (`key` is kind#variant); the ship's length and beam serve a model with no plan. */
export function layoutFor(key: string, kind: ShipKind, length: number, beam: number): DeckLayout {
  const cached = layouts.get(key);
  if (cached) return cached;
  const variant = Number(key.split('#')[1] ?? 0);
  const plan = byModel(DECKS, kind);
  const a = useProcedural(kind) ? anchorsFor(key) : undefined;
  let out: DeckLayout;
  if (a) {
    // The plans are in the model's metres; a kind drawn with another's model has its anchors, and so its deck, scaled.
    const model = modelKind(kind), k = modelScale(kind);
    const sides: [number[], number[]] = [[], []];
    for (const g of a.gunPorts) if (g.side < 2) sides[g.side as 0 | 1].push(g.pos[0]);
    sides[0].sort((p, q) => p - q);
    sides[1].sort((p, q) => p - q);
    const xs = [...new Set(a.boardingPoints.map((b) => b.pos[0]))].sort((p, q) => p - q);
    const oars = [...new Set(a.oarPorts.map((o) => o.pos[0]))].sort((p, q) => p - q);
    out = {
      x0: a.deckBounds.x0,
      x1: a.deckBounds.x1,
      edge: (x) => Math.max(0.8, a.deckBounds.halfBeam(x)),
      railUp: railUpFor(model, variant, a.mainDeck / k) * k,
      obstacles: obstaclesFor(model, variant).map((o) => ({ x: o.x * k, z: o.z * k, hx: o.hx * k, hz: o.hz * k })),
      oarDrop: a.oarDeck === null ? 0 : a.mainDeck - a.oarDeck,
      guns: sides[0].length + sides[1].length > 0 ? sides : null,
      command: a.commandDeck ? { x: a.commandDeck[0], up: a.commandDeck[1] - a.mainDeck } : null,
      oars,
      boarding: xs.length ? xs : [-0.2 * length, 0.1 * length],
    };
  } else {
    const half = Math.max(1, beam * 0.5 * plan.beam - 0.4);
    out = {
      x0: -length * plan.length * 0.5,
      x1: length * plan.length * 0.5,
      edge: () => half,
      railUp: 1,
      obstacles: [],
      oarDrop: plan.oarDrop,
      guns: null,
      command: plan.command ? { x: plan.command.x * length, up: plan.command.up } : null,
      oars: [],
      boarding: [-0.3 * length * plan.length, 0, 0.3 * length * plan.length],
    };
  }
  layouts.set(key, out);
  return out;
}

/** Whether (x, z) on the main deck lies within `margin` metres of something solid. */
export function blocked(layout: DeckLayout, x: number, z: number, margin: number) {
  for (const o of layout.obstacles) if (Math.abs(x - o.x) < o.hx + margin && Math.abs(z - o.z) < o.hz + margin) return true;
  return false;
}
