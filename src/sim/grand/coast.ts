import type { CurrentSpec } from '../current';
import type { MapPoint } from '../conquest';
import { SCENARIOS, type ScenarioId } from '../scenarios';
import type { MapLayout } from '../maps';
import type { SeaStateName } from '../../ocean/waves';
import type { SkyPresetName } from '../../render/sky';
import type { TerrainSpec } from '../../terrain/generate';
import { REGION_ORDER } from './regions';
import type { RegionId } from './types';
import layouts from './regionPoints.json';
import { environmentFor, type BattleEnvironment, type CoastalClimate } from '../environment';
import { REGIONS } from './regions';

/**
 * The coast each campaign region is fought on. A region borrows the real terrain of the nearest historical battle
 * (the same heightmap, so the player knows the shore), and its capture points lie along that coast: the defender's
 * port, the attacker's anchorage about a thousand metres out to sea, and one to three contested headlands and
 * waters between them. Regions the historical battles do not reach (the far shore at Nagoya, Shandong and Liaodong)
 * get a generic coast of their own.
 *
 * The coordinates of the points come from `scripts/build-region-maps.mjs`, which walks each heightmap from the
 * anchors below and writes `regionPoints.json`: the points are fixed data (so the terrain can keep the ground around
 * them clear of villages and woods before it is built) and the same on every machine, the server included.
 */

/** Where a region's port lies on its terrain, in the terrain's own coordinates, and how the attacker comes. */
export type RegionSite = {
  /** The historical battle fought on this coast: it names the loading picture and carries the tidal current. Null where the coast is only borrowed. */
  scenario: ScenarioId | null;
  terrain: TerrainSpec;
  /** Open water off the defender's port; the generator snaps it to the nearest shore with room for works. */
  port: { x: number; z: number };
  /** Bearing from the port out to the open sea, where the attacker sails in from. */
  seaward: number;
  /** Metres between the two home ports. Narrow straits allow a little more. */
  span: number;
  sky: SkyPresetName;
  sea: SeaStateName;
  foliage: number;
  names: {
    defender: [string, string];
    attacker: [string, string];
    centre: [string, string];
    flanks: [string, string][];
  };
};

/** A low, open coast for the Ming's northern shore: a long beach with a headland, a harbour and a few islets off it. */
const open = (seed: number, flip: number): TerrainSpec => ({
  size: 16000,
  res: 2048,
  seed,
  shapes: [
    { x: 0, z: -7700 * flip, rx: 11000, rz: 6000, rot: 0.03 * flip, peak: 260, rough: 1 },
    { x: 2300, z: -1700 * flip, rx: 1500, rz: 1100, rot: 0.5 * flip, peak: 120, rough: 0.8 },
    { x: -3400, z: -1900 * flip, rx: 1100, rz: 700, rot: -0.3 * flip, peak: 90, rough: 0.7 },
    { x: -1500, z: 900 * flip, rx: 420, rz: 280, rot: 0.3, peak: 60, rough: 0.6 },
    { x: 1000, z: 1900 * flip, rx: 360, rz: 250, rot: -0.4, peak: 50, rough: 0.6 },
    { x: 4200, z: 700 * flip, rx: 900, rz: 520, rot: 0.2, peak: 80, rough: 0.7 },
  ],
  channels: [],
  bays: [{ x: -900, z: -1900 * flip, rx: 1100, rz: 650, rot: 0.1 }],
});

const SCENARIO_TERRAIN = (id: ScenarioId) => SCENARIOS[id].terrain;

