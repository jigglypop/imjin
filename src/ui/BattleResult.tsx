import { useT } from '../i18n';
import { CHAPTER_NAVIES, SCENARIOS, chapterOfScenario, type ScenarioId } from '../sim/scenarios';
import { FACTION_SHORT } from '../sim/balance';
import type { GameSnapshot } from '../state/store';
import { GUIDES, scoreBattle } from './guideText';
import { ShareButton } from './share';

/** The navy the player fought: the other slot of the battle's chapter. */
const enemyNavy = (id: ScenarioId, team: 'joseon' | 'japan') => CHAPTER_NAVIES[chapterOfScenario(id)][team === 'joseon' ? 1 : 0];

/** The score and the history comparison of a decided historical battle, with a button that shares them. */
export function BattleResult({ snap, time }: { snap: GameSnapshot; time: string }) {
  const t = useT();
  const id = snap.scenario.id as ScenarioId;
  const info = SCENARIOS[id];
  const guide = GUIDES[id];
  const destroyed = snap.enemyTotal - snap.enemy - snap.escaped;
  const lost = snap.ownTotal - snap.own;
  const r = scoreBattle(id, { won: snap.winner === snap.team, draw: snap.draw, own: snap.own, ownTotal: snap.ownTotal, enemyTotal: snap.enemyTotal, destroyed });
  const survive = guide.kind === 'survive';
  const yours = survive
    ? t('{n}척 생존', { n: snap.own })
    : t('{navy} 함선 {n}척 격파, 아군 {m}척 손실', { navy: t(FACTION_SHORT[enemyNavy(id, snap.team)]), n: destroyed, m: lost });
  const gap = r.value - r.history;
  const verdict = survive
    ? gap > 0 ? t('역사보다 {n}척을 더 살렸습니다.', { n: gap }) : t('역사만큼 함선을 지켜 내지 못했습니다.')
    : gap >= 0 ? t('역사의 전과를 넘어섰습니다.') : t('역사의 전과에 {n}척 모자랍니다.', { n: -gap });
  const stars = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
  const line = t('{title} {stars} {score}점 · {yours} · {time}', { title: t(info.title), stars, score: r.score, yours, time });
  return (
    <>
      <div className="result-score">
        <span className="result-stars" aria-label={t('별 {n}개', { n: r.stars })}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i < r.stars ? '' : 'off'}>
              ★
            </span>
          ))}
        </span>
        <span>
          {t('결과 점수')} <b>{r.score}</b>
        </span>
      </div>
      <div className="result-history">
        <span>{t('실제 역사')}</span>
        <b>{t(info.result)}</b>
        <span>{t('당신')}</span>
        <b>{yours}</b>
        <span className="result-verdict">{verdict}</span>
      </div>
      <ShareButton id={id} line={line} label={t('결과 공유')} />
    </>
  );
}
