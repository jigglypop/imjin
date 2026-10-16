import { SEA_STATES, WaveField, type SeaState } from '../ocean/waves';
import { GUN_SHOTS, GUN_SPECS, isUnarmed } from './catalog';
import { combatValue, shipGunSpec, shipMods, shipSpec, type BalanceProfile } from './competitive';
import { ShipGrid } from './grid';
import { isShipVisible } from './visibility';
import { anchorScale, anchorsFor } from '../ships/anchors';
import type { CurrentField } from './current';
import { coastalFormationSlots, type CoastalFormationKind } from './coastal-tactics';
import type { DepthRules } from './depth';
import { FireSpread } from './fire';
import { MORALE_TICK, Morale, NERVE_WEIGHT, SURRENDER } from './morale';
import { COHESION_AIM, Tactics, WAKE_SPEED } from './tactics';
import { Maneuvers, SURPRISE_CREW, SURPRISE_SHOCK } from './maneuvers';
import {
  OWNER_OF,
  TEAMS,
  otherTeam,
  type AmmoType,
  type BattleEvent,
  type CrewCounts,
  type CrewPlan,
  type GunState,
  type GunType,
  type LandSampler,
  type Order,
  type Projectile,
  type Ship,
  type ShipKind,
  type ShipSpec,
  type Side,
  type Squadron,
  type Team,
} from './types';

export const SIM_DT = 1 / 30;
const GRAVITY = 9.81;
const SINK_DURATION = 24;
const TAU = Math.PI * 2;
const THINK_INTERVAL = 0.3;
const DRAFT = -1.4;
// Ships the player does not command start in the orders the scenario gave them: a formation slot, or holding still
// at anchorage. They leave that order for free combat when an enemy they can see comes close, or when the battle
// has gone on long enough that waiting no longer makes sense.
const WAKE_SLOT = 320;
const WAKE_HOLD = 700;
const WAKE_ANCHOR = 650;
const WAKE_AFTER = 150;
/** Computer-led ships this close to one that weighs anchor follow it: an anchored fleet sorties together. */
const ALARM_RADIUS = 1400;

// Boarding. The Japanese fleet fought to close and board, so its crews throw grapples from further off and at a
// higher relative speed than the Joseon and Ming crews, who board only to finish a ship that is already beaten.
/** Hull-to-hull gap in metres within which a grapple can be thrown. */
const GRAPPLE_REACH = { japan: 12, other: 3 };
/** Fastest relative speed in m/s at which a grapple still holds. */
const GRAPPLE_SPEED = { japan: 6, other: 3.5 };
/** Most ships that can hold one enemy ship at the same time. */
const MAX_BOARDERS = 4;
/** A grapple parts when the hulls drift further apart than this. */
const GRAPPLE_SLACK = 14;
/** Seconds a ship cannot throw a grapple at the ship it was just cut or repelled from. */
const REGRAPPLE_LOCK = 6;
/** Boarders hit hardest in the first seconds after the grapple lands, while the defenders are still taking their stations. */
const SHOCK_TIME = 10;
const SHOCK_BONUS = 0.7;
/** Soldiers count for more than a sailor with a pike: this many sailors each. */
const SOLDIER_WEIGHT = 2;
/** Men lost per second per point of fighting strength on the other side of the rail. */
const MELEE_RATE = 0.025;
/** How much of a defender's deck-defence rating (parapet, bulwark, tower) works in a melee. */
const PARAPET_SHARE = 0.6;
/** A ship with less than this share of its crew left is a target to finish off by boarding. */
const FINISH_CREW = 0.35;
/** A beaten ship is only worth closing on with none of its fleet within this many metres. */
const FINISH_SAFE = 220;
/** How far a computer-led tender looks for a friend to keep beside, and how close it stays. */
const TENDER_SEEK = 500;
const TENDER_STAY = 50;
/** An unarmed boat runs from an enemy this close. */
const UNARMED_RUN = 400;
/** Share of the crew left below which a boarded ship is taken. */
const CAPTURE_CREW = 0.08;
// Stalemates. A battle always ends. Once the first blow has landed, a lull in which no shot hits, no ram strikes and no
// grapple holds anywhere stirs the computer's fleets: ships still waiting in their starting orders sail out, nobody
// needs light to find the enemy, and the weaker side finally gives the field up.
/** Seconds without a blow, anywhere, after which computer-led ships stop waiting and hunt the nearest enemy. */
const STALL_AI = 90;
/** The same for ships a person leads that still hold the scenario's orders (a formation slot, a hold, an anchor). */
const STALL_HUMAN = 150;
/** Seconds of lull after which a side with less than STALL_SHARE of the combined strength leaves the field. */
const STALL_RETREAT = 240;
const STALL_SHARE = 0.4;
const STALL_WEAR = 0.5;
/** Seconds of lull after which the weaker computer-led side leaves, however close the odds. */
const STALL_YIELD = 600;
/** A battle that has dragged on this long (seconds) is lost by a side that is clearly behind; after OVERTIME by the weaker one, however close. */
const LONG_BATTLE = 35 * 60;
const OVERTIME = 50 * 60;
/** The fight is called: whoever has the greater strength left wins. No battle runs longer, whoever leads it. */
const CALLED = 60 * 60;
/** With no blow struck by this time the lull counts from the start, so a battle nobody joins still ends. */
const OPENING = 480;
/** A fleeing ship this far from every enemy is out of the fight and gets away. */
const ESCAPE_CLEAR = 2400;
/** A ship that has fled this many seconds gets away once no enemy is within ESCAPE_NEAR metres, and after FLEE_GONE whatever the enemy does:
 * a coast can pen a fleeing ship in, and a fleet that cannot leave the map would never let the battle end. */
const FLEE_CLEAR = 90;
const ESCAPE_NEAR = 900;
const FLEE_GONE = 240;
/** A ship that has seen no enemy for this many seconds steers for the nearest one it knows of, lit or not. */
const SEARCH_AFTER = 45;
/** Seconds a boarder waits for the rest of the fleet to come up before it goes in on its own, and how long it then goes unwaited. */
const PACE_PATIENCE = 60;
const PACE_FREE = 45;
// Routs under the depth rules. A running ship makes for its side's open water, or for the nearest shore when its own
// side lies across the land (a fleet caught in its anchorage); a crew that runs aground there abandons the ship.
/** How far past its side's starting place a running ship heads. */
const ROUT_REACH = 1500;
/** A shore within this distance, on the way home, is where a ship caught in a bay runs to. */
const BEACH_LOOK = 650;
/** Seconds aground before a running crew leaves its ship for the shore. */
const ABANDON_AGROUND = 2;
/** Seconds after which a ship running for a port looks again at which port is its side's. */
const REFUGE_AGAIN = 20;
/**
 * A side most of whose ships are running has lost the field after this many seconds, unless enough of them rally: the
 * winner's chance to run the fleeing ships down.
 */
const BROKEN_GRACE = 45;
/** Under the maneuver rules the winner may keep running a broken fleet down this long while it is still in reach. */
const PURSUIT_GRACE = 240;
const PURSUIT_REACH = 900;
/**
 * A broken side's crews lying in their haven or running for it are fought out up to this long after the side broke,
 * while an enemy still fighting is within HAVEN_PURSUIT of one: the fleet bottled up in a bay at dawn.
 */
const HAVEN_GRACE = 900;
const HAVEN_PURSUIT = 1800;
/** A target with this many of its friends within PACKED_RANGE is worth fire arrows: the fire will spread (the depth rules). */
const PACKED_RANGE = 120;
const PACKED_SHIPS = 2;

/** Boarders close in at FLEET_PACE (m/s) while farther than this from their enemy, then go flat out together. */
const RUSH_RANGE = 450;
const FLEET_PACE = 5;
/**
 * A fleet with somewhere to be (the battle's objective, under the maneuver rules) turns aside only for an enemy within
 * PRESS_NEAR, or one lying ahead across its course: up to PRESS_AHEAD on along it and PRESS_WIDE to either side of it.
 * Within OBJECTIVE_REACHED of the objective a ship has got through and leaves the battle.
 */
const PRESS_NEAR = 260;
const PRESS_AHEAD = 650;
const PRESS_WIDE = 200;
const OBJECTIVE_REACHED = 350;
/** Boarders look for company within this many metres, and wait for the others when this far ahead of them. */
const FLEET_REACH = 800;
const FLEET_SLACK = 70;
/** Arquebusiers this close pick their man: a deadlier volley, loaded faster (seconds between volleys, plus up to 0.9). */
const CLOSE_RANGE = 80;
const CLOSE_LOSS = 1.3;
const CLOSE_RELOAD = 2.6;

// How much each station adds in a deck fight, in CREW_ROLES order: soldiers fight hardest, rowers least.
const MELEE_WEIGHT: CrewCounts = [0.15, 0.4, 0.6, 1];
/**
 * Who a kind of fire reaches, by station. Musketry and grapeshot sweep the open deck while the rowers below are
 * shielded; a ball through the hull kills on every deck; boarders cut down the deck fighters first.
 */
const EXPOSURE = {
  deck: [0.12, 0.6, 1, 1],
  hull: [1, 1, 0.5, 0.5],
  melee: [0.25, 0.6, 0.9, 1.2],
  all: [1, 1, 1, 1],
} as const satisfies Record<string, CrewCounts>;
export type Exposure = keyof typeof EXPOSURE;
/** Share of the gap to the station plan that the crew closes each second, moving between decks. */
const REASSIGN_RATE = 0.12;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wrapAngle(a: number) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Plane distance. Math.hypot allocates in V8, and the AI and gunnery call it hundreds of thousands of times a second. */
const hyp = (x: number, z: number) => Math.sqrt(x * x + z * z);

/** The Japanese navy closed and boarded; the Joseon and Ming fleets fought with guns at a distance. */
export const boardsFirst = (s: Ship) => s.spec.faction === 'japan';

export type ShipActivity = 'idle' | 'moving' | 'engaging' | 'boarding' | 'sinking' | 'struck' | 'charging' | 'evading' | 'anchored' | 'fleeing' | 'aground';

/** Extra rules layered on a battle, such as the capture points of a conquest battle. */
export interface BattleRules {
  step(b: Battle, dt: number): void;
  /** A ship left the fight: sunk, struck or fled. */
  lost?(b: Battle, s: Ship): void;
  /** A projectile landed on dry ground. */
  impact?(b: Battle, x: number, y: number, z: number, damage: number, team: Team): void;
  /** Overrides the default end, which is one side having no ships left. */
  decide?(b: Battle): Team | 'draw' | null;
  /** Tenders (ShipSpec.tender) top up their friends under these rules, and the computer's tenders go looking for them. */
  tenders?: boolean;
  /** Where a routing ship runs to, such as its nearest own port, where it can rally; without it, its side's open water. */
  refuge?(b: Battle, s: Ship): { x: number; z: number } | null;
}

export class Battle {
  ships: Ship[] = [];
  squadrons: Squadron[] = [];
  projectiles: Projectile[] = [];
  events: BattleEvent[] = [];
  time = 0;
  windAngle = 0.6;
  /** Leeway: how fast the wind pushes a ship that is not at anchor, in m/s. Contest maps turn it off to keep both sides even. */
  windDrift = 0.15;
  winner: Team | null = null;
  draw = false;
  readonly waves: WaveField;
  escaped = { joseon: 0, japan: 0 };
  initial = { joseon: 0, japan: 0 };
  /** A computer-led team turns and flees once its share of ships still fighting drops below this. 0 fights to the end. */
  retreatBelow: Record<Team, number> = { joseon: 0, japan: 0.3 };
  /** Owners whose ships keep their orders until a person changes them. A team with a human owner never flees on its own. */
  humans = new Set<number>([OWNER_OF.joseon]);
  /** Balance runs: the computer also leads the human owners' ships. */
  autopilot = false;
  night = false;
  /** Competitive weather scales every lookout equally; historical sight retains its original rules. */
  visibilityScale = 1;
  current = { x: 0, z: 0 };
  land: LandSampler = () => -50;
  center = { x: 0, z: 0 };
  arenaRadius = 6000;
  rules: BattleRules | null = null;
  /** Where each side's computer-led ships make for when they see no enemy, if the battle gives it one (the maneuver rules). */
  objectives: Partial<Record<Team, { x: number; z: number }>> = {};
  /**
   * A shore the side holds, if the battle has one (the maneuver rules): a broken crew whose way home is barred runs for
   * it when it lies that way, and waits there, inside, instead of running on.
   */
  havens: Partial<Record<Team, { x: number; z: number }>> = {};
  /** The battle depth rules this battle was built with (depth.ts); null keeps the rules from before them. */
  depth: DepthRules | null = null;
  private moraleRules: Morale | null = null;
  private tacticsRules: Tactics | null = null;
  private fireRules: FireSpread | null = null;
  private maneuverRules: Maneuvers | null = null;
  private depthTurn = 0;
  /** Each side's starting place, which its running ships head back past. */
  private homes: Record<Team, { x: number; z: number }> | null = null;
  /** Where each running ship is heading, whether that is a shore to run aground on or a port, and when it was chosen. */
  private refuges = new Map<number, { x: number; z: number; beach: boolean; port: boolean; at: number }>();
  /** Since when most of each side's fleet has been running. */
  private brokenSince: Record<Team, number | null> = { joseon: null, japan: null };
  private byId = new Map<number, Ship>();
  private nextId = 1;
  private nextProjectile = 1;
  private readonly rand: () => number;
  private readonly activity = new Map<number, ShipActivity>();
  private chargeTimer = new Map<number, number>();
  /** Boarder id to the ship it was cut loose from and when it may try again. */
  private grappleLock = new Map<number, { on: number; until: number }>();
  /** Ships holding each boarded ship, by the boarded ship's id, as of the last step. */
  private boarders = new Map<number, number>();
  /** Visible targets assigned to boarders. Limits crowding before the four-ship grapple limit applies. */
  private boardingTargets = new Map<number, number>();
  private boardingSlots = new Map<number, number>();
  private readonly gapA: number[] = [];
  private readonly gapB: number[] = [];
  private readonly grid = new ShipGrid(120);
  /** Each side's ships alone: most look-ups want only friends or only foes, and a packed fleet fills the cells round it. */
  private readonly teamGrids: Record<Team, ShipGrid> = { joseon: new ShipGrid(120), japan: new ShipGrid(120) };
  private active: Record<Team, Ship[]> = { joseon: [], japan: [] };
  private retreating: Record<Team, boolean> = { joseon: false, japan: false };
  /** When a blow last landed: a hit, a ram, a grapple or a man cut down in a melee. */
  private lastBlow = 0;
  private blows = 0;
  /** Seconds since the last blow, once the opening is over; 0 while the fleets are still closing. */
  private lull = 0;
  private strengthAt = -10;
  /** Each side's strength when the lull rules first looked, which is its strength at the outset. */
  private fullStrength: Record<Team, number> | null = null;
  /** Boarder id to the seconds it has waited for the fleet, and the time until which it needs not wait again. */
  private paceWait = new Map<number, { wait: number; until: number }>();
  /** Fleeing ship id to the time it turned to flee. */
  private fleeSince = new Map<number, number>();
  /** Ship id to the time it lost sight of every enemy. */
  private searchSince = new Map<number, number>();
  private firingLaneAt = -1;
  private firingLanes = new Map<number, boolean>();
  /** The fastest shot each ship spec fires, for the firing lane's arc. A battle keeps one balance profile throughout. */
  private readonly muzzles = new Map<ShipSpec, number>();
  private readonly sideTargets: (Ship | undefined | null)[] = [null, null, null];
  private readonly volleyTargets: (Ship | undefined | null)[] = [null, null, null];

  constructor(seed = 1592, readonly profile: BalanceProfile = 'historical') {
    this.rand = mulberry32(seed);
    this.waves = new WaveField(profile === 'historical' ? 1592 : seed ^ 0x51ea1592);
    this.setSea(SEA_STATES.moderate);
  }

  get ended() {
    return this.winner !== null || this.draw;
  }

  /** The morale rules, while the depth rules have them. */
  get morale(): Morale | null {
    if (!this.depth?.morale) return null;
    return (this.moraleRules ??= new Morale(this));
  }

  /** Raking, crossfire and formation cohesion, while the depth rules have them. */
  get tactics(): Tactics | null {
    if (!this.depth?.gunnery) return null;
    return (this.tacticsRules ??= new Tactics(this));
  }

  /** Fire jumping between hulls, while the depth rules have it. */
  get fireSpread(): FireSpread | null {
    if (!this.depth?.fireSpread) return null;
    return (this.fireRules ??= new FireSpread(this));
  }

  /** Squadron maneuvers, station keeping, command radius and open-water routs, while the depth rules have them. */
  get maneuvers(): Maneuvers | null {
    if (!this.depth?.maneuvers) return null;
    return (this.maneuverRules ??= new Maneuvers(this));
  }

  /** Each battle owns its sea; rendering and other battles cannot change its collisions. */
  setSea(state: SeaState) {
    this.waves.setState({ ...state });
    this.waves.time = this.time;
  }