const BASE_REGION_SITES: Partial<Record<RegionId, RegionSite>> = {
  myeongnyang: {
    scenario: 'myeongnyang',
    terrain: SCENARIO_TERRAIN('myeongnyang'),
    port: { x: -650, z: 0 },
    seaward: 0,
    span: 1300,
    sky: 'overcast',
    sea: 'moderate',
    foliage: 0.72,
    names: {
      defender: ['벽파진', '碧波津'],
      attacker: ['울돌목 동구', '鳴梁東口'],
      centre: ['울돌목', '鳴梁項'],
      flanks: [
        ['진도 북안', '珍島北岸'],
        ['녹진', '鹿津'],
      ],
    },
  },
  yeosu: {
    scenario: null,
    terrain: SCENARIO_TERRAIN('dangpo'),
    port: { x: -1300, z: -2000 },
    seaward: 1.9,
    span: 1200,
    sky: 'afternoon',
    sea: 'moderate',
    foliage: 0,
    names: {
      defender: ['전라좌수영', '全羅左水營'],
      attacker: ['남쪽 바깥바다', '南洋'],
      centre: ['여수 앞바다', '麗水洋'],
      flanks: [
        ['오동도', '梧桐島'],
        ['돌산 포구', '突山浦'],
      ],
    },
  },
  noryang: {
    scenario: 'noryang',
    terrain: SCENARIO_TERRAIN('noryang'),
    port: { x: 800, z: 0 },
    seaward: Math.PI,
    span: 1300,
    sky: 'overcast',
    sea: 'moderate',
    foliage: 1,
    names: {
      defender: ['관음포', '觀音浦'],
      attacker: ['노량 서구', '露梁西口'],
      centre: ['노량 수도', '露梁水道'],
      flanks: [
        ['하동 포구', '河東浦'],
        ['설천 포구', '雪川浦'],
      ],
    },
  },
  sacheon: {
    scenario: 'sacheon',
    terrain: SCENARIO_TERRAIN('sacheon'),
    port: { x: -350, z: -2600 },
    seaward: Math.PI / 2,
    span: 1200,
    sky: 'day',
    sea: 'moderate',
    foliage: 0.05,
    names: {
      defender: ['사천 선창', '泗川船倉'],
      attacker: ['삼천포 앞바다', '三千浦洋'],
      centre: ['모자랑포', '毛自郞浦'],
      flanks: [
        ['당포', '唐浦'],
        ['사량 어귀', '蛇梁口'],
      ],
    },
  },
  hansan: {
    scenario: 'hansan',
    terrain: SCENARIO_TERRAIN('hansan'),
    port: { x: -1500, z: 2600 },
    seaward: -0.8,
    span: 1200,
    sky: 'afternoon',
    sea: 'moderate',
    foliage: 0,
    names: {
      defender: ['한산 포구', '閑山浦'],
      attacker: ['견내량 어귀', '見乃梁口'],
      centre: ['한산 앞바다', '閑山洋'],
      flanks: [
        ['용초도', '龍草島'],
        ['추봉도', '秋峰島'],
      ],
    },
  },
  geoje: {
    scenario: 'okpo',
    terrain: SCENARIO_TERRAIN('okpo'),
    port: { x: -1700, z: 100 },
    seaward: 0,
    span: 1200,
    sky: 'afternoon',
    sea: 'moderate',
    foliage: 0.1,
    names: {
      defender: ['옥포 포구', '玉浦'],
      attacker: ['지세포 앞바다', '知世浦洋'],
      centre: ['옥포만', '玉浦灣'],
      flanks: [
        ['장승포', '長承浦'],
        ['율포', '栗浦'],
      ],
    },
  },
  angolpo: {
    scenario: 'angolpo',
    terrain: SCENARIO_TERRAIN('angolpo'),
    port: { x: 0, z: -1700 },
    seaward: Math.PI / 2,
    span: 1200,
    sky: 'overcast',
    sea: 'moderate',
    foliage: 0,
    names: {
      defender: ['안골포', '安骨浦'],
      attacker: ['가덕 앞바다', '加德洋'],
      centre: ['진해만', '鎭海灣'],
      flanks: [
        ['웅천 포구', '熊川浦'],
        ['제포', '薺浦'],
      ],
    },
  },
  busan: {
    scenario: 'busan',
    terrain: SCENARIO_TERRAIN('busan'),
    port: { x: 1500, z: -950 },
    seaward: 2,
    span: 1200,
    sky: 'day',
    sea: 'moderate',
    foliage: 0.6,
    names: {
      defender: ['부산포', '釜山浦'],
      attacker: ['절영도 앞바다', '絶影島洋'],
      centre: ['영도 수로', '影島水路'],
      flanks: [
        ['오륙도', '五六島'],
        ['초량 포구', '草梁浦'],
      ],
    },
  },
  tsushima: {
    scenario: null,
    terrain: SCENARIO_TERRAIN('chilcheon'),
    port: { x: -300, z: 500 },
    seaward: 0,
    span: 1200,
    sky: 'day',
    sea: 'moderate',
    foliage: 0,
    names: {
      defender: ['이즈하라', '嚴原'],
      attacker: ['쓰시마 서쪽 바다', '對馬西洋'],
      centre: ['아소 어귀', '淺茅口'],
      flanks: [
        ['북쪽 곶', '北崎'],
        ['남쪽 곶', '南崎'],
      ],
    },
  },
  nagoya: {
    scenario: null,
    terrain: SCENARIO_TERRAIN('sacheon'),
    port: { x: -4700, z: -2700 },
    seaward: Math.PI,
    span: 1200,
    sky: 'afternoon',
    sea: 'moderate',
    foliage: 0,
    names: {
      defender: ['나고야 성 포구', '名護屋'],
      attacker: ['가라쓰 앞바다', '唐津洋'],
      centre: ['요부코 어귀', '呼子口'],
      flanks: [
        ['가카라시마', '加唐島'],
        ['나고야 곶', '名護屋崎'],
      ],
    },
  },
  shandong: {
    scenario: null,
    terrain: open(1610, 1),
    port: { x: -900, z: -1500 },
    seaward: Math.PI / 2,
    span: 1200,
    sky: 'day',
    sea: 'moderate',
    foliage: 0.3,
    names: {
      defender: ['덩저우 수성', '登州水城'],
      attacker: ['묘도 앞바다', '廟島洋'],
      centre: ['발해 어귀', '渤海口'],
      flanks: [
        ['봉래각 곶', '蓬萊閣'],
        ['사문도', '沙門島'],
      ],
    },
  },
  liaodong: {
    scenario: null,
    terrain: open(1611, -1),
    port: { x: -900, z: 1500 },
    seaward: -Math.PI / 2,
    span: 1200,
    sky: 'overcast',
    sea: 'moderate',
    foliage: 0.5,
    names: {
      defender: ['뤼순 군항', '旅順港'],
      attacker: ['노철산 앞바다', '老鐵山洋'],
      centre: ['뤼순 어귀', '旅順口'],
      flanks: [
        ['황금산', '黃金山'],
        ['노호탄', '老虎灘'],
      ],
    },
  },
};

