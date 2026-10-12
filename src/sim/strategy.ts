import type { Battle } from './battle';
import { combatValue } from './competitive';
import { isUnarmed } from './catalog';
import { BUILDINGS, rosterOf, upgradeCost, type BuildingKind, type CapturePoint, type Conquest } from './conquest';
import { otherTeam, type Faction, type Ship, type ShipKind } from './types';
import { isShipVisible, pointVisible } from './visibility';

/** The shares of each navy's fleet value the computer aims for in a ranked match. */
const RANKED_DOCTRINE: Record<Faction, Partial<Record<ShipKind, number>>> = {
  joseon: { panokseon: 0.6, geobukseon: 0.22, hyeopseon: 0.18 },
  japan: { atakebune: 0.42, sekibune: 0.44, kobaya: 0.14 },
  ming: { mingship: 0.6, mingsmall: 0.4 },
};
/**
 * The same under the expanded rules, where the size tiers and support craft are on offer too. They take small shares,
 * so the fleets keep the character the balance was tuned on; the transport is never bought for a fight, only the lookout.
 */
const DOCTRINE: Record<Faction, Partial<Record<ShipKind, number>>> = {
  joseon: { panokseon: 0.56, geobukseon: 0.2, hyeopseon: 0.14, pojakseon: 0.06, sahuseon: 0.04 },
  japan: { daeantaek: 0.08, atakebune: 0.3, sogantaek: 0.08, daegwanseon: 0.08, sekibune: 0.34, kobaya: 0.12 },
  ming: { gwangseon: 0.08, mingship: 0.48, haechangseon: 0.1, mingsmall: 0.28, hoseon: 0.06 },
};
const doctrineOf = (c: Conquest, faction: Faction) => (c.options.expanded ? DOCTRINE : RANKED_DOCTRINE)[faction];

/** Unarmed craft keep this far from the nearest enemy and run from one that comes closer. */
const UNARMED_CLEAR = 400;
/** A lookout holds station this far ahead of the main body, toward the enemy. */
const LOOKOUT_AHEAD = 450;

const THINK = 2;
const CLUSTER = 520;

type Cluster = { x: number; z: number; power: number; ships: Ship[] };

// Price controls construction; the combat appraisal controls whether a fleet can win a fight.

/**
 * How the navies pick their fights. The Japanese close and board, so the fleet takes on groups it cannot out-gun at
 * range, goes after prey from further off and falls back only from a far stronger enemy. The Joseon and Ming fleets
 * fight at a distance and choose their odds.
 */
const DOCTRINE_OF_FIGHT: Record<Faction, { engage: number; prey: number; reach: number; retreat: number }> = {
  joseon: { engage: 650, prey: 0.9, reach: 1800, retreat: 2.2 },
  ming: { engage: 650, prey: 0.9, reach: 1800, retreat: 2.2 },
  japan: { engage: 900, prey: 1.25, reach: 2600, retreat: 3.2 },
};
const power = (list: Ship[]) => list.reduce((a, s) => a + combatValue(s.spec.kind) * (0.35 + 0.65 * (s.hull / s.spec.hull)) * (0.4 + 0.6 * (s.crew / s.spec.crew)), 0);

function centroid(list: Ship[]) {
  let x = 0;
  let z = 0;
  for (const s of list) {
    x += s.x;
    z += s.z;
  }
  return { x: x / list.length, z: z / list.length };
}

/** Greedy grouping of ships that lie within CLUSTER of each other. */
function clusters(ships: readonly Ship[]): Cluster[] {
  const out: Cluster[] = [];
  for (const s of ships) {
    let home: Cluster | undefined;
    for (const c of out) if ((c.x - s.x) ** 2 + (c.z - s.z) ** 2 < CLUSTER * CLUSTER) home = c;
    if (!home) {
      home = { x: s.x, z: s.z, power: 0, ships: [] };
      out.push(home);
    }
    home.ships.push(s);
    const c = centroid(home.ships);
    home.x = c.x;
    home.z = c.z;
  }
  for (const c of out) c.power = power(c.ships);
  return out;
}

