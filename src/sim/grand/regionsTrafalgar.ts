import type { CommanderDef, RegionDef, StartSetup } from './regions';
import type { RegionId } from './types';

// The Trafalgar theatre: the Channel, the Bay of Biscay, the Atlantic coast of Iberia and the western Mediterranean in the
// war of the Third Coalition, from January 1805 onward (Spain declared war on Britain on 12 December 1804). Positions are
// the real ones (decimal degrees); Martinique and Barbados lie far off the map's western edge and are pinned to it.
// Starting owners follow January 1805: Britain holds its Channel ports, Cork, Gibraltar (since 1704) and Malta (since
// September 1800); the anchorage of the Maddalena islands (Agincourt Sound) off neutral Sardinia, where Nelson's
// Mediterranean fleet watered while it watched Toulon, is counted to Britain's side, as Scotland is in the Armada's;
// Barbados is the Leeward Islands station's base. France holds Brest, Lorient, Rochefort, Cherbourg, Boulogne (the camp of
// the Armée d'Angleterre and its invasion flotilla), Toulon, Martinique, and Taranto (occupied with the Apulian ports by
// Gouvion Saint-Cyr's corps since 1803, the Kingdom of Naples itself neutral). Spain holds Cádiz, Ferrol, Vigo, Cartagena,
// Mahón (returned by the Peace of Amiens, 1802) and the Andalusian and Galician capes. Portugal, neutral until 1807, is
// left off the map's regions.
// The year: Missiessy slipped out of Rochefort on 11 January 1805 for the West Indies; Villeneuve left Toulon on
// 30 March, joined Gravina at Cádiz on 9 April and reached Martinique on 14 May, Nelson following him to Barbados
// (4 June); Villeneuve, back across the Atlantic, met Calder off Cape Finisterre on 22 July, put into Vigo and Ferrol
// and then Cádiz (20 August), where Collingwood watched him until Nelson came on 28 September; Trafalgar was fought on
// 21 October. Ganteaume's Brest fleet stayed blockaded by Cornwallis's Channel Fleet all year.
// Sources: Corbett, The Campaign of Trafalgar (1910); Desbrière, La campagne maritime de 1805: Trafalgar (1907, tr.
// Eastwick 1933); Adkins, Trafalgar: The Biography of a Battle (2004); Goodwin, The Ships of Trafalgar (2005); Rodger,
// The Command of the Ocean (2004); Harbron, Trafalgar and the Spanish Navy (1988); Mackesy, The War in the
// Mediterranean 1803-1810 (1957) for Malta, Maddalena and Taranto.

export const TRAFALGAR_REGION_ORDER = [
  'spithead', 'plymsound', 'torbay', 'deal', 'cork', 'gibraltar', 'valletta', 'maddalena', 'barbados',
  'brest', 'lorient', 'rochefort', 'cherbourg', 'boulogne', 'toulon', 'taranto', 'martinique',
  'cadiz', 'ferrol', 'vigo', 'cartagena', 'mahon', 'trafalgar', 'finisterre',
] as const satisfies readonly RegionId[];

type TrafalgarId = (typeof TRAFALGAR_REGION_ORDER)[number];

const r = (id: TrafalgarId, name: string, hanja: string, lon: number, lat: number, value: 1 | 2 | 3, terrain: RegionDef['terrain'], blurb: string, extra: Partial<RegionDef> = {}): RegionDef => ({
  id, name, hanja, lon, lat, value, terrain, korea: false, blurb, ...extra,
});

