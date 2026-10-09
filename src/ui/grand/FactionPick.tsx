import { useState } from 'react';
import { MAP_IMAGE } from './projection';
import { useT } from '../../i18n';
import { Chip, FACTION_INFO, FactionCrest, Icon } from './shared';
import { fleetsText, portsText } from './text';
import type { FactionId, FactionOption } from './types';

export type Level = 'easy' | 'normal' | 'hard';

export interface FactionPickProps {
  options: FactionOption[];
  initial?: FactionId;
  onPick: (id: FactionId, level: Level) => void;
  onBack?: () => void;
}

/** Korean source text: shown through t(). */
const DIFFICULTY = ['쉬움', '보통', '어려움'];
const LEVELS: { id: Level; name: string; hint: string }[] = [
  { id: 'easy', name: '쉬움', hint: '적 진영의 수입이 10% 줄어듭니다.' },
  { id: 'normal', name: '보통', hint: '모든 진영이 같은 조건입니다.' },
  { id: 'hard', name: '어려움', hint: '적 진영의 수입이 15% 늘어납니다.' },
];

/** Choose the faction to lead: one card each with its strengths and starting ports. */
export function FactionPick({ options, initial, onPick, onBack }: FactionPickProps) {
  const t = useT();
  const [sel, setSel] = useState<FactionId>(initial ?? options[0]?.id ?? 'joseon');
  const [level, setLevel] = useState<Level>('normal');
  const chosen = options.find((o) => o.id === sel);
  return (
    <div className="g-pick" style={{ ['--backdrop' as string]: `url(${MAP_IMAGE})` }}>
      <div className="g-pick__scroll">
        <div className="g-pick__inner">
          <header className="g-pick__head">
            {onBack && (
              <button type="button" className="g-back" onClick={onBack}>
                <Icon name="back" size="sm" />
                {t('뒤로')}
              </button>
            )}
            <div>
              <div className="g-sheet__eyebrow">{t('진영 전역 · 1592')}</div>
              <h1 className="g-pick__title">{t('진영 선택')}</h1>
            </div>
          </header>
          <div className="g-pick__cards" role="radiogroup" aria-label={t('진영')}>
            {options.map((o) => {
              const f = FACTION_INFO[o.id];
              const on = o.id === sel;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`g-glass g-fcard${on ? ' g-fcard--on' : ''}`}
                  style={{ ['--tone' as string]: f.color, ['--tone-soft' as string]: f.soft }}
                  onClick={() => setSel(o.id)}
                >
                  <span className="g-fcard__top">
                    <FactionCrest faction={o.id} size={52} className="g-fcard__crest" />
                    <span className="g-fcard__name">
                      <b>{o.name}</b>
                      <span>{o.leader}</span>
                    </span>
                    <span className="g-fcard__diff" aria-label={t('난이도 {level}', { level: t(DIFFICULTY[o.difficulty - 1]!) })}>
                      {t(DIFFICULTY[o.difficulty - 1]!)}
                      <i>
                        {[1, 2, 3].map((n) => (
                          <u key={n} className={n <= o.difficulty ? 'on' : ''} />
                        ))}
                      </i>
                    </span>
                  </span>
                  <span className="g-fcard__blurb">{o.blurb}</span>
                  <span className="g-fcard__chips">
                    {o.strengths.map((s) => (
                      <Chip key={s}>{s}</Chip>
                    ))}
                    <Chip tone="warn">{o.weakness}</Chip>
                  </span>
                  <span className="g-fcard__start">
                    <span>{t('시작 포구 {ports} · 함대 {fleets}', { ports: portsText(o.startRegions.length), fleets: fleetsText(o.fleets) })}</span>
                    <b>{o.startRegions.join(' · ')}</b>
                  </span>
                </button>
              );
            })}
          </div>
          <footer className="g-glass g-pick__foot">
            <div className="g-level" role="radiogroup" aria-label={t('난이도')}>
              {LEVELS.map((l) => (
                <button key={l.id} type="button" role="radio" aria-checked={level === l.id} className={`g-level__opt${level === l.id ? ' g-level__opt--on' : ''}`} onClick={() => setLevel(l.id)}>
                  {t(l.name)}
                </button>
              ))}
            </div>
            <span className="g-level__hint">{t(LEVELS.find((l) => l.id === level)?.hint ?? '')}</span>
            <button type="button" className="g-btn g-btn--primary g-btn--lg g-pick__go" onClick={() => onPick(sel, level)}>
              {chosen ? t('{name|으로/로} 시작', { name: chosen.name }) : t('시작')}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
