import { t } from '../../i18n';
import { RESOLVE } from '../../sim/grand/autoresolve';
import { BATTERY_PER_LEVEL, BUILDING_ORDER, GATES, TUNING, batteryStrength, garrisonCap, kindsOf, levelOf, queueSlots, regionIncome, repairRates, upkeepFree } from '../../sim/grand/economy';
import { marching } from '../../sim/grand/march';
import { buildRequirement } from '../../sim/grand/orders';
import { holdOf } from '../../sim/grand/turn';
import type { BuildingKind, Grand, RegionId, RegionState } from '../../sim/grand/types';
import { MAX_LEVEL } from '../../sim/grand/types';
import { beaconSight } from '../../sim/grand/world';
import { SHIP_NAME, buildingName, goldText, num } from './shared';
import { turnsText } from './text';
import type { WorkEffectView } from './types';

/**
 * What a work does at its present level and what the next one adds, for the work's detail card. Every number comes from
 * asking the campaign's own rules about the same port with the work at another level, so the card cannot drift from
 * what a turn does.
 */

const pct = (share: number) => `${Math.round(share * 100)}%`;
const plusPct = (share: number) => `+${pct(share)}`;

/** The port as it would be with `kind` standing at `level` (0 = absent) and nothing else changed. */
function withLevel(g: Grand, id: RegionId, kind: BuildingKind, level: number): { g: Grand; r: RegionState } {
  const r = g.regions[id];
  const have = r.buildings.find((b) => b.kind === kind);
  const others = r.buildings.filter((b) => b.kind !== kind);
  const buildings = level > 0 ? [...others, { kind, level, upgradeLeft: 0, upgradeTotal: 0, hp: have?.hp ?? 1 }] : others;
  const next = { ...r, buildings };
  return { g: { ...g, regions: { ...g.regions, [id]: next } }, r: next };
}

/** Works and levels a camp of this level allows that the camp a level below does not. */
function campOpens(g: Grand, id: RegionId, level: number): string[] {
  const below = withLevel(g, id, 'camp', level - 1).g;
  const at = withLevel(g, id, 'camp', level).g;
  const out: string[] = [];
  for (let to = 2; to <= MAX_LEVEL; to++) {
    const opened = BUILDING_ORDER.filter((k) => k !== 'camp' && buildRequirement(below, id, k, to) && !buildRequirement(at, id, k, to));
    if (opened.length === BUILDING_ORDER.length - 1) out.push(t('모든 시설 {level}단계', { level: to }));
    else if (opened.length) out.push(t('{works} {level}단계', { works: opened.map(buildingName).join('·'), level: to }));
  }
  return out;
}

/** Ships a shipyard of this level lets the port lay down that one a level below does not. */
function yardOpens(g: Grand, id: RegionId, level: number): string[] {
  const owner = g.regions[id].owner;
  if (!owner) return [];
  const unlocked = g.factions[owner].unlocked;
  return kindsOf(owner)
    .filter((k) => (GATES[k]?.yard ?? 1) === level)
    .map((k) => (GATES[k]?.unlock && !unlocked.includes(k) ? t('{ship} (설계 후)', { ship: t(SHIP_NAME[k]) }) : t(SHIP_NAME[k])));
}

export function workEffects(g: Grand, id: RegionId, kind: BuildingKind): { effects: WorkEffectView[]; opens: string[] } {
  const r = g.regions[id];
  const owner = r.owner;
  const level = levelOf(r, kind);
  const nextLevel = level < MAX_LEVEL ? level + 1 : null;
  const now = withLevel(g, id, kind, level);
  const next = nextLevel ? withLevel(g, id, kind, nextLevel) : null;
  const none = withLevel(g, id, kind, 0);
  const effects: WorkEffectView[] = [];
  /** One line of the table: the value at the present level and at the next. */
  const line = (label: string, value: (at: { g: Grand; r: RegionState }, lv: number) => string) =>
    effects.push({ label, now: value(now, level), next: next && nextLevel ? value(next, nextLevel) : null });
  const dash = '—';
  const repair = (part: 'hull' | 'crew') => (at: { r: RegionState }, lv: number) => (lv ? plusPct(repairRates(at.r)[part] - repairRates(none.r)[part]) : dash);
  const income = (share: number) => (at: { g: Grand }, lv: number) => {
    if (!lv) return dash;
    const gold = regionIncome(at.g, id) - regionIncome(none.g, id);
    return gold > 0 ? t('{share} (은 +{gold})', { share: plusPct(share * lv), gold }) : plusPct(share * lv);
  };
  const hold = (at: { r: RegionState }) => turnsText(holdOf(at.r));
  const opens: string[] = [];

  switch (kind) {
    case 'camp':
      line(t('유지비 면제 한도'), (at, lv) => (lv && owner ? `+${goldText(num(upkeepFree(at.g, owner) - upkeepFree(none.g, owner)))}` : dash));
      line(t('선체 수리 / 턴'), repair('hull'));
      line(t('승조원 보충 / 턴'), repair('crew'));
      line(t('수비대 한도'), (at) => t('{n}척', { n: garrisonCap(id, at.r) }));
      line(t('수비 전투력'), (_, lv) => (lv ? plusPct(RESOLVE.campPerLevel * lv) : dash));
      if (marching(g)) line(t('봉쇄 버팀'), hold);
      if (nextLevel) opens.push(...campOpens(g, id, nextLevel));
      break;
    case 'shipyard':
      line(t('동시 건조'), (at) => t('{n}척', { n: queueSlots(at.r) }));
      line(t('함선 가격'), (_, lv) => (lv ? pct(TUNING.yardDiscount[lv - 1] ?? 1) : dash));
      if (nextLevel) opens.push(...yardOpens(g, id, nextLevel));
      break;
    case 'battery':
      line(t('포대 전력'), (at, lv) => (lv ? num(Math.round(batteryStrength(at.r))) : dash));
      line(t('단계당 전력'), () => num(BATTERY_PER_LEVEL));
      break;
    case 'dock': {
      line(t('선체 수리 / 턴'), repair('hull'));
      line(t('승조원 보충 / 턴'), repair('crew'));
      // A fleet can be refitted at once in a port with a camp or a dock (orderRefit).
      const refit = (at: { r: RegionState }) => levelOf(at.r, 'camp') > 0 || levelOf(at.r, 'dock') > 0;
      if (next && !refit(now) && refit(next)) opens.push(t('즉시 재정비'));
      break;
    }
    case 'granary':
      line(t('수입'), income(TUNING.granaryBonus));
      if (marching(g)) line(t('봉쇄 버팀'), hold);
      if (!level) opens.push(t('전투 시 화약고'));
      break;
    case 'beacon':
      line(t('시야'), (_, lv) => (lv ? t('항로 {n}개 앞', { n: beaconSight(lv) }) : t('포구만')));
      line(t('수입'), income(TUNING.beaconBonus));
      break;
  }
  return { effects, opens };
}
