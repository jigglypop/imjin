import type { Battle } from './battle';
import { combatValue } from './competitive';
import type { Faction, MoraleState, Ship, ShipKind, Team } from './types';

/** Seconds between two looks at one crew. The fleet is spread over the steps, so the cost per step stays flat. */
export const MORALE_TICK = 0.5;
// A crew wavers below WAVER and steadies only above STEADY, so a ship near the line does not flicker between the two.
const WAVER = 0.5;
const STEADY = 0.62;
/** A crew runs below this; a flagship's, under its commander's eye, only below FLAG_ROUT. */
const ROUT = 0.24;
const FLAG_ROUT = 0.12;
/** Seconds a routing crew runs before anything can turn it, and a rallying one spends closing on its commander. */
const ROUT_HOLD = 8;
const REGROUP = 6;
/** Morale a routing crew needs to rally: with its commander close, under the drum, or alone after a quiet spell. */
const RALLY_LEADER = 0.34;
const RALLY_DRUM = 0.26;
const RALLY_ALONE = 0.42;
/** Seconds with no enemy within QUIET_RANGE before a routing crew can rally on its own. */
const QUIET = 20;
const QUIET_RANGE = 600;
/** A boarded crew this shaken gives the ship up. */
export const SURRENDER = 0.12;
/** What a crew's state leaves of its ship's weight in the battle's balance: a running ship hardly counts. */
export const NERVE_WEIGHT: Record<MoraleState, number> = { steady: 1, wavering: 0.8, rallying: 0.6, routing: 0.25 };

// What wears a crew down. Losses are per share of the full crew or hull lost; the rest are per second.
const LOSS_CREW = 0.9;
const LOSS_HULL = 0.6;
const FIRE_DRAIN = 0.03;
const AGROUND_DRAIN = 0.01;
/** Bad odds: friends against foes, by fighting value, within ODDS_RANGE. */
const ODDS_RANGE = 450;
const ODDS_LOW = 0.35;
const ODDS_DRAIN = 0.025;
const ODDS_HIGH = 0.65;
const ODDS_GAIN = 0.006;
/** Friends running nearby, each, and at most. */
const RUNNING_NEAR = 0.0015;
const RUNNING_MAX = 0.006;
/** Foes on three sides within this range: the crane closing around a ship. */
const RING_RANGE = 350;
const RING_DRAIN = 0.02;
/** A friend sunk, taken or run aground this close, and how hard it hits, more for a large hull. */
const NEAR_LOSS = 300;
const NEAR_LOSS_SHOCK = 0.045;
/** The squadron's leader lost, and the navy's admiral. Ships without a leader keep losing heart until another takes over. */
const LEADER_SHOCK = 0.25;
const ADMIRAL_SHOCK = 0.18;
const LEADERLESS = 0.003;
/** Seconds before the next captain takes over a squadron that lost its leader. */
const SUCCESSION = 30;
// What restores it.
const AURA = 420;
const AURA_GAIN = 0.012;
const CALM_AFTER = 8;
const CALM_GAIN = 0.012;
/** Taking a ship lifts the crews that took it and their friends close by. */
const PRIZE_LIFT = 0.12;
const VICTORY_LIFT = 0.025;
/** The drum: a squadron leader beats it to steady and rally the ships within DRUM_RANGE. */
export const DRUM_TIME = 25;
export const DRUM_COOLDOWN = 90;
export const DRUM_RANGE = 700;
const DRUM_GAIN = 0.03;
/** Seconds between the computer's looks at whether a squadron needs its drum, and the share of shaken ships that calls for it. */
const DRUM_CHECK = 2;
const DRUM_CALL = 0.25;
/** Keeping formation steadies a crew: losses bite less and it recovers a little. */
const COHESION_DRAIN = 0.85;
const COHESION_GAIN = 0.004;

type Memo = { crew: number; hull: number; since: number; quiet: number };

const dist2 = (a: Ship, b: Ship) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/**
 * Morale under the battle depth rules. Every crew has a nerve between 0 and 1. Losses, fire, raking, friends sinking
 * nearby, the loss of its commander and bad odds wear it down; its commander's presence, the drum, good odds, a quiet
 * spell and experience restore it. Below one line a crew wavers: it loads and aims worse and the computer's ships
 * hold back. Below another it routs: it stops fighting and runs for its own side or the nearest shore, until its
 * commander, the drum or a quiet spell rallies it. A fleet most of whose ships are running has lost the field.
 */