/**
 * New ports use the existing nearby coast terrain kits, with their own anchorage and point layout. The strategic
 * marker is geographical; a tactical kit is an adapted battle area, not a surveyed reconstruction of that port.
 * Only Dangpo names its corresponding historical scenario; borrowed coastlines never inherit a historical tide.
 */
function coastalPort(base: RegionId, name: string, hanja: string, dx = 0, dz = 0, scenario: ScenarioId | null = null): RegionSite {
  const site = BASE_REGION_SITES[base]!;
  return {
    ...site,
    scenario,
    port: { x: site.port.x + dx, z: site.port.z + dz },
    names: {
      defender: [name, hanja], attacker: [`${name} 바깥 정박지`, `${hanja}外泊地`], centre: [`${name} 입구`, `${hanja}口`], // i18n-ignore: exact place-derived labels registered by EN_PORTS
      flanks: [[`${name} 북쪽 수로`, `${hanja}北水路`], [`${name} 남쪽 수로`, `${hanja}南水路`]], // i18n-ignore: exact place-derived labels registered by EN_PORTS
    },
  };
}

export const REGION_SITES: Record<RegionId, RegionSite> = {
  ...BASE_REGION_SITES as Record<RegionId, RegionSite>,
  nokdo: coastalPort('yeosu', '녹도진', '鹿島鎭', -240, 120),
  balpo: coastalPort('yeosu', '발포진', '鉢浦鎭', 260, -120),
  bangdap: coastalPort('hansan', '방답진', '防踏鎭', 100, 100),
  dangpo: coastalPort('yeosu', '당포', '唐浦', 60, 0, 'dangpo'),
  danghangpo: coastalPort('angolpo', '당항포', '唐項浦', -900, 0),
  gabaeryang: coastalPort('hansan', '오아포', '吾兒浦', 180, -100),
  yeongdeungpo: coastalPort('geoje', '영등포', '永登浦', 300, 150),
  yulpo: coastalPort('geoje', '율포', '栗浦', -300, -150),
  jangmunpo: coastalPort('tsushima', '장문포', '長門浦', 200, 0),
  jepo: coastalPort('angolpo', '제포', '薺浦', -300, 0),
  cheonseongpo: coastalPort('angolpo', '천성진', '天城鎭', 380, -100),
  dadaepo: coastalPort('busan', '다대포', '多大浦', -300, 160),
  mokpo: coastalPort('myeongnyang', '목포진', '木浦鎭', 150, 200),
};

/** Home port of the attacker (seat 0) and of the defender (seat 1) in a region's list of points. */
export const ATTACKER_HOME = 0;
export const DEFENDER_HOME = 1;

type Placed = { x: number; z: number; r: number; value: number; role: 'attacker' | 'defender' | 'centre' | 'flank'; site?: { x: number; z: number } };