export const TRAFALGAR_REGIONS: Record<TrafalgarId, RegionDef> = {
  spithead: r('spithead', '포츠머스', 'Portsmouth', -1.1, 50.78, 3, 'bay', '왕립 해군 조선소가 있는 영국 해군의 본거지입니다. 1805년 9월 14일 넬슨이 이곳에서 빅토리호에 올라 카디스로 떠났습니다.', { capitalOf: 'britain' }),
  plymsound: r('plymsound', '플리머스', 'Plymouth', -4.14, 50.36, 2, 'bay', '플리머스 독(데번포트) 조선소의 항구입니다. 브레스트를 봉쇄하는 해협 함대가 이곳에서 정비했습니다.'),
  torbay: r('torbay', '토베이', 'Torbay', -3.52, 50.45, 1, 'bay', '서풍이 거세면 해협 함대가 피해 들어오던 정박지입니다. 서풍이 부는 동안은 브레스트의 프랑스 함대도 나오지 못했습니다.'),
  deal: r('deal', '다운스', 'The Downs', 1.45, 51.22, 2, 'open', '딜 앞바다의 정박지입니다. 키스 경의 북해 함대가 불로뉴의 침공 선단을 지켜보았고, 해군성까지 셔터 신호소가 이어졌습니다.'),
  cork: r('cork', '코크', 'Cork', -8.3, 51.85, 1, 'bay', '아일랜드 남쪽 코브의 정박지입니다. 서인도와 지중해로 가는 호송 선단이 이곳에 모였습니다.'),
  gibraltar: r('gibraltar', '지브롤터', 'Gibraltar', -5.35, 36.14, 2, 'strait', '1704년부터 영국이 지킨 해협의 요새입니다. 1805년 7월 넬슨이 서인도에서 돌아와 이곳에 상륙했습니다.'),
  valletta: r('valletta', '몰타', 'Malta', 14.51, 35.9, 2, 'island', '1800년 9월 프랑스 수비대가 항복한 뒤 영국이 지킨 섬입니다. 아미앵 조약의 반환 약속을 지키지 않은 것이 1803년 전쟁 재개의 빌미가 되었습니다.'),
  maddalena: r('maddalena', '마달레나 제도', 'La Maddalena', 9.4, 41.21, 1, 'island', '사르데냐 북쪽의 섬들 사이 애진코트 해협입니다. 중립국 사르데냐의 바다였지만, 툴롱을 지켜보던 넬슨의 함대가 이곳에서 물과 식량을 실었습니다.'),
  barbados: r('barbados', '바베이도스', 'Barbados', -59.62, 13.1, 1, 'island', '영국 리워드 제도 기지의 섬입니다. 1805년 6월 4일 빌뇌브를 뒤쫓아 대서양을 건넌 넬슨이 이곳에 닿았습니다.', { edge: 'w' }),
  brest: r('brest', '브레스트', 'Brest', -4.49, 48.38, 3, 'bay', '프랑스 대서양 함대의 군항입니다. 강톰의 전열함 스물한 척이 1805년 내내 콘월리스의 해협 함대에 봉쇄되어 있었습니다.', { capitalOf: 'france' }),
  lorient: r('lorient', '로리앙', 'Lorient', -3.37, 47.75, 1, 'bay', '브르타뉴 남쪽 해안의 군항이자 조선소입니다. 옛 동인도 회사의 항구였습니다.'),
  rochefort: r('rochefort', '로슈포르', 'Rochefort', -0.96, 45.94, 2, 'bay', '샤랑트강의 군항입니다. 1805년 1월 11일 미시에시의 전열함 다섯 척이 봉쇄를 빠져나가 서인도로 떠났습니다.'),
  cherbourg: r('cherbourg', '셰르부르', 'Cherbourg', -1.62, 49.64, 1, 'bay', '코탕탱 반도 끝의 항구입니다. 루이 16세 때부터 큰 방파제를 쌓아 해협의 군항으로 만들고 있었습니다.'),
  boulogne: r('boulogne', '불로뉴', 'Boulogne', 1.6, 50.73, 2, 'bay', '영국 침공을 기다리던 대육군의 진영과 평저선 선단이 모인 항구입니다. 1805년 8월 나폴레옹은 이곳에서 군대를 돌려 오스트리아로 향했습니다.'),
  toulon: r('toulon', '툴롱', 'Toulon', 5.93, 43.12, 3, 'bay', '프랑스 지중해 함대의 군항입니다. 1805년 3월 30일 빌뇌브의 전열함 열한 척이 넬슨의 감시를 피해 이곳을 떠났습니다.'),
  taranto: r('taranto', '타란토', 'Taranto', 17.23, 40.47, 1, 'bay', '1803년부터 구비옹 생시르의 프랑스군이 점령한 아풀리아의 항구입니다. 나폴리 왕국 자체는 중립이었습니다.'),
  martinique: r('martinique', '마르티니크', 'Martinique', -61.07, 14.6, 2, 'bay', '프랑스령 서인도의 섬입니다. 1805년 5월 14일 빌뇌브의 연합 함대가 포르드프랑스에 닿았고, 6월 2일 영국이 지키던 다이아몬드 바위를 되찾았습니다.', { edge: 'w' }),
  cadiz: r('cadiz', '카디스', 'Cádiz', -6.29, 36.53, 3, 'bay', '라 카라카 조선소가 있는 에스파냐 해군의 본거지입니다. 1805년 8월 20일 연합 함대가 들어왔고, 10월 19일 이곳에서 나가 트라팔가르로 향했습니다.', { capitalOf: 'spain1805' }),
  ferrol: r('ferrol', '페롤', 'Ferrol', -8.23, 43.48, 2, 'bay', '갈리시아의 에스파냐 군항입니다. 그란다야나의 에스파냐 함대와 구르동의 프랑스 전대가 이곳에 묶여 있었고, 8월 빌뇌브가 이들을 데리고 나갔습니다.'),
  vigo: r('vigo', '비고', 'Vigo', -8.8, 42.1, 1, 'bay', '갈리시아 남쪽의 깊은 만입니다. 피니스테레 해전 뒤 빌뇌브가 부서진 함선 셋을 이곳에 남겼습니다.'),
  cartagena: r('cartagena', '카르타헤나', 'Cartagena', -0.98, 37.6, 2, 'bay', '에스파냐 지중해 함대의 군항이자 조선소입니다. 살세도의 전열함 여섯 척이 1805년 내내 이곳에 머물렀습니다.'),
  mahon: r('mahon', '마온', 'Mahón', 4.27, 39.89, 1, 'island', '메노르카섬의 깊은 항구입니다. 1798년 영국이 점령했다가 1802년 아미앵 조약으로 에스파냐에 돌려주었습니다.'),
  trafalgar: r('trafalgar', '트라팔가르곶', 'Cabo Trafalgar', -6.03, 36.18, 1, 'open', '카디스와 지브롤터 사이의 낮은 곶입니다. 1805년 10월 21일 넬슨과 콜링우드의 두 종렬이 이 앞바다에서 연합 함대의 대열을 끊었습니다.'),
  finisterre: r('finisterre', '피니스테레곶', 'Cabo Finisterre', -9.6, 43.0, 1, 'open', '갈리시아 서쪽 끝의 곶입니다. 1805년 7월 22일 짙은 안개 속에서 콜더가 서인도에서 돌아오던 빌뇌브를 막아 에스파냐 함선 두 척을 붙잡았습니다.'),
};

