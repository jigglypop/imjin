import type { ItemBase } from './loot';

/**
 * The loot of the other chapters (1588 Armada, 1571 Lepanto, 1805 Trafalgar): each piece belongs to its era, and a
 * piece of one culture (a firman, the Golden Fleece, an Admiralty commission) only to the navies of that culture. A
 * chapter's battles drop only its own era's pieces (loot.ts rollDrops). `model` names the chapter sword a figure can
 * hold (public/models/generals/parts/weapon_<model>.glb); the rest are icons (public/ui/items, scripts/item-icons.mjs).
 */
const EN_ES = ['england', 'spain'] as const;
const W16 = ['england', 'spain', 'holyleague'] as const;

export const ERA_BASES: readonly ItemBase[] = [
  // 1588 and 1571: the sixteenth-century European pieces both wars share.
  { id: 'w_rapier', slot: 'weapon', name: '레이피어', hanja: 'Rapier', line: '휘감긴 손잡이의 길고 곧은 양날검', eras: ['armada', 'lepanto'], factions: W16, model: 'rapier', bias: ['dex', 'str'] },
  { id: 'w_pike16', slot: 'weapon', name: '등선 장창', hanja: 'Boarding pike', line: '뱃전을 넘어오는 적을 막는 긴 창', eras: ['armada', 'lepanto'], factions: W16, bias: ['str', 'vit'] },
  { id: 'a_morion', slot: 'armor', name: '모리온', hanja: 'Morion', line: '앞뒤가 솟은 에스파냐식 강철 투구', eras: ['armada', 'lepanto'], factions: W16, bias: ['vit'] },
  { id: 'a_cabasset', slot: 'armor', name: '카바세', hanja: 'Cabasset', line: '꼭지가 뾰족한 아몬드 모양 투구', eras: ['armada', 'lepanto'], factions: W16, bias: ['vit', 'dex'] },
  { id: 'a_breastplate', slot: 'armor', name: '흉갑', hanja: 'Peto', line: '총탄 자국으로 시험한 강철 가슴 갑옷', eras: ['armada', 'lepanto'], factions: W16, bias: ['vit', 'str'] },
  { id: 'a_gorget', slot: 'armor', name: '고짓', hanja: 'Gorget', line: '목을 감싸는 장교의 강철 깃', eras: ['armada', 'lepanto'], factions: W16, bias: ['vit', 'int'] },
  { id: 't_astrolabe', slot: 'trinket', name: '항해용 아스트롤라베', hanja: 'Astrolabe', line: '해 높이로 위도를 재는 놋쇠 고리', eras: ['armada', 'lepanto'], bias: ['int', 'dex'] },
  { id: 'b_vegetius', slot: 'book', name: '군사론', hanja: 'De re militari', line: '베게티우스가 쓴 로마의 병법', eras: ['armada', 'lepanto'], factions: W16, bias: ['int', 'vit'] },

  // 1588.
  { id: 'w_ropera', slot: 'weapon', name: '에스파다 로페라', hanja: 'Espada ropera', line: '고리 손잡이의 에스파냐 궁정검', eras: ['armada'], factions: ['spain'], bias: ['dex', 'int'] },
  { id: 'w_hanger', slot: 'weapon', name: '행어', hanja: 'Hanger', line: '잉글랜드 선원의 짧고 휜 칼', eras: ['armada'], factions: ['england'], bias: ['str', 'dex'] },
  { id: 't_fleece', slot: 'trinket', name: '황금양털 기사단 훈장', hanja: 'Toisón de Oro', line: '펠리페 2세가 내린 황금 양 목걸이', eras: ['armada'], factions: ['spain'], bias: ['int', 'vit'] },
  { id: 't_chart', slot: 'trinket', name: '해협 해도', hanja: 'Sea chart', line: '수심과 모래톱을 적은 영국 해협의 해도', eras: ['armada'], factions: EN_ES, bias: ['int', 'dex'] },
  { id: 'b_arte', slot: 'book', name: '항해술', hanja: 'Arte de navegar', line: '페드로 데 메디나의 항해 교본', eras: ['armada'], factions: ['spain'], bias: ['int', 'dex'] },
  { id: 'b_mirror', slot: 'book', name: '선원의 거울', hanja: "The Mariner's Mirror", line: '1588년 영어로 옮긴 바헤나르의 해도집', eras: ['armada'], factions: ['england'], bias: ['int'] },
  { id: 's_marque', slot: 'seal', name: '사략 허가장', hanja: 'Letter of marque', line: '여왕의 봉인이 찍힌 나포 허가장', eras: ['armada'], factions: ['england'], bias: ['str', 'dex'] },
  { id: 's_cedula', slot: 'seal', name: '왕의 칙서', hanja: 'Real cédula', line: '"짐, 국왕"이라 서명한 펠리페 2세의 칙서', eras: ['armada'], factions: ['spain'], bias: ['int', 'vit'] },

  // 1571.
  { id: 'w_kilij', slot: 'weapon', name: '킬리지', hanja: 'Kılıç', line: '끝이 넓어지는 깊게 휜 오스만 군도', eras: ['lepanto'], factions: ['ottoman'], model: 'kilij', bias: ['str', 'dex'] },
  { id: 'w_yatagan', slot: 'weapon', name: '야타간', hanja: 'Yatağan', line: '안쪽으로 휜 예니체리의 단검', eras: ['lepanto'], factions: ['ottoman'], bias: ['dex', 'str'] },
  { id: 'a_zirh', slot: 'armor', name: '즈르흐', hanja: 'Zırh', line: '철판을 엮은 오스만의 사슬 갑옷', eras: ['lepanto'], factions: ['ottoman'], bias: ['vit', 'str'] },
  { id: 'a_kaftan', slot: 'armor', name: '카프탄', hanja: 'Kaftan', line: '술탄이 내린 금실 비단 겉옷', eras: ['lepanto'], factions: ['ottoman'], bias: ['int', 'vit'] },
  { id: 't_banner', slot: 'trinket', name: '신성동맹 깃발', hanja: 'Stendardo', line: '교황이 축복한 십자가 깃발', eras: ['lepanto'], factions: ['holyleague'], bias: ['int', 'vit'] },
  { id: 't_tug', slot: 'trinket', name: '투으', hanja: 'Tuğ', line: '말총을 매단 오스만 지휘관의 깃대', eras: ['lepanto'], factions: ['ottoman'], bias: ['int', 'str'] },
  { id: 'b_bahriye', slot: 'book', name: '바다의 책', hanja: 'Kitab-ı Bahriye', line: '피리 레이스의 지중해 항해서', eras: ['lepanto'], factions: ['ottoman'], bias: ['int', 'dex'] },
  { id: 's_firman', slot: 'seal', name: '피르만', hanja: 'Ferman', line: '술탄의 투으라가 그려진 칙령', eras: ['lepanto'], factions: ['ottoman'], bias: ['int', 'str'] },
  { id: 's_bull', slot: 'seal', name: '교황 칙서', hanja: 'Bulla', line: '납 인장을 단 비오 5세의 칙서', eras: ['lepanto'], factions: ['holyleague'], bias: ['int', 'vit'] },
  { id: 's_doge', slot: 'seal', name: '도제의 인장', hanja: 'Sigillo del Doge', line: '산 마르코의 사자가 새겨진 베네치아 인장', eras: ['lepanto'], factions: ['holyleague'], bias: ['vit', 'int'] },

  // 1805.
  { id: 'w_naval_sword', slot: 'weapon', name: '해군 장교검', hanja: 'Sea service sword', line: '사자 머리 손잡이의 1805년식 영국 해군검', eras: ['trafalgar'], factions: ['britain'], model: 'naval_sword', bias: ['str', 'int'] },
  { id: 'w_sabre_fr', slot: 'weapon', name: '해군 사브르', hanja: "Sabre d'abordage", line: '닻 문양 손잡이의 프랑스 해군 장교 사브르', eras: ['trafalgar'], factions: ['france'], model: 'sabre_fr', bias: ['str', 'dex'] },
  { id: 'w_espada', slot: 'weapon', name: '해군 에스파다', hanja: 'Espada de marina', line: '조개 모양 코등이의 에스파냐 해군 장교검', eras: ['trafalgar'], factions: ['spain1805'], model: 'espada', bias: ['dex', 'int'] },
  { id: 'w_smallsword', slot: 'weapon', name: '스몰소드', hanja: 'Smallsword', line: '찌르기용 가는 칼날의 장교 예검', eras: ['trafalgar'], bias: ['dex'] },
  { id: 'w_axe', slot: 'weapon', name: '등선 도끼', hanja: 'Boarding axe', line: '그물과 밧줄을 끊는 갈고리 도끼', eras: ['trafalgar'], bias: ['str'] },
  { id: 'w_pike', slot: 'weapon', name: '등선 창', hanja: 'Boarding pike', line: '뱃전을 지키는 짧은 해군 창', eras: ['trafalgar'], bias: ['str', 'vit'] },
  { id: 'a_frockcoat', slot: 'armor', name: '프록코트', hanja: 'Frock coat', line: '금단추를 단 해군 장교의 감색 코트', eras: ['trafalgar'], bias: ['vit', 'int'] },
  { id: 'a_bicorne', slot: 'armor', name: '이각모', hanja: 'Bicorne', line: '모표를 단 장교의 이각 모자', eras: ['trafalgar'], bias: ['int'] },
  { id: 'a_epaulettes', slot: 'armor', name: '견장', hanja: 'Epaulettes', line: '금실 술이 늘어진 장성의 견장', eras: ['trafalgar'], bias: ['int', 'vit'] },
  { id: 'a_sash', slot: 'armor', name: '장교 띠', hanja: 'Sash', line: '허리에 두르는 비단 장교 띠', eras: ['trafalgar'], bias: ['vit', 'dex'] },
  { id: 't_trumpet', slot: 'trinket', name: '확성 나팔', hanja: 'Speaking trumpet', line: '포성 속에 명령을 외치는 놋쇠 나팔', eras: ['trafalgar'], bias: ['int', 'str'] },
  { id: 't_telescope', slot: 'trinket', name: '망원경', hanja: 'Telescope', line: '수평선의 돛을 세는 접이식 망원경', eras: ['trafalgar'], bias: ['int', 'dex'] },
  { id: 't_sextant', slot: 'trinket', name: '육분의', hanja: 'Sextant', line: '별과 해의 높이를 재는 놋쇠 육분의', eras: ['trafalgar'], bias: ['dex', 'int'] },
  { id: 'b_signals', slot: 'book', name: '포펌 신호서', hanja: "Popham's Telegraphic Signals", line: '"영국은 각자가 의무를 다하기를 기대한다"를 올린 신호 부호집', eras: ['trafalgar'], factions: ['britain'], bias: ['int'] },
  { id: 'b_clerk', slot: 'book', name: '해군 전술론', hanja: 'An Essay on Naval Tactics', line: '대열 돌파를 논한 클러크의 전술서', eras: ['trafalgar'], factions: ['britain', 'france'], bias: ['int', 'str'] },
  { id: 'b_hoste', slot: 'book', name: '해군 전투 교범', hanja: "L'Art des armées navales", line: '오스트 신부의 함대 진형 교범', eras: ['trafalgar'], factions: ['france', 'spain1805'], bias: ['int', 'vit'] },
  { id: 'b_ordenanzas', slot: 'book', name: '해군 조례', hanja: 'Ordenanzas de la Armada', line: '1793년 에스파냐 해군 조례집', eras: ['trafalgar'], factions: ['spain1805'], bias: ['int', 'vit'] },
  { id: 's_admiralty', slot: 'seal', name: '해군성 임명장', hanja: 'Admiralty commission', line: '해군성 위원들의 봉인이 찍힌 임명장', eras: ['trafalgar'], factions: ['britain'], bias: ['int', 'str'] },
  { id: 's_legion', slot: 'seal', name: '레지옹 도뇌르', hanja: "Légion d'honneur", line: '나폴레옹이 만든 다섯 갈래 별 훈장', eras: ['trafalgar'], factions: ['france'], bias: ['str', 'vit'] },
  { id: 's_carlos3', slot: 'seal', name: '카를로스 3세 훈장', hanja: 'Orden de Carlos III', line: '하늘색과 흰색 띠의 에스파냐 훈장', eras: ['trafalgar'], factions: ['spain1805'], bias: ['vit', 'int'] },
];
