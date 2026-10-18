import type { ChapterId } from '../routes';
import type { Faction, ShipKind } from '../sim/types';

/**
 * The chapters of MOONWAKE. Each is a war at sea with its own navies, ships, historical battles and campaign; 임진왜란
 * is the main chapter at the site's root. Text is Korean source for t() (English in src/i18n/en/chapters.ts).
 * Chapters not yet built are listed with `ready: false` so the menu can show what is coming.
 */
export type ChapterDef = {
  id: ChapterId;
  title: string;
  /** The poster's native-script line above the title. */
  native: string;
  years: string;
  /** Year the chapter's battles start, for sorting and the selector. */
  year: number;
  ready: boolean;
  /** Battle slot one and two: the defending navy and the invader. */
  navies: [Faction[], Faction[]];
  /** The representative flagship the menu shows, and the fleets around it. */
  hero: { kind: ShipKind; own: ShipKind[]; foe: ShipKind[] };
  /** The poster's billing block. */
  billing: { side: string; names: string[] }[];
  /** One line under the campaign button and the history button. */
  campaign: string;
  history: string;
};

export const CHAPTERS: ChapterDef[] = [
  {
    id: 'imjin',
    title: '임진왜란',
    native: '壬辰倭亂',
    years: '1592 — 1598',
    year: 1592,
    ready: true,
    navies: [['joseon', 'ming'], ['japan']],
    hero: { kind: 'geobukseon', own: ['panokseon'], foe: ['atakebune'] },
    billing: [
      { side: '조선', names: ['이순신', '원균', '이억기', '권준'] },
      { side: '명', names: ['진린', '등자룡'] },
      { side: '일본', names: ['와키자카 야스하루', '구키 요시타카', '구루시마 미치후사'] },
    ],
    campaign: '한 나라로 남해안 점령',
    history: '명량, 한산도 등 아홉 해전',
  },
  {
    id: 'armada',
    title: '아르마다',
    native: 'ARMADA',
    years: '1588',
    year: 1588,
    ready: true,
    navies: [['england'], ['spain']],
    hero: { kind: 'racegalleon', own: ['racegalleon', 'pinnace'], foe: ['spgalleon', 'galleass'] },
    billing: [
      { side: '잉글랜드', names: ['찰스 하워드', '프랜시스 드레이크', '존 호킨스', '마틴 프로비셔'] },
      { side: '에스파냐', names: ['메디나 시도니아 공작', '레칼데', '오켄도', '레이바'] },
    ],
    campaign: '해협을 따라 장수를 키우는 원정',
    history: '플리머스에서 그라블린까지 다섯 해전',
  },
  {
    id: 'lepanto',
    title: '레판토',
    native: 'LEPANTO',
    years: '1538 — 1571',
    year: 1571,
    ready: true,
    navies: [['holyleague'], ['ottoman']],
    hero: { kind: 'reale', own: ['galea', 'vgalleass'], foe: ['sultana', 'kadirga'] },
    billing: [
      { side: '신성동맹', names: ['돈 후안 데 아우스트리아', '아고스티노 바르바리고', '세바스티아노 베니에르', '조반니 안드레아 도리아'] },
      { side: '오스만', names: ['뮈에진자데 알리 파샤', '울루치 알리', '메흐메드 시로코'] },
    ],
    campaign: '지중해를 두고 장수를 키우는 세력 싸움',
    history: '프레베자에서 레판토까지 다섯 해전',
  },
  {
    id: 'trafalgar',
    title: '트라팔가르',
    native: 'TRAFALGAR',
    years: '1797 — 1805',
    year: 1805,
    ready: true,
    navies: [['britain'], ['france', 'spain1805']],
    hero: { kind: 'firstrate', own: ['gb74', 'gbfrigate'], foe: ['trinidad', 'fr80'] },
    billing: [
      { side: '영국', names: ['허레이쇼 넬슨', '커스버트 콜링우드', '토머스 하디', '헨리 블랙우드'] },
      { side: '프랑스', names: ['피에르 빌뇌브', '장자크 뤼카'] },
      { side: '에스파냐', names: ['페데리코 그라비나', '코스메 다미안 추루카'] },
    ],
    campaign: '대서양과 지중해를 두고 장수를 키우는 세력 싸움',
    history: '산비센테 곶에서 트라팔가르까지 다섯 해전',
  },
];

export const chapterDef = (id: ChapterId) => CHAPTERS.find((c) => c.id === id)!;

/** The chapter a navy belongs to. */
export const chapterOfFaction = (f: Faction): ChapterId =>
  f === 'england' || f === 'spain' ? 'armada' : f === 'holyleague' || f === 'ottoman' ? 'lepanto' : f === 'britain' || f === 'france' || f === 'spain1805' ? 'trafalgar' : 'imjin';
