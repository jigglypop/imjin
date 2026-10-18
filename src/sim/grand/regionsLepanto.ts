import type { CommanderDef, RegionDef, StartSetup } from './regions';
import type { RegionId } from './types';

// The Lepanto theatre: the central and eastern Mediterranean in the war of the Holy League (1570–1573), from the summer
// of 1571 onward. Positions are the real ones (decimal degrees); Famagusta, Tripoli and Alexandria lie off the map's
// eastern and southern edges. Starting owners follow July 1571: Venice holds the Dalmatian ports, Corfu, the Ionian
// islands of Cephalonia and Zante, Crete and Famagusta (under siege since September 1570, it surrendered on 1 August
// 1571); Spain holds Naples, Sicily and the Otranto shore, Genoa serves Spain with Doria's galleys, the Pope holds
// Civitavecchia and the Knights of St John Malta. The Ottoman Empire holds Istanbul and the Dardanelles, Negroponte
// (since 1470), Rhodes (1522), Lepanto/Nafpaktos (1499), Modon and Navarino (1500), Preveza, Valona, Tripoli (1551) and
// Egypt (1517). The Curzolari (Echinades), off the Ottoman-held Acarnanian shore, are counted to the Ottoman side.
// The Holy League of Venice, Spain and the Papacy was concluded in Rome in May 1571; Don Juan of Austria reached Genoa
// at the end of July, Naples in August and Messina on 23 August, and the League's fleet sailed from Messina on
// 16 September. The Ottoman fleet under Müezzinzade Ali Pasha and Pertev Pasha raided Crete and the Ionian islands that
// summer, Uluç Ali the southern Adriatic, and it lay at Lepanto when the League came on 7 October.
// Sources: Capponi, Victory of the West (2006); Konstam, Lepanto 1571 (2003); Guilmartin, Gunpowder and Galleys (1974,
// rev. 2003); Braudel, The Mediterranean (1949, tr. 1972); Setton, The Papacy and the Levant, vol. IV (1984).

export const LEPANTO_REGION_ORDER = [
  'venice', 'zara', 'cattaro', 'corfu', 'cephalonia', 'zante', 'candia', 'famagusta', 'otranto', 'naples',
  'messina', 'civitavecchia', 'malta', 'genoa', 'istanbul', 'gallipoli', 'negroponte', 'rhodes', 'nafpaktos',
  'patras', 'curzolari', 'preveza', 'valona', 'modon', 'navarino', 'tripoli', 'alexandria',
] as const satisfies readonly RegionId[];

type LepantoId = (typeof LEPANTO_REGION_ORDER)[number];

const r = (id: LepantoId, name: string, hanja: string, lon: number, lat: number, value: 1 | 2 | 3, terrain: RegionDef['terrain'], blurb: string, extra: Partial<RegionDef> = {}): RegionDef => ({
  id, name, hanja, lon, lat, value, terrain, korea: false, blurb, ...extra,
});

