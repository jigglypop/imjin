import { useState } from 'react';
import { FACTION_INFO, FactionSeal } from './shared';
import { josa } from '../../sim/grand/josa';
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
  const f = FACTION_INFO[side.faction];
  return (
    <div className="g-bside" style={{ ['--tone' as string]: f.color }}>
      <div className="g-bside__role">{role}</div>
      <div className="g-bside__who">
        <FactionSeal faction={side.faction} />
        <div>
          <b>{side.name}</b>
          <span>{f.name}</span>
        </div>
      </div>
      <dl className="g-bside__stats">
        <div>
          <dt>함선</dt>
          <dd>{side.ships}척</dd>
        </div>
        <div>
          <dt>병력</dt>
          <dd>{side.crew.toLocaleString('ko-KR')}</dd>
        </div>
        <div>
          <dt>전력 점유</dt>
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
  if (p < 0.01) return '1% 미만';
  if (p < 1 && p > 0.99) return '99% 이상';
  return `${Math.round(p * 100)}%`;
}

/** Pre-battle summary: both sides' strength as a tug-of-war bar, then fight it out in 3D or let the numbers decide. */
export function BattlePreview({ battle, onFight, onAuto, onCancel, cancelLabel = '취소' }: BattlePreviewProps) {
  const { attacker, defender } = battle;
  const total = Math.max(1, attacker.power + defender.power);
  const aShare = attacker.power / total;
  const a = FACTION_INFO[attacker.faction].color;
  const d = FACTION_INFO[defender.faction].color;
  const [sure, setSure] = useState(false);
  // The chance that the side the player leads wins if the numbers decide; a spectator's view follows the attacker.
  const ours = battle.you === 'defender' ? 1 - battle.winChance : battle.winChance;
  const subject = battle.you ? '우리' : '공격 쪽';
  const risky = ours < RISKY;
  return (
    <div className="g-scrim" role="presentation" onClick={onCancel}>
      <section
        className="g-glass g-modal g-battle"
        role="dialog"
        aria-modal="true"
        aria-label={`${battle.regionName} 전투`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="g-sheet__handle g-sheet__handle--static" aria-hidden />
        <header className="g-sheet__head">
          <div className="g-sheet__titles">
            <div className="g-sheet__eyebrow">전투 준비</div>
            <h2 className="g-sheet__title">{battle.regionName} 해전</h2>
          </div>
          <button type="button" className="g-icon-btn" aria-label="닫기" onClick={onCancel}>
            ×
          </button>
        </header>
        <div className="g-sheet__body">
          <div className="g-versus">
            <Side side={attacker} role={battle.you === 'attacker' ? '공격 · 우리' : '공격'} share={aShare} />
            <span className="g-versus__vs" aria-hidden>
              對
            </span>
            <Side side={defender} role={battle.you === 'defender' ? '수비 · 우리' : '수비'} share={1 - aShare} />
          </div>

          <div className="g-power" role="img" aria-label={`전력 비 ${Math.round(aShare * 100)} 대 ${Math.round((1 - aShare) * 100)}`}>
            <span className="g-power__a" style={{ width: `${aShare * 100}%`, background: a }} />
            <span className="g-power__d" style={{ width: `${(1 - aShare) * 100}%`, background: d }} />
          </div>
          <div className="g-power__legend">
            <span style={{ color: a }}>공격 {Math.round(aShare * 100)}</span>
            <span style={{ color: d }}>수비 {Math.round((1 - aShare) * 100)}</span>
          </div>

          <p className={`g-power__odds${risky ? ' g-power__odds--risky' : ''}`}>
            자동 전투로 치르면 {josa(subject, '이/가')} 이길 확률은 {percent(ours)}입니다.{risky ? ' 직접 지휘하는 편이 낫습니다.' : ''}
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
              <p>
                승산이 {percent(ours)}에 그칩니다. 자동 전투는 함대를 잃고 포구를 빼앗길 수 있습니다. 그래도 숫자에 맡기시겠습니까?
              </p>
              <div className="g-actions">
                <button type="button" className="g-btn g-btn--primary" onClick={onFight}>
                  직접 지휘
                </button>
                <button type="button" className="g-btn g-btn--danger" onClick={onAuto}>
                  그래도 자동 전투
                </button>
                <button type="button" className="g-btn g-btn--ghost" onClick={() => setSure(false)}>
                  돌아가기
                </button>
              </div>
            </div>
          ) : (
            <div className="g-actions">
              <button type="button" className="g-btn g-btn--primary" onClick={onFight}>
                전투 개시
              </button>
              <button type="button" className="g-btn" onClick={() => (risky ? setSure(true) : onAuto?.())}>
                자동 전투
              </button>
              <button type="button" className="g-btn g-btn--ghost" onClick={onCancel}>
                {cancelLabel}
              </button>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}