  random() {
    return this.rand();
  }

  shipSpec(kind: ShipKind) {
    return shipSpec(kind, this.profile);
  }

  gunSpec(kind: ShipKind, gun: GunType) {
    return shipGunSpec(kind, gun, this.profile);
  }

  addSquadron(team: Team, name: string, commander: string, portrait: string, card: string, owner = -1) {
    const sq: Squadron = { id: this.squadrons.length + 1, team, faction: team, owner, name, commander, portrait, card, shipIds: [], leaderId: 0 };
    this.squadrons.push(sq);
    return sq;
  }

  addShip(kind: ShipKind, x: number, z: number, heading: number, name: string, squadron: Squadron | null, flagship = false, variant = 0, id = 0): Ship {
    const spec = this.shipSpec(kind);
    const guns: GunState[] = [];
    spec.batteries.forEach((b, bi) => {
      for (let i = 0; i < b.count; i += 1) {
        const stages = GUN_SPECS[b.gun].stages;
        const stage = Math.floor(this.rand() * 4);
        guns.push({ battery: bi, index: i, side: b.side, stage, t: this.rand() * stages[stage]!, fireDelay: 0, ammo: GUN_SHOTS[b.gun] });
      }
    });
    if (squadron && squadron.owner < 0) squadron.owner = OWNER_OF[spec.faction];
    const plan = [...spec.crewPlan] as CrewPlan;
    const ship: Ship = {
      id: id || this.nextId,
      spec,
      team: squadron?.team ?? spec.team,
      owner: squadron?.owner ?? OWNER_OF[spec.faction],
      name,
      squadronId: squadron?.id ?? 0,
      flagship,
      variant,
      x,
      z,
      heading,
      speed: spec.maxSpeed * 0.3,
      turn: 0,
      throttle: 0.3,
      rudder: 0,
      hull: spec.hull,
      damageState: this.profile === 'historical' ? undefined : { flooding: 0, propulsion: 0, steering: 0 },
      crew: spec.crew,
      roles: plan.map((p) => p * spec.crew) as CrewCounts,
      plan,
      fire: 0,
      burn: 0,
      morale: 1,
      moraleState: 'steady',
      order: { type: 'auto' },
      targetId: 0,
      guns,
      musketReload: this.rand() * 3,
      grappledWith: 0,
      grappleTime: 0,
      alive: true,
      sinking: 0,
      sinkRoll: (this.rand() < 0.5 ? -1 : 1) * (0.35 + this.rand() * 0.5),
      sinkPitch: (this.rand() - 0.5) * 0.5,
      struck: false,
      lastHit: -100,
      kills: 0,
      thinkTimer: this.rand() * THINK_INTERVAL,
      aground: 0,
      fireMode: 'free',
      ammo: 'auto',
      speedCap: 1,
      stance: 'auto',
      lights: true,
      volleySide: -1,
      volleyTimer: 0,
      revealed: 0,
      repel: false,
      mods: shipMods(kind, this.profile),
      supply: 1,
      campaignId: '',
    };
    this.setCrew(ship, spec.crew);
    this.nextId = Math.max(this.nextId, ship.id + 1);
    this.ships.push(ship);
    this.byId.set(ship.id, ship);
    this.initial[ship.team] += 1;
    if (squadron) {
      if (!squadron.shipIds.length) squadron.faction = spec.faction;
      squadron.shipIds.push(ship.id);
      if (!squadron.leaderId || flagship) squadron.leaderId = ship.id;
    }
    return ship;
  }

  get(id: number) {
    return this.byId.get(id);
  }

  squadron(id: number) {
    return this.squadrons[id - 1];
  }

  isActive(s: Ship | undefined): s is Ship {
    return !!s && s.alive && s.sinking === 0 && !s.struck;
  }

  activityOf(id: number): ShipActivity {
    return this.activity.get(id) ?? 'idle';
  }

  teamCount(team: Team) {
    let n = 0;
    for (const s of this.ships) if (s.team === team && this.isActive(s)) n += 1;
    return n;
  }

  strength(team: Team) {
    let v = 0;
    for (const s of this.ships) {
      if (s.team !== team || !this.isActive(s)) continue;
      const base = this.profile === 'historical' ? s.spec.hull : combatValue(s.spec.kind, this.profile);
      v += base * ((s.hull / s.spec.hull) * 0.6 + (s.crew / s.spec.crew) * 0.4) * NERVE_WEIGHT[s.moraleState];
    }
    return v;
  }

  setOrder(ids: number[], order: Order, queue = false) {
    if (queue && order.type !== 'move') return 0;
    let changed = 0;
    for (const id of ids) {
      const s = this.byId.get(id);
      if (!this.isActive(s)) continue;
      if (this.profile !== 'historical' && (order.type === 'attack' || order.type === 'broadside' || order.type === 'follow')) {
        const target = this.byId.get(order.type === 'follow' ? order.leaderId : order.targetId);
        if (!target || !isShipVisible(this, s.team, target.id)) continue;
      }
      if (queue && order.type === 'move' && s.order.type === 'move') {
        const pending = s.orderQueue ??= [];
        if (pending.length >= 16) continue;
        pending.push({ ...order });
      } else {
        s.orderQueue = undefined;
        s.order = { ...order };
      }
      changed += 1;
    }
    return changed;
  }

  removeShips(pred: (s: Ship) => boolean) {
    const removed = new Set<number>();
    this.ships = this.ships.filter((s) => {
      if (!pred(s)) return true;
      removed.add(s.id);
      this.byId.delete(s.id);
      this.initial[s.team] -= 1;
      return false;
    });
    const kept = this.squadrons.filter((sq) => {
      sq.shipIds = sq.shipIds.filter((id) => !removed.has(id));
      return sq.shipIds.length > 0;
    });
    kept.forEach((sq, i) => {
      sq.id = i + 1;
      for (const id of sq.shipIds) this.byId.get(id)!.squadronId = sq.id;
      if (!sq.shipIds.includes(sq.leaderId)) sq.leaderId = sq.shipIds[0] ?? 0;
    });
    this.squadrons = kept;
  }

  applySupply(s: Ship, supply: number) {
    s.supply = Number.isFinite(supply) ? clamp(supply, 0, 1) : 0;
    for (const g of s.guns) g.ammo = GUN_SHOTS[s.spec.batteries[g.battery]!.gun] * s.supply;
  }

  /** Sets the total crew, spread over the stations by the ship's plan. */
  setCrew(s: Ship, total: number) {
    const crew = Number.isFinite(total) ? clamp(total, 0, s.spec.crew) : 0;
    for (let i = 0; i < 4; i += 1) s.roles[i] = crew * s.plan[i]!;
    s.crew = s.roles[0] + s.roles[1] + s.roles[2] + s.roles[3];
  }

  configure(ids: number[], patch: Partial<Pick<Ship, 'fireMode' | 'ammo' | 'speedCap' | 'stance' | 'lights' | 'repel'>>) {
    for (const id of ids) {
      const s = this.byId.get(id);
      if (this.isActive(s)) Object.assign(s, patch);
    }
  }

  /** Station plan for the given ships. Roles a ship has no use for, such as gunners without guns, stay empty. */
  setPlan(ids: number[], plan: CrewPlan) {
    for (const id of ids) {
      const s = this.byId.get(id);
      if (!this.isActive(s)) continue;
      const p = plan.map((v, i) => (s.spec.crewPlan[i]! > 0 ? Math.max(0, v) : 0));
      const sum = p.reduce((a, v) => a + v, 0);
      if (!(sum > 0) || !Number.isFinite(sum)) continue;
      s.plan = p.map((v) => v / sum) as CrewPlan;
    }
  }

  volley(ids: number[], side: number) {
    let ships = 0;
    for (const id of ids) {
      const s = this.byId.get(id);
      if (!this.isActive(s)) continue;
      s.volleySide = side;
      s.volleyTimer = 2.4;
      ships += 1;
    }
    return ships;
  }

  /** The squadrons of these ships beat their drums to steady and rally their ships (the depth rules). Returns how many did. */
  drum(ids: number[]) {
    const morale = this.morale;
    if (!morale) return 0;
    const squadrons = new Set<number>();
    for (const id of ids) {
      const s = this.byId.get(id);
      if (s?.alive && s.squadronId) squadrons.add(s.squadronId);
    }
    let beat = 0;
    for (const sq of squadrons) if (morale.drum(sq)) beat += 1;
    return beat;
  }

  cutGrapples(ids: number[]) {
    let cut = 0;
    for (const id of ids) {
      const s = this.byId.get(id);
      if (!this.isActive(s)) continue;
      if (s.grappledWith) {
        this.lockGrapple(s, s.grappledWith);
        s.grappledWith = 0;
        cut += 1;
      }
      for (const o of this.ships) {
        if (o.grappledWith === s.id && this.rand() < 0.65) {
          this.lockGrapple(o, s.id);
          o.grappledWith = 0;
          this.casualties(o, 4, 'melee', true);
          this.events.push({ type: 'repelled', a: o.id, b: s.id });
          cut += 1;
        }
      }
    }
    return cut;
  }

  private lockGrapple(s: Ship, on: number) {
    this.grappleLock.set(s.id, { on, until: this.time + REGRAPPLE_LOCK });
  }

  private grappleLocked(s: Ship, on: number) {
    const lock = this.grappleLock.get(s.id);
    if (!lock) return false;
    if (this.time >= lock.until) {
      this.grappleLock.delete(s.id);
      return false;
    }
    return lock.on === on;
  }

  canSee(target: Ship, d: number, observerTeam?: Team) {
    if (this.profile !== 'historical' && observerTeam) return isShipVisible(this, observerTeam, target.id);
    if (observerTeam && observerTeam !== target.team && this.maneuverRules?.hidden(target, d)) return false;
    if (!this.night) return true;
    const range = target.lights ? 1900 : target.fire > 0.08 ? 1400 : target.revealed > 0 ? 900 : 260;
    return d <= range;
  }

  coastalTactic?: CoastalFormationKind;

  formation(ids: number[], kind: 'crane' | 'line' | 'column' | 'wedge' | CoastalFormationKind, cx: number, cz: number) {
    const ships = ids.map((id) => this.byId.get(id)).filter((s): s is Ship => this.isActive(s));
    if (!ships.length) return 0;
    let fx = 0;
    let fz = 0;
    for (const s of ships) {
      fx += s.x;
      fz += s.z;
    }
    fx /= ships.length;
    fz /= ships.length;
    const toFleet = Math.atan2(fz - cz, fx - cx);
    const n = ships.length;
    if (kind === 'yeosu-wings' || kind === 'mokpo-depth') {
      const slots = coastalFormationSlots(kind, n, { x: fx, z: fz }, toFleet + Math.PI);
      const placed: { x: number; z: number; r: number }[] = [];
      const assigned: { s: Ship; x: number; z: number; face: number }[] = [];
      for (let i = 0; i < n; i++) {
        const s = ships[i]!, slot = slots[i]!, radius = Math.max(12, s.spec.length * 0.5);
        const wet = (x: number, z: number) => this.land(x, z) < -2 && this.land(x + radius, z) < -1 && this.land(x - radius, z) < -1 && this.land(x, z + radius) < -1 && this.land(x, z - radius) < -1 && !placed.some((p) => hyp(x - p.x, z - p.z) < radius + p.r + 8);
        let x = slot.x, z = slot.z, found = wet(x, z);
        for (let ring = 1; !found && ring <= 100; ring++) for (let k = 0; k < 24; k++) {
          const a = toFleet + (k / 24) * TAU;
          const px = slot.x + Math.cos(a) * ring * 60, pz = slot.z + Math.sin(a) * ring * 60;
          if (!wet(px, pz)) continue;
          x = px; z = pz; found = true; break;
        }
        if (!found) return 0; // Keep the previous complete formation when this terrain cannot seat it.
        placed.push({ x, z, r: radius }); assigned.push({ s, x, z, face: slot.face });
      }
      for (const a of assigned) a.s.order = { type: 'slot', x: a.x, z: a.z, face: a.face };
    } else if (kind === 'crane') {
      const radius = Math.max(320, n * 32);
      const span = Math.min(2.6, 0.6 + n * 0.06);
      const slots = Array.from({ length: n }, (_, i) => {
        const a = toFleet + (n === 1 ? 0 : (i / (n - 1) - 0.5) * span);
        return { a, x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius };
      });
      const sorted = [...ships].sort((p, q) => wrapAngle(Math.atan2(p.z - cz, p.x - cx) - toFleet) - wrapAngle(Math.atan2(q.z - cz, q.x - cx) - toFleet));
      sorted.forEach((s, i) => {
        const slot = slots[i]!;
        s.order = { type: 'slot', x: slot.x, z: slot.z, face: slot.a + Math.PI / 2 };
      });
    } else if (kind === 'line') {
      const along = toFleet + Math.PI / 2;
      const dist = Math.min(380, hyp(fx - cx, fz - cz) * 0.8);
      const lx = cx + Math.cos(toFleet) * dist;
      const lz = cz + Math.sin(toFleet) * dist;
      const sorted = [...ships].sort((p, q) => (p.x - fx) * Math.cos(along) + (p.z - fz) * Math.sin(along) - ((q.x - fx) * Math.cos(along) + (q.z - fz) * Math.sin(along)));
      sorted.forEach((s, i) => {
        const off = (i - (n - 1) / 2) * 52;
        s.order = { type: 'slot', x: lx + Math.cos(along) * off, z: lz + Math.sin(along) * off, face: along };
      });
    } else {
      const heading = toFleet + Math.PI;
      const sorted = [...ships].sort((p, q) => (q.x - fx) * Math.cos(heading) + (q.z - fz) * Math.sin(heading) - ((p.x - fx) * Math.cos(heading) + (p.z - fz) * Math.sin(heading)));
      const leader = sorted.find((s) => s.flagship) ?? sorted[0]!;
      const rest = sorted.filter((s) => s !== leader);
      const stop = hyp(fx - cx, fz - cz) > 200 ? 0.7 : 0;
      leader.order = { type: 'move', x: fx + (cx - fx) * (stop || 1), z: fz + (cz - fz) * (stop || 1) };
      rest.forEach((s, i) => {
        const rank = i + 1;
        if (kind === 'column') {
          s.order = { type: 'follow', leaderId: leader.id, dx: -rank * 60, dz: 0 };
        } else {
          const row = Math.ceil(rank / 2);
          const sideSign = rank % 2 === 1 ? 1 : -1;
          s.order = { type: 'follow', leaderId: leader.id, dx: -row * 52, dz: sideSign * row * 44 };
        }
      });
    }
  }

  flow: CurrentField | null = null;
  tide = 0;

  step(dt: number) {
    this.time += dt;
    this.waves.time = this.time;
    if (this.flow) this.tide = this.flow.tideAt(this.time);
    for (const s of this.ships) if (s.revealed > 0) s.revealed -= dt;
    this.active.joseon.length = 0;
    this.active.japan.length = 0;
    for (const s of this.ships) if (this.isActive(s)) this.active[s.team].push(s);
    if (this.profile !== 'historical') {
      this.boardingTargets.clear();
      for (const id of this.boardingSlots.keys()) {
        const s = this.get(id);
        if (!s || !this.isActive(s)) this.boardingSlots.delete(id);
      }
      for (const s of this.ships) if (this.isActive(s) && boardsFirst(s) && s.targetId) {
        this.boardingTargets.set(s.targetId, (this.boardingTargets.get(s.targetId) ?? 0) + 1);
      }
    }
    this.grid.rebuild(this.ships);
    this.teamGrids.joseon.rebuild(this.ships, 'joseon');
    this.teamGrids.japan.rebuild(this.ships, 'japan');
    this.checkRetreat();
    const maneuvers = this.maneuvers;
    maneuvers?.step(dt);
    for (const s of this.ships) {
      if (!s.alive) continue;
      s.thinkTimer -= dt;
      if (s.thinkTimer <= 0) {
        // A computer-led crew cut off from its leader is slow to make up its mind.
        s.thinkTimer += maneuvers?.isCut(s) && this.isAi(s) ? THINK_INTERVAL * 3 : THINK_INTERVAL;
        this.think(s);
        this.avoidLand(s);
      }
    }
    for (const s of this.ships) if (s.alive) this.move(s, dt);
    this.collide(dt);
    this.reachGrapples();
    for (const s of this.ships) if (s.alive) this.weapons(s, dt);
    this.updateProjectiles(dt);
    for (const s of this.ships) {
      if (!s.alive) continue;
      this.damageOverTime(s, dt);
      this.reassign(s, dt);
    }
    this.resolveBoarding(dt);
    if (this.depth) this.depthStep(dt);
    this.rules?.step(this, dt);
    this.lull = !this.rules && (this.blows > 0 || this.time > OPENING) ? this.time - this.lastBlow : 0;
    if (!this.ended) {
      const broken = this.morale ? this.brokenSide() : null;
      if (this.rules?.decide) {
        const result = this.rules.decide(this);
        if (result === 'draw') this.draw = true;
        else this.winner = result;
      }
      else if (this.active.japan.length === 0 && this.active.joseon.length === 0 && this.initial.japan > 0 && this.initial.joseon > 0) this.draw = true;
      else if (this.active.japan.length === 0 && this.initial.japan > 0) this.winner = 'joseon';
      else if (this.active.joseon.length === 0 && this.initial.joseon > 0) this.winner = 'japan';
      else if (broken === 'draw') this.draw = true;
      else if (broken) this.winner = otherTeam(broken);
      else if (this.time >= CALLED) {
        const a = this.strength('joseon');
        const d = this.strength('japan');
        if (a === d) this.draw = true;
        else this.winner = a > d ? 'joseon' : 'japan';
      }
    }
  }

