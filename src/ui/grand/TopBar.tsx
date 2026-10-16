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
  /** Growth rules: open the commanders' screen and the tech tree; `points` is the skill points waiting, shown as a badge. */
  onCommanders?: () => void;
  onTech?: () => void;
  points?: number;
  onBatch?: () => void;
  /** The automatic-building switch: its state and the flip. Omitted, no switch is drawn. */
  autoWorks?: boolean;
  onAutoWorks?: (on: boolean) => void;
  /** Disables the end-turn button, e.g. while battles wait or the war is over. */
  busy?: boolean;
  endLabel?: string;
}

export function TopBar({ turn, treasury, onEndTurn, onMenu, onStatus, onCommanders, onTech, points = 0, onBatch, autoWorks, onAutoWorks, busy, endLabel }: TopBarProps) {
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
              <span className="g-top__winter" title={t('겨울: 행동력 −20% · 바다 위 보급 소모 증가')}>
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
        {onBatch && <li className="g-top__slot--batch"><button type="button" className="g-btn g-btn--sm g-top__batch" disabled={busy} onClick={onBatch}>{t('일괄 이동')}</button></li>}
        {onAutoWorks && (
          <li className="g-top__slot--auto">
            <button
              type="button"
              className={`g-btn g-btn--sm g-top__auto${autoWorks ? ' g-top__auto--on' : ''}`}
              aria-pressed={!!autoWorks}
              title={t('켜면 턴 끝에 남는 은으로 시설을 짓습니다 · 함선 제외')}
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
        {onCommanders && (
          <li className="g-top__slot--cmd">
            <button type="button" className="g-btn g-btn--sm g-top__cmd" onClick={onCommanders}>
              {t('장수')}
              {points > 0 && <span className="g-top__badge" aria-label={t('익힐 재능 {n}개', { n: points })}>{points}</span>}
            </button>
          </li>
        )}
        {onTech && (
          <li className="g-top__slot--tech">
            <button type="button" className="g-btn g-btn--sm g-top__tech" onClick={onTech}>
              {t('기술')}
            </button>
          </li>
        )}
        {onStatus && (
          <li className="g-top__slot--status">
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