/** A region battle map: the real terrain with the capture points that were found along its coast, as a conquest map. */
export type RegionMap = MapLayout & {
  id: RegionId;
  /** The battle the terrain comes from, for its loading picture. */
  scenario: ScenarioId | null;
  /** The terrain with the ground around the points kept clear. */
  terrain: TerrainSpec;
  current?: CurrentSpec;
  climate: CoastalClimate;
  sky: SkyPresetName;
  sea: SeaStateName;
  foliage: number;
  /** The camera's first look and the centre of the arena, in terrain coordinates. */
  view: { tx: number; tz: number; dir: number; dist: number; pitch: number };
  /** Bearing from the attacker's anchorage to the defender's port in terrain coordinates, which turns the map to the light. */
  axis: number;
};

/** Designed gameplay speeds, not observations or reconstructions of real coastal tidal velocities. */
const COASTAL_FLOW: Record<RegionId, number> = {
  myeongnyang: 2.4, noryang: 1.8, yeosu: 1.0, sacheon: 0.6, hansan: 1.1, geoje: 0.8, angolpo: 1.25, busan: 0.75,
  tsushima: 1.3, nagoya: 0.65, shandong: 0.45, liaodong: 0.4,
  nokdo: 0.7, balpo: 0.65, bangdap: 1.2, dangpo: 0.75, danghangpo: 0.55, gabaeryang: 0.7,
  yeongdeungpo: 1.05, yulpo: 0.85, jangmunpo: 0.6, jepo: 0.55, cheonseongpo: 1.4, dadaepo: 1.1, mokpo: 1.8,
};

function designedCurrent(id: RegionId, placed: Placed[], mid: { x: number; z: number }, axis: number): CurrentSpec {
  const peak = COASTAL_FLOW[id];
  const centres = placed.filter((p) => p.role === 'centre' || p.role === 'flank');
  return {
    cx: mid.x, cz: mid.z, angle: axis, peak, reach: 2400, narrows: 280,
    turnAt: 300, slack: 80, floodFirst: true,
    vortices: centres.map((p, i) => ({ x: p.x, z: p.z, r: id === 'mokpo' ? 170 : id === 'yeosu' ? 140 : 100 + i * 15, spin: i % 2 ? -1 : 1, strength: peak >= 1 ? 0.9 : 0.65 })),
  };
}

function build(id: RegionId): RegionMap {
  const site = REGION_SITES[id];
  const placed = (layouts as unknown as Record<string, Placed[]>)[id] ?? [];
  const home = (role: 'attacker' | 'defender') => placed.find((p) => p.role === role);
  const names = site.names;
  let flank = 0;
  const points: MapPoint[] = placed.map((p) => {
    const [name, hanja] = p.role === 'defender' ? names.defender : p.role === 'attacker' ? names.attacker : p.role === 'centre' ? names.centre : names.flanks[flank++]!;
    return { name, hanja, x: p.x, z: p.z, r: p.r, value: p.value, home: p.role === 'attacker' ? ATTACKER_HOME : p.role === 'defender' ? DEFENDER_HOME : undefined };
  });
  const a = home('attacker');
  const d = home('defender');
  const mid = a && d ? { x: (a.x + d.x) / 2, z: (a.z + d.z) / 2 } : { x: 0, z: 0 };
  const axis = a && d ? Math.atan2(d.z - a.z, d.x - a.x) : 0;
  const terrain: TerrainSpec = { ...site.terrain, reserve: placed.flatMap((p) => (p.site ? [{ x: p.site.x, z: p.site.z, r: 150 }] : [])) };
  const scenario = site.scenario ? SCENARIOS[site.scenario] : null;
  // Keep the historical strait's written field; the other adapted coasts have explicitly designed game currents.
  const current = scenario?.current ?? designedCurrent(id, placed, mid, axis);
  const region = REGIONS[id];
  const climate: CoastalClimate = region.terrain === 'strait' ? 'strait' : region.terrain === 'bay' ? 'sheltered' : region.terrain === 'open' ? 'offshore' : 'exposed';
  return { id, scenario: site.scenario, terrain, current, climate, points, night: false, sky: site.sky, sea: site.sea, foliage: site.foliage, view: { tx: mid.x, tz: mid.z, dir: axis, dist: 1000, pitch: 0.3 }, axis };
}

export const REGION_MAPS: Record<RegionId, RegionMap> = Object.fromEntries(REGION_ORDER.map((id) => [id, build(id)])) as Record<RegionId, RegionMap>;

/** A persistent meeting's seed gives the same weather, tide and nighttime on every load and rendering client. */
export const regionEnvironment = (id: RegionId, seed: number): BattleEnvironment => environmentFor(REGION_MAPS[id], seed);