  /** Active ships of a team, as of the last step. */
  activeOf(team: Team): readonly Ship[] {
    return this.active[team];
  }

  /** Calls fn for every live ship of one side within r of a point, in the order near() would. */
  nearTeam(team: Team, x: number, z: number, r: number, fn: (s: Ship) => void) {
    this.teamGrids[team].query(x, z, r, (s) => {
      if ((s.x - x) ** 2 + (s.z - z) ** 2 <= r * r) fn(s);
    });
  }

  /** Calls fn for every live ship within r of a point. Uses the grid built at the start of the step. */
  near(x: number, z: number, r: number, fn: (s: Ship) => void) {
    this.grid.query(x, z, r, (s) => {
      if ((s.x - x) ** 2 + (s.z - z) ** 2 <= r * r) fn(s);
    });
  }

  /**
   * The depth rules' slower work: each ship's morale and formation, and the fire it may throw onto its neighbours,
   * looked at once every MORALE_TICK seconds with the fleet spread evenly over the steps.
   */
  private depthStep(dt: number) {
    const morale = this.morale;
    const tactics = this.tactics;
    const fire = this.fireSpread;
    this.homes ??= { joseon: this.centroid('joseon'), japan: this.centroid('japan') };
    const buckets = Math.max(1, Math.round(MORALE_TICK / dt));
    this.depthTurn = (this.depthTurn + 1) % buckets;
    const elapsed = buckets * dt;
    for (const s of this.ships) {
      if (!s.alive || s.id % buckets !== this.depthTurn) continue;
      if (fire && s.fire > 0) fire.spread(s, elapsed);
      if (!this.isActive(s)) continue;
      tactics?.formation(s);
      morale?.look(s, elapsed);
      if (fire) this.pickAmmo(s);
    }
    morale?.step();
  }

  private centroid(team: Team) {
    let x = 0;
    let z = 0;
    let n = 0;
    for (const s of this.ships) {
      if (s.team !== team || !s.alive) continue;
      x += s.x;
      z += s.z;
      n += 1;
    }
    return n ? { x: x / n, z: z / n } : { ...this.center };
  }

  /** A side most of whose fleet has been running for BROKEN_GRACE seconds has lost the field; 'draw' if both have. */
  private brokenSide(): Team | 'draw' | null {
    let out: Team | 'draw' | null = null;
    for (const team of TEAMS) {
      if (!this.morale!.broken(team)) {
        this.brokenSince[team] = null;
        continue;
      }
      this.brokenSince[team] ??= this.time;
      const since = this.time - this.brokenSince[team]!;
      if (since < BROKEN_GRACE) continue;
      // Crews bottled up in their haven, or running for it with the enemy after them, are fought out a while longer.
      const bottled = !!this.maneuvers && since < HAVEN_GRACE && this.bottled(team);
      if (!bottled && (since >= PURSUIT_GRACE || !this.maneuvers || !this.inReach(team))) out = out ? 'draw' : team;
    }
    return out;
  }

  /** Whether any running ship of a broken side still has an enemy close enough to run it down. */
  private inReach(team: Team, reach = PURSUIT_REACH, only?: (s: Ship) => boolean) {
    for (const s of this.active[team]) {
      if (s.moraleState !== 'routing' || (only && !only(s))) continue;
      let near = false;
      this.teamGrids[otherTeam(team)].query(s.x, s.z, reach, (o) => {
        if (!near &&this.isActive(o) && o.moraleState !== 'routing' && (o.x - s.x) ** 2 + (o.z - s.z) ** 2 < reach * reach) near = true;
      });
      if (near) return true;
    }
    return false;
  }

  /** Whether a running crew of the side lies in its haven, or runs for it, with an enemy still fighting after it. */
  private bottled(team: Team) {
    const m = this.maneuverRules;
    return !!m && !!this.havens[team] && this.inReach(team, HAVEN_PURSUIT, (s) => m.havenBound(s));
  }

  /** Whether a computer-led fleet has given up the field and is running for home. */
  isRetreating(team: Team) {
    return this.retreating[team];
  }

  /** Ships of a side still fighting: under the depth rules a running ship does not count. */
  fighting(team: Team) {
    if (!this.morale) return this.active[team].length;
    let n = 0;
    for (const s of this.active[team]) if (s.moraleState !== 'routing') n += 1;
    return n;
  }

  /**
   * A crew has broken: the computer's orders give way to running, a ship at anchor cuts its cable, and a boarding party
   * it sent lets go. A person's other orders wait until the ship rallies.
   */
  routed(s: Ship) {
    this.refuges.delete(s.id);
    this.maneuverRules?.forgetRun(s.id);
    this.fleeSince.delete(s.id);
    if (this.isAi(s)) {
      if (s.order.type !== 'auto') s.order = { type: 'auto' };
      s.orderQueue = undefined;
    } else if (s.order.type === 'anchor') s.order = { type: 'hold' };
    if (s.grappledWith) {
      this.lockGrapple(s, s.grappledWith);
      s.grappledWith = 0;
    }
  }

  private checkRetreat() {
    if (!this.rules) this.fullStrength ??= { joseon: this.strength('joseon'), japan: this.strength('japan') };
    if (this.time <= 60) return;
    for (const team of TEAMS) {
      // Under the depth rules a fleet a person leads breaks at the same line as the computer's; before them it never did.
      if (this.retreating[team] || (this.ledByHuman(team) && !this.morale)) continue;
      const ratio = this.fighting(team) / Math.max(1, this.initial[team]);
      if (ratio < this.retreatBelow[team]) this.giveUp(team);
    }
    if (!this.fullStrength || (this.lull < STALL_RETREAT && this.time < LONG_BATTLE) || this.time - this.strengthAt < 1) return;
    // A lull that will not break, or a battle that has dragged on: the weaker computer-led side gives up the field.
    this.strengthAt = this.time;
    const own = { joseon: this.strength('joseon'), japan: this.strength('japan') };
    const weaker: Team = own.joseon < own.japan ? 'joseon' : 'japan';
    for (const team of TEAMS) {
      if (this.retreating[team] || this.ledByHuman(team) || !this.active[team].length) continue;
      const share = own[team] / Math.max(1, own.joseon + own.japan);
      // Badly outnumbered and already bled white; a fleet that was always the smaller one is not beaten by that alone.
      if ((share < STALL_SHARE && own[team] < this.fullStrength[team] * STALL_WEAR) || (team === weaker && (this.lull >= STALL_YIELD || this.time >= OVERTIME))) this.giveUp(team);
    }
  }

  /** A computer-led fleet gives up the field. Under the depth rules every crew in it is running from then on. */
  private giveUp(team: Team) {
    this.retreating[team] = true;
    const morale = this.morale;
    const first = this.active[team][0];
    if (!morale || !first) return;
    morale.breakFleet(team);
    this.events.push({ type: 'broken', ship: first.id, team });
  }

  private ledByHuman(team: Team) {
    if (this.autopilot) return false;
    for (const s of this.active[team]) if (this.humans.has(s.owner)) return true;
    return false;
  }

  /** Whether the computer leads this ship. */
  isAi(s: Ship) {
    return this.autopilot || !this.humans.has(s.owner);
  }

  /**
   * A wavering crew the computer leads keeps its distance instead of closing (the depth rules), unless it is a boarding
   * crew already inside its rush: one that has started the charge sees it through.
   */
  private shaken(s: Ship) {
    if (s.moraleState !== 'wavering' || !this.isAi(s)) return false;
    if (!boardsFirst(s)) return true;
    const target = this.byId.get(s.targetId);
    return !this.isActive(target) || hyp(target.x - s.x, target.z - s.z) > this.rushRange();
  }

  /** A crew in no state to board: running, regrouping, or shaken under the computer's lead. */
  private hesitant(s: Ship) {
    return s.moraleState === 'routing' || s.moraleState === 'rallying' || this.shaken(s);
  }

  /** A computer-led ship waiting in its starting order joins the fight once the enemy is close or the wait is over. */
  private wake(s: Ship) {
    const type = s.order.type;
    if ((type !== 'slot' && type !== 'hold') || !this.isAi(s) || this.rules) return;
    const enemy = this.nearestEnemy(s);
    const reach = type === 'slot' ? WAKE_SLOT : WAKE_HOLD;
    if (this.time > WAKE_AFTER || (enemy && hyp(enemy.x - s.x, enemy.z - s.z) < reach)) {
      s.order = { type: 'auto' };
      this.raiseAlarm(s);
    }
  }

  /** Whether the lull has gone on long enough that this ship should stop waiting for the enemy to come to it. */
  private restless(s: Ship) {
    return this.lull >= (this.isAi(s) ? STALL_AI : STALL_HUMAN);
  }

  /** A ship still in an order that waits on the enemy leaves it once the battle has stalled. */
  private stir(s: Ship) {
    const type = s.order.type;
    if ((type !== 'slot' && type !== 'hold' && type !== 'anchor' && type !== 'follow' && type !== 'bombard' && type !== 'broadside') || !this.restless(s)) return;
    s.order = { type: 'auto' };
    if (this.isAi(s)) this.raiseAlarm(s);
  }

  /** A ship that gets under way rouses the computer-led ships of its squadron and those lying close by: a fleet sorties together. */
  private raiseAlarm(s: Ship) {
    const rouse = (o: Ship) => {
      const type = o.order.type;
      if (o !== s && o.team === s.team && (type === 'anchor' || type === 'hold' || type === 'slot') && this.isAi(o)) o.order = { type: 'auto' };
    };
    const sq = this.squadrons[s.squadronId - 1];
    if (sq) for (const id of sq.shipIds) rouse(this.byId.get(id)!);
    this.grid.query(s.x, s.z, ALARM_RADIUS, (o) => {
      if ((o.x - s.x) ** 2 + (o.z - s.z) ** 2 < ALARM_RADIUS * ALARM_RADIUS) rouse(o);
    });
  }

