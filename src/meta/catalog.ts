import type { ShipMods } from '../sim/types';

/**
 * The account's generals and the gear a player buys for them (장수 육성): armor and a weapon for each. Pure data shared
 * by the client and the multiplayer server, which keeps the authoritative copy of every profile; the rules that read it
 * are in rules.ts.
 *
 * Every effect is a factor on the battle's ship modifiers (ShipMods), the same currency as the campaign's skills
 * (src/sim/grand/growthData.ts), and reaches only the ships of the squadron the general leads.
 */
export type MetaFaction = 'joseon' | 'japan' | 'ming';
export type MetaEffect = Partial<ShipMods>;

/** What a general carries: the armor he wears and the weapon he draws. */
export type Slot = 'armor' | 'weapon';
export const SLOTS: readonly Slot[] = ['armor', 'weapon'];
export const SLOT_LABEL: Record<Slot, string> = { armor: '갑옷', weapon: '무기' };

/** `basic` is what a general carries from the start (his plain portrait): every general owns his faction's of each slot. */
export type Tier = 'basic' | 'common' | 'fine' | 'masterwork' | 'legendary' | 'signature';
export const TIERS: readonly Tier[] = ['basic', 'common', 'fine', 'masterwork', 'legendary', 'signature'];

export type GearDef = {
  id: string;
  slot: Slot;
  faction: MetaFaction;
  tier: Tier;
  name: string;
  hanja: string;
  /** One short line for the card. */
  line: string;
  price: number;
  effect: MetaEffect;
  /** A signature piece fits only this general. */
  general?: string;
};

export const TIER_LABEL: Record<Tier, string> = { basic: '기본', common: '일반', fine: '고급', masterwork: '명품', legendary: '전설', signature: '전용' };
export const TIER_PRICE: Record<Tier, number> = { basic: 0, common: 300, fine: 900, masterwork: 2400, legendary: 6000, signature: 9000 };

const gear = (slot: Slot, id: string, faction: MetaFaction, tier: Tier, name: string, hanja: string, line: string, effect: MetaEffect, general?: string): GearDef => ({
  id,
  slot,
  faction,
  tier,
  name,
  hanja,
  line,
  price: TIER_PRICE[tier],
  effect,
  ...(general ? { general } : {}),
});
const armor = (id: string, faction: MetaFaction, tier: Tier, name: string, hanja: string, line: string, effect: MetaEffect, general?: string) =>
  gear('armor', id, faction, tier, name, hanja, line, effect, general);
const weapon = (id: string, faction: MetaFaction, tier: Tier, name: string, hanja: string, line: string, effect: MetaEffect, general?: string) =>
  gear('weapon', id, faction, tier, name, hanja, line, effect, general);