export const LEPANTO_REGIONS: Record<LepantoId, RegionDef> = {
  venice: r('venice', '베네치아', 'Venezia', 12.35, 45.43, 3, 'bay', '아르세날레 조선소에서 갤리선을 지어 내는 베네치아 공화국의 수도입니다. 상선 대형 갤리선 여섯 척을 갈레아스로 고쳐 함대에 보냈습니다.'),
  zara: r('zara', '자라', 'Zara', 15.22, 44.12, 1, 'bay', '달마티아 해안의 베네치아 요새 도시입니다. 아드리아해를 오가는 베네치아 갤리선의 기항지입니다.'),
  cattaro: r('cattaro', '카타로', 'Cattaro', 18.77, 42.42, 1, 'bay', '깊은 만 안쪽의 베네치아 요새입니다. 1571년 여름 오스만 함대가 아드리아해 남쪽 해안을 휩쓸었습니다.'),
  corfu: r('corfu', '코르푸', 'Corfù', 19.92, 39.62, 2, 'island', '아드리아해 입구를 지키는 베네치아의 요새 섬입니다. 1537년 오스만의 포위를 견뎠습니다.'),
  cephalonia: r('cephalonia', '케팔로니아', 'Cefalonia', 20.49, 38.18, 1, 'island', '1500년부터 베네치아가 다스린 이오니아해의 섬입니다.'),
  zante: r('zante', '잔테', 'Zante', 20.9, 37.78, 1, 'island', '펠로폰네소스 서쪽 앞바다의 베네치아 섬입니다.'),
  candia: r('candia', '칸디아·크레타', 'Candia', 25.13, 35.34, 3, 'bay', '베네치아령 크레타의 수도입니다. 크레타의 갤리선들이 메시나에서 동맹 함대에 합류했습니다.'),
  famagusta: r('famagusta', '파마구스타', 'Famagusta', 33.94, 35.12, 2, 'bay', '키프로스의 마지막 베네치아 요새입니다. 마르칸토니오 브라가딘이 1570년 9월부터 포위를 견디다 1571년 8월 1일 항복했습니다.', { edge: 'e' }),
  otranto: r('otranto', '오트란토', 'Otranto', 18.49, 40.15, 1, 'bay', '아드리아해 입구의 나폴리 왕국 항구입니다. 1480년 오스만군이 점령했던 곳입니다.'),
  naples: r('naples', '나폴리', 'Napoli', 14.25, 40.84, 3, 'bay', '에스파냐 부왕령 나폴리의 수도입니다. 산타 크루스 후작 알바로 데 바산의 나폴리 갤리선단이 이곳에서 나왔습니다.'),
  messina: r('messina', '메시나', 'Messina', 15.56, 38.19, 3, 'strait', '시칠리아 해협의 항구입니다. 1571년 8월 23일 돈 후안이 도착했고, 9월 16일 신성동맹 함대가 이곳에서 출항했습니다.', { capitalOf: 'holyleague' }),
  civitavecchia: r('civitavecchia', '치비타베키아', 'Civitavecchia', 11.8, 42.09, 1, 'bay', '교황령의 군항입니다. 1571년 5월 교황 비오 5세가 로마에서 신성동맹을 맺어 냈습니다.'),
  malta: r('malta', '몰타', 'Malta', 14.51, 35.9, 2, 'island', '성 요한 기사단의 섬입니다. 1565년 오스만의 대포위를 막아 냈고, 기사단의 갤리선 세 척이 레판토에서 싸웠습니다.'),
  genoa: r('genoa', '제노바', 'Genova', 8.93, 44.41, 2, 'bay', '조반니 안드레아 도리아의 갤리선단이 나온 공화국입니다. 도리아 가문은 계약을 맺고 에스파냐 왕에게 갤리선을 내주었습니다.'),
  istanbul: r('istanbul', '이스탄불', 'İstanbul', 28.98, 41.01, 3, 'bay', '오스만 제국의 수도입니다. 금각만의 카슴파샤 조선소에서 함대를 지었고, 레판토 이듬해 봄까지 함대를 다시 지어 냈습니다.', { capitalOf: 'ottoman' }),
  gallipoli: r('gallipoli', '겔리볼루', 'Gelibolu', 26.67, 40.41, 2, 'strait', '다르다넬스 해협의 항구입니다. 오스만 해군의 첫 기지로, 함대가 에게해로 나가는 관문입니다.'),
  negroponte: r('negroponte', '네그로폰테', 'Eğriboz', 23.6, 38.46, 2, 'strait', '에우보이아섬과 본토 사이 좁은 해협의 요새입니다. 1470년 오스만이 베네치아에게서 빼앗았습니다.'),
  rhodes: r('rhodes', '로도스', 'Rodos', 28.22, 36.44, 2, 'island', '1522년 술레이만 1세가 성 요한 기사단을 몰아낸 섬입니다.'),
  nafpaktos: r('nafpaktos', '레판토', 'İnebahtı', 21.83, 38.39, 2, 'bay', '코린트만 어귀의 요새 항구입니다. 1499년 오스만이 베네치아에게서 빼앗았고, 1571년 10월 알리 파샤의 함대가 이곳에서 나와 싸웠습니다.'),
  patras: r('patras', '파트라스', 'Patras', 21.73, 38.25, 1, 'bay', '파트라스만의 항구입니다. 레판토 해전은 이 만의 어귀에서 벌어졌습니다.'),
  curzolari: r('curzolari', '쿠르촐라리 제도', 'Curzolari', 21.05, 38.38, 1, 'open', '아켈로오스강 하구 앞의 작은 섬들입니다. 1571년 10월 7일 신성동맹과 오스만 함대가 이 앞바다에서 맞붙었습니다.'),
  preveza: r('preveza', '프레베자', 'Preveze', 20.75, 38.96, 1, 'strait', '암브라키아만 입구의 요새입니다. 1538년 바르바로스 하이레딘이 안드레아 도리아의 동맹 함대를 물리쳤습니다.'),
  valona: r('valona', '발로나', 'Avlonya', 19.49, 40.47, 1, 'bay', '오트란토와 마주 보는 아드리아해 입구의 오스만 항구입니다.'),
  modon: r('modon', '모돈', 'Moton', 21.7, 36.82, 1, 'bay', '펠로폰네소스 서남쪽 끝의 요새입니다. 1500년 오스만이 베네치아에게서 빼앗았습니다.'),
  navarino: r('navarino', '나바리노', 'Navarin', 21.67, 36.91, 1, 'bay', '넓은 나바리노만의 항구입니다. 모돈과 함께 1500년부터 오스만 땅이었습니다.'),
  tripoli: r('tripoli', '트리폴리', 'Trablusgarp', 13.18, 32.89, 1, 'bay', '북아프리카의 항구입니다. 1551년 오스만이 성 요한 기사단에게서 빼앗았습니다.', { edge: 's' }),
  alexandria: r('alexandria', '알렉산드리아', 'İskenderiye', 29.92, 31.2, 2, 'bay', '1517년부터 오스만이 다스린 이집트의 항구입니다. 우익을 이끈 메흐메드 시로코가 알렉산드리아의 총독이었습니다.', { edge: 's' }),
};

