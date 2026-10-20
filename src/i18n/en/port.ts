/** English for the home port (본진, src/meta/port.ts, src/ui/port/PortScreen.tsx), keyed by the Korean source. */
const needs: Record<string, string> = {};
for (const [ko, en] of [['조선소', 'Shipyard'], ['병기창', 'Arsenal']] as const) for (let n = 1; n <= 3; n++) needs[`${ko} ${n}레벨이 필요합니다`] = `Needs ${en} level ${n}`;

export const EN_PORT: Record<string, string> = {
  ...needs,
  '본진 준비 중': 'Preparing the home port',
  '조선소': 'Shipyard',
  '병기창': 'Arsenal',
  '요새': 'Fortress',
  '레벨마다 더 큰 함선을 지을 수 있습니다': 'Each level unlocks larger ships',
  '레벨마다 함선 건조 값이 5% 내려갑니다': 'Each level cuts ship prices by 5%',
  '레벨마다 전투 보상 엽전이 10% 늘어납니다': 'Each level adds 10% to battle coin rewards',
  '{name} 본진': '{name} Home Port',
  '역사 전투와 캠페인에서 이기면 엽전을 받습니다. 별이 많을수록, 많이 격침할수록 더 받습니다.':
    'Win historical battles and campaign battles to earn coins. More stars and more ships sunk pay more.',
  '건물': 'Buildings',
  '최고 레벨': 'Max level',
  '짓기': 'Build',
  '{n}레벨로 올리기': 'Upgrade to level {n}',
  '함선 상점': 'Ship Shop',
  '지은 배는 병기창 부두에 정박합니다.': 'Ships you build are moored at the arsenal dock.',
  '보유 {n}/{max}': 'Owned {n}/{max}',
  '조선소 {n}레벨': 'Shipyard level {n}',
  '없는 건물입니다': 'No such building',
  '이미 가장 높은 레벨입니다': 'Already at the highest level',
};
