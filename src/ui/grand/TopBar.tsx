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
  /** The automatic-building switch: its state and the flip. Omitted, no switch is drawn. */
  autoWorks?: boolean;
  onAutoWorks?: (on: boolean) => void;
  /** Disables the end-turn button, e.g. while battles wait or the war is over. */
  busy?: boolean;
  endLabel?: string;
}

export function TopBar({ turn, treasury, onEndTurn, onMenu, onStatus, onBatch, autoWorks, onAutoWorks, busy, endLabel }: TopBarProps) {
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
          <b>
            {turn.date}
            {turn.winter && (
              <span className="g-top__winter" title={t('겨울: 행동력 −20%, 바다 위 함대 보급 소모 증가')}>
                {t('겨울')}
              </span>
            )}
          </b>
          <span>
            {t('{navy} · {turn} / {max}턴', { navy: navyName(turn.faction), turn: turn.turn, max: turn.maxTurns })}
          </span>
        </div>
      </div>
      <ul className="g-top__res" aria-label={t('재물')}>
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
      </button>
    </header>
  );
}
