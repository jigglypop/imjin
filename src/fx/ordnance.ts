import type { AmmoType, Faction, GunType } from '../sim/types';

/**
 * What the guns and bows of 1592-98 threw, as far as the records give it (scratchpad research, weapons table): the
 * size and weight of each projectile and what it did to planking. Looks only: the sim decides every hit; this table
 * decides how a hit looks (a smashed-in breach, a clean hole, a ball lodged in the wood, pocks in a shield) and fills
 * the munitions gallery.
 */

/** How a projectile is modelled: a gun arrow, a bow arrow, a ball, a rocket arrow or a fire arrow. */
export type OrdnanceModel = 'heavyArrow' | 'bowArrow' | 'fireArrow' | 'ball' | 'pellet' | 'rocket' | 'hiya';

export type Ordnance = {
  id: string;
  /** Korean name and its characters (player-facing; the name goes through t()). */
  name: string;
  hanja: string;
  /** The gun or weapon that throws it, Korean (through t()). */
  by: string;
  model: OrdnanceModel;
  /** Metres: length (0 for a ball) and the thickest diameter. */
  length: number;
  diameter: number;
  /** Kilograms. */
  mass: number;
  /** The weight as the records give it, and the source, Korean (through t()). */
  record: string;
  source: string;
  /** For the gallery's tint of a ball: forged iron, lead or stone. */
  stuff?: 'iron' | 'lead' | 'stone';
  /** Which gun's arrow form (Projectiles' ARROW_FORM) draws a gun arrow. */
  gun?: GunType;
};

