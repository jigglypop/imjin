import { FACTION_INFO, FactionSeal } from './shared';
import type { BattlePreviewView, BattleSideView } from './types';

export interface BattlePreviewProps {
  battle: BattlePreviewView;
  onFight?: () => void;
  onAuto?: () => void;
  onCancel?: () => void;
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

/** Pre-battle summary: both sides' strength as a tug-of-war bar, then fight it out in 3D or let the numbers decide. */
export function BattlePreview({ battle, onFight, onAuto, onCancel }: BattlePreviewProps) {
  const { attacker, defender } = battle;
  const total = Math.max(1, attacker.power + defender.power);
  const aShare = attacker.power / total;
  const a = FACTION_INFO[attacker.faction].color;
  const d = FACTION_INFO[defender.faction].color;
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
            <Side side={attacker} role="공격" share={aShare} />
            <span className="g-versus__vs" aria-hidden>
              對
            </span>
            <Side side={defender} role="수비" share={1 - aShare} />
          </div>

          <div className="g-power" role="img" aria-label={`전력 비 ${Math.round(aShare * 100)} 대 ${Math.round((1 - aShare) * 100)}`}>
            <span className="g-power__a" style={{ width: `${aShare * 100}%`, background: a }} />
            <span className="g-power__d" style={{ width: `${(1 - aShare) * 100}%`, background: d }} />
          </div>
          <div className="g-power__legend">
            <span style={{ color: a }}>공격 {Math.round(aShare * 100)}</span>
            <span className="g-power__odds">자동 전투 승률 {Math.round(battle.winChance * 100)}%</span>
            <span style={{ color: d }}>수비 {Math.round((1 - aShare) * 100)}</span>
          </div>

          {battle.notes && battle.notes.length > 0 && (
            <ul className="g-notes">
              {battle.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
        <footer className="g-sheet__foot">
          <div className="g-actions">
            <button type="button" className="g-btn g-btn--primary" onClick={onFight}>
              전투 개시
            </button>
            <button type="button" className="g-btn" onClick={onAuto}>
              자동 전투
            </button>
            <button type="button" className="g-btn g-btn--ghost" onClick={onCancel}>
              취소
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
