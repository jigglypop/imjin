export type Team = 'joseon' | 'japan';
export type ShipKind = 'panokseon' | 'geobukseon' | 'hyeopseon' | 'atakebune' | 'sekibune' | 'kobaya' | 'mingship' | 'mingsmall';
export type Faction = 'joseon' | 'japan' | 'ming';
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
  melee: number;
  deckDefense: number;
  armor: number;
  boardable: boolean;
  ramPower: number;
  soldiers: number;
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
  | { type: 'broadside'; targetId: number; side: Side };

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
  crew: number;
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
};

export type Squadron = {
  id: number;
  team: Team;
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
  | { type: 'musket'; ship: number; x: number; y: number; z: number; dx: number; dz: number; count: number }
  | { type: 'hit'; ship: number; x: number; y: number; z: number; damage: number; ammo: AmmoType }
  | { type: 'splash'; x: number; z: number; size: number }
  | { type: 'ground'; x: number; y: number; z: number }
  | { type: 'ignite'; ship: number }
  | { type: 'explode'; ship: number; x: number; y: number; z: number }
  | { type: 'ram'; a: number; b: number; x: number; z: number; power: number }
  | { type: 'board'; a: number; b: number }
  | { type: 'casualty'; ship: number; count: number; melee: boolean }
  | { type: 'volley'; ship: number; side: number; count: number }
  | { type: 'repelled'; a: number; b: number }
  | { type: 'sinking'; ship: number }
  | { type: 'struck'; ship: number }
  | { type: 'removed'; ship: number };

export type LandSampler = (x: number, z: number) => number;