/** A shore-work order for the seat's own points, in the shape of the matching Command. */
export type WorkOrder = { type: 'build'; point: number; building: BuildingKind } | { type: 'upgrade'; point: number; slot: number };

/**
 * How the works planner is asked. `keep` is silver that must remain after the order, so a ship order is never starved;
 * `eager` plans camps without waiting for the shipyards to back up. The computer plans with neither.
 */
export type WorkOptions = { keep?: number; eager?: boolean };

const ownedBy = (c: Conquest, slot: number) => c.points.filter((p) => p.owner === slot);
const homeOrFirst = (c: Conquest, slot: number, owned: CapturePoint[]) => c.homeOf(slot) ?? owned[0]!;

/** The price of the navy's main ship, the one the computer buys most of: what a human's auto-build leaves in the treasury. */
export function worksReserve(c: Conquest, slot: number) {
  const want = doctrineOf(c, c.player(slot)!.faction);
  const main = (Object.keys(want) as ShipKind[]).reduce((best, k) => (want[k]! > want[best]! ? k : best));
  return c.shipSpec(main).cost;
}

/** The fleet already holds as much as the cap leaves room for, so the treasury goes to works instead of ships. */
function isFull(c: Conquest, slot: number, fleetValue: number) {
  const me = c.player(slot)!;
  return fleetValue > me.cap - Math.min(...rosterOf(me.faction, c.options.expanded).map((k) => c.shipSpec(k).cost));
}

/** Points nearest the enemy home first. */
function frontOf(c: Conquest, slot: number, points: CapturePoint[]) {
  const team = c.player(slot)!.team;
  const foe = c.points.find((p) => p.home >= 0 && c.player(p.home)?.team !== team);
  if (!foe) return points;
  return [...points].sort((a, b) => Math.hypot(a.x - foe.x, a.z - foe.z) - Math.hypot(b.x - foe.x, b.z - foe.z));
}

function pickBuild(c: Conquest, slot: number, kind: BuildingKind, at: CapturePoint[], reserve: number, keep: number): WorkOrder | null {
  const funds = c.player(slot)!.funds;
  for (const p of at) {
    if (funds - reserve - keep < BUILDINGS[kind].cost) return null;
    if (c.canBuild(slot, p.id, kind)) return { type: 'build', point: p.id, building: kind };
  }
  return null;
}

function pickUpgrade(c: Conquest, slot: number, kind: BuildingKind, at: CapturePoint[], keep: number): WorkOrder | null {
  const funds = c.player(slot)!.funds;
  for (const p of at) {
    const i = p.buildings.findIndex((bd) => bd?.kind === kind && bd.progress >= 1 && bd.level < 3 && bd.upgradeLeft <= 0);
    if (i >= 0 && c.canUpgrade(slot, p.id, i) && funds - keep >= upgradeCost(kind, p.buildings[i]!.level)) return { type: 'upgrade', point: p.id, slot: i };
  }
  return null;
}

/**
 * The first half of the works plan, before ships are recruited: a first shipyard, then in casual battles the camps and
 * shipyard levels that a backed-up slipway calls for. `end` is set when there is no shipyard yet, so nothing after it applies.
 * Pure: it reads the state and names the order, it changes nothing.
 */
export function planFoundation(b: Battle, c: Conquest, slot: number, opts: WorkOptions = {}): { order: WorkOrder | null; end: boolean } {
  const me = c.player(slot)!;
  const owned = ownedBy(c, slot);
  const keep = opts.keep ?? 0;
  const yards = owned.filter((p) => p.buildings.some((bd) => bd?.kind === 'shipyard'));
  if (!yards.length) return { order: pickBuild(c, slot, 'shipyard', [homeOrFirst(c, slot, owned), ...owned], 0, keep), end: true };
  if (c.options.expanded) {
    // Camps support an uncapped fleet's crews and slipways; they never gate ordinary recruitment.
    const campLevels = owned.reduce((n, p) => n + c.levels(p, 'camp'), 0);
    const jobs = yards.reduce((n, p) => n + p.queue.length, 0);
    const wornCrew = b.ships.some((s) => s.owner === slot && b.isActive(s) && s.crew < s.spec.crew * 0.75);
    if (campLevels < 6 && (opts.eager || (me.funds > 1200 && (jobs >= 2 || wornCrew || c.fleet(b, slot).count >= 40)))) {
      const order = pickUpgrade(c, slot, 'camp', owned, keep) ?? pickBuild(c, slot, 'camp', [homeOrFirst(c, slot, owned), ...owned], 700, keep);
      if (order) return { order, end: false };
    }
    if (me.funds > 2000 && yards.some((p) => p.queue.length >= c.yardSlots(p))) {
      const order = pickUpgrade(c, slot, 'shipyard', yards, keep);
      if (order) return { order, end: false };
    }
  }
  return { order: null, end: false };
}