/** Everything the battles fire, longest first along the rack. The biyeok jincheolloe is left out: no naval use is recorded. */
export const ORDNANCE: Ordnance[] = [
  { id: 'daejanggun', name: '대장군전', hanja: '大將軍箭', by: '천자총통', model: 'heavyArrow', gun: 'cheonja', length: 2.1, diameter: 0.105, mass: 33, record: '56근 3냥 (30~36 kg)', source: '화포식언해 (1635); 길이는 구경에서 추정' },
  { id: 'janggun', name: '장군전', hanja: '將軍箭', by: '지자총통', model: 'heavyArrow', gun: 'jija', length: 1.92, diameter: 0.094, mass: 18, record: '29근 8냥 (18~21 kg)', source: '융원필비 (1813); 구키 가문 전래 실물 182 cm·지름 9.4 cm' },
  { id: 'chadae', name: '차대전', hanja: '次大箭', by: '현자총통', model: 'heavyArrow', gun: 'hyeonja', length: 1.32, diameter: 0.046, mass: 4.3, record: '7근 (4.2~4.5 kg)', source: '융원필비; 화포식언해' },
  { id: 'piryeong', name: '피령차중전', hanja: '皮翎次中箭', by: '황자총통', model: 'heavyArrow', gun: 'hwangja', length: 1.31, diameter: 0.035, mass: 2.2, record: '3근 8냥 (2.1~2.25 kg)', source: '융원필비; 당포 장계의 피령전' },
  { id: 'singijeon', name: '중신기전', hanja: '中神機箭', by: '화차·신기전기', model: 'rocket', length: 1.38, diameter: 0.027, mass: 0.6, record: '대나무 1.38 m, 약통 19.6 cm', source: '국조오례서례 병기도설; 해전 사용 기록은 찾지 못함' },
  { id: 'mingrocket', name: '화전 (명)', hanja: '火箭', by: '명 화전수', model: 'rocket', length: 1.6, diameter: 0.03, mass: 0.5, record: '약통 굵기 1촌 미만, 촉 3~4촌', source: '기효신서 권18; 연병실기' },
  { id: 'jangjeon', name: '장전', hanja: '長箭', by: '활', model: 'bowArrow', length: 0.85, diameter: 0.009, mass: 0.04, record: '대나무 살, 꿩깃, 쇠촉', source: '옥포 장계 "鐵丸長片箭 交下如雨"' },
  { id: 'hwajeon', name: '화전', hanja: '火箭', by: '활', model: 'fireArrow', length: 0.85, diameter: 0.03, mass: 0.07, record: '촉 뒤에 화약 뭉치', source: '당포 장계 "以火箭射中其紗帳與布帆"' },
  { id: 'hiya', name: '불화살', hanja: '火矢', by: '대통·활 (일본)', model: 'hiya', length: 0.9, diameter: 0.03, mass: 0.1, record: '불붙인 삼 뭉치를 맨 화살', source: '高麗船戰記; 게임 속 대통의 불 공격' },
  { id: 'pyeonjeon', name: '편전', hanja: '片箭', by: '활 (통아)', model: 'bowArrow', length: 0.37, diameter: 0.007, mass: 0.02, record: '살 1척 2촌 (37 cm)', source: '지봉유설 (1614); 부산포 장계' },
  { id: 'cheonjaball', name: '천자 단환', hanja: '單丸', by: '천자총통', model: 'ball', stuff: 'iron', length: 0, diameter: 0.125, mass: 7.8, record: '13근, 지름 3치 6푼', source: '우리역사넷 (신뢰 낮음)' },
  { id: 'jijaball', name: '지자 단환', hanja: '單丸', by: '지자총통', model: 'ball', stuff: 'iron', length: 0, diameter: 0.1, mass: 4.8, record: '구경 10.5 cm에서 5 mm 작게', source: '화포식언해의 총통 구경에서 계산' },
  { id: 'hyeonjaball', name: '현자 철환', hanja: '鐵丸', by: '현자총통', model: 'ball', stuff: 'iron', length: 0, diameter: 0.07, mass: 1.1, record: '구경 7.5 cm', source: '당포 장계 "玄字鐵丸"' },
  { id: 'ozutsu', name: '대통 납탄', hanja: '大筒', by: '대통 (일본)', model: 'ball', stuff: 'lead', length: 0, diameter: 0.04, mass: 0.375, record: '100몬메 (375 g)', source: '부산 장계 "大鐵丸 大如木果"' },
  { id: 'folangji', name: '불랑기 납탄', hanja: '合口鉛子', by: '불랑기포 (명)', model: 'ball', stuff: 'lead', length: 0, diameter: 0.044, mass: 0.5, record: '무게 추정 0.5 kg', source: '기효신서 권18 "人馬洞過"' },
  { id: 'hudunstone', name: '호준포 큰 돌', hanja: '虎蹲砲', by: '호준포 (명)', model: 'ball', stuff: 'stone', length: 0, diameter: 0.06, mass: 1.1, record: '30냥 남짓 (1.1 kg)', source: '기효신서 호준포해' },
  { id: 'joran', name: '조란환', hanja: '鳥卵丸', by: '천자·지자총통 (200발)', model: 'pellet', stuff: 'iron', length: 0, diameter: 0.022, mass: 0.044, record: '"새알만 한" 쇠알, 지름 추정 2.2 cm', source: '화포식언해' },
  { id: 'cheolhwan', name: '철환', hanja: '鐵丸', by: '현자 (100발)·황자 (40발)', model: 'pellet', stuff: 'iron', length: 0, diameter: 0.016, mass: 0.017, record: '지름 1.6 cm', source: '화포식언해; 옥포 장계' },
  { id: 'teppo', name: '조총 탄', hanja: '鐵砲玉', by: '조총 (일본)', model: 'pellet', stuff: 'lead', length: 0, diameter: 0.0155, mass: 0.0225, record: '6몬메 (22.5 g)', source: '2005년 화승총 실사 (히노키 3.6 cm 박힘)' },
];

