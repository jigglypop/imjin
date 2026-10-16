import { useState } from 'react';
import { useT } from '../../i18n';
import { portraitUrl } from '../portrait';
import { Modal } from './shared';
import './growth.css';
import type { CommanderCardView, FactionId, SkillNodeView } from './types';

export interface CommandersProps {
  me: FactionId;
  cards: CommanderCardView[];
  /** False outside the orders phase: skills and appointments wait. */
  canOrder: boolean;
  onLearn: (commanderId: string, skillId: string) => void;
  /** Puts the commander in charge of the fleet, or (null fleet) relieves him of the one he leads. */
  onAssign: (fleetId: string, commanderId: string | null) => void;
  onClose: () => void;
}

/**
 * 장수: the navy's named commanders as a roll of portraits, and the one picked as a poster with his level, experience,
 * signature trait, skill tree and command. Commanders still to come are listed dimmed with the season they join.
 */
export function Commanders({ me, cards, canOrder, onLearn, onAssign, onClose }: CommandersProps) {
  const t = useT();
  const [pick, setPick] = useState(() => (cards.find((c) => c.points > 0) ?? cards[0])?.id ?? '');
  const c = cards.find((x) => x.id === pick) ?? cards[0];
  const waiting = cards.reduce((n, x) => n + x.points, 0);
  return (
    <Modal label={t('휘하 장수')} eyebrow={t('캠페인')} title={t('휘하 장수')} onClose={onClose} tone={me} className="g-modal--wide g-cmd">
      <div className="g-cmd__layout">
        <nav className="g-cmd__roll" aria-label={t('장수 목록')}>
          {waiting > 0 && <p className="g-cmd__waiting">{t('익힐 재능 {n}개', { n: waiting })}</p>}
          <ul>
            {cards.map((x) => (
              <li key={x.id}>
                <button type="button" className={`g-cmd__pick${x.id === c?.id ? ' g-cmd__pick--on' : ''}${x.status === 'coming' ? ' g-cmd__pick--coming' : ''}`} aria-pressed={x.id === c?.id} onClick={() => setPick(x.id)}>
                  <img src={portraitUrl(x.portrait, true)} alt="" width={44} height={44} loading="lazy" />
                  <span className="g-cmd__pickText">
                    <b>{x.name}</b>
                    <span>{x.status === 'coming' ? t('{date} 합류', { date: x.joins ?? '' }) : x.fleet ? x.fleet.name : x.status === 'suspended' ? t('파직') : t('대기')}</span>
                  </span>
                  <span className="g-cmd__lv">{x.status === 'coming' ? '—' : `Lv.${x.level}`}</span>
                  {x.points > 0 && <span className="g-cmd__dot" aria-label={t('익힐 재능 {n}개', { n: x.points })}>{x.points}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {c && <Detail c={c} canOrder={canOrder} onLearn={onLearn} onAssign={onAssign} />}
      </div>
    </Modal>
  );
}

function Detail({ c, canOrder, onLearn, onAssign }: { c: CommanderCardView; canOrder: boolean; onLearn: CommandersProps['onLearn']; onAssign: CommandersProps['onAssign'] }) {
  const t = useT();
  const coming = c.status === 'coming';
  const top = c.level >= c.maxLevel;
  const share = top ? 1 : Math.max(0, Math.min(1, (c.xp - c.xpFrom) / Math.max(1, c.xpTo - c.xpFrom)));
  const learn = (n: SkillNodeView) => canOrder && !coming && n.state === 'open' && onLearn(c.id, n.id);
  return (
    <article className="g-cmd__detail" key={c.id}>
      <header className={`g-cmd__hero${coming ? ' g-cmd__hero--coming' : ''}`}>
        <img className="g-cmd__portrait" src={portraitUrl(c.portrait)} alt="" width={768} height={768} />
        <div className="g-cmd__heroText">
          <span className="g-cmd__title">{c.title}</span>
          <h3 className="g-cmd__name">
            {c.name}
            {c.hanja && <span className="g-cmd__hanja">{c.hanja}</span>}
          </h3>
          {coming ? (
            <p className="g-cmd__coming">{t('{date}에 수군에 합류합니다', { date: c.joins ?? '' })}</p>
          ) : (
            <>
              <div className="g-cmd__level">
                <b>Lv.{c.level}</b>
                <span>{top ? t('최고 레벨') : t('경험 {xp} / {next}', { xp: c.xp, next: c.xpTo })}</span>
              </div>
              <div className="g-cmd__xp" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label={t('경험')}>
                <span style={{ width: `${share * 100}%` }} />
              </div>
              {c.points > 0 && <p className="g-cmd__points">{t('재능 점수 {n}', { n: c.points })}</p>}
            </>
          )}
        </div>
      </header>

      <section className="g-cmd__trait">
        <span className="g-cmd__eyebrow">{t('고유 특성')}</span>
        <b>{c.trait.label}</b>
        <p>{c.trait.text}</p>
      </section>

      <h4 className="g-section">{t('재능')}</h4>
      <div className="g-cmd__tree" style={{ gridTemplateColumns: `repeat(${c.branches.length}, minmax(0, 1fr))` }}>
        {c.branches.map((b) => (
          <div key={b.id} className="g-cmd__branch">
            <span className="g-cmd__branchName">{b.label}</span>
            {b.nodes.map((n) => (
              <SkillNode key={n.id} n={n} disabled={!canOrder || coming} onPick={() => learn(n)} />
            ))}
          </div>
        ))}
        <div className="g-cmd__masteryRow" style={{ gridColumn: `1 / span ${c.branches.length}` }}>
          <SkillNode n={c.mastery} mastery disabled={!canOrder || coming} onPick={() => learn(c.mastery)} />
        </div>
      </div>

      {!coming && (
        <>
          <h4 className="g-section">{t('지휘')}</h4>
          {c.status === 'suspended' ? (
            <p className="g-note">{t('조정의 명으로 지휘권을 잃었습니다')}</p>
          ) : (
            <>
              {c.fleet ? (
                <div className="g-row g-cmd__leads">
                  <span className="g-row__main">
                    <span className="g-row__title">{c.fleet.name}</span>
                    <span className="g-row__sub">{t('{place}에서 지휘 중', { place: c.fleet.place })}</span>
                  </span>
                  <button type="button" className="g-btn g-btn--sm g-btn--ghost" disabled={!canOrder} onClick={() => onAssign(c.fleet!.id, null)}>
                    {t('지휘관 해임')}
                  </button>
                </div>
              ) : (
                <p className="g-note">{t('지금은 지휘하는 함대가 없습니다.')}</p>
              )}
              {c.targets.length > 0 && (
                <ul className="g-list g-cmd__targets">
                  {c.targets.map((f) => (
                    <li key={f.fleetId} className="g-row">
                      <span className="g-row__main">
                        <span className="g-row__title">{f.name}</span>
                        <span className="g-row__sub">
                          {t('{place} · {n}척', { place: f.place, n: f.ships })}
                          {f.leader && <> · {t('{name} 지휘 중', { name: f.leader })}</>}
                        </span>
                      </span>
                      <button type="button" className="g-btn g-btn--sm" disabled={!canOrder} onClick={() => onAssign(f.fleetId, c.id)}>
                        {t('임명')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {c.fleet && c.targets.length === 0 && <p className="g-hint">{t('같은 포구에 있는 함대로만 옮길 수 있습니다.')}</p>}
            </>
          )}
        </>
      )}
    </article>
  );
}

function SkillNode({ n, mastery, disabled, onPick }: { n: SkillNodeView; mastery?: boolean; disabled: boolean; onPick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className={`g-skill g-skill--${n.state}${mastery ? ' g-skill--mastery' : ''}`}
      disabled={disabled || n.state !== 'open'}
      title={n.reason}
      aria-label={`${n.label}: ${n.text}${n.reason ? ` (${n.reason})` : ''}`}
      onClick={onPick}
    >
      <span className="g-skill__tier" aria-hidden>
        {n.state === 'have' ? '✓' : mastery ? '★' : ['Ⅰ', 'Ⅱ', 'Ⅲ'][n.tier - 1]}
      </span>
      <span className="g-skill__text">
        <b>{mastery ? t('비기: {name}', { name: n.label }) : n.label}</b>
        <span>{n.text}</span>
        {mastery && n.state === 'locked' && n.reason && <em>{n.reason}</em>}
      </span>
    </button>
  );
}
