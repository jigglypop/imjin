import { useState } from 'react';
import { MAP_IMAGE } from './projection';
import { Chip, FACTION_INFO } from './shared';
import type { FactionId, FactionOption } from './types';

export type Level = 'easy' | 'normal' | 'hard';

export interface FactionPickProps {
  options: FactionOption[];
  initial?: FactionId;
  onPick: (id: FactionId, level: Level) => void;
  onBack?: () => void;
}

const DIFFICULTY = ['쉬움', '보통', '어려움'];
const LEVELS: { id: Level; name: string; hint: string }[] = [
  { id: 'easy', name: '쉬움', hint: '적 진영의 수입이 10% 줄어듭니다' },
  { id: 'normal', name: '보통', hint: '모든 진영이 같은 조건입니다' },
  { id: 'hard', name: '어려움', hint: '적 진영의 수입이 15% 늘어납니다' },
];

/** Choose the faction to lead: one card each with its strengths and starting regions. */
export function FactionPick({ options, initial, onPick, onBack }: FactionPickProps) {
  const [sel, setSel] = useState<FactionId>(initial ?? options[0]?.id ?? 'joseon');
  const [level, setLevel] = useState<Level>('normal');
  const chosen = options.find((o) => o.id === sel);
  return (
    <div className="g-pick" style={{ ['--backdrop' as string]: `url(${MAP_IMAGE})` }}>
      <div className="g-pick__scroll">
        <div className="g-pick__inner">
          <header className="g-pick__head">
            {onBack && (
              <button type="button" className="g-btn g-btn--ghost g-btn--sm" onClick={onBack}>
                ‹ 뒤로
              </button>
            )}
            <div>
              <div className="g-sheet__eyebrow">진영 전역 · 1592</div>
              <h1 className="g-pick__title">어느 진영을 이끌겠습니까</h1>
            </div>
          </header>
          <div className="g-pick__cards" role="radiogroup" aria-label="진영">
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
                  style={{ ['--tone' as string]: f.color }}
                  onClick={() => setSel(o.id)}
                >
                  <span className="g-fcard__top">
                    <span className="g-fcard__seal" aria-hidden>
                      {f.hanja}
                    </span>
                    <span className="g-fcard__name">
                      <b>{o.name}</b>
                      <span>{o.leader}</span>
                    </span>
                    <span className="g-fcard__diff" aria-label={`난이도 ${DIFFICULTY[o.difficulty - 1]}`}>
                      {DIFFICULTY[o.difficulty - 1]}
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
                      <Chip key={s} tone="accent">
                        {s}
                      </Chip>
                    ))}
                    <Chip tone="warn">{o.weakness}</Chip>
                  </span>
                  <span className="g-fcard__start">
                    <span>
                      시작 영토 {o.startRegions.length}곳 · 함대 {o.fleets}개
                    </span>
                    <b>{o.startRegions.join(' · ')}</b>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <footer className="g-pick__foot">
        <div className="g-level" role="radiogroup" aria-label="난이도">
          {LEVELS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={level === l.id} className={`g-level__opt${level === l.id ? ' g-level__opt--on' : ''}`} onClick={() => setLevel(l.id)}>
              {l.name}
            </button>
          ))}
          <span className="g-level__hint">{LEVELS.find((l) => l.id === level)?.hint}</span>
        </div>
        <button type="button" className="g-btn g-btn--primary g-btn--lg" onClick={() => onPick(sel, level)}>
          {chosen ? `${chosen.name}으로 전역 시작` : '전역 시작'}
        </button>
      </footer>
    </div>
  );
}
