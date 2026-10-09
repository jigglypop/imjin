import { SHIP_SPECS } from '../catalog';
import { batteryStrength, shipDef, type ShipDef } from './economy';
import { forkRng, next, range, type Rng } from './rng';
import type { BattleOutcome, BattleOutcomeShip, GrandFaction, RegionState, ShipUnit } from './types';

/** How a fight is settled without playing it: four rounds, two of guns and two of boarding, then the pursuit. */
export const RESOLVE = {
  /** Share of the enemy's hit points one round of equal strength removes. */
  roundK: 0.3,
  /** Round multipliers: gun, gun, melee, melee. */
  phases: ['gun', 'gun', 'melee', 'melee'] as const,
  /** The Japanese fight with the sword: extra weight in the boarding rounds. */
  boardingBonus: { joseon: 1, japan: 1.22, ming: 1 } as Record<GrandFaction, number>,
  commanderPerLevel: 0.05,
  defenderBonus: 1.03,
  campPerLevel: 0.04,
  swarmMin: 0.85,
  swarmMax: 1.3,
  /** A ship below this share of its hull is lost: sunk, burnt or struck. */
  sinkBelow: 0.14,
  /** Hits scattered per ship in each round. */
  hitsPerShip: 2.5,
  routBelow: 0.36,
  pursuit: 0.07,
  noise: 0.18,
  /** Each side's luck for the whole fight: wind, a lucky hit on a flagship. */
  fortune: 0.16,
};

export type Force = {
  /** Ships on this side, including allies of other navies. */
  ships: ShipUnit[];
  /** Highest commander level present. */
  leader: number;
  /** The port's works, for the defender. */
  region?: RegionState;
};

export type ResolveInput = {
  attacker: Force;
  defender: Force;
  /** The same seed and tags always settle the same fight. */
  seed: number;
  tags: number[];
};

export type RoundNote = { round: number; phase: 'gun' | 'melee'; attackerHp: number; defenderHp: number };

export type ResolveResult = {
  outcome: BattleOutcome;
  sunk: { attacker: number; defender: number };
  /** Strength each side started with and still has, to show a battle preview or report. */
  strength: { attacker: [number, number]; defender: [number, number] };
  rounds: RoundNote[];
};

type Unit = {
  ship: ShipUnit | null;
  def: ShipDef;
  side: 0 | 1;
  max: number;
  hp: number;
  start: number;
  crew: number;
  kills: number;
  armor: number;
  shore: boolean;
};

function unitOf(ship: ShipUnit, side: 0 | 1): Unit {
  const def = shipDef(ship.kind);
  const spec = SHIP_SPECS[ship.kind];
  const max = def.strength;
  return { ship, def, side, max, hp: max * ship.hull, start: max * ship.hull, crew: ship.crew, kills: 0, armor: spec.armor, shore: false };
}

function shoreUnit(region: RegionState, side: 0 | 1): Unit | null {
  const max = batteryStrength(region) / (0.4 + 0.6 * (region.buildings.find((b) => b.kind === 'battery')?.hp ?? 1));
  if (max <= 0) return null;
  const hp = batteryStrength(region);
  const def: ShipDef = { kind: 'panokseon', faction: 'joseon', label: '포대', gold: 0, turns: 0, strength: max, ranged: 1, boardResist: 1 };
  return { ship: null, def, side, max, hp, start: hp, crew: 1, kills: 0, armor: 0.3, shore: true };
}

const livingHp = (u: Unit[]) => u.reduce((a, x) => a + Math.max(0, x.hp), 0);

/** Offensive output of a unit in one phase: strength scaled by hull and crew, and by how much of it that phase uses. */
function output(u: Unit, phase: 'gun' | 'melee', crewNow: number, hullNow: number): number {
  const base = u.max * (0.35 + 0.65 * Math.min(1, hullNow)) * (0.4 + 0.6 * crewNow);
  return base * (phase === 'gun' ? 0.3 + 0.9 * u.def.ranged : 0.3 + 0.9 * (1 - u.def.ranged));
}

/**
 * Spreads a round's damage over the targets as a scatter of hits, each landing on a ship in proportion to its size, so
 * some ships take several and sink while others are barely touched. Damage a ship cannot absorb is thrown back.
 */
function applyDamage(targets: Unit[], dmg: number, phase: 'gun' | 'melee', attackers: Unit[], rng: Rng) {
  let left = dmg;
  for (let pass = 0; pass < 3 && left > 1e-6; pass += 1) {
    const live = targets.filter((t) => t.hp > 0 && !(phase === 'melee' && t.shore));
    if (!live.length) break;
    const hits = Math.max(6, Math.round(live.length * RESOLVE.hitsPerShip));
    const weights = live.map((t) => t.max * (0.4 + 0.6 * (t.hp / t.max)));
    const sum = weights.reduce((a, b) => a + b, 0);
    const each = left / hits;
    let spent = 0;
    for (let h = 0; h < hits; h += 1) {
      let at = next(rng) * sum;
      let i = 0;
      while (i < live.length - 1 && at > weights[i]!) {
        at -= weights[i]!;
        i += 1;
      }
      const t = live[i]!;
      if (t.hp <= 0) continue;
      const resist = phase === 'gun' ? 1 - t.armor : t.def.boardResist;
      const dealt = Math.min(t.hp, each * range(rng, 0.5, 1.5) * resist);
      t.hp -= dealt;
      spent += resist > 0 ? dealt / resist : each;
      t.crew = Math.max(0.04, t.crew - (dealt / t.max) * (phase === 'gun' ? 0.35 : 0.85));
      if (t.hp <= t.max * RESOLVE.sinkBelow && !t.shore) {
        t.hp = 0;
        const shooters = attackers.filter((a) => a.hp > 0 && !a.shore);
        if (shooters.length) shooters[Math.floor(next(rng) * shooters.length)]!.kills += 1;
      }
    }
    left -= spent;
  }
}

