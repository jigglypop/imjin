import { useState } from 'react';
import { MAP_IMAGE } from './projection';
import { Bar, FACTION_INFO, FactionSeal, Modal, SHIP_NAME, goldText, ownerName } from './shared';
import type { BattleResultView, FactionId, GameOverView, LogLineView, ObjectiveView, RelationView, SaveView, ScoreView } from './types';

/** Dialogs of the faction campaign that are not the map's panels: war status, battle result, turn report, end of the war, menu, continue. */

function Scores({ scores, me }: { scores: ScoreView[]; me: FactionId }) {
  const top = Math.max(1, ...scores.map((s) => s.score));
  return (
    <ul className="g-list">
      {scores.map((s) => (
        <li key={s.faction} className={`g-row g-score${s.faction === me ? ' g-score--me' : ''}`} style={{ ['--tone' as string]: FACTION_INFO[s.faction].color }}>
          <FactionSeal faction={s.faction} size="sm" />
          <span className="g-row__main">
            <span className="g-row__title">
              {ownerName(s.faction)}
              {!s.alive && <span className="g-row__kind">무너짐</span>}
            </span>
            <span className="g-row__sub">
              포구 {s.regions} · 함선 {s.ships}
            </span>
            <Bar value={s.score / top} tone="good" label={`점수 ${s.score}`} />
          </span>
          <b className="g-score__num">{s.score.toLocaleString('ko-KR')}</b>
        </li>
      ))}
    </ul>
  );
}

function Log({ lines }: { lines: LogLineView[] }) {
  if (!lines.length) return <p className="g-hint">아직 전해진 소식이 없습니다.</p>;
  return (
    <ul className="g-log">
      {[...lines].reverse().map((l, i) => (
        <li key={i} className={`g-log__${l.tone}`}>
          <span>{l.turn}턴</span>
          {l.text}
        </li>
      ))}
    </ul>
  );
}

export interface StatusPanelProps {
  me: FactionId;
  objective: ObjectiveView;
  scores: ScoreView[];
  relations: RelationView[];
  log: LogLineView[];
  /** Diplomacy is an order: it cannot be given while battles wait or the war is over. */
  canOrder: boolean;
  onAlliance: (other: FactionId) => void;
  onWar: (other: FactionId) => void;
  onClose: () => void;
}