/** The sea lanes of the theatre, each listed once: [a, b, turns]. */
export const LEPANTO_EDGES: [LepantoId, LepantoId, 1 | 2 | 3][] = [
  // The Tyrrhenian coast: Genoa, the Papal port, Naples and the Strait of Messina.
  ['genoa', 'civitavecchia', 2], ['civitavecchia', 'naples', 1], ['naples', 'messina', 2], ['messina', 'malta', 1], ['malta', 'tripoli', 2],
  // The Adriatic.
  ['venice', 'zara', 1], ['zara', 'cattaro', 2], ['venice', 'otranto', 3], ['cattaro', 'valona', 1], ['valona', 'otranto', 1],
  // Across the Ionian Sea.
  ['messina', 'otranto', 2], ['messina', 'corfu', 2], ['malta', 'modon', 3], ['tripoli', 'modon', 3],
  // The Ionian islands and the Gulf of Patras.
  ['otranto', 'corfu', 1], ['valona', 'corfu', 1], ['corfu', 'preveza', 1], ['preveza', 'cephalonia', 1], ['cephalonia', 'zante', 1],
  ['cephalonia', 'curzolari', 1], ['zante', 'curzolari', 1], ['curzolari', 'patras', 1], ['patras', 'nafpaktos', 1],
  ['zante', 'navarino', 1], ['navarino', 'modon', 1],
  // Round the Morea to Crete and the Aegean.
  ['modon', 'candia', 2], ['modon', 'negroponte', 3], ['candia', 'negroponte', 2], ['candia', 'rhodes', 2], ['candia', 'alexandria', 3],
  ['negroponte', 'gallipoli', 2], ['gallipoli', 'istanbul', 1], ['gallipoli', 'rhodes', 3],
  // The Levant.
  ['rhodes', 'famagusta', 2], ['rhodes', 'alexandria', 2], ['famagusta', 'alexandria', 2],
];

/** The commanders of Lepanto (src/sim/lepanto.ts), with the portraits of the chapter's battles. */
export const LEPANTO_COMMANDERS: CommanderDef[] = [
  { id: 'donjuan', faction: 'holyleague', name: '돈 후안 데 아우스트리아', title: '신성동맹 함대 총사령관', portrait: 'portrait_donjuan', level: 2 },
  { id: 'venier', faction: 'holyleague', name: '세바스티아노 베니에르', title: '베네치아 함대 총사령관', portrait: 'portrait_venier', level: 3 },
  { id: 'barbarigo', faction: 'holyleague', name: '아고스티노 바르바리고', title: '베네치아 함대 부사령관', portrait: 'portrait_barbarigo', level: 2 },
  { id: 'doria', faction: 'holyleague', name: '조반니 안드레아 도리아', title: '제노바 제독', portrait: 'portrait_doria', level: 2 },
  { id: 'alipasha', faction: 'ottoman', name: '뮈에진자데 알리 파샤', title: '오스만 함대 대제독(카푸단 파샤)', portrait: 'portrait_alipasha', level: 2 },
  { id: 'pertev', faction: 'ottoman', name: '페르테브 파샤', title: '원정군 총사령관(세르다르)', portrait: 'portrait_pertev', level: 2 },
  { id: 'uluc', faction: 'ottoman', name: '울루치 알리', title: '알제 총독', portrait: 'portrait_uluc', level: 3 },
  { id: 'siroco', faction: 'ottoman', name: '메흐메드 시로코', title: '알렉산드리아 총독', portrait: 'portrait_siroco', level: 2 },
];

