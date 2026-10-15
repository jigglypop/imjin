/** The port's work and shipbuilding cards (src/ui/grand/PortWorks.tsx, workEffects.ts). */
export const EN_BUILDINGS: Record<string, string> = {
  // --- Roles of the works --------------------------------------------------------------------------------------
  '포구의 본영입니다. 머무는 함선을 고치고 수군의 유지비를 덜어 주며, 수비대를 늘리고 다른 시설의 상위 단계를 엽니다.':
    "The port's headquarters. It repairs the ships that stay, eases the navy's upkeep, enlarges the garrison and opens the higher levels of the other works.",
  '함선을 짓는 곳입니다. 단계가 오르면 한 번에 더 많은 배를 더 싸게 짓고, 큰 배를 건조할 수 있습니다.':
    'Where ships are built. Each level builds more ships at once and more cheaply, and lets the port lay down bigger ones.',
  '포구로 들어오는 모든 적에게 포를 쏩니다. 손상되면 전력이 줄고, 직접 지휘하는 전투에도 같은 단계와 손상으로 배치됩니다.':
    'Fires on every enemy that enters the port. Damage weakens it, and battles you command yourself place it with the same level and damage.',
  '머무는 함선의 선체와 승조원을 더 빨리 회복시키고, 함대를 즉시 재정비할 수 있게 합니다.':
    'Restores the hulls and crews of the ships that stay faster, and allows a fleet to be refitted at once.',
  '포구의 수입을 늘리고 봉쇄를 더 오래 버티게 합니다. 전투에서는 화약고가 됩니다.':
    'Raises the port\'s income and lets it hold out longer under blockade. In battle it becomes a powder magazine.',
  '먼 바다의 적 함대를 미리 보게 하고 수입을 조금 늘립니다.': 'Shows enemy fleets far out at sea and adds a little income.',

  // --- Cards ---------------------------------------------------------------------------------------------------
  '미건설': 'Not built',
  '빈 부지': 'Open plot',
  '빈 부지 · 건설할 시설 고르기': 'Open plot · choose a work to build',
  '빈 부지에 지을 시설': 'Works for the open plot',
  '부지 {used} / {total}': 'Plots {used} / {total}',
  '{level}단계 공사 중': 'Building level {level}',
  '{level}단계 증축': 'Upgrade to {level}',
  '효과': 'Effect',
  '현재': 'Now',
  '현재 {level}단계': 'Now · level {level}',
  '{level}단계': 'Level {level}',
  '{level}단계에서 열림': 'Opens at level {level}',

  // --- What a level does (workEffects.ts) ----------------------------------------------------------------------
  '모든 시설 {level}단계': 'Every work to level {level}',
  '{works} {level}단계': '{works} to level {level}',
  '{ship} (설계 후)': '{ship} (once designed)',
  '{share} (은 +{gold})': '{share} (+{gold} silver)',
  '유지비 면제 한도': 'Upkeep allowance',
  '선체 수리 / 턴': 'Hull repair / turn',
  '승조원 보충 / 턴': 'Crew recovery / turn',
  '수비대 한도': 'Garrison limit',
  '수비 전투력': 'Defence strength',
  '봉쇄 버팀': 'Holds out under blockade',
  '동시 건조': 'Ships built at once',
  '함선 가격': 'Ship price',
  '포대 전력': 'Battery power',
  '단계당 전력': 'Power per level',
  '즉시 재정비': 'Immediate refit',
  '수입': 'Income',
  '전투 시 화약고': 'Powder magazine in battle',
  '시야': 'Sight',
  '항로 {n}개 앞': '{n} lanes out',
  '포구만': 'Port only',

  // --- Shipbuilding --------------------------------------------------------------------------------------------
  '건조 칸 {n} / {max}': 'Slipways {n} / {max}',
  '건조 중인 함선': 'Ships on the slipways',
  '빈 칸 {n}': '{n} free',
  '{ship} 건조 · {cost}': 'Build {ship} · {cost}',
  '{ship} 주문 취소': 'Cancel the {ship}',
  '화포': 'Guns',
  '{n}문': '{n}',
  '속력': 'Speed',
  '{n}노트': '{n} kn',
  '전투력': 'Fighting power',
};
