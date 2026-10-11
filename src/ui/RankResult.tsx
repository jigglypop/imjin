import { net, useNet } from '../net/NetClient';
import type { RankReason, RankTier } from '../net/protocol';
import type { Engine } from '../game/Engine';
import { sound } from '../audio/Sound';
import { setScreen } from '../state/store';
import { useT } from '../i18n';

export const RANK_TIER: Record<RankTier, string> = {
  provisional: '배치 중', bronze: '브론즈', silver: '실버', gold: '골드',
  platinum: '플래티넘', diamond: '다이아몬드', admiral: '제독',
};
const REASON: Record<RankReason, string> = {
  battle: '', forfeit: '기권', disconnect: '연결 시간 초과',
  'load-timeout': '전장 준비 시간 초과', restart: '서버 재시작', 'server-error': '서버 오류',
};

/** Leaving the old ranked room before queueing prevents rematches from bypassing matchmaking. */
export function exitOnlineBattle(leaveRoom: boolean) {
  const engine = (window as unknown as { __engine?: Engine }).__engine;
  if (leaveRoom) net.send({ t: 'leave' });
  else net.clearBattle();
  if (engine) {
    engine.leaveRemote();
    engine.paused = true;
  }
  sound.setMode('select');
  setScreen('online');
}

export function RankResult({ showOutcome = false }: { showOutcome?: boolean }) {
  const t = useT();
  const result = useNet((s) => s.rankResult);
  const error = useNet((s) => s.error);
  if (!result) return <div className="rank-result on-hint" role="status">{t(error ?? '점수를 집계하는 중입니다')}</div>;
  const { profile } = result;
  return (
    <div className="rank-result" aria-live="polite">
      {(showOutcome || result.result === 'void') && <b>{t(result.result === 'void' ? '집계 제외' : result.result === 'win' ? '승리' : result.result === 'loss' ? '패배' : '무승부')}</b>}
      <div className="rank-result-score">
        <span>{t('랭크 점수')} <b>{result.after}</b></span>
        <span className={`rank-delta ${result.delta > 0 ? 'rank-delta--up' : result.delta < 0 ? 'rank-delta--down' : ''}`}>{result.delta > 0 ? '+' : ''}{result.delta}</span>
        <span>{t(RANK_TIER[profile.tier])}</span>
      </div>
      <span className="rank-result-detail">{profile.placementLeft > 0 ? t('배치 {n}판 남음', { n: profile.placementLeft }) : t('{win}승 {draw}무 {loss}패', { win: profile.wins, draw: profile.draws, loss: profile.losses })}{REASON[result.reason] && ` · ${t(REASON[result.reason])}`}</span>
    </div>
  );
}

export function RankActions() {
  const t = useT();
  const status = useNet((s) => s.status);
  const result = useNet((s) => s.rankResult);
  const next = () => {
    const s = useNet.getState();
    const faction = s.rankResult?.profile.recent.find((r) => r.matchId === s.rankResult?.matchId)?.faction
      ?? s.room?.seats.find((seat) => seat.client === s.id)?.faction ?? 'joseon';
    sound.click();
    exitOnlineBattle(true);
    net.ranked(faction);
  };
  return (
    <>
      <button className="ink-btn on-rank-next" disabled={status !== 'online' || !result} onClick={next}>{t('다음 랭크전')}</button>
      <button className="chip on-rank-lobby" onClick={() => { sound.click(); exitOnlineBattle(true); }}>{t('대기실로')}</button>
    </>
  );
}
