/** The faction campaign's march rules: movement range, forced march, interception, blockades, withdrawals and battle grades. */
export const EN_MARCH: Record<string, string> = {
  // The map's compass (GrandMap.tsx).
  '북쪽으로 되돌리기': 'Turn north up',
  '북쪽으로 되돌리기 · 회전은 오른쪽·가운데 버튼이나 Shift+끌기': 'Turn north up · rotate with a right or middle drag, or Shift+drag',
  // Refusals of the blockade and the withdrawal (sim/grand/turn.ts).
  '공격하는 쪽만 봉쇄할 수 있습니다': 'Only the attacking side can blockade',
  '봉쇄하기에는 수비대가 너무 강합니다': 'The garrison is too strong to blockade',
  '물러날 곳이 없습니다': 'There is nowhere to withdraw to',
  // Battle grades (sim/grand/report.ts GRADE_TEXT): the result's headline and the log's word for a win.
  '영웅적인 승리': 'Heroic victory',
  '대승': 'Decisive victory',
  '신승': 'Narrow victory',
  '상처뿐인 승리': 'Pyrrhic victory',

  // The war's log and the answers to orders (sim/grand/turn.ts, orders.ts).
  '{place} 해전: {navy} {grade} · 손실 {a} {lostA}척, {d} {lostD}척': 'Battle of {place}: {grade} for the {navy} · lost {a} {lostA}, {d} {lostD}',
  '{place} 앞바다: {navy} {grade} · 손실 {a} {lostA}척, {d} {lostD}척': 'Off {place}: {grade} for the {navy} · lost {a} {lostA}, {d} {lostD}',
  '{navy}, {place} 봉쇄': '{navy} blockades {place}',
  '{navy}, {place}에서 퇴각': '{navy} withdraws from {place}',
  '{place} 수비대, 봉쇄 끝에 항복': '{place} garrison surrenders to the blockade',
  '해당 전투가 없습니다': 'There is no such battle',
  '봉쇄할 수 없는 전투입니다': 'This battle cannot become a blockade',
  '적 함대가 지키는 포구는 봉쇄할 수 없습니다': 'A port guarded by an enemy fleet cannot be blockaded',
  '물러날 함대가 없습니다': 'There is no fleet to withdraw',
  '강행군 중에는 공격할 수 없습니다': 'A fleet on a forced march cannot attack',
  '이 캠페인에서는 쓸 수 없는 명령입니다': 'This order is not available in this campaign',
  '적 함대가 아닙니다': 'That is not an enemy fleet',
  '적의 포구 앞에서는 강행군할 수 없습니다': 'A fleet off an enemy port cannot force march',
  '봉쇄 중인 함대가 아닙니다': 'This fleet is not blockading a port',

  // The map: range, movement line, blockade tag.
  '봉쇄': 'Blockade',
  '봉쇄 {n}/{m}': 'Blockade {n}/{m}',
  '{turns} · {km}km': '{turns} · {km} km',
  '{route} · {turns} · 봉쇄': '{route} · {turns} · blockade',
  '{fleet}: {place|을/를} 봉쇄하러 갑니다 ({turns})': '{fleet}: sailing to blockade {place} ({turns})',
  '{fleet}: {target|을/를} 추격합니다 ({turns})': '{fleet}: giving chase to {target} ({turns})',

  // Winter (a turn that opens in January).
  '겨울': 'Winter',
  '겨울 −20%': 'Winter −20%',
  '겨울: 행동력 −20% · 바다 위 보급 소모 증가': 'Winter: movement −20% · more supply used at sea',

  // The fleet panel.
  '행동력': 'Movement',
  '{km}km/턴': '{km} km/turn',
  '항해 태세': 'Sailing stance',
  '일반': 'Normal',
  '강행군': 'Forced march',
  '강행군 중에는 공격할 수 없고, 붙잡히면 지친 채 싸웁니다.': 'A forced march cannot attack, and fights tired if caught.',
  '강행군: 이번 턴 {km}km · 공격 불가': 'Forced march: {km} km this turn · no attacks',
  '봉쇄 중': 'Blockading',
  '{n}/{m}턴': '{n}/{m} turns',
  '수입·건조 정지 · {turns} 뒤 항복': 'No income or building · surrenders in {turns}',
  '강습 명령': 'Order an assault',
  '턴 종료 때 바로 공격합니다': 'Storms the port when the turn ends',
  '도착하면 봉쇄': 'Blockade on arrival',
  '강습하지 않고 굶겨 항복시킵니다': 'Starves the port into surrender instead of storming it',
  '고리가 있는 포구를 고르세요. 포구에 올리면 턴별 항로가 보입니다.': "Pick a ringed port. Hover over one to see each turn's leg.",
  '고리 색: 초록 이번 턴 · 노랑 다음 턴 · 주황 그 뒤': 'Rings: green this turn · yellow next turn · orange later',
  '{from|과/와} {to} 사이 바다 위입니다. 다음 턴에 계속 갑니다.': 'At sea between {from} and {to}. Sails on next turn.',
  '{from|과/와} {to} 사이에 멈춰 있습니다. 새 목적지를 고르세요.': 'Stopped between {from} and {to}. Pick a new destination.',
  '도착하면 봉쇄합니다': 'The fleet will blockade on arrival',
  '도착하면 공격합니다': 'The fleet will attack on arrival',
  '강행군으로 바꿨습니다': 'Switched to a forced march',
  '일반 항해로 바꿨습니다': 'Switched to normal sailing',
  '턴을 마치면 포구를 강습합니다': 'The fleet will storm the port when the turn ends',
  '봉쇄를 이어 갑니다': 'The blockade goes on',

  // The port panel.
  '{place} 군영 {n}단계': '{place} camp level {n}',
  '우리 함대가 봉쇄 중': 'Blockaded by our fleet',
  '{navy}의 봉쇄': 'Blockade by the {navy}',
  '봉쇄 · 수입 없음': 'Blockaded · no income',
  '수입·건조 정지 · {turns} 안에 구원하지 않으면 항복': 'No income or building · surrenders unless relieved within {turns}',

  // The pre-battle screen and the result.
  '증원': 'Reinforcements',
  '전투 준비 · 바다 위 조우': 'Battle ahead · Met at sea',
  '전투 준비 · 봉쇄 구원': 'Battle ahead · Relief of a blockade',
  '{place} 앞바다 해전': 'Battle off {place}',
  '{place} 앞바다': 'Off {place}',
  '퇴각하면 보급을 일부 잃고, 비워진 포구는 적에게 넘어갑니다.': 'Withdrawing costs some supply, and an emptied port falls to the enemy.',
  '퇴각하면 보급을 일부 잃습니다.': 'Withdrawing costs some supply.',
  '퇴각': 'Withdraw',
  '봉쇄를 시작했습니다': 'The blockade has begun',
  '함대가 물러났습니다': 'The fleets have withdrawn',
  '{winner|이/가} {place} 앞바다에서 {loser|을/를} 물리쳤습니다.': 'The {winner} beat the {loser} off {place}.',

  // The first-turn guide under the march rules.
  "함대를 고르면 닿는 포구에 고리가 생깁니다. 적 포구나 함대를 누르면 공격하고, 우리 포구는 '이동'을 누른 뒤 고릅니다.": 'Select a fleet and the ports it can reach get a ring. Tap an enemy port or fleet to attack; for your own port, press Move first.',
};
