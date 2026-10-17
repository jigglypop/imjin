import { REGION_ORDER, START, type StartSetup } from './regions';
import { ARMADA_REGION_ORDER, ARMADA_START } from './regionsArmada';
import { LEPANTO_REGION_ORDER, LEPANTO_START } from './regionsLepanto';
import type { Grand, GrandFaction, PairKey, Relation, RegionId, TheatreId } from './types';

/**
 * A theatre is one war's world for the faction campaign: the navies that fight it, its regions in their fixed order,
 * the opening holdings and fleets, who is allied with whom, and the season the first turn falls in. Everything else
 * (the rules, the economy, the AI, the growth trees) is shared and keyed by faction, region or commander id, so a new
 * chapter's campaign is data: its factions in TUNING (economy.ts), its regions, lanes, commanders and start
 * (regionsArmada.ts is the pattern), its trees and techs (growthData.ts), and an entry here.
 *
 * A save without `theatre` is the Korean theatre of 1592, so those saves, their seeds and their digests are unchanged.
 */
export type TheatreDef = {
  id: TheatreId;
  factions: readonly GrandFaction[];
  order: readonly RegionId[];
  start: StartSetup;
  relations: Partial<Record<PairKey, Relation>>;
  /** The first turn's date: its year, and the months from January to its first month. */
  year: number;
  since: number;
  /** The first line of the campaign's log. */
  intro: string;
  /** The default seed of a new campaign (headless runs). */
  seed: number;
};

export const THEATRES: Record<TheatreId, TheatreDef> = {
  imjin: {
    id: 'imjin',
    factions: ['joseon', 'japan', 'ming'],
    order: REGION_ORDER,
    start: START,
    relations: { 'japan:joseon': 'war', 'japan:ming': 'war', 'joseon:ming': 'allied' },
    year: 1592,
    since: 3,
    intro: '조선, 일본, 명 세 진영이 남해의 물길을 두고 맞섭니다.',
    seed: 1592,
  },
  armada: {
    id: 'armada',
    factions: ['england', 'spain'],
    order: ARMADA_REGION_ORDER,
    start: ARMADA_START,
    relations: { 'england:spain': 'war' },
    year: 1588,
    since: 6,
    intro: '잉글랜드와 에스파냐가 해협과 북해의 물길을 두고 맞섭니다.',
    seed: 1588,
  },
  // July 1571: the Holy League concluded in May, its fleet gathering at Messina, Famagusta still holding out.
  lepanto: {
    id: 'lepanto',
    factions: ['holyleague', 'ottoman'],
    order: LEPANTO_REGION_ORDER,
    start: LEPANTO_START,
    relations: { 'holyleague:ottoman': 'war' },
    year: 1571,
    since: 6,
    intro: '신성동맹과 오스만 제국이 이오니아해와 지중해의 물길을 두고 맞섭니다.',
    seed: 1571,
  },
};

export const theatreOf = (g: Pick<Grand, 'theatre'> | null | undefined): TheatreDef => THEATRES[g?.theatre ?? 'imjin'];
/** The navies of the campaign's theatre, in their fixed order. */
export const factionsOf = (g: Pick<Grand, 'theatre'> | null | undefined): readonly GrandFaction[] => theatreOf(g).factions;
/** The campaign's regions in their fixed order. */
export const orderOf = (g: Pick<Grand, 'theatre'> | null | undefined): readonly RegionId[] => theatreOf(g).order;
/** The theatre a faction fights in. */
export const theatreOfFaction = (f: GrandFaction): TheatreDef => Object.values(THEATRES).find((t) => t.factions.includes(f)) ?? THEATRES.imjin;