export const ARMORS: readonly GearDef[] = [
  armor('joseon_dujeong', 'joseon', 'basic', '두정갑', '頭釘甲', '천에 철편을 대고 놋쇠 못을 박은 갑옷', {}),
  armor('joseon_pigap', 'joseon', 'common', '피갑', '皮甲', '옻칠한 가죽 미늘을 엮은 갑옷', { defense: 1.02 }),
  armor('joseon_swaeja', 'joseon', 'fine', '쇄자갑', '鎖子甲', '쇠고리를 촘촘히 엮은 사슬 갑옷', { defense: 1.04, melee: 1.02 }),
  armor('joseon_gyeongbeon', 'joseon', 'masterwork', '경번갑', '鏡幡甲', '사슬에 철판을 단 장수의 갑옷', { defense: 1.05, morale: 1.03 }),
  armor('joseon_eorin', 'joseon', 'legendary', '어린갑', '魚鱗甲', '물고기 비늘처럼 겹친 금동 미늘', { defense: 1.06, morale: 1.05 }),

  armor('japan_tosei', 'japan', 'basic', '당세구족', '當世具足', '철판에 옻칠한 전국시대의 갑옷', {}),
  armor('japan_haramaki', 'japan', 'common', '하라마키', '腹巻', '등에서 여미는 가벼운 미늘 갑옷', { defense: 1.02 }),
  armor('japan_nimaido', 'japan', 'fine', '니마이도', '二枚胴', '철판 두 장을 경첩으로 이은 흑칠 갑옷', { defense: 1.04, melee: 1.02 }),
  armor('japan_nanbando', 'japan', 'masterwork', '남만동', '南蠻胴', '조총을 맞혀 시험한 서양식 철흉갑', { defense: 1.06, morale: 1.02 }),
  armor('japan_oyoroi', 'japan', 'legendary', '주칠 오요로이', '朱漆大鎧', '붉게 옻칠한 대장군의 큰 갑옷', { defense: 1.06, morale: 1.05 }),

  armor('ming_dingjia', 'ming', 'basic', '정갑', '釘甲', '붉은 천에 못을 박은 명의 갑옷', {}),
  armor('ming_myeongap', 'ming', 'common', '면갑', '綿甲', '솜을 두껍게 누빈 천 갑옷', { defense: 1.02 }),
  armor('ming_swaeja', 'ming', 'fine', '쇄자갑', '鎖子甲', '쇠고리를 엮은 명의 사슬 갑옷', { defense: 1.04, melee: 1.02 }),
  armor('ming_yuyeop', 'ming', 'masterwork', '유엽갑', '柳葉甲', '버들잎 모양 철편을 엮은 미늘 갑옷', { defense: 1.05, morale: 1.03 }),
  armor('ming_sanmun', 'ming', 'legendary', '산문갑', '山文甲', '산(山) 자 철편을 맞물린 대장의 갑옷', { defense: 1.06, morale: 1.05 }),

  armor('yi_tongjesa', 'joseon', 'signature', '통제사 홍갑', '統制使紅甲', '삼도수군통제사의 붉은 두정갑', { defense: 1.06, morale: 1.06, accuracy: 1.03 }, 'yi'),
  armor('won_heukcheol', 'joseon', 'signature', '흑철갑', '黑鐵甲', '경상우수사의 검은 철갑', { defense: 1.07, melee: 1.04 }, 'won'),
  armor('eokgi_cheonggap', 'joseon', 'signature', '우수사 청갑', '右水使靑甲', '전라우수사의 푸른 비단 두정갑', { defense: 1.05, morale: 1.06, reload: 1.02 }, 'eokgi'),
  armor('wakisaka_shichihon', 'japan', 'signature', '칠본창 구족', '七本槍具足', '시즈가타케 일곱 창의 흑칠 구족', { defense: 1.05, melee: 1.06, speed: 1.02 }, 'wakisaka'),
  armor('kuki_tetsu', 'japan', 'signature', '철갑선 구족', '鐵甲船具足', '철갑선 주인의 감청 끈 구족', { defense: 1.07, reload: 1.03 }, 'kuki'),
  armor('kato_teppo', 'japan', 'signature', '조총대장 구족', '鐵砲大將具足', '조총대를 이끈 갈색 미늘 구족', { defense: 1.05, accuracy: 1.05 }, 'kato'),
  armor('todo_tokan', 'japan', 'signature', '당관 투구 구족', '唐冠形兜具足', '긴 날개 투구를 쓴 축성가의 구족', { defense: 1.07, morale: 1.04 }, 'todo'),
  armor('konishi_gin', 'japan', 'signature', '은빛 구족', '銀具足', '선봉 대장의 은빛 미늘 구족', { defense: 1.06, morale: 1.05 }, 'konishi'),
  armor('shimazu_oni', 'japan', 'signature', '귀신 구족', '鬼島津具足', '사쓰마 무사의 붉은 끈 구족', { melee: 1.08, morale: 1.04 }, 'shimazu'),
  armor('chenlin_dudok', 'ming', 'signature', '도독 금갑', '都督金甲', '수군 도독의 금빛 산문갑과 망토', { defense: 1.05, morale: 1.06, reload: 1.03 }, 'chenlin'),
  armor('deng_nojang', 'ming', 'signature', '노장 철갑', '老將鐵甲', '일흔 노장의 검게 그은 철갑', { melee: 1.05, morale: 1.07 }, 'deng'),
];

