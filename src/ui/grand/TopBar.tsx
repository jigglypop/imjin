import { useT } from '../../i18n';
import { FactionMark, Icon, navyName, num, signed } from './shared';
import type { TreasuryView, TurnView } from './types';

export interface TopBarProps {
  turn: TurnView;
  treasury: TreasuryView;
  onEndTurn?: () => void;
  onMenu?: () => void;
  /** Opens the war status panel (objective, scores, log). */
  onStatus?: () => void;
  onBatch?: () => void;
  /** Picks every idle fleet of the player's in port into the batch ("유휴 함대 선택"). */
  onIdle?: () => void;
  /** Selects the next (1) or previous (-1) fleet of the player's: the buttons of Tab and Shift+Tab. */
  onCycle?: (step: 1 | -1) => void;
  /** The automatic-building switch: its state and the flip. Omitted, no switch is drawn. */
  autoWorks?: boolean;
  onAutoWorks?: (on: boolean) => void;
  /** Disables the end-turn button, e.g. while battles wait or the war is over. */
  busy?: boolean;
  endLabel?: string;
  /** Enter ends the turn now: the button shows the key. */
  endKey?: boolean;
}

export function TopBar({ turn, treasury, onEndTurn, onMenu, onStatus, onBatch, onIdle, onCycle, autoWorks, onAutoWorks, busy, endLabel, endKey }: TopBarProps) {
  const t = useT();
  const net = treasury.income.gold;
  return (
    <header className="g-glass g-top">
      <div className="g-top__turn">
        {onMenu && (
          <button type="button" className="g-icon-btn g-icon-btn--flat" aria-label={t('메뉴')} onClick={onMenu}>
            <Icon name="menu" />
          </button>
        )}
        <FactionMark faction={turn.faction} size="md" />
        <div className="g-top__date">
          <b>{turn.date}</b>
          <span>
            {t('{navy} · {turn} / {max}턴', { navy: navyName(turn.faction), turn: turn.turn, max: turn.maxTurns })}
          </span>
        </div>
      </div>
      <ul className="g-top__res" aria-label={t('재물')}>
        {onCycle && (
          <li className="g-top__cycle">
            <button type="button" className="g-btn g-btn--sm" disabled={busy} aria-label={t('이전 함대')} title={t('이전 함대 (Shift+Tab)')} onClick={() => onCycle(-1)}>
              ‹
            </button>
            <button type="button" className="g-btn g-btn--sm" disabled={busy} title={t('다음 함대 (Tab)')} onClick={() => onCycle(1)}>
              {t('다음 함대')} <kbd className="g-kbd">Tab</kbd>
            </button>
          </li>
        )}
        {onIdle && <li><button type="button" className="g-btn g-btn--sm g-top__idle" disabled={busy} title={t('포구에 머물며 항로가 없는 우리 함대를 모두 골라 한 번에 보냅니다.')} onClick={onIdle}>{t('유휴 함대 선택')}</button></li>}
        {onBatch && <li><button type="button" className="g-btn g-btn--sm g-top__batch" disabled={busy} onClick={onBatch}>{t('일괄 이동')}</button></li>}
        {onAutoWorks && (
          <li>
            <button
              type="button"
              className={`g-btn g-btn--sm g-top__auto${autoWorks ? ' g-top__auto--on' : ''}`}
              aria-pressed={!!autoWorks}
              title={t('켜 두면 턴을 마칠 때 군영과 시설을 은이 남는 만큼 알아서 짓고 올립니다. 함선은 짓지 않습니다.')}
              onClick={() => onAutoWorks(!autoWorks)}
            >
              {t('자동 건설')} <b>{autoWorks ? t('켜짐') : t('꺼짐')}</b>
            </button>
          </li>
        )}
        <li className="g-res" title={t('은')}>
          <span className="g-res__glyph">
            <Icon name="coin" />
          </span>
          <span className="g-res__name">{t('은')}</span>
          <b className="g-res__val">{num(treasury.stock.gold)}</b>
          <span className={`g-res__net${net < 0 ? ' g-res__net--neg' : ''}`}>{signed(net)}</span>
        </li>
        {onStatus && (
          <li>
            <button type="button" className="g-btn g-btn--sm g-top__status" onClick={onStatus}>
              {t('전황')}
            </button>
          </li>
        )}
      </ul>
      <button type="button" className="g-btn g-btn--primary g-top__end" disabled={busy} onClick={onEndTurn}>
        {endLabel ?? t('턴 종료')}
        {endKey && <kbd className="g-kbd">Enter</kbd>}
      </button>
    </header>
  );
}
