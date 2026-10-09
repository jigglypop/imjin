import { useEffect, useState } from 'react';
import { t, useT } from '../../i18n';
import { FACTION_INFO, FactionMark, Icon, navyName, num, toneStyle } from './shared';
import { shipsText } from './text';
import type { BattlePreviewView, BattleSideView } from './types';

export interface BattlePreviewProps {
  battle: BattlePreviewView;
  onFight?: () => void;
  onAuto?: () => void;
  onCancel?: () => void;
  /** Label of the button that closes the preview, e.g. 나중에. */
  cancelLabel?: string;
}

function Side({ side, role, share }: { side: BattleSideView; role: string; share: number }) {
  const t = useT();
  return (
    <div className="g-bside" style={toneStyle(side.faction)}>
      <div className="g-bside__role">{role}</div>
      <div className="g-bside__who">
        <FactionMark faction={side.faction} size="md" />
        <div>
          <b>{side.name}</b>
          <span>{navyName(side.faction)}</span>
        </div>
      </div>
      {side.leader && (
        <div className="g-leader g-leader--tight">
          <img src={`/ui/portraits/${side.leader.portrait}.jpg`} alt="" width={36} height={36} />
          <span className="g-row__main">
            <span className="g-row__title">{side.leader.name}</span>
            <span className="g-row__sub">
              {side.leader.title} · Lv.{side.leader.level}
            </span>
          </span>
        </div>
      )}
      <dl className="g-bside__stats">
        <div>
          <dt>{t('함선')}</dt>
          <dd>{shipsText(side.ships)}</dd>
        </div>
        <div>
          <dt>{t('승조원')}</dt>
          <dd>{num(side.crew)}</dd>
        </div>
        <div>
          <dt>{t('전력 비중')}</dt>
          <dd>{Math.round(share * 100)}%</dd>
        </div>
      </dl>
      {side.bonuses && side.bonuses.length > 0 && (
        <ul className="g-bside__bonus">
          {side.bonuses.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Below this chance of winning, handing the fight to the numbers asks for a second confirmation. */
const RISKY = 0.25;

function percent(p: number) {
  if (p < 0.01) return t('1% 미만');
  if (p < 1 && p > 0.99) return t('99% 이상');
  return `${Math.round(p * 100)}%`;
}

/** Pre-battle summary: both sides' strength as a tug-of-war bar, then fight it out in 3D or let the numbers decide. */
export function BattlePreview({ battle, onFight, onAuto, onCancel, cancelLabel }: BattlePreviewProps) {
  const t = useT();
  const { attacker, defender } = battle;
  const total = Math.max(1, attacker.power + defender.power);
  const aShare = attacker.power / total;
  const a = FACTION_INFO[attacker.faction].color;
  const d = FACTION_INFO[defender.faction].color;
  const [sure, setSure] = useState(false);
  // The chance that the side the player leads wins if the numbers decide; a spectator's view follows the attacker.
  const ours = battle.you === 'defender' ? 1 - battle.winChance : battle.winChance;
  const risky = ours < RISKY;
  // Esc closes the preview like the close button does.
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onCancel?.();
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [onCancel]);
  return (
    <div className="g-scrim" role="presentation" onClick={onCancel}>
      <section
        className="g-glass g-modal g-battle"
        role="dialog"
        aria-modal="true"
        aria-label={t('{place} 전투', { place: battle.regionName })}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="g-sheet__handle g-sheet__handle--static" aria-hidden />
        <header className="g-sheet__head">
          <div className="g-sheet__titles">
            <div className="g-sheet__eyebrow">{t('전투 준비')}</div>
            <h2 className="g-sheet__title">{t('{place} 해전', { place: battle.regionName })}</h2>
          </div>
          <button type="button" className="g-icon-btn" aria-label={t('닫기')} onClick={onCancel}>
            <Icon name="close" />
          </button>
        </header>
        <div className="g-sheet__body">
          <div className="g-versus">
            <Side side={attacker} role={battle.you === 'attacker' ? t('공격 · 우리 측') : t('공격')} share={aShare} />
            <span className="g-versus__vs" aria-hidden>
              VS
            </span>
            <Side side={defender} role={battle.you === 'defender' ? t('수비 · 우리 측') : t('수비')} share={1 - aShare} />
          </div>

          <div className="g-power" role="img" aria-label={t('전력 비 {a} 대 {d}', { a: Math.round(aShare * 100), d: Math.round((1 - aShare) * 100) })}>
            <span className="g-power__a" style={{ width: `${aShare * 100}%`, background: a }} />
            <span className="g-power__d" style={{ width: `${(1 - aShare) * 100}%`, background: d }} />
          </div>
          <div className="g-power__legend">
            <span>{t('공격 {n}', { n: Math.round(aShare * 100) })}</span>
            <span>{t('수비 {n}', { n: Math.round((1 - aShare) * 100) })}</span>
          </div>

          <p className={`g-power__odds${risky ? ' g-power__odds--risky' : ''}`}>
            {battle.you ? t('자동 전투로 진행하면 우리 측이 이길 확률은 {p}입니다.', { p: percent(ours) }) : t('자동 전투로 진행하면 공격 측이 이길 확률은 {p}입니다.', { p: percent(ours) })}
            {risky ? ' ' + t('직접 지휘하는 편이 유리합니다.') : ''}
          </p>

          {battle.notes && battle.notes.length > 0 && (
            <ul className="g-notes">
              {battle.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
        <footer className="g-sheet__foot">
          {sure ? (
            <div className="g-sure">
              <p>{t('승률이 {p}에 그칩니다. 자동 전투에서는 함대를 잃고 포구를 빼앗길 수 있습니다. 그래도 자동 전투로 진행합니까?', { p: percent(ours) })}</p>
              <div className="g-actions">
                <button type="button" className="g-btn g-btn--primary" onClick={onFight}>
                  {t('직접 지휘')}
                </button>
                <button type="button" className="g-btn g-btn--danger" onClick={onAuto}>
                  {t('자동 전투')}
                </button>
                <button type="button" className="g-btn g-btn--ghost" onClick={() => setSure(false)}>
                  {t('돌아가기')}
                </button>
              </div>
            </div>
          ) : (
            <div className="g-actions">
              <button type="button" className="g-btn g-btn--primary" onClick={onFight}>
                {t('전투 시작')}
              </button>
              <button type="button" className="g-btn" onClick={() => (risky ? setSure(true) : onAuto?.())}>
                {t('자동 전투')}
              </button>
              <button type="button" className="g-btn g-btn--ghost" onClick={onCancel}>
                {cancelLabel ?? t('취소')}
              </button>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}