export class Morale {
  private readonly memo = new Map<number, Memo>();
  /** Squadron id to when its drum stops, and when it may beat again. */
  readonly drums = new Map<number, { until: number; ready: number }>();
  /** Squadron id to when the next captain takes over from a lost leader. */
  private readonly succession = new Map<number, number>();
  /** The admiral of each navy: the leader of its first squadron, when that ship is a flagship. */
  private admirals: Partial<Record<Faction, number>> | null = null;
  private drumCheck = 0;
  /** Fighting value of each kind of ship, looked up once: the looks ask for it hundreds of times a step in a big battle. */
  private readonly kinds = new Map<ShipKind, number>();
  /** Each side's broken verdict and when it was reached, so a battle asking every step does not count its fleet every step. */
  private readonly verdicts: Record<Team, { at: number; broken: boolean }> = { joseon: { at: -1, broken: false }, japan: { at: -1, broken: false } };

  constructor(private readonly b: Battle) {}

  /** Squadrons whose lost leader is due get the next captain; the computer's leaders beat the drum when they must. */
  step() {
    for (const [id, at] of this.succession) {
      if (this.b.time < at) continue;
      this.succession.delete(id);
      this.appoint(id);
    }
    if (this.b.time >= this.drumCheck) {
      this.drumCheck = this.b.time + DRUM_CHECK;
      this.callDrums();
    }
  }

  /** A computer-led squadron with a quarter of its ships wavering, running or regrouping beats its drum. */
  private callDrums() {
    const b = this.b;
    for (const sq of b.squadrons) {
      const leader = b.get(sq.leaderId);
      if (!b.isActive(leader) || !b.isAi(leader) || leader.moraleState === 'routing' || b.isRetreating(sq.team) || this.drumWait(sq.id) > 0) continue;
      let shaken = 0;
      let all = 0;
      for (const id of sq.shipIds) {
        const o = b.get(id);
        if (!b.isActive(o)) continue;
        all += 1;
        if (o.moraleState !== 'steady') shaken += 1;
      }
      if (all >= 2 && shaken >= all * DRUM_CALL) this.drum(sq.id);
    }
  }

  private findAdmirals() {
    const out: Partial<Record<Faction, number>> = {};
    for (const sq of this.b.squadrons) {
      if (out[sq.faction] !== undefined) continue;
      const leader = this.b.get(sq.leaderId);
      out[sq.faction] = leader?.flagship ? leader.id : 0;
    }
    return out;
  }

  private memoOf(s: Ship) {
    let m = this.memo.get(s.id);
    if (!m) {
      m = { crew: s.crew / s.spec.crew, hull: s.hull / s.spec.hull, since: this.b.time, quiet: 0 };
      this.memo.set(s.id, m);
    }
    return m;
  }

  /** How well a crew bears what wears it down and answers what steadies it. */
  resolve(s: Ship) {
    const trait = s.spec.kind === 'geobukseon' ? 1.3 : 1;
    return s.mods.morale * trait * (s.flagship ? 1.25 : 1) * (1 + 0.04 * Math.min(5, s.kills));
  }

  /** A ship's fighting value as it stands. */
  private value(o: Ship) {
    let base = this.kinds.get(o.spec.kind);
    if (base === undefined) {
      base = combatValue(o.spec.kind, this.b.profile);
      this.kinds.set(o.spec.kind, base);
    }
    return base * ((o.hull / o.spec.hull) * 0.6 + (o.crew / o.spec.crew) * 0.4);
  }

  /** What a ship weighs in the odds around it: little while it runs. */
  private worth(o: Ship) {
    return o.moraleState === 'routing' ? this.value(o) * 0.25 : this.value(o);
  }

