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
  /** Disables the end-turn button, e.g. while battles wait or the war is over. */
  busy?: boolean;
  endLabel?: string;
}

export function TopBar({ turn, treasury, onEndTurn, onMenu, onStatus, busy, endLabel }: TopBarProps) {
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