  /** `onCourse`: a ship pressing on for its side's objective looks only at the enemies in its way (`offCourse`). */
  nearestEnemy(s: Ship, preferBoardable = false, within = Infinity, onCourse = false) {
    const list = this.active[otherTeam(s.team)];
    const spreadBoarders = this.profile !== 'historical' && preferBoardable && boardsFirst(s) && this.isAi(s);
    const lightBoarder = spreadBoarders && s.spec.kind !== 'atakebune';
    let best: Ship | undefined;
    let bestScore = Infinity;
    const maneuvers = this.maneuvers;
    const pressing = onCourse && this.pressing(s);
    // A rash or bold commander's boarders keep after a ship that turns away from them: the lure works on them.
    const chased = maneuvers && boardsFirst(s) && this.isAi(s) ? this.byId.get(s.targetId) : undefined;
    if (chased && chased.team !== s.team && maneuvers!.chases(s, chased) && hyp(chased.x - s.x, chased.z - s.z) <= within && !(pressing && this.offCourse(s, chased))) return chased;
    // The most a score can fall below the distance, summed from the bonuses below. A ship that much farther off than
    // the best so far cannot beat it, so the rest of its scoring (crossfire, crowding, tethers) is not worked out.
    const boards = boardsFirst(s);
    // A Ming crew's focus on wounded hulls has no fixed floor, so its candidates are all scored in full.
    const slack = this.profile !== 'historical' && s.spec.faction === 'ming' ? Infinity : 1e-6 + 60 + (maneuvers && !boards ? 120 : 0) + (boards ? 80 + 80 : 70) + (lightBoarder ? 100 : 0);
    for (const o of list) {
      const d = hyp(o.x - s.x, o.z - s.z);
      if (d > within || !((this.profile === 'historical' && this.lull >= STALL_AI) || this.canSee(o, d, s.team))) continue;
      if (pressing && this.offCourse(s, o)) continue;
      if (d - slack >= bestScore) continue;
      let score = d;
      if (maneuvers) {
        // Fire spread over the enemy line and drawn to a ship already under fire from another quarter, not a firing
        // squad of the whole fleet on one hull; a cautious commander's crews do not leave their anchorage to chase.
        if (!boardsFirst(s) && this.tactics?.crossing(o, s)) score -= 120;
        score += Math.max(0, maneuvers.crowd(o) - (o.id === s.targetId ? 4 : 3)) * 30;
        if (this.isAi(s) && maneuvers.tethered(s, o)) score += 2000;
      }
      if (preferBoardable && !o.spec.boardable) score += 700;
      if (o.id === s.targetId) score -= 60;
      // Ming crews concentrate their long-range fire on a wounded hull instead of spreading it across the line.
      if (this.profile !== 'historical' && s.spec.faction === 'ming') score -= 180 * (1 - o.hull / o.spec.hull);
      // Boarders gang up on a ship that is already held.
      if (boardsFirst(s)) score -= 40 * Math.min(2, this.boarders.get(o.id) ?? 0);
      // Press a crew that is wavering; a running one is a prize for boarders and a waste of a gun line's time.
      if (o.moraleState === 'wavering') score -= 70;
      else if (o.moraleState === 'routing') score += boardsFirst(s) ? -80 : 60;
      if (spreadBoarders) {
        const assigned = Math.max(0, (this.boardingTargets.get(o.id) ?? 0) - (s.targetId === o.id ? 1 : 0));
        // Four crews can fight on one deck. Sending the whole navy at its bow jams the approach with friendly hulls.
        score += assigned * 25 + Math.max(0, assigned - MAX_BOARDERS + 1) * 180;
      }
      // Fast small crews hunt escorts and scouts. An isolated boat should not ignore nearby prey to climb a
      // fully manned gunship's high rail; heavy boarding ships still commit to that gun line.
      if (lightBoarder) score += clamp(o.crew / Math.max(1, s.crew) - 1, -1, 5) * 100;
      if (o.spec.kind === 'hyeopseon' && !lightBoarder) score += 120;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (spreadBoarders && best?.id !== s.targetId) {
      if (s.targetId) this.boardingTargets.set(s.targetId, Math.max(0, (this.boardingTargets.get(s.targetId) ?? 0) - 1));
      if (best) this.boardingTargets.set(best.id, (this.boardingTargets.get(best.id) ?? 0) + 1);
      this.boardingSlots.delete(s.id);
    }
    if (spreadBoarders && best && !this.boardingSlots.has(s.id)) {
      const used = [0, 0, 0, 0];
      for (const o of this.active[s.team]) if (o !== s && o.targetId === best.id) {
        const slot = this.boardingSlots.get(o.id); if (slot !== undefined) used[slot]!++;
      }
      let slot = 0;
      for (let i = 1; i < used.length; i++) if (used[i]! < used[slot]!) slot = i;
      this.boardingSlots.set(s.id, slot);
    }
    return best;
  }

  /** The nearest enemy of a ship that has seen none for a while: after dark a fleet hunts by where the enemy last was. */
  private hunted(s: Ship, boardable = false) {
    // Competitive commanders can search sea coordinates, but a lull never reveals hidden enemy coordinates.
    if (this.profile !== 'historical') return undefined;
    const since = this.searchSince.get(s.id);
    if (since === undefined) {
      this.searchSince.set(s.id, this.time);
      return undefined;
    }
    if (this.time - since < SEARCH_AFTER) return undefined;
    let best: Ship | undefined;
    let bestD = Infinity;
    for (const o of this.active[otherTeam(s.team)]) {
      if (this.maneuverRules?.hidden(o, Infinity)) continue;
      const d = hyp(o.x - s.x, o.z - s.z) + (boardable && !o.spec.boardable ? 700 : 0);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  steerTo(s: Ship, tx: number, tz: number, arrive: number, maxThrottle = 1) {
    const dx = tx - s.x;
    const dz = tz - s.z;
    const dist = hyp(dx, dz);
    const diff = wrapAngle(Math.atan2(dz, dx) - s.heading);
    s.rudder = clamp(diff * 2.4, -1, 1);
    const turnPenalty = Math.abs(diff) > 1.4 ? 0.35 : Math.abs(diff) > 0.7 ? 0.7 : 1;
    s.throttle = clamp(dist / arrive, 0, 1) * maxThrottle * turnPenalty;
    return dist;
  }

  face(s: Ship, heading: number, throttle = 0.25) {
    const diff = wrapAngle(heading - s.heading);
    s.rudder = clamp(diff * 2.8, -1, 1);
    s.throttle = Math.abs(diff) > 0.25 ? Math.max(throttle, 0.3) : throttle;
    return Math.abs(diff);
  }

  /** Records what a ship is doing, for the HUD and the camera. */
  act(s: Ship, activity: ShipActivity) {
    this.activity.set(s.id, activity);
  }

  isWater(x: number, z: number) {
    return this.land(x, z) < DRAFT - 1;
  }

  private avoidLand(s: Ship) {
    if (s.sinking > 0 || s.struck || s.order.type === 'anchor') return;
    // A crew running its ship onto a beach means to.
    if (s.moraleState === 'routing' && this.refuges.get(s.id)?.beach) return;
    const look = s.spec.length * 0.6 + 30 + Math.abs(s.speed) * 9;
    const desired = s.heading + clamp(s.rudder, -1, 1) * 0.6;
    const clear = (h: number) => {
      for (const f of [0.5, 1, 1.6]) {
        if (!this.isWater(s.x + Math.cos(h) * look * f, s.z + Math.sin(h) * look * f)) return false;
      }
      return true;
    };
    if (clear(desired)) return;
    for (const off of [0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.2, -2.2]) {
      const h = desired + off;
      if (clear(h)) {
        s.rudder = clamp(wrapAngle(h - s.heading) * 2.6, -1, 1);
        s.throttle = Math.min(s.throttle, 0.6);
        return;
      }
    }
    s.rudder = 1;
    s.throttle = 0.15;
  }

  /**
   * Steers clear of hulls in the way. `friendsOnly` lets a ship that means to close with the enemy (a breach, a chase)
   * go through it. Under the maneuver rules friends give way by the rule of the road instead of each swerving at the
   * last moment, which tangled packed fleets: a ship meeting a friend head on, or with one crossing from its starboard
   * side, turns to starboard and eases off; one overtaking slows behind the other instead of cutting across it.
   */
  avoid(s: Ship, friendsOnly = false) {
    const cos = Math.cos(s.heading);
    const sin = Math.sin(s.heading);
    const range = s.spec.length * 1.8 + 20;
    const road = !!this.depth?.maneuvers;
    this.grid.query(s.x, s.z, range + 40, (o) => {
      if (o === s || !o.alive || o.id === s.grappledWith) return;
      if (s.team !== o.team && (friendsOnly || boardsFirst(s) || s.stance === 'board' || s.stance === 'ram' || this.crippled(o))) return;
      if (road && o.team === s.team) {
        this.giveWay(s, o, cos, sin);
        return;
      }
      if (s.spec.kind === 'geobukseon' && o.team !== s.team) return;
      const dx = o.x - s.x;
      const dz = o.z - s.z;
      const r = (s.spec.length + o.spec.length) * 0.9 + 10;
      if (dx * dx + dz * dz > r * r) return;
      const lx = dx * cos + dz * sin;
      const lz = -dx * sin + dz * cos;
      if (lx < -s.spec.length * 0.3) return;
      const width = (s.spec.beam + o.spec.beam) * 0.75 + 6;
      if (Math.abs(lz) > width) return;
      const closeness = 1 - Math.min(1, Math.max(0, lx) / r);
      s.rudder = clamp(s.rudder - Math.sign(lz || 1) * 1.2 * closeness, -1, 1);
      s.throttle *= 1 - 0.6 * closeness;
    });
  }

  /** The rule of the road between two friends (the maneuver rules). */
  private giveWay(s: Ship, o: Ship, cos: number, sin: number) {
    const dx = o.x - s.x;
    const dz = o.z - s.z;
    const lx = dx * cos + dz * sin;
    const lz = -dx * sin + dz * cos;
    const reach = (s.spec.length + o.spec.length) * 0.75 + 15 + Math.max(0, s.speed) * 6;
    if (lx < -s.spec.length * 0.3 || lx > reach || Math.abs(lz) > (s.spec.beam + o.spec.beam) * 0.75 + 12) return;
    const rel = wrapAngle(o.heading - s.heading);
    const closeness = 1 - clamp(lx / reach, 0, 1);
    if (lx < s.spec.length * 0.5) {
      // Alongside: sheer off it.
      s.rudder = clamp(s.rudder - Math.sign(lz || 1) * 0.9, -1, 1);
      return;
    }
    if (Math.abs(rel) < 0.6 && o.speed > 0.5) {
      // Overtaking or following: keep station behind it.
      s.throttle = Math.min(s.throttle, clamp(o.speed / Math.max(0.1, s.spec.maxSpeed) - 0.1, 0, 1) + (1 - closeness) * 0.3);
      return;
    }
    // Positive rudder turns toward positive lz, the starboard hand here. Meeting head on, or with a friend crossing
    // from starboard, a ship turns to starboard and passes astern of it; one crossing from port holds on unless that
    // friend lies still in its way.
    if (lz >= -4 || Math.abs(rel) > 2.4 || o.speed < 0.5) {
      s.rudder = clamp(s.rudder + 1.1 * closeness, -1, 1);
      s.throttle *= 1 - 0.6 * closeness;
    }
  }

  private think(s: Ship) {
    if (s.sinking > 0 || s.struck) {
      s.throttle = 0;
      s.rudder = 0;
      this.activity.set(s.id, s.sinking > 0 ? 'sinking' : 'struck');
      return;
    }
    if (s.grappledWith || this.boarders.has(s.id)) {
      if (this.profile !== 'historical' && this.isAi(s) && boardsFirst(s)) this.boardingPlan(s, true);
      s.throttle = 0;
      s.rudder = 0;
      this.activity.set(s.id, 'boarding');
      return;
    }
    if (this.morale && s.moraleState === 'routing') {
      this.rout(s);
      return;
    }
    if (this.retreating[s.team] && s.order.type !== 'anchor') {
      this.flee(s);
      return;
    }
    if (s.moraleState === 'rallying') {
      this.regroup(s);
      return;
    }
    this.stir(s);
    this.wake(s);
    const order = s.order;
    if (order.type === 'maneuver' && this.maneuvers?.drive(s)) return;
    if (order.type === 'anchor') {
      s.throttle = 0;
      s.rudder = 0;
      this.activity.set(s.id, 'anchored');
      const enemy = this.nearestEnemy(s);
      // A fleet at anchor under a person's command only rouses itself when the enemy is on top of it.
      if (enemy && hyp(enemy.x - s.x, enemy.z - s.z) < (this.isAi(s) ? WAKE_ANCHOR : 300)) {
        s.order = { type: 'auto' };
        if (this.isAi(s)) this.raiseAlarm(s);
      }
      return;
    }
    if (order.type === 'move') {
      const d = this.steerTo(s, order.x, order.z, 60);
      this.activity.set(s.id, 'moving');
      if (d < 25) {
        s.order = s.orderQueue?.shift() ?? { type: 'hold' };
        if (!s.orderQueue?.length) s.orderQueue = undefined;
      }
      this.avoid(s);
      return;
    }
    if (order.type === 'slot' && this.maneuvers) {
      // Station keeping: stop on the station and turn there, fighting from it once the enemy is in range.
      this.maneuvers.station(s, order.x, order.z, order.face, this.maneuvers.range(s));
      return;
    }
    if (order.type === 'slot') {
      const d = this.steerTo(s, order.x, order.z, 70);
      this.activity.set(s.id, 'moving');
      if (d < 30) {
        this.face(s, order.face, 0.12);
        this.activity.set(s.id, 'engaging');
      }
      this.avoid(s);
      return;
    }
    if (order.type === 'hold') {
      s.throttle = 0;
      s.rudder = 0;
      this.activity.set(s.id, 'idle');
      return;
    }
    if (order.type === 'follow') {
      const leader = this.byId.get(order.leaderId);
      if (!this.isActive(leader) || (this.profile !== 'historical' && !this.canSee(leader, hyp(leader.x - s.x, leader.z - s.z), s.team))) {
        s.order = { type: 'hold' };
        return;
      }
      const c = Math.cos(leader.heading);
      const n = Math.sin(leader.heading);
      const tx = leader.x + c * order.dx - n * order.dz;
      const tz = leader.z + n * order.dx + c * order.dz;
      const d = hyp(tx - s.x, tz - s.z);
      if (d < 25) {
        this.face(s, leader.heading, Math.min(1, leader.speed / s.spec.maxSpeed + 0.05));
      } else {
        const ahead = Math.min(80, d);
        this.steerTo(s, tx + c * ahead * 0.4, tz + n * ahead * 0.4, 50, 1);
        s.throttle = Math.min(1, s.throttle * (0.7 + Math.min(0.6, d / 120)));
      }
      this.activity.set(s.id, 'moving');
      this.avoid(s);
      return;
    }
    if (order.type === 'broadside') {
      const target = this.byId.get(order.targetId);
      if (!this.isActive(target) || (this.profile !== 'historical' && !this.canSee(target, hyp(target.x - s.x, target.z - s.z), s.team))) {
        s.order = { type: 'hold' };
        if (this.profile !== 'historical') s.targetId = 0;
        return;
      }
      s.targetId = target.id;
      this.presentSide(s, target.x, target.z, order.side, 190);
      this.avoid(s);
      return;
    }
    if (order.type === 'bombard') {
      const range = this.profile === 'historical' ? 280 : Math.max(30, ...s.spec.batteries.map((battery) => this.gunSpec(s.spec.kind, battery.gun).range - 30));
      this.presentSide(s, order.x, order.z, this.sideToward(s, order.x, order.z), range);
      this.avoid(s);
      return;
    }
    let target: Ship | undefined;
    if (order.type === 'attack') {
      target = this.byId.get(order.targetId);
      if (!this.isActive(target) || (this.profile !== 'historical' && !this.canSee(target, hyp(target.x - s.x, target.z - s.z), s.team))) {
        s.order = { type: 'auto' };
        if (this.profile !== 'historical') s.targetId = 0;
        target = undefined;
      }
    }
    if (isUnarmed(s.spec)) this.thinkUnarmed(s);
    else if (boardsFirst(s)) this.thinkBoarder(s, target);
    else this.thinkGunner(s, target);
    this.avoid(s);
  }

  /** An unarmed boat has nothing to attack with: it runs from a close enemy, else keeps beside a friend it can tend, else waits. */
  private thinkUnarmed(s: Ship) {
    const foe = this.nearestEnemy(s, false, UNARMED_RUN);
    if (foe) {
      const away = Math.atan2(s.z - foe.z, s.x - foe.x);
      this.steerTo(s, s.x + Math.cos(away) * 200, s.z + Math.sin(away) * 200, 60, 1);
      this.activity.set(s.id, 'evading');
      return;
    }
    if (this.escortTender(s)) return;
    s.throttle = 0.12;
    s.rudder = 0;
    if (this.profile !== 'historical') s.targetId = 0;
    this.activity.set(s.id, 'idle');
  }

  /** The broadside that needs the smaller turn to bear on a point. */
  sideToward(s: Ship, x: number, z: number): Side {
    const bearing = Math.atan2(z - s.z, x - s.x);
    return Math.abs(wrapAngle(bearing + Math.PI / 2 - s.heading)) < Math.abs(wrapAngle(bearing - Math.PI / 2 - s.heading)) ? 0 : 1;
  }

  /** Lies broadside on to a point at about the given range. */
  private presentSide(s: Ship, tx: number, tz: number, side: Side, range: number) {
    const dx = tx - s.x;
    const dz = tz - s.z;
    const d = hyp(dx, dz);
    const bearing = Math.atan2(dz, dx);
    if (d > range + 110) {
      this.steerTo(s, tx, tz, 120, 1);
      this.activity.set(s.id, 'moving');
    } else {
      const heading = side === 0 ? bearing + Math.PI / 2 : bearing - Math.PI / 2;
      const drift = clamp((d - range) / 140, -0.5, 0.5) * (side === 0 ? -1 : 1) * 0.6;
      this.face(s, heading + drift, d < range * 0.63 ? 0.35 : 0.18);
      this.activity.set(s.id, 'engaging');
    }
  }

  private flee(s: Ship) {
    const away = Math.atan2(s.z - this.center.z, s.x - this.center.x);
    this.steerTo(s, s.x + Math.cos(away) * 400, s.z + Math.sin(away) * 400, 50, 1);
    this.activity.set(s.id, 'fleeing');
    this.getAway(s);
  }

  /** A fleeing ship leaves the battle once it is off the map, clear of the enemy, or has run long enough. */
  private getAway(s: Ship) {
    let since = this.fleeSince.get(s.id);
    if (since === undefined) {
      since = this.time;
      this.fleeSince.set(s.id, since);
    }
    const fled = this.time - since;
    // Under the maneuver rules a running ship is not lifted off the sea while the enemy can still reach it: it gets
    // away off the field or out of sight of every enemy, so a fleet can be run down or penned in a bay.
    const gone = this.maneuverRules ? this.clearOfEnemy(s, fled > FLEE_CLEAR ? 1500 : ESCAPE_CLEAR) : fled > FLEE_GONE || this.clearOfEnemy(s, fled > FLEE_CLEAR ? ESCAPE_NEAR : ESCAPE_CLEAR);
    if (hyp(s.x - this.center.x, s.z - this.center.z) > this.arenaRadius || gone) {
      s.alive = false;
      s.fled = true;
      this.escaped[s.team] += 1;
      this.events.push({ type: 'removed', ship: s.id });
      this.leave(s);
    }
  }

  /**
   * A routing crew runs for its refuge: its own port where the battle has ports, else its side's open water, else the
   * nearest shore when its side lies across the land, where it abandons the ship. It leaves the battle like a fleeing
   * ship unless it rallies first; at a port it waits to rally.
   */
  private rout(s: Ship) {
    const maneuvers = this.maneuvers;
    if (maneuvers && !this.rules?.refuge) {
      // Under the maneuver rules a running crew steers for the open water it can see (maneuvers.routeOf), which can
      // be the mouth of a dead-end bay; there, or aground with the enemy on it, it gives itself up.
      this.activity.set(s.id, 'fleeing');
      const run = maneuvers.routeOf(s);
      if (run.trapped || (s.aground >= ABANDON_AGROUND * 2 && !this.clearOfEnemy(s, 600))) {
        this.strike(s, this.nearestEnemy(s, false, 900)?.id ?? 0);
        return;
      }
      this.steerTo(s, run.x, run.z, 40, 1);
      this.avoid(s);
      // Inside its side's haven a crew lies up under the friendly shore instead of slipping away.
      if (!run.haven) this.getAway(s);
      return;
    }
    let r = this.refuges.get(s.id);
    // A port can change hands while a ship runs for it: the choice is looked at again now and then.
    if (!r || (r.port && this.time - r.at > REFUGE_AGAIN)) {
      r = this.findRefuge(s);
      this.refuges.set(s.id, r);
    }
    this.activity.set(s.id, 'fleeing');
    if (r.port && hyp(r.x - s.x, r.z - s.z) < 140) {
      s.throttle = 0;
      s.rudder = 0;
      return;
    }
    this.steerTo(s, r.x, r.z, 40, 1);
    if (!r.port) this.avoid(s);
    if (r.beach) {
      if (s.aground >= ABANDON_AGROUND) this.strike(s, 0);
    } else if (!r.port) this.getAway(s);
  }

  /** Where a ship that has just broken runs to. */
  private findRefuge(s: Ship) {
    const port = this.rules?.refuge?.(this, s);
    if (port) return { x: port.x, z: port.z, beach: false, port: true, at: this.time };
    const home = this.homes?.[s.team] ?? this.center;
    let ax = home.x - this.center.x;
    let az = home.z - this.center.z;
    if (hyp(ax, az) < 50) {
      ax = s.x - this.center.x;
      az = s.z - this.center.z;
    }
    const len = hyp(ax, az) || 1;
    const ux = ax / len;
    const uz = az / len;
    const shore = this.shoreBehind(s, ux, uz);
    if (shore) return { ...shore, beach: true, port: false, at: this.time };
    return { x: home.x + ux * ROUT_REACH, z: home.z + uz * ROUT_REACH, beach: false, port: false, at: this.time };
  }

  /** The nearest beach on a running ship's way home, when land closes that way off; null when open water lies behind it. */
  private shoreBehind(s: Ship, ux: number, uz: number) {
    let blocked = false;
    for (let d = 120; d <= 900 && !blocked; d += 120) blocked = this.land(s.x + ux * d, s.z + uz * d) > 0;
    if (!blocked) return null;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    const base = Math.atan2(uz, ux);
    for (let k = -4; k <= 4; k += 1) {
      const cx = Math.cos(base + k * 0.32);
      const cz = Math.sin(base + k * 0.32);
      for (let d = 80; d <= BEACH_LOOK && d < bestD; d += 70) {
        if (this.land(s.x + cx * d, s.z + cz * d) <= 0.5) continue;
        bestD = d;
        best = { x: s.x + cx * (d + 30), z: s.z + cz * (d + 30) };
      }
    }
    return best;
  }

  /** A rallying crew closes on its commander before it takes orders again. */
  private regroup(s: Ship) {
    const sq = this.squadrons[s.squadronId - 1];
    const leader = sq ? this.byId.get(sq.leaderId) : undefined;
    if (!leader || leader === s || !this.isActive(leader) || hyp(leader.x - s.x, leader.z - s.z) < 120) {
      this.face(s, s.heading, 0.2);
    } else this.steerTo(s, leader.x, leader.z, 120, 0.8);
    this.activity.set(s.id, 'moving');
    this.avoid(s);
  }

  /** A ship left the fight: sunk, taken, abandoned or fled. */
  private leave(s: Ship) {
    this.rules?.lost?.(this, s);
    this.morale?.lost(s);
    this.tactics?.forget(s.id);
    this.maneuverRules?.forget(s.id);
    this.refuges.delete(s.id);
  }

  /** Whether no enemy that is still fighting is within sight of the ship. */
  private clearOfEnemy(s: Ship, range: number) {
    for (const o of this.active[otherTeam(s.team)]) if ((o.x - s.x) ** 2 + (o.z - s.z) ** 2 < range * range) return false;
    return true;
  }

  /** A ship too short of men to hold its deck against boarders. */
  crippled(o: Ship) {
    return o.crew < o.spec.crew * FINISH_CREW;
  }

  /** Whether the ship has others of its fleet close by: closing on a beaten ship there is sailing into its friends. */
  private guarded(o: Ship) {
    let friends = 0;
    this.grid.query(o.x, o.z, FINISH_SAFE, (e) => {
      if (e !== o && e.team === o.team && this.isActive(e) && (e.x - o.x) ** 2 + (e.z - o.z) ** 2 < FINISH_SAFE * FINISH_SAFE) friends += 1;
    });
    return friends > 0;
  }

  /** The nearest beaten enemy a gunnery ship could close on and take. */
  private finishTarget(s: Ship) {
    if (s.stance === 'standoff' || s.spec.kind === 'geobukseon' || s.spec.kind === 'hyeopseon') return undefined;
    let best: Ship | undefined;
    let bestD = 320;
    this.grid.query(s.x, s.z, bestD, (o) => {
      if (o.team === s.team || !this.isActive(o) || !o.spec.boardable || !this.crippled(o)) return;
      if ((this.boarders.get(o.id) ?? 0) >= MAX_BOARDERS) return;
      const d = hyp(o.x - s.x, o.z - s.z);
      if (d < bestD && this.canSee(o, d, s.team) && !this.guarded(o)) {
        bestD = d;
        best = o;
      }
    });
    return best;
  }

  /** How much a ship has lost of hull, crew and supply, each as a share of full. A tender serves the largest first. */
  tenderNeed(o: Ship) {
    return (1 - o.hull / o.spec.hull) + (1 - o.crew / o.spec.crew) + (1 - o.supply);
  }

  /** A computer-led tender with no order keeps beside the neediest friend near it. Returns whether it did. */
  private escortTender(s: Ship) {
    if (!s.spec.tender || !this.rules?.tenders || s.order.type !== 'auto' || !this.isAi(s)) return false;
    let best: Ship | undefined;
    let bestNeed = 0.05;
    this.grid.query(s.x, s.z, TENDER_SEEK, (o) => {
      if (o === s || o.team !== s.team || !this.isActive(o) || o.spec.tender || hyp(o.x - s.x, o.z - s.z) > TENDER_SEEK) return;
      const need = this.tenderNeed(o);
      if (need > bestNeed) {
        bestNeed = need;
        best = o;
      }
    });
    if (!best) return false;
    const d = hyp(best.x - s.x, best.z - s.z);
    if (d < TENDER_STAY) this.face(s, best.heading, Math.min(1, best.speed / s.spec.maxSpeed + 0.05));
    else this.steerTo(s, best.x, best.z, TENDER_STAY * 2, 1);
    this.activity.set(s.id, 'moving');
    return true;
  }

  private thinkGunner(s: Ship, forced: Ship | undefined) {
    if (forced && this.profile !== 'historical' && !isShipVisible(this, s.team, forced.id)) forced = undefined;
    const shaken = this.shaken(s);
    let finish = forced || shaken ? undefined : this.finishTarget(s);
    const seen = forced ?? finish ?? this.nearestEnemy(s, false, Infinity, true);
    if (seen) this.searchSince.delete(s.id);
    let target = seen ?? (this.pressing(s) ? undefined : this.hunted(s));
    if (!target) {
      if (this.escortTender(s) || this.seekObjective(s)) return;
      s.throttle = 0.12;
      s.rudder = 0;
      if (this.profile !== 'historical') s.targetId = 0;
      this.activity.set(s.id, 'idle');
      return;
    }
    if (this.profile !== 'historical' && !forced && s.spec.kind !== 'geobukseon' && !this.clearFiringLane(s, target)) {
      // Islands can hide the nearest hull while another enemy is already in an open firing lane.
      // Keep that gun line instead of abandoning range to chase a target through the island.
      const range = Math.max(0, ...s.spec.batteries.map((battery) => this.gunSpec(s.spec.kind, battery.gun).range));
      let best: Ship | undefined, distance = range;
      for (const foe of this.active[otherTeam(s.team)]) {
        const d = hyp(foe.x - s.x, foe.z - s.z);
        if (d < distance && this.canSee(foe, d, s.team) && this.clearFiringLane(s, foe)) { best = foe; distance = d; }
      }
      if (best) { target = best; finish = undefined; }
    }
    s.targetId = target.id;
    const dx = target.x - s.x;
    const dz = target.z - s.z;
    const d = hyp(dx, dz);
    const bearing = Math.atan2(dz, dx);
    if (this.profile !== 'historical' && this.isAi(s) && !this.clearFiringLane(s, target)) {
      // A mountain between two gun lines is not a target. Move around it before spending a broadside.
      this.steerTo(s, target.x, target.z, 100, 1);
      this.activity.set(s.id, 'moving');
      return;
    }
    const stance = shaken ? 'standoff' : s.stance;
    const longRange = this.profile !== 'historical' && s.spec.faction === 'ming';
    const preferredRange = longRange ? Math.max(380, ...s.spec.batteries.map((battery) => this.gunSpec(s.spec.kind, battery.gun).range - 30)) : 380;
    if (stance === 'board' || stance === 'ram' || finish) {
      const lead = Math.min(3, d / 8);
      this.steerTo(s, target.x + Math.cos(target.heading) * target.speed * lead, target.z + Math.sin(target.heading) * target.speed * lead, stance === 'ram' ? 10 : 14, 1);
      this.activity.set(s.id, 'charging');
      return;
    }
    if (stance === 'standoff' || stance === 'close') {
      this.broadsideDuel(s, target, d, bearing, stance === 'close' ? 45 : longRange ? 190 : 150, stance === 'close' ? 140 : preferredRange);
      return;
    }
    if (s.spec.kind === 'geobukseon' && !shaken) {
      const timer = (this.chargeTimer.get(s.id) ?? 0) - THINK_INTERVAL;
      this.chargeTimer.set(s.id, timer);
      if (timer > 0) {
        this.steerTo(s, s.x - Math.cos(bearing) * 200, s.z - Math.sin(bearing) * 200, 80, 0.8);
        this.activity.set(s.id, 'evading');
        return;
      }
      const lead = Math.min(3, d / 8);
      this.steerTo(s, target.x + Math.cos(target.heading) * target.speed * lead, target.z + Math.sin(target.heading) * target.speed * lead, 10, 1);
      this.activity.set(s.id, 'charging');
      return;
    }
    if (s.spec.kind === 'hyeopseon') {
      if (d < 240) {
        this.steerTo(s, s.x - Math.cos(bearing) * 150, s.z - Math.sin(bearing) * 150, 60, 1);
        this.activity.set(s.id, 'evading');
      } else if (!this.escortTender(s)) {
        this.face(s, bearing + Math.PI / 2, 0.15);
        this.activity.set(s.id, 'idle');
      }
      return;
    }
    this.broadsideDuel(s, target, d, bearing, longRange ? 190 : 150, preferredRange);
  }

  broadsideDuel(s: Ship, target: Ship, d: number, bearing: number, minRange: number, maxRange: number) {
    if (d < minRange) {
      const away = bearing + Math.PI;
      const side = wrapAngle(away - s.heading) > 0 ? 1 : -1;
      const h = away - side * 0.6;
      this.steerTo(s, s.x + Math.cos(h) * 150, s.z + Math.sin(h) * 150, 60, 1);
      this.activity.set(s.id, 'evading');
    } else if (d > maxRange) {
      this.steerTo(s, target.x, target.z, 120, 1);
      this.activity.set(s.id, 'moving');
    } else {
      const a = bearing + Math.PI / 2;
      const b = bearing - Math.PI / 2;
      const h = Math.abs(wrapAngle(a - s.heading)) < Math.abs(wrapAngle(b - s.heading)) ? a : b;
      const drift = (d - (minRange + maxRange) / 2) / (maxRange - minRange);
      this.face(s, h + clamp(drift, -0.5, 0.5) * (h === a ? -1 : 1) * 0.6, this.rakeThrottle(s, target, bearing, h === b));
      this.activity.set(s.id, 'engaging');
    }
  }

  /**
   * How hard a computer gunner lying broadside on rows along its circle round the target (the depth rules): it presses
   * on toward the target's bow or stern, where its broadside rakes the length of the hull, and eases off when that lies
   * behind it. `increasing` says whether its heading carries it anticlockwise round the target.
   */
  private rakeThrottle(s: Ship, target: Ship, bearing: number, increasing: boolean) {
    if (!this.depth?.gunnery || !this.isAi(s)) return 0.3;
    const psi = wrapAngle(bearing + Math.PI - target.heading);
    // Ahead of the beam the bow line is nearer, behind it the stern line: which way round the circle brings it closer.
    const toward = Math.abs(psi) < Math.PI / 2 ? psi < 0 : psi > 0;
    return toward === increasing ? 0.45 : 0.15;
  }

  /**
   * A computer gunner shoots fire arrows at a ship lying among others of its fleet, where a fire will spread (the depth
   * rules), and goes back to its usual rounds when its target stands alone. A person's choice of rounds is left alone.
   */
  private pickAmmo(s: Ship) {
    if (!this.isAi(s) || boardsFirst(s) || !s.guns.length || (s.ammo !== 'auto' && s.ammo !== 'fire')) return;
    const target = this.byId.get(s.targetId);
    let packed = 0;
    if (target && this.isActive(target) && target.spec.boardable && (target.spec.fireResist ?? 1) >= 1) {
      this.grid.query(target.x, target.z, PACKED_RANGE, (o) => {
        if (o !== target && o.team === target.team && this.isActive(o) && (o.x - target.x) ** 2 + (o.z - target.z) ** 2 < PACKED_RANGE * PACKED_RANGE) packed += 1;
      });
    }
    s.ammo = packed >= PACKED_SHIPS ? 'fire' : 'auto';
  }

  private thinkBoarder(s: Ship, forced: Ship | undefined) {
    if (forced && this.profile !== 'historical' && !isShipVisible(this, s.team, forced.id)) forced = undefined;
    if (s.stance === 'standoff' || s.stance === 'close' || this.shaken(s)) {
      if (this.profile !== 'historical' && this.isAi(s)) this.setPlan([s.id], [...s.spec.crewPlan] as CrewPlan);
      this.thinkGunner(s, forced);
      return;
    }
    const seen = forced ?? this.nearestEnemy(s, true, Infinity, true);
    if (seen) this.searchSince.delete(s.id);
    const target = seen ?? (this.pressing(s) ? undefined : this.hunted(s, true));
    if (!target) {
      if (this.seekObjective(s)) return;
      s.throttle = 0.2;
      if (this.profile !== 'historical') s.targetId = 0;
      this.activity.set(s.id, 'idle');
      return;
    }
    s.targetId = target.id;
    if (this.profile !== 'historical' && this.isAi(s)) this.boardingPlan(s, false);
    const d = hyp(target.x - s.x, target.z - s.z);
    const lead = this.profile === 'historical' ? Math.min(4, d / Math.max(2, s.spec.maxSpeed)) : this.interceptLead(s, target);
    let tx = target.x + Math.cos(target.heading) * target.speed * lead;
    let tz = target.z + Math.sin(target.heading) * target.speed * lead;
    if ((this.profile !== 'historical' || this.depth?.gunnery) && d > 260 && d < 700) {
      // Approach both quarters instead of feeding every fast hull into the same bow-on collision.
      const index = this.squadrons[s.squadronId - 1]?.shipIds.indexOf(s.id) ?? s.id;
      const wing = (index % 2 ? 1 : -1) * Math.min(160, d * 0.24);
      const bearing = Math.atan2(target.z - s.z, target.x - s.x);
      tx += Math.sin(bearing) * wing; tz -= Math.cos(bearing) * wing;
    }
    if (this.profile !== 'historical' && this.isAi(s) && target.spec.boardable && d <= 260) {
      const slot = this.boardingSlots.get(s.id) ?? 0;
      const along = (slot < 2 ? -1 : 1) * (target.spec.length * 0.5 + s.spec.length * 0.25);
      const side = (slot % 2 ? -1 : 1) * ((target.spec.beam + s.spec.beam) * 0.5 + 5);
      // Four grappling crews need four quarters of the hull, not the same point in the middle of its deck.
      tx += Math.cos(target.heading) * along - Math.sin(target.heading) * side;
      tz += Math.sin(target.heading) * along + Math.cos(target.heading) * side;
    }
    if (!target.spec.boardable && d < (this.profile === 'historical' ? 120 : 210)) {
      if (this.profile !== 'historical' && s.guns.length) {
        // A closed turtle deck defeats grapples, not the boarder's cannons. Bring a broadside to bear.
        const bearing = Math.atan2(target.z - s.z, target.x - s.x);
        this.broadsideDuel(s, target, d, bearing, 100, 210);
        return;
      }
      const away = Math.atan2(s.z - target.z, s.x - target.x);
      this.steerTo(s, target.x + Math.cos(away + 0.9) * 150, target.z + Math.sin(away + 0.9) * 150, 60, 1);
      this.activity.set(s.id, 'evading');
      return;
    }
    this.steerTo(s, tx, tz, 8, 1);
    // The fleet closes at the pace of its big ships, the leaders waiting for the rest, and rushes in together once inside
    // RUSH_RANGE, so the boats do not arrive one at a time into the whole enemy line's fire.
    if (d > this.rushRange() && this.isAi(s) && !this.maneuverRules?.chases(s, target)) s.throttle = Math.min(s.throttle, this.fleetPace(s, target, d));
    // Ease off at the last moment so the grapple holds; the rest of the way is flat out.
    if (d < 90) {
      // The grapple tests velocity along the attacker's heading. A target moving broadside does not increase
      // the speed a boarder can safely approach at; using its full speed made fast boats overshoot every grapple.
      const drift = this.profile === 'historical' ? Math.max(0, target.speed) : target.speed * Math.cos(s.heading - target.heading);
      const maximum = s.spec.maxSpeed * (this.profile === 'historical' ? 1 : s.mods.speed);
      s.throttle = Math.min(s.throttle, Math.max(0, GRAPPLE_SPEED.japan - 1 + drift) / maximum);
    }
    this.activity.set(s.id, d < 200 ? 'charging' : 'moving');
  }

  /**
   * A computer-led ship that sees no enemy makes for what its side came to do, when the battle names it (the maneuver
   * rules): at Noryang the Japanese fleet's way west through the strait to Suncheon, into whatever waits for it in the dark.
   */
  private seekObjective(s: Ship) {
    const goal = this.objectives[s.team];
    if (!goal || !this.maneuvers || !this.isAi(s) || s.order.type !== 'auto' || this.retreating[s.team]) return false;
    if (hyp(goal.x - s.x, goal.z - s.z) < OBJECTIVE_REACHED) {
      // Through: the ship has done what it came for and is gone from the fight, like one that got away.
      s.alive = false;
      s.fled = true;
      this.escaped[s.team] += 1;
      this.events.push({ type: 'removed', ship: s.id });
      this.leave(s);
      return true;
    }
    this.steerTo(s, goal.x, goal.z, 200, Math.min(1, FLEET_PACE / s.spec.maxSpeed));
    this.avoid(s);
    this.activity.set(s.id, 'moving');
    return true;
  }

  /** Whether a computer-led ship is on its way to its side's objective, and so fights only what bars the way. */
  private pressing(s: Ship) {
    const goal = this.objectives[s.team];
    return !!goal && !!this.maneuvers && this.isAi(s) && s.order.type === 'auto' && !this.retreating[s.team] && s.moraleState === 'steady';
  }

  /** An enemy neither close aboard nor ahead across the course to the objective: a ship pressing on passes it by. */
  private offCourse(s: Ship, o: Ship) {
    const goal = this.objectives[s.team]!;
    const dx = o.x - s.x;
    const dz = o.z - s.z;
    if (dx * dx + dz * dz < PRESS_NEAR * PRESS_NEAR) return false;
    const gx = goal.x - s.x;
    const gz = goal.z - s.z;
    const gd = hyp(gx, gz) || 1;
    const along = (dx * gx + dz * gz) / gd;
    const across = Math.abs(dx * gz - dz * gx) / gd;
    return !(along > 0 && along < PRESS_AHEAD && across < PRESS_WIDE);
  }

  /** Computer boarders use the same station presets a player can select: oars on approach, fighters after grappling. */
  private boardingPlan(s: Ship, boarding: boolean) {
    const role = boarding ? 3 : 0, base = s.spec.crewPlan;
    const target = Math.min(0.85, base[role] + 0.2), rest = 1 - base[role];
    this.setPlan([s.id], base.map((v, i) => i === role ? target : v * (1 - target) / rest) as CrewPlan);
  }

  /** Lead a visible ship's current course instead of following its stern around an endless pursuit circle. */
  private interceptLead(s: Ship, target: Ship) {
    const dx = target.x - s.x, dz = target.z - s.z;
    const vx = Math.cos(target.heading) * target.speed, vz = Math.sin(target.heading) * target.speed;
    const condition = s.damageState;
    const drive = (1 - (condition?.propulsion ?? 0) * 0.55) * (1 - (condition?.flooding ?? 0) * 0.3);
    const speed = Math.max(0.5, s.spec.maxSpeed * s.mods.speed * s.speedCap * (0.3 + 0.7 * this.rowing(s)) * (1 - s.fire * 0.35) * drive);
    const a = vx * vx + vz * vz - speed * speed, b = 2 * (dx * vx + dz * vz), c = dx * dx + dz * dz;
    let time = Infinity;
    if (Math.abs(a) < 1e-9) { if (b < 0) time = -c / b; }
    else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) for (const t of [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]) if (t > 0) time = Math.min(time, t);
    }
    return Number.isFinite(time) ? Math.min(25, time) : Math.min(4, Math.sqrt(c) / speed);
  }

  /** How near its enemy a boarding fleet goes flat out together: farther in the capture-point battles' open water. */
  private rushRange() {
    return this.profile === 'historical' ? RUSH_RANGE : 650;
  }

  /** Throttle that keeps a boarding ship level with the other boarders near it on the way to the same enemy. */
  private fleetPace(s: Ship, target: Ship, d: number) {
    let n = 0;
    let sum = 0;
    let squares = 0;
    this.grid.query(s.x, s.z, FLEET_REACH, (o) => {
      if (o === s || o.team !== s.team || !boardsFirst(o) || o.grappledWith || !this.isActive(o)) return;
      // Only AI boarders under way for the same enemy set the pace; held, anchored, human-led or stuck ships never stall the rest.
      if (!this.isAi(o) || o.order.type !== 'auto' || o.targetId !== target.id || o.speed < 0.5) return;
      if ((o.x - s.x) ** 2 + (o.z - s.z) ** 2 > FLEET_REACH * FLEET_REACH) return;
      const away = hyp(o.x - target.x, o.z - target.z);
      sum += away;
      squares += away * away;
      n += 1;
    });
    const ahead = n ? sum / n - d : 0;
    // Under the maneuver rules a ship waits only when it is ahead of the pack's body, not merely of its middle: half of
    // a big fleet was always ahead of the middle and the whole of it crawled toward the enemy.
    const slack = this.depth?.maneuvers && n ? Math.max(FLEET_SLACK, Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2))) : FLEET_SLACK;
    if (ahead <= slack) this.paceWait.delete(s.id);
    if (ahead > slack && this.lull < STALL_AI) {
      // The others may be held up for good, on a shoal or behind a wreck: after a while a boarder goes in without them.
      const w = this.paceWait.get(s.id) ?? { wait: 0, until: 0 };
      if (this.time < w.until) return 1;
      w.wait += THINK_INTERVAL;
      if (w.wait > PACE_PATIENCE) {
        w.wait = 0;
        w.until = this.time + PACE_FREE;
      }
      this.paceWait.set(s.id, w);
      return 0.15;
    }
    return ahead < -slack ? 1 : FLEET_PACE / s.spec.maxSpeed;
  }

  /** Rowers at their oars against the ship's usual complement. Above 1 with extra hands on the oars. */
  rowing(s: Ship) {
    const need = s.spec.crew * s.spec.crewPlan[0];
    return need > 0 ? clamp(s.roles[0] / need, 0, 1.2) : s.crew / s.spec.crew;
  }

  /** Gun crews against the usual complement. */
  gunnery(s: Ship) {
    const need = s.spec.crew * s.spec.crewPlan[1];
    return need > 0 ? clamp(s.roles[1] / need, 0, 1.3) : 0;
  }

  /** Archers or arquebusiers against the usual complement. */
  musketry(s: Ship) {
    const need = s.spec.crew * s.spec.crewPlan[2];
    return need > 0 ? clamp(s.roles[2] / need, 0, 1.4) : 0;
  }

  /** Fighting strength on deck, scaled so that a full crew on its usual plan counts as its crew. */
  meleeStrength(s: Ship) {
    let have = 0;
    let base = 0;
    for (let i = 0; i < 4; i += 1) {
      have += s.roles[i]! * MELEE_WEIGHT[i]!;
      base += s.spec.crewPlan[i]! * MELEE_WEIGHT[i]!;
    }
    return base > 0 ? have / base : s.crew;
  }

  private move(s: Ship, dt: number) {
    const spec = s.spec;
    const crewFactor = 0.3 + 0.7 * this.rowing(s);
    const sinkingFactor = s.sinking > 0 || s.struck ? 0 : 1;
    const anchored = s.order.type === 'anchor' ? 0 : 1;
    const condition = this.profile === 'historical' ? undefined : s.damageState;
    const drive = (1 - (condition?.propulsion ?? 0) * 0.55) * (1 - (condition?.flooding ?? 0) * 0.3);
    // A ship holding its place in a column rows in its leader's wake (the depth rules).
    const wake = s.order.type === 'follow' && this.tactics?.cohesive.has(s.id) ? WAKE_SPEED : 1;
    const target = s.throttle * s.speedCap * spec.maxSpeed * s.mods.speed * crewFactor * (1 - s.fire * 0.35) * sinkingFactor * anchored * drive * wake;
    const rate = target > s.speed ? spec.accel : spec.accel * 1.6;
    s.speed += clamp(target - s.speed, -rate * dt, rate * dt);
    if (s.grappledWith || this.boarders.has(s.id)) s.speed *= Math.max(0, 1 - dt * 1.5);
    const steer = 0.4 + 0.6 * Math.min(1, Math.abs(s.speed) / spec.maxSpeed);
    const desiredTurn = s.rudder * spec.turnRate * s.mods.turn * steer * Math.min(1, crewFactor) * sinkingFactor * anchored * (1 - (condition?.steering ?? 0) * 0.7);
    s.turn += (desiredTurn - s.turn) * Math.min(1, dt * 1.4);
    s.heading = wrapAngle(s.heading + s.turn * dt);
    // A ship holding a station rows against the wind and the stream as one at anchor rides them out.
    const holding = this.maneuverRules?.holding(s) ?? false;
    const drift = anchored ? this.windDrift * (holding ? 0.3 : 1) : 0;
    const flow = this.flow ? this.flow.velocity(s.x, s.z, this.tide) : this.current;
    const set = s.order.type === 'anchor' || holding ? 0.15 : 1;
    const nx = s.x + Math.cos(s.heading) * s.speed * dt + (Math.cos(this.windAngle) * drift + flow.x * set) * dt;
    const nz = s.z + Math.sin(s.heading) * s.speed * dt + (Math.sin(this.windAngle) * drift + flow.z * set) * dt;
    if (this.flow && (flow.x || flow.z)) {
      const cross = Math.cos(s.heading) * flow.z - Math.sin(s.heading) * flow.x;
      s.heading = wrapAngle(s.heading + cross * dt * 0.012 * (40 / s.spec.length));
    }
    const bowX = nx + Math.cos(s.heading) * spec.length * 0.45;
    const bowZ = nz + Math.sin(s.heading) * spec.length * 0.45;
    if (this.land(bowX, bowZ) > DRAFT || this.land(nx, nz) > DRAFT) {
      s.speed *= -0.2;
      s.aground = Math.min(5, s.aground + dt);
      const e = 6;
      const gx = this.land(s.x + e, s.z) - this.land(s.x - e, s.z);
      const gz = this.land(s.x, s.z + e) - this.land(s.x, s.z - e);
      const g = hyp(gx, gz) || 1;
      s.x -= (gx / g) * dt * 3;
      s.z -= (gz / g) * dt * 3;
    } else {
      s.x = nx;
      s.z = nz;
      s.aground = Math.max(0, s.aground - dt);
    }
    if (s.sinking > 0) {
      s.sinking = Math.min(1, s.sinking + dt / SINK_DURATION);
      if (s.sinking >= 1) {
        s.alive = false;
        this.events.push({ type: 'removed', ship: s.id });
      }
    }
  }

  private circles(s: Ship, out: number[]) {
    const r = s.spec.beam * 0.5;
    const half = s.spec.length * 0.5 - r;
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    out.length = 0;
    for (let i = -1; i <= 1; i += 1) out.push(s.x + c * half * i, s.z + n * half * i, r);
    return out;
  }

  private collide(dt: number) {
    const ca: number[] = [];
    const cb: number[] = [];
    for (const a of this.ships) {
      if (!a.alive) continue;
      this.grid.query(a.x, a.z, a.spec.length + 25, (b) => {
        if (b.id <= a.id || !b.alive) return;
        const reach = (a.spec.length + b.spec.length) * 0.5;
        const dx0 = b.x - a.x;
        const dz0 = b.z - a.z;
        if (dx0 * dx0 + dz0 * dz0 > reach * reach) return;
        this.circles(a, ca);
        this.circles(b, cb);
        let bestPen = -Infinity;
        let nx = 0;
        let nz = 0;
        let px = 0;
        let pz = 0;
        for (let p = 0; p < 9; p += 3) {
          for (let q = 0; q < 9; q += 3) {
            const dx = cb[q]! - ca[p]!;
            const dz = cb[q + 1]! - ca[p + 1]!;
            const d = hyp(dx, dz) || 0.001;
            const pen = ca[p + 2]! + cb[q + 2]! - d;
            if (pen > bestPen) {
              bestPen = pen;
              nx = dx / d;
              nz = dz / d;
              px = (ca[p]! + cb[q]!) * 0.5;
              pz = (ca[p + 1]! + cb[q + 1]!) * 0.5;
            }
          }
        }
        if (bestPen <= 0) {
          if (bestPen > -3) this.tryGrapple(a, b);
          return;
        }
        const ma = a.spec.length * a.spec.beam;
        const mb = b.spec.length * b.spec.beam;
        const wa = mb / (ma + mb);
        const wb = ma / (ma + mb);
        a.x -= nx * bestPen * wa;
        a.z -= nz * bestPen * wa;
        b.x += nx * bestPen * wb;
        b.z += nz * bestPen * wb;
        const vax = Math.cos(a.heading) * a.speed;
        const vaz = Math.sin(a.heading) * a.speed;
        const vbx = Math.cos(b.heading) * b.speed;
        const vbz = Math.sin(b.heading) * b.speed;
        const closing = (vax - vbx) * nx + (vaz - vbz) * nz;
        const ramHit = this.profile === 'historical' ? a.lastHit : Math.max(a.lastHit, b.lastHit);
        if (closing > 1.2 && a.team !== b.team && this.time - ramHit > 0.5) {
          const aHits = Math.max(0, vax * nx + vaz * nz);
          const bHits = Math.max(0, -(vbx * nx + vbz * nz));
          const toB = aHits * a.spec.ramPower * 5 * (1 - b.spec.armor);
          const toA = bHits * b.spec.ramPower * 5 * (1 - a.spec.armor);
          const bClosing = this.profile === 'historical' ? 1.5 : b.spec.kind === 'geobukseon' ? 0.3 : 1.2;
          const damageB = toB + closing * bClosing;
          const damageA = toA + closing * (a.spec.kind === 'geobukseon' ? 0.3 : 1.2);
          this.damage(b, damageB, a);
          this.damage(a, damageA, b);
          this.impactDamage(b, damageB, -nx, -nz);
          this.impactDamage(a, damageA, nx, nz);
          this.casualties(b, toB * 0.4, 'hull', false);
          if (this.profile !== 'historical') this.casualties(a, toA * 0.4, 'hull', false);
          a.lastHit = this.time;
          b.lastHit = this.time;
          this.blow();
          this.events.push({ type: 'ram', a: a.id, b: b.id, x: px, z: pz, power: closing });
          if (a.spec.kind === 'geobukseon') this.chargeTimer.set(a.id, 9);
          if (b.spec.kind === 'geobukseon') this.chargeTimer.set(b.id, 9);
        }
        // Under the maneuver rules friends brushing past each other keep their way, as in the competitive rules: a
        // fleet packed hull to hull otherwise stopped dead and held back every ship pacing itself on it.
        if (this.profile === 'historical' && !(this.depth?.maneuvers && a.team === b.team)) {
          a.speed *= Math.max(0, 1 - dt * 2.5);
          b.speed *= Math.max(0, 1 - dt * 2.5);
        } else if (closing > 0) {
          // Contact removes closing motion, not travel along the neighbouring hull. Multiplying both total speeds
          // on every contact stopped parallel friendly columns and even slowed ships already separating.
          a.speed -= closing * wa * (Math.cos(a.heading) * nx + Math.sin(a.heading) * nz);
          b.speed += closing * wb * (Math.cos(b.heading) * nx + Math.sin(b.heading) * nz);
        }
        this.tryGrapple(a, b);
      });
    }
  }

  private wantsBoard(s: Ship, other: Ship) {
    if (isUnarmed(s.spec) || this.hesitant(s)) return false;
    if (boardsFirst(s)) return s.stance !== 'standoff' && s.stance !== 'close';
    return s.stance === 'board' || (s.stance !== 'standoff' && s.spec.kind !== 'geobukseon' && this.crippled(other));
  }

  /** A direction that can hold a grapple, without choosing a crew or rolling a repulsion. */
  private eligibleGrapple(attacker: Ship, defender: Ship, gap?: number) {
    if (attacker.team === defender.team || !this.isActive(attacker) || !this.isActive(defender) || attacker.grappledWith || defender.grappledWith === attacker.id) return false;
    if (!this.wantsBoard(attacker, defender) || !defender.spec.boardable || this.grappleLocked(attacker, defender.id) || (this.boarders.get(defender.id) ?? 0) >= MAX_BOARDERS) return false;
    const boarder = boardsFirst(attacker);
    if (gap !== undefined && gap >= (boarder ? GRAPPLE_REACH.japan : GRAPPLE_REACH.other)) return false;
    const relative = Math.abs(attacker.speed - defender.speed * Math.cos(attacker.heading - defender.heading));
    return relative <= (boarder ? GRAPPLE_SPEED.japan : GRAPPLE_SPEED.other);
  }

  /** Smallest gap between the two hulls, from their three-circle outlines. Negative when they overlap. */
  private hullGap(a: Ship, b: Ship) {
    const ca = this.circles(a, this.gapA);
    const cb = this.circles(b, this.gapB);
    let gap = Infinity;
    for (let p = 0; p < 9; p += 3) {
      for (let q = 0; q < 9; q += 3) {
        const g = hyp(cb[q]! - ca[p]!, cb[q + 1]! - ca[p + 1]!) - ca[p + 2]! - cb[q + 2]!;
        if (g < gap) gap = g;
      }
    }
    return gap;
  }

  /** Boarders throw their grapples from a few metres off: no collision needed. */
  private reachGrapples() {
    for (const s of this.ships) {
      if (!s.alive || s.grappledWith || !boardsFirst(s) || !this.isActive(s) || s.stance === 'standoff' || s.stance === 'close' || this.hesitant(s)) continue;
      let best: Ship | undefined;
      let bestGap = GRAPPLE_REACH.japan;
      this.grid.query(s.x, s.z, s.spec.length * 0.5 + GRAPPLE_REACH.japan + 24, (o) => {
        if (o.team === s.team || !this.isActive(o)) return;
        if (this.profile === 'historical' && (!o.spec.boardable || this.grappleLocked(s, o.id))) return;
        const gap = this.hullGap(s, o);
        if (this.profile !== 'historical' && !this.eligibleGrapple(s, o, gap) && !this.eligibleGrapple(o, s, gap)) return;
        if (gap < bestGap) {
          bestGap = gap;
          best = o;
        }
      });
      if (best) this.tryGrapple(s, best, bestGap);
    }
  }

  private tryGrapple(a: Ship, b: Ship, gap?: number) {
    if (a.team === b.team) return;
    if (a.grappledWith === b.id || b.grappledWith === a.id) return;
    let aWants = this.wantsBoard(a, b) && !a.grappledWith && !this.grappleLocked(a, b.id);
    let bWants = this.wantsBoard(b, a) && !b.grappledWith && !this.grappleLocked(b, a.id);
    if (!aWants && !bWants) return;
    if (this.profile !== 'historical') {
      const aEligible = this.eligibleGrapple(a, b, gap), bEligible = this.eligibleGrapple(b, a, gap);
      // Prefer a direction with space and safe speed. With neither available, retain contact's existing
      // rejection path, including the casualties at a closed deck or a repelling crew.
      if (aEligible || bEligible) { aWants = aEligible; bWants = bEligible; }
    }
    // When both crews want to board, either may throw the first grapple.
    const attacker = aWants && bWants ? (this.rand() < 0.5 ? a : b) : aWants ? a : b;
    const defender = attacker === a ? b : a;
    if (!this.isActive(attacker) || !this.isActive(defender)) return;
    if (attacker.grappledWith) return;
    if (defender.repel && this.rand() < 0.55) {
      if (this.time - attacker.lastHit > 1.2) {
        attacker.lastHit = this.time;
        this.casualties(attacker, 2, 'melee', false);
        this.events.push({ type: 'repelled', a: attacker.id, b: defender.id });
      }
      return;
    }
    if (!defender.spec.boardable) {
      if (this.time - attacker.lastHit > 1.5) {
        this.casualties(attacker, 3, 'melee', true);
        attacker.lastHit = this.time;
      }
      return;
    }
    if ((this.boarders.get(defender.id) ?? 0) >= MAX_BOARDERS) return;
    const rel = Math.abs(attacker.speed - defender.speed * Math.cos(attacker.heading - defender.heading));
    if (rel > (boardsFirst(attacker) ? GRAPPLE_SPEED.japan : GRAPPLE_SPEED.other)) return;
    attacker.grappledWith = defender.id;
    attacker.grappleTime = 0;
    this.boarders.set(defender.id, (this.boarders.get(defender.id) ?? 0) + 1);
    this.blow();
    this.events.push({ type: 'board', a: attacker.id, b: defender.id });
  }

  private blow() {
    this.lastBlow = this.time;
    this.blows += 1;
  }

  /**
   * What a ship's deck is worth in a melee: the fighting crew, with the soldiers aboard counting several times over,
   * both in proportion to the men still alive.
   */
  boardStrength(s: Ship) {
    return this.meleeStrength(s) + s.spec.soldiers * SOLDIER_WEIGHT * (s.crew / s.spec.crew);
  }

  /**
   * Deck fights. The boarders of one ship fight together: their combined strength cuts down the defenders, and the
   * defenders' strength is spread over the boarders in proportion to theirs. Numbers count twice (Lanchester's square
   * law), so a swarm of small boats can take a big ship that would beat any one of them.
   */
  private resolveBoarding(dt: number) {
    this.boarders.clear();
    const fights = new Map<number, Ship[]>();
    for (const s of this.ships) {
      if (!s.grappledWith) continue;
      const d = this.byId.get(s.grappledWith);
      if (!this.isActive(s) || !this.isActive(d)) {
        s.grappledWith = 0;
        continue;
      }
      s.grappleTime += dt;
      const gap = this.hullGap(s, d);
      if (gap > GRAPPLE_SLACK) {
        s.grappledWith = 0;
        continue;
      }
      if (d.repel && this.rand() < dt * 0.14) {
        this.lockGrapple(s, d.id);
        s.grappledWith = 0;
        this.events.push({ type: 'repelled', a: s.id, b: d.id });
        continue;
      }
      // The grapple lines haul the two hulls together.
      if (gap > 1.5) {
        const dx = d.x - s.x;
        const dz = d.z - s.z;
        const len = hyp(dx, dz) || 1;
        const pull = Math.min(gap - 1, 2 * dt);
        s.x += (dx / len) * pull;
        s.z += (dz / len) * pull;
      }
      const list = fights.get(d.id);
      if (list) list.push(s);
      else fights.set(d.id, [s]);
      this.boarders.set(d.id, (this.boarders.get(d.id) ?? 0) + 1);
    }
    for (const [id, attackers] of fights) {
      const d = this.byId.get(id)!;
      const power = attackers.map((a) => {
        const shock = 1 + SHOCK_BONUS * Math.max(0, 1 - a.grappleTime / SHOCK_TIME);
        return this.boardStrength(a) * a.spec.melee * a.mods.melee * shock;
      });
      const total = power.reduce((sum, v) => sum + v, 0);
      const deck = attackers.reduce((sum, a) => sum + a.spec.deck, 0) / attackers.length;
      // Looking down from a high deck on men climbing up from a low one is worth something.
      const height = clamp(1 + 0.05 * (d.spec.deck - deck), 0.85, 1.25);
      const parapet = 1 + (d.spec.deckDefense - 1) * PARAPET_SHARE;
      const def = this.boardStrength(d) * d.spec.melee * parapet * height * d.mods.defense * (d.repel ? 1.3 : 1);
      this.casualties(d, total * MELEE_RATE * dt * (0.6 + this.rand() * 0.8), 'melee', true);
      attackers.forEach((a, i) => this.casualties(a, def * (power[i]! / Math.max(1e-6, total)) * MELEE_RATE * dt * (0.6 + this.rand() * 0.8), 'melee', true));
      // Taken when its crew is cut down, or under the depth rules when what is left of it loses heart.
      if (d.crew < d.spec.crew * CAPTURE_CREW || (this.morale && d.morale < SURRENDER)) {
        let top = 0;
        power.forEach((v, i) => {
          if (v > power[top]!) top = i;
        });
        const victor = attackers[top]!;
        victor.kills += 1;
        for (const a of attackers) a.grappledWith = 0;
        this.strike(d, victor.id);
        this.morale?.prize(victor);
        d.fire = Math.max(d.fire, 0.5);
        continue;
      }
      for (const a of attackers) {
        if (a.crew < a.spec.crew * 0.12) {
          a.grappledWith = 0;
          this.strike(a, d.id);
        }
      }
    }
  }

  /** The ship is taken or abandoned: it stops fighting and drifts, burning. `by` is the ship that took it, 0 when none did. */
  private strike(s: Ship, by = 0) {
    if (s.struck) return;
    s.struck = true;
    this.events.push({ type: 'struck', ship: s.id, by });
    this.leave(s);
  }

  /**
   * Kills crew, spread over the stations by how exposed each is to this kind of harm. Returns the whole men lost and
   * reports them as a casualty event.
   */
  casualties(s: Ship, amount: number, exposure: Exposure, melee: boolean) {
    if (!(amount > 0) || s.crew <= 0) return 0;
    const before = Math.floor(s.crew);
    let left = Math.min(amount, s.crew);
    for (let pass = 0; pass < 2 && left > 1e-6; pass += 1) {
      const w = pass === 0 ? EXPOSURE[exposure] : EXPOSURE.all;
      let total = 0;
      for (let i = 0; i < 4; i += 1) total += s.roles[i]! * w[i]!;
      if (total <= 0) continue;
      let taken = 0;
      for (let i = 0; i < 4; i += 1) {
        const loss = Math.min(s.roles[i]!, (left * s.roles[i]! * w[i]!) / total);
        s.roles[i] = s.roles[i]! - loss;
        taken += loss;
      }
      left -= taken;
    }
    s.crew = s.roles[0] + s.roles[1] + s.roles[2] + s.roles[3];
    const killed = before - Math.floor(s.crew);
    if (killed > 0 && melee) this.blow();
    if (killed > 0) this.events.push({ type: 'casualty', ship: s.id, count: killed, melee });
    return killed;
  }

  /** Men climb between decks toward the station plan. */
  private reassign(s: Ship, dt: number) {
    if (s.crew <= 0) return;
    const k = Math.min(1, dt * REASSIGN_RATE);
    for (let i = 0; i < 4; i += 1) s.roles[i] = s.roles[i]! + (s.crew * s.plan[i]! - s.roles[i]!) * k;
    s.crew = s.roles[0] + s.roles[1] + s.roles[2] + s.roles[3];
  }

  /** How far a ship's guns reach with the rounds it is loading, as a share of their range. */
  rangeFactor(s: Ship) {
    return s.ammo === 'crew' ? 0.72 : s.ammo === 'fire' ? 0.85 : 1;
  }

  private weapons(s: Ship, dt: number) {
    if (!this.isActive(s)) return;
    // A shaken crew loads slower; a running one leaves its guns.
    const nerve = this.morale?.steadiness(s) ?? 1;
    if (nerve <= 0) return;
    const crewFactor = 0.25 + 0.75 * this.gunnery(s);
    const spec = s.spec;
    // Each side's target, looked for once per step (null: not yet). The arrays live on the battle: two new ones per ship
    // per step were over a thousand objects a step in a big battle.
    const targets = this.sideTargets;
    const volleyTargets = this.volleyTargets;
    targets[0] = targets[1] = targets[2] = null;
    volleyTargets[0] = volleyTargets[1] = volleyTargets[2] = null;
    const volleying = s.volleySide >= 0 && s.volleyTimer > 0;
    let volleyCount = 0;
    if (s.volleyTimer > 0) {
      s.volleyTimer -= dt;
      if (s.volleyTimer <= 0) s.volleySide = -1;
    }
    const rangeMul = this.rangeFactor(s);
    for (const g of s.guns) {
      if (g.ammo < 1 - 1e-9) continue;
      const battery = spec.batteries[g.battery]!;
      const gun = this.gunSpec(spec.kind, battery.gun);
      const range = gun.range * rangeMul;
      if (g.stage < 4) {
        g.t += dt * crewFactor * s.mods.reload * nerve;
        const need = gun.stages[g.stage]!;
        if (g.t >= need) {
          g.t -= need;
          g.stage += 1;
        }
        continue;
      }
      if (g.stage === 4) {
        const sideIndex = g.side === 2 ? 2 : g.side;
        if (volleying && (s.volleySide === sideIndex || (s.volleySide === 3 && sideIndex !== 2))) {
          if (volleyTargets[sideIndex] === null) volleyTargets[sideIndex] = g.side === 2 ? this.findBowTarget(s, range * 1.15) : this.findBroadsideTarget(s, g.side, range * 1.15);
          const vt = volleyTargets[sideIndex];
          g.stage = 5;
          g.t = 0;
          g.fireDelay = 0.04 + this.rand() * 0.5;
          g.target = vt ? vt.id : -1;
          volleyCount += 1;
          continue;
        }
        if (s.fireMode === 'hold') continue;
        if (targets[sideIndex] === null) targets[sideIndex] = g.side === 2 ? this.findBowTarget(s, range) : this.findBroadsideTarget(s, g.side, range);
        const target = targets[sideIndex];
        if (!target) {
          if (s.order.type === 'bombard' && this.bombardBearing(s, g.side, range)) {
            g.stage = 5;
            g.t = 0;
            g.fireDelay = gun.stages[5]! * (0.6 + this.rand() * 0.9);
            g.target = -2;
          }
          continue;
        }
        if (hyp(target.x - s.x, target.z - s.z) > range) continue;
        g.stage = 5;
        g.t = 0;
        g.fireDelay = gun.stages[5]! * (0.6 + this.rand() * 0.9);
        g.target = target.id;
        continue;
      }
      g.t += dt;
      if (g.t >= g.fireDelay) {
        this.fireGun(s, g, g.target ?? 0);
        g.stage = 0;
        g.t = 0;
      }
    }
    if (volleyCount > 0) {
      this.events.push({ type: 'volley', ship: s.id, side: s.volleySide, count: volleyCount });
      if (s.volleySide !== 3) {
        s.volleySide = -1;
        s.volleyTimer = 0;
      }
    }
    if (spec.musketRange > 0) this.smallArms(s, dt, nerve);
  }

  private smallArms(s: Ship, dt: number, nerve: number) {
    const spec = s.spec;
    const strength = this.musketry(s);
    if (strength <= 0.02) return;
    s.musketReload = Math.max(0, s.musketReload - dt * (0.5 + 0.5 * Math.min(1, strength)) * s.mods.reload * nerve);
    if (s.musketReload > 0) return;
    let target: Ship | undefined;
    let best = spec.musketRange;
    this.teamGrids[otherTeam(s.team)].query(s.x, s.z, spec.musketRange, (o) => {
      if (!this.isActive(o)) return;
      const d = hyp(o.x - s.x, o.z - s.z);
      if (!this.canSee(o, d, s.team)) return;
      if (d < best) {
        best = d;
        target = o;
      }
    });
    if (!target) return;
    const t = target as Ship;
    const accuracy = (1 - (best / spec.musketRange) * 0.6) * s.mods.accuracy * nerve;
    const close = best < CLOSE_RANGE && boardsFirst(s);
    const loss = (spec.musketPower * strength * (2.5 + this.rand() * 4) * accuracy * (close ? CLOSE_LOSS : 1)) / t.spec.deckDefense;
    this.casualties(t, loss, 'deck', false);
    const dx = (t.x - s.x) / best;
    const dz = (t.z - s.z) / best;
    const shooters = Math.max(1, Math.round((s.roles[2] / Math.max(1, spec.crew * spec.crewPlan[2])) * (s.spec.kind === 'atakebune' ? 10 : spec.length > 30 ? 7 : spec.length > 20 ? 5 : 3)));
    this.events.push({ type: 'musket', ship: s.id, x: s.x, y: spec.deck + 1, z: s.z, dx, dz, count: shooters, arms: spec.arms });
    if (best < 95 && t.spec.boardable && this.rand() < (spec.arms === 'bow' ? 0.035 : 0.06)) this.ignite(t, 0.18);
    s.musketReload = close ? CLOSE_RELOAD + this.rand() * 0.9 : (spec.arms === 'bow' ? 2.6 : 3.2) + this.rand() * 1.5;
    if (t.crew < t.spec.crew * 0.04) this.strike(t, s.id);
  }

  /** Whether the bombard point lies off this side and within range. */
  private bombardBearing(s: Ship, side: Side | 2, range: number) {
    const o = s.order;
    if (o.type !== 'bombard') return false;
    const dx = o.x - s.x;
    const dz = o.z - s.z;
    const d = hyp(dx, dz);
    if (d > range || d < 8) return false;
    if (side === 2) return (dx * Math.cos(s.heading) + dz * Math.sin(s.heading)) / d > Math.cos(0.35);
    const sx = side === 0 ? Math.sin(s.heading) : -Math.sin(s.heading);
    const sz = side === 0 ? -Math.cos(s.heading) : Math.cos(s.heading);
    return (dx * sx + dz * sz) / d > Math.cos(0.75);
  }

  private findBroadsideTarget(s: Ship, side: Side, range: number) {
    const sx = side === 0 ? Math.sin(s.heading) : -Math.sin(s.heading);
    const sz = side === 0 ? -Math.cos(s.heading) : Math.cos(s.heading);
    let best: Ship | undefined;
    let bestScore = Infinity;
    const cosArc = Math.cos(0.75);
    this.teamGrids[otherTeam(s.team)].query(s.x, s.z, range, (o) => {
      if (!this.isActive(o)) return;
      const dx = o.x - s.x;
      const dz = o.z - s.z;
      const d = hyp(dx, dz);
      if (d > range || d < 8) return;
      if (!this.canSee(o, d, s.team)) return;
      if (this.profile !== 'historical' && !this.clearFiringLane(s, o)) return;
      const c = (dx * sx + dz * sz) / d;
      if (c < cosArc) return;
      // Under the maneuver rules a gun is not fired through a friend's hull.
      if (this.maneuverRules && !this.maneuverRules.clear(s, o)) return;
      const focus = this.profile !== 'historical' && s.spec.faction === 'ming' ? 180 * (1 - o.hull / o.spec.hull) : 0;
      const score = d - (o.id === s.targetId ? 80 : 0) - c * 40 - focus;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    });
    return best;
  }

  private findBowTarget(s: Ship, range: number) {
    const fx = Math.cos(s.heading);
    const fz = Math.sin(s.heading);
    let best: Ship | undefined;
    let bestD = Infinity;
    this.teamGrids[otherTeam(s.team)].query(s.x, s.z, range, (o) => {
      if (!this.isActive(o)) return;
      const dx = o.x - s.x;
      const dz = o.z - s.z;
      const d = hyp(dx, dz);
      if (d > range) return;
      if (!this.canSee(o, d, s.team)) return;
      if (this.profile !== 'historical' && !this.clearFiringLane(s, o)) return;
      if ((dx * fx + dz * fz) / d < Math.cos(0.35)) return;
      if (this.maneuverRules && !this.maneuverRules.clear(s, o)) return;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    });
    return best;
  }

  /** Approximate the low ballistic arc before aiming through an island; cached for one fifth of a second. */
  private clearFiringLane(s: Ship, target: Ship) {
    const tick = Math.floor(this.time * 5);
    if (tick !== this.firingLaneAt) { this.firingLanes.clear(); this.firingLaneAt = tick; }
    const key = s.id * 1048576 + target.id;
    const previous = this.firingLanes.get(key);
    if (previous !== undefined) return previous;
    const distance = hyp(target.x - s.x, target.z - s.z);
    let muzzle = this.muzzles.get(s.spec);
    if (muzzle === undefined) {
      muzzle = Math.max(120, ...s.spec.batteries.map((b) => this.gunSpec(s.spec.kind, b.gun).muzzle));
      this.muzzles.set(s.spec, muzzle);
    }
    const samples = Math.max(2, Math.ceil(distance / 65));
    let clear = true;
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      const height = (1 - t) * (s.spec.deck * 0.6 + 1) + t * target.spec.deck * 0.6 + GRAVITY * distance * distance / (2 * muzzle * muzzle) * t * (1 - t);
      if (this.land(s.x + (target.x - s.x) * t, s.z + (target.z - s.z) * t) > height + 2) { clear = false; break; }
    }
    this.firingLanes.set(key, clear);
    return clear;
  }

  /**
   * Where a gun's shot leaves the ship. Ships with modelled gun ports (ships/anchors.ts, the same data the 3D model is
   * built from) fire from the port itself; the others from a point scaled from the spec.
   */
  muzzle(s: Ship, side: Side | 2, slot: number, count: number) {
    const spec = s.spec;
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    const anchors = anchorsFor(`${spec.kind}#${s.variant}`) ?? anchorsFor(`${spec.kind}#0`);
    const port = anchors?.gunPorts.find((g) => g.side === side && g.index === slot);
    if (port) {
      // Ship space has +X forward and +Z across the beam; the shot starts a little past the muzzle of the carriage gun.
      const out = 0.9 * anchorScale(spec.kind);
      const lx = port.pos[0] + port.dir[0] * out;
      const lz = port.pos[2] + port.dir[2] * out;
      return { x: s.x + c * lx - n * lz, y: port.pos[1], z: s.z + n * lx + c * lz, dx: c * port.dir[0] - n * port.dir[2], dz: n * port.dir[0] + c * port.dir[2] };
    }
    if (side === 2) {
      const f = spec.length * 0.5 + 0.5;
      return { x: s.x + c * f, y: spec.deck * 0.75, z: s.z + n * f, dx: c, dz: n };
    }
    const along = count <= 1 ? 0 : (slot / (count - 1) - 0.5) * spec.length * 0.66;
    const sx = side === 0 ? n : -n;
    const sz = side === 0 ? -c : c;
    const out = spec.beam * 0.5 + 0.4;
    return { x: s.x + c * along + sx * out, y: spec.deck * 0.6, z: s.z + n * along + sz * out, dx: sx, dz: sz };
  }

  private fireGun(s: Ship, g: GunState, targetId: number) {
    const target = targetId > 0 ? this.byId.get(targetId) : undefined;
    const blind = targetId < 0;
    if (!blind && !this.isActive(target)) return;
    if (target && this.profile !== 'historical' && !isShipVisible(this, s.team, target.id)) return;
    const battery = s.spec.batteries[g.battery]!;
    const gun = this.gunSpec(s.spec.kind, battery.gun);
    const sideGuns = s.guns.filter((x) => x.side === g.side);
    const slot = sideGuns.indexOf(g);
    const m = this.muzzle(s, g.side, slot, sideGuns.length);
    let aim: { x: number; y: number; z: number; vx: number; vz: number } | null = null;
    if (target && this.isActive(target)) aim = { x: target.x, y: target.spec.deck * 0.6, z: target.z, vx: Math.cos(target.heading) * target.speed, vz: Math.sin(target.heading) * target.speed };
    else if (targetId === -2 && s.order.type === 'bombard') aim = { x: s.order.x, y: s.order.y + 2, z: s.order.z, vx: 0, vz: 0 };
    let damage = gun.damage;
    let crewDamage = gun.crewDamage;
    let ammo = gun.ammo;
    let fireChance = s.spec.faction !== 'japan' ? (gun.ammo === 'arrow' ? 0.16 : 0.07) : 0.09;
    let spreadMul = gun.ammo === 'grape' ? 1.8 : 1;
    const mode = s.ammo;
    if (mode === 'hull') {
      damage *= 1.25;
      crewDamage *= 0.6;
      fireChance *= 0.6;
      if (ammo === 'grape') ammo = 'ball';
      spreadMul = 1;
    } else if (mode === 'crew') {
      damage *= 0.45;
      crewDamage *= 2.3;
      fireChance *= 0.5;
      ammo = 'grape';
      spreadMul = 1.7;
    } else if (mode === 'fire') {
      damage *= 0.7;
      crewDamage *= 0.8;
      fireChance = Math.min(0.72, fireChance * 3.2 + 0.14);
      ammo = 'fire';
      spreadMul = 1.15;
    }
    // How well the gun is laid: a full, steady crew keeping its place in the line lays it best.
    const formation = this.tactics?.cohesive.has(s.id) ? COHESION_AIM : 1;
    const skill = (0.6 + 0.4 * (s.crew / s.spec.crew)) * s.mods.accuracy * (this.morale?.steadiness(s) ?? 1) * formation;
    this.launch(m, aim, gun.type, s.team, s.id, { damage, crewDamage, ammo, spreadMul, skill, fireChance: Math.min(0.85, fireChance * s.mods.fire) });
    s.revealed = 4;
    g.ammo = Math.max(0, g.ammo - 1);
  }

  /**
   * Fires one round from a muzzle at a point, leading a moving target. Without an aim the round goes out along the
   * muzzle at a fixed reach: a blind volley into the dark.
   */
  launch(
    m: { x: number; y: number; z: number; dx: number; dz: number },
    aim: { x: number; y: number; z: number; vx: number; vz: number } | null,
    gunType: GunType,
    team: Team,
    shooter: number,
    load: { damage: number; crewDamage: number; ammo: AmmoType; spreadMul: number; skill: number; fireChance: number },
  ) {
    const gun = GUN_SPECS[gunType];
    let tx: number;
    let tz: number;
    let aimHeight: number;
    if (aim) {
      const d0 = hyp(aim.x - m.x, aim.z - m.z);
      const flight = d0 / gun.muzzle;
      tx = aim.x + aim.vx * flight;
      tz = aim.z + aim.vz * flight;
      aimHeight = aim.y - m.y;
    } else {
      const reach = Math.min(gun.range * 0.7, 260);
      tx = m.x + m.dx * reach;
      tz = m.z + m.dz * reach;
      aimHeight = 2 - m.y;
    }
    const dx = tx - m.x;
    const dz = tz - m.z;
    const d = hyp(dx, dz);
    const spreadAz = ((0.01 + d * 0.00006) / load.skill) * load.spreadMul;
    const spreadEl = (0.0035 + d * 0.00001) / load.skill;
    const gauss = () => (this.rand() + this.rand() + this.rand() - 1.5) * 1.15;
    const az = Math.atan2(dz, dx) + gauss() * spreadAz;
    const k = Math.min(1, (GRAVITY * d) / (gun.muzzle * gun.muzzle));
    const elev = 0.5 * Math.asin(k) + Math.atan2(aimHeight, d) + gauss() * spreadEl;
    const v = gun.muzzle * (0.97 + this.rand() * 0.06);
    const proj: Projectile = {
      id: this.nextProjectile++,
      x: m.x,
      y: m.y,
      z: m.z,
      vx: Math.cos(az) * Math.cos(elev) * v,
      vy: Math.sin(elev) * v,
      vz: Math.sin(az) * Math.cos(elev) * v,
      team,
      shooter,
      damage: load.damage,
      crewDamage: load.crewDamage,
      ammo: load.ammo,
      gun: gun.type,
      fireChance: load.fireChance,
      age: 0,
      alive: true,
    };
    this.projectiles.push(proj);
    const len = Math.hypot(proj.vx, proj.vy, proj.vz);
    if (shooter) this.events.push({ type: 'gun', ship: shooter, gun: gun.type, x: m.x, y: m.y, z: m.z, dx: proj.vx / len, dy: proj.vy / len, dz: proj.vz / len, big: gun.big });
    this.events.push({ type: 'shot', id: proj.id, team, gun: gun.type, ammo: proj.ammo, x: m.x, y: m.y, z: m.z, vx: proj.vx, vy: proj.vy, vz: proj.vz });
    return proj;
  }

  private updateProjectiles(dt: number) {
    const sub = 4;
    const h = dt / sub;
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      for (let i = 0; i < sub && p.alive; i += 1) {
        p.vy -= GRAVITY * h;
        p.x += p.vx * h;
        p.y += p.vy * h;
        p.z += p.vz * h;
        p.age += h;
        if (p.y < 60) {
          const ground = this.land(p.x, p.z);
          if (ground > 0 && p.y <= ground) {
            p.alive = false;
            this.events.push({ type: 'ground', proj: p.id, x: p.x, y: ground, z: p.z });
            this.rules?.impact?.(this, p.x, ground, p.z, p.damage, p.team);
            break;
          }
        }
        if (p.y < 1.5 && p.y <= this.waves.heightAt(p.x, p.z, this.time, 8)) {
          p.alive = false;
          this.events.push({ type: 'splash', proj: p.id, x: p.x, z: p.z, size: p.ammo === 'arrow' ? 1.2 : p.ammo === 'grape' ? 0.6 : 1 });
          break;
        }
        this.shell = p;
        this.teamGrids[otherTeam(p.team)].query(p.x, p.z, 25, this.shellMeets);
      }
      if (p.age > 14) p.alive = false;
    }
    this.shell = null;
    // Compacted in place: a new array every step was garbage for nothing.
    let n = 0;
    for (const p of this.projectiles) if (p.alive) this.projectiles[n++] = p;
    this.projectiles.length = n;
  }

  /** The shell being moved, for shellMeets. */
  private shell: Projectile | null = null;
  /** Whether the shell in flight strikes this enemy hull, and what the hit does. One function for every shell and substep. */
  private readonly shellMeets = (s: Ship) => {
    const p = this.shell!;
    if (!p.alive || !s.alive || s.sinking >= 0.6) return;
    const dx = p.x - s.x;
    const dz = p.z - s.z;
    const r = s.spec.length * 0.5 + 1;
    if (dx * dx + dz * dz > r * r) return;
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    const lx = dx * c + dz * n;
    const lz = -dx * n + dz * c;
    const halfL = s.spec.length * 0.5;
    const halfB = s.spec.beam * 0.5 * (1 - Math.pow(Math.abs(lx) / halfL, 3) * 0.6);
    if (Math.abs(lx) > halfL || Math.abs(lz) > halfB + 0.3) return;
    const top = Math.abs(lx) < halfL * 0.5 ? s.spec.height * 0.7 : s.spec.deck + 1.5;
    if (p.y > top || p.y < -1.2) return;
    p.alive = false;
    const shooter = this.byId.get(p.shooter);
    // Down the keel line, or from a second quarter at once: the depth rules' raking and crossfire.
    const angle = this.tactics?.hit(s, p.shooter, p.ammo, p.vx, p.vz);
    // The first volley of a sprung ambush catches the crews off their stations.
    const surprise = this.maneuverRules?.surprised(shooter) ? SURPRISE_CREW : 1;
    if (surprise > 1) this.morale?.shock(s, SURPRISE_SHOCK);
    const dmg = p.damage * (1 - s.spec.armor) * (0.7 + this.rand() * 0.6) * (angle?.hull ?? 1);
    this.damage(s, dmg, shooter);
    // A round above the bulwark sweeps the open deck; one through the planking kills below.
    const exposure: Exposure = p.ammo === 'grape' || p.y > s.spec.deck ? 'deck' : 'hull';
    if (exposure === 'hull' && p.ammo !== 'arrow' && p.ammo !== 'grape') this.impactDamage(s, dmg, dx, dz);
    this.casualties(s, ((p.crewDamage * (0.5 + this.rand())) / Math.max(1, s.spec.deckDefense * 0.8)) * (angle?.crew ?? 1) * surprise, exposure, false);
    if (this.rand() < p.fireChance) this.ignite(s, p.ammo === 'fire' ? 0.26 : 0.2);
    this.blow();
    const hit: Extract<BattleEvent, { type: 'hit' }> = { type: 'hit', ship: s.id, proj: p.id, x: p.x, y: p.y, z: p.z, damage: dmg, ammo: p.ammo };
    if (angle?.bonus) hit.bonus = angle.bonus;
    this.events.push(hit);
  };

  /** Sets a ship alight, or feeds its fire. `from` is the burning ship it caught from, when fire spread. */
  ignite(s: Ship, amount: number, from = 0) {
    const before = s.fire;
    s.fire = Math.min(1, s.fire + amount * (s.spec.fireResist ?? 1));
    if (before < 0.05) this.events.push(from ? { type: 'ignite', ship: s.id, from } : { type: 'ignite', ship: s.id });
  }

  private damage(s: Ship, amount: number, source?: Ship, combatHit = true) {
    if (s.sinking > 0 || !s.alive) return;
    s.hull -= amount;
    if (combatHit) s.lastHit = this.time;
    if (s.hull <= 0) {
      s.hull = 0;
      s.sinking = 0.0001;
      s.grappledWith = 0;
      for (const o of this.ships) if (o.grappledWith === s.id) o.grappledWith = 0;
      if (source) source.kills += 1;
      this.events.push({ type: 'sinking', ship: s.id });
      if (!s.struck) this.leave(s);
    }
  }

  /** A side breach admits water; a stern hit damages steering. The existing impact already accounts for speed and armour. */
  private impactDamage(s: Ship, amount: number, dx: number, dz: number) {
    if (this.profile === 'historical' || amount <= 0) return;
    const state = s.damageState ??= { flooding: 0, propulsion: 0, steering: 0 };
    const length = hyp(dx, dz) || 1;
    const forward = clamp((dx * Math.cos(s.heading) + dz * Math.sin(s.heading)) / length, -1, 1);
    const side = 1 - Math.abs(forward), stern = Math.max(0, -forward);
    const severity = Math.min(1, amount / s.spec.hull);
    state.flooding = Math.min(1, state.flooding + severity * (0.06 + side * 0.28));
    state.propulsion = Math.min(1, state.propulsion + severity * (0.18 + side * 0.2));
    state.steering = Math.min(1, state.steering + severity * (0.12 + stern * 0.4));
  }

  /** Repairs and replacements at a dock. Fractions of the ship's full hull and crew per call. */
  mend(s: Ship, hull: number, crew: number) {
    if (!this.isActive(s)) return;
    s.hull = Math.min(s.spec.hull, s.hull + s.spec.hull * hull);
    if (this.profile !== 'historical' && s.damageState && hull > 0) {
      s.damageState.flooding = Math.max(0, s.damageState.flooding - hull * 2);
      s.damageState.propulsion = Math.max(0, s.damageState.propulsion - hull);
      s.damageState.steering = Math.max(0, s.damageState.steering - hull);
    }
    const add = Math.min(s.spec.crew - s.crew, s.spec.crew * crew);
    if (add <= 0) return;
    for (let i = 0; i < 4; i += 1) s.roles[i] = s.roles[i]! + add * s.plan[i]!;
    s.crew = s.roles[0] + s.roles[1] + s.roles[2] + s.roles[3];
  }

  /** Shot and powder from a magazine. Fraction of a full load per call. */
  resupply(s: Ship, amount: number) {
    if (!this.isActive(s) || !Number.isFinite(amount) || amount <= 0) return;
    s.supply = Math.min(1, s.supply + amount);
    for (const g of s.guns) {
      const full = GUN_SHOTS[s.spec.batteries[g.battery]!.gun];
      g.ammo = Math.min(full, g.ammo + full * amount);
    }
  }

  private damageOverTime(s: Ship, dt: number) {
    if (this.profile !== 'historical' && s.damageState && s.damageState.flooding > 0 && this.isActive(s)) {
      const before = s.damageState.flooding;
      const pump = Math.max(0, this.rowing(s)) * 0.015;
      const after = before * Math.exp(-pump * dt);
      // Integrate the water's damage over this step, so pumping and hull loss do not depend on update frequency.
      const waterSeconds = pump > 0 ? (before - after) / pump : before * dt;
      s.damageState.flooding = after;
      // Pumping under shelter must not keep resetting the dock's recent-combat delay.
      this.damage(s, s.spec.hull * 0.0015 * waterSeconds, undefined, false);
    }
    if (s.fire > 0) {
      const crewRatio = s.crew / s.spec.crew;
      s.fire += dt * 0.018 * (1 + s.fire) * (s.spec.fireResist ?? 1);
      if (!s.struck && s.sinking === 0) s.fire -= dt * 0.045 * crewRatio * (0.4 + this.rand() * 1.2);
      s.fire = clamp(s.fire, 0, 1);
      s.burn = Math.min(1, s.burn + dt * s.fire * 0.025);
      if (s.sinking === 0) this.damage(s, dt * s.fire * 1.6);
      this.casualties(s, dt * s.fire * 0.4, 'all', false);
      if (s.fire > 0.75 && this.rand() < dt * 0.012 && s.sinking === 0) {
        this.events.push({ type: 'explode', ship: s.id, x: s.x, y: s.spec.deck, z: s.z });
        this.damage(s, 60);
        this.casualties(s, 25, 'all', false);
      }
      if (s.fire < 0.015 && s.sinking === 0) s.fire = 0;
    }
    if (s.struck && s.sinking === 0) s.fire = Math.max(s.fire, 0.3);
  }
}