/**
 * The second half, after recruitment: batteries on the exposed front, a dock, a magazine, a second shipyard, a beacon.
 * `full` is read before recruiting, as the queue it adds would otherwise count against the cap.
 */
export function planDefence(b: Battle, c: Conquest, slot: number, full: boolean, opts: WorkOptions = {}): WorkOrder | null {
  const me = c.player(slot)!;
  const owned = ownedBy(c, slot);
  const keep = opts.keep ?? 0;
  const yards = owned.filter((p) => p.buildings.some((bd) => bd?.kind === 'shipyard'));
  if (!yards.length || !(me.funds > 900 || full)) return null;
  const front = frontOf(c, slot, owned);
  const exposed = front.filter((p) => p.home < 0 && !p.buildings.some((bd) => bd?.kind === 'battery'));
  const damaged = b.ships.some((s) => s.owner === slot && b.isActive(s) && s.hull < s.spec.hull * 0.6);
  return pickBuild(c, slot, 'battery', exposed.slice(0, 2), full ? 0 : 250, keep)
    ?? (damaged && !owned.some((p) => c.count(p, 'dock')) ? pickBuild(c, slot, 'dock', [c.homeOf(slot) ?? front[front.length - 1]!, ...front.slice().reverse()], 200, keep) : null)
    ?? (!owned.some((p) => c.count(p, 'magazine')) ? pickBuild(c, slot, 'magazine', [...front].reverse(), 300, keep) : null)
    ?? (me.funds > 1500 && yards.length < 2 ? pickBuild(c, slot, 'shipyard', front.filter((p) => p.home < 0), 400, keep) : null)
    ?? (me.funds > 1300 || full ? pickBuild(c, slot, 'beacon', front, full ? 0 : 500, keep) : null);
}

/** The next work a human's auto-build should order, or null: foundation first, then defence. */
export function planWorks(b: Battle, c: Conquest, slot: number, opts: WorkOptions = {}): WorkOrder | null {
  if (!c.player(slot) || !ownedBy(c, slot).length) return null;
  const first = planFoundation(b, c, slot, opts);
  if (first.order || first.end) return first.order;
  return planDefence(b, c, slot, isFull(c, slot, c.fleet(b, slot).value), opts);
}

/** Carry an order out on the conquest directly, as the computer commander does; a human's order goes through a Command. */
function executeWork(b: Battle, c: Conquest, slot: number, order: WorkOrder) {
  if (order.type === 'build') c.build(b, slot, order.point, order.building);
  else c.upgrade(b, slot, order.point, order.slot);
}

/**
 * The computer commander of one seat in a conquest battle. It spends the treasury on ships and shore works, keeps
 * its fleet together as a main body that hunts weaker enemy groups, defends threatened points and otherwise takes
 * the best point it can reach, while the small fast boats raid lightly held points.
 */
export class Strategist {
  private timer: number;
  private goal = -1;
  private axis = 0;
  private observes: (x: number, z: number) => boolean = () => true;
  private waterGoal: (x: number, z: number) => boolean = () => true;
  private spreadHulls = false;

  constructor(readonly slot: number) {
    this.timer = 0.5 + Math.floor(slot / 2) * 0.37;
  }

