/** The Lepanto theatre's faction campaign (src/sim/grand/regionsLepanto.ts, theatre.ts, growthData.ts): ports, fleets, commanders, techs, picks. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Port names in the region list and on the battle maps. */
const PORT_NAMES: Record<string, string> = {
  '베네치아': 'Venice',
  '자라': 'Zara',
  '카타로': 'Cattaro',
  '코르푸': 'Corfu',
  '케팔로니아': 'Cephalonia',
  '잔테': 'Zante',
  '칸디아·크레타': 'Candia · Crete',
  '파마구스타': 'Famagusta',
  '오트란토': 'Otranto',
  '나폴리': 'Naples',
  '메시나': 'Messina',
  '치비타베키아': 'Civitavecchia',
  '몰타': 'Malta',
  '제노바': 'Genoa',
  '이스탄불': 'Istanbul',
  '겔리볼루': 'Gallipoli',
  '네그로폰테': 'Negroponte',
  '로도스': 'Rhodes',
  '레판토': 'Lepanto',
  '파트라스': 'Patras',
  '쿠르촐라리 제도': 'The Curzolari',
  '쿠르촐라리': 'Curzolari',
  '프레베자': 'Preveza',
  '발로나': 'Valona',
  '모돈': 'Modon',
  '나바리노': 'Navarino',
  '트리폴리': 'Tripoli',
  '알렉산드리아': 'Alexandria',
  '칸디아': 'Candia',
};

