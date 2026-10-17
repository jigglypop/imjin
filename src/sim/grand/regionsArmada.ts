import type { CommanderDef, RegionDef, StartSetup } from './regions';
import type { RegionId } from './types';

// The Armada theatre: the English Channel, the North Sea and the seas round Britain and Ireland in the Anglo-Spanish
// war, from the Armada's sailing in July 1588 onward. Positions are the real ones (decimal degrees); the Iberian ports lie
// off the map's southern edge. Starting owners follow the summer of 1588: England holds its south and east coasts,
// Ireland and the cautionary town of Flushing; Spain holds Iberia, Parma's Flemish ports, Brittany's Spanish-held coast,
// and (as the Catholic League's friend) the Calais roads the Armada anchored in. Scotland, neutral under James VI, is
// counted to England's side here, since its ports were closed to the Armada.
// Sources: Martin & Parker, The Spanish Armada (1999); Mattingly, The Defeat of the Spanish Armada (1959); Konstam,
// The Armada Campaign 1588 (2001); Wernham, After the Armada (1984) for the war after 1588.

export const ARMADA_REGION_ORDER = [
  'london', 'harwich', 'downs', 'dover', 'portsmouth', 'wight', 'portland', 'plymouth', 'lizard', 'scilly',
  'kinsale', 'blasket', 'forth', 'orkney', 'flushing', 'calais', 'gravelines', 'dunkirk', 'sluys', 'ushant',
  'corunna', 'santander', 'lisbon',
] as const satisfies readonly RegionId[];

type ArmadaId = (typeof ARMADA_REGION_ORDER)[number];

const r = (id: ArmadaId, name: string, hanja: string, lon: number, lat: number, value: 1 | 2 | 3, terrain: RegionDef['terrain'], blurb: string, extra: Partial<RegionDef> = {}): RegionDef => ({
  id, name, hanja, lon, lat, value, terrain, korea: false, blurb, ...extra,
});

