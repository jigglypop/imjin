import type { ShipMods } from '../sim/types';

/**
 * The account's generals and the armor a player buys for them (장수 육성). Pure data shared by the client and the
 * multiplayer server, which keeps the authoritative copy of every profile; the rules that read it are in rules.ts.
 *
 * Every effect is a factor on the battle's ship modifiers (ShipMods), the same currency as the campaign's skills
 * (src/sim/grand/growthData.ts), and reaches only the ships of the squadron the general leads.
 */
/** The 1592 navies own armor and weapons in this catalog; the other chapters' navies raise generals with talents and loot. */
export type MetaFaction = 'joseon' | 'japan' | 'ming';
export type GeneralFaction = MetaFaction | 'england' | 'spain' | 'holyleague' | 'ottoman' | 'britain' | 'france' | 'spain1805';
export type MetaEffect = Partial<ShipMods>;

/** `basic` is what a general wears in his portrait: every general owns his faction's from the start. */
export type ArmorTier = 'basic' | 'common' | 'fine' | 'masterwork' | 'legendary' | 'signature';
export const ARMOR_TIERS: readonly ArmorTier[] = ['basic', 'common', 'fine', 'masterwork', 'legendary', 'signature'];

export type ArmorDef = {
  id: string;
  faction: MetaFaction;
  tier: ArmorTier;
  name: string;
  hanja: string;
  /** One short line for the card. */
  line: string;
  price: number;
  /** The design's old fixed bonus, shown nowhere and applied nowhere since armor rolls its stats (affixes.ts). */
  effect: MetaEffect;
  /** The general associated with this signature's design; every general of the faction can wear it. */
  general?: string;
};

export const TIER_LABEL: Record<ArmorTier, string> = { basic: '기본', common: '보통', fine: '고급', masterwork: '명품', legendary: '전설', signature: '명장' };
export const TIER_PRICE: Record<ArmorTier, number> = { basic: 0, common: 300, fine: 900, masterwork: 2400, legendary: 6000, signature: 9000 };

const armor = (id: string, faction: MetaFaction, tier: ArmorTier, name: string, hanja: string, line: string, effect: MetaEffect, general?: string): ArmorDef => ({
  id,
  faction,
  tier,
  name,
  hanja,
  line,
  price: TIER_PRICE[tier],
  effect,
  ...(general ? { general } : {}),
});

