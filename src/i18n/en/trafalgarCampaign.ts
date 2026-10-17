/** The Trafalgar theatre's faction campaign (src/sim/grand/regionsTrafalgar.ts, theatre.ts, growthData.ts): ports, fleets, commanders, techs, picks. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Port names in the region list and on the battle maps. */
const PORT_NAMES: Record<string, string> = {
  '포츠머스': 'Portsmouth',
  '스핏헤드': 'Spithead',
  '플리머스': 'Plymouth',
  '플리머스 사운드': 'Plymouth Sound',
  '토베이': 'Torbay',
  '다운스': 'The Downs',
  '코크': 'Cork',
  '코브': 'Cove of Cork',
  '지브롤터': 'Gibraltar',
  '몰타': 'Malta',
  '그랜드 하버': 'Grand Harbour',
  '마달레나 제도': 'The Maddalena Islands',
  '애진코트 해협': 'Agincourt Sound',
  '바베이도스': 'Barbados',
  '칼라일만': 'Carlisle Bay',
  '브레스트': 'Brest',
  '브레스트 수로': 'Goulet de Brest',
  '로리앙': 'Lorient',
  '로슈포르': 'Rochefort',
  '엑스 정박지': "Rade d'Aix",
  '셰르부르': 'Cherbourg',
  '불로뉴': 'Boulogne',
  '툴롱': 'Toulon',
  '타란토': 'Taranto',
  '마르티니크': 'Martinique',
  '포르드프랑스': 'Fort-de-France',
  '카디스': 'Cádiz',
  '페롤': 'Ferrol',
  '비고': 'Vigo',
  '카르타헤나': 'Cartagena',
  '마온': 'Mahón',
  '트라팔가르곶': 'Cape Trafalgar',
  '피니스테레곶': 'Cape Finisterre',
};

