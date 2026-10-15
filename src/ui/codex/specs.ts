import { GUN_SPECS, SHIP_SPECS } from '../../sim/catalog';
import { modelKind, modelScale } from '../../ships/anchors';
import { SHORT_NAME } from '../../sim/conquest';
import type { GunType, ShipKind } from '../../sim/types';

// The game's own figures for the spec sheet, read from the sim catalog (historical battles use it as it is).

export type GunLine = { gun: GunType; label: string; count: number; bow: boolean; range: number };

/** The guns a kind carries, largest first, both broadsides and the bow counted together. */
export function gunsOf(kind: ShipKind): GunLine[] {
  const lines = new Map<GunType, GunLine>();
  for (const b of SHIP_SPECS[kind].batteries) {
    const line = lines.get(b.gun) ?? { gun: b.gun, label: GUN_SPECS[b.gun].label, count: 0, bow: false, range: GUN_SPECS[b.gun].range };
    line.count += b.count;
    line.bow ||= b.side === 2;
    lines.set(b.gun, line);
  }
  return [...lines.values()].sort((p, q) => GUN_SPECS[q.gun].damage - GUN_SPECS[p.gun].damage);
}

/** Men at each station of the usual plan, in CREW_ROLES order (oars, guns, bows or arquebuses, melee). */
export function crewOf(kind: ShipKind): number[] {
  const spec = SHIP_SPECS[kind];
  return spec.crewPlan.map((share) => Math.round(share * spec.crew));
}

export const knots = (metresPerSecond: number) => Math.round(metresPerSecond * 1.944 * 10) / 10;

/** Weight of metal one round of every gun throws, in the sim's damage units: what the firepower bar compares. */
const firepower = (kind: ShipKind) => SHIP_SPECS[kind].batteries.reduce((sum, b) => sum + GUN_SPECS[b.gun].damage * b.count, 0);

const KINDS = Object.keys(SHIP_SPECS) as ShipKind[];
const most = (f: (k: ShipKind) => number) => Math.max(...KINDS.map(f));
const METRICS: { label: string; of: (k: ShipKind) => number }[] = [
  { label: '선체', of: (k) => SHIP_SPECS[k].hull },
  { label: '화포', of: firepower },
  { label: '속력', of: (k) => SHIP_SPECS[k].maxSpeed },
  { label: '선회', of: (k) => SHIP_SPECS[k].turnRate },
  { label: '백병전', of: (k) => SHIP_SPECS[k].melee * (SHIP_SPECS[k].soldiers + SHIP_SPECS[k].crew * 0.25) },
];
const TOPS = METRICS.map((m) => most(m.of));

/** Each bar of the sheet as a share of the best of every kind. */
export function barsOf(kind: ShipKind) {
  return METRICS.map((m, i) => ({ label: m.label, value: m.of(kind) / TOPS[i]! }));
}

/** The model the game draws an aliased kind with, and how large it is drawn, or null for a kind with its own model. */
export function drawnWith(kind: ShipKind) {
  const model = modelKind(kind);
  return model === kind ? null : { model: SHORT_NAME[model], scale: Math.round(modelScale(kind) * 100) };
}
