/**
 * The two sides of a battle. The names are the historical defaults: in the nine battles the Joseon side carries the
 * Ming fleet as well. In a conquest battle either side may be led by any faction, so code that means "which navy"
 * reads Ship.spec.faction and code that means "friend or foe" reads Ship.team.
 */
export type Team = 'joseon' | 'japan';
export const TEAMS: readonly Team[] = ['joseon', 'japan'];
export const otherTeam = (t: Team): Team => (t === 'joseon' ? 'japan' : 'joseon');
export type ShipKind = 'panokseon' | 'geobukseon' | 'hyeopseon' | 'atakebune' | 'sekibune' | 'kobaya' | 'mingship' | 'mingsmall';
export type Faction = 'joseon' | 'japan' | 'ming';
export const FACTIONS: readonly Faction[] = ['joseon', 'japan', 'ming'];
/** The Ming fleet fights on the Joseon side. */
export const teamOf = (faction: Faction): Team => (faction === 'japan' ? 'japan' : 'joseon');
/** In the historical battles each faction is one commander, with these owner ids. Conquest battles number their players from 0. */
export const OWNER_OF: Record<Faction, number> = { joseon: 0, japan: 1, ming: 2 };
export type Side = 0 | 1;

export type GunType = 'cheonja' | 'jija' | 'hyeonja' | 'hwangja' | 'seungja' | 'ozutsu' | 'folangji' | 'hudun';
export type AmmoType = 'arrow' | 'ball' | 'grape' | 'fire';

export type GunSpec = {
  type: GunType;
  label: string;
  hanja: string;
  range: number;
  damage: number;
  crewDamage: number;
  muzzle: number;
  stages: number[];
  ammo: AmmoType;
  big: boolean;
};

export type Battery = {
  gun: GunType;
  count: number;
  side: Side | 2;
};

/**
 * Crew stations. Rowers (격군) work the oars on the enclosed lower deck, gunners (포수) serve the guns, shooters (사수)
 * are the archers or arquebusiers on the open deck, and the melee troops (살수 · 무사) hold the deck against boarders.
 */
export type CrewRole = 'oar' | 'gun' | 'shot' | 'melee';
export const CREW_ROLES: readonly CrewRole[] = ['oar', 'gun', 'shot', 'melee'];
/** Crew per role, in CREW_ROLES order. */
export type CrewCounts = [number, number, number, number];
/** Share of the crew wanted at each station, in CREW_ROLES order. Sums to 1. */
export type CrewPlan = [number, number, number, number];
export type SmallArms = 'bow' | 'gun';

export type ShipSpec = {
  kind: ShipKind;
  label: string;
  team: Team;
  faction: Faction;
  length: number;
  beam: number;
  deck: number;
  height: number;
  maxSpeed: number;
  accel: number;
  turnRate: number;
  hull: number;
  crew: number;
  batteries: Battery[];
  musketRange: number;
  musketPower: number;
  /** What the shooters carry: Joseon and Ming crews fought with bows, the Japanese with arquebuses. */
  arms: SmallArms;
  melee: number;
  deckDefense: number;
  armor: number;
  boardable: boolean;
  ramPower: number;
  /** Trained fighters among the crew. In a deck fight each counts for several sailors. */
  soldiers: number;
  /** The usual station plan for this ship. */
  crewPlan: CrewPlan;
  /** Conquest battles: price in funds, and seconds on the slipway. */
  cost: number;
  build: number;
};

export type FireMode = 'free' | 'hold';
export type AmmoMode = 'auto' | 'hull' | 'crew' | 'fire';
export type Stance = 'auto' | 'standoff' | 'close' | 'ram' | 'board';

export type Order =
  | { type: 'auto' }
  | { type: 'move'; x: number; z: number }
  | { type: 'attack'; targetId: number }
  | { type: 'hold' }
  | { type: 'anchor' }
  | { type: 'slot'; x: number; z: number; face: number }
  | { type: 'follow'; leaderId: number; dx: number; dz: number }
  | { type: 'broadside'; targetId: number; side: Side }
  | { type: 'bombard'; x: number; y: number; z: number };