/** Mass in kilograms and diameter in metres of what a gun fires with the sim's ammo. */
export function payload(gun: GunType, ammo: AmmoType): { mass: number; diameter: number; deform: number } {
  if (ammo === 'arrow') {
    switch (gun) {
      case 'cheonja':
        return { mass: 33, diameter: 0.105, deform: 1 };
      case 'jija':
        return { mass: 18, diameter: 0.094, deform: 1 };
      case 'hyeonja':
        return { mass: 4.3, diameter: 0.046, deform: 1 };
      case 'hwangja':
        return { mass: 2.2, diameter: 0.035, deform: 1 };
      default:
        return { mass: 1.5, diameter: 0.035, deform: 1 };
    }
  }
  if (ammo === 'grape') return gun === 'cheonja' || gun === 'jija' ? { mass: 0.044, diameter: 0.022, deform: 1 } : gun === 'hudun' ? { mass: 0.018, diameter: 0.0145, deform: 2.5 } : { mass: 0.017, diameter: 0.016, deform: 1 };
  switch (gun) {
    case 'cheonja':
      return { mass: 7.8, diameter: 0.125, deform: 1 };
    case 'jija':
      return { mass: 4.8, diameter: 0.1, deform: 1 };
    case 'hyeonja':
      return { mass: 1.1, diameter: 0.07, deform: 1 };
    case 'hwangja':
      return { mass: 0.49, diameter: 0.035, deform: 1 };
    case 'seungja':
      return { mass: 0.1, diameter: 0.035, deform: 1 };
    // Lead flattens on wood: it spends its energy over two and a half times the area of iron.
    case 'ozutsu':
      return { mass: 0.375, diameter: 0.04, deform: 2.5 };
    case 'folangji':
      return { mass: 0.5, diameter: 0.044, deform: 2.5 };
    case 'hudun':
      return { mass: 1.1, diameter: 0.06, deform: 1.5 };
    // The Armada guns: English and Spanish shot weights of 1588 (pounds of about 0.45 kg); the pedrero fired dressed stone.
    case 'culverin':
      return { mass: 7.7, diameter: 0.13, deform: 1 };
    case 'demiculverin':
      return { mass: 4.3, diameter: 0.105, deform: 1 };
    case 'cannon':
      return { mass: 14.5, diameter: 0.16, deform: 1 };
    case 'perrier':
      return { mass: 6, diameter: 0.15, deform: 2 };
    case 'saker':
      return { mass: 2.4, diameter: 0.09, deform: 1 };
    case 'base':
      return { mass: 0.5, diameter: 0.045, deform: 1 };
    // The guns of 1805 (Lavery 1987): English pounds of 0.454 kg; the French livre of 0.49 kg (36 livres = 17.6 kg).
    case 'long32':
    case 'carronade':
      return { mass: 14.5, diameter: 0.16, deform: 1 };
    case 'long18':
      return { mass: 9, diameter: 0.135, deform: 1 };
    case 'long12':
      return { mass: 5.4, diameter: 0.115, deform: 1 };
    case 'long36':
      return { mass: 17.6, diameter: 0.17, deform: 1 };
  }
}

/**
 * The planking the shot meets, in centimetres, and how hard it is to push through (J per cubic centimetre): pine side
 * planking four chi thick on the Joseon ships (Yi Chungmugong jeonseo, "並厚四寸"), thinner cedar on the Japanese,
 * the Ming fir between; shield boards and castle walls thinner still. Only the Joseon figure is recorded.
 */
export function planking(faction: Faction, part: 'hull' | 'wall' | 'castle', hullCm: number) {
  // European oak: a harder wood, thick bulwarks and castle sides.
  if (faction === 'england' || faction === 'spain' || faction === 'britain' || faction === 'france' || faction === 'spain1805') return { T: part === 'hull' ? hullCm : part === 'wall' ? 8 : 5, k: 40 };
  const k = faction === 'japan' ? 22 : faction === 'ming' ? 35 : 30;
  const T = part === 'hull' ? hullCm : part === 'wall' ? (faction === 'japan' ? 3 : faction === 'ming' ? 4 : 6) : faction === 'japan' ? 2.5 : 3;
  return { T, k };
}

/** What a shot did to the wood it struck. */
export type Outcome = 'smash' | 'pierce' | 'spall' | 'embed' | 'stick' | 'glance';

/**
 * The energy-density model of the weapons table: depth (cm) = E cos(angle) / (area x deformation) / k, checked against
 * an 18-pounder through oak (109 cm, recorded about 110) and the 2005 matchlock firing into hinoki (3.6 cm). A great
 * arrow of ten kilograms or more that goes through thin planking with energy to spare breaks the planks out (the
 * dispatches' "撞破其船": the Japanese hulls and every shield wall); a heavy ball does the same above three kilograms.
 * The four-chi pine of a panokseon it punches through instead, keeping most of its energy (the weapons table).
 */
export function outcome(model: 'arrow' | 'ball', mass: number, diameter: number, deform: number, speed: number, cos: number, T: number, k: number, japanese: boolean): { result: Outcome; depth: number; energy: number } {
  const energy = 0.5 * mass * speed * speed;
  if (cos < (model === 'arrow' ? 0.31 : 0.42)) return { result: 'glance', depth: 0, energy };
  const area = Math.PI * (diameter * 50) ** 2;
  const depth = (energy * cos) / (area * deform) / k;
  const heavy = model === 'arrow' ? mass >= 10 : mass >= 3;
  if (heavy && T <= 8 && depth >= 1.2 * T && energy >= (japanese ? 35000 : 60000)) return { result: 'smash', depth, energy };
  if (depth >= 1.2 * T) return { result: 'pierce', depth, energy };
  if (depth >= 0.8 * T) return { result: 'spall', depth, energy };
  return { result: model === 'arrow' ? 'stick' : 'embed', depth, energy };
}