  step(b: Battle, c: Conquest, dt: number, slot: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = THINK;
    if (!c.player(slot)) return;
    const home = c.homeOf(slot), foe = this.enemyHome(c);
    if (home && foe) this.axis = Math.atan2(foe.z - home.z, foe.x - home.x);
    this.economy(b, c);
    this.military(b, c);
  }

  private mine(c: Conquest) {
    return ownedBy(c, this.slot);
  }

  private enemyHome(c: Conquest) {
    const team = c.player(this.slot)!.team;
    return c.points.find((p) => p.home >= 0 && c.player(p.home)?.team !== team);
  }

  /** Points nearest the enemy first. */
  private frontline(c: Conquest, points: CapturePoint[]) {
    return frontOf(c, this.slot, points);
  }

  private economy(b: Battle, c: Conquest) {
    const owned = this.mine(c);
    if (!owned.length) return;
    const yards = owned.filter((p) => p.buildings.some((bd) => bd?.kind === 'shipyard'));
    const full = isFull(c, this.slot, c.fleet(b, this.slot).value);
    const foundation = planFoundation(b, c, this.slot);
    if (foundation.order) executeWork(b, c, this.slot, foundation.order);
    if (foundation.order || foundation.end) return;
    if (!full) this.recruit(b, c, yards);
    const order = planDefence(b, c, this.slot, full);
    if (order) executeWork(b, c, this.slot, order);
  }

  private recruit(b: Battle, c: Conquest, yards: CapturePoint[]) {
    const me = c.player(this.slot)!;
    const want = doctrineOf(c, me.faction);
    const have = new Map<ShipKind, number>();
    let total = 0;
    const add = (k: ShipKind) => {
      have.set(k, (have.get(k) ?? 0) + c.shipSpec(k).cost);
      total += c.shipSpec(k).cost;
    };
    for (const s of b.ships) if (s.owner === this.slot && b.isActive(s)) add(s.spec.kind);
    for (const p of yards) for (const q of p.queue) add(q.kind);
    const gap = (k: ShipKind) => want[k]! - (have.get(k) ?? 0) / Math.max(1, total);
    const kinds = (Object.keys(want) as ShipKind[]).sort((a, z) => gap(z) - gap(a));
    const front = this.frontline(c, yards);
    for (const kind of kinds) {
      if (gap(kind) <= 0) continue;
      if (me.funds < c.shipSpec(kind).cost) {
        // Every positive deficit needs savings. A small deficit must not buy an already overrepresented scout
        // every two seconds and leave its main ship unaffordable forever.
        if (kind === kinds[0]) return;
        continue;
      }
      const yard = front.find((p) => p.queue.length < 2 && c.canRecruit(b, this.slot, p.id, kind)) ?? front.find((p) => c.canRecruit(b, this.slot, p.id, kind));
      if (yard && c.recruitIn(b, this.slot, yard.id, kind)) return;
      // If the preferred hull cannot fit a ranked fleet's remaining capacity, another deficient kind may fit.
    }
  }

