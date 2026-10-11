import { Battle } from './battle';
import { COMPETITIVE_PROFILE, shipSpec, type BalanceProfile } from './competitive';
import { Conquest, DEFAULT_OPTIONS, ROSTER, type ConquestOptions, type MapPoint } from './conquest';
import { teamOf, type Faction, type LandSampler, type ShipKind, type Team } from './types';
import type { TerrainSpec } from '../terrain/generate';
import type { SkyPresetName } from '../render/sky';
import { SEA_STATES, type SeaStateName } from '../ocean/waves';
import { CurrentField, type CurrentSpec } from './current';
import { environmentFor, environmentWind, type BattleEnvironment, type CoastalClimate } from './environment';
import type { CoastalFormationKind } from './coastal-tactics';

export type ConquestMapId = 'hallyeo' | 'gyeonnaeryang';

export type ConquestMap = {
  id: ConquestMapId;
  title: string;
  hanja: string;
  place: string;
  date: string;
  season: string;
  summary: string;
  sky: SkyPresetName;
  sea: SeaStateName;
  night: boolean;
  current?: CurrentSpec;
  climate?: CoastalClimate;
  /** 0 summer green to 1 winter, for the forests. */
  foliage: number;
  terrain: TerrainSpec;
  points: MapPoint[];
  /** Seats the map has home ports for. */
  seats: number;
  view: { tx: number; tz: number; dir: number; dist: number; pitch: number };
};

// Both maps are point-symmetric about the centre, so neither side starts with better water.
const mirror = <T extends { x: number; z: number }>(list: T[]): T[] => list.flatMap((s) => [s, { ...s, x: -s.x, z: -s.z }]);

/** A capture point and its mirror image across the centre, under the mirror's own name. */
function pair(p: MapPoint, name: string, hanja: string, home?: number): MapPoint[] {
  return [p, { ...p, name, hanja, x: -p.x, z: -p.z, home }];
}

export const HALLYEO_TERRAIN: TerrainSpec = {
  size: 16000,
  res: 2048,
  seed: 1601,
  symmetric: true,
  shapes: [
    ...mirror([
      { x: -600, z: -4300, rx: 7500, rz: 2550, rot: 0.04, peak: 430, rough: 1 },
      { x: -3050, z: 700, rx: 620, rz: 460, rot: 0.4, peak: 190, rough: 0.9 },
      { x: -900, z: 760, rx: 250, rz: 180, rot: -0.3, peak: 80, rough: 0.7 },
      { x: -1650, z: -420, rx: 150, rz: 110, rot: 0.2, peak: 45, rough: 0.6 },
      { x: -2700, z: -700, rx: 170, rz: 120, rot: 0.5, peak: 50, rough: 0.6 },
    ]),
    { x: 0, z: 0, rx: 200, rz: 140, rot: 0.6, peak: 55, rough: 0.6 },
  ],
  channels: [],
};

export const GYEONNAERYANG_TERRAIN: TerrainSpec = {
  size: 16000,
  res: 2048,
  seed: 1602,
  symmetric: true,
  shapes: [
    ...mirror([
      { x: 0, z: -4200, rx: 9000, rz: 2550, rot: 0.02, peak: 520, rough: 1 },
      // Three navigable approaches leave room to flank a gun line instead of feeding every ship into one firing lane.
      { x: 300, z: -1150, rx: 500, rz: 290, rot: 0.1, peak: 160, rough: 0.9 },
      { x: -1350, z: 260, rx: 180, rz: 120, rot: -0.3, peak: 80, rough: 0.7 },
    ]),
    // A central reef breaks the uninterrupted cannon lane; both flanks remain navigable.
    { x: 0, z: 0, rx: 200, rz: 150, rot: 0.6, peak: 50, rough: 0.6 },
  ],
  channels: [],
};

/** Shore around every capture point stays clear of villages and woods, for the shore works. */
function reserveAround(points: MapPoint[]) {
  return points.map((p) => ({ x: p.x, z: p.z, r: p.r * 3.2 + 160 }));
}

