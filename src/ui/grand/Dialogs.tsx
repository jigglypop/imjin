import { useState } from 'react';
import { useT } from '../../i18n';
import { MAP_IMAGE } from './projection';
import { Bar, FactionCrest, FactionMark, Icon, Modal, goldText, navyName, num, shipName, toneStyle } from './shared';
import { portsText, shipsText } from './text';
import type { BattleResultView, EventView, FactionId, GameOverView, LogLineView, ObjectiveView, RelationView, SaveView, ScoreView, TurnReportView } from './types';

/** Dialogs of the faction campaign that are not the map's panels: war status, battle result, turn report, end of the war, menu, continue. */

function Scores({ scores, me }: { scores: ScoreView[]; me: FactionId }) {
  const t = useT();
  const top = Math.max(1, ...scores.map((s) => s.score));
  return (
    <ul className="g-list">
      {scores.map((s) => (
        <li key={s.faction} className={`g-row g-score${s.faction === me ? ' g-score--me' : ''}`} style={toneStyle(s.faction)}>
          <FactionMark faction={s.faction} size="md" />
          <span className="g-row__main">
            <span className="g-row__title">
              {navyName(s.faction)}
              {s.faction === me && <span className="g-row__kind">{t('우리 진영')}</span>}
              {!s.alive && <span className="g-row__kind">{t('패망')}</span>}
            </span>
            <span className="g-row__sub">{t('포구 {ports} · 함선 {ships}', { ports: portsText(s.regions), ships: shipsText(s.ships) })}</span>
            <Bar value={s.score / top} tone="tone" label={t('점수 {n}', { n: s.score })} />
          </span>
          <b className="g-score__num">{num(s.score)}</b>
        </li>
      ))}
    </ul>
  );
}