export const WEAPONS: readonly GearDef[] = [
  weapon('joseon_hwando', 'joseon', 'basic', '환도', '環刀', '조선 장수가 차던 고리 칼', {}),
  weapon('joseon_gakgung', 'joseon', 'common', '각궁', '角弓', '소뿔과 대나무를 붙여 만든 활', { accuracy: 1.02 }),
  weapon('joseon_woldo', 'joseon', 'fine', '월도', '月刀', '초승달 모양 날이 달린 긴 칼', { melee: 1.03, morale: 1.01 }),
  weapon('joseon_ssangsudo', 'joseon', 'masterwork', '쌍수도', '雙手刀', '두 손으로 휘두르는 긴 칼', { melee: 1.06 }),
  weapon('joseon_ungeom', 'joseon', 'legendary', '운검', '雲劍', '임금 곁에 서는 장수의 칼', { melee: 1.05, morale: 1.04 }),

  weapon('japan_uchigatana', 'japan', 'basic', '우치가타나', '打刀', '일본 무사가 허리에 꽂던 칼', {}),
  weapon('japan_yari', 'japan', 'common', '야리', '槍', '보병이 쥐던 긴 창', { melee: 1.02 }),
  weapon('japan_teppo', 'japan', 'fine', '조총', '鐵砲', '화승으로 불을 붙여 쏘는 총', { accuracy: 1.04 }),
  weapon('japan_naginata', 'japan', 'masterwork', '나기나타', '薙刀', '긴 자루 끝에 휜 칼날을 단 무기', { melee: 1.06 }),
  weapon('japan_tachi', 'japan', 'legendary', '다치', '太刀', '허리에 늘어뜨려 차던 큰 칼', { melee: 1.05, morale: 1.04 }),

  weapon('ming_yaodao', 'ming', 'basic', '요도', '腰刀', '명 군사가 허리에 차던 칼', {}),
  weapon('ming_nangseon', 'ming', 'common', '낭선', '狼筅', '쇠 가시를 단 대나무 창', { melee: 1.02 }),
  weapon('ming_samnyeon', 'ming', 'fine', '삼안총', '三眼銃', '총구 셋이 달린 명의 화기', { accuracy: 1.04 }),
  weapon('ming_woldo', 'ming', 'masterwork', '언월도', '偃月刀', '반달 날이 달린 긴 칼', { melee: 1.06 }),
  weapon('ming_jangdo', 'ming', 'legendary', '장도', '長刀', '명 수군이 쓰던 긴 칼', { melee: 1.05, morale: 1.04 }),

  weapon('yi_janggeom', 'joseon', 'signature', '이순신 장검', '長劍', '검명이 새겨진 이순신의 큰 칼', { morale: 1.06, melee: 1.04, accuracy: 1.02 }, 'yi'),
  weapon('won_cheolpyeon', 'joseon', 'signature', '철편', '鐵鞭', '쇠로 만든 무거운 채찍', { melee: 1.06, morale: 1.02 }, 'won'),
  weapon('eokgi_gung', 'joseon', 'signature', '우수사 각궁', '右水使角弓', '전라우수사가 쏘던 활', { accuracy: 1.05, reload: 1.02 }, 'eokgi'),
  weapon('wakisaka_yari', 'japan', 'signature', '칠본창', '七本槍', '시즈가타케에서 이름을 떨친 창', { melee: 1.08, speed: 1.01 }, 'wakisaka'),
  weapon('kuki_gunbai', 'japan', 'signature', '군배', '軍配', '수군을 부리던 대장의 부채', { morale: 1.05, defense: 1.03 }, 'kuki'),
  weapon('kato_tanegashima', 'japan', 'signature', '대장 조총', '大將鐵砲', '조총대를 이끈 대장의 총', { accuracy: 1.06 }, 'kato'),
  weapon('todo_gunbai', 'japan', 'signature', '축성가의 군배', '築城家軍配', '성을 쌓듯 진을 짜던 부채', { defense: 1.04, morale: 1.04 }, 'todo'),
  weapon('konishi_tachi', 'japan', 'signature', '은장 다치', '銀裝太刀', '은으로 꾸민 선봉 대장의 큰 칼', { melee: 1.04, morale: 1.05 }, 'konishi'),
  weapon('shimazu_tachi', 'japan', 'signature', '시마즈 태도', '島津太刀', '귀신 시마즈가 휘두르던 큰 칼', { melee: 1.08, morale: 1.02 }, 'shimazu'),
  weapon('chenlin_jihwido', 'ming', 'signature', '지휘도', '指揮刀', '수군 도독이 군을 부리던 칼', { morale: 1.05, reload: 1.03 }, 'chenlin'),
  weapon('deng_woldo', 'ming', 'signature', '노장의 언월도', '老將偃月刀', '일흔 노장이 휘두른 언월도', { melee: 1.06, morale: 1.04 }, 'deng'),
];

