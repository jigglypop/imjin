import { Battle } from './battle';
import { SHIP_SPECS } from './catalog';
import { Conquest, ROSTER, type ConquestOptions, type MapPoint } from './conquest';
import { teamOf, type Faction, type LandSampler, type ShipKind, type Team } from './types';
import type { TerrainSpec } from '../terrain/generate';
import type { SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';

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
      { x: 0, z: -3800, rx: 9000, rz: 2900, rot: 0.02, peak: 520, rough: 1 },
      { x: 300, z: -1150, rx: 700, rz: 400, rot: 0.1, peak: 160, rough: 0.9 },
      { x: -1350, z: 260, rx: 260, rz: 160, rot: -0.3, peak: 80, rough: 0.7 },
    ]),
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
    place: '한려 물길 · 섬 사이 아홉 포구',
    date: '정유년 여름',
    season: '정유년 여름',
    summary: '섬이 흩어진 물길에 아홉 포구가 있다. 포구를 차지하면 군자금이 들어오고, 선소에서 새 배를 짓는다. 포대를 세워 물길을 막고, 적의 포구를 빼앗아 기세를 꺾어라.',
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
      ...pair({ name: '북녘 포구', hanja: '北浦', x: -320, z: -1360, r: 220, value: 1 }, '남녘 포구', '南浦'),
      { name: '한산 앞바다', hanja: '閑山洋', x: 0, z: 0, r: 360, value: 2 },
    ],
    view: { tx: 0, tz: 0, dir: 0, dist: 2200, pitch: 0.6 },
  },
  gyeonnaeryang: {
    id: 'gyeonnaeryang',
    title: '견내량 쟁탈전',
    hanja: '見乃梁爭奪戰',
    place: '좁은 물길 · 다섯 포구',
    date: '임진년 여름',
    season: '임진년 여름',
    summary: '양쪽 뭍 사이로 좁은 물길이 지난다. 물길 가운데 포구를 쥐는 쪽이 바다를 쥔다. 판옥선이 돌아설 자리가 없으니 진형과 포대의 자리가 승부를 가른다.',
    sky: 'day',
    sea: 'calm',
    night: false,
    foliage: 0,
    terrain: GYEONNAERYANG_TERRAIN,
    seats: 2,
    points: [
      ...pair({ name: '서영', hanja: '西營', x: -2700, z: -420, r: 260, value: 2, home: 0 }, '동영', '東營', 1),
      ...pair({ name: '서섬 포구', hanja: '西島浦', x: -1350, z: -60, r: 220, value: 1 }, '동섬 포구', '東島浦'),
      { name: '물길 한가운데', hanja: '梁中', x: 0, z: 0, r: 320, value: 2 },
    ],
    view: { tx: 0, tz: 0, dir: 0, dist: 2000, pitch: 0.6 },
  },
};

for (const m of Object.values(CONQUEST_MAPS)) m.terrain.reserve = reserveAround(m.points);

export const CONQUEST_ORDER: ConquestMapId[] = ['hallyeo', 'gyeonnaeryang'];

export type Seat = { name: string; faction: Faction; team: Team; human: boolean; fleet: ShipKind[] };

/** Starting treasury for buying the opening fleet. What is not spent carries into the battle. */
export const MUSTER_BUDGET = 5200;

export const fleetCost = (fleet: ShipKind[]) => fleet.reduce((a, k) => a + SHIP_SPECS[k].cost, 0);

/** The computer's opening fleet: the faction's usual mix, as much as the budget buys. */
export function autoFleet(faction: Faction, budget = MUSTER_BUDGET): ShipKind[] {
  const mix: Record<Faction, ShipKind[]> = {
    joseon: ['panokseon', 'panokseon', 'geobukseon', 'panokseon', 'hyeopseon', 'panokseon', 'hyeopseon'],
    japan: ['atakebune', 'sekibune', 'sekibune', 'kobaya', 'atakebune', 'sekibune', 'kobaya', 'sekibune'],
    ming: ['mingship', 'mingsmall', 'mingship', 'mingsmall', 'mingsmall'],
  };
  const out: ShipKind[] = [];
  let left = budget;
  for (let i = 0; i < 40; i += 1) {
    const kind = mix[faction][i % mix[faction].length]!;
    if (SHIP_SPECS[kind].cost > left) {
      const cheap = ROSTER[faction].filter((k) => SHIP_SPECS[k].cost <= left).sort((a, b) => SHIP_SPECS[a].cost - SHIP_SPECS[b].cost)[0];
      if (!cheap) break;
      out.push(cheap);
      left -= SHIP_SPECS[cheap].cost;
      continue;
    }
    out.push(kind);
    left -= SHIP_SPECS[kind].cost;
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
  const seats: Seat[] = [
    { name: '나', faction: player, team: 'joseon', human: true, fleet: autoFleet(player) },
    { name: '적장', faction: enemy, team: 'japan', human: false, fleet: autoFleet(enemy) },
  ];
  if (count === 4) {
    const ally: Faction = player === 'japan' ? 'japan' : player === 'ming' ? 'joseon' : 'ming';
    seats.push({ name: '우군', faction: ally, team: 'joseon', human: false, fleet: autoFleet(ally) });
    seats.push({ name: '적 부장', faction: enemy, team: 'japan', human: false, fleet: autoFleet(enemy) });
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

/** The part of a map a battle is built from: the capture points and whether it is fought at night. A campaign region's coast is one too. */
export type MapLayout = { points: MapPoint[]; night: boolean };

export function buildConquestOn<M extends MapLayout>(map: M, seats: Seat[], land: LandSampler, seed = 1592, options: Partial<ConquestOptions> = {}, axis = 0) {
  const b = new Battle(seed);
  const players = seats.map((s, slot) => ({ slot, name: s.name, faction: s.faction, team: s.team, human: s.human }));
  const leftovers = seats.map((s) => Math.max(0, MUSTER_BUDGET - fleetCost(s.fleet)));
  // A single player game turns the whole map about its centre to suit the light; the land sampler is turned to match.
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  const points = map.points.map((p) => ({ ...p, x: p.x * ca - p.z * sa, z: p.x * sa + p.z * ca }));
  const conquest = new Conquest(points, players, land, options);
  conquest.players.forEach((p, i) => (p.funds += leftovers[i]!));
  b.rules = conquest;
  b.land = land;
  b.night = map.night;
  b.retreatBelow = { joseon: 0, japan: 0 };
  b.windDrift = 0;
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
    const cols = 5;
    let value = 0;
    seat.fleet.filter((k) => (value += SHIP_SPECS[k].cost) <= conquest.players[slot]!.cap).forEach((kind, i) => {
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