/**
 * July 1571: the Venetian fleet at Messina (it came there from Corfu on 23 July), Don Juan and Doria's galleys at Genoa
 * on their way south, the Naples squadron at home, the Cretan galleys still at Candia; the Ottoman fleet in the Morea's
 * and Albania's ports after its raids, Siroco's Egyptian squadron at Alexandria. Numbers are the chapter's scale.
 */
export const LEPANTO_START: StartSetup = {
  owners: {
    venice: 'holyleague', zara: 'holyleague', cattaro: 'holyleague', corfu: 'holyleague', cephalonia: 'holyleague', zante: 'holyleague',
    candia: 'holyleague', famagusta: 'holyleague', otranto: 'holyleague', naples: 'holyleague', messina: 'holyleague', civitavecchia: 'holyleague',
    malta: 'holyleague', genoa: 'holyleague',
    istanbul: 'ottoman', gallipoli: 'ottoman', negroponte: 'ottoman', rhodes: 'ottoman', nafpaktos: 'ottoman', patras: 'ottoman',
    curzolari: 'ottoman', preveza: 'ottoman', valona: 'ottoman', modon: 'ottoman', navarino: 'ottoman', tripoli: 'ottoman', alexandria: 'ottoman',
  },
  buildings: {
    venice: { camp: 1, shipyard: 2, dock: 1 },
    messina: { camp: 2, shipyard: 1, dock: 1 },
    naples: { camp: 1, shipyard: 1 },
    genoa: { shipyard: 1 },
    corfu: { camp: 1, battery: 1 },
    candia: { camp: 1, battery: 1 },
    famagusta: { battery: 1 },
    malta: { battery: 1 },
    otranto: { beacon: 1 },
    istanbul: { camp: 2, shipyard: 2, dock: 1 },
    gallipoli: { camp: 1, shipyard: 1 },
    negroponte: { camp: 1 },
    nafpaktos: { camp: 1, battery: 1 },
    preveza: { battery: 1 },
    modon: { battery: 1 },
    rhodes: { battery: 1 },
    alexandria: { shipyard: 1 },
  },
  fleets: [
    { faction: 'holyleague', at: 'messina', name: '베네치아 함대', ships: { galea: 10, vgalleass: 2 }, commander: 'venier' },
    { faction: 'holyleague', at: 'messina', name: '바르바리고 전대', ships: { galea: 8 }, commander: 'barbarigo' },
    { faction: 'holyleague', at: 'genoa', name: '돈 후안 전대', ships: { reale: 1, galea: 6 }, commander: 'donjuan' },
    { faction: 'holyleague', at: 'genoa', name: '도리아 전대', ships: { galea: 6 }, commander: 'doria' },
    { faction: 'holyleague', at: 'naples', name: '나폴리 갤리선단', ships: { galea: 5 }, commander: null },
    { faction: 'holyleague', at: 'candia', name: '크레타 갤리선단', ships: { galea: 4 }, commander: null },
    { faction: 'ottoman', at: 'modon', name: '알리 파샤 본대', ships: { sultana: 1, kadirga: 12, kalyata: 4 }, commander: 'alipasha' },
    { faction: 'ottoman', at: 'nafpaktos', name: '페르테브 전대', ships: { kadirga: 8, kalyata: 4 }, commander: 'pertev' },
    { faction: 'ottoman', at: 'valona', name: '울루치 알리 전대', ships: { kadirga: 6, kalyata: 6 }, commander: 'uluc' },
    { faction: 'ottoman', at: 'alexandria', name: '이집트 갤리선단', ships: { kadirga: 6, kalyata: 2 }, commander: 'siroco' },
    { faction: 'ottoman', at: 'istanbul', name: '이스탄불 예비대', ships: { kadirga: 4 }, commander: null },
  ],
  gold: { holyleague: 1200, ottoman: 1100 },
};