export type GunState = {
  battery: number;
  index: number;
  side: Side | 2;
  stage: number;
  t: number;
  fireDelay: number;
  ammo: number;
};

export type ShipMods = { reload: number; accuracy: number; speed: number; turn: number; fire: number; melee: number; defense: number };

export type Ship = {
  id: number;
  spec: ShipSpec;
  team: Team;
  /** The commander who gives this ship its orders. See OWNER_OF. */
  owner: number;
  name: string;
  squadronId: number;
  flagship: boolean;
  variant: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  turn: number;
  throttle: number;
  rudder: number;
  hull: number;
  /** Total crew, always the sum of roles. */
  crew: number;
  roles: CrewCounts;
  plan: CrewPlan;
  fire: number;
  burn: number;
  morale: number;
  order: Order;
  targetId: number;
  guns: GunState[];
  musketReload: number;
  grappledWith: number;
  grappleTime: number;
  alive: boolean;
  sinking: number;
  sinkRoll: number;
  sinkPitch: number;
  struck: boolean;
  lastHit: number;
  kills: number;
  thinkTimer: number;
  aground: number;
  fireMode: FireMode;
  ammo: AmmoMode;
  speedCap: number;
  stance: Stance;
  lights: boolean;
  volleySide: number;
  volleyTimer: number;
  revealed: number;
  repel: boolean;
  mods: ShipMods;
  supply: number;
  campaignId: string;
  /** Left the arena alive while retreating (alive is false then, but the ship was not lost). */
  fled?: boolean;
};

export type Squadron = {
  id: number;
  team: Team;
  /** Taken from the first ship. Ming squadrons sail on the Joseon team. */
  faction: Faction;
  /** -1 until the first ship joins and sets it from its faction, unless the builder set it. */
  owner: number;
  name: string;
  commander: string;
  portrait: string;
  card: string;
  shipIds: number[];
  leaderId: number;
};

export type Projectile = {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  team: Team;
  /** The firing ship, or 0 for a shore battery. */
  shooter: number;
  damage: number;
  crewDamage: number;
  ammo: AmmoType;
  gun: GunType;
  fireChance: number;
  age: number;
  alive: boolean;
};

export type BattleEvent =
  | { type: 'gun'; ship: number; gun: GunType; x: number; y: number; z: number; dx: number; dy: number; dz: number; big: boolean }
  | { type: 'shot'; id: number; team: Team; gun: GunType; ammo: AmmoType; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  | { type: 'musket'; ship: number; x: number; y: number; z: number; dx: number; dz: number; count: number; arms: SmallArms }
  | { type: 'hit'; ship: number; proj: number; x: number; y: number; z: number; damage: number; ammo: AmmoType }
  | { type: 'splash'; proj: number; x: number; z: number; size: number }
  | { type: 'ground'; proj: number; x: number; y: number; z: number }
  | { type: 'ignite'; ship: number }
  | { type: 'explode'; ship: number; x: number; y: number; z: number }
  | { type: 'ram'; a: number; b: number; x: number; z: number; power: number }
  | { type: 'board'; a: number; b: number }
  | { type: 'casualty'; ship: number; count: number; melee: boolean }
  | { type: 'volley'; ship: number; side: number; count: number }
  | { type: 'repelled'; a: number; b: number }
  | { type: 'sinking'; ship: number }
  /** `by` is the ship whose boarders or fire took it, 0 when none is known. */
  | { type: 'struck'; ship: number; by: number }
  | { type: 'removed'; ship: number }
  | { type: 'spawned'; ship: number; point: number }
  | { type: 'captured'; point: number; owner: number; from: number }
  | { type: 'built'; point: number; building: string; owner: number }
  | { type: 'razed'; point: number; building: string }
  | { type: 'battery'; point: number; x: number; y: number; z: number; dx: number; dy: number; dz: number };

export type LandSampler = (x: number, z: number) => number;
