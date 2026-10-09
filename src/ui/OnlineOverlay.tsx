import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { net, useNet } from '../net/NetClient';
import { GRACE_SECONDS } from '../net/protocol';
import { useT } from '../i18n';
import { setScreen, useUi } from '../state/store';
import { sound } from '../audio/Sound';
import type { Engine } from '../game/Engine';

/** Back to the online lobby (the room, when it is kept). `leaveRoom` also gives up the seat; otherwise the room stays for a rematch. */
function exitBattle(leaveRoom: boolean) {
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

/**
 * Online status drawn over the battle: the server's pace while it skips the approach (read only), the state of the
 * connection, and what to do once the battle is over or the seat was lost. It sits beside the HUD rather than in it.
 */
function OnlineOverlay() {
  const t = useT();
  const screen = useUi((s) => s.screen);
  const battle = useNet((s) => s.battle);
  const status = useNet((s) => s.status);
  const retry = useNet((s) => s.retry);
  const speed = useNet((s) => s.speed);
  const room = useNet((s) => s.room);
  const notice = useNet((s) => s.notice);
  const me = useNet((s) => s.id);

  // A rematch agreed in a room sends everyone back to it; a quick-match room restarts on its own.
  useEffect(() => {
    if (battle === 'ended' && room?.state === 'lobby' && !room.quick && screen === 'battle') exitBattle(false);
  }, [battle, room?.state, room?.quick, screen]);

  if (screen !== 'battle' || battle === 'none') return null;
  const mine = room?.seats.find((s) => s.client === me);
  const humans = room?.seats.filter((s) => s.client && !s.away) ?? [];
  return (
    <div className="on-overlay">
      <div className="on-pills">
        {battle === 'playing' && speed.target === 0 && (
          <div className="on-pill">
            <b>{t('상대를 기다리고 있습니다')}</b>
            <span>{t('모두 입장하면 전투가 시작됩니다')}</span>
          </div>
        )}
        {battle === 'playing' && speed.target > 1 && (
          <div className="on-pill" title={t('적과 접촉할 때까지 서버가 시간을 빠르게 진행합니다')}>
            <b>{t('빠른 접근 ×{n}', { n: speed.speed })}</b>
            <span>{t('적과 접촉하면 정상 속도로 돌아갑니다')}</span>
          </div>
        )}
        {status !== 'online' && battle !== 'lost' && (
          <div className="on-pill on-pill--warn">
            <b>{t('연결이 끊어졌습니다')}</b>
            <span>
              {retry ? t('{n}초 뒤 다시 연결합니다', { n: retry.in }) : t('다시 연결하고 있습니다')} · {t('자리는 {n}초 동안 유지됩니다', { n: GRACE_SECONDS })}
            </span>
            <button className="chip" onClick={() => net.retryNow()}>
              {t('지금 다시 시도')}
            </button>
          </div>
        )}
      </div>
      {battle === 'ended' && room && (
        <div className="on-end paper">
          <span>
            {mine?.rematch ? t('재대결을 기다리고 있습니다 ({done}/{total})', { done: humans.filter((s) => s.rematch).length, total: humans.length }) : t('한 판 더 하시겠습니까?')}
          </span>
          <button className={`chip ${mine?.rematch ? 'chip--on' : ''}`} disabled={!mine || mine.rematch} onClick={() => net.send({ t: 'rematch' })}>
            {t('재대결')}
          </button>
          <button className="chip" onClick={() => exitBattle(false)}>
            {t('대기실로')}
          </button>
        </div>
      )}
      {battle === 'lost' && (
        <div className="on-lost paper">
          <b>{t(notice ?? '전투에서 물러났습니다.')}</b>
          <button
            className="ink-btn on-go"
            onClick={() => {
              click();
              exitBattle(true);
            }}
          >
            {t('대기실로')}
          </button>
        </div>
      )}
    </div>
  );
}

const click = () => sound.click();

/** Draws the overlay in a root of its own: the online workstream owns it and the app shell stays as it is. */
export function mountOnlineOverlay() {
  if (document.getElementById('online-overlay')) return;
  const el = document.createElement('div');
  el.id = 'online-overlay';
  document.body.appendChild(el);
  createRoot(el).render(<OnlineOverlay />);
}