/** The sea lanes of the theatre, each listed once: [a, b, turns]. */
export const TRAFALGAR_EDGES: [TrafalgarId, TrafalgarId, 1 | 2 | 3][] = [
  // The Channel and the narrow seas.
  ['deal', 'spithead', 1], ['deal', 'boulogne', 1], ['boulogne', 'cherbourg', 1], ['spithead', 'cherbourg', 1], ['spithead', 'torbay', 1],
  ['torbay', 'plymsound', 1], ['plymsound', 'cork', 1], ['plymsound', 'brest', 1], ['torbay', 'brest', 1],
  // The Bay of Biscay and Galicia.
  ['brest', 'lorient', 1], ['lorient', 'rochefort', 1], ['cork', 'brest', 2], ['brest', 'ferrol', 2], ['rochefort', 'ferrol', 2],
  ['ferrol', 'finisterre', 1], ['finisterre', 'vigo', 1], ['cork', 'finisterre', 2],
  // Down the coast of Portugal to Cádiz and the Strait.
  ['vigo', 'cadiz', 2], ['finisterre', 'cadiz', 2], ['cadiz', 'trafalgar', 1], ['trafalgar', 'gibraltar', 1], ['cadiz', 'gibraltar', 1],
  // The western Mediterranean.
  ['gibraltar', 'cartagena', 1], ['cartagena', 'mahon', 1], ['cartagena', 'toulon', 2], ['mahon', 'toulon', 1], ['toulon', 'maddalena', 1],
  ['mahon', 'maddalena', 2], ['maddalena', 'valletta', 2], ['valletta', 'taranto', 2], ['maddalena', 'taranto', 2], ['gibraltar', 'valletta', 3],
  // Across the Atlantic: the trade winds out by the Canaries, the westerlies home.
  ['cadiz', 'martinique', 3], ['rochefort', 'martinique', 3], ['martinique', 'barbados', 1], ['barbados', 'gibraltar', 3], ['martinique', 'finisterre', 3],
  ['barbados', 'cork', 3],
];