export const CONQUEST_MAPS: Record<ConquestMapId, ConquestMap> = {
  hallyeo: {
    id: 'hallyeo',
    title: '한려 쟁탈전',
    hanja: '閑麗爭奪戰',
    place: '한려 수도 · 거점 9곳',
    date: '1597년 여름',
    season: '여름',
    summary: '섬이 흩어진 물길에 거점이 아홉 곳 있습니다. 거점을 차지하면 군자금이 들어오고, 선소에서 새 함선을 건조할 수 있습니다. 포대로 물길을 지키면서 적의 거점을 빼앗는 것이 승리의 열쇠입니다.',
    sky: 'afternoon',
    sea: 'moderate',
    night: false,
    foliage: 0,
    terrain: HALLYEO_TERRAIN,
    seats: 4,
    points: [
      ...pair({ name: '서영', hanja: '西營', x: -2000, z: -1420, r: 260, value: 2, home: 0 }, '동영', '東營', 1),
      ...pair({ name: '서섬 진', hanja: '西島鎭', x: -2180, z: 640, r: 240, value: 2, home: 2 }, '동섬 진', '東島鎭', 3),
      ...pair({ name: '견내 포구', hanja: '見乃浦', x: -900, z: 400, r: 220, value: 1 }, '두억 포구', '豆億浦'),
      ...pair({ name: '북쪽 포구', hanja: '北浦', x: -320, z: -1360, r: 220, value: 1 }, '남쪽 포구', '南浦'),
      { name: '한산 앞바다', hanja: '閑山洋', x: 0, z: 0, r: 360, value: 2 },
    ],
    view: { tx: 0, tz: 0, dir: 0, dist: 2200, pitch: 0.6 },
  },
  gyeonnaeryang: {
    id: 'gyeonnaeryang',
    title: '견내량 쟁탈전',
    hanja: '見乃梁爭奪戰',
    place: '견내량 · 거점 7곳',
    date: '1592년 여름',
    season: '여름',
    summary: '좁은 중앙 물길과 양옆 포구에 거점이 일곱 곳 있습니다. 함포로 중앙을 막거나, 작은 함선을 옆 물길로 보내 포구를 빼앗을 수 있습니다. 진형과 측면 기동이 승패를 좌우합니다.',
    sky: 'day',
    sea: 'moderate',
    night: false,
    foliage: 0,
    terrain: GYEONNAERYANG_TERRAIN,
    seats: 2,
    points: [
      ...pair({ name: '서영', hanja: '西營', x: -2000, z: -1420, r: 260, value: 2, home: 0 }, '동영', '東營', 1),
      ...pair({ name: '서섬 포구', hanja: '西島浦', x: -900, z: 400, r: 220, value: 1 }, '동섬 포구', '東島浦'),
      ...pair({ name: '북쪽 포구', hanja: '北浦', x: -320, z: -1360, r: 220, value: 1 }, '남쪽 포구', '南浦'),
      { name: '물길 중앙', hanja: '梁中', x: 0, z: 0, r: 360, value: 2 },
    ],
    view: { tx: 0, tz: 0, dir: 0, dist: 2000, pitch: 0.6 },
  },
};

for (const m of Object.values(CONQUEST_MAPS)) m.terrain.reserve = reserveAround(m.points);

export const CONQUEST_ORDER: ConquestMapId[] = ['hallyeo', 'gyeonnaeryang'];

export type Seat = { name: string; faction: Faction; team: Team; human: boolean; fleet: ShipKind[] };

/** Starting treasury for buying the opening fleet. What is not spent carries into the battle. */
export const MUSTER_BUDGET = DEFAULT_OPTIONS.musterBudget ?? 15600;
export const FLEET_MIX: Record<Faction, ShipKind[]> = {
  joseon: ['panokseon', 'panokseon', 'geobukseon', 'panokseon', 'hyeopseon', 'panokseon', 'hyeopseon'],
  japan: ['atakebune', 'sekibune', 'sekibune', 'kobaya', 'atakebune', 'sekibune', 'kobaya', 'sekibune'],
  ming: ['mingship', 'mingsmall', 'mingship', 'mingsmall', 'mingsmall'],
};

