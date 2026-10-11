/** Added campaign ports. Historical place names remain independent of the strategic opening front. */
const PORT_NAMES: Record<string, string> = {
  '녹도진': 'Nokdo Naval Station',
  '발포진': 'Balpo Naval Station',
  '방답진': 'Bangdap Naval Station',
  '당포': 'Dangpo',
  '당항포': 'Danghangpo',
  '오아포·가배량': 'Oapo · Gabaeryang',
  '오아포': 'Oapo',
  '영등포': 'Yeongdeungpo',
  '율포': 'Yulpo',
  '장문포': 'Jangmunpo',
  '제포': 'Jepo',
  '천성진': 'Cheonseong Naval Station',
  '다대포': 'Dadaepo',
  '목포진': 'Mokpo Naval Station',
};

export const EN_PORTS: Record<string, string> = {
  ...PORT_NAMES,
  '여수 분산익진': 'Yeosu Dispersed Wings',
  '목포 수로종심진': 'Mokpo Channel Depth Formation',
  '세 익을 나누어 섬 사이 수로에 분산하고 현측 화포를 펼칩니다.': 'Divide into three wings among the island channels and deploy broadside guns.',
  '좁은 복열로 깊게 배치해 수로의 정면과 후속 함대를 잇습니다.': 'Deploy in narrow, deep files to connect the channel front with the following fleet.',
  '고흥 녹동의 옛 수군진입니다. 전라좌수영으로 이어지는 서쪽 해로를 지킵니다.': 'A former naval station at Nokdong, Goheung. It guards the western sea route to the Jeolla Left Naval Headquarters.',
  '고흥반도 남쪽의 수군진입니다. 이순신이 만호로 근무했던 포구입니다.': 'A naval station on the southern Goheung Peninsula, where Yi Sun-sin served as its commander.',
  '돌산 군내리의 전라좌수영 전초 기지입니다. 굴강에서 전선을 보호하고 출동시켰습니다.': 'An outpost of the Jeolla Left Naval Headquarters at Gunnae-ri, Dolsan. Its sheltered basin protected and launched warships.',
  '통영 삼덕리의 수군진과 포구입니다. 당포해전이 벌어졌던 해안입니다.': 'A naval station and harbour at Samdeok-ri, Tongyeong, on the coast where the Battle of Dangpo took place.',
  '고성 당항만 안쪽의 포구입니다. 조선 수군이 두 차례 해전을 치렀던 좁고 깊은 만입니다.': 'A harbour deep inside Danghang Bay, Goseong. The Joseon navy fought two battles in this narrow bay.',
  '거제 남서쪽의 옛 오아포입니다. 경상우수영과 통제영이 자리했던 포구입니다.': 'The former Oapo harbour in southwestern Geoje, which housed the Gyeongsang Right Naval Headquarters and the unified naval command.',
  '거제 구영리에 남아 있는 옛 영등진의 포구입니다. 진해만과 거제 북쪽 바다를 잇습니다.': 'The harbour of the former Yeongdeung naval station at Guyeong-ri, Geoje. It links Jinhae Bay with the waters north of Geoje.',
  '거제 율천리의 옛 율포진입니다. 거제 북부 포구와 진해만을 연결합니다.': 'The former Yulpo naval station at Yulcheon-ri, Geoje. It connects the northern Geoje harbours to Jinhae Bay.',
  '거제 장목만의 길고 좁은 포구입니다. 난중일기에 수군의 진입과 해안 성곽이 기록되어 있습니다.': 'A long, narrow harbour in Jangmok Bay, Geoje. Yi Sun-sin\'s war diary records the navy entering it and fortifications on its shore.',
  '웅천의 옛 포구입니다. 조선과 일본 사이의 선박 왕래가 실록에 기록되어 있습니다.': 'An old harbour at Ungcheon. The Joseon Annals record ships travelling between Joseon and Japan through it.',
  '가덕도 서쪽 천성항의 수군진입니다. 거제 동북 해안과 진해만 동쪽을 지키던 기지입니다.': 'A naval station at Cheonseong Harbour on western Gadeok Island. It guarded northeastern Geoje and the eastern side of Jinhae Bay.',
  '낙동강 하구 동쪽의 수군진입니다. 부산포로 들어가는 남쪽 해로의 요충지입니다.': 'A naval station east of the Nakdong River estuary, guarding the southern sea route into Busan Harbour.',
  '영산강 하구를 지키던 수군진입니다. 실록에 병선 배치와 만호 파견이 기록되어 있습니다.': 'A naval station guarding the Yeongsan River estuary. The Joseon Annals record the stationing of warships and appointment of its commander.',
  '국립문화유산연구원: 녹도진성': 'National Research Institute of Cultural Heritage: Nokdo Naval Fortress',
  '한국학중앙연구원: 고흥 발포 만호성': 'Academy of Korean Studies: Balpo Naval Fortress, Goheung',
  '국가유산 해설문: 돌산군관청·방답진': 'National Heritage interpretive plaque: Dolsan Military Office and Bangdap Naval Station',
  '국가유산포털: 통영 당포성': 'Korea Heritage Service: Dangpo Fortress, Tongyeong',
  '한국관광공사: 당항포 대첩지': 'Korea Tourism Organization: Danghangpo Battle Site',
  '거제시: 가배량진성·오아포': 'Geoje City: Gabaeryang Fortress and Oapo',
  '국가유산포털: 거제 구영등성': 'Korea Heritage Service: Former Yeongdeung Fortress, Geoje',
  '국가유산포털: 거제 구율포성': 'Korea Heritage Service: Former Yulpo Fortress, Geoje',
  '거제시: 장문포 왜성·난중일기': 'Geoje City: Jangmunpo Japanese Fortress and Yi Sun-sin\'s War Diary',
  '조선왕조실록: 제포·부산포 선박 왕래': 'Joseon Annals: Shipping at Jepo and Busanpo',
  '부산박물관: 천성진성 발굴조사': 'Busan Museum: Excavation of Cheonseong Naval Fortress',
  '부산교통공사: 다대포 수군진': 'Busan Transportation Corporation: Dadaepo Naval Station',
  '조선왕조실록: 목포 병선 배치·만호 파견': 'Joseon Annals: Warships and a Naval Commander at Mokpo',
};

// coast.ts builds the same place-derived point labels; names are saved in Korean and translated at display time.
for (const [ko, en] of Object.entries(PORT_NAMES)) {
  EN_PORTS[`${ko} 해전`] = `Battle of ${en}`;
  EN_PORTS[`${ko} 출동 함대`] = `${en} Sortie Fleet`;
  EN_PORTS[`${ko} 바깥 정박지`] = `${en} Outer Anchorage`;
  EN_PORTS[`${ko} 입구`] = `${en} Entrance`;
  EN_PORTS[`${ko} 북쪽 수로`] = `${en} North Channel`;
  EN_PORTS[`${ko} 남쪽 수로`] = `${en} South Channel`;
}