export const ARMADA_REGIONS: Record<ArmadaId, RegionDef> = {
  london: r('london', '런던·템스강', 'London', 0.37, 51.45, 3, 'bay', '틸버리 요새가 템스강 하구를 지키는 잉글랜드의 수도입니다. 엘리자베스 1세가 이곳 진영에서 군대를 사열했습니다.', { capitalOf: 'england' }),
  harwich: r('harwich', '하리치', 'Harwich', 1.28, 51.94, 1, 'bay', '스타우어강 하구의 항구입니다. 북해로 나가는 잉글랜드 함대가 물과 식량을 채웠습니다.'),
  downs: r('downs', '다운스', 'The Downs', 1.45, 51.23, 2, 'open', '굿윈 모래톱 안쪽의 넓은 정박지입니다. 헨리 시모어의 전대가 파르마의 도해를 지켜보던 곳입니다.'),
  dover: r('dover', '도버', 'Dover', 1.32, 51.12, 2, 'strait', '해협에서 가장 좁은 목을 내려다보는 도버 성의 항구입니다.'),
  portsmouth: r('portsmouth', '포츠머스', 'Portsmouth', -1.1, 50.79, 3, 'bay', '헨리 8세 이래 왕실 해군의 조선소가 있는 군항입니다.'),
  wight: r('wight', '와이트섬', 'Isle of Wight', -1.3, 50.62, 2, 'island', '솔렌트 수로를 막아선 섬입니다. 무적함대는 이곳에 정박지를 얻으려다 실패했습니다.'),
  portland: r('portland', '포틀랜드', 'Portland', -2.45, 50.55, 1, 'open', '바다로 길게 뻗은 석회암 곶입니다. 프로비셔가 곶 안쪽에서 갈레아스와 싸웠습니다.'),
  plymouth: r('plymouth', '플리머스', 'Plymouth', -4.14, 50.36, 3, 'bay', '드레이크의 고향 항구이자 서쪽 함대의 기지입니다. 1588년 여름 잉글랜드 함대의 주력이 이곳에 있었습니다.'),
  lizard: r('lizard', '리저드곶', 'The Lizard', -5.2, 49.96, 1, 'open', '잉글랜드의 남쪽 끝입니다. 7월 29일 무적함대가 처음 목격된 곳입니다.'),
  scilly: r('scilly', '실리 제도', 'Isles of Scilly', -6.3, 49.93, 1, 'island', '해협 입구의 바위섬들입니다. 대서양에서 오는 함대가 처음 만나는 땅입니다.'),
  kinsale: r('kinsale', '킨세일', 'Kinsale', -8.52, 51.7, 1, 'bay', '아일랜드 남쪽의 항구입니다. 1601년 에스파냐 원정군이 상륙한 곳입니다.'),
  blasket: r('blasket', '블래스킷 해협', 'Blasket Sound', -10.55, 52.08, 1, 'strait', '아일랜드 서쪽 끝의 좁은 물길입니다. 귀환하던 레칼데가 폭풍을 피해 이곳에 숨었습니다.'),
  forth: r('forth', '포스만', 'Firth of Forth', -3.17, 55.98, 2, 'bay', '에든버러의 외항 리스가 있는 스코틀랜드의 만입니다. 잉글랜드 함대는 이 위도까지 무적함대를 쫓았습니다.'),
  orkney: r('orkney', '오크니·페어섬', 'Orkney · Fair Isle', -1.65, 59.53, 1, 'island', '스코틀랜드 북쪽 끝을 돌아가는 바닷길입니다. 엘 그란 그리폰호가 페어섬에서 난파했습니다.'),
  flushing: r('flushing', '플러싱', 'Flushing', 3.57, 51.44, 2, 'bay', '스헬더강 하구의 항구입니다. 네덜란드가 잉글랜드에 담보로 맡긴 도시로, 나사우의 유스티누스가 파르마를 봉쇄했습니다.'),
  calais: r('calais', '칼레', 'Calais', 1.85, 50.96, 2, 'bay', '무적함대가 파르마를 기다리며 닻을 내린 정박지입니다. 8월 7일 밤 화공선이 이곳을 덮쳤습니다.'),
  gravelines: r('gravelines', '그라블린', 'Gravelines', 2.12, 51.0, 1, 'open', '플랑드르 해안의 모래톱입니다. 8월 8일 아홉 시간의 결전이 벌어졌습니다.'),
  dunkirk: r('dunkirk', '됭케르크', 'Dunkirk', 2.37, 51.04, 3, 'bay', '파르마 공작의 침공군이 거룻배와 함께 기다리던 항구입니다. 됭케르크 사략선의 근거지입니다.'),
  sluys: r('sluys', '슬로이스', 'Sluys', 3.31, 51.31, 1, 'bay', '1587년 파르마가 점령한 플랑드르의 항구입니다. 침공용 거룻배가 운하로 모였습니다.'),
  ushant: r('ushant', '우에상·브르타뉴', 'Ushant', -5.1, 48.46, 1, 'island', '브르타뉴 서쪽 끝의 섬입니다. 1590년부터 에스파냐군이 브르타뉴 해안에 자리 잡았습니다.'),
  corunna: r('corunna', '라코루냐', 'A Coruña', -8.4, 43.37, 2, 'bay', '무적함대가 폭풍을 피해 수리하고 다시 출항한 갈리시아의 항구입니다.', { edge: 's' }),
  santander: r('santander', '산탄데르', 'Santander', -3.8, 43.46, 1, 'bay', '돌아온 무적함대가 닻을 내린 칸타브리아의 항구입니다.', { edge: 's' }),
  lisbon: r('lisbon', '리스본', 'Lisbon', -9.14, 38.71, 3, 'bay', '펠리페 2세가 무적함대를 모은 항구입니다. 1580년부터 에스파냐 왕이 포르투갈을 다스렸습니다.', { edge: 's', capitalOf: 'spain' }),
};

/** The sea lanes of the theatre, each listed once: [a, b, turns]. */
export const ARMADA_EDGES: [ArmadaId, ArmadaId, 1 | 2 | 3][] = [
  // Iberia and the Biscay crossing.
  ['lisbon', 'corunna', 2], ['corunna', 'santander', 1], ['corunna', 'ushant', 3], ['santander', 'ushant', 2], ['corunna', 'scilly', 3],
  // The western approaches.
  ['ushant', 'scilly', 2], ['ushant', 'lizard', 2], ['ushant', 'plymouth', 2], ['scilly', 'lizard', 1], ['scilly', 'kinsale', 2],
  // Up the Channel.
  ['lizard', 'plymouth', 1], ['plymouth', 'portland', 2], ['portland', 'wight', 1], ['wight', 'portsmouth', 1], ['wight', 'dover', 2],
  ['portsmouth', 'dover', 2], ['wight', 'calais', 2], ['ushant', 'portland', 3],
  // The narrow seas and the Flemish coast.
  ['dover', 'downs', 1], ['dover', 'calais', 1], ['downs', 'calais', 1], ['downs', 'london', 1], ['downs', 'dunkirk', 1], ['downs', 'harwich', 1],
  ['london', 'harwich', 1], ['calais', 'gravelines', 1], ['gravelines', 'dunkirk', 1], ['dunkirk', 'sluys', 1], ['sluys', 'flushing', 1],
  ['harwich', 'flushing', 1],
  // North about: the Armada's way home round Scotland and Ireland.
  ['harwich', 'forth', 3], ['flushing', 'forth', 3], ['forth', 'orkney', 2], ['orkney', 'blasket', 3], ['blasket', 'kinsale', 2],
];