export const EN_TRAFALGAR_CAMPAIGN: Record<string, string> = {
  ...PORT_NAMES,
  // Region notes
  '왕립 해군 조선소가 있는 영국 해군의 본거지입니다. 1805년 9월 14일 넬슨이 이곳에서 빅토리호에 올라 카디스로 떠났습니다.':
    "The Royal Navy's home port and its dockyard. Nelson went aboard the Victory here on September 14, 1805, and sailed for Cádiz.",
  '플리머스 독(데번포트) 조선소의 항구입니다. 브레스트를 봉쇄하는 해협 함대가 이곳에서 정비했습니다.':
    'The port of Plymouth Dock (Devonport) and its dockyard, where the Channel Fleet blockading Brest refitted.',
  '서풍이 거세면 해협 함대가 피해 들어오던 정박지입니다. 서풍이 부는 동안은 브레스트의 프랑스 함대도 나오지 못했습니다.':
    'The anchorage where the Channel Fleet sheltered from westerly gales; while they blew, the French fleet in Brest could not come out either.',
  '딜 앞바다의 정박지입니다. 키스 경의 북해 함대가 불로뉴의 침공 선단을 지켜보았고, 해군성까지 셔터 신호소가 이어졌습니다.':
    "The anchorage off Deal. Lord Keith's North Sea fleet watched the invasion flotilla at Boulogne from here, and a chain of shutter telegraphs ran to the Admiralty.",
  '아일랜드 남쪽 코브의 정박지입니다. 서인도와 지중해로 가는 호송 선단이 이곳에 모였습니다.':
    'The anchorage of the Cove of Cork in southern Ireland, where the convoys for the West Indies and the Mediterranean gathered.',
  '1704년부터 영국이 지킨 해협의 요새입니다. 1805년 7월 넬슨이 서인도에서 돌아와 이곳에 상륙했습니다.':
    'The fortress on the Strait, British since 1704. Nelson came ashore here on his return from the West Indies in July 1805.',
  '1800년 9월 프랑스 수비대가 항복한 뒤 영국이 지킨 섬입니다. 아미앵 조약의 반환 약속을 지키지 않은 것이 1803년 전쟁 재개의 빌미가 되었습니다.':
    "The island Britain has held since the French garrison surrendered in September 1800. Britain's refusal to give it up under the Peace of Amiens was a cause of the war's renewal in 1803.",
  '사르데냐 북쪽의 섬들 사이 애진코트 해협입니다. 중립국 사르데냐의 바다였지만, 툴롱을 지켜보던 넬슨의 함대가 이곳에서 물과 식량을 실었습니다.':
    "Agincourt Sound among the islands north of Sardinia. The waters were neutral Sardinia's, but Nelson's fleet watching Toulon took on water and provisions here.",
  '영국 리워드 제도 기지의 섬입니다. 1805년 6월 4일 빌뇌브를 뒤쫓아 대서양을 건넌 넬슨이 이곳에 닿았습니다.':
    "The island of the British Leeward Islands station. Nelson, chasing Villeneuve across the Atlantic, arrived here on June 4, 1805.",
  '프랑스 대서양 함대의 군항입니다. 강톰의 전열함 스물한 척이 1805년 내내 콘월리스의 해협 함대에 봉쇄되어 있었습니다.':
    "The naval port of France's Atlantic fleet. Ganteaume's twenty-one ships of the line lay blockaded here by Cornwallis's Channel Fleet all through 1805.",
  '브르타뉴 남쪽 해안의 군항이자 조선소입니다. 옛 동인도 회사의 항구였습니다.': 'A naval port and dockyard on the south coast of Brittany, once the port of the French East India Company.',
  '샤랑트강의 군항입니다. 1805년 1월 11일 미시에시의 전열함 다섯 척이 봉쇄를 빠져나가 서인도로 떠났습니다.':
    "The naval port on the Charente. On January 11, 1805, Missiessy's five ships of the line slipped the blockade and sailed for the West Indies.",
  '코탕탱 반도 끝의 항구입니다. 루이 16세 때부터 큰 방파제를 쌓아 해협의 군항으로 만들고 있었습니다.':
    'The port at the tip of the Cotentin, being made a Channel naval base behind the great breakwater begun under Louis XVI.',
  '영국 침공을 기다리던 대육군의 진영과 평저선 선단이 모인 항구입니다. 1805년 8월 나폴레옹은 이곳에서 군대를 돌려 오스트리아로 향했습니다.':
    'The port of the camp of the Grande Armée and its flotilla of flat-bottomed boats, waiting to invade England. In August 1805 Napoleon turned the army from here towards Austria.',
  '프랑스 지중해 함대의 군항입니다. 1805년 3월 30일 빌뇌브의 전열함 열한 척이 넬슨의 감시를 피해 이곳을 떠났습니다.':
    "The naval port of France's Mediterranean fleet. On March 30, 1805, Villeneuve's eleven ships of the line left it, slipping Nelson's watch.",
  '1803년부터 구비옹 생시르의 프랑스군이 점령한 아풀리아의 항구입니다. 나폴리 왕국 자체는 중립이었습니다.':
    "An Apulian port occupied by Gouvion Saint-Cyr's French troops since 1803; the Kingdom of Naples itself was neutral.",
  '프랑스령 서인도의 섬입니다. 1805년 5월 14일 빌뇌브의 연합 함대가 포르드프랑스에 닿았고, 6월 2일 영국이 지키던 다이아몬드 바위를 되찾았습니다.':
    "The island of the French West Indies. Villeneuve's Combined Fleet reached Fort-de-France on May 14, 1805, and retook the British-held Diamond Rock on June 2.",
  '라 카라카 조선소가 있는 에스파냐 해군의 본거지입니다. 1805년 8월 20일 연합 함대가 들어왔고, 10월 19일 이곳에서 나가 트라팔가르로 향했습니다.':
    "The Spanish navy's home port with the dockyard of La Carraca. The Combined Fleet came in on August 20, 1805, and sailed from here for Trafalgar on October 19.",
  '갈리시아의 에스파냐 군항입니다. 그란다야나의 에스파냐 함대와 구르동의 프랑스 전대가 이곳에 묶여 있었고, 8월 빌뇌브가 이들을 데리고 나갔습니다.':
    "The Spanish naval port in Galicia. Grandallana's Spanish ships and Gourdon's French squadron lay blockaded here until Villeneuve took them out in August.",
  '갈리시아 남쪽의 깊은 만입니다. 피니스테레 해전 뒤 빌뇌브가 부서진 함선 셋을 이곳에 남겼습니다.':
    'The deep ría in southern Galicia, where Villeneuve left three damaged ships after the action off Finisterre.',
  '에스파냐 지중해 함대의 군항이자 조선소입니다. 살세도의 전열함 여섯 척이 1805년 내내 이곳에 머물렀습니다.':
    "The naval port and dockyard of Spain's Mediterranean fleet. Salcedo's six ships of the line stayed here all through 1805.",
  '메노르카섬의 깊은 항구입니다. 1798년 영국이 점령했다가 1802년 아미앵 조약으로 에스파냐에 돌려주었습니다.':
    'The deep harbour of Minorca, taken by Britain in 1798 and returned to Spain by the Peace of Amiens in 1802.',
  '카디스와 지브롤터 사이의 낮은 곶입니다. 1805년 10월 21일 넬슨과 콜링우드의 두 종렬이 이 앞바다에서 연합 함대의 대열을 끊었습니다.':
    "The low cape between Cádiz and Gibraltar. Off it, on October 21, 1805, Nelson's and Collingwood's two columns broke the Combined Fleet's line.",
  '갈리시아 서쪽 끝의 곶입니다. 1805년 7월 22일 짙은 안개 속에서 콜더가 서인도에서 돌아오던 빌뇌브를 막아 에스파냐 함선 두 척을 붙잡았습니다.':
    'The western cape of Galicia. In thick fog on July 22, 1805, Calder met Villeneuve returning from the West Indies and took two Spanish ships.',
  // Navies, fleets, commanders
  '영국과 프랑스·에스파냐 연합이 해협과 대서양, 지중해의 물길을 두고 맞섭니다.': 'Britain faces the alliance of France and Spain for the sea roads of the Channel, the Atlantic and the Mediterranean.',
  '영국': 'Britain',
  '프랑스': 'France',
  '영국 해군': 'Royal Navy',
  '프랑스 해군': 'French navy',
  '에스파냐 해군': 'Spanish navy',
  '영국 수군': 'Royal Navy',
  '프랑스 수군': 'French navy',
  '지중해 함대': 'The Mediterranean Fleet',
  '해협 함대': 'The Channel Fleet',
  '콜링우드 전대': "Collingwood's squadron",
  '콜더 전대': "Calder's squadron",
  '북해 전대': 'The North Sea squadron',
  '지브롤터 전대': 'The Gibraltar squadron',
  '리워드 제도 전대': 'The Leeward Islands squadron',
  '툴롱 함대': 'The Toulon fleet',
  '브레스트 함대': 'The Brest fleet',
  '로슈포르 전대': 'The Rochefort squadron',
  '구르동 전대': "Gourdon's squadron",
  '그라비나 전대': "Gravina's squadron",
  '카디스 함대': 'The Cádiz fleet',
  '페롤 함대': 'The Ferrol fleet',
  '카르타헤나 전대': 'The Cartagena squadron',
  '해군성의 증원 함대': 'Admiralty reinforcements',
  '황제의 함대': "The Emperor's ships",
  '국왕의 함대': "The King's ships",
  '허레이쇼 넬슨': 'Horatio Nelson',
  '윌리엄 콘월리스': 'William Cornwallis',
  '커스버트 콜링우드': 'Cuthbert Collingwood',
  '로버트 콜더': 'Robert Calder',
  '토머스 하디': 'Thomas Hardy',
  '헨리 블랙우드': 'Henry Blackwood',
  '피에르 빌뇌브': 'Pierre Villeneuve',
  '오노레 강톰': 'Honoré Ganteaume',
  '에두아르 드 미시에시': 'Édouard de Missiessy',
  '장자크 뤼카': 'Jean-Jacques Lucas',
  '페데리코 그라비나': 'Federico Gravina',
  '이그나시오 마리아 데 알라바': 'Ignacio María de Álava',
  '코스메 다미안 추루카': 'Cosme Damián Churruca',
  '지중해 함대 사령관 · 해군 중장': 'Commander, Mediterranean Fleet · Vice-Admiral',
  '해협 함대 사령관 · 해군 대장': 'Commander, Channel Fleet · Admiral',
  '해군 중장': 'Vice-Admiral',
  '해군 중장 · 페롤 봉쇄 함대 사령관': 'Vice-Admiral · Commander off Ferrol',
  '빅토리호 함장': 'Captain of the Victory',
  '유리알러스호 함장 · 프리깃 전대': 'Captain of the Euryalus · the frigates',
  '툴롱 함대 사령관 · 해군 중장': 'Commander, Toulon fleet · Vice-Admiral',
  '브레스트 함대 사령관 · 해군 중장': 'Commander, Brest fleet · Vice-Admiral',
  '로슈포르 전대 사령관 · 해군 소장': 'Commander, Rochefort squadron · Rear-Admiral',
  '르두타블호 함장': 'Captain of the Redoutable',
  '에스파냐 함대 사령관 · 해군 중장': 'Commander of the Spanish fleet · Vice-Admiral',
  '에스파냐 함대 부사령관 · 해군 중장': 'Second-in-command of the Spanish fleet · Vice-Admiral',
  '산후안 네포무세노호 함장 · 준장': 'Captain of the San Juan Nepomuceno · Brigadier',
  // Commanders' traits and masteries
  '넬슨 터치': 'The Nelson Touch',
  '두 종렬로 적의 대열을 끊는 계획을 함장들과 나누었다: 사기 +8%, 명중 +4%, 대담한 지휘': 'Shared with his captains the plan to break the enemy line with two columns: morale +8%, accuracy +4%, bold command',
  '형제 함장들': 'The band of brothers',
  '함장마다 제 판단으로 싸운다: 사기 +6%, 장전 +5%, 백병 +4%': 'Every captain fights on his own judgement: morale +6%, reload +5%, melee +4%',
  '빌리 블루': 'Billy Blue',
  '해협 함대를 이끌고 겨울에도 브레스트 앞바다를 떠나지 않았다: 방어 +6%, 항속 +6%, 침착한 지휘': 'Kept the Channel Fleet off Brest through the winters: defense +6%, range +6%, steady command',
  '근접 봉쇄': 'The close blockade',
  '방어 +5%, 사기 +5%, 선회 +4%': 'Defense +5%, morale +5%, turning +4%',
  '세 번의 일제 사격': 'Three broadsides',
  '3분 30초에 일제 사격 세 번을 하도록 수병을 조련했다: 장전 +8%, 침착한 지휘': 'Drilled his crew to fire three broadsides in three and a half minutes: reload +8%, steady command',
  '풍하 종렬': 'The lee column',
  '로열 소버린호가 먼저 적진에 들었다: 명중 +5%, 사기 +5%': 'The Royal Sovereign was first into the enemy line: accuracy +5%, morale +5%',
  '피니스테레의 안개': 'The fog off Finisterre',
  '안개 속에서 두 척을 붙잡고도 다시 싸우지 않았다: 방어 +6%, 신중한 지휘': 'Took two ships in the fog and did not renew the action: defense +6%, cautious command',
  '페롤 봉쇄': 'The blockade of Ferrol',
  '방어 +5%, 항속 +6%': 'Defense +5%, range +6%',
  '빅토리호의 함장': "The Victory's captain",
  '넬슨 곁 뒷갑판에서 포화를 견딘 기함 함장: 방어 +6%, 사기 +4%, 침착한 지휘': "The flag captain who stood the fire on the quarterdeck at Nelson's side: defense +6%, morale +4%, steady command",
  '넬슨의 마지막 곁': "At Nelson's side to the last",
  '사기 +6%, 백병 +5%': 'Morale +6%, melee +5%',
  '함대의 눈': 'The eyes of the fleet',
  '카디스 앞바다에서 연합 함대를 지켜본 프리깃 전대장: 속도 +6%, 선회 +6%, 항속 +8%': 'Commander of the frigates that watched the Combined Fleet off Cádiz: speed +6%, turning +6%, range +8%',
  '유리알러스호': 'The Euryalus',
  '속도 +4%, 명중 +5%': 'Speed +4%, accuracy +5%',
  '나일의 생존자': 'Survivor of the Nile',
  '아부키르만에서 남은 함선을 이끌고 빠져나간 제독: 항속 +8%, 방어 +3%, 신중한 지휘': 'The admiral who got away from Abu Qir Bay with the ships left to him: range +8%, defense +3%, cautious command',
  '서인도 원정': 'The West Indies voyage',
  '대서양을 두 번 건넌 함대: 속도 +4%, 항속 +8%': 'A fleet that crossed the Atlantic twice: speed +4%, range +8%',
  '봉쇄 속에서 스물한 척을 출항 대기시킨 제독: 방어 +5%, 사기 +4%, 신중한 지휘': 'Kept twenty-one ships ready for sea under blockade: defense +5%, morale +4%, cautious command',
  '이집트 귀환': 'The return from Egypt',
  '1799년 보나파르트를 이집트에서 몰래 데려왔다: 항속 +8%, 사기 +4%': 'Brought Bonaparte home from Egypt unseen in 1799: range +8%, morale +4%',
  '로슈포르 탈출': 'Out of Rochefort',
  '1805년 1월 봉쇄를 빠져나가 서인도를 습격했다: 속도 +6%, 항속 +8%, 침착한 지휘': 'Slipped the blockade in January 1805 and raided the West Indies: speed +6%, range +8%, steady command',
  '도미니카 습격': 'The raid on Dominica',
  '르두타블호의 조련': "The Redoutable's drill",
  '수병들에게 수류탄과 소총을 익혀 빅토리호에 올라타려 했다: 백병 +10%, 대담한 지휘': 'Trained his men with grenades and muskets and tried to board the Victory: melee +10%, bold command',
  '망루의 소총수': 'Musketeers in the tops',
  '르두타블호 망루의 소총수가 넬슨을 쏘았다: 명중 +6%, 백병 +5%': "A musketeer in the Redoutable's tops shot Nelson: accuracy +6%, melee +5%",
  '관측 전대': 'The Squadron of Observation',
  '연합 함대의 예비대를 이끈 에스파냐 총사령관: 사기 +6%, 방어 +4%, 침착한 지휘': "Spain's commander, who led the Combined Fleet's reserve: morale +6%, defense +4%, steady command",
  '프린시페 데 아스투리아스호': 'The Príncipe de Asturias',
  '사기 +5%, 방어 +5%, 선회 +4%': 'Morale +5%, defense +5%, turning +4%',
  '산타 아나호': 'The Santa Ana',
  '로열 소버린호와 맞붙어 끝까지 싸운 부사령관: 방어 +7%, 백병 +4%, 침착한 지휘': 'The second-in-command who fought the Royal Sovereign to the end: defense +7%, melee +4%, steady command',
  '탈환의 출격': 'The sortie to retake the prizes',
  '사기 +5%, 백병 +5%': 'Morale +5%, melee +5%',
  '항해자이자 측량가': 'Navigator and surveyor',
  '마젤란 해협과 카리브해를 측량한 함장: 명중 +6%, 선회 +5%, 침착한 지휘': 'A captain who surveyed the Strait of Magellan and the Caribbean: accuracy +6%, turning +5%, steady command',
  '산후안 네포무세노호': 'The San Juan Nepomuceno',
  '여러 척에 둘러싸여도 깃발을 내리지 않았다: 방어 +6%, 사기 +6%': 'Surrounded by several ships, he would not strike his colours: defense +6%, morale +6%',
  // Techs
  '부싯돌 격발기': 'Flintlock gunlocks',
  '전 함선 장전 +8%, 명중 +3%': 'All ships reload +8%, accuracy +3%',
  '구리 피복': 'Copper sheathing',
  '속도 +5%, 선회 +4%, 항속 +6%': 'Speed +5%, turning +4%, range +6%',
  '포펌 신호서': "Popham's signal code",
  '사기 +6%, 명중 +4%': 'Morale +6%, accuracy +4%',
  '승선 돌격 조련': 'Boarding drill',
  '백병 +12%': 'Melee +12%',
  '대육군 승선': 'Grande Armée troops aboard',
  '백병 +6%, 방어 +6%': 'Melee +6%, defense +6%',
  '망루 저격수': 'Marksmen in the tops',
  '명중 +6%, 백병 +4%': 'Accuracy +6%, melee +4%',
  '해병 포병대': 'The marine artillery',
  '명중 +7%, 장전 +3%': 'Accuracy +7%, reload +3%',
  '4층 갑판 개조': 'The fourth deck',
  '산티시마 트리니다드 건조 가능 (선소 3단계)': 'The Santísima Trinidad can be built (shipyard level 3)',
  '아바나 조선소': 'The Havana dockyard',
  '74문 전열함·트리니다드 방어 +10%': '74s and the Trinidad defense +10%',
  // Faction pick
  '브레스트와 툴롱, 페롤과 카디스를 봉쇄하며 바다를 지키는 진영입니다. 빠른 포격과 숙련된 수병으로 연합 함대가 모이기 전에 하나씩 잡아야 합니다.':
    'Britain holds the sea by blockading Brest and Toulon, Ferrol and Cádiz. With quick gunnery and seasoned seamen it must beat the Combined Fleet one squadron at a time, before they unite.',
  '나폴레옹의 함대입니다. 브레스트와 툴롱, 로슈포르의 함대를 봉쇄에서 빼내 에스파냐 함대와 합쳐 해협을 쥐고, 불로뉴의 대육군을 영국으로 건너보내야 합니다.':
    "Napoleon's navy. It must free the fleets of Brest, Toulon and Rochefort from the blockade, unite them with the Spanish, hold the Channel and carry the Grande Armée over from Boulogne.",
  '카디스와 페롤, 카르타헤나의 함대로 프랑스와 손잡은 진영입니다. 크고 튼튼한 전열함과 산티시마 트리니다드로 지브롤터 해협을 쥐고 있습니다.':
    "France's ally, with the fleets of Cádiz, Ferrol and Cartagena. Its big, strong ships of the line and the Santísima Trinidad hold the Strait of Gibraltar.",
  '콘월리스': 'Cornwallis',
  '강톰': 'Ganteaume',
  '알라바': 'Álava',
  '빠른 포격': 'Quick gunnery',
  '숙련된 수병': 'Seasoned seamen',
  '여러 바다의 기지': 'Bases on every sea',
  '두 적을 동시에 상대': 'Two enemies at once',
  '큰 함선': 'Big ships',
  '도선 돌격': 'Boarding attacks',
  '에스파냐와 동맹': 'Allied with Spain',
  '봉쇄된 항구, 경험 없는 수병': 'Blockaded ports, green crews',
  '튼튼한 선체': 'Strong hulls',
  '4층 갑판의 거함': 'The four-decker',
  '프랑스와 동맹': 'Allied with France',
  '수병 부족': 'Short of seamen',
};

for (const [ko, en] of Object.entries(PORT_NAMES)) {
  EN_TRAFALGAR_CAMPAIGN[`${ko} 바깥 정박지`] = `${en} Roads`;
  EN_TRAFALGAR_CAMPAIGN[`${ko} 입구`] = `${en} Approach`;
  EN_TRAFALGAR_CAMPAIGN[`${ko} 북쪽 수로`] = `${en} North Channel`;
  EN_TRAFALGAR_CAMPAIGN[`${ko} 남쪽 수로`] = `${en} South Channel`;
  EN_TRAFALGAR_CAMPAIGN[`${ko} 해전`] = `Battle of ${en}`;
}
// The Trafalgar theatre's turns run from January 1805.
for (let year = 1805; year <= 1815; year += 1) for (let month = 1; month <= 12; month += 1) EN_TRAFALGAR_CAMPAIGN[`${year}년 ${month}월`] = `${MONTHS[month - 1]} ${year}`;