export const EN_LEPANTO_CAMPAIGN: Record<string, string> = {
  ...PORT_NAMES,
  // Region notes
  '아르세날레 조선소에서 갤리선을 지어 내는 베네치아 공화국의 수도입니다. 상선 대형 갤리선 여섯 척을 갈레아스로 고쳐 함대에 보냈습니다.':
    'The capital of the Venetian Republic, whose Arsenal turned out its galleys. Six great merchant galleys were converted there into galleasses for the fleet.',
  '달마티아 해안의 베네치아 요새 도시입니다. 아드리아해를 오가는 베네치아 갤리선의 기항지입니다.': 'A Venetian fortress town on the Dalmatian coast, a port of call for the galleys of the Adriatic.',
  '깊은 만 안쪽의 베네치아 요새입니다. 1571년 여름 오스만 함대가 아드리아해 남쪽 해안을 휩쓸었습니다.': 'A Venetian fortress deep inside its gulf. In the summer of 1571 the Ottoman fleet swept the southern Adriatic coast.',
  '아드리아해 입구를 지키는 베네치아의 요새 섬입니다. 1537년 오스만의 포위를 견뎠습니다.': 'The Venetian island fortress guarding the mouth of the Adriatic. It withstood the Ottoman siege of 1537.',
  '1500년부터 베네치아가 다스린 이오니아해의 섬입니다.': 'An island of the Ionian Sea, Venetian since 1500.',
  '펠로폰네소스 서쪽 앞바다의 베네치아 섬입니다.': 'A Venetian island off the western Peloponnese.',
  '베네치아령 크레타의 수도입니다. 크레타의 갤리선들이 메시나에서 동맹 함대에 합류했습니다.': "The capital of Venetian Crete. Crete's galleys joined the League's fleet at Messina.",
  '키프로스의 마지막 베네치아 요새입니다. 마르칸토니오 브라가딘이 1570년 9월부터 포위를 견디다 1571년 8월 1일 항복했습니다.':
    'The last Venetian fortress on Cyprus. Marcantonio Bragadin held out against the siege from September 1570 until he surrendered on August 1, 1571.',
  '아드리아해 입구의 나폴리 왕국 항구입니다. 1480년 오스만군이 점령했던 곳입니다.': 'A port of the Kingdom of Naples at the mouth of the Adriatic, taken by the Ottomans in 1480.',
  '에스파냐 부왕령 나폴리의 수도입니다. 산타 크루스 후작 알바로 데 바산의 나폴리 갤리선단이 이곳에서 나왔습니다.':
    "The capital of Spanish Naples. The Naples galleys of Álvaro de Bazán, Marquis of Santa Cruz, sailed from here.",
  '시칠리아 해협의 항구입니다. 1571년 8월 23일 돈 후안이 도착했고, 9월 16일 신성동맹 함대가 이곳에서 출항했습니다.':
    "The port on the Strait of Messina. Don John arrived on August 23, 1571, and the Holy League's fleet sailed from here on September 16.",
  '교황령의 군항입니다. 1571년 5월 교황 비오 5세가 로마에서 신성동맹을 맺어 냈습니다.': 'The naval port of the Papal States. In May 1571 Pope Pius V brought the Holy League together in Rome.',
  '성 요한 기사단의 섬입니다. 1565년 오스만의 대포위를 막아 냈고, 기사단의 갤리선 세 척이 레판토에서 싸웠습니다.':
    'The island of the Knights of St John. It beat off the Great Siege of 1565, and three of the Order\'s galleys fought at Lepanto.',
  '조반니 안드레아 도리아의 갤리선단이 나온 공화국입니다. 도리아 가문은 계약을 맺고 에스파냐 왕에게 갤리선을 내주었습니다.':
    "The republic of Giovanni Andrea Doria's galleys. The Doria served the King of Spain with their galleys under contract.",
  '오스만 제국의 수도입니다. 금각만의 카슴파샤 조선소에서 함대를 지었고, 레판토 이듬해 봄까지 함대를 다시 지어 냈습니다.':
    "The Ottoman capital. Its fleet was built at the Kasımpaşa arsenal on the Golden Horn, which rebuilt it by the spring after Lepanto.",
  '다르다넬스 해협의 항구입니다. 오스만 해군의 첫 기지로, 함대가 에게해로 나가는 관문입니다.': "A port on the Dardanelles, the Ottoman navy's first base and its gate to the Aegean.",
  '에우보이아섬과 본토 사이 좁은 해협의 요새입니다. 1470년 오스만이 베네치아에게서 빼앗았습니다.': 'The fortress on the narrow strait between Euboea and the mainland, taken from Venice by the Ottomans in 1470.',
  '1522년 술레이만 1세가 성 요한 기사단을 몰아낸 섬입니다.': 'The island from which Suleiman I drove the Knights of St John in 1522.',
  '코린트만 어귀의 요새 항구입니다. 1499년 오스만이 베네치아에게서 빼앗았고, 1571년 10월 알리 파샤의 함대가 이곳에서 나와 싸웠습니다.':
    "The fortified port at the mouth of the Gulf of Corinth, taken from Venice by the Ottomans in 1499. Ali Pasha's fleet came out from here to fight in October 1571.",
  '파트라스만의 항구입니다. 레판토 해전은 이 만의 어귀에서 벌어졌습니다.': 'The port on the Gulf of Patras. The battle of Lepanto was fought at the mouth of this gulf.',
  '아켈로오스강 하구 앞의 작은 섬들입니다. 1571년 10월 7일 신성동맹과 오스만 함대가 이 앞바다에서 맞붙었습니다.':
    'Small islands off the mouth of the Achelous. The Holy League and the Ottoman fleet met off them on October 7, 1571.',
  '암브라키아만 입구의 요새입니다. 1538년 바르바로스 하이레딘이 안드레아 도리아의 동맹 함대를 물리쳤습니다.': "The fortress at the mouth of the Ambracian Gulf, where Hayreddin Barbarossa beat Andrea Doria's allied fleet in 1538.",
  '오트란토와 마주 보는 아드리아해 입구의 오스만 항구입니다.': 'The Ottoman port at the mouth of the Adriatic, facing Otranto.',
  '펠로폰네소스 서남쪽 끝의 요새입니다. 1500년 오스만이 베네치아에게서 빼앗았습니다.': 'The fortress at the south-western tip of the Peloponnese, taken from Venice by the Ottomans in 1500.',
  '넓은 나바리노만의 항구입니다. 모돈과 함께 1500년부터 오스만 땅이었습니다.': 'The port on the broad bay of Navarino, Ottoman, like Modon, since 1500.',
  '북아프리카의 항구입니다. 1551년 오스만이 성 요한 기사단에게서 빼앗았습니다.': 'A North African port the Ottomans took from the Knights of St John in 1551.',
  '1517년부터 오스만이 다스린 이집트의 항구입니다. 우익을 이끈 메흐메드 시로코가 알렉산드리아의 총독이었습니다.':
    'The port of Egypt, Ottoman since 1517. Mehmed Siroco, who led the right wing, was its governor.',
  // Navies, fleets, commanders
  '신성동맹과 오스만 제국이 이오니아해와 지중해의 물길을 두고 맞섭니다.': 'The Holy League and the Ottoman Empire face each other for the sea roads of the Ionian Sea and the Mediterranean.',
  '베네치아 함대': 'The Venetian fleet',
  '바르바리고 전대': "Barbarigo's squadron",
  '돈 후안 전대': "Don John's squadron",
  '도리아 전대': "Doria's squadron",
  '나폴리 갤리선단': 'The galleys of Naples',
  '크레타 갤리선단': 'The galleys of Crete',
  '알리 파샤 본대': "Ali Pasha's main body",
  '페르테브 전대': "Pertev's squadron",
  '울루치 알리 전대': "Uluç Ali's squadron",
  '이집트 갤리선단': 'The galleys of Egypt',
  '이스탄불 예비대': 'The Istanbul reserve',
  '동맹 증원 함대': 'League reinforcements',
  '술탄의 함대': "The Sultan's galleys",
  '페르테브 파샤': 'Pertev Pasha',
  '베네치아 함대 총사령관': 'Captain-General of the Venetian fleet',
  '베네치아 함대 부사령관': 'Second-in-command of the Venetian fleet',
  '제노바 제독': 'Genoese admiral',
  '원정군 총사령관(세르다르)': 'Commander of the expedition (serdar)',
  '알제 총독': 'Beylerbey of Algiers',
  '알렉산드리아 총독': 'Governor of Alexandria',
  // Commanders' traits and masteries
  '카를 5세의 아들': 'Son of Charles V',
  '알푸하라스 반란을 진압한 스물네 살의 총사령관: 사기 +8%, 백병 +3%, 대담한 지휘': 'The 24-year-old commander who put down the Alpujarras revolt: morale +8%, melee +3%, bold command',
  '레알호': 'La Real',
  '백병 +6%, 사기 +5%': 'Melee +6%, morale +5%',
  '일흔다섯의 노장': 'The old man of seventy-five',
  '기함 갑판에서 석궁을 쏘며 싸운 베네치아 총사령관: 백병 +8%, 사기 +4%, 무모한 지휘': "Venice's captain-general, who fought on his flagship's deck with a crossbow: melee +8%, morale +4%, rash command",
  '베네치아의 기함': 'The Venetian flagship',
  '방어 +6%, 백병 +5%': 'Defense +6%, melee +5%',
  '해안의 좌익': 'The left wing by the shore',
  '얕은 해안에 붙여 좌익을 지켰다: 방어 +6%, 명중 +3%, 침착한 지휘': 'Held the left wing close along the shallow shore: defense +6%, accuracy +3%, steady command',
  '마지막 지휘': 'The last command',
  '사기 +6%, 방어 +4%': 'Morale +6%, defense +4%',
  '제노바의 갤리선 계약자': 'The Genoese galley contractor',
  '자기 갤리선을 아끼는 노련한 선원: 선회 +8%, 방어 +3%, 신중한 지휘': 'A skilled seaman careful of his own galleys: turning +8%, defense +3%, cautious command',
  '우익의 기동': 'The right wing\'s manoeuvre',
  '속도 +4%, 선회 +5%, 항속 +6%': 'Speed +4%, turning +5%, range +6%',
  '카푸단 파샤': 'Kapudan Pasha',
  '예니체리를 태운 술타나의 지휘관: 백병 +8%, 사기 +4%, 대담한 지휘': 'Commander of the Sultana and her janissaries: melee +8%, morale +4%, bold command',
  '술타나호': 'The Sultana',
  '백병 +6%, 방어 +5%': 'Melee +6%, defense +5%',
  '세르다르': 'Serdar',
  '함대에 태운 원정군의 장군: 백병 +6%, 방어 +4%, 신중한 지휘': "General of the expedition's soldiers aboard the fleet: melee +6%, defense +4%, cautious command",
  '원정군': 'The expedition',
  '백병 +5%, 사기 +5%': 'Melee +5%, morale +5%',
  '알제의 베일레르베이': 'Beylerbey of Algiers',
  '칼라브리아에서 붙잡혀 와 해적 제독이 되었다: 속도 +6%, 선회 +6%, 항속 +8%, 침착한 지휘': 'Taken captive in Calabria, he rose to corsair admiral: speed +6%, turning +6%, range +8%, steady command',
  '몰타의 기함': 'The flagship of Malta',
  '레판토에서 몰타 기사단의 기함을 붙잡았다: 백병 +6%, 속도 +4%': 'Took the flagship of the Knights of Malta at Lepanto: melee +6%, speed +4%',
  '이집트 갤리선단을 이끈 우익의 지휘관: 사기 +5%, 선회 +4%': 'Commander of the right wing with the galleys of Egypt: morale +5%, turning +4%',
  '해안의 우익': 'The right wing by the shore',
  '방어 +5%, 백병 +5%': 'Defense +5%, melee +5%',
  // Techs
  '갈레아스 개조': 'Galleass conversions',
  '갈레아스 건조 가능 (선소 2단계), 갈레아·갈레아스 방어 +10%': 'Galleasses can be built (shipyard level 2); galleys and galleasses defense +10%',
  '화승총병 승선': 'Arquebusiers aboard',
  '백병 +10%, 명중 +4%': 'Melee +10%, accuracy +4%',
  '충각 절단': 'Spurs cut away',
  '이물 대포 낮게 쏘기: 명중 +8%': 'The bow guns fire low: accuracy +8%',
  '예니체리 승선': 'Janissaries aboard',
  '복합궁 사수': 'Composite bowmen',
  '전 함선 장전 +6%, 명중 +4%': 'All ships reload +6%, accuracy +4%',
  '바르바리 해적 편입': 'The Barbary corsairs join',
  '카드르가·칼리야타 속도 +5%, 선회 +6%': 'Kadırgas and galiots speed +5%, turning +6%',
  // Faction pick
  '베네치아, 에스파냐, 교황령이 맺은 동맹의 함대입니다. 메시나에 모인 갤리선과 베네치아의 갈레아스로 오스만 함대를 찾아 이오니아해로 나갑니다.':
    "The fleet of the league of Venice, Spain and the Papacy. With the galleys gathered at Messina and Venice's galleasses it goes out into the Ionian Sea to find the Ottoman fleet.",
  '많은 갤리선과 갈리오트로 지중해 동쪽을 쥔 술탄의 함대입니다. 레판토와 모돈에서 시작해 베네치아의 섬들과 키프로스를 노립니다.':
    "The Sultan's fleet of many galleys and galiots, master of the eastern Mediterranean. It starts at Lepanto and Modon and goes for Venice's islands and Cyprus.",
  '이물 대포 화력': 'Bow-gun firepower',
  '갈레아스': 'Galleasses',
  '화승총병': 'Arquebusiers',
  '흩어진 포구, 늦은 집결': 'Scattered ports, a slow muster',
  '많은 함선': 'Many ships',
  '빠른 갤리선': 'Fast galleys',
  '활과 도선전': 'Bows and boarding',
  '약한 이물 화력': 'Weak bow guns',
};

for (const [ko, en] of Object.entries(PORT_NAMES)) {
  EN_LEPANTO_CAMPAIGN[`${ko} 바깥 정박지`] = `${en} Roads`;
  EN_LEPANTO_CAMPAIGN[`${ko} 입구`] = `${en} Approach`;
  EN_LEPANTO_CAMPAIGN[`${ko} 북쪽 수로`] = `${en} North Channel`;
  EN_LEPANTO_CAMPAIGN[`${ko} 남쪽 수로`] = `${en} South Channel`;
  EN_LEPANTO_CAMPAIGN[`${ko} 해전`] = `Battle of ${en}`;
}
// The Lepanto theatre's turns run from July 1571.
for (let year = 1571; year <= 1580; year += 1) for (let month = 1; month <= 12; month += 1) EN_LEPANTO_CAMPAIGN[`${year}년 ${month}월`] = `${MONTHS[month - 1]} ${year}`;