/** The war at a glance: what the player must achieve, who is ahead, the treaties, and the latest news. */
export function StatusPanel({ me, objective, scores, relations, log, canOrder, onAlliance, onWar, onClose }: StatusPanelProps) {
  const [sure, setSure] = useState<FactionId | null>(null);
  const progress = objective.need ? objective.have / objective.need : 0;
  return (
    <Modal label="전황" eyebrow="전황" title="전쟁의 흐름" onClose={onClose} tone={me}>
      <h3 className="g-section g-section--first">우리의 목표</h3>
      <p className="g-note">{objective.text}</p>
      <div className="g-goal">
        <Bar value={progress} tone="good" label={`목표 ${objective.have} / ${objective.need}`} />
        <b>
          {objective.have} / {objective.need}
        </b>
      </div>
      <p className="g-hint">
        {objective.hold > 0 ? `목표를 ${objective.hold}달째 쥐고 있습니다 (${objective.holdNeeded}달을 버티면 승리).` : `목표를 모두 이룬 채 ${objective.holdNeeded}달을 버티면 승리합니다. 그렇지 못하면 정해진 달에 점수로 가립니다.`}
      </p>

      <h3 className="g-section">점수</h3>
      <Scores scores={scores} me={me} />

      <h3 className="g-section">외교</h3>
      <ul className="g-list">
        {relations.map((r) => (
          <li key={r.other} className="g-row">
            <FactionSeal faction={r.other} size="sm" />
            <span className="g-row__main">
              <span className="g-row__title">{ownerName(r.other)}</span>
              <span className="g-row__sub">{r.allied ? '동맹 — 함께 싸우고 포구를 나눠 씁니다' : (r.locked ?? '적대 — 만나면 싸웁니다')}</span>
            </span>
            {r.allied ? (
              sure === r.other ? (
                <button
                  type="button"
                  className="g-btn g-btn--sm g-btn--danger"
                  disabled={!canOrder}
                  onClick={() => {
                    onWar(r.other);
                    setSure(null);
                  }}
                >
                  정말 깬다
                </button>
              ) : (
                <button type="button" className="g-btn g-btn--sm" disabled={!canOrder} onClick={() => setSure(r.other)}>
                  동맹 파기
                </button>
              )
            ) : (
              <button type="button" className="g-btn g-btn--sm" disabled={!canOrder || !!r.locked} title={r.locked} onClick={() => onAlliance(r.other)}>
                동맹 제의
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3 className="g-section">소식</h3>
      <Log lines={log} />
    </Modal>
  );
}

export interface BattleResultProps {
  result: BattleResultView;
  onClose: () => void;
}

/** What a settled meeting did, read after a 3D battle or an auto-resolve. */
export function BattleResult({ result, onClose }: BattleResultProps) {
  const lost = result.fleet.filter((s) => !s.alive).length;
  const kind = result.won === null ? 'info' : result.won ? 'win' : 'loss';
  return (
    <Modal
      label={`${result.regionName} 전투 결과`}
      eyebrow={result.played ? '해전 결과' : '자동 전투 결과'}
      title={
        <>
          {result.regionName} <span className={`g-verdict g-verdict--${kind}`}>{result.headline}</span>
        </>
      }
      footer={
        <button type="button" className="g-btn g-btn--primary g-btn--block" onClick={onClose}>
          확인
        </button>
      }
    >
      <p className="g-note">{result.outcome}</p>
      <div className="g-versus g-versus--two">
        {result.sides.map((s) => (
          <div key={s.role} className="g-bside" style={{ ['--tone' as string]: FACTION_INFO[s.faction].color }}>
            <div className="g-bside__role">
              {s.role}
              {s.you ? ' · 우리' : ''}
            </div>
            <div className="g-bside__who">
              <FactionSeal faction={s.faction} />
              <div>
                <b>{ownerName(s.faction)}</b>
              </div>
            </div>
            <dl className="g-bside__stats">
              <div>
                <dt>참전</dt>
                <dd>{s.ships}척</dd>
              </div>
              <div>
                <dt>잃은 배</dt>
                <dd>{s.lost}척</dd>
              </div>
              <div>
                <dt>격침</dt>
                <dd>{s.kills}척</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      {result.razed.length > 0 && <p className="g-banner g-banner--bad">무너진 시설: {result.razed.join(' · ')}</p>}
      <h3 className="g-section">
        우리 함선 <span className="g-section__hint">{lost > 0 ? `${lost}척 잃음` : '한 척도 잃지 않음'}</span>
      </h3>
      <ul className="g-list g-list--tight">
        {result.fleet.slice(0, 12).map((s, i) => (
          <li key={`${s.name}-${i}`} className={`g-row g-ship-line${s.alive ? '' : ' g-ship-line--lost'}`}>
            <span className="g-row__main">
              <span className="g-row__title">
                {s.name}
                <span className="g-row__kind">{SHIP_NAME[s.kind]}</span>
              </span>
              {s.alive ? (
                <span className="g-meter">
                  <span className="g-meter__label">선체</span>
                  <Bar value={s.hull} label={`선체 ${Math.round(s.hull * 100)}%`} />
                  <span className="g-meter__num">{Math.round(s.hull * 100)}</span>
                </span>
              ) : (
                <span className="g-row__sub">침몰</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {result.fleet.length > 12 && <p className="g-hint">그 밖에 {result.fleet.length - 12}척.</p>}
    </Modal>
  );
}

export interface TurnSummaryProps {
  date: string;
  lines: LogLineView[];
  gold: number;
  onClose: () => void;
}

/** The month that just passed: what the log recorded while the fleets sailed. */
export function TurnSummary({ date, lines, gold, onClose }: TurnSummaryProps) {
  return (
    <Modal
      label="이번 달의 소식"
      eyebrow="달이 바뀌었습니다"
      title={date}
      onClose={onClose}
      footer={
        <button type="button" className="g-btn g-btn--primary g-btn--block" onClick={onClose}>
          다음 명령 내리기
        </button>
      }
    >
      <Log lines={lines} />
      <p className="g-hint">곳간에는 {goldText(gold)}이 있습니다.</p>
    </Modal>
  );
}

export interface GameOverProps {
  over: GameOverView;
  me: FactionId;
  onView: () => void;
  onNew: () => void;
  onMenu: () => void;
}

export function GameOver({ over, me, onView, onNew, onMenu }: GameOverProps) {
  return (
    <Modal
      label="전역 종료"
      eyebrow={`${over.turn}턴 · 전역 종료`}
      title={<span className={`g-verdict g-verdict--${over.won ? 'win' : 'loss'}`}>{over.headline}</span>}
      footer={
        <div className="g-actions">
          <button type="button" className="g-btn g-btn--primary" onClick={onNew}>
            새 전역
          </button>
          <button type="button" className="g-btn" onClick={onView}>
            지도 보기
          </button>
          <button type="button" className="g-btn g-btn--ghost" onClick={onMenu}>
            메뉴로
          </button>
        </div>
      }
    >
      <p className="g-note">{over.text}</p>
      <Scores scores={over.scores} me={me} />
    </Modal>
  );
}

export interface MenuProps {
  onClose: () => void;
  onStatus: () => void;
  onLeave: () => void;
  onAbandon: () => void;
}

export function GrandMenu({ onClose, onStatus, onLeave, onAbandon }: MenuProps) {
  const [sure, setSure] = useState(false);
  return (
    <Modal label="전역 메뉴" eyebrow="진영 전역" title="메뉴" onClose={onClose}>
      <div className="g-menu">
        <button type="button" className="g-btn g-btn--block" onClick={onClose}>
          지도로 돌아가기
        </button>
        <button type="button" className="g-btn g-btn--block" onClick={onStatus}>
          전황 · 외교
        </button>
        <button type="button" className="g-btn g-btn--block" onClick={onLeave}>
          메인 메뉴로 (진행은 저장됩니다)
        </button>
        {sure ? (
          <button type="button" className="g-btn g-btn--block g-btn--danger" onClick={onAbandon}>
            정말 이 전역을 포기합니다
          </button>
        ) : (
          <button type="button" className="g-btn g-btn--block g-btn--ghost" onClick={() => setSure(true)}>
            전역 포기
          </button>
        )}
        {sure && <p className="g-hint">포기하면 저장된 전역이 지워지고 되돌릴 수 없습니다.</p>}
      </div>
    </Modal>
  );
}

export interface HubProps {
  save: SaveView;
  onContinue: () => void;
  onNew: () => void;
  onBack: () => void;
}

/** Entry to the faction campaign when a save exists: continue it, or begin again. */
export function Hub({ save, onContinue, onNew, onBack }: HubProps) {
  const [sure, setSure] = useState(false);
  const f = FACTION_INFO[save.faction];
  return (
    <div className="g-hub" style={{ ['--backdrop' as string]: `url(${MAP_IMAGE})` }}>
      <button type="button" className="g-back g-hub__back" onClick={onBack}>
        ‹ 메뉴
      </button>
      <section className="g-glass g-hub__card" style={{ ['--tone' as string]: f.color }}>
        <div className="g-sheet__eyebrow">진영 전역 · 1592</div>
        <h1 className="g-hub__title">
          <FactionSeal faction={save.faction} size="lg" />
          <span>
            {f.name} 수군
            <small>
              {save.date} · {save.turn} / {save.maxTurns}턴 · 난이도 {save.difficulty}
            </small>
          </span>
        </h1>
        <dl className="g-hub__stats">
          <div>
            <dt>포구</dt>
            <dd>{save.regions}곳</dd>
          </div>
          <div>
            <dt>함선</dt>
            <dd>{save.ships}척</dd>
          </div>
          <div>
            <dt>은</dt>
            <dd>{save.gold.toLocaleString('ko-KR')}</dd>
          </div>
        </dl>
        {save.over ? <p className="g-hint">이 전역은 끝났습니다.</p> : save.waiting > 0 ? <p className="g-banner">치를 전투가 {save.waiting}건 기다리고 있습니다.</p> : null}
        <div className="g-hub__actions">
          <button type="button" className="g-btn g-btn--primary g-btn--lg" onClick={onContinue}>
            {save.over ? '결과 보기' : '이어하기'}
          </button>
          {sure ? (
            <button type="button" className="g-btn g-btn--lg g-btn--danger" onClick={onNew}>
              저장을 지우고 새로 시작
            </button>
          ) : (
            <button type="button" className="g-btn g-btn--lg" onClick={() => setSure(true)}>
              새 전역
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