/**
 * The commanders of 1805 (src/sim/trafalgar.ts for those in its battles), with the chapter's portraits. Hardy was the
 * Victory's flag captain and Lucas the Redoutable's captain; the campaign lets them lead squadrons of their own.
 * Blackwood took command of the frigate Euryalus in 1805 and brought the news of the Combined Fleet at Cádiz to
 * London on 2 September; he joins in the autumn.
 */
export const TRAFALGAR_COMMANDERS: CommanderDef[] = [
  { id: 'nelson', faction: 'britain', name: '허레이쇼 넬슨', title: '지중해 함대 사령관 · 해군 중장', portrait: 'portrait_nelson', level: 3 },
  { id: 'cornwallis', faction: 'britain', name: '윌리엄 콘월리스', title: '해협 함대 사령관 · 해군 대장', portrait: 'portrait_cornwallis', level: 3 },
  { id: 'collingwood', faction: 'britain', name: '커스버트 콜링우드', title: '해군 중장', portrait: 'portrait_collingwood', level: 2 },
  // Hardy and Lucas were flag and ship captains, never squadron commanders: their squadrons here are game licence (said in their titles).
  { id: 'calder', faction: 'britain', name: '로버트 콜더', title: '해군 중장 · 페롤 봉쇄 함대 사령관', portrait: 'portrait_calder', level: 2 },
  { id: 'hardy', faction: 'britain', name: '토머스 하디', title: '빅토리호 함장 · 전대 지휘는 게임 설정', portrait: 'portrait_hardy', level: 1, joins: 1 },
  { id: 'blackwood', faction: 'britain', name: '헨리 블랙우드', title: '유리알러스호 함장 · 프리깃 전대', portrait: 'portrait_blackwood', level: 1, joins: 4 },
  { id: 'villeneuve', faction: 'france', name: '피에르 빌뇌브', title: '툴롱 함대 사령관 · 해군 중장', portrait: 'portrait_villeneuve', level: 2 },
  { id: 'ganteaume', faction: 'france', name: '오노레 강톰', title: '브레스트 함대 사령관 · 해군 중장', portrait: 'portrait_ganteaume', level: 2 },
  { id: 'missiessy', faction: 'france', name: '에두아르 드 미시에시', title: '로슈포르 전대 사령관 · 해군 소장', portrait: 'portrait_missiessy', level: 2 },
  { id: 'lucas', faction: 'france', name: '장자크 뤼카', title: '르두타블호 함장 · 전대 지휘는 게임 설정', portrait: 'portrait_lucas', level: 1, joins: 1 },
  { id: 'gravina', faction: 'spain1805', name: '페데리코 그라비나', title: '에스파냐 함대 사령관 · 해군 중장', portrait: 'portrait_gravina', level: 3 },
  { id: 'alava', faction: 'spain1805', name: '이그나시오 마리아 데 알라바', title: '에스파냐 함대 부사령관 · 해군 중장', portrait: 'portrait_alava', level: 2 },
  { id: 'churruca', faction: 'spain1805', name: '코스메 다미안 추루카', title: '산후안 네포무세노호 함장 · 준장', portrait: 'portrait_churruca', level: 2 },
];

/**
 * January 1805: Nelson's Mediterranean fleet (eleven of the line, the Victory his flag) off Sardinia watching Toulon,
 * where Villeneuve has eleven; Cornwallis's Channel Fleet in Torbay between its cruises off Brest, where Ganteaume has
 * twenty-one; Calder and Collingwood with the western squadrons; Lord Keith's ships in the Downs; Missiessy's five at
 * Rochefort on the eve of his sortie; Gourdon's four French ships and the Spanish squadron in Ferrol; Gravina's ships
 * fitting out at Cádiz and Salcedo's six at Cartagena (Corbett 1910, chs. 1-3; Desbrière 1907). The squadrons are the
 * chapter's scale, not the full lists.
 */