export function autoResolve(input: ResolveInput): ResolveResult {
  const rng = forkRng(input.seed, ...input.tags);
  const A = input.attacker.ships.map((s) => unitOf(s, 0));
  const D = input.defender.ships.map((s) => unitOf(s, 1));
  let shoreD: Unit | null = null;
  if (input.defender.region) {
    shoreD = shoreUnit(input.defender.region, 1);
    if (shoreD) D.push(shoreD);
  }
  const camp = input.defender.region?.buildings.find((b) => b.kind === 'camp')?.level ?? 0;
  const startA = livingHp(A);
  const startD = livingHp(D);
  const luckA = range(rng, 1 - RESOLVE.fortune, 1 + RESOLVE.fortune);
  const luckD = range(rng, 1 - RESOLVE.fortune, 1 + RESOLVE.fortune);
  const rounds: RoundNote[] = [];
  const side = (list: Unit[]) => list.filter((u) => u.hp > 0);

  for (let round = 0; round < RESOLVE.phases.length; round += 1) {
    const phase = RESOLVE.phases[round]!;
    const la = side(A);
    const ld = side(D);
    if (!la.length || !ld.length) break;
    const push = (mine: Unit[], theirs: Unit[], leader: number, defending: boolean): number => {
      let sum = 0;
      for (const u of mine) {
        if (u.shore && phase === 'melee') continue;
        let o = output(u, phase, u.crew, u.hp / u.max);
        if (phase === 'melee') o *= RESOLVE.boardingBonus[u.def.faction];
        sum += o;
      }
      let mul = 1 + RESOLVE.commanderPerLevel * (leader - 1);
      if (defending) mul *= RESOLVE.defenderBonus * (1 + RESOLVE.campPerLevel * camp);
      if (phase === 'melee') {
        const n = mine.filter((u) => !u.shore).length;
        const e = Math.max(1, theirs.filter((u) => !u.shore).length);
        mul *= Math.max(RESOLVE.swarmMin, Math.min(RESOLVE.swarmMax, Math.sqrt(n / e)));
      }
      return sum * mul * RESOLVE.roundK * range(rng, 1 - RESOLVE.noise, 1 + RESOLVE.noise) * (defending ? luckD : luckA);
    };
    const toD = push(la, ld, input.attacker.leader, false);
    const toA = push(ld, la, input.defender.leader, true);
    applyDamage(ld, toD, phase, la, rng);
    applyDamage(la, toA, phase, ld, rng);
    rounds.push({ round, phase, attackerHp: livingHp(A) / Math.max(1, startA), defenderHp: livingHp(D) / Math.max(1, startD) });
    // A side that has lost most of its worth breaks and runs.
    if (livingHp(A) < startA * RESOLVE.routBelow || livingHp(D) < startD * RESOLVE.routBelow) break;
  }

  const fracA = livingHp(A) / Math.max(1, startA);
  const fracD = livingHp(D) / Math.max(1, startD);
  // A tie goes to the defender: the attacker came to take the port.
  const attackerWon = fracA > fracD * 1.0001 && fracA > 0;
  const loser = attackerWon ? D : A;
  const winner = attackerWon ? A : D;
  const lw = side(loser).filter((u) => !u.shore);
  // The pursuit: the fleeing ships are caught by the winner's fast ships.
  const chase = side(winner).filter((u) => !u.shore).reduce((a, u) => a + u.max * (0.35 + 0.65 * (u.hp / u.max)) * 0.6, 0) * RESOLVE.pursuit * range(rng, 0.8, 1.2);
  if (lw.length && chase > 0) applyDamage(lw, chase, 'gun', side(winner), rng);

  const ships: BattleOutcomeShip[] = [];
  let sunkA = 0;
  let sunkD = 0;
  for (const u of [...A, ...D]) {
    if (!u.ship) continue;
    const alive = u.hp > 0;
    if (!alive) {
      if (u.side === 0) sunkA += 1;
      else sunkD += 1;
    }
    ships.push({
      campaignId: u.ship.id,
      alive,
      hull: alive ? Math.max(0.05, Math.min(1, u.hp / u.max)) : 0,
      crew: alive ? Math.max(0.05, Math.min(u.ship.crew, u.crew)) : 0,
      supply: Math.max(0.1, u.ship.supply - 0.22),
      kills: u.kills,
    });
  }
  const damage: BattleOutcome['damage'] = {};
  if (shoreD) damage.battery = Math.max(0, 1 - shoreD.hp / shoreD.start);
  return {
    outcome: { winner: attackerWon ? 'attacker' : 'defender', ships, razed: [], damage },
    sunk: { attacker: sunkA, defender: sunkD },
    strength: { attacker: [startA, livingHp(A)], defender: [startD, livingHp(D)] },
    rounds,
  };
}

/** What the player is told before choosing to fight or auto-resolve: the two sides' worth, and the odds as a plain ratio. */
export function previewStrength(attacker: ShipUnit[], defender: ShipUnit[], region?: RegionState): { attacker: number; defender: number; ratio: number } {
  const a = attacker.reduce((s, u) => s + shipDef(u.kind).strength * u.hull, 0);
  const d = defender.reduce((s, u) => s + shipDef(u.kind).strength * u.hull, 0) + (region ? batteryStrength(region) : 0);
  return { attacker: a, defender: d, ratio: a / Math.max(1, d) };
}
