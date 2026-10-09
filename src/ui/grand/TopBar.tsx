import { FactionSeal, RESOURCES, signed } from './shared';
import type { TreasuryView, TurnView } from './types';

export interface TopBarProps {
  turn: TurnView;
  treasury: TreasuryView;
  onEndTurn?: () => void;
  onMenu?: () => void;
  /** Disables 턴 종료, e.g. while the enemy moves. */
  busy?: boolean;
}

export function TopBar({ turn, treasury, onEndTurn, onMenu, busy }: TopBarProps) {
  return (
    <header className="g-glass g-top">
      <div className="g-top__turn">
        {onMenu && (
          <button type="button" className="g-icon-btn g-icon-btn--flat" aria-label="메뉴" onClick={onMenu}>
            ☰
          </button>
        )}
        <FactionSeal faction={turn.faction} />
        <div className="g-top__date">
          <b>{turn.date}</b>
          <span>{turn.turn}턴</span>
        </div>
      </div>
      <ul className="g-top__res" aria-label="재물">
        {RESOURCES.map((r) => {
          const net = treasury.income[r.kind];
          return (
            <li key={r.kind} className="g-res" title={r.name}>
              <span className="g-res__glyph" aria-hidden>
                {r.glyph}
              </span>
              <span className="g-res__name">{r.name}</span>
              <b className="g-res__val">{treasury.stock[r.kind].toLocaleString('ko-KR')}</b>
              <span className={`g-res__net${net < 0 ? ' g-res__net--neg' : ''}`}>{signed(net)}</span>
            </li>
          );
        })}
      </ul>
      <button type="button" className="g-btn g-btn--primary g-top__end" disabled={busy} onClick={onEndTurn}>
        {busy ? '진행 중…' : '턴 종료'}
      </button>
    </header>
  );
}
