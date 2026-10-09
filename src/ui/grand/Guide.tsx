import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The first-turn guide of a new campaign: four short steps, each pointing at the real control it is about (a ring
 * around it, the card beside it). The screen decides which step is current and when the player's own action moves it
 * on; this draws it and measures where the control is. Dismissing it, or reaching its end, is stored as seen.
 */

export interface GuideStepView {
  title: string;
  text: string;
  /** CSS selector of the control the step is about; none leaves the card at the top of the screen. */
  target?: string;
}

export interface GuideProps {
  step: number;
  steps: GuideStepView[];
  /** The player does not want to do this step: go to the next one. */
  onNext: () => void;
  /** Closes the guide for good. */
  onClose: () => void;
}

type Box = { left: number; top: number; width: number; height: number };

const GAP = 12;
const MARGIN = 12;

/** Where the control is on screen now, or null when it is not drawn. */
function measure(selector?: string): Box | null {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.left > innerWidth || r.top > innerHeight) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** The first of the spots around the control where the card fits on screen; the top of the screen when none does. */
function place(target: Box | null, card: { w: number; h: number }, top: number): { left: number; top: number } {
  const vw = innerWidth;
  const vh = innerHeight;
  const fits = (l: number, t: number) => l >= MARGIN && t >= top && l + card.w <= vw - MARGIN && t + card.h <= vh - MARGIN;
  const centred = Math.round((vw - card.w) / 2);
  if (!target) return { left: centred, top };
  const mid = target.left + target.width / 2 - card.w / 2;
  const clampX = (x: number) => Math.max(MARGIN, Math.min(vw - card.w - MARGIN, x));
  const side = target.top + target.height / 2 - card.h / 2;
  const beside = Math.max(top, Math.min(vh - card.h - MARGIN, side));
  const below = { left: clampX(mid), top: target.top + target.height + GAP };
  const above = { left: clampX(mid), top: target.top - card.h - GAP };
  const left = { left: target.left - card.w - GAP, top: beside };
  const right = { left: target.left + target.width + GAP, top: beside };
  // A control on the right half is usually in the side panel: the map to its left is the free space.
  const spots = target.left > vw / 2 ? [left, above, below, right] : [below, above, right, left];
  return spots.find((s) => fits(s.left, s.top)) ?? { left: centred, top };
}

export function Guide({ step, steps, onNext, onClose }: GuideProps) {
  const current = steps[step];
  const cardRef = useRef<HTMLElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [size, setSize] = useState({ w: 300, h: 150 });

  // The control moves with the map and the panels, so it is measured a few times a second rather than once.
  useEffect(() => {
    const read = () =>
      setBox((old) => {
        const next = measure(current?.target);
        const same = old && next && Math.abs(old.left - next.left) < 1 && Math.abs(old.top - next.top) < 1 && Math.abs(old.width - next.width) < 1 && Math.abs(old.height - next.height) < 1;
        return same ? old : next;
      });
    read();
    const id = window.setInterval(read, 180);
    addEventListener('resize', read);
    return () => {
      window.clearInterval(id);
      removeEventListener('resize', read);
    };
  }, [current?.target]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (el) setSize((s) => (Math.abs(s.w - el.offsetWidth) < 1 && Math.abs(s.h - el.offsetHeight) < 1 ? s : { w: el.offsetWidth, h: el.offsetHeight }));
  });

  if (!current) return null;
  // Clear of the top bar, whatever height the screen gives it.
  const topSpace = Math.max(76, (document.querySelector('.g-top')?.getBoundingClientRect().bottom ?? 68) + 8);
  const at = place(box, size, topSpace);
  return (
    <div className="g-guide" aria-live="polite">
      {box && <span className="g-guide__ring" style={{ left: box.left - 6, top: box.top - 6, width: box.width + 12, height: box.height + 12 }} />}
      <section ref={cardRef} className="g-glass g-guide__card" role="dialog" aria-label="처음 하는 길잡이" style={{ left: at.left, top: at.top }}>
        <div className="g-guide__dots" aria-label={`${step + 1} / ${steps.length}단계`}>
          {steps.map((s, i) => (
            <i key={s.title} className={i === step ? 'on' : i < step ? 'done' : ''} />
          ))}
        </div>
        <h3 className="g-guide__title">{current.title}</h3>
        <p className="g-guide__text">{current.text}</p>
        <div className="g-guide__actions">
          <button type="button" className="g-btn g-btn--sm" onClick={onNext}>
            {step === steps.length - 1 ? '마치기' : '다음'}
          </button>
          <button type="button" className="g-btn g-btn--sm g-btn--ghost" onClick={onClose}>
            그만 보기
          </button>
        </div>
      </section>
    </div>
  );
}