  private military(b: Battle, c: Conquest) {
    const me = c.player(this.slot)!;
    const team = me.team;
    this.observes = (x, z) => pointVisible(b, team, x, z);
    this.waterGoal = (x, z) => b.land(x, z) < -2.4;
    this.spreadHulls = b.profile !== 'historical';
    const ships = b.ships.filter((s) => s.owner === this.slot && b.isActive(s));
    if (!ships.length) return;
    const foes = clusters(b.activeOf(otherTeam(team)).filter((s) => isShipVisible(b, team, s.id)));
    const docks = c.points.filter((p) => c.teamOfPoint(p) === team && c.count(p, 'dock'));
    const fit: Ship[] = [];
    const unarmed: Ship[] = [];
    for (const s of ships) {
      // A regrouping speed limit lasts only until the next decision; a boarding rush uses the ship's full speed.
      s.speedCap = 1;
      if (docks.length && s.hull < s.spec.hull * 0.3 && !s.grappledWith && !this.engaged(s, foes, 260)) {
        const dock = docks.reduce((a, p) => (Math.hypot(p.x - s.x, p.z - s.z) < Math.hypot(a.x - s.x, a.z - s.z) ? p : a));
        if (Math.hypot(dock.x - s.x, dock.z - s.z) > dock.r * 0.6) this.go(s, dock.x, dock.z);
        else if (s.order.type !== 'hold') s.order = { type: 'hold' };
        continue;
      }
      // Unarmed craft never join the fighting body or a raid: they keep with the fleet out of the enemy's reach.
      (isUnarmed(s.spec) ? unarmed : fit).push(s);
    }
    if (!fit.length) {
      this.shelter(c, unarmed, foes);
      return;
    }
    let raiderCost = 0;
    const raiderBudget = fit.reduce((sum, s) => sum + s.spec.cost, 0) * 0.15;
    const raiders = fit.filter((s) => {
      // Raiders are the armed small boats (fit holds only armed ships).
      if (!(s.spec.length < 16 || (b.profile !== 'historical' && s.spec.kind === 'mingsmall')) || raiderCost + s.spec.cost > raiderBudget) return false;
      raiderCost += s.spec.cost;
      return true;
    });
    const main = fit.filter((s) => !raiders.includes(s));
    const pool = main.length ? main : raiders;
    // The strongest knot of warships is the body. Stragglers and ships fresh off the slipway join it rather than
    // sailing into the enemy one at a time, unless the enemy is already on them.
    const groups = clusters(pool).sort((p, q) => q.power - p.power);
    const body = groups[0]!.ships;
    for (const g of groups.slice(1)) {
      for (const s of g.ships) {
        if (this.engaged(s, foes, 320) || (b.profile !== 'historical' && this.inGunRange(b, s, foes))) {
          if (s.order.type !== 'auto' && s.order.type !== 'attack') s.order = { type: 'auto' };
        } else this.go(s, groups[0]!.x, groups[0]!.z);
      }
    }
    this.lead(c, body, foes);
    if (main.length) this.raid(b, c, raiders, foes);
    this.escort(b, unarmed, body, foes);
  }