function Log({ lines }: { lines: LogLineView[] }) {
  const t = useT();
  if (!lines.length) return <p className="g-hint">{t('아직 새 소식이 없습니다.')}</p>;
  return (
    <ul className="g-log">
      {[...lines].reverse().map((l, i) => (
        <li key={i} className={`g-log__${l.tone}`}>
          <span>{t('{n}턴째', { n: l.turn })}</span>
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
  const t = useT();
  const [sure, setSure] = useState<FactionId | null>(null);
  const progress = objective.need ? objective.have / objective.need : 0;
  return (
    <Modal label={t('전황')} eyebrow={t('진영 전역')} title={t('전황')} onClose={onClose} tone={me}>
      <h3 className="g-section g-section--first">{t('목표')}</h3>
      <p className="g-note">{objective.text}</p>
      <div className="g-goal">
        <Bar value={progress} tone="good" label={t('목표 {have} / {need}', { have: objective.have, need: objective.need })} />
        <b>
          {objective.have} / {objective.need}
        </b>
      </div>
      <p className="g-hint">
        {objective.hold > 0
          ? t('목표를 {hold}턴째 유지하고 있습니다. {need}턴을 유지하면 승리합니다.', { hold: objective.hold, need: objective.holdNeeded })
          : t('목표를 달성하고 {need}턴을 유지하면 승리합니다. 달성하지 못하면 마지막 턴의 점수로 승패를 가립니다.', { need: objective.holdNeeded })}
      </p>

      <h3 className="g-section">{t('세력 점수')}</h3>
      <Scores scores={scores} me={me} />

      <h3 className="g-section">{t('외교')}</h3>
      <ul className="g-list">
        {relations.map((r) => (
          <li key={r.other} className="g-row">
            <FactionMark faction={r.other} size="md" />
            <span className="g-row__main">
              <span className="g-row__title">{navyName(r.other)}</span>
              <span className="g-row__sub">{r.allied ? t('동맹: 함께 싸우고 포구를 함께 씁니다.') : (r.locked ?? t('적대: 만나면 전투가 벌어집니다.'))}</span>
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
                  {t('파기 확인')}
                </button>
              ) : (
                <button type="button" className="g-btn g-btn--sm" disabled={!canOrder} onClick={() => setSure(r.other)}>
                  {t('동맹 파기')}
                </button>
              )
            ) : (
              <button type="button" className="g-btn g-btn--sm" disabled={!canOrder || !!r.locked} title={r.locked} onClick={() => onAlliance(r.other)}>
                {t('동맹 제의')}
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3 className="g-section">{t('소식')}</h3>
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
  const t = useT();
  const lost = result.fleet.filter((s) => !s.alive).length;
  const kind = result.won === null ? 'info' : result.won ? 'win' : 'loss';
  return (
    <Modal
      label={t('{place} 전투 결과', { place: result.regionName })}
      eyebrow={result.played ? t('전투 결과') : t('자동 전투 결과')}
      title={
        <>
          {result.regionName} <span className={`g-verdict g-verdict--${kind}`}>{result.headline}</span>
        </>
      }
      footer={
        <button type="button" className="g-btn g-btn--primary g-btn--block" onClick={onClose}>
          {t('확인')}
        </button>
      }
    >
      <p className="g-note">{result.outcome}</p>
      <div className="g-versus g-versus--two">
        {result.sides.map((s) => (
          <div key={s.role} className="g-bside" style={toneStyle(s.faction)}>
            <div className="g-bside__role">
              {s.you ? t('{role} · 우리 측', { role: t(s.role) }) : t(s.role)}
            </div>
            <div className="g-bside__who">
              <FactionMark faction={s.faction} size="md" />
              <div>
                <b>{navyName(s.faction)}</b>
              </div>
            </div>
            <dl className="g-bside__stats">
              <div>
                <dt>{t('참전')}</dt>
                <dd>{shipsText(s.ships)}</dd>
              </div>
              <div>
                <dt>{t('손실')}</dt>
                <dd>{shipsText(s.lost)}</dd>
              </div>
              <div>
                <dt>{t('격침')}</dt>
                <dd>{shipsText(s.kills)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      {result.razed.length > 0 && <p className="g-banner g-banner--bad">{t('파괴된 시설: {list}', { list: result.razed.join(' · ') })}</p>}
      <h3 className="g-section">
        {t('우리 함선')} <span className="g-section__hint">{lost > 0 ? t('{ships} 손실', { ships: shipsText(lost) }) : t('손실 없음')}</span>
      </h3>
      <ul className="g-list g-list--tight">
        {result.fleet.slice(0, 12).map((s, i) => (
          <li key={`${s.name}-${i}`} className={`g-row g-ship-line${s.alive ? '' : ' g-ship-line--lost'}`}>
            <span className="g-row__main">
              <span className="g-row__title">
                {s.name}
                <span className="g-row__kind">{shipName(s.kind)}</span>
              </span>
              {s.alive ? (
                <span className="g-meter">
                  <span className="g-meter__label">{t('선체')}</span>
                  <Bar value={s.hull} label={t('선체 {n}%', { n: Math.round(s.hull * 100) })} />
                  <span className="g-meter__num">{Math.round(s.hull * 100)}</span>
                </span>
              ) : (
                <span className="g-row__sub">{t('침몰')}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {result.fleet.length > 12 && <p className="g-hint">{t('그 밖에 {n}척이 더 있습니다.', { n: result.fleet.length - 12 })}</p>}
    </Modal>
  );
}

export interface TurnSummaryProps {
  report: TurnReportView;
  onClose: () => void;
}

/** A change against the turn before: a muted green for a gain, a muted brown-red for a loss. */
function Delta({ n, unit = '' }: { n: number; unit?: string }) {
  return <span className={`g-delta${n > 0 ? ' g-delta--up' : n < 0 ? ' g-delta--down' : ''}`}>{n > 0 ? `+${num(n)}` : n < 0 ? `−${num(Math.abs(n))}` : '±0'}{unit}</span>;
}

/** The season that just passed, as numbers first (treasury, ports, ships, battles and where the silver went), then the news. */
export function TurnSummary({ report, onClose }: TurnSummaryProps) {
  const t = useT();
  const { gold, regions, ships } = report;
  const rows: { label: string; value: number; main?: boolean }[] = [
    { label: t('이전 턴 보유 은'), value: gold.before, main: true },
    { label: t('포구 수입'), value: gold.earned },
    { label: t('함대 유지비'), value: -gold.upkeep },
    ...(gold.spent ? [{ label: t('시설 · 건조 비용'), value: -gold.spent }] : []),
    ...(gold.events ? [{ label: t('사건 보상 · 손실'), value: gold.events }] : []),
  ];
  return (
    <Modal
      label={t('턴 결과')}
      eyebrow={report.date}
      title={t('턴 결과')}
      onClose={onClose}
      footer={
        <button type="button" className="g-btn g-btn--primary g-btn--block" onClick={onClose}>
          {t('다음 턴 시작')}
        </button>
      }
    >
      <ul className="g-tiles" aria-label={t('이번 턴의 수치')}>
        <li>
          <span>{t('은')}</span>
          <b>{num(gold.now)}</b>
          <Delta n={gold.now - gold.before} />
        </li>
        <li>
          <span>{t('포구')}</span>
          <b>{portsText(regions.now)}</b>
          <Delta n={regions.now - regions.before} />
        </li>
        <li>
          <span>{t('함선')}</span>
          <b>{shipsText(ships.now)}</b>
          <Delta n={ships.now - ships.before} />
        </li>
        <li>
          <span>{t('해전')}</span>
          <b>{t('{n}건', { n: report.battles })}</b>
        </li>
      </ul>
      <dl className="g-ledger" aria-label={t('은 출납')}>
        {rows.map((r) => (
          <div key={r.label} className={r.main ? 'g-ledger__main' : undefined}>
            <dt>{r.label}</dt>
            <dd>{r.main ? goldText(r.value) : <Delta n={r.value} unit={t('냥')} />}</dd>
          </div>
        ))}
        <div className="g-ledger__total">
          <dt>{t('현재 보유 은')}</dt>
          <dd>{goldText(gold.now)}</dd>
        </div>
      </dl>
      <h3 className="g-section">{t('이번 턴 소식')}</h3>
      <Log lines={report.news} />
    </Modal>
  );
}

export interface EventCardProps {
  event: EventView;
  me: FactionId;
  onChoose: (index: number) => void;
}

/** A scripted turning point of the war: a short text and two answers. It cannot be dismissed, only answered. */
export function EventCard({ event, me, onChoose }: EventCardProps) {
  const t = useT();
  return (
    <Modal label={event.title} eyebrow={t('{date} · 역사 사건', { date: event.date })} title={event.title} tone={me}>
      <div className="g-event">
        {event.portrait && <img className="g-event__portrait" src={`/ui/portraits/${event.portrait}.jpg`} alt="" width={84} height={84} />}
        <p className="g-event__text">{event.text}</p>
      </div>
      <div className="g-event__choices">
        {event.choices.map((c, i) => (
          <button key={c.label} type="button" className="g-choice" onClick={() => onChoose(i)}>
            <b>{c.label}</b>
            {c.hint && <span>{c.hint}</span>}
          </button>
        ))}
      </div>
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
  const t = useT();
  return (
    <Modal
      label={t('전역 종료')}
      eyebrow={t('{turn}턴 · 전역 종료', { turn: over.turn })}
      tone={me}
      title={<span className={`g-verdict g-verdict--${over.won ? 'win' : 'loss'}`}>{over.headline}</span>}
      footer={
        <div className="g-actions">
          <button type="button" className="g-btn g-btn--primary" onClick={onNew}>
            {t('새 전역')}
          </button>
          <button type="button" className="g-btn" onClick={onView}>
            {t('지도 보기')}
          </button>
          <button type="button" className="g-btn g-btn--ghost" onClick={onMenu}>
            {t('메뉴')}
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
  const t = useT();
  const [sure, setSure] = useState(false);
  return (
    <Modal label={t('전역 메뉴')} eyebrow={t('진영 전역')} title={t('메뉴')} onClose={onClose}>
      <div className="g-menu">
        <button type="button" className="g-btn g-btn--block" onClick={onClose}>
          {t('지도로 돌아가기')}
        </button>
        <button type="button" className="g-btn g-btn--block" onClick={onStatus}>
          {t('전황 · 외교')}
        </button>
        <button type="button" className="g-btn g-btn--block" onClick={onLeave}>
          {t('메인 메뉴 (진행 상황은 저장됩니다)')}
        </button>
        {sure ? (
          <button type="button" className="g-btn g-btn--block g-btn--danger" onClick={onAbandon}>
            {t('전역 포기 확인')}
          </button>
        ) : (
          <button type="button" className="g-btn g-btn--block g-btn--ghost" onClick={() => setSure(true)}>
            {t('전역 포기')}
          </button>
        )}
        {sure && <p className="g-hint">{t('포기하면 저장된 전역이 삭제되며 되돌릴 수 없습니다.')}</p>}
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
  const t = useT();
  const [sure, setSure] = useState(false);
  return (
    <div className="g-hub" style={{ ['--backdrop' as string]: `url(${MAP_IMAGE})` }}>
      <button type="button" className="g-back g-hub__back" onClick={onBack}>
        <Icon name="back" size="sm" />
        {t('메뉴')}
      </button>
      <section className="g-glass g-hub__card" style={toneStyle(save.faction)}>
        <div className="g-sheet__eyebrow">{t('진영 전역 · 1592')}</div>
        <h1 className="g-hub__title">
          <FactionCrest faction={save.faction} size={56} />
          <span>
            {navyName(save.faction)}
            <small>{t('{date} · {turn} / {max}턴 · 난이도 {level}', { date: save.date, turn: save.turn, max: save.maxTurns, level: save.difficulty })}</small>
          </span>
        </h1>
        <dl className="g-hub__stats">
          <div>
            <dt>{t('포구')}</dt>
            <dd>{portsText(save.regions)}</dd>
          </div>
          <div>
            <dt>{t('함선')}</dt>
            <dd>{shipsText(save.ships)}</dd>
          </div>
          <div>
            <dt>{t('은')}</dt>
            <dd>{num(save.gold)}</dd>
          </div>
        </dl>
        {save.over ? <p className="g-hint">{t('이 전역은 종료되었습니다.')}</p> : save.waiting > 0 ? <p className="g-banner">{t('진행할 전투가 {n}건 있습니다.', { n: save.waiting })}</p> : null}
        <div className="g-hub__actions">
          <button type="button" className="g-btn g-btn--primary g-btn--lg" onClick={onContinue}>
            {save.over ? t('결과 보기') : t('이어서 하기')}
          </button>
          {sure ? (
            <button type="button" className="g-btn g-btn--lg g-btn--danger" onClick={onNew}>
              {t('저장을 지우고 새로 시작')}
            </button>
          ) : (
            <button type="button" className="g-btn g-btn--lg" onClick={() => setSure(true)}>
              {t('새 전역')}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
