/** The faction campaign's march rules: movement range, forced march, interception, blockades, withdrawals and battle grades. */
export const EN_MARCH: Record<string, string> = {
  // The map's compass (GrandMap.tsx).
  '북쪽으로 되돌리기': 'Turn north up',
  '북쪽으로 되돌리기 · 오른쪽이나 가운데 버튼, 또는 Shift를 누르고 끌면 가로·세로로 돌아갑니다': 'Turn north up · drag with the right or middle button, or with Shift held, to turn and tilt the view',
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
  '{place} 해전에서 {navy|이/가} {grade|을/를} 거두었습니다 (손실: {a} {lostA}척 · {d} {lostD}척)': 'Battle of {place}: {grade} for the {navy} (losses: {a} {lostA} · {d} {lostD})',
  '{place} 앞바다에서 {navy|이/가} {grade|을/를} 거두었습니다 (손실: {a} {lostA}척 · {d} {lostD}척)': 'Off {place}: {grade} for the {navy} (losses: {a} {lostA} · {d} {lostD})',
  '{navy|이/가} {place|을/를} 봉쇄했습니다': 'The {navy} has blockaded {place}',
  '{navy|이/가} {place} 싸움에서 물러났습니다': 'The {navy} withdrew from the fight at {place}',
  '{place}의 수비대가 봉쇄를 견디지 못하고 항복했습니다': 'The garrison of {place} could not hold out against the blockade and surrendered',
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
  '겨울: 행동력 −20%, 바다 위 함대 보급 소모 증가': 'Winter: movement −20%, and fleets at sea use more supply',

  // The fleet panel.
  '행동력': 'Movement',
  '{km}km/턴': '{km} km/turn',
  '항해 태세': 'Sailing stance',
  '일반': 'Normal',
  '강행군': 'Forced march',
  '강행군: 이번 턴에만 1.5배 멀리 갑니다. 공격하거나 적의 포구로 들어갈 수 없고, 도중에 붙잡히면 지친 채 싸웁니다.': 'Forced march: this turn only, the fleet sails half again as far. It cannot attack or enter an enemy port, and if caught on the way it fights tired.',
  '강행군을 고르면 이번 턴에만 {km}km까지 가지만 공격할 수 없습니다.': 'A forced march takes the fleet up to {km} km this turn, but it cannot attack.',
  '봉쇄 중': 'Blockading',
  '{n}/{m}턴': '{n}/{m} turns',
  '포구는 수입과 함선 건조가 멈췄고 수비대가 굶주립니다. {turns} 더 버티면 항복합니다.': 'The port earns nothing and builds no ships, and its garrison is starving. It surrenders if the blockade holds {turns} more.',
  '강습 명령': 'Order an assault',
  '턴을 마치면 기다리지 않고 포구를 공격합니다': 'Storm the port when the turn ends instead of waiting',
  '도착하면 봉쇄': 'Blockade on arrival',
  '적의 포구를 강습하지 않고 둘러싸 굶깁니다. 수입과 건조가 멈추고 몇 턴 뒤 항복합니다': 'Surround an enemy port and starve it instead of storming it. Its income and shipbuilding stop, and it surrenders after a few turns',
  '고리가 있는 포구 중 목적지를 고릅니다. 포구 위에 올리면 턴마다 어디까지 가는지 보입니다.': 'Choose a ringed port as the destination. Hover over a port to see how far the fleet gets each turn.',
  '고리 색은 닿는 턴입니다: 초록 이번 턴, 노랑 다음 턴, 주황 그 뒤. 적의 포구를 누르면 공격하고, 적 함대를 누르면 추격합니다.': 'The ring colour shows when the fleet gets there: green this turn, yellow next turn, orange later. Click an enemy port to attack it, or an enemy fleet to give chase.',
  '{from|과/와} {to} 사이 바다 위에 있습니다. 다음 턴에 항해를 이어 갑니다.': 'At sea between {from} and {to}. The voyage goes on next turn.',
  '{from|과/와} {to} 사이 바다 위에 멈춰 있습니다. 새 목적지를 고르거나 되돌아갈 수 있습니다.': 'Stopped at sea between {from} and {to}. Choose a new destination or turn back.',
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
  '수입과 함선 건조가 멈췄고 수비대가 굶주립니다. {turns} 안에 구원 함대를 보내지 않으면 항복합니다.': 'Income and shipbuilding have stopped and the garrison is starving. Unless a relief fleet arrives within {turns}, the port surrenders.',
  '수입과 함선 건조가 멈췄고 수비대가 굶주립니다. {turns} 뒤에 항복합니다.': 'Income and shipbuilding have stopped and the garrison is starving. It surrenders in {turns}.',

  // The pre-battle screen and the result.
  '증원': 'Reinforcements',
  '전투 준비 · 바다 위에서 마주침': 'Battle ahead · Met at sea',
  '전투 준비 · 봉쇄 구원': 'Battle ahead · Relief of a blockade',
  '{place} 앞바다 해전': 'Battle off {place}',
  '{place} 앞바다': 'Off {place}',
  '봉쇄된 포구를 구하러 온 함대가 봉쇄 함대와 싸웁니다.': 'A fleet has come to relieve the blockaded port and fights the blockaders.',
  '퇴각하면 보급을 일부 잃고 물러납니다. 지킬 병력이 남지 않은 포구는 적에게 넘어갑니다.': 'Withdrawing costs some supply. A port left with nobody to hold it falls to the enemy.',
  '퇴각하면 보급을 일부 잃고 물러납니다.': 'Withdrawing costs some supply.',
  '강습하지 않고 포구를 둘러싸 굶깁니다': 'Surround the port and starve it instead of storming it',
  '싸우지 않고 물러납니다': 'Pull back without fighting',
  '퇴각': 'Withdraw',
  '봉쇄를 시작했습니다': 'The blockade has begun',
  '함대가 싸움에서 물러났습니다': 'The fleets have withdrawn from the fight',
  '{winner|이/가} {place} 앞바다에서 {loser|을/를} 물리쳤습니다. 패한 함대는 물러났습니다.': 'The {winner} beat the {loser} off {place}. The beaten fleets have fallen back.',

  // The first-turn guide under the march rules.
  "함대를 고르면 닿는 포구에 고리가 생깁니다(초록 이번 턴, 노랑 다음 턴, 주황 그 뒤). 포구 위에 올리면 턴마다 멈출 곳이 번호로 보이고, 적의 포구는 누르면 공격하며 우리 편 포구는 '이동'을 누른 뒤 고릅니다. '강행군'은 이번 턴만 더 멀리 가지만 공격할 수 없습니다.": "Select a fleet and the ports it can reach get a ring (green this turn, yellow next turn, orange later). Hover over a port to see numbered marks where each turn ends; click an enemy port to attack it, or press 'Move' and pick one of your own ports. A 'Forced march' sails farther this turn only, but cannot attack.",
};
