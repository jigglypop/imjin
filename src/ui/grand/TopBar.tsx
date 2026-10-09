import { FACTION_INFO, FactionMark, Icon, signed } from './shared';
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

export function TopBar({ turn, treasury, onEndTurn, onMenu, onStatus, busy, endLabel = '턴 종료' }: TopBarProps) {
  const net = treasury.income.gold;
  return (
    <header className="g-glass g-top">
      <div className="g-top__turn">
        {onMenu && (
          <button type="button" className="g-icon-btn g-icon-btn--flat" aria-label="메뉴" onClick={onMenu}>
            <Icon name="menu" />
          </button>
        )}
        <FactionMark faction={turn.faction} size="md" />
        <div className="g-top__date">
          <b>{turn.date}</b>
          <span>
            {FACTION_INFO[turn.faction].navy} · {turn.turn} / {turn.maxTurns}턴
          </span>
        </div>
      </div>
      <ul className="g-top__res" aria-label="재물">
        <li className="g-res" title="은">
          <span className="g-res__glyph">
            <Icon name="coin" />
          </span>
          <span className="g-res__name">은</span>
          <b className="g-res__val">{treasury.stock.gold.toLocaleString('ko-KR')}</b>
          <span className={`g-res__net${net < 0 ? ' g-res__net--neg' : ''}`}>{signed(net)}</span>
        </li>
        {onStatus && (
          <li>
            <button type="button" className="g-btn g-btn--sm g-top__status" onClick={onStatus}>
              전황
            </button>
          </li>
        )}
      </ul>
      <button type="button" className="g-btn g-btn--primary g-top__end" disabled={busy} onClick={onEndTurn}>
        {endLabel}
      </button>
    </header>
  );
}