export const GEAR: readonly GearDef[] = [...ARMORS, ...WEAPONS];
const BY_ID = new Map(GEAR.map((g) => [g.id, g]));

export const gearById = (id: string): GearDef | undefined => BY_ID.get(id);
export const basicGear = (f: MetaFaction, slot: Slot): GearDef => GEAR.find((g) => g.slot === slot && g.faction === f && g.tier === 'basic')!;

/**
 * The generals an account raises: the campaign's named commanders (src/sim/grand/regions.ts lists their names, posts
 * and portraits; growthData.ts their trees). `famous` ones have a portrait painted in every armor they can wear.
 */
export type GeneralDef = { id: string; faction: MetaFaction; famous: boolean };

export const GENERALS: readonly GeneralDef[] = [
  ...['yi', 'won', 'eokgi'].map((id) => ({ id, faction: 'joseon' as const, famous: true })),
  ...['kwon', 'eo', 'jeongun', 'kimwan', 'nadaeyong', 'songhuirip', 'iyeongnam', 'baeseol', 'anwi', 'iwan'].map((id) => ({ id, faction: 'joseon' as const, famous: false })),
  ...['wakisaka', 'kuki', 'kato', 'todo', 'konishi', 'shimazu'].map((id) => ({ id, faction: 'japan' as const, famous: true })),
  ...['kurushima', 'michiyuki', 'tachibana'].map((id) => ({ id, faction: 'japan' as const, famous: false })),
  ...['chenlin', 'deng'].map((id) => ({ id, faction: 'ming' as const, famous: true })),
];

export const generalById = (id: string): GeneralDef | undefined => GENERALS.find((g) => g.id === id);

/** What a general may carry in a slot: his faction's pieces, and no other general's signature. */
export const gearFor = (g: GeneralDef, slot: Slot): GearDef[] => GEAR.filter((x) => x.slot === slot && x.faction === g.faction && (!x.general || x.general === g.id));

/** Art, served from public/: a piece on its stand, and a famous general's portrait in an armor (the basic armor is his plain portrait). */
export const gearCardUrl = (g: Pick<GearDef, 'id' | 'slot'>, small = false) => `/ui/${g.slot === 'armor' ? 'armor' : 'weapons'}/${g.id}${small ? '_sm' : ''}.webp`;
export const armoredPortraitUrl = (general: string, armorId: string, small = false) => `/ui/portraits/armored/${general}_${armorId}${small ? '_sm' : ''}.webp`;