export const ARMADA_COMMANDERS: CommanderDef[] = [
  { id: 'howard', faction: 'england', name: '찰스 하워드', title: '해군 총사령관', portrait: 'portrait_howard', level: 3 },
  { id: 'drake', faction: 'england', name: '프랜시스 드레이크', title: '부사령관', portrait: 'portrait_drake', level: 3 },
  { id: 'frobisher', faction: 'england', name: '마틴 프로비셔', title: '트라이엄프호 함장', portrait: 'portrait_frobisher', level: 2 },
  { id: 'hawkins', faction: 'england', name: '존 호킨스', title: '후위 사령관', portrait: 'portrait_hawkins', level: 2, joins: 1 },
  { id: 'medina', faction: 'spain', name: '메디나 시도니아 공작', title: '무적함대 총사령관', portrait: 'portrait_medina', level: 2 },
  { id: 'recalde', faction: 'spain', name: '후안 마르티네스 데 레칼데', title: '부사령관', portrait: 'portrait_recalde', level: 3 },
  { id: 'leyva', faction: 'spain', name: '알론소 데 레이바', title: '선봉 사령관', portrait: 'portrait_leyva', level: 2 },
  { id: 'oquendo', faction: 'spain', name: '미겔 데 오켄도', title: '기푸스코아 전대 사령관', portrait: 'portrait_oquendo', level: 2, joins: 1 },
];

/** July 1588: the Armada gathered at Corunna, Parma's barges in Flanders, the English fleet at Plymouth and in the Downs. */
export const ARMADA_START: StartSetup = {
  owners: {
    london: 'england', harwich: 'england', downs: 'england', dover: 'england', portsmouth: 'england', wight: 'england', portland: 'england',
    plymouth: 'england', lizard: 'england', scilly: 'england', kinsale: 'england', blasket: 'england', forth: 'england', orkney: 'england', flushing: 'england',
    calais: 'spain', gravelines: 'spain', dunkirk: 'spain', sluys: 'spain', ushant: 'spain', corunna: 'spain', santander: 'spain', lisbon: 'spain',
  },
  buildings: {
    london: { camp: 2, shipyard: 1, battery: 1 },
    portsmouth: { camp: 1, shipyard: 2, dock: 1 },
    plymouth: { camp: 1, shipyard: 1, battery: 1, dock: 1 },
    dover: { battery: 1 },
    downs: { beacon: 1 },
    wight: { battery: 1 },
    flushing: { camp: 1, battery: 1 },
    lizard: { beacon: 1 },
    lisbon: { camp: 2, shipyard: 2, dock: 1 },
    corunna: { camp: 1, shipyard: 1, dock: 1 },
    santander: { shipyard: 1 },
    dunkirk: { camp: 2, shipyard: 1 },
    sluys: { camp: 1 },
    calais: { battery: 1 },
  },
  fleets: [
    { faction: 'england', at: 'plymouth', name: '하워드 전대', ships: { racegalleon: 8, pinnace: 6 }, commander: 'howard' },
    { faction: 'england', at: 'plymouth', name: '드레이크 전대', ships: { racegalleon: 6, pinnace: 5, fireship: 2 }, commander: 'drake' },
    { faction: 'england', at: 'downs', name: '다운스 전대', ships: { racegalleon: 4, pinnace: 6 }, commander: 'frobisher' },
    { faction: 'spain', at: 'corunna', name: '무적함대 본대', ships: { spgalleon: 12, galleass: 4, urca: 8 }, commander: 'medina' },
    { faction: 'spain', at: 'corunna', name: '비스카야 전대', ships: { spgalleon: 8, urca: 6 }, commander: 'recalde' },
    { faction: 'spain', at: 'lisbon', name: '레반테 전대', ships: { spgalleon: 6, urca: 4 }, commander: 'leyva' },
    { faction: 'spain', at: 'dunkirk', name: '파르마 수송대', ships: { urca: 8, spgalleon: 2 }, commander: null },
  ],
  gold: { england: 1000, spain: 1200 },
};