export const fleetCost = (fleet: ShipKind[], profile: BalanceProfile = COMPETITIVE_PROFILE) => fleet.reduce((a, k) => a + shipSpec(k, profile).cost, 0);

/** The computer's opening fleet: the faction's usual mix, as much as the budget buys. */
export function autoFleet(faction: Faction, budget = MUSTER_BUDGET, profile: BalanceProfile = COMPETITIVE_PROFILE, maxShips = Infinity): ShipKind[] {
  const out: ShipKind[] = [];
  let left = budget;
  for (let i = 0; i < maxShips; i += 1) {
    const kind = FLEET_MIX[faction][i % FLEET_MIX[faction].length]!;
    if (shipSpec(kind, profile).cost > left) {
      const cheap = ROSTER[faction].filter((k) => shipSpec(k, profile).cost <= left).sort((a, b) => shipSpec(a, profile).cost - shipSpec(b, profile).cost)[0];
      if (!cheap) break;
      out.push(cheap);
      left -= shipSpec(cheap, profile).cost;
      continue;
    }
    out.push(kind);
    left -= shipSpec(kind, profile).cost;
  }
  return out;
}

/** How far from the middle of the map the opening fleets form up. */
const MUSTER_RADIUS = 700;

/** The nearest open water to a point, clear of ships already placed. */
export function wetSpot(land: LandSampler, x: number, z: number, placed: { x: number; z: number }[]) {
  const free = (px: number, pz: number) => land(px, pz) < -6 && placed.every((o) => (o.x - px) ** 2 + (o.z - pz) ** 2 > 40 * 40);
  if (free(x, z)) return { x, z };
  for (let ring = 1; ring <= 40; ring += 1) {
    for (let k = 0; k < 12; k += 1) {
      const a = (k / 12) * Math.PI * 2 + ring;
      const px = x + Math.cos(a) * ring * 25;
      const pz = z + Math.sin(a) * ring * 25;
      if (free(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

/** Default seats: the player against the computer, or a 2-against-2. */
export function defaultSeats(player: Faction, enemy: Faction, count = 2): Seat[] {
  const fleet = (f: Faction) => autoFleet(f);
  const seats: Seat[] = [
    { name: '아군 본대', faction: player, team: 'joseon', human: true, fleet: fleet(player) },
    { name: '적 본대', faction: enemy, team: 'japan', human: false, fleet: fleet(enemy) },
  ];
  if (count === 4) {
    const ally: Faction = player === 'japan' ? 'japan' : player === 'ming' ? 'joseon' : 'ming';
    seats.push({ name: '동맹군', faction: ally, team: 'joseon', human: false, fleet: fleet(ally) });
    seats.push({ name: '적 별동대', faction: enemy, team: 'japan', human: false, fleet: fleet(enemy) });
  }
  return seats;
}

/** Direction from the first home port to the second, in map coordinates. */
export function homeAxis(id: ConquestMapId) {
  const pts = CONQUEST_MAPS[id].points;
  const a = pts.find((p) => p.home === 0)!;
  const b = pts.find((p) => p.home === 1)!;
  return Math.atan2(b.z - a.z, b.x - a.x);
}

/** The side a faction usually fights on when the player has not chosen. */
export const defaultTeam = (f: Faction) => teamOf(f);

/**
 * Builds a conquest battle. Coordinates are the map's own: the battle is not rotated, so a server and every client
 * agree on positions without knowing each other's lighting.
 */
export function buildConquest(id: ConquestMapId, seats: Seat[], land: LandSampler, seed = 1592, options: Partial<ConquestOptions> = {}, axis = 0) {
  return buildConquestOn(CONQUEST_MAPS[id], seats, land, seed, options, axis);
}

/** The capture points, light and sea of a battle. A campaign region's coast is a map too. */
export type MapLayout = { points: MapPoint[]; night: boolean; sky?: SkyPresetName; sea?: SeaStateName; current?: CurrentSpec; climate?: CoastalClimate; environment?: BattleEnvironment; coastalTactic?: CoastalFormationKind };

export function buildConquestOn<M extends MapLayout>(map: M, seats: Seat[], land: LandSampler, seed = 1592, options: Partial<ConquestOptions> = {}, axis = 0) {
  const profile = options.profile ?? COMPETITIVE_PROFILE;
  const b = new Battle(seed, profile);
  const ranked = options.maxShips === 36 && options.cap === 10000 && options.expanded === false;
  b.coastalTactic = ranked || profile === 'historical' ? undefined : map.coastalTactic;
  const environment = !ranked && map.environment ? map.environment : environmentFor({ sky: map.sky ?? 'afternoon', sea: map.sea ?? 'moderate', night: map.night, current: map.current, climate: map.climate }, seed, ranked || profile === 'historical');
  b.setSea(SEA_STATES[environment.sea]);
  const players = seats.map((s, slot) => ({ slot, name: s.name, faction: s.faction, team: s.team, human: s.human }));
  // A single player game turns the whole map about its centre to suit the light; the land sampler is turned to match.
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  const points = map.points.map((p) => ({ ...p, x: p.x * ca - p.z * sa, z: p.x * sa + p.z * ca }));
  const conquest = new Conquest(points, players, land, options);
  b.rules = conquest;
  b.land = land;
  b.night = environment.night;
  b.visibilityScale = environment.visibility;
  if (environment.current) b.flow = new CurrentField(environment.current, (x, z) => land(x * ca - z * sa, x * sa + z * ca), axis);
  b.retreatBelow = { joseon: 0, japan: 0 };
  const wind = environmentWind(environment, axis);
  b.windAngle = wind.angle;
  b.windDrift = wind.drift;
  b.humans = new Set(seats.flatMap((s, i) => (s.human ? [i] : [])));
  b.center = { x: 0, z: 0 };
  b.arenaRadius = 7600;
  // The opening fleets muster this far from the middle of the map instead of in their home ports, so that the first
  // contact comes within a few minutes rather than a quarter of an hour. Ships built later still launch at the port.
  const muster = points.reduce((best, p) => (Math.hypot(p.x, p.z) < Math.hypot(best.x, best.z) ? p : best));
  const placed: { x: number; z: number }[] = [];
  seats.forEach((seat, slot) => {
    const home = conquest.homeOf(slot);
    if (!home) return;
    const toCentre = Math.atan2(-home.z, -home.x);
    const fx = Math.cos(toCentre);
    const fz = Math.sin(toCentre);
    const advance = Math.max(0, Math.hypot(home.spawn.x, home.spawn.z) - MUSTER_RADIUS);
    const cols = conquest.options.expanded ? Math.min(12, Math.max(5, Math.ceil(Math.sqrt(seat.fleet.length * 1.2)))) : 5;
    let value = 0;
    const budget = options.musterBudget ?? DEFAULT_OPTIONS.musterBudget ?? MUSTER_BUDGET;
    const opening: ShipKind[] = [];
    for (const kind of seat.fleet) {
      if (!ROSTER[seat.faction].includes(kind)) continue;
      const price = shipSpec(kind, profile).cost;
      if (opening.length >= conquest.shipLimit(slot) || value + price > Math.min(budget, conquest.players[slot]!.cap)) continue;
      value += price;
      opening.push(kind);
    }
    conquest.players[slot]!.funds += Math.max(0, budget - value);
    opening.forEach((kind, i) => {
      const row = Math.floor(i / cols);
      const col = (i % cols) - (cols - 1) / 2;
      const spot = wetSpot(land, home.spawn.x + fx * (advance + 60 - row * 62) - fz * col * 58, home.spawn.z + fz * (advance + 60 - row * 62) + fx * col * 58, placed);
      placed.push(spot);
      const ship = conquest.launch(b, home, kind, spot.x, spot.z, toCentre);
      // A person gives their own orders; the computer's fleet sails for the contested water in the middle.
      ship.order = seat.human ? { type: 'hold' } : { type: 'move', x: muster.x, z: muster.z };
    });
  });
  b.events.length = 0;
  return { battle: b, conquest, map };
}