export const ARMORS: readonly ArmorDef[] = [
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

export const armorById = (id: string): ArmorDef | undefined => ARMORS.find((a) => a.id === id);
export const basicArmor = (f: GeneralFaction): ArmorDef | undefined => ARMORS.find((a) => a.faction === f && a.tier === 'basic');

/**
 * The generals an account raises: the campaign's named commanders (src/sim/grand/regions.ts lists their names, posts
 * and portraits; growthData.ts their trees). `famous` ones also have painted portraits for the original armor catalog.
 */
export type GeneralDef = { id: string; faction: GeneralFaction; famous: boolean };

export const GENERALS: readonly GeneralDef[] = [
  ...['yi', 'won', 'eokgi'].map((id) => ({ id, faction: 'joseon' as const, famous: true })),
  ...['kwon', 'eo', 'jeongun', 'kimwan', 'nadaeyong', 'songhuirip', 'iyeongnam', 'baeseol', 'anwi', 'iwan'].map((id) => ({ id, faction: 'joseon' as const, famous: false })),
  ...['wakisaka', 'kuki', 'kato', 'todo', 'konishi', 'shimazu'].map((id) => ({ id, faction: 'japan' as const, famous: true })),
  ...['kurushima', 'michiyuki', 'tachibana'].map((id) => ({ id, faction: 'japan' as const, famous: false })),
  ...['chenlin', 'deng'].map((id) => ({ id, faction: 'ming' as const, famous: true })),
  ...['lirusong', 'magui', 'liuting', 'jijin', 'yanghao', 'wuweizhong'].map((id) => ({ id, faction: 'ming' as const, famous: false })),
  // The other chapters' commanders (src/sim/grand/regionsArmada.ts, regionsLepanto.ts, regionsTrafalgar.ts): talents
  // and their era's loot, no armor shop. `famous` ones start with experience like the 1592 famous.
  ...chapter('england', ['howard', 'drake'], ['frobisher', 'hawkins']),
  ...chapter('spain', ['medina', 'recalde'], ['leyva', 'oquendo']),
  ...chapter('holyleague', ['donjuan', 'venier'], ['barbarigo', 'doria']),
  ...chapter('ottoman', ['alipasha', 'uluc'], ['pertev', 'siroco']),
  ...chapter('britain', ['nelson', 'collingwood'], ['cornwallis', 'calder', 'hardy', 'blackwood', 'jervis']),
  ...chapter('france', ['villeneuve', 'lucas'], ['ganteaume', 'missiessy', 'brueys']),
  ...chapter('spain1805', ['gravina', 'churruca'], ['alava', 'cordoba']),
];

function chapter(faction: GeneralFaction, famous: string[], others: string[]): GeneralDef[] {
  return [...famous.map((id) => ({ id, faction, famous: true })), ...others.map((id) => ({ id, faction, famous: false }))];
}

export const generalById = (id: string): GeneralDef | undefined => GENERALS.find((g) => g.id === id);

/** Every armor of a general's faction, including the other commanders' signature designs. */
export const armorsFor = (g: GeneralDef): ArmorDef[] => ARMORS.filter((a) => a.faction === g.faction);
export const isImjin = (f: string): f is MetaFaction => f === 'joseon' || f === 'japan' || f === 'ming';

/** A general carries one cosmetic weapon; these do not change the factors applied to his ships. */
export type WeaponKind = 'sword' | 'spear' | 'bow';
export const WEAPON_KINDS: readonly WeaponKind[] = ['sword', 'spear', 'bow'];
export const WEAPON_KIND_LABEL: Record<WeaponKind, string> = { sword: '검', spear: '창', bow: '활' };
export type WeaponDef = {
  id: string;
  faction: MetaFaction;
  kind: WeaponKind;
  name: string;
  hanja: string;
  line: string;
};

export const WEAPONS: readonly WeaponDef[] = [
  { id: 'joseon_hwando', faction: 'joseon', kind: 'sword', name: '환도', hanja: '環刀', line: '둥근 코등이와 붉은 자루끈의 군도' },
  { id: 'joseon_ungeom', faction: 'joseon', kind: 'sword', name: '운검', hanja: '雲劍', line: '곧은 칼날과 금빛 장식의 의장검' },
  { id: 'joseon_jangchang', faction: 'joseon', kind: 'spear', name: '장창', hanja: '長槍', line: '가느다란 창날과 붉은 술을 단 긴 창' },
  { id: 'joseon_dangpa', faction: 'joseon', kind: 'spear', name: '당파', hanja: '鎲鈀', line: '세 갈래 창날로 상대 무기를 받아내는 창' },
  { id: 'joseon_gakgung', faction: 'joseon', kind: 'bow', name: '각궁', hanja: '角弓', line: '짧은 몸체가 깊게 휘어진 검은 활' },
  { id: 'joseon_janggunbow', faction: 'joseon', kind: 'bow', name: '장수 각궁', hanja: '將帥角弓', line: '붉은 칠과 금빛 끝장식을 더한 각궁' },

  { id: 'japan_katana', faction: 'japan', kind: 'sword', name: '가타나', hanja: '刀', line: '완만하게 휘어진 칼날과 검은 자루의 도검' },
  { id: 'japan_tachi', faction: 'japan', kind: 'sword', name: '다치', hanja: '太刀', line: '길게 휜 칼날에 금빛 코등이를 맞춘 도검' },
  { id: 'japan_yari', faction: 'japan', kind: 'spear', name: '야리', hanja: '槍', line: '곧은 양날 창촉을 단 긴 창' },
  { id: 'japan_jumonjiyari', faction: 'japan', kind: 'spear', name: '십문자창', hanja: '十文字槍', line: '좌우의 곁날이 십자를 이루는 창' },
  { id: 'japan_yumi', faction: 'japan', kind: 'bow', name: '유미', hanja: '弓', line: '손잡이 위쪽이 긴 비대칭 대나무 활' },
  { id: 'japan_shigeto', faction: 'japan', kind: 'bow', name: '시게토 활', hanja: '重籐弓', line: '등나무 띠를 촘촘하게 감은 긴 활' },

  { id: 'ming_dao', faction: 'ming', kind: 'sword', name: '유엽도', hanja: '柳葉刀', line: '버들잎처럼 넓어지는 칼날의 군도' },
  { id: 'ming_jian', faction: 'ming', kind: 'sword', name: '장검', hanja: '長劍', line: '곧은 양날과 청동 코등이의 검' },
  { id: 'ming_qiang', faction: 'ming', kind: 'spear', name: '홍영창', hanja: '紅纓槍', line: '잎 모양 창날 아래 붉은 술을 단 창' },
  { id: 'ming_guandao', faction: 'ming', kind: 'spear', name: '언월도', hanja: '偃月刀', line: '긴 자루 끝에 넓게 휘어진 칼날을 단 무기' },
  { id: 'ming_gong', faction: 'ming', kind: 'bow', name: '복합궁', hanja: '複合弓', line: '양 끝이 앞으로 휜 갈색 복합 활' },
  { id: 'ming_shaogong', faction: 'ming', kind: 'bow', name: '장초궁', hanja: '長梢弓', line: '긴 활고자와 금빛 장식을 갖춘 활' },
];

export const weaponById = (id: string): WeaponDef | undefined => WEAPONS.find((w) => w.id === id);
export const weaponsFor = (g: GeneralDef): WeaponDef[] => WEAPONS.filter((w) => w.faction === g.faction);
export const defaultWeapon = (faction: GeneralFaction): WeaponDef | undefined => WEAPONS.find((w) => w.faction === faction && w.kind === 'sword');

/** Art, served from public/: the armor on its stand, and a famous general's portrait in it (the basic armor is his plain portrait). */
export const armorCardUrl = (id: string, small = false) => `/ui/armor/${id}${small ? '_sm' : ''}.webp`;
export const armoredPortraitUrl = (general: string, armorId: string, small = false) => `/ui/portraits/armored/${general}_${armorId}${small ? '_sm' : ''}.webp`;