export const TRAFALGAR_START: StartSetup = {
  owners: {
    spithead: 'britain', plymsound: 'britain', torbay: 'britain', deal: 'britain', cork: 'britain', gibraltar: 'britain', valletta: 'britain',
    maddalena: 'britain', barbados: 'britain',
    brest: 'france', lorient: 'france', rochefort: 'france', cherbourg: 'france', boulogne: 'france', toulon: 'france', taranto: 'france', martinique: 'france',
    cadiz: 'spain1805', ferrol: 'spain1805', vigo: 'spain1805', cartagena: 'spain1805', mahon: 'spain1805', trafalgar: 'spain1805', finisterre: 'spain1805',
  },
  buildings: {
    spithead: { camp: 2, shipyard: 2, dock: 1 },
    plymsound: { camp: 1, shipyard: 2, dock: 1 },
    torbay: { camp: 1 },
    deal: { beacon: 1 },
    cork: { camp: 1 },
    gibraltar: { camp: 1, battery: 2 },
    valletta: { camp: 1, battery: 1 },
    brest: { camp: 2, shipyard: 2, dock: 1, battery: 1 },
    lorient: { shipyard: 1 },
    rochefort: { camp: 1, shipyard: 1 },
    cherbourg: { battery: 1 },
    boulogne: { camp: 2, battery: 1 },
    toulon: { camp: 1, shipyard: 2, dock: 1, battery: 1 },
    martinique: { battery: 1 },
    cadiz: { camp: 2, shipyard: 2, dock: 1, battery: 1 },
    ferrol: { camp: 1, shipyard: 2 },
    cartagena: { camp: 1, shipyard: 1 },
    mahon: { battery: 1 },
  },
  fleets: [
    { faction: 'britain', at: 'maddalena', name: '지중해 함대', ships: { firstrate: 1, gb74: 9, gbfrigate: 2 }, commander: 'nelson' },
    { faction: 'britain', at: 'torbay', name: '해협 함대', ships: { firstrate: 2, gb74: 10 }, commander: 'cornwallis' },
    { faction: 'britain', at: 'plymsound', name: '콜링우드 전대', ships: { firstrate: 1, gb74: 5 }, commander: 'collingwood' },
    { faction: 'britain', at: 'plymsound', name: '콜더 전대', ships: { gb74: 7, gbfrigate: 1 }, commander: 'calder' },
    { faction: 'britain', at: 'deal', name: '북해 전대', ships: { gb74: 3, gbfrigate: 3 }, commander: null },
    { faction: 'britain', at: 'gibraltar', name: '지브롤터 전대', ships: { gbfrigate: 2 }, commander: null },
    { faction: 'britain', at: 'barbados', name: '리워드 제도 전대', ships: { gb74: 2, gbfrigate: 1 }, commander: null },
    { faction: 'france', at: 'toulon', name: '툴롱 함대', ships: { fr80: 2, fr74: 9 }, commander: 'villeneuve' },
    { faction: 'france', at: 'brest', name: '브레스트 함대', ships: { fr80: 3, fr74: 12 }, commander: 'ganteaume' },
    { faction: 'france', at: 'rochefort', name: '로슈포르 전대', ships: { fr80: 1, fr74: 4 }, commander: 'missiessy' },
    { faction: 'france', at: 'ferrol', name: '구르동 전대', ships: { fr74: 4 }, commander: null },
    { faction: 'spain1805', at: 'cadiz', name: '그라비나 전대', ships: { es74: 6 }, commander: 'gravina' },
    { faction: 'spain1805', at: 'cadiz', name: '카디스 함대', ships: { trinidad: 1, es74: 3 }, commander: 'alava' },
    { faction: 'spain1805', at: 'ferrol', name: '페롤 함대', ships: { es74: 6 }, commander: 'churruca' },
    { faction: 'spain1805', at: 'cartagena', name: '카르타헤나 전대', ships: { es74: 6 }, commander: null },
  ],
  gold: { britain: 1300, france: 1100, spain1805: 900 },
};