  /** The enemy ship nearest to a point, among those observed, with its distance. */
  private nearestFoe(foes: Cluster[], x: number, z: number) {
    let best: Ship | undefined, distance = Infinity;
    for (const f of foes) for (const e of f.ships) {
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < distance) { best = e; distance = d; }
    }
    return { foe: best, distance };
  }

  /** Runs from an enemy closer than UNARMED_CLEAR. Returns whether it had to. */
  private evade(s: Ship, foes: Cluster[]) {
    const { foe, distance } = this.nearestFoe(foes, s.x, s.z);
    if (!foe || distance >= UNARMED_CLEAR) return false;
    const away = Math.atan2(s.z - foe.z, s.x - foe.x);
    this.go(s, s.x + Math.cos(away) * 300, s.z + Math.sin(away) * 300);
    return true;
  }

  /**
   * Unarmed craft keep with the main body: a lookout (no tender trait) holds station ahead of it toward the enemy, a
   * transport keeps behind it and tends the ships that need it. Neither comes within UNARMED_CLEAR of an enemy.
   */
  private escort(b: Battle, unarmed: Ship[], body: Ship[], foes: Cluster[]) {
    if (!unarmed.length) return;
    const at = centroid(body);
    const front = foes.length ? foes.reduce((p, q) => (Math.hypot(q.x - at.x, q.z - at.z) < Math.hypot(p.x - at.x, p.z - at.z) ? q : p)) : null;
    const toward = front ? Math.atan2(front.z - at.z, front.x - at.x) : this.axis;
    const ahead = { x: at.x + Math.cos(toward) * LOOKOUT_AHEAD, z: at.z + Math.sin(toward) * LOOKOUT_AHEAD };
    const behind = { x: at.x - Math.cos(toward) * 150, z: at.z - Math.sin(toward) * 150 };
    // The station ahead is given up for the one behind the body when it would put the lookout in the enemy's reach.
    const lookout = this.nearestFoe(foes, ahead.x, ahead.z).distance < UNARMED_CLEAR + 100 ? behind : ahead;
    for (const s of unarmed) {
      s.speedCap = 1;
      if (this.evade(s, foes)) continue;
      if (s.spec.tender && body.some((o) => b.tenderNeed(o) > 0.15 && Math.hypot(o.x - s.x, o.z - s.z) < 500)) {
        // The battle's tender escort takes it beside the neediest friend; it still runs from a close enemy there.
        if (s.order.type !== 'auto') s.order = { type: 'auto' };
        continue;
      }
      const station = s.spec.tender ? behind : lookout;
      if (Math.hypot(station.x - s.x, station.z - s.z) < 60) {
        if (s.order.type !== 'hold') s.order = { type: 'hold' };
      } else this.go(s, station.x, station.z);
    }
  }

  /** Unarmed craft without a fleet to keep with fall back on a safe port, or stay clear of the enemy where they are. */
  private shelter(c: Conquest, unarmed: Ship[], foes: Cluster[]) {
    for (const s of unarmed) {
      s.speedCap = 1;
      if (this.evade(s, foes)) continue;
      if (!this.retreat(c, [s], s) && s.order.type !== 'hold') s.order = { type: 'hold' };
    }
  }

  private engaged(s: Ship, foes: Cluster[], r: number) {
    return foes.some((f) => f.ships.some((e) => (e.x - s.x) ** 2 + (e.z - s.z) ** 2 < r * r));
  }

  private inGunRange(b: Battle, s: Ship, foes: Cluster[]) {
    const rangeOf = (ship: Ship) => {
      let range = 0;
      for (const battery of ship.spec.batteries) range = Math.max(range, b.gunSpec(ship.spec.kind, battery.gun).range);
      return range;
    };
    const ownRange = rangeOf(s);
    // A reinforcement already inside an observed gun line must fight before obeying a distant regroup order.
    // In particular, the fixed 320m threshold used to expose it to several unopposed Ming volleys.
    return foes.some((f) => f.ships.some((e) => {
      const range = Math.max(ownRange, rangeOf(e));
      return (e.x - s.x) ** 2 + (e.z - s.z) ** 2 <= range * range;
    }));
  }

  /** The main body: fight what it can beat, defend what is threatened, else take a point. */
  private lead(c: Conquest, body: Ship[], foes: Cluster[]) {
    const me = c.player(this.slot)!;
    const team = me.team;
    const fight = DOCTRINE_OF_FIGHT[me.faction];
    const at = centroid(body);
    const strength = power(body);
    const near = foes.filter((f) => Math.hypot(f.x - at.x, f.z - at.z) < fight.engage + Math.sqrt(f.ships.length) * 40);
    const nearPower = near.reduce((a, f) => a + f.power, 0);
    if (near.length) {
      if (nearPower > strength * fight.retreat && this.retreat(c, body, at)) return;
      // Well ahead in the fight: the ships farthest from it peel off to take a point nobody guards.
      let fighting = body;
      if (strength > nearPower * 1.8 && body.length >= 6) {
        const goal = this.pickPoint(c, at.x, at.z, strength * 0.3, foes, true);
        if (goal) {
          const spread = near[0]!;
          const ranked = [...body].sort((p, q) => Math.hypot(q.x - spread.x, q.z - spread.z) - Math.hypot(p.x - spread.x, p.z - spread.z));
          const detach = ranked.slice(0, Math.floor(body.length * 0.3)).filter((s) => !this.engaged(s, foes, 300));
          if (detach.length) {
            this.sail(detach, goal.x, goal.z, goal.r * 0.4);
            fighting = body.filter((s) => !detach.includes(s));
          }
        }
      }
      for (const s of fighting) if (s.order.type !== 'auto' && s.order.type !== 'attack') s.order = { type: 'auto' };
      return;
    }
    // Hunt a weaker enemy group close by.
    const prey = foes.filter((f) => f.power < strength * fight.prey && Math.hypot(f.x - at.x, f.z - at.z) < fight.reach).sort((p, q) => Math.hypot(p.x - at.x, p.z - at.z) - Math.hypot(q.x - at.x, q.z - at.z))[0];
    if (prey) {
      this.sail(body, prey.x, prey.z, 60);
      return;
    }
    // Defend a held point an enemy group is closing on, if the body can match it.
    const threatened = c.points
      .filter((p) => c.teamOfPoint(p) === team)
      .map((p) => ({ p, f: foes.filter((f) => Math.hypot(f.x - p.x, f.z - p.z) < p.r + 700) }))
      .filter((t) => t.f.length && t.f.reduce((a, f) => a + f.power, 0) < strength * 1.4)
      .sort((u, v) => v.p.value - u.p.value || Math.hypot(u.p.x - at.x, u.p.z - at.z) - Math.hypot(v.p.x - at.x, v.p.z - at.z))[0];
    if (threatened) {
      this.sail(body, threatened.p.x, threatened.p.z, threatened.p.r * 0.5);
      return;
    }
    const goal = this.pickPoint(c, at.x, at.z, strength, foes, false);
    if (!goal) return;
    this.goal = goal.id;
    if (this.bombard(c, body, goal)) return;
    this.sail(body, goal.x, goal.z, goal.r * 0.45);
  }

  /** Small boats take separate lightly held points, instead of chasing a distant gun line. */
  private raid(_b: Battle, c: Conquest, raiders: Ship[], foes: Cluster[]) {
    if (!raiders.length) return;
    const remaining = new Set(raiders), claimed = new Set<number>();
    while (remaining.size) {
      const first = remaining.values().next().value!;
      // Small detachments can take several points at once. Light hulls still have capture's 0.35 weight;
      // six of them get a 1.44 rate multiplier, rather than the eighteen-hull maximum of three.
      const group = [...remaining].sort((a, b) => (a.x - first.x) ** 2 + (a.z - first.z) ** 2 - ((b.x - first.x) ** 2 + (b.z - first.z) ** 2) || a.id - b.id).slice(0, 6);
      for (const s of group) remaining.delete(s);
      const at = centroid(group), strength = power(group);
      const close = foes.flatMap((f) => f.ships).filter((e) => group.some((s) => (e.x - s.x) ** 2 + (e.z - s.z) ** 2 < 120 * 120));
      if (close.length && power(close) <= strength * 1.2) {
        for (const s of group) if (s.order.type !== 'auto') s.order = { type: 'auto' };
        continue;
      }
      const goal = this.pickPoint(c, at.x, at.z, strength, foes, true, claimed);
      if (goal) {
        claimed.add(goal.id);
        this.sail(group, goal.x, goal.z, goal.r * 0.4);
      } else if (!this.retreat(c, group, at)) {
        // No safe objective remains. In particular, gunless scouts must not pursue a ship 450m away
        // while armed scouts happen to stay inside a capture circle under the same 'auto' order.
        for (const s of group) if (s.order.type !== 'hold') s.order = { type: 'hold' };
      }
    }
  }

  private pickPoint(c: Conquest, x: number, z: number, strength: number, foes: Cluster[], avoid: boolean, claimed?: ReadonlySet<number>) {
    const team = c.player(this.slot)!.team;
    let best: CapturePoint | null = null;
    let bestScore = -Infinity;
    for (const p of c.points) {
      if (claimed?.has(p.id)) continue;
      const held = c.teamOfPoint(p) === team && Math.abs(p.hold) >= 0.999;
      if (held) continue;
      // Shore batteries guard a point as well as ships do.
      const guns = this.observes(p.x, p.z) && c.teamOfPoint(p) && c.teamOfPoint(p) !== team ? c.count(p, 'battery') * 900 : 0;
      const guard = foes.filter((f) => Math.hypot(f.x - p.x, f.z - p.z) < p.r + 600).reduce((a, f) => a + f.power, 0) + guns;
      if (avoid ? guard > 0 : guard > strength * 1.2) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      let score = p.value * 1.4 + (p.home >= 0 ? 0.8 : 0) - d / 1500 - guard / Math.max(1, strength);
      if (p.id === this.goal) score += 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  /** At an enemy-held point with no fleet to fight, the guns turn on its shore works. */
  private bombard(c: Conquest, body: Ship[], p: CapturePoint) {
    const team = c.player(this.slot)!.team;
    const owner = c.teamOfPoint(p);
    if (!owner || owner === team) return false;
    if (!this.observes(p.x, p.z)) return false;
    const at = centroid(body);
    if (Math.hypot(p.x - at.x, p.z - at.z) > p.r + 500) return false;
    const target = c.targetNear(team, p.x, p.z, p.r + 700);
    if (!target) return false;
    for (const s of body) {
      // Boarding craft cannot bombard a shore work. They take the water inside its capture circle instead.
      if (!s.spec.batteries.length) { this.go(s, p.x, p.z); continue; }
      const o = s.order;
      if (o.type === 'bombard' && o.x === target.x && o.z === target.z) continue;
      s.order = { type: 'bombard', x: target.x, y: target.y, z: target.z };
    }
    return true;
  }

  /** Falls back on the nearest held point with shore guns, or home. */
  private retreat(c: Conquest, body: Ship[], at: { x: number; z: number }) {
    const team = c.player(this.slot)!.team;
    const safe = c.points.filter((p) => c.teamOfPoint(p) === team && (c.count(p, 'battery') || p.home === this.slot));
    if (!safe.length) return false;
    const p = safe.reduce((a, q) => (Math.hypot(q.x - at.x, q.z - at.z) < Math.hypot(a.x - at.x, a.z - at.z) ? q : a));
    if (Math.hypot(p.x - at.x, p.z - at.z) < p.r * 1.5) return false;
    this.sail(body, p.x, p.z, p.r * 0.5);
    return true;
  }

  private go(s: Ship, x: number, z: number) {
    const o = s.order;
    if (o.type === 'move' && Math.hypot(o.x - x, o.z - z) < 40) return;
    s.order = { type: 'move', x, z };
  }

  /** Sends ships to a point in a loose block, without disturbing those already close. */
  private sail(list: Ship[], tx: number, tz: number, spread: number) {
    // Fast escorts must not split off six hundred metres ahead of their heavy ships while sailing to a point.
    const pace = Math.min(...list.map((s) => s.spec.maxSpeed * s.mods.speed));
    const goals: { x: number; z: number; length: number }[] = [];
    const spacing = Math.max(0, ...list.map((s) => s.spec.length ?? 0)) + 8;
    const ca = Math.cos(this.axis), sa = Math.sin(this.axis);
    const grid: { x: number; z: number }[] = [];
    if (this.spreadHulls) {
      for (let ring = 0; ring <= Math.ceil(Math.sqrt(list.length)) + 8; ring++) {
        for (let row = -ring; row <= ring; row++) for (let col = -ring; col <= ring; col++) {
          if (Math.max(Math.abs(row), Math.abs(col)) !== ring) continue;
          grid.push({ x: tx + (row * ca - col * sa) * spacing, z: tz + (row * sa + col * ca) * spacing });
        }
      }
    }
    let cursor = 0;
    const free = (x: number, z: number, length: number) => this.waterGoal(x, z) && goals.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 >= ((p.length + length) * 0.5 + 4) ** 2);
    list.forEach((s, i) => {
      // Rotate the same assignment with the seat: otherwise the first heavy hull is always on the east of a group.
      const a = this.axis + (i / Math.max(1, list.length)) * Math.PI * 2;
      const ring = list.length > 1 ? spread * (0.4 + 0.6 * ((i % 3) / 2)) : 0;
      let x = tx + Math.cos(a) * ring;
      let z = tz + Math.sin(a) * ring;
      const length = s.spec.length ?? 0;
      if (this.spreadHulls && !free(x, z, length)) {
        // An uncapped navy cannot converge on overlapping hulls or a reef in the capture circle.
        // Keep valid small-fleet destinations, and spread the remaining hulls over navigable grid cells.
        while (cursor < grid.length) {
          const p = grid[cursor++]!;
          if (free(p.x, p.z, length)) { x = p.x; z = p.z; break; }
        }
      }
      goals.push({ x, z, length });
      if (Math.hypot(s.x - x, s.z - z) < 60) {
        if (s.order.type === 'move') s.order = { type: 'hold' };
        return;
      }
      this.go(s, x, z);
      s.speedCap = Math.min(1, pace / (s.spec.maxSpeed * s.mods.speed));
    });
  }
}