  /** One look at a fighting crew, `dt` seconds after the last. The battle spreads these over its steps (MORALE_TICK). */
  look(s: Ship, dt: number) {
    const b = this.b;
    this.admirals ??= this.findAdmirals();
    const m = this.memoOf(s);
    const crew = s.crew / s.spec.crew;
    const hull = s.hull / s.spec.hull;
    let drain = Math.max(0, m.crew - crew) * LOSS_CREW + Math.max(0, m.hull - hull) * LOSS_HULL + s.fire * FIRE_DRAIN * dt;
    let gain = 0;
    m.crew = crew;
    m.hull = hull;
    if (s.aground > 0) drain += AGROUND_DRAIN * dt;
    let friends = 0;
    let foes = 0;
    let running = 0;
    let near = false;
    let sides = 0;
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    b.near(s.x, s.z, ODDS_RANGE, (o) => {
      if (!b.isActive(o)) return;
      const w = this.worth(o);
      if (o.team === s.team) {
        friends += w;
        if (o.moraleState === 'routing' && o !== s) running += 1;
        return;
      }
      foes += w;
      const dx = o.x - s.x;
      const dz = o.z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < QUIET_RANGE * QUIET_RANGE) near = true;
      if (d2 < RING_RANGE * RING_RANGE && o.moraleState !== 'routing') {
        // Which quarter of the ship the foe lies on: ahead, to port, astern or to starboard.
        const along = dx * c + dz * n;
        const across = dz * c - dx * n;
        sides |= Math.abs(along) > Math.abs(across) ? (along > 0 ? 1 : 4) : across > 0 ? 2 : 8;
      }
    });
    // Foes within 450 m count toward the odds, those within 600 m keep a running crew from settling.
    if (!near && foes === 0) b.near(s.x, s.z, QUIET_RANGE, (o) => {
      if (o.team !== s.team && b.isActive(o)) near = true;
    });
    // Panic spreads: friends running past a crew wear it down.
    if (running) drain += Math.min(RUNNING_MAX, RUNNING_NEAR * running) * dt;
    const odds = friends / Math.max(1e-6, friends + foes);
    if (foes > 0 && odds < ODDS_LOW) drain += (ODDS_DRAIN * dt * (ODDS_LOW - odds)) / ODDS_LOW;
    else if (odds > ODDS_HIGH && foes > 0) gain += ODDS_GAIN * dt;
    if (b.depth?.gunnery && (sides & 1) + ((sides >> 1) & 1) + ((sides >> 2) & 1) + ((sides >> 3) & 1) >= 3) drain += RING_DRAIN * dt;
    const sq = b.squadron(s.squadronId);
    const leader = sq ? b.get(sq.leaderId) : undefined;
    const present = !!leader && leader !== s && b.isActive(leader) && leader.moraleState !== 'routing';
    const led = present && dist2(leader, s) < AURA * AURA;
    if (led) gain += AURA_GAIN * dt * leader.mods.morale;
    else if (leader && leader !== s && !b.isActive(leader)) drain += LEADERLESS * dt;
    if (b.time - s.lastHit > CALM_AFTER) gain += CALM_GAIN * dt;
    const drum = sq ? this.drums.get(sq.id) : undefined;
    const drummed = !!drum && b.time < drum.until && !!leader && b.isActive(leader) && dist2(leader, s) < DRUM_RANGE * DRUM_RANGE;
    if (drummed) gain += DRUM_GAIN * dt;
    if (b.tactics?.cohesive.has(s.id)) {
      drain *= COHESION_DRAIN;
      gain += COHESION_GAIN * dt;
    }
    const resolve = this.resolve(s);
    const next = s.morale - drain / resolve + gain * resolve;
    // A crew cut down to a handful cannot be as steady as a full one, however quiet it gets.
    const cap = 0.55 + 0.45 * crew;
    s.morale = Math.max(0, Math.min(1, next > s.morale ? Math.min(next, Math.max(s.morale, cap)) : next));
    m.quiet = near ? 0 : m.quiet + dt;
    this.settle(s, m, led, drummed);
  }

  /** Moves a crew between the states its nerve now puts it in. */
  private settle(s: Ship, m: Memo, led: boolean, drummed: boolean) {
    const b = this.b;
    const state = s.moraleState;
    const held = b.time - m.since;
    if (state === 'routing') {
      if (held < ROUT_HOLD || b.isRetreating(s.team)) return;
      const rally = (led && s.morale >= RALLY_LEADER) || (drummed && s.morale >= RALLY_DRUM) || (m.quiet >= QUIET && s.morale >= RALLY_ALONE);
      if (rally) this.set(s, 'rallying');
      return;
    }
    if (s.morale < (s.flagship ? FLAG_ROUT : ROUT)) {
      this.set(s, 'routing');
      return;
    }
    if (state === 'rallying') {
      if (held >= REGROUP) this.set(s, s.morale >= STEADY ? 'steady' : 'wavering');
    } else if (state === 'steady' && s.morale < WAVER) this.set(s, 'wavering');
    else if (state === 'wavering' && s.morale >= STEADY) this.set(s, 'steady');
  }

  private set(s: Ship, state: MoraleState, quiet = false) {
    if (s.moraleState === state) return;
    s.moraleState = state;
    this.memoOf(s).since = this.b.time;
    if (state === 'routing') {
      this.memoOf(s).quiet = 0;
      this.b.routed(s);
    }
    if (!quiet) this.b.events.push({ type: 'morale', ship: s.id, state });
  }

  /** A blow to one crew's nerve, such as a raking shot. It may break the crew at once. */
  shock(s: Ship, amount: number) {
    if (!this.b.isActive(s)) return;
    s.morale = Math.max(0, s.morale - amount / this.resolve(s));
    if (s.moraleState !== 'routing' && s.morale < (s.flagship ? FLAG_ROUT : ROUT)) this.set(s, 'routing');
  }

  private lift(s: Ship, amount: number) {
    s.morale = Math.min(1, s.morale + amount * this.resolve(s));
  }

  /**
   * A ship left the fight: sunk, taken, abandoned or fled. Its friends nearby lose heart and its foes take some; a
   * leader's squadron and an admiral's navy take a heavier blow, and the squadron later passes to the next captain.
   */
  lost(s: Ship) {
    const b = this.b;
    this.admirals ??= this.findAdmirals();
    const big = s.spec.length > 25 ? 1.5 : 1;
    b.near(s.x, s.z, NEAR_LOSS, (o) => {
      if (o === s || !b.isActive(o)) return;
      if (o.team === s.team) this.shock(o, NEAR_LOSS_SHOCK * big);
      else this.lift(o, VICTORY_LIFT);
    });
    const sq = b.squadron(s.squadronId);
    const admiral = this.admirals[s.spec.faction] === s.id;
    if (sq && sq.leaderId === s.id && sq.team === s.team) {
      b.events.push({ type: 'leader', ship: s.id, flagship: admiral });
      for (const id of sq.shipIds) {
        const o = b.get(id);
        if (o && o !== s) this.shock(o, LEADER_SHOCK);
      }
      if (!this.succession.has(sq.id)) this.succession.set(sq.id, b.time + SUCCESSION);
    }
    if (admiral) {
      for (const o of b.ships) if (o !== s && o.spec.faction === s.spec.faction && o.team === s.team) this.shock(o, ADMIRAL_SHOCK);
    }
    this.memo.delete(s.id);
  }

  /** The next captain of a squadron that lost its leader: the strongest crew still fighting in it. */
  private appoint(id: number) {
    const b = this.b;
    const sq = b.squadron(id);
    if (!sq || b.isActive(b.get(sq.leaderId))) return;
    let best: Ship | undefined;
    let bestValue = -1;
    for (const sid of sq.shipIds) {
      const o = b.get(sid);
      if (!b.isActive(o) || o.moraleState === 'routing') continue;
      const v = this.worth(o);
      if (v > bestValue) {
        bestValue = v;
        best = o;
      }
    }
    if (best) sq.leaderId = best.id;
    else this.succession.set(id, b.time + SUCCESSION);
  }

  /** A crew took a ship by boarding: it and the friends around it are heartened. */
  prize(victor: Ship) {
    this.lift(victor, PRIZE_LIFT);
    this.b.near(victor.x, victor.z, NEAR_LOSS, (o) => {
      if (o !== victor && o.team === victor.team && this.b.isActive(o)) this.lift(o, VICTORY_LIFT);
    });
  }

  /** Every crew of a fleet that broke turns to run, without a word for each ship. */
  breakFleet(team: Team) {
    for (const s of this.b.activeOf(team)) this.set(s, 'routing', true);
  }

  /** Beats a squadron's drum, if its leader is fighting and the drum is ready. Returns whether it did. */
  drum(squadronId: number) {
    const b = this.b;
    const sq = b.squadron(squadronId);
    const leader = sq ? b.get(sq.leaderId) : undefined;
    if (!sq || !b.isActive(leader) || leader.moraleState === 'routing') return false;
    const d = this.drums.get(sq.id);
    if (d && b.time < d.ready) return false;
    this.heard(leader.id);
    b.events.push({ type: 'drum', ship: leader.id });
    return true;
  }

  /** A drum beaten aboard this leader is running and then cooling down. An online client learns of it from the event. */
  heard(leaderId: number) {
    const s = this.b.get(leaderId);
    if (s) this.drums.set(s.squadronId, { until: this.b.time + DRUM_TIME, ready: this.b.time + DRUM_COOLDOWN });
  }

  /** Seconds until a squadron's drum can beat again; 0 when ready. */
  drumWait(squadronId: number) {
    const d = this.drums.get(squadronId);
    return d ? Math.max(0, d.ready - this.b.time) : 0;
  }

  /** How much a crew's loading and aim suffer from its nerve: 1 when steady, nothing at all while it runs. */
  steadiness(s: Ship) {
    if (s.moraleState === 'routing') return 0;
    if (s.moraleState === 'rallying') return 0.6;
    return s.morale < WAVER ? 0.55 + 0.9 * s.morale : 1;
  }

  /** Whether a fleet has broken: most of what it still has afloat, by fighting value, is running. Counted every MORALE_TICK. */
  broken(team: Team) {
    const b = this.b;
    const verdict = this.verdicts[team];
    if (verdict.at >= 0 && b.time - verdict.at < MORALE_TICK) return verdict.broken;
    let running = 0;
    let all = 0;
    for (const s of b.activeOf(team)) {
      const w = this.value(s);
      all += w;
      if (s.moraleState === 'routing') running += w;
    }
    verdict.at = b.time;
    verdict.broken = all > 0 && running / all >= 0.6;
    return verdict.broken;
  }
}
